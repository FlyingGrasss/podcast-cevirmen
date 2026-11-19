import { extname } from "node:path";
import type { Format, Segment } from "../types.ts";
import { parseJson, emitJson } from "./json.ts";
import { parseSrt, emitSrt } from "./srt.ts";
import { parseTxt, emitTxt } from "./txt.ts";
import { parseVtt, emitVtt } from "./vtt.ts";

const FORMATS: readonly Format[] = ["srt", "vtt", "txt", "json"];

export function detectFormat(filePath: string): Format {
  const extension = extname(filePath).slice(1).toLowerCase();
  if ((FORMATS as readonly string[]).includes(extension)) {
    return extension as Format;
  }
  throw new Error(
    `Unsupported file extension "${extension || "(none)"}" for ${filePath}. Use .srt, .vtt, .txt or .json.`,
  );
}

export function parseTranscript(input: string, format: Format): Segment[] {
  switch (format) {
    case "srt":
      return parseSrt(input);
    case "vtt":
      return parseVtt(input);
    case "txt":
      return parseTxt(input);
    case "json":
      return parseJson(input);
  }
}

export function emitTranscript(segments: Segment[], format: Format): string {
  switch (format) {
    case "srt":
      return emitSrt(segments);
    case "vtt":
      return emitVtt(segments);
    case "txt":
      return emitTxt(segments);
    case "json":
      return emitJson(segments);
  }
}
