import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { applyEdits, modify, parse, printParseErrorCode, type FormattingOptions, type ParseError } from "jsonc-parser";
import type { SupportedProviderApi } from "./pi-managed-provider-contracts.js";
import { assertPiManagedProviderCaller } from "./pi-managed-provider-access.js";
import {
  ALL_MANAGED_PROVIDER_COMPAT_KEYS,
  getManagedProviderAllowedCompatKeys,
  isManagedProviderCompatValueForKey,
  type ManagedProviderCompatOverrides,
  validateManagedProviderCompatOverrides,
} from "./pi-managed-provider-model-options.js";

const MODELS_CONFIG_FILE_MODE = 0o600;
const MODELS_CONFIG_DIRECTORY_MODE = 0o700;
const MODELS_CONFIG_LOCK_STALE_MS = 30_000;
const MODELS_CONFIG_LOCK_RETRY_MS = 25;
const DEFAULT_MODELS_CONFIG = "{\n  \"providers\": {}\n}\n";

export interface ManagedProviderModelOverrideWrite {
  changed: boolean;
  rollback(): Promise<void>;
}

export interface ManagedProviderProtocolProfileEntry {
  providerId: string;
  modelId: string;
  api: SupportedProviderApi;
  defaults: ManagedProviderCompatOverrides;
}

