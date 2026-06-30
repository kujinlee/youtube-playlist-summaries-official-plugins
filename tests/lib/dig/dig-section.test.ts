jest.mock('../../../lib/index-store');
jest.mock('../../../lib/html-doc/parse');
jest.mock('../../../lib/transcript-source');
jest.mock('../../../lib/dig/section-window');
// Partial mock: stub only generateDig; keep the REAL DIG_GENERATOR_VERSION const (it is exported
// and read-only — mutating it can throw under the SWC/TS transform).
jest.mock('../../../lib/dig/generate', () => ({
  ...jest.requireActual('../../../lib/dig/generate'),
  generateDig: jest.fn(),
}));
jest.mock('../../../lib/transcript-timestamps');
jest.mock('../../../lib/dig/slides');
jest.mock('../../../lib/dig/companion-doc');
jest.mock('node:fs/promises');

import * as indexStore from '../../../lib/index-store';
import * as parseMod from '../../../lib/html-doc/parse';
import * as tsource from '../../../lib/transcript-source';
import * as win from '../../../lib/dig/section-window';
import * as gen from '../../../lib/dig/generate';
import * as tts from '../../../lib/transcript-timestamps';
import * as slides from '../../../lib/dig/slides';
import * as companion from '../../../lib/dig/companion-doc';
import fs from 'node:fs/promises';
import { digSection } from '../../../lib/dig/dig-section';
import type { ProgressEvent } from '../../../types';

const OF = '/out';
const video = { id: 'v', title: 'T', youtubeUrl: 'https://youtu.be/v', durationSeconds: 600, language: 'en', summaryMd: 'v.md' };

beforeEach(() => {
  jest.mocked(indexStore.readIndex).mockReturnValue({ playlistUrl: '', outputFolder: OF, videos: [video] } as any);
  jest.mocked(indexStore.updateVideoFields).mockImplementation(() => {});
  jest.mocked(fs.readFile).mockResolvedValue('md' as any);
  jest.mocked(parseMod.parseSummaryMarkdown).mockReturnValue({ sections: [{ title: 'S', timeRange: { startSec: 60 } }] } as any);
  jest.mocked(tsource.resolveTranscriptSegments).mockResolvedValue({ segments: [] } as any);
  jest.mocked(win.windowForSection).mockReturnValue({ startSec: 60, endSec: 120 } as any);
  jest.mocked(gen.generateDig).mockResolvedValue('raw' as any);
  jest.mocked(tts.resolveTranscriptTokens).mockReturnValue('withts' as any);
  jest.mocked(slides.resolveSlideTokens).mockResolvedValue({ markdown: 'final', slides: [] } as any);
  jest.mocked(companion.upsertDugSection).mockResolvedValue(undefined as any);
});
afterEach(() => jest.clearAllMocks());

it('digs a section end to end and emits done', async () => {
  const events: ProgressEvent[] = [];
  await digSection('v', 60, OF, undefined, (e) => events.push(e));
  expect(jest.mocked(companion.upsertDugSection)).toHaveBeenCalled();
  expect(jest.mocked(indexStore.updateVideoFields)).toHaveBeenCalledWith(OF, 'v', { digDeeperMd: 'v-dig-deeper.md' });
  expect(events[events.length - 1]).toEqual({ type: 'done' });
});

it('emits error (not throw) when the section is not found', async () => {
  jest.mocked(parseMod.parseSummaryMarkdown).mockReturnValue({ sections: [] } as any);
  const events: ProgressEvent[] = [];
  await digSection('v', 60, OF, undefined, (e) => events.push(e));
  expect(events.some((e) => e.type === 'error')).toBe(true);
  expect(jest.mocked(companion.upsertDugSection)).not.toHaveBeenCalled();
});

it('skips the write when aborted before write', async () => {
  const controller = new AbortController(); controller.abort();
  const events: ProgressEvent[] = [];
  await digSection('v', 60, OF, controller.signal, (e) => events.push(e));
  expect(jest.mocked(companion.upsertDugSection)).not.toHaveBeenCalled();
});
