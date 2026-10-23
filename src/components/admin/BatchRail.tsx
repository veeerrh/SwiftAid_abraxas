"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Boxes, ShieldCheck, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { Ring } from "@/components/ui/Ring";
import { batchProgress, batchSurvival, donorOf, isActiveLeg, riderOf, shelterOf, STATUS_LABEL, STATUS_TONE } from "@/lib/client/derive";
import { durLabel, lifeTone, pct, survivalTone } from "@/lib/client/format";
import { useSmoothClock } from "@/lib/client/live";
import type { Batch } from "@/lib/domain/types";
import type { Snapshot } from "@/lib/store";
import { cn } from "@/lib/utils";
import { SurvivalBand } from "./SurvivalBand";

function StackBar({ b, inflight }: { b: Batch; inflight: number }) {
  const parts = [
    { v: b.deliveredQty, c: "var(--safe)" },
    { v: inflight, c: "var(--info)" },
    { v: b.unplacedQty, c: "var(--warn)" },
    { v: b.spoiledQty, c: "var(--crit)" },
  ];
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface3">
      {parts.map((p, i) => (
        <div key={i} style={{ width: `${(p.v / b.qty) * 100}%`, background: p.c, transition: "width 500ms var(--ease)" }} />
      ))}
    </div>
  );
}

function BatchCard({ snap, b, now, selected, onSelect }: { snap: Snapshot; b: Batch; now: number; selected: boolean; onSelect: () => void }) {
  const total = b.expiresAt - b.createdAt;
  const left = Math.max(0, b.expiresAt - now);
  const done = b.status === "delivered" || b.status === "spoiled" || b.status === "partial";
  const tone = done ? (b.status === "delivered" ? "safe" : "crit") : lifeTone(left, total);
  const prog = batchProgress(snap, b);
  const surv = batchSurvival(snap, b);
  const legs = snap.legs.filter((l) => l.batchId === b.id && isActiveLeg(l));

  return (
    <motion.li layout transition={{ type: "spring", stiffness: 380, damping: 34 }} className="list-none">
      <button
        onClick={onSelect}
        className={cn(
          "w-full rounded-xl border p-3 text-left transition-colors",
          selected ? "border-safe/60 bg-safe-soft" : "border-line bg-surface2 hover:bg-surface3",
        )}
      >
        <div className="flex items-start gap-3">
          <Ring value={done ? 1 : left / total} tone={tone} size={46} stroke={4}>
            <span className="tabular text-[10px] font-semibold">{done ? "✓" : Math.ceil(left)}</span>
          </Ring>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-[13px] font-semibold leading-tight">{b.label}</div>
              <Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-dim">
              {donorOf(snap, b.donorId)?.area} · {b.qty} {b.unit}
              {!done && <> · safe for {durLabel(left)}</>}
            </div>
            <div className="mt-2">
              <StackBar b={b} inflight={prog.inflight} />
            </div>
            <div className="tabular mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-faint">
              <span style={{ color: "var(--safe)" }}>{prog.delivered} delivered</span>
              <span style={{ color: "var(--info)" }}>{prog.inflight} moving</span>
              {prog.unplaced > 0 && <span style={{ color: "var(--warn)" }}>{prog.unplaced} waiting</span>}
              {prog.spoiled > 0 && <span style={{ color: "var(--crit)" }}>{prog.spoiled} spoiled</span>}
            </div>
          </div>
        </div>
        {surv !== null && (
          <div className="mt-2.5 flex items-center gap-2">
            <Badge tone={survivalTone(surv)}>
              <ShieldCheck className="size-3" /> {pct(surv)} survival
            </Badge>
            <span className="text-[10px] text-faint">Monte Carlo · {legs.length} leg{legs.length === 1 ? "" : "s"}</span>
          </div>
        )}
      </button>

      <AnimatePresence initial={false}>
        {selected && legs.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <ul className="mt-1.5 space-y-1.5 pl-3">
              {legs.map((l) => {
                const r = riderOf(snap, l.riderId);
                const s = shelterOf(snap, l.shelterId);
                const sb = l.standbyRiderId ? riderOf(snap, l.standbyRiderId) : undefined;
                return (
                  <li key={l.id} className="rounded-lg border border-line bg-surface2 p-2.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-medium">
                        {r?.name} → {s?.area}
                      </span>
                      <span className="tabular text-dim">
                        {l.qty} {b.unit} · ETA {durLabel(l.dropEta - now)}
                      </span>
                    </div>
                    {l.survival && (
                      <div className="mt-1.5">
                        <SurvivalBand est={l.survival} minutesLeft={b.expiresAt - now} />
                        <div className="tabular mt-0.5 flex justify-between text-[10px] text-faint">
                          <span>
                            p50 {durLabel(l.survival.p50)} · p90 {durLabel(l.survival.p90)}
                          </span>
                          <span style={{ color: `var(--${survivalTone(l.survival.p)})` }}>{pct(l.survival.p)} safe</span>
                        </div>
                      </div>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {sb && (
                        <Badge tone="ai">
                          <UserCheck className="size-3" /> Hot standby {sb.name}
                        </Badge>
                      )}
                      {l.divertedFrom && <Badge tone="warn">Diverted from {shelterOf(snap, l.divertedFrom)?.area}</Badge>}
                      {l.note === "stranded" && <Badge tone="crit">Stranded</Badge>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

export function BatchRail({
  snap,
  selectedId,
  onSelect,
  className,
}: {
  snap: Snapshot;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
}) {
  const now = useSmoothClock(4);
  const t = now || snap.clock;
  const rank = (b: Batch) => (b.status === "delivered" || b.status === "spoiled" || b.status === "partial" ? 1 : 0);
  const batches = [...snap.batches].sort((a, b) => rank(a) - rank(b) || a.expiresAt - b.expiresAt);
  return (
    <Panel title="Batches" icon={<Boxes className="size-3.5" />} className={className} bodyClassName="overflow-y-auto p-3"
      actions={<span className="tabular text-[11px] text-faint">{batches.length}</span>}>
      {batches.length === 0 ? (
        <div className="grid h-full place-items-center p-6 text-center text-sm text-dim">
          No donations yet.
          <br />
          Spawn a scenario from the chaos panel or post one from the Donor portal.
        </div>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {batches.map((b) => (
              <BatchCard key={b.id} snap={snap} b={b} now={t} selected={selectedId === b.id} onSelect={() => onSelect(selectedId === b.id ? null : b.id)} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}
