# GitView

スマホのブラウザからローカルの Git リポジトリを確認・操作できる、モバイルファーストの Web アプリ。

[English README](./README.md)

## 機能

- **リポジトリ一覧** — staged / unstaged / untracked のファイル数、ブランチ名、ahead/behind を一覧表示
- **ステータス管理** — ファイルごとのステージ・アンステージ、一括操作
- **変更取り消し** — unstaged / untracked ファイルを確認ダイアログ付きで取り消し（`git restore` / `git clean`）
- **ファイルビュー** — diff / staged diff / ファイル内容の 3 タブ、画像・動画プレビュー
- **コミット履歴** — コミット一覧から diff 表示、ファイルごとに開閉可能
- **iOS 風スワイプバック** — 画面左端からスワイプで戻れる

## 技術スタック

- **Runtime**: Bun
- **Backend**: Hono、`child_process.execFile` で git コマンドを実行、`Bun.serve` で HTTP を提供
- **Frontend**: React + Vite（静的ビルドを Hono が配信）
- **TLS**: `tailscale serve` で TLS 終端（オプション）

## インストール

[Bun](https://bun.sh/) が必要。

```bash
git clone <このリポジトリ> gitview && cd gitview
bun install
cd client && bun install && bun run build && cd ..
cp config.example.json config.json
# config.json を編集して対象リポジトリを指定（後述の「設定」参照）
```

## 起動

```bash
bun start
```

サーバーは `http://127.0.0.1:10001`（ループバックのみ）で待ち受ける。

### Tailnet 経由のアクセス（HTTPS）

`tailscale serve` で TLS 終端を Tailscale 側に任せると、Tailscale 発行の正規証明書で HTTPS アクセスでき、証明書のローテーションも自動になる。

```bash
tailscale serve --bg --https=10001 http://localhost:10001
```

これで Tailnet 内のどの端末からも `https://<tailscale-hostname>.ts.net:10001/` にブラウザ警告なしでアクセスできる。

状態確認・解除：

```bash
tailscale serve status               # 現在の設定を確認
tailscale serve --https=10001 off    # 解除
```

## 設定 (`config.json`)

`config.json` は `.gitignore` 対象。`config.example.json` をコピーして自分のマシンに合わせて編集する。

```json
{
  "scanDirs": ["/Users/you/Dev"],
  "repos": ["/Users/you/path/to/some-repo"],
  "port": 10001,
  "ignoreDirs": ["node_modules", ".git", "vendor", "dist", ".cache"]
}
```

| キー | 説明 |
|------|------|
| `scanDirs` | 再帰的にスキャンして `.git` を含むディレクトリを自動検出する（デフォルト深さ 6） |
| `repos` | 直接指定するリポジトリパス（`scanDirs` と併用可） |
| `port` | サーバーポート番号（デフォルト `10001`） |
| `ignoreDirs` | スキャン時に無視するディレクトリ名 |

## ネットワーク公開範囲

サーバーは `127.0.0.1` のみで待ち受けるため、デフォルトでは同一マシンからしか到達できない。Tailnet 経由でアクセスできるのは `tailscale serve` がローカルプロキシとして動作するため。

- **Tailscale**: OS のファイアウォール許可は不要（Tailscale が独自のネットワークインタフェースを使うため）。
- **LAN**: デフォルトでは公開していない。同一 Wi-Fi 上のスマホから Tailscale 無しで直接アクセスしたい場合は、`server.ts` の `hostname` を `'127.0.0.1'` から `'0.0.0.0'` に変更し、macOS の「ネットワーク受信を許可しますか？」ダイアログで **許可** を選ぶ。
- **インターネット公開**: ルーターでのポート開放は **しないこと**。GitView は認証機構を持たず、設定ファイルに記載されたリポジトリへの読み書きを許可するため、外部公開すると危険。Tailnet または LAN 内に閉じて使う。
