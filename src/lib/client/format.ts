import type { Snapshot } from "@/lib/store";

/** Sim minute → wall-clock label (HH:MM) starting at the scenario's start hour. */
export function clockLabel(snap: Pick<Snapshot, "startHour">, simMin: number): string {
  const total = Math.floor(snap.startHour * 60 + simMin);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "75 min", "1h 15m", "now" */
export function durLabel(min: number): string {
  if (!Number.isFinite(min)) return "—";
  if (min <= 0.05) return "now";
  if (min < 1) return `${Math.round(min * 60)}s`;
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;

export type Tone = "safe" | "warn" | "crit" | "ai" | "info" | "neutral";

/** Colour band for "minutes of safe life left". */
export function lifeTone(minLeft: number, total: number): Tone {
  const f = total > 0 ? minLeft / total : 0;
  if (minLeft <= 0) return "crit";
  if (f < 0.25 || minLeft < 12) return "crit";
  if (f < 0.55) return "warn";
  return "safe";
}

export function survivalTone(p: number): Tone {
  if (p >= 0.85) return "safe";
  if (p >= 0.6) return "warn";
  return "crit";
}

export const toneVar: Record<Tone, string> = {
  safe: "var(--safe)",
  warn: "var(--warn)",
  crit: "var(--crit)",
  ai: "var(--ai)",
  info: "var(--info)",
  neutral: "var(--dim)",
};
