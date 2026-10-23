"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Camera, Check, CircleAlert, ImagePlus, Loader2, Mic, MicOff, PackageCheck, Send, Sparkles, Truck, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LiveMap } from "@/components/map/LiveMap";
import { TopBar } from "@/components/shell/TopBar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Ring } from "@/components/ui/Ring";
import { Toaster, toast } from "@/components/ui/Toaster";
import { isActiveLeg, riderOf, shelterOf, STATUS_LABEL, STATUS_TONE } from "@/lib/client/derive";
import { clockLabel, durLabel, lifeTone, pct, survivalTone } from "@/lib/client/format";
import { downscaleImage } from "@/lib/client/image";
import { act, useSmoothClock, useSnapshot } from "@/lib/client/live";
import { CATEGORY_META } from "@/lib/domain/rules";
import type { Batch, Category } from "@/lib/domain/types";
import type { Draft } from "@/lib/intake";
import type { Snapshot } from "@/lib/store";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "180 cooked meals from our banquet hall, they spoil in about 75 minutes",
  "24 tins of infant formula, good for 6 hours",
  "20 packs of insulin and antibiotics, keep refrigerated, 2 hours",
  "50 raw ration kits with atta and dal",
];

type SR = { start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; continuous: boolean; interimResults: boolean; lang: string };

