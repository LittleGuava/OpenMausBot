// All places, on the window's own rail page (PlacesRail): every included place's bots in one list, drawn as a place's own
// sidebar draws its bots, and one inbox over all of them. Every team and line wears its place's mark. Nothing is copied
// between places: a line is answered on the server it came from, and a click on a bot opens its conversation beside the
// list, in its own place's page (`chat`), where the person talks to it as they would there.
//
// Security: everything here came from other servers. It is drawn as plain text only, and no picture or link of theirs is
// ever loaded: a bot's mark is this app's own mascot, in the colour and body its place names.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronRight, Inbox, Laptop, Loader2, RefreshCw, Search, TriangleAlert } from "lucide-react";
import type { AllPlacesBot, AllPlacesLine, AllPlacesStatus, AllPlacesThread, AllPlacesView } from "../../../electron/all-places.mjs";
import { ALL_PLACES_LIST_WIDTH, answerLine, botLook, listSections, refreshAllPlaces, type AllPlacesAction } from "@/lib/all-places";
import { cn } from "@/lib/cn";
import { cloudColor, cloudColorFill } from "@/lib/cloud-look";
import { activeLocale, t } from "@/lib/i18n";
import { placeInitials } from "@/lib/places";
import { localizedRelativeTime } from "@/lib/relative-time";
import { localizedTaskTitle } from "@/lib/task-title";
import { useShowThreads } from "@/lib/thread-preferences";
import { BotAvatar } from "../Avatar";
import { ELEVATED_CONTROL } from "../elevated";
import { SidebarSectionHeader } from "../SidebarSectionHeader";
import { WindowCaptionButtons } from "../WindowCaptionButtons";

/** The conversation open beside the list: a bot, in its own place, and which of its conversations when one was chosen
 * (none: the one the bot opens to). */
export interface AllPlacesChat { placeId: string; botId: string; threadId?: string }

type Tab = "needs-you" | "info";

const clock = (ms: number) => new Date(ms).toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit" });
const when = (ms: number, now: number) => (new Date(ms).toDateString() === new Date(now).toDateString() ? clock(ms)
  : new Date(ms).toLocaleDateString(activeLocale(), { month: "short", day: "numeric" }));
const placeName = (place: Pick<AllPlacesStatus, "kind" | "name">) => (place.kind === "computer" ? t("rail.thisComputer") : place.name);

function PlaceDot({ place, size = 10 }: { place: Pick<AllPlacesStatus, "kind" | "name" | "color">; size?: number }) {
  if (place.kind === "computer") return <Laptop size={size} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />;
  const color = cloudColor(place.color);
  return <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-[3px] font-bold leading-none", color ? "text-white" : "bg-ink/15 text-ink")}
    style={{ width: size, height: size, fontSize: Math.max(6, Math.round(size * 0.55)), ...(color ? { background: cloudColorFill(color) } : {}) }}>
    {size >= 14 ? placeInitials(place.name) : null}
  </span>;
}

function PlaceChip({ place, stale = false }: { place: AllPlacesStatus; stale?: boolean }) {
  const name = placeName(place);
  const label = !stale ? name : place.seenAt !== null ? t("allPlaces.chip.seen", { name, time: clock(place.seenAt) }) : t("allPlaces.chip.noAnswer", { name });
  return <span data-all-places-chip={place.id} data-stale={stale ? "" : undefined}
    className={cn("inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-[10.5px] font-medium leading-none", stale ? "bg-warning/15 text-warning" : "bg-ink/[0.06] text-ink-secondary")}>
    <PlaceDot place={place} />{label}
  </span>;
}

function TeamMark({ place }: { place: AllPlacesStatus }) {
  return <span data-all-places-badge={place.id} title={placeName(place)} role="img" aria-label={placeName(place)} className="flex shrink-0 text-ink-secondary"><PlaceDot place={place} size={14} /></span>;
}

