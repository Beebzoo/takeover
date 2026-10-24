/* Takeover: the game. Map, globe view, turns, battles, scenes. Data comes from data/*.js (window.TK_*). */
const WORLD = window.TK_WORLD;
const GAME = window.TK_GAME;
const KITS = window.TK_KITS;

/* ================= settings (from sim-results.md) ================= */
const RULES = {
  baseSecs: 15, perTerr: 0.5, maxSecs: 60,
  confedSecs: { UEFA: 14, AFC: 8, CAF: 10, CONMEBOL: 6, CONCACAF: 5, OFC: 2 },
  confedPts: { UEFA: 7, AFC: 4, CAF: 5, CONMEBOL: 3, CONCACAF: 3, OFC: 1 },
  attacksPerTurn: 2, movesPerTurn: 3, lastStandsPerRound: 1, squadCap: 30, questionSecs: 15,
  botRate: 0.4, botAcc: { easy: .85, normal: .65, hard: .45 },
  // computer strength: how fast they scout and how often they answer right (Medium = the simulated balance)
  levels: { easy: { rate: .28, acc: { easy: .7, normal: .5, hard: .3 }, keeper: -.06 },
            medium: { rate: .4, acc: { easy: .85, normal: .65, hard: .45 }, keeper: 0 },
            hard: { rate: .52, acc: { easy: .93, normal: .8, hard: .62 }, keeper: .06 } },
  stadiumPts: 5, motmPts: 2, underdogSecs: 5, underdogGap: 3,
};
const SEATS = [
  { name: "You", short: "You", color: "var(--you)", hex: "#e9b84c", ink: "#241B08" },
  { name: "Gegenpress", short: "Gegen", color: "var(--c1)", hex: "#4f86c6", ink: "#fff" },
  { name: "Parks the Bus", short: "Bus", color: "var(--c2)", hex: "#8c3a5c", ink: "#fff" },
  { name: "The Tinkerer", short: "Tinker", color: "var(--c3)", hex: "#3f8f7f", ink: "#fff" },
];
const NEUTRAL = { name: "Unclaimed", hex: "#cbbf9c", ink: "#3b3524" };
const T = {}; for (const t of WORLD.territories) T[t.id] = t;
const IDS = WORLD.territories.map(t => t.id);
const CONFEDS = [...new Set(WORLD.territories.map(t => t.confed))];

/* ================= helpers ================= */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const seatOf = id => S.owner[id];
const colorOf = id => S.owner[id] == null ? NEUTRAL.hex : SEATS[S.owner[id]].hex;
const inkOf = id => S.owner[id] == null ? NEUTRAL.ink : SEATS[S.owner[id]].ink;
const ownerName = id => S.owner[id] == null ? NEUTRAL.name : SEATS[S.owner[id]].name;
const tierFor = n => n <= 3 ? "easy" : n <= 8 ? "normal" : "hard";
const TIER_LABEL = { easy: "Easy", normal: "Medium", hard: "Hard" };

/* ================= the season ================= */
// rounds are months; August and January are transfer windows with double scouting time
const MONTHS = ["August", "September", "October", "November", "December", "January", "February", "March", "April", "May"];
function season() {
  const r = S.rounds;
  if (r === 10) return MONTHS;
  if (r === 6) return ["August", "October", "December", "January", "March", "May"];
  if (r === 15) return [...MONTHS, "August", "September", "October", "November", "December"];
  return Array.from({ length: r }, (_, i) => MONTHS[Math.round(i * (MONTHS.length - 1) / Math.max(1, r - 1))]);
}
const monthOf = (round = S.round) => season()[Math.min(round, S.rounds) - 1];
const isWindow = (round = S.round) => ["August", "January"].includes(monthOf(round));

/* ================= derbies ================= */
// a derby battle: a banner, a louder crowd, and every question one level harder
const DERBIES = [
  ["argentina", "brazil", "The Superclásico of the Americas"], ["netherlands", "germany", "The old rivals"],
  ["spain", "portugal", "The Iberian derby"], ["italy", "france", "Azzurri v Les Bleus"], ["mexico", "usa", "Dos a Cero"],
  ["japan", "korea", "The East Asian derby"], ["morocco", "northafrica", "The Maghreb derby"], ["ghana", "nigeria", "The Jollof derby"],
  ["ivorycoast", "ghana", "The West African derby"], ["brazil", "uruparaguay", "The Maracanazo"], ["argentina", "uruparaguay", "The Río de la Plata derby"],
  ["belgium", "netherlands", "The Low Countries derby"], ["denmark", "nordics", "The Scandinavian derby"], ["britain", "ireland", "The Irish Sea derby"],
  ["iran", "gulf", "The Gulf derby"], ["australia", "newzealand", "The Trans-Tasman derby"], ["germany", "swissaustria", "The Alpine derby"],
  ["argentina", "chilebolivia", "The Andes derby"],
];
const derbyOf = (a, b) => { const d = DERBIES.find(([x, y]) => (x === a && y === b) || (x === b && y === a)); return d ? d[2] : null; };
const up = t => t === "easy" ? "normal" : "hard";

/* ================= captains + home-grown ================= */
// every name knows its country and fame; the most famous player in a squad is its captain
const HOME = {}, FAME = {}, HOME_NAT = {};   // name -> territory, fame, exact country code
const POS = {};
for (const id of IDS) for (const [n, f, ps, nat] of GAME[id].p) if (!(n in HOME)) { HOME[n] = id; FAME[n] = f; POS[n] = ps || "M"; if (nat) HOME_NAT[n] = nat; }
function captainOf(id) { let c = null; for (const n of S.squad[id]) if (c === null || (FAME[n] || 0) > (FAME[c] || 0)) c = n; return c; }
// home crowd: a home-grown captain makes the first question of an attack one level harder
const homeCrowd = id => { const c = captainOf(id); return !!c && HOME[c] === id; };
const HG = '<i class="hg" title="Home-grown"></i>';
function sheetNames(id, list = S.squad[id], cap = captainOf(id)) {
  const order = cap && list.includes(cap) ? [cap, ...list.filter(n => n !== cap)] : list;
  return order.map(n => (n === cap ? '<b class="c">(C)</b> ' : "") + esc(n) + (HOME[n] === id ? HG : "")).join(" · ");
}

/* ================= sound (made in the browser, no recordings) ================= */
const sfx = (() => {
  let ctx = null, buf = null, on = store.get("tk-sound", true);
  const ac = () => {
    if (!on) return null;
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === "suspended") ctx.resume(); return ctx; } catch (e) { return null; }
  };
  const noise = c => {   // pink-ish noise: the raw material of a crowd
    if (buf) return buf;
    buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0); let b = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = .97 * b + .03 * w; d[i] = w * .35 + b * 3; }
    return buf;
  };
  function crowd(dur = 2, peak = .3, freq = 900, fall = 0) {
    const c = ac(); if (!c) return;
    const t = c.currentTime, src = c.createBufferSource(); src.buffer = noise(c); src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = .7; bp.frequency.setValueAtTime(freq, t);
    if (fall) bp.frequency.exponentialRampToValueAtTime(fall, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + dur * .4); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 2.5 + Math.random() * 2; lg.gain.value = peak * .3; lfo.connect(lg); lg.connect(g.gain);
    src.connect(bp); bp.connect(g); g.connect(c.destination);
    src.start(t); src.stop(t + dur + .05); lfo.start(t); lfo.stop(t + dur);
  }
  function whistle(kind) {   // a pea whistle: a high tone with a fast trill
    const c = ac(); if (!c) return;
    const t0 = c.currentTime, blasts = kind === "full" ? [[0, .22], [.32, .22], [.64, .9]] : kind === "long" ? [[0, .75]] : [[0, .25]];
    for (const [at, len] of blasts) {
      const t = t0 + at, o = c.createOscillator(), fm = c.createOscillator(), fg = c.createGain(), g = c.createGain();
      o.frequency.value = 2750; fm.frequency.value = 26; fg.gain.value = 140; fm.connect(fg); fg.connect(o.frequency);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.16, t + .03); g.gain.setValueAtTime(.16, t + len - .05); g.gain.exponentialRampToValueAtTime(.0001, t + len);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + len + .02); fm.start(t); fm.stop(t + len + .02);
    }
  }
  return {
    get on() { return on; },
    toggle() { on = !on; store.set("tk-sound", on); if (on) whistle("short"); return on; },
    crowd, whistle,
    cheer: () => crowd(1.1, .22, 1300),
    groan: () => crowd(1.3, .16, 700, 250),
    roar: (p = .55) => crowd(3.2, p, 800),
  };
})();

/* ================= name matching (as in the-lists.md §6.1, tested in burst.html) ================= */
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/ß/g, "ss").replace(/ø/g, "o").replace(/æ/g, "ae").replace(/ł/g, "l").replace(/đ/g, "d").replace(/ı/g, "i")
  .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const PARTICLES = new Set(["van","de","der","den","da","dos","das","di","del","la","le","el","al","von","ten","ter","mac"]);
const IDX = {};
function nationIndex(tid) {
  if (IDX[tid]) return IDX[tid];
  const players = GAME[tid].p, idx = new Map(), firstTop = new Map();
  for (const p of players) { const f = norm(p[0]).split(" ")[0], t = firstTop.get(f) || [0, 0];
    if (p[1] > t[0]) firstTop.set(f, [p[1], t[0]]); else if (p[1] > t[1]) firstTop.set(f, [t[0], p[1]]); else firstTop.set(f, t); }
  const add = (k, i) => { if (k.length < 3) return; const a = idx.get(k); if (a) { if (!a.includes(i)) a.push(i); } else idx.set(k, [i]); };
  players.forEach((p, i) => {
    const full = norm(p[0]), w = full.split(" ");
    add(full, i);
    if (w.length > 1) {
      const last = w[w.length - 1];
      if (last.length >= 4) add(last, i);
      if (PARTICLES.has(w[w.length - 2])) add(w.slice(-2).join(" "), i);
      if (w.length > 2 && PARTICLES.has(w[w.length - 3])) add(w.slice(-3).join(" "), i);
      const core = w.filter(x => !PARTICLES.has(x)).join(" ");
      if (core !== full) add(core, i);
      if (w.length >= 3) add(w[0] + " " + last, i);
      const ft = firstTop.get(w[0]);
      if (p[1] >= 60 && w[0].length >= 4 && ft[0] === p[1] && p[1] >= 3 * ft[1]) add(w[0], i);
    }
  });
  const first = new Set(players.map(p => norm(p[0]).split(" ")[0]));
  return (IDX[tid] = { idx, first, players });
}
function dl(a, b) {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}
// country names for the territory member codes ("dk" -> Denmark), for the scouting screen and its hints
const regionName = (() => { let dn = null; try { dn = new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) {}
  const SPECIAL = { gb: "England, Scotland, Wales, Northern Ireland", england: "England", "fr-yugoslavia": "Yugoslavia", "serbia-and-montenegro": "Serbia & Montenegro", "cura-ao": "Curaçao", xk: "Kosovo" };
  return c => SPECIAL[c] || (dn && dn.of(c.toUpperCase())) || c.toUpperCase(); })();
const HIDE_IN_LIST = new Set(["england", "fr-yugoslavia", "serbia-and-montenegro"]);
const memberNames = id => T[id].members.filter(c => !HIDE_IN_LIST.has(c)).map(regionName).join(", ");
// a name that isn't from this territory: is it a well-known player from another one? (checked on Sign only)
function otherTerritory(typed, here) {
  const k = norm(typed); if (k.length < 3) return null;
  let best = null;
  const look = (fuzzy) => {
    for (const tid of IDS) {
      if (tid === here) continue;
      const N = nationIndex(tid);
      let cand = N.idx.get(k);
      if (!cand && fuzzy) for (const [key, list] of N.idx) if (Math.abs(key.length - k.length) <= 1 && dl(key, k) <= 1) { cand = list; break; }
      if (!cand) continue;
      for (const i of cand) { const p = N.players[i]; if (!best || p[1] > best.f) best = { tid, name: p[0], f: p[1] }; }
    }
  };
  look(false);
  if (!best && k.length >= 7) look(true);   // one wrong letter in a longer name ("bendter"), as when signing
  if (!best) return null;
  return Object.assign(best, { country: regionName(HOME_NAT[best.name] || T[best.tid].members[0]).split(",")[0] });
}
function resolveName(N, typed, fuzzy) {
  const k = norm(typed); if (k.length < 3) return { kind: "miss" };
  let cand = N.idx.get(k);
  if (!cand && fuzzy && k.length >= 7) {
    const lim = k.length >= 12 ? 2 : 1;
    for (const [key, list] of N.idx) if (Math.abs(key.length - k.length) <= lim && dl(key, k) <= lim) { cand = list; break; }
  }
  if (!cand) return { kind: "miss" };
  const free = cand.filter(i => !S.used[N.players[i][0]]);
  if (!free.length) return { kind: "dup", i: cand[0] };
  if (free.length === 1) return { kind: "hit", i: free[0] };
  const s = free.slice().sort((a, b) => N.players[b][1] - N.players[a][1]);
  if (N.players[s[0]][1] >= 2 * N.players[s[1]][1]) return { kind: "hit", i: s[0] };
  return { kind: "ambig" };
}

/* ================= game state ================= */
let S = null;
// pass-and-play: seats 0..humans-1 are people on this phone, the rest are computer managers
const BOT_NAMES = ["You", "Gegenpress", "Parks the Bus", "The Tinkerer"], BOT_SHORT = ["You", "Gegen", "Bus", "Tinker"];
const isHuman = k => k != null && k < ((S && S.humans) || 1);
// the managers in this game: seats 0..size-1 (1 v 1 = gold and blue)
const gameSize = () => (S && S.managers) || 4;
const activeSeats = () => SEATS.map((_, k) => k).filter(k => k < gameSize());
const solo = () => !S || (S.humans || 1) === 1;
const newStats = () => ({ battles: 0, questions: 0, right: 0, signed: 0, ko: 0, derbies: 0, pens: 0, pensScored: 0, signedNames: [], best: "" });
const st = (k = S.seat) => (S.st ||= {})[k] ||= newStats();
function applyNames() {
  for (let k = 0; k < SEATS.length; k++) {
    const n = isHuman(k) && !solo() ? (S.names[k] || `Player ${k + 1}`) : BOT_NAMES[k];
    SEATS[k].name = n; SEATS[k].short = isHuman(k) && !solo() ? n.slice(0, 7) : BOT_SHORT[k];
  }
}
// old saves: one human, a single last-stand counter
function upgradeSave() {
  S.humans ||= 1; S.names ||= ["You"];
  if (typeof S.lastStands !== "object") S.lastStands = { 0: S.lastStands == null ? RULES.lastStandsPerRound : S.lastStands };
  S.news ||= {}; S.st ||= {};
  S.managers ||= 4; S.bonus ||= {}; S.level ||= "medium";
  if (S.movesLeft == null) { S.movesLeft = S.moved ? 0 : RULES.movesPerTurn; delete S.moved; }
  if (!S.order) { S.order = activeSeats(); S.turn = S.order.indexOf(S.seat); }
  if (S.stats && !S.st[0]) S.st[0] = Object.assign(newStats(), S.stats);
}
// a new season starts with an empty map: the kick-off ceremony rolls for the order and hands out the countries
function newGame(rounds, scoutMode, humans = 1, names = [], managers = 4) {
  S = { round: 1, rounds, scoutMode, humans, names, seat: 0, phase: "setup", attacksLeft: RULES.attacksPerTurn, movesLeft: RULES.movesPerTurn,
        lastStands: {}, owner: {}, squad: {}, used: {}, qUsed: {}, log: [], over: false, st: {}, news: {}, order: [], turn: -1, managers };
  S.order = activeSeats();
  for (let k = 0; k < humans; k++) S.lastStands[k] = RULES.lastStandsPerRound;
  applyNames();
  for (const id of IDS) { S.owner[id] = null; S.squad[id] = []; }
}
// countries each: 10 with four managers (two stay unclaimed), 14 with three, 21 in a 1 v 1
const perManager = () => Math.floor(IDS.length / gameSize());
// sign an unused player from this territory: famous-ish, a bit random
function autoSign(id) {
  const P = GAME[id].p;
  for (let tries = 0; tries < 40; tries++) {
    const i = Math.floor(Math.pow(Math.random(), 1.6) * Math.min(P.length, 250));
    const n = P[i] && P[i][0];
    if (n && !S.used[n]) { S.used[n] = 1; S.squad[id].push(n); return n; }
  }
  const p = P.find(p => !S.used[p[0]]); if (p) { S.used[p[0]] = 1; S.squad[id].push(p[0]); return p[0]; }
  S.squad[id].push("Youth player"); return "Youth player";
}
const save = () => store.set("tk-map-game", S);
const lvl = () => RULES.levels[(S && S.level) || "medium"] || RULES.levels.medium;
// home stadiums: one country per manager, harder to attack and worth points to whoever holds it
const stadiumOf = seat => S && S.stadiums ? S.stadiums[seat] : null;
const isStadium = id => !!(S && S.stadiums && Object.values(S.stadiums).includes(id));
const stadiumSeatOf = id => { if (!S || !S.stadiums) return null; for (const k in S.stadiums) if (S.stadiums[k] === id) return +k; return null; };
// the underdog: well behind the leader on points -> extra scouting time
function isUnderdog(seat) {
  const others = S.order.filter(k => k !== seat).map(basePoints);
  return others.length && Math.max(...others) - basePoints(seat) >= RULES.underdogGap;
}
const owned = seat => IDS.filter(id => S.owner[id] === seat);
function income(seat) {
  const mine = owned(seat);
  let s = RULES.baseSecs + RULES.perTerr * mine.length + (S && S.order && isUnderdog(seat) ? RULES.underdogSecs : 0);
  for (const c of CONFEDS) if (IDS.filter(id => T[id].confed === c).every(id => S.owner[id] === seat)) s += RULES.confedSecs[c];
  const mult = S && isWindow() ? 2 : 1;   // August and January: double time
  return Math.min(RULES.maxSecs * mult, Math.round(s * mult));
}
// points without the underdog check (used by it, so no loop): countries, confederations, players, stadiums, bonuses
function points(seat) { return basePoints(seat); }
function basePoints(seat) {
  const mine = owned(seat);
  let p = mine.length + ((S.bonus && S.bonus[seat]) || 0);
  if (S.stadiums) for (const k in S.stadiums) if (S.owner[S.stadiums[k]] === seat) p += RULES.stadiumPts;
  for (const c of CONFEDS) if (IDS.filter(id => T[id].confed === c).every(id => S.owner[id] === seat)) p += RULES.confedPts[c];
  p += Math.floor(mine.reduce((a, id) => a + S.squad[id].length, 0) / 5);
  return p;
}
function removePlayers(id, n) {   // random knock-outs, but the captain goes last
  const out = [], cap = captainOf(id);
  for (let k = 0; k < n && S.squad[id].length; k++) {
    let i = Math.floor(Math.random() * S.squad[id].length);
    if (S.squad[id][i] === cap && S.squad[id].length > 1) i = (i + 1) % S.squad[id].length;
    out.push(...S.squad[id].splice(i, 1));
  }
  return out;
}

/* ================= questions ================= */
// bank questions for this territory, else generated "which of these players is from X?"
function nextQuestion(id, tier) {
  const bank = GAME[id].q[tier] || [];
  const used = (S.qUsed[id + tier] ||= []);
  const free = bank.map((q, i) => i).filter(i => !used.includes(i));
  if (free.length) {
    const i = pick(free); used.push(i);
    const [q, a, o] = bank[i];
    return { text: q, answer: a, options: shuffle([a, ...o]), source: "bank" };
  }
  const P = GAME[id].p;
  const range = tier === "easy" ? [0, 40] : tier === "normal" ? [40, 200] : [200, 500];
  const lo = Math.min(range[0], Math.max(0, P.length - 20)), hi = Math.min(range[1], P.length);
  const right = P[lo + Math.floor(Math.random() * Math.max(1, hi - lo))][0];
  const others = shuffle([...T[id].nb, ...shuffle(IDS).slice(0, 6)]).filter(x => x !== id);
  const wrong = [];
  for (const o of others) { if (wrong.length === 3) break; const Q = GAME[o].p; const j = Math.min(Q.length - 1, lo + Math.floor(Math.random() * Math.max(1, Math.min(hi, Q.length) - lo))); const n = Q[j] && Q[j][0]; if (n && n !== right && !wrong.includes(n)) wrong.push(n); }
  return { text: `Which of these players is from ${T[id].name}?`, answer: right, options: shuffle([right, ...wrong]), source: "generated" };
}
// shows one question in the layer; resolves true/false
function askQuestion(id, tier, head, seat = S.seat) {
  return new Promise(resolve => {
    const q = nextQuestion(id, tier);
    const box = document.createElement("div");
    box.className = "qcard card";
    box.innerHTML = `<div class="qtier">${esc(TIER_LABEL[tier])} · about ${esc(T[id].name)}${q.source === "generated" ? " · generated" : ""}</div>
      <p class="qtext">${esc(q.text)}</p>
      <div class="opts">${q.options.map((o, k) => `<button class="opt" data-k="${k}">${esc(o)}</button>`).join("")}</div>
      <div class="qbar"><i></i></div><p class="verdict"></p>`;
    head.appendChild(box);
    const bar = box.querySelector(".qbar i"), t0 = performance.now(); let done = false;
    const finish = (ok, btn) => {
      if (done) return; done = true; clearInterval(iv);
      st(seat).questions++; if (ok) st(seat).right++;
      if (ok) sfx.cheer(); else sfx.groan();
      box.querySelectorAll(".opt").forEach(b => { b.disabled = true; if (b.textContent === q.answer) b.classList.add("right"); });
      if (btn && !ok) btn.classList.add("wrong");
      box.querySelector(".verdict").textContent = ok ? "Right." : btn ? `No, it's ${q.answer}.` : `Time's up. It's ${q.answer}.`;
      setTimeout(() => { box.remove(); resolve(ok); }, ok ? 650 : 1500);
    };
    const iv = setInterval(() => { const left = 1 - (performance.now() - t0) / (RULES.questionSecs * 1000); bar.style.width = Math.max(0, left * 100) + "%"; if (left <= 0) finish(false); }, 100);
    box.querySelectorAll(".opt").forEach(b => b.onclick = () => finish(b.textContent === q.answer, b));
  });
}

