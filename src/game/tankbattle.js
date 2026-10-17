/* Tank muharebesi: oyuncu tankı, müttefikler, düşmanlar, mermiler ve
   yakıt ikmali.

   Tasarım notları:
   - Mermi hitscan DEĞİL, gerçek cisim: tank topu yavaş (≈95 m/s görsel
     ölçek) ve yerçekimi var; uzaktaki hedefi vurmak için namluyu
     kaldırmak gerekiyor. Bu, tank dövüşünü piyadeden ayıran şey.
   - Makineli tüfek hitscan ve dağılımlı: yakın savunma silahı.
   - Yakıt yalnızca HAREKET ederken yanar; görev yakıtı "ideal" olacak
     şekilde ayarlı (bkz. chapters.js) — bir kez ikmal şart.
   - Yapay zekâ: menzil tut, ateş hattı açık değilse yaklaş, taret çevir,
     dolum bitince ateş et. Düşmanlar oyuncuyu ve müttefikleri hedefler.  */

import * as THREE from 'three';
import { Tank, TANK_TIPLERI, DIGER_TANK } from './tanks.js';
import { ARENA_YARICAP } from './tankarena.js';

const YERCEKIMI = 9.81;
const MERMI_OMRU = 6;

/* ─────────────────────────────── Mermi ──────────────────────────────── */

class Mermi {
  constructor(scene) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    );
    this.iz = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.02, 2.4, 6, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffa94d, transparent: true, opacity: 0.55 }),
    );
    this.iz.rotation.x = Math.PI / 2;
    this.mesh.add(this.iz);
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.omur = 0;
    this.sahip = null;
    this.hasar = 0;
  }

  firlat(pos, yon, hiz, sahip, hasar) {
    this.pos.copy(pos);
    this.vel.copy(yon).multiplyScalar(hiz);
    this.omur = MERMI_OMRU;
    this.sahip = sahip;
    this.hasar = hasar;
    this.mesh.visible = true;
    this.mesh.position.copy(pos);
  }

  sondur() {
    this.omur = 0;
    this.mesh.visible = false;
  }
}

/* ───────────────────────── Muharebe yöneticisi ──────────────────────── */

export class TankBattle {
  constructor(scene, world, effects, audio, factory, arena = null) {
    this.scene = scene;
    this.world = world;
    this.arena = arena;        // TankArena: tepelik/ormanlık saha
    this.effects = effects;
    this.audio = audio;
    this.factory = factory;

    this.oyuncu = null;
    this.muttefikler = [];
    this.dusmanlar = [];
    this.yakitNoktalari = [];
    this.mermiler = [];
    this.mermiImleci = 0;

    this.gorev = null;
    this.ikmalSayisi = 0;
    this.oldurme = 0;
    this.bitti = false;
    this.sonuc = null;        // 'zafer' | 'kayip'

    this.onKill = null;
    this.onPlayerHit = null;
    this.onIkmal = null;
    this.onBitis = null;

    this._ray = new THREE.Raycaster();
    this._ray.far = 320;
  }

  /* ── Kurulum ──────────────────────────────────────────────────────── */