function ThreadRow({ thread, current, stale, now, onOpen }: { thread: AllPlacesThread; current: boolean; stale: boolean; now: number; onOpen: () => void }) {
  const title = localizedTaskTitle(thread.title);
  return <div className={cn("relative flex min-w-0 items-center rounded-md", current ? "bg-raised" : !stale && "hover:bg-raised/50", stale && "opacity-55")}>
    <button type="button" data-all-places-thread={thread.id} aria-current={current ? "page" : undefined} disabled={stale} onClick={onOpen} title={title}
      className={cn("flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pl-6 pr-1 text-left text-[13px] font-medium outline-none focus-visible:ring-1 focus-visible:ring-accent/60",
        current ? "font-semibold text-ink" : "text-ink-secondary", !current && !stale && "hover:text-ink", stale && "cursor-default")}>
      <span dir="auto" className={cn("min-w-0 flex-1 truncate", thread.unread && !stale && "font-semibold text-ink")}>{title}</span>
      <span className="flex shrink-0 items-center gap-2 px-1">
        {thread.at !== null && <time dateTime={new Date(thread.at).toISOString()} className="shrink-0 text-[10px] tabular-nums text-ink-secondary">{when(thread.at, now)}</time>}
        {stale ? null : thread.status === "waiting" ? <span className="shrink-0 text-[10px] font-medium text-warning">{t("task.waiting")}</span>
          : thread.status === "working" ? <Loader2 size={11} className="shrink-0 animate-spin text-ink-secondary" role="img" aria-label={t("chat.activity.working")} /> : null}
        {thread.unread && !stale && <span className="size-1.5 shrink-0 rounded-full bg-accent" role="img" aria-label={t("task.unread")} />}
      </span>
    </button>
  </div>;
}

