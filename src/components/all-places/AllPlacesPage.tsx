// All places, on the window's own rail page (PlacesRail): every included place's bots in one sidebar, grouped by the
// sections each place already has, and one inbox over all of them. Every group and line wears its place's mark. Nothing
// is copied between places: a line is answered on the server it came from, and a click on a bot opens that bot in its
// own place.
//
// Security: everything here came from other servers. It is drawn as plain text only, and no picture or link of theirs is
// ever loaded.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Inbox, Laptop, RefreshCw, Search, TriangleAlert } from "lucide-react";
import type { AllPlacesBot, AllPlacesGroup, AllPlacesLine, AllPlacesStatus, AllPlacesView } from "../../../electron/all-places.mjs";
import { answerLine, openInPlace, refreshAllPlaces, type AllPlacesAction } from "@/lib/all-places";
import { cn } from "@/lib/cn";
import { cloudColor, cloudColorFill } from "@/lib/cloud-look";
import { activeLocale, t } from "@/lib/i18n";
import { MAUS_COLORS } from "@/lib/mascot";
import { placeInitials } from "@/lib/places";
import { localizedRelativeTime } from "@/lib/relative-time";
import { WindowCaptionButtons } from "../WindowCaptionButtons";

type Tab = "needs-you" | "info";

const clock = (ms: number) => new Date(ms).toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit" });
/** A line's or a bot's time: the hour today, the day before that. */
const when = (ms: number, now: number) => (new Date(ms).toDateString() === new Date(now).toDateString() ? clock(ms)
  : new Date(ms).toLocaleDateString(activeLocale(), { month: "short", day: "numeric" }));
const placeName = (place: Pick<AllPlacesStatus, "kind" | "name">) => (place.kind === "computer" ? t("rail.thisComputer") : place.name);

/** A place's mark, small: the colour and letters of its circle on the rail, or a laptop for this computer. */
function PlaceDot({ place, size = 10 }: { place: Pick<AllPlacesStatus, "kind" | "name" | "color">; size?: number }) {
  if (place.kind === "computer") return <Laptop size={size} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />;
  const color = cloudColor(place.color);
  return <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-[3px] font-bold leading-none", color ? "text-white" : "bg-ink/15 text-ink")}
    style={{ width: size, height: size, fontSize: Math.max(6, Math.round(size * 0.55)), ...(color ? { background: cloudColorFill(color) } : {}) }}>
    {size >= 14 ? placeInitials(place.name) : null}
  </span>;
}

/** The place a group or a line came from: its mark and name, and that it can't be read now. */
function PlaceChip({ place, stale = false }: { place: AllPlacesStatus; stale?: boolean }) {
  const name = placeName(place);
  const label = !stale ? name : place.seenAt !== null ? t("allPlaces.chip.seen", { name, time: clock(place.seenAt) }) : t("allPlaces.chip.noAnswer", { name });
  return <span data-all-places-chip={place.id} data-stale={stale ? "" : undefined}
    className={cn("inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-[10.5px] font-medium leading-none", stale ? "bg-warning/15 text-warning" : "bg-ink/[0.06] text-ink-secondary")}>
    <PlaceDot place={place} />{label}
  </span>;
}

/** A bot's mark: its own colour and first letter. Its picture lives on its server and is never asked for here. */
function BotDot({ color, name, size = 24 }: { color: string; name: string; size?: number }) {
  const fill = (MAUS_COLORS as Record<string, string>)[color] ?? MAUS_COLORS.silver;
  return <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full font-semibold leading-none text-white"
    style={{ width: size, height: size, background: fill, fontSize: Math.round(size * 0.42) }}>{Array.from(name.trim())[0]?.toLocaleUpperCase() ?? ""}</span>;
}

function BotRow({ bot, place, stale, now, onOpen }: { bot: AllPlacesBot; place: AllPlacesStatus; stale: boolean; now: number; onOpen: () => void }) {
  const waiting = bot.status === "waiting", working = bot.status === "working";
  const seen = place.seenAt !== null ? clock(place.seenAt) : "";
  const line = stale ? (seen ? t(waiting ? "allPlaces.bot.waitedAt" : "allPlaces.bot.lastSeen", { time: seen }) : "")
    : waiting ? t("sidebar.preview.waiting") : working ? t("sidebar.preview.working")
    : bot.preview ? (bot.mine ? t("sidebar.preview.you", { text: bot.preview }) : bot.preview) : t("sidebar.preview.noMessages");
  return <button type="button" data-all-places-bot={bot.id} data-status={bot.status} onClick={onOpen} title={t("allPlaces.openPlace", { name: placeName(place) })}
    className={cn("flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-start hover:bg-ink/[0.06] focus-visible:outline-2 focus-visible:outline-focus", stale && "opacity-55")}>
    <BotDot color={bot.color} name={bot.name} />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[13px] font-semibold leading-[18px] text-ink">{bot.name}</span>
      <span className={cn("block truncate text-[11.5px] leading-4", waiting && !stale ? "font-medium text-warning" : "text-ink-secondary")}>{line}</span>
    </span>
    {!stale && <span className="flex shrink-0 flex-col items-end gap-1 text-[10.5px] leading-none text-ink-tertiary">
      {bot.at !== null && !waiting && !working && <span>{when(bot.at, now)}</span>}
      {bot.unread && <span data-all-places-unread aria-label={t("task.unread")} className="size-[7px] rounded-full bg-accent" />}
    </span>}
  </button>;
}

