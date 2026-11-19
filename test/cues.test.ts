import test from "node:test";
import assert from "node:assert/strict";
import { checkCueLengths, splitLongCue, splitLongCues } from "../src/cues.ts";
import type { Segment } from "../src/types.ts";

test("length check reports long lines and too many lines", () => {
  const warnings = checkCueLengths([
    { start: 0, end: 1000, text: "x".repeat(43) },
    { start: 1000, end: 2000, text: "one\ntwo\nthree" },
  ]);

  assert.equal(warnings.length, 2);
  assert.match(warnings[0] ?? "", /Cue 1, line 1: 43 characters/);
  assert.match(warnings[1] ?? "", /Cue 2: has 3 lines/);
});

test("split-long splits at sentence boundaries and keeps original start/end", () => {
  const text =
    "This first sentence has enough words to wrap onto two lines. " +
    "Another sentence here also has enough words to wrap neatly. " +
    "Final short sentence.";
  const segment: Segment = { start: 1250, end: 9125, text };

  const split = splitLongCues([segment]);

  assert.ok(split.length > 1, "expected the long cue to be split");
  for (const cue of split) {
    assert.equal(cue.start, segment.start);
    assert.equal(cue.end, segment.end);
  }
  assert.equal(
    split
      .map((cue) => cue.text.replace(/\n/g, " "))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
    text,
  );
  assert.deepEqual(checkCueLengths(split), []);
});

test("split-long leaves cues that already fit untouched", () => {
  const segment: Segment = { start: 0, end: 1000, text: "Short cue." };
  const result = splitLongCue(segment);

  assert.equal(result.length, 1);
  assert.equal(result[0], segment);
});

test("split-long reflows a long single line into two lines", () => {
  const text = "Short words make this long line wrap cleanly into two lines.";
  const [cue] = splitLongCue({ start: 0, end: 5000, text });

  assert.ok(cue);
  assert.equal(cue.start, 0);
  assert.equal(cue.end, 5000);
  assert.ok(cue.text.split("\n").length <= 2);
  assert.ok(cue.text.split("\n").every((line) => Array.from(line).length <= 42));
});
