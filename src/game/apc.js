/* Özgün zırhlı personel taşıyıcı modeli — tamamen kodla kurulur.

   Hazır (lisansı belirsiz) bir model yerine bu proje için tasarlandı: 4×4
   tekerlekli, eğimli burunlu, açık kuleli bir zırhlı araç. Kamuflaj
   desteni canvas'ta üretilir; alanın zeminine göre orman, çöl ya da kış
   paletiyle boyanır.

   Düğüm adları vehicle.js'in beklediği sözleşmeye uyar:
     wheel, wheel2 (ön), wheel3, wheel4 (arka) · turret (kule, Mesh) ·
     weapon_muzzle · gunner_a (kule nişancısının ayak noktası) ·
     groundpoint* (iniş noktaları) · hatch6 (arka kapı, menteşede) ·
     exhaust (egzoz ucu) · hull (gövde grubu: yalpalama burada)
   Ön taraf +X, yukarı +Y, sağ yan +Z. Ölçüler metre.                     */

import * as THREE from 'three';

const PALETTES = {
  orman: ['#4a5536', '#2f3a24', '#6b6a45', '#1f2318'],
  col: ['#b39a6a', '#8f7449', '#cbb589', '#6e5a3a'],
  kis: ['#c4cbce', '#8d969b', '#eef2f4', '#5f676b'],
};

const texCache = new Map();

