/* Prosedürel dokular.

   Harici doku dosyası yok: hepsi canvas üzerinde çiziliyor. Böylece oyun tek
   klasörde taşınabilir kalıyor ve yükleme süresi sıfıra yakın. Dokular bir
   kez üretilip paylaşılır.                                                 */

import * as THREE from 'three';

const cache = new Map();

function canvas(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, g: c.getContext('2d') };
}

/** Düzgün dağılmış gürültü lekeleri — beton/asfalt tanesi. */
function speckle(g, size, count, colors, min = 1, max = 3) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    const r = min + Math.random() * (max - min);
    g.fillRect(Math.random() * size, Math.random() * size, r, r);
  }
}

function finish(c, repeat) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function make(name, fn) {
  if (!cache.has(name)) cache.set(name, fn());
  return cache.get(name);
}

/** Zemin betonu: panel derzleri, çatlaklar, yağ lekeleri. */
export function concreteTexture(repeat = 24) {
  return make(`concrete${repeat}`, () => {
    const S = 512;
    const { c, g } = canvas(S);

    g.fillStyle = '#4a5047';
    g.fillRect(0, 0, S, S);
    speckle(g, S, 9000, ['#525848', '#434a41', '#575e52', '#3d443b'], 1, 4);

    // Panel derzleri
    g.strokeStyle = 'rgba(26,30,26,0.75)';
    g.lineWidth = 3;
    for (const p of [0, S / 2]) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    }

    // Çatlaklar
    g.strokeStyle = 'rgba(22,26,22,0.5)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      let x = Math.random() * S, y = Math.random() * S;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (Math.random() - 0.5) * 90;
        y += (Math.random() - 0.5) * 90;
        g.lineTo(x, y);
      }
      g.stroke();
    }

    // Yağ/pas lekeleri
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * S, y = Math.random() * S, r = 14 + Math.random() * 54;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(30,26,20,0.38)');
      grad.addColorStop(1, 'rgba(30,26,20,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }

    return finish(c, repeat);
  });
}

/** Asfalt yol: koyu, ortasında sarı şerit. */
export function roadTexture(repeat = 6) {
  return make(`road${repeat}`, () => {
    const S = 512;
    const { c, g } = canvas(S);

    g.fillStyle = '#2b2e2b';
    g.fillRect(0, 0, S, S);
    speckle(g, S, 12000, ['#333733', '#262926', '#3a3e39'], 1, 3);

    // Kenar çizgileri (yol boyunca sürsün diye yatay)
    g.fillStyle = 'rgba(214,180,90,0.75)';
    g.fillRect(0, S * 0.08, S, 7);
    g.fillRect(0, S * 0.92 - 7, S, 7);

    // Orta kesik çizgi
    g.fillStyle = 'rgba(222,222,206,0.55)';
    for (let x = 0; x < S; x += 96) g.fillRect(x, S / 2 - 4, 54, 8);

    return finish(c, repeat);
  });
}

