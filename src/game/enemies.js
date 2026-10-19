/* Düşmanlar: hurda droidler. Üç tip — koşucu, ağır ve tükürükçü (menzilli).
   Modeller kod içinde ilkel gövdelerden kurulur, yürüyüş bacak salınımıyla
   canlandırılır. Mermi çarpışması için kafa/gövde ayrı hedeflerdir.       */

import * as THREE from 'three';
import { Soldier } from './soldier.js';

const TYPES = {
  runner: {
    name: 'Koşucu', hp: 120, speed: 4.4, damage: 11, range: 2.0, cooldown: 0.95,
    scale: 0.92, color: 0x4a5a52, eye: 0xff5a3c, score: 100, ranged: false,
    shootRange: 20, shootCooldown: 1.9, shootDamage: 7, rifle: 'mar556',
  },
  brute: {
    name: 'Ağır', hp: 120, speed: 2.1, damage: 26, range: 2.5, cooldown: 1.6,
    scale: 1.45, color: 0x3e4a42, eye: 0xffb03c, score: 300, ranged: false,
    shootRange: 16, shootCooldown: 2.6, shootDamage: 14, rifle: 'm98b',
  },
  spitter: {
    name: 'Tükürükçü', hp: 120, speed: 2.8, damage: 14, range: 22, cooldown: 2.3,
    scale: 1.0, color: 0x47524a, eye: 0x6fe2a8, score: 220, ranged: true,
    shootRange: 26, shootCooldown: 2.1, shootDamage: 14, rifle: 'm98b',
  },
};

// Paylaşılan geometriler — her düşman için yeniden yaratılmaz.
const GEO = {
  // Düşman tüfeği: basit kutulardan kurulu, oyuncunun silahlarıyla
  // karışmayacak kadar sade (ayrıntılı asker modelleri sonra gelecek).
  rifleBody: new THREE.BoxGeometry(0.08, 0.1, 0.52),
  rifleBarrel: new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8),
  rifleMag: new THREE.BoxGeometry(0.05, 0.17, 0.08),
  rifleStock: new THREE.BoxGeometry(0.07, 0.12, 0.2),
  rifleGrip: new THREE.BoxGeometry(0.05, 0.14, 0.06),
  torso: new THREE.BoxGeometry(0.72, 0.9, 0.46),
  head: new THREE.SphereGeometry(0.23, 12, 10),
  eye: new THREE.SphereGeometry(0.075, 8, 6),
  limb: new THREE.BoxGeometry(0.18, 0.72, 0.2),
  arm: new THREE.BoxGeometry(0.16, 0.6, 0.18),
  pelvis: new THREE.BoxGeometry(0.56, 0.26, 0.4),
  shoulder: new THREE.BoxGeometry(0.96, 0.22, 0.34),
};

export class Enemy {
  constructor(type, wave, gear = null, soldierFactory = null) {
    this.gear = gear;
    this.soldierFactory = soldierFactory;
    const t = TYPES[type];
    this.type = type;
    this.def = t;

    // Dalga başına güçlenme — can hızdan daha çok artar ki oyun
    // kontrolsüz hızlanmasın.
    this.maxHp = Math.round(t.hp * (1 + (wave - 1) * 0.16));
    this.hp = this.maxHp;
    this.speed = t.speed * (1 + Math.min(0.5, (wave - 1) * 0.035));
    this.damage = t.damage * (1 + (wave - 1) * 0.06);
    this.scoreValue = t.score;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.alive = true;
    this.nextAttack = 0;
    this.nextShot = performance.now() / 1000 + 1.2 + Math.random() * 2;
    this.phase = Math.random() * Math.PI * 2;
    this.hurtFlash = 0;
    this.lunge = 0;

    // Siper savaşı durumu
    this.cover = null;
    this.inCover = false;
    this.peekUntil = 0;
    this.nextCoverThink = 0;
    this.burstLeft = 0;

    this.group = new THREE.Group();
    this._build();
  }

  _build() {
    if (this.soldierFactory) {
      this._buildSoldier();
      return;
    }
    this._buildBoxes();
  }

  /** Kullanıcının Blender asker modeli: parça-kemik yapısı, kodla animasyon. */
  _buildSoldier() {
    const t = this.def;
    const rig = this.soldierFactory.create(t.scale > 1.2 ? 1.1 : 1);
    const rifle = this.gear?.makeRifle(t.rifle ?? 'mar556') ?? null;

    this.soldier = new Soldier(rig, {
      team: 'enemy',
      rifle,
      tint: t.eye,
    });

    this.group.add(this.soldier.root);
    this.hitMeshes = this.soldier.hitMeshes;
    for (const m of this.hitMeshes) m.userData = { enemy: this, part: m.userData.part };

    // Uyumluluk: kutu gövdede kullanılan alanlar
    this.rifle = this.soldier.rifle;
    this.legs = [];
    this.matBody = null;
  }

