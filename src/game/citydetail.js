/* Şehrin ayrıntıları: parklar, gökdelenler, dükkânlar, ağaçlı sokaklar.

   city.js her bloğu kurarken buraya sorar. Hepsi bloğun tohumlu
   rastgelesiyle (`rand`) üretilir: blok her kurulduğunda aynı görünür.
   Geometri blok başına birleştirilir (ağaçlar iki, banklar tek çizim).

   • PARK: çimen, çapraz ve halka yollar, ortada çeşme, ağaçlar, banklar.
     Bank oturma noktaları bloğa yazılır (`benches`) — parklife.js
     düşman askerlerini oraya oturtur.
   • GÖKDELEN: 16–30 kat cam kule (en yüksek binayı — Tümgeneral'in 128 m
     kulesini — geçmez).
   • DÜKKÂN: binaların zemin katında vitrin + tabela + tente (market,
     fırın, eczane, kafe, berber…). Nadiren SİLAH DÜKKÂNI: önünde E ile
     alışveriş (yalnızca seçeneği açık şehirlerde).                       */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { grassTexture, concreteTexture } from './textures.js';
import { structures } from './structures.js';

export const SHOP_KINDS = [
  { name: 'MARKET', bg: '#1f6d3a', fg: '#ffffff', awning: 0x2a8a4a },
  { name: 'FIRIN', bg: '#8a4b1c', fg: '#ffe7b8', awning: 0xb8662a },
  { name: 'ECZANE', bg: '#c8102e', fg: '#ffffff', awning: 0xd8d8d0 },
  { name: 'KAFE', bg: '#3b2a20', fg: '#f3d9a8', awning: 0x6b4a34 },
  { name: 'BERBER', bg: '#1d3f78', fg: '#ffffff', awning: 0xc23b3b },
  { name: 'KASAP', bg: '#7c1414', fg: '#ffffff', awning: 0xe8e2d4 },
  { name: 'TERZİ', bg: '#4a3a64', fg: '#f1e6ff', awning: 0x6d5a90 },
  { name: 'ÇİÇEKÇİ', bg: '#2f6e5c', fg: '#ffe0f0', awning: 0xd06a9a },
  { name: 'KIRTASİYE', bg: '#215a8a', fg: '#fff6c8', awning: 0xe0b23a },
  { name: 'LOKANTA', bg: '#5a2a14', fg: '#ffd27a', awning: 0x9a3a1a },
  { name: 'BAKKAL', bg: '#3a5a1c', fg: '#ffffff', awning: 0xd8a83a },
  { name: 'ELEKTRONİK', bg: '#1a1d22', fg: '#6fd0ff', awning: 0x2e3a48 },
];
export const GUN_SHOP = { name: 'SİLAH DÜKKÂNI', bg: '#141414', fg: '#e8a33d', awning: 0x8a1a12, gun: true };

const _tex = new Map();