/** Düz asfalt (çizgisiz) — yolların kesiştiği kare için. */
export function asphaltTexture(repeat = 3) {
  return make(`asphalt${repeat}`, () => {
    const S = 512;
    const { c, g } = canvas(S);
    g.fillStyle = '#2b2e2b';
    g.fillRect(0, 0, S, S);
    speckle(g, S, 12000, ['#333733', '#262926', '#3a3e39'], 1, 3);
    // Yama izleri
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(20,22,20,${0.1 + Math.random() * 0.12})`;
      g.fillRect(Math.random() * S, Math.random() * S, 40 + Math.random() * 120, 30 + Math.random() * 90);
    }
    return finish(c, repeat);
  });
}

/** Konteyner sacı: dikey nervürler ve pas. */
export function containerTexture(repeat = 1) {
  return make(`container${repeat}`, () => {
    const S = 512;
    const { c, g } = canvas(S);

    g.fillStyle = '#39574e';
    g.fillRect(0, 0, S, S);

    // Nervürler
    for (let x = 0; x < S; x += 32) {
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.fillRect(x, 0, 14, S);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(x + 14, 0, 7, S);
    }

    // Üst/alt kuşak
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, 0, S, 18);
    g.fillRect(0, S - 18, S, 18);

    // Pas akıntıları
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * S, y = Math.random() * S * 0.7;
      const h = 30 + Math.random() * 150;
      const grad = g.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, 'rgba(120,62,30,0.5)');
      grad.addColorStop(1, 'rgba(120,62,30,0)');
      g.fillStyle = grad;
      g.fillRect(x, y, 4 + Math.random() * 9, h);
    }

    return finish(c, repeat);
  });
}

/** Ahşap sandık: tahtalar, çiviler, stencil damga. */
export function crateTexture(repeat = 1) {
  return make(`crate${repeat}`, () => {
    const S = 512;
    const { c, g } = canvas(S);

    g.fillStyle = '#7d6334';
    g.fillRect(0, 0, S, S);

    // Tahtalar
    for (let y = 0; y < S; y += 64) {
      g.fillStyle = `rgba(0,0,0,${0.12 + Math.random() * 0.1})`;
      g.fillRect(0, y + 58, S, 6);
      g.fillStyle = `rgba(255,220,160,${0.04 + Math.random() * 0.05})`;
      g.fillRect(0, y + 4, S, 10);
      // Damar
      g.strokeStyle = 'rgba(60,42,18,0.25)';
      g.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.moveTo(0, y + 10 + Math.random() * 44);
        g.bezierCurveTo(S / 3, y + Math.random() * 60, (2 * S) / 3, y + Math.random() * 60, S, y + 10 + Math.random() * 44);
        g.stroke();
      }
    }

    // Köşe demirleri
    g.fillStyle = 'rgba(40,40,38,0.55)';
    g.fillRect(0, 0, 18, S); g.fillRect(S - 18, 0, 18, S);
    g.fillRect(0, 0, S, 18); g.fillRect(0, S - 18, S, 18);

    // Stencil
    g.fillStyle = 'rgba(232,163,61,0.75)';
    g.font = 'bold 54px "Share Tech Mono", monospace';
    g.fillText('MÜH-07', 118, S / 2 + 14);
    g.strokeStyle = 'rgba(232,163,61,0.6)';
    g.lineWidth = 4;
    g.strokeRect(96, S / 2 - 44, 300, 70);

    return finish(c, repeat);
  });
}

/** Varil sacı: pas ve tehlike bandı. */
export function barrelTexture() {
  return make('barrel', () => {
    const S = 256;
    const { c, g } = canvas(S);

    g.fillStyle = '#8a3a22';
    g.fillRect(0, 0, S, S);
    speckle(g, S, 4000, ['#9c4529', '#742d19', '#a8513a'], 1, 4);

    // Çember kuşaklar
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, S * 0.22, S, 12);
    g.fillRect(0, S * 0.7, S, 12);

    // Tehlike bandı
    g.fillStyle = 'rgba(232,163,61,0.9)';
    g.fillRect(0, S * 0.44, S, 26);
    g.fillStyle = 'rgba(20,20,18,0.85)';
    for (let x = -S; x < S; x += 28) {
      g.beginPath();
      g.moveTo(x, S * 0.44); g.lineTo(x + 14, S * 0.44);
      g.lineTo(x + 28, S * 0.44 + 26); g.lineTo(x + 14, S * 0.44 + 26);
      g.closePath(); g.fill();
    }

    return finish(c, 1);
  });
}

/** Sanayi duvarı: beton panel + metal kuşak. */
export function wallTexture(repeat = 8) {
  return make(`wall${repeat}`, () => {
    const S = 512;
    const { c, g } = canvas(S);

    g.fillStyle = '#565d52';
    g.fillRect(0, 0, S, S);
    speckle(g, S, 7000, ['#5e6659', '#4d544a', '#646c5f'], 1, 3);

    // Panel çizgileri
    g.strokeStyle = 'rgba(28,32,28,0.6)';
    g.lineWidth = 4;
    for (let y = 0; y <= S; y += S / 2) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
    }
    g.lineWidth = 2;
    for (let x = 0; x <= S; x += S / 4) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke();
    }

    // Alt kirlilik
    const grad = g.createLinearGradient(0, S * 0.65, 0, S);
    grad.addColorStop(0, 'rgba(24,26,22,0)');
    grad.addColorStop(1, 'rgba(24,26,22,0.55)');
    g.fillStyle = grad;
    g.fillRect(0, S * 0.65, S, S * 0.35);

    return finish(c, repeat);
  });
}

/** Depo cephesi: büyük sac panel + pencere şeridi. */
export function buildingTexture() {
  return make('building', () => {
    const S = 512;
    const { c, g } = canvas(S);

    g.fillStyle = '#4b5550';
    g.fillRect(0, 0, S, S);

    // Yatay sac nervürler
    for (let y = 0; y < S; y += 18) {
      g.fillStyle = y % 36 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.14)';
      g.fillRect(0, y, S, 9);
    }

    // Pencere şeridi
    g.fillStyle = '#10181c';
    g.fillRect(28, 96, S - 56, 92);
    g.fillStyle = 'rgba(150,190,210,0.22)';
    for (let x = 36; x < S - 40; x += 58) g.fillRect(x, 102, 44, 80);
    g.strokeStyle = 'rgba(20,24,22,0.8)';
    g.lineWidth = 6;
    g.strokeRect(28, 96, S - 56, 92);

    // Kapı
    g.fillStyle = '#2a2f2b';
    g.fillRect(S / 2 - 86, S - 190, 172, 190);
    g.fillStyle = 'rgba(232,163,61,0.5)';
    g.fillRect(S / 2 - 86, S - 196, 172, 8);
    for (let y = S - 182; y < S; y += 22) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(S / 2 - 86, y, 172, 6);
    }

    // Pas ve kir
    for (let i = 0; i < 18; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const grad = g.createRadialGradient(x, y, 0, x, y, 20 + Math.random() * 60);
      grad.addColorStop(0, 'rgba(70,46,26,0.3)');
      grad.addColorStop(1, 'rgba(70,46,26,0)');
      g.fillStyle = grad;
      g.fillRect(x - 60, y - 60, 120, 120);
    }

    return finish(c, 1);
  });
}

/** Gökyüzü: tepede derin mavi, ufka doğru açılan berrak gündüz göğü.
    Güneş dokuya çizilmez — sahnede gerçek bir cisim olarak durur (world.js),
    böylece güneş ışığının geldiği yönle tam olarak çakışır.               */
export function skyTexture() {
  return make('sky', () => {
    const S = 512;
    const { c, g } = canvas(S);

    const grad = g.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0.00, '#1b4fa8');   // zenit
    grad.addColorStop(0.28, '#2f72c8');
    grad.addColorStop(0.50, '#5ea0e0');
    grad.addColorStop(0.68, '#9cc8ee');
    grad.addColorStop(0.80, '#cfe4f4');   // ufuk pusu
    grad.addColorStop(0.84, '#b9cdbd');   // yer tarafı
    grad.addColorStop(1.00, '#7d8a77');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);

    // Dağınık, yumuşak bulut kümeleri. Yatay şerit çizilmez: eşlek
    // eşlemesinde şeritler gökte halka gibi sarılıyor.
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * S;
      const y = S * 0.12 + Math.random() * (S * 0.3);
      const r = 12 + Math.random() * 46;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${0.05 + Math.random() * 0.07})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI * 2);
      g.fill();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    return tex;
  });
}

/** Güneş: ortada beyaz çekirdek, dışa doğru sıcak ve yumuşak sönen hale. */
export function sunTexture() {
  return make('sun', () => {
    const S = 256;
    const { c, g } = canvas(S);
    const R = S / 2;

    const grad = g.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0.00, 'rgba(255,255,250,1)');
    grad.addColorStop(0.07, 'rgba(255,253,235,1)');
    grad.addColorStop(0.11, 'rgba(255,241,196,0.92)');
    grad.addColorStop(0.20, 'rgba(255,221,150,0.42)');
    grad.addColorStop(0.36, 'rgba(255,205,130,0.16)');
    grad.addColorStop(0.60, 'rgba(255,214,160,0.05)');
    grad.addColorStop(1.00, 'rgba(255,214,160,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

/** Badana sıva (Baskın evi): kırık beyaz, lekeli, alt kısmı kirli.
    Tekrar 1: kutu yüzlerinin UV'leri metreye göre ölçeklenir (1 kare = 2 m). */
export function plasterTexture() {
  return make('plaster', () => {
    const S = 512;
    const { c, g } = canvas(S);
    g.fillStyle = '#cfc4ad';
    g.fillRect(0, 0, S, S);
    speckle(g, S, 9000, ['rgba(120,104,80,0.10)', 'rgba(255,250,235,0.12)', 'rgba(90,80,64,0.08)'], 1, 4);
    // Geniş lekeler: yağmur izi ve kabaran boya
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * S, y = Math.random() * S, r = 20 + Math.random() * 70;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(110,96,72,${0.05 + Math.random() * 0.08})`);
      grd.addColorStop(1, 'rgba(110,96,72,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // İnce çatlaklar
    g.strokeStyle = 'rgba(70,60,46,0.35)';
    g.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      let x = Math.random() * S, y = Math.random() * S;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (Math.random() - 0.5) * 40;
        y += Math.random() * 26;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    return finish(c, 1);
  });
}

