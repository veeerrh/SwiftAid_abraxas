"use client";

import { Bell, Check, Clock, HandHeart, Loader2, Package, Plus, Sparkles, Truck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TopBar } from "@/components/shell/TopBar";
import { Badge } from "@/components/ui/Badge";
import { Bar } from "@/components/ui/Bar";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Toaster, toast } from "@/components/ui/Toaster";
import { clockLabel, durLabel } from "@/lib/client/format";
import { act, useSmoothClock, useSnapshot } from "@/lib/client/live";
import { CATEGORY_META } from "@/lib/domain/rules";
import { TERMINAL_ORDER } from "@/lib/domain/market";
import type { Category } from "@/lib/domain/types";
import type { Draft } from "@/lib/intake";
import { cn } from "@/lib/utils";

const CATS = Object.keys(CATEGORY_META) as Category[];
const EXAMPLES = ["60 cooked meals, spoil in 90 minutes", "20 packs of insulin, keep refrigerated, 2 hours", "30 tins of infant formula, 12 hours"];

export default function DonorPage() {
  const snap = useSnapshot();
  const now = useSmoothClock(3) || snap?.clock || 0;
  const [id, setId] = useState("D1");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [form, setForm] = useState({ category: "cooked" as Category, label: "", qty: 40, hours: 2, mins: 0, ready: 0, cold: false, notes: "" });
  const [aiNote, setAiNote] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("d");
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("swiftaid-donor");
    } catch {
      /* ignore */
    }
    if (q ?? saved) setId((q ?? saved)!);
  }, []);
  useEffect(() => {
    const ping = () => void act({ type: "presence", role: "donor", id });
    ping();
    const t = setInterval(ping, 1500);
    return () => clearInterval(t);
  }, [id]);

  const donor = snap?.donors.find((d) => d.id === id);
  const listings = useMemo(() => (snap?.market.listings ?? []).filter((l) => l.donorId === id).sort((a, b) => b.createdAt - a.createdAt), [snap, id]);
  const orders = useMemo(() => (snap?.market.orders ?? []).filter((o) => o.donorId === id).sort((a, b) => b.createdAt - a.createdAt), [snap, id]);

  if (!snap || !donor) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <div className="glass rounded-xl px-6 py-4 text-sm text-dim">Connecting…</div>
      </main>
    );
  }
  const shelterName = (s: string) => snap.shelters.find((x) => x.id === s)?.name ?? s;
  const pending = orders.filter((o) => o.status === "pending_donor");
  const active = orders.filter((o) => !TERMINAL_ORDER.includes(o.status) && o.status !== "pending_donor");
  const inbox = snap.market.notifications.filter((n) => n.to.includes(`donor:${id}`)).slice(-5).reverse();

  const prefill = async () => {
    if (!text.trim()) return toast("Describe what you have first", "warn");
    setBusy(true);
    try {
      const res = await fetch("/api/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const data = (await res.json()) as { ok: boolean; draft?: Draft; error?: string };
      if (!data.ok || !data.draft) throw new Error(data.error ?? "Could not read that");
      const d = data.draft;
      setForm((f) => ({ ...f, category: d.category, label: d.label, qty: d.qty, hours: Math.floor(d.safeMin / 60), mins: d.safeMin % 60, cold: d.coldChain }));
      setAiNote(`${d.source === "ai" ? "AI" : "Rules parser"} (${Math.round(d.confidence * 100)}% confident): ${d.rationale}${d.note ? ` ${d.note}` : ""}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not read that", "crit");
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    setBusy(true);
    const r = await act({
      type: "createListing",
      donorId: id,
      category: form.category,
      label: form.label.trim() || CATEGORY_META[form.category].label,
      qty: form.qty,
      expiresInMin: form.hours * 60 + form.mins,
      readyInMin: form.ready,
      coldChain: form.cold,
      notes: form.notes || undefined,
    });
    setBusy(false);
    if (!r.ok) return toast(r.error ?? "Could not post", "crit");
    toast("Listed. Shelters that can reach you before expiry will see it.", "safe");
    setText("");
    setAiNote(null);
  };

  return (
    <main className="min-h-dvh bg-bg">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-3 sm:p-5">
        <TopBar />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{donor.name}</h1>
            <p className="text-sm text-dim">Donor portal · {donor.area} · list supplies with the time they stay fit to consume</p>
          </div>
          <select
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              try {
                localStorage.setItem("swiftaid-donor", e.target.value);
              } catch {
                /* ignore */
              }
            }}
            className="h-10 rounded-xl border border-line-strong bg-solid px-3 text-sm font-medium outline-none focus:border-safe"
          >
            {snap.donors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        {pending.length > 0 && (
          <Panel title={`Reservation requests · ${pending.length}`} icon={<HandHeart className="size-3.5 text-warn" />} className="border-warn/40" bodyClassName="space-y-2 p-3">
            {pending.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface2 p-3.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {shelterName(o.shelterId)} wants {o.qty} {o.unit} of {o.label}
                  </div>
                  <div className="tabular text-[11px] text-dim">
                    Confirm within {durLabel(o.holdExpiresAt - now)} · supplies fit until {clockLabel(snap, o.expiresAt)}
                    {o.priority !== "normal" && <span className={o.priority === "critical" ? "ml-2 font-semibold text-crit" : "ml-2 font-semibold text-warn"}>{o.priority} priority</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" icon={<X className="size-3.5" />} onClick={() => act({ type: "donorRespond", orderId: o.id, accept: false, reason: "Not available" }).then((r) => !r.ok && toast(r.error ?? "Failed", "crit"))}>
                    Decline
                  </Button>
                  <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => act({ type: "donorRespond", orderId: o.id, accept: true }).then((r) => (r.ok ? toast("Confirmed. A rider will be assigned.", "safe") : toast(r.error ?? "Failed", "crit")))}>
                    Confirm
                  </Button>
                </div>
              </div>
            ))}
          </Panel>
        )}

        <div className="grid gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <Panel title="List supplies" icon={<Plus className="size-3.5" />} bodyClassName="space-y-3 p-4">
              <div className="space-y-2 rounded-xl bg-ai-soft p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ai">
                  <Sparkles className="size-3.5" /> Describe it and let AI fill the form
                </div>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="e.g. 60 cooked meals, spoil in 90 minutes" className="w-full resize-none rounded-lg border border-line-strong bg-solid p-2.5 text-xs outline-none placeholder:text-faint focus:border-ai" />
                <div className="flex flex-wrap gap-1.5">
                  {EXAMPLES.map((e) => (
                    <button key={e} onClick={() => setText(e)} className="rounded-full bg-surface2 px-2 py-0.5 text-[10px] text-dim hover:bg-surface3 hover:text-ink">
                      {e.length > 30 ? `${e.slice(0, 30)}…` : e}
                    </button>
                  ))}
                </div>
                <Button size="sm" variant="ai" disabled={busy} onClick={prefill} icon={busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}>
                  Fill the form
                </Button>
                {aiNote && <p className="text-[11px] leading-snug text-dim">{aiNote} Review before posting.</p>}
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {CATS.map((c) => (
                  <button key={c} onClick={() => setForm((f) => ({ ...f, category: c }))} className={cn("rounded-lg border px-2 py-1.5 text-left text-[11px] transition", form.category === c ? "border-safe/60 bg-safe-soft font-semibold" : "border-line bg-surface2 text-dim hover:bg-surface3")}>
                    {CATEGORY_META[c].label}
                  </button>
                ))}
              </div>
              <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="What exactly? e.g. Veg biryani trays" className="h-10 w-full rounded-lg border border-line-strong bg-solid px-3 text-sm outline-none placeholder:text-faint focus:border-safe" />
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Num label={`Quantity (${CATEGORY_META[form.category].unit})`} value={form.qty} min={1} onChange={(v) => setForm((f) => ({ ...f, qty: v }))} />
                <Num label="Fit for (hours)" value={form.hours} min={0} onChange={(v) => setForm((f) => ({ ...f, hours: v }))} />
                <Num label="+ minutes" value={form.mins} min={0} max={59} onChange={(v) => setForm((f) => ({ ...f, mins: v }))} />
              </div>
              <div className="tabular rounded-lg bg-surface2 px-3 py-2 text-[11px] text-dim">
                <Clock className="mr-1.5 inline size-3" /> Not fit to consume after <span className="font-semibold text-ink">{clockLabel(snap, now + form.hours * 60 + form.mins)}</span>. Riders keep a safety buffer before that.
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Num label="Ready for pickup in (min)" value={form.ready} min={0} onChange={(v) => setForm((f) => ({ ...f, ready: v }))} />
                <label className="flex items-end gap-2 pb-2">
                  <input type="checkbox" checked={form.cold} onChange={(e) => setForm((f) => ({ ...f, cold: e.target.checked }))} className="size-4 accent-[var(--safe)]" />
                  <span className="text-dim">Needs refrigeration</span>
                </label>
              </div>
              <Button variant="primary" className="w-full" disabled={busy || form.hours * 60 + form.mins < 1} onClick={post} icon={<Package className="size-4" />}>
                Post listing
              </Button>
            </Panel>

            <Panel title="Updates" icon={<Bell className="size-3.5" />} bodyClassName="max-h-56 overflow-y-auto">
              {inbox.length === 0 ? (
                <p className="p-4 text-center text-sm text-dim">Nothing yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {inbox.map((n) => (
                    <li key={n.id} className="px-3.5 py-2.5">
                      <div className={cn("text-xs font-semibold", n.severity === "critical" ? "text-crit" : n.severity === "warn" ? "text-warn" : n.severity === "success" ? "text-safe" : "text-ink")}>{n.title}</div>
                      <p className="mt-0.5 text-[11.5px] leading-snug text-dim">{n.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="min-w-0 space-y-4">
            <Panel title="Your listings" icon={<Package className="size-3.5" />} actions={<span className="tabular text-[11px] text-faint">{listings.length}</span>} bodyClassName="grid gap-3 p-3 md:grid-cols-2">
              {listings.length === 0 && <p className="col-span-full p-6 text-center text-sm text-dim">No listings yet.</p>}
              {listings.map((l) => {
                const left = l.expiresAt - now;
                const life = l.expiresAt - l.createdAt;
                const dead = l.status === "expired" || l.status === "cancelled";
                return (
                  <div key={l.id} className={cn("rounded-2xl border border-line bg-surface2 p-4", dead && "opacity-60")}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{l.label}</div>
                        <div className="text-[11px] text-dim">{CATEGORY_META[l.category].label}</div>
                      </div>
                      <Badge tone={l.status === "available" ? "safe" : l.status === "exhausted" ? "info" : "neutral"}>{l.status}</Badge>
                    </div>
                    <div className="tabular mt-2 text-sm">
                      <span className="text-xl font-semibold">{l.availableQty}</span> <span className="text-dim">of {l.qty} {l.unit} unreserved</span>
                    </div>
                    {!dead && (
                      <div className="mt-2">
                        <Bar value={left / life} tone={left / life < 0.25 ? "crit" : left / life < 0.55 ? "warn" : "safe"} height={5} />
                        <div className="tabular mt-1 flex justify-between text-[10px] text-faint">
                          <span>fit for {durLabel(left)}</span>
                          <span>until {clockLabel(snap, l.expiresAt)}</span>
                        </div>
                      </div>
                    )}
                    {l.status === "available" && (
                      <Button size="sm" variant="ghost" className="mt-2" onClick={() => act({ type: "cancelListing", listingId: l.id }).then((r) => !r.ok && toast(r.error ?? "Could not withdraw", "crit"))}>
                        Withdraw
                      </Button>
                    )}
                  </div>
                );
              })}
            </Panel>

            <Panel title="Deliveries in progress" icon={<Truck className="size-3.5" />} actions={<span className="tabular text-[11px] text-faint">{active.length}</span>} bodyClassName="space-y-2 p-3">
              {active.length === 0 && <p className="p-5 text-center text-sm text-dim">Confirmed reservations appear here until delivered.</p>}
              {active.map((o) => {
                const waiting = snap.legs.some((l) => l.batchId === o.batchId && l.state === "to_pickup" && l.handoverSince !== undefined && !l.pickupConfirmed);
                return (
                  <div key={o.id} className="rounded-xl border border-line bg-surface2 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[13px] font-semibold">
                        {o.qty} {o.unit} → {shelterName(o.shelterId)}
                      </div>
                      <Badge tone={o.risk === "breached" ? "crit" : o.risk === "at_risk" ? "warn" : "info"}>{o.risk === "breached" ? "will expire" : o.status.replace(/_/g, " ")}</Badge>
                    </div>
                    {waiting && (
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ai-soft p-2.5 text-xs">
                        <span>
                          Rider at your door. Handover code <span className="tabular font-mono font-semibold">{o.pickupCode}</span>
                        </span>
                        <Button size="sm" variant="primary" onClick={() => act({ type: "confirmPickup", orderId: o.id, by: "donor" }).then((r) => !r.ok && toast(r.error ?? "Failed", "crit"))}>
                          Handed over
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </Panel>
          </div>
        </div>
      </div>
      <Toaster />
    </main>
  );
}

function Num({ label, value, onChange, min = 0, max }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <label>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</span>
      <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max ?? 99999, Number(e.target.value) || 0)))} className="tabular h-10 w-full rounded-lg border border-line-strong bg-solid px-3 text-sm outline-none focus:border-safe" />
    </label>
  );
}
