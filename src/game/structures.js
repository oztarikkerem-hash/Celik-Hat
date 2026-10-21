/* Blender'de yapılmış yapılar: şehir varlıkları ve benzin istasyonu.

   • istasyon — benzin istasyonu (~/Desktop/BenzinIstasyonu/Istasyon.blend,
                tank bölümüyle aynı dosya). 46 × 40 m saha, 3 MB: yalnızca
                ilk gerektiğinde yüklenir.

   Yapılar klonlanır (geometri ve malzeme paylaşılır). Mermi ve çarpışma
   için her yapının basit kutuları vardır (`boxes`, yerel uzayda): görünür
   modelin onlarca parçasına ışın atmak yerine görünmez kutular kullanılır. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// Şehir varlıkları Draco ile sıkıştırılmış (tools/export_city_assets.py)
const draco = new DRACOLoader().setDecoderPath('vendor/addons/libs/draco/gltf/');
const loader = new GLTFLoader().setDRACOLoader(draco);

/* Şehir varlıkları (~/Desktop/Sehir_Assetleri_FBX, kullanıcının Blender
   modelleri): ön yüz +Z (vitrin, giriş, durağın açık yanı, lamba kolu).
   `auto`: çarpışma kutusu modelin sınır kutusundan. */
const CITY_ASSETS = {
  apartman: { auto: true }, ofis_binasi: { auto: true },
  dukkan_market: { auto: true }, dukkan_kafe: { auto: true }, dukkan_firin: { auto: true },
  dukkan_eczane: { auto: true }, dukkan_cicekci: { auto: true },
  gokdelen_burgu: { auto: true }, gokdelen_tas: { auto: true }, gokdelen_cam: { auto: true, roof: true },
  bufe: { auto: true }, otobus_duragi: { auto: true }, bank: { auto: true },
  cop_kutusu: { auto: true }, yangin_musluk: { auto: true },
  sokak_lambasi: { boxes: [[0, 3, 0, 0.3, 6, 0.3]] },
  agac: { boxes: [[0, 1.4, 0, 0.45, 2.8, 0.45]] },
};
export const CITY_NAMES = Object.keys(CITY_ASSETS);
export const SHOP_MODELS = ['dukkan_market', 'dukkan_kafe', 'dukkan_firin', 'dukkan_eczane', 'dukkan_cicekci'];

const LIB = {
  ...Object.fromEntries(Object.entries(CITY_ASSETS).map(([k, v]) => [k, { url: `assets/city/${k}.glb`, ...v }])),
  istasyon: {
    url: 'tankgame/istasyon.glb',
    // Blender (bx, by) → glTF (x = bx, z = −by): market, pompa adaları, kanopi direkleri
    boxes: [
      [0, 2, -15, 11.6, 4, 6.4],
      [0, 0.7, 0, 7, 1.4, 1.4], [0, 0.7, -4.5, 7, 1.4, 1.4],
      [-5.8, 3, -2.2, 0.6, 6, 0.6], [5.8, 3, -2.2, 0.6, 6, 0.6],
    ],
  },
};

const _invisible = new THREE.MeshBasicMaterial({ visible: false });

export class Structures {
  constructor() {
    this.models = new Map();
    this.loading = new Map();
  }

