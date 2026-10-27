// 付箋ワールド — 共有フォルダを、みんなで付箋を貼り合うワールドにする（見下ろしの 2.5D）。
// 広場＝話題、アトリエ＝アイデアのボード、書庫＝残しておきたい情報。サーバーは使わず、データはフォルダの中に置いて同期で共有する。
// 書き込みは「出来事のファイルを新しく作る」と「自分の居場所のファイルの名前を変える」だけ。ほかのファイルにはさわらない。通信もしない。
import { makeEvent, fold, talkFeed, ideas, shelves, unread, reactionCount, timeAgo, newUid, COLORS, LOOKS, TYPE_LABEL } from "./store.js";
import { ZONES, BOARD, SPAWN, NOTE_W, NOTE_H, zoneAt, clampToWorld, clampToBoard, shelfSlots, decorations, rng } from "./world.js";
import { createSync } from "./sync.js";
import { createRender } from "./render.js";
import { createUi } from "./ui.js";

const ep = window.explorerPlus;
document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: new URL("./style.css", import.meta.url).href }));
const SPEED = 250;             // 歩く速さ（点/秒）。遠くへ行くときは速く
const ONLINE_MS = 3 * 60_000;  // 居場所がこれより新しければ「いる」
const GHOST_MS = 7 * 86_400_000; // これより古い居場所は描かない
const HEARTBEAT_MS = 90_000;
const HERE_MIN_MS = 5_000;

// ---- 状態 ----------------------------------------------------------------
await ep.ready();
let settings = await ep.settings.get();
ep.onSettings((next) => {
  settings = next;
  schedulePoll();
});

const me = await loadMe();
let folder = null;
let worldKey = "";
const events = new Map();
let state = fold([]);
let view = { talks: [], ideas: [], slots: [] };
let here = [];
let seen = 0;
let deco = [];
let entered = false;
let readOnly = false;

const pos = { x: SPAWN.x, y: SPAWN.y, dir: 0, moving: false };
let target = null;
let fast = false;
const keys = new Set();
const others = new Map();       // uid → 描く位置
let hover = null;
let focusId = null;
let drag = null;
let lastSent = { x: -1, y: -1, at: 0 };
let zone = null;
let pollTimer = 0;
let dirty = true;
let version = 0;                // 付箋が変わるたびに増やす（欄の作り直しはこれが変わったときだけ）
let ideaHint = null;

const ui = createUi(document.body, {
  goto, write, focus: focusNote, openFile, profile: editProfile,
  post, react, menu: noteMenu,
});
const render = createRender(ui.stage);
render.resize();
new ResizeObserver(() => render.resize()).observe(ui.stage);

const sync = createSync(ep, {
  onEvents: (evs) => {
    for (const e of evs) events.set(e.id, e);
    dirty = true;
  },
  onHere: (list) => {
    here = list;
    dirty = true;
  },
  onProgress: ({ done, total }) => {
    if (total && !entered) ui.loading(`ワールドを読み込んでいます ${done}/${total}`);
  },
});

ep.commands.set([{ id: "profile", label: "名札を変える" }, { id: "reload", label: "新着を確かめる" }]).catch(() => {});
ep.onCommand((id) => {
  if (id === "profile") editProfile();
  if (id === "reload") pollNow();
});

async function loadMe() {
  const saved = (await ep.storage.get("me").catch(() => null)) || {};
  const m = {
    uid: /^[0-9a-z]{6}$/.test(saved.uid) ? saved.uid : newUid(),
    name: typeof saved.name === "string" ? saved.name : "",
    color: COLORS.includes(saved.color) ? saved.color : COLORS[Math.floor(Math.random() * COLORS.length)],
    look: LOOKS.includes(saved.look) ? saved.look : LOOKS[Math.floor(Math.random() * LOOKS.length)],
  };
  if (m.uid !== saved.uid) await ep.storage.set("me", m).catch(() => {});
  return m;
}

// ---- フォルダ ----------------------------------------------------------------
ep.onFolder((f) => {
  const same = folder && folder.path === f.path;
  folder = f;
  if (same) {
    // 名前の変更（自分の居場所）や同期で中身が変わっただけ。ワールドがまだなら、同期で届いたかを見る
    if (!entered && sync.attach(f)) enter();
    dirty = true;
    return;
  }
  leave();
  deco = decorations(f.name);
  if (sync.attach(f)) enter();
  else showWelcome();
});

