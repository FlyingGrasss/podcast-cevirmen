export type Glossary = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates a decoded glossary.json value. */
export function parseGlossary(value: unknown): Glossary {
  if (!isRecord(value)) {
    throw new Error('Glossary must be a JSON object mapping source terms to Turkish translations.');
  }

  const glossary: Glossary = {};
  for (const [rawTerm, rawTranslation] of Object.entries(value)) {
    const term = rawTerm.replace(/\s+/g, " ").trim();
    if (!term) {
      throw new Error("Glossary contains an empty term.");
    }
    if (typeof rawTranslation !== "string" || !rawTranslation.trim()) {
      throw new Error(`Glossary term "${term}" must map to a non-empty string.`);
    }
    glossary[term] = rawTranslation.trim();
  }
  return glossary;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termPattern(term: string): RegExp {
  const normalized = term.replace(/\s+/g, " ").trim();
  const pattern = normalized
    .split(" ")
    .map((part) => escapeRegExp(part))
    .join("\\s+");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${pattern}(?=$|[^\\p{L}\\p{N}])`, "iu");
}

function containsTerm(text: string, term: string): boolean {
  return termPattern(term).test(text.replace(/\s+/g, " "));
}

/** Instructions appended to the translation system prompt. */
export function buildGlossaryInstructions(glossary: Glossary | undefined): string {
  const entries = Object.entries(glossary ?? {});
  if (entries.length === 0) {
    return "";
  }

  const mapping = entries.map(([term, translation]) => `"${term}" → "${translation}"`).join("; ");
  return `Sözlük (bu kaynak terimleri verilen Türkçe karşılıklarla çevir): ${mapping}.`;
}

/**
 * Warns when a glossary source term is present in both the source cue and the
 * Turkish output, which means it was left untranslated.
 */
export function checkGlossary(
  sourceSegments: readonly { text: string }[],
  translatedSegments: readonly { text: string }[],
  glossary: Glossary | undefined,
): string[] {
  const warnings: string[] = [];
  const entries = Object.entries(glossary ?? {});
  if (entries.length === 0) {
    return warnings;
  }

  const count = Math.min(sourceSegments.length, translatedSegments.length);
  for (let index = 0; index < count; index += 1) {
    const source = sourceSegments[index]?.text ?? "";
    const translated = translatedSegments[index]?.text ?? "";

    for (const [term, translation] of entries) {
      if (term.toLowerCase() === translation.toLowerCase()) {
        continue;
      }
      if (containsTerm(source, term) && containsTerm(translated, term)) {
        warnings.push(
          `Cue ${index + 1}: glossary term "${term}" appears untranslated; expected "${translation}".`,
        );
      }
    }
  }

  return warnings;
}
