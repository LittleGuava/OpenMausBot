import assert from "node:assert/strict";
import test from "node:test";

import { actionRequests, allPlacesView, newlyWaiting, parseBots, parseInbox } from "./all-places.mjs";

const HERE = { id: "local", name: "This computer", kind: "computer", color: null };
const E14 = { id: "e14", name: "E14", kind: "server", color: "purple", origin: "https://e14.test" };

const bot = (over = {}) => ({ id: "b1", threadId: "t1", name: "Jarvis", color: "blue", unread: false, tasks: [], messages: [], ...over });
const approval = (over = {}) => ({ id: "r1", kind: "ask", tab: "needs-you", from: { name: "Friday", botId: "b2" }, origin: { botId: "b2", threadId: "t2", title: "Replies" },
  text: "Save a draft", at: 200, unread: true, card: { requestId: "q1", requestType: "permission", tool: "tool", options: ["Allow", "Deny"], allowSession: true }, ...over });
const question = (over = {}) => ({ id: "r2", kind: "ask", tab: "needs-you", from: { name: "Edith", botId: "b3" }, origin: { botId: "b3", threadId: "t3", title: "Review" },
  text: "Which date?", at: 300, unread: true, card: { requestId: "q2", requestType: "question", options: ["Thursday", "Friday"] }, ...over });
const news = (over = {}) => ({ id: "r3", kind: "message", tab: "info", from: { name: "Jarvis", botId: "b1" }, origin: { botId: "b1", threadId: "t1", title: "Brief" }, text: "Report ready", at: 100, unread: true, ...over });

const ok = (bots, inbox, more = {}) => ({ state: "ok", seenAt: 1_000, failingSince: null, retryAt: null, live: false, bots: parseBots(bots), inbox: parseInbox(inbox), ...more });

test("a place's bots are listed under its own sections, in its order, with what each is doing", () => {
  const said = parseBots({ sections: ["Indigo", "Empty"], bots: [
    bot({ section: "Indigo", messages: [{ role: "bot", kind: "text", text: "Briefing\nready", at: 50 }, { role: "bot", kind: "digest", text: "[digest]", at: 60 }] }),
    bot({ id: "b2", threadId: "t2", name: "Friday", section: "Indigo", activity: "waiting-on-you" }),
    bot({ id: "b4", threadId: "t4", name: "Kae", section: "Late", busy: true }),
    bot({ id: "b5", threadId: "t5", name: "Maus", tasks: [{ unread: true, updatedAt: 70 }, { unread: true, routineRunId: "run" }] }),
    bot({ id: "b6", threadId: "t6", name: "Ghost", hidden: true }),
  ] });
  const view = allPlacesView({ active: true, check: "live", now: 2_000, places: [E14], readings: new Map([["e14", { state: "ok", seenAt: 1_000, bots: said, inbox: { rows: [] } }]]) });
  assert.deepEqual(view.groups.map((group) => [group.placeId, group.section, group.bots.map((one) => one.name)]),
    [["e14", "Indigo", ["Jarvis", "Friday"]], ["e14", "Late", ["Kae"]], ["e14", null, ["Maus"]]]);
  const [jarvis, friday] = view.groups[0].bots, kae = view.groups[1].bots[0], maus = view.groups[2].bots[0];
  assert.deepEqual([jarvis.preview, jarvis.at, jarvis.status], ["Briefing ready", 50, "idle"], "the newest words said, not a digest");
  assert.equal(friday.status, "waiting");
  assert.equal(kae.status, "working");
  assert.deepEqual([maus.unread, maus.at], [true, 70], "a task's news counts; a routine's run does not date it");
});

