import { NextResponse } from "next/server";
import { dispatchAction } from "@/lib/actions";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const res = dispatchAction(getStore(), body);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
