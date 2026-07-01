import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Browser, BrowserContext, Page } from 'playwright';

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Render a self-contained HTML doc to a PDF via headless Chromium and save it atomically.
 *
 * - Locked-down context: JS disabled and all non-`data:` requests blocked — a static, self-contained
 *   doc (inline CSS + base64 images) needs neither, and this shrinks the blast radius.
 * - Print media emulated so the doc's `@media print` rules apply (🖨️/theme/zoom controls hidden).
 * - Atomic write: UUID temp file in the same dir → rename; temp removed on any failure.
 * - Cooperative timeout: the render is raced against a timer. On timeout the `finally` closes the
 *   browser (canceling any pending op) and a `timedOut` guard blocks a late write/rename, so a hung
 *   Chromium can never resurrect and write after the job already reported failure. The dangling render
 *   promise gets a no-op `.catch` so its post-close rejection is not an unhandled rejection.
 */
export async function generateDocPdf(html: string, absOutPath: string, opts: { timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { chromium } = await import('playwright'); // lazy: only load the driver when a PDF is requested
  const dir = path.dirname(absOutPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(absOutPath, '.pdf')}.${crypto.randomUUID()}.pdf.tmp`);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`PDF job timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    (timer as { unref?: () => void }).unref?.();
  });

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

    const render = (async () => {
      await page!.setContent(html, { waitUntil: 'load' });
      await page!.emulateMedia({ media: 'print' });
      const buf = await page!.pdf({ printBackground: true, format: 'A4' });
      if (timedOut) return; // the timeout path already won — never write after reporting failure
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, absOutPath);
    })();
    // If the timeout wins the race, `render` will reject later when the browser is closed in finally;
    // this handler keeps that from becoming an unhandled rejection.
    render.catch(() => { /* swallow post-timeout rejection */ });

    await Promise.race([render, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    // Close the browser FIRST so a hung/pending render is actually canceled, then clean the temp.
    if (page) { try { await page.close(); } catch { /* ignore */ } }
    if (context) { try { await context.close(); } catch { /* ignore */ } }
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}
