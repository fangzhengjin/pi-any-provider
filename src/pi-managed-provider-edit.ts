import type { ManagedProviderDefinition, SupportedProviderApi } from "./pi-managed-provider-contracts.js";
import { validateManagedProviderApiKey } from "./pi-managed-provider-contracts.js";
import { normalizeProviderRootUrl } from "./pi-managed-provider-routing.js";

export interface PiManagedProviderConnectionInput {
  rootUrl: string;
  apiKey: string;
  defaultApi: SupportedProviderApi | "keep";
}

export interface PiManagedProviderConnectionResult {
  provider: ManagedProviderDefinition;
  apiKey?: string;
  changed: boolean;
}

export function applyPiManagedProviderConnectionInput(
  provider: ManagedProviderDefinition,
  input: PiManagedProviderConnectionInput,
): PiManagedProviderConnectionResult {
  const rootUrl = input.rootUrl.trim() ? normalizeProviderRootUrl(input.rootUrl) : provider.rootUrl;
  const apiKey = input.apiKey ? validateManagedProviderApiKey(input.apiKey) : undefined;
  const defaultApi = input.defaultApi === "keep" ? provider.defaultApi : input.defaultApi;
  const changed = rootUrl !== provider.rootUrl || apiKey !== undefined || defaultApi !== provider.defaultApi;
  return {
    provider: { ...provider, rootUrl, defaultApi },
    ...(apiKey ? { apiKey } : {}),
    changed,
  };
}
