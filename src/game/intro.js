/* Görev girişi sinematiği: zırhlı araçla olay yerine varış ve iniş.

   Her görev başında oyuncu ve silah arkadaşları zırhlı araçla gelir.
   Zaman çizelgesi (saniye):

     0.0 – 6.6   Yol: araç ~58 m öteden gelir, frenleyerek durur.
                 Plan A  alçak, sabit tele çekim — araç kameraya doğru gelir
                 Plan B  ön-yan takip — kulede nişancı, farlar, toz
                 Plan C  vinç çekimi — tepeden alana iniş
     6.6 – 7.4   Duruş: gövde öne dalıp geri sallanır, fren havası.
     7.2 – 7.9   Arka kapı menteşesinden açılır.
     7.9 – 11.0  Plan D  arka çapraz: askerler sırayla iner, mevzi alır
                 (nişancı kuleden inip en son çıkar).
    11.0 – 13.4  Plan E  birinci şahıs: oyuncu arka kapıdan iner, döner,
                 sinema bantları çekilir, oyun başlar.
                 Baskın'da: kararır, oyuncu ve ekip evin içinde açılır.

   Boşluk / Enter / Esc ya da "Geç" düğmesi sinematiği atlar.             */

import * as THREE from 'three';

const L = 58;              // araç bu kadar öteden gelir (m)
const T_DRIVE = 6.6;
const T_DOOR = 7.2;
const T_EXIT0 = 7.9;
const EXIT_GAP = 0.62;
const T_PLAYER = 11.0;
const T_END = 13.4;
const T_RAID_FADE = 10.6;
const T_RAID_END = 12.2;

const UP = new THREE.Vector3(0, 1, 0);
const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.min(1, Math.max(0, k));

/** Toz rengi alanın zeminine göre. */
const DUST = { beton: 0x8f8c82, kum: 0xc9ab78, cimen: 0x7a6a4c, kar: 0xe6ecf0 };

export class Intro {
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

  /**
   * opts: { stop: Vector3 (aracın duracağı yer), yaw (aracın yönü),
   *         map, missionName, raid (bool), finalPos, finalYaw, onDone }
   */
  begin(opts) {
    const g = this.game;
    this.opts = opts;
    this.t = 0;
    this._s = 0;
    this.active = true;
    this.fwd = new THREE.Vector3(Math.cos(opts.yaw), 0, -Math.sin(opts.yaw));
    this.right = new THREE.Vector3(-this.fwd.z, 0, this.fwd.x);
    this.from = opts.stop.clone().addScaledVector(this.fwd, -L);
    this.dust = DUST[opts.map?.zemin] ?? DUST.beton;
    this._nextDust = 0;
    this._nextSmoke = 0;
    this._sounds = new Set();

    g.vehicles.clear();
    const v = g.vehicles.spawn(this.from.clone(), opts.yaw, opts.map);
    this.v = v;

    // Ekip araçta: biri kulede (görünür), diğerleri içeride
    this.riders = g.allies.allies.slice();
    for (const a of this.riders) { a.aboard = v; a.root.visible = false; a.vel.set(0, 0, 0); }
    v.riders = this.riders.slice();
    v.gunner = this.riders[0] ?? null;
    if (v.gunner) v.gunner.root.visible = true;

    // İniş sırası: içeridekiler önce, nişancı en son. Hedefler oyuncunun
    // çevresinde mevzi (Baskın'da pencere mevzileri — oraya kararmada geçilir)
    const order = [...this.riders.slice(1), ...this.riders.slice(0, 1)];
    const P = opts.finalPos;
    const f = this.fwd, r = this.right;
    const spots = opts.spots ?? [
      P.clone().addScaledVector(r, 2.6).addScaledVector(f, 1.2),
      P.clone().addScaledVector(r, -2.6).addScaledVector(f, 1.2),
      P.clone().addScaledVector(r, 1.7).addScaledVector(f, -1.8),
      P.clone().addScaledVector(r, -1.7).addScaledVector(f, -1.8),
    ];
    this.exits = order.map((a, i) => ({
      a, t0: T_EXIT0 + i * EXIT_GAP, target: spots[i % spots.length], done: false,
    }));

    // Ekran: sinema bantları, künye, atlama ipucu
    document.body.classList.add('cinematic', 'cine-bars');
    this.el.root.hidden = false;
    this.el.fade.classList.remove('on');
    const now = new Date();
    const saat = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const kx = 39 + ((opts.stop.x * 7) % 3 + 3) % 3, kz = 41 + ((opts.stop.z * 5) % 4 + 4) % 4;
    this.lines = {
      eyebrow: 'OPERASYON · ÇELİK HAT BİRLİĞİ',
      title: (opts.missionName ?? 'Serbest Hat').toLocaleUpperCase('tr'),
      sub: `${opts.map?.ad ?? ''} · ${saat} · ${kz.toFixed(0)}°K ${kx.toFixed(0)}°D · ${this.riders.length + 1} PERSONEL`,
    };
    for (const k of ['eyebrow', 'title', 'sub']) this.el[k].textContent = '';

    g.weaponry.rig.visible = false;               // elde silah sinematikte görünmez
    g.camera.fov = 42;
    g.camera.updateProjectionMatrix();
  }

