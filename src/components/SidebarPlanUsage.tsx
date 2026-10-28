import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { meterBand, type MeterBand } from "@/lib/usage-meter";
import { api, useStore } from "@/state/store";

const POLL_MS = 5 * 60_000;

type PlanWindowUse = { available: boolean; usedPercent: number | null };
export type SidebarPlanReport = { providers: Array<{ id: string; name: string; driver: string; ok: boolean; fiveHour: PlanWindowUse; weekly: PlanWindowUse }> };

export interface SidebarPlanWindow { label: string; percent: number }
export interface SidebarPlanView { name: string | null; windows: SidebarPlanWindow[] }

const usedPercent = (use: PlanWindowUse): number | null =>
  use.available && use.usedPercent !== null ? Math.round(Math.min(100, Math.max(0, use.usedPercent))) : null;

export function sidebarPlanView(report: SidebarPlanReport | null): SidebarPlanView | null {
  const claude = report?.providers.filter((provider) => provider.ok && provider.driver === "claude") ?? [];
  const rows = claude
    .map((provider) => ({
      provider,
      windows: [
        { label: t("planUsage.fiveHour"), percent: usedPercent(provider.fiveHour) },
        { label: t("planUsage.weekly"), percent: usedPercent(provider.weekly) },
      ].filter((entry): entry is SidebarPlanWindow => entry.percent !== null),
    }))
    .filter((row) => row.windows.length > 0);
  if (rows.length === 0) return null;
  const tightest = rows.reduce((most, row) =>
    Math.max(...row.windows.map((w) => w.percent)) > Math.max(...most.windows.map((w) => w.percent)) ? row : most);
  return { name: rows.length > 1 ? tightest.provider.name : null, windows: tightest.windows };
}

function useSidebarPlanReport(enabled: boolean): SidebarPlanReport | null {
  const [report, setReport] = useState<SidebarPlanReport | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => {
      void api<SidebarPlanReport>("/api/plan-usage", { background: true })
        .then((next) => { if (alive) setReport(next); })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    window.addEventListener("focus", load);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, [enabled]);
  return enabled ? report : null;
}

const BAR: Record<MeterBand, string> = { ok: "bg-accent", near: "bg-warning", full: "bg-danger" };
const AMOUNT: Record<MeterBand, string> = { ok: "text-ink-secondary", near: "text-warning", full: "text-danger" };

export function SidebarPlanUsageView({ view, onOpen }: { view: SidebarPlanView; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} data-sidebar-plan-usage title={t("planUsage.title")}
      className="mb-2 block w-full rounded-lg px-2 py-1.5 text-start hover:bg-control/50">
      <span className="mb-1 block truncate text-[11px] font-medium text-ink-secondary">{view.name ? `Claude · ${view.name}` : "Claude"}</span>
      {view.windows.map((entry) => {
        const band = meterBand(entry.percent);
        return (
          <span key={entry.label} className="mt-1 flex items-center gap-2 text-[11px]">
            <span className="w-12 shrink-0 text-ink-secondary">{entry.label}</span>
            <span role="progressbar" aria-label={`Claude ${entry.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={entry.percent}
              data-band={band} className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-inset">
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
