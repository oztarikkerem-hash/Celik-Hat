/* Fizik dünyası (Rapier — Rust'tan WebAssembly'e derlenmiş motor).

   Kullanım ayrımı:
   - Oyuncu ve düşmanların YÜRÜYÜŞÜ fizikle değil, kendi kontrolcüleriyle
     çözülür (nişan alırken kayan bir karakter kötü hissettirir). Onlar
     fizik dünyasında kinematik gövde olarak temsil edilir, böylece bombalar,
     savrulan parçalar ve cesetler onlara çarpabilir.
   - El bombaları, varil/sandık gibi devrilebilen eşyalar, düşen şarjörler,
     kovanlar ve ölen askerlerin ragdoll'ları gerçek dinamik gövdelerdir.

   Rapier eklemleri (joint) ve çözücüsü cannon-es'ten çok daha kararlı:
   ragdoll'un uzuvları birbirinden kopmuyor, yığınlar titremiyor. Motor
   WASM olduğu için modül yüklenirken bir kez `init()` beklenir (üst düzey
   await) — oyun kodu Physics'i yine eşzamanlı kurar.

   Gövdeler `PBody` ile sarılır: oyun kodu Rapier tiplerini görmez.          */

import RAPIER from 'rapier';
import * as THREE from 'three';

await RAPIER.init();
export { RAPIER };

const STEP = 1 / 90;        // sabit adım (1/60'ta hızlı bomba ince duvardan geçiyordu)
const MAX_SUB = 6;

// Çarpışma grupları (üst 16 bit: üyelik, alt 16 bit: kimlerle çarpışır)
export const GROUP = {
  WORLD: 0x0001,
  PROP: 0x0002,
  ACTOR: 0x0004,     // oyuncu/düşman kinematik gövdeleri
  RAGDOLL: 0x0008,
  SMALL: 0x0010,     // kovan, bomba, şarjör
};
export const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);
const ALL = 0xffff;

/** Rapier gövdesini oyunun kullandığı küçük bir arayüzle sarar. */
export class PBody {
  constructor(phys, rb, collider) {
    this.phys = phys;
    this.rb = rb;              // statik kutularda null (yalnızca çarpıştırıcı)
    this.collider = collider;
    this.ipos = new THREE.Vector3();          // ara (interpolated) konum
    this.iquat = new THREE.Quaternion();
    this._prevP = new THREE.Vector3();
    this._prevQ = new THREE.Quaternion();
    this._curP = new THREE.Vector3();
    this._curQ = new THREE.Quaternion();
  }

  get dynamic() { return !!this.rb && this.rb.isDynamic(); }
  get position() { const t = this.rb.translation(); return new THREE.Vector3(t.x, t.y, t.z); }
  get velocity() { const v = this.rb.linvel(); return new THREE.Vector3(v.x, v.y, v.z); }
  get quaternion() { const q = this.rb.rotation(); return new THREE.Quaternion(q.x, q.y, q.z, q.w); }
  get mass() { return this.rb?.mass() ?? 0; }
  get sleeping() { return this.rb.isSleeping(); }

  setPosition(x, y, z) {
    this.rb.setTranslation({ x, y, z }, true);
    this._snap();
  }
  setRotation(q) {
    this.rb.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this._snap();
  }
  setRotationEuler(x, y, z) { this.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z))); }
  setVelocity(x, y, z) { this.rb.setLinvel({ x, y, z }, true); }
  setAngularVelocity(x, y, z) { this.rb.setAngvel({ x, y, z }, true); }
  setDamping(linear, angular) {
    if (linear != null) this.rb.setLinearDamping(linear);
    if (angular != null) this.rb.setAngularDamping(angular);
  }
  sleep() { this.rb.sleep(); }
  wakeUp() { this.rb.wakeUp(); }

  /** Işınlanmada ara konum eski yerden kaymasın. */
  _snap() {
    const t = this.rb.translation(), q = this.rb.rotation();
    this._curP.set(t.x, t.y, t.z); this._prevP.copy(this._curP); this.ipos.copy(this._curP);
    this._curQ.set(q.x, q.y, q.z, q.w); this._prevQ.copy(this._curQ); this.iquat.copy(this._curQ);
  }
}

