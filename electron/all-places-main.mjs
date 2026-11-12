// Main's side of All places (all-places-watch.mjs): the saved places as the watch asks them, each over this window's own
// sign-in there, and the channels its page and Settings use.
//
// Security: All places is drawn by the rail's own page (chrome-rail.mjs), this app's, the only page that reads the list
// of places. It gets names, colours and lines as text, never an address; a line is answered by the id main gave it, and
// main sends the answer to the server that line came from, with that server's own Origin as its page would. This
// computer's own page reads and sets only the switches in Settings → Servers. No place's page reaches any of it.
//
// The Advanced mode is a page's choice (localStorage), which main cannot read: the rail's page, served from this
// computer's own origin, says whether it is on. Until it does, and whenever the rail is not up, All places is off.
import environments from "./environments.cjs";
import { BACKGROUND_HEADERS } from "./cloud-power.mjs";
import { CHECKS } from "./all-places.mjs";
import { createAllPlacesWatch } from "./all-places-watch.mjs";

const text = (value) => (typeof value === "string" ? value.slice(0, 512) : "");

/** Every saved place as All places asks it: This computer while it is a place, then the saved ones in their order. A
 * team's Cloud is one other people sign in to. */
export function askedPlaces(saved, computer = true) {
  const here = environments.savedPlace(saved, environments.LOCAL_ID);
  return [
    ...(computer ? [{ id: here.id, name: here.name, kind: "computer", color: here.color ?? null, local: true }] : []),
    ...saved.environments.filter((entry) => entry.kind !== "local" && entry.origin).map((entry) => ({ id: entry.id, name: entry.name,
      kind: entry.home || entry.cloud ? "cloud" : entry.team ? "team" : "server", color: entry.color ?? null, origin: entry.origin, ...(entry.team ? { shared: true } : {}) })),
  ];
}

/**
 * @param {{
 *   ipcMain: { handle(channel: string, handler: (...args: any[]) => unknown): void },
 *   rail: { owns(event: unknown): boolean, shown(): boolean, send(channel: string): void },
 *   localPage(event: unknown): boolean,
 *   localContents(): { send(channel: string): void } | null,
 *   prefs(): import("./desktop-prefs.mjs").DesktopPrefs | null,
 *   saved(): { environments: any[], activeId: string },
 *   computer?(): boolean,
 *   available(): boolean,
 *   cookieFetch: typeof fetch,
 *   localRequest(route: string, init?: RequestInit): Promise<Response>,
 *   asleep(origin: string): boolean,
 *   shown(): boolean,
 *   focused(): boolean,
 *   bring(origin: string, target: { botId: string, threadId: string }): void,
 *   localOrigin(): string,
 *   Notification: { new(options: object): any, isSupported(): boolean },
 *   online?(): boolean,
 * }} deps `rail`: the window's rail (chrome-rail.mjs); `localPage`: this computer's own page asks; `localContents`: that page
 * while it is on screen; `computer`: This computer is a place (not once My Cloud is home); `available`: the window has a
 * rail; `cookieFetch`: a request with the window's sign-ins; `localRequest`: one to this computer's own server; `bring`: the
 * window shows that place and opens the conversation (desktop-notifications.mjs).
 */
