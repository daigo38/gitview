import { useState, useEffect } from 'react';
import DiffView from './DiffView.tsx';
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
}

function VideoPlayer({ repoId, filePath }: MediaProps) {
  const src = `/api/repos/${repoId}/raw?path=${encodeURIComponent(filePath)}`;
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

function ImageViewer({ repoId, filePath }: MediaProps) {
  const src = `/api/repos/${repoId}/raw?path=${encodeURIComponent(filePath)}`;
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

interface FileContentProps {
  repoId: string;
  filePath: string;
}

function FileContent({ repoId, filePath }: FileContentProps) {
  const ext = getExt(filePath);
  const isVideo = VIDEO_EXTS.has(ext);
  const isImage = IMAGE_EXTS.has(ext);

  const [data, setData] = useState<FileContentResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isVideo || isImage) return;
    setLoading(true);
    setData(null);
    fetch(`/api/repos/${repoId}/file?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json() as Promise<FileContentResponse>)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [repoId, filePath, isVideo, isImage]);

  if (isVideo) return <VideoPlayer repoId={repoId} filePath={filePath} />;
  if (isImage) return <ImageViewer repoId={repoId} filePath={filePath} />;
  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (!data) return <div className="error-msg">読み込みエラー</div>;
  if (data.binary) return (
    <div className="empty">
      バイナリファイル ({formatSize(data.size)})
    </div>
  );

  const lines = (data.content ?? '').split('\n');

  return (
    <div className="diff-container">
      <div className="file-content" style={{ padding: 0 }}>
        {lines.map((line, i) => (
          <div className="diff-line" key={i}>
            <span className="diff-line-num">{i + 1}</span>
            <span className="diff-line-content">{line || ' '}</span>
          </div>
        ))}
      </div>
    </div>
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
}

interface TabDef {
  key: FileTab;
  label: string;
}

export default function FileView({ repoId, filePath, initialTab, fileStatus }: FileViewProps) {
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
          <FileContent repoId={repoId} filePath={filePath} />
        )}
        {tab === 'diff' && (
          <DiffView repoId={repoId} filePath={filePath} staged={false} />
        )}
        {tab === 'staged' && (
          <DiffView repoId={repoId} filePath={filePath} staged={true} />
        )}
      </div>
    </div>
  );
}
