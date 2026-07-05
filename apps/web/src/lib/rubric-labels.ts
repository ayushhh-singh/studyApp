import type { RubricDimensionKey } from "@prayasup/shared";

/**
 * The server's DimensionScore.label is English-only examiner copy (see
 * apps/api/src/services/evaluation/rubric.ts) — the UI translates dimension
 * names itself, keyed off the stable `key`, rather than displaying that
 * server label directly.
 */
export const DIMENSION_LABEL_KEYS: Record<RubricDimensionKey, string> = {
  structure_flow: "Answers.dimensionStructureFlow",
  content_coverage: "Answers.dimensionContentCoverage",
  keywords_concepts: "Answers.dimensionKeywordsConcepts",
  examples_data: "Answers.dimensionExamplesData",
  presentation: "Answers.dimensionPresentation",
  word_limit_language: "Answers.dimensionWordLimitLanguage",
};
