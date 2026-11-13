// All places' readings: which places are asked, when, and what each last said. Off until the person turns it on, and
// only while this app's own page says the Advanced mode is on: then nothing here runs, no timer and no request.
//
// "Check other places" is the person's choice: Live (main listens to each place's event stream and reads the place again
// when it says something changed), every 15 s to 2 min, only when All places opens, or never (only when asked). As for
// the rail's dots: only while the window can be seen, never a Cloud that sleeps, and every read
// marked as background work.
//
// A place that can't be read keeps what it last said, dated, and takes no answer: an approval delivered hours later
// could allow something that no longer makes sense.
import { actionRequests, allPlacesView, CHECKS, DEFAULT_CHECK, newlyWaiting, parseBots, parseInbox, PREVIEW_MESSAGES } from "./all-places.mjs";
import { createPlaceStream } from "./all-places-stream.mjs";
import { asleepAnswer, ASLEEP_HOLD_MS } from "./cloud-power.mjs";

export const TICK_MS = 5_000;
export const READ_TIMEOUT_MS = 10_000;
/** The most of one answer main takes in; past this the rest is not read. */
export const MAX_ANSWER_BYTES = 64 * 1024 * 1024;
/** A stream's frames come in bursts while a bot writes. */
export const FRAME_SETTLE_MS = 400;
export const FRAME_GAP_MS = 1_500;
const CHANGES = new Set(["bot", "bot.deleted", "bot.queued", "bots.order", "sections", "message", "message.patch", "notify", "notifications.read", "group", "group.deleted"]);

const checkOf = (value) => (CHECKS.includes(value) ? value : DEFAULT_CHECK);
const everyMs = (check) => (/^\d+$/.test(check) ? Number(check) * 1_000 : null);

/** Security: another server's answer is counted as it arrives, so one that never ends is dropped, not held in main.
 * Null once it is longer than `max`, or says it is. */
