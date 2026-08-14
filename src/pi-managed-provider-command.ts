import { getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { BorderedLoader, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { buildManagedProviderModel } from "./pi-managed-provider-catalog.js";
import type { ManagedProviderDefinition, ManagedProviderState, SupportedProviderApi } from "./pi-managed-provider-contracts.js";
import {
  createManagedProviderIdentifier,
  parseManualProviderModelIds,
  validateManagedProviderApiKey,
  validateProviderDisplayName,
  validateProviderProtocolWildcardPattern,
} from "./pi-managed-provider-contracts.js";
import { applyPiManagedProviderConnectionInput } from "./pi-managed-provider-edit.js";
import {
  createManagedProviderTranslator,
  detectManagedProviderLanguage,
  formatManagedProviderError,
  managedProviderLanguageName,
  managedProviderLanguageSourceLabel,
  ManagedProviderLocalizedError,
  type ManagedProviderLanguageDetection,
  type ManagedProviderLanguagePreference,
  type ManagedProviderTranslator,
} from "./pi-managed-provider-localization.js";
import {
  getManagedProviderBooleanOptions,
  getManagedProviderInheritedBooleanValue,
  type ManagedProviderCompatOverrides,
} from "./pi-managed-provider-model-options.js";
import {
  isProviderProtocolWildcardPattern,
  normalizeProviderRootUrl,
  resolveProviderModelApi,
  retainManagedProviderProtocolRulesForModels,
} from "./pi-managed-provider-routing.js";
import {
  formatManagedProviderApi,
  promptPiManagedProviderSecret,
  selectPiManagedProviderHome,
} from "./pi-managed-provider-tui.js";

const PI_MANAGED_PROVIDER_BUILTIN_IDS = new Set<string>(getBuiltinProviders());

export interface PiManagedProviderCommandOrchestrator {
  snapshot(): ManagedProviderState;
  setLanguage(language: ManagedProviderLanguagePreference): Promise<void>;
  readModelOverrides(providerId: string, modelId: string): Promise<ManagedProviderCompatOverrides>;
  saveModelOverrides(
    pi: ExtensionAPI,
    context: ExtensionCommandContext,
    provider: ManagedProviderDefinition,
    modelId: string,
    overrides: ManagedProviderCompatOverrides,
  ): Promise<boolean>;
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
  translator: ManagedProviderTranslator,
  current?: SupportedProviderApi,
  fallback = false,
): Promise<SupportedProviderApi | "keep" | undefined> {
  const anthropic = formatManagedProviderApi("anthropic-messages");
  const responses = formatManagedProviderApi("openai-responses");
  const keep = current ? translator.t("keepCurrent", { value: formatManagedProviderApi(current) }) : undefined;
  const choice = await context.ui.select(
    translator.t(fallback ? "defaultProtocolTitle" : "requestProtocolTitle"),
    [...(keep ? [keep] : []), anthropic, responses],
  );
  if (!choice) return undefined;
  if (choice === keep) return "keep";
  return choice === anthropic ? "anthropic-messages" : "openai-responses";
}

async function chooseManagedProviderModelSource(
  context: ExtensionCommandContext,
  translator: ManagedProviderTranslator,
): Promise<"discover" | "manual" | undefined> {
  const discover = translator.t("discoverModelsSource");
  const manual = translator.t("manualModelsSource");
  const choice = await context.ui.select(translator.t("modelSourceTitle"), [discover, manual]);
  if (!choice) return undefined;
  return choice === discover ? "discover" : "manual";
}

async function collectManualManagedProviderModels(
  context: ExtensionCommandContext,
  translator: ManagedProviderTranslator,
  current: readonly string[] = [],
): Promise<string[] | undefined> {
  const input = await context.ui.input(
    translator.t("modelIdentifiersTitle"),
    translator.t(current.length > 0 ? "modelIdentifiersKeepHint" : "modelIdentifiersHint"),
  );
  if (input === undefined) return undefined;
  if (!input.trim() && current.length > 0) return [...current];
  return parseManualProviderModelIds(input);
}

async function discoverManagedProviderModelsWithUi(
  context: ExtensionCommandContext,
  translator: ManagedProviderTranslator,
  orchestrator: PiManagedProviderCommandOrchestrator,
  provider: ManagedProviderDefinition,
  apiKey?: string,
): Promise<string[] | undefined> {
  const result = await context.ui.custom<string[] | undefined>((tui, theme, _keybindings, done) => {
    const loader = new BorderedLoader(tui, theme, translator.t("discoveringModels"), { cancellable: true });
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
        if (!loader.signal.aborted) context.ui.notify(formatManagedProviderError(error, translator), "error");
        finish(undefined);
      });
    return loader;
  });
  if (result) context.ui.notify(translator.t("discoveredModels", { count: result.length }), "info");
  return result;
}

