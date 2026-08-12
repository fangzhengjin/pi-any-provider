import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runPiManagedProvidersCommand } from "./pi-managed-provider-command.js";
import { createPiManagedProviderOrchestrator } from "./pi-managed-provider-orchestrator.js";

export default async function piCustomProviderExtension(pi: ExtensionAPI): Promise<void> {
  const orchestrator = createPiManagedProviderOrchestrator();
  await orchestrator.load(pi);

  pi.registerCommand("providers", {
    description: "Manage custom model providers",
    handler: async (_args, context) => runPiManagedProvidersCommand(pi, context, orchestrator),
  });
}
