import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import type { ManagedProviderDefinition } from "./pi-managed-provider-contracts.js";
import { buildManagedProviderModels } from "./pi-managed-provider-catalog.js";

export function buildPiManagedProviderConfig(provider: ManagedProviderDefinition): ProviderConfig {
  return {
    name: provider.name,
    baseUrl: provider.rootUrl,
    api: provider.defaultApi,
    models: buildManagedProviderModels(provider, provider.modelSource.modelIds),
  };
}
