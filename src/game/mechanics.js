/* Silah mekanikleri: elle tutuş noktaları, hareketli parçalar ve şarjör
   değiştirme koreografileri.

   Her silah için (RIGS):
     • parts    — hangi model parçaları birlikte hareket eder (şarjör, sürgü,
                  kurma kolu, kapak, mermi bandı…); her grup kendi pivotuna
                  alınır.
     • anchors  — avuç merkezi + bilek→boğum yönü (k) + avuç normali (n),
                  TUTUCU uzayında (-Z ileri, +Y yukarı, +X sağ, metre).
                  `on: 'mag'` olanlar şarjörle birlikte hareket eder.
     • magPoses — şarjörün yuvaya göre ara konumları (aşağıda, giriş, …).
     • reload   — koreografi adı (aşağıdaki CHOREO).

   Koreografi, saniye cinsinden anahtar karelerden oluşan izlerdir:
     gun   : tutucuya eklenen [dx,dy,dz, rx,ry,rz]
     L / R : sol/sağ elin hedefi (çapa adı); iki çapa arası yumuşak geçiş
     mag   : şarjör konumu ('home' | 'pouch' | magPoses anahtarı)
     magVis: şarjör görünür mü (düşürüldükten sonra yenisi gelene dek gizli)
     slide, charge, bolt, boltLift, cover, rounds, spin: parça izleri (0–1)
     ev    : [t, olay] — ses ve fizik olayları ('drop' şarjörü yere bırakır) */

import * as THREE from 'three';

/* ── Ortak yönler (tutucu uzayı) ─────────────────────────────────────── */
const R_GRIP = { k: [-0.22, 0.32, -0.92], n: [-0.96, -0.08, 0.22] };
const L_UNDER = { k: [0.55, 0.0, -0.83], n: [0.12, 0.99, 0.0] };
const L_MAG = { k: [0.1, 0.8, -0.6], n: [0.97, -0.05, 0.1] };

/* Kemer/yelek cebi: kameranın sol-altı, ekran dışı (KAMERA uzayı) */
export const POUCH = { p: [-0.2, -0.62, -0.12], r: [0.25, 0.4, 0.35] };

const a = (p, dir, pose, extra = {}) => ({ p, ...dir, pose, ...extra });

