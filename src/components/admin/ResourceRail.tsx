"use client";

import { motion } from "framer-motion";
import { Droplets, Flame, Home, Snowflake, Ban, Bike, Ghost, RotateCcw, Users } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Bar } from "@/components/ui/Bar";
import { Panel } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Switch";
import { toast } from "@/components/ui/Toaster";
import { riderLeg, shelterFree, shelterInbound, shelterOf } from "@/lib/client/derive";
import { durLabel } from "@/lib/client/format";
import { act, useSmoothClock } from "@/lib/client/live";
import type { Rider, Shelter } from "@/lib/domain/types";
import type { Snapshot } from "@/lib/store";
import { cn } from "@/lib/utils";

const STATUS: Record<Rider["status"], { label: string; tone: "safe" | "info" | "crit" | "neutral" }> = {
  idle: { label: "Available", tone: "safe" },
  busy: { label: "On delivery", tone: "info" },
  ghosting: { label: "Unresponsive", tone: "crit" },
  offline: { label: "Offline", tone: "neutral" },
};

function RiderCard({ snap, r, now, active }: { snap: Snapshot; r: Rider; now: number; active: boolean }) {
  const leg = riderLeg(snap, r.id);
  const silentFor = Math.max(0, now - r.lastHeartbeat);
  const st = STATUS[r.status];
  const standbyFor = snap.legs.find((l) => l.standbyRiderId === r.id && (l.state === "to_pickup" || l.state === "to_drop" || l.state === "offered"));
  const hbTone = !r.silent && !r.manual ? "var(--safe)" : silentFor > 1.5 ? "var(--crit)" : "var(--warn)";
  return (
    <motion.li layout className={cn("list-none rounded-xl border p-3 transition-colors", active ? "border-ai/60 bg-ai-soft" : "border-line bg-surface2")}>
      <div className="flex items-center gap-3">
        <div
          className="relative grid size-9 shrink-0 place-items-center rounded-full border-2 bg-solid text-sm font-bold"
          style={{ borderColor: r.status === "ghosting" ? "var(--crit)" : r.status === "busy" ? "var(--info)" : "var(--line-strong)" }}
        >
          {r.name[0]}
          <span className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[var(--surface-solid)]", r.silent && "blink")} style={{ background: hbTone }} title="Heartbeat" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-semibold">
              {r.name} <span className="font-normal text-faint">· {r.area}</span>
            </span>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <div className="tabular mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-dim">
            <span className="flex items-center gap-1"><Bike className="size-3" /> {r.vehicle} · {r.capacity}</span>
            <span>{Math.round(r.reliability * 100)}% reliable</span>
            {(r.silent || r.manual) && <span style={{ color: hbTone }}>heartbeat {silentFor < 0.2 ? "now" : `${durLabel(silentFor)} ago`}</span>}
          </div>
        </div>
      </div>
      {(leg || standbyFor || r.manual) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {leg && (
            <Badge tone="info">
              {leg.qty} → {shelterOf(snap, leg.shelterId)?.area} · ETA {durLabel(leg.dropEta - now)}
            </Badge>
          )}
          {standbyFor && <Badge tone="ai">Standby</Badge>}
          {r.manual && <Badge tone="ai">Human-controlled</Badge>}
        </div>
      )}
      <div className="mt-2 flex gap-1.5">
        {r.silent ? (
          <button onClick={() => act({ type: "chaosUnghost", riderId: r.id })} className="flex items-center gap-1.5 rounded-md bg-safe-soft px-2 py-1 text-[11px] font-medium text-safe hover:brightness-125">
            <RotateCcw className="size-3" /> Revive
          </button>
        ) : (
          <button
            onClick={async () => {
              const res = await act({ type: "chaosGhost", riderId: r.id });
              if (!res.ok) toast(res.error ?? "Could not ghost rider", "crit");
            }}
            className="flex items-center gap-1.5 rounded-md bg-surface3 px-2 py-1 text-[11px] font-medium text-dim hover:bg-crit-soft hover:text-crit"
          >
            <Ghost className="size-3" /> Go silent
          </button>
        )}
      </div>
    </motion.li>
  );
}

