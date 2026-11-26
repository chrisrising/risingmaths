// Shape geometry, nets, cube fills and densities. Local units: cm.
(function(){
  const NAMES = {cuboid:'Cuboid', prism:'Triangular prism', pyramid:'Square-based pyramid', cylinder:'Cylinder', custom:'Prism from a 2D shape'};
  const AXIS_NAME = {cuboid:'height', prism:'length', pyramid:'height', cylinder:'height', custom:'length'};
  const LAYER_AXIS = {cuboid:1, prism:2, pyramid:1, cylinder:1, custom:2};
  const DIM_UI = {
    cuboid:[['L','Length'],['W','Width'],['H','Height']],
    prism:[['b','Base of triangle'],['h','Height of triangle'],['L','Length of prism']],
    pyramid:[['a','Base side'],['h','Vertical height']],
    cylinder:[['D','Diameter'],['h','Height']],
    custom:[['L','Length of prism']]
  };
  const DEFAULTS = {cuboid:{L:6,W:4,H:3}, prism:{b:4,h:3,L:6}, pyramid:{a:4,h:5}, cylinder:{D:4,h:6}, custom:{L:6,h:8}, sphere:{r:5,cut:0}};
  // Density in g/cm³ (same number as mg/mm³, and 1000 × kg/m³ ÷ 1000... i.e. kg/m³ = value × 1000)
  const DENSITY = {plastic:1.2, glass:2.5, wood:0.6, brick:1.9, metal:7.85, concrete:2.4};
  const round1 = x => Math.round(x * 10) / 10;

  // Visual cubes. Whole cells inside the shape are one cube. Cells on the boundary
  // are split into 4×4×4 pieces, so the inside pieces are solid and the outside pieces are faded.
  function visualCubes(inside, nx, ny, nz){
    const vIn = [], vOut = [];
    const M = 4, ms = 1 / M;
    for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++){
      const micro = [];
      let n = 0;
      for (let a = 0; a < M; a++) for (let b = 0; b < M; b++) for (let c = 0; c < M; c++){
        const x = i + (a + 0.5) * ms, y = j + (b + 0.5) * ms, z = k + (c + 0.5) * ms;
        const ins = inside(x, y, z);
        if (ins) n++;
        micro.push([x, y, z, ins]);
      }
      // Fill the whole cuboid around the solid with whole cubes. A cube is solid
      // coloured if its centre is inside the shape, and faded blue if not.
      if (inside(i + 0.5, j + 0.5, k + 0.5)) vIn.push([i + 0.5, j + 0.5, k + 0.5, 0.94]);
      else vOut.push([i + 0.5, j + 0.5, k + 0.5, 0.94]);
    }
    return {vIn, vOut};
  }

  // Each net face has its flat points (pts) and the same corners on the solid (p3, in the solid's
  // own cm frame), so the faces can unfold from the solid into the net.
  function netFor(shape, p){
    const F = [];
    const add = (pts, p3, t) => F.push({pts, p3, t});
    const N = 64;
    if (shape === 'cuboid'){
      const L = p.L, W = p.W, H = p.H;
      add([[0,0],[L,0],[L,W],[0,W]], [[0,0,0],[L,0,0],[L,0,W],[0,0,W]], `base ${L} × ${W}`);
      add([[0,-H],[L,-H],[L,0],[0,0]], [[0,H,0],[L,H,0],[L,0,0],[0,0,0]], `front ${L} × ${H}`);
      add([[0,W],[L,W],[L,W+H],[0,W+H]], [[0,0,W],[L,0,W],[L,H,W],[0,H,W]], `back ${L} × ${H}`);
      add([[0,W+H],[L,W+H],[L,2*W+H],[0,2*W+H]], [[0,H,W],[L,H,W],[L,H,0],[0,H,0]], `top ${L} × ${W}`);
      add([[-H,0],[0,0],[0,W],[-H,W]], [[0,H,0],[0,0,0],[0,0,W],[0,H,W]], `side ${W} × ${H}`);
      add([[L,0],[L+H,0],[L+H,W],[L,W]], [[L,0,0],[L,H,0],[L,H,W],[L,0,W]], `side ${W} × ${H}`);
    } else if (shape === 'prism'){
      const b = p.b, h = p.h, L = p.L, c = Math.hypot(b, h);
      add([[0,0],[b,0],[b,L],[0,L]], [[0,0,0],[b,0,0],[b,0,L],[0,0,L]], `base ${b} × ${L}`);
      add([[-h,0],[0,0],[0,L],[-h,L]], [[0,h,0],[0,0,0],[0,0,L],[0,h,L]], `${h} × ${L}`);
      add([[b,0],[b+c,0],[b+c,L],[b,L]], [[b,0,0],[0,h,0],[0,h,L],[b,0,L]], `${round1(c)} × ${L}`);
      add([[0,0],[b,0],[0,-h]], [[0,0,0],[b,0,0],[0,h,0]], `triangle ${b}, ${h}`);
      add([[0,L],[b,L],[0,L+h]], [[0,0,L],[b,0,L],[0,h,L]], `triangle ${b}, ${h}`);
    } else if (shape === 'pyramid'){
      const a = p.a, h = p.h, s = Math.hypot(a/2, h), T = [a/2, h, a/2];
      add([[0,0],[a,0],[a,a],[0,a]], [[0,0,0],[a,0,0],[a,0,a],[0,0,a]], `base ${a} × ${a}`);
      add([[0,0],[a,0],[a/2,-s]], [[0,0,0],[a,0,0],T], `${a} × ${round1(s)}`);
      add([[0,a],[a,a],[a/2,a+s]], [[0,0,a],[a,0,a],T], `${a} × ${round1(s)}`);
      add([[0,0],[0,a],[-s,a/2]], [[0,0,0],[0,0,a],T], `${a} × ${round1(s)}`);
      add([[a,0],[a,a],[a+s,a/2]], [[a,0,0],[a,0,a],T], `${a} × ${round1(s)}`);
    } else {
      // Cylinder: the solid's geometry is centred on (r, ·, r) and runs from y = 0 to y = h.
      const D = p.D, h = p.h, r = D/2, C = Math.PI * D;
      const ang = i => i / N * Math.PI * 2;
      const wall = (a, y) => [r + r * Math.sin(a), y, r + r * Math.cos(a)];
      const side = [], side3 = [];
      for (let i = 0; i <= N; i++){ side.push([C * i / N, 0]); side3.push(wall(ang(i), 0)); }
      for (let i = N; i >= 0; i--){ side.push([C * i / N, h]); side3.push(wall(ang(i), h)); }
      add(side, side3, `side ${round1(C)} × ${h}`);
      // The wall is cut along one vertical seam (point 0). Its rim row indices (sIdx) say where each point sits along the rim.
      const sIdx = [];
      for (let i = 0; i <= N; i++) sIdx.push(i);
      for (let i = N; i >= 0; i--) sIdx.push(i);
      Object.assign(F[F.length - 1], {kind:'wall', ds: C / N, rows: N + 1, sIdx});
      const cap = (cy, y) => {
        const pts = [], p3 = [];
        for (let i = 0; i < N; i++){
          const a = ang(i);
          pts.push([C/2 + r * Math.cos(a), cy + r * Math.sin(a)]);
          p3.push(wall(a, y));
        }
        return {pts, p3};
      };
      const top = cap(h + r, h), bot = cap(-r, 0);
      add(top.pts, top.p3, `top ⌀ ${D}`);
      Object.assign(F[F.length - 1], {kind:'cap'});
      add(bot.pts, bot.p3, `bottom ⌀ ${D}`);
      Object.assign(F[F.length - 1], {kind:'cap'});
    }
    return F;
  }

  function build(shape, p){
    let sx, sy, sz, geo, inside, volume, formula, dimsFn;
    if (shape === 'cuboid'){
      const L = p.L, W = p.W, H = p.H;
      sx = L; sy = H; sz = W;
      geo = new THREE.BoxGeometry(L, H, W);
      geo.translate(L/2, H/2, W/2);
      inside = () => true;
      volume = L * W * H;
      formula = `V = length × width × height = ${L} × ${W} × ${H}`;
      dimsFn = o => [
        {a:[0,0,W], b:[L,0,W], o:[0,-o,o], t:`length ${L} cm`},
        {a:[L,0,0], b:[L,0,W], o:[o,-o,0], t:`width ${W} cm`},
        {a:[0,0,0], b:[0,H,0], o:[-o,0,-o], t:`height ${H} cm`}
      ];
    } else if (shape === 'prism'){
      const b = p.b, h = p.h, L = p.L;
      sx = b; sy = h; sz = L;
      const sh = new THREE.Shape();
      sh.moveTo(0,0); sh.lineTo(b,0); sh.lineTo(0,h); sh.lineTo(0,0);
      geo = new THREE.ExtrudeGeometry(sh, {depth:L, bevelEnabled:false});
      inside = (x,y,z) => x >= 0 && y >= 0 && x/b + y/h <= 1 + 1e-9 && z >= 0 && z <= L;
      volume = 0.5 * b * h * L;
      formula = `V = ½ × base × height × length = ½ × ${b} × ${h} × ${L}`;
      dimsFn = o => [
        {a:[0,0,0], b:[b,0,0], o:[0,-o,-o], t:`base ${b} cm`},
        {a:[0,0,0], b:[0,h,0], o:[-o,0,0], t:`height ${h} cm`},
        {a:[0,0,0], b:[0,0,L], o:[-o,-o,0], t:`length ${L} cm`}
      ];
    } else if (shape === 'pyramid'){
      const a = p.a, h = p.h;
      sx = a; sy = h; sz = a;
      const P0=[0,0,0], P1=[a,0,0], P2=[a,0,a], P3=[0,0,a], A=[a/2,h,a/2];
      const tris = [[P0,P1,P2],[P0,P2,P3],[P0,A,P1],[P1,A,P2],[P2,A,P3],[P3,A,P0]];
      const pos = [], uv = [];
      tris.forEach(t => t.forEach((v, i) => {
        pos.push(v[0], v[1], v[2]);
        uv.push(i === 0 ? 0 : (i === 1 ? 1 : 0.5), i === 2 ? 1 : 0);
      }));
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.computeVertexNormals();
      inside = (x,y,z) => {
        if (y < 0 || y > h) return false;
        const s = (a/2) * (1 - y/h);
        return Math.abs(x - a/2) <= s + 1e-9 && Math.abs(z - a/2) <= s + 1e-9;
      };
      volume = a * a * h / 3;
      formula = `V = ⅓ × base × height = ⅓ × ${a} × ${a} × ${h}`;
      dimsFn = o => [
        {a:[0,0,0], b:[a,0,0], o:[0,-o,-o], t:`base side ${a} cm`},
        {a:[a/2,0,a/2], b:[a/2,h,a/2], o:[o,0,o], t:`height ${h} cm`}
      ];
    } else {
      const D = p.D, h = p.h, r = D/2;
      sx = D; sy = h; sz = D;
      geo = new THREE.CylinderGeometry(r, r, h, 64);
      geo.translate(r, h/2, r);
      inside = (x,y,z) => {
        if (y < 0 || y > h) return false;
        return (x - r)*(x - r) + (z - r)*(z - r) <= r*r + 1e-9;
      };
      volume = Math.PI * r * r * h;
      formula = `V = π × radius² × height = π × ${r}² × ${h}`;
      dimsFn = o => [
        {a:[0,0,r], b:[D,0,r], o:[0,-o,o], t:`diameter ${D} cm`},
        {a:[D,0,0], b:[D,h,0], o:[o,0,-o], t:`height ${h} cm`}
      ];
    }

    const size = [sx, sy, sz];
    const off = Math.max(sx, sy, sz) * 0.06 + 0.8;

    // Cubes cover the whole solid. Centre inside: solid cube. Only touching: faded cube.
    const inCells = [], outCells = [];
    const nx = Math.round(sx), ny = Math.round(sy), nz = Math.round(sz);
    const samp = [0.125, 0.375, 0.625, 0.875];
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++)
        for (let i = 0; i < nx; i++){
          const cx = i + 0.5, cy = j + 0.5, cz = k + 0.5;
          if (inside(cx, cy, cz)){ inCells.push([cx, cy, cz]); continue; }
          let touches = false;
          for (const dx of samp) for (const dy of samp) for (const dz of samp){
            if (!touches && inside(i + dx, j + dy, k + dz)) touches = true;
          }
          if (touches) outCells.push([cx, cy, cz]);
        }

    const vis = visualCubes(inside, nx, ny, nz);
    const net = netFor(shape, p);
    let area = 0;
    net.forEach(f => {
      let s = 0;
      for (let i = 0; i < f.pts.length; i++){
        const q = f.pts[i], r2 = f.pts[(i + 1) % f.pts.length];
        s += q[0] * r2[1] - r2[0] * q[1];
      }
      area += Math.abs(s) / 2;
    });

    return {size, geo, volume, formula, dims: dimsFn(off), inCells, outCells, visIn: vis.vIn, visOut: vis.vOut, net, area: round1(area), name: NAMES[shape], shape};
  }

  // A prism whose cross-section is any flat polygon (pts in cm), extruded along z by L.
  // Positive when the outline runs anticlockwise. Its sign gives each side's outward direction,
  // which beats measuring from the middle: on a dented outline the middle can sit outside the shape.
  function signedArea(P){
    let s = 0;
    for (let i = 0; i < P.length; i++){
      const a = P[i], b = P[(i+1) % P.length];
      s += a[0]*b[1] - b[0]*a[1];
    }
    return s / 2;
  }
  function polyArea(P){
    let s = 0;
    for (let i = 0; i < P.length; i++){
      const a = P[i], b = P[(i+1) % P.length];
      s += a[0]*b[1] - b[0]*a[1];
    }
    return Math.abs(s) / 2;
  }
  function pointInPoly(P, x, y){
    let c = false;
    for (let i = 0, j = P.length-1; i < P.length; j = i++){
      const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj-xi)*(y-yi)/(yj-yi) + xi)) c = !c;
    }
    return c;
  }
  function buildCustom(pts0, L, name){
    const mx = Math.min(...pts0.map(p => p[0])), my = Math.min(...pts0.map(p => p[1]));
    const P = pts0.map(p => [p[0] - mx, p[1] - my]);
    let W = 0, H = 0;
    P.forEach(p => { W = Math.max(W, p[0]); H = Math.max(H, p[1]); });
    const sh = new THREE.Shape(P.map(p => new THREE.Vector2(p[0], p[1])));
    const geo = new THREE.ExtrudeGeometry(sh, {depth:L, bevelEnabled:false});
    const inside = (x, y, z) => z >= 0 && z <= L && pointInPoly(P, x, y);
    const samp = [0.125, 0.375, 0.625, 0.875];
    const inCells = [], outCells = [];
    const nx = Math.round(W), ny = Math.round(H), nz = Math.round(L);
    for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++){
      const cx = i + 0.5, cy = j + 0.5, cz = k + 0.5;
      if (inside(cx, cy, cz)){ inCells.push([cx, cy, cz]); continue; }
      let touch = false;
      for (const dx of samp) for (const dy of samp) for (const dz of samp){
        if (!touch && inside(i + dx, j + dy, k + dz)) touch = true;
      }
      if (touch) outCells.push([cx, cy, cz]);
    }
    const vis = visualCubes(inside, nx, ny, nz);
    const area2 = polyArea(P);
    const off = Math.max(W, H, L) * 0.06 + 0.8;
    const dims = [
      {a:[0,0,0], b:[W,0,0], o:[0,-off,-off], t:`width ${round1(W)} cm`},
      {a:[0,0,0], b:[0,H,0], o:[-off,0,0], t:`height ${round1(H)} cm`},
      {a:[0,0,0], b:[0,0,L], o:[-off,-off,0], t:`length ${round1(L)} cm`}
    ];
    // Net: side faces in a strip, two end faces above and below.
    const net = [];
    let u = 0;
    const n = P.length;
    for (let i = 0; i < n; i++){
      const a = P[i], b = P[(i+1) % n];
      const len = Math.hypot(b[0]-a[0], b[1]-a[1]);
      net.push({pts:[[u,0],[u+len,0],[u+len,L],[u,L]],
        p3:[[a[0],a[1],0],[b[0],b[1],0],[b[0],b[1],L],[a[0],a[1],L]],
        t: n > 8 ? '' : `side ${round1(len)} × ${round1(L)}`});
      u += len;
    }
    // The two end faces hinge on the first side face's top edge (z = L) and bottom edge (z = 0), so
    // the net stays in one piece. Each end face lies outside the strip: its first edge lies along the
    // hinge and its interior is pushed away from the strip (above for the top, below for the bottom).
    const e0 = [P[1][0] - P[0][0], P[1][1] - P[0][1]];
    const len0 = Math.hypot(e0[0], e0[1]) || 1;
    const eu = [e0[0] / len0, e0[1] / len0];
    // Into the shape from its first side: to the left of that side when the outline runs anticlockwise.
    const wind = signedArea(P) >= 0 ? 1 : -1;
    const nrm = [-eu[1] * wind, eu[0] * wind];
    const endFlat = (yBase, sgn) => P.map(p => {
      const dx = p[0] - P[0][0], dy = p[1] - P[0][1];
      return [dx * eu[0] + dy * eu[1], yBase + sgn * (dx * nrm[0] + dy * nrm[1])];
    });
    net.push({pts:endFlat(L, 1), p3:P.map(p => [p[0], p[1], L]), t: 'end face'});
    net.push({pts:endFlat(0, -1), p3:P.map(p => [p[0], p[1], 0]), t: 'end face'});
    let areaNet = 0;
    net.forEach(f => {
      let s = 0;
      for (let i = 0; i < f.pts.length; i++){
        const q = f.pts[i], r2 = f.pts[(i + 1) % f.pts.length];
        s += q[0] * r2[1] - r2[0] * q[1];
      }
      areaNet += Math.abs(s) / 2;
    });
    return {size:[W, H, L], geo, volume: area2 * L, formula: `V = cross-section area × length = ${round1(area2)} × ${round1(L)}`,
      dims, inCells, outCells, visIn: vis.vIn, visOut: vis.vOut, net, area: round1(areaNet), name, shape:'custom'};
  }

  // Where each point of a net face is part way through the unfold (t: 0 = on the solid, 1 = flat).
  // Polygons move point by point. A cylinder wall is pulled open from its seam: each rim point keeps
  // its distance along the rim, and the rim straightens as the net opens. A cap moves as one rigid disc.
  const CAP_TURN = () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 1, 1).normalize(), 2 * Math.PI / 3);
  function unfoldPoints(f, t){
    const out = [];
    if (f.kind === 'wall'){
      // The rim bends at a constant rate (1 - t) / r, so it is an exact arc: from the circle at t = 0 to a straight line at t = 1.
      const N = f.rows - 1, r = f.ds * N / (2 * Math.PI), kap = (1 - t) / r;
      const along = s => kap > 1e-9 ? [Math.sin(kap * s) / kap, (Math.cos(kap * s) - 1) / kap] : [s, 0];
      const o = [0, 1, 2].map(k => f.p3[0][k] + (f.flat[0][k] - f.p3[0][k]) * t);
      for (let k = 0; k < f.n; k++){
        const i = f.sIdx[k];
        const [dx, dz] = along(i * f.ds);
        const y = f.p3[k][1] + (f.flat[k][1] - f.p3[k][1]) * t;
        out.push([o[0] + dx, y, o[2] + dz]);
      }
      return out;
    }
    if (f.kind === 'cap'){
      const c3 = new THREE.Vector3(), cf = new THREE.Vector3();
      f.p3.forEach(p => c3.add(new THREE.Vector3(p[0], p[1], p[2])));
      f.flat.forEach(p => cf.add(new THREE.Vector3(p[0], p[1], p[2])));
      c3.divideScalar(f.n); cf.divideScalar(f.n);
      const c = c3.clone().lerp(cf, t);
      const q = new THREE.Quaternion().slerp(CAP_TURN(), t);
      f.p3.forEach(p => {
        const v = new THREE.Vector3(p[0] - c3.x, p[1] - c3.y, p[2] - c3.z).applyQuaternion(q).add(c);
        out.push([v.x, v.y, v.z]);
      });
      return out;
    }
    return f.p3.map((a, k) => [0, 1, 2].map(j => a[j] + (f.flat[k][j] - a[j]) * t));
  }

  // Side-length labels for a net. Faces that join along an edge of the same length form one run,
  // and each run is labelled once: a shared edge is not labelled twice, and a length is not repeated
  // along a strip of faces. Points are returned in the net's own coordinates, shifted by (cu, cv).
  function labelEdges(faces, cu, cv){
    const parent = new Map();
    const find = x => {
      if (!parent.has(x)) parent.set(x, x);
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      parent.set(x, r);
      return r;
    };
    const hinges = new Map(), edges = [];
    faces.forEach((f, fi) => {
      const n = f.pts.length;
      if (n > 8) return;
      for (let i = 0; i < n; i++){
        const j = (i + 1) % n;
        const a = f.pts[i], b = f.pts[j];
        const L = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 10) / 10;
        const node = L + '|' + fi;
        find(node);
        const ka = f.p3[i].map(v => v.toFixed(3)).join(','), kb = f.p3[j].map(v => v.toFixed(3)).join(',');
        const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        if (hinges.has(key)) parent.set(find(hinges.get(key)), find(node));
        else hinges.set(key, node);
        edges.push({node, L, x: (a[0] + b[0]) / 2 - cu, y: (a[1] + b[1]) / 2 - cv});
      }
    });
    const done = new Set(), out = [];
    edges.forEach(e => {
      const r = find(e.node);
      if (done.has(r)) return;
      done.add(r);
      out.push({x: e.x, y: e.y, L: e.L});
    });
    return out;
  }

  // Counts whole cubes inside and on the boundary of a shape, as buildCustom does.
  function cellsOf(inside, nx, ny, nz){
    const inCells = [], outCells = [];
    const samp = [0.125, 0.375, 0.625, 0.875];
    for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++){
      const cx = i + 0.5, cy = j + 0.5, cz = k + 0.5;
      if (inside(cx, cy, cz)){ inCells.push([cx, cy, cz]); continue; }
      let touch = false;
      for (const dx of samp) for (const dy of samp) for (const dz of samp){
        if (!touch && inside(i + dx, j + dy, k + dz)) touch = true;
      }
      if (touch) outCells.push([cx, cy, cz]);
    }
    return {inCells, outCells};
  }

  // Pyramid on a drawn shape. The shape is the base, lying flat on y = 0 (x across, z front to back).
  // The apex sits over the centre of all the points, at height h.
  function buildCustomPyramid(pts0, h, name){
    const mx = Math.min(...pts0.map(p => p[0])), my = Math.min(...pts0.map(p => p[1]));
    const P = pts0.map(p => [p[0] - mx, p[1] - my]);
    const n = P.length;
    let W = 0, D = 0;
    P.forEach(p => { W = Math.max(W, p[0]); D = Math.max(D, p[1]); });
    const cx = P.reduce((t, p) => t + p[0], 0) / n, cz = P.reduce((t, p) => t + p[1], 0) / n;
    const B = P.map(p => [p[0], 0, p[1]]);
    const apex = [cx, h, cz];
    const ref = [cx, h / 3, cz];   // a point inside the solid, used to orient the faces
    const pos = [];
    const tri = (a, b, c) => {
      const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
      const nr = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
      const m = [(a[0]+b[0]+c[0])/3, (a[1]+b[1]+c[1])/3, (a[2]+b[2]+c[2])/3];
      const out = nr[0]*(m[0]-ref[0]) + nr[1]*(m[1]-ref[1]) + nr[2]*(m[2]-ref[2]);
      if (out < 0) pos.push(...a, ...c, ...b); else pos.push(...a, ...b, ...c);
    };
    THREE.ShapeUtils.triangulateShape(P.map(p => new THREE.Vector2(p[0], p[1])), [])
      .forEach(t => tri(B[t[0]], B[t[1]], B[t[2]]));                   // base, concave outlines included
    for (let i = 0; i < n; i++) tri(B[i], B[(i + 1) % n], apex);        // sides
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const inside = (x, y, z) => {
      if (y < 0 || y > h) return false;
      const s = 1 - y / h;
      if (s <= 1e-9) return false;
      return pointInPoly(P, cx + (x - cx) / s, cz + (z - cz) / s);
    };
    const cells = cellsOf(inside, Math.round(W), Math.round(h), Math.round(D));
    const vis = visualCubes(inside, Math.round(W), Math.round(h), Math.round(D));
    const area2 = polyArea(P);
    let sides = 0;
    for (let i = 0; i < n; i++){
      const a = P[i], b = P[(i + 1) % n];
      const len = Math.hypot(b[0]-a[0], b[1]-a[1]) || 1;
      const d = Math.abs((b[0]-a[0])*(cz-a[1]) - (b[1]-a[1])*(cx-a[0])) / len;   // distance from the apex's foot to the side
      sides += 0.5 * len * Math.sqrt(h*h + d*d);
    }
    // Flat faces for the surface grid (not an unfolding net): the base as drawn, and each side triangle
    // laid out outward from its base edge. Each flat face keeps its 3D corners on the solid.
    // The grid on each face starts at the base: the base face from its first corner along its first edge,
    // and each side from its base edge, so the squares stand on the base.
    const wind = signedArea(P) >= 0 ? 1 : -1;
    const e0 = Math.hypot(P[1][0]-P[0][0], P[1][1]-P[0][1]) || 1;
    const u0x = (P[1][0]-P[0][0]) / e0, u0z = (P[1][1]-P[0][1]) / e0;
    const surf = [{pts: P.map(p => [p[0], p[1]]), p3: B.map(q => [q[0], q[1], q[2]]),
      uv: P.map(p => [(p[0]-P[0][0])*u0x + (p[1]-P[0][1])*u0z, -(p[0]-P[0][0])*u0z + (p[1]-P[0][1])*u0x])}];
    // A dented outline has a corner that turns back on itself. Folding both of its sides out
    // around that corner would lay one on top of the other, so those sides go in a row underneath
    // the base instead. An outline with no dent keeps each side folded out from its own edge.
    let dented = false;
    for (let i = 0; i < n && !dented; i++){
      const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
      if (((b[0]-a[0])*(c[1]-b[1]) - (b[1]-a[1])*(c[0]-b[0])) * wind < -1e-9) dented = true;
    }
    // The row is centred under the base, so the whole picture sits together on screen.
    let perimP = 0;
    for (let i = 0; i < n; i++) perimP += Math.hypot(P[(i+1) % n][0]-P[i][0], P[(i+1) % n][1]-P[i][1]);
    let row = W / 2 - perimP / 2;
    for (let i = 0; i < n; i++){
      const Pi = P[i], Pj = P[(i + 1) % n], Bi = B[i], Bj = B[(i + 1) % n];
      const e = Math.hypot(Pj[0]-Pi[0], Pj[1]-Pi[1]) || 1;
      const l1 = Math.hypot(apex[0]-Bi[0], apex[1]-Bi[1], apex[2]-Bi[2]);
      const l2 = Math.hypot(apex[0]-Bj[0], apex[1]-Bj[1], apex[2]-Bj[2]);
      const x = (e*e + l1*l1 - l2*l2) / (2*e), yy = Math.sqrt(Math.max(0, l1*l1 - x*x));
      let flat;
      if (dented){
        const yb = -1;   // the base sits at y >= 0, so the row clears it
        flat = [[row, yb], [row + e, yb], [row + x, yb - yy]];
        row += e;
      } else {
        const ux = (Pj[0]-Pi[0]) / e, uz = (Pj[1]-Pi[1]) / e;
        // Away from the shape, from the way round the outline goes.
        const nx = uz * wind, nz = -ux * wind;
        flat = [[Pi[0], Pi[1]], [Pj[0], Pj[1]], [Pi[0] + ux*x + nx*yy, Pi[1] + uz*x + nz*yy]];
      }
      surf.push({pts: flat, p3: [Bi, Bj, apex], uv: [[0, 0], [e, 0], [x, yy]]});
    }
    const off = Math.max(W, h, D) * 0.06 + 0.8;
    const dims = [
      {a:[0,0,0], b:[W,0,0], o:[0,-off,-off], t:`width ${round1(W)} cm`},
      {a:[0,0,0], b:[0,h,0], o:[-off,0,0], t:`height ${round1(h)} cm`},
      {a:[0,0,0], b:[0,0,D], o:[-off,-off,0], t:`length ${round1(D)} cm`}
    ];
    return {size:[W, h, D], geo, volume: area2 * h / 3, formula: `V = ⅓ × base × height = ⅓ × ${round1(area2)} × ${round1(h)}`,
      dims, inCells: cells.inCells, outCells: cells.outCells, visIn: vis.vIn, visOut: vis.vOut, net: null, surf,
      area: round1(area2 + sides), name, shape:'custom'};
  }

  // A sphere with a wedge cut away around the vertical axis. cut is in degrees: 0 is the whole sphere,
  // 180 is a half (a hemisphere). The wedge is cut from the front (the +z side).
  function buildSphere(p){
    const r = p.r, cut = Math.max(0, Math.min(180, p.cut || 0)), hemi = !!p.hemi;
    const c = r;                                  // the centre across x and z
    const cy = hemi ? 0 : r;                      // a hemisphere sits on its flat base, so its centre is on the base
    const a0 = (cut / 2) * Math.PI / 180, a1 = 2 * Math.PI - a0;
    const tMax = hemi ? Math.PI / 2 : Math.PI;    // a hemisphere keeps only the top half (t from the top)
    const NT = hemi ? 20 : 40, NA = Math.max(8, Math.round(64 * (a1 - a0) / (2 * Math.PI)));
    // t: angle down from the top; a: angle round the vertical axis, measured from +z.
    const at = (t, a) => [c + r * Math.sin(t) * Math.sin(a), cy + r * Math.cos(t), c + r * Math.sin(t) * Math.cos(a)];
    const pos = [];
    const tri = (a, b, cc, refOf) => {
      const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], v = [cc[0]-a[0], cc[1]-a[1], cc[2]-a[2]];
      const nr = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
      const m = [(a[0]+b[0]+cc[0])/3, (a[1]+b[1]+cc[1])/3, (a[2]+b[2]+cc[2])/3];
      const rf = refOf(m);
      if (nr[0]*rf[0] + nr[1]*rf[1] + nr[2]*rf[2] < 0) pos.push(...a, ...cc, ...b); else pos.push(...a, ...b, ...cc);
    };
    const fromCentre = m => [m[0]-c, m[1]-cy, m[2]-c];
    for (let i = 0; i < NT; i++) for (let j = 0; j < NA; j++){
      const t0 = tMax * i / NT, t1 = tMax * (i + 1) / NT;
      const q0 = a0 + (a1 - a0) * j / NA, q1 = a0 + (a1 - a0) * (j + 1) / NA;
      const p00 = at(t0, q0), p01 = at(t0, q1), p10 = at(t1, q0), p11 = at(t1, q1);
      tri(p00, p10, p11, fromCentre);
      tri(p00, p11, p01, fromCentre);
    }
    const O = [c, cy, c];
    // The flat base of a hemisphere: a disc on the bottom, facing down.
    if (hemi){
      for (let j = 0; j < NA; j++){
        const q0 = a0 + (a1 - a0) * j / NA, q1 = a0 + (a1 - a0) * (j + 1) / NA;
        tri(O, at(Math.PI / 2, q0), at(Math.PI / 2, q1), () => [0, -1, 0]);
      }
    }
    // The two cut faces: half-discs through the centre line, facing into the removed wedge.
    if (cut > 0){
      const capRef0 = () => [-Math.cos(a0), 0, Math.sin(a0)];
      const capRef1 = () => [Math.cos(a1), 0, -Math.sin(a1)];
      for (let i = 0; i < NT; i++){
        tri(O, at(tMax * i / NT, a0), at(tMax * (i + 1) / NT, a0), capRef0);
        tri(O, at(tMax * i / NT, a1), at(tMax * (i + 1) / NT, a1), capRef1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const inside = (x, y, z) => {
      const dx = x - c, dy = y - cy, dz = z - c;
      if (dx*dx + dy*dy + dz*dz > r*r) return false;
      if (hemi && dy < 0) return false;                       // below the flat base
      return Math.abs(Math.atan2(dx, dz)) >= a0 - 1e-9;       // outside the removed wedge
    };
    const Nx = Math.round(2 * r), Ny = hemi ? Math.round(r) : Math.round(2 * r);
    const cells = cellsOf(inside, Nx, Ny, Nx);
    const vis = visualCubes(inside, Nx, Ny, Nx);
    const off = 2 * r * 0.06 + 0.8;
    const dims = [{a:[0,cy,0], b:[2*r,cy,0], o:[0,-off,-off], t:`diameter ${round1(2*r)} cm`}];
    if (hemi) dims.push({a:[0,0,0], b:[0,r,0], o:[-off,0,0], t:`height ${round1(r)} cm`});
    const frac = 1 - cut / 360;
    const curved = (hemi ? 2 : 4) * Math.PI * r * r * frac;
    const base = hemi ? Math.PI * r * r * frac : 0;
    const caps = cut > 0 ? (hemi ? Math.PI * r * r / 2 : Math.PI * r * r) : 0;
    const volK = hemi ? 2 / 3 : 4 / 3;
    return {size:[2*r, hemi ? r : 2*r, 2*r], geo, volume: volK * Math.PI * r*r*r * frac,
      formula: `V = ${hemi ? '2/3' : '4/3'} × π × ${round1(r)}³${cut > 0 ? ' × ' + round1(frac) : ''}`,
      dims, inCells: cells.inCells, outCells: cells.outCells, visIn: vis.vIn, visOut: vis.vOut, net: null,
      area: round1(curved + base + caps), name: hemi ? 'Hemisphere' : 'Sphere', shape:'sphere'};
  }

  window.SolidGeo = {NAMES, AXIS_NAME, LAYER_AXIS, DIM_UI, DEFAULTS, DENSITY, netFor, build, buildCustom, buildCustomPyramid, buildSphere, unfoldPoints, labelEdges};
})();
