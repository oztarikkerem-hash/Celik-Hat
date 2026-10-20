/* Suikast — üçüncü özel görev.

   1. GİRİŞ (orman, roketatarın yanı): füzenin ateşlenmesine engel
      olamadığın için silah arkadaşların sana kızgın; sırayla bağırırlar
      (seslendirme assets/voice/op3_*.m4a + altyazı). Sonra üzerine
      yürürler: güneydeki arazi aracına koş ve bin (F). Yakalanırsan biter.
   2. PATİKA (road.js, 8 km): 6. km'de telefona bildirim gelir (P ile
      telefonu çıkar): komutan "Şehre git ve düşman komutanına suikast
      düzenle." Mesajdan sonra mini haritada navigasyon rotası çizilir.
   3. ŞEHİR (city.js): savaş görmüş, yalnızca asker dolu bir şehir. 5'er
      kişilik devriyeler dolaşır; silahsızsın, seni düşman saymazlar.
      Rota bir eve götürür: masadaki tabancayı al (E, 3 şarjör), 1 ile çek.
      Bir devriyenin beşini de indir, cesetlerden tüfek ve üniforma al (E).
      Kılıkla karargâha git: komutan seninle konuşur, arkasını dönünce vur.
   Arazi aracı şehirde de kullanılır (140 km/sa, sağda devir saati).      */

import * as THREE from 'three';
import { Road } from './road.js';
import { City, CITY } from './city.js';
import { Soldier } from './soldier.js';
import { mapById } from './maps.js';
import { plasterTexture } from './textures.js';

export const OP3 = {
  road: { x0: -6000, z0: 0, length: 8000, width: 5, ambushes: [], trees: 200, curve: [55, 430, 22, 160, 0.7], endPad: 0 },
  phoneAt: 6000,        // m: telefon bildirimi
  cityAt: 7350,         // m: şehrin akışı başlar
  themeAt: 7650,        // m: gökyüzü/sis şehre döner
  house: [1, 3],        // tabancanın olduğu evin bloğu (i, j)
  hq: [-2, 9],          // komutanın karargâhı
  groups: 3,            // aynı anda dolaşan devriye sayısı
  site: new THREE.Vector3(0, 0, -48),
};

// Seslendirme İNGİLİZCE (macOS erkek sesleri: Daniel, Reed, Rocko, Eddy —
// Türkçe sentez sesi yalnızca kadın sesiydi); altyazı Türkçe çeviri
const LINES = {
  op3_01: ['Çavuş Demir', 'Lan ne yaptın sen! O füze havada şu an, görüyor musun?'],
  op3_02: ['Onbaşı Kaya', 'Bir düğmeye basmasını engelleyemedin be adam! Koca bir düğmeye!'],
  op3_03: ['Er Yılmaz', 'Kaç kişi ölecek, haberin var mı? Hepsi senin yüzünden!'],
  op3_04: ['Çavuş Demir', 'Kafayı mı yedin sen? Biz sana güvendik, sana!'],
  op3_05: ['Onbaşı Kaya', 'Yeter artık. Tutun şunu, karargâha götürüyoruz.'],
  op3_06: ['Er Yılmaz', 'Kaçma lan! Dur dedim sana!'],
  op3_07: ['Çavuş Demir', 'Yakaladık seni!'],
  op3_10: ['Düşman komutanı', 'Asker! Burada ne işin var, görev yerin neresi?'],
  op3_11: ['Düşman komutanı', 'Neyse. Kuzey kapısına git, orada adam lazım. Hadi, çabuk.'],
  op3_12: ['Düşman askeri', 'Ateş! Silahlı adam var!'],
};

const smooth = (x) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

export class Op3 {
  constructor(game) {
    this.game = game;
    this.road = new Road(game, OP3.road);
    this.city = new City(game);
    this.active = false;
    this.phase = null;
    this.checkpoint = null;          // 'city': ölünce şehir girişinden başla
    this._installSpecials();
  }

  /** Harita gizli ve sektör akışı durmuş mu (yol + şehir arenası). */
  get arenaActive() {
    return this.active && ['toRoad', 'road', 'city', 'end'].includes(this.phase) && !this._onMainMap;
  }

  /* ── Başlangıç / bitiş ────────────────────────────────────────────── */

  /** game.startOp3 ortak hazırlıktan sonra çağırır. */
  begin(fromCheckpoint = false) {
    const g = this.game;
    this.active = true;
    this.hasPistol = false;
    this.disguised = false;
    this.groups = [];
    this.lootGroup = null;
    this.navTarget = null;
    this.navOn = false;
    this.phoneState = 'none';       // none | ping | open | read
    this.boss = null;
    this._lines = new Set();
    g.enemies.corpseTime = 240;
    g.grenades.count = 0;
    g.hud.setGrenades(0);
    this._setUnarmed();
    if (fromCheckpoint && this.checkpoint === 'city') this._startCity(true);
    else this._startIntro();
  }

