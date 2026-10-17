/* Oyuncunun tankı sürmesi, nişan alması ve kamera.

   Kontroller
     W / S      ileri – geri
     A / D      gövdeyi döndür
     Fare       taret (yatay) ve namlu (dikey)
     Sol tık    seçili silahla ateş
     V          ana top ⇄ makineli tüfek
     Z          nişan al (dürbün: dar görüş açısı, hassas fare)
     E          yakıt ikmali (ikmal noktasının üstündeyken)
     Shift      yüksek devir (daha hızlı, daha çok yakıt)

   Kamera üçüncü şahıs: taretin arkasından, tankın üstünden bakar.
   Nişan alınca göz namlunun üstüne geçer ve görüş açısı daralır.       */

import * as THREE from 'three';

const KAMERA_MESAFE = 13.5;
const KAMERA_YUKSEK = 6.2;
const NISAN_FOV = 22;
const NORMAL_FOV = 75;

export class TankPilot {
  constructor(camera, input, battle) {
    this.camera = camera;
    this.input = input;
    this.battle = battle;

    this.tank = null;
    this.bakisYaw = Math.PI;      // taretin hedef dünya açısı
    this.bakisPitch = 0.04;
    this.nisan = false;
    this.fov = NORMAL_FOV;
    this.sarsinti = 0;
    this._kameraPos = new THREE.Vector3();
  }

  bagla(tank) {
    this.tank = tank;
    this.bakisYaw = tank.yon;
    this.bakisPitch = 0.04;
    this.nisan = false;
  }

  /** Nişan alırken fare hassasiyeti düşer (dürbün etkisi). */
  get bakisCarpani() { return this.nisan ? 0.35 : 1; }

  bak(dx, dy) {
    const k = this.bakisCarpani;
    this.bakisYaw -= dx * k;
    this.bakisPitch = THREE.MathUtils.clamp(this.bakisPitch - dy * k, -0.12, 0.33);
  }

  modDegistir() {
    if (!this.tank) return;
    this.tank.mod = this.tank.mod === 'top' ? 'mg' : 'top';
  }

  nisanAl(acik) {
    this.nisan = acik;
  }

  atesEt(now) {
    const t = this.tank;
    if (!t?.alive) return false;
    if (t.mod === 'mg') {
      const oldu = this.battle.mgAtesi(t, now);
      if (oldu) this.sarsinti = Math.max(this.sarsinti, 0.08);
      return oldu;
    }
    const oldu = this.battle.topAtesi(t);
    if (oldu) this.sarsinti = 1;
    return oldu;
  }

  /** @returns {{yakitBitti:boolean, ikmalYakin:boolean}} */
  update(dt, now, girdi) {
    const t = this.tank;
    if (!t) return { yakitBitti: false, ikmalYakin: false };

    if (!t.alive) {
      this._kamera(dt, true);
      return { yakitBitti: false, ikmalYakin: false };
    }

    // ── Sürüş ───────────────────────────────────────────────────────
    const yakitVar = t.yakit > 0;
    const gaz = yakitVar ? (girdi.forward || 0) : 0;
    const donus = girdi.right || 0;
    const kosu = girdi.sprint && gaz > 0 ? 1.25 : 1;

    const hedefHiz = gaz > 0 ? t.tip.hiz * kosu * gaz
      : gaz < 0 ? t.tip.geriHiz * gaz : 0;
    t.hiz += (hedefHiz - t.hiz) * Math.min(1, dt * 1.8);
    if (Math.abs(t.hiz) < 0.05) t.hiz = 0;

    // Dönüş: duruyorken yerinde döner, hızlıyken daha geniş yay çizer
    const donusHizi = t.tip.donus * (Math.abs(t.hiz) > 0.3 ? 0.78 : 1);
    t.yon -= donus * donusHizi * dt * (yakitVar ? 1 : 0.35);

    // Yokuş direnci: yokuş yukarı tırmanırken yavaşlar
    const s = Math.sin(t.yon), c = Math.cos(t.yon);
    const arena = this.battle.arena;
    if (arena) {
      const egim = (arena.yukseklik(t.pos.x - s * 3, t.pos.z - c * 3)
        - arena.yukseklik(t.pos.x + s * 3, t.pos.z + c * 3)) / 6;
      t.hiz -= egim * 8 * dt;
    }
    t.pos.x -= s * t.hiz * dt;
    t.pos.z -= c * t.hiz * dt;

    // Ağaç/kaya/istasyon çarpışması ve araziye oturma
    if (this.battle.carpismaCoz(t)) {
      t.hiz *= 0.45;
      this.sarsinti = Math.max(this.sarsinti, 0.1);
    }
    this.battle.araziyeOturt(t, dt);

    // Yakıt: yalnızca hareket ederken yanar, yüksek devirde daha çok
    const yuk = Math.abs(t.hiz) / t.tip.hiz;
    if (yuk > 0.02) {
      t.yakit = Math.max(0, t.yakit - t.tip.yakitTuketim * yuk * kosu * dt);
    }

    // ── Taret ───────────────────────────────────────────────────────
    t.tareteNisanAl(this.bakisYaw, this.bakisPitch, dt);

    this.sarsinti *= Math.pow(0.02, dt);
    this.fov += ((this.nisan ? NISAN_FOV : NORMAL_FOV) - this.fov) * Math.min(1, dt * 9);
    this._kamera(dt, false);

    return {
      yakitBitti: t.yakit <= 0,
      ikmalYakin: Boolean(this.battle.yakindakiIkmal()),
    };
  }

  _kamera(dt, olu) {
    const t = this.tank;
    const cam = this.camera;
    const taretAci = t.taretDunyaAcisi;

    if (this.nisan && !olu) {
      // Nişancı görüşü: namlunun hemen üstü
      const p = t.namluUcu.clone();
      const geri = new THREE.Vector3(Math.sin(taretAci), 0, Math.cos(taretAci));
      p.addScaledVector(geri, 2.2).add(new THREE.Vector3(0, 0.55, 0));
      cam.position.lerp(p, Math.min(1, dt * 14));
    } else {
      const geri = new THREE.Vector3(Math.sin(taretAci), 0, Math.cos(taretAci));
      this._kameraPos.copy(t.pos)
        .addScaledVector(geri, KAMERA_MESAFE)
        .add(new THREE.Vector3(0, KAMERA_YUKSEK + (olu ? 3 : 0), 0));
      cam.position.lerp(this._kameraPos, Math.min(1, dt * 6));
    }

    const bakilan = t.pos.clone().add(new THREE.Vector3(0, 2.1, 0));
    bakilan.x -= Math.sin(taretAci) * 24;
    bakilan.z -= Math.cos(taretAci) * 24;
    bakilan.y += this.bakisPitch * 24;
    cam.lookAt(bakilan);

    if (this.sarsinti > 0.001) {
      const s = this.sarsinti * 0.22;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
