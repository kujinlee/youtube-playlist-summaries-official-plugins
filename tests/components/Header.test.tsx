/** @jest-environment jsdom */
import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import Header from '@/components/Header';

// --- helpers -------------------------------------------------------------
const ROOT = '/d';
const URL_VAL = 'https://www.youtube.com/playlist?list=PLtest123';
const TARGET = '/d/agentic-ai/raw';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const bad = (status: number, body: unknown = {}) => ({ ok: false, status, json: async () => body });

// Route fetch by URL prefix. Unmatched URLs reject (so a stray /api/playlist-info call fails loudly).
function routeFetch(routes: Record<string, (url: string) => unknown>) {
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    for (const prefix of Object.keys(routes)) {
      if (url.startsWith(prefix)) return Promise.resolve(routes[prefix](url));
    }
    return Promise.reject(new Error(`unrouted fetch: ${url}`));
  }) as jest.Mock;
}

// Advance past the 350ms debounce AND flush the fetch promise chain.
async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(400);
  });
}

function renderHeader(props: Partial<React.ComponentProps<typeof Header>> = {}) {
  return render(
    <Header
      defaultBaseOutputFolder={ROOT}
      defaultOutputFolder={TARGET}
      onIngest={jest.fn()}
      {...props}
    />,
  );
}

const rootField = () => screen.getByPlaceholderText(/root output folder/i) as HTMLInputElement;
const urlField = () => screen.getByPlaceholderText(/playlist url/i) as HTMLInputElement;
const fetchBtn = () => screen.getByRole('button', { name: /fetch & summarize/i });
const hint = () => screen.getByTestId('derived-target');

beforeEach(() => {
  jest.useFakeTimers();
  routeFetch({ '/api/resolve-folder': () => ok({ root: ROOT, outputFolder: TARGET }) });
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// --- B1, B2: render ------------------------------------------------------
describe('Header — render', () => {
  it('B1: shows the root field (=defaultBaseOutputFolder), URL field, Fetch, and a target hint', () => {
    renderHeader();
    expect(rootField().value).toBe(ROOT);
    expect(urlField()).toBeInTheDocument();
    expect(fetchBtn()).toBeInTheDocument();
    expect(hint()).toBeInTheDocument();
  });

  it('B2: the folder field is labelled as the ROOT', () => {
    renderHeader();
    expect(rootField()).toBeInTheDocument(); // placeholder matches /root output folder/i
  });

  it('B1: Fetch is disabled before any URL/target', () => {
    renderHeader();
    expect(fetchBtn()).toBeDisabled();
  });
});

// --- B3, B7, B13, B15, B16: URL → debounced resolve ----------------------
describe('Header — debounced resolve', () => {
  it('B3: typing a URL fires one debounced resolve with url+root and shows the target', async () => {
    renderHeader();
    fireEvent.change(urlField(), { target: { value: URL_VAL } });
    await settle();
    const calls = (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]));
    const resolveCalls = calls.filter((u) => u.startsWith('/api/resolve-folder'));
    expect(resolveCalls).toHaveLength(1);
    expect(resolveCalls[0]).toContain(`url=${encodeURIComponent(URL_VAL)}`);
    expect(resolveCalls[0]).toContain(`root=${encodeURIComponent(ROOT)}`);
    expect(hint()).toHaveTextContent(TARGET);
  });

  it('B7: rapid typing only resolves the latest value once', async () => {
    renderHeader();
    fireEvent.change(urlField(), { target: { value: 'h' } });
    fireEvent.change(urlField(), { target: { value: 'ht' } });
    fireEvent.change(urlField(), { target: { value: URL_VAL } });
    await settle();
    const resolveCalls = (global.fetch as jest.Mock).mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.startsWith('/api/resolve-folder'));
    expect(resolveCalls).toHaveLength(1);
    expect(resolveCalls[0]).toContain(encodeURIComponent(URL_VAL));
  });

  it('B13: Fetch (with a fresh target) calls onIngest with the resolved TARGET, not the root', async () => {
    const onIngest = jest.fn();
    renderHeader({ onIngest });
    fireEvent.change(urlField(), { target: { value: URL_VAL } });
    await settle();
    expect(fetchBtn()).toBeEnabled();
    fireEvent.click(fetchBtn());
    expect(onIngest).toHaveBeenCalledWith(URL_VAL, TARGET);
  });

  it('notifies onResolvedTarget with the resolved target so the list can follow the URL', async () => {
    const onResolvedTarget = jest.fn();
    renderHeader({ onResolvedTarget });
    fireEvent.change(urlField(), { target: { value: URL_VAL } });
    await settle();
    expect(onResolvedTarget).toHaveBeenCalledWith(TARGET);
  });

  it('B15/B16: typing a URL never writes a derived target into the root field, and never calls /api/playlist-info', async () => {
    renderHeader();
    fireEvent.change(urlField(), { target: { value: URL_VAL } });
    await settle();
    // root field stays the normalized root — never the <root>/<slug>/raw target
    expect(rootField().value).toBe(ROOT);
    expect(rootField().value).not.toContain('agentic-ai');
    const calls = (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes('/api/playlist-info'))).toBe(false);
  });

  it('B4: a resolve that normalizes the root self-corrects the field (no <slug> leak)', async () => {
    // field starts at a subfolder; server returns the normalized root
    routeFetch({ '/api/resolve-folder': () => ok({ root: ROOT, outputFolder: TARGET }) });
    renderHeader({ defaultBaseOutputFolder: '/d/agentic-ai/raw' });
    expect(rootField().value).toBe('/d/agentic-ai/raw');
    fireEvent.change(urlField(), { target: { value: URL_VAL } });
    await settle();
    await settle(); // one extra resolve cycle after the self-correct, then stable
    expect(rootField().value).toBe(ROOT);
  });
});