async function addManagedProvider(
  pi: ExtensionAPI,
  context: ExtensionCommandContext,
  translator: ManagedProviderTranslator,
  orchestrator: PiManagedProviderCommandOrchestrator,
): Promise<void> {
  const nameInput = await context.ui.input(translator.t("providerNameTitle"), translator.t("providerNameHint"));
  if (nameInput === undefined) return;
  const name = validateProviderDisplayName(nameInput);
  const configuredProviderIds = new Set(orchestrator.snapshot().providers.map((provider) => provider.id));
  const id = createManagedProviderIdentifier(name, (candidate) =>
    configuredProviderIds.has(candidate) ||
    orchestrator.hasStoredCredential(candidate) ||
    PI_MANAGED_PROVIDER_BUILTIN_IDS.has(candidate) ||
    context.modelRegistry.getProvider(candidate) !== undefined
  );
  const rootUrlInput = await context.ui.input(translator.t("apiUrlTitle"), translator.t("apiUrlHint"));
  if (rootUrlInput === undefined) return;
  const rootUrl = normalizeProviderRootUrl(rootUrlInput);
  const apiKeyInput = await promptPiManagedProviderSecret(
    context,
    translator,
    translator.t("apiKeyTitle"),
    translator.t("apiKeyHint"),
  );
  if (apiKeyInput === undefined) return;
  const apiKey = validateManagedProviderApiKey(apiKeyInput);
  const defaultApi = await chooseManagedProviderApi(context, translator, undefined, true);
  if (!defaultApi || defaultApi === "keep") return;
  const source = await chooseManagedProviderModelSource(context, translator);
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
    ? await collectManualManagedProviderModels(context, translator)
    : await discoverManagedProviderModelsWithUi(context, translator, orchestrator, provider, apiKey);
  if (!modelIds) return;
  provider = { ...provider, modelSource: { type: source, modelIds } };
  if (await context.ui.confirm(translator.t("protocolRoutingTitle"), translator.t("protocolRoutingBeforeSave"))) {
    const protocolRules = await collectManagedProviderProtocolRules(
      context,
      translator,
      provider.modelSource.modelIds,
      provider.protocolRules,
    );
    if (!protocolRules) return;
    provider = { ...provider, protocolRules };
  }

  const confirmed = await context.ui.confirm(
    translator.t("addProviderConfirm", { name: provider.name }),
    translator.t("addProviderSummary", {
      count: provider.modelSource.modelIds.length,
      protocol: formatManagedProviderApi(provider.defaultApi),
    }),
  );
  if (!confirmed) return;
  await orchestrator.saveProvider(pi, provider, { apiKey });
  context.ui.notify(translator.t("addedProvider", { name: provider.name }), "info");
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
    throw new ManagedProviderLocalizedError("activeModelMustRemain", { model: activeModelId });
  }
  await orchestrator.saveProvider(pi, nextProvider, options);
  if (!activeModelId) return;
  const refreshedModel = context.modelRegistry.find(nextProvider.id, activeModelId);
  if (!refreshedModel) {
    throw new ManagedProviderLocalizedError("failedReloadActiveModel", {
      provider: nextProvider.name,
      model: activeModelId,
    });
  }
  if (!(await pi.setModel(refreshedModel))) {
    throw new ManagedProviderLocalizedError("failedReselectActiveModel", {
      provider: nextProvider.name,
      model: activeModelId,
    });
  }
}

