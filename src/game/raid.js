/* Baskın görevi.

   Oyuncu dört silah arkadaşıyla tek katlı bir evi tutar; ev dört dalga
   halinde basılır (20 · 25 · 30 · 25). Yanında yalnızca seçtiği iki silah
   vardır (cephaneleri diğer görevlerdekiyle aynı); evin iki penceresinde sehpaya
   kurulu M2 Browning ağır makineli tüfekler (10.000'er mermi) bekler.

   Son dalga püskürtülünce ufukta yaklaşan yeni bir birlik görünür ve görev
   biter — ikinci bölüme bağlanan kapanış.

   Bu modül evi ve makineli tüfekleri kurar, tüfeğe geçişi (E) ve onunla
   nişan/atışı yönetir, kapanıştaki yürüyen birliği oynatır. Dalga sayımı
   EnemyManager'da (`raid` alanı), mevziler AllyManager'da (`post`).        */

import * as THREE from 'three';
import { Soldier } from './soldier.js';
import { plasterTexture, plankTexture, tileTexture } from './textures.js';

export const RAID = {
  waves: [20, 25, 30, 25],
  mgRounds: 10000,
  center: new THREE.Vector3(-42, 0, -42),
  zoneR: 17,                   // bu yarıçapta sektör eşyası kurulmaz
  spawnMin: 45,
  spawnMax: 72,
  maxAlive: 16,
};

/** M2 Browning (.50 BMG): oyuncunun silah künyesiyle aynı alanlar. */
export const M2_DEF = {
  id: 'm2', name: 'M2 Browning', auto: true,
  damage: 140, rpm: 550, spread: 0.45, recoil: 0.32,
  tracer: 0xffa040,
  sound: { body: 62, crack: 1500, length: 0.34, punch: 1 },
};

// ── Ev ölçüleri (metre) ─────────────────────────────────────────────────
const W = 16, D = 11;          // dış duvar eksenleri arası
const T = 0.35;                // duvar kalınlığı
const H = 3.3;                 // tavan
const SILL = 1.0, TOP = 2.15;  // pencere alt/üst
const WIN = 1.5;
const DOOR = 1.3, DOOR_TOP = 2.3;
const YARD_X = 12.5, YARD_Z = 9.5, YARD_H = 1.15;   // bahçe duvarı

// ── M2 yerleşimi ────────────────────────────────────────────────────────
const S = 0.9;                 // model ölçeği (model 2.0 m, gerçek tüfek ~1.65 m)
const GROUND = 0.377;          // modelin ayakları y = -0.377'de
const PINTLE = new THREE.Vector3(0.45, 0.16, 0);    // dönme mili (model uzayı)
const MUZZLE = new THREE.Vector3(-1.0, 0.245, 0);
const EYE = new THREE.Vector3(1.42, 0.45, 0);       // tutamakların gerisi, kapağın üstü
const EJECT = new THREE.Vector3(0.35, 0.12, 0);     // kovan altta, gövdeden düşer
const PLATFORM_H = 0.7;        // kum torbası sehpa
const ARC = 0.68;              // ±39° yan tarama
const PITCH_MIN = -0.2, PITCH_MAX = 0.24;

const tmp = new THREE.Vector3();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Tek nesneye kaynaşmış M2 modelini iki parçaya ayırır: sehpa (sabit) ve
 * tüfek (sehpanın milinde döner). Ayrım, ağdaki birbirine bağlı üçgen
 * adalarının sınır kutusuna göre yapılır: tamamen sehpa tepesinin
 * üstünde kalanlar tüfeğin; yan taraftaki mermi kutusu ve fişek kuşağı da
 * tüfekle birlikte döndüğü için onun tarafına geçer.
 */
