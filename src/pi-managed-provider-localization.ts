import { execFile } from "node:child_process";

export const MANAGED_PROVIDER_LANGUAGE_PREFERENCES = ["auto", "en", "zh-CN"] as const;
export type ManagedProviderLanguagePreference = (typeof MANAGED_PROVIDER_LANGUAGE_PREFERENCES)[number];
export type ManagedProviderLanguage = Exclude<ManagedProviderLanguagePreference, "auto">;

export interface ManagedProviderLanguageCandidate {
  locale: string;
  source: string;
}

export interface ManagedProviderLanguageDiagnostic {
  source: string;
  error: string;
}

export interface ManagedProviderLanguageDetection {
  language: ManagedProviderLanguage;
  locale: string;
  source: string;
  diagnostics: ManagedProviderLanguageDiagnostic[];
}

const EN_MESSAGES = {
  providersTitle: "Providers",
  addProvider: "Add provider",
  language: "Language",
  languageAutoCurrent: "Auto · current: {language}",
  languageChinese: "Chinese (Simplified)",
  languageEnglish: "English",
  languageDetectionSource: "Detected from {source}",
  configuredProviders: "Configured providers ({count}) ",
  noProviders: "  No providers configured",
  keyConfigured: "key configured",
  keyMissing: "key missing",
  providerDescription: "{count} models · {keyStatus} · fallback: {protocol}",
  homeHint: "↑↓ select · enter open · esc close",
  secretHint: "Enter submit · Esc cancel · empty keeps current value",
  keepCurrent: "Keep current · {value}",
  defaultProtocolTitle: "Default protocol · fallback when no model rule matches",
  defaultProtocolValue: "default: {protocol}",
  requestProtocolTitle: "Request protocol",
  modelSourceTitle: "Model source",
  discoverModelsSource: "Discover from /v1/models",
  manualModelsSource: "Add model identifiers manually",
  modelIdentifiersTitle: "Model identifiers",
  modelIdentifiersKeepHint: "Comma-separated; empty keeps current list",
  modelIdentifiersHint: "Comma-separated model identifiers",
  discoveringModels: "Discovering models...",
  discoveredModels: "Discovered {count} models",
  allDiscoveredModelsIgnored: "Every discovered model is currently ignored",
  providerNameTitle: "Provider name",
  providerNameHint: "For example: Work Gateway",
  apiUrlTitle: "API URL",
  apiUrlHint: "Gateway root URL, for example https://api.example.com",
  apiKeyTitle: "API key",
  apiKeyHint: "Enter the provider API key",
  protocolRoutingTitle: "Protocol routing",
  protocolRoutingBeforeSave: "Add exact model settings or wildcard fallbacks before saving?",
  addProviderConfirm: "Add {name}?",
  addProviderSummary: "{count} models · {protocol}",
  addedProvider: "Added {name}",
  currentValueKeepHint: "Current: {value} · Enter keeps current",
  configured: "Configured",
  notConfigured: "Not configured",
  noChanges: "No changes",
  saveProviderConfirm: "Save {name}?",
  saveProviderSummary: "URL: {url}\nProtocol: {protocol}\nAPI key: {keyChange}",
  updated: "updated",
  unchanged: "unchanged",
  updatedProvider: "Updated {name}",
  updatedModels: "Updated models for {name}",
  exactRuleLabel: "Model · {pattern} → {protocol}",
  fallbackRuleLabel: "Fallback {index} · {pattern} → {protocol}",
  routingManagerTitle: "Protocol routing · model → fallback pattern → default",
  setProtocolForModel: "Set protocol for a model",
  addFallbackPattern: "Add fallback pattern",
  saveAndReturn: "Save and return",
  cancel: "Cancel",
  everyModelConfigured: "Every model already has an exact protocol setting",
  modelTitle: "Model",
  fallbackPatternTitle: "Fallback model pattern",
  fallbackPatternHint: "Must contain * or ?",
  changeProtocol: "Change protocol",
  delete: "Delete",
  back: "Back",
  edit: "Edit",
  moveUp: "Move up",
  moveDown: "Move down",
  updatedRouting: "Updated protocol routing for {name}",
  editConnection: "Edit API URL, key, and protocol",
  manageModelSource: "Manage model list",
  modelListTitle: "Models",
  modelListDescription: "Review request protocols, remove unusable models, or restore models ignored during discovery.",
  sourceColumn: "Source",
  discoveredModelSource: "Discovered",
  manualModelSource: "Manual",
  ignoredModelSource: "Ignored",
  changeModelSource: "Change model source",
  restoreIgnoredModels: "Restore ignored models ({count})",
  removeModel: "Remove model",
  removeModelConfirm: "Remove model?",
  removeDiscoveredModelSummary: "{model} will be removed and ignored during future discovery refreshes. Its native protocol capability settings will be kept for restoration.",
  removeManualModelSummary: "{model} will be removed from the manual model list. Its native protocol capability settings will be kept.",
  removedModel: "Removed {model}",
  ignoredModelsTitle: "Ignored models",
  ignoredModelsDescription: "Choose a model to restore. PI will refresh discovery and restore it only if the gateway still publishes it.",
  ignoredModelsSection: "Ignored models ({count}) ",
  restoreModelConfirm: "Restore model?",
  restoreModelSummary: "Refresh discovery and restore {model} if it is still available?",
  restoredModel: "Restored {model}",
  ignoredModelUnavailable: "The gateway no longer publishes ignored model {model}",
  cannotRemoveActiveModel: "Cannot remove active model {model}; switch models first",
  cannotRemoveLastModel: "A provider must keep at least one model",
  manageProtocolRouting: "Configure model request protocols",
  manageModelOverrides: "Model protocol capabilities (advanced)",
  refreshDiscoveredModels: "Refresh discovered models",
  deleteProvider: "Delete provider",
  manualModelsWarning: "This provider uses manual models",
  refreshedProvider: "Refreshed {name}",
  deleteProviderConfirm: "Delete provider?",
  deleteProviderSummary: "{name} and its stored API key will be removed",
  deletedProvider: "Deleted {name}",
  interactiveModeRequired: "/providers requires interactive mode",
  modelProtocolCapabilitiesTitle: "Model protocol capabilities",
  modelProtocolCapabilitiesDescription: "Review the compatibility parameters materialized for each model's request protocol. Change a value only when the gateway requires an exception.",
  modelCapabilityEditorDescription: "{model} · {protocol}\nSelect a capability to view its purpose, then use the PI default or force it enabled or disabled.",
  modelProtocolSelectionTitle: "Model request protocol",
  modelProtocolSelectionDescription: "Choose a model. Its currently effective request protocol is shown before editing.",
  configuredModelsSection: "Configured models ({count}) ",
  capabilitiesSection: "Protocol capabilities ",
  actionsSection: "Actions ",
  modelColumn: "Model",
  protocolColumn: "Request protocol",
  settingsColumn: "Settings",
  noExactProtocolRule: "Fallback/default",
  capabilityColumn: "Capability",
  currentSettingColumn: "Current setting",
  defaultSettingValue: "Default ({value})",
  piDefaults: "Protocol defaults",
  customSettingsCount: "{count} custom",
  forceEnabled: "Force enabled",
  forceDisabled: "Force disabled",
  customSettingValue: "Custom ({value})",
  usePiDefaultCurrent: "Use protocol default · {value}",
  sessionAffinityOpenAi: "OpenAI",
  sessionAffinityOpenAiNoSession: "OpenAI without session_id",
  sessionAffinityOpenRouter: "OpenRouter",
  enabled: "Enabled",
  disabled: "Disabled",
  resetAllOverrides: "Restore all protocol defaults",
  discardAndReturn: "Discard and return",
  savedModelOverrides: "Updated protocol capabilities for {model}",
  noModelOverrideChanges: "No protocol capability changes",
  structuredMenuHint: "↑↓ select · Enter open · Esc back",
  adaptiveThinking: "Adaptive thinking",
  temperature: "Temperature",
  strictJsonTools: "Strict JSON tools",
  eagerToolStreaming: "Eager tool input streaming",
  longCacheRetention: "Long cache retention",
  toolCacheControl: "Tool cache control",
  sessionAffinityHeaders: "Session-affinity headers",
  emptyThinkingSignature: "Empty thinking signature replay",
  toolReferences: "Deferred tool references",
  developerRole: "Developer role",
  sessionAffinityFormat: "Session-affinity format",
  openAiGrammarTools: "Grammar-constrained tools",
  additionalTools: "Message-anchored additional tools",
  explicitPromptCacheMode: "Explicit prompt-cache mode",
  toolSearch: "Deferred tool search",
  adaptiveThinkingDescription: "Use Anthropic adaptive thinking when PI requests the maximum reasoning level.",
  temperatureDescription: "Allow PI to send temperature when thinking is disabled.",
  strictJsonToolsDescription: "Mark eligible JSON Schema tool definitions as strict.",
  eagerToolStreamingDescription: "Stream tool input before the complete tool block has arrived.",
  longCacheRetentionDescription: "Allow longer prompt-cache retention when the protocol supports it.",
  toolCacheControlDescription: "Allow cache-control markers on tool definitions.",
  sessionAffinityHeadersDescription: "Send session-affinity headers to keep related requests on the same gateway session.",
  emptyThinkingSignatureDescription: "Allow replaying an empty thinking signature on later requests.",
  toolReferencesDescription: "Allow deferred references to tools instead of sending every definition immediately.",
  developerRoleDescription: "Allow PI to send developer-role messages through OpenAI Responses.",
  sessionAffinityFormatDescription: "Choose how PI sends session identifiers used for request affinity and caching.",
  openAiGrammarToolsDescription: "Allow grammar-constrained tool definitions in OpenAI Responses.",
  additionalToolsDescription: "Allow message-anchored additional_tools input items for deferred tools.",
  explicitPromptCacheModeDescription: "Allow PI to request prompt caching explicitly.",
  toolSearchDescription: "Allow deferred tool search instead of sending every tool immediately.",
  autoSourceMacos: "macOS preferred languages",
  autoSourceWindows: "Windows preferred languages",
  autoSourceEnvironment: "terminal message locale",
  autoSourceIntl: "JavaScript Intl",
  autoSourceFallback: "English fallback",
  activeModelMustRemain: "Keep the active model {model} in this provider, or switch models before removing it",
  failedReloadActiveModel: "Updated {provider}, but PI could not reload the active model {model}",
  failedReselectActiveModel: "Updated {provider}, but PI could not reselect the active model {model}",
  ruleAlreadyExists: "Rule already exists: {pattern}",
  cannotDeleteActiveProvider: "Cannot delete {provider} while {model} is active; switch to another provider first",
  setApiKeyBeforeDiscovery: "Set an API key before discovering models",
  unknownProvider: "Unknown provider: {provider}",
  unknownModel: "Unknown model {model} for {provider}",
  failedReloadModel: "PI could not reload {provider}/{model}",
  failedReselectModel: "PI could not reselect {provider}/{model}",
  failedRestoreModel: "PI could not restore {provider}/{model}",
  failedApplyModelOverrides: "Failed to apply protocol capabilities for {provider}/{model}: {reason}",
} as const;

