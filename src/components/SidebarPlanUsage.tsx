import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { meterBand, type MeterBand } from "@/lib/usage-meter";
import { api, useStore } from "@/state/store";

export const POLL_MS = 5 * 60_000;
export const WAKE_GAP_MS = 60_000;
const PRODUCT = "Claude";

type PlanWindowUse = { available: boolean; usedPercent: number | null; remainingPercent: number | null };
export type SidebarPlanReport = { providers: Array<{ id: string; name: string; driver: string; ok: boolean; fiveHour: PlanWindowUse; weekly: PlanWindowUse }> };

export interface SidebarPlanWindow { label: string; percent: number }
export type SidebarPlanView =
  | { state: "ok"; name: string; windows: SidebarPlanWindow[] }
  | { state: "unavailable"; name: string };

export function windowPercent(use: PlanWindowUse): number | null {
  if (!use.available || use.usedPercent === null) return null;
  if (use.remainingPercent === 0 || use.usedPercent >= 100) return 100;
  return Math.min(99, Math.max(0, Math.floor(use.usedPercent)));
}

export const planTitle = (name: string) => (name.startsWith(PRODUCT) ? name : `${PRODUCT} · ${name}`);

const claudeRows = (report: SidebarPlanReport | null) => report?.providers.filter((provider) => provider.driver === "claude") ?? [];

export function sidebarPlanView(report: SidebarPlanReport | null): SidebarPlanView | null {
  const claude = claudeRows(report);
  const rows = claude
    .filter((provider) => provider.ok)
    .map((provider) => ({
      provider,
      windows: [
        { label: t("planUsage.fiveHour"), percent: windowPercent(provider.fiveHour) },
        { label: t("planUsage.weekly"), percent: windowPercent(provider.weekly) },
      ].filter((entry): entry is SidebarPlanWindow => entry.percent !== null),
    }))
    .filter((row) => row.windows.length > 0);
  if (rows.length === 0) {
    const failed = claude.find((provider) => !provider.ok);
    return failed ? { state: "unavailable", name: planTitle(failed.name) } : null;
  }
  const busiest = (row: (typeof rows)[number]) => Math.max(...row.windows.map((entry) => entry.percent));
  const tightest = rows.reduce((most, row) => (busiest(row) > busiest(most) ? row : most));
  return { state: "ok", name: planTitle(tightest.provider.name), windows: tightest.windows };
}

export interface PlanPollerHost {
  now(): number;
  visible(): boolean;
  every(run: () => void, ms: number): () => void;
  onWake(run: () => void): () => void;
}

export function startPlanPoller(load: () => void, host: PlanPollerHost, options: { every: number | null; last: { at: number } }): () => void {
  const run = (gap: number) => {
    if (!host.visible() || host.now() - options.last.at < gap) return;
    options.last.at = host.now();
    load();
  };
  run(WAKE_GAP_MS);
  const stopTimer = options.every === null ? () => {} : host.every(() => run(0), options.every);
  const stopWake = host.onWake(() => run(WAKE_GAP_MS));
  return () => { stopTimer(); stopWake(); };
}

const browserHost: PlanPollerHost = {
  now: () => Date.now(),
  visible: () => document.visibilityState === "visible",
  every: (run, ms) => { const timer = window.setInterval(run, ms); return () => window.clearInterval(timer); },
  onWake: (run) => {
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    return () => { window.removeEventListener("focus", run); document.removeEventListener("visibilitychange", run); };
  },
};

function useSidebarPlanReport(enabled: boolean): SidebarPlanReport | null {
  const [report, setReport] = useState<SidebarPlanReport | null>(null);
  const last = useRef({ at: Number.NEGATIVE_INFINITY });
  const noClaude = report !== null && claudeRows(report).length === 0;
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => {
      void api<SidebarPlanReport>("/api/plan-usage", { background: true })
        .then((next) => { if (alive) setReport(next); })
        .catch(() => {});
    };
    const stop = startPlanPoller(load, browserHost, { every: noClaude ? null : POLL_MS, last: last.current });
    return () => { alive = false; stop(); };
  }, [enabled, noClaude]);
  return enabled ? report : null;
}

const BAR: Record<MeterBand, string> = { ok: "bg-accent", near: "bg-warning", full: "bg-danger" };
const AMOUNT: Record<MeterBand, string> = { ok: "text-ink-secondary", near: "text-warning", full: "text-danger" };

export function sidebarPlanLabel(view: SidebarPlanView): string {
  const detail = view.state === "ok" ? view.windows.map((entry) => `${entry.label} ${entry.percent}%`).join(", ") : t("planUsage.fetchError");
  return `${view.name}: ${detail} ${t("planUsage.title")}`;
}

export function SidebarPlanUsageView({ view, onOpen }: { view: SidebarPlanView; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} data-sidebar-plan-usage={view.state} aria-label={sidebarPlanLabel(view)} title={t("planUsage.title")}
      className="mb-2 block w-full rounded-lg px-2 py-1.5 text-start hover:bg-control/50">
      <span aria-hidden="true" className="mb-1 block truncate text-[11px] font-medium text-ink-secondary">{view.name}</span>
      {view.state === "unavailable" ? (
        <span aria-hidden="true" className="block truncate text-[11px] text-ink-secondary">{t("planUsage.fetchError")}</span>
      ) : view.windows.map((entry) => {
        const band = meterBand(entry.percent);
        return (
          <span key={entry.label} aria-hidden="true" className="mt-1 flex items-center gap-2 text-[11px]">
            <span className="w-12 shrink-0 text-ink-secondary">{entry.label}</span>
            <span data-band={band} className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-inset">
              <span className={cn("block h-full rounded-full", BAR[band])} style={{ width: `${entry.percent > 0 ? Math.max(entry.percent, 2) : 0}%` }} />
            </span>
            <span className={cn("w-8 shrink-0 text-end tabular-nums", AMOUNT[band])}>{entry.percent}%</span>
          </span>
        );
      })}
    </button>
  );
}

export function SidebarPlanUsage() {
  const { state, dispatch } = useStore();
  const enabled = state.config?.cloudHome !== true && window.ogb?.remoteClient?.active !== true;
  const view = sidebarPlanView(useSidebarPlanReport(enabled));
  if (!view) return null;
  return <SidebarPlanUsageView view={view} onOpen={() => dispatch({ type: "toggleAppSettings", open: true, section: "usage" })} />;
}
