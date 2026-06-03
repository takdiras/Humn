export interface LyricWord {
  text: string;
  startMs: number;
  durationMs: number;
}

export interface LrcLine {
  time: number; // seconds
  text: string;
  words?: LyricWord[];
  /** Singer agent from TTML: "v1" = primary (left), "v2"/"v3" = secondary (right), "v1000" = unison (center) */
  agent?: string;
  /** True for background/harmony vocal lines (smaller, dimmer) */
  isBackground?: boolean;
}

const LINE_TIME_REGEX = /\[(\d{2}):(\d{2})[.:](\d{2,3})\]/g;

function parseTimeMs(m: string, s: string, frac: string): number {
  return (
    parseInt(m, 10) * 60000 +
    parseInt(s, 10) * 1000 +
    parseInt(frac.padEnd(3, "0"), 10)
  );
}

function parseWordTimestamps(raw: string): { text: string; words?: LyricWord[] } {
  const WORD_TAG = /<(\d{2}):(\d{2})[.:](\d{2,3})>/g;
  if (!WORD_TAG.test(raw)) return { text: raw };
  WORD_TAG.lastIndex = 0;

  const timeMatches = [...raw.matchAll(WORD_TAG)];
  const parts = raw.split(/<\d{2}:\d{2}[.:]\d{2,3}>/);

  const words: LyricWord[] = [];
  for (let i = 0; i < timeMatches.length; i++) {
    const wordText = (parts[i + 1] ?? "").trim();
    if (!wordText) continue;
    const startMs = parseTimeMs(timeMatches[i][1], timeMatches[i][2], timeMatches[i][3]);
    const nextMatch = timeMatches[i + 1];
    const endMs = nextMatch
      ? parseTimeMs(nextMatch[1], nextMatch[2], nextMatch[3])
      : startMs + 500;
    words.push({ text: wordText, startMs, durationMs: Math.max(endMs - startMs, 50) });
  }

  const text = raw.replace(/<\d{2}:\d{2}[.:]\d{2,3}>/g, " ").replace(/\s+/g, " ").trim();
  return { text, words: words.length > 0 ? words : undefined };
}

export function parseLrc(lrc: string): LrcLine[] {
  const result: LrcLine[] = [];

  for (const line of lrc.split("\n")) {
    const lineMatches = [...line.matchAll(LINE_TIME_REGEX)];
    if (lineMatches.length === 0) continue;

    const rawContent = line.replace(LINE_TIME_REGEX, "").trim();
    const { text, words } = parseWordTimestamps(rawContent);

    for (const match of lineMatches) {
      const timeMs = parseTimeMs(match[1], match[2], match[3]);
      result.push({ time: timeMs / 1000, text, words });
    }
  }

  return result.sort((a, b) => a.time - b.time);
}
