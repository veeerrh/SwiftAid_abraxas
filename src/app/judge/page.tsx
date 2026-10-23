import Link from "next/link";
import { Brand } from "@/components/shell/TopBar";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

const FRAMES = [
  { src: "/rider", title: "Rider portal" },
  { src: "/shelter", title: "Shelter portal" },
  { src: "/donor", title: "Donor portal" },
];

/** Tiled view so a judge can play every role at once while watching the control room. */
export default function JudgePage() {
  return (
    <main className="flex h-dvh flex-col gap-3 bg-bg p-3">
      <div className="glass flex items-center justify-between rounded-xl px-4 py-2">
        <Brand forceText />
        <div className="flex items-center gap-4 text-xs text-dim">
          <span className="hidden sm:inline">Judge mode: every portal shares one live city. Break something in the control room and watch each role react.</span>
          <Link href="/" className="rounded-lg bg-surface2 px-3 py-1.5 font-medium text-ink hover:bg-surface3">
            Exit
          </Link>
          <ThemeToggle />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Frame src="/admin" title="Control room" className="min-h-[60vh]" />
        <div className="grid min-h-0 grid-rows-3 gap-3">
          {FRAMES.map((f) => (
            <Frame key={f.src} {...f} />
          ))}
        </div>
      </div>
    </main>
  );
}

function Frame({ src, title, className }: { src: string; title: string; className?: string }) {
  return (
    <section className={`glass relative flex min-h-0 flex-col overflow-hidden rounded-xl ${className ?? ""}`}>
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">
        {title}
        <a href={src} target="_blank" rel="noreferrer" className="text-faint hover:text-ink">
          open ↗
        </a>
      </div>
      <iframe src={src} title={title} className="min-h-0 flex-1 border-0 bg-bg" loading="lazy" />
    </section>
  );
}
