import { describe, expect, test } from "bun:test";
import { parse } from "jsonc-parser";
import {
  buildManagedProviderModel,
  discoverManagedProviderModelIds,
  parseManagedProviderCatalogResponse,
} from "../src/pi-managed-provider-catalog.js";
import { saveManagedProviderAndRestoreActiveModel } from "../src/pi-managed-provider-command.js";
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
import {
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
    expect(deepseek.compat).toBeUndefined();

    const claude = buildManagedProviderModel(provider, "claude-opus-4-8");
    expect(claude.api).toBe("anthropic-messages");
    expect((claude.compat as Record<string, unknown>).forceAdaptiveThinking).toBe(true);
    expect((claude.compat as Record<string, unknown>).supportsDeveloperRole).toBeUndefined();

    const crossProtocolProvider = { ...provider, defaultApi: "openai-responses" as const, protocolRules: [] };
    const crossProtocol = buildManagedProviderModel(crossProtocolProvider, "claude-opus-4-8");
    expect(crossProtocol.api).toBe("openai-responses");
    expect(crossProtocol.reasoning).toBe(true);
    expect(crossProtocol.contextWindow).toBe(claude.contextWindow);
    expect(crossProtocol.compat).toBeUndefined();
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

  test("uses inherit to remove managed fields and prunes empty override nodes", () => {
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
  });
});
