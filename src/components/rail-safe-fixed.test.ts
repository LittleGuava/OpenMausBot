// The desktop rail of places is its own view over the window's left 36px. The page makes room with `padding-left` on
// <html> (electron/preload.cjs sets it and `--rail-beside`), which fixed elements ignore. So a card or toast pinned to
// the left edge must add `--rail-beside` itself, or the rail covers its left side.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (name.endsWith(".tsx") && !/\.test\./.test(name)) yield path;
  }
}

/** The classes of a fixed element that pin it to the left edge, under any variant (`max-md:inset-x-4` too): `left-<n>`,
 * `left-[…]`, `inset-x-<n>` or `start-<n>`, but not centred (`left-1/2`). Each one must make room for the rail itself,
 * since a variant's `left` replaces the base one at its width. */
const leftPins = (classes: string) => /(^|\s)fixed(\s|$)/.test(classes)
  ? classes.split(/\s+/).filter((token) => /^([\w-]+:)*(left-(\d|\[)|inset-x-(\d|\[)|start-(\d|\[))/.test(token) && !/(^|:)left-1\/2$/.test(token))
  : [];

describe("fixed elements and the desktop rail", () => {
  it("make room for the rail when they are pinned to the left edge", () => {
    const offending: string[] = [];
    for (const path of sources(SRC)) {
      for (const [, classes] of readFileSync(path, "utf8").matchAll(/"([^"\n]*\bfixed\b[^"\n]*)"/g)) {
        for (const pin of leftPins(classes)) if (!pin.includes("--rail-beside")) offending.push(`${relative(SRC, path)}: ${pin}`);
      }
    }
    expect(offending).toEqual([]);
  });
});
