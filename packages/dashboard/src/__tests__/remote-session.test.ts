import { describe, expect, it } from "vitest";
import {
  buildRemoteSessionCookie,
  createRemoteSessionStore,
  readCookie,
  REMOTE_SESSION_COOKIE,
} from "../remote-session.js";
import { createAuthMiddleware } from "../auth-middleware.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
FNXC:RemoteAuth 2026-08-19-00:40:
`/remote-login?rt=…` used to redirect to `/?token=<daemonToken>`, handing every recipient of a shared
remote link the dashboard's real, non-expiring credential — in their URL bar, their history, and any
URL log. It also made the remote token pointless: revoking it left the recipient authenticated
forever, because they held the daemon token itself.

These cover the replacement: an opaque, expiring, revocable session in an HttpOnly cookie.
*/
describe("remote session store", () => {
  it("issues opaque ids that validate until they expire", () => {
    let now = 1_000_000;
    const store = createRemoteSessionStore(() => now);

    const session = store.issue(60_000);
    expect(session.id).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(store.validate(session.id)).toBe(true);

    now += 59_000;
    expect(store.validate(session.id)).toBe(true);
    now += 2_000;
    expect(store.validate(session.id), "an expired session must stop authenticating").toBe(false);
    store.stop();
  });

  it("rejects unknown and empty ids", () => {
    const store = createRemoteSessionStore();
    expect(store.validate(undefined)).toBe(false);
    expect(store.validate("")).toBe(false);
    expect(store.validate("not-a-real-session")).toBe(false);
    store.stop();
  });

  it("revokes individually and wholesale", () => {
    const store = createRemoteSessionStore();
    const a = store.issue(60_000);
    const b = store.issue(60_000);

    store.revoke(a.id);
    expect(store.validate(a.id)).toBe(false);
    expect(store.validate(b.id)).toBe(true);

    store.revokeAll();
    expect(store.validate(b.id), "rotating the remote token must be able to drop every session").toBe(false);
    store.stop();
  });
});

describe("remote session cookie", () => {
  it("is HttpOnly and SameSite=Lax so scripts cannot read it and cross-site sends are blocked", () => {
    const cookie = buildRemoteSessionCookie({ id: "abc", expiresAt: Date.now() + 60_000 }, { secure: false });
    expect(cookie).toContain(`${REMOTE_SESSION_COOKIE}=abc`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toMatch(/Max-Age=\d+/);
    expect(cookie).not.toContain("Secure");
  });

  it("adds Secure over https (a quick tunnel always is)", () => {
    const cookie = buildRemoteSessionCookie({ id: "abc", expiresAt: Date.now() + 60_000 }, { secure: true });
    expect(cookie).toContain("Secure");
  });

  it("parses one cookie out of a header without a parser dependency", () => {
    expect(readCookie(`a=1; ${REMOTE_SESSION_COOKIE}=xyz; b=2`, REMOTE_SESSION_COOKIE)).toBe("xyz");
    expect(readCookie("a=1; b=2", REMOTE_SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(undefined, REMOTE_SESSION_COOKIE)).toBeUndefined();
  });
});

describe("auth middleware session acceptance", () => {
  function runMiddleware(headers: Record<string, string | undefined>, validate?: (id: string | undefined) => boolean) {
    const middleware = createAuthMiddleware("real-token", validate ? { validateRemoteSession: validate } : undefined);
    let status: number | undefined;
    let nexted = false;
    const req = { path: "/api/tasks", url: "/api/tasks", headers } as never;
    const res = { status(code: number) { status = code; return this; }, json() { return this; } } as never;
    middleware(req, res, () => { nexted = true; });
    return { status, nexted };
  }

  it("accepts a valid session cookie when no token is present", () => {
    const result = runMiddleware({ cookie: `${REMOTE_SESSION_COOKIE}=good` }, (id) => id === "good");
    expect(result.nexted).toBe(true);
    expect(result.status).toBeUndefined();
  });

  it("rejects an unknown or expired session", () => {
    const result = runMiddleware({ cookie: `${REMOTE_SESSION_COOKIE}=stale` }, (id) => id === "good");
    expect(result.nexted).toBe(false);
    expect(result.status).toBe(401);
  });

  it("still rejects everything when no session validator is installed", () => {
    const result = runMiddleware({ cookie: `${REMOTE_SESSION_COOKIE}=good` });
    expect(result.nexted).toBe(false);
    expect(result.status).toBe(401);
  });

  it("keeps accepting the daemon token itself", () => {
    const result = runMiddleware({ authorization: "Bearer real-token" }, () => false);
    expect(result.nexted).toBe(true);
  });
});

/*
FNXC:RemoteAuth 2026-08-19-00:40:
RATCHET on the actual defect: the remote-login handler must never put the daemon token in a redirect.
A source-level assertion because the leak was one line (`searchParams.set("token", daemonToken)`) and
it is far easier to reintroduce than to notice.
*/
describe("remote-login redirect", () => {
  it("never places the daemon token in the redirect URL", () => {
    const server = readFileSync(resolve(__dirname, "../server.ts"), "utf8");
    const handler = server.slice(server.indexOf('app.get("/remote-login"'), server.indexOf('// REST API'));

    expect(handler.length).toBeGreaterThan(0);
    expect(handler).not.toMatch(/searchParams\.set\(\s*["']token["']/);
    expect(handler, "a validated remote token must mint a session instead").toContain("remoteSessions.issue");
    expect(handler).toContain("buildRemoteSessionCookie");
  });
});
