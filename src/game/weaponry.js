/* Silah sistemi: model yükleme, hizalama, cephane durumu, ateş kadansı,
   şarjör değiştirme ve birinci şahıs görünüm animasyonu.

   Modeller farklı kaynaklardan geldiği için yönleri ve ölçekleri tutarsız.
   `normalizeModel` her modeli ölçer, en uzun eksenini namlu kabul edip
   -Z'ye (ileri) çevirir ve hedef uzunluğa ölçekler.                       */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WEAPONS } from './weapons.js';
import { normalizeModel } from './align.js';
import { applyFinish } from './finish.js';
import {
  RIGS, POUCH, choreography, boltCycle, sample, sampleNum, sampleArr,
} from './mechanics.js';
import { POSES, blendPose } from './fparms.js';

const DEG = Math.PI / 180;

// Namlu içinde mermi kalabilen (kapalı sürgülü) silahlar: taktik doldurmada +1
const CLOSED_BOLT = new Set(['pistol', 'ar', 'ak', 'barrett', 'bolt']);

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();

/** Basamak izi: t anına kadarki son anahtarın değeri (geçişsiz). */
function stepValue(track, t) {
  let v = track[0][1];
  for (const k of track) { if (k[0] <= t) v = k[1]; else break; }
  return v;
}

/* Minigun için yordamsal fişek bandı: besleyiciden sarkan kısa bir uç.
   Doldurmada "şarjör" gibi davranır (çekilir, atılır, yenisi takılır). */
function makeBelt() {
  const g = new THREE.Group();
  const brass = new THREE.MeshStandardMaterial({ color: 0xb8892f, roughness: 0.32, metalness: 0.92 });
  const link = new THREE.MeshStandardMaterial({ color: 0x2b2d2c, roughness: 0.5, metalness: 0.8 });
  const round = new THREE.CylinderGeometry(0.0062, 0.0068, 0.06, 8);
  round.rotateZ(Math.PI / 2);
  const tip = new THREE.ConeGeometry(0.0062, 0.016, 8);
  tip.rotateZ(-Math.PI / 2);
  const clip = new THREE.BoxGeometry(0.05, 0.004, 0.009);
  for (let i = 0; i < 9; i++) {
    const y = -i * 0.013;
    const z = i * i * 0.0012;            // sarkarken hafifçe kıvrılır
    const r = new THREE.Mesh(round, brass);
    r.position.set(0, y, z);
    g.add(r);
    const t = new THREE.Mesh(tip, brass);
    t.position.set(0.038, y, z);
    g.add(t);
    const c = new THREE.Mesh(clip, link);
    c.position.set(-0.004, y - 0.006, z);
    g.add(c);
  }
  g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  return g;
}

