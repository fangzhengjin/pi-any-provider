import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ManagedProviderDefinition } from "./pi-managed-provider-contracts.js";
import { assertPiManagedProviderCaller } from "./pi-managed-provider-access.js";
import { buildPiManagedProviderConfig } from "./pi-managed-provider-config.js";

class PiManagedProviderRegistrationAccess {
  private readonly registeredProviderIds = new Set<string>();

  register(pi: ExtensionAPI, provider: ManagedProviderDefinition): void {
    pi.registerProvider(provider.id, buildPiManagedProviderConfig(provider));
    this.registeredProviderIds.add(provider.id);
  }

  replace(
    pi: ExtensionAPI,
    previous: ManagedProviderDefinition | undefined,
    next: ManagedProviderDefinition,
  ): void {
    if (previous && previous.id !== next.id) throw new Error("Provider ID cannot change during an update");
    this.register(pi, next);
  }

  unregister(pi: ExtensionAPI, providerId: string): void {
    if (!this.registeredProviderIds.has(providerId)) return;
    pi.unregisterProvider(providerId);
    this.registeredProviderIds.delete(providerId);
  }
}

export async function bindPiManagedProviderRegistration(callerPath: string): Promise<PiManagedProviderRegistrationAccess> {
  await assertPiManagedProviderCaller("registration", callerPath);
  return new PiManagedProviderRegistrationAccess();
}
