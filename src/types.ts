/**
 * A single subtitle cue. Timings are integer milliseconds so that parsing and
 * emitting never introduce floating-point drift.
 */
export interface Segment {
  start: number;
  end: number;
  text: string;
  /** Optional WebVTT cue identifier. SRT indices are regenerated on output. */
  id?: string;
}

export type Format = "srt" | "vtt" | "txt" | "json";

export type ProviderChoice = "auto" | "openai" | "demo";
