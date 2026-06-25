/** Location-like interface used by initDigControls and wireDigLinks. */
export interface NavLocation {
  pathname: string;
  search: string;
}

/**
 * Extract videoId and outputFolder from the current page URL.
 * The summary HTML is served at /api/html/[id]?outputFolder=<enc>&type=summary.
 */
function parsePageUrl(loc: NavLocation): { videoId: string; outputFolder: string } | null {
  const parts = loc.pathname.split('/');
  // pathname = /api/html/<videoId>  → parts[0]='' [1]='api' [2]='html' [3]=<id>
  const videoId = parts[3];
  if (!videoId) return null;
  const outputFolder = new URLSearchParams(loc.search).get('outputFolder');
  if (!outputFolder) return null;
  return { videoId, outputFolder };
}

/** Build the "view detail ↓" href for a dug section. */
function viewDetailHref(videoId: string, outputFolder: string, startSec: number): string {
  const u = new URLSearchParams();
  u.set('outputFolder', outputFolder);
  u.set('type', 'dig-deeper');
  return `/api/html/${videoId}?${u.toString()}#t=${startSec}`;
}

/**
 * Mark a summary-side dig control as "dug" (view-detail state).
 * Inserts a ↻ force-redig button alongside the link.
 */
function applyDugState(el: HTMLAnchorElement, videoId: string, outputFolder: string, startSec: number): void {
  el.textContent = 'view detail ↓';
  el.setAttribute('href', viewDetailHref(videoId, outputFolder, startSec));
  el.setAttribute('target', '_blank');
  el.setAttribute('rel', 'noopener noreferrer');
  el.dataset.state = 'dug';
  // Append a force re-dig button if not already present
  if (!el.nextElementSibling?.matches('[data-force-section]')) {
    const btn = el.ownerDocument.createElement('button');
    btn.textContent = '↻';
    btn.setAttribute('data-force-section', String(startSec));
    btn.setAttribute('title', 'Force re-generate section deep-dive');
    el.insertAdjacentElement('afterend', btn);
  }
}

/** Mark a control as loading (⏳, disabled). */
function applyLoadingState(el: HTMLAnchorElement): void {
  el.textContent = '⏳';
  el.dataset.state = 'loading';
  el.removeAttribute('href');
}

/** Mark a control as errored (⚠ retry). Clicking it resets to "dig deeper ▶". */
function applyErrorState(el: HTMLAnchorElement): void {
  el.textContent = '⚠ retry';
  el.dataset.state = 'error';
  el.removeAttribute('href');
}

/** Reset a control to the initial "dig deeper ▶" state. */
function applyIdleState(el: HTMLAnchorElement): void {
  el.textContent = 'dig deeper ▶';
  el.dataset.state = 'idle';
  el.removeAttribute('href');
}

/**
 * Wire the dig-state fetch + POST→SSE state machine for all summary-side
 * `.dig[data-section]` controls in the document.
 *
 * - On load: fetches GET dig-state and marks already-dug controls as "view detail ↓".
 * - On click (idle): POSTs to start a dig job, then opens an EventSource stream.
 * - stream `done` → view detail; stream `{type:'error'}` or transport onerror → ⚠ retry.
 * - Double-click while loading: ignored. Force re-dig (↻): POST with `{force:true}`.
 */
