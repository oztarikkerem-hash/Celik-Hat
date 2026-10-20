/* Gerçek ragdoll: ölen asker fizikle yığılır.

   Ölüm anındaki kemik pozundan 11 parçalı bir Rapier iskeleti kurulur:
   kalça (kutu), gövde (kutu), kafa (küre), üst kol / ön kol, uyluk / baldır
   (kapsül; ön kola el, baldıra ayak eklenir). Eklemler:
     • diz ve dirsek → MENTEŞE (yalnızca bükülme yönünde, sınırlı)
     • bel, boyun, omuz, kalça → küresel eklem + bizim KONİ sınırımız
       (Rapier'in küresel ekleminde açı sınırı yok; her alt adımda
       uzvun açısı ölçülüp koniden taşan kısım hızla geri çekilir).
   Parçalar birbiriyle çarpışmaz (bitişik kapsüller iç içe başlıyor),
   dünya, eşyalar ve diğer cesetlerle çarpışır.

   Her kare fizik gövdelerinin ARA konumu kemiklere yazılır: Hips konum +
   dönüş, diğer sürülen kemikler yalnızca dönüş (konumları hiyerarşiden
   gelir, uzuvlar uzamaz). Sürülmeyen kemikler (Spine1/2, el, ayak,
   parmaklar) ölüm anındaki yerel pozlarında kalır.

   Bütün parçalar 0.6 sn kıpırdamayınca (ya da 9 sn dolunca) iskelet DONAR: gövdeler
   fizikten sökülür, poz yerinde kalır — sahnede uzun süre kalan cesetler
   (Suikast'ta 240 sn) fizik maliyeti yaratmaz.

   Tüfek de elden düşer ve ayrı bir fizik gövdesi olarak yere yuvarlanır. */

import * as THREE from 'three';
import { RAPIER, GROUP, groups } from '../core/physics.js';