  _buildBoxes() {
    const t = this.def;
    const matBody = new THREE.MeshStandardMaterial({
      color: t.color, roughness: 0.62, metalness: 0.55,
    });
    const matDark = new THREE.MeshStandardMaterial({
      color: 0x202622, roughness: 0.8, metalness: 0.3,
    });
    const matEye = new THREE.MeshStandardMaterial({
      color: 0x111111, emissive: t.eye, emissiveIntensity: 3.2, roughness: 0.4,
    });

    this.matBody = matBody;
    this.matEye = matEye;

    const s = t.scale;
    const g = this.group;
    g.scale.setScalar(s);

    const torso = new THREE.Mesh(GEO.torso, matBody);
    torso.position.y = 1.32;
    torso.castShadow = true;
    g.add(torso);

    const shoulder = new THREE.Mesh(GEO.shoulder, matDark);
    shoulder.position.y = 1.7;
    shoulder.castShadow = true;
    g.add(shoulder);

    const pelvis = new THREE.Mesh(GEO.pelvis, matDark);
    pelvis.position.y = 0.82;
    pelvis.castShadow = true;
    g.add(pelvis);

    const head = new THREE.Mesh(GEO.head, matBody);
    head.position.y = 1.95;
    head.castShadow = true;
    g.add(head);

    const eye = new THREE.Mesh(GEO.eye, matEye);
    eye.position.set(0, 1.96, -0.2);
    g.add(eye);
    this.eyeMesh = eye;

    // Göz feneri: düşmanın yaklaştığını karanlıkta belli eder.
    const glow = new THREE.PointLight(t.eye, 1.6, 4.5, 2);
    glow.position.set(0, 1.95, -0.25);
    g.add(glow);
    this.glow = glow;

    this.legs = [];
    this.legMeshes = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(GEO.limb, matBody);
      leg.position.set(side * 0.2, 0.38, 0);
      leg.castShadow = true;
      leg.userData = { enemy: this, part: 'leg' };
      g.add(leg);
      this.legs.push(leg);
      this.legMeshes.push(leg);

      const arm = new THREE.Mesh(GEO.arm, matBody);
      arm.position.set(side * 0.46, 1.34, 0);
      arm.castShadow = true;
      arm.userData = { enemy: this, part: 'body' };
      g.add(arm);
      this.legs.push(arm);
      this.legMeshes.push(arm);
    }

    // ── Tüfek ───────────────────────────────────────────────────────
    // Gerçek model (MAR 556 / M98B) tek geometriye kaynaştırılmış halde
    // gelir; yoksa oyun yine de çalışsın diye basit bir kutu tüfek kurulur.
    const rifle = new THREE.Group();
    const kind = t.rifle ?? 'mar556';
    const modelRifle = this.gear?.makeRifle(kind);

    if (modelRifle) {
      // Model dipçiği orijinde, namlusu -Z'de: eli kavrayacak şekilde kaydır.
      modelRifle.position.set(0, 0, 0.18);
      rifle.add(modelRifle);
      this.rifleMuzzleZ = (modelRifle.userData.muzzle?.z ?? -0.8) + 0.18;
    } else {
      const matGun = new THREE.MeshStandardMaterial({
        color: 0x3d4347, roughness: 0.42, metalness: 0.65,
      });
      this.matGun = matGun;
      const body = new THREE.Mesh(GEO.rifleBody, matGun);
      body.castShadow = true;
      rifle.add(body);
      const barrel = new THREE.Mesh(GEO.rifleBarrel, matGun);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = -0.42;
      rifle.add(barrel);
      this.rifleMuzzleZ = -0.6;
    }