function splitM2(root) {
  const gun = new THREE.Group();
  const tripod = new THREE.Group();
  root.updateMatrixWorld(true);

  root.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    const pos = geo.attributes.position;
    const idx = geo.index;
    const n = idx ? idx.count : pos.count;
    const vi = (k) => (idx ? idx.getX(k) : k);

    // Aynı konumdaki köşeleri kaynaştır (UV dikişleri adaları bölmesin)
    const weld = new Map();
    const rep = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
      if (!weld.has(key)) weld.set(key, i);
      rep[i] = weld.get(key);
    }
    const parent = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) parent[i] = i;
    const find = (a) => {
      while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
      return a;
    };
    for (let t = 0; t < n; t += 3) {
      const a = find(rep[vi(t)]);
      for (const k of [t + 1, t + 2]) {
        const b = find(rep[vi(k)]);
        if (a !== b) parent[b] = a;
      }
    }

    // Ada sınır kutuları
    const boxes = new Map();
    for (let t = 0; t < n; t++) {
      const r = find(rep[vi(t)]);
      let b = boxes.get(r);
      if (!b) { b = new THREE.Box3(); boxes.set(r, b); }
      b.expandByPoint(tmp.fromBufferAttribute(pos, vi(t)));
    }
    const isGun = new Map();
    const c = new THREE.Vector3();
    for (const [r, b] of boxes) {
      b.getCenter(c);
      const above = b.min.y > 0.02;
      const beltSide = c.x > 0.12 && c.x < 0.62 && c.z > 0.1;
      isGun.set(r, above || beltSide);
    }

    const gi = [], ti = [];
    for (let t = 0; t < n; t += 3) {
      const list = isGun.get(find(rep[vi(t)])) ? gi : ti;
      list.push(vi(t), vi(t + 1), vi(t + 2));
    }
    for (const [list, group] of [[gi, gun], [ti, tripod]]) {
      if (!list.length) continue;
      const g = geo.clone();
      g.setIndex(list);
      const m = new THREE.Mesh(g, o.material);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
  });
  return { gun, tripod };
}

/** Kutu: yüz UV'leri metreye göre ölçeklenir (doku gerilmesin). */
function boxGeo(sx, sy, sz, tile = 2) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv;
  // Yüz sırası: +x −x +y −y +z −z (her biri 4 köşe)
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
  }
  return g;
}

export class Raid {
  /** @param game  Game örneği (sahne, dünya, fizik, ses, efektler) */
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.world = game.world;
    this.physics = game.physics;

