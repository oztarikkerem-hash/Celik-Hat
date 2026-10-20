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
import { buildJeep, JEEP } from './jeep.js';
import { Soldier } from './soldier.js';
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
const TOP_AMMO = 3000;           // oyuncu kuledeyken M2 mermisi
const TOP_EYE = 3.05;            // kuledeki nişancının göz yüksekliği (kalkanın üstü)
const AUTO = { vmax: 8.5, stopNear: 24, road: 4 };   // silah arkadaşının sürüşü

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
    this.topside = null;          // oyuncunun tepesinde (kulede) olduğu araç
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
    this.topside = null;
    this.game.player.eye = 1.66;
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

  /**
   * map: kamuflaj paleti alanın zeminine göre seçilir.
   * opts.model 'jeep': arazi aracı (hızlı, açık kasa, kule yok — kimse binmez)
   */
  spawn(pos, yaw, map = null, opts = {}) {
    const jeep = opts.model === 'jeep';
    const root = jeep ? buildJeep(opts.color) : buildAPC(camoFor(map));
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
    if (jeep) {
      v.steerSpin = root.getObjectByName('steeringSpin');
      v.grips = [root.getObjectByName('gripL'), root.getObjectByName('gripR')];
      // Arazi aracı: 140 km/sa, çevik; zırhı ince
      Object.assign(v, {
        kind: 'car', vmax: 38.9, accel: 9.5, brake: 22, vrev: 8,
        wheelR: JEEP.wheelR, half: JEEP.half, height: JEEP.height,
        bodyOffs: JEEP.bodyOffs, bodyR: JEEP.bodyR, camDist: 6.4, camH: 1.6,
        hp: 900, maxHp: 900,
      });
    }
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
    const hx = v.half?.[0] ?? 3.05, hz = v.half?.[1] ?? 1.3;
    const ex = Math.abs(c) * hx + Math.abs(s) * hz;
    const ez = Math.abs(s) * hx + Math.abs(c) * hz;
    v.box.min.set(v.pos.x - ex, 0, v.pos.z - ez);
    v.box.max.set(v.pos.x + ex, v.height ?? 2.2, v.pos.z + ez);
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
    // (arazi aracında kule yok: kimse binmez)
    v.riders = [];
    for (const a of v.kind === 'car' ? [] : g.allies.allies) {
      if (!a.alive || a.downed) continue;
      if (Math.hypot(a.pos.x - v.pos.x, a.pos.z - v.pos.z) > BOARD_RANGE) continue;
      a.aboard = v;
      a.root.visible = false;
      if (a.cover) { a.cover.taken = null; a.cover = null; }
      v.riders.push(a);
    }
    v.gunner = v.riders[0] ?? null;
    if (v.gunner) v.gunner.root.visible = true;
    if (v.kind === 'car') this._seatDriver(v, true);
    g.audio.swap();
  }

  /**
   * Arazi aracında oyuncunun karakteri sürücü koltuğunda görünür (SWAT
   * modeli): oturur, elleri direksiyonda. Araçtan inince gizlenir.
   */
  _seatDriver(v, on) {
    if (!on) { if (v.driverModel) v.driverModel.root.visible = false; return; }
    if (!v.driverModel) {
      const fac = this.game.soldiers;
      if (!fac?.template) return;
      const s = new Soldier(fac.create(), { team: 'ally', rifle: null, tint: null });
      s.root.position.set(-0.08, 0, -0.42);     // sürücü koltuğu (araç yerel)
      s.root.rotation.y = -Math.PI / 2;         // asker önü (−Z) → araç önü (+X)
      v.root.add(s.root);
      s.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      v.driverModel = s;
    }
    v.driverModel.root.visible = true;
  }

  exit() {
    const v = this.driving;
    if (!v) return;
    this.driving = null;
    this._seatDriver(v, false);
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
    this._physics(v, dt, now, input);
    const fwd = this.forward(v);

    // Oyuncu aracın içinde (dünya akışı ve düşman hedefi için)
    g.player.pos.set(v.pos.x, 0, v.pos.z);
    g.player.vel.set(fwd.x * v.speed, 0, fwd.z * v.speed);

    // Takip kamerası: fareyle aracın çevresinde döner
    g.player.pitch = THREE.MathUtils.clamp(g.player.pitch, -0.7, 0.25);
    const yaw = g.player.yaw, pitch = g.player.pitch;
    const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const focus = new THREE.Vector3(v.pos.x, v.camH ?? 2.1, v.pos.z);
    const cam = g.camera;
    cam.position.copy(focus).addScaledVector(dir, -(v.camDist ?? 9.5));
    cam.position.y = Math.max(0.8, cam.position.y + 1.2);
    cam.rotation.set(0, 0, 0);
    cam.rotateY(yaw);
    cam.rotateX(pitch);
  }

  /** Sürüş fiziği (oyuncu ya da silah arkadaşı sürsün): girdi → hareket. */
  _physics(v, dt, now, input) {
    const g = this.game;
    const thr = input.forward;
    const accel = v.accel ?? ACCEL, brake = v.brake ?? BRAKE;
    v.throttle = thr;
    // Hızlandıkça ivme azalır; 100 km/sa'ten sonra belirgin yavaşlar
    // (arazi aracı 0–100 ~3.5 sn, 100–140 ~7 sn)
    const kmh = Math.max(0, v.speed) * 3.6, top = (v.vmax ?? VMAX) * 3.6;
    const fall = kmh < 100 ? 1 - 0.25 * (kmh / 100)
      : 0.3 * (1 - 0.65 * Math.min(1, (kmh - 100) / Math.max(1, top - 100)));
    if (thr > 0) v.speed += (v.speed < 0 ? brake : accel * fall) * dt;
    else if (thr < 0) v.speed -= (v.speed > 0 ? brake : accel * 0.7) * dt;
    else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), DRAG * dt);
    if (input.jump) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), brake * dt);
    // v.vmax: görev başına üst hız (ör. Füze Rampası'nın toprak yolunda 24 m/sn)
    const vmax = v.vmax ?? VMAX;
    v.speed = THREE.MathUtils.clamp(v.speed, -(v.vrev ?? VREV), vmax);

    // Hızlanınca direksiyon kısılır (yüksek hızda keskin dönüş takla attırır)
    const steerMax = STEER_MAX * (1 - 0.6 * Math.min(1, Math.abs(v.speed) / vmax));
    const want = -input.right * steerMax;
    v.steer += (want - v.steer) * Math.min(1, dt * 5);
    v.yaw += (v.speed / WHEELBASE) * Math.tan(v.steer) * dt;

    const fwd = this.forward(v);
    v.pos.addScaledVector(fwd, v.speed * dt);
    this._collide(v, now);
    const lim = g.world.half - 3.5;
    v.pos.x = THREE.MathUtils.clamp(v.pos.x, -lim, lim);
    v.pos.z = THREE.MathUtils.clamp(v.pos.z, -lim, lim);
  }

  /**
   * Devir saati için vites ve devir (5 ileri vites, oyunlardaki gibi):
   * vites aralıkları üst hızın oranları; vites atınca devir ~2600'e düşer.
   */
  gearbox(v) {
    const kmh = v.speed * 3.6;
    if (kmh < -0.5) return { gear: 'R', rpm: 1100 + Math.min(1, -kmh / 25) * 3200, kmh };
    const top = (v.vmax ?? VMAX) * 3.6;
    const edges = [0, 0.2, 0.38, 0.58, 0.79, 1.0].map((k) => k * top);
    let g = 1;
    while (g < 5 && kmh > edges[g]) g++;
    const lo = edges[g - 1], hi = edges[g];
    const f = Math.min(1, Math.max(0, (kmh - lo) / (hi - lo)));
    const base = g === 1 ? 900 : 2600;
    const idle = Math.abs(kmh) < 1 && !(v.throttle > 0);
    return { gear: idle ? 'N' : g, rpm: idle ? 850 : base + (6400 - base) * f + (v.throttle > 0 ? 150 : 0), kmh };
  }

  /* ── Kule: oyuncu tepede, M2 başında ─────────────────────────────── */

  /** Oyuncu kuleye çıkar; çevredeki silah arkadaşları araca biner. */
  climb(v) {
    const g = this.game;
    this.topside = v;
    v.autoDrive = false;
    v.topAmmo ??= TOP_AMMO;
    v.nextTopShot = 0;
    v.riders = [];
    for (const a of g.allies.allies) {
      if (!a.alive || a.downed) continue;
      if (Math.hypot(a.pos.x - v.pos.x, a.pos.z - v.pos.z) > BOARD_RANGE) continue;
      a.aboard = v;
      a.root.visible = false;
      if (a.cover) { a.cover.taken = null; a.cover = null; }
      v.riders.push(a);
    }
    v.gunner = null;                       // kule artık oyuncunun
    v.driverAlly = v.riders[0] ?? null;    // sürmesi istenirse direksiyondaki
    g.player.eye = TOP_EYE;
    g.player.yaw = v.yaw + v.turretYaw - Math.PI / 2;
    g.player.pitch = 0;
    g.audio.swap();
  }

  /** Kuleden in: araç durur, binenler de iner. */
  climbDown() {
    const v = this.topside;
    if (!v) return;
    this.topside = null;
    v.autoDrive = false;
    v.speed = 0;
    this.driving = v;          // exit() iniş noktalarını kullanır
    this.exit();
    this.game.player.eye = 1.66;
  }

  /** 1: silah arkadaşı sürsün, 2: dursun. Sürecek kimse yoksa false. */
  setAutoDrive(on) {
    const v = this.topside;
    if (!v) return false;
    if (on && !v.driverAlly) return false;
    v.autoDrive = on;
    return true;
  }

  /** Kuledeyken her kare: kamera nişancının gözünde, kule bakışı izler. */
  updateTop(dt, now) {
    const v = this.topside;
    if (!v) return;
    const g = this.game;
    const p = g.player;
    p.pitch = THREE.MathUtils.clamp(p.pitch, -0.35, 0.45);
    v.turretYaw = wrap(p.yaw + Math.PI / 2 - v.yaw);
    if (v.turret) v.turret.rotation.y = v.turretYaw;
    v.root.updateMatrixWorld(true);

    // Göz: kulenin arkasında, kalkanın üstünden
    const base = v.turret ? v.turret.getWorldPosition(new THREE.Vector3()) : v.pos.clone().setY(2.2);
    const back = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const cam = g.camera;
    p._shake *= Math.pow(0.02, dt);
    p.recoilPitch *= Math.pow(0.002, dt);
    const sh = p._shake * 0.05;
    // Kalkanın üst kenarı ~2.9 m: göz onun üstünde, makineli görüşün altında
    cam.position.copy(base).addScaledVector(back, 0.55).add(new THREE.Vector3(0, 0.86, 0));
    cam.position.x += (Math.random() - 0.5) * sh;
    cam.position.y += (Math.random() - 0.5) * sh + Math.sin(now * 9) * 0.01 * Math.min(1, Math.abs(v.speed) / 5);
    cam.rotation.set(0, 0, 0);
    cam.rotateY(p.yaw);
    cam.rotateX(p.pitch + p.recoilPitch);

    p.pos.set(v.pos.x, 0, v.pos.z);
    const fwd = this.forward(v);
    p.vel.set(fwd.x * v.speed, 0, fwd.z * v.speed);
  }

  /** Kuledeki M2 ile atış: { origin, dir } ya da null. */
  fireTop(now) {
    const v = this.topside;
    if (!v || !v.muzzle || v.topAmmo <= 0 || now < v.nextTopShot) return null;
    v.nextTopShot = now + 60 / 550;
    v.topAmmo--;
    const g = this.game;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(g.camera.getWorldQuaternion(new THREE.Quaternion()));
    const spread = THREE.MathUtils.degToRad(0.55);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    dir.addScaledVector(right, Math.sin(a) * r).addScaledVector(up, Math.cos(a) * r).normalize();
    g.audio.shot({ body: 62, crack: 1500, length: 0.34, punch: 0.9 });
    return { origin: v.muzzle.getWorldPosition(new THREE.Vector3()), dir };
  }

  /**
   * Silah arkadaşının sürüşü: en yakın düşmana YOL üzerinden yaklaşır.
   * Haritada iki ana yol var (x = 0 ve z = 0 boyunca). Yoldan çıkmışsa
   * önce en yakın yola, düşmana yakın olan yol öbürüyse kavşaktan ona
   * geçer; yol üzerinde düşmanın izdüşümüne gidip ~24 m kala durur.
   */
  _autoDrive(v, dt, now) {
    const g = this.game;
    let target = null, bd = Infinity;
    for (const e of g.enemies.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - v.pos.x, e.pos.z - v.pos.z);
      if (d < bd) { bd = d; target = e; }
    }
    const input = { forward: 0, right: 0, jump: false };
    if (!target || bd < AUTO.stopNear) {
      input.jump = true;                                 // fren
      this._physics(v, dt, now, input);
      return;
    }
    const R = AUTO.road;
    const onX = Math.abs(v.pos.x) < R;                   // x = 0 yolunda (z boyunca)
    const onZ = Math.abs(v.pos.z) < R;                   // z = 0 yolunda (x boyunca)
    const useX = Math.abs(target.pos.x) <= Math.abs(target.pos.z);
    let wp;
    if (!onX && !onZ) {
      wp = Math.abs(v.pos.x) < Math.abs(v.pos.z) ? new THREE.Vector3(0, 0, v.pos.z) : new THREE.Vector3(v.pos.x, 0, 0);
    } else if (useX) {
      wp = onX ? new THREE.Vector3(0, 0, target.pos.z) : new THREE.Vector3(0, 0, 0);
    } else {
      wp = onZ ? new THREE.Vector3(target.pos.x, 0, 0) : new THREE.Vector3(0, 0, 0);
    }
    const dx = wp.x - v.pos.x, dz = wp.z - v.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 3) {
      input.jump = true;
      this._physics(v, dt, now, input);
      return;
    }
    const want = Math.atan2(-dz, dx);
    const diff = wrap(want - v.yaw);
    // Sıkıştıysa (gaz var, araç ilerlemiyor) kısa geri manevra: ters
    // direksiyonla geri çekilip yeniden dener
    if (now < (v.reverseUntil ?? 0)) {
      input.forward = -1;
      input.right = Math.sign(diff || 1);
      this._physics(v, dt, now, input);
      return;
    }
    input.right = THREE.MathUtils.clamp(-diff * 2.2, -1, 1);
    // Hedef arkadaysa yavaşça ileri giderek tam kırıp döner
    const vT = Math.min(AUTO.vmax, dist * 0.45) * (Math.abs(diff) > 1 ? 0.35 : 1);
    input.forward = v.speed < vT ? 1 : 0;
    if (v.speed > vT + 1.5) input.jump = true;
    this._physics(v, dt, now, input);
    if (input.forward > 0 && Math.abs(v.speed) < 0.3) {
      v.stuckT = (v.stuckT ?? 0) + dt;
      if (v.stuckT > 1.2) { v.reverseUntil = now + 1.3; v.stuckT = 0; }
    } else {
      v.stuckT = 0;
    }
  }

  /** Gövde daireleri ↔ dünya kutuları; eşyalar itilir, düşman ezilir. */
  _collide(v, now) {
    const world = this.game.world;
    const fwd = this.forward(v).clone();
    const bodyR = v.bodyR ?? BODY_R;
    for (const off of v.bodyOffs ?? BODY) {
      const cx = v.pos.x + fwd.x * off, cz = v.pos.z + fwd.z * off;
      for (const box of world.colliders) {
        if (box === v.box || box.max.y < 0.5 || box.min.y > 2) continue;
        const px = THREE.MathUtils.clamp(cx, box.min.x, box.max.x);
        const pz = THREE.MathUtils.clamp(cz, box.min.z, box.max.z);
        const dx = cx - px, dz = cz - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= bodyR * bodyR) continue;
        const d = Math.sqrt(d2) || 0.001;
        const nx = d2 > 1e-8 ? dx / d : -fwd.x, nz = d2 > 1e-8 ? dz / d : -fwd.z;
        if (world.propByBox.has(box)) {
          world.pushProp(box, -nx, -nz, 3 + Math.abs(v.speed) * 0.8);
          continue;
        }
        const push = bodyR - d;
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
        if (Math.abs(along) > (v.half?.[0] ?? 3.05) + 0.25 || side > (v.half?.[1] ?? 1.3) + 0.3) continue;
        e._killedBy = { vehicle: true };
        g.onEnemyRunOver?.(e);
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
        w.spin.rotation.z -= (v.speed * dt) / (v.wheelR ?? WHEEL_R);
        w.steer.rotation.y = w.front ? v.steer : 0;
      }
      // Direksiyon simidi tekerlekten ~4 kat döner; sürücü elleriyle izler
      if (v.steerSpin) v.steerSpin.rotation.z = -v.steer * 4;
      if (v.driverModel?.root.visible && v.grips?.[0]) {
        v.root.updateMatrixWorld(true);
        const seatY = v.root.localToWorld(new THREE.Vector3(0, 1.24, 0)).y;
        v.driverModel.sit(seatY, v.grips[0].getWorldPosition(new THREE.Vector3()),
          v.grips[1].getWorldPosition(new THREE.Vector3()));
      }
      if (v.dead) continue;
      // pathDriver: görevin kendi sürüşü (ör. yolu izleyen silah arkadaşı)
      if (v === this.topside && v.autoDrive) (v.pathDriver ?? ((a, b, c) => this._autoDrive(a, b, c)))(v, dt, now);
      else if (v === this.topside) this._physics(v, dt, now, { forward: 0, right: 0, jump: true });
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
    a.soldier.update({ dt, speed: 0, crouching: false, downed: false, aimPitch: 0, aiming: Boolean(v.target) });

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
    if (this.topside === v) {
      this.topside = null;
      this.driving = v;
      this.game.player.eye = 1.66;
    }
    const wasDriving = this.driving === v;
    if (wasDriving) this.exit();
    else for (const a of v.riders) { a.aboard = null; a.root.visible = true; }
    v.riders = [];
    v.gunner = null;
    g.hud.feed('ZIRHLI ARAÇ İMHA EDİLDİ', true);
    if (wasDriving) g.onVehicleBlast?.();
  }
}
