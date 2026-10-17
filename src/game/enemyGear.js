/* Düşman teçhizatı: askerlerin taşıdığı gerçek silah modelleri.

   Oyuncunun silahları 100'den fazla parçadan oluşuyor; bunları her düşman için
   olduğu gibi klonlamak çizim çağrısını patlatır. Bu yüzden model bir kez
   yüklenir, hizalanır ve TEK bir geometriye kaynaştırılır (merge). Her asker
   o tek geometriyi paylaşan tek bir mesh taşır — on asker bile birkaç çizim
   çağrısı eder.                                                             */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { normalizeModel } from './align.js';

const SOURCES = {
  mar556: { file: 'assets/weapons/enemy_mar556.glb', length: 0.80, flipForward: false, flipUp: false },
  m98b: { file: 'assets/weapons/enemy_m98b.glb', length: 1.0, flipForward: false, flipUp: false },
};

/** Birleştirmeye uygun hale getirir: yalnızca konum + normal bırakır. */
function strip(geometry) {
  const g = geometry.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  g.morphAttributes = {};
  return g;
}

export class EnemyGear {
  constructor() {
    this.weapons = {};      // kind → { geometry, muzzle }
    this.material = new THREE.MeshStandardMaterial({
      color: 0x3b4146, roughness: 0.46, metalness: 0.68,
    });
    this.accent = new THREE.MeshStandardMaterial({
      color: 0x8d949a, roughness: 0.34, metalness: 0.85,
    });
  }

  async load(onProgress, base = '') {
    const loader = new GLTFLoader();
    const kinds = Object.keys(SOURCES);

    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i];
      const src = SOURCES[kind];
      const gltf = await loader.loadAsync(base + src.file);
      const root = gltf.scene;

      const info = normalizeModel(root, src.length, {
        flipForward: src.flipForward,
        flipUp: src.flipUp,
      });

      root.updateWorldMatrix(true, true);
      const parts = [];
      root.traverse((o) => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return;
        const g = strip(o.geometry);
        g.applyMatrix4(o.matrixWorld);     // hizalanmış konuma taşı
        parts.push(g);
      });

      const merged = parts.length > 1 ? mergeGeometries(parts, false) : parts[0];
      for (const g of parts) if (g !== merged) g.dispose();

      // Silah dipçiği orijinde, namlu -Z'de; askerin elinde konumlandırmak
      // için merkeze alıyoruz.
      merged.computeBoundingBox();
      this.weapons[kind] = { geometry: merged, muzzle: info.muzzle.clone() };
      onProgress?.((i + 1) / kinds.length, kind);
    }

    return this;
  }

  /** Askerin eline konacak tek mesh'lik silah. */
  makeRifle(kind) {
    const w = this.weapons[kind] ?? this.weapons.mar556;
    if (!w) return null;
    const mesh = new THREE.Mesh(w.geometry, this.material);
    mesh.castShadow = true;
    mesh.userData.muzzle = w.muzzle;
    return mesh;
  }
}
