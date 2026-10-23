"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRightLeft, Check, Flag, Ghost, HeartPulse, MapPin, PackageCheck, Radio, Route, Store, UserRoundCog } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LiveMap } from "@/components/map/LiveMap";
import { TopBar } from "@/components/shell/TopBar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Ring } from "@/components/ui/Ring";
import { Panel } from "@/components/ui/Panel";
import { Switch } from "@/components/ui/Switch";
import { Toaster, toast } from "@/components/ui/Toaster";
import { batchOf, donorOf, riderOf, shelterOf } from "@/lib/client/derive";
import { clockLabel, durLabel, pct, survivalTone } from "@/lib/client/format";
import { act, useSmoothClock, useSnapshot } from "@/lib/client/live";
import type { Leg } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const ACTIVE = ["offered", "to_pickup", "to_drop"];

export default function RiderPage() {
  const snap = useSnapshot();
  const now = useSmoothClock(5) || snap?.clock || 0;
  const [riderId, setRiderId] = useState("R1");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("r");
    const saved = (() => {
      try {
        return localStorage.getItem("swiftaid-rider");
      } catch {
        return null;
      }
    })();
    const pick = q ?? saved;
    if (pick) setRiderId(pick);
  }, []);
  const choose = (id: string) => {
    setRiderId(id);
    try {
      localStorage.setItem("swiftaid-rider", id);
    } catch {
      /* ignore */
    }
  };

  const rider = snap ? riderOf(snap, riderId) : undefined;

  // A person is using this rider app: marks the rider as human-controlled and alive.
  useEffect(() => {
    const ping = () => void act({ type: "presence", role: "rider", id: riderId });
    ping();
    const t = setInterval(ping, 1500);
    return () => clearInterval(t);
  }, [riderId]);

  // Heartbeats keep a human-controlled rider's leases alive.
  useEffect(() => {
    if (!rider?.manual || rider.silent) return;
    const id = setInterval(() => void act({ type: "heartbeat", riderId: rider.id }), 1800);
    void act({ type: "heartbeat", riderId: rider.id });
    return () => clearInterval(id);
  }, [rider?.id, rider?.manual, rider?.silent]);

  const leg = useMemo(() => snap?.legs.find((l) => l.riderId === riderId && ACTIVE.includes(l.state)), [snap, riderId]);
  const lastDone = useMemo(() => [...(snap?.legs ?? [])].reverse().find((l) => l.riderId === riderId && l.state === "delivered"), [snap, riderId]);

  const myEvents = useMemo(() => [...(snap?.events ?? [])].reverse().filter((e) => e.riderId === riderId).slice(0, 25), [snap, riderId]);

  if (!snap || !rider) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <div className="glass rounded-xl px-6 py-4 text-sm text-dim">Connecting…</div>
      </main>
    );
  }
  const batch = leg ? batchOf(snap, leg.batchId) : undefined;
  const donor = batch ? donorOf(snap, batch.donorId) : undefined;
  const shelter = leg ? shelterOf(snap, leg.shelterId) : undefined;
  const silentFor = Math.max(0, now - rider.lastHeartbeat);
  const recentDivert = leg?.divertedFrom && leg.divertedAt !== undefined && now - leg.divertedAt < 10;
  const leaseLeft = leg ? Math.max(0, leg.leaseTtl - silentFor) : 0;

  return (
    <main className="min-h-dvh bg-bg">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-3 sm:p-5">
        <TopBar />
        <div className="grid items-start gap-6 lg:grid-cols-[320px_390px_340px] lg:justify-center">
          {/* Controls */}
          <section className="glass space-y-4 rounded-2xl p-5 lg:sticky lg:top-5">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">Playing as</div>
              <select
                value={riderId}
                onChange={(e) => choose(e.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-line-strong bg-solid px-3 text-sm font-medium outline-none focus:border-safe"
              >
                {snap.riders.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.area} · {r.vehicle}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-xl bg-surface2 p-3.5">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <UserRoundCog className="size-4 text-ai" /> Take control
                </div>
                <p className="mt-1 text-xs leading-relaxed text-dim">
                  You decide: accept or decline offers, and keep the heartbeat alive. Without control the rider is auto-piloted.
                </p>
              </div>
              <Switch
                checked={rider.manual}
                onChange={(manual) => void act({ type: "setRiderManual", riderId, manual })}
                label="Take control"
              />
            </div>
            <div className="rounded-xl border border-line p-3.5 text-xs leading-relaxed text-dim">
              <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
                <HeartPulse className="size-3.5" /> How leases work
              </div>
              Every accepted delivery is a <span className="text-ink">lease</span>. Its length shrinks with the cargo&apos;s remaining shelf life. If your heartbeat stops, the lease is released and
              another rider takes over, so nothing is stuck behind a ghost reservation.
            </div>
          </section>

          {/* Phone */}
          <div className="relative mx-auto h-[min(800px,calc(100dvh-120px))] min-h-[640px] w-full max-w-[390px] overflow-hidden rounded-[44px] border-[9px] border-[color:var(--line-strong)] bg-bg shadow-[var(--shadow)]">
            <div className="absolute left-1/2 top-2 z-30 h-5 w-24 -translate-x-1/2 rounded-full bg-black/80" />
            <div className="flex h-full flex-col pt-9">
              <div className="flex items-center gap-3 px-5 pb-3">
                <div className={cn("relative grid size-11 place-items-center rounded-full border-2 bg-solid text-base font-bold", rider.status === "ghosting" ? "border-crit text-crit" : rider.status === "busy" ? "border-info" : "border-line-strong")}>
                  {rider.name[0]}
                  <span className={cn("absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-[var(--bg)]", rider.silent ? "blink bg-crit" : rider.manual ? "bg-ai" : "bg-safe")} />
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-[15px] font-semibold">{rider.name}</div>
                  <div className="text-[11px] text-dim">
                    {rider.area} · {rider.vehicle} · up to {rider.capacity} units
                  </div>
                </div>
                <Badge tone={rider.status === "ghosting" ? "crit" : rider.status === "busy" ? "info" : "safe"} dot>
                  {rider.status === "ghosting" ? "Silent" : rider.status === "busy" ? "On task" : "Available"}
                </Badge>
              </div>

              <div className="relative mx-4 h-[210px] shrink-0 overflow-hidden rounded-2xl border border-line">
                <LiveMap
                  interactive={false}
                  showLabels={false}
                  onlyRiderId={riderId}
                  onlyBatchId={leg?.batchId ?? "none"}
                  onlyShelterId={leg?.shelterId ?? "none"}
                  highlightRiderId={riderId}
                />
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                <AnimatePresence mode="popLayout">
                  {rider.silent && (
                    <motion.div key="silent" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border border-crit/50 bg-crit-soft p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-crit">
                        <Ghost className="size-4" /> You&apos;ve gone silent
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-dim">
                        {leg ? `Your lease is released in ${durLabel(leaseLeft)} and the cargo is reassigned.` : "No heartbeat is being sent."}
                      </p>
                      <Button size="sm" variant="primary" className="mt-3" onClick={() => void act({ type: "setRiderSilent", riderId, silent: false })}>
                        I&apos;m back
                      </Button>
                    </motion.div>
                  )}

                  {recentDivert && leg && (
                    <motion.div key="divert" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="rounded-2xl border border-warn/50 bg-warn-soft p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-warn">
                        <ArrowRightLeft className="size-4" /> Rerouted
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-dim">
                        {shelterOf(snap, leg.divertedFrom!)?.name} can no longer take this. New destination: <span className="font-semibold text-ink">{shelter?.name}</span>.
                      </p>
                    </motion.div>
                  )}

                  {leg && batch ? (
                    <TaskCard key={leg.id} leg={leg} now={now} unit={batch.unit} label={batch.label} donorName={donor?.name ?? ""} shelterName={shelter?.name ?? ""} manual={rider.manual} riderId={riderId} silent={rider.silent} />
                  ) : (
                    !rider.silent && (
                      <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl border border-line bg-surface2 p-5 text-center">
                        <Radio className="mx-auto size-7 text-safe" style={{ animation: "drift 3s ease-in-out infinite" }} />
                        <div className="mt-2 text-sm font-semibold">You&apos;re available</div>
                        <p className="mt-1 text-xs leading-relaxed text-dim">New offers appear here the moment a donor posts something you can safely deliver.</p>
                        {lastDone && (
                          <div className="mt-4 flex items-center gap-2 rounded-xl bg-safe-soft px-3 py-2 text-left text-xs text-safe">
                            <PackageCheck className="size-4 shrink-0" />
                            Last drop: {lastDone.qty} units to {shelterOf(snap, lastDone.shelterId)?.area}
                          </div>
                        )}
                      </motion.div>
                    )
                  )}
                </AnimatePresence>

                {!leg && !rider.silent && <TripBoard trips={snap.board[riderId] ?? []} riderId={riderId} now={now} donorName={(d) => donorOf(snap, d)?.name ?? d} shelterName={(sh) => shelterOf(snap, sh)?.name ?? sh} />}
                {leg?.orderId && <HandoverBox leg={leg} orderId={leg.orderId} />}

                {!rider.silent && (
                  <button
                    onClick={async () => {
                      const r = await act({ type: "setRiderSilent", riderId, silent: true });
                      if (r.ok) toast("You went silent. Watch the control room.", "warn");
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-crit/40 px-3 py-2.5 text-xs font-medium text-crit/90 transition hover:bg-crit-soft"
                  >
                    <AlertTriangle className="size-3.5" /> Simulate: I&apos;m stuck / unresponsive
                  </button>
                )}
              </div>
            </div>
          </div>

          <aside className="lg:sticky lg:top-5">
            <Panel title="Your activity" icon={<Radio className="size-3.5" />} className="max-h-[min(800px,calc(100dvh-120px))]" bodyClassName="overflow-y-auto">
              {myEvents.length === 0 ? (
                <div className="p-6 text-center text-sm text-dim">Nothing yet. Offers, pickups and reroutes show up here.</div>
              ) : (
                <ul className="divide-y divide-line">
                  {myEvents.map((e) => (
                    <li key={e.id} className="px-4 py-2.5 text-xs leading-snug">
                      {e.text}
                      <div className="tabular mt-0.5 font-mono text-[10px] text-faint">{clockLabel(snap, e.at)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </aside>
        </div>
      </div>
      <Toaster />
    </main>
  );
}

function TaskCard({
  leg,
  now,
  unit,
  label,
  donorName,
  shelterName,
  manual,
  riderId,
  silent,
}: {
  leg: Leg;
  now: number;
  unit: string;
  label: string;
  donorName: string;
  shelterName: string;
  manual: boolean;
  riderId: string;
  silent: boolean;
}) {
  const offered = leg.state === "offered";
  const step = leg.state === "offered" ? 0 : leg.state === "to_pickup" ? 1 : 2;
  const eta = Math.max(0, leg.dropEta - now);
  const offerLeft = Math.max(0, leg.offerExpiresAt - now);
  const offerTotal = Math.max(0.1, leg.offerExpiresAt - leg.createdAt);
  const surv = leg.survival?.p;
  const steps = [
    { icon: Flag, label: "Offer" },
    { icon: Store, label: "Pickup" },
    { icon: MapPin, label: "Drop-off" },
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="glass rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">{offered ? "New delivery offer" : "Active delivery"}</div>
          <div className="mt-1 text-lg font-semibold leading-tight">
            {leg.qty} {unit}
          </div>
          <div className="truncate text-xs text-dim">{label}</div>
        </div>
        {offered ? (
          <Ring value={offerLeft / offerTotal} size={52} tone={offerLeft / offerTotal < 0.4 ? "warn" : "safe"}>
            <span className="tabular text-[11px] font-semibold">{Math.ceil(offerLeft * 60)}s</span>
          </Ring>
        ) : (
          <div className="text-right">
            <div className="tabular text-lg font-semibold">{durLabel(eta)}</div>
            <div className="text-[10px] uppercase tracking-wide text-faint">to drop-off</div>
          </div>
        )}
      </div>

      <ol className="my-4 flex items-center">
        {steps.map((s, i) => (
          <li key={s.label} className="flex flex-1 items-center last:flex-none">
            <div className={cn("grid size-8 place-items-center rounded-full border text-xs transition-colors", i < step ? "border-safe bg-safe text-[#04201c]" : i === step ? "border-safe text-safe shadow-[var(--glow-safe)]" : "border-line text-faint")}>
              {i < step ? <Check className="size-4" /> : <s.icon className="size-3.5" />}
            </div>
            {i < steps.length - 1 && <div className={cn("mx-1 h-0.5 flex-1 rounded", i < step ? "bg-safe" : "bg-line")} />}
          </li>
        ))}
      </ol>

      <div className="space-y-2 text-xs">
        <Row icon={<Store className="size-3.5 text-info" />} k="Pickup" v={donorName} />
        <Row icon={<MapPin className="size-3.5 text-safe" />} k="Drop-off" v={shelterName} />
        {surv !== undefined && (
          <Row icon={<Route className="size-3.5 text-ai" />} k="Arrives safely" v={<Badge tone={survivalTone(surv)}>{pct(surv)}</Badge>} />
        )}
      </div>

      {offered && manual && !silent && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => void act({ type: "declineLeg", legId: leg.id })}>
            Decline
          </Button>
          <Button variant="primary" onClick={async () => {
            const r = await act({ type: "acceptLeg", legId: leg.id });
            if (!r.ok) toast(r.error ?? "Could not accept", "crit");
          }}>
            Accept
          </Button>
        </div>
      )}
      {offered && !manual && (
        <p className="mt-3 rounded-lg bg-surface2 px-3 py-2 text-[11px] leading-relaxed text-dim">Auto-pilot will accept for you. Switch on “Take control” to accept or decline yourself.</p>
      )}
      {!offered && manual && !silent && (
        <p className="mt-3 flex items-center gap-2 text-[11px] text-safe">
          <span className="size-1.5 animate-pulse rounded-full bg-safe" /> Heartbeat live — lease {durLabel(leg.leaseTtl)} if it stops
        </p>
      )}
      {!offered && !manual && (
        <p className="mt-3 text-[11px] text-faint" data-rider={riderId}>
          Auto-pilot is driving. Take control to own the heartbeat.
        </p>
      )}
    </motion.div>
  );
}

function Row({ icon, k, v }: { icon: React.ReactNode; k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-dim">
        {icon}
        {k}
      </span>
      <span className="truncate text-right font-medium">{v}</span>
    </div>
  );
}

function TripBoard({ trips, riderId, now, donorName, shelterName }: { trips: import("@/lib/market/engine").TripOffer[]; riderId: string; now: number; donorName: (d: string) => string; shelterName: (s: string) => string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
        <span>Trips you can finish in time</span>
        <span className="tabular">{trips.length}</span>
      </div>
      {trips.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface2 p-5 text-center">
          <Radio className="mx-auto size-6 text-safe" style={{ animation: "drift 3s ease-in-out infinite" }} />
          <div className="mt-2 text-sm font-semibold">No trips right now</div>
          <p className="mt-1 text-xs leading-relaxed text-dim">Trips only appear if you can reach the donor and deliver before the supplies expire, with a safety buffer.</p>
        </div>
      )}
      {trips.map((t) => (
        <div key={t.orderId} className="glass rounded-2xl p-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {t.qty} {t.unit} · {t.label}
              </div>
              <div className="truncate text-[11px] text-dim">
                {donorName(t.donorId)} → {shelterName(t.shelterId)}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              {t.priority !== "normal" && <Badge tone={t.priority === "critical" ? "crit" : "warn"}>{t.priority}</Badge>}
              {t.urgency > 0 && <Badge tone="warn">urgent</Badge>}
            </div>
          </div>
          <div className="tabular mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="rounded-lg bg-surface2 py-1.5">
              <div className="text-sm font-semibold">{Math.round(t.rideMin)}m</div>
              <div className="text-faint">to donor</div>
            </div>
            <div className="rounded-lg bg-surface2 py-1.5">
              <div className="text-sm font-semibold">{Math.round(t.legMin)}m</div>
              <div className="text-faint">donor to shelter</div>
            </div>
            <div className="rounded-lg bg-surface2 py-1.5">
              <div className="text-sm font-semibold">{Math.max(0, Math.round(t.bufferedDeadline - now))}m</div>
              <div className="text-faint">safe window</div>
            </div>
          </div>
          {t.coldChain && <div className="mt-1.5 text-[11px] text-info">Cold chain: keep in your insulated box</div>}
          {t.remainingQty > t.qty && <div className="mt-1 text-[11px] text-dim">Part of a larger order ({t.remainingQty} still to collect)</div>}
          <Button size="sm" variant="primary" className="mt-2.5 w-full" onClick={async () => { const r = await act({ type: "acceptTrip", riderId, orderId: t.orderId }); if (!r.ok) toast(r.error ?? "Trip is no longer available", "crit"); }}>
            Claim this trip
          </Button>
        </div>
      ))}
    </div>
  );
}

function HandoverBox({ leg, orderId }: { leg: import("@/lib/domain/types").Leg; orderId: string }) {
  const [code, setCode] = useState("");
  const atPickup = leg.state === "to_pickup" && leg.handoverSince !== undefined && !leg.pickupConfirmed;
  const atDrop = leg.receipt === "pending";
  if (!atPickup && !atDrop) return null;
  const submit = async () => {
    const r = atPickup ? await act({ type: "confirmPickup", orderId, by: "rider", code }) : await act({ type: "confirmReceipt", orderId, accept: true, by: "rider", code });
    if (!r.ok) toast(r.error ?? "Code not accepted", "crit");
    else setCode("");
  };
  return (
    <div className="rounded-2xl border border-ai/40 bg-ai-soft p-3.5">
      <div className="text-xs font-semibold text-ai">{atPickup ? "Waiting for the donor to hand over" : "Waiting for the shelter to confirm receipt"}</div>
      <p className="mt-1 text-[11px] leading-snug text-dim">{atPickup ? "Ask the donor for their 4-digit handover code, or wait for them to confirm." : "Ask the shelter for their 4-digit receipt code, or wait for them to accept."}</p>
      <div className="mt-2 flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="0000" className="tabular h-9 w-24 rounded-lg border border-line-strong bg-solid text-center font-mono text-sm outline-none focus:border-ai" />
        <Button size="sm" variant="ai" disabled={code.length !== 4} onClick={submit}>
          Confirm code
        </Button>
      </div>
    </div>
  );
}
