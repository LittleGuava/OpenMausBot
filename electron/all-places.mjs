// All places: one list of bots and one inbox over every place this desktop saved, built by main from what each place
// answers as the signed-in person (GET /api/bots, GET /api/inbox). Nothing syncs and nothing is copied between places: a
// line is answered on the server it came from.
//
// Security: what a place answers is another server's data. It is checked and cut to size once, here, and leaves main as
// plain text for this app's own rail page: never an address, a picture's URL or a request id.

export const CHECKS = Object.freeze(["live", "15", "30", "60", "120", "open", "never"]);
export const DEFAULT_CHECK = "live";
export const PREVIEW_MESSAGES = 4;

const ID = /^[\w-]{1,128}$/;
const COLOR = /^[a-z]{1,16}$/;
/** A mascot's body or face as a server names it: a short name, never an address. */
const LOOK = /^[a-z][a-z0-9-]{0,31}$/;
const look = (value) => (typeof value === "string" && LOOK.test(value) ? value : null);
const MAX_BOTS = 500, MAX_ROWS = 200, MAX_CHOICES = 6;
/** How many of a bot's conversations stay listed without needing the person, as its own sidebar keeps (visibleSidebarThreads),
 * and the most a bot lists at all. */
const OPEN_THREADS = 6, MAX_THREADS = 12;
const KINDS = ["message", "ask", "result", "notice"];
/** Security: an approval whose card has any key outside this set is answered in its own chat, never here. */
const PLAIN = new Set(["title", "subtitle", "summaryCode", "summaryParams", "options", "requestType", "requestId", "tool", "held", "heldCode", "allowKey", "allowSession", "commandAllowlist", "approvalScope"]);
const MAX_TOOL = 120, MAX_DETAIL = 4_000, MAX_HELD = 600, MAX_KEY = 512;
const CODE = /^[\w.-]{1,80}$/;

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value) => (typeof value === "string" && ID.test(value) ? value : null);
const line = (value, max) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const time = (value) => (Number.isSafeInteger(value) && value > 0 ? value : null);
const whole = (value, max) => (value === undefined ? "" : typeof value === "string" && value.length <= max ? value.replace(/\r\n?/g, "\n").trim() : null);

const counted = (tasks) => (Array.isArray(tasks) ? tasks.filter((task) => record(task) && task.routineRunId === undefined && task.archivedAt === undefined) : []);

const waitingOn = (task) => task.activity === "waiting-on-you";
const atWork = (task) => task.busy === true || task.activity === "working";

/**
 * A bot's conversations as its place's own sidebar lists them by default: pinned first, then the newest; the pinned, the
 * ones that need the person (the one it opens to, waiting, at work, with a message in line, unread) and the first few
 * open ones stay. This repeats the sidebar's own rule, which main cannot import.
 * Each is built field by field: a task carries more than a page may have (a link is an address).
 */
function threadsOf(tasks, current, now, inLine) {
  const order = (task) => time(task.lastThreadOrderAt) ?? time(task.createdAt) ?? 0;
  const ordered = tasks.map((task, index) => ({ task, index }))
    .sort((a, b) => Number(b.task.pinned === true) - Number(a.task.pinned === true) || order(b.task) - order(a.task) || a.index - b.index).map((entry) => entry.task);
  let open = 0;
  const shown = ordered.filter((task) => {
    const needs = task.threadId === current || waitingOn(task) || atWork(task) || task.waitingForTeammates === true || inLine(task.threadId) || task.unread === true;
    if (task.pinned === true) return true;
    if (record(task.openedBy) && task.openedBy.burstId) return needs;
    const snoozed = task.snoozedUntil === 0 || (Number.isFinite(task.snoozedUntil) && task.snoozedUntil > now);
    return task.closedBy || snoozed ? needs : open++ < OPEN_THREADS || needs;
  });
  return shown.slice(0, MAX_THREADS).map((task) => ({ id: id(task.threadId), title: line(task.title, 80), status: waitingOn(task) ? "waiting" : atWork(task) ? "working" : "idle",
    unread: task.unread === true, at: time(task.updatedAt) ?? time(task.createdAt) })).filter((thread) => thread.id);
}

