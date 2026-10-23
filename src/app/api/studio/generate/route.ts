import { NextResponse } from "next/server";
import { z } from "zod";
import { geminiConfigured, geminiJson } from "@/lib/ai/gemini";
import { BLANK_SPEC, FAILURE_LABEL, PRESETS, scenarioSchema, type ScenarioSpec } from "@/lib/market/studio-presets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const body = z.object({ prompt: z.string().min(3).max(600) });

const SYSTEM = `You design disaster-relief logistics test scenarios for a Pune perishable-aid dispatch simulator.
Return ONE JSON object only, matching this shape exactly:
{"name":string,"description":string,"donors":1-14,"shelters":1-12,"riders":1-30,"trafficFactor":1-5,"riderReliability":0.4-0.99,"expiryScale":0.2-4,"donorResponseRate":0-1,"autopilot":true,"autoOrders":true,
"listings":[{"category":"cooked|raw_ration|medical|infant_formula|kit","label":string,"qty":int,"expiresInMin":10-4000,"cold":boolean}],
"requests":[{"category":same,"qty":int,"priority":"normal|high|critical","neededInMin":10-2000}],
"failures":[{"atMin":0-60,"type":"${Object.keys(FAILURE_LABEL).join("|")}","factor":number?,"durationMin":number?,"count":int?}]}
Rules: cooked food lasts 60-180 min, formula and kits many hours, medical 120-480 min with cold:true. Keep 4-10 listings, 2-7 requests, 2-5 failures. Times in minutes from start. No prose.`;

function offline(prompt: string): ScenarioSpec {
  const p = prompt.toLowerCase();
  const pick = (id: string) => PRESETS.find((x) => x.id === id)!.spec;
  if (/flood|rain|storm/.test(p)) return pick("flash_flood");
  if (/hospital|medic|cold|insulin|vaccine/.test(p)) return pick("hospital_cold_chain");
  if (/festival|wedding|surplus|banquet/.test(p)) return pick("festival_surplus");
  if (/rider|shortage|strike|fuel/.test(p)) return pick("rider_shortage");
  if (/heat|summer|spoil/.test(p)) return pick("heatwave_expiry");
  return { ...BLANK_SPEC, name: prompt.slice(0, 60) };
}

export async function POST(req: Request) {
  let b: z.infer<typeof body>;
  try {
    b = body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Describe the situation in a few words" }, { status: 400 });
  }
  if (geminiConfigured()) {
    const r = await geminiJson<ScenarioSpec>({
      system: SYSTEM,
      parts: [{ text: `Scenario request: ${b.prompt}` }],
      validate: (raw) => {
        const r = scenarioSchema.safeParse(raw);
        return r.success ? r.data : null;
      },
      cacheKey: `studio:${b.prompt.trim().toLowerCase()}`,
      timeoutMs: 20000,
    }).catch(() => null);
    if (r?.ok && r.data) return NextResponse.json({ ok: true, spec: r.data, source: "ai", model: r.model });
  }
  return NextResponse.json({ ok: true, spec: offline(b.prompt), source: "offline" });
}
