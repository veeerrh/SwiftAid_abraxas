"use client";

import { GanttChartSquare } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { batchOf, donorOf, isActiveLeg, riderOf, shelterOf } from "@/lib/client/derive";
import { clockLabel, survivalTone, toneVar } from "@/lib/client/format";
import { useSmoothClock } from "@/lib/client/live";
import type { Snapshot } from "@/lib/store";

/** Gantt of every in-flight leg and every waiting batch against its expiry marker. */
export function Timeline({ snap, selectedBatchId, className }: { snap: Snapshot; selectedBatchId?: string | null; className?: string }) {
  const now = useSmoothClock(4) || snap.clock;
  const legs = snap.legs.filter(isActiveLeg);
  const waiting = snap.batches.filter((b) => b.unplacedQty > 0 && b.expiresAt > now);

  const ends = [
    ...legs.map((l) => l.dropEta),
    ...legs.map((l) => batchOf(snap, l.batchId)?.expiresAt ?? 0),
    ...waiting.map((b) => b.expiresAt),
  ];
  const start = now - 3;
  const end = Math.max(now + 30, Math.min(Math.max(...ends, now + 30) + 4, now + 150));
  const span = end - start;
  const x = (t: number) => `${((Math.max(start, Math.min(end, t)) - start) / span) * 100}%`;

  const rows = [
    ...legs.map((l) => ({ kind: "leg" as const, l })),
    ...waiting.map((b) => ({ kind: "wait" as const, b })),
  ];

  const ticks: number[] = [];
  const step = span > 90 ? 30 : span > 45 ? 15 : 10;
  for (let t = Math.ceil(start / step) * step; t < end; t += step) ticks.push(t);

  return (
    <Panel title="Dispatch timeline" icon={<GanttChartSquare className="size-3.5" />} className={className} bodyClassName="flex min-h-0 flex-col">
      <div className="relative min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {rows.length === 0 && <div className="grid h-full place-items-center text-sm text-dim">Nothing in flight</div>}
        <div className="relative">
          {/* grid + now cursor */}
          <div className="pointer-events-none absolute inset-y-0 left-28 right-0">
            {ticks.map((t) => (
              <div key={t} className="absolute inset-y-0 border-l border-dashed border-line" style={{ left: x(t) }}>
                <span className="tabular absolute -top-0.5 left-1 font-mono text-[9px] text-faint">{clockLabel(snap, t)}</span>
              </div>
            ))}
            <div className="absolute inset-y-0 w-px bg-safe shadow-[var(--glow-safe)]" style={{ left: x(now) }} />
          </div>

          <div className="space-y-1.5 pt-4">
            {rows.map((row) => {
              if (row.kind === "wait") {
                const b = row.b;
                return (
                  <div key={`w-${b.id}`} className="flex h-6 items-center">
                    <div className="w-28 shrink-0 truncate pr-2 text-[11px] text-warn">{donorOf(snap, b.donorId)?.area} · waiting</div>
                    <div className="relative h-full flex-1">
                      <div className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full bg-warn-soft ring-1 ring-warn/50" style={{ left: x(now), right: `calc(100% - ${x(b.expiresAt)})` }} />
                      <Expiry left={x(b.expiresAt)} />
                    </div>
                  </div>
                );
              }
              const l = row.l;
              const b = batchOf(snap, l.batchId)!;
              const r = riderOf(snap, l.riderId)!;
              const tone = r.silent ? "crit" : survivalTone(l.survival?.p ?? 1);
              const dim = selectedBatchId && selectedBatchId !== l.batchId;
              const progress = Math.max(0, Math.min(1, (now - l.createdAt) / Math.max(0.01, l.dropEta - l.createdAt)));
              const startX = Math.max(l.createdAt, start);
              return (
                <div key={l.id} className="flex h-6 items-center" style={{ opacity: dim ? 0.35 : 1 }}>
                  <div className="w-28 shrink-0 truncate pr-2 text-[11px] text-dim">
                    <span className="font-medium text-ink">{r.name}</span> → {shelterOf(snap, l.shelterId)?.area}
                  </div>
                  <div className="relative h-full flex-1">
                    <div
                      className="absolute top-1/2 h-3.5 -translate-y-1/2 overflow-hidden rounded-full"
                      style={{ left: x(startX), right: `calc(100% - ${x(l.dropEta)})`, background: `color-mix(in srgb, ${toneVar[tone]} 22%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${toneVar[tone]} 60%, transparent)` }}
                    >
                      <div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: toneVar[tone], opacity: 0.85 }} />
                    </div>
                    <Expiry left={x(b.expiresAt)} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Expiry({ left }: { left: string }) {
  return (
    <div className="absolute inset-y-0 w-0.5 rounded bg-crit" style={{ left }} title="Safe window closes">
      <span className="absolute -top-1 left-1 text-[8px] font-bold uppercase tracking-wide text-crit">exp</span>
    </div>
  );
}
