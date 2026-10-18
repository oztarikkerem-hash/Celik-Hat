/* Asker: kullanıcının Blender modeli (iskelete otomatik bağlandı) ve
   tamamen kodla üretilen animasyonlar.

   Kaynak modelde hazır animasyon (action) yok, bu yüzden duruşlar kemik
   kemik kuruluyor. Eksen tahmini yapmıyoruz: her kemik için "şu an nereye
   bakıyor" ile "nereye bakmalı" vektörleri karşılaştırılıp aradaki dönüş
   uygulanıyor (aimBone). Bu yöntem rig'in eksen düzeninden bağımsız çalışır.

   Duruşlar: idle · walk · run · crouch · crouchMove · downed
   Üstüne binen katmanlar: nişan açısı (gövde/kafa) ve geri tepme.         */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftHandThumb1', 'LeftHandThumb2', 'LeftHandThumb3',
  'LeftHandIndex1', 'LeftHandIndex2', 'LeftHandIndex3',
  'LeftHandMiddle1', 'LeftHandMiddle2', 'LeftHandMiddle3',
  'LeftHandRing1', 'LeftHandRing2', 'LeftHandRing3',
  'LeftHandPinky1', 'LeftHandPinky2', 'LeftHandPinky3',
  'RightHandThumb1', 'RightHandThumb2', 'RightHandThumb3',
  'RightHandIndex1', 'RightHandIndex2', 'RightHandIndex3',
  'RightHandMiddle1', 'RightHandMiddle2', 'RightHandMiddle3',
  'RightHandRing1', 'RightHandRing2', 'RightHandRing3',
  'RightHandPinky1', 'RightHandPinky2', 'RightHandPinky3',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];

// Silahın gövdeye göre çapraz açısı (omza dayalı duruş)
const HOLD_YAW = 0.175;      // ~10°
// Klipli modelde silahın eldeki eğimi (hazır duruş: namlu hafif aşağı)
const RIFLE_TILT = 0.0;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _bodyQ = new THREE.Quaternion();
const PLANTED = new WeakMap();   // klip → { t: ayakların yerde olduğu an, yaw: gövde sapması }
// Nişan pozu: "fire" klibinin (Mixamo Firing Rifle) üst gövde kemik dönüşleri.
// Klip başına bir kez örneklenir, aynı modeli paylaşan askerler ortak kullanır.
const AIMPOSE = new WeakMap();   // klip → { pose: Map(kemik adı → quaternion), yawFix }
const UPPER = /^(Spine\d?|Neck|Head|(Left|Right)(Shoulder|Arm|ForeArm|Hand.*))$/;
const AIM_AT = 0.12;             // klipte nişanın oturduğu an (süre oranı)

/** Açıyı (-π, π] aralığına getirir. */
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/** Kemiği, çocuğunun yönü hedef DÜNYA yönüne bakacak şekilde döndürür. */
function aimBoneWorld(bone, child, targetWorldDir, weight = 1) {
  if (!bone || !child) return;

  bone.updateWorldMatrix(true, false);
  child.updateWorldMatrix(true, false);

  const from = _v.setFromMatrixPosition(child.matrixWorld)
    .sub(_v2.setFromMatrixPosition(bone.matrixWorld));
  if (from.lengthSq() < 1e-8) return;
  from.normalize();

  const to = targetWorldDir.clone().normalize();
  const delta = _q.setFromUnitVectors(from, to);
  if (weight < 1) delta.slerp(_q2.identity(), 1 - weight);

  const parentWorld = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const boneWorld = bone.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentWorld.invert().multiply(delta).multiply(boneWorld));
  bone.updateMatrixWorld(true);
}

/** Kemiğin çocuğunu, askerin kendi ekseninde verilen yöne çevirir. */
function aimBone(bone, child, targetLocalDir, rootQuat, weight = 1) {
  if (!bone || !child) return;

  bone.updateWorldMatrix(true, false);
  child.updateWorldMatrix(true, false);

  const from = _v.setFromMatrixPosition(child.matrixWorld)
    .sub(_v2.setFromMatrixPosition(bone.matrixWorld));
  if (from.lengthSq() < 1e-8) return;
  from.normalize();

  // Hedef yön askerin kendi ekseninde verilir; dünyaya çevir
  const to = targetLocalDir.clone().applyQuaternion(rootQuat).normalize();

  const delta = _q.setFromUnitVectors(from, to);
  if (weight < 1) delta.slerp(_q2.identity(), 1 - weight);

  // Dünya dönüşünü kemiğin yerel uzayına taşı
  const parentWorld = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const boneWorld = bone.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentWorld.invert().multiply(delta).multiply(boneWorld));
  bone.updateMatrixWorld(true);
}

/* İki kemikli IK: omuz→dirsek→el zincirini hedefe uzatır.
   Kemiği doğrudan hedefe çevirmek dirseği imkânsız açılara sokuyor ve eller
   gövdeden kopmuş gibi görünüyordu. Burada dirsek açısı kosinüs teoremiyle
   hesaplanır, hedef erişim dışındaysa kol tam açılır (kopma olmaz).        */
function solveTwoBone(root, mid, tip, targetWorld, poleDir) {
  if (!root || !mid || !tip) return;

  root.updateWorldMatrix(true, false);
  mid.updateWorldMatrix(true, false);
  tip.updateWorldMatrix(true, false);

  const a = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
  const b = new THREE.Vector3().setFromMatrixPosition(mid.matrixWorld);
  const c = new THREE.Vector3().setFromMatrixPosition(tip.matrixWorld);

  const l1 = a.distanceTo(b);
  const l2 = b.distanceTo(c);
  if (l1 < 1e-5 || l2 < 1e-5) return;

  const toTarget = targetWorld.clone().sub(a);
  const reach = Math.min(toTarget.length(), (l1 + l2) * 0.985);
  if (reach < 1e-5) return;
  const dir = toTarget.normalize();

  // Dirsek açısı (kosinüs teoremi)
  const cosA = THREE.MathUtils.clamp(
    (l1 * l1 + reach * reach - l2 * l2) / (2 * l1 * reach), -1, 1,
  );
  const angle = Math.acos(cosA);

  // Dirseğin hangi yöne bakacağı (kutup vektörü)
  const axis = new THREE.Vector3().crossVectors(dir, poleDir).normalize();
  if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);

  const upperDir = dir.clone().applyAxisAngle(axis, -angle);
  aimBoneWorld(root, mid, upperDir);

  mid.updateWorldMatrix(true, false);
  const elbow = new THREE.Vector3().setFromMatrixPosition(mid.matrixWorld);
  aimBoneWorld(mid, tip, targetWorld.clone().sub(elbow));
}

export class SoldierFactory {
  constructor() {
    this.template = null;
    this.materials = null;
  }

