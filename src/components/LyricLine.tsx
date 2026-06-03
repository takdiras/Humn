import { cn } from "@/lib/utils";
import type { LyricWord } from "@/lib/lrcParser";

interface LyricLineProps {
  text: string;
  status: "active" | "past" | "future";
  words?: LyricWord[];
  positionMs?: number;
  /** TTML singer agent: "v1" left, "v2"/"v3" right, "v1000" center */
  agent?: string;
  isBackground?: boolean;
}

function agentAlignment(agent: string | undefined): "left" | "right" | "center" {
  if (!agent) return "left";
  if (agent === "v1000") return "center";
  // v2, v3, bg-v2, etc. → right; v1, bg-v1 → left
  const num = parseInt(agent.replace(/[^0-9]/g, ""), 10);
  if (!isNaN(num) && num >= 2 && num < 1000) return "right";
  return "left";
}

export function LyricLine({
  text,
  status,
  words,
  positionMs = 0,
  agent,
  isBackground = false,
}: LyricLineProps) {
  if (!text.trim()) return <div className="h-2" />;

  const alignment = agentAlignment(agent);
  const hasWords = status === "active" && words && words.length > 0;

  const containerClass = cn(
    "px-6 py-1.5 text-base leading-relaxed select-none flex",
    alignment === "right" && "justify-end",
    alignment === "center" && "justify-center",
    alignment === "left" && "justify-start",
    isBackground && "py-0.5"
  );

  const textClass = cn(
    isBackground && "text-[0.8em] font-medium",
    !hasWords && status === "active" && "text-white",
    !hasWords && status === "past" && "text-white/75",
    !hasWords && status === "future" && (isBackground ? "text-white/25" : "text-white/40")
  );

  return (
    <div className={containerClass}>
      {hasWords ? (
        // ── Word-level karaoke ──────────────────────────
        <span className={isBackground ? "text-[0.8em] font-medium" : undefined}>
          {words.map((word, i) => {
            const elapsed = positionMs - word.startMs;
            const done = elapsed >= word.durationMs;
            const pending = elapsed < 0;

            let style: React.CSSProperties;
            if (done) {
              style = { color: "white" };
            } else if (pending) {
              style = { color: isBackground ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.3)" };
            } else {
              const pct = (elapsed / word.durationMs) * 100;
              style = {
                backgroundImage: `linear-gradient(90deg, white ${pct}%, ${isBackground ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.3)"} ${pct}%)`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                display: "inline-block",
              };
            }

            return (
              <span key={i}>
                <span style={style}>{word.text}</span>
                {i < words.length - 1 && " "}
              </span>
            );
          })}
        </span>
      ) : (
        // ── Line-level: highlight active line white ─────
        <span className={textClass}>{text}</span>
      )}
    </div>
  );
}
