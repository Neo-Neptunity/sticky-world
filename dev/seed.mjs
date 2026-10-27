// 試験用の、にぎわっているワールド。8人が、2つの月にまたがって、話題・アイデア・書庫の本・返信・リアクション・直し・消しを残している。
// store は mod/store.js を読み込んだもの（node とブラウザで読み方がちがうので、外から渡す）。
export const FOLDER = "C:\\Users\\me\\OneDrive\\みんなの部屋";
export const FILES = ["企画書.docx", "議事録_10月.txt", "写真_文化祭.jpg", "予算.xlsx"];
export const PEOPLE = [
  { uid: "sakura", name: "さくら", color: "#d6409f", look: "usagi" },
  { uid: "kenta0", name: "けんた", color: "#0090ff", look: "inu" },
  { uid: "yui000", name: "ゆい", color: "#46a758", look: "neko" },
  { uid: "haruto", name: "はると", color: "#f76b15", look: "kuma" },
  { uid: "mio000", name: "みお", color: "#6e56cf", look: "hito" },
  { uid: "souta0", name: "そうた", color: "#12a594", look: "robo" },
  { uid: "aoi000", name: "あおい", color: "#e2a400", look: "neko" },
  { uid: "riku00", name: "りく", color: "#e5484d", look: "inu" },
];

const TALKS = [
  ["sakura", "来週の金曜、みんなでお昼に行きませんか？駅前の新しいカレー屋さんが気になってます🍛", ["kenta0", "行きたい！辛さ選べるといいな"], ["yui000", "金曜ならいけます"]],
  ["haruto", "共有フォルダの「議事録_10月.txt」更新しました。次回は木曜です", ["mio000", "ありがとう、読みました"]],
  ["mio000", "駐輪場の工事、今週いっぱいだそうです。裏口から回ってください"],
  ["souta0", "プリンターのトナー、替えておきました"],
  ["aoi000", "文化祭の写真、フォルダに入れました！"],
  ["riku00", "今日は雨なので、外の作業は明日にします"],
  ["kenta0", "企画書の2ページ目、意見ください🙏", ["sakura", "図があると分かりやすいかも"], ["haruto", "目次をつけたい"], ["aoi000", "いいと思う！"]],
];
const IDEAS = [
  ["sakura", "月に1回、もちよりランチ会", 0], ["kenta0", "共有カレンダーを作る", 1], ["yui000", "本棚に「おすすめの1冊」コーナー", 2],
  ["haruto", "会議は30分まで", 3], ["mio000", "朝のラジオ体操😆", 4], ["souta0", "植物を置く。サボテン？", 3],
  ["aoi000", "写真部をつくりたい", 0], ["riku00", "ゴミの分別ポスターを貼る", 2], ["sakura", "新しく来た人向けの案内を書庫にまとめる", 1],
  ["kenta0", "誕生日をお祝いする", 4], ["yui000", "おやつ当番", 0], ["mio000", "大掃除の日を決める", 2],
];
const SHELF = [
  ["手順", "コピー機の使い方", "1. 電源を入れる\n2. 部屋番号を入れる\n3. 終わったらログアウト", "souta0"],
  ["手順", "鍵の返し方", "最後に出る人は、職員室の箱へ。名前を書く", "mio000"],
  ["連絡先", "大家さん", "○○不動産 平日9時から17時まで", "haruto"],
  ["連絡先", "近所の病院", "□□クリニック 土曜も午前はやっています", "yui000"],
  ["決まりごと", "冷蔵庫のルール", "名前を書く。金曜にからっぽにする", "sakura"],
  ["決まりごと", "会議の進め方", "最初に今日決めることを言う。30分で終える", "haruto", "議事録_10月.txt"],
  ["資料", "企画書の最新版", "コメントは付箋の返信でどうぞ", "kenta0", "企画書.docx"],
  ["資料", "予算の表", "毎月25日に更新します", "riku00", "予算.xlsx"],
  ["資料", "文化祭の写真", "使うときは一言ください", "aoi000", "写真_文化祭.jpg"],
];
const TINTS = ["#fff1a8", "#ffd3dd", "#c9ecfb", "#d3f2c6", "#e6dbff"];

