import {
  formatTimestamp,
  parseClockToSeconds,
  buildWatchUrl,
  timestampLine,
} from '../../lib/transcript-timestamps';

describe('formatTimestamp', () => {
  it('formats sub-hour durations as m:ss', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(75)).toBe('1:15');
    expect(formatTimestamp(135)).toBe('2:15');
    expect(formatTimestamp(599)).toBe('9:59');
  });
  it('formats >= 1h durations as h:mm:ss', () => {
    expect(formatTimestamp(3600)).toBe('1:00:00');
    expect(formatTimestamp(5025)).toBe('1:23:45');
  });
  it('floors fractional seconds and clamps negatives to 0', () => {
    expect(formatTimestamp(135.9)).toBe('2:15');
    expect(formatTimestamp(-5)).toBe('0:00');
  });
});

describe('parseClockToSeconds', () => {
  it('parses m:ss and h:mm:ss', () => {
    expect(parseClockToSeconds('2:15')).toBe(135);
    expect(parseClockToSeconds('1:23:45')).toBe(5025);
    expect(parseClockToSeconds('0:00')).toBe(0);
  });
  it('returns NaN for non-numeric input', () => {
    expect(Number.isNaN(parseClockToSeconds('abc'))).toBe(true);
  });
  it('returns NaN for empty, malformed, too-few, or too-many parts', () => {
    expect(Number.isNaN(parseClockToSeconds(''))).toBe(true);
    expect(Number.isNaN(parseClockToSeconds('1::2'))).toBe(true);
    expect(Number.isNaN(parseClockToSeconds('5'))).toBe(true);
    expect(Number.isNaN(parseClockToSeconds('1:23:45:67'))).toBe(true);
  });
});

describe('buildWatchUrl', () => {
  it('builds a watch URL with an integer t param', () => {
    expect(buildWatchUrl('z02Y-1OvWSM', 135)).toBe(
      'https://www.youtube.com/watch?v=z02Y-1OvWSM&t=135s',
    );
  });
  it('floors and clamps the start', () => {
    expect(buildWatchUrl('abc', 135.9)).toBe('https://www.youtube.com/watch?v=abc&t=135s');
    expect(buildWatchUrl('abc', -1)).toBe('https://www.youtube.com/watch?v=abc&t=0s');
  });
});

describe('timestampLine', () => {
  it('renders the ▶ line with an en dash and start-anchored URL', () => {
    expect(timestampLine(135, 330, 'z02Y-1OvWSM')).toBe(
      '▶ [2:15–5:30](https://www.youtube.com/watch?v=z02Y-1OvWSM&t=135s)',
    );
  });
});
