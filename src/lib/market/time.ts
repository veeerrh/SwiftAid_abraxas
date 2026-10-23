/** Simulation minute 0 is this hour of the day (24 h). Keep in sync with the snapshot's startHour. */
export const START_HOUR = 19;

/** "21:35" for a sim minute (wraps past midnight). */
export function simLabel(min: number): string {
  const total = Math.floor(START_HOUR * 60 + min);
  const day = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}${day > 0 ? ` (+${day}d)` : ""}`;
}

/** Sim minute for a wall-clock time "HH:MM" today (dayOffset 0) or on a later day. */
export function clockToSim(hhmm: string, dayOffset = 0): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi + dayOffset * 1440 - START_HOUR * 60;
}
