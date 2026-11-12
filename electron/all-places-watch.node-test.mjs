import assert from "node:assert/strict";
import test from "node:test";

import { createAllPlacesWatch, FRAME_GAP_MS, FRAME_SETTLE_MS, TICK_MS } from "./all-places-watch.mjs";

const settle = async () => { for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve)); };
const answer = (status, body) => ({ ok: status < 400, status, json: async () => body });

const HERE = { id: "local", name: "This computer", kind: "computer", local: true };
const E14 = { id: "e14", name: "E14", kind: "server", color: "purple", origin: "https://e14.test" };
const TEAM = { id: "team", name: "Acme Team", kind: "team", origin: "https://acme.test", shared: true };

const bot = (id, name, over = {}) => ({ id, threadId: `${id}-thread`, name, color: "blue", unread: false, tasks: [], messages: [], ...over });
const approval = (id, over = {}) => ({ id, kind: "ask", tab: "needs-you", from: { name: "Friday", botId: "b2" }, origin: { botId: "b2", threadId: "t2", title: "Replies" },
  text: "Save a draft", at: 200, unread: true, card: { requestId: `q-${id}`, tool: "tool" }, ...over });

function setup(over = {}) {
  const chosen = { on: true, check: "live", notify: true, places: {} };
  const asked = [], notes = [], timers = [], ticks = [], streams = new Map();
  const world = {
    advanced: true, shown: true, active: "local", focused: true, clock: 1_000, changes: 0, places: [HERE, E14],
    // What each place answers: its bots, its inbox lines, or a status that is not 200.
    servers: { local: { bots: [bot("k", "Kae")], rows: [] }, e14: { bots: [bot("j", "Jarvis", { section: "Indigo" })], rows: [approval("r1")] } },
  };
  const watch = createAllPlacesWatch({
    places: () => world.places,
    request: async (place, route, init = {}) => {
      asked.push({ place: place.id, route, method: init.method ?? "GET", background: init.background === true, ...(init.body ? { body: init.body } : {}) });
      const server = world.servers[place.id];
      if (!server || server.down) throw new Error("no route");
      if (server.status) return answer(server.status, server.said ?? {});
      if (route.startsWith("/api/bots?")) return answer(200, { sections: [], bots: server.bots });
      if (route === "/api/inbox") return server.noInbox ? answer(404, {}) : answer(200, { threadId: null, rows: server.rows });
      return answer(200, server.respond?.(route, init.body) ?? { ok: true, outcome: "allowed-once" });
    },
    prefs: { allPlaces: () => chosen.on, allPlacesCheck: () => chosen.check, allPlacesNotify: () => chosen.notify, allPlacesChoice: (id) => chosen.places[id] ?? null },
    advanced: () => world.advanced, shown: () => world.shown, asleep: (origin) => world.asleep === origin, activeId: () => world.active, focused: () => world.focused,
    notify: (note) => notes.push([note.place.id, note.row.id]), changed: () => { world.changes += 1; },
    now: () => world.clock,
    setTimer: (run, ms) => { const timer = { run, at: world.clock + ms }; timers.push(timer); return timer; },
    clearTimer: (timer) => { const at = timers.indexOf(timer); if (at !== -1) timers.splice(at, 1); },
    setTick: (run, ms) => { const timer = { run, ms }; ticks.push(timer); return timer; },
    clearTick: (timer) => { const at = ticks.indexOf(timer); if (at !== -1) ticks.splice(at, 1); },
    makeStream: (deps) => {
      const stream = { state: "off", deps, start() { this.state = "live"; }, stop() { this.state = "off"; } };
      const id = world.places.find((place) => !streams.has(place.id) || streams.get(place.id).state === "off")?.id;
      streams.set(id, stream);
      return { start: () => stream.start(), stop: () => stream.stop(), state: () => stream.state, retryAt: () => stream.retryAt ?? null };
    },
    ...over,
  });
  const pass = async (ms) => {
    const until = world.clock + ms;
    for (;;) {
      const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      world.clock = due.at;
      due.run();
      await settle();
    }
    world.clock = until;
  };
  /** The housekeeping beat, `count` times, TICK_MS apart. */
  const beat = async (count = 1) => { for (let at = 0; at < count; at++) { world.clock += TICK_MS; for (const tick of ticks.slice()) tick.run(); await settle(); } };
  const frame = async (id, kind, more = {}) => { streams.get(id).deps.onFrame({ kind, ...more }); await settle(); };
  const reads = (id) => asked.filter((one) => one.place === id && one.route === "/api/inbox").length;
  return { watch, world, chosen, asked, notes, timers, ticks, streams, pass, beat, frame, reads };
}

