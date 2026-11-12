// Prototype tooling, not product code: starts an isolated development instance of the desktop app with two test places,
// to try "All places" without touching the installed app, its data or any real server.
//
//   node --experimental-strip-types scripts/proto-all-places/up.ts          start everything and stay attached
//   node --experimental-strip-types scripts/proto-all-places/up.ts --seed   ask the running bots for new lines
//   node --experimental-strip-types scripts/proto-all-places/up.ts --e14-stop    the remote place stops answering
//   node --experimental-strip-types scripts/proto-all-places/up.ts --e14-start   and answers again, the same server
//   node scripts/proto-all-places/down.mjs                                  stop everything and remove the temporary data
//
// What runs: two fake-engine fixture servers (the same launcher as `control-omb launch`: temporary home and data, no real
// engine), "This computer" behind this checkout's Vite and "E14" serving the built page (dist/); and Electron with a
// profile, data folder and network of its own (guard.cjs). Everything it writes is under one folder in the temp directory.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer, verificationServerArgs, verificationServerEnvironment, type VerificationServer } from "../control-omb.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ROOT = join(tmpdir(), "omb-all-places-proto");
const STATE = join(ROOT, "state.json");
const STOP = join(ROOT, "stop");
/** Asks the running launcher to stop or start the remote place: it owns that process. */
const E14_STOP = join(ROOT, "e14.stop"), E14_START = join(ROOT, "e14.start");
const HOURS = 12 * 60 * 60 * 1000;
const INSTALLED_PORTS = [8799, 8800, 18799, 28799];

type Call = (method: string, route: string, body?: unknown) => Promise<{ status: number; body: any }>;
const caller = (base: string): Call => async (method, route, body) => {
  const response = await fetch(`${base}${route}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, body: parsed };
};
const must = (answer: { status: number; body: any }, what: string) => {
  if (answer.status >= 400) throw new Error(`${what} answered ${answer.status}: ${JSON.stringify(answer.body).slice(0, 200)}`);
  return answer.body;
};

/** A free loopback port in a range of this prototype's own, never one the installed app listens on. */
async function freePort(from: number, to: number): Promise<number> {
  for (let port = from; port <= to; port++) {
    if (INSTALLED_PORTS.includes(port)) continue;
    const free = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error(`no free port in ${from}-${to}`);
}

interface PlannedBot { name: string; section?: string; command: string; question: string; choices: string[]; note: string; ask?: Array<{ say: string; thread: string }> }
/** What each test place holds: bots in sections, and for some a line that waits on the person or a note for them. */
const PLACES: Record<"local" | "e14", PlannedBot[]> = {
  local: [
    { name: "Cerqueira", section: "Telefonica", command: "pnpm test --filter billing", question: "Which environment should I deploy to?", choices: ["Staging", "Production"], note: "The billing report is attached to ticket 4790." },
    { name: "Kae", section: "Telefonica", command: "git fetch origin", question: "Rebase or merge?", choices: ["Rebase", "Merge"], note: "Ticket 4821 is ready for review.", ask: [{ say: "approval please", thread: "Ticket 4821" }] },
    { name: "Ale", section: "Security", command: "nmap -sV 10.0.0.0/28", question: "Scan the staging network too?", choices: ["Yes", "Not now"], note: "Nightly sweep finished with no findings.", ask: [{ say: "note please", thread: "Nightly sweep" }] },
  ],
  e14: [
    { name: "Jarvis", section: "Indigo", command: "calendar sync", question: "Move the 10 am meeting?", choices: ["Yes, to 11 am", "Keep it"], note: "Daily briefing ready: 2 meetings and 1 overdue item.", ask: [{ say: "note please", thread: "Daily briefing" }] },
    { name: "Friday", section: "Indigo", command: "gmail drafts create --reply-to client", question: "Send it now or keep it as a draft?", choices: ["Send now", "Keep the draft"], note: "Three replies are waiting in drafts.", ask: [{ say: "approval please", thread: "Replies of the day" }] },
    { name: "Edith", section: "Indigo", command: "calendar hold --week 46", question: "Which date do you prefer for the quarterly review?", choices: ["Thursday, 2 pm", "Friday, 10 am"], note: "The review agenda is drafted.", ask: [{ say: "question please", thread: "Quarterly review" }] },
    { name: "Ofilia", command: "ls ~/reports", question: "Archive last month's reports?", choices: ["Archive", "Leave them"], note: "Reports folder tidied." },
  ],
};

/** The fake engine's script for one bot: each of three phrases asks for one kind of line, as often as it is said. */
const scriptFor = (bot: PlannedBot) => ({ script: [
  { key: "approval", match: ["approval please"], repeat: true, timeoutMs: HOURS, approve: { tool: "Bash", input: { command: bot.command } }, reply: `Done: ran \`${bot.command}\`.`, replyIfDenied: "Okay, I left it alone." },
  { key: "question", match: ["question please"], repeat: true, timeoutMs: HOURS, steps: [{ server: "ogb", tool: "ask_user", arguments: { question: bot.question, choices: bot.choices }, capture: { answer: "([\\s\\S]+)" } }], reply: "Going with {{answer}}." },
  { key: "note", match: ["note please"], repeat: true, timeoutMs: HOURS, steps: [{ server: "agents", tool: "message_person", arguments: { message: bot.note } }], reply: "I left you a note." },
  { key: "chat", match: [], repeat: true, reply: `${bot.name} here, a fixture bot. Say "approval please", "question please" or "note please" and I will ask for one.` },
] });

