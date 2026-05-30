import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import DiffView from './DiffView.tsx';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus.ts';
import type { FileContentResponse, FileStatus, FileTab } from '../types.ts';

const VIDEO_EXTS = new Set<string>(['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m4v', '.ogv']);
const IMAGE_EXTS = new Set<string>(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif']);

function getExt(filePath: string): string {
  const i = filePath.lastIndexOf('.');
  return i >= 0 ? filePath.slice(i).toLowerCase() : '';
}

interface MediaProps {
  repoId: string;
  filePath: string;
  refreshToken: number;
}

function getRawSrc(repoId: string, filePath: string, refreshToken: number): string {
  const params = new URLSearchParams({ path: filePath });
  if (refreshToken > 0) params.set('v', String(refreshToken));
  return `/api/repos/${repoId}/raw?${params.toString()}`;
}

function VideoPlayer({ repoId, filePath, refreshToken }: MediaProps) {
  const src = getRawSrc(repoId, filePath, refreshToken);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px', height: '100%' }}>
      <video
        src={src}
        controls
        style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '4px' }}
      />
    </div>
  );
}

function ImageViewer({ repoId, filePath, refreshToken }: MediaProps) {
  const src = getRawSrc(repoId, filePath, refreshToken);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px', height: '100%' }}>
      <img
        src={src}
        alt={filePath}
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px' }}
      />
    </div>
  );
}

interface Match {
  lineIdx: number;     // 0-based
  start: number;       // 列開始
  end: number;
  matchIdx: number;    // 全マッチ中の通し番号
}

// 1 行を { query にマッチした箇所 } 付きで描画する
function renderLine(
  line: string,
  lineMatches: Match[],
  currentMatchIdx: number,
): React.ReactNode {
  if (lineMatches.length === 0) return line || ' ';
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const m of lineMatches) {
    if (m.start > cursor) parts.push(line.slice(cursor, m.start));
    const isCurrent = m.matchIdx === currentMatchIdx;
    parts.push(
      <mark
        key={`m-${m.matchIdx}`}
        id={`match-${m.matchIdx}`}
        className={isCurrent ? 'search-hit search-hit-current' : 'search-hit'}
      >
        {line.slice(m.start, m.end)}
      </mark>,
    );
    cursor = m.end;
  }
  if (cursor < line.length) parts.push(line.slice(cursor));
  return <>{parts}</>;
}

interface FileContentProps {
  repoId: string;
  filePath: string;
  initialLine?: number;
  initialQuery?: string;
  active: boolean;
  searchFocusToken?: number;
}

