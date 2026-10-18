/* Mühimmat sandığı: haritada iki tane, F ile bütün silahların şarjörü ve
   yedek mermisi tam dolar.

   Model tamamen KODLA kurulur (özgün tasarım, dış dosya yok): zeytin
   yeşili boyalı ahşap sandık, köşe sacları, iki yanda halat tutamak,
   menteşeden ~70° açık kapak; içinde dört metal cephane kutusu ve
   fişek şeritleri. Ön ve yan yüzlerde şablon boyalı yazı (canvas).      */

import * as THREE from 'three';

const W = 1.05, H = 0.52, D = 0.62;     // dış ölçüler (m)
const WALL = 0.035;                     // tahta kalınlığı
export const CRATE_REACH = 1.9;         // F ile kullanma mesafesi

let _mats = null;
function mats() {
  if (_mats) return _mats;
  const stencil = (lines, w, h, band) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    // Boyalı tahta: zeytin yeşili, tahta damarı ve aşınma
    g.fillStyle = '#4c5634';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '20,24,12' : '120,128,90'},${0.04 + Math.random() * 0.06})`;
      g.fillRect(0, Math.random() * h, w, 1 + Math.random() * 2);
    }
    // Tahta ek yerleri (yatay çıtalar)
    g.fillStyle = 'rgba(15,18,10,0.55)';
    for (let k = 1; k < 3; k++) g.fillRect(0, (h * k) / 3 - 1, w, 2);
    if (band) {
      g.fillStyle = '#c9a23a';
      g.fillRect(0, h * 0.06, w, h * 0.07);
    }
    // Şablon yazı (sarı, kenarları hafif dağınık)
    g.fillStyle = '#d9c26a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach(([txt, size, y]) => {
      g.font = `700 ${size}px "Saira Condensed", "Arial Narrow", sans-serif`;
      g.fillText(txt, w / 2, h * y);
    });
    // Aşınma lekeleri yazının üstünden geçer
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(60,66,40,${0.3 + Math.random() * 0.4})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 4, 1 + Math.random() * 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.82, metalness: 0.02 });
  };
  _mats = {
    front: stencil([['MÜHİMMAT', 92, 0.36], ['7.62×39 · 5.56×45 · 9 MM', 38, 0.62], ['LOT ÇH-26 · 1.440 ADET', 30, 0.82]], 512, 256, true),
    side: stencil([['ÇELİK HAT', 54, 0.42], ['▲ ÜST', 34, 0.72]], 256, 256, false),
    plain: stencil([], 256, 256, false),
    dark: new THREE.MeshStandardMaterial({ color: 0x2c3220, roughness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x3b3f36, roughness: 0.5, metalness: 0.65 }),
    can: new THREE.MeshStandardMaterial({ color: 0x6e7c48, roughness: 0.5, metalness: 0.35 }),
    rope: new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 1 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9953e, roughness: 0.32, metalness: 0.85 }),
    tip: new THREE.MeshStandardMaterial({ color: 0x8a5a2e, roughness: 0.35, metalness: 0.8 }),
  };
  return _mats;
}

/** Sandık modeli (orijin: alt yüz ortası, ön yüz +Z). */
export function buildAmmoCrate() {
  const M = mats();
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };

  // Gövde: beş tahta yüz (üst açık). Ön ve yanlarda şablon yazı.
  add(new THREE.BoxGeometry(W, WALL, D), M.plain, 0, WALL / 2, 0);
  const frontGeo = new THREE.BoxGeometry(W, H, WALL);
  // Kutu malzeme dizisi: +x −x +y −y +z −z → yazı yalnızca dış yüzde
  add(frontGeo, [M.dark, M.dark, M.dark, M.dark, M.front, M.dark], 0, H / 2, D / 2 - WALL / 2);
  add(frontGeo, [M.dark, M.dark, M.dark, M.dark, M.dark, M.front], 0, H / 2, -D / 2 + WALL / 2);
  const sideGeo = new THREE.BoxGeometry(WALL, H, D - WALL * 2);
  add(sideGeo, [M.side, M.dark, M.dark, M.dark, M.dark, M.dark], W / 2 - WALL / 2, H / 2, 0);
  add(sideGeo, [M.dark, M.side, M.dark, M.dark, M.dark, M.dark], -W / 2 + WALL / 2, H / 2, 0);

  // Alt kızaklar ve köşe sacları
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.07, 0.05, D + 0.02), M.dark, s * (W / 2 - 0.12), -0.02, 0);
  const corner = new THREE.BoxGeometry(0.06, H + 0.01, 0.06);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    add(corner, M.steel, sx * (W / 2 - 0.02), H / 2, sz * (D / 2 - 0.02));
  }
  // Ön kilit dilleri
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.07, 0.09, 0.02), M.steel, s * 0.3, H - 0.06, D / 2 + 0.01);

  // Halat tutamaklar (yanlarda, tahta takozlara bağlı)
  const rope = new THREE.TorusGeometry(0.075, 0.014, 6, 14, Math.PI);
  for (const s of [-1, 1]) {
    add(rope, M.rope, s * (W / 2 + 0.02), H * 0.62, 0, 0, Math.PI / 2, Math.PI);
    for (const z of [-0.075, 0.075]) add(new THREE.BoxGeometry(0.04, 0.06, 0.04), M.dark, s * (W / 2 + 0.01), H * 0.62, z);
  }

  // İçerik: dört metal cephane kutusu (2×2), kapakları ve tutamakları
  const canGeo = new THREE.BoxGeometry(0.27, 0.36, 0.2);
  const lidGeo = new THREE.BoxGeometry(0.28, 0.035, 0.21);
  const handle = new THREE.TorusGeometry(0.045, 0.008, 5, 10, Math.PI);
  for (const [cx, cz] of [[-0.3, -0.12], [0.02, -0.12], [-0.3, 0.12], [0.02, 0.12]]) {
    add(canGeo, M.can, cx, WALL + 0.18, cz);
    add(lidGeo, M.steel, cx, WALL + 0.375, cz);
    add(handle, M.steel, cx, WALL + 0.39, cz, 0, 0, 0);
  }
  // Sağ bölmede gevşek fişek şeritleri (pirinç kovan + bakır uç)
  const shell = new THREE.CylinderGeometry(0.0075, 0.0075, 0.045, 6);
  const tip = new THREE.ConeGeometry(0.0072, 0.022, 6);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 12; i++) {
      const x = 0.24 + (i % 6) * 0.034 + (row % 2) * 0.017;
      const z = -0.2 + Math.floor(i / 6) * 0.2 + row * 0.06;
      const y = WALL + 0.03 + row * 0.018;
      add(shell, M.brass, x, y, z, Math.PI / 2, 0, 0);
      add(tip, M.tip, x, y, z - 0.033, -Math.PI / 2, 0, 0);
    }
  }

  // Kapak: arka menteşeden ~70° açık; iç yüzü koyu, dış yüzünde yazı
  const hinge = new THREE.Group();
  hinge.position.set(0, H, -D / 2);
  hinge.rotation.x = -1.22;
  g.add(hinge);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, 0.04, D + 0.02),
    [M.dark, M.dark, M.side, M.dark, M.dark, M.dark]);
  lid.position.set(0, 0.02, D / 2);
  lid.castShadow = lid.receiveShadow = true;
  hinge.add(lid);
  for (const s of [-1, 1]) {
    const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, D - 0.05), M.dark);
    cleat.position.set(s * (W / 2 - 0.12), 0.055, D / 2);
    hinge.add(cleat);
  }
  return g;
}

/**
 * Haritadaki iki sandık. Sandıklar dünyaya fixture olarak eklenir (çarpışma
 * + mermi durdurma); akışla sökülmez.
 */
export class AmmoCrates {
  constructor(game) {
    this.game = game;
    this.list = [];          // { group, pos, fixture, body }
  }

  clear() {
    const { scene, world, physics } = this.game;
    for (const c of this.list) {
      scene.remove(c.group);
      world.removeFixture(c.fixture);
      physics.remove(c.body);
    }
    this.list = [];
  }

  /** spots: [{ pos: Vector3 (zemin), yaw }] */
  place(spots) {
    this.clear();
    const { scene, world, physics } = this.game;
    for (const { pos, yaw } of spots) {
      const group = buildAmmoCrate();
      group.position.copy(pos);
      group.rotation.y = yaw;
      scene.add(group);
      group.updateMatrixWorld(true);
      // Kapak açık olduğu için kutu yalnızca gövdeden alınır
      const box = new THREE.Box3();
      const solids = [];
      group.children.forEach((o, i) => {
        if (i < 5 && o.isMesh) { box.expandByObject(o); solids.push(o); }
      });
      const size = box.getSize(new THREE.Vector3());
      const body = physics.addStaticBox(box.getCenter(new THREE.Vector3()), { x: size.x, y: size.y, z: size.z });
      const fixture = { colliders: [box], solids, cover: [] };
      world.addFixture(fixture);
      this.list.push({ group, pos: pos.clone(), fixture, body, usedAt: -10 });
    }
  }

  nearby(p) {
    let best = null, bd = CRATE_REACH;
    for (const c of this.list) {
      const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
}
