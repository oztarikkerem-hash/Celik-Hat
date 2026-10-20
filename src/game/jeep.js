/* Askeri arazi aracı (özgün model, tamamen kodla kurulur).

   Açık kasalı, takla demirli, haki boyalı 4×4. Vehicles.spawn ile zırhlı
   araç gibi kullanılır: önü +X'e bakar, zemin y = 0. Düğüm adları zırhlı
   aracınkiyle aynı sözleşmede (wheel…wheel4, groundpoint…, hull) — böylece
   tekerlek dönüşü, direksiyon ve iniş noktaları aynı kodla çalışır.      */

import * as THREE from 'three';

const L = 4.2, W = 1.84;          // boy, en (m)
const WHEEL_R = 0.42;

export const JEEP = {
  wheelR: WHEEL_R,
  half: [2.15, 0.96],              // çarpışma kutusu yarı boyu (x, z)
  height: 1.9,
  bodyOffs: [-1.25, 0, 1.25],      // gövde boyunca çarpışma daireleri
  bodyR: 0.95,
};

export function buildJeep(color = 0x4b5434) {
  const root = new THREE.Group();
  root.name = 'jeep';
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.12 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d201b, roughness: 0.7, metalness: 0.35 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x6a6e66, roughness: 0.45, metalness: 0.8 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.95, metalness: 0 });
  const seat = new THREE.MeshStandardMaterial({ color: 0x2c2a22, roughness: 0.92 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fb8c0, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.32 });
  const lens = new THREE.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0xffe2a0, emissiveIntensity: 0.6, roughness: 0.2 });
  const rear = new THREE.MeshStandardMaterial({ color: 0x5a0d08, emissive: 0x3a0402, roughness: 0.3 });

  const hull = new THREE.Group();
  hull.name = 'hull';
  root.add(hull);
  const box = (w, h, d, x, y, z, mat = paint, parent = hull) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const tube = (a, b, r = 0.035, mat = dark) => {
    const d = b.clone().sub(a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    m.castShadow = true;
    hull.add(m);
    return m;
  };

  // Şasi ve gövde
  box(L - 0.3, 0.18, W - 0.35, 0, 0.5, 0, dark);
  box(L - 0.2, 0.5, W, 0, 0.82, 0);                         // ana gövde
  box(1.35, 0.26, W - 0.12, 1.32, 1.18, 0);                 // kaput
  box(0.06, 0.48, W - 0.3, 2.06, 0.98, 0, dark);           // ızgara
  for (let i = -3; i <= 3; i++) box(0.07, 0.4, 0.05, 2.08, 0.98, i * 0.2, steel);
  box(0.16, 0.16, W + 0.08, 2.13, 0.6, 0, dark);           // tampon
  box(0.16, 0.16, W + 0.08, -2.13, 0.62, 0, dark);
  // Çamurluklar
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(1.0, 0.1, 0.34, sx * 1.3, 1.1, sz * (W / 2 - 0.02));
  }
  // Farlar ve stoplar
  for (const sz of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.07, 16), lens);
    h.rotation.z = Math.PI / 2;
    h.position.set(2.1, 1.08, sz * 0.62);
    hull.add(h);
    box(0.04, 0.12, 0.18, -2.13, 0.9, sz * 0.72, rear);
  }
  // Ön cam çerçevesi (kaputun arkasında, hafif yatık)
  const ws = new THREE.Group();
  ws.position.set(0.62, 1.3, 0);
  ws.rotation.z = 0.22;
  hull.add(ws);
  box(0.06, 0.56, 0.06, 0, 0.28, -(W / 2 - 0.08), dark, ws);
  box(0.06, 0.56, 0.06, 0, 0.28, W / 2 - 0.08, dark, ws);
  box(0.06, 0.06, W - 0.1, 0, 0.56, 0, dark, ws);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.22, 0.5), glass);
  g.rotation.y = Math.PI / 2;
  g.position.set(0, 0.28, 0);
  ws.add(g);
  // Koltuklar, direksiyon
  for (const sz of [-0.42, 0.42]) {
    box(0.5, 0.14, 0.5, -0.05, 1.12, sz, seat);
    box(0.12, 0.56, 0.5, -0.32, 1.42, sz, seat);
  }
  box(0.6, 0.14, 1.4, -1.25, 1.12, 0, seat);                // arka sıra
  box(0.12, 0.5, 1.4, -1.52, 1.4, 0, seat);
  // Direksiyon: eğik (üstü sürücüye yatık), araç dönünce döner; üzerinde
  // sürücünün ellerinin uzandığı iki tutma noktası (saat 10 ve 2)
  const steer = new THREE.Group();
  steer.name = 'steering';
  steer.position.set(0.3, 1.44, -0.42);
  steer.rotation.z = 0.45;
  hull.add(steer);
  const face = new THREE.Group();
  face.rotation.y = Math.PI / 2;
  steer.add(face);
  const spin = new THREE.Group();
  spin.name = 'steeringSpin';
  face.add(spin);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 24), dark);
  spin.add(rim);
  for (const ang of [0, 2.2, -2.2]) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.02), dark);
    sp.position.set(Math.cos(ang - Math.PI / 2) * 0.08, Math.sin(ang - Math.PI / 2) * 0.08, 0);
    sp.rotation.z = ang - Math.PI / 2;
    spin.add(sp);
  }
  for (const [nm, x] of [['gripL', 0.15], ['gripR', -0.15]]) {
    const gp = new THREE.Object3D();
    gp.name = nm;
    gp.position.set(x, 0.075, 0);
    spin.add(gp);
  }
  tube(new THREE.Vector3(0.36, 1.4, -0.42), new THREE.Vector3(0.62, 1.12, -0.42), 0.022);
  // Takla demiri
  const rb = (x) => [new THREE.Vector3(x, 1.06, -(W / 2 - 0.1)), new THREE.Vector3(x, 1.95, -(W / 2 - 0.16)),
    new THREE.Vector3(x, 1.95, W / 2 - 0.16), new THREE.Vector3(x, 1.06, W / 2 - 0.1)];
  const [a, b, c, d] = rb(-0.62);
  tube(a, b); tube(b, c); tube(c, d);
  tube(b, new THREE.Vector3(-1.85, 1.1, -(W / 2 - 0.12)));
  tube(c, new THREE.Vector3(-1.85, 1.1, W / 2 - 0.12));
  // Yedek lastik (arkada)
  const spare = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.26, 20), tire);
  spare.rotation.z = Math.PI / 2;
  spare.position.set(-2.32, 1.12, 0);
  spare.castShadow = true;
  hull.add(spare);
  // Bidon ve kürek (yan)
  box(0.36, 0.42, 0.14, -1.6, 1.0, W / 2 + 0.07, new THREE.MeshStandardMaterial({ color: 0x3e4a2c, roughness: 0.7 }));

  // Tekerlekler: adları zırhlı araçla aynı (wheel, wheel2…), merkezleri orijinde
  const names = ['wheel', 'wheel2', 'wheel3', 'wheel4'];
  let n = 0;
  for (const sx of [1, -1]) for (const sz of [-1, 1]) {
    const w = new THREE.Group();
    w.name = names[n++];
    w.position.set(sx * 1.3, WHEEL_R, sz * (W / 2 - 0.05));
    const t = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.3, 22), tire);
    t.rotation.x = Math.PI / 2;
    t.castShadow = true;
    w.add(t);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.31, 12), steel);
    rim.rotation.x = Math.PI / 2;
    w.add(rim);
    // Diş izleri: dönüşün görünmesi için birkaç blok
    for (let k = 0; k < 8; k++) {
      const lug = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.31), tire);
      const ang = (k / 8) * Math.PI * 2;
      lug.position.set(Math.cos(ang) * WHEEL_R, Math.sin(ang) * WHEEL_R, 0);
      lug.rotation.z = ang;
      w.add(lug);
    }
    root.add(w);
  }

  // İniş noktaları: sürücü solda (−Z), yolcu sağda
  for (const [nm, x, z] of [['groundpoint', 0.0, -1.55], ['groundpoint2', 0.0, 1.55], ['groundpoint4', -1.2, -1.55]]) {
    const e = new THREE.Object3D();
    e.name = nm;
    e.position.set(x, 0, z);
    root.add(e);
  }
  return root;
}
