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

export function pickedCount(view: DeviceView): number {
  return view.sections.length + view.bots.length + view.groups.length;
}

export function accessOfDevice(view: DeviceView | undefined, scopes: readonly string[]): DeviceAccess {
  if (view) return "limited";
  return scopes.includes("admin") ? "admin" : "client";
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
