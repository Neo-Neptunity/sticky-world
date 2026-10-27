// 画面の部品（DOM）：上の帯・場所ごとの欄・付箋のカード・書く画面・名札の設定・はじめての画面。
// ほかの人が書いた文字は、必ず textContent で入れる（HTML として読まない）。
import { EMOJI, COLORS, LOOKS, LOOK_LABEL, TINTS, LIMITS, TYPE_LABEL, talkFeed, ideas, shelves, reactionCount, timeAgo } from "./store.js";

const LOOK_ICON = { neko: "🐱", inu: "🐶", usagi: "🐰", kuma: "🐻", hito: "🙂", robo: "🤖" };

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

export function createUi(root, act) {
  root.replaceChildren();
  const stage = h("canvas", { class: "stage", tabindex: "0" });
  const top = h("header", { class: "top" });
  const panel = h("aside", { class: "panel", hidden: true });
  const dock = h("nav", { class: "dock" });
  const card = h("div", { class: "card-layer", hidden: true });
  const modal = h("div", { class: "modal-layer", hidden: true });
  const cover = h("div", { class: "cover", hidden: true });
  root.append(h("div", { class: "app" }, stage, top, panel, dock, card, modal, cover));

  let data = null;             // { state, me, people, files, now, here }
  let panelZone = null;
  let openReply = null;        // 返信の欄を開いている話題
  let replyJustOpened = false;
  const drafts = new Map();    // 書きかけ：欄ごと
  let search = "";
  let ideaOrder = "new";

  // ---- 下の帯：場所へ行く・書く ----------------------------------------------------------------
  for (const [id, icon] of [["talk", "⛲"], ["idea", "🎨"], ["shelf", "📚"]]) {
    dock.append(h("button", { class: "dock-btn", "data-zone": id, title: `${TYPE_LABEL[id]}へ行く`, onclick: () => act.goto(id) }, h("span", { class: "dock-icon", text: icon }), h("span", { text: TYPE_LABEL[id] })));
  }
  dock.append(h("button", { class: "dock-btn primary", title: "付箋を書く", onclick: () => act.write() }, h("span", { class: "dock-icon", text: "✎" }), h("span", { text: "書く" })));

  // ---- 上の帯 ----------------------------------------------------------------
  function setTop({ world, people, online, status, unread, me }) {
    const parts = [
      h("div", { class: "top-world" }, h("span", { class: "top-logo", text: "🌳" }), h("span", { class: "top-name", text: world })),
      h("div", { class: "top-people", title: "このワールドに来たことのある人" },
        ...people.slice(0, 8).map((p) => h("span", { class: `chip-person${p.online ? " on" : ""}`, style: `--c:${p.color}`, title: p.name, text: LOOK_ICON[p.look] || "🙂" })),
        h("span", { class: "top-count", text: online ? `いま ${online}人・みんなで ${people.length}人` : `みんなで ${people.length}人` })),
      h("div", { class: "top-status", text: status || "" }),
      unread ? h("button", { class: "top-unread", onclick: () => act.goto("talk"), text: `新着 ${unread}` }) : null,
      h("button", { class: "top-me", title: "名札を変える", onclick: () => act.profile() },
        h("span", { class: "chip-person on", style: `--c:${me.color}`, text: LOOK_ICON[me.look] || "🙂" }), h("span", { text: me.name })),
    ];
    top.replaceChildren(...parts.filter(Boolean));  // replaceChildren は null を「null」という文字にしてしまう
  }

  /** 欄が見えていれば、その大きさと置き場所。狭い画面では下に出る */
  function panelBox() {
    if (panel.hidden) return null;
    const r = panel.getBoundingClientRect();
    return { w: r.width, h: r.height, bottom: r.left < 40 };
  }

  // ---- 場所ごとの欄 ----------------------------------------------------------------
  function showPanel(zone) {
    if (zone === panelZone) return;
    panelZone = zone;
    for (const b of dock.querySelectorAll("[data-zone]")) b.classList.toggle("here", b.dataset.zone === zone);
    if (!zone) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    renderPanel(true);
  }

  function update(next) {
    const changed = !data || data.version !== next.version || data.files.length !== next.files.length;
    data = next;
    if (!changed) return;
    if (panelZone) renderPanel(false);
    if (!card.hidden && card.dataset.id) {
      const n = data.state.notes.get(card.dataset.id);
      if (n && !n.deleted) openCard(n, { keep: true });
      else closeCard();
    }
  }

  function renderPanel(fresh) {
    if (!data || !panelZone) return;
    const list = panel.querySelector(".panel-list");
    const scroll = list && !fresh ? list.scrollTop : 0;
    // 書いている途中の欄は、作り直してもカーソルを戻す
    const active = panel.contains(document.activeElement) ? document.activeElement : null;
    const keep = active?.dataset.key ? { key: active.dataset.key, a: active.selectionStart, b: active.selectionEnd } : null;
    const zone = panelZone;
    const head = h("div", { class: "panel-head" },
      h("div", { class: "panel-title" }, h("b", { text: TYPE_LABEL[zone] }), h("span", { class: "dim", text: { talk: "みんなの話題", idea: "アイデアを貼るボード", shelf: "残しておきたい情報の置き場" }[zone] })),
      h("button", { class: "icon-btn", title: "閉じる", onclick: () => showPanel(null), text: "×" }));
    let body;
    if (zone === "talk") body = talkPanel();
    else if (zone === "idea") body = ideaPanel();
    else body = shelfPanel();
    panel.replaceChildren(head, ...body);
    const nl = panel.querySelector(".panel-list");
    if (nl) nl.scrollTop = scroll;
    if (keep) {
      const el = [...panel.querySelectorAll("[data-key]")].find((x) => x.dataset.key === keep.key);
      if (el) {
        el.focus();
        if (keep.a !== null && keep.a !== undefined) el.setSelectionRange(keep.a, keep.b);
      }
    }
  }

  function composer(key, { placeholder, rows = 3, extra = [], submit, label = "貼る" }) {
    const ta = h("textarea", { class: "input", rows, maxlength: LIMITS.text, placeholder, "data-key": key });
    ta.value = drafts.get(key) || "";
    ta.addEventListener("input", () => drafts.set(key, ta.value));
    const send = async () => {
      const text = ta.value.trim();
      if (!text) return ta.focus();
      const ok = await submit(text);
      if (ok !== false) {
        drafts.delete(key);
        ta.value = "";
      }
    };
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        send();
      }
    });
    return h("div", { class: "composer" }, ta, h("div", { class: "composer-row" }, ...extra, h("span", { class: "grow" }), h("span", { class: "dim small", text: "Ctrl+Enter" }), h("button", { class: "btn primary", onclick: send, text: label })));
  }

  function fileSelect(value = "") {
    const files = data?.files || [];
    const sel = h("select", { class: "input select", title: "このフォルダのファイルを添える" }, h("option", { value: "", text: "ファイルを添えない" }), ...files.map((f) => h("option", { value: f, text: `📎 ${f}` })));
    if (value && !files.includes(value)) sel.append(h("option", { value, text: `📎 ${value}` }));
    sel.value = value;
    return sel;
  }

  function talkPanel() {
    const file = fileSelect();
    const comp = composer("talk", { placeholder: "みんなに話したいこと・お知らせ", extra: [file], submit: (text) => act.post({ type: "talk", text, file: file.value }) });
    const feed = talkFeed(data.state);
    const list = h("div", { class: "panel-list" }, ...(feed.length ? feed.map((n) => talkCard(n)) : [empty("まだ話題はありません。最初のひとことを貼ってみましょう")]));
    return [comp, list];
  }

  function talkCard(n) {
    const el = noteView(n, { compact: false });
    const replies = n.replies.filter((r) => !r.deleted);
    if (replies.length) el.append(h("div", { class: "replies" }, ...replies.map((r) => noteView(r, { reply: true }))));
    if (!n.deleted) {
      if (openReply === n.id) {
        const box = composer(`re:${n.id}`, { placeholder: "返信を書く", rows: 2, label: "返信", submit: (text) => act.post({ type: "talk", text, re: n.id }).then((ok) => { if (ok !== false) openReply = null; return ok; }) });
        el.append(box);
        if (replyJustOpened) {
          replyJustOpened = false;
          setTimeout(() => box.querySelector("textarea")?.focus(), 0);
        }
      } else el.append(h("button", { class: "link", onclick: () => { openReply = n.id; replyJustOpened = true; rerender(); }, text: replies.length ? `返信する・${replies.length}件` : "返信する" }));
    }
    return el;
  }

  function ideaPanel() {
    let tint = drafts.get("idea-tint") || TINTS[0];
    const swatches = h("div", { class: "swatches" }, ...TINTS.map((c) => h("button", { class: `swatch${c === tint ? " on" : ""}`, style: `--c:${c}`, title: "付箋の色", onclick: (e) => { tint = c; drafts.set("idea-tint", c); for (const b of swatches.children) b.classList.toggle("on", b === e.currentTarget); } })));
    const comp = composer("idea", { placeholder: "思いついたこと。ひとことでも", rows: 2, extra: [swatches], submit: (text) => act.post({ type: "idea", text, tint }) });
    const list = ideas(data.state);
    if (ideaOrder === "popular") list.sort((a, b) => reactionCount(b) - reactionCount(a) || b.at - a.at);
    else list.reverse();
    const order = h("div", { class: "tabs" }, ...[["new", "新しい順"], ["popular", "人気の順"]].map(([id, label]) => h("button", { class: `tab${ideaOrder === id ? " on" : ""}`, onclick: () => { ideaOrder = id; renderPanel(false); }, text: label })));
    return [
      h("p", { class: "hint", text: "ボードをダブルクリックすると、その場所に貼れます。付箋はドラッグで動かせます" }),
      comp,
      order,
      h("div", { class: "panel-list" }, ...(list.length ? list.map((n) => mini(n)) : [empty("まだアイデアはありません")])),
    ];
  }

  function shelfPanel() {
    const q = h("input", { class: "input", type: "search", placeholder: "書庫の中を探す", value: search, "data-key": "search" });
    q.addEventListener("input", () => {
      search = q.value;
      renderPanel(false);
    });
    const groups = shelves(data.state);
    const word = search.trim().toLowerCase();
    const match = (n) => !word || `${n.title}\n${n.text}\n${n.shelf}\n${n.file}`.toLowerCase().includes(word);
    const blocks = groups.map((g) => ({ ...g, notes: g.notes.filter(match) })).filter((g) => g.notes.length);
    return [
      h("div", { class: "composer-row" }, q, h("button", { class: "btn primary", onclick: () => act.write("shelf"), text: "本を置く" })),
      h("div", { class: "panel-list" }, ...(blocks.length
        ? blocks.map((g) => h("section", { class: "shelf-group", "data-shelf": g.name }, h("h3", { text: `${g.name}・${g.notes.length}` }), ...g.notes.map((n) => mini(n))))
        : [empty(word ? "見つかりませんでした" : "まだ本はありません。残しておきたい情報を置いてみましょう")])),
    ];
  }

  function empty(text) {
    return h("p", { class: "empty", text });
  }

  /** 一覧の小さな行（押すとカードを開く） */
  function mini(n) {
    const p = data.people.get(n.by);
    const r = reactionCount(n);
    return h("button", { class: "mini", style: `--tint:${n.tint || "#f4ead2"}`, onclick: () => act.focus(n.id) },
      h("span", { class: "mini-title", text: n.type === "shelf" ? n.title || firstLine(n.text) : firstLine(n.text) }),
      n.type === "shelf" && n.text ? h("span", { class: "mini-sub", text: firstLine(n.text) }) : null,
      h("span", { class: "mini-meta" }, h("i", { class: "dot", style: `--c:${p?.color}` }), `${p?.name || ""}・${timeAgo(n.at, data.now)}`, r ? `・♥ ${r}` : "", n.file ? "・📎" : ""));
  }

  /** 付箋1枚の見た目（欄の中とカードで同じもの） */
  function noteView(n, { reply = false, big = false } = {}) {
    const p = data.people.get(n.by);
    const mine = n.by === data.me;
    const el = h("article", { class: `note${reply ? " reply" : ""}${big ? " big" : ""}`, "data-id": n.id });
    if (n.deleted) {
      el.append(h("p", { class: "dim", text: "この話題は消されました" }));
      return el;
    }
    el.append(h("header", { class: "note-head" },
      h("span", { class: "chip-person", style: `--c:${p?.color}`, text: LOOK_ICON[p?.look] || "🙂" }),
      h("b", { text: p?.name || "" }),
      h("span", { class: "dim small", text: `${timeAgo(n.at, data.now)}${n.edited ? "・直しました" : ""}` }),
      h("span", { class: "grow" }),
      mine ? h("button", { class: "icon-btn", title: "直す・消す", text: "⋯", onclick: (e) => act.menu(n, e.currentTarget.getBoundingClientRect()) }) : null));
    if (n.type === "shelf") el.append(h("h4", { class: "note-title", text: n.title }), h("div", { class: "dim small", text: `棚：${n.shelf}` }));
    if (n.text) el.append(h("p", { class: "note-text", text: n.text }));
    if (n.file) el.append(h("button", { class: "file-chip", title: "このファイルを開く", onclick: () => act.openFile(n.file), text: `📎 ${n.file}` }));
    el.append(reactions(n));
    return el;
  }

  function reactions(n) {
    const row = h("div", { class: "reacts" });
    for (const e of EMOJI) {
      const set = n.reactions.get(e);
      const mine = !!set && set.has(data.me);
      const count = set ? set.size : 0;
      const names = set ? [...set].map((u) => data.people.get(u)?.name || "").join("、") : "";
      row.append(h("button", { class: `react${mine ? " on" : ""}${count ? "" : " zero"}`, title: names || "リアクション", onclick: () => act.react(n, e, !mine) }, e, count ? h("span", { text: String(count) }) : null));
    }
    return row;
  }

  // ---- カード（付箋を大きく見る） ----------------------------------------------------------------
  /** 返信の欄を開いたときなど：欄とカードの両方を描き直す */
  function rerender() {
    if (panelZone) renderPanel(false);
    const id = card.hidden ? null : card.dataset.id;
    const n = id && data.state.notes.get(id);
    if (n) openCard(n, { keep: true });
  }

  function openCard(n, { keep = false } = {}) {
    if (!data) return;
    const scroll = keep ? card.querySelector(".card")?.scrollTop : 0;
    card.dataset.id = n.id;
    card.hidden = false;
    const body = n.type === "talk" && !n.re ? talkCard(n) : noteView(n, { big: true });
    const box = h("div", { class: "card", style: `--tint:${n.tint || "#ffffff"}` }, h("div", { class: "card-kind" }, h("span", { text: TYPE_LABEL[n.type] }), h("button", { class: "icon-btn", title: "閉じる", onclick: closeCard, text: "×" })), body);
    card.replaceChildren(box);
    if (scroll) box.scrollTop = scroll;
  }
  function closeCard() {
    card.hidden = true;
    delete card.dataset.id;
    card.replaceChildren();
  }
  card.addEventListener("pointerdown", (e) => {
    if (e.target === card) closeCard();
  });

  function person(p, info) {
    card.hidden = false;
    card.dataset.id = "";
    card.replaceChildren(h("div", { class: "card person" },
      h("div", { class: "card-kind" }, h("span", { text: "名札" }), h("button", { class: "icon-btn", title: "閉じる", onclick: closeCard, text: "×" })),
      h("div", { class: "person-face", style: `--c:${p.color}`, text: LOOK_ICON[p.look] || "🙂" }),
      h("h3", { text: p.name }),
      h("p", { class: "dim", text: info }),
      h("p", { text: `貼った付箋：${p.posts}枚` })));
  }

  // ---- 書く画面・名札・はじめて ----------------------------------------------------------------
  /** 小さな画面を出して、閉じたら値を返す（やめたら null） */
  function dialog(build) {
    return new Promise((resolve) => {
      const done = (v) => {
        modal.hidden = true;
        modal.replaceChildren();
        window.removeEventListener("keydown", onKey, true);
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          done(null);
        }
      };
      window.addEventListener("keydown", onKey, true);
      modal.hidden = false;
      const box = build(done);
      modal.replaceChildren(box);
      setTimeout(() => box.querySelector("textarea, input")?.focus(), 0);
    });
  }

  /** 付箋を書く・直す。type を決めていなければ、最初に選ぶ */
  function compose({ type, note = null, title = "" }) {
    return dialog((done) => {
      let kind = note ? note.type : type || "talk";
      let tint = note?.tint || TINTS[0];
      const text = h("textarea", { class: "input", rows: 6, maxlength: LIMITS.text, placeholder: "" });
      text.value = note?.text || "";
      const ttl = h("input", { class: "input", maxlength: LIMITS.title, placeholder: "題名" });
      ttl.value = note?.title || "";
      const shelfNames = data ? shelves(data.state).map((g) => g.name) : [];
      const shelf = h("input", { class: "input", maxlength: LIMITS.shelf, placeholder: "棚の名前", list: "shelf-names" });
      shelf.value = note?.shelf || "";
      const datalist = h("datalist", { id: "shelf-names" }, ...shelfNames.map((s) => h("option", { value: s })));
      const file = fileSelect(note?.file || "");
      const swatches = h("div", { class: "swatches" }, ...TINTS.map((c) => h("button", { class: `swatch${c === tint ? " on" : ""}`, style: `--c:${c}`, title: "付箋の色", onclick: (e) => { tint = c; for (const b of swatches.children) b.classList.toggle("on", b === e.currentTarget); } })));
      const kinds = h("div", { class: "tabs" }, ...["talk", "idea", "shelf"].map((k) => h("button", { class: `tab${k === kind ? " on" : ""}`, "data-k": k, onclick: () => { kind = k; sync(); } , text: TYPE_LABEL[k] })));
      const fields = h("div", { class: "fields" });
      const sync = () => {
        for (const b of kinds.children) b.classList.toggle("on", b.dataset.k === kind);
        text.placeholder = { talk: "みんなに話したいこと・お知らせ", idea: "思いついたこと。ひとことでも", shelf: "残しておきたい中身。手順・連絡先・決まりごとなど" }[kind];
        fields.replaceChildren(
          ...(kind === "shelf" ? [h("div", { class: "composer-row" }, shelf, datalist), ttl] : []),
          text,
          h("div", { class: "composer-row" }, kind === "idea" ? swatches : null, kind !== "idea" ? file : null),
        );
      };
      sync();
      const ok = () => {
        const v = { type: kind, text: text.value.trim(), tint, file: kind === "idea" ? "" : file.value };
        if (kind === "shelf") {
          v.title = ttl.value.trim();
          v.shelf = shelf.value.trim() || "いろいろ";
          if (!v.title) return ttl.focus();
        } else if (!v.text) return text.focus();
        done(v);
      };
      text.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) ok();
      });
      return h("div", { class: "dialog" },
        h("h2", { text: title || (note ? "付箋を直す" : "付箋を書く") }),
        note ? null : kinds,
        fields,
        h("div", { class: "composer-row" }, h("span", { class: "grow" }), h("button", { class: "btn", onclick: () => done(null), text: "やめる" }), h("button", { class: "btn primary", onclick: ok, text: note ? "直す" : "貼る" })));
    });
  }

  function profile(me, { first = false } = {}) {
    return dialog((done) => {
      let color = me.color;
      let look = me.look;
      const name = h("input", { class: "input", maxlength: LIMITS.name, placeholder: "みんなに見える名前" });
      name.value = me.name || "";
      const face = h("div", { class: "person-face big", style: `--c:${color}`, text: LOOK_ICON[look] });
      const colors = h("div", { class: "swatches" }, ...COLORS.map((c) => h("button", { class: `swatch round${c === color ? " on" : ""}`, style: `--c:${c}`, title: "色", onclick: (e) => { color = c; face.style.setProperty("--c", c); for (const b of colors.children) b.classList.toggle("on", b === e.currentTarget); } })));
      const looks = h("div", { class: "looks" }, ...LOOKS.map((l) => h("button", { class: `look${l === look ? " on" : ""}`, title: LOOK_LABEL[l], onclick: (e) => { look = l; face.textContent = LOOK_ICON[l]; for (const b of looks.children) b.classList.toggle("on", b === e.currentTarget); } }, h("span", { text: LOOK_ICON[l] }), h("small", { text: LOOK_LABEL[l] }))));
      const ok = () => {
        const n = name.value.trim().replace(/\s+/g, " ");
        if (!n) return name.focus();
        done({ name: n, color, look });
      };
      name.addEventListener("keydown", (e) => {
        if (e.key === "Enter") ok();
      });
      return h("div", { class: "dialog" },
        h("h2", { text: first ? "ようこそ。名札を作りましょう" : "名札を変える" }),
        first ? h("p", { class: "dim", text: "名前と姿は、このワールドのみんなに見えます。あとから変えられます" }) : null,
        face, name, h("div", { class: "label", text: "色" }), colors, h("div", { class: "label", text: "姿" }), looks,
        h("div", { class: "composer-row" }, h("span", { class: "grow" }), first ? null : h("button", { class: "btn", onclick: () => done(null), text: "やめる" }), h("button", { class: "btn primary", onclick: ok, text: first ? "はじめる" : "変える" })));
    });
  }

  function onboarding(folderName, { onCreate, message = "" }) {
    cover.hidden = false;
    const btn = h("button", { class: "btn primary big", text: "このフォルダをワールドにする" });
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "作っています";
      try {
        await onCreate();
      } finally {
        btn.disabled = false;
        btn.textContent = "このフォルダをワールドにする";
      }
    };
    cover.replaceChildren(h("div", { class: "welcome" },
      h("div", { class: "welcome-art", text: "🌳⛲📚🎨" }),
      h("h1", { text: "付箋ワールド" }),
      h("p", { text: `「${folderName}」を、みんなで付箋を貼り合うワールドにします。` }),
      h("ul", {},
        h("li", { text: "OneDrive などでこのフォルダを共有している人どうしで、同じワールドに入れます" }),
        h("li", { text: "広場で話題を、アトリエでアイデアを、書庫で残したい情報を貼れます" }),
        h("li", { text: "データは、このフォルダの中の「.付箋ワールド」に入ります。ほかのファイルにはさわりません" })),
      message ? h("p", { class: "warn", text: message }) : null,
      btn));
  }

  function loading(text) {
    cover.hidden = !text;
    if (text) cover.replaceChildren(h("div", { class: "welcome loading" }, h("div", { class: "spinner" }), h("p", { text })));
  }
  const hideCover = () => {
    cover.hidden = true;
    cover.replaceChildren();
  };

  return {
    stage, setTop, showPanel, panelBox, update, openCard, closeCard, person, compose, profile, onboarding, loading, hideCover,
    get panelZone() {
      return panelZone;
    },
    get busy() {
      return !modal.hidden || !cover.hidden;
    },
    get cardOpen() {
      return !card.hidden;
    },
  };
}

const firstLine = (s) => String(s).split("\n").find((l) => l.trim()) || "";
