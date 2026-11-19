import { millisecondsToSeconds, secondsToMilliseconds } from "../time.ts";
import type { Segment } from "../types.ts";
import { assertValidTiming } from "./shared.ts";

interface JsonSegment {
  start: number;
  end: number;
  text: string;
}

interface JsonDocument {
  segments: JsonSegment[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJson(input: string): Segment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.replace(/^\uFEFF/, ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON: ${message}`);
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.segments)) {
    throw new Error('JSON input must be an object with a "segments" array.');
  }

  return parsed.segments.map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`JSON segment ${index + 1} must be an object.`);
    }
    if (typeof value.start !== "number" || typeof value.end !== "number") {
      throw new Error(`JSON segment ${index + 1} must have numeric start and end seconds.`);
    }
    if (typeof value.text !== "string") {
      throw new Error(`JSON segment ${index + 1} must have a string text field.`);
    }

    const start = secondsToMilliseconds(value.start);
    const end = secondsToMilliseconds(value.end);
    assertValidTiming(start, end, `JSON segment ${index + 1}`);
    return { start, end, text: value.text };
  });
}

export function emitJson(segments: Segment[]): string {
  const document: JsonDocument = {
    segments: segments.map((segment) => ({
      start: millisecondsToSeconds(segment.start),
      end: millisecondsToSeconds(segment.end),
      text: segment.text,
    })),
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}