export type ManagedProviderMessageKey = keyof typeof EN_MESSAGES;
type ManagedProviderMessageParams = Record<string, string | number | boolean>;

const ZH_CN_MESSAGES: Record<ManagedProviderMessageKey, string> = {
  providersTitle: "供应商",
  addProvider: "添加供应商",
  language: "语言",
  languageAutoCurrent: "自动 · 当前：{language}",
  languageChinese: "中文（简体）",
  languageEnglish: "英文",
  languageDetectionSource: "检测来源：{source}",
  configuredProviders: "已配置供应商（{count}） ",
  noProviders: "  尚未配置供应商",
  keyConfigured: "密钥已配置",
  keyMissing: "密钥缺失",
  providerDescription: "{count} 个模型 · {keyStatus} · 默认协议：{protocol}",
  homeHint: "↑↓ 选择 · Enter 打开 · Esc 关闭",
  secretHint: "Enter 提交 · Esc 取消 · 留空保留当前值",
  keepCurrent: "保持当前 · {value}",
  defaultProtocolTitle: "默认协议 · 无模型规则命中时使用",
  defaultProtocolValue: "默认：{protocol}",
  requestProtocolTitle: "请求协议",
  modelSourceTitle: "模型来源",
  discoverModelsSource: "从 /v1/models 发现",
  manualModelsSource: "手工添加模型标识",
  modelIdentifiersTitle: "模型标识",
  modelIdentifiersKeepHint: "使用逗号分隔；留空保留当前列表",
  modelIdentifiersHint: "使用逗号分隔模型标识",
  discoveringModels: "正在发现模型...",
  discoveredModels: "已发现 {count} 个模型",
  allDiscoveredModelsIgnored: "当前发现的所有模型都已被忽略",
  providerNameTitle: "供应商名称",
  providerNameHint: "例如：工作网关",
  apiUrlTitle: "API 地址",
  apiUrlHint: "网关根地址，例如 https://api.example.com",
  apiKeyTitle: "API 密钥",
  apiKeyHint: "输入供应商 API 密钥",
  protocolRoutingTitle: "协议路由",
  protocolRoutingBeforeSave: "保存前添加精准模型设置或通配兜底规则吗？",
  addProviderConfirm: "添加 {name}？",
  addProviderSummary: "{count} 个模型 · {protocol}",
  addedProvider: "已添加 {name}",
  currentValueKeepHint: "当前：{value} · Enter 保留",
  configured: "已配置",
  notConfigured: "未配置",
  noChanges: "没有变更",
  saveProviderConfirm: "保存 {name}？",
  saveProviderSummary: "地址：{url}\n协议：{protocol}\nAPI 密钥：{keyChange}",
  updated: "已更新",
  unchanged: "未变更",
  updatedProvider: "已更新 {name}",
  updatedModels: "已更新 {name} 的模型",
  exactRuleLabel: "模型 · {pattern} → {protocol}",
  fallbackRuleLabel: "兜底 {index} · {pattern} → {protocol}",
  routingManagerTitle: "协议路由 · 精准模型 → 通配兜底 → 默认协议",
  setProtocolForModel: "设置模型协议",
  addFallbackPattern: "添加通配兜底",
  saveAndReturn: "保存并返回",
  cancel: "取消",
  everyModelConfigured: "每个模型都已有精准协议设置",
  modelTitle: "模型",
  fallbackPatternTitle: "兜底模型模式",
  fallbackPatternHint: "必须包含 * 或 ?",
  changeProtocol: "修改协议",
  delete: "删除",
  back: "返回",
  edit: "编辑",
  moveUp: "上移",
  moveDown: "下移",
  updatedRouting: "已更新 {name} 的协议路由",
  editConnection: "编辑 API 地址、密钥和协议",
  manageModelSource: "管理模型列表",
  modelListTitle: "模型列表",
  modelListDescription: "查看请求协议、移除无法使用的模型，或恢复自动发现时已忽略的模型。",
  sourceColumn: "来源",
  discoveredModelSource: "自动发现",
  manualModelSource: "手工添加",
  ignoredModelSource: "已忽略",
  changeModelSource: "更改模型来源",
  restoreIgnoredModels: "恢复已忽略模型（{count}）",
  removeModel: "移除模型",
  removeModelConfirm: "移除模型？",
  removeDiscoveredModelSummary: "将移除 {model}，并在以后刷新发现模型时继续忽略。原生协议能力设置会保留，便于恢复。",
  removeManualModelSummary: "将从手工模型列表移除 {model}。原生协议能力设置会保留。",
  removedModel: "已移除 {model}",
  ignoredModelsTitle: "已忽略模型",
  ignoredModelsDescription: "选择要恢复的模型。PI 会重新刷新发现结果，仅在网关仍提供该模型时恢复。",
  ignoredModelsSection: "已忽略模型（{count}） ",
  restoreModelConfirm: "恢复模型？",
  restoreModelSummary: "刷新发现结果，并在 {model} 仍可用时恢复它？",
  restoredModel: "已恢复 {model}",
  ignoredModelUnavailable: "网关已不再提供被忽略的模型 {model}",
  cannotRemoveActiveModel: "当前正在使用 {model}，请先切换模型再移除",
  cannotRemoveLastModel: "供应商必须至少保留一个模型",
  manageProtocolRouting: "配置模型请求协议",
  manageModelOverrides: "模型协议能力（高级）",
  refreshDiscoveredModels: "刷新发现模型",
  deleteProvider: "删除供应商",
  manualModelsWarning: "此供应商使用手工模型列表",
  refreshedProvider: "已刷新 {name}",
  deleteProviderConfirm: "删除供应商？",
  deleteProviderSummary: "将删除 {name} 及其已保存的 API 密钥",
  deletedProvider: "已删除 {name}",
  interactiveModeRequired: "/providers 需要交互模式",
  modelProtocolCapabilitiesTitle: "模型协议能力",
  modelProtocolCapabilitiesDescription: "查看已按模型请求协议写入的兼容参数。只有网关需要例外时才修改具体值。",
  modelCapabilityEditorDescription: "{model} · {protocol}\n选择能力查看用途，并设置为 PI 默认、强制开启或强制关闭。",
  modelProtocolSelectionTitle: "模型请求协议",
  modelProtocolSelectionDescription: "选择模型；编辑前会显示当前实际生效的请求协议。",
  configuredModelsSection: "已配置模型（{count}） ",
  capabilitiesSection: "协议能力 ",
  actionsSection: "操作 ",
  modelColumn: "模型",
  protocolColumn: "请求协议",
  settingsColumn: "设置",
  noExactProtocolRule: "通配兜底/默认",
  capabilityColumn: "能力",
  currentSettingColumn: "当前设置",
  defaultSettingValue: "默认（{value}）",
  piDefaults: "协议默认",
  customSettingsCount: "已自定义 {count} 项",
  forceEnabled: "强制开启",
  forceDisabled: "强制关闭",
  customSettingValue: "自定义（{value}）",
  usePiDefaultCurrent: "使用协议默认值 · {value}",
  sessionAffinityOpenAi: "OpenAI",
  sessionAffinityOpenAiNoSession: "OpenAI（不发送 session_id）",
  sessionAffinityOpenRouter: "OpenRouter",
  enabled: "开启",
  disabled: "关闭",
  resetAllOverrides: "全部恢复为协议默认值",
  discardAndReturn: "放弃并返回",
  savedModelOverrides: "已更新 {model} 的协议能力",
  noModelOverrideChanges: "协议能力没有变更",
  structuredMenuHint: "↑↓ 选择 · Enter 打开 · Esc 返回",
  adaptiveThinking: "自适应思考",
  temperature: "温度设置",
  strictJsonTools: "严格 JSON 工具",
  eagerToolStreaming: "工具输入流",
  longCacheRetention: "长时缓存保留",
  toolCacheControl: "工具缓存控制",
  sessionAffinityHeaders: "会话亲和请求头",
  emptyThinkingSignature: "空思考签名回放",
  toolReferences: "延迟工具引用",
  developerRole: "开发者角色",
  sessionAffinityFormat: "会话亲和格式",
  openAiGrammarTools: "语法约束工具",
  additionalTools: "消息锚定附加工具",
  explicitPromptCacheMode: "显式提示缓存模式",
  toolSearch: "延迟工具搜索",
  adaptiveThinkingDescription: "PI 使用最高思考等级时，是否发送 Anthropic adaptive thinking 请求。",
  temperatureDescription: "未开启思考时，是否允许 PI 发送 temperature 参数。",
  strictJsonToolsDescription: "是否将符合条件的 JSON Schema 工具声明为严格模式。",
  eagerToolStreamingDescription: "工具调用块尚未完整返回时，是否提前流式输出工具参数。",
  longCacheRetentionDescription: "协议支持时，是否允许使用更长的提示缓存保留时间。",
  toolCacheControlDescription: "是否允许在工具定义上发送 cache-control 标记。",
  sessionAffinityHeadersDescription: "是否发送会话亲和请求头，让相关请求尽量落到同一网关会话。",
  emptyThinkingSignatureDescription: "后续请求是否允许回放空的思考签名。",
  toolReferencesDescription: "是否允许延迟引用工具，而不是立即发送全部工具定义。",
  developerRoleDescription: "是否允许 PI 通过 OpenAI Responses 发送 developer 角色消息。",
  sessionAffinityFormatDescription: "选择 PI 发送会话标识的格式，用于请求亲和和缓存路由。",
  openAiGrammarToolsDescription: "是否允许 OpenAI Responses 使用语法约束工具。",
  additionalToolsDescription: "是否允许使用消息锚定的 additional_tools 输入项加载延迟工具。",
  explicitPromptCacheModeDescription: "是否允许 PI 显式请求提示缓存。",
  toolSearchDescription: "是否允许延迟搜索工具，而不是立即发送全部工具。",
  autoSourceMacos: "macOS 首选语言",
  autoSourceWindows: "Windows 首选语言",
  autoSourceEnvironment: "终端消息语言",
  autoSourceIntl: "JavaScript Intl",
  autoSourceFallback: "英文回退",
  activeModelMustRemain: "请保留当前模型 {model}，或先切换模型再将它从此供应商移除",
  failedReloadActiveModel: "已更新 {provider}，但 PI 无法重新载入当前模型 {model}",
  failedReselectActiveModel: "已更新 {provider}，但 PI 无法重新选择当前模型 {model}",
  ruleAlreadyExists: "规则已存在：{pattern}",
  cannotDeleteActiveProvider: "当前正在使用 {model}，无法删除 {provider}；请先切换到其他供应商",
  setApiKeyBeforeDiscovery: "发现模型前请先配置 API 密钥",
  unknownProvider: "未知供应商：{provider}",
  unknownModel: "{provider} 中不存在模型 {model}",
  failedReloadModel: "PI 无法重新载入 {provider}/{model}",
  failedReselectModel: "PI 无法重新选择 {provider}/{model}",
  failedRestoreModel: "PI 无法恢复 {provider}/{model}",
  failedApplyModelOverrides: "应用 {provider}/{model} 的协议能力失败：{reason}",
};

