/*
FNXC:DevTunnel 2026-08-18-23:40:
`pnpm dev --tunnel` exposes the dev server through a Cloudflare quick tunnel.

The case this exists for: someone working inside a remote Fusion (a container, a shared box) starts a
dev server there and needs to LOOK at it from their own browser. The dev server is bound inside that
machine, so without a tunnel the only options are port publishing or a VPN — both of which need
cooperation from whoever owns the host.

Cloudflare QUICK tunnels are the right tool precisely because a dev server is HTTP: they need no
account, no domain, and no card (the TCP endpoints that SSH would have required need all three).
The trade is that the hostname is random and lives only as long as the process.

NOT a production exposure path: a quick tunnel is unauthenticated, so anyone with the URL reaches the
dev server. It is printed loudly for that reason.
*/

import { spawn } from "node:child_process";

/** Cloudflare prints the assigned hostname once the edge accepts the tunnel. */
const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** How long to wait for the URL before giving up and leaving the dev server running. */
const DEFAULT_URL_TIMEOUT_MS = 45_000;

export function extractQuickTunnelUrl(text) {
  const match = QUICK_TUNNEL_URL.exec(String(text ?? ""));
  return match ? match[0] : null;
}

/**
 * Start a Cloudflare quick tunnel for a local port.
 *
 * Resolves once the public URL is known, or with `url: null` if cloudflared never printed one —
 * the dev server keeps running either way, since losing the tunnel must not take the dev loop down.
 */
export async function startDevTunnel({
  port,
  log = console,
  spawnFn = spawn,
  timeoutMs = DEFAULT_URL_TIMEOUT_MS,
} = {}) {
  if (!port) throw new Error("startDevTunnel requires a port");

  const child = spawnFn(
    "cloudflared",
    ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let settled = false;
  let url = null;

  const stop = () => {
    if (!child.killed) child.kill("SIGTERM");
  };

  const urlPromise = new Promise((resolve) => {
    const finish = (value) => {
      if (settled) return;
      settled = true;
      url = value;
      resolve(value);
    };

    const scan = (chunk) => {
      const found = extractQuickTunnelUrl(chunk);
      if (found) finish(found);
    };

    child.stdout?.on("data", scan);
    // cloudflared writes its banner (including the URL) to stderr.
    child.stderr?.on("data", scan);

    child.on("error", (error) => {
      const hint = error?.code === "ENOENT"
        ? "cloudflared is not installed — install it or drop --tunnel"
        : error?.message;
      log.error?.(`[fusion:dev] tunnel failed to start: ${hint}`);
      finish(null);
    });

    child.on("exit", (code) => {
      if (!settled) {
        log.error?.(`[fusion:dev] tunnel exited before publishing a URL (code ${code})`);
        finish(null);
      }
    });

    const timer = setTimeout(() => {
      if (!settled) {
        log.error?.(`[fusion:dev] tunnel did not publish a URL within ${Math.round(timeoutMs / 1000)}s`);
        finish(null);
      }
    }, timeoutMs);
    timer.unref?.();
  });

  await urlPromise;

  if (url) {
    log.log?.("");
    log.log?.(`  ┌ dev server tunnel (public, unauthenticated)`);
    log.log?.(`  │ ${url}  →  http://localhost:${port}`);
    log.log?.(`  └ anyone with this URL can reach your dev server`);
    log.log?.("");
  }

  return { url, stop, child };
}
