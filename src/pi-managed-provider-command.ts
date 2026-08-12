import { getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { BorderedLoader, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ManagedProviderDefinition, SupportedProviderApi } from "./pi-managed-provider-contracts.js";
import {
  parseManualProviderModelIds,
  validateManagedProviderApiKey,
  validateProviderDisplayName,
  validateProviderIdentifier,
  validateProviderProtocolPattern,
} from "./pi-managed-provider-contracts.js";
import { applyPiManagedProviderConnectionInput } from "./pi-managed-provider-edit.js";
import { normalizeProviderRootUrl } from "./pi-managed-provider-routing.js";
import {
  formatManagedProviderApi,
  promptPiManagedProviderSecret,
  selectPiManagedProviderHome,
} from "./pi-managed-provider-tui.js";

const PI_MANAGED_PROVIDER_BUILTIN_IDS = new Set<string>(getBuiltinProviders());

export interface PiManagedProviderCommandOrchestrator {
  snapshot(): { providers: ManagedProviderDefinition[] };
  hasConfiguredApiKey(providerId: string): boolean;
  saveProvider(pi: ExtensionAPI, provider: ManagedProviderDefinition, options: { apiKey?: string }): Promise<void>;
  removeProvider(pi: ExtensionAPI, providerId: string): Promise<void>;
  discoverProviderModels(
    provider: ManagedProviderDefinition,
    options: { apiKey?: string; context: ExtensionCommandContext; signal?: AbortSignal },
  ): Promise<string[]>;
}

async function chooseManagedProviderApi(
  context: ExtensionCommandContext,
  current?: SupportedProviderApi,
): Promise<SupportedProviderApi | "keep" | undefined> {
  const options = [
    ...(current ? [`Keep current · ${formatManagedProviderApi(current)}`] : []),
    formatManagedProviderApi("anthropic-messages"),
    formatManagedProviderApi("openai-responses"),
  ];
  const choice = await context.ui.select("Request protocol", options);
  if (!choice) return undefined;
  if (choice.startsWith("Keep current")) return "keep";
  return choice.startsWith("Anthropic") ? "anthropic-messages" : "openai-responses";
}

async function chooseManagedProviderModelSource(
  context: ExtensionCommandContext,
): Promise<"discover" | "manual" | undefined> {
  const choice = await context.ui.select("Model source", ["Discover from /v1/models", "Add model identifiers manually"]);
  if (!choice) return undefined;
  return choice.startsWith("Discover") ? "discover" : "manual";
}

async function collectManualManagedProviderModels(
  context: ExtensionCommandContext,
  current: readonly string[] = [],
): Promise<string[] | undefined> {
  const input = await context.ui.input(
    "Model identifiers",
    current.length > 0 ? "Comma-separated; empty keeps current list" : "Comma-separated model identifiers",
  );
  if (input === undefined) return undefined;
  if (!input.trim() && current.length > 0) return [...current];
  return parseManualProviderModelIds(input);
}

async function discoverManagedProviderModelsWithUi(
  context: ExtensionCommandContext,
  orchestrator: PiManagedProviderCommandOrchestrator,
  provider: ManagedProviderDefinition,
  apiKey?: string,
): Promise<string[] | undefined> {
  const result = await context.ui.custom<string[] | undefined>((tui, theme, _keybindings, done) => {
    const loader = new BorderedLoader(tui, theme, "Discovering models...", { cancellable: true });
    let settled = false;
    const finish = (value: string[] | undefined) => {
      if (settled) return;
      settled = true;
      done(value);
    };
    loader.onAbort = () => finish(undefined);
    void orchestrator.discoverProviderModels(provider, { context, ...(apiKey ? { apiKey } : {}), signal: loader.signal })
      .then(finish)
      .catch((error) => {
        if (!loader.signal.aborted) context.ui.notify(error instanceof Error ? error.message : String(error), "error");
        finish(undefined);
      });
    return loader;
  });
  if (result) context.ui.notify(`Discovered ${result.length} models`, "info");
  return result;
}

async function addManagedProvider(
  pi: ExtensionAPI,
  context: ExtensionCommandContext,
  orchestrator: PiManagedProviderCommandOrchestrator,
): Promise<void> {
  const nameInput = await context.ui.input("Provider name", "Display name");
  if (nameInput === undefined) return;
  const name = validateProviderDisplayName(nameInput);
  const idInput = await context.ui.input("Provider ID", "Stable ID used in PI");
  if (idInput === undefined) return;
  const id = validateProviderIdentifier(idInput);
  if (
    orchestrator.snapshot().providers.some((provider) => provider.id === id) ||
    orchestrator.hasConfiguredApiKey(id) ||
    PI_MANAGED_PROVIDER_BUILTIN_IDS.has(id) ||
    context.modelRegistry.getProvider(id)
  ) {
    throw new Error(`Provider ID already exists: ${id}`);
  }
  const rootUrlInput = await context.ui.input("API URL", "Gateway root URL, for example https://api.example.com");
  if (rootUrlInput === undefined) return;
  const rootUrl = normalizeProviderRootUrl(rootUrlInput);
  const apiKeyInput = await promptPiManagedProviderSecret(context, "API key", "Enter the provider API key");
  if (apiKeyInput === undefined) return;
  const apiKey = validateManagedProviderApiKey(apiKeyInput);
  const defaultApi = await chooseManagedProviderApi(context);
  if (!defaultApi || defaultApi === "keep") return;
  const source = await chooseManagedProviderModelSource(context);
  if (!source) return;

  let provider: ManagedProviderDefinition = {
    id,
    name,
    rootUrl,
    defaultApi,
    protocolRules: [],
    modelSource: { type: source, modelIds: [] },
  };
  const modelIds = source === "manual"
    ? await collectManualManagedProviderModels(context)
    : await discoverManagedProviderModelsWithUi(context, orchestrator, provider, apiKey);
  if (!modelIds) return;
  provider = { ...provider, modelSource: { type: source, modelIds } };
  if (await context.ui.confirm("Protocol exceptions", "Add model-specific protocol rules before saving?")) {
    const protocolRules = await collectManagedProviderProtocolRules(context, provider.protocolRules);
    if (!protocolRules) return;
    provider = { ...provider, protocolRules };
  }

  const confirmed = await context.ui.confirm(
    `Add ${provider.name}?`,
    `${provider.modelSource.modelIds.length} models · ${formatManagedProviderApi(provider.defaultApi)}`,
  );
  if (!confirmed) return;
  await orchestrator.saveProvider(pi, provider, { apiKey });
  context.ui.notify(`Added ${provider.name}`, "info");
}

async function editManagedProviderConnection(
  pi: ExtensionAPI,
  context: ExtensionCommandContext,
  orchestrator: PiManagedProviderCommandOrchestrator,
  provider: ManagedProviderDefinition,
): Promise<void> {
  const rootUrlInput = await context.ui.input("API URL", `Current: ${provider.rootUrl} · Enter keeps current`);
  if (rootUrlInput === undefined) return;
  const keyStatus = orchestrator.hasConfiguredApiKey(provider.id) ? "Configured" : "Not configured";
  const apiKeyInput = await promptPiManagedProviderSecret(context, "API key", `${keyStatus} · Enter keeps current`);
  if (apiKeyInput === undefined) return;
  const defaultApi = await chooseManagedProviderApi(context, provider.defaultApi);
  if (defaultApi === undefined) return;
  const result = applyPiManagedProviderConnectionInput(provider, {
    rootUrl: rootUrlInput,
    apiKey: apiKeyInput,
    defaultApi,
  });
  if (!result.changed) {
    context.ui.notify("No changes", "info");
    return;
  }
  let nextProvider = result.provider;
  const connectionChanged = result.provider.rootUrl !== provider.rootUrl || result.apiKey !== undefined;
  if (provider.modelSource.type === "discover" && connectionChanged) {
    const modelIds = await discoverManagedProviderModelsWithUi(context, orchestrator, result.provider, result.apiKey);
    if (!modelIds) return;
    nextProvider = { ...result.provider, modelSource: { type: "discover", modelIds } };
  }
  const confirmed = await context.ui.confirm(
    `Save ${provider.name}?`,
    `URL: ${nextProvider.rootUrl}\nProtocol: ${formatManagedProviderApi(nextProvider.defaultApi)}\nAPI key: ${result.apiKey ? "updated" : "unchanged"}`,
  );
  if (!confirmed) return;
  await orchestrator.saveProvider(pi, nextProvider, result.apiKey ? { apiKey: result.apiKey } : {});
  context.ui.notify(`Updated ${provider.name}`, "info");
}

async function manageManagedProviderModelSource(
  pi: ExtensionAPI,
  context: ExtensionCommandContext,
  orchestrator: PiManagedProviderCommandOrchestrator,
  provider: ManagedProviderDefinition,
): Promise<void> {
  const source = await chooseManagedProviderModelSource(context);
  if (!source) return;
  const modelIds = source === "manual"
    ? await collectManualManagedProviderModels(context, provider.modelSource.type === "manual" ? provider.modelSource.modelIds : [])
    : await discoverManagedProviderModelsWithUi(context, orchestrator, provider);
  if (!modelIds) return;
  await orchestrator.saveProvider(pi, { ...provider, modelSource: { type: source, modelIds } }, {});
  context.ui.notify(`Updated models for ${provider.name}`, "info");
}

async function collectManagedProviderProtocolRules(
  context: ExtensionCommandContext,
  initialRules: ManagedProviderDefinition["protocolRules"],
): Promise<ManagedProviderDefinition["protocolRules"] | undefined> {
  let rules = [...initialRules];
  for (;;) {
    const ruleLabels = rules.map((rule, index) => `${index + 1}. ${rule.pattern} → ${formatManagedProviderApi(rule.api)}`);
    const choice = await context.ui.select("Protocol exceptions", [
      "Add rule",
      ...ruleLabels,
      "Save and return",
      "Cancel",
    ]);
    if (!choice || choice === "Cancel") return undefined;
    if (choice === "Save and return") return rules;
    if (choice === "Add rule") {
      const patternInput = await context.ui.input("Model pattern", "Use * and ? wildcards");
      if (patternInput === undefined) continue;
      const pattern = validateProviderProtocolPattern(patternInput);
      if (rules.some((rule) => rule.pattern === pattern)) throw new Error(`Rule already exists: ${pattern}`);
      const api = await chooseManagedProviderApi(context);
      if (!api || api === "keep") continue;
      rules.push({ pattern, api });
      continue;
    }
    const index = ruleLabels.indexOf(choice);
    if (index < 0) continue;
    const action = await context.ui.select(choice, ["Edit", "Move up", "Move down", "Delete", "Back"]);
    if (!action || action === "Back") continue;
    if (action === "Edit") {
      const current = rules[index]!;
      const patternInput = await context.ui.input("Model pattern", `Current: ${current.pattern} · Enter keeps current`);
      if (patternInput === undefined) continue;
      const pattern = patternInput.trim() ? validateProviderProtocolPattern(patternInput) : current.pattern;
      if (rules.some((rule, ruleIndex) => ruleIndex !== index && rule.pattern === pattern)) {
        throw new Error(`Rule already exists: ${pattern}`);
      }
      const api = await chooseManagedProviderApi(context, current.api);
      if (api === undefined) continue;
      rules[index] = { pattern, api: api === "keep" ? current.api : api };
    } else if (action === "Delete") rules.splice(index, 1);
    else if (action === "Move up" && index > 0) [rules[index - 1], rules[index]] = [rules[index]!, rules[index - 1]!];
    else if (action === "Move down" && index < rules.length - 1) [rules[index], rules[index + 1]] = [rules[index + 1]!, rules[index]!];
  }
}

async function manageManagedProviderProtocolRules(
  pi: ExtensionAPI,
  context: ExtensionCommandContext,
  orchestrator: PiManagedProviderCommandOrchestrator,
  provider: ManagedProviderDefinition,
): Promise<void> {
  const rules = await collectManagedProviderProtocolRules(context, provider.protocolRules);
  if (!rules || JSON.stringify(rules) === JSON.stringify(provider.protocolRules)) return;
  await orchestrator.saveProvider(pi, { ...provider, protocolRules: rules }, {});
  context.ui.notify(`Updated protocol exceptions for ${provider.name}`, "info");
}

function requireInactiveManagedProvider(context: ExtensionCommandContext, providerId: string): void {
  if (context.model?.provider === providerId) {
    throw new Error("Switch to a model from another provider before changing this provider");
  }
}

async function manageExistingManagedProvider(
  pi: ExtensionAPI,
  context: ExtensionCommandContext,
  orchestrator: PiManagedProviderCommandOrchestrator,
  providerId: string,
): Promise<void> {
  for (;;) {
    const provider = orchestrator.snapshot().providers.find((entry) => entry.id === providerId);
    if (!provider) return;
    const choice = await context.ui.select(provider.name, [
      "Edit API URL, key, and protocol",
      "Manage model source",
      "Manage protocol exceptions",
      "Refresh discovered models",
      "Delete provider",
      "Back",
    ]);
    if (!choice || choice === "Back") return;
    requireInactiveManagedProvider(context, provider.id);
    if (choice.startsWith("Edit")) await editManagedProviderConnection(pi, context, orchestrator, provider);
    else if (choice === "Manage model source") await manageManagedProviderModelSource(pi, context, orchestrator, provider);
    else if (choice === "Manage protocol exceptions") await manageManagedProviderProtocolRules(pi, context, orchestrator, provider);
    else if (choice === "Refresh discovered models") {
      if (provider.modelSource.type !== "discover") {
        context.ui.notify("This provider uses manual models", "warning");
        continue;
      }
      const modelIds = await discoverManagedProviderModelsWithUi(context, orchestrator, provider);
      if (!modelIds) continue;
      await orchestrator.saveProvider(pi, { ...provider, modelSource: { type: "discover", modelIds } }, {});
      context.ui.notify(`Refreshed ${provider.name}`, "info");
    } else if (choice === "Delete provider") {
      const confirmed = await context.ui.confirm("Delete provider?", `${provider.name} and its stored API key will be removed`);
      if (!confirmed) continue;
      await orchestrator.removeProvider(pi, provider.id);
      context.ui.notify(`Deleted ${provider.name}`, "info");
      return;
    }
  }
}

export async function runPiManagedProvidersCommand(
  pi: ExtensionAPI,
  context: ExtensionCommandContext,
  orchestrator: PiManagedProviderCommandOrchestrator,
): Promise<void> {
  if (context.mode !== "tui") {
    context.ui.notify("/providers requires interactive TUI mode", "error");
    return;
  }
  for (;;) {
    const state = orchestrator.snapshot();
    const configuredKeys = new Set(state.providers.filter((provider) => orchestrator.hasConfiguredApiKey(provider.id)).map((provider) => provider.id));
    const choice = await selectPiManagedProviderHome(context, state.providers, configuredKeys);
    if (!choice) return;
    try {
      if (choice.type === "add") await addManagedProvider(pi, context, orchestrator);
      else await manageExistingManagedProvider(pi, context, orchestrator, choice.providerId);
    } catch (error) {
      context.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
  }
}
