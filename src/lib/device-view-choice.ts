import type { DeviceView } from "../../shared/device-view";

export type DeviceViewChoice = "admin" | "client" | `section:${string}` | `bot:${string}` | `group:${string}`;

export interface DeviceViewTargets {
  sections: string[];
  bots: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
}

export const NO_TARGETS: DeviceViewTargets = { sections: [], bots: [], groups: [] };

export function viewTargetsFrom(body: unknown): DeviceViewTargets {
  const record = Object(body) as { sections?: unknown; bots?: unknown; groups?: unknown };
  const named = (value: unknown) => {
    const item = Object(value) as { id?: unknown; name?: unknown };
    return typeof item.id === "string" && typeof item.name === "string" ? { id: item.id, name: item.name } : null;
  };
  const sections = Array.isArray(record.sections) ? record.sections.filter((section): section is string => typeof section === "string") : [];
  return {
    sections: sections.some((section) => section.trim() === "") ? sections : ["", ...sections],
    bots: Array.isArray(record.bots) ? record.bots.filter((bot) => !Object(bot).hidden).map(named).filter((bot) => bot !== null) : [],
    groups: Array.isArray(record.groups) ? record.groups.filter((group) => !Object(group).dm).map(named).filter((group) => group !== null) : [],
  };
}

export function choiceOfView(view: DeviceView | undefined, scopes: readonly string[]): DeviceViewChoice {
  if (!view) return scopes.includes("admin") ? "admin" : "client";
  if ("section" in view) return `section:${view.section}`;
  if ("bot" in view) return `bot:${view.bot}`;
  return `group:${view.group}`;
}

export function viewOfChoice(choice: string): DeviceView | null {
  const cut = choice.indexOf(":");
  if (cut < 0) return null;
  const kind = choice.slice(0, cut);
  const value = choice.slice(cut + 1);
  if (kind === "section") return { section: value };
  if (kind === "bot") return { bot: value };
  if (kind === "group") return { group: value };
  return null;
}

export function pairingBody(choice: DeviceViewChoice): { scopes: string[]; view?: DeviceView } {
  const view = viewOfChoice(choice);
  if (view) return { scopes: ["client"], view };
  return { scopes: choice === "admin" ? ["admin", "client"] : ["client"] };
}

export function viewTargetName(view: DeviceView, targets: DeviceViewTargets, general: string): string | null {
  if ("section" in view) return view.section === "" ? general : targets.sections.includes(view.section) ? view.section : null;
  if ("bot" in view) return targets.bots.find((bot) => bot.id === view.bot)?.name ?? null;
  return targets.groups.find((group) => group.id === view.group)?.name ?? null;
}