/** 出来事の一覧を作る。now は「今」（ミリ秒） */
export function seedEvents(store, now) {
  let r = 7;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const out = [];
  const add = (k, fields, uid, at) => {
    const ev = store.makeEvent(k, fields, { uid, now: at, rnd });
    if (!ev) throw new Error(`種の出来事の形が合いません ${k} ${JSON.stringify(fields)}`);
    out.push(ev);
    return ev;
  };
  const day = 86_400_000;
  PEOPLE.forEach((p, i) => add("hello", { name: p.name, color: p.color, look: p.look }, p.uid, now - 40 * day + i * 3600_000));
  // 話題：新しいものほど後ろ
  TALKS.forEach(([uid, text, ...replies], i) => {
    const at = now - (TALKS.length - i) * 0.9 * day - 3 * 3600_000;
    const n = add("note", { type: "talk", text, file: text.includes("議事録") ? "議事録_10月.txt" : text.includes("写真") ? "写真_文化祭.jpg" : "" }, uid, at);
    replies.forEach(([ru, rt], k) => add("note", { type: "talk", text: rt, re: n.id }, ru, at + (k + 1) * 40 * 60_000));
    PEOPLE.slice(0, (i * 3) % 7).forEach((p, k) => add("react", { target: n.id, e: ["👍", "❤️", "😂", "🎉"][k % 4], on: true }, p.uid, at + 90 * 60_000));
  });
  // アイデア：ボードに散らす
  const board = { x: 1660, y: 300, w: 620, h: 1000 };
  IDEAS.forEach(([uid, text, tint], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = board.x + 30 + col * 195 + Math.round((rnd() - 0.5) * 30);
    const y = board.y + 40 + row * 210 + Math.round((rnd() - 0.5) * 50);
    const n = add("note", { type: "idea", text, tint: TINTS[tint], x, y }, uid, now - 25 * day + i * 5 * 3600_000);
    PEOPLE.slice(0, (i * 5) % 6).forEach((p) => add("react", { target: n.id, e: "💡", on: true }, p.uid, now - 20 * day + i * 3600_000));
  });
  SHELF.forEach(([shelf, title, text, uid, file], i) => add("note", { type: "shelf", shelf, title, text, file: file || "" }, uid, now - 35 * day + i * day));
  // 直した・消した・取り消したリアクション
  const first = out.find((e) => e.k === "note" && e.type === "talk" && e.by === "souta0");
  add("edit", { target: first.id, text: "プリンターのトナー、替えておきました。予備は棚の上です" }, "souta0", first.at + 3600_000);
  const gone = add("note", { type: "talk", text: "まちがえて書きました" }, "riku00", now - 2 * day);
  add("del", { target: gone.id }, "riku00", now - 2 * day + 60_000);
  const fake = add("del", { target: first.id }, "kenta0", now - day);  // 他人の付箋は消せない
  void fake;
  return out;
}

/** 居場所：3人はいま、3人は少し前、残りは来ていない */
export function seedHere(now) {
  return [
    ["sakura", now - 20_000, 1150, 980], ["kenta0", now - 60_000, 1330, 900], ["yui000", now - 90_000, 1880, 760],
    ["haruto", now - 3 * 3600_000, 420, 760], ["mio000", now - 26 * 3600_000, 990, 1040], ["souta0", now - 5 * 86_400_000, 1760, 1180],
  ].map(([uid, at, x, y]) => ({ uid, at, x, y }));
}

/** 偽のフォルダに、ワールドを書き込む */
export function seedFs(fs, store, now, { world = true } = {}) {
  fs.mkdirp(FOLDER);
  for (const f of FILES) fs.add(`${FOLDER}\\${f}`, "file", "中身");
  if (!world) return [];
  const root = `${FOLDER}\\${store.DATA_DIR}`;
  fs.add(root, "folder");
  fs.add(`${root}\\はじめに.txt`, "file", "説明");
  const evs = seedEvents(store, now);
  for (const ev of evs) {
    const dir = `${root}\\${store.monthOf(ev.at)}`;
    if (!fs.get(dir)) fs.add(dir, "folder");
    fs.add(`${dir}\\${store.fileOf(ev.id)}`, "file", JSON.stringify(ev));
  }
  fs.add(`${root}\\${store.HERE_DIR}`, "folder");
  for (const h of seedHere(now)) fs.add(`${root}\\${store.HERE_DIR}\\${store.hereName(h.uid, h.at, h.x, h.y)}`, "file", "");
  return evs;
}
