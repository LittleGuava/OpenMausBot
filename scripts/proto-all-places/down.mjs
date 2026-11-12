// Prototype tooling, not product code: stops the "All places" prototype that up.ts started and removes its temporary
// data. It asks the launcher to close what it owns (the app, the page server and both fixture servers); only if the
// launcher is gone does it end the recorded processes itself, each by its exact pid and never by name.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const ROOT = join(tmpdir(), "omb-all-places-proto");
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const end = (pid) => {
  if (!Number.isInteger(pid) || !alive(pid)) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else { try { process.kill(pid, "SIGTERM"); } catch {} }
};
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
/** Only a fixture's own folder in the temp directory is ever removed. */
const fixtureDir = (dir) => typeof dir === "string" && resolve(dir).startsWith(`${resolve(tmpdir())}${sep}openmausbot-verify-data-`);

let state = null;
try { state = JSON.parse(readFileSync(join(ROOT, "state.json"), "utf8")); } catch {}
if (!state) {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true });
  console.log("nothing to stop");
  process.exit(0);
}

if (alive(state.supervisor)) {
  writeFileSync(join(ROOT, "stop"), "");
  for (let waited = 0; waited < 20_000 && alive(state.supervisor); waited += 250) await wait(250);
}
if (alive(state.supervisor)) end(state.supervisor);
for (const pid of [state.electron, state.vite, state.places?.local?.pid, state.places?.e14?.pid]) end(pid);
await wait(500);
for (const dir of [state.places?.local?.dataDir, state.places?.e14?.dataDir]) if (fixtureDir(dir)) rmSync(dir, { recursive: true, force: true });
for (let attempt = 0; attempt < 20 && existsSync(ROOT); attempt++) {
  try { rmSync(ROOT, { recursive: true, force: true }); } catch { await wait(250); }
}
console.log(existsSync(ROOT) ? `stopped; could not remove ${ROOT}` : "stopped; temporary data removed");
