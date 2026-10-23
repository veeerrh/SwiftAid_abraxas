"use client";

import { Baby, CarFront, DoorClosed, FastForward, Ghost, Hourglass, Pause, Pill, Play, RotateCcw, Soup, Users, Utensils, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { toast } from "@/components/ui/Toaster";
import type { Action } from "@/lib/actions";
import { act } from "@/lib/client/live";
import type { Snapshot } from "@/lib/store";
import { cn } from "@/lib/utils";

function Tile({ icon, label, tone, onClick }: { icon: ReactNode; label: string; tone: "crit" | "warn" | "info" | "safe"; onClick: () => void }) {
  const tones = {
    crit: "hover:bg-crit-soft hover:text-crit",
    warn: "hover:bg-warn-soft hover:text-warn",
    info: "hover:bg-info-soft hover:text-info",
    safe: "hover:bg-safe-soft hover:text-safe",
  };
  return (
    <button onClick={onClick} className={cn("flex flex-col items-center justify-center gap-1.5 rounded-lg bg-surface2 px-1.5 py-2.5 text-center text-[11px] font-medium leading-tight text-dim transition active:scale-95", tones[tone])}>
      {icon}
      {label}
    </button>
  );
}

const RATES = [
  { value: "0.25", label: "1×" },
  { value: "0.5", label: "2×" },
  { value: "1", label: "4×" },
  { value: "2", label: "8×" },
];

export function ChaosPanel({ snap, className }: { snap: Snapshot; className?: string }) {
  const run = async (a: Action, ok?: string) => {
    const res = await act(a);
    if (!res.ok) toast(res.error ?? "Action failed", "crit");
    else if (ok) toast(ok, "info");
  };
  return (
    <Panel
      title="Chaos panel"
      icon={<Zap className="size-3.5 text-warn" />}
      className={className}
      bodyClassName="space-y-3 p-3"
      actions={<span className="text-[10px] uppercase tracking-wide text-faint">Inject live failures</span>}
    >
      <div className="grid grid-cols-3 gap-1.5">
        <Tile tone="crit" icon={<Ghost className="size-4" />} label="Ghost a rider" onClick={() => run({ type: "chaosGhost" })} />
        <Tile tone="crit" icon={<DoorClosed className="size-4" />} label="Close shelter" onClick={() => run({ type: "chaosCloseShelter" })} />
        <Tile tone="warn" icon={<Users className="size-4" />} label="Citizen fills shelter" onClick={() => run({ type: "chaosSurge" })} />
        <Tile tone="warn" icon={<CarFront className="size-4" />} label="Traffic jam" onClick={() => run({ type: "chaosTraffic", factor: 2.3, durationMin: 15 })} />
        <Tile tone="warn" icon={<Hourglass className="size-4" />} label="Tight expiry" onClick={() => run({ type: "chaosTightExpiry" })} />
        <Tile tone="info" icon={<Utensils className="size-4" />} label="Banquet · 180" onClick={() => run({ type: "scenario", key: "banquet" })} />
        <Tile tone="info" icon={<Baby className="size-4" />} label="Infant formula" onClick={() => run({ type: "scenario", key: "formula" })} />
        <Tile tone="info" icon={<Pill className="size-4" />} label="Cold-chain meds" onClick={() => run({ type: "scenario", key: "pharmacy" })} />
        <Tile tone="info" icon={<Soup className="size-4" />} label="Evening rush" onClick={() => run({ type: "scenario", key: "rush" })} />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
        <button
          onClick={() => run({ type: snap.running ? "pause" : "resume" })}
          className="grid size-9 place-items-center rounded-lg bg-surface3 text-ink transition hover:brightness-125"
          aria-label={snap.running ? "Pause simulation" : "Resume simulation"}
        >
          {snap.running ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <Segmented size="sm" value={String(snap.rate)} options={RATES} onChange={(v) => run({ type: "setRate", rate: Number(v) })} />
        <button onClick={() => run({ type: "step", minutes: 5 })} className="flex h-9 items-center gap-1.5 rounded-lg bg-surface2 px-2.5 text-[11px] font-medium text-dim hover:bg-surface3 hover:text-ink" title="Skip ahead five minutes">
          <FastForward className="size-3.5" /> +5 min
        </button>
        <button onClick={() => run({ type: "reset", scenario: "rush" }, "City reset")} className="flex h-9 items-center gap-1.5 rounded-lg bg-surface2 px-2.5 text-[11px] font-medium text-dim hover:bg-crit-soft hover:text-crit" title="Reset the simulation">
          <RotateCcw className="size-3.5" /> Reset
        </button>
      </div>
    </Panel>
  );
}
