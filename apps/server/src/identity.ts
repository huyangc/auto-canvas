/** The signed-in user as the HTTP API reports it (GET /api/auth/me). */
export interface SessionUser {
  id: string;
  displayName: string;
  email: null;
  provider: "local" | "notebook" | "account";
  role: "user" | "admin";
  isAdmin: boolean;
}

declare module "hono" {
  interface ContextVariableMap {
    /** Set by the notebook identity step before any protected handler runs. */
    sessionUser: SessionUser;
  }
}
