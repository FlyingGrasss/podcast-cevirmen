import { formatSrtTimestamp, parseSrtTimestamp } from "../time.ts";
import type { Segment } from "../types.ts";
import { assertValidTiming, normalizeNewlines, parseCueText } from "./shared.ts";

function parseTimingLine(line: string, blockNumber: number): { start: number; end: number } {
  const arrowIndex = line.indexOf("-->");
  if (arrowIndex === -1) {
    throw new Error(`SRT block ${blockNumber}: expected a "-->" timing line.`);
  }

  const startToken = line.slice(0, arrowIndex).trim();
  const afterArrow = line.slice(arrowIndex + 3).trim();
  const endToken = afterArrow.split(/\s+/)[0] ?? "";

  if (!startToken || !endToken) {
    throw new Error(`SRT block ${blockNumber}: incomplete timing line.`);
  }

  const start = parseSrtTimestamp(startToken);
  const end = parseSrtTimestamp(endToken);
  assertValidTiming(start, end, `SRT block ${blockNumber}`);
  return { start, end };
}

export function parseSrt(input: string): Segment[] {
  const normalized = normalizeNewlines(input).trim();
  if (!normalized) {
    return [];
  }

  const blocks = normalized.split(/\n{2,}/);
  const segments: Segment[] = [];

  blocks.forEach((rawBlock, blockIndex) => {
    const blockNumber = blockIndex + 1;
    const lines = rawBlock.split("\n");
    while (lines.length > 0 && lines[0].trim() === "") {
      lines.shift();
    }
    if (lines.length === 0) {
      return;
    }

    if (/^\d+$/.test(lines[0].trim())) {
      lines.shift();
    }

    const timingLine = lines.shift();
    if (timingLine === undefined) {
      throw new Error(`SRT block ${blockNumber}: missing timing line.`);
    }

    const { start, end } = parseTimingLine(timingLine, blockNumber);
    const text = parseCueText(lines);
    segments.push({ start, end, text });
  });

  return segments;
}

export function emitSrt(segments: Segment[]): string {
  if (segments.length === 0) {
    return "";
  }

  const blocks = segments.map((segment, index) => {
    const start = formatSrtTimestamp(segment.start);
    const end = formatSrtTimestamp(segment.end);
    return `${index + 1}\n${start} --> ${end}\n${segment.text}`;
  });

  return `${blocks.join("\n\n")}\n`;
}
