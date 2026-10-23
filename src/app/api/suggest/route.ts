import { NextResponse } from "next/server";
import { z } from "zod";
import { suggestBundles } from "@/lib/market/suggest";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = z.object({ shelterId: z.string(), requestId: z.string().optional(), category: z.enum(["cooked", "raw_ration", "medical", "infant_formula", "kit"]).optional(), qty: z.number().int().min(1).max(5000).optional() });

/** Donor-bundle suggestions for a shelter (QIGA/QPSO). Read-only. */
export async function POST(req: Request) {
  let b: z.infer<typeof body>;
  try {
    b = body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, suggestion: suggestBundles(getStore().state, b.shelterId, b) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 400 });
  }
}
