/* Görev sonu sinematiği: tahliye — araca binip uzaklaşma.

   Görev bitince bir zırhlı araç oyuncunun yanına gelir, arka kapısını açar;
   silah arkadaşları koşup biner, oyuncu (burada üçüncü şahıs asker modeli)
   en son biner, kapı kapanır, araç hızlanıp uzaklaşır, ekran kararır.

     Plan 1  omuz üstü — araç gelip yanında durur (künye: GÖREV TAMAMLANDI)
     Plan 2  yan geniş — kapı açılır, ekip sırayla biner
     Plan 3  alçak sabit — kapı kapanır, araç kalkıp uzaklaşır
     Plan 4  vinç geri çekilme — araç sisin içinde kaybolur, kararma

   Araç yolu, oyuncunun çevresindeki 16 yön içinden ENGELİ EN AZ olan
   şerit seçilerek kurulur (görev ortasında dünya yeniden kurulmaz).
   Baskın'da araç evin güneyinden gelir, ekip bahçe kapısında belirir;
   ufuktaki düşman birliği arka planda yürümeye devam eder.            */

import * as THREE from 'three';
import { Soldier } from './soldier.js';

const L_IN = 42;           // araç bu kadar öteden gelir
const T_ARRIVE = 5.0;
const DOOR_OPEN = 0.7;
const BOARD_GAP = 0.5;
const ACCEL = 3.4;
const VMAX = 16;

const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.min(1, Math.max(0, k));
const DUST = { beton: 0x8f8c82, kum: 0xc9ab78, cimen: 0x7a6a4c, kar: 0xe6ecf0 };

