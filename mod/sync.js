// 共有フォルダとのやり取り。データはフォルダの中の「.付箋ワールド」に置く：
//   .付箋ワールド/はじめに.txt      … MOD を入れていない人向けの説明
//   .付箋ワールド/2026-10/<ID>.json … 出来事1つにファイル1つ。月ごとのフォルダに分ける（開くときに全部を一度に読まない）
//   .付箋ワールド/here/<誰~時刻~x~y>.txt … 居場所。1人1ファイルで、名前だけを変える（ファイルは増えない）
// 新しく作るか名前を変えるだけで、ほかの人のファイルは書き換えない。だから OneDrive などの同期でぶつからない。
import { DATA_DIR, HERE_DIR, isMonthDir, monthKey, monthOf, fileOf, parseEvent, parseHere, hereName } from "./store.js";

const README = [
  "このフォルダは「付箋ワールド」のデータです。",
  "explorer_plus の MOD「付箋ワールド」で、このフォルダを共有している人どうしが付箋を貼り合っています。",
  "中のファイルを消したり書き換えたりすると、みんなの付箋が消えることがあります。そのままにしておいてください。",
  "",
].join("\r\n");
const RECENT_MONTHS = 2;       // 毎回見る月の数（新しい方から）
const FULL_EVERY = 60;         // この回数ごとに、古い月も見直す（遅れて同期されたものを拾う）
const READ_AT_ONCE = 6;
const MAX_FAILS = 3;

const refOf = (e) => ({ id: e.id, path: e.path });

