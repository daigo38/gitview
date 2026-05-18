import { useState, useEffect, useCallback } from 'react';
import type { NavigateFn, TreeEntry } from '../types.ts';

interface TreeNodeProps {
  entry: TreeEntry;
  repoId: string;
  repoName: string;
  navigate: NavigateFn;
  depth?: number;
}

function TreeNode({ entry, repoId, repoName, navigate, depth = 0 }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<TreeEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (entry.type !== 'dir') {
      navigate({ type: 'file', repoId, repoName, filePath: entry.path, tab: 'file' });
      return;
    }
    if (!expanded && children === null) {
      setLoading(true);
      try {
        const res = await fetch(`/api/repos/${repoId}/tree?path=${encodeURIComponent(entry.path)}`);
        const data = (await res.json()) as TreeEntry[];
        setChildren(data);
      } catch {
        // failed to load — leave children null so user can retry
      }
      setLoading(false);
    }
    setExpanded(e => !e);
  }, [expanded, children, entry, repoId, repoName, navigate]);

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

interface FileTreeProps {
  repoId: string;
  repoName: string;
  navigate: NavigateFn;
}

export default function FileTree({ repoId, repoName, navigate }: FileTreeProps) {
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
  }, [repoId]);

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
        />
      ))}
    </div>
  );
}
