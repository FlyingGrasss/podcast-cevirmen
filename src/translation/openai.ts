import { setTimeout as sleep } from "node:timers/promises";
import { buildGlossaryInstructions, type Glossary } from "../glossary.ts";
import type { Segment } from "../types.ts";

export const BATCH_SIZE = 20;
export const CONTEXT_SIZE = 3;
export const MAX_RETRIES = 3;
export const TEMPERATURE = 0.2;
export const REQUEST_TIMEOUT_MS = 120_000;

export const BASE_SYSTEM_PROMPT =
  "Sen profesyonel bir podcast altyazı çevirmenisin. İngilizce transcript segmentlerini Türkçeye çevir. " +
  "Kurallar: doğal Türkçe, konuşma dili, altyazı uzunluğuna uygun; anlamı ve konuşmacı tonunu koru, " +
  "ekleme veya açıklama yapma; her cue en fazla iki satır ve satır başına yaklaşık 42 karakter olsun. " +
  'Yanıtı YALNIZCA JSON dizisi olarak ver; her nesne aynı id ile {"id": sayı, "text": "Türkçe metin"} ' +
  "biçiminde olsun.";

export interface OpenAIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface OpenAIConfigResolution {
  config?: OpenAIConfig;
  missing: string[];
}

export function resolveOpenAIConfig(
  env: Record<string, string | undefined>,
): OpenAIConfigResolution {
  const baseUrl = env.OPENAI_BASE_URL?.trim();
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_MODEL?.trim();

  const missing: string[] = [];
  if (!baseUrl) missing.push("OPENAI_BASE_URL");
  if (!apiKey) missing.push("OPENAI_API_KEY");
  if (!model) missing.push("OPENAI_MODEL");

  if (!baseUrl || !apiKey || !model) {
    return { missing };
  }
  return { config: { baseUrl, apiKey, model }, missing };
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

export function buildSystemPrompt(glossary: Glossary | undefined): string {
  const instructions = buildGlossaryInstructions(glossary);
  return instructions ? `${BASE_SYSTEM_PROMPT}\n\n${instructions}` : BASE_SYSTEM_PROMPT;
}

function buildUserPrompt(
  batch: readonly Segment[],
  offset: number,
  context: readonly Segment[],
): string {
  const contextPayload = context.map((segment, index) => ({
    id: offset - context.length + index,
    text: segment.text,
  }));
  const segmentPayload = batch.map((segment, index) => ({
    id: offset + index,
    text: segment.text,
  }));

  const parts: string[] = [];
  if (contextPayload.length > 0) {
    parts.push(
      `Önceki çevrilmiş segmentler (bağlam; bunları yeniden çevirme):\n${JSON.stringify(contextPayload)}`,
    );
  }
  parts.push(`Çevrilecek segmentler:\n${JSON.stringify(segmentPayload)}`);
  parts.push("Yalnızca çevrilecek segmentler için aynı id'leri içeren JSON dizisini döndür.");
  return parts.join("\n\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMessageContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new Error("OpenAI response did not contain any choices.");
  }

  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new Error("OpenAI response did not contain a message.");
  }

  const content = firstChoice.message.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (isRecord(part) && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
    if (joined.trim()) {
      return joined;
    }
  }

  throw new Error("OpenAI response did not contain message text.");
}

function parseJsonPayload(content: string): unknown {
  const trimmed = content.trim();
  const candidates: string[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }
  candidates.push(trimmed);

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  const pairs = [
    ["[", "]"],
    ["{", "}"],
  ] as const;
  for (const [open, close] of pairs) {
    const start = trimmed.indexOf(open);
    const end = trimmed.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // Try the next bracket pair.
      }
    }
  }

  throw new Error("OpenAI response was not valid JSON.");
}

function translationItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (isRecord(payload)) {
    for (const key of ["segments", "translations", "results"]) {
      if (Array.isArray(payload[key])) {
        return payload[key];
      }
    }
  }
  throw new Error('Expected a JSON array like [{"id":0,"text":"..."}].');
}

