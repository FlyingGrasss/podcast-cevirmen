const SRT_TIMESTAMP = /^(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/;
const VTT_TIMESTAMP = /^(?:(\d{1,3}):)?([0-5]\d):([0-5]\d)\.(\d{1,3})$/;

function fractionalToMs(fraction: string): number {
  return Number(fraction.padEnd(3, "0"));
}

function toMilliseconds(hours: number, minutes: number, seconds: number, millis: number): number {
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || !Number.isInteger(seconds)) {
    throw new Error("Timestamp components must be whole numbers.");
  }
  if (minutes > 59 || seconds > 59) {
    throw new Error("Timestamp minutes and seconds must be below 60.");
  }
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

export function parseSrtTimestamp(value: string): number {
  const match = SRT_TIMESTAMP.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid SRT timestamp "${value}". Expected HH:MM:SS,mmm.`);
  }
  return toMilliseconds(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    fractionalToMs(match[4]),
  );
}

export function parseVttTimestamp(value: string): number {
  const match = VTT_TIMESTAMP.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid WebVTT timestamp "${value}". Expected MM:SS.mmm or HH:MM:SS.mmm.`);
  }
  return toMilliseconds(
    match[1] === undefined ? 0 : Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    fractionalToMs(match[4]),
  );
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function timestampParts(milliseconds: number): {
  hours: number;
  minutes: number;
  seconds: number;
  millis: number;
} {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new Error(`Invalid duration: ${milliseconds}.`);
  }
  const total = Math.round(milliseconds);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return { hours, minutes, seconds, millis };
}

export function formatSrtTimestamp(milliseconds: number): string {
  const { hours, minutes, seconds, millis } = timestampParts(milliseconds);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

export function formatVttTimestamp(milliseconds: number): string {
  const { hours, minutes, seconds, millis } = timestampParts(milliseconds);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

/** JSON files use seconds; milliseconds are the internal precision. */
export function secondsToMilliseconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`Invalid start/end value: ${seconds}. Use non-negative seconds.`);
  }
  return Math.round(seconds * 1000);
}

export function millisecondsToSeconds(milliseconds: number): number {
  return Number((milliseconds / 1000).toFixed(3));
}
