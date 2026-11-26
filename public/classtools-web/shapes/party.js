// Press things fast enough, or whirl the solid about, and it decides it has had enough of maths.
// Sunglasses drop onto its front face, the music comes in, and it dances until the clip runs out.
(function(){
  const A = window.App;
  const RUSH_MS = 2500;      // how long the frantic handling has to keep up without a breather
  const GAP_MS = 400;        // a longer pause than this and the run has ended
  const FALL_MS = 850;       // the glasses coming down
  const PARTY_MS = 6000;     // the length of the clip

  let on = false, t0 = 0, raf = 0, audio = null;
  let runStart = 0, lastHit = 0;
  let shade = null, glow = null, saved = null;

  // Every jab at a button, and every good swing of the solid, counts as one hit. Rotation is only
  // counted ten times a second so that an ordinary slow drag can never add up to a party.
  let lastSwing = 0;
  function hit(kind){
    if (on) return;
    const t = performance.now();
    if (kind === 'swing'){
      if (t - lastSwing < 100) return;
      lastSwing = t;
    }
    // A run is unbroken handling. Leave a real pause and it starts over, so ordinary working with
    // the buttons never adds up, however long a lesson goes on.
    if (!lastHit || t - lastHit > GAP_MS) runStart = t;
    lastHit = t;
    if (t - runStart >= RUSH_MS) start();
  }

  // Where the glasses should sit: across the front of the solid, two thirds of the way up it.
  function facePlace(){
    const c = A.current;
    if (!c || !A.canvas) return null;
    const s = c.size, box = [];
    for (let i = 0; i < 8; i++){
      const v = new THREE.Vector3((i & 1) ? s[0] : 0, (i & 2) ? s[1] : 0, (i & 4) ? s[2] : 0);
      A.content.localToWorld(v);
      v.project(A.camera);
      box.push(v);
    }
    const r = A.canvas.getBoundingClientRect();
    const xs = box.map(v => (v.x * 0.5 + 0.5) * r.width);
    const ys = box.map(v => (-v.y * 0.5 + 0.5) * r.height);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return {x: (x0 + x1) / 2, y: y1 - (y1 - y0) * 0.66, w: Math.max(70, (x1 - x0) * 0.58)};
  }

  function start(){
    if (on || !A.current || !A.active) return;
    on = true;
    runStart = lastHit = 0;
    const stage = A.stage;

    // Nothing else responds while this is going on.
    shade = document.createElement('div');
    shade.className = 'partyShade';
    stage.appendChild(shade);
    glow = document.createElement('div');
    glow.className = 'partyGlow';
    stage.appendChild(glow);

    const img = document.createElement('img');
    img.className = 'partyGlasses';
    img.src = 'glasses.png';
    stage.appendChild(img);

    saved = {
      quat: A.root.quaternion.clone(),
      pos: A.root.position.clone(),
      sun: A.sun.color.getHex(),
      fill: A.fill.color.getHex(),
      sunI: A.sun.intensity,
      fillI: A.fill.intensity
    };

    t0 = performance.now();
    let landed = false;
    const spin = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);

    const frame = () => {
      const t = performance.now() - t0;
      const p = facePlace();
      if (t < FALL_MS){
        // Floating down from above, easing as it arrives.
        const k = t / FALL_MS, e = 1 - Math.pow(1 - k, 3);
        if (p){
          img.style.width = p.w + 'px';
          img.style.left = p.x + 'px';
          img.style.top = (p.y - (1 - e) * (p.y + 160)) + 'px';
          img.style.opacity = Math.min(1, k * 3);
        }
      } else {
        if (!landed){
          landed = true;
          // The music starts the moment they land, opened up over a few hundredths of a second so
          // it does not begin on a click.
          try {
            audio = new Audio('party.mp3');
            audio.volume = 0;
            audio.play().then(() => {
              const v0 = performance.now();
              const up = () => {
                const k = Math.min(1, (performance.now() - v0) / 90);
                if (audio) audio.volume = k;
                if (k < 1) requestAnimationFrame(up);
              };
              up();
            }).catch(() => {});
          } catch (e){}
        }
        const d = t - FALL_MS;
        // Bouncing, swinging and turning, all off the same beat.
        const beat = d / 1000 * 4;
        const bounce = Math.abs(Math.sin(beat * Math.PI)) * 1.6;
        A.root.position.set(saved.pos.x + Math.sin(beat * Math.PI * 0.5) * 0.9, saved.pos.y + bounce, saved.pos.z);
        spin.setFromAxisAngle(axis, Math.sin(d / 520) * 0.85);
        const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(d / 330) * 0.18);
        A.root.quaternion.copy(saved.quat).premultiply(spin).premultiply(tilt);
        // Lights sweeping through the colours of a dance floor.
        const hue = (d / 1100) % 1;
        A.sun.color.setHSL(hue, 0.85, 0.6);
        A.fill.color.setHSL((hue + 0.45) % 1, 0.85, 0.6);
        A.sun.intensity = 0.9 + Math.abs(Math.sin(beat * Math.PI)) * 0.7;
        // Lights down, two coloured beams sweeping across, pulsing on the beat.
        const pulse = 0.3 + Math.abs(Math.sin(beat * Math.PI)) * 0.3;
        glow.style.background =
          'radial-gradient(circle at ' + (28 + Math.sin(d / 400) * 26) + '% 22%, hsla(' + Math.round(hue * 360) + ',95%,58%,' + pulse.toFixed(2) + '), transparent 52%),' +
          'radial-gradient(circle at ' + (72 - Math.sin(d / 330) * 26) + '% 74%, hsla(' + Math.round(((hue + 0.38) % 1) * 360) + ',95%,58%,' + pulse.toFixed(2) + '), transparent 52%),' +
          'radial-gradient(circle at ' + (50 + Math.cos(d / 520) * 30) + '% 50%, hsla(' + Math.round(((hue + 0.7) % 1) * 360) + ',95%,60%,.22), transparent 45%),' +
          'rgba(8,10,28,.34)';
        if (p){
          img.style.width = p.w + 'px';
          img.style.left = p.x + 'px';
          img.style.top = p.y + 'px';
        }
        if (d > PARTY_MS) return stop(img);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  function stop(img){
    cancelAnimationFrame(raf);
    if (audio){
      // Closed down as quickly as it opened, for the same reason.
      const a = audio, v0 = performance.now(), start = a.volume;
      const down = () => {
        const k = Math.min(1, (performance.now() - v0) / 120);
        a.volume = Math.max(0, start * (1 - k));
        if (k < 1) requestAnimationFrame(down); else { a.pause(); }
      };
      down();
      audio = null;
    }
    img.style.opacity = '0';
    img.style.transform = 'translate(-50%,-50%) translateY(40px) rotate(14deg)';
    setTimeout(() => img.remove(), 420);
    if (shade) shade.remove();
    if (glow) glow.remove();
    shade = glow = null;
    A.root.quaternion.copy(saved.quat);
    A.root.position.copy(saved.pos);
    A.sun.color.setHex(saved.sun);
    A.fill.color.setHex(saved.fill);
    A.sun.intensity = saved.sunI;
    A.fill.intensity = saved.fillI;
    // Nothing was ever let go of while the music was playing, so put it all down now.
    if (A.releaseGrab) A.releaseGrab();
    if (window.Area2D && window.Area2D.releaseGrab) window.Area2D.releaseGrab();
    on = false;
    runStart = lastHit = 0;
  }

  // Jabbing any button counts, wherever it is.
  document.addEventListener('pointerdown', e => {
    if (on) return;
    if (e.target && e.target.closest && e.target.closest('button')) hit('press');
  }, true);

  // While it is dancing nothing else answers: presses, wheels and keys are all swallowed.
  ['pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick', 'wheel', 'keydown'].forEach(type => {
    document.addEventListener(type, e => {
      if (!on) return;
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
    }, true);
  });

  window.Party = {hit, get on(){ return on; }};
})();