/* ================= map rendering, pan + zoom ================= */
const svg = $("map"), NS = "http://www.w3.org/2000/svg";
let vb = { x: 0, y: 0, w: WORLD.w, h: WORLD.h };
const VIEWS = { world: { x: 0, y: 0, w: WORLD.w, h: WORLD.h }, europe: { x: 430, y: 60, w: 190, h: 120 } };
// on a tall screen open on Europe + Africa so the map fills the height
function homeView() { const r = mapRect(); if (!r.width || r.width / r.height > 1.3) return { ...VIEWS.world }; const h = 380, w = Math.max(220, h * r.width / r.height); return { x: 510 - w / 2, y: 40, w, h }; }
const RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
let fast = false;   // "Skip replay" during computer turns
const SHIRT = "M-7,-9 L-3,-11 Q0,-7.5 3,-11 L7,-9 L12.5,-4 L8.5,0.5 L7,-1 L7,10 Q0,11.5 -7,10 L-7,-1 L-8.5,0.5 L-12.5,-4 Z";
// the map's box on screen (the container: the svg itself is scaled and moved while you drag or zoom)
function mapRect() { return $("mapwrap").getBoundingClientRect(); }
function curUnit() { const r = mapRect(); return Math.max(vb.w / (r.width || 360), vb.h / (r.height || 400)); }
function buildMap() {
  svg.innerHTML = `<defs><clipPath id="floodclip"><circle id="floodc" r="0"/></clipPath></defs>`;
  const g = document.createElementNS(NS, "g");

  // the sea layer (its own svg): graticule, water rings, unclaimed land. It never changes during play, so a
  // country changing colour or a flood doesn't make the browser repaint the expensive coastline rings.
  $("sea").innerHTML = `<path class="grat" d="${WORLD.grat}"/><g id="seaLo">${seaGroup(WORLD.land, WORLD.neutral)}</g><g id="seaHi" style="display:none"></g>`;
  // two versions of the countries and borders, coarse and detailed; zooming only shows one and hides the other
  g.innerHTML = `<g id="terrLo">` + WORLD.territories.map(t => `<path class="terr" id="t-${t.id}" data-id="${t.id}" d="${t.d}"/>`).join("") + `</g>` +
    `<g id="terrHi" style="display:none"></g>` +
    `<g id="fx"></g><path class="borders" id="bordLo" d="${WORLD.borders}"/><path class="borders" id="bordHi" style="display:none"/>` +
    WORLD.sea.map(([a, b]) => { const A = T[a], B = T[b]; return `<line class="sealink" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/>`; }).join("");
  svg.appendChild(g);
  $("pmap").innerHTML = `<g id="arcs"></g><g id="badges">` +
    // drawn north to south, so a piece further down the map stands in front of the one above it
    WORLD.territories.slice().sort((a, b) => a.y - b.y).map(t => `<g class="pieces" id="p-${t.id}" transform="translate(${t.x} ${t.y})"><g class="pgrp"></g><g class="plq"></g><g class="mk"></g></g>`).join("") +
    `</g><g id="pfx"></g><g id="floats"></g>`;
  applyView();
}
/* SMOOTH PANNING AND ZOOMING: while you drag, wheel or the camera flies, the drawn map is only moved and
   scaled as a picture (a CSS transform on both layers, done by the graphics card). The real redraw
   (applyView: new viewBox, line widths, piece sizes, the detailed map) happens once the movement stops. */
let committed = { ...vb }, commitT = 0;
const LAYERS = () => [$("sea"), svg, $("pmap")];
function vbScreen(v, W, H) { const u = Math.max(v.w / W, v.h / H); return { u, ox: (W - v.w / u) / 2, oy: (H - v.h / u) / 2 }; }
function previewView() {
  const r = mapRect(), W = r.width || 1, H = r.height || 1, c = vbScreen(committed, W, H), t = vbScreen(vb, W, H), k = c.u / t.u;
  const tx = -c.ox * k + (committed.x - vb.x) / t.u + t.ox, ty = -c.oy * k + (committed.y - vb.y) / t.u + t.oy;
  const tf = `translate(${tx.toFixed(2)}px,${ty.toFixed(2)}px) scale(${k.toFixed(5)})`;
  for (const l of LAYERS()) l.style.transform = tf;
}
function commitSoon(ms = 140) { clearTimeout(commitT); commitT = setTimeout(applyView, ms); }
function applyView() {
  clearTimeout(commitT);
  for (const l of LAYERS()) l.style.transform = ""; committed = { ...vb };
  svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  $("pmap").setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  $("sea").setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const unit = curUnit();
  setDetail(unit);
  const mw = $("mapwrap").style;   // line widths for all three layers
  mw.setProperty("--sw", (unit * 0.9).toFixed(3));
  mw.setProperty("--sw2", (unit * 2.4).toFixed(3));
  mw.setProperty("--dash", `${(unit * 4).toFixed(2)} ${(unit * 3).toFixed(2)}`);
  $("sea").querySelectorAll(".water path").forEach(p => p.style.strokeWidth = (+p.dataset.w * unit).toFixed(3));
  // pieces stay about 22 px tall at any zoom; crowded spots (Benelux, Balkans) show 1 piece until you zoom in
  const k = (unit * PIECE_K).toFixed(4);
  for (const t of WORLD.territories) $("p-" + t.id).setAttribute("transform", `translate(${t.x} ${t.y}) scale(${k})`);
  const crowdKey = unit.toFixed(3) + "|" + PIECE_K.toFixed(4);
  if (crowdKey !== lastCrowd) { lastCrowd = crowdKey; for (const t of WORLD.territories) crowded[t.id] = NEAREST[t.id] / unit < CROWD_PX; if (S) drawBadges(); }
  const m = 20 * unit;
  for (const t of WORLD.territories) {
    const on = t.x > vb.x - m && t.x < vb.x + vb.w + m && t.y > vb.y - m && t.y < vb.y + vb.h + 3 * m;
    if (PIECES[t.id]) PIECES[t.id].figs.forEach(f => f.onScreen = on);
  }
  Pieces.wake();
}
// old-atlas water lines: rings of coastline, alternating ink and sea colour, widths in screen pixels; then unclaimed land
function seaGroup(land, neutral) {
  const ring = (w, style) => `<path d="${land}" data-w="${w}" style="${style}"/>`;
  // one soft ring (was five: they were 80-85% of every redraw once you zoom in past the world view)
  return `<g class="water">${ring(9, "stroke:var(--line);opacity:.13")}</g>` +
    `<path class="neutral-land" d="${neutral}"/>`;
}
// level of detail: the light 1:110m shapes at the world view, the 1:50m ones (data/world-hi.js) once you zoom in
// past ~2.5x, where the coarse coastlines turn into jagged straight lines. Both versions are built once (the detailed
// one in the background after the page loads); zooming only shows one and hides the other, so nothing is re-read.
let detail = "lo", hiBuilt = false;
function buildHi() {
  const H = window.TK_WORLD_HI; if (!H || hiBuilt) return;
  hiBuilt = true;
  $("seaHi").innerHTML = seaGroup(H.ringLand || H.land, H.neutral);   // rings on the simplified coast (see build-map.js)
  $("terrHi").innerHTML = WORLD.territories.map(t => `<path class="terr" id="h-${t.id}" data-id="${t.id}" d="${H.territories[t.id]}"/>`).join("");
  $("bordHi").setAttribute("d", H.borders);
  if (S) paint();
  const unit = curUnit(); $("sea").querySelectorAll(".water path").forEach(p => p.style.strokeWidth = (+p.dataset.w * unit).toFixed(3));
}
function setDetail(unit) {
  const want = window.TK_WORLD_HI && unit < .4 ? "hi" : "lo";
  if (want === detail) return;
  if (want === "hi") buildHi();
  detail = want;
  const hi = want === "hi";
  // visibility, not display: a hidden version keeps its geometry, so showing it again costs nothing to re-read
  for (const [lo, h] of [["seaLo", "seaHi"], ["terrLo", "terrHi"], ["bordLo", "bordHi"]]) {
    $(lo).style.visibility = hi ? "hidden" : ""; $(h).style.visibility = hi ? "" : "hidden"; $(lo).style.display = ""; $(h).style.display = "";
  }
}
// the territory's shape that's on show right now (for the flood)
const terrEl = id => (detail === "hi" && $("h-" + id)) || $("t-" + id);
// the detail file arrives after the game starts: build it while nothing is happening, then apply the view
window.addEventListener("load", () => {
  const go = () => { buildHi(); applyView(); };
  if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 2500 }); else setTimeout(go, 300);
});
// a piece is 64 units tall in its own drawing, x1.22: 78 units. 22 px on a phone, 30 px on a desktop.
const isDesk = () => !!(window.matchMedia && matchMedia("(min-width: 1024px)").matches);
let PIECE_K = 22 / 78, CROWD_PX = 19;
function sizePieces() { const px = isDesk() ? 30 : 22; PIECE_K = px / 78; CROWD_PX = 19 * px / 22; }
sizePieces();
const NEAREST = {}, crowded = {}; let lastCrowd = "";
for (const a of WORLD.territories) NEAREST[a.id] = Math.min(...WORLD.territories.filter(b => b !== a).map(b => Math.hypot(a.x - b.x, a.y - b.y)));
// group layout in piece units, base at the territory point; the last spot is the captain, in front
const LAYOUT = { 0: [], 1: [[0, 0]], 2: [[-9, -3], [9, 3]], 3: [[-14, -4], [14, -4], [0, 5]] };
const PIECES = {};   // id -> { key, figs, plaque }
// a player's kit is the kit of HIS country, not the one he stands in
const kitFor = (name, id) => Pieces.kitOf(HOME[name] || id);
const baseOf = id => S.owner[id] == null ? NEUTRAL.hex : SEATS[S.owner[id]].hex;
// the pieces of one squad: captain last in the list (he stands in front), with his armband
function pieceSpecs(id, k) {
  const cap = captainOf(id), names = Pieces.shown(S.squad[id], cap, FAME, k);
  const order = names.length > 1 ? [...names.slice(1), names[0]] : names;
  return order.map((n, j) => ({ name: n, num: Pieces.number(n, POS[n], n === cap), kit: kitFor(n, id), captain: n === cap, spot: LAYOUT[order.length][j] }));
}
// a stadium badge (a little stand with floodlights) and a gold star, drawn in piece units above the squad
function markerSVG(id) {
  let out = "", x = 0;
  const both = isStadium(id) && S.motm === id;
  if (isStadium(id)) {
    const c = SEATS[stadiumSeatOf(id)].hex;
    out += `<g transform="translate(${both ? -34 : 0} -112) scale(3.3)"><circle r="9" fill="${c}" stroke="#fff" stroke-width="1.6"/>
      <path d="M-5.5,3 L-5.5,-1 Q0,-4 5.5,-1 L5.5,3 Z" fill="#F8F1DD"/><path d="M-5.5,3 L5.5,3" stroke="#241B08" stroke-width=".8"/>
      <path d="M-4,-1 L-4,-6 M4,-1 L4,-6" stroke="#F8F1DD" stroke-width=".9"/><circle cx="-4" cy="-6.4" r="1.1" fill="#f3cd6b"/><circle cx="4" cy="-6.4" r="1.1" fill="#f3cd6b"/></g>`;
  }
  if (S.motm === id) out += `<g transform="translate(${both ? 34 : 0} -112) scale(3.3)"><path d="M0,-9 L2.6,-2.9 L9,-2.8 L4,1.4 L5.6,7.8 L0,4.2 L-5.6,7.8 L-4,1.4 L-9,-2.8 L-2.6,-2.9 Z" fill="#f3cd6b" stroke="#7a5a10" stroke-width="1.1" stroke-linejoin="round"/></g>`;
  return out;
}
const lastCount = {};
function drawBadges() {
  for (const t of WORLD.territories) {
    const id = t.id, g = $("p-" + id);
    if (!S || (!S.squad[id].length && S.owner[id] == null)) { g.style.display = "none"; continue; }
    g.style.display = "";
    const n = S.squad[id].length, home = homeCrowd(id);
    let k = Pieces.tierOf(n); if (crowded[id]) k = Math.min(k, 1);
    const specs = pieceSpecs(id, k);
    const key = (S.owner[id] == null ? "n" : S.owner[id]) + "|" + k + "|" + specs.map(p => p.name).join(",") + "|" + home;
    let P = PIECES[id];
    if (!P || P.key !== key) {   // rebuild only when the squad on show changes; otherwise just the plaque
      if (P) P.figs.forEach(f => f.remove());
      const grp = g.querySelector(".pgrp"), base = baseOf(id), neutral = S.owner[id] == null;
      const figs = specs.map(p => Pieces.make(grp, { base, kit: p.kit, name: p.name, num: p.num, captain: p.captain, home: p.captain && home,
        x: p.spot[0], y: p.spot[1], s: 1, idle: false }));
      const plq = g.querySelector(".plq"); plq.innerHTML = "";
      const frontY = specs.length ? specs[specs.length - 1].spot[1] : 0;
      // the plaque is drawn 2.6x the piece scale, so the count reads at about 9 px on a phone
      const plaque = Pieces.plaque(plq, 0, 0, n, base, S.owner[id] == null ? NEUTRAL.ink : SEATS[S.owner[id]].ink);
      plq.setAttribute("transform", `translate(0 ${frontY + 30}) scale(2.6)`);
      P = PIECES[id] = { key, figs, plaque };
      const on = t.x > vb.x && t.x < vb.x + vb.w && t.y > vb.y && t.y < vb.y + vb.h; figs.forEach(f => f.onScreen = on);
    }
    if (P.plaque.t.textContent !== String(n)) P.plaque.t.textContent = n;
    // markers above the squad: home stadium (in the colour of the manager whose stadium it is) and the gold star
    const mkKey = (isStadium(id) ? "s" + stadiumSeatOf(id) : "") + (S.motm === id ? "m" : "");
    const mk = g.querySelector(".mk");
    if (mk.dataset.k !== mkKey) { mk.dataset.k = mkKey; mk.innerHTML = markerSVG(id); }
    if (lastCount[id] != null && lastCount[id] !== n && !RM) { const q = P.plaque.inner; q.classList.remove("bump"); void q.getBoundingClientRect(); q.classList.add("bump"); }
    lastCount[id] = n;
    // the selected squad raises its arms a little and is the only one that moves while idle: 42 squads bobbing at
    // once meant repainting every piece 30 times a second
    const r = sel === id ? 35 : 10, live = sel === id && S.owner[id] != null;
    P.figs.forEach(f => { if (f.raiseL !== r || f.idle !== live) { f.raiseL = f.raiseR = r; f.idle = live; Pieces.redraw(f); } });
    if (live) Pieces.wake();
  }
  GV.badges();
}
function paint() {
  for (const t of WORLD.territories) {
    const target = !!(sel && isHuman(S.seat) && S.owner[sel] === S.seat && S.phase === "attack" && T[sel].nb.includes(t.id) && S.owner[t.id] !== S.seat);
    for (const el of [$("t-" + t.id), $("h-" + t.id)]) {   // both the coarse and the detailed shape
      if (!el) continue;
      el.style.fill = colorOf(t.id);
      el.style.fillOpacity = S.owner[t.id] == null ? .55 : .82;
      el.classList.toggle("sel", sel === t.id);
      el.classList.toggle("target", target);
    }
  }
  drawBadges();
  GV.paint();
  $("score").innerHTML = activeSeats().map(k => { const s = SEATS[k]; return `<i class="${owned(k).length ? "" : "out"}" style="background:${s.hex};color:${s.ink}" title="${esc(s.name)}: ${points(k)} points"><small>${esc(s.short)}</small>${points(k)}</i>`; }).join("");
  drawManagers();
}
// desktop side panel: one card per manager, in turn order, with the one to play marked
function drawManagers() {
  const box = $("mgrs"); if (!box) return;
  if (!S) { box.innerHTML = `<p class="side-empty">The managers appear here once the season starts.</p>`; return; }
  const order = S.order || activeSeats();
  box.innerHTML = order.map(k => { const s = SEATS[k], mine = owned(k), pl = mine.reduce((a, id) => a + S.squad[id].length, 0), now = S.seat === k && !S.over && S.phase !== "setup";
    return `<div class="mgr${now ? " now" : ""}${mine.length || S.phase === "draft" ? "" : " out"}" style="--c:${s.hex};--ci:${s.ink}">
      <b class="sw"></b><div class="who"><strong>${esc(s.name)}</strong><small>${isHuman(k) ? (solo() ? "You" : "Player") : "Computer"}${now ? " · to play" : ""}</small></div>
      <div class="nums"><span><b>${points(k)}</b>pts</span><span><b>${mine.length}</b>countries</span><span><b>${pl}</b>players</span></div>
      ${S.stadiums && S.stadiums[k] ? `<div class="mgr-extra">Home: ${esc(T[S.stadiums[k]].name)}${S.owner[S.stadiums[k]] !== k ? " (lost!)" : ""}${S.phase !== "draft" && S.order && isUnderdog(k) ? ` · underdog +${RULES.underdogSecs} s` : ""}</div>` : ""}</div>`; }).join("");
}
function feed(html) {
  const f = $("feed"); if (!f) return;
  const li = document.createElement("li"); li.innerHTML = html; f.prepend(li);
  while (f.children.length > 40) f.lastChild.remove();
}

/* ---------- animation helpers ---------- */
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function tween(ms, fn) {
  return new Promise(res => {
    if (RM || fast) { fn(1); return res(); }
    const t0 = performance.now();
    const step = now => { const k = Math.max(0, Math.min(1, (now - t0) / ms)); fn(ease(k)); if (k < 1) requestAnimationFrame(step); else res(); };
    requestAnimationFrame(step);
  });
}
const pause = ms => (fast || RM) ? Promise.resolve() : sleep(ms);
// a view that frames these territories in the top `frac` of the screen (the battle panel covers the rest)
function viewFor(ids, frac = 1) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const b = $("t-" + id).getBBox(), t = T[id];   // big countries (Russia) only count near their label
    x0 = Math.min(x0, Math.max(b.x, t.x - 110)); x1 = Math.max(x1, Math.min(b.x + b.width, t.x + 110));
    y0 = Math.min(y0, Math.max(b.y, t.y - 70)); y1 = Math.max(y1, Math.min(b.y + b.height, t.y + 70));
  }
  const r = mapRect();
  if (frac < 1 && isDesk()) {   // desktop: the panel covers the right 460 px, frame the action in what's left
    const fx = Math.max(.35, (r.width - 460) / r.width), ar = (r.width * fx) / r.height;
    let w = Math.max(120, (x1 - x0) * 1.5), h = Math.max(80, (y1 - y0) * 1.6);
    if (w / h < ar) w = h * ar; else h = w / ar;
    return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w: w / fx, h };
  }
  const ar = r.width / (r.height * frac);
  let w = Math.max(120, (x1 - x0) * 1.5), h = Math.max(80, (y1 - y0) * 1.6);
  if (w / h < ar) w = h * ar; else h = w / ar;
  w = Math.min(w, WORLD.w * 1.1); h = w / ar;
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h: h / frac };
}
function flyTo(ids, ms = 650, frac = 1) {
  if (GV.on) return GV.flyTo(ids, ms, frac);
  const from = { ...vb }, to = viewFor(ids, frac);
  return tween(ms, k => { vb = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, w: from.w + (to.w - from.w) * k, h: from.h + (to.h - from.h) * k }; previewView(); }).then(applyView);
}
// a gold (or rival-coloured) arc with a ball running along it; returns a function that clears it
// little players in the attacker's kit run the arc, legs swinging, one after the other
const SKIN = ["#f1d3b0", "#d9a77a", "#a86b45", "#6b4228"];
// up to 5 mini pieces in the kits of the players sent run along the arc, one after the other
async function runners(path, L, hex, names, sp = 1) {
  if (RM || fast || !names.length) return;
  const ps = PS() * .85, g = $("arcs"), dur = 950 * sp, gap = 130 * sp;
  const figs = names.slice(0, 5).map(n => { const f = Pieces.make(g, { base: hex, kit: kitFor(n), name: n, num: Pieces.number(n, POS[n], false), s: ps, idle: false, live: true }); f.run = true; return f; });
  await Promise.all(figs.map((f, i) => Pieces.sleep(i * gap).then(() => Pieces.tween(dur, k => {
    const pt = path.getPointAtLength(L * k); f.x = pt.x; f.y = pt.y; f.op = k > .92 ? (1 - k) / .08 : 1;
  }))));
  figs.forEach(f => f.remove());
}
async function attackArc(a, b, hex, count = 3, names = [], sp = 1) {
  if (GV.on) return GV.attackArc(a, b, hex, count);
  const A = T[a], B = T[b], dx = B.x - A.x, dy = B.y - A.y;
  let cx = (A.x + B.x) / 2 - dy * .3, cy = (A.y + B.y) / 2 + dx * .3;
  if (cy > (A.y + B.y) / 2) { cx = (A.x + B.x) / 2 + dy * .3; cy = (A.y + B.y) / 2 - dx * .3; }   // always bulge upwards
  const unit = curUnit(), g = $("arcs");
  const mk = (stroke, w) => { const p = document.createElementNS(NS, "path"); p.setAttribute("class", "arc"); p.setAttribute("d", `M${A.x},${A.y} Q${cx},${cy} ${B.x},${B.y}`); p.style.stroke = stroke; p.style.strokeWidth = unit * w; g.append(p); return p; };
  const under = mk("#fff", 6.5), line = mk(hex, 3.4), L = line.getTotalLength();
  for (const e of [under, line]) { e.style.strokeDasharray = L; e.style.strokeDashoffset = L; }
  await tween(600, k => { for (const e of [under, line]) e.style.strokeDashoffset = L * (1 - k); });
  await runners(line, L, hex, names, sp);
  return () => { under.remove(); line.remove(); };
}
/* ---------- footballer piece scenes (_plans/takeover-pieces.md, step 5) ----------
   Only on the flat map; Skip replay and reduced motion jump to the end state, and every scene
   ends with paint(), so the map always looks exactly as paint() would draw it. */
