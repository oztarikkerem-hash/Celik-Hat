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
import { WEAPONS, HEADSHOT_MULT, BODY_MULT, LEG_MULT } from './weapons.js';
import { EnemyGear } from './enemyGear.js';
import { SoldierFactory } from './soldier.js';
import { Shop, YELEKLER, KASKLAR, SILAHLAR, SAGLIK } from './shop.js';
import { TankFactory, TANK_TIPLERI } from './tanks.js';
import { TankBattle } from './tankbattle.js';
import { TankPilot } from './tankpilot.js';
import { BOLUMLER, gorevBul } from './chapters.js';
import { TankArena } from './tankarena.js';
import { AllyManager } from './allies.js';
import { Raid, RAID, M2_DEF, NEST } from './raid.js';
import { MAPS, mapById } from './maps.js';
import { Vehicles } from './vehicle.js';
import { Intro } from './intro.js';
import { Outro } from './outro.js';
import { Hud } from '../ui/hud.js';
import { Minimap } from '../ui/minimap.js';
import { NameTags } from '../ui/nametags.js';
import { AmmoCrates } from './ammocrate.js';
import { Achievements } from './achievements.js';
import { Weekly } from './weekly.js';
import { Input } from '../core/input.js';
import { AudioEngine } from '../core/audio.js';
import { Music } from '../core/music.js';
import { Physics } from '../core/physics.js';

