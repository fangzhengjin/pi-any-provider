import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

type PiManagedProviderProtectedModule = "state" | "credentials" | "registration" | "model-overrides";

const piManagedProviderBusinessPaths = {
  orchestrator: fileURLToPath(new URL("./pi-managed-provider-orchestrator.ts", import.meta.url)),
  state: fileURLToPath(new URL("./pi-managed-provider-state.ts", import.meta.url)),
  credentials: fileURLToPath(new URL("./pi-managed-provider-credentials.ts", import.meta.url)),
  registration: fileURLToPath(new URL("./pi-managed-provider-registration.ts", import.meta.url)),
  modelOverrides: fileURLToPath(new URL("./pi-managed-provider-model-overrides.ts", import.meta.url)),
} as const;

const piManagedProviderCallerWhitelist: Record<PiManagedProviderProtectedModule, readonly string[]> = {
  state: [piManagedProviderBusinessPaths.orchestrator],
  credentials: [piManagedProviderBusinessPaths.orchestrator],
  registration: [piManagedProviderBusinessPaths.orchestrator],
  "model-overrides": [piManagedProviderBusinessPaths.orchestrator],
};

let piManagedProviderWhitelistValidation: Promise<void> | undefined;

async function validatePiManagedProviderCallerWhitelist(): Promise<void> {
  const paths = new Set([
    ...Object.values(piManagedProviderBusinessPaths),
    ...Object.values(piManagedProviderCallerWhitelist).flat(),
  ]);
  await Promise.all([...paths].map((path) => access(path)));
}

export async function assertPiManagedProviderCaller(
  target: PiManagedProviderProtectedModule,
  callerPath: string,
): Promise<void> {
  piManagedProviderWhitelistValidation ??= validatePiManagedProviderCallerWhitelist();
  await piManagedProviderWhitelistValidation;
  const allowed = piManagedProviderCallerWhitelist[target];
  if (allowed.includes(callerPath)) return;
  throw new Error(`PI managed provider ${target} must be called through ${allowed.join(" or ")}`);
}
