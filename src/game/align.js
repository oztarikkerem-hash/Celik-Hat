/* Model hizalama.

   Silah modelleri farklı kaynaklardan geliyor: kimi X ekseni boyunca, kimi
   Y boyunca uzanıyor, kimi ters duruyor, kiminde sahnede unutulmuş arka plan
   düzlemi ya da uzakta kalmış ufak bir parça var. Bu modül hepsini aynı
   sözleşmeye sokar:

     -Z = ileri (namlu)      +Y = yukarı      orijin = dipçik ucu

   Ölçüler sınırlayıcı kutu yerine YÜZDELİK sınırlarla alınır: tek bir uzak
   parça ya da dev düzlem, silahın ölçeğini bozmasın diye %1'lik uçlar atılır. */

import * as THREE from 'three';

const PCT = 0.01;   // alt/üst %1 kırpılır

/** Köşe noktalarını modelin dünya uzayında (kök dönüşümü dahil) örnekler. */
function sampleVertices(root, maxPerMesh = 220) {
  root.updateWorldMatrix(true, true);
  const out = [];
  const v = new THREE.Vector3();

  root.traverse((o) => {
    const pos = o.isMesh && o.visible && o.geometry?.attributes?.position;
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / maxPerMesh));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      out.push(v.clone());
    }
  });
  return out;
}

/** Uçlardaki %1'i atan dayanıklı sınırlar. */
function robustBounds(verts) {
  const axes = ['x', 'y', 'z'];
  const min = new THREE.Vector3();
  const max = new THREE.Vector3();

  for (const a of axes) {
    const vals = verts.map((v) => v[a]).sort((p, q) => p - q);
    const lo = Math.floor(vals.length * PCT);
    const hi = Math.min(vals.length - 1, Math.ceil(vals.length * (1 - PCT)));
    min[a] = vals[lo];
    max[a] = vals[hi];
  }
  return { min, max, size: max.clone().sub(min), center: min.clone().add(max).multiplyScalar(0.5) };
}

/* Bazı .blend dosyalarında silahın yanında arka plan düzlemi ya da zemin
   kalmış. Ölçüt modelin KENDİ gerçek boyudur (yüzdelik sınırlar bunu zaten
   aykırı parçalardan arındırır): silahın tamamından belirgin biçimde büyük
   bir parça, silahın parçası olamaz. Böylece ray dişi gibi minik detaylar
   yanlışlıkla atılmaz.                                                    */
function pruneOutliers(root) {
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o.geometry) meshes.push(o); });
  if (meshes.length < 4) return [];

  const robustDiag = robustBounds(sampleVertices(root, 60)).size.length();
  if (!robustDiag) return [];

  root.updateWorldMatrix(true, true);
  const removed = [];
  const size = new THREE.Vector3();

  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    m.geometry.boundingBox.getSize(size);
    size.multiply(m.getWorldScale(new THREE.Vector3()));

    // 1) Silahın tamamından belirgin biçimde büyük parça → zemin/arka plan
    if (size.length() > robustDiag * 1.8) { removed.push(m); continue; }

    // 2) Şablon (blueprint) levhası: Blender'da modelin yanına konan,
    //    referans görseli taşıyan düz dörtgen. Üç işareti birlikte arıyoruz —
    //    kalınlığı sıfıra yakın, üçgen sayısı çok az, boyutu silahla yarışıyor.
    const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
    const flat = dims[0] < dims[2] * 0.02;          // kalınlığı yok denecek kadar az
    const tris = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    const large = size.length() > robustDiag * 0.12;
    // Not: "Plane" ADI yeterli değil — bazı modellerde gerçek silah parçaları
    // da öyle adlanmış. Üç ölçüt birlikte sağlanmalı.
    if (flat && tris <= 12 && large) removed.push(m);
  }

  for (const m of removed) m.parent?.remove(m);
  return removed.map((m) => m.name || '(isimsiz)');
}

/**
 * @param {THREE.Object3D} root   GLTF sahnesi (yerinde değiştirilir)
 * @param {number} targetLength   hedef uzunluk (m)
 * @param {object} opts           { flipForward, flipUp, roll } — otomatiği ezer
 */
export function normalizeModel(root, targetLength, opts = {}) {
  const pruned = pruneOutliers(root);

  // ── 1. En uzun ekseni ileriye (-Z), ikinciyi yukarı (+Y) çevir ───────
  let verts = sampleVertices(root);
  if (!verts.length) return { muzzle: new THREE.Vector3(), diagnostics: { empty: true } };

  let b = robustBounds(verts);
  const dims = [b.size.x, b.size.y, b.size.z];
  const preSize = dims.map((n) => +n.toFixed(3));
  const [longIdx, upIdx, sideIdx] = [0, 1, 2].sort((a, c) => dims[c] - dims[a]);

  const cols = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  cols[longIdx].set(0, 0, -1);
  cols[upIdx].set(0, 1, 0);
  // Üçüncü kolon sağ-el sistemini korur: colX × colY = colZ
  if (sideIdx === 0) cols[0].crossVectors(cols[1], cols[2]);
  else if (sideIdx === 1) cols[1].crossVectors(cols[2], cols[0]);
  else cols[2].crossVectors(cols[0], cols[1]);

  root.applyMatrix4(new THREE.Matrix4().makeBasis(cols[0], cols[1], cols[2]));

  // ── 2. Hangi uç namlu? İnce olan uç. ────────────────────────────────
  verts = sampleVertices(root);
  b = robustBounds(verts);

  const thickness = (from, to) => {
    let sum = 0, n = 0;
    for (const v of verts) {
      if (v.z < from || v.z > to) continue;
      sum += Math.hypot(v.x - b.center.x, v.y - b.center.y);
      n++;
    }
    return n ? sum / n : 0;
  };

  const q = b.size.z * 0.22;
  const frontThick = thickness(b.min.z, b.min.z + q);
  const backThick = thickness(b.max.z - q, b.max.z);

  const flipForward = opts.flipForward ?? (frontThick > backThick * 1.15);
  if (flipForward) {
    root.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
    verts = sampleVertices(root);
    b = robustBounds(verts);
  }

  // ── 3. Ters mi duruyor? Kabza ve şarjör kütlesi altta olmalı. ────────
  let centroidY = 0;
  for (const v of verts) centroidY += v.y;
  centroidY /= verts.length;

  const flipUp = opts.flipUp ?? (centroidY > b.center.y + b.size.y * 0.1);
  if (flipUp) root.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI));

  // İleri eksen etrafında elle verilen yatırma (derece).
  if (opts.roll) root.applyMatrix4(new THREE.Matrix4().makeRotationZ(opts.roll * Math.PI / 180));

  // ── 4. Ölçek ────────────────────────────────────────────────────────
  verts = sampleVertices(root);
  b = robustBounds(verts);
  root.scale.multiplyScalar(targetLength / (b.size.z || 1));

  // ── 5. Orijini dipçik ucuna taşı ────────────────────────────────────
  verts = sampleVertices(root);
  b = robustBounds(verts);
  root.position.x -= b.center.x;
  root.position.y -= b.center.y;
  root.position.z -= b.max.z;

  verts = sampleVertices(root);
  b = robustBounds(verts);

  return {
    muzzle: new THREE.Vector3(b.center.x, b.center.y, b.min.z),
    bounds: b,
    diagnostics: {
      frontThick, backThick, centroidY, flipForward, flipUp,
      pruned, preSize, axisOrder: [longIdx, upIdx, sideIdx],
      size: b.size.toArray().map((n) => +n.toFixed(3)),
    },
  };
}