/** One place's state, with the age of what it said: main does not stay connected unless the person chose Live, and says so. */
function placeLine(place: AllPlacesStatus, now: number): string {
  const name = placeName(place);
  if (place.state === "loading") return t("allPlaces.place.loading", { name });
  if (place.state === "asleep") return t("allPlaces.place.asleep", { name });
  if (place.state === "blocked") return t(place.blocked === "refused" ? "allPlaces.place.refused" : "allPlaces.place.signedOut", { name });
  if (place.state === "unreachable") {
    const since = t("allPlaces.place.unreachable", { name, time: clock(place.failingSince ?? now) });
    return place.retryAt !== null ? `${since} · ${t("allPlaces.place.retry", { seconds: Math.max(0, Math.ceil((place.retryAt - now) / 1000)) })}` : since;
  }
  const up = place.live ? t("allPlaces.place.live", { name }) : t("allPlaces.place.seen", { name, when: localizedRelativeTime(place.seenAt ?? now, activeLocale(), now) });
  return place.noInbox ? `${up} · ${t("allPlaces.place.noInbox")}` : up;
}

function Banner({ place, waited, onOpen }: { place: AllPlacesStatus; waited: number; onOpen: () => void }) {
  const name = placeName(place);
  const words = place.state === "asleep" ? t("allPlaces.banner.asleep", { name })
    : place.state === "blocked" ? (place.blocked === "refused" ? t("allPlaces.banner.refused", { name }) : t("allPlaces.banner.signedOut", { name }))
    : t("allPlaces.banner.unreachable", { name, time: clock(place.failingSince ?? Date.now()) });
  return <div role="status" data-all-places-banner={place.id} data-state={place.state} className="rounded-xl border border-warning/35 bg-warning/10 px-3 py-2.5 text-[12.5px] leading-[18px] text-ink">
    <span className="font-semibold">{words}</span>{" "}
    {place.state === "unreachable" && <>{t("allPlaces.banner.kept")}{" "}{waited > 0 && (waited === 1 ? t("allPlaces.banner.waitingOne") : t("allPlaces.banner.waitingMany", { count: waited }))}</>}
    {place.message && <span className="block pt-0.5 text-[11.5px] text-ink-secondary">{place.message}</span>}
    <span className="mt-2 flex flex-wrap gap-2">
      {place.state !== "asleep" && <button type="button" data-all-places-retry className="ui-button" onClick={() => refreshAllPlaces(place.id)}>{t("allPlaces.tryAgain")}</button>}
      <button type="button" data-all-places-open-place className="ui-button" onClick={onOpen}>{t("allPlaces.openPlace", { name })}</button>
    </span>
  </div>;
}

const ACTION_LABEL = { allow: "approval.action.allowOnce", always: "approval.action.alwaysAllow", deny: "approval.action.deny", read: "allPlaces.row.markRead" } as const satisfies Record<AllPlacesAction, string>;
const SUBJECT = { approval: "inbox.subject.approval", question: "inbox.subject.question", message: "inbox.subject.message", result: "inbox.subject.result", notice: "inbox.subject.notice" } as const;

