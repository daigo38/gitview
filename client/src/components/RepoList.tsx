import { useState, useEffect, useCallback } from 'react';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus.ts';
import type { NavigateFn, RepoSummary } from '../types.ts';

interface StatusDotsProps {
  isGitRepo: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  clean: boolean;
}

function StatusDots({ isGitRepo, staged, unstaged, untracked, clean }: StatusDotsProps) {
  if (!isGitRepo) return <span className="dot-clean" style={{ fontSize: 12 }}>folder</span>;
  if (clean) return <span className="dot-clean" style={{ fontSize: 12 }}>✓ clean</span>;
  return (
    <span className="status-dots">
      {staged > 0 && <span className="dot-staged">●{staged}S</span>}
      {unstaged > 0 && <span className="dot-unstaged">●{unstaged}M</span>}
      {untracked > 0 && <span className="dot-untracked">●{untracked}?</span>}
    </span>
  );
}

interface RepoListProps {
  navigate: NavigateFn;
  active: boolean;
}

export default function RepoList({ navigate, active }: RepoListProps) {
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // マウント時にキャッシュから即取得
  useEffect(() => {
    fetch('/api/repos')
      .then(r => r.json() as Promise<RepoSummary[]>)
      .then(setRepos)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // 更新ボタン: サーバー側キャッシュを再構築して反映
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/repos/refresh', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RepoSummary[];
      setRepos(data.slice().sort((a, b) => b.lastActivityAt - a.lastActivityAt));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useRefreshOnFocus(active, refresh);

  const dirtyRepos = repos.filter(r => !r.clean);
  const cleanRepos = repos.filter(r => r.clean);

  return (
    <div className="scroll-area">
      <div style={{ padding: '10px 16px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          {repos.length > 0 ? `${repos.length}個のリポジトリ` : '読み込み中…'}
        </span>
        <button
          onClick={() => { void refresh(); }}
          disabled={refreshing}
          style={{ background: 'none', border: 'none', color: refreshing ? 'var(--muted)' : 'var(--link)', fontSize: 13, cursor: refreshing ? 'default' : 'pointer', padding: '4px 0' }}
        >
          {refreshing ? '更新中…' : '更新'}
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {dirtyRepos.length > 0 && (
        <div className="section">
          <div className="section-header">変更あり</div>
          <div className="list">
            {dirtyRepos.map(repo => (
              <RepoItem key={repo.id} repo={repo} navigate={navigate} />
            ))}
          </div>
        </div>
      )}

      {cleanRepos.length > 0 && (
        <div className="section">
          <div className="section-header">クリーン</div>
          <div className="list">
            {cleanRepos.map(repo => (
              <RepoItem key={repo.id} repo={repo} navigate={navigate} />
            ))}
          </div>
        </div>
      )}

      {repos.length === 0 && !error && (
        <div className="empty">起動直後はサーバーがキャッシュ構築中です<br />しばらくしてから更新を押してください</div>
      )}
    </div>
  );
}

function relativeTime(unixSec: number): string {
  if (!unixSec) return '';
  const d = Math.floor(Date.now() / 1000) - unixSec;
  if (d < 60)          return 'たった今';
  if (d < 3600)        return `${Math.floor(d / 60)}分前`;
  if (d < 86400)       return `${Math.floor(d / 3600)}時間前`;
  if (d < 86400 * 30)  return `${Math.floor(d / 86400)}日前`;
  if (d < 86400 * 365) return `${Math.floor(d / 86400 / 30)}ヶ月前`;
  return `${Math.floor(d / 86400 / 365)}年前`;
}

interface RepoItemProps {
  repo: RepoSummary;
  navigate: NavigateFn;
}

function RepoItem({ repo, navigate }: RepoItemProps) {
  return (
    <div
      className="list-item"
      onClick={() => navigate({ type: 'repo', repoId: repo.id, repoName: repo.name, repoPath: repo.path })}
    >
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div className="repo-name">
          {repo.parentName && <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{repo.parentName}/</span>}
          {repo.name}
        </div>
        <span className="branch-badge" style={{ marginTop: 3, display: 'inline-block' }}>{repo.branch}</span>
      </div>
      <div className="repo-meta">
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{relativeTime(repo.lastActivityAt)}</span>
        <StatusDots
          isGitRepo={repo.isGitRepo}
          staged={repo.staged}
          unstaged={repo.unstaged}
          untracked={repo.untracked}
          clean={repo.clean}
        />
      </div>
      <span className="chevron">›</span>
    </div>
  );
}
