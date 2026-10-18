/* Omuz üstü görüş (V): Resident Evil tarzı üçüncü şahıs kamera.

   Kamera karakterin SAĞ omzunun arkasında durur; karakter ekranın solunda
   görünür, nişangâh ekranın ortasında kalır. Nişan alınca (sağ tık) kamera
   omza yaklaşır ve biraz yakınlaşır. Kamera ile baş arasında duvar varsa
   kamera öne çekilir (duvarın içinden bakılmasın).

   Karakter, müttefiklerin SWAT asker modeliyle temsil edilir; yürüme,
   koşma, çömelme ve ağır yaralı pozları onun kliplerinden gelir, gövde
   hep nişan yönüne bakar.

   Atış: nişangâhın gösterdiği nokta kameradan bulunur, mermi karakterin
   göğsünden O noktaya gider — kameradan çıksaydı karakterin arkasındaki
   engel ya da karakterin kendisi atışı keserdi.                         */

import * as THREE from 'three';
import { Soldier } from './soldier.js';
import { RIGS } from './mechanics.js';

const VIEW_KEY = 'celikhat.gorus';
const DIST = 2.35, DIST_ADS = 1.25;
const SIDE = 0.62, SIDE_ADS = 0.5;
const RISE = 0.2;

export class ThirdPerson {
  constructor(game) {
    this.game = game;
    let saved = null;
    try { saved = localStorage.getItem(VIEW_KEY); } catch { /* gizli sekme */ }
    this.enabled = saved === 'omuz';
    this.active = false;        // bu karede gerçekten omuz üstü mü
    this.avatar = null;
    this.guns = new Map();      // silah kimliği → karakterin elindeki kopya
    this.gunId = null;
    this._flashUntil = 0;
    this._adsK = 0;
    this._ray = new THREE.Raycaster();
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem(VIEW_KEY, this.enabled ? 'omuz' : 'goz'); } catch { /* yok say */ }
    if (!this.enabled) this.hide();
    return this.enabled;
  }

  _ensureAvatar() {
    if (this.avatar) return this.avatar;
    const g = this.game;
    if (!g.soldiers?.template) return null;
    const rig = g.soldiers.create();
    // Kol bandı yok: kamera hep arkasında, ışıyan bant omuzda leke gibi duruyordu
    const soldier = new Soldier(rig, { team: 'ally', rifle: g.gear?.makeRifle('mar556') ?? null, tint: null });
    g.scene.add(soldier.root);
    this.avatar = soldier;
    return soldier;
  }

  /**
   * Birinci şahıs silahının (tutucu: model + hareketli parçalar) üçüncü
   * şahıs kopyası. Geometri/malzeme paylaşılır; ışıklar atılır, alev
   * kopyası atışta kısa süre görünür.
   */
  _gunFor(slot) {
    const id = slot.def.id;
    if (this.guns.has(id)) return this.guns.get(id);
    slot.flash.name = '__alev';
    const g = slot.holder.clone(true);
    g.position.set(0, 0, 0);
    g.rotation.set(0, 0, 0);
    g.scale.set(1, 1, 1);
    g.visible = true;
    const lights = [];
    g.traverse((o) => {
      if (o.isLight) lights.push(o);
      if (o.isMesh) { o.castShadow = true; o.frustumCulled = true; }
    });
    for (const l of lights) l.parent.remove(l);
    const flash = g.getObjectByName('__alev');
    if (flash) flash.visible = false;
    g.userData.muzzle = slot.muzzle.clone();
    const gun = { group: g, flash, grip: new THREE.Vector3().fromArray(RIGS[id]?.anchors.grip.p ?? [0, -0.055, -0.25]) };
    this.guns.set(id, gun);
    return gun;
  }

  /** Atış: karakterin silahında kısa namlu alevi. */
  flash(now) {
    const gun = this.guns.get(this.gunId);
    if (!gun?.flash) return;
    gun.flash.visible = true;
    gun.flash.rotation.z = Math.random() * Math.PI;
    this._flashUntil = now + 0.05;
  }

  hide() {
    this.active = false;
    if (this.avatar) this.avatar.root.visible = false;
  }

  /** Yeni tur: karakter modeli sahneden kalkar, ilk kullanımda yeniden kurulur. */
  reset() {
    if (this.avatar) this.game.scene.remove(this.avatar.root);
    this.avatar = null;
    this.gunId = null;
    this.active = false;
  }

  /**
   * player.update'ten SONRA çağrılır: kamerayı omuz üstüne taşır.
   * use: bu karede omuz üstü kullanılabilir mi (araç, makineli, dürbün yok)
   */
  /** aiming: nişan alıyor ya da ateş ediyor (tüfek omza kalkar) */
  update(dt, ads, use, aiming = false) {
    if (!this.enabled || !use) { this.hide(); return; }
    const av = this._ensureAvatar();
    if (!av) return;
    const g = this.game;
    const p = g.player;
    this.active = true;

    // Elindeki silah: birinci şahısta seçili olanın kopyası
    const slot = g.weaponry.current;
    if (slot && slot.def.id !== this.gunId) {
      const gun = this._gunFor(slot);
      av.setRifle(gun.group, gun.grip);
      this.gunId = slot.def.id;
    }
    const gun = this.guns.get(this.gunId);
    if (gun?.flash?.visible && performance.now() / 1000 > this._flashUntil) gun.flash.visible = false;

    // Karakter: oyuncunun yerinde, nişan yönüne dönük
    av.root.visible = true;
    av.root.position.set(p.pos.x, p.pos.y, p.pos.z);
    av.root.rotation.y = p.yaw;
    av.setShadowDistance(0);
    av.update({
      dt,
      speed: Math.hypot(p.vel.x, p.vel.z),
      crouching: p.crouching,
      downed: p.downed,
      aimPitch: p.pitch,
      // Omuz üstünde silah hep omuzda (koşarken iner): gövde nişan yönüne
      // döner, karakter yamuk durmaz
      aiming: !p.sprinting || aiming,
    });

    // Kamera: sağ omzun arkası; nişanda yaklaşır
    this._adsK += ((ads ? 1 : 0) - this._adsK) * Math.min(1, dt * 10);
    const k = this._adsK;
    const yaw = p.yaw + p.recoilYaw, pitch = p.pitch + p.recoilPitch;
    const fwd = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const head = new THREE.Vector3(p.pos.x, p.pos.y + p.eye + 0.05, p.pos.z).addScaledVector(right, p.lean * 0.35);
    const shoulder = head.clone()
      .addScaledVector(right, THREE.MathUtils.lerp(SIDE, SIDE_ADS, k))
      .add(new THREE.Vector3(0, RISE, 0));
    const dist = THREE.MathUtils.lerp(DIST, DIST_ADS, k);
    const want = shoulder.clone().addScaledVector(fwd, -dist);

    // Duvar arkaya girerse kamera öne çekilir
    const back = want.clone().sub(head);
    const len = back.length();
    this._ray.set(head, back.divideScalar(len));
    this._ray.far = len + 0.25;
    const hit = this._ray.intersectObjects(g.world.solids, false)[0];
    const cam = g.camera;
    if (hit) cam.position.copy(head).addScaledVector(back, Math.max(0.15, hit.distance - 0.25));
    else cam.position.copy(want);

    cam.rotation.set(0, 0, 0);
    cam.rotateY(yaw);
    cam.rotateX(pitch);
    cam.rotateZ(-p.lean * 0.12);
  }

  /** Karakter göğsü (mermi ve bıçak buradan). */
  chest() {
    const p = this.game.player;
    return new THREE.Vector3(p.pos.x, p.pos.y + Math.max(0.5, p.eye - 0.25), p.pos.z);
  }

  /** Karakterin tüfek ucu (izli mermi ve alev buradan). */
  muzzle() {
    return this.avatar ? this.avatar.muzzleWorld : this.chest();
  }

  /**
   * Nişangâhın gösterdiği nokta (kameradan ışın; karakterin önündeki
   * engelleri saymak için kamera–baş arasındakiler atlanır).
   */
  aimPoint(dir, targets) {
    const cam = this.game.camera.getWorldPosition(new THREE.Vector3());
    const skip = cam.distanceTo(this.chest()) + 0.3;
    this._ray.set(cam, dir);
    this._ray.far = 400;
    const hit = this._ray.intersectObjects(targets, false).find((h) => h.distance > skip);
    return hit ? hit.point : cam.addScaledVector(dir, 200);
  }
}
