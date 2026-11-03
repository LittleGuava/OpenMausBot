import { IMAGE_MODEL_CHOICES } from "../../shared/image-generation.ts";
import { createOpenRouterModelCatalog } from "../decider/openrouter-models.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createImageSettingsRoutes(deps: { fetch?: typeof fetch } = {}): RouteHandler {
  const models = createOpenRouterModelCatalog({ fetch: deps.fetch, output: "image", curated: IMAGE_MODEL_CHOICES.openrouter });
  return async ({ res, path, method, json }) => {
    if (path !== "/api/images/openrouter-models" || method !== "GET") return PASS;
    res.setHeader("cache-control", "no-store");
    return json(res, 200, await models.load());
  };
}
