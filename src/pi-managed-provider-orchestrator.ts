import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ProviderConfig,
} from "@earendil-works/pi-coding-agent";
import type { ManagedProviderDefinition, ManagedProviderState } from "./pi-managed-provider-contracts.js";
import {
  buildManagedProviderModel,
  buildManagedProviderModels,
  discoverManagedProviderModelIds,
} from "./pi-managed-provider-catalog.js";
import {
  ManagedProviderLocalizedError,
  type ManagedProviderLanguagePreference,
} from "./pi-managed-provider-localization.js";
import {
  type ManagedProviderCompatOverrides,
  validateManagedProviderCompatOverrides,
} from "./pi-managed-provider-model-options.js";
import {
  bindPiManagedProviderModelOverrides,
  type ManagedProviderProtocolProfileEntry,
} from "./pi-managed-provider-model-overrides.js";
import {
  resolveProviderModelApi,
  retainManagedProviderProtocolRulesForModels,
} from "./pi-managed-provider-routing.js";
import { bindPiManagedProviderCredentials } from "./pi-managed-provider-credentials.js";
import { bindPiManagedProviderRegistration } from "./pi-managed-provider-registration.js";
import { bindPiManagedProviderState } from "./pi-managed-provider-state.js";

const PI_MANAGED_PROVIDER_SETTINGS_PATH = join(getAgentDir(), "extension-settings", "pi-any-provider.json");
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

type ManagedProviderRefreshModels = NonNullable<ProviderConfig["refreshModels"]>;
type ManagedProviderRefreshContext = Parameters<ManagedProviderRefreshModels>[0];

type ManagedProviderActiveModel = { provider: string; id: string };

export interface ManagedProviderAutomaticRefreshChange {
  providerName: string;
  added: number;
  removed: number;
}

type ManagedProviderAutomaticRefreshListener = (
  change: ManagedProviderAutomaticRefreshChange,
) => void;

function hasSameManagedProviderRefreshConfiguration(
  current: ManagedProviderDefinition,
  expected: ManagedProviderDefinition,
): boolean {
  return current.id === expected.id
    && current.name === expected.name
    && current.rootUrl === expected.rootUrl
    && current.defaultApi === expected.defaultApi
    && current.modelSource.type === "discover"
    && expected.modelSource.type === "discover"
    && JSON.stringify(current.modelSource.ignoredModelIds) === JSON.stringify(expected.modelSource.ignoredModelIds)
    && JSON.stringify(current.protocolRules) === JSON.stringify(expected.protocolRules);
}

function createAutomaticallyRefreshedProvider(
  provider: ManagedProviderDefinition,
  discoveredModelIds: readonly string[],
  activeModel: ManagedProviderActiveModel | undefined,
): ManagedProviderDefinition {
  if (provider.modelSource.type !== "discover") return provider;
  const ignored = new Set(provider.modelSource.ignoredModelIds);
  const modelIds = discoveredModelIds.filter((modelId) => !ignored.has(modelId));
  if (
    activeModel?.provider === provider.id
    && provider.modelSource.modelIds.includes(activeModel.id)
    && !ignored.has(activeModel.id)
    && !modelIds.includes(activeModel.id)
  ) {
    modelIds.push(activeModel.id);
  }
  if (modelIds.length === 0) throw new ManagedProviderLocalizedError("allDiscoveredModelsIgnored");
  return {
    ...provider,
    modelSource: { ...provider.modelSource, modelIds },
    protocolRules: retainManagedProviderProtocolRulesForModels(provider.protocolRules, modelIds),
  };
}

function createManagedProviderProtocolProfileEntries(
  providers: readonly ManagedProviderDefinition[],
): ManagedProviderProtocolProfileEntry[] {
  return providers.flatMap((provider) => provider.modelSource.modelIds.map((modelId) => {
    const api = resolveProviderModelApi(modelId, provider.defaultApi, provider.protocolRules);
    const model = buildManagedProviderModel(provider, modelId);
    return {
      providerId: provider.id,
      modelId,
      api,
      defaults: validateManagedProviderCompatOverrides(
        api,
        (model.compat ?? {}) as Record<string, unknown>,
      ),
    };
  }));
}

