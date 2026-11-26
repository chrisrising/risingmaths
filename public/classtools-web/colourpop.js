/* ---------- the colour popup ----------
   One picker shared by every colour wheel in ClassTools. Swatches rather than
   numbers: nobody needs an RGB code in the middle of a lesson. The six colours
   last reached for sit at the top, and they are the same six in every window.
   A page only has to load this file; the markup and styling come with it.      */
(function () {
  const CSS = `
#colPop{position:fixed;display:none;z-index:2147483000;padding:10px;border-radius:12px;background:#1f2430;
  box-shadow:0 10px 30px rgba(0,0,0,.45);width:214px;box-sizing:border-box}
#colPop.on{display:block}
#colPop .ttl{color:#9fb0cc;font:700 10.5px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;margin:0 0 5px}
#colPop .row{display:grid;grid-template-columns:repeat(8,1fr);gap:5px;margin-bottom:9px}
#colPop .row:last-child{margin-bottom:0}
#colPop i{display:block;width:100%;aspect-ratio:1;border-radius:50%;cursor:pointer;border:2px solid rgba(255,255,255,.85);
  box-shadow:0 1px 3px rgba(0,0,0,.5);box-sizing:border-box}
#colPop i.on{outline:2.5px solid #22c55e;outline-offset:1px}
#colPop i.none{background:#fff;position:relative;overflow:hidden}
#colPop i.none:after{content:"";position:absolute;left:-20%;top:45%;width:140%;height:12%;background:#e23;transform:rotate(-45deg)}
#colPop .empty{color:#6b7689;font:600 11px system-ui,sans-serif;grid-column:1/-1}
#colPop i.tool{background:#39425a;display:flex;align-items:center;justify-content:center;border-color:#8ea3c8}
#colPop i.tool svg{width:13px;height:13px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#colPop .spec{width:100%;height:30px;border-radius:8px;border:0;padding:0;cursor:pointer;background:none}
#colPop .op{display:flex;align-items:center;gap:7px;margin-top:2px}
#colPop .op input{flex:1;accent-color:#2457d6}
#colPop .op b{color:#dbe3f0;font:700 11px system-ui,sans-serif;min-width:34px;text-align:right}
#colPop .chk{height:26px;border-radius:7px;margin-top:5px;
  background-image:linear-gradient(45deg,#c3c9d4 25%,transparent 25%),linear-gradient(-45deg,#c3c9d4 25%,transparent 25%),
    linear-gradient(45deg,transparent 75%,#c3c9d4 75%),linear-gradient(-45deg,transparent 75%,#c3c9d4 75%);
  background-size:10px 10px;background-position:0 0,0 5px,5px -5px,-5px 0;position:relative;overflow:hidden}
#colPop .chk span{position:absolute;inset:0}`;

  const PALETTE = [
    '#000000','#444c56','#8b949e','#c9d1d9','#ffffff','#7f1d1d','#9a3412','#713f12',
    '#dc2626','#ea580c','#f59e0b','#facc15','#84cc16','#16a34a','#0d9488','#06b6d4',
    '#2563eb','#1d4ed8','#4f46e5','#7c3aed','#a855f7','#d946ef','#ec4899','#f43f5e',
    '#fecaca','#fed7aa','#fef08a','#bbf7d0','#bfdbfe','#ddd6fe'
  ];

  let RECENT = [], pop = null, onPick = null, onAlpha = null;

  if (window.cc && cc.coloursGet) {
    cc.coloursGet().then(l => { RECENT = l || []; paintRecentRow(); }).catch(() => {});
    cc.onColours && cc.onColours(l => { RECENT = l || []; paintRecentRow(); });
  }
  function recentColours() { return RECENT.slice(0, 6); }
  function rememberColour(c) {
    if (!c || !/^#[0-9a-f]{6}$/i.test(c)) return;
    RECENT = [c].concat(RECENT.filter(x => x.toLowerCase() !== c.toLowerCase())).slice(0, 6);
    if (window.cc && cc.colourUsed) cc.colourUsed(c);
  }

  function build() {
    if (pop) return pop;
    const st = document.createElement('style'); st.textContent = CSS;
    document.head.appendChild(st);
    pop = document.createElement('div'); pop.id = 'colPop';
    document.body.appendChild(pop);
    pop.addEventListener('click', e => {
      const t = e.target.closest('i[data-tool]');
      if (t) {
        if (t.dataset.tool === 'spec') { const sp = pop.querySelector('#colSpec'); sp.focus(); sp.click(); }
        else pickOffScreen();
        return;
      }
      const i = e.target.closest('i[data-c]'); if (!i) return;
      const c = i.dataset.c;
      rememberColour(c);
      const fn = onPick; closeColourPop();
      if (fn) fn(c);
    });
    // The spectrum: live as it is dragged, so the shape changes under the pointer.
    pop.addEventListener('input', e => {
      if (e.target.id === 'colSpec') { if (onPick) onPick(e.target.value); paintAlphaSwatch(e.target.value); }
      if (e.target.id === 'colAlpha') {
        const v = +e.target.value / 100;
        pop.querySelector('#colAlphaN').textContent = Math.round(v * 100) + '%';
        paintAlphaSwatch(null, v);
        if (onAlpha) onAlpha(v);
      }
    });
    pop.addEventListener('change', e => { if (e.target.id === 'colSpec') rememberColour(e.target.value); });
    document.addEventListener('pointerdown', e => {
      if (pop.classList.contains('on') && !e.target.closest('#colPop') && !e.target.closest('[data-colpop]')) closeColourPop();
    }, true);
    return pop;
  }

  function paintRecentRow() {
    if (!pop || !pop.classList.contains('on')) return;
    const row = pop.querySelector('.recents'); if (!row) return;
    row.innerHTML = recentColours().length
      ? recentColours().map(c => `<i data-c="${c}" style="background:${c}"></i>`).join('')
      : '<span class="empty">Colours you use will collect here</span>';
  }

  const EYE = '<svg viewBox="0 0 24 24"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L17 9l-2-2zM14 8l2 2-7.5 7.5-3 1 1-3z"/></svg>';
  const SPEC = '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-1.8 0-1.6-1.6-1.6-1.6-3 0-1 .8-1.7 1.8-1.7H16a5 5 0 0 0 5-5C21 5.9 17 3 12 3z"/><circle cx="7.5" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="10.5" r="1.1" fill="currentColor" stroke="none"/></svg>';

  /** Opens the picker beside `anchor`. `onPicked` gets the colour, or '' for no fill.
      Pass showOpacity to offer a see-through slider alongside it. */
  function openColourPop(anchor, current, onPicked, allowNone, opts) {
    opts = opts || {};
    const p = build();
    onPick = onPicked; onAlpha = opts.onAlpha || null;
    const recents = recentColours();
    const base = String(current || '').slice(0, 7);
    const swatch = c => `<i data-c="${c}" style="background:${c}" class="${c.toLowerCase() === base.toLowerCase() ? 'on' : ''}"></i>`;
    p.innerHTML =
      (allowNone ? `<p class="ttl">Fill</p><div class="row"><i class="none${current ? '' : ' on'}" data-c="" title="No fill"></i></div>` : '') +
      `<p class="ttl">Recent</p><div class="row recents">` +
        (recents.length ? recents.map(swatch).join('') : '<span class="empty">Colours you use will collect here</span>') +
      `</div><p class="ttl">Colours</p><div class="row">` + PALETTE.map(swatch).join('') +
        `<i class="tool" data-tool="eye" title="Pick a colour off the screen">${EYE}</i>` +
        `<i class="tool" data-tool="spec" title="Any colour at all">${SPEC}</i>` +
      `</div><input type="color" class="spec" id="colSpec" value="${/^#[0-9a-f]{6}$/i.test(base) ? base : '#2563eb'}">` +
      (opts.onAlpha ? `<p class="ttl" style="margin-top:9px">See-through</p>
         <div class="op"><input type="range" id="colAlpha" min="10" max="100" step="5" value="${Math.round((opts.alpha == null ? 1 : opts.alpha) * 100)}"><b id="colAlphaN">${Math.round((opts.alpha == null ? 1 : opts.alpha) * 100)}%</b></div>
         <div class="chk"><span id="colAlphaSw"></span></div>` : '');
    if (opts.onAlpha) wireAlpha(base || '#2563eb', opts.alpha == null ? 1 : opts.alpha);
    p.classList.add('on');
    const r = anchor.getBoundingClientRect(), pw = p.offsetWidth, ph = p.offsetHeight;
    // Beside a panel rather than on top of it, so you can still see what you are changing.
    const host = anchor.closest('#stylePop');
    let left, top;
    if (host) { const h = host.getBoundingClientRect(); left = h.right + 8; top = r.top - 8;
      if (left + pw > innerWidth - 6) left = h.left - pw - 8; }
    else { left = r.left; top = r.bottom + 6 + ph > innerHeight ? r.top - ph - 6 : r.bottom + 6; }
    let px = Math.max(6, Math.min(innerWidth - pw - 6, left));
    if (window.ctPopClear) px = window.ctPopClear(px, pw);   // clear of the calculator beside the slides
    p.style.left = Math.round(px) + 'px';
    p.style.top = Math.round(Math.max(6, Math.min(innerHeight - ph - 6, top))) + 'px';
  }
  function closeColourPop() { if (pop) pop.classList.remove('on'); onPick = null; onAlpha = null; }

  let swCol = '#2563eb', swA = 1;
  function wireAlpha(c, a) { swCol = c || '#2563eb'; swA = a; paintAlphaSwatch(); }
  function paintAlphaSwatch(c, a) {
    if (c) swCol = c; if (a != null) swA = a;
    const el = pop && pop.querySelector('#colAlphaSw');
    if (el) { el.style.background = swCol; el.style.opacity = swA; }
  }

  /** The eyedropper. Chrome has one built in; where it is missing we say so rather
      than pretending, because guessing a colour would be worse than not offering it. */
  async function pickOffScreen() {
    if (!window.EyeDropper) {
      const t = pop.querySelector('.ttl');
      if (t) { const was = t.textContent; t.textContent = 'Not available here'; setTimeout(() => t.textContent = was, 1600); }
      return;
    }
    pop.classList.remove('on');
    try {
      const r = await new EyeDropper().open();
      if (r && r.sRGBHex) { rememberColour(r.sRGBHex); const fn = onPick; onPick = null; if (fn) fn(r.sRGBHex); }
    } catch (e) { /* they changed their mind: nothing to do */ }
  }

  window.openColourPop = openColourPop;
  window.closeColourPop = closeColourPop;
  window.recentColours = recentColours;
  window.rememberColour = rememberColour;
  window.COLOUR_PALETTE = PALETTE;
})();