const BASE_FOV = 78;
const BEST_KEY = 'celik-hat-best';
const RAID_PICK_KEY = 'celikhat.baskin.silahlar';
const MAP_KEY = 'celikhat.alan';
const PICK4_KEY = 'celikhat.silahlar4';
const PICK_COUNT = 4;              // normal görevlere bu kadar silahla girilir
const BINOC_ZOOM = 8;
const FINALE_TIME = 7;           // ufuktaki birlik belirdikten sonra tahliye sinematiği
// Ağır yaralı: kalbin çevresindeki çember hasar almadan bu sürede dolar
const REVIVE_TIME = 10;
const DOWNED_HITS = 1;           // yerdeyken TEK isabet ölümdür
const WOUND_CAP = 25;            // ayağa kalkınca can bu sınırda kalır
const TREAT = {
  sargi: { sure: 2.5, ad: 'Sargı bezi' },
  kit: { sure: 4, ad: 'İlk yardım kiti' },
};

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
    this.weekly = new Weekly(this.shop);     // haftalık giriş ödülleri
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
    this.raid = new Raid(this);
    this.crates = new AmmoCrates(this);
    // Başarım ödülü o anki tura puan olarak eklenir
    this.achv = new Achievements((id, def) => {
      if (def.odul) {
        this.score += def.odul;
        this.hud.setScore(this.score);
      }
      this.hud.achievement(def);
      this.audio.achievement();
    });
    this.vehicles = new Vehicles(this);
    this.intro = new Intro(this);
    this.outro = new Outro(this);
    this.activeCine = null;           // oynayan sinematik (giriş ya da tahliye)
    this.mapId = mapById(localStorage.getItem(MAP_KEY)).id;
    this.binoc = false;
    this._binocRead = 0;
    let pick = [];
    try { pick = JSON.parse(localStorage.getItem(RAID_PICK_KEY) || '[]'); } catch { pick = []; }
    this.raidPick = new Set(Array.isArray(pick) ? pick.slice(0, 2) : []);
    let pick4 = [];
    try { pick4 = JSON.parse(localStorage.getItem(PICK4_KEY) || '[]'); } catch { pick4 = []; }
    this.pick4 = new Set(Array.isArray(pick4) ? pick4.slice(0, PICK_COUNT) : []);

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

  /**
   * Açılış: ana ekran HEMEN gelir (yalnızca kodla kurulan arazi beklenir);
   * silah ve asker modelleri (~45 MB) arka planda iner. Görev başlatılırken
   * henüz inmemişlerse yükleme çubuğu orada gösterilir (`ensureAssets`).
   * Eskiden menü bütün modeller inene kadar açılmıyordu.
   */
  async load() {
    // Son seçilen alan menüdeki manzarada da görünsün
    this.world.setTheme(mapById(this.mapId));
    // Menüdeki manzara için başlangıç sektörlerini kur.
    this.player.pos.set(0, 0, 10);
    this.camera.position.set(0, 1.7, 10);
    this.camera.rotation.set(0, Math.PI, 0);
    this.world.update(this.camera, this.player.pos, performance.now() / 1000, 12);
    this.selectedMission = null;
    this.toHome();
    this._assets = this._loadAssets();
    this._assets.catch((err) => console.error('Varlıklar yüklenemedi', err));
  }

  /** Görev başlamadan önce: modeller inmediyse yükleme ekranında bekle. */
  async ensureAssets() {
    if (this.assetsReady) return;
    this.hud.screen('loader');
    this.hud.loading(this._loadPay ?? 0, 'Modeller iniyor');
    await this._assets;
  }

  async _loadAssets() {
    // Bütün varlıklar AYNI ANDA iner: silahlar, düşman teçhizatı ve iki
    // asker modeli. Sırayla beklenince her dosyanın gecikmesi üst üste
    // biniyor, açılış uzuyordu. Çubuk, inen parçaların ağırlıklı toplamı.
    const pay = { w: 0, g: 0, s: 0, e: 0 };
    const goster = (label) => {
      this._loadPay = pay.w * 0.55 + pay.g * 0.05 + pay.s * 0.2 + pay.e * 0.2;
      this.hud.loading(this._loadPay, label);
    };
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    await Promise.all([
      this.weaponry.loadAll((p, name) => { pay.w = p; goster(`${name} yüklendi`); }),
      // Düşmanların taşıdığı silahlar (tek geometriye kaynaştırılır)
      this.gear.load((p, kind) => { pay.g = p; goster(`Düşman teçhizatı: ${kind}`); }),
      // Asker modelleri (Mixamo iskeletli)
      this.soldiers.load('assets/characters/swat.glb', () => {
        pay.s = 1; goster('Müttefik askerler');
      }, aniso),
      this.enemySoldiers.load('assets/characters/fsb.glb', () => {
        pay.e = 1; goster('Düşman askerler');
      }, aniso),
      // Zırhlı araç: dosya yoksa oyun araçsız açılır
      this.vehicles.load(),
    ]);

    // Birinci şahıs eller: müttefiklerin SWAT modelinin kolları
    this.weaponry.attachArms(new FPArms(this.soldiers.template, this.soldiers.height));

    this.hud.loading(1, 'Hazır');
    this.hud.buildWeaponStrip(this.weaponry.slots, this.weaponry.current.def.id);
    this.hud.setActiveWeapon(this.weaponry.current.def);
    this.assetsReady = true;
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
    on('shop-tab-health', () => this.showShop('health'));
    on('shop-back-btn', () => this.toHome());
    document.getElementById('shop-grid')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.shop-btn');
      if (!btn) return;
      if (btn.dataset.eylem === 'al') this.shop.satinAl(btn.dataset.id);
      else this.shop.kus(btn.dataset.id);
      this.showShop(this.shopBolum);
    });
 document.getElementById('top-choice')?.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-auto]');
      if (b) this._setAutoDrive(b.dataset.auto === '1');
    });
    on('cine-skip', () => { if (this.state === 'cinematic') this.activeCine?.skip(); });
    on('home-free-btn', () => this.startMission(null));
    on('home-help-btn', () => this.hud.toggleControls());
    on('weekly-claim', () => {
      const puan = this.weekly.al();
      if (!puan) return;
      this.audio.init();
      this.audio.achievement();
      this._drawWeekly(puan);
    });
    on('home-licenses-btn', () => this.hud.screen('licensesScreen'));
    on('licenses-back-btn', () => this.toHome());
    // Ses aç/kapat: ana ekranda ve duraklatma menüsünde aynı düğme
    for (const btn of document.querySelectorAll('.sound-btn')) {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleSound(); });
    }
    this._syncSoundButtons();
    on('mission-start-btn', () => this.startMission(this.selectedMission));
    on('mappick-back-btn', () => (this._mapBack ?? (() => this.toHome()))());
    on('mission-back-btn', () => this.toHome());
    // Silah seçimi tamam → alan seçimi → görev
    on('raid-start-btn', () => {
      const m = this._loadoutFor;
      if (m === 'baskin') this._askMap('baskin', () => this.startRaid([...this.raidPick]));
      else this._askMap(m, () => this._startWithPick(m));
    });
    on('raid-back-btn', () => (this._loadoutFor === null ? this.toHome() : this.showMissions()));
    on('finale-home-btn', () => this.toHome());
    on('finale-retry-btn', () => this.startMission('baskin', true));
    on('resume-btn', () => this.resume());
    on('retry-btn', () => this.startMission(this.selectedMission, true));
    on('menu-btn', () => this.toHome());
    on('go-home-btn', () => this.toHome());
    on('vic-home-btn', () => this.toHome());
    on('vic-retry-btn', () => this.startMission(this.selectedMission, true));
    on('vic-next-btn', () => this.startMission(this._nextMissionId(), true));

    // Serbest bakış modunda Esc duraklatır (kilit olayı gelmez).
    addEventListener('keydown', (e) => {
      // Sinematik: Boşluk / Enter / Esc atlar
      if (this.state === 'cinematic' && ['Space', 'Enter', 'Escape'].includes(e.code)) {
        e.preventDefault();
        this.activeCine?.skip();
        return;
      }
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
      if (this.state !== 'playing' || this.mod !== 'piyade') return;
      if (code === 'KeyM') this._toggleSound();
      if (code === 'KeyX') this._setBinocular(!this.binoc);
      // F: etkileşim — M2, zırhlı araç, pencere camı (yakında hangisi varsa).
      // Q / E artık yana eğilme (basılı tutulur, _step'te okunur).
      if (code === 'KeyF') this._interact();
      if (code === 'KeyT') this._toggleTop();
      // Kuledeyken 1 / 2: silah arkadaşı sürsün / araç dursun
      if (this.vehicles.topside) {
        if (code === 'Digit1') this._setAutoDrive(true);
        if (code === 'Digit2') this._setAutoDrive(false);
        return;                       // kulede silah değiştirme / bomba yok
      }
      if (code === 'KeyH') this._treat();
      // M2'deyken ya da yerdeyken elde silah yok: değiştirme, doldurma,
      // bomba kapalı
      if (this.raid.mounted || this.player.downed) return;
      if (code === 'KeyR') this.weaponry.startReload();
      if (code === 'KeyG') this._throwGrenade();
      if (code === 'KeyB') this.weaponry.equipSlot('B');      // M4A1 (rakamlar dolu)
      if (code === 'KeyY') this.weaponry.equipSlot('Y');      // çift tabanca (mağazadan)
      if (code.startsWith('Digit')) {
        const n = Number(code.slice(5));
        if (n >= 0 && n <= 9) this.weaponry.equipSlot(n);       // 0: bıçak
      }
    });

    this.input.on('wheel', (d) => {
      if (this.state === 'playing' && !this.raid.mounted) this.weaponry.cycle(d > 0 ? 1 : -1);
    });

    this.weaponry.onEvent = (name, slot) => {
      if (name === 'equip') this.hud.setActiveWeapon(slot.def);
      // Beceriksiz: koca bir şarjör tek isabet almadan boşaldı
      if (name === 'reload-start' && slot.ammo === 0 && slot.def.mag >= 8
        && (slot._magShots ?? 0) >= slot.def.mag && !slot._magHits) this.achv.award('beceriksiz');
      if (name === 'reload-end') {
        slot._magShots = 0;
        slot._magHits = 0;
        if (this.state === 'playing') this.achv.award('sarjor');
      }
      if (name === 'drop') this._dropMag(slot);        // yük: { pivot, heavy }
      if (name === 'eject') this._ejectCasing(slot);
    };
    this.rockets.onExplode = (ev) => this._onRocketExplosion(ev);
    this.weaponry.onShot = (shot) => this._resolveShot(shot);
    this.weaponry.onMelee = (slot) => this._meleeAttack(slot.def);

    this.enemies.allies = this.allies.allies;
    this.enemies.onAllyHit = (ally, damage) => {
      const dusdu = ally.hurt(this.raid.active ? damage * (1 - RAID.vest) : damage);
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
      if (this.raid.active) {
        this.hud.banner(`BASKIN · DALGA ${wave} / ${RAID.waves.length}`, `${total} DÜŞMAN GELİYOR`);
      }
    };
    this.enemies.onWaveClear = (wave, now) => this._onWaveClear(wave, now);
    this.enemies.onBlocked = (mesh, dmg, point) => {
      const v = mesh.userData?.vehicle;
      if (v) this.vehicles.damage(v, dmg, point);
      else this.raid.hitGlass(mesh, dmg, point);
    };
    // Araç kulesindeki makineli: müttefik ateşi gibi bölge çarpanlı
    this.onTurretHit = (enemy, part, point, dmg) => {
      if (!enemy.alive) return;
      const mult = part === 'head' ? HEADSHOT_MULT : part === 'leg' ? LEG_MULT : BODY_MULT;
      this.effects.hitBurst(point, 0xffb35a, 8);
      if (enemy.hurt(dmg * mult)) {
        enemy._killedBy = { ally: true };
        this.enemies.kill(enemy, performance.now() / 1000, enemy.center.clone().sub(point).setY(0).normalize());
        this.hud.feed(`Kule nişancısı: ${enemy.def.name} düştü`);
      }
    };
    // Sürülen araç patlarsa sürücü dışarı fırlar ve yaralanır
    this.onVehicleBlast = () => this._onPlayerHit(35);

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

  /** Görev seçildikten sonra alan sorulur; seçilince `then` çalışır. */
  _askMap(missionId, then) {
    this.state = 'home';
    this.input.releaseLock();
    const mission = MISSIONS.find((m) => m.id === missionId);
    // Geri: silah seçimine (akış: silah → alan → görev)
    this._mapBack = () => this._showLoadout(missionId ?? null);
    this.hud.buildMapPick(MAPS, this.mapId, mission?.name ?? null, (id) => {
      this.mapId = id;
      try { localStorage.setItem(MAP_KEY, id); } catch { /* gizli sekme */ }
      then();
    });
    this.nametags.setVisible(false);
    this.hud.screen('mapPick');
  }

  /**
   * Görev başlatma akışı: önce silah seçimi (Baskın'da 2, diğerlerinde 4),
   * sonra alan seçimi, sonra görev. Tekrar oynarken / sonraki görevde son
   * seçimler kullanılır. id: görev (null = serbest hat)
   */
  startMission(id, retry = false) {
    if (id === 'baskin') {
      if (retry && this.raidPick.size === 2) this.startRaid([...this.raidPick]);
      else this._showLoadout('baskin');
      return;
    }
    if (retry && this.pick4.size === PICK_COUNT) this._startWithPick(id);
    else this._showLoadout(id);
  }

  async _startWithPick(id) {
    const ids = [...this.pick4];
    try { localStorage.setItem(PICK4_KEY, JSON.stringify(ids)); } catch { /* gizli sekme */ }
    await this.ensureAssets();
    // Sandık yuvasının M2 modeli (Baskın'la ortak) ilk kez yükleniyor
    if (!this.raid.ready) {
      this.hud.screen('loader');
      this.hud.loading(0.1, 'Makineli yuvası hazırlanıyor');
      await this.raid.load((p, label) => this.hud.loading(0.1 + p * 0.9, label));
    }
    this.start(id, null, ids);
  }

  /** Silah seçim ekranı. missionId 'baskin' → 2 silah, diğerleri → 4. */
  _showLoadout(missionId) {
    this.state = 'home';
    if (missionId) this.selectedMission = missionId;
    this._loadoutFor = missionId;
    this.input.releaseLock();
    const baskin = missionId === 'baskin';
    const max = baskin ? 2 : PICK_COUNT;
    const pick = baskin ? this.raidPick : this.pick4;
    this._syncLocks();
    // Bıçak zaten yanında; mağazadan alınmamış silahlar listelenmez
    // Tanımlar weapons.js'ten (modeller henüz inmemiş olabilir)
    const defs = WEAPONS.filter((d) => !d.melee && !this.weaponry.locked.has(d.id));
    // Kayıtlı seçim artık yoksa (silah adı değişti vb.) temizle
    for (const id of pick) if (!defs.some((d) => d.id === id)) pick.delete(id);
    const draw = () => this.hud.buildRaidLoadout(defs, pick, (id) => {
      if (pick.has(id)) pick.delete(id);
      else if (pick.size < max) pick.add(id);
      draw();
    }, max, baskin);
    draw();
    this.nametags.setVisible(false);
    this.hud.screen('raidLoadout');
  }

  showRaidLoadout() { this._showLoadout('baskin'); }

  async startRaid(ids) {
    if (ids.length !== 2) return;
    localStorage.setItem(RAID_PICK_KEY, JSON.stringify(ids));
    await this.ensureAssets();
    if (!this.raid.ready) {
      this.hud.screen('loader');
      this.hud.loading(0.1, 'Baskın evi hazırlanıyor');
      await this.raid.load((p, label) => this.hud.loading(0.1 + p * 0.9, label));
    }
    this.start('baskin', ids);
  }

  /** loadout: normal görevde seçilen 4 silah (null = hepsi) */
  start(missionId = null, raidIds = null, loadout = null) {
    this._kaskKalkaniKullanildi = false;
    this._treating = null;
    this.hud.setDowned(false);
    this._setBinocular(false);
    this.raid.dismount();
    this.hud.setHint(null);
    this.hud.hideBanner();
    this.hud.screen(null);                       // kapanış ekranı açık kalmasın
    this.hud.setRaidMode(raidIds ? RAID.waves.length : 0);
    this.world.setTheme(mapById(this.mapId));
    if (raidIds) {
      this.raid.setup();
      this.enemies.raid = {
        waves: RAID.waves, center: RAID.center,
        minR: RAID.spawnMin, maxR: RAID.spawnMax, maxAlive: RAID.maxAlive,
      };
    } else {
      this.raid.teardown();
      this.enemies.raid = null;
    }
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
    this._syncLocks();
    let secilen = raidIds ?? loadout;
    if (secilen) secilen = secilen.filter((id) => !this.weaponry.locked.has(id));
    this.weaponry.setLoadout(secilen);
    this.weaponry.equip(secilen ? secilen[0] : 'ak47');
    this.hud.buildWeaponStrip(
      this.weaponry.slots.filter((x) => this.weaponry.usable(x.def.id)),
      this.weaponry.current.def.id,
    );
    this.hud.setActiveWeapon(this.weaponry.current.def);
    this.enemies.reset();
    // Giriş sinematiğinde aracın geleceği yol şeridi boşaltılır
    const plan = this._introPlan(raidIds);
    // Sandık yuvası: oyuncunun ~55 m önünde (müttefik menzili 42 m — ilk
    // saniyede onlar indirmesin), namlusu iniş noktasına dönük
    this.raid.teardownNest();
    const nestAt = raidIds ? null : this.player.pos.clone().add(new THREE.Vector3(6, 0, -55)).setY(0);
    const rects = [plan.rect];
    if (nestAt) rects.push({ x0: nestAt.x - 4, x1: nestAt.x + 4, z0: nestAt.z - 4, z1: nestAt.z + 4 });
    this.world.setClearRects(rects);
    if (nestAt) {
      const nest = this.raid.setupNest(nestAt, Math.atan2(nestAt.x - this.player.pos.x, nestAt.z - this.player.pos.z));
      if (nest) this.enemies.addNestGunner(nest, { hp: NEST.hp, damage: NEST.damage, range: NEST.range });
    }
    this.enemies.glassList = raidIds ? this.raid.glass : null;

    // İki mühimmat sandığı: biri iniş noktasının yanında (araç yolunun
    // dışında), biri makineli yuvasına giden yolda; Baskın'da evin iki odasında
    const crateSpots = raidIds
      ? [{ pos: this.raid._w(-2.4, 4.3), yaw: Math.PI }, { pos: this.raid._w(5.0, -2.0), yaw: -Math.PI / 2 }]
      : [{ pos: this.player.pos.clone().add(new THREE.Vector3(-8.5, 0, -2)).setY(0), yaw: 0.5 },
        { pos: nestAt.clone().add(new THREE.Vector3(-8, 0, 9)), yaw: -0.4 }];
    if (!raidIds) {
      for (const c of crateSpots) rects.push({ x0: c.pos.x - 1.5, x1: c.pos.x + 1.5, z0: c.pos.z - 1.5, z1: c.pos.z + 1.5 });
      this.world.setClearRects(rects);
    }
    this.crates.place(crateSpots);
    if (raidIds) {
      const st = this.raid.playerStart;
      this.player.pos.copy(st.pos);
      this.player.yaw = st.yaw;
      // Evin çevresindeki sektörler hemen kurulsun (ilk karede boş arazi görünmesin)
      this.camera.position.set(st.pos.x, 1.66, st.pos.z);
      this.camera.rotation.set(0, st.yaw, 0);
      this.camera.updateMatrixWorld();
      this.world.update(this.camera, this.player.pos, performance.now() / 1000, 30);
    } else {
      // Alan değişmiş olabilir: çevredeki sektörler ilk karede hazır olsun
      this.camera.position.set(this.player.pos.x, 1.66, this.player.pos.z);
      this.camera.rotation.set(0, this.player.yaw, 0);
      this.camera.updateMatrixWorld();
      this.world.update(this.camera, this.player.pos, performance.now() / 1000, 30);
    }
    this.allies.engageRange = raidIds ? 80 : 42;
    this.allies.spawn(raidIds ? 4 : 3, this.player.pos, raidIds ? this.raid.posts : null);
    // Zırhlı araç giriş sinematiğinde gelir (intro.js)
    this.vehicles.clear();
    this.enemies.allies = this.allies.allies;
    this.nametags.rebuild(this.allies.allies);
    this.grenades.reset(3);
    this._finaleEndAt = 0;
    this.casings.reset();
    this.droppedMags.reset();
    this.rockets.reset();
    this.missions.resetRun();

    this.state = 'cinematic';
    this.nametags.setVisible(false);
    this.hud.screen(null);
    this.hud.setScore(0);
    this.hud.setHealth(this.player.health, this.player.maxHealth);
    this.hud.setGrenades(this.grenades.count);
    this.hud.setMission(this.missions.active, this.missions);
    this.input.requestLock();
    this.clock.getDelta();
    // Giriş sinematiği: araçla varış ve iniş; bitince dalga başlar
    this.activeCine = this.intro;
    this.intro.begin({
      ...plan,
      map: mapById(this.mapId),
      missionName: MISSIONS.find((m) => m.id === missionId)?.name ?? null,
      onDone: () => this._afterIntro(raidIds),
    });
  }

  /** Sinematik bitti (ya da atlandı): oyun başlar. */
  _afterIntro(raidIds) {
    this.activeCine = null;
    this.state = 'playing';
    this.nametags.setVisible(true);
    this.camera.fov = BASE_FOV;
    this.camera.updateProjectionMatrix();
    this.clock.getDelta();
    this.enemies.startWave(1);
    if (raidIds) this.hud.feed('GÖREV YELEĞİ — sen ve takımın hasarın %80\'ini soğuruyor', true);
  }

  /**
   * Giriş sinematiğinin planı: aracın duracağı yer, yönü, oyuncunun iniş
   * noktası ve aracın geleceği yolun boşaltılacak şeridi.
   */
  _introPlan(raidIds) {
    const L = 64;                                  // yol şeridi (sinematik 58 m)
    if (raidIds) {
      // Evin güney duvarı boyunca doğudan gelir, bahçe kapısının yanında durur
      const C = RAID.center;
      const stop = new THREE.Vector3(C.x - 3, 0, C.z + 14);
      const gate = new THREE.Vector3(C.x, 0, C.z + 10.8);
      const st = this.raid.playerStart;
      return {
        stop, yaw: Math.PI, raid: true,
        finalPos: st.pos.clone(), finalYaw: st.yaw,
        spots: [[-0.7, 0], [0.7, 0], [-0.7, 1.3], [0.7, 1.3]]
          .map(([dx, dz]) => gate.clone().add(new THREE.Vector3(dx, 0, dz))),
        // Şerit batıya da uzar: görev sonunda tahliye aracı buradan çıkıp gider
        rect: { x0: stop.x - 50, x1: stop.x + L, z0: stop.z - 6.5, z1: stop.z + 6.5 },
      };
    }
    // Yol boyunca kuzeye (−Z) gelir; oyuncu aracın arkasından iner
    const p = this.player.pos.clone();
    const stop = p.clone().add(new THREE.Vector3(0, 0, -5.2));
    return {
      stop, yaw: Math.PI / 2, raid: false,
      finalPos: p, finalYaw: 0,
      rect: { x0: stop.x - 6.5, x1: stop.x + 6.5, z0: stop.z - 3, z1: stop.z + L },
    };
  }

  /* ── Baskın ────────────────────────────────────────────────────────── */

  _setBinocular(on) {
    this.binoc = on;
    this.hud.setBinocular(on);
    if (on) this.weaponry.ads = false;
  }

  /** E: yakındaki M2'ye geç ya da ondan ayrıl. */
  _toggleMount() {
    if (this.raid.mounted) {
      // Nişancı kalkınca camı kapatır (kırık değilse)
      const glass = this.raid.mounted.glass;
      this.raid.dismount();
      if (glass) this.raid.setGlass(glass, false);
      this.hud.setActiveWeapon(this.weaponry.current.def);
      return;
    }
    const g = this.raid.nearbyMG(this.player.pos);
    if (!g) return;
    this.raid.mount(g, this.player);
    this.player.crouching = false;
    this.player.eye = 1.66;
    this.hud.setActiveWeapon(M2_DEF);
    this.audio.swap();
  }

  /** F: bağlama göre M2'ye geç/bırak, araca bin/in ya da camı aç/kapat. */
  _interact() {
    if (this.player.downed) return;
    if (this.raid.mounted) { this._toggleMount(); return; }
    if (this.vehicles.topside) return;                 // kuleden T ile inilir
    if (this.vehicles.driving) { this._toggleVehicle(); return; }
    if (this.raid.nearbyMG(this.player.pos)) { this._toggleMount(); return; }
    const sandik = this.crates.nearby(this.player.pos);
    if (sandik) { this._useCrate(sandik); return; }
    if (this.vehicles.nearby(this.player.pos)) { this._toggleVehicle(); return; }
    if (this.raid.active) this._toggleGlass();
  }

  /** Mağazadan alınmamış silahlar (shopId) kilitli kalır. */
  _syncLocks() {
    this.shop.yukle();
    this.weaponry.locked = new Set(WEAPONS
      .filter((d) => d.shopId && !this.shop.sahipMi(d.shopId))
      .map((d) => d.id));
  }

  /** Mühimmat sandığı: bütün silahların mermisi dolar. */
  _useCrate(c) {
    const now = performance.now() / 1000;
    if (now - c.usedAt < 0.8) return;
    c.usedAt = now;
    this.weaponry.refillAll();
    this.audio.ammoRefill();
    this.hud.feed('MÜHİMMAT SANDIĞI — bütün şarjörler ve yedek mermiler doldu', true);
  }

  /** T: zırhlı aracın kulesine çık (M2 başına) ya da in. */
  _toggleTop() {
    if (this.player.downed || this.raid.mounted || this.vehicles.driving) return;
    if (this.vehicles.topside) {
      this.vehicles.climbDown();
      document.getElementById('top-choice').hidden = true;
      this.hud.setActiveWeapon(this.weaponry.current.def);
      return;
    }
    const v = this.vehicles.nearby(this.player.pos);
    if (!v) return;
    this._setBinocular(false);
    this.vehicles.climb(v);
    this.hud.setActiveWeapon(M2_DEF);
    document.getElementById('top-choice').hidden = false;
    const n = v.riders.length;
    this.hud.feed(n ? `KULEYE ÇIKTIN — ${n} silah arkadaşı araca bindi` : 'KULEYE ÇIKTIN', true);
  }

  /** Kuledeyken: silah arkadaşı sürsün (yol üzerinden düşmana) / dursun. */
  _setAutoDrive(on) {
    if (!this.vehicles.topside) return;
    if (!this.vehicles.setAutoDrive(on)) {
      this.hud.feed('Sürecek silah arkadaşı yok — araç duruyor', true);
      return;
    }
    document.getElementById('top-choice').hidden = true;
    this.hud.feed(on ? 'SİLAH ARKADAŞIN SÜRÜYOR — yol üzerinden düşmana' : 'ARAÇ DURUYOR', true);
  }

  /** Yakındaki zırhlı araca bin / araçtan in. */
  _toggleVehicle() {
    if (this.player.downed) return;
    if (this.vehicles.driving) { this.vehicles.exit(); return; }
    const v = this.vehicles.nearby(this.player.pos);
    if (!v) return;
    this._setBinocular(false);
    this.vehicles.enter(v);
    const n = v.riders.length;
    this.hud.feed(n ? `ARACA BİNİLDİ — ${n} silah arkadaşı da bindi${v.gunner ? ', biri kulede' : ''}` : 'ARACA BİNİLDİ', true);
  }

  /** F: yanındaki pencerenin (M2'deyken onun penceresinin) camını aç/kapat. */
  _toggleGlass() {
    if (!this.raid.active) return;
    const g = this.raid.mounted?.glass ?? this.raid.nearbyGlass(this.player.pos);
    if (!g || g.broken) return;
    g.override = performance.now() / 1000 + 10;
    this.raid.setGlass(g, !g.open);
  }

  /** Son düşman düştüğü an: Baskın'da duyuru, son dalgada kapanış. */
  _onWaveClear(wave, now) {
    if (!this.raid.active) return;
    this.missions.report({ type: 'raid-wave', wave });
    this.hud.setMission(this.missions.active, this.missions);
    if (wave < RAID.waves.length) {
      this.hud.banner(`DALGA ${wave} PÜSKÜRTÜLDÜ`, 'SIRADAKİ BASKIN 10 SANİYEDE', 4200);
      return;
    }
    // Son dalga: sayaç durur, ufukta yeni birlik belirir
    this.enemies.state = 'idle';
    this.raid.startFinale(now);
    this._finaleEndAt = now + FINALE_TIME;
    this.hud.banner('BASKIN PÜSKÜRTÜLDÜ', 'UFUKTA YENİ BİRLİKLER', 6500);
    this.hud.feed('Güneydoğudan yaklaşan birlik — X ile dürbüne bak', true);
  }

  _raidVictory() {
    this.state = 'victory';
    this.input.releaseLock();
    this._setBinocular(false);
    this.raid.dismount();
    this.hud.setHint(null);
    this.hud.hideBanner();
    this.music.setLevel(0.5, 1.2);
    this.audio.waveStart();

    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.score));
    }
    this.shop.puanEkle(this.score);
    this.nametags.setVisible(false);
    this.hud.raidFinale({
      kills: this.kills,
      score: this.score,
      accuracy: this.shotsFired ? this.shotsHit / this.shotsFired : 0,
    });
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

  /** Ana ekrandaki haftalık ödül takvimi. kazanilan: az önce alınan puan. */
  _drawWeekly(kazanilan = 0) {
    const w = this.weekly;
    this.hud.buildWeekly(w.gunler(), w.alinabilir, kazanilan);
  }

  toHome() {
    this.state = 'home';
    this._syncLocks();
    this._drawWeekly();
    this.hud.setDowned(false);
    this.vehicles.exit();
    this.input.releaseLock();
    this.music.setLevel(0.5, 0.8);
    this.hud.buildHome({
      best: this.best,
      missionsDone: this.missions.completedCount,
      missionsTotal: MISSIONS.length,
      weapons: WEAPONS.filter((d) => !this.weaponry.locked.has(d.id)),
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
    if (this.raid.active) return false;                  // Baskın kendi kapanışıyla biter
    if (!this.selectedMission) return false;              // serbest hat: sonsuz
    if (!this.missions.runDone.has(this.selectedMission)) return false;
    this.missionComplete();
    return true;
  }

  /** Görev tamam: önce tahliye sinematiği, sonra sonuç ekranı. */
  missionComplete() {
    if (this.mod === 'piyade' && this.state === 'playing') {
      this._beginOutro(false, () => this._showVictory());
      return;
    }
    this._showVictory();
  }

  /**
   * Tahliye sinematiği: araç gelir, ekip biner, uzaklaşır.
   * raid: Baskın'da araç evin bahçe kapısına gelir.
   */
  _beginOutro(raid, done) {
    this.state = 'cinematic';
    this._setBinocular(false);
    this.raid.dismount();
    this.vehicles.exit();
    this.hud.setHint(null);
    this.hud.hideBanner();
    this.hud.setDowned(false);
    this.player.downed = false;
    this._treating = null;
    this.activeCine = this.outro;
    const C = RAID.center;
    this.outro.begin({
      raid,
      raidStop: new THREE.Vector3(C.x - 3, 0, C.z + 14),
      raidGate: new THREE.Vector3(C.x, 0, C.z + 10.8),
      map: mapById(this.mapId),
      missionName: MISSIONS.find((m) => m.id === this.selectedMission)?.name ?? null,
      onDone: () => {
        this.activeCine = null;
        this.camera.fov = BASE_FOV;
        this.camera.updateProjectionMatrix();
        done();
      },
    });
  }

  _showVictory() {
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
    this._setBinocular(false);
    this.raid.dismount();
    this.hud.setHint(null);
    this.hud.hideBanner();
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
    if (this.raid.active) this.raid.blast(center, radius, maxDamage);
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
    if (slot) slot._magShots = (slot._magShots ?? 0) + 1;

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

    // Kuledeyken kendi aracımızın gövdesi/kalkanı mermiyi durdurmasın
    const own = this.vehicles.topside;
    const solids = own ? this.world.solids.filter((o) => o.userData?.vehicle !== own) : this.world.solids;
    const targets = [...this.enemies.hitTargets, ...solids];
    const hit = this.raycaster.intersectObjects(targets, false)[0];

    const end = hit ? hit.point.clone() : camPos.clone().addScaledVector(dir, 180);
    this.effects.tracer(origin, end, weapon.tracer);
    // Gökyüzüne (~35°'den dik, hiçbir şeye değmeden) ateş
    if (!hit && dir.y > 0.57) this.achv.award('yildiz');

    if (!hit) return;

    const data = hit.object.userData;
    if (data?.enemy) {
      const enemy = data.enemy;
      if (!enemy.alive) return;

      const part = data.part;
      const head = part === 'head';
      const leg = part === 'leg';
      this.shotsHit++;
      if (slot) slot._magHits = (slot._magHits ?? 0) + 1;
      if (head) this.achv.award('keskin');

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
    } else if (data?.glass) {
      // Kurşun geçirmez cam: mermiyi durdurur, hasar alır
      this.raid.hitGlass(hit.object, weapon.damage, hit.point);
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

  /**
   * Bıçak isabeti (savurmanın ortasında). Önce nişangâh yönünde kısa ışın;
   * tutmazsa önündeki dar koni içindeki en yakın düşman (yakın dövüşte tam
   * nişan gerekmesin). Arkadan saldırı `backstab` katı hasar verir.
   */
  _meleeAttack(def) {
    const m = def.melee;
    const now = performance.now() / 1000;
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    this.raycaster.set(camPos, dir);
    this.raycaster.far = m.range;
    const hit = this.raycaster.intersectObjects([...this.enemies.hitTargets, ...this.world.solids], false)[0];
    this.raycaster.far = 260;

    let enemy = null, part = 'body', point = null;
    if (hit?.object.userData?.enemy) {
      enemy = hit.object.userData.enemy;
      part = hit.object.userData.part ?? 'body';
      point = hit.point;
    } else if (!hit) {
      const flat = dir.clone().setY(0).normalize();
      let best = m.range + 0.4;
      for (const e of this.enemies.enemies) {
        if (!e.alive) continue;
        const to = new THREE.Vector3(e.pos.x - this.player.pos.x, 0, e.pos.z - this.player.pos.z);
        const d = to.length();
        if (d > best || d < 0.01) continue;
        if (to.divideScalar(d).dot(flat) < 0.82) continue;      // ±35°
        best = d;
        enemy = e;
      }
      point = enemy?.center;
    }

    if (enemy?.alive) {
      // Arkadan mı? Düşmanın baktığı yön oyuncudan uzağa dönükse
      const fwd = new THREE.Vector3(-Math.sin(enemy.facing), 0, -Math.cos(enemy.facing));
      const toP = new THREE.Vector3(this.player.pos.x - enemy.pos.x, 0, this.player.pos.z - enemy.pos.z).normalize();
      const back = fwd.dot(toP) < -0.3;
      const head = part === 'head';
      const dead = enemy.hurt(m.damage * (head ? 2 : 1) * (back ? m.backstab : 1));
      this.effects.hitBurst(point, 0xa3241a, 14);
      this.audio.stab?.();
      this.hud.hitmarker(dead);
      if (dead) {
        enemy._killedBy = { weaponId: 'bicak', knife: true, backstab: back, headshot: head };
        this.enemies.kill(enemy, now, dir);
      }
    } else if (hit) {
      const n = hit.face
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        : new THREE.Vector3(0, 1, 0);
      this.effects.sparks(hit.point, n, 0xffd9a0, 5);
      this.audio.impact();
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
    if (this.raid.active) this.raid.blast(center, radius, maxDamage);

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
    if (!by.ally) this.achv.award('ilkkan');
    this.score += Math.round(enemy.scoreValue * mult * (by.headshot ? 1.5 : 1));
    this.hud.setScore(this.score);
    this.hud.setCombo(this.combo, mult);
    this.hud.feed(
      `${enemy.def.name} ${by.backstab ? '— ARKADAN BIÇAK' : by.knife ? '— BIÇAK' : by.headshot ? '— KAFA' : by.grenade ? '— BOMBA' : 'düştü'}`,
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
    // Zırhlı araçtayken mermi araca gelir, sürücüye değil
    if (this.vehicles.driving) { this.vehicles.damage(this.vehicles.driving, damage); return; }
    if (this.player.downed) { this._downedHit(); return; }
    // Kuledeki nişancıyı kalkan kısmen korur: isabetlerin %45'i kalkana
    if (this.vehicles.topside && Math.random() < 0.45) {
      this.effects.sparks(this.camera.position.clone().add(new THREE.Vector3(0, -0.3, 0)), new THREE.Vector3(0, 1, 0), 0xffc06a, 4);
      return;
    }
    // Çömelmiş hedef küçüktür: isabetlerin %20'si ıskalar. Köşeden eğilip
    // bakan daha da küçüktür (gövde siperde, yalnızca baş ve omuz açıkta).
    {
      const p = this.player;
      let miss = p.crouching ? 0.2 : 0;
      if (p.leaning) miss = 1 - (1 - miss) * 0.65;
      if (miss && Math.random() < miss) return;
    }

    // Teçhizat: yelek gövdeyi, kask kafayı azaltır. Ham hasar büyükse
    // "keskin nişancı", küçükse "seri atış" sayılır (shop.js).
    // Baskın'da herkese hasarın %80'ini soğuran görev yeleği verilir
    let gelen = this.shop.hasarAzalt(damage, bolge, this.raid.active ? RAID.vest : 0);

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
    if (!this.player.alive) this._goDown();
  }

  /* ── Ağır yaralı ve tedavi ─────────────────────────────────────────── */

  /** Can bitti: ölmek yerine yere yığıl. Çember hasarsız dolarsa kalkarsın. */
  _goDown() {
    const p = this.player;
    if (this.vehicles.topside) {
      this.vehicles.climbDown();
      document.getElementById('top-choice').hidden = true;
    }
    p.alive = true;
    p.downed = true;
    p.health = 0;
    this._downProgress = 0;
    this._downHits = 0;
    this._treating = null;
    this._setBinocular(false);
    this.raid.dismount();
    this.weaponry.ads = false;
    this.hud.setDowned(true, 0, DOWNED_HITS);
    this.hud.feed('AĞIR YARALISIN — tek isabet ölümcül, sürünerek siper al', true);
  }

  /** Yerdeyken isabet: çember sıfırlanır; çok isabet ölümdür. */
  _downedHit() {
    this._downHits++;
    this._downProgress = 0;
    this.hud.damageFlash();
    this.audio.playerHurt();
    if (this._downHits >= DOWNED_HITS) {
      this.player.downed = false;
      this.player.alive = false;
      this.hud.setDowned(false);
      this.gameOver();
      return;
    }
    this.hud.setDowned(true, 0, DOWNED_HITS - this._downHits);
  }

  _revive() {
    const p = this.player;
    p.downed = false;
    p.healthCap = WOUND_CAP;
    p.health = WOUND_CAP;
    p.treatStage = 0;
    p.lastHurt = performance.now() / 1000;
    this.hud.setDowned(false);
    this.hud.feed(`AYAĞA KALKTIN — canın ${WOUND_CAP}'te kalacak: H ile önce sargı bezi, sonra ilk yardım kiti`, true);
  }

  /** H: tedavinin sıradaki adımı (önce sargı bezi, sonra ilk yardım kiti). */
  _treat() {
    const p = this.player;
    if (p.downed || this._treating) return;
    if (!p.wounded) { this.hud.feed('Ağır yaralı değilsin — tedaviye gerek yok'); return; }
    const item = p.treatStage === 0 ? 'sargi' : 'kit';
    if (this.shop.adet(item) <= 0) {
      this.hud.feed(`${TREAT[item].ad} yok — mağazanın Sağlık bölümünden al`, true);
      return;
    }
    const now = performance.now() / 1000;
    this._treating = { item, start: now, end: now + TREAT[item].sure };
    this.raid.dismount();
    this.audio.swap();
  }

  _updateTreatment(now) {
    const t = this._treating;
    if (!t || now < t.end) return;
    this._treating = null;
    const p = this.player;
    if (!this.shop.kullan(t.item)) return;
    if (t.item === 'sargi') {
      p.treatStage = 1;
      this.hud.feed('Sargı bezi sarıldı — şimdi ilk yardım kiti (H)', true);
    } else {
      p.treatStage = 0;
      p.healthCap = p.maxHealth;
      p.health = p.maxHealth;
      this.hud.feed('TEDAVİ TAMAM — canın yeniden dolu', true);
    }
  }

  /* ── Mağaza ────────────────────────────────────────────────────────── */

  showShop(bolum = this.shopBolum) {
    this.shopBolum = bolum;
    this.state = 'home';
    this.shop.yukle();      // tank bölümünün kazandırdığı kredi görünsün
    const urunler = bolum === 'vest' ? YELEKLER : bolum === 'helm' ? KASKLAR
      : bolum === 'health' ? SAGLIK : SILAHLAR;
    this.hud.buildShop(bolum, urunler, {
      kredi: this.shop.kredi,
      sahipMi: (id) => this.shop.sahipMi(id),
      adet: (id) => this.shop.adet(id),
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

  /* Zırhlı görev (tank bölümü) tam ekran çerçevede açılır. Ayrı bir sayfa
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
    const ad = gorevBul(gorevId)?.gorev.ad ?? '';
    cerceve.src = `tankgame/index.html?gorev=${encodeURIComponent(gorevId)}&ad=${encodeURIComponent(ad)}&v=${Date.now()}`;
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
    this.raid.teardown();
    this.vehicles.clear();
    this.enemies.raid = null;
    this._setBinocular(false);
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
    } else if (this.state === 'cinematic') {
      this.input.consumeLook();                  // sinematikte fare bakışı yok
      this.weaponry.rig.visible = false;
      this.world.update(this.camera, this.player.pos, now, 3);
      this.vehicles.update(dt, now);
      if (this.raid.active) this.raid.update(dt, now);       // ufuktaki birlik yürür
      this.activeCine?.update(dt, now);
    } else {
      this.world.update(this.camera, this.player.pos, now, 1);
    }

    this.effects.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _step(dt, now) {
    const look = this.input.consumeLook();
    // Dürbünde fare hassasiyeti büyütmeyle orantılı düşer
    const lookK = this.binoc ? 1 / BINOC_ZOOM : 1;
    this.player.look(look.dx * lookK, look.dy * lookK);
    const mounted = this.raid.mounted;
    const downed = this.player.downed;
    const driving = this.vehicles.driving;
    const topside = this.vehicles.topside;
    const busy = downed || Boolean(this._treating) || Boolean(driving) || Boolean(topside);     // elde silah yok

    const ads = this.input.mouse(2) && !this.binoc && !mounted && !busy;
    // Ağır yaralı: yalnızca sürünür (koşu, zıplama, eğilme yok)
    const crawl = (a, b) => (this.input.down(a) ? 1 : 0) - (this.input.down(b) ? 1 : 0);
    const moveInput = downed ? {
      forward: crawl('KeyW', 'KeyS'), right: crawl('KeyD', 'KeyA'),
      jump: false, sprint: false, crouch: true, lean: 0,
    } : {
      forward: (this.input.down('KeyW') ? 1 : 0) - (this.input.down('KeyS') ? 1 : 0),
      right: (this.input.down('KeyD') ? 1 : 0) - (this.input.down('KeyA') ? 1 : 0),
      jump: this.input.down('Space'),
      sprint: this.input.down('ShiftLeft') || this.input.down('ShiftRight'),
      crouch: this.input.down('ControlLeft') || this.input.down('KeyC'),
      // Q sola, E sağa eğil (basılı tut)
      lean: (this.input.down('KeyE') ? 1 : 0) - (this.input.down('KeyQ') ? 1 : 0),
    };

    // M2'deyken oyuncu sehpanın arkasında sabit; kamerayı tüfek sürer
    if (mounted) this.raid.updateMounted(dt, now, this.player, this.camera);
    else if (driving) this.vehicles.drive(dt, now, moveInput);
    else if (topside) this.vehicles.updateTop(dt, now);
    else this.player.update(dt, moveInput, ads, this.weaponry.current.def.weight ?? 0);
    this.physics.moveKinematic(
      this.playerBody, this.player.pos.x, this.player.pos.y + 0.9, this.player.pos.z,
    );

    // Dünya akışı: görüş alanına giren sektörler kurulur, çıkanlar sökülür.
    this.world.update(this.camera, this.player.pos, now);

    const def = this.weaponry.current.def;
    const firing = this.input.mouse(0) && !this.binoc && !busy;
    if (mounted) {
      if (firing) {
        const shot = this.raid.fire(now, this.camera);
        if (shot) this._resolveShot({ ...shot, weapon: M2_DEF, slot: null, noEject: true });
      }
    } else if (topside) {
      // Kuledeki M2 (busy olsa da ateş edilir: elde silah yok, kule var)
      if (this.input.mouse(0) && !this.binoc) {
        const shot = this.vehicles.fireTop(now);
        if (shot) this._resolveShot({ ...shot, weapon: M2_DEF, slot: null, noEject: true });
      }
    } else if (firing) {
      if (def.auto) this.weaponry.tryFire(now);
      else if (!this._triggerHeld) this.weaponry.tryFire(now);
      this._triggerHeld = true;
    } else {
      this._triggerHeld = false;
    }

    this.weaponry.rig.visible = !mounted && !this.binoc && !busy;
    if (!mounted) {
      if (this.weaponry.current.ammo === 0 && !this.weaponry.reloading) {
        this.weaponry.startReload();
      }

      this.weaponry.update({
        dt, now, look, ads, firing,
        moving: moveInput.forward !== 0 || moveInput.right !== 0,
        sprinting: this.player.sprinting,
      });
    }

    const zoom = this.binoc ? BINOC_ZOOM
      : mounted ? 1.12
          : THREE.MathUtils.lerp(1, def.zoom, this.weaponry.adsBlend);
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
    this.raid.update(dt, now);
    this.vehicles.update(dt, now);

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

    // Ağır yaralı: hasar almadan geçen süre çemberi doldurur
    if (downed) {
      this._downProgress = Math.min(1, this._downProgress + dt / REVIVE_TIME);
      this.hud.setDowned(true, this._downProgress, DOWNED_HITS - this._downHits);
      if (this._downProgress >= 1) this._revive();
    }
    this._updateTreatment(now);

    // Baskın kapanışı: birlik bir süre görünür, sonra görev biter
    if (this.raid.finale && now > this._finaleEndAt) {
      // Baskın püskürtüldü: ekip araçla tahliye edilir, sonra kahraman ekranı
      this._beginOutro(true, () => this._raidVictory());
      return;
    }

    this._updateHud(now);
  }

  /** Dürbün: bakılan noktanın mesafesi (saniyede ~8 kez) ve pusula yönü. */
  _updateBinocular(now) {
    if (now < this._binocRead) return;
    this._binocRead = now + 0.12;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    this.raycaster.set(this.camera.getWorldPosition(new THREE.Vector3()), dir);
    const hit = this.raycaster.intersectObjects([...this.enemies.hitTargets, ...this.world.solids], false)[0];
    // Pusula: kuzey −Z, doğu +X
    const bearing = THREE.MathUtils.radToDeg(Math.atan2(dir.x, -dir.z));
    this.hud.setBinocReadout(hit ? hit.distance : null, (bearing + 360) % 360);
  }

  _updateHud(now) {
    const s = this.weaponry.current;
    const mg = this.raid.mounted;
    const p = this.player;
    this.hud.setWound(p.wounded ? {
      cap: p.healthCap,
      adim: p.treatStage === 0 ? 'sargı bezi' : 'ilk yardım kiti',
      adet: this.shop.adet(p.treatStage === 0 ? 'sargi' : 'kit'),
      tedavi: this._treating
        ? { ad: TREAT[this._treating.item].ad, t: (now - this._treating.start) / (this._treating.end - this._treating.start) }
        : null,
    } : null);
    const top = this.vehicles.topside;
    if (top) this.hud.setAmmo(top.topAmmo, 3000, '—');
    else if (mg) this.hud.setAmmo(mg.ammo, mg.maxAmmo ?? RAID.mgRounds, '—');
    else if (s.def.melee) this.hud.setAmmo('—', 1, '—');
    else this.hud.setAmmo(s.ammo, s.def.mag, s.reserve);
    if (this.binoc) this._updateBinocular(now);

    // Etkileşim ipucu: M2'nin arkasına gelince / üstündeyken
    let hint = null;
    const camYazi = (g) => (g.open ? 'camı kapat' : 'camı aç') + ` (%${Math.ceil(g.hp / RAID.glassHp * 100)})`;
    const yakinMG = !mg && !this.raid.finale ? this.raid.nearbyMG(this.player.pos) : null;
    const yakinSandik = !mg && !top && !this.vehicles.driving && !this.player.downed
      ? this.crates.nearby(this.player.pos) : null;
    if (mg) {
      hint = ['F', mg.nest ? `M2'yi bırak · sol tık ateş · X dürbün` : `M2'yi bırak (cam kapanır) · sol tık ateş · X dürbün`];
    } else if (yakinMG) {
      hint = ['F', `M2 Browning — ${yakinMG.ammo.toLocaleString('tr')} mermi`];
    } else if (yakinSandik) {
      hint = ['F', 'Mühimmat sandığı — bütün silahların mermisi dolar'];
    } else if (this.raid.active) {
      const g = this.raid.nearbyGlass(this.player.pos);
      if (g) hint = ['F', `Kurşun geçirmez ${camYazi(g)}`];
    } else if (top) {
      hint = ['T', `kuleden in · 1 arkadaşın sürsün · 2 dursun${top.autoDrive ? ' (sürüyor)' : ' (duruyor)'} · zırh %${Math.ceil(top.hp / 25)}`];
    } else if (this.vehicles.driving) {
      const v = this.vehicles.driving;
      hint = ['F', `in · W/S gaz-geri · A/D direksiyon · Space fren · zırh %${Math.ceil(v.hp / 25)} · ${Math.round(Math.abs(v.speed) * 3.6)} km/s`];
    } else if (!this.player.downed && this.vehicles.nearby(this.player.pos)) {
      hint = ['F', 'araca bin (sür) · T kuleye çık — yakındaki silah arkadaşların da biner'];
    }
    this.hud.setHint(hint);
    this.hud.setHealth(this.player.health, this.player.maxHealth, this.player.healthCap);
    this.hud.setStamina(this.player.stamina, this.player.exhausted);
    this.hud.setSectors(this.world.sectors.size, this.world.grid ** 2);
    this.hud.setWave(this.enemies.wave, this.enemies.remaining, this.enemies.waveTotal ?? 1);

    if (this.weaponry.reloading) {
      const t = (now - this.weaponry.reloadStart) / (this.weaponry.reloadEnd - this.weaponry.reloadStart);
      this.hud.setReload(THREE.MathUtils.clamp(t, 0, 1));
    } else {
      this.hud.setReload(null);
    }

    const scoped = this.weaponry.scoped && !mg && !this.binoc;
    this.hud.setScope(scoped);
    const optic = this.weaponry.optic && !mg && !this.binoc
      && !this.vehicles.driving && !this.vehicles.topside;
    this.hud.setOptic(optic);
    this.hud.setCrosshair(
      mg ? 0.14 : THREE.MathUtils.clamp(this.weaponry.spreadDeg / 3.5, 0.08, 1),
      scoped || this.binoc || optic,
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
      allies: this.allies.allies,
      crates: this.crates.list,
      world: this.world,
      grenades: this.grenades.live,
    });

    if (now > this.comboUntil && this.combo > 0) {
      this.combo = 0;
      this.hud.setCombo(0, 1);
    }
  }
}
