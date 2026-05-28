/** @jest-environment jsdom */
import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import Header from '@/components/Header';

describe('Header', () => {
  const defaultFolder = '/default/output';

  it('renders playlist URL input, output folder input, and submit button', () => {
    render(<Header defaultOutputFolder={defaultFolder} onIngest={jest.fn()} />);
    expect(screen.getByPlaceholderText(/playlist url/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/output folder/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue(defaultFolder)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fetch & summarize/i })).toBeInTheDocument();
  });

  it('button is disabled when URL input is empty', () => {
    render(<Header defaultOutputFolder={defaultFolder} onIngest={jest.fn()} />);
    expect(screen.getByRole('button', { name: /fetch & summarize/i })).toBeDisabled();
  });

  it('button is disabled when URL input is only whitespace', () => {
    render(<Header defaultOutputFolder={defaultFolder} onIngest={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /fetch & summarize/i })).toBeDisabled();
  });

  it('button is enabled when URL input has content', () => {
    render(<Header defaultOutputFolder={defaultFolder} onIngest={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: 'https://youtube.com/playlist?list=abc' },
    });
    expect(screen.getByRole('button', { name: /fetch & summarize/i })).toBeEnabled();
  });

  it('calls onIngest with correct url and folder on submit', () => {
    const onIngest = jest.fn();
    render(<Header defaultOutputFolder={defaultFolder} onIngest={onIngest} />);
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: 'https://youtube.com/playlist?list=abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: /fetch & summarize/i }));
    expect(onIngest).toHaveBeenCalledWith('https://youtube.com/playlist?list=abc', defaultFolder);
  });

  it('trims leading/trailing whitespace from URL before calling onIngest', () => {
    const onIngest = jest.fn();
    render(<Header defaultOutputFolder={defaultFolder} onIngest={onIngest} />);
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: '  https://youtube.com/playlist?list=abc  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /fetch & summarize/i }));
    expect(onIngest).toHaveBeenCalledWith('https://youtube.com/playlist?list=abc', defaultFolder);
  });

  it('calls onIngest with updated output folder when user changes it', () => {
    const onIngest = jest.fn();
    render(<Header defaultOutputFolder={defaultFolder} onIngest={onIngest} />);
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: 'https://youtube.com/playlist?list=abc' },
    });
    fireEvent.change(screen.getByDisplayValue(defaultFolder), {
      target: { value: '/custom/path' },
    });
    fireEvent.click(screen.getByRole('button', { name: /fetch & summarize/i }));
    expect(onIngest).toHaveBeenCalledWith('https://youtube.com/playlist?list=abc', '/custom/path');
  });

  it('does not call onIngest when button is disabled', () => {
    const onIngest = jest.fn();
    render(<Header defaultOutputFolder={defaultFolder} onIngest={onIngest} />);
    fireEvent.click(screen.getByRole('button', { name: /fetch & summarize/i }));
    expect(onIngest).not.toHaveBeenCalled();
  });

  it('output folder defaults to defaultOutputFolder prop', () => {
    render(<Header defaultOutputFolder="/my/vault" onIngest={jest.fn()} />);
    expect(screen.getByDisplayValue('/my/vault')).toBeInTheDocument();
  });
});

