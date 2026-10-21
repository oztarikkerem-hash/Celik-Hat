/* Taarruz ordusu: 2000 müttefik (5 kol) ve 2500 düşman.

   Binlerce askeri tam modelle çizmek ve yapay zekâyla yürütmek tarayıcıda
   mümkün değil; burada iki katman var:

   1. SİMÜLASYON (bütün askerler): her asker birkaç sayılık bir kayıt
      (tipli diziler). Sokak ızgarasında yürür (binalara girmez), en yakın
      düşmanı ızgara hücrelerinden halka halka arar, belirli aralıkla ateş
      eder; isabet olasılığı mesafe, siper ve hareketle düşer. Saniyede 10
      kez düşünülür, konum her kare ilerler.
   2. GÖRÜNÜM: oyuncunun yakınındaki düşmanlar GERÇEK düşmana (FSB modeli,
      kendi yapay zekâsı, ragdoll) "terfi" eder; yakın müttefikler SWAT
      modeliyle çizilir. Ötekiler tek çizim çağrısıyla (InstancedMesh)
      gerçek modelin resimleri (impostor.js: 8 açı × 12 poz atlası).

   Oyuncunun mermisi uzak düşmanlara `raycast` ile (dikey silindir) değer.

   YÖNETMEN: müttefik kaybı düşman kaybıyla orantılı tutulur; şehir düşünce
   zayiat 500 olsun diye düşmanın isabeti ayarlanır (500'den sonra müttefik
   ölmez), düşmanın son %5'i ancak zayiat 500'e varınca teslim olur.       */

import * as THREE from 'three';
import { CITY } from './city.js';
import { Soldier } from './soldier.js';
import { Ragdoll } from './ragdoll.js';
import { bakeAtlas, impostorMaterial, impostorGeometry, cellIndex, POSE } from './impostor.js';

export const ARMY = {
  allies: 2000,
  enemies: 2500,
  columns: 5,
  lossTarget: 500,       // şehir düştüğünde müttefik zayiatı
  surrenderAt: 0.05,     // düşmanın bu oranı kalınca teslim olur
  cell: 24,              // ızgara hücresi (m)
  drawR: 235,            // örneklenmiş figürlerin çizildiği yarıçap
  promoteR: 48,          // bu yakındaki düşmanlar gerçek düşman olur
  demoteR: 78,
  maxPromoted: 12,
  allyModelR: 40,
  maxAllyModels: 14,
  corpseLife: 90,
};

const ORDER_NAMES = { attack: 'Saldırıyor', cover: 'Siperde', move: 'İşaretli yere gidiyor' };
export { ORDER_NAMES };

/* ── Sokak ızgarası ───────────────────────────────────────────────────── */

const B = CITY.block;
const S = CITY.half + CITY.walk - 0.6;       // yürünebilir sokak yarı genişliği

export class Army {
  /**
   * @param game  Game   @param city  City (O: şehir girişi)
   * @param plan  { tower: Vector3, laneX: [5 sokak x'i], allyZ: [z0, z1], enemyJ: [j0, j1], enemyI: [i0, i1] }
   */
  constructor(game, city, plan) {
    this.game = game;
    this.city = city;
    this.plan = plan;
    this.O = city.O.clone();
    const N = this.N = ARMY.allies + ARMY.enemies;
    this.x = new Float32Array(N); this.z = new Float32Array(N);
    this.gx = new Float32Array(N); this.gz = new Float32Array(N);
    this.ox = new Float32Array(N); this.oz = new Float32Array(N);
    this.h = new Float32Array(N);              // yön (oyuncu yaw'ı gibi: 0 → −Z)
    this.hp = new Float32Array(N);
    this.team = new Uint8Array(N);             // 0 müttefik, 1 düşman
    this.col = new Int16Array(N);              // müttefikte kol, düşmanda grup
    this.alive = new Uint8Array(N);
    this.cover = new Uint8Array(N);
    this.cd = new Float32Array(N);
    this.think = new Float32Array(N);
    this.tgt = new Int32Array(N).fill(-1);
    this.phase = new Float32Array(N);
    this.spd = new Float32Array(N);
    this.prom = new Int16Array(N).fill(-1);
    this.deadAt = new Float32Array(N);
    this.model = new Int16Array(N).fill(-1);   // yakın müttefik: SWAT model yuvası

    this.deadA = 0; this.deadE = 0;
    this.accA = 1; this.accE = 1;
    this.columns = [];
    this.groups = [];
    this.promoted = [];                        // yuva → { i, e }
    this.allyModels = [];                      // yuva → { i, s, ragdoll? }
    this.marker = null;
    this.surrendered = false;
    this._shotsThisFrame = 0;
    this._sounds = 0;
    this._lastThinkIdx = 0;

    this._buildMeshes();
    this._deploy();
    this._grid();
  }

  /* ── Kurulum ─────────────────────────────────────────────────────── */