    // Namlu alevi (ateş ederken bir kare görünür)
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 6),
      new THREE.MeshBasicMaterial({
        color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    flash.position.z = this.rifleMuzzleZ;
    flash.visible = false;
    rifle.add(flash);
    this.muzzleFlash = flash;

    // Göğüs hizasında çapraz tutuş: önden bakıldığında tüfeğin yan profili
    // görünür, böylece askerin silahlı olduğu anlaşılır.
    rifle.position.set(0.12, 1.2, -0.42);
    rifle.rotation.set(0, 0.42, -0.12);
    g.add(rifle);
    this.rifle = rifle;

    // Çarpışma hedefleri
    head.userData = { enemy: this, part: 'head' };
    torso.userData = { enemy: this, part: 'body' };
    pelvis.userData = { enemy: this, part: 'body' };
    shoulder.userData = { enemy: this, part: 'body' };
    this.hitMeshes = [head, torso, pelvis, shoulder, ...this.legMeshes];
  }

  get center() {
    return new THREE.Vector3(this.pos.x, this.pos.y + 1.35 * this.def.scale, this.pos.z);
  }

  /** Tüfeğin namlu ucu (dünya uzayında) — mermiler buradan çıkar. */
  get muzzleWorld() {
    if (this.soldier) return this.soldier.muzzleWorld;
    const p = new THREE.Vector3(0, 0, this.rifleMuzzleZ ?? -0.6);
    return this.rifle ? this.rifle.localToWorld(p) : this.center;
  }

  /** Ateş anında namlu alevini yak. */
  fireFlash() {
    this.soldier?.kick();
    if (!this.muzzleFlash) return;
    this.muzzleFlash.visible = true;
    this.flashTimer = 0.06;
  }

  hurt(amount) {
    this.hp -= amount;
    this.hurtFlash = 1;
    return this.hp <= 0;
  }

  /**
   * Sandık yuvasındaki nişancı: yerinden kıpırdamaz, M2'yi hedefe çevirir
   * (yaylım ±46°, yavaş döner — yan taraftan sokulan kurtulabilir) ve
   * uzun seriler atar.
   */
  _updateNest(dt, now, target, onAttack) {
    const n = this.nest, mg = n.mg;
    this.pos.copy(n.seat);
    this.vel.set(0, 0, 0);
    const base = mg.mount.getWorldPosition(new THREE.Vector3());
    const dx = target.pos.x - base.x, dz = target.pos.z - base.z;
    const dist = Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
    let rel = Math.atan2(-dx, -dz) - n.baseYaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const inArc = Math.abs(rel) <= 0.8;
    rel = THREE.MathUtils.clamp(rel, -0.8, 0.8);
    const k = Math.min(1, dt * 2.6);
    mg.yaw += (rel - mg.yaw) * k;
    const ty = (target.eyePosition?.y ?? target.center?.y ?? 1.3) - 0.25;
    const pitch = THREE.MathUtils.clamp(Math.atan2(ty - (base.y + 0.45), Math.hypot(dx, dz)), -0.2, 0.24);
    mg.pitch += (pitch - mg.pitch) * k;
    mg.yawP.rotation.y = mg.yaw;
    mg.pitchP.rotation.x = mg.pitch;
    mg.mount.updateWorldMatrix(true, true);
    this.facing = n.baseYaw + mg.yaw;

    if (inArc && dist < n.range && Math.abs(rel - mg.yaw) < 0.07 && now >= this.nextShot) {
      if (this.burstLeft > 0) {
        this.burstLeft--;
        this.nextShot = now + 0.11;
        if (this.burstLeft === 0) this.nextShot = now + 1.4 + Math.random() * 1.2;
        onAttack(this, dist, 'mg');
      } else {
        this.burstLeft = 7 + Math.floor(Math.random() * 7);
        this.nextShot = now + 0.05;
      }
    }

    if (this.soldier) {
      this.soldier.setShadowDistance(dist);
      this.soldier.update({ dt, speed: 0, crouching: false, downed: false, aimPitch: mg.pitch, aiming: true });
    }
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.group.rotation.set(0, this.facing, 0);
    return dist;
  }

  /** raid: Baskın'da saldıran taraf — siperden sipere hızla eve yüklenir. */
  update(dt, now, player, arena, onAttack, world = null, raid = false) {
    if (this.nest) return this._updateNest(dt, now, player, onAttack);
    const toPlayer = new THREE.Vector3(
      player.pos.x - this.pos.x, 0, player.pos.z - this.pos.z,
    );
    const dist = toPlayer.length();
    toPlayer.normalize();

    // ── Siper kararı ───────────────────────────────────────────────────
    // Uzaktan çatışmada mevzi tutar, arada siperden çıkıp seri atar.
    // Yakına sokulduğunda siperi bırakıp hücuma geçer.
    if (world && now >= this.nextCoverThink) {
      this.nextCoverThink = now + 1.1 + Math.random();
      if (dist > 9 && dist < 60) {
        // Siperden sipere ilerleme: bir mevzide yeterince kaldıysa ve hâlâ
        // uzaksa, hedefe daha yakın bir siper seçer (sıçrayarak ilerleme)
        // Baskında saldıranlar uzakta siper tutup beklemez: hep hedefe
        // yaklaştıran siperi seçer, her mevzide yalnızca birkaç saniye kalır.
        // Eskiden 50 m ötede çömelip kalıyorlardı (menzilleri 20–26 m, ateş
        // bile edemiyorlardı); makineliden bakınca kaçıyor gibi görünüyordu.
        const stay = raid ? 2.5 + Math.random() * 1.5 : 7;
        const advance = raid
          ? dist > 14 && (!this.inCover || now - (this.coverSince ?? now) > stay)
          : this.inCover && now - (this.coverSince ?? now) > stay && dist > 16;
        const keep = raid && this.cover && !advance;
        const c = keep ? this.cover
          : world.findCover(this.pos, player.pos, this, advance ? 16 : 20, advance);
        if (c !== this.cover) this.coverSince = now;
        this.cover = c;
      } else if (this.cover) {
        this.cover.taken = null;
        this.cover = null;
      }
      if (raid && dist <= 14 && this.cover) {          // dibine gelince hücum
        this.cover.taken = null;
        this.cover = null;
      }
    }

    // Siperde iki evre: SAKLAN (çömelir, ateş etmez) ↔ DOĞRUL (siperin
    // üstünden kısa seriler atar). Eski kod zar tutmayınca 0.3 sn sonra
    // yeniden atıyordu; asker neredeyse hiç saklanmıyordu.
    if (this.cover && this.inCover) {
      if (now > this.peekUntil) {
        this.peekPhase = !this.peekPhase;
        const hide = raid ? 0.5 : 1;                     // baskında kısa saklanır
        this.peekUntil = now + (this.peekPhase ? 1.3 + Math.random() * 1.5 : (1.0 + Math.random() * 1.8) * hide);
      }
    } else {
      this.peekPhase = true;
    }
    const peeking = this.cover && this.inCover ? this.peekPhase : true;

    let goal = player.pos;
    if (this.cover) goal = this.cover.pos;

    const toGoal = new THREE.Vector3(goal.x - this.pos.x, 0, goal.z - this.pos.z);
    const goalDist = toGoal.length();
    this.inCover = Boolean(this.cover) && goalDist < 1.3;

    const wantsRange = this.def.ranged ? this.def.range * 0.7 : this.def.range * 0.8;
    const approach = this.cover ? goalDist > 0.9 : dist > wantsRange;

    if (approach) {
      const steer = (this.cover ? toGoal : toPlayer).clone().normalize();

      // Engel kaçınma: yakındaki kutulardan it. Sipere son yaklaşmada itme
      // zayıflar — siper noktası duvara 0.55 m uzakta; tam kuvvetle itme
      // askeri oraya hiç ulaştırmıyor, sonsuza dek etrafında yürütüyordu.
      const avoidK = this.cover ? THREE.MathUtils.clamp((goalDist - 0.9) / 3.2, 0.08, 1) : 1;
      for (const box of arena.colliders) {
        if (box.max.y < 0.6) continue;
        const cx = THREE.MathUtils.clamp(this.pos.x, box.min.x, box.max.x);
        const cz = THREE.MathUtils.clamp(this.pos.z, box.min.z, box.max.z);
        const dx = this.pos.x - cx, dz = this.pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < 2.6 * 2.6) {
          const d = Math.max(0.2, Math.sqrt(d2));
          const push = ((2.6 - d) / 2.6) * avoidK;
          steer.x += (dx / d) * push * 1.9;
          steer.z += (dz / d) * push * 1.9;
        }
      }

      if (steer.lengthSq() > 0) steer.normalize();
      this.vel.lerp(steer.multiplyScalar(this.speed), Math.min(1, dt * 5));
    } else {
      this.vel.multiplyScalar(Math.pow(0.02, dt));
    }

    this.pos.addScaledVector(this.vel, dt);

    // Arena içinde kal
    const lim = arena.half - 1.6;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -lim, lim);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -lim, lim);

    // Saldırı: menzilde ateş, dibinde darbe. Cam hedefi (Baskın) büyük ve
    // durağan: 38 m'den ateş açılır
    const shootRange = player.glass ? 38 : this.def.shootRange;
    if (dist <= this.def.range && now >= this.nextAttack) {
      this.nextAttack = now + this.def.cooldown;
      this.lunge = 1;
      onAttack(this, dist, 'melee');
    } else if (
      this.def.shootRange && dist <= shootRange && now >= this.nextShot
      && (!this.inCover || peeking)
    ) {
      // Taramalı ateş: oyuncu gibi kısa seriler. Seri bitince nefeslenir.
      if (this.burstLeft > 0) {
        this.burstLeft--;
        this.nextShot = now + 0.12;
        if (this.burstLeft === 0) {
          this.nextShot = now + this.def.shootCooldown * (0.7 + Math.random() * 0.6);
        }
        onAttack(this, dist, 'shoot');
      } else {
        this.burstLeft = 3 + Math.floor(Math.random() * 3);   // 3–5 mermi
        this.nextShot = now + 0.05;
      }
    }

    // Yönelme ve animasyon.
    // Modelin önü -Z'ye bakar; Y ekseninde f kadar döndürülünce ileri yönü
    // (-sin f, 0, -cos f) olur. Bunun oyuncuya doğrulması için açı
    // atan2(ex - px, ez - pz) olmalı — ters yazılırsa asker sırtını döner.
    const targetFacing = Math.atan2(this.pos.x - player.pos.x, this.pos.z - player.pos.z);
    let diff = targetFacing - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.facing += diff * Math.min(1, dt * 7);

    const moving = this.vel.length() > 0.4;
    this.phase += dt * (moving ? 7 + this.speed : 2);
    const swing = Math.sin(this.phase) * (moving ? 0.55 : 0.08);

    // Asker modeli: duruşlar kemiklerden; kutu gövde: basit uzuv salınımı
    if (this.soldier) {
      const toTarget = new THREE.Vector3(
        player.pos.x - this.pos.x,
        (player.pos.y + 1.5) - (this.pos.y + 1.4),
        player.pos.z - this.pos.z,
      );
      this.soldier.setShadowDistance(dist);
      this.soldier.update({
        dt,
        speed: this.vel.length(),
        // Siperdeyken saklanma evresinde çömelir: vuruş kutuları kemiklere
        // bağlı olduğu için gövde siperin arkasına iner, mermi sandığa takılır
        crouching: this.inCover && !peeking,
        downed: false,
        aimPitch: Math.atan2(toTarget.y, Math.hypot(toTarget.x, toTarget.z)),
        // Ateş menzilindeyken ve saklanmıyorken tüfek omuzda
        aiming: Boolean(this.def.shootRange) && dist <= shootRange * 1.2
          && (!this.inCover || peeking),
      });
    } else if (this.legs.length >= 4) {
      this.legs[0].rotation.x = swing;
      this.legs[2].rotation.x = -swing;
      this.legs[1].rotation.x = -0.9 - swing * 0.08;
      this.legs[3].rotation.x = -0.75 + swing * 0.08;
    }

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0 && this.muzzleFlash) this.muzzleFlash.visible = false;
    }

    // Tüfek oyuncuya doğrultulur (yaklaşınca hafifçe kaldırılır)
    if (this.rifle && !this.soldier) {
      const aimUp = dist < this.def.range * 1.6 ? 0.08 : -0.12;
      this.rifle.rotation.x += (aimUp - this.rifle.rotation.x) * Math.min(1, dt * 5);
    }

    this.lunge *= Math.pow(0.002, dt);

    const bob = moving ? Math.abs(Math.cos(this.phase)) * 0.06 : 0;
    this.group.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    this.group.rotation.y = this.facing;
    this.group.rotation.x = this.lunge * 0.25;

    // Vuruş parlaması (kutu gövdede malzeme emissive'i; askerde atlanır)
    if (this.hurtFlash > 0 && this.matBody) {
      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 5);
      this.matBody.emissive.setRGB(this.hurtFlash * 0.9, this.hurtFlash * 0.25, this.hurtFlash * 0.08);
      this.matBody.emissiveIntensity = this.hurtFlash * 2.2;
    }

    return dist;
  }

  dispose(scene) {
    scene.remove(this.group);
    // Asker modelinde malzemeler paylaşımlı (kutu gövdede kendine ait):
    // yalnızca var olanları bırak.
    this.matBody?.dispose();
    this.matEye?.dispose();
    // Tüfek geometrisi ve malzemesi tüm askerlerde ORTAK — bırakılmaz.
    this.matGun?.dispose();
    this.muzzleFlash?.geometry.dispose();
    this.muzzleFlash?.material.dispose();
  }
}

