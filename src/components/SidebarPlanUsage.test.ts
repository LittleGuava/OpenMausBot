import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { sidebarPlanView, SidebarPlanUsageView, type SidebarPlanReport } from "./SidebarPlanUsage";

const use = (usedPercent: number | null, available = true) => ({ available, usedPercent });
const claude = (id: string, fiveHour: number | null, weekly: number | null, extra: Partial<SidebarPlanReport["providers"][number]> = {}) =>
  ({ id, name: id, driver: "claude", ok: true, fiveHour: use(fiveHour), weekly: use(weekly), ...extra });

describe("sidebarPlanView", () => {
  beforeEach(() => setLocale("en"));

  it("shows the 5-hour and weekly use of the signed-in Claude plan", () => {
    expect(sidebarPlanView({ providers: [claude("Claude", 42.4, 17.6)] })).toEqual({
      name: null, windows: [{ label: "5-hour", percent: 42 }, { label: "Weekly", percent: 18 }],
    });
  });

  it("is hidden without a signed-in Claude plan that reports a window", () => {
    expect(sidebarPlanView(null)).toBeNull();
    expect(sidebarPlanView({ providers: [] })).toBeNull();
    expect(sidebarPlanView({ providers: [claude("Claude", 10, 10, { ok: false })] })).toBeNull();
    expect(sidebarPlanView({ providers: [claude("Codex", 10, 10, { driver: "codex" })] })).toBeNull();
    expect(sidebarPlanView({ providers: [claude("Claude (API key)", null, null)] })).toBeNull();
  });

  it("drops a window the plan does not report and clamps the rest", () => {
    expect(sidebarPlanView({ providers: [claude("Claude", 130, null)] })?.windows).toEqual([{ label: "5-hour", percent: 100 }]);
  });

  it("names the tightest account when several Claude plans are signed in", () => {
    expect(sidebarPlanView({ providers: [claude("Work", 20, 30), claude("Personal", 91, 40)] })).toMatchObject({ name: "Personal" });
  });

  it("colours a window by how close it is to the limit", () => {
    const html = renderToStaticMarkup(createElement(SidebarPlanUsageView, {
      view: { name: null, windows: [{ label: "5-hour", percent: 85 }, { label: "Weekly", percent: 100 }] }, onOpen: () => {},
    }));
    expect(html).toContain('data-band="near"');
    expect(html).toContain('data-band="full"');
    expect(html).toContain("85%");
  });
});