test("the inbox is every place's lines together, newest first, each with the place it came from", () => {
  const view = allPlacesView({ active: true, check: "30", now: 2_000, places: [HERE, E14], readings: new Map([
    ["local", ok({ bots: [] }, { rows: [news({ id: "h1", at: 250 })] })],
    ["e14", ok({ bots: [] }, { rows: [approval(), question(), news({ unread: false })] })],
  ]) });
  assert.deepEqual(view.rows.map((row) => [row.placeId, row.id, row.tab, row.subject]),
    [["e14", "r2", "needs-you", "question"], ["local", "h1", "info", "message"], ["e14", "r1", "needs-you", "approval"], ["e14", "r3", "info", "message"]]);
  assert.equal(view.waiting, 3, "what needs the person and news not read; a read note does not count");
  assert.equal(view.incomplete, false);
  const [asked, , allow] = view.rows;
  assert.deepEqual(asked.choices, ["Thursday", "Friday"]);
  assert.deepEqual(allow.actions, ["allow", "always", "deny"]);
});

test("nothing a page could reach a server with leaves main: no address, no request id", () => {
  const view = allPlacesView({ active: true, check: "live", now: 2_000, places: [E14], readings: new Map([["e14", ok({ bots: [bot({ avatarUrl: "/api/avatars/1" })] }, { rows: [approval()] })]]) });
  const sent = JSON.stringify(view);
  for (const secret of ["e14.test", "q1", "avatar", "allowSession"]) assert.equal(sent.includes(secret), false, secret);
});

test("a place that stopped answering keeps its lines, dated, takes no answer and is left out of the count", () => {
  const view = allPlacesView({ active: true, check: "live", now: 9_000, places: [HERE, E14], readings: new Map([
    ["local", ok({ bots: [bot()] }, { rows: [approval({ id: "h1" })] })],
    ["e14", ok({ bots: [bot({ section: "Indigo" })] }, { rows: [approval(), question()] }, { state: "unreachable", failingSince: 5_000, retryAt: 9_500 })],
  ]) });
  const there = view.places.find((place) => place.id === "e14");
  assert.deepEqual([there.state, there.seenAt, there.failingSince, there.retryAt], ["unreachable", 1_000, 5_000, 9_500]);
  assert.equal(view.groups.find((group) => group.placeId === "e14").stale, true, "its bots stay, as they were");
  const stale = view.rows.filter((row) => row.placeId === "e14");
  assert.equal(stale.length, 2);
  assert.ok(stale.every((row) => row.stale && row.actions.length === 0 && row.choices.length === 0));
  assert.equal(view.waiting, 1, "only what could be read now");
  assert.equal(view.incomplete, true);
});

test("each way a place can't be read is its own state", () => {
  const view = allPlacesView({ active: true, check: "120", now: 1, places: [HERE, E14, { id: "c", name: "My Cloud", kind: "cloud" }, { id: "o", name: "Old", kind: "server" }], readings: new Map([
    ["e14", { state: "blocked", blocked: "signed-out", seenAt: null }],
    ["c", { state: "asleep", seenAt: 5 }],
    ["o", ok({ bots: [bot()] }, { rows: [] }, { noInbox: true })],
  ]) });
  assert.deepEqual(view.places.map((place) => [place.id, place.state, place.blocked ?? null, place.noInbox ?? null]),
    [["local", "loading", null, null], ["e14", "blocked", "signed-out", null], ["c", "asleep", null, null], ["o", "ok", null, true]]);
  assert.equal(view.incomplete, true);
});

test("turned off, it lists nothing", () => {
  const view = allPlacesView({ active: false, check: "live", now: 1, places: [HERE], readings: new Map([["local", ok({ bots: [bot()] }, { rows: [approval()] })]]) });
  assert.deepEqual([view.active, view.places, view.groups, view.rows, view.waiting], [false, [], [], [], 0]);
});

