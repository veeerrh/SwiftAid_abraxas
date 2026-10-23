"use client";

import { Download, FlaskConical, Play, Plus, RotateCcw, Save, Sparkles, Trash2, Upload, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { act } from "@/lib/client/live";
import { BLANK_SPEC, FAILURE_LABEL, PRESETS, scenarioSchema, type FailureSpec, type ScenarioSpec } from "@/lib/market/studio-presets";
import type { Snapshot } from "@/lib/store";
import { cn } from "@/lib/utils";

const CATS = ["cooked", "raw_ration", "medical", "infant_formula", "kit"] as const;
const CAT_LABEL: Record<(typeof CATS)[number], string> = { cooked: "Cooked meals", raw_ration: "Raw rations", medical: "Medical", infant_formula: "Infant formula", kit: "Essentials kits" };
const SAVE_KEY = "swiftaid.studio.saves";
const RUN_KEY = "swiftaid.studio.runs";

interface RunRecord {
  id: string;
  name: string;
  at: number;
  minutes: number;
  delivered: number;
  spoiled: number;
  rejected: number;
  ghost: number;
  diverts: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable: the studio still works, just without saves */
  }
}

export function StudioPanel({ snap }: { snap: Snapshot }) {
  const [spec, setSpec] = useState<ScenarioSpec>(BLANK_SPEC);
  const [saves, setSaves] = useState<ScenarioSpec[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"run" | "design" | "compare">("run");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSaves(read<ScenarioSpec[]>(SAVE_KEY, []));
    setRuns(read<RunRecord[]>(RUN_KEY, []));
  }, []);

  const patch = (p: Partial<ScenarioSpec>) => setSpec((s) => ({ ...s, ...p }));

  async function load(s: ScenarioSpec) {
    setBusy(true);
    const parsed = scenarioSchema.safeParse(s);
    if (!parsed.success) {
      toast(parsed.error.issues[0]?.message ?? "Scenario is not valid", "crit");
      setBusy(false);
      return;
    }
    const res = await act({ type: "studioLoad", spec: parsed.data });
    setBusy(false);
    if (res.ok) {
      toast(`Loaded “${parsed.data.name}”`, "safe");
      setTab("run");
    } else toast(res.error ?? "Could not load", "crit");
  }

  async function standard() {
    const res = await act({ type: "reset", scenario: "market" });
    toast(res.ok ? "Standard demo city restored" : (res.error ?? "Failed"), res.ok ? "safe" : "crit");
  }

  async function generate() {
    if (prompt.trim().length < 3) return;
    setBusy(true);
    try {
      const r = await fetch("/api/studio/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) });
      const j = (await r.json()) as { ok: boolean; spec?: ScenarioSpec; source?: string; error?: string };
      if (j.ok && j.spec) {
        setSpec(j.spec);
        setTab("design");
        toast(j.source === "ai" ? "AI drafted a scenario. Review it, then load it." : "Matched the closest ready-made scenario. Review it, then load it.", "ai");
      } else toast(j.error ?? "Could not draft a scenario", "crit");
    } catch {
      toast("Network error", "crit");
    }
    setBusy(false);
  }

  function saveCurrent() {
    const next = [spec, ...saves.filter((s) => s.name !== spec.name)].slice(0, 12);
    setSaves(next);
    write(SAVE_KEY, next);
    toast(`Saved “${spec.name}” on this device`, "safe");
  }
  function exportJson() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${spec.name.replace(/\W+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function importJson(f: File) {
    try {
      const parsed = scenarioSchema.parse(JSON.parse(await f.text()));
      setSpec(parsed);
      setTab("design");
      toast("Scenario imported", "safe");
    } catch {
      toast("That file is not a valid scenario", "crit");
    }
  }
  function recordRun() {
    const st = snap.studio;
    const rec: RunRecord = {
      id: String(Date.now()),
      name: st?.name ?? snap.scenario,
      at: Date.now(),
      minutes: Math.round(snap.clock - (st?.startedAt ?? 0)),
      delivered: snap.metrics.delivered,
      spoiled: snap.metrics.spoiled,
      rejected: snap.metrics.rejected,
      ghost: snap.metrics.ghostRecoveries,
      diverts: snap.metrics.diverts,
    };
    const next = [rec, ...runs].slice(0, 10);
    setRuns(next);
    write(RUN_KEY, next);
    toast("Result saved for comparison", "safe");
    setTab("compare");
  }

  return (
    <div className="space-y-4 p-5">
      <div className="flex gap-1 rounded-xl bg-surface2 p-1 text-xs font-medium">
        {(
          [
            ["run", "Run"],
            ["design", "Design"],
            ["compare", `Compare${runs.length ? ` (${runs.length})` : ""}`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("flex-1 rounded-lg px-3 py-1.5 transition-colors", tab === k ? "bg-surface3 text-ink shadow-sm" : "text-dim hover:text-ink")}>
            {label}
          </button>
        ))}
      </div>

      {tab === "run" && (
        <>
          <section className="rounded-xl border border-safe/30 bg-safe-soft p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Standard demo</div>
                <div className="text-xs text-dim">The preloaded Pune city: 5 donors, 6 shelters, 10 riders, live listings and requests.</div>
              </div>
              <Button size="sm" variant="primary" icon={<RotateCcw className="size-3.5" />} onClick={standard}>
                Restore
              </Button>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Ready-made scenarios</h3>
            {PRESETS.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface2 p-3.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{p.spec.name}</div>
                  <div className="text-xs text-dim">{p.blurb}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge>{p.spec.donors} donors</Badge>
                    <Badge>{p.spec.shelters} shelters</Badge>
                    <Badge>{p.spec.riders} riders</Badge>
                    <Badge tone="warn">{p.spec.failures.length} {p.spec.failures.length === 1 ? "failure" : "failures"}</Badge>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  <Button size="sm" variant="ai" icon={<Play className="size-3.5" />} disabled={busy} onClick={() => load(p.spec)}>
                    Run
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setSpec(p.spec); setTab("design"); }}>
                    Edit
                  </Button>
                </div>
              </div>
            ))}
          </section>

          <section className="rounded-xl border border-ai/30 bg-ai-soft p-4">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ai">
              <Sparkles className="size-3.5" /> Describe it, let AI build it
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder="e.g. A heatwave week: cooked food spoils fast, two riders strike, and a hospital needs insulin"
              className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ai"
            />
            <Button size="sm" variant="ai" className="mt-2" icon={<Sparkles className="size-3.5" />} disabled={busy || prompt.trim().length < 3} onClick={generate}>
              {busy ? "Working…" : "Draft scenario"}
            </Button>
          </section>

          {snap.studio && <LiveControls snap={snap} onRecord={recordRun} />}
        </>
      )}

      {tab === "design" && (
        <>
          <Field label="Name">
            <input value={spec.name} onChange={(e) => patch({ name: e.target.value })} className={inputCls} />
          </Field>
          {spec.description && <p className="text-xs text-dim">{spec.description}</p>}

          <div className="grid grid-cols-3 gap-2">
            <Num label="Donors" value={spec.donors} min={1} max={14} onChange={(v) => patch({ donors: v })} />
            <Num label="Shelters" value={spec.shelters} min={1} max={12} onChange={(v) => patch({ shelters: v })} />
            <Num label="Riders" value={spec.riders} min={1} max={30} onChange={(v) => patch({ riders: v })} />
          </div>
          <Slider label="Traffic" value={spec.trafficFactor} min={1} max={3} step={0.1} fmt={(v) => `×${v.toFixed(1)}`} onChange={(v) => patch({ trafficFactor: v })} />
          <Slider label="Rider reliability" value={spec.riderReliability ?? 0.85} min={0.4} max={0.99} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ riderReliability: v })} />
          <Slider label="Shelf life of supplies" value={spec.expiryScale} min={0.3} max={2} step={0.05} fmt={(v) => `×${v.toFixed(2)}`} onChange={(v) => patch({ expiryScale: v })} />
          <Slider label="Donor response rate" value={spec.donorResponseRate ?? 0.9} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ donorResponseRate: v })} />
          <div className="flex gap-4 text-xs">
            <Toggle label="Auto-pilot (organisations answer by themselves)" on={spec.autopilot} onChange={(v) => patch({ autopilot: v })} />
            <Toggle label="Place orders automatically" on={spec.autoOrders} onChange={(v) => patch({ autoOrders: v })} />
          </div>

          <Group title="Supplies on offer" onAdd={() => patch({ listings: [...spec.listings, { category: "cooked", qty: 50, expiresInMin: 90 }] })} disabled={spec.listings.length >= 40}>
            {spec.listings.map((l, i) => (
              <Row key={i} onDelete={() => patch({ listings: spec.listings.filter((_, k) => k !== i) })}>
                <select value={l.category} onChange={(e) => patch({ listings: spec.listings.map((x, k) => (k === i ? { ...x, category: e.target.value as (typeof CATS)[number] } : x)) })} className={cn(inputCls, "w-36")}>
                  {CATS.map((c) => (
                    <option key={c} value={c}>
                      {CAT_LABEL[c]}
                    </option>
                  ))}
                </select>
                <MiniNum value={l.qty} suffix="units" min={1} max={2000} onChange={(v) => patch({ listings: spec.listings.map((x, k) => (k === i ? { ...x, qty: v } : x)) })} />
                <MiniNum value={l.expiresInMin} suffix="min life" min={10} max={4000} onChange={(v) => patch({ listings: spec.listings.map((x, k) => (k === i ? { ...x, expiresInMin: v } : x)) })} />
              </Row>
            ))}
          </Group>

          <Group title="Shelter requests" onAdd={() => patch({ requests: [...spec.requests, { category: "cooked", qty: 60 }] })} disabled={spec.requests.length >= 30}>
            {spec.requests.map((r, i) => (
              <Row key={i} onDelete={() => patch({ requests: spec.requests.filter((_, k) => k !== i) })}>
                <select value={r.category} onChange={(e) => patch({ requests: spec.requests.map((x, k) => (k === i ? { ...x, category: e.target.value as (typeof CATS)[number] } : x)) })} className={cn(inputCls, "w-36")}>
                  {CATS.map((c) => (
                    <option key={c} value={c}>
                      {CAT_LABEL[c]}
                    </option>
                  ))}
                </select>
                <MiniNum value={r.qty} suffix="units" min={1} max={2000} onChange={(v) => patch({ requests: spec.requests.map((x, k) => (k === i ? { ...x, qty: v } : x)) })} />
                <select value={r.priority ?? "normal"} onChange={(e) => patch({ requests: spec.requests.map((x, k) => (k === i ? { ...x, priority: e.target.value as "normal" | "high" | "critical" } : x)) })} className={cn(inputCls, "w-24")}>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </Row>
            ))}
          </Group>

          <Group title="Failure timeline (minutes after start)" onAdd={() => patch({ failures: [...spec.failures, { atMin: 10, type: "ghost" as const }].sort((a, b) => a.atMin - b.atMin) })} disabled={spec.failures.length >= 30}>
            {spec.failures.map((f, i) => (
              <Row key={i} onDelete={() => patch({ failures: spec.failures.filter((_, k) => k !== i) })}>
                <MiniNum value={f.atMin} suffix="min" min={0} max={600} onChange={(v) => patch({ failures: spec.failures.map((x, k) => (k === i ? { ...x, atMin: v } : x)) })} />
                <select value={f.type} onChange={(e) => patch({ failures: spec.failures.map((x, k) => (k === i ? { ...x, type: e.target.value as FailureSpec["type"] } : x)) })} className={cn(inputCls, "min-w-0 flex-1")}>
                  {Object.entries(FAILURE_LABEL).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </Row>
            ))}
          </Group>

          <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center gap-2 border-t border-line bg-surface-solid/95 px-5 py-3 backdrop-blur">
            <Button variant="primary" icon={<Play className="size-4" />} disabled={busy} onClick={() => load(spec)}>
              Load scenario
            </Button>
            <Button size="sm" variant="ghost" icon={<Save className="size-3.5" />} onClick={saveCurrent}>
              Save
            </Button>
            <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={exportJson}>
              Export
            </Button>
            <Button size="sm" variant="ghost" icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()}>
              Import
            </Button>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          </div>

          {saves.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Saved on this device</h3>
              {saves.map((s) => (
                <div key={s.name} className="flex items-center gap-2 rounded-lg border border-line bg-surface2 px-3 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                  <Button size="sm" variant="ghost" onClick={() => setSpec(s)}>
                    Open
                  </Button>
                  <Button size="sm" variant="ai" disabled={busy} onClick={() => load(s)}>
                    Run
                  </Button>
                  <button
                    aria-label="Delete saved scenario"
                    className="text-faint hover:text-crit"
                    onClick={() => {
                      const next = saves.filter((x) => x.name !== s.name);
                      setSaves(next);
                      write(SAVE_KEY, next);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {tab === "compare" && <Compare runs={runs} onClear={() => { setRuns([]); write(RUN_KEY, []); }} />}
    </div>
  );
}

function LiveControls({ snap, onRecord }: { snap: Snapshot; onRecord: () => void }) {
  const st = snap.studio!;
  const elapsed = Math.round(snap.clock - st.startedAt);
  const fire = async (failure: FailureSpec) => {
    const r = await act({ type: "studioFail", failure });
    toast(r.ok ? String(r.info?.message ?? "Done") : (r.error ?? "Failed"), r.ok ? "warn" : "crit");
  };
  const knob = async (k: Parameters<typeof act>[0] extends infer A ? Omit<Extract<A, { type: "studioKnob" }>, "type"> : never) => {
    const r = await act({ type: "studioKnob", ...k });
    toast(r.ok ? "Applied" : (r.error ?? "Failed"), r.ok ? "safe" : "crit");
  };
  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface2 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FlaskConical className="size-4 text-ai" /> Running: {st.name}
          </div>
          <div className="text-xs text-dim">{elapsed} min in · delivered {snap.metrics.delivered} · spoiled {snap.metrics.spoiled}</div>
        </div>
        <Button size="sm" variant="outline" icon={<Save className="size-3.5" />} onClick={onRecord}>
          Save result
        </Button>
      </div>

      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Timeline</div>
        <div className="space-y-1">
          {st.failures.length === 0 && <div className="text-xs text-faint">No scheduled failures.</div>}
          {st.failures.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="tabular w-12 text-faint">+{f.atMin}m</span>
              <span className={cn("flex-1", f.fired ? "text-dim line-through" : "text-ink")}>{FAILURE_LABEL[f.type]}</span>
              <Badge tone={f.fired ? "warn" : "neutral"}>{f.fired ? "happened" : elapsed >= f.atMin ? "now" : `in ${Math.max(0, Math.round(f.atMin - elapsed))}m`}</Badge>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Hit it with something now</div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(FAILURE_LABEL) as FailureSpec["type"][]).map((t) => (
            <Button key={t} size="sm" variant="ghost" icon={<Zap className="size-3 text-warn" />} onClick={() => fire({ atMin: 0, type: t })}>
              {FAILURE_LABEL[t]}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Live knobs</div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => knob({ traffic: 2.5 })}>Heavy traffic</Button>
          <Button size="sm" variant="ghost" onClick={() => knob({ riderReliability: 0.55 })}>Unreliable riders</Button>
          <Button size="sm" variant="ghost" onClick={() => knob({ riderReliability: 0.95 })}>Reliable riders</Button>
          <Button size="sm" variant="ghost" onClick={() => knob({ expiryFactor: 0.6 })}>Shorten shelf life</Button>
          <Button size="sm" variant="ghost" onClick={() => knob({ donorResponseRate: 0.3 })}>Slow donors</Button>
          <Button size="sm" variant="ghost" onClick={() => knob({ shelterRejectRate: 0.4 })}>Strict shelters</Button>
          <Button size="sm" variant="ghost" onClick={() => knob({ ridersOnline: true })}>Riders back online</Button>
        </div>
      </div>
    </section>
  );
}

function Compare({ runs, onClear }: { runs: RunRecord[]; onClear: () => void }) {
  if (!runs.length)
    return <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-dim">Run a scenario, then use “Save result” to line up outcomes here.</div>;
  const best = Math.max(...runs.map((r) => r.delivered - r.spoiled));
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full text-xs">
          <thead className="bg-surface2 text-faint">
            <tr>
              {["Scenario", "Min", "Delivered", "Spoiled", "Rejected", "Ghost fixes", "Diverts"].map((h) => (
                <th key={h} className="px-2.5 py-2 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {runs.map((r) => (
              <tr key={r.id} className={cn("border-t border-line", r.delivered - r.spoiled === best && "bg-safe-soft")}>
                <td className="px-2.5 py-2 font-medium">{r.name}</td>
                <td className="px-2.5 py-2">{r.minutes}</td>
                <td className="px-2.5 py-2 text-safe">{r.delivered}</td>
                <td className="px-2.5 py-2 text-crit">{r.spoiled}</td>
                <td className="px-2.5 py-2">{r.rejected}</td>
                <td className="px-2.5 py-2">{r.ghost}</td>
                <td className="px-2.5 py-2">{r.diverts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={onClear}>
        Clear results
      </Button>
    </div>
  );
}

const inputCls = "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-sm outline-none focus:border-safe";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-dim">{label}</span>
      {children}
    </label>
  );
}
function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <Field label={label}>
      <input type="number" value={value} min={min} max={max} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))} className={inputCls} />
    </Field>
  );
}
function MiniNum({ value, suffix, min, max, onChange }: { value: number; suffix: string; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-faint">
      <input type="number" value={value} min={min} max={max} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))} className={cn(inputCls, "w-20")} />
      {suffix}
    </div>
  );
}
function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 flex justify-between font-medium text-dim">
        {label}
        <span className="tabular text-ink">{fmt(value)}</span>
      </span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--safe)]" />
    </label>
  );
}
function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex flex-1 cursor-pointer items-center gap-2 text-dim">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--safe)]" />
      {label}
    </label>
  );
}
function Group({ title, onAdd, disabled, children }: { title: string; onAdd: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">{title}</h3>
        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} disabled={disabled} onClick={onAdd}>
          Add
        </Button>
      </div>
      {children}
    </section>
  );
}
function Row({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface2 p-2">
      {children}
      <button aria-label="Remove" className="ml-auto text-faint hover:text-crit" onClick={onDelete}>
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}
