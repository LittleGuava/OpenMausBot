import assert from "node:assert/strict";
import test from "node:test";

import { askedPlaces, installAllPlaces } from "./all-places-main.mjs";

const settle = async () => { for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve)); };
const answer = (status, body) => new Response(JSON.stringify(body), { status });

const SAVED = { activeId: "local", localColor: "teal", environments: [
  { id: "e14", kind: "remote", name: "E14", origin: "https://e14.test", color: "purple" },
  { id: "acme", kind: "remote", name: "Acme Team", origin: "https://acme.test", team: { id: "t1", role: "member" } },
  { id: "mine", kind: "remote", name: "My Cloud", origin: "https://cloud.test", home: true },
  { id: "side", kind: "local", name: "Side", dataDir: "/data/side" },
] };

const RAIL = { sender: "rail" }, HERE = { sender: "this computer's page" }, PLACE = { sender: "a server's page" };

function setup(over = {}) {
  const handlers = new Map(), sent = [], asked = [], brought = [], notes = [];
  const chosen = { on: false, check: "live", notify: true, places: {} };
  const world = { railShown: true, saved: SAVED };
  class Notification {
    static isSupported() { return true; }
    constructor(options) { this.options = options; this.handlers = {}; notes.push(this); }
    on(name, handler) { this.handlers[name] = handler; }
    show() {}
  }
  const places = installAllPlaces({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    rail: { owns: (event) => event === RAIL, shown: () => world.railShown, send: (channel) => sent.push(["rail", channel]), list: () => {}, toPage: () => { world.toPage = (world.toPage ?? 0) + 1; } },
    localPage: (event) => event === HERE,
    localContents: () => ({ send: (channel) => sent.push(["page", channel]) }),
    prefs: () => ({ allPlaces: () => chosen.on, setAllPlaces: (on) => { chosen.on = on; }, allPlacesCheck: () => chosen.check, setAllPlacesCheck: (check) => { chosen.check = check; return true; },
      allPlacesNotify: () => chosen.notify, setAllPlacesNotify: (on) => { chosen.notify = on; }, allPlacesChoice: (id) => chosen.places[id] ?? null, setAllPlacesChoice: (id, on) => { chosen.places[id] = on; } }),
    saved: () => world.saved, available: () => true,
    cookieFetch: async (url, init) => { asked.push({ url, method: init.method, origin: init.headers.origin, background: init.headers["x-omb-background"] ?? null, credentials: init.credentials, body: init.body ?? null });
      const route = new URL(url).pathname;
      if (world.signedOut) return answer(401, {});
      if (route === "/api/bots") return answer(200, { sections: [], bots: [{ id: "j", threadId: "jt", name: "Jarvis", color: "blue", unread: false, tasks: [], messages: [] }] });
      if (route === "/api/inbox") return answer(200, { threadId: null, rows: world.rows ?? [] });
      return answer(200, { ok: true, outcome: "allowed-once" }); },
    localRequest: async (route, init) => { asked.push({ url: `local${route}`, method: init.method, origin: init.headers.origin ?? null, background: init.headers["x-omb-background"] ?? null });
      return route.startsWith("/api/bots") ? answer(200, { sections: [], bots: [] }) : route === "/api/inbox" ? answer(200, { threadId: null, rows: [] }) : answer(500, {}); },
    asleep: () => false, shown: () => true, focused: () => true, bring: (origin, target) => brought.push([origin, target]), localOrigin: () => "http://127.0.0.1:8799",
    Notification, ...over,
  });
  const call = (channel, event, ...args) => handlers.get(channel)(event, ...args);
  const ready = async () => { chosen.on = true; chosen.check = "open"; await call("all-places:advanced", RAIL, true); await call("all-places:opened", RAIL, true); await settle(); };
  return { places, call, handlers, sent, asked, brought, notes, chosen, world, ready };
}

