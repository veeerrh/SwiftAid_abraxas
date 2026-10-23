"use client";

import { Atom, Check, Sparkles } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Sparkline } from "@/components/ui/Sparkline";
import { toast } from "@/components/ui/Toaster";
import { act } from "@/lib/client/live";
import { clockLabel } from "@/lib/client/format";
import type { OptimizerAlgoResult } from "@/lib/domain/types";
import type { Snapshot } from "@/lib/store";
import { cn } from "@/lib/utils";

const META: Record<OptimizerAlgoResult["name"], { label: string; color: string; blurb: string }> = {
  greedy: { label: "Greedy baseline", color: "var(--faint)", blurb: "Most-urgent-first, best pair per step" },
  qiga: { label: "QIGA", color: "var(--info)", blurb: "Quantum-inspired GA · Q-bit rotation gates pick rider→shelter" },
  qpso: { label: "QPSO", color: "var(--ai)", blurb: "Quantum-behaved swarm · delta-well search over splits & priorities" },
  hybrid: { label: "Hybrid", color: "var(--safe)", blurb: "QIGA topology refined by QPSO" },
};
const ORDER: OptimizerAlgoResult["name"][] = ["greedy", "qiga", "qpso", "hybrid"];

export function OptimizerLab({ snap }: { snap: Snapshot }) {
  const run = snap.optimizerRuns.at(-1);
  if (!run) {
    return (
      <div className="grid h-80 place-items-center p-8 text-center text-sm text-dim">
        <div>
          <Atom className="mx-auto mb-3 size-8 text-ai" />
          The optimizers run whenever the planner is triggered.
          <br />
          Spawn a scenario to see QIGA and QPSO compete with the greedy baseline.
        </div>
      </div>
    );
  }
  const greedy = run.results.find((r) => r.name === "greedy")!;
  const maxLen = Math.max(...run.results.map((r) => r.convergence.length));
  const data = Array.from({ length: maxLen }, (_, i) => {
    const row: Record<string, number> = { i };
    for (const r of run.results) {
      if (r.name === "greedy") row.greedy = 0;
      else if (r.convergence.length) row[r.name] = +(r.convergence[Math.min(i, r.convergence.length - 1)] - greedy.fitness).toFixed(2);
    }
    return row;
  });

  return (
    <div className="space-y-5 p-5">
      <div className="rounded-xl border border-ai/30 bg-ai-soft p-4 text-xs leading-relaxed text-dim">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ai">
          <Sparkles className="size-3.5" /> Quantum-inspired search inside the rule engine
        </div>
        Hard rules (compatibility, capacity, expiry, closed shelters) always filter the plan; QIGA and QPSO search the space of rule-feasible plans. They run on classical hardware, borrowing the
        superposition and quantum-well ideas. Whatever is applied is never worse than the greedy baseline.
        <div className="mt-2 text-faint">
          Last run at {clockLabel(snap, run.at)} · trigger: {run.reason}
        </div>
      </div>

      <div className="h-56 rounded-xl border border-line bg-surface2 p-3">
        <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-dim">
          <span>Convergence · fitness gain over greedy</span>
          <span className="text-faint">higher is better</span>
        </div>
        <ResponsiveContainer width="100%" height="90%">
          <ComposedChart data={data} margin={{ left: -10, right: 8, top: 6, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
            <XAxis dataKey="i" tick={{ fill: "var(--faint)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
            <YAxis tick={{ fill: "var(--faint)", fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: "var(--surface-solid)", border: "1px solid var(--line-strong)", borderRadius: 10, fontSize: 12, color: "var(--ink)" }} labelFormatter={(l) => `Iteration ${l}`} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="hybrid" name="Hybrid" stroke="var(--safe)" fill="var(--safe)" fillOpacity={0.12} strokeWidth={2.4} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="qiga" name="QIGA" stroke="var(--info)" strokeWidth={1.8} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="qpso" name="QPSO" stroke="var(--ai)" strokeWidth={1.8} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="greedy" name="Greedy" stroke="var(--faint)" strokeDasharray="4 4" strokeWidth={1.4} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-2">
        {ORDER.map((name) => {
          const r = run.results.find((x) => x.name === name);
          if (!r) return null;
          const m = META[name];
          const gain = r.expectedSafe - greedy.expectedSafe;
          const active = snap.algo === name;
          return (
            <div key={name} className={cn("rounded-xl border p-3.5 transition-colors", active ? "border-safe/60 bg-safe-soft" : "border-line bg-surface2")}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="size-2.5 rounded-full" style={{ background: m.color }} />
                    {m.label}
                    {active && (
                      <Badge tone="safe">
                        <Check className="size-3" /> applied
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-faint">{m.blurb}</div>
                </div>
                <Button
                  size="sm"
                  variant={active ? "ghost" : "ai"}
                  disabled={active}
                  onClick={async () => {
                    const res = await act({ type: "setAlgo", algo: name });
                    toast(res.ok ? `Re-planned with ${m.label}` : (res.error ?? "Failed"), res.ok ? "safe" : "crit");
                  }}
                >
                  {active ? "Active" : "Apply"}
                </Button>
              </div>
              <div className="tabular mt-3 grid grid-cols-4 gap-2 text-center">
                <Metric label="Exp. safe" value={r.expectedSafe.toFixed(1)} sub={name === "greedy" ? "baseline" : `${gain >= 0 ? "+" : ""}${gain.toFixed(1)}`} good={gain > 0.05} />
                <Metric label="Survival" value={`${Math.round(r.avgSurvival * 100)}%`} />
                <Metric label="Travel" value={`${r.travelMin.toFixed(0)}m`} />
                <Metric label="Solve" value={`${r.ms.toFixed(0)}ms`} />
              </div>
              {name !== "greedy" && r.diversity.length > 2 && (
                <div className="mt-2.5 flex items-center gap-3 text-[10px] text-faint">
                  <span>Population diversity</span>
                  <Sparkline data={r.diversity} width={120} height={18} color={m.color} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div className="rounded-lg bg-surface3/60 px-1 py-1.5">
      <div className="text-[13px] font-semibold">{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-faint">{label}</div>
      {sub && <div className="text-[10px]" style={{ color: good ? "var(--safe)" : "var(--faint)" }}>{sub}</div>}
    </div>
  );
}
