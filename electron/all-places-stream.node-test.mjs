import assert from "node:assert/strict";
import test from "node:test";

import { createFrameReader, createPlaceStream, LADDER_MS, OFFLINE_MS, SILENCE_MS, STABLE_MS } from "./all-places-stream.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A stream's body the test feeds and ends. */
function body() {
  let feed;
  const stream = new ReadableStream({ start(controller) { feed = controller; } });
  const bytes = new TextEncoder();
  return { stream, say: (frame) => feed.enqueue(bytes.encode(`data: ${JSON.stringify(frame)}\n\n`)), end: () => feed.close(), fail: () => feed.error(new Error("reset")) };
}

function setup(over = {}) {
  const timers = [], frames = [], opened = [];
  let clock = 0, states = 0;
  const answers = [];
  const stream = createPlaceStream({
    open: async (signal) => { opened.push(clock); const next = answers.shift(); if (!next) throw new Error("no route"); if (next.body) signal.addEventListener("abort", () => next.fail?.()); return next; },
    onFrame: (frame) => frames.push(frame.kind),
    onState: () => { states += 1; },
    now: () => clock,
    setTimer: (run, ms) => { const timer = { run, at: clock + ms, ms }; timers.push(timer); return timer; },
    clearTimer: (timer) => { const at = timers.indexOf(timer); if (at !== -1) timers.splice(at, 1); },
    ...over,
  });
  /** Time passes: every timer due by then runs, in order. */
  const pass = async (ms) => {
    const until = clock + ms;
    for (;;) {
      const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      clock = due.at;
      due.run();
      await settle();
    }
    clock = until;
  };
  const answer = (status, feed = null) => { answers.push({ ok: status < 400, status, body: feed?.stream ?? null, fail: feed?.fail }); };
  return { stream, frames, opened, timers, answer, pass, states: () => states };
}

test("a stream's text comes as frames whatever the size of its pieces", () => {
  const seen = [], reader = createFrameReader((frame) => seen.push(frame.kind));
  reader.push(": keep-alive\n\nda");
  reader.push('ta: {"kind":"hello"}\n');
  reader.push('\ndata: {"kind":"bot"}\r\n\r\ndata: not json\n\ndata: {"kind":"notify"}\n\n');
  assert.deepEqual(seen, ["hello", "bot", "notify"]);
});

test("a place's frames arrive while the connection holds", async () => {
  const f = setup(), feed = body();
  f.answer(200, feed);
  f.stream.start();
  await settle();
  assert.equal(f.stream.state(), "live");
  feed.say({ kind: "hello" }); feed.say({ kind: "bot" });
  await settle();
  assert.deepEqual(f.frames, ["hello", "bot"]);
});

test("a place that does not answer is tried again on the ladder, and never faster", async () => {
  const f = setup();
  f.stream.start();
  await settle();
  assert.equal(f.stream.state(), "waiting");
  assert.equal(f.stream.retryAt(), LADDER_MS[0]);
  await f.pass(60_000);
  const gaps = f.opened.slice(1).map((at, index) => at - f.opened[index]);
  assert.deepEqual(gaps.slice(0, 5), [3_000, 4_000, 8_000, 16_000, 16_000]);
});

test("a connection that held starts the ladder over; one that dropped at once does not", async () => {
  const f = setup(), first = body(), second = body();
  f.stream.start();
  await settle();
  f.answer(200, first);
  await f.pass(LADDER_MS[0]);
  assert.equal(f.stream.state(), "live");
  first.end();
  await settle();
  assert.equal(f.stream.retryAt() - f.opened.at(-1), LADDER_MS[1], "it dropped at once: the next step");
  f.answer(200, second);
  await f.pass(LADDER_MS[1]);
  for (let said = 0; said < STABLE_MS; said += 10_000) { await f.pass(10_000); second.say({ kind: "ping" }); await settle(); }
  const dropped = f.opened.at(-1) + STABLE_MS;
  second.end();
  await settle();
  assert.equal(f.stream.retryAt() - dropped, LADDER_MS[0], "it held: the first step again");
});

test("a sign-in that ended waits for the person: no attempt follows", async () => {
  const f = setup();
  f.answer(401);
  f.stream.start();
  await settle();
  assert.equal(f.stream.state(), "blocked");
  await f.pass(120_000);
  assert.equal(f.opened.length, 1);
  assert.equal(f.stream.retryAt(), null);
});

test("offline spends no attempt", async () => {
  let online = false;
  const f = setup({ online: () => online });
  f.stream.start();
  await f.pass(OFFLINE_MS * 4);
  assert.equal(f.opened.length, 0, "nothing is asked while the computer is offline");
  online = true;
  await f.pass(OFFLINE_MS);
  assert.equal(f.opened.length, 1);
  assert.equal(f.stream.retryAt() - f.opened[0], LADDER_MS[0], "the ladder starts at its first step");
});

test("a stream that goes silent is dropped and opened again", async () => {
  const f = setup(), feed = body();
  f.answer(200, feed);
  f.stream.start();
  await settle();
  await f.pass(SILENCE_MS);
  assert.equal(f.stream.state(), "waiting");
});

test("stopped, it asks nothing more", async () => {
  const f = setup();
  f.stream.start();
  await settle();
  f.stream.stop();
  await f.pass(120_000);
  assert.equal(f.stream.state(), "off");
  assert.equal(f.opened.length, 1);
});