/** Ahşap döşeme tahtaları. */
export function plankTexture() {
  return make('plank', () => {
    const S = 512;
    const { c, g } = canvas(S);
    g.fillStyle = '#6b4f2e';
    g.fillRect(0, 0, S, S);
    const W = 64;
    for (let x = 0; x < S; x += W) {
      const tone = 0.85 + Math.random() * 0.3;
      g.fillStyle = `rgba(${Math.round(120 * tone)},${Math.round(86 * tone)},${Math.round(48 * tone)},0.55)`;
      g.fillRect(x + 2, 0, W - 4, S);
      g.strokeStyle = 'rgba(48,32,16,0.25)';
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        const ox = x + 6 + Math.random() * (W - 12);
        g.moveTo(ox, 0);
        g.bezierCurveTo(ox + 6, S / 3, ox - 6, (2 * S) / 3, ox + 3, S);
        g.stroke();
      }
      // Derz ve ek yeri
      g.fillStyle = 'rgba(30,20,10,0.6)';
      g.fillRect(x, 0, 2, S);
      g.fillRect(x, (Math.random() * S) | 0, W, 2);
    }
    return finish(c, 1);
  });
}

/** Kiremit sıraları (beşik çatı). */
export function tileTexture() {
  return make('tile', () => {
    const S = 256;
    const { c, g } = canvas(S);
    g.fillStyle = '#7c3523';
    g.fillRect(0, 0, S, S);
    const rowH = 32, w = 32;
    for (let r = 0; r < S / rowH; r++) {
      const off = (r % 2) * (w / 2);
      for (let x = -w; x < S + w; x += w) {
        const tone = 0.82 + Math.random() * 0.3;
        const grd = g.createLinearGradient(0, r * rowH, 0, r * rowH + rowH);
        grd.addColorStop(0, `rgb(${Math.round(150 * tone)},${Math.round(70 * tone)},${Math.round(44 * tone)})`);
        grd.addColorStop(1, `rgb(${Math.round(96 * tone)},${Math.round(40 * tone)},${Math.round(26 * tone)})`);
        g.fillStyle = grd;
        g.beginPath();
        g.roundRect(x + off + 1, r * rowH, w - 2, rowH - 3, [0, 0, 10, 10]);
        g.fill();
      }
      g.fillStyle = 'rgba(30,12,8,0.45)';
      g.fillRect(0, r * rowH + rowH - 3, S, 3);
    }
    return finish(c, 1);
  });
}

