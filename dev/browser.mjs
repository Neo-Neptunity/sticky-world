// 本物の index.js を、ヘッドレスの Edge で動かして、画面を撮る・操作する（偽の explorerPlus と、メモリの中の共有フォルダを渡す）。
//   使い方：node sticky-world/dev/browser.mjs [出力フォルダ] [--scenario=look|welcome|flow] [--w=1280 --h=760] [--dpr=1]
//   出力フォルダに PNG を書く。コンソールのエラーも出す。Edge が無ければ Chrome を使う
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOX = path.resolve(here, "..");
const args = process.argv.slice(2);
const outDir = path.resolve(args.find((a) => !a.startsWith("--")) || path.join(os.tmpdir(), "sw-shots"));
const opt = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
fs.mkdirSync(outDir, { recursive: true });
const scenario = opt.scenario || "look";

// ページ：偽のフォルダに種をまいてから、本物の index.js を読む。設定は # の後ろの JSON で渡す
const HARNESS = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<script type="module">
import { createFakeFs, createFakeEp } from "/dev/fake-host.mjs";
import { seedFs, FOLDER } from "/dev/seed.mjs";
import * as S from "/mod/store.js";
const cfg = JSON.parse(decodeURIComponent(location.hash.slice(1) || "{}"));
// 時刻をずらす（昼・夜の見た目をそろえるため）
if (cfg.hour !== undefined) {
  const real = Date.now();
  const d = new Date(real);
  d.setHours(cfg.hour, 10, 0, 0);
  const shift = d.getTime() - real;
  const orig = Date.now.bind(Date);
  Date.now = () => orig() + shift;
  const RD = Date;
  window.Date = class extends RD { constructor(...a) { super(...(a.length ? a : [orig() + shift])); } static now() { return orig() + shift; } };
}
const fsys = createFakeFs();
seedFs(fsys, S, Date.now(), { world: cfg.world !== false });
window.__fs = fsys;
window.__S = S;
window.__FOLDER = FOLDER;
window.__log = [];
const storage = cfg.named === false ? [] : [["me", { uid: "neo000", name: "ネオ", color: "#0090ff", look: "kuma" }]];
window.explorerPlus = createFakeEp(fsys, FOLDER, { log: window.__log, storage, settings: { pollSeconds: 3 }, menuChoice: cfg.menu ? (extra) => cfg.menu : null });
await import("/mod/index.js?debug");
</script></body></html>`;

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
  if (url === "/" || url === "/index.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end(HARNESS); }
  const m = /^\/(mod|dev)\/(.+)$/.exec(url);
  const f = m && path.join(BOX, m[1], m[2]);
  if (f && f.startsWith(BOX) && fs.existsSync(f)) { res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream", "cache-control": "no-store" }); return res.end(fs.readFileSync(f)); }
  res.writeHead(404); res.end("not found");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const exes = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const exe = exes.find((p) => fs.existsSync(p));
if (!exe) throw new Error("Edge も Chrome も見つかりません");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sw-edge-"));
const W = Number(opt.w || 1280), H = Number(opt.h || 760);
const dbg = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(exe, [
  "--headless=new", `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`,
  "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore" });
const cleanup = () => { try { proc.kill(); } catch { /* 終わっていた */ } try { server.close(); } catch { /* 閉じていた */ } try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 消せなくても困らない */ } };
process.on("exit", cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
const logs = [];
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
      const pg = list.find((t) => t.type === "page");
      if (pg) {
        ws = new WebSocket(pg.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (m) => {
          const d = JSON.parse(m.data);
          if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
          else if (d.method === "Runtime.consoleAPICalled") logs.push(`[${d.params.type}] ${d.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
          else if (d.method === "Runtime.exceptionThrown") logs.push(`[exception] ${d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text}`);
        };
        return;
      }
    } catch { /* まだ起動中 */ }
    await sleep(250);
  }
  throw new Error("ブラウザにつながりません");
}
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, (d) => (d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(r.data, "base64"));
  console.log("  shot", name);
};
const check = (cond, msg) => { console.log(cond ? "  ok" : "  NG", msg); if (!cond) process.exitCode = 1; };
const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error("見つかりません ${sel.replace(/"/g, "'")}"); el.click(); return true; })()`);
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const fileCount = () => ev(`[...window.__fs.nodes.values()].filter((n) => n.kind === "file" && n.name.endsWith(".json")).length`);
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
/** ワールドの点を、画面の点に */
const screenOf = (wx, wy) => ev(`window.__sw.render.toScreen(${wx}, ${wy})`);
/** 歩いて着くまで待つ */
async function walkTo(x, y) {
  await ev(`window.__sw.setTarget(${x}, ${y})`);
  for (let i = 0; i < 80; i++) {
    await sleep(100);
    const p = await ev(`({ x: window.__sw.pos.x, y: window.__sw.pos.y })`);
    if (Math.hypot(p.x - x, p.y - y) < 2) break;
  }
  await sleep(500);
}