test("the places asked are this computer and every saved one, a team's Cloud marked as one other people sign in to", () => {
  assert.deepEqual(askedPlaces(SAVED), [
    { id: "local", name: "This computer", kind: "computer", color: "teal", local: true },
    { id: "e14", name: "E14", kind: "server", color: "purple", origin: "https://e14.test" },
    { id: "acme", name: "Acme Team", kind: "team", color: null, origin: "https://acme.test", shared: true },
    { id: "mine", name: "My Cloud", kind: "cloud", color: null, origin: "https://cloud.test" },
  ]);
  assert.equal(askedPlaces(SAVED, false).some((place) => place.local), false, "once My Cloud is home, this computer is not a place");
});

test("only the rail's own page reads the list or answers a line; a place's page gets nothing at all", async () => {
  const f = setup();
  for (const channel of ["all-places:view", "all-places:advanced", "all-places:opened", "all-places:refresh", "all-places:act", "all-places:go"]) {
    assert.throws(() => f.call(channel, PLACE, {}), /only available to the window's rail/, channel);
    assert.throws(() => f.call(channel, HERE, {}), /only available to the window's rail/, `${channel} from this computer's page`);
  }
  for (const channel of ["all-places:settings", "all-places:set"]) {
    assert.throws(() => f.call(channel, PLACE, {}), /only available in this app's window/, channel);
    assert.doesNotThrow(() => f.call(channel, HERE, {}));
  }
});

test("off until turned on in Settings, and only once the rail's page says the Advanced mode is on", async () => {
  const f = setup();
  await f.call("all-places:opened", RAIL, true);
  await settle();
  assert.deepEqual([f.call("all-places:view", RAIL).active, f.asked.length], [false, 0]);

  assert.equal(f.call("all-places:set", HERE, { enabled: true, check: "open" }).enabled, true);
  await f.call("all-places:opened", RAIL, true);
  await settle();
  assert.deepEqual([f.call("all-places:view", RAIL).active, f.asked.length], [false, 0], "the switch alone is not enough");

  await f.call("all-places:advanced", RAIL, true);
  await f.call("all-places:opened", RAIL, true);
  await settle();
  assert.equal(f.call("all-places:view", RAIL).active, true);
  assert.ok(f.asked.length > 0);
  assert.ok(f.sent.some(([to, channel]) => to === "rail" && channel === "all-places:changed"), "the rail's page is told to read again");

  f.world.railShown = false;
  assert.equal(f.call("all-places:view", RAIL).active, false, "with no rail up there is no All places");
});

test("a place is asked with the window's own sign-in, its own Origin and the background mark; a team's Cloud is left out", async () => {
  const f = setup();
  await f.ready();
  const reads = f.asked.filter((one) => one.url.startsWith("https://e14.test"));
  assert.deepEqual(reads.map((one) => new URL(one.url).pathname).sort(), ["/api/bots", "/api/inbox"]);
  assert.ok(reads.every((one) => one.origin === "https://e14.test" && one.credentials === "include" && one.background === "1" && one.method === "GET"));
  assert.equal(f.asked.some((one) => one.url.startsWith("https://acme.test")), false);
  assert.ok(f.asked.some((one) => one.url === "local/api/inbox" && one.origin === null), "this computer is asked through its own server's request");
  const view = f.call("all-places:view", RAIL);
  assert.deepEqual(view.places.map((place) => place.id), ["local", "e14", "mine"]);
  assert.equal(JSON.stringify(view).includes("e14.test"), false, "no address reaches a page");
});

test("an answer goes to the line's own server as the person's request, and a jump only to a conversation main listed", async () => {
  const f = setup();
  f.world.rows = [{ id: "r1", kind: "ask", tab: "needs-you", from: { name: "Friday", botId: "j" }, origin: { botId: "j", threadId: "t2", title: "Replies" }, text: "Save a draft", at: 5, unread: true, card: { requestId: "q1", tool: "tool" } }];
  await f.ready();
  assert.deepEqual(await f.call("all-places:act", RAIL, { placeId: "e14", rowId: "r1", action: "allow" }), { outcome: "done" });
  const sent = f.asked.find((one) => one.method === "POST");
  assert.deepEqual([sent.url, sent.origin, sent.background, sent.body], ["https://e14.test/api/threads/t2/respond", "https://e14.test", null, JSON.stringify({ requestId: "q1", behavior: "allow" })]);

  assert.equal(await f.call("all-places:go", RAIL, { placeId: "e14", botId: "j" }), true);
  assert.deepEqual(f.brought, [["https://e14.test", { botId: "j", threadId: "jt" }]]);
  assert.equal(f.world.toPage, 1, "the keyboard goes with it, to the conversation");
  assert.equal(await f.call("all-places:go", RAIL, { placeId: "e14", botId: "elsewhere" }), false);
  assert.equal(await f.call("all-places:go", RAIL, { placeId: "https://evil.test", botId: "j" }), false, "a page never names an address");
  assert.equal(f.brought.length, 1);
});

test("Settings sets only the switches this app offers, for places it saved", async () => {
  const f = setup();
  const said = f.call("all-places:set", HERE, { enabled: true, check: "30", notify: false, place: { id: "acme", included: true } });
  assert.deepEqual([said.enabled, said.check, said.notify], [true, "30", false]);
  assert.deepEqual(said.places, [{ id: "local", included: true, shared: false }, { id: "e14", included: true, shared: false }, { id: "acme", included: true, shared: true }, { id: "mine", included: true, shared: false }]);
  f.call("all-places:set", HERE, { place: { id: "nowhere", included: true } });
  assert.equal(f.chosen.places.nowhere, undefined);
  assert.deepEqual(f.call("all-places:set", HERE, "junk").enabled, true, "anything else changes nothing");
});

test("this computer's page hears only that the switches changed, never that another place did", async () => {
  const f = setup();
  await f.ready();
  const told = () => f.sent.filter(([to]) => to === "page").length;
  const before = told();
  f.world.rows = [{ id: "r9", kind: "message", tab: "info", from: { name: "Jarvis", botId: "j" }, origin: { botId: "j", threadId: "jt", title: "Brief" }, text: "News", at: 9, unread: true }];
  await f.call("all-places:refresh", RAIL);
  await settle();
  assert.ok(f.sent.filter(([to]) => to === "rail").length > 0, "the rail's page is told the list changed");
  assert.equal(told(), before, "a line in another place is no news for this computer's page");
  f.call("all-places:set", HERE, { notify: false });
  assert.equal(told(), before + 1);
});

test("choosing a bot keeps All places open: the list stays beside the place's page, and nothing there is news to announce", async () => {
  const widths = [];
  const f = setup({ rail: { owns: (event) => event === RAIL, shown: () => true, send: () => {}, list: (width) => widths.push(width), toPage: () => {} } });
  await f.ready();
  for (const event of [HERE, PLACE]) assert.throws(() => f.call("all-places:beside", event, 280), /only available to the window's rail/);
  await f.call("all-places:beside", RAIL, 280);
  await f.call("all-places:beside", RAIL, "wide");
  assert.deepEqual(widths, [280, 0]);

  assert.equal(await f.call("all-places:go", RAIL, { placeId: "e14", botId: "j" }), true);
  f.world.rows = [{ id: "r1", kind: "ask", tab: "needs-you", from: { name: "Friday", botId: "j" }, origin: { botId: "j", threadId: "t2", title: "Replies" }, text: "Save a draft", at: 5, unread: true, card: { requestId: "q1", tool: "tool" } }];
  await f.call("all-places:refresh", RAIL);
  await settle();
  assert.equal(f.call("all-places:view", RAIL).rows.length > 0, true, "the line is on the list the person is looking at");
  assert.equal(f.notes.length, 0, "so no notification for it");
});

test("when the window shows another place, a place whose sign-in ended is asked once more", async () => {
  const f = setup();
  f.world.signedOut = true;
  f.chosen.on = true; f.chosen.check = "30";
  await f.call("all-places:advanced", RAIL, true);
  await f.call("all-places:opened", RAIL, true);
  await settle();
  const e14 = () => f.call("all-places:view", RAIL).places.find((place) => place.id === "e14").state;
  assert.equal(e14(), "blocked");

  f.world.signedOut = false;
  f.world.saved = { ...SAVED, activeId: "e14" };
  f.places.sync();
  await settle();
  assert.equal(e14(), "ok");
});
