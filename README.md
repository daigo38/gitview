# GitView

A mobile-first web app for inspecting and operating local Git repositories from your phone's browser.

[日本語版 README](./README.ja.md)

## Features

- **Repository list** — staged / unstaged / untracked counts, branch name, ahead/behind
- **Status management** — stage / unstage files individually or in bulk
- **Discard changes** — revert unstaged or untracked files (`git restore` / `git clean`)
- **File view** — diff / staged diff / file content tabs, with image and video preview
- **Commit history** — browse commits with collapsible per-file diffs
- **iOS-style swipe back** — swipe from the left edge to go back

## Tech stack

Bun · Hono · React + Vite. TLS is optionally terminated by `tailscale serve`.

## Install

Requires [Bun](https://bun.sh/).

```bash
git clone <this-repo> gitview && cd gitview
bun install
cd client && bun install && bun run build && cd ..
cp config.example.json config.json   # then edit config.json
```

## Run

```bash
bun start
```

Listens on `http://127.0.0.1:10001` (loopback only).

### Run at login (launchd, macOS)

Register a per-user LaunchAgent so GitView auto-starts at login and auto-restarts on crash. Save as `~/Library/LaunchAgents/com.gitview.server.plist` (replace `/Users/YOU`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.gitview.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>exec /Users/YOU/.bun/bin/bun /Users/YOU/Dev/gitview/server.ts</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/YOU/Dev/gitview</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/Users/YOU/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/YOU/Dev/gitview/logs/stdout.log</string>
  <key>StandardErrorPath</key><string>/Users/YOU/Dev/gitview/logs/stderr.log</string>
</dict></plist>
```

`bash -c "exec bun …"` wraps bun so the child inherits an Aqua-session Mach bootstrap (required for some macOS-integrated child processes), while `exec` keeps the process tree flat.

```bash
launchctl load ~/Library/LaunchAgents/com.gitview.server.plist
launchctl kickstart -k gui/$(id -u)/com.gitview.server   # restart after edits
launchctl unload ~/Library/LaunchAgents/com.gitview.server.plist
```

If port `10001` is already in use, the launchd instance will exit with `EADDRINUSE` — kill the previous process first (`lsof -i :10001`).

### Tailnet access (HTTPS)

Put Tailscale in front as the TLS terminator (auto-rotating cert):

```bash
tailscale serve --bg --https=10001 http://localhost:10001
```

Reach it from any tailnet device at `https://<tailscale-hostname>.ts.net:10001/`.

```bash
tailscale serve status               # inspect
tailscale serve --https=10001 off    # remove
```

## Configuration (`config.json`)

Git-ignored. Copy `config.example.json` and edit.

```json
{
  "scanDirs": ["/Users/you/Dev"],
  "repos": ["/Users/you/path/to/some-repo"],
  "port": 10001,
  "ignoreDirs": ["node_modules", ".git", "vendor", "dist", ".cache"]
}
```

- `scanDirs` — recursively scanned for `.git` (depth 6)
- `repos` — explicit paths (combinable with `scanDirs`)
- `ignoreDirs` — directory names skipped during scan

## Security

GitView has **no authentication** and grants read/write (stage / discard / clean) access to every configured repository. Keep it on loopback or inside your tailnet.

- **Tailscale**: works out of the box via `tailscale serve` — no firewall change needed.
- **LAN**: not exposed by default. To allow same-Wi-Fi devices without Tailscale, change `hostname` in `server.ts` from `'127.0.0.1'` to `'0.0.0.0'` and approve the macOS prompt.
- **Public internet**: do **not** open the port on your router.