export const RIGS = {
  // Bıçak: tek elle çekiç tutuşu (sap tutucu uzayında -Z boyunca). Sol el
  // ekran dışında, göğüs hizasında yumruk — iki elle tutulan silah yok.
  bicak: {
    reload: null,
    stance: { yaw: 0.1, mid: [0, -0.27, 0.1] },
    parts: {},
    anchors: {
      grip: a([0.0, -0.016, -0.074], { k: [-0.15, 0.55, -0.82], n: [-0.97, 0.05, 0.2] }, 'fist'),
      support: a([-0.36, -0.2, 0.2], { k: [0.3, 0.6, -0.75], n: [0.9, 0.2, 0.3] }, 'fist'),
    },
  },

  deagle: {
    reload: 'pistol',
    stance: { yaw: 0.12, mid: [0, -0.27, 0.1] },     // tabanca: omuzlar karşıya
    parts: { mag: /^(Magazine|Mag_Base)$/, slide: /^(Slide_|Serr|RearSight|RearNotch|Hammer)/ },
    slideTravel: 0.038,
    anchors: {
      grip: a([0.02, -0.032, -0.06], R_GRIP, 'trigger'),
      // Sol el sağ elin parmaklarını sarar (iki elli tabanca tutuşu)
      support: a([-0.024, -0.05, -0.085], { k: [0.55, 0.35, -0.75], n: [0.9, 0.1, 0.35] }, 'grip'),
      mag: a([-0.022, -0.045, 0.01], L_MAG, 'mag', { on: 'mag' }),
      slap: a([0, -0.085, -0.03], { k: [0.2, 0.3, -0.93], n: [0, 1, 0] }, 'flat', { on: 'mag' }),
      rack: a([0, 0.098, -0.035], { k: [0.95, -0.05, 0.3], n: [0, -1, 0] }, 'pinch', { on: 'slide' }),
    },
    magPoses: {
      out: { p: [0, -0.05, 0.004], r: [0.04, 0, 0] },
      below: { p: [0, -0.15, 0.02], r: [0.18, 0, 0.05] },
      start: { p: [0, -0.07, 0.008], r: [0.06, 0, 0] },
      tug: { p: [0, -0.004, 0], r: [0, 0, 0] },
    },
  },

  ak47: {
    reload: 'ak',
    parts: { mag: /^Cube006$/, charge: /^weapon001$/ },
    pivot: 'frontTop',          // AK şarjörü ön tırnağından menteşelenir
    chargeTravel: 0.085,
    anchors: {
      grip: a([0.022, -0.04, -0.227], R_GRIP, 'trigger'),
      support: a([0.004, 0.0, -0.48], L_UNDER, 'support'),
      mag: a([-0.03, -0.12, 0.03], { k: [0.05, 0.85, -0.5], n: [0.97, 0, 0.15] }, 'mag', { on: 'mag' }),
      charge: a([0.045, 0.07, -0.4], { k: [0.1, -0.4, -0.9], n: [-0.95, -0.3, 0] }, 'pinch', { on: 'charge' }),
    },
    magPoses: {
      out: { p: [0, -0.02, -0.01], r: [0.45, 0, 0] },
      below: { p: [0, -0.16, -0.03], r: [0.55, 0, 0.08] },
      start: { p: [0, -0.012, -0.004], r: [0.42, 0, 0] },  // ön tırnak takıldı, geriye yatık
      tug: { p: [0, -0.003, 0], r: [0.02, 0, 0] },
    },
  },

  mar556: {
    reload: 'ar',
    parts: {
      mag: /^(Magazine|Mag_Baseplate|Mag_Rounds|MAR556_Magazine_\d)$/,
      charge: /^(Charging_Handle|MAR556_ChargingHandle)$/,
      catch: /^(Bolt_Catch|MAR556_BoltCatch)$/,
    },
    chargeTravel: 0.075,
    anchors: {
      grip: a([0.02, -0.035, -0.217], R_GRIP, 'trigger'),
      support: a([0.003, 0.02, -0.47], L_UNDER, 'support'),
      mag: a([-0.03, -0.11, 0.02], L_MAG, 'mag', { on: 'mag' }),
      boltCatch: a([-0.035, 0.03, -0.27], { k: [0.3, 0.2, -0.93], n: [0.97, 0, 0.2] }, 'flat'),
    },
    magPoses: {
      out: { p: [0, -0.05, 0], r: [0.03, 0, 0] },
      below: { p: [0, -0.2, 0.03], r: [0.16, 0, 0.06] },
      start: { p: [0, -0.07, 0.006], r: [0.05, 0, 0] },
      tug: { p: [0, -0.005, 0], r: [0, 0, 0] },
    },
  },

  m4: {
    reload: 'ar',
    parts: { mag: /^Magazine$/ },
    anchors: {
      grip: a([0.02, -0.06, -0.3], R_GRIP, 'trigger'),
      support: a([0.003, -0.012, -0.55], L_UNDER, 'support'),
      mag: a([-0.03, -0.065, 0.02], L_MAG, 'mag', { on: 'mag' }),
      boltCatch: a([-0.035, 0.015, -0.4], { k: [0.3, 0.2, -0.93], n: [0.97, 0, 0.2] }, 'flat'),
    },
    magPoses: {
      out: { p: [0, -0.05, 0], r: [0.03, 0, 0] },
      below: { p: [0, -0.18, 0.03], r: [0.16, 0, 0.06] },
      start: { p: [0, -0.06, 0.006], r: [0.05, 0, 0] },
      tug: { p: [0, -0.005, 0], r: [0, 0, 0] },
    },
  },

  // M4A1 kırmızı noktalı (classic_m4): parça adları Magazine_m4_0 …
  m4a1: {
    reload: 'ar',
    parts: { mag: /^Magazine/ },
    // Ölçüm (tutucu uzayı): kabza ortası (0, −0.11, −0.34), el kundağı
    // alt yüzü y ≈ −0.02 z −0.56…−0.78, kırmızı nokta merkezi y 0.125
    anchors: {
      grip: a([0.02, -0.078, -0.318], R_GRIP, 'trigger'),
      support: a([0.003, -0.026, -0.63], L_UNDER, 'support'),
      mag: a([-0.03, -0.065, 0.02], L_MAG, 'mag', { on: 'mag' }),
      boltCatch: a([-0.035, 0.004, -0.43], { k: [0.3, 0.2, -0.93], n: [0.97, 0, 0.2] }, 'flat'),
    },
    magPoses: {
      out: { p: [0, -0.05, 0], r: [0.03, 0, 0] },
      below: { p: [0, -0.18, 0.03], r: [0.16, 0, 0.06] },
      start: { p: [0, -0.06, 0.006], r: [0.05, 0, 0] },
      tug: { p: [0, -0.005, 0], r: [0, 0, 0] },
    },
  },

  mg43: {
    reload: 'belt',
    parts: {
      mag: /^MG43_ammo_/,
      cover: /^MG43_topcover/,
      rounds: /^MG43_round_/,
      charge: /^MG43_charge_/,
    },
    coverHinge: [0, 0.088, -0.381],
    chargeTravel: 0.09,
    anchors: {
      grip: a([0.02, -0.06, -0.233], R_GRIP, 'trigger'),
      support: a([0, -0.005, -0.49], L_UNDER, 'support'),
      mag: a([-0.055, -0.06, 0], { k: [0.2, 0.75, -0.62], n: [0.97, 0, 0.1] }, 'mag', { on: 'mag' }),
      cover: a([0, 0.1, -0.2], { k: [0.35, 0.1, -0.93], n: [0, -1, 0.05] }, 'open', { on: 'cover' }),
      tray: a([-0.01, 0.1, -0.29], { k: [0.6, -0.2, -0.77], n: [0, -1, 0] }, 'pinch'),
      charge: a([0.065, 0.06, -0.386], { k: [0.1, -0.3, -0.95], n: [-0.97, -0.2, 0] }, 'pinch', { on: 'charge' }),
    },
    magPoses: {
      out: { p: [0, -0.04, 0], r: [0, 0, 0] },
      below: { p: [-0.02, -0.16, 0.04], r: [0.1, 0, 0.12] },
      start: { p: [0, -0.04, 0], r: [0.02, 0, 0] },
      tug: { p: [0, -0.004, 0], r: [0, 0, 0] },
    },
  },

  barrett_m82: {
    reload: 'barrett',
    parts: { mag: /^(Magazine|MagFloor001)$/, charge: /^ChargingHandle_/ },
    chargeTravel: 0.12,
    anchors: {
      grip: a([0.02, -0.015, -0.262], R_GRIP, 'trigger'),
      support: a([0, 0.04, -0.48], L_UNDER, 'support'),
      mag: a([-0.035, -0.04, 0.0], { k: [0.1, 0.85, -0.5], n: [0.97, 0, 0.15] }, 'mag', { on: 'mag' }),
      charge: a([-0.075, 0.08, -0.338], { k: [0.1, -0.2, -0.97], n: [0.97, -0.2, 0.05] }, 'pinch', { on: 'charge' }),
    },
    magPoses: {
      out: { p: [0, -0.05, -0.005], r: [0.02, 0, 0] },
      below: { p: [0, -0.18, 0.02], r: [0.14, 0, 0.06] },
      start: { p: [0, -0.06, 0.004], r: [0.04, 0, 0] },
      tug: { p: [0, -0.005, 0], r: [0, 0, 0] },
    },
  },

  m98b: {
    reload: 'bolt',
    parts: { mag: /^(Cube004|Cube005)$/, bolt: /^Sphere$/ },
    boltAxis: [0, 0.075],       // sürgü ekseni (x, y): namlu hizası
    boltTravel: 0.085,
    anchors: {
      grip: a([0.02, -0.01, -0.213], R_GRIP, 'trigger'),
      support: a([0.003, -0.04, -0.47], L_UNDER, 'support'),
      mag: a([-0.03, -0.035, 0.0], L_MAG, 'mag', { on: 'mag' }),
      bolt: a([0.065, 0.075, -0.275], { k: [-0.2, -0.5, -0.84], n: [-0.5, 0.2, -0.84] }, 'pinch', { on: 'bolt' }),
    },
    magPoses: {
      out: { p: [0, -0.045, 0], r: [0.02, 0, 0] },
      below: { p: [0, -0.15, 0.02], r: [0.14, 0, 0.06] },
      start: { p: [0, -0.05, 0.004], r: [0.04, 0, 0] },
      tug: { p: [0, -0.004, 0], r: [0, 0, 0] },
    },
  },

  minigun: {
    reload: 'minigun',
    stance: { yaw: 0.35, mid: [0, -0.3, 0.12] },
    parts: {},
    belt: { at: [0.056, 0.02, -0.248] },     // besleme ağzının altı
    anchors: {
      grip: a([0.0, 0.198, -0.373], { k: [-0.25, 0.1, -0.96], n: [-0.97, 0, 0.25] }, 'grip'),
      support: a([-0.032, 0.32, -0.45], { k: [0.6, -0.1, -0.79], n: [0, -1, 0] }, 'support'),
      mag: a([-0.03, -0.06, 0.0], { k: [0.2, 0.9, -0.4], n: [0.97, 0, 0.2] }, 'pinch', { on: 'mag' }),
      barrel: a([0.04, 0.17, -0.9], { k: [0, -0.3, -0.95], n: [-0.6, -0.8, 0] }, 'open'),
    },
    magPoses: {
      out: { p: [0, -0.08, 0.02], r: [0.2, 0, 0] },
      below: { p: [0.04, -0.22, 0.05], r: [0.5, 0, 0.2] },
      start: { p: [0, -0.05, 0.01], r: [0.1, 0, 0] },
      tug: { p: [0, -0.005, 0], r: [0, 0, 0] },
    },
  },

  bazuka: {
    reload: 'rpg',
    reloadPivot: 'grip',
    stance: { yaw: 0.45, mid: [0, -0.27, 0.12] },
    parts: { mag: /^Bazuka_Grenade/ },
    pivot: 'rear',              // roketin kuyruğu namlu ağzında
    anchors: {
      grip: a([0.05, -0.1, -0.85], R_GRIP, 'trigger'),
      support: a([0.027, -0.035, -1.0], { k: [0.45, 0.05, -0.89], n: [0.1, 0.99, 0] }, 'support'),
      mag: a([-0.05, -0.01, -0.3], { k: [0.2, 0.3, -0.93], n: [0.95, 0, 0.2] }, 'grip', { on: 'mag' }),
    },
    magPoses: {
      out: { p: [0, 0, -0.35], r: [0, 0, 0] },
      below: { p: [-0.05, -0.12, -0.55], r: [0.2, 0.1, 0] },
      start: { p: [0, 0, -0.32], r: [0, 0, 0.0] },
      tug: { p: [0, 0, 0], r: [0, 0, 0.25] },     // roket çentiğe oturtulurken çevrilir
    },
  },
};

