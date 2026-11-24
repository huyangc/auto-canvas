// The workspace Agent provider as the editor uses it, with the Agent
// runtime's chunk load as the one scripted boundary (#1673). The runtime
// itself is the real one; the relay's answers are scripted at fetch, and
// React runs against a minimal stand-in for the page's DOM.
import { act, useMemo } from "react";
import type { Root } from "react-dom/client";
import { AGENT_SESSION_PROTOCOL_VERSION } from "@icm/agent-adapter";
import { createEmptyProject } from "@icm/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorDocumentController } from "../document/document-controller";
import { loadAgentRuntime, type AgentRuntime } from "./agent-runtime-loader";
import { readAgentSessionRecovery } from "./session-recovery";
import { AGENT_SESSION_RECOVERY_STORAGE_KEY } from "./session-recovery-presence";
import type { UseAgentSessionResult } from "./use-agent-session";
import {
  useEditorAgentSession,
  useWorkspaceAgentRuntime,
  WorkspaceAgentProvider,
} from "./workspace-agent";

vi.mock("./agent-runtime-loader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-runtime-loader")>()),
  loadAgentRuntime: vi.fn(),
  loadedAgentRuntime: () => null,
}));

const realRuntime = () => import("./agent-runtime");
const project = createEmptyProject("project-main", "Main");

/** A sessionStorage the test can read back. */
class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

/**
 * A relay socket that never opens by itself: most tests stop at the claim.
 * A test that needs the relay opens it and delivers frames.
 */
class ClosedSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: ClosedSocket[] = [];
  readyState = 0;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  constructor() {
    ClosedSocket.instances.push(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener() {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  emit(type: string, event: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

/** The newest relay socket, opened, as the relay accepting the editor. */
async function openRelay(): Promise<ClosedSocket> {
  const socket = ClosedSocket.instances.at(-1)!;
  await act(async () => {
    socket.readyState = 1;
    socket.emit("open");
  });
  return socket;
}

/** The relay acknowledging the editor's latest heartbeat. */
async function acknowledge(socket: ClosedSocket) {
  const heartbeat = JSON.parse(socket.sent.at(-1)!);
  await act(async () =>
    socket.emit("message", {
      data: JSON.stringify({
        protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
        sessionId: heartbeat.sessionId,
        kind: "heartbeat-ack",
        nonce: heartbeat.nonce,
        contextRevision: heartbeat.contextRevision,
      }),
    }),
  );
}

/** A relay session event, as the relay pushes it to the editor. */
async function relayEvent(
  socket: ClosedSocket,
  payload: { type: string; sessionId: string; expiresAt?: string },
) {
  await act(async () =>
    socket.emit("message", {
      data: JSON.stringify({
        protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
        sessionId: payload.sessionId,
        messageId: `message-${Math.random().toString(36).slice(2)}`,
        requestId: `event-${payload.type}`,
        sentAt: new Date().toISOString(),
        kind: "event",
        payload,
      }),
    }),
  );
}

let storage: MemoryStorage;
let sessionCreations: number;
let root: Root | null;
let seen: { session: UseAgentSessionResult | null };
/** The working copy the test's editor binds, as a tab supplies it. */
let boundWorkingCopy: string;
/** Whether the editor has built its hosts from the loaded runtime. */
let bound: boolean;
/** The relay's answer to a status check; tests may hold it. */
let statusReply: () => Promise<Response>;
let statusRequests: number;

function relay(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  if (url === "/api/agent/sessions" && init?.method === "POST") {
    sessionCreations += 1;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          session: {
            sessionId: `session-${sessionCreations}`,
            editorSecret: "editor-secret",
            claimCode: `CLAIM-${sessionCreations}`,
            claimExpiresAt: Date.now() + 600_000,
            expiresAt: Date.now() + 3_600_000,
          },
        }),
        { status: 201, headers: { date: new Date().toUTCString() } },
      ),
    );
  }
  // A recovered session past its deadline asks the server before it
  // connects; the answer renews the proof.
  if (url.endsWith("/status")) {
    statusRequests += 1;
    return statusReply();
  }
  return Promise.resolve(new Response("{}", { status: 503 }));
}

