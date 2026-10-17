/* Oyun döngüsü ve durum makinesi.
   Durumlar: loading → menu → playing ⇄ paused → gameover → playing       */

import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Weaponry } from './weaponry.js';
import { EnemyManager } from './enemies.js';
import { Effects } from './effects.js';
import { Grenades } from './grenades.js';
import { Casings } from './casings.js';
import { FPArms } from './fparms.js';
import { DroppedMags } from './droppedmags.js';
import { Rockets } from './rockets.js';
import { MissionBook, MISSIONS } from './missions.js';
import { HEADSHOT_MULT, BODY_MULT, LEG_MULT } from './weapons.js';
import { EnemyGear } from './enemyGear.js';
import { SoldierFactory } from './soldier.js';
import { Shop, YELEKLER, KASKLAR, SILAHLAR } from './shop.js';
import { TankFactory, TANK_TIPLERI } from './tanks.js';
import { TankBattle } from './tankbattle.js';
import { TankPilot } from './tankpilot.js';
import { BOLUMLER, gorevBul } from './chapters.js';
import { TankArena } from './tankarena.js';
import { AllyManager } from './allies.js';
import { Hud } from '../ui/hud.js';
import { Minimap } from '../ui/minimap.js';
import { NameTags } from '../ui/nametags.js';
import { Input } from '../core/input.js';
import { AudioEngine } from '../core/audio.js';
import { Music } from '../core/music.js';
import { Physics } from '../core/physics.js';

