"use client";

import { AnimatePresence, motion } from "framer-motion";
import { create } from "zustand";
import type { Tone } from "@/lib/client/format";
import { toneVar } from "@/lib/client/format";

interface Toast {
  id: number;
  text: string;
  tone: Tone;
}
interface ToastStore {
  items: Toast[];
  push: (text: string, tone?: Tone) => void;
}

let seq = 1;
export const useToasts = create<ToastStore>((set) => ({
  items: [],
  push: (text, tone = "neutral") => {
    const id = seq++;
    set((s) => ({ items: [...s.items.slice(-3), { id, text, tone }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 4200);
  },
}));

export const toast = (text: string, tone: Tone = "neutral") => useToasts.getState().push(text, tone);

export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="glass pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm shadow-[var(--shadow)]"
          >
            <span className="size-2 shrink-0 rounded-full" style={{ background: toneVar[t.tone] }} />
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
