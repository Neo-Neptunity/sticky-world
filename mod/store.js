// 付箋ワールドのデータ：出来事の形・確かめ・ファイル名・まとめ上げ。ep を使わない（試験しやすいように）。
// 書き込みはすべて「出来事」を1つ足すだけ。付箋を直す・動かす・消すも、新しい出来事として足す（同期でぶつからないように）。
// ほかの人のファイルは信じない：読んだものは normalize で形を確かめ、合わないものは捨てる。

export const DATA_DIR = ".付箋ワールド";
export const HERE_DIR = "here";
export const TYPES = ["talk", "idea", "shelf"];
export const TYPE_LABEL = { talk: "広場", idea: "アトリエ", shelf: "書庫" };
export const EMOJI = ["👍", "❤️", "😂", "💡", "👀", "🎉"];
export const COLORS = ["#e5484d", "#f76b15", "#e2a400", "#46a758", "#12a594", "#0090ff", "#6e56cf", "#d6409f"];
export const LOOKS = ["neko", "inu", "usagi", "kuma", "hito", "robo"];
export const LOOK_LABEL = { neko: "ねこ", inu: "いぬ", usagi: "うさぎ", kuma: "くま", hito: "ひと", robo: "ロボ" };
export const TINTS = ["#fff1a8", "#ffd3dd", "#c9ecfb", "#d3f2c6", "#e6dbff"];
export const LIMITS = { text: 1000, title: 40, shelf: 16, name: 16, file: 200 };
export const WORLD = { w: 2400, h: 1600 };

const UID = /^[0-9a-z]{6}$/;
const ID = /^[0-9a-z]{9}-[0-9a-z]{6}-[0-9a-z]{4}$/;
const COLOR = /^#[0-9a-f]{6}$/i;

// ---- 名前と ID ----------------------------------------------------------------
export const newUid = (rnd = Math.random) => Array.from({ length: 6 }, () => Math.floor(rnd() * 36).toString(36)).join("");

/** 出来事の ID：時刻・書いた人・偶然の4文字。ファイル名にもそのまま使う */
export function newId(now, uid, rnd = Math.random) {
  const tail = Array.from({ length: 4 }, () => Math.floor(rnd() * 36).toString(36)).join("");
  return `${Math.max(0, Math.floor(now)).toString(36).padStart(9, "0")}-${uid}-${tail}`;
}
export const authorOf = (id) => (ID.test(id) ? id.slice(10, 16) : null);
export const fileOf = (id) => `${id}.json`;
export const idOfFile = (name) => (/\.json$/i.test(name) && ID.test(name.slice(0, -5)) ? name.slice(0, -5) : null);

/** 月ごとのフォルダの名前（世界時で決める。PC ごとの時刻帯で分かれないように） */
export function monthOf(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
/** 月のフォルダか。同時に作られて OneDrive が「2026-10-PC名」のように分けたものも、月のフォルダとして読む */
export const isMonthDir = (name) => /^\d{4}-\d{2}(?:\D.*)?$/.test(name);
export const monthKey = (name) => name.slice(0, 7);

/** 居場所のファイル名：「誰~時刻~x~y.txt」。歩くたびに、自分のファイルの名前だけを変える */
export function hereName(uid, at, x, y) {
  return `${uid}~${Math.max(0, Math.floor(at)).toString(36)}~${clampInt(x, 0, WORLD.w)}~${clampInt(y, 0, WORLD.h)}.txt`;
}
export function parseHere(name) {
  const m = /^([0-9a-z]{6})~([0-9a-z]{1,10})~(\d{1,4})~(\d{1,4})\.txt$/.exec(name);
  if (!m) return null;
  return { uid: m[1], at: parseInt(m[2], 36), x: clampInt(+m[3], 0, WORLD.w), y: clampInt(+m[4], 0, WORLD.h) };
}

// ---- 確かめ ----------------------------------------------------------------
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));
const str = (v, max) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : "");
const oneLine = (v, max) => str(v, max).replace(/\s+/g, " ");
const num = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * 読んだ出来事を確かめて、決まった形にする。合わなければ null。
 * 書いた人は、中の by ではなくファイル名（ID）から決める。
 */