beforeEach(() => {
  storage = new MemoryStorage();
  sessionCreations = 0;
  boundWorkingCopy = "tab-1";
  bound = false;
  statusRequests = 0;
  ClosedSocket.instances = [];
  statusReply = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          authorization: "active",
          expiresAt: Date.now() + 7_200_000,
        }),
        { status: 200 },
      ),
    );
  seen = { session: null };
  root = null;
  const page = {
    location: { href: "http://127.0.0.1/editor", search: "" },
    sessionStorage: storage,
    HTMLIFrameElement: class {},
    addEventListener() {},
    removeEventListener() {},
    setInterval,
    clearInterval,
  };
  const document = {
    nodeType: 9,
    activeElement: null,
    visibilityState: "visible",
    defaultView: page,
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("window", page);
  vi.stubGlobal("document", document);
  vi.stubGlobal("HTMLIFrameElement", page.HTMLIFrameElement);
  vi.stubGlobal("WebSocket", ClosedSocket);
  vi.stubGlobal("fetch", vi.fn(relay));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The chunk failure is logged for diagnosis; the test reads the panel.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(loadAgentRuntime).mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The editor's part: build hosts once the runtime is there, and bind them. */
function Editor() {
  const runtime = useWorkspaceAgentRuntime();
  const workingCopy = boundWorkingCopy;
  // A tab switch brings its own host, as the editor's tabs do.
  const host = useMemo(
    () =>
      runtime
        ? new runtime.BrowserAgentHost(new EditorDocumentController(project))
        : null,
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- a new working copy is a new host
    [runtime, workingCopy],
  );
  bound = host !== null;
  seen.session = useEditorAgentSession(
    host
      ? {
          enabled: true,
          recover: true,
          project,
          projectSessionId: workingCopy,
          host,
        }
      : null,
  );
  return null;
}

/** Re-render the page: with the editor (as `workingCopy`) or without (Gallery). */
async function showPage(editor: boolean) {
  await act(async () =>
    root!.render(
      <WorkspaceAgentProvider enabled>
        {editor ? <Editor /> : null}
      </WorkspaceAgentProvider>,
    ),
  );
}

async function switchTab(workingCopy: string) {
  boundWorkingCopy = workingCopy;
  await showPage(true);
}

async function reloadPage() {
  await act(async () => root!.unmount());
  root = null;
  await openEditor();
}

const storedProof = () =>
  JSON.parse(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY) ?? "null");

const proofFor = (workingCopy: string, expiresAt = Date.now() + 3_600_000) => ({
  version: 1,
  sessionId: `saved-${workingCopy}`,
  editorSecret: "editor-secret",
  projectId: "project-main",
  projectSessionId: workingCopy,
  scopes: ["circuit.snapshot"],
  expiresAt,
});

async function openEditor() {
  const container = {
    nodeType: 1,
    nodeName: "DIV",
    tagName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document,
    addEventListener() {},
    removeEventListener() {},
  };
  const { createRoot } = await import("react-dom/client");
  root = createRoot(container as unknown as Element);
  await act(async () =>
    root!.render(
      <WorkspaceAgentProvider enabled>
        <Editor />
      </WorkspaceAgentProvider>,
    ),
  );
}

/** What the Connect Agent control does on a session that is not connected. */
async function clickConnect() {
  await act(async () => void seen.session!.newConnection());
}

/** Let loads, effects and the relay's answers run. */
async function settle(until: () => void) {
  await vi.waitFor(async () => {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    until();
  });
}

function deferredRuntime() {
  let release!: () => Promise<void>;
  vi.mocked(loadAgentRuntime).mockImplementationOnce(
    () =>
      new Promise<AgentRuntime>((resolve) => {
        release = async () => resolve(await realRuntime());
      }),
  );
  return () => release();
}