  kur(gorev, oyuncuTankId) {
    this.temizle();
    this.gorev = gorev;
    this.bitti = false;
    this.sonuc = null;
    this.ikmalSayisi = 0;
    this.oldurme = 0;

    const dostTip = TANK_TIPLERI[oyuncuTankId];
    const dusmanTip = TANK_TIPLERI[DIGER_TANK[oyuncuTankId]];
    this.dostTip = dostTip;
    this.dusmanTip = dusmanTip;

    // Oyuncu
    this.oyuncu = this._tankYap(dostTip, 'player', new THREE.Vector3(0, 0, 26), Math.PI);
    this.oyuncu.yakit = gorev.yakit ?? dostTip.yakit;
    this.oyuncu.maxYakit = Math.max(this.oyuncu.yakit, dostTip.yakit);

    // Müttefikler: oyuncunun yanında yelpaze
    for (let i = 0; i < (gorev.muttefik ?? 3); i++) {
      const x = -14 + i * 14;
      const t = this._tankYap(dostTip, 'ally', new THREE.Vector3(x, 0, 34), Math.PI);
      t.yakit = t.maxYakit;
      this.muttefikler.push(t);
    }

    // Düşmanlar: karşı hatta dağılmış
    const n = gorev.dusman ?? 10;
    for (let i = 0; i < n; i++) {
      // Düşman hattı UZAKTA ve kademeli: hepsi birden menzile girerse
      // müttefikler yirmi saniyede eriyor. Oyuncu ilerledikçe savaş açılır.
      const sira = Math.floor(i / 5);
      const sutun = i % 5;
      const x = -58 + sutun * 29 + (sira % 2) * 14;
      const z = -95 - sira * 55;
      const t = this._tankYap(dusmanTip, 'enemy', new THREE.Vector3(x, 0, z), 0);
      t.yakit = t.maxYakit;
      this.dusmanlar.push(t);
    }

    // Yakıt ikmali artık arazideki AKARYAKIT İSTASYONLARINDA yapılıyor
    this.yakitNoktalari = (this.arena?.istasyonlar ?? []).map((s) => ({
      pos: s.pos.clone(),
      yaricap: s.yaricap,
      kullanildi: false,
      isaretle(k) {
        this.kullanildi = k;
        s.isik.material.color.setHex(k ? 0x4a5a4d : 0x8fe39a);
      },
      icindeMi(p) { return Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < this.yaricap; },
      nabiz() {},
      dispose() {},
    }));

    // Mermi havuzu
    if (!this.mermiler.length) {
      for (let i = 0; i < 48; i++) this.mermiler.push(new Mermi(this.scene));
    }
    return this.oyuncu;
  }

  /** Tankı arazinin kotuna oturtur ve eğime yatırır. */
  araziyeOturt(tank, dt = 0.016) {
    if (!this.arena) return;
    // Dört nokta (ön/arka/sol/sağ) örneklenir: tek nokta kullanınca tank
    // tümseklerde zıplıyor ve eğimi yanlış çıkıyordu.
    const e = this.arena.egim(tank.pos.x, tank.pos.z, tank.yon);
    tank.pos.y += (e.y - tank.pos.y) * Math.min(1, dt * 10);
    tank.egimX = e.pitch;
    tank.egimZ = e.roll;
  }

  /** Engellerden dışarı iter; çarpışma olduysa hızı keser. */
  carpismaCoz(tank) {
    if (!this.arena) return false;
    const d = this.arena.itme(tank.pos.x, tank.pos.z, tank.yon);
    tank.pos.x = d.x;
    tank.pos.z = d.z;

    // Tank–tank çarpışması. ENKAZLAR DA KATI: yanmış gövde yerde duruyor,
    // içinden geçilmemeli.
    for (const o of this.tumTanklar) {
      if (o === tank) continue;
      const dx = tank.pos.x - o.pos.x, dz = tank.pos.z - o.pos.z;
      const mesafe = Math.hypot(dx, dz);
      const esik = o.alive ? 6.4 : 5.6;
      if (mesafe < esik && mesafe > 0.001) {
        const it = (esik - mesafe) * (o.alive ? 0.5 : 1);
        tank.pos.x += (dx / mesafe) * it;
        tank.pos.z += (dz / mesafe) * it;
        return true;
      }
    }
    return d.carpti;
  }

  _tankYap(tip, taraf, pos, yon) {
    const rig = this.factory.create(tip.id);
    const t = new Tank(rig, tip, taraf);
    t.pos.copy(pos);
    if (this.arena) t.pos.y = this.arena.yukseklik(pos.x, pos.z);
    t.yon = yon;
    t.update(0);
    this.scene.add(t.root);
    return t;
  }

  temizle() {
    for (const t of this.tumTanklar) t.dispose(this.scene);
    this.oyuncu = null;
    this.muttefikler = [];
    this.dusmanlar = [];
    for (const y of this.yakitNoktalari) y.dispose(this.scene);
    this.yakitNoktalari = [];
    for (const m of this.mermiler) m.sondur();
  }

  get tumTanklar() {
    const out = [];
    if (this.oyuncu) out.push(this.oyuncu);
    return out.concat(this.muttefikler, this.dusmanlar);
  }

  get canliDusman() { return this.dusmanlar.filter((t) => t.alive).length; }
  get canliMuttefik() { return this.muttefikler.filter((t) => t.alive).length; }

  /* ── Ateş ─────────────────────────────────────────────────────────── */