const PS = () => curUnit() * PIECE_K;   // map units per piece unit
const scenesOn = () => !GV.on && !RM && !fast;
const hideGroup = (id, h) => { const g = $("p-" + id); if (g) g.style.visibility = h ? "hidden" : ""; };
const best = (names, k) => names.filter(Boolean).slice().sort((a, b) => (FAME[b] || 0) - (FAME[a] || 0)).slice(0, k);
// scene pieces can be drawn bigger than the 22 px map pieces (o.k), so a shirt swap is easy to follow
function fxPiece(id, name, dx, dy, o = {}) {
  const ps = PS() * (o.k || 1);
  return Pieces.make($("pfx"), { base: o.base || baseOf(id), kit: kitFor(name, o.kitId || id), name: name || "", num: Pieces.number(name || "", POS[name], !!o.captain),
    captain: !!o.captain, home: !!o.home, x: T[id].x + dx * ps, y: T[id].y + dy * ps, s: ps, idle: false, live: true });
}
// a. signing: up to 3 of the best new signings drop in, turn round to show the name, turn back
async function signingScene(id, names) {
  if (!scenesOn() || !names.length) return;
  const K = 1.6, ps = PS() * K, spots = [[0, 0], [-22, -6], [22, -6]], top = best(names, 3);
  hideGroup(id, true);
  try {
    const figs = await Promise.all(top.map((n, i) => Pieces.sleep(i * 550).then(async () => {
      const f = fxPiece(id, n, spots[i][0] * K, spots[i][1] * K, { k: K }), y1 = f.y;
      await Pieces.tween(420, k => { f.y = y1 - 140 * ps * (1 - k); }, Pieces.ease.bounce);
      Pieces.burst($("pfx"), f.x, f.y - 6 * ps, baseOf(id), 8, ps);
      await Pieces.tween(300, k => { f.flip = 1 - 2 * k; f.raiseL = f.raiseR = 10 + 50 * k; });
      await Pieces.sleep(220);
      await Pieces.tween(300, k => { f.flip = -1 + 2 * k; f.raiseL = f.raiseR = 60 - 50 * k; });
      return f;
    })));
    await Pieces.fadeOut(figs, 180);
  } finally { hideGroup(id, false); paint(); }
}
// d. takeover: the last defender hands over his shirt (or, if it was his manager's last country, tips over)
async function takeoverScene(from, to, attName, defName, attHex, defHex, sp, lastOne, floodIt) {
  if (!scenesOn()) return floodIt();
  await flyTo([to], 450 * sp);
  const K = 2, ps = PS() * K, u = ps * 1.22, fx = $("pfx");
  hideGroup(to, true);
  const def = fxPiece(to, defName, 10 * K, 0, { base: defHex, captain: true, k: K });
  const att = fxPiece(to, attName, -16 * K, 0, { base: attHex, kitId: from, k: K });
  let fly = null;
  try {
    if (lastOne) {
      await Pieces.tween(420 * sp, k => { def.tilt = 92 * k; def.raiseL = def.raiseR = 10 + 70 * k; }, Pieces.ease.out);
      Pieces.tween(500 * sp, k => def.op = 1 - k);
    } else {
      await Pieces.tween(300 * sp, k => { def.raiseL = def.raiseR = 10 + 160 * k; });
      fly = Pieces.el("g", {}, fx); Pieces.shirt(fly, kitFor(defName, to), Pieces.surname(defName || ""), Pieces.number(defName || "", POS[defName], true));
      def.recolor(Pieces.UNDERSHIRT); def.raiseL = def.raiseR = 10;
      Pieces.tween(300 * sp, k => att.raiseR = 10 + 155 * k);
      const x0 = def.x, y0 = def.y - 50 * u, x1 = att.x + 13 * u, y1 = att.y - 62 * u;
      await Pieces.tween(650 * sp, k => fly.setAttribute("transform", `translate(${Pieces.lerp(x0, x1, k)},${Pieces.lerp(y0, y1, k) - Math.sin(k * Math.PI) * 26 * u}) scale(${(Pieces.lerp(.75, .6, k) * u).toFixed(4)}) rotate(${-360 * k})`));
      def.run = true; const dx = def.x;
      Pieces.tween(1100 * sp, k => { def.x = dx + 60 * u * k; def.op = 1 - k; }, Pieces.ease.in);
    }
    await floodIt();
    Pieces.burst(fx, att.x, att.y - 60 * u, attHex, 14, ps);
    for (let j = 0; j < 2; j++) {
      const yb = att.y - 62 * u, xb = att.x + 13 * u;
      await Pieces.tween(240 * sp, k => { att.hop = 16 * k; att.raiseL = 10 + 150 * k; if (fly) fly.setAttribute("transform", `translate(${xb},${yb - 16 * u * k}) scale(${(.6 * u).toFixed(4)}) rotate(8)`); }, Pieces.ease.out);
      await Pieces.tween(240 * sp, k => { att.hop = 16 * (1 - k); if (fly) fly.setAttribute("transform", `translate(${xb},${yb - 16 * u * (1 - k)}) scale(${(.6 * u).toFixed(4)}) rotate(8)`); }, Pieces.ease.in);
    }
    await Pieces.sleep(300 * sp);
  } finally {
    def.remove(); att.remove(); if (fly) fly.remove();
    hideGroup(to, false); paint();
  }
}
// g. moving players: up to 2 pieces hop across in an arc, the plaques count down and up
async function moveScene(from, to, names, total) {
  if (!scenesOn() || !names.length) return;
  const K = 1.4, ps = PS() * K, top = best(names, 2), Pf = PIECES[from], Pt = PIECES[to];
  const nf = S.squad[from].length, nt = S.squad[to].length;
  for (let i = 0; i < top.length; i++) {
    const f = fxPiece(from, top[i], 0, -4 * K, { k: K }), x0 = f.x, y0 = f.y, x1 = T[to].x + (i ? 14 : -10) * ps, y1 = T[to].y - 4 * ps;
    await Pieces.tween(700, k => { f.x = Pieces.lerp(x0, x1, k); f.y = Pieces.lerp(y0, y1, k) - Math.sin(k * Math.PI) * 50 * ps; f.tilt = 12 * Math.sin(k * Math.PI * 2); });
    Pieces.burst($("pfx"), x1, y1, baseOf(from), 5, ps);
    const moved = i === top.length - 1 ? total : Math.round(total * (i + 1) / top.length);
    if (Pf) Pf.plaque.t.textContent = nf - moved; if (Pt) Pt.plaque.t.textContent = nt + moved;
    await Pieces.fadeOut([f], 150);
  }
}
// h. a new job: one piece drops in from above with a bounce
async function dropIn(id) {
  if (!scenesOn() || !S.squad[id].length) { paint(); return; }
  paint();
  const K = 2, ps = PS() * K, cap = captainOf(id);
  hideGroup(id, true);
  const f = fxPiece(id, cap, 0, 0, { captain: true, k: K }), y1 = f.y;
  try {
    await flyTo([id], 500);
    await Pieces.tween(650, k => { f.y = y1 - 160 * ps * (1 - k); }, Pieces.ease.bounce);
    Pieces.burst($("pfx"), f.x, f.y - 6 * ps, baseOf(id), 10, ps);
    await Pieces.sleep(450);
  } finally { f.remove(); hideGroup(id, false); paint(); }
}
// c + f. the battle strip: a little table under the scoreboard where your front piece meets theirs
function battleStrip(host, left, right) {
  const svg = Pieces.el("svg", { viewBox: "0 0 320 110", class: "strip-svg", role: "img", "aria-label": "Battle" });
  host.appendChild(svg);
  Pieces.el("path", { d: "M0,46 C60,34 120,38 160,42 L160,110 L0,110 Z", fill: Pieces.mix(left.base, "#ffffff", .3), stroke: "#fff", "stroke-width": 2 }, svg);
  Pieces.el("path", { d: "M160,42 C200,38 270,34 320,46 L320,110 L160,110 Z", fill: Pieces.mix(right.base, "#ffffff", .3), stroke: "#fff", "stroke-width": 2 }, svg);
  const mk = (side, o, x) => o.name == null ? null : Pieces.make(svg, { base: o.base, kit: kitFor(o.name, o.kitId), name: o.name, num: Pieces.number(o.name, POS[o.name], !!o.captain), captain: !!o.captain, x, y: 96, s: .62, idle: false, live: true });
  const st = { svg, a: mk("a", left, 112), d: mk("d", right, 210), left, right };
  // right answer: yours slides in and theirs tips over; wrong: the other way round. The fallen piece is
  // replaced by the next player (if any) so the strip always shows who is left.
  st.hit = async (ok, nextA, nextD) => {
    const hit = ok ? st.a : st.d, hurt = ok ? st.d : st.a, dir = ok ? 1 : -1;
    if (!hit || !hurt) return;
    const hx = hit.x; hit.run = true;
    await Pieces.tween(320, k => { hit.x = Pieces.lerp(hx, hx + dir * 40, k); hit.lean = dir * 18 * k; }, Pieces.ease.in);
    hit.run = false;
    Pieces.burst(svg, hurt.x - dir * 6, hurt.y - 16, ok ? left.base : right.base, 6, .7);
    await Promise.all([
      Pieces.tween(380, k => { hurt.tilt = dir * 92 * k; hurt.raiseL = hurt.raiseR = 10 + 70 * k; }, Pieces.ease.out),
      Pieces.tween(420, k => { hit.x = Pieces.lerp(hx + dir * 40, hx, k); hit.lean = dir * 18 * (1 - k); })
    ]);
    const next = ok ? nextD : nextA;
    await Pieces.tween(180, k => hurt.op = 1 - k);
    const x = hurt.x; hurt.remove();
    const o = ok ? Object.assign({}, right, { name: next, captain: true }) : Object.assign({}, left, { name: next, captain: false });
    const fresh = next ? mk(ok ? "d" : "a", o, x) : null;
    if (fresh) { fresh.op = 0; await Pieces.tween(180, k => fresh.op = k); }
    if (ok) st.d = fresh; else st.a = fresh;
  };
  st.remove = () => { [st.a, st.d].forEach(f => f && f.remove()); svg.remove(); };
  return st;
}

