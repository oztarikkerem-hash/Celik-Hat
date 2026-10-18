/* Zırhlı personel taşıyıcı (özgün model: apc.js).

   Oyuncu yanına gelip F'ye basınca sürücü koltuğuna geçer; çevredeki silah
   arkadaşları da araca biner. Biri kuledeki ağır makineliye geçer ve
   yakındaki düşmana kendiliğinden ateş eder. Araç zırhlıdır: içindekiler
   vurulmaz, mermiler gövdeye saplanır ve aracın zırhını aşındırır; zırh
   biterse araç patlar, herkes dışarı fırlar.

   Sürüş basit bir bisiklet modeliyle: hız ileri yönde, dönüş hızı
   direksiyon açısı ve hızla orantılı. Çarpışma için gövde boyunca üç daire
   dünyadaki kutulara karşı itilir; devrilebilen eşyalar savrulur. Hızlı
   giden araç önüne çıkan düşmanı ezer.

   Model ön tarafı +X'e bakar. Kök dönüşü yaw iken ileri yön
   (cos yaw, 0, −sin yaw).                                                  */

import * as THREE from 'three';
import { buildAPC, camoFor } from './apc.js';
const MAX_HP = 2500;
const VMAX = 17;               // m/sn (~60 km/sa)
const VREV = 6;
const ACCEL = 6.5;
const BRAKE = 16;
const DRAG = 1.8;
const STEER_MAX = 0.5;
const WHEELBASE = 2.9;
const WHEEL_R = 0.65;
const BODY = [-2.1, 0, 2.1];   // çarpışma daireleri (gövde ekseni boyunca)
const BODY_R = 1.35;
const BOARD_RANGE = 30;
const ENTER_RANGE = 4.2;
const TURRET = { range: 70, rate: 0.13, damage: 55, turn: 2.4 };

