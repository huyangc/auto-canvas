// Auto Layout's worker: a thin shell over runAutoLayout. Cancel is
// worker.terminate(); one worker serves one run.
import { runAutoLayout } from "./auto-layout-core";
import type { AutoLayoutWorkerRequest } from "./auto-layout-protocol";

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<AutoLayoutWorkerRequest>) => void;
  postMessage: (value: unknown) => void;
};
scope.onmessage = (event) =>
  runAutoLayout(event.data, (message) => scope.postMessage(message));
