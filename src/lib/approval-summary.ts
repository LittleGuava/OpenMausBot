import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { OptionCardData } from "@/state/store";
import { RESERVED_MCP_NAMES } from "../../shared/mcp-name";
import { noticeText } from "./activity-text";

export function approvalDetailText(card: Pick<OptionCardData, "subtitle" | "summaryCode" | "summaryParams">): string {
  return noticeText(card.summaryCode, card.subtitle, card.summaryParams);
}

export interface OutboundCall {
  app: string | null;
  label: string;
}

const SUMMARY_GROUPS = 3;

/** Per call, `App · Label` then its JSON arguments; JSON.stringify never writes a raw newline. */
export function parseOutboundCalls(subtitle: string): OutboundCall[] {
  const calls: OutboundCall[] = [];
  for (const block of subtitle.split("\n\n")) {
    const heading = (block.split("\n")[0] ?? "").trim();
    if (!heading) return [];
    const at = heading.indexOf(" · ");
    if (at < 0) {
      calls.push({ app: null, label: heading });
      continue;
    }
    const app = heading.slice(0, at).trim();
    const label = heading.slice(at + " · ".length).trim();
    if (!app || !label) return [];
    calls.push({ app, label });
  }
  return calls;
}

export function outboundCalls(card: Pick<OptionCardData, "outboundRequest" | "subtitle">): OutboundCall[] {
  if (!card.outboundRequest) return [];
  const calls = card.outboundRequest.calls;
  if (calls && calls.length > 0) return calls;
  return parseOutboundCalls(card.subtitle);
}

export function outboundApp(calls: OutboundCall[]): string | null {
  if (calls.length === 0 || calls.some((call) => !call.app)) return null;
  const apps = new Set(calls.map((call) => call.app));
  return apps.size === 1 ? calls[0]!.app : null;
}

export function collapseOutboundCalls(calls: OutboundCall[], namingApps: boolean): string {
  const order: OutboundCall[] = [];
  const counts = new Map<string, number>();
  for (const call of calls) {
    const key = JSON.stringify([call.app, call.label]);
    if (!counts.has(key)) order.push(call);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = order.slice(0, SUMMARY_GROUPS).map((call) => {
    const name = namingApps && call.app ? `${call.app} · ${call.label}` : call.label;
    const count = counts.get(JSON.stringify([call.app, call.label])) ?? 1;
    return count > 1 ? `${name} ×${count}` : name;
  });
  const line = parts.join(", ");
  const hidden = order.length - parts.length;
  return hidden > 0 ? `${line}, ${t("approval.outbound.more", { count: hidden })}` : line;
}

export interface OutboundSummary {
  headline: string;
  summary: string;
  opaque?: true;
}

const OPAQUE_TOOL = "COMPOSIO_PROXY_EXECUTE";

export function outboundSummary(card: Pick<OptionCardData, "outboundRequest" | "subtitle">): OutboundSummary | undefined {
  if (!card.outboundRequest) return undefined;
  const calls = outboundCalls(card);
  const app = outboundApp(calls);
  if (card.outboundRequest.tool === OPAQUE_TOOL) {
    return {
      headline: t("approval.outbound.runCode", { app: app ?? card.outboundRequest.app ?? "Composio" }),
      summary: "",
      opaque: true,
    };
  }
  return {
    headline: app ? t("approval.outbound.sendTo", { app }) : t("approval.outbound.sendOnBehalf"),
    summary: collapseOutboundCalls(calls, app === null),
  };
}

/** Composio names its tools TOOLKIT_ACTION_WORDS, all upper case. */
const COMPOSIO_TOOL = /^[A-Z][A-Z0-9]+_([A-Z0-9_]+)$/;

export function composioActionPhrase(tool: string): string | undefined {
  const match = COMPOSIO_TOOL.exec(tool);
  if (!match) return undefined;
  return match[1]!.replace(/_+/g, " ").trim().toLowerCase() || undefined;
}

interface ToolLabels {
  [tool: string]: LocaleKey;
}

export function toolLabel(tool?: string): string {
  if (!tool) return t("approval.tool.takeAction");
  // MCP tool names are `mcp__<server>__<name>`; a server name may itself carry underscores, so the server is the
  // second `__`-split segment and everything after it is the tool.
  const mcp = tool.startsWith("mcp__") ? tool.split("__") : undefined;
  const server = mcp?.[1];
  const action = (mcp ? mcp.slice(2).join("__") : tool).replace(/_/g, " ");
  const nice: ToolLabels = {
    Bash: "approval.tool.runCommand",
    Read: "approval.tool.readFile",
    Write: "approval.tool.writeFile",
    Edit: "approval.tool.editFile",
    WebFetch: "approval.tool.fetchWebPage",
    WebSearch: "approval.tool.searchWeb",
    schedule_routine: "approval.tool.scheduleRoutine",
    manage_routine: "approval.tool.changeRoutine",
    stage_skill: "approval.tool.enableSkill",
    update_skill: "approval.tool.updateSkill",
    update_profile: "approval.tool.updateProfile",
    // ACP drivers may send the protocol's toolCall kind as the tool, so every kind maps to a phrase ("shell" is
    // execute; "tool" is no kind at all).
    shell: "approval.tool.runCommand",
    edit: "approval.tool.editFile",
    read: "approval.tool.readFile",
    fetch: "approval.tool.fetchWebPage",
    delete: "approval.tool.deleteFile",
    think: "approval.tool.think",
    other: "approval.tool.takeAction",
    tool: "approval.tool.useTool",
  };
  const key = nice[tool];
  if (key) return t(key);
  // A custom MCP server's tools read like the app's own unless the card names the server asking.
  const phrase = mcp ? composioActionPhrase(mcp.slice(2).join("__")) ?? action : action;
  return server && !RESERVED_MCP_NAMES.has(server) ? `${server} · ${phrase}` : phrase;
}
