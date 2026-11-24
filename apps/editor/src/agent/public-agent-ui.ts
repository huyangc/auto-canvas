import { resolvePublicUiFeatureEnabled } from "../deployment/public-ui-feature";

/**
 * Controls whether the browser exposes the human-facing Agent connection UI.
 *
 * The machine API and the MCP adapter intentionally do not depend on this
 * flag. Hosted release workflows opt in with VITE_ICM_AGENT_UI=enabled;
 * an unconfigured production build keeps the connection UI dormant.
 */
function resolvePublicAgentUiEnabled(input: {
  production: boolean;
  configured?: string;
}): boolean {
  return resolvePublicUiFeatureEnabled(input);
}

export const PUBLIC_AGENT_UI_ENABLED =
  // The notebook build keeps the Agent off whatever the feature flag says
  // (docs/specs/server.md, "The Agent is off in the notebook build"): both
  // literals are known at build time, so the notebook bundle drops the
  // Agent UI and runtime even when built with VITE_ICM_AGENT_UI=enabled.
  !import.meta.env.ICM_NOTEBOOK &&
  resolvePublicAgentUiEnabled({
    production: import.meta.env.PROD,
    configured: import.meta.env.VITE_ICM_AGENT_UI,
  });
