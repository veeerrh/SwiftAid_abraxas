import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { fallbackParse, INTAKE_SYSTEM, INTAKE_TOOL, sanitizeDraft, type Draft } from "@/lib/intake";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const body = z.object({
  text: z.string().max(2000).optional(),
  imageBase64: z.string().max(6_000_000).optional(),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]).optional(),
});

const MODEL = process.env.SWIFTAID_MODEL ?? "claude-sonnet-5-5";

/**
 * Turns a photo and/or description into a draft donation.
 * The model only proposes; the donor reviews it and the engine re-validates everything.
 * Without an API key (or on any failure) a deterministic parser takes over so intake never breaks.
 */
export async function POST(req: Request) {
  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  const text = (parsed.text ?? "").trim();
  if (!text && !parsed.imageBase64) {
    return NextResponse.json({ ok: false, error: "Add a description or a photo" }, { status: 400 });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    try {
      const client = new Anthropic({ apiKey: key, timeout: 20_000, maxRetries: 0 });
      const content: Anthropic.Messages.ContentBlockParam[] = [];
      if (parsed.imageBase64) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: parsed.mediaType ?? "image/jpeg", data: parsed.imageBase64 },
        });
      }
      content.push({
        type: "text",
        text: text
          ? `Donor description: "${text}"\n\nRecord this donation.`
          : "No description was given. Record the donation shown in the photo.",
      });
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 700,
        system: INTAKE_SYSTEM,
        tools: [INTAKE_TOOL],
        tool_choice: { type: "tool", name: INTAKE_TOOL.name },
        messages: [{ role: "user", content }],
      });
      const tool = res.content.find((b) => b.type === "tool_use");
      const draft = tool && tool.type === "tool_use" ? sanitizeDraft(tool.input, "ai") : null;
      if (draft) return NextResponse.json({ ok: true, draft });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      return NextResponse.json({ ok: true, draft: offline(text, !!parsed.imageBase64, `AI unavailable (${msg.slice(0, 80)})`) });
    }
  }
  return NextResponse.json({
    ok: true,
    draft: offline(text, !!parsed.imageBase64, key ? "AI returned an unreadable answer" : "Offline mode: set ANTHROPIC_API_KEY to enable photo understanding"),
  });
}

function offline(text: string, hadImage: boolean, note: string): Draft {
  if (text) return { ...fallbackParse(text), note };
  // Photo only, and no model available: nothing was actually read from the image.
  return {
    category: "cooked",
    qty: 20,
    label: "Donation from photo",
    safeMin: 60,
    coldChain: false,
    riskFlags: ["photo not analysed: please confirm every field"],
    confidence: 0.2,
    rationale: hadImage ? "The photo could not be analysed offline, so these are placeholder values for you to correct." : "No details provided.",
    source: "offline-estimate",
    note,
  };
}