  /* Uzaktaki askerler gerçek modelin resimleri (impostor.js): her takımın
     modeli bir kez 8 açı × 12 pozdan atlasa çizilir, askerler kameraya
     dönük kartlarda uygun kareyi gösterir. (Eskiden kutulardan yapılmış
     figürlerdi; oyuncu "grafikleri çok kötü" dedi.)                       */
  _buildMeshes() {
    const g = this.game, scene = g.scene;
    const mk = (factory, rifle, cap) => {
      const atlas = bakeAtlas(g, factory, rifle);
      const geo = impostorGeometry();
      const cell = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      cell.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aCell', cell);
      const m = new THREE.InstancedMesh(geo, impostorMaterial(atlas), cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      scene.add(m);
      return m;
    };
    this.meshA = mk(g.soldiers, g.gear?.makeRifle('mar556') ?? null, ARMY.allies + 400);
    this.meshE = mk(g.enemySoldiers ?? g.soldiers, g.gear?.makeRifle('mar556') ?? null, ARMY.enemies + 400);
  }

  dispose() {
    const g = this.game;
    for (const m of [this.meshA, this.meshE]) {
      g.scene.remove(m);
      m.geometry.dispose();
      m.material.map?.dispose();
      m.material.dispose();
    }
    for (const p of this.promoted) if (p) g.enemies.despawn(p.e);
    for (const a of this.allyModels) {
      if (!a) continue;
      a.ragdoll?.dispose();
      g.scene.remove(a.s.root);
    }
    this.promoted = [];
    this.allyModels = [];
  }

  /** Bir noktayı en yakın sokağa çeker (bina içine hedef verilmesin). */
  streetClamp(x, z) {
    const O = this.O;
    const ax = O.x + Math.round((x - O.x) / B) * B, az = O.z - Math.round((O.z - z) / B) * B;
    const dx = x - ax, dz = z - az;
    if (Math.abs(dx) < S || Math.abs(dz) < S) return [x, z];
    return Math.abs(dx) < Math.abs(dz) ? [ax + Math.sign(dx) * (S - 0.3), z] : [x, az + Math.sign(dz) * (S - 0.3)];
  }

  _deploy() {
    const P = this.plan;
    let n = 0;
    // ── Müttefik kolları: her biri bir kuzey-güney sokağında 400 asker ──
    const per = Math.floor(ARMY.allies / ARMY.columns);
    for (let c = 0; c < ARMY.columns; c++) {
      const lx = P.laneX[c];
      this.columns.push({ order: 'attack', target: new THREE.Vector3(lx, 0, P.tower.z), alive: per });
      for (let k = 0; k < per; k++) {
        const i = n++;
        this.team[i] = 0; this.col[i] = c; this.alive[i] = 1; this.hp[i] = 100;
        // 5 sıra yan yana, 1.9 m arayla dizilir
        const row = Math.floor(k / 5), file = k % 5;
        this.x[i] = lx + (file - 2) * 1.9 + (Math.random() - 0.5) * 0.6;
        this.z[i] = P.allyZ[0] + row * 1.9 + Math.random() * 0.6;   // ön sıra kuzeyde, kol güneye uzanır
        this.ox[i] = (file - 2) * 1.6 + (Math.random() - 0.5);
        this.oz[i] = row * 0.55;
        this.h[i] = 0;
        this.phase[i] = Math.random() * 6.28;
        this.cd[i] = Math.random() * 2;
        this.think[i] = Math.random() * 0.8;
      }
    }
    this.allyEnd = n;
    // ── Düşman: kavşaklarda ve sokak ortalarında 8–16 kişilik gruplar ──
    const [j0, j1] = P.enemyJ, [i0, i1] = P.enemyI;
    const spots = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = this.O.x + i * B, cz = this.O.z - j * B;
      spots.push([cx, cz, j]);                                   // kavşak
      if (Math.random() < 0.55) spots.push([cx, cz - B / 2, j + 0.5]);   // kuzey-güney sokağı ortası
      if (Math.random() < 0.45) spots.push([cx + B / 2, cz, j]);         // doğu-batı sokağı ortası
    }
    // Kuleye yakın mevziler daha kalabalık
    const tw = P.tower;
    spots.sort(() => Math.random() - 0.5);
    let left = ARMY.enemies;
    let gi = 0;
    while (left > 0) {
      const [sx, sz] = spots[gi % spots.length];
      const nearTower = Math.hypot(sx - tw.x, sz - tw.z) < 260;
      const size = Math.min(left, (nearTower ? 14 : 8) + Math.floor(Math.random() * 8));
      const counter = !nearTower && Math.random() < 0.28;
      const grp = { x: sx, z: sz, counter, active: false };
      this.groups.push(grp);
      for (let k = 0; k < size; k++) {
        const i = n++;
        this.team[i] = 1; this.col[i] = this.groups.length - 1; this.alive[i] = 1; this.hp[i] = 100;
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 9;
        const [px, pz] = this.streetClamp(sx + Math.cos(a) * r, sz + Math.sin(a) * r);
        this.x[i] = px; this.z[i] = pz;
        this.gx[i] = px; this.gz[i] = pz;
        this.ox[i] = Math.cos(a) * r; this.oz[i] = Math.sin(a) * r;
        this.h[i] = Math.PI;                                       // güneye bakar
        this.cover[i] = Math.random() < 0.6 ? 1 : 0;
        this.phase[i] = Math.random() * 6.28;
        this.cd[i] = Math.random() * 2;
        this.think[i] = Math.random() * 0.8;
      }
      left -= size;
      gi++;
    }
    this.N = n;
    for (let c = 0; c < ARMY.columns; c++) this.order(c, 'attack');
  }

  /* ── Emirler ─────────────────────────────────────────────────────── */

