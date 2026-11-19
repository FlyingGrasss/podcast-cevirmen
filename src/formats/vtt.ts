import { formatVttTimestamp, parseVttTimestamp } from "../time.ts";
import type { Segment } from "../types.ts";
import { assertValidTiming, normalizeNewlines, parseCueText } from "./shared.ts";

const NON_CUE_BLOCK = /^(?:NOTE|STYLE|REGION)(?:\s|$)|^X-TIMESTAMP-MAP:/;

function parseTimingLine(line: string, blockNumber: number): { start: number; end: number } {
  const arrowIndex = line.indexOf("-->");
  if (arrowIndex === -1) {
    throw new Error(`WebVTT block ${blockNumber}: expected a "-->" timing line.`);
  }

  const startToken = line.slice(0, arrowIndex).trim();
  const afterArrow = line.slice(arrowIndex + 3).trim();
  const endToken = afterArrow.split(/\s+/)[0] ?? "";

  if (!startToken || !endToken) {
    throw new Error(`WebVTT block ${blockNumber}: incomplete timing line.`);
  }

  const start = parseVttTimestamp(startToken);
  const end = parseVttTimestamp(endToken);
  assertValidTiming(start, end, `WebVTT block ${blockNumber}`);
  return { start, end };
}

export function parseVtt(input: string): Segment[] {
  const normalized = normalizeNewlines(input).trimEnd();
  if (!normalized) {
    throw new Error("WebVTT input is empty.");
  }

  const lines = normalized.split("\n");
  const header = lines.shift() ?? "";
  if (!/^WEBVTT(?:[ \t].*)?$/.test(header.trim())) {
    throw new Error('WebVTT input must start with a "WEBVTT" header.');
  }

  let bodyStart = 0;
  while (bodyStart < lines.length && lines[bodyStart].trim() !== "") {
    bodyStart += 1;
  }
  const body = lines.slice(bodyStart + 1).join("\n");

  if (!body.trim()) {
    return [];
  }

  const blocks = body.trim().split(/\n{2,}/);
  const segments: Segment[] = [];

  blocks.forEach((rawBlock, blockIndex) => {
    const blockNumber = blockIndex + 1;
    const blockLines = rawBlock.split("\n");
    const firstLine = blockLines[0]?.trim() ?? "";

    if (!firstLine || NON_CUE_BLOCK.test(firstLine)) {
      return;
    }

    let id: string | undefined;
    let timingLine = blockLines[0] ?? "";
    let textStart = 1;

    if (!timingLine.includes("-->")) {
      if (blockLines.length < 2 || !(blockLines[1] ?? "").includes("-->")) {
        throw new Error(`WebVTT block ${blockNumber}: missing cue timing.`);
      }
      id = firstLine;
      timingLine = blockLines[1] ?? "";
      textStart = 2;
    }

    const { start, end } = parseTimingLine(timingLine, blockNumber);
    const text = parseCueText(blockLines.slice(textStart));
    const segment: Segment = { start, end, text };
    if (id !== undefined) {
      segment.id = id;
    }
    segments.push(segment);
  });

  return segments;
}

export function emitVtt(segments: Segment[]): string {
  if (segments.length === 0) {
    return "WEBVTT\n";
  }

  const cues = segments.map((segment) => {
    const header = segment.id === undefined ? "" : `${segment.id}\n`;
    return `${header}${formatVttTimestamp(segment.start)} --> ${formatVttTimestamp(segment.end)}\n${segment.text}`;
  });

  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}
