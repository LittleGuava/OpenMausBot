// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles.css"), "utf8");
const section = css.slice(css.indexOf("CONTROL SHAPE"), css.indexOf("\nbody {"));

/** The corner a person sees on the element `selector` picks out of `markup`, with Squared on. */
function corner(markup: string, selector: string): string {
  document.body.innerHTML = markup;
  return getComputedStyle(document.querySelector(selector)!).borderTopLeftRadius;
}

describe("the squared button shape on a page", () => {
  beforeEach(() => {
    const style = document.createElement("style");
    style.textContent = `.rounded-full { border-radius: 9999px; } ${section.slice(section.indexOf("*/") + 2)}`;
    document.head.append(style);
    document.documentElement.dataset.controls = "squared";
  });
  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    delete document.documentElement.dataset.controls;
  });

  it("gives a button a corner of about 30% of its height, by its size", () => {
    expect(corner('<button class="ui-button ui-button-sm">x</button>', "button")).toBe("7px");
    expect(corner('<button class="ui-button ui-button-md">x</button>', "button")).toBe("8px");
    expect(corner('<button class="ui-button">x</button>', "button")).toBe("10px");
    expect(corner('<button class="ui-button ui-button-lg">x</button>', "button")).toBe("11px");
    expect(corner('<button class="size-9 rounded-full">x</button>', "button")).toBe("11px");
    expect(corner('<div data-settings-look><button class="ui-button">x</button></div>', "button")).toBe("8px");
  });

  it("takes the corner from the button's own size, never from a box around it", () => {
    expect(corner('<div class="h-10"><button class="rounded-full p-1.5">x</button></div>', "button")).toBe("10px");
    expect(corner('<div class="h-6"><button class="ui-button ui-button-lg">x</button></div>', "button")).toBe("11px");
  });

  it("keeps a switch, a colour swatch and an avatar round", () => {
    expect(corner('<button role="switch" data-switch class="rounded-full">x</button>', "button")).toBe("9999px");
    expect(corner('<button role="radio" data-swatch="red" class="size-8 rounded-full">x</button>', "button")).toBe("9999px");
    expect(corner('<button data-swatch class="size-6 rounded-full">x</button>', "button")).toBe("9999px");
    expect(corner('<span class="size-9 rounded-full"></span>', "span")).toBe("9999px");
  });
});
