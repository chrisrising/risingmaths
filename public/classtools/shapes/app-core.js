// Scene, solids, layers, nets, units, density and conversion scenes.
(function(){
  const G = window.SolidGeo;
  const $ = id => document.getElementById(id);
  const canvas = $('c'), stage = $('stage'), labelBox = $('labels'), info = $('info');

  const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 2000);
  const root = new THREE.Group();
  scene.add(root);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(10, 20, 15);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-12, 8, -10);
  scene.add(fill);

  function makeTex(draw){
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    draw(g);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const TEX = {
    wood: makeTex(g => {
      g.fillStyle = '#b98352'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 70; i++){
        const y = Math.random() * 256;
        g.strokeStyle = `rgba(90,50,20,${0.1 + Math.random() * 0.3})`;
        g.lineWidth = 1 + Math.random() * 2.5;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(80, y + Math.random() * 10 - 5, 170, y + Math.random() * 10 - 5, 256, y);
        g.stroke();
      }
    }),
    brick: makeTex(g => {
      g.fillStyle = '#d6cfc2'; g.fillRect(0, 0, 256, 256);
      for (let r = 0; r < 8; r++){
        const off = r % 2 ? 32 : 0;
        for (let c = -1; c < 5; c++){
          g.fillStyle = `rgb(${Math.floor(150 + Math.random() * 30)},${Math.floor(70 + Math.random() * 20)},55)`;
          g.fillRect(c * 64 + off + 2, r * 32 + 2, 60, 28);
        }
      }
    }),
    concrete: makeTex(g => {
      g.fillStyle = '#9ca3af'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2500; i++){
        const v = Math.floor(120 + Math.random() * 80);
        g.fillStyle = `rgba(${v},${v},${v},0.6)`;
        g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
      }
    })
  };

  const CUBE_COLOUR = 0xfcd34d;
  const MATS = {
    solid: new THREE.MeshStandardMaterial({color:0x3b82f6, roughness:0.5, side:THREE.DoubleSide}),
    plastic: new THREE.MeshStandardMaterial({color:0x3b82f6, roughness:0.5, side:THREE.DoubleSide}),
    glass: new THREE.MeshStandardMaterial({color:0x38bdf8, roughness:0.15, transparent:true, opacity:0.3, depthWrite:false, side:THREE.DoubleSide}),
    ghost: new THREE.MeshStandardMaterial({color:0x94a3b8, transparent:true, opacity:0.12, depthWrite:false, side:THREE.DoubleSide}),
    metal: new THREE.MeshPhongMaterial({color:0x8f99a6, specular:0x555555, shininess:40, side:THREE.DoubleSide}),
    wood: new THREE.MeshStandardMaterial({map:TEX.wood, roughness:0.8, side:THREE.DoubleSide}),
    brick: new THREE.MeshStandardMaterial({map:TEX.brick, roughness:0.9, side:THREE.DoubleSide}),
    concrete: new THREE.MeshStandardMaterial({map:TEX.concrete, roughness:0.95, side:THREE.DoubleSide}),
    cubes: new THREE.MeshStandardMaterial({color:CUBE_COLOUR, roughness:0.4}),
    cubesHi: new THREE.MeshStandardMaterial({color:0xc2410c, roughness:0.5}),
    cubesOut: new THREE.MeshStandardMaterial({color:0xffffff ^ CUBE_COLOUR, transparent:true, opacity:0.25, depthWrite:false, roughness:0.4})
  };
  // ---- Shader for whole cubes: each point on a cube is solid colour if it is inside the
  // solid, and faded if it is outside. The inside test runs per pixel from the shape's uniforms.
  const SHADE_VERT = `
    varying vec3 vLocal;
    varying vec3 vN;
    varying vec3 vBox;
    void main(){
      vec4 lp = vec4(position, 1.0);
      vec3 n = normal;
      #ifdef USE_INSTANCING
        lp = instanceMatrix * lp;
        n = mat3(instanceMatrix) * normal;
      #endif
      vLocal = lp.xyz;
      vBox = position;
      vN = n;
      gl_Position = projectionMatrix * modelViewMatrix * lp;
    }`;
  const SHADE_FRAG = `
    uniform vec3 uCol;
    uniform vec3 uOutCol;
    uniform float uOutAlpha;
    uniform int uType;
    uniform float uDepth;
    uniform vec2 uP;
    uniform vec2 uC;
    uniform int uN;
    uniform vec2 uA[64];
    uniform vec2 uB[64];
    uniform vec3 uLight;
    uniform vec3 uEdge;
    varying vec3 vBox;
    varying vec3 vLocal;
    varying vec3 vN;
    bool inside(vec3 p){
      if (uType == 1){
        if (p.z < 0.0 || p.z > uDepth) return false;
        bool c = false;
        for (int i = 0; i < 64; i++){
          if (i >= uN) break;
          vec2 a = uA[i];
          vec2 b = uB[i];
          if (((a.y > p.y) != (b.y > p.y)) && (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)) c = !c;
        }
        return c;
      }
      if (uType == 5){
        // A sphere: centre at (uP-free) (r, cy, r) with cy = uC.y; a hemisphere keeps only y >= cy (uC.x = 1);
        // the wedge is removed where |atan(x, z)| < uP.y (the cut half-angle).
        float r = uP.x;
        vec3 d = p - vec3(r, uC.y, r);
        if (dot(d, d) > r * r) return false;
        if (uC.x > 0.5 && d.y < 0.0) return false;
        return abs(atan(d.x, d.z)) >= uP.y - 1e-6;
      }
      if (uType == 4){
        // A pyramid on a drawn base: each horizontal slice is the base shrunk towards the apex's foot.
        float h = uP.y;
        if (p.y < 0.0 || p.y > h) return false;
        float s = 1.0 - p.y / h;
        if (s <= 0.0) return false;
        vec2 q = uC + (p.xz - uC) / s;
        bool c = false;
        for (int i = 0; i < 64; i++){
          if (i >= uN) break;
          vec2 a = uA[i];
          vec2 b = uB[i];
          if (((a.y > q.y) != (b.y > q.y)) && (q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x)) c = !c;
        }
        return c;
      }
      if (uType == 2){
        float a = uP.x, h = uP.y;
        if (p.y < 0.0 || p.y > h) return false;
        float s = (a * 0.5) * (1.0 - p.y / h);
        return abs(p.x - a * 0.5) <= s && abs(p.z - a * 0.5) <= s;
      }
      if (uType == 3){
        float r = uP.x, h = uP.y;
        if (p.y < 0.0 || p.y > h) return false;
        vec2 d = p.xz - vec2(r, r);
        return dot(d, d) <= r * r;
      }
      return true;
    }
    void main(){
      bool ins = inside(vLocal);
      float shade = 0.8 + 0.2 * max(dot(normalize(vN), normalize(uLight)), 0.0);
      // Thin dark edges where two coordinates sit at the cube's border.
      vec3 ab = abs(vBox);
      float edge = step(0.47, ab.x) + step(0.47, ab.y) + step(0.47, ab.z);
      if (edge >= 2.0){ gl_FragColor = vec4(uEdge, ins ? 1.0 : 0.6); return; }
      if (ins) gl_FragColor = vec4(uCol * shade, 1.0);
      else gl_FragColor = vec4(uOutCol * shade, uOutAlpha);
    }`;
  function shadeMat(col, outCol, alpha){
    const arr = () => Array.from({length:64}, () => new THREE.Vector2());
    return new THREE.ShaderMaterial({
      uniforms:{
        uCol:{value:new THREE.Color(col)}, uOutCol:{value:new THREE.Color(outCol)}, uOutAlpha:{value:alpha},
        uType:{value:1}, uDepth:{value:1}, uP:{value:new THREE.Vector2()}, uC:{value:new THREE.Vector2()}, uN:{value:0},
        uA:{value:arr()}, uB:{value:arr()}, uLight:{value:new THREE.Vector3(0.5, 0.8, 0.6).normalize()}, uEdge:{value:new THREE.Color(0x374151)}
      },
      vertexShader: SHADE_VERT,
      fragmentShader: SHADE_FRAG,
      transparent: true
    });
  }
  MATS.shadeCube = shadeMat(CUBE_COLOUR, 0x5b7fb0, 0.35);
  MATS.shadeHi = shadeMat(0xc2410c, 0x5b7fb0, 0.35);

  // Which shape the shader should test against, in the same local coordinates as the cubes.
  function shaderSpec(){
    const d = S.dims[S.shape];
    if (S.shape === 'cuboid') return {type:1, pts:[[0,0],[d.L,0],[d.L,d.H],[0,d.H]], depth:d.W};
    if (S.shape === 'prism') return {type:1, pts:[[0,0],[d.b,0],[0,d.h]], depth:d.L};
    if (S.shape === 'custom'){
      const mx = Math.min(...S.custom.pts.map(p => p[0])), my = Math.min(...S.custom.pts.map(p => p[1]));
      const Q = S.custom.pts.map(p => [p[0] - mx, p[1] - my]);
      if (S.custom.kind === 'pyramid'){
        // The base outline tapers to the apex above its centroid.
        const cx = Q.reduce((t, q) => t + q[0], 0) / Q.length, cz = Q.reduce((t, q) => t + q[1], 0) / Q.length;
        return {type:4, pts:Q, p:[0, S.dims.custom.h], c:[cx, cz]};
      }
      return {type:1, pts:Q, depth:S.dims.custom.L};
    }
    if (S.shape === 'pyramid') return {type:2, p:[d.a, d.h]};
    if (S.shape === 'sphere') return {type:5, p:[d.r, (d.cut / 2) * Math.PI / 180], c:[d.hemi ? 1 : 0, d.hemi ? 0 : d.r]};
    return {type:3, p:[d.D / 2, d.h]};
  }
  function applyShape(spec){
    [MATS.shadeCube, MATS.shadeHi].forEach(m => {
      const u = m.uniforms;
      u.uType.value = spec.type;
      u.uDepth.value = spec.depth || 0;
      u.uP.value.set(spec.p ? spec.p[0] : 0, spec.p ? spec.p[1] : 0);
      u.uC.value.set(spec.c ? spec.c[0] : 0, spec.c ? spec.c[1] : 0);
      const pts = spec.pts || [[0,0]];
      const n = Math.min(pts.length, 64);
      u.uN.value = n;
      for (let i = 0; i < 64; i++){
        const a = pts[i % n], b = pts[(i + 1) % n];
        u.uA.value[i].set(a[0], a[1]);
        u.uB.value[i].set(b[0], b[1]);
      }
    });
  }

  const NET_PALETTE = ['#fca5a5','#fdba74','#fde68a','#86efac','#93c5fd','#c4b5fd'];
  const LINE = new THREE.LineBasicMaterial({color:0x1e293b});
  // Wide lines, in screen pixels. Plain WebGL lines are always one pixel whatever width is asked
  // for, which is far too faint on a whiteboard, so edges and net outlines are drawn as ribbons.
  // resolution is kept in step with the canvas size by the resize handler in app-ui.
  const FAT = [];
  function fatLine(width, colour, offset){
    const m = new THREE.LineMaterial({color:colour, linewidth:width, worldUnits:false,
      polygonOffset:!!offset, polygonOffsetFactor:-4, polygonOffsetUnits:-4});
    m.resolution.set(window.innerWidth, window.innerHeight);
    FAT.push(m);
    return m;
  }
  // The solid's own edges, and the outside edge of each face in the net. Both are drawn well
  // thicker than the surface-area squares inside a face, so a face still reads as one face.
  const EDGE_FAT = fatLine(4, 0x0f172a, true);
  const NET_FAT = fatLine(5, 0x0f172a, true);
  function setLineResolution(w, h){ FAT.forEach(m => m.resolution.set(w, h)); }
  const DIMLINE = new THREE.LineBasicMaterial({color:0x1d4ed8});

  const S = {
    shape:'cuboid', dims: JSON.parse(JSON.stringify(G.DEFAULTS)),
    mode:'solid', mat:'plastic', showDims:false, showVol:false, unfold:0, showSurf:false,
    unit:'cm', conv:'off', showPanel:false, pShow:{mass:true, density:true, volume:true}
  };

  // ---------- units ----------
  const LEN_F = {cm:1, mm:10, m:0.01};
  const VOL_F = {cm:1, mm:1000, m:1e-6};
  const VOL_U = {cm:'cm³', mm:'mm³', m:'m³'};
  const MASS_U = {cm:'g', mm:'mg', m:'kg'};
  const DENS_U = {cm:'g/cm³', mm:'mg/mm³', m:'kg/m³'};
  const fmt = x => Number(x.toFixed(3)).toLocaleString('en-GB', {maximumFractionDigits:3});
  // Convert any "N cm" or bare number in a label to the chosen unit.
  function convertText(t, withUnit){
    return t.replace(/(\d+(?:\.\d+)?)(\s?cm)?/g, (m, n, u) =>
      fmt(parseFloat(n) * LEN_F[S.unit]) + (u && withUnit ? ' ' + S.unit : ''));
  }
  const matKey = () => S.conv !== 'off' ? 'plastic' : (S.mode === 'material' ? S.mat : (S.mode === 'translucent' ? 'glass' : 'plastic'));
  const density = () => G.DENSITY[matKey()];
  // Density is g/cm³. Mass and volume are converted from cm-based values.
  function massDisplay(dens, volCm3){
    const g = dens * volCm3;
    if (S.unit === 'cm') return fmt(g) + ' g';
    if (S.unit === 'mm') return fmt(g * 1000) + ' mg';
    return fmt(g / 1000) + ' kg';
  }
  function densityDisplay(dens){
    if (S.unit === 'm') return fmt(dens * 1000) + ' kg/m³';
    return fmt(dens) + ' ' + DENS_U[S.unit];
  }

  // ---------- labels ----------
  let dimLabels = [], netLabels = [], convLabels = [], edgeLabels = [];
  // One entry per edge label: the places it could sit (one per matching edge of the solid), and the
  // label itself. Each frame it is put on whichever of those edges is nearest the viewer.
  let edgeSpecs = [];
  const netHeight = [];   // the height lines drawn inside the net's triangles, shown with the net labels
  function addLabel(list, obj, x, y, z, text, cls){
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    labelBox.appendChild(el);
    list.push({obj, p:new THREE.Vector3(x, y, z), el});
  }

  // ---------- solid ----------
  let content = null, solid = null, edges = null, dimLines = null;
  let cubesIn = null, cubesOut = null, netRoot = null, netFaces = [], netSpan = 10;
  let dimSpecs = [];   // one entry per dimension: its ends, its offset, its size and its label
  let current = null, cubeReveal = 1, layers = [], layerStep = 0;
  let convGroup = null, refGroup = null, refKey = '';
  const refLabels = [];

  // The grid tile is one cm, so a face's texture coordinates (its cm positions) give unit squares.
  const GRID_TEX = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(30,41,59,0.45)';
    g.lineWidth = 2;
    g.strokeRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  })();
  const GRID_MAT = new THREE.MeshBasicMaterial({map:GRID_TEX, transparent:true, depthWrite:false, side:THREE.DoubleSide,
    polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2});
  const r1 = x => Math.round(x * 10) / 10;
  function flatArea(P){
    let s = 0;
    for (let i = 0; i < P.length; i++){ const a = P[i], b = P[(i+1) % P.length]; s += a[0]*b[1] - b[0]*a[1]; }
    return Math.abs(s) / 2;
  }
  function flatPerim(P){
    let s = 0;
    for (let i = 0; i < P.length; i++){ const a = P[i], b = P[(i+1) % P.length]; s += Math.hypot(b[0]-a[0], b[1]-a[1]); }
    return s;
  }

  function makeCubeMesh(list, mat){
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    list.forEach((c, i) => { p.set(c[0], c[1], c[2]); sc.set(c[3], c[3], c[3]); m.compose(p, q, sc); im.setMatrixAt(i, m); });
    im.instanceMatrix.needsUpdate = true;
    return im;
  }

  function disposeTree(o){ o.traverse(n => { if (n.geometry) n.geometry.dispose(); }); }

  // The net. Each face moves from its place on the solid (p3) to its flat place in the net.
  // The Unfold slider sets how far along that move every face is (0 = solid, 1 = flat net).
  // Faces with the same area and perimeter share a colour. Side lengths are labelled on the flat net.
  // Texture coordinates for a face's unit-square grid. The grid starts at the corner nearest a right
  // angle and runs along the more horizontal edge there, so the squares line up with the base and
  // with the perpendicular side (for a right-angled face the corner is the right angle itself).
  // Which way the squares run on a face of the net. They sit with their bottoms on the face's base
  // and build upwards from it, so the squares can be counted off against the base and height the
  // net labels. A triangle's base is its first edge, which is the one the label measures from. On
  // a face with square corners any corner will do, so the one nearest a right angle is used.
  function alignUV(pts){
    const n = pts.length;
    let bi = 0;
    if (n !== 3){
      let bestScore = Infinity;
      for (let i = 0; i < n; i++){
        const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
        const ax = a[0]-p[0], ay = a[1]-p[1], bx = b[0]-p[0], by = b[1]-p[1];
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
        if (la < 1e-9 || lb < 1e-9) continue;
        const cos = (ax*bx + ay*by) / (la*lb);
        const score = Math.abs(Math.acos(Math.max(-1, Math.min(1, cos))) - Math.PI/2);
        if (score < bestScore - 1e-9){ bestScore = score; bi = i; }
      }
    }
    const p = pts[bi], a = pts[(bi + n - 1) % n], b = pts[(bi + 1) % n];
    const e = n === 3 ? b : (Math.abs(b[0]-p[0]) >= Math.abs(a[0]-p[0]) ? b : a);
    const L = Math.hypot(e[0]-p[0], e[1]-p[1]) || 1;
    const u = [(e[0]-p[0])/L, (e[1]-p[1])/L];
    let v = [-u[1], u[0]];
    // The face has to lie on the positive side of the base, or the squares would start at the top
    // and hang off the bottom edge.
    let far = 0;
    for (const q of pts){
      const d = (q[0]-p[0])*v[0] + (q[1]-p[1])*v[1];
      if (Math.abs(d) > Math.abs(far)) far = d;
    }
    if (far < 0) v = [-v[0], -v[1]];
    return pts.map(q => [(q[0]-p[0])*u[0] + (q[1]-p[1])*u[1], (q[0]-p[0])*v[0] + (q[1]-p[1])*v[1]]).flat();
  }

  function buildNetGroup(faces, size){
    if (netRoot){ root.remove(netRoot); disposeTree(netRoot); }
    netRoot = new THREE.Group();
    root.add(netRoot);
    netFaces = [];
    netHeight.length = 0;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    faces.forEach(f => f.pts.forEach(p => {
      minU = Math.min(minU, p[0]); maxU = Math.max(maxU, p[0]);
      minV = Math.min(minV, p[1]); maxV = Math.max(maxV, p[1]);
    }));
    const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
    // A shape with no net (a sphere, or a pyramid on a drawn shape) has no points here; keep the last span.
    if (faces.length) netSpan = Math.max(maxU - minU, maxV - minV);
    const shift = [size[0]/2, size[1]/2, size[2]/2];
    const colourOf = new Map();
    // A side gets one reading and no more. A triangle names its own base, and the fold it shares
    // with the face next to it would otherwise be given the same length again on top of it.
    const placed = [];
    const netLabel = (x, y, text) => {
      if (placed.some(q => Math.hypot(q[0] - x, q[1] - y) < 0.2)) return;
      placed.push([x, y]);
      addLabel(netLabels, netRoot, x, y, 0.05, text, 'netlab');
    };
    faces.forEach(f => {
      const n = f.pts.length;
      const key = Math.round(flatArea(f.pts) * 10) + '|' + Math.round(flatPerim(f.pts) * 10);
      if (!colourOf.has(key)) colourOf.set(key, NET_PALETTE[colourOf.size % NET_PALETTE.length]);

      const flat = f.pts.map(p => [p[0] - cu, p[1] - cv, 0]);
      const p3 = f.p3.map(q => [q[0] - shift[0], q[1] - shift[1], q[2] - shift[2]]);
      const contour = f.pts.map(p => new THREE.Vector2(p[0], p[1]));
      const idx = [];
      THREE.ShapeUtils.triangulateShape(contour, []).forEach(t => idx.push(t[0], t[1], t[2]));

      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(f.uv ? f.uv.flat() : alignUV(f.pts), 2));
      geo.setIndex(idx);
      const lpos = new Float32Array(n * 3);
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(lpos, 3));

      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color:colourOf.get(key), roughness:0.7, side:THREE.DoubleSide}));
      const grid = new THREE.Mesh(geo, GRID_MAT);
      grid.visible = false;
      // The outline is a closed loop, so the first corner is repeated at the end.
      const loop = new Float32Array((n + 1) * 3);
      const outlineGeo = new THREE.LineGeometry();
      outlineGeo.setPositions(loop);
      const outline = new THREE.Line2(outlineGeo, NET_FAT);
      outline.frustumCulled = false;
      netRoot.add(mesh, grid, outline);
      netFaces.push({geo, lineGeo, pos, lpos, loop, outlineGeo, grid, mesh, outline, flat, p3, n, kind:f.kind, ds:f.ds, rows:f.rows, sIdx:f.sIdx});

      // Dimensions: a shape with many sides (a circle or a curved wall) gets one name label.
      // A plain polygon gets each of its side lengths.
      if (n > 8){
        if (f.t){
          let sx = 0, sy = 0;
          flat.forEach(q => { sx += q[0]; sy += q[1]; });
          netLabel(sx / n, sy / n, convertText(f.t, false));
        }
      }
      // A triangle is labelled with its base (its first edge) and the height from its third corner to that base.
      if (n === 3){
        const [A, B2, C] = flat;
        const ex = B2[0]-A[0], ey = B2[1]-A[1], bl = Math.hypot(ex, ey) || 1;
        // F is where the height from the apex (C) meets the base line: the height is perpendicular to the base.
        const tt = ((C[0]-A[0])*ex + (C[1]-A[1])*ey) / (bl*bl);
        const F = [A[0] + tt*ex, A[1] + tt*ey];
        const hgt = Math.hypot(C[0]-F[0], C[1]-F[1]);
        const r1 = v => Math.round(v * 10) / 10;
        // The base label sits on the base; the height runs from the base up to the apex, with its label beside it.
        netLabel((A[0]+B2[0])/2, (A[1]+B2[1])/2, convertText(`base ${r1(bl)} cm`, true));
        netLabel((F[0]+C[0])/2, (F[1]+C[1])/2, convertText(`height ${r1(hgt)} cm`, true));
        const hl = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(F[0], F[1], 0.05), new THREE.Vector3(C[0], C[1], 0.05)]), DIMLINE);
        netRoot.add(hl);
        netHeight.push(hl);
      }
    });
    // Side lengths: one label per run of faces that join along that length (see G.labelEdges).
    // Triangles are labelled with their base and height above, so they are left out here.
    G.labelEdges(faces.filter(f => f.pts.length !== 3), cu, cv).forEach(l => netLabel(l.x, l.y, convertText(`${l.L} cm`, true)));
  }

  // Move each net face to its position for the current slider value. Normals are recomputed so the lighting follows.
  function applyNetFaces(){
    const t = S.unfold;
    netFaces.forEach(f => {
      const P = G.unfoldPoints(f, t);
      for (let i = 0; i < f.n; i++){
        for (let k = 0; k < 3; k++){
          f.pos[i*3 + k] = P[i][k];
          f.lpos[i*3 + k] = P[i][k];
        }
      }
      f.geo.attributes.position.needsUpdate = true;
      f.geo.computeVertexNormals();
      f.lineGeo.attributes.position.needsUpdate = true;
      for (let i = 0; i <= f.n; i++){
        const P3 = P[i % f.n];
        f.loop[i*3] = P3[0]; f.loop[i*3+1] = P3[1]; f.loop[i*3+2] = P3[2];
      }
      f.outlineGeo.setPositions(f.loop);
      // The coloured faces show only while unfolding. The unit squares show on the solid's surface
      // (at 0%, where the faces sit exactly on it) and on the flat net (at 100%).
      f.mesh.visible = t > 0;
      f.outline.visible = t > 0;
      f.grid.visible = S.showSurf && (t <= 0.001 || t >= 0.999);
    });
  }

  // Each dimension sits outside the solid, on the side nearest the viewer. The camera is
  // taken in the solid's own frame, so this stays right while the solid is turned.
  const dimCam = new THREE.Vector3();
  // Keys for the solid's edges (see rebuild), and the edges a dimension may sit on: its own edge,
  // plus the matching edges on the far side of the solid where the solid has them.
  const eKey = p => p.map(v => v.toFixed(3)).join(',');
  let solidEdgeKeys = new Set();
  // The measurement that runs front to back (along z) is called depth.
  function depthText(d){
    const alongZ = Math.abs(d.b[2] - d.a[2]) > 1e-9 && Math.abs(d.b[0] - d.a[0]) < 1e-9 && Math.abs(d.b[1] - d.a[1]) < 1e-9;
    return alongZ ? d.t.replace(/^(length|width)\b/, 'depth') : d.t;
  }
  function candEdges(A, B, size){
    const dir = [0, 1, 2].filter(k => Math.abs(B[k] - A[k]) > 1e-9);
    const perp = [0, 1, 2].filter(k => !dir.includes(k));
    const out = [];
    for (let mask = 0; mask < (1 << perp.length); mask++){
      const A2 = A.slice(), B2 = B.slice();
      perp.forEach((k, j) => { if ((mask >> j) & 1){ A2[k] = size[k] - A[k]; B2[k] = size[k] - B[k]; } });
      if (solidEdgeKeys.has(eKey(A2) + '|' + eKey(B2))) out.push({A: A2, B: B2});
    }
    return out.length ? out : [{A, B}];
  }
  // Every edge length: each side of the cross-section, and the depth. A cross-section edge can be
  // labelled on either end face, and the depth on any corner, so each label keeps a list of places
  // it could go and takes the one facing the viewer.
  function buildEdgeLabels(b){
    if (S.shape !== 'custom' || !S.custom) return;
    const P0 = S.custom.pts;
    const mx = Math.min(...P0.map(p => p[0])), my = Math.min(...P0.map(p => p[1]));
    const P = P0.map(p => [p[0] - mx, p[1] - my]);
    const n = P.length;
    const mid = (a, c) => [(a[0]+c[0])/2, (a[1]+c[1])/2, (a[2]+c[2])/2];
    const put = (opts, text) => {
      addLabel(edgeLabels, content, opts[0][0], opts[0][1], opts[0][2], convertText(text, true), 'dim');
      edgeSpecs.push({opts, label: edgeLabels[edgeLabels.length - 1]});
    };
    const len = (a, c) => r1(Math.hypot(c[0]-a[0], c[1]-a[1], c[2]-a[2]));
    if (S.custom.kind === 'pyramid'){
      const h = b.size[1];
      const cx = P.reduce((t, p) => t + p[0], 0) / n, cz = P.reduce((t, p) => t + p[1], 0) / n;
      const apex = [cx, h, cz];
      for (let i = 0; i < n; i++){
        const a = [P[i][0], 0, P[i][1]], c = [P[(i+1) % n][0], 0, P[(i+1) % n][1]];
        put([mid(a, c)], `${len(a, c)} cm`);
      }
      for (let i = 0; i < n; i++){
        const a = [P[i][0], 0, P[i][1]];
        put([mid(a, apex)], `${len(a, apex)} cm`);
      }
      return;
    }
    const L = b.size[2];
    for (let i = 0; i < n; i++){
      const a = [P[i][0], P[i][1], 0], c = [P[(i+1) % n][0], P[(i+1) % n][1], 0];
      const a2 = [P[i][0], P[i][1], L], c2 = [P[(i+1) % n][0], P[(i+1) % n][1], L];
      put([mid(a, c), mid(a2, c2)], `${len(a, c)} cm`);
    }
    put(P.map(p => [p[0], p[1], L/2]), `depth ${r1(L)} cm`);
  }
  // Move each edge label onto the edge nearest the viewer, so it stays on a face that can be seen.
  function updateEdgeLabels(){
    if (!edgeSpecs.length || !content) return;
    dimCam.copy(camera.position);
    content.worldToLocal(dimCam);
    edgeSpecs.forEach(sp => {
      let best = sp.opts[0], bestD = Infinity;
      sp.opts.forEach(o => {
        const d = (o[0]-dimCam.x)**2 + (o[1]-dimCam.y)**2 + (o[2]-dimCam.z)**2;
        if (d < bestD){ bestD = d; best = o; }
      });
      sp.label.p.set(best[0], best[1], best[2]);
    });
  }

  function updateDims(){
    if (!dimSpecs.length || !content || !dimLines || S.dimMode !== 1) return;
    dimCam.copy(camera.position);
    content.worldToLocal(dimCam);
    const cam = [dimCam.x, dimCam.y, dimCam.z];
    const pos = dimLines.geometry.attributes.position.array;
    const put = (off, p) => { pos[off] = p[0]; pos[off+1] = p[1]; pos[off+2] = p[2]; };
    dimSpecs.forEach(sp => {
      const off = Math.max(...sp.O.map(Math.abs));
      // Width and depth lie flat on the base (the bottom face, y = 0); height lies flat on the rear face
      // (z = 0). So the line is offset along one axis only, within that face's plane, outward from the solid.
      const dirAx = [0, 1, 2].find(k => Math.abs(sp.B[k] - sp.A[k]) > 1e-9);
      const n = dirAx === 1 ? 2 : 1;
      // Height may use either end face (front or back), whichever the viewer can see; the others use the base.
      const planes = dirAx === 1 ? [0, sp.size[2]] : [0];
      let best = null, bestD = Infinity;
      sp.edges.forEach(E => {
        if (!planes.some(v => Math.abs(E.A[n] - v) < 1e-6)) return;   // only edges on the chosen face
        [0, 1, 2].forEach(k => {
          if (k === n || Math.abs(E.B[k] - E.A[k]) > 1e-9) return;
          const O = [0, 0, 0];
          O[k] = E.A[k] <= sp.size[k] / 2 ? -off : off;
          const m = [0, 1, 2].map(i => (E.A[i] + E.B[i]) / 2 + O[i]);
          const d2 = (m[0]-cam[0])**2 + (m[1]-cam[1])**2 + (m[2]-cam[2])**2;
          if (d2 < bestD){ bestD = d2; best = {E, O}; }
        });
      });
      // Fallback for any dimension with no base or rear edge: the nearest outside offset on any edge.
      if (!best){
        sp.edges.forEach(E => {
          const perp = [0, 1, 2].filter(k => Math.abs(E.B[k] - E.A[k]) <= 1e-9);
          const mid = [0, 1, 2].map(k => (E.A[k] + E.B[k]) / 2);
          for (let mask = 0; mask < (1 << perp.length); mask++){
            const O = [0, 0, 0];
            perp.forEach((k, j) => { O[k] = (mask >> j) & 1 ? off : -off; });
            const m = mid.map((v, k) => v + O[k]);
            const d2 = (m[0]-cam[0])**2 + (m[1]-cam[1])**2 + (m[2]-cam[2])**2;
            const outside = m.some((v, k) => v < -0.001 || v > sp.size[k] + 0.001);
            if (outside && d2 < bestD){ bestD = d2; best = {E, O}; }
          }
        });
      }
      const pick = best;
      const a2 = [0, 1, 2].map(k => pick.E.A[k] + pick.O[k]), b2 = [0, 1, 2].map(k => pick.E.B[k] + pick.O[k]);
      const base = sp.i * 18;
      put(base, pick.E.A); put(base+3, a2); put(base+6, pick.E.B); put(base+9, b2); put(base+12, a2); put(base+15, b2);
      sp.label.p.set((a2[0]+b2[0])/2, (a2[1]+b2[1])/2, (a2[2]+b2[2])/2);
    });
    dimLines.geometry.attributes.position.needsUpdate = true;
  }

  // Screen positions (in pixels) of the sphere's handles: the radius handle on the right of the equator,
  // and the angle handle on the edge of the cut.
  function handlePoints(){
    if (!content || !camera || !renderer || S.shape !== 'sphere') return null;
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    const sp = (x, y, z) => {
      const v = content.localToWorld(new THREE.Vector3(x, y, z)).project(camera);
      return {x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h};
    };
    const r = S.dims.sphere.r, c = r, a0 = (S.dims.sphere.cut / 2) * Math.PI / 180;
    const cy = S.dims.sphere.hemi ? 0 : r;   // the hemisphere's centre is on its flat base
    return {
      radius: sp(2 * r, cy, c),
      angle: sp(c + r * Math.sin(a0), cy, c + r * Math.cos(a0)),
      centre: sp(c, cy, c)
    };
  }

  // A labelled 1 m reference cube, drawn beside the solid when the cube unit is mm or m.
  // It is a fixed size so it stays easy to see; its labels give the true size.
  function syncRef(){
    if (!current) return;
    const cu = S.cubeUnit || S.unit;
    const key = cu + '|' + current.size.join(',');
    if (key === refKey) return;
    refKey = key;
    if (refGroup){ root.remove(refGroup); disposeTree(refGroup); refGroup = null; }
    refLabels.forEach(l => l.el.remove()); refLabels.length = 0;
    if (cu === 'cm') return;
    refGroup = new THREE.Group();
    const c = [current.size[0] / 2 + 16, 0, 0], s = 10;
    refGroup.add(new THREE.Mesh(new THREE.BoxGeometry(s, s, s), MATS.cubesOut));
    refGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(s, s, s)), LINE));
    refGroup.position.set(c[0], c[1], c[2]);
    root.add(refGroup);
    const text = cu === 'mm' ? '1000 mm' : '1 m';
    addLabel(refLabels, refGroup, 0, s/2, s/2, text, 'dim');
    addLabel(refLabels, refGroup, s/2, 0, s/2, text, 'dim');
    addLabel(refLabels, refGroup, s/2, s/2, 0, text, 'dim');
  }

  function rebuild(){
    const b = S.shape === 'custom'
      ? (S.custom.kind === 'pyramid'
          ? G.buildCustomPyramid(S.custom.pts, S.dims.custom.h, S.custom.name)
          : G.buildCustom(S.custom.pts, S.dims.custom.L, S.custom.name))
      : S.shape === 'sphere'
        ? G.buildSphere(S.dims.sphere)
        : G.build(S.shape, S.dims[S.shape]);
    disposeTree(root);
    root.clear();
    refGroup = null; refKey = '';
    dimLabels.forEach(l => l.el.remove()); dimLabels.length = 0;
    netLabels.forEach(l => l.el.remove()); netLabels.length = 0;
    edgeLabels.forEach(l => l.el.remove()); edgeLabels.length = 0;
    edgeSpecs = [];

    content = new THREE.Group();
    content.position.set(-b.size[0]/2, -b.size[1]/2, -b.size[2]/2);
    // While a face is being pulled, the solid is normally re-centred each time it is rebuilt, so
    // it looks like it grows from both ends at once. holdAnchor keeps the far end where it is, so
    // only the face being dragged moves.
    if (holdAnchor){
      const u = holdAnchor.u, s = b.size;
      let m = Infinity;
      for (let i = 0; i < 8; i++){
        const v = new THREE.Vector3((i & 1) ? s[0] : 0, (i & 2) ? s[1] : 0, (i & 4) ? s[2] : 0);
        m = Math.min(m, v.dot(u));
      }
      const e = holdAnchor.at - (m + content.position.dot(u));
      content.position.addScaledVector(u, e);
    }
    root.add(content);

    solid = new THREE.Mesh(b.geo, MATS.solid);
    const eg = new THREE.LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(b.geo, 20));
    edges = new THREE.LineSegments2(eg, EDGE_FAT);
    edges.computeLineDistances();

    const pts = [];
    dimSpecs = [];
    // The real edges of the solid, so a dimension can only move to an edge the solid actually has.
    solidEdgeKeys = new Set();
    {
      const ep = new THREE.EdgesGeometry(b.geo, 20).attributes.position.array;
      for (let i = 0; i < ep.length; i += 6){
        const p = eKey([ep[i], ep[i+1], ep[i+2]]), q = eKey([ep[i+3], ep[i+4], ep[i+5]]);
        solidEdgeKeys.add(p + '|' + q); solidEdgeKeys.add(q + '|' + p);
      }
    }
    b.dims.forEach(d => {
      const A = d.a, B = d.b, O = d.o;
      const a2 = [A[0]+O[0], A[1]+O[1], A[2]+O[2]];
      const b2 = [B[0]+O[0], B[1]+O[1], B[2]+O[2]];
      pts.push(...A, ...a2, ...B, ...b2, ...a2, ...b2);
      addLabel(dimLabels, content, (a2[0]+b2[0])/2, (a2[1]+b2[1])/2, (a2[2]+b2[2])/2, convertText(depthText(d), true), 'dim');
      dimSpecs.push({i: dimSpecs.length, A, B, O, size: b.size, edges: candEdges(A, B, b.size), label: dimLabels[dimLabels.length - 1]});
    });
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    dimLines = new THREE.LineSegments(dg, DIMLINE);

    buildEdgeLabels(b);
    cubesIn = makeCubeMesh(b.visIn.concat(b.visOut), MATS.shadeCube);
    cubesOut = makeCubeMesh([], MATS.cubesOut);
    applyShape(shaderSpec());
    content.add(solid, edges, dimLines, cubesIn, cubesOut);

    const axis = G.LAYER_AXIS[S.shape];
    const groups = new Map();
    const put = (c, kind) => {
      const k = Math.floor(c[axis]);
      if (!groups.has(k)) groups.set(k, {in:[], out:[]});
      groups.get(k)[kind].push(c);
    };
    b.visIn.forEach(c => put(c, 'in'));
    b.visOut.forEach(c => put(c, 'in'));
    const cellCounts = new Map();
    b.inCells.forEach(c => {
      const k = Math.floor(c[axis]);
      cellCounts.set(k, (cellCounts.get(k) || 0) + 1);
    });
    layers = [...cellCounts.keys()].sort((x, y) => x - y).map(k => {
      const g = groups.get(k) || {in:[], out:[]};
      const inMesh = makeCubeMesh(g.in, MATS.shadeCube);
      const outMesh = makeCubeMesh(g.out, MATS.cubesOut);
      inMesh.visible = false; outMesh.visible = false;
      content.add(inMesh, outMesh);
      return {inMesh, outMesh, count: cellCounts.get(k)};
    });
    layerStep = Math.min(layerStep, layers.length);

    buildNetGroup(b.net || b.surf || [], b.size);
    current = b;
    cubeReveal = S.showVol ? 0 : 1;
    applyVisibility();
    updateInfo();
    setView();
  }

  function applyLayers(){
    layers.forEach((L, i) => {
      const on = S.unfold <= 0 && S.conv === 'off' && i < layerStep;
      L.inMesh.visible = on;
      L.outMesh.visible = on;
      L.inMesh.material = (i === layerStep - 1) ? MATS.shadeHi : MATS.shadeCube;
    });
  }

  function syncLayerSlider(){
    const s = $('layers');
    s.max = layers.length;
    s.value = layerStep;
    $('layerVal').textContent = `${layerStep} of ${layers.length}`;
  }

  function applyVisibility(){
    const conv = S.conv !== 'off';
    const net = S.unfold > 0 && !conv;
    const vol = S.showVol || layerStep > 0;
    let m = null, showSolid = true, showEdges = true;
    // Every view draws the edges. On a solid only the front ones show, which outlines the shape.
    if (net){ showSolid = false; showEdges = false; }
    else if (vol){ m = MATS.ghost; }
    else if (S.mode === 'frame'){ showSolid = false; }
    else if (S.mode === 'solid'){ m = MATS.solid; }
    else if (S.mode === 'material'){ m = MATS[S.mat]; }
    else if (S.mode === 'translucent'){ m = MATS.glass; }
    root.visible = !conv;
    solid.visible = showSolid;
    if (m) solid.material = m;
    edges.visible = showEdges;
    // Cubes are drawn only in cm. In mm or m the reference cube is shown instead.
    const cu = S.cubeUnit || S.unit;
    const aggregate = S.showVol && layerStep === 0 && cu === 'cm' && !net;
    cubesIn.visible = aggregate;
    cubesOut.visible = aggregate;
    dimLines.visible = S.dimMode === 1 && !net;
    if (netRoot) netRoot.visible = net || S.showSurf;
    if (convGroup) convGroup.visible = conv;
    syncRef();
    if (refGroup) refGroup.visible = S.showVol && cu !== 'cm' && layerStep === 0 && !net;
    applyNetFaces();
    applyLayers();
    syncLayerSlider();
  }

  function updateInfo(){
    const b = current;
    const exact = b.volume;
    let h = `<div><b>${b.name}</b></div>`;
    if (S.conv !== 'off'){
      h += S.conv === 'mm'
        ? `<div>1 cm³ = 10 × 10 × 10 = <b>1000 mm³</b></div><div class="note">The 1 cm cube on the left holds 1000 little 1 mm cubes. The single 1 mm cube on the right is one of them.</div>`
        : `<div>1 m = 100 cm, so 1 m³ = 100 × 100 × 100 = <b>1 000 000 cm³</b></div><div class="note">One layer of 1 cm cubes covers a 1 m square with 10 000 cubes. Stacking 100 layers fills the metre cube.</div>`;
      info.innerHTML = h;
      return;
    }
    if (S.unfold > 0){
      if (S.showSurf) h += `<div>Surface area: <b>${convertArea(b.area)}</b></div>`;
      h += `<div class="note">Faces with the same size share a colour.${S.unfold >= 0.999 && S.showDims ? ' Each shared edge is labelled once.' : ''}</div>`;
      info.innerHTML = h;
      return;
    }
    h += `<div>${b.formula}</div>`;
    h += `<div>Volume: <b>${fmt(exact * VOL_F[S.unit])} ${VOL_U[S.unit]}</b></div>`;
    if (S.showSurf) h += `<div>Surface area: <b>${convertArea(b.area)}</b></div>`;
    if (S.showVol){
      const total = b.visIn.length + b.visOut.length;
      h += `<div>Cuboid around it: <b>${total}</b> cubes (1 cm each)</div>`;
      h += `<div>Solid cubes (inside): <b>${b.visIn.length}</b>, faded (outside): ${b.visOut.length}</div>`;
      const cu = S.cubeUnit || S.unit;
      const per = cu === 'mm' ? '1 cm³ = 1000 mm³' : (cu === 'm' ? '1 cm³ = 0.000001 m³' : '1 cm³');
      h += `<div>Volume in ${VOL_U[cu]}: <b>${fmt(exact * VOL_F[cu])}</b></div><div class="note">Each cube is ${per}.</div>`;
      if (cu !== 'cm') h += `<div class="note">In ${cu === 'mm' ? 'mm' : 'm'} the cubes are not drawn. The grey 1 m reference cube is labelled in ${cu === 'mm' ? '1000 mm on each edge' : 'metres'} for scale.</div>`;
      else if (b.shape !== 'cuboid') h += `<div class="note">Each cube is drawn whole, and the part of its surface inside the solid is shown in solid colour while the part outside is faded.</div>`;
    }
    if (layerStep > 0){
      const N = layers.length, k = layerStep;
      let run = 0;
      for (let i = 0; i < k; i++) run += layers[i].count;
      const uniform = layers.every(l => l.count === layers[0].count);
      h += `<div style="margin-top:8px">Layers along the ${G.AXIS_NAME[b.shape]}: <b>${k} of ${N}</b></div>`;
      h += `<div>This layer (highlighted): ${layers[k-1].count} cubes</div>`;
      if (uniform){
        h += `<div>Cross-section × layers: ${layers[0].count} × ${k} = <b>${run} cubes</b></div>`;
        h += `<div class="note">Every layer is the same cross-section, so cross-section × length gives the volume.</div>`;
      } else {
        h += `<div>Layers get smaller, so add them up: ${layers.slice(0, k).map(l => l.count).join(' + ')} = <b>${run} cubes</b></div>`;
        h += `<div class="note">The layers shrink as you go up, so there is no single cross-section to multiply by a length.</div>`;
      }
    }
    info.innerHTML = h;
    renderPanel();
  }

  function convertArea(cm2){
    const f = {cm:1, mm:100, m:0.0001}[S.unit];
    return fmt(cm2 * f) + ' ' + S.unit + '²';
  }

  // Density panel (top right), values follow the chosen unit.
  function renderPanel(){
    const p = $('densVals');
    const dens = density();
    const V = current.volume;
    const rows = [];
    if (S.pShow.mass) rows.push(`<div>Mass: <b>${massDisplay(dens, V)}</b></div>`);
    if (S.pShow.density) rows.push(`<div>Density: <b>${densityDisplay(dens)}</b> <span class="note">(${matKey()})</span></div><div>One 1 cm cube has mass <b>${massDisplay(dens, 1)}</b></div>`);
    if (S.pShow.volume) rows.push(`<div>Volume: <b>${fmt(V * VOL_F[S.unit])} ${VOL_U[S.unit]}</b></div>`);
    p.innerHTML = rows.join('') || '<div class="note">Tick a measure above.</div>';
  }

  // ---------- conversion scenes ----------
  function clearConv(){
    if (convGroup){ scene.remove(convGroup); disposeTree(convGroup); convGroup = null; }
    convLabels.forEach(l => l.el.remove());
    convLabels.length = 0;
  }

  function buildConv(kind){
    clearConv();
    convGroup = new THREE.Group();
    scene.add(convGroup);
    if (kind === 'mm'){
      const big = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), LINE);
      big.position.set(0, 0.5, 0);
      convGroup.add(big);
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), MATS.cubes, 1000);
      const m = new THREE.Matrix4(); let n = 0;
      for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) for (let k = 0; k < 10; k++){
        m.makeTranslation(-0.45 + i * 0.1, 0.05 + j * 0.1, -0.45 + k * 0.1);
        im.setMatrixAt(n++, m);
      }
      im.instanceMatrix.needsUpdate = true;
      convGroup.add(im);
      const one = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), MATS.cubesHi);
      one.position.set(1.6, 0.05, 0);
      convGroup.add(one);
      addLabel(convLabels, convGroup, 0, 1.2, 0, '1 cm³', 'dim');
      addLabel(convLabels, convGroup, 1.6, 0.35, 0, '1 mm³', 'dim');
      addLabel(convLabels, convGroup, 0, -0.3, 0, '10 × 10 × 10 = 1000 mm cubes', 'netlab');
      camera.position.set(3.2, 2.4, 4.2);
      camera.lookAt(0.6, 0.5, 0);
    } else {
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(100, 100, 100)), LINE);
      frame.position.set(50, 50, 50);
      convGroup.add(frame);
      const slab = new THREE.InstancedMesh(new THREE.BoxGeometry(0.94, 0.94, 0.94), MATS.cubes, 10000);
      const m = new THREE.Matrix4(); let n = 0;
      for (let i = 0; i < 100; i++) for (let k = 0; k < 100; k++){
        m.makeTranslation(i + 0.5, 0.5, k + 0.5);
        slab.setMatrixAt(n++, m);
      }
      slab.instanceMatrix.needsUpdate = true;
      convGroup.add(slab);
      const one = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), MATS.cubesHi);
      one.position.set(-4, 0.5, 0.5);
      convGroup.add(one);
      addLabel(convLabels, convGroup, 50, 104, 50, '1 m = 100 cm', 'dim');
      addLabel(convLabels, convGroup, -4, 3.5, 0.5, '1 cm³', 'dim');
      addLabel(convLabels, convGroup, 50, -10, 50, 'One layer: 100 × 100 = 10 000 cm³. 100 layers = 1 000 000 cm³ (1 m³)', 'netlab');
      camera.position.set(50 + 190, 50 + 140, 50 + 230);
      camera.lookAt(50, 40, 50);
    }
  }

  // The camera eases from the usual 3D view to a straight-on view of the net as the net unfolds.
  // Set while a face is being dragged: the view stays exactly as it is, so the solid does not
  // appear to zoom in and out as it is resized.
  let holdView = false, holdAnchor = null;
  // Set by double-clicking a face: the camera moves to look straight at that face, level with it,
  // so the face is square to the screen and the solid still stands on a level base.
  let faceView = null;
  function setView(){
    if (S.conv !== 'off' || !current || holdView) return;
    const d = Math.max(...current.size) * 2.0 + 14;
    // A pyramid starts about 30 degrees up, looking straight at one base corner: the apex sits at the top, that
    // corner comes nearest the viewer at the bottom, and the sloping faces either side of it show.
    // The corner is the one furthest from the apex's foot, so the view is the most open.
    const pyr = S.shape === 'custom' && S.custom && S.custom.kind === 'pyramid';
    const PYR_TWIST = 100;   // degrees; sign chosen so the solid turns to the left on screen
    let from =new THREE.Vector3(d * 0.6, d * 0.45, d * 0.75);
    if (faceView){
      from = faceView.clone().setLength(d);
    } else if (pyr){
      const P = S.custom.pts, mx = Math.min(...P.map(p => p[0])), my = Math.min(...P.map(p => p[1]));
      const Q = P.map(p => [p[0] - mx, p[1] - my]);
      const cx = Q.reduce((t, q) => t + q[0], 0) / Q.length, cz = Q.reduce((t, q) => t + q[1], 0) / Q.length;
      let far = Q[0], farD = -1;
      Q.forEach(q => { const dd = Math.hypot(q[0] - cx, q[1] - cz); if (dd > farD){ farD = dd; far = q; } });
      const hx0 = far[0] - cx, hz0 = far[1] - cz, hl = Math.hypot(hx0, hz0) || 1;
      // Twist the view 10 degrees, so the solid turns to the left of the corner.
      const tw = PYR_TWIST * Math.PI / 180, ux = hx0 / hl, uz = hz0 / hl;
      const hx = ux * Math.cos(tw) - uz * Math.sin(tw), hz = ux * Math.sin(tw) + uz * Math.cos(tw);
      const el = 20 * Math.PI / 180;   // lower than before, so the base sits flatter and the near corner rises
      from = new THREE.Vector3(hx * Math.cos(el) * d, Math.sin(el) * d, hz * Math.cos(el) * d);
    }
    const to = new THREE.Vector3(0, 0, netSpan * 1.45 + 6);
    camera.position.lerpVectors(from, to, S.unfold);
    camera.lookAt(0, 0, 0);
  }

  window.App = {
    S, $, S_:null, canvas, stage, labelBox, info, renderer, scene, camera, root, MATS,
    rebuild, applyVisibility, updateInfo, renderPanel, setView, buildConv, clearConv, updateDims, handlePoints, setLineResolution,
    updateEdgeLabels,
    get current(){ return current; }, get layers(){ return layers; }, get layerStep(){ return layerStep; },
    set layerStep(v){ layerStep = v; }, get cubeReveal(){ return cubeReveal; }, set cubeReveal(v){ cubeReveal = v; },
    get cubesIn(){ return cubesIn; }, get cubesOut(){ return cubesOut; }, get content(){ return content; }, get solid(){ return solid; },
    netHeight, sun, fill,
    set holdView(v){ holdView = v; }, get holdView(){ return holdView; },
    set faceView(v){ faceView = v; }, get faceView(){ return faceView; },
    set holdAnchor(v){ holdAnchor = v; }, get holdAnchor(){ return holdAnchor; },
    get netGroup(){ return netRoot; }, get convGroup(){ return convGroup; },
    get refGroup(){ return refGroup; }, refLabels,
    dimLabels, netLabels, convLabels, edgeLabels, convertText, syncLayerSlider, massDisplay, densityDisplay, fmt
  };
})();
