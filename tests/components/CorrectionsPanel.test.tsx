/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import CorrectionsPanel from '@/components/CorrectionsPanel';

const VIDEO_ID      = 'abc123';
const OUTPUT_FOLDER = '/tmp/out';

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ tldr: 'New TL;DR.', takeaways: ['Point one'], corrections: 'Fix Clawcode' }),
  } as unknown as Response);
  global.fetch = fetchMock as typeof global.fetch;
});

afterEach(() => jest.clearAllMocks());

function renderPanel({
  initialCorrections,
  onClose = jest.fn(),
  onSuccess = jest.fn(),
}: {
  initialCorrections?: string;
  onClose?: jest.Mock;
  onSuccess?: jest.Mock;
} = {}) {
  render(
    <CorrectionsPanel
      videoId={VIDEO_ID}
      outputFolder={OUTPUT_FOLDER}
      initialCorrections={initialCorrections}
      onClose={onClose}
      onSuccess={onSuccess}
    />,
  );
  return { onClose, onSuccess };
}

describe('CorrectionsPanel', () => {
  describe('rendering', () => {
    it('renders a dialog with textarea and Regenerate button', () => {
      renderPanel();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('textbox')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
    });

    it('textarea is pre-filled with initialCorrections', () => {
      renderPanel({ initialCorrections: 'Fix Clawcode' });
      expect(screen.getByRole('textbox')).toHaveValue('Fix Clawcode');
    });

    it('portals the overlay to <body> so it is not an invalid <div> child of <tbody>', () => {
      // Mirrors the real mount site: VideoRow renders this inside VideoList's <table><tbody>.
      render(
        <table><tbody data-testid="tbody"><tr><td>
          <CorrectionsPanel
            videoId={VIDEO_ID}
            outputFolder={OUTPUT_FOLDER}
            initialCorrections={undefined}
            onClose={jest.fn()}
            onSuccess={jest.fn()}
          />
        </td></tr></tbody></table>,
      );
      const backdrop = screen.getByTestId('corrections-backdrop');
      // Portaled to document.body — NOT nested inside the table (which caused the hydration error).
      expect(backdrop.closest('tbody')).toBeNull();
      expect(backdrop.parentElement).toBe(document.body);
    });

    it('textarea is empty when initialCorrections is undefined', () => {
      renderPanel();
      expect(screen.getByRole('textbox')).toHaveValue('');
    });

    it('textarea receives focus when panel opens', () => {
      renderPanel();
      expect(screen.getByRole('textbox')).toHaveFocus();
    });
  });

  describe('dismissal', () => {
    it('Cancel button calls onClose without calling onSuccess', () => {
      const { onClose, onSuccess } = renderPanel();
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it('Escape key calls onClose', () => {
      const { onClose } = renderPanel();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clicking backdrop calls onClose', () => {
      const { onClose } = renderPanel();
      fireEvent.click(screen.getByTestId('corrections-backdrop'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('regeneration', () => {
    it('Regenerate button posts to the correct API endpoint', async () => {
      renderPanel({ initialCorrections: 'Fix Clawcode' });
      fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`/api/videos/${VIDEO_ID}/regenerate`);
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body).toMatchObject({ outputFolder: OUTPUT_FOLDER, corrections: 'Fix Clawcode' });
    });

    it('calls onSuccess with tldr, takeaways, corrections, and summaryHtml:null on success', async () => {
      const { onSuccess } = renderPanel({ initialCorrections: 'Fix Clawcode' });
      fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
      await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({
        corrections: 'Fix Clawcode',
        tldr: 'New TL;DR.',
        takeaways: ['Point one'],
        summaryHtml: null,
      }));
    });

    it('calls onClose after successful regeneration', async () => {
      const { onClose } = renderPanel();
      fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });
  });

  describe('loading state', () => {
    it('Regenerate and Cancel buttons are disabled while regenerating', async () => {
      fetchMock = jest.fn(() => new Promise<Response>(() => {}));
      global.fetch = fetchMock as typeof global.fetch;
      renderPanel();
      act(() => { fireEvent.click(screen.getByRole('button', { name: /regenerate/i })); });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /regenerating/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
      });
    });

    it('Escape and backdrop are no-ops while regenerating', () => {
      fetchMock = jest.fn(() => new Promise<Response>(() => {}));
      global.fetch = fetchMock as typeof global.fetch;
      const { onClose } = renderPanel();
      act(() => { fireEvent.click(screen.getByRole('button', { name: /regenerate/i })); });
      fireEvent.keyDown(window, { key: 'Escape' });
      fireEvent.click(screen.getByTestId('corrections-backdrop'));
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('shows error message and keeps panel open when API fails', async () => {
      fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Gemini quota exceeded' }),
      } as unknown as Response);
      global.fetch = fetchMock as typeof global.fetch;
      const { onSuccess } = renderPanel();
      fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Gemini quota exceeded');
      });
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it('shows fallback error message when API returns no error field', async () => {
      fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({}),
      } as unknown as Response);
      global.fetch = fetchMock as typeof global.fetch;
      renderPanel();
      fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    });
  });
});
