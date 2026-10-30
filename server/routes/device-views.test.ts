import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import type { RequestAuth } from "../request-auth.ts";
import { createDeviceViewRoutes } from "./device-views.ts";

describe("PATCH a device's view", () => {
  it("reads a body as large as the biggest view pairing accepts", async () => {
    const ids = (prefix: string) => Array.from({ length: 50 }, (_, i) => `${prefix}${String(i).padStart(2, "0")}-${"0".repeat(32)}`);
    const view = { sections: Array.from({ length: 50 }, (_, i) => `Department ${i}`), bots: ids("b"), groups: ids("g") };
    const raw = JSON.stringify({ view });
    let limit = 0;
    const route = createDeviceViewRoutes({
      sessions: { setView: (id, next) => ({ id, view: next }) as never },
      store: { bot: () => ({}) as never, group: () => ({}) as never, sections: view.sections },
      team: false,
    });
    const answers: Array<{ status: number }> = [];
    await route({
      req: {} as IncomingMessage, res: {} as ServerResponse, url: new URL("http://x/api/auth/sessions/s-1"), path: "/api/auth/sessions/s-1", method: "PATCH",
      auth: { kind: "loopback" } as RequestAuth,
      json: ((_res: ServerResponse, status: number) => { answers.push({ status }); }) as never,
      readBody: (async (_req: IncomingMessage, max: number) => { limit = max; return JSON.parse(raw); }) as never,
    });
    expect(limit).toBeGreaterThanOrEqual(Buffer.byteLength(raw));
    expect(answers).toEqual([{ status: 200 }]);
  });
});
