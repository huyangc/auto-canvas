import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { CircuitProject } from "@icm/model";
import type { ProjectWorkspace } from "../document/project-workspace";
import type { useProjectFileLifecycle } from "../document/use-project-file-lifecycle";
import type { useProjectTabSessions } from "./use-project-tab-sessions";
import { DEFAULT_VIEWBOX } from "./default-view-box";
type ProjectFileLifecycle = ReturnType<typeof useProjectFileLifecycle>;
type ProjectTabSessions = ReturnType<typeof useProjectTabSessions>;
type BootLink = ReturnType<typeof useBootLink>;
/**
 * Takes `new=1` out of the address once the new circuit is open. The address
 * is what the window's tabs are saved under, so a refresh then brings back
 * what was drawn, and only a fresh New Circuit starts another.
 */
function forgetNewProjectRequest(): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get("new") !== "1") return;
  url.searchParams.delete("new");
  window.history.replaceState(
    window.history.state,
    "",
    url.pathname + url.search + url.hash,
  );
}

/** Opens what the window's link asks for, once, as the editor boots. */
export function useBootLink({
  restoredWorkspace,
  bootRequestsNewProject,
  preparedInitialProject,
  setStatus,
  restoreAfterRefresh,
  replaceActiveProject,
  openCloudProjectById,
}: {
  restoredWorkspace: ProjectWorkspace | null;
  bootRequestsNewProject: boolean;
  preparedInitialProject: CircuitProject;
  setStatus: Dispatch<SetStateAction<string>>;
  restoreAfterRefresh: ProjectFileLifecycle["restoreAfterRefresh"];
  replaceActiveProject: ProjectFileLifecycle["replaceActiveProject"];
  openCloudProjectById: ProjectFileLifecycle["openCloudProjectById"];
}) {
  const restoredCloudLink = useRef(
    restoredWorkspace && !restoreAfterRefresh
      ? new URLSearchParams(window.location.search).get("project")
      : null,
  );
  // So is New Circuit: it opens a new tab beside the ones brought back,
  // rather than showing the circuit this window drew last.
  const restoredNewLink = useRef(
    restoredWorkspace !== null &&
      !restoreAfterRefresh &&
      bootRequestsNewProject,
  );

  // boot Project only; ordinary sessions never re-run these.
  const bootTargetHandled = useRef(false);
  useEffect(() => {
    if (import.meta.env?.ICM_DESKTOP || bootTargetHandled.current) return;
    bootTargetHandled.current = true;
    // A safe recovery refresh reloads the same URL: the pending restore owns
    // this boot. Re-running the URL's boot target here would fork the
    // working-copy identity and orphan the snapshot the restore is about to
    // read.
    if (restoreAfterRefresh) return;
    if (restoredWorkspace) return;
    // A tile on the shelf opens straight into its Project.
    const shelfProjectId = new URLSearchParams(window.location.search).get(
      "project",
    );
    const requestsNewProject = bootRequestsNewProject;
    if (requestsNewProject) {
      replaceActiveProject(preparedInitialProject, DEFAULT_VIEWBOX);
      setStatus("Created a new Project");
      return;
    }
    if (shelfProjectId) {
      setStatus("Opening your Cloud Project…");
      void openCloudProjectById(shelfProjectId, true);
      return;
    }
  }, [restoreAfterRefresh]);
  return { restoredCloudLink, restoredNewLink };
}

/** Opens the link a window was given into the tabs it brought back. */
export function useRestoredTabLinks({
  restoringWorkspace,
  bootRequestsNewProject,
  setStatus,
  openCloudProjectById,
  restoredCloudLink,
  restoredNewLink,
  restoredTabs,
}: {
  restoringWorkspace: boolean;
  bootRequestsNewProject: boolean;
  setStatus: Dispatch<SetStateAction<string>>;
  openCloudProjectById: ProjectFileLifecycle["openCloudProjectById"];
  restoredCloudLink: BootLink["restoredCloudLink"];
  restoredNewLink: BootLink["restoredNewLink"];
  restoredTabs: ProjectTabSessions["restoredTabs"];
}) {
  useEffect(() => {
    const cloudId = restoredCloudLink.current;
    if (restoringWorkspace || !cloudId) return;
    restoredCloudLink.current = null;
    void openCloudProjectById(cloudId, true);
  }, [restoringWorkspace]);
  useEffect(() => {
    if (restoringWorkspace || !restoredNewLink.current) return;
    restoredNewLink.current = false;
    forgetNewProjectRequest();
    // Tabs that could not be restored leave their message standing.
    if (restoredTabs.value) setStatus("Created a new Project");
  }, [restoringWorkspace]);
  useEffect(() => {
    // A new circuit this window opened fresh is simply the working one now.
    if (bootRequestsNewProject && !restoredNewLink.current)
      forgetNewProjectRequest();
  }, []);
}
