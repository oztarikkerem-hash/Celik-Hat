/* Suikast görevinin şehri: savaş görmüş, yarıçapı 100 km'lik bir şehir.

   Şehir orman yolunun bittiği noktadan (O) kuzeye (−Z) ve iki yana uzanır.
   Bloklar 96 m'lik ızgara: sokak eksenleri x = O.x + i·96 ve z = O.z − j·96
   (j ≥ 0). Yalnızca oyuncunun çevresindeki ~7×7 blok kurulur, uzaklaşanlar
   sökülür (orman yolu gibi akış) — şehir ne kadar büyük olursa olsun yük
   sabittir. Her blok dünyaya "fixture" olarak eklenir (çarpışma, mermi
   engeli, siper). Bina cepheleri, sokak çizgileri ve savaş izleri (yanık
   araç, kum torbası, beton bariyer, moloz) blok başına tohumlu rastgele.

   Özel bloklar (görev): tabancanın olduğu sığınak ev ve düşman komutanının
   karargâhı (`specials`).                                                 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { concreteTexture, asphaltTexture } from './textures.js';
import {
  buildPark, buildStreetTrees, buildShopfront, streetFaces, pickShopKind, skyscraperMaterial, GUN_SHOP,
} from './citydetail.js';
import { structures, SHOP_MODELS } from './structures.js';

// Model ön yüzü +Z: sokağa bakan yüze göre dönüş (yerel: x doğu, z kuzey)
const FACE_ROT = { s: 0, n: Math.PI, w: -Math.PI / 2, e: Math.PI / 2 };
const FACE_N = { w: [-1, 0], e: [1, 0], s: [0, -1], n: [0, 1] };

export const CITY = {
  block: 96,
  half: 5.5,            // asfalt yarı genişliği (sokak ekseninden)
  walk: 2.6,            // kaldırım genişliği
  view: 2,              // oyuncunun bloğundan bu kadar blok öteye kadar kurulur (sis 210 m'de kapatır; 3 iken Blender binalarıyla 2.2 M üçgen çiziliyordu)
  radius: 100000,       // şehir yarıçapı (m)
};

function seeded(n) {
  let s = (n * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return (s % 100000) / 100000;
  };
}

/** Apartman cephesi: 4 kat × 4 pencere (bir döşeme 12 × 12 m). */
function facadeTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#c9c2b4';
  g.fillRect(0, 0, S, S);
  // Sıva tanesi
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '60,55,50' : '255,250,240'},${Math.random() * 0.07})`;
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  const cell = S / 4;
  for (let fy = 0; fy < 4; fy++) {
    // Kat silmesi
    g.fillStyle = 'rgba(70,64,58,0.35)';
    g.fillRect(0, fy * cell + cell - 6, S, 6);
    for (let fx = 0; fx < 4; fx++) {
      const x = fx * cell + 30, y = fy * cell + 26, w = cell - 60, h = cell - 52;
      const r = Math.random();
      // Pencere: koyu cam, kırık (siyah) ya da tahta çakılı
      g.fillStyle = '#4a4740';
      g.fillRect(x - 5, y - 5, w + 10, h + 10);
      if (r < 0.18) {
        g.fillStyle = '#0b0b0a';
        g.fillRect(x, y, w, h);
      } else if (r < 0.26) {
        g.fillStyle = '#6d5a40';
        for (let k = 0; k < 4; k++) g.fillRect(x, y + k * (h / 4) + 2, w, h / 4 - 5);
      } else {
        const gr = g.createLinearGradient(x, y, x + w, y + h);
        gr.addColorStop(0, '#2a3a44');
        gr.addColorStop(1, '#5d727c');
        g.fillStyle = gr;
        g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(30,30,28,0.9)';
        g.fillRect(x + w / 2 - 2, y, 4, h);
      }
      // İs lekesi (savaş)
      if (r < 0.2) {
        const sg = g.createLinearGradient(x, y, x, y - 70);
        sg.addColorStop(0, 'rgba(20,18,16,0.55)');
        sg.addColorStop(1, 'rgba(20,18,16,0)');
        g.fillStyle = sg;
        g.fillRect(x - 6, y - 70, w + 12, 70);
      }
    }
  }
  // Kurşun izleri
  for (let i = 0; i < 70; i++) {
    g.fillStyle = 'rgba(40,36,32,0.6)';
    g.beginPath();
    g.arc(Math.random() * S, Math.random() * S, 1 + Math.random() * 2.5, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Kutu: yan yüzlerin UV'leri metre/döşeme (12 m) ölçeğinde. */
export function buildingGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / 12, uv.getY(i) * dims[f][1] / 12);
    }
  }
  return g;
}

export class City {
  /**
   * opts.radius: şehir yarıçapı (m) — Taarruz'da aynı şehir 500 km.
   * opts.gunShops: nadir silah dükkânları açık mı (Tümgeneral).
   */
  constructor(game, opts = {}) {
    this.game = game;
    this.radius = opts.radius ?? CITY.radius;
    this.gunShops = Boolean(opts.gunShops);
    this.active = false;
    this.chunks = new Map();
    this.specials = new Map();     // "i,j" → (ctx) => void
    this.O = new THREE.Vector3();
    this._m = null;
  }

  _mats() {
    if (this._m) return this._m;
    const W = this.game.world.materials;
    const facade = facadeTexture();
    const tint = (c) => new THREE.MeshStandardMaterial({ map: facade, color: c, roughness: 0.9, metalness: 0.02 });
    const asph = asphaltTexture(1).clone();
    asph.repeat.set(12, 12);
    asph.wrapS = asph.wrapT = THREE.RepeatWrapping;
    asph.needsUpdate = true;
    const conc = concreteTexture(1).clone();
    conc.repeat.set(10, 10);
    conc.wrapS = conc.wrapT = THREE.RepeatWrapping;
    conc.needsUpdate = true;
    this._m = {
      facades: [tint(0xffffff), tint(0xd8d2c0), tint(0xc4ccc8), tint(0xe2d0b0), tint(0xa8a29a)],
      burnt: tint(0x5a524a),
      roof: new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 0.95 }),
      asphalt: new THREE.MeshStandardMaterial({ map: asph, roughness: 0.92, metalness: 0.02 }),
      walk: new THREE.MeshStandardMaterial({ map: conc, color: 0xb8b4ac, roughness: 0.95 }),
      line: new THREE.MeshStandardMaterial({ color: 0xd8d4c4, roughness: 0.8 }),
      wreck: new THREE.MeshStandardMaterial({ color: 0x2b2724, roughness: 0.85, metalness: 0.35 }),
      rust: new THREE.MeshStandardMaterial({ color: 0x5c3420, roughness: 0.9, metalness: 0.2 }),
      barrier: new THREE.MeshStandardMaterial({ map: conc, color: 0xc8c4bc, roughness: 0.9 }),
      bag: W.sandbag, rock: W.rock, steel: W.darkSteel, lamp: W.lamp,
    };
    return this._m;
  }

  /** O: şehre giriş noktası (orman yolunun sonu). */
  start(O) {
    this.stop();
    this.O.copy(O);
    this.active = true;
    this._mats();
  }

  stop() {
    for (const k of [...this.chunks.keys()]) this._drop(k);
    this.active = false;
  }

  /* ── Izgara yardımcıları ──────────────────────────────────────────── */

  cellOf(x, z) {
    const B = CITY.block;
    return [Math.floor((x - this.O.x) / B), Math.floor((this.O.z - z) / B)];
  }

  /** Bloğun güneybatı köşesi (sokak kesişimi). */
  corner(i, j) {
    return new THREE.Vector3(this.O.x + i * CITY.block, 0, this.O.z - j * CITY.block);
  }

  /** Bloğun ortası. */
  center(i, j) {
    const c = this.corner(i, j);
    return c.set(c.x + CITY.block / 2, 0, c.z - CITY.block / 2);
  }

  inCity(x, z) {
    if (this.O.z - z < -CITY.half) return false;        // girişin güneyi orman
    const cx = this.O.x, cz = this.O.z - this.radius;
    return Math.hypot(x - cx, z - cz) < this.radius;
  }

  /**
   * Navigasyon: sokaklar boyunca kırık çizgi rota. Önce en yakın kuzey-güney
   * sokağına, oradan hedefin doğu-batı sokağına, sonra hedefe.
   */
  route(from, to) {
    const B = CITY.block;
    const xs = this.O.x + Math.round((from.x - this.O.x) / B) * B;
    const zt = this.O.z - Math.max(0, Math.round((this.O.z - to.z) / B)) * B;
    return [from.clone(), new THREE.Vector3(xs, 0, from.z), new THREE.Vector3(xs, 0, zt),
      new THREE.Vector3(to.x, 0, zt), to.clone()];
  }

  /** Bir blok etrafında kaldırımdan dolaşan devriye halkası (saat yönü). */
  loop(i, j) {
    const c = this.corner(i, j), B = CITY.block, k = CITY.half + 1.3;
    return [
      new THREE.Vector3(c.x + k, 0, c.z - k), new THREE.Vector3(c.x + B - k, 0, c.z - k),
      new THREE.Vector3(c.x + B - k, 0, c.z - B + k), new THREE.Vector3(c.x + k, 0, c.z - B + k),
    ];
  }

  /* ── Akış ─────────────────────────────────────────────────────────── */

  update(pos, force = false) {
    if (!this.active) return;
    const [pi, pj] = this.cellOf(pos.x, pos.z);
    const V = CITY.view;
    let changed = false;
    for (const [key, c] of this.chunks) {
      if (Math.abs(c.i - pi) > V + 1 || Math.abs(c.j - pj) > V + 1) { this._drop(key); changed = true; }
    }
    let budget = force ? 99 : 2;
    // Yakından uzağa: önce oyuncunun bloğu
    const want = [];
    for (let dj = -V; dj <= V; dj++) for (let di = -V; di <= V; di++) {
      const i = pi + di, j = pj + dj;
      if (j < 0) continue;
      const c = this.center(i, j);
      if (!this.inCity(c.x, c.z)) continue;
      want.push([Math.max(Math.abs(di), Math.abs(dj)), i, j]);
    }
    want.sort((a, b) => a[0] - b[0]);
    for (const [, i, j] of want) {
      if (budget <= 0) break;
      const key = `${i},${j}`;
      if (this.chunks.has(key)) continue;
      this._build(i, j);
      budget--;
      changed = true;
    }
    if (changed) this.game.world._rebuildIndex();
  }

  _drop(key) {
    const c = this.chunks.get(key);
    if (!c) return;
    this.game.scene.remove(c.group);
    c.group.traverse((o) => { if (o.isMesh && o.userData.own) o.geometry.dispose(); });
    this.game.world.removeFixture(c.fixture);
    for (const l of c.lights) l.parent?.remove(l);
    this.chunks.delete(key);
  }

  _build(i, j) {
    const M = this._m;
    const B = CITY.block, H = CITY.half, K = CITY.half + CITY.walk;
    const rand = seeded(i * 7919 + j * 104729 + 17);
    const c0 = this.corner(i, j);
    const group = new THREE.Group();
    group.position.copy(c0);          // geometri bloğa göre yerel (büyük koordinat titremesin)
    const colliders = [], solids = [], cover = [], lights = [];
    const own = (m) => { m.userData.own = true; m.castShadow = m.receiveShadow = true; group.add(m); return m; };
    const L = (x, z) => new THREE.Vector3(c0.x + x, 0, c0.z - z);     // yerel (x, kuzeye z) → dünya
    const solid = (mesh) => {
      solids.push(mesh);
      group.updateMatrixWorld(true);       // grup konumu (blok köşesi) dahil
      colliders.push(new THREE.Box3().setFromObject(mesh));
    };

    // Zemin: blok boyu asfalt, üstünde kaldırım + arsa betonu
    const ground = own(new THREE.Mesh(new THREE.PlaneGeometry(B, B), M.asphalt));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(B / 2, 0.01, -B / 2);
    ground.castShadow = false;
    const lot = own(new THREE.Mesh(new THREE.PlaneGeometry(B - 2 * H, B - 2 * H), M.walk));
    lot.rotation.x = -Math.PI / 2;
    lot.position.set(B / 2, 0.04, -B / 2);
    lot.castShadow = false;
    // Sokak çizgileri: bloğun batı ve güney kenarındaki sokakların ekseni
    const dash = [];
    for (let k = 2; k < B; k += 6) {
      dash.push(new THREE.PlaneGeometry(0.16, 3).rotateX(-Math.PI / 2).translate(0, 0.03, -k));
      dash.push(new THREE.PlaneGeometry(3, 0.16).rotateX(-Math.PI / 2).translate(k, 0.03, 0));
    }
    const lines = own(new THREE.Mesh(mergeGeometries(dash, false), M.line));
    lines.castShadow = false;
    for (const d of dash) d.dispose();

    const special = this.specials.get(`${i},${j}`);
    const ctx = { group, own, solid, L, colliders, solids, cover, lights, corner: c0, rand, M, i, j, B, H, K };

    // Blok türü: park (%11), gökdelenli (%10), olağan. Giriş sırası olağan.
    const kindR = rand();
    const park = !special && j > 0 && kindR < 0.11;
    const towers = !special && !park && j > 1 && kindR < 0.21;
    // Benzin istasyonu (Blender modeli, ilk gerektiğinde yüklenir): %3
    const station = !special && !park && !towers && j > 1 && kindR > 0.97;
    let benches = [];
    const shops = [];
    if (park) benches = buildPark(ctx).benches;
    let gunShop = this.gunShops && !special && !park && rand() < 0.07;

    // Binalar: arsada 2×2 parsel; özel blokta bir parsel boş kalır
    const lotIn = K + 1.5, span = B - 2 * lotIn;
    const half = span / 2;
    const tall = towers ? Math.floor(rand() * 4) : -1;          // gökdelen parseli
    const lib = structures.cityReady;            // Blender şehir varlıkları yüklü mü
    for (let pz = 0; pz < 2; pz++) for (let px = 0; px < 2; px++) {
      if (park || station) continue;
      if (special?.clear) continue;              // bloğun tamamı özel yapıya ayrılmış
      if (special?.parcel && special.parcel[0] === px && special.parcel[1] === pz) continue;
      let forceRuin = false;
      if (lib && !(!special && !towers && structures.get('ev') && rand() < 0.12)) {
        const res = this._modelParcel(ctx, px, pz, { towers, gunShop, shops });
        if (res === 'gun') gunShop = false;
        if (res !== 'ruin') continue;
        forceRuin = true;
      } else if (lib) {
        // Müstakil evler (yukarıdaki zar tuttu)
        this._housePair(ctx, px, pz);
        continue;
      }
      // Müstakil evler (Blender'deki ev): parselin %12'si, sokağa bakan iki ev
      if (!special && !towers && structures.get('ev') && rand() < 0.12) {
        const face = streetFaces(px, pz)[Math.floor(rand() * 2)];
        const cx = lotIn + px * half + half / 2, cz = lotIn + pz * half + half / 2;
        // Kapı yüzün (sokağın) tarafına: yerel −Z dünyada sokak yönü olmalı
        const rot = { s: Math.PI, n: 0, w: Math.PI / 2, e: -Math.PI / 2 }[face];
        const n = { w: [-1, 0], e: [1, 0], s: [0, -1], n: [0, 1] }[face];
        const t = [n[1], n[0]];
        for (const side of [-1, 1]) {
          const hx = cx + n[0] * 8 + t[0] * side * 6.5, hz = cz + n[1] * 8 + t[1] * side * 6.5;
          structures.place('ev', group, hx, -hz, rot, { solids, colliders }, c0);
        }
        continue;
      }
      const sky = tall === pz * 2 + px || (towers && rand() < 0.25);
      const fw = sky ? half - 6 - rand() * 4 : half - 3 - rand() * 9;
      const fd = sky ? half - 6 - rand() * 4 : half - 3 - rand() * 9;
      const ruined = forceRuin || (!sky && rand() < 0.22);
      // Gökdelen 16–30 kat: Tümgeneral'in 128 m'lik kulesini geçmez
      const floors = sky ? 16 + Math.floor(rand() * 15) : ruined ? 1 + Math.floor(rand() * 3) : 3 + Math.floor(rand() * 10);
      const h = floors * (sky ? 3.4 : 3.1) + (ruined ? rand() * 2 : 0);
      const cx = lotIn + px * half + half / 2 + (rand() - 0.5) * 3;
      const cz = lotIn + pz * half + half / 2 + (rand() - 0.5) * 3;
      const mat = sky ? skyscraperMaterial(M.facades[0].map)[Math.floor(rand() * 3)]
        : ruined ? M.burnt : M.facades[Math.floor(rand() * M.facades.length)];
      const b = own(new THREE.Mesh(buildingGeo(fw, h, fd), [mat, mat, M.roof, M.roof, mat, mat]));
      b.position.set(cx, h / 2, -cz);
      solid(b);
      if (sky) {
        // Çatı tacı ve anten
        const crown = own(new THREE.Mesh(new THREE.BoxGeometry(fw * 0.6, 3, fd * 0.6), M.roof));
        crown.position.set(cx, h + 1.5, -cz);
        const mast = own(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 8, 6), M.steel));
        mast.position.set(cx, h + 7, -cz);
      }
      // Zemin katı dükkânı (yıkık olmayan binaların yarısında)
      if (!ruined && rand() < (sky ? 0.8 : 0.5)) {
        const faces = streetFaces(px, pz);
        const face = faces[Math.floor(rand() * 2)];
        const kind = gunShop ? GUN_SHOP : pickShopKind(rand);
        const shop = buildShopfront(ctx, { cx, cz, w: fw, d: fd }, face, kind);
        if (gunShop) { shops.push(shop); gunShop = false; }
      }
      if (ruined) {
        // Yıkık binanın önünde moloz yığını
        for (let r = 0; r < 4; r++) {
          const rk = own(new THREE.Mesh(this.game.world.geo.rock, M.rock));
          const s = 1 + rand() * 2;
          rk.scale.set(s * 1.4, s * 0.6, s);
          rk.position.set(cx + (rand() - 0.5) * fw, s * 0.25, -(cz - fd / 2 - 1 - rand() * 2));
          rk.rotation.y = rand() * Math.PI;
        }
      }
    }

    // Savaş izleri: sokakta yanık araç, kum torbası mevzisi, beton bariyer
    const nProps = special?.noProps ? 0 : Math.floor(rand() * 4);
    for (let n = 0; n < nProps; n++) {
      const onWest = rand() < 0.5;
      const along = 12 + rand() * (B - 24);
      const lat = (rand() < 0.5 ? -1 : 1) * (1.6 + rand() * 2);
      const x = onWest ? lat : along, z = onWest ? along : lat;
      const kind = rand();
      if (kind < 0.4) {
        const car = own(new THREE.Mesh(new THREE.BoxGeometry(onWest ? 1.9 : 4.4, 1.1, onWest ? 4.4 : 1.9), M.wreck));
        car.position.set(x, 0.62, -z);
        car.rotation.y = (rand() - 0.5) * 0.6;
        solid(car);
        const cab = own(new THREE.Mesh(new THREE.BoxGeometry(onWest ? 1.6 : 2.2, 0.7, onWest ? 2.2 : 1.6), M.rust));
        cab.position.set(x, 1.45, -z);
        cab.rotation.y = car.rotation.y;
        cover.push({ pos: L(x + (onWest ? 2.2 : 0), z + (onWest ? 0 : 2.2)), normal: new THREE.Vector3(onWest ? 1 : 0, 0, onWest ? 0 : -1), taken: null });
      } else if (kind < 0.75) {
        const bag = own(new THREE.Mesh(new THREE.BoxGeometry(onWest ? 0.8 : 3.6, 1.1, onWest ? 3.6 : 0.8), M.bag));
        bag.position.set(x, 0.55, -z);
        solid(bag);
        cover.push({ pos: L(x + (onWest ? 1 : 0), z + (onWest ? 0 : 1)), normal: new THREE.Vector3(onWest ? 1 : 0, 0, onWest ? 0 : -1), taken: null });
      } else {
        for (let q = 0; q < 3; q++) {
          const bw = own(new THREE.Mesh(new THREE.BoxGeometry(onWest ? 0.6 : 2, 1, onWest ? 2 : 0.6), M.barrier));
          bw.position.set(x + (onWest ? 0 : q * 2.1 - 2.1), 0.5, -(z + (onWest ? q * 2.1 - 2.1 : 0)));
          solid(bw);
        }
      }
    }

    if (station) this._placeStation(group, c0, colliders, solids, i, j);

    // Ağaçlı sokaklar (parkta zaten ağaç var)
    if (!park && rand() < 0.55) buildStreetTrees(ctx);
    if (lib) this._streetFurniture(ctx, special);

    // Sokak lambaları (bloğun güneybatı köşesinde; modeller yoksa)
    if (!lib && rand() < 0.7) {
      const pole = own(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6, 8), M.steel));
      pole.position.set(H + 0.6, 3, -(H + 0.6));
      const head = own(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.3), rand() < 0.6 ? M.lamp : M.steel));
      head.position.set(H + 0.9, 6, -(H + 0.6));
    }

    if (special) special.build(ctx);

    this.game.scene.add(group);
    const fixture = { colliders, solids, cover };
    this.game.world.addFixture(fixture);
    this.chunks.set(`${i},${j}`, { i, j, group, fixture, lights, benches, shops, park });
  }

  /* ── Blender şehir varlıkları (~/Desktop/Sehir_Assetleri_FBX) ─────────

     Parsel (≈38 m kare) sokağa bakan bir yüzü seçer ve:
       • %34 dükkân sırası (market/kafe/fırın/eczane/çiçekçi, vitrin sokağa)
       • %30 apartman + yanında dükkânlar
       • %12 ofis binası
       • kalan yıkık bina (kodla — savaş görmüş şehir)
     Gökdelenli blokta parsele bir gökdelen (burgu/taş). Model yerleşimi:
     ön yüz parselin sokak kenarından `setback` içeride, yüz boyunca dizilir. */
  _modelParcel(ctx, px, pz, opts) {
    const { rand, B, K } = ctx;
    const lotIn = K + 1.5, half = (B - 2 * lotIn) / 2, hs = half / 2;
    const pcx = lotIn + px * half + hs, pcz = lotIn + pz * half + hs;
    const faces = streetFaces(px, pz);
    const face = faces[Math.floor(rand() * 2)];
    const n = FACE_N[face], t = [-n[1], n[0]];
    const put = (name, along, setback = 0.8) => {
      const m = structures.get(name);
      const depth = m.size.z, width = m.size.x;
      const off = hs - setback - depth / 2;
      const cx = pcx + n[0] * off + t[0] * along, cz = pcz + n[1] * off + t[1] * along;
      structures.place(name, ctx.group, cx, -cz, FACE_ROT[face],
        { solids: ctx.solids, colliders: ctx.colliders }, ctx.corner);
      return { cx, cz, width, depth };
    };
    const row = (from, to) => {
      const list = [];
      let x = from;
      for (let k = 0; k < 6; k++) {
        const name = SHOP_MODELS[Math.floor(rand() * SHOP_MODELS.length)];
        const w = structures.get(name).size.x;
        if (x + w > to) break;
        list.push(put(name, x + w / 2, 0.6));
        x += w + 0.15;
      }
      return list;
    };
    if (opts.towers) {
      const name = rand() < 0.5 ? 'gokdelen_burgu' : 'gokdelen_tas';
      const d = structures.get(name).size.z;
      put(name, 0, Math.max(0.5, hs - d / 2));
      return 'tower';
    }
    const r = rand();
    let shopsHere = [];
    if (r < 0.34) shopsHere = row(-hs + 0.4, hs - 0.4);
    else if (r < 0.64) {
      const a = structures.get('apartman').size.x;
      put('apartman', -hs + 0.4 + a / 2, 1.2);
      shopsHere = row(-hs + 0.6 + a, hs - 0.4);
    } else if (r < 0.76) put('ofis_binasi', 0, 1.5);
    else return 'ruin';
    // Silah dükkânı: sıradaki ilk dükkânın vitrinine tabela ve vitrin
    if (opts.gunShop && shopsHere.length) {
      const s0 = shopsHere[0];
      const ns = face === 's' || face === 'n';
      const shop = buildShopfront(ctx, { cx: s0.cx, cz: s0.cz, w: ns ? s0.width : s0.depth, d: ns ? s0.depth : s0.width }, face, GUN_SHOP);
      opts.shops.push(shop);
      return 'gun';
    }
    return 'built';
  }

  /** Parselde sokağa bakan iki müstakil ev (Blender'deki savaş görmüş ev). */
  _housePair(ctx, px, pz) {
    const { rand, B, K } = ctx;
    const lotIn = K + 1.5, half = (B - 2 * lotIn) / 2;
    const face = streetFaces(px, pz)[Math.floor(rand() * 2)];
    const cx = lotIn + px * half + half / 2, cz = lotIn + pz * half + half / 2;
    const rot = { s: Math.PI, n: 0, w: Math.PI / 2, e: -Math.PI / 2 }[face];   // ev: kapı −Z
    const n = FACE_N[face], t = [n[1], n[0]];
    for (const side of [-1, 1]) {
      const hx = cx + n[0] * 8 + t[0] * side * 6.5, hz = cz + n[1] * 8 + t[1] * side * 6.5;
      structures.place('ev', ctx.group, hx, -hz, rot, { solids: ctx.solids, colliders: ctx.colliders }, ctx.corner);
    }
  }

  /* Sokak eşyaları: güney ve batı kaldırımında lambalar (kol sokağa),
     köşede yangın musluğu, ara sıra otobüs durağı ve çöp kutuları. */
  _streetFurniture(ctx, special) {
    const { rand, B, H } = ctx;
    const lat = H + CITY.walk - 0.5;           // kaldırımın bina tarafı
    const out = { solids: ctx.solids, colliders: ctx.colliders };
    const put = (name, x, z, rot) => structures.place(name, ctx.group, x, -z, rot, out, ctx.corner);
    for (let s = 14; s < B - 6; s += 26) {
      put('sokak_lambasi', s, lat, FACE_ROT.s);          // güney sokağı
      put('sokak_lambasi', lat, s + 6, FACE_ROT.w);      // batı sokağı
    }
    if (rand() < 0.6) put('yangin_musluk', lat - 0.6, lat + 3.5, rand() * 6);
    if (!special?.noProps && rand() < 0.3) {
      const s = 30 + rand() * 30;
      put('otobus_duragi', s, lat + 0.4, FACE_ROT.s);
      put('cop_kutusu', s + 4, lat - 0.2, 0);
    }
    for (let k = 0; k < 2; k++) {
      if (rand() < 0.5) put('cop_kutusu', 10 + rand() * (B - 20), lat - 0.1, 0);
    }
  }

  /* Benzin istasyonu bloğun ortasına, pompalar güney sokağına bakar.
     Model 3 MB: ilk istasyon bloğu kurulurken yüklenir, gelince bloğa
     eklenir (blok o arada söküldüyse eklenmez). */
  _placeStation(group, c0, colliders, solids, i, j) {
    const B = CITY.block;
    const put = () => {
      structures.place('istasyon', group, B / 2, -B / 2, 0, { solids, colliders }, c0);
      this.game.world._rebuildIndex();
    };
    if (structures.get('istasyon')) put();
    else {
      structures.load('istasyon').then((m) => {
        if (m && this.active && this.chunks.get(`${i},${j}`)?.group === group) put();
      });
    }
  }

  /** Oyuncunun önündeki silah dükkânı (E menzilinde) ya da null. */
  gunShopNear(p, r = 2.8) {
    for (const c of this.chunks.values()) {
      for (const s of c.shops) if (Math.hypot(s.pos.x - p.x, s.pos.z - p.z) < r) return s;
    }
    return null;
  }

  /** Kurulu bloklardaki bütün banklar (parklife.js). */
  *benches() {
    for (const c of this.chunks.values()) yield* c.benches;
  }
}
