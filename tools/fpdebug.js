/* Birinci şahıs görünüm/koreografi ayar yardımcısı (geliştirme aracı).

   Tarayıcı konsolunda:
     await import('/tools/fpdebug.js?' + Date.now())
     await fp.eq(2)          // 2. yuvadaki silahı kuşan
     fp.reload(0)            // boş şarjörle doldurmayı başlat
     fp.freeze(1.3)          // koreografiyi 1.3 sn'de dondur
     fp.side()  / fp.fp()    // yandan hata ayıklama kamerası / oyuncu gözü
     fp.go()                 // dondurmayı kaldır                          */

const g = window.game;
const C = g.camera.constructor;
const V = g.camera.position.constructor;

if (!window.__origRender) {
  window.__origRender = g.renderer.render.bind(g.renderer);
  g.renderer.render = (scene, cam) => {
    const d = window.__dbgCam;
    if (!d) return window.__origRender(scene, cam);
    const q = g.camera.getWorldQuaternion(g.camera.quaternion.clone());
    const base = g.camera.getWorldPosition(new V());
    d.cam.position.copy(base).add(new V(...d.off).applyQuaternion(q));
    d.cam.up.set(0, 1, 0);
    d.cam.lookAt(new V(...d.look).applyQuaternion(q).add(base));
    d.cam.aspect = g.camera.aspect;
    d.cam.updateProjectionMatrix();
    return window.__origRender(scene, d.cam);
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

window.fp = {
  start() {
    g.start(null);
    g.player.health = 1e9;
    g.enemies.update = () => {};
  },
  side(off = [1.5, -0.15, -0.3], look = [0.1, -0.22, -0.3], fov = 26) {
    window.__dbgCam = { cam: new C(fov, 1.33, 0.01, 50), off, look };
  },
  view(off, look, fov = 30) { window.__dbgCam = { cam: new C(fov, 1.33, 0.01, 50), off, look }; },
  fp() { window.__dbgCam = null; },
  async eq(n) { g.weaponry.equipSlot(n); await wait(700); return g.weaponry.current.def.id; },
  reload(ammo = 0) { const W = g.weaponry; W.current.ammo = ammo; return W.startReload(); },
  freeze(t) {
    clearInterval(window.__fz);
    const W = g.weaponry;
    const set = () => { if (W.action) W.action.start = performance.now() / 1000 - t; };
    set();
    window.__fz = setInterval(set, 5);
  },
  go() { clearInterval(window.__fz); },
  err() { const A = g.weaponry.arms.side; return { L: +A.L.err.toFixed(3), R: +A.R.err.toFixed(3) }; },
};
if (g.state !== 'playing') window.fp.start();
export default window.fp;
