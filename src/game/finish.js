/* Silah kaplaması.

   Blender'dan gelen malzemeler ya düz gri ya da oyunun paletine uymuyor.
   Burada her parça adına/malzeme adına bakılarak bir ROL'e atanır (gövde,
   metal, kabza, aksan, namlu içi) ve silaha özgü palet uygulanır. Roller
   paylaşılan malzeme nesneleri kullanır: 60–100 parçalı modellerde çizim
   çağrısı patlamasın.                                                      */

import * as THREE from 'three';

/** Parça/malzeme adından rol tahmini. */
function roleOf(meshName, matName) {
  const s = `${meshName} ${matName}`.toLowerCase();

  if (/bore|muzzle|namlu_ic|barrel_in|flash/.test(s)) return 'bore';
  if (/grip|kabza|panel|rubber|stock|dipcik|dipçik|wood|ahsap|ahşap|furniture|handguard|foregrip/.test(s)) return 'grip';
  if (/krom|chrome|steel|celik|çelik|silver|metal|gunmetal|anodized/.test(s)) return 'metal';
  if (/brass|copper|bronz|pirinc|pirinç|ammo|belt|bullet|mermi|casing/.test(s)) return 'accent';
  if (/scope|optic|lens|dürbün|durbun|sight|rail/.test(s)) return 'optic';
  return 'body';
}

/** Rolden malzeme üretir (silah paletine göre). */
function makeMaterial(role, palette) {
  switch (role) {
    case 'metal':
      return new THREE.MeshStandardMaterial({
        color: palette.metal, roughness: 0.36, metalness: 0.75, envMapIntensity: 0.8,
      });
    case 'grip':
      return new THREE.MeshStandardMaterial({
        color: palette.grip, roughness: 0.72, metalness: 0.06,
      });
    case 'stock':
      // Kundak: ahşap ya da polimer — paletteki `stock`, yoksa `grip`
      return new THREE.MeshStandardMaterial({
        color: palette.stock ?? palette.grip, roughness: 0.68, metalness: 0.05,
      });
    case 'accent':
      return new THREE.MeshStandardMaterial({
        color: palette.accent, roughness: 0.38, metalness: 0.75, envMapIntensity: 0.9,
      });
    case 'optic':
      return new THREE.MeshStandardMaterial({
        color: 0x14181a, roughness: 0.22, metalness: 0.6,
      });
    case 'bore':
      return new THREE.MeshStandardMaterial({
        color: 0x08090a, roughness: 0.9, metalness: 0.2,
      });
    default:
      return new THREE.MeshStandardMaterial({
        color: palette.body, roughness: 0.5, metalness: 0.4, envMapIntensity: 0.65,
      });
  }
}

/* Bazı modellerde parçalar "Cube.001" gibi adlandırılmış — ad hiçbir şey
   söylemiyor. O durumda rolü KONUMDAN çıkarırız: hizalama sonrası silah
   -Z yönünde uzanır (namlu ucu z = -L, dipçik z = 0), yükseklik 0 çevresinde
   ortalanmıştır. Arkada ve altta kalan kütle kundak/kabza/şarjördür; en
   öndeki ince kısım namludur.                                              */
function roleByPosition(center, length, height) {
  const z = center.z / (length || 1);     // 0 = dipçik ucu, -1 = namlu ucu
  const y = center.y / (height || 1);

  // Namlu ucu ve gaz borusu: açık metal
  if (z < -0.80) return 'metal';
  // Dipçik (arka çeyrek): ahşap/polimer kundak
  if (z > -0.24) return 'stock';
  // El kundağı (namlunun altındaki orta bölge): ahşap
  if (z < -0.42 && z > -0.78 && y < 0.1) return 'stock';
  // Kabza ve şarjör: gövdenin altında kalan kütle
  if (z > -0.45 && y < -0.1) return 'grip';
  return 'body';
}

/**
 * Modeldeki tüm parçalara silahın paletini uygular.
 * Model bu noktada hizalanmış olmalıdır (align.js).
 * @returns {Map<string, THREE.Material>} rol → malzeme (sökerken dispose için)
 */
export function applyFinish(model, palette) {
  const cache = new Map();
  const meshes = [];
  model.traverse((o) => { if (o.isMesh) meshes.push(o); });
  if (!meshes.length) return cache;

  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const origin = bounds.max.z;          // dipçik ucu ≈ 0
  const midY = bounds.getCenter(new THREE.Vector3()).y;

  // Adlardan kaç parça sınıflandırılabiliyor? Azsa konuma geçeriz.
  const named = meshes.filter((o) => {
    const matName = Array.isArray(o.material)
      ? o.material.map((m) => m?.name ?? '').join(' ')
      : (o.material?.name ?? '');
    return roleOf(o.name ?? '', matName) !== 'body';
  }).length;
  const useGeometry = named < meshes.length * 0.15;

  const box = new THREE.Box3();
  const center = new THREE.Vector3();

  for (const o of meshes) {
    const matName = Array.isArray(o.material)
      ? o.material.map((m) => m?.name ?? '').join(' ')
      : (o.material?.name ?? '');

    let role = roleOf(o.name ?? '', matName);
    if (role === 'body' && useGeometry) {
      box.setFromObject(o);
      box.getCenter(center);
      role = roleByPosition(
        { z: center.z - origin, y: center.y - midY },
        size.z || 1,
        size.y || 1,
      );
    }

    if (!cache.has(role)) cache.set(role, makeMaterial(role, palette));

    // Eski malzemeyi bırak (GLB'den gelen dokular artık kullanılmıyor).
    const old = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of old) m?.dispose?.();

    o.material = cache.get(role);
  }

  return cache;
}