  skip() {
    if (!this.active) return;
    this.t = this.opts.raid ? T_RAID_END : T_END;
    this._finish();
  }

  /** Bir kez çalan ses (zaman çizelgesindeki olaylar). */
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
    const f = this.fwd, r = this.right;
    const S = this.opts.stop;

    // ── Araç: sabit yavaşlamayla durma (s = L(1 − (1 − u)²)) ──────────
    const u = clamp01(t / T_DRIVE);
    const s = L * (1 - (1 - u) ** 2);
    v.speed = dt > 0 ? (s - this._s) / dt : 0;
    this._s = s;
    v.pos.copy(this.from).addScaledVector(f, s);
    v.yaw = this.opts.yaw;
    g.player.pos.set(v.pos.x, 0, v.pos.z);      // dünya akışı araca göre

    // Gövde: yolda titreşim, frende burun dalışı, durunca sönen sallanma
    if (v.hull) {
      const moving = clamp01(v.speed / 6);
      let pitch = (Math.sin(t * 23) * 0.004 + Math.sin(t * 7.3) * 0.006) * moving;
      if (u < 1) pitch -= 0.018 * clamp01((t - 1) / 2);
      else pitch -= 0.03 * Math.exp(-(t - T_DRIVE) * 3.2) * Math.cos((t - T_DRIVE) * 11);
      v.hull.rotation.z = pitch;
      v.hull.rotation.x = Math.sin(t * 5.1) * 0.006 * moving;
    }