  topAtesi(tank) {
    if (!tank.atesEt()) return false;
    const m = this._bosMermi();
    if (m) m.firlat(tank.namluUcu, tank.namluYonu, tank.tip.namluHizi, tank, tank.tip.hasar);
    this.effects.muzzleSmoke?.(tank.namluUcu, tank.namluYonu);
    this.audio.shot({ body: 70, crack: 1400, length: 0.5, punch: 1.0 });
    return true;
  }

  mgAtesi(tank, now) {
    if (!tank.mgAtesEt(now)) return false;
    const from = tank.namluUcu.clone().add(new THREE.Vector3(0, 0.35, 0));
    const yon = tank.namluYonu.clone();
    yon.x += (Math.random() - 0.5) * 0.035;
    yon.y += (Math.random() - 0.5) * 0.025;
    yon.z += (Math.random() - 0.5) * 0.035;
    yon.normalize();

    const hedefler = tank.taraf === 'enemy'
      ? [this.oyuncu, ...this.muttefikler] : this.dusmanlar;
    let enYakin = null, enKisa = 260;
    for (const h of hedefler) {
      if (!h?.alive) continue;
      const fark = h.merkez.clone().sub(from);
      const mesafe = fark.length();
      if (mesafe > enKisa) continue;
      const aci = fark.normalize().dot(yon);
      if (aci > 0.985) { enKisa = mesafe; enYakin = h; }
    }
    this.effects.tracer(from, from.clone().addScaledVector(yon, enYakin ? enKisa : 160),
      tank.taraf === 'enemy' ? 0xff9f6a : 0x9fd0ff);
    this.audio.shot({ body: 140, crack: 2400, length: 0.12, punch: 0.3 });

    if (enYakin) {
      enYakin.hasarAl(tank.tip.mgHasar, true);
      this.effects.hitBurst(enYakin.merkez, 0xffc98a, 5);
      if (!enYakin.alive) this._olum(enYakin, tank);
      else if (enYakin === this.oyuncu) this.onPlayerHit?.(tank.tip.mgHasar);
    }
    return true;
  }

  _bosMermi() {
    for (let i = 0; i < this.mermiler.length; i++) {
      const m = this.mermiler[(this.mermiImleci + i) % this.mermiler.length];
      if (m.omur <= 0) {
        this.mermiImleci = (this.mermiImleci + i + 1) % this.mermiler.length;
        return m;
      }
    }
    return null;
  }

  _olum(tank, vuran) {
    tank.alive = false;
    tank.olumZamani = performance.now() / 1000;
    this.effects.explosion?.(tank.merkez, 3.2);
    this.audio.explosion();
    if (tank.taraf === 'enemy') {
      this.oldurme++;
      this.onKill?.(tank, vuran);
    }
    // Yanan enkaz: gövde hafifçe yere gömülür, taret eğilir
    tank.root.rotation.z = (Math.random() - 0.5) * 0.25;
    if (tank.rig.turret) tank.rig.turret.rotation.y += (Math.random() - 0.5) * 0.9;
  }

  /* ── Yakıt ────────────────────────────────────────────────────────── */

  /** Oyuncu bir ikmal noktasının içindeyse onu döndürür. */
  yakindakiIkmal() {
    if (!this.oyuncu) return null;
    return this.yakitNoktalari.find((y) => y.icindeMi(this.oyuncu.pos)) ?? null;
  }

  ikmalYap() {
    const nokta = this.yakindakiIkmal();
    if (!nokta || !this.oyuncu) return false;
    const eklenen = this.oyuncu.yakitDoldur(this.oyuncu.maxYakit);
    if (eklenen <= 0.5 && nokta.kullanildi) return false;
    if (!nokta.kullanildi) {
      nokta.isaretle(true);
      this.ikmalSayisi++;
      this.onIkmal?.(this.ikmalSayisi, eklenen);
    }
    this.audio.swap();
    return true;
  }

  /* ── Döngü ────────────────────────────────────────────────────────── */

  update(dt, now) {
    this._mermileriSur(dt);
    for (const y of this.yakitNoktalari) y.nabiz(now);

    for (const t of this.muttefikler) this._yapayZeka(t, dt, now, this.dusmanlar);
    for (const t of this.dusmanlar) {
      this._yapayZeka(t, dt, now, [this.oyuncu, ...this.muttefikler]);
    }
    for (const t of this.tumTanklar) t.update(dt);

    this._bitisKontrol();
  }