function managedProviderMessagePlaceholders(template: string): string[] {
  return [...template.matchAll(/\{([A-Za-z0-9_]+)\}/gu)].map((match) => match[1]!).sort();
}

for (const key of Object.keys(EN_MESSAGES) as ManagedProviderMessageKey[]) {
  const english = managedProviderMessagePlaceholders(EN_MESSAGES[key]);
  const chinese = managedProviderMessagePlaceholders(ZH_CN_MESSAGES[key]);
  if (english.join("\u0000") !== chinese.join("\u0000")) {
    throw new Error(`Translation placeholders do not match for ${key}`);
  }
}

function formatManagedProviderMessage(template: string, params: ManagedProviderMessageParams): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/gu, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : placeholder
  );
}

export interface ManagedProviderTranslator {
  language: ManagedProviderLanguage;
  t(key: ManagedProviderMessageKey, params?: ManagedProviderMessageParams): string;
}

export class ManagedProviderLocalizedError extends Error {
  constructor(
    readonly messageKey: ManagedProviderMessageKey,
    readonly messageParams: ManagedProviderMessageParams = {},
    options?: ErrorOptions,
  ) {
    super(formatManagedProviderMessage(EN_MESSAGES[messageKey], messageParams), options);
    this.name = "ManagedProviderLocalizedError";
  }
}