/* ── Alan (harita) dokuları ─────────────────────────────────────────── */

/** Zemin: düz renk + iri/ince lekeler + birkaç geniş ton bölgesi. */
function groundTexture(name, repeat, base, specks, blots, extra) {
  return make(`${name}${repeat}`, () => {
    const S = 512;
    const { c, g } = canvas(S);
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    for (const [color, alpha] of blots) {
      for (let i = 0; i < 18; i++) {
        const x = Math.random() * S, y = Math.random() * S, r = 30 + Math.random() * 90;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, color.replace('A', alpha));
        gr.addColorStop(1, color.replace('A', 0));
        g.fillStyle = gr;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    speckle(g, S, 12000, specks, 1, 3);
    extra?.(g, S);
    return finish(c, repeat);
  });
}

export function sandTexture(repeat = 26) {
  return groundTexture('sand', repeat, '#b99a68',
    ['#c4a674', '#a98a5a', '#cfb283', '#9c7f52'],
    [['rgba(140,104,60,A)', 0.25], ['rgba(222,196,150,A)', 0.3]],
    (g, S) => {
      // Rüzgâr dalgacıkları
      g.strokeStyle = 'rgba(120,92,52,0.18)';
      g.lineWidth = 2;
      for (let y = 8; y < S; y += 22) {
        g.beginPath();
        for (let x = 0; x <= S; x += 16) g.lineTo(x, y + Math.sin(x * 0.04 + y) * 4);
        g.stroke();
      }
    });
}

export function grassTexture(repeat = 26) {
  return groundTexture('grass', repeat, '#4c5e32',
    ['#56693a', '#41522a', '#5f7340', '#3a4825', '#6b6a3c'],
    [['rgba(92,78,44,A)', 0.35], ['rgba(88,112,52,A)', 0.3]],
    (g, S) => {
      // Ot çizgileri
      for (let i = 0; i < 2600; i++) {
        const x = Math.random() * S, y = Math.random() * S;
        g.strokeStyle = Math.random() < 0.5 ? 'rgba(110,140,70,0.35)' : 'rgba(40,52,22,0.35)';
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (Math.random() - 0.5) * 3, y - 3 - Math.random() * 4);
        g.stroke();
      }
    });
}

