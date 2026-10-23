"use client";

import { Activity, HeartHandshake } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clockLabel } from "@/lib/client/format";
import { useLive, useSmoothClock } from "@/lib/client/live";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

const NAV = [
  { href: "/admin", label: "Control room" },
  { href: "/donor", label: "Donor" },
  { href: "/rider", label: "Rider" },
  { href: "/shelter", label: "Shelter" },
  { href: "/impact", label: "Impact" },
  { href: "/live", label: "Live board" },
];

export function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-safe-soft text-safe shadow-[var(--glow-safe)]">
        <HeartHandshake className="size-5" />
      </span>
      {!compact && (
        <span className="hidden leading-none sm:block">
          <span className="block text-[15px] font-semibold tracking-tight">SwiftAid</span>
          <span className="block text-[10px] uppercase tracking-[0.16em] text-faint">Last-mile dispatch</span>
        </span>
      )}
    </Link>
  );
}

export function ConnectionDot() {
  const status = useLive((s) => s.status);
  const map = {
    live: { c: "bg-safe", t: "Live" },
    polling: { c: "bg-warn", t: "Polling" },
    connecting: { c: "bg-warn blink", t: "Connecting" },
    offline: { c: "bg-crit blink", t: "Offline" },
  } as const;
  const m = map[status];
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-medium text-dim" title={`Connection: ${m.t}`}>
      <span className={cn("size-2 rounded-full", m.c)} />
      <span className="hidden sm:inline">{m.t}</span>
    </span>
  );
}

export function SimClock() {
  const snap = useLive((s) => s.snap);
  const t = useSmoothClock(4);
  if (!snap) return <span className="skeleton h-5 w-16 rounded" />;
  return (
    <span className="tabular flex items-center gap-1.5 font-mono text-sm text-ink">
      <Activity className="size-3.5 text-safe" />
      {clockLabel(snap, t)}
    </span>
  );
}

export function TopBar({ className, right }: { className?: string; right?: React.ReactNode }) {
  const path = usePathname();
  const snap = useLive((s) => s.snap);
  return (
    <header className={cn("glass flex items-center gap-2 rounded-xl px-3 py-2.5 sm:gap-4 sm:px-4", className)}>
      <Brand />
      <nav className="ml-2 hidden items-center gap-1 lg:flex">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition",
              path === n.href ? "bg-surface3 text-ink" : "text-dim hover:bg-surface2 hover:text-ink",
            )}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2 sm:gap-4">
        {snap && <span className="hidden text-xs text-dim xl:block">{snap.scenario}</span>}
        <SimClock />
        <ConnectionDot />
        {right}
        <ThemeToggle />
      </div>
    </header>
  );
}
