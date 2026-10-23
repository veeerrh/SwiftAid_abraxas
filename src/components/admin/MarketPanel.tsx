"use client";

import { AlertTriangle, Boxes, ClipboardList, Package, Store, Truck } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { toast } from "@/components/ui/Toaster";
import { act } from "@/lib/client/live";
import { clockLabel, durLabel, type Tone } from "@/lib/client/format";
import type { OrderStatus } from "@/lib/domain/market";
import { TERMINAL_ORDER } from "@/lib/domain/market";
import type { Snapshot } from "@/lib/store";

const TONE: Record<OrderStatus, Tone> = {
  pending_donor: "warn",
  awaiting_rider: "info",
  rider_assigned: "info",
  in_transit: "info",
  awaiting_receipt: "ai",
  delivered: "safe",
  partial: "warn",
  rejected: "crit",
  cancelled: "neutral",
  expired: "crit",
  failed: "crit",
};

/** Everything happening in the marketplace: listings, requests, orders and the escalation queue. */
export function MarketPanel({ snap }: { snap: Snapshot }) {
  const [tab, setTab] = useState<"orders" | "listings" | "requests">("orders");
  const m = snap.market;
  const now = snap.clock;
  const donor = (id: string) => snap.donors.find((d) => d.id === id)?.name ?? id;
  const shelter = (id: string) => snap.shelters.find((s) => s.id === id)?.name ?? id;
  const live = m.orders.filter((o) => !TERMINAL_ORDER.includes(o.status));
  const escalated = live.filter((o) => o.urgency >= 2 && (o.status === "awaiting_rider" || o.status === "rider_assigned"));
  const freeRiders = snap.riders.filter((r) => r.status === "idle" && !r.silent);

  const stats = [
    { icon: <Package className="size-3.5" />, label: "Open listings", v: m.listings.filter((l) => l.status === "available").length },
    { icon: <ClipboardList className="size-3.5" />, label: "Open requests", v: m.requests.filter((r) => r.status === "open" || r.status === "partial").length },
    { icon: <Truck className="size-3.5" />, label: "Live orders", v: live.length },
    { icon: <AlertTriangle className="size-3.5" />, label: "Needs attention", v: escalated.length + live.filter((o) => o.risk !== "ok").length },
  ];

  return (
    <div className="space-y-4 p-5">
      <div className="grid grid-cols-4 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-surface2 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 text-faint">{s.icon}</div>
            <div className="tabular mt-1 text-xl font-semibold">{s.v}</div>
            <div className="text-[9px] uppercase tracking-wide text-faint">{s.label}</div>
          </div>
        ))}
      </div>

      {escalated.length > 0 && (
        <div className="rounded-xl border border-crit/50 bg-crit-soft p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-crit">
            <AlertTriangle className="size-4" /> Escalations: no rider has taken these trips
          </div>
          {escalated.map((o) => (
            <div key={o.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span>
                {o.qty} {o.unit} of {o.label} → {shelter(o.shelterId)}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {freeRiders.slice(0, 3).map((r) => (
                  <Button key={r.id} size="sm" variant="outline" onClick={() => act({ type: "acceptTrip", riderId: r.id, orderId: o.id, force: true }).then((x) => (x.ok ? toast(`${r.name} assigned`, "safe") : toast(x.error ?? "Could not assign", "crit")))}>
                    Assign {r.name}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Segmented size="sm" value={tab} onChange={setTab} options={[{ value: "orders", label: `Orders ${m.orders.length}` }, { value: "listings", label: `Listings ${m.listings.length}` }, { value: "requests", label: `Requests ${m.requests.length}` }]} />

      <ul className="space-y-2">
        {tab === "orders" &&
          [...m.orders].reverse().map((o) => (
            <li key={o.id} className="rounded-xl border border-line bg-surface2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 truncate text-[13px] font-semibold">
                  {o.qty} {o.unit} · {o.label}
                </div>
                <Badge tone={o.risk === "breached" ? "crit" : TONE[o.status]}>{o.risk === "breached" ? "will expire" : o.status.replace(/_/g, " ")}</Badge>
              </div>
              <div className="text-[11px] text-dim">
                {donor(o.donorId)} → {shelter(o.shelterId)}
                {o.divertedFrom && <span className="ml-1 text-warn">(rerouted)</span>}
              </div>
              {!TERMINAL_ORDER.includes(o.status) && <div className="tabular mt-1 text-[11px] text-faint">fit for {durLabel(o.expiresAt - now)} · safe deadline {clockLabel(snap, o.bufferedDeadline)}</div>}
              {o.closedReason && TERMINAL_ORDER.includes(o.status) && <div className="mt-1 text-[11px] text-dim">{o.closedReason}</div>}
            </li>
          ))}
        {tab === "listings" &&
          [...m.listings].reverse().map((l) => (
            <li key={l.id} className="rounded-xl border border-line bg-surface2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 truncate text-[13px] font-semibold">{l.label}</div>
                <Badge tone={l.status === "available" ? "safe" : l.status === "exhausted" ? "info" : "neutral"}>{l.status}</Badge>
              </div>
              <div className="text-[11px] text-dim">
                {donor(l.donorId)} · {l.availableQty}/{l.qty} {l.unit} unreserved
              </div>
              {l.status === "available" && <div className="tabular mt-1 text-[11px] text-faint">fit until {clockLabel(snap, l.expiresAt)} ({durLabel(l.expiresAt - now)})</div>}
            </li>
          ))}
        {tab === "requests" &&
          [...m.requests].reverse().map((r) => (
            <li key={r.id} className="rounded-xl border border-line bg-surface2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 truncate text-[13px] font-semibold">
                  {shelter(r.shelterId)} · {r.label}
                </div>
                <Badge tone={r.status === "fulfilled" ? "safe" : r.priority === "critical" ? "crit" : r.priority === "high" ? "warn" : "neutral"}>{r.status === "open" || r.status === "partial" ? r.priority : r.status}</Badge>
              </div>
              <div className="tabular text-[11px] text-dim">
                {r.deliveredQty} delivered · {r.remainingQty} to cover of {r.qty} {r.unit}
              </div>
            </li>
          ))}
      </ul>
      {m.orders.length === 0 && tab === "orders" && (
        <p className="py-6 text-center text-sm text-dim">
          <Boxes className="mx-auto mb-2 size-6 text-faint" />
          No orders yet. Place one from the shelter portal.
        </p>
      )}
      <p className="flex items-center gap-1.5 text-[11px] text-faint">
        <Store className="size-3" /> The control room sees every organisation; each portal sees its own work.
      </p>
    </div>
  );
}