export function snowTexture(repeat = 26) {
  return groundTexture('snow', repeat, '#dfe6ec',
    ['#e9eff4', '#d3dbe3', '#f4f7fa', '#c8d2dc'],
    [['rgba(170,186,204,A)', 0.3], ['rgba(255,255,255,A)', 0.4]]);
}

/** Kayalık geçitler için çakıl, taş parçaları ve doğal çatlaklar. */
export function rockTexture(repeat = 26) {
  return groundTexture('rocky', repeat, '#77776f',
    ['#85857c', '#62645f', '#9a9990', '#585b57', '#77766d'],
    [['rgba(48,52,49,A)', 0.32], ['rgba(183,178,164,A)', 0.18]],
    (g, S) => {
      g.strokeStyle = 'rgba(44,47,44,0.24)';
      g.lineWidth = 1.4;
      for (let i = 0; i < 180; i++) {
        const x = Math.random() * S, y = Math.random() * S;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (Math.random() - 0.5) * 24, y + (Math.random() - 0.5) * 18);
        g.lineTo(x + (Math.random() - 0.5) * 42, y + (Math.random() - 0.5) * 32);
        g.stroke();
      }
    });
}

/** Bataklık zemini: koyu çamur, nem lekeleri ve yosun tonları. */
export function swampTexture(repeat = 26) {
  return groundTexture('swamp', repeat, '#455142',
    ['#52614a', '#303d34', '#647052', '#39483a', '#68725a'],
    [['rgba(22,34,31,A)', 0.5], ['rgba(111,126,91,A)', 0.18]],
    (g, S) => {
      for (let i = 0; i < 34; i++) {
        const x = Math.random() * S, y = Math.random() * S;
        const rx = 12 + Math.random() * 44, ry = 5 + Math.random() * 18;
        g.fillStyle = 'rgba(24,39,36,0.22)';
        g.beginPath();
        g.ellipse(x, y, rx, ry, Math.random(), 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(121,135,99,0.16)';
        g.lineWidth = 2;
        g.stroke();
      }
    });
}

/** Toprak yol (çöl/orman/kar alanında asfaltın yerine). */
export function dirtTexture(repeat = 6, tint = '#7a6446') {
  return groundTexture(`dirt${tint}`, repeat, tint,
    ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.08)', 'rgba(60,44,28,0.2)'],
    [['rgba(50,38,24,A)', 0.25]],
    (g, S) => {
      // Tekerlek izleri
      g.fillStyle = 'rgba(40,30,18,0.22)';
      g.fillRect(0, S * 0.28, S, S * 0.08);
      g.fillRect(0, S * 0.64, S, S * 0.08);
    });
}

