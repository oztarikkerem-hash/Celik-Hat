/* Tank muharebesi: araç tanımları, görsel gövde ve sürüş fiziği.

   Oyuncu bir tankın içinde: W/S ilerle-geri, A/D gövdeyi döndür, fare
   TARETİ çevirir, sol tık ana top, V makineli tüfek moduna geçer, Z
   nişan alır (dürbün), E yakıt ikmali yapar.

   İki araç birbirinin zıddı:
     ABRAMS — hafif, hızlı, az yakıt yakar; topu daha çabuk dolar ama
              vuruşu düşük
     TANK   — ağır, yavaş, çok yakıt yakar; zırhı kalın ve tek vuruşu
              çok sert

   Düşman tarafı HER ZAMAN oyuncunun seçmediği aracı kullanır.          */

import * as THREE from 'three';

export const TANK_TIPLERI = {
  abrams: {
    id: 'abrams',
    ad: 'M1 Abrams',
    model: 'assets/vehicles/abrams.glb',
    ozet: 'Hafif ve çevik. Topu hızlı dolar, yakıtı uzun gider; '
      + 'buna karşılık tek vuruşu daha zayıf ve zırhı ince.',
    hp: 1400,
    zirh: 0.80,            // gelen hasar çarpanı (düşük = kalın zırh)
    hasar: 185,            // ana top hasarı
    atisAraligi: 3.2,      // saniye
    hiz: 12.0,             // m/s
    geriHiz: 5.0,
    donus: 1.05,           // rad/s gövde dönüşü
    taretHizi: 1.10,       // rad/s taret dönüşü
    yakit: 100,
    yakitTuketim: 0.52,    // saniyede, tam gazda
    mgHasar: 15,
    mgAtisAraligi: 0.085,
    mgSarjor: 150,
    namluHizi: 200,        // mermi hızı (m/s): düşüş var ama nişan sezgisel
    renk: 0x6d7355,
  },
  tank: {
    id: 'tank',
    ad: 'T-90 Muhafız',
    model: 'assets/vehicles/tank.glb',
    ozet: 'Ağır ve sert. Kalın zırhı ve yüksek tek vuruş hasarı var; '
      + 'yavaş ilerler ve yakıtı çabuk tüketir.',
    hp: 1900,
    zirh: 0.62,
    hasar: 290,
    atisAraligi: 5.0,
    hiz: 8.4,
    geriHiz: 3.4,
    donus: 0.78,
    taretHizi: 0.72,
    yakit: 100,
    yakitTuketim: 0.95,
    mgHasar: 17,
    mgAtisAraligi: 0.105,
    mgSarjor: 120,
    namluHizi: 185,
    renk: 0x4e5340,
  },
};

export const DIGER_TANK = { abrams: 'tank', tank: 'abrams' };

/* ─────────────────────────── Model yükleyici ─────────────────────────── */

export class TankFactory {
  constructor() {
    this.modeller = {};     // id → THREE.Object3D (şablon)
  }

  async load(GLTFLoader, onProgress, maxAnisotropy = 8) {
    const loader = new GLTFLoader();
    const idler = Object.keys(TANK_TIPLERI);
    for (let i = 0; i < idler.length; i++) {
      const tip = TANK_TIPLERI[idler[i]];
      const gltf = await loader.loadAsync(tip.model);
      const kok = gltf.scene;
      kok.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          m.side = THREE.FrontSide;
          for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
            if (m[k]) { m[k].anisotropy = maxAnisotropy; m[k].needsUpdate = true; }
          }
        }
      });
      this.modeller[tip.id] = kok;
      onProgress?.((i + 1) / idler.length, tip.ad);
    }
    return this;
  }

  /** Yeni bir tank gövdesi üretir (geometri paylaşılır). */
  create(id) {
    const sablon = this.modeller[id];
    if (!sablon) return null;
    const kok = sablon.clone(true);
    const bul = (ad) => {
      let r = null;
      kok.traverse((o) => { if (o.name === ad) r = o; });
      return r;
    };
    return {
      root: kok,
      hull: bul('Hull') ?? kok,
      turret: bul('Turret'),
      gun: bul('Gun'),
      muzzle: bul('Muzzle'),
    };
  }
}

