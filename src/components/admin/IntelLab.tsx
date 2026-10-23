"use client";

import { Atom, FlaskConical, Gauge, Loader2, Package, Play, TrendingUp } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import type { Summary } from "@/lib/market/intel";
import type { Snapshot } from "@/lib/store";
import { cn } from "@/lib/utils";
import { OptimizerLab } from "./OptimizerLab";

type Tab = "live" | "bench" | "stress" | "bundles";
interface StressRow { scale: number; meals: number; riders: number; gainSafe: number; gainPct: number; greedyMs: number; hybridMs: number }
interface BundleRes { trials: number; winRate: number; avgGain: number; maxGain: number; fewerPickupsRate: number }

const tip = { background: "var(--surface-solid)", border: "1px solid var(--line-strong)", borderRadius: 10, fontSize: 12, color: "var(--ink)" };
const axis = { fill: "var(--faint)", fontSize: 10 };

async function call<T>(body: object): Promise<T | null> {
  try {
    const r = await fetch("/api/intel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    return j as T;
  } catch {
    toast("The benchmark could not run", "crit");
    return null;
  }
}

export function IntelLab({ snap }: { snap: Snapshot }) {
  const [tab, setTab] = useState<Tab>("live");
  const [busy, setBusy] = useState(false);
  const [bench, setBench] = useState<{ summary: Summary } | null>(null);
  const [stress, setStress] = useState<StressRow[] | null>(null);
  const [bundles, setBundles] = useState<BundleRes | null>(null);

  const tabs: [Tab, string][] = [
    ["live", "Live plan"],
    ["bench", "Benchmark"],
    ["stress", "Stress test"],
    ["bundles", "Donor mixes"],
  ];

  async function run(kind: "benchmark" | "stress" | "bundles") {
    setBusy(true);
    if (kind === "benchmark") setBench(await call({ kind, trials: 24 }));
    if (kind === "stress") setStress((await call<{ rows: StressRow[] }>({ kind }))?.rows ?? null);
    if (kind === "bundles") setBundles(await call<BundleRes>({ kind, trials: 24 }));
    setBusy(false);
  }

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-line bg-surface-solid/95 px-5 pb-3 pt-4 backdrop-blur">
        <div className="flex gap-1 rounded-xl bg-surface2 p-1 text-xs font-medium">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={cn("flex-1 rounded-lg px-2 py-1.5 transition-colors", tab === k ? "bg-surface3 text-ink shadow-sm" : "text-dim hover:text-ink")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "live" && <OptimizerLab snap={snap} />}

      {tab === "bench" && (
        <Pane
          icon={<FlaskConical className="size-4 text-ai" />}
          title="Greedy vs QIGA + QPSO on 24 random emergencies"
          text="Each trial invents a different city: batch size, shelf life, riders, reliability, traffic and shelter space. Greedy and the quantum-inspired hybrid plan the same situation, and we count the safe meals each one expects to deliver."
          busy={busy}
          onRun={() => run("benchmark")}
          label={bench ? "Run again with new situations" : "Run benchmark"}
        >
          {bench && <BenchResult s={bench.summary} />}
        </Pane>
      )}

      {tab === "stress" && (
        <Pane
          icon={<TrendingUp className="size-4 text-ai" />}
          title="Does it hold up as the emergency grows?"
          text="Scales the batch and rider pool from small to very large and records the optimiser's advantage and how long it takes to think."
          busy={busy}
          onRun={() => run("stress")}
          label={stress ? "Run again" : "Run stress test"}
        >
          {stress && <StressResult rows={stress} />}
        </Pane>
      )}

      {tab === "bundles" && (
        <Pane
          icon={<Package className="size-4 text-ai" />}
          title="Shelter donor-mix suggestions"
          text="QIGA picks which donors take part and QPSO tunes how much to take from each. The score blends coverage, arrival safety, freshness, distance and the number of pickups. The baseline is simply taking the freshest donors first."
          busy={busy}
          onRun={() => run("bundles")}
          label={bundles ? "Run again" : "Run 24 trials"}
        >
          {bundles && (
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="Better than baseline" value={`${Math.round(bundles.winRate * 100)}%`} sub={`of ${bundles.trials} requests`} good />
              <Stat label="Average score gain" value={`+${bundles.avgGain.toFixed(1)}`} sub={`best +${bundles.maxGain.toFixed(1)}`} />
              <Stat label="Fewer pickups" value={`${Math.round(bundles.fewerPickupsRate * 100)}%`} sub="of requests" />
              <Stat label="Never worse" value="by design" sub="greedy is the floor" />
            </div>
          )}
        </Pane>
      )}

      <HowItWorks />
    </div>
  );
}

