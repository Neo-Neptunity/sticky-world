// 付箋ワールド — 画面を持たない部品の試験。node だけで動く。
//   使い方：node sticky-world/dev/unit.mjs
// 偽の本体（fake-host.mjs）で、共有フォルダを2人で使うところまで確かめる。
import fs from "node:fs";
import path from "node:path";
import { stage, MOD_DIR } from "./stage.mjs";
import { createFakeFs, createFakeEp } from "./fake-host.mjs";
import { seedFs, seedEvents, FOLDER, PEOPLE } from "./seed.mjs";

const st = stage("unit");
const S = await import(st.url("store.js"));
const W = await import(st.url("world.js"));
const { createSync } = await import(st.url("sync.js"));

let fail = 0, total = 0;
const ok = (cond, msg) => { total++; if (!cond) { fail++; console.log("  NG", msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}（${JSON.stringify(a)} ≠ ${JSON.stringify(b)}）`);
const section = (s) => console.log(s);
const NOW = Date.UTC(2026, 9, 26, 3, 0, 0);

// ---- 名前と ID ----------------------------------------------------------------
section("名前と ID");
{
  const id = S.newId(NOW, "abc123", () => 0.5);
  ok(/^[0-9a-z]{9}-abc123-[0-9a-z]{4}$/.test(id), `ID の形 ${id}`);
  eq(S.authorOf(id), "abc123", "ID から書いた人");
  eq(S.idOfFile(S.fileOf(id)), id, "ファイル名と ID の行き来");
  eq(S.idOfFile("abc.json"), null, "形の合わないファイル名は読まない");
  eq(S.idOfFile(`${id} (1).json`), null, "同期の重複ファイルは読まない");
  ok(S.newId(NOW, "a00000") < S.newId(NOW + 1000, "a00000"), "ID は時刻の順に並ぶ");
  eq(S.monthOf(Date.UTC(2026, 9, 31, 23, 59)), "2026-10", "月は世界時で決める");
  eq(S.monthOf(Date.UTC(2026, 10, 1, 0, 0)), "2026-11", "月の変わり目");
  ok(S.isMonthDir("2026-10") && S.isMonthDir("2026-10-DESKTOP-AB12") && !S.isMonthDir("here") && !S.isMonthDir("202610"), "月のフォルダの見分け");
  eq(S.monthKey("2026-10-DESKTOP-AB12"), "2026-10", "重複フォルダも同じ月");
  const hn = S.hereName("abc123", NOW, 1200.4, 990.6);
  eq(S.parseHere(hn), { uid: "abc123", at: NOW, x: 1200, y: 991 }, "居場所の名前の行き来");
  eq(S.parseHere(S.hereName("abc123", NOW, -50, 99999)), { uid: "abc123", at: NOW, x: 0, y: S.WORLD.h }, "居場所はワールドの中に収める");
  ok(!S.parseHere("abc123~x~1~2.txt.tmp") && !S.parseHere("abc123~kx~1~2 - コピー.txt"), "形の合わない居場所は読まない");
  ok(/^[0-9a-z]{6}$/.test(S.newUid()), "利用者の ID");
}

// ---- 確かめ ----------------------------------------------------------------
section("読んだ出来事の確かめ");
{
  const id = S.newId(NOW, "abc123");
  const base = { v: 1, id, at: NOW };
  ok(S.normalize({ ...base, k: "note", type: "talk", text: "やあ" }, id), "ふつうの話題");
  eq(S.normalize({ ...base, k: "note", type: "talk", text: "やあ", by: "zzzzzz" }, id).by, "abc123", "書いた人は中身ではなくファイル名で決める");
  eq(S.normalize({ ...base, id: S.newId(NOW, "zzzzzz"), k: "note", type: "talk", text: "x" }, id), null, "ファイル名と ID がちがえば捨てる");
  eq(S.normalize({ ...base, v: 2, k: "note", type: "talk", text: "x" }, id), null, "知らない版は捨てる");
  eq(S.normalize({ ...base, k: "note", type: "chat", text: "x" }, id), null, "知らない種類は捨てる");
  eq(S.normalize({ ...base, k: "note", type: "talk", text: "   " }, id), null, "空の付箋は捨てる");
  eq(S.normalize({ ...base, k: "note", type: "talk", text: 12 }, id), null, "文字でない本文は捨てる");
  eq(S.normalize({ ...base, k: "boom" }, id), null, "知らない出来事は捨てる");
  eq(S.normalize({ ...base, at: "きのう", k: "note", type: "talk", text: "x" }, id), null, "時刻が数でなければ捨てる");
  eq(S.normalize({ ...base, k: "note", type: "talk", text: "a\u0000b\u0007c\r\nd" }, id).text, "abc\nd", "制御文字は取りのぞく");
  eq(S.normalize({ ...base, k: "note", type: "talk", text: "あ".repeat(5000) }, id).text.length, S.LIMITS.text, "長すぎる本文は切る");
  eq(S.normalize({ ...base, k: "note", type: "talk", text: "<img src=x onerror=alert(1)>" }, id).text, "<img src=x onerror=alert(1)>", "HTML はただの文字として残す");
  eq(S.normalize({ ...base, k: "note", type: "talk", text: "x", file: "..\\..\\Windows\\a.exe" }, id).file, undefined, "パスを含むファイル名は添えない");
  eq(S.normalize({ ...base, k: "note", type: "talk", text: "x", re: "nope" }, id).re, undefined, "返信先の形が合わなければ、ふつうの話題");
  const idea = S.normalize({ ...base, k: "note", type: "idea", text: "x", x: 1e9, y: -5, tint: "red" }, id);
  ok(idea.x === S.WORLD.w && idea.y === 0 && idea.tint === S.TINTS[0], "アイデアの位置と色は決まった範囲に");
  const shelf = S.normalize({ ...base, k: "note", type: "shelf", title: "  鍵 \n の場所 ", text: "", shelf: "" }, id);
  ok(shelf && shelf.title === "鍵 の場所" && shelf.shelf === "いろいろ", "書庫：題名は1行、棚が無ければ「いろいろ」");
  eq(S.normalize({ ...base, k: "react", target: id, e: "💩" }, id), null, "決まった絵文字だけ");
  eq(S.normalize({ ...base, k: "hello", name: "", color: "#000000" }, id), null, "名前の無い名札は捨てる");
  const hello = S.normalize({ ...base, k: "hello", name: "あ  い", color: "javascript:", look: "dragon" }, id);
  ok(hello.name === "あ い" && hello.color === S.COLORS[0] && hello.look === S.LOOKS[0], "名札の色と姿は決まったものだけ");
  eq(S.parseEvent("{こわれた", S.fileOf(id)), null, "壊れた JSON は捨てる");
  eq(S.makeEvent("note", { type: "talk", text: "" }, { uid: "abc123" }), null, "空の付箋は書かない");
}

// ---- まとめ上げ ----------------------------------------------------------------
section("まとめ上げ");
const seeded = seedEvents(S, NOW);
{
  const st0 = S.fold(seeded);
  eq(st0.people.size, PEOPLE.length, "8人");
  eq(st0.people.get("sakura").name, "さくら", "名札");
  const feed = S.talkFeed(st0);
  ok(feed.length === 7, `広場の話題は7つ・返信と消した話題は数えない（${feed.length}）`);
  ok(feed.every((n, i) => i === 0 || feed[i - 1].touched >= n.touched), "広場は新しく動いた順");
  const printer = [...st0.notes.values()].find((n) => n.by === "souta0" && n.type === "talk");
  ok(printer.text.includes("予備は棚の上") && printer.edited, "本人の直しは効く");
  ok(!printer.deleted, "他人は消せない");
  ok([...st0.notes.values()].some((n) => n.deleted && n.by === "riku00"), "本人は消せる");
  const curry = feed.find((n) => n.text.includes("カレー"));
  eq(curry.replies.length, 2, "返信がつながる");
  eq(S.ideas(st0).length, 12, "アイデアは12枚");
  const groups = S.shelves(st0);
  eq(groups.map((g) => g.name), ["決まりごと", "資料", "手順", "連絡先"].sort((a, b) => a.localeCompare(b, "ja")), "棚は名前の順");
  ok(groups.every((g) => g.notes.length >= 2), "どの棚にも本がある");
  // 順番を入れかえても同じ結果
  const shuffled = [...seeded].sort(() => Math.random() - 0.5);
  const st1 = S.fold(shuffled);
  const pick = (s) => [...s.notes.values()].map((n) => [n.id, n.text, n.deleted, n.x, n.y, S.reactionCount(n), n.replies.length]).sort();
  eq(pick(st1), pick(st0), "ファイルを読む順に関係なく、同じワールドになる");
  // リアクションの取り消し・他人による移動・時計のずれ
  const n = S.ideas(st0)[0];
  const r1 = S.makeEvent("react", { target: n.id, e: "🎉", on: true }, { uid: "yui000", now: NOW + 1000 });
  const r2 = S.makeEvent("react", { target: n.id, e: "🎉", on: false }, { uid: "yui000", now: NOW + 2000 });
  const mv = S.makeEvent("move", { target: n.id, x: 2000, y: 900 }, { uid: "riku00", now: NOW + 3000 });
  const early = S.makeEvent("edit", { target: n.id, text: "先に直した" }, { uid: n.by, now: n.at - 60_000 });
  const st2 = S.fold([...seeded, r1, r2, mv, early]);
  const n2 = st2.notes.get(n.id);
  ok(!n2.reactions.has("🎉"), "リアクションは取り消せる");
  ok(n2.x === 2000 && n2.y === 900, "アイデアは誰でも動かせる");
  eq(n2.text, "先に直した", "時計がずれて、直しが付箋より前の時刻でも効く");
  eq(S.unread(st0, "sakura", NOW - 1.5 * 86_400_000), [...st0.notes.values()].filter((x) => !x.deleted && x.by !== "sakura" && x.at > NOW - 1.5 * 86_400_000).length, "自分以外の新しい付箋を数える");
  eq(S.unread(st0, "sakura", NOW + 1), 0, "見たあとは0");
}
{
  eq(S.timeAgo(NOW - 10_000, NOW), "たった今", "たった今");
  eq(S.timeAgo(NOW - 5 * 60_000, NOW), "5分前", "分");
  eq(S.timeAgo(NOW - 3 * 3600_000, NOW), "3時間前", "時間");
  eq(S.timeAgo(NOW - 30 * 3600_000, NOW), "昨日", "昨日");
  ok(/^\d+月\d+日$/.test(S.timeAgo(NOW - 5 * 86_400_000, NOW)), "それより前は日付");
}

// ---- 地図 ----------------------------------------------------------------
section("地図");
{
  eq(W.zoneAt(W.SPAWN.x, W.SPAWN.y), "talk", "最初は広場に立つ");
  eq(W.zoneAt(W.BOARD.x + 10, W.BOARD.y + 10), "idea", "ボードはアトリエの中");
  ok(W.SHELF_ROWS.every((r) => W.zoneAt(r.x + 5, r.y + 5) === "shelf" && W.zoneAt(r.x + r.w - 5, r.y + r.h - 5) === "shelf"), "棚は書庫の中");
  eq(W.zoneAt(1200, 1400), null, "道は場所の外");
  const zs = Object.values(W.ZONES);
  ok(zs.every((a) => zs.every((b) => a === b || a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)), "場所は重ならない");
  const d1 = W.decorations("みんなの部屋");
  eq(W.decorations("みんなの部屋"), d1, "同じフォルダなら同じ景色");
  ok(JSON.stringify(W.decorations("別の部屋")) !== JSON.stringify(d1), "フォルダがちがえば別の景色");
  ok(d1.filter((d) => d.kind === "tree" || d.kind === "bush" || d.kind === "flowers").every((d) => !W.zoneAt(d.x, d.y)), "木は場所の中に生えない");
  const c = W.clampToBoard(-100, 99999);
  ok(c.x >= W.BOARD.x && c.y + W.NOTE_H <= W.BOARD.y + W.BOARD.h, "付箋はボードの中に収める");
  const slots = W.shelfSlots(Array.from({ length: 9 }, (_, i) => ({ name: `棚${i}`, notes: [] })));
  ok(slots.length === 9 && slots.every((s) => s.w > 50 && W.zoneAt(s.x + 2, s.y + 2) === "shelf"), "棚がたくさんでも、書庫の中に並ぶ");
}

// ---- 共有フォルダ：2人で使う ----------------------------------------------------------------
section("共有フォルダ");
const tick = () => new Promise((r) => setTimeout(r, 5));
function person(fsys, uid, opts = {}) {
  const log = [];
  const ep = createFakeEp(fsys, FOLDER, { log, ...opts });
  const events = new Map();
  let here = [];
  const sync = createSync(ep, { onEvents: (evs) => evs.forEach((e) => events.set(e.id, e)), onHere: (l) => (here = l) });
  const snap = () => ({ id: fsys.get(FOLDER).id, path: FOLDER, name: "みんなの部屋", entries: fsys.list(FOLDER).map((n) => ({ id: n.id, name: n.name, path: n.path, kind: n.kind })) });
  return { ep, log, events, sync, snap, uid, get here() { return here; }, all: () => [...events.values()] };
}
{
  const fsys = createFakeFs();
  seedFs(fsys, S, NOW, { world: false });
  const a = person(fsys, "aaaaaa");
  ok(!a.sync.attach(a.snap()), "ワールドの無いフォルダ");
  await a.sync.create(a.snap());
  ok(fsys.get(`${FOLDER}\\${S.DATA_DIR}`) && fsys.get(`${FOLDER}\\${S.DATA_DIR}\\はじめに.txt`), "データのフォルダと説明を作る");
  ok(a.sync.attach(a.snap()), "作ったあとはワールドがある");
  await a.sync.load(a.all);
  const e1 = S.makeEvent("hello", { name: "Aさん", color: "#0090ff", look: "neko" }, { uid: "aaaaaa", now: NOW });
  const e2 = S.makeEvent("note", { type: "talk", text: "はじめまして" }, { uid: "aaaaaa", now: NOW + 1 });
  await a.sync.write(e1);
  await a.sync.write(e2);
  ok(fsys.get(`${FOLDER}\\${S.DATA_DIR}\\${S.monthOf(NOW)}\\${S.fileOf(e2.id)}`), "出来事は月のフォルダに1ファイル");
  // 2人目：開くと読める
  const b = person(fsys, "bbbbbb");
  ok(b.sync.attach(b.snap()), "2人目にもワールドが見える");
  await b.sync.load(b.all);
  ok(b.events.has(e1.id) && b.events.has(e2.id), "Aさんの付箋がBさんに届く");
  // 居場所：作って、あとは名前を変えるだけ
  await a.sync.moveHere("aaaaaa", 100, 200, []);
  const hereDir = `${FOLDER}\\${S.DATA_DIR}\\${S.HERE_DIR}`;
  eq(fsys.list(hereDir).length, 1, "居場所のファイルは1つ");
  for (let i = 0; i < 5; i++) await a.sync.moveHere("aaaaaa", 300 + i, 400, []);
  eq(fsys.list(hereDir).length, 1, "歩いてもファイルは増えない");
  ok(a.log.filter((l) => l.startsWith("rename")).length === 5, "名前を変えて知らせる");
  await b.sync.poll();
  const ah = b.here.find((x) => x.uid === "aaaaaa");
  ok(ah && ah.x === 304 && ah.y === 400, "Bさんから、Aさんの居場所が見える");
  // 新着：読んでいないファイルだけ読む
  const before = b.log.filter((l) => l.startsWith("readText")).length;
  const e3 = S.makeEvent("note", { type: "idea", text: "やってみたい", x: 1800, y: 600 }, { uid: "aaaaaa", now: NOW + 2 });
  await a.sync.write(e3);
  await b.sync.poll();
  eq(b.log.filter((l) => l.startsWith("readText")).length - before, 1, "新しい1つだけを読む");
  ok(b.events.has(e3.id), "新着が届く");
  await b.sync.poll();
  eq(b.log.filter((l) => l.startsWith("readText")).length - before, 1, "変わりが無ければ読まない");
  // 開き直し：覚えた分は読まない
  await b.sync.rememberAll(b.all);
  const b2 = person(fsys, "bbbbbb", { storage: b.ep.__store });
  b2.sync.attach(b2.snap());
  await b2.sync.load(b2.all);
  eq(b2.log.filter((l) => l.startsWith("readText")).length, 0, "開き直しても、覚えた月は読み直さない");
  eq(b2.events.size, b.events.size, "覚えた分から同じものが出る");
  // 同じ月のフォルダが同期で2つに分かれた
  const dup = `${FOLDER}\\${S.DATA_DIR}\\${S.monthOf(NOW)}-DESKTOP-X1`;
  fsys.add(dup, "folder");
  const e4 = S.makeEvent("note", { type: "talk", text: "別の PC から" }, { uid: "cccccc", now: NOW + 3 });
  fsys.add(`${dup}\\${S.fileOf(e4.id)}`, "file", JSON.stringify(e4));
  await b.sync.poll();
  ok(b.events.has(e4.id), "分かれた月のフォルダも読む");
  // 壊れたファイル・なりすまし
  const month = `${FOLDER}\\${S.DATA_DIR}\\${S.monthOf(NOW)}`;
  const spoofId = S.newId(NOW + 4, "aaaaaa");
  fsys.add(`${month}\\${S.fileOf(spoofId)}`, "file", JSON.stringify({ v: 1, id: S.newId(NOW + 4, "zzzzzz"), at: NOW, k: "del", target: e2.id }));
  fsys.add(`${month}\\${S.fileOf(S.newId(NOW + 5, "dddddd"))}`, "file", "{こわれた");
  const r0 = b.log.filter((l) => l.startsWith("readText")).length;
  await b.sync.poll();
  await b.sync.poll();
  eq(b.log.filter((l) => l.startsWith("readText")).length - r0, 2, "読めないファイルは1度だけ読んで、あとは飛ばす");
  ok(!S.fold(b.all()).notes.get(e2.id).deleted, "ID とファイル名の合わない出来事は効かない");
}
{
  // 読めないときは、あとで読み直す（3回まで）
  const fsys = createFakeFs();
  seedFs(fsys, S, NOW);
  let flaky = 0;
  const c = person(fsys, "cccccc", { failRead: (name) => name.includes("sakura") && flaky++ < 2 });
  c.sync.attach(c.snap());
  await c.sync.load(c.all);
  const missing = seeded.filter((e) => !c.events.has(e.id)).length;
  ok(missing > 0, `一時的に読めない出来事がある（${missing}）`);
  await c.sync.poll();
  await c.sync.poll();
  eq(seeded.filter((e) => !c.events.has(e.id)).length, 0, "読み直して、全部そろう");
  // 書けない（許可を断られた）
  c.ep.__grant(false);
  let code = "";
  try {
    await c.sync.write(S.makeEvent("note", { type: "talk", text: "x" }, { uid: "cccccc", now: NOW }));
  } catch (err) {
    code = err.code;
  }
  eq(code, "denied", "許可が無ければ denied");
  // 覚えておく場所がいっぱい
  const d = person(fsys, "dddddd", { storageLimit: 100 });
  d.sync.attach(d.snap());
  await d.sync.load(d.all);
  eq(d.events.size, seeded.length, "覚えられなくても、読み込みはできる");
  await tick();
}

// ---- manifest と、書き方の決まり ----------------------------------------------------------------
section("manifest と書き方");
{
  const manifest = JSON.parse(fs.readFileSync(path.join(MOD_DIR, "manifest.json"), "utf8"));
  ok(/^[a-z0-9][a-z0-9.-]{1,62}[a-z0-9]$/.test(manifest.id), "id の形");
  ok(manifest.location === "folder" && manifest.apiVersion === 1 && /^\d+\.\d+\.\d+$/.test(manifest.version), "フォルダを見るビュー");
  eq([...manifest.uses].sort(), ["createFiles", "entries", "fileContent", "tree"], "使う情報は必要なものだけ");
  ok(!manifest.network && !manifest.menu, "通信しない");
  ok(manifest.name.length <= 40 && manifest.description.length <= 200, `名前と説明の長さ（${manifest.description.length}）`);
  ok(manifest.settings.length <= 30 && manifest.settings.every((s) => s.label.length <= 40), "設定の数と見出し");

  const src = fs.readdirSync(MOD_DIR).filter((f) => f.endsWith(".js")).map((f) => [f, fs.readFileSync(path.join(MOD_DIR, f), "utf8")]);
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "")).join("\n");
  const banned = [/\.trash\(/, /ep\.net/, /\bfetch\(/, /readBytes\(/, /clipboard\./, /\.search\./, /createFolder\(/, /folderData/];
  for (const [f, t] of src) for (const b of banned) ok(!b.test(code(t)), `${f}: 消す・通信する・使わない機能の呼び出しがない ${b}`);
  const writers = src.filter(([, t]) => /files\.create|\.rename\(/.test(code(t))).map(([f]) => f);
  eq(writers, ["sync.js"], "ファイルを作る・名前を変えるのは sync.js だけ");
  for (const [f, t] of src) ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(code(t)), `${f}: 文字を HTML として入れない`);
  for (const [f, t] of src) ok(!/[（）]/.test(code(t)), `${f}: 画面の文章に括弧の注釈がない`);
}

console.log(fail ? `\n${fail}/${total} 件の失敗` : `\nすべて通りました（${total} 件）`);
process.exit(fail ? 1 : 0);