export class Physics {
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -16, z: 0 });
    this.world.timestep = STEP;
    // Çözücü: daha çok yineleme = yığınlar, eklemler ve temaslar daha kararlı
    this.world.integrationParameters.numSolverIterations = 8;

    this.linked = [];          // { body, mesh } — her karede eşitlenir
    this.dynamics = new Set(); // ara konum tutulan dinamik gövdeler
    this.kinematics = new Set();
    this.accumulator = 0;
    this.alpha = 1;
    this.preStep = new Set();  // her alt adımdan önce çağrılır (ragdoll sınırları)
  }

  /* ── Malzemeler ─────────────────────────────────────────────────────── */

  // cannon-es'teki temas malzemelerinin karşılığı: Rapier sürtünme ve
  // sekmeyi çarpıştırıcı başına tutar, birleştirme kuralı çiftin değerini
  // belirler. Bomba "Max" sekme + "Min" sürtünme ile her yüzeyde sekip
  // yuvarlanır; eşyalar ortalamayla yığılınca kaymaz.
  _material(desc, kind) {
    const R = RAPIER.CoefficientCombineRule;
    switch (kind) {
      case 'prop': desc.setFriction(0.55).setRestitution(0.06); break;
      case 'grenade':
        desc.setFriction(0.28).setRestitution(0.42)
          .setFrictionCombineRule(R.Min).setRestitutionCombineRule(R.Max);
        break;
      case 'ragdoll': desc.setFriction(0.9).setRestitution(0.02); break;
      default: desc.setFriction(0.5).setRestitution(0.1);
    }
    return desc;
  }

  /* ── Statik dünya ───────────────────────────────────────────────────── */

  addStaticBox(center, size) {
    const desc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setTranslation(center.x, center.y, center.z)
      .setCollisionGroups(groups(GROUP.WORLD, ALL));
    const col = this.world.createCollider(this._material(desc, 'world'));
    return new PBody(this, null, col);
  }

  addGroundPlane(y = 0) {
    const desc = new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 }))
      .setTranslation(0, y, 0)
      .setCollisionGroups(groups(GROUP.WORLD, ALL));
    const col = this.world.createCollider(this._material(desc, 'world'));
    return new PBody(this, null, col);
  }

  /* ── Dinamik eşyalar ────────────────────────────────────────────────── */

  /**
   * Genel dinamik gövde. `shape` bir ColliderDesc; konum/dönüş `at`
   * nesnesinden (mesh ya da {position, quaternion}) alınır.
   */
  addDynamic(at, shapeDesc, mass, {
    kind = 'prop', linearDamping = 0.12, angularDamping = 0.3, ccd = false,
    group = GROUP.PROP, filter = ALL, velocity = null, mesh = null,
  } = {}) {
    const p = at.position, q = at.quaternion ?? new THREE.Quaternion();
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(linearDamping)
      .setAngularDamping(angularDamping)
      .setCcdEnabled(ccd);
    if (velocity) rbDesc.setLinvel(velocity.x, velocity.y, velocity.z);
    const rb = this.world.createRigidBody(rbDesc);
    shapeDesc.setMass(mass).setCollisionGroups(groups(group, filter));
    const col = this.world.createCollider(this._material(shapeDesc, kind), rb);
    const body = new PBody(this, rb, col);
    body._snap();
    this.dynamics.add(body);
    if (mesh) this.linked.push({ body, mesh });
    return body;
  }

  /** @param actors false: oyuncu/düşman gövdeleriyle çarpışmaz (içlerinde doğanlar) */
  addDynamicBox(mesh, size, mass = 12, { actors = true } = {}) {
    return this.addDynamic(mesh, RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2), mass, {
      mesh, linearDamping: 0.12, angularDamping: 0.3, filter: actors ? ALL : ALL & ~GROUP.ACTOR,
    });
  }

  addDynamicCylinder(mesh, radius, height, mass = 18) {
    return this.addDynamic(mesh, RAPIER.ColliderDesc.cylinder(height / 2, radius), mass, {
      mesh, linearDamping: 0.14, angularDamping: 0.35,
    });
  }

  /** Bomba ve kovan: küçük ve hızlı → sürekli çarpışma (CCD) açık. */
  addSphere(position, radius, mass, { velocity, actors = true } = {}) {
    return this.addDynamic({ position }, RAPIER.ColliderDesc.ball(radius), mass, {
      kind: 'grenade', linearDamping: 0.04, angularDamping: 0.22, ccd: true,
      group: GROUP.SMALL, velocity, filter: actors ? ALL : ALL & ~GROUP.ACTOR,
    });
  }

  /** Oyuncu/düşman temsilcisi: konumu dışarıdan sürülür. */
  addKinematicCapsule(radius, height) {
    const rb = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const desc = RAPIER.ColliderDesc.cylinder(height / 2, radius)
      .setCollisionGroups(groups(GROUP.ACTOR, ALL & ~GROUP.ACTOR));
    const col = this.world.createCollider(this._material(desc, 'world'), rb);
    const body = new PBody(this, rb, col);
    body._target = new THREE.Vector3();
    body._from = new THREE.Vector3();
    body._moved = false;
    this.kinematics.add(body);
    return body;
  }

  /**
   * Kinematik gövdenin yeni hedef konumu. Rapier gövdeyi alt adımlar
   * boyunca oraya KAYDIRIR, böylece hızı da bilinir: yürüyen oyuncu
   * varili, sandığı, cesedi iter. Büyük sıçramalar (ışınlanma, yeniden
   * doğma) hız sayılmaz, doğrudan taşınır.
   */
  moveKinematic(body, x, y, z) {
    const p = body.rb.translation();
    const dx = x - p.x, dy = y - p.y, dz = z - p.z;
    if (!body._moved || dx * dx + dy * dy + dz * dz > 9) {
      body.rb.setTranslation({ x, y, z }, true);
      body._from.set(x, y, z);
    } else body._from.set(p.x, p.y, p.z);
    body._target.set(x, y, z);
    body._moved = true;
  }

  remove(body) {
    if (!body) return;
    if (body.rb) {
      this.world.removeRigidBody(body.rb);   // çarpıştırıcı ve eklemler de gider
      this.dynamics.delete(body);
      this.kinematics.delete(body);
    } else if (body.collider) {
      this.world.removeCollider(body.collider, false);
    }
    body.rb = null;
    body.collider = null;
    const i = this.linked.findIndex((l) => l.body === body);
    if (i >= 0) this.linked.splice(i, 1);
  }

  /**
   * Gövdeye itme uygular. (px, py, pz) kütle merkezine göre, dünya
   * yönelimli uygulama noktası: üstünden itilen varil devrilir.
   */
  impulse(body, x, y, z, px = 0, py = 0, pz = 0) {
    if (!body?.rb || !body.rb.isDynamic()) return;
    const c = body.rb.translation();
    body.rb.applyImpulseAtPoint({ x, y, z }, { x: c.x + px, y: c.y + py, z: c.z + pz }, true);
  }

  /* ── Patlama ────────────────────────────────────────────────────────── */

  /** Yarıçap içindeki dinamik gövdeleri merkezden dışarı iter. */
  explosion(center, radius, force) {
    const d = new THREE.Vector3();
    for (const body of this.dynamics) {
      const rb = body.rb;
      const t = rb.translation();
      d.set(t.x - center.x, t.y - center.y, t.z - center.z);
      const dist = d.length();
      if (dist > radius || dist < 1e-4) continue;
      const falloff = 1 - dist / radius;
      d.divideScalar(dist);
      d.y += 0.55;                       // patlamalar eşyaları hafif kaldırır
      // cannon'daki kuvvetler 12–68 kg'lık eşyalar için ayarlıydı; ragdoll
      // uzuvları gibi hafif parçalar kütleleriyle orantılı itilir, yoksa
      // 4 kg'lık bir ön kol 30 m uçuyor
      const k = force * falloff * Math.min(1, rb.mass() / 12);
      // İtme merkezden biraz kaçık uygulanır: eşyalar dönerek savrulur
      rb.applyImpulseAtPoint(
        { x: d.x * k, y: d.y * k, z: d.z * k },
        { x: t.x + (Math.random() - 0.5) * 0.5, y: t.y + (Math.random() - 0.2) * 0.4, z: t.z + (Math.random() - 0.5) * 0.5 },
        true,
      );
    }
  }

  /* ── Eklemler (ragdoll) ─────────────────────────────────────────────── */

  /** Küresel eklem (omuz, kalça, bel, boyun). a1/a2 gövdelerin yerel uzayında. */
  ballJoint(b1, b2, a1, a2) {
    return this.world.createImpulseJoint(RAPIER.JointData.spherical(a1, a2), b1.rb, b2.rb, true);
  }

  /** Menteşe (diz, dirsek): eksen her iki gövdenin yerel uzayında aynı. */
  hingeJoint(b1, b2, a1, a2, axis, min, max) {
    // Sınır eklem KURULDUKTAN sonra verilir: JointData.limits alanı
    // menteşede yok sayılıyor (ölçüldü: sınırsız ±3.4e38 kalıyordu)
    const j = this.world.createImpulseJoint(RAPIER.JointData.revolute(a1, a2, axis), b1.rb, b2.rb, true);
    j.setLimits(min, max);
    return j;
  }

  /* ── Döngü ──────────────────────────────────────────────────────────── */

  /**
   * Sabit adım 1/90 sn. Görüntü ARA KONUMLA eşitlenir: ekran yenileme hızı
   * fizik adımından farklıyken (120/144 Hz) eşyalar tırtıklı hareket ediyordu.
   */
  step(dt) {
    this.accumulator = Math.min(this.accumulator + dt, STEP * MAX_SUB);
    const n = Math.floor(this.accumulator / STEP);
    for (let i = 0; i < n; i++) {
      // Kinematik gövdeler hedeflerine alt adımlara bölünerek ilerler:
      // tek alt adımda bütün kare yolunu almak itmeyi patlatıyordu
      const k = (i + 1) / n;
      for (const b of this.kinematics) {
        b.rb.setNextKinematicTranslation({
          x: b._from.x + (b._target.x - b._from.x) * k,
          y: b._from.y + (b._target.y - b._from.y) * k,
          z: b._from.z + (b._target.z - b._from.z) * k,
        });
      }
      for (const f of this.preStep) f(STEP);
      if (i === n - 1) {
        for (const b of this.dynamics) { b._prevP.copy(b._curP); b._prevQ.copy(b._curQ); }
      }
      this.world.step();
    }
    this.accumulator -= n * STEP;
    for (const b of this.kinematics) b._from.copy(b._target);

    if (n > 0) {
      for (const b of this.dynamics) {
        const t = b.rb.translation(), q = b.rb.rotation();
        b._curP.set(t.x, t.y, t.z);
        b._curQ.set(q.x, q.y, q.z, q.w);
      }
    }
    const a = this.alpha = this.accumulator / STEP;
    for (const b of this.dynamics) {
      b.ipos.lerpVectors(b._prevP, b._curP, a);
      b.iquat.slerpQuaternions(b._prevQ, b._curQ, a);
    }
    for (const { body, mesh } of this.linked) {
      mesh.position.copy(body.ipos);
      mesh.quaternion.copy(body.iquat);
    }
  }
}
