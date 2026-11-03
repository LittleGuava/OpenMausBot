import { describe, expect, it, vi } from "vitest";

import type { GeneratedImage } from "../image-generation.ts";
import { generateImageForTurn, IMAGE_MESSAGES } from "./image-tools.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const CFG = {
  imageGen: { key: "openai-secret", primary: { provider: "openai" as const }, fallback: { provider: "xai" as const } },
  xai: { key: "xai-secret" },
};

function okFetch(): typeof fetch {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] })));
}

function deps(overrides: Partial<Parameters<typeof generateImageForTurn>[1]> = {}) {
  const attached: GeneratedImage[] = [];
  return {
    attached,
    deps: {
      cfg: CFG,
      fetchImpl: okFetch(),
      imagesThisTurn: () => 0 as number | null,
      stillLive: () => true,
      attach: (image: GeneratedImage) => { attached.push(image); },
      ...overrides,
    },
  };
}

describe("generate_image for a turn", () => {
  it("attaches the base provider's image to the turn and says which provider made it", async () => {
    const { deps: d, attached } = deps();
    const result = await generateImageForTurn({ prompt: "a navy owl" }, d);
    expect(result).toEqual({ status: 201, body: { text: expect.stringContaining("OpenAI (gpt-image-2)") } });
    expect(attached).toEqual([{ bytes: PNG, mime: "image/png" }]);
  });

  it("says so when the backup made the image", async () => {
    const { deps: d } = deps({ cfg: { ...CFG, imageGen: { ...CFG.imageGen, key: "" } } });
    const result = await generateImageForTurn({ prompt: "owl" }, d);
    expect(result.body).toEqual({ text: expect.stringMatching(/xAI .*backup/) });
  });

  it("uses the provider the person named when it is their backup", async () => {
    const fetchImpl = okFetch();
    const { deps: d } = deps({ fetchImpl });
    await generateImageForTurn({ prompt: "owl", provider: "xai" }, d);
    expect(String(vi.mocked(fetchImpl).mock.calls[0]![0])).toContain("api.x.ai");
  });

  it("refuses a provider that is neither the base nor the backup, naming the ones set", async () => {
    const { deps: d, attached } = deps();
    const result = await generateImageForTurn({ prompt: "owl", provider: "gemini" }, d);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: expect.stringMatching(/Gemini.*base is OpenAI.*backup is xAI/) });
    expect(attached).toEqual([]);
  });

  it("points the person to Settings when nothing is set up", async () => {
    const { deps: d } = deps({ cfg: { imageGen: {} } });
    const result = await generateImageForTurn({ prompt: "owl" }, d);
    expect(result).toEqual({ status: 409, body: { error: IMAGE_MESSAGES.notSetUp } });
  });

  it("stops at the turn's image limit without calling a provider", async () => {
    const fetchImpl = okFetch();
    const { deps: d } = deps({ fetchImpl, cfg: { ...CFG, imageGen: { ...CFG.imageGen, maxPerTurn: 2 } }, imagesThisTurn: () => 2 });
    const result = await generateImageForTurn({ prompt: "owl" }, d);
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: expect.stringContaining("2 images") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses when no turn is running, and drops an image whose turn ended meanwhile", async () => {
    const idle = deps({ imagesThisTurn: () => null });
    expect((await generateImageForTurn({ prompt: "owl" }, idle.deps)).status).toBe(409);

    const ended = deps({ stillLive: () => false });
    expect((await generateImageForTurn({ prompt: "owl" }, ended.deps)).status).toBe(409);
    expect(ended.attached).toEqual([]);
  });

  it.each([{}, { prompt: " " }, { prompt: "x".repeat(4001) }, { prompt: "owl", aspect: "4:3" }])("rejects a malformed call: %j", async (body) => {
    const { deps: d } = deps();
    expect((await generateImageForTurn(body, d)).status).toBe(400);
  });

  it("returns the provider's redacted error, not its body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("Bearer openai-secret", { status: 500 }));
    const { deps: d } = deps({ fetchImpl });
    const result = await generateImageForTurn({ prompt: "owl" }, d);
    expect(result).toEqual({ status: 502, body: { error: "OpenAI image generation failed (HTTP 500)" } });
  });
});
