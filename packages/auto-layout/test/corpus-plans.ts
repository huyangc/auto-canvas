import { readFileSync } from "node:fs";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/index.js";
import type cases from "./corpus-cases.json";

function planFixture(fixture: (typeof cases)[number]) {
  const project = parseProject(readFileSync(fixture.file, "utf8"));
  const document = project.documents.find(
    (d) => d.id === (fixture.documentId ?? project.topDocumentId),
  )!;
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const plan = planAutoLayout(document, resolver);
  return { project, document, resolver, plan };
}

// Each test file owns its cache. Plan lazily inside the requesting test so
// planning still counts against its timeout. Determinism tests call the real
// planner again; changed inputs and options must not use this cache.
export function createCorpusPlans() {
  const plans = new Map<string, ReturnType<typeof planFixture>>();
  return (fixture: (typeof cases)[number]) => {
    let planned = plans.get(fixture.id);
    if (!planned) {
      planned = planFixture(fixture);
      plans.set(fixture.id, planned);
    }
    return planned;
  };
}
