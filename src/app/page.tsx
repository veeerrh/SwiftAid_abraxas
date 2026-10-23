"use client";

import { motion } from "framer-motion";
import { ArrowRight, BarChart3, Building2, MonitorPlay, Package, ShieldCheck, Sparkles, Truck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { LiveMap } from "@/components/map/LiveMap";
import { Brand, ConnectionDot } from "@/components/shell/TopBar";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useSnapshot } from "@/lib/client/live";

const ROLES: { href: string; title: string; blurb: string; icon: ReactNode; tone: string }[] = [
  { href: "/donor", title: "Donor", blurb: "Post surplus food or supplies. AI reads your photo, the engine finds a safe route.", icon: <Package className="size-5" />, tone: "var(--info)" },
  { href: "/rider", title: "Rider", blurb: "Accept deliveries, keep the heartbeat alive, get rerouted the moment plans change.", icon: <Truck className="size-5" />, tone: "var(--ai)" },
  { href: "/shelter", title: "Shelter", blurb: "Set what you can take. Close intake or mark full and incoming riders divert instantly.", icon: <Building2 className="size-5" />, tone: "var(--safe)" },
  { href: "/admin", title: "Control room", blurb: "Live map, timeline, chaos panel and the quantum-inspired optimizer lab.", icon: <ShieldCheck className="size-5" />, tone: "var(--warn)" },
];

export default function Landing() {
  const snap = useSnapshot();
  const m = snap?.metrics;
  return (
    <main className="relative min-h-dvh overflow-hidden bg-bg">
      <div className="absolute inset-0 opacity-40">
        <LiveMap interactive={false} cinematic showLabels={false} padding={{ top: 80, right: 80, bottom: 80, left: 80 }} />
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-bg/55 via-bg/70 to-bg" />
      <div className="pointer-events-none absolute inset-0" style={{ background: "var(--map-overlay)" }} />

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-6xl flex-col px-5 py-5 sm:px-8">
        <header className="flex items-center justify-between">
          <Brand forceText />
          <div className="flex items-center gap-4">
            <ConnectionDot />
            <ThemeToggle />
          </div>
        </header>

        <section className="my-auto py-14">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-dim backdrop-blur">
              <Sparkles className="size-3.5 text-ai" /> Pune network · live simulation
            </span>
            <h1 className="mt-5 max-w-3xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Aid that arrives <span className="text-safe">before it spoils.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-dim sm:text-lg">
              SwiftAid coordinates donors, volunteer riders and shelters in real time. It treats shelf life, rider capacity, shelter rules and human
              unreliability as live variables, so surplus food and fragile supplies reach people safely.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/admin" className="inline-flex h-12 items-center gap-2 rounded-xl bg-safe px-6 text-sm font-semibold text-[#04201c] shadow-[var(--glow-safe)] transition hover:brightness-110">
                Open the control room <ArrowRight className="size-4" />
              </Link>
              <Link href="/judge" className="inline-flex h-12 items-center gap-2 rounded-xl border border-line-strong bg-surface px-5 text-sm font-medium backdrop-blur transition hover:bg-surface3">
                <MonitorPlay className="size-4 text-ai" /> Judge mode
              </Link>
              <Link href="/live" className="inline-flex h-12 items-center gap-2 rounded-xl px-4 text-sm font-medium text-dim transition hover:text-ink">
                <BarChart3 className="size-4" /> Live board
              </Link>
            </div>
          </motion.div>

          <motion.div
            className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.25 } } }}
          >
            {ROLES.map((r) => (
              <motion.div key={r.href} variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }}>
                <Link href={r.href} className="glass group flex h-full flex-col rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1 hover:border-line-strong">
                  <span className="grid size-10 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${r.tone} 16%, transparent)`, color: r.tone }}>
                    {r.icon}
                  </span>
                  <h3 className="mt-4 text-base font-semibold tracking-tight">{r.title}</h3>
                  <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-dim">{r.blurb}</p>
                  <span className="mt-4 flex items-center gap-1.5 text-xs font-medium" style={{ color: r.tone }}>
                    Enter <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        </section>

        <footer className="glass mb-1 grid grid-cols-2 gap-px overflow-hidden rounded-2xl text-center sm:grid-cols-4">
          {[
            { label: "Delivered safely", v: m?.delivered ?? 0, color: "var(--safe)" },
            { label: "Spoiled", v: m?.spoiled ?? 0, color: m && m.spoiled > 0 ? "var(--crit)" : "var(--dim)" },
            { label: "Ghost recoveries", v: m?.ghostRecoveries ?? 0, color: "var(--ai)" },
            { label: "Live diverts", v: m?.diverts ?? 0, color: "var(--warn)" },
          ].map((s) => (
            <div key={s.label} className="px-4 py-4">
              <div className="tabular text-2xl font-semibold" style={{ color: s.color }}>
                <AnimatedNumber value={s.v} />
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-faint">{s.label}</div>
            </div>
          ))}
        </footer>
      </div>
    </main>
  );
}