export default function DonorPage() {
  const snap = useSnapshot();
  const [donorId, setDonorId] = useState("D1");
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ base64: string; mediaType: "image/jpeg"; preview: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const recRef = useRef<SR | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const speechOk = typeof window !== "undefined" && !!((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("d");
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("swiftaid-donor");
    } catch {
      /* ignore */
    }
    if (q ?? saved) setDonorId((q ?? saved)!);
  }, []);

  const mine = useMemo(() => (snap ? [...snap.batches].filter((b) => b.donorId === donorId).reverse() : []), [snap, donorId]);
  const active = selected ? mine.find((b) => b.id === selected) : mine[0];

  const analyze = async () => {
    if (!text.trim() && !image) {
      toast("Describe the donation or add a photo first", "warn");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, imageBase64: image?.base64, mediaType: image?.mediaType }),
      });
      const data = (await res.json()) as { ok: boolean; draft?: Draft; error?: string };
      if (!data.ok || !data.draft) throw new Error(data.error ?? "Could not read the donation");
      setDraft(data.draft);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Analysis failed", "crit");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!draft) return;
    setBusy(true);
    const res = await act({
      type: "addBatch",
      donorId,
      category: draft.category,
      qty: draft.qty,
      label: draft.label,
      safeMin: draft.safeMin,
      coldChain: draft.coldChain,
      riskFlags: draft.riskFlags,
      notes: draft.rationale,
    });
    setBusy(false);
    if (!res.ok) {
      toast(res.error ?? "Could not post the donation", "crit");
      return;
    }
    toast("Donation posted. Dispatching riders…", "safe");
    setSelected((res.info?.batchId as string) ?? null);
    setDraft(null);
    setText("");
    setImage(null);
  };

  const toggleMic = () => {
    const w = window as unknown as Record<string, new () => SR>;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-IN";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const t = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      setText((prev) => (prev ? `${prev} ${t}` : t));
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  if (!snap) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <div className="glass rounded-xl px-6 py-4 text-sm text-dim">Connecting…</div>
      </main>
    );
  }
  const donor = snap.donors.find((d) => d.id === donorId)!;

  return (
    <main className="min-h-dvh bg-bg">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-3 sm:p-5">
        <TopBar />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Donate surplus</h1>
            <p className="text-sm text-dim">Tell us what you have. AI reads it, the safety engine decides where it can go.</p>
          </div>
          <select
            value={donorId}
            onChange={(e) => {
              setDonorId(e.target.value);
              setSelected(null);
              try {
                localStorage.setItem("swiftaid-donor", e.target.value);
              } catch {
                /* ignore */
              }
            }}
            className="h-11 rounded-xl border border-line-strong bg-solid px-3 text-sm font-medium outline-none focus:border-safe"
          >
            {snap.donors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
          <div className="space-y-4">
            <Panel title="New donation" icon={<Sparkles className="size-3.5 text-ai" />} bodyClassName="space-y-4 p-4">
              <div className="relative">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  placeholder="e.g. 180 cooked meals, banquet hall, they spoil in 75 minutes"
                  className="w-full resize-none rounded-xl border border-line-strong bg-solid p-3.5 pr-12 text-sm leading-relaxed outline-none placeholder:text-faint focus:border-safe"
                />
                {speechOk && (
                  <button
                    onClick={toggleMic}
                    aria-label={listening ? "Stop dictation" : "Dictate"}
                    className={cn("absolute right-3 top-3 grid size-8 place-items-center rounded-lg transition", listening ? "bg-crit text-white blink" : "bg-surface2 text-dim hover:text-ink")}
                  >
                    {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((e) => (
                  <button key={e} onClick={() => setText(e)} className="rounded-full bg-surface2 px-2.5 py-1 text-[11px] text-dim transition hover:bg-surface3 hover:text-ink">
                    {e.length > 38 ? `${e.slice(0, 38)}…` : e}
                  </button>
                ))}
              </div>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    setImage(await downscaleImage(f));
                  } catch {
                    toast("Could not read that image", "crit");
                  }
                  e.target.value = "";
                }}
              />
              {image ? (
                <div className="relative overflow-hidden rounded-xl border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.preview} alt="Donation photo" className="h-40 w-full object-cover" />
                  <button onClick={() => setImage(null)} aria-label="Remove photo" className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80">
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={async (e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) setImage(await downscaleImage(f));
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong py-5 text-sm text-dim transition hover:border-safe hover:text-ink"
                >
                  <ImagePlus className="size-4" /> Add a photo (optional) <Camera className="size-4 opacity-60" />
                </button>
              )}

              <Button variant="ai" size="lg" className="w-full" disabled={busy} onClick={analyze} icon={busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}>
                {busy && !draft ? "Reading your donation…" : "Analyze with AI"}
              </Button>
            </Panel>

            <AnimatePresence>
              {draft && (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
                  <DraftCard draft={draft} onChange={setDraft} onSubmit={submit} onCancel={() => setDraft(null)} busy={busy} donorName={donor.name} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="space-y-4">
            <Panel title="Your donations" icon={<PackageCheck className="size-3.5" />} actions={<span className="tabular text-[11px] text-faint">{mine.length}</span>} bodyClassName="p-3">
              {mine.length === 0 ? (
                <div className="grid place-items-center py-14 text-center text-sm text-dim">
                  <Truck className="mb-3 size-8 text-faint" />
                  Nothing posted from {donor.name} yet.
                </div>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {mine.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => setSelected(b.id)}
                      className={cn("shrink-0 rounded-lg border px-3 py-2 text-left text-xs transition", active?.id === b.id ? "border-safe/60 bg-safe-soft" : "border-line bg-surface2 hover:bg-surface3")}
                    >
                      <div className="font-semibold">{b.label.length > 26 ? `${b.label.slice(0, 26)}…` : b.label}</div>
                      <div className="text-dim">
                        {b.qty} {b.unit}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Panel>
            {active && <Journey snap={snap} batch={active} />}
          </div>
        </div>
      </div>
      <Toaster />
    </main>
  );
}

function DraftCard({ draft, onChange, onSubmit, onCancel, busy, donorName }: { draft: Draft; onChange: (d: Draft) => void; onSubmit: () => void; onCancel: () => void; busy: boolean; donorName: string }) {
  const meta = CATEGORY_META[draft.category];
  const tone = draft.confidence >= 0.75 ? "safe" : draft.confidence >= 0.5 ? "warn" : "crit";
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v });
  return (
    <Panel
      title="AI draft · review and confirm"
      icon={<Sparkles className="size-3.5 text-ai" />}
      className="border-ai/40"
      bodyClassName="space-y-4 p-4"
      actions={
        <Badge tone={tone}>
          {draft.source === "ai" ? "Claude" : draft.source === "fallback" ? "Rules parser" : "Placeholder"} · {Math.round(draft.confidence * 100)}%
        </Badge>
      }
    >
      <p className="text-xs leading-relaxed text-dim">{draft.rationale}</p>
      {draft.note && (
        <p className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[11px] leading-relaxed text-warn">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {draft.note}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <Field label="What is it?" className="col-span-2">
          <input value={draft.label} onChange={(e) => set("label", e.target.value)} className="h-10 w-full rounded-lg border border-line-strong bg-solid px-3 text-sm outline-none focus:border-safe" />
        </Field>
        <Field label="Category">
          <select value={draft.category} onChange={(e) => set("category", e.target.value as Category)} className="h-10 w-full rounded-lg border border-line-strong bg-solid px-2 text-sm outline-none focus:border-safe">
            {(Object.keys(CATEGORY_META) as Category[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Quantity (${meta.unit})`}>
          <input type="number" min={1} max={2000} value={draft.qty} onChange={(e) => set("qty", Math.max(1, Math.min(2000, Number(e.target.value) || 1)))} className="tabular h-10 w-full rounded-lg border border-line-strong bg-solid px-3 text-sm outline-none focus:border-safe" />
        </Field>
        <Field label="Safe for (minutes)">
          <input type="number" min={5} max={1440} value={draft.safeMin} onChange={(e) => set("safeMin", Math.max(5, Math.min(1440, Number(e.target.value) || 5)))} className="tabular h-10 w-full rounded-lg border border-line-strong bg-solid px-3 text-sm outline-none focus:border-safe" />
        </Field>
        <Field label="Needs cold chain">
          <label className="flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-solid px-3 text-sm">
            <input type="checkbox" checked={draft.coldChain} onChange={(e) => set("coldChain", e.target.checked)} className="size-4 accent-[var(--safe)]" /> Refrigerated
          </label>
        </Field>
      </div>
      {draft.riskFlags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {draft.riskFlags.map((f) => (
            <Badge key={f} tone="warn">
              {f}
            </Badge>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} className="flex-1">
          Discard
        </Button>
        <Button variant="primary" disabled={busy} onClick={onSubmit} className="flex-[2]" icon={busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}>
          Post from {donorName.length > 20 ? "donor" : donorName}
        </Button>
      </div>
    </Panel>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</span>
      {children}
    </label>
  );
}

function Journey({ snap, batch }: { snap: Snapshot; batch: Batch }) {
  const now = useSmoothClock(3) || snap.clock;
  const legs = snap.legs.filter((l) => l.batchId === batch.id);
  const live = legs.filter(isActiveLeg);
  const delivered = legs.filter((l) => l.state === "delivered");
  const total = batch.expiresAt - batch.createdAt;
  const left = Math.max(0, batch.expiresAt - now);
  const finished = batch.status === "delivered" || batch.status === "spoiled" || batch.status === "partial";

  const steps = [
    { label: "Posted", done: true },
    { label: "Dispatched", done: legs.some((l) => l.state !== "released") },
    { label: "Picked up", done: legs.some((l) => l.carrying && l.state !== "released") || delivered.length > 0 },
    { label: "In transit", done: live.some((l) => l.state === "to_drop") || delivered.length > 0 },
    { label: "Delivered", done: batch.deliveredQty >= batch.qty - batch.spoiledQty && batch.deliveredQty > 0 && batch.unplacedQty === 0 && live.length === 0 },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Panel
      title="Journey of your donation"
      icon={<Truck className="size-3.5" />}
      actions={<Badge tone={STATUS_TONE[batch.status]}>{STATUS_LABEL[batch.status]}</Badge>}
      bodyClassName="space-y-5 p-5"
    >
      <div className="flex items-center gap-4">
        <Ring value={finished ? 1 : left / total} tone={finished ? (batch.status === "delivered" ? "safe" : "crit") : lifeTone(left, total)} size={64} stroke={5}>
          <span className="tabular text-sm font-semibold">{finished ? "✓" : Math.ceil(left)}</span>
        </Ring>
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{batch.label}</div>
          <div className="text-xs text-dim">
            {batch.qty} {batch.unit} · posted {clockLabel(snap, batch.createdAt)} · {finished ? "complete" : `safe for ${durLabel(left)}`}
          </div>
          <div className="tabular mt-1 flex gap-3 text-[11px]">
            <span style={{ color: "var(--safe)" }}>{batch.deliveredQty} delivered</span>
            {batch.spoiledQty > 0 && <span style={{ color: "var(--crit)" }}>{batch.spoiledQty} lost</span>}
          </div>
        </div>
      </div>

      <ol className="flex items-start">
        {steps.map((s, i) => (
          <li key={s.label} className="relative flex flex-1 flex-col items-center text-center">
            {i > 0 && <div className="absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2 bg-line"><motion.div className="h-full bg-safe" initial={false} animate={{ width: steps[i].done ? "100%" : "0%" }} transition={{ duration: 0.6 }} /></div>}
            <motion.div
              initial={false}
              animate={{ scale: s.done && i === doneCount - 1 ? [1, 1.15, 1] : 1 }}
              className={cn("relative z-10 grid size-7 place-items-center rounded-full border text-[11px]", s.done ? "border-safe bg-safe text-[#04201c]" : "border-line-strong bg-solid text-faint")}
            >
              {s.done ? <Check className="size-3.5" /> : i + 1}
            </motion.div>
            <span className={cn("mt-1.5 text-[10px] font-medium", s.done ? "text-ink" : "text-faint")}>{s.label}</span>
          </li>
        ))}
      </ol>

      <div className="h-56 overflow-hidden rounded-xl border border-line">
        <LiveMap interactive={false} onlyBatchId={batch.id} showLabels padding={50} />
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Riders carrying it</div>
        {legs.length === 0 ? (
          <p className="rounded-lg bg-surface2 p-3 text-xs text-dim">Waiting for a safe dispatch…</p>
        ) : (
          <ul className="space-y-2">
            {legs
              .filter((l) => l.state !== "released")
              .map((l) => {
                const r = riderOf(snap, l.riderId);
                const s = shelterOf(snap, l.shelterId);
                return (
                  <li key={l.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface2 p-3 text-xs">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong bg-solid text-sm font-bold">{r?.name[0]}</span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold">
                          {r?.name} · {l.qty} {batch.unit} → {s?.name}
                        </div>
                        <div className="text-dim">
                          {l.state === "delivered" ? "Delivered" : l.state === "failed" ? "Lost in transit" : l.state === "offered" ? "Offered to rider" : l.state === "to_pickup" ? "On the way to collect" : `Arriving in ${durLabel(l.dropEta - now)}`}
                          {l.divertedFrom ? " · rerouted" : ""}
                        </div>
                      </div>
                    </div>
                    {l.survival && isActiveLeg(l) && <Badge tone={survivalTone(l.survival.p)}>{pct(l.survival.p)} safe</Badge>}
                    {l.state === "delivered" && <Badge tone="safe">delivered</Badge>}
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    </Panel>
  );
}
