"use client";

import { Gauge, GitFork, PackageCheck, ShieldAlert, ShieldCheck, Timer, Truck } from "lucide-react";
import type { ReactNode } from "react";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { activeLegs, avgResponse } from "@/lib/client/derive";
import type { Snapshot } from "@/lib/store";

function Kpi({ icon, label, children, tone }: { icon: ReactNode; label: string; children: ReactNode; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2">
      <span className="hidden size-8 shrink-0 place-items-center rounded-lg bg-surface2 2xl:grid" style={{ color: tone ?? "var(--dim)" }}>
        {icon}
      </span>
      <div className="leading-tight">
        <div className="tabular whitespace-nowrap text-base font-semibold tracking-tight">{children}</div>
        <div className="whitespace-nowrap text-[9px] uppercase tracking-[0.1em] text-faint">{label}</div>
      </div>
    </div>
  );
}

export function KpiStrip({ snap }: { snap: Snapshot }) {
  const m = snap.metrics;
  const resp = avgResponse(snap);
  const total = m.delivered + m.spoiled;
  const rate = total > 0 ? (m.delivered / total) * 100 : 100;
  const active = activeLegs(snap).length;
  return (
    <div className="glass flex divide-x divide-line overflow-hidden rounded-xl">
      <Kpi icon={<PackageCheck className="size-4" />} label="Delivered" tone="var(--safe)">
        <AnimatedNumber value={m.delivered} />
      </Kpi>
      <Kpi icon={<ShieldCheck className="size-4" />} label="Safe rate" tone="var(--safe)">
        <AnimatedNumber value={rate} suffix="%" />
      </Kpi>
      <Kpi icon={<ShieldAlert className="size-4" />} label="Spoiled" tone={m.spoiled > 0 ? "var(--crit)" : undefined}>
        <AnimatedNumber value={m.spoiled} />
      </Kpi>
      <Kpi icon={<Truck className="size-4" />} label="Active legs" tone="var(--info)">
        <AnimatedNumber value={active} />
      </Kpi>
      <Kpi icon={<Timer className="size-4" />} label="Ghost recov." tone="var(--ai)">
        <AnimatedNumber value={m.ghostRecoveries} />
      </Kpi>
      <Kpi icon={<Gauge className="size-4" />} label="Avg resp.">
        {resp === null ? "—" : <AnimatedNumber value={resp} decimals={1} suffix=" min" />}
      </Kpi>
      <Kpi icon={<GitFork className="size-4" />} label="Diverts" tone="var(--warn)">
        <AnimatedNumber value={m.diverts} />
      </Kpi>
    </div>
  );
}
