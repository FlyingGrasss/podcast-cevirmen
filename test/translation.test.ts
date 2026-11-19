import test from "node:test";
import assert from "node:assert/strict";
import { checkGlossary, parseGlossary } from "../src/glossary.ts";
import { translateSegments } from "../src/translation/index.ts";
import {
  BASE_SYSTEM_PROMPT,
  buildSystemPrompt,
  isRetryableStatus,
  parseTranslationContent,
  resolveOpenAIConfig,
} from "../src/translation/openai.ts";

test("demo mode prefixes every segment and preserves timings", async () => {
  const source = [
    { start: 1000, end: 2500, text: "Hello listeners.", id: "intro" },
    { start: 3000, end: 5000, text: "" },
  ];

  const result = await translateSegments(source, {
    provider: "demo",
    demoReason: "OPENAI_API_KEY is missing",
  });

  assert.deepEqual(
    result.segments.map((segment) => segment.text),
    ["[DEMO] Hello listeners.", "[DEMO] "],
  );
  assert.deepEqual(
    result.segments.map(({ start, end }) => ({ start, end })),
    [
      { start: 1000, end: 2500 },
      { start: 3000, end: 5000 },
    ],
  );
  assert.equal(result.segments[0]?.id, "intro");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? "", /Demo mode/);
  assert.match(result.warnings[0] ?? "", /\[DEMO\]/);
});

test("glossary parser validates mappings", () => {
  const glossary = parseGlossary({
    "machine learning": "makine öğrenmesi",
    AI: "yapay zeka",
  });
  assert.deepEqual(glossary, {
    "machine learning": "makine öğrenmesi",
    AI: "yapay zeka",
  });
  assert.throws(() => parseGlossary({ term: 42 }), /non-empty string/);
  assert.throws(() => parseGlossary([]), /JSON object/);
});

test("glossary check warns only for untranslated terms", () => {
  const glossary = parseGlossary({
    "machine learning": "makine öğrenmesi",
    AI: "yapay zeka",
  });

  const warnings = checkGlossary(
    [{ text: "We use machine learning and AI." }],
    [{ text: "We use machine learning and yapay zeka." }],
    glossary,
  );

  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /Cue 1/);
  assert.match(warnings[0] ?? "", /machine learning/);
  assert.match(warnings[0] ?? "", /makine öğrenmesi/);

  assert.deepEqual(
    checkGlossary(
      [{ text: "We use machine learning and AI." }],
      [{ text: "Makine öğrenmesi ve yapay zeka kullanıyoruz." }],
      glossary,
    ),
    [],
  );
});

test("glossary check respects word boundaries", () => {
  const glossary = parseGlossary({ cat: "kedi" });
  assert.deepEqual(
    checkGlossary([{ text: "This category is broad." }], [{ text: "Bu category geniş." }], glossary),
    [],
  );
  assert.equal(
    checkGlossary([{ text: "The cat sleeps." }], [{ text: "The cat uyuyor." }], glossary).length,
    1,
  );
});

test("system prompt contains the required Turkish subtitle instruction and glossary", () => {
  assert.ok(
    BASE_SYSTEM_PROMPT.includes("doğal Türkçe, konuşma dili, altyazı uzunluğuna uygun"),
  );
  const prompt = buildSystemPrompt({ "machine learning": "makine öğrenmesi" });
  assert.match(prompt, /machine learning/);
  assert.match(prompt, /makine öğrenmesi/);
});

test("OpenAI config requires all three environment variables", () => {
  assert.deepEqual(resolveOpenAIConfig({}), {
    missing: ["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"],
  });

  const resolution = resolveOpenAIConfig({
    OPENAI_BASE_URL: " https://example.test/v1 ",
    OPENAI_API_KEY: " secret ",
    OPENAI_MODEL: " model ",
  });
  assert.deepEqual(resolution.missing, []);
  assert.deepEqual(resolution.config, {
    baseUrl: "https://example.test/v1",
    apiKey: "secret",
    model: "model",
  });
});

test("retry policy targets 429 and 5xx only", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(401), false);
});

test("translation content supports fenced JSON, ids and ordered fallback", () => {
  assert.deepEqual(
    parseTranslationContent(
      '```json\n[{"id":1,"text":"B"},{"id":0,"text":"A"}]\n```',
      [0, 1],
    ),
    ["A", "B"],
  );
  assert.deepEqual(
    parseTranslationContent('[{"text":"A"},{"text":"B"}]', [0, 1]),
    ["A", "B"],
  );
  assert.throws(
    () => parseTranslationContent('[{"id":0,"text":"A"}]', [0, 1]),
    /1 translation\(s\) for 2 input segment\(s\)/,
  );
});