export function formatManagedProviderError(error: unknown, translator: ManagedProviderTranslator): string {
  if (error instanceof ManagedProviderLocalizedError) return translator.t(error.messageKey, error.messageParams);
  return error instanceof Error ? error.message : String(error);
}

export function createManagedProviderTranslator(language: ManagedProviderLanguage): ManagedProviderTranslator {
  const messages = language === "zh-CN" ? ZH_CN_MESSAGES : EN_MESSAGES;
  return {
    language,
    t(key, params = {}) {
      return formatManagedProviderMessage(messages[key], params);
    },
  };
}

export function isManagedProviderLanguagePreference(value: unknown): value is ManagedProviderLanguagePreference {
  return typeof value === "string" && MANAGED_PROVIDER_LANGUAGE_PREFERENCES.includes(value as ManagedProviderLanguagePreference);
}

export function normalizeManagedProviderLocale(value: string): string | undefined {
  const cleaned = value.trim().replace(/\..*$/u, "").replace(/@.*$/u, "").replaceAll("_", "-");
  if (!cleaned) return undefined;
  try {
    return Intl.getCanonicalLocales(cleaned)[0];
  } catch {
    return undefined;
  }
}

export function matchManagedProviderLanguage(value: string): ManagedProviderLanguage | undefined {
  const locale = normalizeManagedProviderLocale(value);
  if (!locale) return undefined;
  const parsed = new Intl.Locale(locale);
  if (parsed.language === "en") return "en";
  if (
    parsed.language === "zh" &&
    (parsed.script === "Hans" || parsed.region === "CN" || parsed.region === "SG" || (!parsed.script && !parsed.region))
  ) {
    return "zh-CN";
  }
  return undefined;
}