/* ── Koreografiler ───────────────────────────────────────────────────── */
// Silah duruş kısayolları: [dx,dy,dz, rx(yunuslama), ry(sapma), rz(yatırma)]
const Z = [0, 0, 0, 0, 0, 0];
const add = (p, q) => p.map((v, i) => v + q[i]);

function rifleCant(c) {
  // Şarjör yuvası sol ele dönsün: negatif yatırma = sağ yan yukarı
  // Silah kaldırılıp namlu yukarı alınır: yuva ve sol el ekrana girer
  return [-0.1 * c, 0.15 * c, -0.07, 0.16 * c, 0.32 * c, -0.62 * c];
}

/* AR ailesi (MAR 556, M4): düz şarjör, boşta sürgü durdurucuya şaplak. */
function arReload(empty) {
  const C = rifleCant(1);
  if (empty) {
    return {
      dur: 2.45,
      gun: [[0, Z], [0.28, C], [1.28, C], [1.33, add(C, [0, 0.016, 0, -0.03, 0, 0])],
        [1.42, C], [1.74, C], [1.79, add(C, [0, 0.01, -0.015, -0.05, 0, 0])], [1.9, C], [2.45, Z]],
      L: [[0, 'support'], [0.14, 'support'], [0.7, 'mag'], [1.34, 'mag'], [1.52, 'mag'],
        [1.72, 'boltCatch'], [1.78, 'boltCatch'], [2.2, 'support']],
      R: [[0, 'grip'], [0.22, 'grip', 'squeeze'], [0.32, 'grip'], [2.45, 'grip']],
      mag: [[0, 'home'], [0.3, 'home'], [0.31, 'pouch'], [0.72, 'pouch'], [1.06, 'below'],
        [1.24, 'start'], [1.32, 'home', 'in'], [1.4, 'tug'], [1.47, 'home']],
      magVis: [[0, 1], [0.3, 0], [0.7, 1]],
      catch: [[0, 1], [1.76, 1], [1.78, 0]],
      ev: [[0.24, 'release'], [0.3, 'drop'], [0.62, 'pouch'], [1.22, 'magTouch'], [1.32, 'seat'],
        [1.42, 'tug'], [1.77, 'boltRelease'], [2.15, 'cloth']],
    };
  }
  return {
    dur: 2.25,
    gun: [[0, Z], [0.28, C], [1.62, C], [1.67, add(C, [0, 0.016, 0, -0.03, 0, 0])], [1.76, C], [2.25, Z]],
    L: [[0, 'support'], [0.14, 'support'], [0.4, 'mag'], [1.8, 'mag'], [2.08, 'support']],
    R: [[0, 'grip'], [0.4, 'grip', 'squeeze'], [0.5, 'grip'], [2.25, 'grip']],
    mag: [[0, 'home'], [0.44, 'home'], [0.62, 'below'], [0.96, 'pouch'], [1.12, 'pouch'], [1.4, 'below'],
      [1.57, 'start'], [1.66, 'home', 'in'], [1.73, 'tug'], [1.8, 'home']],
    magVis: [[0, 1]],
    ev: [[0.43, 'release'], [0.5, 'magOut'], [0.92, 'pouch'], [1.55, 'magTouch'], [1.66, 'seat'],
      [1.74, 'tug'], [2.05, 'cloth']],
  };
}

