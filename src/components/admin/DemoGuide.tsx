"use client";

import { Atom, Baby, Bot, Check, DoorClosed, Ghost, Play, RotateCcw, Users, Utensils } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import type { Action } from "@/lib/actions";
import { act } from "@/lib/client/live";
import type { Snapshot } from "@/lib/store";
import { cn } from "@/lib/utils";

interface Step {
  id: string;
  icon: ReactNode;
  title: string;
  body: string;
  button: string;
  run: () => Promise<void> | void;
  done: (s: Snapshot) => boolean;
}

/** A click-through script for the live demo. Each step triggers a real failure; ticks come from real state. */
export function DemoGuide({ snap, openCopilot, openLab }: { snap: Snapshot; openCopilot: () => void; openLab: () => void }) {
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const run = async (a: Action) => {
    const r = await act(a);
    if (!r.ok) toast(r.error ?? "Action failed", "crit");
  };

  const steps: Step[] = [
    {
      id: "banquet",
      icon: <Utensils className="size-4" />,
      title: "A shelter needs 190 meals: no single donor has that many",
      body: "Yerwada posts a large request. The AI (QIGA + QPSO) suggests which donors to combine, the order is placed, donors confirm, and riders pick trips they can finish before expiry.",
      button: "Post the request and order the AI bundle",
      run: async () => {
        const rq = await act({ type: "createRequest", shelterId: "S2", category: "cooked", qty: 190, priority: "high", label: "Cooked meals for flood-displaced families" });
        if (!rq.ok) return toast(rq.error ?? "Could not post the request", "crit");
        const res = await fetch("/api/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shelterId: "S2", requestId: rq.info?.requestId }) });
        const data = (await res.json()) as { ok: boolean; suggestion?: { bundles: { lines: { listingId: string; qty: number }[] }[] } };
        const top = data.suggestion?.bundles[0];
        if (!top) return toast("No donor can safely reach the shelter right now", "warn");
        await run({ type: "placeOrder", shelterId: "S2", requestId: rq.info?.requestId as string, lines: top.lines });
        toast(`Ordered from ${top.lines.length} donors`, "safe");
      },
      done: (s) => s.market.orders.some((o) => o.shelterId === "S2" && o.qty > 0 && o.createdAt > 0),
    },
    {
      id: "ghost",
      icon: <Ghost className="size-4" />,
      title: "A volunteer goes silent",
      body: "The busiest rider on a marketplace trip stops responding. The heartbeat warning fires, the lease is released, and a rider (or hot standby) takes over before the food spoils.",
      button: "Ghost the busiest rider",
      run: () => run({ type: "chaosGhost" }),
      done: (s) => s.metrics.ghostRecoveries > 0,
    },
    {
      id: "fill",
      icon: <Users className="size-4" />,
      title: "A citizen fills a shelter mid-route",
      body: "Someone drops food directly at the shelter a rider is heading to. The rider is rerouted live, with no stranded cargo.",
      button: "Fill the busiest shelter",
      run: () => run({ type: "chaosSurge" }),
      done: (s) => s.metrics.diverts > 0,
    },
    {
      id: "close",
      icon: <DoorClosed className="size-4" />,
      title: "A shelter closes its demand",
      body: "A shelter stops accepting deliveries while riders are in transit. Inbound riders are diverted; if nothing safe is reachable they are flagged with the reason.",
      button: "Close the busiest shelter",
      run: () => run({ type: "chaosCloseShelter" }),
      done: (s) => s.events.some((e) => e.type === "shelter_closed"),
    },
    {
      id: "formula",
      icon: <Baby className="size-4" />,
      title: "Dependency rules: infant formula needs clean water",
      body: "Every shelter except Hadapsar (no clean water) is closed, then formula is posted. It is held back with the reason, never sent unsafely.",
      button: "Run the formula test",
      run: async () => {
        for (const s of snap.shelters) if (s.id !== "S4") await act({ type: "setShelterOpen", shelterId: s.id, open: false });
        await run({ type: "scenario", key: "formula" });
      },
      done: (s) => s.events.some((e) => e.type === "blocked" && /clean water/i.test(e.text)),
    },
    {
      id: "copilot",
      icon: <Bot className="size-4" />,
      title: "Ask the copilot",
      body: "Type “Reopen Kasba Peth” or “Close Hadapsar”. The copilot simulates the change on a copy of the city and you approve the diff.",
      button: "Open the copilot",
      run: () => {
        setOpened((o) => ({ ...o, copilot: true }));
        openCopilot();
      },
      done: () => !!opened.copilot,
    },
    {
      id: "lab",
      icon: <Atom className="size-4" />,
      title: "Compare the optimizers",
      body: "QIGA, QPSO and the hybrid search the same rule-feasible plans as the greedy baseline. See convergence and the expected safe units each one finds.",
      button: "Open the Optimizer Lab",
      run: () => {
        setOpened((o) => ({ ...o, lab: true }));
        openLab();
      },
      done: () => !!opened.lab,
    },
  ];

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-surface2 p-3.5">
        <p className="text-xs leading-relaxed text-dim">Start from a clean city, then run the steps in order. Every step is a real failure, not an animation.</p>
        <Button size="sm" variant="outline" icon={<RotateCcw className="size-3.5" />} onClick={() => { setOpened({}); void run({ type: "reset", scenario: "quiet" }); }}>
          Clean city
        </Button>
      </div>
      <ol className="space-y-3">
        {steps.map((s, i) => {
          const done = s.done(snap);
          return (
            <li key={s.id} className={cn("rounded-2xl border p-4 transition-colors", done ? "border-safe/40 bg-safe-soft" : "border-line bg-surface2")}>
              <div className="flex items-start gap-3">
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold", done ? "bg-safe text-[#04201c]" : "bg-surface3 text-dim")}>
                  {done ? <Check className="size-4" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="text-dim">{s.icon}</span>
                    {s.title}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-dim">{s.body}</p>
                  <Button size="sm" variant={done ? "ghost" : "primary"} className="mt-3" icon={<Play className="size-3.5" />} onClick={() => void s.run()}>
                    {s.button}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