export function createSync(ep, { onEvents, onHere, onProgress }) {
  let root = null;             // .付箋ワールド
  let hereDir = null;
  let rootKey = "";
  let months = [];             // [{ key, entry }]（同じ key の重複フォルダも別に持つ）
  const known = new Set();     // 読んだ・読めないと分かったファイル名
  const fails = new Map();
  const listed = new Set();    // 一度でも中を見た月のフォルダ（パス）
  const monthNames = new Map(); // 月 → その月のフォルダにあって、読み終わったファイルの名前
  let tick = 0;
  let myHere = null;
  let busy = null;

  const cacheKey = (key) => `cache:${rootKey}:${key}`;

  /** 開いたフォルダに、もうワールドがあるか */
  function attach(folder) {
    const found = (folder.entries || []).find((e) => e.kind === "folder" && e.name === DATA_DIR);
    if (!found) {
      root = null;
      return false;
    }
    if (root && root.id === found.id && root.path === found.path) return true;
    root = refOf(found);
    rootKey = found.id || found.path.toLowerCase();
    months = [];
    hereDir = null;
    myHere = null;
    known.clear();
    fails.clear();
    listed.clear();
    monthNames.clear();
    tick = 0;
    return true;
  }

  /** このフォルダをワールドにする（データのフォルダと説明を作る）。最初の1回、本体が許可を聞く */
  async function create(folder) {
    let dir;
    try {
      dir = await ep.files.create(refOf(folder), DATA_DIR, { kind: "folder" });
    } catch (err) {
      if (err.code !== "exists") throw err;
      const tree = await ep.getTree({ depth: 1, from: refOf(folder) });
      dir = (tree.children || []).map((c) => c.entry).find((e) => e.name === DATA_DIR);
      if (!dir) throw err;
    }
    await ep.files.create(refOf(dir), "はじめに.txt", { text: README }).catch((err) => console.warn("説明のファイルを作れませんでした", err.message));
    attach({ entries: [dir] });
    return dir;
  }

  async function listRoot() {
    const tree = await ep.getTree({ depth: 1, from: root });
    const kids = (tree.children || []).map((c) => c.entry).filter((e) => e.kind === "folder");
    months = kids.filter((e) => isMonthDir(e.name)).map((e) => ({ key: monthKey(e.name), name: e.name, entry: refOf(e) }));
    months.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
    const h = kids.find((e) => e.name === HERE_DIR);
    hereDir = h ? refOf(h) : null;
  }

  async function readFiles(files) {
    const out = [];
    let next = 0;
    const work = async () => {
      while (next < files.length) {
        const f = files[next++];
        try {
          const r = await ep.files.readText(refOf(f), { maxBytes: 64 * 1024 });
          const ev = parseEvent(r.text, f.name);
          known.add(f.name);
          if (ev) out.push(ev);
          else console.warn("読めない出来事を飛ばしました", f.name);
        } catch (err) {
          const n = (fails.get(f.name) || 0) + 1;
          fails.set(f.name, n);
          if (n >= MAX_FAILS) known.add(f.name);
          console.warn("出来事を読めませんでした", f.name, err.message);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(READ_AT_ONCE, files.length) }, work));
    return out;
  }

  /** 1つの月のフォルダを見て、まだ読んでいないファイルを読む */
  async function readMonth(m, { useCache }) {
    const tree = await ep.getTree({ depth: 1, from: m.entry });
    listed.add(m.entry.path);
    const all = (tree.children || []).map((c) => c.entry).filter((e) => e.kind === "file" && /\.json$/i.test(e.name));
    // 覚えておいた分は読み直さない。今フォルダにあるファイルの分だけ使う
    if (useCache) {
      const cached = await ep.storage.get(cacheKey(m.key)).catch(() => undefined);
      if (cached && cached.v === 1 && Array.isArray(cached.names) && Array.isArray(cached.evs)) {
        const here = new Set(all.map((e) => e.name));
        const evs = [];
        for (const raw of cached.evs) {
          const name = fileOf(raw && raw.id);
          const ev = here.has(name) && !known.has(name) ? parseEvent(JSON.stringify(raw), name) : null;
          if (ev) evs.push(ev);
        }
        for (const n of cached.names) if (here.has(n)) known.add(n);
        if (evs.length) onEvents(evs);
      }
    }
    const files = all.filter((e) => !known.has(e.name));
    onProgress?.({ reading: files.length });
    const evs = files.length ? await readFiles(files) : [];
    if (evs.length) onEvents(evs);
    if (!monthNames.has(m.key)) monthNames.set(m.key, new Set());
    for (const e of all) if (known.has(e.name)) monthNames.get(m.key).add(e.name);
    return evs;
  }

  /** 読んだ月を、次に開くときのために覚える。読めないと分かったファイルの名前も覚える（1MB を超えたら覚えない） */
  async function remember(key, allEvents) {
    const names = monthNames.get(key);
    if (!names || !names.size) return;
    const evs = allEvents.filter((e) => names.has(fileOf(e.id)));
    try {
      await ep.storage.set(cacheKey(key), { v: 1, names: [...names], evs });
    } catch (err) {
      if (err.code !== "too-large") console.warn("読み込みを覚えられませんでした", err.message);
    }
  }

  /** 開いたときに全部を読む：新しい月から。読み終わった月は覚えておく */
  async function load(getAll) {
    await listRoot();
    let done = 0;
    for (const m of months) {
      onProgress?.({ done, total: months.length });
      await readMonth(m, { useCache: true });
      done++;
    }
    onProgress?.({ done, total: months.length });
    await readHere();
    const all = getAll();
    for (const key of new Set(months.map((m) => m.key))) await remember(key, all);
  }

  /** 新着を見る。いつもは新しい月と居場所だけ。ときどき古い月も見直す */
  function poll() {
    if (!root) return Promise.resolve();
    if (busy) return busy;
    busy = (async () => {
      tick++;
      await listRoot();
      const keys = [...new Set(months.map((m) => m.key))].slice(0, RECENT_MONTHS);
      const full = tick % FULL_EVERY === 0;
      for (const m of months) {
        if (full || keys.includes(m.key) || !listed.has(m.entry.path)) await readMonth(m, { useCache: false });
      }
      await readHere();
    })().finally(() => {
      busy = null;
    });
    return busy;
  }

  async function readHere() {
    if (!hereDir) return onHere([]);
    const tree = await ep.getTree({ depth: 1, from: hereDir });
    const list = [];
    for (const c of tree.children || []) {
      const h = parseHere(c.entry.name);
      if (h) list.push({ ...h, entry: refOf(c.entry) });
    }
    onHere(list);
    return list;
  }

  async function ensureDir(name) {
    try {
      return refOf(await ep.files.create(root, name, { kind: "folder" }));
    } catch (err) {
      if (err.code !== "exists") throw err;
      await listRoot();
      const found = name === HERE_DIR ? hereDir : months.find((m) => m.key === name)?.entry;
      if (!found) throw err;
      return found;
    }
  }

  /** 出来事を1つ書く（新しいファイルを作るだけ） */
  async function write(ev) {
    if (!root) throw Object.assign(new Error("no world"), { code: "not-found" });
    const key = monthOf(ev.at);
    // 同じ月のフォルダが同期で2つに分かれていたら、名前がちょうどの方に書く
    const m = months.find((x) => x.name === key) || months.find((x) => x.key === key);
    const dir = m ? m.entry : await ensureDir(key);
    if (!m) {
      months.unshift({ key, name: key, entry: dir });
      listed.add(dir.path);
    }
    await ep.files.create(dir, fileOf(ev.id), { text: JSON.stringify(ev) });
    known.add(fileOf(ev.id));
    if (!monthNames.has(key)) monthNames.set(key, new Set());
    monthNames.get(key).add(fileOf(ev.id));
  }

  /** 自分の居場所を知らせる：自分のファイルの名前を変える（無ければ作る） */
  async function moveHere(uid, x, y, list) {
    if (!root) return;
    const name = hereName(uid, Date.now(), x, y);
    if (!myHere && list) {
      const mine = list.filter((h) => h.uid === uid).sort((a, b) => b.at - a.at)[0];
      if (mine) myHere = mine.entry;
    }
    if (myHere) {
      try {
        myHere = refOf(await ep.rename(myHere, name));
        return;
      } catch (err) {
        if (err.code !== "not-found" && err.code !== "denied") throw err;
        myHere = null;  // 消された・別の PC で ID が違う：作り直す
      }
    }
    if (!hereDir) hereDir = await ensureDir(HERE_DIR);
    myHere = refOf(await ep.files.create(hereDir, name, { text: "付箋ワールドの居場所です。名前が、最後にいた所と時刻をあらわします。\r\n" }));
  }

  return {
    attach,
    create,
    load,
    poll,
    write,
    moveHere,
    rememberAll: async (getAll) => {
      const all = getAll();
      for (const key of new Set(months.map((m) => m.key))) await remember(key, all);
    },
    get ready() {
      return !!root;
    },
    get root() {
      return root;
    },
  };
}