// --- B5, B6, B18, B19: failure + invalidation ----------------------------
describe('Header — resolve failures and invalidation', () => {
  it('B5: an invalid-URL 400 clears the target and leaves the root unchanged', async () => {
    routeFetch({ '/api/resolve-folder': () => bad(400, { error: 'no list id' }) });
    renderHeader();
    fireEvent.change(urlField(), { target: { value: 'https://youtube.com/watch?v=x' } });
    await settle();
    expect(rootField().value).toBe(ROOT);
    expect(fetchBtn()).toBeDisabled();
    expect(hint()).not.toHaveTextContent(TARGET);
  });

  it('B6: a network error clears the target and does not crash', async () => {
    routeFetch({ '/api/resolve-folder': () => { throw new Error('network'); } });
    renderHeader();
    fireEvent.change(urlField(), { target: { value: URL_VAL } });
    await settle();
    expect(fetchBtn()).toBeDisabled();
  });

  it('B18: with no fresh target, clicking Fetch never calls onIngest', async () => {
    routeFetch({ '/api/resolve-folder': () => bad(500, {}) });
    const onIngest = jest.fn();
    renderHeader({ onIngest });
    fireEvent.change(urlField(), { target: { value: URL_VAL } });
    await settle();
    fireEvent.click(fetchBtn());
    expect(onIngest).not.toHaveBeenCalled();
  });

  it('B19: clearing the URL after a target clears the hint', async () => {
    renderHeader();
    fireEvent.change(urlField(), { target: { value: URL_VAL } });
    await settle();
    expect(hint()).toHaveTextContent(TARGET);
    fireEvent.change(urlField(), { target: { value: '' } });
    await settle();
    expect(hint()).not.toHaveTextContent(TARGET);
    expect(fetchBtn()).toBeDisabled();
  });
});

// --- B17: disabled gating ------------------------------------------------
describe('Header — button gating', () => {
  it('B17: Fetch is disabled while resolving (before the debounce settles)', async () => {
    renderHeader();
    fireEvent.change(urlField(), { target: { value: URL_VAL } });
    // not yet settled → resolving
    expect(fetchBtn()).toBeDisabled();
    await settle();
    expect(fetchBtn()).toBeEnabled();
  });

  it('B17: Fetch is disabled when disabled=true even with a fresh target', async () => {
    const { rerender } = renderHeader();
    fireEvent.change(urlField(), { target: { value: URL_VAL } });
    await settle();
    rerender(
      <Header defaultBaseOutputFolder={ROOT} defaultOutputFolder={TARGET} onIngest={jest.fn()} disabled />,
    );
    expect(fetchBtn()).toBeDisabled();
  });
});

