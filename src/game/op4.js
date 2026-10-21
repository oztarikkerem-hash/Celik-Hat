/* Tümgeneral — dördüncü özel görev (Suikast'ın devamı).

   1. KAÇIŞ SİNEMATİĞİ: komutan yerde; şehrin karargâhından koşarak
      uzaklaşırsın, yanından kurşunlar geçer. Dönüp baktığında arazi
      aracın roketle patlar.
   2. KAÇIŞ (≈1 km): şehrin girişine kadar yaya; her sokaktan düşman çıkar,
      arkandan da kovalarlar (aynı anda 8, ölen hemen yenilenir). Girişte
      iki muhafızın beklediği bir düşman arazi aracı: F ile bin.
   3. YOL: patikadan geri, 2.4 km ötede ormandaki karargâh.
   4. KARARGÂH SİNEMATİĞİ: ellerini komutana ve silah arkadaşlarına uzatıp
      bitkin bir sesle özür dilersin; komutan seni affeder ve tümgeneralliğe
      terfi ettirir (seslendirme İngilizce, altyazı Türkçe).
   5. TAARRUZ: aynı şehir, bu kez yarıçapı 500 km. 2000 asker (5 kol)
      karşısında 2500 düşman (army.js). H: komuta menüsü — kol seç (1–5,
      6 = hepsi), emir ver: 1 saldır · 2 siper al · 3 işaretli yere git
      (nişangâhın baktığı nokta). Düşmanın son %5'i teslim olur; zayiat 500.
   6. KULE: şehrin en yüksek binası (128 m). Kapıda E: asansörle çatıya;
      çatıda E: Türk bayrağını dik — bayrak dalgalanır, bölüm biter.    */

import * as THREE from 'three';
import { Road } from './road.js';
import { City, CITY, buildingGeo } from './city.js';
import { OP3 } from './op3.js';
import { Soldier } from './soldier.js';
import { mapById } from './maps.js';
import { makeFlag } from './flag.js';
import { buildJeep } from './jeep.js';
import { FPArms, POSES } from './fparms.js';
import { Army, ARMY, ORDER_NAMES } from './army.js';
import { ParkLife } from './parklife.js';
import { structures } from './structures.js';

export const OP4 = {
  hq: [-2, 9],            // Suikast'taki düşman karargâhı (komutan burada öldü)
  campS: 5600,            // patikada kendi karargâhımız (m)
  tower: [0, 16],         // Taarruz: en yüksek binanın bloğu
  towerH: 128,
  towerW: 32,
  escapeAlive: 8,         // kaçışta aynı anda yaşayan düşman
  cityRadius: 500000,     // Taarruz şehri (m)
};

const LINES = {
  op4_01: ['Sen', 'Üzgünüm komutanım… Ben bir hata yaptım. Ben suçluyum. Ben ölmeyi hak ettim. Eğer bana ceza vermezseniz, asıl suçlu siz olursunuz.'],
  op4_02: ['Komutan', 'Sen kahraman bir askersin. Ağlama. O füze insanlara zarar vermedi. Şimdi sana ihtiyacımız var.'],
  op4_03: ['Komutan', 'Bugünden itibaren tümgeneralsin. Şehre taarruzun komutası sende.'],
  op4_10: ['Düşman askeri', 'İşte orada! Komutanı o öldürdü! Ateş!'],
  op4_11: ['Düşman askeri', 'Roket! Arabayı vurun!'],
  op4_20: ['Telsiz', 'Bütün kollar, ileri! Şehri alın!'],
  op4_21: ['Telsiz', 'Anlaşıldı generalim, siper alıyoruz!'],
  op4_22: ['Telsiz', 'Saldır! İleri, ileri!'],
  op4_23: ['Telsiz', 'İşaretli noktaya ilerliyoruz!'],
  op4_30: ['Telsiz', 'Şehir bizim generalim! Düşman teslim oluyor!'],
  op4_31: ['Komutan', 'Bayrağımızı en yüksek kuleye dik, generalim.'],
};
export const OP4_VOICES = Object.keys(LINES);

