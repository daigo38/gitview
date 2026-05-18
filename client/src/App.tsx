import { useState, useCallback, useRef, useEffect } from 'react';
import RepoList from './components/RepoList.tsx';
import RepoDetail from './components/RepoDetail.tsx';
import FileView from './components/FileView.tsx';
import CommitView from './components/CommitView.tsx';
import type { NavigateFn, View } from './types.ts';

type Phase = 'idle' | 'entering' | 'exiting' | 'swiping';

interface ScreenContentProps {
  view: View;
  navigate: NavigateFn;
  goBack: () => void;
  canGoBack: boolean;
}

function ScreenContent({ view, navigate, goBack, canGoBack }: ScreenContentProps) {
  const [copied, setCopied] = useState(false);

  const copyText = async (text: string): Promise<void> => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  };

  const copyRepoPath = async (): Promise<void> => {
    if (view.type !== 'repo' || !view.repoPath) return;
    try {
      await copyText(view.repoPath);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (e: unknown) {
      console.error('Failed to copy repository path', e);
    }
  };

  function getTitle(): { title: string; sub: string | null } {
    switch (view.type) {
      case 'repos':  return { title: 'GitView', sub: null };
      case 'repo':   return { title: view.repoName, sub: null };
      case 'file': {
        const parts = view.filePath.split('/');
        return { title: parts[parts.length - 1] ?? view.filePath, sub: view.repoName };
      }
      case 'commit': return { title: view.shortHash, sub: view.repoName };
      default: {
        const _exhaustive: never = view;
        void _exhaustive;
        return { title: 'GitView', sub: null };
      }
    }
  }
  const { title, sub } = getTitle();

  return (
    <>
      <header className="header">
        {canGoBack && (
          <button className="header-back" onClick={goBack}>‹ 戻る</button>
        )}
        <div className="header-title">
          {title}
          {sub && <span className="header-subtitle"> — {sub}</span>}
        </div>
        {view.type === 'repo' && view.repoPath && (
          <button
            className={`header-copy-path ${copied ? 'copied' : ''}`}
            onClick={() => { void copyRepoPath(); }}
            title={copied ? 'コピー済み' : 'フォルダの絶対パスをコピー'}
            aria-label={copied ? 'フォルダの絶対パスをコピーしました' : 'フォルダの絶対パスをコピー'}
          >
            ⧉
          </button>
        )}
      </header>
      {view.type === 'repos'  && <RepoList navigate={navigate} />}
      {view.type === 'repo'   && <RepoDetail repoId={view.repoId} repoName={view.repoName} navigate={navigate} />}
      {view.type === 'file'   && <FileView repoId={view.repoId} filePath={view.filePath} initialTab={view.tab ?? 'file'} fileStatus={view.fileStatus} />}
      {view.type === 'commit' && <CommitView key={view.hash} repoId={view.repoId} hash={view.hash} />}
    </>
  );
}

interface TouchOrigin {
  x: number;
  y: number;
  ts: number;
}

