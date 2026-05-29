/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import NoteCell from '@/components/NoteCell';

const VIDEO_ID      = 'abc123';
const OUTPUT_FOLDER = '/tmp/out';

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ ok: true } as Response);
  global.fetch = fetchMock as typeof global.fetch;
});

afterEach(() => jest.clearAllMocks());

function renderNote(value?: string, onChange = jest.fn()) {
  render(
    <NoteCell videoId={VIDEO_ID} outputFolder={OUTPUT_FOLDER} value={value} onChange={onChange} />,
  );
  return { onChange };
}

function openPopover(value?: string, onChange = jest.fn()) {
  const result = renderNote(value, onChange);
  fireEvent.click(screen.getByRole('button', { name: /add note|edit note|—|.*/i }));
  return result;
}

describe('NoteCell', () => {
  describe('preview', () => {
    it('shows — when note is undefined', () => {
      renderNote(undefined);
      expect(screen.getByRole('button')).toHaveTextContent('—');
    });

    it('shows note text when note is 25 chars or fewer', () => {
      renderNote('short note');
      expect(screen.getByRole('button')).toHaveTextContent('short note');
    });

    it('shows first 25 chars followed by … when note exceeds 25 chars', () => {
      renderNote('this is a very long note that goes beyond twenty-five characters');
      const btn = screen.getByRole('button');
      expect(btn.textContent).toHaveLength(26); // 25 chars + '…' (1 UTF-16 code unit)
      expect(btn.textContent).toMatch(/…$/);
    });
  });

  describe('popover open', () => {
    it('clicking cell opens a dialog', () => {
      openPopover('my note');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('popover textarea is pre-filled with existing note', () => {
      openPopover('my note');
      expect(screen.getByRole('textbox')).toHaveValue('my note');
    });

    it('popover textarea is empty when note is undefined', () => {
      openPopover(undefined);
      expect(screen.getByRole('textbox')).toHaveValue('');
    });
  });

  describe('cancel / dismiss', () => {
    it('Cancel button closes popover without calling onChange', () => {
      const { onChange } = openPopover('my note');
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited' } });
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('Escape key closes popover without calling onChange', () => {
      const { onChange } = openPopover('my note');
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('clicking the backdrop closes popover without calling onChange', () => {
      const { onChange } = openPopover('my note');
      fireEvent.click(screen.getByTestId('note-backdrop'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('save', () => {
    it('Save calls onChange with the typed note and closes popover', async () => {
      const { onChange } = openPopover('old note');
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new note' } });
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith('new note');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('Save with empty textarea calls onChange with undefined (clear note)', async () => {
      const { onChange } = openPopover('existing note');
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => expect(onChange).toHaveBeenCalledWith(undefined));
    });
  });

  describe('saving state', () => {
    it('Save and Cancel buttons are disabled while saving', async () => {
      fetchMock = jest.fn(() => new Promise<Response>(() => {}));
      global.fetch = fetchMock as typeof global.fetch;
      openPopover('note');
      act(() => { fireEvent.click(screen.getByRole('button', { name: /save/i })); });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
      });
    });

    it('shows inline error and keeps popover open when API call fails', async () => {
      fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'internal error' }),
      } as unknown as Response);
      global.fetch = fetchMock as typeof global.fetch;
      const { onChange } = openPopover('note');
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument(); // still open
        expect(screen.getByText('internal error')).toBeInTheDocument();
      });
      expect(onChange).not.toHaveBeenCalled();
    });

    it('Escape and backdrop are no-ops while saving', () => {
      fetchMock = jest.fn(() => new Promise<Response>(() => {}));
      global.fetch = fetchMock as typeof global.fetch;
      openPopover('note');
      act(() => { fireEvent.click(screen.getByRole('button', { name: /save/i })); });
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('request body', () => {
    it('sends personalNote with the typed text', async () => {
      openPopover('old');
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'updated note' } });
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`/api/videos/${VIDEO_ID}/review`);
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body).toMatchObject({ outputFolder: OUTPUT_FOLDER, personalNote: 'updated note' });
    });

    it('sends personalNote: "" when textarea is cleared (triggers deletion)', async () => {
      openPopover('old note');
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.personalNote).toBe('');
    });

    it('does not reject a 500-char note (maxLength enforced by textarea)', async () => {
      const maxNote = 'a'.repeat(500);
      openPopover(undefined);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: maxNote } });
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.personalNote).toHaveLength(500);
    });
  });
});