const BASE_FOV = 78;
const BEST_KEY = 'celik-hat-best';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'loading';

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.02, 260);
    this.scene.add(this.camera);

    this.hud = new Hud();
    this.audio = new AudioEngine();
    this.music = new Music(this.audio);
    this.input = new Input(canvas);

    this.physics = new Physics();
    this.effects = new Effects(this.scene);
    this.world = new World(this.scene, this.renderer, this.physics).build();
    this.player = new Player(this.camera, this.world);
    this.weaponry = new Weaponry(this.camera, this.audio);
    this.gear = new EnemyGear();
    // İki ayrı karakter modeli: müttefikler SWAT, düşmanlar FSB. Aynı
    // Mixamo iskeletini paylaştıkları için animasyon kodu ikisinde de
    // değişmeden çalışıyor.
    this.shop = new Shop();
    this.shopBolum = 'vest';
    // Tank modu: piyade sistemleri uyur, muharebeyi TankBattle sürer
    this.tanks = new TankFactory();
    this.tankBattle = null;
    this.tankPilot = null;
    this.mod = 'piyade';             // 'piyade' | 'tank'
    this.secilenGorev = null;
    this.tamamlananTank = JSON.parse(localStorage.getItem('celikhat.tank.v1') || '[]');
    this.soldiers = new SoldierFactory();        // müttefikler
    this.enemySoldiers = new SoldierFactory();   // düşmanlar
    this.enemies = new EnemyManager(
      this.scene, this.world, this.effects, this.audio, this.physics,
      this.gear, this.enemySoldiers,
    );
    this.allies = new AllyManager(
      this.scene, this.world, this.effects, this.audio, this.gear, this.soldiers,
    );
    this.minimap = new Minimap(document.getElementById('minimap'));
    this.nametags = new NameTags();
    this.grenades = new Grenades(this.scene, this.physics, this.effects, this.audio);
    this.casings = new Casings(this.scene, this.physics, this.audio);
    this.droppedMags = new DroppedMags(this.scene, this.physics, this.audio);
    this.rockets = new Rockets(this.scene, this.effects, this.audio);
    this.missions = new MissionBook();

    // Oyuncunun fizik temsilcisi: bombalar ve variller ona çarpabilsin.
    this.playerBody = this.physics.addKinematicCapsule(0.4, 1.8);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 260;

    this.score = 0;
    this.kills = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.combo = 0;
    this.comboUntil = 0;
    this.waveClean = true;          // bu dalgada hiç hasar almadık mı
    this.best = Number(localStorage.getItem(BEST_KEY) ?? 0);

    this.clock = new THREE.Clock();
    this._wireEvents();
  }

  /* ── Kurulum ───────────────────────────────────────────────────────── */

  async load() {
    this.hud.screen('loader');
    await this.weaponry.loadAll((p, name) => {
      this.hud.loading(p * 0.8, `${name} yükleniyor…`);
    });

    // Düşmanların taşıdığı silahlar (tek geometriye kaynaştırılır)
    await this.gear.load((p, kind) => {
      this.hud.loading(0.78 + p * 0.1, `Düşman teçhizatı: ${kind}`);
    });

    // Asker modelleri (Mixamo iskeletli; animasyonlar kodda üretiliyor)
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    await this.soldiers.load('assets/characters/swat.glb', () => {
      this.hud.loading(0.90, 'Müttefik askerler');
    }, aniso);
    await this.enemySoldiers.load('assets/characters/fsb.glb', () => {
      this.hud.loading(0.95, 'Düşman askerler');
    }, aniso);

    // Birinci şahıs eller: müttefiklerin SWAT modelinin kolları
    this.weaponry.attachArms(new FPArms(this.soldiers.template, this.soldiers.height));

    // Menüdeki manzara için başlangıç sektörlerini kur.
    this.player.pos.set(0, 0, 10);
    this.camera.position.set(0, 1.7, 10);
    this.camera.rotation.set(0, Math.PI, 0);
    this.world.update(this.camera, this.player.pos, performance.now() / 1000, 12);

    this.hud.loading(1, 'Hazır');
    this.hud.buildWeaponStrip(this.weaponry.slots, this.weaponry.current.def.id);
    this.hud.setActiveWeapon(this.weaponry.current.def);

    this.selectedMission = null;
    this.toHome();
  }

  _wireEvents() {
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
      this.minimap.resize();
    });

    // Ses ve müzik ilk kullanıcı etkileşiminde başlar (tarayıcı kuralı).
    const wakeAudio = () => {
      this.audio.init();
      this.audio.resume();
      if (!this.music.playing) this.music.start();
      this.music.setLevel(this.state === 'playing' ? 0.12 : 0.5, 0.6);
    };
    document.addEventListener('pointerdown', wakeAudio, { once: false });
    document.addEventListener('keydown', wakeAudio, { once: false });

    const on = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
    on('home-missions-btn', () => this.showMissions());
    on('home-chapters-btn', () => this.showChapters());
    on('chapter-back-btn', () => this.toHome());
    on('tankpick-back-btn', () => this.showChapters());
    document.getElementById('chapter-grid')?.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-gorev]');
      if (b && !b.disabled) this.showTankGame(b.dataset.gorev);
    });
    on('tankExit', () => this.hideTankGame());
    document.getElementById('tankpick-grid')?.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tank]');
      if (b) this.startTankMission(this.secilenGorev, b.dataset.tank);
    });
    on('home-shop-btn', () => this.showShop('vest'));
    on('shop-tab-vest', () => this.showShop('vest'));
    on('shop-tab-helm', () => this.showShop('helm'));
    on('shop-tab-weapons', () => this.showShop('weapons'));
    on('shop-back-btn', () => this.toHome());
    document.getElementById('shop-grid')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.shop-btn');
      if (!btn) return;
      if (btn.dataset.eylem === 'al') this.shop.satinAl(btn.dataset.id);
      else this.shop.kus(btn.dataset.id);
      this.showShop(this.shopBolum);
    });
    on('home-free-btn', () => this.start(null));
    on('home-help-btn', () => this.hud.toggleControls());
    // Ses aç/kapat: ana ekranda ve duraklatma menüsünde aynı düğme
    for (const btn of document.querySelectorAll('.sound-btn')) {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleSound(); });
    }
    this._syncSoundButtons();
    on('mission-start-btn', () => this.start(this.selectedMission));
    on('mission-back-btn', () => this.toHome());
    on('resume-btn', () => this.resume());
    on('retry-btn', () => this.start(this.selectedMission));
    on('menu-btn', () => this.toHome());
    on('go-home-btn', () => this.toHome());
    on('vic-home-btn', () => this.toHome());
    on('vic-retry-btn', () => this.start(this.selectedMission));
    on('vic-next-btn', () => this.start(this._nextMissionId()));

    // Serbest bakış modunda Esc duraklatır (kilit olayı gelmez).
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state === 'playing') this.pause();
      if (this.mod === 'tank' && this.state === 'playing') {
        if (e.code === 'KeyV') this.tankPilot?.modDegistir();
        if (e.code === 'KeyE') this.tankBattle?.ikmalYap();
      }
    });

    this.input.on('unlock', () => {
      if (this.state === 'playing') this.pause();
    });

    this.input.on('key', (code) => {
      if (this.state !== 'playing') return;
      if (code === 'KeyR') this.weaponry.startReload();
      if (code === 'KeyQ') this.weaponry.swapPrevious();
      if (code === 'KeyG') this._throwGrenade();
      if (code === 'KeyM') this._toggleSound();
      if (code.startsWith('Digit')) {
        const n = Number(code.slice(5));
        if (n >= 1 && n <= 9) this.weaponry.equipSlot(n);
      }
    });

    this.input.on('wheel', (d) => {
      if (this.state === 'playing') this.weaponry.cycle(d > 0 ? 1 : -1);
    });

    this.weaponry.onEvent = (name, slot) => {
      if (name === 'equip') this.hud.setActiveWeapon(slot.def);
      if (name === 'drop') this._dropMag(slot);        // yük: { pivot, heavy }
      if (name === 'eject') this._ejectCasing(slot);
    };
    this.rockets.onExplode = (ev) => this._onRocketExplosion(ev);
    this.weaponry.onShot = (shot) => this._resolveShot(shot);

    this.enemies.allies = this.allies.allies;
    this.enemies.onAllyHit = (ally, damage) => {
      const dusdu = ally.hurt(damage);
      if (dusdu) {
        ally.reviveAt = performance.now() / 1000 + 15;
        this.hud.feed('Müttefik yaralandı — 15 sn', true);
      }
    };
    this.enemies.onKill = (enemy) => this._onKill(enemy);
    this.enemies.onPlayerHit = (dmg, bolge) => this._onPlayerHit(dmg, bolge);
    this.enemies.onWaveStart = (wave, total) => {
      this.waveClean = true;
      this.hud.feed(`DALGA ${wave} — ${total} hedef`, true);
      this.hud.setWave(wave, total, total);
    };

    this.grenades.onExplode = (ev) => this._onExplosion(ev);

    // Müttefik ateşi: oyuncununkiyle aynı bölge çarpanları, biraz düşük hasar
    this.allies.onEnemyHit = (enemy, part, point) => {
      if (!enemy.alive) return;
      const mult = part === 'head' ? HEADSHOT_MULT : part === 'leg' ? LEG_MULT : BODY_MULT;
      const dead = enemy.hurt(22 * mult);
      if (dead) {
        enemy._killedBy = { ally: true };
        this.enemies.kill(enemy, performance.now() / 1000,
          enemy.center.clone().sub(point).setY(0).normalize());
        this.hud.feed(`Müttefik: ${enemy.def.name} düştü`);
      }
    };

    this.missions.onComplete = (m) => {
      this.hud.feed(`GÖREV TAMAM — ${m.name}`, true);
      this.score += 500;
      this.hud.setScore(this.score);
    };
  }

  _toggleSound() {
    const muted = this.audio.toggleMuted();
    if (!muted) {
      this.audio.init();
      this.audio.resume();
      if (!this.music.playing) this.music.start();
    }
    this._syncSoundButtons();
    if (this.state === 'playing') this.hud.feed(muted ? 'SES KAPALI' : 'SES AÇIK', true);
  }

  _syncSoundButtons() {
    const muted = this.audio.muted;
    for (const btn of document.querySelectorAll('.sound-btn')) {
      btn.textContent = muted ? 'Ses: Kapalı' : 'Ses: Açık';
      btn.setAttribute('aria-pressed', String(muted));
    }
  }

  /* ── Durum geçişleri ───────────────────────────────────────────────── */

  start(missionId = null) {
    this._kaskKalkaniKullanildi = false;
    this.player.setGear(this.shop.etkiler());
    this.selectedMission = missionId;
    this.missions.focus(missionId);
    this.audio.init();
    this.audio.resume();
    if (!this.music.playing) this.music.start();
    this.music.setLevel(0.12, 1.5);

    this.score = 0;
    this.kills = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.combo = 0;
    this.waveClean = true;

    this.player.reset();
    this.weaponry.resetAmmo();
    this.weaponry.equip('ak47');
    this.enemies.reset();
    this.allies.spawn(3, this.player.pos);
    this.enemies.allies = this.allies.allies;
    this.nametags.rebuild(this.allies.allies);
    this.grenades.reset(3);
    this.casings.reset();
    this.droppedMags.reset();
    this.rockets.reset();
    this.missions.resetRun();

    this.state = 'playing';
    this.nametags.setVisible(true);
    this.hud.screen(null);
    this.hud.setScore(0);
    this.hud.setHealth(this.player.health, this.player.maxHealth);
    this.hud.setGrenades(this.grenades.count);
    this.hud.setMission(this.missions.active, this.missions);
    this.input.requestLock();
    this.clock.getDelta();
    this.enemies.startWave(1);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.releaseLock();
    this.music.setLevel(0.5, 0.5);
    this.hud.pauseStats({ wave: this.enemies.wave, score: this.score, kills: this.kills });
    this.nametags.setVisible(false);
    this.hud.screen('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.music.setLevel(0.12, 0.8);
    this.nametags.setVisible(true);
    this.hud.screen(null);
    this.input.requestLock();
    this.clock.getDelta();
    this.audio.resume();
  }

  toHome() {
    this.state = 'home';
    this.input.releaseLock();
    this.music.setLevel(0.5, 0.8);
    this.hud.buildHome({
      best: this.best,
      missionsDone: this.missions.completedCount,
      missionsTotal: MISSIONS.length,
      weapons: this.weaponry.slots.map((s) => s.def),
    });
    this.nametags.setVisible(false);
    this.hud.screen('home');
  }

  showMissions() {
    this.state = 'missions';
    this.input.releaseLock();
    this.hud.buildMissionCards(MISSIONS, this.missions, this.selectedMission, (m) => {
      this.selectedMission = m.id;
      this.hud.buildMissionCards(MISSIONS, this.missions, this.selectedMission, (x) => {
        this.selectedMission = x.id;
        this.showMissions();
      });
    });
    this.nametags.setVisible(false);
    this.hud.screen('missionsScreen');
  }

  /** Seçili görevden sonraki tamamlanmamış görev. */
  _nextMissionId() {
    const i = MISSIONS.findIndex((m) => m.id === this.selectedMission);
    for (let k = 1; k <= MISSIONS.length; k++) {
      const m = MISSIONS[(i + k + MISSIONS.length) % MISSIONS.length];
      if (!this.missions.completed.has(m.id)) return m.id;
    }
    return null;
  }

  /** Seçili görev tamamlandıysa turu bitir. */
  _checkMissionEnd() {
    if (this.state !== 'playing') return false;
    if (!this.selectedMission) return false;              // serbest hat: sonsuz
    if (!this.missions.completed.has(this.selectedMission)) return false;
    this.missionComplete();
    return true;
  }

  missionComplete() {
    this.state = 'victory';
    this.input.releaseLock();
    this.music.setLevel(0.5, 1.2);
    this.audio.waveStart();

    const mission = MISSIONS.find((m) => m.id === this.selectedMission) ?? null;
    const accuracy = this.shotsFired ? this.shotsHit / this.shotsFired : 0;

    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.score));
    }

    this.hud.victoryStats({
      mission,
      wave: this.enemies.wave,
      score: this.score,
      kills: this.kills,
      accuracy,
      hasNext: Boolean(this._nextMissionId()),
    });
    this.shop.puanEkle(this.score);
    this.nametags.setVisible(false);
    this.hud.screen('victory');
  }

  gameOver() {
    this.state = 'gameover';
    this.shop.puanEkle(this.score);
    this.input.releaseLock();
    this.audio.gameOver();
    this.music.setLevel(0.5, 2);

    const accuracy = this.shotsFired ? this.shotsHit / this.shotsFired : 0;
    this.hud.gameOverStats({
      wave: this.enemies.wave,
      score: this.score,
      kills: this.kills,
      accuracy,
      best: this.best,
      missions: this.missions.completedCount,
    });
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.score));
    }
    this.nametags.setVisible(false);
    this.hud.screen('gameover');
  }

  /* ── Ateş çözümü ───────────────────────────────────────────────────── */

  /** Boş şarjör/kutu/bant ucu: oyuncunun hızıyla yere bırakılır. */
  _dropMag({ pivot, heavy }) {
    const camQ = this.camera.getWorldQuaternion(new THREE.Quaternion());
    const v = new THREE.Vector3(this.player.vel.x, -0.6, this.player.vel.z)
      .add(new THREE.Vector3(-0.25, 0, -0.35).applyQuaternion(camQ).setY(0));
    this.droppedMags.drop(pivot, v, performance.now() / 1000, heavy);
  }

  /** Boş kovan: silahın sağ yanından fırlar, yerde seker. */
  _ejectCasing(slot) {
    const camQuat = this.camera.getWorldQuaternion(new THREE.Quaternion());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camQuat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camQuat);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
    const origin = slot.holder.localToWorld(slot.muzzle.clone());
    this.casings.eject(
      origin.addScaledVector(fwd, -0.25 - slot.def.view.length * 0.35).addScaledVector(up, 0.02),
      right, up, performance.now() / 1000,
    );
  }

  /** Roket: patlama alanı + oyuncu (geri tepme alanında da yanar). */
  _fireRocket(slot, dir, weapon) {
    const pivot = slot.parts.mag?.pivot;
    if (!pivot) return;
    const origin = pivot.getWorldPosition(new THREE.Vector3());
    // Yakınsama: roket namludan (nişangâhın 20 cm altından) çıkıyor;
    // nişangâhın gösterdiği noktaya yöneltilmezse hedefin altından geçiyor
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    this.raycaster.set(camPos, dir);
    const aimHit = this.raycaster.intersectObjects([...this.enemies.hitTargets, ...this.world.solids], false)[0];
    const aimPoint = aimHit ? aimHit.point : camPos.clone().addScaledVector(dir, 120);
    const rdir = aimPoint.clone().sub(origin).normalize();
    this.rockets.fire(pivot, origin, rdir, weapon);

    // Geri tepme (backblast): tüpün arkasından toz ve duman bulutu
    const camQ = this.camera.getWorldQuaternion(new THREE.Quaternion());
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camQ);
    const rear = this.camera.getWorldPosition(new THREE.Vector3())
      .addScaledVector(back, 0.9).add(new THREE.Vector3(0.15, -0.15, 0).applyQuaternion(camQ));
    for (let i = 0; i < 16; i++) {
      const v = back.clone().multiplyScalar(4 + Math.random() * 6)
        .add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(3));
      this.effects.puff(rear, v, i % 3 ? 0x8d8577 : 0xffb060, 0.3 + Math.random() * 0.3, 1.2 + Math.random(), 0.4, 1.5);
    }
    this.player.shake(0.8);
    this.player.addRecoil(weapon.recoil, 0);
  }

  _onRocketExplosion({ center, radius, maxDamage, object }) {
    const now = performance.now() / 1000;
    this.physics.explosion(center, radius * 1.4, 34);
    if (object) this.world.hitProp(object, new THREE.Vector3(0, 1, 0), center, 30);
    const d = this.player.eyePosition.distanceTo(center);
    this.player.shake(Math.max(0.3, 1.6 - d / 10));
    const killed = this.enemies.damageArea(center, radius, maxDamage, now, { rocket: true, weaponId: 'bazuka' });
    if (killed.length) this.shotsHit++;
    if (d < radius) {
      const k = 1 - d / radius;
      this._onPlayerHit(maxDamage * k * k * 0.45);
    }
  }

  _resolveShot({ origin, dir, weapon, slot, noEject }) {
    this.shotsFired++;

    if (weapon.rocket) {
      this._fireRocket(slot, dir, weapon);
      return;
    }

    // Boş kovan (sürgülü tüfekte sürgü çekilince çıkar)
    if (!noEject) {
      const camQuat = this.camera.getWorldQuaternion(new THREE.Quaternion());
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camQuat);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camQuat);
      this.casings.eject(
        origin.clone().addScaledVector(dir, -0.25).addScaledVector(up, 0.02),
        right, up, performance.now() / 1000,
      );
    }
    this.player.addRecoil(weapon.recoil, (Math.random() - 0.5) * weapon.recoil * 0.4);
    this.player.shake(Math.min(0.35, weapon.recoil * 0.05));
    this.effects.muzzleSmoke(origin, dir);

    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    this.raycaster.set(camPos, dir);

    const targets = [...this.enemies.hitTargets, ...this.world.solids];
    const hit = this.raycaster.intersectObjects(targets, false)[0];

    const end = hit ? hit.point.clone() : camPos.clone().addScaledVector(dir, 180);
    this.effects.tracer(origin, end, weapon.tracer);

    if (!hit) return;

    const data = hit.object.userData;
    if (data?.enemy) {
      const enemy = data.enemy;
      if (!enemy.alive) return;

      const part = data.part;
      const head = part === 'head';
      const leg = part === 'leg';
      this.shotsHit++;

      // Bölgeye göre hasar: kafa > gövde > bacak
      const mult = head ? HEADSHOT_MULT : leg ? LEG_MULT : BODY_MULT;
      const dead = enemy.hurt(weapon.damage * mult);
      this.effects.hitBurst(
        hit.point,
        head ? 0xffd27a : leg ? 0x9aa0a4 : enemy.def.eye,
        head ? 20 : leg ? 7 : 11,
      );
      this.audio.hit(head);
      this.hud.hitmarker(dead);

      if (dead) {
        enemy._killedBy = { weaponId: weapon.id, headshot: head };
        this.enemies.kill(enemy, performance.now() / 1000, dir);
      }
    } else {
      const n = hit.face
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        : new THREE.Vector3(0, 1, 0);
      this.effects.sparks(hit.point, n, 0xffc06a, 9);
      this.audio.impact();

      // Devrilebilen eşyaysa mermi onu savurur; sabit yüzeyse iz bırakır.
      const pushed = this.world.hitProp(hit.object, dir, hit.point, weapon.damage * 0.22);
      if (!pushed) this.effects.decal(hit.point, n);
    }
  }

  _throwGrenade() {
    const vel = new THREE.Vector3(this.player.vel.x, 0, this.player.vel.z);
    if (this.grenades.throwFrom(this.camera, performance.now() / 1000, vel)) {
      this.hud.setGrenades(this.grenades.count);
    }
  }

  _onExplosion({ center, radius, maxDamage }) {
    const now = performance.now() / 1000;
    this.player.shake(1);

    this.enemies.damageArea(center, radius, maxDamage, now, { grenade: true });

    // Oyuncu da kendi bombasından etkilenir.
    const d = this.player.eyePosition.distanceTo(center);
    if (d < radius) {
      const k = 1 - d / radius;
      this._onPlayerHit(maxDamage * k * k * 0.5);
    }
  }

  _onKill(enemy) {
    const now = performance.now() / 1000;
    this.kills++;

    this.combo = now < this.comboUntil ? this.combo + 1 : 1;
    this.comboUntil = now + 3;
    const mult = 1 + Math.min(2, (this.combo - 1) * 0.15);

    const by = enemy._killedBy ?? {};
    this.score += Math.round(enemy.scoreValue * mult * (by.headshot ? 1.5 : 1));
    this.hud.setScore(this.score);
    this.hud.setCombo(this.combo, mult);
    this.hud.feed(
      `${enemy.def.name} ${by.headshot ? '— KAFA' : by.grenade ? '— BOMBA' : 'düştü'}`,
      Boolean(by.headshot),
    );

    this.missions.report({
      type: 'kill',
      weaponId: by.weaponId,
      headshot: Boolean(by.headshot),
      grenade: Boolean(by.grenade),
      enemyType: enemy.type,
    });
    this.hud.setMission(this.missions.active, this.missions);
    this._checkMissionEnd();
  }

  _onPlayerHit(damage, bolge = 'body') {
    if (this.state !== 'playing') return;
    if (typeof bolge !== 'string') bolge = 'body';

    // Teçhizat: yelek gövdeyi, kask kafayı azaltır. Ham hasar büyükse
    // "keskin nişancı", küçükse "seri atış" sayılır (shop.js).
    let gelen = this.shop.hasarAzalt(damage, bolge);

    // Keskin Nişancı Kaskı: turda bir kez ölümcül kafa isabetini karşılar
    if (bolge === 'head' && this.shop.etkiler().ilkIsabetiKarsila
        && !this._kaskKalkaniKullanildi && gelen >= this.player.health) {
      this._kaskKalkaniKullanildi = true;
      gelen = Math.max(0, this.player.health - 1);
      this.hud.feed('KASK ÖLÜMCÜL İSABETİ KARŞILADI', true);
    }

    this.player.damage(gelen);
    this.waveClean = false;
    this.hud.damageFlash();
    this.hud.setHealth(this.player.health, this.player.maxHealth);
    this.audio.playerHurt();
    if (!this.player.alive) this.gameOver();
  }

  /* ── Mağaza ────────────────────────────────────────────────────────── */

  showShop(bolum = this.shopBolum) {
    this.shopBolum = bolum;
    this.state = 'home';
    this.shop.yukle();      // tank bölümünün kazandırdığı kredi görünsün
    const urunler = bolum === 'vest' ? YELEKLER : bolum === 'helm' ? KASKLAR : SILAHLAR;
    this.hud.buildShop(bolum, urunler, {
      kredi: this.shop.kredi,
      sahipMi: (id) => this.shop.sahipMi(id),
      takili: bolum === 'vest' ? this.shop.yelek.id : bolum === 'helm' ? this.shop.kask.id : null,
    });
    this.hud.screen('shopScreen');
  }

  /* ── Bölümler ve tank görevleri ────────────────────────────────────── */

  showChapters() {
    this.state = 'home';
    this.input.releaseLock();
    this.hud.buildChapters(BOLUMLER[0], { tamamlanan: this.tamamlananTank });
    this.hud.screen('chapterScreen');
  }

  /* Zırhlı görev: Death Star tam ekran çerçevede açılır. Ayrı bir sayfa
     olarak duruyor (kendi motoru, kendi arayüzü); bölüm ekranı onu
     çerçeveye yükleyip üstüne bir "geri dön" düğmesi koyuyor. */
  showTankGame(gorevId) {
    const kare = document.getElementById('tankFrame');
    const cerceve = document.getElementById('tankIframe');
    if (!kare || !cerceve) return;
    this.secilenGorev = gorevId;
    this.input.releaseLock();
    this.music.setLevel(0, 0.4);
    // `v` damgası: tarayıcı çerçevede eski kopyayı tutmasın
    cerceve.src = `tankgame/index.html?gorev=${encodeURIComponent(gorevId)}&v=${Date.now()}`;
    kare.hidden = false;
    this.hud.screen(null);
    this.state = 'home';
    document.body.classList.add('tank-mode');
  }

  hideTankGame() {
    const kare = document.getElementById('tankFrame');
    const cerceve = document.getElementById('tankIframe');
    if (kare) kare.hidden = true;
    if (cerceve) cerceve.src = 'about:blank';     // oyunu durdur
    document.body.classList.remove('tank-mode');
    this.music.setLevel(0.5, 0.8);
    this.showChapters();
  }

  showTankPick(gorevId) {
    const bulunan = gorevBul(gorevId);
    if (!bulunan) return;
    this.secilenGorev = bulunan.gorev;
    this.hud.buildTankPick(bulunan.gorev, Object.values(TANK_TIPLERI));
    this.hud.screen('tankPickScreen');
  }

  async startTankMission(gorev, tankId) {
    if (!gorev) return;
    // Tank modelleri ilk görevde yüklenir (5 MB; ana menüyü bekletmiyoruz)
    if (!this.tanks.modeller[tankId]) {
      this.hud.screen('loader');
      this.hud.loading(0.1, 'Tanklar yükleniyor');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      await this.tanks.load(GLTFLoader, (p, ad) => this.hud.loading(0.1 + p * 0.7, ad),
        this.renderer.capabilities.getMaxAnisotropy());
      this.hud.loading(0.85, 'Arazi');
      this.tankArena ??= new TankArena(this.scene);
      await this.tankArena.yukle(GLTFLoader);
      this.hud.loading(1, 'Hazır');
    }
    this.tankArena ??= new TankArena(this.scene);
    this.tankArena.kur();

    if (!this.tankBattle) {
      this.tankBattle = new TankBattle(this.scene, this.world, this.effects,
        this.audio, this.tanks, this.tankArena);
      this.tankPilot = new TankPilot(this.camera, this.input, this.tankBattle);
      this.tankBattle.onKill = () => {
        this.score += 350;
        this.hud.setScore(this.score);
        this.hud.feed(`DÜŞMAN TANKI İMHA — ${this.tankBattle.oldurme}/${gorev.dusman}`, true);
        this._tankHedefGuncelle();
      };
      this.tankBattle.onIkmal = (sayi) => {
        this.hud.feed(`YAKIT İKMALİ TAMAM (${sayi})`, true);
        this._tankHedefGuncelle();
      };
      this.tankBattle.onPlayerHit = () => {
        this.hud.damageFlash();
      };
      this.tankBattle.onBitis = (sonuc) => this._tankGorevBitti(sonuc);
    }

    // Piyade sistemlerini ve ŞEHİR haritasını uyut: tank savaşı açık
    // arazide geçiyor, iki dünya üst üste binmemeli.
    this.enemies.reset();
    this.allies.clear();
    this.world.setVisible?.(false);
    this.nametags.setVisible(false);
    this.weaponry.rig.visible = false;

    this.mod = 'tank';
    this.secilenGorev = gorev;
    this.oyuncuTankId = tankId;
    const tank = this.tankBattle.kur(gorev, tankId);
    this.tankPilot.bagla(tank);
    this.player.pos.copy(tank.pos);

    this.score = 0;
    this.kills = 0;
    this.state = 'playing';
    this.hud.screen(null);
    this.hud.setScore(0);
    this._tankHedefGuncelle();
    this.input.requestLock();
    if (!this.music.playing) this.music.start();
    this.music.setLevel(0.12, 0.6);
  }

  _tankHedefGuncelle() {
    const b = this.tankBattle, g = this.secilenGorev;
    if (!b || !g) return;
    const imha = `${b.oldurme}/${g.dusman} tank`;
    const ikmal = `${b.ikmalSayisi}/${g.ikmalHedefi} ikmal`;
    this.hud.setTankMission?.(g.ad, imha, ikmal);
  }

  _tankGorevBitti(sonuc) {
    this.state = sonuc === 'zafer' ? 'victory' : 'gameover';
    this.input.releaseLock();
    this.mod = 'piyade';
    this.tankArena?.temizle();
    this.world.setVisible?.(true);
    if (sonuc === 'zafer') {
      if (!this.tamamlananTank.includes(this.secilenGorev.id)) {
        this.tamamlananTank.push(this.secilenGorev.id);
        localStorage.setItem('celikhat.tank.v1', JSON.stringify(this.tamamlananTank));
      }
      this.shop.puanEkle(this.score);
      this.hud.victoryStats({
        mission: `${this.secilenGorev.ad} — zırhlı görev`,
        score: this.score,
        kills: this.tankBattle.oldurme,
        accuracy: 1,
        hasNext: false,
      });
      this.hud.screen('victory');
      this.audio.waveStart();
    } else {
      this.shop.puanEkle(this.score);
      this.hud.gameOverStats({
        wave: 1, score: this.score, kills: this.tankBattle.oldurme,
        accuracy: 0, best: this.best, missions: this.missions.completedCount,
      });
      this.hud.screen('gameover');
      this.audio.gameOver();
    }
  }

  _tankStep(dt, now) {
    const b = this.tankBattle, pilot = this.tankPilot;
    if (!b || !pilot) return;

    const look = this.input.consumeLook();
    pilot.bak(look.dx, look.dy);

    const girdi = {
      forward: (this.input.down('KeyW') ? 1 : 0) - (this.input.down('KeyS') ? 1 : 0),
      right: (this.input.down('KeyD') ? 1 : 0) - (this.input.down('KeyA') ? 1 : 0),
      sprint: this.input.down('ShiftLeft') || this.input.down('ShiftRight'),
    };
    pilot.nisanAl(this.input.down('KeyZ'));
    if (this.input.mouse(0)) pilot.atesEt(now);

    const durum = pilot.update(dt, now, girdi);
    b.update(dt, now);

    // Dünya akışı tankın konumuna göre
    this.player.pos.copy(b.oyuncu.pos);
    this.tankArena?.nabiz(now);

    const t = b.oyuncu;
    this.hud.setTankDurum?.({
      can: t.hp, maxCan: t.maxHp,
      yakit: t.yakit, maxYakit: t.maxYakit,
      mod: t.mod, dolum: t.dolumOrani, mgSarjor: t.mgSarjor,
      nisan: pilot.nisan, ikmalYakin: durum.ikmalYakin, yakitBitti: durum.yakitBitti,
    });
  }

  /* ── Döngü ─────────────────────────────────────────────────────────── */

  frame() {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    const now = performance.now() / 1000;

    if (this.state === 'playing') {
      if (this.mod === 'tank') this._tankStep(dt, now);
      else this._step(dt, now);
    } else {
      this.world.update(this.camera, this.player.pos, now, 1);
    }

    this.effects.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _step(dt, now) {
    const look = this.input.consumeLook();
    this.player.look(look.dx, look.dy);

    const ads = this.input.mouse(2);
    const moveInput = {
      forward: (this.input.down('KeyW') ? 1 : 0) - (this.input.down('KeyS') ? 1 : 0),
      right: (this.input.down('KeyD') ? 1 : 0) - (this.input.down('KeyA') ? 1 : 0),
      jump: this.input.down('Space'),
      sprint: this.input.down('ShiftLeft') || this.input.down('ShiftRight'),
      crouch: this.input.down('ControlLeft') || this.input.down('KeyC'),
    };

    this.player.update(dt, moveInput, ads, this.weaponry.current.def.weight ?? 0);
    this.physics.moveKinematic(
      this.playerBody, this.player.pos.x, this.player.pos.y + 0.9, this.player.pos.z,
    );

    // Dünya akışı: görüş alanına giren sektörler kurulur, çıkanlar sökülür.
    this.world.update(this.camera, this.player.pos, now);

    const def = this.weaponry.current.def;
    const firing = this.input.mouse(0);
    if (firing) {
      if (def.auto) this.weaponry.tryFire(now);
      else if (!this._triggerHeld) this.weaponry.tryFire(now);
      this._triggerHeld = true;
    } else {
      this._triggerHeld = false;
    }

    if (this.weaponry.current.ammo === 0 && !this.weaponry.reloading) {
      this.weaponry.startReload();
    }

    this.weaponry.update({
      dt, now, look, ads, firing,
      moving: moveInput.forward !== 0 || moveInput.right !== 0,
      sprinting: this.player.sprinting,
    });

    const zoom = THREE.MathUtils.lerp(1, def.zoom, this.weaponry.adsBlend);
    const targetFov = BASE_FOV / zoom;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 14));
      this.camera.updateProjectionMatrix();
    }

    this.physics.step(dt);
    this.grenades.update(dt, now);
    this.casings.update(now);
    this.droppedMags.update(now);
    this.rockets.update(dt, this.world.solids, this.enemies.hitTargets, this.enemies.enemies);
    this.enemies.update(dt, now, this.player);
    this.allies.update(dt, now, this.player, this.enemies.enemies);

    // Dalga geçişi
    if (this.enemies.state === 'break' && now > this.enemies.breakEnd) {
      this.missions.report({ type: 'wave-clear', wave: this.enemies.wave, noDamage: this.waveClean });
      this.hud.setMission(this.missions.active, this.missions);

      // Görev hedefi dalga sayısıysa burada biter — yeni dalga başlamaz.
      if (this._checkMissionEnd()) return;

      this.weaponry.resupply(0.3);
      this.grenades.resupply(2);
      this.player.heal(25);
      this.hud.setGrenades(this.grenades.count);
      this.hud.feed('İKMAL — cephane, bomba ve sağlık', true);
      this.enemies.startWave(this.enemies.wave + 1);
    }

    this._updateHud(now);
  }

  _updateHud(now) {
    const s = this.weaponry.current;
    this.hud.setAmmo(s.ammo, s.def.mag, s.reserve);
    this.hud.setHealth(this.player.health, this.player.maxHealth);
    this.hud.setStamina(this.player.stamina, this.player.exhausted);
    this.hud.setSectors(this.world.sectors.size, this.world.grid ** 2);
    this.hud.setWave(this.enemies.wave, this.enemies.remaining, this.enemies.waveTotal ?? 1);

    if (this.weaponry.reloading) {
      const t = (now - this.weaponry.reloadStart) / (this.weaponry.reloadEnd - this.weaponry.reloadStart);
      this.hud.setReload(THREE.MathUtils.clamp(t, 0, 1));
    } else {
      this.hud.setReload(null);
    }

    const scoped = this.weaponry.scoped;
    this.hud.setScope(scoped);
    this.hud.setCrosshair(
      THREE.MathUtils.clamp(this.weaponry.spreadDeg / 3.5, 0.08, 1),
      scoped,
    );

    // Müttefik isim etiketleri: dünya konumunu ekrana yansıt
    this.nametags.update(this.allies.allies, this.camera, (worldPos) => {
      const v = worldPos.clone().project(this.camera);
      return {
        x: (v.x * 0.5 + 0.5) * innerWidth,
        y: (-v.y * 0.5 + 0.5) * innerHeight,
        visible: v.z < 1,
      };
    });

    this.minimap.draw(now, {
      player: this.player,
      enemies: this.enemies.enemies,
      world: this.world,
      grenades: this.grenades.live,
    });

    if (now > this.comboUntil && this.combo > 0) {
      this.combo = 0;
      this.hud.setCombo(0, 1);
    }
  }
}