/* ─────────────────────────── Mermi (tükürükçü) ─────────────────────────── */

class Projectile {
  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshStandardMaterial({
        color: 0x0d1a14, emissive: 0x6fe2a8, emissiveIntensity: 3, roughness: 0.4,
      }),
    );
    this.light = new THREE.PointLight(0x6fe2a8, 2.2, 5, 2);
    this.mesh.add(this.light);
    this.mesh.visible = false;
    this.vel = new THREE.Vector3();
    this.life = 0;
    this.damage = 0;
  }
}

/* ──────────────────────────── Dalga yöneticisi ─────────────────────────── */

export class EnemyManager {
  constructor(scene, world, effects, audio, physics, gear = null, soldierFactory = null) {
    this.gear = gear;
    this.soldierFactory = soldierFactory;
    this.scene = scene;
    this.arena = world;          // sektörlü dünya (çarpışma listesi burada)
    this.world = world;
    this.physics = physics;
    this.effects = effects;
    this.audio = audio;

    this.enemies = [];
    this.wave = 0;
    this.pending = 0;          // bu dalgada doğmayı bekleyen
    this.nextSpawn = 0;
    this.spawnInterval = 1.1;
    this.state = 'idle';       // idle | spawning | fighting | break
    this.breakEnd = 0;

    this.corpses = [];        // kutu gövdeli eski düşmanlar için fizikli ceset
    this.dying = [];          // yığılma animasyonu oynayan askerler
    this.projectiles = [];
    for (let i = 0; i < 24; i++) {
      const p = new Projectile();
      scene.add(p.mesh);
      this.projectiles.push(p);
    }
    this.projCursor = 0;
    this._ray = new THREE.Raycaster();

    this.onKill = null;        // (enemy, part) => void
    this.onWaveStart = null;   // (wave, total) => void
    this.onWaveClear = null;   // (wave, now) => void — son düşman düştüğü an
    this.onBlocked = null;     // (mesh, damage, point) => void — cama isabet
    this.onPlayerHit = null;   // (damage, bolge, enemy) => void
    this.onAllyHit = null;     // (ally, damage, enemy) => void
    this.allies = [];          // müttefik listesi (hedef seçimi için)
    // Baskın görevi: sabit dalga boyları, evin çevresinden doğma.
    // { waves: [20, 25, 30, 25], center, minR, maxR, maxAlive }
    this.raid = null;
  }

