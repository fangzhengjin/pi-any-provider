import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import {
  EMPTY_MANAGED_PROVIDER_STATE,
  type ManagedProviderState,
} from "./pi-managed-provider-contracts.js";
import { assertPiManagedProviderCaller } from "./pi-managed-provider-access.js";
import { parseManagedProviderState } from "./pi-managed-provider-state-schema.js";

const PROVIDER_STATE_FILE_MODE = 0o600;
const PROVIDER_STATE_DIRECTORY_MODE = 0o700;
const PROVIDER_STATE_LOCK_STALE_MS = 30_000;
const PROVIDER_STATE_LOCK_RETRY_MS = 25;

async function loadManagedProviderState(path: string): Promise<ManagedProviderState> {
  try {
    const content = await readFile(path, "utf8");
    await chmod(path, PROVIDER_STATE_FILE_MODE);
    return parseManagedProviderState(JSON.parse(content) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY_MANAGED_PROVIDER_STATE);
    throw new Error(`Failed to load provider settings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function acquireProviderStateLock(lockPath: string): Promise<() => Promise<void>> {
  for (;;) {
    try {
      const handle = await open(lockPath, "wx", PROVIDER_STATE_FILE_MODE);
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
        if (Date.now() - metadata.mtimeMs > PROVIDER_STATE_LOCK_STALE_MS) {
          await unlink(lockPath);
          continue;
        }
      } catch (inspectionError) {
        if ((inspectionError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw inspectionError;
      }
      await new Promise((resolve) => setTimeout(resolve, PROVIDER_STATE_LOCK_RETRY_MS));
    }
  }
}

async function saveManagedProviderState(path: string, state: ManagedProviderState): Promise<void> {
  const validated = parseManagedProviderState(state);
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: PROVIDER_STATE_DIRECTORY_MODE });
  await chmod(parent, PROVIDER_STATE_DIRECTORY_MODE);
  const release = await acquireProviderStateLock(`${path}.lock`);
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await open(temporaryPath, "wx", PROVIDER_STATE_FILE_MODE);
    try {
      await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, path);
    await chmod(path, PROVIDER_STATE_FILE_MODE);
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
    throw new Error(`Failed to save provider settings: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await release();
  }
}

class PiManagedProviderStateAccess {
  private current: ManagedProviderState = structuredClone(EMPTY_MANAGED_PROVIDER_STATE);

  constructor(private readonly path: string) {}

  private async mutate(
    transform: (current: ManagedProviderState) => ManagedProviderState,
  ): Promise<ManagedProviderState> {
    await mkdir(dirname(this.path), { recursive: true, mode: PROVIDER_STATE_DIRECTORY_MODE });
    await chmod(dirname(this.path), PROVIDER_STATE_DIRECTORY_MODE);
    const release = await acquireProviderStateLock(`${this.path}.mutation.lock`);
    try {
      const current = await loadManagedProviderState(this.path);
      const next = parseManagedProviderState(transform(current));
      await saveManagedProviderState(this.path, next);
      this.current = structuredClone(next);
      return structuredClone(next);
    } finally {
      await release();
    }
  }

  async initialize(): Promise<void> {
    this.current = await loadManagedProviderState(this.path);
  }

  snapshot(): ManagedProviderState {
    return structuredClone(this.current);
  }

  async replace(state: ManagedProviderState): Promise<void> {
    await this.mutate(() => state);
  }

  update(transform: (current: ManagedProviderState) => ManagedProviderState): Promise<ManagedProviderState> {
    return this.mutate(transform);
  }
}

export async function bindPiManagedProviderState(callerPath: string, path: string): Promise<PiManagedProviderStateAccess> {
  await assertPiManagedProviderCaller("state", callerPath);
  return new PiManagedProviderStateAccess(path);
}
