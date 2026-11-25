// LAYERS (pass FIX, 0.63): what a frame of the current view costs, layer by layer, on the GPU it runs on.
// Pasted into the page through Claude in Chrome's javascript_tool (after the page is at the view to measure). Uses window.ASE only.
// Usage: await LAYERS.run({ n: 40 })  → { size, base, layers: [{ name, ms, saved }], configs: {...}, cpu: {...} }
// Each figure is the median time of n frames drawn and finished (a 1 px readback waits for the GPU); the frame loop is kept
// from drawing in between (UI.maxed set to a dummy). "saved" is base − ms with that layer hidden.
(() => {
  if (window.LAYERS) return;
  const A = window.ASE, Sc = A.Scene, S = A.Settings, U = A.UI, P = A.Post, r = Sc.renderer, gl = r.getContext();
  const px = new Uint8Array(4);
  const finish = () => { r.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
  const time = (fn, n) => { fn(); finish(); const ts = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); fn(); finish(); ts.push(performance.now() - t0); } return +med(ts).toFixed(2); };

  // names for the scenes' top-level objects (grouped: each body's meshes, orbits, …)
  const names = () => {
    const m = new Map(), put = (o, n) => { if (o) m.set(o, n); };
    put(Sc.skyDome, "sky dome (daylight gradient, halo)");
    for (const o of Sc.skyScene.children) {
      if (o.material === Sc.mwMat) put(o, "Milky Way");
      if (o.material === Sc.starMat) put(o, "stars");
    }
    put(Sc.figures, "constellation figures"); put(Sc.bounds, "constellation bounds"); put(Sc.ecliptic, "ecliptic");
    put(Sc.glints, "tiny-body markers"); put(Sc.sunGlow, "Sun glow"); put(Sc.moonGlow, "Moon glow");
    for (const [id, e] of Object.entries(Sc.meshes)) {
      const g = id === "Earth" ? "Earth (globe and ground)" : id === "Sun" ? "Sun" : id === "Moon" ? "Moon" : "other bodies";
      put(e.mesh, g); if (e.ring) put(e.ring.mesh, "other bodies"); if (e.clouds) put(e.clouds.mesh, id === "Earth" ? "Earth clouds" : "other bodies");
      if (e.atmo) put(e.atmo.mesh, id === "Earth" ? "Earth's air shell (limb glow)" : "other bodies");
      if (e.scatter) put(e.scatter.mesh, "Earth's air (scattering shell)");
    }
    for (const o of Object.values(Sc.orbits || {})) put(o.line || o, "orbits");
    for (const t of Object.values(A.Terrain && A.Terrain.meshes || {})) put(t, "terrain patch");
    if (A.Hevelius && A.Hevelius.group) put(A.Hevelius.group, "Hevelius drawings");
    if (A.DeepSky) { put(A.DeepSky.dark, "deep-sky objects"); put(A.DeepSky.bright, "deep-sky objects"); }
    if (A.Meteors) put(A.Meteors.skyPts, "shooting stars");
    return m;
  };
  const label = (o, m) => {
    if (m.has(o)) return m.get(o);
    if (o.isLine || o.isLineSegments) return "lines (other)";
    const fs = String(o.material && o.material.fragmentShader || "").split("\n")[0].replace(/^\/\/\s*/, "").slice(0, 40);
    return (o.type || "object") + (fs ? ": " + fs : "");
  };

  const LAYERS = {
    async run(opts = {}) {
      const n = opts.n || 40, maxed = U.maxed;
      U.maxed = "__layers";
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      try {
        const cv = r.domElement, out = { size: [cv.width, cv.height], pr: r.getPixelRatio(), css: [A.Res ? A.Res.w : 0, A.Res ? A.Res.h : 0], view: U.lastPreset || A.Nav.mode };
        const draw = () => Sc.render();
        out.base = time(draw, n);
        // each visible top-level object group hidden in turn
        const m = names(), groups = new Map();
        for (const sc of [Sc.skyScene, Sc.scene]) for (const o of sc.children) if (o.visible) { const k = label(o, m); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
        out.layers = [];
        for (const [name, objs] of groups) {
          const ms = time(() => { objs.forEach(o => { o.visible = false; }); draw(); objs.forEach(o => { o.visible = true; }); }, n);
          out.layers.push({ name, count: objs.length, ms, saved: +(out.base - ms).toFixed(2) });
        }
        out.layers.sort((a, b) => b.saved - a.saved);
        // the post-processing path
        const bloom = S.get("bloom"), adapt = S.get("adapt");
        out.configs = {};
        out.configs.noPost = time(() => { r.setRenderTarget(null); r.clear(); r.render(Sc.skyScene, Sc.skyCamera); r.clearDepth(); r.render(Sc.scene, Sc.camera); }, n);
        out.configs.singleSample = time(() => P.render(() => { r.clear(); r.render(Sc.skyScene, Sc.skyCamera); r.clearDepth(); r.render(Sc.scene, Sc.camera); }, true), n);
        S.set("bloom", false); out.configs.bloomOff = time(draw, n); S.set("bloom", bloom);
        out.configs.skyOnly = time(() => P.render(() => { r.clear(); r.render(Sc.skyScene, Sc.skyCamera); }), n);
        out.configs.sceneOnly = time(() => P.render(() => { r.clear(); r.render(Sc.scene, Sc.camera); }), n);
        // CPU per frame: the Solar System update and the labels (no GPU wait)
        const cpu = fn => { const ts = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); fn(); ts.push(performance.now() - t0); } return +med(ts).toFixed(2); };
        out.cpu = {
          update: cpu(() => { A.Ephem.update(A.Clock.jd); A.Nav.update(0.016); Sc.update(A.Nav.pos, A.Nav.quat, A.Nav.focus); }),
          labels: cpu(() => { U.maxed = null; U.updateLabels(); U.maxed = "__layers"; }),
        };
        S.set("adapt", adapt);
        return out;
      } finally { U.maxed = maxed; }
    },
    /** fps of the live frame loop over `sec` seconds (median and 5th percentile), with the render size */
    async fps(sec = 4) {
      const t = [];
      await new Promise(res => { const t0 = performance.now(); const f = now => { t.push(now); if (now - t0 < sec * 1000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      const dt = []; for (let i = 1; i < t.length; i++) dt.push(t[i] - t[i - 1]);
      const q = p => { const s = dt.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
      const cv = r.domElement;
      return { fpsMed: +(1000 / q(0.5)).toFixed(1), fpsP5: +(1000 / q(0.95)).toFixed(1), size: cv.width + "x" + cv.height, pr: +r.getPixelRatio().toFixed(3), q: S.get("quality") };
    },
  };
  window.LAYERS = LAYERS;
})();
