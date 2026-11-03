import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { IMAGE_DEFAULT_MODELS, IMAGE_MODEL_CHOICES } from "../../shared/image-generation.ts";
import { readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createImageSettingsRoutes } from "./image-settings.ts";
import { PASS } from "./table.ts";

const entry = (id: string, outputs: string[]) => ({ id, name: `Name of ${id}`, architecture: { output_modalities: outputs } });
const listSchema = z.object({ source: z.string(), models: z.array(z.object({ id: z.string(), group: z.string() })) });
const catalog = (...models: unknown[]) => new Response(JSON.stringify({ data: models }), { status: 200 });

async function get(route: ReturnType<typeof createImageSettingsRoutes>, path = "/api/images/openrouter-models", method = "GET") {
  const req = new IncomingMessage(new Socket());
  const res = new ServerResponse(req);
  let answer: { status: number; body: unknown } | null = null;
  const out = await route({
    req, res, url: new URL(`http://localhost${path}`), path, method, readBody,
    auth: { kind: "loopback", scopes: ["admin"] } as RequestAuth,
    json: (_res, status, body) => { answer = { status, body }; },
  });
  const { status, body } = answer ?? { status: undefined, body: undefined };
  return { out, status, body: body === undefined ? undefined : listSchema.parse(body) };
}

describe("the OpenRouter image model list in Settings", () => {
  it("asks OpenRouter for image models only and lists the curated ones first, then the rest", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => catalog(
      entry("acme/painter-9", ["image"]),
      entry(IMAGE_DEFAULT_MODELS.openrouter, ["image", "text"]),
      entry("openrouter/auto", ["text", "image"]),
      entry("acme/chatty", ["text"]),
    ));
    const { status, body } = await get(createImageSettingsRoutes({ fetch: fetchImpl }));
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://openrouter.ai/api/v1/models?output_modalities=image");
    expect(status).toBe(200);
    expect(body!.source).toBe("openrouter");
    expect(body!.models.map((m) => [m.group, m.id])).toEqual([
      ["recommended", IMAGE_DEFAULT_MODELS.openrouter],
      ["more", "acme/painter-9"],
    ]);
  });

  it("falls back to the curated list, default first, when OpenRouter cannot be reached", async () => {
    const { body } = await get(createImageSettingsRoutes({ fetch: async () => { throw new TypeError("offline"); } }));
    expect(body!.source).toBe("builtin");
    expect(body!.models.map((m) => m.id)).toEqual(IMAGE_MODEL_CHOICES.openrouter.map((m) => m.id));
    expect(body!.models[0]!.id).toBe(IMAGE_DEFAULT_MODELS.openrouter);
  });

  it("leaves other requests to the next route", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const route = createImageSettingsRoutes({ fetch: fetchImpl });
    expect((await get(route, "/api/images/openrouter-models", "POST")).out).toBe(PASS);
    expect((await get(route, "/api/decider/models")).out).toBe(PASS);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
