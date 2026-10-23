import type { Tone } from "@/lib/client/format";
import { toneVar } from "@/lib/client/format";
import { clamp } from "@/lib/utils";

export function Bar({ value, tone = "safe", height = 6 }: { value: number; tone?: Tone; height?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-full bg-surface3" style={{ height }}>
      <div
        className="h-full rounded-full"
        style={{
          width: `${clamp(value, 0, 1) * 100}%`,
          background: toneVar[tone],
          transition: "width 500ms var(--ease), background 400ms var(--ease)",
        }}
      />
    </div>
  );
}
