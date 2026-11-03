// The internal call behind the agents server's generate_image tool. Runs inside index.ts's /api/internal/ block, after the
// capability bearer is checked; the turn is the capability's, never a body field. The image is attached to that turn's
// reply like a voice note, so it reaches the chat the same way on every engine.
import { z } from "zod";

import { IMAGE_MAX_PER_TURN_DEFAULT, IMAGE_PROVIDERS } from "../../shared/image-generation.ts";
import { IMAGE_PROMPT_MAX_CHARS } from "../drivers/agents-image-tools.ts";
import {
  generateImage, imageGenerationReady, imageProviderName, imageSlots,
  type GeneratedImage, type ImageCredentials,
} from "../image-generation.ts";

export const IMAGE_MESSAGES = {
  notSetUp: "Image generation isn't set up on this computer. Ask the person to choose an image provider in Settings → AI → Image generation (shown in advanced mode).",
  noTurn: "This turn has not started yet or already ended, so the image could not be attached.",
} as const;

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(IMAGE_PROMPT_MAX_CHARS),
  aspect: z.enum(["1:1", "16:9", "9:16"]).optional(),
  provider: z.enum(IMAGE_PROVIDERS).optional(),
});

export interface ImageToolDeps {
  cfg: ImageCredentials;
  fetchImpl?: typeof fetch;
  /** Images already attached to the running turn; null when no turn is running. */
  imagesThisTurn: () => number | null;
  /** Re-checked after generation, so an image never parks onto a later turn. */
  stillLive: () => boolean;
  attach: (image: GeneratedImage) => void;
}

type Outcome = { status: number; body: { text: string } | { error: string } };

export async function generateImageForTurn(raw: unknown, deps: ImageToolDeps): Promise<Outcome> {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 400, body: { error: `generate_image takes a prompt (1 to ${IMAGE_PROMPT_MAX_CHARS} characters), an optional aspect (1:1, 16:9 or 9:16) and an optional provider.` } };
  }
  const { prompt, aspect, provider } = parsed.data;
  const soFar = deps.imagesThisTurn();
  if (soFar === null) return { status: 409, body: { error: IMAGE_MESSAGES.noTurn } };
  const limit = deps.cfg.imageGen?.maxPerTurn ?? IMAGE_MAX_PER_TURN_DEFAULT;
  if (soFar >= limit) {
    return { status: 429, body: { error: `This turn already has ${limit} images, the most the person allows per reply. Send what you have.` } };
  }

  const { primary, fallback } = imageSlots(deps.cfg);
  let slot: "primary" | "fallback" | undefined;
  if (provider) {
    slot = primary.provider === provider ? "primary" : fallback?.provider === provider ? "fallback" : undefined;
    if (!slot) {
      const set = `the base is ${imageProviderName(primary.provider)}${fallback ? ` and the backup is ${imageProviderName(fallback.provider)}` : " and there is no backup"}`;
      return { status: 400, body: { error: `${imageProviderName(provider)} is not one of the person's image providers: ${set}. Use one of those, or ask the person to change it in Settings.` } };
    }
  } else if (!imageGenerationReady(deps.cfg)) {
    return { status: 409, body: { error: IMAGE_MESSAGES.notSetUp } };
  }

  try {
    const image = await generateImage(deps.cfg, { prompt, aspect }, { slot, fetchImpl: deps.fetchImpl });
    if (!deps.stillLive()) return { status: 409, body: { error: IMAGE_MESSAGES.noTurn } };
    deps.attach({ bytes: image.bytes, mime: image.mime });
    const by = `${imageProviderName(image.provider)} (${image.model})${image.usedFallback ? ", the person's backup image provider" : ""}`;
    return { status: 201, body: { text: `Image made by ${by}. It will be attached to this turn's reply when the turn ends.` } };
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    return { status: typeof status === "number" ? status : 502, body: { error: error instanceof Error ? error.message : "The image was not generated." } };
  }
}
