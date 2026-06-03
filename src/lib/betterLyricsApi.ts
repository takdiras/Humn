import { invoke, Channel } from "@tauri-apps/api/core";
import { parseLrc, type LrcLine } from "./lrcParser";
import { parseTtml } from "./ttmlParser";
import { parseQrc } from "./qrcParser";
import { getAuthToken } from "./turnstile";

/**
 * Priority ranking — mirrors PROVIDER_CONFIGS from better-lyrics constants.ts
 * (higher number = better quality, inverted from their 0=best ascending order)
 *
 *  15 = bLyrics-richsynced  — golyrics Apple Music TTML syllable  (their priority 0)
 *  13 = binimum-richsynced  — BiniLyrics TTML syllable            (their priority 2)
 *  12 = portato-richsynced  — QQ Music QRC word-level             (their priority 3)
 *  11 = musixmatch-richsync — Musixmatch word-by-word LRC         (their priority 4)
 *  10 = bLyrics-synced      — golyrics TTML line-level            (their priority 5)
 *   7 = binimum-synced      — BiniLyrics TTML line-level          (their priority 8)
 *   6 = lrclib-synced       — LRCLib synced LRC                   (their priority 9)
 *   5 = legato-synced       — KuGou synced LRC                    (their priority 10)
 *   4 = musixmatch-synced   — Musixmatch line synced LRC          (their priority 11)
 *   1 = lrclib-plain        — LRCLib plain text                   (their priority 14)
 */
function calcPriority(
  provider: string,
  lines: LrcLine[],
  opts?: { isWordByWord?: boolean; timingType?: string }
): number {
  const hasWords = lines.some((l) => l.words && l.words.length > 0);
  switch (provider) {
    case "golyrics":
      return hasWords ? 15 : 10;
    case "binimum":
      if (opts?.timingType === "syllable" || hasWords) return 13;
      return 7;
    case "qq":
      return hasWords ? 12 : 0;
    case "musixmatch":
      return opts?.isWordByWord || hasWords ? 11 : 4;
    case "lrclib":
      return 6;
    case "kugou":
      return 5;
    default:
      return 0;
  }
}

interface ProviderEvent {
  provider: string;
  results: Record<string, string | undefined>;
}

function processProvider(event: ProviderEvent): Array<{ lines: LrcLine[]; priority: number; source: string }> {
  const { provider, results: r } = event;
  const out: Array<{ lines: LrcLine[]; priority: number; source: string }> = [];

  const tryLrc = (raw: string | undefined): LrcLine[] | null => {
    if (!raw) return null;
    const lines = parseLrc(raw);
    return lines.length > 0 ? lines : null;
  };

  const tryTtml = (raw: string | undefined): LrcLine[] | null => {
    if (!raw) return null;
    const lines = parseTtml(raw);
    return lines.length > 0 ? lines : null;
  };

  if (provider === "musixmatch") {
    const wbw = tryLrc(r.wordByWord);
    if (wbw) {
      out.push({ lines: wbw, priority: calcPriority("musixmatch", wbw, { isWordByWord: true }), source: "Musixmatch · word" });
    } else {
      const syn = tryLrc(r.synced);
      if (syn) out.push({ lines: syn, priority: calcPriority("musixmatch", syn), source: "Musixmatch · line" });
    }
  }

  if (provider === "lrclib") {
    const syn = tryLrc(r.synced);
    if (syn) {
      out.push({ lines: syn, priority: calcPriority("lrclib", syn), source: "LRCLib · synced" });
    } else if (r.plain) {
      const plainLines = r.plain
        .split("\n")
        .map((text, i) => ({ time: i * 5, text: text.trim() }))
        .filter((l) => l.text.length > 0);
      if (plainLines.length > 0) out.push({ lines: plainLines, priority: 1, source: "LRCLib · plain" });
    }
  }

  if (provider === "kugou") {
    try {
      const decoded = JSON.parse(r.lyrics ?? "{}");
      const lines = tryLrc(decoded.lyrics);
      if (lines) out.push({ lines, priority: calcPriority("kugou", lines), source: "KuGou · synced" });
    } catch { /* ignore */ }
  }

  if (provider === "qq") {
    try {
      const decoded = JSON.parse(r.lyrics ?? "{}");
      const lines = parseQrc(decoded.lyrics ?? "");
      if (lines.length > 0) out.push({ lines, priority: calcPriority("qq", lines), source: "QQ Music · word" });
    } catch { /* ignore */ }
  }

  if (provider === "golyrics") {
    let ttmlContent = r.lyrics;
    if (ttmlContent) {
      // May be double-encoded: {"ttml":"<TTML xml>"} or raw TTML XML
      try {
        const parsed = JSON.parse(ttmlContent);
        if (parsed.ttml) ttmlContent = parsed.ttml;
      } catch { /* raw TTML, use as-is */ }
      const lines = tryTtml(ttmlContent);
      if (lines) {
        const hasWords = lines.some((l) => l.words && l.words.length > 0);
        out.push({ lines, priority: calcPriority("golyrics", lines), source: hasWords ? "Apple Music · syllable" : "Apple Music · line" });
      }
    }
  }

  if (provider === "binimum") {
    const lines = tryTtml(r.lyrics);
    if (lines) {
      const priority = calcPriority("binimum", lines, { timingType: r.timingType });
      const hasWords = lines.some((l) => l.words && l.words.length > 0);
      out.push({
        lines,
        priority,
        source: (hasWords || r.timingType === "syllable") ? "BiniLyrics · syllable" : "BiniLyrics · line",
      });
    }
  }

  return out;
}

type RustLyricsEvent =
  | { type: "provider"; event: string; data: string }
  | { type: "done" }
  | { type: "error"; message: string };

export async function fetchBetterLyrics(
  title: string,
  artist: string,
  durationMs: number
): Promise<{ lines: LrcLine[]; source: string } | null> {
  const token = await getAuthToken() ?? "";

  return new Promise((resolve) => {
    let bestLines: LrcLine[] | null = null;
    let bestPriority = -1;
    let bestSource: string | null = null;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(bestLines ? { lines: bestLines, source: bestSource ?? "better-lyrics" } : null);
    };

    const timeout = setTimeout(finish, 25000);

    const channel = new Channel<RustLyricsEvent>();
    channel.onmessage = (msg) => {
      if (msg.type === "done") {
        clearTimeout(timeout);
        finish();
        return;
      }
      if (msg.type === "error") {
        clearTimeout(timeout);
        finish();
        return;
      }
      if (msg.type === "provider") {
        try {
          const parsed = JSON.parse(msg.data) as ProviderEvent;
          for (const { lines, priority, source } of processProvider(parsed)) {
            if (priority > bestPriority) {
              bestLines = lines;
              bestPriority = priority;
              bestSource = source;
            }
          }
          if (bestPriority >= 13) {
            clearTimeout(timeout);
            finish();
          }
        } catch { /* ignore parse errors */ }
      }
    };

    invoke("stream_lyrics", {
      onEvent: channel,
      title,
      artist,
      durationSecs: Math.round(durationMs / 1000),
      token,
      videoId: "",
    }).catch(() => {
      clearTimeout(timeout);
      finish();
    });
  });
}
