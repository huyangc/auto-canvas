import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionUser } from "../components/account";
import type { CloudProjectSummary } from "../features/editor-shell/cloud-projects";
import type { EditorServices } from "../services/editor-services";

/** Identity and the private Cloud Project list shared by the File menu and shelf. */
export function useCloudProjects({
  identity,
  projectStore,
}: Pick<EditorServices, "identity" | "projectStore">) {
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  /** The signed-in account's private formal Projects, newest first. */
  const [cloudProjects, setCloudProjects] = useState<
    readonly CloudProjectSummary[]
  >([]);
  const [cloudProjectsReady, setCloudProjectsReady] = useState(false);
  const cloudListRequestRef = useRef(0);
  const cloudListMutationRef = useRef(0);
  const reloadCloudProjects = useCallback(async (): Promise<void> => {
    if (!projectStore) {
      setCloudProjectsReady(true);
      return;
    }
    const request = ++cloudListRequestRef.current;
    const mutationAtStart = cloudListMutationRef.current;
    const outcome = await projectStore.list();
    if (request !== cloudListRequestRef.current) return;
    setCloudProjectsReady(true);
    if (outcome.status !== "listed") return;
    // A Save or Delete acknowledged after this request began is newer than
    // the response, so the stale list must not erase that mutation.
    if (mutationAtStart !== cloudListMutationRef.current) return;
    setCloudProjects(outcome.projects);
  }, [projectStore]);
  // Account state owns access to the private Cloud Project
  // list shown by the File menu.
  useEffect(() => {
    let cancelled = false;
    if (!identity) return;
    void identity.getSessionUser().then(async (user) => {
      if (cancelled) return;
      setSessionUser(user);
      if (!user) {
        setCloudProjectsReady(true);
        return;
      }
      await reloadCloudProjects();
    });
    return () => {
      cancelled = true;
    };
  }, [identity, reloadCloudProjects]);

  useEffect(() => {
    if (!sessionUser) return;
    const refreshAfterReturning = () => void reloadCloudProjects();
    window.addEventListener("focus", refreshAfterReturning);
    return () => window.removeEventListener("focus", refreshAfterReturning);
  }, [sessionUser, reloadCloudProjects]);

  return {
    sessionUser,
    cloudProjects,
    setCloudProjects,
    cloudProjectsReady,
    cloudListMutationRef,
    reloadCloudProjects,
    noteCloudProjectSaved: (saved: CloudProjectSummary) => {
      cloudListMutationRef.current += 1;
      setCloudProjects((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ]);
    },
    noteCloudProjectsDeleted: (projects: readonly CloudProjectSummary[]) => {
      cloudListMutationRef.current += 1;
      setCloudProjects(projects);
    },
  };
}
