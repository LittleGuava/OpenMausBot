import { describe, expect, it } from "vitest";
import type { AllPlacesBot, AllPlacesGroup } from "../../electron/all-places.mjs";
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
