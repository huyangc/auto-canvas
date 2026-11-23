import type { RichTextDocument, RichTextRun, RichTextStyle } from "./schema.js";

export type RichTextMathRun = Extract<RichTextRun, { kind: "math" }>;

export function soleRichTextMathRun(
  document: RichTextDocument,
): RichTextMathRun | undefined {
  const run = document.runs.length === 1 ? document.runs[0] : undefined;
  return run?.kind === "math" ? run : undefined;
}

/** Lossy plain-text projection for search and accessibility only. */
export function flattenRichText(document: RichTextDocument): string {
  return document.runs.map(flattenRun).join("");
}

function flattenRun(run: RichTextRun): string {
  switch (run.kind) {
    case "text":
      return run.value;
    case "line-break":
      return "\n";
    case "math":
      return run.latex;
    case "span":
      return run.children.map(flattenRun).join("");
    case "fraction":
      return `${run.numerator.runs.map(flattenRun).join("")}/${run.denominator.runs.map(flattenRun).join("")}`;
  }
}

/** Canonicalize text-run boundaries recursively before structural equality. */
export function normalizeRichText(
  document: RichTextDocument,
): RichTextDocument {
  const normalized: RichTextRun[] = [];
  const append = (run: RichTextRun): void => {
    if (run.kind === "text") {
      if (run.value.length === 0) return;
      const previous = normalized.at(-1);
      if (previous?.kind === "text") previous.value += run.value;
      else normalized.push({ ...run });
      return;
    }
    if (run.kind === "span") {
      normalized.push({
        ...run,
        children: normalizeRichText({ runs: run.children }).runs,
      });
      return;
    }
    if (run.kind === "math") {
      normalized.push({ ...run });
      return;
    }
    if (run.kind === "fraction") {
      normalized.push({
        kind: "fraction",
        numerator: normalizeRichText(run.numerator),
        denominator: normalizeRichText(run.denominator),
      });
      return;
    }
    normalized.push(run);
  };
  document.runs.forEach(append);
  return { runs: normalized };
}

interface StyledCharacter {
  readonly value: string;
  readonly styles: readonly RichTextStyle[];
}

function collectStyledCharacters(
  runs: readonly RichTextRun[],
  styles: readonly RichTextStyle[],
  output: StyledCharacter[],
  allowLineBreaks = false,
): boolean {
  for (const run of runs) {
    if (run.kind === "text") {
      output.push(
        ...[...run.value].map((value) => ({ value, styles: [...styles] })),
      );
      continue;
    }
    if (run.kind === "span") {
      if (
        !collectStyledCharacters(
          run.children,
          [...styles, run.style],
          output,
          allowLineBreaks,
        )
      )
        return false;
      continue;
    }
    if (allowLineBreaks && run.kind === "line-break") {
      output.push({ value: "\n", styles: [] });
      continue;
    }
    // Semantic names are styled text, not formulas, fractions, or multiline
    // prose. Callers still get a valid deterministic projection if legacy
    // data contains one of those unsupported presentation nodes.
    return false;
  }
  return true;
}

/**
 * Whether text writes more than italic and bold: a subscript or superscript,
 * a bar, a case change, a formula, a fraction or a line break. That is the
 * author's notation, which a label's standard look would not keep.
 */
export function richTextWritesNotation(document: RichTextDocument): boolean {
  const visit = (runs: readonly RichTextRun[]): boolean =>
    runs.some((run) =>
      run.kind === "text"
        ? false
        : run.kind !== "span" ||
          (run.style !== "italic" && run.style !== "bold") ||
          visit(run.children),
    );
  return visit(document.runs);
}

/**
 * Whether two presentations draw the same characters with the same styles,
 * regardless of how their spans happen to be nested or split.
 */
