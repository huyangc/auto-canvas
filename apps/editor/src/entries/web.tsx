import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { EditorErrorBoundary } from "../components/editor-error-boundary";
import { guardedRouteChunk } from "../components/route-chunk-loader";
import { AccountStatePreload, loadAccountState } from "../components/account";
import "../styles.css";
import { configureWebServiceWorker } from "./web-service-worker";

export function mountWebEditor() {
  const container = document.getElementById("root");
  if (!container) throw new Error("Editor root element is missing");
  const initialAccountState = loadAccountState();
  const EditorWorkspace = lazy(
    guardedRouteChunk(() =>
      Promise.all([
        import("../app/App"),
        import("./web-editor"),
        import("../agent/agent-runtime-loader")
          .then((loader) => loader.loadAgentRuntimeNeededOnLoad())
          .catch(() => null),
      ]).then(([app, editor]) => ({
        default: function EditorRoute() {
          return (
            <app.WorkspaceAgentProvider>
              <editor.WebEditorApp />
            </app.WorkspaceAgentProvider>
          );
        },
      })),
    ),
  );
  createRoot(container).render(
    <StrictMode>
      <EditorErrorBoundary>
        <Suspense fallback={<div>Loading editor…</div>}>
          <AccountStatePreload value={initialAccountState}>
            <EditorWorkspace />
          </AccountStatePreload>
        </Suspense>
      </EditorErrorBoundary>
    </StrictMode>,
  );
  void configureWebServiceWorker(
    import.meta.env.PROD,
    import.meta.env.BASE_URL,
  );
}