/* AK: şarjör ön tırnağından devrilerek çıkar, öne takılıp geriye oturtulur;
   boşta sol el silahın üstünden aşıp sağdaki kurma kolunu çeker. */
function akReload(empty) {
  const C = rifleCant(0.9);
  const base = {
    gun: [[0, Z], [0.28, C], [1.5, C], [1.56, add(C, [0, 0.014, 0, -0.03, 0, 0])], [1.66, C]],
    L: [[0, 'support'], [0.12, 'support'], [0.38, 'mag']],
    R: [[0, 'grip']],
    mag: [[0, 'home'], [0.42, 'home'], [0.58, 'out']],
    magVis: [[0, 1]],
    ev: [[0.42, 'release'], [0.56, 'magOut']],
  };
  if (empty) {
    base.dur = 2.95;
    // Sol el üstten aşıp sağdaki kurma koluna uzanırken yatırma azalır
    base.gun.push([1.95, C], [2.1, add(C, [0, 0, 0, 0, -0.1, 0.3])], [2.38, add(C, [0, 0, 0.02, 0, -0.1, 0.3])],
      [2.44, add(C, [0, 0, -0.01, 0, -0.1, 0.3])], [2.95, Z]);
    base.L.push([0.72, 'mag'], [1.66, 'mag'], [2.02, 'charge'], [2.36, 'charge'], [2.42, 'charge', 'open'],
      [2.75, 'support']);
    base.R.push([2.95, 'grip']);
    base.mag.push([0.66, 'out'], [0.67, 'pouch'], [0.95, 'pouch'], [1.25, 'below'], [1.42, 'start'],
      [1.56, 'home', 'in'], [1.62, 'tug'], [1.68, 'home']);
    base.magVis.push([0.64, 0], [0.92, 1]);
    base.charge = [[0, 0], [2.1, 0], [2.36, 1], [2.4, 1], [2.45, 0, 'in']];
    base.ev.push([0.66, 'drop'], [0.86, 'pouch'], [1.42, 'magTouch'], [1.56, 'seat'], [2.34, 'chargeBack'],
      [2.45, 'chargeFwd'], [2.7, 'cloth']);
  } else {
    base.dur = 2.5;
    base.gun.push([2.0, C], [2.5, Z]);
    base.L.push([2.06, 'mag'], [2.3, 'support']);
    base.R.push([2.5, 'grip']);
    base.mag.push([0.75, 'below'], [1.0, 'pouch'], [1.18, 'pouch'], [1.48, 'below'], [1.62, 'start'],
      [1.78, 'home', 'in'], [1.84, 'tug'], [1.9, 'home']);
    base.ev.push([0.95, 'pouch'], [1.6, 'magTouch'], [1.78, 'seat'], [2.25, 'cloth']);
    // Taktik doldurmada çarpma iz düşümü
    base.gun.splice(3, 2, [1.74, C], [1.8, add(C, [0, 0.014, 0, -0.03, 0, 0])], [1.9, C]);
  }
  return base;
}

