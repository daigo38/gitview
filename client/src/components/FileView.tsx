import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import DiffView from './DiffView.tsx';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus.ts';
import type { FileContentResponse, FileStatus, FileTab } from '../types.ts';

const VIDEO_EXTS = new Set<string>(['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m4v', '.ogv']);
const IMAGE_EXTS = new Set<string>(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif']);

type SyntaxTokenKind = 'comment' | 'function' | 'keyword' | 'literal' | 'number' | 'property' | 'string' | 'type';

const CODE_EXTS = new Set<string>([
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.h', '.hpp', '.html', '.java', '.js', '.jsx',
  '.json', '.kt', '.m', '.mm', '.php', '.py', '.rb', '.rs', '.scss', '.sh', '.swift', '.toml',
  '.ts', '.tsx', '.vue', '.xml', '.yaml', '.yml', '.zsh',
]);

const HASH_COMMENT_EXTS = new Set<string>(['.py', '.rb', '.sh', '.toml', '.yaml', '.yml', '.zsh']);
const HTML_EXTS = new Set<string>(['.html', '.vue', '.xml']);

const KEYWORDS = new Set<string>([
  'abstract', 'alias', 'and', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'def', 'defer', 'delete', 'do', 'else', 'elseif', 'enum', 'export', 'extends',
  'extension', 'false', 'fileprivate', 'final', 'finally', 'for', 'from', 'func', 'function',
  'guard', 'if', 'implements', 'import', 'in', 'init', 'instanceof', 'interface', 'internal',
  'is', 'lambda', 'let', 'match', 'module', 'mut', 'namespace', 'new', 'not', 'operator', 'or',
  'package', 'private', 'protected', 'protocol', 'public', 'readonly', 'return', 'self', 'static',
  'struct', 'super', 'switch', 'then', 'this', 'throw', 'throws', 'trait', 'try', 'type', 'typeof',
  'using', 'var', 'when', 'where', 'while', 'yield',
]);

const LITERALS = new Set<string>([
  'False', 'None', 'True', 'false', 'nil', 'null', 'nullptr', 'true', 'undefined',
]);

const TYPES = new Set<string>([
  'Array', 'Bool', 'Boolean', 'CGFloat', 'Double', 'Float', 'Int', 'Map', 'Number', 'Object',
  'Promise', 'Record', 'Set', 'String', 'Void', 'any', 'bool', 'boolean', 'char', 'double',
  'float', 'int', 'long', 'never', 'number', 'object', 'short', 'string', 'unknown', 'void',
]);

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

function isWordStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch);
}

function isWordPart(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

function syntaxSpan(kind: SyntaxTokenKind, text: string, key: string): React.ReactNode {
  return <span key={key} className={`syn syn-${kind}`}>{text}</span>;
}

function getWordKind(word: string, nextChar: string, prevChar: string): SyntaxTokenKind | null {
  if (LITERALS.has(word)) return 'literal';
  if (KEYWORDS.has(word)) return 'keyword';
  if (TYPES.has(word)) return 'type';
  if (nextChar === ':' || prevChar === '.') return 'property';
  if (nextChar === '(' && prevChar !== '.') return 'function';
  if (/^[A-Z][A-Za-z0-9_$]*$/.test(word)) return 'type';
  return null;
}

function renderHtmlSyntax(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const pushPlain = (value: string): void => {
    if (value) parts.push(value);
  };

  while (i < text.length) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      const next = end === -1 ? text.length : end + 3;
      parts.push(syntaxSpan('comment', text.slice(i, next), `${keyPrefix}-h-${key++}`));
      i = next;
      continue;
    }

    if (text[i] !== '<') {
      const next = text.indexOf('<', i);
      const end = next === -1 ? text.length : next;
      pushPlain(text.slice(i, end));
      i = end;
      continue;
    }

    const tagEnd = text.indexOf('>', i + 1);
    const end = tagEnd === -1 ? text.length : tagEnd + 1;
    const tagText = text.slice(i, end);
    const tagParts = tagText.match(/(\/?[A-Za-z][\w:-]*|[A-Za-z_:][\w:.-]*(?=\=)|"[^"]*"|'[^']*')/g);
    if (!tagParts) {
      pushPlain(tagText);
      i = end;
      continue;
    }

    let cursor = 0;
    for (const token of tagParts) {
      const start = tagText.indexOf(token, cursor);
      if (start > cursor) pushPlain(tagText.slice(cursor, start));
      const kind: SyntaxTokenKind =
        token[0] === '"' || token[0] === "'"
          ? 'string'
          : token.includes('/') || cursor === 0
            ? 'type'
            : 'property';
      parts.push(syntaxSpan(kind, token, `${keyPrefix}-h-${key++}`));
      cursor = start + token.length;
    }
    if (cursor < tagText.length) pushPlain(tagText.slice(cursor));
    i = end;
  }

  return parts;
}

