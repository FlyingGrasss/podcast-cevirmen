import test from "node:test";
import assert from "node:assert/strict";
import { emitJson, parseJson } from "../src/formats/json.ts";
import { emitSrt, parseSrt } from "../src/formats/srt.ts";
import { emitTxt, parseTxt } from "../src/formats/txt.ts";
import { emitVtt, parseVtt } from "../src/formats/vtt.ts";

test("SRT parser/emitter round-trips text and millisecond timings", () => {
  const input = [
    "1",
    "00:00:01,250 --> 00:00:03,500",
    "Welcome back to the show.",
    "",
    "2",
    "00:00:04,000 --> 00:00:07,125",
    "This is a second",
    "line cue.",
    "",
  ].join("\n");

  const first = parseSrt(input);
  assert.deepEqual(first, [
    { start: 1250, end: 3500, text: "Welcome back to the show." },
    { start: 4000, end: 7125, text: "This is a second\nline cue." },
  ]);
  assert.equal(emitSrt(first), input);
  assert.deepEqual(parseSrt(emitSrt(first)), first);
});

test("SRT parser rejects end times before start times", () => {
  assert.throws(
    () => parseSrt("1\n00:00:05,000 --> 00:00:04,000\nNo\n"),
    /end time is before start time/,
  );
});

test("WebVTT parser/emitter round-trips cue ids and timings", () => {
  const input = [
    "WEBVTT",
    "",
    "intro",
    "00:00:01.250 --> 00:00:03.500 align:start position:10%",
    "Welcome.",
    "",
    "00:04.000 --> 00:06.000",
    "Second cue",
    "with two lines.",
    "",
  ].join("\n");

  const first = parseVtt(input);
  assert.deepEqual(first, [
    { start: 1250, end: 3500, text: "Welcome.", id: "intro" },
    { start: 4000, end: 6000, text: "Second cue\nwith two lines." },
  ]);

  const emitted = emitVtt(first);
  assert.deepEqual(parseVtt(emitted), first);
  assert.match(emitted, /^WEBVTT\n\nintro\n00:00:01\.250 --> 00:00:03\.500\n/);
});

test("WebVTT parser requires a header and skips NOTE blocks", () => {
  assert.throws(() => parseVtt("00:00:01.000 --> 00:00:02.000\nHello\n"), /WEBVTT/);

  const parsed = parseVtt(
    ["WEBVTT", "", "NOTE a comment", "", "00:00:01.000 --> 00:00:02.000", "Hello", ""].join("\n"),
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.text, "Hello");
});

test("JSON parser/emitter round-trips second-based timings", () => {
  const input = JSON.stringify(
    {
      segments: [
        { start: 1.25, end: 3.5, text: "Hello" },
        { start: 4, end: 6.125, text: "World" },
      ],
    },
    null,
    2,
  );

  const first = parseJson(`\uFEFF${input}`);
  assert.deepEqual(first, [
    { start: 1250, end: 3500, text: "Hello" },
    { start: 4000, end: 6125, text: "World" },
  ]);
  assert.deepEqual(parseJson(emitJson(first)), first);
});

test("JSON parser rejects invalid segment shapes", () => {
  assert.throws(() => parseJson('{"segments":[{"start":5,"end":4,"text":"x"}]}'), /end time/);
  assert.throws(() => parseJson('{"segments":[{"start":1,"end":2}]}'), /text field/);
});

test("TXT parser turns paragraphs into timed cues and round-trips text", () => {
  const input = "First paragraph here.\n\nSecond paragraph has more words.";
  const segments = parseTxt(input);

  assert.equal(segments.length, 2);
  assert.equal(segments[0]?.start, 0);
  assert.ok((segments[0]?.end ?? 0) > 0);
  assert.ok((segments[1]?.start ?? 0) > (segments[0]?.end ?? 0));
  assert.equal(segments[0]?.text, "First paragraph here.");
  assert.equal(segments[1]?.text, "Second paragraph has more words.");
  assert.equal(emitTxt(segments), `${input}\n`);
});