/* Tabanca: başparmakla şarjör bırakılır, avuçla şaplakla oturtulur;
   boşta kilitli sürgü üstten kavranıp bırakılır (overhand). */
function pistolReload(empty) {
  const C = [-0.05, 0.08, 0.02, 0.32, 0.3, -0.5];
  if (empty) {
    return {
      dur: 2.0,
      gun: [[0, Z], [0.22, C], [0.98, C], [1.03, add(C, [0, 0.03, 0, -0.08, 0, 0])], [1.12, C],
        // Sürgü üstten kavranırken silah uzaklaşır, namlu iner: el görünür
        [1.36, add(C, [0.05, -0.04, -0.07, -0.4, -0.15, 0.45])], [1.42, add(C, [0.05, -0.04, -0.05, -0.4, -0.15, 0.45])],
        [1.46, add(C, [0.05, -0.04, -0.08, -0.4, -0.15, 0.45])], [2.0, Z]],
      L: [[0, 'support'], [0.1, 'support'], [0.55, 'mag'], [0.95, 'mag'], [1.02, 'slap'], [1.08, 'slap'],
        [1.3, 'rack'], [1.4, 'rack'], [1.44, 'rack', 'open'], [1.75, 'support']],
      R: [[0, 'grip'], [2.0, 'grip']],
      mag: [[0, 'home'], [0.14, 'home'], [0.16, 'out'], [0.17, 'pouch'], [0.55, 'pouch'], [0.8, 'below'],
        [0.92, 'start'], [0.98, 'start'], [1.03, 'home', 'in']],
      magVis: [[0, 1], [0.16, 0], [0.5, 1]],
      slide: [[0, 1], [1.3, 1], [1.38, 1.12], [1.43, 1.12], [1.46, 0, 'in']],
      ev: [[0.12, 'release'], [0.16, 'drop'], [0.5, 'pouch'], [0.9, 'magTouch'], [1.03, 'seat'],
        [1.38, 'slideBack'], [1.46, 'slideFwd'], [1.7, 'cloth']],
    };
  }
  return {
    dur: 1.7,
    gun: [[0, Z], [0.22, C], [1.08, C], [1.13, add(C, [0, 0.03, 0, -0.08, 0, 0])], [1.22, C], [1.7, Z]],
    L: [[0, 'support'], [0.1, 'support'], [0.3, 'mag'], [1.06, 'mag'], [1.12, 'slap'], [1.18, 'slap'],
      [1.45, 'support']],
    R: [[0, 'grip'], [1.7, 'grip']],
    mag: [[0, 'home'], [0.3, 'home'], [0.36, 'out'], [0.6, 'pouch'], [0.72, 'pouch'], [0.92, 'below'],
      [1.03, 'start'], [1.12, 'home', 'in']],
    magVis: [[0, 1]],
    ev: [[0.3, 'release'], [0.36, 'magOut'], [0.6, 'pouch'], [1.0, 'magTouch'], [1.12, 'seat'], [1.4, 'cloth']],
  };
}

