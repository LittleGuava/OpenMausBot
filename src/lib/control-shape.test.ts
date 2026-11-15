import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTROL_SHAPES, DEFAULT_CONTROL_SHAPE, applyControlShape, readControlShape } from "./control-shape";

describe("control shape", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    vi.stubGlobal("document", { documentElement: { dataset: {} as DOMStringMap } });
  });

  it("is round unless the person picks squared", () => {
    expect(CONTROL_SHAPES).toEqual(["round", "squared"]);
    expect(DEFAULT_CONTROL_SHAPE).toBe("round");
    expect(readControlShape()).toBe("round");
  });

  it("stamps squared on the page and remembers it", () => {
    applyControlShape("squared");
    expect(document.documentElement.dataset.controls).toBe("squared");
    expect(readControlShape()).toBe("squared");
  });

  it("clears the attribute for round", () => {
    applyControlShape("squared");
    applyControlShape("round");
    expect(document.documentElement.dataset.controls).toBeUndefined();
    expect(readControlShape()).toBe("round");
  });

  it("falls back to round for an unknown stored value", () => {
    localStorage.setItem("omb-controls", "hexagon");
    expect(readControlShape()).toBe("round");
  });
});
