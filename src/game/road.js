/* Füze Rampası görevinin yol bölümü: ormanın içinden 12 km'lik toprak yol.

   Yol ana haritanın ÇOK uzağında (x ≈ 6 km) kurulur ve kuzeye (−Z) uzanır:
   z = Z0 − s, x = X0 + kıvrım(s). Böylece bir noktanın yoldaki ilerlemesi
   doğrudan s = Z0 − z olur. Yol 160 m'lik parçalar hâlinde akar: önde
   kurulur, arkada sökülür (her parça dünyaya "fixture" olarak eklenir —
   düşman siperi, araç çarpışması ve mermi engeli bu sayede değişmeden
   çalışır). Pusu noktalarında yol kenarına siperler ve sağ şeridi kapatan
   yanık bir araç enkazı konur.                                           */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { grassTexture, dirtTexture } from './textures.js';

export const ROAD = {
  x0: 6000, z0: 0,
  length: 12000,         // m
  chunk: 160,
  width: 7.5,
  ahead: 720, behind: 220,
  // Pusu noktaları (s, m): her biri bir düşman mangası ve yol kenarı siperleri
  ambushes: [1300, 2800, 4300, 5900, 7400, 8900, 10400, 11500],
  wreckAt: 28,           // enkaz pusu noktasının 28 m ötesinde, sağ şeritte
  curve: [70, 520, 28, 190, 1.3],   // kıvrım: a1·sin(s/p1) + a2·sin(s/p2 + f)
  trees: 170,
  endPad: 1,             // yol sonundan sonra kurulacak parça sayısı
  logAfter: 22,          // enkazdan 22 m sonra sol şeridi kapatan devrik kütük
};

/** Basit tohumlu rastgele (parça her kurulduğunda aynı görünsün). */
function seeded(n) {
  let s = (n * 2654435761) >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return (s % 100000) / 100000;
  };
}

export class Road {
  /** cfg: ROAD biçiminde ayarlar (Suikast görevi kendi patikasını verir). */
  constructor(game, cfg = ROAD) {
    this.game = game;
    this.cfg = { ...ROAD, ...cfg };
    this.active = false;
    this.chunks = new Map();     // k → { group, fixture }
    this._mats = null;
  }

  /** Yolun s noktasındaki merkez x'i. */
  cx(s) {
    const [a1, p1, a2, p2, f] = this.cfg.curve;
    return this.cfg.x0 + a1 * Math.sin(s / p1) + a2 * Math.sin(s / p2 + f);
  }

  /** Yolun s noktasındaki dünya konumu (lat: merkezden sağa metre). */
  point(s, lat = 0) {
    const t = this.tangent(s);
    // Sağ = ileri × yukarı → (−t.z, 0, t.x) … ileri −Z iken sağ +X
    return new THREE.Vector3(this.cx(s) - t.z * lat, 0, this.cfg.z0 - s + t.x * lat);
  }

  /** İlerleme yönü (birim). */
  tangent(s) {
    const [a1, p1, a2, p2, f] = this.cfg.curve;
    const dx = (a1 / p1) * Math.cos(s / p1) + (a2 / p2) * Math.cos(s / p2 + f);
    return new THREE.Vector3(dx, 0, -1).normalize();
  }

  /** Bir noktanın yoldaki ilerlemesi (m). */
  progress(pos) { return this.cfg.z0 - pos.z; }

  /** Yol merkezine göre yanal sapma (sağ +). */
  lateral(pos) { return pos.x - this.cx(this.progress(pos)); }

  /**
   * Arkadaşın sürüşünde izlenecek şerit: enkazın yanında sol şerit,
   * diğer yerlerde sağ şerit.
   */
  lane(s) {
    for (const a of this.cfg.ambushes) {
      const w = a + this.cfg.wreckAt;
      if (s > w - 34 && s < w + 9) return -2.2;          // enkaz sağda → sol şerit
      if (s >= w + 9 && s < w + this.cfg.logAfter + 12) return 2.1;   // kütük solda → sağ
    }
    return 1.6;
  }

