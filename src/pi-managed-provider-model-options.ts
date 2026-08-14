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
  "supportsAdditionalTools",
  "supportsExplicitPromptCacheMode",
  "supportsToolSearch",
] as const;

export const OPENAI_RESPONSES_MANAGED_PROVIDER_SESSION_AFFINITY_KEY = "sessionAffinityFormat" as const;

const OPENAI_RESPONSES_MANAGED_PROVIDER_CATALOG_COMPAT_KEYS = [
  "supportsDeveloperRole",
  "sessionAffinityFormat",
  "supportsLongCacheRetention",
  "supportsStrictMode",
  "supportsOpenAIGrammarTools",
  "supportsAdditionalTools",
  "supportsExplicitPromptCacheMode",
  "supportsToolSearch",
] as const;

export type ManagedProviderBooleanCompatKey =
  | (typeof ANTHROPIC_MANAGED_PROVIDER_COMPAT_KEYS)[number]
  | (typeof OPENAI_RESPONSES_MANAGED_PROVIDER_COMPAT_KEYS)[number];
export type ManagedProviderCompatKey =
  | ManagedProviderBooleanCompatKey
  | typeof OPENAI_RESPONSES_MANAGED_PROVIDER_SESSION_AFFINITY_KEY;
export type ManagedProviderSessionAffinityFormat = "openai" | "openai-nosession" | "openrouter";
export type ManagedProviderCompatValue = boolean | ManagedProviderSessionAffinityFormat;
export type ManagedProviderCompatOverrides = Partial<Record<ManagedProviderCompatKey, ManagedProviderCompatValue>>;

export interface ManagedProviderCompatOption {
  key: ManagedProviderCompatKey;
  labelKey: ManagedProviderMessageKey;
  descriptionKey: ManagedProviderMessageKey;
  kind: "boolean" | "session-affinity";
  defaultValue: ManagedProviderCompatValue;
}

function booleanManagedProviderOption(
  key: ManagedProviderBooleanCompatKey,
  labelKey: ManagedProviderMessageKey,
  descriptionKey: ManagedProviderMessageKey,
  defaultValue: boolean,
): ManagedProviderCompatOption {
  return { key, labelKey, descriptionKey, kind: "boolean", defaultValue };
}

const ANTHROPIC_OPTIONS: readonly ManagedProviderCompatOption[] = [
  booleanManagedProviderOption("forceAdaptiveThinking", "adaptiveThinking", "adaptiveThinkingDescription", true),
  booleanManagedProviderOption("supportsTemperature", "temperature", "temperatureDescription", true),
  booleanManagedProviderOption("supportsStrictTools", "strictJsonTools", "strictJsonToolsDescription", false),
  booleanManagedProviderOption("supportsEagerToolInputStreaming", "eagerToolStreaming", "eagerToolStreamingDescription", true),
  booleanManagedProviderOption("supportsLongCacheRetention", "longCacheRetention", "longCacheRetentionDescription", true),
  booleanManagedProviderOption("supportsCacheControlOnTools", "toolCacheControl", "toolCacheControlDescription", true),
  booleanManagedProviderOption("sendSessionAffinityHeaders", "sessionAffinityHeaders", "sessionAffinityHeadersDescription", false),
  booleanManagedProviderOption("allowEmptySignature", "emptyThinkingSignature", "emptyThinkingSignatureDescription", false),
  booleanManagedProviderOption("supportsToolReferences", "toolReferences", "toolReferencesDescription", false),
];

const OPENAI_RESPONSES_OPTIONS: readonly ManagedProviderCompatOption[] = [
  booleanManagedProviderOption("supportsDeveloperRole", "developerRole", "developerRoleDescription", true),
  {
    key: "sessionAffinityFormat",
    labelKey: "sessionAffinityFormat",
    descriptionKey: "sessionAffinityFormatDescription",
    kind: "session-affinity",
    defaultValue: "openai",
  },
  booleanManagedProviderOption("supportsStrictMode", "strictJsonTools", "strictJsonToolsDescription", false),
  booleanManagedProviderOption("supportsOpenAIGrammarTools", "openAiGrammarTools", "openAiGrammarToolsDescription", false),
  booleanManagedProviderOption("supportsAdditionalTools", "additionalTools", "additionalToolsDescription", false),
  booleanManagedProviderOption("supportsLongCacheRetention", "longCacheRetention", "longCacheRetentionDescription", true),
  booleanManagedProviderOption("supportsExplicitPromptCacheMode", "explicitPromptCacheMode", "explicitPromptCacheModeDescription", false),
  booleanManagedProviderOption("supportsToolSearch", "toolSearch", "toolSearchDescription", false),
];