  /**
   * @param maxAnisotropy  dokular için en yüksek anizotropik filtreleme
   *                       (renderer.capabilities.getMaxAnisotropy())
   */
  async load(url = 'assets/characters/swat.glb', onProgress, maxAnisotropy = 8) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;

    root.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;

      // Kırpma (frustum culling) açık kalsın: yüksek poligonlu asker ekran
      // dışındayken hiç çizilmesin. Deri deformasyonu sınırları kaydırdığı
      // için elle geniş bir küre veriyoruz.
      o.frustumCulled = true;
      if (o.geometry) {
        o.geometry.computeBoundingSphere();
        o.geometry.boundingSphere.center.set(0, 0.9, 0);
        o.geometry.boundingSphere.radius = 1.6;
      }

      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        m.side = THREE.FrontSide;
        // Eğik açılardan bakıldığında doku bulanıklaşmasın
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
          if (m[key]) {
            m[key].anisotropy = maxAnisotropy;
            m[key].needsUpdate = true;
          }
        }
      }
    });

    // Modelde animasyon klibi varsa sakla (Mixamo'dan inen yürüme/koşma/
    // ölüm klipleri GLB'ye animasyon olarak giriyor). Şu an yordamsal
    // animasyon kullanılıyor; klipler hazır olduğunda devreye alınacak.
    this.clips = gltf.animations ?? [];
    if (this.clips.length) {
      console.info('Asker klipleri:', this.clips.map((c) => `${c.name} (${c.duration.toFixed(1)}s)`).join(', '));
    }

    // Modelin boyunu ölç: oyun ölçeğine (1.8 m) getirmek için
    const box = new THREE.Box3().setFromObject(root);
    this.height = box.max.y - box.min.y;
    this.template = root;
    onProgress?.(1, 'asker');
    return this;
  }

  /** Yeni bir asker gövdesi üretir (iskelet klonlanır, geometri paylaşılır). */
  create(scale = 1) {
    // Deri bağlamalı model: SkeletonUtils kemik referanslarını da kopyalar,
    // düz clone() tüm kopyaları aynı iskelete bağlar.
    // Model kendi ekseninde +Z'ye bakıyor; oyunun tamamı -Z'yi ileri
    // sayıyor (silah mesnedi, nişan, yürüyüş yönü). Gövdeyi bir sarmalayıcı
    // içinde 180° çevirip bu farkı tek yerde kapatıyoruz.
    const body = cloneSkinned(this.template);
    body.rotation.y = Math.PI;

    const root = new THREE.Group();
    root.add(body);
    root.scale.setScalar((1.8 / (this.height || 1.8)) * scale);

    const bones = {};
    body.traverse((o) => {
      if ((o.isBone || o.isObject3D) && BONES.includes(o.name)) bones[o.name] = o;
    });

    // Mixamo rig'lerinin bir kısmında Spine2 yok (Spine1 doğrudan Neck'e
    // bağlanıyor). O zincirin kopmaması için Spine2 yerine Neck kullanılır.
    if (!bones.Spine2 && bones.Neck) bones.Spine2 = bones.Neck;

    const rest = new Map();
    for (const name of Object.keys(bones)) rest.set(name, bones[name].quaternion.clone());

    // Dinlenme duruşundaki kemik yönleri (askerin kendi ekseninde).
    // Animasyon bunların ÜZERİNE açı ekler; böylece modelin doğal duruşu
    // (hafif açık bacaklar, omuz hattı) korunur.
    root.updateWorldMatrix(true, true);
    const rootInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const restDir = new Map();
    const pairs = [
      ['Hips', 'Spine'], ['Spine', 'Spine1'], ['Spine1', 'Spine2'], ['Spine2', 'Neck'],
      ['Neck', 'Head'],
      ['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'],
      ['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'],
      ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'],
      ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot'],
    ];
    for (const [a, b] of pairs) {
      const bone = bones[a], child = bones[b];
      if (!bone || !child) continue;
      const d = new THREE.Vector3()
        .setFromMatrixPosition(child.matrixWorld)
        .sub(new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld))
        .normalize()
        .applyQuaternion(rootInv);
      restDir.set(a, d);
    }

    return { root, body, bones, rest, restDir, clips: this.clips ?? [] };
  }
}

/* ─────────────────────────────── Asker ─────────────────────────────── */

export class Soldier {
  /**
   * @param rig    SoldierFactory.create() çıktısı
   * @param opts   { team: 'enemy'|'ally', rifle: THREE.Object3D|null }
   */
  constructor(rig, { team = 'enemy', rifle = null, tint = null } = {}) {
    this.rig = rig;
    this.root = rig.root;          // konum ve yön buradan sürülür
    this.body = rig.body ?? rig.root;   // modelin kendi ekseni (-Z ileri)
    this.bones = rig.bones;
    this.team = team;

    this.phase = Math.random() * Math.PI * 2;
    this.state = 'idle';
    this.aimPitch = 0;
    this.recoil = 0;
    this.crouchBlend = 0;
    this.moveBlend = 0;
    this.death = 0;           // 0 = ayakta, 1 = tamamen yerde
    this.deathSide = Math.random() < 0.5 ? 1 : -1;

    // ── Animasyon klipleri ────────────────────────────────────────────
    // Model Mixamo kliplerini taşıyorsa gerçek mocap oynatılır; yoksa
    // aşağıdaki yordamsal poz devreye girer (eski modeller için).
    this.actions = {};
    this.mixer = null;
    const clips = rig.clips ?? [];
    if (clips.length) {
      this.mixer = new THREE.AnimationMixer(this.body);
      for (const c of clips) {
        const a = this.mixer.clipAction(c);
        a.enabled = true;
        this.actions[c.name] = a;
      }
      for (const tek of ['death', 'fire', 'reload']) {
        const a = this.actions[tek];
        if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      }
      this._crouchDurus = this._plantedTime(this.actions.crouch);
      this._aimBones = this._sampleAimPose(this.actions.fire);
      this.aimW = 0;
      this.clipName = null;
      this._setClip('idle', 0);
      // Her asker döngünün farklı yerinden başlasın
      const idle = this.actions.idle;
      if (idle) idle.time = Math.random() * (idle.getClip()?.duration ?? 0);
    }

    if (tint) this._tint(tint);
    if (rifle) this._holdRifle(rifle);
    this._buildHitBoxes();
  }