export class Outro {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.el = {
      root: document.getElementById('cine'),
      eyebrow: document.getElementById('cine-eyebrow'),
      title: document.getElementById('cine-title'),
      sub: document.getElementById('cine-sub'),
      fade: document.getElementById('cine-fade'),
    };
  }

  /** Oyuncunun çevresinde engeli en az şeridi bul: { f, r, stop }. */
  _lane(P) {
    const world = this.game.world;
    const lim = world.half - 6;
    let best = null;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const f = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      for (const side of [1, -1]) {
        const r = new THREE.Vector3(-f.z, 0, f.x).multiplyScalar(side);
        const stop = P.clone().addScaledVector(r, 4.2).addScaledVector(f, 2.2);
        let cost = 0;
        for (let t = -L_IN; t <= 40; t += 2) {
          const p = stop.clone().addScaledVector(f, t);
          if (Math.abs(p.x) > lim || Math.abs(p.z) > lim) { cost += 6; continue; }
          for (const b of world.colliders) {
            if (b.max.y < 0.5) continue;
            if (p.x > b.min.x - 1.6 && p.x < b.max.x + 1.6 && p.z > b.min.z - 1.6 && p.z < b.max.z + 1.6) cost++;
          }
        }
        if (!best || cost < best.cost) best = { cost, f, r, stop };
      }
    }
    return best;
  }

  /**
   * opts: { raid, raidStop, raidGate, missionName, map, onDone }
   */
  begin(opts) {
    const g = this.game;
    this.opts = opts;
    this.active = true;
    this.t = 0;
    this._sounds = new Set();
    this._nextDust = 0;
    this._nextSmoke = 0;
    this.dust = DUST[opts.map?.zemin] ?? DUST.beton;

    g.vehicles.exit();
    g.vehicles.clear();
    // Görev bitti: kalan düşmanlar sahneden çekilir
    for (const e of g.enemies.enemies) if (e.alive) e.group.visible = false;

    let P, f, r, stop;
    if (opts.raid) {
      stop = opts.raidStop.clone();
      f = new THREE.Vector3(-1, 0, 0);
      r = new THREE.Vector3(0, 0, 1);              // evin ters yanı (kamera dışarıda)
      P = opts.raidGate.clone();
      this.el.fade.classList.add('on');               // içeriden kapıya: kararmayla
      setTimeout(() => this.el.fade.classList.remove('on'), 250);
    } else {
      P = g.player.pos.clone().setY(0);
      ({ f, r, stop } = this._lane(P));
    }
    this.f = f;
    this.r = r;
    this.stop = stop;
    this.from = stop.clone().addScaledVector(f, -L_IN);
    this.doorPt = stop.clone().addScaledVector(f, -4.8);
    this._s = 0;
    this.v = g.vehicles.spawn(this.from.clone(), Math.atan2(-f.z, f.x), opts.map);

    // Oyuncunun yerine asker modeli (üçüncü şahıs)
    this.avatar = null;
    if (g.soldiers?.template) {
      const rig = g.soldiers.create();
      const soldier = new Soldier(rig, { team: 'ally', rifle: g.gear?.makeRifle('mar556') ?? null, tint: 0xe8a33d });
      soldier.root.position.copy(P);
      g.scene.add(soldier.root);
      this.avatar = { soldier, root: soldier.root, pos: P.clone(), facing: 0 };
    }

    // Binecekler: müttefikler (yerdekiler de toparlanır) + en son oyuncu
    const runners = [];
    g.allies.allies.forEach((a, i) => {
      a.aboard = null;
      a.downed = false;
      a.alive = true;
      a.root.visible = true;
      if (opts.raid) {
        // Bahçe kapısının dışında, duvar boyunca sıralı
        a.pos.copy(P).addScaledVector(f, (i - 1.5) * 1.1).addScaledVector(r, 0.6 + (i % 2) * 0.8);
      }
      runners.push({ who: a, root: a.root, soldier: a.soldier, pos: a.pos.clone() });
    });
    if (this.avatar) runners.push({ who: null, root: this.avatar.root, soldier: this.avatar.soldier, pos: P.clone(), player: true });
    runners.forEach((u, i) => { u.t0 = T_ARRIVE + 0.2 + i * BOARD_GAP; u.aboard = false; });
    this.runners = runners;
    this.allAboardAt = Infinity;
    this.leaveAt = Infinity;

    document.body.classList.add('cinematic', 'cine-bars');
    this.el.root.hidden = false;
    const now = new Date();
    const saat = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    this.lines = {
      eyebrow: 'GÖREV TAMAMLANDI',
      title: (opts.missionName ?? 'Serbest Hat').toLocaleUpperCase('tr'),
      sub: `TAHLİYE · ${opts.map?.ad ?? ''} · ${saat}`,
    };
    for (const k of ['eyebrow', 'title', 'sub']) this.el[k].textContent = '';
    g.weaponry.rig.visible = false;
    g.nametags.setVisible(false);
  }

  skip() {
    if (this.active) this._finish();
  }

  _once(key, fn) {
    if (this._sounds.has(key)) return;
    this._sounds.add(key);
    fn();
  }

  update(dt, now) {
    if (!this.active) return;
    const g = this.game;
    this.t += dt;
    const t = this.t;
    const v = this.v;
    const f = this.f, r = this.r, S = this.stop;

    // ── Araç: gelir (sabit yavaşlama), bekler, hızlanıp uzaklaşır ───────
    let s;
    if (t < T_ARRIVE) {
      const u = t / T_ARRIVE;
      s = L_IN * (1 - (1 - u) ** 2);
    } else if (t < this.leaveAt) {
      s = L_IN;
    } else {
      const k = t - this.leaveAt;
      const tMax = VMAX / ACCEL;
      s = L_IN + (k < tMax ? 0.5 * ACCEL * k * k : 0.5 * ACCEL * tMax * tMax + VMAX * (k - tMax));
    }
    v.speed = dt > 0 ? (s - this._s) / dt : 0;
    this._s = s;
    v.pos.copy(this.from).addScaledVector(f, s);
    if (v.hull) {
      const moving = clamp01(Math.abs(v.speed) / 6);
      let pitch = (Math.sin(t * 23) * 0.004 + Math.sin(t * 7.3) * 0.006) * moving;
      if (t < T_ARRIVE) pitch -= 0.016 * clamp01((t - 1) / 2);
      else if (t < this.leaveAt) pitch -= 0.028 * Math.exp(-(t - T_ARRIVE) * 3.2) * Math.cos((t - T_ARRIVE) * 11);
      else pitch += 0.02 * Math.exp(-(t - this.leaveAt) * 1.5);      // kalkışta burun kalkar
      v.hull.rotation.z = pitch;
    }
    g.player.pos.set(v.pos.x, 0, v.pos.z);       // dünya akışı araçla gitsin

    const fx = g.effects;
    if (Math.abs(v.speed) > 1.2 && now > this._nextDust) {
      this._nextDust = now + 0.045;
      for (const side of [-1, 1]) {
        const p = v.pos.clone().addScaledVector(f, -1.7).addScaledVector(r, side * 1.25).setY(0.25);
        const vel = f.clone().multiplyScalar(-v.speed * 0.18)
          .add(new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.6 + Math.random() * 0.9, (Math.random() - 0.5) * 1.6));
        fx.puff(p, vel, this.dust, 0.35 + Math.random() * 0.35, 1.6 + Math.random(), -0.05, 1.1);
      }
    }
    if (v.exhaust && now > this._nextSmoke) {
      this._nextSmoke = now + (v.speed > 1 ? 0.06 : 0.16);
      const p = v.exhaust.getWorldPosition(new THREE.Vector3());
      fx.puff(p, new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.9, (Math.random() - 0.5) * 0.3),
        0x3b3a37, 0.12 + Math.random() * 0.12, 1.2, -0.2, 1.3);
    }

    // ── Kapı ──────────────────────────────────────────────────────────
    const openK = clamp01((t - T_ARRIVE) / DOOR_OPEN);
    const closeK = clamp01((t - (this.allAboardAt + 0.35)) / 0.6);
    if (v.door) v.door.rotation.y = -1.75 * ease(openK) * (1 - ease(closeK));
    if (t > T_ARRIVE - 0.4) this._once('fren', () => g.audio.brakeHiss?.());
    if (t > T_ARRIVE) this._once('ac', () => g.audio.doorClunk?.());
    if (closeK >= 1) {
      this._once('kapat', () => g.audio.doorClunk?.());
      if (this.leaveAt === Infinity) this.leaveAt = t + 0.3;
    }

    // ── Biniş: herkes sırayla kapıya koşar, eşikte kaybolur ─────────────
    const door = this.doorPt;
    for (const u of this.runners) {
      if (u.aboard) continue;
      const toDoor = door.clone().sub(u.pos).setY(0);
      const dist = toDoor.length();
      let speed = 0;
      if (t >= u.t0) {
        speed = 4.4;
        const step = Math.min(dist, speed * dt);
        if (dist > 0.01) u.pos.addScaledVector(toDoor.normalize(), step);
        if (dist - step < 0.25) {
          u.aboard = true;
          u.root.visible = false;
          if (u.who) u.who.aboard = v;
          if (this.runners.every((x) => x.aboard)) this.allAboardAt = t;
          continue;
        }
      }
      const look = t >= u.t0 ? toDoor : v.pos.clone().sub(u.pos);
      u.root.position.copy(u.pos);
      u.root.rotation.y = Math.atan2(-look.x, -look.z);
      u.soldier.update({ dt, speed, crouching: false, downed: false, aimPitch: 0 });
    }

    // ── Künye ─────────────────────────────────────────────────────────
    const type = (key, start, cps) => {
      const n = Math.max(0, Math.floor((t - start) * cps));
      const text = this.lines[key].slice(0, n);
      if (this.el[key].textContent !== text) this.el[key].textContent = text;
    };
    if (t < 6.4) {
      type('eyebrow', 0.5, 36);
      type('title', 1.0, 22);
      type('sub', 2.0, 40);
      this.el.root.classList.toggle('cine-title-out', t > 5.8);
    } else if (this.el.title.textContent) {
      for (const k of ['eyebrow', 'title', 'sub']) this.el[k].textContent = '';
    }

    // ── Kamera planları ───────────────────────────────────────────────
    const cam = g.camera;
    const av = this.avatar?.root.position ?? door;
    let pos, look, fov = 50;
    const vc = v.pos.clone().setY(1.3);
    if (t < T_ARRIVE + 0.2) {
      // 1: oyuncunun omzu üstünden — araç gelip yanına durur
      const away = av.clone().sub(S).setY(0).normalize();
      pos = av.clone().addScaledVector(away, 2.6).addScaledVector(f, -1.2).setY(1.85);
      look = vc;
      fov = 52;
    } else if (t < this.leaveAt) {
      // 2: yan geniş — kapı ve biniş
      const k = clamp01((t - T_ARRIVE) / 4);
      pos = door.clone().addScaledVector(r, 7.5 - k * 1.2).addScaledVector(f, -2.5).setY(1.6);
      look = door.clone().addScaledVector(f, 1.2).setY(1.0);
      fov = 48;
    } else if (t < this.leaveAt + 2.2) {
      // 3: alçak sabit — araç kalkar, uzaklaşır
      pos = S.clone().addScaledVector(f, -9).addScaledVector(r, 2.6).setY(0.6);
      look = vc;
      fov = 42;
    } else {
      // 4: vinç geri çekilme
      const k = ease(clamp01((t - this.leaveAt - 2.2) / 3));
      pos = S.clone().addScaledVector(f, -12 - k * 6).addScaledVector(r, 3).setY(4 + k * 10);
      look = vc;
      fov = 50;
    }
    pos.x += Math.sin(t * 1.7) * 0.03;
    pos.y += Math.sin(t * 2.3) * 0.025;
    cam.position.copy(pos);
    cam.lookAt(look);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    if (t > this.leaveAt + 4.2) this.el.fade.classList.add('on');
    if (t > this.leaveAt + 5.1 || t > 30) this._finish();
  }

  _finish() {
    if (!this.active) return;
    this.active = false;
    const g = this.game;
    if (this.avatar) g.scene.remove(this.avatar.root);
    this.avatar = null;
    for (const a of g.allies.allies) a.root.visible = false;
    g.vehicles.clear();
    document.body.classList.remove('cinematic', 'cine-bars');
    this.el.root.hidden = true;
    this.el.root.classList.remove('cine-title-out');
    this.opts.onDone?.();
    // Kararma, sonuç ekranı açıldıktan sonra kalkar
    setTimeout(() => this.el.fade.classList.remove('on'), 400);
  }
}
