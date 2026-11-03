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

function deps(overrides: { cfg?: Parameters<typeof generateImageForTurn>[1]["cfg"]; fetchImpl?: typeof fetch; parked?: number; live?: boolean; noTurn?: boolean } = {}) {
  const attached: GeneratedImage[] = [];
  const live = overrides.live ?? true;
  return {
    attached,
    deps: {
      cfg: overrides.cfg ?? CFG,
      fetchImpl: overrides.fetchImpl ?? okFetch(),
      inFlight: new Map<string, number>(),
      turn: overrides.noTurn ? null : {
        key: "thread:turn",
        parked: () => (overrides.parked ?? 0) + attached.length,
        attach: (image: GeneratedImage) => { if (live) attached.push(image); return live; },
      },
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
    const { deps: d } = deps({ fetchImpl, cfg: { ...CFG, imageGen: { ...CFG.imageGen, maxPerTurn: 2 } }, parked: 2 });
    const result = await generateImageForTurn({ prompt: "owl" }, d);
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: expect.stringContaining("2 images") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("counts an image still being made, so parallel calls cannot pass the limit", async () => {
    let finish!: () => void;
    const started = new Promise<void>((resolve) => { finish = resolve; });
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      await started;
      return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] }));
    });
    const { deps: d, attached } = deps({ fetchImpl, cfg: { ...CFG, imageGen: { ...CFG.imageGen, maxPerTurn: 1 } } });
    const first = generateImageForTurn({ prompt: "owl" }, d);
    const second = generateImageForTurn({ prompt: "fox" }, d);
    await new Promise((resolve) => setTimeout(resolve, 0));
    finish();
    expect((await Promise.all([first, second])).map((result) => result.status)).toEqual([201, 429]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(attached).toHaveLength(1);
  });

  it("frees the slot of an image that failed, so the next call can still make one", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] })));
    const { deps: d, attached } = deps({ fetchImpl, cfg: { ...CFG, imageGen: { ...CFG.imageGen, maxPerTurn: 1 } } });
    expect((await generateImageForTurn({ prompt: "owl" }, d)).status).toBe(502);
    expect((await generateImageForTurn({ prompt: "owl" }, d)).status).toBe(201);
    expect(attached).toHaveLength(1);
  });

  it("refuses when no turn is running, and drops an image whose turn ended meanwhile", async () => {
    const idle = deps({ noTurn: true });
    expect((await generateImageForTurn({ prompt: "owl" }, idle.deps)).status).toBe(409);

    const ended = deps({ live: false });
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
