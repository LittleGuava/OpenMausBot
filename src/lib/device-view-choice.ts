import type { DeviceView } from "../../shared/device-view";

export type DeviceAccess = "admin" | "client" | "limited";

export interface DeviceViewTargets {
  sections: string[];
  bots: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
}

export const NO_TARGETS: DeviceViewTargets = { sections: [], bots: [], groups: [] };
export const EMPTY_VIEW: DeviceView = { sections: [], bots: [], groups: [] };

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

export function togglePicked(view: DeviceView, kind: keyof DeviceView, id: string): DeviceView {
  const list = view[kind];
  return { ...view, [kind]: list.includes(id) ? list.filter((item) => item !== id) : [...list, id] };
}

/** The server refuses a target that no longer exists, and the picker shows no checkbox to untick it. */
export function knownTargets(view: DeviceView, targets: DeviceViewTargets): DeviceView {
  return {
    sections: view.sections.filter((section) => section === "" || targets.sections.includes(section)),
    bots: view.bots.filter((id) => targets.bots.some((bot) => bot.id === id)),
    groups: view.groups.filter((id) => targets.groups.some((group) => group.id === id)),
  };
}

/** A paired device's view after one switch flips; null when nothing would be left, since that is "Remove limit"'s job. */
export function flipTarget(view: DeviceView, kind: keyof DeviceView, id: string, targets: DeviceViewTargets): DeviceView | null {
  const next = knownTargets(togglePicked(view, kind, id), targets);
  return pickedCount(next) ? next : null;
}

export function pickedCount(view: DeviceView): number {
  return view.sections.length + view.bots.length + view.groups.length;
}

export function pairingBody(access: DeviceAccess, picked: DeviceView): { scopes: string[]; view?: DeviceView } {
  if (access === "limited") return { scopes: ["client"], view: picked };
  return { scopes: access === "admin" ? ["admin", "client"] : ["client"] };
}

/** The names of what a view still names; a deleted target drops out. */
export function viewNames(view: DeviceView, targets: DeviceViewTargets, general: string): string[] {
  return [
    ...view.sections.filter((section) => section === "" || targets.sections.includes(section)).map((section) => section || general),
    ...view.bots.flatMap((id) => targets.bots.find((bot) => bot.id === id)?.name ?? []),
    ...view.groups.flatMap((id) => targets.groups.find((group) => group.id === id)?.name ?? []),
  ];
}
