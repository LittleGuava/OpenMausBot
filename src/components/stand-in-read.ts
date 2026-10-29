// GitHub Copilot lists only a stand-in "Auto" (`placeholder`) until its first read; the picker asks for that read.
import type { InstanceInfo } from "@/state/store";
import { needsCli, needsSignIn } from "./EngineSetup";

/** Engines this page already asked to replace their stand-in list: a read that fails is not retried at every open. */
const asked = new Set<string>();

/** Reads, in the background and apart from the picker's Refresh, each listed engine still on a stand-in list. A
 * signed-out one waits for its sign-in, which reads it. */
export function readStandInModels(instances: readonly InstanceInfo[], refreshModels: (instanceId: string) => Promise<void>): void {
  for (const instance of instances) {
    const { instanceId } = instance;
    if (!instance.models.placeholder || needsCli(instance) || needsSignIn(instance) || instance.policy || asked.has(instanceId)) continue;
    asked.add(instanceId);
    void refreshModels(instanceId).catch(() => {});
  }
}

/** Tests only: a fresh page. */
export function forgetStandInReads(): void {
  asked.clear();
}