function showWelcome(message = "") {
  ui.onboarding(folder.name, {
    message,
    onCreate: async () => {
      try {
        await sync.create(folder);
        await enter();
      } catch (err) {
        console.warn("ワールドを作れませんでした", err.message);
        showWelcome(err.code === "denied" ? "ファイルを作る許可が無いので、作れませんでした。もう一度押すと、許可を聞きます" : `作れませんでした：${err.message}`);
      }
    },
  });
}

function leave() {
  entered = false;
  clearTimeout(pollTimer);
  events.clear();
  here = [];
  others.clear();
  state = fold([]);
  view = { talks: [], ideas: [], slots: [] };
  target = null;
  focusId = null;
  ui.showPanel(null);
  ui.closeCard();
}

async function enter() {
  const key = sync.root.id || sync.root.path.toLowerCase();
  worldKey = key;
  ui.loading("ワールドを読み込んでいます");
  try {
    await sync.load(() => [...events.values()]);
  } catch (err) {
    console.warn("ワールドを読み込めませんでした", err.message);
    ui.loading(null);
    return showWelcome(`読み込めませんでした：${err.message}`);
  }
  if (worldKey !== key) return;
  refold();
  seen = Number(await ep.storage.get(`seen:${key}`).catch(() => 0)) || 0;
  const mine = here.filter((h) => h.uid === me.uid).sort((a, b) => b.at - a.at)[0];
  Object.assign(pos, mine ? clampToWorld(mine.x, mine.y) : { x: SPAWN.x + (Math.random() - 0.5) * 120, y: SPAWN.y });
  render.jump(pos.x, pos.y);
  ui.hideCover();
  entered = true;
  if (!me.name) {
    const p = await ui.profile(me, { first: true });
    if (p) await saveMe(p);
  }
  await sayHello();
  sendHere(true);
  schedulePoll();
  if (seen === 0) markSeen();
}

/** 名札をこのワールドに知らせる（変わったときだけ、出来事を1つ書く） */
async function sayHello() {
  const p = state.people.get(me.uid);
  if (!me.name || (p && p.name === me.name && p.color === me.color && p.look === me.look)) return;
  await writeEvent("hello", { name: me.name, color: me.color, look: me.look });
}

async function saveMe(p) {
  Object.assign(me, p);
  await ep.storage.set("me", { ...me }).catch((err) => console.warn("名札を保存できませんでした", err.message));
}

async function editProfile() {
  const p = await ui.profile(me);
  if (!p) return;
  await saveMe(p);
  if (entered) await sayHello();
  dirty = true;
}

// ---- 新着 ----------------------------------------------------------------
function schedulePoll() {
  clearTimeout(pollTimer);
  if (!entered) return;
  const sec = Math.min(60, Math.max(3, Number(settings.pollSeconds) || 5));
  pollTimer = setTimeout(pollNow, document.hidden ? sec * 3000 : sec * 1000);
}

async function pollNow() {
  if (!entered) return;
  const before = new Set(events.keys());
  try {
    await sync.poll();
  } catch (err) {
    console.warn("新着を確かめられませんでした", err.message);
  }
  if (!entered) return;
  refold();
  const fresh = [...events.values()].filter((e) => !before.has(e.id) && e.k === "note" && e.by !== me.uid);
  if (fresh.length && !document.hidden) {
    const p = state.people.get(fresh[0].by);
    ep.ui.toast(fresh.length === 1 ? `${p?.name || "だれか"}さんが${TYPE_LABEL[fresh[0].type]}に貼りました` : `新しい付箋が ${fresh.length} 枚あります`).catch(() => {});
  }
  if (Date.now() - lastSent.at > HEARTBEAT_MS && !document.hidden) sendHere(true);
  schedulePoll();
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && entered) pollNow();
});

function refold() {
  state = fold([...events.values()]);
  const list = ideas(state).map((n) => ({ ...n, reacts: reactionCount(n), ...clampToBoard(n.x, n.y) }));
  view = { talks: talkFeed(state), ideas: list, slots: shelfSlots(shelves(state)) };
  version++;
  dirty = true;
  if (ui.panelZone && !document.hidden) markSeen();
}

function markSeen() {
  seen = Date.now();
  ep.storage.set(`seen:${worldKey}`, seen).catch(() => {});
}

