"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, Radio } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { clockLabel } from "@/lib/client/format";
import type { EventSeverity } from "@/lib/domain/types";
import type { Snapshot } from "@/lib/store";

const ICON: Record<EventSeverity, { i: typeof Info; c: string }> = {
  info: { i: Info, c: "var(--info)" },
  success: { i: CheckCircle2, c: "var(--safe)" },
  warn: { i: AlertTriangle, c: "var(--warn)" },
  critical: { i: OctagonAlert, c: "var(--crit)" },
};

export function EventFeed({ snap, className, limit = 40, compact }: { snap: Snapshot; className?: string; limit?: number; compact?: boolean }) {
  const items = [...snap.events].reverse().slice(0, limit);
  return (
    <Panel title="Live feed" icon={<Radio className="size-3.5" />} className={className} bodyClassName="overflow-y-auto">
      <ul className="divide-y divide-line">
        <AnimatePresence initial={false}>
          {items.map((e) => {
            const { i: Icon, c } = ICON[e.severity];
            return (
              <motion.li
                key={e.id}
                layout
                initial={{ opacity: 0, x: -12, backgroundColor: "var(--surface-3)" }}
                animate={{ opacity: 1, x: 0, backgroundColor: "rgba(0,0,0,0)" }}
                transition={{ duration: 0.5 }}
                className="flex gap-2.5 px-3.5 py-2"
              >
                <Icon className="mt-0.5 size-3.5 shrink-0" style={{ color: c }} />
                <div className="min-w-0">
                  <p className={compact ? "text-[11.5px] leading-snug" : "text-xs leading-snug"}>{e.text}</p>
                  <p className="tabular mt-0.5 font-mono text-[10px] text-faint">{clockLabel(snap, e.at)}</p>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </Panel>
  );
}
