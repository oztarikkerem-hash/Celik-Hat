/* Birinci şahıs oyuncu: hareket, çarpışma, zıplama, çömelme, sağlık.
   Çarpışma modeli: yarıçapı sabit dikey silindir ↔ AABB listesi.          */

import * as THREE from 'three';

const RADIUS = 0.38;
const HEIGHT = 1.8;
const EYE = 1.66;
const EYE_CROUCH = 1.1;
const EYE_DOWNED = 0.55;         // ağır yaralı: yerde yarı uzanmış
const GRAVITY = 24;
const JUMP_V = 8.2;

export class Player {
  constructor(camera, arena) {
    this.camera = camera;
    this.arena = arena;

    this.pos = new THREE.Vector3(0, 0, 14);     // ayak konumu
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;                          // arenanın merkezine bak
    this.pitch = 0;

    this.onGround = true;
    this.crouching = false;
    this.sprinting = false;
    this.eye = EYE;

    this.maxHealth = 100;
    this.gearSpeed = 1;                   // mağazadan gelen hız çarpanı
    this.gearStamina = 1;                 // ağır zırh nefesi çabuk tüketir
    this.health = 100;
    this.lastHurt = -99;

    // Yorgunluk: 6 saniye kesintisiz koşuda biter, bıraktıktan 1 saniye
    // sonra dolmaya başlar ve 5 saniyede tamamen dolar. Tamamen bitince
    // "tükenmiş" olursun: %30'a kadar dolmadan tekrar koşamazsın.
    this.stamina = 1;
    this.exhausted = false;
    this.lastSprint = -99;
    this.sprintDrain = 1 / 6;
    this.sprintRegen = 1 / 5;
    this.regenDelay = 1;

    this.speedWalk = 5.6;
    this.speedSprint = 9.0;
    this.speedCrouch = 2.8;

    // Kamera sarsıntıları
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this._shake = 0;
    this._bobPhase = 0;
    this._landDip = 0;

    this.alive = true;
    this.distanceWalked = 0;

    // Ağır yaralı: can bitince yere düşülür (game.js yönetir). Ayağa
    // kalkınca can `healthCap`'te (25) sınırlı kalır; sargı bezi + ilk
    // yardım kitiyle sınır kalkar. treatStage: 0 sargı bekliyor, 1 kit.
    this.downed = false;
    this.healthCap = this.maxHealth;
    this.treatStage = 0;
  }

  get wounded() { return this.healthCap < this.maxHealth; }

