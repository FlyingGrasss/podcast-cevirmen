import type { Segment } from "../types.ts";
import { normalizeNewlines } from "./shared.ts";

const WORDS_PER_SECOND = 2.5;
const MIN_CUE_MS = 2000;
const GAP_MS = 300;

/**
 * Plain text has no timing data. Each paragraph becomes one cue and receives
 * deterministic estimated timings so it can be emitted as SRT/VTT/JSON.
 */
export function parseTxt(input: string): Segment[] {
  const normalized = normalizeNewlines(input);
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);

  let cursor = 0;
  return paragraphs.map((text) => {
    const words = text.split(" ").filter(Boolean).length;
    const duration = Math.max(MIN_CUE_MS, Math.round((words / WORDS_PER_SECOND) * 1000));
    const segment: Segment = { start: cursor, end: cursor + duration, text };
    cursor = segment.end + GAP_MS;
    return segment;
  });
}

export function emitTxt(segments: Segment[]): string {
  const paragraphs = segments.map((segment) => segment.text.trim()).filter(Boolean);
  if (paragraphs.length === 0) {
    return "";
  }
  return `${paragraphs.join("\n\n")}\n`;
}
