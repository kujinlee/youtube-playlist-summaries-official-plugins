import fs from 'fs';
import os from 'os';
import path from 'path';
import { renderDigDeeperDoc } from '@/lib/html-doc/render-dig-deeper';
import type { ParsedSummary } from '@/lib/html-doc/types';
import type { ModelEnvelope } from '@/lib/html-doc/model-store';
import type { DugSection } from '@/lib/dig/companion-doc';
import { DIG_GENERATOR_VERSION } from '@/lib/dig/generate';

// Minimal valid JPEG bytes (SOI + EOI markers only — enough for Buffer.isBuffer / readFileSync)
const MINIMAL_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'render-dig-deeper-'));
}

// ──────────────────────────────────────────────────────────────────────────────
// buildRenderer — behaviors exercised via renderDigDeeperDoc's .dug block
//
// renderDigDeeperDoc renders dugData.bodyMarkdown through buildRenderer, so the
// image-inlining, missing-asset, and containment behaviors are fully covered here.
// Migrated from the old renderDigDeeperHtml describe block (Task 9 cleanup).
// ──────────────────────────────────────────────────────────────────────────────

function makeSummaryWithDugSection(startSec: number): ParsedSummary {
  return {
    title: 'Test Video',
    channel: null,
    duration: null,
    url: 'https://www.youtube.com/watch?v=vid123',
    lang: 'EN',
    videoId: 'vid123',
    tldr: null,
    takeaways: [],
    sourceMd: 'test.md',
    sections: [
      {
        numeral: '1',
        title: 'Test Section',
        prose: 'Test prose',
        timeRange: { startSec, endSec: startSec + 300, label: '0:00–5:00', url: `https://www.youtube.com/watch?v=vid123&t=${startSec}s` },
      },
    ],
  };
}

function makeDugWithBody(startSec: number, bodyMarkdown: string, genVersion = DIG_GENERATOR_VERSION): DugSection {
  return {
    sectionId: startSec,
    startSec,
    title: 'Test Section',
    bodyMarkdown,
    generatedAt: '2026-01-01T00:00:00.000Z',
    genVersion,
  };
}

