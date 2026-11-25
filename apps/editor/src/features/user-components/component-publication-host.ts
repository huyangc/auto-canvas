import { componentLibraryCapture } from "./component-library-origin";
import { executeComponentPublication } from "./component-publication-operation";
import type {
  SharedComponent,
  SharedDefinitionPayload,
} from "@icm/component-library";

/** Hosted component publication retains its account-bound journal. */
export async function saveLibraryComponent(request: {
  componentId: string;
  revision: number;
  payload: SharedDefinitionPayload;
}) {
  return executeComponentPublication(request);
}

/** Captures a published library component with its source provenance. */
export async function captureLibraryComponent(
  entry: SharedComponent,
): Promise<SharedDefinitionPayload> {
  return componentLibraryCapture(entry);
}
