/* Dünya: sektörlere bölünmüş sanayi sahası.

   Akış (streaming): harita 28 m'lik kare sektörlere bölünür. Bir sektörün
   içeriği ancak oyuncuya yakınsa YA DA kameranın görüş piramidine giriyorsa
   kurulur; görüş alanından çıkıp uzaklaşınca tamamen sökülür (geometri,
   çarpışma kutuları ve fizik gövdeleri serbest bırakılır).

   Her sektör konumundan türeyen sabit bir tohumla üretilir — aynı sektör her
   yüklendiğinde birebir aynı görünür — ve seçili ALANIN (maps.js) arketip
   listesinden birini alır: sanayide depo/avlu/atölye/boru hattı, çölde
   kerpiç ev/kamp, ormanda koru/kayalık/kulübe, karda çamlık…            */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  concreteTexture, roadTexture, containerTexture, crateTexture,
  barrelTexture, wallTexture, buildingTexture, skyTexture, sunTexture, asphaltTexture,
  sandTexture, grassTexture, snowTexture, dirtTexture, mudTexture, themedSkyTexture, plankTexture,
} from './textures.js';
import { MAPS, weightedPick } from './maps.js';

const SECTOR = 28;
const GRID = 9;            // 9×9 sektör = 252 m kare saha
const WALL_H = 11;
const VIEW_DIST = 85;      // sis sınırıyla uyumlu: ötesi hiç kurulmaz
const KEEP_RING = 1;
const TRENCH_H = 1.2;      // siper yüksekliği: çömelen göz (1.10) altında kalır

/** Konumdan türeyen sabit rastgelelik (mulberry32). */
function seeded(ix, iz) {
  let a = (ix * 73856093) ^ (iz * 19349663) ^ 0x9e3779b9;
  return function rand() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Birim kaya: kenarları rastgele itilmiş düşük çokgenli küre (1×1×1). */
function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  const p = g.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 0.82 + Math.random() * 0.3);
    const k = seen.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.9, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Birim üçgen prizma (çadır / beşik çatı): taban 1×1, yükseklik 1, x boyunca. */
function prismGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(0, 0.5);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(Math.PI / 2);          // mahya x ekseni boyunca
  return g;
}

export class World {
  constructor(scene, renderer, physics) {
    this.scene = scene;
    this.renderer = renderer;
    this.physics = physics;

    this.sectorSize = SECTOR;
    this.grid = GRID;
    this.half = (GRID * SECTOR) / 2;

    this.sectors = new Map();
    this.statikler = [];      // şehrin sabit geometrisi (tank modunda gizlenir)
    this.colliders = [];        // sabit + hareketli (her kare güncellenir)
    this.solids = [];
    // Devrilebilen eşyalar: fizik gövdesi onları sürer, ama oyuncu ve
    // düşmanlar da çarpabilsin diye her kare kutuları tazelenir.
    this.props = [];
    this.cover = [];              // aktif siper noktaları
    this.propByBox = new Map();   // Box3 → eşya (oyuncu itmesi)
    this.propByMesh = new Map();  // Mesh → eşya (mermi itmesi)
    this._staticEnd = 0;
    this._staticColliders = 0;
    this._staticSolids = 0;
    // Görev yapıları (Baskın evi): sektörlerden bağımsız, akışla sökülmez
    this.fixtures = [];
    // Bu dairenin içine sektör eşyası kurulmaz (görev yapısına yer açılır)
    this.clearZone = null;        // { x, z, r }
    this.theme = MAPS[0];         // seçili alan (setTheme)
    this._dirty = true;
    this._frustum = new THREE.Frustum();
    this._projScreen = new THREE.Matrix4();
    this._box = new THREE.Box3();

    this.stats = { built: 0, active: 0, released: 0 };
  }

  /* ── Sabit kısım: gökyüzü, zemin, duvarlar, ışık ────────────────────── */

  build() {
    const scene = this.scene;
    const span = GRID * SECTOR;

    // Gökyüzü küresi — düz renk yerine ufku sıcak bir gradyan.
    const sky = skyTexture();
    scene.background = sky;
    scene.environment = sky;
    // Sis gök rengiyle aynı tonda: uzak sektörler ufukta eriyerek belirir
    scene.fog = new THREE.Fog(0xaccbe4, 60, 210);

    this.hemi = new THREE.HemisphereLight(0x9ec4ea, 0x6b6a4e, 1.5);
    scene.add(this.hemi);

    // Güneş yönü: ışık ve gökteki disk aynı vektörü kullanır
    this.sunDir = new THREE.Vector3(-0.55, 0.52, 0.65).normalize();

    const sun = new THREE.DirectionalLight(0xfff2d6, 3.4);
    sun.position.copy(this.sunDir).multiplyScalar(90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 200;
    const d = 62;
    Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
    sun.shadow.bias = -0.0007;
    sun.shadow.normalBias = 0.035;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    // Dolgu: gökyüzünün karşı tarafından soğuk ışık — gölgeler mavi olsun
    const fill = new THREE.DirectionalLight(0xaecbe8, 0.85);
    this.fill = fill;
    fill.position.set(48, 26, -34);
    scene.add(fill);

    // ── Gökteki güneş ──────────────────────────────────────────────────
    // Kamerayla birlikte taşınır, yani hep sonsuzdaymış gibi durur.
    // Tek levha + yumuşak parıltı dokusu: halka halka görünmesin.
    const sunGroup = new THREE.Mesh(
      new THREE.PlaneGeometry(96, 96),
      new THREE.MeshBasicMaterial({
        map: sunTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    scene.add(sunGroup);
    this.sunDisc = sunGroup;

    this.materials = {
      floor: new THREE.MeshStandardMaterial({ map: concreteTexture(26), roughness: 0.95, metalness: 0.05 }),
      road: new THREE.MeshStandardMaterial({ map: roadTexture(1), roughness: 0.9, metalness: 0.05 }),
      wall: new THREE.MeshStandardMaterial({ map: wallTexture(10), roughness: 0.88, metalness: 0.1 }),
      building: new THREE.MeshStandardMaterial({ map: buildingTexture(), roughness: 0.8, metalness: 0.22 }),
      roof: new THREE.MeshStandardMaterial({ color: 0x3a403a, roughness: 0.85, metalness: 0.3 }),
      crate: new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.85, metalness: 0.04 }),
      container: new THREE.MeshStandardMaterial({ map: containerTexture(), roughness: 0.62, metalness: 0.42 }),
      containerAlt: new THREE.MeshStandardMaterial({
        map: containerTexture(), color: 0xc08a4a, roughness: 0.66, metalness: 0.38,
      }),
      barrel: new THREE.MeshStandardMaterial({ map: barrelTexture(), roughness: 0.68, metalness: 0.4 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x79807a, roughness: 0.4, metalness: 0.88 }),
      darkSteel: new THREE.MeshStandardMaterial({ color: 0x33383a, roughness: 0.55, metalness: 0.8 }),
      pipe: new THREE.MeshStandardMaterial({ color: 0x6d7a72, roughness: 0.45, metalness: 0.85 }),
      sandbag: new THREE.MeshStandardMaterial({ color: 0x6d6446, roughness: 0.95, metalness: 0.02 }),
      stripe: new THREE.MeshStandardMaterial({
        color: 0xe8a33d, roughness: 0.65, metalness: 0.2, emissive: 0x3a2609, emissiveIntensity: 1,
      }),
      lamp: new THREE.MeshStandardMaterial({
        color: 0x2a2114, emissive: 0xffb257, emissiveIntensity: 3.4, roughness: 0.5,
      }),
      // Alanlara özel malzemeler
      mud: new THREE.MeshStandardMaterial({ map: mudTexture(3), roughness: 0.95, metalness: 0 }),
      mudDark: new THREE.MeshStandardMaterial({ map: mudTexture(3), color: 0x8f7a5e, roughness: 0.95 }),
      woodWall: new THREE.MeshStandardMaterial({ map: plankTexture(), color: 0x9a8a72, roughness: 0.9 }),
      bark: new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.95, flatShading: true }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x3f5a2a, roughness: 0.9, flatShading: true }),
      pine: new THREE.MeshStandardMaterial({ color: 0x2c4a2e, roughness: 0.9, flatShading: true }),
      palm: new THREE.MeshStandardMaterial({ color: 0x5f7a34, roughness: 0.85, flatShading: true, side: THREE.DoubleSide }),
      snowCap: new THREE.MeshStandardMaterial({ color: 0xf2f6fa, roughness: 0.8, flatShading: true }),
      rock: new THREE.MeshStandardMaterial({ color: 0x6f6d66, roughness: 0.92, flatShading: true }),
      tent: new THREE.MeshStandardMaterial({ color: 0x8d7f5a, roughness: 0.95, side: THREE.DoubleSide }),
    };

