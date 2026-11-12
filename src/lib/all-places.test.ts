import { describe, expect, it } from "vitest";
import type { AllPlacesBot, AllPlacesGroup } from "../../electron/all-places.mjs";
import { botLook, listSections } from "./all-places";

const bot = (id: string, over: Partial<AllPlacesBot> = {}): AllPlacesBot => ({ id, threadId: `${id}-thread`, name: id, color: "blue", status: "idle", unread: false, preview: null, at: null, ...over });
const group = (placeId: string, section: string | null, bots: AllPlacesBot[], stale = false): AllPlacesGroup => ({ placeId, section, stale, bots });

describe("the one list over every place", () => {
  it("joins sections of the same name, each bot keeping its place, with the bots in no section first", () => {
    const list = listSections([
      group("local", "Sales", [bot("kae")]),
      group("local", null, [bot("maus")]),
      group("e14", "Indigo", [bot("edith")], true),
      group("e14", "Sales", [bot("friday")], true),
      group("e14", null, [bot("ofilia")], true),
    ]);
    expect(list.map((section) => [section.section, section.bots.map((listed) => `${listed.placeId}:${listed.bot.id}${listed.stale ? " (stale)" : ""}`)])).toEqual([
      [null, ["local:maus", "e14:ofilia (stale)"]],
      ["Sales", ["local:kae", "e14:friday (stale)"]],
      ["Indigo", ["e14:edith (stale)"]],
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