export function resolveManagedProviderLanguageCandidates(
  candidates: readonly ManagedProviderLanguageCandidate[],
  diagnostics: ManagedProviderLanguageDiagnostic[] = [],
): ManagedProviderLanguageDetection {
  for (const candidate of candidates) {
    const language = matchManagedProviderLanguage(candidate.locale);
    if (language) {
      return {
        language,
        locale: normalizeManagedProviderLocale(candidate.locale) ?? candidate.locale,
        source: candidate.source,
        diagnostics: [...diagnostics],
      };
    }
  }
  return { language: "en", locale: "en", source: "fallback", diagnostics: [...diagnostics] };
}

function runManagedProviderLocaleCommand(
  executable: string,
  args: readonly string[],
  source: string,
): Promise<{ output?: string; diagnostic?: ManagedProviderLanguageDiagnostic }> {
  return new Promise((resolve) => {
    execFile(executable, [...args], { timeout: 1_000, maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve({ diagnostic: { source, error: error.message } });
        return;
      }
      resolve({ output: stdout });
    });
  });
}

function managedProviderEnvironmentCandidates(env: NodeJS.ProcessEnv): ManagedProviderLanguageCandidate[] {
  const candidates: ManagedProviderLanguageCandidate[] = [];
  for (const locale of (env.LANGUAGE ?? "").split(":").filter(Boolean)) {
    candidates.push({ locale, source: "environment" });
  }
  for (const locale of [env.LC_ALL, env.LC_MESSAGES, env.LANG]) {
    if (locale) candidates.push({ locale, source: "environment" });
  }
  return candidates;
}

