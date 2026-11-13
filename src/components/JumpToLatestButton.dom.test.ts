// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { JumpToLatestButton } from "./JumpToLatestButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
const onClick = vi.fn();
const draw = (count?: number) => act(async () => { root.render(createElement(JumpToLatestButton, { onClick, ...(count === undefined ? {} : { count }) })); });
const button = () => document.querySelector<HTMLButtonElement>("button")!;
const badge = () => button().querySelector("[data-jump-count]");

beforeEach(() => {
  setLocale("en");
  root = createRoot(document.body.appendChild(document.createElement("div")));
  onClick.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

it("is the plain arrow when nothing new arrived", async () => {
  await draw();
  expect(badge()).toBeNull();
  expect(button().getAttribute("aria-label")).toBe("Jump to latest messages");
  await draw(0);
  expect(badge()).toBeNull();
});

it("says how many messages wait below and jumps on press", async () => {
  await draw(3);
  expect(badge()!.textContent).toBe("3");
  expect(button().getAttribute("aria-label")).toBe("3 new messages, jump to latest");
  await act(async () => { button().click(); });
  expect(onClick).toHaveBeenCalledOnce();
});

it("speaks of one message in the singular", async () => {
  await draw(1);
  expect(button().getAttribute("aria-label")).toBe("1 new message, jump to latest");
});

it("caps the badge at 99+", async () => {
  await draw(140);
  expect(badge()!.textContent).toBe("99+");
  expect(button().getAttribute("aria-label")).toBe("140 new messages, jump to latest");
});
