import { useEffect, useRef } from "react";
import { LyricLine } from "./LyricLine";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { LrcLine } from "@/lib/lrcParser";
import { Music } from "lucide-react";

interface LyricsViewProps {
  lines: LrcLine[];
  activeIndex: number;
  positionMs: number;
  loading: boolean;
  hasTrack: boolean;
}

/** Min gap between lines (ms) before showing the instrumental progress bar */
const GAP_THRESHOLD_MS = 10000;

interface GapIndicatorProps {
  startMs: number;
  endMs: number;
  positionMs: number;
  status: "active" | "past" | "future";
}

function GapIndicator({ startMs, endMs, positionMs, status }: GapIndicatorProps) {
  const pct =
    status === "past"
      ? 100
      : status === "active"
        ? Math.min(100, Math.max(0, ((positionMs - startMs) / (endMs - startMs)) * 100))
        : 0;

  return (
    <div className="px-6 py-4">
      <div className="h-[2px] w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-white/40"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

type LineItem = { type: "line"; index: number };
type GapItem = { type: "gap"; afterIndex: number; startMs: number; endMs: number };
type RenderItem = LineItem | GapItem;

export function LyricsView({
  lines,
  activeIndex,
  positionMs,
  loading,
  hasTrack,
}: LyricsViewProps) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex]);

  if (!hasTrack) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-white/25">
        <Music className="w-10 h-10" />
        <p className="text-sm">Nothing playing</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-sm">
        Loading lyrics…
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/30 text-sm">
        No lyrics found
      </div>
    );
  }

  // Build render list: lines interleaved with gap indicators where silences are long enough
  const items: RenderItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    items.push({ type: "line", index: i });
    if (i < lines.length - 1) {
      const gapMs = lines[i + 1].time * 1000 - lines[i].time * 1000;
      if (gapMs >= GAP_THRESHOLD_MS) {
        // Start the bar only after the previous line finishes singing
        const prevLine = lines[i];
        let lineEndMs: number;
        if (prevLine.words && prevLine.words.length > 0) {
          const last = prevLine.words[prevLine.words.length - 1];
          lineEndMs = last.startMs + last.durationMs;
        } else {
          // No word timing: estimate ~2s singing duration
          lineEndMs = prevLine.time * 1000 + 2000;
        }
        items.push({
          type: "gap",
          afterIndex: i,
          startMs: lineEndMs,
          endMs: lines[i + 1].time * 1000,
        });
      }
    }
  }

  // Active group time — all lines at the same timestamp as activeIndex are highlighted
  const activeTime = activeIndex >= 0 ? lines[activeIndex].time : -1;

  return (
    <div className="relative h-full flex flex-col">
      <ScrollArea className="flex-1">
        <div className="pt-48 pb-12">
          {items.map((item, key) => {
            if (item.type === "gap") {
              const gapStatus =
                activeIndex === item.afterIndex
                  ? "active"
                  : activeIndex > item.afterIndex
                    ? "past"
                    : "future";
              return (
                <GapIndicator
                  key={`gap-${key}`}
                  startMs={item.startMs}
                  endMs={item.endMs}
                  positionMs={positionMs}
                  status={gapStatus}
                />
              );
            }

            const { index } = item;
            const line = lines[index];
            const isActiveGroup = activeTime >= 0 && Math.abs(line.time - activeTime) < 0.05;
            const status = isActiveGroup ? "active" : index < activeIndex ? "past" : "future";

            // Attach scroll ref to the first line of the active group
            const isFirstOfActiveGroup =
              isActiveGroup &&
              (index === 0 || Math.abs(lines[index - 1].time - activeTime) >= 0.05);

            return (
              <div key={`line-${key}`} ref={isFirstOfActiveGroup ? activeRef : undefined}>
                <LyricLine
                  text={line.text}
                  status={status}
                  words={status === "active" ? line.words : undefined}
                  positionMs={status === "active" ? positionMs : undefined}
                  agent={line.agent}
                  isBackground={line.isBackground}
                />
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
