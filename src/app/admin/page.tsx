"use client";

import { Atom, Bot, Route, Store } from "lucide-react";
import { useState } from "react";
import { BatchRail } from "@/components/admin/BatchRail";
import { ChaosPanel } from "@/components/admin/ChaosPanel";
import { DemoGuide } from "@/components/admin/DemoGuide";
import { Copilot } from "@/components/admin/Copilot";
import { EventFeed } from "@/components/admin/EventFeed";
import { KpiStrip } from "@/components/admin/KpiStrip";
import { MarketPanel } from "@/components/admin/MarketPanel";
import { OptimizerLab } from "@/components/admin/OptimizerLab";
import { ResourceRail } from "@/components/admin/ResourceRail";
import { Timeline } from "@/components/admin/Timeline";
import { LiveMap, type MapSelection } from "@/components/map/LiveMap";
import { TopBar } from "@/components/shell/TopBar";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Toaster } from "@/components/ui/Toaster";
import { useSnapshot } from "@/lib/client/live";

export default function AdminPage() {
  const snap = useSnapshot();
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [focusRider, setFocusRider] = useState<string | null>(null);
  const [lab, setLab] = useState(false);
  const [copilot, setCopilot] = useState(false);
  const [guide, setGuide] = useState(false);
  const [market, setMarket] = useState(false);

  const onSelect = (s: MapSelection) => {
    if (!snap) return;
    if (s.type === "donor") {
      const latest = [...snap.batches].reverse().find((b) => b.donorId === s.id);
      setSelectedBatch(latest?.id ?? null);
    } else if (s.type === "rider") {
      setFocusRider(s.id);
      const leg = snap.legs.find((l) => l.riderId === s.id && (l.state === "to_pickup" || l.state === "to_drop" || l.state === "offered"));
      if (leg) setSelectedBatch(leg.batchId);
    }
  };

  return (
    <main className="relative bg-bg lg:h-dvh lg:overflow-hidden">
      <div className="relative h-[46vh] min-h-[320px] lg:absolute lg:inset-0 lg:h-full">
        <LiveMap selectedBatchId={selectedBatch} highlightRiderId={focusRider} onSelect={onSelect} padding={{ top: 150, right: 410, bottom: 250, left: 410 }} />
        <div className="pointer-events-none absolute inset-0" style={{ background: "var(--map-overlay)" }} />
      </div>

      {!snap ? (
        <div className="absolute inset-0 grid place-items-center">
          <div className="glass rounded-xl px-6 py-4 text-sm text-dim">Connecting to the Pune network…</div>
        </div>
      ) : (
        <div className="pointer-events-none relative z-10 flex flex-col gap-3 p-3 lg:absolute lg:inset-0 lg:grid lg:grid-cols-[372px_minmax(0,1fr)_372px] lg:grid-rows-[auto_auto_minmax(0,1fr)_206px]">
          <div className="pointer-events-auto lg:col-span-3">
            <TopBar
              right={
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" aria-label="Marketplace" icon={<Store className="size-3.5" />} onClick={() => setMarket(true)}>
                    <span className="hidden md:inline">Marketplace</span>
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Guided demo" icon={<Route className="size-3.5" />} onClick={() => setGuide(true)}>
                    <span className="hidden md:inline">Demo</span>
                  </Button>
                  <Button size="sm" variant="ai" aria-label="Copilot" icon={<Bot className="size-3.5" />} onClick={() => setCopilot(true)}>
                    <span className="hidden sm:inline">Copilot</span>
                  </Button>
                  <Button size="sm" variant="ai" aria-label="Optimizer Lab" icon={<Atom className="size-3.5" />} onClick={() => setLab(true)}>
                    <span className="hidden sm:inline">Optimizer Lab</span>
                  </Button>
                </div>
              }
            />
          </div>

          <div className="pointer-events-auto flex min-h-0 flex-col gap-3 lg:col-start-1 lg:row-span-3 lg:row-start-2">
            <BatchRail snap={snap} selectedId={selectedBatch} onSelect={setSelectedBatch} className="max-h-[60vh] min-h-[260px] lg:max-h-none lg:flex-1" />
            <EventFeed snap={snap} className="h-[210px]" compact />
          </div>

          <div className="pointer-events-auto lg:col-start-2 lg:row-start-2">
            <KpiStrip snap={snap} />
          </div>

          <div className="pointer-events-auto flex min-h-0 flex-col gap-3 lg:col-start-3 lg:row-span-3 lg:row-start-2">
            <ResourceRail snap={snap} focusRiderId={focusRider} className="max-h-[60vh] min-h-[260px] lg:max-h-none lg:flex-1" />
            <ChaosPanel snap={snap} />
          </div>

          <div className="pointer-events-auto lg:col-start-2 lg:row-start-4">
            <Timeline snap={snap} selectedBatchId={selectedBatch} className="h-[206px]" />
          </div>
        </div>
      )}

      {snap && (
        <Drawer open={market} onClose={() => setMarket(false)} title="Marketplace" icon={<Store className="size-4 text-safe" />} width={560}>
          <MarketPanel snap={snap} />
        </Drawer>
      )}
      {snap && (
        <Drawer open={guide} onClose={() => setGuide(false)} title="Guided demo" icon={<Route className="size-4 text-safe" />} width={460}>
          <DemoGuide snap={snap} openCopilot={() => { setGuide(false); setCopilot(true); }} openLab={() => { setGuide(false); setLab(true); }} />
        </Drawer>
      )}
      <Drawer open={copilot} onClose={() => setCopilot(false)} title="Dispatcher Copilot" icon={<Bot className="size-4 text-ai" />} width={520}>
        <Copilot />
      </Drawer>
      {snap && (
        <Drawer open={lab} onClose={() => setLab(false)} title="Optimizer Lab · QIGA / QPSO" icon={<Atom className="size-4 text-ai" />} width={600}>
          <OptimizerLab snap={snap} />
        </Drawer>
      )}
      <Toaster />
    </main>
  );
}
