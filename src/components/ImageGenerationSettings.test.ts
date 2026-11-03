// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigStatus } from "@/state/store";

const fixture = vi.hoisted(() => ({ config: null as ConfigStatus | null, api: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/state/store", () => ({
  api: fixture.api,
  useStore: () => ({ state: { config: fixture.config }, dispatch: fixture.dispatch }),
}));
const { ImageGenerationSettings } = await import("./ImageGenerationSettings");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLElement;

async function mount(config: NonNullable<ConfigStatus["imageGen"]>) {
  fixture.config = { imageGen: config } as ConfigStatus;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(ImageGenerationSettings)); });
  return container;
}

async function choose(label: string, value: string) {
  const select = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function type(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

const sentPatches = () => fixture.api.mock.calls.map(([path, init]) => [path, JSON.parse(String((init as RequestInit).body))]);

beforeEach(() => {
  fixture.api.mockReset().mockResolvedValue({});
  fixture.dispatch.mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

describe("Image generation settings", () => {
  it("says nothing is set up and asks for the base key on a fresh install", async () => {
    const view = await mount({ configured: false, primary: { provider: "openai", model: "gpt-image-2", configured: false }, fallback: null, ready: false });
    expect(view.textContent).toContain("Not set up");
    expect(view.textContent).toContain("Needs a key: add it below.");
    expect(view.querySelector('input[aria-label="OpenAI API key"]')).not.toBeNull();
    expect(view.querySelector('input[aria-label="Gemini API key"]')).toBeNull();
  });

  it("names the backup when only the backup can run, and shows a key field for each chosen provider", async () => {
    const view = await mount({
      configured: false, ready: true, xaiConfigured: true,
      primary: { provider: "gemini", model: "gemini-2.5-flash-image", configured: false },
      fallback: { provider: "xai", model: "grok-imagine-image-2.0", configured: true },
    });
    expect(view.textContent).toContain("Ready with the backup only · images are made with Grok (xAI)");
    expect(view.querySelector('input[aria-label="Gemini API key"]')).not.toBeNull();
    expect(view.querySelector('input[aria-label="Grok (xAI) API key"]')).not.toBeNull();
    expect(view.textContent).toContain("also used");
  });

  it("offers every provider but the base as the backup, and None", async () => {
    const view = await mount({ configured: true, ready: true, primary: { provider: "openai", model: "gpt-image-2", configured: true }, fallback: null });
    const options = [...view.querySelectorAll<HTMLOptionElement>('select[aria-label="Backup provider"] option')].map((option) => option.value);
    expect(options).toEqual(["", "xai", "gemini", "openrouter", "custom"]);
  });

  it("saves a chosen base, a cleared backup and the per-reply limit", async () => {
    await mount({ configured: true, ready: true, primary: { provider: "openai", model: "gpt-image-2", configured: true }, fallback: { provider: "xai", model: "grok-imagine-image-2.0", configured: true } });
    await choose("Base provider", "openrouter");
    await choose("Backup provider", "");
    await choose("Images per reply", "2");
    expect(sentPatches()).toEqual([
      ["/api/config", { imageGen: { primary: { provider: "openrouter" } } }],
      ["/api/config", { imageGen: { fallback: null } }],
      ["/api/config", { imageGen: { maxPerTurn: 2 } }],
    ]);
  });

  it("drops the backup when the base becomes the backup's provider, so no hidden backup is kept", async () => {
    await mount({ configured: true, ready: true, primary: { provider: "openai", model: "gpt-image-2", configured: true }, fallback: { provider: "xai", model: "grok-imagine-image-2.0", configured: true } });
    await choose("Base provider", "xai");
    expect(sentPatches()).toEqual([["/api/config", { imageGen: { primary: { provider: "xai" }, fallback: null } }]]);
  });

  it("takes the OpenRouter key on this page and saves it as the shared OpenRouter key", async () => {
    await mount({ configured: false, ready: false, primary: { provider: "openrouter", model: "google/gemini-2.5-flash-image", configured: false }, fallback: null });
    const input = await type("OpenRouter API key", "or-new-key");
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(sentPatches()).toEqual([["/api/config", { openrouter: { key: "or-new-key" } }]]);
  });
});
