export const SUPPORTED_PROVIDER_APIS = ["anthropic-messages", "openai-responses"] as const;

export type SupportedProviderApi = (typeof SUPPORTED_PROVIDER_APIS)[number];

export interface ProviderProtocolRule {
  pattern: string;
  api: SupportedProviderApi;
}

export type ProviderModelSource =
  | { type: "discover"; modelIds: string[] }
  | { type: "manual"; modelIds: string[] };

export interface ManagedProviderDefinition {
  id: string;
  name: string;
  rootUrl: string;
  modelSource: ProviderModelSource;
  defaultApi: SupportedProviderApi;
  protocolRules: ProviderProtocolRule[];
}

export interface ManagedProviderState {
  version: 1;
  providers: ManagedProviderDefinition[];
}

export const EMPTY_MANAGED_PROVIDER_STATE: ManagedProviderState = {
  version: 1,
  providers: [],
};

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export function isSupportedProviderApi(value: unknown): value is SupportedProviderApi {
  return typeof value === "string" && SUPPORTED_PROVIDER_APIS.includes(value as SupportedProviderApi);
}

export function validateProviderIdentifier(value: string): string {
  const normalized = value.trim();
  if (!PROVIDER_ID_PATTERN.test(normalized)) {
    throw new Error("Provider ID must start with a letter or number and contain only letters, numbers, dot, underscore, or hyphen");
  }
  return normalized;
}

export function validateProviderDisplayName(value: string): string {
  const normalized = value.trim();
  if (!normalized || CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new Error("Provider name must be non-empty and contain no control characters");
  }
  return normalized;
}

export function createManagedProviderIdentifier(
  displayName: string,
  isUnavailable: (identifier: string) => boolean,
): string {
  const normalizedName = validateProviderDisplayName(displayName);
  const normalizedStem = normalizedName
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64)
    .replace(/-+$/gu, "");
  const stem = PROVIDER_ID_PATTERN.test(normalizedName)
    ? normalizedName
    : normalizedStem || "custom-provider";
  let identifier = stem;
  for (let suffix = 2; isUnavailable(identifier); suffix += 1) {
    identifier = `${stem}-${suffix}`;
  }
  return validateProviderIdentifier(identifier);
}

export function validateProviderModelIdentifier(value: string): string {
  const normalized = value.trim();
  if (!normalized || CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new Error("Model identifier must be non-empty and contain no control characters");
  }
  return normalized;
}

export function validateProviderProtocolPattern(value: string): string {
  const normalized = value.trim();
  if (!normalized || CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new Error("Protocol pattern must be non-empty and contain no control characters");
  }
  return normalized;
}

export function validateProviderProtocolWildcardPattern(value: string): string {
  const pattern = validateProviderProtocolPattern(value);
  if (!pattern.includes("*") && !pattern.includes("?")) {
    throw new Error("Fallback pattern must contain * or ?; choose a model for an exact setting");
  }
  return pattern;
}

export function validateManagedProviderApiKey(value: string): string {
  if (!value || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new Error("API key must be non-empty and contain no control characters");
  }
  return value;
}

export function parseManualProviderModelIds(value: string): string[] {
  const ids = value
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(validateProviderModelIdentifier);
  if (ids.length === 0) throw new Error("Enter at least one model identifier");
  const unique = new Set(ids);
  if (unique.size !== ids.length) throw new Error("Model identifiers must be unique");
  return ids;
}

export function validateManagedProviderDefinition(value: ManagedProviderDefinition): ManagedProviderDefinition {
  const id = validateProviderIdentifier(value.id);
  const name = validateProviderDisplayName(value.name);
  if (!isSupportedProviderApi(value.defaultApi)) throw new Error(`Unsupported provider protocol: ${String(value.defaultApi)}`);

  const protocolRules = value.protocolRules.map((rule) => {
    if (!isSupportedProviderApi(rule.api)) throw new Error(`Unsupported rule protocol: ${String(rule.api)}`);
    return { pattern: validateProviderProtocolPattern(rule.pattern), api: rule.api };
  });
  const patterns = protocolRules.map((rule) => rule.pattern);
  if (new Set(patterns).size !== patterns.length) throw new Error("Protocol rule patterns must be unique");

  const modelIds = parseManualProviderModelIds(value.modelSource.modelIds.join("\n"));
  const modelSource = { type: value.modelSource.type, modelIds } as ProviderModelSource;

  return {
    id,
    name,
    rootUrl: value.rootUrl,
    modelSource,
    defaultApi: value.defaultApi,
    protocolRules,
  };
}
