import { getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { BorderedLoader, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ManagedProviderDefinition, SupportedProviderApi } from "./pi-managed-provider-contracts.js";
import {
  createManagedProviderIdentifier,
  parseManualProviderModelIds,
  validateManagedProviderApiKey,
  validateProviderDisplayName,
  validateProviderProtocolWildcardPattern,
} from "./pi-managed-provider-contracts.js";
import { applyPiManagedProviderConnectionInput } from "./pi-managed-provider-edit.js";
import {
  isProviderProtocolWildcardPattern,
  normalizeProviderRootUrl,
  retainManagedProviderProtocolRulesForModels,
} from "./pi-managed-provider-routing.js";
import {
  formatManagedProviderApi,
  promptPiManagedProviderSecret,
  selectPiManagedProviderHome,
} from "./pi-managed-provider-tui.js";

const PI_MANAGED_PROVIDER_BUILTIN_IDS = new Set<string>(getBuiltinProviders());

export interface PiManagedProviderCommandOrchestrator {
  snapshot(): { providers: ManagedProviderDefinition[] };
  hasStoredCredential(providerId: string): boolean;
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
  fallback = false,
): Promise<SupportedProviderApi | "keep" | undefined> {
  const options = [
    ...(current ? [`Keep current · ${formatManagedProviderApi(current)}`] : []),
    formatManagedProviderApi("anthropic-messages"),
    formatManagedProviderApi("openai-responses"),
  ];
  const choice = await context.ui.select(
    fallback ? "Default protocol · fallback when no model rule matches" : "Request protocol",
    options,
  );
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
  const nameInput = await context.ui.input("Provider name", "For example: Work Gateway");
  if (nameInput === undefined) return;
  const name = validateProviderDisplayName(nameInput);
  const configuredProviderIds = new Set(orchestrator.snapshot().providers.map((provider) => provider.id));
  const id = createManagedProviderIdentifier(name, (candidate) =>
    configuredProviderIds.has(candidate) ||
    orchestrator.hasStoredCredential(candidate) ||
    PI_MANAGED_PROVIDER_BUILTIN_IDS.has(candidate) ||
    context.modelRegistry.getProvider(candidate) !== undefined
  );
  const rootUrlInput = await context.ui.input("API URL", "Gateway root URL, for example https://api.example.com");
  if (rootUrlInput === undefined) return;
  const rootUrl = normalizeProviderRootUrl(rootUrlInput);
  const apiKeyInput = await promptPiManagedProviderSecret(context, "API key", "Enter the provider API key");
  if (apiKeyInput === undefined) return;
  const apiKey = validateManagedProviderApiKey(apiKeyInput);
  const defaultApi = await chooseManagedProviderApi(context, undefined, true);
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
  if (await context.ui.confirm("Protocol routing", "Add exact model settings or wildcard fallbacks before saving?")) {
    const protocolRules = await collectManagedProviderProtocolRules(
      context,
      provider.modelSource.modelIds,
      provider.protocolRules,
    );
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

export async function saveManagedProviderAndRestoreActiveModel(
  pi: ExtensionAPI,
  context: ExtensionCommandContext,
  orchestrator: PiManagedProviderCommandOrchestrator,
  previousProvider: ManagedProviderDefinition,
  nextProvider: ManagedProviderDefinition,
  options: { apiKey?: string },
): Promise<void> {
  const activeModelId = context.model?.provider === previousProvider.id ? context.model.id : undefined;
  if (activeModelId && !nextProvider.modelSource.modelIds.includes(activeModelId)) {
    throw new Error(`Keep the active model ${activeModelId} in this provider, or switch models before removing it`);
  }
  await orchestrator.saveProvider(pi, nextProvider, options);
  if (!activeModelId) return;
  const refreshedModel = context.modelRegistry.find(nextProvider.id, activeModelId);
  if (!refreshedModel) {
    throw new Error(`Updated ${nextProvider.name}, but PI could not reload the active model ${activeModelId}`);
  }
  if (!(await pi.setModel(refreshedModel))) {
    throw new Error(`Updated ${nextProvider.name}, but PI could not reselect the active model ${activeModelId}`);
  }
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
  const defaultApi = await chooseManagedProviderApi(context, provider.defaultApi, true);
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
  await saveManagedProviderAndRestoreActiveModel(
    pi,
    context,
    orchestrator,
    provider,
    nextProvider,
    result.apiKey ? { apiKey: result.apiKey } : {},
  );
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
  await saveManagedProviderAndRestoreActiveModel(
    pi,
    context,
    orchestrator,
    provider,
    {
      ...provider,
      modelSource: { type: source, modelIds },
      protocolRules: retainManagedProviderProtocolRulesForModels(provider.protocolRules, modelIds),
    },
    {},
  );
  context.ui.notify(`Updated models for ${provider.name}`, "info");
}

async function collectManagedProviderProtocolRules(
  context: ExtensionCommandContext,
  modelIds: readonly string[],
  initialRules: ManagedProviderDefinition["protocolRules"],
): Promise<ManagedProviderDefinition["protocolRules"] | undefined> {
  let exactRules = initialRules.filter(
    (rule) => !isProviderProtocolWildcardPattern(rule.pattern) && modelIds.includes(rule.pattern),
  );
  let wildcardRules = initialRules.filter((rule) => isProviderProtocolWildcardPattern(rule.pattern));
  for (;;) {
    const exactLabels = exactRules.map((rule) => `Model · ${rule.pattern} → ${formatManagedProviderApi(rule.api)}`);
    const wildcardLabels = wildcardRules.map((rule, index) => `Fallback ${index + 1} · ${rule.pattern} → ${formatManagedProviderApi(rule.api)}`);
    const choice = await context.ui.select("Protocol routing · model → fallback pattern → default", [
      "Set protocol for a model",
      ...exactLabels,
      "Add fallback pattern",
      ...wildcardLabels,
      "Save and return",
      "Cancel",
    ]);
    if (!choice || choice === "Cancel") return undefined;
    if (choice === "Save and return") return [...exactRules, ...wildcardRules];
    if (choice === "Set protocol for a model") {
      const available = modelIds.filter((modelId) => !exactRules.some((rule) => rule.pattern === modelId));
      if (available.length === 0) {
        context.ui.notify("Every model already has an exact protocol setting", "warning");
        continue;
      }
      const modelId = await context.ui.select("Model", [...available]);
      if (!modelId) continue;
      const api = await chooseManagedProviderApi(context);
      if (!api || api === "keep") continue;
      exactRules.push({ pattern: modelId, api });
      continue;
    }
    if (choice === "Add fallback pattern") {
      const input = await context.ui.input("Fallback model pattern", "Must contain * or ?");
      if (input === undefined) continue;
      const pattern = validateProviderProtocolWildcardPattern(input);
      if ([...exactRules, ...wildcardRules].some((rule) => rule.pattern === pattern)) throw new Error(`Rule already exists: ${pattern}`);
      const api = await chooseManagedProviderApi(context);
      if (!api || api === "keep") continue;
      wildcardRules.push({ pattern, api });
      continue;
    }
    const exactIndex = exactLabels.indexOf(choice);
    if (exactIndex >= 0) {
      const action = await context.ui.select(choice, ["Change protocol", "Delete", "Back"]);
      if (action === "Change protocol") {
        const current = exactRules[exactIndex]!;
        const api = await chooseManagedProviderApi(context, current.api);
        if (api !== undefined) exactRules[exactIndex] = { ...current, api: api === "keep" ? current.api : api };
      } else if (action === "Delete") exactRules.splice(exactIndex, 1);
      continue;
    }
    const wildcardIndex = wildcardLabels.indexOf(choice);
    if (wildcardIndex < 0) continue;
    const action = await context.ui.select(choice, ["Edit", "Move up", "Move down", "Delete", "Back"]);
    if (!action || action === "Back") continue;
    if (action === "Edit") {
      const current = wildcardRules[wildcardIndex]!;
      const input = await context.ui.input("Fallback model pattern", `Current: ${current.pattern} · Enter keeps current`);
      if (input === undefined) continue;
      const pattern = input.trim() ? validateProviderProtocolWildcardPattern(input) : current.pattern;
      if ([...exactRules, ...wildcardRules].some((rule) => rule !== current && rule.pattern === pattern)) {
        throw new Error(`Rule already exists: ${pattern}`);
      }
      const api = await chooseManagedProviderApi(context, current.api);
      if (api !== undefined) wildcardRules[wildcardIndex] = { pattern, api: api === "keep" ? current.api : api };
    } else if (action === "Delete") wildcardRules.splice(wildcardIndex, 1);
    else if (action === "Move up" && wildcardIndex > 0) {
      [wildcardRules[wildcardIndex - 1], wildcardRules[wildcardIndex]] = [wildcardRules[wildcardIndex]!, wildcardRules[wildcardIndex - 1]!];
    } else if (action === "Move down" && wildcardIndex < wildcardRules.length - 1) {
      [wildcardRules[wildcardIndex], wildcardRules[wildcardIndex + 1]] = [wildcardRules[wildcardIndex + 1]!, wildcardRules[wildcardIndex]!];
    }
  }
}

async function manageManagedProviderProtocolRules(
  pi: ExtensionAPI,
  context: ExtensionCommandContext,
  orchestrator: PiManagedProviderCommandOrchestrator,
  provider: ManagedProviderDefinition,
): Promise<void> {
  const rules = await collectManagedProviderProtocolRules(
    context,
    provider.modelSource.modelIds,
    provider.protocolRules,
  );
  if (!rules || JSON.stringify(rules) === JSON.stringify(provider.protocolRules)) return;
  await saveManagedProviderAndRestoreActiveModel(
    pi,
    context,
    orchestrator,
    provider,
    { ...provider, protocolRules: rules },
    {},
  );
  context.ui.notify(`Updated protocol routing for ${provider.name}`, "info");
}

function requireRemovableManagedProvider(context: ExtensionCommandContext, provider: ManagedProviderDefinition): void {
  if (context.model?.provider === provider.id) {
    throw new Error(`Cannot delete ${provider.name} while ${context.model.id} is active; switch to another provider first`);
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
      "Manage protocol routing",
      "Refresh discovered models",
      "Delete provider",
      "Back",
    ]);
    if (!choice || choice === "Back") return;
    if (choice.startsWith("Edit")) await editManagedProviderConnection(pi, context, orchestrator, provider);
    else if (choice === "Manage model source") await manageManagedProviderModelSource(pi, context, orchestrator, provider);
    else if (choice === "Manage protocol routing") await manageManagedProviderProtocolRules(pi, context, orchestrator, provider);
    else if (choice === "Refresh discovered models") {
      if (provider.modelSource.type !== "discover") {
        context.ui.notify("This provider uses manual models", "warning");
        continue;
      }
      const modelIds = await discoverManagedProviderModelsWithUi(context, orchestrator, provider);
      if (!modelIds) continue;
      await saveManagedProviderAndRestoreActiveModel(
        pi,
        context,
        orchestrator,
        provider,
        {
          ...provider,
          modelSource: { type: "discover", modelIds },
          protocolRules: retainManagedProviderProtocolRulesForModels(provider.protocolRules, modelIds),
        },
        {},
      );
      context.ui.notify(`Refreshed ${provider.name}`, "info");
    } else if (choice === "Delete provider") {
      requireRemovableManagedProvider(context, provider);
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
