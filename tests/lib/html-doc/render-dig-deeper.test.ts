import fs from 'fs';
import os from 'os';
import path from 'path';
import { renderDigDeeperHtml } from '@/lib/html-doc/render-dig-deeper';

// Minimal valid JPEG bytes (SOI + EOI markers only — enough for Buffer.isBuffer / readFileSync)
const MINIMAL_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'render-dig-deeper-'));
}

describe('renderDigDeeperHtml', () => {
  // -------------------------------------------------------------------------
  // Behavior 1: Image inlined as base64 when file exists
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
      mdPath = path.join(tmpDir, 'test.md');
      const mdContent = `# Slide deck\n\n![A caption](assets/v/300-352.jpg)\n\nSome prose after.\n`;
      html = renderDigDeeperHtml(mdContent, mdPath);
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
  // Behavior 2: Missing asset → img omitted entirely, no relative src, no throw
  // -------------------------------------------------------------------------
  describe('Behavior 2 — missing asset dropped, no relative src, no throw', () => {
    let tmpDir: string;
    let mdPath: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      mdPath = path.join(tmpDir, 'test.md');
      // Reference a file that does NOT exist
      const mdContent = `# Missing slide\n\n![No file](assets/v/missing-999.jpg)\n\nProse continues.\n`;
      html = renderDigDeeperHtml(mdContent, mdPath);
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('does NOT throw when the asset file is missing', () => {
      expect(() => renderDigDeeperHtml(
        `# x\n\n![x](assets/v/no-exist.jpg)\n`,
        path.join(tmpDir, 'x.md'),
      )).not.toThrow();
    });

    it('does NOT emit a relative src="assets/..." for the missing image', () => {
      expect(html).not.toMatch(/src="assets\//);
    });

    it('does NOT emit any <img> for the missing asset (drop, not alt placeholder)', () => {
      expect(html).not.toContain('<img');
    });

    it('emits the surrounding prose (img drop does not swallow the whole doc)', () => {
      expect(html).toContain('Prose continues.');
    });
  });

  // -------------------------------------------------------------------------
  // Behavior 3: HTML escaped (markdown-it html:false)
  // -------------------------------------------------------------------------
  describe('Behavior 3 — HTML escaped (html:false)', () => {
    const mdContent = `# XSS test\n\n<script>alert('xss')</script>\n\n![cap <script>](assets/safe.jpg)\n`;
    let tmpDir: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      html = renderDigDeeperHtml(mdContent, path.join(tmpDir, 'test.md'));
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('escapes raw <script> tags in the body (html:false)', () => {
      expect(html).not.toContain('<script>alert(');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes < in the image alt attribute', () => {
      // The alt should be HTML-escaped — no raw < in alt
      expect(html).not.toMatch(/alt="cap <script>/);
    });
  });

  // -------------------------------------------------------------------------
  // Behavior 4: data-t anchors preserved
  // -------------------------------------------------------------------------
  describe('Behavior 4 — data-t anchors preserved', () => {
    const mdContent = `# Slides\n\nProse with a <a class="dig" data-type="summary" data-t="90">↑ summary</a> control.\n`;
    // Note: html:false means raw HTML is escaped, but markdown handles links normally.
    // We test via a markdown link that outputs data attributes.
    const mdWithLink = `# Slides\n\n[section](https://youtube.com/watch?v=abc&t=90s)\n`;
    let tmpDir: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      html = renderDigDeeperHtml(mdWithLink, path.join(tmpDir, 'test.md'));
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('renders a YouTube link with t= param in the href', () => {
      expect(html).toContain('t=90s');
    });

    it('includes the NAV_SCRIPT (a.dig handling)', () => {
      expect(html).toContain('a.dig');
    });
  });

  // -------------------------------------------------------------------------
  // Behavior 5: Self-contained output
  // -------------------------------------------------------------------------
  describe('Behavior 5 — self-contained output', () => {
    const mdContent = `# Self-contained test\n\nSome body text.\n`;
    let tmpDir: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      html = renderDigDeeperHtml(mdContent, path.join(tmpDir, 'test.md'));
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('is a valid HTML document starting with <!DOCTYPE html>', () => {
      expect(html).toMatch(/^<!DOCTYPE html>/);
    });

    it('has no external <link> stylesheet references', () => {
      expect(html).not.toContain('<link');
    });

    it('inlines CSS inside a <style> block', () => {
      expect(html).toContain('<style>');
    });

    it('inlines the magazine light palette (cream card, gold, ghost vars)', () => {
      expect(html).toContain('--card:#fbf9f6');
      expect(html).toContain('--gold:#b07700');
      expect(html).toContain('--ghost:#f0e7d6');
    });

    it('includes the dark palette + system-dark media query', () => {
      expect(html).toContain('[data-theme="dark"]');
      expect(html).toContain('@media(prefers-color-scheme:dark)');
    });

    it('includes the theme toggle button and scripts', () => {
      expect(html).toContain('id="theme-toggle"');
      expect(html).toContain("localStorage.getItem('html-doc-theme')");
    });

    it('includes the Print button', () => {
      expect(html).toContain('id="print-btn"');
      expect(html).toContain('onclick="window.print()"');
    });

    it('includes the NAV_CSS (.dig rule)', () => {
      expect(html).toContain('.dig{');
    });

    it('includes the NAV_SCRIPT (wireDigLinks + scrollToHashSection)', () => {
      expect(html).toContain('a.dig');
    });

    it('renders the body content', () => {
      expect(html).toContain('Self-contained test');
      expect(html).toContain('Some body text.');
    });

    it('uses the generator meta tag', () => {
      expect(html).toContain('<meta name="generator" content="dig-deeper-html v1">');
    });
  });

  // -------------------------------------------------------------------------
  // Behavior 5b: path traversal in image src → img dropped, no file disclosed
  // -------------------------------------------------------------------------
  describe('Behavior 5b — path traversal dropped, no arbitrary file disclosure', () => {
    let tmpDir: string;
    let secretPath: string;
    let mdPath: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      // Place a "secret" file two levels above tmpDir (in os.tmpdir()).
      // assets/../../<basename> passes startsWith('assets/') but resolves
      // OUTSIDE docDir/assets/ → should be blocked by the containment check.
      secretPath = path.join(os.tmpdir(), `secret-traversal-${path.basename(tmpDir)}.txt`);
      fs.writeFileSync(secretPath, 'supersecret');
      mdPath = path.join(tmpDir, 'test.md');
      // assets/../../<file> resolves to os.tmpdir()/<file> — outside docDir
      const traversalSrc = `assets/../../${path.basename(secretPath)}`;
      const mdContent = `# Traversal test\n\n![x](${traversalSrc})\n\nProse.\n`;
      html = renderDigDeeperHtml(mdContent, mdPath);
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

    it('does not throw', () => {
      expect(html).toContain('Prose.');
    });
  });

  // -------------------------------------------------------------------------
  // Behavior 5c: markdown timestamp links render to clickable href anchors
  // -------------------------------------------------------------------------
  describe('Behavior 5c — markdown timestamp links render as href anchors', () => {
    // Dig-deeper bodies use markdown timestamp LINKS like
    //   ▶ [11:00–21:19](https://www.youtube.com/watch?v=abc&t=660s)
    // (output of resolveTranscriptTokens), NOT raw inline <a data-t> HTML.
    // html:false would escape raw HTML anchors, but markdown links are rendered
    // normally by markdown-it → href anchors with the t= param preserved.
    let tmpDir: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      const mdContent = `# Timestamps\n\n▶ [11:00–21:19](https://www.youtube.com/watch?v=abc&t=660s)\n`;
      html = renderDigDeeperHtml(mdContent, path.join(tmpDir, 'test.md'));
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('renders a markdown timestamp link as a clickable <a> with t= in href', () => {
      expect(html).toContain('href="https://www.youtube.com/watch?v=abc&amp;t=660s"');
    });

    it('preserves the link text including timestamp range', () => {
      expect(html).toContain('11:00');
    });
  });

  // -------------------------------------------------------------------------
  // Behavior 7 (H-1): sentinel-delimited companion doc → section data-start attrs
  // -------------------------------------------------------------------------
  describe('Behavior 7 — sentinel blocks render as <section data-start="N">', () => {
    let tmpDir: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      const mdContent = [
        '---',
        'title: "Test Video"',
        'videoId: "abc12345678"',
        '---',
        '# Test Video',
        '',
        '<!-- dig-section: 312 -->',
        '## Introduction',
        '',
        'Body text for section 312.',
        '<!-- /dig-section -->',
        '',
        '<!-- dig-section: 600 -->',
        '## Advanced Topics',
        '',
        'Body text for section 600.',
        '<!-- /dig-section -->',
      ].join('\n');
      html = renderDigDeeperHtml(mdContent, path.join(tmpDir, 'test-dig-deeper.md'));
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('contains <section data-start="312"', () => {
      expect(html).toContain('<section data-start="312"');
    });

    it('contains <section data-start="600"', () => {
      expect(html).toContain('<section data-start="600"');
    });

    it('renders the section body text inside the section element', () => {
      expect(html).toContain('Body text for section 312');
      expect(html).toContain('Body text for section 600');
    });

    it('pre-sentinel content (title) renders normally outside sections', () => {
      expect(html).toContain('Test Video');
    });
  });

  // -------------------------------------------------------------------------
  // Behavior 6: multiple images — present one inlined, missing one dropped
  // -------------------------------------------------------------------------
  describe('mixed present + missing assets in one doc', () => {
    let tmpDir: string;
    let assetsDir: string;
    let mdPath: string;
    let html: string;

    beforeAll(() => {
      tmpDir = makeTempDir();
      assetsDir = path.join(tmpDir, 'assets', 'v');
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(path.join(assetsDir, 'present.jpg'), MINIMAL_JPEG);
      mdPath = path.join(tmpDir, 'test.md');
      const mdContent = [
        '# Mixed',
        '',
        '![present](assets/v/present.jpg)',
        '',
        '![missing](assets/v/absent.jpg)',
        '',
        'End.',
      ].join('\n');
      html = renderDigDeeperHtml(mdContent, mdPath);
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
