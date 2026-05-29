import { useState, useCallback, useRef, useEffect } from 'react';
import RepoList from './components/RepoList.tsx';
import RepoDetail from './components/RepoDetail.tsx';
import FileView from './components/FileView.tsx';
import CommitView from './components/CommitView.tsx';
import type { NavigateFn, View } from './types.ts';

type Phase = 'idle' | 'entering' | 'exiting' | 'swiping';

const DESKTOP_QUERY = '(min-width: 960px)';
const NAV_STATE_KEY = 'gitview:navigation';

interface NavigationState {
  key: typeof NAV_STATE_KEY;
  stack: View[];
  index: number;
}

function isNavigationState(value: unknown): value is NavigationState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<NavigationState>;
  return candidate.key === NAV_STATE_KEY && Array.isArray(candidate.stack) && typeof candidate.index === 'number';
}

const HORIZONTAL_SCROLL_NAV_BLOCK_SELECTOR = '.diff-container, .file-content';

function isFromHorizontalScrollRegion(target: EventTarget | null, root: HTMLElement): boolean {
  if (!(target instanceof Element)) return false;

  let el: Element | null = target;
  while (el) {
    if (el.matches(HORIZONTAL_SCROLL_NAV_BLOCK_SELECTOR)) return true;

    if (el instanceof HTMLElement) {
      const overflowX = window.getComputedStyle(el).overflowX;
      const scrollsHorizontally = el.scrollWidth > el.clientWidth + 1;
      if (scrollsHorizontally && ['auto', 'scroll', 'overlay'].includes(overflowX)) {
        return true;
      }
    }

    if (el === root) break;
    el = el.parentElement;
  }

  return false;
}

function resetWheelGesture(gesture: WheelGesture): void {
  gesture.x = 0;
  gesture.y = 0;
  gesture.lastAt = 0;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  ));

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

function getViewKey(view: View): string {
  switch (view.type) {
    case 'repos':
      return 'repos';
    case 'repo':
      return `repo:${view.repoId}`;
    case 'file':
      return [
        'file',
        view.repoId,
        view.filePath,
        view.tab ?? '',
        view.line ?? '',
        view.query ?? '',
      ].join(':');
    case 'commit':
      return `commit:${view.repoId}:${view.hash}`;
    default: {
      const _exhaustive: never = view;
      void _exhaustive;
      return 'unknown';
    }
  }
}

interface ScreenContentProps {
  view: View;
  navigate: NavigateFn;
  active: boolean;
  onBackToRepoList: () => void;
}

