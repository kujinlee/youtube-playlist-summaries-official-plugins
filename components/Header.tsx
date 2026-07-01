'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ChannelPlaylistPanel from './ChannelPlaylistPanel';
import PlaylistPicker from './PlaylistPicker';

interface HeaderProps {
  /** The data ROOT (baseOutputFolder). Seeds the editable root field. */
  defaultBaseOutputFolder: string;
  /** The currently-viewed playlist folder (write target). Kept for back-compat/seed. */
  defaultOutputFolder: string;
  currentPlaylistUrl?: string;
  /** Display name of the currently-viewed playlist — shown as a caption near Row 2. */
  currentPlaylistTitle?: string;
  /** Called with the server-resolved DERIVED TARGET (<root>/<slug>/raw), not the root field. */
  onIngest: (playlistUrl: string, outputFolder: string) => void;
  onSync?: (outputFolder: string, playlistUrl: string) => void;
  onFolderChange?: (folder: string) => void;
  /** Called when the root settles to a normalized value (Browse / self-correct). */
  onRootChange?: (root: string) => void;
  /** Called with the resolved target so the displayed list can follow the playlist URL. */
  onResolvedTarget?: (target: string) => void;
  disabled?: boolean;
}

const DEBOUNCE_MS = 350;

export default function Header({
  defaultBaseOutputFolder,
  defaultOutputFolder: _defaultOutputFolder,
  currentPlaylistUrl,
  currentPlaylistTitle,
  onIngest,
  onSync,
  onFolderChange,
  onRootChange,
  onResolvedTarget,
  disabled = false,
}: HeaderProps) {
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [root, setRoot] = useState(defaultBaseOutputFolder);
  // Derived write target resolved from (url, root). `resolvedKey` records the exact
  // (trimmed url, root) pair it was resolved for, so Fetch/Sync only fire when the
  // preview is fresh for the CURRENT inputs (no submit-time await, no stale fires).
  const [target, setTarget] = useState<string | null>(null);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [isMac, setIsMac] = useState(false);

  // true once the user types into the URL field; reset only on Browse success
  const urlEditedByUser = useRef(false);
  // true once the user edits the root field (or Browses); blocks a late settings sync
  const rootEditedByUser = useRef(false);
  // monotonic id so a slow resolve response for an old (url, root) is ignored
  const resolveSeq = useRef(0);
  // monotonic id so a slow normalize-folder response for an old root is ignored
  const normalizeSeq = useRef(0);

  const trimUrl = playlistUrl.trim();
  const trimRoot = root.trim();
  const keyFor = (u: string, r: string) => `${u}\0${r}`;
  const currentKey = keyFor(trimUrl, trimRoot);

  useEffect(() => {
    setIsMac(typeof navigator !== 'undefined' && navigator.platform.includes('Mac'));
  }, []);

  // Late settings sync — apply defaultBaseOutputFolder only while the field is pristine.
  useEffect(() => {
    if (!rootEditedByUser.current) {
      setRoot(defaultBaseOutputFolder);
    }
  }, [defaultBaseOutputFolder]);

  // Auto-fill URL from folder metadata — only if the user hasn't typed their own.
  useEffect(() => {
    if (currentPlaylistUrl && !urlEditedByUser.current) {
      setPlaylistUrl(currentPlaylistUrl);
    }
  }, [currentPlaylistUrl]);

  // SINGLE debounced resolver. Keyed on (url, root). Empty url or root → no target.
  // The seq guard drops stale responses; a server-normalized root self-corrects the
  // field (which re-keys and re-resolves once to a stable fixpoint).
  useEffect(() => {
    if (!trimUrl || !trimRoot) {
      setResolving(false);
      setTarget(null);
      setResolvedKey(null);
      resolveSeq.current++; // invalidate any in-flight response
      return;
    }
    const key = keyFor(trimUrl, trimRoot);
    const seq = ++resolveSeq.current;
    setResolving(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/resolve-folder?url=${encodeURIComponent(trimUrl)}&root=${encodeURIComponent(trimRoot)}`,
        );
        if (seq !== resolveSeq.current) return; // stale
        if (!res.ok) {
          setTarget(null);
          setResolvedKey(null);
          setResolving(false);
          return;
        }
        const data = (await res.json()) as { root?: string; outputFolder?: string };
        if (seq !== resolveSeq.current) return; // stale after await
        setTarget(data.outputFolder ?? null);
        setResolvedKey(key);
        setResolving(false);
        // Let the displayed list follow the playlist URL: the page switches its
        // viewing folder to the resolved target (existing playlist → its videos;
        // new playlist → empty until Fetch/Sync populates it incrementally).
        if (data.outputFolder) onResolvedTarget?.(data.outputFolder);
        if (data.root && data.root !== trimRoot) {
          // server normalized the root → self-correct (no user-dirty flag, converges)
          setRoot(data.root);
          onRootChange?.(data.root);
        }
      } catch {
        if (seq !== resolveSeq.current) return;
        setTarget(null);
        setResolvedKey(null);
        setResolving(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // onRootChange intentionally omitted: it's a stable callback and including it
    // would re-run the debounce on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimUrl, trimRoot]);

  const handleRootChange = useCallback((value: string) => {
    setRoot(value);
    rootEditedByUser.current = true;
  }, []);

  // On blur, snap a manually-typed root up to the data root (covers the no-URL case;
  // when a URL is present the resolver already self-corrects).
  const handleRootBlur = useCallback(async () => {
    if (!rootEditedByUser.current) return;
    const r = root.trim();
    if (!r) return;
    const seq = ++normalizeSeq.current;
    try {
      const res = await fetch(`/api/normalize-folder?path=${encodeURIComponent(r)}`);
      if (seq !== normalizeSeq.current) return; // stale — a newer root edit superseded this
      if (!res.ok) return;
      const data = (await res.json()) as { root?: string };
      if (seq !== normalizeSeq.current) return; // stale after await
      if (data.root && data.root !== root) {
        setRoot(data.root);
        onRootChange?.(data.root);
      }
    } catch {
      // leave the field as typed
    }
  }, [root, onRootChange]);

  const handleBrowse = useCallback(async () => {
    let picked: string;
    try {
      const res = await fetch('/api/pick-folder');
      if (!res.ok) return;
      const data = (await res.json()) as { folderPath?: string; cancelled?: boolean };
      if (!data.folderPath) return; // cancelled / no selection
      picked = data.folderPath;
    } catch {
      return; // picker failed — folder unchanged
    }
    // Snap the pick up to the data root before adopting it. Shares normalizeSeq with
    // the blur path so a stale blur response can't clobber this Browse (and vice versa).
    const seq = ++normalizeSeq.current;
    let newRoot: string;
    try {
      const nres = await fetch(`/api/normalize-folder?path=${encodeURIComponent(picked)}`);
      if (seq !== normalizeSeq.current) return; // superseded
      if (!nres.ok) return; // normalize failed → leave root unchanged
      const nd = (await nres.json()) as { root?: string };
      if (seq !== normalizeSeq.current) return; // superseded after await
      if (!nd.root) return;
      newRoot = nd.root;
    } catch {
      return; // normalize failed → leave root unchanged
    }
    rootEditedByUser.current = true;
    urlEditedByUser.current = false; // browsing a new folder resets the URL guard
    setRoot(newRoot);
    onRootChange?.(newRoot);
    onFolderChange?.(picked); // view the picked folder (a playlist, or the root itself)
  }, [onFolderChange, onRootChange]);

  const handleUrlChange = useCallback((value: string) => {
    setPlaylistUrl(value);
    urlEditedByUser.current = true;
  }, []);

  const [channelPanelOpen, setChannelPanelOpen] = useState(false);

  const applyPickedUrl = useCallback((url: string) => {
    setPlaylistUrl(url);
    urlEditedByUser.current = true;
  }, []);

  const isFresh =
    trimUrl !== '' && trimRoot !== '' && !resolving && resolvedKey === currentKey && !!target;
  const canAct = isFresh && !disabled;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canAct || !target) return;
    onIngest(trimUrl, target);
  }

  return (
    <header className="bg-zinc-900 border-b border-zinc-800 px-6 py-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        {/* Row 1: Root output folder + Browse + Sync */}
        <div className="flex gap-2 items-center">
          <input
            type="text"
            aria-label="Root output folder"
            placeholder="Root output folder (e.g. …-plugins-data)"
            value={root}
            onChange={(e) => handleRootChange(e.target.value)}
            onBlur={handleRootBlur}
            className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {isMac && (
            <button
              type="button"
              onClick={handleBrowse}
              disabled={disabled}
              className="rounded bg-zinc-800 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 text-sm text-zinc-300 transition-colors whitespace-nowrap"
            >
              Browse…
            </button>
          )}
          {onSync && (
            <button
              type="button"
              onClick={() => { if (canAct && target) onSync(target, trimUrl); }}
              disabled={!canAct}
              className="rounded border px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors bg-green-900 text-green-300 border-green-700 hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ↻ Sync
            </button>
          )}
        </div>

        {/* Derived-target hint (read-only) */}
        <p data-testid="derived-target" className="text-xs text-zinc-500 pl-1">
          {target ? (
            <>→ writes to: <span className="text-zinc-300 tabular-nums">{target}</span></>
          ) : (
            <span className="text-zinc-600">→ writes to: enter a playlist URL to preview the folder</span>
          )}
        </p>

        {currentPlaylistTitle && <p className="text-xs text-zinc-400 pl-1">▶ {currentPlaylistTitle}</p>}

        {/* Row 2: Playlist URL + Fetch & Summarize */}
        <div className="flex gap-2 items-center">
          <PlaylistPicker
            root={trimRoot}
            value={playlistUrl}
            onChange={handleUrlChange}
            onPick={applyPickedUrl}
            onBrowseChannel={() => setChannelPanelOpen(true)}
            disabled={disabled}
          />
          <button
            type="submit"
            disabled={!canAct}
            className="rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white transition-colors whitespace-nowrap"
          >
            Fetch &amp; Summarize
          </button>
        </div>
      </form>
      {channelPanelOpen && (
        <ChannelPlaylistPanel
          onSelect={(url) => { applyPickedUrl(url); setChannelPanelOpen(false); }}
          onClose={() => setChannelPanelOpen(false)}
        />
      )}
    </header>
  );
}