function LineCard({ line, place, bot, now, onOpen }: { line: AllPlacesLine; place: AllPlacesStatus; bot: AllPlacesBot | undefined; now: number; onOpen: () => void }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const name = placeName(place);
  const send = (action: AllPlacesAction | "answer", value?: string) => {
    setBusy(true); setSaid(null);
    void answerLine(line.placeId, line.id, action, value).then((answer) => {
      setBusy(false);
      if (answer.outcome === "gone") setSaid(t("allPlaces.row.gone", { name }));
      else if (answer.outcome === "refused") setSaid(t("allPlaces.row.stale", { name }));
      else if (answer.outcome === "failed") setSaid(answer.message ?? t("allPlaces.row.failed", { name }));
    });
  };
  return <article data-all-places-line={line.id} data-place={line.placeId} data-tab={line.tab} data-stale={line.stale ? "" : undefined}
    className={cn("rounded-xl bg-card px-3 py-2.5", line.stale && "opacity-65")}>
    <header className="mb-1 flex flex-wrap items-center gap-1.5 text-[11.5px] leading-4 text-ink-secondary">
      <BotDot color={bot?.color ?? "silver"} name={line.from} size={18} />
      <b className="text-[12.5px] font-semibold text-ink">{line.from}</b>
      <span>{t(SUBJECT[line.subject])}{line.title && line.subject !== "message" ? ` · ${t("inbox.in", { title: line.title })}` : line.title ? ` · ${line.title}` : ""}</span>
      <PlaceChip place={place} stale={line.stale} />
      {line.unread && !line.stale && <span aria-hidden="true" className="size-[7px] rounded-full bg-accent" />}
      <time className="ml-auto text-[10.5px] text-ink-tertiary">{when(line.at, now)}</time>
    </header>
    <p className="whitespace-pre-wrap break-words text-[13px] leading-[19px] text-ink">{line.text}</p>
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {line.actions.map((action) => <button key={action} type="button" data-all-places-action={action} disabled={busy}
        className={cn("ui-button", action === "allow" && "ui-button-primary")} onClick={() => send(action)}>{t(ACTION_LABEL[action])}</button>)}
      {line.choices.map((choice, at) => <button key={choice} type="button" data-all-places-choice={at} disabled={busy} className="ui-button" onClick={() => send("answer", choice)}>{choice}</button>)}
      {line.botId && <button type="button" data-all-places-open-chat className="rounded-md px-1.5 py-1 text-[12px] font-medium text-ink-secondary hover:bg-ink/[0.06] hover:text-ink" onClick={onOpen}>{t("inbox.action.openInChat")}</button>}
    </div>
    {(said || line.stale) && <p role={said ? "alert" : undefined} data-all-places-line-note className="pt-1.5 text-[11.5px] leading-4 text-ink-secondary">{said ?? t("allPlaces.row.stale", { name })}</p>}
  </article>;
}

/**
 * `drag`/`noDrag`: the window's drag regions, as the rail's own. `framed`: the window draws its own frame, so the page has
 * a top bar that drags it. `caption`: Windows, where this app draws the caption buttons.
 */
