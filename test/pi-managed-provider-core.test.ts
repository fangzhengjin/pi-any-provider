import { describe, expect, test } from "bun:test";
import {
  buildManagedProviderModel,
  discoverManagedProviderModelIds,
  parseManagedProviderCatalogResponse,
} from "../src/pi-managed-provider-catalog.js";
import type { ManagedProviderDefinition } from "../src/pi-managed-provider-contracts.js";
import { applyPiManagedProviderConnectionInput } from "../src/pi-managed-provider-edit.js";
import {
  formatProviderRootUrlForDisplay,
  getProviderApiBaseUrl,
  getProviderDiscoveryUrl,
  matchesProviderProtocolPattern,
  normalizeProviderRootUrl,
  resolveProviderModelApi,
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

describe("provider URL and routing", () => {
  test("normalizes a gateway root once for every protocol", () => {
    expect(normalizeProviderRootUrl(" https://gateway.example.com/v1/ ")).toBe("https://gateway.example.com");
    expect(getProviderDiscoveryUrl("https://gateway.example.com/v1")).toBe("https://gateway.example.com/v1/models");
    expect(formatProviderRootUrlForDisplay("https://gateway.example.com/private/path")).toBe("https://gateway.example.com");
    expect(getProviderApiBaseUrl("https://gateway.example.com/v1", "anthropic-messages")).toBe("https://gateway.example.com");
    expect(getProviderApiBaseUrl("https://gateway.example.com/v1", "openai-responses")).toBe("https://gateway.example.com/v1");
  });

  test("uses ordered minimal wildcard rules", () => {
    expect(matchesProviderProtocolPattern("gpt-5", "gpt-*")).toBe(true);
    expect(matchesProviderProtocolPattern("gpt-a", "gpt-?")).toBe(true);
    expect(matchesProviderProtocolPattern("gpt-ab", "gpt-?")).toBe(false);
    expect(resolveProviderModelApi("gpt-5", provider.defaultApi, provider.protocolRules)).toBe("openai-responses");
    expect(resolveProviderModelApi("claude-opus-4-8", provider.defaultApi, provider.protocolRules)).toBe("anthropic-messages");
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

describe("provider management home", () => {
  test("renders add first and configured providers below a labeled divider", () => {
    const passthroughTheme = {
      fg(_color: string, text: string) { return text; },
      bold(text: string) { return text; },
    };
    const component = new PiManagedProviderHomeComponent(
      [provider],
      new Set([provider.id]),
      { matches() { return false; } } as never,
      passthroughTheme as never,
      () => {},
      () => {},
    );
    const lines = component.render(100);
    expect(lines.indexOf("› Add provider")).toBeLessThan(lines.findIndex((line) => line.startsWith("Configured providers (1)")));
    expect(lines.findIndex((line) => line.startsWith("Configured providers (1)"))).toBeLessThan(lines.indexOf("  Test Provider"));
  });
});

describe("stored state", () => {
  test("strictly accepts the current internal format and rejects secrets", () => {
    const state = parseManagedProviderState({ version: 1, providers: [provider] });
    expect(state.providers[0]?.id).toBe(provider.id);
    expect(() => parseManagedProviderState({
      version: 1,
      providers: [{ ...provider, apiKey: "must-not-be-here" }],
    })).toThrow("unsupported setting");
  });
});
