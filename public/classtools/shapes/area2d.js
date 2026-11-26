// 2D area and perimeter explorer. Ids carry a 2 suffix so it can sit beside the 3D view.
(function(){
  const $ = id => document.getElementById(id);
  const canvas = $('c2'), stage = $('stage2'), labels = $('labels2'), info = $('info2');
  const ctx = canvas.getContext('2d');

  const UI = {
    rect:{name:'Rectangle', keys:[['w','Width'],['h','Height']], def:{w:6,h:4}},
    square:{name:'Square', keys:[['s','Side']], def:{s:5}},
    tri:{name:'Triangle', keys:[['b','Base'],['h','Height']], def:{b:6,h:4}},
    para:{name:'Parallelogram', keys:[['b','Base'],['h','Height'],['s','Slanted side']], def:{b:6,h:3,s:4}},
    trap:{name:'Trapezium', keys:[['a','Top'],['b','Bottom'],['h','Height']], def:{a:3,b:7,h:4}},
    circle:{name:'Circle', keys:[['r','Radius']], def:{r:3}},
    sector:{name:'Sector', keys:[['r','Radius'],['a','Angle']], def:{r:4,a:90}},
    L:{name:'L-shape', keys:[['W','Width'],['H','Height'],['w2','Notch width'],['h2','Notch height']], def:{W:8,H:6,w2:3,h2:2}},
    free:{name:'Your shape', keys:[], def:{}}
  };
  // stage: 'draw' (pins on a squared grid), 'shape' (elastic band made, shape measured).
  // dimMode cycles 0 = none, 1 = dimensions, 2 = side lengths.
  const S = {shape:'free', dims:{}, unit:'cm', grid:false, areaLab:false, perim:false, showArea:true, showPerim:true, free:null, dimsShow:false, stage:'draw', dimMode:0, angMode:0};
  // Drawing a shape by clicking grid points. Corners are whole cm, in order.
  const build = {on:true, pts:[]};
  // Pieces a shape has been cut into. Each keeps the polygon it was cut as, plus where it has
  // been moved and turned to since, so its squares and its area travel with it.
  let parts = null;          // [{pts, cx, cy, tx, ty, rot}]
  let splitFrom = null;      // the whole shape, kept so the pieces can be put back together
  let splitting = false;     // the Split button is armed and a cut can be drawn
  let cutDrag = null;        // the line being dragged out
  let cutHover = null;       // where the cut would fall, shown before the drag begins
  let partDrag = null;       // a piece being moved or turned
  let selPart = null;        // the piece last touched, whose handle takes priority
  // Undo. Each step keeps a copy of everything a change can touch, taken just before the change.
  const undoStack = [];
  function snapState(){
    return JSON.stringify({
      shape: S.shape, dims: S.dims, free: S.free, grid: S.grid, areaLab: S.areaLab,
      parts: parts && parts.map(q => ({pts: q.pts, cx: q.cx, cy: q.cy, tx: q.tx, ty: q.ty, rot: q.rot, mir: q.mir})),
      splitFrom, locked: [...locked], ang: [...angLocked], build: build.pts, on: build.on, stage: S.stage});
  }
  // A drag records its step only once something actually changes, so tapping a piece to pick it
  // up, or pressing a corner and letting go, does not fill the history with nothing.
  let pendUndo = null;
  function armUndo(){ pendUndo = snapState(); }
  function commitUndo(){
    if (pendUndo === null) return;
    undoStack.push(pendUndo);
    pendUndo = null;
    if (undoStack.length > 40) undoStack.shift();
    const b = $('undoBtn'); if (b) b.disabled = false;
  }
  function markUndo(){
    undoStack.push(snapState());
    if (undoStack.length > 40) undoStack.shift();
    const b = $('undoBtn'); if (b) b.disabled = false;
  }
  function undo(){
    const prev = undoStack.pop();
    if (!prev) return;
    const d = JSON.parse(prev);
    S.shape = d.shape; S.dims = d.dims; S.free = d.free; S.grid = d.grid; S.areaLab = d.areaLab;
    S.stage = d.stage; build.pts = d.build; build.on = d.on;
    parts = d.parts ? d.parts.map(q => ({pts: q.pts, cx: q.cx, cy: q.cy, tx: q.tx, ty: q.ty, rot: q.rot, mir: q.mir})) : null;
    splitFrom = d.splitFrom;
    locked = new Set(d.locked); angLocked = new Set(d.ang);
    selPart = null; partDrag = null; cutDrag = null; cutHover = null; pend = null;
    sync(); draw(); renderCorners();
  }
  let tr = null;      // last screen mapping, used to turn clicks into grid points and find sides
  let clickAt = null; // where a single press started, to tell a click from a drag
  let aim = null;     // where the pointer is while pins are being placed, for the line that follows it
  Object.keys(UI).forEach(k => S.dims[k] = Object.assign({}, UI[k].def));
  const LEN = {cm:1, mm:10, m:0.01};
  const AREA = {cm:1, mm:100, m:0.0001};
  const SQ = {cm:'cm²', mm:'mm²', m:'m²'};
  const fmt = x => Number(x.toFixed(1)).toLocaleString('en-GB', {maximumFractionDigits:1});
  // Area and perimeter are shown to 1 decimal place.
  // One decimal place, but nothing after the point when there is nothing to say.
  const fmt1 = x => { const v = Math.round(x * 10) / 10; return Number.isInteger(v) ? String(v) : v.toFixed(1); };
  // Drag snapping: 1 (whole cm), 0.5 or 0.1. Whole is the default.
  let snapStep = 1;
  // On a big screen the readings are drawn at double size, so the gaps and arcs that keep
  // them clear of the shape have to grow with them.
  const uiScale = () => document.body.classList.contains('big') ? 2 : 1;
  const snapCut = v => snapStep > 0 ? snapTo(v) : Math.round(v);
  /** Where the scissors go in: on the grid when snapping is on, free when it is off. */
  const snapCutPt = q => snapStep > 0 ? [snapTo(q.x), snapTo(q.y)]
                                      : [Number(q.x.toFixed(3)), Number(q.y.toFixed(3))];
  const CUT_PULL = 10 * Math.PI / 180;      // how close to square before the line jumps to it
  /** The direction of a cut from A to B: any angle, but square within ten degrees. */
  function cutDir(ax, ay, bx, by){
    const dx = bx - ax, dy = by - ay;
    if (Math.hypot(dx, dy) < 1e-9) return [1, 0];
    const a = Math.atan2(dy, dx);
    for (const t of [0, Math.PI / 2, Math.PI, -Math.PI / 2]){
      let d = a - t; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) <= CUT_PULL) return [Math.round(Math.cos(t)), Math.round(Math.sin(t))];
    }
    const L = Math.hypot(dx, dy);
    return [dx / L, dy / L];
  }
  const snapTo = v => snapStep > 0 ? Number((Math.round(v / snapStep) * snapStep).toFixed(6)) : Number(v.toFixed(4));

  // Zoom and pan, in screen pixels.
  const view = {z:1, px:0, py:0};
  const ZMIN = 0.25, ZMAX = 8;

  // Geometry in cm, origin bottom-left, y up.
  function geom(){
    if (build.on) return {circle:false, pts:[], W:12, H:12, area:0, name:'Your shape', areaF:'', perimF:'', building:true};
    if (S.shape === 'free' && S.free){
      const pts = S.free.pts;
      let W = 0, H = 0, s = 0;
      pts.forEach((q, i) => {
        W = Math.max(W, q[0]); H = Math.max(H, q[1]);
        const r = pts[(i+1) % pts.length];
        s += q[0]*r[1] - r[0]*q[1];
      });
      return {circle:false, pts, W, H, area:Math.abs(s)/2, name:'Your shape',
        areaF:'Count the 1 cm squares, or split the shape into rectangles and triangles',
        perimF:'P = add up the lengths of all the sides'};
    }
    const p = S.dims[S.shape];
    if (S.shape === 'circle'){
      const r = p.r;
      return {circle:true, cx:r, cy:r, r, W:2*r, H:2*r, area:Math.PI*r*r, perim:2*Math.PI*r,
        pts: Array.from({length:64}, (_, i) => { const a = i / 64 * Math.PI * 2; return [r + r*Math.cos(a), r + r*Math.sin(a)]; }),
        name:'Circle', areaF:`A = π × radius² = π × ${r}²`, perimF:`C = 2 × π × radius = 2 × π × ${r}`};
    }
    if (S.shape === 'sector') return sectorGeom(p);
    if (S.shape === 'L'){
      const W = p.W, H = p.H, w2 = Math.min(p.w2, W-1), h2 = Math.min(p.h2, H-1);
      return {circle:false, pts:[[0,0],[W,0],[W,H-h2],[W-w2,H-h2],[W-w2,H],[0,H]], W, H, area:W*H-w2*h2, name:'L-shape',
        areaF:`A = W × H − notch width × notch height = ${W} × ${H} − ${w2} × ${h2}`,
        perimF:`P = 2 × (W + H) = 2 × (${W} + ${H}) (the notch doesn't change it)`};
    }
    let pts, areaV, areaF, perimF;
    if (S.shape === 'rect'){ pts = [[0,0],[p.w,0],[p.w,p.h],[0,p.h]]; areaV = p.w*p.h; areaF = `A = width × height = ${p.w} × ${p.h}`; perimF = `P = 2 × (width + height) = 2 × (${p.w} + ${p.h})`; }
    else if (S.shape === 'square'){ pts = [[0,0],[p.s,0],[p.s,p.s],[0,p.s]]; areaV = p.s*p.s; areaF = `A = side × side = ${p.s} × ${p.s}`; perimF = `P = 4 × side = 4 × ${p.s}`; }
    else if (S.shape === 'tri'){ pts = [[0,0],[p.b,0],[p.b/2,p.h]]; areaV = p.b*p.h/2; areaF = `A = ½ × base × height = ½ × ${p.b} × ${p.h}`; perimF = 'P = sum of the three sides'; }
    else if (S.shape === 'para'){
      const s = Math.max(p.s, p.h), off = Math.sqrt(s*s - p.h*p.h);
      pts = [[0,0],[p.b,0],[p.b+off,p.h],[off,p.h]];
      areaV = p.b*p.h; areaF = `A = base × height = ${p.b} × ${p.h}`; perimF = 'P = 2 × (base + slanted side)';
    } else {
      const a = Math.min(p.a, p.b), b = Math.max(p.a, p.b), d = (b - a)/2;
      pts = [[0,0],[b,0],[b-d,p.h],[d,p.h]];
      areaV = (a+b)/2*p.h; areaF = `A = ½ × (top + bottom) × height = ½ × (${a} + ${b}) × ${p.h}`; perimF = 'P = top + bottom + two slanted sides';
    }
    let W = 0, H = 0;
    pts.forEach(q => { W = Math.max(W, q[0]); H = Math.max(H, q[1]); });
    return {circle:false, pts, W, H, area:areaV, areaF, perimF, name:UI[S.shape].name};
  }

  // A slice of a circle: the centre, then round the arc. The straight points are kept so the
  // shape can be filled, measured and made solid like any other, while the arc itself is drawn
  // as a true curve rather than as the string of short sides underneath it.
  function sectorGeom(p){
    const r = Math.max(0.2, p.r), a = Math.min(355, Math.max(5, p.a));
    const rad = a * Math.PI / 180, steps = Math.max(12, Math.round(a / 3));
    const raw = [[0, 0]];
    for (let i = 0; i <= steps; i++){ const t = rad * i / steps; raw.push([r*Math.cos(t), r*Math.sin(t)]); }
    const mx = Math.min(...raw.map(q => q[0])), my = Math.min(...raw.map(q => q[1]));
    const pts = raw.map(q => [round6(q[0] - mx), round6(q[1] - my)]);
    const W = Math.max(...pts.map(q => q[0])), H = Math.max(...pts.map(q => q[1]));
    const arcLen = r * rad;
    return {circle:false, sector:{cx:round6(-mx), cy:round6(-my), r, a1:rad, deg:a}, pts, W, H,
      area: Math.PI*r*r*a/360, perim: 2*r + arcLen, arcLen, name:'Sector',
      areaF:`A = (${a}/360) \u00d7 \u03c0 \u00d7 radius\u00b2 = (${a}/360) \u00d7 \u03c0 \u00d7 ${r}\u00b2`,
      perimF:`P = 2 \u00d7 radius + arc = 2 \u00d7 ${r} + (${a}/360) \u00d7 2 \u00d7 \u03c0 \u00d7 ${r}`};
  }

  // The sides of a shape that can be dragged. Each side moves along one axis and changes one
  // measurement: mult says how much the measurement changes per cm the side moves outwards.
  // Positive mult means moving the side outwards makes the shape bigger.
  function sidesFor(shape, p){
    switch (shape){
      case 'rect': return [
        {a:[p.w,0], b:[p.w,p.h], axis:'x', mult:1, key:'w'},
        {a:[0,p.h], b:[p.w,p.h], axis:'y', mult:1, key:'h'},
        {a:[0,0], b:[0,p.h], axis:'x', mult:-1, key:'w'},
        {a:[0,0], b:[p.w,0], axis:'y', mult:-1, key:'h'}];
      case 'square': return [
        {a:[p.s,0], b:[p.s,p.s], axis:'x', mult:1, key:'s'},
        {a:[0,p.s], b:[p.s,p.s], axis:'y', mult:1, key:'s'},
        {a:[0,0], b:[0,p.s], axis:'x', mult:-1, key:'s'},
        {a:[0,0], b:[p.s,0], axis:'y', mult:-1, key:'s'}];
      case 'tri': return [
        {a:[0,0], b:[p.b,0], axis:'y', mult:-1, key:'h'},
        {a:[p.b,0], b:[p.b/2,p.h], axis:'x', mult:2, key:'b'},
        {a:[0,0], b:[p.b/2,p.h], axis:'x', mult:-2, key:'b'}];
      case 'para': {
        const sl = Math.max(p.s, p.h), off = Math.sqrt(sl*sl - p.h*p.h);
        return [
          {a:[0,0], b:[p.b,0], axis:'y', mult:-1, key:'h'},
          {a:[off,p.h], b:[p.b+off,p.h], axis:'y', mult:1, key:'h'},
          {a:[p.b,0], b:[p.b+off,p.h], axis:'x', mult:1, key:'b'},
          {a:[0,0], b:[off,p.h], axis:'x', mult:-1, key:'b'}];
      }
      case 'trap': {
        const A = Math.min(p.a, p.b), B = Math.max(p.a, p.b), d = (B-A)/2;
        const kB = p.b >= p.a ? 'b' : 'a';
        return [
          {a:[0,0], b:[B,0], axis:'y', mult:-1, key:'h'},
          {a:[d,p.h], b:[B-d,p.h], axis:'y', mult:1, key:'h'},
          {a:[B,0], b:[B-d,p.h], axis:'x', mult:1, key:kB},
          {a:[0,0], b:[d,p.h], axis:'x', mult:-1, key:kB}];
      }
      case 'circle': return [
        {a:[2*p.r,p.r], b:[2*p.r,p.r], axis:'x', mult:0.5, key:'r', compass:true},
        {a:[p.r,2*p.r], b:[p.r,2*p.r], axis:'y', mult:0.5, key:'r', compass:true},
        {a:[0,p.r], b:[0,p.r], axis:'x', mult:-0.5, key:'r', compass:true},
        {a:[p.r,0], b:[p.r,0], axis:'y', mult:-0.5, key:'r', compass:true}];
      case 'sector': {
        const g = sectorGeom(p), c = g.sector, m = c.a1 / 2;
        return [{a:[c.cx + Math.cos(m)*c.r, c.cy + Math.sin(m)*c.r],
                 b:[c.cx + Math.cos(m)*c.r, c.cy + Math.sin(m)*c.r],
                 axis: Math.abs(Math.cos(m)) >= Math.abs(Math.sin(m)) ? 'x' : 'y',
                 mult: (Math.abs(Math.cos(m)) >= Math.abs(Math.sin(m)) ? Math.cos(m) : Math.sin(m)) >= 0 ? 1 : -1,
                 key:'r', compass:true}];
      }
      case 'L': {
        const W = p.W, H = p.H, w2 = Math.min(p.w2, W-1), h2 = Math.min(p.h2, H-1);
        return [
          {a:[0,0], b:[W,0], axis:'y', mult:-1, key:'H'},
          {a:[W,0], b:[W,H-h2], axis:'x', mult:1, key:'W'},
          {a:[0,H], b:[W-w2,H], axis:'y', mult:1, key:'H'},
          {a:[0,0], b:[0,H], axis:'x', mult:-1, key:'W'},
          {a:[W-w2,H-h2], b:[W-w2,H], axis:'x', mult:-1, key:'w2'},
          {a:[W-w2,H-h2], b:[W,H-h2], axis:'y', mult:-1, key:'h2'}];
      }
      default: return [];
    }
  }

  function perimeterOf(g){
    if (g.circle || g.sector) return g.perim;
    let t = 0;
    for (let i = 0; i < g.pts.length; i++){
      const a = g.pts[i], b = g.pts[(i+1) % g.pts.length];
      t += Math.hypot(b[0]-a[0], b[1]-a[1]);
    }
    return t;
  }

  // Typing a measurement in. The keys are on screen as well, for a board with no keyboard.
  let pad = null;
  let padKeys = null;
  function closePad(){
    if (padKeys){ document.removeEventListener('keydown', padKeys, true); padKeys = null; }
    if (pad){ pad.remove(); pad = null; }
  }
  function openPad(x, y, title, start, unit, apply){
    closePad();
    pad = document.createElement('div');
    pad.className = 'numpad';
    // The current reading is there to start with, and the first key typed replaces it, the way a
    // calculator does. That way a small correction means one key, not clearing the box first.
    let txt = start ? String(start) : '';
    let fresh = true;
    const show = () => { val.textContent = (txt || '0') + ' ' + unit; val.classList.toggle('npFresh', fresh && !!txt); };
    pad.innerHTML = '<div class="npTitle"></div><div class="npVal"></div><div class="npKeys"></div>';
    pad.querySelector('.npTitle').textContent = title;
    const val = pad.querySelector('.npVal');
    const keys = pad.querySelector('.npKeys');
    const typeKey = k => {
      if (k === 'back'){ if (fresh){ txt = ''; fresh = false; } else txt = txt.slice(0, -1); }
      else {
        if (fresh){ txt = ''; fresh = false; }
        if (k === '.'){ if (!txt.includes('.')) txt += txt ? '.' : '0.'; }
        else if (txt.replace('.', '').length < 6) txt += k;
      }
      show();
    };
    ['7','8','9','4','5','6','1','2','3','.','0','back'].forEach(k => {
      const b = document.createElement('button');
      b.textContent = k === 'back' ? '\u232b' : k;
      if (k === 'back') b.className = 'npBack';
      b.onclick = ev => { ev.stopPropagation(); typeKey(k); };
      keys.appendChild(b);
    });
    const row = document.createElement('div');
    row.className = 'npRow';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.onclick = ev => { ev.stopPropagation(); closePad(); };
    const ok = document.createElement('button');
    ok.textContent = 'Set';
    ok.className = 'npOk';
    const commit = () => {
      const v = parseFloat(txt);
      closePad();
      if (isFinite(v)) apply(v);
    };
    ok.onclick = ev => { ev.stopPropagation(); commit(); };
    // A keyboard works as well as the on-screen keys, for anyone not at the board.
    padKeys = ev => {
      if (ev.key >= '0' && ev.key <= '9') typeKey(ev.key);
      else if (ev.key === '.' || ev.key === ',') typeKey('.');
      else if (ev.key === 'Backspace') typeKey('back');
      else if (ev.key === 'Enter') commit();
      else if (ev.key === 'Escape') closePad();
      else return;
      ev.preventDefault();
      ev.stopPropagation();
    };
    document.addEventListener('keydown', padKeys, true);
    row.appendChild(cancel); row.appendChild(ok);
    pad.appendChild(row);
    pad.onpointerdown = ev => ev.stopPropagation();
    hbox.appendChild(pad);
    show();
    // Kept on the paper rather than hanging off the edge of it.
    const r = pad.getBoundingClientRect(), st = stage.getBoundingClientRect();
    pad.style.left = Math.max(8, Math.min(x - r.width / 2, st.width - r.width - 8)) + 'px';
    pad.style.top = Math.max(8, Math.min(y + 14, st.height - r.height - 8)) + 'px';
  }

  // Putting a typed measurement onto the shape. Anything being held is let go first, so the shape
  // is free to take the new measurement.
  function setSideLength(i, len){
    if (!(len > 0)) return;
    markUndo();
    const P = S.free.pts.map(q => q.slice()), n = P.length, j = (i + 1) % n;
    const dx = P[j][0] - P[i][0], dy = P[j][1] - P[i][1], L = Math.hypot(dx, dy) || 1;
    P[j] = [round6(P[i][0] + dx / L * len), round6(P[i][1] + dy / L * len)];
    if (!validOutline(P)) { warn('That length would make the sides cross.'); return; }
    locked.clear(); angLocked.clear();
    resetZoom(false);
    S.free = {pts: P};
    sync(); draw(); renderCorners();
  }
  // Opening or closing an angle. One of the two sides at the corner stays exactly where it is,
  // and the corner at the far end of the other one slides along the side beyond it. So the side
  // opposite the corner takes up the change by growing or shrinking: on the usual right-angled
  // triangle, the base stays flat on the ground and the upright gets taller or shorter.
  function slideAngle(P, k, deg, dir){
    const n = P.length;
    const iA = dir > 0 ? (k - 1 + n) % n : (k + 1) % n;      // the side that stays put
    const iC = dir > 0 ? (k + 1) % n : (k - 1 + n) % n;      // the corner that slides
    const iD = dir > 0 ? (k + 2) % n : (k - 2 + n) % n;      // the far end of the sliding side
    if (iD === k || iD === iC) return null;
    const B = P[k], A = P[iA], C = P[iC], D = P[iD];
    const ax = A[0] - B[0], ay = A[1] - B[1], la = Math.hypot(ax, ay);
    let ux = C[0] - D[0], uy = C[1] - D[1];
    const lu = Math.hypot(ux, uy);
    if (la < 1e-9 || lu < 1e-9) return null;
    ux /= lu; uy /= lu;
    const base = Math.atan2(ay / la, ax / la), want = deg * Math.PI / 180;
    const rx = D[0] - B[0], ry = D[1] - B[1];
    let best = null;
    // The corner can open either way round from the side that stays; take whichever actually
    // lands on the angle asked for and leaves the outline sound.
    for (const sgn of [1, -1]){
      const th = base + sgn * want, dx = Math.cos(th), dy = Math.sin(th);
      const det = ux * dy - dx * uy;
      if (Math.abs(det) < 1e-9) continue;
      const m = (ux * ry - rx * uy) / det;    // along the new ray out of the corner
      const t = (dx * ry - dy * rx) / det;    // the new length of the sliding side
      if (!(m > 1e-6) || !(t > 1e-6) || m > 1e5 || t > 1e5) continue;
      const cand = P.map((q, i) => i === iC ? [round6(D[0] + ux * t), round6(D[1] + uy * t)] : q.slice());
      const err = Math.abs(angleOf(cand, k) - deg);
      if (err < 0.5 && validOutline(cand) && (!best || err < best.err)) best = {err, cand};
    }
    return best ? best.cand : null;
  }
  // Swinging the next side round the corner, keeping its length. Used when nothing can slide.
  function swingAngle(P, k, deg){
    const n = P.length;
    const A = P[(k - 1 + n) % n], B = P[k], j = (k + 1) % n, C = P[j];
    const ux = A[0]-B[0], uy = A[1]-B[1], lu = Math.hypot(ux, uy);
    const lv = Math.hypot(C[0]-B[0], C[1]-B[1]);
    if (lu < 1e-9 || lv < 1e-9) return null;
    const base = Math.atan2(uy / lu, ux / lu), want = deg * Math.PI / 180;
    let best = null;
    for (const sg of [1, -1]){
      const a = base + sg * want;
      const cand = P.map((q, idx) => idx === j
        ? [round6(B[0] + Math.cos(a) * lv), round6(B[1] + Math.sin(a) * lv)] : q.slice());
      const err = Math.abs(angleOf(cand, k) - deg);
      if (!best || err < best.err) best = {err, cand};
    }
    return best && best.err < 0.5 && validOutline(best.cand) ? best.cand : null;
  }
  function setAngle(k, deg){
    if (!(deg > 0 && deg < 360)) return;
    markUndo();
    const P = S.free.pts.map(q => q.slice()), n = P.length;
    if (n < 3) return;
    const B = P[k];
    // Of the two sides at this corner, the one nearest to level is the one that stays, so a shape
    // standing on a flat base keeps that base where it is.
    const tilt = i => {
      const Q = P[i], dx = Q[0]-B[0], dy = Q[1]-B[1], L = Math.hypot(dx, dy);
      return L < 1e-9 ? 9 : Math.abs(dy) / L;
    };
    const order = tilt((k - 1 + n) % n) <= tilt((k + 1) % n) ? [1, -1] : [-1, 1];
    let out = null;
    for (const d of order){ out = slideAngle(P, k, deg, d); if (out) break; }
    if (!out) out = swingAngle(P, k, deg);
    if (!out){ warn('That angle will not fit this shape.'); return; }
    locked.clear(); angLocked.clear();
    resetZoom(false);
    S.free = {pts: out};
    sync(); draw(); renderCorners();
  }
  // The angle at one corner of an outline, in degrees, counting a corner that turns back on itself.
  function angleOf(P, k){
    const n = P.length, B = P[k], A = P[(k - 1 + n) % n], C = P[(k + 1) % n];
    const ux = A[0]-B[0], uy = A[1]-B[1], vx = C[0]-B[0], vy = C[1]-B[1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (!lu || !lv) return 0;
    let d = Math.acos(Math.max(-1, Math.min(1, (ux*vx + uy*vy) / (lu*lv)))) * 180 / Math.PI;
    let s2 = 0;
    for (let i = 0; i < n; i++){ const a = P[i], b = P[(i+1) % n]; s2 += a[0]*b[1] - b[0]*a[1]; }
    const wind = s2 >= 0 ? 1 : -1;
    if (((B[0]-A[0])*(C[1]-B[1]) - (B[1]-A[1])*(C[0]-B[0])) * wind < 0) d = 360 - d;
    return d;
  }

  // Is this press inside one of the angles on screen? Anywhere from the corner out past the arc,
  // within the opening of the angle itself.
  function angleAt(p){
    for (const a of angHit){
      const dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy);
      if (d < 9 || d > a.r) continue;                       // the corner handle itself keeps its own press
      const c = (dx * a.bx + (-dy) * a.by) / (d || 1);      // screen y runs the other way to grid y
      if (Math.acos(Math.max(-1, Math.min(1, c))) <= a.half + 0.12) return a.k;
    }
    return -1;
  }

  // A point on the canvas as a position on the grid, in centimetres.
  function toGrid(p){
    return {x: ((p.x - tr.cxS - view.px) / view.z + tr.cxS - tr.ox) / tr.sc0,
            y: (tr.oy - ((p.y - tr.cyS - view.py) / view.z + tr.cyS)) / tr.sc0};
  }
  function inside(g, x, y){
    if (g.circle) return (x-g.cx)**2 + (y-g.cy)**2 <= g.r*g.r;
    let c = false;
    const P = g.pts;
    for (let i = 0, j = P.length-1; i < P.length; j = i++){
      const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj-xi)*(y-yi)/(yj-yi) + xi)) c = !c;
    }
    return c;
  }

  // The height is drawn outside the shape, just past its widest point, with thin lines reaching
  // from the top and from the foot of the height. The measurement never runs through the shape.
  function heightOutside(xMax, apexX, footX, h, label){
    const xo = xMax + 1;
    return [
      {a:[xo, 0], b:[xo, h], t:label, vert:true},
      {a:[apexX, h], b:[xo + 0.3, h], ext:true},
      {a:[footX, 0], b:[xo + 0.3, 0], ext:true}
    ];
  }

  // Base and height for an elastic-band shape. The base is the side it sits on. The height runs from
  // the base line to the point farthest from it, and its line is drawn past the end of the shape,
  // not through it. Everything is returned in the shape's own coordinates.
  function dimsFree(P){
    const n = P.length;
    if (n < 3) return [];
    // The base is the side the shape sits on: the lowest one (the longer one if two are level).
    let bi = 0, bl = 0, bestY = Infinity;
    for (let i = 0; i < n; i++){
      const q = P[i], r = P[(i + 1) % n];
      const L = Math.hypot(r[0] - q[0], r[1] - q[1]);
      const my = (q[1] + r[1]) / 2;
      if (my < bestY - 1e-9 || (Math.abs(my - bestY) <= 1e-9 && L > bl)){ bestY = my; bl = L; bi = i; }
    }
    const a = P[bi], b = P[(bi + 1) % n];
    const e = [(b[0] - a[0]) / bl, (b[1] - a[1]) / bl];
    let nrm = [-e[1], e[0]];
    const cen = [P.reduce((s, q) => s + q[0], 0) / n, P.reduce((s, q) => s + q[1], 0) / n];
    if ((cen[0] - a[0]) * nrm[0] + (cen[1] - a[1]) * nrm[1] < 0) nrm = [-nrm[0], -nrm[1]];
    const at = (x, y) => [a[0] + e[0] * x + nrm[0] * y, a[1] + e[1] * x + nrm[1] * y];
    const loc = P.map(q => [(q[0] - a[0]) * e[0] + (q[1] - a[1]) * e[1], (q[0] - a[0]) * nrm[0] + (q[1] - a[1]) * nrm[1]]);
    let apex = loc[0];
    loc.forEach(q => { if (q[1] > apex[1]) apex = q; });
    const h = apex[1];
    const xo = Math.max(...loc.map(q => q[0])) + 1;
    const r1 = v => Math.round(v * 10) / 10;
    // If the height is the same length as another side, that side is labelled instead of a height.
    const twin = P.map((q, i) => {
      const r = P[(i + 1) % n];
      return {i, L: Math.hypot(r[0] - q[0], r[1] - q[1])};
    }).find(o => o.i !== bi && Math.abs(o.L - h) < 1e-6);
    if (twin){
      const q = P[twin.i], r = P[(twin.i + 1) % n];
      const mx = (q[0] + r[0]) / 2, my = (q[1] + r[1]) / 2;
      let ox = mx - cen[0], oy = my - cen[1];
      const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
      return [
        {a: at(0, 0), b: at(bl, 0), base: true, lx: at(bl / 2, -0.9)[0], ly: at(bl / 2, -0.9)[1], t: `base ${r1(bl)} cm`},
        {a: q, b: r, side: true, lx: mx + ox * 0.9, ly: my + oy * 0.9, t: `height ${r1(twin.L)} cm`}
      ];
    }
    return [
      {a: at(0, 0), b: at(bl, 0), base: true, lx: at(bl / 2, -0.9)[0], ly: at(bl / 2, -0.9)[1], t: `base ${r1(bl)} cm`},
      {a: at(xo, 0), b: at(xo, h), vert: true, lx: at(xo + 0.5, h / 2)[0], ly: at(xo + 0.5, h / 2)[1], t: `height ${r1(h)} cm`},
      {a: at(apex[0], h), b: at(xo + 0.3, h), ext: true},
      {a: at(apex[0], 0), b: at(xo + 0.3, 0), ext: true}
    ];
  }

  // The measurements marked by Dimensions: the base and the height, or the radius.
  function dimsFor(shape, p){
    switch (shape){
      case 'rect': return [{a:[0,0], b:[p.w,0], t:`base ${p.w} cm`, base:true}, ...heightOutside(p.w, p.w/2, p.w/2, p.h, `height ${p.h} cm`)];
      case 'square': return [{a:[0,0], b:[p.s,0], t:`side ${p.s} cm`, base:true}, ...heightOutside(p.s, p.s/2, p.s/2, p.s, `height ${p.s} cm`)];
      case 'tri': return [{a:[0,0], b:[p.b,0], t:`base ${p.b} cm`, base:true}, ...heightOutside(p.b, p.b/2, p.b/2, p.h, `height ${p.h} cm`)];
      case 'para': {
        const sl = Math.max(p.s, p.h), off = Math.sqrt(sl*sl - p.h*p.h);
        return [{a:[0,0], b:[p.b,0], t:`base ${p.b} cm`, base:true}, ...heightOutside(Math.max(p.b, off + p.b), off, off, p.h, `height ${p.h} cm`)];
      }
      case 'trap': {
        const A = Math.min(p.a, p.b), B = Math.max(p.a, p.b), d = (B - A)/2;
        return [{a:[0,0], b:[B,0], t:`bottom ${B} cm`, base:true}, ...heightOutside(B, d, d, p.h, `height ${p.h} cm`)];
      }
      case 'circle': return [{a:[p.r,p.r], b:[2*p.r,p.r], t:`radius ${p.r} cm`}];
      case 'sector': {
        const c = sectorGeom(p).sector;
        // The grab is the free end of the second radius: pulling it out changes the radius,
        // swinging it round changes the angle, which is how a sector is drawn by hand.
        return [{a:[c.cx,c.cy], b:[c.cx + c.r*Math.cos(c.a1), c.cy + c.r*Math.sin(c.a1)],
                 t:`radius ${Math.round(c.r*10)/10} cm · angle ${Math.round(c.deg)}°`, sector:true}];
      }
      case 'L': return [{a:[0,0], b:[p.W,0], t:`width ${p.W} cm`, base:true}, ...heightOutside(p.W, 0, 0, p.H, `height ${p.H} cm`)];
      default: return [];
    }
  }

  // The corner that stays put while a side is dragged: the far corner for a side that moves
  // left or down, otherwise the origin. Keeping it still means the shape does not move.
  function anchorFor(def){
    const g = geom();
    if (def.mult < 0 && def.axis === 'x') return [g.W, 0];
    if (def.mult < 0 && def.axis === 'y') return [0, g.H];
    return [0, 0];
  }

  let lastG = null, lastPerim = 0, lastFull = 0, lastPart = 0;

  // Cm to screen, using the last drawn mapping and the current zoom and pan.
  function toScreen(x, y){
    return {x: (tr.ox + x*tr.sc0 - tr.cxS) * view.z + tr.cxS + view.px,
            y: (tr.oy - y*tr.sc0 - tr.cyS) * view.z + tr.cyS + view.py};
  }

  function draw(){
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    labels.innerHTML = '';
    const g = geom();
    // Fixed scale: one cm is the same size however the shape is changed. Zoom scales it on top.
    const sc0 = Math.min(w, h) / 16;
    const cxS = w/2, cyS = h/2;
    // The origin is fixed on screen, so the shape stays where it is while its sides are dragged.
    const ox = cxS - 3*sc0, oy = cyS + 3*sc0;
    // Base position, then zoom about the centre and apply pan.
    const X = x => (ox + x*sc0 - cxS) * view.z + cxS + view.px;
    const Y = y => (oy - y*sc0 - cyS) * view.z + cyS + view.py;
    const sc = sc0 * view.z;
    tr = {ox, oy, sc0, cxS, cyS};
    showIndicator();

    if (build.on){
      // The grid follows the Snap setting: whole centimetres always, with fainter lines for halves
      // and fainter still for tenths, so a pin can only land where a line crossing is shown.
      const near = (v, step) => Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const gridLines = (step, colour, coarser) => {
        ctx.strokeStyle = colour; ctx.lineWidth = 1;
        const n = Math.round(12 / step);
        for (let k = 0; k <= n; k++){
          const v = k * step;
          if (coarser && near(v, coarser)) continue;   // already drawn by a bolder pass
          ctx.beginPath(); ctx.moveTo(X(v), Y(0)); ctx.lineTo(X(v), Y(12)); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(X(0), Y(v)); ctx.lineTo(X(12), Y(v)); ctx.stroke();
        }
      };
      if (snapStep > 0 && snapStep <= 0.1) gridLines(0.1, 'rgba(148,163,184,0.17)', 0.5);
      if (snapStep > 0 && snapStep <= 0.5) gridLines(0.5, 'rgba(148,163,184,0.38)', 1);
      gridLines(1, 'rgba(148,163,184,0.7)', 0);
      // Dots at whole centimetres, and smaller ones at the halves when halves are snapped to.
      // Tenths get lines only: a dot at every tenth would cover the grid.
      const gridDots = (step, r, colour, coarser) => {
        ctx.fillStyle = colour;
        const n = Math.round(12 / step);
        for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++){
          const x = i * step, y = j * step;
          if (coarser && near(x, coarser) && near(y, coarser)) continue;
          ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, Math.PI*2); ctx.fill();
        }
      };
      if (snapStep > 0 && snapStep <= 0.5) gridDots(0.5, 1.7, 'rgba(100,116,139,0.5)', 1);
      gridDots(1, 2.5, '#64748b', 0);
      if (pend){
        drawPend(X, Y, sc);
        clearStartRing();
        lastG = g; lastPerim = 0; lastFull = 0; lastPart = 0;
        renderInfo();
        return;
      }
      const P = build.pts;
      if (P.length){
        // Each new pin is joined to the one before, so the sides appear as they are drawn.
        if (P.length > 1){
          ctx.beginPath();
          P.forEach((q, i) => i ? ctx.lineTo(X(q[0]), Y(q[1])) : ctx.moveTo(X(q[0]), Y(q[1])));
          ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 3;
          ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.stroke();
        }
        // A soft halo, then a solid pin with a white rim, so the pins stand out on the grid.
        // The starting pin is green and a little bigger: clicking it closes the shape.
        P.forEach((q, i) => {
          const first = i === 0;
          const R = first ? 13 : 10;
          ctx.beginPath(); ctx.arc(X(q[0]), Y(q[1]), R + 5, 0, Math.PI*2);
          ctx.fillStyle = first ? 'rgba(5,150,105,0.22)' : 'rgba(37,99,235,0.18)'; ctx.fill();
          ctx.beginPath(); ctx.arc(X(q[0]), Y(q[1]), R, 0, Math.PI*2);
          ctx.fillStyle = first ? '#059669' : '#1d4ed8'; ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
        });
        // The next side follows the pointer, so it is clear where the line will go.
        // Over the starting pin it snaps there and goes solid: a click now closes the shape.
        if (aim){
          const L = P[P.length - 1];
          const closing = P.length >= 3 && Math.hypot(aim.x - X(P[0][0]), aim.y - Y(P[0][1])) <= 18;
          const tx = closing ? X(P[0][0]) : aim.x, ty = closing ? Y(P[0][1]) : aim.y;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(X(L[0]), Y(L[1]));
          ctx.lineTo(tx, ty);
          ctx.strokeStyle = closing ? '#059669' : 'rgba(29,78,216,0.55)';
          ctx.lineWidth = 3; ctx.lineCap = 'round';
          if (!closing) ctx.setLineDash([7, 6]);
          ctx.stroke();
          ctx.restore();
        }
      }
      if (P.length >= 3) placeStartRing(X(P[0][0]), Y(P[0][1])); else clearStartRing();
      lastG = g; lastPerim = 0; lastFull = 0; lastPart = 0;
      renderInfo();
      return;
    }

    clearStartRing();
    if (parts){ drawParts(X, Y, sc); return; }
    // Trace the outline of the shape as the current path.
    const tracePath = () => {
      ctx.beginPath();
      if (g.circle){
        ctx.arc(X(g.cx), Y(g.cy), g.r*sc, 0, Math.PI*2);
      } else if (g.sector){
        // Screen y runs the other way to grid y, so the sweep is mirrored.
        ctx.moveTo(X(g.sector.cx), Y(g.sector.cy));
        ctx.arc(X(g.sector.cx), Y(g.sector.cy), g.sector.r*sc, 0, -g.sector.a1, true);
        ctx.closePath();
      } else {
        g.pts.forEach((q, i) => i ? ctx.lineTo(X(q[0]), Y(q[1])) : ctx.moveTo(X(q[0]), Y(q[1])));
        ctx.closePath();
      }
    };

    let full = 0, part = 0;
    if (S.grid){
      const nx = Math.ceil(g.W), ny = Math.ceil(g.H);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
        if (inside(g, i+0.5, j+0.5)){ full++; continue; }
        let touch = false;
        for (const dx of [0.2,0.5,0.8]) for (const dy of [0.2,0.5,0.8]) if (!touch && inside(g, i+dx, j+dy)) touch = true;
        if (touch) part++;
      }
      // The whole base-by-height rectangle is faded first. The shape is then filled over it,
      // clipped to its outline, so squares inside show solid and squares outside stay faded.
      ctx.fillStyle = 'rgba(59,130,246,0.15)';
      ctx.fillRect(X(0), Y(ny), nx*sc, ny*sc);
      ctx.save();
      tracePath();
      ctx.clip();
      ctx.fillStyle = 'rgba(59,130,246,0.55)';
      ctx.fillRect(X(0), Y(ny), nx*sc, ny*sc);
      ctx.restore();
      ctx.strokeStyle = 'rgba(30,41,59,0.6)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= nx; i++){ ctx.beginPath(); ctx.moveTo(X(i), Y(0)); ctx.lineTo(X(i), Y(ny)); ctx.stroke(); }
      for (let j = 0; j <= ny; j++){ ctx.beginPath(); ctx.moveTo(X(0), Y(j)); ctx.lineTo(X(nx), Y(j)); ctx.stroke(); }
    } else {
      tracePath();
      ctx.fillStyle = 'rgba(59,130,246,0.2)';
      ctx.fill();
    }

    // Drawn like the edges of a solid in the 3D view: heavy, dark and rounded at the corners,
    // so the outline reads as the edge of the shape and not as one of the square lines inside it.
    tracePath();
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();

    const L = v => fmt(v * LEN[S.unit]) + ' ' + S.unit;
    const perim = perimeterOf(g);

    // Angles at each corner: inside, outside, or both. An outside angle is measured from the side
    // carried on past the corner, so that extension is drawn as a dashed line.
    if (S.angMode && !g.circle && !g.sector && g.pts.length > 2){
      const showIn = S.angMode === 1 || S.angMode === 3;
      const showOut = S.angMode === 2 || S.angMode === 3;
      const P = g.pts, n = P.length;
      let s2 = 0;
      for (let i = 0; i < n; i++){
        const a = P[i], b = P[(i+1) % n];
        s2 += a[0]*b[1] - b[0]*a[1];
      }
      const wind = s2 >= 0 ? 1 : -1;
      angHit = [];
      const norm = t => { let r = t % (Math.PI*2); return r < 0 ? r + Math.PI*2 : r; };
      // Screen y runs the other way to grid y, so directions are flipped before being drawn.
      const ang = v => Math.atan2(-v[1], v[0]);
      const arcTo = (sx, sy, R, d1, d2, dm, colour, dash) => {
        const a1 = ang(d1), a2 = ang(d2), am = ang(dm);
        const sweep = norm(a2 - a1), inside = norm(am - a1) <= sweep;
        ctx.save();
        ctx.strokeStyle = colour; ctx.lineWidth = 2.5; ctx.lineCap = 'butt';
        if (dash) ctx.setLineDash(dash);
        ctx.beginPath(); ctx.arc(sx, sy, R, a1, a2, !inside); ctx.stroke();
        ctx.restore();
      };
      const put = (sx, sy, dir, dist, text, cls, k) => {
        const deg0 = String(Math.round(text));
        const el = document.createElement('div');
        el.className = 'lab ' + cls + (angLocked.has(k) ? ' held' : '');
        el.textContent = Math.round(text) + '\u00b0';
        el.style.left = (sx + dir[0] * dist) + 'px';
        el.style.top = (sy - dir[1] * dist) + 'px';
        el.title = 'Press to type an angle. Press inside the arc to hold it.';
        // One press on the number types a value. Holding an angle is done by pressing inside the
        // arc itself, which the number sits clear of.
        el.onclick = ev => {
          ev.stopPropagation();
          openPad(parseFloat(el.style.left), parseFloat(el.style.top),
            cls === 'angx' ? 'Outside angle' : 'Angle at this corner', deg0, '\u00b0',
            v => setAngle(k, cls === 'angx' ? 180 - v : v));
        };
        labels.appendChild(el);
      };
      // A curve is stored as a great many tiny straight steps, so every point along it
      // would otherwise get its own "177 degrees" label and bury the shape. Only the
      // real corners are worth labelling - where the outline actually turns.
      const CORNER = 5;                        // degrees of turn before it counts as a corner
      // Where a straight edge runs into a curve, the first tiny step of the curve is a chord,
      // not the tangent, and measuring to it reads a couple of degrees short - a quarter circle
      // showing 88 where it should say 90. Leaning the chord back by half the curve's own turn
      // gives the tangent, and the right answer.
      const tangent = (k, step) => {
        const B = P[k], C = P[(k + step + n) % n], D = P[(k + 2*step + n*2) % n];
        let vx = C[0]-B[0], vy = C[1]-B[1];
        const l = Math.hypot(vx, vy); if (!l) return [0, 0, 0];
        vx /= l; vy /= l;
        let wx = D[0]-C[0], wy = D[1]-C[1];
        const m = Math.hypot(wx, wy);
        if (m){
          wx /= m; wy /= m;
          const turn = Math.atan2(vx*wy - vy*wx, vx*wx + vy*wy);
          if (Math.abs(turn) < CORNER * Math.PI / 180){
            const h = -turn / 2, co = Math.cos(h), si = Math.sin(h);
            const nx = vx*co - vy*si, ny = vx*si + vy*co;
            return [nx * l, ny * l, l];
          }
        }
        return [vx * l, vy * l, l];
      };
      for (let k = 0; k < n; k++){
        const B = P[k], A = P[(k - 1 + n) % n], C = P[(k + 1) % n];
        const [ux, uy, lu] = tangent(k, -1), [vx, vy, lv] = tangent(k, 1);
        if (!lu || !lv) continue;
        {
          const dot = Math.max(-1, Math.min(1, (ux*vx + uy*vy) / (lu*lv)));
          if (Math.abs(180 - Math.acos(dot) * 180 / Math.PI) < CORNER) continue;
        }
        const uh = [ux/lu, uy/lu], vh = [vx/lv, vy/lv];
        let deg = Math.acos(Math.max(-1, Math.min(1, uh[0]*vh[0] + uh[1]*vh[1]))) * 180 / Math.PI;
        // A corner that turns back on itself is more than a half turn, and acos cannot tell.
        const turn = ((B[0]-A[0])*(C[1]-B[1]) - (B[1]-A[1])*(C[0]-B[0])) * wind;
        const reflex = turn < 0;
        if (reflex) deg = 360 - deg;
        let bx = uh[0] + vh[0], by = uh[1] + vh[1];
        let bl = Math.hypot(bx, by);
        if (bl < 1e-6){ bx = -uh[1]; by = uh[0]; bl = 1; }   // a straight corner: use a right angle
        bx /= bl; by /= bl;
        if (reflex){ bx = -bx; by = -by; }
        const sx = X(B[0]), sy = Y(B[1]);
        const held = angLocked.has(k);
        const square = Math.abs(deg - 90) < 0.5;
        const US = uiScale();
        angHit.push({k, x: sx, y: sy, r: 38 * US, bx, by, half: Math.min(deg, 360 - deg) * Math.PI / 360});
        if (showIn){
          const col = held ? '#dc2626' : '#0f766e';
          if (square){
            // A right angle gets the little square rather than an arc.
            const S0 = 20 * US;
            const p1 = [sx + uh[0]*S0, sy - uh[1]*S0];
            const p2 = [sx + (uh[0]+vh[0])*S0, sy - (uh[1]+vh[1])*S0];
            const p3 = [sx + vh[0]*S0, sy - vh[1]*S0];
            ctx.save();
            ctx.strokeStyle = col; ctx.lineWidth = held ? 4 : 2.5; ctx.lineJoin = 'miter';
            ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.stroke();
            ctx.restore();
          } else {
            arcTo(sx, sy, 26 * US, uh, vh, [bx, by], col);
            if (held) arcTo(sx, sy, 22 * US, uh, vh, [bx, by], col);   // doubled up, so a held angle stands out
          }
          put(sx, sy, [bx, by], 48 * US, deg, 'ang', k);
        }
        if (showOut){
          // The side coming in, carried on past the corner.
          const eh = [-uh[0], -uh[1]];
          let ox = eh[0] + vh[0], oy = eh[1] + vh[1];
          const ol = Math.hypot(ox, oy);
          if (ol > 1e-6){ ox /= ol; oy /= ol; } else { ox = -bx; oy = -by; }
          ctx.save();
          ctx.strokeStyle = 'rgba(124,58,237,0.55)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + eh[0]*60, sy - eh[1]*60); ctx.stroke();
          ctx.restore();
          arcTo(sx, sy, (showIn ? 40 : 30) * US, eh, vh, [ox, oy], held ? '#dc2626' : '#7c3aed');
          put(sx, sy, [ox, oy], (showIn ? 62 : 52) * US, 180 - deg, 'angx', k);
        }
      }
    }
    drawCutLine(X, Y);
    drawSectorHandle(X, Y);

    if (S.areaLab){
      // In the middle of the shape. For a dented shape the centre of area can fall outside it, so
      // the widest run of inside across that height is used instead.
      let cx3 = g.circle ? g.cx : g.sector ? g.sector.cx : 0, cy3 = g.circle ? g.cy : g.sector ? g.sector.cy : 0;
      if (!g.circle && !g.sector && g.pts.length > 2){
        const c0 = partCentre(g.pts);
        cx3 = c0[0]; cy3 = c0[1];
        if (!inside(g, cx3, cy3)){
          let bestLen = 0, bestX = cx3;
          let runStart = null;
          const x0 = Math.min(...g.pts.map(q=>q[0])), x1 = Math.max(...g.pts.map(q=>q[0]));
          const stepX = (x1 - x0) / 200;
          for (let x = x0; x <= x1; x += stepX){
            if (inside(g, x, cy3)){ if (runStart === null) runStart = x; }
            else if (runStart !== null){
              if (x - runStart > bestLen){ bestLen = x - runStart; bestX = (runStart + x) / 2; }
              runStart = null;
            }
          }
          if (runStart !== null && x1 - runStart > bestLen) bestX = (runStart + x1) / 2;
          cx3 = bestX;
        }
      }
      const el = document.createElement('div');
      el.className = 'lab areaLab';
      el.textContent = fmt1(g.area * AREA[S.unit]) + ' ' + SQ[S.unit];
      el.style.left = X(cx3) + 'px';
      el.style.top = Y(cy3) + 'px';
      labels.appendChild(el);
    }

    if (S.angMode && g.sector){
      const se = g.sector, cx2 = X(se.cx), cy2 = Y(se.cy), R2 = 34 * uiScale();
      ctx.save();
      ctx.strokeStyle = '#0f766e'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx2, cy2, R2, 0, -se.a1, true); ctx.stroke();
      ctx.restore();
      const mid = se.a1 / 2;
      const el = document.createElement('div');
      el.className = 'lab ang';
      el.textContent = Math.round(se.deg) + '\u00b0';
      el.style.left = (cx2 + Math.cos(mid) * (R2 + 24 * uiScale())) + 'px';
      el.style.top = (cy2 - Math.sin(mid) * (R2 + 24 * uiScale())) + 'px';
      el.title = 'Press to type the angle';
      el.onclick = ev => {
        ev.stopPropagation();
        openPad(parseFloat(el.style.left), parseFloat(el.style.top), 'Angle of the sector',
          String(Math.round(se.deg)), '\u00b0', v => {
            S.dims.sector.a = Math.min(355, Math.max(5, v));
            resetZoom(false); sync(); draw();
          });
      };
      labels.appendChild(el);
    }

    if (S.perim){
      // The gap is in screen pixels, not centimetres, so a label clears the outline by the same
      // amount however far the view is zoomed in.
      const addLab = (x, y, ox, oy, text, side, len) => {
        const el = document.createElement('div');
        el.className = 'lab';
        el.textContent = text;
        el.style.left = (X(x) + ox) + 'px';
        el.style.top = (Y(y) + oy) + 'px';
        if (side !== undefined){
          el.style.pointerEvents = 'auto';
          el.style.cursor = 'pointer';
          el.title = 'Press to type a length';
          el.onclick = ev => {
            ev.stopPropagation();
            openPad(parseFloat(el.style.left), parseFloat(el.style.top), 'Length of this side',
              String(Math.round(len * 10) / 10), S.unit, v => setSideLength(side, v));
          };
        }
        labels.appendChild(el);
      };
      const GAP = 30 * uiScale();
      if (g.circle){
        addLab(g.cx + g.r*Math.cos(Math.PI/4), g.cy + g.r*Math.sin(Math.PI/4), GAP*0.7, -GAP*0.7, 'r = ' + L(g.r));
      } else if (g.sector){
        const se = g.sector, mid = se.a1 / 2;
        addLab(se.cx + se.r / 2, se.cy, 0, GAP * 0.7, 'r = ' + L(se.r));
        addLab(se.cx + Math.cos(mid) * se.r, se.cy + Math.sin(mid) * se.r,
          Math.cos(mid) * GAP, -Math.sin(mid) * GAP, 'arc ' + L(g.arcLen));
      } else {
        // Which way round the outline goes tells each side which way is out of the shape. Measuring
        // from the middle of the shape would be wrong on a dented outline, where the middle can sit
        // outside it, and would bunch the labels up rather than centring them on their own side.
        const n = g.pts.length;
        let s2 = 0;
        for (let i = 0; i < n; i++){
          const a = g.pts[i], b = g.pts[(i+1) % n];
          s2 += a[0]*b[1] - b[0]*a[1];
        }
        const wind = s2 >= 0 ? 1 : -1;
        g.pts.forEach((a, i) => {
          const b = g.pts[(i+1) % n];
          const ex = b[0]-a[0], ey = b[1]-a[1], len = Math.hypot(ex, ey) || 1;
          // Out of the shape, at right angles to this side. Screen y runs the other way to grid y.
          const nx = (ey / len) * wind, ny = (-ex / len) * wind;
          addLab((a[0]+b[0])/2, (a[1]+b[1])/2, nx*GAP, -ny*GAP, L(len), i, len);
        });
      }
    }

    if (S.shape === 'free' && selSide >= 0 && S.free){
      const P = S.free.pts, a = P[selSide], b = P[(selSide + 1) % P.length];
      ctx.beginPath(); ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1]));
      ctx.strokeStyle = '#f97316'; ctx.lineWidth = 6; ctx.stroke();
    }
    renderCorners();
    if (S.dimsShow){
      const addDim = (x, y, text) => {
        const el = document.createElement('div');
        el.className = 'dim';
        el.textContent = text;
        el.style.left = X(x) + 'px';
        el.style.top = Y(y) + 'px';
        labels.appendChild(el);
      };
      (S.shape === 'free' ? dimsFree(S.free.pts) : dimsFor(S.shape, S.dims[S.shape])).forEach(d => {
        ctx.beginPath();
        ctx.moveTo(X(d.a[0]), Y(d.a[1]));
        ctx.lineTo(X(d.b[0]), Y(d.b[1]));
        ctx.strokeStyle = '#1d4ed8';
        ctx.lineWidth = d.ext ? 1 : 2;
        ctx.setLineDash(d.ext ? [4, 3] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        const mx = (d.a[0] + d.b[0]) / 2, my = (d.a[1] + d.b[1]) / 2;
        if (d.lx !== undefined){ addDim(d.lx, d.ly, d.t); return; }
        if (d.base) addDim(mx, my - 0.9, d.t);
        else if (d.vert) addDim(d.a[0] + 0.3, my, d.t);
        else if (!d.ext) addDim(mx, my + 0.6, d.t);
      });
    }

    lastG = g; lastPerim = perim; lastFull = full; lastPart = part;
    renderInfo();
  }

  function renderInfo(){
    if (build.on){
      info.innerHTML = `<div><b>Draw your own shape</b></div>
        <div style="margin-top:6px">Pins so far: <b>${build.pts.length}</b></div>
        <div class="note">Tap the grid to add points. Each joins to the last, and the shape is closed by clicking the green starting point.</div>`;
      return;
    }
    if (!lastG) return;
    const g = lastG, sqU = AREA[S.unit], lu = S.unit;
    $('sumPerim').textContent = fmt1(lastPerim * LEN[lu]) + ' ' + lu;
    $('sumArea').textContent = fmt1(g.area * sqU) + ' ' + SQ[lu];
    let h = `<div><b>${g.name}</b></div>`;
    if (S.showArea){
      h += `<div style="margin-top:6px">${g.areaF}</div>`;
      h += `<div>Area: <b>${fmt1(g.area * sqU)} ${SQ[S.unit]}</b></div>`;
      if (S.grid){
        h += `<div>Whole 1 cm squares inside: <b>${lastFull}</b>, partly covered: ${lastPart}</div>`;
      }
    }
    if (S.showPerim){
      h += `<div style="margin-top:6px">${g.perimF}</div>`;
      h += `<div>Perimeter: <b>${fmt1(lastPerim * LEN[lu])} ${lu}</b></div>`;
    }
    if (!S.showArea && !S.showPerim) h += `<div class="note">Tick Area or Perimeter above.</div>`;
    if (S.unit !== 'cm') h += `<div class="note">${lu === 'mm' ? '1 cm² = 10 × 10 = 100 mm²' : '1 cm² = 0.01 m × 0.01 m = 0.0001 m²'}</div>`;
    info.innerHTML = h;
  }
  // Shows only the menu for the current stage: the pins and shape options while drawing, then the measures and Show options once the shape is made.
  function sync(){
    const st = build.on ? 'draw' : S.stage;
    $('drawBox').hidden = st !== 'draw';
    $('shapeBox').hidden = st === 'draw';
    $('g-show').hidden = st !== 'shape';
    if (window.App && window.App.syncShapeBar) window.App.syncShapeBar();
    // Area and perimeter belong to a finished shape, so the window is put away while pins go down.
    if (st === 'draw'){ $('sumPerim').textContent = '-'; $('sumArea').textContent = '-'; }
    $('meas2').hidden = st !== 'shape';
    $('drawMsg').hidden = st !== 'draw';
    const enough = build.pts.length >= 3 || !!pend;
    // One instruction at a time, following what has been drawn so far.
    $('drawMsg').textContent = pend
      ? 'Drag the orange handle to size it, then press 2D or 3D'
      : [
      'Add a point by clicking',
      'Add another point to create a side',
      'Add one more point to create another side'
    ][build.pts.length] || 'Continue to draw sides, or click the starting point to complete the shape';
    $('shape2d').disabled = !enough;
    $('opt3d').disabled = !enough;
    // Each label says what the next press will do.
    $('dimBtn').textContent = ['Dimensions', 'Dimensions: Base & height', 'Dimensions: All sides'][S.dimMode];
    $('dimBtn').classList.toggle('on', S.dimMode > 0);
    $('areaBtn').textContent = S.grid && S.areaLab ? 'Area: Grid + label'
      : S.grid ? 'Area: Grid' : S.areaLab ? 'Area: Label' : 'Area';
    $('angBtn').textContent = ['Angles', 'Angles: Internal', 'Angles: External', 'Angles: All'][S.angMode];
    $('angBtn').classList.toggle('on', S.angMode > 0);
    $('areaBtn').classList.toggle('on', S.grid || S.areaLab);
    const sp = $('splitBtn');
    if (sp){
      sp.textContent = 'Cut mode';
      sp.classList.toggle('on', splitting);
      sp.classList.toggle('go', splitting);
      sp.disabled = S.stage !== 'shape';
    }
    const ub = $('undoBtn');
    if (ub) ub.disabled = !undoStack.length;
    const jb = $('joinBtn');
    if (jb) jb.hidden = !parts;
    // Angles belong to a whole shape; once it is in pieces they are left out.
    const ab = $('angBtn');
    if (ab) ab.disabled = !!parts;
    if (parts && S.angMode) S.angMode = 0;
    $('calc2Btn').textContent = info.hidden ? 'Show calculations' : 'Hide calculations';
    document.querySelectorAll('#snap button').forEach(b => b.classList.toggle('on', Number(b.dataset.snap) === snapStep));
  }


  // ---- Ready-made shapes ---------------------------------------------------------------------
  // A shape picked from the Regular polygons menu is laid on the paper with a single handle at
  // the right-hand end of its base. Dragging that handle sizes it. Nothing is committed until
  // the 2D or 3D button is pressed, so it can be sized, re-picked or abandoned freely.
  let pend = null;        // {kind:'poly'|'circle'|'sector', n, side, r, ang}
  let pendDrag = null;
  const POLY_NAMES = {3:'Triangle', 4:'Square', 5:'Pentagon', 6:'Hexagon', 7:'Heptagon',
                      8:'Octagon', 9:'Nonagon', 10:'Decagon'};
  const polyName = n => POLY_NAMES[n] || (n + '-sided');

  function shiftToOrigin(P){
    const mx = Math.min(...P.map(q => q[0])), my = Math.min(...P.map(q => q[1]));
    return P.map(q => [round6(q[0] - mx), round6(q[1] - my)]);
  }
  // The corners of the pending shape, sitting against the corner of the grid.
  function pendPts(){
    if (!pend) return [];
    if (pend.kind === 'circle'){
      const r = pend.r;
      return Array.from({length:72}, (_, i) => {
        const a = i / 72 * Math.PI * 2;
        return [round6(r + r*Math.cos(a)), round6(r + r*Math.sin(a))];
      });
    }
    if (pend.kind === 'sector'){
      const r = pend.r, rad = pend.ang * Math.PI / 180, steps = Math.max(12, Math.round(pend.ang / 3));
      const raw = [[0, 0]];
      for (let i = 0; i <= steps; i++){ const t = rad * i / steps; raw.push([r*Math.cos(t), r*Math.sin(t)]); }
      return shiftToOrigin(raw);
    }
    // A regular polygon, turned so that one side lies flat along the bottom.
    const n = pend.n, R = pend.side / (2 * Math.sin(Math.PI / n)), a0 = -Math.PI/2 + Math.PI/n;
    return shiftToOrigin(Array.from({length:n}, (_, i) => {
      const a = a0 + i * 2 * Math.PI / n;
      return [R * Math.cos(a), R * Math.sin(a)];
    }));
  }
  // The handle, and the point it is measured from.
  function pendHandle(){
    const P = pendPts();
    if (!P.length) return [0, 0];
    if (pend.kind === 'circle') return [2 * pend.r, pend.r];
    if (pend.kind === 'sector') return P[1];
    let best = null;
    P.forEach(q => { if (q[1] < 1e-6 && (!best || q[0] > best[0])) best = q; });
    return best || P[0];
  }
  function pendAnchor(){
    const P = pendPts();
    if (!P.length) return [0, 0];
    if (pend.kind === 'circle') return [0, pend.r];
    if (pend.kind === 'sector') return P[0];
    let best = null;
    P.forEach(q => { if (q[1] < 1e-6 && (!best || q[0] < best[0])) best = q; });
    return best || P[0];
  }
  function pendLabel(){
    if (!pend) return '';
    if (pend.kind === 'poly'){
      if (pend.n > 12){
        const w = Math.max(...pendPts().map(q => q[0]));
        return pend.n + ' sides · ' + fmt(w) + ' ' + S.unit + ' across';
      }
      return polyName(pend.n) + ' · side ' + fmt(pend.side) + ' ' + S.unit;
    }
    if (pend.kind === 'circle') return 'Circle · r = ' + fmt(pend.r) + ' ' + S.unit;
    return 'Sector · r = ' + fmt(pend.r) + ' ' + S.unit + ', ' + Math.round(pend.ang) + '°';
  }
  function resizePend(p){
    if (!pend || !pendDrag) return;
    const q = toGrid(p), dx = q.x - pendDrag.anchor[0];
    if (!(dx > 0)) return;
    const snap = v => snapStep > 0 ? snapTo(v) : Number(v.toFixed(2));
    if (pend.kind === 'poly'){
      const raw = Math.min(24, Math.max(0.05, dx));
      if (pend.n <= 12){
        pend.side = Math.min(20, Math.max(0.3, snap(raw)));
      } else {
        // Past a dozen sides the side length is a few millimetres and no use to anyone, so the
        // handle sizes the shape by the width across it instead.
        const w0 = Math.max(...pendPts().map(q => q[0])), s0 = pend.side;
        if (w0 > 1e-6){
          const want = Math.min(16, Math.max(1, snap(w0 * raw / s0)));
          pend.side = Math.max(0.02, s0 * want / w0);
        }
      }
    }
    else if (pend.kind === 'circle') pend.r = Math.min(10, Math.max(0.3, snap(dx / 2)));
    else pend.r = Math.min(12, Math.max(0.3, snap(dx)));
    draw();
  }
  function drawPend(X, Y, sc){
    const P = pendPts();
    if (!P.length) return;
    ctx.save();
    ctx.beginPath();
    if (pend.kind === 'circle'){
      ctx.arc(X(pend.r), Y(pend.r), pend.r * sc, 0, Math.PI * 2);
    } else if (pend.kind === 'sector'){
      const c = P[0];
      ctx.moveTo(X(c[0]), Y(c[1]));
      ctx.arc(X(c[0]), Y(c[1]), pend.r * sc, 0, -pend.ang * Math.PI / 180, true);
      ctx.closePath();
    } else {
      P.forEach((q, i) => i ? ctx.lineTo(X(q[0]), Y(q[1])) : ctx.moveTo(X(q[0]), Y(q[1])));
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(37,99,235,0.18)'; ctx.fill();
    ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
    const h = pendHandle(), hx = X(h[0]), hy = Y(h[1]);
    ctx.beginPath(); ctx.arc(hx, hy, 17, 0, Math.PI*2); ctx.fillStyle = 'rgba(249,115,22,0.25)'; ctx.fill();
    ctx.beginPath(); ctx.arc(hx, hy, 11, 0, Math.PI*2); ctx.fillStyle = '#f97316'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
    const el = document.createElement('div');
    el.className = 'lab';
    el.textContent = pendLabel();
    // Above and right of the handle, so it stays clear of the zoom and snap controls that sit
    // along the bottom of the paper.
    el.style.left = (hx + 20) + 'px';
    el.style.top = (hy - 30) + 'px';
    labels.appendChild(el);
  }
  // Turning the pending shape into a real one.
  function commitPend(to3d){
    if (!pend) return false;
    locked.clear(); angLocked.clear();
    if (pend.kind === 'poly'){
      build.pts = pendPts();
      pend = null;
      if (!makeShape()){ sync(); return false; }
      resetZoom(false);
    } else {
      const kind = pend.kind, r = pend.r, a = pend.ang;
      pend = null;
      build.pts = [];
      setShape(kind === 'circle' ? 'circle' : 'sector', kind === 'circle' ? {r} : {r, a});
    }
    sync(); draw(); renderCorners();
    if (to3d && window.App && window.App.make3D) window.App.make3D(geom().pts);
    return true;
  }
  function startPend(kind, n){
    build.pts = [];
    aim = null;
    pend = kind === 'poly' ? {kind, n, side: Number((2 * 3 * Math.sin(Math.PI / n)).toFixed(2))}
         : kind === 'circle' ? {kind, r: 3}
         : {kind, r: 4, ang: 90};
    closePolyMenu();
    sync(); draw();
  }

  // ---- The Regular polygons menu ----------------------------------------------------------
  let polyMenu = null;
  function closePolyMenu(){ if (polyMenu){ polyMenu.remove(); polyMenu = null; } }
  function shapeIcon(kind, n){
    const mid = 14, R = 11;
    if (kind === 'circle') return '<svg class="bico" viewBox="0 0 28 28"><circle cx="14" cy="14" r="11" fill="#bfdbfe" stroke="#2563eb" stroke-width="2"/></svg>';
    if (kind === 'sector'){
      return '<svg class="bico" viewBox="0 0 28 28"><path d="M6 22 L6 7 A15 15 0 0 1 21 22 Z" fill="#bfdbfe" stroke="#2563eb" stroke-width="2" stroke-linejoin="round"/></svg>';
    }
    const a0 = -Math.PI/2 + Math.PI/n;
    const pts = Array.from({length:n}, (_, i) => {
      const a = a0 + i * 2 * Math.PI / n;
      return (mid + R*Math.cos(a)).toFixed(1) + ',' + (mid - R*Math.sin(a)).toFixed(1);
    }).join(' ');
    return '<svg class="bico" viewBox="0 0 28 28"><polygon points="' + pts +
      '" fill="#bfdbfe" stroke="#2563eb" stroke-width="2" stroke-linejoin="round"/></svg>';
  }
  function openPolyMenu(){
    if (polyMenu){ closePolyMenu(); return; }
    const btn = $('polyBtn'), r = btn.getBoundingClientRect();
    polyMenu = document.createElement('div');
    polyMenu.id = 'polyMenu';
    polyMenu.innerHTML = '<div class="pmTitle">Regular polygons</div><div class="pmGrid"></div>' +
      '<div class="pmRow"><label for="polyN">Any number of sides</label>' +
      '<input id="polyN" type="number" min="3" max="50" step="1" value="12" inputmode="numeric">' +
      '<button id="polyNAdd" class="pmAdd">Add</button></div>';
    const grid = polyMenu.querySelector('.pmGrid');
    const item = (label, kind, n) => {
      const b = document.createElement('button');
      b.className = 'pmItem';
      b.innerHTML = shapeIcon(kind, n) + '<span>' + label + '</span>';
      b.onclick = ev => { ev.stopPropagation(); startPend(kind, n); };
      grid.appendChild(b);
    };
    item('Circle', 'circle', 0);
    item('Sector', 'sector', 0);
    for (let n = 3; n <= 10; n++) item(n === 3 ? 'Equilateral' : polyName(n), 'poly', n);
    document.body.appendChild(polyMenu);
    const add = () => {
      const v = Math.round(Number(polyMenu.querySelector('#polyN').value));
      if (!(v >= 3 && v <= 50)) return;
      startPend('poly', v);
    };
    polyMenu.querySelector('#polyNAdd').onclick = ev => { ev.stopPropagation(); add(); };
    polyMenu.querySelector('#polyN').onkeydown = ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter'){ ev.preventDefault(); add(); }
    };
    polyMenu.onpointerdown = ev => ev.stopPropagation();
    // Beside the button, kept on screen.
    const mw = polyMenu.offsetWidth, mh = polyMenu.offsetHeight;
    polyMenu.style.left = Math.min(r.right + 10, window.innerWidth - mw - 10) + 'px';
    polyMenu.style.top = Math.max(10, Math.min(r.top, window.innerHeight - mh - 10)) + 'px';
  }
  document.addEventListener('pointerdown', ev => {
    if (!polyMenu) return;
    const t = ev.target;
    if (polyMenu.contains(t) || (t.closest && t.closest('#polyBtn'))) return;
    closePolyMenu();
  }, true);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closePolyMenu(); });



  // ---- Drawing the pieces --------------------------------------------------------------------
  function drawParts(X, Y, sc){
    const US = uiScale();
    const L = v => fmt(v * LEN[S.unit]) + ' ' + S.unit;
    const sqU = AREA[S.unit];
    let totalArea = 0, totalPerim = 0, full = 0, part = 0;

    parts.forEach((pt, idx) => {
      const P = partPts(pt);
      const ringPath = () => {
        ctx.beginPath();
        P.forEach((q, i) => i ? ctx.lineTo(X(q[0]), Y(q[1])) : ctx.moveTo(X(q[0]), Y(q[1])));
        ctx.closePath();
      };
      const a = Math.abs(polyArea(pt.pts));
      totalArea += a;
      totalPerim += polyPerim(pt.pts);

      if (S.grid){
        // The squares belong to the piece, so they are drawn in the piece's own frame and turn
        // with it. That way a piece keeps the area it was cut with and can still be counted.
        const xs = pt.pts.map(q => q[0]), ys = pt.pts.map(q => q[1]);
        const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs));
        const y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
        for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++){
          if (inPoly(pt.pts, i+0.5, j+0.5)){ full++; continue; }
          let touch = false;
          for (const dx of [0.2,0.5,0.8]) for (const dy of [0.2,0.5,0.8])
            if (!touch && inPoly(pt.pts, i+dx, j+dy)) touch = true;
          if (touch) part++;
        }
        ctx.save();
        ringPath(); ctx.clip();
        ctx.fillStyle = 'rgba(59,130,246,0.55)';
        ringPath(); ctx.fill();
        ctx.strokeStyle = 'rgba(30,41,59,0.6)';
        ctx.lineWidth = 1;
        for (let i = x0; i <= x1; i++){
          const u = xf(pt, [i, y0]), v = xf(pt, [i, y1]);
          ctx.beginPath(); ctx.moveTo(X(u[0]), Y(u[1])); ctx.lineTo(X(v[0]), Y(v[1])); ctx.stroke();
        }
        for (let j = y0; j <= y1; j++){
          const u = xf(pt, [x0, j]), v = xf(pt, [x1, j]);
          ctx.beginPath(); ctx.moveTo(X(u[0]), Y(u[1])); ctx.lineTo(X(v[0]), Y(v[1])); ctx.stroke();
        }
        ctx.restore();
      } else {
        ringPath();
        ctx.fillStyle = 'rgba(59,130,246,0.2)';
        ctx.fill();
      }

      ringPath();
      ctx.save();
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = pt === selPart ? '#1d4ed8' : '#0f172a';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.restore();

      // Dimensions gives the base and the height of the piece, the same as it does for a whole
      // shape. Side lengths is the mode that labels every side.
      if (S.dimsShow){
        const addDim = (x, y, text) => {
          const el = document.createElement('div');
          el.className = 'dim';
          el.textContent = text;
          el.style.left = X(x) + 'px';
          el.style.top = Y(y) + 'px';
          labels.appendChild(el);
        };
        dimsFree(pt.pts).forEach(d => {
          const A0 = xf(pt, d.a), B0 = xf(pt, d.b);
          ctx.beginPath();
          ctx.moveTo(X(A0[0]), Y(A0[1]));
          ctx.lineTo(X(B0[0]), Y(B0[1]));
          ctx.strokeStyle = '#1d4ed8';
          ctx.lineWidth = d.ext ? 1 : 2;
          ctx.setLineDash(d.ext ? [4, 3] : []);
          ctx.stroke();
          ctx.setLineDash([]);
          if (d.ext) return;
          const mid = [(A0[0]+B0[0])/2, (A0[1]+B0[1])/2];
          // nudged away from the piece so the reading is not sitting on the line
          const c0 = partHome(pt);
          let nx = mid[0] - c0[0], ny = mid[1] - c0[1];
          const nl = Math.hypot(nx, ny) || 1;
          const off = 0.55;
          addDim(mid[0] + nx/nl*off, mid[1] + ny/nl*off, d.lx !== undefined ? d.t : d.t);
        });
      }
      if (S.perim){
        const GAP = 26 * US;
        for (let i = 0; i < pt.pts.length; i++){
          const a0 = pt.pts[i], b0 = pt.pts[(i+1)%pt.pts.length];
          const len = Math.hypot(b0[0]-a0[0], b0[1]-a0[1]);
          if (len < 0.25) continue;
          const A0 = xf(pt, a0), B0 = xf(pt, b0);
          const mx = (A0[0]+B0[0])/2, my = (A0[1]+B0[1])/2;
          const ux = (B0[0]-A0[0])/len, uy = (B0[1]-A0[1])/len;
          const c = partHome(pt);
          let nx = uy, ny = -ux;
          if ((mx + nx*0.01 - c[0])**2 + (my + ny*0.01 - c[1])**2 < (mx - c[0])**2 + (my - c[1])**2){ nx = -nx; ny = -ny; }
          const el = document.createElement('div');
          el.className = 'lab';
          el.textContent = L(len);
          el.style.left = (X(mx) + nx*GAP) + 'px';
          el.style.top = (Y(my) - ny*GAP) + 'px';
          labels.appendChild(el);
        }
      }

      if (S.areaLab){
        const c = partHome(pt);
        const el = document.createElement('div');
        el.className = 'lab areaLab';
        el.textContent = fmt1(a * sqU) + ' ' + SQ[S.unit];
        el.style.left = X(c[0]) + 'px';
        el.style.top = Y(c[1]) + 'px';
        labels.appendChild(el);
      }

      // Only the piece that has been tapped carries its controls, so the paper stays clear.
      if (pt !== selPart) return;
      const hp = partHandleScreen(pt, sc), c = partHome(pt);
      const hx = hp.x, hy = hp.y;
      ctx.save();
      ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(X(c[0]), Y(c[1])); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.restore();
      ctx.beginPath(); ctx.arc(hx, hy, 15 * US, 0, Math.PI*2);
      ctx.fillStyle = partDrag && partDrag.pt === pt && partDrag.turn ? '#15803d' : '#22c55e';
      ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
      // a curved arrow, so it reads as "turn me"
      ctx.save();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(hx, hy, 7 * US, -0.6, Math.PI * 1.1); ctx.stroke();
      ctx.restore();

      const fl = partFlipsScreen(pt, sc);
      const flipBtn = (g, vertical) => {
        const bx = g.x, by = g.y, R = 16 * US;
        ctx.beginPath(); ctx.arc(bx, by, R, 0, Math.PI*2);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.save();
        ctx.translate(bx, by);
        if (vertical) ctx.rotate(Math.PI/2);
        const k = R * 0.62;
        ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(0, -k); ctx.lineTo(0, k); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#1d4ed8';
        for (const sgn of [-1, 1]){
          ctx.beginPath();
          ctx.moveTo(sgn * k, 0);
          ctx.lineTo(sgn * k * 0.35, -k * 0.5);
          ctx.lineTo(sgn * k * 0.35, k * 0.5);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      };
      flipBtn(fl.h, false);
      flipBtn(fl.v, true);
    });

    drawCutLine(X, Y);

    lastFull = full; lastPart = part; lastPerim = totalPerim;
    lastG = {name: parts.length + ' pieces', pts: [], W: 0, H: 0, area: totalArea,
      perim: totalPerim, circle: false,
      areaF: 'A = the pieces added together',
      perimF: 'P = all the way round every piece, cut edges included'};
    renderInfo();
  }

  /** The sector's grab: a little angle sign at the free end of the arc, so it is obvious
      that this corner swings the angle round as well as pulling the radius out. */
  function drawSectorHandle(X, Y){
    if (S.shape !== 'sector' || build.on || parts) return;
    const c = sectorGeom(S.dims.sector).sector;
    const x = X(c.cx + c.r*Math.cos(c.a1)), y = Y(c.cy + c.r*Math.sin(c.a1)), R = 15 * uiScale();
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 2.5 * uiScale(); ctx.strokeStyle = '#2563eb'; ctx.stroke();
    // the angle sign itself: two arms and the little arc between them
    const k = R * 0.62;
    ctx.strokeStyle = '#1e3a8a'; ctx.lineWidth = 2 * uiScale(); ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - k, y + k*0.8); ctx.lineTo(x + k, y + k*0.8);
    ctx.moveTo(x - k, y + k*0.8); ctx.lineTo(x + k*0.75, y - k*0.85);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(x - k, y + k*0.8, k*0.85, -Math.atan2(k*1.65, k*1.75), 0); ctx.stroke();
    ctx.restore();
  }

  // The dotted guide for the cut: shown as soon as the pointer goes down, and before that under
  // a mouse, so it is clear where the line will fall.
  function drawCutLine(X, Y){
    const c = cutDrag || cutHover;
    if (!c || !splitting) return;
    const O = c.O, D = c.D, big = 60;
    ctx.save();
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = cutDrag ? 3 : 2;
    ctx.globalAlpha = cutDrag ? 1 : 0.65;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.moveTo(X(O[0] - D[0]*big), Y(O[1] - D[1]*big));
    ctx.lineTo(X(O[0] + D[0]*big), Y(O[1] + D[1]*big));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // Where the scissors went in, and where they are now: a solid dot for the start so it is
    // clear which end the line is pivoting on, a ring for the end you are dragging.
    const r = 6 * uiScale();
    if (c.A){
      ctx.fillStyle = '#dc2626'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * uiScale();
      ctx.beginPath(); ctx.arc(X(c.A[0]), Y(c.A[1]), r, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    }
    if (c.B && cutDrag && cutDrag.live){
      // on the line itself, not under the finger, so it reads as the end of the cut
      const dx = c.B[0] - c.A[0], dy = c.B[1] - c.A[1], t = dx*D[0] + dy*D[1];
      const ex = c.A[0] + D[0]*t, ey = c.A[1] + D[1]*t;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2.5 * uiScale();
      ctx.beginPath(); ctx.arc(X(ex), Y(ey), r, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  // ---- Cutting a shape into pieces -----------------------------------------------------------
  const polyArea = P => {
    let a = 0;
    for (let i = 0; i < P.length; i++){ const b = P[(i+1)%P.length]; a += P[i][0]*b[1] - b[0]*P[i][1]; }
    return a / 2;
  };
  const polyPerim = P => {
    let t = 0;
    for (let i = 0; i < P.length; i++){ const b = P[(i+1)%P.length]; t += Math.hypot(b[0]-P[i][0], b[1]-P[i][1]); }
    return t;
  };
  function inPoly(P, x, y){
    let c = false;
    for (let i = 0, j = P.length-1; i < P.length; j = i++){
      const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj-xi)*(y-yi)/(yj-yi) + xi)) c = !c;
    }
    return c;
  }
  function cleanRing(P){
    const out = [];
    for (const q of P){
      const r = out[out.length-1];
      if (!r || Math.hypot(q[0]-r[0], q[1]-r[1]) > 1e-9) out.push([q[0], q[1]]);
    }
    while (out.length > 1 && Math.hypot(out[0][0]-out[out.length-1][0], out[0][1]-out[out.length-1][1]) < 1e-9) out.pop();
    const res = [];
    for (let i = 0; i < out.length; i++){
      const a = out[(i-1+out.length)%out.length], b = out[i], d = out[(i+1)%out.length];
      if (Math.abs((b[0]-a[0])*(d[1]-a[1]) - (b[1]-a[1])*(d[0]-a[0])) > 1e-9) res.push(b);
    }
    return res.length >= 3 ? res : out;
  }
  // Cut a polygon with the straight line through O running in direction D. Returns the pieces, or
  // null if the line misses it. A dented shape can come apart into more than two.
  function cutPolygon(poly, O, D){
    const EPS = 1e-7;
    let P = poly.map(q => q.slice());
    if (polyArea(P) < 0) P.reverse();                   // work anticlockwise throughout
    const N = [-D[1], D[0]];
    const K = q => (q[0]-O[0])*N[0] + (q[1]-O[1])*N[1];  // across the line
    const T = q => (q[0]-O[0])*D[0] + (q[1]-O[1])*D[1];  // along the line
    const n = P.length, A = [];
    for (let i = 0; i < n; i++){
      const a = P[i], b = P[(i+1)%n];
      A.push([a[0], a[1]]);
      const da = K(a), db = K(b);
      if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)){
        const t = da / (da - db);
        A.push([a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t]);
      }
    }
    const m = A.length;
    const sgn = A.map(q => { const d = K(q); return d > EPS ? 1 : d < -EPS ? -1 : 0; });
    if (!sgn.some(x => x > 0) || !sgn.some(x => x < 0)) return null;
    const pieces = [];
    for (const side of [1, -1]){
      const keep = i => sgn[i] !== -side;
      let st = -1;
      for (let i = 0; i < m; i++) if (!keep(i)){ st = i; break; }
      if (st < 0) continue;
      const chains = [];
      let cur = null;
      for (let k = 1; k <= m; k++){
        const i = (st + k) % m;
        if (keep(i)) (cur || (cur = [])).push(A[i]);
        else { if (cur && cur.length) chains.push(cur); cur = null; }
      }
      if (cur && cur.length) chains.push(cur);
      if (!chains.length) continue;
      // Going anticlockwise, the cut edge of a piece runs along the line one way for the side the
      // normal points to and the other way for the other, so the chains join up in that order.
      const nextChain = end => {
        let best = -1, bestD = Infinity;
        for (let j = 0; j < chains.length; j++){
          const d = (T(chains[j][0]) - T(end)) * side;
          if (d > EPS && d < bestD){ bestD = d; best = j; }
        }
        return best;
      };
      const used = new Array(chains.length).fill(false);
      for (let i = 0; i < chains.length; i++){
        if (used[i]) continue;
        const q = [];
        let j = i, guard = 0;
        while (j >= 0 && !used[j] && guard++ <= chains.length){
          used[j] = true;
          for (const pt of chains[j]) q.push(pt);
          j = nextChain(q[q.length-1]);
        }
        const cl = cleanRing(q);
        if (cl.length >= 3 && Math.abs(polyArea(cl)) > 1e-6) pieces.push(polyArea(cl) < 0 ? cl.reverse() : cl);
      }
    }
    if (pieces.length < 2) return null;
    // The pieces must add back up to what was there before, or the cut is not to be trusted.
    const want = Math.abs(polyArea(P));
    const got = pieces.reduce((t, q) => t + Math.abs(polyArea(q)), 0);
    if (Math.abs(got - want) > 1e-6 * Math.max(1, want)) return null;
    return pieces;
  }

  // ---- Pieces --------------------------------------------------------------------------------
  const partCentre = P => {
    // The centre of area, which is where a piece turns about and where its label sits.
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < P.length; i++){
      const q = P[i], r = P[(i+1)%P.length], f = q[0]*r[1] - r[0]*q[1];
      a += f; cx += (q[0]+r[0]) * f; cy += (q[1]+r[1]) * f;
    }
    if (Math.abs(a) < 1e-9){
      return [P.reduce((t,q)=>t+q[0],0)/P.length, P.reduce((t,q)=>t+q[1],0)/P.length];
    }
    return [cx / (3*a), cy / (3*a)];
  };
  const makePart = pts => {
    const c = partCentre(pts);
    return {pts, cx: c[0], cy: c[1], tx: 0, ty: 0, rot: 0, mir: false};
  };
  // A point of a piece, moved and turned to where the piece is now.
  function xf(part, q, tx, ty){
    const ca = Math.cos(part.rot), sa = Math.sin(part.rot);
    const dx = (q[0] - part.cx) * (part.mir ? -1 : 1), dy = q[1] - part.cy;
    const ox = tx === undefined ? part.tx : tx, oy = ty === undefined ? part.ty : ty;
    return [part.cx + ox + dx*ca - dy*sa, part.cy + oy + dx*sa + dy*ca];
  }
  // The same the other way round, for working out where a press landed on a piece.
  function unxf(part, q){
    const ca = Math.cos(-part.rot), sa = Math.sin(-part.rot);
    const ax = q[0] - part.cx - part.tx, ay = q[1] - part.cy - part.ty;
    let u = ax*ca - ay*sa;
    const v = ax*sa + ay*ca;
    if (part.mir) u = -u;
    return [part.cx + u, part.cy + v];
  }
  const partPts = part => part.pts.map(q => xf(part, q));
  // Used only while a piece is being dragged, so nothing ever shifts on its own. Pieces share the
  // paper's grid however they are turned: snapping the piece's position is not enough once it is
  // at an angle, because its corners then sit between the lines. So the corner that needs the
  // smallest nudge to reach a grid point is the one put on it, and the whole piece moves by that
  // much. Pieces turned by the same amount then line up with each other exactly.
  function snapPart(part, rawTx, rawTy){
    if (snapStep <= 0) return [Number(rawTx.toFixed(3)), Number(rawTy.toFixed(3))];
    let best = null;
    for (const q of part.pts){
      const v = xf(part, q, rawTx, rawTy);
      const dx = snapTo(v[0]) - v[0], dy = snapTo(v[1]) - v[1];
      const d = Math.hypot(dx, dy);
      if (!best || d < best.d) best = {d, dx, dy};
    }
    return best ? [round6(rawTx + best.dx), round6(rawTy + best.dy)] : [rawTx, rawTy];
  }
  const partHome = part => [part.cx + part.tx, part.cy + part.ty];
  // How far out the turn handle sits, in grid units.
  function partRadius(part){
    let r = 0;
    for (const q of part.pts) r = Math.max(r, Math.hypot(q[0]-part.cx, q[1]-part.cy));
    return r;
  }
  function partHandle(part, sc){
    const r = partRadius(part) + (sc ? 38 / sc : 1);
    return xf(part, [part.cx, part.cy + r]);   // out from the centre, turning with the piece
  }
  // The two flip buttons sit below the piece and stay square to the paper, because what they do
  // is mirror what you can see rather than anything in the piece's own frame.
  function partFlips(part, sc){
    const unit = sc ? 1 / sc : 0.02;
    const r = partRadius(part) + 38 * unit;
    const h = partHome(part), gap = 34 * unit;
    return {h: [h[0] - gap, h[1] - r], v: [h[0] + gap, h[1] - r]};
  }
  // The safe part of the paper: clear of the panel down the left and of the zoom and snap
  // controls along the bottom.
  function safeBox(){
    const cr = canvas.getBoundingClientRect();
    const R = 22 * uiScale();
    let x0 = R + 10;
    // On a wide screen the button panel floats over the paper and has to be kept clear of. On a
    // narrow one it sits above the paper instead, so there is nothing to avoid.
    const sb = document.getElementById('side2');
    if (sb && !sb.hidden){
      const s2 = sb.getBoundingClientRect();
      if (s2.right > cr.left + 4 && s2.top < cr.bottom - 4 && s2.bottom > cr.top + 4)
        x0 = Math.max(x0, s2.right - cr.left + R);
    }
    let y1 = cr.height - R - 10;
    const bl = document.getElementById('bottomLeft2');
    if (bl){
      const b2 = bl.getBoundingClientRect();
      if (b2.top < cr.bottom && b2.bottom > cr.top) y1 = Math.min(y1, b2.top - cr.top - R);
    }
    const box = {x0, x1: cr.width - R - 10, y0: R + 10, y1};
    if (box.x1 < box.x0) box.x0 = box.x1 = cr.width / 2;
    if (box.y1 < box.y0) box.y0 = box.y1 = cr.height / 2;
    return box;
  }
  // The turn handle on screen. Its direction is what shows how far the piece has been turned, so
  // when it would fall off the paper it is drawn in closer rather than moved sideways.
  function partHandleScreen(part, sc){
    const c = toScreen(...partHome(part)), h = toScreen(...partHandle(part, sc));
    const b = safeBox();
    const inBox = q => q.x >= b.x0 && q.x <= b.x1 && q.y >= b.y0 && q.y <= b.y1;
    if (inBox(h)) return h;
    let lo = 0.3, hi = 1;
    const at = t => ({x: c.x + (h.x - c.x) * t, y: c.y + (h.y - c.y) * t});
    for (let i = 0; i < 24; i++){
      const mid = (lo + hi) / 2;
      if (inBox(at(mid))) lo = mid; else hi = mid;
    }
    return at(lo);
  }
  // Where those buttons actually land on screen. A piece can sit low or near an edge, so they are
  // kept inside the paper, clear of the panel on the left and the zoom and snap controls below.
  function partFlipsScreen(part, sc){
    const g = partFlips(part, sc), b = safeBox();
    const clamp = p => {
      const q = toScreen(p[0], p[1]);
      return {x: Math.min(Math.max(q.x, b.x0), b.x1), y: Math.min(Math.max(q.y, b.y0), b.y1)};
    };
    return {h: clamp(g.h), v: clamp(g.v)};
  }
  // Mirroring on the paper, left to right or top to bottom, written back into the turn and flip
  // the piece already carries.
  function flipPart(part, vertical){
    markUndo();
    part.rot = vertical ? Math.PI - part.rot : -part.rot;
    part.mir = !part.mir;
  }

  function splitAt(O, D){
    markUndo();
    const src = parts ? parts : [makePart(geom().pts.map(q => q.slice()))];
    if (!parts) splitFrom = geom().pts.map(q => q.slice());
    const out = [];
    let cutAny = false;
    for (const part of src){
      // The line is drawn on the paper, so for a piece that has been turned it has to be put back
      // into that piece's own frame before cutting, and the piece keeps its position afterwards.
      const o2 = unxf(part, O);
      const e2 = unxf(part, [O[0] + D[0], O[1] + D[1]]);
      const dl = Math.hypot(e2[0]-o2[0], e2[1]-o2[1]);
      if (dl < 1e-9){ out.push(part); continue; }
      const d2 = [(e2[0]-o2[0])/dl, (e2[1]-o2[1])/dl];
      const bits = cutPolygon(part.pts, o2, d2);
      if (!bits){ out.push(part); continue; }
      cutAny = true;
      for (const b of bits){
        const np = makePart(b);
        np.mir = part.mir;
        // keep the piece exactly where it was on the paper
        const before = xf(part, np.cx === undefined ? [0,0] : [np.cx, np.cy]);
        np.rot = part.rot;
        np.tx = before[0] - np.cx;
        np.ty = before[1] - np.cy;
        out.push(np);
      }
    }
    if (!cutAny) return false;
    const first = !parts;
    parts = out;
    if (first) warn('Tap a piece to move, turn or flip it.');
    return true;
  }
  function rejoin(){
    if (!splitFrom) return;
    markUndo();
    parts = null; selPart = null; partDrag = null;
    S.free = {pts: splitFrom.map(q => q.slice())};
    S.shape = 'free';
    splitFrom = null;
    splitting = false;
    locked.clear(); angLocked.clear();
    resetZoom(false); sync(); draw(); renderCorners();
  }

  // Draw tools. Make polygon closes the outline and removes the drawing grid.
  $('undoBtn').onclick = () => undo();
  $('splitBtn').onclick = () => {
    splitting = !splitting;
    cutDrag = null; cutHover = null;
    if (splitting){ selSide = -1; selPin = -1; }
    sync(); draw(); renderCorners();
  };
  $('joinBtn').onclick = () => rejoin();
  $('polyBtn').onclick = ev => { ev.stopPropagation(); openPolyMenu(); };
  $('freeUndo').onclick = () => { pend = null; build.pts.pop(); sync(); draw(); };
  $('freeClear').onclick = () => { pend = null; build.pts = []; sync(); draw(); };
  // 2D shape: the elastic band goes round the pins and the shape is measured.
  $('shape2d').onclick = () => {
    if (pend){ commitPend(false); return; }
    if (!makeShape()) { sync(); return; }
    resetZoom(false); sync(); draw();
  };
  // 3D: the outline is made solid. Which kind it becomes (a prism, or a pyramid using the shape as
  // its base) is whichever the 3D button was last cycled to.
  $('opt3d').onclick = () => {
    if (pend){ commitPend(true); return; }
    if (!makeShape()) { sync(); return; }
    const g = geom();
    window.App.make3D(g.pts);
  };
  // Add sphere: needs no pins.
  $('sphere2d').onclick = () => {
    window.App.setSphere();
    window.switchView('3d');
  };
  $('newShape').onclick = () => {
    build.on = true; build.pts = []; pend = null; S.stage = 'draw'; S.shape = 'free'; S.free = null;
    parts = null; splitFrom = null; splitting = false; cutDrag = null; cutHover = null; partDrag = null; selPart = null;
    undoStack.length = 0;
    selSide = -1; selPin = -1; aim = null; locked.clear(); angLocked.clear();
    // The 3D view keeps its own copy of the outline, so that is cleared too; otherwise the shape
    // bar would build the shape that has just been thrown away.
    if (window.App && window.App.forgetShape) window.App.forgetShape();
    resetZoom(false); sync(); draw(); renderCorners();
  };
  // One button cycles: dimensions, then side lengths, then none.
  $('dimBtn').onclick = () => {
    S.dimMode = (S.dimMode + 1) % 3;
    S.dimsShow = S.dimMode === 1;
    S.perim = S.dimMode === 2;
    sync(); draw();
  };
  $('areaBtn').onclick = () => {
    // off -> squares -> label -> squares and label -> off
    const step = (S.grid ? 1 : 0) + (S.areaLab ? 2 : 0);
    const next = [1, 2, 3, 0][step];
    S.grid = !!(next & 1); S.areaLab = !!(next & 2);
    sync(); draw();
  };
  // Off, inside, outside, both, then off again.
  $('angBtn').onclick = () => { S.angMode = (S.angMode + 1) % 4; sync(); draw(); };
  $('calc2Btn').onclick = () => { info.hidden = !info.hidden; sync(); };
  $('meas2Toggle').onclick = () => {
    const b = $('meas2Body');
    b.hidden = !b.hidden;
    $('meas2Toggle').textContent = b.hidden ? 'Show' : 'Hide';
  };
  $('zoomReset').onclick = () => resetZoom(true);
  // Zoom buttons for the 2D view zoom about the middle of the stage.
  $('zoomIn2').onclick = () => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.1);
  $('zoomOut2').onclick = () => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / 1.1);
  document.querySelectorAll('#snap button').forEach(b => b.onclick = () => { snapStep = Number(b.dataset.snap); sync(); draw(); });


  // When a shape loads, each vertex and side shows a handle for a moment, then fades.
  function showIntro(){
    hbox.querySelectorAll('.vtx').forEach(e => e.remove());
    if (!tr || build.on || S.shape === 'free' || S.shape === 'circle' || S.shape === 'sector') return;
    draw();
    const seen = new Set(), spots = [];
    const add = p => {
      const k = p[0].toFixed(2) + ',' + p[1].toFixed(2);
      if (!seen.has(k)){ seen.add(k); spots.push(p); }
    };
    const sides = sidesFor(S.shape, S.dims[S.shape]);
    sides.forEach(s => { add(s.a); add(s.b); });
    sides.forEach(s => add([(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]));
    spots.forEach(p => {
      const m = toScreen(p[0], p[1]);
      const el = document.createElement('div');
      el.className = 'vtx';
      el.style.left = m.x + 'px';
      el.style.top = m.y + 'px';
      hbox.appendChild(el);
    });
    setTimeout(() => hbox.querySelectorAll('.vtx').forEach(e => e.classList.add('fade')), 1000);
    setTimeout(() => hbox.querySelectorAll('.vtx').forEach(e => e.remove()), 1700);
  }

  // Used by the question panel: show a shape with the given dimensions.
  function setShape(shape, dims){
    build.on = false;
    S.stage = 'shape';
    S.shape = shape;
    S.dims[shape] = Object.assign({}, dims);
    S.grid = false; S.areaLab = false;
    parts = null; splitFrom = null; splitting = false; cutDrag = null; partDrag = null; selPart = null;
    S.perim = false;
    resetZoom(false);
    sync();
    draw();
  }

  // Zoom back to 1 and centre the shape on screen.
  function resetZoom(redraw){
    view.z = 1; view.px = 0; view.py = 0;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (w && h){
      const sc0 = Math.min(w, h) / 16, g = geom();
      view.px = -(g.W/2 - 3) * sc0;
      view.py = (g.H/2 - 3) * sc0;
    }
    if (S.shape === 'sector'){ draw(); centreSectorApex(); }
    if (redraw) draw();
  }

  // Zoom by factor f keeping the screen point (mx, my) fixed.
  function zoomAt(mx, my, f){
    const z2 = Math.min(ZMAX, Math.max(ZMIN, view.z * f));
    const k = 1 - z2 / view.z;
    const cxS = stage.clientWidth/2, cyS = stage.clientHeight/2;
    view.px += (mx - cxS - view.px) * k;
    view.py += (my - cyS - view.py) * k;
    view.z = z2;
    draw();
  }

  function localPoint(e){
    const r = canvas.getBoundingClientRect();
    return {x: e.clientX - r.left, y: e.clientY - r.top};
  }

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const p = localPoint(e);
    zoomAt(p.x, p.y, e.deltaY > 0 ? 1/1.1 : 1.1);
  }, {passive:false});

  // ---- Sides. Press a side (anywhere along it) and drag to make the shape bigger or smaller.
  // The side stays under the pointer, and the cm scale never changes.
  function distToSeg(px, py, a, b){
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx*dx + dy*dy;
    let t = L2 ? ((px - a.x)*dx + (py - a.y)*dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t*dx), py - (a.y + t*dy));
  }

  // Index of the side under screen point p, or -1. Touch gets a wider target.
  function sideAt(p, touch){
    if (!tr || build.on || S.shape === 'free') return -1;
    const sides = sidesFor(S.shape, S.dims[S.shape]);
    const tol = touch ? 22 : 12;
    if (S.shape === 'circle'){
      // Anywhere on the circumference counts. The side is the compass point nearest the pointer.
      const c = toScreen(S.dims.circle.r, S.dims.circle.r);
      const rs = S.dims.circle.r * tr.sc0 * view.z;
      if (Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - rs) > tol) return -1;
      let best = 0, bestD = Infinity;
      sides.forEach((s, i) => {
        const q = toScreen(s.a[0], s.a[1]);
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < bestD){ bestD = d; best = i; }
      });
      return best;
    }
    if (S.shape === 'sector'){
      // The grab is the free end of the arc, with a generous target for a finger on a board.
      const c = sectorGeom(S.dims.sector).sector;
      const e = toScreen(c.cx + c.r*Math.cos(c.a1), c.cy + c.r*Math.sin(c.a1));
      return Math.hypot(p.x - e.x, p.y - e.y) <= tol * 2.2 ? 0 : -1;
    }
    let best = -1, bestD = Infinity;
    sides.forEach((s, i) => {
      const A = toScreen(s.a[0], s.a[1]), B = toScreen(s.b[0], s.b[1]);
      const d = distToSeg(p.x, p.y, A, B);
      if (d <= tol && d < bestD){ best = i; bestD = d; }
    });
    return best;
  }

  // The one visible handle, shown only while the mouse hovers over a side.
  const hbox = $('handles2');
  const indicator = document.createElement('div');
  indicator.className = 'hdl';
  hbox.appendChild(indicator);
  // Corner handles on an elastic-band shape: faint on every corner, bold on the one selected.
  // The pulsing ring on the starting pin. It is kept between redraws so its pulse runs smoothly.
  let startRing = null;
  function placeStartRing(x, y){
    if (!startRing){
      startRing = document.createElement('div');
      startRing.className = 'startRing';
      hbox.appendChild(startRing);
    }
    startRing.style.left = x + 'px';
    startRing.style.top = y + 'px';
  }
  function clearStartRing(){ if (startRing){ startRing.remove(); startRing = null; } }

  function renderCorners(){
    hbox.querySelectorAll('.cnr').forEach(e => e.remove());
    if (!tr || build.on || parts || S.shape !== 'free' || !S.free) return;
    S.free.pts.forEach((q, i) => {
      const m = toScreen(q[0], q[1]);
      const el = document.createElement('div');
      el.className = 'cnr' + (i === selPin ? ' on' : '') + (locked.has(i) ? ' locked' : '');
      el.style.left = m.x + 'px';
      el.style.top = m.y + 'px';
      hbox.appendChild(el);
    });
  }
  let hoverIdx = -1;
  function showIndicator(){
    const sides = (tr && !build.on && S.shape !== 'free') ? sidesFor(S.shape, S.dims[S.shape]) : [];
    const s = sides[hoverIdx];
    if (!s){ indicator.classList.remove('show'); return; }
    const m = toScreen((s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2);
    indicator.style.left = m.x + 'px';
    indicator.style.top = m.y + 'px';
    indicator.classList.add('show');
  }

  let sideDrag = null; // {idx, snap, x0, y0} while a side is being dragged

  /** Pulls the sector's radius and angle straight off the pointer. */
  function dragSector(p){
    const c = sectorGeom(S.dims.sector).sector;
    const o = toScreen(c.cx, c.cy), pxPerCm = tr.sc0 * view.z;
    const dx = (p.x - o.x) / pxPerCm, dy = -(p.y - o.y) / pxPerCm;
    let r = Math.hypot(dx, dy);
    r = snapStep > 0 ? Math.max(snapStep, snapTo(r)) : Math.max(0.2, Number(r.toFixed(2)));
    let deg = Math.atan2(dy, dx) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    deg = Math.round(deg);                                   // every whole degree is reachable
    S.dims.sector.r = Math.min(12, r);
    S.dims.sector.a = Math.min(355, Math.max(5, deg));
    sync();
    centreSectorApex();
    draw();
  }
  /** Keeps the point where the two radii meet in the middle of the grid, so the sector
      opens out around a fixed centre instead of sliding about as it is dragged. */
  function centreSectorApex(){
    if (S.shape !== 'sector' || !tr) return;
    const c = sectorGeom(S.dims.sector).sector;
    const m = toScreen(c.cx, c.cy);
    view.px += stage.clientWidth / 2 - m.x;
    view.py += stage.clientHeight / 2 - m.y;
  }

  function resizeBySide(p){
    const snap = sideDrag.snap;
    const def = sidesFor(S.shape, snap)[sideDrag.idx];
    const pxPerCm = tr.sc0 * view.z;
    const dxCm = (p.x - sideDrag.x0) / pxPerCm;
    const dyCm = -(p.y - sideDrag.y0) / pxPerCm;
    const proj = def.axis === 'x' ? dxCm : dyCm;
    const v = snap[def.key] + def.mult * proj;
    S.dims[S.shape][def.key] = Math.min(12, Math.max(1, Math.round(v)));
    sync();
    draw();
    // Hold the anchor corner where it started, so the shape stays put.
    const now = sidesFor(S.shape, S.dims[S.shape])[sideDrag.idx];
    const a = anchorFor(now);
    const m = toScreen(a[0], a[1]);
    view.px += sideDrag.anchorScreen.x - m.x;
    view.py += sideDrag.anchorScreen.y - m.y;
    draw();
  }

  // Elastic-band shapes: click a side once to select it (orange), then press it again and drag to
  // push it out or pull it in. Its two corner pins move along the side's outward normal and the band
  // is recalculated from the moved pins.
  // Corners work the same way: click a corner once to select it (orange dot), then press it again and drag.
  let selSide = -1, selPin = -1, freeDrag = null;
  // Dragging on the paper outside the shape turns the shape about its middle.
  let spinDrag = null;
  // Corners that have been pinned down by tapping them. A side dragged by one of its ends only
  // moves the end that is free, so the side swings about the pinned corner instead of sliding.
  let locked = new Set();
  // Angles that have been held by pressing them. A held angle keeps the two sides that meet there
  // at the same angle to each other, however the shape is pulled about.
  let angLocked = new Set();
  // Where each angle can be pressed: the corner on screen, how far the arc reaches, and the
  // middle of the angle with how wide it opens, so a press inside the angle counts too.
  let angHit = [];
  function pinAt(p, touch){
    if (!tr || build.on || S.shape !== 'free' || !S.free) return -1;
    const P = S.free.pts, tol = touch ? 26 : 14;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < P.length; i++){
      const A = toScreen(P[i][0], P[i][1]);
      const d = Math.hypot(p.x - A.x, p.y - A.y);
      if (d <= tol && d < bestD){ best = i; bestD = d; }
    }
    return best;
  }
  // Where a corner is allowed to go, once held angles are taken into account. A held angle at the
  // corner itself leaves it free to slide round the circle through its two neighbours, which is
  // the set of points that see them at the same angle. A held angle next door instead keeps this
  // corner on the line out from that neighbour, so its side can only grow or shrink.
  // Snapping is still wanted, but only where the grid point sits on the path a held angle allows.
  // Anywhere else the corner is left exactly where the working puts it, so the angle holds.
  const ON_PATH = 1e-6;
  function raySpot(K, P0, want){
    const dx = P0[0] - K[0], dy = P0[1] - K[1], L = Math.hypot(dx, dy);
    if (L < 1e-9) return {p: want, ok: () => true};
    const ux = dx / L, uy = dy / L;
    const t = Math.max(0.2, (want[0] - K[0]) * ux + (want[1] - K[1]) * uy);
    return {
      p: [K[0] + ux * t, K[1] + uy * t],
      ok: c => Math.abs((c[0] - K[0]) * uy - (c[1] - K[1]) * ux) < ON_PATH &&
               (c[0] - K[0]) * ux + (c[1] - K[1]) * uy > 0.15
    };
  }
  function allowedSpot(i, want){
    const O = freeDrag.orig, n = O.length;
    const prev = (i - 1 + n) % n, next = (i + 1) % n;
    const onRay = (k) => raySpot(O[k], O[i], want);
    if (angLocked.has(i)){
      // The circle through the two neighbours and where this corner started.
      const A = O[prev], C = O[next], B = O[i];
      const d = 2 * (A[0]*(C[1]-B[1]) + C[0]*(B[1]-A[1]) + B[0]*(A[1]-C[1]));
      if (Math.abs(d) > 1e-9){
        const sa = A[0]*A[0] + A[1]*A[1], sc = C[0]*C[0] + C[1]*C[1], sb = B[0]*B[0] + B[1]*B[1];
        const ox = (sa*(C[1]-B[1]) + sc*(B[1]-A[1]) + sb*(A[1]-C[1])) / d;
        const oy = (sa*(B[0]-C[0]) + sc*(A[0]-B[0]) + sb*(C[0]-A[0])) / d;
        const R = Math.hypot(B[0]-ox, B[1]-oy);
        let vx = want[0]-ox, vy = want[1]-oy;
        const L = Math.hypot(vx, vy);
        if (L > 1e-9) return {p: [ox + vx/L*R, oy + vy/L*R],
          ok: c => Math.abs(Math.hypot(c[0]-ox, c[1]-oy) - R) < ON_PATH};
      }
      return {p: O[i].slice(), ok: () => false};
    }
    const pl = angLocked.has(prev), nl = angLocked.has(next);
    if (pl && nl) return {p: O[i].slice(), ok: () => false};   // held either side: boxed in
    if (pl) return onRay(prev);
    if (nl) return onRay(next);
    return {p: want, ok: () => true};
  }

  function moveFreePin(p){
    if (locked.has(freeDrag.idx)) return;   // pinned down: it stays where it is
    const pxPerCm = tr.sc0 * view.z;
    const dx = (p.x - freeDrag.x0) / pxPerCm, dy = -(p.y - freeDrag.y0) / pxPerCm;
    const O = freeDrag.orig, n = O.length, i = freeDrag.idx;
    // Held angles decide where this corner is allowed to go; with none it goes where it is pulled.
    const spot = allowedSpot(i, [O[i][0] + dx, O[i][1] + dy]);
    // Snap where the grid point lies on the path the held angle allows, and only there: the angle
    // comes first, so anywhere else the corner keeps the exact spot the working gives it.
    const here = snapStep > 0 ? [snapTo(spot.p[0]), snapTo(spot.p[1])] : null;
    const use = (here && spot.ok(here)) ? here : [round6(spot.p[0]), round6(spot.p[1])];
    const moved = O.map((q, k) => k === i ? use : q.slice());
    if (!validOutline(moved)) return;
    // As with sides, the coordinates stay put during the drag so the other corners do not move on screen.
    S.free = {pts: moved};
    draw();
  }
  function freeSideAt(p, touch){
    if (!tr || build.on || S.shape !== 'free' || !S.free) return -1;
    const P = S.free.pts, n = P.length, tol = touch ? 22 : 12;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < n; i++){
      const A = toScreen(P[i][0], P[i][1]), B = toScreen(P[(i + 1) % n][0], P[(i + 1) % n][1]);
      const d = distToSeg(p.x, p.y, A, B);
      if (d <= tol && d < bestD){ best = i; bestD = d; }
    }
    return best;
  }
  // Turned in five degree steps, so a shape can be set back square without fiddling.
  function spinShape(p){
    const q = toGrid(p);
    const a = Math.atan2(q.y - spinDrag.cy, q.x - spinDrag.cx);
    const step = 5 * Math.PI / 180;
    const d = Math.round((a - spinDrag.a0) / step) * step;
    const c = Math.cos(d), s = Math.sin(d);
    S.free = {pts: spinDrag.orig.map(v => {
      const dx = v[0] - spinDrag.cx, dy = v[1] - spinDrag.cy;
      return [round6(spinDrag.cx + dx*c - dy*s), round6(spinDrag.cy + dx*s + dy*c)];
    })};
    draw(); renderCorners();
  }
  const round6 = x => Math.round(x * 1e6) / 1e6;

  function moveFreeSide(p){
    const pxPerCm = tr.sc0 * view.z;
    // The side follows the pointer in whatever direction it is dragged. It used to be held to a
    // line at right angles to itself, which on a slanted side swung the two sides either end of it
    // and made the whole shape look like it was turning.
    const rawx = (p.x - freeDrag.x0) / pxPerCm, rawy = -(p.y - freeDrag.y0) / pxPerCm;
    const O = freeDrag.orig, n = O.length, i = freeDrag.idx, j = (i + 1) % n;
    const prev = (i - 1 + n) % n, next = (j + 1) % n;
    if (angLocked.has(i) && angLocked.has(j)) return;   // held at both ends: it cannot move
    // Held at one end: that corner stays where it is and the far end slides straight out along the
    // side, so the side only grows or shrinks and the held angle is untouched.
    if (angLocked.has(i) || angLocked.has(j)){
      const anchor = angLocked.has(i) ? i : j, far = angLocked.has(i) ? j : i;
      if (locked.has(far)) return;
      const s = raySpot(O[anchor], O[far], [O[far][0] + rawx, O[far][1] + rawy]);
      const cand = snapStep > 0 ? [snapTo(s.p[0]), snapTo(s.p[1])] : null;
      const spot = (cand && s.ok(cand)) ? cand : [round6(s.p[0]), round6(s.p[1])];
      const out = O.map((q, k) => k === far ? spot : q.slice());
      if (!validOutline(out)) return;
      S.free = {pts: out};
      draw();
      return;
    }
    const hi = angLocked.has(prev) ? prev : -1;   // the held corner that end i hangs from
    const hj = angLocked.has(next) ? next : -1;   // and the one end j hangs from
    let moved;
    if (hi >= 0 && hi === hj){
      // Both ends hang from the same held corner, which is how the far side of a triangle sits.
      // Scaling them both by one amount about that corner keeps every angle in the shape, so the
      // triangle grows and shrinks as a similar triangle.
      if (locked.has(i) || locked.has(j)) return;
      const K = O[hi];
      const M = [(O[i][0] + O[j][0]) / 2, (O[i][1] + O[j][1]) / 2];
      const ax = M[0] - K[0], ay = M[1] - K[1], L2 = ax*ax + ay*ay;
      if (L2 < 1e-9) return;
      let t = ((M[0] + rawx - K[0]) * ax + (M[1] + rawy - K[1]) * ay) / L2;
      t = Math.max(0.12, Math.min(14, t));
      const at = f => [[K[0] + (O[i][0] - K[0]) * f, K[1] + (O[i][1] - K[1]) * f],
                       [K[0] + (O[j][0] - K[0]) * f, K[1] + (O[j][1] - K[1]) * f]];
      let pair = at(t);
      if (snapStep > 0){
        // Try the grid: it is only taken if both ends land on it at the very same scale, which is
        // what keeps every angle, and the shape, exactly as it was.
        const c0 = [snapTo(pair[0][0]), snapTo(pair[0][1])];
        const dxk = O[i][0] - K[0], dyk = O[i][1] - K[1], L2i = dxk*dxk + dyk*dyk;
        if (L2i > 1e-9){
          const t2 = ((c0[0] - K[0]) * dxk + (c0[1] - K[1]) * dyk) / L2i;
          const p2 = at(t2);
          const fits = q2 => Math.abs(q2[0] - snapTo(q2[0])) < ON_PATH && Math.abs(q2[1] - snapTo(q2[1])) < ON_PATH;
          if (t2 > 0.12 && fits(p2[0]) && fits(p2[1])) pair = p2;
        }
      }
      moved = O.map((q, k) => k === i ? [round6(pair[0][0]), round6(pair[0][1])]
                         : (k === j ? [round6(pair[1][0]), round6(pair[1][1])] : q.slice()));
    } else if (hi >= 0 || hj >= 0){
      // Held at one end only: that end slides straight out from its held corner, so the side it
      // shares with that corner only grows or shrinks and the angle there is kept.
      const slide = (e, k) => {
        if (locked.has(e)) return O[e].slice();
        if (k < 0) return [snapTo(O[e][0] + rawx), snapTo(O[e][1] + rawy)];
        const ux = O[e][0] - O[k][0], uy = O[e][1] - O[k][1], L = Math.hypot(ux, uy) || 1;
        const t = Math.max(0.2, (O[e][0] + rawx - O[k][0]) * (ux / L) + (O[e][1] + rawy - O[k][1]) * (uy / L));
        return [round6(O[k][0] + ux / L * t), round6(O[k][1] + uy / L * t)];
      };
      const pi = slide(i, hi), pj = slide(j, hj);
      moved = O.map((q, k) => k === i ? pi : (k === j ? pj : q.slice()));
    } else {
      const dx = snapTo(rawx), dy = snapTo(rawy);
      // A pinned corner stays put, so a side held at one end swings about it.
      moved = O.map((q, k) => ((k === i || k === j) && !locked.has(k)) ? [q[0] + dx, q[1] + dy] : q.slice());
    }
    if (!validOutline(moved)) return;
    // Keep the coordinates as they are during the drag, so the other sides stay where they are on screen.
    S.free = {pts: moved};
    draw();
  }

  // Pointers: one finger or mouse drags a side or pans; two fingers pinch.
  const pts = new Map();
  let pinchDist = 0, last = null;

  // Turn a screen point into a whole-cm grid point and add it as the next corner.
  // Do two sides cross? Sides that meet at a shared corner are allowed to touch there.
  function segsCross(a, b, c, d){
    const o = (p, q, r) => Math.sign((q[0]-p[0])*(r[1]-p[1]) - (q[1]-p[1])*(r[0]-p[0]));
    const on = (p, q, r) => o(p, q, r) === 0 && Math.min(p[0],q[0]) - 1e-9 <= r[0] && r[0] <= Math.max(p[0],q[0]) + 1e-9
      && Math.min(p[1],q[1]) - 1e-9 <= r[1] && r[1] <= Math.max(p[1],q[1]) + 1e-9;
    const o1 = o(a,b,c), o2 = o(a,b,d), o3 = o(c,d,a), o4 = o(c,d,b);
    if (o1 !== o2 && o3 !== o4) return true;
    return on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b);
  }
  // An outline works if it has three or more corners, is not all in a line, and no two sides cross.
  function validOutline(P){
    if (!P || P.length < 3) return false;
    let s2 = 0;
    for (let i = 0; i < P.length; i++){
      const a = P[i], b = P[(i+1) % P.length];
      s2 += a[0]*b[1] - b[0]*a[1];
    }
    return Math.abs(s2) > 1e-9 && !selfCrossing(P);
  }
  function selfCrossing(P){
    const n = P.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++){
      if (j === i || (i === 0 && j === n - 1) || j === i + 1) continue;   // sides that share a corner
      if (segsCross(P[i], P[(i+1) % n], P[j], P[(j+1) % n])) return true;
    }
    return false;
  }
  // Closes the outline exactly as it was drawn, corner by corner, so concave shapes keep their dents.
  // Returns false if the corners are in a line or the sides cross each other.
  function makeShape(){
    let order = build.pts.map(q => q.slice());
    if (order.length < 3){ warn('Add at least 3 points first.'); return false; }
    // Signed area: zero means the corners are all in a line, negative means the outline was drawn
    // clockwise. The corners are turned anticlockwise, keeping the starting pin first.
    let s2 = 0;
    for (let i = 0; i < order.length; i++){
      const a = order[i], b = order[(i+1) % order.length];
      s2 += a[0]*b[1] - b[0]*a[1];
    }
    if (Math.abs(s2) < 1e-9){ warn('Those points are in a straight line. Move one off the line.'); return false; }
    if (selfCrossing(order)){ warn('Those sides cross each other. Undo a point and try another route.'); return false; }
    if (s2 < 0) order = [order[0]].concat(order.slice(1).reverse());
    const mx = Math.min(...order.map(q => q[0])), my = Math.min(...order.map(q => q[1]));
    S.free = {pts: order.map(q => [q[0] - mx, q[1] - my])};
    S.shape = 'free';
    build.on = false; build.pts = [];
    S.stage = 'shape';
    selSide = -1; selPin = -1;
    return true;
  }
  let warnT = 0;
  function warn(text){
    $('drawMsg').hidden = false;
    $('drawMsg').textContent = text;
    $('drawMsg').classList.add('warn');
    clearTimeout(warnT);
    warnT = setTimeout(() => { $('drawMsg').classList.remove('warn'); sync(); }, 2600);
  }

  function addVertex(p){
    if (!tr) return;
    // Tapping an existing pin takes it away again.
    const hit = build.pts.findIndex(q => {
      const A = toScreen(q[0], q[1]);
      return Math.hypot(p.x - A.x, p.y - A.y) <= 18;
    });
    // Clicking the starting pin again closes the shape, once there are enough pins to make one.
    if (hit === 0 && build.pts.length >= 3){
      if (!makeShape()){ sync(); return; }
      resetZoom(false); sync(); draw(); renderCorners();
      return;
    }
    if (hit >= 0){ build.pts.splice(hit, 1); sync(); draw(); return; }
    const x = ((p.x - tr.cxS - view.px) / view.z + tr.cxS - tr.ox) / tr.sc0;
    const y = (tr.oy - ((p.y - tr.cyS - view.py) / view.z + tr.cyS)) / tr.sc0;
    const gx = Math.min(12, Math.max(0, snapTo(x)));
    const gy = Math.min(12, Math.max(0, snapTo(y)));
    const N = [gx, gy];
    if (build.pts.some(q => q[0] === gx && q[1] === gy)) { warn('That point is already in the outline.'); return; }
    build.pts.push(N);
    sync();
    draw();
  }

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, localPoint(e));
    last = localPoint(e);
    clickAt = build.on && !pend && pts.size === 1 ? localPoint(e) : null;
    sideDrag = null;
    closePad();
    if (pts.size === 1 && build.on && pend){
      const p = localPoint(e), h = pendHandle(), hs = toScreen(h[0], h[1]);
      if (Math.hypot(p.x - hs.x, p.y - hs.y) <= 28){
        pendDrag = {anchor: pendAnchor()};
        return;
      }
    }
    if (pts.size === 1 && !build.on && splitting){
      const q = toGrid(localPoint(e));
      const A = snapCutPt(q);
      cutDrag = {start: q, A, B: A.slice(), live: false, O: A, D: [1, 0]};
      cutHover = null;
      draw();
      return;
    }
    if (pts.size === 1 && !build.on && parts){
      const p = localPoint(e), q = toGrid(p);
      const scNow = tr ? tr.sc0 * view.z : 0;
      const near = (g, r) => { const hs = toScreen(g[0], g[1]); return Math.hypot(p.x - hs.x, p.y - hs.y) <= r * uiScale(); };
      const onHandle = pt => { const g = partHandleScreen(pt, scNow);
        return Math.hypot(p.x - g.x, p.y - g.y) <= 30 * uiScale(); };
      const front = pt => { const i = parts.indexOf(pt); if (i >= 0){ parts.splice(i, 1); parts.push(pt); } };
      // The handle of the piece last touched comes first, so whatever was just moved can always be
      // turned. After that a press inside a piece picks that piece up, because reaching a piece
      // must never be blocked by a handle belonging to a different one lying across it.
      if (selPart && parts.includes(selPart)){
        const fl = partFlipsScreen(selPart, scNow);
        const hit = g => Math.hypot(p.x - g.x, p.y - g.y) <= 30 * uiScale();
        if (hit(fl.h)){ flipPart(selPart, false); draw(); return; }
        if (hit(fl.v)){ flipPart(selPart, true); draw(); return; }
        if (onHandle(selPart)){ armUndo(); partDrag = {pt: selPart, turn: true}; front(selPart); draw(); return; }
      }
      for (let i = parts.length - 1; i >= 0; i--){
        if (inPoly(partPts(parts[i]), q.x, q.y)){
          const pt = parts[i];
          selPart = pt;
          armUndo();
          partDrag = {pt, turn: false, gx: q.x - pt.tx, gy: q.y - pt.ty};
          front(pt);
          draw();
          return;
        }
      }
      selPart = null; draw();
      return;
    }
    if (pts.size === 1 && !build.on && S.shape === 'free'){
      const p = localPoint(e), touch = e.pointerType !== 'mouse';
      const ak = S.angMode ? angleAt(p) : -1;
      if (ak >= 0){
        // Pressing an angle holds it or lets it go.
        if (angLocked.has(ak)) angLocked.delete(ak); else angLocked.add(ak);
        selSide = -1; selPin = -1;
        sync(); draw();
        return;
      }
      const pin = pinAt(p, touch);
      if (pin >= 0){
        // Straight into the drag. If it turns out to be a tap with no drag, the corner is pinned
        // down instead, which is sorted out when the pointer goes up.
        selPin = pin; selSide = -1;
        armUndo();
        freeDrag = {kind:'pin', idx:pin, x0:p.x, y0:p.y, orig: S.free.pts.map(q => q.slice()), moved:false};
        draw();
      } else {
        const idx = freeSideAt(p, touch);
        if (idx >= 0){
          selSide = idx; selPin = -1;
          armUndo();
          freeDrag = {kind:'side', idx, x0:p.x, y0:p.y, orig: S.free.pts.map(q => q.slice()), moved:false};
          draw();
        } else {
          const g = geom(), q = toGrid(p);
          if (g.pts.length > 2 && !inside(g, q.x, q.y)){
            // Outside the shape: turn it about its middle rather than sliding the paper.
            const O = S.free.pts, n = O.length;
            const cx = O.reduce((t, v) => t + v[0], 0) / n, cy = O.reduce((t, v) => t + v[1], 0) / n;
            spinDrag = {cx, cy, a0: Math.atan2(q.y - cy, q.x - cx), orig: O.map(v => v.slice())};
          }
          if (selSide >= 0 || selPin >= 0){ selSide = -1; selPin = -1; draw(); }
        }
      }
    }
    if (pts.size === 1 && !build.on && S.shape !== 'free'){
      const p = localPoint(e);
      const idx = sideAt(p, e.pointerType !== 'mouse');
      if (idx >= 0){
        if (S.shape === 'sector'){ sideDrag = {idx, sector:true}; return; }
        const a0 = anchorFor(sidesFor(S.shape, S.dims[S.shape])[idx]);
        const at = toScreen(a0[0], a0[1]);
        sideDrag = {idx, snap:Object.assign({}, S.dims[S.shape]), x0:p.x, y0:p.y, anchorScreen:at};
      }
    }
    if (pts.size === 2){
      const [a, b] = [...pts.values()];
      pinchDist = Math.hypot(a.x-b.x, a.y-b.y);
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)){
      // While pins are being placed, the next side follows the pointer.
      if (build.on){
        if (pend){ canvas.style.cursor = 'default'; return; }
        if (e.pointerType === 'mouse'){
          aim = localPoint(e);
          if (build.pts.length) draw();
          const over = build.pts.length >= 3 &&
            Math.hypot(aim.x - toScreen(build.pts[0][0], build.pts[0][1]).x,
                       aim.y - toScreen(build.pts[0][0], build.pts[0][1]).y) <= 18;
          canvas.style.cursor = over ? 'pointer' : 'crosshair';
        }
        return;
      }
      if (splitting && e.pointerType === 'mouse'){
        const q = toGrid(localPoint(e));
        const A = snapCutPt(q);
        cutHover = {A, O: A, D: [1, 0]};
        canvas.style.cursor = 'crosshair';
        draw();
        return;
      }
      // Hover with a mouse: show the handle on the side under the pointer.
      if (e.pointerType === 'mouse'){
        const idx = sideAt(localPoint(e), false);
        if (idx !== hoverIdx){ hoverIdx = idx; showIndicator(); }
        canvas.style.cursor = idx >= 0 ? (sidesFor(S.shape, S.dims[S.shape])[idx].axis === 'x' ? 'ew-resize' : 'ns-resize') : '';
      }
      return;
    }
    if (clickAt){
      const p0 = localPoint(e);
      if (pts.size > 1 || Math.hypot(p0.x - clickAt.x, p0.y - clickAt.y) > 6) clickAt = null;
    }
    pts.set(e.pointerId, localPoint(e));
    if (pts.size === 2){
      sideDrag = null;
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x-b.x, a.y-b.y);
      if (pinchDist > 0) zoomAt((a.x+b.x)/2, (a.y+b.y)/2, d / pinchDist);
      pinchDist = d;
    } else if (pts.size === 1 && spinDrag){
      spinShape(localPoint(e));
    } else if (pts.size === 1 && freeDrag){
      // Far enough to count as a drag rather than a tap, so a slightly shaky tap still pins a corner.
      const lp = localPoint(e);
      if (Math.hypot(lp.x - freeDrag.x0, lp.y - freeDrag.y0) > 6){ if (!freeDrag.moved) commitUndo(); freeDrag.moved = true; }
      if (freeDrag.kind === 'pin') moveFreePin(localPoint(e));
      else moveFreeSide(localPoint(e));
    } else if (pts.size === 1 && cutDrag){
      const q = toGrid(localPoint(e));
      const dx = q.x - cutDrag.start.x, dy = q.y - cutDrag.start.y;
      if (Math.hypot(dx, dy) > 0.25) cutDrag.live = true;
      // The line pivots on the point the scissors went in, and can lie at any angle -
      // but it jumps to straight across or straight down once it is close to either.
      cutDrag.B = [Number(q.x.toFixed(3)), Number(q.y.toFixed(3))];
      cutDrag.D = cutDir(cutDrag.A[0], cutDrag.A[1], q.x, q.y);
      cutDrag.O = cutDrag.A;
      draw();
    } else if (pts.size === 1 && partDrag){
      const q = toGrid(localPoint(e)), pt = partDrag.pt;
      if (partDrag.turn){
        const c = partHome(pt);
        const a = Math.atan2(q.y - c[1], q.x - c[0]) - Math.PI/2;
        const stepR = 15 * Math.PI / 180;
        const want = Math.round(a / stepR) * stepR;    // fifteen degrees at a time
        if (want !== pt.rot){ commitUndo(); pt.rot = want; }
      } else {
        const t = snapPart(pt, q.x - partDrag.gx, q.y - partDrag.gy);
        if (t[0] !== pt.tx || t[1] !== pt.ty){ commitUndo(); pt.tx = t[0]; pt.ty = t[1]; }
      }
      draw();
    } else if (pts.size === 1 && pendDrag){
      resizePend(localPoint(e));
    } else if (pts.size === 1 && sideDrag){
      if (sideDrag.sector) dragSector(localPoint(e)); else resizeBySide(localPoint(e));
    } else if (pts.size === 1 && last){
      const p = localPoint(e);
      view.px += p.x - last.x;
      view.py += p.y - last.y;
      last = p;
      draw();
    }
  });

  const endPtr = e => {
    pts.delete(e.pointerId);
    if (clickAt && pts.size === 0){ const c = clickAt; clickAt = null; addVertex(c); }
    clickAt = null;
    if (pts.size === 0){
      sideDrag = null; pendDrag = null; partDrag = null;
      if (cutDrag){
        const c = cutDrag;
        cutDrag = null;
        if (c.live){
          if (!splitAt(c.O, c.D)) warn('That line misses the shape.');
          sync();
        }
        draw();
      }
    }
    if (pts.size === 0 && spinDrag){
      // Bring the shape back to the corner of the grid, moving the view by the same amount so it
      // does not jump on screen.
      const P = S.free.pts;
      const mx = Math.min(...P.map(q => q[0])), my = Math.min(...P.map(q => q[1]));
      S.free = {pts: P.map(q => [round6(q[0] - mx), round6(q[1] - my)])};
      view.px += mx * tr.sc0 * view.z;
      view.py -= my * tr.sc0 * view.z;
      spinDrag = null; draw(); renderCorners();
    }
    if (pts.size === 0 && freeDrag && freeDrag.kind === 'pin' && !freeDrag.moved){
      // A tap on a corner, with no drag: pin it down, or let it go if it was already pinned.
      const i = freeDrag.idx;
      commitUndo();
      if (locked.has(i)) locked.delete(i); else locked.add(i);
      freeDrag = null; selPin = -1; selSide = -1;
      draw(); renderCorners();
    } else if (pts.size === 0 && freeDrag){
      // Bring the corner back to (0, 0) now the drag is over, and move the view by the same amount so
      // nothing jumps on screen.
      const P = S.free.pts;
      const mx = Math.min(...P.map(q => q[0])), my = Math.min(...P.map(q => q[1]));
      S.free = {pts: P.map(q => [q[0] - mx, q[1] - my])};
      view.px += mx * tr.sc0 * view.z;
      view.py -= my * tr.sc0 * view.z;
      freeDrag = null; selSide = -1; selPin = -1; draw();
    }
    last = pts.size ? [...pts.values()][0] : null;
    pinchDist = 0;
    if (pts.size === 0) pendUndo = null;   // an armed step that never changed anything is dropped
  };
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('pointerleave', () => {
    if (hoverIdx !== -1){ hoverIdx = -1; showIndicator(); }
    canvas.style.cursor = '';
    if (aim){ aim = null; if (build.on) draw(); }
  });

  if (window.ResizeObserver) new ResizeObserver(() => draw()).observe(stage);

  // Replaces the outline with the given points (used when a prism's outline has been changed in 3D).
  function setFree(pts){
    const mx = Math.min(...pts.map(q => q[0])), my = Math.min(...pts.map(q => q[1]));
    S.free = {pts: pts.map(q => [q[0] - mx, q[1] - my])};
    S.shape = 'free'; build.on = false; build.pts = []; S.stage = 'shape';
    parts = null; splitFrom = null; splitting = false; cutDrag = null; partDrag = null; selPart = null;
    selSide = -1; selPin = -1; locked.clear(); angLocked.clear();
    sync(); draw();
  }
  window.Area2D = {draw, setShape, setFree, getSnap: () => snapStep, getShape: () => S.shape, getDims: () => S.dims, validOutline,
    releaseGrab(){ freeDrag = null; spinDrag = null; sideDrag = null; pts.clear(); last = null; pinchDist = 0; clickAt = null; draw(); },
    // Any shape can go 3D, not just a hand-built one: a named shape hands over the outline
    // its own geometry works out.
    outline: () => build.on ? null
      : (S.shape === 'free' && S.free) ? S.free.pts.map(q => q.slice())
      : (geom().pts || []).map(q => q.slice()),
    __t: {parts: () => parts, cut: () => cutDrag || cutHover, splitting: () => splitting,
          splitAt: (O, D) => splitAt(O, D), cutDir, snapCutPt, setSnap(v){ snapStep = v; sync(); draw(); },
          dims: () => S.dims, shape: () => S.shape, sectorGeom: () => sectorGeom(S.dims.sector),
          toScreen: (x, y) => toScreen(x, y), stageSize: () => [stage.clientWidth, stage.clientHeight],
          sideAt: (x, y) => sideAt({x, y}, false)}};
  resetZoom(false);
  sync();
  draw();
  requestAnimationFrame(() => showIntro());
})();
