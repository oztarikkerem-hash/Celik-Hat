/* Boş kovanlar: her atışta silahtan fırlayan, yere çarpıp seken pirinç
   kovanlar. Tamamen fizik motoruna bağlı (cannon-es) — zeminde yuvarlanır,
   sandıklara çarpar, zamanla kaybolur.

   Havuzlanmış: en fazla MAX kadar kovan yaşar, yenisi en eskiyi geri alır.  */

import * as THREE from 'three';

const MAX = 36;
const LIFE = 9;              // saniye

export class Casings {
  constructor(scene, physics, audio) {
    this.scene = scene;
    this.physics = physics;
    this.audio = audio;

    // Kovan: ince pirinç silindir
    this.geometry = new THREE.CylinderGeometry(0.0055, 0.006, 0.023, 7);
    this.geometry.rotateZ(Math.PI / 2);
    this.material = new THREE.MeshStandardMaterial({
      color: 0xc8922f, roughness: 0.32, metalness: 0.95,
    });

    this.pool = [];
    this.cursor = 0;
  }

  /**
   * @param origin  kovanın çıkacağı dünya konumu (silahın sağ yanı)
   * @param right   silahın sağ yönü (dünya)
   * @param up      yukarı yön
   */
  eject(origin, right, up, now) {
    let item = this.pool[this.cursor];

    if (!item) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.castShadow = true;
      this.scene.add(mesh);
      const body = this.physics.addSphere(origin, 0.012, 0.012, {});
      body.linearDamping = 0.08;
      body.angularDamping = 0.1;
      item = { mesh, body };
      this.pool[this.cursor] = item;
    }

    this.cursor = (this.cursor + 1) % MAX;

    const b = item.body;
    b.wakeUp();
    b.position.set(origin.x, origin.y, origin.z);
    b.velocity.set(
      right.x * 2.6 + up.x * 1.4 + (Math.random() - 0.5) * 0.6,
      right.y * 2.6 + up.y * 1.4 + 1.2,
      right.z * 2.6 + up.z * 1.4 + (Math.random() - 0.5) * 0.6,
    );
    b.angularVelocity.set(
      (Math.random() - 0.5) * 28, (Math.random() - 0.5) * 28, (Math.random() - 0.5) * 28,
    );
    item.mesh.visible = true;
    item.until = now + LIFE;
    item.clinked = false;
  }

  update(now) {
    for (const item of this.pool) {
      if (!item || !item.mesh.visible) continue;

      const p = item.body.interpolatedPosition;
      item.mesh.position.set(p.x, p.y, p.z);
      const q = item.body.interpolatedQuaternion;
      item.mesh.quaternion.set(q.x, q.y, q.z, q.w);

      // Yere ilk çarpışta metalik tıkırtı
      if (!item.clinked && p.y < 0.05) {
        item.clinked = true;
        this.audio?.casing?.();
      }

      if (now > item.until) {
        item.mesh.visible = false;
        item.body.sleep();
      }
    }
  }

  reset() {
    for (const item of this.pool) {
      if (!item) continue;
      item.mesh.visible = false;
      item.body.sleep();
    }
  }
}