/** A bot's row, as a place's own sidebar draws it, without what only its own place can do. */
function BotRow({ bot, place, stale, threadsShown, open, current, now, onToggle, onOpen }: { bot: AllPlacesBot; place: AllPlacesStatus; stale: boolean; threadsShown: boolean; open: boolean;
  current: string | null; now: number; onToggle: () => void; onOpen: (threadId?: string) => void }) {
  const waiting = bot.status === "waiting" && !stale, working = bot.status === "working" && !stale;
  const seen = place.seenAt !== null ? clock(place.seenAt) : "";
  const line = stale ? (seen ? t(bot.status === "waiting" ? "allPlaces.bot.waitedAt" : "allPlaces.bot.lastSeen", { time: seen }) : "")
    : waiting ? t("sidebar.preview.waiting") : working ? t("sidebar.preview.working")
    : bot.preview ? (bot.mine ? t("sidebar.preview.you", { text: bot.preview }) : bot.preview) : t("sidebar.preview.noMessages");
  const threads = threadsShown ? bot.threads ?? [] : [];
  const expanded = open && threads.length > 0, selected = current !== null;
  return <>
    <div className="group relative">
      <button type="button" data-all-places-bot={bot.id} data-place={place.id} data-status={bot.status} aria-current={selected && !expanded ? "page" : undefined} disabled={stale} onClick={() => onOpen()}
        title={stale ? t("allPlaces.chip.noAnswer", { name: placeName(place) }) : `${bot.name} · ${placeName(place)}`}
        className={cn("flex w-full items-center rounded-xl py-2 pr-3 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-focus", threadsShown ? "gap-2 pl-6" : "gap-3 pl-2.5",
          selected ? "bg-raised" : !stale && "hover:bg-raised/50", stale && "cursor-default opacity-55")}>
        <span className="relative flex shrink-0">
          <BotAvatar bot={botLook(bot)} state={working ? "working" : "idle"} size={threadsShown ? 32 : 44} animated={working} />
          {working && <span data-testid="working-dot" className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-panel bg-success" />}
          {waiting && <span data-testid="waiting-dot" role="status" aria-label={t("sidebar.preview.waiting")}
            className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center overflow-hidden rounded-full border-2 border-panel bg-warning text-[12px] font-black text-panel"><span aria-hidden="true">!</span></span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold leading-5 text-ink">{bot.name}</span>
          {!expanded && <span className="flex items-center justify-between gap-2">
            <span dir="auto" className={cn("min-w-0 truncate text-[13px] leading-[18px]", waiting ? "font-semibold text-warning" : "text-ink-secondary")}>{line}</span>
            {bot.unread && !stale && <span data-all-places-unread role="img" aria-label={t("task.unreadMany")} className="size-2 shrink-0 rounded-full bg-accent" />}
          </span>}
        </span>
      </button>
      {threads.length > 0 && <button type="button" data-all-places-threads-toggle aria-label={t(expanded ? "task.collapseNamed" : "task.expandNamed", { name: bot.name })} aria-expanded={expanded} onClick={onToggle}
        className="absolute left-0.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-ink-secondary outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent/60">
        <ChevronRight aria-hidden="true" size={13} className={cn("transition-transform", expanded && "rotate-90")} />
      </button>}
    </div>
    {expanded && <div className="mb-2 space-y-0.5" role="group" aria-label={t("task.namedList", { name: bot.name })}>
      {threads.map((thread) => <ThreadRow key={thread.id} thread={thread} current={current === thread.id} stale={stale} now={now} onOpen={() => onOpen(thread.id)} />)}
    </div>}
  </>;
}

function LineMark({ bot, name }: { bot: AllPlacesBot | undefined; name: string }) {
  return <BotAvatar bot={botLook(bot ?? { name, color: "silver" })} size={18} />;
}

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
      <LineMark bot={bot} name={line.from} />
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
      {line.botId && !line.stale && <button type="button" data-all-places-open-chat className="rounded-md px-1.5 py-1 text-[12px] font-medium text-ink-secondary hover:bg-ink/[0.06] hover:text-ink" onClick={onOpen}>{t("inbox.action.openInChat")}</button>}
    </div>
    {(said || line.stale) && <p role={said ? "alert" : undefined} data-all-places-line-note className="pt-1.5 text-[11.5px] leading-4 text-ink-secondary">{said ?? t("allPlaces.row.stale", { name })}</p>}
  </article>;
}

/**
 * `chat`: the conversation open beside the list, in its place's own page; the list alone is drawn then, as wide as main
 * keeps the rail (ALL_PLACES_LIST_WIDTH). Without one the inbox fills the rest of the window. `onChat` opens a bot's
 * conversation beside the list, `onInbox` comes back to the inbox. `drag`/`noDrag`: the window's drag regions, as the
 * rail's own. `framed`: the window draws its own frame, so the page has a top bar that drags it. `caption`: Windows,
 * where this app draws the caption buttons.
 */
export function AllPlacesPage({ view, chat, drag, noDrag, framed, caption, onClose, onChat, onInbox }: { view: AllPlacesView; chat: AllPlacesChat | null; drag?: CSSProperties; noDrag?: CSSProperties;
  framed: boolean; caption: boolean; onClose: () => void; onChat: (placeId: string, botId: string, threadId?: string) => void; onInbox: () => void }) {
  const [tab, setTab] = useState<Tab>("needs-you");
  const [query, setQuery] = useState("");
  // Mirrors the sidebar's own choice.
  const threadsShown = useShowThreads();
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const chatBot = chat ? `${chat.placeId}:${chat.botId}` : null;
  useEffect(() => { if (chatBot) setUnfolded((before) => (before.has(chatBot) ? before : new Set(before).add(chatBot))); }, [chatBot]);
  const fold = (key: string) => setUnfolded((before) => { const next = new Set(before); if (!next.delete(key)) next.add(key); return next; });
  const [now, setNow] = useState(() => Date.now());
  const ticking = view.places.some((place) => place.retryAt !== null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), ticking ? 1_000 : 10_000); return () => clearInterval(timer); }, [ticking]);
  useEffect(() => { setNow(Date.now()); }, [view]);
  const inbox = chat === null;
  useEffect(() => {
    if (!inbox) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [inbox, onClose]);

  const places = useMemo(() => new Map(view.places.map((place) => [place.id, place])), [view.places]);
  const bots = useMemo(() => new Map(view.groups.flatMap((group) => group.bots.map((bot) => [`${group.placeId}:${bot.id}`, bot] as const))), [view.groups]);
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const sections = useMemo(() => listSections(view.groups), [view.groups]);
  const listed = words.length === 0 ? sections
    : sections.map((section) => ({ ...section, bots: section.bots.filter((bot) => words.every((word) => bot.name.toLocaleLowerCase().includes(word))) })).filter((section) => section.bots.length);
  const lines = view.rows.filter((line) => line.tab === tab);
  const count = (which: Tab) => view.rows.filter((line) => line.tab === which && !line.stale).length;
  const troubled = view.places.filter((place) => place.state === "unreachable" || place.state === "blocked" || place.state === "asleep");
  const openPlace = (placeId: string) => { onClose(); void window.ogb?.workspaces?.open?.(placeId)?.catch(() => {}); };
  const idle = view.check === "never" && view.places.every((place) => place.state === "loading");

  return <section role={inbox ? "dialog" : "navigation"} aria-label={t("allPlaces.title")} data-all-places={inbox ? "inbox" : "chat"} style={{ ...noDrag, ...(inbox ? {} : { width: ALL_PLACES_LIST_WIDTH }) }}
    className={cn("absolute inset-y-0 left-full z-30 flex flex-col bg-app text-ink", inbox && "w-[calc(100vw-2.25rem)]")}>
    {framed && <div data-all-places-bar style={drag} className="relative flex h-7 shrink-0 items-center justify-center bg-frame text-[12px] text-ink-secondary">
      {t("allPlaces.title")}
      {inbox && <WindowCaptionButtons visible={caption && Boolean(window.ogb?.windowControls)} />}
    </div>}
    <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: inbox ? `${ALL_PLACES_LIST_WIDTH}px minmax(0, 1fr)` : "minmax(0, 1fr)" }}>
      <aside data-all-places-sidebar className="flex min-h-0 flex-col border-r-[0.5px] border-edge bg-panel">
        <div className="shrink-0 px-3 pb-3 pt-3">
          <label className={cn("flex h-8 items-center gap-2 rounded-full px-3 focus-within:ring-focus", ELEVATED_CONTROL)}>
            <Search size={15} aria-hidden="true" className="shrink-0 text-ink-secondary" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && query) { event.stopPropagation(); setQuery(""); } }}
              placeholder={t("sidebar.search")} aria-label={t("sidebar.searchAria")} className="w-full bg-transparent text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none" />
          </label>
        </div>
        <div className="shrink-0 px-3 pb-1">
          <button type="button" data-all-places-inbox-row aria-pressed={inbox} onClick={onInbox}
            className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-raised/60 focus-visible:ring-2 focus-visible:ring-accent/60">
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", inbox ? "bg-ink/[0.16] text-ink" : "bg-raised text-ink-secondary")}><Inbox size={16} strokeWidth={1.75} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5 text-ink">{t("inbox.panel.title")}</span>
            {view.incomplete && <span data-all-places-incomplete title={t("allPlaces.incomplete")} role="img" aria-label={t("allPlaces.incomplete")} className="shrink-0 text-warning"><TriangleAlert size={13} aria-hidden="true" /></span>}
            {view.waiting > 0 && <span data-all-places-waiting className="shrink-0 rounded-full bg-warning px-1.5 text-[11px] font-semibold tabular-nums text-panel">{view.waiting > 9 ? "9+" : view.waiting}</span>}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {listed.map((section, at) => {
            const place = places.get(section.placeId);
            return place ? <div key={`${section.placeId}:${section.section ?? ""}`} data-all-places-section={section.section ?? ""} data-place={section.placeId} data-stale={section.stale ? "" : undefined}
              className={cn("flex flex-col gap-0.5", at > 0 && "pt-3")}>
              <SidebarSectionHeader name={section.section ?? placeName(place)} mark={<TeamMark place={place} />} collapsed={false} reorderable={false} dragging={false} />
              {section.bots.map((bot) => {
                const key = `${section.placeId}:${bot.id}`;
                return <BotRow key={bot.id} bot={bot} place={place} stale={section.stale} threadsShown={threadsShown} open={unfolded.has(key)} now={now}
                  current={chatBot === key ? chat?.threadId ?? bot.threadId : null} onToggle={() => fold(key)} onOpen={(threadId) => onChat(section.placeId, bot.id, threadId)} />;
              })}
            </div> : null;
          })}
          {listed.length === 0 && <p className="px-2.5 py-3 text-[12px] text-ink-tertiary">{t(words.length ? "allPlaces.noMatch" : "allPlaces.empty.bots")}</p>}
        </div>
        <ul data-all-places-states className="flex shrink-0 flex-col gap-1 border-t-[0.5px] border-edge px-4 pb-2.5 pt-2 text-[10.5px] leading-[14px] text-ink-tertiary">
          {view.places.map((place) => <li key={place.id} data-all-places-state={place.id} data-state={place.state} data-live={place.live ? "" : undefined} className="flex items-start gap-1.5">
            <span aria-hidden="true" className={cn("mt-[4px] size-1.5 shrink-0 rounded-full", place.state === "ok" ? "bg-success" : place.state === "loading" || place.state === "asleep" ? "bg-ink-tertiary" : "bg-danger")} />
            <span>{placeLine(place, now)}</span>
          </li>)}
        </ul>
      </aside>
      {inbox && <main className="flex min-h-0 min-w-0 flex-col">
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
              onOpen={() => { if (line.botId) onChat(line.placeId, line.botId, line.threadId ?? undefined); }} /> : null;
          })}
          {lines.length === 0 && !idle && <p data-all-places-empty className="py-6 text-center text-[12.5px] text-ink-tertiary">{t(tab === "needs-you" ? "allPlaces.empty.needsYou" : "allPlaces.empty.info")}</p>}
        </div>
      </main>}
    </div>
  </section>;
}
