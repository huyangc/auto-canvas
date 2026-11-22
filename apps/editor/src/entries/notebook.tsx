import type { ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { EditorErrorBoundary } from "../components/editor-error-boundary";
import {
  installNotebookStorage,
  namespacePrefix,
} from "../notebook/browser-storage";
import { observeSessionEvents, startNotebookGate } from "../notebook/gate";
import { showGateScreen } from "../notebook/screens";
import { createScopedFetch } from "../notebook/scoped-fetch";
import {
  identify as identifyUser,
  readToken,
  type Identification,
} from "../notebook/session";
import type { AppProps } from "../app/App";
import type { createWebEditorServices } from "../services/web-editor-services";
import "../styles.css";
import { configureWebServiceWorker } from "./web-service-worker";

interface EditorModules {
  App: ComponentType<AppProps>;
  createWebEditorServices: typeof createWebEditorServices;
}

/** Replacements for the entry's own effects; only the entry's jsdom test passes any. */
interface NotebookEntryOverrides {
  page?: Window & typeof globalThis;
  identify?: (token: string) => Promise<Identification>;
  loadModules?: () => Promise<EditorModules>;
  reload?: () => void;
}

/** How long a session change waits for the editor's storage writes. */
const SETTLE_DEADLINE_MS = 3000;
const ACCOUNT_CHANGED_TEXT =
  "Your silicon-notebook session changed, so the canvas is reloading.";

/**
 * The notebook build's entry (served under silicon-notebook at /canvas):
 * the editor mounts only for a notebook session the canvas server confirms,
 * with every API request carrying that session's token, its browser storage
 * bound to that user, and the Agent off.
 */
export function mountNotebookEditor(overrides: NotebookEntryOverrides = {}) {
  const page = overrides.page ?? window;
  // First, before anything can reach the page's storage: locked facades.
  const storage = installNotebookStorage(page, {
    onLockedAccess: (surface) =>
      console.error(
        `auto-canvas: browser storage used before sign-in: ${surface}`,
      ),
  });
  const document = page.document;
  const container = document.getElementById("root");
  if (!container) throw new Error("Editor root element is missing");
  const reload = overrides.reload ?? (() => page.location.reload());
  if (storage.failure) {
    // Terminal: no gate, no subscription, no editor module.
    showGateScreen(container, "error", undefined, reload);
    return;
  }
  const nativeFetch = page.fetch.bind(page);
  const baseUrl = import.meta.env.BASE_URL;
  let fetchInstalled = false;
  /** The body's inline `display` before concealment, while concealed. */
  let concealedFrom: { value: string; priority: string } | null = null;
  startNotebookGate<EditorModules>({
    subscribe: (onChange, onConceal) =>
      observeSessionEvents(page, onChange, onConceal),
    // The token is silicon-notebook's, in the browser's own storage; reaching
    // it can itself throw, which readToken reports.
    readToken: () =>
      readToken({
        getItem: (key) => {
          const local = storage.native("localStorage");
          if (!local) throw new Error("The browser offers no localStorage");
          return local.getItem(key);
        },
      }),
    identify:
      overrides.identify ??
      ((token) => identifyUser(token, { fetch: nativeFetch, baseUrl })),
    loadApp:
      overrides.loadModules ??
      (() =>
        Promise.all([
          import("../app/App"),
          import("../services/web-editor-services"),
        ]).then(([app, services]) => ({
          App: app.App,
          createWebEditorServices: services.createWebEditorServices,
        }))),
    installStorage: (userId) => storage.setNamespace(namespacePrefix(userId)),
    installFetch: (token, onUnauthorized) => {
      // Once per document, never restored: see docs/specs/server.md.
      if (fetchInstalled) throw new Error("The canvas fetch is installed");
      fetchInstalled = true;
      const scoped = createScopedFetch({
        native: nativeFetch,
        token,
        origin: page.location.origin,
        apiPrefix: `${baseUrl}api/`,
        onUnauthorized,
      });
      page.fetch = scoped.fetch;
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
      // For the browser cases: the namespace is fixed and the editor mounted.
      page.performance.mark("auto-canvas:notebook-commit");
      return () => root.unmount();
    },
    // The editor's own page-hide handlers store its unsaved work.
    flushPage: () => {
      page.dispatchEvent(
        new page.PageTransitionEvent("pagehide", { persisted: false }),
      );
    },
    purgeOutsideRoot: () => {
      for (const child of [...document.body.children])
        if (child !== container && child.tagName !== "SCRIPT") child.remove();
    },
    conceal: () => {
      const style = document.body.style;
      concealedFrom ??= {
        value: style.getPropertyValue("display"),
        priority: style.getPropertyPriority("display"),
      };
      style.setProperty("display", "none", "important");
    },
    reveal: () => {
      if (concealedFrom === null) return;
      const { value, priority } = concealedFrom;
      concealedFrom = null;
      const style = document.body.style;
      if (value === "") style.removeProperty("display");
      else style.setProperty("display", value, priority);
    },
    settleStorage: () => storage.settle(SETTLE_DEADLINE_MS),
    showScreen: (screen, retry) => {
      try {
        showGateScreen(container, screen, retry, reload);
      } catch (error) {
        if (screen !== "account-changed") throw error;
        container.textContent = ACCOUNT_CHANGED_TEXT;
      }
    },
    reload: () => {
      page.performance.mark("auto-canvas:notebook-reload");
      reload();
    },
  });
  void configureWebServiceWorker(
    import.meta.env.PROD,
    import.meta.env.BASE_URL,
  );
}