function makeFlash(scale) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffd9a0,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Çapraz iki dörtgen — her açıdan hacimli görünür.
  for (let i = 0; i < 2; i++) {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(0.22 * scale, 0.22 * scale), mat);
    quad.rotation.z = i * Math.PI / 2;
    group.add(quad);
  }

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.035 * scale, 8, 6),
    new THREE.MeshBasicMaterial({
      color: 0xfff3dc, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  group.add(core);

  const light = new THREE.PointLight(0xffb866, 0, 7, 2);
  group.add(light);

  group.visible = false;
  group.userData.light = light;
  return group;
}

export class Weaponry {
  constructor(camera, audio) {
    this.camera = camera;
    this.audio = audio;

    // Silahlar kameranın çocuğu: bakışla birlikte hareket eder.
    this.rig = new THREE.Group();
    camera.add(this.rig);

    // Elde tutulan silah sahnenin genel ışığına bırakılırsa karanlık kalıyor;
    // yalnızca onu aydınlatan iki küçük ışık ekliyoruz (menzilleri kısa,
    // dünyaya taşmıyor).
    // Silahlar artık omuzda (ellerle tutuluyor) ve ışığa eskisinden yakın:
    // ışık şiddeti mesafenin karesiyle arttığı için hem uzaklaştırıldı hem
    // kısıldı — yoksa metalik dokular bembeyaz parlıyordu.
    const keyLight = new THREE.PointLight(0xfff0d8, 5.5, 4, 2);
    keyLight.position.set(0.7, 0.75, 0.55);
    this.rig.add(keyLight);

    const fillLight = new THREE.PointLight(0xa8ccdd, 2.4, 4, 2);
    fillLight.position.set(-0.8, -0.3, 0.3);
    this.rig.add(fillLight);

    this.slots = [];       // { def, holder, model, flash, muzzle, ammo, reserve }
    // Baskın: yalnızca seçilen silahlar kuşanılır, mermi ortak torbadan gelir
    this.allowed = null;   // Set(id) | null
    this.pool = null;      // { left } | null
    this.current = null;
    this.previousId = null;

    this.ads = false;
    this.adsBlend = 0;     // 0 = kalçadan, 1 = nişan alınmış
    this.reloading = false;
    this.reloadEnd = 0;
    this.reloadStart = 0;
    this.nextShot = 0;
    this.spin = 0;         // minigun hızlanma (0–1)

    // Oynayan koreografi: şarjör değiştirme ya da sürgü çekme
    //   { kind: 'reload'|'cycle', chor, start, ev, empty }
    this.action = null;
    this.arms = null;      // FPArms (oyun askerler yüklenince bağlar)
    this._fireBlend = 0;   // tetik parmağı kıvrımı

    // Görünüm animasyon durumları
    this._kick = 0;        // geri tepme (m)
    this._kickVel = 0;
    this._swayX = 0;
    this._swayY = 0;
    this._bob = 0;
    this._punch = new THREE.Vector2(); // model dönüş sarsıntısı

    this.onShot = null;      // ({ origin, dir, weapon }) => void
    this.onEvent = null;     // (name, payload) => void
  }

  async loadAll(onProgress) {
    const loader = new GLTFLoader();
    let done = 0;

    for (const def of WEAPONS) {
      // basePath: sayfa alt klasördeyse (tank bölümü) dosya yolu öneki
      const gltf = await loader.loadAsync((this.basePath ?? '') + def.file);
      const model = gltf.scene;

      const { muzzle } = normalizeModel(model, def.view.length, {
        flipForward: def.view.flipForward,
        flipUp: def.view.flipUp,
      });

      // Oyunun paletine göre renklendir (GLB'den gelen düz gri malzemeler
      // yerine gövde/metal/kabza rolleri).
      if (def.finish) applyFinish(model, def.finish);

      // Prosedürel malzemesi glTF'e geçmeyen modeller: ada göre boya
      if (def.paint) {
        model.traverse((o) => {
          if (!o.isMesh) return;
          const p = def.paint[o.material?.name];
          if (!p) return;
          o.material = o.material.clone();
          o.material.color.setHex(p[0]);
          o.material.roughness = p[1];
          o.material.metalness = p[2];
        });
      }

      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;       // birinci şahıs silahı gölge dökmez
        o.receiveShadow = false;
        o.frustumCulled = false;    // kameraya çok yakın, kırpılmasın
        if (o.material) o.material.side = THREE.FrontSide;
      });

      const holder = new THREE.Group();
      holder.add(model);
      if (def.view.rot) {
        holder.rotation.set(def.view.rot[0] * DEG, def.view.rot[1] * DEG, def.view.rot[2] * DEG);
      }
      holder.visible = false;
      this.rig.add(holder);

      // Dönen namlu demeti (minigun): ilgili parçalar tek bir pivota alınır.
      // Pivot holder'ın çocuğu olduğu için dönme ekseni ileri yöndür (-Z).
      let spinPivot = null;
      if (def.spinParts) {
        const parts = [];
        model.traverse((o) => { if (o.isMesh && def.spinParts.test(o.name ?? '')) parts.push(o); });
        if (parts.length) {
          // Dönme ekseni = namluların ORTALAMA merkezi. Kapsayan kutunun
          // merkezi kullanılınca simetrik olmayan rotor ekseni 3.5 cm
          // kaydırıyor, demet kendi etrafında değil yandan yalpalıyordu.
          holder.updateWorldMatrix(true, true);
          const center = new THREE.Vector3();
          const axisParts = parts.filter((o) => (def.spinCenter ?? /^Barrel_\d+$/).test(o.name ?? ''));
          const use = axisParts.length >= 3 ? axisParts : parts;
          for (const o of use) {
            o.geometry.computeBoundingBox();
            center.add(o.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(o.matrixWorld));
          }
          center.divideScalar(use.length);

          spinPivot = new THREE.Group();
          holder.worldToLocal(center);          // holder uzayına taşı
          spinPivot.position.copy(center);
          holder.add(spinPivot);
          for (const o of parts) spinPivot.attach(o);   // dünya konumu korunur
        }
      }

      // Namlu ucu konumu HOLDER uzayında hesaplanır (align.js modelin kendi
      // dönüşümünü uygular), bu yüzden alev de holder'a bağlanmalı — modele
      // bağlanırsa modelin kendi dönüşü kadar kayar.
      const flash = makeFlash(def.flash ?? 1);
      flash.position.copy(muzzle);
      holder.add(flash);

      const slot = {
        def,
        holder,
        model,
        flash,
        spinPivot,
        rig: RIGS[def.id] ?? null,
        parts: {},
        muzzle: muzzle.clone(),
        ammo: def.mag,
        reserve: def.reserve,
        flashTimer: 0,
        slideKick: 1,       // atıştan beri geçen süre (sürgü geri-ileri)
        manualSpin: 0,
      };
      if (slot.rig) this._buildParts(slot);
      this.slots.push(slot);

      done++;
      onProgress?.(done / WEAPONS.length, def.name);
    }

    this.equip(WEAPONS[1].id); // AK-47 ile başla
    return this.slots;
  }

  /* Hareketli parça grupları: her grup kendi pivotuna alınır (pivot
     tutucunun çocuğu; eksenleri tutucuyla aynı). Böylece "şarjörü 5 cm
     aşağı, 0.4 rad öne devir" gibi koreografi değerleri metre/radyan
     cinsinden ve her silahta aynı anlamda yazılabiliyor.                 */
  _buildParts(slot) {
    const { holder, model, rig } = slot;
    holder.updateWorldMatrix(true, true);
    const inv = holder.matrixWorld.clone().invert();

    for (const [key, re] of Object.entries(rig.parts)) {
      const meshes = [];
      model.traverse((o) => { if (o.isMesh && re.test(o.name ?? '')) meshes.push(o); });
      if (!meshes.length) continue;

      const box = new THREE.Box3();
      for (const m of meshes) {
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld).applyMatrix4(inv));
      }
      const c = box.getCenter(new THREE.Vector3());
      let point = c.clone();
      if (key === 'mag') {
        if (rig.pivot === 'frontTop') point.set(c.x, box.max.y, box.min.z);
        else if (rig.pivot === 'rear') point.set(c.x, c.y, box.max.z);
        else point.set(c.x, box.max.y, c.z);
      } else if (key === 'bolt' && rig.boltAxis) {
        point.set(rig.boltAxis[0], rig.boltAxis[1], c.z);
      } else if (key === 'cover' && rig.coverHinge) {
        point.fromArray(rig.coverHinge);
      }

      const pivot = new THREE.Group();
      pivot.position.copy(point);
      holder.add(pivot);
      pivot.updateWorldMatrix(true, false);
      for (const m of meshes) pivot.attach(m);

      slot.parts[key] = { pivot, home: point.clone(), meshes, size: box.getSize(new THREE.Vector3()) };
    }

    // Minigun: yordamsal bant ucu "şarjör" rolünde
    if (rig.belt && !slot.parts.mag) {
      const pivot = new THREE.Group();
      pivot.position.fromArray(rig.belt.at);
      pivot.add(makeBelt());
      holder.add(pivot);
      slot.parts.mag = { pivot, home: pivot.position.clone(), meshes: [], size: new THREE.Vector3(0.05, 0.12, 0.05) };
    }
  }

  /** Birinci şahıs kollar (SWAT modelinden). Askerler yüklenince çağrılır. */
  attachArms(arms) {
    this.arms = arms;
    this.rig.add(arms.root);
  }

  get slot() { return this.current; }

  /** Silah bu turda kullanılabilir mi (Baskın'da yalnızca seçilen ikisi). */
  usable(id) {
    return !this.allowed || this.allowed.has(id);
  }

  equip(id) {
    if (!this.usable(id)) return false;
    const next = this.slots.find((s) => s.def.id === id);
    if (!next || next === this.current) return false;

    if (this.current) {
      this.previousId = this.current.def.id;
      this.current.holder.visible = false;
      this.current.flash.visible = false;
    }

    this.current = next;
    next.holder.visible = true;
    this.reloading = false;
    this.action = null;
    this.spin = 0;
    this.nextShot = performance.now() / 1000 + 0.25;  // kuşanma gecikmesi
    this._kick = 0.18;                                 // yukarı kalkma hissi
    this.audio.swap();
    this.onEvent?.('equip', next);
    return true;
  }

  equipSlot(n) {
    const s = this.slots.find((x) => x.def.slot === n);
    return s ? this.equip(s.def.id) : false;
  }

  cycle(dir) {
    const list = this.slots.filter((s) => this.usable(s.def.id));
    if (!list.length) return false;
    const i = list.indexOf(this.current);
    const n = (i + dir + list.length) % list.length;
    return this.equip(list[n].def.id);
  }

  swapPrevious() {
    if (this.previousId) this.equip(this.previousId);
  }

  get fireInterval() {
    const def = this.current.def;
    let rpm = def.rpm;
    if (def.spinUp) rpm *= 0.35 + 0.65 * this.spin;   // minigun yavaş başlar
    return 60 / rpm;
  }

  /** Mevcut saçılma (derece). */
  get spreadDeg() {
    const def = this.current.def;
    const base = THREE.MathUtils.lerp(def.spread, def.adsSpread, this.adsBlend);
    return base;
  }

  /** Kapalı sürgülü silahta namlu içinde mermi varken kapasite +1. */
  _capacity(s, empty) {
    const type = s.rig?.reload;
    return s.def.mag + (!empty && CLOSED_BOLT.has(type) ? 1 : 0);
  }

  startReload() {
    const s = this.current;
    if (this.reloading || this.action || s.reserve <= 0) return false;
    const empty = s.ammo === 0;
    if (s.ammo >= this._capacity(s, empty)) return false;

    const now = performance.now() / 1000;
    const chor = s.rig
      ? choreography(s.rig.reload, empty)
      : { dur: s.def.reloadTime, ev: [[0, 'magOut'], [s.def.reloadTime * 0.6, 'seat']] };
    this.action = { kind: 'reload', chor, start: now, ev: 0, empty };
    this.reloading = true;
    this.reloadStart = now;
    this.reloadEnd = now + chor.dur;
    this.onEvent?.('reload-start', s);
    return true;
  }

  _finishReload() {
    const s = this.current;
    const cap = this._capacity(s, this.action?.empty ?? true);
    const take = Math.min(cap - s.ammo, s.reserve);
    s.ammo += take;
    s.reserve -= take;
    if (this._pooled(s)) {
      this.pool.left = Math.max(0, this.pool.left - take);
      this._syncPool();
    }
    this.reloading = false;
    this.onEvent?.('reload-end', s);
  }

  /** Tetik çekildi. Ateş edildiyse true döner. */
  tryFire(now) {
    const s = this.current;
    if (!s || this.reloading || this.action) return false;
    if (now < this.nextShot) return false;

    if (s.ammo <= 0) {
      this.audio.dryFire();
      this.nextShot = now + 0.35;
      this.onEvent?.('dry', s);
      return false;
    }

    s.ammo--;
    this.nextShot = now + this.fireInterval;

    // Namlu ucunun dünya konumu ve kameranın bakış yönü
    const origin = s.holder.localToWorld(s.muzzle.clone());

    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));

    // Saçılma: bakış yönü etrafında rastgele koni
    const spread = this.spreadDeg * DEG;
    if (spread > 0) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();
      dir.addScaledVector(right, Math.sin(a) * r).addScaledVector(up, Math.cos(a) * r).normalize();
    }

    // Görsel geri tepme
    this._kickVel += s.def.kickback * 26;
    this._punch.x += (Math.random() - 0.5) * s.def.recoil * 0.5;
    this._punch.y += s.def.recoil * 0.7;

    // Namlu alevi
    s.flash.visible = true;
    s.flashTimer = 0.045;
    s.flash.rotation.z = Math.random() * Math.PI;
    const sc = 0.85 + Math.random() * 0.4;
    s.flash.scale.setScalar(sc);
    s.flash.userData.light.intensity = 4.5 * (s.def.flash ?? 1);

    this.audio.shot(s.def.sound);
    s.slideKick = 0;                // tabanca sürgüsü geri-ileri gider
    this._fireBlend = 1;            // tetik parmağı sıkar
    const bolt = s.rig?.reload === 'bolt';
    this.onShot?.({ origin, dir, weapon: s.def, slot: s, noEject: bolt || Boolean(s.def.rocket) });

    // Sürgülü tüfek: kovan ancak sürgü çekilince çıkar
    if (bolt && s.ammo > 0) {
      this.action = { kind: 'cycle', chor: boltCycle(), start: now + 0.14, ev: 0 };
    }
    return true;
  }

  /** Her karede çağrılır. ctx: { dt, now, moving, sprinting, firing, ads, look } */
  update(ctx) {
    const { dt, now } = ctx;
    const s = this.current;
    if (!s) return;

    const def = s.def;

    // ── Koreografi (şarjör değiştirme / sürgü çekme) ────────────────────
    const act = this.action;
    const t = act ? now - act.start : 0;
    const chor = act?.chor ?? null;
    if (act) {
      // Olaylar: zamanı gelenler sırayla bir kez
      const evs = chor.ev ?? [];
      while (act.ev < evs.length && evs[act.ev][0] <= t) this._event(s, evs[act.ev++][1]);
      if (t >= chor.dur) {
        if (act.kind === 'reload') this._finishReload();
        this.action = null;
      }
    }

    // Nişan alma karışımı (dürbünlü silahlarda model saklanır).
    // `noAds` olan silahlar (minigun gibi) omza alınmaz: hep kalçadan.
    this.ads = ctx.ads && !this.reloading && !def.noAds;
    const adsTarget = this.ads ? 1 : 0;
    this.adsBlend += (adsTarget - this.adsBlend) * Math.min(1, dt * 12);

    // Minigun hızlanması
    if (def.spinUp) {
      const target = ctx.firing && s.ammo > 0 && !this.reloading ? 1 : 0;
      const rate = dt / def.spinUp;
      this.spin = THREE.MathUtils.clamp(this.spin + (target ? rate : -rate * 0.7), 0, 1);
    }

    // Namlu demeti: hızlanınca döner, tetiği bırakınca yavaşlayarak durur.
    // Doldurmada el ile çevrilen tur da buraya eklenir.
    if (s.spinPivot) {
      const manual = chor?.spin ? sampleNum(chor.spin, t) * 2.1 : 0;
      s.spinPivot.rotation.z += dt * this.spin * 34 + (manual - s.manualSpin);
      s.manualSpin = act ? manual : 0;
    }

    // Namlu alevi sönümü
    if (s.flashTimer > 0) {
      s.flashTimer -= dt;
      const k = Math.max(0, s.flashTimer / 0.045);
      s.flash.userData.light.intensity = 5 * k * (def.flash ?? 1);
      if (s.flashTimer <= 0) {
        s.flash.visible = false;
        s.flash.userData.light.intensity = 0;
      }
    }

    // Geri tepme yayı
    this._kickVel -= this._kick * 170 * dt;      // yay kuvveti
    this._kickVel *= Math.pow(0.0016, dt);       // sönüm
    this._kick += this._kickVel * dt;
    this._kick = THREE.MathUtils.clamp(this._kick, -0.05, 0.3);

    this._punch.multiplyScalar(Math.pow(0.0009, dt));

    // Bakış salınımı (fare hareketi gecikmeli takip)
    const look = ctx.look ?? { dx: 0, dy: 0 };
    this._swayX += (THREE.MathUtils.clamp(-look.dx * 2.2, -0.05, 0.05) - this._swayX) * Math.min(1, dt * 7);
    this._swayY += (THREE.MathUtils.clamp(-look.dy * 2.2, -0.05, 0.05) - this._swayY) * Math.min(1, dt * 7);

    // Yürüyüş sallanması
    const bobSpeed = ctx.sprinting ? 13 : 9;
    const bobAmp = (ctx.moving ? (ctx.sprinting ? 0.016 : 0.009) : 0.0015) * (1 - this.adsBlend * 0.7);
    this._bob += dt * bobSpeed * (ctx.moving ? 1 : 0.35);

    // Hedef konum: kalçadan ↔ nişan
    const hip = def.view.pos;
    const aim = def.view.adsPos ?? hip;
    const px = THREE.MathUtils.lerp(hip[0], aim[0], this.adsBlend);
    const py = THREE.MathUtils.lerp(hip[1], aim[1], this.adsBlend);
    const pz = THREE.MathUtils.lerp(hip[2], aim[2], this.adsBlend);

    // Koreografinin silah duruşu: [dx,dy,dz, yunuslama, sapma, yatırma]
    const G = chor?.gun ? sampleArr(chor.gun, t) : null;
    const g = G ?? [0, 0, 0, 0, 0, 0];

    const h = s.holder;
    h.position.set(
      px + this._swayX + Math.cos(this._bob) * bobAmp * 0.6 + g[0],
      py + this._swayY + Math.sin(this._bob * 2) * bobAmp + g[1],
      pz + this._kick * (1 - this.adsBlend * 0.5) + g[2],
    );

    const baseRot = def.view.rot ?? [0, 0, 0];
    const bx = baseRot[0] * DEG + this._punch.y * DEG;
    const by = baseRot[1] * DEG + this._punch.x * DEG - this._swayX * 2.5;
    const bz = baseRot[2] * DEG + this._swayX * 1.5;
    h.rotation.set(bx + g[3], by + g[4], bz + g[5]);

    // Koreografi dönüşü dipçik ucu (tutucu orijini, kameranın arkası)
    // etrafında uygulanırsa küçük açılar namluyu gökyüzüne savuruyor.
    // Gerçekte silah elde, şarjör yuvası çevresinde döner: pivot telafisi.
    if (G) {
      const useGrip = !s.parts.mag || s.rig?.reloadPivot === 'grip';
      const pv = useGrip ? _v.fromArray(s.rig?.anchors.grip.p ?? [0, 0, -0.3]) : s.parts.mag.home;
      const qBase = _q.setFromEuler(new THREE.Euler(bx, by, bz));
      const a = pv.clone().applyQuaternion(qBase);
      const b = pv.clone().applyQuaternion(h.quaternion);
      h.position.add(a.sub(b));
    }
    h.updateMatrix();

    // Dürbünlü silah: nişan alınca model gizlenir, dürbün maskesi devralır
    const scoped = Boolean(def.scope) && this.adsBlend > 0.72;
    s.model.visible = !scoped;
    for (const p of Object.values(s.parts)) p.pivot.visible = !scoped;

    // ── Hareketli parçalar ──────────────────────────────────────────────
    s.slideKick += dt;
    this._applyParts(s, chor, t);

    // ── Eller ───────────────────────────────────────────────────────────
    this._fireBlend = Math.max(0, this._fireBlend - dt * 9);
    if (this.arms) {
      // Gövde duruşu silaha göre yumuşakça değişir
      const st = s.rig?.stance ?? { yaw: 0.5, mid: [0, -0.27, 0.12] };
      const k = Math.min(1, dt * 8);
      this._stYaw = (this._stYaw ?? st.yaw) + (st.yaw - (this._stYaw ?? st.yaw)) * k;
      this._stMid = (this._stMid ?? new THREE.Vector3().fromArray(st.mid)).lerp(_v.fromArray(st.mid), k);
      this.arms.setStance(this._stYaw, this._stMid);
      this.arms.visible = !scoped;
      if (!scoped) this._updateHands(s, chor, t);
    }
  }

  /* Koreografi olayları: sesler ve fizik. */
  _event(s, name) {
    if (name === 'drop') {
      const mag = s.parts.mag;
      if (mag) this.onEvent?.('drop', { pivot: mag.pivot, heavy: s.rig.reload === 'belt', slot: s });
      return;
    }
    if (name === 'eject') {
      this.onEvent?.('eject', s);
      return;
    }
    this.audio.reload(name);
  }

  /* Parça izleri + atış başına mekanik (tabanca sürgüsü, sürgü kilidi). */
  _applyParts(s, chor, t) {
    const P = s.parts;
    const rig = s.rig;
    if (!rig) return;

    // Tabanca sürgüsü: her atışta 25 ms'de geri, 45 ms'de ileri; son
    // mermide açık kalır (kilitlenir) — doldurmada elle bırakılır.
    if (P.slide) {
      const k = s.slideKick;
      const kick = k < 0.025 ? k / 0.025 : k < 0.07 ? 1 - (k - 0.025) / 0.045 : 0;
      const locked = s.ammo === 0 && k > 0.02 ? 1 : 0;
      const track = chor?.slide ? sampleNum(chor.slide, t) : 0;
      const v = chor?.slide ? track : Math.max(kick, locked);
      P.slide.pivot.position.z = P.slide.home.z + v * (rig.slideTravel ?? 0.03);
    }
    if (P.charge) {
      const v = chor?.charge ? sampleNum(chor.charge, t) : 0;
      P.charge.pivot.position.z = P.charge.home.z + v * (rig.chargeTravel ?? 0.07);
    }
    if (P.bolt) {
      const lift = chor?.boltLift ? sampleNum(chor.boltLift, t) : 0;
      const back = chor?.bolt ? sampleNum(chor.bolt, t) : 0;
      P.bolt.pivot.rotation.z = lift * 1.05;
      P.bolt.pivot.position.z = P.bolt.home.z + back * (rig.boltTravel ?? 0.08);
    }
    if (P.cover) {
      const v = chor?.cover ? sampleNum(chor.cover, t) : 0;
      P.cover.pivot.rotation.x = v * 1.15;
    }
    if (P.rounds) {
      const v = chor?.rounds ? sampleNum(chor.rounds, t, 1) : 1;
      P.rounds.pivot.visible = v > 0.5 && P.rounds.pivot.visible;
    }

    // Şarjör
    const mag = P.mag;
    if (mag) {
      const r = chor?.mag ? sample(chor.mag, t) : null;
      if (r) {
        const A = this._magPose(s, r.a);
        const B = this._magPose(s, r.b);
        A.pos.lerp(B.pos, r.s);
        A.quat.slerp(B.quat, r.s);
        // Tutucu uzayına çevir
        _m.compose(A.pos, A.quat, _v.set(1, 1, 1)).premultiply(_m2.copy(s.holder.matrix).invert());
        _m.decompose(mag.pivot.position, mag.pivot.quaternion, _v);
      } else {
        mag.pivot.position.copy(mag.home);
        mag.pivot.quaternion.identity();
      }
      // Görünürlük: koreografi izi; yoksa roketatarda yalnızca doluyken
      let vis = true;
      if (chor?.magVis) vis = stepValue(chor.magVis, t) > 0.5;
      else if (s.def.rocket) vis = s.ammo > 0;
      mag.pivot.visible = vis && mag.pivot.visible;
    }
  }

  /** Şarjörün KAMERA (rig) uzayındaki duruşu: 'home' | 'pouch' | magPoses. */
  _magPose(s, name) {
    if (name === 'pouch') {
      return {
        pos: new THREE.Vector3().fromArray(POUCH.p),
        quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(...POUCH.r)),
      };
    }
    const mag = s.parts.mag;
    const off = name === 'home' ? null : s.rig.magPoses?.[name];
    const pos = mag.home.clone();
    const quat = new THREE.Quaternion();
    if (off) {
      pos.add(_v.fromArray(off.p));
      quat.setFromEuler(new THREE.Euler(...off.r));
    }
    pos.applyMatrix4(s.holder.matrix);
    quat.premultiply(_q.setFromRotationMatrix(s.holder.matrix));
    return { pos, quat };
  }

  /** Çapanın DÜNYA uzayındaki avuç hedefi. */
  _anchorWorld(s, name) {
    const an = s.rig.anchors[name] ?? s.rig.anchors.support;
    const part = an.on ? s.parts[an.on] : null;
    const frame = part ? part.pivot : s.holder;
    frame.updateWorldMatrix(true, false);
    const local = new THREE.Vector3().fromArray(an.p);
    // Şarjör çapaları şarjör pivotuna GÖRE yazıldı (şarjör elden ele
    // dolaşıyor); sürgü/kol/kapak çapaları ise silah üzerindeki mutlak
    // konumlarıyla — pivotun yuva konumu çıkarılır.
    if (part && an.on !== 'mag') local.sub(part.home);
    return {
      pos: local.applyMatrix4(frame.matrixWorld),
      k: new THREE.Vector3().fromArray(an.k).transformDirection(frame.matrixWorld),
      n: new THREE.Vector3().fromArray(an.n).transformDirection(frame.matrixWorld),
      pose: an.pose,
    };
  }

  /* Bir elin izini çöz: iki çapa arasında konum/yön/parmak karışımı. */
  _handTarget(s, track, t, fallback) {
    const r = track ? sample(track, t) : null;
    const nameA = r ? r.a : fallback;
    const nameB = r ? r.b : fallback;
    const A = this._anchorWorld(s, nameA);
    const B = nameB === nameA ? A : this._anchorWorld(s, nameB);
    const poseA = r?.ka?.[2] && POSES[r.ka[2]] ? r.ka[2] : A.pose;
    const poseB = r?.kb?.[2] && POSES[r.kb[2]] ? r.kb[2] : B.pose;
    const k = r ? r.s : 0;
    return {
      pos: A.pos.lerp(B.pos, k),
      k: A.k.lerp(B.k, k).normalize(),
      n: A.n.lerp(B.n, k).normalize(),
      pose: blendPose(poseA, poseB, k),
    };
  }

  _updateHands(s, chor, t) {
    if (!s.rig) { this.arms.visible = false; return; }
    this.arms.visible = true;
    this.rig.updateWorldMatrix(true, true);

    const camQ = this.camera.getWorldQuaternion(new THREE.Quaternion());
    const poleR = new THREE.Vector3(0.75, -1, 0.35).applyQuaternion(camQ);
    const poleL = new THREE.Vector3(-0.75, -1, 0.35).applyQuaternion(camQ);

    const R = this._handTarget(s, chor?.R, t, 'grip');
    // Ateşte tetik parmağı sıkar
    if (this._fireBlend > 0 && !this.reloading) {
      R.pose = blendPose(R.pose, 'squeeze', this._fireBlend);
    }
    const L = this._handTarget(s, chor?.L, t, 'support');

    this.arms.reach('R', R, R.pose, poleR);
    this.arms.reach('L', L, L.pose, poleL);
  }

  get scoped() {
    return Boolean(this.current?.def.scope) && this.adsBlend > 0.72;
  }

  resetAmmo() {
    for (const s of this.slots) {
      s.ammo = s.def.mag;
      s.reserve = s.def.reserve;
      s.slideKick = 1;
    }
    this.reloading = false;
    this.action = null;
  }

  /** Roketler mermi sayılmaz: bazuka kendi 7 roketiyle gelir. */
  _pooled(s) {
    return Boolean(this.pool) && !s.def.rocket && this.usable(s.def.id);
  }

  _syncPool() {
    for (const s of this.slots) if (this._pooled(s)) s.reserve = this.pool.left;
  }

  /**
   * Baskın donanımı: yalnızca `ids` kullanılabilir; şarjörler dâhil toplam
   * `rounds` mermi iki silah arasında ORTAK torbadan paylaşılır.
   * `null` ile normal oyuna dönülür.
   */
  setLoadout(ids, rounds = 600) {
    this.resetAmmo();
    if (!ids) {
      this.allowed = null;
      this.pool = null;
      return;
    }
    this.allowed = new Set(ids);
    this.pool = { left: rounds };
    for (const s of this.slots) {
      if (!this._pooled(s)) continue;
      s.ammo = Math.min(s.def.mag, this.pool.left);
      this.pool.left -= s.ammo;
    }
    this._syncPool();
  }

  /** Dalga sonu ikmali. */
  resupply(fraction = 0.35) {
    if (this.pool) return;                 // Baskın'da ikmal yok
    for (const s of this.slots) {
      s.reserve = Math.min(s.def.reserve, s.reserve + Math.ceil(s.def.reserve * fraction));
    }
  }
}