const _v = new THREE.Vector3();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Vehicles {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.list = [];
    this.template = null;
    this.ready = false;
    this.driving = null;          // oyuncunun sürdüğü araç
    this._ray = new THREE.Raycaster();
  }

  /** Model kodla kurulur (apc.js); yüklenecek dosya yok. */
  async load() {
    this.ready = true;
  }

  /* ── Kurulum ──────────────────────────────────────────────────────── */

  /** Bütün araçları kaldırır (yeni tur). Oyuncunun konumuna dokunmaz. */
  clear() {
    this.driving = null;
    for (const v of this.list) {
      for (const a of v.riders) { a.aboard = null; a.root.visible = true; }
      this.scene.remove(v.root);
      this.game.world.removeFixture(v.fixture);
    }
    this.list = [];
  }

  /** Oyuncunun yakınında, boş bir yere araç bırakır. */
  spawnNear(pos, facing, map = null) {
    if (!this.ready) return null;
    const world = this.game.world;
    for (let i = 0; i < 24; i++) {
      const a = facing + Math.PI / 2 + (i % 2 ? 1 : -1) * Math.floor(i / 2) * 0.45;
      const r = 7 + (i % 3) * 3;
      const p = new THREE.Vector3(pos.x + Math.cos(a) * r, 0, pos.z - Math.sin(a) * r);
      if (!world.inBounds(p.x, p.z, 6)) continue;
      const box = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(p.x, 1, p.z), new THREE.Vector3(6.6, 2, 6.6),
      );
      if (world.colliders.some((b) => b.max.y > 0.4 && b.intersectsBox(box))) continue;
      return this.spawn(p, facing, map);
    }
    return null;
  }

  /** map: kamuflaj paleti alanın zeminine göre seçilir. */
  spawn(pos, yaw, map = null) {
    const root = buildAPC(camoFor(map));
    root.position.copy(pos);
    root.rotation.y = yaw;
    root.updateMatrixWorld(true);

    // Düğüm kökenleri araç merkezinde (FBX); dönen parçalar kendi
    // merkezlerindeki bir pivota alınır.
    const pivotAt = (node) => {
      if (!node) return null;
      const c = node.getWorldPosition(new THREE.Vector3());
      const pivot = new THREE.Group();
      node.parent.add(pivot);
      pivot.position.copy(node.parent.worldToLocal(c.clone()));
      pivot.updateMatrixWorld(true);
      return { pivot, center: c };
    };

    const wheels = [];
    for (const name of ['wheel', 'wheel2', 'wheel3', 'wheel4']) {
      const node = root.getObjectByName(name);
      if (!node) continue;
      const steer = pivotAt(node);
      const spin = new THREE.Group();
      steer.pivot.add(spin);
      spin.attach(node);
      const local = root.worldToLocal(steer.center.clone());
      wheels.push({ steer: steer.pivot, spin, front: local.x > 0 });
    }

    const turretNode = root.getObjectByName('turret');
    let turret = null;
    if (turretNode) {
      const t = pivotAt(turretNode);
      t.pivot.attach(turretNode);
      turret = t.pivot;
    }

    // Mermilerin saplanacağı gövde (raycast) + çarpışma kutusu
    const solids = [];
    root.traverse((o) => { if (o.isMesh && !/glass|antenna/i.test(o.name)) solids.push(o); });
    const v = {
      root, pos: root.position, yaw, speed: 0, steer: 0, hp: MAX_HP, dead: false,
      wheels, turret, turretYaw: 0,
      muzzle: root.getObjectByName('weapon_muzzle'),
      gunnerSpot: root.getObjectByName('gunner_a'),
      hull: root.getObjectByName('hull'),
      door: root.getObjectByName('hatch6'),
      exhaust: root.getObjectByName('exhaust'),
      exits: ['groundpoint', 'groundpoint4', 'groundpoint5', 'groundpoint2', 'groundpoint6']
        .map((n) => root.getObjectByName(n)).filter(Boolean),
      box: new THREE.Box3(),
      riders: [], gunner: null, nextShot: 0, target: null, nextThink: 0,
    };
    for (const m of solids) m.userData = { ...m.userData, vehicle: v };
    v.fixture = { colliders: [v.box], solids, cover: [] };
    this._updateBox(v);
    this.game.world.addFixture(v.fixture);
    this.scene.add(root);
    this.list.push(v);
    return v;
  }

  /** Dönük gövdeyi kapsayan eksen hizalı kutu (6.1 × 2.6 m). */
  _updateBox(v) {
    const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
    const hx = 3.05, hz = 1.3;
    const ex = Math.abs(c) * hx + Math.abs(s) * hz;
    const ez = Math.abs(s) * hx + Math.abs(c) * hz;
    v.box.min.set(v.pos.x - ex, 0, v.pos.z - ez);
    v.box.max.set(v.pos.x + ex, 2.2, v.pos.z + ez);
  }

  forward(v) { return _v.set(Math.cos(v.yaw), 0, -Math.sin(v.yaw)); }

  /* ── Binme / inme ─────────────────────────────────────────────────── */

  nearby(pos) {
    let best = null, bd = ENTER_RANGE;
    for (const v of this.list) {
      if (v.dead) continue;
      const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  enter(v) {
    const g = this.game;
    this.driving = v;
    // Kamera aracın arkasından baksın
    g.player.yaw = v.yaw - Math.PI / 2;
    g.player.pitch = -0.18;
    // Yakındaki silah arkadaşları biner; ilki kuledeki makineliye geçer
    v.riders = [];
    for (const a of g.allies.allies) {
      if (!a.alive || a.downed) continue;
      if (Math.hypot(a.pos.x - v.pos.x, a.pos.z - v.pos.z) > BOARD_RANGE) continue;
      a.aboard = v;
      a.root.visible = false;
      if (a.cover) { a.cover.taken = null; a.cover = null; }
      v.riders.push(a);
    }
    v.gunner = v.riders[0] ?? null;
    if (v.gunner) v.gunner.root.visible = true;
    g.audio.swap();
  }

  exit() {
    const v = this.driving;
    if (!v) return;
    this.driving = null;
    v.speed = 0;
    const g = this.game;
    v.root.updateMatrixWorld(true);
    const spots = v.exits.map((e) => e.getWorldPosition(new THREE.Vector3()));
    const door = spots[0] ?? v.pos.clone().add(new THREE.Vector3(0, 0, 2.4));
    g.player.pos.set(door.x, 0, door.z);
    g.player.vel.set(0, 0, 0);
    v.riders.forEach((a, i) => {
      const p = spots[(i + 1) % Math.max(1, spots.length)] ?? door;
      a.aboard = null;
      a.root.visible = true;
      a.pos.set(p.x + (Math.random() - 0.5), 0, p.z + (Math.random() - 0.5));
      a.vel.set(0, 0, 0);
    });
    v.riders = [];
    v.gunner = null;
  }

  /* ── Sürüş ────────────────────────────────────────────────────────── */

  /** Oyuncu sürerken her kare: girdi, hareket, çarpışma, kamera. */
  drive(dt, now, input) {
    const v = this.driving;
    if (!v) return;
    const g = this.game;

    const thr = input.forward;
    if (thr > 0) v.speed += (v.speed < 0 ? BRAKE : ACCEL) * dt;
    else if (thr < 0) v.speed -= (v.speed > 0 ? BRAKE : ACCEL * 0.7) * dt;
    else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), DRAG * dt);
    if (input.jump) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), BRAKE * dt);
    v.speed = THREE.MathUtils.clamp(v.speed, -VREV, VMAX);

    // Hızlanınca direksiyon kısılır (yüksek hızda keskin dönüş takla attırır)
    const steerMax = STEER_MAX * (1 - 0.6 * Math.min(1, Math.abs(v.speed) / VMAX));
    const want = -input.right * steerMax;
    v.steer += (want - v.steer) * Math.min(1, dt * 5);
    v.yaw += (v.speed / WHEELBASE) * Math.tan(v.steer) * dt;

    const fwd = this.forward(v);
    v.pos.addScaledVector(fwd, v.speed * dt);
    this._collide(v, now);
    const lim = g.world.half - 3.5;
    v.pos.x = THREE.MathUtils.clamp(v.pos.x, -lim, lim);
    v.pos.z = THREE.MathUtils.clamp(v.pos.z, -lim, lim);

    // Oyuncu aracın içinde (dünya akışı ve düşman hedefi için)
    g.player.pos.set(v.pos.x, 0, v.pos.z);
    g.player.vel.set(fwd.x * v.speed, 0, fwd.z * v.speed);

    // Takip kamerası: fareyle aracın çevresinde döner
    g.player.pitch = THREE.MathUtils.clamp(g.player.pitch, -0.7, 0.25);
    const yaw = g.player.yaw, pitch = g.player.pitch;
    const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const focus = new THREE.Vector3(v.pos.x, 2.1, v.pos.z);
    const cam = g.camera;
    cam.position.copy(focus).addScaledVector(dir, -9.5);
    cam.position.y = Math.max(0.8, cam.position.y + 1.2);
    cam.rotation.set(0, 0, 0);
    cam.rotateY(yaw);
    cam.rotateX(pitch);
  }

  /** Gövde daireleri ↔ dünya kutuları; eşyalar itilir, düşman ezilir. */
  _collide(v, now) {
    const world = this.game.world;
    const fwd = this.forward(v).clone();
    for (const off of BODY) {
      const cx = v.pos.x + fwd.x * off, cz = v.pos.z + fwd.z * off;
      for (const box of world.colliders) {
        if (box === v.box || box.max.y < 0.5 || box.min.y > 2) continue;
        const px = THREE.MathUtils.clamp(cx, box.min.x, box.max.x);
        const pz = THREE.MathUtils.clamp(cz, box.min.z, box.max.z);
        const dx = cx - px, dz = cz - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= BODY_R * BODY_R) continue;
        const d = Math.sqrt(d2) || 0.001;
        const nx = d2 > 1e-8 ? dx / d : -fwd.x, nz = d2 > 1e-8 ? dz / d : -fwd.z;
        if (world.propByBox.has(box)) {
          world.pushProp(box, -nx, -nz, 3 + Math.abs(v.speed) * 0.8);
          continue;
        }
        const push = BODY_R - d;
        v.pos.x += nx * push;
        v.pos.z += nz * push;
        // Önden çarpışma hızı keser
        const head = -(nx * fwd.x + nz * fwd.z) * Math.sign(v.speed || 1);
        if (head > 0.3) v.speed *= 0.35;
      }
    }

    // Ezme: hızla giden aracın önündeki düşman
    if (Math.abs(v.speed) > 3.5) {
      const g = this.game;
      for (const e of g.enemies.enemies) {
        if (!e.alive) continue;
        const dx = e.pos.x - v.pos.x, dz = e.pos.z - v.pos.z;
        const along = dx * fwd.x + dz * fwd.z;
        const side = Math.abs(dx * fwd.z - dz * fwd.x);
        if (Math.abs(along) > 3.3 || side > 1.6) continue;
        e._killedBy = { vehicle: true };
        g.enemies.kill(e, now, fwd.clone().multiplyScalar(Math.sign(v.speed)));
        g.hud.feed(`${e.def.name} — EZİLDİ`, true);
      }
    }
  }

  /* ── Her kare (sürülsün sürülmesin) ───────────────────────────────── */

  update(dt, now) {
    for (const v of this.list) {
      v.root.position.copy(v.pos);
      v.root.rotation.y = v.yaw;
      this._updateBox(v);
      // Tekerlekler: dönme ve öndekilerde direksiyon
      for (const w of v.wheels) {
        w.spin.rotation.z -= (v.speed * dt) / WHEEL_R;
        w.steer.rotation.y = w.front ? v.steer : 0;
      }
      if (v.dead) continue;
      v.root.updateMatrixWorld(true);
      // Binenler araçla taşınır (görünmez); nişancı kulede görünür
      for (const a of v.riders) a.pos.set(v.pos.x, 0, v.pos.z);
      if (v.gunner) this._updateGunner(v, dt, now);
    }
  }

  _updateGunner(v, dt, now) {
    const g = this.game;
    const a = v.gunner;
    if (!a.alive) { v.gunner = null; return; }
    const spot = v.gunnerSpot.getWorldPosition(new THREE.Vector3());

    // Hedef: menzildeki, arada engel olmayan en yakın düşman
    if (now >= v.nextThink) {
      v.nextThink = now + 0.35;
      v.target = null;
      let bd = TURRET.range;
      const eye = spot.clone().setY(spot.y + 1.3);
      for (const e of g.enemies.enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.pos.x - v.pos.x, e.pos.z - v.pos.z);
        if (d >= bd) continue;
        const to = e.center.sub(eye);
        const dist = to.length();
        this._ray.set(eye, to.normalize());
        this._ray.far = dist;
        const hit = this._ray.intersectObjects(g.world.solids, false)
          .find((h) => h.object.userData?.vehicle !== v);
        if (hit) continue;
        bd = d;
        v.target = e;
      }
      this._ray.far = Infinity;
    }

    // Kule hedefe döner (araca göre yerel açı; namlu +X'te)
    let err = 1;
    if (v.target?.alive && v.turret) {
      const local = v.root.worldToLocal(v.target.center);
      const want = Math.atan2(-local.z, local.x);
      const diff = wrap(want - v.turretYaw);
      v.turretYaw += THREE.MathUtils.clamp(diff, -TURRET.turn * dt, TURRET.turn * dt);
      v.turret.rotation.y = v.turretYaw;
      err = Math.abs(diff);
    }

    // Nişancı askeri kulede: ayakları gövdede, gövdesi kapakta
    const facing = v.yaw + v.turretYaw - Math.PI / 2;
    a.pos.copy(spot).setY(0);
    a.root.position.copy(spot);
    a.root.rotation.y = facing;
    a.soldier.update({ dt, speed: 0, crouching: false, downed: false, aimPitch: 0 });

    // Ateş: hizalanınca seri halinde
    if (v.target?.alive && err < 0.09 && now >= v.nextShot && v.muzzle) {
      v.nextShot = now + TURRET.rate;
      const from = v.muzzle.getWorldPosition(new THREE.Vector3());
      const to = v.target.center;
      const dir = to.clone().sub(from);
      const dist = dir.length();
      dir.normalize();
      dir.x += (Math.random() - 0.5) * 0.03;
      dir.y += (Math.random() - 0.5) * 0.02;
      dir.z += (Math.random() - 0.5) * 0.03;
      dir.normalize();
      g.effects.tracer(from, from.clone().addScaledVector(dir, dist), 0xffb35a);
      g.audio.shot({ body: 75, crack: 1600, length: 0.26, punch: 0.6 });
      this._ray.set(from, dir);
      this._ray.far = dist + 1;
      const hit = this._ray.intersectObjects(v.target.hitMeshes, false)[0];
      this._ray.far = Infinity;
      if (hit) g.onTurretHit?.(v.target, hit.object.userData.part ?? 'body', hit.point, TURRET.damage);
    }
  }

  /* ── Hasar ────────────────────────────────────────────────────────── */

  /** Araca isabet (düşman mermisi gövdeye saplandı ya da sürücüye yöneldi). */
  damage(v, amount, point = null) {
    if (!v || v.dead) return;
    v.hp -= amount;
    if (point) this.game.effects.sparks(point, new THREE.Vector3(0, 1, 0), 0xffc06a, 4);
    if (v.hp <= 0) this._destroy(v);
  }

  _destroy(v) {
    const g = this.game;
    v.hp = 0;
    v.dead = true;
    v.speed = 0;
    const center = v.pos.clone().setY(1.2);
    // Yanık enkaz: malzemeler bu araca özel kopyalanıp karartılır (ışıklar söner)
    v.root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.color?.multiplyScalar(0.18);
      if (o.material.emissive) o.material.emissiveIntensity = 0;
    });
    for (let i = 0; i < 8; i++) {
      g.effects.hitBurst(center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 1.5, (Math.random() - 0.5) * 2)), 0xff8a2a, 18);
    }
    g.audio.explosion();
    g.physics.explosion(center, 9, 40);
    g.player.shake(1);
    const wasDriving = this.driving === v;
    if (wasDriving) this.exit();
    else for (const a of v.riders) { a.aboard = null; a.root.visible = true; }
    v.riders = [];
    v.gunner = null;
    g.hud.feed('ZIRHLI ARAÇ İMHA EDİLDİ', true);
    if (wasDriving) g.onVehicleBlast?.();
  }
}