async function boot(cfg = {}) {
  if (!ws) {
    await connect();
    await send("Runtime.enable");
    await send("Page.enable");
  }
  await send("Emulation.setDeviceMetricsOverride", { width: cfg.w || W, height: cfg.h || H, deviceScaleFactor: Number(opt.dpr || 1), mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/?r=${Math.random()}#${encodeURIComponent(JSON.stringify(cfg))}` });
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    if (await ev(`!!window.__sw && document.querySelector(".cover")?.hidden === true`).catch(() => false)) break;
  }
  await sleep(600);
}

const SCENARIOS = {
  /** 見た目：広場・アトリエ・カード・書庫・書く画面・名札・夜・狭い画面 */
  async look() {
    await boot({ hour: 13 });
    check(await ev(`window.__sw.zone`) === "talk", "最初は広場");
    check(await count(".panel .note") >= 7, "広場の欄に話題が並ぶ");
    check(await ev(`window.__sw.here.length`) === 6, "居場所が6人分読める");
    await shot("look-1-plaza");
    await walkTo(1960, 820);
    check(await ev(`window.__sw.zone`) === "idea", "アトリエに着いた");
    await shot("look-2-atelier");
    const n = await ev(`window.__sw.view.ideas[4]`);
    await ev(`window.__sw.render.cam.zoom = 1`);
    await click(`.panel .mini:nth-of-type(3)`);
    await sleep(400);
    check(await ev(`!document.querySelector(".card-layer").hidden`), "一覧から付箋のカードが開く");
    await shot("look-3-card");
    await ev(`document.querySelector(".card-layer .icon-btn").click()`);
    void n;
    await walkTo(440, 760);
    check(await ev(`window.__sw.zone`) === "shelf", "書庫に着いた");
    await shot("look-4-library");
    await click(`.dock-btn.primary`);
    await sleep(300);
    await shot("look-5-compose");
    await ev(`document.querySelector(".dialog .btn").click()`);
    await click(`.top-me`);
    await sleep(300);
    await shot("look-6-profile");
    await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })) || window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
    await boot({ hour: 21 });
    await walkTo(1200, 760);
    await shot("look-7-night");
    await boot({ hour: 13, w: 420, h: 820 });
    await shot("look-8-narrow");
  },

  /** はじめて：ワールドの無いフォルダ → 作る → 名札 → 入る */
  async welcome() {
    await connect();
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/#${encodeURIComponent(JSON.stringify({ world: false, named: false, hour: 10 }))}` });
    await sleep(1500);
    check(await count(".welcome .btn.primary") === 1, "はじめての画面");
    await shot("welcome-1");
    await click(".welcome .btn.primary");
    await sleep(800);
    check(await ev(`!!window.__fs.get(window.__FOLDER + "\\\\" + window.__S.DATA_DIR)`), "データのフォルダができた");
    check(await count(".dialog .looks") === 1, "名札を作る画面が出る");
    await shot("welcome-2-profile");
    await ev(`(() => { const i = document.querySelector(".dialog input"); i.value = "はじめて"; document.querySelectorAll(".dialog .look")[2].click(); document.querySelector(".dialog .btn.primary").click(); })()`);
    await sleep(800);
    check(await ev(`[...window.__sw.events.values()].some((e) => e.k === "hello" && e.name === "はじめて" && e.look === "usagi")`), "名札がワールドに書かれる");
    check(await ev(`window.__log.some((l) => l.startsWith("create ") && l.includes("~"))`), "居場所のファイルができる");
    check(await count(".panel .empty") === 1, "空の広場には、案内が出る");
    await shot("welcome-3-empty-world");
  },

  /** 操作：書く・リアクション・返信・直す・動かす・ボードに貼る・新着・居場所・書きかけを守る */
  async flow() {
    await boot({ hour: 13, menu: "edit" });
    const files0 = await fileCount();
    // 広場に書く
    await ev(`(() => { const t = document.querySelector(".panel .composer textarea"); t.value = "テストの話題です"; t.dispatchEvent(new Event("input")); })()`);
    await click(".panel .composer .btn.primary");
    await sleep(400);
    check(await fileCount() === files0 + 1, "書くと、ファイルが1つ増える");
    check(await ev(`document.querySelector(".panel .note .note-text").textContent`) === "テストの話題です", "広場のいちばん上に出る");
    // リアクション
    await click(".panel .note .react");
    await sleep(300);
    check(await ev(`document.querySelector(".panel .note .react.on") !== null`), "リアクションが付く");
    // 返信
    await click(".panel .note .link");
    await sleep(200);
    await ev(`(() => { const t = document.querySelector(".panel .note .composer textarea"); t.value = "返信のテスト"; t.dispatchEvent(new Event("input")); t.closest(".composer").querySelector(".btn.primary").click(); })()`);
    await sleep(400);
    check(await ev(`document.querySelector(".panel .note .replies .note-text")?.textContent`) === "返信のテスト", "返信が付く");
    // 直す（⋯ → 直す）
    await click(".panel .note .note-head .icon-btn");
    await sleep(300);
    await ev(`(() => { const t = document.querySelector(".dialog textarea"); t.value = "直した話題です"; document.querySelector(".dialog .btn.primary").click(); })()`);
    await sleep(400);
    check(await ev(`document.querySelector(".panel .note .note-text").textContent`) === "直した話題です", "直せる");
    // ほかの人の新着 → 届く・お知らせ・バッジ
    await ev(`(() => { const S = window.__S, e = S.makeEvent("note", { type: "idea", text: "外から届いたアイデア", x: 1700, y: 1150, tint: S.TINTS[2] }, { uid: "yui000" }); const dir = window.__FOLDER + "\\\\" + S.DATA_DIR + "\\\\" + S.monthOf(e.at); window.__fs.add(dir + "\\\\" + S.fileOf(e.id), "file", JSON.stringify(e)); })()`);
    // 書きかけ：新着で欄が作り直されても、カーソルと文字が残る
    await ev(`(() => { const t = document.querySelector(".panel .composer textarea"); t.focus(); t.value = "書きかけ"; t.dispatchEvent(new Event("input")); t.setSelectionRange(2, 2); })()`);
    await ev(`window.__sw.pollNow()`);
    await sleep(400);
    check(await ev(`window.__sw.view.ideas.some((n) => n.text === "外から届いたアイデア")`), "ほかの人の付箋が届く");
    check(await ev(`window.__log.some((l) => l.startsWith("toast ") && l.includes("ゆいさん"))`), "誰が貼ったかを知らせる");
    check(await ev(`document.activeElement?.tagName === "TEXTAREA" && document.activeElement.value === "書きかけ" && document.activeElement.selectionStart === 2`), "書きかけの欄はカーソルごと残る");
    await ev(`document.activeElement.blur()`);
    // アトリエ：ドラッグで動かす
    await ev(`window.__sw.render.cam.zoom = 1`);
    const n = await ev(`(() => { const n = window.__sw.view.ideas[4]; return { id: n.id, x: n.x, y: n.y }; })()`);
    await walkTo(n.x + 66, n.y + 200);
    const a = await screenOf(n.x + 40, n.y + 40);
    const under = await ev(`document.elementFromPoint(${a.x}, ${a.y})?.className`);
    check(under === "stage", `動かす付箋が、欄に隠れずに見えている：${under}・${Math.round(a.x)},${Math.round(a.y)}`);
    await mouse("mouseMoved", a.x, a.y, { buttons: 0 });
    await mouse("mousePressed", a.x, a.y);
    for (let i = 1; i <= 8; i++) await mouse("mouseMoved", a.x + i * 10, a.y + i * 6);
    await mouse("mouseReleased", a.x + 80, a.y + 48);
    await sleep(400);
    const moved = await ev(`[...window.__sw.events.values()].filter((e) => e.k === "move" && e.target === ${JSON.stringify(n.id)}).pop()`);
    check(moved && Math.abs(moved.x - (n.x + 80)) <= 2 && Math.abs(moved.y - (n.y + 48)) <= 2, "ドラッグで付箋を動かせる");
    // ボードをダブルクリックして貼る
    // 画面に見えていて、付箋の無いボードの点を探す
    const spot = await ev(`(() => {
      const sw = window.__sw, B = { x: 1660, y: 300, w: 620, h: 1000 };
      for (let wy = B.y + 60; wy < B.y + B.h - 60; wy += 20) for (let wx = B.x + 70; wx < B.x + B.w - 70; wx += 20) {
        const s = sw.render.toScreen(wx, wy);
        if (s.x < 40 || s.y < 90 || s.y > innerHeight - 110 || document.elementFromPoint(s.x, s.y)?.className !== "stage") continue;
        if ([-12, 0, 12].some((dx) => [-12, 0, 12].some((dy) => sw.render.hit(wx + dx, wy + dy)))) continue;
        return { x: s.x, y: s.y, wx, wy };
      }
      return null;
    })()`);
    check(!!spot, "ボードに空いている所がある");
    await mouse("mouseMoved", spot.x, spot.y, { buttons: 0 });
    for (const c of [1, 2]) {
      await mouse("mousePressed", spot.x, spot.y, { clickCount: c });
      await mouse("mouseReleased", spot.x, spot.y, { clickCount: c });
    }
    await sleep(400);
    check(await count(".dialog") === 1, "ダブルクリックで書く画面");
    await shot("flow-1-dblclick");
    await ev(`(() => { const t = document.querySelector(".dialog textarea"); t.value = "ここに貼った"; document.querySelector(".dialog .btn.primary").click(); })()`);
    await sleep(500);
    const placed = await ev(`window.__sw.view.ideas.find((n) => n.text === "ここに貼った")`);
    check(placed && Math.abs(placed.x + 66 - spot.wx) < 80 && Math.abs(placed.y + 54 - spot.wy) < 80, "押した所に貼られる");
    // 居場所：止まると名前を変えて知らせる
    await sleep(6500);
    check(await ev(`window.__log.some((l) => l.startsWith("rename neo000~"))`), "立ち止まると居場所を知らせる");
    const heres = await ev(`window.__fs.list(window.__FOLDER + "\\\\" + window.__S.DATA_DIR + "\\\\here").filter((n) => n.name.startsWith("neo000")).length`);
    check(heres === 1, "自分の居場所のファイルは1つだけ");
    // 消す
    await boot({ hour: 13, menu: "del" });
    await ev(`(() => { const t = document.querySelector(".panel .composer textarea"); t.value = "すぐ消す話題"; t.dispatchEvent(new Event("input")); })()`);
    await click(".panel .composer .btn.primary");
    await sleep(400);
    const before = await count(".panel > .panel-list > .note");
    await click(".panel .note .note-head .icon-btn");
    await sleep(500);
    check(await count(".panel > .panel-list > .note") === before - 1 && !(await ev(`document.querySelector(".panel").textContent.includes("すぐ消す話題")`)), "自分の話題を消せる");
    check(await ev(`window.__log.some((l) => l.startsWith("confirm "))`), "消す前に確かめる");
    await shot("flow-2-after");
  },
};

try {
  await SCENARIOS[scenario]();
} catch (e) {
  console.log("失敗:", e.message);
  process.exitCode = 1;
} finally {
  console.log(logs.length ? "コンソール:\n  " + logs.join("\n  ") : "コンソール: 出力なし");
  cleanup();
  process.exit(process.exitCode || 0);
}