describe('buildRenderer (via renderDigDeeperDoc .dug block)', () => {
  // -------------------------------------------------------------------------
  // Behavior 1 (migrated): Image inlined as base64 when file exists
  // -------------------------------------------------------------------------
  describe('Behavior 1 — image inlined as base64', () => {
    let tmpDir: string;
    let assetsDir: string;
    let mdPath: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      assetsDir = path.join(tmpDir, 'assets', 'v');
      fs.mkdirSync(assetsDir, { recursive: true });
      const jpegPath = path.join(assetsDir, '300-352.jpg');
      fs.writeFileSync(jpegPath, MINIMAL_JPEG);
      mdPath = path.join(tmpDir, 'test-dig-deeper.md');
      const bodyMd = `## Test Section\n\n![A caption](assets/v/300-352.jpg)\n\nSome prose after.\n`;
      const summary = makeSummaryWithDugSection(60);
      const dug = [makeDugWithBody(60, bodyMd)];
      html = renderDigDeeperDoc({ summary, envelope: null, dug, mdPath, videoId: 'vid123' });
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('contains a data:image/jpeg;base64, src', () => {
      expect(html).toContain('src="data:image/jpeg;base64,');
    });

    it('preserves the alt caption', () => {
      expect(html).toContain('alt="A caption"');
    });

    it('does NOT contain a relative assets/ src', () => {
      expect(html).not.toMatch(/src="assets\//);
    });

    it('does not contain a broken file:// or relative path src', () => {
      expect(html).not.toMatch(/src="(?!data:)[^"]*assets/);
    });
  });

  // -------------------------------------------------------------------------
  // Behavior 2 (migrated): Missing asset → span placeholder, no relative src, no throw
  // -------------------------------------------------------------------------
  describe('Behavior 2 — missing asset shows placeholder span', () => {
    let tmpDir: string;
    let mdPath: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      mdPath = path.join(tmpDir, 'test-dig-deeper.md');
      const bodyMd = `## Test Section\n\n![No file](assets/v/missing-999.jpg)\n\nProse continues.\n`;
      const summary = makeSummaryWithDugSection(60);
      const dug = [makeDugWithBody(60, bodyMd)];
      html = renderDigDeeperDoc({ summary, envelope: null, dug, mdPath, videoId: 'vid123' });
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('does NOT emit a relative src="assets/..." for the missing image', () => {
      expect(html).not.toMatch(/src="assets\//);
    });

    it('does NOT emit any <img> for the missing asset (span placeholder, not img)', () => {
      expect(html).not.toContain('<img');
    });

    it('emits the surrounding prose (img drop does not swallow the whole doc)', () => {
      expect(html).toContain('Prose continues.');
    });
  });

  // -------------------------------------------------------------------------
  // Behavior 5b (migrated): path traversal in image src → img dropped, no file disclosed
  // -------------------------------------------------------------------------
  describe('Behavior 5b — path traversal dropped, no arbitrary file disclosure', () => {
    let tmpDir: string;
    let secretPath: string;
    let mdPath: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      secretPath = path.join(os.tmpdir(), `secret-traversal-${path.basename(tmpDir)}.txt`);
      fs.writeFileSync(secretPath, 'supersecret');
      mdPath = path.join(tmpDir, 'test-dig-deeper.md');
      const traversalSrc = `assets/../../${path.basename(secretPath)}`;
      const bodyMd = `## Test Section\n\n![x](${traversalSrc})\n\nProse.\n`;
      const summary = makeSummaryWithDugSection(60);
      const dug = [makeDugWithBody(60, bodyMd)];
      html = renderDigDeeperDoc({ summary, envelope: null, dug, mdPath, videoId: 'vid123' });
    });

    afterAll(() => {
      try { fs.rmSync(secretPath); } catch { /* ignore */ }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('does NOT emit any <img> for a traversal path', () => {
      expect(html).not.toContain('<img');
    });

    it('does NOT embed the secret file contents as base64', () => {
      const secretB64 = Buffer.from('supersecret').toString('base64');
      expect(html).not.toContain(secretB64);
    });

    it('does not throw and still renders prose', () => {
      expect(html).toContain('Prose.');
    });
  });

  // -------------------------------------------------------------------------
  // T7-1 (migrated): present asset → base64 img
  // -------------------------------------------------------------------------
  describe('T7-1 — present asset → base64 <img>', () => {
    let tmpDir: string;
    let assetsDir: string;
    let mdPath: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      assetsDir = path.join(tmpDir, 'assets', 'v');
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(path.join(assetsDir, 'frame.jpg'), MINIMAL_JPEG);
      mdPath = path.join(tmpDir, 't7-present-dig-deeper.md');
      const bodyMd = `## T7\n\n![A slide caption](assets/v/frame.jpg)\n`;
      const summary = makeSummaryWithDugSection(60);
      const dug = [makeDugWithBody(60, bodyMd)];
      html = renderDigDeeperDoc({ summary, envelope: null, dug, mdPath, videoId: 'vid123' });
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('emits <img class="dig-slide" src="data:image/jpeg;base64, for a present asset', () => {
      expect(html).toContain('<img class="dig-slide" src="data:image/jpeg;base64,');
    });

    it('preserves the alt attribute text', () => {
      expect(html).toContain('alt="A slide caption"');
    });

    it('does NOT emit a <span class="missing-slide"> element for a present asset', () => {
      expect(html).not.toContain('<span class="missing-slide">');
    });
  });

  // -------------------------------------------------------------------------
  // T7-2 (migrated): benign missing file → visible placeholder span
  // -------------------------------------------------------------------------
  describe('T7-2 — benign missing file → <span class="missing-slide"> placeholder', () => {
    let tmpDir: string;
    let mdPath: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      mdPath = path.join(tmpDir, 't7-missing-dig-deeper.md');
      const bodyMd = `## T7\n\n![Slide caption](assets/v/gone.jpg)\n\nProse after.\n`;
      const summary = makeSummaryWithDugSection(60);
      const dug = [makeDugWithBody(60, bodyMd)];
      html = renderDigDeeperDoc({ summary, envelope: null, dug, mdPath, videoId: 'vid123' });
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('emits a <span class="missing-slide"> for a benign missing file', () => {
      expect(html).toContain('<span class="missing-slide">');
    });

    it('placeholder span contains the alt text', () => {
      expect(html).toContain('>Slide caption<');
    });

    it('does NOT emit any <img> for the missing asset', () => {
      expect(html).not.toContain('<img');
    });

    it('does NOT emit any relative assets/ src', () => {
      expect(html).not.toMatch(/src="assets\//);
    });

    it('still renders surrounding prose', () => {
      expect(html).toContain('Prose after.');
    });
  });

  // -------------------------------------------------------------------------
  // T7-3 (migrated): containment violation → silent drop (no placeholder)
  // -------------------------------------------------------------------------
  describe('T7-3 — containment violation → silent drop, no placeholder, no alt', () => {
    let tmpDir: string;
    let secretPath: string;
    let mdPath: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      secretPath = path.join(os.tmpdir(), `secret-t7-${path.basename(tmpDir)}.txt`);
      fs.writeFileSync(secretPath, 'supersecret-t7');
      mdPath = path.join(tmpDir, 't7-traversal-dig-deeper.md');
      const traversalSrc = `assets/../../${path.basename(secretPath)}`;
      const bodyMd = `## T7\n\n![attacker alt](${traversalSrc})\n\nProse.\n`;
      const summary = makeSummaryWithDugSection(60);
      const dug = [makeDugWithBody(60, bodyMd)];
      html = renderDigDeeperDoc({ summary, envelope: null, dug, mdPath, videoId: 'vid123' });
    });

    afterAll(() => {
      try { fs.rmSync(secretPath); } catch { /* ignore */ }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('does NOT emit any <img> for a traversal path', () => {
      expect(html).not.toContain('<img');
    });

    it('does NOT emit a <span class="missing-slide"> element for a containment violation (silent drop)', () => {
      expect(html).not.toContain('<span class="missing-slide">');
    });

    it('does NOT embed attacker-controlled alt text', () => {
      expect(html).not.toContain('attacker alt');
    });

    it('does NOT embed the secret file contents', () => {
      const secretB64 = Buffer.from('supersecret-t7').toString('base64');
      expect(html).not.toContain(secretB64);
    });
  });

  // -------------------------------------------------------------------------
  // T7-4 (migrated): alt text with special chars → HTML-escaped in placeholder
  // -------------------------------------------------------------------------
  describe('T7-4 — alt text with special chars escaped in missing-slide placeholder', () => {
    let tmpDir: string;
    let mdPath: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      mdPath = path.join(tmpDir, 't7-escape-dig-deeper.md');
      // Alt text contains " and < — must be HTML-escaped in the placeholder
      const bodyMd = `## T7\n\n![Say "hello" <world>](assets/v/no-exist.jpg)\n`;
      const summary = makeSummaryWithDugSection(60);
      const dug = [makeDugWithBody(60, bodyMd)];
      html = renderDigDeeperDoc({ summary, envelope: null, dug, mdPath, videoId: 'vid123' });
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('emits a .missing-slide span for the missing asset', () => {
      expect(html).toContain('<span class="missing-slide">');
    });

    it('HTML-escapes double-quote in the placeholder text', () => {
      expect(html).toContain('&quot;hello&quot;');
    });

    it('HTML-escapes < in the placeholder text', () => {
      expect(html).toContain('&lt;world&gt;');
    });

    it('does NOT contain raw < or unescaped " in the placeholder', () => {
      const spanMatch = html.match(/<span class="missing-slide">([^<]*)<\/span>/);
      expect(spanMatch).not.toBeNull();
      expect(spanMatch![1]).not.toMatch(/[<>"]/);
    });
  });

  // -------------------------------------------------------------------------
  // T7-5 (migrated): .missing-slide CSS rule present in output
  // -------------------------------------------------------------------------
  describe('T7-5 — .missing-slide CSS rule present in rendered HTML', () => {
    let tmpDir: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      const summary = makeSummaryWithDugSection(60);
      html = renderDigDeeperDoc({
        summary,
        envelope: null,
        dug: [],
        mdPath: path.join(tmpDir, 't7-css-dig-deeper.md'),
        videoId: 'vid123',
      });
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('includes a .missing-slide CSS rule in the <style> block', () => {
      expect(html).toContain('.missing-slide');
    });
  });

  // -------------------------------------------------------------------------
  // mixed present + missing assets in one dug block
  // -------------------------------------------------------------------------
  describe('mixed present + missing assets in one dug block', () => {
    let tmpDir: string;
    let assetsDir: string;
    let mdPath: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      assetsDir = path.join(tmpDir, 'assets', 'v');
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(path.join(assetsDir, 'present.jpg'), MINIMAL_JPEG);
      mdPath = path.join(tmpDir, 'mixed-dig-deeper.md');
      const bodyMd = [
        '## Mixed',
        '',
        '![present](assets/v/present.jpg)',
        '',
        '![missing](assets/v/absent.jpg)',
        '',
        'End.',
      ].join('\n');
      const summary = makeSummaryWithDugSection(60);
      const dug = [makeDugWithBody(60, bodyMd)];
      html = renderDigDeeperDoc({ summary, envelope: null, dug, mdPath, videoId: 'vid123' });
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('inlines the present image as base64', () => {
      expect(html).toContain('src="data:image/jpeg;base64,');
    });

    it('does NOT emit any relative assets/ src', () => {
      expect(html).not.toMatch(/src="assets\//);
    });

    it('does NOT emit a second <img> for the missing asset', () => {
      // Only one <img> should appear (the inlined one)
      const count = (html.match(/<img/g) ?? []).length;
      expect(count).toBe(1);
    });

    it('still renders surrounding prose', () => {
      expect(html).toContain('End.');
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// renderDigDeeperDoc — merge renderer (Task 6)
// ──────────────────────────────────────────────────────────────────────────────

function makeSummary(overrides: Partial<ParsedSummary> = {}): ParsedSummary {
  return {
    title: 'Test Video',
    channel: null,
    duration: null,
    url: 'https://www.youtube.com/watch?v=vid123',
    lang: 'EN',
    videoId: 'vid123',
    tldr: null,
    takeaways: [],
    sourceMd: 'test.md',
    sections: [
      {
        numeral: '1',
        title: 'Introduction',
        prose: 'Intro prose',
        timeRange: { startSec: 60, endSec: 300, label: '1:00–5:00', url: 'https://www.youtube.com/watch?v=vid123&t=60s' },
      },
      {
        numeral: '2',
        title: 'Main Content',
        prose: 'Main prose',
        timeRange: { startSec: 300, endSec: 600, label: '5:00–10:00', url: 'https://www.youtube.com/watch?v=vid123&t=300s' },
      },
    ],
    ...overrides,
  };
}

function makeEnvelope(overrides: Partial<ModelEnvelope> = {}): ModelEnvelope {
  return {
    sourceMd: 'test.md',
    generatedAt: '2026-01-01T00:00:00.000Z',
    sourceSections: ['Introduction', 'Main Content'],
    model: {
      sections: [
        {
          lead: 'This is the intro lead sentence.',
          bullets: [
            { label: 'Point A', text: 'First bullet text' },
            { label: 'Point B', text: 'Second bullet text' },
            { label: 'Point C', text: 'Third bullet text' },
          ],
        },
        {
          lead: 'This is the main lead sentence.',
          bullets: [
            { label: 'Point X', text: 'Main bullet one' },
            { label: 'Point Y', text: 'Main bullet two' },
            { label: 'Point Z', text: 'Main bullet three' },
          ],
        },
      ],
    },
    ...overrides,
  };
}

function makeDugSection(overrides: Partial<DugSection> = {}): DugSection {
  return {
    sectionId: 60,
    startSec: 60,
    title: 'Introduction',
    bodyMarkdown: '## Introduction\n\nDug content for intro section.',
    generatedAt: '2026-01-01T00:00:00.000Z',
    genVersion: DIG_GENERATOR_VERSION,
    ...overrides,
  };
}

describe('renderDigDeeperDoc', () => {
  let tmpDir: string;
  let mdPath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-dig-deeper-doc-'));
    mdPath = path.join(tmpDir, 'test-dig-deeper.md');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Behavior 1: All sections rendered in order
  // ──────────────────────────────────────────────────────────────────────────
  describe('Behavior 1 — all sections rendered in order', () => {
    let html: string;

    beforeAll(() => {
      const summary = makeSummary();
      const envelope = makeEnvelope();
      html = renderDigDeeperDoc({ summary, envelope, dug: [], mdPath, videoId: 'vid123' });
    });

    it('renders a section element for each summary section', () => {
      const matches = html.match(/<section/g);
      expect(matches?.length).toBeGreaterThanOrEqual(2);
    });

    it('renders Introduction before Main Content', () => {
      const introIdx = html.indexOf('Introduction');
      const mainIdx = html.indexOf('Main Content');
      expect(introIdx).toBeGreaterThanOrEqual(0);
      expect(mainIdx).toBeGreaterThan(introIdx);
    });

    it('each section has data-dug attribute', () => {
      expect(html).toContain('data-dug="false"');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Behavior 2: Un-dug section has .gist + dig-trigger
  // ──────────────────────────────────────────────────────────────────────────
  describe('Behavior 2 — un-dug section: .gist block + dig-trigger', () => {
    let html: string;

    beforeAll(() => {
      const summary = makeSummary();
      const envelope = makeEnvelope();
      html = renderDigDeeperDoc({ summary, envelope, dug: [], mdPath, videoId: 'vid123' });
    });

    it('renders .gist div for sections with gist data', () => {
      expect(html).toContain('class="gist"');
    });

    it('renders the lead sentence in .gist', () => {
      expect(html).toContain('This is the intro lead sentence.');
    });

    it('renders bullets inside .gist', () => {
      expect(html).toContain('First bullet text');
    });

    it('renders a dig-trigger anchor for un-dug sections', () => {
      expect(html).toContain('class="dig-trigger"');
    });

    it('dig-trigger has data-section attribute with the startSec', () => {
      expect(html).toContain('data-section="60"');
    });

    it('dig-trigger text contains "dig deeper ▶"', () => {
      expect(html).toContain('dig deeper ▶');
    });

    it('un-dug section has data-dug="false"', () => {
      expect(html).toContain('data-dug="false"');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Behavior 3: Dug section has .gist (hidden) + .dug (shown) + dig-toggle
  // ──────────────────────────────────────────────────────────────────────────
  describe('Behavior 3 — dug section: .gist + .dug + dig-toggle', () => {
    let html: string;

    beforeAll(() => {
      const summary = makeSummary();
      const envelope = makeEnvelope();
      const dug = [makeDugSection({ sectionId: 60, startSec: 60 })];
      html = renderDigDeeperDoc({ summary, envelope, dug, mdPath, videoId: 'vid123' });
    });

    it('dug section has data-dug="true"', () => {
      expect(html).toContain('data-dug="true"');
    });

    it('dug section still has .gist block (hidden by CSS)', () => {
      expect(html).toContain('class="gist"');
    });

    it('dug section has .dug block with rendered bodyMarkdown', () => {
      expect(html).toContain('class="dug"');
    });

    it('.dug block contains the dug body content', () => {
      expect(html).toContain('Dug content for intro section.');
    });

    it('renders dig-toggle anchor for dug sections', () => {
      expect(html).toContain('class="dig-toggle"');
    });

    it('dig-toggle text contains "show summary ⌃"', () => {
      expect(html).toContain('show summary ⌃');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Behavior 4: timeRange null → no data-start, no dig-trigger, .gist shown
  // ──────────────────────────────────────────────────────────────────────────
  describe('Behavior 4 — timeRange null: no data-start, no dig-trigger, .gist shown', () => {
    let html: string;

    beforeAll(() => {
      const summary = makeSummary({
        sections: [
          {
            numeral: null,
            title: 'Conclusion',
            prose: 'Conclusion prose',
            timeRange: null,
          },
        ],
      });
      const envelope: ModelEnvelope = {
        sourceMd: 'test.md',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceSections: ['Conclusion'],
        model: {
          sections: [
            {
              lead: 'Conclusion lead.',
              bullets: [
                { label: 'A', text: 'Bullet A' },
                { label: 'B', text: 'Bullet B' },
                { label: 'C', text: 'Bullet C' },
              ],
            },
          ],
        },
      };
      html = renderDigDeeperDoc({ summary, envelope, dug: [], mdPath, videoId: 'vid123' });
    });

    it('does NOT emit data-start attribute on the section element', () => {
      // The section element must not have data-start; NAV_SCRIPT may contain the string
      // in its querySelector calls, so we check the section tag itself.
      expect(html).not.toMatch(/<section[^>]*data-start/);
    });

    it('does NOT emit a dig-trigger for a no-timestamp section', () => {
      expect(html).not.toContain('class="dig-trigger"');
    });

    it('renders .gist block even without a timestamp', () => {
      expect(html).toContain('class="gist"');
      expect(html).toContain('Conclusion lead.');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Behavior 5: Skeleton section (gist null) — no .gist, but dig-trigger if startSec
  // ──────────────────────────────────────────────────────────────────────────
  describe('Behavior 5 — skeleton: no .gist, dig-trigger present when startSec exists', () => {
    let html: string;

    beforeAll(() => {
      const summary = makeSummary({
        sections: [
          {
            numeral: '1',
            title: 'Section One',
            prose: 'Some prose',
            timeRange: { startSec: 120, endSec: 240, label: '2:00–4:00', url: 'https://www.youtube.com/watch?v=vid123&t=120s' },
          },
        ],
      });
      // envelope null → skeleton (gist null for all sections)
      html = renderDigDeeperDoc({ summary, envelope: null, dug: [], mdPath, videoId: 'vid123' });
    });

    it('does NOT render a .gist block for a skeleton section', () => {
      expect(html).not.toContain('class="gist"');
    });

    it('still renders dig-trigger when startSec is present', () => {
      expect(html).toContain('class="dig-trigger"');
      expect(html).toContain('data-section="120"');
    });

    it('section has data-dug="false" (un-dug)', () => {
      expect(html).toContain('data-dug="false"');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Behavior 6: Orphan region rendered when orphans exist
  // ──────────────────────────────────────────────────────────────────────────
  describe('Behavior 6 — orphan region rendered', () => {
    let html: string;

    beforeAll(() => {
      const summary = makeSummary({
        sections: [
          {
            numeral: '1',
            title: 'Only Section',
            prose: 'Prose',
            timeRange: { startSec: 60, endSec: 120, label: '1:00–2:00', url: 'https://www.youtube.com/watch?v=vid123&t=60s' },
          },
        ],
      });
      // orphan: sectionId 999 does not match any summary section
      const orphanDug: DugSection = {
        sectionId: 999,
        startSec: 999,
        title: 'Orphaned Section',
        bodyMarkdown: 'Orphan body content here.',
        generatedAt: '2026-01-01T00:00:00.000Z',
        genVersion: DIG_GENERATOR_VERSION,
      };
      html = renderDigDeeperDoc({ summary, envelope: null, dug: [orphanDug], mdPath, videoId: 'vid123' });
    });

    it('renders a .dg-orphans section', () => {
      expect(html).toContain('class="dg-orphans"');
    });

    it('renders orphan title in the orphan region', () => {
      expect(html).toContain('Orphaned Section');
    });

    it('renders orphan body content', () => {
      expect(html).toContain('Orphan body content here.');
    });

    it('renders orphan comment sentinel', () => {
      expect(html).toContain('<!-- orphan: 999 -->');
    });

    it('renders re-dig notice paragraph', () => {
      expect(html).toContain('class="dg-orphan-note"');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Behavior 6b: No orphan region when orphans is empty
  // ──────────────────────────────────────────────────────────────────────────
  describe('Behavior 6b — no orphan region when no orphans', () => {
    let html: string;

    beforeAll(() => {
      const summary = makeSummary();
      html = renderDigDeeperDoc({ summary, envelope: null, dug: [], mdPath, videoId: 'vid123' });
    });

    it('does NOT render .dg-orphans when there are no orphans', () => {
      expect(html).not.toContain('class="dg-orphans"');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Behavior 7: Top bar rendered once
  // ──────────────────────────────────────────────────────────────────────────
  describe('Behavior 7 — top bar rendered once', () => {
    let html: string;

    beforeAll(() => {
      const summary = makeSummary();
      html = renderDigDeeperDoc({ summary, envelope: null, dug: [], mdPath, videoId: 'vid123' });
    });

    it('renders exactly one .dg-topbar div', () => {
      const matches = html.match(/class="dg-topbar"/g);
      expect(matches?.length).toBe(1);
    });

    it('topbar contains ↑ summary anchor', () => {
      expect(html).toContain('↑ summary');
    });

    it('topbar ↑ summary anchor has class="dig" and data-type="summary"', () => {
      expect(html).toContain('data-type="summary"');
    });

    it('topbar contains expand-all button', () => {
      expect(html).toContain('class="dg-expand-all"');
      expect(html).toContain('⤢ expand all');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Behavior 7b: ▶ timestamp href uses trusted args.videoId, not summary.videoId
  // Finding 2 [LOW]: render-dig-deeper.ts ~line 186 used `summary.videoId ?? ''`
  // instead of the authoritative `args.videoId`, causing a broken `watch?v=&t=Ns`
  // link when the summary .md is missing the `video_id` frontmatter field.
  // ──────────────────────────────────────────────────────────────────────────
  describe('Behavior 7b — ▶ href uses args.videoId even when summary.videoId is null', () => {
    let html: string;

    beforeAll(() => {
      // summary.videoId intentionally null — simulates missing video_id frontmatter.
      const summary = makeSummary({ videoId: null });
      // Pass a trusted videoId via args.
      html = renderDigDeeperDoc({ summary, envelope: null, dug: [], mdPath, videoId: 'trusted-vid' });
    });

    it('section ▶ link href contains the trusted args.videoId, not an empty v=', () => {
      // Expect the trusted ID to appear in a YouTube watch URL with a timestamp.
      expect(html).toMatch(/watch\?v=trusted-vid&amp;t=\d+s/);
    });

    it('does NOT produce a broken watch?v=&t= link', () => {
      expect(html).not.toMatch(/watch\?v=&amp;t=/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Behavior 8: Spacing CSS present
  // ──────────────────────────────────────────────────────────────────────────
  describe('Behavior 8 — spacing and toggle CSS present', () => {
    let html: string;

    beforeAll(() => {
      const summary = makeSummary();
      html = renderDigDeeperDoc({ summary, envelope: null, dug: [], mdPath, videoId: 'vid123' });
    });

    it('includes section padding CSS', () => {
      expect(html).toContain('padding:2.4em 0');
    });

    it('includes 2px top border rule between sections', () => {
      expect(html).toMatch(/border-top:2px/);
    });

    it('caps dug slide display size via .dg img.dig-slide (centered, height-capped, zoom cursor)', () => {
      expect(html).toContain('.dg img.dig-slide{');
      expect(html).toContain('max-height:300px');
      expect(html).toContain('cursor:zoom-in');
      expect(html).not.toContain('.dug img{margin:2em 0}'); // old generic rule removed
    });

    it('includes the zoom overlay markup and script (z-index 9500)', () => {
      expect(html).toContain('class="dg-zoom"');
      expect(html).toContain("createElement('img')"); // lightbox img is built in JS, not static markup
      expect(html).toContain('id="_dg-zoom-close"');
      expect(html).toContain('z-index:9500');
      expect(html).toContain("getElementById('_dg-zoom')");
      expect(html).toContain('.dg-zoom{display:none!important}'); // hidden in print even if open
    });

    it('includes default hide-gist CSS for dug sections', () => {
      expect(html).toContain('section[data-dug="true"] .gist{display:none}');
    });

    it('includes .show-gist toggle CSS', () => {
      expect(html).toContain('.show-gist .gist{display:block}');
      expect(html).toContain('.show-gist .dug{display:none}');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Behavior 9: PR-review styling fixes (numeral heading, no title repeat,
  // muted control, gold lead). See screenshot feedback (1)–(4).
  // ──────────────────────────────────────────────────────────────────────────
  describe('Behavior 9 — review styling: numeral heading, muted control, gold lead, no title repeat', () => {
    let html: string;

    beforeAll(() => {
      // makeSummary section 1 = "Introduction", numeral "1", startSec 60.
      html = renderDigDeeperDoc({ summary: makeSummary(), envelope: makeEnvelope(), dug: [], mdPath, videoId: 'vid123' });
    });

    // (1) section number in front of the title, inside the h2 itself
    it('prefixes the section numeral in front of the title in the h2', () => {
      expect(html).toMatch(/<h2>1\. Introduction /);
      expect(html).toMatch(/<h2>2\. Main Content /);
    });

    // (2) the muted .ts link no longer repeats the title — only the timestamp
    it('.ts link shows only the clock timestamp, not a repeated title', () => {
      expect(html).toContain('▶ (1:00)'); // fmtClock(60)
      // The .ts anchor must not contain the section title text.
      expect(html).not.toMatch(/class="ts"[^>]*>[^<]*Introduction/);
    });

    // (3) dig-trigger / dig-toggle / dig-refresh styled as a muted small link (not big serif gold)
    it('emits muted CSS for .dig-trigger, .dig-toggle, and .dig-refresh (meta colour, .8rem)', () => {
      expect(html).toContain('.dg .dig-trigger,.dg .dig-toggle,.dg .dig-refresh{');
      expect(html).toMatch(/\.dg \.dig-trigger,\.dg \.dig-toggle,\.dg \.dig-refresh\{[^}]*color:var\(--meta\)/);
      expect(html).toMatch(/\.dg \.dig-trigger,\.dg \.dig-toggle,\.dg \.dig-refresh\{[^}]*font-size:\.8rem/);
    });

    // (4) gold emphasis restored on the gist lead (matches the original summary render)
    it('renders the gist lead in gold (var(--gold)), matching the original summary style', () => {
      expect(html).toMatch(/\.dg \.lead\{[^}]*color:var\(--gold\)/);
    });

    // control text is unchanged (E2E depends on exact text)
    it('keeps the dig-trigger control text exactly "dig deeper ▶"', () => {
      expect(html).toContain('dig deeper ▶');
    });

    // ── Ask-AI links (Feature 2) ──────────────────────────────────────────
    it('renders a whole-video Ask-AI link in the top bar', () => {
      expect(html).toMatch(/<a class="ask-ai"[^>]*data-ai-prompt="[^"]*Please review this video first/);
      expect(html).toContain('Ask AI about this video');
    });

    it('renders a per-section Ask-AI link with the section prompt + gemini url', () => {
      expect(html).toMatch(/<a class="ask-ai"[^>]*data-ai-prompt="[^"]*this section of the video/);
      expect(html).toMatch(/data-ai-url="https:\/\/gemini\.google\.com\/app\?prompt=/);
    });

    it('section end = NEXT section start; last section is "onward"', () => {
      // section 1 startSec 60 (1:00), next 300 (5:00): range "from 1:00 to 5:00"
      expect(html).toContain('this section of the video (from 1:00 to 5:00)');
      // section 2 startSec 300 (5:00) is last: "from 5:00 onward"
      expect(html).toContain('this section of the video (from 5:00 onward)');
    });

    it('includes the ask-ai toast + script', () => {
      expect(html).toContain('id="_dg-ai-toast"');
      expect(html).toContain("closest('.ask-ai')");
      expect(html).toContain('clipboard');
    });

    it('opens Ask-AI as a sized popup (screen-derived width/height) and severs the opener', () => {
      expect(html).toContain('screen.availWidth');
      expect(html).toContain("'popup=1,width='");
      expect(html).toContain('win.opener=null');
      expect(html).not.toContain("window.open(u,'_blank','noopener,noreferrer')"); // old full-tab call gone
    });
  });

  describe('renderDigDeeperDoc — Ask-AI language threading', () => {
    function summaryTwoSections(): ParsedSummary {
      return {
        title: 'T', channel: null, duration: null,
        url: 'https://www.youtube.com/watch?v=vid123', lang: 'EN', videoId: 'vid123',
        tldr: null, takeaways: [], sourceMd: 'test.md',
        sections: [
          { numeral: '1', title: 'A', prose: 'p', timeRange: { startSec: 10, endSec: 20 } },
          { numeral: '2', title: 'B', prose: 'p', timeRange: { startSec: 40, endSec: 50 } },
        ],
      } as unknown as ParsedSummary;
    }

    it('threads ko: section range uses next start and Korean phrasing', () => {
      const html = renderDigDeeperDoc({
        summary: summaryTwoSections(), envelope: null, dug: [],
        mdPath, videoId: 'vid123', language: 'ko',
      });
      expect(html).toContain('0:10부터 0:40까지'); // section 1 → next start 0:40
      expect(html).toContain('0:40부터)');          // last section → onward
    });

    it('defaults language to en when omitted', () => {
      const html = renderDigDeeperDoc({
        summary: summaryTwoSections(), envelope: null, dug: [],
        mdPath, videoId: 'vid123',
      });
      expect(html).toContain('this section of the video (from 0:10 to 0:40)');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Behavior 10: .dig-refresh control on STALE dug sections (Task 5)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Behavior 10 — .dig-refresh control on stale dug sections', () => {
    // makeSummary section "Introduction" at startSec=60.
    // Use makeDugWithBody to build a dug section at the matching startSec.
    // STALE: genVersion = DIG_GENERATOR_VERSION - 1
    // FRESH: genVersion = DIG_GENERATOR_VERSION

    it('renders a .dig-refresh control on a STALE dug section, keyed on startSec', () => {
      const summary = makeSummaryWithDugSection(312);
      const staleDug = makeDugWithBody(312, '## Test Section\n\nStale content.', DIG_GENERATOR_VERSION - 1);
      const html = renderDigDeeperDoc({ summary, envelope: null, dug: [staleDug], mdPath, videoId: 'vid123' });
      expect(html).toMatch(/class="dig-refresh"[^>]*data-section="312"|data-section="312"[^>]*class="dig-refresh"/);
    });

    it('STALE dug section still has dig-toggle', () => {
      const summary = makeSummaryWithDugSection(312);
      const staleDug = makeDugWithBody(312, '## Test Section\n\nStale content.', DIG_GENERATOR_VERSION - 1);
      const html = renderDigDeeperDoc({ summary, envelope: null, dug: [staleDug], mdPath, videoId: 'vid123' });
      expect(html).toContain('class="dig-toggle"');
    });

    it('does NOT render .dig-refresh anchor on a FRESH dug section', () => {
      const summary = makeSummaryWithDugSection(312);
      const freshDug = makeDugWithBody(312, '## Test Section\n\nFresh content.', DIG_GENERATOR_VERSION);
      const html = renderDigDeeperDoc({ summary, envelope: null, dug: [freshDug], mdPath, videoId: 'vid123' });
      // The CSS contains the class name, so check for the anchor element specifically
      expect(html).not.toContain('class="dig-refresh"');
    });

    it('FRESH dug section still has dig-toggle', () => {
      const summary = makeSummaryWithDugSection(312);
      const freshDug = makeDugWithBody(312, '## Test Section\n\nFresh content.', DIG_GENERATOR_VERSION);
      const html = renderDigDeeperDoc({ summary, envelope: null, dug: [freshDug], mdPath, videoId: 'vid123' });
      expect(html).toContain('class="dig-toggle"');
    });

    it('uses a class distinct from dig-trigger and dig-toggle for the refresh control', () => {
      const summary = makeSummaryWithDugSection(312);
      const staleDug = makeDugWithBody(312, '## Test Section\n\nStale content.', DIG_GENERATOR_VERSION - 1);
      const html = renderDigDeeperDoc({ summary, envelope: null, dug: [staleDug], mdPath, videoId: 'vid123' });
      expect(html).toMatch(/class="dig-refresh"/);
      // Must not reuse dig-trigger or dig-toggle for the refresh element
      expect(html).not.toMatch(/class="dig-trigger"[^>]*↻/);
      expect(html).not.toMatch(/class="dig-toggle"[^>]*↻/);
    });

    it('data-section on .dig-refresh is exactly the startSec value', () => {
      const summary = makeSummaryWithDugSection(312);
      const staleDug = makeDugWithBody(312, '## Test Section\n\nStale content.', DIG_GENERATOR_VERSION - 1);
      const html = renderDigDeeperDoc({ summary, envelope: null, dug: [staleDug], mdPath, videoId: 'vid123' });
      // data-section must be 312 (the startSec), not some other value
      expect(html).toContain('data-section="312"');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Behavior 11: .dig-refresh CSS present in output (Task 5)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Behavior 11 — .dig-refresh CSS styling', () => {
    let html: string;

    beforeAll(() => {
      const summary = makeSummary();
      html = renderDigDeeperDoc({ summary, envelope: null, dug: [], mdPath, videoId: 'vid123' });
    });

    it('includes .dig-refresh in the muted control CSS rule', () => {
      expect(html).toContain('.dg .dig-refresh');
    });

    it('.dig-refresh uses meta color and .8rem font size (matches dig-trigger/toggle style)', () => {
      expect(html).toMatch(/\.dg \.dig-refresh[^}]*color:var\(--meta\)/);
    });

    it('includes a :hover underline rule for .dig-refresh', () => {
      expect(html).toMatch(/\.dg \.dig-refresh:hover\{text-decoration:underline\}/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Behavior PR2-1: Distinct .dg .dug h3 sub-heading style
  // ──────────────────────────────────────────────────────────────────────────
  describe('dig section sub-headings (PR2 render)', () => {
    it('emits a distinct .dg .dug h3 sub-heading rule', () => {
      // render a doc with a dug body containing a ### sub-heading
      const summary = makeSummaryWithDugSection(312);
      const dug = [makeDugWithBody(312, '### How it works\n\nBody.')];
      const html = renderDigDeeperDoc({ summary, envelope: null, dug, mdPath, videoId: 'vid123' });
      // Distinct, stand-out style: gold, larger than prose, bold (Option C).
      // Color (--gold, not --ink) + size (1.12rem, not .95rem) are what make it
      // read as a heading rather than bold prose — assert both, not just weight.
      expect(html).toMatch(/\.dg \.dug h3\{[^}]*font-size:1\.12rem/);
      expect(html).toMatch(/\.dg \.dug h3\{[^}]*font-weight:700/);
      expect(html).toMatch(/\.dg \.dug h3\{[^}]*color:var\(--gold\)/);
      // ONE structural assertion — proves the h3 is INSIDE .dug, not merely both-present:
      expect(html).toMatch(/<div class="dug">[\s\S]*<h3>How it works<\/h3>/);
    });

    it('wraps orphan dug bodies in .dug so their ### sub-headings are covered', () => {
      // orphan: sectionId 99999 does not match any summary section
      const summary = makeSummaryWithDugSection(312);
      const orphanDug = makeDugWithBody(99999, '### Orphan sub\n\nBody.');
      const html = renderDigDeeperDoc({ summary, envelope: null, dug: [orphanDug], mdPath, videoId: 'vid123' });
      // orphan body rendered inside a .dug wrapper (so .dg .dug h3 applies)
      expect(html).toMatch(/<div class="dug">[\s\S]*<h3>Orphan sub<\/h3>/);
    });
  });
});

describe('renderDigDeeperDoc — slide image class (dig-slide)', () => {
  function summaryWithImageSection(): ParsedSummary {
    return {
      title: 'T', channel: null, duration: null,
      url: 'https://www.youtube.com/watch?v=vid123', lang: 'EN', videoId: 'vid123',
      tldr: null, takeaways: [], sourceMd: 'test.md',
      sections: [{ numeral: '1', title: 'S', prose: 'p', timeRange: { startSec: 10, endSec: 20 } }],
    } as unknown as ParsedSummary;
  }
  const dug = (md: string): DugSection[] => [{
    sectionId: 10, startSec: 10, title: 'S', bodyMarkdown: md,
    generatedAt: 'g', genVersion: DIG_GENERATOR_VERSION,
  } as unknown as DugSection];

  it('adds class="dig-slide" to a successfully inlined slide <img>', () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, 'assets', 'vid123'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'assets', 'vid123', 's.jpg'), MINIMAL_JPEG);
    const html = renderDigDeeperDoc({
      summary: summaryWithImageSection(), envelope: null,
      dug: dug('![cap](assets/vid123/s.jpg)'),
      mdPath: path.join(dir, 'doc.md'), videoId: 'vid123',
    });
    expect(html).toMatch(/<img class="dig-slide" src="data:image\/jpeg;base64,/);
  });

  it('does NOT add dig-slide to a missing-asset slide (renders missing-slide span)', () => {
    const dir = makeTempDir();
    const html = renderDigDeeperDoc({
      summary: summaryWithImageSection(), envelope: null,
      dug: dug('![cap](assets/vid123/nope.jpg)'),
      mdPath: path.join(dir, 'doc.md'), videoId: 'vid123',
    });
    expect(html).toContain('class="missing-slide"');
    expect(html).not.toContain('<img class="dig-slide"'); // 'dig-slide' appears in CSS/script always; assert no slide IMG carries it
  });
});
