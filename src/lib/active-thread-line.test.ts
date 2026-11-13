import { describe, expect, it } from "vitest";
import type { AttentionThread } from "@/components/SidebarBotActivity";
import { activeTurnStart, RUNS_LONG_MS, runsLong, stopActionFor } from "./active-thread-line";

const task = (over: Partial<AttentionThread["task"]> = {}): AttentionThread["task"] =>
  ({ threadId: "t1", title: "Draft notes", createdAt: 1, queued: false, ...over });
const botEntry = (over: Partial<AttentionThread["task"]> = {}): AttentionThread =>
  ({ kind: "bot", botId: "basil", botName: "Basil", task: task(over) });
const roomEntry = (over: Partial<AttentionThread["task"]> = {}, groupThreadId = "t1"): AttentionThread =>
  ({ kind: "group", groupId: "room", groupName: "Launch room", groupThreadId, task: task(over) });

describe("stopActionFor", () => {
  it("stops a bot's working conversation in that bot", () => {
    expect(stopActionFor(botEntry({ busy: true }))).toEqual({ type: "interrupt", botId: "basil", threadId: "t1" });
    expect(stopActionFor(botEntry({ activity: "working" }))).toEqual({ type: "interrupt", botId: "basil", threadId: "t1" });
  });

  it("stops a room's working conversation in that room", () => {
    expect(stopActionFor(roomEntry({ busy: true }))).toEqual({ type: "interruptGroup", groupId: "room", threadId: "t1" });
  });

  it("offers no Stop for what waits on the person, waits on teammates, is only queued or only unread", () => {
    expect(stopActionFor(botEntry({ busy: true, activity: "waiting-on-you" }))).toBeNull();
    expect(stopActionFor(botEntry({ waitingForTeammates: true }))).toBeNull();
    expect(stopActionFor(botEntry({ queued: true }))).toBeNull();
    expect(stopActionFor(botEntry({ unread: true }))).toBeNull();
  });
});

describe("activeTurnStart", () => {
  it("is a working bot conversation's own turn start", () => {
    expect(activeTurnStart(botEntry({ busy: true, turnStartedAt: 500 }), [])).toBe(500);
  });

  it("is the room's turn start for the room's open conversation, and unknown for its others", () => {
    const groups = [{ id: "room", threadId: "t1", turnStartedAt: 700 }];
    expect(activeTurnStart(roomEntry({ busy: true }), groups)).toBe(700);
    expect(activeTurnStart(roomEntry({ busy: true }, "other"), groups)).toBeUndefined();
  });

  it("is unknown for anything not working", () => {
    expect(activeTurnStart(botEntry({ turnStartedAt: 500 }), [])).toBeUndefined();
    expect(activeTurnStart(botEntry({ busy: true, activity: "waiting-on-you", turnStartedAt: 500 }), [])).toBeUndefined();
  });
});

describe("runsLong", () => {
  it("turns at forty minutes of one turn's work", () => {
    expect(RUNS_LONG_MS).toBe(40 * 60_000);
    expect(runsLong(0, RUNS_LONG_MS - 1)).toBe(false);
    expect(runsLong(0, RUNS_LONG_MS)).toBe(true);
  });
});
