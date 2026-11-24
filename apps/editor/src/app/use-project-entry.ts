import { projectFileFromImportLink } from "../document/project-import-link";
import {
  useEffect,
  useEffectEvent,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { CircuitProject } from "@icm/model";
import type { ProjectWorkspace } from "../document/project-workspace";
import type { useProjectFileLifecycle } from "../document/use-project-file-lifecycle";
import { libraryProjectExamples } from "../examples/library-examples";
import type { NetlistExportProfile } from "../features/netlist-export/netlist-process-presets";
import { prepareNetlistExample } from "../features/netlist-export/netlist-process";
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

/**
 * Opens a bundled example as `?example=<id>` does, behind the dirty-work
 * guard, and drops that request from the address once it is open.
 */
export function openLibraryExample(
  exampleId: string,
  {
    netlistProfile,
    guardDirtyReplacement,
    replaceActiveProject,
    setStatus,
  }: {
    netlistProfile: NetlistExportProfile;
    guardDirtyReplacement: ProjectFileLifecycle["guardDirtyReplacement"];
    replaceActiveProject: ProjectFileLifecycle["replaceActiveProject"];
    setStatus: Dispatch<SetStateAction<string>>;
  },
): void {
  const example = libraryProjectExamples.find(
    (candidate) => candidate.id === exampleId,
  );
  if (!example) {
    setStatus(`Example not found: ${exampleId}`);
    return;
  }
  const exampleProject = prepareNetlistExample(
    structuredClone(example.project),
    netlistProfile,
  );
  void guardDirtyReplacement(`Open ${example.name} example`, () => {
    replaceActiveProject(exampleProject);
    setStatus(`Opened example: ${example.name}`);
    const url = new URL(window.location.href);
    url.searchParams.delete("example");
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search + url.hash,
    );
  });
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
  guardDirtyReplacement,
  netlistProfile,
}: {
  restoredWorkspace: ProjectWorkspace | null;
  bootRequestsNewProject: boolean;
  preparedInitialProject: CircuitProject;
  setStatus: Dispatch<SetStateAction<string>>;
  restoreAfterRefresh: ProjectFileLifecycle["restoreAfterRefresh"];
  replaceActiveProject: ProjectFileLifecycle["replaceActiveProject"];
  openCloudProjectById: ProjectFileLifecycle["openCloudProjectById"];
  guardDirtyReplacement: ProjectFileLifecycle["guardDirtyReplacement"];
  netlistProfile: NetlistExportProfile;
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
    const exampleId = new URLSearchParams(window.location.search).get(
      "example",
    );
    if (exampleId !== null)
      openLibraryExample(exampleId, {
        netlistProfile,
        guardDirtyReplacement,
        replaceActiveProject,
        setStatus,
      });
  }, [restoreAfterRefresh]);
  return { restoredCloudLink, restoredNewLink };
}

/** Opens the link a window was given into the tabs it brought back. */
export function useRestoredTabLinks({
  importReady,
  openProjectFile,
  restoringWorkspace,
  bootRequestsNewProject,
  setStatus,
  openCloudProjectById,
  restoredCloudLink,
  restoredNewLink,
  restoredTabs,
}: {
  importReady: boolean;
  openProjectFile: ProjectFileLifecycle["openProjectFile"];
  restoringWorkspace: boolean;
  bootRequestsNewProject: boolean;
  setStatus: Dispatch<SetStateAction<string>>;
  openCloudProjectById: ProjectFileLifecycle["openCloudProjectById"];
  restoredCloudLink: BootLink["restoredCloudLink"];
  restoredNewLink: BootLink["restoredNewLink"];
  restoredTabs: ProjectTabSessions["restoredTabs"];
}) {
  const openImportFile = useEffectEvent((file: File) =>
    openProjectFile(file, { inTab: true, independentCopy: true }),
  );
  useEffect(() => {
    if (
      import.meta.env.ICM_NOTEBOOK ||
      import.meta.env.ICM_DESKTOP ||
      restoringWorkspace ||
      !importReady
    )
      return;
    let live = true;
    let queue = Promise.resolve();
    const enqueue = () => {
      const url = new URL(window.location.href);
      if (url.searchParams.get("import") !== "1") return;
      const current = () => live && window.location.href === url.href;
      // Two links can differ only by fragment. Finish any tab transition
      // already underway, then handle the address the recipient is visiting.
      queue = queue.then(async () => {
        if (!current()) return;
        try {
          const file = await projectFileFromImportLink(url.hash);
          if (!current() || !(await openImportFile(file)) || !current()) return;
          url.searchParams.delete("import");
          window.history.replaceState(
            window.history.state,
            "",
            url.pathname + url.search,
          );
        } catch (error) {
          if (current())
            setStatus(
              `Project link could not be imported: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
      });
    };
    enqueue();
    window.addEventListener("hashchange", enqueue);
    return () => {
      live = false;
      window.removeEventListener("hashchange", enqueue);
    };
  }, [restoringWorkspace, importReady, setStatus]);
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
