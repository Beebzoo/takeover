/* ======================= TAKEOVER: YOUR XI, THE SHARE CARD =======================
   At full time: the eleven best players you signed this season in a 4-3-3, on a
   pitch, in your colours, with the awards underneath. Drawn on a canvas so it can
   be saved as an image (press and hold) and shared.

   XICard.pick(pool) -> { gk:[..1], df:[..4], mf:[..3], fw:[..3] } from [{ n, f, pos }]
   XICard.draw({ xi, title, season, kit, ink, lines:[...], awards:[[label, value]...] }) -> Promise<dataURL> */
const XICard = (() => {
  // best by fame per line; empty slots are filled with the best of the rest, out of position
  function pick(pool) {
    const seen = new Set(), all = pool.filter(p => p && p.n && !seen.has(p.n) && seen.add(p.n)).sort((a, b) => b.f - a.f);
    const used = new Set(), take = (pos, k) => { const out = []; for (const p of all) { if (out.length === k) break; if (p.pos === pos && !used.has(p.n)) { out.push(p); used.add(p.n); } } return out; };
    const xi = { gk: take("G", 1), df: take("D", 4), mf: take("M", 3), fw: take("F", 3) };
    const need = { gk: 1, df: 4, mf: 3, fw: 3 };
    for (const line of ["fw", "mf", "df", "gk"]) while (xi[line].length < need[line]) {
      const p = all.find(q => !used.has(q.n)); if (!p) break; used.add(p.n); xi[line].push(Object.assign({}, p, { off: true }));
    }
    return xi;
  }

  const W = 1080, H = 1350;
  const SHIRT = "M-7,-9 L-3,-11 Q0,-7.5 3,-11 L7,-9 L12.5,-4 L8.5,0.5 L7,-1 L7,10 Q0,11.5 -7,10 L-7,-1 L-8.5,0.5 L-12.5,-4 Z";
  const shirtPath = new Path2D(SHIRT);
  const short = n => { const w = String(n).split(" "); if (w.length === 1 || String(n).length <= 15) return n; const last = w[w.length - 1];
    const parts = w.slice(-2), pre = ["van", "de", "der", "da", "di", "dos", "del", "la", "le", "el", "von"];
    return pre.includes(parts[0].toLowerCase()) ? parts.join(" ") : last; };
  function fit(g, text, max, size, weight, style) { let s = size; do { g.font = `${style || ""} ${weight} ${s}px 'Barlow Semi Condensed', 'Arial Narrow', sans-serif`; s -= 2; } while (g.measureText(text).width > max && s > 14); }

  async function draw(o) {
    try { if (document.fonts) await Promise.all([document.fonts.load("italic 900 40px 'Barlow Semi Condensed'"), document.fonts.load("800 30px 'Barlow Semi Condensed'"), document.fonts.load("italic 400 30px Lora")]); } catch (e) {}
    const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
    // cream paper with faint stripes
    g.fillStyle = "#efe4c8"; g.fillRect(0, 0, W, H);
    g.save(); g.strokeStyle = "rgba(120,100,60,.06)"; g.lineWidth = 2; g.translate(W / 2, H / 2); g.rotate(-25 * Math.PI / 180);
    for (let x = -1400; x < 1400; x += 22) { g.beginPath(); g.moveTo(x, -1400); g.lineTo(x, 1400); g.stroke(); } g.restore();
    // the grass band with its slanted edge
    g.save(); g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, 190); g.lineTo(0, 228); g.closePath(); g.clip();
    g.fillStyle = "#123D24"; g.fillRect(0, 0, W, 240);
    for (let x = -300, i = 0; x < W + 300; x += 70, i++) { g.fillStyle = i % 2 ? "rgba(255,255,255,.035)" : "rgba(0,0,0,.06)"; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 70, 0); g.lineTo(x - 50, 240); g.lineTo(x - 120, 240); g.closePath(); g.fill(); }
    g.restore();
    g.fillStyle = "#F8F1DD"; g.font = "italic 900 92px 'Barlow Semi Condensed', 'Arial Narrow', sans-serif"; g.textBaseline = "alphabetic";
    g.shadowColor = "#7a5a10"; g.shadowOffsetY = 5; g.fillText(o.title || "MY TAKEOVER XI", 60, 120); g.shadowColor = "transparent"; g.shadowOffsetY = 0;
    // slanted gold bar
    g.save(); g.translate(60, 140); g.transform(1, 0, -.25, 1, 0, 0); g.fillStyle = "#e9b84c"; const sub = (o.season || "").toUpperCase();
    g.font = "800 30px 'Barlow Semi Condensed', sans-serif"; const sw = g.measureText(sub).width + 40; g.fillRect(0, 0, sw, 46); g.restore();
    g.fillStyle = "#241B08"; g.font = "800 30px 'Barlow Semi Condensed', sans-serif"; g.fillText(sub, 76, 174);

    // the pitch
    const px = 70, py = 270, pw = W - 140, ph = 760;
    g.save(); g.beginPath(); g.roundRect ? g.roundRect(px, py, pw, ph, 26) : g.rect(px, py, pw, ph); g.clip();
    for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? "#1a5a30" : "#1f6a38"; g.fillRect(px, py + i * ph / 10, pw, ph / 10 + 1); }
    g.strokeStyle = "rgba(255,255,255,.75)"; g.lineWidth = 4;
    g.strokeRect(px + 26, py + 26, pw - 52, ph - 52);
    g.beginPath(); g.moveTo(px + 26, py + 26); g.lineTo(px + pw - 26, py + 26); g.stroke();
    g.beginPath(); g.arc(px + pw / 2, py + 26, 90, 0, Math.PI); g.stroke();                         // centre circle, half
    g.strokeRect(px + pw / 2 - 210, py + ph - 26 - 150, 420, 150);                                  // box
    g.strokeRect(px + pw / 2 - 95, py + ph - 26 - 55, 190, 55);                                     // six-yard
    g.beginPath(); g.arc(px + pw / 2, py + ph - 26 - 150, 70, Math.PI, 0); g.stroke();
    g.restore();
    g.strokeStyle = "#fff"; g.lineWidth = 6; g.beginPath(); g.roundRect ? g.roundRect(px, py, pw, ph, 26) : g.rect(px, py, pw, ph); g.stroke();

    // eleven shirts: forwards at the top, keeper at the bottom
    const rows = [["fw", .15], ["mf", .41], ["df", .66], ["gk", .89]];
    let num = { gk: [1], df: [2, 4, 5, 3], mf: [8, 6, 10], fw: [7, 9, 11] };
    for (const [line, fy] of rows) {
      const ps = o.xi[line] || [], n = ps.length;
      ps.forEach((p, i) => {
        const x = px + pw * (n === 1 ? .5 : .14 + .72 * i / (n - 1)), y = py + ph * fy;
        g.save(); g.translate(x, y); g.scale(4.4, 4.4);
        g.fillStyle = line === "gk" ? "#c8e637" : o.kit; g.fill(shirtPath); g.lineWidth = 1.1; g.strokeStyle = "#fff"; g.stroke(shirtPath); g.restore();
        g.fillStyle = line === "gk" ? "#111" : (o.ink || "#241B08"); g.font = "italic 900 44px 'Barlow Semi Condensed', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(num[line][i] || "", x, y + 6);
        const label = short(p.n); fit(g, label, 220, 34, 800); g.textBaseline = "top";
        const tw = g.measureText(label).width + 22;
        g.fillStyle = "rgba(11,36,22,.88)"; g.beginPath(); g.roundRect ? g.roundRect(x - tw / 2, y + 56, tw, 44, 10) : g.rect(x - tw / 2, y + 56, tw, 44); g.fill();
        g.fillStyle = p.off ? "#cfe0d4" : "#F8F1DD"; g.fillText(label, x, y + 62);
        g.textAlign = "left";
      });
    }

    // the awards and the season line
    let y = py + ph + 50;
    g.textBaseline = "alphabetic";
    for (const [label, value] of (o.awards || []).slice(0, 3)) {
      g.fillStyle = "#6b6a55"; g.font = "800 26px 'Barlow Semi Condensed', sans-serif"; g.fillText(label.toUpperCase(), 70, y);
      g.fillStyle = "#1d2a20"; fit(g, value, 640, 38, 900, "italic"); g.textAlign = "right"; g.fillText(value, W - 70, y + 2); g.textAlign = "left";
      g.strokeStyle = "rgba(60,50,20,.22)"; g.setLineDash([6, 6]); g.lineWidth = 2; g.beginPath(); g.moveTo(70, y + 18); g.lineTo(W - 70, y + 18); g.stroke(); g.setLineDash([]);
      y += 62;
    }
    g.fillStyle = "#1d2a20"; g.font = "italic 400 30px Lora, Georgia, serif";
    for (const line of (o.lines || []).slice(0, 2)) { g.fillText(line, 70, y + 10); y += 44; }
    // footer
    g.fillStyle = "#123D24"; g.fillRect(0, H - 70, W, 70);
    g.fillStyle = "#f3cd6b"; g.font = "italic 900 34px 'Barlow Semi Condensed', sans-serif"; g.fillText("BALL · TAKEOVER", 60, H - 24);
    g.fillStyle = "#8FB79E"; g.font = "800 22px 'Barlow Semi Condensed', sans-serif"; g.textAlign = "right"; g.fillText("CAN YOU TAKE OVER THE WORLD?", W - 60, H - 28); g.textAlign = "left";
    return c.toDataURL("image/png");
  }
  return { pick, draw };
})();
