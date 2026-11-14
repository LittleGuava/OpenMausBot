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

/** The classes that pin an element to the left edge, under any variant (`max-md:inset-x-4` too) and `!`: `left-<n>`,
 * `left-[…]`, `inset-x-<n>` or `start-<n>`, but not centred (`left-1/2`). Each one must make room for the rail itself,
 * since a variant's `left` replaces the base one at its width. */
const leftPins = (classes: string) => classes.split(/\s+/)
  .filter((token) => /^([\w-]+:)*!?(left-(\d|\[)|inset-x-(\d|\[)|start-(\d|\[))/.test(token) && !/(^|:)!?left-1\/2$/.test(token));

/** The class lists of fixed elements in a file: a literal that says `fixed`, and every literal on a line that adds to a
 * shared corner position (`cn(CORNER_SPOT, "…")`, `` `${CORNER_CARD} …` ``). */
function* fixedClassLists(source: string): Generator<string> {
  for (const line of source.split("\n")) {
    const composed = /\bCORNER_[A-Z]+\b/.test(line);
    for (const [, , classes] of line.matchAll(/(["'`])([^"'`]*)\1/g)) {
      if (composed || /(^|\s)fixed(\s|$)/.test(classes)) yield classes;
    }
  }
}

describe("fixed elements and the desktop rail", () => {
  it("make room for the rail when they are pinned to the left edge", () => {
    const offending: string[] = [];
    for (const path of sources(SRC)) {
      for (const classes of fixedClassLists(readFileSync(path, "utf8"))) {
        for (const pin of leftPins(classes)) if (!pin.includes("--rail-beside")) offending.push(`${relative(SRC, path)}: ${pin}`);
      }
    }
    expect(offending).toEqual([]);
  });

  it("sees a left pin added to a shared corner position, and one marked important", () => {
    const pins = (source: string) => [...fixedClassLists(source)].flatMap(leftPins);
    expect(pins('className={cn(CORNER_SPOT, "z-[60] max-md:inset-x-4")}')).toEqual(["max-md:inset-x-4"]);
    expect(pins("className={`${CORNER_CARD} left-4`}")).toEqual(["left-4"]);
    expect(pins('className="fixed !left-4"')).toEqual(["!left-4"]);
    expect(pins('className="fixed left-1/2 -translate-x-1/2"')).toEqual([]);
  });
});