  get hitTargets() {
    const out = [];
    for (const e of this.enemies) if (e.alive) out.push(...e.hitMeshes);
    return out;
  }

  /** Dalgaya sayılan canlılar (yuva nişancısı dalgadan sayılmaz). */
  get aliveCount() {
    return this.enemies.filter((e) => e.alive && !e.nest).length;
  }

  /**
   * Sandık yuvasının nişancısı: dalgadan bağımsız, yerinde sabit düşman.
   * Öldürülünce yuvanın M2'si oyuncuya kalır.
   */
  addNestGunner(nest, opts) {
    const e = new Enemy('runner', 1, this.gear, this.soldierFactory);
    e.nest = { ...opts, mg: nest.mg, seat: nest.seat, baseYaw: nest.baseYaw };
    e.maxHp = e.hp = opts.hp;
    e.scoreValue = 400;
    e.nextShot = performance.now() / 1000 + 3;
    e.pos.copy(nest.seat);
    e.facing = nest.baseYaw;
    e.group.position.copy(e.pos);
    e.group.rotation.y = e.facing;
    // Kendi tüfeği görünmez: elleri M2'nin tutamaklarında
    if (e.soldier?.rifle) e.soldier.rifle.visible = false;
    this.scene.add(e.group);
    if (this.physics) {
      e.body = this.physics.addKinematicCapsule(0.45, 2);
      this.physics.moveKinematic(e.body, e.pos.x, e.pos.y + 1, e.pos.z);
    }
    this.enemies.push(e);
    nest.gunner = e;
    return e;
  }

