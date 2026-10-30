import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";

describe("paired devices limited to one department, bot or group chat", () => {
  let fixture: VerificationServer;
  const evidence: unknown[] = [];
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const threads: Record<string, string> = {};

  const api = async (method: string, path: string, body?: unknown, as?: string) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method,
      headers: { "content-type": "application/json", origin: fixture.info.url, ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const result = { status: response.status, body: text ? JSON.parse(text) : null };
    evidence.push({ as: as ?? "owner", method, path, status: result.status });
    return result;
  };
  const pair = async (name: string, view?: unknown) => {
    const invitation = await api("POST", "/api/auth/pairing", { label: name, scopes: ["admin", "client"], ...(view === undefined ? {} : { view }) });
    expect(invitation.status, JSON.stringify(invitation.body)).toBe(200);
    const accepted = await api("POST", "/api/auth/pair", { code: invitation.body.code, label: name });
    expect(accepted.status).toBe(200);
    tokens[name] = accepted.body.token;
    return accepted.body.session;
  };
  const seen = async (as: string) => {
    const { body } = await api("GET", "/api/bots?messages=0", undefined, as);
    return { bots: body.bots.map((bot: any) => bot.id).sort(), groups: body.groups.map((group: any) => group.id).sort(), sections: body.sections, raw: body };
  };
  const sorted = (...values: string[]) => [...values].sort();

  function openStream(as: string) {
    const controller = new AbortController();
    const frames: any[] = [];
    const state = { hello: false, ended: false };
    void (async () => {
      try {
        const res = await fetch(`${fixture.info.url}/api/events`, { headers: { origin: fixture.info.url, authorization: `Bearer ${tokens[as]}` }, signal: controller.signal });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const frame = JSON.parse(line.slice(6));
              if (frame.kind === "hello") state.hello = true;
              else if (frame.kind !== "ping") frames.push(frame);
            }
          }
        }
      } catch {
      }
      state.ended = true;
    })();
    return { frames, state, close: () => controller.abort() };
  }

  beforeAll(async () => {
    fixture = await launchVerificationServer();
    for (const [key, name, section] of [["ops1", "Ops One", "Ops"], ["ops2", "Ops Two", "Ops"], ["hr", "Payroll", "People"]] as const) {
      const created = await api("POST", "/api/bots", { name, section });
      expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
      ids[key] = created.body.bot.id;
      threads[key] = created.body.bot.threadId;
    }
    for (const [key, name, members] of [["roomOps", "Ops standup", ["ops1", "ops2"]], ["roomMixed", "Pay questions", ["ops1", "hr"]]] as const) {
      const created = await api("POST", "/api/groups", { name, memberIds: members.map((member) => ids[member]) });
      expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
      ids[key] = created.body.group.id;
      threads[key] = created.body.group.threadId;
      expect((await api("PATCH", `/api/groups/${ids[key]}/setup`, { action: "skip" })).status).toBe(200);
    }
  }, 120_000);

  afterAll(async () => {
    if (!fixture) return;
    const evidencePath = `${fixture.info.logPath}.device-views.json`;
    writeFileSync(evidencePath, JSON.stringify({ fixture: fixture.info, ids, requests: evidence }, null, 2));
    console.info(JSON.stringify({ ...fixture.info, evidencePath }));
    await fixture.close();
  });

  it("pairs a device with a view as a client only, and refuses a view that names nothing", async () => {
    expect((await api("POST", "/api/auth/pairing", { view: { bot: "nope" } })).status).toBe(400);
    expect((await api("POST", "/api/auth/pairing", { view: { section: "Finance" } })).status).toBe(400);
    expect((await api("POST", "/api/auth/pairing", { view: { group: ids.roomOps, bot: ids.ops1 } })).status).toBe(400);

    expect(await pair("ops-tablet", { section: "Ops" })).toMatchObject({ scopes: ["client"], view: { section: "Ops" } });
    expect(await pair("ops1-phone", { bot: ids.ops1 })).toMatchObject({ scopes: ["client"], view: { bot: ids.ops1 } });
    expect(await pair("room-screen", { group: ids.roomMixed })).toMatchObject({ scopes: ["client"], view: { group: ids.roomMixed } });
    expect((await pair("plain-phone")).view).toBeUndefined();

    const session = await api("GET", "/api/auth/session", undefined, "ops-tablet");
    expect(session.body).toMatchObject({ kind: "session", scopes: ["client"], view: { section: "Ops" } });
    expect((await api("GET", "/api/auth/sessions", undefined, "ops-tablet")).status).toBe(403);
    const listed = (await api("GET", "/api/auth/sessions")).body.sessions;
    expect(listed.find((row: any) => row.label === "room-screen").view).toEqual({ group: ids.roomMixed });
  });

  it("a department device lists and reaches that department only", async () => {
    const view = await seen("ops-tablet");
    expect(view.bots).toEqual(sorted(ids.ops1, ids.ops2));
    expect(view.groups).toEqual([ids.roomOps]);
    expect(view.sections).toEqual(["Ops"]);
    expect((await api("GET", `/api/threads/${threads.ops2}/messages`, undefined, "ops-tablet")).status).toBe(200);
    expect((await api("GET", `/api/threads/${threads.hr}/messages`, undefined, "ops-tablet")).status).toBe(404);
    expect((await api("GET", `/api/threads/${threads.roomMixed}/messages`, undefined, "ops-tablet")).status).toBe(404);
    expect((await api("POST", `/api/bots/${ids.hr}/messages`, { text: "hi", threadId: threads.hr }, "ops-tablet")).status).toBe(404);
  });

  it("a bot device lists and reaches that bot only", async () => {
    const view = await seen("ops1-phone");
    expect(view.bots).toEqual([ids.ops1]);
    expect(view.groups).toEqual([]);
    expect((await api("GET", `/api/threads/${threads.ops1}/messages`, undefined, "ops1-phone")).status).toBe(200);
    expect((await api("GET", `/api/threads/${threads.ops2}/messages`, undefined, "ops1-phone")).status).toBe(404);
    expect((await api("GET", `/api/threads/${threads.roomOps}/messages`, undefined, "ops1-phone")).status).toBe(404);
    expect((await api("PATCH", `/api/bots/${ids.ops2}`, { pinned: true }, "ops1-phone")).status).toBe(404);
  });

  it("a group device sees the room and its bots as members, never their own chats", async () => {
    const view = await seen("room-screen");
    expect(view.groups).toEqual([ids.roomMixed]);
    expect(view.bots).toEqual(sorted(ids.ops1, ids.hr));
    for (const bot of view.raw.bots) {
      expect(bot.tasks).toEqual([]);
      expect(bot.threadId).toBeUndefined();
      expect(bot.messages).toEqual([]);
    }
    expect((await api("GET", `/api/threads/${threads.roomMixed}/messages`, undefined, "room-screen")).status).toBe(200);
    expect((await api("GET", `/api/threads/${threads.ops1}/messages`, undefined, "room-screen")).status).toBe(404);
    expect((await api("GET", `/api/threads/${threads.roomOps}/messages`, undefined, "room-screen")).status).toBe(404);
    expect((await api("POST", `/api/bots/${ids.ops1}/messages`, { text: "direct", threadId: threads.ops1 }, "room-screen")).status).toBe(404);
    expect((await api("POST", `/api/bots/${ids.ops1}/tasks`, { title: "side chat" }, "room-screen")).status).toBe(404);
    expect((await api("PATCH", `/api/bots/${ids.ops1}`, { pinned: true }, "room-screen")).status).toBe(404);
    expect((await api("POST", "/api/groups", { name: "Side room", memberIds: [ids.ops1] }, "room-screen")).status).toBe(400);
    expect((await api("POST", "/api/routines", { botId: ids.ops1, prompt: "x", schedule: { kind: "daily", time: "09:00" } }, "room-screen")).status).toBe(404);
    const posted = await api("POST", `/api/groups/${ids.roomMixed}/messages`, { text: "Hello room", threadId: threads.roomMixed }, "room-screen");
    expect(posted.status, JSON.stringify(posted.body)).toBeLessThan(300);
  });

  it("a stream carries only what the device's view shows", async () => {
    const room = openStream("room-screen");
    const tablet = openStream("ops-tablet");
    await expect.poll(() => room.state.hello && tablet.state.hello, { timeout: 10_000 }).toBe(true);
    expect((await api("POST", `/api/bots/${ids.ops1}/messages`, { text: "Private Ops note", threadId: threads.ops1 })).status).toBe(202);
    await expect.poll(() => tablet.frames.some((frame) => frame.kind === "message" && frame.threadId === threads.ops1), { timeout: 15_000 }).toBe(true);
    expect((await api("POST", `/api/bots/${ids.hr}/messages`, { text: "Salary bands", threadId: threads.hr })).status).toBe(202);
    await expect.poll(async () => (await api("GET", `/api/threads/${threads.hr}/messages`)).body.messages.length, { timeout: 15_000 }).toBeGreaterThan(1);
    await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).body.bots.every((bot: any) => !bot.busy), { timeout: 20_000 }).toBe(true);
    const roomSeen = JSON.stringify(room.frames);
    expect(roomSeen).not.toContain(threads.ops1);
    expect(roomSeen).not.toContain("Private Ops note");
    expect(roomSeen).not.toContain(threads.hr);
    expect(roomSeen).not.toContain("Salary bands");
    expect(JSON.stringify(tablet.frames)).not.toContain(threads.hr);
    expect(JSON.stringify(tablet.frames)).not.toContain("Salary bands");
    room.close();
    tablet.close();
  }, 60_000);

  it("a bot added to the device's room arrives on its stream", async () => {
    const room = openStream("room-screen");
    await expect.poll(() => room.state.hello, { timeout: 10_000 }).toBe(true);
    expect((await api("PATCH", `/api/groups/${ids.roomMixed}`, { memberIds: [ids.ops1, ids.hr, ids.ops2] })).status).toBeLessThan(300);
    // Either the bot arrives on this stream, or the stream ends so the device reloads its list.
    await expect.poll(() => room.state.ended || room.frames.some((frame) => frame.kind === "bot" && frame.bot?.id === ids.ops2), { timeout: 10_000 }).toBe(true);
    expect((await seen("room-screen")).bots).toEqual(sorted(ids.ops1, ids.ops2, ids.hr));
    room.close();
    expect((await api("PATCH", `/api/groups/${ids.roomMixed}`, { memberIds: [ids.ops1, ids.hr] })).status).toBeLessThan(300);
  });

  it("an admin changes a paired device's view; its stream ends and it never gets admin back", async () => {
    const sessions = (await api("GET", "/api/auth/sessions")).body.sessions;
    const plain = sessions.find((row: any) => row.label === "plain-phone");
    expect(plain.scopes).toEqual(["admin", "client"]);
    const stream = openStream("plain-phone");
    await expect.poll(() => stream.state.hello, { timeout: 10_000 }).toBe(true);

    expect((await api("PATCH", `/api/auth/sessions/${plain.id}`, { view: { bot: "nope" } })).status).toBe(400);
    expect((await api("PATCH", `/api/auth/sessions/${plain.id}`, { view: { bot: ids.hr } }, "ops-tablet")).status).toBe(403);
    const changed = await api("PATCH", `/api/auth/sessions/${plain.id}`, { view: { bot: ids.hr } });
    expect(changed.status).toBe(200);
    expect(changed.body.session).toMatchObject({ scopes: ["client"], view: { bot: ids.hr } });
    await expect.poll(() => stream.state.ended, { timeout: 10_000 }).toBe(true);
    expect((await seen("plain-phone")).bots).toEqual([ids.hr]);
    expect((await api("GET", "/api/auth/sessions", undefined, "plain-phone")).status).toBe(403);

    const cleared = await api("PATCH", `/api/auth/sessions/${plain.id}`, { view: null });
    expect(cleared.body.session.view).toBeUndefined();
    expect(cleared.body.session.scopes).toEqual(["client"]);
    const everyBot = (await api("GET", "/api/bots?messages=0")).body.bots.map((bot: any) => bot.id).sort();
    expect((await seen("plain-phone")).bots).toEqual(everyBot);
  });

  it("a deleted target leaves the device seeing nothing", async () => {
    const extra = await api("POST", "/api/bots", { name: "Temp" });
    await pair("temp-phone", { bot: extra.body.bot.id });
    expect((await seen("temp-phone")).bots).toEqual([extra.body.bot.id]);
    expect((await api("DELETE", `/api/bots/${extra.body.bot.id}`)).status).toBeLessThan(300);
    const after = await seen("temp-phone");
    expect(after.bots).toEqual([]);
    expect(after.groups).toEqual([]);
  });
});
