import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { deviceAccessName, ViewTargetPicker } from "../components/ServerPairingCard";
import { EMPTY_VIEW, knownTargets, pairingBody, pickedCount, togglePicked, viewNames, viewTargetsFrom } from "./device-view-choice";
import { readSessionState } from "./session";

const targets = viewTargetsFrom({
  sections: ["Ops", "People"],
  bots: [{ id: "b1", name: "Ops One" }, { id: "b2", name: "Old", hidden: true }, { id: 3, name: "broken" }],
  groups: [{ id: "g1", name: "Standup" }, { id: "dm1", name: "Ops One ↔ Payroll", dm: true }],
});
const view = (picked: Partial<typeof EMPTY_VIEW>) => ({ ...EMPTY_VIEW, ...picked });

describe("choosing what a paired device sees", () => {
  it("offers General, live bots and real group chats", () => {
    expect(targets).toEqual({ sections: ["", "Ops", "People"], bots: [{ id: "b1", name: "Ops One" }], groups: [{ id: "g1", name: "Standup" }] });
    expect(viewTargetsFrom(null)).toEqual({ sections: [""], bots: [], groups: [] });
  });

  it("ticks and unticks several targets of every kind", () => {
    let picked = togglePicked(EMPTY_VIEW, "groups", "g1");
    picked = togglePicked(picked, "bots", "b1");
    picked = togglePicked(picked, "sections", "Ops");
    expect(picked).toEqual(view({ sections: ["Ops"], bots: ["b1"], groups: ["g1"] }));
    expect(pickedCount(picked)).toBe(3);
    expect(togglePicked(picked, "bots", "b1")).toEqual(view({ sections: ["Ops"], groups: ["g1"] }));
    expect(EMPTY_VIEW).toEqual({ sections: [], bots: [], groups: [] });
  });

  it("turns a choice into the pairing request, a limited one always chat only", () => {
    expect(pairingBody("admin", EMPTY_VIEW)).toEqual({ scopes: ["admin", "client"] });
    expect(pairingBody("client", view({ bots: ["b1"] }))).toEqual({ scopes: ["client"] });
    expect(pairingBody("limited", view({ sections: [""], groups: ["g1"] }))).toEqual({ scopes: ["client"], view: view({ sections: [""], groups: ["g1"] }) });
  });

  it("names a device's view, and says so when everything it named is gone", () => {
    expect(viewNames(view({ sections: [""], bots: ["b1", "gone"], groups: ["g1"] }), targets, "General")).toEqual(["General", "Ops One", "Standup"]);
    expect(deviceAccessName({ scopes: ["admin", "client"] }, targets)).toBe("Full access");
    expect(deviceAccessName({ scopes: ["client"], view: view({ sections: ["Ops"] }) }, targets)).toBe("Only Ops");
    expect(deviceAccessName({ scopes: ["client"], view: view({ bots: ["b1"], groups: ["g1"] }) }, targets)).toBe("Only Ops One, Standup");
    expect(deviceAccessName({ scopes: ["client"], view: view({ sections: ["Ops", "People"], bots: ["b1"], groups: ["g1"] }) }, targets)).toBe("Only Ops, People +2");
    expect(deviceAccessName({ scopes: ["client"], view: view({ groups: ["gone"] }) }, targets)).toMatch(/deleted/);
  });

  it("drops what was deleted or renamed, so saving a view again sends only live targets", () => {
    const stored = view({ sections: ["", "Ops", "Renamed"], bots: ["b1", "deleted"], groups: ["gone"] });
    expect(knownTargets(stored, targets)).toEqual(view({ sections: ["", "Ops"], bots: ["b1"] }));
    expect(pickedCount(knownTargets(togglePicked(stored, "bots", "b1"), targets))).toBe(2);
    expect(pickedCount(knownTargets(view({ bots: ["deleted"] }), targets))).toBe(0);
  });

  it("lists every target as an on/off switch, grouped by kind, with the picked ones on", () => {
    const html = renderToStaticMarkup(createElement(ViewTargetPicker, { targets, picked: view({ sections: ["Ops"], groups: ["g1"] }), onToggle: () => {} }));
    expect(html).toContain("Departments");
    expect(html).toContain("Bots");
    expect(html).toContain("Group chats");
    expect(html.match(/role="switch"/g)).toHaveLength(5);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Ops One"');
    expect(html).toContain("Ops One");
    expect(html).toContain("Standup");
  });
});

describe("a device's own view, as the app reads it", () => {
  const session = (body: unknown) => readSessionState((async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch);

  it("reads one target or several, and a view it cannot read as seeing nothing", async () => {
    const base = { kind: "session", id: "s", label: "Room screen", scopes: ["client"], expiresAt: 1 };
    expect(await session({ ...base, view: view({ groups: ["g1"], bots: ["b1"] }) })).toMatchObject({ view: view({ groups: ["g1"], bots: ["b1"] }) });
    expect(await session({ ...base, view: { group: "g1" } })).toMatchObject({ view: view({ groups: ["g1"] }) });
    expect(await session({ ...base, view: { nonsense: true } })).toMatchObject({ view: EMPTY_VIEW });
    expect(await session(base)).not.toHaveProperty("view");
  });
});