describe('Header — Sync button', () => {
  it('does not render Sync button when onSync is not provided', () => {
    render(<Header defaultOutputFolder="/folder" onIngest={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /sync/i })).toBeNull();
  });

  it('renders Sync button when onSync is provided', () => {
    render(<Header defaultOutputFolder="/folder" onIngest={jest.fn()} onSync={jest.fn()} />);
    expect(screen.getByRole('button', { name: /sync/i })).toBeInTheDocument();
  });

  it('Sync button is disabled when playlist URL field is empty', () => {
    render(<Header defaultOutputFolder="/folder" onIngest={jest.fn()} onSync={jest.fn()} />);
    expect(screen.getByRole('button', { name: /sync/i })).toBeDisabled();
  });

  it('Sync button is enabled when playlist URL field has content', () => {
    render(<Header defaultOutputFolder="/folder" onIngest={jest.fn()} onSync={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: 'https://youtube.com/playlist?list=PLtest' },
    });
    expect(screen.getByRole('button', { name: /sync/i })).toBeEnabled();
  });

  it('Sync button is disabled when global disabled=true even with URL present', () => {
    render(
      <Header
        defaultOutputFolder="/folder"
        onIngest={jest.fn()}
        onSync={jest.fn()}
        disabled={true}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: 'https://youtube.com/playlist?list=PLtest' },
    });
    expect(screen.getByRole('button', { name: /sync/i })).toBeDisabled();
  });

  it('calls onSync with folder AND playlistUrl when Sync button is clicked', () => {
    const onSync = jest.fn();
    render(
      <Header defaultOutputFolder="/folder" onIngest={jest.fn()} onSync={onSync} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: 'https://youtube.com/playlist?list=PLtest' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sync/i }));
    expect(onSync).toHaveBeenCalledWith('/folder', 'https://youtube.com/playlist?list=PLtest');
  });

  it('calls onSync with updated folder when user has changed the folder input', () => {
    const onSync = jest.fn();
    render(<Header defaultOutputFolder="/original" onIngest={jest.fn()} onSync={onSync} />);
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: 'https://youtube.com/playlist?list=PLtest' },
    });
    fireEvent.change(screen.getByDisplayValue('/original'), { target: { value: '/new-folder' } });
    fireEvent.click(screen.getByRole('button', { name: /sync/i }));
    expect(onSync).toHaveBeenCalledWith('/new-folder', 'https://youtube.com/playlist?list=PLtest');
  });

  it('Sync button click does not trigger form submission (onIngest not called)', () => {
    const onIngest = jest.fn();
    const onSync = jest.fn();
    render(
      <Header defaultOutputFolder="/folder" onIngest={onIngest} onSync={onSync} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: 'https://youtube.com/playlist?list=PLtest' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sync/i }));
    expect(onIngest).not.toHaveBeenCalled();
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('Sync button has green styling when enabled', () => {
    render(
      <Header defaultOutputFolder="/folder" onIngest={jest.fn()} onSync={jest.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: 'https://youtube.com/playlist?list=PLtest' },
    });
    const syncBtn = screen.getByRole('button', { name: /sync/i });
    // Check for green Tailwind class presence (enabled state)
    expect(syncBtn.className).toMatch(/green/);
  });
});

describe('Header — playlist folder auto-suggestion', () => {
  const BASE = '/home/user/data';
  const PLAYLIST_URL = 'https://www.youtube.com/playlist?list=PLtest123';

  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ playlistId: 'PLtest123', title: 'My Playlist' }),
    }) as jest.Mock;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('auto-fills output folder with slugified title after URL change and debounce', async () => {
    render(<Header defaultOutputFolder={BASE} baseOutputFolder={BASE} onIngest={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: PLAYLIST_URL },
    });

    await act(async () => { jest.runAllTimers(); });
    await screen.findByDisplayValue(`${BASE}/my-playlist`);
  });

  it('does not change the output folder for a URL without ?list=', async () => {
    render(<Header defaultOutputFolder={BASE} baseOutputFolder={BASE} onIngest={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: 'https://example.com/not-a-playlist' },
    });

    await act(async () => { jest.runAllTimers(); });
    expect(screen.getByDisplayValue(BASE)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses playlistId slug when title equals playlistId (no API key fallback)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ playlistId: 'PLtest123', title: 'PLtest123' }),
    });
    render(<Header defaultOutputFolder={BASE} baseOutputFolder={BASE} onIngest={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: PLAYLIST_URL },
    });

    await act(async () => { jest.runAllTimers(); });
    await screen.findByDisplayValue(`${BASE}/pltest123`);
  });

  it('leaves folder unchanged when /api/playlist-info returns an error', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
    render(<Header defaultOutputFolder={BASE} baseOutputFolder={BASE} onIngest={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: PLAYLIST_URL },
    });

    await act(async () => { jest.runAllTimers(); });
    expect(screen.getByDisplayValue(BASE)).toBeInTheDocument();
  });
});

