import { NextResponse } from "next/server";
import { z } from "zod";
import { benchmark, bundleBenchmark, stress } from "@/lib/market/intel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const body = z.object({ kind: z.enum(["benchmark", "stress", "bundles"]), trials: z.number().int().min(3).max(60).optional() });

export async function POST(req: Request) {
  let b: z.infer<typeof body>;
  try {
    b = body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  if (b.kind === "benchmark") return NextResponse.json({ ok: true, ...benchmark(b.trials ?? 20) });
  if (b.kind === "stress") return NextResponse.json({ ok: true, rows: stress() });
  return NextResponse.json({ ok: true, ...bundleBenchmark(b.trials ?? 24) });
}