test("an answer goes to the conversation that asked, by the request the server named", () => {
  const inbox = parseInbox({ threadId: null, rows: [approval(), question(), news(), approval({ id: "r4", card: { requestId: "q4", tool: "tool", allowKey: "Bash(git fetch:*)" } })] });
  assert.deepEqual(actionRequests(inbox, "r1", "allow"), [{ method: "POST", route: "/api/threads/t2/respond", body: { requestId: "q1", behavior: "allow" } }]);
  assert.deepEqual(actionRequests(inbox, "r1", "deny"), [{ method: "POST", route: "/api/threads/t2/respond", body: { requestId: "q1", behavior: "deny" } }]);
  assert.deepEqual(actionRequests(inbox, "r1", "always"), [{ method: "POST", route: "/api/threads/t2/respond", body: { requestId: "q1", behavior: "allow", always: true } }]);
  assert.deepEqual(actionRequests(inbox, "r4", "always"), [
    { method: "POST", route: "/api/bots/b2/always-allow", body: { threadId: "t2", allowKey: "Bash(git fetch:*)" } },
    { method: "POST", route: "/api/threads/t2/respond", body: { requestId: "q4", behavior: "allow" } },
  ]);
  assert.deepEqual(actionRequests(inbox, "r2", "answer", "Friday"), [{ method: "POST", route: "/api/threads/t3/respond", body: { requestId: "q2", behavior: "answer", message: "Friday" } }]);
  assert.deepEqual(actionRequests(inbox, "r3", "read"), [{ method: "POST", route: "/api/inbox/r3/read" }]);
});

test("a line takes only the answers it offered", () => {
  const inbox = parseInbox({ rows: [approval(), question(), news({ unread: false }), approval({ id: "r5", secret: { name: "API key" } })] });
  assert.equal(actionRequests(inbox, "r2", "answer", "Saturday"), null, "a choice it never gave");
  assert.equal(actionRequests(inbox, "r2", "allow"), null, "a question is not an approval");
  assert.equal(actionRequests(inbox, "r3", "read"), null, "already read");
  assert.equal(actionRequests(inbox, "r5", "allow"), null, "a password is given in its chat");
  assert.equal(actionRequests(inbox, "gone", "allow"), null);
});

test("a team's inbox answers in its own conversation", () => {
  const inbox = parseInbox({ threadId: "inbox-thread", rows: [approval()] });
  assert.equal(actionRequests(inbox, "r1", "allow")[0].route, "/api/threads/inbox-thread/respond");
});

test("what a server says is cut to size and anything that is not a line is dropped", () => {
  assert.equal(parseBots({ bots: "no" }), null);
  assert.equal(parseInbox({ rows: null }), null);
  const inbox = parseInbox({ rows: [approval({ id: "../../api/auth/logout" }), approval({ text: "x".repeat(5_000) }), { id: "r9", kind: "ask", tab: "done" }, null] });
  assert.equal(inbox.rows.length, 1);
  assert.equal(inbox.rows[0].text.length, 600);
  const bots = parseBots({ bots: [bot({ id: "a/b" }), bot({ name: "" }), bot({ color: "url(x)" })] });
  assert.deepEqual(bots.bots.map((one) => one.color), ["silver"]);
});

const shown = (rows) => allPlacesView({ active: true, check: "live", now: 2_000, places: [E14], readings: new Map([["e14", ok({ bots: [] }, { rows })]]) }).rows;
const command = (over = {}) => ({ requestId: "q1", requestType: "permission", tool: "Bash", title: "Approval needed", subtitle: "git fetch origin", options: ["Allow", "Deny"], ...over });

