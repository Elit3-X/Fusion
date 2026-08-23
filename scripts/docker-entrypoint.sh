#!/bin/sh
# FNXC:DockerRun 2026-08-23-02:03:
# Start `tailscaled` before the dashboard, because the image shipping the `tailscale` CLI is not
# enough to make the remote-access feature work. Fusion's tunnel spawns a bare `tailscale funnel
# <port>`, which needs a running daemon on the DEFAULT socket; with no daemon it dies instantly with
# "failed to connect to local tailscaled" and exit 1, surfacing in the UI as an unexplained process
# failure (operator report: "starting tailscale tunnel in container is failing with process exited 1").
#
# Userspace networking (`--tun=userspace-networking`) is deliberate: it needs neither `NET_ADMIN` nor
# `/dev/net/tun`, so the documented `docker run` keeps working unchanged, and it is sufficient for
# `tailscale serve`/`funnel`, which proxy to a local port rather than route packets. The SOCKS5/HTTP
# proxy listeners are the standard userspace-mode escape hatch for outbound tailnet access, which has
# no route out otherwise.
#
# Startup is BEST-EFFORT and never fails the container: an operator who does not use Tailscale must
# still get a dashboard. Set FUSION_DISABLE_TAILSCALED=1 to skip it entirely.
#
# Login is NOT automated here — `tailscale up` requires an interactive auth URL or an operator's auth
# key, so the daemon comes up logged-out and the operator authenticates once. State lives under
# /var/lib/tailscale, which the image symlinks into /home/node/.tailscale so the documented
# `-v <vol>:/home/node` mount persists that login across container recreates.
set -e

if [ "${FUSION_DISABLE_TAILSCALED:-0}" != "1" ] && [ -x /usr/sbin/tailscaled ]; then
  if [ ! -S /var/run/tailscale/tailscaled.sock ]; then
    /usr/sbin/tailscaled \
      --tun=userspace-networking \
      --socks5-server=localhost:1055 \
      --outbound-http-proxy-listen=localhost:1055 \
      >/var/log/tailscaled.log 2>&1 &
  fi
fi

exec node /app/packages/cli/dist/bin.js "$@"