export function parseTranslationContent(content: string, expectedIds: readonly number[]): string[] {
  const items = translationItems(parseJsonPayload(content));
  const byId = new Map<string, string>();
  let allItemsHaveIds = true;

  for (const item of items) {
    if (!isRecord(item) || typeof item.text !== "string") {
      allItemsHaveIds = false;
      continue;
    }
    if (item.id === undefined || item.id === null) {
      allItemsHaveIds = false;
      continue;
    }
    byId.set(String(item.id), item.text);
  }

  if (allItemsHaveIds && expectedIds.every((id) => byId.has(String(id)))) {
    return expectedIds.map((id) => byId.get(String(id)) ?? "");
  }

  if (items.length === expectedIds.length) {
    const texts = items.map((item) =>
      isRecord(item) && typeof item.text === "string" ? item.text : undefined,
    );
    if (texts.every((text): text is string => typeof text === "string")) {
      return texts;
    }
  }

  throw new Error(
    `OpenAI returned ${items.length} translation(s) for ${expectedIds.length} input segment(s).`,
  );
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(Math.round(seconds * 1000), 30_000);
    }
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) {
      return Math.max(0, Math.min(date - Date.now(), 30_000));
    }
  }
  return Math.min(500 * 2 ** attempt, 10_000);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface TranslateOpenAIOptions {
  fetchImpl?: typeof fetch;
  onRetry?: (message: string) => void;
  maxRetries?: number;
}

async function requestBatch(
  batch: readonly Segment[],
  offset: number,
  context: readonly Segment[],
  config: OpenAIConfig,
  glossary: Glossary | undefined,
  options: TranslateOpenAIOptions,
): Promise<string[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const url = chatCompletionsUrl(config.baseUrl);
  const expectedIds = batch.map((_, index) => offset + index);
  const body = JSON.stringify({
    model: config.model,
    temperature: TEMPERATURE,
    stream: false,
    messages: [
      { role: "system", content: buildSystemPrompt(glossary) },
      { role: "user", content: buildUserPrompt(batch, offset, context) },
    ],
  });

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt >= maxRetries) {
        throw new Error(`OpenAI request failed: ${errorMessage(error)}`, { cause: error });
      }
      const wait = Math.min(500 * 2 ** attempt, 10_000);
      options.onRetry?.(`Network error; retrying in ${wait} ms (retry ${attempt + 1}/${maxRetries}).`);
      await sleep(wait);
      continue;
    }

    if (response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new Error(`OpenAI returned a non-JSON response: ${errorMessage(error)}`);
      }
      const content = readMessageContent(payload);
      return parseTranslationContent(content, expectedIds);
    }

    if (!isRetryableStatus(response.status) || attempt >= maxRetries) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      throw new Error(
        `OpenAI request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    const wait = retryDelayMs(response, attempt);
    await response.text().catch(() => "");
    options.onRetry?.(
      `HTTP ${response.status}; retrying in ${wait} ms (retry ${attempt + 1}/${maxRetries}).`,
    );
    await sleep(wait);
  }

  throw new Error("OpenAI request failed.");
}

export async function translateOpenAI(
  segments: readonly Segment[],
  config: OpenAIConfig,
  glossary?: Glossary,
  options: TranslateOpenAIOptions = {},
): Promise<Segment[]> {
  const translated: Segment[] = [];

  for (let offset = 0; offset < segments.length; offset += BATCH_SIZE) {
    const batch = segments.slice(offset, offset + BATCH_SIZE);
    const context = translated.slice(-CONTEXT_SIZE);
    const texts = await requestBatch(batch, offset, context, config, glossary, options);

    batch.forEach((segment, index) => {
      const result: Segment = {
        start: segment.start,
        end: segment.end,
        text: texts[index] ?? "",
      };
      if (segment.id !== undefined) {
        result.id = segment.id;
      }
      translated.push(result);
    });
  }

  return translated;
}
