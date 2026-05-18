import { useState, useEffect, useCallback } from 'react';
import type { CommitDetail } from '../types.ts';

type DiffLineType = 'added' | 'removed' | 'context';

interface CommitDiffLine {
  type: DiffLineType;
  content: string;
  num: number;
}

interface CommitHunk {
  header: string;
  lines: CommitDiffLine[];
}

interface CommitFileDiff {
  file: string;
  hunks: CommitHunk[];
  added: number;
  removed: number;
}

function parseCommitDiff(diffText: string): CommitFileDiff[] {
  if (!diffText.trim()) return [];
  const files: CommitFileDiff[] = [];
  let current: CommitFileDiff | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      if (current) files.push(current);
      const m = raw.match(/diff --git a\/.+ b\/(.+)/);
      current = { file: m?.[1] ?? '', hunks: [], added: 0, removed: 0 };
      oldLine = 0; newLine = 0;
    } else if (!current) {
      continue;
    } else if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m && m[1] !== undefined && m[2] !== undefined) {
        oldLine = parseInt(m[1], 10);
        newLine = parseInt(m[2], 10);
      }
      current.hunks.push({ header: raw, lines: [] });
    } else if (
      raw.startsWith('--- ') || raw.startsWith('+++ ') || raw.startsWith('index ') ||
      raw.startsWith('\\') || raw.startsWith('new file') || raw.startsWith('deleted file') ||
      raw.startsWith('rename ') || raw.startsWith('old mode') || raw.startsWith('new mode') ||
      raw.startsWith('Binary ')
    ) {
      // skip metadata
    } else if (current.hunks.length) {
      const hunk = current.hunks[current.hunks.length - 1];
      if (!hunk) continue;
      if (raw.startsWith('+')) {
        hunk.lines.push({ type: 'added', content: raw.slice(1), num: newLine++ });
        current.added++;
      } else if (raw.startsWith('-')) {
        hunk.lines.push({ type: 'removed', content: raw.slice(1), num: oldLine++ });
        current.removed++;
      } else {
        hunk.lines.push({ type: 'context', content: raw.slice(1), num: newLine++ });
        oldLine++;
      }
    }
  }
  if (current) files.push(current);
  return files;
}

interface FileDiffProps {
  file: CommitFileDiff;
  defaultOpen: boolean;
}

function FileDiff({ file, defaultOpen }: FileDiffProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="commit-file-block">
      <button className="commit-file-toggle" onClick={() => setOpen(o => !o)}>
        <span className="commit-file-toggle-icon">{open ? '▾' : '▸'}</span>
        <span className="commit-file-toggle-name">{file.file}</span>
        <span className="commit-file-stats">
          {file.added > 0 && <span className="stat-added">+{file.added}</span>}
          {file.removed > 0 && <span className="stat-removed">-{file.removed}</span>}
        </span>
      </button>

      {open && (
        <div className="diff-container">
          {file.hunks.map((hunk, hi) => (
            <div key={hi} className="diff-hunk">
              <div className="diff-line hunk">
                <span className="diff-line-num">…</span>
                <span className="diff-line-content">{hunk.header}</span>
              </div>
              {hunk.lines.map((line, li) => (
                <div key={li} className={`diff-line ${line.type}`}>
                  <span className="diff-line-num">{line.num}</span>
                  <span className="diff-line-content">
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                    {line.content}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface CommitViewProps {
  repoId: string;
  hash: string;
}

export default function CommitView({ repoId, hash }: CommitViewProps) {
  const [data, setData] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [toggleKey, setToggleKey] = useState(0);

  useEffect(() => {
    setAllOpen(false);
    setToggleKey(0);
    setLoading(true);
    setError(null);
    fetch(`/api/repos/${repoId}/commits/${hash}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<CommitDetail>; })
      .then(d => { setData(d); setLoading(false); })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, [repoId, hash]);

  const toggleAll = useCallback(() => {
    setAllOpen(o => !o);
    setToggleKey(k => k + 1); // force remount of FileDiff components
  }, []);

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
  if (!data) return null;

  const files = parseCommitDiff(data.diff);

  return (
    <div className="scroll-area">
      <div className="commit-meta">
        <div className="commit-hash-large">{data.shortHash}</div>
        <div className="commit-subject-large">{data.subject}</div>
        {data.body && <div className="commit-body">{data.body}</div>}
        <div className="commit-author">{data.author} · {data.date}</div>
      </div>

      {files.length === 0 && <div className="empty">差分なし</div>}

      {files.length > 0 && (
        <div className="commit-files-header">
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{files.length}ファイル変更</span>
          <button className="section-bulk-btn" onClick={toggleAll}>
            {allOpen ? '全て閉じる' : '全て開く'}
          </button>
        </div>
      )}

      {files.map((f, fi) => (
        <FileDiff key={`${fi}-${toggleKey}`} file={f} defaultOpen={allOpen} />
      ))}
    </div>
  );
}