export function AllPlacesPage({ view, drag, noDrag, framed, caption, onClose }: { view: AllPlacesView; drag?: CSSProperties; noDrag?: CSSProperties; framed: boolean; caption: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("needs-you");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const ticking = view.places.some((place) => place.retryAt !== null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), ticking ? 1_000 : 10_000); return () => clearInterval(timer); }, [ticking]);
  useEffect(() => { setNow(Date.now()); }, [view]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const places = useMemo(() => new Map(view.places.map((place) => [place.id, place])), [view.places]);
  const bots = useMemo(() => new Map(view.groups.flatMap((group) => group.bots.map((bot) => [`${group.placeId}:${bot.id}`, bot] as const))), [view.groups]);
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const groups: AllPlacesGroup[] = words.length === 0 ? view.groups
    : view.groups.map((group) => ({ ...group, bots: group.bots.filter((bot) => words.every((word) => bot.name.toLocaleLowerCase().includes(word))) })).filter((group) => group.bots.length);
  const lines = view.rows.filter((line) => line.tab === tab);
  const count = (which: Tab) => view.rows.filter((line) => line.tab === which && !line.stale).length;
  const troubled = view.places.filter((place) => place.state === "unreachable" || place.state === "blocked" || place.state === "asleep");
  const open = (placeId: string, botId: string, threadId?: string) => void openInPlace(placeId, botId, threadId).then((went) => { if (went) onClose(); });
  /** The place itself, as its circle on the rail opens it: the person signs in or looks there. */
  const openPlace = (placeId: string) => { onClose(); void window.ogb?.workspaces?.open?.(placeId)?.catch(() => {}); };
  const idle = view.check === "never" && view.places.every((place) => place.state === "loading");

  return <section role="dialog" aria-label={t("allPlaces.title")} data-all-places style={noDrag}
    className="absolute inset-y-0 left-full z-30 flex w-[calc(100vw-2.25rem)] flex-col bg-app text-ink">
    {framed && <div data-all-places-bar style={drag} className="relative flex h-7 shrink-0 items-center justify-center bg-frame text-[12px] text-ink-secondary">
      {t("allPlaces.title")}
      <WindowCaptionButtons visible={caption && Boolean(window.ogb?.windowControls)} />
    </div>}
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[264px_minmax(0,1fr)]">
      <aside data-all-places-sidebar className="hidden min-h-0 flex-col gap-0.5 border-r border-hairline/50 bg-panel p-2 md:flex">
        <label className="mb-1 flex h-8 shrink-0 items-center gap-2 rounded-lg bg-ink/[0.05] px-2">
          <Search size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("sidebar.search")} aria-label={t("sidebar.search")}
            className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary" />
        </label>
        <div data-all-places-inbox-row aria-current="page" className="flex shrink-0 items-center gap-2 rounded-lg bg-ink/[0.06] px-1.5 py-1.5 text-[13px] font-medium">
          <span className="grid size-6 place-items-center rounded-full bg-ink/[0.06] text-ink-secondary"><Inbox size={13} aria-hidden="true" /></span>
          {t("inbox.panel.title")}
          <span className="ml-auto flex items-center gap-1 text-[11px] tabular-nums text-ink-secondary">
            {view.incomplete && <span data-all-places-incomplete title={t("allPlaces.incomplete")} aria-label={t("allPlaces.incomplete")} className="text-warning"><TriangleAlert size={12} aria-hidden="true" /></span>}
            <span data-all-places-waiting>{view.waiting}</span>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.map((group) => {
            const place = places.get(group.placeId);
            if (!place) return null;
            return <section key={`${group.placeId}:${group.section ?? ""}`} data-all-places-group={group.placeId} data-stale={group.stale ? "" : undefined}>
              <h3 className="flex items-center gap-1.5 px-1.5 pb-0.5 pt-2.5 text-[11.5px] font-normal leading-4 text-ink-secondary">
                <span className="min-w-0 flex-1 truncate">{group.section ?? t("allPlaces.unsectioned")}</span>
                <PlaceChip place={place} stale={group.stale} />
              </h3>
              {group.bots.map((bot) => <BotRow key={bot.id} bot={bot} place={place} stale={group.stale} now={now} onOpen={() => open(group.placeId, bot.id)} />)}
            </section>;
          })}
          {groups.length === 0 && <p className="px-1.5 py-3 text-[12px] text-ink-tertiary">{t(words.length ? "allPlaces.noMatch" : "allPlaces.empty.bots")}</p>}
        </div>
        <ul data-all-places-states className="mt-1 flex shrink-0 flex-col gap-1 border-t border-hairline/50 px-1.5 pb-1 pt-2 text-[10.5px] leading-[14px] text-ink-tertiary">
          {view.places.map((place) => <li key={place.id} data-all-places-state={place.id} data-state={place.state} data-live={place.live ? "" : undefined} className="flex items-start gap-1.5">
            <span aria-hidden="true" className={cn("mt-[4px] size-1.5 shrink-0 rounded-full", place.state === "ok" ? "bg-success" : place.state === "loading" || place.state === "asleep" ? "bg-ink-tertiary" : "bg-danger")} />
            <span>{placeLine(place, now)}</span>
          </li>)}
        </ul>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-col">
        <header className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3">
          <h2 className="text-[15px] font-semibold">{t("inbox.panel.title")}</h2>
          <button type="button" data-all-places-refresh aria-label={t("allPlaces.refresh")} title={t("allPlaces.refresh")} onClick={() => refreshAllPlaces()}
            className="ml-auto grid size-7 place-items-center rounded-md text-ink-secondary hover:bg-ink/[0.06] hover:text-ink"><RefreshCw size={14} aria-hidden="true" /></button>
        </header>
        <div role="tablist" className="flex shrink-0 gap-4 border-b border-hairline/50 px-4 pb-2 text-[12.5px] text-ink-secondary">
          {(["needs-you", "info"] as const).map((which) => <button key={which} type="button" role="tab" aria-selected={tab === which} data-all-places-tab={which} onClick={() => setTab(which)}
            className={cn("rounded-sm hover:text-ink focus-visible:outline-2 focus-visible:outline-focus", tab === which && "font-semibold text-ink")}>
            {t(which === "needs-you" ? "allPlaces.tab.needsYou" : "allPlaces.tab.info")}<span className="ml-1.5 font-normal tabular-nums text-ink-tertiary">{count(which)}</span>
          </button>)}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
          {troubled.map((place) => <Banner key={place.id} place={place} waited={view.rows.filter((line) => line.placeId === place.id && line.tab === "needs-you").length} onOpen={() => openPlace(place.id)} />)}
          {idle && <p data-all-places-never className="py-2 text-[12.5px] text-ink-secondary">{t("allPlaces.never")}</p>}
          {lines.map((line) => {
            const place = places.get(line.placeId);
            return place ? <LineCard key={`${line.placeId}:${line.id}`} line={line} place={place} bot={line.botId ? bots.get(`${line.placeId}:${line.botId}`) : undefined} now={now}
              onOpen={() => { if (line.botId) open(line.placeId, line.botId, line.threadId ?? undefined); }} /> : null;
          })}
          {lines.length === 0 && !idle && <p data-all-places-empty className="py-6 text-center text-[12.5px] text-ink-tertiary">{t(tab === "needs-you" ? "allPlaces.empty.needsYou" : "allPlaces.empty.info")}</p>}
        </div>
      </main>
    </div>
  </section>;
}
