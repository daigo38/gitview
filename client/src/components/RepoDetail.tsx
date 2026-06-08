import { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import FileTree from './FileTree.tsx';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus.ts';
import type { FileContentResponse, FileStatus, FileTab, LogEntry, NavigateFn, RepoDetail as RepoDetailData } from '../types.ts';

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

function getFileIcon(name: string): string {
  const parts = name.split('.');
  const ext = (parts.length > 1 ? parts[parts.length - 1] : '')?.toLowerCase() ?? '';
  const icons: Record<string, string> = {
    js: '🟨', jsx: '🟨', ts: '🔷', tsx: '🔷',
    py: '🐍', rb: '💎', go: '🩵', rs: '🦀',
    html: '🌐', css: '🎨', scss: '🎨', sass: '🎨',
    json: '📋', yaml: '📋', yml: '📋', toml: '📋',
    md: '📝', txt: '📄',
    sh: '⚙️', bash: '⚙️', zsh: '⚙️',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    pdf: '📕', zip: '🗜️', tar: '🗜️', gz: '🗜️',
    lock: '🔒',
  };
  return icons[ext] ?? '📄';
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(<mark key={key++} className="search-hit">{text.slice(idx, idx + q.length)}</mark>);
    i = idx + q.length;
  }
  return <>{parts}</>;
}

interface DiscardButtonProps {
  onDiscard: () => void;
  filePath: string;
}

