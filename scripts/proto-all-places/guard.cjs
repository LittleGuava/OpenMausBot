// Prototype tooling, not product code: loaded with `electron -r` ahead of the app's main, so the development instance
// started for the "All places" prototype cannot touch the installed app or any real server.
//
// It refuses to continue unless Electron's own folders and the data folder are inside the prototype's temporary root,
// and it lets this process open connections only to the loopback ports the launcher lists (the fixture servers and
// their page). In development the main process asks 127.0.0.1:8799 by itself (electron/main.mjs,
// refreshSharedComputersAllowed), which is the installed app's server while that app runs: here that is refused and logged.
const { app, session } = require("electron");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const INSTALLED_PORTS = [8799, 8800, 18799, 28799];
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function refuse(why) {
  process.stderr.write(`[all-places prototype] refusing to start: ${why}\n`);
  app.exit(78);
  process.exit(78);
}

const key = (dir) => path.resolve(dir).replace(/[\\/]+$/, "").toLowerCase();
const inside = (dir, root) => key(dir) === key(root) || key(dir).startsWith(`${key(root)}${path.sep}`);

const root = process.env.OMB_PROTO_ROOT;
if (!root || !fs.existsSync(root)) refuse("OMB_PROTO_ROOT is not an existing folder");
if (!inside(root, os.tmpdir())) refuse(`OMB_PROTO_ROOT must be inside the temporary folder (${os.tmpdir()})`);

const ports = new Set(String(process.env.OMB_PROTO_ALLOWED_PORTS ?? "").split(",").map(Number).filter((port) => Number.isInteger(port) && port > 0));
if (!ports.size) refuse("OMB_PROTO_ALLOWED_PORTS lists no port");
for (const port of INSTALLED_PORTS) if (ports.has(port)) refuse(`port ${port} belongs to the installed app`);

for (const name of ["userData", "sessionData", "logs"]) {
  const dir = app.getPath(name);
  if (!inside(dir, root)) refuse(`Electron's ${name} is ${dir}, outside ${root}; pass --user-data-dir`);
  if (inside(dir, app.getPath("appData"))) refuse(`Electron's ${name} is under ${app.getPath("appData")}`);
}
if (key(app.getPath("userData")) !== key(process.env.OMB_PROTO_USER_DATA ?? "")) refuse("Electron's userData is not OMB_PROTO_USER_DATA");
for (const name of ["OMB_DATA_DIR", "OMB_COMPANION_DIR"]) {
  if (!process.env[name] || !inside(process.env[name], root)) refuse(`${name} must be a folder inside ${root}`);
}
let start;
try { start = new URL(process.env.ELECTRON_START_URL ?? ""); } catch { refuse("ELECTRON_START_URL is not set"); }
if (start.protocol !== "http:" || start.hostname !== "127.0.0.1" || !ports.has(Number(start.port))) refuse("ELECTRON_START_URL must be one of the fixture's loopback ports");

const logFile = path.join(root, "guard.log");
const seen = new Set();
function log(line) {
  if (seen.has(line)) return;
  seen.add(line);
  try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`); } catch {}
}
/** Every request this process is let make to a place's API, for the record of what the prototype asked and when. */
const asked = (side, method, url) => {
  let target;
  try { target = new URL(url); } catch { return; }
  if (!target.pathname.startsWith("/api/")) return;
  try { fs.appendFileSync(path.join(root, "requests.log"), `${new Date().toISOString()} ${side} ${method} ${target.port}${target.pathname}
`); } catch {}
};
log(`guard on: userData=${app.getPath("userData")} dataDir=${process.env.OMB_DATA_DIR} ports=${[...ports].join(",")}`);

// Node's side (fetch, http, tls): every TCP connection starts here.
function targetOf(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === "object") return first.path !== undefined ? { pipe: true } : { host: first.host ?? "localhost", port: Number(first.port) };
  if (typeof first === "string" && !/^\d+$/.test(first)) return { pipe: true };
  return { host: typeof args[1] === "string" ? args[1] : "localhost", port: Number(first) };
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const target = targetOf(args);
  if (target.pipe || (LOOPBACK.has(String(target.host).toLowerCase()) && ports.has(target.port))) return connect.apply(this, args);
  log(`blocked (node) ${target.host}:${target.port}`);
  const error = Object.assign(new Error(`connect ECONNREFUSED ${target.host}:${target.port} (all-places prototype guard)`), { code: "ECONNREFUSED" });
  process.nextTick(() => this.destroy(error));
  return this;
};

const nodeFetch = globalThis.fetch;
globalThis.fetch = function loggedFetch(input, init) {
  asked("node", init?.method ?? "GET", typeof input === "string" ? input : input?.url ?? String(input));
  return nodeFetch.call(this, input, init);
};

// Chromium's side (the window's pages, session.fetch): no name but loopback resolves, and only the listed ports load.
app.commandLine.appendSwitch("host-resolver-rules", "MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost");
function pageAllowed(url) {
  let target;
  try { target = new URL(url); } catch { return false; }
  if (!["http:", "https:", "ws:", "wss:"].includes(target.protocol)) return true;
  const port = Number(target.port || (target.protocol === "https:" || target.protocol === "wss:" ? 443 : 80));
  return LOOPBACK.has(target.hostname.toLowerCase()) && ports.has(port);
}
void app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = pageAllowed(details.url);
    if (allowed) asked("chromium", details.method, details.url);
    if (!allowed) { let where = details.url; try { where = new URL(details.url).origin; } catch {} log(`blocked (chromium) ${where}`); }
    callback({ cancel: !allowed });
  });
  // The launcher's pairing codes, redeemed into this profile's cookie jar as the app's own Connect sheet would.
  let pairs = [];
  try { pairs = JSON.parse(process.env.OMB_PROTO_PAIR ?? "[]"); } catch {}
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    try {
      const response = await session.defaultSession.fetch(`${pair.origin}/api/auth/pair`, { method: "POST", credentials: "include",
        headers: { "content-type": "application/json", origin: pair.origin }, body: JSON.stringify({ code: pair.code, label: "All places prototype", cookie: true }) });
      log(`paired ${pair.origin}: ${response.status}`);
    } catch (error) { log(`pairing ${pair.origin} failed: ${error?.message ?? error}`); }
  }
});
