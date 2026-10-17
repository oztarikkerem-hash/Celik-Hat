/* Yere bırakılan boş şarjörler (ve MG kutusu, minigun bant ucu).

   Şarjör değiştirirken düşen parça, silahtaki modelin AYNI geometrisini
   paylaşan bir kopyadır; o anki dünya konumundan, silahın hızıyla ve hafif
   bir dönüşle bırakılır. Fizik motoru (cannon-es) onu zemine ve sandıklara
   çarptırır; bir süre sonra kaybolur. En fazla MAX tane yaşar.            */

import * as THREE from 'three';

const MAX = 14;
const LIFE = 28;          // saniye

export class DroppedMags {
  constructor(scene, physics, audio) {
    this.scene = scene;
    this.physics = physics;
    this.audio = audio;
    this.live = [];
  }

  /**
   * @param pivot     şarjör pivotu (çocukları kopyalanır)
   * @param velocity  dünya hızı (m/s)
   * @param heavy     MG kutusu gibi ağır parçalar için true
   */
  drop(pivot, velocity, now, heavy = false) {
    pivot.updateWorldMatrix(true, true);

    // Kopya: pivotun dünya dönüşümüyle, çocuklar aynı yerel düzenle
    const box = new THREE.Box3().setFromObject(pivot);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const group = new THREE.Group();
    const inner = new THREE.Group();
    group.add(inner);
    const inv = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z);
    pivot.traverse((o) => {
      if (!o.isMesh) return;
      const m = new THREE.Mesh(o.geometry, o.material);
      m.castShadow = true;
      m.frustumCulled = true;
      // Dünya matrisi → grubun (merkez) uzayı
      m.matrixAutoUpdate = false;
      m.matrix.copy(inv).multiply(o.matrixWorld);
      inner.add(m);
    });
    group.position.copy(center);
    this.scene.add(group);

    // Gövde: dünya eksenli kutu yerine en ince boyut korunur (yassı düşsün)
    const dims = new THREE.Vector3(
      Math.max(0.02, size.x), Math.max(0.02, size.y), Math.max(0.02, size.z),
    );
    const body = this.physics.addDynamicBox(group, dims, heavy ? 3.5 : 0.45);
    body.linearDamping = 0.05;
    body.angularDamping = 0.18;
    body.velocity.set(velocity.x, velocity.y, velocity.z);
    body.angularVelocity.set(
      (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6,
    );
    body.wakeUp();

    const item = { group, body, until: now + LIFE, clinked: false, heavy };
    this.live.push(item);

    while (this.live.length > MAX) this._remove(this.live.shift());
  }

  update(now) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const it = this.live[i];
      // İlk yere çarpışta tok ses (plastik/metal)
      if (!it.clinked && it.body.position.y < 0.25 && it.body.velocity.y > -0.5) {
        it.clinked = true;
        this.audio?.magDrop?.(it.heavy);
      }
      if (now > it.until) {
        this._remove(it);
        this.live.splice(i, 1);
      }
    }
  }

  _remove(it) {
    this.physics.remove(it.body);
    this.scene.remove(it.group);
  }

  reset() {
    for (const it of this.live) this._remove(it);
    this.live.length = 0;
  }
}
