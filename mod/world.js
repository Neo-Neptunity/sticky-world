// ワールドの地図：三つの場所（広場・アトリエ・書庫）と、木や道などの飾り。座標はワールドの点（1倍で 1px）。
// 飾りはフォルダごとに同じ並び（フォルダの名前から種を作る）。歩けない所は作らない（どこへでも歩ける）。
import { WORLD } from "./store.js";

export const ZONES = {
  talk: { id: "talk", label: "広場", x: 880, y: 470, w: 640, h: 640, sign: { x: 1200, y: 1150 } },
  idea: { id: "idea", label: "アトリエ", x: 1620, y: 250, w: 700, h: 1100, sign: { x: 1580, y: 860 } },
  shelf: { id: "shelf", label: "書庫", x: 90, y: 330, w: 700, h: 940, sign: { x: 830, y: 860 } },
};
/** アトリエのボード：アイデアの付箋を貼れる所 */
export const BOARD = { x: 1660, y: 300, w: 620, h: 1000 };
/** 広場の掲示板 */
export const NOTICE = { x: 1040, y: 500, w: 320, h: 120 };
export const FOUNTAIN = { x: 1200, y: 820, r: 90 };
export const SPAWN = { x: 1200, y: 990 };
export const NOTE_W = 132;
export const NOTE_H = 108;

/** 書庫の棚：横に長い棚が4段。棚1つに、名前の付いた区切りが入る */
export const SHELF_ROWS = [460, 660, 860, 1060].map((y) => ({ x: 130, y, w: 440, h: 58 }));
/** 書庫の右側の、読書の場所（じゅうたん） */
export const READING = { x: 600, y: 420, w: 170, h: 760 };

export function zoneAt(x, y) {
  for (const z of Object.values(ZONES)) if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z.id;
  return null;
}

export const clampToWorld = (x, y) => ({ x: Math.min(WORLD.w - 30, Math.max(30, x)), y: Math.min(WORLD.h - 30, Math.max(40, y)) });

/** 付箋の左上をボードの中に収める */
export function clampToBoard(x, y) {
  return {
    x: Math.round(Math.min(BOARD.x + BOARD.w - NOTE_W - 8, Math.max(BOARD.x + 8, x))),
    y: Math.round(Math.min(BOARD.y + BOARD.h - NOTE_H - 8, Math.max(BOARD.y + 8, y))),
  };
}

/** 棚の区切りの位置：棚の名前の並びを、4段に順に割りふる。1段に入りきらない分は次の段へ */
export function shelfSlots(groups) {
  const slots = [];
  const per = Math.max(1, Math.ceil(groups.length / SHELF_ROWS.length));
  groups.forEach((g, i) => {
    const row = SHELF_ROWS[Math.min(SHELF_ROWS.length - 1, Math.floor(i / per))];
    const col = i % per;
    const w = row.w / per;
    slots.push({ name: g.name, notes: g.notes, x: row.x + col * w, y: row.y, w, h: row.h });
  });
  return slots;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h;
}

const inside = (x, y, r, pad) => x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad;

/** 飾り：木・花壇・ベンチ・街灯。場所と道にはかぶせない */
export function decorations(seedText) {
  const rnd = rng(hashStr(seedText || "world"));
  const items = [];
  const blocked = (x, y) =>
    Object.values(ZONES).some((z) => inside(x, y, z, 50)) || (y > 760 && y < 900) || (x > 1140 && x < 1260 && y > 1080);
  for (let i = 0; i < 400 && items.length < 70; i++) {
    const x = 40 + rnd() * (WORLD.w - 80);
    const y = 60 + rnd() * (WORLD.h - 100);
    if (blocked(x, y) || items.some((d) => Math.hypot(d.x - x, d.y - y) < 70)) continue;
    const r = rnd();
    items.push({ kind: r < 0.62 ? "tree" : r < 0.82 ? "bush" : "flowers", x, y, size: 0.8 + rnd() * 0.5, hue: Math.floor(rnd() * 5) });
  }
  // 広場のまわりのベンチと街灯
  for (const [x, y] of [[960, 700], [1440, 700], [960, 940], [1440, 940]]) items.push({ kind: "bench", x, y, size: 1, hue: 0 });
  for (const [x, y] of [[900, 500], [1500, 500], [900, 1090], [1500, 1090]]) items.push({ kind: "lamp", x, y, size: 1, hue: 0 });
  // 書庫の読書の机と鉢植え、アトリエの鉢植え
  for (const y of [600, 860, 1110]) items.push({ kind: "table", x: 685, y, size: 1, hue: 0 });
  for (const [x, y] of [[125, 1250], [760, 1250], [760, 380], [1640, 1330], [2300, 1330], [2300, 270]]) items.push({ kind: "plant", x, y, size: 1, hue: 0 });
  return items;
}