  /**
   * @param c      kol (0–4) ya da -1 = bütün kollar
   * @param order  'attack' | 'cover' | 'move'
   * @param at     'move' için hedef (dünya)
   */
  order(c, order, at = null) {
    if (c < 0) { for (let k = 0; k < ARMY.columns; k++) this.order(k, order, at); return; }
    const col = this.columns[c];
    col.order = order;
    if (order === 'move' && at) {
      const [mx, mz] = this.streetClamp(at.x, at.z);
      col.target = new THREE.Vector3(mx, 0, mz);
    }
    if (order === 'attack') col.target = new THREE.Vector3(this.plan.laneX[c], 0, this.plan.tower.z);
    for (let i = 0; i < this.allyEnd; i++) {
      if (this.col[i] !== c || !this.alive[i]) continue;
      this.cover[i] = order === 'cover' ? 1 : 0;
      this._personalGoal(i);
    }
  }

  _personalGoal(i) {
    const col = this.columns[this.col[i]];
    if (col.order === 'cover') { this.gx[i] = this.x[i]; this.gz[i] = this.z[i]; return; }
    const t = col.target;
    // Kol hedefin etrafına yayılır: saldırıda sokak boyunca, işaretli yerde halka
    const spread = col.order === 'move' ? 1 : 0.4;
    const [px, pz] = this.streetClamp(t.x + this.ox[i] * 2.2 * spread, t.z + this.oz[i] * 6 * spread);
    this.gx[i] = px; this.gz[i] = pz;
  }

  /* Saldırıdaki kol kuleye varınca ya da önünde düşman kalmayınca durup
     beklemesin: en yakın düşmana (kuleye yakın olanlar öncelikli) yönelir. */
  _retarget() {
    if (this.surrendered) return;
    const tw = this.plan.tower;
    for (let c = 0; c < this.columns.length; c++) {
      const col = this.columns[c];
      if (col.order !== 'attack') continue;
      const info = this.columnInfo(c);
      if (!info.n) continue;
      let best = -1, bs = Infinity;
      for (let i = this.allyEnd; i < this.N; i++) {
        if (!this.alive[i]) continue;
        const d = Math.hypot(this.x[i] - info.x, this.z[i] - info.z);
        const s = d + 0.35 * Math.hypot(this.x[i] - tw.x, this.z[i] - tw.z);
        if (s < bs) { bs = s; best = i; }
      }
      if (best < 0) continue;
      const [tx, tz] = this.streetClamp(this.x[best], this.z[best]);
      if (Math.hypot(tx - col.target.x, tz - col.target.z) < 25) continue;
      col.target.set(tx, 0, tz);
      for (let i = 0; i < this.allyEnd; i++) {
        if (this.col[i] === c && this.alive[i]) this._personalGoal(i);
      }
    }
  }

  /** Bir kolun ağırlık merkezi ve yaşayan asker sayısı. */
  columnInfo(c) {
    let sx = 0, sz = 0, n = 0;
    for (let i = 0; i < this.allyEnd; i++) {
      if (this.col[i] !== c || !this.alive[i]) continue;
      sx += this.x[i]; sz += this.z[i]; n++;
    }
    return { n, x: n ? sx / n : 0, z: n ? sz / n : 0, order: this.columns[c].order };
  }

  get enemyAlive() { return this.surrendered ? 0 : ARMY.enemies - this.deadE; }
  get allyAlive() { return ARMY.allies - this.deadA; }

  /* ── Izgara ──────────────────────────────────────────────────────── */

