import { describe, expect, it } from "vitest";
import { parseBots, type AllPlacesBot, type AllPlacesGroup } from "../../electron/all-places.mjs";
import { visibleSidebarThreads } from "@/components/SidebarThreadRow";
import { botLook, listSections } from "./all-places";

const bot = (id: string, over: Partial<AllPlacesBot> = {}): AllPlacesBot => ({ id, threadId: `${id}-thread`, name: id, color: "blue", status: "idle", unread: false, preview: null, at: null, ...over });
const group = (placeId: string, section: string | null, bots: AllPlacesBot[], stale = false): AllPlacesGroup => ({ placeId, section, stale, bots });

describe("the one list over every place", () => {
  it("keeps each place's teams apart, a team of the same name in two places too, with a place's bots in no team first", () => {
    const list = listSections([
      group("local", "Sales", [bot("kae")]),
      group("local", null, [bot("maus")]),
      group("e14", "Indigo", [bot("edith")], true),
      group("e14", "Sales", [bot("friday")], true),
      group("e14", null, [bot("ofilia")], true),
    ]);
    expect(list.map((section) => [section.placeId, section.section, section.stale, section.bots.map((one) => one.id)])).toEqual([
      ["local", null, false, ["maus"]],
      ["local", "Sales", false, ["kae"]],
      ["e14", null, true, ["ofilia"]],
      ["e14", "Indigo", true, ["edith"]],
      ["e14", "Sales", true, ["friday"]],
    ]);
  });

  it("lists nothing for no place", () => {
    expect(listSections([])).toEqual([]);
  });
});

describe("a bot's look in the list", () => {
  it("is the mascot its place gave it when this app knows that body and face", () => {
    expect(botLook(bot("kae", { name: "Kae", color: "purple", body: "ghost", face: "black" }))).toEqual({ name: "Kae", color: "purple", mascotBody: "ghost", mascotFaceColor: "black" });
  });

  it("falls back to this app's own for a colour, body or face it does not know", () => {
    expect(botLook(bot("x", { name: "X", color: "ultraviolet", body: "from-a-newer-server", face: "pink" }))).toEqual({ name: "X", color: "silver", mascotBody: null, mascotFaceColor: null });
  });
});

describe("a bot's conversations in All places", () => {
  it("are the ones its place's own sidebar lists by default, in the same order", () => {
    const later = Date.now() + 3_600_000;
    const task = (n: number, over: Record<string, unknown> = {}) => ({ threadId: `t${n}`, title: `Thread ${n}`, createdAt: n, lastThreadOrderAt: n, unread: false, activity: "idle" as const, busy: false, ...over });
    const tasks = [
      task(1, { activity: "waiting-on-you" }), task(2, { unread: true }), task(3), task(4), task(5, { pinned: true }), task(6, { waitingForTeammates: true }), task(7, { busy: true }),
      task(8, { closedBy: { kind: "person" } }), task(9, { closedBy: { kind: "person" }, unread: true }), task(10, { snoozedUntil: 0 }), task(11, { snoozedUntil: later }), task(12, { snoozedUntil: 1 }),
      task(13, { openedBy: { botId: "b7", burstId: "burst" } }), task(14, { openedBy: { botId: "b7", burstId: "burst" }, activity: "working" }), task(15, { archivedAt: 5 }),
      task(16), task(17), task(0),
    ];
    const waiting = { t3: [{ queueId: "q1", text: "next" }] };

    const here = parseBots({ sections: [], bots: [{ id: "b1", threadId: "t17", name: "Kae", color: "blue", tasks }], botQueuedMessages: waiting })!.bots[0]!.threads!.map((thread) => thread.id);
    const there = visibleSidebarThreads(tasks.map((one) => ({ ...one, queued: one.threadId in waiting })) as Parameters<typeof visibleSidebarThreads>[0], "t17").map((one) => one.threadId);

    expect(here).toEqual(there);
    expect(here).toEqual(["t5", "t17", "t16", "t14", "t12", "t9", "t7", "t6", "t4", "t3", "t2", "t1"]);
  });
});
