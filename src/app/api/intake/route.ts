import { NextResponse } from "next/server";
import { z } from "zod";
import { geminiJson, imageHash, geminiConfigured, type Part } from "@/lib/ai/gemini";
import { fallbackParse, INTAKE_SYSTEM, draftSchema, sanitizeDraft, type Draft } from "@/lib/intake";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 40;

const body = z.object({
  text: z.string().max(2000).optional(),
  imageBase64: z.string().max(6_000_000).optional(),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]).optional(),
});

const PROMPT = `Return ONLY a JSON object with exactly these keys:
category ("cooked" | "raw_ration" | "medical" | "infant_formula" | "kit"), qty (integer), label (short title), safeMin (integer minutes the supplies stay safe, 5-1440; read any expiry or best-before shown, otherwise be conservative), coldChain (boolean), riskFlags (array of up to 6 short strings about visible hygiene/safety issues), confidence (0-1), rationale (1-2 sentences saying what you saw and assumed).`;

/**
 * Photo and/or description → draft donation. The model only proposes; the donor reviews it and the
 * engine re-validates. Without a key (or on failure) a deterministic parser takes over.
 */
export async function POST(req: Request) {
  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  const text = (parsed.text ?? "").trim();
  if (!text && !parsed.imageBase64) return NextResponse.json({ ok: false, error: "Add a description or a photo" }, { status: 400 });

  if (geminiConfigured()) {
    const parts: Part[] = [];
    if (parsed.imageBase64) parts.push({ inlineData: { mimeType: parsed.mediaType ?? "image/jpeg", data: parsed.imageBase64 } });
    parts.push({ text: `${text ? `Donor description: "${text}"` : "No description was given; use the photo."}\n\n${PROMPT}` });
    const r = await geminiJson<Draft>({
      system: INTAKE_SYSTEM,
      parts,
      cacheKey: `intake:${text}:${parsed.imageBase64 ? imageHash(parsed.imageBase64) : ""}`,
      validate: (raw) => {
        const ok = draftSchema.safeParse(raw);
        return ok.success ? sanitizeDraft(ok.data, "ai", undefined) : null;
      },
    });
    if (r.ok && r.data) return NextResponse.json({ ok: true, draft: { ...r.data, note: r.cached ? "Cached result" : undefined }, model: r.model });
    return NextResponse.json({ ok: true, draft: offline(text, !!parsed.imageBase64, `AI unavailable (${(r.error ?? "").slice(0, 80)}); used the built-in parser`) });
  }
  return NextResponse.json({ ok: true, draft: offline(text, !!parsed.imageBase64, "Offline mode: add GEMINI_API_KEY to enable photo understanding") });
}

function offline(text: string, hadImage: boolean, note: string): Draft {
  if (text) return { ...fallbackParse(text), note };
  return {
    category: "cooked",
    qty: 20,
    label: "Donation from photo",
    safeMin: 60,
    coldChain: false,
    riskFlags: ["photo not analysed: please confirm every field"],
    confidence: 0.2,
    rationale: hadImage ? "The photo could not be analysed, so these are placeholder values for you to correct." : "No details provided.",
    source: "offline-estimate",
    note,
  };
}
