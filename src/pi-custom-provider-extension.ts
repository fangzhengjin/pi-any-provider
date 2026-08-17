import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runPiManagedProvidersCommand } from "./pi-managed-provider-command.js";
import {
  createManagedProviderTranslator,
  detectManagedProviderLanguage,
} from "./pi-managed-provider-localization.js";
import { createPiManagedProviderOrchestrator } from "./pi-managed-provider-orchestrator.js";

export default async function piCustomProviderExtension(pi: ExtensionAPI): Promise<void> {
  const orchestrator = createPiManagedProviderOrchestrator();
  await orchestrator.load(pi);

  pi.on("session_start", async (_event, context) => {
    orchestrator.setActiveModel(context.model);
    if (!context.hasUI) {
      orchestrator.setAutomaticRefreshChangeListener(undefined);
      return;
    }
    const language = (await detectManagedProviderLanguage(orchestrator.snapshot().language)).language;
    const translator = createManagedProviderTranslator(language);
    orchestrator.setAutomaticRefreshChangeListener((change) => {
      context.ui.notify(translator.t("automaticRefreshChanged", {
        name: change.providerName,
        added: change.added,
        removed: change.removed,
      }), "info");
    });
  });
  pi.on("session_shutdown", () => orchestrator.setAutomaticRefreshChangeListener(undefined));
  pi.on("model_select", (event) => orchestrator.setActiveModel(event.model));

  pi.registerCommand("providers", {
    description: "Manage custom model providers",
    handler: async (_args, context) => runPiManagedProvidersCommand(pi, context, orchestrator),
  });
}