function Pane({ icon, title, text, busy, onRun, label, children }: { icon: React.ReactNode; title: string; text: string; busy: boolean; onRun: () => void; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4 p-5">
      <div className="rounded-xl border border-ai/30 bg-ai-soft p-4">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </div>
        <p className="text-xs leading-relaxed text-dim">{text}</p>
        <Button size="sm" variant="ai" className="mt-3" disabled={busy} icon={busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} onClick={onRun}>
          {busy ? "Solving hundreds of plans…" : label}
        </Button>
      </div>
      {children}
    </div>
  );
}

function BenchResult({ s }: { s: Summary }) {
  const safeBars = [
    { name: "Greedy", v: +s.meanSafe.greedy.toFixed(1), fill: "var(--faint)" },
    { name: "QIGA", v: +s.meanSafe.qiga.toFixed(1), fill: "var(--info)" },
    { name: "QPSO", v: +s.meanSafe.qpso.toFixed(1), fill: "var(--ai)" },
    { name: "Hybrid", v: +s.meanSafe.hybrid.toFixed(1), fill: "var(--safe)" },
  ];
  const lo = Math.floor(Math.min(...safeBars.map((b) => b.v)) * 0.95);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <Stat label="Hybrid beat greedy" value={`${Math.round(s.winRate * 100)}%`} sub={`of ${s.trials} situations`} good />
        <Stat label="Hybrid did worse" value={`${Math.round(s.lossRate * 100)}%`} sub={s.lossRate === 0 ? "never, by design" : "check the floor"} good={s.lossRate === 0} />
        <Stat label="Average gain" value={`+${s.avgGainSafe.toFixed(1)} meals`} sub={`+${s.avgGainPct.toFixed(1)}% safely delivered`} />
        <Stat label="Best case" value={`+${s.maxGainSafe.toFixed(0)} meals`} sub={`solves in ~${s.avgMs.hybrid.toFixed(0)} ms`} />
      </div>
      <Chart title="Expected safe meals per situation (average)" note="higher is better">
        <BarChart data={safeBars} margin={{ left: -10, right: 8, top: 6, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
          <YAxis tick={axis} tickLine={false} axisLine={false} domain={[lo, "auto"]} />
          <Tooltip contentStyle={tip} cursor={{ fill: "var(--surface3)" }} />
          <Bar dataKey="v" name="Safe meals" radius={[6, 6, 0, 0]} isAnimationActive={false} fill="var(--safe)" />
        </BarChart>
      </Chart>
      <Chart title="How much did the optimiser add? (hybrid − greedy, meals)" note="each bar = number of situations">
        <BarChart data={s.histogram.map((h) => ({ range: `${h.from}–${h.to}`, count: h.count }))} margin={{ left: -10, right: 8, top: 6, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="range" tick={axis} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
          <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip contentStyle={tip} cursor={{ fill: "var(--surface3)" }} />
          <Bar dataKey="count" name="Situations" fill="var(--ai)" radius={[6, 6, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </Chart>
      <div className="grid grid-cols-4 gap-2 text-center">
        {(["greedy", "qiga", "qpso", "hybrid"] as const).map((a) => (
          <div key={a} className="rounded-lg bg-surface2 px-1 py-2">
            <div className="tabular text-[13px] font-semibold">{s.avgMs[a] < 1 ? "<1" : s.avgMs[a].toFixed(0)} ms</div>
            <div className="text-[9px] uppercase tracking-wide text-faint">{a} solve</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StressResult({ rows }: { rows: StressRow[] }) {
  const data = rows.map((r) => ({ label: `${r.meals} meals · ${r.riders} riders`, gain: +r.gainPct.toFixed(1), ms: +r.hybridMs.toFixed(0), greedyMs: +r.greedyMs.toFixed(1) }));
  return (
    <div className="space-y-4">
      <Chart title="Optimiser advantage and thinking time as the problem grows" note="bars: % more safe meals · line: ms">
        <ComposedChart data={data} margin={{ left: -10, right: 8, top: 6, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ ...axis, fontSize: 9 }} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
          <YAxis yAxisId="l" tick={axis} tickLine={false} axisLine={false} />
          <YAxis yAxisId="r" orientation="right" tick={axis} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tip} cursor={{ fill: "var(--surface3)" }} />
          <Bar yAxisId="l" dataKey="gain" name="Gain over greedy (%)" fill="var(--safe)" radius={[6, 6, 0, 0]} isAnimationActive={false} />
          <Line yAxisId="r" type="monotone" dataKey="ms" name="Hybrid solve (ms)" stroke="var(--warn)" strokeWidth={2} dot isAnimationActive={false} />
        </ComposedChart>
      </Chart>
      <div className="overflow-hidden rounded-xl border border-line text-xs">
        <table className="w-full">
          <thead className="bg-surface2 text-faint">
            <tr>{["Meals", "Riders", "Gain", "Greedy", "Hybrid"].map((h) => <th key={h} className="px-2.5 py-2 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="tabular">
            {rows.map((r) => (
              <tr key={r.scale} className="border-t border-line">
                <td className="px-2.5 py-2">{r.meals}</td>
                <td className="px-2.5 py-2">{r.riders}</td>
                <td className="px-2.5 py-2 text-safe">+{r.gainSafe.toFixed(1)} ({r.gainPct.toFixed(1)}%)</td>
                <td className="px-2.5 py-2">{r.greedyMs < 1 ? "<1" : r.greedyMs.toFixed(0)} ms</td>
                <td className="px-2.5 py-2">{r.hybridMs.toFixed(0)} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Chart({ title, note, children }: { title: string; note: string; children: React.ReactElement }) {
  return (
    <div className="h-56 rounded-xl border border-line bg-surface2 p-3">
      <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-dim">
        <span>{title}</span>
        <span className="text-faint">{note}</span>
      </div>
      <ResponsiveContainer width="100%" height="88%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function Stat({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div className={cn("rounded-xl border p-3", good ? "border-safe/40 bg-safe-soft" : "border-line bg-surface2")}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className="tabular mt-0.5 text-lg font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-dim">{sub}</div>}
    </div>
  );
}

function HowItWorks() {
  return (
    <div className="m-5 mt-0 space-y-2 rounded-xl border border-line p-4 text-xs leading-relaxed text-dim">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
        <Atom className="size-3.5" /> How it works
      </div>
      <p><b className="text-ink">Rules decide what is allowed.</b> Expiry, capacity, compatibility, cold chain and closed shelters filter every candidate first. Nothing unsafe can be chosen.</p>
      <p><b className="text-ink">QIGA decides who goes where.</b> Each rider’s cargo and shelter is a string of quantum bits that hold both 0 and 1 until observed; rotation gates nudge them toward the best plans found.</p>
      <p><b className="text-ink">QPSO decides how much.</b> A swarm of particles searches load fractions and priorities, pulled toward their shared best through a quantum potential well.</p>
      <p><b className="text-ink">Greedy is the floor.</b> It seeds the search and is kept if nothing beats it, so the optimiser can only help. All of this is classical code inspired by quantum ideas.</p>
      <div className="flex items-center gap-2 pt-1 text-faint"><Gauge className="size-3.5" /> Every number above is measured live from real solves, not hard-coded.</div>
    </div>
  );
}
