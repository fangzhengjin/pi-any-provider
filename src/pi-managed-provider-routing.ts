import type { ManagedProviderDefinition, SupportedProviderApi } from "./pi-managed-provider-contracts.js";

export function normalizeProviderRootUrl(value: string): string {
  const normalized = value.trim();
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("API URL must be a valid absolute HTTP(S) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("API URL must not contain credentials");
  }
  url.hash = "";
  url.search = "";
  const path = url.pathname.replace(/\/+$/u, "").replace(/\/v1$/u, "");
  url.pathname = path || "/";
  return url.toString().replace(/\/$/u, "");
}

export function formatProviderRootUrlForDisplay(rootUrl: string): string {
  const url = new URL(normalizeProviderRootUrl(rootUrl));
  return `${url.protocol}//${url.host}`;
}

export function getProviderDiscoveryUrl(rootUrl: string): string {
  return `${normalizeProviderRootUrl(rootUrl)}/v1/models`;
}

export function getProviderApiBaseUrl(rootUrl: string, api: SupportedProviderApi): string {
  const root = normalizeProviderRootUrl(rootUrl);
  return api === "openai-responses" ? `${root}/v1` : root;
}

function escapeProviderRuleCharacter(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
}

export function matchesProviderProtocolPattern(modelId: string, pattern: string): boolean {
  const expression = [...pattern]
    .map((character) => character === "*" ? ".*" : character === "?" ? "." : escapeProviderRuleCharacter(character))
    .join("");
  return new RegExp(`^${expression}$`, "u").test(modelId);
}

export function resolveProviderModelApi(
  modelId: string,
  defaultApi: SupportedProviderApi,
  rules: ManagedProviderDefinition["protocolRules"],
): SupportedProviderApi {
  for (const rule of rules) {
    if (matchesProviderProtocolPattern(modelId, rule.pattern)) return rule.api;
  }
  return defaultApi;
}