  reset() {
    this.pos.set(0, 0, 14);
    this.vel.set(0, 0, 0);
    this.yaw = Math.PI;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.downed = false;
    this.healthCap = this.maxHealth;
    this.treatStage = 0;
    this.stamina = 1;
    this.exhausted = false;
    this.lastSprint = -99;
    this.alive = true;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this._shake = 0;
  }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.5, 1.5);
  }

  addRecoil(pitchDeg, yawDeg = 0) {
    this.recoilPitch += pitchDeg * Math.PI / 180;
    this.recoilYaw += yawDeg * Math.PI / 180;
  }

  shake(amount) {
    this._shake = Math.min(1, this._shake + amount);
  }

  /** Mağazadan kuşanılan teçhizatın etkilerini uygular. */
  setGear({ hiz = 1, staminaCarpan = 1 } = {}) {
    this.gearSpeed = hiz;
    this.gearStamina = staminaCarpan;
  }

  damage(amount) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    this.lastHurt = performance.now() / 1000;
    this.shake(0.5);
    if (this.health <= 0) this.alive = false;
  }

  heal(amount) {
    this.health = Math.min(this.healthCap, this.health + amount);
  }

  get eyePosition() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eye, this.pos.z);
  }

  /** input: { forward, right, jump, sprint, crouch }, ads: nişan alıyor mu */
  update(dt, input, ads, carryWeight = 0) {
    const now = performance.now() / 1000;

    // ── Hız ────────────────────────────────────────────────────────────
    this.crouching = input.crouch && this.onGround;
    const moving = input.forward !== 0 || input.right !== 0;
    const canSprint = !this.exhausted && this.stamina > 0.02;
    // Gerçekten ilerliyor muyuz? Duvara dayanmış koşmak yorgunluk yakmasın.
    const advancing = Math.hypot(this.vel.x, this.vel.z) > 2;
    const wantsSprint = input.sprint && !this.crouching && !ads && moving && canSprint;
    this.sprinting = wantsSprint;

    // Taşınan yük: ağır silahla hareket ederken nefes yavaşça erir,
    // durunca yavaşça toparlanır. Yorgunluk dolumuyla aynı hesapta yer
    // alır — yoksa dolum yükü ezer ve ağırlık hiç hissedilmez.
    const carry = carryWeight * (moving ? 1 : 0.5);

    if (wantsSprint && advancing) {
      this.lastSprint = now;
      this.stamina -= dt * (this.sprintDrain * this.gearStamina + carry);
    } else if (now - this.lastSprint > this.regenDelay) {
      this.stamina += dt * (this.sprintRegen - carry);
    } else if (carry > 0) {
      this.stamina -= dt * carry;          // koşu sonrası bekleme payında
    }

    this.stamina = THREE.MathUtils.clamp(this.stamina, 0, 1);
    if (this.stamina <= 0) this.exhausted = true;
    else if (this.exhausted && this.stamina > 0.3) this.exhausted = false;

    let speed = this.crouching ? this.speedCrouch
      : this.sprinting ? this.speedSprint : this.speedWalk;
    if (ads) speed *= 0.55;
    speed *= this.gearSpeed;              // zırh ağırlığı (mağaza)

    // Yön: bakış açısına göre
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = input.right * cos - input.forward * sin;
    const wishZ = -input.right * sin - input.forward * cos;
    const wish = new THREE.Vector3(wishX, 0, wishZ);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    // Yerde keskin, havada süzülen kontrol
    const accel = this.onGround ? 14 : 3.2;
    this.vel.x = THREE.MathUtils.lerp(this.vel.x, wish.x, Math.min(1, dt * accel));
    this.vel.z = THREE.MathUtils.lerp(this.vel.z, wish.z, Math.min(1, dt * accel));

    if (input.jump && this.onGround) {
      this.vel.y = JUMP_V;
      this.onGround = false;
    }

    this.vel.y -= GRAVITY * dt;

    const before = this.pos.clone();

    // ── Yatay hareket + çarpışma ───────────────────────────────────────
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this._resolveHorizontal();

    // Arena sınırları
    const lim = this.arena.half - 1.2;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -lim, lim);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -lim, lim);

    // ── Düşey hareket + zemin ──────────────────────────────────────────
    this.pos.y += this.vel.y * dt;
    const groundY = this._groundHeight();

    if (this.pos.y <= groundY) {
      if (this.vel.y < -7) {
        this._landDip = Math.min(0.22, -this.vel.y * 0.014);
        this.shake(Math.min(0.5, -this.vel.y * 0.035));
      }
      this.pos.y = groundY;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
      // Tavan/kutu altına çarpma
      const ceil = this._ceilingHeight();
      if (this.pos.y + HEIGHT > ceil) {
        this.pos.y = ceil - HEIGHT;
        this.vel.y = Math.min(this.vel.y, 0);
      }
    }

    this.distanceWalked += before.distanceTo(this.pos);

    // ── Kamera ─────────────────────────────────────────────────────────
    const targetEye = this.downed ? EYE_DOWNED : this.crouching ? EYE_CROUCH : EYE;
    // Yere yığılma yavaş, doğrulma ve çömelme hızlı
    this.eye = THREE.MathUtils.lerp(this.eye, targetEye, Math.min(1, dt * (this.downed ? 3.5 : 11)));

    // Geri tepme toparlanması
    this.recoilPitch *= Math.pow(0.0025, dt);
    this.recoilYaw *= Math.pow(0.0025, dt);
    this._shake *= Math.pow(0.02, dt);
    this._landDip *= Math.pow(0.004, dt);

    const horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    this._bobPhase += dt * (6 + horizSpeed * 1.1);
    const bobAmp = this.onGround ? Math.min(horizSpeed / this.speedSprint, 1) * (ads ? 0.012 : 0.035) : 0;

    const shakeX = (Math.random() - 0.5) * this._shake * 0.07;
    const shakeY = (Math.random() - 0.5) * this._shake * 0.07;

    this.camera.position.set(
      this.pos.x + Math.cos(this._bobPhase) * bobAmp * 0.35 + shakeX,
      this.pos.y + this.eye + Math.sin(this._bobPhase * 2) * bobAmp - this._landDip + shakeY,
      this.pos.z,
    );

    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw + this.recoilYaw);
    this.camera.rotateX(this.pitch + this.recoilPitch);
    // Koşarken hafif yana yatma
    this.camera.rotateZ(Math.cos(this._bobPhase) * bobAmp * 0.5);

    // Hasar sonrası yavaş yenilenme
    if (this.alive && !this.downed && now - this.lastHurt > 6 && this.health < this.healthCap) {
      this.heal(dt * 6);
    }
  }

  _resolveHorizontal() {
    const feet = this.pos.y;
    const head = this.pos.y + (this.crouching ? HEIGHT * 0.65 : HEIGHT);

    for (const box of this.arena.colliders) {
      // Düşey örtüşme yoksa çarpışma yok (kutunun üstünde olabiliriz)
      if (box.max.y <= feet + 0.25 || box.min.y >= head) continue;

      const minX = box.min.x - RADIUS, maxX = box.max.x + RADIUS;
      const minZ = box.min.z - RADIUS, maxZ = box.max.z + RADIUS;
      if (this.pos.x < minX || this.pos.x > maxX || this.pos.z < minZ || this.pos.z > maxZ) continue;

      // En küçük itme yönünü seç
      const pushLeft = this.pos.x - minX;
      const pushRight = maxX - this.pos.x;
      const pushBack = this.pos.z - minZ;
      const pushFwd = maxZ - this.pos.z;
      const m = Math.min(pushLeft, pushRight, pushBack, pushFwd);

      let nx = 0, nz = 0;
      if (m === pushLeft) { this.pos.x = minX; this.vel.x = Math.min(this.vel.x, 0); nx = -1; }
      else if (m === pushRight) { this.pos.x = maxX; this.vel.x = Math.max(this.vel.x, 0); nx = 1; }
      else if (m === pushBack) { this.pos.z = minZ; this.vel.z = Math.min(this.vel.z, 0); nz = -1; }
      else { this.pos.z = maxZ; this.vel.z = Math.max(this.vel.z, 0); nz = 1; }

      // Devrilebilen eşyaysa (varil, sandık) itilir — duvar gibi davranmaz.
      this.arena.pushProp?.(box, -nx, -nz, this.sprinting ? 4.2 : 2.4);
    }
  }

  _groundHeight() {
    let best = 0;
    const r = RADIUS * 0.9;
    for (const box of this.arena.colliders) {
      if (box.max.y > this.pos.y + 0.6) continue;      // üstüne çıkamayacağımız kadar yüksek
      if (this.pos.x < box.min.x - r || this.pos.x > box.max.x + r) continue;
      if (this.pos.z < box.min.z - r || this.pos.z > box.max.z + r) continue;
      if (box.max.y > best) best = box.max.y;
    }
    return best;
  }

  _ceilingHeight() {
    let best = Infinity;
    const r = RADIUS * 0.9;
    const head = this.pos.y + HEIGHT;
    for (const box of this.arena.colliders) {
      if (box.min.y < head - 0.3) continue;
      if (this.pos.x < box.min.x - r || this.pos.x > box.max.x + r) continue;
      if (this.pos.z < box.min.z - r || this.pos.z > box.max.z + r) continue;
      if (box.min.y < best) best = box.min.y;
    }
    return best;
  }
}