test("off until the person turns it on: no request, no timer, no stream, nothing listed", async () => {
  const f = setup();
  f.chosen.on = false;
  f.watch.sync(); f.watch.opened(true);
  await f.watch.refresh();
  await f.beat(3);
  assert.deepEqual([f.asked.length, f.ticks.length, f.streams.size, f.timers.length], [0, 0, 0, 0]);
  assert.equal(f.watch.view().active, false);
});

test("on, but this app's page is in Simple mode: the same nothing; back in Simple it stops again", async () => {
  const f = setup();
  f.world.advanced = false;
  f.watch.sync(); f.watch.opened(true);
  await settle();
  assert.deepEqual([f.asked.length, f.ticks.length, f.streams.size], [0, 0, 0]);

  f.world.advanced = true;
  f.watch.sync();
  assert.deepEqual([...f.streams.keys()], ["local", "e14"], "Live listens to each included place");
  await f.frame("e14", "hello");
  await f.pass(FRAME_SETTLE_MS);
  assert.equal(f.watch.view().groups.length, 1);

  f.world.advanced = false;
  f.watch.sync();
  const before = f.asked.length;
  await f.beat(3); await f.pass(60_000);
  assert.deepEqual([...f.streams.values()].map((stream) => stream.state), ["off", "off"]);
  assert.deepEqual([f.ticks.length, f.asked.length - before, f.watch.view().groups.length], [0, 0, 0]);
});

test("Live: a place is read when its stream says something changed, once for a burst, and not for chatter", async () => {
  const f = setup();
  f.watch.sync();
  await f.frame("e14", "hello");
  await f.pass(FRAME_SETTLE_MS);
  assert.equal(f.reads("e14"), 1, "a new connection starts with what the place has now");
  for (const kind of ["message", "message.patch", "bot", "message.patch", "notify"]) await f.frame("e14", kind);
  await f.pass(FRAME_GAP_MS);
  assert.equal(f.reads("e14"), 2, "a bot writing sends many frames: one read");
  for (const kind of ["runtime", "ping", "routine.run"]) await f.frame("e14", kind);
  await f.frame("e14", "hello", { resumed: true });
  await f.pass(10_000);
  assert.equal(f.reads("e14"), 2);
  assert.equal(f.reads("local"), 0, "the other place said nothing");
});

test("an interval asks every place when it is due, and only while the window can be seen", async () => {
  const f = setup();
  f.chosen.check = "15";
  f.watch.sync();
  assert.equal(f.streams.size, 0, "an interval holds no stream");
  await f.beat();
  assert.deepEqual([f.reads("local"), f.reads("e14")], [1, 1]);
  await f.beat(2);
  assert.equal(f.reads("e14"), 1, "10 s later it is not due");
  await f.beat();
  assert.equal(f.reads("e14"), 2, "15 s later it is");
  f.world.shown = false;
  await f.beat(12);
  assert.equal(f.reads("e14"), 2, "a hidden window asks nothing");
});

