import test from "node:test";
import assert from "node:assert/strict";
import { translateOpenAI } from "../src/translation/openai.ts";
import type { Segment } from "../src/types.ts";

interface RequestCall {
  url: string;
  init?: RequestInit;
}

interface PromptSegment {
  id: number;
  text: string;
}

function promptSegments(content: string, marker: string): PromptSegment[] {
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Prompt marker not found: ${marker}`);
  }
  const line = content
    .slice(markerIndex + marker.length)
    .split("\n")
    .find((part) => part.trim().startsWith("["));
  if (!line) {
    throw new Error(`No JSON payload after prompt marker: ${marker}`);
  }
  return JSON.parse(line.trim()) as PromptSegment[];
}

test("OpenAI path batches 20 segments and sends the last 3 translations as context", async () => {
  const segments: Segment[] = Array.from({ length: 21 }, (_, index) => ({
    start: index * 1000,
    end: index * 1000 + 750,
    text: `Source ${index}`,
  }));

  const calls: RequestCall[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const body = JSON.parse(String(init?.body)) as {
      temperature: number;
      messages: Array<{ role: string; content: string }>;
    };
    const userContent = body.messages[1]?.content ?? "";
    const requestSegments = promptSegments(userContent, "Çevrilecek segmentler:\n");
    const content = JSON.stringify(
      requestSegments.map((segment) => ({ id: segment.id, text: `TR ${segment.id}` })),
    );
    return new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const translated = await translateOpenAI(
    segments,
    { baseUrl: "https://example.test/v1", apiKey: "test-key", model: "test-model" },
    { "Source": "Kaynak" },
    { fetchImpl: fakeFetch, maxRetries: 0 },
  );

  assert.equal(calls.length, 2);
  assert.equal(translated.length, 21);
  assert.deepEqual(
    translated.map((segment) => segment.text),
    Array.from({ length: 21 }, (_, index) => `TR ${index}`),
  );
  assert.deepEqual(
    translated.map(({ start, end }) => ({ start, end })),
    segments.map(({ start, end }) => ({ start, end })),
  );

  const firstBody = JSON.parse(String(calls[0]?.init?.body)) as {
    temperature: number;
    messages: Array<{ role: string; content: string }>;
  };
  const firstUser = firstBody.messages[1]?.content ?? "";
  const firstBatch = promptSegments(firstUser, "Çevrilecek segmentler:\n");

  assert.equal(firstBody.temperature, 0.2);
  assert.match(firstBody.messages[0]?.content ?? "", /doğal Türkçe, konuşma dili, altyazı uzunluğuna uygun/);
  assert.match(firstBody.messages[0]?.content ?? "", /Sözlük/);
  assert.match(firstBody.messages[0]?.content ?? "", /"Source" → "Kaynak"/);
  assert.equal(firstBatch.length, 20);
  assert.ok(!firstUser.includes("Önceki çevrilmiş segmentler"));

  const secondBody = JSON.parse(String(calls[1]?.init?.body)) as {
    messages: Array<{ role: string; content: string }>;
  };
  const secondUser = secondBody.messages[1]?.content ?? "";
  const context = promptSegments(
    secondUser,
    "Önceki çevrilmiş segmentler (bağlam; bunları yeniden çevirme):\n",
  );
  const secondBatch = promptSegments(secondUser, "Çevrilecek segmentler:\n");

  assert.deepEqual(
    context.map((segment) => segment.id),
    [17, 18, 19],
  );
  assert.deepEqual(
    context.map((segment) => segment.text),
    ["TR 17", "TR 18", "TR 19"],
  );
  assert.deepEqual(secondBatch, [{ id: 20, text: "Source 20" }]);

  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer test-key");
  assert.equal(headers["Content-Type"], "application/json");
});
