/* Füze Rampası — ikinci özel görev.

   1. YOL (road.js): zırhlı araçla ormanın içinden 12 km. Yolda pusular var:
      1 → kuleye geç (silah arkadaşın direksiyona geçer, yolu izleyerek
      sürer), 2 → direksiyona geç (arkadaşın kuleye). Arkadaşın yavaş ve
      dikkatli sürer, sen hızlı; pusuda kulede olmak, açık yolda
      direksiyonda olmak işine gelir.
   2. ORMAN: yol bitince orman haritasına inilir; 40 kişilik saldırı, ardından
      30 kişilik ikinci dalga.
   3. RAMPA: roketatar kamyonunun (assets/props/mlrs.glb — kullanıcının
      Blender'daki MLRS modeli, tools/export_mlrs.py) yanındaki operatöre
      yaklaşıp E: sinematik. Operatör kumandanın emniyet kapağını kaldırır,
      başparmağı düğmeye iner; onu vurursun ama düşerken düğmeye basar.
      Tüp kapakları fırlar, füze büyük bir gürültüyle ateşlenir, her yer
      dumanla kaplanır; duman çekilince bölüm biter (devamı 3. bölümde).  */

import * as THREE from 'three';
import { Road, ROAD } from './road.js';
import { Soldier } from './soldier.js';
import { camoTexture } from './apc.js';
import { mapById } from './maps.js';

export const OP2 = {
  waves: [40, 30],
  site: new THREE.Vector3(0, 0, -48),       // roketatar sahası (orman haritası)
  arrive: new THREE.Vector3(0, 0, 100),     // zırhlı aracın durduğu yer
  vehicleHp: 4200,
  roadVmax: 24,                              // oyuncu sürerken (m/sn)
  autoV: 11, autoVFight: 6.5,                // arkadaş sürerken
  repair: 600,                               // pusu temizlenince zırh yaması
};

// MLRS modeli (glTF): +X ileri, tüp ekseni ve füzenin tüpteki noktası
// export_mlrs.py'nin "MLRS_OK" satırından (Blender → glTF: x, z, −y)
const TUBE_AXIS = new THREE.Vector3(0.8387, 0.5446, 0).normalize();
const ROCKET_REST = new THREE.Vector3(-2.388, 4.393, -0.61);
const MLRS_LIFT = 0.35;                      // tekerlek altı y = −0.35

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { const k = clamp01(x); return k * k * (3 - 2 * k); };
const lerp = THREE.MathUtils.lerp;

/** Kumanda: emniyet kapaklı kırmızı düğme, LED ve anten (metre). */
function buildRemote() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x2f3624, roughness: 0.7, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6, metalness: 0.4 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb01810, roughness: 0.35, emissive: 0x300000 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(new THREE.BoxGeometry(0.075, 0.03, 0.13), body, 0, 0, 0);
  add(new THREE.BoxGeometry(0.06, 0.004, 0.03), dark, 0, 0.016, 0.035);        // etiket plakası
  const antenna = add(new THREE.CylinderGeometry(0.003, 0.004, 0.16, 6), dark, 0.026, 0.09, -0.055);
  antenna.rotation.x = -0.15;
  add(new THREE.SphereGeometry(0.007, 8, 6), dark, 0.026, 0.17, -0.068);
  const ring = add(new THREE.CylinderGeometry(0.019, 0.019, 0.006, 16), dark, 0, 0.017, -0.02);
  ring.name = 'ring';
  const button = add(new THREE.CylinderGeometry(0.012, 0.013, 0.01, 16), red, 0, 0.023, -0.02);
  // Emniyet kapağı: arka kenarındaki menteşeden kalkar
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.022, -0.002);
  g.add(hinge);
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.006, 0.042),
    new THREE.MeshStandardMaterial({ color: 0xc8301e, roughness: 0.4, transparent: true, opacity: 0.85 }));
  cover.position.set(0, 0, -0.021);
  hinge.add(cover);
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 0 });
  add(new THREE.SphereGeometry(0.004, 8, 6), ledMat, -0.025, 0.018, 0.045);
  return { group: g, button, hinge, ledMat };
}

