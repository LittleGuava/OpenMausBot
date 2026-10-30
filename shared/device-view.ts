// What a paired device is limited to. Set by an admin when pairing, or later on
// the device's row; a device with a view is never an admin.

/** One department (`section`, "" is General), one bot, or one group chat.
 * Absent: everything the device's scopes allow. */
export type DeviceView = { section: string } | { bot: string } | { group: string };

const ID = /^[\w-]{1,128}$/;
const MAX_SECTION = 80;

/** An admin's input: null clears the view. */
export function parseDeviceView(value: unknown): { ok: true; view: DeviceView | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, view: null };
  const error = 'view must be null, { "section": name }, { "bot": id } or { "group": id }';
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error };
  const entries = Object.entries(value);
  if (entries.length !== 1) return { ok: false, error };
  const [key, raw] = entries[0]!;
  if (typeof raw !== "string") return { ok: false, error };
  if (key === "section") {
    const section = raw.trim();
    return section.length <= MAX_SECTION ? { ok: true, view: { section } } : { ok: false, error };
  }
  if ((key === "bot" || key === "group") && ID.test(raw)) return { ok: true, view: key === "bot" ? { bot: raw } : { group: raw } };
  return { ok: false, error };
}

/** A view that names nothing: what an unreadable stored view becomes, so damage never widens a device's reach. */
export const SEES_NOTHING: DeviceView = { bot: "" };

/** A stored view as read back from disk: unrecognised fails closed to SEES_NOTHING. */
export function storedDeviceView(value: unknown): DeviceView | undefined {
  if (value === undefined) return undefined;
  if (value && typeof value === "object" && (value as { bot?: unknown }).bot === "") return SEES_NOTHING;
  const parsed = parseDeviceView(value);
  return parsed.ok && parsed.view ? parsed.view : SEES_NOTHING;
}

export function sameDeviceView(a: DeviceView | undefined, b: DeviceView | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
