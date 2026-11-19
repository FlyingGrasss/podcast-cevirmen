export function normalizeNewlines(input: string): string {
  return input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function assertValidTiming(start: number, end: number, context: string): void {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error(`${context}: timestamps must be finite numbers.`);
  }
  if (start < 0 || end < 0) {
    throw new Error(`${context}: timestamps cannot be negative.`);
  }
  if (end < start) {
    throw new Error(`${context}: end time is before start time.`);
  }
}

export function parseCueText(lines: string[]): string {
  return lines.join("\n").replace(/[ \t]+$/gm, "").trim();
}
