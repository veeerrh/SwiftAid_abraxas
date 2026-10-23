"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Drawer({
  open,
  onClose,
  title,
  icon,
  width = 560,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  width?: number;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            key="panel"
            role="dialog" aria-label={title} className={cn("glass fixed inset-y-3 right-3 z-50 flex max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl shadow-[var(--shadow)]")}
            style={{ width }}
            initial={{ x: width + 40, opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: width + 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 34 }}
          >
            <header className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="flex items-center gap-2.5 text-sm font-semibold tracking-tight">
                {icon}
                {title}
              </h2>
              <button onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-lg text-dim hover:bg-surface2 hover:text-ink">
                <X className="size-4" />
              </button>
            </header>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
