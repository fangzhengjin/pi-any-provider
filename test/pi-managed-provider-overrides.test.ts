import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createOverrideAgent(): Promise<{ agentDir: string; originalModels: string }> {
  const root = await mkdtemp(join(tmpdir(), "pi-custom-provider-overrides-"));
  temporaryDirectories.push(root);
  const agentDir = join(root, "agent");
  await mkdir(join(agentDir, "extension-settings"), { recursive: true });
  await writeFile(
    join(agentDir, "extension-settings", "pi-custom-provider.json"),
    `${JSON.stringify({
      version: 1,
      language: "en",
      providers: [
        {
          id: "integration-provider",
          name: "Integration Provider",
          rootUrl: "https://gateway.example.com",
          modelSource: { type: "manual", modelIds: ["claude-opus-4-8"] },
          defaultApi: "anthropic-messages",
          protocolRules: [],
        },
      ],
    }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await writeFile(
    join(agentDir, "auth.json"),
    `${JSON.stringify({ "integration-provider": { type: "api_key", key: "integration-key" } }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  const originalModels = `{
  // Preserve this user comment
  "providers": {
    "integration-provider": {
      "modelOverrides": {
        "claude-opus-4-8": {
          "compat": { "forceAdaptiveThinking": true }
        }
      }
    }
  }
}\n`;
  await writeFile(join(agentDir, "models.json"), originalModels, { encoding: "utf8", mode: 0o600 });
  await chmod(join(agentDir, "models.json"), 0o600);
  return { agentDir, originalModels };
}

describe("native model override orchestration", () => {
  test("refreshes the provider and rebinds an active model after a successful write", async () => {
    const { agentDir } = await createOverrideAgent();
    const script = `
      import { readFile, stat } from "node:fs/promises";
      import { createPiManagedProviderOrchestrator } from ${JSON.stringify(join(import.meta.dir, "../src/pi-managed-provider-orchestrator.ts"))};
      const provider = {
        id: "integration-provider",
        name: "Integration Provider",
        rootUrl: "https://gateway.example.com",
        modelSource: { type: "manual", modelIds: ["claude-opus-4-8"] },
        defaultApi: "anthropic-messages",
        protocolRules: [],
      };
      let selectedModel;
      let refreshCalls = 0;
      const pi = {
        registerProvider() {},
        unregisterProvider() {},
        async setModel(model) { selectedModel = model; return true; },
      };
      const orchestrator = createPiManagedProviderOrchestrator();
      await orchestrator.load(pi);
      const context = {
        model: { provider: provider.id, id: "claude-opus-4-8" },
        modelRegistry: {
          async refresh() { refreshCalls++; return { aborted: false, errors: new Map() }; },
          getError() { return undefined; },
          find() { return { provider: provider.id, id: "claude-opus-4-8", compat: { supportsStrictTools: true } }; },
        },
      };
      const changed = await orchestrator.saveModelOverrides(
        pi,
        context,
        provider,
        "claude-opus-4-8",
        { forceAdaptiveThinking: true, supportsStrictTools: true },
      );
      const modelsPath = ${JSON.stringify(join(agentDir, "models.json"))};
      process.stdout.write(JSON.stringify({
        changed,
        refreshCalls,
        selectedModel,
        modelsText: await readFile(modelsPath, "utf8"),
        mode: (await stat(modelsPath)).mode & 0o777,
        backupMode: (await stat(modelsPath + ".pi-custom-provider-backup")).mode & 0o777,
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
      changed: boolean;
      refreshCalls: number;
      selectedModel: { id: string };
      modelsText: string;
      mode: number;
      backupMode: number;
    };
    expect(output.changed).toBe(true);
    expect(output.refreshCalls).toBe(1);
    expect(output.selectedModel.id).toBe("claude-opus-4-8");
    expect(output.modelsText).toContain("// Preserve this user comment");
    expect(output.modelsText).toContain('"supportsStrictTools": true');
    expect(output.mode).toBe(0o600);
    expect(output.backupMode).toBe(0o600);
  });

  test("persists an explicit language preference without changing provider data", async () => {
    const { agentDir } = await createOverrideAgent();
    const script = `
      import { readFile } from "node:fs/promises";
      import { createPiManagedProviderOrchestrator } from ${JSON.stringify(join(import.meta.dir, "../src/pi-managed-provider-orchestrator.ts"))};
      const pi = { registerProvider() {}, unregisterProvider() {} };
      const orchestrator = createPiManagedProviderOrchestrator();
      await orchestrator.load(pi);
      await orchestrator.setLanguage("zh-CN");
      const state = JSON.parse(await readFile(${JSON.stringify(join(agentDir, "extension-settings", "pi-custom-provider.json"))}, "utf8"));
      process.stdout.write(JSON.stringify({ state, snapshot: orchestrator.snapshot() }));
    `;
    const result = Bun.spawnSync([process.execPath, "-e", script], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const output = JSON.parse(result.stdout.toString()) as {
      state: { language: string; providers: unknown[] };
      snapshot: { language: string; providers: unknown[] };
    };
    expect(output.state.language).toBe("zh-CN");
    expect(output.snapshot.language).toBe("zh-CN");
    expect(output.state.providers).toHaveLength(1);
  });

  test("restores the original file and runtime after refresh failure", async () => {
    const { agentDir, originalModels } = await createOverrideAgent();
    const script = `
      import { readFile } from "node:fs/promises";
      import { createPiManagedProviderOrchestrator } from ${JSON.stringify(join(import.meta.dir, "../src/pi-managed-provider-orchestrator.ts"))};
      const provider = {
        id: "integration-provider",
        name: "Integration Provider",
        rootUrl: "https://gateway.example.com",
        modelSource: { type: "manual", modelIds: ["claude-opus-4-8"] },
        defaultApi: "anthropic-messages",
        protocolRules: [],
      };
      let refreshCalls = 0;
      const pi = { registerProvider() {}, unregisterProvider() {}, async setModel() { return true; } };
      const orchestrator = createPiManagedProviderOrchestrator();
      await orchestrator.load(pi);
      const context = {
        model: undefined,
        modelRegistry: {
          async refresh() {
            refreshCalls++;
            return refreshCalls === 1
              ? { aborted: false, errors: new Map([[provider.id, new Error("simulated refresh failure")]]) }
              : { aborted: false, errors: new Map() };
          },
          getError() { return undefined; },
          find() { return { provider: provider.id, id: "claude-opus-4-8" }; },
        },
      };
      let error;
      try {
        await orchestrator.saveModelOverrides(
          pi,
          context,
          provider,
          "claude-opus-4-8",
          { forceAdaptiveThinking: true, supportsStrictTools: true },
        );
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      process.stdout.write(JSON.stringify({
        error,
        refreshCalls,
        modelsText: await readFile(${JSON.stringify(join(agentDir, "models.json"))}, "utf8"),
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
      error: string;
      refreshCalls: number;
      modelsText: string;
    };
    expect(output.error).toContain("simulated refresh failure");
    expect(output.refreshCalls).toBe(2);
    expect(output.modelsText).toBe(originalModels);
  });
});