test("When I open All places asks on opening only; Never asks only when told to", async () => {
  const f = setup();
  f.chosen.check = "open";
  f.watch.sync();
  await f.beat(30);
  assert.equal(f.asked.length, 0);
  f.watch.opened(true);
  await settle();
  assert.deepEqual([f.reads("local"), f.reads("e14")], [1, 1]);

  f.chosen.check = "never";
  f.watch.opened(false); f.watch.opened(true);
  await settle(); await f.beat(30);
  assert.equal(f.reads("e14"), 1);
  await f.watch.refresh();
  assert.equal(f.reads("e14"), 2, "the person asked");
});

test("reads are marked as background work; an answer is the person's own", async () => {
  const f = setup();
  f.chosen.check = "open";
  f.watch.opened(true);
  await settle();
  assert.ok(f.asked.every((one) => one.background && one.method === "GET"));
  await f.watch.act("e14", "r1", "allow");
  const sent = f.asked.find((one) => one.method === "POST");
  assert.deepEqual(sent, { place: "e14", route: "/api/threads/t2/respond", method: "POST", background: false, body: { requestId: "q-r1", behavior: "allow" } });
});

test("a place that stops answering keeps what it said, since when, and takes no answer; it is back when it answers", async () => {
  const f = setup();
  f.chosen.check = "15";
  f.watch.sync();
  await f.beat();
  f.world.servers.e14.down = true;
  await f.beat(3);
  const view = f.watch.view(), there = view.places.find((place) => place.id === "e14");
  assert.deepEqual([there.state, there.seenAt, there.failingSince], ["unreachable", 6_000, 21_000]);
  assert.equal(there.retryAt, 36_000, "the next time it is asked");
  assert.deepEqual(view.rows.map((row) => [row.id, row.stale, row.actions]), [["r1", true, []]]);
  assert.equal(view.groups.find((group) => group.placeId === "e14").bots[0].name, "Jarvis");
  assert.deepEqual([view.waiting, view.incomplete], [0, true]);

  const before = f.asked.length;
  assert.deepEqual(await f.watch.act("e14", "r1", "allow"), { outcome: "refused" });
  assert.equal(f.asked.length, before, "nothing is sent, now or later");

  f.world.servers.e14.down = false;
  await f.beat(3);
  const back = f.watch.view();
  assert.deepEqual([back.places.find((place) => place.id === "e14").state, back.rows[0].stale, back.incomplete], ["ok", false, false]);
});

test("a sign-in that ended, a refused origin, a server with no inbox and a sleeping Cloud each say so", async () => {
  const f = setup();
  f.chosen.check = "open";
  f.world.places = [HERE, E14, { id: "old", name: "Old", kind: "server", origin: "https://old.test" }, { id: "gate", name: "Gate", kind: "server", origin: "https://gate.test" }, { id: "cloud", name: "My Cloud", kind: "cloud", origin: "https://cloud.test" }];
  Object.assign(f.world.servers, { e14: { status: 401 }, old: { bots: [bot("o", "Olive")], noInbox: true }, gate: { status: 403, said: { error: "forbidden: cross-origin request" } }, cloud: { bots: [], rows: [] } });
  f.world.asleep = "https://cloud.test";
  f.watch.opened(true);
  await settle();
  const states = Object.fromEntries(f.watch.view().places.map((place) => [place.id, place]));
  assert.deepEqual([states.e14.state, states.e14.blocked], ["blocked", "signed-out"]);
  assert.deepEqual([states.gate.state, states.gate.blocked, states.gate.message], ["blocked", "refused", "forbidden: cross-origin request"]);
  assert.deepEqual([states.old.state, states.old.noInbox], ["ok", true]);
  assert.equal(states.cloud.state, "asleep");
  assert.equal(f.asked.some((one) => one.place === "cloud"), false, "a sleeping Cloud is never asked");
  assert.equal(f.watch.view().groups.find((group) => group.placeId === "old").bots[0].name, "Olive");
});

