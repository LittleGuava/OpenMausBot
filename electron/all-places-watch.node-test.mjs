import assert from "node:assert/strict";
import test from "node:test";

import { createPlaceStream, LADDER_MS } from "./all-places-stream.mjs";
import { createAllPlacesWatch, FRAME_GAP_MS, FRAME_SETTLE_MS, TICK_MS } from "./all-places-watch.mjs";
import { ASLEEP_HOLD_MS } from "./cloud-power.mjs";

const settle = async () => { for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve)); };
const answer = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
function feed(signal) {
  let controller;
  const stream = new ReadableStream({ start(made) { controller = made; } });
  const bytes = new TextEncoder();
  signal?.addEventListener("abort", () => { try { controller.error(new Error("aborted")); } catch {} });
  return { stream, say: (frame) => controller.enqueue(bytes.encode(`data: ${JSON.stringify(frame)}\n\n`)), end: () => controller.close() };
}

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
    servers: { local: { bots: [bot("k", "Kae")], rows: [] }, e14: { bots: [bot("j", "Jarvis", { section: "Indigo" })], rows: [approval("r1")] } },
  };
  const watch = createAllPlacesWatch({
    places: () => world.places,
    request: async (place, route, init = {}) => {
      asked.push({ place: place.id, route, method: init.method ?? "GET", background: init.background === true, ...(init.body ? { body: init.body } : {}) });
      const server = world.servers[place.id];
      if (!server || server.down) throw new Error("no route");
      if (server.held) await server.held;
      if (route.startsWith("/api/events") && server.feeds) { const next = feed(init.signal); server.feeds.push(next); return { ok: true, status: 200, body: next.stream }; }
      const made = server.answers?.(route);
      if (made) return made;
      if (server.status) return answer(server.status, server.said ?? {}, server.headers);
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
      const stream = { state: "off", deps };
      return {
        start: () => { stream.state = "live"; const before = asked.length; void deps.open(new AbortController().signal).catch(() => {}); streams.set(asked[before].place, stream); },
        stop: () => { stream.state = "off"; }, state: () => stream.state, retryAt: () => stream.retryAt ?? null,
      };
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
  await f.beat(2);
  assert.equal(f.asked.filter((one) => one.method === "POST").length, 0, "nothing is sent, now or later");
  assert.ok(f.asked.length >= before);

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

const CLOUD = { id: "cloud", name: "My Cloud", kind: "cloud", origin: "https://cloud.test" };
const streamsAsked = (f, id) => f.asked.filter((one) => one.place === id && one.route.startsWith("/api/events")).length;
function live(servers = {}) {
  const f = setup({ makeStream: createPlaceStream });
  f.world.places = [HERE, CLOUD];
  Object.assign(f.world.servers, { local: { bots: [], rows: [], feeds: [] }, cloud: { bots: [bot("c", "Cleo")], rows: [], feeds: [] }, ...servers });
  return f;
}

test("Live: a Cloud that says it is going to sleep is not asked again, by its stream or anything else, until it may be awake", async () => {
  const f = live();
  f.watch.sync();
  await settle();
  const cloud = f.world.servers.cloud.feeds[0];
  cloud.say({ kind: "hello", resumed: false });
  await settle(); await f.pass(FRAME_SETTLE_MS);
  assert.equal(f.reads("cloud"), 1);

  cloud.say({ kind: "power", state: "sleeping" });
  cloud.end();
  await settle();
  const sleptAt = f.world.clock;
  const before = f.asked.filter((one) => one.place === "cloud").length;
  for (let waited = 0; waited < 60_000; waited += TICK_MS) { await f.pass(TICK_MS); await f.beat(); }
  assert.equal(f.asked.filter((one) => one.place === "cloud").length, before, "a request would wake it");
  assert.equal(f.watch.view().places.find((place) => place.id === "cloud").state, "asleep");
  assert.equal(f.watch.view().groups.find((group) => group.placeId === "cloud").bots[0].name, "Cleo", "what it said stays");
  await f.watch.refresh();
  assert.equal(f.asked.filter((one) => one.place === "cloud").length, before, "not even when the person asks for every place");

  for (let turns = 0; turns < 100 && streamsAsked(f, "cloud") === 1; turns++) await f.beat();
  assert.equal(streamsAsked(f, "cloud"), 2, "a sleep that never came stops holding it back");
  assert.ok(f.world.clock - sleptAt >= ASLEEP_HOLD_MS, "and not a moment before");
});

test("Live: a Cloud the Admin says is asleep is never listened to, and one that answers that it sleeps is left alone", async () => {
  const f = live();
  f.world.asleep = "https://cloud.test";
  f.watch.sync();
  await settle(); await f.beat(6);
  assert.equal(f.asked.filter((one) => one.place === "cloud").length, 0);

  const g = live({ cloud: { status: 503, headers: { "x-omb-cloud-power": "asleep" } } });
  g.chosen.check = "open";
  g.watch.opened(true);
  await settle();
  assert.equal(g.watch.view().places.find((place) => place.id === "cloud").state, "asleep");
  const before = g.asked.filter((one) => one.place === "cloud").length;
  g.chosen.check = "15";
  await g.beat(12);
  assert.equal(g.asked.filter((one) => one.place === "cloud").length, before);
});

test("Live: a stream that keeps failing stops asking once the window is hidden, and once the page is back in Simple mode", async () => {
  for (const stop of [(f) => { f.world.shown = false; }, (f) => { f.world.advanced = false; }]) {
    const f = live({ cloud: { down: true } });
    f.watch.sync();
    await settle();
    await f.pass(LADDER_MS[0] + LADDER_MS[1]);
    assert.ok(streamsAsked(f, "cloud") >= 2, "it was trying again on the ladder");
    stop(f);
    await f.beat();
    const before = f.asked.length;
    for (let waited = 0; waited < 120_000; waited += TICK_MS) { await f.pass(TICK_MS); await f.beat(); }
    assert.equal(f.asked.length, before);
  }
});

test("an answer that lands after All places was turned off asks the place nothing more", async () => {
  const f = setup();
  f.chosen.check = "open";
  f.watch.opened(true);
  await settle();
  let release;
  f.world.servers.e14.held = new Promise((resolve) => { release = resolve; });
  const answered = f.watch.act("e14", "r1", "allow");
  await settle();
  f.chosen.on = false;
  f.watch.sync();
  const before = f.asked.length;
  release();
  await answered;
  await settle(); await f.pass(60_000);
  assert.deepEqual(f.asked.slice(before), [], "off asks nothing");
  assert.equal(f.watch.view().active, false);
});

test("a place is read again after an answer, even when a read from before the answer was still under way", async () => {
  const f = setup();
  f.chosen.check = "open";
  f.watch.opened(true);
  await settle();
  let release;
  f.world.servers.e14.held = new Promise((resolve) => { release = resolve; });
  const reading = f.watch.refresh("e14");
  await settle();
  const answered = f.watch.act("e14", "r1", "allow");
  f.world.servers.e14.respond = () => { f.world.servers.e14.rows = []; return { ok: true, outcome: "allowed-once" }; };
  f.world.servers.e14.held = null;
  release();
  assert.deepEqual(await answered, { outcome: "done" });
  await reading; await settle();
  assert.deepEqual(f.watch.view().rows.filter((row) => row.placeId === "e14"), [], "the answered line is not listed as waiting");
});

test("a conversation opens beside the list only in a place that answers now: one that stopped answering opens none, until it is back", async () => {
  const f = setup();
  f.chosen.check = "15";
  f.watch.sync();
  await f.beat();
  assert.deepEqual(f.watch.target("e14", "j"), { place: E14, botId: "j", threadId: "j-thread" });
  f.world.servers.e14.down = true;
  await f.beat(3);
  assert.equal(f.watch.view().groups.find((group) => group.placeId === "e14").bots[0].name, "Jarvis", "its bots stay on the list, dated");
  assert.equal(f.watch.target("e14", "j"), null, "the window is not sent to a place that does not answer");
  assert.deepEqual(f.watch.target("local", "k"), { place: HERE, botId: "k", threadId: "k-thread" }, "the other places open as before");
  f.world.servers.e14.down = false;
  await f.beat(3);
  assert.deepEqual(f.watch.target("e14", "j"), { place: E14, botId: "j", threadId: "j-thread" });
});

test("a conversation of a bot's opens by name only when its place listed it; any other name opens nothing, never some other conversation", async () => {
  const f = setup();
  f.world.servers.e14.bots = [bot("j", "Jarvis", { tasks: [{ threadId: "j-thread", title: "Daily briefing", createdAt: 2 }, { threadId: "j-other", title: "New thread", createdAt: 1 }] })];
  f.chosen.check = "open";
  f.watch.opened(true);
  await settle();
  assert.deepEqual(f.watch.view().groups.find((group) => group.placeId === "e14").bots[0].threads.map((thread) => thread.id), ["j-thread", "j-other"]);
  assert.deepEqual(f.watch.target("e14", "j", "j-other"), { place: E14, botId: "j", threadId: "j-other" });
  assert.deepEqual(f.watch.target("e14", "j"), { place: E14, botId: "j", threadId: "j-thread" }, "no name: the conversation the bot opens to");
  assert.equal(f.watch.target("e14", "j", "not-listed"), null);
});

const placeState = (f, id) => f.watch.view().places.find((place) => place.id === id).state;
const askedOf = (f, id) => f.asked.filter((one) => one.place === id).length;
/** Main says its rail changed, as it does many times a minute while a Cloud account is signed in, and time passes. */
const railSays = async (f, times) => { for (let turn = 0; turn < times; turn++) { f.watch.sync(); await f.pass(TICK_MS); await f.beat(); } };

test("a place whose sign-in ended waits for the person, on an interval as in Live: nothing asks it until the window shows another place, the sign that they may have signed in", async () => {
  for (const check of ["15", "live"]) {
    const f = live({ e14: { status: 401 } });
    f.world.places = [HERE, E14];
    f.chosen.check = check;
    f.watch.sync();
    await settle(); await f.beat();
    assert.equal(placeState(f, "e14"), "blocked", check);
    const before = askedOf(f, "e14");
    await railSays(f, 24);
    assert.equal(askedOf(f, "e14"), before, check + ": neither the clock nor a rail that says it changed, with the same places and the same one on screen, asks it anything");

    f.world.active = "e14";
    f.watch.sync();
    await settle();
    assert.deepEqual([placeState(f, "e14"), askedOf(f, "e14") - before], ["blocked", 2], check + ": the window went to that place: it is asked once, and still refuses");
    f.world.servers.e14 = { bots: [bot("j", "Jarvis")], rows: [approval("r1")], feeds: [] };
    await railSays(f, 24);
    assert.deepEqual([placeState(f, "e14"), askedOf(f, "e14") - before], ["blocked", 2], check + ": main does not hear a sign-in on that place's own page");

    f.world.active = "local";
    f.watch.sync();
    await settle();
    assert.equal(placeState(f, "e14"), "ok", check + ": the window left that place, so it is asked once more");
    assert.deepEqual(f.watch.view().rows.map((row) => [row.id, row.stale]), [["r1", false]], check);
    if (check !== "live") continue;
    await f.beat();
    assert.equal(streamsAsked(f, "e14"), 2, "and it is listened to again");
  }
});

test("a place the person chose to ask only on opening All places, or never, is not asked when the window shows another place", async () => {
  for (const check of ["open", "never"]) {
    const f = setup();
    f.chosen.check = check;
    f.world.servers.e14 = { status: 401 };
    await f.watch.refresh();
    assert.equal(placeState(f, "e14"), "blocked", check);
    const before = f.asked.length;
    f.world.active = "e14";
    f.watch.sync();
    await settle();
    f.world.active = "local";
    f.watch.sync();
    await settle(); await f.beat(3);
    assert.equal(f.asked.length, before, check);
  }
});

test("Live: a place the person asks again, and that answers now, is listened to at once", async () => {
  const f = live({ e14: { status: 401 } });
  f.world.places = [HERE, E14];
  f.watch.sync();
  await settle(); await f.beat();
  assert.equal(placeState(f, "e14"), "blocked");
  f.world.servers.e14 = { bots: [bot("j", "Jarvis")], rows: [], feeds: [] };
  await f.watch.refresh("e14");
  assert.deepEqual([placeState(f, "e14"), streamsAsked(f, "e14")], ["ok", 2]);
});

test("Live: a place that refuses its stream waits for the person even while it answers a read, and is asked in no loop", async () => {
  const f = live();
  f.world.places = [HERE, E14];
  f.world.servers.e14 = { bots: [bot("j", "Jarvis")], rows: [], answers: (route) => (route.startsWith("/api/events") ? answer(401, {}) : null) };
  f.watch.sync();
  await settle(); await f.beat();
  assert.equal(placeState(f, "e14"), "blocked");
  await f.watch.refresh("e14");
  await settle();
  assert.equal(placeState(f, "e14"), "blocked", "the stream's refusal is the last word");
  assert.equal(f.watch.view().groups.find((group) => group.placeId === "e14").bots[0].name, "Jarvis", "what it answered is kept, dated");
  const before = askedOf(f, "e14");
  await railSays(f, 24);
  assert.equal(askedOf(f, "e14"), before);
});

const CAP = 1_000_000, CHUNK = 100_000;
/** A place's bots, well formed and that many bytes long, handed over a piece at a time and only as it is read. */
function big(bytes) {
  const head = '{"sections":[],"bots":[],"pad":"', tail = '"}';
  const raw = new TextEncoder().encode(head + "a".repeat(bytes - head.length - tail.length) + tail);
  let at = 0, pulled = 0;
  const stream = new ReadableStream({ pull(controller) { if (at >= raw.length) return controller.close(); pulled += 1; controller.enqueue(raw.subarray(at, at += CHUNK)); } }, { highWaterMark: 0 });
  return { response: (headers = {}) => new Response(stream, { status: 200, headers }), pulled: () => pulled };
}

test("an answer too big to be a place's bots or inbox is not taken into main: the place is one that can't be read now, keeps what it said, and the log says why once", async () => {
  const logged = [];
  const f = setup({ maxAnswerBytes: CAP, log: (said) => logged.push(said) });
  f.chosen.check = "open";
  f.watch.opened(true);
  await settle();

  const most = big(CAP);
  f.world.servers.e14.answers = (route) => (route.startsWith("/api/bots?") ? most.response() : null);
  await f.watch.refresh("e14");
  assert.deepEqual([placeState(f, "e14"), logged.length], ["ok", 0], "the most a place may say is read");

  const floods = [];
  f.world.servers.e14.answers = (route) => (route.startsWith("/api/bots?") ? (floods.push(big(2 * CAP)), floods.at(-1).response()) : null);
  await f.watch.refresh("e14");
  assert.equal(placeState(f, "e14"), "unreachable");
  assert.ok(floods[0].pulled() <= CAP / CHUNK + 2, "main stopped reading where the limit was passed: " + floods[0].pulled() + " pieces read");
  assert.deepEqual(f.watch.view().rows.map((row) => [row.id, row.stale, row.actions]), [["r1", true, []]], "its lines stay, dated, and take no answer");
  await f.watch.refresh("e14");
  assert.equal(logged.length, 1, "said once while it stays so");
  assert.equal(logged.some((said) => /e14/i.test(said)), false, "and never which place, by name or address");

  const declared = big(1_000);
  f.world.servers.e14.answers = (route) => (route === "/api/inbox" ? declared.response({ "content-length": String(CAP + 1) }) : null);
  await f.watch.refresh("e14");
  assert.equal(placeState(f, "e14"), "unreachable");
  assert.equal(declared.pulled(), 0, "an answer that says it is too big is not read at all");
});

test("an answer that begins with a byte order mark is read as any other", async () => {
  const f = setup();
  f.chosen.check = "open";
  f.world.servers.e14.answers = (route) => (route.startsWith("/api/bots?") ? new Response("﻿" + JSON.stringify({ sections: [], bots: [bot("j", "Jarvis")] })) : null);
  f.watch.opened(true);
  await settle();
  assert.equal(placeState(f, "e14"), "ok");
});

test("Live: a message put in line, or taken out of it, is something that changed", async () => {
  const f = setup();
  f.watch.sync();
  await f.frame("e14", "hello");
  await f.pass(FRAME_SETTLE_MS);
  await f.frame("e14", "bot.queued");
  await f.pass(FRAME_GAP_MS);
  assert.equal(f.reads("e14"), 2);
});
