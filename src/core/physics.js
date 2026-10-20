/* Fizik dünyası (cannon-es).

   Kullanım ayrımı:
   - Oyuncu ve düşmanların YÜRÜYÜŞÜ fizikle değil, kendi kontrolcüleriyle
     çözülür (nişan alırken kayan bir karakter kötü hissettirir). Onlar
     fizik dünyasında kinematik gövde olarak temsil edilir, böylece bombalar
     ve savrulan parçalar onlara çarpabilir.
   - El bombaları, varil/sandık gibi devrilebilen eşyalar ve patlama
     enkazı gerçek dinamik gövdelerdir.                                     */

import * as CANNON from 'cannon-es';
import * as THREE from 'three';

export class Physics {
  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -16, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.friction = 0.35;
    this.world.defaultContactMaterial.restitution = 0.22;

    this.matWorld = new CANNON.Material('world');
    this.matProp = new CANNON.Material('prop');
    this.matGrenade = new CANNON.Material('grenade');

    this.world.addContactMaterial(new CANNON.ContactMaterial(this.matWorld, this.matGrenade, {
      friction: 0.28, restitution: 0.45,
    }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.matWorld, this.matProp, {
      friction: 0.5, restitution: 0.1,
    }));
    // Eşya–eşya: üst üste yığılan sandık/varil kaymasın, çarpışınca az seksin
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.matProp, this.matProp, {
      friction: 0.55, restitution: 0.06,
    }));
    // Bomba eşyaya çarpınca sekip yuvarlansın
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.matProp, this.matGrenade, {
      friction: 0.3, restitution: 0.35,
    }));
    // Çözücü: daha çok yineleme = yığınlar ve temaslar daha kararlı
    this.world.solver.iterations = 14;

    this.linked = [];        // { body, mesh } — her karede eşitlenir
    this.accumulator = 0;
    this._dt = 1 / 60;       // son karenin süresi (kinematik hız tahmini)
  }

  /* ── Statik dünya ───────────────────────────────────────────────────── */

  addStaticBox(center, size) {
    const body = new CANNON.Body({
      mass: 0,
      material: this.matWorld,
      shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
      position: new CANNON.Vec3(center.x, center.y, center.z),
    });
    this.world.addBody(body);
    return body;
  }

  addGroundPlane(y = 0) {
    const body = new CANNON.Body({
      mass: 0,
      material: this.matWorld,
      shape: new CANNON.Plane(),
      position: new CANNON.Vec3(0, y, 0),
    });
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(body);
    return body;
  }

  /* ── Dinamik eşyalar ────────────────────────────────────────────────── */

  addDynamicBox(mesh, size, mass = 12) {
    const body = new CANNON.Body({
      mass,
      material: this.matProp,
      shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
      position: new CANNON.Vec3(mesh.position.x, mesh.position.y, mesh.position.z),
      linearDamping: 0.12,
      angularDamping: 0.3,
    });
    body.sleepSpeedLimit = 0.25;
    this.world.addBody(body);
    this.linked.push({ body, mesh });
    return body;
  }

  addDynamicCylinder(mesh, radius, height, mass = 18) {
    const body = new CANNON.Body({
      mass,
      material: this.matProp,
      shape: new CANNON.Cylinder(radius, radius, height, 10),
      position: new CANNON.Vec3(mesh.position.x, mesh.position.y, mesh.position.z),
      linearDamping: 0.14,
      angularDamping: 0.35,
    });
    this.world.addBody(body);
    this.linked.push({ body, mesh });
    return body;
  }

  addSphere(position, radius, mass, { velocity, material } = {}) {
    const body = new CANNON.Body({
      mass,
      material: material ?? this.matGrenade,
      shape: new CANNON.Sphere(radius),
      position: new CANNON.Vec3(position.x, position.y, position.z),
      linearDamping: 0.04,
      angularDamping: 0.22,
    });
    if (velocity) body.velocity.set(velocity.x, velocity.y, velocity.z);
    this.world.addBody(body);
    return body;
  }

  /** Oyuncu/düşman temsilcisi: konumu dışarıdan sürülür. */
  addKinematicCapsule(radius, height) {
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      material: this.matWorld,
      shape: new CANNON.Cylinder(radius, radius, height, 8),
    });
    this.world.addBody(body);
    return body;
  }

  /**
   * Kinematik gövdeyi yeni konumuna taşır ve HIZINI da verir: hız olmadan
   * yürüyen oyuncu/düşman çarptığı varile, sandığa, bombaya itme aktaramıyor,
   * eşyaların içine giriyordu. Büyük sıçramalar (ışınlanma, yeniden doğma)
   * hız sayılmaz.
   */
  moveKinematic(body, x, y, z) {
    const p = body.position;
    const dx = x - p.x, dy = y - p.y, dz = z - p.z;
    const jump = dx * dx + dy * dy + dz * dz > 9;
    const inv = 1 / Math.max(this._dt, 1 / 240);
    if (jump || !body._moved) body.velocity.set(0, 0, 0);
    else {
      body.velocity.set(dx * inv, dy * inv, dz * inv);
      const sp = body.velocity.length();
      if (sp > 20) body.velocity.scale(20 / sp, body.velocity);
    }
    body._moved = true;
    p.set(x, y, z);
  }

  remove(body) {
    this.world.removeBody(body);
    const i = this.linked.findIndex((l) => l.body === body);
    if (i >= 0) this.linked.splice(i, 1);
  }

  /** Gövdeye itme uygular (cannon kendi vektör tipini ister). */
  impulse(body, x, y, z, px = 0, py = 0, pz = 0) {
    if (!body || body.mass <= 0) return;
    body.wakeUp();
    body.applyImpulse(new CANNON.Vec3(x, y, z), new CANNON.Vec3(px, py, pz));
  }

  /* ── Patlama ────────────────────────────────────────────────────────── */

  /** Yarıçap içindeki dinamik gövdeleri merkezden dışarı iter. */
  explosion(center, radius, force) {
    const c = new CANNON.Vec3(center.x, center.y, center.z);
    for (const body of this.world.bodies) {
      if (body.mass <= 0) continue;
      const d = body.position.vsub(c);
      const dist = d.length();
      if (dist > radius || dist < 1e-4) continue;
      const falloff = 1 - dist / radius;
      d.normalize();
      d.y += 0.55;                       // patlamalar eşyaları hafif kaldırır
      d.scale(force * falloff, d);
      body.wakeUp();
      // İtme merkezden biraz kaçık uygulanır: eşyalar dönerek savrulur
      const off = new CANNON.Vec3((Math.random() - 0.5) * 0.5, (Math.random() - 0.2) * 0.4, (Math.random() - 0.5) * 0.5);
      body.applyImpulse(d, off);
    }
  }

  /* ── Döngü ──────────────────────────────────────────────────────────── */

  /**
   * Sabit adım 1/90 sn (1/60'ta hızlı atılan bomba ince duvardan
   * geçebiliyordu). Görüntü ARA KONUMLA eşitlenir: ekran yenileme hızı fizik
   * adımından farklıyken (120/144 Hz) eşyalar tırtıklı hareket ediyordu.
   */
  step(dt) {
    this._dt = dt;
    this.world.step(1 / 90, dt, 6);
    for (const { body, mesh } of this.linked) {
      const p = body.interpolatedPosition, q = body.interpolatedQuaternion;
      mesh.position.set(p.x, p.y, p.z);
      mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }

  /** Işın izleme yardımcı: fizik dünyasında ilk çarpışmayı bulur. */
  raycast(from, to) {
    const result = new CANNON.RaycastResult();
    this.world.raycastClosest(
      new CANNON.Vec3(from.x, from.y, from.z),
      new CANNON.Vec3(to.x, to.y, to.z),
      {}, result,
    );
    return result.hasHit
      ? { point: new THREE.Vector3(result.hitPointWorld.x, result.hitPointWorld.y, result.hitPointWorld.z), body: result.body }
      : null;
  }
}
