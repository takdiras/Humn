import { useEffect, useRef, useState } from "react";
import { fetchLyrics } from "@/lib/lyricsApi";
import type { LrcLine } from "@/lib/lrcParser";

export function useLyrics(
  title: string | undefined,
  artist: string | undefined,
  durationMs: number,
  positionMs: number
) {
  const [lines, setLines] = useState<LrcLine[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cache = useRef<Map<string, { lines: LrcLine[]; source: string }>>(new Map());

  // Fetch lyrics when the track changes
  useEffect(() => {
    if (!title || !artist) {
      setLines([]);
      setActiveIndex(-1);
      setSource(null);
      return;
    }

    const key = `${title}::${artist}`;

    if (cache.current.has(key)) {
      const cached = cache.current.get(key)!;
      setLines(cached.lines);
      setSource(cached.source);
      return;
    }

    setLoading(true);
    setLines([]);
    setActiveIndex(-1);
    setSource(null);

    fetchLyrics(title, artist, durationMs / 1000).then((result) => {
      const lines = result?.lines ?? [];
      const source = result?.source ?? null;
      cache.current.set(key, { lines, source: source ?? "" });
      setLines(lines);
      setSource(source);
      setLoading(false);
    });
  }, [title, artist, durationMs]);

  // Update active line index as playback position changes
  useEffect(() => {
    if (lines.length === 0) return;
    const positionSec = positionMs / 1000;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= positionSec) idx = i;
      else break;
    }
    setActiveIndex(idx);
  }, [positionMs, lines]);

  return { lines, activeIndex, source, loading };
}