const smooth = (x) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export class Op4 {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.phase = null;
    this.checkpoint = null;          // 'escape' | 'assault'
    this.city = null;
    this.road = null;
    this.army = null;
    this.cmd = null;                 // komuta menüsü durumu
  }

  /** Harita gizli, sektör akışı durmuş mu (şehir/yol arenası). */
  get arenaActive() { return this.active; }

  /* ── Başlangıç / bitiş ────────────────────────────────────────────── */

  begin(checkpoint = null) {
    const g = this.game;
    this.active = true;
    this._lines = new Set();
    this._timers = [];
    this.navTarget = null;
    this.escapers = [];
    this.exitGuards = null;
    this.O = g.op3.road.point(OP3.road.length, 0);
    g.world.setVisible(false);
    if (!this._half) { this._half = g.world.half; g.world.half = 1e6; }
    g.world.setTheme(mapById('sanayi'));
    g.world.setClearZone(null);
    g.world.setClearRects([]);
    this._fog = { near: g.scene.fog.near, far: g.scene.fog.far };
    if (checkpoint === 'assault') this._startAssault(true);
    else if (checkpoint === 'escape') this._startEscape(true);
    else this._startFlee();
  }

  end() {
    if (!this.active) return;
    const g = this.game;
    this.active = false;
    this.phase = null;
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
    this._closeMenu();
    this._clearCity();
    this._clearRoad();
    this._clearCamp();
    this._clearAssault();
    if (this.wreckJeep) this.wreckJeep = null;
    if (this._half) { g.world.half = this._half; this._half = 0; }
    if (this._fog) { g.scene.fog.near = this._fog.near; g.scene.fog.far = this._fog.far; }
    g.world.setVisible(true);
    g.enemies.corpseTime = 12;
    g.audio.engineStop?.();
    this._subtitle(null);
    this._setArms(false);
    document.getElementById('army-panel').hidden = true;
    document.getElementById('rank-card').hidden = true;
    document.body.classList.remove('op4-assault');
    g.vehicles.clear();
  }

  _later(ms, fn) {
    const t = setTimeout(() => { if (this.active) fn(); }, ms);
    this._timers.push(t);
  }

  _grant(list) {
    const g = this.game, w = g.weaponry;
    w.allowed = new Set(list.map(([id]) => id));
    for (const [id, mag, reserve] of list) {
      const s = w.slots.find((x) => x.def.id === id);
      if (s) { s.ammo = mag; s.reserve = reserve; }
    }
    const usable = w.slots.filter((x) => w.usable(x.def.id));
    const first = usable.find((x) => x.def.id === list[0][0]);
    if (first) w.equipSlot(first.def.slot ?? 1);
    g.hud.buildWeaponStrip(usable, w.current.def.id);
  }

  /* ── Seslendirme ve altyazı ───────────────────────────────────────── */

  async say(id, { radio = false } = {}) {
    const [who, text] = LINES[id];
    this._subtitle(radio ? `${who} 📻` : who, text);
    const g = this.game;
    g.audio.init();
    const dur = await g.audio.playVoice(`assets/voice/${id}.m4a`, 2.6 + text.length * 0.05);
    const until = performance.now() + dur * 1000 + 300;
    this._subUntil = until;
    await new Promise((r) => setTimeout(r, dur * 1000 + 300));
    if (this._subUntil === until) this._subtitle(null);
    return dur;
  }

  _subtitle(who, text) {
    const el = document.getElementById('subtitle');
    if (!el) return;
    if (!who) { el.hidden = true; return; }
    el.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = who;
    el.append(b, document.createTextNode(` ${text}`));
    el.hidden = false;
  }

  _sun(p) {
    const W = this.game.world;
    W.sun.target.position.set(p.x, 0, p.z);
    W.sun.position.copy(W.sunDir).multiplyScalar(90).add(W.sun.target.position);
    W.sun.target.updateMatrixWorld();
  }

  _cine(on) {
    const el = document.getElementById('cine');
    el.hidden = !on;
    document.body.classList.toggle('cinematic', on);
    document.body.classList.toggle('cine-bars', on);
    if (on) {
      document.getElementById('army-panel').hidden = true;
      document.getElementById('cine-title').textContent = '';
      document.getElementById('cine-eyebrow').textContent = '';
      document.getElementById('cine-sub').textContent = '';
      el.classList.add('cine-title-out');
    }
  }

  _card(eyebrow, title, sub) {
    const el = document.getElementById('cine');
    document.getElementById('cine-eyebrow').textContent = eyebrow;
    document.getElementById('cine-title').textContent = title;
    document.getElementById('cine-sub').textContent = sub;
    el.classList.remove('cine-title-out');
  }

  _fade(on) { document.getElementById('op-fade').classList.toggle('on', on); }

  /* ── Şehir (Suikast'taki şehir) ───────────────────────────────────── */

  /** Bir noktayı en yakın sokağa çeker. */
  _street(x, z) {
    const B = CITY.block, S = CITY.half + CITY.walk - 0.8, O = this.O;
    const ax = O.x + Math.round((x - O.x) / B) * B, az = O.z - Math.round((O.z - z) / B) * B;
    const dx = x - ax, dz = z - az;
    if (Math.abs(dx) < S || Math.abs(dz) < S) return new THREE.Vector3(x, 0, z);
    return Math.abs(dx) < Math.abs(dz)
      ? new THREE.Vector3(ax + Math.sign(dx) * (S - 0.5), 0, z)
      : new THREE.Vector3(x, 0, az + Math.sign(dz) * (S - 0.5));
  }

  _openCity() {
    const g = this.game;
    this._clearCity();
    this.city = new City(g, { gunShops: true });
    // Parkta banklara oturan düşmanlar: kaçışta seni görünce kalkıp saldırır
    this.parks = new ParkLife(g, this.city, {
      wakeR: 28,
      onSpawn: (e) => this.escapers.push(e),
      onStand: (e) => { e.neutral = false; e.patrol = null; },
    });
    const [qi, qj] = OP4.hq;
    // Düşman karargâhı: kum torbası halkası ve çadır (Suikast'taki gibi)
    this.city.specials.set(`${qi},${qj}`, { parcel: [1, 0], noProps: true, build: (ctx) => this._buildEnemyHq(ctx) });
    this.city.start(this.O);
    const K = CITY.half + CITY.walk + 1.5;
    const half = (CITY.block - 2 * K) / 2;
    const c = this.city.corner(qi, qj);
    this.hqSpot = new THREE.Vector3(c.x + K + half + half / 2, 0, c.z - (K + half / 2));
  }

  _buildEnemyHq({ own, solid }) {
    const M = this.city._m;
    const K = CITY.half + CITY.walk + 1.5;
    const half = (CITY.block - 2 * K) / 2;
    const cx = K + half + half / 2, cz = K + half / 2;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      if (Math.abs(Math.sin(a) + 1) < 0.35) continue;
      const bag = own(new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 0.8), M.bag));
      bag.position.set(cx + Math.cos(a) * 11, 0.55, -(cz + Math.sin(a) * 11));
      bag.rotation.y = -a + Math.PI / 2;
      solid(bag);
    }
    const tent = own(new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 4.5), M.bag));
    tent.position.set(cx, 1.2, -(cz + 5.5));
    solid(tent);
    const top = own(new THREE.Mesh(new THREE.ConeGeometry(4.3, 1.4, 4), M.bag));
    top.position.set(cx, 3.1, -(cz + 5.5));
    top.rotation.y = Math.PI / 4;
  }

  _clearCity() {
    const g = this.game;
    this.parks?.clear();
    this.parks = null;
    if (this.city) { this.city.stop(); this.city = null; }
    for (const e of this.escapers ?? []) if (e.alive) g.enemies.despawn(e);
    this.escapers = [];
  }

  /* ── 1. Kaçış sinematiği ──────────────────────────────────────────── */

  _startFlee() {
    const g = this.game;
    this.phase = 'flee';
    this._openCity();
    const hq = this.hqSpot;
    this._grant([['mar556', 30, 120], ['deagle', 7, 21]]);
    g.grenades.count = 2;
    g.hud.setGrenades(2);
    g.enemies.corpseTime = 40;

    // Yerde yatan komutan ve iki koruması (ragdoll ile yığılırlar; Suikast'ta
    // vuruldukları için bu bölümün puanına/sayacına yazılmazlar)
    const onKill = g.enemies.onKill;
    g.enemies.onKill = null;
    for (const [dx, dz, type] of [[0, 0, 'brute'], [-3.5, 1.5, 'runner'], [3.5, 1.5, 'runner']]) {
      const e = g.enemies.spawnAt(type, hq.clone().add(new THREE.Vector3(dx, 0, dz)), 1);
      e.facing = Math.PI;
      g.enemies.kill(e, performance.now() / 1000, new THREE.Vector3(0, 0, -1), { force: 12 });
    }
    g.enemies.onKill = onKill;
    // Arazi aracımız: karargâhın güney girişinin hemen dışında
    this.ourJeep = g.vehicles.spawn(hq.clone().add(new THREE.Vector3(4, 0, 15)), 0.4, null, { model: 'jeep' });

    const cam = g.camera;
    const p0 = hq.clone().add(new THREE.Vector3(0, 0, 3));
    const p1 = hq.clone().add(new THREE.Vector3(-1.2, 0, 33));
    g.player.pos.copy(p0);
    cam.position.set(p0.x, 1.66, p0.z);
    cam.rotation.set(0, Math.PI, 0);
    cam.updateMatrixWorld();
    this.city.update(hq, true);
    this.city.update(p1, true);

    g.state = 'cinematic';
    this._cine(true);
    let t = 0, nextShot = 0.2, rocket = null, blown = false;
    const look = new THREE.Vector3();
    const finish = () => {
      if (g.activeCine !== cine) return;
      g.activeCine = null;
      this._cine(false);
      if (!blown) this._blowJeep();
      g.player.pos.set(p1.x, 0, p1.z);
      g.player.yaw = Math.PI;
      g.player.pitch = 0;
      g.state = 'playing';
      this._startEscape(false);
    };
    const cine = {
      update: (dt) => {
        t += dt;
        g.physics.step(dt);                     // ragdoll'lar yığılsın
        for (const e of g.enemies.dying) e.ragdoll?.update(dt);
        this.city.update(cam.position);
        // Koşu: 0–5.6 sn ileri (güneye), adım sallantısı
        const run = smooth(t / 5.8);
        const pos = p0.clone().lerp(p1, run);
        const bob = t < 5.8 ? Math.sin(t * 11) * 0.06 : 0;
        cam.position.set(pos.x + Math.sin(t * 5.5) * 0.04, 1.62 + bob, pos.z);
        // Bakış: önce ileri, 5.6–6.8 sn arkaya döner, 10–11 sn yeniden ileri
        // Geri bakış yönü aracın gerçek konumundan (biraz soluna: patlama ortada kalsın)
        const jp = this.ourJeep.pos;
        const back = Math.atan2(-(jp.x - cam.position.x), -(jp.z - cam.position.z)) + 0.06;
        let yaw = Math.PI;
        if (t > 5.4) yaw = lerpAngle(Math.PI, back, smooth((t - 5.4) / 1.2));
        if (t > 10.2) yaw = lerpAngle(back, Math.PI, smooth((t - 10.2) / 1.0));
        const pitch = t > 5.4 && t < 10.5 ? -0.04 : -0.02;
        look.set(cam.position.x - Math.sin(yaw), cam.position.y + pitch, cam.position.z - Math.cos(yaw));
        cam.lookAt(look);
        if (this._shake) {
          cam.position.x += (Math.random() - 0.5) * this._shake;
          cam.position.y += (Math.random() - 0.5) * this._shake;
          this._shake *= Math.pow(0.02, dt);
        }
        // Yanından geçen kurşunlar (arkadan)
        if (t < 9.5 && t > nextShot) {
          nextShot = t + 0.08 + Math.random() * 0.22;
          const back = new THREE.Vector3(0, 0, -1);           // kuzey (karargâh)
          const from = cam.position.clone().addScaledVector(back, 25 + Math.random() * 20)
            .add(new THREE.Vector3((Math.random() - 0.5) * 10, Math.random() * 3, 0));
          const side = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 1.6);
          const to = cam.position.clone().add(new THREE.Vector3(side, (Math.random() - 0.6) * 1.2, 30 + Math.random() * 20));
          g.effects.tracer(from, to, 0xffb070);
          if (Math.random() < 0.6) g.audio.whiz?.();
          if (Math.random() < 0.35) {
            const hit = cam.position.clone().add(new THREE.Vector3(side * 1.5, -1.6, 4 + Math.random() * 8));
            hit.y = 0.02;
            g.effects.sparks(hit, new THREE.Vector3(0, 1, 0), 0xffc06a, 6);
          }
          if (Math.random() < 0.5) g.audio.distantShot?.(28);
        }
        if (t > 0.5 && !this._lines.has('op4_10')) { this._lines.add('op4_10'); this.say('op4_10'); }
        if (t > 5.9 && !this._lines.has('op4_11')) { this._lines.add('op4_11'); this.say('op4_11'); }
        // Roket: karargâh çatısından araca
        if (t > 6.4 && !rocket && !blown) {
          rocket = this._launchRocket(hq.clone().add(new THREE.Vector3(-6, 7, -12)), this.ourJeep.pos.clone().setY(1));
        }
        if (rocket && !blown) {
          rocket.t += dt / 0.65;
          const p = rocket.from.clone().lerp(rocket.to, Math.min(1, rocket.t));
          rocket.mesh.position.copy(p);
          g.effects.puff(p, new THREE.Vector3(0, 0.4, 0), 0x8a857c, 0.35, 1.4, 0.2, 1.2);
          if (rocket.t >= 1) {
            g.scene.remove(rocket.mesh);
            blown = true;
            this._blowJeep();
          }
        }
        this._updateFx(dt);
        if (blown && Math.random() < 0.6) {
          g.effects.puff(this.ourJeep.pos.clone().setY(1.6), new THREE.Vector3((Math.random() - 0.5) * 0.6, 2.4, 0), 0x2a2622, 2.2, 4, 0.5, 0.7);
          if (Math.random() < 0.5) g.effects.puff(this.ourJeep.pos.clone().setY(1.2), new THREE.Vector3((Math.random() - 0.5) * 0.5, 1.8, 0), 0xff7a20, 0.9, 0.6, 0.6, 1.2);
        }
        if (t > 11.6) finish();
      },
      skip: () => finish(),
    };
    g.activeCine = cine;
  }

  _launchRocket(from, to) {
    const g = this.game;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3d33, emissive: 0xff7a20, emissiveIntensity: 0.6 }));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    g.scene.add(mesh);
    g.audio.rocketMotor?.();
    return { mesh, from, to, t: 0 };
  }

  _blowJeep() {
    const g = this.game, v = this.ourJeep;
    if (!v || v.dead) return;
    g.vehicles._destroy(v);
    g.effects.explode(v.pos.clone().setY(1.2), 0xff8a2a, 90);
    this._fireball(v.pos.clone().setY(1.1));
    this._shake = 0.35;
    this.wreckJeep = v;
  }

  /* Ateş topu: genişleyip sönen iç içe alev küreleri + anlık ışık + kalın
     duman. (Parçacık kıvılcımları uzaktan 3–4 piksel kalıyordu.)          */
  _fireball(at) {
    const g = this.game;
    const group = new THREE.Group();
    group.position.copy(at);
    const balls = [];
    for (let k = 0; k < 7; k++) {
      const mat = new THREE.MeshBasicMaterial({
        color: k < 2 ? 0xc87a28 : k < 5 ? 0xb8521a : 0x8a2c0c,
        transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), mat);
      m.position.set((Math.random() - 0.5) * 1.8, Math.random() * 1.2, (Math.random() - 0.5) * 1.8);
      group.add(m);
      balls.push({ m, grow: 2.2 + Math.random() * 2.2, rise: 1 + Math.random() * 2, delay: k * 0.03 });
    }
    const light = new THREE.PointLight(0xffa040, 60, 45, 1.6);
    light.position.y = 1.5;
    group.add(light);
    g.scene.add(group);
    for (let k = 0; k < 18; k++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5);
      g.effects.puff(at.clone().add(new THREE.Vector3(0, 0.6, 0)), v, k % 3 ? 0x2b2723 : 0x4a423a, 1.6 + Math.random() * 1.4, 3 + Math.random() * 2, 0.3, 1.1);
    }
    this._fx = this._fx ?? [];
    this._fx.push({ group, balls, light, t: 0 });
  }

  _updateFx(dt) {
    if (!this._fx?.length) return;
    const g = this.game;
    for (let i = this._fx.length - 1; i >= 0; i--) {
      const f = this._fx[i];
      f.t += dt;
      for (const b of f.balls) {
        const k = Math.max(0, f.t - b.delay) / 0.9;
        b.m.scale.setScalar(0.3 + b.grow * Math.sqrt(Math.min(1, k)));
        b.m.position.y += b.rise * dt;
        b.m.material.opacity = Math.max(0, 1 - k);
      }
      f.light.intensity = Math.max(0, 60 * (1 - f.t / 0.7));
      if (f.t > 1.2) {
        g.scene.remove(f.group);
        for (const b of f.balls) { b.m.geometry.dispose(); b.m.material.dispose(); }
        this._fx.splice(i, 1);
      }
    }
  }

  /* ── 2. Kaçış: 1 km çatışma ───────────────────────────────────────── */

  _startEscape(fromCheckpoint) {
    const g = this.game;
    this.phase = 'escape';
    this.checkpoint = 'escape';
    if (fromCheckpoint) {
      this._openCity();
      this._grant([['mar556', 30, 120], ['deagle', 7, 21]]);
      g.grenades.count = 2;
      g.hud.setGrenades(2);
      g.enemies.corpseTime = 40;
      const p1 = this.hqSpot.clone().add(new THREE.Vector3(-1.2, 0, 33));
      g.player.pos.copy(p1);
      g.player.yaw = Math.PI;
      // Patlamış aracımız yerinde yanıyor
      this.ourJeep = g.vehicles.spawn(this.hqSpot.clone().add(new THREE.Vector3(4, 0, 15)), 0.4, null, { model: 'jeep' });
      g.vehicles._destroy(this.ourJeep);
      this.wreckJeep = this.ourJeep;
      this.city.update(g.player.pos, true);
    }
    // Çıkış: şehrin girişi; orada bir düşman arazi aracı bekler
    this.exitPos = this.O.clone().add(new THREE.Vector3(2.2, 0, -10));
    this.exitJeep = g.vehicles.spawn(this.exitPos.clone(), -Math.PI / 2, null, { model: 'jeep' });
    this.navTarget = this.exitPos.clone();
    this.navOn = true;
    this._spawnAt = 0;
    this.escapeKills = 0;
    // Mühimmat sandıkları: rotanın üçte biri ve üçte ikisinde
    const r = this.city.route(g.player.pos, this.exitPos);
    const total = this._routeLen(r);
    const at = (f) => {
      let d = total * f;
      for (let i = 1; i < r.length; i++) {
        const l = r[i].distanceTo(r[i - 1]);
        if (d <= l) return r[i - 1].clone().lerp(r[i], d / l);
        d -= l;
      }
      return r[r.length - 1].clone();
    };
    g.crates.place([0.33, 0.68].map((f) => {
      const p = this._street(...(() => { const q = at(f); return [q.x + 4, q.z]; })());
      return { pos: p, yaw: Math.random() * Math.PI };
    }));
    g.hud.banner('KAÇ!', 'ŞEHRİN ÇIKIŞINA ~1 KM — HER SOKAKTA DÜŞMAN VAR', 4800);
  }

  _routeLen(r) {
    let d = 0;
    for (let i = 1; i < r.length; i++) d += r[i].distanceTo(r[i - 1]);
    return d;
  }

  _updateEscape(dt, now) {
    const g = this.game, p = g.player.pos;
    const ref = g.vehicles.driving?.pos ?? p;
    this.city.update(ref);
    this.parks?.update(now);
    this._sun(ref);
    this._updateFx(dt);
    if (this.wreckJeep && Math.random() < 0.4 && this.wreckJeep.pos.distanceTo(p) < 200) {
      g.effects.puff(this.wreckJeep.pos.clone().setY(1.6), new THREE.Vector3((Math.random() - 0.5) * 0.6, 2.4, 0), 0x2a2622, 2.2, 4, 0.5, 0.7);
    }
    // Düşman akışı: aynı anda 8 (yarısından çoğu önde, kalanı arkadan kovalar)
    this.escapers = this.escapers.filter((e) => {
      if (!e.alive) { if (e._counted !== true) { e._counted = true; this.escapeKills++; } return false; }
      if (e.pos.distanceTo(p) > 175) { g.enemies.despawn(e); return false; }
      return true;
    });
    const toExit = this.exitPos.clone().sub(p).setY(0);
    const left = toExit.length();
    if (left > 60 && this.escapers.length < OP4.escapeAlive && now > this._spawnAt) {
      this._spawnAt = now + 1.1 + Math.random() * 0.8;
      const ahead = toExit.normalize();
      const front = Math.random() < 0.62;
      const R = 50 + Math.random() * 55;
      const perp = new THREE.Vector3(-ahead.z, 0, ahead.x).multiplyScalar((Math.random() - 0.5) * 80);
      const q = p.clone().addScaledVector(ahead, front ? Math.min(R, left - 20) : -R * 0.8).add(perp);
      const s = this._street(q.x, q.z);
      if (s.distanceTo(p) > 32 && this.city.inCity(s.x, s.z)) {
        const e = g.enemies.spawnAt(Math.random() < 0.3 ? 'brute' : 'runner', s, 2);
        this.escapers.push(e);
      }
    }
    // Çıkıştaki muhafızlar
    if (!this.exitGuards && left < 170) {
      this.exitGuards = [[-4, 3], [5, 2], [0, -6]].map(([dx, dz]) => {
        const e = g.enemies.spawnAt('brute', this._street(this.exitPos.x + dx, this.exitPos.z + dz), 2);
        this.escapers.push(e);
        return e;
      });
    }
    if (g.vehicles.driving === this.exitJeep) this._startDrive();
  }

  /* ── 3. Yol: patikadan karargâha ──────────────────────────────────── */

  _startDrive() {
    const g = this.game;
    this.phase = 'drive';
    this.navOn = true;
    for (const e of this.escapers) if (e.alive && e.pos.distanceTo(g.player.pos) > 25) g.enemies.despawn(e);
    this.escapers = this.escapers.filter((e) => e.alive);
    g.crates.place([]);
    // Patika ters yönde sürülür: akış penceresi de ters (geride çok, önde az)
    this.road = new Road(g, { ...OP3.road, ahead: 260, behind: 760, clearings: [{ s: OP4.campS, lat: 0, r: 40 }] });
    this.road.start();
    const s = this.road.progress(this.exitJeep.pos);
    this.road.update(s, true);
    this._buildCamp();
    g.hud.banner('YOL', 'PATİKADAN GERİ DÖN — KARARGÂH 2.4 KM', 4200);
  }

  _clearRoad() {
    if (this.road) { this.road.stop(); this.road = null; }
  }

  _updateDrive(dt, now) {
    const g = this.game;
    const p = g.vehicles.driving?.pos ?? g.player.pos;
    const s = this.road.progress(p);
    this.road.update(Math.max(0, s));
    if (this.city) {
      if (s < OP3.road.length - 700) this._clearCity();
      else this.city.update(p);
    }
    this._sun(p);
    this.camp?.flag.userData.tick(dt);
    if (s < OP4.campS + 26) this._campScene();
  }

  /* ── Karargâh (patikada, kendi tarafımız) ─────────────────────────── */

  _campFrame() {
    const r = this.road, s0 = OP4.campS;
    return {
      at: (ds, lat) => r.point(s0 + ds, lat),
      // Oyuncu kuzeyden (s büyükten) gelir; kamp güneye doğru dizilir
      yawToward: (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z)),
    };
  }

  _buildCamp() {
    const g = this.game;
    this._clearCamp();
    const F = this._campFrame();
    const group = new THREE.Group();
    const colliders = [], solids = [];
    const W = g.world.materials;
    const canvas = new THREE.MeshStandardMaterial({ color: 0x55603f, roughness: 0.95 });
    const add = (mesh, solid = true) => {
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      if (solid) {
        mesh.updateMatrixWorld(true);
        solids.push(mesh);
        colliders.push(new THREE.Box3().setFromObject(mesh));
      }
      return mesh;
    };
    // Çadırlar (yolun iki yanında)
    for (const [ds, lat] of [[-14, -12], [-4, -13], [-16, 12], [-2, 12.5]]) {
      const p = F.at(ds, lat);
      const tent = add(new THREE.Mesh(new THREE.BoxGeometry(5, 2.2, 4), canvas));
      tent.position.set(p.x, 1.1, p.z);
      const roof = add(new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.2, 4), canvas), false);
      roof.position.set(p.x, 2.8, p.z);
      roof.rotation.y = Math.PI / 4;
    }
    // Kum torbası mevzileri
    for (const [ds, lat, rot] of [[8, -6, 0], [8, 6, 0], [-24, -6, 0], [-24, 6, 0]]) {
      const p = F.at(ds, lat);
      const bag = add(new THREE.Mesh(new THREE.BoxGeometry(4, 1.1, 0.8), W.sandbag));
      bag.position.set(p.x, 0.55, p.z);
      bag.rotation.y = rot;
    }
    // Park hâlindeki iki arazi aracı
    for (const [ds, lat] of [[-10, 8], [-20, -8]]) {
      const p = F.at(ds, lat);
      const j = buildJeep(0x4b5434);
      j.position.set(p.x, 0, p.z);
      j.rotation.y = Math.PI / 2;
      add(j, false);
      j.updateMatrixWorld(true);
      colliders.push(new THREE.Box3().setFromObject(j));
    }
    // Göndere Türk bayrağı
    const fp = F.at(-7, -6.5);
    const flag = makeFlag(9, 1.8);
    flag.position.set(fp.x, 0, fp.z);
    flag.rotation.y = -Math.PI / 2;
    group.add(flag);
    g.scene.add(group);
    const fixture = { colliders, solids, cover: [] };
    g.world.addFixture(fixture);

    // Komutan ve üç silah arkadaşı (yolun ortasında, kuzeye dönük)
    const people = [];
    const mk = (ds, lat, rifle = true) => {
      const s = new Soldier(g.soldiers.create(), { team: 'ally', rifle: rifle ? g.gear?.makeRifle('mar556') ?? null : null, tint: null });
      const p = F.at(ds, lat);
      s.root.position.copy(p);
      s.root.rotation.y = F.yawToward(p, F.at(ds + 10, lat));
      for (const m of s.hitMeshes) m.userData = {};
      g.scene.add(s.root);
      people.push(s);
      return s;
    };
    const commander = mk(-8, 0);
    mk(-7, -2.4); mk(-7.4, 2.5); mk(-9.6, -4.2);
    this.camp = { group, fixture, flag, people, commander };
  }

  _clearCamp() {
    const g = this.game;
    if (!this.camp) return;
    g.scene.remove(this.camp.group);
    g.world.removeFixture(this.camp.fixture);
    for (const s of this.camp.people) g.scene.remove(s.root);
    this.camp = null;
  }

  /* ── 4. Karargâh sinematiği: özür ve terfi ────────────────────────── */

  _setArms(on) {
    const g = this.game;
    if (on && !this.arms && g.soldiers?.template) {
      this.arms = new FPArms(g.soldiers.template, g.soldiers.height);
      this.armsHolder = new THREE.Group();
      this.armsHolder.add(this.arms.root);
      this.arms.setStance(0, new THREE.Vector3(0, -0.27, 0.16));
    }
    if (!this.arms) return;
    if (on) g.camera.add(this.armsHolder);
    else this.armsHolder.parent?.remove(this.armsHolder);
  }

  /** Eller öne, avuçlar yukarı uzanır (e: 0 aşağıda, 1 uzanmış). */
  _poseArms(e, t) {
    const g = this.game, cam = g.camera;
    cam.updateMatrixWorld(true);
    const camQ = cam.getWorldQuaternion(new THREE.Quaternion());
    const tremble = 0.006 * Math.sin(t * 23) + 0.004 * Math.sin(t * 37);
    for (const [side, sx] of [['R', 1], ['L', -1]]) {
      const down = new THREE.Vector3(sx * 0.2, -0.62, -0.12);
      const out = new THREE.Vector3(sx * 0.17, -0.13 + tremble, -0.47 - tremble);
      const local = down.lerp(out, smooth(e));
      const pos = cam.localToWorld(local.clone());
      const k = new THREE.Vector3(sx * 0.12, -0.18, -1).normalize().applyQuaternion(camQ);
      const n = new THREE.Vector3(-sx * 0.2, 1, 0.15).normalize().applyQuaternion(camQ);
      const pole = new THREE.Vector3(sx * 0.7, -1, 0.3).normalize().applyQuaternion(camQ);
      this.arms.reach(side, { pos, k, n }, POSES.open, pole);
    }
  }

  _campScene() {
    const g = this.game;
    if (this.phase === 'camp') return;
    this.phase = 'camp';
    this.navOn = false;
    for (const e of this.escapers) if (e.alive) g.enemies.despawn(e);
    this.escapers = [];
    const F = this._campFrame();
    const c = this.camp.commander;
    this._fade(true);
    g.state = 'cinematic';
    this._cine(true);
    g.hud.setTacho(null);
    g.audio.engineStop?.();
    this._later(900, () => {
      g.vehicles.exit();
      g.hud.setTacho(null);
      g.audio.engineStop?.();
      this.road.update(OP4.campS, true);      // ışınlanınca da zemin hazır olsun
      const v = this.exitJeep;
      if (v) {
        const vp = F.at(14, 2);
        v.pos.copy(vp); v.speed = 0;
        v.yaw = -Math.PI / 2;
      }
      g.player.pos.copy(F.at(-5.8, 0));
      this._fade(false);
      start();
    });
    const cam = g.camera;
    let t = 0;
    const look = new THREE.Vector3();
    const start = () => {
      this._setArms(true);
      const eye = F.at(-5.8, 0).setY(1.6);
      const head = c.root.position.clone().setY(1.62);
      g.activeCine = {
        update: (dt) => {
          t += dt;
          this.camp?.flag.userData.tick(dt);
          for (const s of this.camp.people) s.update({ dt, speed: 0, crouching: false, downed: false, aimPitch: 0, aiming: false });
          // Bitkin: göz hafif aşağıda, nefes sallantısı; konuşurken başı eğik
          const breath = Math.sin(t * 1.7) * 0.012;
          cam.position.copy(eye).add(new THREE.Vector3(0, breath - (t > 2 && t < 18 ? 0.05 : 0), 0));
          const bow = t > 2 && t < 18 ? -0.22 : t >= 18 && t < 30 ? -0.06 : 0;
          look.copy(head).add(new THREE.Vector3(0, bow * 4, 0));
          // Arkadaşlara da dönüp bakar (6–10 sn)
          if (t > 6 && t < 10.5) look.lerp(this.camp.people[1].root.position.clone().setY(1.4), Math.sin(((t - 6) / 4.5) * Math.PI) * 0.8);
          cam.lookAt(look);
          // Eller: 1–2.6 sn uzanır, 18–20 sn iner
          const ext = t < 1 ? 0 : t < 18 ? smooth((t - 1) / 1.6) : 1 - smooth((t - 18) / 2);
          this._poseArms(ext, t);
          this.armsHolder.visible = ext > 0.01;
          if (t > 1.6 && !this._lines.has('op4_01')) { this._lines.add('op4_01'); this.say('op4_01'); }
          if (t > 19 && !this._lines.has('op4_02')) { this._lines.add('op4_02'); this.say('op4_02'); }
          if (t > 29 && !this._lines.has('op4_03')) { this._lines.add('op4_03'); this.say('op4_03'); }
          if (t > 31 && !this._rank) { this._rank = true; this._showRank(true); }
          if (t > 38.5 && !this._titled) {
            this._titled = true;
            this._showRank(false);
            this._card('4. BÖLÜM · KAÇIŞ', 'TÜMGENERAL', 'Komutan seni affetti. Şehre taarruz başlıyor: 2.000 asker, 5 kol — karşında 2.500 düşman.');
          }
          if (t > 45) finish();
        },
        skip: () => finish(),
      };
    };
    const finish = () => {
      if (!g.activeCine) return;
      g.activeCine = null;
      this._showRank(false);
      this._subtitle(null);
      this._setArms(false);
      this._fade(true);
      this._later(900, () => {
        this._cine(false);
        this._startAssault(false);
        this._fade(false);
      });
    };
  }

  _showRank(on) {
    document.getElementById('rank-card').hidden = !on;
  }

  /* ── 5. Taarruz ───────────────────────────────────────────────────── */

  _startAssault(fromCheckpoint) {
    const g = this.game;
    this.phase = 'assault';
    this.checkpoint = 'assault';
    this.objective = 'battle';
    this._clearCity();
    this._clearRoad();
    this._clearCamp();
    this._clearAssault();
    g.vehicles.clear();
    g.crates.place([]);
    g.enemies.corpseTime = 30;
    g.state = 'playing';
    g.world.setTheme(mapById('sanayi'));
    this._grant([['mar556', 30, 240], ['m4', 30, 210], ['deagle', 7, 35], ['bazuka', 1, 5]]);
    g.grenades.count = 4;
    g.hud.setGrenades(4);

    // Aynı şehir, yarıçapı 500 km; en yüksek bina kendi bloğunda tek başına
    const city = this.city2 = new City(g, { radius: OP4.cityRadius, gunShops: true });
    const [ti, tj] = OP4.tower;
    city.specials.set(`${ti},${tj}`, { clear: true, build: () => {} });
    city.start(this.O);
    this._buildTower();

    const B = CITY.block, O = this.O;
    const plan = {
      tower: this.towerDoor.clone(),
      laneX: [-2, -1, 0, 1, 2].map((c) => O.x + c * B),
      allyZ: [O.z - 340],
      enemyJ: [6, 19],
      enemyI: [-4, 5],
    };
    this.army = new Army(g, city, plan);
    g.player.pos.set(O.x + 4, 0, O.z - 150);
    g.player.yaw = 0;
    g.player.pitch = 0;
    g.camera.position.set(g.player.pos.x, 1.66, g.player.pos.z);
    city.update(g.player.pos, true);
    g.hud.banner('TAARRUZ', 'H: KOMUTA · 5 KOL · ŞEHRİ AL, BAYRAĞI EN YÜKSEK KULEYE DİK', 6000);
    this._later(1800, () => this.say('op4_20', { radio: true }));
    document.getElementById('army-panel').hidden = false;
  }

  _clearAssault() {
    const g = this.game;
    this._closeMenu();
    if (this.army) { this.army.dispose(); this.army = null; }
    if (this.city2) { this.city2.stop(); this.city2 = null; }
    if (this.tower) {
      g.scene.remove(this.tower.group);
      g.world.removeFixture(this.tower.fixture);
      this.tower = null;
    }
    if (this.markerMesh) { g.scene.remove(this.markerMesh); this.markerMesh = null; }
    if (this.roofFlag) { g.scene.remove(this.roofFlag); this.roofFlag = null; }
  }

  /** En yüksek bina: her zaman sahnede (uzaktan da görünür), çatısına çıkılır. */
  _buildTower() {
    const g = this.game;
    if (structures.get('gokdelen_cam')) { this._buildGlassTower(); return; }
    const [ti, tj] = OP4.tower;
    const c = this.city2.center(ti, tj);
    const W = OP4.towerW, H = OP4.towerH;
    const M = this.city2._m;
    const glass = new THREE.MeshStandardMaterial({ map: M.facades[2].map, color: 0x9db8cc, roughness: 0.3, metalness: 0.55 });
    const group = new THREE.Group();
    const colliders = [], solids = [];
    const add = (mesh, solid = true) => {
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      if (solid) {
        mesh.updateMatrixWorld(true);
        solids.push(mesh);
        colliders.push(new THREE.Box3().setFromObject(mesh));
      }
      return mesh;
    };
    const body = add(new THREE.Mesh(buildingGeo(W, H, W), [glass, glass, M.roof, M.roof, glass, glass]));
    body.position.set(c.x, H / 2, c.z);
    // Çatı korkuluğu ve merdiven kulesi
    const rim = M.barrier;
    for (const [dx, dz, w, d] of [[0, W / 2, W, 0.4], [0, -W / 2, W, 0.4], [W / 2, 0, 0.4, W], [-W / 2, 0, 0.4, W]]) {
      const m = add(new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), rim));
      m.position.set(c.x + dx, H + 0.55, c.z + dz);
    }
    const stair = add(new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 4), M.roof));
    stair.position.set(c.x - 9, H + 1.6, c.z - 9);
    // Bayrak yuvası (çatının ortası)
    const socket = add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.4, 12), M.steel), false);
    socket.position.set(c.x, H + 0.2, c.z);
    // Zemin kapısı: güney yüzünde aydınlık asansör girişi
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x223040, emissive: 0x6fb4e8, emissiveIntensity: 0.55 });
    const door = add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 3, 0.2), doorMat), false);
    door.position.set(c.x, 1.5, c.z + W / 2 + 0.11);
    g.scene.add(group);
    const fixture = { colliders, solids, cover: [] };
    g.world.addFixture(fixture);
    this.tower = { group, fixture, center: c.clone(), roofY: H };
    this.towerDoor = new THREE.Vector3(c.x, 0, c.z + W / 2 + 1.6);
    this.flagSocket = new THREE.Vector3(c.x, H, c.z);
  }

  /* En yüksek bina: kullanıcının Blender'deki cam gökdeleni (217 m, anteniyle).
     Çatı yüksekliği ve en üst katın izi modelden ölçülür (structures.js);
     bayrak yuvası antenin yanında, asansör çıkışı karşı köşede. */
  _buildGlassTower() {
    const g = this.game;
    const [ti, tj] = OP4.tower;
    const c = this.city2.center(ti, tj);
    const m = structures.get('gokdelen_cam');
    const group = new THREE.Group();
    const colliders = [], solids = [];
    structures.place('gokdelen_cam', group, c.x, c.z, 0, { solids, colliders });
    g.scene.add(group);
    const fixture = { colliders, solids, cover: [] };
    g.world.addFixture(fixture);
    const top = m.top ?? new THREE.Box3(new THREE.Vector3(-8, 0, -8), new THREE.Vector3(8, 0, 8));
    const roofY = m.roofY ?? 190;
    // Çatıda yürünecek düzlem: en üst katın izi kadar (gövde kutusunun tepesi)
    this.tower = { group, fixture, center: c.clone(), roofY,
      exit: new THREE.Vector3(c.x + top.min.x * 0.55, 0, c.z + top.min.z * 0.55) };
    this.towerDoor = new THREE.Vector3(c.x, 0, c.z + m.size.z / 2 + 2);
    this.flagSocket = new THREE.Vector3(c.x + top.max.x * 0.5, roofY, c.z + top.max.z * 0.5);
  }

  _updateAssault(dt, now) {
    const g = this.game, p = g.player.pos;
    this.city2.update(p);
    this._sun(p);
    const A = this.army;
    if (A) {
      A.update(dt, now);
      A.refreshColumns(now);
      // Teslim: düşmanın son %5'i ve zayiat 500 (ya da düşman bitti)
      if (!A.surrendered && ((A.enemyAlive <= ARMY.enemies * ARMY.surrenderAt && A.deadA >= ARMY.lossTarget) || A.enemyAlive === 0)) {
        A.surrender();
        this.objective = 'tower';
        this.navTarget = this.towerDoor.clone();
        this.navOn = true;
        A.order(-1, 'move', this.towerDoor);
        this.say('op4_30', { radio: true }).then(() => this.active && this.say('op4_31', { radio: true }));
        g.hud.banner('ŞEHİR DÜŞTÜ', `DÜŞMAN TESLİM OLDU · ZAYİAT ${A.deadA} · EN YÜKSEK KULEYE ÇIK`, 6500);
      }
    }
    // İşaret: komuta menüsünde nişangâhın baktığı yer
    this._updateMarker(now);
    if (this.roofFlag) this.roofFlag.userData.tick(dt);
  }

  /* ── Komuta menüsü (H) ────────────────────────────────────────────── */

  /** Oyun tuşları: işlendiyse true (silah değiştirme vb. çalışmaz). */
  onKey(code) {
    const g = this.game;
    if (!this.active) return false;
    if (code === 'KeyE') return this._interact();
    if (this.phase !== 'assault' || !this.army) return false;
    if (code === 'KeyH') {
      if (g.player.wounded) return false;        // yaralıyken H yine tedavi
      if (this.cmd) this._closeMenu(); else this._openMenu();
      return true;
    }
    if (!this.cmd || !code.startsWith('Digit')) return false;
    const n = Number(code.slice(5));
    if (this.cmd.stage === 'col') {
      if (n >= 1 && n <= 6) { this.cmd = { stage: 'order', col: n === 6 ? -1 : n - 1 }; this._drawMenu(); }
      return true;
    }
    if (this.cmd.stage === 'order' && n >= 1 && n <= 3) {
      this._issue(this.cmd.col, ['attack', 'cover', 'move'][n - 1]);
      return true;
    }
    return true;
  }

  _openMenu() {
    if (this.army?.surrendered) return;
    this.cmd = { stage: 'col' };
    document.getElementById('cmd-menu').hidden = false;
    this._drawMenu();
  }

  _closeMenu() {
    this.cmd = null;
    const el = document.getElementById('cmd-menu');
    if (el) el.hidden = true;
    if (this.previewMesh) this.previewMesh.visible = false;
  }

  _drawMenu() {
    const el = document.getElementById('cmd-menu');
    const A = this.army;
    if (!el || !A || !this.cmd) return;
    const cols = A.refreshColumns(performance.now() / 1000);
    const btn = (n, label, extra = '') => `<button type="button" data-n="${n}"><kbd>${n}</kbd><span>${label}</span>${extra}</button>`;
    let html = '<header>KOMUTA <small>Tümgeneral</small></header>';
    if (this.cmd.stage === 'col') {
      html += '<p>Kol seç</p>';
      cols.forEach((c, k) => { html += btn(k + 1, `${k + 1}. Kol`, `<em>${c.n} asker · ${ORDER_NAMES[c.order]}</em>`); });
      html += btn(6, 'Bütün kollar');
    } else {
      const name = this.cmd.col < 0 ? 'Bütün kollar' : `${this.cmd.col + 1}. Kol`;
      html += `<p>${name} — emir</p>`;
      html += btn(1, 'Saldır', '<em>kuleye doğru ilerle, çatış</em>');
      html += btn(2, 'Siper al', '<em>dur, çömel, ateşi sürdür</em>');
      html += btn(3, 'İşaretli yere git', '<em>nişangâhın baktığı nokta (sarı)</em>');
    }
    html += '<footer>H — kapat</footer>';
    el.innerHTML = html;
    for (const b of el.querySelectorAll('button')) {
      b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.onKey(`Digit${b.dataset.n}`); });
    }
  }

  _issue(col, order) {
    const A = this.army;
    let at = null;
    if (order === 'move') {
      at = this._aimPoint();
      if (!at) { this.game.hud.feed('İşaret için zemine bak'); return; }
      A.marker = at.clone();
    }
    A.order(col, order, at);
    this._closeMenu();
    const who = col < 0 ? 'Bütün kollar' : `${col + 1}. Kol`;
    this.game.hud.feed(`${who}: ${order === 'attack' ? 'SALDIR' : order === 'cover' ? 'SİPER AL' : 'İŞARETLİ YERE GİT'}`, true);
    this.say({ attack: 'op4_22', cover: 'op4_21', move: 'op4_23' }[order], { radio: true });
  }

  /** Nişangâhın baktığı zemin noktası (binaya bakıyorsa önündeki sokak). */
  _aimPoint() {
    const g = this.game, cam = g.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    g.raycaster.set(origin, dir);
    g.raycaster.far = 700;
    const hit = g.raycaster.intersectObjects(g.world.solids, false)[0];
    g.raycaster.far = 260;
    let p = null;
    if (hit) p = hit.point.clone();
    if (dir.y < -0.01) {
      const t = -origin.y / dir.y;
      if (t < 700 && (!hit || t < hit.distance)) p = origin.clone().addScaledVector(dir, t);
    }
    if (!p) return null;
    const s = this._street(p.x, p.z);
    return s;
  }

  _updateMarker(now) {
    const g = this.game;
    if (!this.markerMesh) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.55, depthWrite: false });
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 60, 16, 1, true), mat);
      m.position.y = 30;
      const ring = new THREE.Mesh(new THREE.RingGeometry(3, 3.6, 32), mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -29.9;
      m.add(ring);
      g.scene.add(m);
      this.markerMesh = m;
      this.previewMesh = m.clone();
      this.previewMesh.material = mat.clone();
      this.previewMesh.children[0].material = this.previewMesh.material;
      this.previewMesh.material.opacity = 0.3;
      g.scene.add(this.previewMesh);
    }
    const mk = this.army?.marker;
    const anyMove = this.army?.columns.some((c) => c.order === 'move');
    this.markerMesh.visible = Boolean(mk && anyMove && !this.army.surrendered);
    if (mk) this.markerMesh.position.set(mk.x, 30, mk.z);
    this.markerMesh.material.opacity = 0.35 + Math.sin(now * 4) * 0.15;
    const prev = this.cmd?.stage === 'order' ? this._aimPoint() : null;
    this.previewMesh.visible = Boolean(prev);
    if (prev) this.previewMesh.position.set(prev.x, 30, prev.z);
  }

  /* ── 6. Kule ve bayrak ────────────────────────────────────────────── */

  /** Yakındaki silah dükkânı (kaçış ya da taarruz şehrinde). */
  _gunShop() {
    const g = this.game;
    if (g.vehicles.driving) return null;
    const city = this.phase === 'escape' ? this.city : this.phase === 'assault' ? this.city2 : null;
    return city?.gunShopNear(g.player.pos) ?? null;
  }

  _interact() {
    const g = this.game, p = g.player.pos;
    const shop = this._gunShop();
    if (shop) { g.gunShop.show(shop.kind.name); return true; }
    if (this.phase !== 'assault' || this.objective === 'battle') return false;
    if (this.objective === 'tower' && p.distanceTo(this.towerDoor) < 4) { this._elevator(); return true; }
    if (this.objective === 'roof' && Math.hypot(p.x - this.flagSocket.x, p.z - this.flagSocket.z) < 3.5) { this._plantFlag(); return true; }
    return false;
  }

  _elevator() {
    const g = this.game;
    this.objective = 'lift';
    this.navOn = false;
    this._fade(true);
    g.audio.doorClunk?.();
    this._later(1100, () => {
      g.audio.click?.(true);
      const c = this.tower.center, ex = this.tower.exit ?? new THREE.Vector3(c.x - 9, 0, c.z - 5.5);
      g.player.pos.set(ex.x, this.tower.roofY, ex.z);
      g.player.vel?.set(0, 0, 0);
      g.player.yaw = Math.atan2(-(this.flagSocket.x - ex.x), -(this.flagSocket.z - ex.z));
      // Çatıdan şehir görünsün: sis açılır
      g.scene.fog.far = 520;
      g.scene.fog.near = 120;
      this.objective = 'roof';
      this._fade(false);
      g.hud.banner(`ÇATI · ${Math.round(this.tower.roofY)} M`, 'YUVAYA BAYRAĞI DİK — E', 5000);
    });
  }

  _plantFlag() {
    const g = this.game;
    this.objective = 'flag';
    const s = this.flagSocket;
    const flag = this.roofFlag = makeFlag(15, 3.6);
    flag.position.copy(s);
    flag.rotation.y = -Math.PI / 2;
    flag.userData.raise(0);
    g.scene.add(flag);
    g.state = 'cinematic';
    this._cine(true);
    g.audio._swell?.({ dur: 9, gain: 0.25, freq: 900, attack: 2, hold: 4 });
    const cam = g.camera;
    let t = 0;
    const H = this.tower.roofY;
    const look = new THREE.Vector3();
    const finish = () => {
      if (!g.activeCine) return;
      g.activeCine = null;
      this._cine(false);
      this.checkpoint = null;
      g.missions.report({ type: 'op4-done' });
      g._showVictory();
    };
    g.activeCine = {
      update: (dt) => {
        t += dt;
        flag.userData.tick(dt);
        flag.userData.raise(smooth((t - 0.6) / 5));
        this.city2?.update(s);
        // Kamera: önce bayrağa yakından, sonra kuleyi geniş bir yayla dolanır
        const a = 0.6 + t * 0.12;
        const r = 7 + smooth((t - 5) / 6) * 60;
        const y = H + 2.2 + smooth((t - 5) / 6) * 26;
        cam.position.set(s.x + Math.sin(a) * r, y, s.z + Math.cos(a) * r);
        look.set(s.x, H + 6 - smooth((t - 5) / 6) * 4, s.z);
        cam.lookAt(look);
        if (t > 7 && !this._won) {
          this._won = true;
          this._card('4. BÖLÜM TAMAMLANDI', 'ŞEHİR ELE GEÇİRİLDİ',
            `Türk bayrağı en yüksek kulede dalgalanıyor. 2.000 askerle 2.500 kişilik düşmanı yendin — zayiat ${this.army?.deadA ?? 500}.`);
        }
        if (t > 17) finish();
      },
      skip: () => finish(),
    };
  }

  /* ── Kayıt ────────────────────────────────────────────────────────── */

  /** Kaydet ve çık: aşama, hedef, yol ilerlemesi, ordunun tamamı. */
  save() {
    const g = this.game;
    const p = { phase: this.phase, objective: this.objective ?? null };
    if (this.phase === 'drive' && this.road) p.s = this.road.progress(g.vehicles.driving?.pos ?? g.player.pos);
    if (this.phase === 'assault' && this.army) p.army = this.army.serialize();
    return p;
  }

  /** begin()'den sonra: kaydedilen aşamaya geç. @returns oyuncu konumu da yüklensin mi */
  restore(p) {
    const g = this.game;
    if (p.phase === 'drive' || p.phase === 'camp') {
      // Düşman aracıyla patikada: kaydedilen noktadan sür
      g.vehicles.enter(this.exitJeep);
      this._startDrive();
      const s = p.phase === 'camp' ? OP4.campS + 40 : Math.max(OP4.campS + 40, p.s ?? OP3.road.length);
      const v = this.exitJeep;
      v.pos.copy(this.road.point(s, 1.4));
      const t = this.road.tangent(s);
      v.yaw = Math.atan2(t.z, -t.x);              // geri yön (karargâha doğru)
      v.speed = 0;
      g.player.yaw = v.yaw - Math.PI / 2;
      this.road.update(s, true);
      return false;
    }
    if (p.phase === 'assault' && p.army && this.army) {
      this.army.restore(p.army);
      const obj = p.objective;
      if (this.army.surrendered || obj === 'tower' || obj === 'lift' || obj === 'roof' || obj === 'flag') {
        this.objective = obj === 'roof' || obj === 'flag' ? 'roof' : 'tower';
        this.navTarget = this.towerDoor.clone();
        this.navOn = this.objective === 'tower';
        if (this.objective === 'roof') { g.scene.fog.far = 520; g.scene.fog.near = 120; }
      }
    }
    return true;
  }

  /* ── Her kare ─────────────────────────────────────────────────────── */

  update(dt, now) {
    if (!this.active) return;
    if (this.phase === 'escape') this._updateEscape(dt, now);
    else if (this.phase === 'drive') this._updateDrive(dt, now);
    else if (this.phase === 'assault') this._updateAssault(dt, now);
  }

  /** Navigasyon rotası (mini harita). */
  route() {
    if (!this.active || !this.navOn || !this.navTarget && this.phase !== 'drive') return null;
    const g = this.game;
    const p = (g.vehicles.driving?.pos ?? g.player.pos).clone().setY(0);
    if (this.phase === 'escape' && this.city) return this.city.route(p, this.navTarget);
    if (this.phase === 'drive' && this.road) {
      const s = this.road.progress(p);
      const pts = [p];
      for (let k = s - 40; k > OP4.campS; k -= 40) {
        pts.push(this.road.point(k, 0));
        if (s - k > 900) break;
      }
      if (s - OP4.campS <= 900) pts.push(this.road.point(OP4.campS, 0));
      return pts;
    }
    if (this.phase === 'assault' && this.city2 && this.navTarget) return this.city2.route(p, this.navTarget);
    return null;
  }

  hint() {
    const g = this.game, p = g.player.pos;
    if (this._gunShop()) return ['E', 'silah dükkânı — kredinle silah ve mermi al'];
    if (this.phase === 'escape' && this.exitJeep && !g.vehicles.driving
      && Math.hypot(this.exitJeep.pos.x - p.x, this.exitJeep.pos.z - p.z) < 4.2) return ['F', 'düşman arazi aracını al'];
    if (this.phase !== 'assault') return null;
    if (this.objective === 'battle' && !this.cmd) return ['H', 'komuta: kol seç, emir ver'];
    if (this.objective === 'tower' && p.distanceTo(this.towerDoor) < 4) return ['E', 'asansöre bin — çatıya çık'];
    if (this.objective === 'roof' && Math.hypot(p.x - this.flagSocket.x, p.z - this.flagSocket.z) < 3.5) return ['E', 'Türk bayrağını dik'];
    return null;
  }

  drawHud() {
    const el = (id) => document.getElementById(id);
    const r = this.route();
    const nav = el('nav-readout');
    if (r && r.length > 1) {
      let d = 0;
      for (let i = 1; i < r.length; i++) d += r[i].distanceTo(r[i - 1]);
      if (this.phase === 'drive' && this.road) d = Math.max(d, this.road.progress(r[0]) - OP4.campS);
      nav.hidden = false;
      nav.textContent = d > 1000 ? `HEDEF ${(d / 1000).toFixed(1)} km` : `HEDEF ${Math.round(d)} m`;
    } else nav.hidden = true;
    el('wave-label').textContent = 'TÜMGENERAL';
    const names = { flee: 'KAÇIŞ', escape: 'KAÇIŞ', drive: 'YOL', camp: 'KARARGÂH', assault: 'TAARRUZ' };
    el('wave-num').textContent = names[this.phase] ?? '';
    const obj = {
      escape: 'Şehrin çıkışına ulaş — düşman aracını al',
      drive: 'Patikadan karargâha dön',
      battle: 'Şehri al — kollarına emir ver (H)',
      tower: 'En yüksek kuleye git (rota)',
      lift: 'Asansör…',
      roof: 'Çatının ortasına bayrağı dik (E)',
      flag: 'Bayrak dalgalanıyor',
    };
    el('enemies-left').textContent = (this.phase === 'assault' ? obj[this.objective] : obj[this.phase]) ?? '';
    const tag = el('disguise-tag');
    if (tag) tag.hidden = true;
    document.body.classList.toggle('op4-assault', this.phase === 'assault');
    // Ordu paneli
    const panel = el('army-panel');
    const A = this.army;
    panel.hidden = !(this.phase === 'assault' && A);
    if (!panel.hidden) {
      const now = performance.now() / 1000;
      if (now > (this._panelAt ?? 0)) {
        this._panelAt = now + 0.4;
        const cols = A.refreshColumns(now);
        const f = (n) => n.toLocaleString('tr-TR');
        panel.innerHTML = `<div class="ap-head"><span>MÜTTEFİK <b>${f(A.allyAlive)}</b></span><span>DÜŞMAN <b>${f(A.enemyAlive)}</b></span><span>ZAYİAT <b>${f(A.deadA)}</b></span></div>`
          + cols.map((c, k) => `<div class="ap-col ap-${c.order}"><i>${k + 1}</i><span>${c.n}</span><em>${ORDER_NAMES[c.order]}</em></div>`).join('');
        el('wave-bar-fill').style.width = `${((A.deadE / ARMY.enemies) * 100).toFixed(1)}%`;
      }
      if (this.cmd && now > (this._menuAt ?? 0)) { this._menuAt = now + 1; this._drawMenu(); }
    }
  }

  /** Mini harita katmanı. */
  minimapOverlay() {
    if (!this.army || this.phase !== 'assault') return null;
    return (g, toMap, R, range, player) => this.army.drawMinimap(g, toMap, R, range, player);
  }
}
