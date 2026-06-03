import type { LyricWord, LrcLine } from "./lrcParser";

// QRC format: [lineStartMs,lineDurationMs]word1(wordStartMs,wordDurationMs)word2(wordStartMs,wordDurationMs)
// Used by QQ Music (portato provider in better-lyrics)

function parseLineTime(src: string): { startMs: number; rest: string } | null {
  if (src[0] !== "[") return null;
  const close = src.indexOf("]");
  if (close === -1) return null;
  const comma = src.indexOf(",", 1);
  if (comma === -1 || comma > close) return null;
  const startMs = parseInt(src.slice(1, comma), 10);
  if (isNaN(startMs)) return null;
  return { startMs, rest: src.slice(close + 1) };
}

function parseQrcWords(src: string): LyricWord[] {
  const words: LyricWord[] = [];
  const regex = /(.*?)\((\d+),(\d+)\)/g;
  let match;
  while ((match = regex.exec(src)) !== null) {
    const text = match[1];
    if (!text.trim()) continue;
    words.push({
      text,
      startMs: parseInt(match[2], 10),
      durationMs: parseInt(match[3], 10),
    });
  }
  return words;
}

export function parseQrc(qrcXml: string): LrcLine[] {
  if (!qrcXml) return [];

  // Extract LyricContent from QRC XML wrapper if present
  let content = qrcXml;
  const attrMatch = qrcXml.match(/LyricContent="([\s\S]*?)"\s*(?:\/?>|[a-zA-Z]+=)/);
  if (attrMatch) {
    content = attrMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  } else if (qrcXml.includes("<QrcInfos>") && !qrcXml.startsWith("[")) {
    return [];
  }

  const lines: LrcLine[] = [];

  for (const raw of content.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (/^\[[a-zA-Z]+:/.test(trimmed)) continue; // skip LRC-style metadata

    const lineTime = parseLineTime(trimmed);
    if (!lineTime) continue;

    const words = parseQrcWords(lineTime.rest);
    const text = words.map((w) => w.text).join("").trim();
    if (!text) continue;

    lines.push({
      time: lineTime.startMs / 1000,
      text,
      words: words.length > 0 ? words : undefined,
    });
  }

  return lines.sort((a, b) => a.time - b.time);
}
