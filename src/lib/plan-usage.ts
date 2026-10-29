/** Every fleet carries a Copilot engine, so a Copilot row without a sign-in or a plan is not a failing check. */
export function quietPlanRow(row: { driver: string; ok: boolean; reason?: string | null }): boolean {
  return !row.ok && row.driver === "copilot" && (row.reason === "signedOut" || row.reason === "noPlan");
}