async function detectMacOsManagedProviderLanguages(): Promise<{
  candidates: ManagedProviderLanguageCandidate[];
  diagnostics: ManagedProviderLanguageDiagnostic[];
}> {
  const result = await runManagedProviderLocaleCommand("/usr/bin/defaults", ["read", "-g", "AppleLanguages"], "macos");
  const locales = result.output?.match(/"([^"]+)"/gu)?.map((entry) => entry.slice(1, -1)) ?? [];
  return {
    candidates: locales.map((locale) => ({ locale, source: "macos" })),
    diagnostics: result.diagnostic ? [result.diagnostic] : [],
  };
}

async function detectWindowsManagedProviderLanguages(): Promise<{
  candidates: ManagedProviderLanguageCandidate[];
  diagnostics: ManagedProviderLanguageDiagnostic[];
}> {
  const [preferred, culture] = await Promise.all([
    runManagedProviderLocaleCommand(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "(Get-WinUserLanguageList).LanguageTag"],
      "windows-language-list",
    ),
    runManagedProviderLocaleCommand(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "[System.Globalization.CultureInfo]::CurrentUICulture.Name"],
      "windows-ui-culture",
    ),
  ]);
  const candidates = [preferred.output, culture.output]
    .flatMap((output) => output?.split(/\r?\n/gu) ?? [])
    .map((locale) => locale.trim())
    .filter(Boolean)
    .map((locale) => ({ locale, source: "windows" }));
  return {
    candidates,
    diagnostics: [preferred.diagnostic, culture.diagnostic].filter(
      (diagnostic): diagnostic is ManagedProviderLanguageDiagnostic => diagnostic !== undefined,
    ),
  };
}

