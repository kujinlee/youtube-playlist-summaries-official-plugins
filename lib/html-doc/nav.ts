/** Parse the `t=<sec>s` start time out of a ▶ link URL. */
export function startSecFromTsUrl(url: string): number | null {
  const m = url.match(/[?&]t=(\d+)s/);
  return m ? Number(m[1]) : null;
}

/**
 * The summary-side dig control (POST→SSE flow). Omits `data-type`; uses `data-section`
 * so Task 13's state machine can identify the section to fetch.
 */
export function digControl(startSec: number): string;
/**
 * The deep-dive-side cross-doc nav control (muted trailing link back to summary).
 * `targetType` must be 'summary'. href computed client-side by wireDigLinks via `data-type`.
 */
export function digControl(targetType: 'summary', startSec: number): string;
export function digControl(targetTypeOrStartSec: 'summary' | number, startSec?: number): string {
  if (typeof targetTypeOrStartSec === 'number') {
    // Summary-side: new POST-driven control (D1)
    const sec = targetTypeOrStartSec;
    return ` <a class="dig" data-section="${sec}" data-t="${sec}">dig deeper ▶</a>`;
  }
  // Deep-dive-side: cross-doc "↑ summary" link (backward-compat)
  return ` <a class="dig" data-type="${targetTypeOrStartSec}" data-t="${startSec}">↑ summary</a>`;
}

/** Rebuild each .dig href from the current serve URL: swap `type`, set `#t=`, inherit id+outputFolder. */
export function wireDigLinks(doc: Document, loc: { href: string }): void {
  doc.querySelectorAll('a.dig').forEach((a) => {
    const el = a as HTMLAnchorElement;
    const u = new URL(loc.href);
    u.searchParams.set('type', el.dataset.type as string);
    u.hash = 't=' + el.dataset.t;
    el.setAttribute('href', u.pathname + u.search + u.hash);
  });
}

/** Scroll to the section whose data-start is the greatest value <= the #t=<sec> in the URL. */
export function scrollToHashSection(doc: Document, loc: { hash: string }): void {
  const m = loc.hash.match(/^#t=(\d+)/);
  if (!m) return;
  const sec = Number(m[1]);
  const starts = Array.from(doc.querySelectorAll('[data-start]'))
    .map((e) => Number((e as HTMLElement).dataset.start));
  const target = Math.max(...starts.filter((s) => s <= sec), -1);
  if (target >= 0) (doc.querySelector(`[data-start="${target}"]`) as HTMLElement | null)?.scrollIntoView();
}

export const NAV_CSS =
  `.dig{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--meta);` +
  `font-size:.8rem;font-weight:400;text-decoration:none;white-space:nowrap;cursor:pointer}` +
  `.dig:hover{text-decoration:underline}`;

// Self-contained inline script (the browser can't import the module) — mirrors
// wireDigLinks + scrollToHashSection above. Injected at end-of-body (DOM ready).
export const NAV_SCRIPT = `<script>
(function(){
  document.querySelectorAll('a.dig').forEach(function(a){
    var u=new URL(location.href);
    u.searchParams.set('type',a.dataset.type);
    u.hash='t='+a.dataset.t;
    a.setAttribute('href',u.pathname+u.search+u.hash);
  });
  var m=location.hash.match(/^#t=(\\d+)/);
  if(m){
    var sec=+m[1];
    var starts=[].slice.call(document.querySelectorAll('[data-start]')).map(function(e){return +e.dataset.start;});
    var t=Math.max.apply(null,starts.filter(function(s){return s<=sec;}).concat([-1]));
    if(t>=0){var el=document.querySelector('[data-start="'+t+'"]'); if(el){el.scrollIntoView();}}
  }
})();
</script>`;
