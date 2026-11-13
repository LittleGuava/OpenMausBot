// All places as a page reads it: main's list of every included place's bots and lines (the rail's page), and the
// switches in Settings → Servers (this computer's page). Main keeps the readings; a page only asks for them again when
// main says they changed.
import { useEffect, useState } from "react";
import type { AllPlacesAction, AllPlacesBot, AllPlacesBridge, AllPlacesCheck, AllPlacesGroup, AllPlacesOutcome, AllPlacesSettings, AllPlacesStatus, AllPlacesView } from "../../electron/all-places.mjs";
import { MASCOT_FACE_COLORS, type MascotFaceColor } from "../../shared/bot-avatar";
import { BOT_BODY_IDS, type BotBodyId } from "../../shared/bot-body";
import { isMausColor, type MausColor } from "../../shared/wire";

const NONE: AllPlacesView = { active: false, check: "live", now: 0, places: [], groups: [], rows: [], waiting: 0, incomplete: false };

const bridge = (): AllPlacesBridge | undefined => (typeof window === "undefined" ? undefined : window.ogb?.allPlaces);

/** The rail's page says whether this computer's page is in the Advanced mode: main cannot read a page's choice. */
export function reportAdvancedMode(advanced: boolean): void {
  void bridge()?.advanced(advanced).catch(() => {});
}

/** Main's view, read again whenever main says it changed and when the window comes back. Only on the rail's own page
 * (`on`): main refuses any other. */
export function useAllPlaces(on = true): AllPlacesView {
  const [view, setView] = useState<AllPlacesView>(NONE);
  useEffect(() => {
    const places = on ? bridge() : undefined;
    if (!places) return;
    let current = true;
    const read = () => void places.view().then((next) => { if (current) setView(next ?? NONE); }, () => {});
    read();
    const stop = places.onChanged(read);
    const stopPlaces = window.ogb?.workspaces?.onChanged?.(read);
    window.addEventListener("focus", read);
    return () => { current = false; stop(); stopPlaces?.(); window.removeEventListener("focus", read); };
  }, [on]);
  return view;
}

/** The switches as main keeps them, and a change to them. null on a page that is not this app's own. */
export function useAllPlacesSettings(): { settings: AllPlacesSettings | null; change: (changes: Parameters<AllPlacesBridge["set"]>[0]) => void } {
  const [settings, setSettings] = useState<AllPlacesSettings | null>(null);
  useEffect(() => {
    const places = bridge();
    if (!places) return;
    let current = true;
    const read = () => void places.settings().then((next) => { if (current) setSettings(next); }, () => {});
    read();
    const stop = places.onChanged(read);
    return () => { current = false; stop(); };
  }, []);
  return { settings, change: (changes) => void bridge()?.set(changes).then(setSettings, () => {}) };
}

export const allPlacesOpened = (on: boolean): void => void bridge()?.opened(on).catch(() => {});
export const refreshAllPlaces = (placeId?: string): void => void bridge()?.refresh(placeId).catch(() => {});

export async function answerLine(placeId: string, rowId: string, action: AllPlacesAction | "answer", value?: string): Promise<AllPlacesOutcome> {
  const places = bridge();
  if (!places) return { outcome: "failed" };
  return places.act({ placeId, rowId, action, ...(value === undefined ? {} : { value }) }).catch(() => ({ outcome: "failed" as const }));
}

export const ALL_PLACES_LIST_WIDTH = 280;

export const keepListBeside = (on: boolean): void => void bridge()?.beside(on ? ALL_PLACES_LIST_WIDTH : 0).catch(() => {});

/** One list over every place, as a sidebar shows one place's: place after place, each one's bots in no team first, then
 * its teams in its own order. Teams stay apart by place, one of the same name in two places too: a team is a place's
 * own, and its header wears that place's mark. */
export function listSections(groups: readonly AllPlacesGroup[]): AllPlacesGroup[] {
  const places = [...new Set(groups.map((group) => group.placeId))];
  return places.flatMap((placeId) => {
    const own = groups.filter((group) => group.placeId === placeId);
    return [...own.filter((group) => group.section === null), ...own.filter((group) => group.section !== null)];
  });
}

/** A bot as the sidebar's avatar draws it: the mascot its place gave it where this app knows that body and face. Its own
 * picture lives on its server and is never asked for here. */
export function botLook(bot: Pick<AllPlacesBot, "name" | "color" | "body" | "face">): { name: string; color: MausColor; mascotBody: BotBodyId | null; mascotFaceColor: MascotFaceColor | null } {
  return {
    name: bot.name, color: isMausColor(bot.color) ? bot.color : "silver",
    mascotBody: BOT_BODY_IDS.find((id) => id === bot.body) ?? null,
    mascotFaceColor: MASCOT_FACE_COLORS.find((color) => color === bot.face) ?? null,
  };
}

/** The window shows that place and opens the conversation there; false when main no longer lists it. */
export async function openInPlace(placeId: string, botId: string, threadId?: string): Promise<boolean> {
  return (await bridge()?.go({ placeId, botId, ...(threadId ? { threadId } : {}) }).catch(() => false)) === true;
}

export const onAllPlacesClosed = (listener: () => void): (() => void) => bridge()?.onClosed(listener) ?? (() => {});

export const placeFresh = (place: AllPlacesStatus): boolean => place.state === "ok";

export type { AllPlacesAction, AllPlacesCheck, AllPlacesSettings, AllPlacesStatus, AllPlacesView };
