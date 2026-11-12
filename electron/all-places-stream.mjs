// One place's event stream, held by main for All places' "Live": the same GET /api/events its own page reads, over
// this window's sign-in there. Main never applies a frame: one only says the place changed, so it is read again.
//
// One supervisor owns reconnection (docs/plans/remote-workspace.md): a fixed ladder, back to its first step once a
// connection held, no attempt spent while offline, and a hard split between a failure that may pass (retry) and one that
// waits for the person (a sign-in that ended: no loop).

export const LADDER_MS = Object.freeze([3_000, 4_000, 8_000, 16_000]);
export const STABLE_MS = 30_000;
/** The server pings well inside this; a stream that says nothing for so long is gone. */
export const SILENCE_MS = 40_000;
export const OFFLINE_MS = 5_000;

export function createFrameReader(onFrame) {
  let buffer = "";
  return {
    push(text) {
      buffer += String(text).replace(/\r\n/g, "\n");
      for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block.split("\n").filter((row) => row.startsWith("data:")).map((row) => row.slice(5).trimStart()).join("\n");
        if (!data) continue;
        let frame;
        try { frame = JSON.parse(data); } catch { continue; }
        if (frame && typeof frame === "object") onFrame(frame);
      }
      // A stream that never ends a frame must not grow without bound.
      if (buffer.length > 4_000_000) buffer = "";
    },
  };
}

/**
 * @param {{
 *   open(signal: AbortSignal): Promise<{ ok: boolean, status: number, body: ReadableStream<Uint8Array> | null }>,
 *   onFrame(frame: { kind?: string }): void,
 *   onState?(): void,
 *   online?(): boolean,
 *   now?(): number,
 *   setTimer?: typeof setTimeout,
 *   clearTimer?: typeof clearTimeout,
 * }} deps `open`: the stream's response; `onState`: connected, waiting or blocked changed.
 */
export function createPlaceStream({ open, onFrame, onState = () => {}, online = () => true, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let state = "off", attempt = 0, retry = null, retryAt = null, silence = null, abort = null, run = 0;

  const set = (next) => { if (next !== state) { state = next; onState(); } };
  const stopTimers = () => { clearTimer(retry); clearTimer(silence); retry = silence = null; retryAt = null; };
  const later = (ms, spend) => {
    stopTimers();
    if (spend) attempt += 1;
    retryAt = now() + ms;
    set("waiting");
    retry = setTimer(() => { retry = null; retryAt = null; void connect(); }, ms);
    retry?.unref?.();
  };
  const failed = () => later(LADDER_MS[Math.min(attempt, LADDER_MS.length - 1)], true);

  async function connect() {
    if (state === "off" || state === "blocked") return;
    if (!online()) return later(OFFLINE_MS, false);
    const mine = ++run;
    const controller = new AbortController();
    abort = controller;
    set("connecting");
    const heard = () => {
      clearTimer(silence);
      silence = setTimer(() => controller.abort(), SILENCE_MS);
      silence?.unref?.();
    };
    let since = null;
    try {
      const response = await open(controller.signal);
      if (mine !== run) return;
      if (response.status === 401 || response.status === 403) { stopTimers(); abort = null; set("blocked"); return; }
      if (!response.ok || !response.body) throw new Error(`the stream answered ${response.status}`);
      since = now();
      set("live");
      heard();
      const reader = response.body.getReader(), decoder = new TextDecoder(), frames = createFrameReader(onFrame);
      for (;;) {
        const { done, value } = await reader.read();
        if (mine !== run) return;
        if (done) break;
        heard();
        frames.push(decoder.decode(value, { stream: true }));
      }
    } catch {
    }
    if (mine !== run) return;
    abort = null;
    if (since !== null && now() - since >= STABLE_MS) attempt = 0;
    failed();
  }

  return {
    start() {
      if (state !== "off") return;
      attempt = 0;
      state = "connecting";
      void connect();
    },
    stop() {
      run += 1;
      stopTimers();
      abort?.abort();
      abort = null;
      set("off");
    },
    state: () => state,
    retryAt: () => retryAt,
  };
}