// --- B9, B9b, B10, B10b: Browse ------------------------------------------
describe('Header — Browse', () => {
  function setMac() {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
  }
  const browseBtn = () => screen.getByRole('button', { name: /browse/i });

  async function clickBrowse() {
    await act(async () => {
      fireEvent.click(browseBtn());
      await jest.advanceTimersByTimeAsync(0);
    });
  }

  it('B9: Browse into a playlist folder snaps the root up, persists, and views the folder', async () => {
    setMac();
    routeFetch({
      '/api/pick-folder': () => ok({ folderPath: '/d/cs146s/raw' }),
      '/api/normalize-folder': () => ok({ root: ROOT }),
      '/api/resolve-folder': () => ok({ root: ROOT, outputFolder: TARGET }),
    });
    const onRootChange = jest.fn();
    const onFolderChange = jest.fn();
    renderHeader({ onRootChange, onFolderChange });
    await clickBrowse();
    expect(rootField().value).toBe(ROOT);
    expect(onRootChange).toHaveBeenCalledWith(ROOT);
    expect(onFolderChange).toHaveBeenCalledWith('/d/cs146s/raw');
  });

  it('B9b: Browse to the root itself views the root', async () => {
    setMac();
    routeFetch({
      '/api/pick-folder': () => ok({ folderPath: ROOT }),
      '/api/normalize-folder': () => ok({ root: ROOT }),
    });
    const onFolderChange = jest.fn();
    renderHeader({ onFolderChange });
    await clickBrowse();
    expect(rootField().value).toBe(ROOT);
    expect(onFolderChange).toHaveBeenCalledWith(ROOT);
  });

  it('B10: a cancelled Browse leaves the root unchanged and does not normalize', async () => {
    setMac();
    routeFetch({
      '/api/pick-folder': () => ok({ cancelled: true }),
      '/api/normalize-folder': () => ok({ root: '/SHOULD_NOT_BE_USED' }),
    });
    const onRootChange = jest.fn();
    renderHeader({ onRootChange });
    await clickBrowse();
    expect(rootField().value).toBe(ROOT);
    expect(onRootChange).not.toHaveBeenCalled();
  });

  it('B10b: Browse pick succeeds but normalize fails → root unchanged, no onRootChange', async () => {
    setMac();
    routeFetch({
      '/api/pick-folder': () => ok({ folderPath: '/d/cs146s/raw' }),
      '/api/normalize-folder': () => bad(500, {}),
    });
    const onRootChange = jest.fn();
    renderHeader({ onRootChange });
    await clickBrowse();
    expect(rootField().value).toBe(ROOT);
    expect(onRootChange).not.toHaveBeenCalled();
  });
});

// --- B11, B12: settings-sync + URL auto-fill guards ----------------------
describe('Header — sync guards', () => {
  it('B11: a late defaultBaseOutputFolder applies while the root field is pristine', () => {
    const { rerender } = render(
      <Header defaultBaseOutputFolder="" defaultOutputFolder="" onIngest={jest.fn()} />,
    );
    rerender(<Header defaultBaseOutputFolder="/late/root" defaultOutputFolder="" onIngest={jest.fn()} />);
    expect(rootField().value).toBe('/late/root');
  });

  it('B11: a late defaultBaseOutputFolder does NOT overwrite a user-edited root', () => {
    const { rerender } = render(
      <Header defaultBaseOutputFolder="" defaultOutputFolder="" onIngest={jest.fn()} />,
    );
    fireEvent.change(rootField(), { target: { value: '/user/root' } });
    rerender(<Header defaultBaseOutputFolder="/late/root" defaultOutputFolder="" onIngest={jest.fn()} />);
    expect(rootField().value).toBe('/user/root');
  });

  it('B12: URL auto-fills from currentPlaylistUrl when the user has not typed', () => {
    const { rerender } = renderHeader({ currentPlaylistUrl: '' });
    rerender(
      <Header
        defaultBaseOutputFolder={ROOT}
        defaultOutputFolder={TARGET}
        onIngest={jest.fn()}
        currentPlaylistUrl="https://youtube.com/playlist?list=PLauto"
      />,
    );
    expect(urlField().value).toBe('https://youtube.com/playlist?list=PLauto');
  });
});

// --- B14: Sync -----------------------------------------------------------
describe('Header — Sync', () => {
  const syncBtn = () => screen.getByRole('button', { name: /sync/i });

  it('does not render Sync when onSync is absent', () => {
    renderHeader();
    expect(screen.queryByRole('button', { name: /sync/i })).toBeNull();
  });

  it('B14: Sync (with a fresh target) calls onSync with the resolved target and url', async () => {
    const onSync = jest.fn();
    renderHeader({ onSync });
    fireEvent.change(urlField(), { target: { value: URL_VAL } });
    await settle();
    expect(syncBtn()).toBeEnabled();
    fireEvent.click(syncBtn());
    expect(onSync).toHaveBeenCalledWith(TARGET, URL_VAL);
  });

  it('B14/B18: Sync is disabled without a fresh target', () => {
    const onSync = jest.fn();
    renderHeader({ onSync });
    expect(syncBtn()).toBeDisabled();
  });
});