class PiManagedProviderOrchestrator {
  private activeModel: ManagedProviderActiveModel | undefined;
  private automaticRefreshCommit: Promise<void> = Promise.resolve();
  private automaticRefreshChangeListener: ManagedProviderAutomaticRefreshListener | undefined;
  private readonly initialNetworkRefreshes = new Set<string>();

  setActiveModel(model: ManagedProviderActiveModel | undefined): void {
    this.activeModel = model ? { ...model } : undefined;
  }

  setAutomaticRefreshChangeListener(listener: ManagedProviderAutomaticRefreshListener | undefined): void {
    this.automaticRefreshChangeListener = listener;
  }

  private refreshModelsFor(provider: ManagedProviderDefinition): ManagedProviderRefreshModels | undefined {
    return provider.modelSource.type === "discover"
      ? (context) => this.refreshDiscoveredProvider(provider.id, context)
      : undefined;
  }

  private registerProvider(pi: ExtensionAPI, provider: ManagedProviderDefinition): void {
    piManagedProviderRegistration.register(pi, provider, this.refreshModelsFor(provider));
  }

  private replaceProvider(
    pi: ExtensionAPI,
    previous: ManagedProviderDefinition | undefined,
    next: ManagedProviderDefinition,
  ): void {
    piManagedProviderRegistration.replace(pi, previous, next, this.refreshModelsFor(next));
  }

