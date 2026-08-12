import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { ManagedProviderDefinition, ManagedProviderState } from "./pi-managed-provider-contracts.js";
import { discoverManagedProviderModelIds } from "./pi-managed-provider-catalog.js";
import { bindPiManagedProviderCredentials } from "./pi-managed-provider-credentials.js";
import { bindPiManagedProviderRegistration } from "./pi-managed-provider-registration.js";
import { bindPiManagedProviderState } from "./pi-managed-provider-state.js";

const PI_MANAGED_PROVIDER_SETTINGS_PATH = join(getAgentDir(), "extension-settings", "pi-custom-provider.json");
const PI_MANAGED_PROVIDER_DISCOVERY_TIMEOUT_MS = 15_000;
const PI_MANAGED_PROVIDER_ORCHESTRATOR_PATH = fileURLToPath(import.meta.url);
const piManagedProviderState = await bindPiManagedProviderState(
  PI_MANAGED_PROVIDER_ORCHESTRATOR_PATH,
  PI_MANAGED_PROVIDER_SETTINGS_PATH,
);
const piManagedProviderRegistration = await bindPiManagedProviderRegistration(PI_MANAGED_PROVIDER_ORCHESTRATOR_PATH);
const piManagedProviderCredentials = await bindPiManagedProviderCredentials(PI_MANAGED_PROVIDER_ORCHESTRATOR_PATH);

class PiManagedProviderOrchestrator {
  async load(pi: ExtensionAPI): Promise<void> {
    await piManagedProviderState.initialize();
    for (const provider of piManagedProviderState.snapshot().providers) piManagedProviderRegistration.register(pi, provider);
  }

  snapshot(): ManagedProviderState {
    return piManagedProviderState.snapshot();
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
    const nextState: ManagedProviderState = { version: 1, providers: nextProviders };

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
    if (!existing) throw new Error(`Unknown provider: ${providerId}`);
    const nextState: ManagedProviderState = {
      version: 1,
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

  async discoverProviderModels(
    provider: ManagedProviderDefinition,
    options: { apiKey?: string; context: ExtensionCommandContext; signal?: AbortSignal },
  ): Promise<string[]> {
    const apiKey = options.apiKey ?? await options.context.modelRegistry.getApiKeyForProvider(provider.id);
    if (!apiKey) throw new Error("Set an API key before discovering models");
    const timeoutSignal = AbortSignal.timeout(PI_MANAGED_PROVIDER_DISCOVERY_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
    return discoverManagedProviderModelIds(provider.rootUrl, apiKey, signal);
  }
}

export function createPiManagedProviderOrchestrator(): PiManagedProviderOrchestrator {
  return new PiManagedProviderOrchestrator();
}