test("an answer someone already gave there is not sent twice, and a server's refusal is told in its words", async () => {
  const f = setup();
  f.chosen.check = "open";
  f.watch.opened(true);
  await settle();
  f.world.servers.e14.respond = () => ({ ok: true, outcome: "unavailable" });
  assert.deepEqual(await f.watch.act("e14", "r1", "allow"), { outcome: "gone" });
  await settle();
  assert.equal(f.reads("e14"), 2, "the place is read again after an answer");
  assert.deepEqual(await f.watch.act("e14", "nope", "allow"), { outcome: "gone" });
  assert.deepEqual(await f.watch.act("nowhere", "r1", "allow"), { outcome: "refused" });
  await settle();
  f.world.servers.e14.status = 409;
  f.world.servers.e14.said = { error: "answer this question before dismissing it" };
  // Read while it still answered: the line is known, the answer is what fails.
  assert.deepEqual(await f.watch.act("e14", "r1", "deny"), { outcome: "failed", message: "answer this question before dismissing it" });
});

test("a line that begins to wait in a place off screen is told once; never the first reading, the place on screen, or a page being looked at", async () => {
  const f = setup();
  f.chosen.check = "15";
  f.watch.sync();
  await f.beat();
  assert.deepEqual(f.notes, [], "what was already waiting is not news");

  f.world.servers.e14.rows = [approval("r1"), approval("r2")];
  f.world.servers.local.rows = [approval("h1")];
  await f.beat(3);
  assert.deepEqual(f.notes, [["e14", "r2"]], "this computer is on screen: its own page tells");
  await f.beat(3);
  assert.deepEqual(f.notes, [["e14", "r2"]], "told once");

  f.watch.opened(true);
  f.world.servers.e14.rows = [approval("r1"), approval("r2"), approval("r3")];
  await f.beat(3);
  assert.equal(f.notes.length, 1, "All places is open in a focused window: the person sees it");
  f.world.focused = false;
  f.world.servers.e14.rows = [approval("r1"), approval("r2"), approval("r3"), approval("r4")];
  await f.beat(3);
  assert.deepEqual(f.notes.at(-1), ["e14", "r4"]);

  f.chosen.notify = false;
  f.world.servers.e14.rows = [approval("r5")];
  await f.beat(3);
  assert.equal(f.notes.length, 2, "notifications turned off");
});

test("a place other people sign in to is left out until the person includes it; one left out is never asked", async () => {
  const f = setup();
  f.chosen.check = "open";
  f.world.places = [HERE, E14, TEAM];
  f.world.servers.team = { bots: [bot("t", "Tess")], rows: [] };
  f.watch.opened(true);
  await settle();
  assert.deepEqual(f.watch.view().places.map((place) => place.id), ["local", "e14"]);
  assert.equal(f.asked.some((one) => one.place === "team"), false);

  f.chosen.places = { team: true, e14: false };
  await f.watch.refresh();
  assert.deepEqual(f.watch.view().places.map((place) => place.id), ["local", "team"]);
  const before = f.asked.filter((one) => one.place === "e14").length;
  await f.watch.refresh();
  assert.equal(f.asked.filter((one) => one.place === "e14").length, before);
  assert.equal(f.watch.view().rows.some((row) => row.placeId === "e14"), false, "its lines go with it");
});

test("a jump names only a conversation main listed", async () => {
  const f = setup();
  f.chosen.check = "open";
  f.watch.opened(true);
  await settle();
  assert.deepEqual(f.watch.target("e14", "j"), { place: E14, botId: "j", threadId: "j-thread" });
  assert.deepEqual(f.watch.target("e14", "b2", "t2"), { place: E14, botId: "b2", threadId: "t2" }, "a line's own conversation");
  assert.equal(f.watch.target("e14", "b2", "elsewhere"), null);
  assert.equal(f.watch.target("e14", "k"), null, "another place's bot");
  assert.equal(f.watch.target("nowhere", "j"), null);
});