/** 上の帯・欄・タブのバッジを今の状態に合わせる */
function publish() {
  const now = Date.now();
  const latest = new Map();
  for (const hh of here) if (!latest.has(hh.uid) || latest.get(hh.uid).at < hh.at) latest.set(hh.uid, hh);
  const people = [...state.people.values()].filter((p) => p.name !== "名なしさん" || p.posts).map((p) => {
    const hh = latest.get(p.uid);
    return { ...p, online: p.uid === me.uid ? entered : !!hh && now - hh.at < ONLINE_MS, seenAt: Math.max(p.last, hh?.at || 0) };
  });
  people.sort((a, b) => Number(b.online) - Number(a.online) || b.seenAt - a.seenAt);
  const count = unread(state, me.uid, seen);
  ui.setTop({
    world: folder?.name || "",
    people,
    online: people.filter((p) => p.online).length,
    status: readOnly ? "見るだけ" : "",
    unread: count,
    me,
  });
  ep.ui.tab({ badge: count ? String(count) : null }).catch(() => {});
  ui.update({ state, me: me.uid, people: state.people, files: folderFiles(), now, version });
}

const folderFiles = () => (folder?.entries || []).filter((e) => e.kind === "file" && !e.hidden && !e.name.startsWith(".")).map((e) => e.name);

// ---- 書く ----------------------------------------------------------------
async function writeEvent(k, fields) {
  const ev = makeEvent(k, fields, { uid: me.uid });
  if (!ev) throw Object.assign(new Error("形が合いません"), { code: "invalid" });
  await sync.write(ev);
  events.set(ev.id, ev);
  refold();
  return ev;
}

async function act(label, k, fields) {
  try {
    await writeEvent(k, fields);
    return true;
  } catch (err) {
    console.warn(`${label}できませんでした`, err.message);
    if (err.code === "denied") readOnly = true;
    ep.ui.toast(err.code === "denied" ? "ファイルを作る許可が無いので、見るだけになります" : `${label}できませんでした：${err.message}`).catch(() => {});
    publish();
    return false;
  }
}

async function post(fields) {
  if (!entered) return false;
  const f = { ...fields };
  if (f.type === "idea" && (typeof f.x !== "number" || typeof f.y !== "number")) Object.assign(f, freeSpot());
  const ok = await act("貼る", "note", f);
  if (ok && f.type === "idea" && zone !== "idea") ep.ui.toast("アトリエのボードに貼りました").catch(() => {});
  return ok;
}

/** アイデアを貼る場所：アトリエにいれば足もと、いなければボードの空いている所 */
function freeSpot() {
  if (zone === "idea") return clampToBoard(pos.x - NOTE_W / 2, pos.y - NOTE_H - 50);
  const rnd = rng(Date.now() >>> 0);
  let best = null;
  for (let i = 0; i < 24; i++) {
    const p = clampToBoard(BOARD.x + rnd() * BOARD.w, BOARD.y + rnd() * BOARD.h);
    const near = Math.min(Infinity, ...view.ideas.map((n) => Math.hypot(n.x - p.x, n.y - p.y)));
    if (!best || near > best.near) best = { ...p, near };
  }
  return { x: best.x, y: best.y };
}

async function write(type) {
  if (!entered) return;
  const v = await ui.compose({ type: type || (zone && ZONES[zone] ? zone : "talk") });
  if (v) await post(v);
}

function react(n, emoji, on) {
  return act("リアクション", "react", { target: n.id, e: emoji, on });
}

async function noteMenu(n, rect) {
  const { chosen } = await ep.showMenu({ x: rect.left, y: rect.bottom, items: [], extra: [{ id: "edit", label: "直す" }, { id: "del", label: "消す" }] }).catch(() => ({ chosen: null }));
  if (chosen === "edit") {
    const v = await ui.compose({ note: n });
    if (v) await act("直す", "edit", { target: n.id, text: v.text, title: v.title, shelf: v.shelf, file: v.file });
  } else if (chosen === "del") {
    const ok = await ep.ui.confirm("この付箋を消しますか？\nみんなの画面からも見えなくなります。", { okLabel: "消す" }).catch(() => false);
    if (ok) await act("消す", "del", { target: n.id });
  }
}

function openFile(name) {
  const e = (folder?.entries || []).find((x) => x.name === name);
  if (!e) return ep.ui.toast(`このフォルダに「${name}」が見つかりません`).catch(() => {});
  ep.open(e).catch((err) => console.warn("開けませんでした", err.message));
}

// ---- 歩く・見る ----------------------------------------------------------------
function goto(id) {
  const z = ZONES[id];
  if (!z) return;
  target = { x: z.x + z.w / 2, y: id === "talk" ? z.y + z.h - 80 : z.y + z.h / 2 };
  fast = true;
  if (zone === id) ui.showPanel(id);
}

function focusNote(id) {
  const n = state.notes.get(id);
  if (!n) return;
  if (n.type === "idea") {
    const v = view.ideas.find((x) => x.id === id);
    if (v) {
      target = clampToWorld(v.x + NOTE_W / 2, v.y + NOTE_H + 30);
      fast = true;
      focusId = id;
    }
  }
  ui.openCard(n);
}

