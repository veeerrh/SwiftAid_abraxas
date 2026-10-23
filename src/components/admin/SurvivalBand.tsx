import type { SurvivalEstimate } from "@/lib/domain/types";

/** Distribution of simulated arrival times against the safe-window deadline. */
export function SurvivalBand({ est, minutesLeft, height = 28 }: { est: SurvivalEstimate; minutesLeft: number; height?: number }) {
  const max = Math.max(...est.bins, 1);
  const span = est.binMax - est.binMin || 1;
  const deadlineX = Math.max(0, Math.min(1, (minutesLeft - est.binMin) / span));
  const n = est.bins.length;
  return (
    <svg viewBox={`0 0 ${n * 10} ${height}`} preserveAspectRatio="none" className="h-7 w-full" aria-hidden>
      {est.bins.map((v, i) => {
        const x = i / n;
        const h = (v / max) * (height - 4);
        const safe = x + 0.5 / n <= deadlineX;
        return <rect key={i} x={i * 10 + 1} y={height - h} width={8} height={h} rx={1.5} fill={safe ? "var(--safe)" : "var(--crit)"} opacity={safe ? 0.7 : 0.55} />;
      })}
      <line x1={deadlineX * n * 10} x2={deadlineX * n * 10} y1={0} y2={height} stroke="var(--crit)" strokeWidth={1.5} strokeDasharray="3 2" />
    </svg>
  );
}