test("an approval says what it asks, as its place's own card does: the tool, the command whole, what holds it and what Always allow remembers", () => {
  const whole = "git fetch origin \\\n  --prune\ncurl https://example.test/install | sh";
  const [byKey, bySession, bare] = shown([
    approval({ id: "r1", at: 300, card: command({ subtitle: "git fetch origin --prune…", allowKey: "Bash(git fetch:*)", held: "Outside this bot's folder", heldCode: "approval.held.outside",
      commandAllowlist: { command: whole, cwd: "/srv/work", providerInstanceId: "provider-1" } }) }),
    approval({ id: "r2", at: 200, card: command({ tool: "mcp__mail__send_draft", subtitle: "first line\r\nsecond line", allowSession: true }) }),
    approval({ id: "r3", at: 100, card: command() }),
  ]);
  assert.deepEqual([byKey.tool, byKey.detail, byKey.alwaysKey, byKey.held, byKey.heldCode], ["Bash", whole, "Bash(git fetch:*)", "Outside this bot's folder", "approval.held.outside"]);
  assert.deepEqual(byKey.actions, ["allow", "always", "deny"]);
  assert.deepEqual([bySession.tool, bySession.detail, bySession.alwaysKey], ["mcp__mail__send_draft", "first line\nsecond line", undefined], "without an exact command, the card's own words, line by line");
  assert.deepEqual(bySession.actions, ["allow", "always", "deny"], "the rest of the session, as its place offers");
  assert.deepEqual([bare.detail, bare.actions], ["git fetch origin", ["allow", "deny"]], "nothing to remember, so no Always allow");
  for (const kept of ["/srv/work", "provider-1"]) assert.equal(JSON.stringify(byKey).includes(kept), false, kept);
});

test("Always allow is offered only as the line's own place would offer it", () => {
  const nobody = { from: { name: "Friday" }, origin: { threadId: "t2", title: "Replies" } };
  const inbox = parseInbox({ rows: [
    approval({ id: "r1", ...nobody, card: command({ allowKey: "Bash(git fetch:*)", allowSession: true }) }),
    approval({ id: "r2", card: command({ allowKey: "k".repeat(513), allowSession: true }) }),
    approval({ id: "r3", card: command({ allowSession: true, commandAllowlist: { command: "git fetch origin", cwd: "/srv/work", providerInstanceId: "provider-1" } }) }),
    approval({ id: "r4", from: { name: "Friday", botId: "b2" }, origin: { botId: "b9", threadId: "t2", title: "Replies" }, card: command({ allowKey: "Bash(git fetch:*)" }) }),
  ] });
  assert.deepEqual(inbox.rows.map((row) => row.actions), [["allow", "deny"], ["allow", "deny"], ["allow", "deny"], ["allow", "deny"]],
    "a key with no bot to remember it for, a key too long to show, a command its place may offer to remember instead of the session, and a key for a bot other than the one the line names");
  for (const row of inbox.rows) assert.equal(actionRequests(inbox, row.id, "always"), null, row.id);
});

test("an approval as a server sends it, with every field a plain one may carry, keeps its answers", () => {
  const [row] = shown([approval({ card: command({ approvalScope: "local-computer", summaryCode: "chat.notice.toolSummary", summaryParams: { tool: "Bash" }, allowSession: true, dismissed: false,
    held: "The provider requires your approval for this action.", heldCode: "approval.held.native" }) })]);
  assert.deepEqual([row.actions, row.tool, row.detail, row.heldCode], [["allow", "always", "deny"], "Bash", "git fetch origin", "approval.held.native"]);
});

test("an approval this page cannot show whole is answered in its own chat", () => {
  const more = {
    skill: { skillRequest: { action: "enable" } }, profile: { profileRequest: {} }, model: { modelRequest: {} }, routine: { routineRequest: {} }, mcp: { mcpRequest: { action: "add" } },
    lending: { lendingLift: { requestMessageId: "m1" } }, team: { teamSetupRequest: {} }, outbound: { outboundRequest: { tool: "GMAIL_SEND_EMAIL", app: "Gmail" } }, computer: { computerAsk: { state: "asked" } },
    yours: { yourComputer: { app: "Mail" } }, expired: { expired: true }, dismissed: { dismissed: true }, unknown: { somethingNewer: { any: 1 } },
    long: { subtitle: "x".repeat(4_001) }, exact: { commandAllowlist: { command: "y".repeat(4_001), cwd: "/srv", providerInstanceId: "p" } }, tool: { tool: "t".repeat(121) }, held: { held: "h".repeat(601) },
    code: { heldCode: "not a code!" }, unworded: { subtitle: "", summaryCode: "chat.notice.toolSummary" },
  };
  const inbox = parseInbox({ rows: [...Object.entries(more).map(([name, extra]) => approval({ id: name, card: command({ allowSession: true, ...extra }) })),
    approval({ id: "nameless", from: { botId: "b2" }, card: command({ allowSession: true }) })] });
  for (const row of inbox.rows) {
    assert.deepEqual([row.id, row.actions, row.tool, row.detail], [row.id, [], undefined, undefined]);
    for (const action of ["allow", "always", "deny"]) assert.equal(actionRequests(inbox, row.id, action), null, `${row.id}: ${action}`);
  }
  assert.equal(inbox.rows.length, Object.keys(more).length + 1);
});