  _mermileriSur(dt) {
    for (const m of this.mermiler) {
      if (m.omur <= 0) continue;
      m.omur -= dt;
      m.vel.y -= YERCEKIMI * dt;
      const adim = m.vel.clone().multiplyScalar(dt);
      const yeni = m.pos.clone().add(adim);

      // Tanklara çarpma. DİKKAT: mermi saniyede 200 m gidiyor, yani kare
      // başına ~6.6 m atlıyor — yalnızca bitiş noktasına bakmak tankın
      // içinden geçmesine (tünelleme) yol açıyordu. Bu yüzden ADIM
      // DOĞRU PARÇASI ile küre arasındaki en kısa mesafe ölçülür.
      let vurulan = null, enYakinT = 2;
      for (const t of this.tumTanklar) {
        if (!t.alive || t === m.sahip) continue;
        const dost = m.sahip?.taraf === 'enemy';
        if ((t.taraf === 'enemy') === dost) continue;      // dost ateşi yok
        const merkez = t.merkez;
        const ab = yeni.clone().sub(m.pos);
        const uzunluk2 = ab.lengthSq() || 1e-9;
        const u = THREE.MathUtils.clamp(
          merkez.clone().sub(m.pos).dot(ab) / uzunluk2, 0, 1,
        );
        const enYakinNokta = m.pos.clone().addScaledVector(ab, u);
        if (merkez.distanceTo(enYakinNokta) < 2.9 && u < enYakinT) {
          enYakinT = u;
          vurulan = t;
          yeni.copy(enYakinNokta);        // patlama temas noktasında
        }
      }

      if (vurulan) {
        // Oyuncuya gelen hasar biraz yumuşatılır: on tanka karşı tek
        // başına dayanabilmeli (müttefikler çabuk eriyor).
        const gelen = vurulan.taraf === 'player' ? m.hasar * 0.62 : m.hasar;
        const oldu = vurulan.hasarAl(gelen);
        this.effects.explosion?.(yeni, 1.6);
        this.audio.explosion();
        if (oldu) this._olum(vurulan, m.sahip);
        else if (vurulan === this.oyuncu) this.onPlayerHit?.(gelen * vurulan.tip.zirh);
        m.sondur();
        continue;
      }

      const zemin = this.arena ? this.arena.yukseklik(yeni.x, yeni.z) : 0;
      if (yeni.y <= zemin + 0.15) {             // araziye çarptı
        yeni.y = zemin + 0.15;
        this.effects.explosion?.(yeni, 1.1);
        this.audio.explosion();
        // Yakındaki tanklara şarapnel
        for (const t of this.tumTanklar) {
          if (!t.alive) continue;
          const d = t.merkez.distanceTo(yeni);
          if (d < 6) {
            const pay = m.hasar * 0.25 * (1 - d / 6);
            if (t.hasarAl(pay)) this._olum(t, m.sahip);
            else if (t === this.oyuncu) this.onPlayerHit?.(pay);
          }
        }
        m.sondur();
        continue;
      }

      m.pos.copy(yeni);
      m.mesh.position.copy(yeni);
      m.mesh.lookAt(yeni.clone().add(m.vel));
      if (m.omur <= 0) m.sondur();
    }
  }

