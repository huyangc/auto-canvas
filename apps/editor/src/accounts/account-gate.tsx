import { useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { apiUrl } from "../lib/app-url";
import { ACCOUNT_SESSION_ENDING, bindAccountStorage } from "./storage";
import { AccountContext } from "./account-context";
import "./accounts.css";

import { identify } from "./session";

const eventKey = () => `auto-canvas:session:${import.meta.env.BASE_URL}`;
function announce() {
  try {
    localStorage.setItem(
      eventKey(),
      Array.from(crypto.getRandomValues(new Uint32Array(2))).join("-"),
    );
  } catch {
    /* Storage may be disabled. */
  }
}

function Credentials({ onSuccess }: { onSuccess(): void }) {
  const [register, setRegister] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      const res = await fetch(
        apiUrl(register ? "auth/register" : "auth/login"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            username: data.get("username"),
            password: data.get("password"),
          }),
        },
      );
      if (!res.ok) {
        setError((await res.json()).error || "Please try again.");
        return;
      }
      announce();
      onSuccess();
    } catch {
      setError("Cannot reach the account server.");
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="canvas-account-screen">
      <form
        className="canvas-account-form"
        onSubmit={(event) => void submit(event)}
      >
        <span>Auto Canvas</span>
        <h1>{register ? "Create an account" : "Sign in"}</h1>
        <label>
          Username
          <input
            required
            autoFocus
            name="username"
            pattern="[A-Za-z][0-9]{8}"
            maxLength={9}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby="username-format"
          />
        </label>
        <small id="username-format">
          One letter followed by eight digits, e.g. A12345678.
        </small>
        <label>
          Password
          <input
            key={register ? "new" : "existing"}
            required
            name="password"
            type="password"
            minLength={8}
            maxLength={128}
            autoComplete={register ? "new-password" : "current-password"}
          />
        </label>
        {register && <small>Use 8–128 characters.</small>}
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={pending}>
          {register ? "Register" : "Sign in"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register ? "Back to sign in" : "Create an account"}
        </button>
      </form>
    </main>
  );
}