  /* Klip durum makinesi. Mixamo klipleri tüm gövdeyi sürdüğü için
     yordamsal poz devre dışı; üstüne yalnızca nişan açısı ve geri tepme
     bindiriliyor.                                                      */
  _updateClips(ctx, dt) {
    const dying = !!ctx.dying;
    if (dying) this.death = Math.min(1, this.death + dt / 1.6);
    this.aimPitch += ((ctx.aimPitch ?? 0) - this.aimPitch) * Math.min(1, dt * 9);
    this.recoil *= Math.pow(0.002, dt);

    // Çömelme yalnızca DURURKEN: hareket eden asker ayağa kalkıp yürür.
    // Elimizdeki "crouch" klibi aslında çömelerek yürüme (Mixamo "Walk
    // Crouching Forward Right"); oynatılırsa yerinde duran asker adım atıyor.
    const cokmus = ctx.downed || (ctx.crouching && ctx.speed <= 0.4);
    let ad = 'idle';
    if (dying) ad = 'death';
    else if (cokmus) ad = 'crouch';
    else if (ctx.speed > 5) ad = 'run';
    else if (ctx.speed > 0.4) ad = 'walk';
    this._setClip(ad, this.clipName === null ? 0 : (ad === 'death' ? 0.1 : 0.22));

    // Yürüyüş/koşu hızı gerçek hıza uysun: ayaklar kaymasın
    const walk = this.actions.walk, run = this.actions.run;
    if (ad === 'walk' && walk) walk.setEffectiveTimeScale(Math.max(0.6, ctx.speed / 1.6));
    if (ad === 'run' && run) run.setEffectiveTimeScale(Math.max(0.8, ctx.speed / 6.2));
    // Çömelme: klip iki ayağın da yere bastığı karede dondurulur
    const crouch = this.actions.crouch;
    if (ad === 'crouch' && crouch) {
      crouch.paused = true;
      crouch.time = this._crouchDurus.t;
    }

    this.mixer.update(dt);

    // Çömelme klibinin çapraz gövdesini geri çevir: çömelme ağırlığıyla
    // orantılı (geçişte yumuşak), böylece bel dönmeden çömelir
    if (crouch && this._crouchDurus.yaw) {
      const w = crouch.enabled ? crouch.getEffectiveWeight() : 0;
      this.body.rotation.y = Math.PI + this._crouchDurus.yaw * w;
    }

    // Nişan katmanı: ateş eden / hedef gözeten askerde tüfek omza kalkar.
    // Hedef bir an kaybolup gelince (siperden doğrulma, hedef değişimi)
    // tüfek kalkıp inip titremesin: nişan son görüşten 1.2 sn sonra biter.
    if (ctx.aiming) this._aimHold = 1.2;
    else this._aimHold = Math.max(0, (this._aimHold ?? 0) - dt);
    const nisan = this._aimHold > 0 && !dying && !ctx.downed ? 1 : 0;
    this.aimW += (nisan - this.aimW) * Math.min(1, dt * 5);
    if (this._aimBones && this.aimW > 0.01) {
      for (const [bone, q] of this._aimBones) bone.quaternion.slerp(q, this.aimW);
      // Yan duruşu düzelt: tüfek yönü (sağ el → sol el) HER KAREDE ölçülür,
      // omurga o kadar geri döndürülür. Tek seferlik ölçüm yalnızca bekleme
      // klibinde doğruydu; çömelirken/yürürken kalça farklı açıda olduğu
      // için üst gövde dönüyor, kötü görünüyordu. (Mikser kemikleri her
      // kare baştan yazdığı için düzeltme birikmez.)
      const spine = this.bones.Spine, L = this.bones.LeftHand, R = this.bones.RightHand;
      if (spine && L && R) {
        this.body.updateMatrixWorld(true);
        const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
        const tersQ = rootQ.clone().invert();
        const d = new THREE.Vector3().setFromMatrixPosition(L.matrixWorld)
          .sub(new THREE.Vector3().setFromMatrixPosition(R.matrixWorld)).applyQuaternion(tersQ);
        const hata = Math.atan2(-d.x, -d.z);             // 0 = tam ileri
        const parentQ = spine.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
        const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(rootQ).applyQuaternion(parentQ).normalize();
        spine.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, -hata * this.aimW));
      }
    }
    if (!dying) {
      this._fitRifleToHand(dt);
    } else if (!this._dropped && this.death > 0.5 && this.rifle) {
      // Silah YERE DÜŞER. Elde bırakmak namluyu zemine sokuyordu; gövdeye
      // bağlamak ise havada asılı bırakıyordu (gövde grubu klip ile
      // hareket etmiyor). Çözüm: silahı KÖKE alıp zemine yatırmak.
      this._dropped = true;
      const r = this.rifle;
      const dunyaPos = new THREE.Vector3().setFromMatrixPosition(r.matrixWorld);
      this.root.attach(r);
      const s2 = 1 / (this.root.scale.x || 1);
      r.position.set(
        (dunyaPos.x - this.root.position.x) * s2,
        0.06 * s2,
        (dunyaPos.z - this.root.position.z) * s2,
      );
      r.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1));
    }

    // Nişan açısı: klibin üstüne omurga/boyun eğimi eklenir
    if (!dying) {
      const b = this.bones;
      const egim = THREE.MathUtils.clamp(this.aimPitch, -0.7, 0.7);
      const bind = (bone, pay) => {
        if (!bone) return;
        bone.rotateX(-egim * pay);
      };
      // Nişan açısı ağırlıklı olarak GÖVDEDEN verilir. Boyna büyük pay
      // vermek askerin kafasını sağa sola eğiyor gibi gösteriyordu.
      bind(b.Spine1, 0.42);
      bind(b.Spine2 !== b.Neck ? b.Spine2 : null, 0.32);
      bind(b.Neck, 0.1);
      this.body.updateMatrixWorld(true);
    }
  }

  /* Klipte iki ayağın da en alçakta olduğu anı bulur (yürüme klibini
     duruş pozu olarak kullanmak için). Klip başına bir kez ölçülür;
     aynı klibi paylaşan bütün askerler sonucu ortak kullanır. */
  _plantedTime(action) {
    if (!action) return { t: 0, yaw: 0 };
    const clip = action.getClip();
    if (PLANTED.has(clip)) return PLANTED.get(clip);
    const L = this.bones.LeftFoot, R = this.bones.RightFoot;
    if (!L || !R) return { t: 0, yaw: 0 };
    const p = new THREE.Vector3();
    let enIyi = 0, enDusuk = Infinity;
    action.play();
    for (let i = 0; i < 40; i++) {
      const t = (clip.duration * i) / 40;
      action.time = t;
      this.mixer.update(0);
      this.body.updateMatrixWorld(true);
      const yL = this.body.worldToLocal(p.setFromMatrixPosition(L.matrixWorld)).y;
      const yR = this.body.worldToLocal(p.setFromMatrixPosition(R.matrixWorld)).y;
      const yuksek = Math.max(yL, yR);   // havadaki ayak ne kadar yukarıda
      if (yuksek < enDusuk) { enDusuk = yuksek; enIyi = t; }
    }
    action.stop();

    // Gövde sapması: bu klip yürüme klibi olduğu için ("sağa doğru")
    // bütün gövde ~45° çapraz duruyor; asker çömelince beli dönüyor, tüfek
    // hedefe bakmıyordu. Kalça çizgisinin açısı bekleme klibine göre ölçülür.
    const yaw = this.actions.idle
      ? wrapAngle(this._hipAngle(action, enIyi) - this._hipAngle(this.actions.idle, 0))
      : 0;
    PLANTED.set(clip, { t: enIyi, yaw });
    return PLANTED.get(clip);
  }

  /**
   * Nişan pozu: ateş klibinin AIM_AT anındaki üst gövde dönüşleri.
   * Bekleme/yürüme/koşma kliplerinde tüfek göğüste, aşağıda duruyor; asker
   * ateş ederken de öyle kalıyor, öne değil çapraza ateş ediyor gibi
   * görünüyordu. Ateş eden/hedef gözeten askerin üst gövdesi bu poza
   * geçer (bacaklar yürüme/koşma klibinde kalır).
   * @returns [[kemik, quaternion], …] ya da null
   */
  _sampleAimPose(action) {
    if (!action) return null;
    const clip = action.getClip();
    if (!AIMPOSE.has(clip)) {
      for (const a of Object.values(this.actions)) if (a !== action) a.stop();
      action.reset();
      action.play();
      action.time = clip.duration * AIM_AT;
      this.mixer.update(0);
      const pose = new Map();
      this.body.traverse((o) => { if (o.isBone && UPPER.test(o.name)) pose.set(o.name, o.quaternion.clone()); });
      action.stop();

      // Ateş klibi yan duruşlu (gövde ~60° çapraz): bekleme klibinin
      // kalçası üstüne bu üst gövde konunca tüfek sola bakıyordu. Tüfek
      // yönü (sağ el → sol el) ölçülür, omurga o kadar geri döndürülür.
      let yawFix = 0;
      const idle = this.actions.idle;
      const L = this.bones.LeftHand, R = this.bones.RightHand;
      if (idle && L && R) {
        idle.reset();
        idle.play();
        idle.time = 0;
        this.mixer.update(0);
        for (const [name, q] of pose) this.body.getObjectByName(name)?.quaternion.copy(q);
        this.root.updateMatrixWorld(true);
        const l = this.root.worldToLocal(new THREE.Vector3().setFromMatrixPosition(L.matrixWorld));
        const r = this.root.worldToLocal(new THREE.Vector3().setFromMatrixPosition(R.matrixWorld));
        const d = l.sub(r);
        yawFix = Math.atan2(-d.x, -d.z);         // 0 = tam ileri (−Z)
        idle.stop();
      }
      AIMPOSE.set(clip, { pose, yawFix });
    }
    const { pose, yawFix } = AIMPOSE.get(clip);
    this._aimYawFix = yawFix;
    const out = [];
    for (const [name, q] of pose) {
      const bone = this.body.getObjectByName(name);
      if (bone) out.push([bone, q]);
    }
    return out.length ? out : null;
  }

  /** Klip yalnız oynarken, t anında kalça çizgisinin gövde düzlemindeki açısı. */
  _hipAngle(action, t) {
    const L = this.bones.LeftUpLeg, R = this.bones.RightUpLeg;
    if (!L || !R) return 0;
    for (const a of Object.values(this.actions)) if (a !== action) a.stop();
    action.reset();
    action.play();
    action.time = t;
    this.mixer.update(0);
    this.body.updateMatrixWorld(true);
    const l = this.body.worldToLocal(new THREE.Vector3().setFromMatrixPosition(L.matrixWorld));
    const r = this.body.worldToLocal(new THREE.Vector3().setFromMatrixPosition(R.matrixWorld));
    action.stop();
    return Math.atan2(r.z - l.z, r.x - l.x);
  }

  /** Klip geçişi: aynı klip tekrar istenirse dokunmaz. */
  _setClip(name, fade = 0.22) {
    const next = this.actions[name];
    if (!next || this.clipName === name) return;
    const prev = this.actions[this.clipName];
    next.reset();
    next.setEffectiveWeight(1);
    next.play();
    if (prev && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev) prev.stop();
    this.clipName = name;
  }

  /** Takım rengi: müttefikler mavi bantlı, düşmanlar kırmızı. */
  _tint(color) {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.075, 0.09, 10, 1, true),
      new THREE.MeshStandardMaterial({
        // Hafif ışıma: takım rengi seçilsin ama omuzda fener gibi parlamasın
        color, emissive: color, emissiveIntensity: 0.18, roughness: 0.6, side: THREE.DoubleSide,
      }),
    );
    band.position.set(0, -0.02, 0);
    band.rotation.z = Math.PI / 2;
    this.bones.LeftArm?.add(band);
    this.armBand = band;
  }

  /* Silah ELE değil, göğüs hizasındaki bir MESNEDE durur.
     Sebep: el kemiğinin kendi ekseni modelden modele değişiyor ve silah
     yamuk duruyordu. Mesnet askerin gövdesine bağlı, nişan açısıyla
     yükselip alçalıyor; eller sonradan silaha uzatılıyor (aşağıda). */
  _holdRifle(rifle) {
    const s = 1 / (this.root.scale.x || 1);

    // Klipli modelde eller zaten tüfek tutar pozda: silah göğüs mesnedine
    // değil doğrudan SAĞ ELE bağlanır, kol IK'sı devre dışı kalır.
    if (this.mixer && this.bones.RightHand) {
      this._holdRifleInHand(rifle, s);
      return;
    }

    // Tüfek modelinin ORİJİNİ DİPÇİKTE (gövde z: +0.02 … -0.85). Mesnet de
    // bu yüzden omuz hizasında, gövdenin biraz GERİSİNDE durur; namlu
    // otomatik olarak 70 cm öne uzanır. Nişan açısı bu noktadan döner —
    // tıpkı omza dayanmış gerçek bir tüfek gibi.
    // SWAT rig'ine göre kalibre: omuzlar ±0.18, kol boyu 0.448 m. Silah
    // 10° çapraz duruyor — düz tutulduğunda kısa kol el kundağına
    // yetişmiyor, sol kol kilitlenip gergin kalıyordu.
    const mount = new THREE.Object3D();
    mount.position.set(0.09 * s, 1.35 * s, 0.14 * s);
    mount.rotation.y = HOLD_YAW;
    this.root.add(mount);
    this.mount = mount;

    rifle.scale.multiplyScalar(s);
    rifle.position.set(0, 0, 0);
    rifle.rotation.set(0, 0, 0);          // model zaten -Z'ye bakıyor
    mount.add(rifle);

    this.rifle = rifle;
    this.muzzleLocal = rifle.userData.muzzle?.clone() ?? new THREE.Vector3(0, 0, -0.8);

    // Ellerin tutacağı noktalar (silahın yerel uzayında)
    // Eller silahın GERÇEK noktalarında: kabza dipçikten 25 cm, el kundağı
    // 50 cm ileride. Omuz→el mesafeleri sağ 0.24 m, sol 0.46 m — kol boyu
    // 0.52 m olduğundan iki dirsek de bükülü kalıyor, kol gerilmiyor.
    this.gripLocal = new THREE.Vector3(0, -0.10 * s, -0.25 * s);      // kabza (tetik eli)
    this.supportLocal = new THREE.Vector3(0, -0.08 * s, -0.42 * s);   // el kundağı (ön el)
  }

  /* Parmakları silahın gövdesi etrafında kıvırır.
     Parmak uçları namlu ekseni çevresinde döndürülür: ilk boğum silahın
     üstünü aşar, ikinci boğum öbür yana iner — kapanmış bir kavrama. */
  _grip(b, side, up, barrel) {
    const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
    const turn = (deg) => up.clone().applyAxisAngle(barrel, THREE.MathUtils.degToRad(deg)).normalize();
    const d1 = turn(side === 'Right' ? 28 : -28);
    const d2 = turn(side === 'Right' ? 98 : -98);
    for (const f of FINGERS) {
      aimBoneWorld(b[`${side}Hand${f}1`], b[`${side}Hand${f}2`], d1);
      aimBoneWorld(b[`${side}Hand${f}2`], b[`${side}Hand${f}3`], d2);
    }
    // Başparmak öbür yandan kapanır
    const t1 = turn(side === 'Right' ? -45 : 45);
    aimBoneWorld(b[`${side}HandThumb1`], b[`${side}HandThumb2`], t1);
    aimBoneWorld(b[`${side}HandThumb2`], b[`${side}HandThumb3`],
      t1.clone().addScaledVector(barrel, 0.6).normalize());
  }

  /* Silahı sağ ele bağlar. Elin kendi ekseni modelden modele değiştiği
     için açıyı elle vermiyoruz: silahın İSTENEN dünya duruşunu kuruyoruz
     (kabza avucun içinde, namlu askerin ileri yönünde) ve bunu elin yerel
     uzayına çeviriyoruz. Böylece her rig'de aynı sonuç çıkıyor.        */
  _holdRifleInHand(rifle, s) {
    const hand = this.bones.RightHand;
    this.root.updateWorldMatrix(true, true);
    hand.updateWorldMatrix(true, false);

    rifle.scale.setScalar(s);
    this.rifle = rifle;
    this.muzzleLocal = rifle.userData.muzzle?.clone() ?? new THREE.Vector3(0, 0, -0.8);
    // Kabza, silahın orijininden (dipçik) 25 cm ileride
    this.gripLocal = new THREE.Vector3(0, -0.055 * s, -0.25 * s);
    this.supportLocal = new THREE.Vector3(0, -0.04 * s, -0.42 * s);

    hand.add(rifle);
    this.mount = null;
    // Hizalama BAĞLAMA pozunda yapılamaz: klip eli döndürünce silah da
    // dönüyor ve namlu göğe bakıyordu. İlk kare oynadıktan sonra, elin
    // gerçek duruşuna göre hizalanır.
    this._fitRifle = true;
  }

  /**
   * Elindeki silahı değiştirir (omuz üstü görüşte oyuncunun seçtiği silah).
   * grip: kabzanın silah uzayındaki yeri (RIGS çapası) — silahın boyuna
   * göre değişiyor: tabancada 6 cm, tüfekte ~30 cm.
   */
  setRifle(rifle, grip = null) {
    if (this.rifle === rifle) return;
    if (this.rifle) this.rifle.parent?.remove(this.rifle);
    const s = 1 / (this.root.scale.x || 1);
    this._holdRifleInHand(rifle, s);
    if (grip) this.gripLocal = grip.clone().multiplyScalar(s);
    this._rifleDirL = null;
  }

  /* Silahı İKİ ELİN ARASINA hizalar. Yalnızca sağ ele bağlamak yetmiyordu:
     klip sol eli kendi ölçüsüne göre koyuyor, bizim tüfek başka boyda
     olduğu için sol el boşluğu kavrıyor görünüyordu. Burada kabza sağ
     avuca oturuyor, namlu ekseni sol ele doğru bakıyor — iki el de
     silahın üstünde kalıyor. Her karede yapılır (ucuz: iki matris okuma).  */
  _fitRifleToHand(dt = 0) {
    const rifle = this.rifle;
    const sag = this.bones.RightHand, sol = this.bones.LeftHand;
    if (!rifle || !sag) return;
    const s = 1 / (this.root.scale.x || 1);
    sag.updateWorldMatrix(true, false);
    const sagPos = _v.setFromMatrixPosition(sag.matrixWorld).clone();

    // Namlu yönü: sağ elden sol ele. Sol el yoksa gövde ileri yönü.
    const rootQ = this.root.getWorldQuaternion(_q2);
    const ileri = new THREE.Vector3(0, 0, -1).applyQuaternion(rootQ);
    let yon = ileri.clone();
    let guvenilir = !sol;
    if (sol) {
      sol.updateWorldMatrix(true, false);
      const solPos = _v2.setFromMatrixPosition(sol.matrixWorld);
      const fark = solPos.clone().sub(sagPos);
      // Eller birbirine çok yaklaşınca (bekleme klibinde tutuş değişirken)
      // iki el arası yön güvenilmez: 20–60° savruluyordu — önceki yön kalır
      if (fark.lengthSq() > 0.04) { yon = fark.normalize(); guvenilir = true; }
    }
    // Namlu ileriye bakmalı: eller AÇIKÇA terse dönükse yönü çevir. Eşik 0
    // iken göğüste çapraz tutulan tüfek (ileriyle ~dik) kare kare 180°
    // dönüp duruyordu — askerlerin silahı titriyordu.
    if (yon.dot(ileri) < -0.35) yon.negate();

    // Yön yumuşatma GÖVDEYE GÖRE yapılır (asker dönerken tüfek geride
    // kalmasın); klibin el titreşimi namluyu sallamasın
    const tersQ = rootQ.clone().invert();
    const yerel = yon.clone().applyQuaternion(tersQ);
    if (!this._rifleDirL) this._rifleDirL = yerel.clone();
    else if (guvenilir && dt > 0) {
      // Yumuşatma + açısal hız sınırı (~140°/sn): bekleme klibi tüfeği bir
      // anda büyük açıyla oynatıyor, kare başına 20°'yi aşan sıçrama oluyordu
      const aci = this._rifleDirL.angleTo(yerel);
      const k = Math.min(Math.min(1, dt * 9), aci > 1e-4 ? (dt * 2.5) / aci : 1);
      this._rifleDirL.lerp(yerel, k).normalize();
    } else if (guvenilir) this._rifleDirL.copy(yerel);
    yon = this._rifleDirL.clone().applyQuaternion(rootQ);

    const yukari = new THREE.Vector3(0, 1, 0).applyQuaternion(rootQ);
    const bakis = new THREE.Matrix4().lookAt(
      sagPos, sagPos.clone().add(yon), yukari,
    );                                   // -Z ekseni `yon`a bakar
    const hedefQ = new THREE.Quaternion().setFromRotationMatrix(bakis);

    const gripOfs = this.gripLocal.clone().multiplyScalar(this.root.scale.x).applyQuaternion(hedefQ);
    const pos = sagPos.clone().sub(gripOfs);
    const olcek = new THREE.Vector3(1, 1, 1).multiplyScalar(s * this.root.scale.x);

    const istenen = new THREE.Matrix4().compose(pos, hedefQ, olcek);
    istenen.premultiply(new THREE.Matrix4().copy(sag.matrixWorld).invert());
    istenen.decompose(rifle.position, rifle.quaternion, rifle.scale);
  }

  /** Vuruş kutuları kemiklere bağlanır: deri deformasyonunu takip ederler. */
  _buildHitBoxes() {
    const invisible = new THREE.MeshBasicMaterial({ visible: false });
    const add = (boneName, size, offset, part) => {
      const bone = this.bones[boneName];
      if (!bone) return null;
      // Ölçek KEMİĞİN kendi dünya ölçeğinden alınır, kökünkinden değil:
      // 0.01 ölçekli armatürden gelen rig'lerde (FSB) kemik düğümleri de
      // 0.01 ölçekli oluyor, kutular 100 kat küçülüp mermi hiç isabet
      // etmiyordu — düşmanlar hasar almıyor görünüyordu.
      bone.updateWorldMatrix(true, false);
      const bs = _v.setFromMatrixScale(bone.matrixWorld);
      const k = (bs.x + bs.y + bs.z) / 3 || 1;
      const s = 1 / k;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0] * s, size[1] * s, size[2] * s), invisible);
      mesh.position.set(offset[0] * s, offset[1] * s, offset[2] * s);
      mesh.userData = { soldier: this, part };
      bone.add(mesh);
      return mesh;
    };

    this.hitMeshes = [
      add('Head', [0.26, 0.3, 0.28], [0, 0.1, 0], 'head'),
      add('Spine1', [0.46, 0.46, 0.32], [0, 0.12, 0], 'body'),
      add('Hips', [0.4, 0.3, 0.3], [0, 0.08, 0], 'body'),
      add('LeftUpLeg', [0.2, 0.45, 0.22], [0, -0.2, 0], 'leg'),
      add('RightUpLeg', [0.2, 0.45, 0.22], [0, -0.2, 0], 'leg'),
      add('LeftLeg', [0.18, 0.42, 0.2], [0, -0.2, 0], 'leg'),
      add('RightLeg', [0.18, 0.42, 0.2], [0, -0.2, 0], 'leg'),
    ].filter(Boolean);
  }

  get muzzleWorld() {
    if (!this.rifle) return this.root.position.clone().setY(1.4);
    return this.rifle.localToWorld(this.muzzleLocal.clone());
  }

  /** Gölge dökme mesafesi: yakındakiler döker, uzaktakiler dökmez. */
  setShadowDistance(distance, limit = 22) {
    const on = distance < limit;
    if (this._shadowOn === on) return;
    this._shadowOn = on;
    this.root.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.castShadow = on; });
  }

  /** Ateş anı: geri tepme katmanını tetikler. */
  kick() {
    this.recoil = 1;
  }

  /**
   * @param ctx { dt, speed, crouching, downed, aimPitch }
   */
  update(ctx) {
    const { dt } = ctx;
    const b = this.bones;
    const rootQ = this.root.getWorldQuaternion(_bodyQ);

    // ── Durum karışımları ──────────────────────────────────────────────
    const moving = ctx.speed > 0.4;
    const running = ctx.speed > 5;

    // ── Klipli yol: gerçek mocap varsa yordamsal pozu hiç çalıştırma ──
    if (this.mixer) {
      this._updateClips(ctx, dt);
      return;
    }

    const targetMove = moving ? Math.min(1, ctx.speed / 3.4) : 0;
    this.moveBlend += (targetMove - this.moveBlend) * Math.min(1, dt * 8);
    this.crouchBlend += ((ctx.crouching || ctx.downed ? 1 : 0) - this.crouchBlend) * Math.min(1, dt * 7);
    this.aimPitch += ((ctx.aimPitch ?? 0) - this.aimPitch) * Math.min(1, dt * 9);
    this.recoil *= Math.pow(0.002, dt);

    // Ölüm: heykel gibi devrilmek yerine dizler bükülerek yere yığılma.
    // İlk yarıda çöker (diz kırılır), ikinci yarıda yana devrilir.
    if (ctx.dying) {
      this.death = Math.min(1, this.death + dt / 1.1);
      // Silahı elden bırak: mesnet gövdeye değil köke bağlı olduğu için
      // asker düşünce silah havada asılı kalıyordu.
      if (!this._dropped && this.death > 0.35 && this.rifle) {
        this._dropped = true;
        this.body.attach(this.rifle);          // dünya konumu korunarak taşı
        this.rifle.rotation.z += (Math.random() - 0.5) * 1.2;
      }
    }
    const death = this.death;
    const collapse = Math.min(1, death * 2);          // 0–0.5: çökme
    const topple = Math.max(0, death * 2 - 1);        // 0.5–1: devrilme

    // Adım döngüsü: kadans doğrudan hızdan gelir (yürürken ~2 adım/sn,
    // koşarken ~3.5), genlik de hızla büyür. Küçük genlikte asker kayıyor
    // gibi görünüyordu.
    const cadence = 2.6 + ctx.speed * 1.25;
    this.phase += dt * cadence;
    // Genlik insan ölçüsünde: yürürken uyluk ~24°, koşarken ~36° savrulur.
    // Daha büyük değerler askeri "hamle yapıyor" gibi açtırıyordu.
    const amp = (running ? 0.62 : 0.42) * this.moveBlend * (1 - this.crouchBlend * 0.6);
    // Gerçek yürüyüşte bacak öne geriden daha çok savrulur
    const raw = Math.sin(this.phase);
    const swing = (raw > 0 ? raw : raw * 0.65) * amp;
    const lift = Math.max(0, Math.cos(this.phase));

    const crouch = this.crouchBlend;
    const down = ctx.downed ? 1 : 0;

    // ── Bacaklar ───────────────────────────────────────────────────────
    // Hedef yön, DİNLENME yönünün üzerine açı eklenerek bulunur: modelin
    // doğal duruşu (hafif açık bacaklar) bozulmaz.
    const rest = this.rig.restDir;
    const X = new THREE.Vector3(1, 0, 0);
    const turn = (name, angle, fallback) => {
      const base = rest?.get(name)?.clone() ?? fallback.clone();
      return base.applyAxisAngle(X, angle).normalize();
    };

    /* Bacaklar için dinlenme yönünü KULLANMIYORUZ: model A-pozunda bacakları
       açık duruyor, o yönü koruyarak salınım yapınca yürüyüş parantez ")(" 
       gibi görünüyordu. Burada yön sıfırdan kuruluyor: neredeyse dik aşağı,
       kalça genişliği kadar hafif dışa, salınım yalnızca ileri-geri. */
    const legDir = (side, angle, spread) =>
      new THREE.Vector3(side * spread, -1, 0).normalize().applyAxisAngle(X, angle).normalize();

    // ── Çömelme: tek diz yere, diğer ayak önde düz ────────────────────
    // Her iki bacağı birden bükmek "çömelmiş" değil "eğilmiş" gösteriyordu.
    // Burada sağ diz yere iner (uyluk aşağı-geri, baldır geriye yatar),
    // sol ayak önde kalır (uyluk öne, baldır dik).
    const DOWN = new THREE.Vector3(0, -1, 0);
    const kneelDrop = crouch * 0.46;
    // Gövde yüksekliği: çömelmede iner, yürürken adım ritminde hafifçe zıplar
    const bob = Math.abs(Math.sin(this.phase)) * 0.045 * this.moveBlend;
    if (this.body) {
      const scale = this.root.scale.x || 1;
      // Yere gömülmeyi aşağıdaki "yere otur" düzeltmesi hallediyor; burada
      // yalnızca dizlerin çökmesi var.
      const deathDrop = collapse * 0.2;
      this.body.position.y = (-kneelDrop + bob - deathDrop) / scale;

      // Devrilme: ayak hizasından yana yatar
      this.body.rotation.z = topple * this.deathSide * (Math.PI / 2) * 0.92;
      this.body.rotation.x = -collapse * 0.35 + topple * 0.25;
    }

    // Ayakta: yürüyüş salınımı · Çömelmiş: sabit diz çökme açıları
    const standL = legDir(1, -swing, 0.07);     // sol uyluk
    const standR = legDir(-1, swing, 0.07);     // sağ uyluk
    /* Yarım diz çökme (askerî nişan duruşu):
         ARKA bacak (sol) — diz ve baldır yerde, ayak ucu kıvrık, taban
                            geriye-aşağı bakar
         ÖN bacak (sağ)   — yalnızca ayak tabanı yerde, baldır dik,
                            diz 90°, uyluk neredeyse yatay
       Açı yerine doğrudan yön vektörü veriyoruz: açı tabanlı legDir ile
       ön ayak diz hizasında havada kalıyordu.                          */
    // Oranlar ölçümle kuruldu: ön uyluk YATAY + ön baldır DİK = 90° diz,
    // bu da kalçayı diz hizasına (~0.45 m) indirir; arka uyluk oradan
    // 45° aşağı-geri inerek dizi yere koyar.
    const kneelL = new THREE.Vector3(0.07, -0.92, 0.39).normalize();   // arka uyluk: dik-geri (diz yere insin)
    const kneelR = new THREE.Vector3(-0.08, -0.10, -0.99).normalize(); // ön uyluk: neredeyse yatay

    // Ölürken bacaklar toplanır (cenin benzeri gevşek duruş)
    const slackThighL = legDir(1, -0.55, 0.12);
    const slackThighR = legDir(-1, -0.4, 0.12);
    aimBone(b.LeftUpLeg, b.LeftLeg,
      standL.lerp(kneelL, crouch).lerp(slackThighL, collapse).normalize(), rootQ);
    aimBone(b.RightUpLeg, b.RightLeg,
      standR.lerp(kneelR, crouch).lerp(slackThighR, collapse).normalize(), rootQ);

    // Diz yalnızca bacak ileri taşınırken bükülür, basarken düz kalır.
    // (Sürekli bükülü diz "bükük odun" görüntüsü veriyordu.)
    const stepL = Math.max(0, Math.sin(this.phase + Math.PI / 2));
    const stepR = Math.max(0, Math.sin(this.phase - Math.PI / 2));
    const walkKneeL = stepL * 0.95 * this.moveBlend;
    const walkKneeR = stepR * 0.95 * this.moveBlend;
    // Baldırlar da dik aşağı referansından türetilir (diz içe/dışa kaçmasın)
    // Çömelmede baldırlar: arka baldır geriye yatık (bilek dizden biraz
    // yüksek — ayak ucu kıvrık duracak), ön baldır dik (diz 90°).
    // Arka baldır geriye giderken hafif YUKARI çıkar (bilek dizden ~13 cm
    // yüksekte): ayak ucu kıvrık dururken diz yerde kalsın diye.
    const kneelShinL = new THREE.Vector3(0.04, 0.39, 0.92).normalize();
    const kneelShinR = new THREE.Vector3(0.0, -1.0, 0.04).normalize();
    const shinL = legDir(1, walkKneeL, 0.03).lerp(kneelShinL, crouch);
    const shinR = legDir(-1, walkKneeR, 0.03).lerp(kneelShinR, crouch);

    const slackShin = legDir(1, 1.1, 0.05);
    aimBone(b.LeftLeg, b.LeftFoot, shinL.lerp(slackShin, collapse).normalize(), rootQ);
    aimBone(b.RightLeg, b.RightFoot, shinR.lerp(slackShin, collapse).normalize(), rootQ);

    // ── Ayaklar yere paralel kalsın ────────────────────────────────────
    // Baldır döndükçe ayak da dönüyordu; burnu ileri-aşağı sabitliyoruz.
    const footDir = (step) => new THREE.Vector3(0, -0.22 - step * 0.35, -1).normalize();
    // Çömelmede: arka ayağın ucu AŞAĞI bakar (parmak ucu yere basar, taban
    // geriye-aşağı döner), ön ayak düz tabana oturur.
    // Arka ayak: uç aşağı-geri (taban geriye-aşağı bakar, parmak ucu yerde)
    const kneelFootL = new THREE.Vector3(0, -0.80, 0.60).normalize();
    const kneelFootR = new THREE.Vector3(0, -0.16, -0.99).normalize();
    aimBone(b.LeftFoot, b.LeftToeBase,
      footDir(stepL * this.moveBlend).lerp(kneelFootL, crouch).normalize(),
      rootQ, 1 - collapse * 0.7);
    aimBone(b.RightFoot, b.RightToeBase,
      footDir(stepR * this.moveBlend).lerp(kneelFootR, crouch).normalize(),
      rootQ, 1 - collapse * 0.7);

    // ── Ayaklar yere bassın ────────────────────────────────────────────
    // Çömelme yüksekliği sabit bir sayı olamaz: her rig'in uyluk/baldır
    // oranı farklı. Bacak pozu çözüldükten sonra alçak ayağı ölçüp gövdeyi
    // ona göre kaydırıyoruz. (SWAT rig'inde sabit değer gövdeyi 46 cm yere
    // gömüyordu.) Gövdeyi Δ kadar kaydırmak ayakları da Δ kadar taşıdığı
    // için tek düzeltme yeter.
    if (this.body && (crouch > 0.01 || death > 0.01)) {
      const scale = this.root.scale.x || 1;
      // Yere değen nokta duruma göre değişiyor: ayakta tabanlar, diz
      // çökerken diz, devrilince omuz/kalça. Hepsini ölçüp en alçağını
      // zemine oturtuyoruz — her rig'de ve her pozda çalışır.
      const TABAN = 0.09 * scale;      // bilek kemiği → tabanın altı
      const DIZ = 0.07 * scale;        // diz kemiği → dizliğin dışı
      const GOVDE = 0.13 * scale;      // omurga kemiği → sırtın dışı
      let enAlcak = Infinity;
      const bak = (bone, pay) => {
        if (!bone) return;
        bone.updateWorldMatrix(true, false);
        enAlcak = Math.min(enAlcak, _v.setFromMatrixPosition(bone.matrixWorld).y - pay);
      };
      bak(b.LeftFoot, TABAN); bak(b.RightFoot, TABAN);
      bak(b.LeftToeBase, 0.04 * scale); bak(b.RightToeBase, 0.04 * scale);
      bak(b.LeftLeg, DIZ); bak(b.RightLeg, DIZ);
      if (death > 0.01) {
        bak(b.Hips, GOVDE); bak(b.Spine1, GOVDE); bak(b.Head, 0.11 * scale);
        bak(b.LeftArm, 0.08 * scale); bak(b.RightArm, 0.08 * scale);
      }
      if (enAlcak < Infinity) {
        const rootY = _v2.setFromMatrixPosition(this.root.matrixWorld).y;
        this.body.position.y += (rootY - enAlcak) / scale;
        this.body.updateWorldMatrix(true, true);
      }
    }

    // ── Gövde ve kafa ──────────────────────────────────────────────────
    // Diz çökerken gövde dik kalır; sadece hafif öne eğilir.
    const UP = new THREE.Vector3(0, 1, 0);
    const lean = 0.08 - crouch * 0.06 + this.moveBlend * 0.06 + down * 0.3;
    aimBone(b.Spine, b.Spine1, turn('Spine', lean, UP), rootQ);
    aimBone(b.Spine1, b.Spine2, turn('Spine1', lean * 0.4 - this.aimPitch * 0.3, UP), rootQ);
    aimBone(b.Neck, b.Head, turn('Neck', -this.aimPitch * 0.5 + down * 0.55, UP), rootQ);

    // ── Silah mesnedi: nişan açısıyla yükselir, geri tepmeyle sarsılır ──
    if (this.mount) {
      const s = 1 / (this.root.scale.x || 1);
      this.mount.rotation.x = this.aimPitch + this.recoil * 0.25;
      this.mount.rotation.y = HOLD_YAW;
      this.mount.position.set(
        0.09 * s,
        (1.35 - crouch * 0.18 - down * 0.4) * s,
        (0.14 - this.recoil * 0.05) * s,
      );
      // DİKKAT: updateMatrixWorld ataları tazelemez. Kol IK'sı
      // updateWorldMatrix(true,…) ile kökü tazelediği için mesnet bir kare
      // geride kalıyor, eller silahın ~10 cm gerisine uzanıyordu.
      this.mount.updateWorldMatrix(true, true);
    }

    // ── Kollar silaha uzanır (iki kemikli basit IK) ────────────────────
    if (this.rifle && this.gripLocal) {
      const grip = this.rifle.localToWorld(this.gripLocal.clone());
      const support = this.rifle.localToWorld(this.supportLocal.clone());
      const tmp = new THREE.Vector3();

      // Dirsekler aşağı-dışa baksın (kutup vektörü askerin kendi ekseninde)
      const poleR = new THREE.Vector3(0.55, -0.85, 0.5).applyQuaternion(rootQ).normalize();
      const poleL = new THREE.Vector3(-0.2, -1, 0.15).applyQuaternion(rootQ).normalize();

      if (collapse < 0.6) {
        solveTwoBone(b.RightArm, b.RightForeArm, b.RightHand, grip, poleR);
        solveTwoBone(b.LeftArm, b.LeftForeArm, b.LeftHand, support, poleL);

        // Bilekler ve parmaklar: avuçlar silahı GERÇEKTEN kavrasın. IK
        // yalnızca el KONUMUNU çözüyor; bilek açısı ve parmaklar serbest
        // kalınca "silahın yanında duran açık el" görüntüsü oluşuyordu.
        const rifleQ = this.rifle.getWorldQuaternion(new THREE.Quaternion());
        const barrel = new THREE.Vector3(0, 0, -1).applyQuaternion(rifleQ).normalize();
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rifleQ).normalize();

        // Bilek: avuç içi silaha baksın — el, namlu doğrultusunda uzanır
        aimBoneWorld(b.RightHand, b.RightHandMiddle1, up.clone().addScaledVector(barrel, 0.35).normalize());
        aimBoneWorld(b.LeftHand, b.LeftHandMiddle1, up.clone().addScaledVector(barrel, 0.5).normalize());

        // Parmaklar namlu ekseni etrafında dönerek silahı sarar:
        // ilk boğum 25°, ikinci boğum 95° — kapanan bir yumruk.
        this._grip(b, 'Right', up, barrel);
        this._grip(b, 'Left', up, barrel);
      } else {
        // Ölürken eller silahı bırakır, kollar yana düşer
        const DOWN2 = new THREE.Vector3(0, -1, 0);
        aimBone(b.RightArm, b.RightForeArm, DOWN2.clone(), rootQ);
        aimBone(b.LeftArm, b.LeftForeArm, DOWN2.clone(), rootQ);
        aimBone(b.RightForeArm, b.RightHand, DOWN2.clone(), rootQ);
        aimBone(b.LeftForeArm, b.LeftHand, DOWN2.clone(), rootQ);
      }
      void tmp;
    }
  }

  dispose(scene) {
    scene.remove(this.root);
  }
}