  private enqueueAutomaticRefreshCommit<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.automaticRefreshCommit.then(operation, operation);
    this.automaticRefreshCommit = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private async commitAutomaticallyRefreshedProvider(
    expected: ManagedProviderDefinition,
    discoveredModelIds: readonly string[],
    notifyChange: boolean,
  ): Promise<ReturnType<typeof buildManagedProviderModels>> {
    const latest = piManagedProviderState.snapshot().providers.find((entry) => entry.id === expected.id);
    if (!latest) throw new ManagedProviderLocalizedError("unknownProvider", { provider: expected.id });
    if (!hasSameManagedProviderRefreshConfiguration(latest, expected)) {
      throw new Error(`Provider ${expected.id} changed while automatic model refresh was running`);
    }
    const activeModel = this.activeModel ? { ...this.activeModel } : undefined;
    const next = createAutomaticallyRefreshedProvider(latest, discoveredModelIds, activeModel);
    const models = buildManagedProviderModels(next, next.modelSource.modelIds);
    const previousModelIds = new Set(latest.modelSource.modelIds);
    const nextModelIds = new Set(next.modelSource.modelIds);
    const added = next.modelSource.modelIds.filter((modelId) => !previousModelIds.has(modelId)).length;
    const removed = latest.modelSource.modelIds.filter((modelId) => !nextModelIds.has(modelId)).length;
    if (JSON.stringify(next.modelSource) === JSON.stringify(latest.modelSource)
      && JSON.stringify(next.protocolRules) === JSON.stringify(latest.protocolRules)) {
      return models;
    }

    const profileWrite = await piManagedProviderModelOverrides.materialize(
      createManagedProviderProtocolProfileEntries([next]),
    );
    try {
      await piManagedProviderState.update((currentState) => {
        const current = currentState.providers.find((entry) => entry.id === expected.id);
        if (!current) throw new ManagedProviderLocalizedError("unknownProvider", { provider: expected.id });
        if (!hasSameManagedProviderRefreshConfiguration(current, expected)) {
          throw new Error(`Provider ${expected.id} changed before the automatic model refresh could be saved`);
        }
        const refreshed = createAutomaticallyRefreshedProvider(current, discoveredModelIds, activeModel);
        return {
          ...currentState,
          providers: currentState.providers.map((entry) => entry.id === expected.id ? refreshed : entry),
        };
      });
    } catch (error) {
      try {
        await profileWrite.rollback();
      } catch (rollbackError) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; model profile rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          { cause: error },
        );
      }
      throw error;
    }
    if (notifyChange && (added > 0 || removed > 0)) {
      this.automaticRefreshChangeListener?.({ providerName: next.name, added, removed });
    }
    return models;
  }

  private async refreshDiscoveredProvider(
    providerId: string,
    context: ManagedProviderRefreshContext,
  ): ReturnType<ManagedProviderRefreshModels> {
    const provider = piManagedProviderState.snapshot().providers.find((entry) => entry.id === providerId);
    if (!provider) throw new ManagedProviderLocalizedError("unknownProvider", { provider: providerId });
    if (provider.modelSource.type !== "discover" || !context.allowNetwork) {
      return buildManagedProviderModels(provider, provider.modelSource.modelIds);
    }
    const notifyChange = !this.initialNetworkRefreshes.has(providerId);
    this.initialNetworkRefreshes.add(providerId);
    if (context.credential?.type !== "api_key" || !context.credential.key) {
      throw new Error(`Automatic model refresh failed for ${providerId}: no API key is available`);
    }
    try {
      const discoveredModelIds = await discoverManagedProviderModelIds(
        provider.rootUrl,
        context.credential.key,
        context.signal,
      );
      context.signal.throwIfAborted();
      return await this.enqueueAutomaticRefreshCommit(() =>
        this.commitAutomaticallyRefreshedProvider(provider, discoveredModelIds, notifyChange)
      );
    } catch (error) {
      throw new Error(
        `Automatic model refresh failed for ${providerId}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async load(pi: ExtensionAPI): Promise<void> {
    await piManagedProviderState.initialize();
    const providers = piManagedProviderState.snapshot().providers;
    const profileWrite = await piManagedProviderModelOverrides.materialize(
      createManagedProviderProtocolProfileEntries(providers),
    );
    const registered: string[] = [];
    try {
      for (const provider of providers) {
        this.registerProvider(pi, provider);
        registered.push(provider.id);
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const providerId of registered.reverse()) {
        try {
          piManagedProviderRegistration.unregister(pi, providerId);
        } catch (rollbackError) {
          rollbackErrors.push(`provider rollback failed for ${providerId}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
        }
      }
      try {
        await profileWrite.rollback();
      } catch (rollbackError) {
        rollbackErrors.push(`model profile rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
      if (rollbackErrors.length > 0) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}; ${rollbackErrors.join("; ")}`, { cause: error });
      }
      throw error;
    }
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

    const rollbackCredential = options.apiKey
      ? await piManagedProviderCredentials.persistApiKey(provider, options.apiKey)
      : undefined;
    let profileWrite: Awaited<ReturnType<typeof piManagedProviderModelOverrides.materialize>> | undefined;
    try {
      profileWrite = await piManagedProviderModelOverrides.materialize(
        createManagedProviderProtocolProfileEntries([provider]),
      );
      this.replaceProvider(pi, current, provider);
      try {
        await piManagedProviderState.replace(nextState);
      } catch (error) {
        if (current) this.replaceProvider(pi, provider, current);
        else piManagedProviderRegistration.unregister(pi, provider.id);
        throw error;
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      try {
        await profileWrite?.rollback();
      } catch (rollbackError) {
        rollbackErrors.push(`model profile rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
      try {
        await rollbackCredential?.();
      } catch (rollbackError) {
        rollbackErrors.push(`credential rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
      if (rollbackErrors.length > 0) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}; ${rollbackErrors.join("; ")}`, { cause: error });
      }
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
        this.registerProvider(pi, existing);
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
    const discovered = await discoverManagedProviderModelIds(provider.rootUrl, apiKey, signal);
    if (provider.modelSource.type !== "discover" || provider.modelSource.ignoredModelIds.length === 0) {
      return discovered;
    }
    const ignoredModelIds = new Set(provider.modelSource.ignoredModelIds);
    const visible = discovered.filter((modelId) => !ignoredModelIds.has(modelId));
    if (visible.length === 0) throw new ManagedProviderLocalizedError("allDiscoveredModelsIgnored");
    return visible;
  }
}

export function createPiManagedProviderOrchestrator(): PiManagedProviderOrchestrator {
  return new PiManagedProviderOrchestrator();
}