/* Barrett: ağır şarjör iki hareketle; boşta sol taraftaki kurma kolu
   sonuna kadar çekilip bırakılır. */
function barrettReload(empty) {
  const C = [-0.05, 0.02, 0.08, 0.12, 0.16, -0.42];
  const r = {
    dur: empty ? 3.5 : 2.9,
    gun: [[0, Z], [0.35, C], [1.75, C], [1.82, add(C, [0, 0.018, 0, -0.035, 0, 0])], [1.95, C]],
    L: [[0, 'support'], [0.16, 'support'], [0.45, 'mag'], [1.9, 'mag']],
    R: [[0, 'grip'], [0.4, 'grip', 'squeeze'], [0.52, 'grip']],
    mag: [[0, 'home'], [0.5, 'home'], [0.75, 'out'], [0.95, 'below'], [1.15, 'pouch'], [1.3, 'pouch'],
      [1.58, 'below'], [1.72, 'start'], [1.82, 'home', 'in'], [1.88, 'tug'], [1.94, 'home']],
    magVis: [[0, 1]],
    ev: [[0.5, 'release'], [0.74, 'magOut'], [1.12, 'pouch'], [1.7, 'magTouch'], [1.82, 'seat']],
  };
  if (empty) {
    // Kurma kolu SOL yanda: sol yan görünsün diye yatırma tersine döner
    r.gun.push([2.15, add(C, [0.02, 0, 0, 0, 0.08, 0.7])], [2.62, add(C, [0.02, 0, 0.03, 0, 0.08, 0.7])],
      [2.7, add(C, [0.02, 0, -0.015, 0, 0.08, 0.7])], [3.5, Z]);
    r.L.push([2.2, 'charge'], [2.6, 'charge'], [2.66, 'charge', 'open'], [3.15, 'support']);
    r.R.push([3.5, 'grip']);
    r.charge = [[0, 0], [2.24, 0], [2.58, 1], [2.64, 1], [2.69, 0, 'in']];
    r.ev.push([2.55, 'chargeBack'], [2.69, 'chargeFwd'], [3.05, 'cloth']);
  } else {
    r.gun.push([2.4, C], [2.9, Z]);
    r.L.push([2.55, 'support']);
    r.R.push([2.9, 'grip']);
    r.ev.push([2.45, 'cloth']);
  }
  return r;
}

/* M98B sürgülü: sağ el kabzayı bırakıp sürgüyü kaldırır-çeker; sol el
   şarjörü değiştirir; sürgü itilip kilitlenir. */
