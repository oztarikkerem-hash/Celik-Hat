/* Türk bayrağı: resmî oranlarla kanvasa çizilir, gönderde dalgalanır.

   Oranlar (Türk Bayrağı Kanunu, G = bayrağın eni):
     boy 1.5 G · ay dış dairesi merkezi gönderden 0.5 G, çapı 0.5 G ·
     iç daire merkezi dıştakinden 0.0625 G sağda, çapı 0.4 G ·
     yıldızın çevrel dairesi çapı 0.25 G, merkezi gönderden ≈0.821 G,
     bir ucu göndere bakar.

   Dalga köşe gölgelendiricisinde: gönderden uzaklaştıkça genliği artan,
   rüzgâr yönünde ilerleyen iki sinüs; ışık doğru düşsün diye normal de
   eğimden hesaplanır. Zaman `flag.userData.tick(dt)` ile ilerler.      */

import * as THREE from 'three';

let _tex = null;

export function turkishFlagTexture() {
  if (_tex) return _tex;
  const G = 512, W = G * 1.5;
  const c = document.createElement('canvas');
  c.width = W; c.height = G;
  const g = c.getContext('2d');
  g.fillStyle = '#e30a17';
  g.fillRect(0, 0, W, G);
  const cy = G / 2;
  // Hilal: beyaz dış daire, üstüne kırmızı iç daire
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(0.5 * G, cy, 0.25 * G, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e30a17';
  g.beginPath(); g.arc(0.5625 * G, cy, 0.2 * G, 0, Math.PI * 2); g.fill();
  // Yıldız: beş köşe, bir ucu sola (göndere)
  const sx = 0.82083 * G, R = 0.125 * G, r = R * 0.381966;
  g.fillStyle = '#ffffff';
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = Math.PI + (k * Math.PI) / 5;          // ilk uç sola
    const rad = k % 2 === 0 ? R : r;
    const x = sx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  // Kumaş dokusu: çok hafif atkı çizgileri
  g.globalAlpha = 0.05;
  g.fillStyle = '#000';
  for (let y = 0; y < G; y += 3) g.fillRect(0, y, W, 1);
  g.globalAlpha = 1;
  _tex = new THREE.CanvasTexture(c);
  _tex.colorSpace = THREE.SRGBColorSpace;
  _tex.anisotropy = 4;
  return _tex;
}

/**
 * Gönderli bayrak. Kökü gönderin dibinde; bayrak +X yönüne dalgalanır.
 * @param poleH  gönder boyu (m)  @param flagH  bayrak eni (m)
 */
export function makeFlag(poleH = 8, flagH = 1.6) {
  const root = new THREE.Group();
  root.name = 'flag';
  const steel = new THREE.MeshStandardMaterial({ color: 0xd9d9d4, roughness: 0.35, metalness: 0.85 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, poleH, 12), steel);
  pole.position.y = poleH / 2;
  pole.castShadow = true;
  root.add(pole);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xd8b04a, roughness: 0.3, metalness: 0.9 }));
  knob.position.y = poleH + 0.05;
  root.add(knob);

  const flagW = flagH * 1.5;
  const geo = new THREE.PlaneGeometry(flagW, flagH, 36, 16);
  geo.translate(flagW / 2, 0, 0);                  // gönder kenarı x = 0
  const mat = new THREE.MeshStandardMaterial({
    map: turkishFlagTexture(), side: THREE.DoubleSide, roughness: 0.8, metalness: 0,
  });
  const uni = { uTime: { value: 0 }, uLen: { value: flagW }, uAmp: { value: flagH * 0.12 } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uLen; uniform float uAmp;
        float flagWave(vec2 p) {
          float k = clamp(p.x / uLen, 0.0, 1.0);
          float a = uAmp * (0.15 + k * k * 1.6);
          return a * (sin(p.x * 2.6 - uTime * 6.0 + p.y * 0.7) * 0.7
                    + sin(p.x * 5.1 - uTime * 9.3 - p.y * 1.3) * 0.3);
        }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float e = 0.02;
        float w0 = flagWave(position.xy);
        float dx = (flagWave(position.xy + vec2(e, 0.0)) - w0) / e;
        float dy = (flagWave(position.xy + vec2(0.0, e)) - w0) / e;
        objectNormal = normalize(vec3(-dx, -dy, 1.0));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.z += flagWave(position.xy);
        // Uç kenar hafif aşağı sarkar
        transformed.y -= pow(clamp(position.x / uLen, 0.0, 1.0), 2.0) * uAmp * 0.6;`);
  };
  const cloth = new THREE.Mesh(geo, mat);
  cloth.position.set(0.05, poleH - flagH / 2 - 0.15, 0);
  cloth.castShadow = true;
  root.add(cloth);

  root.userData.cloth = cloth;
  root.userData.tick = (dt) => { uni.uTime.value += dt; };
  /** Bayrağı gönderde yükseltir (0 = dipte, 1 = tepede). */
  root.userData.raise = (t) => {
    const top = poleH - flagH / 2 - 0.15, bottom = flagH / 2 + 0.8;
    cloth.position.y = bottom + (top - bottom) * THREE.MathUtils.clamp(t, 0, 1);
  };
  return root;
}
