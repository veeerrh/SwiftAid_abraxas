"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Ban, Bot, Check, CornerDownRight, GitFork, Loader2, PackagePlus, Send, Sparkles, TriangleAlert, Undo2, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import type { Action } from "@/lib/actions";
import type { PlanDiff } from "@/lib/copilot";
import { cn } from "@/lib/utils";

interface Proposal {
  actions: Action[];
  labels: string[];
  diff: PlanDiff;
  errors: string[];
  status: "pending" | "applied" | "dismissed";
}
interface Msg {
  id: number;
  role: "user" | "assistant";
  text: string;
  source?: "ai" | "rules";
  proposal?: Proposal;
}

const SUGGESTIONS = ["Close Hadapsar", "Kothrud just filled up", "Warje ran out of clean water", "Why was Aarav chosen?", "Switch to QPSO", "Traffic jam"];

let seq = 1;

export function Copilot() {
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      id: 0,
      role: "assistant",
      text: "I'm your dispatch copilot. Tell me what's changing on the ground and I'll preview the re-plan before anything happens. You always approve.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    const history = msgs.slice(-6).map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { id: seq++, role: "user", text: message }]);
    setBusy(true);
    try {
      const res = await fetch("/api/copilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, history }) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Copilot error");
      setMsgs((m) => [
        ...m,
        {
          id: seq++,
          role: "assistant",
          text: data.reply,
          source: data.source,
          proposal: data.actions?.length ? { actions: data.actions, labels: data.labels, diff: data.diff, errors: data.errors ?? [], status: "pending" } : undefined,
        },
      ]);
    } catch (e) {
      setMsgs((m) => [...m, { id: seq++, role: "assistant", text: e instanceof Error ? e.message : "Something went wrong" }]);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: number, approve: boolean) => {
    const msg = msgs.find((m) => m.id === id);
    if (!msg?.proposal) return;
    if (!approve) {
      setMsgs((all) => all.map((m) => (m.id === id && m.proposal ? { ...m, proposal: { ...m.proposal, status: "dismissed" } } : m)));
      return;
    }
    const res = await fetch("/api/copilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apply: msg.proposal.actions }) });
    const data = await res.json();
    if (data.ok) {
      toast("Plan applied. Riders are being re-routed.", "safe");
      setMsgs((all) => all.map((m) => (m.id === id && m.proposal ? { ...m, proposal: { ...m.proposal, status: "applied" } } : m)));
    } else toast(data.error ?? "Could not apply", "crit");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {msgs.map((m) => (
          <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", m.role === "user" ? "bg-surface3 text-dim" : "bg-ai-soft text-ai")}>
              {m.role === "user" ? <User className="size-4" /> : <Bot className="size-4" />}
            </span>
            <div className={cn("min-w-0 max-w-[88%] space-y-2", m.role === "user" && "text-right")}>
              <div className={cn("inline-block rounded-2xl px-3.5 py-2.5 text-left text-[13px] leading-relaxed", m.role === "user" ? "bg-safe text-[#04201c]" : "bg-surface2")}>{m.text}</div>
              {m.source && (
                <div className="text-[10px] uppercase tracking-wide text-faint">{m.source === "ai" ? "AI model" : "Rules engine (offline)"}</div>
              )}
              {m.proposal && <ProposalCard p={m.proposal} onApprove={() => decide(m.id, true)} onDismiss={() => decide(m.id, false)} />}
            </div>
          </motion.div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 pl-11 text-xs text-dim">
            <Loader2 className="size-3.5 animate-spin text-ai" /> Simulating the re-plan…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="space-y-3 border-t border-line p-4">
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)} className="rounded-full bg-surface2 px-2.5 py-1 text-[11px] text-dim transition hover:bg-ai-soft hover:text-ai">
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. Hadapsar just closed intake…"
            className="h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-solid px-3.5 text-sm outline-none placeholder:text-faint focus:border-ai"
          />
          <Button type="submit" variant="ai" disabled={busy || !input.trim()} icon={<Send className="size-4" />}>
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}

function Stat({ label, before, after, good, digits = 0 }: { label: string; before: number; after: number; good: "up" | "down"; digits?: number }) {
  const delta = after - before;
  const improved = Math.abs(delta) < 0.05 ? null : good === "up" ? delta > 0 : delta < 0;
  return (
    <div className="rounded-lg bg-surface3/60 p-2.5 text-center">
      <div className="tabular flex items-center justify-center gap-1.5 text-sm font-semibold">
        <span className="text-dim">{before.toFixed(digits)}</span>
        <ArrowRight className="size-3 text-faint" />
        <span style={{ color: improved === null ? "var(--ink)" : improved ? "var(--safe)" : "var(--crit)" }}>{after.toFixed(digits)}</span>
      </div>
      <div className="mt-0.5 text-[9px] uppercase tracking-wide text-faint">{label}</div>
    </div>
  );
}

const CHANGE_ICON = {
  divert: { i: GitFork, c: "var(--warn)" },
  released: { i: Undo2, c: "var(--info)" },
  new: { i: PackagePlus, c: "var(--safe)" },
  stranded: { i: TriangleAlert, c: "var(--crit)" },
  blocked: { i: Ban, c: "var(--crit)" },
  spoiled: { i: TriangleAlert, c: "var(--crit)" },
} as const;

function ProposalCard({ p, onApprove, onDismiss }: { p: Proposal; onApprove: () => void; onDismiss: () => void }) {
  return (
    <div className="glass overflow-hidden rounded-2xl border-ai/30 text-left">
      <div className="flex items-center gap-2 border-b border-line bg-ai-soft px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ai">
        <Sparkles className="size-3.5" /> Proposed plan · simulated on a copy of the city
      </div>
      <div className="space-y-3 p-3.5">
        <div className="flex flex-wrap gap-1.5">
          {p.labels.map((l) => (
            <Badge key={l} tone="ai">
              <CornerDownRight className="size-3" /> {l}
            </Badge>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Exp. safe units" before={p.diff.before.expectedSafe} after={p.diff.after.expectedSafe} good="up" digits={1} />
          <Stat label="Waiting" before={p.diff.before.waiting} after={p.diff.after.waiting} good="down" />
          <Stat label="Batches at risk" before={p.diff.before.atRisk} after={p.diff.after.atRisk} good="down" />
        </div>
        {p.diff.changes.length > 0 ? (
          <ul className="space-y-1.5">
            {p.diff.changes.slice(0, 8).map((c, i) => {
              const { i: Icon, c: color } = CHANGE_ICON[c.kind];
              return (
                <li key={i} className="flex gap-2 text-xs leading-snug">
                  <Icon className="mt-0.5 size-3.5 shrink-0" style={{ color }} />
                  {c.text}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-dim">No deliveries are affected right now.</p>
        )}
        {p.errors.length > 0 && <p className="text-xs text-crit">{p.errors[0]}</p>}

        <AnimatePresence mode="wait" initial={false}>
          {p.status === "pending" ? (
            <motion.div key="btns" className="flex gap-2" exit={{ opacity: 0 }}>
              <Button variant="outline" size="sm" className="flex-1" onClick={onDismiss}>
                Dismiss
              </Button>
              <Button variant="primary" size="sm" className="flex-[2]" icon={<Check className="size-4" />} onClick={onApprove}>
                Approve and apply
              </Button>
            </motion.div>
          ) : (
            <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Badge tone={p.status === "applied" ? "safe" : "neutral"}>{p.status === "applied" ? "Applied to the live city" : "Dismissed"}</Badge>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
