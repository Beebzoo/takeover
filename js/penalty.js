/* ======================= TAKEOVER: THE DECIDING PENALTY =======================
   The last defender of a country is beaten from the spot. The scene is BALL's
   approved 3D shot (football-quiz-3/_proto/visual/shots3d-prototype.html): a
   floodlit stadium in three.js r128, jointed low-poly players, the keeper's dive
   and the net that bulges. Only the penalty camera is kept.

   Penalty.take({ attacker, keeperKit, saveChance, title, line }) -> Promise<"scored"|"saved"|null>
   null means the phone could not draw it (no WebGL / no three.js): the caller
   then decides as if the penalty went in. One renderer for the whole game. */
const Penalty = (() => {
  const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  const loadThree = () => window.THREE ? Promise.resolve(window.THREE) : (window.__threeP = window.__threeP || new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = THREE_URL; s.async = true;
    s.onload = () => window.THREE ? res(window.THREE) : rej(new Error("no three")); s.onerror = () => rej(new Error("three.js did not load"));
    document.head.appendChild(s);
  }));

  const CSS = `
.pen { position: absolute; inset: 0; z-index: 40; background: rgba(5,14,8,.94); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  padding-block: 16px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.pen > * { width: 100%; max-width: 560px; }
.pen h2 { margin: 0; font-family: var(--display, "Barlow Semi Condensed", sans-serif); font-weight: 900; font-style: italic; font-size: 2.1rem; line-height: 1; color: #F8F1DD; text-shadow: 0 2px 0 #7a5a10; }
.pen p { margin: 0; font-family: var(--body, Lora, Georgia, serif); font-style: italic; color: #cfe0d4; font-size: .98rem; line-height: 1.45; }
.pen .stage { position: relative; border: 2px solid #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 24px rgba(0,0,0,.45); background: #05080a; }
.pen canvas { display: block; width: 100%; height: auto; aspect-ratio: 620 / 420; }
.pen .spot { position: absolute; width: 20%; height: 11%; transform: translate(-50%, -50%); border: 2px dashed rgba(243,205,107,.95); border-radius: 10px;
  background: rgba(233,184,76,.16); cursor: pointer; animation: penPulse 1.2s ease-in-out infinite; }
.pen .spot:focus-visible { outline: 3px solid #fff; }
.pen .spot.hide { display: none; }
@keyframes penPulse { 50% { background: rgba(233,184,76,.34); } }
.pen .verdict { position: absolute; left: 0; right: 0; top: 38%; text-align: center; font-family: var(--display, "Barlow Semi Condensed", sans-serif); font-weight: 900; font-style: italic;
  font-size: 3.2rem; color: #f3cd6b; text-shadow: 0 3px 0 #7a5a10, 0 6px 18px rgba(0,0,0,.6); pointer-events: none; opacity: 0; transition: opacity .25s; }
.pen .verdict.show { opacity: 1; }
.pen .verdict.saved { color: #F8F1DD; text-shadow: 0 3px 0 #3b3524, 0 6px 18px rgba(0,0,0,.6); }
.pen .tip { font-family: var(--display, "Barlow Semi Condensed", sans-serif); font-style: normal; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; font-size: .72rem; color: #8FB79E; }
@media (prefers-reduced-motion: reduce) { .pen .spot { animation: none; } }`;

  let W = null;   // the built world: renderer, scene, actors, frame()

  function build() {
    const THREE = window.THREE;
    const cv = document.createElement("canvas");
    const lin = c => new THREE.Color(c).convertSRGBToLinear();
    const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(620, 420, false);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .82;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05080a); scene.fog = new THREE.Fog(0x05080a, 45, 110);
    const camera = new THREE.PerspectiveCamera(22, 620 / 420, .1, 300);

    /* light: floodlights, one of them throwing the shadows */
    scene.add(new THREE.HemisphereLight(lin(0xcfe3ff), lin(0x1d3b22), .6));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.25);
    sun.position.set(-11, 22, -9); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 80 }); sun.shadow.bias = -.0008; scene.add(sun);
    const fill = new THREE.DirectionalLight(0xdfe9ff, .55); fill.position.set(10, 14, 30); scene.add(fill);
    const back = new THREE.DirectionalLight(0xffffff, .35); back.position.set(0, 18, -30); scene.add(back);
    const mat = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color: lin(color), roughness: .85, metalness: 0, flatShading: true }, o || {}));
    const canvasTex = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); return t; };

    /* the pitch */
    const PX = 24, X0 = -44, X1 = 44, Z0 = -10, Z1 = 38;
    const pitchTex = canvasTex((X1 - X0) * PX, (Z1 - Z0) * PX, (g, w, h) => {
      const sx = x => (x - X0) * PX, sz = z => (z - Z0) * PX;
      g.fillStyle = "#17552a"; g.fillRect(0, 0, w, h);
      for (let z = 0, i = 0; z < Z1; z += 5.25, i++) { g.fillStyle = i % 2 ? "#164f27" : "#1f6a35"; g.fillRect(0, sz(z), w, 5.25 * PX); }
      for (let z = 0, i = 0; z > Z0; z -= 5.25, i++) { g.fillStyle = i % 2 ? "#1f6a35" : "#164f27"; g.fillRect(0, sz(z - 5.25), w, 5.25 * PX); }
      for (let i = 0; i < 40000; i++) { g.fillStyle = Math.random() < .5 ? "rgba(255,255,255,.035)" : "rgba(0,0,0,.05)"; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      const wear = (x, z, r) => { const gr = g.createRadialGradient(sx(x), sz(z), 0, sx(x), sz(z), r * PX); gr.addColorStop(0, "rgba(120,105,60,.45)"); gr.addColorStop(1, "rgba(120,105,60,0)"); g.fillStyle = gr; g.fillRect(sx(x) - r * PX, sz(z) - r * PX, 2 * r * PX, 2 * r * PX); };
      wear(0, 1, 2.6); wear(0, 11, .9);
      g.strokeStyle = "rgba(255,255,255,.92)"; g.lineWidth = .12 * PX; g.lineJoin = "round";
      const L = pts => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(sx(p[0]), sz(p[1])) : g.moveTo(sx(p[0]), sz(p[1]))); g.stroke(); };
      L([[X0, 0], [X1, 0]]); L([[-9.16, 0], [-9.16, 5.5], [9.16, 5.5], [9.16, 0]]); L([[-20.16, 0], [-20.16, 16.5], [20.16, 16.5], [20.16, 0]]);
      const a0 = Math.acos(5.5 / 9.15); g.beginPath(); g.arc(sx(0), sz(11), 9.15 * PX, Math.PI / 2 - a0, Math.PI / 2 + a0); g.stroke();
      g.fillStyle = "#fff"; g.beginPath(); g.arc(sx(0), sz(11), .13 * PX, 0, Math.PI * 2); g.fill();
    });
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 1 }));
    pitch.rotation.x = -Math.PI / 2; pitch.position.set((X0 + X1) / 2, 0, (Z0 + Z1) / 2); pitch.receiveShadow = true; scene.add(pitch);

    /* the goal and a net that can be pushed */
    const GW = 7.32, GH = 2.44, ND = 2.0, PR = .06;
    const white = mat(0xf4f6f5, { flatShading: false, roughness: .4 });
    for (const x of [-GW / 2 - PR, GW / 2 + PR]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(PR, PR, GH + PR, 12), white); m.position.set(x, (GH + PR) / 2, 0); m.castShadow = true; scene.add(m); }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(PR, PR, GW + 4 * PR, 12), white); bar.rotation.z = Math.PI / 2; bar.position.set(0, GH + PR, 0); bar.castShadow = true; scene.add(bar);
    for (const x of [-GW / 2 - PR, GW / 2 + PR]) { const s = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, Math.hypot(ND, GH), 6), mat(0xb9c3c2)); s.position.set(x, GH / 2, -ND / 2); s.rotation.x = Math.atan2(ND, GH); scene.add(s); }
    const netPts = [], netIdx = [];
    const addGrid = (nu, nv, f) => { const base = netPts.length; for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) netPts.push(f(i / nu, j / nv));
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const k = base + j * (nu + 1) + i; if (i < nu) netIdx.push(k, k + 1); if (j < nv) netIdx.push(k, k + nu + 1); } };
    addGrid(30, 10, (a, b) => new THREE.Vector3(-GW / 2 + a * GW, b * GH, -ND));
    addGrid(30, 8, (a, b) => new THREE.Vector3(-GW / 2 + a * GW, GH, -b * ND));
    addGrid(8, 10, (a, b) => new THREE.Vector3(-GW / 2, b * GH, -a * ND));
    addGrid(8, 10, (a, b) => new THREE.Vector3(GW / 2, b * GH, -a * ND));
    const netBase = netPts.map(p => p.clone());
    const netGeo = new THREE.BufferGeometry().setFromPoints(netPts); netGeo.setIndex(netIdx);
    scene.add(new THREE.LineSegments(netGeo, new THREE.LineBasicMaterial({ color: 0xe8efe9, transparent: true, opacity: .55 })));
    const bulge = (hit, amt) => { const pos = netGeo.attributes.position;
      for (let i = 0; i < netBase.length; i++) { const b = netBase[i]; let z = b.z;
        if (hit && amt) { const d = Math.hypot(b.x - hit.x, b.y - hit.y) / 1.3; const w = Math.max(0, 1 - d * d); z = b.z - .9 * amt * w * (b.z < -ND + .01 ? 1 : .5); }
        pos.setXYZ(i, b.x, b.y, z); }
      pos.needsUpdate = true; };

    /* boards, a stand, floodlights: our own boards, no real sponsors */
    const boardTex = canvasTex(2048, 64, (g, w, h) => {
      const P = [["#123d24", "#f3cd6b", "TAKEOVER"], ["#f1efe8", "#123d24", "BALL"], ["#e9b84c", "#241B08", "TAKEOVER"], ["#0b2416", "#F8F1DD", "BALL"]];
      for (let x = 0, i = 0; x < w; x += 256, i++) { const p = P[i % 4]; g.fillStyle = p[0]; g.fillRect(x, 0, 256, h);
        g.fillStyle = p[1]; g.font = "italic 900 40px 'Barlow Semi Condensed', system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(p[2], x + 128, h / 2 + 2); }
    });
    boardTex.wrapS = THREE.RepeatWrapping; boardTex.repeat.set(2, 1);
    const boards = new THREE.Mesh(new THREE.BoxGeometry(64, .9, .1), [mat(0x111111), mat(0x111111), mat(0x111111), mat(0x111111), new THREE.MeshStandardMaterial({ map: boardTex, roughness: .6, emissive: 0x222222 }), mat(0x111111)]);
    boards.position.set(0, .45, -5.5); scene.add(boards);
    const crowdTex = canvasTex(2048, 1024, (g, w, h) => {
      g.fillStyle = "#1b1a1d"; g.fillRect(0, 0, w, h);
      const SH = ["#8e2a27", "#b9b4a8", "#26467f", "#a8892c", "#1d5a3a", "#a4521f", "#563066", "#1d2f52", "#c9c7c0", "#2e2e34", "#3a3a40", "#5a4a3a"], SK = ["#e8c39e", "#d7a77d", "#b98058", "#8a5a3a", "#f0d2b4"];
      for (let row = 0; row < 46; row++) { const y = row * 22 + 4; g.fillStyle = "#2a282c"; g.fillRect(0, y + 17, w, 5);
        for (let x = (row % 2) * 9; x < w; x += 18) { if (Math.random() < .1) continue;
          g.fillStyle = SH[(Math.random() * SH.length) | 0]; g.fillRect(x + Math.random() * 3, y + 8, 14, 11);
          g.fillStyle = SK[(Math.random() * SK.length) | 0]; g.beginPath(); g.arc(x + 7 + Math.random() * 2, y + 5, 4.6, 0, Math.PI * 2); g.fill(); } }
    });
    crowdTex.wrapS = THREE.RepeatWrapping; crowdTex.repeat.set(3, 1);
    const stand = new THREE.Mesh(new THREE.PlaneGeometry(130, 26), new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 1, color: 0x5e5e5e }));
    stand.position.set(0, 9.5, -16); stand.rotation.x = -.5; scene.add(stand);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(130, 90), mat(0x123d20)); apron.rotation.x = -Math.PI / 2; apron.position.set(0, -.02, 14); apron.receiveShadow = true; scene.add(apron);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(90, 1.4, .3), mat(0x0d0e10)); wall.position.set(0, .7, -10.2); scene.add(wall);
    for (const x of [-26, 26]) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(255,250,230,1)"); gr.addColorStop(.15, "rgba(255,248,224,.6)"); gr.addColorStop(1, "rgba(255,248,224,0)"); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }), depthWrite: false, transparent: true }));
      s.scale.set(16, 16, 1); s.position.set(x, 22, -24); scene.add(s); }

    /* a footballer: low-poly, jointed; the kit materials are kept so each penalty can recolour them */
    function player(o) {
      const skin = mat(o.skin || 0xd9a679), shirt = mat(o.shirt), shorts = mat(o.shorts), socks = mat(o.socks), boot = mat(0x16181a), hair = mat(o.hair || 0x2a1c12);
      const glove = o.gloves ? mat(0xf2f2ee) : skin;
      const root = new THREE.Group(), hips = new THREE.Group(); root.add(hips);
      const add = (parent, geo, m, x, y, z) => { const me = new THREE.Mesh(geo, m); me.position.set(x || 0, y || 0, z || 0); me.castShadow = true; parent.add(me); return me; };
      add(hips, new THREE.CylinderGeometry(.19, .17, .2, 7), shorts, 0, -.02, 0).scale.z = .7;
      const legs = [], knees = [];
      for (const s of [1, -1]) {
        const thigh = new THREE.Group(); thigh.position.set(s * .1, -.05, 0); hips.add(thigh);
        add(thigh, new THREE.CylinderGeometry(.085, .07, .2, 7), shorts, 0, -.08, 0);
        add(thigh, new THREE.CylinderGeometry(.07, .058, .32, 7), skin, 0, -.28, 0);
        const knee = new THREE.Group(); knee.position.y = -.43; thigh.add(knee);
        add(knee, new THREE.CylinderGeometry(.058, .045, .38, 7), socks, 0, -.2, 0);
        add(knee, new THREE.BoxGeometry(.1, .07, .25), boot, 0, -.42, .05);
        legs.push(thigh); knees.push(knee);
      }
      const torso = new THREE.Group(); torso.position.y = .06; hips.add(torso);
      const chest = add(torso, new THREE.CylinderGeometry(.22, .17, .56, 7), shirt, 0, .3, 0); chest.scale.z = .62;
      add(torso, new THREE.CylinderGeometry(.05, .055, .08, 6), skin, 0, .62, 0);
      const head = new THREE.Group(); head.position.y = .76; torso.add(head);
      add(head, new THREE.IcosahedronGeometry(.115, 1), skin);
      add(head, new THREE.SphereGeometry(.122, 8, 6, 0, Math.PI * 2, 0, Math.PI * .55), hair, 0, .02, -.01);
      const numCanvas = document.createElement("canvas"); numCanvas.width = numCanvas.height = 128;
      const numTex = new THREE.CanvasTexture(numCanvas); numTex.encoding = THREE.sRGBEncoding;
      const n = new THREE.Mesh(new THREE.PlaneGeometry(.24, .24), new THREE.MeshStandardMaterial({ map: numTex, transparent: true, roughness: .8 }));
      n.position.set(0, .34, o.front ? .125 : -.125); if (!o.front) n.rotation.y = Math.PI; torso.add(n);
      const setNumber = (num, ink) => { const g = numCanvas.getContext("2d"); g.clearRect(0, 0, 128, 128); g.fillStyle = ink; g.font = "900 96px 'Barlow Semi Condensed', system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(num, 64, 70); numTex.needsUpdate = true; };
      const arms = [], elbows = [];
      for (const s of [1, -1]) {
        const sh = new THREE.Group(); sh.position.set(s * .25, .53, 0); torso.add(sh);
        add(sh, new THREE.CylinderGeometry(.065, .058, .16, 6), shirt, 0, -.07, 0);
        add(sh, new THREE.CylinderGeometry(.05, .045, .16, 6), skin, 0, -.2, 0);
        const el = new THREE.Group(); el.position.y = -.28; sh.add(el);
        add(el, new THREE.CylinderGeometry(.045, .038, .25, 6), skin, 0, -.13, 0);
        add(el, new THREE.IcosahedronGeometry(o.gloves ? .07 : .05, 0), glove, 0, -.29, 0);
        arms.push(sh); elbows.push(el);
      }
      scene.add(root);
      const kit = (k) => { shirt.color.copy(lin(k.shirt)); shorts.color.copy(lin(k.shorts)); socks.color.copy(lin(k.socks)); setNumber(k.number, k.ink); if (k.skin) skin.color.copy(lin(k.skin)); };
      return { root, hips, torso, head, legs, knees, arms, elbows, kit };
    }
    function pose(f, p) {
      const g = k => p[k] || 0;
      f.legs[0].rotation.x = -g("hL"); f.legs[1].rotation.x = -g("hR");
      f.legs[0].rotation.z = g("lzL"); f.legs[1].rotation.z = -g("lzR");
      f.knees[0].rotation.x = g("kL"); f.knees[1].rotation.x = g("kR");
      f.arms[0].rotation.x = -g("sL"); f.arms[1].rotation.x = -g("sR");
      f.arms[0].rotation.z = g("zL"); f.arms[1].rotation.z = -g("zR");
      f.elbows[0].rotation.x = -g("eL"); f.elbows[1].rotation.x = -g("eR");
      f.torso.rotation.x = g("lean"); f.torso.rotation.y = g("twist"); f.head.rotation.y = g("look");
      const v = (h, k) => .43 * Math.cos(h) + .42 * Math.cos(h - k) + .06;
      f.hips.position.y = Math.max(v(g("hL"), g("kL")), v(g("hR"), g("kR"))) + g("air");
      f.hips.rotation.z = g("tilt");
    }
    const striker = player({ shirt: 0xe9b84c, shorts: 0xf4f4f0, socks: 0xe9b84c });
    const keeper = player({ shirt: 0xc8e637, shorts: 0x22252b, socks: 0x22252b, gloves: true, front: true });
    const ball = new THREE.Group(); scene.add(ball);
    const ballMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(.11, 1), mat(0xffffff)); ballMesh.castShadow = true; ball.add(ballMesh);
    (() => { const geo = ballMesh.geometry.toNonIndexed(); const cols = []; const n = geo.attributes.position.count / 3;
      for (let i = 0; i < n; i++) { const c = (i % 5 === 0) ? [.12, .14, .15] : [.97, .97, .97]; for (let k = 0; k < 3; k++) cols.push(...c); }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3)); ballMesh.geometry = geo; ballMesh.material = mat(0xffffff, { vertexColors: true }); })();

    /* the penalty: the clock, the flight, the dive (as the approved prototype) */
    const S = { ball: [0, 11], foot: "L", cam: [0, 1.6, 22], look: [0, .95, 4], fov: 22, bend: 0, lift: 1 };
    const K = { wait: .16, run: .44, plant: .5, hit: .535, thru: .6, land: .71 };
    const lerp = (a, b, t) => a + (b - a) * t, clamp = t => t < 0 ? 0 : t > 1 ? 1 : t, ease = t => t * t * (3 - 2 * t);
    const CORNER = { tl: [-2.95, 1.95], tr: [2.95, 1.95], bl: [-2.85, .35], br: [2.85, .35] };
    let OUT = "scored", SHOT = "bl", DIVE = "br";
    function flightAt(tgt, q) {
      const b0 = new THREE.Vector3(S.ball[0], .11, S.ball[1]), b1 = new THREE.Vector3(tgt[0], tgt[1], 0);
      const m = 1 - q, mx = (b0.x + b1.x) / 2, mz = (b0.z + b1.z) / 2;
      const x = m * m * b0.x + 2 * m * q * mx + q * q * b1.x, z = m * m * b0.z + 2 * m * q * mz + q * q * b1.z;
      const y = lerp(.11, tgt[1], q) + S.lift * Math.sin(q * Math.PI) * (tgt[1] < 1 ? .25 : .55);
      return new THREE.Vector3(x, y, z);
    }
    function frame(u) {
      const tgt = CORNER[SHOT], side = tgt[0] < 0 ? -1 : 1;
      const dT = CORNER[DIVE], dSide = dT[0] < 0 ? -1 : 1, dLow = dT[1] < 1;
      const BX = S.ball[0], BZ = S.ball[1];
      const aim = Math.atan2(tgt[0] - BX, 0 - BZ);
      const fwd = [Math.sin(aim), Math.cos(aim)], lx = [Math.cos(aim), -Math.sin(aim)];
      const kSide = S.foot === "L" ? 1 : -1, ck = S.foot === "L" ? "L" : "R", pk = S.foot === "L" ? "R" : "L";
      const cx = BX - lx[0] * kSide * .3 - fwd[0] * .32, cz = BZ - lx[1] * kSide * .3 - fwd[1] * .32;
      const wx = cx - fwd[0] * 2.3 - lx[0] * kSide * 1.8, wz = cz - fwd[1] * 2.3 - lx[1] * kSide * 1.8;
      const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
      const runYaw = aim + wrap(Math.atan2(cx - wx, cz - wz) - aim), waitYaw = lerp(aim, runYaw, .6);
      const P = {}; let sx = wx, sz = wz, yaw = waitYaw;
      const set = o => Object.assign(P, o), kp = (k, v) => { P[k + ck] = v; }, pp = (k, v) => { P[k + pk] = v; };
      if (u < K.wait) {
        const br = Math.sin(u * 40) * .02;
        set({ hL: .05, hR: -.05, kL: .08, kR: .08, zL: .18 + br, zR: .18 + br, eL: .3, eR: .3, lean: .04, look: -.35 * kSide });
      } else if (u < K.run) {
        const t = (u - K.wait) / (K.run - K.wait), a = ease(t), ph = t * Math.PI * 6, w = Math.sin(ph);
        sx = lerp(wx, cx - fwd[0] * .25, a); sz = lerp(wz, cz - fwd[1] * .25, a); yaw = a < .25 ? lerp(waitYaw, runYaw, a / .25) : lerp(runYaw, aim + kSide * .25, (a - .25) / .75);
        set({ hL: .75 * w, hR: -.75 * w, kL: 1.4 * Math.max(0, Math.sin(ph - 1.2)) + .2, kR: 1.4 * Math.max(0, Math.sin(ph - 1.2 + Math.PI)) + .2,
              sL: -.7 * w, sR: .7 * w, eL: 1.3, eR: 1.3, zL: .12, zR: .12, lean: .22, air: .05 * Math.abs(Math.sin(ph)) });
      } else if (u < K.plant) {
        const t = ease((u - K.run) / (K.plant - K.run));
        sx = lerp(cx - fwd[0] * .25, cx, t); sz = lerp(cz - fwd[1] * .25, cz, t); yaw = aim + kSide * .25;
        kp("h", lerp(-.2, -.85, t)); kp("k", lerp(.6, 1.95, t)); pp("h", lerp(.3, .35, t)); pp("k", lerp(.3, .45, t));
        pp("z", lerp(.3, 1.25, t)); kp("s", lerp(0, -.6, t)); kp("z", .35);
        set({ eL: .4, eR: .3, lean: lerp(.2, -.06, t), tilt: kSide * lerp(0, -.16, t), twist: kSide * lerp(0, .35, t) });
      } else if (u < K.hit) {
        const t = ease((u - K.plant) / (K.hit - K.plant));
        sx = cx; sz = cz; yaw = aim + kSide * .25;
        kp("h", lerp(-.85, .45, t)); kp("k", lerp(1.95, .12, t * t)); pp("h", .35); pp("k", .45); pp("z", 1.25); kp("s", lerp(-.6, -.2, t)); kp("z", .35);
        set({ eL: .4, eR: .3, lean: lerp(-.06, .26, t), tilt: kSide * lerp(-.16, -.12, t), twist: kSide * lerp(.35, -.05, t) });
      } else {
        const t = ease(clamp((u - K.hit) / (K.thru - K.hit))), r = ease(clamp((u - K.thru) / .12));
        sx = cx + fwd[0] * .25 * r; sz = cz + fwd[1] * .25 * r; yaw = aim + kSide * .25;
        kp("h", lerp(lerp(.45, 1.45, t), .2, r)); kp("k", lerp(lerp(.12, .3, t), .3, r)); pp("h", lerp(.35, -.2, t)); pp("k", lerp(.45, .25, t));
        pp("z", lerp(1.25, .5, t)); kp("s", lerp(-.2, .5, t)); kp("z", .3);
        set({ eL: .5, eR: .4, lean: lerp(.26, .12, t), twist: kSide * lerp(-.05, -.25, t), air: .1 * Math.sin(t * Math.PI) * (1 - r) });
        const c = ease(clamp((u - K.land - .05) / .12));
        if (c > 0) {
          if (OUT === "scored") { yaw = lerp(aim, aim + Math.PI * .9 * -kSide, c);
            set({ zL: lerp(.3, 2.6, c), zR: lerp(.5, 2.6, c), sL: 0, sR: 0, eL: 1, eR: 1, hL: .1, kL: .2, hR: .05, kR: .2, lean: -.12,
                  air: .25 * Math.abs(Math.sin(clamp((u - K.land - .12) / .25) * Math.PI * 2)) }); }
          else set({ zL: lerp(.3, 2.3, c), zR: lerp(.5, 2.3, c), sL: .6, sR: .6, eL: 2.3, eR: 2.3, lean: .3, hL: .1, kL: .2, hR: .05, kR: .2 });
        }
      }
      pose(striker, P); striker.root.position.set(sx, 0, sz); striker.root.rotation.y = yaw;

      const kx0 = 0, kz0 = .35;
      const G = {}; let gx = kx0, gy = 0, gz = kz0, groll = 0;
      const d = ease(clamp((u - (K.hit + .012)) / .1));
      const kface = Math.atan2(BX - kx0, BZ - kz0);
      if (u < K.hit + .012) {
        const hop = u > K.plant - .02 ? Math.sin(clamp((u - K.plant + .02) / .05) * Math.PI) : 0, sw = Math.sin(u * 30) * .03;
        Object.assign(G, { hL: .55, hR: .55, kL: 1.0, kR: 1.0, lzL: .18, lzR: .18, sL: .5, sR: .5, zL: .45 + sw, zR: .45 - sw, eL: .7, eR: .7, lean: .32, air: .08 * hop });
      } else {
        const reach = OUT === "saved" ? 1 : .78;
        const tx = kx0 + (dT[0] - kx0) * reach, ty = Math.max(.3, dT[1] * reach);
        const a = dLow ? 1.35 : .95, R = 2.15;
        const fx = tx - dSide * R * Math.sin(a), fy = Math.max(0, ty - R * Math.cos(a));
        gx = lerp(kx0, fx, d); gy = lerp(0, fy, d) + .35 * Math.sin(d * Math.PI) * (dLow ? .4 : 1); gz = lerp(kz0, .3, d);
        groll = -dSide * a * d;
        Object.assign(G, { zL: lerp(.45, 2.95, d), zR: lerp(.45, 2.95, d), sL: lerp(.5, 0, d), sR: lerp(.5, 0, d), eL: lerp(.7, .05, d), eR: lerp(.7, .05, d),
          lean: lerp(.32, 0, d), hL: lerp(.55, dSide > 0 ? .1 : .9, d), kL: lerp(1, dSide > 0 ? .1 : 1.4, d), hR: lerp(.55, dSide > 0 ? .9 : .1, d), kR: lerp(1, dSide > 0 ? 1.4 : .1, d),
          look: dSide * .4 * d });
        const fall = ease(clamp((u - K.land - .03) / .1));
        if (fall > 0) { gy = lerp(gy, .18, fall); groll = lerp(groll, -dSide * 1.5, fall);
          if (OUT === "saved" && dLow) Object.assign(G, { zL: lerp(2.95, 1.6, fall), zR: lerp(2.95, 1.6, fall), eL: 1.4 * fall, eR: 1.4 * fall }); }
      }
      pose(keeper, G);
      keeper.root.position.set(gx, gy, gz); keeper.root.rotation.set(0, kface * (1 - d), groll);
      if (u >= K.hit + .012) keeper.hips.position.y = .93;

      const q = clamp((u - K.hit) / (K.land - K.hit));
      let bp = new THREE.Vector3(BX, .11, BZ), spin = 0;
      if (u >= K.hit) {
        if (q < 1) { bp = flightAt(tgt, q); spin = q * 22; }
        else {
          const t = clamp((u - K.land) / .25);
          if (OUT === "scored") { bp.set(tgt[0] * (1 - .08 * t), Math.max(.11, lerp(tgt[1], .11, t * t)), -Math.min(1, t * 3) * (ND - .2)); spin = 22 + t * 4; }
          else if (dLow) { keeper.torso.updateMatrixWorld(true); const c = new THREE.Vector3(0, .35, .22).applyMatrix4(keeper.torso.matrixWorld);
            const f = ease(clamp((u - K.land - .03) / .1)); bp.set(lerp(tgt[0], c.x, f), lerp(tgt[1], c.y, f), lerp(0, c.z, f)); spin = 22; }
          else { bp.set(tgt[0] + side * 2.4 * t, Math.max(.11, tgt[1] + 1.2 * Math.sin(Math.min(1, t * 1.4) * Math.PI * .5) - 3.2 * t * t), 1.6 * t); spin = 22 + t * 10; }
        }
      }
      ball.position.copy(bp); ballMesh.rotation.set(-spin, spin * .3, 0);
      const sq = u >= K.hit && u < K.hit + .01; ball.scale.set(sq ? 1.2 : 1, sq ? .82 : 1, 1);
      bulge(OUT === "scored" ? { x: tgt[0], y: tgt[1] } : null, OUT === "scored" && u > K.land ? Math.max(0, 1 - (u - K.land) / .28) * (1 - .4 * Math.sin((u - K.land) * 40)) : 0);

      const push = ease(clamp((u - K.wait) / .5)), follow = ease(clamp((u - K.hit) / .2));
      camera.fov = S.fov; camera.updateProjectionMatrix();
      camera.position.set(S.cam[0], S.cam[1], S.cam[2] + (S.look[2] - S.cam[2]) * .04 * push);
      camera.lookAt(S.look[0] + (tgt[0] * .25) * follow, S.look[1], S.look[2]);
      renderer.render(scene, camera);
    }
    // where each corner of the goal sits on the canvas at the opening frame, in % of width/height
    function corners() {
      frame(0);
      const out = {};
      for (const k in CORNER) { const v = new THREE.Vector3(CORNER[k][0] * .82, CORNER[k][1] * (CORNER[k][1] > 1 ? .9 : 1.6), 0).project(camera); out[k] = [(v.x + 1) / 2 * 100, (1 - v.y) / 2 * 100]; }
      return out;
    }
    const setShot = (shot, dive, out) => { SHOT = shot; DIVE = dive; OUT = out; };
    return { cv, renderer, frame, corners, setShot, striker, keeper, DUR: 3400 };
  }

  function styleOnce() { if (document.getElementById("pen-css")) return; const st = document.createElement("style"); st.id = "pen-css"; st.textContent = CSS; document.head.appendChild(st); }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  async function take(o) {
    try { await loadThree(); if (!W) W = build(); } catch (e) { console.warn("Penalty scene unavailable:", e); return null; }
    styleOnce();
    const host = o.host || document.body;
    W.striker.kit({ shirt: o.attacker.shirt, shorts: o.attacker.shorts || "#F8F1DD", socks: o.attacker.shirt, number: o.attacker.number || "9", ink: o.attacker.ink || "#fff", skin: o.attacker.skin });
    W.keeper.kit({ shirt: o.keeperKit.shirt, shorts: o.keeperKit.shorts || "#22252b", socks: o.keeperKit.socks || "#22252b", number: "1", ink: o.keeperKit.ink || "#111", skin: o.keeperKit.skin });
    const el = document.createElement("div"); el.className = "pen"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Penalty");
    el.innerHTML = `<h2>${esc(o.title || "Penalty!")}</h2><p>${esc(o.line || "Pick your corner.")}</p>
      <div class="stage"><div class="verdict" aria-live="polite"></div></div>
      <p class="tip">Tap a corner of the goal</p>`;
    const stage = el.querySelector(".stage"); stage.prepend(W.cv);
    host.appendChild(el);
    W.setShot("bl", "br", "scored");
    const pos = W.corners();
    const LBL = { tl: "Top left", tr: "Top right", bl: "Bottom left", br: "Bottom right" };
    for (const k of ["tl", "tr", "bl", "br"]) { const b = document.createElement("button"); b.className = "spot"; b.dataset.k = k; b.setAttribute("aria-label", LBL[k]);
      b.style.left = pos[k][0] + "%"; b.style.top = pos[k][1] + "%"; stage.appendChild(b); }
    const shot = await new Promise(res => {
      const auto = setTimeout(() => res(["tl", "tr", "bl", "br"][Math.floor(Math.random() * 4)]), 9000);
      stage.querySelectorAll(".spot").forEach(b => b.onclick = () => { clearTimeout(auto); res(b.dataset.k); });
    });
    stage.querySelectorAll(".spot").forEach(b => b.classList.add("hide"));
    el.querySelector(".tip").textContent = "";
    // the keeper guesses: right corner with the defence's save chance, else one of the other three
    const saved = Math.random() < (o.saveChance == null ? .25 : o.saveChance);
    const others = ["tl", "tr", "bl", "br"].filter(k => k !== shot);
    W.setShot(shot, saved ? shot : others[Math.floor(Math.random() * 3)], saved ? "saved" : "scored");
    if (o.onKick) o.onKick();
    await new Promise(res => { const t0 = performance.now(); const step = now => { const u = Math.min(1, (now - t0) / W.DUR); W.frame(u); if (u < 1) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
    const v = el.querySelector(".verdict"); v.textContent = saved ? "Saved!" : "GOAL!"; v.classList.toggle("saved", saved); v.classList.add("show");
    if (o.onResult) o.onResult(saved ? "saved" : "scored");
    await new Promise(r => setTimeout(r, 1300));
    el.remove();
    return saved ? "saved" : "scored";
  }
  return { take, ready: () => !!W, load: () => loadThree().then(() => true, () => false) };
})();
