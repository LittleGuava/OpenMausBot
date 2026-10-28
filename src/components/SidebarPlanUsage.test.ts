import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import {
  planTitle, POLL_MS, sidebarPlanLabel, sidebarPlanView, SidebarPlanUsageView, startPlanPoller, WAKE_GAP_MS, windowPercent,
  type PlanPollerHost, type SidebarPlanReport,
} from "./SidebarPlanUsage";

const use = (usedPercent: number | null, available = true) => ({ available, usedPercent, remainingPercent: usedPercent === null ? null : 100 - usedPercent });
const claude = (id: string, fiveHour: number | null, weekly: number | null, extra: Partial<SidebarPlanReport["providers"][number]> = {}) =>
  ({ id, name: id, driver: "claude", ok: true, fiveHour: use(fiveHour), weekly: use(weekly), ...extra });

describe("sidebarPlanView", () => {
  beforeEach(() => setLocale("en"));

  it("shows the 5-hour and weekly use of the signed-in Claude plan", () => {
    expect(sidebarPlanView({ providers: [claude("Claude", 42.4, 17.6)] })).toEqual({
      state: "ok", name: "Claude", windows: [{ label: "5-hour", percent: 42 }, { label: "Weekly", percent: 17 }],
    });
  });

  it("is hidden without a Claude plan that reports a window", () => {
    expect(sidebarPlanView(null)).toBeNull();
    expect(sidebarPlanView({ providers: [] })).toBeNull();
    expect(sidebarPlanView({ providers: [claude("Codex", 10, 10, { driver: "codex" })] })).toBeNull();
    expect(sidebarPlanView({ providers: [claude("Claude (API key)", null, null)] })).toBeNull();
  });

  it("says the use is unavailable when Claude's usage check fails", () => {
    expect(sidebarPlanView({ providers: [claude("Claude", null, null, { ok: false })] })).toEqual({ state: "unavailable", name: "Claude" });
  });

  it("prefers a working account over a failing one", () => {
    expect(sidebarPlanView({ providers: [claude("Claude", null, null, { ok: false }), claude("Claude (API key)", 30, 5)] }))
      .toMatchObject({ state: "ok", name: "Claude (API key)" });
  });

  it("drops a window the plan does not report", () => {
    expect(sidebarPlanView({ providers: [claude("Claude", 30, null)] })).toMatchObject({ windows: [{ label: "5-hour", percent: 30 }] });
  });

  it("shows the account whose busiest window is fullest, with both its windows", () => {
    expect(sidebarPlanView({ providers: [claude("Work", 95, 10), claude("Personal", 10, 90)] }))
      .toMatchObject({ name: "Claude · Work", windows: [{ percent: 95 }, { percent: 10 }] });
  });

  it("keeps the first account when a subscription and an API key report the same use", () => {
    expect(sidebarPlanView({ providers: [claude("Claude", 27, 8), claude("Claude (API key)", 27, 8)] })).toMatchObject({ name: "Claude" });
  });
});

describe("windowPercent", () => {
  it("reads 100% only once the window is used up", () => {
    expect(windowPercent(use(99.6))).toBe(99);
    expect(windowPercent(use(100))).toBe(100);
    expect(windowPercent({ available: true, usedPercent: 99.9, remainingPercent: 0 })).toBe(100);
    expect(windowPercent(use(0))).toBe(0);
    expect(windowPercent(use(50, false))).toBeNull();
  });
});

describe("planTitle", () => {
  it("keeps Claude in the title of a renamed account", () => {
    expect(planTitle("Claude")).toBe("Claude");
    expect(planTitle("Claude (API key)")).toBe("Claude (API key)");
    expect(planTitle("Work")).toBe("Claude · Work");
  });
});

describe("SidebarPlanUsageView", () => {
  beforeEach(() => setLocale("en"));

  it("colours a window by how close it is to the limit", () => {
    const html = renderToStaticMarkup(createElement(SidebarPlanUsageView, {
      view: { state: "ok", name: "Claude", windows: [{ label: "5-hour", percent: 85 }, { label: "Weekly", percent: 100 }] }, onOpen: () => {},
    }));
    expect(html).toContain('data-band="near"');
    expect(html).toContain('data-band="full"');
    expect(html).toContain("85%");
  });

  it("names the account, its windows and where the button leads", () => {
    expect(sidebarPlanLabel({ state: "ok", name: "Claude", windows: [{ label: "5-hour", percent: 27 }, { label: "Weekly", percent: 7 }] }))
      .toBe("Claude: 5-hour 27%, Weekly 7% Plan usage");
    expect(sidebarPlanLabel({ state: "unavailable", name: "Claude" })).toBe("Claude: Could not load plan usage. Plan usage");
  });
});

describe("startPlanPoller", () => {
  const host = () => {
    const state = { at: 0, visible: true, ticks: [] as Array<{ run: () => void; ms: number }>, wakes: [] as Array<() => void> };
    const api: PlanPollerHost = {
      now: () => state.at,
      visible: () => state.visible,
      every: (run, ms) => { const tick = { run, ms }; state.ticks.push(tick); return () => { state.ticks = state.ticks.filter((t) => t !== tick); }; },
      onWake: (run) => { state.wakes.push(run); return () => { state.wakes = state.wakes.filter((w) => w !== run); }; },
    };
    return { state, api };
  };
  const counter = () => { const loads = { count: 0, load: () => { loads.count++; } }; return loads; };

  it("loads at once, then on every tick", () => {
    const { state, api } = host(), loads = counter();
    startPlanPoller(loads.load, api, { every: POLL_MS, last: { at: Number.NEGATIVE_INFINITY } });
    expect(loads.count).toBe(1);
    expect(state.ticks[0]!.ms).toBe(POLL_MS);
    state.at += POLL_MS; state.ticks[0]!.run();
    expect(loads.count).toBe(2);
  });

  it("loads on waking at most once a minute", () => {
    const { state, api } = host(), loads = counter();
    startPlanPoller(loads.load, api, { every: POLL_MS, last: { at: Number.NEGATIVE_INFINITY } });
    state.at += 10_000; state.wakes[0]!();
    expect(loads.count).toBe(1);
    state.at += WAKE_GAP_MS; state.wakes[0]!();
    expect(loads.count).toBe(2);
  });

  it("does not load while the app is hidden", () => {
    const { state, api } = host(), loads = counter();
    state.visible = false;
    startPlanPoller(loads.load, api, { every: POLL_MS, last: { at: Number.NEGATIVE_INFINITY } });
    state.at += POLL_MS; state.ticks[0]!.run();
    expect(loads.count).toBe(0);
  });

  it("only listens for waking without a timer, and does not repeat a recent load on restart", () => {
    const { state, api } = host(), loads = counter(), last = { at: Number.NEGATIVE_INFINITY };
    startPlanPoller(loads.load, api, { every: POLL_MS, last })();
    startPlanPoller(loads.load, api, { every: null, last });
    expect(loads.count).toBe(1);
    expect(state.ticks).toHaveLength(0);
    expect(state.wakes).toHaveLength(1);
  });

  it("stops listening once stopped", () => {
    const { state, api } = host(), loads = counter();
    const stop = startPlanPoller(loads.load, api, { every: POLL_MS, last: { at: Number.NEGATIVE_INFINITY } });
    stop();
    expect(state.ticks).toHaveLength(0);
    expect(state.wakes).toHaveLength(0);
  });
});
