import { describe, expect, test } from "bun:test";
import { streamSimple as streamAnthropicSimple } from "@earendil-works/pi-ai/api/anthropic-messages";
import { streamSimple as streamOpenAIResponsesSimple } from "@earendil-works/pi-ai/api/openai-responses";
import { getKeybindings, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { parse } from "jsonc-parser";
import {
  buildManagedProviderModel,
  discoverManagedProviderModelIds,
  parseManagedProviderCatalogResponse,
} from "../src/pi-managed-provider-catalog.js";
import {
  runPiManagedProvidersCommand,
  saveManagedProviderAndRestoreActiveModel,
} from "../src/pi-managed-provider-command.js";
import {
  createManagedProviderIdentifier,
  type ManagedProviderDefinition,
  validateProviderProtocolWildcardPattern,
} from "../src/pi-managed-provider-contracts.js";
import { applyPiManagedProviderConnectionInput } from "../src/pi-managed-provider-edit.js";
import {
  createManagedProviderTranslator,
  matchManagedProviderLanguage,
  resolveManagedProviderLanguageCandidates,
} from "../src/pi-managed-provider-localization.js";
import { getManagedProviderCompatOptions } from "../src/pi-managed-provider-model-options.js";
import {
  materializeManagedProviderProtocolProfilesInText,
  readManagedProviderCompatOverridesFromText,
  updateManagedProviderModelsJsonText,
} from "../src/pi-managed-provider-model-overrides.js";
import {
  formatProviderRootUrlForDisplay,
  getProviderApiBaseUrl,
  getProviderDiscoveryUrl,
  matchesProviderProtocolPattern,
  normalizeProviderRootUrl,
  resolveProviderModelApi,
  retainManagedProviderProtocolRulesForModels,
} from "../src/pi-managed-provider-routing.js";
import { parseManagedProviderState } from "../src/pi-managed-provider-state-schema.js";
import { PiManagedProviderStructuredMenuComponent } from "../src/pi-managed-provider-structured-menu.js";
import { PiManagedProviderHomeComponent } from "../src/pi-managed-provider-tui.js";

const provider: ManagedProviderDefinition = {
  id: "test-provider",
  name: "Test Provider",
  rootUrl: "https://gateway.example.com",
  modelSource: { type: "manual", modelIds: ["claude-opus-4-8"] },
  defaultApi: "anthropic-messages",
  protocolRules: [{ pattern: "gpt-*", api: "openai-responses" }],
};

describe("localization", () => {
  test("prefers the operating-system UI language over an English terminal locale", () => {
    const detection = resolveManagedProviderLanguageCandidates([
      { locale: "zh-Hans-CN", source: "macos" },
      { locale: "en_US.UTF-8", source: "environment" },
    ]);
    expect(detection).toMatchObject({ language: "zh-CN", source: "macos" });
    expect(matchManagedProviderLanguage("zh_TW.UTF-8")).toBeUndefined();
  });

  test("renders language names in the current interface language", () => {
    const chinese = createManagedProviderTranslator("zh-CN");
    const english = createManagedProviderTranslator("en");
    expect(chinese.t("languageChinese")).toBe("中文（简体）");
    expect(chinese.t("languageEnglish")).toBe("英文");
    expect(english.t("languageChinese")).toBe("Chinese (Simplified)");
    expect(english.t("languageEnglish")).toBe("English");
    expect(chinese.t("automaticRefreshChanged", { name: "AIGW", added: 2, removed: 1 })).toBe("AIGW 模型列表已更新：新增 2，移除 1");
    expect(english.t("automaticRefreshChanged", { name: "AIGW", added: 2, removed: 1 })).toBe("AIGW model list updated: 2 added, 1 removed");
  });
});

describe("provider identifiers", () => {
  test("preserves a display name that is already a valid PI identifier", () => {
    expect(createManagedProviderIdentifier("TokenHub", () => false)).toBe("TokenHub");
  });

  test("derives a readable internal identifier when the display name needs normalization", () => {
    expect(createManagedProviderIdentifier("Crème API Gateway", () => false)).toBe("creme-api-gateway");
  });

  test("uses a safe fallback and suffixes occupied identifiers", () => {
    const occupied = new Set(["custom-provider", "custom-provider-2"]);
    expect(createManagedProviderIdentifier("工作网关", (identifier) => occupied.has(identifier))).toBe("custom-provider-3");
  });
});

describe("provider URL and routing", () => {
  test("normalizes a gateway root once for every protocol", () => {
    expect(normalizeProviderRootUrl(" https://gateway.example.com/v1/ ")).toBe("https://gateway.example.com");
    expect(getProviderDiscoveryUrl("https://gateway.example.com/v1")).toBe("https://gateway.example.com/v1/models");
    expect(formatProviderRootUrlForDisplay("https://gateway.example.com/private/path")).toBe("https://gateway.example.com");
    expect(getProviderApiBaseUrl("https://gateway.example.com/v1", "anthropic-messages")).toBe("https://gateway.example.com");
    expect(getProviderApiBaseUrl("https://gateway.example.com/v1", "openai-responses")).toBe("https://gateway.example.com/v1");
  });

  test("resolves exact model settings before ordered wildcard fallbacks and the provider default", () => {
    expect(matchesProviderProtocolPattern("gpt-5", "gpt-*")).toBe(true);
    expect(matchesProviderProtocolPattern("gpt-a", "gpt-?")).toBe(true);
    expect(matchesProviderProtocolPattern("gpt-ab", "gpt-?")).toBe(false);
    const rules = [
      { pattern: "gpt-*", api: "openai-responses" as const },
      { pattern: "gpt-5", api: "anthropic-messages" as const },
      { pattern: "*", api: "anthropic-messages" as const },
    ];
    expect(resolveProviderModelApi("gpt-5", "openai-responses", rules)).toBe("anthropic-messages");
    expect(resolveProviderModelApi("gpt-6", "anthropic-messages", rules)).toBe("openai-responses");
    expect(resolveProviderModelApi("other", "openai-responses", [])).toBe("openai-responses");
  });

  test("requires wildcards in typed fallback rules", () => {
    expect(validateProviderProtocolWildcardPattern("gpt-*")).toBe("gpt-*");
    expect(() => validateProviderProtocolWildcardPattern("gpt-5")).toThrow("choose a model");
  });

  test("drops exact settings for removed models while retaining wildcard fallbacks", () => {
    expect(retainManagedProviderProtocolRulesForModels([
      { pattern: "model-one", api: "anthropic-messages" },
      { pattern: "model-two", api: "openai-responses" },
      { pattern: "model-*", api: "openai-responses" },
    ], ["model-one"])).toEqual([
      { pattern: "model-one", api: "anthropic-messages" },
      { pattern: "model-*", api: "openai-responses" },
    ]);
  });
});

describe("active provider updates", () => {
  test("reselects the active model after updating its provider", async () => {
    const refreshedModel = { provider: provider.id, id: "claude-opus-4-8", api: "openai-responses" };
    let savedProvider: ManagedProviderDefinition | undefined;
    let selectedModel: unknown;
    await saveManagedProviderAndRestoreActiveModel(
      { async setModel(model: unknown) { selectedModel = model; return true; } } as never,
      {
        model: { provider: provider.id, id: "claude-opus-4-8" },
        modelRegistry: { find() { return refreshedModel; } },
      } as never,
      {
        async saveProvider(_pi: unknown, nextProvider: ManagedProviderDefinition) { savedProvider = nextProvider; },
      } as never,
      provider,
      { ...provider, defaultApi: "openai-responses" },
      {},
    );
    expect(savedProvider?.defaultApi).toBe("openai-responses");
    expect(selectedModel).toBe(refreshedModel);
  });

  test("rejects removing the active model before writing provider state", async () => {
    let saveCalls = 0;
    await expect(saveManagedProviderAndRestoreActiveModel(
      { async setModel() { return true; } } as never,
      {
        model: { provider: provider.id, id: "claude-opus-4-8" },
        modelRegistry: { find() { return undefined; } },
      } as never,
      {
        async saveProvider() { saveCalls += 1; },
      } as never,
      provider,
      { ...provider, modelSource: { type: "manual", modelIds: ["gpt-5.4"] } },
      {},
    )).rejects.toThrow("Keep the active model");
    expect(saveCalls).toBe(0);
  });
});

describe("connection edits", () => {
  test("empty URL and key plus keep protocol causes no update", () => {
    expect(applyPiManagedProviderConnectionInput(provider, { rootUrl: "", apiKey: "", defaultApi: "keep" })).toEqual({
      provider,
      changed: false,
    });
  });

  test("can update only the key without rewriting secret bytes", () => {
    expect(applyPiManagedProviderConnectionInput(provider, { rootUrl: "", apiKey: " new-key ", defaultApi: "keep" })).toEqual({
      provider,
      apiKey: " new-key ",
      changed: true,
    });
  });

  test("can update only the protocol", () => {
    const result = applyPiManagedProviderConnectionInput(provider, {
      rootUrl: "",
      apiKey: "",
      defaultApi: "openai-responses",
    });
    expect(result.changed).toBe(true);
    expect(result.provider.defaultApi).toBe("openai-responses");
    expect(result.apiKey).toBeUndefined();
  });
});

describe("model catalog", () => {
  test("discovers the standard endpoint with Bearer authentication", async () => {
    let receivedPath = "";
    let receivedAuthorization = "";
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        receivedPath = url.pathname;
        receivedAuthorization = request.headers.get("authorization") ?? "";
        return Response.json({ data: [{ id: "model-a" }, { id: "model-b" }] });
      },
    });
    try {
      const ids = await discoverManagedProviderModelIds(`http://127.0.0.1:${server.port}`, "catalog-key");
      expect(ids).toEqual(["model-a", "model-b"]);
      expect(receivedPath).toBe("/v1/models");
      expect(receivedAuthorization).toBe("Bearer catalog-key");
    } finally {
      server.stop(true);
    }
  });

  test("accepts only a unique standard model list", () => {
    expect(parseManagedProviderCatalogResponse({ data: [{ id: "a" }, { id: "b" }] })).toEqual(["a", "b"]);
    expect(() => parseManagedProviderCatalogResponse({ data: [{ id: "a" }, { id: "a" }] })).toThrow("duplicate");
    expect(() => parseManagedProviderCatalogResponse({ models: [] })).toThrow("data array");
  });

  test("inherits known same-protocol metadata without cross-protocol residue", () => {
    const deepseek = buildManagedProviderModel(provider, "deepseek-v4-flash");
    expect(deepseek.api).toBe("anthropic-messages");
    expect(deepseek.compat).toMatchObject({
      forceAdaptiveThinking: true,
      supportsEagerToolInputStreaming: true,
      supportsTemperature: true,
    });
    expect((deepseek.compat as Record<string, unknown>).supportsDeveloperRole).toBeUndefined();

    const claude = buildManagedProviderModel(provider, "claude-opus-4-8");
    expect(claude.api).toBe("anthropic-messages");
    expect((claude.compat as Record<string, unknown>).forceAdaptiveThinking).toBe(true);
    expect((claude.compat as Record<string, unknown>).supportsToolReferences).toBe(true);
    expect((claude.compat as Record<string, unknown>).supportsDeveloperRole).toBeUndefined();
    const haiku = buildManagedProviderModel(provider, "claude-haiku-4-5");
    expect((haiku.compat as Record<string, unknown>).supportsToolReferences).toBe(false);

    const crossProtocolProvider = { ...provider, defaultApi: "openai-responses" as const, protocolRules: [] };
    const crossProtocol = buildManagedProviderModel(crossProtocolProvider, "claude-opus-4-8");
    expect(crossProtocol.api).toBe("openai-responses");
    expect(crossProtocol.reasoning).toBe(true);
    expect(crossProtocol.contextWindow).toBe(claude.contextWindow);
    expect(crossProtocol.compat).toMatchObject({
      supportsDeveloperRole: true,
      sessionAffinityFormat: "openai",
      supportsAdditionalTools: false,
    });
    expect((crossProtocol.compat as Record<string, unknown>).forceAdaptiveThinking).toBeUndefined();
  });

  test("materialized Anthropic defaults produce an adaptive max-thinking request", async () => {
    const model = buildManagedProviderModel(provider, "deepseek-v4-flash");
    let payload: Record<string, unknown> | undefined;
    const stream = streamAnthropicSimple(
      model as never,
      { systemPrompt: "test", messages: [], tools: [] },
      {
        apiKey: "test-key",
        reasoning: "max",
        maxRetries: 0,
        onPayload(value) { payload = value as Record<string, unknown>; },
        fetch: (async () => new Response('{"error":"stop after payload"}', {
          status: 400,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch,
      },
    );
    for await (const _event of stream) { /* consume the expected error event */ }
    expect(payload).toMatchObject({
      thinking: { type: "adaptive" },
      output_config: { effort: "max" },
    });
  });

  test("materialized Responses defaults produce developer messages and OpenAI affinity headers", async () => {
    const responsesProvider = { ...provider, defaultApi: "openai-responses" as const, protocolRules: [] };
    const model = buildManagedProviderModel(responsesProvider, "gpt-5.4");
    let payload: { input?: Array<{ role?: string }> } | undefined;
    let headers = new Headers();
    const stream = streamOpenAIResponsesSimple(
      model as never,
      { systemPrompt: "test", messages: [], tools: [] },
      {
        apiKey: "test-key",
        sessionId: "session-1",
        maxRetries: 0,
        onPayload(value) { payload = value as { input?: Array<{ role?: string }> }; },
        fetch: (async (_input, init) => {
          headers = new Headers(init?.headers);
          return new Response('{"error":"stop after payload"}', {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }) as typeof fetch,
      },
    );
    for await (const _event of stream) { /* consume the expected error event */ }
    expect(payload?.input?.[0]?.role).toBe("developer");
    expect(headers.get("session_id")).toBe("session-1");
    expect(headers.get("x-client-request-id")).toBe("session-1");
  });
});

describe("native model overrides", () => {
  test("preserves JSONC comments and unrelated providers while editing one model", () => {
    const original = `{
  // Keep this comment
  "providers": {
    "Other": { "modelOverrides": { "other": { "contextWindow": 42 } } },
    "TokenHub": {
      "modelOverrides": {
        "deepseek-v4-flash": {
          "compat": { "forceAdaptiveThinking": true }
        }
      }
    }
  }
}\n`;
    const updated = updateManagedProviderModelsJsonText(
      original,
      "TokenHub",
      "deepseek-v4-flash",
      "anthropic-messages",
      { forceAdaptiveThinking: true, supportsStrictTools: true },
    );
    expect(updated).toContain("// Keep this comment");
    const parsed = parse(updated) as {
      providers: Record<string, { modelOverrides: Record<string, { contextWindow?: number; compat?: Record<string, boolean> }> }>;
    };
    expect(parsed.providers.Other?.modelOverrides.other?.contextWindow).toBe(42);
    expect(parsed.providers.TokenHub?.modelOverrides["deepseek-v4-flash"]?.compat).toEqual({
      forceAdaptiveThinking: true,
      supportsStrictTools: true,
    });
  });

  test("removes omitted managed fields and prunes empty override nodes", () => {
    const original = `{
  "providers": {
    "TokenHub": {
      "modelOverrides": {
        "deepseek-v4-flash": {
          "compat": { "forceAdaptiveThinking": true }
        }
      }
    }
  }
}\n`;
    const updated = updateManagedProviderModelsJsonText(
      original,
      "TokenHub",
      "deepseek-v4-flash",
      "anthropic-messages",
      {},
    );
    expect(parse(updated)).toEqual({ providers: {} });
    expect(readManagedProviderCompatOverridesFromText(updated, "TokenHub", "deepseek-v4-flash")).toEqual({});
  });

  test("removes stale compatibility fields from another protocol when saving", () => {
    const original = `{
  "providers": {
    "TokenHub": {
      "modelOverrides": {
        "deepseek-v4-flash": {
          "compat": { "supportsDeveloperRole": false, "forceAdaptiveThinking": true }
        }
      }
    }
  }
}\n`;
    const updated = updateManagedProviderModelsJsonText(
      original,
      "TokenHub",
      "deepseek-v4-flash",
      "anthropic-messages",
      { forceAdaptiveThinking: true },
    );
    expect(readManagedProviderCompatOverridesFromText(updated, "TokenHub", "deepseek-v4-flash")).toEqual({
      forceAdaptiveThinking: true,
    });
  });

  test("rejects compatibility fields from the wrong final protocol", () => {
    expect(() => updateManagedProviderModelsJsonText(
      undefined,
      "TokenHub",
      "gpt-5.6-sol",
      "openai-responses",
      { forceAdaptiveThinking: true },
    )).toThrow("does not apply");
  });
});

describe("protocol profile materialization", () => {
  test("covers every compatibility field read by the two PI protocol implementations", () => {
    expect(getManagedProviderCompatOptions("anthropic-messages").map((option) => option.key)).toEqual([
      "forceAdaptiveThinking",
      "supportsTemperature",
      "supportsStrictTools",
      "supportsEagerToolInputStreaming",
      "supportsLongCacheRetention",
      "supportsCacheControlOnTools",
      "sendSessionAffinityHeaders",
      "allowEmptySignature",
      "supportsToolReferences",
    ]);
    expect(getManagedProviderCompatOptions("openai-responses").map((option) => option.key)).toEqual([
      "supportsDeveloperRole",
      "sessionAffinityFormat",
      "supportsStrictMode",
      "supportsOpenAIGrammarTools",
      "supportsAdditionalTools",
      "supportsLongCacheRetention",
      "supportsExplicitPromptCacheMode",
      "supportsToolSearch",
    ]);
  });
  test("materializes every protocol default while preserving explicit user values", () => {
    const original = `{
  "providers": {
    "Gateway": {
      "modelOverrides": {
        "model-a": { "compat": { "supportsTemperature": false } }
      }
    }
  }
}`;
    const updated = materializeManagedProviderProtocolProfilesInText(original, [{
      providerId: "Gateway",
      modelId: "model-a",
      api: "anthropic-messages",
      defaults: {
        forceAdaptiveThinking: true,
        supportsTemperature: true,
        supportsStrictTools: false,
        supportsEagerToolInputStreaming: true,
        supportsLongCacheRetention: true,
        supportsCacheControlOnTools: true,
        sendSessionAffinityHeaders: false,
        allowEmptySignature: false,
        supportsToolReferences: false,
      },
    }]);
    expect(readManagedProviderCompatOverridesFromText(updated, "Gateway", "model-a")).toEqual({
      supportsEagerToolInputStreaming: true,
      supportsLongCacheRetention: true,
      sendSessionAffinityHeaders: false,
      supportsCacheControlOnTools: true,
      supportsTemperature: false,
      forceAdaptiveThinking: true,
      allowEmptySignature: false,
      supportsStrictTools: false,
      supportsToolReferences: false,
    });
  });

  test("replaces protocol-specific fields when a model switches to Responses", () => {
    const anthropic = updateManagedProviderModelsJsonText(undefined, "Gateway", "model-a", "anthropic-messages", {
      forceAdaptiveThinking: true,
      supportsTemperature: false,
    });
    const updated = materializeManagedProviderProtocolProfilesInText(anthropic, [{
      providerId: "Gateway",
      modelId: "model-a",
      api: "openai-responses",
      defaults: {
        supportsDeveloperRole: true,
        sessionAffinityFormat: "openai",
        supportsLongCacheRetention: true,
        supportsStrictMode: false,
        supportsOpenAIGrammarTools: false,
        supportsAdditionalTools: false,
        supportsExplicitPromptCacheMode: false,
        supportsToolSearch: false,
      },
    }]);
    const compat = readManagedProviderCompatOverridesFromText(updated, "Gateway", "model-a");
    expect(compat).toMatchObject({ supportsDeveloperRole: true, sessionAffinityFormat: "openai" });
    expect(compat.forceAdaptiveThinking).toBeUndefined();
    expect(compat.supportsTemperature).toBeUndefined();
  });
});

describe("structured provider menus", () => {
  const passthroughTheme = {
    fg(_color: string, text: string) { return text; },
    bold(text: string) { return text; },
  } as never;
  const options = {
    title: "模型协议能力",
    description: "选择模型并查看当前协议和设置状态。",
    columns: ["模型", "请求协议", "设置"] as const,
    mainSectionTitle: "已配置模型（3） ",
    items: [
      { value: "short", label: "glm-5.2", details: ["Anthropic Messages", "PI 默认"] as const },
      { value: "long", label: "claude-opus-4-8-20260201-extra-long-model-identifier", details: ["Anthropic Messages", "已自定义 1 项"] as const },
      { value: "gpt", label: "gpt-5.4", details: ["OpenAI Responses", "已自定义 2 项"] as const },
    ],
    hint: "↑↓ 选择 · Enter 打开 · Esc 返回",
  };

  test("keeps protocol and status columns aligned when model names have different lengths", () => {
    const component = new PiManagedProviderStructuredMenuComponent(options, passthroughTheme, () => {}, () => {});
    const lines = component.render(100);
    const rows = options.items.map((item) => lines.find((line) => line.includes(item.details[0]) && line.includes(item.details[1]))!);
    expect(rows.every(Boolean)).toBe(true);
    const plainRows = rows.map(stripTerminalSequences);
    const protocolStarts = plainRows.map((line) => line.indexOf("Messages") >= 0 ? line.indexOf("Anthropic") : line.indexOf("OpenAI"));
    const settingStarts = plainRows.map((line, index) => line.indexOf(options.items[index]!.details[1]));
    expect(new Set(protocolStarts).size).toBe(1);
    expect(new Set(settingStarts).size).toBe(1);
    expect(rows[1]).toContain("…");
  });

  test("uses fixed detail indentation in a narrow terminal", () => {
    const component = new PiManagedProviderStructuredMenuComponent(options, passthroughTheme, () => {}, () => {});
    const lines = component.render(50);
    const detailLines = lines.filter((line) => line.startsWith("    请求协议") || line.startsWith("    设置"));
    expect(detailLines).toHaveLength(6);
    expect(detailLines.every((line) => line.startsWith("    "))).toBe(true);
    expect(lines.every((line) => visibleWidth(line) <= 50)).toBe(true);
  });
});

describe("model protocol capability flow", () => {
  test("shows each model protocol and custom-setting count before selection", async () => {
    const renders: string[][] = [];
    const selections = ["Model protocol capabilities (advanced)", "Back"];
    let customCall = 0;
    const theme = { fg(_color: string, text: string) { return text; }, bold(text: string) { return text; } };
    const context = {
      mode: "tui",
      model: undefined,
      modelRegistry: { getProvider() { return undefined; } },
      ui: {
        theme,
        async select() { return selections.shift(); },
        notify() {},
        custom(factory: Function) {
          customCall++;
          return new Promise((resolve) => {
            const component = factory({ requestRender() {} }, theme, getKeybindings(), resolve);
            if (customCall === 1) {
              component.handleInput?.("\x1b[B");
              component.handleInput?.("\x1b[B");
              component.handleInput?.("\r");
            } else if (customCall === 2) {
              renders.push(component.render(100), component.render(50));
              component.handleInput?.("\r");
            } else if (customCall === 3) {
              renders.push(component.render(100));
              component.handleInput?.("\x1b");
            } else if (customCall === 4) {
              renders.push(component.render(100));
              component.handleInput?.("\x1b");
            } else component.handleInput?.("\x1b");
          });
        },
      },
    };
    const testProvider = { ...provider, modelSource: { type: "manual", modelIds: ["claude-opus-4-8", "gpt-5.4"] } };
    const orchestrator = {
      snapshot() { return { version: 1, language: "en", providers: [testProvider] }; },
      hasConfiguredApiKey() { return true; },
      async readModelOverrides(_providerId: string, modelId: string) {
        return modelId === "claude-opus-4-8" ? { forceAdaptiveThinking: false } : {};
      },
    };
    await runPiManagedProvidersCommand({} as never, context as never, orchestrator as never);
    expect(renders[0]!.join("\n")).toContain("claude-opus-4-8");
    expect(renders[0]!.join("\n")).toContain("Anthropic Messages");
    expect(renders[0]!.join("\n")).toContain("1 custom");
    expect(renders[0]!.join("\n")).toContain("OpenAI Responses");
    expect(renders[1]!.join("\n")).toContain("    Request protocol  Anthropic Messages");
    const capabilityPage = renders[2]!.join("\n");
    expect(capabilityPage).toContain("Capability");
    expect(capabilityPage).toContain("Current setting");
    expect(capabilityPage).toContain("Force disabled");
    expect(capabilityPage).toContain("Default (Enabled)");
    expect(capabilityPage).not.toContain("Effective");
    const returnedModelList = renders[3]!.join("\n");
    expect(returnedModelList).toContain("claude-opus-4-8");
    expect(returnedModelList).toContain("Request protocol");
  });
});

describe("model removal flow", () => {
  test("persists a discovered model as ignored and removes its exact protocol rule", async () => {
    const selections = ["Manage model list", "Back"];
    let customCall = 0;
    let returnedModelList = "";
    let savedProvider: ManagedProviderDefinition | undefined;
    const discoveredProvider: ManagedProviderDefinition = {
      ...provider,
      modelSource: { type: "discover", modelIds: ["chat-model", "wan-image"], ignoredModelIds: [] },
      protocolRules: [{ pattern: "wan-image", api: "openai-responses" }],
    };
    const theme = { fg(_color: string, text: string) { return text; }, bold(text: string) { return text; } };
    const context = {
      mode: "tui",
      model: undefined,
      modelRegistry: { getProvider() { return undefined; } },
      ui: {
        theme,
        async select() { return selections.shift(); },
        async confirm() { return true; },
        notify() {},
        custom(factory: Function) {
          customCall++;
          return new Promise((resolve) => {
            const component = factory({ requestRender() {} }, theme, getKeybindings(), resolve);
            if (customCall === 1) {
              component.handleInput?.("\x1b[B");
              component.handleInput?.("\x1b[B");
              component.handleInput?.("\r");
            } else if (customCall === 2) {
              component.handleInput?.("\x1b[B");
              component.handleInput?.("\r");
            } else if (customCall === 3) component.handleInput?.("\r");
            else if (customCall === 4) {
              returnedModelList = component.render(100).join("\n");
              component.handleInput?.("\x1b");
            } else component.handleInput?.("\x1b");
          });
        },
      },
    };
    const orchestrator = {
      snapshot() { return { version: 1, language: "en", providers: [savedProvider ?? discoveredProvider] }; },
      hasConfiguredApiKey() { return true; },
      async saveProvider(_pi: unknown, next: ManagedProviderDefinition) { savedProvider = next; },
    };
    await runPiManagedProvidersCommand({} as never, context as never, orchestrator as never);
    expect(savedProvider?.modelSource).toEqual({
      type: "discover",
      modelIds: ["chat-model"],
      ignoredModelIds: ["wan-image"],
    });
    expect(savedProvider?.protocolRules).toEqual([]);
    expect(returnedModelList).toContain("Models");
    expect(returnedModelList).toContain("chat-model");
    expect(returnedModelList).not.toContain("wan-image");
  });
});

describe("provider management home", () => {
  test("renders add first and configured providers below a labeled divider", () => {
    const passthroughTheme = {
      fg(_color: string, text: string) { return text; },
      bold(text: string) { return text; },
    };
    const component = new PiManagedProviderHomeComponent(
      createManagedProviderTranslator("en"),
      "English",
      [provider],
      new Set([provider.id]),
      { matches() { return false; } } as never,
      passthroughTheme as never,
      () => {},
      () => {},
    );
    const lines = component.render(100);
    expect(lines.indexOf("› Add provider")).toBeLessThan(lines.indexOf("  Language · English"));
    expect(lines.indexOf("  Language · English")).toBeLessThan(lines.findIndex((line) => line.startsWith("Configured providers (1)")));
    expect(lines.findIndex((line) => line.startsWith("Configured providers (1)"))).toBeLessThan(lines.indexOf("  Test Provider"));
  });

  test("renders the language row without mixed-language names", () => {
    const passthroughTheme = {
      fg(_color: string, text: string) { return text; },
      bold(text: string) { return text; },
    };
    const component = new PiManagedProviderHomeComponent(
      createManagedProviderTranslator("zh-CN"),
      "中文（简体）",
      [],
      new Set(),
      { matches() { return false; } } as never,
      passthroughTheme as never,
      () => {},
      () => {},
    );
    const text = component.render(80).join("\n");
    expect(text).toContain("语言 · 中文（简体）");
    expect(text).toContain("添加供应商");
    expect(text).not.toContain("English");
  });
});

describe("stored state", () => {
  test("strictly accepts the current internal format and rejects secrets", () => {
    const state = parseManagedProviderState({ version: 1, providers: [provider] });
    expect(state.language).toBe("auto");
    expect(state.providers[0]?.id).toBe(provider.id);
    expect(() => parseManagedProviderState({
      version: 1,
      providers: [{ ...provider, apiKey: "must-not-be-here" }],
    })).toThrow("unsupported setting");
    const discovered = parseManagedProviderState({
      version: 1,
      providers: [{
        ...provider,
        modelSource: { type: "discover", modelIds: ["chat-model"] },
      }],
    });
    expect(discovered.providers[0]?.modelSource).toEqual({
      type: "discover",
      modelIds: ["chat-model"],
      ignoredModelIds: [],
    });
    expect(() => parseManagedProviderState({
      version: 1,
      providers: [{
        ...provider,
        modelSource: { type: "discover", modelIds: ["chat-model"], ignoredModelIds: ["chat-model"] },
      }],
    })).toThrow("cannot remain");
  });
});
