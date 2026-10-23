"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, ClipboardList, Clock, MapPin, Minus, PackageCheck, Plus, Route, Sparkles, Store, Truck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LiveMap } from "@/components/map/LiveMap";
import { TopBar } from "@/components/shell/TopBar";
import { Badge } from "@/components/ui/Badge";
import { Bar } from "@/components/ui/Bar";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Toaster, toast } from "@/components/ui/Toaster";
import { clockLabel, durLabel, type Tone } from "@/lib/client/format";
import { act, useSmoothClock, useSnapshot } from "@/lib/client/live";
import type { Order, OrderStatus, Priority } from "@/lib/domain/market";
import { TERMINAL_ORDER } from "@/lib/domain/market";
import { CATEGORY_META } from "@/lib/domain/rules";
import type { Category } from "@/lib/domain/types";
import type { Suggestion } from "@/lib/market/suggest";
import { cn } from "@/lib/utils";

const CATS = Object.keys(CATEGORY_META) as Category[];
const STAGE: Record<OrderStatus, { label: string; tone: Tone }> = {
  pending_donor: { label: "Waiting for donor", tone: "warn" },
  awaiting_rider: { label: "Finding a rider", tone: "info" },
  rider_assigned: { label: "Rider heading to donor", tone: "info" },
  in_transit: { label: "On the way to you", tone: "info" },
  awaiting_receipt: { label: "Arrived: confirm receipt", tone: "ai" },
  delivered: { label: "Delivered", tone: "safe" },
  partial: { label: "Partly delivered", tone: "warn" },
  rejected: { label: "Rejected", tone: "crit" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired: do not consume", tone: "crit" },
  failed: { label: "Failed", tone: "crit" },
};

export default function ShelterPage() {
  const snap = useSnapshot();
  const now = useSmoothClock(3) || snap?.clock || 0;
  const [id, setId] = useState("S1");
  const [reqId, setReqId] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [sug, setSug] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ category: "cooked" as Category, qty: 50, priority: "normal" as Priority, neededInMin: "" });
  const [showMap, setShowMap] = useState(false);

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
  // A person is at this desk: organisations stop auto-answering while someone is present.
  useEffect(() => {
    const ping = () => void act({ type: "presence", role: "shelter", id });
    ping();
    const t = setInterval(ping, 1500);
    return () => clearInterval(t);
  }, [id]);

  const shelter = snap?.shelters.find((s) => s.id === id);
  const requests = useMemo(() => (snap?.market.requests ?? []).filter((r) => r.shelterId === id && r.status !== "cancelled"), [snap, id]);
  const req = requests.find((r) => r.id === reqId) ?? requests.find((r) => r.status === "open" || r.status === "partial") ?? null;
  useEffect(() => {
    setCart({});
    setSug(null);
  }, [req?.id, id]);

  if (!snap || !shelter) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <div className="glass rounded-xl px-6 py-4 text-sm text-dim">Connecting…</div>
      </main>
    );
  }

  const zone = snap.zones[id] ?? [];
  const cards = req
    ? snap.market.listings
        .filter((l) => l.status === "available" && l.category === req.category)
        .map((l) => ({ l, z: zone.find((x) => x.listingId === l.id) }))
        .filter((x) => x.z?.ok)
        .sort((a, b) => b.z!.slackMin - a.z!.slackMin)
    : [];
  const hiddenCount = req ? snap.market.listings.filter((l) => l.status === "available" && l.category === req.category).length - cards.length : 0;
  const donorName = (d: string) => snap.donors.find((x) => x.id === d)?.name ?? d;
  const myOrders = snap.market.orders.filter((o) => o.shelterId === id || o.divertedFrom === id).sort((a, b) => b.createdAt - a.createdAt);
  const inbox = snap.market.notifications.filter((n) => n.to.includes(`shelter:${id}`)).slice(-6).reverse();
  const cartLines = Object.entries(cart).filter(([, q]) => q > 0);
  const cartQty = cartLines.reduce((n, [, q]) => n + q, 0);
  const remaining = req?.remainingQty ?? 0;

  const setQty = (listingId: string, q: number, max: number) => setCart((c) => ({ ...c, [listingId]: Math.max(0, Math.min(max, q)) }));

  const compose = async () => {
    setBusy(true);
    const r = await act({
      type: "createRequest",
      shelterId: id,
      category: form.category,
      qty: form.qty,
      priority: form.priority,
      neededInMin: form.neededInMin ? Number(form.neededInMin) : undefined,
    });
    setBusy(false);
    if (!r.ok) return toast(r.error ?? "Could not post the request", "crit");
    toast("Request posted. Reachable donors are shown below.", "safe");
    setReqId((r.info?.requestId as string) ?? null);
  };

  const suggest = async () => {
    if (!req) return;
    setBusy(true);
    try {
      const res = await fetch("/api/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shelterId: id, requestId: req.id }) });
      const data = (await res.json()) as { ok: boolean; suggestion?: Suggestion; error?: string };
      if (!data.ok || !data.suggestion) throw new Error(data.error ?? "No suggestion");
      setSug(data.suggestion);
      if (!data.suggestion.bundles.length) toast(data.suggestion.reason ?? "No safe donors right now", "warn");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Suggestion failed", "crit");
    } finally {
      setBusy(false);
    }
  };

  const place = async () => {
    if (!req) return;
    setBusy(true);
    const r = await act({ type: "placeOrder", shelterId: id, requestId: req.id, lines: cartLines.map(([listingId, qty]) => ({ listingId, qty })) });
    setBusy(false);
    if (!r.ok) return toast(r.error ?? "Order failed", "crit");
    toast(`Order placed with ${cartLines.length} donor${cartLines.length > 1 ? "s" : ""}. Waiting for their confirmation.`, "safe");
    setCart({});
    setSug(null);
  };

  return (
    <main className="min-h-dvh bg-bg">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 p-3 sm:p-5">
        <TopBar />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{shelter.name}</h1>
            <p className="text-sm text-dim">
              Shelter portal · {shelter.area} · {shelter.open ? "accepting deliveries" : "closed to deliveries"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" icon={<MapPin className="size-3.5" />} onClick={() => setShowMap((v) => !v)}>
              {showMap ? "Hide map" : "Show map"}
            </Button>
            <select
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                try {
                  localStorage.setItem("swiftaid-shelter", e.target.value);
                } catch {
                  /* ignore */
                }
              }}
              className="h-10 rounded-xl border border-line-strong bg-solid px-3 text-sm font-medium outline-none focus:border-safe"
            >
              {snap.shelters.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          {/* LEFT: request + orders */}
          <div className="min-w-0 space-y-4">
            <Panel title="What do you need?" icon={<ClipboardList className="size-3.5" />} bodyClassName="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2">
                {CATS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setForm((f) => ({ ...f, category: c }))}
                    className={cn("rounded-lg border px-2.5 py-2 text-left text-xs transition", form.category === c ? "border-safe/60 bg-safe-soft font-semibold" : "border-line bg-surface2 text-dim hover:bg-surface3")}
                  >
                    {CATEGORY_META[c].label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label>
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Quantity ({CATEGORY_META[form.category].unit})</span>
                  <input type="number" min={1} value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: Math.max(1, Number(e.target.value) || 1) }))} className="tabular h-10 w-full rounded-lg border border-line-strong bg-solid px-3 text-sm outline-none focus:border-safe" />
                </label>
                <label>
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Needed within (min)</span>
                  <input type="number" min={10} placeholder="any time" value={form.neededInMin} onChange={(e) => setForm((f) => ({ ...f, neededInMin: e.target.value }))} className="tabular h-10 w-full rounded-lg border border-line-strong bg-solid px-3 text-sm outline-none placeholder:text-faint focus:border-safe" />
                </label>
              </div>
              <div className="flex gap-1.5">
                {(["normal", "high", "critical"] as Priority[]).map((p) => (
                  <button key={p} onClick={() => setForm((f) => ({ ...f, priority: p }))} className={cn("flex-1 rounded-lg py-1.5 text-[11px] font-medium capitalize transition", form.priority === p ? (p === "critical" ? "bg-crit-soft text-crit" : p === "high" ? "bg-warn-soft text-warn" : "bg-surface3 text-ink") : "bg-surface2 text-dim")}>
                    {p}
                  </button>
                ))}
              </div>
              <Button variant="primary" className="w-full" disabled={busy} onClick={compose} icon={<Plus className="size-4" />}>
                Post request
              </Button>
            </Panel>

            <Panel title="Your requests" icon={<ClipboardList className="size-3.5" />} actions={<span className="tabular text-[11px] text-faint">{requests.length}</span>} bodyClassName="space-y-2 p-3">
              {requests.length === 0 && <p className="p-3 text-center text-sm text-dim">No requests yet.</p>}
              {requests.map((r) => (
                <button key={r.id} onClick={() => setReqId(r.id)} className={cn("w-full rounded-xl border p-3 text-left transition", req?.id === r.id ? "border-safe/60 bg-safe-soft" : "border-line bg-surface2 hover:bg-surface3")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold">{r.label}</span>
                    <Badge tone={r.status === "fulfilled" ? "safe" : r.status === "expired" ? "crit" : r.priority === "critical" ? "crit" : r.priority === "high" ? "warn" : "neutral"}>{r.status === "open" || r.status === "partial" ? r.priority : r.status}</Badge>
                  </div>
                  <div className="tabular mt-1 text-[11px] text-dim">
                    {r.deliveredQty} delivered · {r.remainingQty} still to cover of {r.qty} {r.unit}
                  </div>
                  <div className="mt-1.5">
                    <Bar value={r.qty ? (r.qty - r.remainingQty) / r.qty : 0} tone={r.status === "fulfilled" ? "safe" : "info"} height={4} />
                  </div>
                </button>
              ))}
            </Panel>

            <Panel title="Updates" icon={<Bell className="size-3.5" />} bodyClassName="max-h-64 overflow-y-auto">
              {inbox.length === 0 ? (
                <p className="p-4 text-center text-sm text-dim">Nothing yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {inbox.map((n) => (
                    <li key={n.id} className="px-3.5 py-2.5">
                      <div className={cn("text-xs font-semibold", n.severity === "critical" ? "text-crit" : n.severity === "warn" ? "text-warn" : n.severity === "success" ? "text-safe" : "text-ink")}>{n.title}</div>
                      <p className="mt-0.5 text-[11.5px] leading-snug text-dim">{n.text}</p>
                      <div className="tabular mt-0.5 font-mono text-[10px] text-faint">{clockLabel(snap, n.at)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* MAIN: donors, suggestion, cart, orders */}
          <div className="min-w-0 space-y-4">
            {showMap && (
              <Panel title="Reachable zone and inbound riders" icon={<MapPin className="size-3.5" />} className="h-72 overflow-hidden" bodyClassName="relative">
                <LiveMap interactive onlyShelterId={id} showLabels />
              </Panel>
            )}

            <Panel
              title={req ? `Donors you can reach for ${req.label.toLowerCase()}` : "Donors you can reach"}
              icon={<Store className="size-3.5" />}
              actions={
                req && (
                  <Button size="sm" variant="ai" disabled={busy || remaining <= 0} icon={<Sparkles className="size-3.5" />} onClick={suggest}>
                    Suggest the best mix
                  </Button>
                )
              }
              bodyClassName="space-y-4 p-4"
            >
              {!req ? (
                <p className="py-8 text-center text-sm text-dim">Post a request to see donors whose supplies can reach you before they expire.</p>
              ) : (
                <>
                  <p className="text-xs leading-relaxed text-dim">
                    Only donors whose supplies can still arrive before they expire are shown{hiddenCount > 0 ? ` (${hiddenCount} hidden: too far or too close to expiry)` : ""}. You still need <span className="font-semibold text-ink">{remaining} {req.unit}</span>.
                  </p>

                  <AnimatePresence>
                    {sug && (
                      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border border-ai/40 bg-ai-soft p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ai">
                            <Sparkles className="size-3.5" /> AI-recommended bundle · QIGA + QPSO
                          </div>
                          <button onClick={() => setSug(null)} aria-label="Dismiss" className="text-dim hover:text-ink">
                            <X className="size-4" />
                          </button>
                        </div>
                        {sug.bundles.length === 0 ? (
                          <p className="mt-2 text-sm text-dim">{sug.reason}</p>
                        ) : (
                          <>
                            <ul className="mt-2 space-y-1 text-xs leading-snug text-dim">
                              {sug.why.map((w) => (
                                <li key={w}>• {w}</li>
                              ))}
                            </ul>
                            <div className="mt-3 grid gap-2 md:grid-cols-3">
                              {sug.bundles.map((b) => (
                                <div key={b.id} className="rounded-xl border border-line bg-surface p-3">
                                  <div className="text-xs font-semibold">{b.title}</div>
                                  <div className="tabular mt-0.5 text-[11px] text-dim">
                                    {b.covered}/{b.need} · {b.donors} donor{b.donors > 1 ? "s" : ""} · {Math.round(b.avgSlackMin)} min spare
                                  </div>
                                  <ul className="mt-1.5 space-y-0.5 text-[11px]">
                                    {b.lines.map((l) => (
                                      <li key={l.listingId} className="flex justify-between gap-2">
                                        <span className="truncate">{donorName(l.donorId)}</span>
                                        <span className="tabular text-dim">{l.qty}</span>
                                      </li>
                                    ))}
                                  </ul>
                                  <Button size="sm" variant="ai" className="mt-2 w-full" onClick={() => setCart(Object.fromEntries(b.lines.map((l) => [l.listingId, l.qty])))}>
                                    Use this bundle
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {cards.length === 0 ? (
                    <p className="rounded-xl bg-surface2 p-5 text-center text-sm text-dim">No donor can safely reach {shelter.name} in time for this request right now.</p>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {cards.map(({ l, z }) => {
                        const left = l.expiresAt - now;
                        const life = l.expiresAt - l.createdAt;
                        const q = cart[l.id] ?? 0;
                        const max = Math.min(l.availableQty, Math.max(remaining, 0));
                        return (
                          <div key={l.id} className={cn("rounded-2xl border p-4 transition", q > 0 ? "border-safe/60 bg-safe-soft" : "border-line bg-surface2")}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{l.label}</div>
                                <div className="truncate text-[11px] text-dim">{donorName(l.donorId)}</div>
                              </div>
                              <Badge tone={z!.slackMin > 30 ? "safe" : z!.slackMin > 12 ? "warn" : "crit"}>{Math.round(z!.slackMin)} min spare</Badge>
                            </div>
                            <div className="mt-3 flex items-end justify-between">
                              <div>
                                <div className="tabular text-xl font-semibold">
                                  {l.availableQty} <span className="text-xs font-normal text-dim">{l.unit} available</span>
                                </div>
                                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-dim">
                                  <Clock className="size-3" /> fit to consume for {durLabel(left)}
                                </div>
                              </div>
                              <div className="text-right text-[11px] text-dim">
                                <div className="flex items-center justify-end gap-1">
                                  <Route className="size-3" /> {z!.km.toFixed(1)} km · ~{Math.round(z!.driveMin)} min
                                </div>
                                {!z!.hasNearbyRider && <div className="text-warn">no rider close by</div>}
                              </div>
                            </div>
                            <div className="mt-2">
                              <Bar value={left / life} tone={left / life < 0.25 ? "crit" : left / life < 0.55 ? "warn" : "safe"} height={5} />
                              <div className="tabular mt-1 flex justify-between text-[10px] text-faint">
                                <span>freshness</span>
                                <span>expires {clockLabel(snap, l.expiresAt)}</span>
                              </div>
                            </div>
                            {l.coldChain && <div className="mt-1.5 text-[11px] text-info">Cold chain · needs an insulated box</div>}
                            <div className="mt-3 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1">
                                <button aria-label="Less" onClick={() => setQty(l.id, q - 5, max)} className="grid size-8 place-items-center rounded-lg bg-surface3 hover:brightness-125">
                                  <Minus className="size-3.5" />
                                </button>
                                <input aria-label={`Quantity from ${donorName(l.donorId)}`} type="number" min={0} max={max} value={q} onChange={(e) => setQty(l.id, Number(e.target.value) || 0, max)} className="tabular h-8 w-16 rounded-lg border border-line-strong bg-solid text-center text-sm outline-none focus:border-safe" />
                                <button aria-label="More" onClick={() => setQty(l.id, q + 5, max)} className="grid size-8 place-items-center rounded-lg bg-surface3 hover:brightness-125">
                                  <Plus className="size-3.5" />
                                </button>
                              </div>
                              <Button size="sm" variant={q > 0 ? "ghost" : "primary"} onClick={() => setQty(l.id, q > 0 ? 0 : max, max)}>
                                {q > 0 ? "Remove" : "Take all"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line-strong bg-solid p-3.5 shadow-[var(--shadow)]">
                    <div className="text-sm">
                      <span className="tabular font-semibold">{cartQty}</span> <span className="text-dim">{req.unit} from</span> <span className="font-semibold">{cartLines.length}</span> <span className="text-dim">donor{cartLines.length === 1 ? "" : "s"}</span>
                      {cartQty > remaining && <span className="ml-2 text-xs text-crit">more than you still need</span>}
                    </div>
                    <Button variant="primary" disabled={busy || cartLines.length === 0 || cartQty > remaining} onClick={place} icon={<Check className="size-4" />}>
                      Confirm order
                    </Button>
                  </div>
                </>
              )}
            </Panel>

            <Panel title="Your orders" icon={<Truck className="size-3.5" />} actions={<span className="tabular text-[11px] text-faint">{myOrders.length}</span>} bodyClassName="space-y-2 p-3">
              {myOrders.length === 0 && <p className="p-4 text-center text-sm text-dim">Orders you place appear here with live status.</p>}
              {myOrders.map((o) => (
                <OrderRow key={o.id} o={o} donor={donorName(o.donorId)} now={now} snapClock={snap.clock} onCancel={async () => {
                  const r = await act({ type: "cancelOrder", orderId: o.id, by: "shelter", reason: "Cancelled by the shelter" });
                  if (!r.ok) toast(r.error ?? "Could not cancel", "crit");
                }} />
              ))}
            </Panel>
          </div>
        </div>
      </div>
      <Toaster />
    </main>
  );
}

function OrderRow({ o, donor, now, onCancel }: { o: Order; donor: string; now: number; snapClock: number; onCancel: () => void }) {
  const st = STAGE[o.status];
  const terminal = TERMINAL_ORDER.includes(o.status);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className={cn("rounded-xl border p-3.5", o.risk === "breached" ? "border-crit/60 bg-crit-soft" : o.risk === "at_risk" ? "border-warn/50 bg-warn-soft" : "border-line bg-surface2")}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">
            {o.qty} {o.unit} · {o.label}
          </div>
          <div className="text-[11px] text-dim">from {donor}</div>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      {!terminal && (
        <div className="tabular mt-1.5 text-[11px] text-dim">
          fit until {durLabel(o.expiresAt - now)} from now{o.risk !== "ok" && <span className={o.risk === "breached" ? "ml-2 font-semibold text-crit" : "ml-2 font-semibold text-warn"}>{o.risk === "breached" ? "DO NOT CONSUME: will miss expiry" : "running late"}</span>}
        </div>
      )}
      {o.status === "expired" && <p className="mt-1.5 text-xs font-semibold text-crit">Do not consume these supplies. They passed their expiry.</p>}
      {o.closedReason && terminal && <p className="mt-1 text-[11px] text-dim">{o.closedReason}</p>}
      {o.status === "awaiting_receipt" && (
        <div className="mt-2.5 space-y-2">
          <p className="text-[11px] text-dim">
            Rider is at your door. Check the supplies, then confirm. Receipt code <span className="tabular font-mono font-semibold text-ink">{o.dropCode}</span>
          </p>
          {rejecting ? (
            <div className="flex gap-2">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (e.g. smells off)" className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-solid px-3 text-xs outline-none focus:border-crit" />
              <Button size="sm" variant="danger" onClick={() => act({ type: "confirmReceipt", orderId: o.id, accept: false, by: "shelter", reason }).then((r) => !r.ok && toast(r.error ?? "Failed", "crit"))}>
                Reject
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                Back
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" onClick={() => setRejecting(true)} icon={<X className="size-3.5" />}>
                Reject
              </Button>
              <Button size="sm" variant="primary" onClick={() => act({ type: "confirmReceipt", orderId: o.id, accept: true, by: "shelter" }).then((r) => !r.ok && toast(r.error ?? "Failed", "crit"))} icon={<PackageCheck className="size-3.5" />}>
                Accept delivery
              </Button>
            </div>
          )}
        </div>
      )}
      {(o.status === "pending_donor" || o.status === "awaiting_rider") && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={onCancel}>
          Cancel order
        </Button>
      )}
    </div>
  );
}
