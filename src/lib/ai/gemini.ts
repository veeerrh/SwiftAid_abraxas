import { createHash } from "node:crypto";

/**
 * Thin Gemini client (REST) with a primary and a fallback model, JSON output, timeouts and an
 * in-memory cache so repeated demo inputs cost no quota. The key is read on the server only.
 */

export const PRIMARY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
export const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.5-flash";

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface GeminiResult<T> {
  ok: boolean;
  data?: T;
  model?: string;
  cached?: boolean;
  error?: string;
}

const cache = new Map<string, unknown>();

export const geminiConfigured = () => !!process.env.GEMINI_API_KEY;

/** These models reason before answering, which is slow. Keep thinking light for fast, structured answers. */
function thinkingFor(model: string): { thinkingLevel: string } | undefined {
  if (model.includes("3.8")) return { thinkingLevel: "low" };
  if (model.includes("3.5") || model.includes("3.1")) return { thinkingLevel: "minimal" };
  return undefined;
}

async function callModel(model: string, system: string, parts: Part[], timeoutMs: number): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("no key");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      signal: ctl.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 2000, ...(thinkingFor(model) ? { thinkingConfig: thinkingFor(model) } : {}) },
      }),
    });
    if (!res.ok) throw new Error(`${model}: HTTP ${res.status}`);
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new Error(`${model}: empty answer`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Strip code fences and parse JSON. */
export function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(t);
}

/**
 * Ask Gemini for JSON. Tries the primary model, then the fallback. `validate` must return the typed
 * value or null; invalid output counts as a failure so nothing unchecked reaches the engine.
 */
export async function geminiJson<T>(opts: {
  system: string;
  parts: Part[];
  validate: (raw: unknown) => T | null;
  cacheKey?: string;
  timeoutMs?: number;
}): Promise<GeminiResult<T>> {
  if (!geminiConfigured()) return { ok: false, error: "AI is not configured" };
  const ck = opts.cacheKey ? createHash("sha256").update(opts.cacheKey).digest("hex") : null;
  if (ck && cache.has(ck)) return { ok: true, data: cache.get(ck) as T, cached: true };
  let lastError = "unknown error";
  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
    try {
      const text = await callModel(model, opts.system, opts.parts, opts.timeoutMs ?? 25_000);
      const data = opts.validate(parseJson(text));
      if (!data) throw new Error(`${model}: answer did not match the expected shape`);
      if (ck) cache.set(ck, data);
      return { ok: true, data, model };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, error: lastError };
}

export function imageHash(base64: string): string {
  return createHash("sha256").update(base64).digest("hex").slice(0, 16);
}
