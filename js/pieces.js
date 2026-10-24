/* ======================= TAKEOVER: THE FOOTBALLER PIECES =======================
   _plans/takeover-pieces.md. Every squad is a few painted footballer pieces on a
   base in the manager's colour, in the kits of real players in that squad, like
   the soldiers in Risk. Ported from the design reference _proto/takeover/pieces.html
   (makeFig -> Pieces.make, render -> Pieces.tick, shirt, burst, the scenes).

   Two fixes from the reference are kept on purpose:
   - every tween clamps its progress with Math.max(0, ...): a rAF timestamp can be
     earlier than the start time, and negative progress throws pieces off screen;
   - turning round is a HOP (lifted 9 units while flip passes 0), never a
     horizontal scale squash, which rendered hugely stretched in Chromium.

   The map tells the module when to skip animation (Skip replay, reduced motion)
   with Pieces.setSkip(fn): then every tween jumps to its end state at once. */
const Pieces = (() => {
  const NS = "http://www.w3.org/2000/svg";
  let KITS = {}, skip = () => false, paused = () => false;
  const FALLBACK = { body: "#f5f5f2", sleeve: "#f5f5f2", trim: "#1b1b1b", shorts: "#1b1b1b", socks: "#f5f5f2", ink: "#1b1b1b" };
  const SKINS = ["#e8b896", "#c98e64", "#8a5a3c", "#f1cdb0", "#6e4229", "#d9a27a"];
  const HAIRS = ["#2b1d14", "#14100c", "#6b4a2a", "#d8b46a", "#3a2a1e", "#1c1410"];
  const FONT = "Barlow Semi Condensed, Arial Narrow, sans-serif";
  const LINE = { stroke: "rgba(20,12,4,.45)", "stroke-width": .55, "stroke-linejoin": "round" };
  const UNDERSHIRT = { body: "#f2efe6", sleeve: "#f2efe6" };

  /* ---------- pure helpers (tested in _tests/takeover-pieces-test.js) ---------- */
  const hash = s => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  // 1 piece for 1-4 players, 2 for 5-9, 3 for 10 or more
  const tierOf = n => n <= 0 ? 0 : n <= 4 ? 1 : n <= 9 ? 2 : 3;
  // the players on show: the captain first, then the most famous, no duplicates
  function shown(squad, captain, fame, k) {
    const out = [], seen = new Set();
    const add = n => { if (out.length < k && n != null && !seen.has(n)) { seen.add(n); out.push(n); } };
    if (captain != null && squad.includes(captain)) add(captain);
    squad.slice().sort((a, b) => (fame[b] || 0) - (fame[a] || 0)).forEach(add);
    return out;
  }
  // a stable shirt number: 2-23 from the name; a captain gets the classic number for his position
  const number = (name, pos, captain) => captain && pos ? ({ F: 9, M: 10, D: 4, G: 1 })[pos] || 10 : 2 + hash(name) % 22;
  const surname = n => { const w = String(n).trim().split(/\s+/); if (w.length === 1) return w[0].toUpperCase();
    const pre = ["van", "de", "der", "da", "di", "dos", "del", "la", "le", "el", "von", "ter", "ten"];
    return (pre.includes(w[w.length - 2].toLowerCase()) ? w.slice(-2).join(" ") : w[w.length - 1]).toUpperCase(); };
  const progress = (now, t0, ms) => ms <= 0 ? 1 : Math.max(0, Math.min(1, (now - t0) / ms));
  const kitOf = id => KITS[id] || FALLBACK;

  function mix(a, b, t) {
    const h = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
    const x = h(a), y = h(b);
    return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
  }
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const ease = {
    io: t => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
    out: t => 1 - (1 - t) ** 3,
    in: t => t * t * t,
    back: t => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
    bounce: t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375; return n * (t -= 2.625 / d) * t + .984375; },
    lin: t => t
  };
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------- the loop: full speed while something animates, 30 fps for idle pieces on screen ---------- */
  const FIGS = new Set();
  let raf = 0, last = 0, active = 0;
  const idleOn = () => !skip() && !paused() && !(typeof document !== "undefined" && document.hidden);
  function anyIdle() { for (const f of FIGS) if (f.idle && f.onScreen !== false) return true; return false; }
  function wake() { if (!raf && typeof requestAnimationFrame !== "undefined") raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    // scene pieces (live) every frame while something animates; idle map pieces at most 30 fps; the rest only when dirty
    const full = active > 0, idle = idleOn(), slow = now - last >= 33;
    if (slow) last = now;
    for (const f of FIGS) if (f.dirty || (full && f.live) || (slow && idle && f.idle && f.onScreen !== false)) draw(f, now);
    if (full || (idle && anyIdle())) wake();
  }
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); });
  function tween(ms, fn, e = ease.io) {
    if (skip() || ms <= 0) { fn(e(1)); FIGS.forEach(f => { if (f.live) f.dirty = true; }); flush(); return Promise.resolve(); }
    active++; wake();
    return new Promise(res => {
      const t0 = performance.now();
      const step = now => { const t = progress(now, t0, ms); fn(e(t)); if (t < 1) requestAnimationFrame(step); else { active--; res(); } };
      requestAnimationFrame(step);
    });
  }
  const sleep = ms => skip() ? Promise.resolve() : new Promise(r => setTimeout(r, ms));
  function flush() { const now = typeof performance !== "undefined" ? performance.now() : 0; for (const f of FIGS) if (f.dirty) draw(f, now); }

  /* ---------- a loose shirt, for the shirt swap ---------- */
  function shirt(parent, kit, name, num) {
    const g = el("g", {}, parent);
    el("path", { d: "M-10,-12 L-17,-8 L-14,0 L-10,-2 Z", fill: kit.sleeve, ...LINE }, g);
    el("path", { d: "M10,-12 L17,-8 L14,0 L10,-2 Z", fill: kit.sleeve, ...LINE }, g);
    el("path", { d: "M-10,-12 L-10,11 L10,11 L10,-12 Q0,-8 -10,-12 Z", fill: kit.body, ...LINE }, g);
    if (kit.stripe) for (const x of [-6, 0, 6]) el("rect", { x: x - 1.6, y: -10.5, width: 3.2, height: 21.5, fill: kit.stripe }, g);
    el("path", { d: "M-4,-10.5 Q0,-7.5 4,-10.5", stroke: kit.trim, "stroke-width": 1.2, fill: "none" }, g);
    const t1 = el("text", { x: 0, y: -3.2, "text-anchor": "middle", fill: kit.ink, "font-family": FONT, "font-weight": 800, "font-size": Math.min(4.4, 40 / Math.max(1, name.length)) }, g); t1.textContent = name;
    const t2 = el("text", { x: 0, y: 9, "text-anchor": "middle", fill: kit.ink, "font-family": FONT, "font-weight": 800, "font-size": 11.5 }, g); t2.textContent = num;
    return g;
  }

  /* ---------- the piece: a painted footballer on a base in the manager's colour ---------- */
  function make(parent, o) {
    const c = o.base, cDark = o.baseDark || mix(c, "#000000", .35), cLight = mix(c, "#ffffff", .45);
    const kit = o.kit || FALLBACK, hh = hash(o.name);
    const skin = o.skin || SKINS[hh % SKINS.length], skinD = mix(skin, "#000000", .22);
    const hair = o.hair || HAIRS[(hh >>> 3) % HAIRS.length];
    const f = { x: o.x || 0, y: o.y || 0, s: o.s || 1, tilt: 0, hop: 0, run: false, idle: o.idle !== false, op: 1, ph: (hh % 628) / 100, lean: 0,
      flip: 1, raiseL: 10, raiseR: 10, kick: 0, big: !!o.big, dirty: true, onScreen: true, name: o.name, live: !!o.live };
    f.root = el("g", {}, parent);
    f.shadow = el("ellipse", { cx: 0, cy: 3, rx: 17, ry: 5, fill: "#2a1d08", opacity: .25 }, f.root);
    f.tiltG = el("g", {}, f.root);
    const T = f.tiltG;
    el("ellipse", { cx: 0, cy: 3, rx: 15.5, ry: 5.4, fill: cDark }, T);
    el("rect", { x: -15.5, y: -.4, width: 31, height: 3.4, fill: cDark }, T);
    el("ellipse", { cx: 0, cy: 0, rx: 15.5, ry: 5.4, fill: c }, T);
    el("ellipse", { cx: 0, cy: -.2, rx: 13.2, ry: 4.2, fill: "none", stroke: cLight, "stroke-width": .8, opacity: .7 }, T);
    el("ellipse", { cx: -5, cy: -1.4, rx: 6, ry: 1.6, fill: "#fff", opacity: .3 }, T);
    if (o.home) {   // a home-grown captain: a tiny gold flag on his base
      el("path", { d: "M11.5,-.5 L11.5,-12", stroke: "#7a5a10", "stroke-width": .9 }, T);
      el("path", { d: "M11.5,-12 L17.5,-10 L11.5,-8 Z", fill: "#f3cd6b", ...LINE }, T);
    }
    f.body = el("g", {}, T);
    const B = f.body;
    const leg = sx => {
      const g = el("g", {}, B);
      el("rect", { x: sx - 2.4, y: -23, width: 4.8, height: 12, rx: 2.2, fill: skin, ...LINE }, g);
      el("rect", { x: sx - 2.6, y: -13, width: 5.2, height: 11, rx: 1.6, fill: kit.socks, ...LINE }, g);
      el("rect", { x: sx - 2.6, y: -13, width: 5.2, height: 1.6, fill: mix(kit.socks, "#000000", .2) }, g);
      el("path", { d: `M${sx - 2.8},-2.6 L${sx + 2.8},-2.6 L${sx + 4.2},-.4 Q${sx + 4.2},.8 ${sx + 2.6},.8 L${sx - 2.8},.8 Z`, fill: "#1b1714", ...LINE }, g);
      el("path", { d: `M${sx - 2.4},-.2 L${sx + 3.6},-.2`, stroke: "#e9b84c", "stroke-width": .6 }, g);
      return g;
    };
    f.legL = leg(-3.6); f.legR = leg(3.6);
    el("path", { d: "M-8.6,-27 L8.6,-27 L9.4,-18.5 L1,-18.5 L0,-21 L-1,-18.5 L-9.4,-18.5 Z", fill: kit.shorts, ...LINE }, B);
    el("path", { d: "M0,-27 L0,-21", stroke: "rgba(0,0,0,.25)", "stroke-width": .5 }, B);
    const arm = (sx, side) => {
      const g = el("g", {}, B);
      el("rect", { x: sx - 2, y: -42, width: 4, height: 17, rx: 2, fill: skin, ...LINE }, g);
      el("path", { d: `M${sx - 2.8},-43.5 L${sx + 2.8},-43.5 L${sx + 2.6},-35 L${sx - 2.6},-35 Z`, fill: kit.sleeve, ...LINE }, g);
      el("rect", { x: sx - 2.6, y: -36.4, width: 5.2, height: 1.4, fill: kit.trim }, g);
      el("circle", { cx: sx, cy: -24.6, r: 2.3, fill: skin, ...LINE }, g);
      if (o.captain && side < 0) el("rect", { x: sx - 2.7, y: -40, width: 5.4, height: 2.2, fill: "#f3cd6b", ...LINE }, g);   // the armband
      return g;
    };
    f.armL = arm(-11.2, -1); f.armR = arm(11.2, 1);
    f.torso = el("path", { d: "M-9.4,-44.5 Q0,-46.5 9.4,-44.5 L9,-26 Q0,-25 -9,-26 Z", fill: kit.body, ...LINE }, B);
    f.stripes = el("g", {}, B);
    if (kit.stripe) for (const x of [-5, 0, 5]) el("rect", { x: x - 1.3, y: -45.2, width: 2.6, height: 19, fill: kit.stripe }, f.stripes);
    el("path", { d: "M1,-45 Q6,-45.5 9.4,-44.5 L9,-26 Q5,-25.4 2,-25.6 Z", fill: "#000", opacity: .1 }, B);
    el("path", { d: "M-9,-27.5 Q0,-26.5 9,-27.5", stroke: "rgba(0,0,0,.18)", "stroke-width": 1.2, fill: "none" }, B);
    el("rect", { x: -2.4, y: -48.5, width: 4.8, height: 5, fill: skinD }, B);
    f.front = el("g", {}, B);
    el("path", { d: "M-3.6,-45.6 L0,-41.6 L3.6,-45.6", stroke: kit.trim, "stroke-width": 1.4, fill: "none", "stroke-linejoin": "round" }, f.front);
    const n1 = el("text", { x: 0, y: -31, "text-anchor": "middle", fill: kit.ink, "font-family": FONT, "font-weight": 800, "font-size": 7.5 }, f.front); n1.textContent = o.num;
    el("circle", { cx: -5.2, cy: -40.2, r: 1.5, fill: kit.trim, opacity: .9 }, f.front);
    f.back = el("g", { display: "none" }, B);
    el("path", { d: "M-3.6,-45.6 Q0,-44.2 3.6,-45.6", stroke: kit.trim, "stroke-width": 1.4, fill: "none" }, f.back);
    const label = surname(o.name);
    const nm = el("text", { x: 0, y: -38.8, "text-anchor": "middle", fill: kit.ink, "font-family": FONT, "font-weight": 800, "font-size": Math.min(3.6, 34 / Math.max(1, label.length)).toFixed(2), "letter-spacing": .15 }, f.back); nm.textContent = label;
    const n2 = el("text", { x: 0, y: -28.6, "text-anchor": "middle", fill: kit.ink, "font-family": FONT, "font-weight": 800, "font-size": 10.5 }, f.back); n2.textContent = o.num;
    el("ellipse", { cx: -6.6, cy: -54, rx: 1.5, ry: 2.2, fill: skinD }, B);
    el("ellipse", { cx: 6.6, cy: -54, rx: 1.5, ry: 2.2, fill: skinD }, B);
    el("ellipse", { cx: 0, cy: -55, rx: 6.6, ry: 7.4, fill: skin, ...LINE }, B);
    el("path", { d: "M1.5,-62 Q6.6,-60 6.6,-55 Q6.4,-50 1.5,-48 Q4,-55 1.5,-62 Z", fill: "#000", opacity: .1 }, B);
    const hairFront = el("g", {}, f.front);
    el("path", { d: "M-6.8,-55 Q-7.4,-63.6 0,-63.8 Q7.4,-63.6 6.8,-55 Q5.4,-59.4 1.4,-59.6 Q-2,-58.2 -5,-59 Q-6.2,-57.6 -6.8,-55 Z", fill: hair, ...LINE }, hairFront);
    el("path", { d: "M-3,-62.4 Q1,-63.4 4,-61.8", stroke: mix(hair, "#ffffff", .3), "stroke-width": .8, fill: "none" }, hairFront);
    // a simple painted face, the same for everyone: never a real player's likeness
    el("ellipse", { cx: -2.4, cy: -54.6, rx: .9, ry: 1.1, fill: "#1b120c" }, f.front);
    el("ellipse", { cx: 2.4, cy: -54.6, rx: .9, ry: 1.1, fill: "#1b120c" }, f.front);
    el("path", { d: "M-3.4,-56.8 L-1.4,-57.2 M1.4,-57.2 L3.4,-56.8", stroke: hair, "stroke-width": .8, "stroke-linecap": "round" }, f.front);
    el("path", { d: "M-1.6,-51.2 Q0,-50.2 1.6,-51.2", stroke: mix(skin, "#5a2a1a", .5), "stroke-width": .7, fill: "none", "stroke-linecap": "round" }, f.front);
    el("ellipse", { cx: -4, cy: -52.4, rx: 1.4, ry: .8, fill: "#e07060", opacity: .25 }, f.front);
    el("ellipse", { cx: 4, cy: -52.4, rx: 1.4, ry: .8, fill: "#e07060", opacity: .25 }, f.front);
    el("path", { d: "M-6.8,-53 Q-7.6,-63.8 0,-63.8 Q7.6,-63.8 6.8,-53 Q5,-50.6 0,-50.4 Q-5,-50.6 -6.8,-53 Z", fill: hair, ...LINE }, f.back);
    el("path", { d: "M-3,-61.6 Q0,-58 3,-61.6 M-4.6,-57 Q0,-54.6 4.6,-57", stroke: mix(hair, "#ffffff", .25), "stroke-width": .7, fill: "none" }, f.back);
    el("ellipse", { cx: -2.6, cy: -61.2, rx: 2.4, ry: 1.2, fill: "#fff", opacity: .25 }, B);
    f.recolor = k => {
      f.torso.setAttribute("fill", k.body);
      f.stripes.style.display = k.stripe ? "" : "none";
      [f.armL, f.armR].forEach(a => a.children[1].setAttribute("fill", k.sleeve));
    };
    f.remove = () => { FIGS.delete(f); f.root.remove(); };
    FIGS.add(f);
    draw(f, typeof performance !== "undefined" ? performance.now() : 0);
    if (f.idle) wake();
    return f;
  }
  // one frame of one piece (the reference's render, per piece)
  function draw(f, now) {
    f.dirty = false;
    const idle = f.idle && !f.run && idleOn();
    const bob = idle ? Math.sin(now * .003 + f.ph) * .8 : 0;
    const sw = f.run ? Math.sin(now * .028 + f.ph) : 0;
    const runHop = f.run ? Math.abs(sw) * 2.6 : 0;
    const idleArm = idle ? Math.sin(now * .002 + f.ph) * 3 : 0;
    f.root.setAttribute("transform", `translate(${f.x.toFixed(2)},${f.y.toFixed(2)}) scale(${(f.s * (f.big ? 1 : 1.22)).toFixed(4)})`);
    f.root.setAttribute("opacity", f.op);
    f.shadow.setAttribute("rx", (17 - Math.min(10, (f.hop + runHop) * .4)).toFixed(1));
    // the hop-turn: lifted while flip passes 0, front/back swapped at 0 (no horizontal squash)
    f.tiltG.setAttribute("transform", `translate(0,${(-f.hop - runHop + bob - (1 - Math.abs(f.flip)) * 9).toFixed(1)}) rotate(${(f.tilt + f.lean).toFixed(1)})`);
    const back = f.flip < 0;
    f.front.setAttribute("display", back ? "none" : "inline");
    f.back.setAttribute("display", back ? "inline" : "none");
    f.legL.setAttribute("transform", `rotate(${(sw * 32 + f.kick).toFixed(1)} -3.6 -23)`);
    f.legR.setAttribute("transform", `rotate(${(-sw * 32).toFixed(1)} 3.6 -23)`);
    f.armL.setAttribute("transform", `rotate(${(f.raiseL + idleArm - sw * 28).toFixed(1)} -11.2 -42)`);
    f.armR.setAttribute("transform", `rotate(${(-f.raiseR - idleArm - sw * 28).toFixed(1)} 11.2 -42)`);
  }
  const redraw = f => { f.dirty = true; draw(f, typeof performance !== "undefined" ? performance.now() : 0); };

  /* ---------- small things ---------- */
  function plaque(parent, x, y, n, hex, ink) {
    const g = el("g", { transform: `translate(${x},${y})` }, parent);
    const inner = el("g", { class: "pq" }, g);
    el("rect", { x: -11, y: -7.5, width: 22, height: 15, rx: 4, fill: hex, stroke: "#fff", "stroke-width": 1.6 }, inner);
    const t = el("text", { x: 0, y: 4.5, "text-anchor": "middle", fill: ink || "#fff", "font-size": 12, "font-weight": 800, "font-family": FONT }, inner);
    t.textContent = n; g.t = t; g.inner = inner; return g;
  }
  function burst(parent, x, y, color, n = 10, scale = 1) {
    if (skip()) return;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * 2 * i / n + (i * 2.39 % .4), d = (16 + (i * 7 % 14)) * scale;
      const p = el("rect", { width: 3 * scale, height: 5 * scale, fill: i % 2 ? color : "#ffffff", x: -1.5 * scale, y: -2.5 * scale }, parent);
      tween(700, k => { p.setAttribute("transform", `translate(${x + Math.cos(a) * d * k},${y + Math.sin(a) * d * k + 18 * scale * k * k}) rotate(${k * 360})`); p.setAttribute("opacity", 1 - k); }, ease.out).then(() => p.remove());
    }
  }
  async function moveTo(f, x, y, ms, e = ease.io) { f.live = true; const x0 = f.x, y0 = f.y; await tween(ms, k => { f.x = lerp(x0, x, k); f.y = lerp(y0, y, k); f.dirty = true; }, e); }
  async function fadeOut(figs, ms = 300) { figs.forEach(f => f.live = true); await tween(ms, k => figs.forEach(f => { f.op = 1 - k; f.dirty = true; })); figs.forEach(f => f.remove()); }

  /* ---------- a static piece as an SVG string (the globe's badges: no animation there) ---------- */
  let scratch = null;
  function svgString(o, count, plaqueHex, plaqueInk) {
    if (!scratch) { scratch = document.createElementNS(NS, "svg"); scratch.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden"); document.body.appendChild(scratch); }
    const g = el("g", {}, scratch);
    const f = make(g, Object.assign({}, o, { x: 0, y: 0, s: 1, idle: false }));
    if (count != null) { const p = plaque(g, 0, 14, count, plaqueHex, plaqueInk); p.inner.setAttribute("class", "pop"); }
    const out = `<svg viewBox="-24 -84 48 108" xmlns="${NS}">${g.innerHTML}</svg>`;
    f.remove(); g.remove();
    return out;
  }

  return {
    // data + settings
    setKits(k) { KITS = k || {}; }, setSkip(fn) { skip = fn; }, setPaused(fn) { paused = fn; wake(); },
    kitOf, FALLBACK, UNDERSHIRT,
    // pure helpers
    hash, tierOf, shown, number, surname, progress, mix, ease, lerp,
    // drawing
    make, redraw, shirt, plaque, burst, moveTo, fadeOut, svgString, el,
    // animation
    tween, sleep, wake, get count() { return FIGS.size; }, get active() { return active; },
    all: () => FIGS
  };
})();
if (typeof module !== "undefined") module.exports = Pieces;