// the new owner's colour spreads over the territory from the side the attack came from
async function flood(id, fromId, hex) {
  if (GV.on) return GV.flood(id, fromId, hex);
  const el = terrEl(id), c = el.cloneNode();
  c.removeAttribute("id"); c.removeAttribute("data-id"); c.setAttribute("class", "floodfill");
  c.style.fill = hex; c.style.fillOpacity = .82; c.setAttribute("clip-path", "url(#floodclip)");
  const A = T[fromId], b = el.getBBox();
  const sx = Math.min(b.x + b.width, Math.max(b.x, A.x)), sy = Math.min(b.y + b.height, Math.max(b.y, A.y));
  const R = Math.max(...[[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => Math.hypot(x - sx, y - sy)));
  const circ = $("floodc"); circ.setAttribute("cx", sx); circ.setAttribute("cy", sy);
  $("fx").append(c);
  await tween(850, k => circ.setAttribute("r", R * k));
  c.remove(); circ.setAttribute("r", 0);
}
// "+7" / "-3" rising from a shirt
function floatText(id, text, kind) {
  if (RM) return;
  if (GV.on) return GV.floatText(id, text, kind);
  const unit = curUnit(), t = T[id], el = document.createElementNS(NS, "text");
  el.setAttribute("class", "float " + kind); el.textContent = text;
  el.setAttribute("x", t.x); el.setAttribute("font-size", unit * 17); el.style.strokeWidth = unit * 3;
  $("floats").append(el);
  const t0 = performance.now();
  const step = now => { const k = Math.max(0, Math.min(1, (now - t0) / 1300)); el.setAttribute("y", t.y - unit * (16 + 30 * k)); el.style.opacity = 1 - k * k; if (k < 1) requestAnimationFrame(step); else el.remove(); };
  requestAnimationFrame(step);
}
function banner(title, sub, kind) {
  if (RM) return sleep(250);
  const el = document.createElement("div"); el.className = "banner" + (kind ? " " + kind : "");
  el.innerHTML = `<div><span>${esc(title)}<small>${esc(sub || "")}</small></span></div>`;
  $("mapwrap").append(el);
  return sleep(1300).then(() => el.remove());
}
// pan / pinch / wheel; a tap selects a territory
const pts = new Map(); let drag = null, moved = false;
svg.addEventListener("pointerdown", e => { if (GV.on) return; svg.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false; drag = { vb: { ...vb }, pts: new Map(pts) }; });
svg.addEventListener("pointermove", e => {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const r = mapRect(), unit = Math.max(drag.vb.w / r.width, drag.vb.h / r.height);
  if (pts.size === 1 && drag.pts.size === 1) {
    const p0 = [...drag.pts.values()][0], p = pts.get(e.pointerId);
    const dx = p.x - p0.x, dy = p.y - p0.y;
    if (Math.hypot(dx, dy) > 6) moved = true;
    if (moved) { vb.x = drag.vb.x - dx * unit; vb.y = drag.vb.y - dy * unit; clampView(); previewView(); }
  } else if (pts.size === 2) {
    if (drag.pts.size !== 2) drag = { vb: { ...vb }, pts: new Map(pts) };
    const [a0, b0] = [...drag.pts.values()], [a, b] = [...pts.values()];
    const k = Math.hypot(a0.x - b0.x, a0.y - b0.y) / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
    const cx = (a0.x + b0.x) / 2 - r.left, cy = (a0.y + b0.y) / 2 - r.top;
    zoomAt(drag.vb, k, cx, cy, r); moved = true;
  }
});
const endPtr = e => { pts.delete(e.pointerId); if (pts.size === 0) { drag = null; if (moved) applyView(); } else drag = { vb: { ...vb }, pts: new Map(pts) }; };
svg.addEventListener("pointerup", e => { const wasTap = !moved && pts.size === 1; endPtr(e); if (wasTap) { const t = document.elementFromPoint(e.clientX, e.clientY); if (t && t.dataset && t.dataset.id) tapTerritory(t.dataset.id); } });
svg.addEventListener("pointercancel", endPtr);
svg.addEventListener("wheel", e => { if (GV.on) return; e.preventDefault(); const r = mapRect(); zoomAt({ ...vb }, e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top, r); }, { passive: false });
function zoomAt(base, k, cx, cy, r) {
  const unit = Math.max(base.w / r.width, base.h / r.height);
  const mx = base.x + cx * unit, my = base.y + cy * unit;
  const w = Math.min(WORLD.w * 1.2, Math.max(60, base.w * k)), h = w * base.h / base.w;
  vb = { x: mx - (mx - base.x) * (w / base.w), y: my - (my - base.y) * (h / base.h), w, h };
  clampView(); previewView(); commitSoon();
}
function clampView() { vb.x = Math.min(WORLD.w - vb.w * .2, Math.max(-vb.w * .8, vb.x)); vb.y = Math.min(WORLD.h - vb.h * .2, Math.max(-vb.h * .8, vb.y)); }
document.querySelectorAll("[data-z]").forEach(b => b.onclick = () => {
  const z = b.dataset.z, r = mapRect();
  if (GV.on) return GV.zoom(z);
  if (VIEWS[z]) { vb = { ...VIEWS[z] }; applyView(); }
  else zoomAt({ ...vb }, z === "in" ? 1 / 1.5 : 1.5, r.width / 2, r.height / 2, r);
});
window.addEventListener("resize", () => { sizePieces(); applyView(); });
// desktop: hover a country to see its squad
const tip = $("tip");
svg.addEventListener("pointermove", e => {
  if (e.pointerType !== "mouse" || pts.size || !S || !tip) { if (tip) tip.hidden = true; return; }
  const id = e.target && e.target.dataset && e.target.dataset.id;
  if (!id) { tip.hidden = true; return; }
  const n = S.squad[id].length, cap = captainOf(id), d = sel && T[sel].nb.includes(id) && S.owner[sel] === S.seat && S.owner[id] !== S.seat ? derbyOf(sel, id) : null;
  tip.innerHTML = `<b style="--c:${colorOf(id)}">${esc(T[id].name)}</b><span>${esc(ownerName(id))} · ${n} player${n === 1 ? "" : "s"}</span>` +
    (cap ? `<span>Captain: ${esc(cap)}${homeCrowd(id) ? " · home crowd" : ""}</span>` : "") + (d ? `<span class="derby">Derby: ${esc(d)}</span>` : "") +
    (isStadium(id) ? `<span class="derby">${esc(SEATS[stadiumSeatOf(id)].name)}'s home stadium · ${RULES.stadiumPts} pts</span>` : "") + (S.motm === id ? `<span class="derby">Match of the month · +${RULES.motmPts} pts</span>` : "");
  tip.hidden = false;
  const W = window.innerWidth, x = e.clientX + 16, y = e.clientY + 14;
  tip.style.left = Math.min(x, W - tip.offsetWidth - 8) + "px"; tip.style.top = y + "px";
});
svg.addEventListener("pointerleave", () => { if (tip) tip.hidden = true; });
svg.addEventListener("pointerdown", () => { if (tip) tip.hidden = true; });
// any card, battle or screen opening over the map hides the hover card
new MutationObserver(() => { if (tip && $("layer").firstChild) tip.hidden = true; }).observe($("layer"), { childList: true });
document.addEventListener("keydown", e => {
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key, click = id => { const b = $(id) || document.querySelector(id); if (b) { b.click(); e.preventDefault(); } };
  if (k === "Enter") { const b = $("endTurn") || $("go") || $("ok"); if (b && !(document.activeElement && document.activeElement.tagName === "BUTTON")) { b.click(); e.preventDefault(); } }
  else if (k === "Escape") { if (S && !busy && layer.querySelector(".sheet")) { sel = null; closeSheet(); paint(); } }
  else if (k === "+" || k === "=") click('[data-z="in"]');
  else if (k === "-" || k === "_") click('[data-z="out"]');
  else if (k === "w" || k === "W") click('[data-z="world"]');
  else if (k === "e" || k === "E") click('[data-z="europe"]');
  else if (k === "g" || k === "G") click("viewBtn");
});

/* ================= globe view (optional; three.js r128 is loaded only when the globe is first chosen) ================= */
// Same game, drawn on an old-atlas globe: territories painted onto an equirectangular canvas texture, squads as pillars
// (one instanced mesh) with HTML shirt badges, attacks as great-circle tubes with little runners. The game calls the
// same render functions as for the flat map (paint, drawBadges, flyTo, attackArc, flood, floatText); they hand over here.
const GLOBE = window.TK_GLOBE;
const GV = (() => {
  const api = { on: false, badges() {}, paint() {} };
  const D2R = Math.PI / 180, TW = 2048, TH = 1024, FOVH = 16 * D2R;
  const GT = {}; GLOBE.t.forEach((t, i) => { t.i = i; GT[t.id] = t; });
  let ready = false, failed = null, loading = null;
  let renderer, scene, camera, globe, sphere, ring, texture, pillars, tex, tx, base, idData, grainPat, canvas, labels, neutralPath, borderPath, seaPath;
  let W = 1, H = 1, raf = 0, last = 0, dragging = false, worldDist = 3.6, paintKey = "", floodSt = null, pillarsDirty = true;
  const view = { lon: 15, lat: 28, dist: 0, vLon: 0, vLat: 0 };
  const anims = new Set(), floats = new Set(), disp = {}, lbs = {}, lastN = {}, drawn = {};
  const px = lon => (lon + 180) / 360 * TW, py = lat => (90 - lat) / 180 * TH;
  const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  let vec, toLL, slerp;

  function load() {
    if (window.THREE) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
      const to = setTimeout(() => fail(new Error("timeout")), 15000);
      const fail = e => { clearTimeout(to); loading = null; s.remove(); rej(e); };
      s.onload = () => { clearTimeout(to); window.THREE ? res() : fail(new Error("no THREE")); };
      s.onerror = () => fail(new Error("three.js did not load"));
      (document.head || document.body).appendChild(s);
    });
    return loading;
  }
  api.start = async () => {
    if (ready) return;
    if (failed) throw failed;
    await load();
    try { init(); ready = true; } catch (e) { failed = e; throw e; }
  };

  /* ---------- texture: paths, base layer, id canvas ---------- */
  function unwrap(r) {   // int ring -> texture px, longitudes made continuous across the date line
    const o = []; let prev = null, off = 0;
    for (let k = 0; k < r.length; k += 2) {
      let lon = r[k] / 10 + off; const lat = r[k + 1] / 10;
      if (prev !== null) { if (lon - prev > 180) { off -= 360; lon -= 360; } else if (lon - prev < -180) { off += 360; lon += 360; } }
      prev = lon; o.push(px(lon), py(lat));
    }
    return o;
  }
  function addPts(path, p, closed, box) {
    let mn = Infinity, mx = -Infinity;
    for (let k = 0; k < p.length; k += 2) { mn = Math.min(mn, p[k]); mx = Math.max(mx, p[k]); if (box) { box[0] = Math.min(box[0], p[k]); box[1] = Math.min(box[1], p[k + 1]); box[2] = Math.max(box[2], p[k]); box[3] = Math.max(box[3], p[k + 1]); } }
    for (const sh of [-TW, 0, TW]) {
      if (mn + sh >= TW || mx + sh <= 0) continue;
      path.moveTo(p[0] + sh, p[1]);
      for (let k = 2; k < p.length; k += 2) path.lineTo(p[k] + sh, p[k + 1]);
      if (closed) path.closePath();
    }
  }
  const polysPath = (polys, box) => { const p = new Path2D(); for (const poly of polys) for (const r of poly) addPts(p, unwrap(r), true, box); return p; };
  const fillOf = id => S ? colorOf(id) : NEUTRAL.hex;
  const isTarget = id => !!(S && sel && isHuman(S.seat) && S.owner[sel] === S.seat && S.phase === "attack" && T[sel].nb.includes(id) && S.owner[id] !== S.seat);
  function drawAll() {
    tx.globalCompositeOperation = "source-over"; tx.globalAlpha = 1;
    tx.drawImage(base, 0, 0);
    for (const t of GLOBE.t) {
      const hex = floodSt && floodSt.id === t.id ? floodSt.fromHex : fillOf(t.id);
      if (!(floodSt && floodSt.id === t.id)) drawn[t.id] = hex;
      tx.globalAlpha = S && S.owner[t.id] != null ? .9 : .72; tx.fillStyle = hex; tx.fill(t.path, "evenodd");
    }
    if (floodSt) {
      const t = GT[floodSt.id], rr = floodSt.r * floodSt.t;
      tx.save(); tx.clip(t.path, "evenodd"); tx.globalAlpha = .9; tx.fillStyle = floodSt.toHex; tx.beginPath();
      for (const sh of [-TW, 0, TW]) { tx.moveTo(floodSt.cx + sh + rr, floodSt.cy); tx.arc(floodSt.cx + sh, floodSt.cy, rr, 0, Math.PI * 2); }
      tx.fill();
      if (floodSt.t < 1) { tx.globalAlpha = 1; tx.strokeStyle = `rgba(255,246,214,${.9 * (1 - floodSt.t)})`; tx.lineWidth = 9; tx.stroke(); }
      tx.restore();
    }
    tx.globalAlpha = .35; tx.globalCompositeOperation = "multiply"; tx.fillStyle = grainPat; tx.fillRect(0, 0, TW, TH);
    tx.globalCompositeOperation = "source-over"; tx.globalAlpha = 1; tx.lineJoin = "round"; tx.lineCap = "round";
    tx.strokeStyle = "rgba(80,62,30,.5)"; tx.lineWidth = 1.3; for (const t of GLOBE.t) tx.stroke(t.path);
    tx.strokeStyle = "rgba(125,108,69,.7)"; tx.lineWidth = 2.4; tx.setLineDash([9, 8]); tx.stroke(seaPath); tx.setLineDash([]);
    tx.strokeStyle = "#8a6a2a"; tx.lineWidth = 3.2; tx.stroke(borderPath);
    tx.strokeStyle = "rgba(243,205,107,.7)"; tx.lineWidth = 1.1; tx.stroke(borderPath);
    if (S && sel) {
      tx.strokeStyle = "#ffffff"; tx.lineWidth = 3.4; tx.setLineDash([10, 7]);
      for (const t of GLOBE.t) if (isTarget(t.id)) tx.stroke(t.path);
      tx.setLineDash([]);
      tx.strokeStyle = "#e9b84c"; tx.lineWidth = 6; tx.stroke(GT[sel].path);
      tx.strokeStyle = "#fff8e4"; tx.lineWidth = 1.8; tx.stroke(GT[sel].path);
    }
  }
  // redraw and re-upload only a rectangle of the texture (used by the flood, every frame)
  let scratch = null;
  function drawRegion(x, y, w, h) {
    if (x < 0 || y < 0 || x + w > TW || y + h > TH) { drawAll(); texture.needsUpdate = true; return; }
    tx.save(); tx.beginPath(); tx.rect(x, y, w, h); tx.clip(); drawAll(); tx.restore();
    try {
      const p = renderer.properties.get(texture);
      if (!p.__webglTexture || texture.version > (p.__version || 0)) { texture.needsUpdate = true; return; }
      const gl = renderer.getContext();
      renderer.state.bindTexture(gl.TEXTURE_2D, p.__webglTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      if (!scratch || scratch.width !== w || scratch.height !== h) scratch = mk(w, h);
      const sc = scratch.getContext("2d"); sc.clearRect(0, 0, w, h); sc.drawImage(tex, x, y, w, h, 0, 0, w, h);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, TH - y - h, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
      gl.generateMipmap(gl.TEXTURE_2D);
    } catch (e) { texture.needsUpdate = true; }
  }

  /* ---------- set-up ---------- */
  function init() {
    const T3 = window.THREE;
    vec = (lon, lat, r = 1) => new T3.Vector3(Math.cos(lat * D2R) * Math.cos(lon * D2R) * r, Math.sin(lat * D2R) * r, -Math.cos(lat * D2R) * Math.sin(lon * D2R) * r);
    toLL = v => { const n = v.clone().normalize(); return [Math.atan2(-n.z, n.x) / D2R, Math.asin(Math.max(-1, Math.min(1, n.y))) / D2R]; };
    slerp = (a, b, t) => { const ang = a.angleTo(b); if (ang < 1e-6) return a.clone(); const s = Math.sin(ang); return a.clone().multiplyScalar(Math.sin((1 - t) * ang) / s).add(b.clone().multiplyScalar(Math.sin(t * ang) / s)); };
    for (const t of GLOBE.t) { t.box = [Infinity, Infinity, -Infinity, -Infinity]; t.path = polysPath(t.p, t.box); t.v = vec(t.lp[0], t.lp[1]); }
    neutralPath = polysPath(GLOBE.neutral);
    borderPath = new Path2D(); for (const l of GLOBE.borders) addPts(borderPath, unwrap(l), false);
    seaPath = new Path2D();
    for (const [a, b] of GLOBE.sea) { const r = []; for (let k = 0; k <= 48; k++) { const [lon, lat] = toLL(slerp(GT[a].v, GT[b].v, k / 48)); r.push(Math.round(lon * 10), Math.round(lat * 10)); } addPts(seaPath, unwrap(r), false); }
    const grain = mk(256, 256); { const g = grain.getContext("2d"), im = g.createImageData(256, 256); for (let k = 0; k < im.data.length; k += 4) { const v = 200 + Math.floor(Math.random() * 56); im.data[k] = v; im.data[k + 1] = v - 4; im.data[k + 2] = v - 14; im.data[k + 3] = 255; } g.putImageData(im, 0, 0); }
    base = mk(TW, TH); {
      const b = base.getContext("2d"), sea = b.createLinearGradient(0, 0, 0, TH);
      sea.addColorStop(0, "#ddd0aa"); sea.addColorStop(.5, "#e9ddbc"); sea.addColorStop(1, "#ddd0aa"); b.fillStyle = sea; b.fillRect(0, 0, TW, TH);
      b.strokeStyle = "rgba(125,108,69,.24)"; b.lineWidth = 1.3; b.beginPath();
      for (let lon = -180; lon <= 180; lon += 15) { b.moveTo(px(lon), 0); b.lineTo(px(lon), TH); }
      for (let lat = -75; lat <= 75; lat += 15) { b.moveTo(0, py(lat)); b.lineTo(TW, py(lat)); }
      b.stroke(); b.strokeStyle = "rgba(125,108,69,.38)"; b.lineWidth = 2; b.setLineDash([14, 10]); b.beginPath();
      for (const lat of [23.44, -23.44]) { b.moveTo(0, py(lat)); b.lineTo(TW, py(lat)); }
      b.stroke(); b.setLineDash([]); b.strokeStyle = "rgba(125,108,69,.45)"; b.lineWidth = 2.2; b.beginPath(); b.moveTo(0, TH / 2); b.lineTo(TW, TH / 2); b.stroke();
      b.lineJoin = "round";
      const coast = p => { for (const [w, a] of [[22, .05], [12, .07], [5, .1]]) { b.strokeStyle = `rgba(110,92,52,${a})`; b.lineWidth = w; b.stroke(p); } };
      coast(neutralPath); for (const t of GLOBE.t) coast(t.path);
      b.fillStyle = "#d8cba6"; b.fill(neutralPath, "evenodd"); b.strokeStyle = "rgba(90,70,35,.45)"; b.lineWidth = 1.4; b.stroke(neutralPath);
    }
    tex = mk(TW, TH); tx = tex.getContext("2d"); grainPat = tx.createPattern(grain, "repeat");
    const idc = mk(TW / 2, TH / 2), ic = idc.getContext("2d"); ic.scale(.5, .5);
    for (const t of GLOBE.t) { ic.fillStyle = `rgb(${t.i * 6},255,0)`; ic.fill(t.path, "evenodd"); }
    idData = ic.getImageData(0, 0, TW / 2, TH / 2).data;

    const wrap = $("mapwrap");
    canvas = document.createElement("canvas"); canvas.id = "gl"; canvas.setAttribute("aria-label", "Globe: drag to spin, tap a country"); canvas.style.display = "none";
    labels = document.createElement("div"); labels.id = "glabels"; labels.setAttribute("aria-hidden", "true"); labels.style.display = "none";
    svg.after(canvas, labels);
    try { renderer = new T3.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" }); }
    catch (e) { canvas.remove(); labels.remove(); throw e; }
    if (!renderer.getContext()) throw new Error("no WebGL");
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setClearColor(0x000000, 0);
    scene = new T3.Scene(); camera = new T3.PerspectiveCamera(32, 1, .05, 60);
    scene.add(new T3.AmbientLight(0xffffff, .78));
    const sun = new T3.DirectionalLight(0xffffff, .38); sun.position.set(-.7, .9, 1.2); scene.add(sun);
    globe = new T3.Group(); scene.add(globe);
    texture = new T3.CanvasTexture(tex); texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    drawAll();
    sphere = new T3.Mesh(new T3.SphereGeometry(1, 96, 64), new T3.MeshLambertMaterial({ map: texture })); globe.add(sphere);
    ring = new T3.Mesh(new T3.RingGeometry(1.0, 1.03, 160), new T3.MeshBasicMaterial({ color: 0xb08a3a })); scene.add(ring);
    const pg = new T3.CylinderGeometry(1, 1, 1, 14, 1); pg.translate(0, .5, 0);
    pillars = new T3.InstancedMesh(pg, new T3.MeshLambertMaterial({ color: 0xffffff }), GLOBE.t.length);
    const c0 = new T3.Color(); GLOBE.t.forEach(t => pillars.setColorAt(t.i, c0.set(NEUTRAL.hex)));
    globe.add(pillars);
    for (const t of GLOBE.t) { disp[t.id] = 0; const d = document.createElement("div"); d.className = "lb"; labels.appendChild(d); lbs[t.id] = { el: d, key: "", x: 0, y: 0, vis: null }; }
    new ResizeObserver(() => { if (api.on) resize(); }).observe(wrap);
    input();
  }

  /* ---------- pillars + badges ---------- */
  const pillarH = n => .01 + Math.min(n, RULES.squadCap) * .0068;
  const target = id => S ? S.squad[id].length : 0;
  let M4, Q, SC, UP, TC;
  function updatePillars() {
    if (!M4) { const T3 = window.THREE; M4 = new T3.Matrix4(); Q = new T3.Quaternion(); SC = new T3.Vector3(); UP = new T3.Vector3(0, 1, 0); TC = new T3.Color(); }
    for (const t of GLOBE.t) {
      Q.setFromUnitVectors(UP, t.v); SC.set(.0095, disp[t.id] > .01 ? pillarH(disp[t.id]) : .0001, .0095);
      M4.compose(t.v, Q, SC); pillars.setMatrixAt(t.i, M4); pillars.setColorAt(t.i, TC.set(fillOf(t.id)).multiplyScalar(.92));
    }
    pillars.instanceMatrix.needsUpdate = true; pillars.instanceColor.needsUpdate = true;
  }
  // one static piece (the captain, in his own kit, on the manager's base) + the count plaque; no idle animation here
  const pieceCache = new Map();
  const pieceSvg = (id, n) => {
    const cap = captainOf(id), home = homeCrowd(id), key = baseOf(id) + "|" + cap + "|" + home + "|" + n;
    if (!pieceCache.has(key)) {
      if (pieceCache.size > 400) pieceCache.clear();
      pieceCache.set(key, Pieces.svgString({ base: baseOf(id), kit: kitFor(cap, id), name: cap || "", num: Pieces.number(cap || "", POS[cap], true), captain: true, home },
        n, baseOf(id), S.owner[id] == null ? NEUTRAL.ink : SEATS[S.owner[id]].ink));
    }
    return pieceCache.get(key);
  };
  api.badges = () => {
    if (!ready || !api.on) return;
    for (const t of GLOBE.t) {
      const L = lbs[t.id], id = t.id;
      if (!S) { L.off = true; L.key = ""; continue; }
      L.off = false;
      const n = S.squad[id].length;
      const key = baseOf(id) + "|" + n + "|" + captainOf(id) + "|" + homeCrowd(id);
      if (key !== L.key) { L.el.innerHTML = n ? pieceSvg(id, n) : ""; L.key = key; }
      L.el.classList.toggle("sel", sel === id);
      if (lastN[id] != null && lastN[id] !== n && !RM) { const p = L.el.querySelector(".pop"); if (p) { p.classList.remove("bump"); void p.getBoundingClientRect(); p.classList.add("bump"); } }
      lastN[id] = n;
    }
    pillarsDirty = true; wake();
  };
  api.paint = () => {
    if (!ready || !api.on) return;
    const key = IDS.map(id => fillOf(id) + (isTarget(id) ? "t" : "")).join() + "|" + (S ? sel : "") + "|" + !!S;
    pillarsDirty = true;
    if (key === paintKey || floodSt) { wake(); return; }
    paintKey = key; drawAll(); texture.needsUpdate = true; wake();
  };
  let WV, CAMN;
  function placeBadges() {
    if (!WV) { WV = new window.THREE.Vector3(); CAMN = new window.THREE.Vector3(); }
    CAMN.copy(camera.position).normalize();
    const limit = 1 / camera.position.length(), s = Math.max(.72, Math.min(1.3, 2.7 / view.dist * worldDist / 3.6));
    for (const t of GLOBE.t) {
      const L = lbs[t.id];
      WV.copy(t.v).multiplyScalar(1 + (disp[t.id] > .01 ? pillarH(disp[t.id]) : 0) + .004).applyMatrix4(globe.matrixWorld);
      const facing = WV.clone().normalize().dot(CAMN) - limit;
      if (L.off || facing < .02) { if (L.vis !== false) { L.el.style.display = "none"; L.vis = false; } continue; }
      if (L.vis !== true) { L.el.style.display = ""; L.vis = true; }
      WV.project(camera);
      L.x = (WV.x + 1) / 2 * W; L.y = (1 - WV.y) / 2 * H;
      L.el.style.transform = `translate3d(${(L.x - 15).toFixed(1)}px,${(L.y - 52.5).toFixed(1)}px,0) scale(${(s * Math.min(1, .55 + facing * 2)).toFixed(3)})`;
      L.el.style.opacity = Math.min(1, facing * 6).toFixed(2);
      L.el.style.zIndex = sel === t.id ? 999 : Math.round(facing * 500);
    }
  }

  /* ---------- loop: renders only while something moves ---------- */
  const easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  function wake() { if (api.on && !raf) raf = requestAnimationFrame(frame); }
  function anim(dur, fn, e = easeIO) {
    return new Promise(res => {
      if (RM || fast || dur <= 0 || !api.on) { fn(1); wake(); res(); return; }
      anims.add({ t0: null, dur, fn, e, res }); wake();
    });
  }
  function resize() {
    const r = $("mapwrap").getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
    const hh = Math.atan(Math.tan(FOVH) * camera.aspect), was = !view.dist || Math.abs(view.dist - worldDist) < .01;
    worldDist = 1.07 / Math.sin(Math.min(FOVH, hh));
    if (was || view.dist > worldDist * 1.2) view.dist = worldDist;
    wake();
  }
  const clampDist = d => Math.max(Math.max(1.3, worldDist * .3), Math.min(worldDist * 1.15, d));
  function frame(now) {
    raf = 0; if (!api.on) return;
    const dt = Math.min(.05, last ? (now - last) / 1000 : .016); last = now;
    let more = anims.size > 0 || dragging || floats.size > 0;
    for (const a of [...anims]) {
      if (a.t0 === null) a.t0 = now;
      const t = Math.min(1, (now - a.t0) / a.dur); a.fn(a.e(t));
      if (t >= 1) { anims.delete(a); a.res(); }
    }
    if (!dragging && (Math.abs(view.vLon) > .5 || Math.abs(view.vLat) > .5)) {
      view.lon += view.vLon * dt; view.lat = Math.max(-75, Math.min(75, view.lat + view.vLat * dt));
      const k = Math.exp(-dt * 3.2); view.vLon *= k; view.vLat *= k; more = true;
    } else if (!dragging) view.vLon = view.vLat = 0;
    for (const id of IDS) {
      const d = target(id) - disp[id];
      if (Math.abs(d) > .01) { disp[id] = RM ? target(id) : disp[id] + d * Math.min(1, dt * 5); more = pillarsDirty = true; } else if (disp[id] !== target(id)) { disp[id] = target(id); pillarsDirty = true; }
    }
    if (pillarsDirty) { updatePillars(); pillarsDirty = false; }
    globe.rotation.set(view.lat * D2R, -Math.PI / 2 - view.lon * D2R, 0);
    camera.position.set(0, 0, view.dist); camera.lookAt(0, 0, 0);
    const rs = Math.sqrt(1 - 1 / (view.dist * view.dist)); ring.position.set(0, 0, 1 / view.dist); ring.scale.set(rs, rs, 1);
    scene.updateMatrixWorld(); renderer.render(scene, camera);
    placeBadges();
    for (const f of [...floats]) {
      const k = Math.min(1, (now - f.t0) / 1300), L = lbs[f.id];
      f.el.style.display = L.vis ? "" : "none";
      f.el.style.transform = `translate3d(${L.x.toFixed(1)}px,${(L.y - 30 - 30 * k).toFixed(1)}px,0) translateX(-50%)`;
      f.el.style.opacity = (1 - k * k).toFixed(2);
      if (k >= 1) { f.el.remove(); floats.delete(f); }
    }
    if (more) wake(); else last = 0;
  }
  function fly(lon, lat, dist, ms) {
    const tok = ++fly.tok, l0 = view.lon, a0 = view.lat, d0 = view.dist, dl = ((lon - l0) % 360 + 540) % 360 - 180;
    view.vLon = view.vLat = 0;
    return anim(ms, t => { if (tok !== fly.tok) return; view.lon = l0 + dl * t; view.lat = a0 + (lat - a0) * t; view.dist = d0 + (dist - d0) * t; });
  }
  fly.tok = 0;
  // frame these territories; with frac < 1 the action sits in the top `frac` of the screen (a panel covers the rest)
  api.flyTo = (ids, ms = 650, frac = 1) => {
    const vs = ids.map(id => GT[id].v), c = vs.reduce((a, v) => a.add(v), new window.THREE.Vector3());
    if (c.lengthSq() < 1e-4) c.copy(vs[0]); c.normalize();
    let spread = 0; for (const v of vs) spread = Math.max(spread, c.angleTo(v));
    const [lon, lat] = toLL(c), dist = clampDist(worldDist * Math.min(1, .36 + spread * 1.1 / Math.sqrt(frac)));
    let tlat = lat;
    if (frac < 1) { const rPx = (H / 2) / (Math.tan(FOVH) * Math.sqrt(dist * dist - 1)); tlat = lat - Math.asin(Math.min(.9, H * (.5 - frac * .56) / rPx)) / D2R; }
    return fly(lon, Math.max(-75, Math.min(75, tlat)), dist, ms);
  };
  api.zoom = z => {
    if (z === "world") fly(15, 25, worldDist, 900);
    else if (z === "europe") fly(13, 50, clampDist(worldDist * .42), 900);
    else fly(view.lon, view.lat, clampDist(view.dist * (z === "in" ? 1 / 1.4 : 1.4)), 350);
  };

  /* ---------- attack arc with runners, flood, floating numbers ---------- */
  function arcCurve(a, b) {
    const va = GT[a].v, vb = GT[b].v, ang = va.angleTo(vb), ha = disp[a] > .01 ? pillarH(disp[a]) : 0, pts = [];
    for (let k = 0; k <= 40; k++) { const t = k / 40, lift = (.05 + ang * .3) * Math.sin(Math.PI * t) + ha * (1 - t) * (1 - t) + .006; pts.push(slerp(va, vb, t).multiplyScalar(1 + lift)); }
    return new window.THREE.CatmullRomCurve3(pts);
  }
  const SKIN = ["#f1d3b0", "#d9a77a", "#a86b45", "#6b4228"];
  let RG = null;
  function runners(curve, hex, count) {
    const T3 = window.THREE;
    if (!RG) RG = { body: new T3.CylinderGeometry(.0062, .0072, .0135, 8).translate(0, .0185, 0), shorts: new T3.CylinderGeometry(.0072, .0072, .005, 8).translate(0, .0098, 0),
      head: new T3.SphereGeometry(.005, 10, 8).translate(0, .031, 0), leg: new T3.BoxGeometry(.0028, .0085, .0028).translate(0, -.0042, 0),
      shortsM: new T3.MeshLambertMaterial({ color: 0xF8F1DD }), legM: new T3.MeshLambertMaterial({ color: 0x241B08 }) };
    const n = Math.max(1, Math.min(5, count || 3)), kit = new T3.MeshLambertMaterial({ color: hex }), figs = [];
    for (let i = 0; i < n; i++) {
      const g = new T3.Group(), skin = new T3.MeshLambertMaterial({ color: SKIN[(i * 3 + 1) % 4] });
      const l1 = new T3.Mesh(RG.leg, RG.legM), l2 = new T3.Mesh(RG.leg, RG.legM); l1.position.set(-.0028, .0085, 0); l2.position.set(.0028, .0085, 0);
      g.add(new T3.Mesh(RG.body, kit), new T3.Mesh(RG.shorts, RG.shortsM), new T3.Mesh(RG.head, skin), l1, l2);
      g.userData = { l1, l2, skin }; g.scale.setScalar(1.25); g.visible = false; globe.add(g); figs.push(g);
    }
    const up = new T3.Vector3(), fwd = new T3.Vector3(), right = new T3.Vector3(), m = new T3.Matrix4(), dur = 950, gap = 130;
    return anim(dur + gap * (n - 1), tt => {
      const ms = tt * (dur + gap * (n - 1));
      figs.forEach((g, i) => {
        const k = Math.max(0, Math.min(1, (ms - i * gap) / dur)), e = easeIO(k);
        g.visible = k > 0 && k < 1; if (!g.visible) return;
        const p = curve.getPointAt(e), tg = curve.getTangentAt(e);
        up.copy(p).normalize(); fwd.copy(tg).addScaledVector(up, -tg.dot(up)).normalize(); right.crossVectors(up, fwd);
        m.makeBasis(right, up, fwd); g.quaternion.setFromRotationMatrix(m); g.position.copy(p);
        const sw = Math.sin(ms / 42 + i) * .55; g.userData.l1.rotation.x = sw; g.userData.l2.rotation.x = -sw;
      });
    }, t => t).then(() => { figs.forEach(g => { globe.remove(g); g.userData.skin.dispose(); }); kit.dispose(); wake(); });
  }
  api.attackArc = async (a, b, hex, count = 3) => {
    const T3 = window.THREE, curve = arcCurve(a, b), segs = 120, rad = 8;
    const geo = new T3.TubeGeometry(curve, segs, .0065, rad, false), geoU = new T3.TubeGeometry(curve, segs, .0105, rad, false);
    const tube = new T3.Mesh(geo, new T3.MeshBasicMaterial({ color: hex })), under = new T3.Mesh(geoU, new T3.MeshBasicMaterial({ color: 0xffffff, side: T3.BackSide }));
    geo.setDrawRange(0, 0); geoU.setDrawRange(0, 0); globe.add(under, tube);
    await anim(600, t => { const c = Math.ceil(t * segs) * rad * 6; geo.setDrawRange(0, c); geoU.setDrawRange(0, c); }, t => 1 - Math.pow(1 - t, 2));
    if (!RM && !fast && api.on) await runners(curve, hex, count);
    return () => { globe.remove(under, tube); geo.dispose(); geoU.dispose(); tube.material.dispose(); under.material.dispose(); wake(); };
  };
  api.flood = (id, fromId, hex) => {
    const t = GT[id], f = toLL(slerp(t.v, GT[fromId].v, .35)), mid = (t.box[0] + t.box[2]) / 2;
    let cx = px(f[0]); const cy = py(f[1]);
    while (cx - mid > TW / 2) cx -= TW; while (mid - cx > TW / 2) cx += TW;
    const r = Math.max(...[[t.box[0], t.box[1]], [t.box[2], t.box[1]], [t.box[0], t.box[3]], [t.box[2], t.box[3]]].map(([x, y]) => Math.hypot(x - cx, y - cy))) + 4;
    floodSt = { id, fromHex: drawn[id] || NEUTRAL.hex, toHex: hex, cx, cy, r, t: 0 };
    const x = Math.floor(t.box[0]) - 12, y = Math.floor(t.box[1]) - 12, w = Math.ceil(t.box[2] - t.box[0]) + 24, h = Math.ceil(t.box[3] - t.box[1]) + 24;
    return anim(850, k => { floodSt.t = k; drawRegion(x, y, w, h); }, t => 1 - Math.pow(1 - t, 3))
      .then(() => { floodSt = null; paintKey = ""; api.paint(); });
  };
  api.floatText = (id, text, kind) => {
    const el = document.createElement("div"); el.className = "gfl " + kind; el.textContent = text; el.style.opacity = 0;
    labels.appendChild(el); floats.add({ id, el, t0: performance.now() }); wake();
  };

  /* ---------- input: drag + inertia, pinch, wheel, tap -> tapTerritory ---------- */
  function input() {
    const ptrs = new Map(); let downAt = null, pinch0 = 0, dist0 = 0;
    const degPerPx = () => 57.3 / ((H / 2) / (Math.tan(FOVH) * Math.sqrt(view.dist * view.dist - 1)));
    canvas.addEventListener("pointerdown", e => {
      if (!api.on) return;
      canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp });
      fly.tok++; view.vLon = view.vLat = 0; dragging = true;
      if (ptrs.size === 1) downAt = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); dist0 = view.dist; downAt = null; }
      wake();
    });
    canvas.addEventListener("pointermove", e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      if (ptrs.size === 1) {
        const dx = e.clientX - p.x, dy = e.clientY - p.y, k = degPerPx(), dts = Math.max(.008, (e.timeStamp - p.t) / 1000);
        view.lon -= dx * k; view.lat = Math.max(-75, Math.min(75, view.lat + dy * k));
        view.vLon = RM ? 0 : .6 * view.vLon + .4 * (-dx * k / dts); view.vLat = RM ? 0 : .6 * view.vLat + .4 * (dy * k / dts);
      }
      p.x = e.clientX; p.y = e.clientY; p.t = e.timeStamp;
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], span = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0 > 0 && span > 0) view.dist = clampDist(dist0 * pinch0 / span); }
      wake();
    });
    const upH = e => {
      const me = ptrs.get(e.pointerId); if (!me) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size === 1) { const [p] = [...ptrs.values()]; p.t = e.timeStamp; view.vLon = view.vLat = 0; return; }
      if (ptrs.size) return;
      dragging = false;
      if (e.type === "pointerup" && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8 && e.timeStamp - downAt.t < 600) { view.vLon = view.vLat = 0; pick(e.clientX, e.clientY); }
      else if (e.timeStamp - me.t > 90) view.vLon = view.vLat = 0;
      downAt = null; wake();
    };
    canvas.addEventListener("pointerup", upH); canvas.addEventListener("pointercancel", upH);
    canvas.addEventListener("wheel", e => { if (!api.on) return; e.preventDefault(); fly.tok++; view.dist = clampDist(view.dist * Math.exp(e.deltaY * .0012)); wake(); }, { passive: false });
  }
  let ray, NDC;
  function idAt(u, v) {
    const w = TW / 2, h = TH / 2, x0 = Math.floor(u * w), y0 = Math.floor((1 - v) * h);
    for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = (x0 + dx + w) % w, y = Math.max(0, Math.min(h - 1, y0 + dy)), k = (y * w + x) * 4;
      if (idData[k + 3] === 255 && idData[k + 1] === 255 && idData[k] % 6 === 0 && GLOBE.t[idData[k] / 6]) return GLOBE.t[idData[k] / 6].id;
    }
    return null;
  }
  function pick(cx, cy) {
    if (!ray) { ray = new window.THREE.Raycaster(); NDC = new window.THREE.Vector2(); }
    const r = canvas.getBoundingClientRect();
    NDC.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    scene.updateMatrixWorld(); ray.setFromCamera(NDC, camera);
    const hit = ray.intersectObject(sphere)[0], id = hit && hit.uv ? idAt(hit.uv.x, hit.uv.y) : null;
    if (id) tapTerritory(id);
  }
  api.pick = pick;

  /* ---------- switching ---------- */
  api.show = () => {
    if (!ready) return;
    api.on = true; document.body.classList.add("globe-on");
    canvas.style.display = ""; labels.style.display = "";
    resize(); paintKey = ""; api.paint(); api.badges(); wake();
  };
  api.hide = () => {
    api.on = false; document.body.classList.remove("globe-on");
    if (!ready) return;
    canvas.style.display = "none"; labels.style.display = "none";
    for (const a of [...anims]) { anims.delete(a); a.fn(1); a.res(); }   // finish anything mid-flight at once
    for (const f of floats) f.el.remove(); floats.clear();
    if (raf) { cancelAnimationFrame(raf); raf = 0; } last = 0; dragging = false;
    applyView();
  };
  api.view = view;
  return api;
})();