    // Toz (arka tekerlekler) ve egzoz dumanı
    const fx = g.effects;
    if (v.speed > 1.2 && now > this._nextDust) {
      this._nextDust = now + 0.045;
      for (const side of [-1, 1]) {
        const p = v.pos.clone().addScaledVector(f, -1.7).addScaledVector(r, side * 1.25).setY(0.25);
        const vel = f.clone().multiplyScalar(-v.speed * 0.18)
          .add(new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.6 + Math.random() * 0.9, (Math.random() - 0.5) * 1.6));
        fx.puff(p, vel, this.dust, 0.35 + Math.random() * 0.35, 1.6 + Math.random(), -0.05, 1.1);
      }
    }
    if (v.exhaust && now > this._nextSmoke) {
      this._nextSmoke = now + (v.speed > 1 ? 0.07 : 0.16);
      const p = v.exhaust.getWorldPosition(new THREE.Vector3());
      fx.puff(p, new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.9, (Math.random() - 0.5) * 0.3)
        .addScaledVector(f, -v.speed * 0.4), 0x3b3a37, 0.12 + Math.random() * 0.1, 1.2, -0.2, 1.3);
    }

    // Sesler: fren havası, kapı
    if (t > T_DRIVE - 0.5) this._once('fren', () => g.audio.brakeHiss?.());
    if (t > T_DOOR) this._once('kapi', () => g.audio.doorClunk?.());

    // ── Arka kapı ─────────────────────────────────────────────────────
    if (v.door) v.door.rotation.y = -1.75 * ease(clamp01((t - T_DOOR) / 0.7));

    // Nişancı kuleden iner (içeri girer), en son kapıdan çıkar
    if (t > T_DOOR && v.gunner) {
      v.gunner.root.visible = false;
      v.gunner = null;
    }

    // ── İnen askerler ─────────────────────────────────────────────────
    // Gövdenin içinde hiç görünmezler (kapalı gövde içinden yürüyen asker
    // arka duvardan geçiyor gibi görünüyordu): açık kapının EŞİĞİNDE eğilmiş
    // belirir, basamaktan iner, sonra mevziye koşar.
    const inside = S.clone().addScaledVector(f, -3.35);
    const door = S.clone().addScaledVector(f, -4.7);
    for (const e of this.exits) {
      if (t < e.t0 || e.done) continue;
      const a = e.a;
      a.root.visible = true;
      const k = t - e.t0;
      let pos, speed, look, duck = false;
      const d1 = inside.distanceTo(door);
      const walk = 1.9, jog = 4.2;
      if (k < d1 / walk) {
        // Eşikten basamağa ve zemine (taban 0.5 m); ilk adımda başı eğik
        const q = (k * walk) / d1;
        pos = inside.clone().lerp(door, q);
        pos.y = 0.5 * (1 - clamp01(q * 1.6));
        speed = walk;
        duck = q < 0.35;
        look = f.clone().negate();
      } else {
        const k2 = k - d1 / walk;
        const d2 = door.distanceTo(e.target);
        const q = clamp01((k2 * jog) / d2);
        pos = door.clone().lerp(e.target, q);
        speed = q < 1 ? jog : 0;
        look = q < 1 ? e.target.clone().sub(door) : f.clone();
        if (q >= 1 && k2 > d2 / jog + 0.6) e.done = true;
      }
      a.pos.set(pos.x, 0, pos.z);
      a.root.position.copy(pos);
      a.facing = Math.atan2(-look.x, -look.z);
      a.root.rotation.y = a.facing;
      a.soldier.update({ dt, speed, crouching: duck, downed: false, aimPitch: 0 });
    }
    for (const e of this.exits) {
      if (!e.done) continue;
      e.a.root.position.set(e.target.x, 0, e.target.z);
      e.a.root.rotation.y = Math.atan2(-f.x, -f.z);
      e.a.soldier.update({ dt, speed: 0, crouching: false, downed: false, aimPitch: 0 });
    }

    // ── Künye: daktilo gibi beliren satırlar ─────────────────────────
    const type = (key, start, cps) => {
      const n = Math.max(0, Math.floor((t - start) * cps));
      const text = this.lines[key].slice(0, n);
      if (this.el[key].textContent !== text) this.el[key].textContent = text;
    };
    if (t < 6.2) {
      type('eyebrow', 0.6, 38);
      type('title', 1.1, 22);
      type('sub', 2.2, 40);
      this.el.root.classList.toggle('cine-title-out', t > 5.6);
    } else if (this.el.title.textContent) {
      for (const k of ['eyebrow', 'title', 'sub']) this.el[k].textContent = '';
    }

    // ── Kamera planları ───────────────────────────────────────────────
    const cam = g.camera;
    const vc = v.pos.clone().setY(1.25);
    let pos, look, fov = 50;
    if (t < 2.6) {
      // A: alçak tele çekim, yol kenarından; araç kameraya doğru
      // (kamera boşaltılmış şeridin içinde kalır; dışında sandık/siper olabilir)
      pos = S.clone().addScaledVector(f, -15).addScaledVector(r, 3.9).setY(0.7);
      look = vc;
      fov = 34 + t * 2;
    } else if (t < 4.9) {
      // B: ön-sol çapraz takip — nişancı, farlar
      const k = (t - 2.6) / 2.3;
      pos = v.pos.clone().addScaledVector(f, 7.5 - k * 1.5).addScaledVector(r, -3.6 + k * 0.6).setY(1.35);
      look = v.pos.clone().addScaledVector(f, 0.4).setY(1.75);
      fov = 48;
    } else if (t < 7.1) {
      // C: vinç — yüksekten alana iniş
      const k = ease((t - 4.9) / 2.2);
      pos = S.clone().addScaledVector(f, -13 + k * 2).addScaledVector(r, 5).setY(10 - k * 4.2);
      look = vc.clone().lerp(S.clone().addScaledVector(f, 5).setY(1), 0.35 * (1 - k));
      fov = 55;
    } else if (!this.opts.raid && t >= T_PLAYER) {
      // E: birinci şahıs iniş — kapıdan çık, alana dön
      const k = ease(clamp01((t - T_PLAYER) / 1.5));
      const P = this.opts.finalPos;
      const from = S.clone().addScaledVector(f, -3.4);     // kapı eşiği (gövdenin dışı)
      pos = from.lerp(P, k).setY(1.45 + 0.2 * k + Math.sin(t * 9) * 0.02 * (1 - k));
      const turn = ease(clamp01((t - T_PLAYER - 0.9) / 1.3));
      const dir = f.clone().negate().lerp(f, turn);
      if (dir.lengthSq() < 0.01) dir.copy(r);
      look = pos.clone().add(dir.normalize().multiplyScalar(10)).setY(1.4);
      fov = 70;
      if (t > T_PLAYER + 0.4) document.body.classList.remove('cine-bars');
    } else {
      // D: arka çapraz — kapı ve inen ekip, yavaş yaklaşma
      const k = ease(clamp01((t - 7.1) / 3.9));
      pos = S.clone().addScaledVector(f, -8.8 + k * 1.6).addScaledVector(r, 3.9 - k * 0.8).setY(1.55 - k * 0.15);
      look = S.clone().addScaledVector(f, -3.8).setY(1.05);
      fov = 46;
    }
    // El kamerası titreşimi (birinci şahısta yok)
    if (t < T_PLAYER) {
      pos.x += Math.sin(t * 1.7) * 0.03 + Math.sin(t * 4.3) * 0.012;
      pos.y += Math.sin(t * 2.3) * 0.025;
    }
    cam.position.copy(pos);
    cam.up.copy(UP);
    cam.lookAt(look);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    // Baskın: ekip eve girerken kararır, içeride açılır
    if (this.opts.raid) {
      if (t > T_RAID_FADE) this.el.fade.classList.add('on');
      if (t >= T_RAID_END) this._finish();
    } else if (t >= T_END) {
      this._finish();
    }
  }

  _finish() {
    if (!this.active) return;
    this.active = false;
    const g = this.game;
    const v = this.v;
    const f = this.fwd;

    if (this.opts.raid) {
      g.vehicles.clear();
      for (const a of this.riders) {
        a.aboard = null;
        a.root.visible = true;
        if (a.post) { a.pos.copy(a.post.pos); a.facing = a.post.facing; }
        a.root.position.copy(a.pos);
        a.root.rotation.y = a.facing;
      }
    } else {
      v.pos.copy(this.opts.stop);
      v.speed = 0;
      if (v.hull) v.hull.rotation.set(0, 0, 0);
      if (v.door) v.door.rotation.y = 0;          // kapı kapanır
      v.riders = [];
      v.gunner = null;
      for (const e of this.exits) {
        const a = e.a;
        a.aboard = null;
        a.root.visible = true;
        a.pos.set(e.target.x, 0, e.target.z);
        a.facing = Math.atan2(-f.x, -f.z);
        a.root.position.copy(a.pos);
        a.root.rotation.y = a.facing;
      }
    }

    g.player.pos.copy(this.opts.finalPos);
    g.player.yaw = this.opts.finalYaw;
    g.player.pitch = 0;
    g.player.vel.set(0, 0, 0);

    document.body.classList.remove('cinematic', 'cine-bars');
    this.el.root.hidden = true;
    this.el.root.classList.remove('cine-title-out');
    setTimeout(() => this.el.fade.classList.remove('on'), 120);
    this.opts.onDone?.();
  }
}
