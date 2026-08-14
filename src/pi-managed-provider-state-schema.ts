import type {
  ManagedProviderDefinition,
  ManagedProviderState,
  ProviderModelSource,
  ProviderProtocolRule,
} from "./pi-managed-provider-contracts.js";
import {
  isSupportedProviderApi,
  validateManagedProviderDefinition,
} from "./pi-managed-provider-contracts.js";
import { isManagedProviderLanguagePreference } from "./pi-managed-provider-localization.js";
import { normalizeProviderRootUrl } from "./pi-managed-provider-routing.js";

function requireManagedProviderStateObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownManagedProviderStateKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${label} contains unsupported setting: ${unknown.join(", ")}`);
}

function parseManagedProviderModelSource(value: unknown): ProviderModelSource {
  const source = requireManagedProviderStateObject(value, "Model source");
  if (source.type === "discover") {
    rejectUnknownManagedProviderStateKeys(source, ["type", "modelIds", "ignoredModelIds"], "Model source");
    if (!Array.isArray(source.modelIds) || !source.modelIds.every((entry) => typeof entry === "string")) {
      throw new Error("Model source must contain string model identifiers");
    }
    const ignoredModelIds = source.ignoredModelIds ?? [];
    if (!Array.isArray(ignoredModelIds) || !ignoredModelIds.every((entry) => typeof entry === "string")) {
      throw new Error("Ignored models must contain string model identifiers");
    }
    return { type: "discover", modelIds: source.modelIds, ignoredModelIds };
  }
  if (source.type === "manual") {
    rejectUnknownManagedProviderStateKeys(source, ["type", "modelIds"], "Model source");
    if (!Array.isArray(source.modelIds) || !source.modelIds.every((entry) => typeof entry === "string")) {
      throw new Error("Model source must contain string model identifiers");
    }
    return { type: "manual", modelIds: source.modelIds };
  }
  throw new Error("Model source must be discover or manual");
}

function parseManagedProviderProtocolRules(value: unknown): ProviderProtocolRule[] {
  if (!Array.isArray(value)) throw new Error("Protocol rules must be an array");
  return value.map((entry) => {
    const rule = requireManagedProviderStateObject(entry, "Protocol rule");
    rejectUnknownManagedProviderStateKeys(rule, ["pattern", "api"], "Protocol rule");
    if (typeof rule.pattern !== "string" || !isSupportedProviderApi(rule.api)) {
      throw new Error("Protocol rule must contain a pattern and supported protocol");
    }
    return { pattern: rule.pattern, api: rule.api };
  });
}

function parseManagedProviderDefinition(value: unknown): ManagedProviderDefinition {
  const provider = requireManagedProviderStateObject(value, "Provider");
  rejectUnknownManagedProviderStateKeys(
    provider,
    ["id", "name", "rootUrl", "modelSource", "defaultApi", "protocolRules"],
    "Provider",
  );
  if (
    typeof provider.id !== "string" ||
    typeof provider.name !== "string" ||
    typeof provider.rootUrl !== "string" ||
    !isSupportedProviderApi(provider.defaultApi)
  ) {
    throw new Error("Provider contains invalid required settings");
  }
  return validateManagedProviderDefinition({
    id: provider.id,
    name: provider.name,
    rootUrl: normalizeProviderRootUrl(provider.rootUrl),
    modelSource: parseManagedProviderModelSource(provider.modelSource),
    defaultApi: provider.defaultApi,
    protocolRules: parseManagedProviderProtocolRules(provider.protocolRules),
  });
}

export function parseManagedProviderState(value: unknown): ManagedProviderState {
  const state = requireManagedProviderStateObject(value, "Provider state");
  rejectUnknownManagedProviderStateKeys(state, ["version", "language", "providers"], "Provider state");
  if (state.version !== 1) throw new Error("Unsupported provider state version");
  const language = state.language === undefined ? "auto" : state.language;
  if (!isManagedProviderLanguagePreference(language)) throw new Error("Provider state contains an unsupported language");
  if (!Array.isArray(state.providers)) throw new Error("Provider state must contain a provider list");
  const providers = state.providers.map(parseManagedProviderDefinition);
  const ids = providers.map((provider) => provider.id);
  if (new Set(ids).size !== ids.length) throw new Error("Provider identifiers must be unique");
  return { version: 1, language, providers };
}
