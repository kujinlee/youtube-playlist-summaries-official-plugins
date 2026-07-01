import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Browser, BrowserContext, Page } from 'playwright';

const DEFAULT_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`PDF ${label} timed out after ${ms}ms`)), ms);
    (t as { unref?: () => void }).unref?.();
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Render a self-contained HTML doc to a PDF via headless Chromium and save it atomically.
 *
 * - Locked-down context: JS disabled and all non-`data:` requests blocked — a static, self-contained
 *   doc (inline CSS + base64 images) needs neither, and this shrinks the blast radius.
 * - Print media emulated so the doc's `@media print` rules apply (🖨️/theme/zoom controls hidden).
 * - Atomic write: UUID temp file in the same dir → rename; temp removed on any failure.
 * - Bounded: launch timeout + page default timeout + an overall race, so a hang always rejects
 *   (letting the caller release its job lock) rather than leaking a browser forever.
 */
export async function generateDocPdf(html: string, absOutPath: string, opts: { timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Overall hard cap. Individual ops also carry setDefaultTimeout/launch timeout (nicer errors in
  // real use); this outer race is the guarantee that a hang always rejects so the caller can release
  // its job lock. A healthy job finishes in well under a second (spike: ~0.4s), so one shared budget
  // for the whole job is ample.
  await withTimeout(runGenerate(html, absOutPath, timeoutMs), timeoutMs, 'job');
}

async function runGenerate(html: string, absOutPath: string, timeoutMs: number): Promise<void> {
  const { chromium } = await import('playwright'); // lazy: only load the driver when a PDF is requested
  const dir = path.dirname(absOutPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(absOutPath, '.pdf')}.${crypto.randomUUID()}.pdf.tmp`);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  try {
    try {
      browser = await chromium.launch({ timeout: timeoutMs });
    } catch (err) {
      throw new Error(
        `Failed to launch Chromium for PDF export. Run: npx playwright install chromium\n${(err as Error).message}`,
      );
    }
    context = await browser.newContext({ javaScriptEnabled: false });
    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.route('**/*', (route) => {
      if (route.request().url().startsWith('data:')) route.continue();
      else route.abort();
    });
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    const buf = await page.pdf({ printBackground: true, format: 'A4' });
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, absOutPath);
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
    if (page) { try { await page.close(); } catch { /* ignore */ } }
    if (context) { try { await context.close(); } catch { /* ignore */ } }
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
  }
}