// --- Review hardening (Task 18): trimming + stale-response seq guards ----
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('Header — trimming', () => {
  it('trims the URL before resolving and before onIngest', async () => {
    const onIngest = jest.fn();
    const resolveUrls: string[] = [];
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const u = String(input);
      if (u.startsWith('/api/resolve-folder')) {
        resolveUrls.push(u);
        return Promise.resolve(ok({ root: ROOT, outputFolder: TARGET }));
      }
      return Promise.reject(new Error(`unrouted ${u}`));
    }) as jest.Mock;
    renderHeader({ onIngest });
    fireEvent.change(urlField(), { target: { value: `   ${URL_VAL}   ` } });
    await settle();
    // the resolve call carried the TRIMMED url, not the padded one
    expect(resolveUrls[0]).toContain(`url=${encodeURIComponent(URL_VAL)}`);
    expect(resolveUrls[0]).not.toContain('%20');
    fireEvent.click(fetchBtn());
    expect(onIngest).toHaveBeenCalledWith(URL_VAL, TARGET);
  });

  it('resolves with a trimmed root (a trailing-space root is not sent raw)', async () => {
    const resolveUrls: string[] = [];
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const u = String(input);
      if (u.startsWith('/api/resolve-folder')) {
        resolveUrls.push(u);
        return Promise.resolve(ok({ root: ROOT, outputFolder: TARGET }));
      }
      return Promise.reject(new Error(`unrouted ${u}`));
    }) as jest.Mock;
    renderHeader({ defaultBaseOutputFolder: '/d ' });
    fireEvent.change(urlField(), { target: { value: URL_VAL } });
    await settle();
    expect(resolveUrls[0]).toContain(`root=${encodeURIComponent('/d')}`);
    expect(resolveUrls[0]).not.toContain(encodeURIComponent('/d '));
  });

  it('a whitespace-only root resolves nothing and keeps Fetch disabled', async () => {
    const resolveCalls: string[] = [];
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const u = String(input);
      if (u.startsWith('/api/resolve-folder')) resolveCalls.push(u);
      return Promise.reject(new Error(`unrouted ${u}`));
    }) as jest.Mock;
    renderHeader({ defaultBaseOutputFolder: '   ' });
    fireEvent.change(urlField(), { target: { value: URL_VAL } });
    await settle();
    expect(resolveCalls).toHaveLength(0);
    expect(fetchBtn()).toBeDisabled();
  });
});

describe('Header — stale-response seq guards', () => {
  it('drops a stale resolve response that arrives after a newer one', async () => {
    const dA = deferred<ReturnType<typeof ok>>();
    const dB = deferred<ReturnType<typeof ok>>();
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const u = String(input);
      if (u.startsWith('/api/resolve-folder')) {
        return u.includes('PLA') ? dA.promise : dB.promise;
      }
      return Promise.reject(new Error(`unrouted ${u}`));
    }) as jest.Mock;
    renderHeader();

    fireEvent.change(urlField(), { target: { value: 'https://youtube.com/playlist?list=PLA' } });
    await act(async () => { await jest.advanceTimersByTimeAsync(400); }); // fetch A in-flight
    fireEvent.change(urlField(), { target: { value: 'https://youtube.com/playlist?list=PLB' } });
    await act(async () => { await jest.advanceTimersByTimeAsync(400); }); // fetch B in-flight

    // B (the newer request) resolves first, then A (stale) resolves
    await act(async () => { dB.resolve(ok({ root: ROOT, outputFolder: '/d/B/raw' })); });
    await act(async () => { dA.resolve(ok({ root: ROOT, outputFolder: '/d/A/raw' })); });

    // the hint must reflect B, never the stale A
    expect(hint()).toHaveTextContent('/d/B/raw');
    expect(hint()).not.toHaveTextContent('/d/A/raw');
  });

  it('drops a stale normalize (blur) response superseded by a newer root edit', async () => {
    const dA = deferred<ReturnType<typeof ok>>();
    const dB = deferred<ReturnType<typeof ok>>();
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const u = String(input);
      if (u.startsWith('/api/normalize-folder')) {
        return u.includes('aaa') ? dA.promise : dB.promise;
      }
      if (u.startsWith('/api/resolve-folder')) return Promise.reject(new Error('no url'));
      return Promise.reject(new Error(`unrouted ${u}`));
    }) as jest.Mock;
    renderHeader();
    const field = rootField();

    // edit to /aaa, blur (normalize A in-flight), then edit to /bbb, blur (normalize B)
    fireEvent.change(field, { target: { value: '/aaa/slug/raw' } });
    fireEvent.blur(field);
    fireEvent.change(field, { target: { value: '/bbb/slug/raw' } });
    fireEvent.blur(field);

    // B resolves first to /bbb, then the stale A resolves to /aaa
    await act(async () => { dB.resolve(ok({ root: '/bbb' })); });
    await act(async () => { dA.resolve(ok({ root: '/aaa' })); });

    // the stale A normalize must NOT clobber the field back to /aaa
    expect(rootField().value).toBe('/bbb');
  });
});
