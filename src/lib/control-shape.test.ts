import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTROL_SHAPES, DEFAULT_CONTROL_SHAPE, applyControlShape, readControlShape } from "./control-shape";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles.css"), "utf8");

/** The rule that squares the controls, outside any `@layer` so it beats the skins' pills and `rounded-full`. */
function squaredRule(): string {
  let depth = 0;
  for (const [index, char] of [...css].entries()) {
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (depth === 0 && css.startsWith(':root[data-controls="squared"] :is(', index)) {
      return css.slice(index, css.indexOf("}", index) + 1);
    }
  }
  return "";
}

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

  it("squares buttons in a rule outside every layer, and never a switch", () => {
    const rule = squaredRule();
    expect(rule).toMatch(/\.ui-button\b/);
    expect(rule).toMatch(/\.ui-icon-button\b/);
    expect(rule).toMatch(/button\.rounded-full/);
    expect(rule).toMatch(/:not\([^)]*\[role="switch"\]/);
    expect(rule).toMatch(/border-radius:\s*var\(--control-radius/);
  });
});
