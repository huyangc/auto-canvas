import type { SchematicDocument } from "@icm/model";
import type { LayoutPartition, BlockRole } from "./types.js";

/** @internal LOADBench adapter for converted documents; never used by the planner. */
export function partitionFromLoadbench(
  document: SchematicDocument,
  xml: string,
): LayoutPartition {
  const roles: Record<string, BlockRole> = {
    gmPart: "gain",
    biasPart: "bias",
    loadPart: "load",
    capacitance: "compensation",
    resistorPart: "other",
    commonModeSignalDetectorPart: "cmfb",
    positiveFeedbackPart: "gain",
    undefinedPart: "other",
  };
  const blocks: LayoutPartition["blocks"] = [];
  const pattern =
    /<(gmPart|biasPart|loadPart|capacitance|resistorPart|commonModeSignalDetectorPart|positiveFeedbackPart|undefinedPart)\b([^>]*)>([\s\S]*?)<\/\1>/gu;
  for (const match of xml.matchAll(pattern)) {
    const names = [
      ...match[3]!.matchAll(/<device\b[^>]*\bname="([^"]+)"/gu),
    ].map((m) => m[1]!.replace(/^\//u, ""));
    const members = [
      ...new Set(
        names.map((name) => {
          const candidates = document.instances.filter(
            (i) =>
              i.reference?.toLowerCase() === name.toLowerCase() ||
              i.id.toLowerCase() === name.toLowerCase(),
          );
          if (candidates.length !== 1)
            throw new Error(
              `LOADBench member has ${candidates.length} matches: ${name}`,
            );
          return candidates[0]!.id;
        }),
      ),
    ].sort();
    if (!members.length) continue;
    // XML repeats stage children in its global part lists. Deduplicate exact sets.
    if (
      blocks.some((b) => JSON.stringify(b.members) === JSON.stringify(members))
    )
      continue;
    blocks.push({
      id: `block-${blocks.length + 1}`,
      role:
        match[1] === "gmPart" && /type="firstStage"/u.test(match[2]!)
          ? "input"
          : roles[match[1]!]!,
      members,
    });
  }
  if (!blocks.length) throw new Error("No LOADBench functional parts found");
  // Overlapping XML labels are one physical block, before L0 validation.
  for (let i = 0; i < blocks.length; i++)
    for (let j = i + 1; j < blocks.length;) {
      if (blocks[i]!.members.some((id) => blocks[j]!.members.includes(id))) {
        blocks[i]!.members = [
          ...new Set([...blocks[i]!.members, ...blocks[j]!.members]),
        ].sort();
        if (blocks[i]!.role !== blocks[j]!.role) blocks[i]!.role = "other";
        blocks.splice(j, 1);
        j = i + 1;
      } else j++;
    }
  return { blocks };
}