/** Kamuflaj: zemin rengi + düzensiz lekeler + panel çizgileri + alt çamur. */
function camoTexture(kind) {
  if (texCache.has(kind)) return texCache.get(kind);
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const pal = PALETTES[kind] ?? PALETTES.orman;
  g.fillStyle = pal[0];
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = pal[1 + (i % 3)];
    const cx = Math.random() * S, cy = Math.random() * S;
    const r = 18 + Math.random() * 46;
    g.beginPath();
    const n = 9;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rr = r * (0.55 + Math.random() * 0.6);
      g.lineTo(cx + Math.cos(a) * rr * 1.4, cy + Math.sin(a) * rr * 0.8);
    }
    g.closePath();
    g.fill();
  }
  // İnce boya tanesi
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + Math.random() * 0.05})`;
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  // Zırh panel derzleri ve perçinler
  g.strokeStyle = 'rgba(0,0,0,0.28)';
  g.lineWidth = 2;
  for (let x = 0; x <= S; x += S / 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
  g.beginPath(); g.moveTo(0, S / 2); g.lineTo(S, S / 2); g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let x = 6; x < S; x += 16) {
    for (const y of [6, S / 2 + 6, S - 6]) { g.beginPath(); g.arc(x, y, 1.8, 0, Math.PI * 2); g.fill(); }
  }
  // Çizik ve aşınma
  g.strokeStyle = 'rgba(210,205,190,0.18)';
  g.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 12); g.stroke();
  }
  // Alt kısımda çamur
  const mud = g.createLinearGradient(0, S * 0.72, 0, S);
  mud.addColorStop(0, 'rgba(70,56,38,0)');
  mud.addColorStop(1, 'rgba(70,56,38,0.55)');
  g.fillStyle = mud;
  g.fillRect(0, S * 0.72, S, S * 0.28);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  texCache.set(kind, tex);
  return tex;
}

/** Lastik sırtı: koyu kauçuk üzerinde blok desen. */
function treadTexture() {
  if (texCache.has('tread')) return texCache.get('tread');
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1b1a';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#2b2a27';
  for (let x = 0; x < 256; x += 16) {
    g.fillRect(x, 4, 9, 24);
    g.fillRect(x + 8, 36, 9, 24);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set('tread', tex);
  return tex;
}

/**
 * Aracı kurar. kind: 'orman' | 'col' | 'kis' (kamuflaj paleti)
 * @returns {THREE.Group} kök (ön +X)
 */
export function buildAPC(kind = 'orman') {
  const camo = camoTexture(kind);
  const camoBox = camo.clone();
  camoBox.needsUpdate = true;
  const camoHull = camo.clone();
  camoHull.repeat.set(0.28, 0.28);        // eğimli gövde UV'leri metre cinsinden
  camoHull.needsUpdate = true;

  const M = {
    hull: new THREE.MeshStandardMaterial({ map: camoHull, roughness: 0.78, metalness: 0.28 }),
    panel: new THREE.MeshStandardMaterial({ map: camoBox, roughness: 0.8, metalness: 0.25 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x24271f, roughness: 0.85, metalness: 0.3 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x3c3f3a, roughness: 0.5, metalness: 0.7 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x232627, roughness: 0.42, metalness: 0.8 }),
    rubber: new THREE.MeshStandardMaterial({ map: treadTexture(), roughness: 0.95, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ map: camoBox, color: 0xa0a090, roughness: 0.7, metalness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1b262b, roughness: 0.08, metalness: 0.65 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xffe9b0, emissiveIntensity: 1.6 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x5a0d08, emissive: 0xa0140a, emissiveIntensity: 1.2 }),
    can: new THREE.MeshStandardMaterial({ color: 0x3f4a2c, roughness: 0.7, metalness: 0.3 }),
  };

  const root = new THREE.Group();
  root.name = 'apc';
  const hull = new THREE.Group();
  hull.name = 'hull';
  root.add(hull);

  const add = (parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, name = '') => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    if (name) m.name = name;
    parent.add(m);
    return m;
  };
  const box = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
  const cyl = (r1, r2, h, seg = 16) => new THREE.CylinderGeometry(r1, r2, h, seg);

  // ── Ana gövde: yan profilden çekilmiş, eğimli burun ve arka ──────────
  const shape = new THREE.Shape();
  [
    [-3.0, 0.55], [-3.06, 1.42], [-2.86, 1.86], [1.0, 1.93],
    [2.02, 1.5], [2.92, 1.33], [3.1, 0.98], [2.78, 0.55],
  ].forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  const W = 2.36;
  const body = new THREE.ExtrudeGeometry(shape, {
    depth: W, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2,
  });
  body.translate(0, 0, -W / 2);
  add(hull, body, M.hull, 0, 0, 0);

  // Alt şasi ve tekerlek yuvaları
  add(hull, box(5.4, 0.36, 2.2), M.dark, 0, 0.5, 0);
  for (const x of [-1.6, 1.6]) {
    for (const s of [-1, 1]) {
      add(hull, box(1.62, 0.12, 0.44), M.panel, x, 1.32, s * 1.27);          // çamurluk
      add(hull, box(0.08, 0.5, 0.42), M.dark, x - 0.85, 0.82, s * 1.27);     // çamur perdesi
    }
  }

  // Yan kapılar (çerçeve, kol, menteşe) ve yan pencereler
  for (const s of [-1, 1]) {
    add(hull, box(1.0, 1.0, 0.04), M.panel, 0.45, 1.2, s * (W / 2 + 0.07));
    add(hull, box(0.16, 0.05, 0.05), M.steel, 0.82, 1.18, s * (W / 2 + 0.11));
    for (const y of [0.85, 1.55]) add(hull, box(0.1, 0.1, 0.06), M.steel, -0.02, y, s * (W / 2 + 0.1));
    add(hull, box(0.52, 0.28, 0.03), M.glass, 0.5, 1.55, s * (W / 2 + 0.1), 0, 0, 0, 'glass_side');
    add(hull, box(0.42, 0.26, 0.03), M.glass, -0.75, 1.57, s * (W / 2 + 0.08), 0, 0, 0, 'glass_side2');
    // Basamak ve tutamak
    add(hull, box(0.6, 0.05, 0.22), M.steel, 0.45, 0.58, s * (W / 2 + 0.12));
    add(hull, cyl(0.025, 0.025, 0.7, 6), M.steel, -0.45, 1.3, s * (W / 2 + 0.12));
    // Bidonlar (arka yan)
    for (let k = 0; k < 2; k++) {
      add(hull, box(0.18, 0.46, 0.34), M.can, -2.2 + k * 0.4, 1.18, s * (W / 2 + 0.16));
    }
    // Yan aynalar
    add(hull, cyl(0.015, 0.015, 0.5, 5), M.steel, 2.0, 1.72, s * (W / 2 + 0.18), s * 0.9, 0, 0);
    add(hull, box(0.05, 0.24, 0.16), M.dark, 2.0, 1.95, s * (W / 2 + 0.36));
  }

  // Ön cam: eğimli yüzeyde iki zırhlı pencere + silecekler
  const slope = Math.atan2(1.93 - 1.5, 2.02 - 1.0);
  for (const z of [-0.52, 0.52]) {
    add(hull, box(0.86, 0.03, 0.78), M.glass, 1.5, 1.73, z, 0, 0, -slope, 'glass_front');
    add(hull, box(0.5, 0.015, 0.02), M.steel, 1.55, 1.67, z, 0, 0.3, -slope);
  }

  // Burun: ızgara, farlar ve koruyucu kafes, tampon, vinç
  add(hull, box(0.06, 0.32, 1.3), M.dark, 3.08, 1.0, 0);
  for (let k = -3; k <= 3; k++) add(hull, box(0.07, 0.26, 0.04), M.steel, 3.1, 1.0, k * 0.17);
  for (const s of [-1, 1]) {
    add(hull, cyl(0.11, 0.11, 0.08, 14), M.lamp, 3.0, 1.2, s * 0.86, 0, 0, Math.PI / 2, 'lamp');
    add(hull, box(0.04, 0.26, 0.26), M.steel, 3.08, 1.2, s * 0.86);
    add(hull, box(0.05, 0.12, 0.08), M.lamp, 3.02, 0.82, s * 1.05);
  }
  add(hull, box(0.25, 0.22, 2.3), M.steel, 3.12, 0.62, 0);
  add(hull, box(0.3, 0.2, 0.5), M.dark, 3.2, 0.62, 0);
  for (const s of [-1, 1]) add(hull, cyl(0.04, 0.04, 0.18, 8), M.steel, 3.32, 0.62, s * 0.7, 0, 0, Math.PI / 2);

  // Arka: arka kapı (menteşede), stop lambaları, egzoz, çekme kancası
  // Kapı boşluğu: kapı açılınca karanlık iç görünür (kapalıyken kapının ardında)
  add(hull, box(0.004, 1.0, 1.0), M.dark, -3.124, 1.05, 0);
  const door = new THREE.Group();
  door.name = 'hatch6';
  door.position.set(-3.16, 1.05, -0.5);
  hull.add(door);
  add(door, box(0.07, 1.0, 1.0), M.panel, 0, 0, 0.5);
  add(door, box(0.04, 0.28, 0.32), M.glass, -0.03, 0.25, 0.5, 0, 0, 0, 'glass_door');
  add(door, box(0.06, 0.06, 0.22), M.steel, -0.05, -0.05, 0.85);
  for (const y of [-0.35, 0.35]) add(door, box(0.08, 0.1, 0.1), M.steel, -0.02, y, 0.02);
  for (const s of [-1, 1]) {
    add(hull, box(0.05, 0.14, 0.1), M.tail, -3.1, 1.3, s * 1.05);
    add(hull, box(0.06, 0.08, 0.08), M.lamp, -3.1, 1.12, s * 1.05);
  }
  add(hull, box(0.18, 0.18, 0.3), M.steel, -3.15, 0.62, 0.8);
  add(hull, cyl(0.06, 0.06, 1.1, 10), M.dark, -2.78, 1.95, -1.12);
  const exhaust = new THREE.Object3D();
  exhaust.name = 'exhaust';
  exhaust.position.set(-2.78, 2.52, -1.12);
  hull.add(exhaust);

  // Tavan: kapaklar, telsiz antenleri, kule halkası
  add(hull, box(0.6, 0.06, 0.6), M.panel, 0.55, 1.97, -0.62);
  add(hull, box(0.6, 0.06, 0.6), M.panel, -1.9, 1.89, 0.55);
  for (const z of [-0.95, 0.95]) {
    add(hull, cyl(0.04, 0.05, 0.12, 6), M.dark, -2.65, 1.92, z);
    add(hull, cyl(0.008, 0.012, 2.3, 4), M.dark, -2.65, 3.1, z, 0, 0, 0, 'antenna');
  }
  add(hull, cyl(0.62, 0.66, 0.14, 24), M.dark, -0.45, 1.98, 0.15);

  // ── Kule: dönen taban (Mesh) + zırh kalkanı + ağır makineli ─────────
  const turret = add(root, cyl(0.56, 0.6, 0.32, 24), M.panel, -0.45, 2.2, 0.15, 0, 0, 0, 'turret');
  add(turret, box(0.07, 0.6, 1.1), M.panel, 0.55, 0.38, 0, 0, 0, -0.12);           // ön kalkan
  for (const s of [-1, 1]) add(turret, box(0.7, 0.5, 0.06), M.panel, 0.2, 0.33, s * 0.55, 0, s * 0.35, 0);
  add(turret, box(0.28, 0.12, 0.06), M.glass, 0.57, 0.5, 0.25, 0, 0, -0.12, 'glass_turret');
  add(turret, cyl(0.05, 0.06, 0.42, 8), M.steel, 0.3, 0.32, 0);                     // kaide
  const gun = new THREE.Group();
  gun.position.set(0.32, 0.56, 0);
  turret.add(gun);
  add(gun, box(0.62, 0.17, 0.15), M.gun, 0, 0, 0);
  add(gun, box(0.18, 0.12, 0.08), M.gun, -0.34, -0.02, 0);
  for (const s of [-1, 1]) add(gun, cyl(0.012, 0.012, 0.14, 6), M.steel, -0.42, -0.02, s * 0.06, 0, 0, Math.PI / 2);
  add(gun, cyl(0.03, 0.03, 1.15, 10), M.gun, 0.86, 0.02, 0, 0, 0, Math.PI / 2);
  add(gun, cyl(0.048, 0.048, 0.36, 12), M.gun, 0.45, 0.02, 0, 0, 0, Math.PI / 2);
  add(gun, cyl(0.04, 0.03, 0.1, 10), M.gun, 1.46, 0.02, 0, 0, 0, Math.PI / 2);
  add(gun, box(0.2, 0.18, 0.12), M.can, -0.05, -0.12, -0.16);                       // mermi kutusu
  const muzzle = new THREE.Object3D();
  muzzle.name = 'weapon_muzzle';
  muzzle.position.set(1.52, 0.02, 0);
  gun.add(muzzle);

  // Kule nişancısının ayakları gövde içinde, gövdesi kapakta
  const gunner = new THREE.Object3D();
  gunner.name = 'gunner_a';
  gunner.position.set(-0.6, 1.5, 0.15);      // baş ve omuzlar kalkanın üstünde
  root.add(gunner);

  // ── Tekerlekler (pivotları vehicle.js kurar) ───────────────────────
  const tireGeo = cyl(0.62, 0.62, 0.46, 24);
  tireGeo.rotateX(Math.PI / 2);
  const tireUV = tireGeo.attributes.uv;
  for (let i = 0; i < tireUV.count; i++) tireUV.setX(i, tireUV.getX(i) * 6);
  [['wheel', 1.6, -1.27], ['wheel2', 1.6, 1.27], ['wheel3', -1.6, -1.27], ['wheel4', -1.6, 1.27]]
    .forEach(([name, x, z]) => {
      const w = new THREE.Group();
      w.name = name;
      w.position.set(x, 0.62, z);
      root.add(w);
      add(w, tireGeo, M.rubber, 0, 0, 0);
      const s = Math.sign(z);
      add(w, cyl(0.36, 0.36, 0.06, 18), M.rim, 0, 0, s * 0.215, Math.PI / 2, 0, 0);
      add(w, cyl(0.12, 0.14, 0.12, 10), M.steel, 0, 0, s * 0.26, Math.PI / 2, 0, 0);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        add(w, cyl(0.022, 0.022, 0.05, 6), M.steel, Math.cos(a) * 0.24, Math.sin(a) * 0.24, s * 0.25, Math.PI / 2, 0, 0);
      }
    });

  // ── İniş noktaları ve koltuklar ─────────────────────────────────────
  for (const [name, x, z] of [
    ['groundpoint', 0.45, -2.3], ['groundpoint4', -0.6, -2.3],
    ['groundpoint5', -0.6, 2.3], ['groundpoint2', 0.45, 2.3], ['groundpoint6', -4.2, 0],
  ]) {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x, 0.04, z);
    root.add(o);
  }
  const driver = new THREE.Object3D();
  driver.name = 'driver';
  driver.position.set(1.3, 1.0, -0.5);
  root.add(driver);

  return root;
}

/** Alanın zeminine göre kamuflaj paleti. */
export function camoFor(map) {
  if (map?.zemin === 'kum') return 'col';
  if (map?.zemin === 'kar') return 'kis';
  return 'orman';
}
