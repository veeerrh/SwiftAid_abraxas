"use client";

import { Activity, Gauge, GitFork, Ghost, Leaf, PackageCheck, ShieldCheck, Timer, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TopBar } from "@/components/shell/TopBar";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Panel } from "@/components/ui/Panel";
import { avgResponse } from "@/lib/client/derive";
import { clockLabel } from "@/lib/client/format";
import { useSnapshot } from "@/lib/client/live";

const tip = { background: "var(--surface-solid)", border: "1px solid var(--line-strong)", borderRadius: 10, fontSize: 12, color: "var(--ink)" } as const;
const axis = { fill: "var(--faint)", fontSize: 10 } as const;

function Stat({ icon, label, value, sub, tone = "var(--ink)" }: { icon: ReactNode; label: string; value: ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">
        <span style={{ color: tone }}>{icon}</span>
        {label}
      </div>
      <div className="tabular mt-3 text-3xl font-semibold tracking-tight" style={{ color: tone }}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-dim">{sub}</div>}
    </div>
  );
}

export default function ImpactPage() {
  const snap = useSnapshot();
  if (!snap) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <div className="glass rounded-xl px-6 py-4 text-sm text-dim">Loading impact…</div>
      </main>
    );
  }
  const m = snap.metrics;
  const total = m.delivered + m.spoiled;
  const rate = total > 0 ? (m.delivered / total) * 100 : 100;
  const resp = avgResponse(snap);
  const series = m.series.map((p) => ({ ...p, label: clockLabel(snap, p.t) }));
  const finished = snap.legs.filter((l) => l.state === "delivered");
  const avgQty = finished.length ? finished.reduce((n, l) => n + l.qty, 0) / finished.length : 35;
  const avgMin = finished.length ? finished.reduce((n, l) => n + (l.dropEta - l.createdAt), 0) / finished.length : 28;
  // Riders needed to move 1,000 units/hour at the observed trip size and duration.
  const ridersPer1000 = Math.ceil((1000 / avgQty) * (avgMin / 60));

  const shelters = snap.shelters.map((s) => ({ name: s.area, used: s.totalCapacity - s.capacityRemaining, free: s.capacityRemaining }));
  const riders = snap.riders.map((r) => ({
    name: r.name,
    reliability: Math.round(r.reliability * 100),
    delivered: snap.legs.filter((l) => l.riderId === r.id && l.state === "delivered").reduce((n, l) => n + l.qty, 0),
  }));
  const run = snap.optimizerRuns.at(-1);
  const algos = run?.results.map((r) => ({ name: r.name === "greedy" ? "Greedy" : r.name.toUpperCase(), safe: +r.expectedSafe.toFixed(1), surv: Math.round(r.avgSurvival * 100) })) ?? [];
  const greedyRef = run?.results.find((r) => r.name === "greedy");
  const best = run ? [...run.results].sort((a, b) => b.expectedSafe - a.expectedSafe)[0] : undefined;
  const gain = greedyRef && best ? best.expectedSafe - greedyRef.expectedSafe : 0;

  return (
    <main className="min-h-dvh bg-bg">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-3 sm:p-5">
        <TopBar />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Impact</h1>
          <p className="text-sm text-dim">What the network has saved so far, and what it would take to run it at city scale.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={<PackageCheck className="size-4" />} label="Delivered safely" tone="var(--safe)" value={<AnimatedNumber value={m.delivered} />} sub="units reached a shelter inside their safe window" />
          <Stat icon={<ShieldCheck className="size-4" />} label="Safe-delivery rate" tone="var(--safe)" value={<AnimatedNumber value={rate} suffix="%" decimals={0} />} sub={`${m.spoiled} units lost`} />
          <Stat icon={<Ghost className="size-4" />} label="Ghost recoveries" tone="var(--ai)" value={<AnimatedNumber value={m.ghostRecoveries} />} sub={resp === null ? "no ghost events yet" : `avg ${resp.toFixed(1)} min to reassign`} />
          <Stat icon={<GitFork className="size-4" />} label="Mid-route diverts" tone="var(--warn)" value={<AnimatedNumber value={m.diverts} />} sub={`${m.blockedDispatches} unsafe dispatches blocked`} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Safe deliveries over time" icon={<Activity className="size-3.5" />} className="h-80 lg:col-span-2" bodyClassName="p-3">
            {series.length < 2 ? (
              <div className="grid h-full place-items-center text-sm text-dim">Collecting data… let the simulation run a few minutes.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ left: -12, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="gDel" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--safe)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--safe)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={36} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tip} />
                  <Area type="monotone" dataKey="delivered" name="Delivered" stroke="var(--safe)" strokeWidth={2.4} fill="url(#gDel)" isAnimationActive={false} />
                  <Area type="monotone" dataKey="spoiled" name="Spoiled" stroke="var(--crit)" strokeWidth={2} fill="var(--crit)" fillOpacity={0.12} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Optimizer: expected safe units" icon={<Gauge className="size-3.5" />} className="h-80" bodyClassName="p-3">
            {algos.length === 0 ? (
              <div className="grid h-full place-items-center text-sm text-dim">No planning runs yet.</div>
            ) : (
              <div className="flex h-full flex-col">
                <ResponsiveContainer width="100%" height="78%">
                  <BarChart data={algos} margin={{ left: -18, right: 6, top: 22 }}>
                    <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
                    <YAxis tick={axis} tickLine={false} axisLine={false} domain={[0, "dataMax"]} />
                    <Tooltip contentStyle={tip} />
                    <Bar dataKey="safe" name="Exp. safe units" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                      {algos.map((a) => (
                        <Cell key={a.name} fill={a.name === "Greedy" ? "var(--faint)" : a.name === "QIGA" ? "var(--info)" : a.name === "QPSO" ? "var(--ai)" : "var(--safe)"} />
                      ))}
                      <LabelList dataKey="safe" position="top" fill="var(--dim)" fontSize={11} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="px-2 text-center text-xs text-dim">
                  Best optimizer adds <span className="font-semibold text-safe">{gain >= 0 ? "+" : ""}{gain.toFixed(1)}</span> expected safe units over greedy in the latest plan
                </p>
              </div>
            )}
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Shelter capacity used" icon={<Users className="size-3.5" />} className="h-72" bodyClassName="p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={shelters} layout="vertical" margin={{ left: 12, right: 12 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={axis} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={axis} tickLine={false} axisLine={false} width={74} />
                <Tooltip contentStyle={tip} />
                <Bar dataKey="used" name="Used" stackId="a" fill="var(--safe)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="free" name="Free" stackId="a" fill="var(--surface-3)" radius={[0, 6, 6, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Riders: reliability and delivered" icon={<Timer className="size-3.5" />} className="h-72" bodyClassName="p-3">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={riders} margin={{ left: -14, right: 8, top: 8 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
                <YAxis yAxisId="l" tick={axis} tickLine={false} axisLine={false} />
                <YAxis yAxisId="r" orientation="right" domain={[50, 100]} tick={axis} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tip} />
                <Bar yAxisId="l" dataKey="delivered" name="Units delivered" fill="var(--info)" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="r" type="monotone" dataKey="reliability" name="Reliability %" stroke="var(--ai)" strokeWidth={2} dot={{ r: 3, fill: "var(--ai)" }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>
        </div>

        <Panel title="Scale and feasibility" icon={<Leaf className="size-3.5" />} bodyClassName="grid gap-4 p-5 md:grid-cols-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Riders per 1,000 units / hour</div>
            <div className="tabular mt-2 text-3xl font-semibold">{ridersPer1000}</div>
            <p className="mt-1 text-xs leading-relaxed text-dim">From observed trips: ~{avgQty.toFixed(0)} units per rider over ~{avgMin.toFixed(0)} min door to door.</p>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Why it scales</div>
            <p className="mt-2 text-xs leading-relaxed text-dim">
              The planner is a pure function over a snapshot, solved in tens of milliseconds. Replace the in-memory store with Postgres and a queue, shard by city zone, and run one solver per zone.
            </p>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Real-world next steps</div>
            <p className="mt-2 text-xs leading-relaxed text-dim">
              WhatsApp or SMS fallback for riders without the app, a live routing API for traffic, NGO onboarding with verified shelter profiles, and signed delivery receipts.
            </p>
          </div>
        </Panel>
      </div>
    </main>
  );
}