/* ────────────────────────────── Tank ────────────────────────────────── */

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Tank {
  /**
   * @param rig   TankFactory.create() çıktısı
   * @param tip   TANK_TIPLERI girdisi
   * @param taraf 'player' | 'ally' | 'enemy'
   */
  constructor(rig, tip, taraf = 'enemy') {
    this.rig = rig;
    this.root = rig.root;
    this.tip = tip;
    this.taraf = taraf;

    this.pos = new THREE.Vector3();
    this.yon = 0;                 // gövde yönü (rad)
    this.hiz = 0;                 // ileri hız (m/s)
    this.taretYon = 0;            // gövdeye GÖRE taret açısı
    this.namluEgim = 0;           // namlu yükselişi (rad)

    this.hp = tip.hp;
    this.maxHp = tip.hp;
    this.alive = true;
    this.yakit = tip.yakit;
    this.maxYakit = tip.yakit;

    this.topDolum = 0;            // kalan dolum süresi
    this.mgAtesSayaci = 0;
    this.mgSarjor = tip.mgSarjor;
    this.mod = 'top';             // 'top' | 'mg'
    this.geriTepme = 0;
    this.olumZamani = 0;

    this.hedefTaret = 0;
    this.hedefEgim = 0;
  }

  get merkez() {
    return _v.set(this.pos.x, this.pos.y + 1.6, this.pos.z).clone();
  }

  /** Namlu ucunun dünya konumu. */
  get namluUcu() {
    if (!this.rig.muzzle) return this.merkez;
    this.rig.muzzle.updateWorldMatrix(true, false);
    return new THREE.Vector3().setFromMatrixPosition(this.rig.muzzle.matrixWorld);
  }

  /** Namlunun baktığı dünya yönü. */
  get namluYonu() {
    const q = new THREE.Quaternion();
    (this.rig.gun ?? this.root).getWorldQuaternion(q);
    return new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();
  }

  get topHazir() { return this.topDolum <= 0; }
  get dolumOrani() {
    return 1 - THREE.MathUtils.clamp(this.topDolum / this.tip.atisAraligi, 0, 1);
  }

  /** Taretin dünya açısı (gövde + taret). */
  get taretDunyaAcisi() { return this.yon + this.taretYon; }

  /**
   * Tareti hedef dünya açısına çevirir; dönüş hızı sınırlı.
   * @returns hedefe kalan açı farkı (rad)
   */
  tareteNisanAl(dunyaAcisi, egim, dt) {
    let fark = dunyaAcisi - this.taretDunyaAcisi;
    while (fark > Math.PI) fark -= Math.PI * 2;
    while (fark < -Math.PI) fark += Math.PI * 2;
    const adim = this.tip.taretHizi * dt;
    this.taretYon += THREE.MathUtils.clamp(fark, -adim, adim);

    const hedefEgim = THREE.MathUtils.clamp(egim, -0.13, 0.34);
    this.namluEgim += THREE.MathUtils.clamp(
      hedefEgim - this.namluEgim, -adim, adim,
    );
    return Math.abs(fark);
  }

  hasarAl(miktar, delici = false) {
    if (!this.alive) return false;
    const carpan = delici ? Math.min(1, this.tip.zirh + 0.25) : this.tip.zirh;
    this.hp -= miktar * carpan;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      return true;
    }
    return false;
  }

  yakitDoldur(miktar = Infinity) {
    const once = this.yakit;
    this.yakit = Math.min(this.maxYakit, this.yakit + miktar);
    return this.yakit - once;
  }

  atesEt() {
    if (!this.topHazir) return false;
    this.topDolum = this.tip.atisAraligi;
    this.geriTepme = 1;
    return true;
  }

  mgAtesEt(now) {
    if (this.mgSarjor <= 0) return false;
    if (now < this.mgAtesSayaci) return false;
    this.mgAtesSayaci = now + this.tip.mgAtisAraligi;
    this.mgSarjor--;
    this.geriTepme = Math.max(this.geriTepme, 0.18);
    return true;
  }

  /** Görsel güncelleme: konum, taret, namlu, geri tepme. */
  update(dt) {
    this.topDolum = Math.max(0, this.topDolum - dt);
    this.geriTepme *= Math.pow(0.0015, dt);

    this.root.position.copy(this.pos);
    // Araziye yatma: önce yön, sonra eğim (YXZ sırası tankı doğru yatırır)
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y = this.yon;
    this.root.rotation.x += ((this.egimX ?? 0) - this.root.rotation.x) * Math.min(1, dt * 6);
    this.root.rotation.z += ((this.egimZ ?? 0) - this.root.rotation.z) * Math.min(1, dt * 6);
    if (this.rig.turret) this.rig.turret.rotation.y = this.taretYon;
    if (this.rig.gun) {
      // İşaret ÖNEMLİ: namlu -Z'ye baktığı için +X dönüşü namluyu KALDIRIR.
      // Eksi işaretiyle namlu alçalıyor, uzun atışlar hedefin önüne düşüyordu.
      this.rig.gun.rotation.x = this.namluEgim;
      // Geri tepme: namlu kısa süre geri kaçar
      this.rig.gun.position.z = (this.rig.gun.userData.z0 ??= this.rig.gun.position.z)
        + this.geriTepme * 0.45;
    }
  }

  dispose(scene) { scene.remove(this.root); }
}

/* ──────────────────────── Yakıt ikmal noktası ───────────────────────── */

export class YakitNoktasi {
  constructor(scene, pos) {
    this.pos = pos.clone();
    this.kullanildi = false;
    this.yaricap = 7;

    const grup = new THREE.Group();
    grup.position.copy(pos);

    // Yakıt deposu: silindir gövde + dar ayaklar
    const govde = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.5, 3.4, 20),
      new THREE.MeshStandardMaterial({ color: 0x7a6a32, roughness: 0.8, metalness: 0.3 }),
    );
    govde.position.y = 2.1;
    govde.castShadow = true;
    grup.add(govde);

    const taban = new THREE.Mesh(
      new THREE.BoxGeometry(4.4, 0.4, 4.4),
      new THREE.MeshStandardMaterial({ color: 0x2c2f28, roughness: 0.95 }),
    );
    taban.position.y = 0.2;
    taban.receiveShadow = true;
    grup.add(taban);

    // Uzaktan görünsün diye ışıklı direk
    const isik = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 9, 8),
      new THREE.MeshBasicMaterial({ color: 0x8fe39a }),
    );
    isik.position.y = 6.5;
    grup.add(isik);
    this.isik = isik;

    this.grup = grup;
    scene.add(grup);
  }

  /** Dolum tamamlanınca işaret söner. */
  isaretle(kullanildi) {
    this.kullanildi = kullanildi;
    this.isik.material.color.setHex(kullanildi ? 0x4a5a4d : 0x8fe39a);
  }

  icindeMi(pos) {
    return Math.hypot(pos.x - this.pos.x, pos.z - this.pos.z) < this.yaricap;
  }

  nabiz(t) {
    const k = this.kullanildi ? 0.25 : 0.55 + Math.sin(t * 3) * 0.45;
    this.isik.material.opacity = k;
    this.isik.material.transparent = true;
  }

  dispose(scene) { scene.remove(this.grup); }
}
