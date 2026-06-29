import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { expect, test } from '@playwright/test';
// Relative imports (NOT '@/…'): the '@/' alias is unproven for RUNTIME (value) imports under
// Playwright's loader — the only existing E2E '@/' import is `import type` (erased).
import { renderDigDeeperDoc } from '../../lib/html-doc/render-dig-deeper';
import type { CropBox } from '../../lib/dig/slide-crop';
import type { ParsedSummary } from '../../lib/html-doc/types';
import type { DugSection } from '../../lib/dig/companion-doc';
import { DIG_GENERATOR_VERSION } from '../../lib/dig/generate';

// A 1×1 white JPEG (same minimal fixture used across dig-deeper.spec.ts).
const MINIMAL_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKwAB/9k=';

const VIDEO_ID_CROP = 'vid-crop-test';
const SEC_CROP = 0;

/**
 * Build a dig-deeper HTML doc with one slide that has a non-null cropMap entry.
 * The cropMap key is the absolute path of the written asset so the renderer
 * finds it deterministically.
 */
function buildHtml(): string {
  // Create a temp dir with the assets path the renderer expects.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-crop-e2e-'));
  const assetSubDir = path.join(dir, 'assets', VIDEO_ID_CROP);
  fs.mkdirSync(assetSubDir, { recursive: true });

  const assetFilename = `${SEC_CROP}-0.jpg`;
  const assetAbs = path.join(assetSubDir, assetFilename);
  fs.writeFileSync(assetAbs, Buffer.from(MINIMAL_B64, 'base64'));

  const mdPath = path.join(dir, `${VIDEO_ID_CROP}-dig-deeper.md`);

  const cropMap = new Map<string, CropBox | null>([
    [assetAbs, { trimTop: 0.25, trimBot: 0.05, width: 1280, height: 720 }],
  ]);

  const summary: ParsedSummary = {
    title: 'Crop Test',
    channel: null,
    duration: null,
    url: `https://www.youtube.com/watch?v=${VIDEO_ID_CROP}`,
    lang: 'EN',
    videoId: VIDEO_ID_CROP,
    tldr: null,
    takeaways: [],
    sourceMd: `${VIDEO_ID_CROP}.md`,
    sections: [
      {
        numeral: '1',
        title: 'S',
        prose: 'p',
        timeRange: {
          startSec: SEC_CROP,
          endSec: SEC_CROP + 60,
          label: '0:00–1:00',
          url: `https://www.youtube.com/watch?v=${VIDEO_ID_CROP}&t=${SEC_CROP}s`,
        },
      },
    ],
  };

  const dug: DugSection[] = [
    {
      sectionId: SEC_CROP,
      startSec: SEC_CROP,
      title: 'S',
      bodyMarkdown: `## S\n\n![slide](assets/${VIDEO_ID_CROP}/${assetFilename})\n`,
      generatedAt: '2026-01-01T00:00:00.000Z',
      genVersion: DIG_GENERATOR_VERSION,
    },
  ];

  return renderDigDeeperDoc({ summary, envelope: null, dug, mdPath, videoId: VIDEO_ID_CROP, cropMap });
}

// ---------------------------------------------------------------------------
// Fixtures: build HTML once per file load (shared across tests).
// ---------------------------------------------------------------------------

let _html: string | undefined;
function getCachedHtml(): string {
  if (!_html) _html = buildHtml();
  return _html;
}

test.beforeEach(async ({ page }) => {
  const html = getCachedHtml();
  // Route pattern mirrors the F5a–F5d style in dig-deeper.spec.ts: no real
  // server needed. We use a synthetic URL so Playwright never tries the network.
  await page.route(`**/api/html/${VIDEO_ID_CROP}**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    }),
  );
  await page.goto(`http://localhost:3000/api/html/${VIDEO_ID_CROP}?outputFolder=%2Ftmp%2Ftest&type=dig-deeper`);
});

// ---------------------------------------------------------------------------
// Z1: cropped slide renders a crop wrapper (figure.dig-slide-crop) in flow,
//     with overflow:hidden and object-fit:cover on the inner img.
// ---------------------------------------------------------------------------

test('Z1 (crop wrapper in flow): figure.dig-slide-crop visible; overflow hidden; img object-fit cover', async ({ page }) => {
  const fig = page.locator('figure.dig-slide-crop').first();
  await expect(fig).toBeVisible();
  await expect(fig).toHaveCSS('overflow', 'hidden');
  await expect(fig.locator('img.dig-slide')).toHaveCSS('object-fit', 'cover');
});

// ---------------------------------------------------------------------------
// Z2: clicking a cropped slide opens the lightbox with the FULL uncropped
//     original src, and the zoom img has no .dig-slide-crop ancestor (L1).
// ---------------------------------------------------------------------------

test('Z2 (lightbox full original): click cropped img → lightbox opens with full src; zoom img has no crop ancestor (L1)', async ({ page }) => {
  const inFlow = page.locator('figure.dig-slide-crop img.dig-slide').first();

  // Capture the base64 src from the in-flow img (this IS the full original —
  // the renderer embeds the full b64 for both the in-flow and lightbox paths;
  // object-position/aspect-ratio do the cropping purely in CSS).
  const src = await inFlow.getAttribute('src');
  expect(src).toBeTruthy();

  await inFlow.click();

  // Lightbox must open
  const zoom = page.locator('.dg-zoom[data-open] img');
  await expect(zoom).toBeVisible({ timeout: 3000 });

  // Zoom img src must equal the full original (same b64 blob)
  await expect(zoom).toHaveAttribute('src', src!);

  // Zoom img must NOT be inside a .dig-slide-crop element
  const hasCropAncestor = await zoom.evaluate(
    (el) => !!el.closest('.dig-slide-crop'),
  );
  expect(hasCropAncestor).toBe(false);
});