/** Kerpiç sıva (çöl evleri). */
export function mudTexture(repeat = 1) {
  return groundTexture('mud', repeat, '#a5845c',
    ['#b08f66', '#97774f', '#bc9b70'],
    [['rgba(120,90,56,A)', 0.35], ['rgba(196,166,124,A)', 0.3]],
    (g, S) => {
      g.strokeStyle = 'rgba(90,64,38,0.35)';
      g.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) {
        let x = Math.random() * S, y = Math.random() * S;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 50; y += Math.random() * 30; g.lineTo(x, y); }
        g.stroke();
      }
    });
}

/** Gökyüzü renk paletleri: [zenit, orta, ufuk, ufuk pusu, yer] + bulut. */
const SKIES = {
  gunduz: [['#1b4fa8', 0], ['#2f72c8', 0.28], ['#5ea0e0', 0.5], ['#9cc8ee', 0.68], ['#cfe4f4', 0.8], ['#b9cdbd', 0.84], ['#7d8a77', 1], 0.07],
  col: [['#3a6fb0', 0], ['#5c8fc4', 0.3], ['#9fbfd6', 0.55], ['#dccfae', 0.74], ['#efdcb4', 0.82], ['#c9ae7f', 0.86], ['#9c845c', 1], 0.03],
  orman: [['#4f6680', 0], ['#6c8096', 0.3], ['#8e9ea8', 0.55], ['#aeb8b4', 0.72], ['#c2c9c0', 0.8], ['#7f8c72', 0.85], ['#4f5c40', 1], 0.12],
  kar: [['#7f93ab', 0], ['#98aabf', 0.3], ['#b8c6d4', 0.55], ['#d6dfe8', 0.72], ['#e7edf2', 0.8], ['#d5dde5', 0.85], ['#b4bfca', 1], 0.14],
  kiyi: [['#275579', 0], ['#3d7797', 0.3], ['#76a8bc', 0.55], ['#adcbd3', 0.72], ['#d0e0df', 0.8], ['#aab8b2', 0.85], ['#72827f', 1], 0.08],
  dag: [['#304962', 0], ['#5b7184', 0.3], ['#9eafb9', 0.55], ['#c3ccd0', 0.72], ['#d7dddb', 0.8], ['#aab5b3', 0.85], ['#66736f', 1], 0.12],
  koy: [['#29528a', 0], ['#4e83bd', 0.3], ['#86b1d6', 0.55], ['#c0d6db', 0.72], ['#e1e1cf', 0.8], ['#bdc5a5', 0.85], ['#8e9b68', 1], 0.06],
  bataklik: [['#283f43', 0], ['#45615f', 0.3], ['#71877e', 0.55], ['#9aa99b', 0.72], ['#c0c6b8', 0.8], ['#8b9b8d', 0.85], ['#465b4d', 1], 0.18],
};

export function themedSkyTexture(kind = 'gunduz') {
  if (kind === 'gunduz') return skyTexture();
  return make(`sky-${kind}`, () => {
    const S = 512;
    const { c, g } = canvas(S);
    const pal = SKIES[kind] ?? SKIES.gunduz;
    const grad = g.createLinearGradient(0, 0, 0, S);
    for (const [col, at] of pal.slice(0, 7)) grad.addColorStop(at, col);
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    const cloud = pal[7];
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * S;
      const y = S * 0.1 + Math.random() * (S * 0.34);
      const r = 14 + Math.random() * 56;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${cloud * (0.6 + Math.random() * 0.8)})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    return tex;
  });
}
