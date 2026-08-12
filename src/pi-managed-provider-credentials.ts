import { join } from "node:path";
import {
  ModelRuntime,
  getAgentDir,
  readStoredCredential,
} from "@earendil-works/pi-coding-agent";
import { assertPiManagedProviderCaller } from "./pi-managed-provider-access.js";
import type { ManagedProviderDefinition } from "./pi-managed-provider-contracts.js";
import { buildPiManagedProviderConfig } from "./pi-managed-provider-config.js";

const PI_MANAGED_PROVIDER_AUTH_PATH = join(getAgentDir(), "auth.json");

type PiManagedProviderCredentialRollback = () => Promise<void>;

async function restoreManagedProviderCredential(
  runtime: ModelRuntime,
  providerId: string,
  previous: ReturnType<typeof readStoredCredential>,
): Promise<void> {
  if (previous?.type === "api_key" && previous.key) {
    await runtime.login(providerId, "api_key", {
      signal: new AbortController().signal,
      prompt: async () => previous.key!,
      notify: () => {},
    });
  } else if (!previous) {
    await runtime.logout(providerId);
  }
}

async function persistManagedProviderApiKey(
  provider: ManagedProviderDefinition,
  apiKey: string,
): Promise<PiManagedProviderCredentialRollback> {
  const previous = readStoredCredential(provider.id, PI_MANAGED_PROVIDER_AUTH_PATH);
  if (previous && (previous.type !== "api_key" || !previous.key)) {
    throw new Error("Provider ID already has a non-replaceable PI credential");
  }
  const runtime = await ModelRuntime.create({
    authPath: PI_MANAGED_PROVIDER_AUTH_PATH,
    modelsPath: null,
    refreshOnCreate: false,
  });
  runtime.registerProvider(provider.id, buildPiManagedProviderConfig(provider));
  await runtime.login(provider.id, "api_key", {
    signal: new AbortController().signal,
    prompt: async (prompt) => {
      if (prompt.type !== "secret") throw new Error("Unexpected credential prompt");
      return apiKey;
    },
    notify: () => {},
  });

  return async () => restoreManagedProviderCredential(runtime, provider.id, previous);
}

async function removeManagedProviderApiKey(
  provider: ManagedProviderDefinition,
): Promise<PiManagedProviderCredentialRollback> {
  const previous = readStoredCredential(provider.id, PI_MANAGED_PROVIDER_AUTH_PATH);
  if (!previous) return async () => {};
  if (previous.type !== "api_key" || !previous.key) {
    throw new Error("Provider ID has a non-removable PI credential");
  }
  const runtime = await ModelRuntime.create({
    authPath: PI_MANAGED_PROVIDER_AUTH_PATH,
    modelsPath: null,
    refreshOnCreate: false,
  });
  runtime.registerProvider(provider.id, buildPiManagedProviderConfig(provider));
  await runtime.logout(provider.id);
  return async () => restoreManagedProviderCredential(runtime, provider.id, previous);
}

class PiManagedProviderCredentialAccess {
  hasStoredCredential(providerId: string): boolean {
    return readStoredCredential(providerId, PI_MANAGED_PROVIDER_AUTH_PATH) !== undefined;
  }

  isConfigured(providerId: string): boolean {
    return readStoredCredential(providerId, PI_MANAGED_PROVIDER_AUTH_PATH)?.type === "api_key";
  }

  persistApiKey(provider: ManagedProviderDefinition, apiKey: string): Promise<PiManagedProviderCredentialRollback> {
    return persistManagedProviderApiKey(provider, apiKey);
  }

  removeApiKey(provider: ManagedProviderDefinition): Promise<PiManagedProviderCredentialRollback> {
    return removeManagedProviderApiKey(provider);
  }
}

export async function bindPiManagedProviderCredentials(callerPath: string): Promise<PiManagedProviderCredentialAccess> {
  await assertPiManagedProviderCaller("credentials", callerPath);
  return new PiManagedProviderCredentialAccess();
}