async function seed(base: string, dataDir: string, bots: PlannedBot[], starterName: string): Promise<Record<string, string>> {
  const call = caller(base);
  const starter = must(await call("GET", "/api/bots?messages=0"), "the bot list").bots[0];
  must(await call("PATCH", `/api/bots/${starter.id}/profile`, { name: starterName }), "renaming the starter bot");
  const plan: Record<string, unknown> = { [starter.id]: scriptFor({ name: starterName, command: "echo hello", question: "Which one?", choices: ["This", "That"], note: "Hello from a fixture." }) };
  const ids: Record<string, string> = {};
  const sections = new Map<string, string[]>();
  for (const bot of bots) {
    const made = must(await call("POST", "/api/bots", { name: bot.name, modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }), `creating ${bot.name}`).bot;
    must(await call("PATCH", `/api/bots/${made.id}`, { approvalMode: "ask", applyToAllThreads: true }), `${bot.name}'s approval mode`);
    ids[bot.name] = made.id;
    plan[made.id] = scriptFor(bot);
    if (bot.section) sections.set(bot.section, [...(sections.get(bot.section) ?? []), made.id]);
  }
  for (const [name, botIds] of sections) must(await call("POST", "/api/sidebar-sections", { name, botIds }), `the ${name} section`);
  // A place that already met its person: the welcome flow would stand between them and the bots.
  must(await call("PATCH", "/api/config", { onboarding: { completedAt: new Date().toISOString(), version: 99, hintsSeen: ["met-chief-v1"] } }), "the welcome flow");
  writeFileSync(join(dataDir, "room-plan.json"), JSON.stringify(plan));
  return ids;
}

/** The lines the plan asks for: each in a conversation of its own, as a person's message to that bot. */
async function ask(base: string, bots: PlannedBot[], ids: Record<string, string>): Promise<void> {
  const call = caller(base);
  for (const bot of bots) {
    for (const line of bot.ask ?? []) {
      const thread = must(await call("POST", `/api/bots/${ids[bot.name]}/tasks`, { title: line.thread }), `${bot.name}'s thread`).task.threadId;
      must(await call("POST", `/api/bots/${ids[bot.name]}/messages`, { text: line.say, threadId: thread }), `${bot.name}'s message`);
    }
  }
}

async function waitFor(what: string, ready: () => Promise<boolean>, timeoutMs = 60_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await ready().catch(() => false))) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

const readState = () => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return null; } };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** Windows has no signal a detached child hears: its whole tree is ended by its exact pid, never by name. */
const end = (child: ChildProcess | null) => {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else child.kill("SIGTERM");
};