interface ParsedModelsConfig {
  root: Record<string, unknown>;
  providers: Record<string, unknown>;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function parseModelsConfigText(content: string): ParsedModelsConfig {
  const errors: ParseError[] = [];
  const value = parse(content, errors, { allowTrailingComma: false, disallowComments: false });
  if (errors.length > 0) {
    const first = errors[0]!;
    throw new Error(`Invalid models.json: ${printParseErrorCode(first.error)} at offset ${first.offset}`);
  }
  const root = requireObject(value, "models.json root");
  const providers = root.providers === undefined ? {} : requireObject(root.providers, "models.json providers");
  return { root, providers };
}

function getFormattingOptions(content: string): FormattingOptions {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const indentation = content.match(/\r?\n([ \t]+)"/u)?.[1] ?? "  ";
  return indentation.includes("\t")
    ? { insertSpaces: false, tabSize: 1, eol }
    : { insertSpaces: true, tabSize: Math.max(1, indentation.length), eol };
}

function modifyModelsConfigPath(content: string, path: readonly string[], value: unknown): string {
  return applyEdits(content, modify(content, [...path], value, { formattingOptions: getFormattingOptions(content) }));
}

function nestedObject(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown> | undefined {
  let current: unknown = root;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "object" && current !== null && !Array.isArray(current)
    ? current as Record<string, unknown>
    : undefined;
}

function pruneEmptyModelsConfigObjects(content: string, providerId: string, modelId: string): string {
  let next = content;
  const paths = [
    ["providers", providerId, "modelOverrides", modelId, "compat"],
    ["providers", providerId, "modelOverrides", modelId],
    ["providers", providerId, "modelOverrides"],
    ["providers", providerId],
  ] as const;
  for (const path of paths) {
    const { root } = parseModelsConfigText(next);
    const object = nestedObject(root, path);
    if (object && Object.keys(object).length === 0) next = modifyModelsConfigPath(next, path, undefined);
  }
  return next;
}

export function readManagedProviderCompatOverridesFromText(
  content: string,
  providerId: string,
  modelId: string,
): ManagedProviderCompatOverrides {
  const { root } = parseModelsConfigText(content);
  const compat = nestedObject(root, ["providers", providerId, "modelOverrides", modelId, "compat"]);
  if (!compat) return {};
  const overrides: ManagedProviderCompatOverrides = {};
  for (const key of ALL_MANAGED_PROVIDER_COMPAT_KEYS) {
    const value = compat[key];
    if (value === undefined) continue;
    if (!isManagedProviderCompatValueForKey(key, value)) {
      throw new Error(`Compatibility option ${key} has an invalid value`);
    }
    overrides[key] = value;
  }
  return overrides;
}

export function updateManagedProviderModelsJsonText(
  contentInput: string | undefined,
  providerId: string,
  modelId: string,
  api: SupportedProviderApi,
  overridesInput: ManagedProviderCompatOverrides,
): string {
  const content = contentInput ?? DEFAULT_MODELS_CONFIG;
  parseModelsConfigText(content);
  const overrides = validateManagedProviderCompatOverrides(api, overridesInput as Record<string, unknown>);
  const allowed = new Set(getManagedProviderAllowedCompatKeys(api));
  let next = content;
  for (const key of ALL_MANAGED_PROVIDER_COMPAT_KEYS) {
    const value = allowed.has(key) ? overrides[key] : undefined;
    if (value === undefined) {
      const { root } = parseModelsConfigText(next);
      const compat = nestedObject(root, ["providers", providerId, "modelOverrides", modelId, "compat"]);
      if (!compat || compat[key] === undefined) continue;
    }
    next = modifyModelsConfigPath(
      next,
      ["providers", providerId, "modelOverrides", modelId, "compat", key],
      value,
    );
  }
  next = pruneEmptyModelsConfigObjects(next, providerId, modelId);
  parseModelsConfigText(next);
  return next;
}

export function materializeManagedProviderProtocolProfilesInText(
  contentInput: string | undefined,
  entries: readonly ManagedProviderProtocolProfileEntry[],
): string {
  let next = contentInput ?? DEFAULT_MODELS_CONFIG;
  for (const entry of entries) {
    const current = readManagedProviderCompatOverridesFromText(next, entry.providerId, entry.modelId);
    const allowed = new Set(getManagedProviderAllowedCompatKeys(entry.api));
    const merged = { ...entry.defaults };
    for (const key of allowed) {
      if (current[key] !== undefined) merged[key] = current[key];
    }
    next = updateManagedProviderModelsJsonText(next, entry.providerId, entry.modelId, entry.api, merged);
  }
  return next;
}

async function readOptionalFile(path: string): Promise<{ existed: boolean; content?: string }> {
  try {
    return { existed: true, content: await readFile(path, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { existed: false };
    throw error;
  }
}

async function acquireModelsConfigLock(lockPath: string): Promise<() => Promise<void>> {
  for (;;) {
    try {
      const handle = await open(lockPath, "wx", MODELS_CONFIG_FILE_MODE);
      await handle.close();
      return async () => {
        try {
          await unlink(lockPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const metadata = await stat(lockPath);
        if (Date.now() - metadata.mtimeMs > MODELS_CONFIG_LOCK_STALE_MS) {
          await unlink(lockPath);
          continue;
        }
      } catch (inspectionError) {
        if ((inspectionError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw inspectionError;
      }
      await new Promise((resolve) => setTimeout(resolve, MODELS_CONFIG_LOCK_RETRY_MS));
    }
  }
}

async function writeAtomicModelsConfig(path: string, content: string): Promise<void> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: MODELS_CONFIG_DIRECTORY_MODE });
  await chmod(parent, MODELS_CONFIG_DIRECTORY_MODE);
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await open(temporaryPath, "wx", MODELS_CONFIG_FILE_MODE);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, path);
    await chmod(path, MODELS_CONFIG_FILE_MODE);
    if (process.platform !== "win32") {
      const directory = await open(parent, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") throw cleanupError;
    }
    throw error;
  }
}

async function commitManagedProviderModelsConfigChange(
  path: string,
  transform: (content: string | undefined) => string,
): Promise<ManagedProviderModelOverrideWrite> {
  await mkdir(dirname(path), { recursive: true, mode: MODELS_CONFIG_DIRECTORY_MODE });
  const release = await acquireModelsConfigLock(`${path}.pi-custom-provider.lock`);
  let original: { existed: boolean; content?: string };
  let next: string;
  try {
    original = await readOptionalFile(path);
    next = transform(original.content);
    const originalContent = original.content ?? DEFAULT_MODELS_CONFIG;
    if (next === originalContent) return { changed: false, rollback: async () => {} };
    await writeAtomicModelsConfig(`${path}.pi-custom-provider-backup`, originalContent);
    await writeAtomicModelsConfig(path, next);
  } catch (error) {
    throw new Error(`Failed to update models.json: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await release();
  }

  return {
    changed: true,
    rollback: async () => {
      const rollbackRelease = await acquireModelsConfigLock(`${path}.pi-custom-provider.lock`);
      try {
        const current = await readOptionalFile(path);
        if ((current.content ?? DEFAULT_MODELS_CONFIG) !== next) {
          throw new Error("Cannot roll back models.json because it changed after this operation");
        }
        if (original.existed) await writeAtomicModelsConfig(path, original.content!);
        else {
          try {
            await unlink(path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
      } finally {
        await rollbackRelease();
      }
    },
  };
}

class PiManagedProviderModelOverridesAccess {
  constructor(private readonly path: string) {}

  async read(providerId: string, modelId: string): Promise<ManagedProviderCompatOverrides> {
    const current = await readOptionalFile(this.path);
    return readManagedProviderCompatOverridesFromText(current.content ?? DEFAULT_MODELS_CONFIG, providerId, modelId);
  }

  async replace(
    providerId: string,
    modelId: string,
    api: SupportedProviderApi,
    overrides: ManagedProviderCompatOverrides,
  ): Promise<ManagedProviderModelOverrideWrite> {
    return commitManagedProviderModelsConfigChange(this.path, (content) =>
      updateManagedProviderModelsJsonText(content, providerId, modelId, api, overrides)
    );
  }

  async materialize(
    entries: readonly ManagedProviderProtocolProfileEntry[],
  ): Promise<ManagedProviderModelOverrideWrite> {
    return commitManagedProviderModelsConfigChange(this.path, (content) =>
      materializeManagedProviderProtocolProfilesInText(content, entries)
    );
  }
}

export async function bindPiManagedProviderModelOverrides(
  callerPath: string,
  path: string,
): Promise<PiManagedProviderModelOverridesAccess> {
  await assertPiManagedProviderCaller("model-overrides", callerPath);
  return new PiManagedProviderModelOverridesAccess(path);
}
