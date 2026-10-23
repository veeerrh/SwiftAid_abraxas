"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import type { Action, ActionResult } from "@/lib/actions";
import type { Snapshot } from "@/lib/store";

interface LiveStore {
  snap: Snapshot | null;
  /** performance.now() when the latest snapshot arrived. */
  receivedAt: number;
  status: "connecting" | "live" | "polling" | "offline";
  set: (s: Snapshot) => void;
  setStatus: (s: LiveStore["status"]) => void;
}

export const useLive = create<LiveStore>((set) => ({
  snap: null,
  receivedAt: 0,
  status: "connecting",
  set: (snap) => set({ snap, receivedAt: performance.now() }),
  setStatus: (status) => set({ status }),
}));

let source: EventSource | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let refs = 0;

async function poll() {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    useLive.getState().set((await res.json()) as Snapshot);
    useLive.getState().setStatus("polling");
  } catch {
    useLive.getState().setStatus("offline");
  }
}

function startPolling() {
  if (pollTimer) return;
  void poll();
  pollTimer = setInterval(poll, 1500);
}

function connect() {
  if (source || typeof EventSource === "undefined") {
    if (typeof EventSource === "undefined") startPolling();
    return;
  }
  const es = new EventSource("/api/stream");
  source = es;
  es.onmessage = (e) => {
    try {
      useLive.getState().set(JSON.parse(e.data) as Snapshot);
      useLive.getState().setStatus("live");
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    } catch {
      /* ignore a malformed frame */
    }
  };
  es.onerror = () => {
    // EventSource retries on its own; poll meanwhile so the UI never freezes.
    useLive.getState().setStatus("polling");
    startPolling();
  };
}

/** Mount once per page: opens the shared SSE connection. */
export function useLiveConnection() {
  useEffect(() => {
    refs++;
    connect();
    return () => {
      refs--;
      if (refs === 0) {
        source?.close();
        source = null;
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
      }
    };
  }, []);
}

export function useSnapshot(): Snapshot | null {
  useLiveConnection();
  return useLive((s) => s.snap);
}

export async function act(action: Action): Promise<ActionResult> {
  try {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    });
    const out = (await res.json()) as ActionResult;
    // Optimistic freshness: pull the new state right away rather than wait for the next tick.
    if (useLive.getState().status !== "live") void poll();
    return out;
  } catch {
    return { ok: false, error: "Network error" };
  }
}

/** Smoothly extrapolated simulation minute (the server ticks twice a second). */
export function smoothClock(): number {
  const { snap, receivedAt } = useLive.getState();
  if (!snap) return 0;
  if (!snap.running) return snap.clock;
  return snap.clock + ((performance.now() - receivedAt) / 1000) * snap.rate;
}

/** React hook form of {@link smoothClock}, re-rendering at `fps`. */
export function useSmoothClock(fps = 12): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT(smoothClock()), 1000 / fps);
    return () => clearInterval(id);
  }, [fps]);
  return t;
}