  /** Yapıyı yükler (bir kez); söz döner. */
  load(name) {
    if (this.models.has(name)) return Promise.resolve(this.models.get(name));
    if (this.loading.has(name)) return this.loading.get(name);
    const def = LIB[name];
    const p = loader.loadAsync(def.url).then((gltf) => {
      const root = gltf.scene;
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.userData.shared = true;          // sektör sökülürken geometrisi silinmesin
        o.castShadow = true;
        o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          // Camlar yarı saydam (Blender'de düz renk + saydamlık yoktu)
          if (/Glass/i.test(m.name) && !/Crack|Spot/i.test(m.name)) {
            m.transparent = true;
            m.opacity = 0.42;
            m.depthWrite = false;
            m.roughness = 0.08;
            m.metalness = 0.3;
          }
        }
      });
      root.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(root);
      const size = bb.getSize(new THREE.Vector3()), mid = bb.getCenter(new THREE.Vector3());
      let boxes = def.boxes;
      if (def.auto) boxes = [[mid.x, size.y / 2, mid.z, size.x, size.y, size.z]];
      const model = { root, boxes, size, roofY: null, top: null };
      if (def.roof) this._measureRoof(model);
      this.models.set(name, model);
      return model;
    }).catch((e) => {
      console.warn(`${def.url} yüklenemedi`, e);
      return null;
    });
    this.loading.set(name, p);
    return p;
  }

  get(name) { return this.models.get(name) ?? null; }

  /** Şehir varlıklarının hepsi (1.7 MB, Draco). onProgress(0..1). */
  loadCity(onProgress) {
    let done = 0;
    return Promise.all(CITY_NAMES.map((n) => this.load(n).then((m) => {
      onProgress?.(++done / CITY_NAMES.length);
      return m;
    })));
  }

  get cityReady() { return CITY_NAMES.every((n) => this.models.has(n)); }

  /* Kule çatısı: antenin dışındaki en yüksek düz yüzey (yukarıdan ışın) ve
     en üst katın taban izi. Bayrak ve asansör çıkışı oraya konur;
     çarpışma: kaide + gövde (en üst katın izi, çatı yüksekliğine kadar). */
  _measureRoof(model) {
    const ray = new THREE.Raycaster();
    const S = model.size;
    let roof = 0;
    for (const [dx, dz] of [[0.18, 0.18], [-0.18, 0.18], [0.18, -0.18], [-0.18, -0.18], [0.22, 0], [0, 0.22]]) {
      ray.set(new THREE.Vector3(dx * S.x, S.y + 20, dz * S.z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(model.root, true)[0];
      if (hit) roof = Math.max(roof, hit.point.y);
    }
    // En üst katın izi: çatı hizasındaki köşelerin yatay sınırı
    const top = new THREE.Box3(), v = new THREE.Vector3();
    model.root.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (v.y > roof - 4 && v.y < roof + 1.5 && Math.hypot(v.x, v.z) > 2) top.expandByPoint(v);
      }
    });
    model.roofY = roof;
    model.top = top.isEmpty() ? null : top;
    const t = model.top;
    const base = new THREE.Box3().setFromObject(model.root);
    model.boxes = [
      [(base.min.x + base.max.x) / 2, 6, (base.min.z + base.max.z) / 2, base.max.x - base.min.x, 12, base.max.z - base.min.z],
    ];
    if (t) model.boxes.push([(t.min.x + t.max.x) / 2, roof / 2, (t.min.z + t.max.z) / 2, t.max.x - t.min.x, roof, t.max.z - t.min.z]);
  }

  /**
   * Yapının bir kopyasını yerleştirir.
   * @param parent  eklenecek grup   @param x, z  dünya konumu   @param rot  Y açısı
   * @param out     { solids, colliders, bodies?, physics? } — görünmez çarpışma
   *                kutuları eklenir (mermi ve hareket için)
   * @param local   parent dünya kökenine göre değilse, kutuları dünyaya
   *                çevirmek için parent'ın dünya konumu (blok köşesi gibi)
   */
  place(name, parent, x, z, rot, out, local = null) {
    const m = this.models.get(name);
    if (!m) return null;
    const obj = m.root.clone(true);
    obj.position.set(x, 0, z);
    obj.rotation.y = rot;
    parent.add(obj);
    const off = local ?? new THREE.Vector3();
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const [bx, by, bz, sx, sy, sz] of m.boxes) {
      // Döndürülmüş kutu: eksen hizalı kapsayan kutu
      const wx = x + bx * c + bz * s, wz = z - bx * s + bz * c;
      const w = Math.abs(c) * sx + Math.abs(s) * sz, d = Math.abs(s) * sx + Math.abs(c) * sz;
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, sy, d), _invisible);
      box.position.set(wx, by, wz);
      box.userData.own = true;
      parent.add(box);
      out.solids?.push(box);
      const center = new THREE.Vector3(wx + off.x, by, wz + off.z);
      out.colliders?.push(new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(w, sy, d)));
      if (out.physics) out.bodies?.push(out.physics.addStaticBox(center, { x: w, y: sy, z: d }));
    }
    return obj;
  }
}

export const structures = new Structures();
