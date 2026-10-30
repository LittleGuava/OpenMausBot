import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { deviceAccessName, ViewOptions } from "../components/ServerPairingCard";
import { choiceOfView, pairingBody, viewOfChoice, viewTargetName, viewTargetsFrom } from "./device-view-choice";
import { listsRoomOnly, readSessionState } from "./session";

const targets = viewTargetsFrom({
  sections: ["Ops", "People"],
  bots: [{ id: "b1", name: "Ops One" }, { id: "b2", name: "Old", hidden: true }, { id: 3, name: "broken" }],
  groups: [{ id: "g1", name: "Standup" }, { id: "dm1", name: "Ops One ↔ Payroll", dm: true }],
});

describe("choosing what a paired device sees", () => {
  it("offers General, live bots and real group chats", () => {
    expect(targets).toEqual({ sections: ["", "Ops", "People"], bots: [{ id: "b1", name: "Ops One" }], groups: [{ id: "g1", name: "Standup" }] });
    expect(viewTargetsFrom(null)).toEqual({ sections: [""], bots: [], groups: [] });
  });

  it("turns a choice into the pairing request, a view always chat only", () => {
    expect(pairingBody("admin")).toEqual({ scopes: ["admin", "client"] });
    expect(pairingBody("client")).toEqual({ scopes: ["client"] });
    expect(pairingBody("section:Ops")).toEqual({ scopes: ["client"], view: { section: "Ops" } });
    expect(pairingBody("section:")).toEqual({ scopes: ["client"], view: { section: "" } });
    expect(pairingBody("bot:b1")).toEqual({ scopes: ["client"], view: { bot: "b1" } });
    expect(pairingBody("group:g1")).toEqual({ scopes: ["client"], view: { group: "g1" } });
  });

  it("round-trips a device's view through the picker", () => {
    for (const view of [{ section: "Ops" }, { bot: "b1" }, { group: "g1" }]) expect(viewOfChoice(choiceOfView(view, ["client"]))).toEqual(view);
    expect(choiceOfView(undefined, ["admin", "client"])).toBe("admin");
    expect(choiceOfView(undefined, ["client"])).toBe("client");
    expect(viewOfChoice("client")).toBeNull();
    expect(viewOfChoice("team:x")).toBeNull();
  });

  it("names a device's view, and says so when its target is gone", () => {
    expect(viewTargetName({ section: "" }, targets, "General")).toBe("General");
    expect(viewTargetName({ bot: "b2" }, targets, "General")).toBeNull();
    expect(deviceAccessName({ scopes: ["admin", "client"] }, targets)).toBe("Full access");
    expect(deviceAccessName({ scopes: ["client"], view: { section: "Ops" } }, targets)).toBe("Only Ops (department)");
    expect(deviceAccessName({ scopes: ["client"], view: { bot: "b1" } }, targets)).toBe("Only Ops One");
    expect(deviceAccessName({ scopes: ["client"], view: { group: "g1" } }, targets)).toBe("Only Standup (group chat)");
    expect(deviceAccessName({ scopes: ["client"], view: { group: "gone" } }, targets)).toMatch(/deleted/);
  });

  it("groups the picker's options by kind", () => {
    const html = renderToStaticMarkup(createElement("select", null, createElement(ViewOptions, { targets, none: [{ value: "admin", label: "Full access" }] })));
    expect(html).toContain('<option value="admin">Full access</option>');
    expect(html).toContain('<optgroup label="Only one department"><option value="section:">General</option><option value="section:Ops">Ops</option>');
    expect(html).toContain('<optgroup label="Only one bot"><option value="bot:b1">Ops One</option></optgroup>');
    expect(html).toContain('<optgroup label="Only one group chat"><option value="group:g1">Standup</option></optgroup>');
  });
});

describe("a device's own view, as the app reads it", () => {
  const session = (body: unknown) => readSessionState((async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch);

  it("lists the room alone only on a device limited to one group chat", async () => {
    const base = { kind: "session", id: "s", label: "Room screen", scopes: ["client"], expiresAt: 1 };
    const room = await session({ ...base, view: { group: "g1" } });
    expect(room).toMatchObject({ view: { group: "g1" } });
    expect(listsRoomOnly(room)).toBe(true);
    expect(listsRoomOnly(await session({ ...base, view: { bot: "b1" } }))).toBe(false);
    expect(listsRoomOnly(await session(base))).toBe(false);
    expect(await session({ ...base, view: { nonsense: true } })).not.toHaveProperty("view");
    expect(listsRoomOnly({ kind: "loopback" })).toBe(false);
  });
});
