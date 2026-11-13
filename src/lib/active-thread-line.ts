import type { AttentionThread } from "@/components/SidebarBotActivity";
import type { Group } from "@/state/store";

export const RUNS_LONG_MS = 40 * 60_000;

export type StopActiveThread =
  | { type: "interrupt"; botId: string; threadId: string }
  | { type: "interruptGroup"; groupId: string; threadId: string };

function working(task: AttentionThread["task"]): boolean {
  if (task.activity === "waiting-on-you" || task.waitingForTeammates === true) return false;
  return task.busy === true || task.activity === "working";
}

export function stopActionFor(entry: AttentionThread): StopActiveThread | null {
  if (!working(entry.task)) return null;
  const { threadId } = entry.task;
  return entry.kind === "bot"
    ? { type: "interrupt", botId: entry.botId, threadId }
    : { type: "interruptGroup", groupId: entry.groupId, threadId };
}

/** A room keeps one turn start, for the conversation it has open. */
export function activeTurnStart(entry: AttentionThread, groups: ReadonlyArray<Pick<Group, "id" | "turnStartedAt">>): number | undefined {
  if (!working(entry.task)) return undefined;
  if (entry.kind === "bot") return entry.task.turnStartedAt;
  if (entry.task.threadId !== entry.groupThreadId) return undefined;
  return groups.find((candidate) => candidate.id === entry.groupId)?.turnStartedAt ?? undefined;
}

export function runsLong(startedAt: number, now: number): boolean {
  return now - startedAt >= RUNS_LONG_MS;
}