/* ================= your turn ================= */
let sel = null;
const layer = $("layer");
function hint(html, actionHtml) { $("hint").innerHTML = html; $("action").innerHTML = actionHtml || ""; }
const tapWord = (cap = true) => isDesk() ? (cap ? "Click" : "click") : (cap ? "Tap" : "tap");
function bar(t) { $("bar").textContent = t; }
function closeSheet() { layer.innerHTML = ""; }
function refresh() {
  paint();
  if (S.phase !== "draft") bar(`${monthOf()} · ${Math.min(S.round, S.rounds)}/${S.rounds} · ${isHuman(S.seat) ? (solo() ? "your turn" : SEATS[S.seat].short) : SEATS[S.seat].name}`);
  if (S.over) return;
  if (S.phase === "draft") {
    const left = perManager() - owned(S.seat).length;
    bar(`The draft · ${SEATS[S.seat].short} to pick`);
    if (isHuman(S.seat)) hint(`<b>${solo() ? "Your pick" : esc(SEATS[S.seat].name) + " to pick"}.</b> ${tapWord()} an unclaimed country. ${left} to go.`, `<button class="quiet" id="autoPick">Pick for me</button>`);
    else hint(`<b>${esc(SEATS[S.seat].name)}</b> is picking…`);
    const ap = $("autoPick"); if (ap) ap.onclick = () => { if (draftPick) { const r = draftPick; draftPick = null; r(botPick(S.seat)); } };
    return;
  }
  if (S.phase === "setup") { hint("<b>Kick-off.</b>"); return; }
  if (!isHuman(S.seat)) { hint(`<b>${esc(SEATS[S.seat].name)}</b> is playing…`, fast ? "" : `<button class="quiet" id="skipRep">Skip replay</button>`); const sr = $("skipRep"); if (sr) sr.onclick = () => { fast = true; sr.remove(); }; return; }
  if (S.phase === "scout") hint(`<b>${solo() ? "" : esc(SEATS[S.seat].name) + ": "}${isWindow() ? `${monthOf()} transfer window: ${income(S.seat)} seconds, double time.` : `Scouting: ${income(S.seat)} seconds.`}${isUnderdog(S.seat) ? ` (+${RULES.underdogSecs} underdog)` : ""}</b> ${tapWord()} one of your countries to scout it.`, `<button class="quiet" id="skipScout">Skip</button>`);
  else hint(`<b>${solo() ? "" : esc(SEATS[S.seat].name) + ": "}${S.attacksLeft ? `${S.attacksLeft} attack${S.attacksLeft === 1 ? "" : "s"} left.</b> ${tapWord()} your country, then a neighbour.` : `No attacks left.</b>`} ${S.movesLeft <= 0 ? "" : S.attacksLeft ? `${S.movesLeft} move${S.movesLeft === 1 ? "" : "s"} left too.` : `${S.movesLeft} move${S.movesLeft === 1 ? "" : "s"} left: ${tapWord(false)} your country, then a neighbouring one of yours.`}`, `<button class="pill" id="endTurn">End turn</button>`);
  const sk = $("skipScout"); if (sk) sk.onclick = () => { S.phase = "attack"; save(); refresh(); };
  const et = $("endTurn"); if (et) et.onclick = endTurn;
}
let draftPick = null;   // resolves with the country a person picks during the draft
function tapTerritory(id) {
  if (S && S.phase === "draft") { if (draftPick && isHuman(S.seat) && S.owner[id] == null) { const r = draftPick; draftPick = null; r(id); } return; }
  if (!S || S.over || !isHuman(S.seat) || busy) return;
  // second tap: attack or move from the selected territory
  if (sel && sel !== id && S.owner[sel] === S.seat && S.phase === "attack" && T[sel].nb.includes(id)) {
    if (S.owner[id] !== S.seat) return sheetAttack(sel, id);
    if (S.movesLeft > 0) return sheetMove(sel, id);
  }
  sel = id; paint(); sheetTerritory(id);
}
function sheetTerritory(id) {
  const mine = S.owner[id] === S.seat, t = T[id], sq = S.squad[id];
  let actions = "";
  if (mine && S.phase === "scout") actions = `<button class="pill" id="scoutHere">Scout ${esc(t.name)} · ${income(S.seat)} s</button>`;
  else if (mine && S.phase === "attack") actions = sq.length >= 2 && S.attacksLeft > 0
    ? `<p class="label">Now tap a neighbour with a white dashed edge to attack it${S.movesLeft > 0 ? ", or one of yours to move players" : ""}.</p>`
    : `<p class="label">${S.attacksLeft === 0 ? (S.movesLeft > 0 ? `No attacks left. You can still move players (${S.movesLeft} move${S.movesLeft === 1 ? "" : "s"} left): pick a neighbouring country of yours.` : "No attacks or moves left this turn.") : "You need at least 2 players here to attack."}</p>`;
  layer.innerHTML = `<div class="sheet">
    <div class="row"><h2><span class="sw" style="background:${colorOf(id)}"></span>${esc(t.name)}</h2><button class="quiet close" id="x">Close</button></div>
    <p class="label">${esc(ownerName(id))} · ${sq.length} player${sq.length === 1 ? "" : "s"} · ${esc(t.confed)}</p>
    <p class="names">${sheetNames(id) || "Nobody"}</p>
    ${homeCrowd(id) ? `<p class="label" style="text-transform:none;letter-spacing:0;font-family:var(--body);font-size:.85rem">Home crowd: the captain is home-grown, so the first question of any attack here is one level harder.</p>` : ""}
    ${isStadium(id) ? `<p class="label" style="text-transform:none;letter-spacing:0;font-family:var(--body);font-size:.85rem"><b>${esc(SEATS[stadiumSeatOf(id)].name)}'s home stadium:</b> questions here are one level harder, and it's worth ${RULES.stadiumPts} points to whoever holds it.</p>` : ""}
    ${S.motm === id ? `<p class="label" style="text-transform:none;letter-spacing:0;font-family:var(--body);font-size:.85rem"><b>Match of the month:</b> hold it at the end of ${esc(monthOf())} for +${RULES.motmPts} points.</p>` : ""}
    <p class="label">Neighbours: ${t.nb.map(n => esc(T[n].name)).join(", ")}</p>
    ${actions}</div>`;
  $("x").onclick = () => { sel = null; closeSheet(); paint(); };
  const sh = $("scoutHere"); if (sh) sh.onclick = () => scout(id);
}
// moving players: pick how many (1 up to everyone but one; never more than the target country has room for).
// The captain stays at home so the home crowd isn't lost by accident; the best of the others go first.
function sheetMove(from, to) {
  const all = S.squad[from].length - 1, room = RULES.squadCap - S.squad[to].length, max = Math.min(all, room);
  if (all < 1) return;
  if (max < 1) { layer.innerHTML = `<div class="sheet"><h2>No room</h2><p class="intro">${esc(T[to].name)} already has ${RULES.squadCap} players, the most a squad can hold.</p><button class="quiet" id="x">Close</button></div>`; $("x").onclick = closeSheet; return; }
  const cap = captainOf(from);
  const order = () => S.squad[from].filter(n => n !== cap).sort((a, b) => (FAME[b] || 0) - (FAME[a] || 0));   // who goes first
  let k = max;
  layer.innerHTML = `<div class="sheet"><h2>Move players</h2>
    <p class="intro">From ${esc(T[from].name)} (${S.squad[from].length}) to ${esc(T[to].name)} (${S.squad[to].length}). ${S.movesLeft} of ${RULES.movesPerTurn} moves left this turn.</p>
    <label class="mvpick" for="mvN"><span>How many?</span><input type="range" id="mvN" min="1" max="${max}" value="${max}" step="1"><b id="mvK">${max}</b></label>
    <p class="label" id="mvAfter"></p>
    <p class="names" id="mvWho"></p>
    ${room < all ? `<p class="label" style="text-transform:none;letter-spacing:0;font-family:var(--body);font-size:.85rem">${esc(T[to].name)} only has room for ${room} more (a squad holds ${RULES.squadCap}).</p>` : ""}
    <div class="row"><button class="pill" id="mv">Move ${max}</button><button class="quiet" id="x">Cancel</button></div></div>`;
  const show = () => {
    k = +$("mvN").value;
    $("mvK").textContent = k; $("mv").textContent = `Move ${k}`;
    $("mvAfter").textContent = `After the move: ${T[from].name} ${S.squad[from].length - k} · ${T[to].name} ${S.squad[to].length + k}`;
    const who = order().slice(0, k);
    $("mvWho").innerHTML = who.slice(0, 6).map(esc).join(" · ") + (who.length > 6 ? ` <span style="font-weight:600">+ ${who.length - 6} more</span>` : "");
  };
  $("mvN").oninput = show; show();
  $("x").onclick = () => { closeSheet(); };
  $("mv").onclick = async () => {
    const go = order().slice(0, k);
    closeSheet(); busy = true;
    await moveScene(from, to, go, go.length);
    S.squad[from] = S.squad[from].filter(n => !go.includes(n));
    S.squad[to].push(...go);
    S.movesLeft--; sel = null; busy = false; save(); refresh();
    floatText(from, "−" + go.length, "loss"); floatText(to, "+" + go.length, "gain");
  };
}

