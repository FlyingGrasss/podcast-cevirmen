import type { Glossary } from "../glossary.ts";
import type { Segment } from "../types.ts";
import {
  translateOpenAI,
  type OpenAIConfig,
  type TranslateOpenAIOptions,
} from "./openai.ts";

export type TranslateProvider = "openai" | "demo";

export interface TranslateOptions extends TranslateOpenAIOptions {
  provider: TranslateProvider;
  api?: OpenAIConfig;
  glossary?: Glossary;
  /** Why demo mode was chosen, e.g. "missing OPENAI_API_KEY". */
  demoReason?: string;
}

export interface TranslationResult {
  segments: Segment[];
  warnings: string[];
}

export function demoTranslate(segments: readonly Segment[]): Segment[] {
  return segments.map((segment) => {
    const result: Segment = {
      start: segment.start,
      end: segment.end,
      text: `[DEMO] ${segment.text}`,
    };
    if (segment.id !== undefined) {
      result.id = segment.id;
    }
    return result;
  });
}

export async function translateSegments(
  segments: readonly Segment[],
  options: TranslateOptions,
): Promise<TranslationResult> {
  if (options.provider === "demo") {
    const reason = options.demoReason?.trim() || "no translation provider is configured";
    const sentence = reason.endsWith(".") ? reason : `${reason}.`;
    return {
      segments: demoTranslate(segments),
      warnings: [
        `Demo mode: ${sentence} Every segment keeps its source text prefixed with "[DEMO]".`,
      ],
    };
  }

  if (!options.api) {
    throw new Error("OpenAI provider selected without OPENAI_BASE_URL, OPENAI_API_KEY and OPENAI_MODEL.");
  }

  return {
    segments: await translateOpenAI(segments, options.api, options.glossary, options),
    warnings: [],
  };
}
