// 偽の explorer_plus：メモリの中の共有フォルダと、それを見る人ごとの explorerPlus。
// node の試験（unit.mjs）と、ブラウザの試験（browser.mjs がページに読み込む）の両方で使う。
// 本物と同じく、ID が合わないと断る（denied）・無ければ not-found・同じ名前があれば exists・名前を変えたらフォルダを読み直す。

export function createFakeFs() {
  let nextId = 5000;
  const nodes = new Map();       // パス → { id, name, path, kind, text }
  const kids = new Map();        // フォルダのパス → Set(子のパス)
  const join = (dir, name) => `${dir}\\${name}`;
  const parentOf = (p) => p.slice(0, p.lastIndexOf("\\"));
  const nameOf = (p) => p.slice(p.lastIndexOf("\\") + 1);
  const listeners = new Set();

  function add(path, kind, text = "") {
    if (nodes.has(path)) throw err("exists", path);
    const parent = parentOf(path);
    if (parent && !nodes.has(parent) && kids.size) throw err("not-found", parent);
    const n = { id: String(nextId++), name: nameOf(path), path, kind, text };
    nodes.set(path, n);
    if (kind === "folder") kids.set(path, new Set());
    if (kids.has(parent)) kids.get(parent).add(path);
    for (const l of listeners) l(parent);
    return n;
  }
  function mkdirp(path) {
    const parts = path.split("\\");
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join("\\");
      if (!nodes.has(p)) add(p, "folder");
    }
    return nodes.get(path);
  }
  function rename(path, newName) {
    const n = nodes.get(path);
    const to = join(parentOf(path), newName);
    if (nodes.has(to) && to !== path) throw err("exists", to);
    nodes.delete(path);
    kids.get(parentOf(path)).delete(path);
    n.name = newName;
    n.path = to;
    nodes.set(to, n);
    kids.get(parentOf(path)).add(to);
    for (const l of listeners) l(parentOf(path));
    return n;
  }
  const list = (dir) => [...(kids.get(dir) || [])].map((p) => nodes.get(p));
  return { nodes, kids, add, mkdirp, rename, list, get: (p) => nodes.get(p), onChange: (f) => listeners.add(f), join, parentOf };
}

function err(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}
const entryOf = (n) => ({ id: n.id, name: n.name, path: n.path, kind: n.kind, ext: n.kind === "file" && n.name.includes(".") ? n.name.split(".").pop().toLowerCase() : "", hidden: false });

/**
 * 1人分の explorerPlus。folder を開いた状態で始まる。
 * opts.log に呼び出しを残す。opts.grant = false なら、ファイルを作る許可を断る
 */
export function createFakeEp(fs, folderPath, opts = {}) {
  const store = new Map(opts.storage || []);
  const log = opts.log || [];
  const settings = { pollSeconds: 5, ...(opts.settings || {}) };
  const folderCbs = new Set();
  let grant = opts.grant !== false;
  const verify = (ref) => {
    const n = fs.get(ref?.path);
    if (!n) throw err("not-found", ref?.path);
    if (n.id !== ref.id) throw err("denied", `id does not match ${ref.path}`);
    return n;
  };
  const snapshot = () => {
    const n = fs.get(folderPath);
    return { id: n.id, path: n.path, name: n.name, parentPath: fs.parentOf(n.path), entries: fs.list(folderPath).map(entryOf) };
  };
  const emitFolder = () => {
    const s = snapshot();
    for (const cb of folderCbs) cb(s);
  };
  const tree = (n, depth) => (n.kind === "folder" && depth > 0 ? { entry: entryOf(n), children: fs.list(n.path).map((c) => tree(c, depth - 1)) } : { entry: entryOf(n) });
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const ep = {
    theme: "light",
    ready: async () => ({ apiVersion: 1, viewId: "neo.sticky-world", tabId: "t1", theme: "light" }),
    settings: { get: async () => ({ ...settings }) },
    onSettings: () => () => {},
    onTheme: () => () => {},
    storage: {
      get: async (k) => clone(store.get(k)),
      set: async (k, v) => {
        const s = JSON.stringify(v);
        if (s.length > (opts.storageLimit || 1024 * 1024)) throw err("too-large", k);
        store.set(k, JSON.parse(s));
      },
      delete: async (k) => void store.delete(k),
      keys: async () => [...store.keys()],
    },
    onFolder: (cb) => {
      folderCbs.add(cb);
      setTimeout(() => cb(snapshot()), 0);
      return () => folderCbs.delete(cb);
    },
    getTree: async ({ depth = 1, from } = {}) => {
      log.push(`getTree ${from ? from.path.slice(folderPath.length) : ""}`);
      const n = from ? verify(from) : fs.get(folderPath);
      if (n.kind !== "folder") throw err("invalid", "not a folder");
      return tree(n, Math.min(5, depth));
    },
    files: {
      readText: async (ref) => {
        const n = verify(ref);
        log.push(`readText ${n.name}`);
        if (opts.failRead && opts.failRead(n.name)) throw err("io", n.name);
        return { text: n.text, size: n.text.length, bytesRead: n.text.length, truncated: false, encoding: "utf-8" };
      },
      create: async (folder, name, o = {}) => {
        if (!grant) throw err("denied", "not granted");
        const dir = verify(folder);
        if (/[\\/:*?"<>|]/.test(name)) throw err("invalid", name);
        log.push(`create ${name}`);
        const n = fs.add(fs.join(dir.path, name), o.kind === "folder" ? "folder" : "file", o.text || "");
        if (dir.path === folderPath) emitFolder();
        return entryOf(n);
      },
    },
    rename: async (ref, newName) => {
      const n = verify(ref);
      if (/[\\/:*?"<>|]/.test(newName)) throw err("invalid", newName);
      log.push(`rename ${newName}`);
      const r = fs.rename(n.path, newName);
      setTimeout(emitFolder, 0);  // 本物も、名前を変えたらタブのフォルダを読み直す
      return entryOf(r);
    },
    open: async (ref) => void log.push(`open ${verify(ref).name}`),
    showMenu: async ({ extra }) => ({ chosen: opts.menuChoice ? opts.menuChoice(extra) : null }),
    commands: { set: async () => {} },
    onCommand: () => () => {},
    ui: {
      toast: async (t) => void log.push(`toast ${t}`),
      status: async () => {},
      tab: async (o) => void log.push(`tab ${o.badge ?? ""}`),
      confirm: async (m) => (log.push(`confirm ${m.split("\n")[0]}`), opts.confirm !== false),
    },
    // 試験から：同期で中身が変わったことにする
    __emitFolder: emitFolder,
    __grant: (v) => (grant = v),
    __store: store,
  };
  return ep;
}