/* ---------- scouting burst ---------- */
let busy = false;
function scout(id) {
  busy = true; const secs = income(S.seat), N = nationIndex(id), t = T[id];
  const signed = []; let end = 0, iv = null, gridFound = 0;
  layer.innerHTML = `<div class="over">
    <div class="card clockcard"><div class="clock" id="clock">${secs}</div><div class="count">Signed for ${esc(t.name)}<b id="cnt">0</b></div><div class="timebar"><i id="tb"></i></div></div>
    ${S.scoutMode === "type" ? `<form class="typebox" id="f" autocomplete="off"><input id="in" placeholder="A player from ${esc(t.name)}" autocapitalize="words" spellcheck="false" enterkeyhint="done" aria-label="Player name"><button class="pill" type="submit">Sign</button></form>
      <p class="counts">Counts for ${esc(t.name)}: <b>${esc(memberNames(id))}</b>. Only a player's main nationality counts.</p>
      <p class="msg" id="msg">The clock starts with your first letter.</p>`
      : `<p class="msg" id="msg">Tap the players from ${esc(t.name)}. A wrong tap costs 2 seconds.</p><div class="taps" id="taps"></div>`}
    <div class="sheetlist"><p class="label">New signings</p><p class="names" id="signed">Nobody yet.</p></div>
    <button class="quiet" id="stop">Stop scouting</button></div>`;
  const say = (m, c) => { const el = $("msg"); el.textContent = m; el.className = "msg" + (c ? " " + c : ""); };
  const sign = i => {
    const n = N.players[i][0]; S.used[n] = 1; signed.push(n);
    $("cnt").textContent = signed.length; $("signed").textContent = signed.slice().reverse().join(" · ");
    say(`${n} signed.`, "hit");
  };
  const start = () => { if (end) return; end = performance.now() + secs * 1000; iv = setInterval(tick, 100); };
  const tick = () => { const left = Math.max(0, (end - performance.now()) / 1000); $("clock").textContent = Math.ceil(left); $("clock").classList.toggle("low", left <= 5); $("tb").style.width = left / secs * 100 + "%"; if (left <= 0) stop(); };
  const stop = () => {
    clearInterval(iv);
    S.squad[id].push(...signed); S.squad[id] = S.squad[id].slice(0, RULES.squadCap);
    st().signed += signed.length; st().signedNames.push(...signed); S.phase = "attack"; busy = false; save();
    layer.innerHTML = `<div class="sheet"><h2>${signed.length} signed for ${esc(t.name)}</h2>
      <p class="names">${signed.map(esc).join(" · ") || "Nobody this time."}</p>
      <p class="label">Squad there now: ${S.squad[id].length}${S.squad[id].length >= RULES.squadCap ? " (full)" : ""}</p>
      <button class="pill" id="ok">On to the attacks</button></div>`;
    $("ok").onclick = async () => { closeSheet(); refresh(); await flyTo([id], 500); floatText(id, "+" + signed.length, "gain"); busy = true; await signingScene(id, signed); busy = false; };
  };
  $("stop").onclick = () => { if (!end) end = performance.now(); stop(); };
  if (S.scoutMode === "type") {
    const inp = $("in"); inp.focus();
    inp.addEventListener("input", () => { start(); if (N.first.has(norm(inp.value))) return; const r = resolveName(N, inp.value, false); if (r.kind === "hit") { sign(r.i); inp.value = ""; } });
    $("f").addEventListener("submit", e => {
      e.preventDefault(); start(); if (!inp.value.trim()) return;
      const r = resolveName(N, inp.value, true);
      if (r.kind === "hit") { sign(r.i); inp.value = ""; return; }
      if (r.kind === "dup") say(`${N.players[r.i][0]} is already signed by someone this game.`);
      else if (r.kind === "ambig") say("More than one player is called that. Add a first name.");
      else { const elsewhere = otherTerritory(inp.value, id);
        say(elsewhere ? `${elsewhere.name} is from ${elsewhere.country}: he counts for ${T[elsewhere.tid].name}, not ${t.name}.` : `Not a ${t.name} player in our database.`);
        inp.classList.remove("shake"); void inp.offsetWidth; inp.classList.add("shake"); }
      inp.select();
    });
  } else {
    start();
    const grid = () => {
      const P = N.players, top = P.map((p, i) => i).filter(i => !S.used[P[i][0]]).slice(0, 150);
      const right = []; while (right.length < 3 && top.length) right.push(top.splice(Math.floor(Math.random() * top.length), 1)[0]);
      const names = new Set(P.map(p => p[0])), dec = [];
      while (dec.length < 6) { const o = GAME[pick(IDS.filter(x => x !== id))].p; const d = o[Math.floor(Math.random() * Math.min(150, o.length))]; if (d && !names.has(d[0]) && !dec.includes(d[0])) dec.push(d[0]); }
      const cells = shuffle([...right.map(i => ({ n: P[i][0], i })), ...dec.map(n => ({ n, i: -1 }))]);
      gridFound = 0;
      $("taps").innerHTML = cells.map((c, k) => `<button class="tap" data-k="${k}">${esc(c.n)}</button>`).join("");
      $("taps").querySelectorAll(".tap").forEach(b => b.onclick = () => {
        if (b.disabled) return; b.disabled = true; const c = cells[+b.dataset.k];
        if (c.i >= 0) { b.classList.add("ok"); sign(c.i); if (++gridFound === right.length) setTimeout(() => end && performance.now() < end && grid(), 250); }
        else { b.classList.add("no"); end -= 2000; say(`${c.n} isn't from ${t.name}. Minus 2 seconds.`); }
      });
    };
    grid();
  }
}

/* ---------- attack (you) ---------- */
function sheetAttack(from, to) {
  if (S.attacksLeft <= 0) return;
  const A = S.squad[from].length - 1, D = S.squad[to].length;
  if (A < 1) { layer.innerHTML = `<div class="sheet"><h2>Not enough players</h2><p class="intro">Keep at least one player at home. Scout or move more players to ${esc(T[from].name)} first.</p><button class="quiet" id="x">Close</button></div>`; $("x").onclick = closeSheet; return; }
  layer.innerHTML = `<div class="sheet"><h2>Attack ${esc(T[to].name)}?</h2>
    <p class="intro">Send ${A} from ${esc(T[from].name)} against ${D} (${esc(ownerName(to))}). The questions are about ${esc(T[to].name)} and start at ${TIER_LABEL[tierFor(D)].toLowerCase()} level.</p>
    <div class="row"><button class="pill" id="go">Attack with ${A}</button><button class="quiet" id="x">Cancel</button></div></div>`;
  $("x").onclick = closeSheet;
  $("go").onclick = () => battle(from, to);
}
async function battle(from, to) {
  busy = true; S.attacksLeft--; st().battles++;
  const me = S.seat, kit = SEATS[me], startD = S.squad[to].length;
  closeSheet(); sel = null; paint();
  const derby = derbyOf(from, to), home = homeCrowd(to), cap = captainOf(to), stadium = isStadium(to), stadSeat = stadiumSeatOf(to);
  await flyTo([from, to], 700);
  sfx.crowd(2.6, derby ? .45 : .26);
  if (derby) await banner("Derby!", derby, "derby");
  const lastOne = S.owner[to] != null && owned(S.owner[to]).length === 1, defHex = baseOf(to);
  const clearArc = await attackArc(from, to, kit.hex, S.squad[from].length - 1, best(S.squad[from].slice(1), 5));
  const sent = S.squad[from].splice(1), lostA = [], lostD = [];
  let A = sent.length, D = S.squad[to].length, rights = 0, asked = 0, retreat = false, shownA = 0, shownD = 0;
  drawBadges();
  flyTo([from, to], 450, .3);
  const notes = [stadium ? `<b>${esc(SEATS[stadSeat].name)}'s home stadium</b>: every question is one level harder, and it's worth ${RULES.stadiumPts} points to whoever holds it.` : "", derby ? `<b>${esc(derby)}</b>: every question is one level harder.` : "", home ? `<b>Home crowd</b>: ${esc(cap)} captains a home-grown side, so the first question is one level harder.` : ""].filter(Boolean);
  layer.innerHTML = `<div class="over battle"><div class="tv" id="tv"></div>${notes.length ? `<p class="label" style="text-transform:none;letter-spacing:0;font-family:var(--body);font-size:.85rem">${notes.join(" ")}</p>` : ""}<div id="striphost"></div><div class="teams" id="teams"></div><div id="qhost"></div>
    <div class="row" style="justify-content:center"><button class="quiet" id="pull">Pull back</button></div></div>`;
  const strip = battleStrip($("striphost"), { base: kit.hex, name: best(sent, 1)[0], kitId: from }, { base: defHex, name: cap, kitId: to, captain: true });
  const gone = (list, shown) => list.map((n, i) => `<s class="${i >= shown ? "drop" : ""}" style="animation-delay:${Math.max(0, i - shown) * 220}ms">${esc(n)}</s>`);
  const tv = () => {
    $("tv").innerHTML = `<div class="side" style="background:${kit.hex};color:${kit.ink}">${esc(T[from].name)}</div>
      <div class="mid">${A}<small>vs</small>${Math.max(0, D)}</div><div class="side r" style="background:${colorOf(to)};color:${inkOf(to)}">${esc(T[to].name)}</div>`;
    $("teams").innerHTML = `<p>${[sheetNames(from, sent, null), ...gone(lostA, shownA)].filter(Boolean).join(" · ")}</p>
      <p class="r">${[sheetNames(to, S.squad[to], cap), ...gone(lostD, shownD)].filter(Boolean).join(" · ")}</p>`;
    shownA = lostA.length; shownD = lostD.length;
  };
  tv();
  $("pull").onclick = () => { retreat = true; $("pull").textContent = "Pulling back after this question"; };
  while (A > 0 && D > 0 && !retreat) {
    let tier = tierFor(D); if (derby) tier = up(tier); if (home && asked === 0) tier = up(tier); if (stadium) tier = up(tier);
    const ok = await askQuestion(to, tier, $("qhost")); asked++;
    if (ok) {
      rights++; const loss = Math.ceil(A / 3), before = D;
      D = rights < 2 ? Math.max(1, D - loss) : D - loss;
      // THE DECIDING PENALTY: the blow that would take the country is a kick from the spot
      if (D <= 0 && S.pens !== false) {
        sfx.whistle("short");
        const keeper = S.owner[to] == null ? { shirt: NEUTRAL.hex, ink: NEUTRAL.ink } : { shirt: SEATS[S.owner[to]].hex, ink: SEATS[S.owner[to]].ink };
        const keeperOdds = ({ easy: .2, normal: .27, hard: .34 })[tier] + (derby ? .05 : 0) + (isHuman(S.owner[to]) ? 0 : lvl().keeper);
        const defSeat = S.owner[to], humanKeeper = isHuman(defSeat);   // a person in goal picks the dive themselves
        const res = await Penalty.take({ host: $("mapwrap"), attacker: { shirt: kit.hex, ink: kit.ink }, keeperKit: keeper, saveChance: keeperOdds,
          shooter: "human", keeper: humanKeeper ? "human" : "cpu", shooterName: SEATS[me].name, keeperName: humanKeeper ? SEATS[defSeat].name : "",
          keeperTitle: humanKeeper ? `${SEATS[defSeat].name}, you're in goal!` : "", keeperLine: humanKeeper ? `${SEATS[me].name} wants ${T[to].name}. Pick where your keeper dives: guess the corner and it's saved.` : "",
          title: "Penalty!", line: `${captainOf(to) || "The last defender"} is all that stands between you and ${T[to].name}. Pick your corner.`,
          onResult: r => r === "scored" ? sfx.roar(.45) : sfx.groan() });
        if (res) { st(me).pens++; if (res === "scored") st(me).pensScored++; }
        if (res === "saved") { D = 1; floatText(to, "Saved!", "loss"); }
      }
      lostD.push(...removePlayers(to, S.squad[to].length - Math.max(0, D)));
      if (before - Math.max(0, D)) floatText(to, "\u2212" + (before - Math.max(0, D)), "loss");
    } else {
      const loss = Math.min(sent.length, Math.ceil(D / 3));
      for (let k = 0; k < loss; k++) lostA.push(...sent.splice(Math.floor(Math.random() * sent.length), 1));
      A = sent.length; floatText(from, "\u2212" + loss, "loss");
    }
    tv(); drawBadges();
    await strip.hit(ok, best(sent, 1)[0], captainOf(to));
  }
  await pause(600);
  strip.remove();
  layer.innerHTML = "";
  let text;
  if (D <= 0) {
    const prev = S.owner[to];
    S.owner[to] = me; S.squad[to] = sent.slice(0, RULES.squadCap);
    st(me).ko += startD; if (derby) st(me).derbies++;
    if (!st(me).best || derby || startD > (st(me).bestN || 0)) { st(me).best = derby || `${T[to].name} (${startD} defenders)`; st(me).bestN = derby ? 99 : startD; }
    if (isHuman(prev) && prev !== me) (S.news[prev] ||= []).push(`${esc(SEATS[me].name)} took <b>${esc(T[to].name)}</b> from you.`);
    sfx.roar(derby ? .7 : .55);
    await takeoverScene(from, to, best(sent, 1)[0], cap, kit.hex, defHex, 1, lastOne, () => flood(to, from, kit.hex));
    paint(); floatText(to, "+" + S.squad[to].length, "gain");
    if (stadium) { feed(`<b>${esc(SEATS[me].name)}</b> took ${stadSeat === me ? "back their" : esc(SEATS[stadSeat].name) + "'s"} home stadium in ${esc(T[to].name)}!`); await banner(stadSeat === me ? "Home again!" : "Stadium taken!", `${T[to].name} · +${RULES.stadiumPts} points`); }
    text = `<h2>${esc(T[to].name)} is yours</h2><p class="intro">${derby ? `You won ${esc(derby)}. ` : ""}${sent.length} player${sent.length === 1 ? "" : "s"} move in: ${sent.map(esc).join(" · ")}.</p>`;
  } else {
    st(me).ko += startD - Math.max(0, D);
    S.squad[from].push(...sent); paint();
    text = A <= 0 ? `<h2>The attack failed</h2><p class="intro">${esc(T[to].name)} held with ${D} left.</p>` : `<h2>You pulled back</h2><p class="intro">${A} player${A === 1 ? "" : "s"} return to ${esc(T[from].name)}.</p>`;
  }
  clearArc();
  busy = false; save();
  await pause(500);
  layer.innerHTML = `<div class="sheet">${text}<button class="pill" id="ok">Back to the map</button></div>`;
  $("ok").onclick = () => { closeSheet(); refresh(); checkEnd(); };
}

/* ================= computer turns ================= */
function toast(html) {
  feed(html);
  const el = document.createElement("div"); el.className = "toast"; el.innerHTML = html;
  $("log").appendChild(el); while ($("log").children.length > 3) $("log").firstChild.remove();
  setTimeout(() => el.remove(), 4200);
}
async function endTurn() {
  if (!S || busy || S.over || !isHuman(S.seat) || S.phase === "draft") return;   // never during a move
  busy = true; sel = null; closeSheet(); fast = false;
  await advance();
}
// play the turns that follow, computers straight away, until it's a person's turn or the season ends
async function advance() {
  busy = true;
  for (;;) {
    if (S.order.some(k => owned(k).length === IDS.length)) { busy = false; save(); return checkEnd(); }
    const n = S.order.length, prev = S.turn;
    S.turn = (S.turn + 1) % n;
    if (prev === n - 1) {   // the order went round: a new month
      awardMotm();
      S.round++;
      for (let k = 0; k < S.humans; k++) S.lastStands[k] = RULES.lastStandsPerRound;
      if (S.round > S.rounds) { S.seat = S.order[0]; fast = false; busy = false; save(); refresh(); return checkEnd(); }
      fast = false; refresh();
      feed(`<b>${esc(monthOf())}</b>${isWindow() ? ": transfer window open" : ""}.`);
      newMotm();
      await banner(monthOf(), isWindow() ? "Transfer window · double scouting time" : S.round === S.rounds ? "Final day of the season" : `Round ${S.round} of ${S.rounds}`);
    }
    const seat = S.order[S.turn];
    if (isHuman(seat)) { fast = false; busy = false; return startTurn(seat); }
    if (!owned(seat).length) { toast(`<b>${esc(SEATS[seat].name)}</b> was sacked and gets a new job.`); await dropIn(rehire(seat)); }
    S.seat = seat; S.phase = "bot"; refresh(); await pause(300);
    await botTurn(seat);
    save();
  }
}
// a human player's turn: sacked check, then (with more than one person) the pass-the-phone screen
async function startTurn(seat, newRound) {
  if (S.order.some(k => owned(k).length === IDS.length)) { busy = false; save(); return checkEnd(); }
  S.seat = seat; S.phase = "scout"; S.attacksLeft = RULES.attacksPerTurn; S.movesLeft = RULES.movesPerTurn;
  if (!owned(seat).length) { toast(`<b>${esc(SEATS[seat].name)}</b> ${solo() ? "were" : "was"} sacked. New job!`); const nid = rehire(seat); busy = true; await dropIn(nid); busy = false; }
  save(); refresh();
  const sub = isWindow() ? "Transfer window · double scouting time" : S.round === S.rounds ? "Final day of the season" : (solo() ? "Your turn" : `${SEATS[seat].name}'s turn`);
  if (solo()) { refresh(); return checkEnd(); }
  busy = true;
  const news = (S.news[seat] || []).splice(0);
  const k = SEATS[seat];
  const el = document.createElement("div"); el.className = "pass"; el.setAttribute("role", "dialog");
  el.innerHTML = `<p class="label" style="color:var(--sage)">${esc(monthOf())} · round ${S.round} of ${S.rounds}</p>
    <svg class="kit" viewBox="-15 -14 30 28"><path d="${SHIRT}" fill="${k.hex}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
    <div class="who">${isDesk() ? "Over to" : "Pass the phone to"} ${esc(k.name)}</div>
    <p>${isWindow() ? "It's a transfer window: double scouting time." : "Everyone else, look away when they start."}</p>
    ${news.length ? `<div><p class="label" style="color:var(--sage);margin-bottom:6px">Since your last turn</p><ul>${news.map(n => `<li>${n}</li>`).join("")}</ul></div>` : ""}
    <button class="pill" id="go">I'm ${esc(k.name)}, start my turn</button>`;
  $("mapwrap").appendChild(el);
  sfx.whistle("short");
  await new Promise(r => $("go").onclick = r);
  el.remove(); save(); busy = false; refresh();
  const mine = owned(seat); if (mine.length) flyTo(mine.slice(0, 6), 600);
}
function rehire(seat) {
  const free = IDS.filter(id => S.owner[id] == null);
  const id = free.length ? pick(free) : IDS.slice().sort((a, b) => S.squad[a].length - S.squad[b].length)[0];
  S.owner[id] = seat; S.squad[id] = []; for (let i = 0; i < 3; i++) autoSign(id);
  return id;
}
const threat = (seat, id) => T[id].nb.filter(n => S.owner[n] !== seat).reduce((a, n) => a + S.squad[n].length, 0);
async function botTurn(seat) {
  // scouting: names per second, onto the most threatened border
  const mine = owned(seat);
  const border = mine.filter(id => T[id].nb.some(n => S.owner[n] !== seat));
  const target = (border.length ? border : mine).sort((a, b) => threat(seat, b) - threat(seat, a))[0];
  const n = Math.round(income(seat) * lvl().rate * (0.8 + Math.random() * 0.4));
  await flyTo([target], 550);
  let got = 0;
  for (let k = 0; k < n && S.squad[target].length < RULES.squadCap; k++) { autoSign(target); got++; }
  paint(); floatText(target, "+" + got, "gain");
  toast(`<b>${esc(SEATS[seat].name)}</b> signs ${got} for ${esc(T[target].name)}.`);
  await pause(800);
  // up to two attacks where they have 1.5x the defenders
  for (let a = 0; a < RULES.attacksPerTurn; a++) {
    const opts = [];
    for (const id of owned(seat)) for (const nb of T[id].nb) if (S.owner[nb] !== seat) {
      const A = S.squad[id].length - 1, D = S.squad[nb].length;
      if (A >= 2 && A >= 1.5 * D) opts.push({ from: id, to: nb, score: A / Math.max(1, D) + (isHuman(S.owner[nb]) ? 0.3 : 0) });
    }
    if (!opts.length) break;
    const o = opts.sort((x, y) => y.score - x.score)[0];
    await botBattle(seat, o.from, o.to);
    paint(); await pause(500);
  }
}
async function botBattle(seat, from, to) {
  await flyTo([from, to], 600);
  const derby = derbyOf(from, to);
  if (derby) toast(`<b>Derby!</b> ${esc(derby)}.`);
  sfx.crowd(1.6, derby ? .2 : .1);
  const defCap = captainOf(to), defHex = baseOf(to), lastOne = S.owner[to] != null && owned(S.owner[to]).length === 1;
  const clearArc = await attackArc(from, to, SEATS[seat].hex, S.squad[from].length - 1, best(S.squad[from].slice(1), 5), .5);
  const sent = S.squad[from].splice(1), defender = S.owner[to], startA = sent.length, startD = S.squad[to].length;
  let A = sent.length, D = S.squad[to].length, rights = 0;
  drawBadges();
  while (A > 0 && D > 0 && A >= D * 0.9) {
    let bt = tierFor(D); if (derby) bt = up(bt); if (isStadium(to)) bt = up(bt);
    if (Math.random() < lvl().acc[bt]) { rights++; const loss = Math.ceil(A / 3); D = rights < 2 ? Math.max(1, D - loss) : D - loss; }
    else { const loss = Math.ceil(D / 3); for (let k = 0; k < loss && sent.length; k++) sent.splice(Math.floor(Math.random() * sent.length), 1); A = sent.length; }
  }
  // the final blow on a person's country is a penalty, with that person in goal picking the dive
  if (D <= 0 && isHuman(defender) && S.pens !== false) {
    const wasFast = fast; fast = false;
    await flyTo([from, to], 400, .3);
    sfx.whistle("short");
    const res = await Penalty.take({ host: $("mapwrap"), attacker: { shirt: SEATS[seat].hex, ink: SEATS[seat].ink }, keeperKit: { shirt: SEATS[defender].hex, ink: SEATS[defender].ink },
      shooter: "cpu", keeper: "human", title: "Penalty against you!",
      keeperTitle: solo() ? "You're in goal!" : `${SEATS[defender].name}, you're in goal!`,
      keeperLine: `${SEATS[seat].name} ${/s$/.test(SEATS[seat].name) ? "are" : "is"} about to take ${T[to].name}. Pick where your keeper dives: guess their corner and the country holds.`,
      onResult: r => r === "saved" ? sfx.roar(.45) : sfx.groan() });
    fast = wasFast;
    if (res === "saved") { D = 1; feed(`<b>${esc(SEATS[defender].name)}</b> saved a penalty: ${esc(T[to].name)} holds.`); }
  }
  removePlayers(to, S.squad[to].length - Math.max(0, D));
  if (startD - Math.max(0, D)) floatText(to, "\u2212" + (startD - Math.max(0, D)), "loss");
  if (startA - A) floatText(from, "\u2212" + (startA - A), "loss");
  drawBadges(); await pause(450);
  if (D <= 0 && isHuman(defender) && (S.lastStands[defender] || 0) > 0) {
    S.lastStands[defender]--;
    const held = await lastStand(seat, from, to, A, defCap, sent);
    if (held) { S.squad[to] = [autoSignName(to)]; S.squad[from].push(...sent); clearArc(); paint(); floatText(to, "Held!", "gain"); toast(`<b>Last stand!</b> ${esc(T[to].name)} holds.`); return; }
  }
  if (D <= 0) {
    S.owner[to] = seat; S.squad[to] = sent;
    if (isHuman(defender)) { sfx.groan(); if (!solo()) (S.news[defender] ||= []).push(`${esc(SEATS[seat].name)} took <b>${esc(T[to].name)}</b> from you.`); } else sfx.roar(.22);
    await takeoverScene(from, to, best(sent, 1)[0], defCap, SEATS[seat].hex, defHex, .5, lastOne, () => flood(to, from, SEATS[seat].hex));
    if (isStadium(to)) feed(`<b>${esc(SEATS[seat].name)}</b> took the home stadium in ${esc(T[to].name)}!`);
    toast(`<b>${esc(SEATS[seat].name)}</b> takes ${esc(T[to].name)}${isHuman(defender) ? (solo() ? " from you" : ` from ${esc(SEATS[defender].name)}`) : ""}.`);
  } else { S.squad[from].push(...sent); toast(`<b>${esc(SEATS[seat].name)}</b> attacks ${esc(T[to].name)} but it holds.`); }
  clearArc(); paint();
}
function autoSignName(id) { const before = S.squad[id].length; autoSign(id); return S.squad[id].splice(before, 1)[0]; }
async function lastStand(seat, from, to, A, defCap, sent = []) {
  const wasFast = fast; fast = false;
  await flyTo([from, to], 500, .3);
  sfx.whistle("short");
  const def = S.owner[to];
  layer.innerHTML = `<div class="over battle"><div class="tv"><div class="side" style="background:${SEATS[seat].hex};color:#fff">${esc(SEATS[seat].name)}</div><div class="mid">${A}<small>vs</small>0</div><div class="side r" style="background:${SEATS[def].hex};color:${SEATS[def].ink}">${esc(T[to].name)}</div></div>
    <div id="striphost"></div>
    <p class="intro"><b>Last stand${solo() ? "" : " for " + esc(SEATS[def].name)}.</b> ${esc(T[to].name)} is about to fall. Answer this one right and the attack fails.</p><div id="qhost"></div></div>`;
  // your captain plants his feet; three attackers run at him
  const strip = battleStrip($("striphost"), { base: SEATS[seat].hex, name: null }, { base: SEATS[def].hex, name: defCap, kitId: to, captain: true });
  const hero = strip.d; if (hero) { hero.x = 232; Pieces.redraw(hero); }
  const atk = best(sent, 3).map((n, i) => Pieces.make(strip.svg, { base: SEATS[seat].hex, kit: kitFor(n), name: n, num: Pieces.number(n, POS[n], false), x: [40, 24, 60][i], y: [86, 100, 104][i], s: .55, idle: false, live: true }));
  atk.forEach(f => f.run = true);
  await Promise.all(atk.map((f, i) => Pieces.moveTo(f, 170 + i * 6, f.y, 800, Pieces.ease.in)));
  atk.forEach(f => f.run = false);
  const ok = await askQuestion(to, tierFor(A), $("qhost"), def);
  if (ok && hero) {   // held: a gold ring, arms wide, the attackers bounce off and trudge home
    const ring = Pieces.el("circle", { cx: 232, cy: 70, r: 8, fill: "none", stroke: "#f3cd6b", "stroke-width": 4 }, strip.svg);
    Pieces.tween(500, k => { ring.setAttribute("r", 8 + 40 * k); ring.setAttribute("opacity", 1 - k); }, Pieces.ease.out).then(() => ring.remove());
    Pieces.tween(260, k => { hero.hop = 8 * Math.sin(k * Math.PI); hero.raiseL = hero.raiseR = 10 + 80 * k; });
    await Promise.all(atk.map(f => { const x0 = f.x; return Pieces.tween(320, k => { f.x = x0 - 30 * k; f.tilt = -30 * Math.sin(k * Math.PI); }, Pieces.ease.out); }));
    atk.forEach(f => f.run = true);
    await Promise.all(atk.map(f => { const x0 = f.x; return Pieces.tween(700, k => { f.x = Pieces.lerp(x0, -30, k); f.op = 1 - k * .8; }, Pieces.ease.in); }));
  } else if (hero) {
    await Pieces.tween(420, k => { hero.tilt = 92 * k; hero.raiseL = hero.raiseR = 10 + 70 * k; }, Pieces.ease.out);
    await Pieces.sleep(300);
  }
  atk.forEach(f => f.remove()); strip.remove();
  layer.innerHTML = ""; fast = wasFast;
  return ok;
}