/** Yumuşak kenarlı ışıma (alev parlaması için). */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,250,230,1)');
  gr.addColorStop(0.25, 'rgba(255,200,110,0.85)');
  gr.addColorStop(0.6, 'rgba(255,120,40,0.25)');
  gr.addColorStop(1, 'rgba(255,90,20,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Op2 {
  constructor(game) {
    this.game = game;
    this.road = new Road(game);
    this.active = false;
    this.phase = null;          // road | arrive | battle | advance | cine | done
    this.assets = null;
    this.site = null;
  }

  /** Yol kipi (varış geçişi dahil): sektör akışı durur, harita gizli. */
  get roadActive() { return this.active && (this.phase === 'road' || this.phase === 'arrive'); }

  /* ── Varlıklar ────────────────────────────────────────────────────── */

  async load(onProgress) {
    if (this.assets) return;
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    onProgress?.(0.1, 'Roketatar');
    const [mlrs, fuze] = await Promise.all([
      loader.loadAsync('assets/props/mlrs.glb'),
      loader.loadAsync('assets/props/mlrs_fuze.glb'),
    ]);
    onProgress?.(0.9, 'Füze');
    const camo = camoTexture('orman').clone();
    camo.needsUpdate = true;
    const camoMat = new THREE.MeshStandardMaterial({ map: camo, roughness: 0.62, metalness: 0.08 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92, metalness: 0 });
    const prep = (root) => root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const fix = (m) => (m?.name === 'Camo' ? camoMat : m?.name === 'Rubber' ? rubber : m);
      o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
    });
    prep(mlrs.scene);
    prep(fuze.scene);
    // Füze gökte uzaklaştığında sisle silinmesin
    fuze.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => { const k = m.clone(); k.fog = false; return k; })
        : Object.assign(o.material.clone(), { fog: false });
    });

    // Füzenin ekseni boyunca boyu: kuyruk (meme) ve burun uzaklığı
    let tail = 0, nose = 0;
    const v = new THREE.Vector3();
    fuze.scene.updateMatrixWorld(true);
    fuze.scene.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 3) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).sub(ROCKET_REST);
        const d = v.dot(TUBE_AXIS);
        tail = Math.min(tail, d);
        nose = Math.max(nose, d);
      }
    });
    this.assets = { mlrs: mlrs.scene, fuze: fuze.scene, tail, nose, glow: glowTexture() };
    onProgress?.(1, 'Hazır');
  }

  /* ── Başlangıç / bitiş ────────────────────────────────────────────── */

  /** game.startOp2 ortak hazırlıktan sonra çağırır. */
  begin() {
    const g = this.game;
    this.active = true;
    this.phase = 'road';
    this.ambushIdx = 0;
    this.amb = null;
    this._hudAt = 0;
    this._smokeAt = 0;

    // Yol, ana haritanın çok uzağında: harita gizlenir, sınır kaldırılır,
    // sektör akışı durur (game._step roadActive iken world.update'i atlar)
    g.world.setTheme(mapById('orman'));
    g.world.setVisible(false);
    this._half = g.world.half;
    g.world.half = 1e6;
    this.road.start();

    const s0 = 24;
    const pos = this.road.point(s0, 1.6);
    const t = this.road.tangent(s0);
    const yaw = Math.atan2(-t.z, t.x);            // araç ileri yönü (cos, −sin)
    const v = g.vehicles.spawn(pos, yaw, mapById('orman'));
    v.vmax = OP2.roadVmax;
    v.hp = v.maxHp = OP2.vehicleHp;
    v.pathDriver = (veh, dt, now) => this._drivePath(veh, dt, now);
    this.v = v;

    g.player.pos.copy(pos);
    g.allies.engageRange = 60;
    g.allies.spawn(3, pos, null);
    g.enemies.allies = g.allies.allies;
    g.nametags.rebuild(g.allies.allies);
    g.vehicles.enter(v);                          // sürücü sen, kulede arkadaşın
    g.player.yaw = yaw - Math.PI / 2;
    this.road.update(this.road.progress(v.pos), true);

    g.hud.setRaidMode(0);
    g.hud.banner('FÜZE RAMPASI', 'ORMANDAKİ ROKETATARA 12 KM — YOLDA PUSULARA DİKKAT', 5200);
    g.hud.feed('W A S D sür · 1: kuleye geç (arkadaşın sürer) · 2: direksiyona geç', true);
  }

  /* ── Kayıt ────────────────────────────────────────────────────────── */

  save() {
    const g = this.game;
    return {
      phase: this.phase, ambushIdx: this.ambushIdx, wave: g.enemies.wave,
      s: this.phase === 'road' && this.v ? this.road.progress(this.v.pos) : null,
    };
  }

  /** begin()'den sonra. @returns oyuncu konumu da yüklensin mi */
  restore(p) {
    const g = this.game;
    if (p.phase === 'road') {
      const s = Math.max(24, p.s ?? 24);
      const v = this.v;
      v.pos.copy(this.road.point(s, 1.6));
      const t = this.road.tangent(s);
      v.yaw = Math.atan2(-t.z, t.x);
      g.player.yaw = v.yaw - Math.PI / 2;
      this.ambushIdx = p.ambushIdx ?? 0;
      this.road.update(s, true);
      return false;
    }
    // Çatışma ve sonrası: orman sahası, kaldığın dalgadan
    this._setupBattle();
    if (p.phase === 'battle' || p.phase === 'arrive') {
      this.waveAt = 0;
      g.enemies.startWave(Math.max(1, p.wave || 1));
    } else {
      g.enemies.state = 'idle';
      this.phase = 'advance';
      g.hud.banner('KALDIĞIN YERDEN', 'ROKETATARA İLERLE — OPERATÖRE YAKLAŞ, E', 5000);
    }
    return true;
  }

  /** Görevden çıkış (ana menü, yeni tur): her şey eski hâline. */
  end() {
    if (!this.active) return;
    const g = this.game;
    this.active = false;
    this.phase = null;
    this.road.stop();
    if (this._half) { g.world.half = this._half; this._half = 0; }
    g.world.setVisible(true);
    g.world.setClearZone(null);
    this._clearSite();
    this._cineCleanup();
  }

  /* ── Her kare ─────────────────────────────────────────────────────── */

  update(dt, now) {
    if (!this.active) return;
    if (this.phase === 'road') this._updateRoad(dt, now);
    else if (this.phase === 'battle' && this.waveAt && now > this.waveAt) {
      this.waveAt = 0;
      this.game.enemies.startWave(1);
    }
    if (this.site) this._updateOperator(dt, false);
  }

  _updateRoad(dt, now) {
    const g = this.game;
    const v = this.v;
    if (v.dead) {
      g.hud.feed('ZIRHLI ARAÇ İMHA EDİLDİ — görev başarısız', true);
      g.gameOver();
      return;
    }
    const s = this.road.progress(v.pos);
    this.road.update(s);

    // Güneş gölgesi oyuncuyu izlesin (dünya akışı bu kipte çalışmıyor)
    const W = g.world;
    W.sun.target.position.set(v.pos.x, 0, v.pos.z);
    W.sun.position.copy(W.sunDir).multiplyScalar(90).add(W.sun.target.position);
    W.sun.target.updateMatrixWorld();

    // Pusu: aracın ~230 m önünde manga belirir
    const A = ROAD.ambushes;
    if (this.ambushIdx < A.length && s > A[this.ambushIdx] - 230) this._spawnAmbush(this.ambushIdx++, now);
    if (this.amb) {
      const left = this.amb.enemies.filter((e) => e.alive).length;
      if (!left) {
        v.hp = Math.min(v.maxHp, v.hp + OP2.repair);
        g.hud.banner('PUSU TEMİZLENDİ', g.vehicles.topside === v ? '2: DİREKSİYONA GEÇ — YOL AÇIK' : 'YOLA DEVAM', 3200);
        g.hud.feed(`Mürettebat zırhı yamadı (+${OP2.repair})`);
        this.amb = null;
      } else if (s > this.amb.at + 260) {
        // Geride kalanlar peşinden gelemez: sahneden kalkar
        for (const e of this.amb.enemies) if (e.alive) g.enemies.despawn(e);
        this.amb = null;
      }
    }

    // Pusu enkazlarından tüten duman
    if (now > this._smokeAt && this.road.wrecks) {
      this._smokeAt = now + 0.14;
      for (const [a, p] of this.road.wrecks) {
        if (Math.abs(this.road.progress(p) - s) > 220) continue;
        g.effects.puff(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5)),
          new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.4 + Math.random(), (Math.random() - 0.5) * 0.4),
          0x2f2b27, 1.4 + Math.random() * 1.2, 5 + Math.random() * 2, 0.15, 0.6);
        if (Math.random() < 0.4) g.effects.puff(p, new THREE.Vector3(0, 1.2, 0), 0xff9a3c, 0.35, 0.35, 0, 2);
      }
    }

    if (s >= ROAD.length) this._arrive(now);
  }

  /** Arkadaşın sürüşü: şeridi izler; pusuda yavaşlar, enkazın yanından geçer. */
  _drivePath(v, dt, now) {
    const s = this.road.progress(v.pos);
    const look = 12 + Math.abs(v.speed) * 0.7;
    const target = this.road.point(s + look, this.road.lane(s + look));
    const want = Math.atan2(-(target.z - v.pos.z), target.x - v.pos.x);
    const diff = wrap(want - v.yaw);
    const fight = this.amb?.enemies.some((e) => e.alive);
    const vT = (fight ? OP2.autoVFight : OP2.autoV) * (Math.abs(diff) > 0.6 ? 0.5 : 1);
    const input = {
      forward: v.speed < vT ? 1 : 0,
      right: THREE.MathUtils.clamp(-diff * 2.4, -1, 1),
      jump: v.speed > vT + 1.5,
    };
    if (s >= ROAD.length) { input.forward = 0; input.jump = true; }
    this.game.vehicles._physics(v, dt, now, input);
  }

  _spawnAmbush(i, now) {
    const g = this.game;
    const a = ROAD.ambushes[i];
    const n = 6 + Math.floor(i * 0.6);
    const enemies = [];
    for (let j = 0; j < n; j++) {
      const s = a - 40 + (j + Math.random() * 0.6) * (90 / n);
      const side = j % 2 ? 1 : -1;
      const p = this.road.point(s, side * (16 + Math.random() * 14));
      const type = j === 0 && i >= 3 ? 'brute' : Math.random() < 0.4 ? 'spitter' : 'runner';
      const e = g.enemies.spawnAt(type, p, 1 + i * 0.5);
      e.shootRange = 48;                     // pusu: yol kenarından uzun menzil
      e.vsVehicle = 3;                       // zırh delici: araca üç kat
      enemies.push(e);
    }
    this.amb = { at: a, enemies };
    const onTop = g.vehicles.topside === this.v;
    g.hud.banner(`PUSU! · ${i + 1} / ${ROAD.ambushes.length}`,
      onTop ? 'KULEDESİN — ARKADAŞIN SÜRÜYOR, TEMİZLE' : '1: KULEYE GEÇ — ARKADAŞIN SÜRSÜN', 3800);
    g.audio.waveStart();
  }

  /** 1: kuleye geç (arkadaş sürer) · 2: direksiyona geç (arkadaş kuleye). */
  swap(n) {
    const g = this.game, vs = g.vehicles, v = this.v;
    if (this.phase !== 'road' || !v || v.dead || g.player.downed) return;
    // Yolcular korunur (climb/enter yakınlığa göre yeniden toplar; burada
    // gerek yok — herkes zaten araçta)
    const riders = v.riders.filter((a) => a.alive);
    if (n === 1 && vs.driving === v) {
      const driver = v.gunner?.alive ? v.gunner : riders[0];
      if (!driver) { g.hud.feed('Sürecek silah arkadaşı kalmadı', true); return; }
      vs.driving = null;
      vs.topside = v;
      v.topAmmo ??= 3000;
      v.nextTopShot = 0;
      v.gunner = null;
      v.driverAlly = driver;
      for (const a of riders) a.root.visible = false;
      v.autoDrive = true;
      g.player.eye = 3.05;
      g.player.yaw = v.yaw + v.turretYaw - Math.PI / 2;
      g.player.pitch = 0;
      g.audio.swap();
      g.hud.feed('KULEDESİN — arkadaşın direksiyonda, yolu izliyor', true);
    } else if (n === 2 && vs.topside === v) {
      vs.topside = null;
      v.autoDrive = false;
      vs.driving = v;
      v.gunner = v.driverAlly?.alive ? v.driverAlly : riders[0] ?? null;
      if (v.gunner) v.gunner.root.visible = true;
      g.player.eye = 1.66;
      g.player.yaw = v.yaw - Math.PI / 2;
      g.player.pitch = -0.18;
      g.audio.swap();
      g.hud.feed('DİREKSİYONDASIN — arkadaşın kulede', true);
    }
  }

  /* ── Varış ve orman çatışması ─────────────────────────────────────── */

  _arrive(now) {
    const g = this.game;
    this.phase = 'arrive';
    g.state = 'cinematic';
    const fade = document.getElementById('op-fade');
    fade.classList.add('on');
    g.activeCine = {
      t: 0,
      update: (dt) => {
        g.activeCine.t += dt;
        if (g.activeCine.t > 1.1 && !g.activeCine.done) {
          g.activeCine.done = true;
          this._setupBattle();
          setTimeout(() => fade.classList.remove('on'), 150);
          g.activeCine = null;
          g.state = 'playing';
        }
      },
      skip: () => {},
    };
  }

  _setupBattle() {
    const g = this.game;
    this.road.stop();
    g.world.half = this._half;
    this._half = 0;
    g.world.setVisible(true);
    const S = OP2.site, A = OP2.arrive;
    g.world.setClearZone({ x: S.x, z: S.z, r: 18 });
    g.world.setClearRects([{ x0: A.x - 8, x1: A.x + 8, z0: A.z - 12, z1: A.z + 12 }]);
    g.enemies.reset();

    // Araç orman yolunda durur; herkes iner
    const v = this.v;
    const vs = g.vehicles;
    if (vs.topside === v) { vs.topside = null; v.autoDrive = false; vs.driving = v; }
    v.pos.copy(A);
    v.yaw = Math.PI / 2;                    // ileri −Z (sahaya doğru)
    v.speed = 0;
    v.vmax = undefined;
    v.root.position.copy(v.pos);
    v.root.rotation.y = v.yaw;
    v.root.updateMatrixWorld(true);
    if (vs.driving !== v) vs.driving = v;
    vs.exit();
    g.player.eye = 1.66;
    g.player.yaw = 0;
    g.player.pitch = 0;

    this._buildSite();

    g.camera.position.set(g.player.pos.x, 1.66, g.player.pos.z);
    g.camera.rotation.set(0, 0, 0);
    g.camera.updateMatrixWorld();
    g.world.update(g.camera, g.player.pos, performance.now() / 1000, 40);

    g.enemies.raid = { waves: OP2.waves, center: S, minR: 28, maxR: 70, maxAlive: 16 };
    g.hud.setRaidMode(OP2.waves.length, 'ÇATIŞMA');
    this.phase = 'battle';
    this.waveAt = performance.now() / 1000 + 4;
    g.hud.banner('ORMAN BÖLGESİ', '40 DÜŞMAN YAKLAŞIYOR — MEVZİ AL', 4500);
  }

  /** Dalga bitti (game._onWaveClear). */
  onWaveClear(wave) {
    const g = this.game;
    if (wave < OP2.waves.length) {
      g.hud.banner(`${OP2.waves[wave - 1]} ASKER PÜSKÜRTÜLDÜ`, `${OP2.waves[wave]} ASKER DAHA GELİYOR`, 4500);
      return;
    }
    g.enemies.state = 'idle';                  // üçüncü dalga yok
    this.phase = 'advance';
    g.hud.banner('İKİ DALGA DA PÜSKÜRTÜLDÜ', 'ROKETATARA İLERLE — OPERATÖRE YAKLAŞ, E', 6000);
    g.hud.feed('Roketatar kuzeyde, açıklıkta', true);
  }

  /* ── Roketatar sahası ─────────────────────────────────────────────── */

  _buildSite() {
    const g = this.game;
    this._clearSite();
    const S = OP2.site;
    const root = this.assets.mlrs.clone(true);
    root.position.set(S.x, MLRS_LIFT, S.z);
    root.rotation.y = Math.PI / 2;            // yerel +X (kabin, atış yönü) kuzeye
    g.scene.add(root);
    root.updateMatrixWorld(true);

    // Füze: aracın çerçevesinde, ekseni boyunca kayar
    const rocket = new THREE.Group();
    rocket.add(this.assets.fuze.clone(true));
    root.add(rocket);
    const capFront = root.getObjectByName('CapFront');
    const capBack = root.getObjectByName('CapBack');

    // Çarpışma: gövde kutusu (rampa yüksekliği dahil) + çevresinde siper
    const box = new THREE.Box3().setFromObject(root);
    box.max.y = Math.min(box.max.y, 3.6);
    const solids = [];
    root.traverse((o) => { if (o.isMesh) solids.push(o); });
    const cover = [];
    for (const [dx, dz, nx, nz] of [[3.2, 0, 1, 0], [-3.2, 0, -1, 0], [0, 7, 0, 1], [0, -7, 0, -1]]) {
      cover.push({ pos: new THREE.Vector3(S.x + dx, 0, S.z + dz), normal: new THREE.Vector3(nx, 0, nz), taken: null });
    }
    const fixture = { colliders: [box], solids, cover };
    g.world.addFixture(fixture);

    // Operatör: kamyonun doğusunda diz çökmüş, kumanda elinde, kamyona dönük
    const rig = g.enemySoldiers.create();
    const op = new Soldier(rig, { team: 'enemy', rifle: null, tint: null });
    op.root.position.set(S.x + 5.6, 0, S.z + 1.2);
    op.root.rotation.y = Math.PI / 2;          // ileri −X (batı, kamyon)
    g.scene.add(op.root);
    const remote = buildRemote();
    g.scene.add(remote.group);

    this.site = {
      root, rocket, capFront, capBack, fixture, op, remote,
      opDying: false, coverOpen: 0, thumb: 0, pressed: false,
    };
    this._updateOperator(0.016, true);
  }

  _clearSite() {
    const st = this.site;
    if (!st) return;
    const g = this.game;
    g.scene.remove(st.root, st.op.root, st.remote.group);
    for (const o of st.loose ?? []) g.scene.remove(o);
    g.world.removeFixture(st.fixture);
    this.site = null;
  }

  /** Operatör duruşu + elindeki kumanda (her kare). */
  _updateOperator(dt, force) {
    const st = this.site;
    const op = st.op;
    if (st.frozen && !st.opDying) {
      // Sinematikte poz donuk (kalibrasyon tutsun): yalnızca başparmak oynar
      for (const [bone, q] of st.frozen) bone.quaternion.copy(q);
    } else {
      op.update({
        dt, speed: 0, crouching: !st.opDying, downed: false, dying: st.opDying,
        aimPitch: -0.35, aiming: false,
      });
    }
    // Başparmak düğmeye iner (0 → 1): kemikler kendi Y eksenlerinde kıvrılır
    // (eksen ve oranlar ölçümle: parmak ucu düğmeye en çok bu yönde yaklaşıyor)
    const b = op.bones;
    // thumb 0: parmak 3 cm yukarıda · 0.55: düğmenin ~1.6 cm üstünde bekler ·
    // 1: düğmeye basar (uç düğme yüzeyinde)
    for (const [name, k] of [['RightHandThumb1', 0.52], ['RightHandThumb2', 1.05], ['RightHandThumb3', 0.9]]) {
      if (b[name]) b[name].rotateY(st.thumb * k * 0.4);
    }
    op.root.updateMatrixWorld(true);

    // Kumanda avuçta: önü (anten) elin uzandığı yöne, düğmeli üst yüzü
    // başparmak tarafına bakar — başparmak düğmenin üstünde durur
    const hand = b.RightHand, fore = b.RightForeArm, th = b.RightHandThumb1;
    if (!hand || !fore) return;
    const hp = hand.getWorldPosition(new THREE.Vector3());
    const f = hp.clone().sub(fore.getWorldPosition(new THREE.Vector3())).normalize();
    const td = th ? th.getWorldPosition(new THREE.Vector3()).sub(hp) : new THREE.Vector3(0, 1, 0);
    const up = td.addScaledVector(f, -td.dot(f)).normalize();
    const x = new THREE.Vector3().crossVectors(up, f.clone().negate()).normalize();
    const r = st.remote.group;
    r.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, f.clone().negate()));
    r.position.copy(hp).addScaledVector(f, 0.075).addScaledVector(up, 0.012);
    // Kalibrasyon (sinematik başında ölçülür): düğme, BASAN başparmağın
    // ucunun tam altına gelsin
    if (st.cal) r.position.addScaledVector(x, st.cal[0]).addScaledVector(up, st.cal[1]).addScaledVector(f, st.cal[2]);
    st.remoteUp = up;
    st.remoteF = f;
    st.remote.hinge.rotation.x = -st.coverOpen * 1.9;
    st.remote.button.position.y = st.pressed ? 0.019 : 0.023;
  }

  /** HUD: E ile sinematik (operatörün yanında). */
  nearOperator() {
    if (this.phase !== 'advance' || !this.site) return false;
    const p = this.game.player.pos, o = this.site.op.root.position;
    return Math.hypot(p.x - o.x, p.z - o.z) < 8;
  }

  tryCine() {
    if (this.nearOperator()) this._beginCine();
  }

  /** game._updateHud: ipucu (null: oyunun kendi ipucu kalır). */
  hint() {
    const g = this.game, v = this.v;
    if (this.phase === 'road' && v && !v.dead) {
      const z = `zırh %${Math.ceil((v.hp / v.maxHp) * 100)}`;
      if (g.vehicles.topside === v) return ['2', `direksiyona geç · arkadaşın sürüyor · ${z}`];
      if (g.vehicles.driving === v) return ['1', `kuleye geç (arkadaşın sürsün) · W/S gaz-fren · ${z} · ${Math.round(Math.abs(v.speed) * 3.6)} km/s`];
    }
    if (this.nearOperator()) return ['E', 'Roketatarı durdur'];
    return null;
  }

  /** HUD üst bilgisi (game._updateHud sonunda). */
  drawHud() {
    if (this.phase !== 'road' || !this.v) return;
    const s = Math.min(ROAD.length, Math.max(0, this.road.progress(this.v.pos)));
    const el = (id) => document.getElementById(id);
    el('wave-label').textContent = 'FÜZE RAMPASI';
    el('wave-num').textContent = 'YOL';
    el('enemies-left').textContent = `${(s / 1000).toFixed(1)} / ${ROAD.length / 1000} km`;
    el('wave-bar-fill').style.width = `${((s / ROAD.length) * 100).toFixed(1)}%`;
  }

  /* ── Sinematik ────────────────────────────────────────────────────── */

  _beginCine() {
    const g = this.game;
    const st = this.site;
    this.phase = 'cine';
    g.state = 'cinematic';
    g.input.consumeLook();
    g.hud.setHint(null);
    g.hud.hideBanner();
    g._setBinocular(false);
    for (const a of g.allies.allies) a.root.visible = false;

    // Kumanda kalibrasyonu: poz oturmuşken başparmak bir kez "basılı"
    // konuma alınır, ucunun düğmeye göre farkı kumandanın eksenlerinde ölçülür
    st.cal = null;
    st.frozen = null;
    st.thumb = 0;
    for (let i = 0; i < 60; i++) this._updateOperator(1 / 30, true);   // poz otursun
    st.frozen = new Map(['RightHandThumb1', 'RightHandThumb2', 'RightHandThumb3']
      .map((n) => st.op.bones[n]).filter(Boolean).map((b) => [b, b.quaternion.clone()]));
    st.thumb = 1;
    this._updateOperator(0.016, true);
    const tipBone = st.op.body.getObjectByName('RightHandThumb4') ?? st.op.bones.RightHandThumb3;
    if (tipBone && st.remoteUp) {
      st.remote.group.updateMatrixWorld(true);
      const d = tipBone.getWorldPosition(new THREE.Vector3())
        .sub(st.remote.button.getWorldPosition(new THREE.Vector3()));
      const up = st.remoteUp, f = st.remoteF;
      const x = new THREE.Vector3().crossVectors(up, f.clone().negate()).normalize();
      st.cal = [d.dot(x), d.dot(up) - 0.004, d.dot(f)];
    }
    st.thumb = 0;

    // Oyuncunun gözü (POV çekimi buradan); silah kalçadan nişana kalkar
    this.pov = new THREE.Vector3(g.player.pos.x, g.player.pos.y + 1.62, g.player.pos.z);
    this._shotStub = g.weaponry.onShot;
    g.weaponry.onShot = () => {};             // sahnelenen atış: oyun mantığı yok

    const el = {
      root: document.getElementById('cine'),
      eyebrow: document.getElementById('cine-eyebrow'),
      title: document.getElementById('cine-title'),
      sub: document.getElementById('cine-sub'),
    };
    el.root.hidden = false;
    el.root.classList.add('cine-title-out');
    document.body.classList.add('cinematic', 'cine-bars');
    this.cineEl = el;
    st.loose = [];
    this.cine = {
      t: 0, real: 0, fired: false, pressed: false, launched: false, rocketD: 0, rocketV: 0,
      beats: new Set(), shake: 0, light: null, plume: null, glow: null, caps: [],
    };
    g.activeCine = { update: (dt, now) => this._cineUpdate(dt, now), skip: () => this._cineFinish() };
    g.audio.init();
    g.music.setLevel(0.04, 1.2);
  }

  /** Sinematiğin bir anında tek seferlik olay. */
  _once(key, cond) {
    if (!cond || this.cine.beats.has(key)) return false;
    this.cine.beats.add(key);
    return true;
  }

  _cineUpdate(dt, now) {
    const g = this.game, st = this.site, c = this.cine;
    const cam = g.camera;
    // Ağır çekim: atış öncesi/sonrası (6.2 – 10 sn) zaman yavaşlar
    const slow = c.t > 6.2 && c.t < 9.7 ? 0.42 : 1;
    const sdt = dt * slow;
    c.t += sdt;
    c.real += dt;
    const t = c.t;
    const R = st.root;
    const L = (x, y, z) => R.localToWorld(new THREE.Vector3(x, y, z));
    const opHead = st.op.bones.Head?.getWorldPosition(new THREE.Vector3()) ?? st.op.root.position.clone().setY(1.2);
    const remoteP = st.remote.group.position.clone();

    // ── Kumanda: emniyet kapağı kalkar, başparmak iner, LED yanıp söner ──
    st.coverOpen = smooth((t - 4.1) / 0.5);
    if (this._once('cover', t > 4.2)) g.audio.click(false);
    st.thumb = t < 8.9 ? smooth((t - 4.9) / 2.8) * 0.55 : 0.55 + smooth((t - 8.9) / 0.16) * 0.45;
    st.remote.ledMat.emissiveIntensity = c.pressed ? 3.2 : (Math.sin(t * 9) > 0 && t > 4.6 ? 1.6 : 0.1);
    for (const at of [3.7, 4.9, 6.0, 7.0]) if (this._once(`hb${at}`, t > at)) g.audio.heartbeat();

    // ── Atış: POV'da 8.2'de tetik, 8.9'da isabet; düşerken düğmeye basar ──
    if (this._once('fire', t > 8.2)) {
      g.weaponry.tryFire(now);
      g.player.shake(0.4);
      c.shake = 0.08;
    }
    if (this._once('hit', t > 8.9)) {
      // İsabet: sarsılır, başparmak düğmeye çöker; yere yığılma geniş
      // planda (9.9) — yakın çekimde el kadrajdan kaçmasın
      c.flinch = 1;
      g.effects.hitBurst(opHead.clone().add(new THREE.Vector3(0, -0.25, 0)), 0x8a1a12, 22);
      g.audio.hit(true);
      g.audio.enemyDeath();
    }
    if (this._once('press', t > 9.05)) {
      c.pressed = true;
      st.pressed = true;
      st.remote.button.material.emissive.setHex(0xff2010);
      st.remote.button.material.emissiveIntensity = 2.2;
      g.audio.click(true);
    }
    if (this._once('fall', t > 9.9)) st.opDying = true;

    // ── Ateşleme: 9.9 kapaklar + geri tepme alevi, 10.15 füze yola çıkar ──
    if (this._once('ignite', t > 9.9)) this._ignite(L);
    if (c.launched) this._flyRocket(sdt, L);

    // ── Her yer duman: 15.5'te yoğunlaşır, 20.5'ten sonra çekilir ──────
    if (t > 15 && t < 20 && now > (c.nextFog ?? 0)) {
      c.nextFog = now + 0.05;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 26;
        g.effects.puff(new THREE.Vector3(OP2.site.x + Math.cos(a) * r, 0.5 + Math.random() * 3, OP2.site.z + Math.sin(a) * r),
          new THREE.Vector3(Math.cos(a) * 1.2, 0.3 + Math.random() * 0.4, Math.sin(a) * 1.2),
          Math.random() < 0.5 ? 0x8c8780 : 0x6f6a63, 5 + Math.random() * 5, 7 + Math.random() * 4, 0.05, 0.35);
      }
    }
    const veil = document.getElementById('smoke-veil');
    // Takip planında (12.6–15.6) gökyüzü açık; yere dönünce her yer duman
    const fog = t < 15.4 ? 0 : t < 16.9 ? smooth((t - 15.4) / 1.5) * 0.95
      : t < 20.5 ? 0.95 : 0.95 * (1 - smooth((t - 20.5) / 4.6));
    veil.style.opacity = fog.toFixed(3);
    if (this._once('rumble', t > 15.5)) g.audio.rumble(8);

    // ── Kamera çekimleri ───────────────────────────────────────────────
    let pos, look, fov = 50;
    const opPos = st.op.root.position;
    if (t < 3.6) {
      // S1: yüksekten alçalan geniş açı — açıklık, kamyon, diz çökmüş operatör
      const k = smooth(t / 3.6);
      pos = L(lerp(-24, -14, k), lerp(16, 6, k), lerp(26, 18, k));
      look = L(lerp(-2, -1, k), 2.6, lerp(0, 3, k));
      fov = 46;
    } else if (t < 6.2) {
      // S2: kumandaya yakın çekim — emniyet kapağı, başparmak, LED
      // Düğmeye üstten bakış (başparmak tarafından), yavaşça yaklaşır
      const k = smooth((t - 3.6) / 2.6);
      const up = st.remoteUp, f = st.remoteF;
      // Kamera parmakların önünde: kol arka planda kalır, kadrajı kapatmaz
      pos = remoteP.clone().addScaledVector(up, lerp(0.34, 0.22, k)).addScaledVector(f, lerp(0.34, 0.22, k))
        .add(new THREE.Vector3(0, 0.04, 0));
      look = remoteP.clone().addScaledVector(f, -0.02);
      fov = 34;
    } else if (t < 8.6) {
      // S3: POV — silah nişana kalkar, operatörün başı nişangâhta
      const k = smooth((t - 6.2) / 1.2);
      pos = this.pov.clone();
      look = opHead.clone().lerp(remoteP, 0.15 * (1 - k));
      fov = lerp(60, 44, k);
      g.weaponry.rig.visible = true;
      g.weaponry.update({ dt: sdt, now, ads: k > 0.2, firing: false, moving: false, sprinting: false, look: { dx: 0, dy: 0 } });
    } else if (t < 9.9) {
      // S4: kumanda — isabetin sarsıntısında başparmak düğmeye çöker
      // Aynı düğme, daha yakından ve yandan: isabetle başparmak çöker
      const up = st.remoteUp, f = st.remoteF;
      const x = new THREE.Vector3().crossVectors(up, f).normalize();
      c.flinch = (c.flinch ?? 0) * Math.pow(0.02, sdt);
      pos = remoteP.clone().addScaledVector(up, 0.27).addScaledVector(x, 0.08).addScaledVector(f, 0.26)
        .add(new THREE.Vector3(0, 0.03, 0));
      look = remoteP.clone().addScaledVector(f, -0.02);
      fov = 30;
      c.shake = Math.max(c.shake, (c.flinch ?? 0) * 0.025);
    } else if (t < 12.6) {
      // S5: kamyonun yanından geniş — kapaklar fırlar, geri tepme, füze çıkar
      const k = smooth((t - 9.9) / 2.7);
      pos = L(lerp(-6, -9, k), lerp(2.2, 3.2, k), 17);
      look = L(lerp(-1.5, 6, k), lerp(4.5, 9, k), 0);
      fov = 52;
    } else if (t < 15.6) {
      // S6: füzenin peşinde — arkasından ve altından kovalar, giderek geride
      // kalır; füze gökte küçülür
      const rp = L(...ROCKET_REST.clone().add(st.rocket.position).toArray());
      const k = smooth((t - 12.6) / 3);
      const ax = TUBE_AXIS.clone().transformDirection(R.matrixWorld);
      const side = new THREE.Vector3().crossVectors(ax, new THREE.Vector3(0, 1, 0)).normalize();
      pos = rp.clone().addScaledVector(ax, -lerp(22, 70, k)).addScaledVector(side, lerp(7, 14, k))
        .add(new THREE.Vector3(0, -lerp(4, 10, k), 0));
      look = rp.clone().addScaledVector(ax, 8);
      fov = lerp(50, 38, k);
    } else if (t < 20.5) {
      // S7: dumanın içi — sahada, her yer gri
      const k = (t - 15.6) / 4.9;
      pos = L(-14 + k * 2, 2.4, 12 - k * 1.5);
      look = L(0, 2.6, 0);
      fov = 55;
    } else {
      // S8: duman çekilir — boş tüp, yerde yatan operatör
      const k = smooth((t - 20.5) / 6);
      pos = L(lerp(-15, -10, k), lerp(3, 4.5, k), lerp(11, 14, k));
      look = L(-2.5, 3.2, 2).lerp(opPos.clone().setY(0.6), 0.25);
      fov = 48;
    }
    // Sarsıntı
    c.shake *= Math.pow(0.08, dt);
    const sh = c.shake;
    pos.x += (Math.random() - 0.5) * sh; pos.y += (Math.random() - 0.5) * sh; pos.z += (Math.random() - 0.5) * sh;
    cam.position.copy(pos);
    cam.lookAt(look);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }

    this._updateOperator(sdt, false);
    this._updateLoose(sdt);

    // ── Kapanış kartı ve bitiş ─────────────────────────────────────────
    if (this._once('card', t > 24.5)) {
      const el = this.cineEl;
      el.eyebrow.textContent = 'FÜZE RAMPASI';
      el.title.textContent = '2. BÖLÜM TAMAMLANDI';
      el.sub.textContent = 'Füze havada. Peşinden gitmek 3. bölümde.';
      el.root.classList.remove('cine-title-out');
    }
    if (t > 31) this._cineFinish();
  }

  /** Kapaklar fırlar, geri tepme alevi ve dumanı, füze motoru ateşlenir. */
  _ignite(L) {
    const g = this.game, st = this.site, c = this.cine;
    const R = st.root;
    const axisW = TUBE_AXIS.clone().transformDirection(R.matrixWorld);
    const tail = L(...ROCKET_REST.clone().addScaledVector(TUBE_AXIS, this.assets.tail).toArray());
    const front = L(...ROCKET_REST.clone().addScaledVector(TUBE_AXIS, this.assets.nose + 0.2).toArray());

    // Tüp kapakları: ön kapak ileri, arka kapak geri fırlar
    for (const [cap, dir, speed] of [[st.capFront, axisW, 22], [st.capBack, axisW.clone().negate(), 14]]) {
      if (!cap) continue;
      g.scene.attach(cap);
      st.loose.push(cap);
      c.caps.push({
        o: cap,
        v: dir.clone().multiplyScalar(speed).add(new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3)),
        w: new THREE.Vector3(Math.random() * 14, Math.random() * 14, Math.random() * 14),
      });
    }

    // Geri tepme: tüpün arkasından yere çarpan alev ve yoğun duman
    g.effects.explode(tail, 0xff9a3c, 70);
    for (let i = 0; i < 90; i++) {
      const d = axisW.clone().negate().multiplyScalar(4 + Math.random() * 10)
        .add(new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.3) * 3, (Math.random() - 0.5) * 9));
      g.effects.puff(tail.clone(), d, Math.random() < 0.3 ? 0x9a948b : 0x6c675f,
        2.5 + Math.random() * 4, 6 + Math.random() * 5, 0.05, 0.5);
    }
    for (let i = 0; i < 30; i++) {
      g.effects.puff(front.clone(), axisW.clone().multiplyScalar(6 + Math.random() * 6)
        .add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)),
      0x8c8780, 1.5 + Math.random() * 2, 4 + Math.random() * 3, 0.05, 0.8);
    }

    // Motor alevi: koni + ışıma + ışık, füzenin kuyruğunda
    // Alev ve ışıma sisten etkilenmez (füze uzakta da parlasın)
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.22, 3.2, 12, 1, true), flameMat);
    // Koninin ucu −eksen yönünde: önce Y'yi eksene çevir, sonra geri döndür
    plume.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), TUBE_AXIS);
    plume.position.copy(ROCKET_REST).addScaledVector(TUBE_AXIS, this.assets.tail - 1.5);
    st.rocket.add(plume);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.assets.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    glow.scale.setScalar(5);
    glow.position.copy(ROCKET_REST).addScaledVector(TUBE_AXIS, this.assets.tail - 0.4);
    st.rocket.add(glow);
    const light = new THREE.PointLight(0xffb060, 60, 70, 1.6);
    light.position.copy(glow.position);
    st.rocket.add(light);
    c.plume = plume; c.glow = glow; c.light = light;
    c.launched = true;
    c.shake = 0.35;
    g.audio.missileLaunch();
    g.player.shake(1);
  }

  /** Füze: ilk 0.25 sn yavaş, sonra hızla ivmelenerek eksen boyunca uçar. */
  _flyRocket(dt, L) {
    const g = this.game, st = this.site, c = this.cine;
    const a = c.rocketD < 6 ? 30 : 48;
    c.rocketV += a * dt;
    c.rocketD += c.rocketV * dt;
    st.rocket.position.copy(TUBE_AXIS).multiplyScalar(c.rocketD);
    const flick = 0.85 + Math.random() * 0.3;
    c.plume.scale.set(flick, 0.8 + Math.min(1.6, c.rocketV / 40) * flick, flick);
    c.glow.scale.setScalar(4 + Math.random() * 2.5);
    c.light.intensity = 45 + Math.random() * 25;
    // İz dumanı: önceki ve şimdiki kuyruk arası ~1.2 m'de bir (hızlı füzede
    // kare başına metrelerce yol alındığı için iz kopmasın); kalın, yavaş dağılan
    const tail = L(...ROCKET_REST.clone().addScaledVector(TUBE_AXIS, this.assets.tail + c.rocketD).toArray());
    const prev = c.lastTail ?? tail.clone();
    const n = Math.min(40, Math.max(1, Math.ceil(prev.distanceTo(tail) / 1.2)));
    for (let i = 0; i < n; i++) {
      const p = prev.clone().lerp(tail, (i + Math.random()) / n)
        .add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5));
      g.effects.puff(p, new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.15 + Math.random() * 0.4, (Math.random() - 0.5) * 0.7),
        Math.random() < 0.6 ? 0xdcd8d0 : 0xb4afa6, 1.4 + Math.min(4, c.rocketD / 70), 8 + Math.random() * 3, -0.02, 0.22);
    }
    c.lastTail = tail.clone();
    if (Math.random() < 0.7) g.effects.puff(tail, new THREE.Vector3(0, 0, 0), 0xffb060, 0.5, 0.25, 0, 1);
    if (c.rocketD > 900) { c.launched = false; c.light.intensity = 0; st.rocket.visible = false; }
  }

  /** Fırlayan kapaklar: yerçekimi, dönme, yerde durma. */
  _updateLoose(dt) {
    for (const p of this.cine?.caps ?? []) {
      if (p.o.position.y <= 0.08 && p.v.y <= 0) continue;
      p.v.y -= 9.8 * dt;
      p.o.position.addScaledVector(p.v, dt);
      p.o.rotation.x += p.w.x * dt; p.o.rotation.y += p.w.y * dt; p.o.rotation.z += p.w.z * dt;
      if (p.o.position.y < 0.08) { p.o.position.y = 0.08; p.v.set(0, 0, 0); }
    }
  }

  _cineCleanup() {
    const g = this.game;
    document.body.classList.remove('cinematic', 'cine-bars');
    const veil = document.getElementById('smoke-veil');
    if (veil) veil.style.opacity = '0';
    if (this.cineEl) {
      this.cineEl.root.hidden = true;
      this.cineEl.root.classList.remove('cine-title-out');
      this.cineEl = null;
    }
    if (this._shotStub) { g.weaponry.onShot = this._shotStub; this._shotStub = null; }
    g.camera.fov = 78;
    g.camera.updateProjectionMatrix();
  }

  _cineFinish() {
    if (this.phase !== 'cine') return;
    const g = this.game;
    this.phase = 'done';
    g.activeCine = null;
    this._cineCleanup();
    for (const a of g.allies.allies) a.root.visible = true;
    g.missions.report({ type: 'op2-done' });
    g.music.setLevel(0.5, 1.2);
    g._showVictory();
  }
}
