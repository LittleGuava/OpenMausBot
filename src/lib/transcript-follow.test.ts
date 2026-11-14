import { afterEach, describe, expect, it } from "vitest";
import type { Message } from "@/state/store";

import {
  FOLLOWING,
  forgetTranscriptPositions,
  initialTranscriptFollow,
  readSeenThrough,
  readTranscriptPosition,
  rememberSeenThrough,
  rememberTranscriptPosition,
  transitionTranscriptFollow,
  unseenCount,
  wantsJumpToLatest,
  type TranscriptFollow,
  type TranscriptFollowEvent,
} from "./transcript-follow";

const run = (from: TranscriptFollow, ...events: TranscriptFollowEvent["type"][]) =>
  events.reduce((state, type) => transitionTranscriptFollow(state, { type } as TranscriptFollowEvent), from);

afterEach(() => forgetTranscriptPositions());

describe("following a transcript's end", () => {
  it("opens following, or released when the reader left the conversation away from its end", () => {
    expect(initialTranscriptFollow(true)).toBe(FOLLOWING);
    expect(initialTranscriptFollow(false)).toEqual({ mode: "released", atEnd: false });
  });

  it("lets go when the reader navigates, and comes back only after leaving the end and returning", () => {
    const released = run(FOLLOWING, "navigated");
    expect(released).toEqual({ mode: "released", atEnd: true });
    expect(run(released, "reachedEnd"), "a scroll key at the end cannot re-arm").toBe(released);
    expect(run(released, "leftEnd")).toEqual({ mode: "released", atEnd: false });
    expect(run(released, "leftEnd", "reachedEnd")).toBe(FOLLOWING);
  });

  it("ignores the end band flickering while it follows a growing reply", () => {
    expect(run(FOLLOWING, "leftEnd", "reachedEnd", "leftEnd")).toBe(FOLLOWING);
  });

  it("follows again whenever the person asks for the end: a sent message or the latest button", () => {
    expect(run(FOLLOWING, "navigated", "leftEnd", "followEnd")).toBe(FOLLOWING);
  });

  it("offers the way down only once the reader is released away from the end", () => {
    expect(wantsJumpToLatest(FOLLOWING)).toBe(false);
    expect(wantsJumpToLatest(run(FOLLOWING, "navigated"))).toBe(false);
    expect(wantsJumpToLatest(run(FOLLOWING, "navigated", "leftEnd"))).toBe(true);
  });
});

describe("remembered positions", () => {
  it("keeps each conversation's own, the newest hundred", () => {
    rememberTranscriptPosition("a", { atEnd: false, rowId: "m3", offsetWithinRow: 12 });
    rememberTranscriptPosition("b", { atEnd: true });
    expect(readTranscriptPosition("a")).toEqual({ atEnd: false, rowId: "m3", offsetWithinRow: 12 });
    expect(readTranscriptPosition("b")).toEqual({ atEnd: true });
    for (let index = 0; index < 100; index++) rememberTranscriptPosition(`k${index}`, { atEnd: true });
    expect(readTranscriptPosition("a")).toBeUndefined();
    expect(readTranscriptPosition("k99")).toEqual({ atEnd: true });
  });
});

describe("unseenCount", () => {
  const said = (id: string, role: "bot" | "user" = "bot", kind: Message["kind"] = "text", at = 0) => ({ id, role, kind, at });

  it("counts what bots said after the last row the reader saw", () => {
    expect(unseenCount([said("a"), said("b"), said("c")], { id: "a" })).toBe(2);
    expect(unseenCount([said("a"), said("b")], { id: "b" })).toBe(0);
  });

  it("leaves out the person's own words and a turn's tool calls and work summary", () => {
    expect(unseenCount([said("a"), said("b", "user"), said("c", "bot", "activity"), said("d", "bot", "digest"), said("e")], { id: "a" })).toBe(1);
  });

  it("counts what a bot asks of the person: a question, a secret, a sign-in", () => {
    expect(unseenCount([said("a"), said("b", "bot", "options"), said("c", "bot", "secret"), said("d", "bot", "signin")], { id: "a" })).toBe(3);
  });

  it("counts nothing while nothing was seen yet", () => {
    expect(unseenCount([said("a"), said("b")], undefined)).toBe(0);
  });

  it("counts by time when the row seen last was replaced, as a sent message is by the server's copy", () => {
    const messages = [said("a", "bot", "text", 10), said("sent", "user", "text", 20), said("b", "bot", "text", 30)];
    expect(unseenCount(messages, { id: "optimistic-1", at: 20 })).toBe(1);
    expect(unseenCount(messages, { id: "gone" }), "no time to go by").toBe(0);
  });
});

describe("the row seen last", () => {
  it("is kept per conversation and forgotten with the positions", () => {
    rememberSeenThrough("k1", { id: "a", at: 1 });
    expect(readSeenThrough("k1")).toEqual({ id: "a", at: 1 });
    expect(readSeenThrough("k2")).toBeUndefined();
    forgetTranscriptPositions();
    expect(readSeenThrough("k1")).toBeUndefined();
  });
});
