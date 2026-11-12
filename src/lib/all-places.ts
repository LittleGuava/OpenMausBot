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
    // The rail came, went or lists other places: main's view may have changed with it.
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

/** An answer to a line, sent by main to the place it came from. */
export async function answerLine(placeId: string, rowId: string, action: AllPlacesAction | "answer", value?: string): Promise<AllPlacesOutcome> {
  const places = bridge();
  if (!places) return { outcome: "failed" };
  return places.act({ placeId, rowId, action, ...(value === undefined ? {} : { value }) }).catch(() => ({ outcome: "failed" as const }));
}

/** How wide the list of every place's bots stands beside a conversation, in points. */
export const ALL_PLACES_LIST_WIDTH = 280;

/** The list stays up beside the place's page (the rail is that much wider and the page hides its own list), or goes. */
export const keepListBeside = (on: boolean): void => void bridge()?.beside(on ? ALL_PLACES_LIST_WIDTH : 0).catch(() => {});

export interface ListedBot { placeId: string; stale: boolean; bot: AllPlacesBot }
export interface ListSection { section: string | null; bots: ListedBot[] }

/** One list over every place, as a sidebar shows one place's: the bots in no section first, then each section once, in
 * the order the places name them. Sections of the same name in two places are one: every bot wears its place's mark. */
export function listSections(groups: readonly AllPlacesGroup[]): ListSection[] {
  const sections = new Map<string | null, ListedBot[]>();
  for (const group of groups) {
    const bots = sections.get(group.section) ?? [];
    bots.push(...group.bots.map((bot) => ({ placeId: group.placeId, stale: group.stale, bot })));
    sections.set(group.section, bots);
  }
  const loose = sections.get(null);
  sections.delete(null);
  return [...(loose ? [{ section: null, bots: loose }] : []), ...[...sections].map(([section, bots]) => ({ section, bots }))];
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

/** Main closed All places (a notification's click went to a place). */
export const onAllPlacesClosed = (listener: () => void): (() => void) => bridge()?.onClosed(listener) ?? (() => {});

/** The intervals "Check other places" offers, in seconds. */
export const CHECK_INTERVALS: readonly AllPlacesCheck[] = ["15", "30", "60", "120"];

/** Whether what a place last said is from now: read, and not failing. */
export const placeFresh = (place: AllPlacesStatus): boolean => place.state === "ok";

export type { AllPlacesAction, AllPlacesCheck, AllPlacesSettings, AllPlacesStatus, AllPlacesView };