function FileContent({ repoId, filePath, initialLine, initialQuery, active, searchFocusToken = 0 }: FileContentProps) {
  const ext = getExt(filePath);
  const isVideo = VIDEO_EXTS.has(ext);
  const isImage = IMAGE_EXTS.has(ext);

  const [data, setData] = useState<FileContentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(initialQuery ?? '');
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const [highlightLine, setHighlightLine] = useState<number | null>(initialLine ?? null);
  const [refreshToken, setRefreshToken] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback((showLoading = true) => {
    if (isVideo || isImage) return;
    if (showLoading) {
      setLoading(true);
      setData(null);
    }
    return fetch(`/api/repos/${repoId}/file?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json() as Promise<FileContentResponse>)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [repoId, filePath, isVideo, isImage]);

  useEffect(() => {
    void load();
  }, [load]);

  useRefreshOnFocus(active, () => {
    if (isVideo || isImage) {
      setRefreshToken(t => t + 1);
      return;
    }
    return load(false);
  });

  useEffect(() => {
    if (!active || searchFocusToken === 0 || loading) return;
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [active, searchFocusToken, loading]);

  const lines = useMemo(
    () => (data?.content ?? '').split('\n'),
    [data],
  );

  // クエリにマッチする全箇所を列挙（行ごとに lineMatches も同時に作る）
  const { allMatches, byLine } = useMemo(() => {
    const all: Match[] = [];
    const map = new Map<number, Match[]>();
    const q = query.trim();
    if (!q || !data || data.binary) return { allMatches: all, byLine: map };
    const lq = q.toLowerCase();
    let counter = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const lower = line.toLowerCase();
      let start = 0;
      let lineHits: Match[] | undefined;
      while (true) {
        const idx = lower.indexOf(lq, start);
        if (idx === -1) break;
        const m: Match = { lineIdx: i, start: idx, end: idx + lq.length, matchIdx: counter++ };
        all.push(m);
        if (!lineHits) {
          lineHits = [];
          map.set(i, lineHits);
        }
        lineHits.push(m);
        start = idx + lq.length;
      }
    }
    return { allMatches: all, byLine: map };
  }, [lines, query, data]);

  // クエリ変更時: 一旦先頭マッチへ
  useEffect(() => {
    setCurrentMatchIdx(0);
  }, [query]);

  // 行ジャンプ: data ロード完了 + initialLine 指定で対象行へスクロール
  useEffect(() => {
    if (loading || !data || data.binary) return;
    if (initialLine && initialLine >= 1 && initialLine <= lines.length) {
      // レイアウト確定後に scrollIntoView
      requestAnimationFrame(() => {
        const el = document.getElementById(`fline-${initialLine}`);
        el?.scrollIntoView({ block: 'center' });
        setHighlightLine(initialLine);
        // 1.6 秒後にハイライト消去
        window.setTimeout(() => setHighlightLine(null), 1600);
      });
    }
    // initialLine は初回ロード時のみ反映
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, data]);

  // currentMatchIdx 変更時に該当マッチへスクロール
  useEffect(() => {
    if (allMatches.length === 0) return;
    const m = allMatches[currentMatchIdx];
    if (!m) return;
    const el = document.getElementById(`match-${m.matchIdx}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentMatchIdx, allMatches]);

  const gotoPrev = useCallback(() => {
    if (allMatches.length === 0) return;
    setCurrentMatchIdx(i => (i - 1 + allMatches.length) % allMatches.length);
  }, [allMatches.length]);

  const gotoNext = useCallback(() => {
    if (allMatches.length === 0) return;
    setCurrentMatchIdx(i => (i + 1) % allMatches.length);
  }, [allMatches.length]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) gotoPrev();
      else gotoNext();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      gotoNext();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      gotoPrev();
    }
  }, [gotoNext, gotoPrev]);

  if (isVideo) return <VideoPlayer repoId={repoId} filePath={filePath} refreshToken={refreshToken} />;
  if (isImage) return <ImageViewer repoId={repoId} filePath={filePath} refreshToken={refreshToken} />;
  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (!data) return <div className="error-msg">読み込みエラー</div>;
  if (data.binary) return (
    <div className="empty">
      バイナリファイル ({formatSize(data.size)})
    </div>
  );

  const hasQuery = query.trim().length > 0;
  const matchCount = allMatches.length;

  return (
    <>
      <div className="file-search-bar">
        <span className="search-icon">🔎</span>
        <input
          ref={searchInputRef}
          type="search"
          inputMode="search"
          className="search-input"
          placeholder="ファイル内を検索…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {hasQuery && (
          <>
            <span className="file-search-count">
              {matchCount > 0 ? `${currentMatchIdx + 1}/${matchCount}` : '0'}
            </span>
            <button
              className="file-search-nav"
              onClick={gotoPrev}
              disabled={matchCount === 0}
              aria-label="前のマッチ"
            >↑</button>
            <button
              className="file-search-nav"
              onClick={gotoNext}
              disabled={matchCount === 0}
              aria-label="次のマッチ"
            >↓</button>
            <button
              className="search-clear"
              onClick={() => setQuery('')}
              aria-label="クリア"
            >×</button>
          </>
        )}
      </div>
      <div className="diff-container" ref={scrollRef}>
        <div className="file-content" style={{ padding: 0 }}>
          {lines.map((line, i) => {
            const lineNum = i + 1;
            const lineMatches = byLine.get(i) ?? [];
            const isCurrentMatchLine =
              hasQuery && allMatches[currentMatchIdx]?.lineIdx === i;
            const isHighlight = highlightLine === lineNum;
            const cls = [
              'diff-line',
              isCurrentMatchLine ? 'diff-line-current-match' : '',
              isHighlight ? 'diff-line-jump' : '',
            ].filter(Boolean).join(' ');
            return (
              <div className={cls} key={i} id={`fline-${lineNum}`}>
                <span className="diff-line-num">{lineNum}</span>
                <span className="diff-line-content">
                  {renderLine(line, lineMatches, allMatches[currentMatchIdx]?.matchIdx ?? -1)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

interface FileViewProps {
  repoId: string;
  filePath: string;
  initialTab: FileTab;
  fileStatus?: FileStatus;
  initialLine?: number;
  initialQuery?: string;
  active: boolean;
}

interface TabDef {
  key: FileTab;
  label: string;
}

export default function FileView({
  repoId,
  filePath,
  initialTab,
  fileStatus,
  initialLine,
  initialQuery,
  active,
}: FileViewProps) {
  const hasStaged = fileStatus?.isStaged ?? false;
  const hasUnstaged = fileStatus?.isUnstaged ?? false;
  const isUntracked = fileStatus?.isUntracked ?? false;

  const availableTabs: TabDef[] = [
    { key: 'file', label: 'ファイル' },
    ...(!isUntracked && hasUnstaged ? [{ key: 'diff' as const, label: 'Diff' }] : []),
    ...(!isUntracked && hasStaged ? [{ key: 'staged' as const, label: 'Staged Diff' }] : []),
  ];

  const [tab, setTab] = useState<FileTab>(() => {
    if (availableTabs.find(t => t.key === initialTab)) return initialTab;
    return availableTabs[0]?.key ?? 'file';
  });
  const [searchFocusToken, setSearchFocusToken] = useState(0);

  const focusFileSearch = useCallback(() => {
    setTab('file');
    setSearchFocusToken(t => t + 1);
  }, []);

  useEffect(() => {
    if (!active) return;

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return;
      const modifier = e.metaKey || e.ctrlKey;
      if (!modifier || e.altKey || e.shiftKey) return;

      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        focusFileSearch();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, focusFileSearch]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {availableTabs.length > 1 && (
        <div className="tabs">
          {availableTabs.map(t => (
            <button
              key={t.key}
              className={`tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="scroll-area">
        {tab === 'file' && (
          <FileContent
            repoId={repoId}
            filePath={filePath}
            initialLine={initialLine}
            initialQuery={initialQuery}
            active={active && tab === 'file'}
            searchFocusToken={searchFocusToken}
          />
        )}
        {tab === 'diff' && (
          <DiffView repoId={repoId} filePath={filePath} staged={false} active={active && tab === 'diff'} />
        )}
        {tab === 'staged' && (
          <DiffView repoId={repoId} filePath={filePath} staged={true} active={active && tab === 'staged'} />
        )}
      </div>
    </div>
  );
}