/* ================= end + start ================= */
function checkEnd() {
  const alive = activeSeats().map(k => owned(k).length);
  const total = alive.findIndex(n => n === IDS.length);
  if (S.round <= S.rounds && total < 0) return;
  S.over = true; save(); sfx.whistle("full");
  const rows = activeSeats().map(k => ({ s: SEATS[k], k, pts: points(k), terr: owned(k).length, players: owned(k).reduce((a, id) => a + S.squad[id].length, 0) })).sort((a, b) => b.pts - a.pts);
  const win = isHuman(rows[0].k);
  bar("Full time");
  hint(`<b>${win ? (solo() ? "You win the World Tour." : esc(rows[0].s.name) + " wins the World Tour.") : esc(rows[0].s.name) + " wins this one."}</b>`, `<button class="pill" id="again">New game</button>`);
  const humans = rows.filter(r => isHuman(r.k));
  layer.innerHTML = `<div class="sheet"><h2>${win ? "World Tour won" : "Full time"}</h2>
    <table class="final"><thead><tr><th>Manager</th><th>Countries</th><th>Players</th><th>Bonus</th><th>Points</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${r.s.hex};margin-right:6px"></span>${esc(r.s.name)}</td><td>${r.terr}</td><td>${r.players}</td><td>${((S.bonus && S.bonus[r.k]) || 0) + (S.stadiums ? Object.values(S.stadiums).filter(id => S.owner[id] === r.k).length * RULES.stadiumPts : 0)}</td><td>${r.pts}</td></tr>`).join("")}</tbody></table>
    ${humans.map(r => `<p class="label">${solo() ? "Your game" : esc(r.s.name)}: ${st(r.k).battles} battles · ${st(r.k).right} of ${st(r.k).questions} questions right · ${st(r.k).signed} scouted · ${st(r.k).pensScored} of ${st(r.k).pens} penalties</p>`).join("")}
    <div class="row" style="flex-wrap:wrap">${humans.map(r => `<button class="pill" data-xi="${r.k}" style="background:linear-gradient(180deg,#fff7df,${r.s.hex});">${solo() ? "See my Takeover XI" : esc(r.s.short) + "'s XI"}</button>`).join("")}</div>
    <button class="quiet" id="again2">New game</button></div>`;
  $("again").onclick = $("again2").onclick = startScreen;
  layer.querySelectorAll("[data-xi]").forEach(b => b.onclick = () => showXI(+b.dataset.xi, rows.findIndex(r => r.k === +b.dataset.xi) + 1));
}
/* ================= kick-off: dice, then the deal or the draft ================= */
const PIPS = { 1: [[15, 15]], 2: [[8, 8], [22, 22]], 3: [[8, 8], [15, 15], [22, 22]], 4: [[8, 8], [22, 8], [8, 22], [22, 22]], 5: [[8, 8], [22, 8], [15, 15], [8, 22], [22, 22]], 6: [[8, 7], [22, 7], [8, 15], [22, 15], [8, 23], [22, 23]] };
const dieSVG = (n, rot = 0) => `<svg class="die" viewBox="0 0 30 30" style="transform:rotate(${rot}deg)"><rect x="1" y="1" width="28" height="28" rx="6" fill="#F8F1DD" stroke="#241B08" stroke-width="1.6"/>` +
  PIPS[n].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.9" fill="#241B08"/>`).join("") + `</svg>`;
const d6 = () => 1 + Math.floor(Math.random() * 6);
// everyone rolls two dice; the highest kicks off and the turns go round the table from there
async function diceRoll() {
  layer.innerHTML = `<div class="over kickoff"><div class="card qcard"><div class="qtier">Kick-off</div><p class="intro">Who kicks off? Everyone rolls two dice; the highest total starts and the turns go round from there.</p></div>
    <div class="dice-grid" id="diceGrid" style="--cols:${gameSize()}">${activeSeats().map(k => { const s = SEATS[k]; return `<div class="dice-card" id="dc${k}" style="--c:${s.hex};--ci:${s.ink}"><div class="dc-head"><b class="sw"></b><strong>${esc(s.name)}</strong><small>${isHuman(k) ? (solo() ? "You" : "Player") : "Computer"}</small></div>
      <div class="dc-dice" id="dd${k}">${dieSVG(1)}${dieSVG(1)}</div><div class="dc-foot" id="df${k}">${isHuman(k) ? `<button class="pill" data-roll="${k}">Roll the dice</button>` : `<span class="dc-wait">Waiting to roll</span>`}</div></div>`; }).join("")}</div>
    <p class="intro" id="diceMsg" style="text-align:center"></p><div id="diceGo" style="text-align:center"></div></div>`;
  const total = {};
  const roll = (k) => new Promise(async res => {
    const box = $("dd" + k), a = d6(), b = d6();
    $("df" + k).innerHTML = `<span class="dc-wait">Rolling…</span>`;
    if (!RM) { sfx.crowd(.5, .08, 2400); const t0 = performance.now(); while (performance.now() - t0 < 900) { box.innerHTML = dieSVG(d6(), Math.random() * 360) + dieSVG(d6(), Math.random() * 360); await sleep(70); } }
    box.innerHTML = dieSVG(a, (Math.random() - .5) * 16) + dieSVG(b, (Math.random() - .5) * 16);
    total[k] = a + b; $("df" + k).innerHTML = `<span class="dc-total">${a + b}</span>`;
    res();
  });
  let rolling = activeSeats();
  for (;;) {
    const waits = rolling.map(k => isHuman(k)
      ? new Promise(r => { const b = layer.querySelector(`[data-roll="${k}"]`); if (b) b.onclick = () => roll(k).then(r); else roll(k).then(r); })
      : sleep(500 + 350 * k).then(() => roll(k)));
    await Promise.all(waits);
    const top = Math.max(...rolling.map(k => total[k])), tied = rolling.filter(k => total[k] === top);
    if (tied.length === 1) {
      const w = tied[0];
      const seats = activeSeats(), wi = seats.indexOf(w);
      S.order = seats.map((_, i) => seats[(wi + i) % seats.length]); S.turn = -1;
      $("dc" + w).classList.add("win"); sfx.cheer();
      $("diceMsg").innerHTML = `<b>${esc(SEATS[w].name)}</b> kick${solo() && w === 0 ? "" : "s"} off. Then ${S.order.slice(1).map(k => esc(SEATS[k].name)).join(", then ")}.`;
      feed(`<b>${esc(SEATS[w].name)}</b> won the dice roll and kicks off.`);
      break;
    }
    $("diceMsg").innerHTML = `A tie on ${top} between ${tied.map(k => esc(SEATS[k].name)).join(" and ")}. Roll again!`;
    for (const k of tied) $("df" + k).innerHTML = isHuman(k) ? `<button class="pill" data-roll="${k}">Roll again</button>` : `<span class="dc-wait">Rolling again</span>`;
    rolling = tied;
    await sleep(900);
  }
  $("diceGo").innerHTML = `<button class="pill" id="go">${S.dealMode === "draft" ? "Start the draft" : "Deal the countries"}</button>`;
  await new Promise(r => $("go").onclick = r);
  closeSheet();
}
// a quick drop of a whole squad group onto its country (the deal and the draft)
function dropGroup(id, ms = 320) {
  const g = $("p-" + id); if (!g || RM) return Promise.resolve();
  const grp = g.querySelector(".pgrp");
  return Pieces.tween(ms, k => grp.setAttribute("transform", `translate(0 ${(-70 * (1 - k)).toFixed(1)})`), Pieces.ease.bounce).then(() => grp.removeAttribute("transform"));
}
function claim(id, seat) {
  S.owner[id] = seat; S.squad[id] = [];
  for (let i = 0; i < 3; i++) autoSign(id);
  paint(); return dropGroup(id);
}
// the deal: shuffled, round the table, 10 each; the last two stay unclaimed (with 3 players each)
async function dealOut() {
  const ids = shuffle(IDS), n = S.order.length, gap = RM ? 0 : 70;
  feed("The countries are dealt.");
  sfx.crowd(2.5, .12, 1600);
  for (let i = 0; i < ids.length; i++) {
    const seat = i < perManager() * n ? S.order[i % n] : null;
    claim(ids[i], seat);
    if (gap) await sleep(gap);
  }
  await sleep(400);
}
// a computer's draft pick: next to its own countries, towards a full confederation, a bit of luck
function botPick(seat) {
  const free = IDS.filter(id => S.owner[id] == null);
  const mine = owned(seat);
  const score = id => {
    const c = T[id].confed, inConf = IDS.filter(x => T[x].confed === c), have = inConf.filter(x => S.owner[x] === seat).length;
    const near = T[id].nb.filter(x => S.owner[x] === seat).length, taken = inConf.filter(x => S.owner[x] != null && S.owner[x] !== seat).length;
    return near * 3 + have * 2 - taken * 1.5 + (mine.length ? 0 : 6 / inConf.length) + Math.random() * 2;
  };
  return free.sort((a, b) => score(b) - score(a))[0];
}
// the draft: everyone picks an unclaimed country in turn until each has 10
async function runDraft() {
  S.phase = "draft"; busy = false;
  const n = S.order.length;
  S.draftI ||= 0;
  feed("The draft starts: pick a country each, in turn.");
  while (S.draftI < perManager() * n) {
    const seat = S.order[S.draftI % n];
    S.seat = seat; refresh();
    let id;
    if (isHuman(seat)) id = await new Promise(r => draftPick = r);
    else { await sleep(RM ? 0 : 380); id = botPick(seat); }
    await claim(id, seat);
    toast(`<b>${esc(SEATS[seat].name)}</b> picks ${esc(T[id].name)}.`);
    S.draftI++; save();
  }
  for (const id of IDS) if (S.owner[id] == null) claim(id, null);   // what's left stays unclaimed, with a small squad
  delete S.draftI;
}
// each manager's home stadium: the country of theirs with the deepest football history (most players in the data)
function pickStadiums() {
  S.stadiums = {}; S.bonus = {};
  for (const k of S.order) { const mine = owned(k); if (!mine.length) continue;
    S.stadiums[k] = mine.slice().sort((a, b) => GAME[b].p.length - GAME[a].p.length || Math.random() - .5)[0]; }
}
async function showStadiums() {
  paint();
  for (const k of S.order) if (S.stadiums[k]) feed(`<b>${esc(SEATS[k].name)}</b> play${solo() && k === 0 ? "" : "s"} at home in <b>${esc(T[S.stadiums[k]].name)}</b>.`);
  const mine = S.order.filter(isHuman).map(k => S.stadiums[k]).filter(Boolean);
  if (mine.length) { await flyTo(mine, 700); }
  await banner("Home stadiums", S.order.map(k => `${SEATS[k].short} · ${T[S.stadiums[k]] ? T[S.stadiums[k]].name : "–"}`).join("  ·  "));
}
// match of the month: a country on a front line (owned, next to a rival) worth bonus points to whoever holds it at the end of the month
function newMotm() {
  const front = IDS.filter(id => S.owner[id] != null && T[id].nb.some(n => S.owner[n] != null && S.owner[n] !== S.owner[id]) && !isStadium(id));
  const pool = front.length ? front : IDS.filter(id => S.owner[id] != null);
  S.motm = pick(pool);
  feed(`<b>Match of the month:</b> ${esc(T[S.motm].name)}. Hold it at the end of ${esc(monthOf())} for +${RULES.motmPts} points.`);
  paint();
}
function awardMotm() {
  if (!S.motm) return;
  S.bonus ||= {};
  const k = S.owner[S.motm];
  if (k != null) { S.bonus[k] = (S.bonus[k] || 0) + RULES.motmPts; feed(`<b>${esc(SEATS[k].name)}</b> held ${esc(T[S.motm].name)} in ${esc(monthOf())}: +${RULES.motmPts} points.`); floatText(S.motm, "+" + RULES.motmPts + " pts", "gain"); }
  else feed(`Nobody held ${esc(T[S.motm].name)} in ${esc(monthOf())}.`);
}
async function kickOff(cfg) {
  const names = Array.from({ length: cfg.humans }, (_, k) => (cfg.names[k] || "").trim() || `Player ${k + 1}`);
  newGame(cfg.rounds, cfg.scoutMode, Math.min(cfg.humans, cfg.managers || 4), names, cfg.managers || 4); S.pens = cfg.pens; S.dealMode = cfg.deal; S.level = cfg.level || "medium";
  closeSheet(); vb = homeView(); applyView(); paint(); busy = true;
  await diceRoll();
  if (S.dealMode === "draft") await runDraft(); else await dealOut();
  pickStadiums();
  S.phase = "scout"; save(); paint();
  await showStadiums();
  newMotm();
  busy = true; sfx.whistle("long");
  await banner("Kick off", `${monthOf()} · transfer window open`);
  feed(`<b>${esc(monthOf())}</b>: the transfer window is open.`);
  await advance();
}

