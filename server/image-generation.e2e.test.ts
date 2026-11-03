// The image provider is a loopback Images API stub, so no external service is reached.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { request } from "../scripts/mcp-server.ts";
import { startFakeImageApi } from "./testing/fake-image-api.ts";

async function withImageFixture(test: (f: any) => Promise<void>) {
  const session = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
  const cli = (...args: string[]) => runControlOmb(args, { env: { OPENMAUSBOT_URL: session.info.url } }) as Promise<any>;
  const api = (path: string, body?: unknown, method = "POST") =>
    request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, session.info.url) as Promise<any>;
  const images = await startFakeImageApi();
  const dataDir = session.info.dataDir;
  const planPath = join(dataDir, "room-plan.json");
  try {
    await test({
      cli,
      api,
      images,
      savePlan: (plan: Record<string, unknown>) => writeFileSync(planPath, JSON.stringify(plan)),
      evidence: () => existsSync(planPath + ".evidence.jsonl")
        ? readFileSync(planPath + ".evidence.jsonl", "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
        : [],
      messages: async (threadId: string) => (await api("/api/threads/" + threadId + "/messages")).messages,
      savedImages: () => {
        const dir = join(dataDir, "attachments");
        return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".png")) : [];
      },
    });
  } finally {
    await images.stop();
    await session.close();
  }
}

it("falls back from a keyless base to the backup and attaches the image to the settling reply", async () => withImageFixture(async (f) => {
  await f.api("/api/config", { imageGen: { primary: { provider: "openai" }, fallback: { provider: "custom", model: "fixture-image" }, customUrl: f.images.url } }, "PUT");
  const bot = (await f.cli("new-bot", "--name", "Image bot")).bot;
  f.savePlan({
    [bot.id]: {
      steps: [{ tool: "generate_image", arguments: { prompt: "a navy owl with a brass compass", aspect: "16:9" } }],
      reply: "Here is your owl.",
    },
  });
  await f.cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Make an image of a navy owl.");
  expect((await f.cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("settled");

  const turn = f.evidence().find((entry: any) => entry.botId === bot.id);
  expect(turn.evidence[0].result.tools.map((tool: any) => tool.name)).toContain("generate_image");
  const step = turn.evidence.find((entry: any) => entry.step);
  expect(step.response.result.isError).toBeFalsy();
  expect(step.response.result.content[0].text).toContain("backup image provider");

  expect(f.images.requests).toEqual([
    { model: "fixture-image", prompt: "a navy owl with a brass compass", response_format: "b64_json", size: "1536x1024", n: 1 },
  ]);

  const withImage = (await f.messages(bot.activeTaskId)).filter((m: any) => (m.attachments ?? []).some((a: any) => a.kind === "image"));
  expect(withImage).toHaveLength(1);
  expect(withImage[0].role).toBe("bot");
  expect(withImage[0].text).toBe("Here is your owl.");
  const image = withImage[0].attachments.find((a: any) => a.kind === "image");
  expect(image.mime).toBe("image/png");
  const files = f.savedImages();
  expect(files).toHaveLength(1);
  expect(image.path.endsWith(files[0])).toBe(true);
}), 60_000);

it("hides generate_image from a bot when no image provider is set up", async () => withImageFixture(async (f) => {
  const bot = (await f.cli("new-bot", "--name", "No image bot")).bot;
  f.savePlan({ [bot.id]: { steps: [], reply: "No images here." } });
  await f.cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Make an image.");
  expect((await f.cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("settled");
  const turn = f.evidence().find((entry: any) => entry.botId === bot.id);
  expect(turn.evidence[0].result.tools.map((tool: any) => tool.name)).not.toContain("generate_image");
  expect(f.images.requests).toEqual([]);
}), 60_000);
