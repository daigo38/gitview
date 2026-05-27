import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus.ts';
import type { NavigateFn, SearchMatch, SearchResult, TreeEntry } from '../types.ts';

interface TreeNodeProps {
  entry: TreeEntry;
  repoId: string;
  repoName: string;
  navigate: NavigateFn;
  depth?: number;
  refreshToken: number;
}

function TreeNode({ entry, repoId, repoName, navigate, depth = 0, refreshToken }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<TreeEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const lastRefreshTokenRef = useRef(refreshToken);

  const loadChildren = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/repos/${repoId}/tree?path=${encodeURIComponent(entry.path)}`);
      const data = (await res.json()) as TreeEntry[];
      setChildren(data);
    } catch {
      // failed to load — leave existing children so the current hierarchy stays visible
    } finally {
      setLoading(false);
    }
  }, [entry.path, repoId]);

  const toggle = useCallback(async () => {
    if (entry.type !== 'dir') {
      navigate({ type: 'file', repoId, repoName, filePath: entry.path, tab: 'file' });
      return;
    }
    if (!expanded && children === null) {
      await loadChildren();
    }
    setExpanded(e => !e);
  }, [expanded, children, entry, repoId, repoName, navigate, loadChildren]);

  useEffect(() => {
    if (lastRefreshTokenRef.current === refreshToken) return;
    lastRefreshTokenRef.current = refreshToken;
    if (entry.type !== 'dir' || !expanded) return;
    void loadChildren();
  }, [entry.type, expanded, loadChildren, refreshToken]);

  const icon = entry.type === 'dir'
    ? (expanded ? '📂' : '📁')
    : getFileIcon(entry.name);

  return (
    <>
      <div
        className={`tree-item ${entry.type}`}
        style={{ paddingLeft: `${16 + depth * 16}px` }}
        onClick={() => { void toggle(); }}
      >
        <span className="tree-icon">{loading ? '⏳' : icon}</span>
        <span className="tree-name">{entry.name}{entry.type === 'dir' ? '/' : ''}</span>
        {entry.type === 'dir' && (
          <span className="chevron">{expanded ? '∨' : '›'}</span>
        )}
      </div>
      {expanded && children && children.map(child => (
        <TreeNode
          key={child.path}
          entry={child}
          repoId={repoId}
          repoName={repoName}
          navigate={navigate}
          depth={depth + 1}
          refreshToken={refreshToken}
        />
      ))}
    </>
  );
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

// クエリにマッチする部分をハイライトして React node に変換
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

interface SearchResultsProps {
  repoId: string;
  repoName: string;
  query: string;
  navigate: NavigateFn;
  refreshToken: number;
}

function SearchResults({ repoId, repoName, query, navigate, refreshToken }: SearchResultsProps) {
  const [data, setData] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/repos/${repoId}/search?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
      .then(async r => {
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<SearchResult>;
      })
      .then(d => { setData(d); setLoading(false); })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => controller.abort();
  }, [repoId, query, refreshToken]);

  // ファイルごとにグループ化（順序を保つため Map を使う）
  const grouped = useMemo(() => {
    const map = new Map<string, SearchMatch[]>();
    for (const m of data?.matches ?? []) {
      const arr = map.get(m.path);
      if (arr) arr.push(m);
      else map.set(m.path, [m]);
    }
    return [...map.entries()];
  }, [data]);

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (error) return <div className="error-msg">{error}</div>;
  if (!data || data.matches.length === 0) {
    return <div className="empty">マッチなし</div>;
  }

  return (
    <div className="list">
      <div className="search-summary">
        {data.matches.length} 件 / {grouped.length} ファイル
        {data.truncated && ' (一部のみ表示)'}
      </div>
      {grouped.map(([filePath, items]) => (
        <div key={filePath} className="search-file-group">
          <div
            className="search-file-header"
            onClick={() => navigate({ type: 'file', repoId, repoName, filePath, tab: 'file', query })}
          >
            <span className="tree-icon">{getFileIcon(filePath.split('/').pop() ?? '')}</span>
            <span className="search-file-path">{filePath}</span>
            <span className="search-file-count">{items.length}</span>
          </div>
          {items.map(m => (
            <div
              key={`${filePath}:${m.line}`}
              className="search-match"
              onClick={() => navigate({
                type: 'file', repoId, repoName, filePath, tab: 'file',
                line: m.line, query,
              })}
            >
              <span className="search-line-num">{m.line}</span>
              <span className="search-line-text">{highlightMatch(m.text, query)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

interface TreeViewProps {
  repoId: string;
  repoName: string;
  navigate: NavigateFn;
  refreshToken: number;
}

function TreeView({ repoId, repoName, navigate, refreshToken }: TreeViewProps) {
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/repos/${repoId}/tree`)
      .then(r => r.json() as Promise<TreeEntry[]>)
      .then(data => { setEntries(data); setLoading(false); })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, [repoId, refreshToken]);

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (error) return <div className="error-msg">{error}</div>;

  return (
    <div className="list">
      {entries.map(entry => (
        <TreeNode
          key={entry.path}
          entry={entry}
          repoId={repoId}
          repoName={repoName}
          navigate={navigate}
          depth={0}
          refreshToken={refreshToken}
        />
      ))}
    </div>
  );
}

interface FileTreeProps {
  repoId: string;
  repoName: string;
  navigate: NavigateFn;
  active: boolean;
}

export default function FileTree({ repoId, repoName, navigate, active }: FileTreeProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const showSearch = debounced.length > 0;

  useRefreshOnFocus(active, () => setRefreshToken(t => t + 1));

  return (
    <>
      <div className="search-bar">
        <span className="search-icon">🔎</span>
        <input
          type="search"
          inputMode="search"
          className="search-input"
          placeholder="このリポジトリ内を全文検索…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {query && (
          <button
            className="search-clear"
            onClick={() => setQuery('')}
            aria-label="クリア"
          >
            ×
          </button>
        )}
      </div>
      {showSearch ? (
        <SearchResults repoId={repoId} repoName={repoName} query={debounced} navigate={navigate} refreshToken={refreshToken} />
      ) : (
        <TreeView repoId={repoId} repoName={repoName} navigate={navigate} refreshToken={refreshToken} />
      )}
    </>
  );
}
