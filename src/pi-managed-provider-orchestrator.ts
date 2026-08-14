import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { ManagedProviderDefinition, ManagedProviderState } from "./pi-managed-provider-contracts.js";
import { discoverManagedProviderModelIds } from "./pi-managed-provider-catalog.js";
import {
  ManagedProviderLocalizedError,
  type ManagedProviderLanguagePreference,
} from "./pi-managed-provider-localization.js";
import type { ManagedProviderCompatOverrides } from "./pi-managed-provider-model-options.js";
import { bindPiManagedProviderModelOverrides } from "./pi-managed-provider-model-overrides.js";
import { resolveProviderModelApi } from "./pi-managed-provider-routing.js";
import { bindPiManagedProviderCredentials } from "./pi-managed-provider-credentials.js";
import { bindPiManagedProviderRegistration } from "./pi-managed-provider-registration.js";
import { bindPiManagedProviderState } from "./pi-managed-provider-state.js";

const PI_MANAGED_PROVIDER_SETTINGS_PATH = join(getAgentDir(), "extension-settings", "pi-custom-provider.json");
const PI_MANAGED_PROVIDER_MODELS_PATH = join(getAgentDir(), "models.json");
const PI_MANAGED_PROVIDER_DISCOVERY_TIMEOUT_MS = 15_000;
const PI_MANAGED_PROVIDER_ORCHESTRATOR_PATH = fileURLToPath(import.meta.url);
const piManagedProviderState = await bindPiManagedProviderState(
  PI_MANAGED_PROVIDER_ORCHESTRATOR_PATH,
  PI_MANAGED_PROVIDER_SETTINGS_PATH,
);
const piManagedProviderRegistration = await bindPiManagedProviderRegistration(PI_MANAGED_PROVIDER_ORCHESTRATOR_PATH);
const piManagedProviderCredentials = await bindPiManagedProviderCredentials(PI_MANAGED_PROVIDER_ORCHESTRATOR_PATH);
const piManagedProviderModelOverrides = await bindPiManagedProviderModelOverrides(
  PI_MANAGED_PROVIDER_ORCHESTRATOR_PATH,
  PI_MANAGED_PROVIDER_MODELS_PATH,
);

class PiManagedProviderOrchestrator {
  async load(pi: ExtensionAPI): Promise<void> {
    await piManagedProviderState.initialize();
    for (const provider of piManagedProviderState.snapshot().providers) piManagedProviderRegistration.register(pi, provider);
  }

  snapshot(): ManagedProviderState {
    return piManagedProviderState.snapshot();
  }

  async setLanguage(language: ManagedProviderLanguagePreference): Promise<void> {
    const currentState = piManagedProviderState.snapshot();
    if (currentState.language === language) return;
    await piManagedProviderState.replace({ ...currentState, language });
  }

  async readModelOverrides(providerId: string, modelId: string): Promise<ManagedProviderCompatOverrides> {
    return piManagedProviderModelOverrides.read(providerId, modelId);
  }

  hasStoredCredential(providerId: string): boolean {
    return piManagedProviderCredentials.hasStoredCredential(providerId);
  }

  hasConfiguredApiKey(providerId: string): boolean {
    return piManagedProviderCredentials.isConfigured(providerId);
  }

  async saveProvider(
    pi: ExtensionAPI,
    provider: ManagedProviderDefinition,
    options: { apiKey?: string },
  ): Promise<void> {
    const currentState = piManagedProviderState.snapshot();
    const current = currentState.providers.find((entry) => entry.id === provider.id);
    const nextProviders = current
      ? currentState.providers.map((entry) => entry.id === provider.id ? provider : entry)
      : [...currentState.providers, provider];
    const nextState: ManagedProviderState = { ...currentState, providers: nextProviders };

    if (current) {
      const changedModels = provider.modelSource.modelIds.flatMap((modelId) => {
        const previousApi = current.modelSource.modelIds.includes(modelId)
          ? resolveProviderModelApi(modelId, current.defaultApi, current.protocolRules)
          : undefined;
        const nextApi = resolveProviderModelApi(modelId, provider.defaultApi, provider.protocolRules);
        return previousApi && previousApi !== nextApi ? [{ id: modelId, api: nextApi }] : [];
      });
      const incompatible = await piManagedProviderModelOverrides.findIncompatible(provider.id, changedModels);
      if (incompatible.length > 0) {
        const first = incompatible[0]!;
        throw new ManagedProviderLocalizedError("resetIncompatibleOverride", {
          option: first.key,
          model: first.modelId,
        });
      }
    }

    const rollbackCredential = options.apiKey
      ? await piManagedProviderCredentials.persistApiKey(provider, options.apiKey)
      : undefined;
    try {
      piManagedProviderRegistration.replace(pi, current, provider);
      try {
        await piManagedProviderState.replace(nextState);
      } catch (error) {
        if (current) piManagedProviderRegistration.replace(pi, provider, current);
        else piManagedProviderRegistration.unregister(pi, provider.id);
        throw error;
      }
    } catch (error) {
      await rollbackCredential?.();
      throw error;
    }
  }

