import { createId, type CircuitProject } from "@icm/model";

/** New persistence identity; all authored circuit/source/definition data stays intact. */
export function branchProjectVersion(
  project: CircuitProject,
  versionNo: number,
): CircuitProject {
  return {
    ...structuredClone(project),
    id: createId("project"),
    name: `${project.name} · branch v${versionNo}`,
    structureRevision: 0,
  };
}