export function sameStyledText(
  left: RichTextDocument,
  right: RichTextDocument,
): boolean {
  const a: StyledCharacter[] = [];
  const b: StyledCharacter[] = [];
  if (
    !collectStyledCharacters(left.runs, [], a) ||
    !collectStyledCharacters(right.runs, [], b) ||
    a.length !== b.length
  )
    return false;
  const key = (character: StyledCharacter) =>
    `${character.value}\u0000${[...new Set(character.styles)].sort().join(",")}`;
  return a.every((character, index) => key(character) === key(b[index]!));
}

function styledTextRun(
  value: string,
  styles: readonly RichTextStyle[],
): RichTextRun {
  let run: RichTextRun = { kind: "text", value };
  for (let index = styles.length - 1; index >= 0; index -= 1) {
    run = { kind: "span", style: styles[index]!, children: [run] };
  }
  return run;
}

/**
 * Replace the plain-text value of a semantic RichText projection while
 * retaining the authored style of every unchanged character and the nearest
 * replaced character. This is the shared bridge between an authoritative
 * semantic name and its independently editable RichText presentation.
 */
export function rewriteRichTextPlainText(
  document: RichTextDocument,
  replacement: string,
): RichTextDocument {
  const source: StyledCharacter[] = [];
  if (!collectStyledCharacters(document.runs, [], source)) {
    return { runs: [{ kind: "text", value: replacement }] };
  }
  return rewriteStyledCharacters(source, replacement);
}

/** Content-only editing of prose preserves authored spans, including unbold.
 * Formulas/fractions require an explicit RichText replacement, never flattening.
 */
export function rewriteRichTextContent(
  document: RichTextDocument,
  replacement: string,
): RichTextDocument | undefined {
  if (flattenRichText(document) === replacement) return document;
  const source: StyledCharacter[] = [];
  if (!collectStyledCharacters(document.runs, [], source, true))
    return undefined;
  return rewriteStyledCharacters(source, replacement, true);
}

function rewriteStyledCharacters(
  source: StyledCharacter[],
  replacement: string,
  allowLineBreaks = false,
): RichTextDocument {
  const target = [...replacement];
  let prefixLength = 0;
  while (
    prefixLength < source.length &&
    prefixLength < target.length &&
    source[prefixLength]!.value === target[prefixLength]
  ) {
    prefixLength += 1;
  }
  let suffixLength = 0;
  while (
    suffixLength < source.length - prefixLength &&
    suffixLength < target.length - prefixLength &&
    source[source.length - suffixLength - 1]!.value ===
      target[target.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const replacementStyles =
    source[prefixLength]?.styles ??
    source[source.length - suffixLength - 1]?.styles ??
    source.at(-1)?.styles ??
    [];
  const styledTarget: StyledCharacter[] = [
    ...source.slice(0, prefixLength),
    ...target
      .slice(prefixLength, target.length - suffixLength)
      .map((value) => ({ value, styles: replacementStyles })),
    ...(suffixLength > 0 ? source.slice(source.length - suffixLength) : []),
  ];

  const runs: RichTextRun[] = [];
  for (const character of styledTarget) {
    if (allowLineBreaks && character.value === "\n") {
      runs.push({ kind: "line-break" });
      continue;
    }
    const previous = runs.at(-1);
    const previousStyles =
      previous?.kind === "text"
        ? []
        : previous?.kind === "span"
          ? (() => {
              const nested: RichTextStyle[] = [];
              let cursor: RichTextRun = previous;
              while (cursor.kind === "span") {
                nested.push(cursor.style);
                cursor = cursor.children[0]!;
              }
              return cursor.kind === "text" ? nested : null;
            })()
          : null;
    if (
      previousStyles &&
      previousStyles.length === character.styles.length &&
      previousStyles.every((style, index) => style === character.styles[index])
    ) {
      let leaf = previous!;
      while (leaf.kind === "span") leaf = leaf.children[0]!;
      if (leaf.kind === "text") {
        leaf.value += character.value;
        continue;
      }
    }
    runs.push(styledTextRun(character.value, character.styles));
  }
  return {
    runs: runs.length > 0 ? runs : [{ kind: "line-break" }],
  };
}
