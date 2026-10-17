/* Birinci şahıs kollar.

   Ayrı bir kol modeli yok: müttefiklerin SWAT modeli klonlanır ve yalnızca
   KOL üçgenleri bırakılır (köşe ağırlıklarının çoğu omuz-altı kol, ön kol,
   el ve parmak kemiklerinde olan üçgenler). Böylece eldivenler, kollar ve
   dokular askerlerinkiyle birebir aynı, iskelet de tam (parmak başına dört
   kemik).

   Her kare:
     1. Silahtaki hedefe (avuç merkezi + bilek yönü + avuç yönü) iki kemikli
        IK ile uzanılır; dirsek verilen kutup yönüne bakar.
     2. El dünya yönelimine oturtulur. Mixamo'da bükülme kemiği olmadığı için
        bilek dönüşünün yarısı ön kola dağıtılır (yoksa bilek "şeker
        ambalajı" gibi burulur).
     3. Parmaklar avuca doğru kıvrılır: her eklemin kıvrılma ekseni dinlenme
        duruşundan ölçülür (parmak yönü × avuç normali), poz yalnızca açı
        listesidir.                                                          */

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const ARM_RE = /^(Left|Right)(Arm|ForeArm|Hand)/;

/* Parmak pozları: [başparmak, işaret, orta, yüzük, serçe] × 3 eklem (rad).
   Değerler gerçek tutuşlardan: kabzayı kavrayan elde işaret parmağı tetiğe
   uzanır, el kundağında parmaklar yarı kapalı, şarjörde avuç sarar.        */
export const POSES = {
  grip:    [[0.30, 0.35, 0.30], [1.10, 1.20, 0.75], [1.20, 1.25, 0.80], [1.25, 1.25, 0.80], [1.30, 1.20, 0.75]],
  trigger: [[0.30, 0.35, 0.30], [0.45, 0.30, 0.20], [1.20, 1.25, 0.80], [1.25, 1.25, 0.80], [1.30, 1.20, 0.75]],
  squeeze: [[0.30, 0.35, 0.30], [0.75, 0.70, 0.45], [1.20, 1.25, 0.80], [1.25, 1.25, 0.80], [1.30, 1.20, 0.75]],
  support: [[0.20, 0.20, 0.15], [0.70, 0.75, 0.45], [0.80, 0.85, 0.50], [0.85, 0.85, 0.55], [0.90, 0.85, 0.50]],
  mag:     [[0.45, 0.35, 0.25], [0.55, 0.60, 0.35], [0.95, 1.05, 0.65], [1.05, 1.05, 0.65], [1.05, 1.00, 0.60]],
  pinch:   [[0.65, 0.45, 0.35], [0.95, 1.15, 0.60], [1.40, 1.50, 0.90], [1.45, 1.50, 0.90], [1.45, 1.45, 0.85]],
  open:    [[0.10, 0.10, 0.05], [0.18, 0.18, 0.10], [0.20, 0.18, 0.10], [0.22, 0.18, 0.10], [0.25, 0.18, 0.10]],
  flat:    [[0.05, 0.02, 0.02], [0.03, 0.03, 0.02], [0.03, 0.03, 0.02], [0.03, 0.03, 0.02], [0.04, 0.03, 0.02]],
  fist:    [[0.60, 0.60, 0.50], [1.45, 1.55, 0.95], [1.50, 1.60, 1.00], [1.50, 1.60, 1.00], [1.50, 1.55, 0.95]],
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();

/** Kemiği, çocuğu verilen dünya yönüne bakacak şekilde döndürür. */
function aimWorld(bone, child, dir) {
  bone.updateWorldMatrix(true, false);
  child.updateWorldMatrix(false, false);
  const from = _a.setFromMatrixPosition(child.matrixWorld)
    .sub(_b.setFromMatrixPosition(bone.matrixWorld));
  if (from.lengthSq() < 1e-10) return;
  from.normalize();
  const delta = _q.setFromUnitVectors(from, _c.copy(dir).normalize());
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const boneQ = bone.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentQ.invert().multiply(delta).multiply(boneQ));
  bone.updateMatrixWorld(true);
}

