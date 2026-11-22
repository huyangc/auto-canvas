import type { ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { EditorErrorBoundary } from "../components/editor-error-boundary";
import { observeSessionEvents, startNotebookGate } from "../notebook/gate";
import { showGateScreen } from "../notebook/screens";
import { createScopedFetch } from "../notebook/scoped-fetch";
import { identify, readToken } from "../notebook/session";
import type { AppProps } from "../app/App";
import type { createWebEditorServices } from "../services/web-editor-services";
import "../styles.css";
import { configureWebServiceWorker } from "./web-service-worker";

interface EditorModules {
  App: ComponentType<AppProps>;
  createWebEditorServices: typeof createWebEditorServices;
}

/**
 * The notebook build's entry (served under silicon-notebook at /canvas):
 * the editor mounts only for a notebook session the canvas server confirms,
 * with every API request carrying that session's token and the Agent off.
 */
export function mountNotebookEditor() {
  const container = document.getElementById("root");
  if (!container) throw new Error("Editor root element is missing");
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const baseUrl = import.meta.env.BASE_URL;
  let fetchInstalled = false;
  startNotebookGate<EditorModules>({
    subscribe: (onChange) => observeSessionEvents(window, onChange),
    // Reaching localStorage can itself throw; readToken reports that.
    readToken: () =>
      readToken({ getItem: (key) => window.localStorage.getItem(key) }),
    identify: (token) => identify(token, { fetch: nativeFetch, baseUrl }),
    loadApp: () =>
      Promise.all([
        import("../app/App"),
        import("../services/web-editor-services"),
      ]).then(([app, services]) => ({
        App: app.App,
        createWebEditorServices: services.createWebEditorServices,
      })),
    installFetch: (token, onUnauthorized) => {
      // Once per document, never restored: see docs/specs/server.md.
      if (fetchInstalled) throw new Error("The canvas fetch is installed");
      fetchInstalled = true;
      const scoped = createScopedFetch({
        native: nativeFetch,
        token,
        origin: window.location.origin,
        apiPrefix: `${baseUrl}api/`,
        onUnauthorized,
      });
      globalThis.fetch = scoped.fetch;
      return scoped.revoke;
    },
    mountApp: ({ App, createWebEditorServices }) => {
      const standard = createWebEditorServices();
      const services = {
        ...standard,
        capabilities: { ...standard.capabilities, agent: false },
      };
      container.replaceChildren();
      const root = createRoot(container);
      root.render(
        <EditorErrorBoundary>
          <App services={services} publicAgentUiEnabled={false} />
        </EditorErrorBoundary>,
      );
      return () => root.unmount();
    },
    showScreen: (screen, retry) => showGateScreen(container, screen, retry),
    reload: () => window.location.reload(),
  });
  void configureWebServiceWorker(
    import.meta.env.PROD,
    import.meta.env.BASE_URL,
  );
}
