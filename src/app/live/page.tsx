"use client";

import { AnimatePresence, motion } from "framer-motion";
import { HeartHandshake, Radio } from "lucide-react";
import { LiveMap } from "@/components/map/LiveMap";
import { ConnectionDot, SimClock } from "@/components/shell/TopBar";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { activeLegs, avgResponse } from "@/lib/client/derive";
import { clockLabel, durLabel } from "@/lib/client/format";
import { useSmoothClock, useSnapshot } from "@/lib/client/live";

/** Read-only, projector-friendly view of the whole city. No controls. */
export default function LiveBoard() {
  const snap = useSnapshot();
  const now = useSmoothClock(3) || snap?.clock || 0;
  if (!snap) {
    return (
      <main className="grid h-dvh place-items-center bg-bg">
        <div className="glass rounded-xl px-6 py-4 text-sm text-dim">Connecting…</div>
      </main>
    );
  }
  const m = snap.metrics;
  const resp = avgResponse(snap);
  const events = [...snap.events].reverse().filter((e) => e.severity !== "info" || e.type === "planned").slice(0, 5);
  const waiting = snap.batches.filter((b) => b.unplacedQty > 0 && b.expiresAt > now);
  const moving = activeLegs(snap).length;

  const cards = [
    { label: "Delivered safely", v: m.delivered, color: "var(--safe)" },
    { label: "Riders on the road", v: moving, color: "var(--info)" },
    { label: "Ghost recoveries", v: m.ghostRecoveries, color: "var(--ai)" },
    { label: "Live reroutes", v: m.diverts, color: "var(--warn)" },
  ];

  return (
    <main className="relative h-dvh overflow-hidden bg-bg">
      <div className="absolute inset-0">
        <LiveMap interactive={false} cinematic padding={{ top: 120, right: 460, bottom: 200, left: 80 }} />
      </div>
      <div className="pointer-events-none absolute inset-0" style={{ background: "var(--map-overlay)" }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-bg via-bg/70 to-transparent" />

      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-safe-soft text-safe shadow-[var(--glow-safe)]">
            <HeartHandshake className="size-6" />
          </span>
          <div className="leading-tight">
            <div className="text-xl font-semibold tracking-tight">SwiftAid · Pune</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-faint">Live perishable-aid network</div>
          </div>
        </div>
        <div className="glass flex items-center gap-5 rounded-2xl px-5 py-3">
          <SimClock />
          <ConnectionDot />
        </div>
      </header>

      <aside className="absolute bottom-52 right-6 top-24 z-10 flex w-[400px] flex-col gap-4">
        <div className="glass rounded-2xl p-5">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-dim">
            <Radio className="size-3.5 text-safe" /> Happening now
          </div>
          <ul className="space-y-3">
            <AnimatePresence initial={false}>
              {events.map((e) => (
                <motion.li key={e.id} layout initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="border-l-2 pl-3" style={{ borderColor: e.severity === "critical" ? "var(--crit)" : e.severity === "warn" ? "var(--warn)" : e.severity === "success" ? "var(--safe)" : "var(--info)" }}>
                  <p className="text-[15px] leading-snug">{e.text}</p>
                  <p className="tabular mt-1 font-mono text-[11px] text-faint">{clockLabel(snap, e.at)}</p>
                </motion.li>
              ))}
            </AnimatePresence>
            {events.length === 0 && <li className="text-sm text-dim">All quiet across the city.</li>}
          </ul>
        </div>
        {waiting.length > 0 && (
          <div className="glass rounded-2xl p-5">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-warn">Waiting for dispatch</div>
            {waiting.slice(0, 3).map((b) => (
              <div key={b.id} className="flex items-center justify-between py-1 text-sm">
                <span className="truncate">{b.label}</span>
                <span className="tabular text-warn">{durLabel(b.expiresAt - now)} left</span>
              </div>
            ))}
          </div>
        )}
      </aside>

      <footer className="absolute inset-x-6 bottom-6 z-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="glass rounded-2xl px-6 py-5">
            <div className="tabular text-5xl font-semibold tracking-tight" style={{ color: c.color }}>
              <AnimatedNumber value={c.v} />
            </div>
            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-dim">{c.label}</div>
          </div>
        ))}
      </footer>
      {resp !== null && (
        <div className="glass absolute bottom-40 left-6 z-10 rounded-xl px-4 py-2 text-xs text-dim">
          Ghost reservations recovered in <span className="font-semibold text-ink">{resp.toFixed(1)} min</span> on average
        </div>
      )}
    </main>
  );
}