function renderSyntax(text: string, filePath: string, keyPrefix: string): React.ReactNode {
  const ext = getExt(filePath);
  if (!CODE_EXTS.has(ext) || !text) return text || ' ';
  if (HTML_EXTS.has(ext)) return renderHtmlSyntax(text, keyPrefix);

  const parts: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const pushPlain = (value: string): void => {
    if (value) parts.push(value);
  };

  while (i < text.length) {
    const ch = text[i] ?? '';

    if (text.startsWith('//', i) || (HASH_COMMENT_EXTS.has(ext) && ch === '#')) {
      parts.push(syntaxSpan('comment', text.slice(i), `${keyPrefix}-c-${key++}`));
      break;
    }

    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      const next = end === -1 ? text.length : end + 2;
      parts.push(syntaxSpan('comment', text.slice(i, next), `${keyPrefix}-b-${key++}`));
      i = next;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      let next = i + 1;
      while (next < text.length) {
        const current = text[next];
        if (current === '\\') {
          next += 2;
          continue;
        }
        next++;
        if (current === ch) break;
      }
      const token = text.slice(i, next);
      const after = text.slice(next).trimStart();
      const kind = (ext === '.json' || ext === '.yaml' || ext === '.yml') && after.startsWith(':')
        ? 'property'
        : 'string';
      parts.push(syntaxSpan(kind, token, `${keyPrefix}-s-${key++}`));
      i = next;
      continue;
    }

    if (/\d/.test(ch) && (i === 0 || !isWordPart(text[i - 1] ?? ''))) {
      const match = text.slice(i).match(/^(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)(?:[eE][+-]?\d+)?/);
      if (match) {
        parts.push(syntaxSpan('number', match[0], `${keyPrefix}-n-${key++}`));
        i += match[0].length;
        continue;
      }
    }

    if (isWordStart(ch)) {
      let next = i + 1;
      while (next < text.length && isWordPart(text[next] ?? '')) next++;
      const word = text.slice(i, next);
      let lookahead = next;
      while (/\s/.test(text[lookahead] ?? '')) lookahead++;
      let lookbehind = i - 1;
      while (/\s/.test(text[lookbehind] ?? '')) lookbehind--;
      const kind = getWordKind(word, text[lookahead] ?? '', text[lookbehind] ?? '');
      if (kind) parts.push(syntaxSpan(kind, word, `${keyPrefix}-w-${key++}`));
      else pushPlain(word);
      i = next;
      continue;
    }

    const nextSpecial = text.slice(i + 1).search(/\/\/|\/\*|["'`#\dA-Za-z_$]/);
    const end = nextSpecial === -1 ? text.length : i + 1 + nextSpecial;
    pushPlain(text.slice(i, end));
    i = end;
  }

  return parts.length > 0 ? <>{parts}</> : (text || ' ');
}

// 1 行を { query にマッチした箇所 } 付きで描画する
function renderLine(
  line: string,
  lineMatches: Match[],
  currentMatchIdx: number,
  filePath: string,
): React.ReactNode {
  if (lineMatches.length === 0) return renderSyntax(line, filePath, 'line');
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const m of lineMatches) {
    if (m.start > cursor) {
      parts.push(renderSyntax(line.slice(cursor, m.start), filePath, `p-${m.matchIdx}-${cursor}`));
    }
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
  if (cursor < line.length) {
    parts.push(renderSyntax(line.slice(cursor), filePath, `p-tail-${cursor}`));
  }
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

  const scrollToMatch = useCallback((matchIndex: number) => {
    const m = allMatches[matchIndex];
    if (!m) return;
    const el = document.getElementById(`match-${m.matchIdx}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [allMatches]);

  // currentMatchIdx 変更時に該当マッチへスクロール
  useEffect(() => {
    if (allMatches.length === 0) return;
    scrollToMatch(currentMatchIdx);
  }, [currentMatchIdx, allMatches, scrollToMatch]);

  const gotoMatch = useCallback((nextIdx: number) => {
    if (allMatches.length === 0) return;
    const normalized = (nextIdx + allMatches.length) % allMatches.length;
    if (normalized === currentMatchIdx) {
      scrollToMatch(normalized);
      return;
    }
    setCurrentMatchIdx(normalized);
  }, [allMatches.length, currentMatchIdx, scrollToMatch]);

  const gotoPrev = useCallback(() => {
    gotoMatch(currentMatchIdx - 1);
  }, [currentMatchIdx, gotoMatch]);

  const gotoNext = useCallback(() => {
    gotoMatch(currentMatchIdx + 1);
  }, [currentMatchIdx, gotoMatch]);

  useEffect(() => {
    if (allMatches.length === 0) return;
    if (currentMatchIdx >= allMatches.length) {
      setCurrentMatchIdx(0);
    }
  }, [currentMatchIdx, allMatches]);

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
                  {renderLine(line, lineMatches, allMatches[currentMatchIdx]?.matchIdx ?? -1, filePath)}
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
