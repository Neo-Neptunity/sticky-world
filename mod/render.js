// ワールドを描く（見下ろしの 2.5D）。地面と床は一度だけ別の絵に描いておき、毎回はそれを写して、上に木・人・付箋を奥から順に重ねる。
import { WORLD } from "./store.js";
import { ZONES, BOARD, NOTICE, FOUNTAIN, NOTE_W, NOTE_H, SHELF_ROWS, READING } from "./world.js";

const GROUND_SCALE = 0.75;   // 地面の絵の細かさ（ワールド 1 点あたり）。大きくすると、くっきりするが重い
const TREE_HUES = [["#3f8f4a", "#2f7a3c"], ["#4c9a3f", "#3b8230"], ["#5aa05a", "#438a45"], ["#3d8a64", "#2e7352"], ["#6aa84f", "#52913a"]];
const FLOWER = ["#ff7aa2", "#ffd166", "#ffffff", "#c58cff", "#ff9f5a"];
const FONT = '"Yu Gothic UI", "Meiryo UI", "Hiragino Sans", sans-serif';

export function createRender(canvas) {
  const ctx = canvas.getContext("2d");
  const cam = { x: WORLD.w / 2, y: WORLD.h / 2, zoom: 1 };
  let ground = null;
  let groundKey = "";
  let dpr = 1;
  let vw = 0;
  let vh = 0;
  const noteCache = new Map();
  let last = null;            // 最後に描いたもの（当たり判定に使う）

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = canvas.clientWidth;
    vh = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(vw * dpr));
    canvas.height = Math.max(1, Math.round(vh * dpr));
  }

  const toWorld = (sx, sy) => ({ x: (sx - vw / 2) / cam.zoom + cam.x, y: (sy - vh / 2) / cam.zoom + cam.y });
  const toScreen = (wx, wy) => ({ x: (wx - cam.x) * cam.zoom + vw / 2, y: (wy - cam.y) * cam.zoom + vh / 2 });

  function follow(x, y, dt) {
    const k = Math.min(1, dt * 6);
    cam.x += (x - cam.x) * k;
    cam.y += (y - cam.y) * k;
    const hw = vw / 2 / cam.zoom;
    const hh = vh / 2 / cam.zoom;
    cam.x = hw * 2 >= WORLD.w ? WORLD.w / 2 : Math.min(WORLD.w - hw, Math.max(hw, cam.x));
    cam.y = hh * 2 >= WORLD.h ? WORLD.h / 2 : Math.min(WORLD.h - hh, Math.max(hh, cam.y));
  }
  const jump = (x, y) => {
    cam.x = x;
    cam.y = y;
    follow(x, y, 1);
  };

  // ---- 地面（一度だけ描く） ----------------------------------------------------------------
  function buildGround(deco, seedKey) {
    if (ground && groundKey === seedKey) return;
    groundKey = seedKey;
    ground = document.createElement("canvas");
    ground.width = Math.round(WORLD.w * GROUND_SCALE);
    ground.height = Math.round(WORLD.h * GROUND_SCALE);
    const g = ground.getContext("2d");
    g.scale(GROUND_SCALE, GROUND_SCALE);
    // 芝生：濃淡のまだら
    g.fillStyle = "#86c56a";
    g.fillRect(0, 0, WORLD.w, WORLD.h);
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = r() < 0.5 ? "rgba(255,255,255,0.06)" : "rgba(30,90,20,0.07)";
      g.beginPath();
      g.ellipse(r() * WORLD.w, r() * WORLD.h, 20 + r() * 60, 10 + r() * 30, 0, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 1400; i++) {
      g.strokeStyle = "rgba(40,110,30,0.35)";
      g.lineWidth = 1.4;
      const x = r() * WORLD.w;
      const y = r() * WORLD.h;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - 2, y - 6);
      g.moveTo(x + 3, y);
      g.lineTo(x + 4, y - 5);
      g.stroke();
    }
    // 道：書庫 → 広場 → アトリエ、広場 → 南
    g.fillStyle = "#e6d3a3";
    roundRect(g, 760, 780, 900, 110, 40);
    g.fill();
    roundRect(g, 1140, 1060, 120, WORLD.h - 1060, 40);
    g.fill();
    g.strokeStyle = "rgba(150,120,70,0.25)";
    g.lineWidth = 3;
    roundRect(g, 760, 780, 900, 110, 40);
    g.stroke();
    // 広場：石畳
    const P = ZONES.talk;
    g.fillStyle = "#d9d4c7";
    roundRect(g, P.x, P.y, P.w, P.h, 60);
    g.fill();
    g.strokeStyle = "rgba(120,110,90,0.18)";
    g.lineWidth = 2;
    for (let y = P.y + 40; y < P.y + P.h; y += 40) {
      g.beginPath();
      g.moveTo(P.x + 20, y);
      g.lineTo(P.x + P.w - 20, y);
      g.stroke();
    }
    for (let y = P.y; y < P.y + P.h - 40; y += 40) {
      for (let x = P.x + ((y / 40) % 2 ? 30 : 10); x < P.x + P.w - 20; x += 60) {
        g.beginPath();
        g.moveTo(x, y + 8);
        g.lineTo(x, y + 40);
        g.stroke();
      }
    }
    g.strokeStyle = "#b9b2a1";
    g.lineWidth = 6;
    roundRect(g, P.x, P.y, P.w, P.h, 60);
    g.stroke();
    // アトリエ：明るい板の床
    const A = ZONES.idea;
    g.fillStyle = "#e9c99b";
    roundRect(g, A.x, A.y, A.w, A.h, 26);
    g.fill();
    g.strokeStyle = "rgba(140,90,40,0.18)";
    g.lineWidth = 2;
    for (let x = A.x + 46; x < A.x + A.w; x += 46) {
      g.beginPath();
      g.moveTo(x, A.y + 6);
      g.lineTo(x, A.y + A.h - 6);
      g.stroke();
    }
    g.strokeStyle = "#b98a55";
    g.lineWidth = 8;
    roundRect(g, A.x, A.y, A.w, A.h, 26);
    g.stroke();
    // ボード：白い大きな紙
    g.fillStyle = "rgba(0,0,0,0.12)";
    roundRect(g, BOARD.x + 8, BOARD.y + 12, BOARD.w, BOARD.h, 14);
    g.fill();
    g.fillStyle = "#fbfaf6";
    roundRect(g, BOARD.x, BOARD.y, BOARD.w, BOARD.h, 14);
    g.fill();
    g.strokeStyle = "rgba(60,80,120,0.07)";
    g.lineWidth = 1.5;
    for (let y = BOARD.y + 40; y < BOARD.y + BOARD.h; y += 40) {
      g.beginPath();
      g.moveTo(BOARD.x + 10, y);
      g.lineTo(BOARD.x + BOARD.w - 10, y);
      g.stroke();
    }
    g.strokeStyle = "#cfc8b8";
    g.lineWidth = 4;
    roundRect(g, BOARD.x, BOARD.y, BOARD.w, BOARD.h, 14);
    g.stroke();
    // 書庫：濃い板の床と、奥の壁
    const L = ZONES.shelf;
    g.fillStyle = "#b07c4f";
    roundRect(g, L.x, L.y, L.w, L.h, 20);
    g.fill();
    g.strokeStyle = "rgba(60,30,10,0.2)";
    g.lineWidth = 2;
    for (let y = L.y + 30; y < L.y + L.h; y += 30) {
      g.beginPath();
      g.moveTo(L.x + 6, y);
      g.lineTo(L.x + L.w - 6, y);
      g.stroke();
    }
    g.fillStyle = "#e8dcc6";
    g.fillRect(L.x, L.y - 70, L.w, 70);
    g.fillStyle = "#cbb894";
    g.fillRect(L.x, L.y - 10, L.w, 10);
    g.strokeStyle = "#6e4a2c";
    g.lineWidth = 8;
    roundRect(g, L.x, L.y, L.w, L.h, 20);
    g.stroke();
    // 読書の場所のじゅうたん
    g.fillStyle = "#8d3b3b";
    roundRect(g, READING.x, READING.y, READING.w, READING.h, 14);
    g.fill();
    g.strokeStyle = "#e0b45c";
    g.lineWidth = 4;
    roundRect(g, READING.x + 10, READING.y + 10, READING.w - 20, READING.h - 20, 10);
    g.stroke();
    // 書庫の奥の壁の窓
    for (let x = L.x + 60; x < L.x + L.w - 60; x += 150) {
      g.fillStyle = "#9fd3f0";
      g.fillRect(x, L.y - 58, 70, 40);
      g.strokeStyle = "#8a6a45";
      g.lineWidth = 4;
      g.strokeRect(x, L.y - 58, 70, 40);
      g.beginPath();
      g.moveTo(x + 35, L.y - 58);
      g.lineTo(x + 35, L.y - 18);
      g.stroke();
    }
    // 花壇の土
    for (const d of deco) {
      if (d.kind !== "flowers") continue;
      g.fillStyle = "#7a5634";
      g.beginPath();
      g.ellipse(d.x, d.y, 30 * d.size, 16 * d.size, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // ---- 付箋の絵（中身が変わったときだけ描き直す） ----------------------------------------------------------------
  function noteImage(n, who, reacts) {
    const key = `${n.text}|${n.tint}|${who?.name}|${who?.color}|${reacts}`;
    const hit = noteCache.get(n.id);
    if (hit && hit.key === key) return hit.img;
    const S = 2;
    const c = document.createElement("canvas");
    c.width = NOTE_W * S;
    c.height = NOTE_H * S;
    const g = c.getContext("2d");
    g.scale(S, S);
    g.fillStyle = n.tint || "#fff1a8";
    g.fillRect(0, 0, NOTE_W, NOTE_H);
    g.fillStyle = "rgba(0,0,0,0.06)";
    g.fillRect(0, 0, NOTE_W, 12);
    g.fillStyle = "#3a3326";
    g.font = `600 13px ${FONT}`;
    g.textBaseline = "top";
    const lines = wrap(g, n.text, NOTE_W - 16, 5);
    lines.forEach((l, i) => g.fillText(l, 8, 18 + i * 16.5));
    g.font = `11px ${FONT}`;
    g.fillStyle = who?.color || "#888";
    g.beginPath();
    g.arc(12, NOTE_H - 11, 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(58,51,38,0.7)";
    g.fillText(clip(g, who?.name || "", NOTE_W - 60), 20, NOTE_H - 17);
    if (reacts) {
      g.textAlign = "right";
      g.fillText(`♥ ${reacts}`, NOTE_W - 8, NOTE_H - 17);
    }
    noteCache.set(n.id, { key, img: c });
    return c;
  }

  // ---- 描く ----------------------------------------------------------------
  function draw(f) {
    buildGround(f.deco, f.seedKey);
    last = f;
    const t = f.time / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#5f9e4c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * (vw / 2 - cam.x * cam.zoom), dpr * (vh / 2 - cam.y * cam.zoom));
    const view = { x0: cam.x - vw / 2 / cam.zoom - 80, y0: cam.y - vh / 2 / cam.zoom - 120, x1: cam.x + vw / 2 / cam.zoom + 80, y1: cam.y + vh / 2 / cam.zoom + 120 };
    const sees = (x, y) => x > view.x0 && x < view.x1 && y > view.y0 && y < view.y1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(ground, 0, 0, WORLD.w, WORLD.h);

    // 地面に置いたもの：噴水の水・ボードの付箋
    drawFountain(t);
    for (const n of f.ideas) {
      if (!sees(n.x + NOTE_W / 2, n.y + NOTE_H / 2)) continue;
      const lifted = f.drag && f.drag.id === n.id;
      const x = lifted ? f.drag.x : n.x;
      const y = lifted ? f.drag.y : n.y;
      const tilt = (((parseInt(n.id.slice(-2), 36) || 0) % 7) - 3) * 0.012;
      ctx.save();
      ctx.translate(x + NOTE_W / 2, y + NOTE_H / 2);
      ctx.rotate(lifted ? 0.03 : tilt);
      ctx.shadowColor = "rgba(0,0,0,0.22)";
      ctx.shadowBlur = lifted ? 18 : 6;
      ctx.shadowOffsetY = lifted ? 10 : 3;
      ctx.drawImage(noteImage(n, f.people.get(n.by), n.reacts), -NOTE_W / 2, -NOTE_H / 2, NOTE_W, NOTE_H);
      ctx.restore();
      if (f.hover === n.id || f.focus === n.id) {
        ctx.strokeStyle = f.focus === n.id ? "#0090ff" : "rgba(0,0,0,0.35)";
        ctx.lineWidth = 3;
        ctx.strokeRect(x - 3, y - 3, NOTE_W + 6, NOTE_H + 6);
      }
    }
    if (f.ideaHint) {
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t * 4);
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = "#0090ff";
      ctx.lineWidth = 3;
      ctx.strokeRect(f.ideaHint.x, f.ideaHint.y, NOTE_W, NOTE_H);
      ctx.restore();
    }
    // 道しるべの地面の文字
    for (const z of Object.values(ZONES)) {
      if (!sees(z.sign.x, z.sign.y)) continue;
      drawSign(z.sign.x, z.sign.y, z.label, z.id === f.zone);
    }

    // 立っているもの：奥（上）から順に
    const things = [];
    for (const d of f.deco) if (sees(d.x, d.y)) things.push({ y: d.y, draw: () => drawDeco(d, t) });
    things.push({ y: NOTICE.y + NOTICE.h, draw: () => drawNotice(f.talks, f.people, f.hover === "notice") });
    for (const slot of f.slots) things.push({ y: slot.y + slot.h, draw: () => drawShelf(slot, f.hover === `shelf:${slot.name}`) });
    for (const row of SHELF_ROWS) if (!f.slots.some((s) => s.y === row.y)) things.push({ y: row.y + row.h, draw: () => drawShelf({ ...row, name: "", notes: [] }, false) });
    for (const o of f.others) if (sees(o.x, o.y)) things.push({ y: o.y, draw: () => drawAvatar(o, t, f.hover === `p:${o.uid}`) });
    if (f.me) things.push({ y: f.me.y, draw: () => drawAvatar(f.me, t, false) });
    things.sort((a, b) => a.y - b.y);
    for (const th of things) th.draw();

    // 名札（いちばん上に）
    for (const o of f.others) if (sees(o.x, o.y)) drawTag(o, false);
    if (f.me) drawTag(f.me, true);
    if (f.target) {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2.5;
      const k = (t * 2) % 1;
      ctx.globalAlpha = 1 - k;
      ctx.beginPath();
      ctx.ellipse(f.target.x, f.target.y, 10 + k * 14, 5 + k * 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 時刻の色（夕方・夜）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const shade = skyShade(new Date(f.now));
    if (shade) {
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function drawFountain(t) {
    const { x, y, r } = FOUNTAIN;
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.ellipse(x, y + 14, r + 8, (r + 8) * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c9c2b2";
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#58b6e0";
    ctx.beginPath();
    ctx.ellipse(x, y, r - 14, (r - 14) * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.5 + i / 3) % 1;
      ctx.globalAlpha = 1 - k;
      ctx.beginPath();
      ctx.ellipse(x, y, 10 + k * (r - 26), (10 + k * (r - 26)) * 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#b5ad9b";
    ctx.fillRect(x - 8, y - 40, 16, 40);
    ctx.fillStyle = "rgba(170,225,250,0.9)";
    ctx.beginPath();
    ctx.ellipse(x, y - 44 - Math.sin(t * 6) * 2, 10, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSign(x, y, label, active) {
    ctx.fillStyle = "#7a5634";
    ctx.fillRect(x - 3, y - 34, 6, 36);
    ctx.font = `700 15px ${FONT}`;
    const w = ctx.measureText(label).width + 24;
    ctx.fillStyle = active ? "#fff6d8" : "#f4ead2";
    ctx.strokeStyle = "#7a5634";
    ctx.lineWidth = 3;
    roundRect(ctx, x - w / 2, y - 60, w, 28, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#4a3320";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x, y - 46);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  function drawDeco(d, t) {
    const s = d.size;
    if (d.kind === "tree") {
      const [c1, c2] = TREE_HUES[d.hue];
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, 34 * s, 13 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#7b5434";
      ctx.fillRect(d.x - 6 * s, d.y - 34 * s, 12 * s, 34 * s);
      const sway = Math.sin(t * 1.2 + d.x) * 1.5;
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.arc(d.x + sway, d.y - 52 * s, 34 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c1;
      ctx.beginPath();
      ctx.arc(d.x - 8 * s + sway, d.y - 62 * s, 26 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.arc(d.x - 14 * s + sway, d.y - 70 * s, 11 * s, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.kind === "bush") {
      ctx.fillStyle = "rgba(0,0,0,0.14)";
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, 26 * s, 9 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = TREE_HUES[d.hue][1];
      for (const [dx, dy, r] of [[-12, -12, 15], [10, -14, 14], [0, -22, 15]]) {
        ctx.beginPath();
        ctx.arc(d.x + dx * s, d.y + dy * s, r * s, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (d.kind === "flowers") {
      for (let i = 0; i < 9; i++) {
        const a = i * 2.39996;
        const rr = (i / 9) * 22 * s;
        ctx.fillStyle = FLOWER[(i + d.hue) % FLOWER.length];
        ctx.beginPath();
        ctx.arc(d.x + Math.cos(a) * rr, d.y - 4 + Math.sin(a) * rr * 0.5, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (d.kind === "bench") {
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.fillRect(d.x - 40, d.y - 2, 80, 8);
      ctx.fillStyle = "#8a5a35";
      ctx.fillRect(d.x - 40, d.y - 22, 80, 10);
      ctx.fillStyle = "#a16c42";
      ctx.fillRect(d.x - 40, d.y - 14, 80, 10);
      ctx.fillStyle = "#4b4b4b";
      ctx.fillRect(d.x - 34, d.y - 4, 5, 6);
      ctx.fillRect(d.x + 29, d.y - 4, 5, 6);
    } else if (d.kind === "table") {
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.ellipse(d.x, d.y + 2, 58, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const s of [-1, 1]) {
        ctx.fillStyle = "#5b3a21";
        ctx.fillRect(d.x + s * 62 - 10, d.y - 30, 20, 24);
        ctx.fillStyle = "#7a5634";
        ctx.fillRect(d.x + s * 62 - 10, d.y - 36, 20, 8);
      }
      ctx.fillStyle = "#4a2f1b";
      ctx.fillRect(d.x - 44, d.y - 22, 6, 22);
      ctx.fillRect(d.x + 38, d.y - 22, 6, 22);
      ctx.fillStyle = "#a16c42";
      roundRect(ctx, d.x - 50, d.y - 46, 100, 30, 6);
      ctx.fill();
      ctx.fillStyle = "#f6f0e2";
      ctx.fillRect(d.x - 22, d.y - 40, 26, 18);
      ctx.fillStyle = "#c9ecfb";
      ctx.fillRect(d.x + 10, d.y - 38, 18, 14);
    } else if (d.kind === "plant") {
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, 18, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#c46b3e";
      ctx.beginPath();
      ctx.moveTo(d.x - 14, d.y - 26);
      ctx.lineTo(d.x + 14, d.y - 26);
      ctx.lineTo(d.x + 10, d.y);
      ctx.lineTo(d.x - 10, d.y);
      ctx.fill();
      ctx.fillStyle = "#3f8f4a";
      for (const [dx, dy, r] of [[-10, -40, 11], [9, -42, 12], [0, -54, 12], [-3, -32, 9]]) {
        ctx.beginPath();
        ctx.arc(d.x + dx + Math.sin(t + d.x) * 0.8, d.y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (d.kind === "lamp") {
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, 12, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3d4450";
      ctx.fillRect(d.x - 3, d.y - 70, 6, 70);
      ctx.fillStyle = "#fff4c2";
      ctx.beginPath();
      ctx.arc(d.x, d.y - 76, 9, 0, Math.PI * 2);
      ctx.fill();
      const night = nightness(new Date(last.now));
      if (night > 0) {
        const g = ctx.createRadialGradient(d.x, d.y - 76, 4, d.x, d.y - 76, 120);
        g.addColorStop(0, `rgba(255,230,150,${0.35 * night})`);
        g.addColorStop(1, "rgba(255,230,150,0)");
        ctx.fillStyle = g;
        ctx.fillRect(d.x - 120, d.y - 196, 240, 240);
      }
    }
  }

  function drawNotice(talks, people, hover) {
    const { x, y, w, h } = NOTICE;
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(x + 6, y + h + 2, w - 12, 10);
    ctx.fillStyle = "#6e4a2c";
    ctx.fillRect(x + 20, y + h - 6, 8, 18);
    ctx.fillRect(x + w - 28, y + h - 6, 8, 18);
    ctx.fillStyle = "#8a5a35";
    roundRect(ctx, x - 6, y - 26, w + 12, h + 32, 8);
    ctx.fill();
    ctx.fillStyle = "#d8b384";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#fff6e0";
    ctx.font = `700 15px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("みんなの掲示板", x + w / 2, y - 8);
    ctx.textAlign = "left";
    const cards = talks.slice(0, 6);
    cards.forEach((n, i) => {
      const cx = x + 8 + (i % 3) * ((w - 16) / 3);
      const cy = y + 8 + Math.floor(i / 3) * 54;
      const cw = (w - 16) / 3 - 6;
      ctx.fillStyle = ["#fff1a8", "#ffd3dd", "#c9ecfb", "#d3f2c6", "#e6dbff", "#fff1a8"][i];
      ctx.fillRect(cx, cy, cw, 48);
      ctx.fillStyle = people.get(n.by)?.color || "#888";
      ctx.beginPath();
      ctx.arc(cx + cw / 2, cy + 4, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3a3326";
      ctx.font = `11px ${FONT}`;
      wrap(ctx, n.deleted ? "消された話題" : n.text, cw - 8, 2).forEach((l, k) => ctx.fillText(l, cx + 4, cy + 22 + k * 14));
    });
    if (!cards.length) {
      ctx.fillStyle = "rgba(58,51,38,0.6)";
      ctx.font = `13px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("まだ何も貼られていません", x + w / 2, y + h / 2 + 4);
      ctx.textAlign = "left";
    }
    if (hover) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      roundRect(ctx, x - 9, y - 29, w + 18, h + 38, 10);
      ctx.stroke();
    }
  }

  function drawShelf(slot, hover) {
    const { x, y, w, h } = slot;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(x + 4, y + h, w - 4, 10);
    ctx.fillStyle = "#5b3a21";
    ctx.fillRect(x, y - 16, w, 16);
    ctx.fillStyle = "#6e4a2c";
    ctx.fillRect(x, y, w, h);
    // 本：付箋1枚が1冊
    const n = slot.notes.length;
    const max = Math.max(0, Math.floor((w - 16) / 20));
    let bx = x + 10;
    for (let i = 0; i < Math.min(n, max); i++) {
      const id = slot.notes[i].id;
      const hue = hashLite(id) % 360;
      const bh = h - 10 - (hashLite(id + "h") % 12);
      const lean = i === Math.min(n, max) - 1 && n < max ? 0.18 : 0;
      ctx.save();
      ctx.translate(bx, y + h - 4);
      ctx.rotate(lean);
      ctx.fillStyle = `hsl(${hue}, 48%, 50%)`;
      ctx.fillRect(0, -bh, 17, bh);
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(3, -bh + 6, 11, 3);
      ctx.fillRect(3, -14, 11, 3);
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.fillRect(14, -bh, 3, bh);
      ctx.restore();
      bx += 20;
    }
    if (slot.name) {
      ctx.font = `700 12px ${FONT}`;
      const label = clip(ctx, slot.name, w - 16);
      const lw = ctx.measureText(label).width + 14;
      ctx.fillStyle = "#f4ead2";
      roundRect(ctx, x + w / 2 - lw / 2, y - 14, lw, 18, 4);
      ctx.fill();
      ctx.fillStyle = "#4a3320";
      ctx.textAlign = "center";
      ctx.fillText(label, x + w / 2, y);
      ctx.textAlign = "left";
      if (n > max) {
        ctx.fillStyle = "#f4ead2";
        ctx.font = `11px ${FONT}`;
        ctx.fillText(`+${n - max}`, x + w - 26, y + h - 8);
      }
    }
    ctx.strokeStyle = hover ? "#ffffff" : "#4a2f1b";
    ctx.lineWidth = hover ? 3 : 2;
    ctx.strokeRect(x, y - 16, w, h + 16);
  }

  function drawAvatar(a, t, hover) {
    const fade = a.online === false ? 0.45 : 1;
    const bob = a.moving ? Math.abs(Math.sin(t * 12)) * 3 : Math.sin(t * 2 + (a.x % 7)) * 0.8;
    const x = a.x;
    const y = a.y;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(x, y, 15, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    const by = y - bob;
    // 体
    ctx.fillStyle = a.color;
    roundRect(ctx, x - 12, by - 30, 24, 26, 10);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    roundRect(ctx, x - 9, by - 27, 8, 14, 4);
    ctx.fill();
    // 頭
    const hy = by - 44;
    const skin = a.look === "robo" ? "#cfd6df" : a.look === "hito" ? "#ffe0c2" : lighten(a.color, 0.55);
    ears(a.look, x, hy, skin, a.color);
    ctx.fillStyle = skin;
    if (a.look === "robo") {
      roundRect(ctx, x - 16, hy - 15, 32, 28, 7);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, hy, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    if (a.look === "hito") {
      ctx.fillStyle = darken(a.color, 0.35);
      ctx.beginPath();
      ctx.arc(x, hy - 3, 16.5, Math.PI * 1.05, Math.PI * 1.95);
      ctx.fill();
    }
    // 顔：向きで目を寄せる
    const look = a.dir || 0;
    ctx.fillStyle = "#2b2b2b";
    const blink = (t + (a.x % 5)) % 4 < 0.12;
    for (const s of [-1, 1]) {
      if (blink) ctx.fillRect(x + s * 6 + look * 3 - 2.5, hy + 1, 5, 1.6);
      else {
        ctx.beginPath();
        ctx.arc(x + s * 6 + look * 3, hy + 1, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = "rgba(255,120,120,0.45)";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + s * 10 + look * 2, hy + 6, 3.5, 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (hover) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(x, y, 20, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function ears(look, x, hy, skin, color) {
    ctx.fillStyle = skin;
    if (look === "neko") {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x + s * 15, hy - 3);
        ctx.lineTo(x + s * 12, hy - 22);
        ctx.lineTo(x + s * 3, hy - 13);
        ctx.fill();
      }
    } else if (look === "inu") {
      ctx.fillStyle = darken(color, 0.2);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(x + s * 15, hy + 2, 6, 11, s * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (look === "usagi") {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(x + s * 7, hy - 24, 5, 14, s * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (look === "kuma") {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(x + s * 13, hy - 12, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (look === "robo") {
      ctx.fillStyle = "#8a96a6";
      ctx.fillRect(x - 1.5, hy - 26, 3, 12);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, hy - 27, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTag(a, mine) {
    const label = a.online === false ? `${a.name}・${a.ago}` : a.name;
    ctx.font = `${mine ? 700 : 600} 12px ${FONT}`;
    const w = ctx.measureText(label).width + 14;
    const y = a.y - 82 - (a.look === "usagi" ? 8 : 0);
    ctx.globalAlpha = a.online === false ? 0.6 : 0.92;
    ctx.fillStyle = mine ? "#ffffff" : "rgba(30,30,36,0.78)";
    roundRect(ctx, a.x - w / 2, y - 10, w, 20, 10);
    ctx.fill();
    ctx.fillStyle = mine ? "#1d1d22" : "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, a.x, y + 0.5);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 1;
  }

  // ---- 当たり判定（ワールドの座標で） ----------------------------------------------------------------
  function hit(wx, wy) {
    if (!last) return null;
    for (const o of [...last.others].reverse()) if (Math.abs(wx - o.x) < 18 && wy > o.y - 64 && wy < o.y + 6) return { kind: "person", id: `p:${o.uid}`, uid: o.uid };
    for (const n of [...last.ideas].reverse()) {
      if (wx >= n.x && wx <= n.x + NOTE_W && wy >= n.y && wy <= n.y + NOTE_H) return { kind: "note", id: n.id };
    }
    if (wx >= NOTICE.x - 6 && wx <= NOTICE.x + NOTICE.w + 6 && wy >= NOTICE.y - 26 && wy <= NOTICE.y + NOTICE.h + 12) return { kind: "notice", id: "notice" };
    for (const s of last.slots) if (wx >= s.x && wx <= s.x + s.w && wy >= s.y - 16 && wy <= s.y + s.h) return { kind: "shelf", id: `shelf:${s.name}`, name: s.name };
    return null;
  }

  return { resize, draw, follow, jump, toWorld, toScreen, hit, cam, forget: (id) => noteCache.delete(id) };
}

// ---- 小物 ----------------------------------------------------------------
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** 文字を幅で折り返す（日本語は1文字ずつ、英語は単語の途中でも折る）。max 行を超えたら最後を「…」に */
export function wrap(g, text, width, max) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const ch of para) {
      if (g.measureText(line + ch).width > width && line) {
        out.push(line);
        line = ch.trimStart();
        if (out.length >= max) break;
      } else line += ch;
    }
    if (out.length >= max) break;
    out.push(line);
    if (out.length >= max) break;
  }
  const rest = out.length >= max;
  const lines = out.slice(0, max);
  if (rest && lines.length) lines[lines.length - 1] = clip(g, lines[lines.length - 1] + "……", width);
  return lines;
}

function clip(g, text, width) {
  if (g.measureText(text).width <= width) return text;
  let s = text;
  while (s && g.measureText(s + "…").width > width) s = s.slice(0, -1);
  return s + "…";
}

function hashLite(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function mix(hex, to, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
const lighten = (hex, k) => mix(hex, 255, k);
const darken = (hex, k) => mix(hex, 0, k);

/** 夜の濃さ 0〜1（19時〜5時が夜。前後1時間で移る） */
function nightness(d) {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 20 || h < 4.5) return 1;
  if (h >= 18) return (h - 18) / 2;
  if (h < 6) return 1 - (h - 4.5) / 1.5;
  return 0;
}
function skyShade(d) {
  const h = d.getHours() + d.getMinutes() / 60;
  const night = nightness(d);
  if (night > 0) return `rgba(20,30,80,${(0.32 * night).toFixed(3)})`;
  if (h >= 16.5 && h < 18) return `rgba(255,140,60,${(0.1 * (h - 16.5) / 1.5).toFixed(3)})`;
  return null;
}
