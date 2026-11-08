import { deviceDescriptor } from "@icm/devices";
import type { SchematicDocument } from "@icm/model";
import { isMos, type NetRoles } from "./net-roles.js";
import type { RecognizedGroup } from "./types.js";

export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function recognizeStructures(
  document: SchematicDocument,
  roles: NetRoles,
): RecognizedGroup[] {
  const mos = document.instances
    .filter((i) => isMos(i.symbolId))
    .sort((a, b) => compareIds(a.id, b.id));
  const used = new Set(document.layoutGroups.flatMap((g) => g.objectIds));
  const groups: RecognizedGroup[] = [];
  const pin = roles.pinNet;
  for (const kind of [
    "cross-coupled",
    "differential-pair",
    "current-mirror",
    "matched-pair",
  ] as const) {
    for (let i = 0; i < mos.length; i++) {
      const a = mos[i]!;
      if (used.has(a.id)) continue;
      for (const b of mos.slice(i + 1)) {
        if (
          used.has(b.id) ||
          deviceDescriptor(a.symbolId)?.mosBulkClass !==
            deviceDescriptor(b.symbolId)?.mosBulkClass
        )
          continue;
        const as = pin(a.id, "S"),
          bs = pin(b.id, "S");
        const ad = pin(a.id, "D"),
          bd = pin(b.id, "D");
        const ag = pin(a.id, "G"),
          bg = pin(b.id, "G");
        if (!as || !bs || !ad || !bd || !ag || !bg) continue;
        const aDiode = ad === ag,
          bDiode = bd === bg;
        // R68: mutual channel-to-gate links are symmetric; a one-way link
        // identifies a driver, never a differential pair.
        const aDrivesB = bg === ad || bg === as;
        const bDrivesA = ag === bd || ag === bs;
        const crossCoupled = aDrivesB && bDrivesA && !aDiode && !bDiode;
        const matches =
          kind === "cross-coupled"
            ? crossCoupled
            : kind === "differential-pair"
              ? !aDrivesB &&
                !bDrivesA &&
                as === bs &&
                roles.byNet.get(as) !== "supply" &&
                roles.byNet.get(as) !== "ground" &&
                ad !== bd &&
                ag !== bg
              : kind === "current-mirror"
                ? as === bs && ag === bg && aDiode !== bDiode
                : ((aDiode && bDiode) || ag === bg) && (as === bs || ad === bd);
        if (!matches) continue;
        const recordedKind = kind === "cross-coupled" ? "matched-pair" : kind;
        const group: RecognizedGroup = {
          id: `auto-${recordedKind}-${a.id}`,
          kind: recordedKind,
          members: [a.id, b.id],
        };
        if (kind === "current-mirror")
          group.diodeInstanceId = aDiode ? a.id : b.id;
        if (kind === "differential-pair") {
          const tail = document.instances
            .filter(
              (item) =>
                item.id !== a.id &&
                item.id !== b.id &&
                ((isMos(item.symbolId) && pin(item.id, "D") === as) ||
                  (deviceDescriptor(item.symbolId)?.deviceClass ===
                    "current-source" &&
                    pin(item.id, "+") === as)),
            )
            .sort((x, y) => compareIds(x.id, y.id))[0];
          if (tail) group.tailInstanceId = tail.id;
        }
        groups.push(group);
        used.add(a.id);
        used.add(b.id);
        break;
      }
    }
  }
  // Stacked loads follow the left/right drains of the differential template.
  for (const load of groups.filter((g) => g.kind !== "differential-pair")) {
    const pair = groups.find(
      (g) =>
        g.kind === "differential-pair" &&
        load.members.some((id) =>
          [pin(id, "D"), pin(id, "S")].includes(pin(g.members[0], "D")),
        ),
    );
    if (pair) {
      const leftNet = pin(pair.members[0], "D");
      if (
        ![pin(load.members[0], "D"), pin(load.members[0], "S")].includes(
          leftNet,
        )
      )
        load.members.reverse();
    }
  }
  return groups;
}

/** Persisted groups reconstructed as templates, so re-planning keeps intent. */
export function persistedTemplates(
  document: SchematicDocument,
  roles: NetRoles,
): RecognizedGroup[] {
  const inferred = recognizeStructures(
    { ...document, layoutGroups: [] },
    roles,
  );
  return document.layoutGroups.flatMap((g) => {
    const match = inferred.find(
      (r) =>
        r.kind === g.kind && r.members.every((id) => g.objectIds.includes(id)),
    );
    return match ? [match] : [];
  });
}