export default function App() {
  const [history, setHistory] = useState<View[]>([{ type: 'repos' }]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [swipeX, setSwipeX] = useState(0);
  const [swipeSettle, setSwipeSettle] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Refs for use inside passive-false event handlers (avoid stale closures)
  const phaseRef = useRef<Phase>('idle');
  const historyLenRef = useRef<number>(1);
  const swipeActiveRef = useRef<boolean>(false);
  const touchOriginRef = useRef<TouchOrigin | null>(null);

  phaseRef.current = phase;
  historyLenRef.current = history.length;

  const current = history[history.length - 1];
  const prev    = history.length > 1 ? history[history.length - 2] : null;
  const canGoBack     = history.length > 1;
  const canPrevGoBack = history.length > 2;

  const navigate = useCallback<NavigateFn>((v) => {
    if (phaseRef.current !== 'idle') return;
    setHistory(h => [...h, v]);
    setPhase('entering');
    window.setTimeout(() => setPhase('idle'), 340);
  }, []);

  const goBack = useCallback(() => {
    if (historyLenRef.current <= 1 || phaseRef.current !== 'idle') return;
    setPhase('exiting');
    window.setTimeout(() => {
      setHistory(h => h.slice(0, -1));
      setPhase('idle');
    }, 300);
  }, []);

  // Add non-passive touchmove so we can preventDefault during horizontal swipe
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent): void => {
      if (phaseRef.current !== 'idle' || historyLenRef.current <= 1) return;
      const t = e.touches[0];
      if (!t) return;
      if (t.clientX < 32) {
        touchOriginRef.current = { x: t.clientX, y: t.clientY, ts: Date.now() };
        swipeActiveRef.current = false;
      }
    };

    const onMove = (e: TouchEvent): void => {
      const origin = touchOriginRef.current;
      if (!origin) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - origin.x;
      const dy = Math.abs(t.clientY - origin.y);

      if (!swipeActiveRef.current) {
        if (dy > Math.abs(dx)) { touchOriginRef.current = null; return; } // vertical scroll wins
        if (dx > 6) { swipeActiveRef.current = true; setPhase('swiping'); }
      }

      if (swipeActiveRef.current && dx >= 0) {
        e.preventDefault();
        setSwipeX(dx);
        setSwipeSettle(false);
      }
    };

    const onEnd = (e: TouchEvent): void => {
      const origin = touchOriginRef.current;
      if (!origin || !swipeActiveRef.current) {
        touchOriginRef.current = null;
        swipeActiveRef.current = false;
        return;
      }
      const t = e.changedTouches[0];
      if (!t) {
        touchOriginRef.current = null;
        swipeActiveRef.current = false;
        return;
      }
      const dx = t.clientX - origin.x;
      const threshold = window.innerWidth * 0.35;

      setSwipeSettle(true);

      if (dx > threshold) {
        setSwipeX(window.innerWidth);
        window.setTimeout(() => {
          setHistory(h => h.slice(0, -1));
          setSwipeX(0);
          setSwipeSettle(false);
          setPhase('idle');
        }, 260);
      } else {
        setSwipeX(0);
        window.setTimeout(() => {
          setSwipeSettle(false);
          setPhase('idle');
        }, 300);
      }

      touchOriginRef.current = null;
      swipeActiveRef.current = false;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove',  onMove,  { passive: false });
    el.addEventListener('touchend',   onEnd,   { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove',  onMove);
      el.removeEventListener('touchend',   onEnd);
    };
  }, []); // mount once; reads from refs

  const showPrev = phase === 'entering' || phase === 'exiting' || phase === 'swiping';

  // Prev screen: during entering it's pushed left (-30%), during swiping it parallax-follows
  const prevX = phase === 'swiping'
    ? `${(-30 + (swipeX / window.innerWidth) * 30).toFixed(2)}%`
    : phase === 'entering' ? '-30%'
    : '0%';
  const prevTransition = (phase === 'swiping' && swipeSettle)
    ? 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)'
    : 'none';

  // Current screen
  const currentStyle: React.CSSProperties = phase === 'swiping'
    ? {
        transform: `translateX(${swipeX}px)`,
        transition: swipeSettle ? 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)' : 'none',
      }
    : {};
  const currentClass = [
    'screen',
    phase === 'entering' ? 'screen-enter' : '',
    phase === 'exiting'  ? 'screen-exit'  : '',
    phase === 'swiping'  ? 'screen-swiping' : '',
  ].filter(Boolean).join(' ');

  if (!current) return null;

  return (
    <div className="app" ref={containerRef}>
      {showPrev && prev && (
        <div
          className="screen screen-bg"
          style={{ transform: `translateX(${prevX})`, transition: prevTransition }}
        >
          <ScreenContent view={prev} navigate={navigate} goBack={goBack} canGoBack={canPrevGoBack} />
        </div>
      )}
      <div className={currentClass} style={currentStyle}>
        <ScreenContent view={current} navigate={navigate} goBack={goBack} canGoBack={canGoBack} />
      </div>
    </div>
  );
}
