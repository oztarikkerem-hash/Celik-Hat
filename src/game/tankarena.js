/* Tank muharebe sahası: tepelik, ormanlık arazi ve akaryakıt istasyonu.

   Yükselti tek bir fonksiyondan gelir — `yukseklik(x,z)`. Hem zemin
   geometrisi hem tankların fiziği aynı fonksiyonu kullanır; ikisi ayrı
   olursa tank yere gömülür ya da havada yürür.

   Çarpışma: her engel {x, z, r} olarak listelenir. Tank gövdesi tek nokta
   değil, önde ve arkada İKİ DAİRE ile temsil edilir (`itme` fonksiyonu);
   tek nokta kullanmak tankı ağaçların içinden geçiriyordu.

   Yerleşim tohumlu rastgele sayıyla üretilir: aynı görev = aynı arazi.  */

import * as THREE from 'three';

export const ARENA_YARICAP = 420;
const SAHA = 980;               // zemin karesinin kenarı

function karma(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function degerGurultusu(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = karma(xi, yi), b = karma(xi + 1, yi);
  const c = karma(xi, yi + 1), d = karma(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Katmanlı gürültü: geniş tepeler + orta sırtlar + ince dalgalanma. */
function fbm(x, y) {
  let s = 0, a = 1, f = 1, n = 0;
  for (let i = 0; i < 5; i++) {
    s += a * degerGurultusu(x * f, y * f);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

export class TankArena {
  constructor(scene) {
    this.scene = scene;
    this.grup = new THREE.Group();
    this.istasyonlar = [];
    this.engeller = [];
    this.kuruldu = false;
    this.agacSablonu = null;
  }

  /* ── Yükselti ─────────────────────────────────────────────────────── */

  /** Zemin kotu. Başlangıç bölgesi düz, kenarlar yükselerek sahayı kapatır. */
  yukseklik(x, z) {
    const r = Math.hypot(x, z);
    // Merkezdeki 30 m düz: tanklar dizilirken yamuk durmasın
    const duzluk = Math.min(1, Math.max(0, (r - 30) / 70));
    let h = (fbm(x * 0.0058 + 3.1, z * 0.0058 - 1.7) - 0.5) * 30
      + (fbm(x * 0.028, z * 0.028) - 0.5) * 3.6;
    h *= duzluk;
    // Saha kenarında arazi yükselir: görünmez duvar yerine doğal sınır
    h += Math.max(0, r - ARENA_YARICAP * 0.78) * 0.2;
    return h;
  }

  /** Dört noktadan eğim: tankı araziye yatırmak için. */
  egim(x, z, yon) {
    const s = Math.sin(yon), c = Math.cos(yon);
    const on = this.yukseklik(x - s * 3, z - c * 3);
    const arka = this.yukseklik(x + s * 3, z + c * 3);
    const sol = this.yukseklik(x - c * 1.7, z + s * 1.7);
    const sag = this.yukseklik(x + c * 1.7, z - s * 1.7);
    return {
      y: (on + arka + sol + sag) / 4,
      pitch: Math.atan2(on - arka, 6),
      roll: Math.atan2(sol - sag, 3.4),
    };
  }

  /* ── Çarpışma ─────────────────────────────────────────────────────── */

  /**
   * Gövdeyi engellerden dışarı iter. Tank önde ve arkada iki daireyle
   * temsil edilir — tek nokta kullanınca tank ağaçların içinden geçiyordu.
   * @returns {{x:number, z:number, carpti:boolean}} düzeltilmiş konum
   */
  itme(x, z, yon, yaricap = 2.1) {
    let nx = x, nz = z, carpti = false;
    const s = Math.sin(yon), c = Math.cos(yon);
    for (const uzak of [2.2, -2.2]) {
      const px = nx - s * uzak, pz = nz - c * uzak;
      for (const o of this.engeller) {
        const dx = px - o.x, dz = pz - o.z;
        const d = Math.hypot(dx, dz);
        const rr = yaricap + o.r;
        if (d < rr && d > 0.001) {
          const it = rr - d;
          nx += (dx / d) * it;
          nz += (dz / d) * it;
          carpti = true;
          // Hızlı giden tank ince ağacı deviriyor
          if (o.agac && !o.agac.userData.devrik && o.r < 2.2) {
            o.agac.userData.devrik = true;
            o.agac.rotation.z = 1.35 * Math.sign(dx || 1);
            o.agac.position.y -= 0.6;
            o.r = 0;
          }
        }
      }
    }
    return { x: nx, z: nz, carpti };
  }

  /* ── Yükleme ve kurulum ───────────────────────────────────────────── */

  async yukle(GLTFLoader) {
    if (this.agacSablonu) return;
    try {
      const gltf = await new GLTFLoader().loadAsync('assets/props/tree.glb');
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m) m.side = THREE.DoubleSide;
      });
      this.agacSablonu = gltf.scene;
    } catch (e) {
      console.warn('Ağaç modeli yüklenemedi', e);
    }
  }

  kur() {
    if (this.kuruldu) return;
    this.kuruldu = true;
    if (this.scene.fog) {
      this._sisYedek = [this.scene.fog.near, this.scene.fog.far];
      this.scene.fog.near = 180;
      this.scene.fog.far = 820;
    }
    this._zemin();
    this._istasyon(new THREE.Vector3(-118, 0, -16), 0.4);
    this._istasyon(new THREE.Vector3(104, 0, -150), -0.65);
    this._orman();
    this._kayalar();
    this.scene.add(this.grup);
  }

  temizle() {
    if (this._sisYedek && this.scene.fog) {
      [this.scene.fog.near, this.scene.fog.far] = this._sisYedek;
      this._sisYedek = null;
    }
    this.scene.remove(this.grup);
    this.grup.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose?.(); });
    this.grup = new THREE.Group();
    this.istasyonlar = [];
    this.engeller = [];
    this.kuruldu = false;
  }

  /* ── Zemin ────────────────────────────────────────────────────────── */

  _zemin() {
    const SEG = 220;
    const geo = new THREE.PlaneGeometry(SAHA, SAHA, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const renk = new Float32Array(pos.count * 3);
    const cimen = new THREE.Color(0x56642f);
    const kuru = new THREE.Color(0x8a7a50);
    const kaya = new THREE.Color(0x6e6a5a);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = this.yukseklik(x, z);
      pos.setY(i, y);
      // Kuru/yeşil geçişi ayrı bir gürültüden: tek renk arazi düz görünüyor
      const n = fbm(x * 0.018 + 9, z * 0.018 + 4);
      tmp.copy(cimen).lerp(kuru, THREE.MathUtils.clamp((n - 0.42) * 3, 0, 1));
      const dik = Math.abs(this.yukseklik(x + 1.5, z) - y)
        + Math.abs(this.yukseklik(x, z + 1.5) - y);
      tmp.lerp(kaya, THREE.MathUtils.clamp(dik * 0.55, 0, 1));
      renk[i * 3] = tmp.r; renk[i * 3 + 1] = tmp.g; renk[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(renk, 3));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, map: this._zeminDoku(), roughness: 0.96, metalness: 0,
    }));
    mesh.receiveShadow = true;
    this.grup.add(mesh);
    this.zemin = mesh;
  }

  /** İnce grenli zemin dokusu: düz renk zemin plastik görünüyor. */
  _zeminDoku() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const cx = cv.getContext('2d');
    const im = cx.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      const x = i % 256, y = (i / 256) | 0;
      const v = 175 + fbm(x * 0.09, y * 0.09) * 60 + karma(x, y) * 26 - 26;
      im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = Math.min(255, v);
      im.data[i * 4 + 3] = 255;
    }
    cx.putImageData(im, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(150, 150);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  /* ── Bitki örtüsü ─────────────────────────────────────────────────── */

  _tohum(n) {
    let s = n;
    return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  }

  _orman() {
    const R = this._tohum(7);
    const olcek = this.agacSablonu ? 26 : 1;
    for (let i = 0; i < 260; i++) {
      const a = R() * Math.PI * 2;
      const r = 70 + R() * (ARENA_YARICAP - 110);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      // Muharebe koridoru ve istasyon sahası açık kalsın
      if (Math.abs(x) < 34 && z > -260 && z < 50) continue;
      if (this._istasyonaYakin(x, z, 40)) continue;

      // Karışık orman: indirilen meşe modeli seyrek yapraklı kalıyor,
      // aralarına dolgun iğne yapraklı serpiştiriliyor.
      const modelAgac = this.agacSablonu && R() < 0.55;
      const s = modelAgac ? olcek * (0.6 + R() * 0.6) : 1.1 + R() * 1.1;
      const agac = modelAgac ? this.agacSablonu.clone(true) : this._basitAgac();
      agac.position.set(x, this.yukseklik(x, z), z);
      agac.rotation.y = R() * Math.PI * 2;
      agac.scale.setScalar(s);
      this.grup.add(agac);
      this.engeller.push({ x, z, r: modelAgac ? 1.0 * (s / olcek) : 0.8 * s, agac });
    }
  }

  _basitAgac() {
    const g = new THREE.Group();
    const govde = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.34, 3.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }),
    );
    govde.position.y = 1.7;
    const tac = new THREE.Mesh(
      new THREE.ConeGeometry(2.1, 6, 7),
      new THREE.MeshStandardMaterial({ color: 0x3f5428, roughness: 0.95, flatShading: true }),
    );
    tac.position.y = 5.4;
    g.add(govde, tac);
    g.traverse((o) => { o.castShadow = true; });
    return g;
  }

  _kayalar() {
    const R = this._tohum(4242);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x7d776a, roughness: 0.9, flatShading: true,
    });
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const pa = geo.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pa, i);
      v.multiplyScalar(0.75 + karma(i, 7) * 0.5);
      pa.setXYZ(i, v.x, v.y * 0.7, v.z);
    }
    geo.computeVertexNormals();

    for (let i = 0; i < 110; i++) {
      const a = R() * Math.PI * 2;
      const r = 48 + R() * (ARENA_YARICAP - 70);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this._istasyonaYakin(x, z, 30)) continue;
      const s = 0.9 + R() * 3.2;
      const kaya = new THREE.Mesh(geo, mat);
      kaya.position.set(x, this.yukseklik(x, z) + s * 0.2, z);
      kaya.scale.setScalar(s);
      kaya.rotation.y = R() * 6;
      kaya.castShadow = kaya.receiveShadow = true;
      this.grup.add(kaya);
      if (s > 1.4) this.engeller.push({ x, z, r: s * 0.9 });
    }
  }

  _istasyonaYakin(x, z, mesafe) {
    return this.istasyonlar.some((s) => Math.hypot(x - s.pos.x, z - s.pos.z) < mesafe);
  }

  /* ── Akaryakıt istasyonu ──────────────────────────────────────────── */

  _istasyon(pos, aci) {
    const y = this.yukseklik(pos.x, pos.z);
    const g = new THREE.Group();
    g.position.set(pos.x, y, pos.z);
    g.rotation.y = aci;

    const beton = new THREE.MeshStandardMaterial({ color: 0x615f57, roughness: 0.94 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8e9189, roughness: 0.5, metalness: 0.75 });
    const sari = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.55, metalness: 0.3 });

    const saha = new THREE.Mesh(new THREE.BoxGeometry(50, 0.6, 38), beton);
    saha.position.y = 0.3;
    saha.receiveShadow = true;
    g.add(saha);

    const cati = new THREE.Mesh(new THREE.BoxGeometry(34, 1, 22), metal);
    cati.position.set(0, 9.6, 0);
    cati.castShadow = true;
    g.add(cati);
    const serit = new THREE.Mesh(new THREE.BoxGeometry(34.4, 1.3, 1.3), sari);
    serit.position.set(0, 8.7, 11.2);
    g.add(serit);

    // Direkler: çarpılabilir engeller
    for (const [dx, dz] of [[-15, -9], [15, -9], [-15, 9], [15, 9]]) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 9.4, 10), metal);
      d.position.set(dx, 4.8, dz);
      d.castShadow = true;
      g.add(d);
      this._engelEkle(pos, aci, dx, dz, 1.1);
    }

    // Pompalar (ortadaki şerit boş: tank buraya girip E'ye basıyor)
    for (const dx of [-11, 11]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3.4, 1.4), sari);
      p.position.set(dx, 2.3, 0);
      p.castShadow = true;
      g.add(p);
      this._engelEkle(pos, aci, dx, 0, 1.3);
    }

    // Arka depolar
    for (const dx of [-11, 11]) {
      const depo = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 13, 18), metal);
      depo.rotation.z = Math.PI / 2;
      depo.position.set(dx, 3.6, -15);
      depo.castShadow = true;
      g.add(depo);
      this._engelEkle(pos, aci, dx, -15, 5.5);
    }

    const isik = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 20, 8),
      new THREE.MeshBasicMaterial({ color: 0x8fe39a, transparent: true, opacity: 0.35 }),
    );
    isik.position.y = 16;
    g.add(isik);

    this.grup.add(g);
    this.istasyonlar.push({
      pos: new THREE.Vector3(pos.x, y, pos.z), grup: g, isik, yaricap: 20,
    });
  }

  /** İstasyon parçasının dünya konumunu engel listesine ekler. */
  _engelEkle(merkez, aci, dx, dz, r) {
    const s = Math.sin(aci), c = Math.cos(aci);
    this.engeller.push({
      x: merkez.x + dx * c + dz * s,
      z: merkez.z - dx * s + dz * c,
      r,
    });
  }

  nabiz(t) {
    for (const s of this.istasyonlar) {
      s.isik.material.opacity = 0.32 + Math.sin(t * 2.4) * 0.2;
    }
  }
}
