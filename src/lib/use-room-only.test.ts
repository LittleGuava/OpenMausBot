// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: Root | null = null;
let seen: boolean[] = [];

beforeEach(() => {
  vi.resetModules();
  seen = [];
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  Probe = null;
  vi.unstubAllGlobals();
});

const session = (view?: unknown) => new Response(JSON.stringify({ kind: "session", id: "s1", label: "phone", scopes: ["client"], expiresAt: 0, ...(view ? { view } : {}) }), { status: 200 });

let Probe: ((props: { connected: boolean }) => null) | null = null;

async function render(connected: boolean) {
  if (!Probe) {
    const { useRoomOnly } = await import("./use-room-only");
    Probe = ({ connected }) => {
      seen.push(useRoomOnly(connected));
      return null;
    };
  }
  root ??= createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe!, { connected })));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("useRoomOnly", () => {
  it("reads the device's view again each time the live stream connects", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(session({ group: "room-1" }))
      .mockResolvedValueOnce(session());
    vi.stubGlobal("fetch", fetch);

    await render(true);
    expect(seen.at(-1)).toBe(false);
    await render(false);
    await render(true);
    expect(seen.at(-1)).toBe(true);
    await render(false);
    await render(true);
    expect(seen.at(-1)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("keeps what it knew when the server cannot be reached", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(session({ group: "room-1" }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);

    await render(true);
    await render(false);
    await render(true);
    expect(seen.at(-1)).toBe(true);
  });
});
