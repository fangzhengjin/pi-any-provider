import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { ManagedProviderMessageKey } from "./pi-managed-provider-localization.js";
import type { SupportedProviderApi } from "./pi-managed-provider-contracts.js";

export const ANTHROPIC_MANAGED_PROVIDER_COMPAT_KEYS = [
  "supportsEagerToolInputStreaming",
  "supportsLongCacheRetention",
  "sendSessionAffinityHeaders",
  "supportsCacheControlOnTools",
  "supportsTemperature",
  "forceAdaptiveThinking",
  "allowEmptySignature",
  "supportsStrictTools",
  "supportsToolReferences",
] as const;

export const OPENAI_RESPONSES_MANAGED_PROVIDER_COMPAT_KEYS = [
  "supportsDeveloperRole",
  "supportsLongCacheRetention",
  "supportsStrictMode",
  "supportsOpenAIGrammarTools",
  "supportsExplicitPromptCacheMode",
  "supportsToolSearch",
] as const;

const OPENAI_RESPONSES_MANAGED_PROVIDER_CATALOG_COMPAT_KEYS = [
  "supportsDeveloperRole",
  "sessionAffinityFormat",
  "supportsLongCacheRetention",
  "supportsStrictMode",
  "supportsOpenAIGrammarTools",
  "supportsExplicitPromptCacheMode",
  "supportsToolSearch",
] as const;

export type ManagedProviderBooleanCompatKey =
  | (typeof ANTHROPIC_MANAGED_PROVIDER_COMPAT_KEYS)[number]
  | (typeof OPENAI_RESPONSES_MANAGED_PROVIDER_COMPAT_KEYS)[number];

export type ManagedProviderCompatOverrides = Partial<Record<ManagedProviderBooleanCompatKey, boolean>>;

export interface ManagedProviderBooleanOption {
  key: ManagedProviderBooleanCompatKey;
  labelKey: ManagedProviderMessageKey;
  defaultValue: boolean;
}

const ANTHROPIC_OPTIONS: readonly ManagedProviderBooleanOption[] = [
  { key: "forceAdaptiveThinking", labelKey: "adaptiveThinking", defaultValue: false },
  { key: "supportsTemperature", labelKey: "temperature", defaultValue: true },
  { key: "supportsStrictTools", labelKey: "strictJsonTools", defaultValue: false },
  { key: "supportsEagerToolInputStreaming", labelKey: "eagerToolStreaming", defaultValue: true },
  { key: "supportsLongCacheRetention", labelKey: "longCacheRetention", defaultValue: true },
  { key: "supportsCacheControlOnTools", labelKey: "toolCacheControl", defaultValue: true },
  { key: "sendSessionAffinityHeaders", labelKey: "sessionAffinityHeaders", defaultValue: false },
  { key: "allowEmptySignature", labelKey: "emptyThinkingSignature", defaultValue: false },
  { key: "supportsToolReferences", labelKey: "toolReferences", defaultValue: false },
];

const OPENAI_RESPONSES_OPTIONS: readonly ManagedProviderBooleanOption[] = [
  { key: "supportsDeveloperRole", labelKey: "developerRole", defaultValue: true },
  { key: "supportsStrictMode", labelKey: "strictJsonTools", defaultValue: false },
  { key: "supportsOpenAIGrammarTools", labelKey: "openAiGrammarTools", defaultValue: false },
  { key: "supportsLongCacheRetention", labelKey: "longCacheRetention", defaultValue: true },
  { key: "supportsExplicitPromptCacheMode", labelKey: "explicitPromptCacheMode", defaultValue: false },
  { key: "supportsToolSearch", labelKey: "toolSearch", defaultValue: false },
];

export const ALL_MANAGED_PROVIDER_COMPAT_KEYS = [...new Set([
  ...ANTHROPIC_MANAGED_PROVIDER_COMPAT_KEYS,
  ...OPENAI_RESPONSES_MANAGED_PROVIDER_COMPAT_KEYS,
])] as readonly ManagedProviderBooleanCompatKey[];

export function getManagedProviderBooleanOptions(api: SupportedProviderApi): readonly ManagedProviderBooleanOption[] {
  return api === "anthropic-messages" ? ANTHROPIC_OPTIONS : OPENAI_RESPONSES_OPTIONS;
}

export function getManagedProviderAllowedCompatKeys(api: SupportedProviderApi): readonly ManagedProviderBooleanCompatKey[] {
  return api === "anthropic-messages"
    ? ANTHROPIC_MANAGED_PROVIDER_COMPAT_KEYS
    : OPENAI_RESPONSES_MANAGED_PROVIDER_COMPAT_KEYS;
}

export function filterManagedProviderCompatForApi(
  api: SupportedProviderApi,
  compat: Record<string, unknown> | undefined,
): ProviderModelConfig["compat"] | undefined {
  if (!compat) return undefined;
  const allowed = api === "anthropic-messages"
    ? ANTHROPIC_MANAGED_PROVIDER_COMPAT_KEYS
    : OPENAI_RESPONSES_MANAGED_PROVIDER_CATALOG_COMPAT_KEYS;
  const filtered = Object.fromEntries(allowed.flatMap((key) => compat[key] === undefined ? [] : [[key, compat[key]]]));
  return Object.keys(filtered).length > 0 ? filtered as ProviderModelConfig["compat"] : undefined;
}

export function getManagedProviderInheritedBooleanValue(
  option: ManagedProviderBooleanOption,
  compat: ProviderModelConfig["compat"] | undefined,
): boolean {
  const value = (compat as Record<string, unknown> | undefined)?.[option.key];
  return typeof value === "boolean" ? value : option.defaultValue;
}

export function validateManagedProviderCompatOverrides(
  api: SupportedProviderApi,
  value: Record<string, unknown>,
): ManagedProviderCompatOverrides {
  const allowed = new Set(getManagedProviderAllowedCompatKeys(api));
  const overrides: ManagedProviderCompatOverrides = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!ALL_MANAGED_PROVIDER_COMPAT_KEYS.includes(key as ManagedProviderBooleanCompatKey)) {
      throw new Error(`Unsupported compatibility option ${key}`);
    }
    if (!allowed.has(key as ManagedProviderBooleanCompatKey)) {
      throw new Error(`Compatibility option ${key} does not apply to ${api}`);
    }
    if (typeof entry !== "boolean") throw new Error(`Compatibility option ${key} must be boolean`);
    overrides[key as ManagedProviderBooleanCompatKey] = entry;
  }
  return overrides;
}
