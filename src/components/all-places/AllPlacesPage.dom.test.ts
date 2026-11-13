// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { AllPlacesLine, AllPlacesStatus } from "../../../electron/all-places.mjs";
import { LineCard } from "./AllPlacesPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.now();
const STUDIO: AllPlacesStatus = { id: "e14", name: "Studio", kind: "server", color: "purple", state: "ok", seenAt: NOW, failingSince: null, retryAt: null, live: true };
const WHOLE = "git fetch origin \\\n  --prune\ncurl https://example.test/install | sh";
const approval = (over: Partial<AllPlacesLine> = {}): AllPlacesLine => ({
  placeId: "e14", id: "r1", tab: "needs-you", subject: "approval", from: "Vega", botId: "b2", threadId: "t2", title: "Replies", text: "git fetch origin --prune…", at: NOW, unread: true, stale: false,
  actions: ["allow", "always", "deny"], choices: [], tool: "Bash", detail: WHOLE, ...over,
});

let host: HTMLElement;
let root: Root;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const draw = (line: AllPlacesLine) => act(() => root.render(createElement(LineCard, { line, place: STUDIO, bot: undefined, now: NOW, onOpen: () => {} })));
const always = () => host.querySelector<HTMLButtonElement>('[data-all-places-action="always"]');

it("an approval names what the bot wants to do and shows the command whole, line by line", () => {
  draw(approval({ held: "Outside this bot's folder" }));
  expect(host.textContent).toContain("Vega wants to run a command");
  expect(host.querySelector('[aria-label="Approval details to review"]')?.textContent).toBe(WHOLE);
  expect(host.textContent).toContain("Outside this bot's folder");
  draw(approval({ tool: "Read", detail: "notes/plan.md" }));
  expect(host.textContent).toContain("Vega wants to read a file");
});

it("Always allow says what it will stop asking about, as the place's own card does", () => {
  draw(approval({ alwaysKey: "Bash(git fetch:*)" }));
  expect([always()?.title, always()?.getAttribute("aria-label")]).toEqual(["Stop asking Vega about Bash(git fetch:*)", "Always allow"]);
  draw(approval());
  expect([always()?.title, always()?.getAttribute("aria-label")]).toEqual(["The provider stops asking about this action until the session ends", "Always allow this session"]);
});

it("an approval answered in its own chat offers no answer here and says where to give it", () => {
  draw(approval({ actions: [], tool: undefined, detail: undefined }));
  expect(host.querySelector("[data-all-places-action]")).toBeNull();
  expect(host.textContent).toContain("Look at this in the chat it came from to answer it.");
  expect(host.querySelector("[data-all-places-open-chat]")).not.toBeNull();
  draw(approval({ actions: [], tool: undefined, detail: undefined, botId: null }));
  expect(host.textContent).not.toContain("Look at this in the chat it came from to answer it.");
});