async function editManagedProviderConnection(
  pi: ExtensionAPI,
  context: ExtensionCommandContext,
  translator: ManagedProviderTranslator,
  orchestrator: PiManagedProviderCommandOrchestrator,
  provider: ManagedProviderDefinition,
): Promise<void> {
  const rootUrlInput = await context.ui.input(
    translator.t("apiUrlTitle"),
    translator.t("currentValueKeepHint", { value: provider.rootUrl }),
  );
  if (rootUrlInput === undefined) return;
  const keyStatus = translator.t(orchestrator.hasConfiguredApiKey(provider.id) ? "configured" : "notConfigured");
  const apiKeyInput = await promptPiManagedProviderSecret(
    context,
    translator,
    translator.t("apiKeyTitle"),
    translator.t("currentValueKeepHint", { value: keyStatus }),
  );
  if (apiKeyInput === undefined) return;
  const defaultApi = await chooseManagedProviderApi(context, translator, provider.defaultApi, true);
  if (defaultApi === undefined) return;
  const result = applyPiManagedProviderConnectionInput(provider, {
    rootUrl: rootUrlInput,
    apiKey: apiKeyInput,
    defaultApi,
  });
  if (!result.changed) {
    context.ui.notify(translator.t("noChanges"), "info");
    return;
  }
  let nextProvider = result.provider;
  const connectionChanged = result.provider.rootUrl !== provider.rootUrl || result.apiKey !== undefined;
  if (provider.modelSource.type === "discover" && connectionChanged) {
    const modelIds = await discoverManagedProviderModelsWithUi(context, translator, orchestrator, result.provider, result.apiKey);
    if (!modelIds) return;
    nextProvider = { ...result.provider, modelSource: { type: "discover", modelIds } };
  }
  const confirmed = await context.ui.confirm(
    translator.t("saveProviderConfirm", { name: provider.name }),
    translator.t("saveProviderSummary", {
      url: nextProvider.rootUrl,
      protocol: formatManagedProviderApi(nextProvider.defaultApi),
      keyChange: translator.t(result.apiKey ? "updated" : "unchanged"),
    }),
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
  context.ui.notify(translator.t("updatedProvider", { name: provider.name }), "info");
}

async function manageManagedProviderModelSource(
  pi: ExtensionAPI,
  context: ExtensionCommandContext,
  translator: ManagedProviderTranslator,
  orchestrator: PiManagedProviderCommandOrchestrator,
  provider: ManagedProviderDefinition,
): Promise<void> {
  const source = await chooseManagedProviderModelSource(context, translator);
  if (!source) return;
  const modelIds = source === "manual"
    ? await collectManualManagedProviderModels(
      context,
      translator,
      provider.modelSource.type === "manual" ? provider.modelSource.modelIds : [],
    )
    : await discoverManagedProviderModelsWithUi(context, translator, orchestrator, provider);
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
  context.ui.notify(translator.t("updatedModels", { name: provider.name }), "info");
}

async function collectManagedProviderProtocolRules(
  context: ExtensionCommandContext,
  translator: ManagedProviderTranslator,
  modelIds: readonly string[],
  initialRules: ManagedProviderDefinition["protocolRules"],
): Promise<ManagedProviderDefinition["protocolRules"] | undefined> {
  let exactRules = initialRules.filter(
    (rule) => !isProviderProtocolWildcardPattern(rule.pattern) && modelIds.includes(rule.pattern),
  );
  let wildcardRules = initialRules.filter((rule) => isProviderProtocolWildcardPattern(rule.pattern));
  for (;;) {
    const exactLabels = exactRules.map((rule) => translator.t("exactRuleLabel", {
      pattern: rule.pattern,
      protocol: formatManagedProviderApi(rule.api),
    }));
    const wildcardLabels = wildcardRules.map((rule, index) => translator.t("fallbackRuleLabel", {
      index: index + 1,
      pattern: rule.pattern,
      protocol: formatManagedProviderApi(rule.api),
    }));
    const setModel = translator.t("setProtocolForModel");
    const addFallback = translator.t("addFallbackPattern");
    const save = translator.t("saveAndReturn");
    const cancel = translator.t("cancel");
    const choice = await context.ui.select(translator.t("routingManagerTitle"), [
      setModel, ...exactLabels, addFallback, ...wildcardLabels, save, cancel,
    ]);
    if (!choice || choice === cancel) return undefined;
    if (choice === save) return [...exactRules, ...wildcardRules];
    if (choice === setModel) {
      const available = modelIds.filter((modelId) => !exactRules.some((rule) => rule.pattern === modelId));
      if (available.length === 0) {
        context.ui.notify(translator.t("everyModelConfigured"), "warning");
        continue;
      }
      const modelId = await context.ui.select(translator.t("modelTitle"), [...available]);
      if (!modelId) continue;
      const api = await chooseManagedProviderApi(context, translator);
      if (!api || api === "keep") continue;
      exactRules.push({ pattern: modelId, api });
      continue;
    }
    if (choice === addFallback) {
      const input = await context.ui.input(translator.t("fallbackPatternTitle"), translator.t("fallbackPatternHint"));
      if (input === undefined) continue;
      const pattern = validateProviderProtocolWildcardPattern(input);
      if ([...exactRules, ...wildcardRules].some((rule) => rule.pattern === pattern)) {
        throw new ManagedProviderLocalizedError("ruleAlreadyExists", { pattern });
      }
      const api = await chooseManagedProviderApi(context, translator);
      if (!api || api === "keep") continue;
      wildcardRules.push({ pattern, api });
      continue;
    }
    const exactIndex = exactLabels.indexOf(choice);
    if (exactIndex >= 0) {
      const changeProtocol = translator.t("changeProtocol");
      const deleteRule = translator.t("delete");
      const action = await context.ui.select(choice, [changeProtocol, deleteRule, translator.t("back")]);
      if (action === changeProtocol) {
        const current = exactRules[exactIndex]!;
        const api = await chooseManagedProviderApi(context, translator, current.api);
        if (api !== undefined) exactRules[exactIndex] = { ...current, api: api === "keep" ? current.api : api };
      } else if (action === deleteRule) exactRules.splice(exactIndex, 1);
      continue;
    }
    const wildcardIndex = wildcardLabels.indexOf(choice);
    if (wildcardIndex < 0) continue;
    const editRule = translator.t("edit");
    const moveUp = translator.t("moveUp");
    const moveDown = translator.t("moveDown");
    const deleteRule = translator.t("delete");
    const back = translator.t("back");
    const action = await context.ui.select(choice, [editRule, moveUp, moveDown, deleteRule, back]);
    if (!action || action === back) continue;
    if (action === editRule) {
      const current = wildcardRules[wildcardIndex]!;
      const input = await context.ui.input(
        translator.t("fallbackPatternTitle"),
        translator.t("currentValueKeepHint", { value: current.pattern }),
      );
      if (input === undefined) continue;
      const pattern = input.trim() ? validateProviderProtocolWildcardPattern(input) : current.pattern;
      if ([...exactRules, ...wildcardRules].some((rule) => rule !== current && rule.pattern === pattern)) {
        throw new ManagedProviderLocalizedError("ruleAlreadyExists", { pattern });
      }
      const api = await chooseManagedProviderApi(context, translator, current.api);
      if (api !== undefined) wildcardRules[wildcardIndex] = { pattern, api: api === "keep" ? current.api : api };
    } else if (action === deleteRule) wildcardRules.splice(wildcardIndex, 1);
    else if (action === moveUp && wildcardIndex > 0) {
      [wildcardRules[wildcardIndex - 1], wildcardRules[wildcardIndex]] = [wildcardRules[wildcardIndex]!, wildcardRules[wildcardIndex - 1]!];
    } else if (action === moveDown && wildcardIndex < wildcardRules.length - 1) {
      [wildcardRules[wildcardIndex], wildcardRules[wildcardIndex + 1]] = [wildcardRules[wildcardIndex + 1]!, wildcardRules[wildcardIndex]!];
    }
  }
}

async function manageManagedProviderProtocolRules(
  pi: ExtensionAPI,
  context: ExtensionCommandContext,
  translator: ManagedProviderTranslator,
  orchestrator: PiManagedProviderCommandOrchestrator,
  provider: ManagedProviderDefinition,
): Promise<void> {
  const rules = await collectManagedProviderProtocolRules(
    context,
    translator,
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
  context.ui.notify(translator.t("updatedRouting", { name: provider.name }), "info");
}

async function manageManagedProviderModelOverrides(
  pi: ExtensionAPI,
  context: ExtensionCommandContext,
  translator: ManagedProviderTranslator,
  orchestrator: PiManagedProviderCommandOrchestrator,
  provider: ManagedProviderDefinition,
): Promise<void> {
  const modelId = await context.ui.select(translator.t("modelTitle"), [...provider.modelSource.modelIds]);
  if (!modelId) return;
  const api = resolveProviderModelApi(modelId, provider.defaultApi, provider.protocolRules);
  const options = getManagedProviderBooleanOptions(api);
  const stored = await orchestrator.readModelOverrides(provider.id, modelId);
  const allowed = new Set(options.map((option) => option.key));
  let draft = Object.fromEntries(
    Object.entries(stored).filter(([key]) => allowed.has(key as keyof ManagedProviderCompatOverrides)),
  ) as ManagedProviderCompatOverrides;
  const hasIncompatibleOverrides = Object.keys(stored).some(
    (key) => !allowed.has(key as keyof ManagedProviderCompatOverrides),
  );
  const initial = JSON.stringify(draft);
  const inheritedModel = buildManagedProviderModel(provider, modelId);

  for (;;) {
    const labels = options.map((option) => {
      const explicit = draft[option.key];
      const state = explicit === undefined
        ? translator.t("inherit")
        : translator.t(explicit ? "enabled" : "disabled");
      const inherited = getManagedProviderInheritedBooleanValue(option, inheritedModel.compat);
      const effective = explicit ?? inherited;
      return translator.t("modelOverrideOption", {
        label: translator.t(option.labelKey),
        state,
        effective: translator.t(effective ? "enabled" : "disabled"),
      });
    });
    const reset = translator.t("resetAllOverrides");
    const save = translator.t("saveAndReturn");
    const discard = translator.t("discardAndReturn");
    const choice = await context.ui.select(translator.t("modelOverridesTitle", { model: modelId }), [
      ...labels, reset, save, discard,
    ]);
    if (!choice || choice === discard) return;
    if (choice === reset) {
      draft = {};
      continue;
    }
    if (choice === save) {
      if (JSON.stringify(draft) === initial && !hasIncompatibleOverrides) {
        context.ui.notify(translator.t("noModelOverrideChanges"), "info");
        return;
      }
      if (await orchestrator.saveModelOverrides(pi, context, provider, modelId, draft)) {
        context.ui.notify(translator.t("savedModelOverrides", { model: modelId }), "info");
      }
      return;
    }
    const optionIndex = labels.indexOf(choice);
    if (optionIndex < 0) continue;
    const option = options[optionIndex]!;
    const inherit = translator.t("inherit");
    const enabled = translator.t("enabled");
    const disabled = translator.t("disabled");
    const state = await context.ui.select(translator.t("overrideStateTitle", {
      label: translator.t(option.labelKey),
    }), [inherit, enabled, disabled]);
    if (state === inherit) delete draft[option.key];
    else if (state === enabled) draft[option.key] = true;
    else if (state === disabled) draft[option.key] = false;
  }
}

function requireRemovableManagedProvider(context: ExtensionCommandContext, provider: ManagedProviderDefinition): void {
  if (context.model?.provider === provider.id) {
    throw new ManagedProviderLocalizedError("cannotDeleteActiveProvider", {
      provider: provider.name,
      model: context.model.id,
    });
  }
}

async function manageExistingManagedProvider(
  pi: ExtensionAPI,
  context: ExtensionCommandContext,
  translator: ManagedProviderTranslator,
  orchestrator: PiManagedProviderCommandOrchestrator,
  providerId: string,
): Promise<void> {
  for (;;) {
    const provider = orchestrator.snapshot().providers.find((entry) => entry.id === providerId);
    if (!provider) return;
    const editConnection = translator.t("editConnection");
    const manageSource = translator.t("manageModelSource");
    const manageRouting = translator.t("manageProtocolRouting");
    const manageOverrides = translator.t("manageModelOverrides");
    const refreshModels = translator.t("refreshDiscoveredModels");
    const deleteProvider = translator.t("deleteProvider");
    const back = translator.t("back");
    const choice = await context.ui.select(provider.name, [
      editConnection, manageSource, manageRouting, manageOverrides, refreshModels, deleteProvider, back,
    ]);
    if (!choice || choice === back) return;
    if (choice === editConnection) await editManagedProviderConnection(pi, context, translator, orchestrator, provider);
    else if (choice === manageSource) await manageManagedProviderModelSource(pi, context, translator, orchestrator, provider);
    else if (choice === manageRouting) await manageManagedProviderProtocolRules(pi, context, translator, orchestrator, provider);
    else if (choice === manageOverrides) await manageManagedProviderModelOverrides(pi, context, translator, orchestrator, provider);
    else if (choice === refreshModels) {
      if (provider.modelSource.type !== "discover") {
        context.ui.notify(translator.t("manualModelsWarning"), "warning");
        continue;
      }
      const modelIds = await discoverManagedProviderModelsWithUi(context, translator, orchestrator, provider);
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
      context.ui.notify(translator.t("refreshedProvider", { name: provider.name }), "info");
    } else if (choice === deleteProvider) {
      requireRemovableManagedProvider(context, provider);
      const confirmed = await context.ui.confirm(
        translator.t("deleteProviderConfirm"),
        translator.t("deleteProviderSummary", { name: provider.name }),
      );
      if (!confirmed) continue;
      await orchestrator.removeProvider(pi, provider.id);
      context.ui.notify(translator.t("deletedProvider", { name: provider.name }), "info");
      return;
    }
  }
}

async function chooseManagedProviderLanguage(
  context: ExtensionCommandContext,
  translator: ManagedProviderTranslator,
  detection: ManagedProviderLanguageDetection,
): Promise<ManagedProviderLanguagePreference | undefined> {
  const auto = translator.t("languageAutoCurrent", {
    language: managedProviderLanguageName(detection.language, translator),
  });
  const chinese = translator.t("languageChinese");
  const english = translator.t("languageEnglish");
  const title = `${translator.t("language")} · ${translator.t("languageDetectionSource", {
    source: managedProviderLanguageSourceLabel(detection.source, translator),
  })}`;
  const choice = await context.ui.select(title, [auto, chinese, english]);
  if (choice === auto) return "auto";
  if (choice === chinese) return "zh-CN";
  if (choice === english) return "en";
  return undefined;
}

export async function runPiManagedProvidersCommand(
  pi: ExtensionAPI,
  context: ExtensionCommandContext,
  orchestrator: PiManagedProviderCommandOrchestrator,
): Promise<void> {
  let automaticLanguage: ManagedProviderLanguageDetection | undefined;
  const getAutomaticLanguage = async (): Promise<ManagedProviderLanguageDetection> => {
    automaticLanguage ??= await detectManagedProviderLanguage("auto");
    return automaticLanguage;
  };
  if (context.mode !== "tui") {
    const translator = createManagedProviderTranslator((await getAutomaticLanguage()).language);
    context.ui.notify(translator.t("interactiveModeRequired"), "error");
    return;
  }
  for (;;) {
    const state = orchestrator.snapshot();
    const language = state.language === "auto" ? (await getAutomaticLanguage()).language : state.language;
    const translator = createManagedProviderTranslator(language);
    const languageLabel = managedProviderLanguageName(language, translator);
    const configuredKeys = new Set(
      state.providers.filter((provider) => orchestrator.hasConfiguredApiKey(provider.id)).map((provider) => provider.id),
    );
    const choice = await selectPiManagedProviderHome(context, translator, languageLabel, state.providers, configuredKeys);
    if (!choice) return;
    try {
      if (choice.type === "language") {
        const preference = await chooseManagedProviderLanguage(context, translator, await getAutomaticLanguage());
        if (preference !== undefined) await orchestrator.setLanguage(preference);
      } else if (choice.type === "add") await addManagedProvider(pi, context, translator, orchestrator);
      else await manageExistingManagedProvider(pi, context, translator, orchestrator, choice.providerId);
    } catch (error) {
      context.ui.notify(formatManagedProviderError(error, translator), "error");
    }
  }
}
