import { useEffect, useRef, useState } from "react";
import { Square } from "lucide-react";
import { activeTurnStart, RUNS_LONG_MS, runsLong, stopActionFor, type StopActiveThread } from "@/lib/active-thread-line";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { sidebarStatus, turnNowPhrases } from "@/lib/live-activity";
import type { Group } from "@/state/store";
import { useTurnLive } from "@/state/turn-status";
import { attentionOwnerName, attentionRowStatus, type AttentionThread } from "../SidebarBotActivity";
import { useHeldText } from "../SidebarWorkingStep";
import { WorkingTimer } from "../WorkingIndicator";

type Groups = ReadonlyArray<Pick<Group, "id" | "turnStartedAt">>;

export function InboxActiveRows({ entries, groups, onJump, onStop }: {
  entries: AttentionThread[];
  groups: Groups;
  onJump: (entry: AttentionThread) => void;
  onStop: (action: StopActiveThread) => void;
}) {
  return <>
    {entries.map((entry) => (
      <InboxActiveRow key={`${entry.kind}-${entry.kind === "bot" ? entry.botId : entry.groupId}-${entry.task.threadId}`}
        entry={entry} groups={groups} onJump={onJump} onStop={onStop} />
    ))}
  </>;
}

function InboxActiveRow({ entry, groups, onJump, onStop }: {
  entry: AttentionThread;
  groups: Groups;
  onJump: (entry: AttentionThread) => void;
  onStop: (action: StopActiveThread) => void;
}) {
  const { Icon, colorClass, label: status } = attentionRowStatus(entry.task);
  const name = attentionOwnerName(entry);
  const stop = stopActionFor(entry);
  const since = activeTurnStart(entry, groups);
  const step = useStep(entry.task.threadId, stop !== null);
  const open = useRef<HTMLButtonElement>(null);
  return (
    <div data-inbox-active-row="" className="flex w-full items-center rounded-md hover:bg-menu-hover">
      <button ref={open} type="button" data-inbox-active-open="" onClick={() => onJump(entry)}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-ink">
        <Icon size={16} aria-hidden="true" className={cn("shrink-0", colorClass)} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span title={entry.task.title} className="min-w-0 flex-1 truncate">{entry.task.title}</span>
            {since !== undefined && <Elapsed since={since} />}
          </span>
          <span dir="auto" className="block truncate text-[11px] text-ink-secondary">{name} · {step ?? status}</span>
        </span>
      </button>
      {stop && (
        <button type="button" data-inbox-active-stop="" onClick={() => { onStop(stop); open.current?.focus(); }}
          aria-label={t("attention.stopItem", { title: entry.task.title })} title={t("chat.stopTurn")}
          className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus touch:size-11">
          <Square size={11} fill="currentColor" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function useStep(threadId: string, working: boolean): string | undefined {
  const live = useTurnLive(threadId);
  const phrase = working ? turnNowPhrases(sidebarStatus(live.status))?.phrases[0] : undefined;
  return useHeldText(working ? phrase ?? t("chat.activity.working") : undefined);
}

function useRunsLong(since: number): boolean {
  const [long, setLong] = useState(() => runsLong(since, Date.now()));
  useEffect(() => {
    const left = since + RUNS_LONG_MS - Date.now();
    setLong(left <= 0);
    if (left <= 0) return;
    const timer = setTimeout(() => setLong(true), left);
    return () => clearTimeout(timer);
  }, [since]);
  return long;
}

function Elapsed({ since }: { since: number }) {
  const long = useRunsLong(since);
  return <>
    <span data-inbox-active-elapsed="" data-long={long ? "" : undefined}
      className={cn("shrink-0 text-[11px]", long ? "font-medium text-warning" : "text-ink-secondary")}>
      <WorkingTimer since={since} />
    </span>
    {long && <span className="sr-only">{t("attention.runsLong")}</span>}
  </>;
}