// the share card: the eleven best players this person signed, plus who is still in their squads
async function showXI(seat, place) {
  const s = st(seat), names = new Set(s.signedNames);
  for (const id of owned(seat)) for (const n of S.squad[id]) names.add(n);
  const pool = [...names].filter(n => n in FAME).map(n => ({ n, f: FAME[n], pos: POS[n] || "M" }));
  const rare = s.signedNames.filter(n => n in FAME).sort((a, b) => FAME[a] - FAME[b])[0];
  const ord = ["", "Champions", "2nd place", "3rd place", "4th place"][place] || "";
  const who = solo() ? "MY" : SEATS[seat].name.toUpperCase() + "'S";
  layer.innerHTML = `<div class="over"><p class="intro" style="text-align:center">Drawing the card…</p></div>`;
  const url = await XICard.draw({ xi: XICard.pick(pool), title: `${who} TAKEOVER XI`, season: `Season 2026/27 · World Tour · ${ord}`, kit: SEATS[seat].hex, ink: SEATS[seat].ink,
    awards: [["Golden Boot", `${s.ko} knock-out${s.ko === 1 ? "" : "s"}`], ["Scout of the season", rare ? `${rare} (deepest cut)` : "No signings yet"], ["Biggest win", s.best || "Still to come"]],
    lines: [`${owned(seat).length} countries · ${s.derbies} derb${s.derbies === 1 ? "y" : "ies"} won · ${s.right} of ${s.questions} questions right`] });
  const xi = XICard.pick(pool), line = k => (xi[k] || []).map(p => p.n).join(", ");
  const text = `${who === "MY" ? "My" : SEATS[seat].name + "'s"} Takeover XI (${ord}): ${line("gk")}; ${line("df")}; ${line("mf")}; ${line("fw")}. Can you take over the world?`;
  layer.innerHTML = `<div class="over"><img class="xiimg" src="${url}" alt="${esc(text)}">
    <p class="intro" style="text-align:center">Press and hold the picture to save or share it.</p>
    <div class="row" style="justify-content:center"><button class="pill" id="copyXI">Copy as text</button><button class="quiet" id="backFT">Back to full time</button></div></div>`;
  $("copyXI").onclick = () => navigator.clipboard.writeText(text).then(() => $("copyXI").textContent = "Copied", () => toast("Copy didn't work here. Press and hold the picture instead."));
  $("backFT").onclick = () => { S.over = false; checkEnd(); };
}
function startScreen() {
  store.del("tk-map-game"); S = null; sel = null; busy = false;
  const cfg = Object.assign({ rounds: 10, scoutMode: "type", humans: 1, names: ["", "", "", ""], pens: true, deal: "deal", managers: 4 }, store.get("tk-map-cfg", {}));
  cfg.humans = Math.min(cfg.humans, cfg.managers);
  const comps = cfg.managers - cfg.humans, plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  const who = cfg.managers === 2 ? (cfg.humans === 1 ? "1 v 1 · you against a computer" : "1 v 1 · two players on one device")
    : cfg.humans === 1 ? `you vs ${plural(comps, "computer manager")}` : `${cfg.humans} players${comps ? " + " + plural(comps, "computer") : ""}`;
  if ($("feed")) $("feed").innerHTML = "";
  for (let k = 0; k < SEATS.length; k++) { SEATS[k].name = BOT_NAMES[k]; SEATS[k].short = BOT_SHORT[k]; }
  bar("World Tour");
  hint(isDesk() ? "<b>New season.</b> Scroll to zoom, drag to pan." : "<b>New season.</b> Pinch or scroll to zoom, drag to pan.");
  drawManagers();
  $("score").innerHTML = "";
  for (const t of WORLD.territories) for (const el of [$("t-" + t.id), $("h-" + t.id)]) if (el) { el.style.fill = NEUTRAL.hex; el.style.fillOpacity = .7; }
  drawBadges(); GV.paint();
  layer.innerHTML = `<div class="over">
    <div class="card qcard"><div class="qtier">World Tour · ${who}</div>
      <p class="intro">Take over the football world. Your armies are real players, and you sign them by naming them.</p></div>
    <ol class="rules">
      <li><b>Transfer window.</b> Tap one of your countries and name as many of its players as you can. Your time is 15 seconds + ½ per country you own + bonuses for full confederations.</li>
      <li><b>Attack</b> a neighbour, up to twice a turn. Questions are about the country you attack. A right answer knocks out a third of your squad's size in defenders, a wrong one costs you players. A country falls on your second right answer at the earliest.</li>
      <li><b>Move</b> players up to ${RULES.movesPerTurn} times a turn between two of your countries that border each other, and choose how many go.</li>
      <li>Colours: <b>you are gold</b> (with friends: gold, blue, claret, teal in that order); the computers take the colours that are left. The numbers are squad sizes.</li>
      <li><b>The deciding penalty:</b> the blow that would take a country is a penalty. Pick a corner; if the keeper saves it, one defender stays and the battle goes on.</li>
      <li><b>Last stand:</b> once a round, when a computer is about to take one of your countries, you get one question to save it.</li>
      <li><b>Home stadiums</b> (badge in your colour): harder to attack, worth ${RULES.stadiumPts} points to whoever holds them. The gold <b>star</b> is the match of the month: hold it at the end of the month for +${RULES.motmPts}. Fall ${RULES.underdogGap} points behind and you get +${RULES.underdogSecs} seconds of scouting.</li>
      <li>After the last round the most <b>points</b> wins: 1 per country, a bonus per full confederation, 1 per 5 players, plus stadiums and stars.</li>
    </ol>
    <div><p class="label">Rounds</p><div class="row">${[6, 10, 15].map(r => `<button class="chip" data-r="${r}" aria-pressed="${r === cfg.rounds}">${r}</button>`).join("")}</div></div>
    <div><p class="label">Game size</p><div class="row">${[[2, "1 v 1"], [3, "3 managers"], [4, "4 managers"]].map(([n, l]) => `<button class="chip" data-n="${n}" aria-pressed="${n === cfg.managers}">${l}</button>`).join("")}</div></div>
    <div><p class="label">Players on this ${isDesk() ? "computer" : "phone"}</p><div class="row">${[1, 2, 3, 4].filter(h => h <= cfg.managers).map(h => `<button class="chip" data-h="${h}" aria-pressed="${h === cfg.humans}">${h === 1 ? "Just me" : h}</button>`).join("")}</div>
      <p class="label" style="text-transform:none;letter-spacing:0;font-family:var(--body);font-size:.85rem;margin-top:6px">Pass and play: each person gets a colour and you ${isDesk() ? "take turns at the computer" : "pass the phone between turns"}. Computers fill the empty seats.</p>
      <div class="names-in" id="namesIn"></div></div>
    ${comps ? `<div><p class="label">Computer level</p><div class="row">${["easy", "medium", "hard"].map(l => `<button class="chip" data-l="${l}" aria-pressed="${l === (cfg.level || "medium")}">${l[0].toUpperCase() + l.slice(1)}</button>`).join("")}</div></div>` : ""}
    <div><p class="label">The countries</p><div class="row"><button class="chip" data-d="deal" aria-pressed="${cfg.deal === "deal"}">Deal them out</button><button class="chip" data-d="draft" aria-pressed="${cfg.deal === "draft"}">Draft: pick in turn</button></div></div>
    <div><p class="label">Deciding penalty</p><div class="row"><button class="chip" data-p="1" aria-pressed="${cfg.pens}">On</button><button class="chip" data-p="0" aria-pressed="${!cfg.pens}">Off</button></div></div>
    <div><p class="label">Scouting</p><div class="row"><button class="chip" data-m="type" aria-pressed="${cfg.scoutMode === "type"}">Type names</button><button class="chip" data-m="tap" aria-pressed="${cfg.scoutMode === "tap"}">Easy: tap them</button></div></div>
    <button class="pill" id="start">Kick off</button>
    <button class="quiet" id="rulesLink">Read the full rulebook</button></div>`;
  $("rulesLink").onclick = openRules;
  layer.querySelectorAll("[data-r]").forEach(b => b.onclick = () => { cfg.rounds = +b.dataset.r; store.set("tk-map-cfg", cfg); layer.querySelectorAll("[data-r]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  layer.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { cfg.scoutMode = b.dataset.m; store.set("tk-map-cfg", cfg); layer.querySelectorAll("[data-m]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  const COLOURS = ["gold", "blue", "claret", "teal"];
  const drawNames = () => { $("namesIn").innerHTML = cfg.humans < 2 ? "" : Array.from({ length: cfg.humans }, (_, k) => `<label><b style="background:${SEATS[k].hex}"></b><input id="nm${k}" maxlength="14" placeholder="Player ${k + 1} (${COLOURS[k]})" value="${esc(cfg.names[k] || "")}"></label>`).join("");
    for (let k = 0; k < cfg.humans; k++) { const i = $("nm" + k); if (i) i.oninput = () => { cfg.names[k] = i.value.trim(); store.set("tk-map-cfg", cfg); }; } };
  drawNames();
  // the size and the players change the subtitle and the choices: redraw the screen
  layer.querySelectorAll("[data-h]").forEach(b => b.onclick = () => { cfg.humans = +b.dataset.h; store.set("tk-map-cfg", cfg); startScreen(); });
  layer.querySelectorAll("[data-n]").forEach(b => b.onclick = () => { cfg.managers = +b.dataset.n; cfg.humans = Math.min(cfg.humans, cfg.managers); store.set("tk-map-cfg", cfg); startScreen(); });
  layer.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { cfg.pens = b.dataset.p === "1"; store.set("tk-map-cfg", cfg); layer.querySelectorAll("[data-p]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  layer.querySelectorAll("[data-d]").forEach(b => b.onclick = () => { cfg.deal = b.dataset.d; store.set("tk-map-cfg", cfg); layer.querySelectorAll("[data-d]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  layer.querySelectorAll("[data-l]").forEach(b => b.onclick = () => { cfg.level = b.dataset.l; store.set("tk-map-cfg", cfg); layer.querySelectorAll("[data-l]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  $("start").onclick = () => kickOff(cfg);
}

/* ================= rulebook ================= */
// every number comes from RULES, so the book stays right when the balance changes
function openRules() {
  if ($("rulebook")) return;
  const confs = Object.keys(RULES.confedSecs).sort((a, b) => RULES.confedSecs[b] - RULES.confedSecs[a]);
  const count = c => IDS.filter(id => T[id].confed === c).length;
  const el = document.createElement("div");
  el.className = "rulebook"; el.id = "rulebook"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Rulebook");
  el.innerHTML = `<div class="rb">
    <div class="rbhead"><h2>The rulebook</h2><button class="pill" id="rbClose">Back to the game</button></div>

    <section><h3>The aim</h3>
      <p>Take over the football world. Your armies are real footballers, and you sign them by naming them. After the last round the manager with the most points wins. Take every country and you win straight away.</p></section>

    <section><h3>The map <span>${IDS.length} countries</span></h3>
      <p>The world is split into ${IDS.length} countries in ${CONFEDS.length} confederations, just like real football. Smaller nations are grouped with a neighbour: a Togolese player counts for Ghana, a Finn for the Nordics.</p>
      <p>You can attack a country that shares a border with yours, or one joined to yours by a dashed sea route (England to France, Spain to Morocco, Russia to the USA…).</p>
      <p>Each squad is shown as little footballers wearing the shirts of players you signed. The colour of the base is the manager, the number under them is how many players stand there. One piece means 1–4 players, two pieces 5–9, three pieces 10 or more. The captain wears the armband.</p>
      <p>Tap <b>Globe</b> next to Sound to play on a spinnable globe instead of the flat map (and <b>Map</b> to switch back). Your game carries on either way.</p>
      <table><thead><tr><th>Manager</th><th>Plays</th></tr></thead><tbody>
        ${(S ? activeSeats() : SEATS.map((_, k) => k)).map(k => { const s = SEATS[k]; return `<tr><td><span class="sw" style="background:${s.hex}"></span>${esc(s.name)}</td><td>${isHuman(k) ? (solo() ? "That's you" : "Player") : "Computer"}</td></tr>`; }).join("")}
        <tr><td><span class="sw" style="background:${NEUTRAL.hex}"></span>Unclaimed</td><td>Nobody, free to take</td></tr></tbody></table></section>

    <section><h3>Game size</h3>
      <p>Play a <b>1 v 1</b> (you against a computer, or two people on one device), or with <b>3 or 4 managers</b>. The computers fill the seats that no person takes. <b>New game</b> at the top starts over at any moment between moves.</p></section>

    <section><h3>Home stadiums</h3>
      <p>After the countries are handed out, every manager gets a <b>home stadium</b>: the country of theirs with the biggest football history (it has a little stadium badge in their colour). Questions there are one level harder, and a stadium is worth <b>${RULES.stadiumPts} points</b> to whoever holds it, so taking your rival's is the big swing of a season. Lose yours and win it back!</p></section>

    <section><h3>Match of the month</h3>
      <p>Every month one country on a front line gets a <b>gold star</b>. Whoever holds it at the end of the month gets <b>+${RULES.motmPts} points</b>. A new one is picked each month.</p></section>

    <section><h3>Underdog and computer level</h3>
      <p>A manager who is ${RULES.underdogGap} or more points behind the leader is the <b>underdog</b> and gets <b>+${RULES.underdogSecs} seconds</b> of scouting each turn. Computers come in three levels on the start screen: Easy (slower scouting, more wrong answers), Medium and Hard.</p></section>

    <section><h3>Kick-off</h3>
      <p>Everyone rolls two dice. The highest total kicks off and the turns go round the table from there (ties roll again). Then the countries are handed out: <b>dealt</b> at random, or <b>drafted</b>, where everyone picks an unclaimed country in turn. With four managers that's 10 each (two stay unclaimed), with three 14 each, and in a 1 v 1 21 each. The countries nobody gets stay unclaimed with a small squad. Every country starts with 3 players.</p></section>

    <section><h3>Your turn <span>three steps</span></h3>
      <p>Every turn has the same order: <b>scout</b>, then <b>attack</b>, then <b>end turn</b>. Moving players can happen any time during the attack step.</p></section>

    <section><h3>1 · The transfer window</h3>
      <p>Tap one of your countries and name as many of its players as you can before the clock runs out. Every correct name joins your squad there.</p>
      <ul>
        <li>Your time is <b>${RULES.baseSecs} seconds</b>, plus <b>${RULES.perTerr === 0.5 ? "½" : RULES.perTerr} second</b> for every country you own, plus a bonus for every confederation you hold completely (see the table). Never more than ${RULES.maxSecs} seconds.</li>
        <li>Only a player's <b>main football nationality</b> counts. Messi signs for Argentina, not Spain.</li>
        <li>A surname is enough when it's clear within that country ("Osimhen", "van Persie"). If several players share it, add a first name. Small typos in long names are forgiven when you press Sign.</li>
        <li>Every player can be signed <b>once per game, by anyone</b>. If a computer manager already has Salah, he's gone.</li>
        <li>A squad holds at most <b>${RULES.squadCap} players</b>.</li>
        <li>In <b>August and January</b> the transfer window is open and your scouting time is <b>doubled</b> (so is the 60-second cap). The computers get the same.</li>
        <li><b>Easy scouting</b>: instead of typing, tap the real players among nine names. A wrong tap costs 2 seconds.</li>
      </ul>
      <table><thead><tr><th>Hold all of</th><th class="n">Countries</th><th class="n">Extra time</th><th class="n">Points</th></tr></thead><tbody>
        ${confs.map(c => `<tr><td>${c}</td><td class="n">${count(c)}</td><td class="n">+${RULES.confedSecs[c]} s</td><td class="n">+${RULES.confedPts[c]}</td></tr>`).join("")}</tbody></table></section>

    <section><h3>2 · Attack <span>up to ${RULES.attacksPerTurn} a turn</span></h3>
      <p>Tap one of your countries with at least 2 players, then a neighbour with a white dashed edge. Everyone goes except one player, who stays home.</p>
      <p>The battle is a run of questions <b>about the country you attack</b>, with ${RULES.questionSecs} seconds each.</p>
      <ul>
        <li><b>Right answer:</b> the defenders lose a third of your squad's size, rounded up.</li>
        <li><b>Wrong answer or time-out:</b> you lose a third of the defenders' size, rounded up.</li>
        <li>A country can't fall on the first right answer. It falls on your <b>second right answer at the earliest</b>.</li>
        <li>The questions get harder as the defence gets bigger: 1–3 defenders easy, 4–8 medium, 9 or more hard.</li>
        <li>You can <b>pull back</b> after any question. Your players go home.</li>
        <li>Win the battle and everyone who survived moves into the country.</li>
      </ul>
      <div class="example"><p><b>Example.</b> You attack with 7 against 3. First right answer: 7 ÷ 3 = 3 knocked out, but a country never falls on the first right answer, so 1 defender stays. You answer wrong: 1 ÷ 3 rounds up to 1, so you lose one player (6 left). Second right answer: the last defender goes and the country is yours. All 6 move in.</p></div></section>

    <section><h3>3 · Move players <span>up to ${RULES.movesPerTurn} times a turn</span></h3>
      <p>Tap one of your countries, then a neighbouring country you also own, and choose how many players go (at least one always stays). The captain stays at home, the best of the others go first. You can do it before or after your attacks, until you end your turn. A squad holds at most 30 players.</p></section>

    <section><h3>The season <span>rounds are months</span></h3>
      <p>A game is a football season. A 10-round game runs from August to May, a 6-round game skips some months, and a 15-round game runs into a second season. August and January are transfer windows with double scouting time. The last round is the final day of the season.</p></section>

    <section><h3>Captains and home-grown players</h3>
      <p>The most famous player in each squad is its <b>captain</b>, shown first on the team sheet with (C). The captain is always the last player to be knocked out.</p>
      <p>Players who are from the country they stand in are <b>home-grown</b> and get a small gold flag on the team sheet. If a squad's captain is home-grown, the squad has a <b>home crowd</b> (tap a country: a gold <b>C</b> appears on its shirt and its neighbours'): the first question of any attack there is one level harder. When you take a country, your players are visitors, so scout home-grown players there to win the crowd back.</p></section>

    <section><h3>Derbies</h3>
      <p>Some neighbours are old rivals: ${DERBIES.slice(0, 6).map(d => `${esc(T[d[0]].name)} v ${esc(T[d[1]].name)}`).join(", ")} and ${DERBIES.length - 6} more. A derby gets its own banner, a louder crowd, and <b>every question is one level harder</b> for whoever attacks.</p></section>

    <section><h3>Computer turns</h3>
      <p>After you end your turn, the three computer managers play one after the other. They scout, then attack up to ${RULES.attacksPerTurn} times, usually when they have half as many players again as the defenders. Tap <b>Skip replay</b> to see the result straight away.</p></section>

    <section><h3>The deciding penalty</h3>
      <p>When your answer would take a country, you take a penalty instead: tap a corner of the goal. Score and the country is yours; if the keeper saves it, one defender stays on and the battle goes on. A computer keeper guesses right more often against harder defences and in derbies (about 1 in 5 on easy, 1 in 3 on hard). When the keeper is a person, they pick the dive themselves: the device goes over without showing the shot. And when a computer is about to take one of your countries, you're in goal: pick where your keeper dives, guess their corner and the country holds with one player. You can switch penalties off on the start screen.</p></section>

    <section><h3>Playing with friends</h3>
      <p>Choose 2 to 4 players on the start screen and type your names. Everyone gets a colour (gold, blue, claret, teal) and you pass the phone between turns; a "Pass the phone" screen shows what happened to that player since their last turn. Computer managers fill the empty seats and play after the last person. Every person gets their own Last stand each round.</p></section>

    <section><h3>Your Takeover XI</h3>
      <p>At full time every person gets a share card: the eleven most famous players they signed in a 4-3-3, their Golden Boot (knock-outs), Scout of the season (their least famous signing) and their biggest win. Press and hold it to save or share it.</p></section>

    <section><h3>Last stand <span>${RULES.lastStandsPerRound} per round</span></h3>
      <p>When a computer is about to take one of your countries, you get one question about that country. Answer it right and the attack fails: one player is left standing and the attackers go home. Answer wrong and the country falls.</p></section>

    <section><h3>Sacked</h3>
      <p>A manager who loses every country gets sacked, then gets a new job: an unclaimed country (or the weakest one on the map) with 3 players. Nobody is ever out of the game.</p></section>

    <section><h3>Full time <span>points</span></h3>
      <table><tbody>
        <tr><td>Every country you own</td><td class="n">1 point</td></tr>
        <tr><td>A confederation you hold completely</td><td class="n">see the table above</td></tr>
        <tr><td>Every 5 players in your squads</td><td class="n">1 point</td></tr>
        <tr><td>A home stadium you hold (yours or a rival's)</td><td class="n">${RULES.stadiumPts} points</td></tr>
        <tr><td>Holding the match of the month at the end of a month</td><td class="n">+${RULES.motmPts} points</td></tr></tbody></table>
      <p style="margin-top:8px">The points on the coloured chips at the top of the screen are the live score.</p></section>

    <section><h3>On a computer</h3>
      <p>The managers and a running report of the season sit on the right. Hover over a country to see its squad and captain. Keys: <b>Enter</b> ends your turn, <b>Esc</b> closes a card, <b>+</b> and <b>−</b> zoom, <b>W</b> shows the world, <b>E</b> Europe, <b>G</b> switches to the globe.</p></section>

    <section><h3>Sound</h3>
      <p>Whistles, crowd and the roar of a takeover are made by your browser. Tap <b>Sound</b> on the map to mute them.</p></section>

    <section><h3>Tips</h3>
      <ul>
        <li>Scout in a country you know well, then move those players to the front line.</li>
        <li>Big squads hit harder, so attack with a lot and leave weak countries alone.</li>
        <li>A full confederation gives extra scouting time every turn. Small ones (CONMEBOL, CONCACAF) are the easiest to hold.</li>
        <li>Players who are less famous are worth exactly as much, and they're less likely to be taken already.</li>
      </ul></section>

    <button class="pill" id="rbClose2">Back to the game</button>
  </div>`;
  $("mapwrap").appendChild(el);
  const close = () => { el.remove(); $("rulesBtn").focus(); };
  $("rbClose").onclick = close; $("rbClose2").onclick = close;
  el.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  $("rbClose").focus();
}
$("rulesBtn").onclick = openRules;
// a new game at any time (between moves), with an in-page check so a season isn't lost by accident
function askNewGame() {
  if (!S) return;
  const nb = $("newBtn");
  if (busy) { feed("Finish this move first, then you can start a new game."); toast("Finish this move first, then you can start a new game."); nb.textContent = "After this move"; setTimeout(() => nb.textContent = "New game", 1800); return; }
  if ($("confirmNew")) return;
  const el = document.createElement("div"); el.className = "confirm"; el.id = "confirmNew"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Start a new game");
  el.innerHTML = `<div class="confirm-card"><h2>Start a new game?</h2>
    <p>${S.over ? "This season is over." : `This season (${esc(monthOf())}, round ${Math.min(S.round, S.rounds)} of ${S.rounds}) will be lost.`} You'll go back to the start screen to pick the game size and players.</p>
    <div class="row"><button class="pill" id="ngYes">Start a new game</button><button class="quiet" id="ngNo">Keep playing</button></div></div>`;
  $("mapwrap").appendChild(el);
  const close = () => el.remove();
  $("ngNo").onclick = close; $("ngYes").focus();
  el.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  $("ngYes").onclick = () => {
    close(); document.querySelectorAll(".pass, #rulebook").forEach(x => x.remove());
    draftPick = null; fast = false; sel = null; startScreen();
  };
}
$("newBtn").onclick = askNewGame;
const sndBtn = $("snd");
sndBtn.setAttribute("aria-pressed", sfx.on); sndBtn.textContent = sfx.on ? "Sound" : "Muted";
sndBtn.onclick = () => { const on = sfx.toggle(); sndBtn.setAttribute("aria-pressed", on); sndBtn.textContent = on ? "Sound" : "Muted"; };

Pieces.setKits(KITS);
Pieces.setSkip(() => fast || RM);
Pieces.setPaused(() => GV.on);   // the flat map is hidden while the globe is on: no idle animation there
buildMap(); vb = homeView(); applyView();
// flat map or globe: a per-device preference; switching never touches the game state
const viewBtn = $("viewBtn");
const viewPref = { get() { try { return localStorage.getItem("tk-view") || "map"; } catch (e) { return "map"; } }, set(v) { try { localStorage.setItem("tk-view", v); } catch (e) {} } };
async function setView(v, remember = true) {
  if (v === "globe") {
    viewBtn.disabled = true; viewBtn.textContent = "Loading";
    try { await GV.start(); GV.show(); }
    catch (e) { GV.hide(); v = "map"; toast("<b>The globe couldn't start here</b>, so you're on the flat map."); remember = false; }
    viewBtn.disabled = false;
  } else GV.hide();
  if (remember) viewPref.set(v);
  viewBtn.textContent = v === "globe" ? "Map" : "Globe";
  viewBtn.setAttribute("aria-pressed", String(v === "globe"));
}
viewBtn.onclick = () => { if (busy) { toast("Switch views after this move."); return; } setView(GV.on ? "map" : "globe"); };
const saved = store.get("tk-map-game", null);
if (saved && !saved.over && saved.phase === "draft") { S = saved; upgradeSave(); applyNames(); paint(); runDraft().then(() => { S.phase = "scout"; save(); return advance(); }); }
else if (saved && !saved.over && saved.phase !== "setup" && saved.seat < (saved.humans || 1)) { S = saved; upgradeSave(); applyNames(); refresh(); toast(`<b>Welcome back.</b> Round ${S.round} of ${S.rounds}.`); if (!solo()) startTurn(S.seat); }
else startScreen();
if (viewPref.get() === "globe") setView("globe", false);
