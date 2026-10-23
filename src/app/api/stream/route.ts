import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-sent events: one JSON snapshot per simulation tick or action. */
export async function GET(req: Request) {
  const store = getStore();
  const enc = new TextEncoder();
  let unsub: (() => void) | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* client went away */
        }
      };
      send(store.snapshot());
      unsub = store.subscribe(send);
      ping = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {
          /* ignore */
        }
      }, 15000);
      req.signal.addEventListener("abort", () => {
        unsub?.();
        if (ping) clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      unsub?.();
      if (ping) clearInterval(ping);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
