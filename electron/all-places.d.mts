/** How the other places are asked: Live (main listens to each place's event stream), every so many seconds, only when All
 * places opens, or never (only when the person asks). */
export type AllPlacesCheck = "live" | "15" | "30" | "60" | "120" | "open" | "never";
export declare const CHECKS: readonly AllPlacesCheck[];
export declare const DEFAULT_CHECK: AllPlacesCheck;
/** What a place's `GET /api/bots` says, cut to what a page may have. Null when it is not that. */
export declare function parseBots(raw: unknown, now?: number): { sections: string[]; bots: AllPlacesBot[] } | null;

/** A place as All places names it: its saved id (`local` for this computer), name and colour. Never an address. */
export interface AllPlacesTag {
  id: string;
  name: string;
  kind: "computer" | "cloud" | "team" | "server";
  color: string | null;
}

export interface AllPlacesStatus extends AllPlacesTag {
  /** `loading`: not read yet. `unreachable`: it did not answer; what it last said is kept. `blocked`: it waits for the
   * person (a sign-in that ended, or a server that refuses this app's request). `asleep`: a Cloud that sleeps is never asked. */
  state: "loading" | "ok" | "unreachable" | "blocked" | "asleep";
  blocked?: "signed-out" | "refused";
  /** The server's own words for a refusal. */
  message?: string;
  /** A server from before the inbox: its bots are listed, its inbox is read on its own page. */
  noInbox?: true;
  seenAt: number | null;
  failingSince: number | null;
  retryAt: number | null;
  live: boolean;
}

export interface AllPlacesThread {
  id: string;
  title: string;
  status: "waiting" | "working" | "idle";
  unread: boolean;
  at: number | null;
}

export interface AllPlacesBot {
  id: string;
  threadId: string;
  name: string;
  color: string;
  /** The mascot's body and face as its place names them: short names, for the page to use only when it knows them. */
  body?: string;
  face?: string;
  status: "waiting" | "working" | "idle";
  unread: boolean;
  preview: string | null;
  /** The preview is the person's own words. */
  mine?: true;
  at: number | null;
  /** Its conversations, when it has more than one: the ones its own sidebar lists by default. */
  threads?: AllPlacesThread[];
}

export interface AllPlacesGroup {
  placeId: string;
  section: string | null;
  stale: boolean;
  bots: AllPlacesBot[];
}

export type AllPlacesAction = "allow" | "always" | "deny" | "read";

export interface AllPlacesLine {
  placeId: string;
  id: string;
  tab: "needs-you" | "info";
  subject: "approval" | "question" | "message" | "result" | "notice";
  from: string;
  botId: string | null;
  threadId: string | null;
  title: string | null;
  text: string;
  at: number;
  unread: boolean;
  stale: boolean;
  actions: AllPlacesAction[];
  choices: string[];
  /** A plain tool approval: the tool asked for and, whole, the command or the card's own words. Absent on any other line
   * and on an approval answered in its own chat. */
  tool?: string;
  detail?: string;
  /** Why the approval waits on the person; `heldCode` is its catalog key when it is one of the fixed notes. */
  held?: string;
  heldCode?: string;
  /** What Always allow would remember for the bot. Absent, it lasts the provider's session. */
  alwaysKey?: string;
}

export interface AllPlacesView {
  active: boolean;
  check: AllPlacesCheck;
  now: number;
  places: AllPlacesStatus[];
  groups: AllPlacesGroup[];
  rows: AllPlacesLine[];
  waiting: number;
  /** Some included place could not be read now, so `waiting` may be short. */
  incomplete: boolean;
}

export interface AllPlacesSettings {
  /** The window has a rail of places. */
  available: boolean;
  enabled: boolean;
  check: AllPlacesCheck;
  notify: boolean;
  /** `shared`: other people sign in there, so it is left out until the person includes it. */
  places: Array<{ id: string; included: boolean; shared: boolean }>;
}

export interface AllPlacesOutcome {
  /** `gone`: answered there already, or no longer listed. `refused`: its place can't be read now. */
  outcome: "done" | "gone" | "refused" | "failed";
  message?: string;
}

/** `window.ogb.allPlaces`, on this app's own pages only. Everything but `settings`, `set` and `onChanged` is the rail's page's. */
export interface AllPlacesBridge {
  view(): Promise<AllPlacesView>;
  advanced(on: boolean): Promise<void>;
  opened(on: boolean): Promise<void>;
  refresh(placeId?: string): Promise<void>;
  act(ask: { placeId: string; rowId: string; action: AllPlacesAction | "answer"; value?: string }): Promise<AllPlacesOutcome>;
  go(ask: { placeId: string; botId: string; threadId?: string }): Promise<boolean>;
  /** The list stays beside the place's page, `width` points wide; 0 gives the room back. */
  beside(width: number): Promise<void>;
  settings(): Promise<AllPlacesSettings>;
  set(changes: { enabled?: boolean; check?: AllPlacesCheck; notify?: boolean; place?: { id: string; included: boolean } }): Promise<AllPlacesSettings>;
  onChanged(listener: () => void): () => void;
  onClosed(listener: () => void): () => void;
}