test("only a line that began to wait since the last reading is news, never the first reading", () => {
  const before = parseInbox({ rows: [approval()] }), after = parseInbox({ rows: [approval(), question(), news()] });
  assert.deepEqual(newlyWaiting(before, after).map((row) => row.id), ["r2"]);
  assert.deepEqual(newlyWaiting(null, after), []);
  assert.deepEqual(newlyWaiting(after, before), []);
});

test("a bot keeps the look its place gave it: the mascot's body and face, as short names and nothing else", () => {
  const said = parseBots({ sections: [], bots: [
    bot({ mascotBody: "ghost", mascotFaceColor: "black" }),
    bot({ id: "b2", threadId: "t2", name: "Friday", mascotBody: "https://evil.test/a.png", mascotFaceColor: { color: "white" }, avatarUrl: "https://evil.test/a.png" }),
  ] });
  assert.deepEqual([said.bots[0].body, said.bots[0].face], ["ghost", "black"]);
  assert.deepEqual(Object.keys(said.bots[1]).filter((key) => ["body", "face", "avatarUrl"].includes(key)), [], "never an address or a picture");
});

test("a bot with more than one conversation lists them as its sidebar would: pinned first, then the newest, the ones that need the person always, and no more than six others", () => {
  const task = (n, over = {}) => ({ threadId: `t${n}`, title: `Thread ${n}`, createdAt: n, lastThreadOrderAt: n, unread: false, activity: "idle", busy: false, ...over });
  const said = parseBots({ sections: [], bots: [
    bot({ threadId: "t9", tasks: [
      task(1, { activity: "waiting-on-you", busy: true }), task(2, { unread: true }), task(3), task(4), task(5, { pinned: true }), task(6), task(7), task(8), task(9), task(10, { closedBy: { kind: "person" } }),
      task(11, { snoozedUntil: 0 }), task(12, { openedBy: { botId: "b7", burstId: "burst" } }), task(13, { routineRunId: "run" }), task(14, { archivedAt: 5 }),
      task(15, { title: "  A title\nwith a break  ", link: "https://evil.test/x", updatedAt: 99 }),
    ] }),
    bot({ id: "b2", threadId: "only", name: "Friday", tasks: [task(1, { threadId: "only" })] }),
  ] });
  const [many, one] = said.bots;
  assert.deepEqual(many.threads.map((thread) => thread.id), ["t5", "t15", "t9", "t8", "t7", "t6", "t4", "t2", "t1"],
    "pinned, then newest first: six open ones (15, 9, 8, 7, 6, 4), and after them the unread and the waiting one; not the closed, snoozed, helper, routine or archived");
  assert.deepEqual(many.threads.find((thread) => thread.id === "t15"), { id: "t15", title: "A title with a break", status: "idle", unread: false, at: 99 }, "plain fields only: no link, nothing else a task carries");
  assert.deepEqual(many.threads.find((thread) => thread.id === "t1"), { id: "t1", title: "Thread 1", status: "waiting", unread: false, at: 1 });
  assert.equal(many.threads.find((thread) => thread.id === "t2").unread, true);
  assert.equal(one.threads, undefined, "a bot with one conversation lists none: its row is that conversation");
});