export async function initDigControls(
  doc: Document,
  loc: NavLocation,
): Promise<void> {
  const parsed = parsePageUrl(loc);
  if (!parsed) return;
  const { videoId, outputFolder } = parsed;

  // Collect all summary-side controls (have data-section, no data-type)
  const controls = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a.dig[data-section]'))
    .filter((el) => !el.dataset.type);

  if (controls.length === 0) return;

  // Fetch dig-state; fail-open on any error
  let dugSectionIds: number[] = [];
  try {
    const resp = await fetch(
      `/api/videos/${videoId}/dig-state?outputFolder=${encodeURIComponent(outputFolder)}`,
    );
    if (resp.ok) {
      const data = await resp.json() as { sectionIds: number[] };
      dugSectionIds = data.sectionIds ?? [];
    }
  } catch {
    // fail-open — controls remain "dig deeper ▶"
  }

  /** Start the POST→SSE flow for a control. */
  function startDig(el: HTMLAnchorElement, startSec: number, force?: boolean): void {
    applyLoadingState(el);

    fetch(`/api/videos/${videoId}/dig/${startSec}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(force ? { outputFolder, force: true } : { outputFolder }),
    })
      .then((r) => r.json() as Promise<{ jobId: string }>)
      .then(({ jobId }) => {
        const es = new EventSource(
          `/api/videos/${videoId}/dig/${startSec}/stream?jobId=${encodeURIComponent(jobId)}`,
        );
        es.onmessage = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data as string) as { type: string };
            if (data.type === 'done') {
              es.close();
              applyDugState(el, videoId, outputFolder, startSec);
            } else if (data.type === 'error') {
              es.close();
              applyErrorState(el);
            }
          } catch {
            // ignore malformed messages
          }
        };
        es.onerror = () => {
          es.close();
          applyErrorState(el);
        };
      })
      .catch(() => {
        applyErrorState(el);
      });
  }

  // Apply initial dug/idle state and wire click handlers
  for (const el of controls) {
    const startSec = Number(el.dataset.section);

    if (dugSectionIds.includes(startSec)) {
      applyDugState(el, videoId, outputFolder, startSec);
    } else {
      applyIdleState(el);
    }

    // Wire click: idle → loading. Error → retry (reset to idle then re-click).
    el.addEventListener('click', (e: Event) => {
      e.preventDefault();
      const state = el.dataset.state;
      if (state === 'loading') return; // double-click guard
      if (state === 'error') {
        applyIdleState(el);
        startDig(el, startSec);
        return;
      }
      if (state === 'idle') {
        startDig(el, startSec);
      }
      // 'dug' state: navigation is handled by the href; ↻ button handles force
    });
  }

  // Wire force re-dig buttons emitted alongside dug controls
  doc.querySelectorAll<HTMLElement>('[data-force-section]').forEach((btn) => {
    const startSec = Number(btn.dataset.forceSection);
    const ctrl = btn.previousElementSibling as HTMLAnchorElement | null;
    if (!ctrl) return;
    btn.addEventListener('click', (e: Event) => {
      e.preventDefault();
      startDig(ctrl, startSec, true);
    });
  });
}

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
    // Summary-side controls have data-section but NO data-type; their href is owned by
    // the Task 13 POST state machine — leave them untouched to avoid injecting type=undefined.
    if (!el.dataset.type) return;
    const u = new URL(loc.href);
    u.searchParams.set('type', el.dataset.type);
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
// wireDigLinks + scrollToHashSection + initDigControls above.
// Injected at end-of-body (DOM ready).
// DRIFT WARNING: the inline JS functions (applyDug/applyLoading/applyError/applyIdle/startDig)
// intentionally duplicate the TS helpers above and must be kept in sync — the inline string is not covered by jsdom tests.
export const NAV_SCRIPT = `<script>
(function(){
  // ── cross-doc nav (deep-dive → summary) ──────────────────────────────────
  document.querySelectorAll('a.dig').forEach(function(a){
    if(!a.dataset.type)return;
    var u=new URL(location.href);
    u.searchParams.set('type',a.dataset.type);
    u.hash='t='+a.dataset.t;
    a.setAttribute('href',u.pathname+u.search+u.hash);
  });
  // ── scroll to #t= hash ────────────────────────────────────────────────────
  var m=location.hash.match(/^#t=(\\d+)/);
  if(m){
    var sec=+m[1];
    var starts=[].slice.call(document.querySelectorAll('[data-start]')).map(function(e){return +e.dataset.start;});
    var t=Math.max.apply(null,starts.filter(function(s){return s<=sec;}).concat([-1]));
    if(t>=0){var el=document.querySelector('[data-start="'+t+'"]'); if(el){el.scrollIntoView();}}
  }
  // ── dig-state machine (summary-side only) ────────────────────────────────
  var parts=location.pathname.split('/');
  var videoId=parts[3];
  var _sp=new URLSearchParams(location.search);
  var outputFolder=_sp.get('outputFolder');
  if(!videoId||!outputFolder)return;
  // ── dig-doc client (dig-deeper page only) ────────────────────────────────
  // Correctness premise: the POST job calls upsertDugSection BEFORE emitting
  // "done", so the re-GET of the current page reflects the new dug section.
  if(_sp.get('type')==='dig-deeper'){
    var _dg=document.querySelector('.dg');
    if(_dg){
      function _applyDigErr(el){el.textContent='\\u26a0 retry';el.dataset.state='error';el.removeAttribute('href');}
      // ── Promise-based dig: single POST→SSE→swap core ─────────────────────
      function _startDocDigAsync(trigger){
        return new Promise(function(resolve,reject){
          var startSec=+trigger.dataset.section;
          trigger.textContent='\\u23f3';trigger.dataset.state='loading';trigger.removeAttribute('href');
          fetch('/api/videos/'+videoId+'/dig/'+startSec,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({outputFolder:outputFolder})})
            .then(function(r){if(!r.ok)throw new Error('POST '+r.status);return r.json();})
            .then(function(d){
              var es=new EventSource('/api/videos/'+videoId+'/dig/'+startSec+'/stream?jobId='+encodeURIComponent(d.jobId));
              es.onmessage=function(ev){
                try{var msg=JSON.parse(ev.data);
                  if(msg.type==='done'){
                    es.close();
                    fetch(location.href)
                      .then(function(res){return res.text();})
                      .then(function(html){
                        var dp=new DOMParser();
                        var fd=dp.parseFromString(html,'text/html');
                        var fresh=fd.querySelector('[data-start="'+startSec+'"]');
                        var cur=document.querySelector('[data-start="'+startSec+'"]');
                        if(fresh&&cur&&cur.parentNode){cur.parentNode.replaceChild(document.adoptNode(fresh),cur);}
                        resolve();
                      })
                      .catch(function(err){_applyDigErr(trigger);reject(err);});
                  }else if(msg.type==='error'){es.close();_applyDigErr(trigger);reject(new Error('stream error'));}
                }catch(e){}
              };
              es.onerror=function(){es.close();_applyDigErr(trigger);reject(new Error('SSE error'));};
            })
            .catch(function(err){_applyDigErr(trigger);reject(err);});
        });
      }
      // ── Single-click path: delegate to the async core ─────────────────────
      function _startDocDig(trigger){_startDocDigAsync(trigger).catch(function(){});}
      // ── ⤢ expand all — confirm → serialized loop ──────────────────────────
      var _eaBtn=_dg.querySelector('.dg-expand-all');
      if(_eaBtn){
        var _eaDlg=document.getElementById('_dg-ea-dlg');
        var _eaProg=document.getElementById('_dg-ea-prog');
        var _eaMsg=document.getElementById('_dg-ea-msg');
        var _eaProgMsg=document.getElementById('_dg-ea-prog-msg');
        var _eaFailMsg=document.getElementById('_dg-ea-fail-msg');
        var _eaCancelProg=document.getElementById('_dg-ea-cancel-prog');
        function _eaClose(el){el.removeAttribute('data-open');}
        function _eaOpen(el){el.setAttribute('data-open','');}
        function _eaRunBatch(triggers,N){
          _eaOpen(_eaProg);
          var cancelled=false;
          var failures=[];
          var k=0;
          _eaCancelProg.onclick=function(){cancelled=true;};
          function _next(){
            // Collect still-un-dug triggers (may have changed if DOM was swapped).
            // Exclude error-state triggers — they already failed in this batch run.
            var remaining=[].slice.call(document.querySelectorAll('.dig-trigger[data-section]'))
              .filter(function(t){return t.dataset.state!=='error'&&t.dataset.state!=='loading';});
            if(cancelled||remaining.length===0){
              if(failures.length>0){
                // Show failure summary in the progress overlay then auto-close.
                _eaProgMsg.textContent='Done with '+failures.length+' failure(s).';
                _eaFailMsg.textContent='Failed sections: '+failures.join(', ');
                _eaFailMsg.style.display='';
                setTimeout(function(){_eaClose(_eaProg);_eaFailMsg.style.display='none';},6000);
              }else{
                _eaClose(_eaProg);
              }
              return;
            }
            k++;
            _eaProgMsg.textContent='section '+k+' of '+N+'\\u2026';
            var trig=remaining[0];
            _startDocDigAsync(trig)
              .then(function(){_next();})
              .catch(function(){failures.push(trig.dataset.section);_next();});
          }
          _next();
        }
        _eaBtn.addEventListener('click',function(){
          var triggers=[].slice.call(document.querySelectorAll('.dig-trigger[data-section]'));
          var N=triggers.length;
          if(N===0)return;
          var X=(N*0.05).toFixed(2);
          var Y=Math.ceil(N*30/60);
          _eaMsg.textContent='Expand '+N+' remaining sections? ~$'+X+', ~'+Y+' min (rough estimate)';
          _eaOpen(_eaDlg);
          var _escHandler=function(e){if(e.key==='Escape'){_eaClose(_eaDlg);document.removeEventListener('keydown',_escHandler);}};
          document.addEventListener('keydown',_escHandler);
          _eaDlg.onclick=function(e){if(e.target===_eaDlg){_eaClose(_eaDlg);document.removeEventListener('keydown',_escHandler);}};
          document.getElementById('_dg-ea-confirm').onclick=function(){
            document.removeEventListener('keydown',_escHandler);
            _eaClose(_eaDlg);
            _eaRunBatch(triggers,N);
          };
          document.getElementById('_dg-ea-cancel-dlg').onclick=function(){
            _eaClose(_eaDlg);
            document.removeEventListener('keydown',_escHandler);
          };
        });
      }
      _dg.addEventListener('click',function(e){
        // Toggle (dug → show gist or dug) — zero fetch
        var tog=(e.target.closest?e.target.closest('.dig-toggle'):null);
        if(tog){e.preventDefault();var s=tog.closest('section');if(s)s.classList.toggle('show-gist');return;}
        // Trigger (un-dug → expand in place)
        var trig=(e.target.closest?e.target.closest('.dig-trigger[data-section]'):null);
        if(!trig)return;
        e.preventDefault();
        var st=trig.dataset.state;
        if(st==='loading')return;
        _startDocDig(trig);
      });
      // ── ?dig=N auto-trigger ───────────────────────────────────────────────
      // Strip ?dig from URL immediately (keep type, outputFolder, hash) so
      // reload / back-forward never re-fires generation.
      function _stripDigParam(){
        var u2=new URL(location.href);
        u2.searchParams.delete('dig');
        history.replaceState(null,'',u2.pathname+u2.search+(u2.hash||''));
      }
      function _applyDigDocState(dugIds){
        // Re-apply control visibility to reflect current dug state.
        // (Used by pageshow to refresh a bfcache-restored page.)
        dugIds.forEach(function(id){
          var el=document.querySelector('[data-start="'+id+'"]');
          if(el)el.setAttribute('data-dug','true');
        });
      }
      function _handleDigParam(isPageshow){
        var digN=isPageshow?null:_sp.get('dig');
        var digSec=digN!==null&&digN!==''?+digN:null;
        fetch('/api/videos/'+videoId+'/dig-state?outputFolder='+encodeURIComponent(outputFolder))
          .then(function(r){return r.ok?r.json():Promise.resolve({sectionIds:[]});})
          .then(function(data){
            var dugIds=data.sectionIds||[];
            if(isPageshow){
              // bfcache restore: re-apply states only, no auto-trigger
              _applyDigDocState(dugIds);
              return;
            }
            if(digSec===null)return;
            // Strip ?dig immediately regardless of dug state
            _stripDigParam();
            var trigger=document.querySelector('.dig-trigger[data-section="'+digSec+'"]');
            if(!trigger)return; // invalid/unknown N — no-op
            if(dugIds.indexOf(digSec)>=0){
              // Already dug: scroll only, no POST
              var sect=document.querySelector('[data-start="'+digSec+'"]');
              if(sect)sect.scrollIntoView();
            }else{
              // Un-dug: trigger once then scroll after re-GET replaces section
              _startDocDig(trigger);
            }
          })
          .catch(function(){
            if(!isPageshow)_stripDigParam();
          });
      }
      _handleDigParam(false);
      window.addEventListener('pageshow',function(ev){
        if(ev.persisted)_handleDigParam(true);
      });
    }
    return;
  }
  var controls=[].slice.call(document.querySelectorAll('a.dig[data-section]')).filter(function(a){return!a.dataset.type;});
  if(!controls.length)return;
  function viewHref(sec){
    var p=new URLSearchParams();
    p.set('outputFolder',outputFolder);
    p.set('type','dig-deeper');
    return '/api/html/'+videoId+'?'+p.toString()+'#t='+sec;
  }
  function applyDug(el,sec){
    el.textContent='view detail ↓';
    el.setAttribute('href',viewHref(sec));
    el.setAttribute('target','_blank');
    el.setAttribute('rel','noopener noreferrer');
    el.dataset.state='dug';
    if(!el.nextElementSibling||!el.nextElementSibling.matches('[data-force-section]')){
      var btn=document.createElement('button');
      btn.textContent='↻';
      btn.setAttribute('data-force-section',String(sec));
      btn.setAttribute('title','Force re-generate section deep-dive');
      el.insertAdjacentElement('afterend',btn);
    }
  }
  function applyLoading(el){el.textContent='⏳';el.dataset.state='loading';el.removeAttribute('href');}
  function applyError(el){el.textContent='⚠ retry';el.dataset.state='error';el.removeAttribute('href');}
  function applyIdle(el){el.textContent='dig deeper \\u25b6';el.dataset.state='idle';el.removeAttribute('href');}
  function startDig(el,sec,force){
    applyLoading(el);
    var body={outputFolder:outputFolder};
    if(force)body.force=true;
    fetch('/api/videos/'+videoId+'/dig/'+sec,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){return r.json();})
      .then(function(d){
        var es=new EventSource('/api/videos/'+videoId+'/dig/'+sec+'/stream?jobId='+encodeURIComponent(d.jobId));
        es.onmessage=function(ev){
          try{var data=JSON.parse(ev.data);
            if(data.type==='done'){es.close();applyDug(el,sec);}
            else if(data.type==='error'){es.close();applyError(el);}
          }catch(e){}
        };
        es.onerror=function(){es.close();applyError(el);};
      })
      .catch(function(){applyError(el);});
  }
  fetch('/api/videos/'+videoId+'/dig-state?outputFolder='+encodeURIComponent(outputFolder))
    .then(function(r){return r.ok?r.json():Promise.resolve({sectionIds:[]});})
    .then(function(data){
      var dug=data.sectionIds||[];
      controls.forEach(function(el){
        var sec=+el.dataset.section;
        if(dug.indexOf(sec)>=0){applyDug(el,sec);}else{applyIdle(el);}
        el.addEventListener('click',function(e){
          e.preventDefault();
          var st=el.dataset.state;
          if(st==='loading')return;
          if(st==='error'){applyIdle(el);startDig(el,sec);return;}
          if(st==='idle')startDig(el,sec);
        });
      });
      document.querySelectorAll('[data-force-section]').forEach(function(btn){
        var fSec=+btn.dataset.forceSection;
        var ctrl=btn.previousElementSibling;
        if(!ctrl)return;
        btn.addEventListener('click',function(e){e.preventDefault();startDig(ctrl,fSec,true);});
      });
    })
    .catch(function(){
      controls.forEach(function(el){applyIdle(el);
        el.addEventListener('click',function(e){
          e.preventDefault();
          var st=el.dataset.state;
          if(st==='loading')return;
          if(st==='error'){applyIdle(el);startDig(el,+el.dataset.section);return;}
          if(st==='idle')startDig(el,+el.dataset.section);
        });
      });
    });
})();
</script>`;
