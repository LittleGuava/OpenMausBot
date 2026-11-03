import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigStatus } from "@/state/store";
import { ImageGenerationSettings } from "./ImageGenerationSettings";

const fixture = vi.hoisted(() => ({ config: null as ConfigStatus | null, api: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/state/store", () => ({
  api: fixture.api,
  useStore: () => ({ state: { config: fixture.config }, dispatch: fixture.dispatch }),
}));

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function nodes(value: ReactNode): Node[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const node = child as Node;
    return [node, ...nodes(node.props.children)];
  });
}
function render() {
  let tree: ReactNode = null;
  function Capture() { tree = ImageGenerationSettings(); return tree; }
  const html = renderToStaticMarkup(createElement(Capture));
  const slot = (name: "primary" | "fallback") => nodes(tree).find((node) => node.props.slot === name)!;
  return { html, slot, maxPerTurn: nodes(tree).find((node) => node.props["data-testid"] === "image-gen-max")! };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const imageGen = (value: NonNullable<ConfigStatus["imageGen"]>) => ({ imageGen: value } as ConfigStatus);

beforeEach(() => {
  fixture.api.mockReset().mockResolvedValue({});
  fixture.dispatch.mockReset();
});

describe("Image generation settings", () => {
  it("says nothing is set up and asks for the base key on a fresh install", () => {
    fixture.config = imageGen({ configured: false, primary: { provider: "openai", model: "gpt-image-2", configured: false }, fallback: null, ready: false });
    const { html } = render();
    expect(html).toContain("Not set up");
    expect(html).toContain("Needs a key: add it below.");
    expect(html).toContain("OpenAI API key");
    expect(html).not.toContain("Gemini API key");
  });

  it("names the backup when only the backup can run, and shows a key card for each chosen provider", () => {
    fixture.config = imageGen({
      configured: false, ready: true, xaiConfigured: true,
      primary: { provider: "gemini", model: "gemini-2.5-flash-image", configured: false },
      fallback: { provider: "xai", model: "grok-imagine-image-2.0", configured: true },
    });
    const { html } = render();
    expect(html).toContain("Ready with the backup only · images are made with Grok (xAI)");
    expect(html).toContain("Gemini API key");
    expect(html).toContain("saved under API keys");
  });

  it("offers every provider but the base as the backup, and None", () => {
    fixture.config = imageGen({ configured: true, ready: true, primary: { provider: "openai", model: "gpt-image-2", configured: true }, fallback: null });
    const options = [...render().html.matchAll(/<select[^>]*aria-label="Backup provider"[\s\S]*?<\/select>/g)][0]![0];
    expect([...options.matchAll(/<option value="([^"]*)"/g)].map((match) => match[1])).toEqual(["", "xai", "gemini", "openrouter", "custom"]);
  });

  it("saves a chosen base, a cleared backup and the per-reply limit", async () => {
    fixture.config = imageGen({ configured: true, ready: true, primary: { provider: "openai", model: "gpt-image-2", configured: true }, fallback: { provider: "xai", model: "grok-imagine-image-2.0", configured: true } });
    const view = render();
    (view.slot("primary").props.onProvider as (slot: string, value: string) => void)("primary", "openrouter");
    (view.slot("fallback").props.onProvider as (slot: string, value: string) => void)("fallback", "");
    (view.maxPerTurn.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "2" } });
    await flush();
    expect(fixture.api.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)))).toEqual([
      { imageGen: { primary: { provider: "openrouter" } } },
      { imageGen: { fallback: null } },
      { imageGen: { maxPerTurn: 2 } },
    ]);
  });
});
