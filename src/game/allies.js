/* Müttefik askerler: oyuncunun yanında savaşan üç asker.

   Davranış döngüsü (siper savaşı mantığı):
     TAKİP   — oyuncudan uzaklaşmışsa yanına koşar
     SİPER   — düşman varsa en uygun mevziye gider, arkasına çömelir
     ATEŞ    — mevzide kısa seriler (tarama) atar, şarjör boşalınca doldurur
     YERDE   — canı bittiğinde yere yığılmaz, çömelmiş halde kalır; 15 saniye
               sonra oyuncunun yanında tekrar ayağa kalkar

   Can ve dirilme süresi oyuncununkinden bağımsızdır; müttefikler ölmez,
   yalnızca etkisiz kalır.                                                  */

import * as THREE from 'three';
import { Soldier } from './soldier.js';

const MAX_HP = 120;
const REVIVE_TIME = 15;          // saniye
const FOLLOW_DIST = 7;           // oyuncuya bu mesafeden uzaklaşmaz
const ENGAGE_RANGE = 42;
const BURST = { shots: 4, interval: 0.11, pause: 0.9 };

export class Ally {
  constructor(soldier, index) {
    this.soldier = soldier;
    this.root = soldier.root;
    this.index = index;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = 0;

    this.hp = MAX_HP;
    this.alive = true;
    this.downed = false;
    this.reviveAt = 0;

    this.cover = null;
    this.state = 'follow';
    this.target = null;
    this.burstLeft = 0;
    this.nextShot = 0;
    this.nextThink = 0;
    this.ammo = 30;
    this.reloadUntil = 0;
  }

  get center() {
    return new THREE.Vector3(this.pos.x, this.pos.y + 1.2, this.pos.z);
  }

  hurt(amount) {
    if (this.downed) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.downed = true;
      this.alive = false;
      this.cover = null;
      return true;
    }
    return false;
  }
}

export class AllyManager {
  constructor(scene, world, effects, audio, gear, soldierFactory) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.gear = gear;
    this.factory = soldierFactory;

    this.allies = [];
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 80;