  /**
   * Baskın: cam kıran düşman için hedef cam. Görüş hattındaki ilk engel
   * camın kendisiyse (arada duvar yoksa) ve 40 m içindeyse seçilir.
   */
  _pickGlass(e) {
    let best = null, bd = 40;
    const eye = new THREE.Vector3(e.pos.x, e.pos.y + 1.45, e.pos.z);
    for (const g of this.glassList ?? []) {
      if (g.broken || !g.blocking) continue;
      const d = eye.distanceTo(g.center);
      if (d >= bd) continue;
      const dir = g.center.clone().sub(eye).normalize();
      this._ray.set(eye, dir);
      this._ray.far = d + 0.2;
      const first = this._ray.intersectObjects(this.arena.solids, false)[0];
      if (first?.object !== g.pane) continue;
      bd = d;
      best = g;
    }
    return best;
  }

  get remaining() {
    return this.aliveCount + this.pending;
  }

  reset() {
    for (const e of this.dying) this.scene.remove(e.group);
    this.dying = [];
    for (const c of this.corpses) {
      this.scene.remove(c.pivot);
      this.physics?.remove(c.body);
    }
    this.corpses = [];
    for (const e of this.enemies) {
      if (e.body) this.physics?.remove(e.body);
      e.dispose(this.scene);
    }
    this.enemies = [];
    this.wave = 0;
    this.pending = 0;
    this.state = 'idle';
    for (const p of this.projectiles) { p.life = 0; p.mesh.visible = false; }
  }

  /** Dalga kompozisyonu: ilerledikçe ağır ve menzilli tipler karışır. */
  _composition(wave) {
    const total = this.raid
      ? this.raid.waves[Math.min(wave, this.raid.waves.length) - 1]
      : Math.round(4 + wave * 1.7);
    const list = [];
    for (let i = 0; i < total; i++) {
      const r = Math.random();
      if (wave >= 4 && r < Math.min(0.22, 0.05 + wave * 0.015)) list.push('brute');
      else if (wave >= 2 && r < Math.min(0.55, 0.15 + wave * 0.03)) list.push('spitter');
      else list.push('runner');
    }
    return list;
  }

  startWave(wave) {
    this.wave = wave;
    this.queue = this._composition(wave);
    this.pending = this.queue.length;
    this.waveTotal = this.queue.length;
    this.state = 'spawning';
    this.spawnInterval = this.raid ? 0.55 : Math.max(0.28, 1.1 - wave * 0.05);
    this.nextSpawn = performance.now() / 1000 + 0.8;
    this.audio.waveStart();
    this.onWaveStart?.(wave, this.waveTotal);
  }

  _spawnOne(type, player) {
    const e = new Enemy(type, this.wave, this.gear, this.soldierFactory);
    // Baskında saldırganların ~%45'i camları kırmaya çalışır
    if (this.raid) e.breaker = Math.random() < 0.45;

    // Oyuncudan belirli uzaklıkta, yüklü bir sektörde doğsun.
    const r = this.raid;
    const pick = r
      ? this.world.spawnPoint(r.center, r.minR, r.maxR)
      : this.world.spawnPoint(player.pos);
    e.pos.copy(pick);
    e.group.position.copy(e.pos);
    this.scene.add(e.group);

    // Fizik dünyasında kinematik temsilci: el bombası ve savrulan variller
    // düşmanlara çarpabilsin.
    if (this.physics) {
      e.body = this.physics.addKinematicCapsule(0.45 * e.def.scale, 2 * e.def.scale);
      this.physics.moveKinematic(e.body, e.pos.x, e.pos.y + e.def.scale, e.pos.z);
    }

    this.enemies.push(e);
  }

  /**
   * Düşman ateşi ANINDA çözülür (hitscan): mermi havada yol almaz, tetik
   * çekildiği an isabet ya da ıska belli olur — tıpkı oyuncunun silahları
   * gibi. Görsel olarak yalnızca izli mermi çizilir.
   * @param target oyuncu ya da müttefik asker
   */
  _fireProjectile(enemy, target) {
    const mg = enemy.nest?.mg;
    if (mg) {
      mg.fireFx?.();
      this.audio.shot({ body: 62, crack: 1500, length: 0.34, punch: 1 });
    } else {
      enemy.fireFlash();
      this.audio.shot({ body: 140, crack: 2500, length: 0.15, punch: 0.4 });
    }

    const from = mg ? mg.muzzle.getWorldPosition(new THREE.Vector3()) : enemy.muzzleWorld;
    const to = (target.eyePosition ?? target.center).clone();

    // Nişan hatası: mesafeyle büyüyen sapma (her atış tutmasın); M2 sehpada
    // daha isabetli ama uzun seride açılır
    const dist = from.distanceTo(to);
    const spread = mg ? 0.012 + dist * 0.0006 + mg.heat * 0.012 : 0.035 + dist * 0.004;
    to.x += (Math.random() - 0.5) * spread * dist;
    to.y += (Math.random() - 0.5) * spread * dist * 0.6;
    to.z += (Math.random() - 0.5) * spread * dist;

    const dir = to.clone().sub(from).normalize();
    this.effects.tracer(from, from.clone().addScaledVector(dir, dist), mg ? 0xffa040 : 0xff9a5c);
    const damage = mg ? enemy.nest.damage : (enemy.def.shootDamage ?? enemy.damage);

    // Arada duvar/sandık varsa mermi oraya saplanır
    this._ray.set(from, dir);
    this._ray.far = dist;
    const blocked = this._ray.intersectObjects(this.arena.solids, false)[0];
    if (blocked) {
      // Kurşun geçirmez cam gibi hasar alan engeller
      if (blocked.object.userData?.glass || blocked.object.userData?.vehicle) {
        // Cam kıranın mermisi cama iki kat işler (zırh delici)
        const k = target.glass && blocked.object === target.glass.pane ? 2 : 1;
        this.onBlocked?.(blocked.object, damage * k, blocked.point);
        return;
      }
      this.effects.sparks(blocked.point, new THREE.Vector3(0, 1, 0), 0xffc06a, 6);
      return;
    }
    if (target.glass) return;          // cam hedefi: açık camdan geçen mermi boşa

    // İsabet yarıçapı: hedefin gövdesine yeterince yakınsa vurur
    const hedefMerkez = target.eyePosition ?? target.center;
    const sapma = hedefMerkez.distanceTo(to);
    if (sapma < 0.55) {
      if (target.eyePosition) {
        // Merminin geldiği yükseklik göz hizasına yakınsa KAFA sayılır:
        // kaskın bir işe yaraması için bölge bilgisi gerekiyor.
        const bolge = to.y > hedefMerkez.y - 0.12 ? 'head' : 'body';
        this.onPlayerHit?.(damage, bolge, enemy);
      } else {
        this.onAllyHit?.(target, damage, enemy);
      }
    }
  }

