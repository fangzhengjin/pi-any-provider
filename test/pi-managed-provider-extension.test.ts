import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createIsolatedPiAgent(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-any-provider-test-"));
  temporaryDirectories.push(root);
  const agentDir = join(root, "agent");
  await mkdir(join(agentDir, "extension-settings"), { recursive: true });
  await writeFile(
    join(agentDir, "extension-settings", "pi-any-provider.json"),
    `${JSON.stringify({
      version: 1,
      language: "en",
      providers: [
        {
          id: "integration-provider",
          name: "Integration Provider",
          rootUrl: "https://gateway.example.com",
          modelSource: { type: "discover", modelIds: ["claude-opus-4-8", "gpt-5.4"], ignoredModelIds: [] },
          defaultApi: "anthropic-messages",
          protocolRules: [{ pattern: "gpt-*", api: "openai-responses" }],
        },
      ],
    }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await writeFile(
    join(agentDir, "auth.json"),
    `${JSON.stringify({ "integration-provider": { type: "api_key", key: "integration-test-key" } }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(join(agentDir, "extension-settings", "pi-any-provider.json"), 0o600);
  return agentDir;
}

describe("extension integration", () => {
  test("adds a manual provider through the TUI without storing the key in extension state", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-any-provider-tui-test-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    await mkdir(join(agentDir, "extension-settings"), { recursive: true });
    await writeFile(
      join(agentDir, "extension-settings", "pi-any-provider.json"),
      `${JSON.stringify({ version: 1, language: "en", providers: [] }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    const script = `
      import { readFile, stat } from "node:fs/promises";
      import { getKeybindings } from "@earendil-works/pi-tui";
      import extension from ${JSON.stringify(join(import.meta.dir, "../src/pi-any-provider-extension.ts"))};
      const registrations = [];
      let command;
      const pi = {
        registerProvider(id, config) { registrations.push({ id, config }); },
        unregisterProvider() {},
        registerCommand(_name, options) { command = options; },
        on() {},
      };
      await extension(pi);
      const inputs = ["Manual Provider", "https://manual.example.com/v1/", "model-one, model-two"];
      const selections = [
        "Anthropic Messages · /v1/messages",
        "Add model identifiers manually",
        "Set protocol for a model",
        "OpenAI Responses · /v1/responses",
        "Save and return",
      ];
      let customCall = 0;
      const inputTitles = [];
      const selectTitles = [];
      const customRenders = [];
      const notifications = [];
      const confirmations = [true, true];
      const theme = {
        fg(_color, text) { return text; },
        bg(_color, text) { return text; },
        bold(text) { return text; },
      };
      const context = {
        mode: "tui",
        model: undefined,
        modelRegistry: {
          getProvider() { return undefined; },
          async getApiKeyForProvider() { return undefined; },
        },
        ui: {
          theme,
          async input(title) { inputTitles.push(title); return inputs.shift(); },
          async select(title) { selectTitles.push(title); return selections.shift(); },
          async confirm() { return confirmations.shift() ?? false; },
          notify(message, type) { notifications.push({ message, type }); },
          custom(factory) {
            customCall++;
            return new Promise((resolve) => {
              const component = factory({ requestRender() {} }, theme, getKeybindings(), resolve);
              if (customCall === 1) component.handleInput?.("\\r");
              else if (customCall === 2) {
                for (const character of "manual-secret") component.handleInput?.(character);
                component.handleInput?.("\\r");
              } else if (customCall === 3) {
                customRenders.push(component.render(100));
                component.handleInput?.("\\r");
              } else component.handleInput?.("\\x1b");
            });
          },
        },
      };
      await command.handler("", context);
      const statePath = ${JSON.stringify(join(agentDir, "extension-settings", "pi-any-provider.json"))};
      const authPath = ${JSON.stringify(join(agentDir, "auth.json"))};
      const stateText = await readFile(statePath, "utf8");
      const authText = await readFile(authPath, "utf8");
      const state = JSON.parse(stateText);
      const auth = JSON.parse(authText);
      process.stdout.write(JSON.stringify({
        state,
        stateContainsSecret: stateText.includes("manual-secret"),
        storedKey: auth["manual-provider"]?.key,
        registration: registrations.at(-1),
        refreshable: typeof registrations.at(-1)?.config.refreshModels === "function",
        mode: (await stat(statePath)).mode & 0o777,
        inputTitles,
        selectTitles,
        customRenders,
        notifications,
      }));
    `;
    const result = Bun.spawnSync([process.execPath, "-e", script], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const output = JSON.parse(result.stdout.toString()) as {
      state: {
        providers: Array<{
          rootUrl: string;
          modelSource: { modelIds: string[] };
          protocolRules: Array<{ pattern: string; api: string }>;
        }>;
      };
      stateContainsSecret: boolean;
      storedKey: string;
      registration: { id: string; config: { models: Array<{ id: string }> } };
      refreshable: boolean;
      mode: number;
      inputTitles: string[];
      selectTitles: string[];
      customRenders: string[][];
    };
    expect(output.inputTitles).toEqual(["Provider name", "API URL", "Model identifiers"]);
    expect(output.selectTitles).toContain("Default protocol · fallback when no model rule matches");
    const protocolModelPage = output.customRenders[0]!.join("\n");
    expect(protocolModelPage).toContain("Model request protocol");
    expect(protocolModelPage).toContain("model-one");
    expect(protocolModelPage).toContain("Anthropic Messages");
    expect(protocolModelPage).toContain("Fallback/default");
    expect(output.stateContainsSecret).toBe(false);
    expect(output.storedKey).toBe("manual-secret");
    expect(output.state.providers[0]).toMatchObject({
      rootUrl: "https://manual.example.com",
      modelSource: { modelIds: ["model-one", "model-two"] },
      protocolRules: [{ pattern: "model-one", api: "openai-responses" }],
    });
    expect(output.registration.id).toBe("manual-provider");
    expect(output.registration.config.models.map((model) => model.id)).toEqual(["model-one", "model-two"]);
    expect(output.refreshable).toBe(false);
    expect(output.mode).toBe(0o600);
  });

  test("loads isolated state, registers mixed modern protocols, and exposes /providers", async () => {
    const agentDir = await createIsolatedPiAgent();
    const script = `
      import { readFile } from "node:fs/promises";
      import extension from ${JSON.stringify(join(import.meta.dir, "../src/pi-any-provider-extension.ts"))};
      const registrations = [];
      const commands = [];
      const pi = {
        registerProvider(id, config) { registrations.push({ id, config }); },
        unregisterProvider() {},
        registerCommand(name, options) { commands.push({ name, options }); },
        on() {},
      };
      await extension(pi);
      const modelsText = await readFile(${JSON.stringify(join(agentDir, "models.json"))}, "utf8");
      process.stdout.write(JSON.stringify({
        registrations,
        refreshable: registrations.map((entry) => typeof entry.config.refreshModels === "function"),
        modelsText,
        commands: commands.map((entry) => entry.name),
      }));
    `;
    const result = Bun.spawnSync([process.execPath, "-e", script], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout.toString()) as {
      registrations: Array<{ id: string; config: { models: Array<{ id: string; api: string; baseUrl: string; compat: Record<string, unknown> }> } }>;
      refreshable: boolean[];
      modelsText: string;
      commands: string[];
    };
    expect(output.commands).toContain("providers");
    expect(output.registrations).toHaveLength(1);
    expect(output.refreshable).toEqual([true]);
    const models = output.registrations[0]!.config.models;
    expect(models.find((model) => model.id === "claude-opus-4-8")).toMatchObject({
      api: "anthropic-messages",
      baseUrl: "https://gateway.example.com",
      compat: { forceAdaptiveThinking: true, supportsTemperature: false, supportsStrictTools: true },
    });
    expect(models.find((model) => model.id === "gpt-5.4")).toMatchObject({
      api: "openai-responses",
      baseUrl: "https://gateway.example.com/v1",
      compat: { sessionAffinityFormat: "openai", supportsAdditionalTools: false },
    });
    expect(output.modelsText).toContain('"forceAdaptiveThinking": true');
    expect(output.modelsText).toContain('"sessionAffinityFormat": "openai"');
  });
});
