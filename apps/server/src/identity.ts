/** The signed-in user as the HTTP API reports it (GET /api/auth/me). */
export interface SessionUser {
  id: string;
  displayName: string;
  email: null;
  provider: "local" | "notebook" | "account";
  role: "user" | "admin";
  isAdmin: boolean;
  /** Notebook mode: inherited from Silicon Notebook admin role (immutable in Canvas). */
  notebookAdmin?: boolean;
  /** Notebook mode: granted specifically inside Auto Canvas. */
  canvasAdmin?: boolean;
  /**
   * Accounts mode only: an administrator reset the password, and every route
   * but session reads, password change and sign-out answers 403 until it is
   * changed.
   */
  mustChangePassword?: boolean;
}

declare module "hono" {
  interface ContextVariableMap {
    /** Set by the notebook identity step before any protected handler runs. */
    sessionUser: SessionUser;
  }
}
