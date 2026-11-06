// Last-good-scene fallback for formal scene building.
//
// Scene building is the one confirmed render-phase white-screen path: it runs
// in an App-level useMemo over arbitrary committed geometry, symbol, and
// derivation code. When it throws, this helper returns the last successfully
// built scene so the canvas keeps showing a coherent (stale) view plus a
// visible degraded status, instead of unmounting the editor. With no last
// good scene (the very first render), the error is rethrown and the root
// error boundary owns the failure.

export interface SafeSceneOutcome<Scene> {
  scene: Scene;
  degraded: boolean;
  /** Failure reason when `degraded` is true. */
  message?: string;
}

export function buildSceneSafely<Scene>(
  build: () => Scene,
  lastGood: Scene | null,
): SafeSceneOutcome<Scene> {
  try {
    return { scene: build(), degraded: false };
  } catch (error) {
    if (lastGood === null) throw error;
    return {
      scene: lastGood,
      degraded: true,
      message: error instanceof Error ? error.message : "scene build failed",
    };
  }
}