function botOf(raw, now, inLine) {
  const botId = id(raw?.id), threadId = id(raw?.threadId), name = line(raw?.name, 80);
  if (!botId || !threadId || !name || raw.hidden === true) return null;
  const tasks = counted(raw.tasks);
  const threads = tasks.length > 1 ? threadsOf(tasks, threadId, now, inLine) : [];
  const waiting = raw.activity === "waiting-on-you" || tasks.some((task) => task.activity === "waiting-on-you");
  const working = !waiting && (raw.busy === true || tasks.some((task) => task.busy === true || task.activity === "working"));
  const said = Array.isArray(raw.messages) ? raw.messages.findLast((message) => record(message) && message.kind === "text" && line(message.text, 1)) : undefined;
  const newest = tasks.reduce((latest, task) => Math.max(latest, time(task.updatedAt) ?? 0), 0);
  const section = line(raw.section, 80);
  return {
    id: botId, threadId, name, color: typeof raw.color === "string" && COLOR.test(raw.color) ? raw.color : "silver",
    ...(look(raw.mascotBody) ? { body: look(raw.mascotBody) } : {}), ...(look(raw.mascotFaceColor) ? { face: look(raw.mascotFaceColor) } : {}),
    ...(section ? { section } : {}),
    status: waiting ? "waiting" : working ? "working" : "idle",
    unread: tasks.length ? tasks.some((task) => task.unread === true) : raw.unread === true,
    preview: said ? line(said.text, 160) : null, ...(said?.role === "user" ? { mine: true } : {}),
    at: time(said?.at) ?? (newest || null),
    ...(threads.length ? { threads } : {}),
  };
}

export function parseBots(raw, now = Date.now()) {
  if (!record(raw) || !Array.isArray(raw.bots)) return null;
  const sections = Array.isArray(raw.sections) ? [...new Set(raw.sections.map((name) => line(name, 80)).filter(Boolean))].slice(0, 100) : [];
  // The messages waiting in line come beside the bots, by conversation; only whether one waits is kept.
  const lines = record(raw.botQueuedMessages) ? raw.botQueuedMessages : {};
  const inLine = (threadId) => Object.hasOwn(lines, threadId) && Array.isArray(lines[threadId]) && lines[threadId].length > 0;
  return { sections, bots: raw.bots.slice(0, MAX_BOTS).map((one) => botOf(one, now, inLine)).filter(Boolean) };
}

function asked(card) {
  if (!Object.entries(card).every(([key, value]) => PLAIN.has(key) || value === false || value == null)) return null;
  const exact = card.commandAllowlist === undefined ? card.subtitle : record(card.commandAllowlist) ? card.commandAllowlist.command ?? null : null;
  const tool = whole(card.tool, MAX_TOOL), detail = whole(exact, MAX_DETAIL), held = whole(card.held, MAX_HELD);
  const coded = card.heldCode === undefined || (typeof card.heldCode === "string" && CODE.test(card.heldCode));
  // The words a code stands for are worded in the person's language by the place's page only: with no English ones, nothing would show here.
  if (!tool || detail === null || held === null || !coded || (!detail && card.summaryCode !== undefined)) return null;
  return { tool: line(tool, MAX_TOOL), detail, ...(held ? { held } : {}), ...(card.heldCode ? { heldCode: card.heldCode } : {}) };
}

function rowOf(raw, inboxThread) {
  const rowId = id(raw?.id);
  if (!rowId || !KINDS.includes(raw.kind) || (raw.tab !== "needs-you" && raw.tab !== "info")) return null;
  const card = record(raw.card) ? raw.card : null, origin = record(raw.origin) ? raw.origin : null;
  const requestId = id(card?.requestId), question = card?.requestType === "question" || record(card?.questionRequest);
  // A password, a sign-in or an app to connect is answered with its own card, in its chat.
  const inChat = record(raw.secret) || record(raw.signIn) || record(raw.connector) || card?.answered !== undefined;
  const open = raw.kind === "ask" && raw.tab === "needs-you" && requestId !== null && !inChat;
  const subject = raw.kind === "ask" ? (card?.tool || !question ? "approval" : "question") : raw.kind;
  const threadId = inboxThread ?? id(origin?.threadId);
  const allowKey = typeof card?.allowKey === "string" && card.allowKey.length <= MAX_KEY ? card.allowKey : null;
  const from = line(raw.from?.name, 80);
  const approval = open && subject === "approval" && threadId !== null && from ? asked(card) : null;
  const choices = open && subject === "question" && threadId !== null && !record(card.questionRequest) && Array.isArray(card.options)
    ? card.options.filter((choice) => typeof choice === "string" && choice.length > 0 && choice.length <= 120).slice(0, MAX_CHOICES) : [];
  const botId = id(origin?.botId) ?? id(raw.from?.botId);
  // A key is remembered for a bot, and only for the bot the line names; without a key the provider remembers for its
  // session, unless the card has a command its place may offer to remember instead. One never stands in for another.
  const keyed = card?.allowKey !== undefined && card.allowKey !== "";
  const named = botId !== null && (raw.from?.botId === undefined || raw.from.botId === botId);
  const always = approval !== null && (keyed ? Boolean(allowKey && named) : card.allowSession === true && card.commandAllowlist === undefined);
  return {
    id: rowId, tab: raw.tab, subject, from, botId, threadId: id(origin?.threadId), title: line(origin?.title, 120) || null,
    text: line(raw.text, 600), at: time(raw.at) ?? 0, unread: raw.unread === true,
    actions: approval ? ["allow", ...(always ? ["always"] : []), "deny"] : raw.tab === "info" && raw.unread === true ? ["read"] : [],
    choices, ...approval, ...(always && keyed ? { alwaysKey: allowKey } : {}),
    // Main's own: what an answer needs, never sent to a page.
    answer: open && threadId !== null ? { threadId, requestId, ...(allowKey ? { allowKey } : {}), ...(card.allowSession === true ? { allowSession: true } : {}) } : null,
  };
}

