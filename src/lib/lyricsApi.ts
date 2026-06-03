import { parseLrc, type LrcLine } from "./lrcParser";
import { fetchBetterLyrics } from "./betterLyricsApi";

const BASE_URL = "https://lrclib.net/api";

interface LrclibResponse {
  syncedLyrics?: string;
  plainLyrics?: string;
  duration?: number;
  trackName?: string;
  artistName?: string;
}

export interface LyricsResult {
  lines: LrcLine[];
  source: string;
}

export async function fetchLyrics(
  title: string,
  artist: string,
  durationSecs: number
): Promise<LyricsResult | null> {
  // 1. Try better-lyrics API (may have word-level TTML/enhanced LRC)
  try {
    const betterResult = await fetchBetterLyrics(title, artist, durationSecs * 1000);
    if (betterResult && betterResult.lines.length > 0) return betterResult;
  } catch { /* fall through */ }

  // 2. Exact LRCLIB lookup
  try {
    const params = new URLSearchParams({
      track_name: title,
      artist_name: artist,
      duration: String(Math.round(durationSecs)),
    });
    const res = await fetch(`${BASE_URL}/get?${params}`);
    if (res.ok) {
      const data: LrclibResponse = await res.json();
      if (data.syncedLyrics) return { lines: parseLrc(data.syncedLyrics), source: "LRCLib · synced" };
      if (data.plainLyrics) return { lines: plainToLines(data.plainLyrics), source: "LRCLib · plain" };
    }
  } catch { /* fall through */ }

  // 3. LRCLIB search fallback
  try {
    const searchParams = new URLSearchParams({ q: `${title} ${artist}` });
    const searchRes = await fetch(`${BASE_URL}/search?${searchParams}`);
    if (searchRes.ok) {
      const results: LrclibResponse[] = await searchRes.json();
      const best = results
        .filter((r) => r.syncedLyrics || r.plainLyrics)
        .sort((a, b) => {
          const diffA = Math.abs((a.duration ?? 0) - durationSecs);
          const diffB = Math.abs((b.duration ?? 0) - durationSecs);
          return diffA - diffB;
        })[0];
      if (best?.syncedLyrics) return { lines: parseLrc(best.syncedLyrics), source: "LRCLib · search" };
      if (best?.plainLyrics) return { lines: plainToLines(best.plainLyrics), source: "LRCLib · plain" };
    }
  } catch { /* ignore */ }

  return null;
}

function plainToLines(plain: string): LrcLine[] {
  return plain
    .split("\n")
    .map((text, i) => ({ time: i * 5, text: text.trim() }))
    .filter((l) => l.text.length > 0);
}
