import type { Segment } from "./types.ts";

export const MAX_LINE_LENGTH = 42;
export const MAX_CUE_LINES = 2;

function lineLength(line: string): number {
  return Array.from(line).length;
}

export function cueExceedsLimits(
  text: string,
  maxLineLength = MAX_LINE_LENGTH,
  maxLines = MAX_CUE_LINES,
): boolean {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return lines.length > maxLines || lines.some((line) => lineLength(line) > maxLineLength);
}

export function checkCueLengths(
  segments: readonly Segment[],
  maxLineLength = MAX_LINE_LENGTH,
  maxLines = MAX_CUE_LINES,
): string[] {
  const warnings: string[] = [];

  segments.forEach((segment, cueIndex) => {
    const lines = segment.text.replace(/\r\n?/g, "\n").split("\n");
    if (lines.length > maxLines) {
      warnings.push(`Cue ${cueIndex + 1}: has ${lines.length} lines (limit ${maxLines}).`);
    }
    lines.forEach((line, lineIndex) => {
      const length = lineLength(line);
      if (length > maxLineLength) {
        warnings.push(
          `Cue ${cueIndex + 1}, line ${lineIndex + 1}: ${length} characters (limit ${maxLineLength}).`,
        );
      }
    });
  });

  return warnings;
}

export function wrapText(text: string, maxLineLength = MAX_LINE_LENGTH): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || lineLength(candidate) <= maxLineLength) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * Reflows text into at most two short lines and, when it still exceeds the
 * limit, splits it at sentence boundaries. Every resulting cue keeps the
 * original start/end unchanged; cue boundaries must never move.
 */
export function splitLongCue(
  segment: Segment,
  maxLineLength = MAX_LINE_LENGTH,
  maxLines = MAX_CUE_LINES,
): Segment[] {
  if (!cueExceedsLimits(segment.text, maxLineLength, maxLines)) {
    return [segment];
  }

  const sentences = splitSentences(segment.text);
  if (sentences.length === 0) {
    return [segment];
  }

  const groups: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    const candidateLines = wrapText(candidate, maxLineLength);
    if (!current || candidateLines.length <= maxLines) {
      current = candidate;
    } else {
      groups.push(current);
      current = sentence;
    }
  }
  if (current) {
    groups.push(current);
  }

  const split = groups.map((group, index) => {
    const cue: Segment = {
      start: segment.start,
      end: segment.end,
      text: wrapText(group, maxLineLength).join("\n"),
    };
    if (segment.id !== undefined) {
      cue.id = `${segment.id}-${index + 1}`;
    }
    return cue;
  });

  if (split.length === 1) {
    return [{ ...segment, text: split[0]?.text ?? segment.text }];
  }
  return split;
}

export function splitLongCues(
  segments: readonly Segment[],
  maxLineLength = MAX_LINE_LENGTH,
  maxLines = MAX_CUE_LINES,
): Segment[] {
  return segments.flatMap((segment) => splitLongCue(segment, maxLineLength, maxLines));
}