export function parseInbox(raw) {
  if (!record(raw) || !Array.isArray(raw.rows)) return null;
  const threadId = id(raw.threadId);
  return { rows: raw.rows.slice(0, MAX_ROWS).map((row) => rowOf(row, threadId)).filter(Boolean) };
}

/**
 * The requests an action on a line becomes, for that line's own server, or null when the line is gone or does not take
 * the action: Allow once, Always allow, Deny, a question's choice, or a note read.
 * @param {{ rows: any[] } | null} inbox
 */
export function actionRequests(inbox, rowId, action, value) {
  const row = inbox?.rows.find((candidate) => candidate.id === rowId);
  if (!row) return null;
  if (action === "read") return row.actions.includes("read") ? [{ method: "POST", route: `/api/inbox/${row.id}/read` }] : null;
  const answer = row.answer;
  if (!answer) return null;
  const respond = (body) => ({ method: "POST", route: `/api/threads/${answer.threadId}/respond`, body: { requestId: answer.requestId, ...body } });
  if (action === "answer") return row.choices.includes(value) ? [respond({ behavior: "answer", message: value })] : null;
  if (!row.actions.includes(action)) return null;
  if (action === "allow") return [respond({ behavior: "allow" })];
  if (action === "deny") return [respond({ behavior: "deny" })];
  if (action !== "always") return null;
  return answer.allowKey && row.botId
    ? [{ method: "POST", route: `/api/bots/${row.botId}/always-allow`, body: { threadId: answer.threadId, allowKey: answer.allowKey } }, respond({ behavior: "allow" })]
    : [respond({ behavior: "allow", always: true })];
}

/** The lines that began to wait on the person since `before`; none on a place's first reading, which only says what was
 * already there. */
export function newlyWaiting(before, after) {
  if (!before || !after) return [];
  const known = new Set(before.rows.filter((row) => row.tab === "needs-you").map((row) => row.id));
  return after.rows.filter((row) => row.tab === "needs-you" && !known.has(row.id));
}

const waits = (row) => row.tab === "needs-you" || row.unread;

const tag = (place) => ({ id: place.id, name: place.name, kind: place.kind, color: place.color ?? null });

function groupsOf(place, bots, stale) {
  const names = [...bots.sections, ...bots.bots.map((bot) => bot.section).filter((name) => name && !bots.sections.includes(name))];
  const groups = [...new Set(names)].map((section) => ({ section, bots: bots.bots.filter((bot) => bot.section === section) }));
  const loose = bots.bots.filter((bot) => !bot.section);
  return [...groups, ...(loose.length ? [{ section: null, bots: loose }] : [])].filter((group) => group.bots.length)
    .map((group) => ({ placeId: place.id, section: group.section, stale, bots: group.bots.map(({ section: _section, ...bot }) => bot) }));
}

/**
 * A place that can't be read now keeps what it last said, marked stale, and is left out of the count.
 * @param {{ active: boolean, check: string, now: number, places: any[], readings: Map<string, any> }} input `readings`: per place
 * `{ state, blocked?, message?, noInbox?, seenAt, failingSince, retryAt, live, bots, inbox }`.
 */
export function allPlacesView({ active, check, now, places, readings }) {
  if (!active) return { active: false, check, now, places: [], groups: [], rows: [], waiting: 0, incomplete: false };
  const states = [], groups = [], rows = [];
  let waiting = 0, incomplete = false;
  for (const place of places) {
    const reading = readings.get(place.id) ?? { state: "loading", seenAt: null, failingSince: null, retryAt: null, live: false, bots: null, inbox: null };
    const stale = reading.state !== "ok";
    if (stale && reading.state !== "loading") incomplete = true;
    states.push({ ...tag(place), state: reading.state, ...(reading.blocked ? { blocked: reading.blocked } : {}), ...(reading.message ? { message: reading.message } : {}),
      ...(reading.noInbox ? { noInbox: true } : {}), seenAt: reading.seenAt ?? null, failingSince: reading.failingSince ?? null, retryAt: reading.retryAt ?? null, live: reading.live === true });
    if (reading.bots) groups.push(...groupsOf(place, reading.bots, stale));
    for (const { answer: _answer, ...row } of reading.inbox?.rows ?? []) {
      rows.push({ placeId: place.id, ...row, stale, ...(stale ? { actions: [], choices: [] } : {}) });
      if (!stale && waits(row)) waiting += 1;
    }
  }
  rows.sort((a, b) => b.at - a.at);
  return { active: true, check, now, places: states, groups, rows, waiting, incomplete };
}
