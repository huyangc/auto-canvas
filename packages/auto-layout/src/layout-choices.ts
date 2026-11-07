import type { Placement } from "./types.js";

export type CellSide = "left" | "right";
/** Internal planning choices; deliberately absent from the public options. */
export interface LayoutOverrides {
  sides: ReadonlyMap<string, CellSide>;
  orientations: ReadonlyMap<string, Placement>;
}
export interface LayoutChoices {
  sides: Map<string, CellSide>;
  orientations: Map<string, Placement[]>;
}
export const emptyOverrides = (): LayoutOverrides => ({
  sides: new Map(),
  orientations: new Map(),
});
export const emptyChoices = (): LayoutChoices => ({
  sides: new Map(),
  orientations: new Map(),
});
