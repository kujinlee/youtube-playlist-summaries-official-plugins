/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import StarRating from '@/components/StarRating';

const VIDEO_ID     = 'abc123';
const OUTPUT_FOLDER = '/tmp/out';

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ ok: true } as Response);
  global.fetch = fetchMock as typeof global.fetch;
});

afterEach(() => jest.clearAllMocks());

function renderStars(value?: number, onChange = jest.fn()) {
  render(
    <StarRating videoId={VIDEO_ID} outputFolder={OUTPUT_FOLDER} value={value} onChange={onChange} />,
  );
  return { onChange };
}

function getStarInputs() {
  return screen.getAllByRole('radio');
}

describe('StarRating', () => {
  describe('display', () => {
    it('renders 5 radio inputs', () => {
      renderStars(3);
      expect(getStarInputs()).toHaveLength(5);
    });

    it('has the correct star checked when value is provided', () => {
      renderStars(3);
      const inputs = getStarInputs();
      expect(inputs[2]).toBeChecked();   // index 2 = star 3
      expect(inputs[0]).not.toBeChecked();
    });

    it('all inputs unchecked when value is undefined', () => {
      renderStars(undefined);
      getStarInputs().forEach((input) => expect(input).not.toBeChecked());
    });
  });

  describe('interaction', () => {
    it('clicking a star calls onChange with that star number', async () => {
      const { onChange } = renderStars(undefined);
      // fireEvent.click on unselected radio fires onChange
      fireEvent.click(getStarInputs()[3]); // star 4
      expect(onChange).toHaveBeenCalledWith(4);
    });

    it('clicking the active star calls onChange with undefined (clear)', () => {
      const { onChange } = renderStars(3);
      fireEvent.click(getStarInputs()[2]); // star 3 is currently active
      expect(onChange).toHaveBeenCalledWith(undefined);
    });

    it('hover previews stars (hovered stars are visually filled)', () => {
      renderStars(1);
      const spans = screen.getAllByText(/[★☆]/);
      fireEvent.mouseEnter(spans[4]); // hover over star 5
      // stars 1–5 should now all show as filled (★)
      expect(screen.getAllByText('★')).toHaveLength(5);
      fireEvent.mouseLeave(spans[4]);
    });

    it('stars are disabled while a save is in flight', async () => {
      // Fetch that never resolves → saving state persists
      fetchMock = jest.fn(() => new Promise<Response>(() => {}));
      global.fetch = fetchMock as typeof global.fetch;
      const { onChange } = renderStars(2);
      act(() => { fireEvent.click(getStarInputs()[3]); }); // start save
      await waitFor(() => {
        getStarInputs().forEach((input) => expect(input).toBeDisabled());
      });
    });

    it('on API failure: first calls onChange(newScore) then calls onChange(previousScore)', async () => {
      fetchMock = jest.fn().mockResolvedValue({ ok: false } as Response);
      global.fetch = fetchMock as typeof global.fetch;
      const { onChange } = renderStars(2);
      fireEvent.click(getStarInputs()[3]); // click star 4
      await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
      expect(onChange).toHaveBeenNthCalledWith(1, 4);  // optimistic update
      expect(onChange).toHaveBeenNthCalledWith(2, 2);  // rollback
    });

    it('fires the correct API request body when setting a score', async () => {
      renderStars(undefined);
      fireEvent.click(getStarInputs()[2]); // star 3
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`/api/videos/${VIDEO_ID}/review`);
      expect(JSON.parse((opts as RequestInit).body as string)).toMatchObject({
        outputFolder: OUTPUT_FOLDER,
        personalScore: 3,
      });
    });

    it('sends personalScore: null when clearing the active star', async () => {
      renderStars(3);
      fireEvent.click(getStarInputs()[2]); // click active star 3 → clear
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.personalScore).toBeNull(); // null serializes as null in JSON
    });
  });
});
