import {
  AGENT_API_VERSION,
  type AgentNetlistCellRead,
  type AgentNetlistRead,
  type AgentProjectResourceRequest,
  type AgentProjectResourceResponse,
} from "@icm/agent-adapter";
import type {
  ProjectStructureEdit,
  ProjectTransactionResult,
} from "@icm/edit-engine";
import { planProjectCellImport } from "@icm/edit-engine";
import type { CircuitProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";

import {
  listCloudProjects,
  type CloudProjectListOutcome,
} from "../features/editor-shell/cloud-projects";
import {
  loadCloudProjectForCellImport,
  type CloudCellImportLoadResult,
} from "../features/hierarchy/cloud-cell-import";
import { planNetlistCodeEdit } from "../features/netlist-export/netlist-code-edit";
import { importChunk } from "../components/chunk-import";
import { handleAgentComponents } from "./browser-agent-components";

export interface BrowserAgentProjectHostOptions {
  isProjectAvailable?: () => boolean;
  loadProjectCode?: () => Promise<
    typeof import("../features/project-code/project-code")
  >;
  workspace?: (
    request: Extract<AgentProjectResourceRequest, { operation: "workspace" }>,
  ) => Promise<AgentProjectResourceResponse>;
  getProjectSessionId: () => string;
  getProject: () => CircuitProject;
  getActiveDocumentId: () => string;
  commitProjectStructure: (
    project: CircuitProject,
    activeDocumentId: string,
  ) => void;
  fetch?: typeof fetch;
  listProjects?: () => Promise<CloudProjectListOutcome>;
  loadProject?: (cloudProjectId: string) => Promise<CloudCellImportLoadResult>;
  dispatchProjectTransaction: (request: {
    transactionId: string;
    projectId: string;
    expectedStructureRevision: number;
    actor: { kind: "agent"; id: string };
    edits: ProjectStructureEdit[];
  }) => ProjectTransactionResult;
}

/** Browser authority for the signed-in Cloud Project shelf and live Project. */
export class BrowserAgentProjectHost {
  private readonly boundProjectSessionId: string;

  constructor(private readonly options: BrowserAgentProjectHostOptions) {
    this.boundProjectSessionId = options.getProjectSessionId();
  }

  async handle(
    request: AgentProjectResourceRequest,
  ): Promise<AgentProjectResourceResponse> {
    let projectCode:
      typeof import("../features/project-code/project-code") | null = null;
    if (
      request.operation === "read-project-code" ||
      request.operation === "replace-project-code"
    ) {
      try {
        projectCode = await importChunk(
          "Project Code",
          this.options.loadProjectCode ??
            (() => import("../features/project-code/project-code")),
        );
      } catch {
        // importChunk retains the original cause in the browser console. A load
        // failure is not proof of a stale deployment, nor a failed code commit.
        return this.error(
          request,
          "PROJECT_FEATURE_LOAD_FAILED",
          "Project Code could not load; no edit was attempted. Check connectivity and save work before refreshing the Editor page. Repeating this tool call may not recover a stale page. The browser console contains the load cause; the Agent session remains usable.",
          "refresh",
        );
      }
    }
    // Load before checking session/revision, so a change during the deferred
    // import cannot apply an old request to a replacement Project.
    if (request.operation === "workspace") {
      return this.options.workspace
        ? this.options.workspace(request)
        : this.error(
            request,
            "WORKSPACE_UNAVAILABLE",
            "Open the Editor to access its workspace",
            "retry",
          );
    }
    if (this.options.getProjectSessionId() !== this.boundProjectSessionId) {
      return this.error(
        request,
        "PROJECT_REPLACED",
        "The Agent session is bound to a Project that has been replaced",
        "refresh",
      );
    }
    if (request.operation === "components") {
      return handleAgentComponents(
        request,
        this.options,
        () => this.options.getProjectSessionId() === this.boundProjectSessionId,
      );
    }
    if (
      request.operation === "list-gallery" ||
      request.operation === "read-gallery-entry" ||
      request.operation === "read-gallery-entries" ||
      request.operation === "insert-gallery-entry" ||
      request.operation === "publish-gallery-entry" ||
      request.operation === "update-gallery-entry"
    )
      return this.error(
        request,
        "GALLERY_UNAVAILABLE",
        "Community operations are unavailable in this editor",
        "fix-input",
      );
    if (request.operation === "read-project-code") {
      const project = this.options.getProject();
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        projectCode: projectCode!.formatProjectCode(project),
        structureRevision: project.structureRevision,
      };
    }
    if (request.operation === "replace-project-code") {
      const current = this.options.getProject();
      if (current.structureRevision !== request.expectedStructureRevision) {
        return this.stale(request, current.structureRevision);
      }
      const plan = projectCode!.planProjectCodeCommit(
        current,
        request.projectCode,
        this.options.getActiveDocumentId(),
      );
      if (!plan.ok) {
        return this.error(
          request,
          "PROJECT_CODE_INVALID",
          plan.message,
          "fix-input",
        );
      }
      if (plan.changed) {
        try {
          this.options.commitProjectStructure(
            plan.project,
            plan.activeDocumentId,
          );
        } catch (error) {
          return this.error(
            request,
            "PROJECT_CODE_COMMIT_FAILED",
            error instanceof Error ? error.message : String(error),
            "refresh",
          );
        }
      }
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        applied: plan.changed,
        structureRevision: this.options.getProject().structureRevision,
        activeDocumentId: plan.activeDocumentId,
      };
    }
    if (request.operation === "read-netlist") {
      const project = this.options.getProject();
      const rootDocumentId = request.documentId ?? request.rootDocumentId;
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        structureRevision: project.structureRevision,
        netlist: this.readNetlist(project, {
          ...request,
          ...(rootDocumentId ? { rootDocumentId } : {}),
        }),
        cells: project.documents.map((document) =>
          this.readNetlistCell(project, document.id, request),
        ),
      };
    }
    if (request.operation === "replace-netlist") {
      return this.replaceNetlist(request);
    }
    if (request.operation === "list-projects") {
      const listed = await (this.options.listProjects ?? listCloudProjects)();
      if (listed.status !== "listed") {
        return this.error(
          request,
          listed.status === "signed-out"
            ? "SIGN_IN_REQUIRED"
            : "CLOUD_UNAVAILABLE",
          listed.status === "signed-out"
            ? "Sign in to inspect Cloud Project Cells"
            : listed.message,
          listed.status === "signed-out" ? "sign-in" : "retry",
        );
      }
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        projects: listed.projects.map((project) => ({ ...project })),
      };
    }

    const loaded = await (
      this.options.loadProject ?? loadCloudProjectForCellImport
    )(request.cloudProjectId);
    if (!loaded.ok) {
      return this.error(
        request,
        "SOURCE_PROJECT_UNAVAILABLE",
        loaded.message,
        loaded.message.includes("Sign in") ? "sign-in" : "retry",
      );
    }
    if (request.operation === "list-cells") {
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        project: {
          id: request.cloudProjectId,
          name: loaded.project.name,
        },
        cells: loaded.project.documents.map((document) => ({
          documentId: document.id,
          name: document.name,
          netlistName: document.netlist?.name ?? null,
          formalPorts:
            document.netlist?.terminals.map(({ name, direction }) => ({
              name,
              direction,
            })) ?? [],
        })),
      };
    }

    const destination = this.options.getProject();
    if (destination.structureRevision !== request.expectedStructureRevision) {
      return this.error(
        request,
        "STALE_STRUCTURE_REVISION",
        `Expected Project structure revision ${request.expectedStructureRevision}, current revision is ${destination.structureRevision}`,
        "refresh",
      );
    }
    const plan = planProjectCellImport(
      destination,
      loaded.project,
      request.sourceDocumentId,
    );
    if (!plan.ok) {
      return this.error(request, plan.code, plan.message, "fix-input");
    }
    if (plan.status === "already-imported") {
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        status: plan.status,
        rootDocumentId: plan.rootDocumentId,
        importedDocumentIds: [...plan.importedDocumentIds],
        structureRevision: destination.structureRevision,
      };
    }
    const result = this.options.dispatchProjectTransaction({
      transactionId: `agent-import-cell-${request.requestId}`,
      projectId: destination.id,
      expectedStructureRevision: request.expectedStructureRevision,
      actor: { kind: "agent", id: "project-resource" },
      edits: [...plan.edits],
    });
    if (!result.ok) {
      return this.error(
        request,
        result.error.code,
        result.diagnostics[0]?.message ?? result.error.message,
        result.error.code.includes("STALE") ? "refresh" : "fix-input",
      );
    }
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      status: "imported",
      rootDocumentId: plan.rootDocumentId,
      importedDocumentIds: [...plan.importedDocumentIds],
      structureRevision: result.structureRevision,
    };
  }

  /**
   * Every AI account's entries, rejected and withdrawn ones with their status
   * and reason, for an AI account to redo and take over (#1540). The Gallery
   * answers them in one list, newest first; the cursor is an offset into it.
   */
  private replaceNetlist(
    request: Extract<
      AgentProjectResourceRequest,
      { operation: "replace-netlist" }
    >,
  ): AgentProjectResourceResponse {
    const project = this.options.getProject();
    if (project.structureRevision !== request.expectedStructureRevision) {
      return this.stale(request, project.structureRevision);
    }
    const rootDocumentId = request.documentId ?? request.rootDocumentId;
    const baseline = createDesignNetlistExport(project, {
      format: request.format ?? "spice",
      namingProfile: request.namingProfile ?? "native",
      ...(request.portCase ? { portCase: request.portCase } : {}),
      includeLocations: true,
      ...(rootDocumentId ? { rootDocumentId } : {}),
    });
    if (baseline.status !== "ready") {
      return this.error(
        request,
        "NETLIST_BLOCKED",
        baseline.diagnostics[0]?.message ??
          "The current Project cannot generate an editable netlist",
        "fix-input",
      );
    }
    const plan = planNetlistCodeEdit(project, baseline, request.netlist);
    if (!plan.ok) {
      return this.error(
        request,
        "NETLIST_EDIT_INVALID",
        plan.message,
        "fix-input",
      );
    }
    if (!plan.edits.length) {
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        applied: false,
        structureRevision: project.structureRevision,
      };
    }
    const result = this.options.dispatchProjectTransaction({
      transactionId: `agent-replace-netlist-${request.requestId}`,
      projectId: project.id,
      expectedStructureRevision: request.expectedStructureRevision,
      actor: { kind: "agent", id: "project-resource" },
      edits: plan.edits,
    });
    if (!result.ok) {
      return this.error(
        request,
        result.error.code,
        result.diagnostics[0]?.message ?? result.error.message,
        result.error.code.includes("STALE") ? "refresh" : "fix-input",
      );
    }
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      applied: result.applied,
      structureRevision: result.structureRevision,
    };
  }

  private readNetlist(
    project: CircuitProject,
    options: {
      format?: "spice" | "spectre" | undefined;
      namingProfile?: "native" | "cadence-bang" | undefined;
      portCase?: "lower" | "upper" | undefined;
      rootDocumentId?: string | undefined;
    },
  ): AgentNetlistRead {
    const format = options.format ?? "spice";
    const result = createDesignNetlistExport(project, {
      format,
      namingProfile: options.namingProfile ?? "native",
      ...(options.portCase ? { portCase: options.portCase } : {}),
      ...(options.rootDocumentId
        ? { rootDocumentId: options.rootDocumentId }
        : {}),
    });
    return {
      documentId: options.rootDocumentId ?? project.topDocumentId,
      format,
      status: result.status,
      text: result.status === "ready" ? result.file.text : null,
      diagnostics: result.diagnostics.map(
        ({ severity, code, message, objectIds }) => ({
          severity,
          code,
          message,
          objectIds: [...objectIds],
        }),
      ),
    };
  }

  private readNetlistCell(
    project: CircuitProject,
    documentId: string,
    options: {
      format?: "spice" | "spectre" | undefined;
      namingProfile?: "native" | "cadence-bang" | undefined;
      portCase?: "lower" | "upper" | undefined;
    },
  ): AgentNetlistCellRead {
    const netlist = this.readNetlist(project, {
      ...options,
      rootDocumentId: documentId,
    });
    return { ...netlist, documentId };
  }

  private stale(
    request: AgentProjectResourceRequest,
    currentRevision: number,
  ): AgentProjectResourceResponse {
    return this.error(
      request,
      "STALE_STRUCTURE_REVISION",
      `Expected Project structure revision ${"expectedStructureRevision" in request ? request.expectedStructureRevision : "unknown"}, current revision is ${currentRevision}`,
      "refresh",
    );
  }

  private error(
    request: AgentProjectResourceRequest,
    code: string,
    message: string,
    recovery: "sign-in" | "refresh" | "fix-input" | "retry",
  ): AgentProjectResourceResponse {
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: false,
      error: { code, message, recovery },
    };
  }
}