    this.geo = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
      pole: new THREE.CylinderGeometry(0.11, 0.13, 1, 8),
      sphere: new THREE.SphereGeometry(0.5, 10, 8),
      rock: rockGeometry(),
      prism: prismGeometry(),
      logX: new THREE.CylinderGeometry(0.5, 0.5, 1, 10).rotateZ(Math.PI / 2),
    };

    // ── Zemin ──────────────────────────────────────────────────────────
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(span, span), this.materials.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this._statik(floor);
    this.floor = floor;
    this.roads = [];
    this.perimeter = [];
    this.solids.push(floor);
    this.physics.addGroundPlane(0);

    // Sahayı bölen iki ana yol — yön duygusu verir. Doku yol boyunca
    // (U ekseninde) tekrar eder; genişlikte tek kare kalır ki şeritler
    // çoğalmasın.
    const ROAD_W = 10;
    const roadGeo = new THREE.PlaneGeometry(span, ROAD_W);
    const roadMap = this.materials.road.map;
    roadMap.repeat.set(span / ROAD_W, 1);
    roadMap.needsUpdate = true;

    for (const rotZ of [0, Math.PI / 2]) {
      const road = new THREE.Mesh(roadGeo, this.materials.road);
      road.rotation.set(-Math.PI / 2, 0, rotZ);
      road.position.y = 0.015;
      road.receiveShadow = true;
      this._statik(road);
      this.roads.push(road);
    }

    // İki yol ortada üst üste biniyor ve şeritler birbirine karışıyordu:
    // kesişime çizgisiz düz bir asfalt kare seriyoruz.
    const kavsak = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_W, ROAD_W),
      new THREE.MeshStandardMaterial({ map: asphaltTexture(2), roughness: 0.9, metalness: 0.05 }),
    );
    kavsak.rotation.x = -Math.PI / 2;
    kavsak.position.y = 0.022;
    kavsak.receiveShadow = true;
    this._statik(kavsak);
    this.roads.push(kavsak);
    this._roadMats = this.roads.map((r) => r.material);

    // ── Çevre duvarı ───────────────────────────────────────────────────
    const h = this.half;
    for (const [x, z, sx, sz] of [
      [0, -h, span, 1.2], [0, h, span, 1.2], [-h, 0, 1.2, span], [h, 0, 1.2, span],
    ]) {
      const mesh = new THREE.Mesh(this.geo.box, this.materials.wall);
      mesh.scale.set(sx, WALL_H, sz);
      mesh.position.set(x, WALL_H / 2, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this._statik(mesh);
      this.perimeter.push(mesh);
      this.solids.push(mesh);
      this.colliders.push(new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(x, WALL_H / 2, z), new THREE.Vector3(sx, WALL_H, sz),
      ));
      this.physics.addStaticBox({ x, y: WALL_H / 2, z }, { x: sx, y: WALL_H, z: sz });

      // Duvar üstü uyarı şeridi
      const cap = new THREE.Mesh(this.geo.box, this.materials.stripe);
      cap.scale.set(sx, 0.25, sz + 0.1);
      cap.position.set(x, WALL_H + 0.1, z);
      this._statik(cap);
    }

    this._staticColliders = this.colliders.length;
    this._staticSolids = this.solids.length;
    return this;
  }

  /* ── Yardımcılar ────────────────────────────────────────────────────── */

  key(ix, iz) { return `${ix},${iz}`; }

  sectorCenter(ix, iz) {
    return new THREE.Vector3((ix + 0.5) * SECTOR - this.half, 0, (iz + 0.5) * SECTOR - this.half);
  }

  sectorIndexAt(x, z) {
    return [
      THREE.MathUtils.clamp(Math.floor((x + this.half) / SECTOR), 0, GRID - 1),
      THREE.MathUtils.clamp(Math.floor((z + this.half) / SECTOR), 0, GRID - 1),
    ];
  }

  /* ── Sektör üretimi ─────────────────────────────────────────────────── */

  _buildSector(ix, iz) {
    const key = this.key(ix, iz);
    if (this.sectors.has(key)) return;

    const rand = seeded(ix, iz);
    const center = this.sectorCenter(ix, iz);
    const group = new THREE.Group();
    const colliders = [];
    const solids = [];
    const bodies = [];
    const props = [];        // devrilebilen eşyalar (varil, sandık)
    const cover = [];        // siper noktaları (konum + yüzey normali)
    const M = this.materials;
    const G = this.geo;
    const zone = this.clearZone;
    /** Görev yapısının arsasına düşüyor mu? (sektöre göre yerel x/z) */
    const inZone = (x, z, pad = 0) => Boolean(zone)
      && Math.hypot(center.x + x - zone.x, center.z + z - zone.z) < zone.r + pad;

    /** Katı gövde yerleştirir (çarpışma + fizik + raycast). */
    const solid = (geo, mat, x, y, z, sx, sy, sz, rotY = 0) => {
      if (inZone(x, z, Math.max(sx, sz) / 2)) return null;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(center.x + x, y, center.z + z);
      mesh.rotation.y = rotY;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      solids.push(mesh);
      // Döndürülmüş gövdelerde kutu, kapsayan eksen-hizalı kutuya genişletilir
      const w = Math.abs(Math.cos(rotY)) * sx + Math.abs(Math.sin(rotY)) * sz;
      const d = Math.abs(Math.sin(rotY)) * sx + Math.abs(Math.cos(rotY)) * sz;
      colliders.push(new THREE.Box3().setFromCenterAndSize(
        mesh.position.clone(), new THREE.Vector3(w, sy, d),
      ));
      bodies.push(this.physics.addStaticBox(mesh.position, { x: w, y: sy, z: d }));

      // Siper: göğüs yüksekliğindeki engellerin dört kenarı birer mevzi.
      // Çok alçak (saklanılmaz) ve çok yüksek (ateş edilemez) olanlar atlanır.
      if (sy >= 0.8 && sy <= 2.6) {
        const halfW = w / 2, halfD = d / 2;
        for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          cover.push({
            pos: new THREE.Vector3(
              mesh.position.x + nx * (halfW + 0.55),
              0,
              mesh.position.z + nz * (halfD + 0.55),
            ),
            normal: new THREE.Vector3(nx, 0, nz),   // siperden dışa bakan yön
            height: sy,
            taken: null,
          });
        }
      }
      return mesh;
    };

    /** Devrilebilen eşya (fizik gövdesi mesh'i sürer). */
    const prop = (geo, mat, x, y, z, sx, sy, sz, mass) => {
      if (inZone(x, z, 1)) return null;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(center.x + x, y, center.z + z);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      solids.push(mesh);
      const body = geo === G.cyl
        ? this.physics.addDynamicCylinder(mesh, sx / 2, sy, mass)
        : this.physics.addDynamicBox(mesh, { x: sx, y: sy, z: sz }, mass);
      bodies.push(body);

      const box = new THREE.Box3();
      const entry = { mesh, body, size: new THREE.Vector3(sx, sy, sz), box };
      props.push(entry);
      this.props.push(entry);
      this.propByBox.set(box, entry);
      this.propByMesh.set(mesh, entry);
      return mesh;
    };

    const inRoad = (x, z) => Math.abs(center.x + x) < 6 || Math.abs(center.z + z) < 6
      || inZone(x, z, 4);

    /**
     * Ağaçlar: gövdeler ve taçlar sektör başına TEK geometriye kaynaşır
     * (yüzlerce ayrı ağaç çizim çağrısı olmasın). Gövde mermi durdurur ve
     * çarpışır, taç yalnızca görünüm. style: palm | pine | pineSnow | leaf
     */
    const trees = (count, style) => {
      const trunks = [], crowns = [], caps = [];
      for (let i = 0; i < count; i++) {
        const x = (rand() - 0.5) * (SECTOR - 3), z = (rand() - 0.5) * (SECTOR - 3);
        const s = 0.8 + rand() * 0.5;
        const turn = rand() * Math.PI * 2;
        if (inRoad(x, z) || inZone(x, z, 2)) continue;
        const wx = center.x + x, wz = center.z + z;
        if (colliders.some((b) => wx > b.min.x - 1.2 && wx < b.max.x + 1.2
          && wz > b.min.z - 1.2 && wz < b.max.z + 1.2)) continue;
        let h;
        if (style === 'palm') {
          h = 6.2 * s;
          trunks.push(new THREE.CylinderGeometry(0.13 * s, 0.21 * s, h, 7).translate(wx, h / 2, wz));
          for (let k = 0; k < 8; k++) {
            crowns.push(new THREE.BoxGeometry(2.7 * s, 0.05, 0.55 * s)
              .translate(1.35 * s, 0, 0).rotateZ(-0.38 - (k % 2) * 0.25)
              .rotateY(turn + (k / 8) * Math.PI * 2).translate(wx, h, wz));
          }
        } else if (style === 'pine' || style === 'pineSnow') {
          h = 7.5 * s;
          trunks.push(new THREE.CylinderGeometry(0.16 * s, 0.28 * s, h, 7).translate(wx, h / 2, wz));
          for (let k = 0; k < 3; k++) {
            const r = (2.1 - k * 0.55) * s, ch = (2.8 - k * 0.4) * s, y = (2.4 + k * 1.75) * s;
            crowns.push(new THREE.ConeGeometry(r, ch, 7).rotateY(turn).translate(wx, y + ch / 2, wz));
            if (style === 'pineSnow') {
              caps.push(new THREE.ConeGeometry(r * 0.62, ch * 0.42, 7).rotateY(turn)
                .translate(wx, y + ch * 0.8, wz));
            }
          }
        } else {
          h = 4.6 * s;
          trunks.push(new THREE.CylinderGeometry(0.2 * s, 0.32 * s, h, 7).translate(wx, h / 2, wz));
          crowns.push(new THREE.IcosahedronGeometry(2.1 * s, 0).scale(1, 0.85, 1)
            .rotateY(turn).translate(wx, h + 0.9 * s, wz));
          crowns.push(new THREE.IcosahedronGeometry(1.4 * s, 0)
            .translate(wx + 0.9 * s, h + 0.2 * s, wz - 0.5 * s));
        }
        const box = new THREE.Box3().setFromCenterAndSize(
          new THREE.Vector3(wx, h / 2, wz), new THREE.Vector3(0.6 * s, h, 0.6 * s),
        );
        colliders.push(box);
        bodies.push(this.physics.addStaticBox(box.getCenter(new THREE.Vector3()), { x: 0.6 * s, y: h, z: 0.6 * s }));
      }
      const add = (list, mat, solidMesh) => {
        if (!list.length) return;
        const geo = mergeGeometries(list.map((g) => g.toNonIndexed()), false);
        for (const g of list) g.dispose();
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
        if (solidMesh) solids.push(mesh);
      };
      add(trunks, M.bark, true);
      add(crowns, style === 'palm' ? M.palm : style === 'leaf' ? M.leaf : M.pine, false);
      add(caps, M.snowCap, false);
    };

    /** Yerde yatan kütük (siper): x ekseni boyunca silindir. */
    const log = (x, z, len, rotY) => solid(G.logX, M.bark, x, 0.42, z, len, 0.84, 0.84, rotY);

    /** Kaya kümesi: biri büyük (siper), çevresinde küçükler. */
    const rocks = (x, z, big) => {
      const sx = big ? 2.2 + rand() * 1.4 : 1 + rand() * 0.8;
      const sy = big ? 1.2 + rand() * 0.9 : 0.6 + rand() * 0.5;
      solid(G.rock, M.rock, x, sy * 0.42, z, sx, sy, sx * (0.8 + rand() * 0.4), rand() * Math.PI);
    };

    /* Arketip seçimi — yol üstündeki sektörler açık kalır. */
    const onRoad = Math.abs(center.x) < 7 || Math.abs(center.z) < 7;
    const roll = rand();
    // Görev arsasına değen sektörde boru hattı/depo binası kurulmaz: onlar
    // sektörü baştan başa geçiyor, evin çatısından geçerdi.
    const nearZone = zone && Math.hypot(center.x - zone.x, center.z - zone.z) < zone.r + SECTOR * 0.75;
    const T = this.theme;
    let archetype = weightedPick(onRoad ? T.yolArketip : T.arketipler, roll);
    if (nearZone) {
      const guvenli = Object.fromEntries(Object.entries(T.arketipler)
        .filter(([k]) => !['boru', 'atolye', 'depo'].includes(k)));
      archetype = Object.keys(guvenli).length ? weightedPick(guvenli, roll) : 'avlu';
    }

    // ── Ortak: aydınlatma direği ───────────────────────────────────────
    {
      const lx = (rand() - 0.5) * (SECTOR - 8);
      const lz = (rand() - 0.5) * (SECTOR - 8);
      if (!inZone(lx, lz, 1) && T.lamba) {
      const pole = new THREE.Mesh(G.pole, M.darkSteel);
      pole.scale.set(1, 7.5, 1);
      pole.position.set(center.x + lx, 3.75, center.z + lz);
      pole.castShadow = true;
      group.add(pole);
      solids.push(pole);

      const head = new THREE.Mesh(G.box, M.lamp);
      head.scale.set(1.1, 0.22, 0.65);
      head.position.set(center.x + lx, 7.5, center.z + lz);
      group.add(head);

      const lamp = new THREE.PointLight(0xffb257, 26, 28, 2);
      lamp.position.set(center.x + lx, 7.2, center.z + lz);
      group.add(lamp);
      }
    }

    // ── Arketipler ─────────────────────────────────────────────────────
    if (archetype === 'depo') {
      // Konteyner sıraları, üst üste iki kat
      const rows = 2 + Math.floor(rand() * 2);
      for (let r = 0; r < rows; r++) {
        const along = rand() < 0.5;
        const len = 7 + rand() * 5;
        const x = (rand() - 0.5) * (SECTOR - len - 4);
        const z = (rand() - 0.5) * (SECTOR - len - 4);
        if (inRoad(x, z)) continue;
        const sx = along ? len : 2.9;
        const sz = along ? 2.9 : len;
        const mat = rand() < 0.5 ? M.container : M.containerAlt;
        solid(G.box, mat, x, 1.5, z, sx, 3, sz);
        if (rand() < 0.55) {
          solid(G.box, rand() < 0.5 ? M.container : M.containerAlt,
            x + (rand() - 0.5) * 1.5, 4.5, z + (rand() - 0.5) * 1.5, sx * 0.9, 3, sz * 0.9);
        }
      }
      for (let i = 0; i < 3 + rand() * 4; i++) {
        const x = (rand() - 0.5) * (SECTOR - 4), z = (rand() - 0.5) * (SECTOR - 4);
        if (!inRoad(x, z)) prop(G.cyl, M.barrel, x, 0.56, z, 0.84, 1.12, 0.84, 34);
      }
    } else if (archetype === 'atolye') {
      // Depo binası: gövde + çatı + rampa
      const w = 11 + rand() * 5, d2 = 9 + rand() * 4, hh = 6 + rand() * 2.5;
      const bx = (rand() - 0.5) * (SECTOR - w - 5);
      const bz = (rand() - 0.5) * (SECTOR - d2 - 5);
      solid(G.box, M.building, bx, hh / 2, bz, w, hh, d2);
      const roof = new THREE.Mesh(G.box, M.roof);
      roof.scale.set(w + 0.8, 0.5, d2 + 0.8);
      roof.position.set(center.x + bx, hh + 0.25, center.z + bz);
      roof.castShadow = roof.receiveShadow = true;
      group.add(roof);
      solids.push(roof);
      // Yükleme rampası
      solid(G.box, M.steel, bx, 0.55, bz + d2 / 2 + 1.6, w * 0.5, 1.1, 3, 0);
      for (let i = 0; i < 4; i++) {
        const x = bx + (rand() - 0.5) * w;
        const z = bz + d2 / 2 + 3.5 + rand() * 3;
        if (!inRoad(x, z)) prop(G.box, M.crate, x, 0.9, z, 1.8, 1.8, 1.8, 48);
      }
    } else if (archetype === 'boru') {
      // Boru hattı: yüksek borular + destekler + altından geçiş
      const along = rand() < 0.5;
      const z0 = (rand() - 0.5) * (SECTOR - 10);
      for (let i = 0; i < 3; i++) {
        const y = 3.2 + i * 0.95;
        const pipe = new THREE.Mesh(G.cyl, M.pipe);
        pipe.scale.set(0.8, SECTOR - 2, 0.8);
        pipe.rotation.z = Math.PI / 2;
        pipe.rotation.y = along ? 0 : Math.PI / 2;
        pipe.position.set(center.x + (along ? 0 : z0), y, center.z + (along ? z0 : 0));
        pipe.castShadow = pipe.receiveShadow = true;
        group.add(pipe);
        solids.push(pipe);
      }
      for (let s = -1; s <= 1; s += 2) {
        const sx2 = along ? s * 8 : z0;
        const sz2 = along ? z0 : s * 8;
        solid(G.box, M.darkSteel, sx2, 2.5, sz2, 0.6, 5, 0.6);
      }
      for (let i = 0; i < 4; i++) {
        const x = (rand() - 0.5) * (SECTOR - 6), z = (rand() - 0.5) * (SECTOR - 6);
        if (!inRoad(x, z)) prop(G.cyl, M.barrel, x, 0.56, z, 0.84, 1.12, 0.84, 34);
      }
    } else if (archetype === 'kontrol') {
      // Yol kenarı kontrol noktası: kum torbası siperler, bariyerler
      for (let s = -1; s <= 1; s += 2) {
        const bx = s * 6.5;
        for (let i = 0; i < 5; i++) {
          solid(G.sphere, M.sandbag, bx + (i - 2) * 1.05, 0.3, 4 + (i % 2) * 0.4, 1.1, 0.62, 0.9);
          if (i % 2 === 0) {
            solid(G.sphere, M.sandbag, bx + (i - 2) * 1.05, 0.85, 4, 1.05, 0.6, 0.86);
          }
        }
      }
      // Beton bariyerler
      for (let i = 0; i < 4; i++) {
        const x = (rand() - 0.5) * (SECTOR - 6);
        const z = (rand() - 0.5) * (SECTOR - 6);
        solid(G.box, M.wall, x, 0.55, z, 2.4, 1.1, 0.8, rand() * Math.PI);
      }
      for (let i = 0; i < 3; i++) {
        prop(G.box, M.crate, (rand() - 0.5) * 10, 0.75, (rand() - 0.5) * 10, 1.5, 1.5, 1.5, 32);
      }
    } else if (archetype === 'kerpic') {
      // Kerpiç evler: düz damlı, kapı/pencere boşlukları koyu levha;
      // aralarında göğüs hizasında avlu duvarları (siper)
      const n = 2 + Math.floor(rand() * 2);
      for (let i = 0; i < n; i++) {
        const w = 5 + rand() * 3, d = 4.5 + rand() * 3, h = 2.8 + rand() * 1.3;
        const x = (rand() - 0.5) * (SECTOR - w - 4), z = (rand() - 0.5) * (SECTOR - d - 4);
        const doorAt = (rand() - 0.5) * (w - 2);
        if (inRoad(x, z)) continue;
        if (!solid(G.box, M.mud, x, h / 2, z, w, h, d)) continue;
        const roof = new THREE.Mesh(G.box, M.mudDark);
        roof.scale.set(w + 0.3, 0.25, d + 0.3);
        roof.position.set(center.x + x, h + 0.12, center.z + z);
        roof.castShadow = roof.receiveShadow = true;
        group.add(roof);
        const door = new THREE.Mesh(G.box, M.darkSteel);
        door.scale.set(1.0, 1.95, 0.06);
        door.position.set(center.x + x + doorAt, 0.98, center.z + z + d / 2 + 0.03);
        group.add(door);
        for (const side of [-1, 1]) {
          const win = new THREE.Mesh(G.box, M.darkSteel);
          win.scale.set(0.8, 0.7, 0.06);
          win.position.set(center.x + x + side * w / 4, h * 0.62, center.z + z - d / 2 - 0.03);
          group.add(win);
        }
      }
      for (let i = 0; i < 3; i++) {
        const len = 4 + rand() * 5, along = rand() < 0.5;
        const x = (rand() - 0.5) * (SECTOR - 6), z = (rand() - 0.5) * (SECTOR - 6);
        if (!inRoad(x, z)) solid(G.box, M.mud, x, 0.6, z, along ? len : 0.45, 1.2, along ? 0.45 : len);
      }
      trees(3 + Math.floor(rand() * 3), 'palm');
    } else if (archetype === 'kamp') {
      // Askeri kamp: çadırlar, kum torbası çemberi, konteyner, variller
      for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) {
        const x = (rand() - 0.5) * (SECTOR - 8), z = (rand() - 0.5) * (SECTOR - 8);
        const rot = rand() < 0.5 ? 0 : Math.PI / 2;
        if (!inRoad(x, z)) solid(G.prism, M.tent, x, 1.3, z, 5.5, 2.6, 3.8, rot);
      }
      {
        const cx = (rand() - 0.5) * (SECTOR - 10), cz = (rand() - 0.5) * (SECTOR - 10);
        if (!inRoad(cx, cz)) {
          for (let k = 0; k < 11; k++) {
            if (k === 0 || k === 1) continue;                  // giriş boşluğu
            const a = (k / 11) * Math.PI * 2;
            solid(G.sphere, M.sandbag, cx + Math.cos(a) * 3, 0.3, cz + Math.sin(a) * 3, 1.1, 0.62, 0.9);
            solid(G.sphere, M.sandbag, cx + Math.cos(a) * 3, 0.85, cz + Math.sin(a) * 3, 1.05, 0.6, 0.86);
          }
        }
      }
      if (rand() < 0.7) {
        const x = (rand() - 0.5) * (SECTOR - 10), z = (rand() - 0.5) * (SECTOR - 10);
        if (!inRoad(x, z)) solid(G.box, M.containerAlt, x, 1.5, z, rand() < 0.5 ? 7 : 2.9, 3, rand() < 0.5 ? 2.9 : 7);
      }
      for (let i = 0; i < 4; i++) {
        const x = (rand() - 0.5) * (SECTOR - 4), z = (rand() - 0.5) * (SECTOR - 4);
        if (!inRoad(x, z)) prop(G.cyl, M.barrel, x, 0.56, z, 0.84, 1.12, 0.84, 34);
      }
    } else if (archetype === 'koru' || archetype === 'camlik') {
      // Sık ağaçlık; aralarda devrik kütükler ve kayalar siper olur
      for (let i = 0; i < 3; i++) {
        const x = (rand() - 0.5) * (SECTOR - 6), z = (rand() - 0.5) * (SECTOR - 6);
        const len = 3 + rand() * 2.5, rot = rand() * Math.PI;
        if (inRoad(x, z)) continue;
        if (i < 2) log(x, z, len, rot); else rocks(x, z, true);
      }
      trees(16 + Math.floor(rand() * 8), archetype === 'camlik' ? 'pineSnow' : rand() < 0.5 ? 'pine' : 'leaf');
    } else if (archetype === 'kaya') {
      // Kayalık: büyük kaya kümeleri (siper) ve seyrek ağaç
      for (let i = 0; i < 6; i++) {
        const x = (rand() - 0.5) * (SECTOR - 5), z = (rand() - 0.5) * (SECTOR - 5);
        if (inRoad(x, z)) continue;
        rocks(x, z, i < 4);
        if (i < 3) rocks(x + 1.6, z + (rand() - 0.5) * 2, false);
      }
      trees(6 + Math.floor(rand() * 4), this.theme.zemin === 'kar' ? 'pineSnow' : 'pine');
    } else if (archetype === 'kulube') {
      // Ahşap kulübe: beşik çatılı; yanında odun yığını (devrilebilir)
      const w = 5 + rand() * 2, d = 4 + rand() * 1.5, h = 2.6;
      const x = (rand() - 0.5) * (SECTOR - 10), z = (rand() - 0.5) * (SECTOR - 10);
      if (!inRoad(x, z) && solid(G.box, M.woodWall, x, h / 2, z, w, h, d)) {
        const roof = new THREE.Mesh(G.prism, M.bark);
        roof.scale.set(w + 0.7, 1.5, d + 0.7);
        roof.position.set(center.x + x, h + 0.75, center.z + z);
        roof.castShadow = roof.receiveShadow = true;
        group.add(roof);
        for (let k = 0; k < 3; k++) {
          prop(G.cyl, M.bark, x + w / 2 + 1.2, 0.3 + k * 0.01, z - 1 + k * 0.7, 0.5, 0.6, 0.5, 18);
        }
      }
      log((rand() - 0.5) * (SECTOR - 8), (rand() - 0.5) * (SECTOR - 8), 4, rand() * Math.PI);
      trees(9 + Math.floor(rand() * 5), 'leaf');
    } else {
      // avlu: dağınık sandık yığınları, paletler, çit
      const stacks = 2 + Math.floor(rand() * 3);
      for (let s = 0; s < stacks; s++) {
        const gx = (rand() - 0.5) * (SECTOR - 7);
        const gz = (rand() - 0.5) * (SECTOR - 7);
        if (inRoad(gx, gz)) continue;
        const n = 1 + Math.floor(rand() * 3);
        let y = 0;
        for (let i = 0; i < n; i++) {
          const sz2 = 1.6 + rand() * 0.8;
          solid(G.box, M.crate, gx + (rand() - 0.5) * 0.6, y + sz2 / 2, gz + (rand() - 0.5) * 0.6,
            sz2, sz2, sz2, rand() * 0.4);
          y += sz2;
        }
      }
      // Tel çit hattı
      if (rand() < 0.6) {
        const fz = (rand() - 0.5) * (SECTOR - 6);
        for (let i = -4; i <= 4; i++) {
          const x = i * 2.6;
          if (inRoad(x, fz)) continue;
          solid(G.box, M.darkSteel, x, 1.3, fz, 0.12, 2.6, 0.12);
          const panel = new THREE.Mesh(G.box, M.darkSteel);
          panel.scale.set(2.5, 2.3, 0.04);
          panel.position.set(center.x + x + 1.3, 1.35, center.z + fz);
          panel.material = M.darkSteel;
          group.add(panel);
        }
      }
      for (let i = 0; i < 2 + rand() * 3; i++) {
        const x = (rand() - 0.5) * (SECTOR - 4), z = (rand() - 0.5) * (SECTOR - 4);
        if (!inRoad(x, z)) prop(G.cyl, M.barrel, x, 0.56, z, 0.84, 1.12, 0.84, 34);
      }
    }

    // ── Siper hatları (her sektörde) ───────────────────────────────────
    // Sandıklardan göğüs hizasında duvarlar: ayakta (göz 1.66 m) üstünden
    // ateş edilir, çömelince (göz 1.10 m) tamamen saklanılır. Düşman
    // mermileri sağlam engellere takıldığı için gerçek koruma sağlar.
    this._buildTrenches(rand, center, group, colliders, solids, bodies, cover, inRoad);

    this.scene.add(group);
    this.sectors.set(key, {
      ix, iz, group, colliders, solids, bodies, props, cover, center, archetype,
      lastSeen: performance.now() / 1000,
    });
    this._dirty = true;
    this.stats.built++;
  }

  /* Bir sektöre 2–3 siper mevzisi kurar. Mevzi biçimleri gerçek sahra
     tahkimatından: düz hat, L (yan kanatlı) ve U (üç yanı kapalı yuva).
     Mevzi, mevcut engellerle çakışmayan bir yer bulunana dek denenir.   */
  _buildTrenches(rand, center, group, colliders, solids, bodies, cover, inRoad) {
    const M = this.materials;
    const H = TRENCH_H;
    const taken = colliders.map((b) => b.clone().expandByScalar(1.6));

    const free = (box) => !taken.some((t) => t.intersectsBox(box))
      && this.inBounds(box.min.x, box.min.z, 2) && this.inBounds(box.max.x, box.max.z, 2);

    /* Tek duvar: sandıklar tek geometriye kaynaşır; çarpışma tek kutu. */
    const wall = (cx, cz, len, alongX) => {
      const parts = [];
      const bags = [];
      const n = Math.max(2, Math.round(len / 1.2));
      const step = len / n;
      for (let i = 0; i < n; i++) {
        const t = -len / 2 + step * (i + 0.5);
        const w = step * (0.94 + rand() * 0.05);
        const d = 0.95 + rand() * 0.15;
        const h = H - rand() * 0.08;
        const gx = new THREE.BoxGeometry(alongX ? w : d, h, alongX ? d : w);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(
            (alongX ? t : (rand() - 0.5) * 0.06),
            h / 2,
            (alongX ? (rand() - 0.5) * 0.06 : t),
          ),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (rand() - 0.5) * 0.07, 0)),
          new THREE.Vector3(1, 1, 1),
        );
        gx.applyMatrix4(m);
        parts.push(gx);
        // Yer yer üstte kum torbası sırası: siperi 20 cm yükseltir
        if (rand() < 0.45) {
          const bg = new THREE.SphereGeometry(0.5, 9, 6);
          bg.scale(alongX ? w * 0.95 : 0.85, 0.24, alongX ? 0.85 : w * 0.95);
          bg.translate(alongX ? t : 0, h + 0.1, alongX ? 0 : t);
          bags.push(bg);
        }
      }
      const geo = mergeGeometries(parts, false);
      parts.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(geo, M.crate);
      mesh.position.set(cx, 0, cz);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      solids.push(mesh);
      if (bags.length) {
        const bmesh = new THREE.Mesh(mergeGeometries(bags, false), M.sandbag);
        bags.forEach((g) => g.dispose());
        bmesh.position.copy(mesh.position);
        bmesh.castShadow = bmesh.receiveShadow = true;
        group.add(bmesh);
        solids.push(bmesh);
      }

      const sx = alongX ? len : 1.1;
      const sz = alongX ? 1.1 : len;
      const box = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(cx, H / 2, cz), new THREE.Vector3(sx, H, sz),
      );
      colliders.push(box);
      taken.push(box.clone().expandByScalar(1.6));
      bodies.push(this.physics.addStaticBox({ x: cx, y: H / 2, z: cz }, { x: sx, y: H, z: sz }));

      // Siper noktaları: iki uzun yüz boyunca 1.5 m'de bir
      const count = Math.max(1, Math.floor(len / 1.5));
      for (const side of [-1, 1]) {
        for (let i = 0; i < count; i++) {
          const t = -len / 2 + (len / count) * (i + 0.5);
          const nx = alongX ? 0 : side;
          const nz = alongX ? side : 0;
          cover.push({
            pos: new THREE.Vector3(
              cx + (alongX ? t : side * (0.55 + 0.55)),
              0,
              cz + (alongX ? side * (0.55 + 0.55) : t),
            ),
            normal: new THREE.Vector3(nx, 0, nz),
            height: H,
            taken: null,
            trench: true,
          });
        }
      }
    };

    const count = 2 + Math.floor(rand() * 2);
    for (let k = 0; k < count; k++) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const x = center.x + (rand() - 0.5) * (SECTOR - 8);
        const z = center.z + (rand() - 0.5) * (SECTOR - 8);
        if (inRoad(x - center.x, z - center.z)) continue;
        const alongX = rand() < 0.5;
        const len = 4.8 + rand() * 3.6;
        const shape = rand();           // < .4 düz, < .75 L, değilse U
        const wing = 2.4 + rand() * 1.2;
        const dir = rand() < 0.5 ? -1 : 1;

        // Mevzinin kapladığı alan (kanatlar dâhil) boş mu?
        const span = len / 2 + 0.6;
        const box = new THREE.Box3(
          new THREE.Vector3(x - (alongX ? span : wing + 0.6), 0, z - (alongX ? wing + 0.6 : span)),
          new THREE.Vector3(x + (alongX ? span : wing + 0.6), H, z + (alongX ? wing + 0.6 : span)),
        );
        if (!free(box)) continue;

        wall(x, z, len, alongX);
        if (shape >= 0.4) {
          // Yan kanat(lar): ana duvarın ucundan arkaya doğru
          const ends = shape < 0.75 ? [dir] : [-1, 1];
          for (const e of ends) {
            const ox = alongX ? e * (len / 2 + 0.55) : dir * (wing / 2 + 0.55);
            const oz = alongX ? dir * (wing / 2 + 0.55) : e * (len / 2 + 0.55);
            wall(x + ox, z + oz, wing, !alongX);
          }
        }
        break;
      }
    }
  }

  _releaseSector(key) {
    const s = this.sectors.get(key);
    if (!s) return;

    this.scene.remove(s.group);
    const shared = new Set(Object.values(this.geo));
    s.group.traverse((o) => {
      if (o.isMesh && o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
    });
    for (const body of s.bodies) this.physics.remove(body);
    for (const entry of s.props ?? []) {
      const i = this.props.indexOf(entry);
      if (i >= 0) this.props.splice(i, 1);
      this.propByBox.delete(entry.box);
      this.propByMesh.delete(entry.mesh);
    }

    this.sectors.delete(key);
    this._dirty = true;
    this.stats.released++;
  }

  /* ── Her kare: hangi sektörler gerekli? ─────────────────────────────── */

  /** Sabit şehir parçalarını kaydeder (tank modunda gizlenebilsinler). */
  _statik(obj) {
    this.statikler.push(obj);
    this.scene.add(obj);
    return obj;
  }

  /**
   * Alanı değiştirir (maps.js): gökyüzü, sis, ışık, zemin, yollar ve çevre
   * duvarı hemen değişir; sektörler sökülür, akış onları yeni alanın
   * arketipleriyle yeniden kurar.
   */
  setTheme(map) {
    if (!map) return;
    const changed = map.id !== this.theme?.id;
    this.theme = map;
    const scene = this.scene;
    const sky = themedSkyTexture(map.gok);
    scene.background = sky;
    scene.environment = sky;
    scene.fog.color.setHex(map.sis.renk);
    scene.fog.near = map.sis.yakin;
    scene.fog.far = map.sis.uzak;
    this.hemi.color.setHex(map.hemi[0]);
    this.hemi.groundColor.setHex(map.hemi[1]);
    this.hemi.intensity = map.hemi[2];
    this.sun.color.setHex(map.gunes[0]);
    this.sun.intensity = map.gunes[1];
    this.fill.intensity = map.dolgu;
    this.renderer.toneMappingExposure = map.pozlama;

    const M = this.materials;
    const zemin = { beton: () => concreteTexture(26), kum: () => sandTexture(26),
      cimen: () => grassTexture(26), kar: () => snowTexture(26) }[map.zemin] ?? (() => concreteTexture(26));
    M.floor.map = zemin();
    M.floor.needsUpdate = true;

    // Yollar: sanayide asfalt, diğer alanlarda toprak (kar alanında karlı)
    if (map.yol === 'asfalt') {
      this.roads.forEach((r, i) => { r.material = this._roadMats[i]; });
    } else {
      const tint = map.yol === 'toprak-kar' ? '#8b8780' : map.zemin === 'cimen' ? '#6b5a3e' : '#9c7f55';
      this._dirtMat ??= {};
      if (!this._dirtMat[tint]) {
        const tex = dirtTexture(1, tint).clone();
        tex.repeat.set((GRID * SECTOR) / 10, 1);
        tex.needsUpdate = true;
        this._dirtMat[tint] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
      }
      for (const r of this.roads) r.material = this._dirtMat[tint];
    }
    const duvar = { beton: M.wall, kerpic: M.mud, tahta: M.woodWall }[map.duvar] ?? M.wall;
    for (const w of this.perimeter) w.material = duvar;

    if (changed) {
      for (const key of [...this.sectors.keys()]) this._releaseSector(key);
      this._dirty = true;
    }
  }

  /** Görev yapısı ekler: { colliders, solids, cover } akışla sökülmez. */
  addFixture(f) {
    this.fixtures.push(f);
    this._dirty = true;
  }

  removeFixture(f) {
    const i = this.fixtures.indexOf(f);
    if (i >= 0) this.fixtures.splice(i, 1);
    this._dirty = true;
  }

  /** Arsa değişince bütün sektörler sökülür; akış onları yeniden kurar. */
  setClearZone(zone) {
    this.clearZone = zone;
    for (const key of [...this.sectors.keys()]) this._releaseSector(key);
    this._dirty = true;
  }

  /** Tank modunda şehir haritası gizlenir; ışık ve gökyüzü kalır. */
  setVisible(acik) {
    this.gorunur = acik;
    for (const o of this.statikler) o.visible = acik;
    for (const s of this.sectors.values()) {
      if (s?.group) s.group.visible = acik;
    }
  }

  update(camera, playerPos, now, budget = 2) {
    this._projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreen);

    const [px, pz] = this.sectorIndexAt(playerPos.x, playerPos.z);
    const needed = new Set();

    for (let ix = 0; ix < GRID; ix++) {
      for (let iz = 0; iz < GRID; iz++) {
        const center = this.sectorCenter(ix, iz);
        const dist = Math.hypot(center.x - playerPos.x, center.z - playerPos.z);

        const near = Math.abs(ix - px) <= KEEP_RING && Math.abs(iz - pz) <= KEEP_RING;
        let visible = false;
        if (!near && dist < VIEW_DIST) {
          this._box.setFromCenterAndSize(
            new THREE.Vector3(center.x, WALL_H / 2, center.z),
            new THREE.Vector3(SECTOR, WALL_H * 2, SECTOR),
          );
          visible = this._frustum.intersectsBox(this._box);
        }

        if (near || visible) {
          const k = this.key(ix, iz);
          needed.add(k);
          const existing = this.sectors.get(k);
          if (existing) existing.lastSeen = now;
        }
      }
    }

    let built = 0;
    for (const key of needed) {
      if (this.sectors.has(key)) continue;
      const [ix, iz] = key.split(',').map(Number);
      this._buildSector(ix, iz);
      if (++built >= budget) break;
    }

    for (const [key, s] of this.sectors) {
      if (needed.has(key)) continue;
      if (now - s.lastSeen > 5) this._releaseSector(key);
    }

    // Gölge kamerası oyuncuyu takip etsin (geniş haritada gölge kaybolmasın)
    if (this.sun) {
      this.sun.position.copy(this.sunDir).multiplyScalar(90)
        .add(new THREE.Vector3(playerPos.x, 0, playerPos.z));
      this.sun.target.position.set(playerPos.x, 0, playerPos.z);
      this.sun.target.updateMatrixWorld();
    }

    // Güneş diski: kameradan sabit uzaklıkta, ışıkla aynı yönde
    if (this.sunDisc) {
      const camPos = camera.getWorldPosition(new THREE.Vector3());
      this.sunDisc.position.copy(camPos).addScaledVector(this.sunDir, 180);
      this.sunDisc.quaternion.copy(camera.quaternion);    // hep kameraya dönük
    }

    this.stats.active = this.sectors.size;
    if (this._dirty) this._rebuildIndex();
    this._refreshProps();
  }

  /** Devrilebilen eşyaların çarpışma kutularını mevcut konumlarına taşır. */
  _refreshProps() {
    this.colliders.length = this._staticEnd;
    for (const p of this.props) {
      // Devrilmiş eşya yatar: kutuyu da ona göre genişlet
      const tilted = Math.abs(p.mesh.quaternion.x) + Math.abs(p.mesh.quaternion.z) > 0.35;
      const s = p.size;
      const size = tilted
        ? new THREE.Vector3(Math.max(s.x, s.y), Math.min(s.x, s.y), Math.max(s.z, s.y))
        : s;
      p.box.setFromCenterAndSize(p.mesh.position, size);
      this.colliders.push(p.box);
    }
  }

  /** Mermi bir eşyaya isabet ederse onu devirir/savurur. */
  hitProp(mesh, dir, point, force = 9) {
    const entry = this.propByMesh.get(mesh);
    if (!entry) return false;
    // Çarpma noktası kütle merkezinin neresine denk geldiyse oradan iter:
    // üstünden vurulan varil devrilir, ortasından vurulan kayar.
    const rel = point.clone().sub(entry.mesh.position);
    this.physics.impulse(
      entry.body,
      dir.x * force, dir.y * force * 0.3, dir.z * force,
      rel.x, rel.y, rel.z,
    );
    return true;
  }

  /** Oyuncu bir eşyaya dayandığında onu iter (kutular savrulur). */
  pushProp(box, dirX, dirZ, force = 2.6) {
    const entry = this.propByBox.get(box);
    if (!entry) return;
    this.physics.impulse(
      entry.body,
      dirX * force, 0.4, dirZ * force,
      0, -entry.size.y * 0.25, 0,
    );
  }

  _rebuildIndex() {
    this.colliders.length = this._staticColliders;
    this.solids.length = this._staticSolids;
    this.cover = [];
    for (const f of this.fixtures) {
      this.colliders.push(...f.colliders);
      this.solids.push(...f.solids);
      this.cover.push(...f.cover);
    }
    for (const s of this.sectors.values()) {
      this.colliders.push(...s.colliders);
      this.solids.push(...s.solids);
      if (s.cover) this.cover.push(...s.cover);
    }
    this._staticEnd = this.colliders.length;   // bundan sonrası hareketli eşya
    this._dirty = false;
  }

  /**
   * Tehdide karşı koruyan en uygun siperi bulur.
   * @param from     birimin konumu
   * @param threat   tehdidin konumu (düşman/oyuncu)
   * @param owner    mevziyi tutacak birim (aynı siperi iki kişi kapmasın)
   * @param maxDist  arama yarıçapı
   */
  findCover(from, threat, owner, maxDist = 26, advance = false) {
    let best = null;
    let bestScore = -Infinity;
    const nowThreat = Math.hypot(threat.x - from.x, threat.z - from.z);

    for (const c of this.cover) {
      if (c.taken && c.taken !== owner && c.taken.alive !== false) continue;

      const d = Math.hypot(c.pos.x - from.x, c.pos.z - from.z);
      if (d > maxDist) continue;

      // Siper, tehdidin TERS tarafında olmalı: normal tehditten uzağa baksın
      const tx = threat.x - c.pos.x;
      const tz = threat.z - c.pos.z;
      const tl = Math.hypot(tx, tz) || 1;
      const facing = -(c.normal.x * (tx / tl) + c.normal.z * (tz / tl));
      if (facing < 0.25) continue;             // tehdide açık mevzi

      // Tehdide çok yakın siper de işe yaramaz
      const threatDist = Math.hypot(tx, tz);
      let score = facing * 2.2 - d * 0.1 + Math.min(threatDist, 30) * 0.05;
      // Sandık siper hattı: tam boy korumalı, tercih edilir
      if (c.trench) score += 0.6;
      // Kararlılık: mevcut siper, benzer bir başkasına kaprisle bırakılmasın
      if (!advance && c === owner?.cover) score += 0.8;
      // İlerlerken: hedefe yaklaştıran siper ödüllenir, şimdiki yer cezalı
      if (advance) {
        score += (nowThreat - threatDist) * 0.18;
        if (c === owner?.cover) score -= 3;
        if (threatDist < 9) continue;
      }
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    if (best) {
      if (owner?.cover && owner.cover !== best) owner.cover.taken = null;
      best.taken = owner;
    }
    return best;
  }

  /** Oyuncuya belirli uzaklıkta, harita içinde doğma noktası. */
  spawnPoint(playerPos, minDist = 24, maxDist = 48) {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = minDist + Math.random() * (maxDist - minDist);
      const x = playerPos.x + Math.cos(a) * r;
      const z = playerPos.z + Math.sin(a) * r;
      if (this.inBounds(x, z, 3)) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(playerPos.x, 0, playerPos.z - minDist);
  }

  inBounds(x, z, margin = 1.4) {
    const lim = this.half - margin;
    return x > -lim && x < lim && z > -lim && z < lim;
  }
}