/** Kemiğin dünya yönelimini doğrudan ayarlar (ebeveynden bağımsız). */
function setWorldQuat(bone, worldQ) {
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentQ.invert().multiply(worldQ));
  bone.updateMatrixWorld(true);
}

/** Üç dik vektörden (sütun) dönüş. */
function basisQuat(k, n, out) {
  const s = _a.crossVectors(k, n);
  _m.makeBasis(k, n, s);
  return out.setFromRotationMatrix(_m);
}

export class FPArms {
  /**
   * @param template  SoldierFactory.template (SWAT modeli)
   * @param height    modelin kendi boyu (oyun ölçeğine 1.8 m'ye getirilir)
   */
  constructor(template, height) {
    const body = cloneSkinned(template);
    body.rotation.y = Math.PI;              // model +Z'ye bakıyor; oyun -Z

    this.root = new THREE.Group();
    this.root.add(body);
    this.root.scale.setScalar(1.8 / (height || 1.8));
    this.body = body;

    this.bones = {};
    body.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });

    // ── Yalnızca kol üçgenleri ───────────────────────────────────────────
    body.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      o.geometry = this._armsOnly(o);
      o.frustumCulled = false;
      o.castShadow = false;
      o.receiveShadow = false;
    });

    // ── Kol boyu ─────────────────────────────────────────────────────────
    // SWAT modelinde omuz→bilek 0.44 m (gerçekte ~0.55 m); bu boyla el
    // kundağına uzanan kol kilitleniyor, el hedefin 10 cm gerisinde
    // kalıyordu. Eller büyümesin diye ölçek değil, kemik boyu uzatılır:
    // üst kol ve ön kol segmentleri gerilir, eldiven aynı kalır.
    for (const S of ['Left', 'Right']) {
      this.bones[`${S}ForeArm`].position.multiplyScalar(1.25);
      this.bones[`${S}Hand`].position.multiplyScalar(1.22);
    }

    // ── Omuzları kameranın arkasına-altına yerleştir ─────────────────────
    this.root.updateWorldMatrix(true, true);
    const L = new THREE.Vector3().setFromMatrixPosition(this.bones.LeftArm.matrixWorld);
    const R = new THREE.Vector3().setFromMatrixPosition(this.bones.RightArm.matrixWorld);
    const mid = L.clone().add(R).multiplyScalar(0.5);
    // Omuz ortasının kökün kendi (ölçekli) uzayındaki yeri: duruş değişince
    // kök bu noktanın etrafında döndürülür
    this.midLocal = mid.clone();
    this.stanceYaw = 0;
    this.stanceMid = new THREE.Vector3(0, -0.27, 0.16);
    this.setStance(0, this.stanceMid);
    this.root.updateWorldMatrix(true, true);

    this.side = {
      L: this._measureHand('Left'),
      R: this._measureHand('Right'),
    };
  }

  /** Kol kemiklerine bağlı üçgenlerden yeni dizin üretir (köşeler paylaşılır). */
  _armsOnly(mesh) {
    const src = mesh.geometry;
    const bones = mesh.skeleton.bones;
    const armIdx = new Set();
    bones.forEach((b, i) => { if (ARM_RE.test(b.name)) armIdx.add(i); });

    const si = src.attributes.skinIndex;
    const sw = src.attributes.skinWeight;
    const n = si.count;
    const w = new Float32Array(n);
    for (let v = 0; v < n; v++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        if (armIdx.has(si.getComponent(v, k))) s += sw.getComponent(v, k);
      }
      w[v] = s;
    }

    const index = src.index ? src.index.array : null;
    const tri = index ? index.length / 3 : n / 3;
    const keep = [];
    for (let t = 0; t < tri; t++) {
      const a = index ? index[t * 3] : t * 3;
      const b = index ? index[t * 3 + 1] : t * 3 + 1;
      const c = index ? index[t * 3 + 2] : t * 3 + 2;
      if (w[a] > 0.5 && w[b] > 0.5 && w[c] > 0.5) keep.push(a, b, c);
    }

    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes)) g.setAttribute(name, attr);
    g.setIndex(keep);
    g.groups = [];
    return g;
  }

  /* Dinlenme duruşunda el çerçevesi ve parmak eksenleri. Elin "yerel"
     bilek→boğum (k) ve avuç (n) yönleri ölçülür; her karede hedef çerçeve
     bu ikisine oturtulur.                                                  */
  _measureHand(side) {
    const b = this.bones;
    const hand = b[`${side}Hand`];
    const P = (name) => new THREE.Vector3().setFromMatrixPosition(b[`${side}Hand${name}`].matrixWorld);
    const wrist = new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld);
    const middle1 = P('Middle1');
    const index1 = P('Index1');
    const pinky1 = P('Pinky1');
    const thumb1 = P('Thumb1');

    const k = middle1.clone().sub(wrist).normalize();
    const across = index1.clone().sub(pinky1).normalize();
    let n = new THREE.Vector3().crossVectors(k, across).normalize();
    // Başparmak kökü avuç tarafındadır: avuç normali ona doğru baksın
    if (n.dot(thumb1.clone().sub(wrist)) < 0) n.negate();

    const handQ = hand.getWorldQuaternion(new THREE.Quaternion());
    const inv = handQ.clone().invert();
    const kl = k.clone().applyQuaternion(inv).normalize();
    const nl = n.clone().applyQuaternion(inv);
    nl.addScaledVector(kl, -nl.dot(kl)).normalize();
    // Yerel çerçeve dönüşünün tersi: dünya hedefinden kemik yönelimine
    const localBasisInv = basisQuat(kl, nl, new THREE.Quaternion()).invert();

    // Parmak eklemleri: kıvrılma ekseni = parmak yönü × avuç normali
    const fingers = FINGERS.map((f) => [1, 2, 3].map((j) => {
      const bone = b[`${side}Hand${f}${j}`];
      const child = b[`${side}Hand${f}${j + 1}`];
      if (!bone || !child) return null;
      const d = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld)
        .sub(new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld)).normalize();
      // Başparmak avucun üstünden çapraz kapanır: ekseni biraz yana yatır
      const axisW = new THREE.Vector3().crossVectors(d, n).normalize();
      if (f === 'Thumb') axisW.addScaledVector(k, 0.6).normalize();
      const boneQ = bone.getWorldQuaternion(new THREE.Quaternion());
      return {
        bone,
        rest: bone.quaternion.clone(),
        axis: axisW.applyQuaternion(boneQ.invert()).normalize(),
      };
    }));

    return {
      arm: b[`${side}Arm`],
      fore: b[`${side}ForeArm`],
      hand,
      handRest: hand.quaternion.clone(),
      localBasisInv,
      palmLen: wrist.distanceTo(middle1),
      fingers,
      pose: POSES.open.map((r) => r.slice()),
    };
  }

  /**
   * Bir eli hedefe götürür.
   * @param which   'L' | 'R'
   * @param target  { pos, k, n } — DÜNYA uzayında avuç merkezi, bilek→boğum
   *                yönü ve avuç normali
   * @param pose    parmak açıları (POSES biçiminde)
   * @param pole    dirseğin bakacağı dünya yönü
   */
  reach(which, target, pose, pole) {
    const s = this.side[which];
    const k = _b.copy(target.k).normalize().clone();
    const n = target.n.clone();
    n.addScaledVector(k, -n.dot(k)).normalize();

    // Avuç merkezinden bilek konumuna: boğumların yarısı kadar geri,
    // avucun eti kadar (≈2 cm) dışarı
    const wrist = target.pos.clone()
      .addScaledVector(k, -s.palmLen * 0.55)
      .addScaledVector(n, -0.022);

    this._twoBone(s.arm, s.fore, s.hand, wrist, pole);
    // Ayar için: bilek hedefe ne kadar uzak kaldı (kol yetişmiyorsa > 0)
    s.err = wrist.distanceTo(_a.setFromMatrixPosition(s.hand.matrixWorld));

    const handQ = basisQuat(k, n, new THREE.Quaternion()).multiply(s.localBasisInv);
    this._distributeTwist(s, handQ);
    setWorldQuat(s.hand, handQ);

    // Parmaklar
    for (let f = 0; f < 5; f++) {
      for (let j = 0; j < 3; j++) {
        const joint = s.fingers[f][j];
        if (!joint) continue;
        const ang = pose[f][j];
        joint.bone.quaternion.copy(joint.rest).multiply(_q2.setFromAxisAngle(joint.axis, ang));
      }
    }
    s.hand.updateMatrixWorld(true);
  }

  _twoBone(root, mid, tip, targetWorld, poleDir) {
    root.updateWorldMatrix(true, false);
    mid.updateWorldMatrix(false, false);
    tip.updateWorldMatrix(false, false);
    const a = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
    const b = new THREE.Vector3().setFromMatrixPosition(mid.matrixWorld);
    const c = new THREE.Vector3().setFromMatrixPosition(tip.matrixWorld);
    const l1 = a.distanceTo(b);
    const l2 = b.distanceTo(c);

    const toT = targetWorld.clone().sub(a);
    const reach = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
    const dir = toT.normalize();

    const cosA = THREE.MathUtils.clamp((l1 * l1 + reach * reach - l2 * l2) / (2 * l1 * reach), -1, 1);
    const ang = Math.acos(cosA);

    // Dirsek düzlemi: hedef yönü ile kutup yönünün oluşturduğu düzlem
    const pole = poleDir.clone().addScaledVector(dir, -poleDir.dot(dir)).normalize();
    const elbowDir = dir.clone().multiplyScalar(Math.cos(ang)).addScaledVector(pole, Math.sin(ang));

    aimWorld(root, mid, elbowDir);
    mid.updateWorldMatrix(true, false);
    const elbow = new THREE.Vector3().setFromMatrixPosition(mid.matrixWorld);
    aimWorld(mid, tip, targetWorld.clone().sub(elbow));
  }

  /* Bilek burulmasının yarısını ön kola ver (salınım-burulma ayrıştırması).
     Elin ön kola göre DİNLENME dönüşü H0'dan sapması D = H0⁻¹·(F⁻¹·H);
     D'nin ön kol ekseni etrafındaki bileşeni burulmadır. Ön kol kendi
     ekseni etrafında döndüğü için yönü değişmez.                          */
  _distributeTwist(s, handWorldQ) {
    const { fore, hand } = s;
    fore.updateWorldMatrix(true, false);
    const F = fore.getWorldQuaternion(new THREE.Quaternion());
    const axisW = new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld)
      .sub(new THREE.Vector3().setFromMatrixPosition(fore.matrixWorld)).normalize();

    const D = s.handRest.clone().invert().multiply(F.clone().invert().multiply(handWorldQ));
    // Eksen, elin dinlenme (ön kola göre) çerçevesinde
    const restW = F.clone().multiply(s.handRest);
    const axisH = axisW.clone().applyQuaternion(restW.invert()).normalize();
    const p = D.x * axisH.x + D.y * axisH.y + D.z * axisH.z;
    const angle = 2 * Math.atan2(p, D.w);
    if (Math.abs(angle) < 1e-3) return;

    const axisF = axisW.clone().applyQuaternion(F.clone().invert()).normalize();
    fore.quaternion.multiply(_q2.setFromAxisAngle(axisF, angle * 0.5));
    fore.updateMatrixWorld(true);
  }

  /* Gövde duruşu. Tüfekte nişancı yan durur: gövde sağa döner, sol omuz
     öne gelir — sol el ancak böyle el kundağına yetişir. Tabancada omuzlar
     karşıya bakar. yaw: radyan (+ = gövde sağa), mid: omuz ortası.       */
  setStance(yaw, mid) {
    this.stanceYaw = yaw;
    this.stanceMid.copy(mid);
    // Y etrafında +açı sağ omzu öne getirir; bize sol omuz önde lazım
    this.root.rotation.y = -yaw;
    const off = this.midLocal.clone().applyAxisAngle(_c.set(0, 1, 0), -yaw);
    this.root.position.copy(mid).sub(off);
  }

  set visible(v) { this.root.visible = v; }
  get visible() { return this.root.visible; }
}

/** İki parmak pozu arasında karışım (yeni dizi döner). */
export function blendPose(a, b, t) {
  const A = typeof a === 'string' ? POSES[a] : a;
  const B = typeof b === 'string' ? POSES[b] : b;
  return A.map((f, i) => f.map((v, j) => v + (B[i][j] - v) * t));
}
