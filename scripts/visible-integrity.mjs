// Visible connection defects the routing audit cannot see: what the product's
// ERC reports about open wire ends, open pins and pins drawn on another Net's
// wire, and Net labels that read as naming another Net. Pure functions over a
// Document and its symbol resolver; the evaluation compares a layout result
// with its own source drawing.
import {
  buildProjectConnectivityIndex,
  diagnoseProject,
} from "../packages/derived/dist/index.js";
// The planner seats Net labels by the same ownership measure (T125).
import { labelOwnership } from "../packages/auto-layout/dist/label-ownership.js";

const ercCodes = {
  danglingWires: "ERC_DANGLING_WIRE",
  unconnectedPins: "ERC_UNCONNECTED_PIN",
  touchingNotConnected: "ERC_TOUCHING_NOT_CONNECTED",
};

/** The Project holding `document`, or a one-document Project around it. */
function projectFor(document, project) {
  if (!project)
    return {
      schemaVersion: 1,
      id: `visible-integrity-${document.id}`,
      name: document.name,
      source: { entry: null, dialect: "none", sourcePolicy: "copy", files: [] },
      symbolLibrary: {
        id: "razavi-symbols",
        version: "1",
        hash: "razavi-reference-v1",
      },
      structureRevision: 0,
      topDocumentId: document.id,
      documents: [document],
      externalSubcircuitDefinitions: [],
      simulationFolders: [],
    };
  return {
    ...project,
    documents: project.documents.some((d) => d.id === document.id)
      ? project.documents.map((d) => (d.id === document.id ? document : d))
      : [...project.documents, document],
  };
}

/** Each ERC finding of the three visible-connection codes on `document`. */
function ercFindings(document, resolver, project) {
  const groups = Object.fromEntries(
    Object.keys(ercCodes).map((key) => [key, []]),
  );
  const keyOf = Object.fromEntries(
    Object.entries(ercCodes).map(([key, code]) => [code, key]),
  );
  const whole = projectFor(document, project);
  for (const diagnostic of diagnoseProject(
    whole,
    resolver,
    buildProjectConnectivityIndex(whole, resolver),
    { domains: ["erc"] },
  )) {
    const key = keyOf[diagnostic.code];
    if (!key || diagnostic.primary?.documentId !== document.id) continue;
    const p = diagnostic.parameters ?? {};
    if (key === "danglingWires") {
      const route = document.routes.find((r) => r.id === p.routeId);
      groups[key].push({
        routeId: p.routeId,
        junctionId: p.junctionId,
        netId: route?.netId ?? null,
      });
    } else
      groups[key].push({
        instanceId: p.instanceId,
        pinName: p.pinName,
        ...(p.memberId === undefined ? {} : { memberId: p.memberId }),
        ...(p.otherInstanceId === undefined
          ? {}
          : {
              otherInstanceId: p.otherInstanceId,
              otherPinName: p.otherPinName,
            }),
        ...(p.netId === undefined ? {} : { netId: p.netId }),
      });
  }
  return groups;
}

/**
 * Visible-connection findings of one Document. `project`, when given, is the
 * Project holding the Document's source; `document` replaces its copy there.
 */
export function visibleIntegrity(document, resolver, project) {
  return {
    erc: ercFindings(document, resolver, project),
    labelOwnership: labelOwnership(document, resolver),
  };
}

const pinKey = (item) =>
  [item.instanceId, item.pinName, item.memberId ?? ""].join("\u0000");

/** The unordered pin pair of a pin-on-pin finding; undefined for pin-on-wire. */
const pinPairKey = (item) =>
  item.otherInstanceId === undefined
    ? undefined
    : [
        `${item.instanceId}\u0000${item.pinName}`,
        `${item.otherInstanceId}\u0000${item.otherPinName}`,
      ]
        .sort()
        .join("\u0001");

/** Routes the planner carries over from the source keep this id prefix (R158). */
const carriedRoutePrefix = "auto-layout-carried-";

/**
 * What a layout result shows wrong that its source did not. An open wire end
 * is carried, not introduced, only when its Route is one the planner carries
 * over from the source (id prefix `auto-layout-carried-`), and only up to the
 * number of open ends the source has on that Net; every other open end is
 * introduced, because the planner regenerates Route and Junction ids. Open
 * pins the source had connected and flagged labels the source did not flag
 * are introduced too. A pin drawn on another Net's wire is introduced (every
 * wire is re-routed); a pin on another Net's pin is introduced unless the
 * source reports the same pin pair, which fixed or locked instances keep.
 * Pins the source draws on another Net are listed as source defects: input
 * data, not a planner regression.
 */
export function compareVisibleIntegrity(source, result) {
  const sourceOpenEnds = new Map();
  for (const item of source.erc.danglingWires)
    sourceOpenEnds.set(item.netId, (sourceOpenEnds.get(item.netId) ?? 0) + 1);
  const excused = new Map();
  const sourcePinPairs = new Set(
    source.erc.touchingNotConnected.map(pinPairKey).filter(Boolean),
  );
  const sourceOpen = new Set(source.erc.unconnectedPins.map(pinKey));
  const sourceLabels = new Set(
    source.labelOwnership.map((l) => l.annotationId),
  );
  return {
    introduced: {
      danglingWires: result.erc.danglingWires.filter((item) => {
        if (!String(item.routeId).startsWith(carriedRoutePrefix)) return true;
        const used = excused.get(item.netId) ?? 0;
        if (used >= (sourceOpenEnds.get(item.netId) ?? 0)) return true;
        excused.set(item.netId, used + 1);
        return false;
      }),
      unconnectedPins: result.erc.unconnectedPins.filter(
        (item) => !sourceOpen.has(pinKey(item)),
      ),
      touchingNotConnected: result.erc.touchingNotConnected.filter(
        (item) => !sourcePinPairs.has(pinPairKey(item)),
      ),
      labelOwnership: result.labelOwnership.filter(
        (label) => !sourceLabels.has(label.annotationId),
      ),
    },
    sourceDefects: source.erc.touchingNotConnected,
  };
}