  end() {
    if (!this.active) return;
    const g = this.game;
    this.active = false;
    this.phase = null;
    this.road.stop();
    this.city.stop();
    this._clearIntro();
    if (this._half) { g.world.half = this._half; this._half = 0; }
    g.world.setVisible(true);
    g.world.setClearZone(null);
    g.enemies.corpseTime = 12;
    g.audio.engineStop?.();
    this._subtitle(null);
    this._phoneUi(false);
    document.getElementById('phone-toast').hidden = true;
  }

  /** Silahsız: hiçbir silah kuşanılamaz (bıçak da yok). */
  _setUnarmed() {
    const w = this.game.weaponry;
    w.allowed = new Set();
    this.game.hud.buildWeaponStrip([], w.current.def.id);
  }

  _grant(id, mag, reserve) {
    const g = this.game, w = g.weaponry;
    w.allowed.add(id);
    const s = w.slots.find((x) => x.def.id === id);
    if (s) { s.ammo = mag; s.reserve = reserve; }
    g.hud.buildWeaponStrip(w.slots.filter((x) => w.usable(x.def.id)), w.current.def.id);
    return s;
  }

  /* ── Seslendirme ve altyazı ───────────────────────────────────────── */

  /** Repliği çalar + altyazı; bitince çözülen söz (sn). */
  async say(id) {
    const [who, text] = LINES[id];
    this._subtitle(who, text);
    const g = this.game;
    g.audio.init();
    const dur = await g.audio.playVoice(`assets/voice/${id}.m4a`, 2.6 + text.length * 0.05);
    const until = performance.now() + dur * 1000 + 250;
    this._subUntil = until;
    await new Promise((r) => setTimeout(r, dur * 1000 + 250));
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

  /* ── 1. Giriş: kızgın silah arkadaşları ───────────────────────────── */

  _startIntro() {
    const g = this.game;
    this.phase = 'intro';
    this._onMainMap = true;
    g.world.setTheme(mapById('orman'));
    g.world.setVisible(true);
    g.world.setClearZone({ x: OP3.site.x, z: OP3.site.z, r: 18 });
    g.world.setClearRects([{ x0: -6, x1: 6, z0: -30, z1: 60 }]);

    // Roketatar (boş tüp) — 2. görevin sahnesi
    const A = g.op2.assets;
    if (A) {
      const root = A.mlrs.clone(true);
      root.position.set(OP3.site.x, 0.35, OP3.site.z);
      root.rotation.y = Math.PI / 2;
      for (const n of ['CapFront', 'CapBack']) root.getObjectByName(n)?.removeFromParent();
      g.scene.add(root);
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      box.max.y = Math.min(box.max.y, 3.6);
      this.introSite = { root, fixture: { colliders: [box], solids: [], cover: [] } };
      g.world.addFixture(this.introSite.fixture);
    }

    // Oyuncu kamyonun güneyinde, kuzeye (arkadaşlarına) bakar
    g.player.pos.set(1.5, 0, -24);
    g.player.yaw = 0;
    g.player.pitch = 0.02;

    // Kızgın silah arkadaşları: SWAT askerleri, oyuncuya dönük
    this.mates = [];
    const spots = [[-3, -31], [1, -32.5], [4.5, -30.5]];
    for (const [x, z] of spots) {
      const rig = g.soldiers.create();
      const s = new Soldier(rig, { team: 'ally', rifle: g.gear?.makeRifle('mar556') ?? null, tint: null });
      s.root.position.set(x, 0, z);
      g.scene.add(s.root);
      this.mates.push({ s, pos: new THREE.Vector3(x, 0, z), facing: 0 });
    }

    // Arazi aracı: güneyde, yolda, güneye bakar
    this.jeep = g.vehicles.spawn(new THREE.Vector3(1.6, 0, 40), -Math.PI / 2, mapById('orman'), { model: 'jeep' });

    g.camera.position.set(g.player.pos.x, 1.66, g.player.pos.z);
    g.camera.rotation.set(0, 0, 0);
    g.camera.updateMatrixWorld();
    g.world.update(g.camera, g.player.pos, performance.now() / 1000, 40);

    this.lockMove = true;
    this.chase = null;
    this._dialog();
  }

  async _dialog() {
    const run = this._run = Symbol('run');
    await new Promise((r) => setTimeout(r, 900));
    for (const id of ['op3_01', 'op3_02', 'op3_03', 'op3_04', 'op3_05']) {
      if (this._run !== run || this.phase !== 'intro') return;
      this.speaking = LINES[id][0];
      await this.say(id);
      await new Promise((r) => setTimeout(r, 250));
    }
    if (this._run !== run || this.phase !== 'intro') return;
    this.speaking = null;
    this.lockMove = false;
    this.chase = { t: 0 };
    this.navTarget = this.jeep.pos.clone();
    this.navOn = true;
    this.game.hud.banner('KAÇ!', 'GÜNEYDEKİ ARAZİ ARACINA BİN — F', 4200);
  }

  _updateIntro(dt, now) {
    const g = this.game, p = g.player.pos;
    for (const m of this.mates) {
      const dx = p.x - m.pos.x, dz = p.z - m.pos.z;
      const d = Math.hypot(dx, dz);
      let speed = 0;
      if (this.chase && d > 1.1) {
        speed = this.chase.t < 4 ? 3.2 : 6.0;
        m.pos.x += (dx / d) * speed * dt;
        m.pos.z += (dz / d) * speed * dt;
      }
      const want = Math.atan2(-dx, -dz);
      let diff = Math.atan2(Math.sin(want - m.facing), Math.cos(want - m.facing));
      m.facing += diff * Math.min(1, dt * 5);
      m.s.root.position.copy(m.pos);
      m.s.root.rotation.y = m.facing;
      m.s.update({ dt, speed, crouching: false, downed: false, aimPitch: -0.1, aiming: false });
      if (this.chase && d < 1.3 && !this.caught) {
        this.caught = true;
        this.say('op3_07');
        setTimeout(() => { if (this.phase === 'intro') g.gameOver(); }, 1600);
      }
    }
    if (this.chase) {
      this.chase.t += dt;
      const near = Math.min(...this.mates.map((m) => m.pos.distanceTo(p)));
      if (!this._lines.has('op3_06') && near > 7.5) { this._lines.add('op3_06'); this.say('op3_06'); }
    }
    // Araca bindi: patikaya geçiş
    if (g.vehicles.driving === this.jeep) this._toRoad();
  }

  _clearIntro() {
    const g = this.game;
    for (const m of this.mates ?? []) g.scene.remove(m.s.root);
    this.mates = [];
    if (this.introSite) {
      g.scene.remove(this.introSite.root);
      g.world.removeFixture(this.introSite.fixture);
      this.introSite = null;
    }
  }

  /* ── 2. Patika ────────────────────────────────────────────────────── */

  _toRoad() {
    const g = this.game;
    this.phase = 'toRoad';
    this._run = null;
    this._subtitle(null);
    const fade = document.getElementById('op-fade');
    fade.classList.add('on');
    setTimeout(() => {
      this._clearIntro();
      this._onMainMap = false;
      g.world.setVisible(false);
      this._half = g.world.half;
      g.world.half = 1e6;
      g.world.setClearZone(null);
      g.world.setClearRects([]);
      this.road.start();
      const s0 = 20;
      const v = this.jeep;
      v.pos.copy(this.road.point(s0, 0));
      const t = this.road.tangent(s0);
      v.yaw = Math.atan2(-t.z, t.x);
      v.speed = 0;
      g.player.yaw = v.yaw - Math.PI / 2;
      this.road.update(s0, true);
      this.navOn = false;
      this.phase = 'road';
      fade.classList.remove('on');
      g.hud.banner('PATİKA', 'ORMANDAN UZAKLAŞ — YOL SENİ BİR YERE ÇIKARIR', 4000);
    }, 950);
  }

  _updateRoad(dt, now) {
    const g = this.game;
    const v = this.jeep;
    const p = g.vehicles.driving === v ? v.pos : g.player.pos;
    const s = this.road.progress(p);
    this.road.update(Math.max(0, s));
    this._sun(p);

    if (s >= OP3.phoneAt && this.phoneState === 'none') {
      this.phoneState = 'ping';
      g.audio.phoneBuzz();
      document.getElementById('phone-toast').hidden = false;
    }
    if (s >= OP3.cityAt && !this.city.active) this.city.start(this.road.point(OP3.road.length, 0));
    if (this.city.active) this.city.update(p);
    if (s >= OP3.themeAt && !this._cityTheme) {
      this._cityTheme = true;
      g.world.setTheme(mapById('sanayi'));
    }
    if (s >= OP3.road.length + 4) this._startCity(false);
  }

  /* ── Telefon ──────────────────────────────────────────────────────── */

  togglePhone() {
    if (this.phoneState === 'none') return;
    const open = this.phoneState !== 'open';
    this._phoneUi(open);
    if (open) {
      document.getElementById('phone-toast').hidden = true;
      const first = this.phoneState === 'ping';
      this.phoneState = 'open';
      if (first) this._typeMessages();
    } else {
      this.phoneState = 'read';
    }
  }

  _phoneUi(on) {
    const el = document.getElementById('phone');
    if (el) el.classList.toggle('on', on);
  }

  async _typeMessages() {
    const list = document.getElementById('phone-msgs');
    list.innerHTML = '';
    const msgs = [
      'Şehre git ve düşman komutanına suikast düzenle.',
      'Konumu işaretledim. Silahın yok: şehirde bir sığınak evde masaya tabanca bıraktık. Önce oraya.',
    ];
    for (const m of msgs) {
      const typing = document.createElement('li');
      typing.className = 'msg typing';
      typing.innerHTML = '<span></span><span></span><span></span>';
      list.append(typing);
      await new Promise((r) => setTimeout(r, 1300));
      typing.remove();
      const li = document.createElement('li');
      li.className = 'msg';
      li.textContent = m;
      const time = document.createElement('time');
      const d = new Date();
      time.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      li.append(time);
      list.append(li);
      this.game.audio.click(false);
      await new Promise((r) => setTimeout(r, 700));
    }
    // Mesajdan sonra navigasyon: sığınak eve
    this.navTarget = this._houseDoor();
    this.navOn = true;
    this.game.hud.feed('NAVİGASYON AÇIK — mini haritadaki rotayı izle', true);
  }

  /* ── 3. Şehir ─────────────────────────────────────────────────────── */

  _startCity(fromCheckpoint) {
    const g = this.game;
    this.phase = 'city';
    this.checkpoint = 'city';
    if (fromCheckpoint) {
      // Kaldığı yerden: şehir girişinde, arazi aracında
      this._onMainMap = false;
      g.world.setVisible(false);
      g.world.setTheme(mapById('sanayi'));
      this._cityTheme = true;
      this._half = g.world.half;
      g.world.half = 1e6;
      const O = this.road.point(OP3.road.length, 0);
      this.city.start(O);
      this.jeep = g.vehicles.spawn(O.clone().add(new THREE.Vector3(2.2, 0, -10)), Math.PI / 2, null, { model: 'jeep' });
      g.vehicles.enter(this.jeep);
      g.player.yaw = this.jeep.yaw - Math.PI / 2;
      this.city.update(this.jeep.pos, true);
      this.phoneState = 'read';
    }
    this.objective = 'house';
    this.navTarget = this._houseDoor();
    this.navOn = this.phoneState === 'read' || this.phoneState === 'open' || fromCheckpoint;
    g.hud.banner('ŞEHİR', this.navOn ? 'ROTAYI İZLE — SIĞINAK EV' : 'TELEFONUNA BAK — P', 4200);
  }

  _updateCity(dt, now) {
    const g = this.game;
    const p = g.vehicles.driving ? g.vehicles.driving.pos : g.player.pos;
    this.city.update(p);
    if (this.road.chunks.size && this.road.progress(p) > OP3.road.length + 500) this.road.stop();
    else if (this.road.chunks.size) this.road.update(this.road.progress(p));
    this._sun(p);
    if (now > (this._patrolAt ?? 0)) { this._patrolAt = now + 1; this._managePatrols(p); }
    if (now > (this._watchAt ?? 0)) { this._watchAt = now + 0.25; this._watch(); }
    this._updateBoss(dt, now);

    // Hedef: bir devriyenin tamamı düştü mü
    if (this.objective === 'hunt') {
      const wiped = this.groups.find((gr) => gr.members.length && gr.members.every((m) => !m.alive));
      if (wiped) {
        this.objective = 'loot';
        this.lootGroup = wiped;
        g.hud.banner('DEVRİYE ETKİSİZ', 'CESETLERDEN TÜFEK VE ÜNİFORMA AL — E', 5000);
      }
    }
  }

  /** Bloğun özel kurulumları: sığınak ev ve karargâh. */
  _installSpecials() {
    const [hi, hj] = OP3.house;
    this.city.specials.set(`${hi},${hj}`, { parcel: [0, 0], build: (ctx) => this._buildHouse(ctx) });
    const [qi, qj] = OP3.hq;
    this.city.specials.set(`${qi},${qj}`, { parcel: [1, 0], build: (ctx) => this._buildHq(ctx) });
  }

  /** Evin yerel konumu: bloğun güneybatı parseli (kapı güneydeki sokağa bakar). */
  _houseLocal() {
    const K = CITY.half + CITY.walk + 1.5;
    const half = (CITY.block - 2 * K) / 2;
    return { x: K + half / 2, z: K + half / 2 - 4 };
  }

  _houseDoor() {
    const [i, j] = OP3.house;
    const c = this.city.corner(i, j);
    const h = this._houseLocal();
    return new THREE.Vector3(c.x + h.x, 0, c.z - (h.z - 6.2));
  }

  _buildHouse({ group, own, solid, L, cover }) {
    const M = this.city._m;
    const { x, z } = this._houseLocal();
    const W = 10, D = 8, Hh = 3.2, T = 0.25;
    // Düz sıva (apartman cephesi içeriden başka bir bina gibi görünüyordu)
    this._plaster ??= new THREE.MeshStandardMaterial({ map: plasterTexture(), color: 0xb9ae98, roughness: 0.95 });
    const wallMat = this._plaster;
    const wall = (cx, cz, w, d, h = Hh, y = h / 2) => {
      const m = own(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat));
      m.position.set(cx, y, -cz);
      solid(m);
      return m;
    };
    // Kuzey ve yan duvarlar tam; güney duvarında kapı boşluğu (1.4 m)
    wall(x, z + D / 2, W, T);
    wall(x - W / 2, z, T, D);
    wall(x + W / 2, z, T, D);
    const door = 1.4, side = (W - door) / 2;
    wall(x - W / 2 + side / 2, z - D / 2, side, T);
    wall(x + W / 2 - side / 2, z - D / 2, side, T);
    wall(x, z - D / 2, door, T, Hh - 2.3, 2.3 + (Hh - 2.3) / 2);          // kapı üstü
    const roof = own(new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.25, D + 0.4), M.roof));
    roof.position.set(x, Hh + 0.12, -z);
    // Masa ve üstünde tabanca + iki şarjör
    const table = own(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.9), M.wreck));
    table.position.set(x, 0.78, -(z + 1.5));
    for (const [lx, lz] of [[-0.7, -0.38], [0.7, -0.38], [-0.7, 0.38], [0.7, 0.38]]) {
      const leg = own(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.76, 0.06), M.wreck));
      leg.position.set(x + lx, 0.38, -(z + 1.5 + lz));
    }
    const slot = this.game.weaponry.slots.find((s) => s.def.id === 'deagle');
    if (slot) {
      const gun = slot.model.clone(true);
      gun.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = true; } });
      const holder = new THREE.Group();
      holder.add(gun);
      holder.position.set(x - 0.2, 0.83, -(z + 1.5));
      holder.rotation.set(0, 0.6, Math.PI / 2);          // yan yatık, masaya çapraz
      group.add(holder);
      this.pistolProp = holder;
    }
    for (const dx of [0.25, 0.42]) {
      const mag = own(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.13, 0.03), M.steel));
      mag.position.set(x + dx, 0.82, -(z + 1.55));
      mag.rotation.z = Math.PI / 2;
    }
    const lamp = new THREE.PointLight(0xffd29a, 6, 9, 1.8);
    lamp.position.set(x, Hh - 0.3, -(z + 0.5));
    group.add(lamp);
    this.houseTable = L(x, z + 1.5);
  }

  _buildHq({ group, own, solid, L, cover }) {
    const M = this.city._m;
    const K = CITY.half + CITY.walk + 1.5;
    const half = (CITY.block - 2 * K) / 2;
    const cx = K + half + half / 2, cz = K + half / 2;
    // Kum torbası halkası (güneyde giriş boşluğu)
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      if (Math.abs(Math.sin(a) + 1) < 0.35) continue;           // güney boşluğu
      const bag = own(new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 0.8), M.bag));
      bag.position.set(cx + Math.cos(a) * 11, 0.55, -(cz + Math.sin(a) * 11));
      bag.rotation.y = -a + Math.PI / 2;
      solid(bag);
    }
    // Komuta çadırı, harita masası, telsiz anteni
    const tent = own(new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 4.5), M.bag));
    tent.position.set(cx, 1.2, -(cz + 5.5));
    solid(tent);
    const top = own(new THREE.Mesh(new THREE.ConeGeometry(4.3, 1.4, 4), M.bag));
    top.position.set(cx, 3.1, -(cz + 5.5));
    top.rotation.y = Math.PI / 4;
    const table = own(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 1.2), M.wreck));
    table.position.set(cx + 2.5, 0.85, -(cz + 1));
    const mast = own(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 9, 6), M.steel));
    mast.position.set(cx - 4.5, 4.5, -(cz + 3));
    this.hqSpot = L(cx, cz);
  }

  /* ── Devriyeler ───────────────────────────────────────────────────── */

  _managePatrols(p) {
    const g = this.game;
    // Uzaktaki tarafsız devriyeler sökülür
    for (const gr of [...this.groups]) {
      if (gr === this.lootGroup) continue;
      const alive = gr.members.filter((m) => m.alive);
      const far = alive.every((m) => m.pos.distanceTo(p) > 330);
      if (!gr.hostile && far) {
        for (const m of alive) g.enemies.despawn(m);
        this.groups.splice(this.groups.indexOf(gr), 1);
      }
    }
    const active = this.groups.filter((gr) => gr.members.some((m) => m.alive) && !gr.hostile).length;
    if (active >= OP3.groups) return;
    // Yeni devriye: 120–230 m ötede bir blok halkası
    const [pi, pj] = this.city.cellOf(p.x, p.z);
    for (let tries = 0; tries < 12; tries++) {
      const i = pi + Math.floor(Math.random() * 7) - 3, j = Math.max(1, pj + Math.floor(Math.random() * 7) - 3);
      const key = `${i},${j}`;
      if (key === `${OP3.hq[0]},${OP3.hq[1]}`) continue;
      const pts = this.city.loop(i, j);
      const d = pts[0].distanceTo(p);
      if (d < 110 || d > 240) continue;
      if (this.groups.some((gr) => gr.cell === key)) continue;
      this._spawnGroup(key, pts);
      return;
    }
  }

  _spawnGroup(key, pts) {
    const g = this.game;
    const group = { cell: key, members: [], hostile: false };
    const start = Math.floor(Math.random() * 4);
    for (let k = 0; k < 5; k++) {
      // Lider köşede, diğerleri arkasında 1.7 m arayla sıra
      const a = pts[start], b = pts[(start + 3) % 4];
      const dir = b.clone().sub(a).normalize();
      const pos = a.clone().addScaledVector(dir, k * 1.7);
      const e = g.enemies.spawnAt(k === 0 ? 'brute' : 'runner', pos, 1);
      e.neutral = true;
      e.patrol = { pts, idx: start, speed: 1.45 };
      e.squad = group;
      e.nextShot = performance.now() / 1000 + 1.5;
      group.members.push(e);
    }
    this.groups.push(group);
  }

  /** Bir grubu alarma geçirir: tarafsızlık biter, savaş yapay zekâsı başlar. */
  _alarm(group, shout = true) {
    if (!group || group.hostile) return;
    group.hostile = true;
    for (const m of group.members) {
      if (!m.alive) continue;
      m.neutral = false;
      m.patrol = null;
      m.nextShot = performance.now() / 1000 + 0.6 + Math.random();
    }
    if (shout) this.say('op3_12');
  }

  /** Oyuncu ateş etti: yakındaki devriyeler duyar — kılıklıyken de (üniforma
      silah taşımayı örter, ateş etmeyi değil). */
  onPlayerShot() {
    if (!this.active || this.phase !== 'city') return;
    const p = this.game.player.pos;
    for (const gr of this.groups) {
      if (gr.members.some((m) => m.alive && m.pos.distanceTo(p) < 85)) this._alarm(gr);
    }
    if (this.boss && this.bossGroup.members.some((m) => m.alive && m.pos.distanceTo(p) < 85)) this._alarm(this.bossGroup);
  }

  /** Bir düşman vuruldu ya da ezildi: grubu alarma geçer. */
  onEnemyHit(e) {
    if (!this.active) return;
    if (e.squad) this._alarm(e.squad);
  }

  /** Silah çekili ve kılıksızken yakından görülürsen alarm. */
  _watch() {
    const g = this.game;
    const w = g.weaponry;
    // Cepteki (P) silah görünmez; kılıkla silah taşımak da sorun değil
    const armed = !g.vehicles.driving && !w.holstered && w.usable(w.current.def.id);
    if (!armed || this.disguised) return;
    const p = g.player.pos;
    const eye = new THREE.Vector3(p.x, p.y + 1.5, p.z);
    const all = [...this.groups, ...(this.bossGroup ? [this.bossGroup] : [])];
    for (const gr of all) {
      if (gr.hostile) continue;
      for (const m of gr.members) {
        if (!m.alive || m.pos.distanceTo(p) > 22) continue;
        const from = new THREE.Vector3(m.pos.x, 1.5, m.pos.z);
        const dir = eye.clone().sub(from);
        const len = dir.length();
        g.raycaster.set(from, dir.normalize());
        g.raycaster.far = len;
        const hit = g.raycaster.intersectObjects(g.world.solids, false)[0];
        g.raycaster.far = 260;
        if (!hit) { this._alarm(gr); return; }
      }
    }
  }

  /* ── Komutan ──────────────────────────────────────────────────────── */

  _updateBoss(dt, now) {
    const g = this.game;
    // Karargâh bloğu kurulunca komutan ve iki koruması yerini alır
    if (!this.boss && this.hqSpot && this.city.chunks.has(`${OP3.hq[0]},${OP3.hq[1]}`)) {
      const grp = { cell: 'hq', members: [], hostile: false };
      const mk = (dx, dz, type) => {
        const e = g.enemies.spawnAt(type, this.hqSpot.clone().add(new THREE.Vector3(dx, 0, dz)), 1);
        e.neutral = true;
        e.patrol = { face: 0, turn: 3 };          // güneye (sokağa) bakar: facing 0 → −Z ileri; güney +Z
        e.patrol.face = Math.PI;
        e.squad = grp;
        grp.members.push(e);
        return e;
      };
      this.boss = mk(0, 0, 'brute');
      this.boss.isBoss = true;
      mk(-3.5, 1.5, 'runner');
      mk(3.5, 1.5, 'runner');
      this.bossGroup = grp;
      if (this.objective === 'boss') this.navTarget = this.hqSpot.clone();   // rota tam karargâha
    }
    const b = this.boss;
    if (!b) return;
    if (!b.alive && this.phase === 'city') { this._finish(); return; }
    if (this.objective !== 'boss' && this.objective !== 'talk' && this.objective !== 'kill') return;
    const p = g.player.pos;
    const d = b.pos.distanceTo(p);
    if (this.objective === 'boss' && this.disguised && d < 9 && !g.vehicles.driving) {
      this.objective = 'talk';
      this.navOn = false;              // hedefe varıldı
      this._talk();
    }
    if (this.objective === 'talk' && b.patrol) {
      // Konuşurken oyuncuya döner
      b.patrol.face = Math.atan2(b.pos.x - p.x, b.pos.z - p.z);
    }
  }

  async _talk() {
    const b = this.boss;
    await this.say('op3_10');
    if (!b.alive) return;
    await new Promise((r) => setTimeout(r, 400));
    await this.say('op3_11');
    if (!b.alive || this.objective !== 'talk') return;
    // Arkasını döner: oyuncunun tersine
    const p = this.game.player.pos;
    b.patrol.face = Math.atan2(p.x - b.pos.x, p.z - b.pos.z);
    this.objective = 'kill';
    this.game.hud.banner('ŞİMDİ', 'ARKASINI DÖNDÜ — VUR', 3000);
  }

  _finish() {
    const g = this.game;
    if (this.phase === 'end') return;
    this.phase = 'end';
    this.navOn = false;
    g.hud.banner('KOMUTAN ETKİSİZ', 'GÖREV TAMAM', 3200);
    g.state = 'cinematic';
    const el = {
      root: document.getElementById('cine'),
      eyebrow: document.getElementById('cine-eyebrow'),
      title: document.getElementById('cine-title'),
      sub: document.getElementById('cine-sub'),
    };
    let t = 0;
    const cam = g.camera;
    const pos0 = cam.position.clone();
    const look = this.boss.pos.clone().setY(0.6);
    g.activeCine = {
      update: (dt) => {
        t += dt;
        // Yavaşça geri çekilen kamera: yerde yatan komutan
        const k = smooth(t / 5);
        cam.position.copy(pos0).add(new THREE.Vector3(0, k * 2.5, 0)).addScaledVector(look.clone().sub(pos0).setY(0).normalize(), -k * 3);
        cam.lookAt(look);
        if (t > 2.6 && el.root.hidden) {
          el.root.hidden = false;
          document.body.classList.add('cinematic', 'cine-bars');
          el.eyebrow.textContent = 'SUİKAST';
          el.title.textContent = '3. BÖLÜM TAMAMLANDI';
          el.sub.textContent = 'Düşman komutanı etkisiz. Şehirden çıkmak zorundasın.';
          el.root.classList.remove('cine-title-out');
        }
        if (t > 8) finish();
      },
      skip: () => finish(),
    };
    const finish = () => {
      if (!g.activeCine) return;
      g.activeCine = null;
      el.root.hidden = true;
      document.body.classList.remove('cinematic', 'cine-bars');
      this.checkpoint = null;
      g.missions.report({ type: 'op3-done' });
      g._showVictory();
    };
  }

  /* ── E: etkileşim ─────────────────────────────────────────────────── */

  tryInteract() {
    if (!this.active || this.phase !== 'city' || this.game.vehicles.driving) return false;
    const g = this.game, p = g.player.pos;
    if (this.objective === 'house' && this.houseTable && p.distanceTo(this.houseTable) < 2.4) {
      this.hasPistol = true;
      if (this.pistolProp) this.pistolProp.visible = false;
      this._grant('deagle', 7, 14);
      g.audio.swap();
      this.objective = 'hunt';
      this.navOn = false;
      g.hud.banner('TABANCA ALINDI · 3 ŞARJÖR', '1: TABANCAYI ÇEK · BİR DEVRİYEYİ (5 ASKER) ETKİSİZ HALE GETİR', 5200);
      return true;
    }
    if (this.objective === 'loot' && this.lootGroup) {
      const body = this.lootGroup.members.find((m) => m.pos.distanceTo(p) < 2.4);
      if (!body) return false;
      this.disguised = true;
      const s = this._grant('mar556', 30, 60);
      g.audio.swap();
      this.objective = 'boss';
      this.navTarget = this.hqSpot ? this.hqSpot.clone() : this.city.center(...OP3.hq);
      this.navOn = true;
      g.hud.banner('ÜNİFORMA GİYİLDİ', `${s?.def.slot ?? 3}: TÜFEĞİ ÇEK · KOMUTANIN YANINA GİT — ROTAYI İZLE`, 5500);
      return true;
    }
    return false;
  }

  /* ── Her kare ─────────────────────────────────────────────────────── */

  update(dt, now) {
    if (!this.active) return;
    if (this.phase === 'intro') this._updateIntro(dt, now);
    else if (this.phase === 'road') this._updateRoad(dt, now);
    else if (this.phase === 'city') this._updateCity(dt, now);
  }

  _sun(p) {
    const W = this.game.world;
    W.sun.target.position.set(p.x, 0, p.z);
    W.sun.position.copy(W.sunDir).multiplyScalar(90).add(W.sun.target.position);
    W.sun.target.updateMatrixWorld();
  }

  /** Navigasyon rotası (dünya noktaları) ya da null. */
  route() {
    if (!this.active || !this.navOn || !this.navTarget) return null;
    const g = this.game;
    const p = (g.vehicles.driving?.pos ?? g.player.pos).clone().setY(0);
    if (this.phase === 'intro') return [p, this.navTarget.clone()];
    if (this.phase === 'road') {
      const s = Math.max(0, this.road.progress(p));
      const pts = [p];
      for (let k = s + 40; k < OP3.road.length; k += 40) {
        pts.push(this.road.point(k, 0));
        if (k - s > 900) return pts;                 // mini harita için yeter
      }
      const O = this.road.point(OP3.road.length, 0);
      pts.push(O);
      return pts.concat(this.city.route(O, this.navTarget).slice(1));
    }
    return this.city.route(p, this.navTarget);
  }

  /** Rotanın kalan uzunluğu (m). */
  routeLength(r) {
    let d = 0;
    for (let i = 1; i < r.length; i++) d += r[i].distanceTo(r[i - 1]);
    if (this.phase === 'road') d += Math.max(0, OP3.road.length - this.road.progress(r[0]) - 900);
    return d;
  }

  /** HUD: ipucu (E, P). */
  hint() {
    const g = this.game, p = g.player.pos;
    if (this.phase === 'intro' && this.chase && this.jeep && !g.vehicles.driving
      && Math.hypot(this.jeep.pos.x - p.x, this.jeep.pos.z - p.z) < 4.2) return ['F', 'arazi aracına bin — kaç!'];
    if (this.phoneState === 'ping') return ['P', 'telefonu çıkar — 1 yeni mesaj'];
    if (this.phase === 'city' && g.weaponry.holstered && !g.vehicles.driving && this.hasPistol) return ['P', 'silahı cepten çıkar'];
    if (this.phoneState === 'open') return ['P', 'telefonu kaldır'];
    if (this.phase !== 'city' || g.vehicles.driving) return null;
    if (this.objective === 'house' && this.houseTable && p.distanceTo(this.houseTable) < 2.4) return ['E', 'tabancayı al (3 şarjör)'];
    if (this.objective === 'loot' && this.lootGroup?.members.some((m) => m.pos.distanceTo(p) < 2.4)) return ['E', 'tüfeği ve üniformayı al'];
    return null;
  }

  /** Üst bilgi: görev evresi ve hedef. */
  drawHud() {
    const el = (id) => document.getElementById(id);
    const r = this.route();
    const nav = el('nav-readout');
    if (r && r.length > 1) {
      const d = this.routeLength(r);
      nav.hidden = false;
      nav.textContent = d > 1000 ? `HEDEF ${(d / 1000).toFixed(1)} km` : `HEDEF ${Math.round(d)} m`;
    } else nav.hidden = true;
    el('wave-label').textContent = 'SUİKAST';
    const obj = {
      intro: this.chase ? 'Kaç — arazi aracına bin' : 'Silah arkadaşların kızgın',
      road: this.phoneState === 'ping' ? 'Telefonuna mesaj geldi (P)' : 'Patikayı izle',
      house: 'Sığınak evdeki tabancayı al',
      hunt: 'Bir devriyeyi (5 asker) etkisiz hale getir',
      loot: 'Cesetlerden tüfek ve üniforma al',
      boss: 'Kılığınla komutanın yanına git',
      talk: 'Komutan seninle konuşuyor',
      kill: 'Arkasını döndü — vur',
    };
    const key = this.phase === 'city' ? this.objective : this.phase;
    el('wave-num').textContent = this.phase === 'city' ? 'ŞEHİR' : this.phase === 'road' || this.phase === 'toRoad' ? 'PATİKA' : 'KAÇIŞ';
    el('enemies-left').textContent = obj[key] ?? '';
    if (this.phase === 'road') {
      const s = Math.min(OP3.road.length, Math.max(0, this.road.progress(this.jeep.pos)));
      el('wave-bar-fill').style.width = `${((s / OP3.road.length) * 100).toFixed(1)}%`;
    }
    const tag = el('disguise-tag');
    if (tag) tag.hidden = !this.disguised;
  }
}
