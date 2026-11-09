/** Flat role maps are the benchmark interchange format, independent of branches. */
export interface RecognitionExpectation {
  kind: string;
  members: Record<string, string>;
  tailUnlabeled?: boolean;
}
export interface RecognitionCase {
  id: string;
  source: string;
  expected: RecognitionExpectation[];
  predicted: RecognitionExpectation[];
  deferred?: string[];
  labeledKinds: string[];
  ambiguousTailInputs?: string[][];
}

const entries = (s: RecognitionExpectation, omitTail = false) =>
  Object.entries(s.members)
    .filter(([, role]) => !omitTail || role !== "tail")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const key = (s: RecognitionExpectation, omitTail = false, roles = false) =>
  JSON.stringify(
    entries(s, omitTail).map(([id, role]) => (roles ? [id, role] : id)),
  );

/** Score one-to-one instance-set matches; roles determine exactness separately. */
export function scoreRecognition(cases: RecognitionCase[]) {
  const sources: Record<
    string,
    Record<
      string,
      {
        expected: number;
        predicted: number;
        matched: number;
        exact: number;
        unscored: number;
        precision: number;
        recall: number;
        exactRate: number;
        tails: {
          labeled: number;
          correct: number;
          wrong: number;
          missed: number;
          ambiguous: number;
        };
      }
    >
  > = {};
  const mismatches: {
    id: string;
    source: string;
    kind: string;
    shape: string;
    expected?: RecognitionExpectation;
    predicted?: RecognitionExpectation;
  }[] = [];
  for (const c of cases) {
    const deferred = new Set(c.deferred);
    const eligible = (s: RecognitionExpectation) =>
      !Object.keys(s.members).some((id) => deferred.has(id));
    const expected = c.expected.filter(eligible);
    const predicted = c.predicted
      .map((s) => {
        const members = Object.entries(s.members);
        if (!members.some(([id, role]) => role === "tail" && deferred.has(id)))
          return s;
        return {
          ...s,
          members: Object.fromEntries(
            members.filter(
              ([id, role]) => role !== "tail" || !deferred.has(id),
            ),
          ),
          tailUnlabeled: true,
        };
      })
      .filter(eligible);
    const source = (sources[c.source] ??= {});
    for (const kind of new Set([
      ...c.labeledKinds,
      ...predicted.map((s) => s.kind),
    ])) {
      const score = (source[kind] ??= {
        expected: 0,
        predicted: 0,
        matched: 0,
        exact: 0,
        unscored: 0,
        precision: 1,
        recall: 1,
        exactRate: 1,
        tails: { labeled: 0, correct: 0, wrong: 0, missed: 0, ambiguous: 0 },
      });
      const ps = predicted.filter((s) => s.kind === kind);
      if (!c.labeledKinds.includes(kind)) {
        score.unscored += ps.length;
        continue;
      }
      const es = expected.filter((s) => s.kind === kind);
      score.expected += es.length;
      score.predicted += ps.length;
      const unused = new Set(ps);
      for (const e of es) {
        // Prefer an exact role match when duplicate instance sets are supplied.
        const candidates = [...unused].filter(
          (p) =>
            key(p, e.tailUnlabeled || p.tailUnlabeled) ===
            key(e, e.tailUnlabeled || p.tailUnlabeled),
        );
        const p =
          candidates.find(
            (p) =>
              key(p, e.tailUnlabeled || p.tailUnlabeled, true) ===
              key(e, e.tailUnlabeled || p.tailUnlabeled, true),
          ) ?? candidates[0];
        if (p) {
          unused.delete(p);
          score.matched++;
          if (
            key(p, e.tailUnlabeled || p.tailUnlabeled, true) ===
            key(e, e.tailUnlabeled || p.tailUnlabeled, true)
          )
            score.exact++;
          else
            mismatches.push({
              id: c.id,
              source: c.source,
              kind,
              shape: "roles",
              expected: e,
              predicted: p,
            });
        } else
          mismatches.push({
            id: c.id,
            source: c.source,
            kind,
            shape: "missing",
            expected: e,
          });
        if (kind === "differential-pair" && !e.tailUnlabeled) {
          const pair = ps.find((p) => key(p, true) === key(e, true));
          if (pair?.tailUnlabeled) continue;
          score.tails.labeled++;
          const wanted = entries(e)
            .filter(([, r]) => r === "tail")
            .map(([id]) => id);
          const found = pair
            ? entries(pair)
                .filter(([, r]) => r === "tail")
                .map(([id]) => id)
            : [];
          const inputs = key(e, true);
          const ambiguous = c.ambiguousTailInputs?.some(
            (ids) => JSON.stringify([...ids].sort()) === inputs,
          );
          if (ambiguous) score.tails.ambiguous++;
          else if (pair && JSON.stringify(wanted) === JSON.stringify(found))
            score.tails.correct++;
          else if (found.length) score.tails.wrong++;
          else score.tails.missed++;
        }
      }
      for (const p of unused)
        mismatches.push({
          id: c.id,
          source: c.source,
          kind,
          shape: "unexpected",
          predicted: p,
        });
      score.precision = score.predicted ? score.matched / score.predicted : 1;
      score.recall = score.expected ? score.matched / score.expected : 1;
      score.exactRate = score.expected ? score.exact / score.expected : 1;
    }
  }
  return { sources, mismatches };
}
