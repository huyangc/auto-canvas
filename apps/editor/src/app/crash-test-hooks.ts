// DEV-only crash injection hooks for browser tests of the runtime safety
// layers. Every reference is guarded by `import.meta.env.DEV`, so production
// builds eliminate the checks and the hooks cannot be triggered in deployed
// editors.
//
// - `__ICM_TEST_RENDER_CRASH__` mounts a probe component that throws during
//   render, exercising the root error boundary.
// - `__ICM_TEST_SCENE_CRASH__` makes formal scene building throw, exercising
//   the last-good-scene fallback.

declare global {
  interface Window {
    __ICM_TEST_RENDER_CRASH__?: boolean;
    __ICM_TEST_SCENE_CRASH__?: boolean;
  }
}

type CrashFlag = "__ICM_TEST_RENDER_CRASH__" | "__ICM_TEST_SCENE_CRASH__";

function crashFlagRequested(flag: CrashFlag): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window[flag] === true
  );
}

export function renderCrashRequested(): boolean {
  return crashFlagRequested("__ICM_TEST_RENDER_CRASH__");
}

export function sceneCrashRequested(): boolean {
  return crashFlagRequested("__ICM_TEST_SCENE_CRASH__");
}
