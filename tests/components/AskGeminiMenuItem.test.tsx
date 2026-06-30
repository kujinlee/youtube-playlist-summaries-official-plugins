/** @jest-environment jsdom */
import { render, screen, act, fireEvent } from '@testing-library/react';
import AskGeminiMenuItem from '../../components/AskGeminiMenuItem';
import type { Video } from '@/types';

function video(extra: Partial<Video> = {}): Video {
  return {
    id: 'v', title: 'T', youtubeUrl: 'https://youtu.be/abc', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: null, deepDiveMd: null,
    summaryHtml: null, processedAt: '2026-06-09T00:00:00.000Z', ...extra,
  } as Video;
}

const EN = "Please review this video first; I'd like to ask questions about it: https://youtu.be/abc";
const KO = '아래 영상을 먼저 검토해 주세요. 이 영상에 대해 질문하고 싶습니다: https://youtu.be/abc';
const EXPECTED_URL =
  'https://gemini.google.com/app?prompt=' + encodeURIComponent(EN) + '&autosubmit=false';

// Pass a mock to install navigator.clipboard.writeText; pass null to simulate the
// clipboard API being unavailable (navigator.clipboard === undefined).
function setClipboard(writeText: jest.Mock | null) {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

const askButton = () => screen.getByRole('button', { name: /ask gemini about this video/i });

// Flush the clipboard promise chain + fake timers the way the rest of the suite does
// (see Header.test.tsx). advanceTimersByTimeAsync pumps microtasks between timers, so the
// .then/.catch settle reliably regardless of resolve-vs-reject tick depth.
async function flush(ms = 0) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  setClipboard(null); // restore_all_mocks does not undo defineProperty — reset explicitly
});

it('copies the prompt, opens Gemini, shows success, and auto-closes', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  setClipboard(writeText);
  const open = jest.spyOn(window, 'open').mockReturnValue({} as Window);
  const onClose = jest.fn();
  render(<AskGeminiMenuItem video={video({ language: 'en' })} onClose={onClose} />);

  await act(async () => { fireEvent.click(askButton()); await jest.advanceTimersByTimeAsync(0); });

  expect(writeText).toHaveBeenCalledWith(EN);
  expect(open).toHaveBeenCalledWith(EXPECTED_URL, '_blank', 'noopener,noreferrer');
  expect(screen.getByRole('status')).toHaveTextContent(/prompt copied/i);
  expect(onClose).not.toHaveBeenCalled();

  await flush(2500);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('uses the Korean prompt for ko videos', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  setClipboard(writeText);
  jest.spyOn(window, 'open').mockReturnValue({} as Window);
  render(<AskGeminiMenuItem video={video({ language: 'ko' })} onClose={jest.fn()} />);

  await act(async () => { fireEvent.click(askButton()); await jest.advanceTimersByTimeAsync(0); });
  expect(writeText).toHaveBeenCalledWith(KO);
});

it('falls back to a copyable prompt and still opens Gemini when the clipboard write rejects', async () => {
  const writeText = jest.fn().mockRejectedValue(new Error('denied'));
  setClipboard(writeText);
  const open = jest.spyOn(window, 'open').mockReturnValue({} as Window);
  const onClose = jest.fn();
  render(<AskGeminiMenuItem video={video()} onClose={onClose} />);

  await act(async () => { fireEvent.click(askButton()); await jest.advanceTimersByTimeAsync(0); });

  expect(open).toHaveBeenCalledWith(EXPECTED_URL, '_blank', 'noopener,noreferrer'); // Gemini still opened
  expect(screen.getByRole('alert')).toHaveTextContent(/copy this prompt and paste/i);
  expect(screen.getByDisplayValue(EN)).toBeInTheDocument();

  await flush(5000);
  expect(onClose).not.toHaveBeenCalled(); // fallback does not auto-close
});

it('falls back and still opens Gemini when the clipboard API is unavailable', async () => {
  setClipboard(null); // navigator.clipboard === undefined
  const open = jest.spyOn(window, 'open').mockReturnValue({} as Window);
  const onClose = jest.fn();
  render(<AskGeminiMenuItem video={video()} onClose={onClose} />);

  await act(async () => { fireEvent.click(askButton()); await jest.advanceTimersByTimeAsync(0); });

  expect(open).toHaveBeenCalledWith(EXPECTED_URL, '_blank', 'noopener,noreferrer');
  expect(screen.getByRole('alert')).toHaveTextContent(/copy this prompt and paste/i);
  expect(screen.getByDisplayValue(EN)).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

it('does not double-fire onClose when clicked twice', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  setClipboard(writeText);
  jest.spyOn(window, 'open').mockReturnValue({} as Window);
  const onClose = jest.fn();
  render(<AskGeminiMenuItem video={video()} onClose={onClose} />);

  await act(async () => { fireEvent.click(askButton()); await jest.advanceTimersByTimeAsync(0); });
  await act(async () => { fireEvent.click(askButton()); await jest.advanceTimersByTimeAsync(0); });

  await flush(2500);
  expect(onClose).toHaveBeenCalledTimes(1); // first timer was cleared by the second click
});

it('clears the auto-close timer on unmount', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  setClipboard(writeText);
  jest.spyOn(window, 'open').mockReturnValue({} as Window);
  const onClose = jest.fn();
  const { unmount } = render(<AskGeminiMenuItem video={video()} onClose={onClose} />);

  await act(async () => { fireEvent.click(askButton()); await jest.advanceTimersByTimeAsync(0); });
  unmount();

  await flush(5000);
  expect(onClose).not.toHaveBeenCalled();
});
