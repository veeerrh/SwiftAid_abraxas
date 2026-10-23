"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Baby, Droplets, DoorClosed, DoorOpen, Flame, HandHeart, PackageCheck, Pill, Snowflake, Truck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { LiveMap } from "@/components/map/LiveMap";
import { TopBar } from "@/components/shell/TopBar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Switch } from "@/components/ui/Switch";
import { Toaster, toast } from "@/components/ui/Toaster";
import { batchOf, riderOf, shelterFree, shelterInbound } from "@/lib/client/derive";
import { durLabel, pct, survivalTone } from "@/lib/client/format";
import { act, useSmoothClock, useSnapshot } from "@/lib/client/live";
import { cn } from "@/lib/utils";

function Gauge({ free, total, open }: { free: number; total: number; open: boolean }) {
  const size = 230;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = total ? free / total : 0;
  const color = !open ? "var(--crit)" : frac < 0.15 ? "var(--warn)" : "var(--safe)";
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: "stroke-dashoffset 700ms var(--ease), stroke 400ms", filter: `drop-shadow(0 0 10px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="tabular text-5xl font-semibold tracking-tight">{free}</div>
          <div className="mt-0.5 text-xs text-dim">free of {total}</div>
          <div className="mt-2">
            <Badge tone={!open ? "crit" : free === 0 ? "warn" : "safe"} dot>
              {!open ? "Intake closed" : free === 0 ? "Full" : "Accepting"}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ShelterPage() {
  const snap = useSnapshot();
  const now = useSmoothClock(4) || snap?.clock || 0;
  const [id, setId] = useState("S1");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("s");
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("swiftaid-shelter");
    } catch {
      /* ignore */
    }
    if (q ?? saved) setId((q ?? saved)!);
  }, []);
  const choose = (v: string) => {
    setId(v);
    try {
      localStorage.setItem("swiftaid-shelter", v);
    } catch {
      /* ignore */
    }
  };

  const s = snap?.shelters.find((x) => x.id === id);
  if (!snap || !s) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <div className="glass rounded-xl px-6 py-4 text-sm text-dim">Connecting…</div>
      </main>
    );
  }

  const free = shelterFree(snap, s);
  const inbound = shelterInbound(snap, s.id);
  const delivered = [...snap.legs].reverse().filter((l) => l.shelterId === s.id && l.state === "delivered").slice(0, 5);
  const facilities = [
    { key: "cleanWater" as const, icon: Droplets, label: "Clean water", unlocks: "Infant formula", icon2: Baby },
    { key: "cookingFuel" as const, icon: Flame, label: "Cooking fuel", unlocks: "Raw ration kits", icon2: PackageCheck },
    { key: "coldStorage" as const, icon: Snowflake, label: "Cold storage", unlocks: "Cold-chain medicine", icon2: Pill },
  ];

  return (
    <main className="min-h-dvh bg-bg">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-3 sm:p-5">
        <TopBar />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{s.name}</h1>
            <p className="text-sm text-dim">Shelter portal · {s.area}</p>
          </div>
          <select value={id} onChange={(e) => choose(e.target.value)} className="h-11 rounded-xl border border-line-strong bg-solid px-3 text-sm font-medium outline-none focus:border-safe">
            {snap.shelters.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
          <div className="space-y-4">
            <Panel title="Capacity" icon={<Users className="size-3.5" />} bodyClassName="space-y-5 p-5">
              <Gauge free={free} total={s.totalCapacity} open={s.open} />
              {inbound.length > 0 && (
                <p className="text-center text-xs text-dim">
                  <span className="font-semibold text-info">{inbound.reduce((n, l) => n + l.qty, 0)}</span> units already promised to inbound riders
                </p>
              )}
              <div className="flex items-center justify-between rounded-xl bg-surface2 p-3.5">
                <div className="flex items-center gap-3">
                  {s.open ? <DoorOpen className="size-5 text-safe" /> : <DoorClosed className="size-5 text-crit" />}
                  <div>
                    <div className="text-sm font-semibold">{s.open ? "Accepting deliveries" : "Intake closed"}</div>
                    <div className="text-[11px] text-dim">Closing diverts every inbound rider immediately</div>
                  </div>
                </div>
                <Switch checked={s.open} onChange={(open) => void act({ type: "setShelterOpen", shelterId: s.id, open })} label="Accepting deliveries" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="danger" icon={<HandHeart className="size-4" />} onClick={async () => {
                  const r = await act({ type: "setShelterRemaining", shelterId: s.id, remaining: 0 });
                  toast(r.ok ? "Marked full. Inbound riders are being rerouted." : (r.error ?? "Failed"), r.ok ? "warn" : "crit");
                }}>
                  Mark full
                </Button>
                <Button variant="ghost" onClick={() => void act({ type: "setShelterRemaining", shelterId: s.id, remaining: s.totalCapacity })}>
                  Reset capacity
                </Button>
              </div>
              <div>
                <label className="mb-1.5 flex justify-between text-[11px] font-medium text-dim">
                  <span>Adjust remaining capacity</span>
                  <span className="tabular text-ink">{s.capacityRemaining}</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={s.totalCapacity}
                  value={s.capacityRemaining}
                  onChange={(e) => void act({ type: "setShelterRemaining", shelterId: s.id, remaining: Number(e.target.value) })}
                  className="w-full accent-[var(--safe)]"
                />
              </div>
              <div className="rounded-xl border border-dashed border-line-strong p-3.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">A neighbour just dropped food off</div>
                <div className="mt-2 flex gap-2">
                  {[10, 25, 50].map((n) => (
                    <button key={n} onClick={() => void act({ type: "citizenDrop", shelterId: s.id, amount: n })} className="flex-1 rounded-lg bg-surface2 py-2 text-xs font-medium transition hover:bg-warn-soft hover:text-warn">
                      −{n}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-dim">Use this to fill your demand mid-delivery. Riders on the way are redirected.</p>
              </div>
            </Panel>

            <Panel title="What we can safely receive" icon={<Droplets className="size-3.5" />} bodyClassName="space-y-2 p-4">
              {facilities.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-3 rounded-xl bg-surface2 p-3">
                  <div className="flex items-center gap-3">
                    <span className={cn("grid size-9 place-items-center rounded-lg", s.facilities[f.key] ? "bg-safe-soft text-safe" : "bg-crit-soft text-crit")}>
                      <f.icon className="size-4" />
                    </span>
                    <div>
                      <div className="text-[13px] font-semibold">{f.label}</div>
                      <div className="text-[11px] text-dim">
                        {s.facilities[f.key] ? "Unlocks" : "Blocks"}: {f.unlocks}
                      </div>
                    </div>
                  </div>
                  <Switch checked={s.facilities[f.key]} onChange={(value) => void act({ type: "setShelterFacility", shelterId: s.id, key: f.key, value })} label={f.label} />
                </div>
              ))}
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Inbound deliveries" icon={<Truck className="size-3.5" />} actions={<span className="tabular text-[11px] text-faint">{inbound.length}</span>} bodyClassName="p-3">
              {inbound.length === 0 ? (
                <div className="grid place-items-center py-10 text-center text-sm text-dim">Nothing inbound right now.</div>
              ) : (
                <ul className="space-y-2">
                  <AnimatePresence initial={false}>
                    {inbound.map((l) => {
                      const r = riderOf(snap, l.riderId);
                      const b = batchOf(snap, l.batchId);
                      const left = b ? b.expiresAt - now : 0;
                      return (
                        <motion.li key={l.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 24 }} className="rounded-xl border border-line bg-surface2 p-3.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">
                                {l.qty} {b?.unit} · {b?.label}
                              </div>
                              <div className="text-[11px] text-dim">
                                {r?.name} · {l.state === "to_drop" ? "on the way to you" : l.state === "offered" ? "awaiting rider" : "collecting from donor"}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="tabular text-base font-semibold">{durLabel(l.dropEta - now)}</div>
                              <div className="text-[10px] uppercase tracking-wide text-faint">ETA</div>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {l.survival && <Badge tone={survivalTone(l.survival.p)}>{pct(l.survival.p)} arrives safe</Badge>}
                            <Badge tone={left < 15 ? "crit" : left < 40 ? "warn" : "neutral"}>safe for {durLabel(left)}</Badge>
                            {l.divertedFrom && <Badge tone="warn">rerouted to you</Badge>}
                          </div>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              )}
            </Panel>

            <div className="grid gap-4 md:grid-cols-2">
              <Panel title="Inbound map" className="h-72 overflow-hidden" bodyClassName="relative">
                <LiveMap interactive={false} onlyShelterId={s.id} showLabels={false} />
              </Panel>
              <Panel title="Recently received" icon={<PackageCheck className="size-3.5" />} className="h-72" bodyClassName="overflow-y-auto p-3">
                {delivered.length === 0 ? (
                  <div className="grid h-full place-items-center text-sm text-dim">No deliveries yet.</div>
                ) : (
                  <ul className="space-y-2">
                    {delivered.map((l) => (
                      <li key={l.id} className="flex items-center justify-between rounded-lg bg-surface2 px-3 py-2 text-xs">
                        <span className="font-medium">
                          {l.qty} {batchOf(snap, l.batchId)?.unit}
                        </span>
                        <span className="text-dim">from {riderOf(snap, l.riderId)?.name}</span>
                        <Badge tone="safe">received</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        </div>
      </div>
      <Toaster />
    </main>
  );
}