describe('Header — Browse button', () => {
  const originalPlatform = navigator.platform;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function setMac() {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
  }
  function setNonMac() {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
  }

  it('renders Browse button on macOS', () => {
    setMac();
    render(<Header defaultOutputFolder="/folder" onIngest={jest.fn()} />);
    expect(screen.getByRole('button', { name: /browse/i })).toBeInTheDocument();
  });

  it('does not render Browse button on non-macOS', () => {
    setNonMac();
    render(<Header defaultOutputFolder="/folder" onIngest={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /browse/i })).toBeNull();
  });

  it('calls GET /api/pick-folder when Browse is clicked and updates folder on success', async () => {
    setMac();
    global.fetch = (jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ folderPath: '/Users/kujin/picked' }) })
    ) as jest.Mock;

    render(<Header defaultOutputFolder="/original" onIngest={jest.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /browse/i }));
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/pick-folder');
    expect(screen.getByDisplayValue('/Users/kujin/picked')).toBeInTheDocument();
  });

  it('leaves folder unchanged when Browse is cancelled', async () => {
    setMac();
    global.fetch = (jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cancelled: true }) })
    ) as jest.Mock;

    render(<Header defaultOutputFolder="/original" onIngest={jest.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /browse/i }));
    });

    expect(screen.getByDisplayValue('/original')).toBeInTheDocument();
  });

  it('leaves folder unchanged when fetch throws a network error', async () => {
    setMac();
    global.fetch = (jest.fn().mockRejectedValueOnce(new Error('Network error'))) as jest.Mock;

    render(<Header defaultOutputFolder="/original" onIngest={jest.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /browse/i }));
    });

    expect(screen.getByDisplayValue('/original')).toBeInTheDocument();
  });

  it('leaves folder unchanged when server returns a non-ok response', async () => {
    setMac();
    global.fetch = (jest.fn().mockResolvedValueOnce({ ok: false })) as jest.Mock;

    render(<Header defaultOutputFolder="/original" onIngest={jest.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /browse/i }));
    });

    expect(screen.getByDisplayValue('/original')).toBeInTheDocument();
  });
});

describe('Header — URL auto-fill from currentPlaylistUrl prop', () => {
  it('auto-fills URL field when currentPlaylistUrl prop is set and user has not typed', () => {
    const { rerender } = render(
      <Header defaultOutputFolder="/folder" onIngest={jest.fn()} currentPlaylistUrl="" />,
    );
    rerender(
      <Header
        defaultOutputFolder="/folder"
        onIngest={jest.fn()}
        currentPlaylistUrl="https://youtube.com/playlist?list=PLauto"
      />,
    );
    expect(
      (screen.getByPlaceholderText(/playlist url/i) as HTMLInputElement).value,
    ).toBe('https://youtube.com/playlist?list=PLauto');
  });

  it('does NOT auto-fill URL when user has manually typed in the URL field', () => {
    const { rerender } = render(
      <Header defaultOutputFolder="/folder" onIngest={jest.fn()} currentPlaylistUrl="" />,
    );
    // User types their own URL first
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: 'https://youtube.com/playlist?list=PLmanual' },
    });
    // metadata arrives
    rerender(
      <Header
        defaultOutputFolder="/folder"
        onIngest={jest.fn()}
        currentPlaylistUrl="https://youtube.com/playlist?list=PLauto"
      />,
    );
    // manual entry must not be overwritten
    expect(
      (screen.getByPlaceholderText(/playlist url/i) as HTMLInputElement).value,
    ).toBe('https://youtube.com/playlist?list=PLmanual');
  });

  it('resumes auto-fill after Browse success (urlEditedByUser reset)', async () => {
    const savedPlatform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    global.fetch = (jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ folderPath: '/new-folder' }) })
    ) as jest.Mock;

    const { rerender } = render(
      <Header defaultOutputFolder="/folder" onIngest={jest.fn()} currentPlaylistUrl="" />,
    );

    // User types their own URL (sets urlEditedByUser = true)
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: 'https://youtube.com/playlist?list=PLmanual' },
    });

    // User browses to a new folder (resets urlEditedByUser = false)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /browse/i }));
    });

    // Now auto-fill should work again
    rerender(
      <Header
        defaultOutputFolder="/folder"
        onIngest={jest.fn()}
        currentPlaylistUrl="https://youtube.com/playlist?list=PLnew"
      />,
    );
    expect(
      (screen.getByPlaceholderText(/playlist url/i) as HTMLInputElement).value,
    ).toBe('https://youtube.com/playlist?list=PLnew');

    Object.defineProperty(navigator, 'platform', { value: savedPlatform, configurable: true });
  });
});
