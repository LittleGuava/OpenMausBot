// All places' readings: which places are asked, when, and what each last said. Off until the person turns it on, and
// only while this app's own page says the Advanced mode is on: then nothing here runs, no timer and no request.
//
// "Check other places" is the person's choice: Live (main listens to each place's event stream and reads the place again
// when it says something changed), every 15 s to 2 min, only when All places opens, or never (only when asked). As for
// the rail's dots (place-inbox-watch.mjs): only while the window can be seen, never a Cloud that sleeps, and every read
// marked as background work.
//
// A place that can't be read keeps what it last said, dated, and takes no answer: an approval delivered hours later
// could allow something that no longer makes sense.
import { actionRequests, allPlacesView, CHECKS, DEFAULT_CHECK, newlyWaiting, parseBots, parseInbox, PREVIEW_MESSAGES } from "./all-places.mjs";
import { createPlaceStream } from "./all-places-stream.mjs";
import { asleepAnswer, ASLEEP_HOLD_MS } from "./cloud-power.mjs";

export const TICK_MS = 5_000;
export const READ_TIMEOUT_MS = 10_000;
/** A stream's frames come in bursts while a bot writes: the place is read once they settle, and not more often than this. */
export const FRAME_SETTLE_MS = 400;
export const FRAME_GAP_MS = 1_500;
/** The frames that say a place's bots or inbox may have changed. */
const CHANGES = new Set(["bot", "bot.deleted", "bots.order", "sections", "message", "message.patch", "notify", "notifications.read", "group", "group.deleted"]);

const checkOf = (value) => (CHECKS.includes(value) ? value : DEFAULT_CHECK);
const everyMs = (check) => (/^\d+$/.test(check) ? Number(check) * 1_000 : null);

async function answerOf(response) {
  let body = null;
  try { body = await response.json(); } catch {}
  return { ok: response.ok === true, status: response.status, body, asleep: asleepAnswer(response) };
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
  online = () => true, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, setTick = setInterval, clearTick = clearInterval, makeStream = createPlaceStream }) {
  /** Per place: what it last said and how reading it went. */
  const readings = new Map();
  const streams = new Map();
  const settling = new Map();
  /** When a place last said it is going to sleep: for a while after, any request would wake it. */
  const napping = new Map();
  let open = false, tick = null, told = "";

  const active = () => prefs.allPlaces() === true && advanced() === true;
  const check = () => checkOf(prefs.allPlacesCheck());
  /** A place other people sign in to is left out until the person says otherwise. */
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

  /** The page is told only when what it would read changed. */
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
    const get = (route) => request(place, route, { background: true, timeoutMs: READ_TIMEOUT_MS }).then(answerOf, () => null);
    const [bots, inbox] = await Promise.all([get(`/api/bots?messages=${PREVIEW_MESSAGES}`), get("/api/inbox")]);
    if (!readings.has(place.id) || readings.get(place.id) !== entry) return;
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
    const fresh = entry.seenAt === null ? [] : newlyWaiting(entry.inbox, lines);
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
        // A Cloud that agreed to sleep says so and ends the stream, as its own page hears it (src/lib/live-events.ts):
        // opening the stream again, or reading the place, would wake it.
        if (frame.kind === "power" && frame.state === "sleeping") { napping.set(place.id, now()); failing(reading(place.id), "asleep"); deaf(place.id); return tell(); }
        if (frame.kind === "hello" ? frame.resumed !== true : CHANGES.has(frame.kind)) settle(place);
      },
      onState: () => {
        const entry = reading(place.id);
        if (stream.state() === "blocked" && entry.state !== "blocked") failing(entry, "blocked", { blocked: "signed-out" });
        // A stream that dropped says nothing about the place: reading it does.
        else if (stream.state() === "waiting") settle(place);
        tell();
      },
      // A place that sleeps is looked at again later, as an offline computer is: no request, no attempt spent.
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

  /** Timers and streams as the person's choices and the window now ask for; with the feature off, none at all. */
  function sync() {
    const listed = included(), ids = new Set(listed.map((place) => place.id));
    for (const id of readings.keys()) if (!ids.has(id)) readings.delete(id);
    const live = active() && check() === "live" && shown();
    for (const id of streams.keys()) if (!live || !ids.has(id) || sleeping(listed.find((place) => place.id === id))) deaf(id);
    if (live) for (const place of listed) if (!sleeping(place)) listen(place);
    if (active() && tick === null) { tick = setTick(beat, TICK_MS); tick?.unref?.(); }
    if (!active() && tick !== null) { clearTick(tick); tick = null; open = false; }
    tell();
  }

  function beat() {
    sync();
    const every = everyMs(check());
    if (every === null || !active() || !shown()) return;
    for (const place of included()) {
      const asked = reading(place.id).askedAt;
      if (asked === null || now() - asked >= every) void look(place);
    }
  }

  /** Every included place now (or one), as the person asked or All places opened. A stream that gave up starts again. */
  async function refresh(placeId) {
    if (!active()) return;
    const listed = included().filter((place) => placeId === undefined || place.id === placeId);
    for (const place of listed) if (streams.get(place.id)?.state() === "blocked") deaf(place.id);
    sync();
    await Promise.all(listed.map(look));
  }

  return {
    active, view, sync, refresh,
    /** All places is on screen, or was closed. Opening it reads every place, unless the person chose Never. */
    opened(on) {
      open = on === true && active();
      sync();
      if (open && check() !== "never" && shown()) void refresh();
    },
    /** An answer to a line, sent to the place it came from; refused while that place can't be read. */
    async act(placeId, rowId, action, value) {
      const place = included().find((candidate) => candidate.id === placeId), entry = place ? readings.get(place.id) : null;
      if (!place || !entry || entry.state !== "ok") return { outcome: "refused" };
      const requests = actionRequests(entry.inbox, rowId, action, value);
      if (!requests) { void look(place, { after: true }); return { outcome: "gone" }; }
      let last = null;
      for (const { method, route, body } of requests) {
        last = await request(place, route, { method, ...(body === undefined ? {} : { body }), timeoutMs: READ_TIMEOUT_MS }).then(answerOf, () => null);
        if (!last?.ok) break;
      }
      void look(place, { after: true });
      if (!last?.ok) return { outcome: "failed", ...(typeof last?.body?.error === "string" ? { message: last.body.error.slice(0, 300) } : {}) };
      // Someone answered it there first (from a phone, on that place's own page): the server says so, nothing is sent twice.
      return { outcome: last.body?.outcome === "unavailable" ? "gone" : "done" };
    },
    /** The conversation a bot or a line names, in the place main listed it for; null for anything it did not list. */
    target(placeId, botId, threadId) {
      const place = included().find((candidate) => candidate.id === placeId), entry = place ? readings.get(place.id) : null;
      if (!place || !entry) return null;
      const bot = entry.bots?.bots.find((candidate) => candidate.id === botId);
      const row = entry.inbox?.rows.find((candidate) => candidate.botId === botId && candidate.threadId !== null && candidate.threadId === threadId);
      const thread = row?.threadId ?? bot?.threadId ?? null;
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
