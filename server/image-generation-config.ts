import { z } from "zod";
import { IMAGE_PROVIDERS, normalizeImageGenerationUrl, type ImageGenerationConfig } from "../shared/image-generation.ts";

const imageModelIdSchema = z.string().trim().max(200).refine(
  (value) => !["\r", "\n", "\0"].some((character) => value.includes(character)),
  "Use a model ID without control characters",
);
const imageSlotSchema = z.object({ provider: z.enum(IMAGE_PROVIDERS), model: imageModelIdSchema.optional() }).strict();
export const imageGenConfigSchema = z.object({
  primary: imageSlotSchema.optional(),
  fallback: imageSlotSchema.optional(),
  maxPerTurn: z.number().int().min(1).max(10).optional(),
  provider: z.enum(["openai", "xai", "custom"]).optional(),
  key: z.string().optional(),
  geminiKey: z.string().optional(),
  customApiKey: z.string().optional(),
  customUrl: z.string().trim().max(2048).transform((value, ctx) => {
    if (!value) return "";
    try { return normalizeImageGenerationUrl(value); } catch (error) {
      ctx.addIssue({ code: "custom", message: (error as Error).message });
      return z.NEVER;
    }
  }).optional(),
  customModel: imageModelIdSchema.optional(),
});
export const imageGenPatchSchema = imageGenConfigSchema.extend({ fallback: imageSlotSchema.nullable().optional() });

export type ImageGenCredentialPatch = Pick<ImageGenerationConfig, "key" | "customApiKey" | "geminiKey">;