async function bytesOf(response, max) {
  if (Number(response.headers.get("content-length")) > max) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  for (let size = 0; ;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    size += value.byteLength;
    if (size > max) {
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
}

async function answerOf(response, max) {
  let body = null, tooBig = false;
  try {
    const bytes = await bytesOf(response, max);
    tooBig = bytes === null;
    if (bytes) body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {}
  return { ok: response.ok === true, status: response.status, body, tooBig, asleep: asleepAnswer(response) };
}

/**
 * @param {{
 *   places(): Array<{ id: string, name: string, kind: string, color?: string | null, origin?: string | null, local?: boolean, shared?: boolean }>,
 *   request(place: any, route: string, init?: { method?: string, body?: unknown, background?: boolean, timeoutMs?: number, signal?: AbortSignal }): Promise<Response>,
 *   prefs: { allPlaces(): boolean, allPlacesCheck(): string, allPlacesNotify(): boolean, allPlacesChoice(id: string): boolean | null },
 *   advanced(): boolean,
 *   shown(): boolean,
 *   asleep?(origin: string): boolean,
 *   activeId?(): string | null,
 *   focused?(): boolean,
 *   notify?(note: { place: any, row: any }): void,
 *   changed?(): void,
 * }} deps `places`: every saved place, this computer `local`, one other people sign in to `shared`; `request`: one request
 * to that place as the signed-in person; `advanced`: this app's page says the Advanced mode is on; `shown`: the window can
 * be seen; `activeId`: the place the window shows; `notify`: a line began to wait in a place that is not on screen.
 */
export function createAllPlacesWatch({ places, request, prefs, advanced, shown, asleep = () => false, activeId = () => null, focused = () => false, notify = () => {}, changed = () => {},
  log = () => {}, maxAnswerBytes = MAX_ANSWER_BYTES,
  online = () => true, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, setTick = setInterval, clearTick = clearInterval, makeStream = createPlaceStream }) {
  const readings = new Map();
  const streams = new Map();
  const settling = new Map();
  /** When a place last said it is going to sleep: for a while after, any request would wake it. */
  const napping = new Map();
  /** The places whose last answer was too big to take in: the log says so once for each. */
  const flooded = new Set();
  let open = false, tick = null, told = "", shownTo = "";
  const answered = (response) => answerOf(response, maxAnswerBytes);

  const active = () => prefs.allPlaces() === true && advanced() === true;
  const check = () => checkOf(prefs.allPlacesCheck());
  const clocked = () => check() === "live" || everyMs(check()) !== null;
  const included = () => (active() ? places().filter((place) => prefs.allPlacesChoice(place.id) ?? place.shared !== true) : []);
  // Asleep by the Admin's word, or by the place's own a moment ago (a sleep that never came stops holding it back).
  const sleeping = (place) => !place.local && Boolean(place.origin) && (asleep(place.origin) || now() - (napping.get(place.id) ?? -Infinity) < ASLEEP_HOLD_MS);
  const reading = (id) => {
    if (!readings.has(id)) readings.set(id, { state: "loading", seenAt: null, failingSince: null, bots: null, inbox: null, askedAt: null, busy: null });
    return readings.get(id);
  };

  function retryAt(place, entry) {
    if (entry.state !== "unreachable") return null;
    const stream = streams.get(place.id);
    if (stream) return stream.retryAt();
    const every = everyMs(check());
    return every !== null && entry.askedAt !== null ? entry.askedAt + every : null;
  }

  function view() {
    const listed = included();
    return allPlacesView({ active: active(), check: check(), now: now(), places: listed,
      readings: new Map(listed.map((place) => { const entry = reading(place.id); return [place.id, { ...entry, live: streams.get(place.id)?.state() === "live", retryAt: retryAt(place, entry) }]; })) });
  }

  function tell() {
    const { now: _now, ...seen } = view();
    const key = JSON.stringify(seen);
    if (key === told) return;
    told = key;
    changed();
  }

  const failing = (entry, state, more = {}) => {
    delete entry.blocked; delete entry.message;
    Object.assign(entry, { state, failingSince: entry.failingSince ?? now(), ...more });
  };

  async function read(place) {
    const entry = reading(place.id);
    if (sleeping(place)) { failing(entry, "asleep"); return; }
    entry.askedAt = now();
    const get = (route) => request(place, route, { background: true, timeoutMs: READ_TIMEOUT_MS }).then(answered, () => null);
    const [bots, inbox] = await Promise.all([get(`/api/bots?messages=${PREVIEW_MESSAGES}`), get("/api/inbox")]);
    if (!readings.has(place.id) || readings.get(place.id) !== entry) return;
    const tooBig = bots?.tooBig === true || inbox?.tooBig === true;
    if (tooBig && !flooded.has(place.id)) log(`all places: an answer from a ${place.kind} was longer than ${maxAnswerBytes} bytes and was not read`);
    if (tooBig) flooded.add(place.id); else flooded.delete(place.id);
    if (bots?.asleep || inbox?.asleep) { napping.set(place.id, now()); deaf(place.id); return failing(entry, "asleep"); }
    const refused = [bots, inbox].find((answer) => answer && (answer.status === 401 || answer.status === 403));
    if (refused) {
      const said = typeof refused.body?.error === "string" ? refused.body.error.slice(0, 300) : "";
      // The server's same-origin gate turned this app's own request away: nothing to retry until its address is fixed.
      return failing(entry, "blocked", /cross-origin/i.test(said) ? { blocked: "refused", message: said } : { blocked: "signed-out" });
    }
    const said = bots?.ok ? parseBots(bots.body) : null;
    // A server from before the inbox answers 404 there: its bots are listed, its inbox is read on its own page.
    const noInbox = inbox?.status === 404;
    const lines = noInbox ? { rows: [] } : inbox?.ok ? parseInbox(inbox.body) : null;
    if (!said || !lines) return failing(entry, "unreachable");
    // A place that waited for the person answers again once they signed in on its page, where they saw what came meanwhile.
    const fresh = entry.seenAt === null || entry.state === "blocked" ? [] : newlyWaiting(entry.inbox, lines);
    delete entry.blocked; delete entry.message;
    if (noInbox) entry.noInbox = true; else delete entry.noInbox;
    Object.assign(entry, { state: "ok", seenAt: now(), failingSince: null, bots: said, inbox: lines });
    if (prefs.allPlacesNotify() === false || place.id === activeId() || (open && focused())) return;
    for (const row of fresh) { try { notify({ place, row }); } catch {} }
  }

  /** One read of a place at a time, and none once All places is off or the place was left out. `after`: something just
   * changed there (an answer was sent), so a read already under way, which may predate it, is followed by another. */
  function look(place, { after = false } = {}) {
    if (!active() || !included().some((listed) => listed.id === place.id)) return Promise.resolve();
    const entry = reading(place.id);
    if (entry.busy) { if (after) entry.again = true; return entry.busy; }
    entry.busy = read(place).catch(() => {}).finally(() => {
      entry.busy = null;
      tell();
      if (entry.again) { entry.again = false; void look(place); }
    });
    return entry.busy;
  }

  function settle(place) {
    if (settling.has(place.id)) return;
    const entry = reading(place.id);
    const wait = entry.askedAt === null ? FRAME_SETTLE_MS : Math.max(FRAME_SETTLE_MS, entry.askedAt + FRAME_GAP_MS - now());
    const timer = setTimer(() => { settling.delete(place.id); if (active() && shown()) void look(place); }, wait);
    timer?.unref?.();
    settling.set(place.id, timer);
  }

  function listen(place) {
    if (streams.has(place.id)) return;
    const stream = makeStream({
      open: (signal) => request(place, "/api/events?screens=off", { background: true, signal }),
      // Each connection starts with what the place has now; after that a frame only says something changed.
      onFrame: (frame) => {
        // A Cloud that agreed to sleep says so and ends the stream, as its own page hears it:
        // opening the stream again, or reading the place, would wake it.
        if (frame.kind === "power" && frame.state === "sleeping") { napping.set(place.id, now()); failing(reading(place.id), "asleep"); deaf(place.id); return tell(); }
        if (frame.kind === "hello" ? frame.resumed !== true : CHANGES.has(frame.kind)) settle(place);
      },
      onState: () => {
        const entry = reading(place.id);
        if (stream.state() === "blocked" && entry.state !== "blocked") failing(entry, "blocked", { blocked: "signed-out" });
        else if (stream.state() === "waiting") settle(place);
        tell();
      },
      online: () => online() && !sleeping(place), now, setTimer, clearTimer,
    });
    streams.set(place.id, stream);
    stream.start();
  }

  function deaf(id) {
    streams.get(id)?.stop();
    streams.delete(id);
    clearTimer(settling.get(id));
    settling.delete(id);
  }

  function sync() {
    const listed = included(), ids = new Set(listed.map((place) => place.id));
    for (const id of readings.keys()) if (!ids.has(id)) readings.delete(id);
    const live = active() && check() === "live" && shown();
    // A place that waits for the person (a sign-in that ended, an address its server refuses) is not asked on a timer: in
    // Live it holds no stream, on an interval it is not due.
    const heard = (place) => !sleeping(place) && readings.get(place.id)?.state !== "blocked";
    for (const id of streams.keys()) if (!live || !ids.has(id) || !heard(listed.find((place) => place.id === id))) deaf(id);
    if (live) for (const place of listed) if (heard(place)) listen(place);
    if (active() && tick === null) { tick = setTick(beat, TICK_MS); tick?.unref?.(); }
    if (!active() && tick !== null) { clearTick(tick); tick = null; open = false; }
    // Main does not hear a sign-in on a place's own page. The window showing another place, or its places changing, is
    // the sign that there may have been one: where the clock asks, a place that waits for the person is asked once more.
    const showing = JSON.stringify([listed.map((place) => place.id), activeId()]);
    if (showing !== shownTo && clocked() && shown()) {
      shownTo = showing;
      for (const place of listed) if (readings.get(place.id)?.state === "blocked") void look(place);
    }
    tell();
  }

  function beat() {
    sync();
    const every = everyMs(check());
    if (every === null || !active() || !shown()) return;
    for (const place of included()) {
      const { askedAt, state } = reading(place.id);
      if (state !== "blocked" && (askedAt === null || now() - askedAt >= every)) void look(place);
    }
  }

  async function refresh(placeId) {
    if (!active()) return;
    sync();
    await Promise.all(included().filter((place) => placeId === undefined || place.id === placeId).map(look));
    sync();
  }

  return {
    active, view, sync, refresh,
    opened(on) {
      open = on === true && active();
      sync();
      if (open && check() !== "never" && shown()) void refresh();
    },
    async act(placeId, rowId, action, value) {
      const place = included().find((candidate) => candidate.id === placeId), entry = place ? readings.get(place.id) : null;
      if (!place || !entry || entry.state !== "ok") return { outcome: "refused" };
      const requests = actionRequests(entry.inbox, rowId, action, value);
      if (!requests) { void look(place, { after: true }); return { outcome: "gone" }; }
      let last = null;
      for (const { method, route, body } of requests) {
        last = await request(place, route, { method, ...(body === undefined ? {} : { body }), timeoutMs: READ_TIMEOUT_MS }).then(answered, () => null);
        if (!last?.ok) break;
      }
      void look(place, { after: true });
      if (!last?.ok) return { outcome: "failed", ...(typeof last?.body?.error === "string" ? { message: last.body.error.slice(0, 300) } : {}) };
      // Someone answered it there first (from a phone, on that place's own page): the server says so, nothing is sent twice.
      return { outcome: last.body?.outcome === "unavailable" ? "gone" : "done" };
    },
    /** Null for anything main did not list, and for a place that does not answer now. */
    target(placeId, botId, threadId) {
      const place = included().find((candidate) => candidate.id === placeId), entry = place ? readings.get(place.id) : null;
      if (!place || !entry || entry.state !== "ok") return null;
      const bot = entry.bots?.bots.find((candidate) => candidate.id === botId);
      const row = entry.inbox?.rows.find((candidate) => candidate.botId === botId && candidate.threadId !== null && candidate.threadId === threadId);
      const listed = threadId !== undefined && (threadId === bot?.threadId || bot?.threads?.some((candidate) => candidate.id === threadId) === true);
      const thread = row?.threadId ?? (threadId === undefined ? bot?.threadId : listed ? threadId : null) ?? null;
      return thread ? { place, botId, threadId: thread } : null;
    },
    stop() {
      for (const id of streams.keys()) deaf(id);
      if (tick !== null) { clearTick(tick); tick = null; }
      readings.clear();
      open = false;
    },
  };
}