async function reseed(): Promise<void> {
  const state = readState();
  if (!state || !alive(state.supervisor)) throw new Error("the prototype is not running; start it first");
  for (const place of ["local", "e14"] as const) await ask(state.places[place].server, PLACES[place], state.places[place].bots);
  process.stdout.write("asked the fixture bots for their lines again\n");
}

/** Leaves a request for the running launcher. */
function request(file: string, said: string): void {
  const state = readState();
  if (!state || !alive(state.supervisor)) throw new Error("the prototype is not running; start it first");
  writeFileSync(file, "");
  process.stdout.write(`${said}\n`);
}

async function up(): Promise<void> {
  const before = readState();
  if (before && alive(before.supervisor)) throw new Error(`already running (process ${before.supervisor}); stop it with: node scripts/proto-all-places/down.mjs`);
  if (!existsSync(join(REPO, "dist", "index.html"))) throw new Error("dist/ is missing: build the page the remote place serves with `pnpm exec vite build`");
  rmSync(ROOT, { recursive: true, force: true });
  const userData = join(ROOT, "electron-user-data"), dataDir = join(ROOT, "electron-data"), companion = join(ROOT, "companion");
  for (const dir of [userData, dataDir, companion]) mkdirSync(dir, { recursive: true });

  const servers: VerificationServer[] = [];
  let vite: ChildProcess | null = null, electron: ChildProcess | null = null, e14: ChildProcess | null = null, closing = false;
  const close = async (code: number) => {
    if (closing) return;
    closing = true;
    end(electron); end(vite); end(e14);
    for (const server of servers) await server.close().catch(() => {});
    // The profile takes a moment to be let go of on Windows.
    for (let attempt = 0; attempt < 20 && existsSync(ROOT); attempt++) {
      try { rmSync(ROOT, { recursive: true, force: true }); } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
    }
    process.exit(code);
  };
  process.once("SIGINT", () => void close(0));
  process.once("SIGTERM", () => void close(0));

  try {
    // Approvals and quiet turns never time out here: the lines stay until someone answers them.
    const fixtureEnv = { ...process.env, OMB_TEST_APPROVAL_CLOCK: "1", OMB_TEST_STALL_CLOCK: "1" };
    const local = await launchVerificationServer({ ...fixtureEnv, OMB_TEST_PORTS: "19900-19939" }, undefined, undefined, undefined, undefined, { scripted: true });
    servers.push(local);
    // The remote place trusts no local browser, so the app's own sign-in (its cookie) is what lets the window in.
    const remote = await launchVerificationServer({ ...fixtureEnv, OMB_TEST_PORTS: "19940-19979", OMB_DEV_TRUST_LOCAL_BROWSER: "0" }, undefined, undefined, undefined, undefined, { scripted: true }, [], undefined, join(REPO, "dist"));
    servers.push(remote);

    const localBots = await seed(local.info.url, local.info.dataDir, PLACES.local, "Maus");
    const remoteBots = await seed(remote.info.url, remote.info.dataDir, PLACES.e14, "Veronica");
    await ask(local.info.url, PLACES.local, localBots);
    await ask(remote.info.url, PLACES.e14, remoteBots);

    const uiPort = await freePort(19980, 19999);
    const ui = `http://127.0.0.1:${uiPort}`;
    vite = spawn(process.execPath, [join(REPO, "node_modules", "vite", "bin", "vite.js"), "--port", String(uiPort), "--strictPort"],
      { cwd: REPO, env: { ...process.env, OMB_UI_PORT: String(uiPort), OMB_PORT: new URL(local.info.url).port }, stdio: ["ignore", "ignore", "ignore"], windowsHide: true });
    await waitFor("this checkout's page", async () => (await fetch(`${ui}/rail`)).ok);

    const code = must(await caller(remote.info.url)("POST", "/api/auth/pairing", { label: "All places prototype" }), "a pairing code").code;
    writeFileSync(join(userData, "environments.json"), JSON.stringify({ version: 2, activeId: "local", environments: [{ id: "e14", kind: "remote", name: "E14", origin: remote.info.url, color: "purple" }] }, null, 2));
    // No global talk shortcut, no analytics and no one-time notices from a test instance. All places itself is left as a
    // new install has it: off.
    writeFileSync(join(userData, "desktop-prefs.json"), JSON.stringify({ seen: ["whats-new-2026-11", "boat-credit-2026-11", "grok-move-2026-11", "modelgo-offer-2026-11"], talkShortcut: false, analytics: false }));

    const ports = [uiPort, Number(new URL(local.info.url).port), Number(new URL(remote.info.url).port)];
    const electronEnv: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OMB_|OPENMAUSBOT_|ELECTRON_RUN_AS_NODE$)/i.test(key)));
    Object.assign(electronEnv, { OMB_PROTO_ROOT: ROOT, OMB_PROTO_USER_DATA: userData, OMB_PROTO_ALLOWED_PORTS: ports.join(","), OMB_DATA_DIR: dataDir, OMB_COMPANION_DIR: companion,
      ELECTRON_START_URL: ui, OMB_PROTO_PAIR: JSON.stringify([{ origin: remote.info.url, code }]) });
    const binary = join(REPO, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
    // --debug-port=N: Chromium's own debugging port on loopback, for a check that drives the window; off unless asked for.
    const debugPort = /^--debug-port=(\d{4,5})$/.exec(process.argv.find((arg) => arg.startsWith("--debug-port=")) ?? "")?.[1];
    electron = spawn(binary, ["-r", join(REPO, "scripts", "proto-all-places", "guard.cjs"), ".", `--user-data-dir=${userData}`, ...(debugPort ? [`--remote-debugging-port=${debugPort}`] : [])],
      { cwd: REPO, env: electronEnv, stdio: ["ignore", "ignore", "ignore"] });
    electron.once("exit", (status) => { if (!closing) { process.stdout.write(`the app closed (${status}); stopping the fixtures\n`); void close(0); } });

    writeFileSync(STATE, JSON.stringify({ supervisor: process.pid, electron: electron.pid, vite: vite.pid, root: ROOT, page: ui, guardLog: join(ROOT, "guard.log"),
      places: { local: { server: local.info.url, pid: local.info.pid, dataDir: local.info.dataDir, log: local.info.logPath, bots: localBots },
        e14: { server: remote.info.url, pid: remote.info.pid, dataDir: remote.info.dataDir, log: remote.info.logPath, bots: remoteBots } } }, null, 2));
    process.stdout.write(`${JSON.stringify({ ok: true, root: ROOT, thisComputer: ui, e14: remote.info.url, electron: electron.pid, stop: "node scripts/proto-all-places/down.mjs" }, null, 2)}\n`);
    // The remote place stopped and started again as one server: the same data folder and port, so the app's sign-in there
    // still holds. Stopped, it is simply gone, as a computer that was turned off.
    const remotePort = Number(new URL(remote.info.url).port);
    const remoteEnv = { ...verificationServerEnvironment({ ...fixtureEnv, OMB_DEV_TRUST_LOCAL_BROWSER: "0" }, remote.info.dataDir, remotePort), OMB_STATIC_DIR: join(REPO, "dist") };
    setInterval(() => {
      if (existsSync(STOP)) return void close(0);
      if (existsSync(E14_STOP)) {
        rmSync(E14_STOP, { force: true });
        end(remote.child); end(e14);
        e14 = null;
        process.stdout.write("E14 stopped\n");
      }
      if (existsSync(E14_START)) {
        rmSync(E14_START, { force: true });
        if (remote.child.exitCode === null && remote.child.signalCode === null) return;
        if (e14 && e14.exitCode === null) return;
        e14 = spawn(process.execPath, verificationServerArgs(remoteEnv), { cwd: REPO, env: remoteEnv, stdio: ["ignore", "ignore", "ignore"], windowsHide: true });
        process.stdout.write("E14 started\n");
      }
    }, 500);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    await close(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const run = process.argv.includes("--seed") ? reseed()
    : process.argv.includes("--e14-stop") ? Promise.resolve(request(E14_STOP, "asked the remote place to stop"))
    : process.argv.includes("--e14-start") ? Promise.resolve(request(E14_START, "asked the remote place to start again"))
    : up();
  run.catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
}
