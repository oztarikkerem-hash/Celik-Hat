/* El bombaları: fizik gövdesiyle sekerek yuvarlanır, fitili bitince düştüğü
   yerde alan hasarı verir. Hasar mesafeyle azalır ve arada duvar varsa
   yarıya iner.                                                             */

import * as THREE from 'three';

const FUSE = 2.4;           // saniye
const RADIUS = 7.5;         // etki yarıçapı (m)
const MAX_DAMAGE = 190;     // merkezde
const THROW_SPEED = 17;

export class Grenades {
  constructor(scene, physics, effects, audio) {
    this.scene = scene;
    this.physics = physics;
    this.effects = effects;
    this.audio = audio;

    this.count = 3;
    this.max = 4;
    this.live = [];
    this.nextThrow = 0;

    this.onExplode = null;   // ({ center, radius, maxDamage }) => void

    const geo = new THREE.SphereGeometry(0.095, 12, 10);
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x33402f, roughness: 0.6, metalness: 0.5,
      emissive: 0xff5a2a, emissiveIntensity: 0,
    });
    this.geo = geo;
  }

  reset(count = 3) {
    for (const g of this.live) {
      this.scene.remove(g.mesh);
      this.physics.remove(g.body);
    }
    this.live = [];
    this.count = count;
  }

  resupply(n = 2) {
    this.count = Math.min(this.max, this.count + n);
  }

  /** @returns {boolean} atıldı mı */
  throwFrom(camera, now, inheritVelocity) {
    if (this.count <= 0 || now < this.nextThrow) return false;
    this.count--;
    this.nextThrow = now + 0.75;

    const dir = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const origin = camera.getWorldPosition(new THREE.Vector3())
      .addScaledVector(dir, 0.55)
      .add(new THREE.Vector3(0, -0.1, 0));

    const mesh = new THREE.Mesh(this.geo, this.mat.clone());
    mesh.castShadow = true;
    mesh.position.copy(origin);
    this.scene.add(mesh);

    const velocity = dir.clone().multiplyScalar(THROW_SPEED);
    velocity.y += 3.2;                                   // yay çizsin
    if (inheritVelocity) velocity.add(inheritVelocity.clone().multiplyScalar(0.5));

    const body = this.physics.addSphere(origin, 0.095, 0.9, { velocity });
    body.angularVelocity.set(
      (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12,
    );

    this.live.push({ mesh, body, explodeAt: now + FUSE });
    this.audio.throwGrenade();
    return true;
  }

  update(dt, now) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i];
      // Ara konum: ekran yenilemesi fizik adımından farklıyken akıcı
      const p = g.body.interpolatedPosition, q = g.body.interpolatedQuaternion;
      g.mesh.position.set(p.x, p.y, p.z);
      g.mesh.quaternion.set(q.x, q.y, q.z, q.w);

      // Fitil yaklaştıkça kırmızı yanıp söner
      const left = g.explodeAt - now;
      const blink = Math.max(0, 1 - left / FUSE);
      g.mesh.material.emissiveIntensity = (Math.sin(now * (6 + blink * 30)) * 0.5 + 0.5) * blink * 4;

      if (left <= 0) {
        this._explode(g, i);
      }
    }
  }

  _explode(g, index) {
    const center = new THREE.Vector3(g.body.position.x, g.body.position.y, g.body.position.z);

    this.effects.explode(center, 0xffa23c, 90);
    this.effects.sparks(center, new THREE.Vector3(0, 1, 0), 0xfff0c0, 26);
    this.physics.explosion(center, RADIUS * 1.3, 26);
    this.audio.explosion();

    this.onExplode?.({ center, radius: RADIUS, maxDamage: MAX_DAMAGE });

    this.scene.remove(g.mesh);
    g.mesh.material.dispose();
    this.physics.remove(g.body);
    this.live.splice(index, 1);
  }

  /** Mesafeye göre hasar (merkezde tam, kenarda sıfır). */
  static damageAt(center, point, radius = RADIUS, maxDamage = MAX_DAMAGE) {
    const d = center.distanceTo(point);
    if (d >= radius) return 0;
    const k = 1 - d / radius;
    return maxDamage * k * k;      // kareli azalma: kenarda çok daha zayıf
  }
}