    this.onEnemyHit = null;      // (enemy, damage, part, point) => void
    this.engageRange = ENGAGE_RANGE;
  }

  /**
   * @param posts  verilirse her asker kendi mevziine (pencere başı) yerleşir
   *               ve oradan ayrılmaz: [{ pos: Vector3, facing }]
   */
  spawn(count, playerPos, posts = null) {
    this.clear();
    if (!this.factory?.template) return;

    for (let i = 0; i < count; i++) {
      const rig = this.factory.create();
      const rifle = this.gear?.makeRifle('mar556') ?? null;
      const soldier = new Soldier(rig, { team: 'ally', rifle, tint: 0x4ea8e8 });

      const ally = new Ally(soldier, i);
      const a = (i / count) * Math.PI * 2;
      ally.pos.set(playerPos.x + Math.cos(a) * 3.5, 0, playerPos.z + Math.sin(a) * 3.5);
      if (posts?.[i]) {
        ally.post = posts[i];
        ally.pos.copy(ally.post.pos);
        ally.facing = ally.post.facing;
      }
      soldier.root.position.copy(ally.pos);

      // Vuruş kutuları müttefike ait: oyuncunun mermisi onlara zarar vermesin
      for (const m of soldier.hitMeshes) m.userData = { ally, part: m.userData.part };

      this.scene.add(soldier.root);
      this.allies.push(ally);
    }
  }

  clear() {
    for (const a of this.allies) this.scene.remove(a.root);
    this.allies = [];
  }

  get aliveCount() {
    return this.allies.filter((a) => a.alive).length;
  }

  /** Müttefiklerin ateş edebileceği hedefleri döndürür. */
  _pickTarget(ally, enemies) {
    if (ally.post) return this._pickFromPost(ally, enemies);
    let best = null;
    let bestD = this.engageRange;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - ally.pos.x, e.pos.z - ally.pos.z);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /**
   * Pencere başındaki asker: yalnızca penceresinin baktığı yöndeki (±75°)
   * ve arada duvar olmayan düşmanı seçer. Eskiden en yakın düşmanı seçip
   * evin öbür yanına, duvarın içinden ateş ediyordu. Cam engel sayılmaz
   * (asker ateş ederken camını açar).
   */
  _pickFromPost(ally, enemies) {
    const f = ally.post.facing;
    const fx = -Math.sin(f), fz = -Math.cos(f);
    const eye = new THREE.Vector3(ally.pos.x, ally.pos.y + 1.45, ally.pos.z);
    const list = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.pos.x - ally.pos.x, dz = e.pos.z - ally.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > this.engageRange || d < 0.5) continue;
      if ((dx * fx + dz * fz) / d < 0.26) continue;        // pencerenin dışında
      list.push({ e, d });
    }
    list.sort((a, b) => a.d - b.d);
    for (const { e } of list.slice(0, 4)) {
      const to = e.center;
      const dir = to.clone().sub(eye);
      const dist = dir.length();
      this.raycaster.set(eye, dir.normalize());
      this.raycaster.far = dist;
      const hits = this.raycaster.intersectObjects(this.world.solids, false);
      this.raycaster.far = 80;
      if (!hits.some((h) => !h.object.userData?.glass)) return e;
    }
    return null;
  }

  _fire(ally, enemy, now) {
    const from = ally.soldier.muzzleWorld;
    const to = enemy.center;
    const dir = to.clone().sub(from).normalize();

    // Dağılma: her mermi tam isabet etmesin
    dir.x += (Math.random() - 0.5) * 0.045;
    dir.y += (Math.random() - 0.5) * 0.03;
    dir.z += (Math.random() - 0.5) * 0.045;
    dir.normalize();

    ally.soldier.kick();
    this.effects.tracer(from, from.clone().addScaledVector(dir, to.distanceTo(from)), 0x9fd0ff);
    this.audio.shot({ body: 130, crack: 2600, length: 0.14, punch: 0.35 });

    // İsabet: hedefin gövdesine ışın
    this.raycaster.set(from, dir);
    const hit = this.raycaster.intersectObjects(enemy.hitMeshes, false)[0];
    if (hit) {
      const part = hit.object.userData.part ?? 'body';
      this.onEnemyHit?.(enemy, part, hit.point);
      this.effects.hitBurst(hit.point, 0x9fd0ff, 8);
    }
  }

  update(dt, now, player, enemies) {
    for (const ally of this.allies) {
      // Araca binenleri araç taşır ve oynatır (vehicle.js)
      if (ally.aboard) continue;
      // ── Yeniden ayağa kalkma ────────────────────────────────────────
      if (ally.downed) {
        if (now >= ally.reviveAt) {
          ally.downed = false;
          ally.alive = true;
          ally.hp = MAX_HP;
          ally.ammo = 30;
          // Oyuncunun yanında toparlanır
          const a = Math.random() * Math.PI * 2;
          ally.pos.set(player.pos.x + Math.cos(a) * 2.5, 0, player.pos.z + Math.sin(a) * 2.5);
          if (ally.post) ally.pos.copy(ally.post.pos);       // mevziinde toparlanır
        } else {
          ally.soldier.root.position.copy(ally.pos);
          ally.soldier.update({ dt, speed: 0, crouching: true, downed: true, aimPitch: 0 });
          continue;
        }
      }

      if (!ally.reviveAt && !ally.alive) ally.reviveAt = now + REVIVE_TIME;

      // ── Hedef seçimi (saniyede ~3 kez) ──────────────────────────────
      if (now >= ally.nextThink) {
        ally.nextThink = now + 0.3;
        // Hedefe bağlılık: yeni aday belirgin biçimde (%30) yakın değilse
        // eskisi kalır — eşit uzaklıktaki iki düşman arasında gidip gelip
        // asker sürekli dönüyor, tüfeği titriyordu
        const next = this._pickTarget(ally, enemies);
        const old = ally.target;
        const dist = (e) => Math.hypot(e.pos.x - ally.pos.x, e.pos.z - ally.pos.z);
        // (pencere mevziindeki asker hariç: eski hedef penceresinden çıkmış olabilir)
        if (!ally.post && old?.alive && next && next !== old && dist(old) < this.engageRange
          && dist(old) < dist(next) * 1.3) {
          ally.target = old;
        } else {
          ally.target = next;
        }

        if (ally.post) {
          ally.state = 'post';
        } else if (ally.target) {
          // Tehdide karşı mevzi ara; yoksa oyuncunun yanında kal
          const cover = this.world.findCover(ally.pos, ally.target.pos, ally, 22);
          ally.cover = cover;
          ally.state = cover ? 'cover' : 'engage';
        } else {
          if (ally.cover) { ally.cover.taken = null; ally.cover = null; }
          ally.state = 'follow';
        }
      }

      // ── Hedef konum ─────────────────────────────────────────────────
      let goal;
      if (ally.post) {
        goal = ally.post.pos;
      } else if (ally.state === 'cover' && ally.cover) {
        goal = ally.cover.pos;
      } else if (ally.state === 'engage' && ally.target) {
        // Siper yoksa oyuncunun hafif önünde mevzilen
        goal = new THREE.Vector3().lerpVectors(player.pos, ally.target.pos, 0.25);
      } else {
        const a = (ally.index / Math.max(1, this.allies.length)) * Math.PI * 2;
        goal = new THREE.Vector3(
          player.pos.x + Math.cos(a) * 3.2, 0, player.pos.z + Math.sin(a) * 3.2,
        );
      }

      // Oyuncudan çok uzaklaşma
      if (!ally.post && goal.distanceTo(player.pos) > FOLLOW_DIST * 2.2) {
        goal = new THREE.Vector3().lerpVectors(player.pos, goal, 0.5);
      }

      // ── Hareket ─────────────────────────────────────────────────────
      const toGoal = new THREE.Vector3(goal.x - ally.pos.x, 0, goal.z - ally.pos.z);
      const dist = toGoal.length();
      const wantSpeed = dist > 9 ? 6.4 : dist > 1.1 ? 3.4 : 0;

      if (wantSpeed > 0) {
        toGoal.normalize();
        // Basit engel kaçınma
        for (const box of this.world.colliders) {
          if (box.max.y < 0.5) continue;
          const cx = THREE.MathUtils.clamp(ally.pos.x, box.min.x, box.max.x);
          const cz = THREE.MathUtils.clamp(ally.pos.z, box.min.z, box.max.z);
          const dx = ally.pos.x - cx, dz = ally.pos.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 < 1.8 * 1.8 && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            toGoal.x += (dx / d) * (1.8 - d) * 1.2;
            toGoal.z += (dz / d) * (1.8 - d) * 1.2;
          }
        }
        toGoal.normalize();
        ally.vel.lerp(toGoal.multiplyScalar(wantSpeed), Math.min(1, dt * 6));
      } else {
        ally.vel.multiplyScalar(Math.pow(0.02, dt));
      }

      ally.pos.addScaledVector(ally.vel, dt);
      const lim = this.world.half - 2;
      ally.pos.x = THREE.MathUtils.clamp(ally.pos.x, -lim, lim);
      ally.pos.z = THREE.MathUtils.clamp(ally.pos.z, -lim, lim);

      // ── Yönelme: hedefe, yoksa gidiş yönüne ─────────────────────────
      const look = ally.target
        ? new THREE.Vector3(ally.target.pos.x - ally.pos.x, 0, ally.target.pos.z - ally.pos.z)
        : ally.post && dist < 1.1
          ? new THREE.Vector3(-Math.sin(ally.post.facing), 0, -Math.cos(ally.post.facing))
          : new THREE.Vector3(ally.vel.x, 0, ally.vel.z);
      if (look.lengthSq() > 0.01) {
        const want = Math.atan2(-look.x, -look.z);
        let diff = want - ally.facing;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        ally.facing += diff * Math.min(1, dt * 8);
      }

      // ── Ateş ────────────────────────────────────────────────────────
      // Ateş için mevziye varmayı beklemiyoruz: hedef menzildeyse ve
      // koşmuyorsa ateş eder (eskiden mevziye varamayınca hiç ateş etmiyordu).
      const canFire = ally.vel.length() < 5.5;
      if (ally.target && now > ally.reloadUntil && canFire) {
        // Şarjör taramanın ortasında biterse tarama bırakılır; yoksa asker
        // "tarama sürüyor" durumunda takılıp bir daha hiç doldurmuyordu
        // (ilk 30 mermiden sonra müttefikler susuyordu).
        if (ally.burstLeft > 0 && ally.ammo <= 0) ally.burstLeft = 0;
        if (ally.burstLeft > 0) {
          if (now >= ally.nextShot && ally.ammo > 0) {
            ally.burstLeft--;
            ally.ammo--;
            ally.nextShot = now + BURST.interval;
            this._fire(ally, ally.target, now);
            if (ally.burstLeft === 0) ally.nextShot = now + BURST.pause;
          }
        } else if (now >= ally.nextShot) {
          if (ally.ammo <= 0) {
            ally.reloadUntil = now + 2.2;
            ally.ammo = 30;
          } else {
            ally.burstLeft = BURST.shots;
          }
        }
      }

      // ── Görünüm ─────────────────────────────────────────────────────
      ally.root.position.copy(ally.pos);
      ally.root.rotation.y = ally.facing;

      const aimPitch = ally.target
        ? Math.atan2(
          ally.target.center.y - (ally.pos.y + 1.4),
          Math.hypot(ally.target.pos.x - ally.pos.x, ally.target.pos.z - ally.pos.z),
        )
        : 0;

      ally.soldier.setShadowDistance(
        Math.hypot(ally.pos.x - player.pos.x, ally.pos.z - player.pos.z),
      );
      ally.soldier.update({
        dt,
        speed: ally.vel.length(),
        crouching: ally.state === 'cover' && dist < 1.4,
        downed: false,
        aimPitch,
        // Hedef varken tüfek omuzda ve hedefe dönük (koşarken değil)
        aiming: Boolean(ally.target) && canFire,
      });
    }
  }
}
