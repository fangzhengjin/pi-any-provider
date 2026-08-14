import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { ManagedProviderDefinition, SupportedProviderApi } from "./pi-managed-provider-contracts.js";
import { validateProviderModelIdentifier } from "./pi-managed-provider-contracts.js";
import { filterManagedProviderCompatForApi } from "./pi-managed-provider-model-options.js";
import {
  getProviderApiBaseUrl,
  getProviderDiscoveryUrl,
  resolveProviderModelApi,
} from "./pi-managed-provider-routing.js";

const UNKNOWN_PROVIDER_CONTEXT_WINDOW = 128_000;
const UNKNOWN_PROVIDER_MAX_TOKENS = 16_384;
const managedProviderBuiltinModelsById = new Map<string, ReturnType<typeof getBuiltinModels>[number][]>();
for (const provider of getBuiltinProviders()) {
  for (const model of getBuiltinModels(provider)) {
    const matches = managedProviderBuiltinModelsById.get(model.id) ?? [];
    matches.push(model);
    managedProviderBuiltinModelsById.set(model.id, matches);
  }
}

function findBuiltinModel(modelId: string, api: SupportedProviderApi) {
  const matches = managedProviderBuiltinModelsById.get(modelId);
  return matches?.find((model) => model.api === api) ?? matches?.[0];
}

export function buildManagedProviderModel(
  provider: ManagedProviderDefinition,
  modelIdInput: string,
): ProviderModelConfig {
  const id = validateProviderModelIdentifier(modelIdInput);
  const api = resolveProviderModelApi(id, provider.defaultApi, provider.protocolRules);
  const builtin = findBuiltinModel(id, api);
  const compat = builtin?.api === api
    ? filterManagedProviderCompatForApi(api, builtin.compat as Record<string, unknown> | undefined)
    : undefined;
  return {
    id,
    name: builtin?.name ?? id,
    api,
    baseUrl: getProviderApiBaseUrl(provider.rootUrl, api),
    reasoning: builtin?.reasoning ?? false,
    ...(builtin?.thinkingLevelMap ? { thinkingLevelMap: { ...builtin.thinkingLevelMap } } : {}),
    input: builtin?.input ? [...builtin.input] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: builtin?.contextWindow ?? UNKNOWN_PROVIDER_CONTEXT_WINDOW,
    maxTokens: builtin?.maxTokens ?? UNKNOWN_PROVIDER_MAX_TOKENS,
    ...(compat ? { compat } : {}),
  };
}

export function parseManagedProviderCatalogResponse(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Model discovery response must be an object");
  }
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new Error("Model discovery response must contain a data array");
  const ids = data.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry) || typeof (entry as { id?: unknown }).id !== "string") {
      throw new Error("Every discovered model must contain a string identifier");
    }
    return validateProviderModelIdentifier((entry as { id: string }).id);
  });
  if (ids.length === 0) throw new Error("Model discovery returned no models");
  if (new Set(ids).size !== ids.length) throw new Error("Model discovery returned duplicate model identifiers");
  return ids;
}

export async function discoverManagedProviderModelIds(
  rootUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(getProviderDiscoveryUrl(rootUrl), {
      headers: { Authorization: `Bearer ${apiKey}` },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw new Error("Model discovery cancelled");
    throw new Error(`Model discovery request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`Model discovery failed: ${response.status} ${response.statusText}`);
  }
  try {
    return parseManagedProviderCatalogResponse(await response.json());
  } catch (error) {
    throw new Error(`Invalid model discovery response: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function buildManagedProviderModels(
  provider: ManagedProviderDefinition,
  modelIds: readonly string[],
): ProviderModelConfig[] {
  return modelIds.map((id) => buildManagedProviderModel(provider, id));
}