function Fac({ on, icon, label }: { on: boolean; icon: React.ReactNode; label: string }) {
  return (
    <span title={`${label}: ${on ? "available" : "unavailable"}`} className={cn("flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium", on ? "bg-safe-soft text-safe" : "bg-crit-soft text-crit line-through")}>
      {icon}
      {label}
    </span>
  );
}

function ShelterCard({ snap, s }: { snap: Snapshot; s: Shelter }) {
  const free = shelterFree(snap, s);
  const inbound = shelterInbound(snap, s.id);
  const inQty = inbound.reduce((n, l) => n + l.qty, 0);
  const frac = s.totalCapacity ? free / s.totalCapacity : 0;
  return (
    <motion.li layout className={cn("list-none rounded-xl border border-line bg-surface2 p-3", !s.open && "opacity-80")}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{s.name}</div>
          <div className="text-[11px] text-dim">{s.area}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-faint">{s.open ? "Open" : "Closed"}</span>
          <Switch checked={s.open} onChange={(open) => act({ type: "setShelterOpen", shelterId: s.id, open })} label={`Toggle ${s.name}`} />
        </div>
      </div>
      <div className="mt-2.5">
        <div className="tabular mb-1 flex justify-between text-[11px] text-dim">
          <span>{free} free of {s.totalCapacity}</span>
          {inQty > 0 && <span style={{ color: "var(--info)" }}>{inQty} inbound</span>}
        </div>
        <Bar value={frac} tone={!s.open ? "crit" : frac < 0.15 ? "warn" : "safe"} />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => act({ type: "setShelterFacility", shelterId: s.id, key: "cleanWater", value: !s.facilities.cleanWater })}>
          <Fac on={s.facilities.cleanWater} icon={<Droplets className="size-3" />} label="Water" />
        </button>
        <button type="button" onClick={() => act({ type: "setShelterFacility", shelterId: s.id, key: "cookingFuel", value: !s.facilities.cookingFuel })}>
          <Fac on={s.facilities.cookingFuel} icon={<Flame className="size-3" />} label="Fuel" />
        </button>
        <button type="button" onClick={() => act({ type: "setShelterFacility", shelterId: s.id, key: "coldStorage", value: !s.facilities.coldStorage })}>
          <Fac on={s.facilities.coldStorage} icon={<Snowflake className="size-3" />} label="Cold" />
        </button>
        {!s.accepts.includes("medical") && (
          <span className="flex items-center gap-1 rounded-md bg-surface3 px-1.5 py-0.5 text-[10px] text-faint"><Ban className="size-3" /> No medical</span>
        )}
      </div>
    </motion.li>
  );
}

export function ResourceRail({ snap, className, focusRiderId }: { snap: Snapshot; className?: string; focusRiderId?: string | null }) {
  const [tab, setTab] = useState<"riders" | "shelters">("riders");
  const now = useSmoothClock(3) || snap.clock;
  const order = { ghosting: 0, busy: 1, idle: 2, offline: 3 } as const;
  const riders = [...snap.riders].sort((a, b) => order[a.status] - order[b.status] || a.id.localeCompare(b.id, undefined, { numeric: true }));
  return (
    <Panel
      title={tab === "riders" ? "Riders" : "Shelters"}
      icon={tab === "riders" ? <Users className="size-3.5" /> : <Home className="size-3.5" />}
      className={className}
      bodyClassName="overflow-y-auto p-3"
      actions={
        <Segmented size="sm" value={tab} onChange={setTab} options={[{ value: "riders", label: `Riders ${snap.riders.length}` }, { value: "shelters", label: `Shelters ${snap.shelters.length}` }]} />
      }
    >
      <ul className="space-y-2">
        {tab === "riders"
          ? riders.map((r) => <RiderCard key={r.id} snap={snap} r={r} now={now} active={focusRiderId === r.id} />)
          : snap.shelters.map((s) => <ShelterCard key={s.id} snap={snap} s={s} />)}
      </ul>
    </Panel>
  );
}