  /* Yapay zekâ: menzil tut, nişan al, ateş et. */
  _yapayZeka(tank, dt, now, hedefler) {
    if (!tank.alive) return;

    let hedef = null, enKisa = Infinity;
    for (const h of hedefler) {
      if (!h?.alive) continue;
      const d = h.pos.distanceTo(tank.pos);
      if (d < enKisa) { enKisa = d; hedef = h; }
    }
    if (!hedef) {
      tank.hiz *= Math.pow(0.1, dt);
      return;
    }

    const istenenMesafe = tank.taraf === 'enemy' ? 62 : 48;
    const fark = hedef.pos.clone().sub(tank.pos);
    const mesafe = fark.length();
    const hedefAci = Math.atan2(-fark.x, -fark.z);

    // Taret: hedefe çevir. Namlu yükselişi GERÇEK balistikten gelir:
    //   sin(2θ) = g·d / v²  →  θ = ½·asin(g·d/v²)
    // Nişan hatası bilinçli: kusursuz nişan alan 10 tank oyuncuyu altı
    // saniyede eritiyordu.
    const v = tank.tip.namluHizi;
    const oran = THREE.MathUtils.clamp((YERCEKIMI * mesafe) / (v * v), -1, 1);
    const balistik = 0.5 * Math.asin(oran);
    const yukseklikFarki = (hedef.merkez.y - tank.namluUcu.y) / Math.max(1, mesafe);
    if (tank._nisanHatasi === undefined || now > (tank._hataYenile ?? 0)) {
      // Hata MESAFEYLE büyür: uzaktan isabet zor olmalı, yoksa on tank
      // oyuncuyu yirmi saniyede eritiyor.
      const uzak = THREE.MathUtils.clamp(mesafe / 110, 0.35, 1.6);
      const beceri = (tank.taraf === 'enemy' ? 0.085 : 0.05) * uzak;
      tank._nisanHatasi = (Math.random() - 0.5) * beceri;
      tank._egimHatasi = (Math.random() - 0.5) * beceri * 0.5;
      tank._hataYenile = now + 1.4 + Math.random() * 1.2;
    }
    const sapma = tank.tareteNisanAl(
      hedefAci + tank._nisanHatasi,
      balistik + yukseklikFarki + tank._egimHatasi, dt,
    );

    // Gövde: menzili koru
    let hedefHiz = 0;
    if (mesafe > istenenMesafe + 10) hedefHiz = tank.tip.hiz * 0.7;
    else if (mesafe < istenenMesafe - 12) hedefHiz = -tank.tip.geriHiz * 0.6;
    tank.hiz += (hedefHiz - tank.hiz) * Math.min(1, dt * 1.4);

    // Gövdeyi yavaşça hedefe çevir (taret zaten hızlı)
    let govdeFark = hedefAci - tank.yon;
    while (govdeFark > Math.PI) govdeFark -= Math.PI * 2;
    while (govdeFark < -Math.PI) govdeFark += Math.PI * 2;
    tank.yon += THREE.MathUtils.clamp(govdeFark, -tank.tip.donus * dt * 0.55,
      tank.tip.donus * dt * 0.55);
    tank.taretYon = tank.taretDunyaAcisi - tank.yon;

    // Yokuş direnci: yokuş yukarı yavaşlar, aşağı hızlanır
    const s2 = Math.sin(tank.yon), c2 = Math.cos(tank.yon);
    if (this.arena) {
      const egimOran = (this.arena.yukseklik(tank.pos.x - s2 * 3, tank.pos.z - c2 * 3)
        - this.arena.yukseklik(tank.pos.x + s2 * 3, tank.pos.z + c2 * 3)) / 6;
      tank.hiz -= egimOran * 7 * dt;
    }
    tank.pos.x -= s2 * tank.hiz * dt;
    tank.pos.z -= c2 * tank.hiz * dt;

    if (this.carpismaCoz(tank)) {
      tank.hiz *= 0.55;
      tank.yon += (tank._kacis ??= Math.random() < 0.5 ? -1 : 1) * 1.1 * dt;
    }
    const lim = ARENA_YARICAP - 20;
    const r = Math.hypot(tank.pos.x, tank.pos.z);
    if (r > lim) {
      tank.pos.x *= lim / r;
      tank.pos.z *= lim / r;
      tank.hiz *= 0.5;
    }
    this.araziyeOturt(tank, dt);

    // Ateş: nişan tutuyorsa ve menzildeyse
    // Tespit gecikmesi: hedefe kilitlendikten sonra 1.5–3.5 sn nişan alır
    if (tank._hedef !== hedef) {
      tank._hedef = hedef;
      tank._kilitZamani = now + 1.5 + Math.random() * 2;
    }
    const kilitli = now >= (tank._kilitZamani ?? 0);

    if (kilitli && sapma < 0.035 && mesafe < 95 && tank.topHazir) {
      this.topAtesi(tank);
    } else if (kilitli && sapma < 0.12 && mesafe < 50) {
      this.mgAtesi(tank, now);
    }
  }

  _bitisKontrol() {
    if (this.bitti || !this.gorev) return;
    if (this.oyuncu && !this.oyuncu.alive) {
      this.bitti = true;
      this.sonuc = 'kayip';
      this.onBitis?.('kayip');
      return;
    }
    const dusmanBitti = this.canliDusman === 0;
    const ikmalTamam = this.ikmalSayisi >= (this.gorev.ikmalHedefi ?? 1);
    if (dusmanBitti && ikmalTamam) {
      this.bitti = true;
      this.sonuc = 'zafer';
      this.onBitis?.('zafer');
    }
  }
}
