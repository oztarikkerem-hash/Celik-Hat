/* Blender'de yapılmış yapılar (oyundaki kodla kurulan kutu evlerin yerine).

   • ev       — savaş görmüş iki katlı taş ev (~/Desktop/home .blend, 'Ev'
                koleksiyonu; tools/export_ev.py ile dışa aktarılır, is
                lekeleri dokuya pişirilir). 9 × 7.7 m, kapı −Z yüzünde.
   • istasyon — benzin istasyonu (~/Desktop/BenzinIstasyonu/Istasyon.blend,
                tank bölümüyle aynı dosya). 46 × 40 m saha, 3 MB: yalnızca
                ilk gerektiğinde yüklenir.

   Yapılar klonlanır (geometri ve malzeme paylaşılır). Mermi ve çarpışma
   için her yapının basit kutuları vardır (`boxes`, yerel uzayda): görünür
   modelin onlarca parçasına ışın atmak yerine görünmez kutular kullanılır. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const LIB = {
  ev: {
    url: 'assets/structures/ev.glb',
    // Yerel kutular [cx, cy, cz, sx, sy, sz]: gövde (kaide dahil) ve çatı
    boxes: [[0, 3.5, 0, 8.4, 7, 7.1], [0, 8.2, 0, 7.6, 3, 6.6]],
  },
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
    const p = new GLTFLoader().loadAsync(def.url).then((gltf) => {
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
      const model = { root, boxes: def.boxes };
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
