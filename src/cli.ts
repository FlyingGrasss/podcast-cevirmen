#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { checkCueLengths, splitLongCues } from "./cues.ts";
import { detectFormat, emitTranscript, parseTranscript } from "./formats/index.ts";
import { checkGlossary, parseGlossary, type Glossary } from "./glossary.ts";
import {
  resolveOpenAIConfig,
  type OpenAIConfig,
} from "./translation/openai.ts";
import { translateSegments, type TranslateProvider } from "./translation/index.ts";
import type { ProviderChoice, Segment } from "./types.ts";

const HELP = `Podcast Çevirmen — English podcast transcript to Turkish

Usage:
  pnpm translate --input <file> --output <file> [options]

Options:
  --input <path>       Input file: .srt, .vtt, .txt or .json
  --output <path>      Output file: .srt, .vtt, .txt or .json
  --target <lang>      Target language; only "tr" is supported (default: tr)
  --provider <name>    auto | openai | demo (default: auto)
  --glossary <path>    JSON object: { "source term": "Türkçe karşılık" }
  --split-long         Split long cues at sentence boundaries
  --whisper            Not implemented; see README for the manual whisper step
  -h, --help           Show this help

Environment (OpenAI-compatible endpoint):
  OPENAI_BASE_URL      e.g. https://api.openai.com/v1
  OPENAI_API_KEY
  OPENAI_MODEL

If any of the three variables is missing, demo mode is used automatically.
Demo mode preserves timings and prefixes every segment with "[DEMO] ".
`;

interface CliOptions {
  input: string;
  output: string;
  target: "tr";
  provider: ProviderChoice;
  glossary?: string;
  splitLong: boolean;
}

type ParsedArgs = { help: true } | ({ help: false } & CliOptions);

const VALUE_OPTIONS = new Set(["input", "output", "target", "provider", "glossary"]);
const PROVIDERS: readonly ProviderChoice[] = ["auto", "openai", "demo"];

function parseArgs(argv: readonly string[]): ParsedArgs {
  const values = new Map<string, string>();
  let splitLong = false;
  let whisper = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";

    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    if (argument === "--split-long") {
      splitLong = true;
      continue;
    }
    if (argument === "--whisper") {
      whisper = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument "${argument}".`);
    }

    const equals = argument.indexOf("=");
    const key = equals >= 0 ? argument.slice(2, equals) : argument.slice(2);
    let value: string;

    if (equals >= 0) {
      value = argument.slice(equals + 1);
    } else {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`Missing value for --${key}.`);
      }
      value = next;
      index += 1;
    }

    if (!VALUE_OPTIONS.has(key)) {
      throw new Error(`Unknown option --${key}. Run with --help for usage.`);
    }
    if (values.has(key)) {
      throw new Error(`Option --${key} was provided more than once.`);
    }
    values.set(key, value);
  }

  if (whisper) {
    throw new Error(
      "Audio transcription is not implemented. Create an SRT with whisper.cpp or the Whisper CLI first, then pass it with --input (see README).",
    );
  }

  const input = values.get("input");
  const output = values.get("output");
  if (!input) {
    throw new Error("Missing --input.");
  }
  if (!output) {
    throw new Error("Missing --output.");
  }

  const target = (values.get("target") ?? "tr").toLowerCase();
  if (target !== "tr") {
    throw new Error(`Unsupported --target "${target}". Only "tr" is supported.`);
  }

  const providerValue = (values.get("provider") ?? "auto").toLowerCase();
  if (!(PROVIDERS as readonly string[]).includes(providerValue)) {
    throw new Error(`Unsupported --provider "${providerValue}". Use auto, openai or demo.`);
  }

  const options: CliOptions = {
    input,
    output,
    target: "tr",
    provider: providerValue as ProviderChoice,
    splitLong,
  };
  const glossary = values.get("glossary");
  if (glossary) {
    options.glossary = glossary;
  }
  return { help: false, ...options };
}

function resolveProvider(
  choice: ProviderChoice,
  config: OpenAIConfig | undefined,
  missing: string[],
): { provider: TranslateProvider; demoReason?: string } {
  if (choice === "demo") {
    return { provider: "demo", demoReason: "--provider demo was selected" };
  }
  if (config) {
    return { provider: "openai" };
  }
  return {
    provider: "demo",
    demoReason: `missing ${missing.join(", ")}; set them to use an OpenAI-compatible endpoint`,
  };
}

async function loadGlossary(path: string): Promise<Glossary> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read glossary "${path}": ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid glossary JSON "${path}": ${message}`);
  }

  try {
    return parseGlossary(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid glossary "${path}": ${message}`);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function run(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(HELP);
    return;
  }

  const inputFormat = detectFormat(args.input);
  const outputFormat = detectFormat(args.output);

  let rawInput: string;
  try {
    rawInput = await readFile(args.input, "utf8");
  } catch (error) {
    throw new Error(`Could not read input "${args.input}": ${errorText(error)}`);
  }

  let source: Segment[];
  try {
    source = parseTranscript(rawInput, inputFormat);
  } catch (error) {
    throw new Error(`Could not parse ${inputFormat.toUpperCase()} input "${args.input}": ${errorText(error)}`);
  }

  const glossary = args.glossary ? await loadGlossary(args.glossary) : undefined;
  const resolution = resolveOpenAIConfig(process.env);
  const selected = resolveProvider(args.provider, resolution.config, resolution.missing);

  if (selected.provider === "openai") {
    console.log(`Provider: OpenAI-compatible endpoint (${resolution.config?.model ?? "unknown model"}).`);
  }

  const result = await translateSegments(source, {
    provider: selected.provider,
    api: resolution.config,
    glossary,
    demoReason: selected.demoReason,
    onRetry: (message) => console.warn(`[retry] ${message}`),
  });

  const translated = result.segments;
  const glossaryWarnings = glossary ? checkGlossary(source, translated, glossary) : [];
  const finalSegments = args.splitLong ? splitLongCues(translated) : translated;
  const lengthWarnings = checkCueLengths(finalSegments);

  const warnings = [...result.warnings, ...glossaryWarnings, ...lengthWarnings];
  for (const warning of warnings) {
    console.warn(`[warning] ${warning}`);
  }
  if (source.length === 0) {
    warnings.push("Input contains no cues.");
    console.warn("[warning] Input contains no cues.");
  }

  const outputPath = resolve(args.output);
  await mkdir(dirname(outputPath), { recursive: true });
  try {
    await writeFile(outputPath, emitTranscript(finalSegments, outputFormat), "utf8");
  } catch (error) {
    throw new Error(`Could not write output "${args.output}": ${errorText(error)}`);
  }

  const splitNote =
    args.splitLong && finalSegments.length !== translated.length
      ? ` Split into ${finalSegments.length} cues (original timings kept).`
      : "";
  console.log(
    `Translated ${source.length} cue(s) to Turkish in ${selected.provider === "demo" ? "demo mode" : "openai mode"}.${splitNote}`,
  );
  console.log(`Wrote ${outputPath} as ${outputFormat.toUpperCase()} (${warnings.length} warning(s)).`);
}

run(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`Error: ${errorText(error)}`);
  process.exitCode = 1;
});
