import type { ReactNode } from "react";
import type { Tone } from "@/lib/client/format";
import { cn } from "@/lib/utils";

const tones: Record<Tone, string> = {
  safe: "bg-safe-soft text-safe",
  warn: "bg-warn-soft text-warn",
  crit: "bg-crit-soft text-crit",
  ai: "bg-ai-soft text-ai",
  info: "bg-info-soft text-info",
  neutral: "bg-surface3 text-dim",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  dot,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
