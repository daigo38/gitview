import { useState, useEffect } from 'react';

type DiffLineType = 'added' | 'removed' | 'context';

interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffResponse {
  diff?: string;
}

function parseDiff(diffText: string): DiffHunk[] {
  if (!diffText) return [];
  const lines = diffText.split('\n');
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of lines) {
    if (raw.startsWith('diff --git') || raw.startsWith('index ') || raw.startsWith('--- ') || raw.startsWith('+++ ')) {
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m && m[1] !== undefined && m[2] !== undefined) {
        oldLine = parseInt(m[1], 10);
        newLine = parseInt(m[2], 10);
      }
      currentHunk = { header: raw, lines: [] };
      hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) continue;

    if (raw.startsWith('+')) {
      currentHunk.lines.push({ type: 'added', content: raw.slice(1), newLineNum: newLine++ });
    } else if (raw.startsWith('-')) {
      currentHunk.lines.push({ type: 'removed', content: raw.slice(1), oldLineNum: oldLine++ });
    } else if (raw.startsWith('\\')) {
      // "No newline at end of file" notice
    } else {
      currentHunk.lines.push({ type: 'context', content: raw.slice(1), oldLineNum: oldLine++, newLineNum: newLine++ });
    }
  }

  return hunks;
}

interface DiffViewProps {
  repoId: string;
  filePath: string;
  staged: boolean;
}

export default function DiffView({ repoId, filePath, staged }: DiffViewProps) {
  const [diff, setDiff] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ path: filePath, staged: staged.toString() });
    fetch(`/api/repos/${repoId}/diff?${params.toString()}`)
      .then(r => r.json() as Promise<DiffResponse>)
      .then(d => { setDiff(d.diff ?? ''); setLoading(false); })
      .catch(() => setLoading(false));
  }, [repoId, filePath, staged]);

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  if (!diff) {
    return <div className="empty">{staged ? 'Staged の差分なし' : '差分なし'}</div>;
  }

  const hunks = parseDiff(diff);

  return (
    <div className="diff-container">
      {hunks.map((hunk, hi) => (
        <div key={hi} className="diff-hunk">
          <div className="diff-line hunk">
            <span className="diff-line-num">…</span>
            <span className="diff-line-content">{hunk.header}</span>
          </div>
          {hunk.lines.map((line, li) => (
            <div key={li} className={`diff-line ${line.type}`}>
              <span className="diff-line-num">
                {line.type === 'added' ? line.newLineNum : (line.type === 'removed' ? line.oldLineNum : line.newLineNum)}
              </span>
              <span className="diff-line-content">
                {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                {line.content}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