export function mountAccountGate(
  container: HTMLElement,
  editor: () => ReactNode,
) {
  const root = createRoot(container);
  let generation = 0;
  let active: string | undefined;
  let closing = false;
  let prepare: (() => Promise<void>) | null = null;
  let lockedScreen: HTMLElement | undefined;
  const nativeFetch = window.fetch.bind(window);
  const reload = () => {
    // Unmount first to flush this account's workspace and release unload guards.
    closing = true;
    active = undefined;
    root.unmount();
    window.location.reload();
  };
  // The editor also listens on window for export and clipboard shortcuts.
  window.addEventListener(
    "keydown",
    (event) => {
      if (closing) event.stopImmediatePropagation();
    },
    true,
  );
  const resumeOwner = async () => {
    const screen = lockedScreen;
    const verification = ++generation;
    if (!screen || !active) return;
    try {
      const res = await nativeFetch(apiUrl("session"), {
        cache: "no-store",
        redirect: "error",
      });
      if (
        !res.ok ||
        (await res.json()).user?.id !== active ||
        lockedScreen !== screen ||
        verification !== generation
      )
        return;
      screen.remove();
      lockedScreen = undefined;
      container.hidden = false;
      container.inert = false;
      closing = false;
    } catch {
      /* Keep this tab locked until its owner authenticates again. */
    }
  };
  const sessionChanged = async () => {
    if (lockedScreen) return resumeOwner();
    if (closing) return;
    if (!active || !prepare) return reload();
    // Hide the old drawing and stop its account requests immediately. Retain the
    // live workspace if persistence fails, so its owner can return and export it.
    window.dispatchEvent(new Event(ACCOUNT_SESSION_ENDING));
    closing = true;
    container.inert = true;
    container.hidden = true;
    try {
      await prepare();
      reload();
    } catch {
      const screen = document.createElement("dialog");
      screen.className = "canvas-account-screen";
      const section = document.createElement("section");
      section.className = "canvas-account-form";
      const title = document.createElement("h1");
      title.textContent = "Workspace locked";
      const message = document.createElement("p");
      message.textContent =
        "This tab could not save your latest work. Keep it open and sign back in to the original account in another tab to recover or export your drawing.";
      const link = document.createElement("a");
      link.href = new URL(import.meta.env.BASE_URL, location.origin).href;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Open Auto Canvas in another tab";
      const retry = document.createElement("button");
      retry.textContent = "Check sign-in";
      retry.onclick = () => void resumeOwner();
      section.append(title, message, link, retry);
      screen.append(section);
      container.after(screen);
      lockedScreen = screen;
      screen.addEventListener("cancel", (e) => e.preventDefault());
      screen.showModal();
      void resumeOwner();
    }
  };
  window.addEventListener("storage", (event) => {
    if (event.key === eventKey()) void sessionChanged();
  });
  const check = async () => {
    const current = ++generation;
    try {
      const identity = await identify();
      if (current !== generation) return;
      if (identity.mode !== "accounts") {
        root.render(editor());
        return;
      }
      if (!identity.user) {
        root.render(<Credentials onSuccess={() => void check()} />);
        return;
      }
      const { id, displayName } = identity.user;
      bindAccountStorage(id, import.meta.env.BASE_URL);
      active = id;
      // A sibling tab can change this origin's cookie between rendering and a
      // save. The server checks the account that the editor intended to use.
      const apiBase = new URL(apiUrl(""), location.origin);
      window.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          document.baseURI,
        );
        if (
          url.origin !== apiBase.origin ||
          !url.pathname.startsWith(apiBase.pathname)
        )
          return nativeFetch(input, init);
        const req = new Request(input instanceof Request ? input : url, {
          ...init,
          redirect: "error",
          cache: "no-store",
        });
        if (closing) {
          // Unmount revokes unclaimed pairings with the editor secret alone.
          if (
            req.method === "DELETE" &&
            req.keepalive &&
            req.headers.has("x-editor-secret") &&
            /^agent\/sessions\/[^/]+$/u.test(
              url.pathname.slice(apiBase.pathname.length),
            )
          ) {
            return nativeFetch(req, { credentials: "omit" });
          }
          throw Error("The account session has ended");
        }
        if (req.mode === "no-cors")
          throw Error("Account requests require same-origin headers");
        req.headers.set("X-Canvas-Account", id);
        const response = await nativeFetch(req);
        if (
          response.status === 401 &&
          response.headers.get("X-Canvas-Session") === "expired" &&
          active
        ) {
          void sessionChanged();
        }
        return response;
      };
      async function logout() {
        if (container.inert || closing) return;
        container.inert = true;
        try {
          if (!prepare) throw Error("The workspace is still opening.");
          await prepare();
        } catch (error) {
          container.inert = false;
          window.alert(
            "Sign out paused. " +
              (error instanceof Error
                ? error.message
                : "Save or export your work before leaving."),
          );
          return;
        }
        try {
          const result = await fetch(apiUrl("auth/logout"), { method: "POST" });
          if (!result.ok) throw Error();
          window.dispatchEvent(new Event(ACCOUNT_SESSION_ENDING));
          announce();
          reload();
        } catch {
          container.inert = false;
          window.alert("Sign out failed. Please try again.");
        }
      }
      root.render(
        <AccountContext.Provider
          value={{
            username: displayName,
            prepareLogout: (check) => {
              prepare = check;
            },
            logout: () => void logout(),
          }}
        >
          {editor()}
        </AccountContext.Provider>,
      );
    } catch {
      if (current === generation)
        root.render(
          <main className="canvas-account-screen">
            <section className="canvas-account-form">
              <h1>Account server unavailable</h1>
              <button onClick={() => void check()}>Retry</button>
            </section>
          </main>,
        );
    }
  };
  const recheck = async () => {
    if (lockedScreen) return resumeOwner();
    if (!active || closing) return;
    try {
      const res = await nativeFetch(apiUrl("auth/me"), { cache: "no-store" });
      if (
        res.status === 401 ||
        (res.ok && (await res.json()).user?.id !== active)
      )
        void sessionChanged();
    } catch {
      /* Retry when the window next receives focus. */
    }
  };
  window.addEventListener("focus", () => void recheck());
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) void recheck();
  });
  root.render(
    <main className="canvas-account-screen" role="status">
      Opening Auto Canvas…
    </main>,
  );
  void check();
}