// キーは、ワールドを見ているときだけ受ける（欄のボタンや入力の Enter と取り合わない）
const typing = (e) => (e.target !== document.body && e.target !== ui.stage) || ui.busy;
window.addEventListener("keydown", (e) => {
  if (typing(e)) return;
  const k = e.key.toLowerCase();
  if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
    keys.add(k);
    target = null;
    e.preventDefault();
  } else if (k === "escape") {
    if (ui.cardOpen) ui.closeCard();
    else ui.showPanel(null);
  } else if (k === "n" || k === "enter") {
    e.preventDefault();
    write();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());

const stage = ui.stage;
let press = null;
stage.addEventListener("pointerdown", (e) => {
  if (!entered || e.button !== 0) return;
  stage.focus();
  const w = render.toWorld(e.offsetX, e.offsetY);
  const hit = render.hit(w.x, w.y);
  press = { sx: e.offsetX, sy: e.offsetY, w, hit, moved: false };
  if (hit?.kind === "note") {
    const n = view.ideas.find((x) => x.id === hit.id);
    press.off = { x: w.x - n.x, y: w.y - n.y };
    stage.setPointerCapture(e.pointerId);
  }
});
stage.addEventListener("pointermove", (e) => {
  const w = render.toWorld(e.offsetX, e.offsetY);
  if (press && Math.hypot(e.offsetX - press.sx, e.offsetY - press.sy) > 6) press.moved = true;
  if (press?.hit?.kind === "note" && press.moved && !readOnly) {
    drag = { id: press.hit.id, ...clampToBoard(w.x - press.off.x, w.y - press.off.y) };
    stage.style.cursor = "grabbing";
    return;
  }
  const hit = entered ? render.hit(w.x, w.y) : null;
  hover = hit?.id || null;
  stage.style.cursor = hit ? "pointer" : "default";
});
stage.addEventListener("pointerup", (e) => {
  const p = press;
  press = null;
  if (!p) return;
  if (drag) {
    const d = drag;
    drag = null;
    stage.style.cursor = "default";
    const n = view.ideas.find((x) => x.id === d.id);
    if (n && (Math.abs(n.x - d.x) > 2 || Math.abs(n.y - d.y) > 2)) {
      n.x = d.x;
      n.y = d.y;
      act("動かす", "move", { target: d.id, x: d.x, y: d.y });
    }
    return;
  }
  if (p.moved) return;
  const hit = p.hit;
  if (hit?.kind === "note") return focusNote(hit.id);
  if (hit?.kind === "notice") {
    goto("talk");
    return ui.showPanel("talk");
  }
  if (hit?.kind === "shelf") {
    ui.showPanel("shelf");
    return setTimeout(() => document.querySelector(`[data-shelf="${CSS.escape(hit.name)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 0);
  }
  if (hit?.kind === "person") return showPerson(hit.uid);
  target = clampToWorld(p.w.x, p.w.y);
  fast = Math.hypot(target.x - pos.x, target.y - pos.y) > 700;
});
stage.addEventListener("dblclick", async (e) => {
  if (!entered) return;
  const w = render.toWorld(e.offsetX, e.offsetY);
  if (render.hit(w.x, w.y)) return;
  if (w.x < BOARD.x || w.x > BOARD.x + BOARD.w || w.y < BOARD.y || w.y > BOARD.y + BOARD.h) return;
  const at = clampToBoard(w.x - NOTE_W / 2, w.y - NOTE_H / 2);
  target = null;
  ideaHint = at;
  const v = await ui.compose({ type: "idea", title: "ここにアイデアを貼る" });
  ideaHint = null;
  if (v) await post({ ...v, type: v.type, ...(v.type === "idea" ? at : {}) });
});
stage.addEventListener("wheel", (e) => {
  e.preventDefault();
  render.cam.zoom = Math.min(1.8, Math.max(0.45, render.cam.zoom * Math.exp(-e.deltaY * 0.0012)));
}, { passive: false });

function showPerson(uid) {
  const p = state.people.get(uid);
  const hh = here.filter((x) => x.uid === uid).sort((a, b) => b.at - a.at)[0];
  if (!p) return;
  const now = Date.now();
  ui.person(p, hh && now - hh.at < ONLINE_MS ? "いま、このワールドにいます" : hh ? `最後に来たのは ${timeAgo(hh.at, now)}` : "");
}

/** 立ち止まったら、居場所を知らせる（すぐには送らない。名前の変更を減らす） */
function sendHere(force = false) {
  if (!entered || readOnly) return;
  const now = Date.now();
  if (!force && (now - lastSent.at < HERE_MIN_MS || Math.hypot(pos.x - lastSent.x, pos.y - lastSent.y) < 24)) return;
  lastSent = { x: pos.x, y: pos.y, at: now };
  sync.moveHere(me.uid, pos.x, pos.y, here).catch((err) => {
    console.warn("居場所を知らせられませんでした", err.message);
    if (err.code === "denied") readOnly = true;
  });
}

// ---- 毎コマ ----------------------------------------------------------------
let prev = performance.now();
let stillFor = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - prev) / 1000);
  prev = t;
  if (entered) step(dt);
  if (dirty) {
    dirty = false;
    publish();
  }
  if (!document.hidden && entered) {
    const now = Date.now();
    // 欄に隠れないように、カメラを欄の反対側へずらす
    const box = ui.panelBox();
    const z = render.cam.zoom;
    render.follow(pos.x + (box && !box.bottom ? (box.w + 10) / 2 / z : 0), pos.y + (box && box.bottom ? (box.h + 20) / 2 / z : 0), dt);
    render.draw({
      time: t, now, deco, seedKey: folder?.path || "", people: state.people,
      ideas: view.ideas, talks: view.talks, slots: view.slots,
      others: othersFrame(now, dt), me: { ...pos, name: me.name || "わたし", color: me.color, look: me.look, online: true },
      hover, focus: focusId, drag, target, zone, ideaHint,
    });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function step(dt) {
  let vx = 0;
  let vy = 0;
  if (keys.has("a") || keys.has("arrowleft")) vx -= 1;
  if (keys.has("d") || keys.has("arrowright")) vx += 1;
  if (keys.has("w") || keys.has("arrowup")) vy -= 1;
  if (keys.has("s") || keys.has("arrowdown")) vy += 1;
  let speed = SPEED;
  if (!vx && !vy && target) {
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    const dist = Math.hypot(dx, dy);
    speed = fast ? SPEED * 2.4 : SPEED;
    if (dist < speed * dt + 1) {
      Object.assign(pos, target);
      target = null;
      fast = false;
    } else {
      vx = dx / dist;
      vy = dy / dist;
    }
  }
  const len = Math.hypot(vx, vy);
  pos.moving = len > 0;
  if (len) {
    const next = clampToWorld(pos.x + (vx / len) * speed * dt, pos.y + (vy / len) * speed * dt);
    pos.x = next.x;
    pos.y = next.y;
    if (Math.abs(vx) > 0.2) pos.dir = Math.sign(vx);
    stillFor = 0;
  } else {
    stillFor += dt;
    if (stillFor > 1.2) sendHere();
  }
  const z = zoneAt(pos.x, pos.y);
  if (z !== zone) {
    zone = z;
    ui.showPanel(z);
    if (z) markSeen();
    dirty = true;
  }
}

/** ほかの人：居場所のファイルの位置へ、歩いて近づける（同期は飛び飛びに届くので） */
function othersFrame(now, dt) {
  const latest = new Map();
  for (const hh of here) {
    if (hh.uid === me.uid || now - hh.at > GHOST_MS) continue;
    if (!latest.has(hh.uid) || latest.get(hh.uid).at < hh.at) latest.set(hh.uid, hh);
  }
  const out = [];
  for (const [uid, hh] of latest) {
    let o = others.get(uid);
    if (!o) {
      o = { x: hh.x, y: hh.y, dir: 0 };
      others.set(uid, o);
    }
    const dx = hh.x - o.x;
    const dy = hh.y - o.y;
    const dist = Math.hypot(dx, dy);
    const move = Math.min(dist, SPEED * 1.2 * dt);
    if (dist > 0.5) {
      o.x += (dx / dist) * move;
      o.y += (dy / dist) * move;
      if (Math.abs(dx) > 2) o.dir = Math.sign(dx);
    }
    const p = state.people.get(uid);
    const online = now - hh.at < ONLINE_MS;
    out.push({ uid, x: o.x, y: o.y, dir: o.dir, moving: dist > 2, name: p?.name || "名なしさん", color: p?.color || "#888888", look: p?.look || "hito", online, ago: timeAgo(hh.at, now) });
  }
  return out;
}

// 試験の道具から中を見る
if (new URL(import.meta.url).searchParams.has("debug")) {
  window.__sw = { me, pos, events, get state() { return state; }, get view() { return view; }, get zone() { return zone; }, get here() { return here; }, pollNow, render, goto, post, write, react, setTarget: (x, y) => { target = { x, y }; fast = true; } };
}
