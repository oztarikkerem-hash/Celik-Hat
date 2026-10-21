/* Asker "impostor"ları: uzaktaki binlerce asker için gerçek modelden
   üretilmiş resimler.

   Görev başında gerçek asker modeli (SWAT / FSB, tüfeğiyle) ayrı bir
   sahnede 8 açıdan ve 12 pozdan (bekleme, nişan, çömelme, ölü, 8 koşu
   karesi) bir dokuya çizilir. Uzaktaki her asker, kameraya dönük bir kart
   üzerinde o anki açısına ve pozuna uyan kareyi gösterir: binlerce asker
   tek çizim çağrısıyla, gerçek modelin dokusu ve silüetiyle görünür.

   Işık oyunun güneş/gök ışığına benzetilir (kart ışıksız çizilir, ışık
   resmin içindedir). Doku yarım kayan noktalı ve doğrusal: sahnedeki
   ton eşleme (ACES) kartlara da aynen uygulanır.                        */

import * as THREE from 'three';
import { Soldier } from './soldier.js';

export const IMP = {
  angles: 8,
  frames: 12,         // 0 bekleme · 1 nişan · 2 çömelme · 3 ölü · 4–11 koşu
  cell: 128,          // piksel
  size: 2.4,          // kartın kapsadığı kare (m)
  base: -0.1,         // kartın alt kenarı (m)
};
export const POSE = { idle: 0, aim: 1, crouch: 2, dead: 3, run: 4 };

/**
 * @param game     Game (renderer, world ışıkları)
 * @param factory  SoldierFactory (SWAT ya da FSB)
 * @param rifle    tüfek modeli (gear.makeRifle) ya da null
 * @returns THREE.Texture (atlas)
 */
export function bakeAtlas(game, factory, rifle) {
  const R = game.renderer;
  const { angles, frames, cell, size, base } = IMP;
  // Yarım kayan noktalı (koyu tonlarda bantlaşma olmasın); desteklenmiyorsa 8 bit
  const half16 = R.extensions.has('EXT_color_buffer_float') || R.extensions.has('EXT_color_buffer_half_float');
  const rt = new THREE.WebGLRenderTarget(frames * cell, angles * cell, {
    type: half16 ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: true, samples: 0,
  });
  rt.texture.generateMipmaps = true;
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  rt.texture.magFilter = THREE.LinearFilter;

  const scene = new THREE.Scene();
  const W = game.world;
  scene.add(new THREE.HemisphereLight(W.hemi.color, W.hemi.groundColor, W.hemi.intensity));
  const sun = new THREE.DirectionalLight(W.sun.color, W.sun.intensity);
  sun.position.copy(W.sunDir).multiplyScalar(10);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(W.fill.color, W.fill.intensity);
  fill.position.copy(W.fill.position).normalize().multiplyScalar(10);
  scene.add(fill);

  const s = new Soldier(factory.create(), { team: 'ally', rifle, tint: null });
  scene.add(s.root);
  s.root.updateMatrixWorld(true);

  const half = size / 2;
  // Görüş kutusu kameranın bakış merkezine göredir (dünya yüksekliğine değil)
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 40);
  const EL = 0.14;                       // ~8° yukarıdan bakış

  const pose = (name, t) => {
    const acts = s.actions;
    for (const a of Object.values(acts)) a.stop();
    if (s.rifle) s.rifle.visible = name !== 'death';
    s.body.rotation.y = Math.PI;
    s.body.position.set(0, 0, 0);
    const a = acts[name];
    if (!a) return;
    a.reset();
    a.setEffectiveWeight(1);
    a.play();
    a.time = t;
    s.mixer.update(0);
    if (name === 'crouch' && s._crouchDurus?.yaw) s.body.rotation.y = Math.PI + s._crouchDurus.yaw;
    s.root.updateMatrixWorld(true);
    if (name !== 'death') s._fitRifleToHand(0);
    else {
      // Ölü: yere uzanan gövde karenin dışına taşmasın — kalça ortaya
      const hp = new THREE.Vector3().setFromMatrixPosition(s.bones.Hips.matrixWorld);
      const k = 1 / (s.root.scale.x || 1);
      s.body.position.x -= hp.x * k;
      s.body.position.z -= hp.z * k;
    }
    s.root.updateMatrixWorld(true);
  };

  const prevTarget = R.getRenderTarget();
  const prevClear = R.getClearColor(new THREE.Color());
  const prevAlpha = R.getClearAlpha();
  const prevAuto = R.autoClear;
  const prevShadow = R.shadowMap.autoUpdate;
  R.shadowMap.autoUpdate = false;
  R.setRenderTarget(rt);
  R.setClearColor(0x000000, 0);
  R.clear(true, true, true);
  R.autoClear = false;
  rt.scissorTest = true;

  const dur = (n) => s.actions[n]?.getClip().duration ?? 1;
  const poses = [
    ['idle', 0.3],
    ['fire', dur('fire') * 0.12],
    ['crouch', s._crouchDurus?.t ?? 0],
    ['death', dur('death') - 0.01],
  ];
  for (let k = 0; k < 8; k++) poses.push(['run', (k / 8) * dur('run')]);

  for (let f = 0; f < frames; f++) {
    pose(...poses[f]);
    for (let a = 0; a < angles; a++) {
      const ang = (a / angles) * Math.PI * 2;
      cam.position.set(Math.sin(ang) * 12, base + half + 12 * EL, Math.cos(ang) * 12);
      cam.lookAt(0, base + half, 0);
      rt.viewport.set(f * cell, a * cell, cell, cell);
      rt.scissor.set(f * cell, a * cell, cell, cell);
      R.setRenderTarget(rt);
      R.clear(true, true, false);
      R.render(scene, cam);
    }
  }

  rt.scissorTest = false;
  rt.viewport.set(0, 0, rt.width, rt.height);
  R.autoClear = prevAuto;
  R.setClearColor(prevClear, prevAlpha);
  R.setRenderTarget(prevTarget);
  R.shadowMap.autoUpdate = prevShadow;
  scene.remove(s.root);
  return rt.texture;
}

/** Atlastan hücre seçen kart malzemesi (ışıksız: ışık resmin içinde). */
export function impostorMaterial(atlas) {
  const mat = new THREE.MeshBasicMaterial({
    map: atlas, alphaTest: 0.42, side: THREE.DoubleSide, fog: true,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGrid = { value: new THREE.Vector2(IMP.frames, IMP.angles) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aCell;
        uniform vec2 uGrid;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vMapUv = (vMapUv + vec2(mod(aCell, uGrid.x), floor(aCell / uGrid.x + 0.001))) / uGrid;`);
  };
  return mat;
}

/** Kart geometrisi: alt kenarı zeminde, kameraya dönecek kare. */
export function impostorGeometry() {
  return new THREE.PlaneGeometry(IMP.size, IMP.size).translate(0, IMP.base + IMP.size / 2, 0);
}

/**
 * Hücre: satır = görüş açısı, sütun = poz karesi.
 * @param heading  askerin yönü (0 → −Z)  @param viewAng  askerden kameraya açı
 */
export function cellIndex(heading, viewAng, frame) {
  const n = IMP.angles;
  let a = viewAng - heading;
  a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const k = Math.round(a / ((Math.PI * 2) / n)) % n;
  return k * IMP.frames + frame;
}