const ALL = 0xffff;
const RAG_FILTER = ALL & ~GROUP.RAGDOLL & ~GROUP.ACTOR;
const MAX_LIFE = 9;          // sn: bu süreden sonra uyumasa da donar

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/** Y ekseni `yDir`, X ekseni `xHint`e (dik bileşeni) bakan dönüş. */
function frameQuat(yDir, xHint) {
  const y = yDir.clone().normalize();
  let x = xHint.clone().addScaledVector(y, -xHint.dot(y));
  if (x.lengthSq() < 1e-6) {
    x = Math.abs(y.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    x.addScaledVector(y, -x.dot(y));
  }
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

const toLocal = (body, world) => {
  const t = body.rb.translation(), r = body.rb.rotation();
  _q.set(r.x, r.y, r.z, r.w).invert();
  const l = _v.set(world.x - t.x, world.y - t.y, world.z - t.z).applyQuaternion(_q);
  return { x: l.x, y: l.y, z: l.z };
};

export class Ragdoll {
  /**
   * @param physics  Physics
   * @param soldier  Soldier (kemikleri ölüm pozunda)
   * @param scene    tüfeğin düşeceği sahne
   * @param opts     { velocity, dir, force, part, point, blast }
   *   velocity: askerin o anki yürüme hızı (m/s)
   *   dir/force: isabet yönü ve itmesi (N·s), part: 'head'|'body'|'leg'
   *   blast: { center, radius } — patlamada bütün parçalar savrulur
   */
  constructor(physics, soldier, scene, opts = {}) {
    this.physics = physics;
    this.soldier = soldier;
    this.scene = scene;
    this.parts = {};
    this.cones = [];
    this.drive = [];          // { bone, part, offQ, offP? } — hiyerarşi sırasıyla
    this.age = 0;
    this.still = 0;           // parçaların kıpırdamadan geçirdiği süre
    this.frozen = false;

    const b = soldier.bones;
    soldier.root.updateWorldMatrix(true, true);
    const P = (n) => new THREE.Vector3().setFromMatrixPosition(b[n].matrixWorld);
    const rootQ = soldier.root.getWorldQuaternion(new THREE.Quaternion());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rootQ);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(rootQ);
    // Kök uzayında +x askerin SOLU
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ);

    // Ölçek: uyluk boyu ~0.45 m olan 1.8 m'lik asker referans
    const sc = THREE.MathUtils.clamp(P('LeftUpLeg').distanceTo(P('LeftLeg')) / 0.45, 0.6, 2);
    this.scale = sc;

    // ── Parçalar ────────────────────────────────────────────────────────
    const add = (name, pos, quat, shape, mass, extra = []) => {
      const body = physics.addDynamic({ position: pos, quaternion: quat }, shape, mass, {
        kind: 'ragdoll', linearDamping: 0.08, angularDamping: 1.2,
        group: GROUP.RAGDOLL, filter: RAG_FILTER, ccd: name === 'head' || name === 'torso',
      });
      for (const ex of extra) {
        ex.setCollisionGroups(groups(GROUP.RAGDOLL, RAG_FILTER));
        physics._material(ex, 'ragdoll');
        physics.world.createCollider(ex, body.rb);
      }
      body.restQ = quat.clone();
      body.restP = pos.clone();
      this.parts[name] = body;
      return body;
    };
    const mid = (a, c) => a.clone().add(c).multiplyScalar(0.5);

    // Kalça: iki uyluk başı arasında yatay kutu
    const hips = P('Hips'), lUp = P('LeftUpLeg'), rUp = P('RightUpLeg');
    const spine = P('Spine'), neck = P('Neck'), head = P('Head');
    const pelvisY = spine.clone().sub(hips).normalize();
    if (pelvisY.lengthSq() < 0.5) pelvisY.copy(up);
    const pelvisC = mid(hips, mid(lUp, rUp));
    const hipW = lUp.distanceTo(rUp) / 2 + 0.05 * sc;
    add('pelvis', pelvisC, frameQuat(pelvisY, lUp.clone().sub(rUp)),
      RAPIER.ColliderDesc.cuboid(hipW, 0.11 * sc, 0.12 * sc), 11);

    // Gövde: Spine → Neck, göğüs kafesi kutusu
    const lArm = P('LeftArm'), rArm = P('RightArm');
    const torsoLen = spine.distanceTo(neck);
    add('torso', mid(spine, neck), frameQuat(neck.clone().sub(spine), lArm.clone().sub(rArm)),
      RAPIER.ColliderDesc.cuboid(0.17 * sc, torsoLen / 2 + 0.02 * sc, 0.12 * sc), 24);

    // Kafa: boyun-kafa doğrultusunda küre
    const headDir = head.clone().sub(neck).normalize();
    add('head', head.clone().addScaledVector(headDir, 0.08 * sc),
      frameQuat(headDir, left), RAPIER.ColliderDesc.ball(0.115 * sc), 5);

    // Uzuvlar: menteşe ekseni iki parçada da yerel X olsun diye çerçeveler
    // o eksene göre kurulur
    const hingeAxis = (a, j, c, pref) => {
      const d1 = j.clone().sub(a).normalize(), d2 = c.clone().sub(j).normalize();
      const n = new THREE.Vector3().crossVectors(d1, d2);
      if (n.lengthSq() < 0.04) n.crossVectors(d1, pref);
      if (n.lengthSq() < 1e-6) n.copy(left);
      return n.normalize();
    };
    const capsule = (len, r) => RAPIER.ColliderDesc.capsule(Math.max(0.02, len / 2 - r * 0.6), r);

    for (const S of ['Left', 'Right']) {
      const sh = P(`${S}Arm`), el = P(`${S}ForeArm`), wr = P(`${S}Hand`);
      const axA = hingeAxis(sh, el, wr, fwd);
      const uaDir = el.clone().sub(sh), faDir = wr.clone().sub(el).normalize();
      add(`${S}UpperArm`, mid(sh, el), frameQuat(uaDir, axA),
        capsule(uaDir.length(), 0.055 * sc), 2.5);
      // Ön kol + el: bilekten 9 cm daha uzanır
      const tip = wr.clone().addScaledVector(faDir, 0.09 * sc);
      add(`${S}ForeArm`, mid(el, tip), frameQuat(faDir, axA),
        capsule(el.distanceTo(tip), 0.05 * sc), 2);

      const hp = P(`${S}UpLeg`), kn = P(`${S}Leg`), an = P(`${S}Foot`);
      const toe = b[`${S}ToeBase`] ? P(`${S}ToeBase`) : an.clone().addScaledVector(fwd, 0.14 * sc);
      const axL = hingeAxis(hp, kn, an, fwd.clone().negate());
      const thDir = kn.clone().sub(hp), shDir = an.clone().sub(kn);
      add(`${S}Thigh`, mid(hp, kn), frameQuat(thDir, axL),
        capsule(thDir.length(), 0.08 * sc), 9);
      // Baldır + ayak (ayak ayrı kapsül, aynı gövdede)
      const shinQ = frameQuat(shDir, axL), shinP = mid(kn, an);
      const footDir = toe.clone().sub(an);
      const footLen = Math.max(0.08 * sc, footDir.length() + 0.04 * sc);
      const footQ = shinQ.clone().invert().multiply(frameQuat(footDir, axL));
      const footP = mid(an, toe).sub(shinP).applyQuaternion(shinQ.clone().invert());
      const foot = RAPIER.ColliderDesc.capsule(Math.max(0.02, footLen / 2 - 0.045 * sc), 0.045 * sc)
        .setTranslation(footP.x, footP.y, footP.z)
        .setRotation({ x: footQ.x, y: footQ.y, z: footQ.z, w: footQ.w })
        .setMass(1);
      add(`${S}Shin`, shinP, shinQ, capsule(shDir.length(), 0.062 * sc), 4, [foot]);
    }

    // ── Eklemler ────────────────────────────────────────────────────────
    const pr = this.parts;
    const ball = (p1, p2, at, coneDirLocal, cone) => {
      physics.ballJoint(p1, p2, toLocal(p1, at), toLocal(p2, at));
      // Koni: çocuğun Y ekseni, ebeveynin yerel uzayındaki `coneDirLocal`
      // doğrultusundan en çok `cone` radyan sapabilir
      this.cones.push({ p1, p2, dir: coneDirLocal.clone().normalize(), cone });
    };
    // Bükülme açısı = çocuğun ebeveyne göre +X (bükülme ekseni) etrafında
    // dönüşü; Rapier'in menteşe açısıyla aynı yönde (ölçüldü). Alt sınır
    // biraz eksi: düz bacakta hesaplanan eksen küçük bir ters açı verebiliyor
    const hinge = (p1, p2, at, min, max) => {
      physics.hingeJoint(p1, p2, toLocal(p1, at), toLocal(p2, at), { x: 1, y: 0, z: 0 }, min, max);
    };
    // Ebeveyn çerçeveleri: pelvis/torso yerel X = sol, Y = yukarı, Z = arka
    ball(pr.pelvis, pr.torso, spine, new THREE.Vector3(0, 1, 0.1), 0.55);
    ball(pr.torso, pr.head, neck, new THREE.Vector3(0, 1, -0.1), 0.65);
    for (const [S, sx] of [['Left', 1], ['Right', -1]]) {
      // Omuz: kol aşağı sarkık duruş merkezli geniş koni
      ball(pr.torso, pr[`${S}UpperArm`], P(`${S}Arm`), new THREE.Vector3(0.35 * sx, -1, -0.25), 1.75);
      hinge(pr[`${S}UpperArm`], pr[`${S}ForeArm`], P(`${S}ForeArm`), -0.15, 2.5);
      // Kalça: uyluk aşağı ve hafif öne
      ball(pr.pelvis, pr[`${S}Thigh`], P(`${S}UpLeg`), new THREE.Vector3(0.12 * sx, -1, -0.35), 1.15);
      hinge(pr[`${S}Thigh`], pr[`${S}Shin`], P(`${S}Leg`), -0.15, 2.4);
    }
    this._limit = (dt) => this._applyCones(dt);
    physics.preStep.add(this._limit);

    // ── Kemik sürme bağları ────────────────────────────────────────────
    const bind = (boneName, part, withPos = false) => {
      const bone = b[boneName];
      if (!bone) return;
      const body = pr[part];
      const bq = bone.getWorldQuaternion(new THREE.Quaternion());
      const offQ = body.restQ.clone().invert().multiply(bq);
      const entry = { bone, body, offQ };
      if (withPos) {
        entry.offP = P(boneName).sub(body.restP).applyQuaternion(body.restQ.clone().invert());
      }
      this.drive.push(entry);
    };
    bind('Hips', 'pelvis', true);
    bind('Spine', 'torso');
    bind('Neck', 'head');
    for (const S of ['Left', 'Right']) {
      bind(`${S}Arm`, `${S}UpperArm`);
      bind(`${S}ForeArm`, `${S}ForeArm`);
      bind(`${S}UpLeg`, `${S}Thigh`);
      bind(`${S}Leg`, `${S}Shin`);
    }

    // Deri sınırları kökten uzaklaşabilir: kırpılıp kaybolmasın
    soldier.root.traverse((o) => { if (o.isSkinnedMesh || o.isMesh) o.frustumCulled = false; });

    // ── Başlangıç hızı ve darbe ────────────────────────────────────────
    const vel = opts.velocity ?? new THREE.Vector3();
    for (const body of Object.values(pr)) body.setVelocity(vel.x, vel.y, vel.z);
    // Dizler çözülür: ayakta ölen askerin bacakları düz kilitli kalınca
    // tahta gibi devriliyordu. Baldırlara bükülme yönünde (yerel +X)
    // açısal hız verilir, kalça biraz aşağı çekilir → asker yığılır.
    if (!opts.blast && !opts.launch) {
      // Uyluk ve baldır ZIT yönde döndürülür: tek başına baldıra verilen
      // hız eklemden uyluğa geçip bacağı bütün hâlde çeviriyor, diz
      // bükülmüyordu (ölçüldü: diz alt sınırda kalıyordu)
      for (const S of ['Left', 'Right']) {
        const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(pr[`${S}Shin`].restQ);
        const k = 7 + Math.random() * 3;
        pr[`${S}Shin`].setAngularVelocity(ax.x * k, ax.y * k, ax.z * k);
        pr[`${S}Thigh`].setAngularVelocity(-ax.x * k * 0.6, -ax.y * k * 0.6, -ax.z * k * 0.6);
      }
      pr.pelvis.setVelocity(vel.x, vel.y - 2, vel.z);
    }

    if (opts.blast) {
      const { center, radius = 6 } = opts.blast;
      for (const body of Object.values(pr)) {
        const p = body.position;
        const d = p.clone().sub(center);
        const dist = d.length();
        const k = Math.max(0.25, 1 - dist / radius);
        d.normalize();
        const v = d.multiplyScalar(7.5 * k).add(new THREE.Vector3(0, 4.2 * k, 0));
        body.setVelocity(vel.x + v.x * (0.8 + Math.random() * 0.4), vel.y + v.y, vel.z + v.z * (0.8 + Math.random() * 0.4));
        body.setAngularVelocity((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
      }
    }
    if (opts.dir && opts.force) {
      const target = this._partFor(opts.part, opts.point);
      const d = opts.dir;
      const at = opts.point ?? target.position;
      const c = target.position;
      physics.impulse(target, d.x * opts.force, d.y * opts.force + opts.force * 0.15, d.z * opts.force,
        at.x - c.x, at.y - c.y, at.z - c.z);
      // Gövdeye de bir pay: yalnızca uzuv savrulmasın, asker geriye yığılsın
      if (target !== pr.torso) {
        physics.impulse(pr.torso, d.x * opts.force * 0.5, 0, d.z * opts.force * 0.5);
      }
    }

    this._dropRifle(vel, opts);
  }

  /** İsabet bölgesine en yakın parça. */
  _partFor(part, point) {
    const pr = this.parts;
    if (part === 'head') return pr.head;
    if (!point) return part === 'leg' ? pr.LeftThigh : pr.torso;
    let best = pr.torso, bd = Infinity;
    const names = part === 'leg'
      ? ['LeftThigh', 'RightThigh', 'LeftShin', 'RightShin']
      : ['torso', 'pelvis', 'LeftUpperArm', 'RightUpperArm', 'LeftForeArm', 'RightForeArm'];
    for (const n of names) {
      const d = pr[n].position.distanceToSquared(point);
      if (d < bd) { bd = d; best = pr[n]; }
    }
    return best;
  }

  /** Tüfek elden düşer: kendi sınır kutusuyla ayrı bir fizik gövdesi. */
  _dropRifle(vel, opts) {
    const rifle = this.soldier.rifle;
    if (!rifle || !this.scene) return;
    rifle.updateWorldMatrix(true, true);
    // Tüfeğin KENDİ ekseninde sınır kutusu (dünya eksenli kutu çapraz
    // duran silahı şişiriyordu)
    const inv = new THREE.Matrix4().copy(rifle.matrixWorld).invert();
    const box = new THREE.Box3(), tmp = new THREE.Box3();
    rifle.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(_m.multiplyMatrices(inv, o.matrixWorld));
      box.union(tmp);
    });
    if (box.isEmpty()) return;
    const ws = new THREE.Vector3().setFromMatrixScale(rifle.matrixWorld);
    const size = box.getSize(new THREE.Vector3()).multiply(ws);
    const center = box.getCenter(new THREE.Vector3()).applyMatrix4(rifle.matrixWorld);
    const pivot = new THREE.Group();
    pivot.position.copy(center);
    rifle.getWorldQuaternion(pivot.quaternion);
    this.scene.add(pivot);
    pivot.attach(rifle);
    this.soldier._dropped = true;
    const body = this.physics.addDynamic(pivot,
      RAPIER.ColliderDesc.cuboid(Math.max(0.02, size.x / 2), Math.max(0.02, size.y / 2), Math.max(0.05, size.z / 2)),
      3.6, {
        kind: 'prop', linearDamping: 0.1, angularDamping: 0.6, ccd: true, mesh: pivot,
        group: GROUP.PROP, filter: ALL & ~GROUP.RAGDOLL & ~GROUP.ACTOR,
      });
    const d = opts.dir ?? new THREE.Vector3();
    const k = opts.blast ? 6 : Math.min(3, (opts.force ?? 0) / 25);
    body.setVelocity(vel.x + d.x * k + (Math.random() - 0.5), vel.y + 1.2, vel.z + d.z * k + (Math.random() - 0.5));
    body.setAngularVelocity((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 5);
    this.rifle = { pivot, body };
  }

  /* Koni sınırı (her fizik alt adımından önce). Taşma varsa çocuğun açısal
     hızındaki "dışarı" bileşeni silinir ve taşma oranında geri döndürülür;
     ebeveyne ters yönde küçük bir pay verilir (momentum dengesi). */
  _applyCones() {
    const a = new THREE.Vector3(), ref = new THREE.Vector3(), axis = new THREE.Vector3();
    for (const c of this.cones) {
      // Uyuyan parçaya dokunma: yerde sınırı hafif aşan uzuv iskeleti
      // sürekli uyandırıp donmasını engelliyordu
      if (c.p1.rb.isSleeping() && c.p2.rb.isSleeping()) continue;
      const r1 = c.p1.rb.rotation(), r2 = c.p2.rb.rotation();
      ref.copy(c.dir).applyQuaternion(_q.set(r1.x, r1.y, r1.z, r1.w));
      a.set(0, 1, 0).applyQuaternion(_q.set(r2.x, r2.y, r2.z, r2.w));
      // Burulma sürtünmesi: küresel eklemde burulma sınırı yok, yerdeki
      // kol kendi ekseninde dönüp duruyordu — uzun eksen etrafındaki
      // göreli dönüşün bir kısmı her alt adımda silinir
      {
        const w1 = c.p1.rb.angvel(), w2 = c.p2.rb.angvel();
        const tw = ((w2.x - w1.x) * a.x + (w2.y - w1.y) * a.y + (w2.z - w1.z) * a.z) * 0.25;
        if (Math.abs(tw) > 1e-3) {
          c.p2.rb.setAngvel({ x: w2.x - a.x * tw, y: w2.y - a.y * tw, z: w2.z - a.z * tw }, false);
        }
      }
      const ang = a.angleTo(ref);
      if (ang <= c.cone) continue;
      axis.crossVectors(a, ref);
      if (axis.lengthSq() < 1e-8) continue;
      axis.normalize();                            // çocuğu koniye döndüren eksen
      const w1 = c.p1.rb.angvel(), w2 = c.p2.rb.angvel();
      const rel = (w2.x - w1.x) * axis.x + (w2.y - w1.y) * axis.y + (w2.z - w1.z) * axis.z;
      // Yumuşak geri çekme: sert çekiş, uzuv yerde koniden taşınca onu
      // zemine bastırıp döndürüyordu
      const want = Math.min(6, (ang - c.cone) * 10);
      const dv = want - rel;
      if (dv <= 0) continue;
      const m1 = c.p1.mass, m2 = c.p2.mass, k2 = m1 / (m1 + m2), k1 = m2 / (m1 + m2);
      c.p2.rb.setAngvel({ x: w2.x + axis.x * dv * k2, y: w2.y + axis.y * dv * k2, z: w2.z + axis.z * dv * k2 }, false);
      c.p1.rb.setAngvel({ x: w1.x - axis.x * dv * k1, y: w1.y - axis.y * dv * k1, z: w1.z - axis.z * dv * k1 }, false);
    }
  }

  /** Kemikleri fizik gövdelerinin ara konumlarından yazar. */
  _pose() {
    for (const d of this.drive) {
      const bone = d.bone, parent = bone.parent;
      const q = _q.copy(d.body.iquat).multiply(d.offQ);       // istenen dünya dönüşü
      parent.updateWorldMatrix(true, false);
      const pq = parent.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(pq.invert().multiply(q));
      if (d.offP) {
        const wp = _v2.copy(d.offP).applyQuaternion(d.body.iquat).add(d.body.ipos);
        bone.position.copy(parent.worldToLocal(wp));
      }
      bone.updateMatrixWorld(true);
    }
  }

  /** Pelvisin dünya konumu (yağma mesafesi vb. için). */
  get center() {
    return this.frozen ? this._center : this.parts.pelvis.ipos;
  }

  /** @returns {boolean} hâlâ fizikte mi */
  update(dt) {
    if (this.frozen) return false;
    this.age += dt;
    this._pose();
    // Donma ölçütü hız: Rapier'in uykusu yetmiyor, yerdeki kafa küçük
    // bir yuvarlanmayla iskeleti saniyelerce uyanık tutuyordu
    let lin = 0, ang = 0;
    for (const p of Object.values(this.parts)) {
      const v = p.rb.linvel(), w = p.rb.angvel();
      lin = Math.max(lin, v.x * v.x + v.y * v.y + v.z * v.z);
      ang = Math.max(ang, w.x * w.x + w.y * w.y + w.z * w.z);
    }
    this.still = lin < 0.08 * 0.08 && ang < 0.6 * 0.6 ? this.still + dt : 0;
    // Yerinde dönen ama yer değiştirmeyen uzuv donmayı geciktirmesin
    this.slow = lin < 0.12 * 0.12 ? (this.slow ?? 0) + dt : 0;
    if (this.still > 0.6 || this.slow > 1.5 || this.age > MAX_LIFE) this.freeze();
    return !this.frozen;
  }

  /** Fizikten sök, poz yerinde kalsın. */
  freeze() {
    if (this.frozen) return;
    this._pose();
    this._center = this.parts.pelvis.ipos.clone();
    this.physics.preStep.delete(this._limit);
    for (const p of Object.values(this.parts)) this.physics.remove(p);
    if (this.rifle) this.physics.remove(this.rifle.body);
    this.frozen = true;
  }

  dispose() {
    this.freeze();
    if (this.rifle) this.scene.remove(this.rifle.pivot);
  }
}