  _grid() {
    const C = ARMY.cell;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.N; i++) {
      minX = Math.min(minX, this.x[i]); maxX = Math.max(maxX, this.x[i]);
      minZ = Math.min(minZ, this.z[i]); maxZ = Math.max(maxZ, this.z[i]);
    }
    // Savaş alanı + pay (kollar ilerledikçe dışarı taşmasın)
    this.gx0 = minX - 600; this.gz0 = minZ - 600;
    this.gw = Math.ceil((maxX - minX + 1200) / C);
    this.gh = Math.ceil((maxZ - minZ + 1200) / C);
    this.head = new Int32Array(this.gw * this.gh);
    this.next = new Int32Array(this.N);
    this._rebuildGrid();
  }

  _cellIdx(x, z) {
    const C = ARMY.cell;
    const cx = Math.min(this.gw - 1, Math.max(0, Math.floor((x - this.gx0) / C)));
    const cz = Math.min(this.gh - 1, Math.max(0, Math.floor((z - this.gz0) / C)));
    return cz * this.gw + cx;
  }

  _rebuildGrid() {
    this.head.fill(-1);
    for (let i = 0; i < this.N; i++) {
      if (!this.alive[i]) continue;
      const c = this._cellIdx(this.x[i], this.z[i]);
      this.next[i] = this.head[c];
      this.head[c] = i;
    }
  }

  /** En yakın karşı taraf askeri (halka halka, R içinde). */
  _nearestFoe(i, R) {
    const C = ARMY.cell, foe = 1 - this.team[i];
    const cx = Math.floor((this.x[i] - this.gx0) / C), cz = Math.floor((this.z[i] - this.gz0) / C);
    const rings = Math.ceil(R / C);
    let best = -1, bd = R * R;
    for (let r = 0; r <= rings; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const gx = cx + dx, gz = cz + dz;
        if (gx < 0 || gz < 0 || gx >= this.gw || gz >= this.gh) continue;
        for (let j = this.head[gz * this.gw + gx]; j >= 0; j = this.next[j]) {
          if (this.team[j] !== foe) continue;
          const ddx = this.x[j] - this.x[i], ddz = this.z[j] - this.z[i];
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < bd) { bd = d2; best = j; }
        }
      }
      // Bu halkada bulduysak bir dış halka daha bakmak yeter
      if (best >= 0 && (r + 1) * C > Math.sqrt(bd) + C) break;
    }
    return best;
  }

  /* ── Ölüm ve hasar ───────────────────────────────────────────────── */

  /** Askere hasar (terfi etmiş düşmanda gerçek düşmana). */
  damage(i, dmg, dir, now, byPlayer = false, part = 'body') {
    if (!this.alive[i]) return false;
    const p = this.prom[i];
    if (p >= 0) {
      const e = this.promoted[p].e;
      if (!e.alive) return false;
      if (e.hurt(dmg)) {
        e._killedBy = byPlayer ? e._killedBy : { ally: true };
        this.game.enemies.kill(e, now, dir ?? new THREE.Vector3(0, 0, 1), { part, force: 30 });
      }
      return !e.alive;
    }
    this.hp[i] -= dmg;
    if (this.hp[i] > 0) return false;
    this._die(i, now, dir);
    return true;
  }

  _die(i, now, dir) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.deadAt[i] = now;
    if (this.team[i] === 0) { this.deadA++; this.columns[this.col[i]].alive--; } else this.deadE++;
    // Yere düşüş yönü: vuruş yönünde
    if (dir) this.h[i] = Math.atan2(dir.x, dir.z);
    const m = this.model[i];
    if (m >= 0) {
      // Yakındaki müttefik modeli gerçek ragdoll ile yığılır
      const slot = this.allyModels[m];
      slot.ragdoll = new Ragdoll(this.game.physics, slot.s, this.game.scene, { dir, force: 28, velocity: new THREE.Vector3() });
      slot.until = now + 25;
      this.model[i] = -1;
      slot.i = -1;
      this.deadAt[i] = -1e9;          // cesedi ragdoll taşır, figür çizilmez
    }
  }

  /* ── Döngü ───────────────────────────────────────────────────────── */

  update(dt, now) {
    const g = this.game;
    this._shotsThisFrame = 0;
    this._sounds = 0;
    this._syncPromoted(now);
    this._move(dt);
    // Izgara ve düşünme saniyede 10 kez; düşünme askerlere yayılır
    this._acc = (this._acc ?? 0) + dt;
    if (this._acc >= 0.1) {
      const step = this._acc;
      this._acc = 0;
      this._rebuildGrid();
      this._director();
      this._thinkAll(now, step);
    }
    if (now > (this._promAt ?? 0)) { this._promAt = now + 0.25; this._promote(now); this._allyModelsPick(); }
    if (now > (this._retargetAt ?? 0)) { this._retargetAt = now + 4; this._retarget(); }
    this._updateAllyModels(dt, now);
    this._draw(g.camera.position, now);
  }

  /** Kayıp dengesi (bkz. dosya başı). */
  _director() {
    const fracE = this.deadE / ARMY.enemies;
    const want = ARMY.lossTarget * Math.min(1, fracE / (1 - ARMY.surrenderAt));
    const diff = want - this.deadA;
    this.accE = this.deadA >= ARMY.lossTarget ? 0 : THREE.MathUtils.clamp(1 + diff / 22, 0.12, 4);
    // Düşmanın son %5'i zayiat hedefine varılmadan bitmesin
    const last = this.enemyAlive <= ARMY.enemies * ARMY.surrenderAt;
    this.accA = last && this.deadA < ARMY.lossTarget ? 0.15 : 1;
  }

  /** Sokak ızgarasında hedefe yön (birim) — binalara girmeden. */
  _route(i, out) {
    const O = this.O;
    const x = this.x[i], z = this.z[i];
    const tx = this.gx[i] - x, tz = this.gz[i] - z;
    if (tx * tx + tz * tz < 2.5) { out[0] = 0; out[1] = 0; return; }
    const ax = O.x + Math.round((x - O.x) / B) * B, az = O.z - Math.round((O.z - z) / B) * B;
    const inNS = Math.abs(x - ax) < S, inEW = Math.abs(z - az) < S;
    let dx = tx, dz = tz;
    const far = Math.abs(tx) > S * 0.8 && Math.abs(tz) > S * 0.8;
    if (inNS && inEW && far) {
      // Kavşak: çapraz gitmek sokaktan çıkarıp geri döndürüyordu (salınım).
      // Hedefin sokağındaysak o sokak boyunca, değilsek önce hedefin
      // doğu-batı sokağına kadar kuzey-güney ilerle.
      const gzS = O.z - Math.round((O.z - this.gz[i]) / B) * B;
      const gxS = O.x + Math.round((this.gx[i] - O.x) / B) * B;
      if (Math.abs(az - gzS) < 1) { dx = tx; dz = (az - z) * 0.4; }
      else if (Math.abs(ax - gxS) < 1) { dz = tz; dx = (ax - x) * 0.4; }
      else { dz = gzS - z; dx = (ax - x) * 0.4; }
    } else if (inNS && !inEW && Math.abs(tx) > S * 0.8) {
      // Kuzey-güney sokağındayız, hedef başka sokakta: hedefe en yakın
      // doğu-batı sokağına kadar ilerle
      const zt = O.z - Math.round((O.z - this.gz[i]) / B) * B;
      dx = (ax - x) * 0.4; dz = zt - z;
      if (Math.abs(dz) < 1) dx = tx;
    } else if (inEW && !inNS && Math.abs(tz) > S * 0.8) {
      const xt = O.x + Math.round((this.gx[i] - O.x) / B) * B;
      dz = (az - z) * 0.4; dx = xt - x;
      if (Math.abs(dx) < 1) dz = tz;
    } else if (!inNS && !inEW) {
      // Arsaya taşmış: en yakın sokağa dön
      if (Math.abs(x - ax) < Math.abs(z - az)) { dx = ax - x; dz = 0; } else { dz = az - z; dx = 0; }
    }
    const l = Math.hypot(dx, dz) || 1;
    out[0] = dx / l; out[1] = dz / l;
  }

  _move(dt) {
    const dir = [0, 0];
    const O = this.O;
    for (let i = 0; i < this.N; i++) {
      if (!this.alive[i] || this.prom[i] >= 0) continue;
      const ally = this.team[i] === 0;
      let v = 0;
      if (!this.cover[i] || (ally && this.columns[this.col[i]].order === 'move')) {
        const t = this.tgt[i];
        const engaged = t >= 0 || t === -2;
        const td = t >= 0 ? Math.hypot(this.x[t] - this.x[i], this.z[t] - this.z[i]) : 999;
        if (ally) {
          const ord = this.columns[this.col[i]].order;
          v = ord === 'move' ? (engaged ? 2.2 : 3.8) : (engaged ? (td < 42 ? 0 : 1.0) : 3.5);
        } else {
          v = this.groups[this.col[i]].active ? (engaged ? (td < 38 ? 0 : 1.1) : 2.8) : 0;
        }
      }
      if (v > 0) {
        this._route(i, dir);
        if (dir[0] === 0 && dir[1] === 0) v = 0;
        else {
          this.x[i] += dir[0] * v * dt;
          this.z[i] += dir[1] * v * dt;
          // Sokakta kal
          const ax = O.x + Math.round((this.x[i] - O.x) / B) * B, az = O.z - Math.round((O.z - this.z[i]) / B) * B;
          const ex = this.x[i] - ax, ez = this.z[i] - az;
          if (Math.abs(ex) >= S && Math.abs(ez) >= S) {
            if (Math.abs(ex) - S < Math.abs(ez) - S) this.x[i] = ax + Math.sign(ex) * (S - 0.05);
            else this.z[i] = az + Math.sign(ez) * (S - 0.05);
          }
          const want = Math.atan2(-dir[0], -dir[1]);
          this.h[i] += Math.atan2(Math.sin(want - this.h[i]), Math.cos(want - this.h[i])) * Math.min(1, dt * 6);
        }
      }
      if (v === 0) {
        // Dururken hedefe döner
        const t = this.tgt[i];
        let fx = 0, fz = 0;
        if (t >= 0) { fx = this.x[t] - this.x[i]; fz = this.z[t] - this.z[i]; }
        else if (t === -2) { const p = this.game.player.pos; fx = p.x - this.x[i]; fz = p.z - this.z[i]; }
        if (fx || fz) {
          const want = Math.atan2(-fx, -fz);
          this.h[i] += Math.atan2(Math.sin(want - this.h[i]), Math.cos(want - this.h[i])) * Math.min(1, dt * 5);
        }
      }
      this.spd[i] = v;
      // Koşu klibi ~6.2 m/sn'de 0.7 sn: adım evresi hızla orantılı
      this.phase[i] += v * dt * 1.45;
    }
  }

  _thinkAll(now, step) {
    const g = this.game;
    const p = g.player.pos;
    for (let i = 0; i < this.N; i++) {
      if (!this.alive[i]) continue;
      const ally = this.team[i] === 0;
      if (now >= this.think[i]) {
        this.think[i] = now + 0.5 + Math.random() * 0.4;
        // Savunan mevzide: menzili saldıranınkinden uzun (yoksa kollar onları
        // menzil dışından vurup kayıpsız geçiyordu)
        const R = ally ? 105 : 120;
        let t = this._nearestFoe(i, R);
        // Düşman oyuncuyu da hedef alabilir (görüyorsa)
        if (!ally && !this.surrendered) {
          const dp = Math.hypot(p.x - this.x[i], p.z - this.z[i]);
          const td = t >= 0 ? Math.hypot(this.x[t] - this.x[i], this.z[t] - this.z[i]) : 999;
          if (dp < 75 && dp < td * 1.15 && Math.random() < 0.45 && this._sees(i)) t = -2;
          // Grup uyanır: müttefik 220 m'ye girince karşı taarruz grupları yürür
          const grp = this.groups[this.col[i]];
          // Karşı taarruz grubu: müttefik 220 m'ye girince uyanır (geniş arama)
          if (!grp.active && grp.counter && (td < 220 || this._nearestFoe(i, 220) >= 0)) grp.active = true;
          if (grp.active) this.cover[i] = 0;
          if (grp.active && t >= 0 && this.prom[i] < 0) {
            const [px, pz] = this.streetClamp(this.x[t], this.z[t]);
            this.gx[i] = px; this.gz[i] = pz;
          }
        }
        this.tgt[i] = t;
      }
      if (this.surrendered && !ally) continue;
      const t = this.tgt[i];
      if (t === -1 || now < this.cd[i]) continue;
      if (t >= 0 && !this.alive[t]) { this.tgt[i] = -1; continue; }
      this.cd[i] = now + 0.8 + Math.random() * 1.2;
      if (t === -2) this._fireAtPlayer(i, now);
      else this._fire(i, t, now);
    }
  }

  /** Düşman askeri oyuncuyu görüyor mu (binalar engeller). */
  _sees(i) {
    const g = this.game, p = g.player.pos;
    const from = new THREE.Vector3(this.x[i], 1.5, this.z[i]);
    const to = new THREE.Vector3(p.x, p.y + 1.4, p.z);
    const d = to.clone().sub(from);
    const len = d.length();
    g.raycaster.set(from, d.divideScalar(len));
    g.raycaster.far = len;
    const hit = g.raycaster.intersectObjects(g.world.solids, false)[0];
    g.raycaster.far = 260;
    return !hit;
  }

  _fire(i, t, now) {
    const d = Math.hypot(this.x[t] - this.x[i], this.z[t] - this.z[i]);
    const ally = this.team[i] === 0;
    let p = (ally ? 0.21 : 0.17) * THREE.MathUtils.clamp(1.25 - d / 110, 0.12, 1);
    if (this.cover[t]) p *= 0.35;
    if (this.spd[i] > 0.5) p *= 0.6;
    p *= ally ? this.accA : this.accE;
    const hit = Math.random() < p;
    this._visual(i, t, hit, now);
    if (hit) {
      const dir = new THREE.Vector3(this.x[t] - this.x[i], 0, this.z[t] - this.z[i]).normalize();
      this.damage(t, 45 + Math.random() * 40, dir, now);
    }
  }

  _fireAtPlayer(i, now) {
    const g = this.game, p = g.player.pos;
    const d = Math.hypot(p.x - this.x[i], p.z - this.z[i]);
    if (d > 85) return;
    // Oyuncuya isabet: yoğun ama hayatta kalınabilir (son 3 sn'de alınan
    // hasar arttıkça uzaktakilerin isabeti düşer)
    this._hurtWin = (this._hurtWin ?? 0) * Math.exp(-(now - (this._hurtAt ?? now)) / 3);
    this._hurtAt = now;
    let pr = 0.07 * THREE.MathUtils.clamp(1.2 - d / 80, 0.2, 1) / (1 + this._hurtWin / 25);
    if (g.player.crouching) pr *= 0.6;
    const hit = Math.random() < pr;
    const from = new THREE.Vector3(this.x[i], 1.35, this.z[i]);
    const to = new THREE.Vector3(p.x, p.y + 1.2, p.z);
    if (!hit) to.add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 1.4, (Math.random() - 0.5) * 3));
    g.effects.tracer(from, to, 0xffb070);
    if (hit) {
      const dmg = 7 + Math.random() * 5;
      this._hurtWin += dmg;
      g._onPlayerHit(dmg, Math.random() < 0.12 ? 'head' : 'body');
    } else if (d < 40) g.audio.whiz?.();
  }

  /** İz mermisi ve uzak silah sesi (oyuncunun yakınında, kare başına sınırlı). */
  _visual(i, t, hit, now) {
    const g = this.game, cam = g.camera.position;
    const dx = this.x[i] - cam.x, dz = this.z[i] - cam.z;
    const d = Math.hypot(dx, dz);
    if (d > 230) return;
    if (this._sounds < 3) { this._sounds++; g.audio.distantShot?.(d); }
    if (this._shotsThisFrame >= 14) return;
    this._shotsThisFrame++;
    let from;
    const m = this.model[i];
    if (m >= 0) from = this.allyModels[m].s.muzzleWorld;
    else if (this.prom[i] >= 0) from = this.promoted[this.prom[i]].e.muzzleWorld;
    else {
      const f = this.h[i];
      from = new THREE.Vector3(this.x[i] - Math.sin(f) * 0.8, this.cover[i] ? 0.95 : 1.33, this.z[i] - Math.cos(f) * 0.8);
    }
    const to = new THREE.Vector3(this.x[t], this.cover[t] ? 0.8 : 1.2, this.z[t]);
    if (!hit) to.add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4));
    g.effects.tracer(from, to, this.team[i] === 0 ? 0xffd27a : 0xffa060);
  }

  /* ── Terfi: yakındaki düşman gerçek düşman olur ─────────────────── */

  _promote(now) {
    if (this.surrendered) return;
    const g = this.game, p = g.player.pos;
    // Uzaklaşanlar geri örneklenmiş figüre döner
    for (let k = 0; k < this.promoted.length; k++) {
      const s = this.promoted[k];
      if (!s) continue;
      const i = s.i;
      if (s.e.alive && Math.hypot(s.e.pos.x - p.x, s.e.pos.z - p.z) > ARMY.demoteR) {
        this.x[i] = s.e.pos.x; this.z[i] = s.e.pos.z;
        g.enemies.despawn(s.e);
        this.prom[i] = -1;
        this.promoted[k] = null;
      }
    }
    let count = this.promoted.filter(Boolean).length;
    if (count >= ARMY.maxPromoted) return;
    const cand = [];
    for (let i = this.allyEnd; i < this.N; i++) {
      if (!this.alive[i] || this.prom[i] >= 0) continue;
      const d = Math.hypot(this.x[i] - p.x, this.z[i] - p.z);
      if (d < ARMY.promoteR) cand.push([d, i]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (const [, i] of cand) {
      if (count >= ARMY.maxPromoted) break;
      const e = g.enemies.spawnAt(Math.random() < 0.2 ? 'brute' : 'runner', new THREE.Vector3(this.x[i], 0, this.z[i]), 1);
      e.facing = this.h[i];
      e.hp = Math.max(30, this.hp[i] * 1.2);
      e.army = i;
      let k = this.promoted.indexOf(null);
      if (k < 0) { k = this.promoted.length; this.promoted.push(null); }
      this.promoted[k] = { i, e };
      this.prom[i] = k;
      count++;
    }
  }

  _syncPromoted(now) {
    for (let k = 0; k < this.promoted.length; k++) {
      const s = this.promoted[k];
      if (!s) continue;
      const i = s.i;
      if (!s.e.alive) {
        // Gerçek düşman öldü (oyuncu ya da istatistik): kayıt da ölür;
        // cesedi ragdoll taşıdığı için örneklenmiş ceset çizilmez
        if (this.alive[i]) { this._die(i, now, null); }
        this.deadAt[i] = -1e9;
        this.prom[i] = -1;
        this.promoted[k] = null;
        continue;
      }
      this.x[i] = s.e.pos.x; this.z[i] = s.e.pos.z; this.h[i] = s.e.facing;
    }
  }

  /** Teslim: kalan düşmanlar silah bırakır (sahneden çekilir). */
  surrender() {
    this.surrendered = true;
    const g = this.game;
    for (let k = 0; k < this.promoted.length; k++) {
      const s = this.promoted[k];
      if (!s) continue;
      g.enemies.despawn(s.e);
      this.prom[s.i] = -1;
      this.promoted[k] = null;
    }
    for (let i = this.allyEnd; i < this.N; i++) {
      if (!this.alive[i]) continue;
      this.alive[i] = 0;
      this.deadAt[i] = -1e9;          // ceset değil: çekildi
    }
    for (let i = 0; i < this.allyEnd; i++) this.tgt[i] = -1;
  }

  /* ── Yakın müttefikler: SWAT modeli ─────────────────────────────── */

  _allyModelsPick() {
    const g = this.game, p = g.player.pos;
    if (!g.soldiers?.template) return;
    // Uzaklaşanı bırak
    for (const slot of this.allyModels) {
      if (!slot || slot.ragdoll || slot.i < 0) continue;
      const i = slot.i;
      if (!this.alive[i] || Math.hypot(this.x[i] - p.x, this.z[i] - p.z) > ARMY.allyModelR + 12) {
        this.model[i] = -1;
        slot.i = -1;
        slot.s.root.visible = false;
      }
    }
    const cand = [];
    for (let i = 0; i < this.allyEnd; i++) {
      if (!this.alive[i] || this.model[i] >= 0) continue;
      const d = Math.hypot(this.x[i] - p.x, this.z[i] - p.z);
      if (d < ARMY.allyModelR) cand.push([d, i]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (const [, i] of cand) {
      let k = this.allyModels.findIndex((s) => s && s.i < 0 && !s.ragdoll);
      if (k < 0) {
        if (this.allyModels.length >= ARMY.maxAllyModels) break;
        const rig = g.soldiers.create();
        const s = new Soldier(rig, { team: 'ally', rifle: g.gear?.makeRifle('mar556') ?? null, tint: null });
        for (const m of s.hitMeshes) m.userData = {};
        g.scene.add(s.root);
        k = this.allyModels.length;
        this.allyModels.push({ s, i: -1 });
      }
      const slot = this.allyModels[k];
      slot.i = i;
      slot.s.root.visible = true;
      this.model[i] = k;
    }
  }

  _updateAllyModels(dt, now) {
    const g = this.game;
    for (let k = 0; k < this.allyModels.length; k++) {
      const slot = this.allyModels[k];
      if (!slot) continue;
      if (slot.ragdoll) {
        slot.ragdoll.update(dt);
        if (now > slot.until) {
          // Ceset süresi doldu: model yeni bir asker için havuza döner
          slot.ragdoll.dispose();
          g.scene.remove(slot.s.root);
          this.allyModels[k] = null;
          this.allyModels.splice(k, 1);
          // dizinler kaydı: model[] yuvaları yeniden yazılır
          for (let i = 0; i < this.allyEnd; i++) if (this.model[i] > k) this.model[i]--;
          k--;
        }
        continue;
      }
      const i = slot.i;
      if (i < 0) continue;
      const s = slot.s;
      s.root.position.set(this.x[i], 0, this.z[i]);
      s.root.rotation.y = this.h[i];
      const t = this.tgt[i];
      s.setShadowDistance(Math.hypot(this.x[i] - g.player.pos.x, this.z[i] - g.player.pos.z));
      s.update({
        dt, speed: this.spd[i], crouching: Boolean(this.cover[i]), downed: false,
        aimPitch: 0, aiming: t >= 0 && this.spd[i] < 0.5,
      });
    }
  }

  /* ── Çizim ───────────────────────────────────────────────────────── */

  _draw(cam, now) {
    const R2 = ARMY.drawR * ARMY.drawR;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    const pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    let na = 0, ne = 0;
    const cellA = this.meshA.geometry.attributes.aCell, cellE = this.meshE.geometry.attributes.aCell;
    const capA = cellA.count, capE = cellE.count;
    const TAU = Math.PI * 2;
    for (let i = 0; i < this.N; i++) {
      if (this.prom[i] >= 0 || this.model[i] >= 0) continue;
      const dx = this.x[i] - cam.x, dz = this.z[i] - cam.z;
      if (dx * dx + dz * dz > R2) continue;
      const ally = this.team[i] === 0;
      const live = this.alive[i];
      if (!live && now - this.deadAt[i] > ARMY.corpseLife) continue;
      const mesh = ally ? this.meshA : this.meshE, cells = ally ? cellA : cellE;
      const n = ally ? na : ne;
      if (n >= (ally ? capA : capE)) continue;
      // Kart kameraya döner (yalnızca dikey eksende); kare askerin kameraya
      // göre açısından ve pozundan seçilir
      const view = Math.atan2(-dx, -dz);
      let frame;
      if (!live) frame = POSE.dead;
      else if (this.cover[i]) frame = POSE.crouch;
      else if (this.spd[i] > 0.3) frame = POSE.run + (Math.floor(((this.phase[i] % TAU) + TAU) % TAU / TAU * 8) % 8);
      else frame = this.tgt[i] !== -1 ? POSE.aim : POSE.idle;
      cells.setX(n, cellIndex(this.h[i], view, frame));
      q.setFromAxisAngle(up, view);
      pos.set(this.x[i], 0, this.z[i]);
      m4.compose(pos, q, one);
      mesh.setMatrixAt(n, m4);
      if (ally) na++; else ne++;
    }
    this.meshA.count = na; this.meshE.count = ne;
    for (const [m, c] of [[this.meshA, cellA], [this.meshE, cellE]]) {
      m.instanceMatrix.needsUpdate = true;
      c.needsUpdate = true;
    }
  }

  /* ── Oyuncunun mermisi ───────────────────────────────────────────── */

  /**
   * Işının ilk değdiği (örneklenmiş) düşman askeri.
   * @returns { i, dist, point, part } | null
   */
  raycast(origin, dir, maxDist = 250) {
    const C = ARMY.cell;
    const seen = new Set();
    let best = null;
    const hx = Math.hypot(dir.x, dir.z) || 1e-6;
    for (let t = 0; t <= maxDist; t += C * 0.5) {
      const px = origin.x + dir.x * t, pz = origin.z + dir.z * t;
      const cx = Math.floor((px - this.gx0) / C), cz = Math.floor((pz - this.gz0) / C);
      for (let dz = -1; dz <= 1; dz++) for (let dxc = -1; dxc <= 1; dxc++) {
        const gx = cx + dxc, gz = cz + dz;
        if (gx < 0 || gz < 0 || gx >= this.gw || gz >= this.gh) continue;
        const c = gz * this.gw + gx;
        if (seen.has(c)) continue;
        seen.add(c);
        for (let j = this.head[c]; j >= 0; j = this.next[j]) {
          if (this.team[j] !== 1 || !this.alive[j] || this.prom[j] >= 0) continue;
          // Dikey silindir (r 0.38) ile yatay en yakın yaklaşma
          const ox = this.x[j] - origin.x, oz = this.z[j] - origin.z;
          const along = (ox * dir.x + oz * dir.z) / (hx * hx);     // 3B ışın parametresi
          if (along < 0 || along > maxDist) continue;
          const cxp = origin.x + dir.x * along - this.x[j], czp = origin.z + dir.z * along - this.z[j];
          if (cxp * cxp + czp * czp > 0.38 * 0.38) continue;
          const y = origin.y + dir.y * along;
          const top = this.cover[j] ? 1.3 : 1.82;
          if (y < 0 || y > top) continue;
          if (!best || along < best.dist) {
            best = { i: j, dist: along, point: new THREE.Vector3(origin.x + dir.x * along, y, origin.z + dir.z * along), part: y > top - 0.3 ? 'head' : y < top * 0.5 ? 'leg' : 'body' };
          }
        }
      }
      if (best && best.dist < t - C) break;
    }
    return best;
  }

  /* ── Mini harita ─────────────────────────────────────────────────── */

  /** Mini harita katmanı: yakın askerler nokta, kollar numara, işaret. */
  drawMinimap(g, toMap, R, range, player) {
    const r2 = (range + 5) * (range + 5);
    for (let i = 0; i < this.N; i++) {
      if (!this.alive[i] || this.prom[i] >= 0) continue;
      const dx = this.x[i] - player.pos.x, dz = this.z[i] - player.pos.z;
      if (dx * dx + dz * dz > r2) continue;
      const [mx, my] = toMap(this.x[i], this.z[i]);
      g.fillStyle = this.team[i] === 0 ? 'rgba(111,183,255,0.75)' : 'rgba(200,67,42,0.8)';
      g.fillRect(mx - 1.2, my - 1.2, 2.4, 2.4);
    }
    const edge = (mx, my) => {
      const dx = mx - R, dy = my - R, l = Math.hypot(dx, dy);
      if (l <= R - 9) return [mx, my];
      return [R + (dx / l) * (R - 9), R + (dy / l) * (R - 9)];
    };
    g.font = 'bold 9px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let c = 0; c < this.columns.length; c++) {
      const info = this._colCache?.[c];
      if (!info || !info.n) continue;
      const [mx, my] = edge(...toMap(info.x, info.z));
      g.fillStyle = '#1d4f86';
      g.beginPath(); g.arc(mx, my, 6.5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#cfe6ff'; g.lineWidth = 1; g.stroke();
      g.fillStyle = '#fff';
      g.fillText(String(c + 1), mx, my + 0.5);
    }
    if (this.marker) {
      const [mx, my] = edge(...toMap(this.marker.x, this.marker.z));
      g.strokeStyle = '#ffd24a'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(mx - 5, my - 5); g.lineTo(mx + 5, my + 5); g.moveTo(mx + 5, my - 5); g.lineTo(mx - 5, my + 5); g.stroke();
    }
  }

  /** Kol bilgilerini (HUD/harita) saniyede iki kez tazeler. */
  refreshColumns(now) {
    if (now < (this._colAt ?? 0)) return this._colCache;
    this._colAt = now + 0.5;
    this._colCache = this.columns.map((_, c) => this.columnInfo(c));
    return this._colCache;
  }
}