export const ALL_MANAGED_PROVIDER_COMPAT_KEYS = [...new Set([
  ...ANTHROPIC_MANAGED_PROVIDER_COMPAT_KEYS,
  ...OPENAI_RESPONSES_MANAGED_PROVIDER_COMPAT_KEYS,
  OPENAI_RESPONSES_MANAGED_PROVIDER_SESSION_AFFINITY_KEY,
])] as readonly ManagedProviderCompatKey[];

export function getManagedProviderCompatOptions(api: SupportedProviderApi): readonly ManagedProviderCompatOption[] {
  return api === "anthropic-messages" ? ANTHROPIC_OPTIONS : OPENAI_RESPONSES_OPTIONS;
}

export function getManagedProviderAllowedCompatKeys(api: SupportedProviderApi): readonly ManagedProviderCompatKey[] {
  return api === "anthropic-messages"
    ? ANTHROPIC_MANAGED_PROVIDER_COMPAT_KEYS
    : [...OPENAI_RESPONSES_MANAGED_PROVIDER_COMPAT_KEYS, OPENAI_RESPONSES_MANAGED_PROVIDER_SESSION_AFFINITY_KEY];
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

function isManagedProviderSessionAffinityFormat(value: unknown): value is ManagedProviderSessionAffinityFormat {
  return value === "openai" || value === "openai-nosession" || value === "openrouter";
}

function isManagedProviderCompatOptionValue(option: ManagedProviderCompatOption, value: unknown): value is ManagedProviderCompatValue {
  return option.kind === "boolean" ? typeof value === "boolean" : isManagedProviderSessionAffinityFormat(value);
}

export function isManagedProviderCompatValueForKey(
  key: ManagedProviderCompatKey,
  value: unknown,
): value is ManagedProviderCompatValue {
  return key === "sessionAffinityFormat" ? isManagedProviderSessionAffinityFormat(value) : typeof value === "boolean";
}

export function getManagedProviderProtocolDefaultValue(
  option: ManagedProviderCompatOption,
  compat: ProviderModelConfig["compat"] | undefined,
  providerId: string,
  baseUrl: string,
): ManagedProviderCompatValue {
  const inherited = (compat as Record<string, unknown> | undefined)?.[option.key];
  if (isManagedProviderCompatOptionValue(option, inherited)) return inherited;
  if (option.key === "sessionAffinityFormat") {
    return providerId === "openrouter" || baseUrl.includes("openrouter.ai") ? "openrouter" : "openai";
  }
  return option.defaultValue;
}

export function resolveManagedProviderCompatProfile(
  api: SupportedProviderApi,
  compat: ProviderModelConfig["compat"] | undefined,
  providerId: string,
  baseUrl: string,
): ManagedProviderCompatOverrides {
  return Object.fromEntries(getManagedProviderCompatOptions(api).map((option) => [
    option.key,
    getManagedProviderProtocolDefaultValue(option, compat, providerId, baseUrl),
  ])) as ManagedProviderCompatOverrides;
}

export function validateManagedProviderCompatOverrides(
  api: SupportedProviderApi,
  value: Record<string, unknown>,
): ManagedProviderCompatOverrides {
  const allowed = new Set(getManagedProviderAllowedCompatKeys(api));
  const options = new Map(getManagedProviderCompatOptions(api).map((option) => [option.key, option]));
  const overrides: ManagedProviderCompatOverrides = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!ALL_MANAGED_PROVIDER_COMPAT_KEYS.includes(key as ManagedProviderCompatKey)) {
      throw new Error(`Unsupported compatibility option ${key}`);
    }
    if (!allowed.has(key as ManagedProviderCompatKey)) {
      throw new Error(`Compatibility option ${key} does not apply to ${api}`);
    }
    const option = options.get(key as ManagedProviderCompatKey)!;
    if (!isManagedProviderCompatOptionValue(option, entry)) {
      const expected = option.kind === "boolean" ? "boolean" : "a supported session-affinity format";
      throw new Error(`Compatibility option ${key} must be ${expected}`);
    }
    overrides[key as ManagedProviderCompatKey] = entry;
  }
  return overrides;
}