export function normalize(raw, id) {
  if (!raw || typeof raw !== "object" || raw.v !== 1 || raw.id !== id || !ID.test(id)) return null;
  const by = authorOf(id);
  if (!num(raw.at) || raw.at < Date.UTC(2020, 0, 1)) return null;
  const base = { v: 1, id, at: raw.at, by, k: raw.k };
  switch (raw.k) {
    case "hello": {
      const name = oneLine(raw.name, LIMITS.name);
      if (!name) return null;
      return { ...base, name, color: COLOR.test(raw.color) ? raw.color.toLowerCase() : COLORS[0], look: LOOKS.includes(raw.look) ? raw.look : LOOKS[0] };
    }
    case "note": {
      if (!TYPES.includes(raw.type)) return null;
      const text = str(raw.text, LIMITS.text);
      const title = raw.type === "shelf" ? oneLine(raw.title, LIMITS.title) : "";
      if (!text && !title) return null;
      const n = { ...base, type: raw.type, text };
      if (raw.type === "talk" && typeof raw.re === "string" && ID.test(raw.re)) n.re = raw.re;
      if (raw.type === "idea") {
        n.x = num(raw.x) ? clampInt(raw.x, 0, WORLD.w) : WORLD.w / 2;
        n.y = num(raw.y) ? clampInt(raw.y, 0, WORLD.h) : WORLD.h / 2;
        n.tint = TINTS.includes(raw.tint) ? raw.tint : TINTS[0];
      }
      if (raw.type === "shelf") {
        n.title = title;
        n.shelf = oneLine(raw.shelf, LIMITS.shelf) || "いろいろ";
      }
      const file = oneLine(raw.file, LIMITS.file);
      if (file && !/[\\/:*?"<>|]/.test(file)) n.file = file;
      return n;
    }
    case "edit": {
      if (!ID.test(raw.target ?? "")) return null;
      const text = str(raw.text, LIMITS.text);
      const e = { ...base, target: raw.target, text };
      if (typeof raw.title === "string") e.title = oneLine(raw.title, LIMITS.title);
      if (typeof raw.shelf === "string") e.shelf = oneLine(raw.shelf, LIMITS.shelf) || "いろいろ";
      if (typeof raw.file === "string") {
        const file = oneLine(raw.file, LIMITS.file);
        e.file = /[\\/:*?"<>|]/.test(file) ? "" : file;
      }
      return e;
    }
    case "move":
      if (!ID.test(raw.target ?? "") || !num(raw.x) || !num(raw.y)) return null;
      return { ...base, target: raw.target, x: clampInt(raw.x, 0, WORLD.w), y: clampInt(raw.y, 0, WORLD.h) };
    case "react":
      if (!ID.test(raw.target ?? "") || !EMOJI.includes(raw.e)) return null;
      return { ...base, target: raw.target, e: raw.e, on: raw.on !== false };
    case "del":
      if (!ID.test(raw.target ?? "")) return null;
      return { ...base, target: raw.target };
    default:
      return null;
  }
}

/** ファイルの中身（文字）から出来事を読む。読めなければ null */
export function parseEvent(text, fileName) {
  const id = idOfFile(fileName);
  if (!id) return null;
  try {
    return normalize(JSON.parse(text), id);
  } catch {
    return null;
  }
}

/** 書く出来事を作る（normalize を通して、読む側と同じ形にそろえる） */
export function makeEvent(k, fields, { uid, now = Date.now(), rnd = Math.random }) {
  const id = newId(now, uid, rnd);
  return normalize({ ...fields, v: 1, id, at: now, by: uid, k }, id);
}

// ---- まとめ上げ ----------------------------------------------------------------
const byTime = (a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 似た色を ID から決める（名乗る前の人の色） */
export function colorOfUid(uid) {
  let h = 0;
  for (const c of uid) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
export const unknownPerson = (uid) => ({ uid, name: "名なしさん", color: colorOfUid(uid), look: "hito", since: 0, last: 0, posts: 0 });

/**
 * 出来事の全部から、今のワールドの姿を作る。何度呼んでも同じ結果（順番は時刻と ID で決める）。
 * 直す・消すは書いた本人の出来事だけ効く。動かす・リアクションは誰でもできる。
 */
export function fold(events) {
  const sorted = [...events].sort(byTime);
  const people = new Map();
  const notes = new Map();
  const person = (uid) => {
    if (!people.has(uid)) people.set(uid, unknownPerson(uid));
    return people.get(uid);
  };
  // 付箋を先に作る（時計のずれで、直す出来事が付箋より前に並んでも効くように）
  for (const e of sorted) {
    const p = person(e.by);
    p.last = Math.max(p.last, e.at);
    if (e.k === "hello") Object.assign(p, { name: e.name, color: e.color, look: e.look, since: p.since || e.at });
    if (e.k !== "note" || notes.has(e.id)) continue;
    notes.set(e.id, {
      id: e.id, type: e.type, by: e.by, at: e.at, text: e.text, title: e.title ?? "", shelf: e.shelf ?? "",
      x: e.x, y: e.y, tint: e.tint, re: e.re ?? null, file: e.file ?? "",
      edited: 0, deleted: false, reactions: new Map(), replies: [], touched: e.at,
    });
  }
  for (const e of sorted) {
    if (e.k === "hello" || e.k === "note") continue;
    const n = notes.get(e.target);
    if (!n) continue;
    if (e.k === "edit" && n.by === e.by && !n.deleted) {
      if (e.text || n.type === "shelf") n.text = e.text;
      if (e.title !== undefined && n.type === "shelf") n.title = e.title || n.title;
      if (e.shelf !== undefined && n.type === "shelf") n.shelf = e.shelf;
      if (e.file !== undefined) n.file = e.file;
      n.edited = e.at;
      n.touched = Math.max(n.touched, e.at);
    } else if (e.k === "move" && n.type === "idea" && !n.deleted) {
      n.x = e.x;
      n.y = e.y;
    } else if (e.k === "react") {
      const set = n.reactions.get(e.e) ?? new Set();
      if (e.on) set.add(e.by);
      else set.delete(e.by);
      if (set.size) n.reactions.set(e.e, set);
      else n.reactions.delete(e.e);
    } else if (e.k === "del" && n.by === e.by) {
      n.deleted = true;
    }
  }
  for (const n of [...notes.values()].sort(byTime)) {
    if (!n.re) continue;
    const parent = notes.get(n.re);
    if (parent && parent.type === "talk" && !parent.re) {
      parent.replies.push(n);
      parent.touched = Math.max(parent.touched, n.at);
    } else n.re = null;
  }
  for (const n of notes.values()) if (!n.deleted) person(n.by).posts++;
  return { people, notes };
}

// ---- 見せ方ごとの並び ----------------------------------------------------------------
/** 広場：返信ではない話題を、新しく動いた順に。消された話題も、返信が残っていれば枠だけ出す */
export const talkFeed = (state) =>
  [...state.notes.values()]
    .filter((n) => n.type === "talk" && !n.re && (!n.deleted || n.replies.some((r) => !r.deleted)))
    .sort((a, b) => b.touched - a.touched || (a.id < b.id ? 1 : -1));

export const ideas = (state) => [...state.notes.values()].filter((n) => n.type === "idea" && !n.deleted).sort(byTime);

/** 書庫：棚の名前ごとに、新しい順 */
export function shelves(state) {
  const map = new Map();
  for (const n of state.notes.values()) {
    if (n.type !== "shelf" || n.deleted) continue;
    if (!map.has(n.shelf)) map.set(n.shelf, []);
    map.get(n.shelf).push(n);
  }
  for (const list of map.values()) list.sort((a, b) => b.at - a.at);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja")).map(([name, list]) => ({ name, notes: list }));
}

export const reactionCount = (n) => [...n.reactions.values()].reduce((s, set) => s + set.size, 0);

/** 自分が見ていない間に、ほかの人が書いた付箋の数 */
export function unread(state, me, since) {
  let count = 0;
  for (const n of state.notes.values()) if (!n.deleted && n.by !== me && n.at > since) count++;
  return count;
}

export function timeAgo(ms, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "たった今";
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  if (s < 172800) return "昨日";
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