function ScreenContent({ view, navigate, active, onBackToRepoList }: ScreenContentProps) {
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

  const copyFilePath = async (): Promise<void> => {
    if (view.type !== 'file') return;
    const filePath = view.repoPath
      ? `${view.repoPath.replace(/\/$/, '')}/${view.filePath}`
      : view.filePath;
    try {
      await copyText(filePath);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (e: unknown) {
      console.error('Failed to copy file path', e);
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
        {view.type === 'repo' && (
          <button
            className="header-back"
            onClick={onBackToRepoList}
            title="リポジトリ一覧に戻る"
            aria-label="リポジトリ一覧に戻る"
          >
            ‹
          </button>
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
        {view.type === 'file' && (
          <button
            className={`header-copy-path ${copied ? 'copied' : ''}`}
            onClick={() => { void copyFilePath(); }}
            title={copied ? 'コピー済み' : 'ファイルパスをコピー'}
            aria-label={copied ? 'ファイルパスをコピーしました' : 'ファイルパスをコピー'}
          >
            ⧉
          </button>
        )}
      </header>
      {view.type === 'repos'  && <RepoList navigate={navigate} active={active} />}
      {view.type === 'repo'   && <RepoDetail repoId={view.repoId} repoName={view.repoName} repoPath={view.repoPath} navigate={navigate} active={active} />}
      {view.type === 'file'   && <FileView repoId={view.repoId} filePath={view.filePath} initialTab={view.tab ?? 'file'} fileStatus={view.fileStatus} initialLine={view.line} initialQuery={view.query} active={active} />}
      {view.type === 'commit' && <CommitView key={view.hash} repoId={view.repoId} hash={view.hash} active={active} />}
    </>
  );
}

interface TouchOrigin {
  x: number;
  y: number;
  ts: number;
}

interface WheelGesture {
  x: number;
  y: number;
  lastAt: number;
}

export default function App() {
  const [history, setHistory] = useState<View[]>([{ type: 'repos' }]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [swipeX, setSwipeX] = useState(0);
  const [swipeSettle, setSwipeSettle] = useState(false);
  const isDesktopLayout = useMediaQuery(DESKTOP_QUERY);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Refs for use inside passive-false event handlers (avoid stale closures)
  const phaseRef = useRef<Phase>('idle');
  const historyLenRef = useRef<number>(1);
  const desktopLayoutRef = useRef<boolean>(false);
  const navIndexRef = useRef<number>(0);
  const maxNavIndexRef = useRef<number>(0);
  const swipeActiveRef = useRef<boolean>(false);
  const touchOriginRef = useRef<TouchOrigin | null>(null);
  const wheelGestureRef = useRef<WheelGesture>({ x: 0, y: 0, lastAt: 0 });
  const lastWheelNavigationAtRef = useRef(0);

  phaseRef.current = phase;
  historyLenRef.current = history.length;
  desktopLayoutRef.current = isDesktopLayout;

  useEffect(() => {
    const state = window.history.state;
    if (isNavigationState(state)) {
      navIndexRef.current = state.index;
      maxNavIndexRef.current = Math.max(maxNavIndexRef.current, state.index);
      setHistory(state.stack);
      return;
    }
    const initialState: NavigationState = {
      key: NAV_STATE_KEY,
      stack: [{ type: 'repos' }],
      index: 0,
    };
    window.history.replaceState(initialState, '');
  }, []);

  const pushNavigationState = useCallback((stack: View[]) => {
    const index = navIndexRef.current + 1;
    navIndexRef.current = index;
    maxNavIndexRef.current = index;
    window.history.pushState({ key: NAV_STATE_KEY, stack, index } satisfies NavigationState, '');
  }, []);

  const navigate = useCallback<NavigateFn>((v) => {
    if (!desktopLayoutRef.current && phaseRef.current !== 'idle') return;
    setHistory(h => {
      const next = [...h, v];
      pushNavigationState(next);
      return next;
    });
    if (desktopLayoutRef.current) return;
    setPhase('entering');
    window.setTimeout(() => setPhase('idle'), 340);
  }, [pushNavigationState]);

  const navigateFromSidebar = useCallback<NavigateFn>((v) => {
    setHistory(h => {
      const next = h.length <= 1 ? [...h, v] : [...h.slice(0, -1), v];
      pushNavigationState(next);
      return next;
    });
  }, [pushNavigationState]);

  const backToRepoList = useCallback(() => {
    if (!desktopLayoutRef.current && phaseRef.current !== 'idle') return;

    const stack: View[] = [{ type: 'repos' }];
    window.history.replaceState({
      key: NAV_STATE_KEY,
      stack,
      index: navIndexRef.current,
    } satisfies NavigationState, '');

    if (!desktopLayoutRef.current && historyLenRef.current > 1) {
      setPhase('exiting');
      window.setTimeout(() => {
        setHistory(stack);
        setSwipeX(0);
        setSwipeSettle(false);
        setPhase('idle');
      }, 280);
      return;
    }

    setHistory(stack);
    setSwipeX(0);
    setSwipeSettle(false);
    setPhase('idle');
  }, []);

  useEffect(() => {
    const onPopState = (e: PopStateEvent): void => {
      if (!isNavigationState(e.state)) return;
      const nextIndex = e.state.index;
      const currentIndex = navIndexRef.current;
      navIndexRef.current = nextIndex;
      maxNavIndexRef.current = Math.max(maxNavIndexRef.current, nextIndex);

      if (desktopLayoutRef.current) {
        setHistory(e.state.stack);
        setPhase('idle');
        return;
      }

      if (phaseRef.current === 'swiping') {
        setHistory(e.state.stack);
        setSwipeX(0);
        setSwipeSettle(false);
        setPhase('idle');
        return;
      }

      if (nextIndex < currentIndex) {
        setPhase('exiting');
        window.setTimeout(() => {
          setHistory(e.state.stack);
          setSwipeX(0);
          setSwipeSettle(false);
          setPhase('idle');
        }, 280);
        return;
      }

      setHistory(e.state.stack);
      setPhase('entering');
      window.setTimeout(() => setPhase('idle'), 340);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent): void => {
      if (!desktopLayoutRef.current || phaseRef.current !== 'idle') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      if (absX < 8 || absX < absY * 1.25) return;

      const gesture = wheelGestureRef.current;
      if (isFromHorizontalScrollRegion(e.target, el)) {
        resetWheelGesture(gesture);
        return;
      }

      const now = Date.now();
      if (now - lastWheelNavigationAtRef.current < 650) {
        e.preventDefault();
        return;
      }

      if (now - gesture.lastAt > 220) {
        gesture.x = 0;
        gesture.y = 0;
      }
      gesture.x += e.deltaX;
      gesture.y += e.deltaY;
      gesture.lastAt = now;

      const canGoBack = navIndexRef.current > 0 && historyLenRef.current > 1;
      const canGoForward = navIndexRef.current < maxNavIndexRef.current;
      const threshold = 140;
      const absGestureX = Math.abs(gesture.x);

      if (absGestureX > threshold && canGoBack && (!canGoForward || gesture.x < 0)) {
        e.preventDefault();
        lastWheelNavigationAtRef.current = now;
        gesture.x = 0;
        gesture.y = 0;
        window.history.back();
      } else if (absGestureX > threshold && canGoForward && (!canGoBack || gesture.x > 0)) {
        e.preventDefault();
        lastWheelNavigationAtRef.current = now;
        gesture.x = 0;
        gesture.y = 0;
        window.history.forward();
      } else if (canGoBack || canGoForward) {
        e.preventDefault();
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Mobile keeps the original left-edge back swipe. Desktop trackpads use wheel above.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent): void => {
      if (desktopLayoutRef.current || phaseRef.current !== 'idle') return;
      const t = e.touches[0];
      if (!t) return;
      const canGoBack = navIndexRef.current > 0 && historyLenRef.current > 1;
      if (t.clientX < 32 && canGoBack) {
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
        if (dx > 6) {
          swipeActiveRef.current = true;
          setPhase('swiping');
        }
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
          window.history.back();
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

  // Prev screen position: during entering/idle it sits at -30% (parallax),
  // during exiting it slides to 0% (revealed), during swiping it parallax-follows.
  const prevTransform = phase === 'swiping'
    ? `translateX(${(-30 + (swipeX / window.innerWidth) * 30).toFixed(2)}%)`
    : phase === 'exiting' ? 'translateX(0%)'
    : 'translateX(-30%)';
  const prevTransition = phase === 'entering'
    ? 'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
    : phase === 'exiting'
      ? 'transform 0.28s cubic-bezier(0.55, 0, 1, 0.45)'
      : (phase === 'swiping' && swipeSettle)
        ? 'transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
        : 'none';

  if (history.length === 0) return null;

  if (isDesktopLayout) {
    const sidebarView = history.length > 1 ? history[history.length - 2] : history[0];
    const detailView = history.length > 1 ? history[history.length - 1] : null;

    return (
      <div className="app app-desktop" ref={containerRef}>
        <section className="desktop-pane desktop-pane-sidebar" key={`sidebar-${getViewKey(sidebarView)}`}>
          <ScreenContent
            view={sidebarView}
            navigate={navigateFromSidebar}
            active={true}
            onBackToRepoList={backToRepoList}
          />
        </section>
        <section className="desktop-pane desktop-pane-detail">
          {detailView ? (
            <ScreenContent
              key={`detail-${getViewKey(detailView)}`}
              view={detailView}
              navigate={navigate}
              active={true}
              onBackToRepoList={backToRepoList}
            />
          ) : (
            <div className="desktop-empty-pane">
              <div className="desktop-empty-title">GitView</div>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="app" ref={containerRef}>
      {history.map((view, i) => {
        const isCurrent = i === history.length - 1;
        const isPrev    = i === history.length - 2;

        let style: React.CSSProperties = {};
        let className = 'screen';

        if (isCurrent) {
          if (phase === 'swiping') {
            style = {
              transform: `translateX(${swipeX}px)`,
              transition: swipeSettle ? 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)' : 'none',
            };
          }
          className = [
            'screen',
            phase === 'entering' ? 'screen-enter' : '',
            phase === 'exiting'  ? 'screen-exit'  : '',
            phase === 'swiping'  ? 'screen-swiping' : '',
          ].filter(Boolean).join(' ');
        } else if (isPrev) {
          style = { transform: prevTransform, transition: prevTransition };
          className = 'screen screen-bg';
        } else {
          // Older history items are only placeholders. Keeping their contents mounted
          // can retain large file/diff payloads in browser memory across deep navigation.
          style = { transform: 'translateX(-30%)', visibility: 'hidden' };
          className = 'screen screen-bg';
        }

        return (
          <div key={i} className={className} style={style}>
            {(isCurrent || isPrev) && (
              <ScreenContent
                view={view}
                navigate={navigate}
                active={isCurrent && phase === 'idle'}
                onBackToRepoList={backToRepoList}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