interface ConfirmDialogProps {
  title: string;
  detail: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({ title, detail, confirmLabel, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <div className="confirm-overlay" onClick={e => { e.stopPropagation(); onCancel(); }}>
      <div className="confirm-sheet" onClick={e => e.stopPropagation()}>
        <div className="confirm-title">{title}</div>
        <div className="confirm-path">{detail}</div>
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn-cancel" onClick={onCancel}>キャンセル</button>
          <button className="confirm-btn confirm-btn-ok" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
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
        <span className="action-btn-icon">↺</span>
      </button>
      {open && (
        <ConfirmDialog
          title="変更を取り消す"
          detail={filePath}
          confirmLabel="取り消す"
          onCancel={() => setOpen(false)}
          onConfirm={() => { setOpen(false); onDiscard(); }}
        />
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
  const pathRef = useRef<HTMLSpanElement | null>(null);
  const parts = file.path.split('/');
  const name = parts.pop() ?? file.path;
  const dir = parts.join('/');

  const defaultTab: FileTab = file.isUntracked ? 'file' : (file.isStaged ? 'staged' : 'diff');

  useLayoutEffect(() => {
    const el = pathRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [file.path]);

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
      <span className="file-path" ref={pathRef}>
        {dir && <span className="file-path-dir">{dir}/</span>}
        <span className="file-path-name">{name}</span>
      </span>
      <button
        className="action-btn action-btn-tree"
        onClick={e => { e.stopPropagation(); onShowInTree(file.path); }}
        title="ファイルツリーで表示"
        aria-label="ファイルツリーで表示"
      >
        <span className="action-btn-icon">⌖</span>
      </button>
      {onDiscard && <DiscardButton onDiscard={() => onDiscard(file.path)} filePath={file.path} />}
      <button
        className={`action-btn ${actionLabel === '+' ? 'action-btn-stage' : 'action-btn-unstage'}`}
        onClick={e => { e.stopPropagation(); onAction(file.path); }}
        aria-label={actionLabel === '+' ? 'ステージ' : 'アンステージ'}
      >
        <span className="action-btn-icon">{actionLabel}</span>
      </button>
      <span className="chevron">›</span>
    </div>
  );
}

interface SectionHeaderProps {
  label: string;
  count: number;
  actions: SectionAction[];
}

interface SectionAction {
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
}

function SectionHeader({ label, count, actions }: SectionHeaderProps) {
  return (
    <div className="section-header-row">
      <span className="section-header-text">{label} ({count})</span>
      <div className="section-header-actions">
        {actions.map(action => (
          <button
            key={action.label}
            className={`section-bulk-btn ${action.tone === 'danger' ? 'section-bulk-btn-danger' : ''}`}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface StatusSearchBarsProps {
  contentQuery: string;
  pathQuery: string;
  onContentQueryChange: (value: string) => void;
  onPathQueryChange: (value: string) => void;
}

function StatusSearchBars({
  contentQuery,
  pathQuery,
  onContentQueryChange,
  onPathQueryChange,
}: StatusSearchBarsProps) {
  return (
    <div className="status-search-bars">
      <div className="search-bar">
        <span className="search-icon">🔎</span>
        <input
          type="search"
          inputMode="search"
          className="search-input"
          placeholder="Changed files の全文検索…"
          value={contentQuery}
          onChange={e => onContentQueryChange(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {contentQuery && (
          <button
            className="search-clear"
            onClick={() => onContentQueryChange('')}
            aria-label="クリア"
          >
            ×
          </button>
        )}
      </div>
      <div className="search-bar search-bar-secondary">
        <span className="search-icon">🔎</span>
        <input
          type="search"
          inputMode="search"
          className="search-input"
          placeholder="Changed files のファイル名検索…"
          value={pathQuery}
          onChange={e => onPathQueryChange(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {pathQuery && (
          <button
            className="search-clear"
            onClick={() => onPathQueryChange('')}
            aria-label="クリア"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

interface ChangedFileContentMatch {
  line: number;
  text: string;
}

interface ChangedFileContentResult {
  file: FileStatus;
  matches: ChangedFileContentMatch[];
}

interface ChangedFileSearchResultsProps {
  repoId: string;
  repoName: string;
  repoPath?: string;
  files: FileStatus[];
  contentQuery: string;
  pathQuery: string;
  navigate: NavigateFn;
}

function ChangedFileSearchResults({
  repoId,
  repoName,
  repoPath,
  files,
  contentQuery,
  pathQuery,
  navigate,
}: ChangedFileSearchResultsProps) {
  const [results, setResults] = useState<ChangedFileContentResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const q = contentQuery.trim().toLowerCase();
    const pathQ = pathQuery.trim().toLowerCase();
    const candidates = files.filter(file => (
      !pathQ || file.path.toLowerCase().includes(pathQ)
    ));

    setLoading(true);
    setError(null);

    async function runSearch(): Promise<void> {
      const nextResults: ChangedFileContentResult[] = [];

      for (const file of candidates) {
        if (controller.signal.aborted) return;
        try {
          const params = new URLSearchParams({ path: file.path });
          const res = await fetch(`/api/repos/${repoId}/file?${params.toString()}`, {
            signal: controller.signal,
          });
          if (!res.ok) continue;
          const data = (await res.json()) as FileContentResponse;
          if (data.binary || data.content === null || data.size > 1024 * 1024) continue;

          const matches: ChangedFileContentMatch[] = [];
          const lines = data.content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? '';
            if (!line.toLowerCase().includes(q)) continue;
            matches.push({
              line: i + 1,
              text: line.length > 500 ? `${line.slice(0, 500)}…` : line,
            });
            if (matches.length >= 20) break;
          }
          if (matches.length > 0) nextResults.push({ file, matches });
        } catch (e: unknown) {
          if (e instanceof Error && e.name === 'AbortError') return;
        }
      }

      setResults(nextResults);
      setLoading(false);
    }

    void runSearch().catch((e: unknown) => {
      if (e instanceof Error && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });

    return () => controller.abort();
  }, [repoId, files, contentQuery, pathQuery]);

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (error) return <div className="error-msg">{error}</div>;
  if (results.length === 0) return <div className="empty">マッチなし</div>;

  const matchCount = results.reduce((sum, result) => sum + result.matches.length, 0);

  return (
    <div className="list">
      <div className="search-summary">
        {matchCount} 件 / {results.length} ファイル
      </div>
      {results.map(result => (
        <div key={result.file.path} className="search-file-group">
          <div
            className="search-file-header"
            onClick={() => navigate({
              type: 'file',
              repoId,
              repoName,
              repoPath,
              filePath: result.file.path,
              tab: result.file.isUntracked ? 'file' : (result.file.isStaged ? 'staged' : 'diff'),
              fileStatus: result.file,
              query: contentQuery,
            })}
          >
            <span className="tree-icon">{getFileIcon(result.file.path.split('/').pop() ?? '')}</span>
            <span className="search-file-path">{highlightMatch(result.file.path, pathQuery)}</span>
            <span className="search-file-count">{result.matches.length}</span>
          </div>
          {result.matches.map(match => (
            <div
              key={`${result.file.path}:${match.line}`}
              className="search-match"
              onClick={() => navigate({
                type: 'file',
                repoId,
                repoName,
                repoPath,
                filePath: result.file.path,
                tab: 'file',
                fileStatus: result.file,
                line: match.line,
                query: contentQuery,
              })}
            >
              <span className="search-line-num">{match.line}</span>
              <span className="search-line-text">{highlightMatch(match.text, contentQuery)}</span>
            </div>
          ))}
        </div>
      ))}
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
type TreeSearchFocusKind = 'text' | 'name';
type BulkDiscardTarget = 'unstaged' | 'untracked';

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
  const [treeSearchFocus, setTreeSearchFocus] = useState<{ kind: TreeSearchFocusKind; token: number } | null>(null);
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [remoteBusy, setRemoteBusy] = useState<RemoteAction | null>(null);
  const [remoteResult, setRemoteResult] = useState<RemoteResult | null>(null);
  const [bulkDiscardTarget, setBulkDiscardTarget] = useState<BulkDiscardTarget | null>(null);
  const [statusContentQuery, setStatusContentQuery] = useState('');
  const [debouncedStatusContentQuery, setDebouncedStatusContentQuery] = useState('');
  const [statusPathQuery, setStatusPathQuery] = useState('');
  const [debouncedStatusPathQuery, setDebouncedStatusPathQuery] = useState('');

  const load = useCallback(async (showLoading = true, fetchRemote = false) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const url = fetchRemote
        ? `/api/repos/${repoId}?fetch=true`
        : `/api/repos/${repoId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const nextDetail = (await res.json()) as RepoDetailData;
      setDetail(nextDetail);
      if (!nextDetail.isGitRepo) setTab('tree');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => { void load(); }, [load]);

  useRefreshOnFocus(active, () => load(false));

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedStatusContentQuery(statusContentQuery.trim()), 300);
    return () => window.clearTimeout(t);
  }, [statusContentQuery]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedStatusPathQuery(statusPathQuery.trim()), 200);
    return () => window.clearTimeout(t);
  }, [statusPathQuery]);

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

  const focusTreeSearch = useCallback((kind: TreeSearchFocusKind) => {
    setTreeSearchFocus(current => ({
      kind,
      token: (current?.token ?? 0) + 1,
    }));
    setTab('tree');
  }, []);

  useEffect(() => {
    if (!active) return;

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return;
      const modifier = e.metaKey || e.ctrlKey;
      if (!modifier || e.altKey) return;

      const key = e.key.toLowerCase();
      if (e.shiftKey && key === 'f') {
        e.preventDefault();
        focusTreeSearch('text');
        return;
      }

      if (!e.shiftKey && key === 'p') {
        e.preventDefault();
        focusTreeSearch('name');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, focusTreeSearch]);

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

  const files: FileStatus[] = detail?.files ?? [];
  const currentRepoPath = detail?.path ?? repoPath;
  const isGitRepo = detail?.isGitRepo ?? true;
  const branch = detail?.branch ?? 'HEAD';
  const ahead = detail?.ahead ?? 0;
  const behind = detail?.behind ?? 0;

  const visibleFiles = useMemo(() => {
    const q = debouncedStatusPathQuery.toLowerCase();
    if (!q) return files;
    return files.filter(f => f.path.toLowerCase().includes(q));
  }, [files, debouncedStatusPathQuery]);

  const staged    = visibleFiles.filter(f => f.isStaged);
  const unstaged  = visibleFiles.filter(f => !f.isUntracked && f.isUnstaged);
  const untracked = visibleFiles.filter(f => f.isUntracked);
  const showStatusContentSearch = debouncedStatusContentQuery.length > 0;
  const hasStatusPathFilter = debouncedStatusPathQuery.length > 0;
  const bulkDiscardFiles = bulkDiscardTarget === 'unstaged'
    ? unstaged
    : bulkDiscardTarget === 'untracked'
      ? untracked
      : [];

  const confirmBulkDiscard = (): void => {
    const target = bulkDiscardTarget;
    const paths = bulkDiscardFiles.map(f => f.path);
    setBulkDiscardTarget(null);
    if (paths.length === 0) return;
    if (target === 'unstaged') void discard(paths);
    if (target === 'untracked') void clean(paths);
  };

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

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div className="repo-detail-header">
        <span className="branch-badge" style={{ fontSize: 13 }}>{branch}</span>
        {isGitRepo && (ahead > 0 || behind > 0) && (
          <span className="ahead-behind">
            {ahead > 0 && <span className="ahead">↑{ahead}</span>}
            {behind > 0 && <span className="behind"> ↓{behind}</span>}
          </span>
        )}
        <div className="repo-header-actions">
          {isGitRepo && (
            <>
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
            </>
          )}
          <button className="repo-header-refresh" onClick={() => { void load(true, isGitRepo); }}>更新</button>
        </div>
      </div>

      {isGitRepo && remoteResult && (
        <div className={`remote-result ${remoteResult.ok ? 'remote-result-ok' : 'remote-result-err'}`}>
          <div className="remote-result-head">
            <span>{remoteResult.action === 'push' ? 'Push' : 'Pull'} {remoteResult.ok ? '成功' : '失敗'}</span>
            <button className="remote-result-close" onClick={() => setRemoteResult(null)} aria-label="閉じる">×</button>
          </div>
          <pre className="remote-result-body">{remoteResult.text}</pre>
        </div>
      )}

      <div className="tabs">
        {isGitRepo && (
          <button className={`tab ${tab === 'status' ? 'active' : ''}`} onClick={() => setTab('status')}>
            状態 {files.length > 0 && `(${files.length})`}
          </button>
        )}
        <button className={`tab ${tab === 'tree' ? 'active' : ''}`} onClick={() => setTab('tree')}>
          ファイル
        </button>
        {isGitRepo && (
          <button className={`tab ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>
            履歴
          </button>
        )}
      </div>

      <div className="scroll-area">
        {isGitRepo && tab === 'status' && (
          <>
            {files.length > 0 && (
              <StatusSearchBars
                contentQuery={statusContentQuery}
                pathQuery={statusPathQuery}
                onContentQueryChange={setStatusContentQuery}
                onPathQueryChange={setStatusPathQuery}
              />
            )}
            {files.length === 0 && (
              <div className="empty">変更なし（クリーン）</div>
            )}
            {showStatusContentSearch && (
              <ChangedFileSearchResults
                repoId={repoId}
                repoName={repoName}
                repoPath={currentRepoPath}
                files={files}
                contentQuery={debouncedStatusContentQuery}
                pathQuery={debouncedStatusPathQuery}
                navigate={navigate}
              />
            )}
            {!showStatusContentSearch && files.length > 0 && visibleFiles.length === 0 && (
              <div className="empty">マッチなし</div>
            )}
            {!showStatusContentSearch && staged.length > 0 && (
              <div className="section">
                <SectionHeader
                  label="Staged"
                  count={staged.length}
                  actions={[{
                    label: 'Unstage all',
                    onClick: () => { void unstage(staged.map(f => f.path)); },
                  }]}
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
            {!showStatusContentSearch && unstaged.length > 0 && (
              <div className="section">
                <SectionHeader
                  label="Unstaged"
                  count={unstaged.length}
                  actions={[
                    {
                      label: 'Stage all',
                      onClick: () => { void stage(unstaged.map(f => f.path)); },
                    },
                    {
                      label: 'Discard all',
                      tone: 'danger',
                      onClick: () => setBulkDiscardTarget('unstaged'),
                    },
                  ]}
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
            {!showStatusContentSearch && untracked.length > 0 && (
              <div className="section">
                <SectionHeader
                  label="Untracked"
                  count={untracked.length}
                  actions={[
                    {
                      label: 'Stage all',
                      onClick: () => { void stage(untracked.map(f => f.path)); },
                    },
                    {
                      label: 'Discard all',
                      tone: 'danger',
                      onClick: () => setBulkDiscardTarget('untracked'),
                    },
                  ]}
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
            {!showStatusContentSearch && hasStatusPathFilter && visibleFiles.length > 0 && (
              <div className="search-summary">{visibleFiles.length} / {files.length} changed files</div>
            )}
            {bulkDiscardTarget && (
              <ConfirmDialog
                title="一括変更取り消し"
                detail={bulkDiscardTarget === 'untracked'
                  ? `${bulkDiscardFiles.length}件の未追跡ファイルを削除します`
                  : `${bulkDiscardFiles.length}件の変更を取り消します`}
                confirmLabel="取り消す"
                onCancel={() => setBulkDiscardTarget(null)}
                onConfirm={confirmBulkDiscard}
              />
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
            searchFocusKind={treeSearchFocus?.kind}
            searchFocusToken={treeSearchFocus?.token ?? 0}
          />
        )}

        {tab === 'log' && (
          <LogTab repoId={repoId} repoName={repoName} navigate={navigate} active={active} />
        )}
      </div>
    </div>
  );
}
