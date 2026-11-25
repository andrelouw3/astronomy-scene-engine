// AUDIT harness (pass AUDIT, 25 Nov 2026): pasted into the live page through Claude in Chrome's javascript_tool.
// Uses window.ASE only; changes nothing in the product. Results go to IndexedDB "aseAudit" so a reload keeps them.
// Usage: AUDIT.run()            sweep every case (returns at once; poll AUDIT.status())
//        AUDIT.run(["p:luxor"]) only these case ids;  AUDIT.one(id) one case, awaited
//        AUDIT.report()         JSON report (system, cases, summary);  AUDIT.sheet() contact sheet (JPEG blob)
(() => {
  if (window.AUDIT) return;
  const A = window.ASE, U = A.UI, S = A.Settings, $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const jdOf = s => Date.parse(s) / 86400000 + 2440587.5;

  // ---- recorder: console.error/warn, uncaught errors, rejections, lost contexts
  const errs = [];
  const rec = (kind, msg) => errs.push({ kind, msg: String(msg).replace(/\s+/g, " ").slice(0, 300) });
  for (const k of ["error", "warn"]) { const f = console[k]; console[k] = (...a) => { rec(k, a.map(x => x && x.stack || x).join(" ")); f.apply(console, a); }; }
  addEventListener("error", e => rec("exception", (e.message || e) + " @" + String(e.filename || "").split("/").pop() + ":" + e.lineno));
  addEventListener("unhandledrejection", e => rec("rejection", e.reason && (e.reason.stack || e.reason)));
  const cv = $("view");
  cv.addEventListener("webglcontextlost", () => rec("contextlost", "webglcontextlost"));
  cv.addEventListener("webglcontextrestored", () => rec("contextlost", "webglcontextrestored"));

  // ---- frame meter: rAF timestamps while measuring
  const meter = { on: false, t: [], hidden: false };
  const tick = t => { if (meter.on) { meter.t.push(t); if (document.hidden) meter.hidden = true; } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
  const frames = () => {
    const dt = []; for (let i = 1; i < meter.t.length; i++) dt.push(meter.t[i] - meter.t[i - 1]);
    return { n: dt.length, fpsMed: +(1000 / q(dt, 0.5)).toFixed(1), fpsP5: +(1000 / q(dt, 0.95)).toFixed(1), over50: dt.filter(x => x > 50).length, worstMs: Math.round(Math.max(0, ...dt)) };
  };

  // ---- picture sampler: the stage canvas read right after the frame draws it (UI.updateLabels follows the render)
  const sm = document.createElement("canvas"); sm.width = 64; sm.height = 40;
  const th = document.createElement("canvas"); th.width = 128; th.height = 80;
  const smx = sm.getContext("2d", { willReadFrequently: true }), thx = th.getContext("2d");
  let want = null, prevLum = null;
  const grab = src => {
    smx.fillStyle = "#000"; smx.fillRect(0, 0, 64, 40); smx.drawImage(src, 0, 0, 64, 40);
    thx.fillStyle = "#000"; thx.fillRect(0, 0, 128, 80); thx.drawImage(src, 0, 0, 128, 80);
    const d = smx.getImageData(0, 0, 64, 40).data, lum = new Float32Array(64 * 40);
    let sum = 0, sum2 = 0, max = 0, pink = 0;
    for (let i = 0; i < lum.length; i++) {
      const r = d[4 * i], g = d[4 * i + 1], b = d[4 * i + 2], l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum[i] = l; sum += l; sum2 += l * l; if (l > max) max = l; if (r > 180 && b > 180 && g < 90) pink++;
    }
    const n = lum.length, mean = sum / n, std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    let same = null;
    if (prevLum) { let k = 0; for (let i = 0; i < n; i++) if (Math.abs(lum[i] - prevLum[i]) < 3) k++; same = +(k / n).toFixed(3); }
    prevLum = lum;
    return { mean: +mean.toFixed(1), std: +std.toFixed(1), max: Math.round(max), pink: +(pink / n).toFixed(3), same, thumb: th.toDataURL("image/jpeg", 0.8) };
  };
  const ul = U.updateLabels;
  U.updateLabels = function (...a) { if (want && !want.done) { try { want.res(grab(cv)); } catch (e) { want.res({ err: String(e) }); } want.done = true; } return ul.apply(this, a); };
  const sampleStage = () => new Promise(res => { want = { res, done: false }; setTimeout(() => { if (!want.done) { want.done = true; res(null); } }, 2000); });
  const samplePane = () => { const card = document.querySelector(".vpMaximised"); const c = card && [...card.querySelectorAll("canvas")].find(x => x.offsetWidth > 0); return c ? grab(c) : null; };

  // ---- layout and palette probes
  const layout = () => {
    const W = innerWidth, H = innerHeight, off = [], tiny = new Set();
    for (const el of document.querySelectorAll("button, select, input, label, h1, h2, h3, p, span, strong, a")) {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
      const tag = el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "");
      if (r.right > W + 1 || r.left < -1 || r.bottom > H + 1) off.push(tag);
      if (el.childNodes[0] && el.childNodes[0].nodeType === 3 && el.textContent.trim() && parseFloat(getComputedStyle(el).fontSize) < 10) tiny.add(tag);
    }
    return { w: W, h: H, scrollX: document.documentElement.scrollWidth > W, offscreen: [...new Set(off)].slice(0, 12), offN: off.length, tiny: [...tiny].slice(0, 8), tinyN: tiny.size, body: document.body.className };
  };
  const rgb = v => { const e = document.createElement("i"); e.style.color = v; document.body.appendChild(e); const c = getComputedStyle(e).color.match(/[\d.]+/g).map(Number); e.remove(); return c; };
  const relL = c => { const f = x => (x /= 255) <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contrast = (a, b) => { const x = relL(rgb(a)), y = relL(rgb(b)); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };
  const palette = () => { const o = {}; for (const t of ["--ink", "--muted", "--brass", "--accent"]) o[t] = contrast(`var(${t})`, "var(--panel)"); return o; };

  // ---- cases
  const C = [], add = (id, group, label, apply, o = {}) => C.push(Object.assign({ id, group, label, apply }, o));
  const ex = () => { S.set("lessonSeen", true); A.Simple.setMode("explorer"); };
  for (const b of document.querySelectorAll("[data-preset]")) { const p = b.dataset.preset; add("p:" + p, "famous", b.dataset.short || b.textContent.trim().slice(0, 40), () => { ex(); U.preset(p); }, { settle: 6000 }); }
  const SIM = () => {};   // Simple: Restore start leaves Simple on
  const cities = [["new_york", "2026-11-26T04:00Z", "2026-11-25T17:00Z"], ["tokyo", "2026-11-25T14:00Z", "2026-11-25T03:00Z"], ["sydney", "2026-11-25T12:00Z", "2026-11-25T01:00Z"]];
  for (const [c, night, day] of cities) for (const [w, t] of [["night", night], ["day", day]])
    add(`s:tonight:${c}:${w}`, "simple", `Tonight's sky, ${c}, ${w}`, () => { SIM(); S.set("simplePlace", c); A.Simple.tonight({ now: jdOf(t) }); A.Simple.picked("tonight"); }, { after: () => ({ start: A.Simple.lastStart && A.Simple.lastStart.kind, dusk: $("simpleDuskNote").textContent.slice(0, 120) }) });
  add("s:planets:inner", "simple", "Planets, inner", () => A.Simple.choose("planets"));
  add("s:planets:outer", "simple", "Planets, outer", async () => { A.Simple.choose("planets"); await sleep(600); A.Simple.planetsStep("outer"); }, { settle: 5000 });
  add("s:earthMoon", "simple", "Earth and Moon", () => A.Simple.choose("earthMoon"));
  add("s:famousGrid", "simple", "Famous moments grid", () => A.Simple.choose("famous"));
  add("s:famous:luxor", "simple", "Famous: Luxor 2027", () => A.Simple.famous("luxor"), { settle: 6000 });
  const SPEC = { __galaxy: "Galaxy", __local: "Local", __bh: "BlackHole", __origins: "Origins", __compare: "Compare" };
  for (const [id, m] of Object.entries(SPEC)) {
    add("v:" + id, "special", m + " entered", () => { ex(); U.goTo(id); }, { settle: 5000 });
    add("v:" + id + ":turn", "special", m + " turned + zoomed", async () => { ex(); U.goTo(id); await sleep(3000); const M = A[m]; M.drag(300, 80); if (M.zoom) M.zoom(0.6); else if (M.zoomBy) M.zoomBy(0.6); }, { settle: 5000 });
  }
  for (const [ch, T] of [["disc", 4555], ["impact", 4510], ["early", 3000], ["plates", 200]])
    add("o:" + ch, "special", "Origins chapter " + ch, async () => { ex(); U.goTo("__origins"); await sleep(1500); A.Origins.playing = false; A.Origins.setT(T); }, { settle: 5000 });
  for (const m of ["sizes", "light", "spin"]) add("c:" + m, "special", "Compare " + m, () => { ex(); U.goTo("__compare:" + m); }, { settle: 5000 });
  add("m:orbit", "mode", "Orbit (start view, Explorer)", ex);
  add("m:standEarth", "mode", "Standing on Earth (Greenwich)", () => { ex(); A.Observer.stand("Earth", 51.4769, 0); }, { settle: 6000 });
  add("m:standMoon", "mode", "Standing on the Moon", () => { ex(); A.Observer.stand("Moon", 0.67, 23.47); }, { settle: 6000 });
  add("m:standMars", "mode", "Standing on Mars (Gale)", () => { ex(); A.Observer.stand("Mars", -4.59, 137.44); }, { settle: 6000 });
  add("m:free", "mode", "Free flight", () => { ex(); A.Nav.setMode("free"); });
  add("m:rideEarth", "mode", "Ride along, Earth 420 km", () => { ex(); A.Observer.rideOrbit("Earth", 420); }, { settle: 6000 });
  add("m:rideMoon", "mode", "Ride along, Moon 110 km", () => { ex(); A.Observer.rideOrbit("Moon", 110, { riseOf: "Earth", lead: 0.1 }); }, { settle: 6000 });
  for (const w of ["eudoxus", "aristotle", "ptolemy", "almagest", "copernicus", "tycho", "mysterium", "kepler"]) add("w:" + w, "worldview", "World view " + w, () => { ex(); S.set("worldView", w); }, { settle: 5000 });
  add("w:ptolemy:ground", "worldview", "World view ptolemy from the ground", () => { ex(); A.Observer.stand("Earth", 51.4769, 0); S.set("worldView", "ptolemy"); }, { settle: 6000 });
  for (const v of Object.keys(U.VIEWS)) add("pane:" + v, "pane", "Pane " + v + " maximised", () => { ex(); U.setSlot(0, v); U.toggleMax(0); }, { pane: v });
  for (const p of ["deepspace", "observatory", "corona", "staratlas", "auto"]) add("pal:" + p, "palette", "Palette " + p, () => { ex(); S.set("theme", p); }, { after: palette, settle: 1500 });
  const DAYS = [1 / 86400, 60 / 86400, 1 / 24, 1, 7, 30.436875, 365.25, 3652.5, 36525, 365250];   // 01_time RATES (not exposed)
  for (let i = 0; i < 10; i++) add("t:" + i, "time", "Rate step " + i, () => { ex(); S.set("rateIndex", i); S.set("reverse", false); S.set("playing", true); }, { settle: 1000, measure: 5000, rate: i });

  // window sizes: run by id after resizing the window (not in the default sweep)
  add("layout:simple", "layout", "Layout, Simple", SIM, { after: layout, settle: 2000 });
  add("layout:explorer", "layout", "Layout, Explorer", ex, { after: layout, settle: 2000 });

  // ---- storage
  const idb = new Promise((res, rej) => { const r = indexedDB.open("aseAudit", 1); r.onupgradeneeded = () => r.result.createObjectStore("cases", { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const store = async (mode, f) => { const db = await idb; return new Promise((res, rej) => { const tx = db.transaction("cases", mode), out = f(tx.objectStore("cases")); tx.oncomplete = () => res(out.result); tx.onerror = () => rej(tx.error); }); };
  const put = v => store("readwrite", s => s.put(v)), all = () => store("readonly", s => s.getAll());

  // ---- one case: Restore start, apply, settle, measure, sample, share string
  const one = async (c, idx) => {
    const out = { id: c.id + (c.group === "layout" ? ":" + innerWidth + "x" + innerHeight : ""), n: idx, group: c.group, label: c.label, at: new Date().toISOString(), w: innerWidth, h: innerHeight }, e0 = errs.length;
    try {
      U.restoreStart(); await sleep(500);
      await c.apply(); await sleep(c.settle || 4000);
      const jd0 = A.Clock.jd, t0 = performance.now();
      meter.t = []; meter.hidden = document.hidden; meter.on = true; await sleep(c.measure || 4000); meter.on = false;
      out.frames = frames(); out.hidden = meter.hidden;
      if (c.rate !== undefined) { const secs = (performance.now() - t0) / 1000; out.clock = { ratio: +((A.Clock.jd - jd0) / DAYS[c.rate] / secs).toFixed(3) }; }
      out.pic = c.pane ? samplePane() : await sampleStage();
      if (c.pane) { const d0 = U.draws[c.pane] || 0; await sleep(1000); out.paneDraws = (U.draws[c.pane] || 0) - d0; }
      out.share = A.Share.string();
      out.mode = A.Nav.mode; out.special = U.activeSpecial(); out.ui = S.get("uiMode");
      if (c.after) out.extra = c.after();
    } catch (e) { out.fail = String(e && e.stack || e).slice(0, 400); meter.on = false; }
    const m = {}; for (const e of errs.slice(e0)) { const k = e.kind + ": " + e.msg; m[k] = (m[k] || 0) + 1; }
    out.errors = Object.entries(m).map(([k, n]) => (n > 1 ? n + "× " : "") + k);
    const p = out.pic || {}, f = out.frames || {}, fl = [];
    if (out.fail) fl.push("fail");
    if (out.errors.some(x => /error|exception|rejection/.test(x))) fl.push("error");
    if (out.errors.some(x => /contextlost/.test(x))) fl.push("contextlost");
    if (out.errors.some(x => /^(\d+× )?warn/.test(x))) fl.push("warn");
    if (!c.pane && !out.pic) fl.push("nosample");
    if (p.mean !== undefined && p.mean < 2 && p.max < 12) fl.push("black");
    if (p.mean > 245 && p.std < 6) fl.push("white");
    if (p.pink > 0.15) fl.push("pink");
    if (p.same > 0.97 && c.group !== "palette" && c.group !== "time") fl.push("unchanged");
    if (f.fpsMed < 30 || f.fpsP5 < 15) fl.push("slow");
    if (out.hidden) fl.push("hidden");
    if (out.clock && Math.abs(out.clock.ratio - 1) > 0.05) fl.push("clock");
    out.flags = fl;
    await put(out);
    return out;
  };

  const status = { running: false, done: 0, total: 0, current: null, startedAt: null };
  const run = async ids => {
    if (status.running) return "already running";
    const list = ids ? C.filter(c => ids.includes(c.id)) : C.filter(c => c.group !== "layout");
    Object.assign(status, { running: true, done: 0, total: list.length, startedAt: new Date().toISOString(), stop: false });
    (async () => {
      for (const c of list) { if (status.stop) break; status.current = c.id; await one(c, C.indexOf(c) + 1); status.done++; }
      status.running = false; status.current = null; U.restoreStart();
    })();
    return "started " + list.length;
  };

  const system = () => {
    const gl = A.Scene.renderer.getContext(), x = gl.getExtension("WEBGL_debug_renderer_info");
    const ua = navigator.userAgentData, br = ua ? ua.brands.filter(b => !/Not/.test(b.brand)).map(b => b.brand + " " + b.version).join(", ") : navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0];
    return { gpuVendor: x ? gl.getParameter(x.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), gpu: x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      browser: br, platform: ua ? ua.platform : "", screen: screen.width + "×" + screen.height, dpr: devicePixelRatio, viewport: innerWidth + "×" + innerHeight, version: typeof ASE_DATA !== "undefined" && ASE_DATA.build ? ASE_DATA.build.version : "", date: new Date().toISOString().slice(0, 10) };
  };
  const report = async () => {
    const cases = (await all()).sort((a, b) => a.n - b.n || a.id.localeCompare(b.id));
    for (const c of cases) if (c.pic) delete c.pic.thumb;
    const flagged = {}; for (const c of cases) for (const f of c.flags) (flagged[f] = flagged[f] || []).push(c.id);
    return { system: system(), caseList: C.map((c, i) => [i + 1, c.id, c.group, c.label]), summary: { cases: cases.length, flagged }, cases };
  };
  // contact sheet: 128 × 80 thumbnails in a grid, numbered, flagged cases outlined
  const sheet = async (cols = 10) => {
    const cases = (await all()).sort((a, b) => a.n - b.n || a.id.localeCompare(b.id)), W = 128, H = 80, L = 14, P = 4;
    const cnv = document.createElement("canvas"); cnv.width = cols * (W + P) + P; cnv.height = Math.ceil(cases.length / cols) * (H + L + P) + P;
    const g = cnv.getContext("2d"); g.fillStyle = "#111"; g.fillRect(0, 0, cnv.width, cnv.height); g.font = "10px sans-serif";
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i], x = P + (i % cols) * (W + P), y = P + Math.floor(i / cols) * (H + L + P);
      if (c.pic && c.pic.thumb) { const im = new Image(); im.src = c.pic.thumb; await im.decode(); g.drawImage(im, x, y); } else { g.fillStyle = "#333"; g.fillRect(x, y, W, H); }
      const bad = c.flags.filter(f => f !== "warn"); if (bad.length) { g.strokeStyle = bad.includes("slow") && bad.length === 1 ? "#fa0" : "#f33"; g.lineWidth = 2; g.strokeRect(x - 1, y - 1, W + 2, H + 2); }
      g.fillStyle = "#ddd"; g.fillText((c.n + " " + c.id).slice(0, 24), x, y + H + 11);
    }
    return new Promise(r => cnv.toBlob(r, "image/jpeg", 0.85));
  };

  window.AUDIT = { cases: C, one: id => one(C.find(c => c.id === id), C.findIndex(c => c.id === id) + 1), run, status, report, sheet, system, layout, palette, errs, all,
    clear: () => store("readwrite", s => s.clear()) };
})();
