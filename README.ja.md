# GitView

スマホのブラウザからローカルの Git リポジトリを確認・操作できる、モバイルファーストの Web アプリ。

[English README](./README.md)

## 機能

- **リポジトリ一覧** — staged / unstaged / untracked のファイル数、ブランチ名、ahead/behind
- **ステータス管理** — ファイルごとのステージ・アンステージ、一括操作
- **変更取り消し** — unstaged / untracked ファイルを `git restore` / `git clean` で取り消し
- **ファイルビュー** — diff / staged diff / ファイル内容の 3 タブ、画像・動画プレビュー
- **コミット履歴** — コミット一覧から diff 表示、ファイルごとに開閉可能
- **iOS 風スワイプバック** — 画面左端からスワイプで戻れる

## 技術スタック

Bun · Hono · React + Vite。TLS は `tailscale serve` で終端（任意）。

## インストール

[Bun](https://bun.sh/) が必要。

```bash
git clone <このリポジトリ> gitview && cd gitview
bun install
cd client && bun install && bun run build && cd ..
cp config.example.json config.json   # その後 config.json を編集
```

## 起動

```bash
bun start
```

`http://127.0.0.1:10001`（ループバックのみ）で待ち受ける。

### 常時起動（launchd, macOS）

ログイン時に自動起動・クラッシュ時に自動再起動する LaunchAgent として登録する。`/Users/YOU` を自分のホームパスに置換し `~/Library/LaunchAgents/com.gitview.server.plist` に保存：

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

`bash -c "exec bun …"` でラップするのは、子プロセスが Aqua セッションの Mach bootstrap を継承するため（macOS の一部連携機能に必要）。`exec` で bash を bun に置き換えるのでプロセスツリーはフラットに保たれる。

```bash
launchctl load ~/Library/LaunchAgents/com.gitview.server.plist
launchctl kickstart -k gui/$(id -u)/com.gitview.server   # 設定変更後の再起動
launchctl unload ~/Library/LaunchAgents/com.gitview.server.plist
```

ポート `10001` が既に使われていると `EADDRINUSE` で落ちるため、先に `lsof -i :10001` で確認して旧プロセスを止めること。

### Tailnet 経由のアクセス（HTTPS）

`tailscale serve` で TLS 終端させると、自動ローテーションされる Tailscale 発行の正規証明書で HTTPS アクセスできる：

```bash
tailscale serve --bg --https=10001 http://localhost:10001
```

Tailnet 内のどの端末からも `https://<tailscale-hostname>.ts.net:10001/` で到達可能。

```bash
tailscale serve status               # 確認
tailscale serve --https=10001 off    # 解除
```

## 設定 (`config.json`)

`.gitignore` 対象。`config.example.json` をコピーして編集する。

```json
{
  "scanDirs": ["/Users/you/Dev"],
  "repos": ["/Users/you/path/to/some-repo"],
  "port": 10001,
  "ignoreDirs": ["node_modules", ".git", "vendor", "dist", ".cache"]
}
```

- `scanDirs` — 再帰スキャン対象（深さ 6 まで）
- `repos` — 明示的に指定するディレクトリパス（`scanDirs` と併用可）。Git 未初期化ディレクトリは閲覧専用フォルダとして表示される
- `ignoreDirs` — スキャン時に無視するディレクトリ名

## セキュリティ

GitView は **認証機構を持たない**。設定された Git リポジトリには Git 書き込み操作（stage / discard / clean）を許可し、Git 未初期化ディレクトリは閲覧専用で扱う。ループバックまたは Tailnet 内に閉じて使うこと。

- **Tailscale**: `tailscale serve` 経由でそのまま利用可（ファイアウォール変更不要）。
- **LAN**: デフォルト非公開。同一 Wi-Fi 上の端末から Tailscale 無しで使うには、`server.ts` の `hostname` を `'127.0.0.1'` から `'0.0.0.0'` に変更し macOS のダイアログで許可。
- **インターネット公開**: ルーターでのポート開放は **不可**。
