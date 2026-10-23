import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { dispatchAction } from "@/lib/actions";
import {
  COPILOT_SYSTEM,
  COPILOT_TOOL,
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

const MODEL = process.env.SWIFTAID_MODEL ?? "claude-sonnet-5-5";

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

  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    try {
      const client = new Anthropic({ apiKey: key, timeout: 20_000, maxRetries: 0 });
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 600,
        system: `${COPILOT_SYSTEM}\n\nCURRENT STATE\n${stateBrief(store.state)}`,
        tools: [COPILOT_TOOL],
        tool_choice: { type: "tool", name: COPILOT_TOOL.name },
        messages: [
          ...(history ?? []).map((h) => ({ role: h.role, content: h.text })),
          { role: "user" as const, content: message },
        ],
      });
      const tool = res.content.find((b) => b.type === "tool_use");
      if (tool && tool.type === "tool_use") {
        const input = tool.input as { reply?: string; actions?: unknown[] };
        reply = String(input.reply ?? "");
        proposed = Array.isArray(input.actions) ? input.actions : [];
        source = "ai";
      }
    } catch {
      /* fall through to rules */
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
