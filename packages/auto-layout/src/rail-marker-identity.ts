import { resolveDocumentLogicalNets } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";

/** Only an existing explicit name can authorize another visible rail marker. */
export function railMarkerClaim(document: SchematicDocument, netId: string) {
  const logical = resolveDocumentLogicalNets(document).byBaseNetId.get(netId);
  if (!logical?.name) return undefined;
  return document.connectivityEvidence.find(
    (e) =>
      e.kind === "name-claim" && e.netId === netId && e.name === logical.name,
  ) as
    | Extract<
        SchematicDocument["connectivityEvidence"][number],
        { kind: "name-claim" }
      >
    | undefined;
}

export function isPowerMarker(symbolId: string) {
  return symbolId === "ground" || symbolId === "vdd-port";
}

/** An annotation/conductor power claim authorizes its existing domain only. */
export function claimedMarkerSymbol(claim: ReturnType<typeof railMarkerClaim>) {
  if (claim?.owner.kind !== "power-marker") return undefined;
  return claim.powerDomain === "ground"
    ? "ground"
    : claim.powerDomain === "vdd"
      ? "vdd-port"
      : undefined;
}

/** A generic declaration can precede the authored power claim in evidence order. */
export function railPowerClaim(document: SchematicDocument, netId: string) {
  const name = railMarkerClaim(document, netId)?.name;
  return document.connectivityEvidence.find(
    (claim) =>
      claim.kind === "name-claim" &&
      claim.netId === netId &&
      claim.name === name &&
      claimedMarkerSymbol(claim) !== undefined,
  ) as ReturnType<typeof railMarkerClaim>;
}