describe("workspace Agent provider (#1673)", () => {
  it("loads nothing for an editor that is not connecting", async () => {
    await openEditor();
    expect(seen.session).toMatchObject({
      status: "idle",
      pendingOperation: null,
      error: null,
    });
    expect(loadAgentRuntime).not.toHaveBeenCalled();
  });

  it("loads the runtime on Connect Agent and connects once the editor binds", async () => {
    const release = deferredRuntime();
    await openEditor();
    await clickConnect();
    // Preparing, as the moment Connect started a connection before.
    expect(seen.session).toMatchObject({
      status: "creating",
      pendingOperation: "creating",
    });
    expect(loadAgentRuntime).toHaveBeenCalledOnce();
    await act(release);
    await settle(() => expect(seen.session!.claimCode).toBe("CLAIM-1"));
    expect(sessionCreations).toBe(1);
    expect(seen.session!.status).not.toBe("idle");
  });

  it("shows a runtime that could not load, then retries on the next click", async () => {
    vi.mocked(loadAgentRuntime).mockRejectedValueOnce(
      new TypeError("Failed to fetch dynamically imported module"),
    );
    await openEditor();
    await clickConnect();
    await settle(() =>
      expect(seen.session).toMatchObject({
        status: "idle",
        pendingOperation: null,
        error: expect.stringContaining("The Agent connection could not load"),
      }),
    );
    expect(sessionCreations).toBe(0);

    vi.mocked(loadAgentRuntime).mockImplementationOnce(realRuntime);
    await clickConnect();
    expect(seen.session).toMatchObject({ status: "creating", error: null });
    await settle(() => expect(seen.session!.claimCode).toBe("CLAIM-1"));
    expect(sessionCreations).toBe(1);
  });

  it("starts no connection when cancelled while preparing", async () => {
    const release = deferredRuntime();
    await openEditor();
    await clickConnect();
    expect(seen.session!.status).toBe("creating");
    // Cancel connection.
    await act(async () => void seen.session!.revoke());
    expect(seen.session).toMatchObject({
      status: "idle",
      pendingOperation: null,
    });
    await act(release);
    await settle(() => expect(seen.session!.status).toBe("idle"));
    expect(sessionCreations).toBe(0);
  });

  it("resumes a saved session rather than replacing it when Connect loads the runtime", async () => {
    const saved = {
      version: 1,
      sessionId: "saved-session",
      editorSecret: "editor-secret",
      projectId: "project-main",
      projectSessionId: "tab-1",
      scopes: ["circuit.snapshot"],
      expiresAt: Date.now() + 3_600_000,
    };
    storage.setItem(AGENT_SESSION_RECOVERY_STORAGE_KEY, JSON.stringify(saved));
    // The load the saved session starts as the page opens fails.
    vi.mocked(loadAgentRuntime).mockRejectedValueOnce(
      new TypeError("Failed to fetch dynamically imported module"),
    );
    await openEditor();
    await settle(() =>
      expect(seen.session!.error).toContain(
        "The Agent connection could not load",
      ),
    );

    vi.mocked(loadAgentRuntime).mockImplementationOnce(realRuntime);
    await clickConnect();
    await settle(() => expect(seen.session!.status).toBe("reconnecting"));
    // Let the bound editor's effects and the resume run their course.
    for (let tick = 0; tick < 5; tick++) await settle(() => {});
    expect(seen.session!.status).toBe("reconnecting");
    expect(sessionCreations).toBe(0);
    expect(
      JSON.parse(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY)!),
    ).toMatchObject({ sessionId: "saved-session" });
  });

  it("writes a renewed proof under the working copy, not this mount's nonce", async () => {
    // The next mount binds the same working copy under a new nonce. A proof
    // kept under the nonce would never match again, so renewal must keep the
    // working copy's id.
    const saved = {
      version: 1,
      sessionId: "saved-session",
      editorSecret: "editor-secret",
      projectId: "project-main",
      projectSessionId: "tab-1",
      scopes: ["circuit.snapshot"],
      expiresAt: Date.now() - 1_000,
    };
    storage.setItem(AGENT_SESSION_RECOVERY_STORAGE_KEY, JSON.stringify(saved));
    vi.mocked(loadAgentRuntime).mockImplementation(realRuntime);
    await openEditor();
    await settle(() => expect(bound).toBe(true));
    await settle(() => expect(seen.session!.status).toBe("reconnecting"));
    // The deadline passed, so the transport renews it through /status and the
    // proof is written back.
    await settle(() =>
      expect(
        JSON.parse(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY)!)
          .expiresAt,
      ).toBeGreaterThan(saved.expiresAt),
    );
    expect(
      JSON.parse(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY)!),
    ).toMatchObject({
      sessionId: "saved-session",
      projectSessionId: "tab-1",
    });
  });

  it("never resumes another working copy's saved session", async () => {
    // ?new=1 beside restored tabs: the blank tab is active, so the editor
    // binds under a working copy whose own proof does not exist, while the
    // tab it was opened beside keeps one.
    const otherTab = {
      version: 1,
      sessionId: "saved-session",
      editorSecret: "editor-secret",
      projectId: "project-main",
      projectSessionId: "tab-other",
      scopes: ["circuit.snapshot"],
      expiresAt: Date.now() + 3_600_000,
    };
    storage.setItem(
      AGENT_SESSION_RECOVERY_STORAGE_KEY,
      JSON.stringify(otherTab),
    );
    boundWorkingCopy = "tab-new";
    vi.mocked(loadAgentRuntime).mockImplementation(realRuntime);
    await openEditor();
    // The page loads the runtime for the stored proof, the editor binds
    // under the new tab, and the automatic recovery finds nothing for it.
    await settle(() => expect(bound).toBe(true));
    expect(loadAgentRuntime).toHaveBeenCalled();
    expect(seen.session).toMatchObject({ status: "idle" });
    expect(sessionCreations).toBe(0);

    // Connect creates a connection rather than adopting the other tab's proof.
    await clickConnect();
    await settle(() => expect(seen.session!.claimCode).toBe("CLAIM-1"));
    expect(sessionCreations).toBe(1);
    // The other tab's record is left where its own tab can still use it.
    expect(
      JSON.parse(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY)!),
    ).toMatchObject({
      sessionId: "saved-session",
      projectSessionId: "tab-other",
    });
  });
  it("keeps the working copy in the proof while the Gallery holds the session", async () => {
    storage.setItem(
      AGENT_SESSION_RECOVERY_STORAGE_KEY,
      JSON.stringify(proofFor("tab-1")),
    );
    vi.mocked(loadAgentRuntime).mockImplementation(realRuntime);
    await openEditor();
    await settle(() => expect(ClosedSocket.instances.length).toBe(1));
    const socket = await openRelay();
    await acknowledge(socket);
    await settle(() => expect(seen.session!.status).toBe("connected"));

    // To the Gallery: the placeholder context serves no working copy.
    await showPage(false);
    await acknowledge(socket);
    const renewedAt = Date.now() + 9_000_000;
    await relayEvent(socket, {
      type: "session.renewed",
      sessionId: "saved-tab-1",
      expiresAt: new Date(renewedAt).toISOString(),
    });
    expect(storedProof()).toMatchObject({
      sessionId: "saved-tab-1",
      projectId: "project-main",
      projectSessionId: "tab-1",
      expiresAt: renewedAt,
    });

    // A reload on that working copy resumes the pairing rather than replacing it.
    await reloadPage();
    await settle(() => expect(seen.session!.status).toBe("reconnecting"));
    for (let tick = 0; tick < 3; tick++) await settle(() => {});
    expect(sessionCreations).toBe(0);
    expect(storedProof()).toMatchObject({ sessionId: "saved-tab-1" });
  });

  it("a disconnect retires only the session it ends", async () => {
    // A keeps a saved proof; B starts a new connection; back on A, the person
    // disconnects B's session.
    storage.setItem(
      AGENT_SESSION_RECOVERY_STORAGE_KEY,
      JSON.stringify(proofFor("tab-A")),
    );
    boundWorkingCopy = "tab-B";
    vi.mocked(loadAgentRuntime).mockImplementation(realRuntime);
    await openEditor();
    await settle(() => expect(bound).toBe(true));
    await clickConnect();
    await settle(() => expect(seen.session!.claimCode).toBe("CLAIM-1"));
    const socket = await openRelay();
    await acknowledge(socket);
    await relayEvent(socket, { type: "session.ready", sessionId: "session-1" });
    expect(seen.session!.status).toBe("connected");
    const proof = (projectSessionId: string) =>
      readAgentSessionRecovery(storage, {
        projectId: "project-main",
        projectSessionId,
        now: Date.now(),
      });
    expect(proof("tab-B")?.sessionId).toBe("session-1");
    await switchTab("tab-C");
    await acknowledge(socket);
    expect(proof("tab-C")?.sessionId).toBe("session-1");
    expect(proof("tab-B")).toBeNull();
    expect(proof("tab-A")?.sessionId).toBe("saved-tab-A");
    await switchTab("tab-A");
    await act(async () => void seen.session!.revoke());
    await settle(() => expect(seen.session!.status).toBe("revoked"));
    expect(storedProof()).toMatchObject({
      sessionId: "saved-tab-A",
      projectSessionId: "tab-A",
    });
    await reloadPage();
    await settle(() => expect(seen.session!.status).toBe("reconnecting"));
    const resumed = await openRelay();
    await acknowledge(resumed);
    expect(JSON.parse(resumed.sent.at(-1)!)).toMatchObject({
      sessionId: "saved-tab-A",
    });
    expect(seen.session!.status).toBe("connected");
    expect(sessionCreations).toBe(1);
  });

  it("a session the relay ends takes its own proof, whichever tab is shown", async () => {
    // A's session resumes and asks the relay whether it still stands; the
    // person switches to B before the answer, which is that it was revoked.
    storage.setItem(
      AGENT_SESSION_RECOVERY_STORAGE_KEY,
      JSON.stringify(proofFor("tab-A", Date.now() - 1_000)),
    );
    let answer!: (response: Response) => void;
    statusReply = () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      });
    boundWorkingCopy = "tab-A";
    vi.mocked(loadAgentRuntime).mockImplementation(realRuntime);
    await openEditor();
    await settle(() => expect(statusRequests).toBe(1));
    await switchTab("tab-B");
    await act(async () =>
      answer(
        new Response(
          JSON.stringify({ ok: false, error: { code: "SESSION_REVOKED" } }),
          { status: 410 },
        ),
      ),
    );
    await settle(() => expect(seen.session!.status).toBe("revoked"));
    expect(storedProof()).toBeNull();
  });

  it("a relay revocation event takes its own proof, whichever tab is shown", async () => {
    storage.setItem(
      AGENT_SESSION_RECOVERY_STORAGE_KEY,
      JSON.stringify(proofFor("tab-A")),
    );
    boundWorkingCopy = "tab-A";
    vi.mocked(loadAgentRuntime).mockImplementation(realRuntime);
    await openEditor();
    await settle(() => expect(ClosedSocket.instances.length).toBe(1));
    const socket = await openRelay();
    await switchTab("tab-B");
    await relayEvent(socket, {
      type: "session.revoked",
      sessionId: "saved-tab-A",
    });
    await settle(() => expect(seen.session!.status).toBe("revoked"));
    expect(storedProof()).toBeNull();
  });
});