function boltReload(empty) {
  const C = [-0.03, 0.03, 0.05, 0.1, 0.12, -0.35];  // sağ yan yukarı: sürgü görünsün
  return {
    dur: empty ? 3.1 : 2.8,
    gun: [[0, Z], [0.3, C], [2.6, C], [empty ? 3.1 : 2.8, Z]],
    L: [[0, 'support'], [0.5, 'support'], [0.82, 'mag'], [1.95, 'mag'], [2.25, 'support']],
    R: [[0, 'grip'], [0.18, 'grip'], [0.38, 'bolt'], [2.2, 'bolt'], [2.5, 'grip']],
    boltLift: [[0, 0], [0.38, 0], [0.48, 1], [2.08, 1], [2.16, 0, 'in']],
    bolt: [[0, 0], [0.5, 0], [0.64, 1], [1.88, 1], [2.02, 0, 'in']],
    mag: [[0, 'home'], [0.85, 'home'], [1.0, 'out'], [1.2, 'pouch'], [1.32, 'pouch'], [1.62, 'below'],
      [1.74, 'start'], [1.82, 'home', 'in'], [1.88, 'tug'], [1.94, 'home']],
    magVis: [[0, 1]],
    ev: [[0.46, 'boltUp'], [0.62, 'boltBack'], [0.62, 'eject'], [0.86, 'release'], [1.0, 'magOut'],
      [1.2, 'pouch'], [1.72, 'magTouch'], [1.82, 'seat'], [2.0, 'boltFwd'], [2.15, 'boltDown']],
  };
}

/* Sürgülü tüfekte HER ATIŞTAN SONRA: kaldır, çek (kovan fırlar), it, indir. */
export function boltCycle() {
  return {
    dur: 0.82,
    gun: [[0, Z], [0.14, [0, 0, 0.01, 0.04, 0.03, -0.14]], [0.62, [0, 0, 0.01, 0.04, 0.03, -0.14]], [0.82, Z]],
    L: [[0, 'support'], [0.82, 'support']],
    R: [[0, 'grip'], [0.12, 'bolt'], [0.6, 'bolt'], [0.8, 'grip']],
    boltLift: [[0, 0], [0.14, 0], [0.22, 1], [0.5, 1], [0.57, 0, 'in']],
    bolt: [[0, 0], [0.24, 0], [0.34, 1, 'out'], [0.38, 1], [0.48, 0, 'in']],
    ev: [[0.2, 'boltUp'], [0.33, 'boltBack'], [0.33, 'eject'], [0.47, 'boltFwd'], [0.56, 'boltDown']],
  };
}

/* MG 43 bant beslemeli: kapak açılır, bant kaldırılır, kutu değişir,
   yeni bant tepsiye yatırılır, kapak kapanır, kurma kolu çekilir. */
function beltReload() {
  // Namlu aşağı, silah sola-öne: dürbünün altındaki kapak ve tepsi görünsün
  const C = [-0.1, 0.0, -0.06, -0.3, 0.3, -0.35];
  return {
    dur: 4.3,
    gun: [[0, Z], [0.35, C], [3.95, C], [4.3, Z]],
    L: [[0, 'support'], [0.18, 'support'], [0.45, 'cover'], [0.78, 'cover'], [0.95, 'tray'], [1.08, 'tray'],
      [1.3, 'mag'], [2.55, 'mag'], [2.7, 'tray'], [2.85, 'tray'], [2.98, 'cover'], [3.12, 'cover', 'flat'],
      [3.3, 'charge'], [3.55, 'charge'], [3.6, 'charge', 'open'], [3.95, 'support']],
    R: [[0, 'grip'], [4.3, 'grip']],
    cover: [[0, 0], [0.48, 0], [0.75, 1, 'out'], [2.95, 1], [3.1, 0, 'in']],
    rounds: [[0, 1], [0.98, 1], [1.02, 0], [2.74, 0], [2.78, 1]],
    mag: [[0, 'home'], [1.32, 'home'], [1.45, 'out'], [1.47, 'pouch'], [1.85, 'pouch'], [2.2, 'below'],
      [2.38, 'start'], [2.48, 'home', 'in'], [2.53, 'tug'], [2.58, 'home']],
    magVis: [[0, 1], [1.46, 0], [1.82, 1]],
    charge: [[0, 0], [3.32, 0], [3.52, 1], [3.56, 1], [3.6, 0, 'in']],
    ev: [[0.5, 'coverOpen'], [1.0, 'beltOut'], [1.38, 'release'], [1.46, 'drop'], [1.8, 'pouch'],
      [2.36, 'magTouch'], [2.48, 'seat'], [2.76, 'beltIn'], [3.1, 'coverClose'], [3.5, 'chargeBack'],
      [3.6, 'chargeFwd'], [3.9, 'cloth']],
  };
}

/* Minigun: eski bant ucu çekilip atılır, yenisi besleyiciye sokulur,
   namlu demeti elle bir tur çevrilerek ilk fişek yerine oturtulur. */
