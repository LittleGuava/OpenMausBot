// The model picker looks for an engine's local models with a refresh that never holds it past the timeout.
import type { InstanceInfo } from "@/state/store";
import { needsCli, needsSignIn } from "./EngineSetup";

export const LOCAL_PROBE_TIMEOUT_MS = 5_000;

export function probeLocalModels(
  instanceId: string,
  refreshModels: (instanceId: string) => Promise<void>,
  timeoutMs = LOCAL_PROBE_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void refreshModels(instanceId)
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

/** Engines whose stand-in list this page already asked to replace: a read that fails is not retried at every open. */
const standInReads = new Set<string>();

/** A lazy engine whose list is a stand-in (GitHub Copilot's lone "Auto") is read in the background the first time the
 * picker opens, apart from its Refresh button. A signed-out one waits for its sign-in, which reads it. */
export function readStandInModels(instances: readonly InstanceInfo[], refreshModels: (instanceId: string) => Promise<void>): void {
  for (const instance of instances) {
    const { instanceId } = instance;
    if (!instance.models.placeholder || needsCli(instance) || needsSignIn(instance) || instance.policy || standInReads.has(instanceId)) continue;
    standInReads.add(instanceId);
    void refreshModels(instanceId).catch(() => {});
  }
}

export function offersLocalModels(instance: InstanceInfo | undefined, localCount: number): boolean {
  if (!instance) return false;
  return localCount > 0 || (instance.driverKind === "claudeAgent" && !needsCli(instance) && !instance.policy);
}
