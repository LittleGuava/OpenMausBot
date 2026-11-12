// Prototype tooling, not product code: stops the "All places" prototype that up.ts started and removes its temporary
// data. It asks the launcher to close what it owns (the app, the page server and both fixture servers); only if the
// launcher is gone does it end the recorded processes itself, each by its exact pid and never by name.
//
// A pid is reused once its process ends, so a record left behind (the launcher was killed, the computer restarted) may
// name someone else's process by now. One is ended only while its command line still shows it is the prototype's own.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, uptime } from "node:os";
import { join, resolve, sep } from "node:path";

const ROOT = join(tmpdir(), "omb-all-places-proto");
const STATE = join(ROOT, "state.json");
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
/** Only a fixture's own folder in the temp directory is ever removed. */
const fixtureDir = (dir) => typeof dir === "string" && resolve(dir).startsWith(`${resolve(tmpdir())}${sep}openmausbot-verify-data-`);

/** The command line a pid runs now, or "" when it cannot be read. */
function commandLine(pid) {
  if (process.platform === "win32") {
    const powershell = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const asked = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
    return asked.status === 0 ? asked.stdout.trim() : "";
  }
  const asked = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 5_000 });
  return asked.status === 0 ? asked.stdout.trim() : "";
}
const sameText = (text) => text.replaceAll("\\", "/").toLowerCase();
/** Ends a recorded process and its children, only while it is still the one that was recorded. */
function end(pid, marks) {
  if (!Number.isInteger(pid) || !alive(pid)) return;
  const running = sameText(commandLine(pid));
  if (!marks.every((mark) => running.includes(sameText(mark)))) { console.log(`left process ${pid} alone: it is not the prototype's any more`); return; }
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else { try { process.kill(pid, "SIGTERM"); } catch {} }
}

let state = null;
try { state = JSON.parse(readFileSync(STATE, "utf8")); } catch {}
if (!state) {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true });
  console.log("nothing to stop");
  process.exit(0);
}

// A record from before this computer started names no process of today's.
const fromThisBoot = statSync(STATE).mtimeMs >= Date.now() - uptime() * 1000;
if (fromThisBoot) {
  const launcher = ["proto-all-places", "up.ts"];
  if (alive(state.supervisor) && launcher.every((mark) => sameText(commandLine(state.supervisor)).includes(mark))) {
    writeFileSync(join(ROOT, "stop"), "");
    for (let waited = 0; waited < 20_000 && alive(state.supervisor); waited += 250) await wait(250);
  }
  end(state.supervisor, launcher);
  end(state.electron, ["electron", "omb-all-places-proto"]);
  end(state.vite, ["vite"]);
  for (const place of [state.places?.local, state.places?.e14]) end(place?.pid, ["server/index.ts"]);
  await wait(500);
}
for (const dir of [state.places?.local?.dataDir, state.places?.e14?.dataDir]) if (fixtureDir(dir)) rmSync(dir, { recursive: true, force: true });
for (let attempt = 0; attempt < 20 && existsSync(ROOT); attempt++) {
  try { rmSync(ROOT, { recursive: true, force: true }); } catch { await wait(250); }
}
console.log(existsSync(ROOT) ? `stopped; could not remove ${ROOT}` : "stopped; temporary data removed");