    this.active = false;
    this.ready = false;
    this.mgs = [];
    this.mounted = null;
    this.house = null;
    this.fixture = null;
    this.bodies = [];
    this.posts = [];
    this.march = [];         // kapanıştaki yürüyen birlik
    this.finaleStart = 0;
  }

  /* ── Yükleme ──────────────────────────────────────────────────────── */

  async load(onProgress) {
    if (this.ready) return;
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    onProgress?.(0.2, 'M2 Browning');
    const gltf = await new GLTFLoader().loadAsync('assets/weapons/m2.glb');
    this.m2 = splitM2(gltf.scene);
    onProgress?.(1, 'Hazır');
    this.ready = true;
  }

  /* ── Kurulum / söküm ──────────────────────────────────────────────── */

  setup() {
    if (this.active) this.teardown();
    this.active = true;
    this.mounted = null;
    this.finale = false;
    this.world.setClearZone({ x: RAID.center.x, z: RAID.center.z, r: RAID.zoneR });
    this._buildHouse();
    this.world.addFixture(this.fixture);
  }

  teardown() {
    if (!this.active) return;
    this.active = false;
    this.dismount();
    this._clearMarch();
    if (this.house) this.scene.remove(this.house);
    for (const b of this.bodies) this.physics.remove(b);
    this.bodies = [];
    if (this.fixture) this.world.removeFixture(this.fixture);
    this.fixture = null;
    this.house = null;
    this.mgs = [];
    this.world.setClearZone(null);
  }

  /** Ev içindeki çıkış noktası ve bakış yönü (kuzey penceresine). */
  get playerStart() {
    return { pos: this._w(-1.5, 1.6), yaw: 0 };
  }

  /** Yerel (ev merkezine göre) x/z → dünya. */
  _w(x, z, y = 0) {
    return new THREE.Vector3(RAID.center.x + x, y, RAID.center.z + z);
  }

  _buildHouse() {
    const group = new THREE.Group();
    const fixture = { colliders: [], solids: [], cover: [] };
    this.house = group;
    this.fixture = fixture;
    this.bodies = [];
    this.mgs = [];

    const plaster = plasterTexture();
    const M = {
      // Sıva dokusu açık renkli; ton eşlemesiyle bembeyaz parlamasın diye kısılır
      wall: new THREE.MeshStandardMaterial({ map: plaster, color: 0xa69d8b, roughness: 0.95, metalness: 0 }),
      yard: new THREE.MeshStandardMaterial({ map: plaster, color: 0x9a8f7a, roughness: 0.95 }),
      floor: new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.8, metalness: 0.02 }),
      roof: this.world.materials.roof,
      frame: new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.75 }),
      bag: this.world.materials.sandbag,
      wood: this.world.materials.crate,
      // Cephane sandığı: zeytin yeşili boya (metal gök yansımasıyla maviye kaçıyordu)
      steel: new THREE.MeshStandardMaterial({ color: 0x4b5130, roughness: 0.72, metalness: 0.15 }),
      barrier: this.world.materials.wall,
      lamp: this.world.materials.lamp,
    };
    this._mats = M;

    /** Katı kutu: görünüm + çarpışma + mermi + fizik. */
    const box = (x, y, z, sx, sy, sz, mat, { solid = true, cover = false, tile = 2 } = {}) => {
      const mesh = new THREE.Mesh(boxGeo(sx, sy, sz, tile), mat);
      mesh.position.copy(this._w(x, z, y));
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      if (!solid) return mesh;
      fixture.solids.push(mesh);
      fixture.colliders.push(new THREE.Box3().setFromCenterAndSize(
        mesh.position.clone(), new THREE.Vector3(sx, sy, sz),
      ));
      this.bodies.push(this.physics.addStaticBox(mesh.position, { x: sx, y: sy, z: sz }));
      if (cover) {
        // Uzun kenarlar boyunca, her iki yanda mevzi noktaları
        const alongX = sx >= sz;
        const len = alongX ? sx : sz;
        const count = Math.max(1, Math.floor(len / 2.4));
        for (let i = 0; i < count; i++) {
          const o = (i + 0.5) / count - 0.5;
          for (const side of [-1, 1]) {
            const nx = alongX ? 0 : side, nz = alongX ? side : 0;
            fixture.cover.push({
              pos: new THREE.Vector3(
                mesh.position.x + (alongX ? o * len : nx * (sx / 2 + 0.55)),
                0,
                mesh.position.z + (alongX ? nz * (sz / 2 + 0.55) : o * len),
              ),
              normal: new THREE.Vector3(nx, 0, nz),
              height: sy,
              taken: null,
            });
          }
        }
      }
      return mesh;
    };

    /**
     * Açıklıklı duvar. along: 'x' (kuzey/güney) | 'z' (doğu/batı).
     * openings: [{ at, w, door }]  — konum duvar boyunca yerel koordinat.
     */
    const wall = (along, fixed, from, to, openings) => {
      const seg = (a, b, y0, y1) => {
        if (b - a < 0.01 || y1 - y0 < 0.01) return;
        const mid = (a + b) / 2, len = b - a, h = y1 - y0;
        if (along === 'x') box(mid, (y0 + y1) / 2, fixed, len, h, T, M.wall);
        else box(fixed, (y0 + y1) / 2, mid, T, h, len, M.wall);
      };
      const frame = (at, w, y0, y1) => {
        // Pencere/kapı kasası: içte ve dışta ince ahşap çerçeve (çarpışmasız)
        for (const off of [-1, 1]) {
          const d = off * (T / 2 + 0.02);
          const parts = [
            [at - w / 2 - 0.04, (y0 + y1) / 2, 0.08, y1 - y0],
            [at + w / 2 + 0.04, (y0 + y1) / 2, 0.08, y1 - y0],
            [at, y1 + 0.04, w + 0.16, 0.08],
          ];
          if (y0 > 0.01) parts.push([at, y0 - 0.03, w + 0.16, 0.06]);
          for (const [a, y, l, h] of parts) {
            if (along === 'x') box(a, y, fixed + d, l, h, 0.05, M.frame, { solid: false });
            else box(fixed + d, y, a, 0.05, h, l, M.frame, { solid: false });
          }
        }
      };

      let cur = from;
      for (const o of [...openings].sort((p, q) => p.at - q.at)) {
        const a = o.at - o.w / 2, b = o.at + o.w / 2;
        seg(cur, a, 0, H);
        if (o.door) {
          seg(a, b, DOOR_TOP, H);
          frame(o.at, o.w, 0, DOOR_TOP);
        } else {
          seg(a, b, 0, SILL);
          seg(a, b, TOP, H);
          frame(o.at, o.w, SILL, TOP);
        }
        cur = b;
      }
      seg(cur, to, 0, H);
    };

    const hx = W / 2, hz = D / 2;
    // Kuzey: üç pencere (ortadaki M2) — güney: iki pencere + kapı
    wall('x', -hz, -hx - T / 2, hx + T / 2, [{ at: -5, w: WIN }, { at: 0, w: WIN }, { at: 5, w: WIN }]);
    wall('x', hz, -hx - T / 2, hx + T / 2, [{ at: -5, w: WIN }, { at: 0, w: DOOR, door: true }, { at: 5, w: WIN }]);
    wall('z', hx, -hz + T / 2, hz - T / 2, [{ at: -2.5, w: WIN }, { at: 2.5, w: WIN }]);
    wall('z', -hx, -hz + T / 2, hz - T / 2, [{ at: -2.5, w: WIN }, { at: 2.5, w: WIN }]);

    // İç bölme: iki oda, arada kapı boşluğu
    const ix = 3;
    box(ix, H / 2, (-hz + T / 2 + -1) / 2, 0.2, H, (-1) - (-hz + T / 2), M.wall);
    box(ix, H / 2, (2.2 + hz - T / 2) / 2, 0.2, H, (hz - T / 2) - 2.2, M.wall);
    box(ix, (2.3 + H) / 2, 0.6, 0.2, H - 2.3, 3.2, M.wall);

    // Döşeme ve çatı
    const floor = new THREE.Mesh(boxFloor(W - T, D - T), M.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.copy(this._w(0, 0, 0.025));
    floor.receiveShadow = true;
    group.add(floor);

    box(0, H + 0.15, 0, W + T + 0.5, 0.3, D + T + 0.5, M.roof, { tile: 4 });

    // Beşik çatı: kiremit kaplı iki eğik yüz + iki sıvalı alınlık
    group.add(this._gableRoof(W + T + 1.2, D + T + 1.2, 2.3, H + 0.3, M));

    // Tavan lambaları: odalar gölgede kalıyor, iki sıcak ışık
    for (const [x, z] of [[-3, 0], [5.5, 0]]) {
      const lamp = new THREE.Mesh(this.world.geo.box, M.lamp);
      lamp.scale.set(0.5, 0.08, 0.5);
      lamp.position.copy(this._w(x, z, H - 0.05));
      group.add(lamp);
      const light = new THREE.PointLight(0xffc98a, 7, 12, 2);
      light.position.copy(this._w(x, z, H - 0.35));
      group.add(light);
    }

    // Eşya: masa, sandıklar, cephane kutuları
    box(-3.2, 0.38, 1.6, 1.9, 0.76, 0.95, M.wood);
    box(-6.6, 0.45, 4.2, 1.2, 0.9, 1.2, M.wood);
    box(6.6, 0.45, -4.1, 1.2, 0.9, 1.2, M.wood);
    box(-0.9, 0.2, -3.3, 0.6, 0.4, 0.35, M.steel);
    box(4.2, 0.2, 3.1, 0.6, 0.4, 0.35, M.steel);

    // Bahçe duvarı: dört yanda ortası açık (giriş), saldıranlara siper
    const gx = YARD_X, gz = YARD_Z, gate = 1.6;
    for (const s of [-1, 1]) {
      box(-(gx + gate) / 2, YARD_H / 2, s * gz, gx - gate, YARD_H, 0.4, M.yard, { cover: true });
      box((gx + gate) / 2, YARD_H / 2, s * gz, gx - gate, YARD_H, 0.4, M.yard, { cover: true });
      box(s * gx, YARD_H / 2, -(gz + gate) / 2, 0.4, YARD_H, gz - gate, M.yard, { cover: true });
      box(s * gx, YARD_H / 2, (gz + gate) / 2, 0.4, YARD_H, gz - gate, M.yard, { cover: true });
    }

    // Dış halka: beton bariyerler — saldıranların ilk mevzileri
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.3;
      const r = 20 + (k % 2) * 1.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const alongX = Math.abs(Math.sin(a)) > 0.7;
      box(x, 0.55, z, alongX ? 2.6 : 0.8, 1.1, alongX ? 0.8 : 2.6, M.barrier, { cover: true });
    }

    // ── Mevziler ─────────────────────────────────────────────────────
    const inner = (v) => v - T / 2 - 0.75;      // iç yüzden 0.75 m içeri
    this.posts = [
      { pos: this._w(-5, -inner(hz)), facing: 0 },              // kuzey
      { pos: this._w(inner(hx), 2.5), facing: -Math.PI / 2 },   // doğu
      { pos: this._w(-inner(hx), -2.5), facing: Math.PI / 2 },  // batı
      { pos: this._w(-5, inner(hz)), facing: Math.PI },         // güney
    ];

    // ── M2'ler: kuzey orta pencere ve güneydoğu penceresi ───────────
    this._buildMG(0, -hz, 0);
    this._buildMG(5, hz, Math.PI);

    this.scene.add(group);
  }

  /** Mahyası x ekseni boyunca uzanan beşik çatı (çarpışmasız, yalnızca görünüm). */
  _gableRoof(w, d, rise, y0, M) {
    const g = new THREE.Group();
    const roofMat = new THREE.MeshStandardMaterial({ map: tileTexture(), roughness: 0.82, metalness: 0.02 });
    const slope = Math.hypot(d / 2, rise);
    const tilt = Math.atan2(rise, d / 2);
    for (const side of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(w, slope);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 1.6, uv.getY(i) * slope / 1.6);
      const m = new THREE.Mesh(geo, roofMat);
      // Düzlem önce yatırılır, sonra mahyaya doğru kaldırılır
      m.rotation.order = 'YXZ';
      m.rotation.y = side > 0 ? 0 : Math.PI;      // iki yüz de mahyaya doğru yükselsin
      m.rotation.x = -Math.PI / 2 + tilt;
      m.position.copy(this._w(0, side * d / 4, y0 + rise / 2));
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    // Alınlıklar (üçgen duvar)
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, -d / 2 + 0.6, 0, 0, d / 2 - 0.6, 0, rise - 0.35, 0,
    ], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, d / 4, 0, d / 8, rise / 2], 2));
    tri.computeVertexNormals();
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(tri, M.wall);
      m.material = M.wall.clone();
      m.material.side = THREE.DoubleSide;
      m.position.copy(this._w(side * (w / 2 - 0.6), 0, y0));
      m.castShadow = true;
      g.add(m);
    }
    return g;
  }

  /** Pencere önüne kum torbası sehpa + M2. wx/wz: pencerenin duvar ekseni. */
  _buildMG(wx, wz, yaw) {
    const M = this._mats;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const face = wz - Math.sign(wz) * T / 2;            // iç yüz
    // Sehpa: iç yüzden 1.7 m içeri, 1.5 m genişlik
    const depth = 1.7;
    const pc = new THREE.Vector3(wx, 0, face).addScaledVector(fwd, -depth / 2);
    const group = this.house;

    // Görünüm: üst üste torbalar
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 2; j++) {
          const bag = new THREE.Mesh(this.world.geo.sphere, M.bag);
          bag.scale.set(0.62, 0.27, 0.86);
          const lx = (i - 1) * 0.5 + (row % 2) * 0.1;
          const lz = (j - 0.5) * 0.82;
          bag.position.copy(this._w(pc.x + lx, pc.z + lz, 0.12 + row * 0.23));
          bag.rotation.y = (Math.random() - 0.5) * 0.3;
          bag.castShadow = bag.receiveShadow = true;
          group.add(bag);
        }
      }
    }
    // Çarpışma: tek kutu
    const center = this._w(pc.x, pc.z, PLATFORM_H / 2);
    this.fixture.colliders.push(new THREE.Box3().setFromCenterAndSize(
      center, new THREE.Vector3(1.5, PLATFORM_H, depth),
    ));
    this.bodies.push(this.physics.addStaticBox(center, { x: 1.5, y: PLATFORM_H, z: depth }));

    // Tüfek: sehpa üstünde, namlusu pencereden dışarı
    const origin = new THREE.Vector3(wx, 0, face).addScaledVector(fwd, -0.78);
    const mount = new THREE.Group();
    mount.position.copy(this._w(origin.x, origin.z, PLATFORM_H));
    mount.rotation.y = yaw;
    group.add(mount);

    // Model −X'e bakıyor: −90° döndürülünce namlu −Z (ileri) olur
    const tripod = this.m2.tripod.clone();
    tripod.rotation.y = -Math.PI / 2;
    tripod.scale.setScalar(S);
    tripod.position.y = GROUND * S;
    mount.add(tripod);

    // Model −90° döndüğü için (x, y, z) → (−z, y, x)
    const pivot = new THREE.Vector3(-PINTLE.z, PINTLE.y + GROUND, PINTLE.x).multiplyScalar(S);
    const yawP = new THREE.Group();
    yawP.position.copy(pivot);
    mount.add(yawP);
    const pitchP = new THREE.Group();
    yawP.add(pitchP);

    const gun = this.m2.gun.clone();
    gun.rotation.y = -Math.PI / 2;
    gun.scale.setScalar(S);
    // Mil noktası pitchP'nin orijinine otursun
    gun.position.set(PINTLE.z * S, -PINTLE.y * S, -PINTLE.x * S);
    pitchP.add(gun);

    const at = (v) => { const o = new THREE.Object3D(); o.position.copy(v); gun.add(o); return o; };
    const muzzle = at(MUZZLE);
    const eye = at(EYE);
    const eject = at(EJECT);

    // Namlu alevi: çapraz iki levha + kısa ömürlü ışık
    const flash = new THREE.Group();
    const fm = new THREE.MeshBasicMaterial({
      map: flashTexture(), color: 0xffc27a, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    for (const r of [0, Math.PI / 2]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.32), fm);
      p.rotation.x = r;          // levha namlu ekseni (−X) boyunca uzanır
      p.position.x = -0.3;
      flash.add(p);
    }
    const star = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.36), fm);
    star.rotation.y = Math.PI / 2;
    flash.add(star);
    flash.visible = false;
    muzzle.add(flash);
    const light = new THREE.PointLight(0xffb060, 0, 7, 2);
    muzzle.add(light);

    // Oyuncunun duracağı yer: sehpanın arkası
    const seat = this._w(origin.x, origin.z).addScaledVector(fwd, -1.55);

    this.mgs.push({
      mount, yawP, pitchP, muzzle, eye, eject, flash, light,
      baseYaw: yaw, seat, ammo: RAID.mgRounds, nextShot: 0, flashUntil: 0,
      yaw: 0, pitch: 0, heat: 0,
    });
  }

  /* ── Makineli tüfek ───────────────────────────────────────────────── */

  /** Oyuncunun yanında duran (kullanılabilir) M2. */
  nearbyMG(playerPos) {
    let best = null, bestD = 1.6;
    for (const g of this.mgs) {
      const d = Math.hypot(g.seat.x - playerPos.x, g.seat.z - playerPos.z);
      if (d < bestD) { bestD = d; best = g; }
    }
    return best;
  }

  mount(g, player) {
    this.mounted = g;
    player.pos.copy(g.seat);
    player.vel.set(0, 0, 0);
    player.yaw = g.baseYaw + g.yaw;
    player.pitch = g.pitch;
  }

  dismount() {
    this.mounted = null;
  }

  /** Bağlıyken her kare: açı sınırı, tüfek pozu, kamera. */
  updateMounted(dt, now, player, camera) {
    const g = this.mounted;
    if (!g) return;
    let rel = wrap(player.yaw - g.baseYaw);
    rel = THREE.MathUtils.clamp(rel, -ARC, ARC);
    player.yaw = g.baseYaw + rel;
    player.pitch = THREE.MathUtils.clamp(player.pitch, PITCH_MIN, PITCH_MAX);
    g.yaw = rel;
    g.pitch = player.pitch;
    g.yawP.rotation.y = rel;
    g.pitchP.rotation.x = player.pitch;
    g.mount.updateWorldMatrix(true, true);

    // Geri tepme ve sarsıntı: oyuncunun hareket kodu çalışmadığı için
    // sönümleme burada yapılır.
    player.recoilPitch *= Math.pow(0.002, dt);
    player.recoilYaw *= Math.pow(0.002, dt);
    player._shake *= Math.pow(0.02, dt);
    const sh = player._shake * 0.05;

    g.eye.getWorldPosition(camera.position);
    camera.position.x += (Math.random() - 0.5) * sh;
    camera.position.y += (Math.random() - 0.5) * sh;
    camera.rotation.set(0, 0, 0);
    camera.rotateY(player.yaw + player.recoilYaw);
    camera.rotateX(player.pitch + player.recoilPitch);
  }

  /** Tetik: ateş edildiyse { origin, dir } döner. */
  fire(now, camera) {
    const g = this.mounted;
    if (!g || g.ammo <= 0 || now < g.nextShot) return null;
    g.nextShot = now + 60 / M2_DEF.rpm;
    g.ammo--;
    g.heat = Math.min(1, g.heat + 0.035);

    const dir = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    // Saçılma uzun seride biraz açılır (namlu ısınması, sehpa titremesi)
    const spread = THREE.MathUtils.degToRad(M2_DEF.spread * (1 + g.heat * 1.4));
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * spread;
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    dir.addScaledVector(right, Math.sin(a) * r).addScaledVector(up, Math.cos(a) * r).normalize();

    g.flash.visible = true;
    g.flash.rotation.x = Math.random() * Math.PI;
    g.flash.scale.setScalar(0.8 + Math.random() * 0.5);
    g.light.intensity = 9;
    g.flashUntil = now + 0.045;

    const origin = g.muzzle.getWorldPosition(new THREE.Vector3());
    const ej = g.eject.getWorldPosition(new THREE.Vector3());
    this.game.audio.shot(M2_DEF.sound);
    // .50 kovanı gövdenin altından aşağı düşer
    this.game.casings.eject(ej, right.clone().multiplyScalar(0.3), new THREE.Vector3(0, -1, 0), now);
    return { origin, dir };
  }

  /** Alev/ısı sönümü (bağlı olmasa da). */
  update(dt, now) {
    for (const g of this.mgs) {
      if (g.flash.visible && now > g.flashUntil) {
        g.flash.visible = false;
        g.light.intensity = 0;
      }
      g.heat = Math.max(0, g.heat - dt * 0.25);
    }
    if (this.finale) this._updateMarch(dt, now);
  }

  /* ── Kapanış: ufuktan gelen birlik ────────────────────────────────── */

  /**
   * Son dalgadan sonra evin güneydoğusunda, ~105 m ötede bir birlik belirir
   * ve eve doğru yürür. Oynanış durmaz: oyuncu dürbünle (X) bakabilir.
   */
  startFinale(now) {
    this._clearMarch();              // (finale bayrağını da indirir — önce çağrılmalı)
    this.finale = true;
    this.finaleStart = now;
    const factory = this.game.enemySoldiers;
    if (!factory?.template) return;

    const toHouse = new THREE.Vector3(-1, 0, -1).normalize();
    const side = new THREE.Vector3(-toHouse.z, 0, toHouse.x);
    const head = RAID.center.clone().addScaledVector(toHouse, -105);
    const facing = Math.atan2(-toHouse.x, -toHouse.z);

    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        const rig = factory.create();
        const rifle = this.game.gear?.makeRifle('mar556') ?? null;
        const soldier = new Soldier(rig, { team: 'enemy', rifle, tint: 0xff5a3c });
        const pos = head.clone()
          .addScaledVector(side, (col - 1) * 2.4 + (Math.random() - 0.5) * 0.4)
          .addScaledVector(toHouse, -row * 2.8);
        soldier.root.position.copy(pos);
        soldier.root.rotation.y = facing;
        soldier.setShadowDistance(200);
        this.scene.add(soldier.root);
        this.march.push({ soldier, pos, dir: toHouse, speed: 1.45 + Math.random() * 0.1 });
      }
    }
  }

  _updateMarch(dt) {
    for (const m of this.march) {
      m.pos.addScaledVector(m.dir, m.speed * dt);
      m.soldier.root.position.copy(m.pos);
      m.soldier.update({ dt, speed: m.speed, crouching: false, downed: false, aimPitch: -0.1 });
    }
  }

  _clearMarch() {
    for (const m of this.march) this.scene.remove(m.soldier.root);
    this.march = [];
    this.finale = false;
  }

  /** Kapanışın başlangıcından beri geçen süre. */
  finaleTime(now) {
    return this.finale ? now - this.finaleStart : 0;
  }
}

/** Döşeme düzlemi: UV'ler metreye göre (tahta genişliği sabit kalsın). */
function boxFloor(w, d) {
  const g = new THREE.PlaneGeometry(w, d);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 3, uv.getY(i) * d / 3);
  return g;
}

let _flashTex = null;
/** Namlu alevi dokusu: ortası beyaz, kenarları turuncuya sönen yıldız. */
function flashTexture() {
  if (_flashTex) return _flashTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.25, 'rgba(255,214,140,0.9)');
  grd.addColorStop(0.6, 'rgba(255,130,40,0.35)');
  grd.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = grd;
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = i % 2 ? 26 : 62;
    g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  _flashTex = new THREE.CanvasTexture(c);
  _flashTex.colorSpace = THREE.SRGBColorSpace;
  return _flashTex;
}