export async function detectManagedProviderLanguage(
  preference: ManagedProviderLanguagePreference,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ManagedProviderLanguageDetection> {
  if (preference !== "auto") return { language: preference, locale: preference, source: "explicit", diagnostics: [] };

  const operatingSystem = platform === "darwin"
    ? await detectMacOsManagedProviderLanguages()
    : platform === "win32"
      ? await detectWindowsManagedProviderLanguages()
      : { candidates: [] as ManagedProviderLanguageCandidate[], diagnostics: [] as ManagedProviderLanguageDiagnostic[] };
  const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
  return resolveManagedProviderLanguageCandidates(
    [
      ...operatingSystem.candidates,
      ...managedProviderEnvironmentCandidates(env),
      { locale: intlLocale, source: "intl" },
    ],
    operatingSystem.diagnostics,
  );
}

export function managedProviderLanguageSourceLabel(
  source: string,
  translator: ManagedProviderTranslator,
): string {
  if (source === "macos") return translator.t("autoSourceMacos");
  if (source === "windows") return translator.t("autoSourceWindows");
  if (source === "environment") return translator.t("autoSourceEnvironment");
  if (source === "intl") return translator.t("autoSourceIntl");
  return translator.t("autoSourceFallback");
}

export function managedProviderLanguageName(
  language: ManagedProviderLanguage,
  translator: ManagedProviderTranslator,
): string {
  return translator.t(language === "zh-CN" ? "languageChinese" : "languageEnglish");
}
