/**
 * The notebook build's startup gate: who the user is, before any editor
 * module that touches their data is loaded, and the end of the page when
 * the browser's notebook session changes. A state machine over injected
 * effects; entries/notebook.tsx wires the real ones.
 */
import type { GateScreen } from "./screens";
import { TOKEN_KEY, type Identification, type TokenRead } from "./session";

interface GateEffects<Modules> {
  /**
   * Called once, before the first token read; stays for the page's life.
   * `onConceal` is for a page entering the back/forward cache.
   */
  subscribe: (onChange: () => void, onConceal: () => void) => void;
  readToken: () => TokenRead;
  identify: (token: string) => Promise<Identification>;
  /** The editor modules: started only after a successful identification. */
  loadApp: () => Promise<Modules>;
  /**
   * Binds the page's browser storage to this user, once; throws when the
   * storage cannot be bound.
   */
  installStorage: (userId: string) => void;
  /** Installs the token's scoped fetch as the page's fetch; returns revoke. */
  installFetch: (token: string, onUnauthorized: () => void) => () => void;
  /** Builds the services and renders the editor; returns its unmount. */
  mountApp: (modules: Modules, token: string) => () => void;
  /** Runs the mounted editor's own page-hide handlers (it stores its work). */
  flushPage: () => void;
  /** Removes what the editor left outside its root after the unmount. */
  purgeOutsideRoot: () => void;
  /** Hides the page's content; `reveal` shows it again. */
  conceal: () => void;
  reveal: () => void;
  /** Waits, bounded, for the editor's storage writes; never rejects. */
  settleStorage: () => Promise<void>;
  showScreen: (screen: GateScreen, retry?: () => void) => void;
  reload: () => void;
}

function sameRead(a: TokenRead, b: TokenRead): boolean {
  return a.kind === "token"
    ? b.kind === "token" && a.token === b.token
    : a.kind === b.kind;
}

/** Runs one cleanup step; a failing step must not stop the ones after it. */
function attemptStep(step: () => void): void {
  try {
    step();
  } catch {
    // The page reloads anyway.
  }
}

export function startNotebookGate<Modules>(effects: GateEffects<Modules>) {
  let attempt = 0;
  /** An account change, once handled, makes every attempt stale for good. */
  let ended = false;
  /** The page is hidden for the back/forward cache. */
  let concealed = false;
  /** What the latest run read; a different read supersedes the run. */
  let runRead: TokenRead | null = null;
  let mounted: {
    token: string;
    revoke: () => void;
    unmount: () => void;
  } | null = null;

  function end(): void {
    if (ended || !mounted) return;
    ended = true;
    attempt += 1;
    const { revoke, unmount } = mounted;
    mounted = null;
    concealed = false;
    // In this order: no API request leaves once the session is gone; the
    // editor stores its unsaved work in the outgoing user's storage as when
    // the page is hidden; then it goes, and nothing of it is shown again.
    attemptStep(revoke);
    attemptStep(effects.flushPage);
    attemptStep(unmount);
    attemptStep(effects.purgeOutsideRoot);
    attemptStep(effects.reveal);
    attemptStep(() => effects.showScreen("account-changed"));
    // A bounded, best-effort wait for the writes just started; one reload.
    let settling: Promise<void>;
    try {
      settling = Promise.resolve(effects.settleStorage());
    } catch {
      settling = Promise.resolve();
    }
    void settling.then(
      () => effects.reload(),
      () => effects.reload(),
    );
  }

  function onUnauthorized(): void {
    end();
  }

  function onChange(): void {
    if (ended) return;
    const read = effects.readToken();
    if (mounted) {
      if (read.kind === "token" && read.token === mounted.token) {
        if (concealed) {
          concealed = false;
          effects.reveal();
        }
        return;
      }
      end();
      return;
    }
    // Nothing is installed before the mount, so nothing needs revoking.
    if (runRead && !sameRead(read, runRead)) void run();
  }

  function onConceal(): void {
    if (ended || !mounted) return;
    concealed = true;
    effects.conceal();
  }

  function retry(): void {
    if (!ended && !mounted) void run();
  }

  async function run(): Promise<void> {
    if (ended || mounted) return;
    attempt += 1;
    const id = attempt;
    const current = () => !ended && id === attempt;
    effects.showScreen("loading");
    const read = effects.readToken();
    runRead = read;
    if (read.kind === "none") return effects.showScreen("signed-out");
    if (read.kind === "unreadable") return effects.showScreen("error", retry);
    let identity: Identification;
    try {
      identity = await effects.identify(read.token);
    } catch {
      identity = { kind: "error" };
    }
    if (!current()) return;
    if (identity.kind === "signed-out") return effects.showScreen("signed-out");
    if (identity.kind === "error") return effects.showScreen("error", retry);
    const userId = identity.user.id;
    let modules: Modules;
    try {
      modules = await effects.loadApp();
    } catch {
      // No Retry: a document may keep a failed module load, so importing
      // the same modules again can fail after the network is back. The
      // screen asks for a reload instead.
      if (current()) effects.showScreen("error");
      return;
    }
    if (!current()) return;
    const again = effects.readToken();
    if (!sameRead(again, read)) {
      void run();
      return;
    }
    // Commit without yielding: only the user whose editor this document
    // mounts ever gets the page's storage, and only their token a scoped
    // fetch.
    try {
      effects.installStorage(userId);
    } catch {
      // The storage could not be bound to this user: nothing of the editor
      // may run in this document. Reloading the page starts over.
      ended = true;
      attempt += 1;
      effects.showScreen("error");
      return;
    }
    const revoke = effects.installFetch(read.token, onUnauthorized);
    let unmount: () => void;
    try {
      unmount = effects.mountApp(modules, read.token);
    } catch {
      // The fetch is installed but no editor came of it: end its authority
      // at once. A document installs a fetch only once, so there is no retry
      // here; reloading the page starts over.
      ended = true;
      attempt += 1;
      revoke();
      effects.showScreen("error");
      return;
    }
    mounted = { token: read.token, revoke, unmount };
  }

  effects.subscribe(onChange, onConceal);
  void run();
}

/**
 * The events after which the stored session may have changed: another
 * tab's write to the token key or a `localStorage.clear()` (key `null`),
 * and the page coming back into use. `onConceal` hears a page entering the
 * back/forward cache (a persisted `pagehide`); registered before the editor
 * mounts, it runs before the editor's own page-hide handlers.
 */
export function observeSessionEvents(
  page: Pick<Window, "addEventListener"> & {
    document: Pick<Document, "addEventListener" | "visibilityState">;
  },
  onChange: () => void,
  onConceal: () => void = () => {},
): void {
  page.addEventListener("storage", (event) => {
    if (event.key === TOKEN_KEY || event.key === null) onChange();
  });
  page.addEventListener("focus", () => onChange());
  page.document.addEventListener("visibilitychange", () => {
    if (page.document.visibilityState === "visible") onChange();
  });
  page.addEventListener("pageshow", (event) => {
    if (event.persisted) onChange();
  });
  page.addEventListener("pagehide", (event) => {
    if (event.persisted) onConceal();
  });
}