function minigunReload() {
  const C = [0.02, 0.06, 0.06, 0.12, -0.1, -0.3];
  return {
    dur: 4.6,
    gun: [[0, Z], [0.35, C], [3.9, C], [4.6, Z]],
    L: [[0, 'support'], [0.2, 'support'], [0.55, 'mag'], [2.4, 'mag'], [2.75, 'barrel'], [3.3, 'barrel'],
      [3.7, 'support']],
    R: [[0, 'grip'], [4.6, 'grip']],
    mag: [[0, 'home'], [0.58, 'home'], [0.85, 'below'], [0.87, 'pouch'], [1.4, 'pouch'], [1.9, 'below'],
      [2.15, 'start'], [2.3, 'home', 'in'], [2.38, 'tug'], [2.45, 'home']],
    magVis: [[0, 1], [0.86, 0], [1.35, 1]],
    spin: [[0, 0], [2.85, 0], [3.3, 1]],
    ev: [[0.6, 'beltOut'], [0.86, 'drop'], [1.35, 'pouch'], [2.1, 'magTouch'], [2.3, 'beltIn'], [3.0, 'ratchet'],
      [3.25, 'ratchet'], [3.6, 'cloth']],
  };
}

/* Roketatar: omuzdan indirilir, namlu ağzı sola-öne çevrilir, roket
   önden sürülüp çentiğe oturtulana dek döndürülür, omuza geri alınır. */
function rpgReload() {
  const DOWN = [-0.2, 0.02, -0.2, 0.22, 0.78, 0.1];
  return {
    dur: 3.4,
    gun: [[0, Z], [0.55, DOWN], [2.55, DOWN], [2.6, add(DOWN, [0, 0, 0.012, 0, 0, 0])], [3.4, Z]],
    L: [[0, 'support'], [0.25, 'support'], [0.9, 'mag'], [2.45, 'mag'], [2.95, 'support']],
    R: [[0, 'grip'], [3.4, 'grip']],
    mag: [[0, 'pouch'], [0.95, 'pouch'], [1.5, 'below'], [1.8, 'out'], [2.15, 'start'], [2.3, 'home', 'in'],
      [2.42, 'tug'], [2.5, 'home']],
    magVis: [[0, 0], [0.9, 1]],
    ev: [[0.9, 'pouch'], [1.85, 'magTouch'], [2.3, 'seat'], [2.45, 'rocketLock'], [3.05, 'hammer']],
  };
}

export function choreography(type, empty) {
  switch (type) {
    case 'ar': return arReload(empty);
    case 'ak': return akReload(empty);
    case 'pistol': return pistolReload(empty);
    case 'barrett': return barrettReload(empty);
    case 'bolt': return boltReload(empty);
    case 'belt': return beltReload();
    case 'minigun': return minigunReload();
    case 'rpg': return rpgReload();
    default: return arReload(empty);
  }
}

/* ── İz örnekleme ────────────────────────────────────────────────────── */
const EASE = {
  io: (x) => x * x * (3 - 2 * x),
  in: (x) => x * x * x,                 // hızlanarak vur (oturtma, şaplak)
  out: (x) => 1 - (1 - x) * (1 - x),
  lin: (x) => x,
};

/**
 * İzde t anını bulur: { a, b, s, poseB } — a/b ardışık değerler, s geçiş.
 * Anahtar biçimi: [zaman, değer, (kolaylaştırma | parmak pozu)]
 */
export function sample(track, t) {
  if (!track?.length) return null;
  if (t <= track[0][0]) return { a: track[0][1], b: track[0][1], s: 0, ka: track[0], kb: track[0] };
  for (let i = 1; i < track.length; i++) {
    const k1 = track[i];
    if (t <= k1[0]) {
      const k0 = track[i - 1];
      const span = k1[0] - k0[0];
      const x = span > 0 ? (t - k0[0]) / span : 1;
      const easeName = EASE[k1[2]] ? k1[2] : 'io';
      return { a: k0[1], b: k1[1], s: EASE[easeName](x), ka: k0, kb: k1 };
    }
  }
  const last = track[track.length - 1];
  return { a: last[1], b: last[1], s: 0, ka: last, kb: last };
}

export function sampleNum(track, t, def = 0) {
  const r = sample(track, t);
  if (!r) return def;
  return r.a + (r.b - r.a) * r.s;
}

export function sampleArr(track, t) {
  const r = sample(track, t);
  if (!r) return null;
  return r.a.map((v, i) => v + (r.b[i] - v) * r.s);
}
