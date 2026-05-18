# GitView

A mobile-first web app for inspecting and operating local Git repositories from your phone's browser.

[日本語版 README](./README.ja.md)

## Features

- **Repository list** — shows staged / unstaged / untracked counts, branch name, and ahead/behind for each repo
- **Status management** — stage / unstage files individually or in bulk
- **Discard changes** — revert unstaged or untracked files with a confirmation dialog (`git restore` / `git clean`)
- **File view** — three tabs (diff / staged diff / file content), with image and video preview
- **Commit history** — browse commits with collapsible per-file diffs
- **iOS-style swipe back** — swipe from the left edge to go back

## Tech stack

- **Runtime**: Bun
- **Backend**: Hono, running git via `child_process.execFile`, served by `Bun.serve` (HTTP)
- **Frontend**: React + Vite (static build served by Hono)
- **TLS**: terminated by `tailscale serve` (optional)

## Install

Requires [Bun](https://bun.sh/).

```bash
git clone <this-repo> gitview && cd gitview
bun install
cd client && bun install && bun run build && cd ..
cp config.example.json config.json
# edit config.json to point at your repositories (see Configuration below)
```

## Run

```bash
bun start
```

The server listens on `http://127.0.0.1:10001` (loopback only).

### Tailnet access (HTTPS)

Use `tailscale serve` to put Tailscale in front as the TLS terminator. You get a valid Tailscale-issued certificate that auto-rotates:

```bash
tailscale serve --bg --https=10001 http://localhost:10001
```

You can then reach `https://<tailscale-hostname>.ts.net:10001/` from any tailnet device with no browser warning.

Inspect or remove:

```bash
tailscale serve status               # show current setup
tailscale serve --https=10001 off    # remove this entry
```

## Configuration (`config.json`)

`config.json` is git-ignored — copy `config.example.json` and edit it for your machine.

```json
{
  "scanDirs": ["/Users/you/Dev"],
  "repos": ["/Users/you/path/to/some-repo"],
  "port": 10001,
  "ignoreDirs": ["node_modules", ".git", "vendor", "dist", ".cache"]
}
```

| Key | Description |
|------|------|
| `scanDirs` | Directories to recursively scan for `.git` (default depth 6) |
| `repos` | Explicit repository paths (can be combined with `scanDirs`) |
| `port` | Server port (default `10001`) |
| `ignoreDirs` | Directory names to skip while scanning |

## Network exposure

The server binds to `127.0.0.1` only, so by default it is reachable only from the same machine. Tailnet access works because `tailscale serve` runs as a local proxy.

- **Tailscale**: no OS firewall rule needed — Tailscale uses its own network interface.
- **LAN**: not exposed by default. If you want direct LAN access (e.g. phone on the same Wi-Fi without Tailscale), change `hostname` in `server.ts` from `'127.0.0.1'` to `'0.0.0.0'` and approve macOS's incoming-connection prompt.
- **Public internet**: do **not** open the port on your router. GitView has no authentication and grants read/write access to the configured repositories. Keep it inside Tailnet or LAN.
