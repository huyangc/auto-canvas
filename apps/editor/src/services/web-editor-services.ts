import { fetchSessionUser } from "../components/account";
import {
  CLOUD_PROJECT_LIMIT,
  deleteCloudProject,
  listCloudProjects,
  openCloudProject,
  saveCloudProject,
} from "../features/editor-shell/cloud-projects";
import { browserExportDelivery } from "../hosts/browser-export-delivery";
import type { EditorServices } from "./editor-services";
import { createProjectSnapshotSerializer } from "../document/project-snapshot-serializer";

/** Creating the Web services does not start requests or subscriptions. */
export function createWebEditorServices(
  fetchLike?: typeof fetch,
): EditorServices & {
  identity: NonNullable<EditorServices["identity"]>;
  projectStore: NonNullable<EditorServices["projectStore"]>;
  projectSerializer: NonNullable<EditorServices["projectSerializer"]>;
} {
  const projectSerializer = createProjectSnapshotSerializer();
  let projectLimit = CLOUD_PROJECT_LIMIT;
  return {
    projectSerializer,
    identity: { getSessionUser: () => fetchSessionUser(fetchLike) },
    projectStore: {
      kind: "cloud",
      get limit() {
        return projectLimit;
      },
      list: async () => {
        const outcome = await listCloudProjects(fetchLike);
        if (outcome.status === "listed")
          projectLimit = outcome.limit ?? CLOUD_PROJECT_LIMIT;
        return outcome;
      },
      open: (id) => openCloudProject(id, fetchLike),
      save: (project, binding, galleryEntryId) =>
        saveCloudProject(
          project,
          binding,
          fetchLike,
          galleryEntryId,
          projectSerializer.serialize,
        ),
      delete: (id) => deleteCloudProject(id, fetchLike),
    },
    exportDelivery: browserExportDelivery,
    capabilities: {
      userComponents: true,
      agent: true,
      externalLinks: true,
    },
  } satisfies EditorServices;
}
