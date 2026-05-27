import { useState, useEffect, useCallback } from 'react';
import FileTree from './FileTree.tsx';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus.ts';
import type { FileStatus, FileTab, LogEntry, NavigateFn, RepoDetail as RepoDetailData } from '../types.ts';

function getStatusClass(x: string, y: string): string {
  if (x === '?' && y === '?') return 'status-QQ';
  const c = x !== ' ' ? x : y;
  if (c === 'M') return 'status-M';
  if (c === 'A') return 'status-A';
  if (c === 'D') return 'status-D';
  if (c === 'R') return 'status-R';
  return 'status-U';
}

function getStatusChar(x: string, y: string): string {
  if (x === '?' && y === '?') return '?';
  if (x !== ' ') return x;
  return y;
}

interface DiscardButtonProps {
  onDiscard: () => void;
  filePath: string;
}

function DiscardButton({ onDiscard, filePath }: DiscardButtonProps) {
  const [open, setOpen] = useState(false);

  const handleClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setOpen(true);
  };

  return (
    <>
      <button className="action-btn action-btn-discard" onClick={handleClick} aria-label="変更を取り消す">
        ↺
      </button>
      {open && (
        <div className="confirm-overlay" onClick={e => { e.stopPropagation(); setOpen(false); }}>
          <div className="confirm-sheet" onClick={e => e.stopPropagation()}>
            <div className="confirm-title">変更を取り消す</div>
            <div className="confirm-path">{filePath}</div>
            <div className="confirm-actions">
              <button className="confirm-btn confirm-btn-cancel" onClick={() => setOpen(false)}>キャンセル</button>
              <button className="confirm-btn confirm-btn-ok" onClick={() => { setOpen(false); onDiscard(); }}>取り消す</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface FileItemProps {
  file: FileStatus;
  repoId: string;
  repoName: string;
  repoPath?: string;
  navigate: NavigateFn;
  actionLabel: '+' | '−';
  onAction: (filePath: string) => void;
  onDiscard?: (filePath: string) => void;
  onShowInTree: (filePath: string) => void;
}

function FileItem({
  file,
  repoId,
  repoName,
  repoPath,
  navigate,
  actionLabel,
  onAction,
  onDiscard,
  onShowInTree,
}: FileItemProps) {
  const parts = file.path.split('/');
  const name = parts.pop() ?? file.path;
  const dir = parts.join('/');

  const defaultTab: FileTab = file.isUntracked ? 'file' : (file.isStaged ? 'staged' : 'diff');

  return (
    <div
      className="list-item"
      onClick={() => navigate({
        type: 'file',
        repoId,
        repoName,
        repoPath,
        filePath: file.path,
        tab: defaultTab,
        fileStatus: file,
      })}
    >
      <span className={`file-status ${getStatusClass(file.x, file.y)}`}>
        {getStatusChar(file.x, file.y)}
      </span>
      <span className="file-path">
        {dir && <span className="file-path-dir">{dir}/</span>}
        <span className="file-path-name">{name}</span>
      </span>
      <button
        className="action-btn action-btn-tree"
        onClick={e => { e.stopPropagation(); onShowInTree(file.path); }}
        title="ファイルツリーで表示"
        aria-label="ファイルツリーで表示"
      >
        ⌖
      </button>
      {onDiscard && <DiscardButton onDiscard={() => onDiscard(file.path)} filePath={file.path} />}
      <button
        className={`action-btn ${actionLabel === '+' ? 'action-btn-stage' : 'action-btn-unstage'}`}
        onClick={e => { e.stopPropagation(); onAction(file.path); }}
        aria-label={actionLabel === '+' ? 'ステージ' : 'アンステージ'}
      >
        {actionLabel}
      </button>
      <span className="chevron">›</span>
    </div>
  );
}

interface SectionHeaderProps {
  label: string;
  count: number;
  bulkLabel: string;
  onBulk: () => void;
}

function SectionHeader({ label, count, bulkLabel, onBulk }: SectionHeaderProps) {
  return (
    <div className="section-header-row">
      <span className="section-header-text">{label} ({count})</span>
      <button className="section-bulk-btn" onClick={onBulk}>{bulkLabel}</button>
    </div>
  );
}

interface LogTabProps {
  repoId: string;
  repoName: string;
  navigate: NavigateFn;
  active: boolean;
}

function LogTab({ repoId, repoName, navigate, active }: LogTabProps) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback((showLoading = true) => {
    if (showLoading) setLoading(true);
    return fetch(`/api/repos/${repoId}/log`)
      .then(r => r.json() as Promise<LogEntry[]>)
      .then(data => { setLog(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [repoId]);

  useEffect(() => {
    void load();
  }, [load]);

  useRefreshOnFocus(active, () => load(false));

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div>
      {log.length === 0 && <div className="empty">コミット履歴がありません</div>}
      {log.map(commit => (
        <div
          className="log-item"
          key={commit.hash}
          onClick={() => navigate({ type: 'commit', repoId, repoName, hash: commit.hash, shortHash: commit.shortHash, subject: commit.subject })}
        >
          <div className="log-hash">{commit.shortHash}</div>
          <div className="log-subject">{commit.subject}</div>
          <div className="log-meta">{commit.author} · {commit.date}</div>
          <span className="log-chevron">›</span>
        </div>
      ))}
    </div>
  );
}

interface RepoDetailProps {
  repoId: string;
  repoName: string;
  repoPath?: string;
  navigate: NavigateFn;
  active: boolean;
}

type RepoTab = 'status' | 'tree' | 'log';
type RepoOperation = 'stage' | 'unstage' | 'discard' | 'clean';

type RemoteAction = 'push' | 'pull';

interface RemoteResult {
  action: RemoteAction;
  ok: boolean;
  text: string;
}

export default function RepoDetail({ repoId, repoName, repoPath, navigate, active }: RepoDetailProps) {
  const [detail, setDetail] = useState<RepoDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<RepoTab>('status');
  const [treeTarget, setTreeTarget] = useState<{ path: string; token: number } | null>(null);
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [remoteBusy, setRemoteBusy] = useState<RemoteAction | null>(null);
  const [remoteResult, setRemoteResult] = useState<RemoteResult | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/repos/${repoId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDetail((await res.json()) as RepoDetailData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => { void load(); }, [load]);

  useRefreshOnFocus(active, () => load(false));

  const operate = useCallback(async (action: RepoOperation, files: string[] | undefined) => {
    try {
      const res = await fetch(`/api/repos/${repoId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDetail((await res.json()) as RepoDetailData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [repoId]);

  const stage   = useCallback((files: string[] | undefined) => operate('stage',   files), [operate]);
  const unstage = useCallback((files: string[] | undefined) => operate('unstage', files), [operate]);
  const discard = useCallback((files: string[] | undefined) => operate('discard', files), [operate]);
  const clean   = useCallback((files: string[] | undefined) => operate('clean',   files), [operate]);

  const showInTree = useCallback((filePath: string) => {
    setTreeTarget(current => ({
      path: filePath,
      token: (current?.token ?? 0) + 1,
    }));
    setTab('tree');
  }, []);

  const runRemote = useCallback(async (action: RemoteAction) => {
    if (remoteBusy) return;
    setRemoteBusy(action);
    setRemoteResult(null);
    try {
      const res = await fetch(`/api/repos/${repoId}/${action}`, { method: 'POST' });
      const data = (await res.json().catch(() => null)) as
        | { output?: string; detail?: RepoDetailData; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      if (data?.detail) setDetail(data.detail);
      setRemoteResult({ action, ok: true, text: (data?.output ?? '').trim() || 'OK' });
    } catch (e: unknown) {
      setRemoteResult({
        action,
        ok: false,
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRemoteBusy(null);
    }
  }, [repoId, remoteBusy]);

  const commit = useCallback(async () => {
    const message = commitMsg.trim();
    if (!message || committing) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/repos/${repoId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      setDetail((await res.json()) as RepoDetailData);
      setCommitMsg('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  }, [repoId, commitMsg, committing]);

  if (loading) return (
    <div className="scroll-area">
      <div className="loading"><div className="spinner" />読み込み中…</div>
    </div>
  );

  if (error) return (
    <div className="scroll-area">
      <div className="error-msg">エラー: {error}</div>
    </div>
  );

  const files: FileStatus[] = detail?.files ?? [];
  const currentRepoPath = detail?.path ?? repoPath;
  const branch = detail?.branch ?? 'HEAD';
  const ahead = detail?.ahead ?? 0;
  const behind = detail?.behind ?? 0;

  const staged    = files.filter(f => f.isStaged);
  const unstaged  = files.filter(f => !f.isUntracked && f.isUnstaged);
  const untracked = files.filter(f => f.isUntracked);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div className="repo-detail-header">
        <span className="branch-badge" style={{ fontSize: 13 }}>{branch}</span>
        {(ahead > 0 || behind > 0) && (
          <span className="ahead-behind">
            {ahead > 0 && <span className="ahead">↑{ahead}</span>}
            {behind > 0 && <span className="behind"> ↓{behind}</span>}
          </span>
        )}
        <div className="repo-header-actions">
          <button
            className="remote-btn remote-btn-pull"
            onClick={() => { void runRemote('pull'); }}
            disabled={remoteBusy !== null}
            title="git pull --ff-only"
          >
            {remoteBusy === 'pull' ? 'Pull中…' : 'Pull'}
          </button>
          <button
            className="remote-btn remote-btn-push"
            onClick={() => { void runRemote('push'); }}
            disabled={remoteBusy !== null}
            title="git push"
          >
            {remoteBusy === 'push' ? 'Push中…' : 'Push'}
          </button>
          <button className="repo-header-refresh" onClick={() => { void load(); }}>更新</button>
        </div>
      </div>

      {remoteResult && (
        <div className={`remote-result ${remoteResult.ok ? 'remote-result-ok' : 'remote-result-err'}`}>
          <div className="remote-result-head">
            <span>{remoteResult.action === 'push' ? 'Push' : 'Pull'} {remoteResult.ok ? '成功' : '失敗'}</span>
            <button className="remote-result-close" onClick={() => setRemoteResult(null)} aria-label="閉じる">×</button>
          </div>
          <pre className="remote-result-body">{remoteResult.text}</pre>
        </div>
      )}

      <div className="tabs">
        <button className={`tab ${tab === 'status' ? 'active' : ''}`} onClick={() => setTab('status')}>
          状態 {files.length > 0 && `(${files.length})`}
        </button>
        <button className={`tab ${tab === 'tree' ? 'active' : ''}`} onClick={() => setTab('tree')}>
          ファイル
        </button>
        <button className={`tab ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>
          履歴
        </button>
      </div>

      <div className="scroll-area">
        {tab === 'status' && (
          <>
            {files.length === 0 && (
              <div className="empty">変更なし（クリーン）</div>
            )}
            {staged.length > 0 && (
              <div className="section">
                <SectionHeader
                  label="Staged"
                  count={staged.length}
                  bulkLabel="全解除"
                  onBulk={() => { void unstage(undefined); }}
                />
                <div className="list">
                  {staged.map(f => (
                    <FileItem
                      key={f.path + 'S'}
                      file={f}
                      repoId={repoId}
                      repoName={repoName}
                      repoPath={currentRepoPath}
                      navigate={navigate}
                      actionLabel="−"
                      onAction={(p) => { void unstage([p]); }}
                      onShowInTree={showInTree}
                    />
                  ))}
                </div>
                <div className="commit-box">
                  <textarea
                    className="commit-input"
                    placeholder="コミットメッセージ"
                    rows={2}
                    value={commitMsg}
                    onChange={e => setCommitMsg(e.target.value)}
                    disabled={committing}
                  />
                  <button
                    className="commit-btn"
                    onClick={() => { void commit(); }}
                    disabled={committing || commitMsg.trim().length === 0}
                  >
                    {committing ? 'コミット中…' : `コミット (${staged.length})`}
                  </button>
                </div>
              </div>
            )}
            {unstaged.length > 0 && (
              <div className="section">
                <SectionHeader
                  label="Unstaged"
                  count={unstaged.length}
                  bulkLabel="全ステージ"
                  onBulk={() => { void stage(unstaged.map(f => f.path)); }}
                />
                <div className="list">
                  {unstaged.map(f => (
                    <FileItem
                      key={f.path + 'U'}
                      file={f}
                      repoId={repoId}
                      repoName={repoName}
                      repoPath={currentRepoPath}
                      navigate={navigate}
                      actionLabel="+"
                      onAction={(p) => { void stage([p]); }}
                      onDiscard={(p) => { void discard([p]); }}
                      onShowInTree={showInTree}
                    />
                  ))}
                </div>
              </div>
            )}
            {untracked.length > 0 && (
              <div className="section">
                <SectionHeader
                  label="Untracked"
                  count={untracked.length}
                  bulkLabel="全ステージ"
                  onBulk={() => { void stage(untracked.map(f => f.path)); }}
                />
                <div className="list">
                  {untracked.map(f => (
                    <FileItem
                      key={f.path + '?'}
                      file={f}
                      repoId={repoId}
                      repoName={repoName}
                      repoPath={currentRepoPath}
                      navigate={navigate}
                      actionLabel="+"
                      onAction={(p) => { void stage([p]); }}
                      onDiscard={(p) => { void clean([p]); }}
                      onShowInTree={showInTree}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'tree' && (
          <FileTree
            repoId={repoId}
            repoName={repoName}
            repoPath={currentRepoPath}
            navigate={navigate}
            active={active}
            targetPath={treeTarget?.path}
            targetToken={treeTarget?.token ?? 0}
          />
        )}

        {tab === 'log' && (
          <LogTab repoId={repoId} repoName={repoName} navigate={navigate} active={active} />
        )}
      </div>
    </div>
  );
}