  async removeProvider(pi: ExtensionAPI, providerId: string): Promise<void> {
    const currentState = piManagedProviderState.snapshot();
    const existing = currentState.providers.find((entry) => entry.id === providerId);
    if (!existing) throw new ManagedProviderLocalizedError("unknownProvider", { provider: providerId });
    const nextState: ManagedProviderState = {
      ...currentState,
      providers: currentState.providers.filter((entry) => entry.id !== providerId),
    };
    const rollbackCredential = await piManagedProviderCredentials.removeApiKey(existing);
    try {
      await piManagedProviderState.replace(nextState);
      try {
        piManagedProviderRegistration.unregister(pi, providerId);
      } catch (error) {
        await piManagedProviderState.replace(currentState);
        piManagedProviderRegistration.register(pi, existing);
        throw error;
      }
    } catch (error) {
      await rollbackCredential();
      throw error;
    }
  }

  async saveModelOverrides(
    pi: ExtensionAPI,
    context: ExtensionCommandContext,
    provider: ManagedProviderDefinition,
    modelId: string,
    overrides: ManagedProviderCompatOverrides,
  ): Promise<boolean> {
    if (!provider.modelSource.modelIds.includes(modelId)) {
      throw new ManagedProviderLocalizedError("unknownModel", { model: modelId, provider: provider.name });
    }
    const api = resolveProviderModelApi(modelId, provider.defaultApi, provider.protocolRules);
    const active = context.model?.provider === provider.id && context.model.id === modelId;
    const write = await piManagedProviderModelOverrides.replace(provider.id, modelId, api, overrides);
    if (!write.changed) return false;

    try {
      const refresh = await context.modelRegistry.refresh({ providers: [provider.id], allowNetwork: false });
      const refreshError = refresh.errors.get(provider.id) ?? context.modelRegistry.getError();
      if (refreshError) throw refreshError instanceof Error ? refreshError : new Error(String(refreshError));
      const updatedModel = context.modelRegistry.find(provider.id, modelId);
      if (!updatedModel) {
        throw new ManagedProviderLocalizedError("failedReloadModel", { provider: provider.id, model: modelId });
      }
      if (active && !(await pi.setModel(updatedModel))) {
        throw new ManagedProviderLocalizedError("failedReselectModel", { provider: provider.id, model: modelId });
      }
      return true;
    } catch (error) {
      const rollbackErrors: string[] = [];
      try {
        await write.rollback();
      } catch (rollbackError) {
        rollbackErrors.push(`file rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
      try {
        const refresh = await context.modelRegistry.refresh({ providers: [provider.id], allowNetwork: false });
        const refreshError = refresh.errors.get(provider.id) ?? context.modelRegistry.getError();
        if (refreshError) throw refreshError instanceof Error ? refreshError : new Error(String(refreshError));
        if (active) {
          const restoredModel = context.modelRegistry.find(provider.id, modelId);
          if (!restoredModel || !(await pi.setModel(restoredModel))) {
            throw new ManagedProviderLocalizedError("failedRestoreModel", { provider: provider.id, model: modelId });
          }
        }
      } catch (rollbackRefreshError) {
        rollbackErrors.push(`runtime rollback failed: ${rollbackRefreshError instanceof Error ? rollbackRefreshError.message : String(rollbackRefreshError)}`);
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new ManagedProviderLocalizedError("failedApplyModelOverrides", {
        provider: provider.id,
        model: modelId,
        reason: `${reason}${rollbackErrors.length > 0 ? `; ${rollbackErrors.join("; ")}` : ""}`,
      }, { cause: error });
    }
  }

  async discoverProviderModels(
    provider: ManagedProviderDefinition,
    options: { apiKey?: string; context: ExtensionCommandContext; signal?: AbortSignal },
  ): Promise<string[]> {
    const apiKey = options.apiKey ?? await options.context.modelRegistry.getApiKeyForProvider(provider.id);
    if (!apiKey) throw new ManagedProviderLocalizedError("setApiKeyBeforeDiscovery");
    const timeoutSignal = AbortSignal.timeout(PI_MANAGED_PROVIDER_DISCOVERY_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
    return discoverManagedProviderModelIds(provider.rootUrl, apiKey, signal);
  }
}

export function createPiManagedProviderOrchestrator(): PiManagedProviderOrchestrator {
  return new PiManagedProviderOrchestrator();
}