  update(dt, now, player) {
    // ── Doğma ──────────────────────────────────────────────────────────
    // Baskında aynı anda sahada olan düşman sınırlı: 30 kişilik dalga
    // birden doğsa hem kare hızı düşer hem ev ilk saniyede çiğnenir.
    const room = !this.raid || this.aliveCount < this.raid.maxAlive;
    if (this.state === 'spawning' && this.queue.length && now >= this.nextSpawn && room) {
      this._spawnOne(this.queue.shift(), player);
      this.pending = this.queue.length;
      this.nextSpawn = now + this.spawnInterval;
      if (!this.queue.length) this.state = 'fighting';
    }

    // ── Düşmanlar ──────────────────────────────────────────────────────
    for (const e of this.enemies) {
      if (!e.alive) continue;
      // Hedef: oyuncu ya da daha yakın bir müttefik asker
      let hedef = player;
      let hedefMesafe = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
      // Yerdeki ağır yaralı oyuncu ÖNCELİKLİ hedef: düşman işini bitirmeye
      // çalışır (tek isabet ölümcül) — siper alıp saklanmak gerekir
      if (player.downed) hedefMesafe *= 0.5;
      for (const ally of this.allies ?? []) {
        if (!ally.alive || ally.aboard) continue;
        const d = Math.hypot(ally.pos.x - e.pos.x, ally.pos.z - e.pos.z);
        if (d < hedefMesafe * 0.8) { hedefMesafe = d; hedef = ally; }
      }
      // Baskın: cam kıranlar evin kapalı camlarını hedef alır (oyuncu
      // dibindeyse yine oyuncuya döner). Hedef cam 1.5 sn'de bir yenilenir.
      if (e.breaker && this.raid && !e.nest) {
        if (now >= (e.nextGlassThink ?? 0)) {
          e.nextGlassThink = now + 1.5;
          e.glassTarget = this._pickGlass(e);
        }
        const g = e.glassTarget;
        if (g && !g.broken && g.blocking && hedefMesafe > 9) {
          // Camın 1 m dışına yürür; ateş edilecek nokta cam merkezi
          const out = g.alongX ? new THREE.Vector3(0, 0, Math.sign(e.pos.z - g.center.z) || 1)
            : new THREE.Vector3(Math.sign(e.pos.x - g.center.x) || 1, 0, 0);
          hedef = { pos: g.center.clone().addScaledVector(out, 1).setY(0), center: g.center, glass: g };
        }
      }
      e.currentTarget = hedef;

      e.update(dt, now, hedef, this.arena, (enemy, dist, mode) => {
        if (mode === 'shoot' || mode === 'mg') this._fireProjectile(enemy, hedef);
        // Camın dibine gelen dipçikle vurur
        else if (hedef.glass) this.onBlocked?.(hedef.glass.pane, enemy.damage * 3, hedef.center.clone());
        else if (hedef === player) this.onPlayerHit?.(enemy.damage, 'body', enemy);
        else this.onAllyHit?.(hedef, enemy.damage, enemy);
      }, this.world, Boolean(this.raid));
      if (e.body) this.physics.moveKinematic(e.body, e.pos.x, e.pos.y + e.def.scale, e.pos.z);
    }

    // Düşmanlar birbirinin içine girmesin (basit itme)
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (!b.alive || a.nest || b.nest) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const minD = 0.75 * (a.def.scale + b.def.scale);
        const d2 = dx * dx + dz * dz;
        if (d2 > minD * minD || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (minD - d) / 2;
        const nx = dx / d, nz = dz / d;
        a.pos.x -= nx * push; a.pos.z -= nz * push;
        b.pos.x += nx * push; b.pos.z += nz * push;
      }
    }

