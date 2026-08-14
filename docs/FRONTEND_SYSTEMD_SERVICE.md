# Frontend Dev Server as a systemd Service (Cloudflare Tunnel Setup)

## Context

This document applies specifically to a local dev setup where the `apps/web`
frontend dev server is exposed publicly through a Cloudflare Tunnel (e.g. at
`https://macro.goodshepherdinsights.com`), run alongside the rest of the
stack via `just run_local`. It does not apply to a normal, unexposed local
dev loop — see `docs/RUNNING_LOCALLY.md` for that.

## The problem this solves

`just run_local` is designed as an **attached, foreground process**: it
brings up the Docker backend, waits for it to be healthy, then spawns the
frontend dev server (`bun run --bun dev` in `apps/web`) as its own direct
child process and stays attached to it in the terminal.

When `just run_local` (or a standalone frontend launch) is started from
inside an automated/AI-driven shell session — a Claude Code tool-call
session, a CI job, an SSH session that later disconnects, etc. — the
frontend process is still a descendant of that session's process tree, even
if started with `nohup ... & disown`. If the session that launched it ever
gets cleaned up, reset, or its process group torn down, the frontend process
can be killed along with it.

**Symptom:** the Docker backend containers (which have their own
independent restart policies) stay healthy and reachable, but
`http://localhost:3000` (and therefore the public tunnel domain) becomes
unreachable with `ERR_CONNECTION_REFUSED` / 502s from Cloudflare
(`Unable to reach the origin service ... dial tcp 127.0.0.1:3000: connect:
connection refused`), with no crash or error in the frontend's own log —
because it wasn't a crash, it was killed externally.

This is confusing to diagnose because everything *else* — DNS, the tunnel
connector, FusionAuth, the backend proxy — checks out healthy. Only the
frontend is down, silently, with no error trail explaining why.

## The fix: run the frontend under systemd instead

A `systemd` service is managed directly by PID 1 (`init`), not by any shell
session. Once started, it has no parent/child relationship to whatever
launched it — killing or resetting the launching session cannot affect it.

### Service file

Installed at `/etc/systemd/system/macro-frontend.service`:

```ini
[Unit]
Description=macro-inc/macro frontend dev server (Vite, tunnel-configured)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=dev
WorkingDirectory=/home/dev/macro/apps/web
Environment=PORT=3000
Environment=VITE_LOCAL_SERVERS=ALL
Environment=VITE_LOCAL_BACKEND_ORIGIN=https://macro-api.goodshepherdinsights.com
Environment=VITE_AI_EDITING_WORKER_URL=https://macro-api.goodshepherdinsights.com/ai-editing
Environment=VITE_ENABLE_BROWSER_OTEL=false
ExecStart=/bin/bash -lc 'source /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh && exec nix develop /home/dev/macro --command bun run --bun dev'
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### Why each env var is set the way it is

- **`VITE_LOCAL_BACKEND_ORIGIN`** — normally, `just run_local`'s own
  frontend-launch code (`tooling/xtask/crates/xtask_local/src/local/frontend.rs`,
  `dev_env()`) computes this itself as `http://localhost:<proxy-port>`. That
  default is wrong for a tunnel deployment, where the frontend and API are
  reachable via *different public hostnames*, not the same host on a
  different port. `dev_env()` was patched (see below) to read this value
  from the resolved `--env-file` overlay first, falling back to its
  computed default only if unset — matching the value set in `local.env`.
- **`VITE_AI_EDITING_WORKER_URL`** — same reasoning, derived from the same
  tunnel API origin.
- **`VITE_ENABLE_BROWSER_OTEL=false`** — unrelated to the tunnel/systemd
  fix specifically; avoids a separate telemetry-init issue where browser
  OTel silently defaults to enabled in Vite dev mode with no reachable
  collector, causing an early crash on page load.

### Companion source fix

Two small changes in `tooling/xtask/crates/xtask_local/src/local/frontend.rs`
and `mod.rs` make `just run_local`'s *own* frontend launch also respect
these overrides (not just this systemd service) — `dev_env()` now takes the
resolved `--env-file` map and checks it for `VITE_LOCAL_BACKEND_ORIGIN` /
`VITE_AI_EDITING_WORKER_URL` before falling back to the localhost-based
default. This means setting these three vars in `local.env` is sufficient
for *either* launch path (systemd service or `just run_local` itself) to
pick up the correct tunnel-facing values.

Also fixed: `apps/web/src/lib/core/constant/servers.ts`'s
`resolveProxyOrigin()` previously always rewrote a configured backend
origin's hostname to match the page's current hostname (correct for the
localhost/LAN/Tailscale-IP case, where frontend and API share a host on
different ports — wrong for a tunnel setup where they're on genuinely
different hostnames). It now only does that rewrite when the *configured*
hostname is itself a generic placeholder (`localhost`, a bare IP, or a
`*.localhost` alias) — a real, distinct hostname like
`macro-api.goodshepherdinsights.com` is trusted as-is.

## Verifying it's working

```bash
# Confirm systemd (PID 1), not a shell, is the direct parent:
systemctl show macro-frontend -p MainPID --value
ps -o pid,ppid,cmd -p $(systemctl show macro-frontend -p MainPID --value)
# Expect PPID = 1

# Confirm it's actually serving:
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/
curl -s -o /dev/null -w '%{http_code}\n' https://macro.goodshepherdinsights.com/
```

## Managing the service

```bash
sudo systemctl status macro-frontend      # current state
sudo journalctl -u macro-frontend -f      # live logs (Vite's own stdout/stderr)
sudo systemctl restart macro-frontend     # manual restart
sudo systemctl stop macro-frontend        # stop it
sudo systemctl disable macro-frontend     # stop starting it at boot
```

## Important caveat: don't run two frontends at once

This service and `just run_local`'s own frontend-launch step both try to
bind port 3000. If `macro-frontend.service` is running and you separately
run a full `just run_local` (e.g. to rebuild after a backend Rust change),
`run_local` will fail with `frontend port 3000 is already in use`.

**Before running a full `just run_local`:**
```bash
sudo systemctl stop macro-frontend
```

**After `just run_local` finishes** (its own attached frontend will be
running for that session): either leave `run_local`'s own frontend running
for the current session, or stop it and re-start the systemd service for
the guaranteed-durable version:
```bash
# inside the run_local session: Ctrl-C to detach, or in another shell:
lsof -ti tcp:3000 | xargs -r kill -9
sudo systemctl start macro-frontend
```

## What this does *not* cover

This service only manages the frontend dev server process. It does not
address:
- The Docker backend containers — those already have their own restart
  policies and were not affected by this issue.

FusionAuth's `authorizedRedirectURLs` durability — the same class of issue as
the frontend one above, where a full `just run_local` teardown/recreate cycle
wiped FusionAuth's database and any live-patched redirect URL authorization
for the tunnel domain along with it — is now fixed the same way:
`tooling/xtask/crates/xtask_local/src/local/kickstart.rs`'s `build()` reads
`FUSIONAUTH_OAUTH_REDIRECT_URI` from the resolved env and includes it in the
generated kickstart's `authorizedRedirectURLs` whenever it differs from the
computed local default, so it's authorized fresh on every rebuild — no more
manual re-patching via FusionAuth's admin API after each `run_local`.
