// Controls, turning, labels and the render loop.
(function(){
  const A = window.App;
  const S = A.S;
  const $ = id => document.getElementById(id);
  const G = window.SolidGeo;
  const DIM_UI = G.DIM_UI;
  const clock = new THREE.Clock();
  // The orientation is kept as a quaternion. Each turn is applied about the viewer's fixed axes
  // (screen vertical for spin, screen horizontal for tilt), so the arrows and drags always turn
  // the solid the way the viewer sees it, whatever turn came before.
  const orient = new THREE.Quaternion();
  // The camera is above and to one side, so the world axes look diagonal on screen. Take the
  // turn axes from the camera instead: its up direction (spin) and its right direction (tilt).
  function viewAxis(v){ return v.applyQuaternion(A.camera.quaternion).normalize(); }
  const UP = new THREE.Vector3(0, 1, 0);
  // Turning left and right goes about the solid's own upright axis, so it spins in the plane of
  // its base like a turntable and that base is left exactly where it was. While the solid stands
  // level this is the same as turning about the upright axis of the room; once it is leaning,
  // after snapping a sloping face towards the viewer, it is the difference between spinning the
  // solid on its base and wobbling it about an axis its base no longer shares.
  function turnSpin(deg){ orient.multiply(new THREE.Quaternion().setFromAxisAngle(UP, deg * Math.PI / 180)); }
  function turnTilt(deg){ orient.premultiply(new THREE.Quaternion().setFromAxisAngle(viewAxis(new THREE.Vector3(1, 0, 0)), deg * Math.PI / 180)); }

  // While the net unfolds, the solid turns to face the viewer, so the net ends up straight-on.
  const IDENT = new THREE.Quaternion();
  // 0 = folded, 1 = fully unfolded. The Unfold net button moves towards the target over time.
  let unfoldTarget = 0;
  function applyRotation(){
    A.root.quaternion.copy(orient).slerp(IDENT, S.unfold);
  }

  // Double-clicking a face turns the solid to put that face square-on to the viewer, standing on a
  // level base. The turn runs over a few tenths of a second rather than jumping.
  let snapFrom = null, snapTo = null, snapT = 0;
  // The solid is turned so the clicked face looks straight at the viewer, whichever way that face
  // happens to lean. Turning it only about the upright axis, as this did before, could only line up
  // faces that stand vertically: a sloping face stayed at an angle, and a face lying flat was
  // missed altogether. The camera itself does not move.
  function faceViewer(gn){
    const v = A.camera.position.clone().normalize();   // from the solid out towards the viewer
    const n = gn.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(n, v);
    // That alone can leave the solid lying at any angle about the line of sight, so it is rolled
    // until the solid's own upright direction is as near to upright on screen as it can be. For a
    // solid standing on its base, that puts the base level along the bottom.
    const flat = w => w.clone().addScaledVector(v, -w.dot(v));
    const camUp = flat(new THREE.Vector3(0, 1, 0).applyQuaternion(A.camera.quaternion));
    let own = flat(new THREE.Vector3(0, 1, 0).applyQuaternion(q));
    // A face that was already lying flat has its upright direction pointing at the viewer, which
    // says nothing about the roll, so the solid's depth direction is used instead.
    if (own.lengthSq() < 1e-6) own = flat(new THREE.Vector3(0, 0, 1).applyQuaternion(q));
    if (own.lengthSq() > 1e-8 && camUp.lengthSq() > 1e-8){
      own.normalize(); camUp.normalize();
      const roll = Math.atan2(new THREE.Vector3().crossVectors(own, camUp).dot(v), own.dot(camUp));
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(v, roll));
    }
    snapFrom = orient.clone();
    snapTo = q;
    snapT = 0;
  }

  // The three looks on one button. A sphere has no frame, so that one is left out of its cycle.
  const LOOKS = ['frame', 'solid', 'translucent'];
  const looksFor = () => S.shape === 'sphere' ? LOOKS.filter(k => k !== 'frame') : LOOKS;
  const cap = s => s[0].toUpperCase() + s.slice(1);

  function sync(){
    const sph = S.shape === 'sphere';
    if (sph && S.mode === 'frame') S.mode = 'solid';
    // Unlike the buttons that turn something on, this one is a setting with three settings, so it
    // names the look that is on now. Pressing it moves to the next one.
    $('appBtn').textContent = 'Appearance: ' + cap(S.mode === 'material' ? S.mat : S.mode);
    syncShapeBar();
    $('hemiRow').hidden = !sph;
    $('hemi').checked = !!(S.dims.sphere && S.dims.sphere.hemi);
    document.querySelectorAll('#mats button').forEach(b => b.classList.toggle('on', b.dataset.mat === S.mat));
    document.querySelectorAll('#conv button').forEach(b => b.classList.toggle('on', b.dataset.conv === S.conv));
    const dimMode = S.dimMode || 0;
    // Each label says what the next press will do.
    $('dimBtn3').textContent = ['Dimensions', 'Edge lengths', 'Hide'][dimMode];
    $('dimBtn3').classList.toggle('on', dimMode > 0);
    $('surfBtn').textContent = S.showSurf ? 'Hide surface area' : 'Surface area';
    $('surfBtn').classList.toggle('on', S.showSurf);
    $('volBtn').textContent = S.showVol ? 'Hide volume' : 'Volume';
    $('volBtn').classList.toggle('on', S.showVol);
    $('layersRow').hidden = !S.showVol;
    $('unfoldBtn').textContent = unfoldTarget > 0 ? 'Fold back' : 'Unfold net';
    $('unfoldBtn').classList.toggle('on', unfoldTarget > 0);
    // Spheres have no net to unfold. Pyramids on drawn shapes unfold into the base with its triangles round it.
    const hasNet = S.shape !== 'sphere';
    $('unfoldBtn').hidden = !hasNet;
    if (!hasNet) unfoldTarget = 0;
    $('tickMass').checked = S.pShow.mass;
    $('tickDensity').checked = S.pShow.density;
    $('tickVolume').checked = S.pShow.volume;
    $('calc3Btn').textContent = $('info').hidden ? 'Show calculations' : 'Hide calculations';
  }

  function setConv(kind){
    S.conv = kind;
    if (kind !== 'off') A.buildConv(kind); else A.clearConv();
    sync();
    A.applyVisibility();
    A.updateInfo();
    A.renderPanel();
    if (kind === 'off') A.setView();
  }

  $('appBtn').onclick = () => {
    const looks = looksFor();
    // Picking a material in Volume & density is a look of its own; from there the cycle rejoins at Solid.
    S.mode = S.mode === 'material' ? 'solid' : looks[(looks.indexOf(S.mode) + 1) % looks.length];
    sync(); A.applyVisibility(); A.renderPanel();
  };
  document.querySelectorAll('#mats button').forEach(btn => {
    btn.onclick = () => { S.mat = btn.dataset.mat; S.mode = 'material'; sync(); A.applyVisibility(); A.renderPanel(); };
  });
  document.querySelectorAll('#conv button').forEach(btn => {
    btn.onclick = () => setConv(btn.dataset.conv === S.conv ? 'off' : btn.dataset.conv);
  });
  ['Mass','Density','Volume'].forEach(k => {
    $('tick' + k).onchange = e => { S.pShow[k.toLowerCase()] = e.target.checked; A.renderPanel(); };
  });
  // Cycles: the three measurements, then every edge length, then none. It never folds or unfolds
  // the net: that is the Unfold net button's job.
  $('dimBtn3').onclick = () => {
    S.dimMode = ((S.dimMode || 0) + 1) % 3;
    S.showDims = S.dimMode > 0;
    sync(); A.applyVisibility(); A.updateInfo();
  };
  $('surfBtn').onclick = () => {
    S.showSurf = !S.showSurf;
    sync(); A.applyVisibility(); A.updateInfo();
  };
  // Hemi-sphere: keeps the top half, with its flat circular base at the bottom.
  $('hemi').onchange = e => {
    S.dims.sphere.hemi = e.target.checked;
    A.rebuild(); A.setView(); sync(); A.renderPanel();
  };
  $('volBtn').onclick = () => {
    S.showVol = !S.showVol;
    if (S.showVol) A.cubeReveal = 0;
    else { A.layerStep = 0; $('layers').value = 0; }
    sync();
    A.applyVisibility(); A.updateInfo(); A.renderPanel();
  };
  $('unfoldBtn').onclick = () => { unfoldTarget = unfoldTarget > 0 ? 0 : 1; sync(); };
  $('layers').oninput = e => {
    A.layerStep = Number(e.target.value);
    A.applyVisibility(); A.updateInfo(); A.renderPanel();
  };

  // Arrow buttons turn the solid in 15 degree steps, the same way a drag would: left and right
  // spin about the vertical screen axis, up and down tilt about the horizontal one.
  // Looking square at a face is a moment, not a mode: as soon as the solid is turned again the
  // camera goes back to its usual raised angle, otherwise everything after it looks flat on.
  function leaveFaceView(){
    if (!A.faceView) return;
    A.faceView = null;
    A.setView();
  }
  function nudge(turn){
    return () => {
      if (S.unfold > 0 || unfoldTarget > 0) return;
      leaveFaceView();
      turn(15);
      applyRotation();
    };
  }
  $('rotL').onclick = nudge(d => turnSpin(-d));
  $('rotR').onclick = nudge(d => turnSpin(d));
  $('rotU').onclick = nudge(d => turnTilt(-d));
  $('rotD').onclick = nudge(d => turnTilt(d));
  // Plus zooms in (camera closer), minus zooms out.
  $('zoomIn').onclick = () => zoom3d(1 / 1.1);
  $('zoomOut').onclick = () => zoom3d(1.1);
  $('reset').onclick = () => { orient.identity(); A.faceView = null; applyRotation(); A.setView(); };

  let drag = null;
  const cv = A.canvas;
  const ptr3 = new Map();
  let pd3 = 0;
  function zoom3d(f){
    const len = A.camera.position.length();
    const nl = Math.min(600, Math.max(4, len * f));
    A.camera.position.multiplyScalar(nl / len);
  }
  cv.addEventListener('wheel', e => { e.preventDefault(); zoom3d(e.deltaY > 0 ? 1.1 : 1 / 1.1); }, {passive:false});
  cv.addEventListener('pointerdown', e => ptr3.set(e.pointerId, {x:e.clientX, y:e.clientY}));
  cv.addEventListener('pointermove', e => {
    if (!ptr3.has(e.pointerId)) return;
    ptr3.set(e.pointerId, {x:e.clientX, y:e.clientY});
    if (ptr3.size === 2){
      const [a, b] = [...ptr3.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pd3 > 0) zoom3d(pd3 / d);
      pd3 = d;
    }
  });
  const end3 = e => { ptr3.delete(e.pointerId); pd3 = 0; };
  cv.addEventListener('pointerup', end3);
  cv.addEventListener('pointercancel', end3);
  cv.addEventListener('pointerdown', e => { drag = {x:e.clientX, y:e.clientY}; snapTo = null; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    // Pulling a face, turning the sphere's cut, or a face waiting to be pulled: none of those
    // should also spin the solid round.
    if (facePull || angleDrag || pendingPick) return;
    if (!drag || S.unfold > 0 || S.conv !== 'off' || ptr3.size > 1) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag = {x:e.clientX, y:e.clientY};
    if (dx || dy) leaveFaceView();
    if (window.Party && Math.hypot(dx, dy) > 25) window.Party.hit('swing');
    turnSpin(dx * 0.5729578);
    turnTilt(dy * 0.5729578);
    applyRotation();
  });
  const endDrag = () => { drag = null; };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  function resize(){
    const w = A.stage.clientWidth, h = A.stage.clientHeight;
    if (!w || !h) return;
    A.renderer.setSize(w, h, false);
    A.setLineResolution(w, h);
    A.camera.aspect = w / h;
    A.camera.updateProjectionMatrix();
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(A.stage);
  else window.addEventListener('resize', resize);

  function placeLabel(L, w, h){
    const v = L.p.clone().applyMatrix4(L.obj.matrixWorld);
    v.project(A.camera);
    if (v.z >= 1){ L.el.style.display = 'none'; return; }
    L.el.style.display = 'block';
    L.el.style.left = ((v.x + 1) / 2 * w) + 'px';
    L.el.style.top = ((1 - v.y) / 2 * h) + 'px';
  }

  function loop(){
    requestAnimationFrame(loop);
    if (!A.active) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    // The net unfolds (or folds back) over about a second and a fifth.
    if (S.unfold !== unfoldTarget){
      const step = dt / 1.2;
      S.unfold = S.unfold < unfoldTarget ? Math.min(unfoldTarget, S.unfold + step) : Math.max(unfoldTarget, S.unfold - step);
      applyRotation(); A.applyVisibility(); A.setView(); A.renderPanel();
      if (S.unfold === unfoldTarget) A.updateInfo();
    }
    if (S.showVol && A.cubeReveal < 1) A.cubeReveal = Math.min(1, A.cubeReveal + dt / 1.6);
    if (S.showVol && A.cubesIn && A.layerStep === 0 && S.conv === 'off'){
      A.cubesIn.count = Math.floor(A.cubeReveal * (A.current.visIn.length + A.current.visOut.length));
      A.cubesOut.count = Math.floor(A.cubeReveal * A.current.visOut.length);
    }
    if (snapTo){
      snapT = Math.min(1, snapT + dt / 0.4);
      orient.copy(snapFrom).slerp(snapTo, 1 - Math.pow(1 - snapT, 3));
      applyRotation();
      if (snapT >= 1) snapTo = null;
    }
    A.root.updateMatrixWorld(true);
    A.updateDims();
    A.updateEdgeLabels();
    placeHandles();
    if (A.netGroup) A.netGroup.updateMatrixWorld(true);
    if (A.convGroup) A.convGroup.updateMatrixWorld(true);
    A.renderer.render(A.scene, A.camera);

    const w = A.canvas.clientWidth, h = A.canvas.clientHeight;
    const conv = S.conv !== 'off';
    A.dimLabels.forEach(L => {
      if (S.dimMode !== 1 || S.unfold > 0 || conv){ L.el.style.display = 'none'; return; }
      placeLabel(L, w, h);
    });
    // Every edge length: each side of the cross-section, and the depth.
    A.edgeLabels.forEach(L => {
      if (S.dimMode !== 2 || S.unfold > 0 || conv){ L.el.style.display = 'none'; return; }
      placeLabel(L, w, h);
    });
    // Side lengths appear on the flat net once Dimensions is ticked.
    A.netLabels.forEach(L => {
      if (!S.showDims || S.unfold < 0.999 || conv){ L.el.style.display = 'none'; return; }
      placeLabel(L, w, h);
    });
    // The height lines in the net's triangles follow the same rule as their labels.
    const netShown = S.showDims && S.unfold >= 0.999 && !conv;
    A.netHeight.forEach(l => { l.visible = netShown; });
    const refShown = !!(A.refGroup && A.refGroup.visible);
    A.refLabels.forEach(L => {
      if (!refShown || conv){ L.el.style.display = 'none'; return; }
      placeLabel(L, w, h);
    });
    A.convLabels.forEach(L => {
      if (!conv){ L.el.style.display = 'none'; return; }
      placeLabel(L, w, h);
    });
  }

  A.setCustomPrism = (pts, name, L) => {
    S.custom = {pts, name};
    S.dims.custom.L = L;
    S.shape = 'custom';
    sync();
    A.rebuild();
    A.renderPanel();
  };
  A.setCustomPyramid = (pts, name, h) => {
    S.custom = {pts, name, kind:'pyramid'};
    S.dims.custom.h = h;
    S.shape = 'custom';
    orient.identity();   // start upright, with the base at the bottom
    S.unfold = 0; unfoldTarget = 0;
    applyRotation();
    sync();
    A.rebuild();
    A.setView();
    A.renderPanel();
  };
  // Called when a new shape is started, so nothing is rebuilt from the shape just dropped.
  A.forgetShape = () => { S.custom = null; };
  A.setSphere = () => {
    A.faceView = null;
    S.shape = 'sphere';
    orient.identity();   // start upright, so a hemisphere's flat base is at the bottom
    S.unfold = 0; unfoldTarget = 0;
    applyRotation();
    sync();
    A.rebuild();
    A.renderPanel();
  };

  // Sphere handles: the radius handle (right of the equator) and the angle handle (on the edge of the cut).
  const hR = document.createElement('div'), hA = document.createElement('div');
  hR.className = hA.className = 'shdl';
  hR.title = 'Drag to change the radius';
  hA.title = 'Drag to change the cut angle';
  $('stage').appendChild(hR);
  $('stage').appendChild(hA);
  let angleDrag = null;   // {a0, cut0, C} while the angle handle is being dragged
  function placeHandles(){
    const pts = A.handlePoints();
    const show = !!pts && S.unfold === 0;
    hR.hidden = hA.hidden = !show;
    if (!show) return;
    // Seen from some angles the two grips land on the same spot and you cannot tell
    // which is which, let alone take hold of one. Nudge them apart just enough.
    let ax = pts.angle.x, ay = pts.angle.y;
    const MIN = 34;                                    // a little over one grip across
    let dx = ax - pts.radius.x, dy = ay - pts.radius.y;
    let d = Math.hypot(dx, dy);
    if (d < MIN){
      if (d < 0.01){ dx = 0; dy = -1; d = 1; }         // exactly on top: send it upwards
      ax = pts.radius.x + dx / d * MIN;
      ay = pts.radius.y + dy / d * MIN;
    }
    hR.style.left = pts.radius.x + 'px'; hR.style.top = pts.radius.y + 'px';
    hA.style.left = ax + 'px'; hA.style.top = ay + 'px';
  }
  // The 3D sidebar: New shape, then 2D, 3D prism and 3D pyramid. A prism or pyramid's outline may have been
  // changed in 3D, so the 2D view and the options use the outline the solid has now.
  // Going 3D hands the flat outline over as a list of points, which is all a solid needs.
  // Coming back, that list would land as a plain polygon - and a sector traced as a hundred
  // tiny steps then reads 88 degrees at its corners instead of 90. So the shape it came from
  // is kept, and handed back whenever the outline was not altered while it was a solid.
  let cameFrom = null;              // {shape, dims, pts} captured on the way into 3D
  const samePts = (a, b) => a && b && a.length === b.length
    && a.every((q, i) => Math.abs(q[0] - b[i][0]) < 1e-6 && Math.abs(q[1] - b[i][1]) < 1e-6);
  const toTwoD = () => {
    if (S.shape === 'custom' && S.custom && window.Area2D){
      if (cameFrom && samePts(cameFrom.pts, S.custom.pts) && window.Area2D.setShape){
        window.Area2D.setShape(cameFrom.shape, cameFrom.dims);
      } else if (window.Area2D.setFree) window.Area2D.setFree(S.custom.pts);
    }
    cameFrom = null;
    window.switchView('2d');
  };
  const outlineNow = () => (S.shape === 'custom' && S.custom) ? S.custom.pts : (window.Area2D && window.Area2D.outline ? window.Area2D.outline() : null);
  // The shape bar (2D, 3D prism, 3D pyramid) is in both views and does the same in each.
  document.querySelectorAll('.nsTo2d').forEach(b => b.onclick = toTwoD);
  // One 3D button, which names what the next press will make: "3D" from the flat shape, then
  // "Pyramid" while a prism is showing and "Prism" while a pyramid is.
  const nextSolid = () => {
    const inThreeD = !document.getElementById('view3d').hidden;
    if (!inThreeD || S.shape !== 'custom' || !S.custom) return 'prism';
    return S.custom.kind === 'pyramid' ? 'prism' : 'pyramid';
  };
  function syncShapeBar(){
    const inThreeD = !document.getElementById('view3d').hidden;
    // In 2D it is an action: press it to go 3D. Once it is highlighted it is the view you are in,
    // so it names the solid on screen, with the arrow saying it swaps to the other one.
    const label = (inThreeD && S.shape === 'custom' && S.custom)
      ? ('3D: ' + (S.custom.kind === 'pyramid' ? 'Pyramid' : 'Prism')) : '3D';
    // Whichever view is open is the one highlighted, so it is clear where you are.
    document.querySelectorAll('.ns3d').forEach(b => { b.textContent = label; b.classList.toggle('on', inThreeD); });
    document.querySelectorAll('.nsTo2d').forEach(b => b.classList.toggle('on', !inThreeD));
  }
  A.syncShapeBar = syncShapeBar;
  const make3D = (pts, kind) => {
    if (S.shape !== 'custom' && window.Area2D && window.Area2D.getShape){
      const was = window.Area2D.getShape();
      if (was && was !== 'free' && window.Area2D.getDims)
        cameFrom = { shape: was, dims: Object.assign({}, window.Area2D.getDims()[was]), pts: pts.map(q => q.slice()) };
    }
    A.faceView = null;   // a new solid starts from the usual view
    if (kind === 'pyramid') A.setCustomPyramid(pts, 'Pyramid', 8);
    else A.setCustomPrism(pts, 'Prism', 6);
    window.switchView('3d');
    syncShapeBar();
  };
  // Used by the 2D view's own 3D button, once the pins have been closed into an outline.
  A.make3D = pts => make3D(pts, 'prism');
  document.querySelectorAll('.ns3d').forEach(b => b.onclick = () => {
    const pts = outlineNow();
    if (!pts){ toTwoD(); return; }
    make3D(pts, nextSolid());
  });
  $('new3d').onclick = () => { window.switchView('2d'); $('newShape').click(); };
  // Calculations in 3D stay hidden until asked for.
  $('calc3Btn').onclick = () => { $('info').hidden = !$('info').hidden; sync(); };
  $('meas3Toggle').onclick = () => {
    const b = $('meas3Body');
    b.hidden = !b.hidden;
    $('meas3Toggle').textContent = b.hidden ? 'Show' : 'Hide';
  };

  // ---- Faces (3D). Click a face to select it. Press the selected face again and drag to push
  // it out or pull it in, perpendicular to the face. Dimensions change in whole cm.
  const RAY = new THREE.Raycaster();
  const camR = new THREE.Vector3(), camU = new THREE.Vector3();
  let faceSel = null;    // {gn, key, mult, shape} for the selected face
  let facePull = null;   // {x0, y0, snap, key, mult, gn} while a selected face is being dragged

  // Freeze the view and pin the far end of the solid for the length of a drag, so the face being
  // pulled is the only thing that moves.
  function startHold(gn){
    const u = gn.clone().normalize();
    const s = A.current ? A.current.size : [0, 0, 0];
    let m = Infinity;
    for (let i = 0; i < 8; i++){
      const v = new THREE.Vector3((i & 1) ? s[0] : 0, (i & 2) ? s[1] : 0, (i & 4) ? s[2] : 0);
      m = Math.min(m, v.dot(u));
    }
    A.holdAnchor = {u, at: m + A.content.position.dot(u)};
    A.holdView = true;
  }
  // When the drag ends the solid is put back in the middle. The view is left alone unless the
  // solid now fills more than three quarters of the screen, in which case it is pulled back.
  function endHold(){
    if (!A.holdView) return;
    A.holdAnchor = null;
    A.rebuild();          // re-centres; the view is still held, so the camera does not move
    A.holdView = false;
    const s = A.current ? A.current.size : [0, 0, 0];
    const halfH = A.camera.position.length() * Math.tan(A.camera.fov * Math.PI / 360);
    const halfW = halfH * A.camera.aspect;
    if (Math.max(s[0], s[1], s[2]) / 2 > 0.75 * Math.min(halfH, halfW)) A.setView();
  }
  let pendingPick = null; // a press that may turn into a click to select
  let highlight = null;   // the outline mesh shown on the selected face

  // The outline edge of the prism whose outward direction matches the face normal n, or -1.
  function outlineEdgeFor(n){
    const P = S.custom.pts, N = P.length;
    const cen = [P.reduce((t, q) => t + q[0], 0) / N, P.reduce((t, q) => t + q[1], 0) / N];
    let best = -1, bestDot = 0.8;
    for (let i = 0; i < N; i++){
      const a = P[i], b = P[(i + 1) % N];
      let nx = b[1] - a[1], ny = -(b[0] - a[0]);
      const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
      if ((a[0] - cen[0]) * nx + (a[1] - cen[1]) * ny < 0){ nx = -nx; ny = -ny; }
      const dot = nx * n.x + ny * n.y;
      if (dot > bestDot){ bestDot = dot; best = i; }
    }
    return best;
  }
  // Moves one outline edge along its outward normal by d cm, snapped as the 2D view is.
  function pullSide(pts0, i, amount){
    const N = pts0.length, j = (i + 1) % N;
    const a = pts0[i], b = pts0[j];
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    const cen = [pts0.reduce((t, q) => t + q[0], 0) / N, pts0.reduce((t, q) => t + q[1], 0) / N];
    if ((a[0] - cen[0]) * nx + (a[1] - cen[1]) * ny < 0){ nx = -nx; ny = -ny; }
    const st = (window.Area2D && window.Area2D.getSnap) ? window.Area2D.getSnap() : 1;
    const d = Math.round(amount / st) * st;
    const moved = pts0.map((q, k) => (k === i || k === j) ? [q[0] + nx * d, q[1] + ny * d] : q.slice());
    // Kept in the order it was drawn; a pull that would make two sides cross is refused.
    if (window.Area2D && window.Area2D.validOutline && !window.Area2D.validOutline(moved)) return;
    S.custom.pts = moved;
  }

  // Which measurement a face changes, and how much it changes per cm pushed out (mult).
  function faceDimFor(shape, n){
    // The prism's two end faces change its depth.
    if (shape === 'custom'){
      // A pyramid's base pulls its height, as the pyramid does.
      if (S.custom && S.custom.kind === 'pyramid') return n.y < -0.9 ? {key:'h', mult:1} : null;
      if (Math.abs(n.z) > 0.9) return {key:'L', mult:1};
      // A side face moves its edge of the outline (the same edge the 2D view moves).
      if (Math.abs(n.z) < 0.1){
        const edge = outlineEdgeFor(n);
        if (edge >= 0) return {key:'side', mult:1, edge};
      }
      return null;
    }
    if (shape === 'cuboid'){
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      if (ax >= ay && ax >= az) return {key:'L', mult:1};
      if (ay >= az) return {key:'H', mult:1};
      return {key:'W', mult:1};
    }
    if (shape === 'prism'){
      if (Math.abs(n.z) > 0.9) return {key:'L', mult:1};
      if (n.y < -0.9) return {key:'h', mult:1};
      if (n.x < -0.9) return {key:'b', mult:1};
      return null;
    }
    if (shape === 'pyramid'){
      if (n.y < -0.9) return {key:'h', mult:1};
      return null;
    }
    if (shape === 'cylinder'){
      if (Math.abs(n.y) > 0.9) return {key:'h', mult:1};
      if (Math.abs(n.y) < 0.1) return {key:'D', mult:2};
      return null;
    }
    return null;
  }

  // The solid face under the pointer: its normal in the solid's own frame, or null.
  function pickSolid(cx, cy){
    const sm = A.solid;
    if (!sm || !sm.visible || S.unfold > 0 || S.conv !== 'off') return null;
    const r = A.canvas.getBoundingClientRect();
    RAY.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), A.camera);
    const hit = RAY.intersectObject(sm, false)[0];
    if (!hit || !hit.face) return null;
    return {gn: hit.face.normal.clone().normalize()};
  }

  function clearHighlight(){
    if (!highlight) return;
    if (highlight.parent) highlight.parent.remove(highlight);
    highlight.geometry.dispose();
    highlight.material.dispose();
    highlight = null;
  }

  // Outline the outermost triangles that face the same way as gn.
  function highlightFace(gn, shape){
    clearHighlight();
    const sm = A.solid;
    if (!sm || shape !== S.shape) return;
    const pos = sm.geometry.attributes.position;
    const idx = sm.geometry.index ? sm.geometry.index.array : null;
    const count = idx ? idx.length : pos.count;
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    const tris = [];
    let top = -Infinity;
    for (let i = 0; i + 2 < count; i += 3){
      va.fromBufferAttribute(pos, idx ? idx[i] : i);
      vb.fromBufferAttribute(pos, idx ? idx[i+1] : i+1);
      vc.fromBufferAttribute(pos, idx ? idx[i+2] : i+2);
      const n = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va));
      if (n.lengthSq() === 0) continue;
      n.normalize();
      if (Math.abs(n.dot(gn)) < 0.98) continue;
      const off = (va.dot(gn) + vb.dot(gn) + vc.dot(gn)) / 3;
      tris.push({v:[va.clone(), vb.clone(), vc.clone()], off});
      if (off > top) top = off;
    }
    const pts = [];
    tris.forEach(t => { if (t.off > top - 0.05) pts.push(...t.v); });
    if (!pts.length) return;
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    geo.translate(gn.x * 0.02, gn.y * 0.02, gn.z * 0.02);
    highlight = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color:0xf59e0b, transparent:true, opacity:0.6, side:THREE.DoubleSide, depthWrite:false}));
    sm.add(highlight);
  }

  // The two presses of a double tap are counted here rather than waiting for the browser's own
  // double-click, which a board's touchscreen does not always send. Working from the press also
  // means the second tap never starts a resize, so a shaky finger cannot change the size by
  // accident while asking for a face to be turned towards you.
  let lastTap = null;
  cv.addEventListener('pointerdown', e => {
    if (!e.isPrimary) return;
    const now = performance.now();
    // clean means the press before this one was a tap, not the start of a drag: two quick strokes
    // of turning the solid from the same spot are not a double tap.
    const quick = lastTap && lastTap.clean && now - lastTap.t < 450 &&
      Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 26;
    lastTap = {t: now, x: e.clientX, y: e.clientY, clean: false};
    if (quick){
      const f = pickSolid(e.clientX, e.clientY);
      if (f){
        lastTap = null;
        drag = null; pendingPick = null; facePull = null; faceSel = null;
        clearHighlight();
        faceViewer(f.gn);
        return;
      }
    }
    // Sphere handles take the press first.
    if (S.shape === 'sphere' && S.unfold === 0){
      const bnd = cv.getBoundingClientRect(), p = {x: e.clientX - bnd.left, y: e.clientY - bnd.top};
      const pts = A.handlePoints();
      if (pts){
        const dR = Math.hypot(p.x - pts.radius.x, p.y - pts.radius.y), dA = Math.hypot(p.x - pts.angle.x, p.y - pts.angle.y);
        if (Math.min(dR, dA) <= 26){
          drag = null; pendingPick = null;
          if (dR <= dA){
            // Radius: pull the handle out or in, as a face is pulled.
            startHold(new THREE.Vector3(1, 0, 0));
            facePull = {x0:e.clientX, y0:e.clientY, snap:Object.assign({}, S.dims.sphere), key:'r', mult:1, gn:new THREE.Vector3(1, 0, 0)};
          } else {
            angleDrag = {a0: Math.atan2(p.y - pts.centre.y, p.x - pts.centre.x), cut0: S.dims.sphere.cut, C: pts.centre};
          }
          return;
        }
      }
    }
    const hit = pickSolid(e.clientX, e.clientY);
    if (hit && faceSel && faceSel.shape === S.shape && faceSel.gn.dot(hit.gn) > 0.98){
      if (!highlight) highlightFace(faceSel.gn, S.shape);
      startHold(faceSel.gn);
      facePull = {x0:e.clientX, y0:e.clientY, snap:Object.assign({}, S.dims[S.shape]), key:faceSel.key, mult:faceSel.mult, gn:faceSel.gn.clone(),
        edge: faceSel.edge, pts0: S.custom ? S.custom.pts.map(q => q.slice()) : null};
      drag = null; // this press pulls the face, so it does not turn the solid
      pendingPick = null;
    } else {
      pendingPick = {x:e.clientX, y:e.clientY, gn: hit ? hit.gn : null};
    }
  });

  cv.addEventListener('pointermove', e => {
    if (pendingPick && Math.hypot(e.clientX - pendingPick.x, e.clientY - pendingPick.y) > 6) pendingPick = null;
    if (angleDrag){
      // The cut angle follows the pointer round the sphere's centre, in steps of 5 degrees.
      const bnd = cv.getBoundingClientRect(), p = {x: e.clientX - bnd.left, y: e.clientY - bnd.top};
      let deg = (Math.atan2(p.y - angleDrag.C.y, p.x - angleDrag.C.x) - angleDrag.a0) * 180 / Math.PI;
      if (deg > 180) deg -= 360;
      if (deg < -180) deg += 360;
      const cut = Math.max(0, Math.min(180, Math.round((angleDrag.cut0 + 2 * deg) / 5) * 5));
      if (cut !== S.dims.sphere.cut){ S.dims.sphere.cut = cut; A.rebuild(); sync(); A.renderPanel(); }
      return;
    }
    if (!facePull || !A.solid) return;
    const dxp = e.clientX - facePull.x0, dyUp = -(e.clientY - facePull.y0);
    camR.set(1, 0, 0).applyQuaternion(A.camera.quaternion);
    camU.set(0, 1, 0).applyQuaternion(A.camera.quaternion);
    const nW = facePull.gn.clone().transformDirection(A.solid.matrixWorld);
    const sx = nW.dot(camR), sy = nW.dot(camU);
    // Pixels per cm at the solid's distance from the camera.
    const pxPerCm = A.canvas.clientHeight / (2 * A.camera.position.length() * Math.tan(A.camera.fov * Math.PI / 360));
    const amount = (dxp * sx + dyUp * sy) / (Math.max(sx*sx + sy*sy, 0.09) * pxPerCm);
    if (facePull.key === 'side') pullSide(facePull.pts0, facePull.edge, amount);
    else S.dims[S.shape][facePull.key] = Math.min(12, Math.max(1, Math.round(facePull.snap[facePull.key] + facePull.mult * amount)));
    A.rebuild();
    sync();
    A.renderPanel();
    highlightFace(facePull.gn, S.shape);
  });

  // The party swallows every press and release while it runs, so whatever was being held when it
  // started would still be held afterwards and the solid would follow the pointer about. This puts
  // all of that down.
  A.releaseGrab = () => {
    drag = null;
    facePull = null;
    pendingPick = null;
    angleDrag = null;
    faceSel = null;
    lastTap = null;
    ptr3.clear();
    pd3 = 0;
    A.holdAnchor = null;
    A.holdView = false;
    clearHighlight();
  };

  const endFace = () => {
    if (angleDrag){ angleDrag = null; return; }
    if (facePull){
      // The selection is dropped after every pull. Otherwise the face stays armed and the next
      // drag across it resizes the solid again when it was meant to turn it.
      faceSel = null;
      clearHighlight();
      facePull = null;
      endHold();
      return;
    }
    if (!pendingPick) return;
    const pk = pendingPick;
    pendingPick = null;
    const map = pk.gn ? faceDimFor(S.shape, pk.gn) : null;
    if (map){
      faceSel = {gn: pk.gn.clone(), key: map.key, mult: map.mult, edge: map.edge, shape: S.shape};
      highlightFace(faceSel.gn, S.shape);
    } else {
      faceSel = null;
      clearHighlight();
    }
  };
  cv.addEventListener('pointerup', e => {
    if (!lastTap) return;
    if (Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) > 10) lastTap = null;
    else lastTap.clean = true;
  });
  cv.addEventListener('pointerup', endFace);
  cv.addEventListener('pointercancel', endFace);

  sync();
  resize();
  applyRotation();
  A.rebuild();
  A.renderPanel();
  A.active = false; // the 2D view opens first; switching to 3D turns this on
  loop();
})();