    // ── Mermiler ───────────────────────────────────────────────────────
    for (const p of this.projectiles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.y -= 2.4 * dt;

      // Müttefiklere isabet
      let carpti = false;
      for (const ally of this.allies ?? []) {
        if (!ally.alive) continue;
        if (p.mesh.position.distanceTo(ally.center) < 0.8) {
          this.onAllyHit?.(ally, p.damage, null);
          this.effects.hitBurst(p.mesh.position, 0x6fe2a8, 10);
          p.life = 0;
          carpti = true;
          break;
        }
      }
      if (carpti) { p.mesh.visible = false; continue; }

      const eye = player.eyePosition;
      if (p.mesh.position.distanceTo(eye) < 0.75) {
        this.onPlayerHit?.(p.damage, 'body', null);
        this.effects.hitBurst(p.mesh.position, 0x6fe2a8, 14);
        p.life = 0;
      } else if (p.mesh.position.y < 0.1 || !this.arena.inBounds(p.mesh.position.x, p.mesh.position.z, 0.2)) {
        this.effects.sparks(p.mesh.position, new THREE.Vector3(0, 1, 0), 0x6fe2a8, 8);
        p.life = 0;
      }
      if (p.life <= 0) p.mesh.visible = false;
    }

    // ── Yığılan askerler ───────────────────────────────────────────────
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const e = this.dying[i];
      e.soldier.update({ dt, speed: 0, crouching: false, downed: false, dying: true, aimPitch: 0 });
      if (now > e.removeAt) {
        this.scene.remove(e.group);
        this.dying.splice(i, 1);
      }
    }

    // ── Cesetler: süresi dolanlar kaldırılır ───────────────────────────
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      if (now < c.until) continue;
      this.scene.remove(c.pivot);
      this.physics.remove(c.body);
      this.corpses.splice(i, 1);
    }

    // ── Dalga bitti mi ─────────────────────────────────────────────────
    if (this.state === 'fighting' && this.aliveCount === 0) {
      this.state = 'break';
      this.breakEnd = now + (this.raid ? 10 : 7);
      this.onWaveClear?.(this.wave, now);
    }

    // Ölüleri temizle
    if (this.enemies.length > 0) {
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (!e.alive && e.removeAt && (e.dying || now > e.removeAt)) {
          // Gövde ya yığılma listesine ya da fizikli cesede devredildi;
          // düşman listesinden çıkar.
          this.enemies.splice(i, 1);
        }
      }
    }
  }

  /**
   * Patlama alan hasarı.
   * @param source  ölüm kaynağı etiketi ({ grenade: true } gibi) — görev
   *                sayacı doğru çalışsın diye ölümden ÖNCE işaretlenir.
   * @returns {Array} ölen düşmanlar
   */
  damageArea(center, radius, maxDamage, now, source = { grenade: true }) {
    const killed = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.center.distanceTo(center);
      if (d >= radius) continue;
      const k = 1 - d / radius;
      const dead = e.hurt(maxDamage * k * k);
      this.effects.hitBurst(e.center, 0xffa23c, 10);
      if (dead) {
        e._killedBy = source;
        // Patlamadan kaçacak şekilde devrilsin
        const away = e.center.clone().sub(center).setY(0).normalize();
        this.kill(e, now, away);
        killed.push(e);
      }
    }
    return killed;
  }

  kill(enemy, now, impactDir = null) {
    enemy.alive = false;
    enemy.removeAt = now + 0.05;
    if (enemy.body) { this.physics?.remove(enemy.body); enemy.body = null; }

    this.effects.hitBurst(enemy.center, enemy.def.eye, 16);
    this.audio.enemyDeath();

    if (enemy.soldier) {
      // Asker modeli: kutu gibi devrilmek yerine dizleri bükülerek yığılır.
      enemy.dying = true;
      enemy.removeAt = now + 12;
      this.dying.push(enemy);
    } else {
      this._makeCorpse(enemy, now, impactDir);
    }
    this.onKill?.(enemy);
  }

  /* ── Fizikli ceset ─────────────────────────────────────────────────── */

  /** Askerin gövdesini dinamik bir cisme bağlar: vurulduğu yöne devrilir. */
  _makeCorpse(enemy, now, impactDir) {
    if (!this.physics) { enemy.group.visible = false; return; }

    const s = enemy.def.scale;
    const halfH = 1.0 * s;

    // Gövde grubunu, kütle merkezi orijinde olan bir pivota taşı
    const pivot = new THREE.Group();
    pivot.position.set(enemy.pos.x, halfH, enemy.pos.z);
    pivot.rotation.y = enemy.facing;
    enemy.group.position.set(0, -halfH, 0);
    enemy.group.rotation.set(0, 0, 0);
    pivot.add(enemy.group);
    this.scene.add(pivot);

    const body = this.physics.addDynamicBox(
      pivot,
      { x: 0.8 * s, y: 2 * s, z: 0.55 * s },
      68 * s,
    );
    body.angularDamping = 0.22;
    // Pivot zaten kendi dönüşünü taşıyor; fizik gövdesine de aktar
    body.quaternion.setFromEuler(0, enemy.facing, 0);

    // Vuruşun geldiği yöne devril
    const d = impactDir ?? new THREE.Vector3(0, 0, 1);
    this.physics.impulse(
      body,
      d.x * 55 * s, 26 * s, d.z * 55 * s,
      0, halfH * 0.7, 0,
    );

    this.corpses.push({ pivot, body, until: now + 14 });
  }
}
