import { parseDeviceView, type DeviceView } from "../../shared/device-view.ts";
import type { SessionRegistry } from "../sessions.ts";
import type { Store } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface DeviceViewRouteDeps {
  sessions: Pick<SessionRegistry, "setView">;
  store: Pick<Store, "bot" | "group" | "sections">;
  team: boolean;
}

export const TEAM_VIEW_REFUSAL = "Device views are not available on a Team Cloud: each person's devices see what that person may.";

export function checkedDeviceView(value: unknown, store: DeviceViewRouteDeps["store"]): { ok: true; view: DeviceView | null } | { ok: false; error: string } {
  const parsed = parseDeviceView(value);
  if (!parsed.ok || !parsed.view) return parsed;
  const view = parsed.view;
  if ("bot" in view && !store.bot(view.bot)) return { ok: false, error: "no such bot" };
  if ("group" in view && !store.group(view.group)) return { ok: false, error: "no such channel" };
  if ("section" in view && view.section !== "" && !store.sections.some((section) => section.trim() === view.section)) {
    return { ok: false, error: "no such department" };
  }
  return parsed;
}

/** PATCH /api/auth/sessions/:id { view }: limits a paired device, or lifts its limit with null. Admin only; a session cannot
 * limit itself, so an admin cannot lock their own browser out mid-change. */
export function createDeviceViewRoutes(deps: DeviceViewRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = /^\/api\/auth\/sessions\/([\w-]+)$/.exec(path);
    if (!m || method !== "PATCH") return PASS;
    const body = await readBody(req, 4096);
    if (!body || typeof body !== "object" || Array.isArray(body) || !("view" in body) || Object.keys(body).length !== 1) {
      return json(res, 400, { error: "send { view }" });
    }
    if (deps.team) return json(res, 409, { error: TEAM_VIEW_REFUSAL });
    if (auth.kind === "session" && auth.session.id === m[1]) return json(res, 409, { error: "Change this device's view from another device." });
    const checked = checkedDeviceView((body as { view: unknown }).view, deps.store);
    if (!checked.ok) return json(res, 400, { error: checked.error });
    const session = deps.sessions.setView(m[1]!, checked.view);
    return session ? json(res, 200, { session }) : json(res, 404, { error: "no such session" });
  };
}