/** Vitrin + tabela dokusu (8 m × 3.4 m cephe için). */
function shopTexture(kind) {
  if (_tex.has(kind.name)) return _tex.get(kind.name);
  const W = 512, H = 220;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // Tabela bandı
  g.fillStyle = kind.bg;
  g.fillRect(0, 0, W, 62);
  g.fillStyle = kind.fg;
  g.font = `700 ${kind.name.length > 10 ? 34 : 42}px "Saira Condensed", "Arial Narrow", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(kind.name, W / 2, 33);
  // Vitrin: koyu cam, içinde raf siluetleri, ortada kapı
  g.fillStyle = '#26303a';
  g.fillRect(0, 62, W, H - 62);
  const glass = g.createLinearGradient(0, 62, W, H);
  glass.addColorStop(0, 'rgba(160,190,210,0.28)');
  glass.addColorStop(0.5, 'rgba(60,80,95,0.05)');
  glass.addColorStop(1, 'rgba(160,190,210,0.2)');
  for (let k = 0; k < 3; k++) {
    g.fillStyle = 'rgba(255,240,210,0.08)';
    g.fillRect(14, 92 + k * 40, W / 2 - 64, 4);
    g.fillRect(W / 2 + 50, 92 + k * 40, W / 2 - 64, 4);
    for (let n = 0; n < 9 && !kind.gun; n++) {
      g.fillStyle = `hsla(${(n * 47 + kind.name.length * 30) % 360},45%,55%,0.55)`;
      g.fillRect(20 + n * 22, 70 + k * 40, 14, 20);
      g.fillRect(W / 2 + 56 + n * 22, 70 + k * 40, 14, 20);
    }
  }
  if (kind.gun) {
    // Silah dükkânı: vitrinde tüfek siluetleri, kapıda amber çerçeve
    g.fillStyle = '#0c0c0c';
    for (let k = 0; k < 4; k++) {
      g.fillRect(22, 78 + k * 32, 170, 7);
      g.fillRect(22 + 40, 85 + k * 32, 10, 12);
      g.fillRect(W - 192, 78 + k * 32, 170, 7);
      g.fillRect(W - 152, 85 + k * 32, 10, 12);
    }
  }
  g.fillStyle = glass;
  g.fillRect(0, 62, W, H - 62);
  // Kapı
  g.fillStyle = kind.gun ? '#e8a33d' : '#1a1f24';
  g.fillRect(W / 2 - 40, 70, 80, H - 70);
  g.fillStyle = '#0f1418';
  g.fillRect(W / 2 - 34, 76, 68, H - 76);
  // Kepenk rayı ve çerçeve
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillRect(0, 60, W, 4);
  g.fillRect(0, 62, 6, H); g.fillRect(W - 6, 62, 6, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _tex.set(kind.name, t);
  return t;
}

let _m = null;
function mats() {
  if (_m) return _m;
  const grass = grassTexture(1).clone();
  grass.repeat.set(14, 14);
  grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
  grass.needsUpdate = true;
  const path = concreteTexture(1).clone();
  path.repeat.set(6, 1);
  path.wrapS = path.wrapT = THREE.RepeatWrapping;
  path.needsUpdate = true;
  _m = {
    grass: new THREE.MeshStandardMaterial({ map: grass, color: 0x9fb07a, roughness: 0.96 }),
    path: new THREE.MeshStandardMaterial({ map: path, color: 0xc9c2b2, roughness: 0.92 }),
    bark: new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x4d6b34, roughness: 0.9, flatShading: true }),
    wood: new THREE.MeshStandardMaterial({ color: 0x7a5233, roughness: 0.85 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.6, metalness: 0.6 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xb6b0a4, roughness: 0.9 }),
    water: new THREE.MeshStandardMaterial({ color: 0x3f6f86, roughness: 0.15, metalness: 0.2 }),
    glass: null,
    awnings: new Map(),
  };
  return _m;
}

function awning(color) {
  const M = mats();
  if (!M.awnings.has(color)) M.awnings.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  return M.awnings.get(color);
}

/* ── Ağaç geometrisi (birleştirilecek parçalar) ─────────────────────── */

function treeParts(x, z, s, rand, trunks, crowns) {
  const h = (2.6 + rand() * 1.6) * s;
  trunks.push(new THREE.CylinderGeometry(0.12 * s, 0.18 * s, h, 6).translate(x, h / 2, z));
  const r = (1.6 + rand() * 0.9) * s;
  crowns.push(new THREE.IcosahedronGeometry(r, 1).scale(1, 0.9, 1).translate(x, h + r * 0.55, z));
  if (rand() < 0.6) {
    const r2 = r * 0.7;
    crowns.push(new THREE.IcosahedronGeometry(r2, 1).translate(x + (rand() - 0.5) * r, h + r * 1.1, z + (rand() - 0.5) * r));
  }
  return h;
}

function mergedMesh(list, mat) {
  if (!list.length) return null;
  const geo = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  for (const g of list) g.dispose();
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

/* ── Park ────────────────────────────────────────────────────────────── */

/**
 * @param ctx  city.js blok bağlamı: { own, solid, L, colliders, cover, rand, B, K }
 * @returns { benches: [{ pos, face, seatY }] }
 */
export function buildPark(ctx) {
  const { own, L, colliders, cover, rand, B, K } = ctx;
  const M = mats();
  const inner = B - 2 * K;              // kaldırımın içindeki alan
  const c = B / 2;
  // Çimen
  const grass = own(new THREE.Mesh(new THREE.PlaneGeometry(inner, inner), M.grass));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(c, 0.05, -c);
  grass.castShadow = false;
  // Yollar: iki çapraz + halka (8 kenarlı)
  const paths = [];
  paths.push(new THREE.PlaneGeometry(3, inner).rotateX(-Math.PI / 2).translate(c, 0.07, -c));
  paths.push(new THREE.PlaneGeometry(inner, 3).rotateX(-Math.PI / 2).translate(c, 0.07, -c));
  const ringR = inner * 0.3;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const len = 2 * ringR * Math.sin(Math.PI / 8) + 0.6;
    paths.push(new THREE.PlaneGeometry(len, 2.6).rotateX(-Math.PI / 2).rotateY(-a + Math.PI / 2)
      .translate(c + Math.cos(a) * ringR * Math.cos(Math.PI / 8), 0.075, -(c + Math.sin(a) * ringR * Math.cos(Math.PI / 8))));
  }
  const pm = own(mergedMesh(paths, M.path));
  pm.castShadow = false;

  // Çeşme
  const basin = own(new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.7, 20), M.stone));
  basin.position.set(c, 0.35, -c);
  const water = own(new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 0.1, 20), M.water));
  water.position.set(c, 0.62, -c);
  const spout = own(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 1.6, 10), M.stone));
  spout.position.set(c, 1.1, -c);
  ctx.solid(basin);

  // Ağaçlar: yolların dışında, dört çeyrekte
  const trunks = [], crowns = [];
  const n = 14 + Math.floor(rand() * 8);
  for (let k = 0; k < n; k++) {
    let x, z, tries = 0;
    do {
      x = K + 3 + rand() * (inner - 6);
      z = K + 3 + rand() * (inner - 6);
      tries++;
    } while (tries < 12 && (Math.abs(x - c) < 4 || Math.abs(z - c) < 4
      || Math.abs(Math.hypot(x - c, z - c) - ringR) < 3.5 || Math.hypot(x - c, z - c) < 6));
    const s = 0.85 + rand() * 0.5;
    if (structures.get('agac')) {
      // Blender şehir varlığı: ağaç
      const tree = structures.place('agac', ctx.group, x, -z, rand() * 6, { colliders }, ctx.corner);
      tree?.scale.setScalar(s);
      continue;
    }
    const h = treeParts(x, -z, s, rand, trunks, crowns);
    const w = L(x, z);
    colliders.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(w.x, h / 2, w.z), new THREE.Vector3(0.5, h, 0.5)));
  }
  for (const m of [mergedMesh(trunks, M.bark), mergedMesh(crowns, M.leaf)]) if (m) own(m);
  // Büfe: parkın güneybatı çeyreğinde, yola dönük
  if (structures.get('bufe')) {
    structures.place('bufe', ctx.group, c - 9, -(c - ringR - 6), 0, { solids: ctx.solids, colliders }, ctx.corner);
  }

  // Banklar: halka yolun dış kenarında, yola dönük
  const benches = [];
  const parts = [];
  const nb = 6 + Math.floor(rand() * 4);
  for (let k = 0; k < nb; k++) {
    const a = (k / nb) * Math.PI * 2 + 0.2;
    const r = ringR + 2.4;
    const x = c + Math.cos(a) * r, z = c + Math.sin(a) * r;
    if (structures.get('bank')) {
      // Blender şehir varlığı: bank (ön yüzü +Z) merkeze dönük
      const rot = Math.atan2(c - x, -(c - z));
      structures.place('bank', ctx.group, x, -z, rot, { colliders }, ctx.corner);
      if (k % 3 === 0 && structures.get('cop_kutusu')) {
        structures.place('cop_kutusu', ctx.group, x + Math.cos(a + 0.4) * 1.6, -(z + Math.sin(a + 0.4) * 1.6), 0, { colliders }, ctx.corner);
      }
      const w = L(x, z);
      // Oyun yönü (ileri −Z): modelin önü (sin, cos) → yön = dönüş + π
      benches.push({ pos: new THREE.Vector3(w.x, 0, w.z), face: rot + Math.PI, seatY: 0.47, taken: null });
      continue;
    }
    // Bank yola (merkeze) dönük: ileri yönü merkeze
    const yawLocal = Math.atan2(-(c - x), (c - z));      // yerel: x doğu, −z kuzey
    const g = [];
    g.push(new THREE.BoxGeometry(1.8, 0.07, 0.45).translate(0, 0.45, 0));          // oturak
    g.push(new THREE.BoxGeometry(1.8, 0.4, 0.06).translate(0, 0.72, 0.21));        // sırtlık
    for (const sx of [-0.8, 0.8]) {
      g.push(new THREE.BoxGeometry(0.06, 0.45, 0.42).translate(sx, 0.225, 0));
      g.push(new THREE.BoxGeometry(0.06, 0.45, 0.06).translate(sx, 0.72, 0.21));
    }
    const geo = mergeGeometries(g.map((q) => q.toNonIndexed()), false);
    for (const q of g) q.dispose();
    geo.rotateY(yawLocal).translate(x, 0, -z);
    parts.push(geo);
    const w = L(x, z);
    colliders.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(w.x, 0.45, w.z), new THREE.Vector3(1.4, 0.9, 1.4)));
    // Dünya yönü: yerel yaw aynı (blok grubu dönmüyor). Oyun yaw'ı: ileri −Z
    benches.push({ pos: new THREE.Vector3(w.x, 0, w.z), face: yawLocal, seatY: 0.47, taken: null });
    cover.push({ pos: L(x + Math.cos(a) * 1.2, z + Math.sin(a) * 1.2), normal: new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), taken: null });
  }
  const bm = mergedMesh(parts, M.wood);
  if (bm) own(bm);
  // Park lambaları
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const x = c + Math.cos(a) * (ringR - 2.2), z = c + Math.sin(a) * (ringR - 2.2);
    const pole = own(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.6, 6), M.iron));
    pole.position.set(x, 1.8, -z);
    const lamp = own(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), ctx.M.lamp));
    lamp.position.set(x, 3.7, -z);
  }
  return { benches };
}

/* ── Sokak ağaçları ──────────────────────────────────────────────────── */

export function buildStreetTrees(ctx) {
  const { own, L, colliders, rand, B, H } = ctx;
  const M = mats();
  const trunks = [], crowns = [];
  const lat = H + 1.3;                 // kaldırımın ortası
  for (const west of [true, false]) {
    if (rand() < 0.45) continue;
    for (let s = 10; s < B - 8; s += 11 + rand() * 4) {
      if (rand() < 0.2) continue;
      const x = west ? lat : s, z = west ? s : lat;
      if (structures.get('agac')) {
        const tree = structures.place('agac', ctx.group, x, -z, rand() * 6, { colliders }, ctx.corner);
        tree?.scale.setScalar(0.8 + rand() * 0.25);
        continue;
      }
      const h = treeParts(x, -z, 0.75 + rand() * 0.3, rand, trunks, crowns);
      const w = L(x, z);
      colliders.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(w.x, h / 2, w.z), new THREE.Vector3(0.4, h, 0.4)));
    }
  }
  for (const m of [mergedMesh(trunks, M.bark), mergedMesh(crowns, M.leaf)]) if (m) own(m);
}

/* ── Gökdelen ────────────────────────────────────────────────────────── */

export function skyscraperMaterial(facadeMap) {
  const M = mats();
  M.glass ??= [0x8fb2c8, 0x9fb8b0, 0xa8a8b8].map((c) => new THREE.MeshStandardMaterial({
    map: facadeMap, color: c, roughness: 0.28, metalness: 0.55,
  }));
  return M.glass;
}

/* ── Dükkân cephesi ─────────────────────────────────────────────────── */

/**
 * Binanın bir yüzünün zemin katına vitrin + tabela + tente kurar.
 * @param face  'w' | 'e' | 's' | 'n' (yerel: s = güney, −z dünyada +z)
 * @returns dükkânın önündeki nokta (dünya) ve türü
 */
export function buildShopfront(ctx, b, face, kind) {
  const { own, L } = ctx;
  const { cx, cz, w, d } = b;               // bina merkezi (yerel) ve boyutları
  const width = Math.min(face === 'w' || face === 'e' ? d : w, 9) - 0.6;
  const mat = new THREE.MeshStandardMaterial({ map: shopTexture(kind), roughness: 0.4, metalness: 0.1,
    emissive: kind.gun ? 0x2a1606 : 0x000000, emissiveMap: kind.gun ? shopTexture(kind) : null });
  const front = own(new THREE.Mesh(new THREE.PlaneGeometry(width, 3.4), mat));
  front.castShadow = false;
  const aw = own(new THREE.Mesh(new THREE.BoxGeometry(width + 0.4, 0.12, 1.4), awning(kind.awning)));
  // Yüz normali (yerel x doğu, z kuzey) ve yüzey konumu
  const n = { w: [-1, 0], e: [1, 0], s: [0, -1], n: [0, 1] }[face];
  const fx = cx + n[0] * (w / 2 + 0.03), fz = cz + n[1] * (d / 2 + 0.03);
  front.position.set(fx, 1.75, -fz);
  front.rotation.y = Math.atan2(n[0], -n[1]);
  aw.position.set(fx + n[0] * 0.7, 3.55, -(fz + n[1] * 0.7));
  aw.rotation.y = front.rotation.y;
  aw.rotation.x = 0;
  aw.rotateX(-0.22);
  return { pos: L(fx + n[0] * 1.8, fz + n[1] * 1.8), kind };
}

/** Bina yüzlerinden hangisi sokağa bakar (parselin blok kenarına göre). */
export function streetFaces(px, pz) {
  return [px === 0 ? 'w' : 'e', pz === 0 ? 's' : 'n'];
}

export function pickShopKind(rand) {
  return SHOP_KINDS[Math.floor(rand() * SHOP_KINDS.length)];
}