  _materials() {
    if (this._mats) return this._mats;
    const W = this.game.world.materials;
    const grass = grassTexture(1).clone();
    grass.repeat.set(70, 22);
    grass.needsUpdate = true;
    const dirt = dirtTexture(1, '#6b5a3e').clone();
    dirt.repeat.set(1, 1);
    dirt.needsUpdate = true;
    this._mats = {
      ground: new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95, metalness: 0 }),
      road: new THREE.MeshStandardMaterial({ map: dirt, roughness: 0.92, metalness: 0 }),
      bark: W.bark, pine: W.pine, leaf: W.leaf, rock: W.rock,
      wreck: new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.85, metalness: 0.35 }),
      rust: new THREE.MeshStandardMaterial({ color: 0x5a3220, roughness: 0.9, metalness: 0.2 }),
      bag: new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 0.96, metalness: 0 }),
    };
    return this._mats;
  }

  start() {
    this.stop();
    this.active = true;
    this._mats = this._materials();
    this.update(0, true);
  }

  stop() {
    for (const k of [...this.chunks.keys()]) this._drop(k);
    this.active = false;
  }

  /** s: aracın ilerlemesi. Gerekli parçaları kurar, gerisini söker. */
  update(s, force = false) {
    if (!this.active) return;
    const C = this.cfg.chunk;
    const k0 = Math.max(0, Math.floor((s - this.cfg.behind) / C));
    const k1 = Math.min(Math.ceil(this.cfg.length / C) - 1 + this.cfg.endPad, Math.floor((s + this.cfg.ahead) / C));
    let changed = false;
    for (const k of [...this.chunks.keys()]) {
      if (k < k0 || k > k1) { this._drop(k); changed = true; }
    }
    // Kare başına en fazla bir parça kurulur (takılma olmasın); başta hepsi
    let budget = force ? 99 : 1;
    for (let k = k0; k <= k1 && budget > 0; k++) {
      if (this.chunks.has(k)) continue;
      this._build(k);
      budget--;
      changed = true;
    }
    if (changed) this.game.world._rebuildIndex();
  }

  _drop(k) {
    const c = this.chunks.get(k);
    if (!c) return;
    this.game.scene.remove(c.group);
    c.group.traverse((o) => { if (o.isMesh && o.userData.own) o.geometry.dispose(); });
    this.game.world.removeFixture(c.fixture);
    this.chunks.delete(k);
  }

  _build(k) {
    const M = this._mats;
    const C = this.cfg.chunk;
    const s0 = k * C, s1 = s0 + C, mid = s0 + C / 2;
    const rand = seeded(k + 11);
    const group = new THREE.Group();
    const colliders = [], solids = [], cover = [];
    const own = (mesh) => { mesh.userData.own = true; return mesh; };

    // Zemin: 520 × 160 m çimen (sis 150 m'de kapattığı için kenar görünmez)
    const ground = own(new THREE.Mesh(new THREE.PlaneGeometry(520, C + 0.5), M.ground));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(this.cx(mid), 0, this.cfg.z0 - mid);
    ground.receiveShadow = true;
    group.add(ground);

    // Yol şeridi: 5 m'de bir örnek, iki kenar
    const pos = [], uv = [], idx = [];
    const n = Math.round(C / 5);
    for (let i = 0; i <= n; i++) {
      const s = s0 + (i / n) * C;
      const L = this.point(s, -this.cfg.width / 2), R = this.point(s, this.cfg.width / 2);
      pos.push(L.x, 0.03, L.z, R.x, 0.03, R.z);
      uv.push(0, s / 7, 1, s / 7);
      // Saat yönü tersine (yukarı bakan yüz): L_i → R_i → L_i+1
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    rg.setIndex(idx);
    rg.computeVertexNormals();
    const road = own(new THREE.Mesh(rg, M.road));
    road.receiveShadow = true;
    group.add(road);

    // Ağaçlar: yolun iki yanında, gövde + taç tek geometride
    const trunks = [], crowns = [], leafs = [];
    // Sık orman: ağaçların çoğu yola yakın (ilk 60 m), seyrekleşerek uzar
    const count = this.cfg.trees;
    for (let i = 0; i < count; i++) {
      const s = s0 + rand() * C;
      const side = rand() < 0.5 ? -1 : 1;
      const lat = side * (8.5 + Math.pow(rand(), 1.8) * 140);
      const p = this.point(s, lat);
      const sc = 0.8 + rand() * 0.6;
      const pine = rand() < 0.65;
      const h = (pine ? 7.5 : 4.8) * sc;
      trunks.push(new THREE.CylinderGeometry(0.17 * sc, 0.3 * sc, h, 6).translate(p.x, h / 2, p.z));
      if (pine) {
        for (let j = 0; j < 3; j++) {
          const r = (2.1 - j * 0.55) * sc, ch = (2.8 - j * 0.4) * sc, y = (2.4 + j * 1.75) * sc;
          crowns.push(new THREE.ConeGeometry(r, ch, 7).translate(p.x, y + ch / 2, p.z));
        }
      } else {
        leafs.push(new THREE.IcosahedronGeometry(2.2 * sc, 0).scale(1, 0.85, 1).translate(p.x, h + 0.9 * sc, p.z));
      }
      // Yakın ağaçlar çarpışır ve mermi durdurur
      if (Math.abs(lat) < 40) {
        colliders.push(new THREE.Box3().setFromCenterAndSize(
          new THREE.Vector3(p.x, h / 2, p.z), new THREE.Vector3(0.6 * sc, h, 0.6 * sc)));
      }
    }
    const merged = (list, mat, solid) => {
      if (!list.length) return;
      const geo = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);
      for (const g of list) g.dispose();
      geo.computeVertexNormals();
      const mesh = own(new THREE.Mesh(geo, mat));
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      if (solid) solids.push(mesh);
    };
    merged(trunks, M.bark, true);
    merged(crowns, M.pine, false);
    merged(leafs, M.leaf, false);

    // Ara sıra yol kenarında kaya
    const rock = (s, lat, big) => {
      const p = this.point(s, lat);
      const sx = big ? 2.4 + rand() * 1.2 : 1 + rand() * 0.8, sy = big ? 1.3 + rand() * 0.6 : 0.6 + rand() * 0.4;
      const m = new THREE.Mesh(this.game.world.geo.rock, M.rock);
      m.scale.set(sx, sy, sx * (0.8 + rand() * 0.4));
      m.position.set(p.x, sy * 0.42, p.z);
      m.rotation.y = rand() * Math.PI;
      m.castShadow = m.receiveShadow = true;
      group.add(m);
      solids.push(m);
      colliders.push(new THREE.Box3().setFromObject(m));
      return p;
    };
    for (let i = 0; i < 4; i++) rock(s0 + rand() * C, (rand() < 0.5 ? -1 : 1) * (6 + rand() * 20), rand() < 0.3);

    // Pusu: yol kenarında siperler + sağ şeritte yanık enkaz
    for (const a of this.cfg.ambushes) {
      if (a + 60 < s0 || a - 60 >= s1) continue;
      this._ambushProps(a, s0, s1, group, colliders, solids, cover, rand, rock);
    }

    group.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
    this.game.scene.add(group);
    const fixture = { colliders, solids, cover };
    this.game.world.addFixture(fixture);
    this.chunks.set(k, { group, fixture });
  }

  /** Bir pusu noktasının bu parçaya düşen siperleri. */
  _ambushProps(a, s0, s1, group, colliders, solids, cover, rand, rock) {
    const M = this._mats;
    const inChunk = (s) => s >= s0 && s < s1;
    // Siper noktası: engelin yola göre ARKASINDA; normal yoldan dışarı bakar
    const addCover = (s, lat) => {
      const side = Math.sign(lat);
      const p = this.point(s, lat + side * 1.1);
      const t = this.tangent(s);
      cover.push({ pos: p, normal: new THREE.Vector3(-t.z * side, 0, t.x * side), taken: null });
    };
    const box = (s, lat, w, h, d, mat, yaw = 0) => {
      const p = this.point(s, lat);
      const t = this.tangent(s);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.userData.own = true;
      m.position.set(p.x, h / 2, p.z);
      m.rotation.y = Math.atan2(t.x, t.z) + yaw;
      m.castShadow = m.receiveShadow = true;
      group.add(m);
      solids.push(m);
      colliders.push(new THREE.Box3().setFromObject(m));
    };
    for (let i = 0; i < 10; i++) {
      const s = a - 50 + i * 11 + rand() * 4;
      if (!inChunk(s)) continue;
      const side = i % 2 ? 1 : -1;
      const lat = side * (14 + rand() * 16);
      const kind = i % 3;
      if (kind === 0) {
        rock(s, lat, true);
      } else if (kind === 1) {
        // Kum torbası duvarı (yola paralel)
        box(s, lat, 0.7, 1.15, 3.2, M.bag);
      } else {
        // Devrilmiş kütük
        box(s, lat, 0.85, 0.85, 4.2, M.bark, 0.2);
      }
      addCover(s, lat);
    }
    // Devrik kütük: enkazdan sonra SOL şeridi kapatır (pusu bölgesi zikzakla,
    // yavaş geçilir)
    const lg = a + this.cfg.wreckAt + this.cfg.logAfter;
    if (inChunk(lg)) box(lg, -2.25, 4.0, 0.95, 0.95, M.bark, 0.08);
    // Yanık araç enkazı: sağ şeritte, gövde + kabin
    const w = a + this.cfg.wreckAt;
    if (inChunk(w)) {
      box(w, 2.3, 2.3, 1.2, 4.6, M.wreck, 0.25);
      box(w - 0.8, 2.4, 2.0, 0.9, 1.8, M.rust, 0.25);
      addCover(w, 2.3);
      // İçinden tüten duman bu enkazın konumunda (Op2 tüttürür)
      this.wrecks ??= new Map();
      this.wrecks.set(a, this.point(w, 2.3).setY(1.4));
    }
  }
}
