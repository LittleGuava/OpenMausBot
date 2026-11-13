// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { RUNS_LONG_MS } from "@/lib/active-thread-line";
import { noteTurnEvent } from "@/state/turn-status";
import type { AttentionThread } from "../SidebarBotActivity";
import { SIDEBAR_PHRASE_HOLD_MS } from "../SidebarWorkingStep";
import { InboxActiveRows } from "./InboxActiveRows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.UTC(2026, 10, 13, 18, 0, 0);
const task = (over: Partial<AttentionThread["task"]>): AttentionThread["task"] =>
  ({ threadId: "basil-notes", title: "Draft the release notes", createdAt: 1, queued: false, ...over });
const basil = (over: Partial<AttentionThread["task"]> = {}): AttentionThread =>
  ({ kind: "bot", botId: "basil", botName: "Basil", task: task({ busy: true, activity: "working", turnStartedAt: NOW - 4 * 60_000 - 5_000, ...over }) });
const room: AttentionThread = { kind: "group", groupId: "room", groupName: "Launch room", groupThreadId: "room-thread",
  task: task({ threadId: "room-thread", title: "Compare the hosting quotes", busy: true }) };

let root: Root;
const onJump = vi.fn();
const onStop = vi.fn();
const draw = (entries: AttentionThread[], groups = [{ id: "room", turnStartedAt: NOW - 30_000 }]) =>
  act(async () => { root.render(createElement(InboxActiveRows, { entries, groups, onJump, onStop })); });
const rowOf = (title: string) => [...document.querySelectorAll<HTMLElement>("[data-inbox-active-row]")].find((row) => row.textContent?.includes(title))!;
const stopIn = (row: HTMLElement) => row.querySelector<HTMLButtonElement>("[data-inbox-active-stop]");

beforeEach(() => {
  setLocale("en");
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  onJump.mockClear();
  onStop.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("a conversation at work in the Inbox", () => {
  it("says who works on it, for how long, and stops it in that bot", async () => {
    await draw([basil()]);
    const row = rowOf("Draft the release notes");
    expect(row.textContent).toContain("Basil");
    expect(row.textContent).toContain("Working");
    expect(row.textContent).toContain("4m 05s");
    await act(async () => { stopIn(row)!.click(); });
    expect(onStop).toHaveBeenCalledWith({ type: "interrupt", botId: "basil", threadId: "basil-notes" });
    expect(onJump, "Stop is not a jump").not.toHaveBeenCalled();
    expect(stopIn(row)!.getAttribute("aria-label")).toBe("Stop Draft the release notes");
  });

  it("stops a room's conversation in that room, timed from the room's turn", async () => {
    await draw([room]);
    const row = rowOf("Compare the hosting quotes");
    expect(row.textContent).toContain("Launch room");
    expect(row.textContent).toContain("30s");
    await act(async () => { stopIn(row)!.click(); });
    expect(onStop).toHaveBeenCalledWith({ type: "interruptGroup", groupId: "room", threadId: "room-thread" });
  });

  it("shows the step the engine reports now", async () => {
    await draw([basil()]);
    await act(async () => {
      noteTurnEvent({ eventId: "p", provider: "claudeAgent", threadId: "basil-notes", createdAt: new Date(NOW).toISOString(), turnId: "u1",
        type: "turn.progress", activity: "write", itemId: "w", file: "notes.md" } as never);
    });
    await act(async () => { vi.advanceTimersByTime(SIDEBAR_PHRASE_HOLD_MS); });
    expect(rowOf("Draft the release notes").textContent).toMatch(/Writing/);
    await act(async () => { noteTurnEvent({ eventId: "e", provider: "claudeAgent", threadId: "basil-notes", createdAt: new Date(NOW).toISOString(), turnId: "u1", type: "turn.completed", ok: true } as never); });
  });

  it("counts on while it works and marks a turn past forty minutes", async () => {
    await draw([basil({ turnStartedAt: NOW - RUNS_LONG_MS + 2_000 })]);
    const clock = () => rowOf("Draft the release notes").querySelector<HTMLElement>("[data-inbox-active-elapsed]")!;
    expect(clock().dataset.long).toBeUndefined();
    await act(async () => { vi.advanceTimersByTime(3_000); });
    expect(clock().textContent).toBe("40m 01s");
    expect(clock().dataset.long).toBe("");
  });

  it("offers no Stop and no clock for what waits on the person or is only unread", async () => {
    await draw([basil({ activity: "waiting-on-you", title: "Pricing work" }), basil({ busy: false, activity: undefined, unread: true, title: "Told already", threadId: "told" })]);
    for (const title of ["Pricing work", "Told already"]) {
      expect(stopIn(rowOf(title)), title).toBeNull();
      expect(rowOf(title).querySelector("[data-inbox-active-elapsed]"), title).toBeNull();
    }
  });

  it("opens the conversation from the row", async () => {
    await draw([basil()]);
    await act(async () => { rowOf("Draft the release notes").querySelector<HTMLButtonElement>("[data-inbox-active-open]")!.click(); });
    expect(onJump).toHaveBeenCalledWith(basil());
  });
});
