/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The notebook build (vite.config.ts): a literal in every Vite build,
   * undefined under Vitest. Undefined means false.
   */
  readonly ICM_NOTEBOOK?: boolean;
}
