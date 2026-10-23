import { geminiJson, geminiConfigured } from "@/lib/ai/gemini";
import { NextResponse } from "next/server";
import { z } from "zod";
import { dispatchAction } from "@/lib/actions";
import {
  COPILOT_SYSTEM,
  describeAction,
  explainOffline,
  simulateDiff,
  stateBrief,
  understandOffline,
  validateProposed,
} from "@/lib/copilot";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const body = z.union([
  z.object({ message: z.string().min(1).max(500), history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(800) })).max(8).optional() }),
  z.object({ apply: z.array(z.unknown()).min(1).max(6) }),
]);

export async function POST(req: Request) {
  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  const store = getStore();

  // Approval: re-validate with the same schema and apply through the normal engine path.
  if ("apply" in parsed) {
    const { actions, rejected } = validateProposed(parsed.apply);
    if (rejected.length || actions.length === 0) return NextResponse.json({ ok: false, error: rejected[0] ?? "Nothing to apply" }, { status: 400 });
    const errors: string[] = [];
    for (const a of actions) {
      const res = dispatchAction(store, a);
      if (!res.ok) errors.push(res.error ?? "failed");
    }
    return NextResponse.json({ ok: errors.length === 0, error: errors[0], applied: actions.length });
  }

  const { message, history } = parsed;
  let reply = "";
  let proposed: unknown[] = [];
  let source: "ai" | "rules" = "rules";

  if (geminiConfigured()) {
    const hist = (history ?? []).map((h) => `${h.role === "user" ? "Dispatcher" : "Copilot"}: ${h.text}`).join("\n");
    const r = await geminiJson<{ reply: string; actions: unknown[] }>({
      system: `${COPILOT_SYSTEM}\n\nReturn ONLY JSON: {"reply": string, "actions": array}. Each action is an object with "type" in [setShelterOpen, setShelterRemaining, setShelterFacility, citizenDrop, chaosGhost, chaosUnghost, chaosTraffic, setAlgo, replan] plus its fields (shelterId, riderId, open, remaining, key, value, amount, algo, factor, durationMin). Questions get a reply and an empty actions array.\n\nCURRENT STATE\n${stateBrief(store.state)}`,
      parts: [{ text: `${hist ? `${hist}\n` : ""}Dispatcher: ${message}` }],
      validate: (raw) => {
        const o = raw as { reply?: unknown; actions?: unknown };
        return typeof o?.reply === "string" ? { reply: o.reply, actions: Array.isArray(o.actions) ? o.actions : [] } : null;
      },
    });
    if (r.ok && r.data) {
      reply = r.data.reply;
      proposed = r.data.actions;
      source = "ai";
    }
  }
  if (source === "rules") {
    const u = understandOffline(store.state, message);
    reply = u.reply;
    proposed = u.actions;
  }

  const { actions, rejected } = validateProposed(proposed);
  if (actions.length === 0) {
    if (!reply) reply = explainOffline(store.state, message);
    return NextResponse.json({ ok: true, source, reply, actions: [], rejected });
  }
  const { diff, errors } = simulateDiff(store, actions);
  return NextResponse.json({
    ok: true,
    source,
    reply,
    actions,
    labels: actions.map((a) => describeAction(store.state, a)),
    diff,
    errors,
    rejected,
  });
}