export function installAllPlaces({ ipcMain, rail, localPage, localContents, prefs, saved, computer = () => true, available, cookieFetch, localRequest, asleep, shown, focused, bring, localOrigin,
  Notification, online = () => true, log = () => {} }) {
  let advanced = false;
  // Electron drops a notification's handlers once nothing holds it.
  const notes = new Set();
  const places = () => askedPlaces(saved(), computer());

  const request = (place, route, { method = "GET", body, background = false, timeoutMs, signal } = {}) => {
    const signals = [signal, timeoutMs ? AbortSignal.timeout(timeoutMs) : null].filter(Boolean);
    const init = { method, cache: "no-store", ...(signals.length ? { signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0] } : {}),
      headers: { accept: route.startsWith("/api/events") ? "text/event-stream" : "application/json", ...(background ? BACKGROUND_HEADERS : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    return place.local ? localRequest(route, init)
      : cookieFetch(`${place.origin}${route}`, { ...init, credentials: "include", redirect: "error", headers: { ...init.headers, origin: place.origin } });
  };
  const go = (place, botId, threadId) => bring(place.local ? localOrigin() : place.origin, { botId, threadId });
  const tell = () => { rail.send("all-places:changed"); try { localContents()?.send("all-places:changed"); } catch {} };

  const watch = createAllPlacesWatch({
    places, request, asleep, shown, focused, online, changed: tell,
    prefs: { allPlaces: () => prefs()?.allPlaces() === true, allPlacesCheck: () => prefs()?.allPlacesCheck(), allPlacesNotify: () => prefs()?.allPlacesNotify() !== false,
      allPlacesChoice: (id) => prefs()?.allPlacesChoice(id) ?? null },
    advanced: () => advanced && rail.shown(),
    activeId: () => saved().activeId,
    notify: ({ place, row }) => {
      if (!Notification.isSupported() || !row.botId || !row.threadId) return;
      // Who asks and where, in the server's own words: no sentence of this app's, so nothing to translate.
      const note = new Notification({ title: `${row.from} · ${place.name}`, body: row.text });
      notes.add(note);
      note.on("close", () => notes.delete(note));
      note.on("click", () => { notes.delete(note); watch.opened(false); rail.send("all-places:closed"); go(place, row.botId, row.threadId); });
      note.show();
    },
  });

  const settings = () => ({ available: available(), enabled: prefs()?.allPlaces() === true, check: prefs()?.allPlacesCheck() ?? CHECKS[0], notify: prefs()?.allPlacesNotify() !== false,
    places: places().map((place) => ({ id: place.id, included: prefs()?.allPlacesChoice(place.id) ?? place.shared !== true, shared: place.shared === true })) });
  const apply = () => { watch.sync(); tell(); };

  const fromRail = (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
    if (!rail.owns(event)) throw new Error(`${channel} is only available to the window's rail`);
    return handler(...args);
  });
  const fromApp = (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
    if (!rail.owns(event) && !localPage(event)) throw new Error(`${channel} is only available in this app's window`);
    return handler(...args);
  });
  // The rail's page asks whenever main says something changed, the rail's own list included: each ask also brings the
  // timers and streams in line with the rail and the window as they are now.
  fromRail("all-places:view", () => { watch.sync(); return watch.view(); });
  fromRail("all-places:advanced", (on) => { if (advanced !== (on === true)) { advanced = on === true; apply(); } });
  fromRail("all-places:opened", (on) => watch.opened(on === true));
  fromRail("all-places:refresh", (placeId) => watch.refresh(typeof placeId === "string" ? text(placeId) : undefined));
  fromRail("all-places:act", (ask) => watch.act(text(ask?.placeId), text(ask?.rowId), text(ask?.action), typeof ask?.value === "string" ? text(ask.value) : undefined)
    .catch((error) => { log(`all places: ${error?.message ?? error}`); return { outcome: "failed" }; }));
  fromRail("all-places:go", (ask) => {
    const target = watch.target(text(ask?.placeId), text(ask?.botId), typeof ask?.threadId === "string" ? text(ask.threadId) : undefined);
    if (!target) return false;
    watch.opened(false);
    go(target.place, target.botId, target.threadId);
    return true;
  });
  fromApp("all-places:settings", () => settings());
  fromApp("all-places:set", (changes) => {
    const store = prefs();
    if (store && changes && typeof changes === "object") {
      if (typeof changes.enabled === "boolean") store.setAllPlaces(changes.enabled);
      if (typeof changes.check === "string") store.setAllPlacesCheck(changes.check);
      if (typeof changes.notify === "boolean") store.setAllPlacesNotify(changes.notify);
      const place = changes.place;
      if (place && typeof place.included === "boolean" && places().some((listed) => listed.id === place.id)) store.setAllPlacesChoice(place.id, place.included);
      apply();
    }
    return settings();
  });

  return {
    /** The saved places, the rail or the window changed. */
    sync: () => watch.sync(),
    stop: () => watch.stop(),
  };
}
