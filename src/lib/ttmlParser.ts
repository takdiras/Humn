import type { LyricWord, LrcLine } from "./lrcParser";

function parseTtmlTimeMs(t: string): number {
  // Handle offset-time units: Ns, Nm, Nh, Nms
  const offsetMatch = t.match(/^([\d.]+)(h|m|s|ms)$/);
  if (offsetMatch) {
    const v = parseFloat(offsetMatch[1]);
    const unit = offsetMatch[2];
    if (unit === "h") return Math.round(v * 3600000);
    if (unit === "m") return Math.round(v * 60000);
    if (unit === "s") return Math.round(v * 1000);
    if (unit === "ms") return Math.round(v);
  }
  const parts = t.split(":");
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return Math.round(
      (parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s)) * 1000
    );
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return Math.round((parseInt(m, 10) * 60 + parseFloat(s)) * 1000);
  }
  return Math.round(parseFloat(t) * 1000);
}

/**
 * Some TTML exporters (AMLL etc.) use namespace prefixes without declaring them.
 * Inject synthetic xmlns declarations so the XML parser doesn't throw.
 */
function fixMissingNamespaces(xml: string): string {
  const rootMatch = xml.match(/<tt\b[^>]*>/);
  if (!rootMatch) return xml;
  const rootTag = rootMatch[0];

  const declared = new Set<string>(["xml", "xmlns"]);
  for (const m of rootTag.matchAll(/xmlns:([A-Za-z][\w.-]*)\s*=/g)) declared.add(m[1]);

  const used = new Set<string>();
  for (const m of xml.matchAll(/<\/?([A-Za-z][\w.-]*):/g)) used.add(m[1]);
  for (const m of xml.matchAll(/\s([A-Za-z][\w.-]*):[\w.-]+\s*=/g)) used.add(m[1]);

  const missing = [...used].filter((p) => !declared.has(p));
  if (missing.length === 0) return xml;

  const additions = missing
    .map((p) => ` xmlns:${p}="urn:better-lyrics:unbound:${p}"`)
    .join("");
  return xml.replace(rootTag, rootTag.replace(/>$/, `${additions}>`));
}

/** TTM namespace URIs (standard + injected fallback from fixMissingNamespaces) */
const TTM_NS = [
  "http://www.w3.org/ns/ttml#metadata",
  "urn:better-lyrics:unbound:ttm",
];

function getNsAttr(el: Element, localName: string): string | null {
  for (const ns of TTM_NS) {
    const v = el.getAttributeNS(ns, localName);
    if (v) return v;
  }
  // Fallback: some exporters write un-namespaced or prefixed attributes
  return el.getAttribute(`ttm:${localName}`) ?? el.getAttribute(localName);
}

/**
 * Build a map from raw TTML agent IDs to normalized voice IDs.
 * - ttm:type="person" | "character" → "v1", "v2", ... (incremental)
 * - ttm:type="other"                → "v1000" (group/chorus/unison)
 * If no metadata agents are found, returns an empty map (raw IDs used as-is).
 */
function buildAgentMapping(doc: Document): Map<string, string> {
  const mapping = new Map<string, string>();
  const agentEls = Array.from(doc.getElementsByTagNameNS("*", "agent"));
  let voiceIndex = 0;
  for (const el of agentEls) {
    const id = el.getAttributeNS("http://www.w3.org/XML/1998/namespace", "id")
      ?? el.getAttribute("xml:id")
      ?? el.getAttribute("id");
    const type = getNsAttr(el, "type") ?? el.getAttribute("type");
    if (!id) continue;
    if (type === "person" || type === "character") {
      voiceIndex++;
      mapping.set(id, `v${voiceIndex}`);
    } else {
      mapping.set(id, "v1000");
    }
  }
  return mapping;
}

/**
 * Check if a span element is a background vocal wrapper (ttm:role="x-bg").
 */
function isBgSpan(span: Element): boolean {
  const role = getNsAttr(span, "role");
  return role === "x-bg";
}

export function parseTtml(input: string): LrcLine[] {
  // Handle double-encoded JSON: { ttml: "..." }
  let xml = input;
  try {
    const parsed = JSON.parse(input);
    if (parsed?.ttml) xml = parsed.ttml;
  } catch {
    /* not JSON, use as-is */
  }

  xml = fixMissingNamespaces(xml);
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) return [];

  // Build agent ID → normalized voice ID mapping from <ttm:agent> metadata
  const agentMapping = buildAgentMapping(doc);

  function normalizeAgent(rawId: string | null): string | undefined {
    if (!rawId) return undefined;
    return agentMapping.size > 0 ? (agentMapping.get(rawId) ?? rawId) : rawId;
  }

  const lines: LrcLine[] = [];
  const paragraphs = Array.from(doc.getElementsByTagNameNS("*", "p"));

  for (const p of paragraphs) {
    const beginAttr = p.getAttribute("begin");
    if (!beginAttr) continue;

    const lineStartMs = parseTtmlTimeMs(beginAttr);
    const rawAgent = getNsAttr(p, "agent");
    const agent = normalizeAgent(rawAgent);

    // Separate foreground and background spans.
    // Background vocal spans are wrapped in <span ttm:role="x-bg">...</span>.
    const directSpans = Array.from(p.childNodes)
      .filter((n): n is Element => n.nodeType === 1 && (n as Element).localName === "span");

    const fgWordSpans: Element[] = [];
    const bgWordSpans: Element[] = [];

    for (const child of directSpans) {
      if (isBgSpan(child)) {
        // Background wrapper: collect its timed inner spans
        const inner = Array.from(child.getElementsByTagNameNS("*", "span"))
          .filter((s) => s.getAttribute("begin") !== null);
        bgWordSpans.push(...inner);
      } else if (child.getAttribute("begin") !== null) {
        fgWordSpans.push(child);
      }
    }

    // If the paragraph has no direct timed children, fall back to all timed descendants
    const allTimed = Array.from(p.getElementsByTagNameNS("*", "span"))
      .filter((s) => s.getAttribute("begin") !== null);
    const fgSpans = fgWordSpans.length > 0 ? fgWordSpans : (bgWordSpans.length === 0 ? allTimed : []);

    function buildLine(spans: Element[], fallbackText?: string): { text: string; words?: LyricWord[] } {
      const words: LyricWord[] = [];
      let text = "";
      if (spans.length > 0) {
        for (const span of spans) {
          const t = (span.textContent ?? "").trim();
          if (!t) continue;
          const startMs = parseTtmlTimeMs(span.getAttribute("begin")!);
          const endAttr = span.getAttribute("end");
          const endMs = endAttr ? parseTtmlTimeMs(endAttr) : startMs + 500;
          words.push({ text: t, startMs, durationMs: Math.max(endMs - startMs, 50) });
          text += (text ? " " : "") + t;
        }
      } else if (fallbackText) {
        text = fallbackText;
      }
      return { text, words: words.length > 0 ? words : undefined };
    }

    // Foreground line
    const { text: fgText, words: fgWords } = buildLine(fgSpans, (p.textContent ?? "").trim());
    if (fgText) {
      lines.push({
        time: lineStartMs / 1000,
        text: fgText,
        words: fgWords,
        agent,
        isBackground: false,
      });
    }

    // Background vocal line (same timestamp, isBackground: true)
    if (bgWordSpans.length > 0) {
      const { text: bgText, words: bgWords } = buildLine(bgWordSpans);
      if (bgText) {
        lines.push({
          time: lineStartMs / 1000,
          text: bgText,
          words: bgWords,
          agent,
          isBackground: true,
        });
      }
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}