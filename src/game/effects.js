/* İzli mermi, kıvılcım, duman ve isabet izleri.
   Hepsi havuzlanmış (pool) — ateş hızı yüksek silahlarda çöp toplayıcıyı
   tetiklememek için yeni nesne yaratılmaz.                                */

import * as THREE from 'three';

const TRACERS = false;      // mermi izleri (bkz. tracer)

const MAX_PARTICLES = 900;
const MAX_SMOKE = 1600;     // füze izi + geri tepme dumanı aynı anda
const MAX_TRACERS = 36;
const MAX_DECALS = 64;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this._initParticles();
    this._initSmoke();
    this._initTracers();
    this._initDecals();
  }

  /* Duman: toplamalı karışım dumanı parlatıyordu (gri duman ışık gibi
     görünür). Roket izi, geri tepme tozu ve patlama bulutu için normal
     karışımlı, saydamlığı ömürle azalan ayrı bir sistem.                 */
  _initSmoke() {
    const N = MAX_SMOKE;
    const geo = new THREE.BufferGeometry();
    this.sPos = new Float32Array(N * 3);
    this.sCol = new Float32Array(N * 4);
    this.sSize = new Float32Array(N);
    geo.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.sCol, 4));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sSize, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: window.innerHeight * 0.5 } },
      vertexShader: /* glsl */`
        attribute float size;
        attribute vec4 color;
        varying vec4 vColor;
        uniform float uScale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(-mv.z, 0.001);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec4 vColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.1, length(d)) * vColor.a;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor.rgb, a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.smoke = new THREE.Points(geo, mat);
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 2;
    this.scene.add(this.smoke);
    this.sVel = new Float32Array(N * 3);
    this.sLife = new Float32Array(N);
    this.sMax = new Float32Array(N);
    this.sBase = new Float32Array(N);
    this.sGrav = new Float32Array(N);
    this.sDrag = new Float32Array(N);
    this.sCursor = 0;
    addEventListener('resize', () => { mat.uniforms.uScale.value = window.innerHeight * 0.5; });
  }

  /**
   * Tek duman/alev topağı.
   * @param color    0xRRGGBB; sıcak renkler (alev) toplamalı sisteme gider
   * @param size     başlangıç boyu (m) — duman zamanla 2.5 katına genişler
   */
  puff(point, vel, color = 0x777066, size = 0.3, life = 1.2, grav = 0.3, drag = 1.4) {
    const c = new THREE.Color(color);
    // Parlak/sıcak renk = alev → toplamalı parçacık
    if (c.r > 0.7 && c.r > c.b * 1.6) {
      this._spawnParticle(point.x, point.y, point.z, vel.x, vel.y, vel.z,
        c.r, c.g, c.b, size, life, grav, drag);
      return;
    }
    const i = this.sCursor;
    this.sCursor = (this.sCursor + 1) % MAX_SMOKE;
    const i3 = i * 3, i4 = i * 4;
    this.sPos[i3] = point.x; this.sPos[i3 + 1] = point.y; this.sPos[i3 + 2] = point.z;
    this.sVel[i3] = vel.x; this.sVel[i3 + 1] = vel.y; this.sVel[i3 + 2] = vel.z;
    this.sCol[i4] = c.r; this.sCol[i4 + 1] = c.g; this.sCol[i4 + 2] = c.b; this.sCol[i4 + 3] = 0.7;
    this.sBase[i] = size;
    this.sSize[i] = size;
    this.sLife[i] = life;
    this.sMax[i] = life;
    this.sGrav[i] = grav;
    this.sDrag[i] = drag;
  }

  _initParticles() {
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));

    // Boyutu köşe başına sürmek için küçük bir shader; PointsMaterial tek
    // boyut verir, bize kıvılcım/duman karışımı için değişken boyut gerek.
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: window.innerHeight * 0.5 } },
      vertexShader: /* glsl */`
        attribute float size;
        varying vec3 vColor;
        uniform float uScale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(-mv.z, 0.001);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(d));
          if (a < 0.02) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMaxLife = new Float32Array(MAX_PARTICLES);
    this.pDrag = new Float32Array(MAX_PARTICLES);
    this.pGrav = new Float32Array(MAX_PARTICLES);
    this.pBaseSize = new Float32Array(MAX_PARTICLES);
    this.pCursor = 0;

    addEventListener('resize', () => {
      mat.uniforms.uScale.value = window.innerHeight * 0.5;
    });
  }

  _initTracers() {
    // Z ekseni boyunca uzanan birim silindir: uçtan uca ölçeklenir.
    const geo = new THREE.CylinderGeometry(0.012, 0.012, 1, 6, 1, true);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, -0.5);

    this.tracers = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.tracers.push({ mesh, life: 0, maxLife: 0.07 });
    }
    this.tracerCursor = 0;
  }

  _initDecals() {
    const geo = new THREE.CircleGeometry(0.07, 10);
    this.decals = [];
    for (let i = 0; i < MAX_DECALS; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x0a0a09,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }));
      mesh.visible = false;
      this.scene.add(mesh);
      this.decals.push({ mesh, life: 0 });
    }
    this.decalCursor = 0;
  }

  _spawnParticle(x, y, z, vx, vy, vz, r, g, b, size, life, grav = -9, drag = 2.4) {
    const i = this.pCursor;
    this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;

    const i3 = i * 3;
    this.pPos[i3] = x; this.pPos[i3 + 1] = y; this.pPos[i3 + 2] = z;
    this.pVel[i3] = vx; this.pVel[i3 + 1] = vy; this.pVel[i3 + 2] = vz;
    this.pCol[i3] = r; this.pCol[i3 + 1] = g; this.pCol[i3 + 2] = b;
    this.pBaseSize[i] = size;
    this.pSize[i] = size;
    this.pLife[i] = life;
    this.pMaxLife[i] = life;
    this.pGrav[i] = grav;
    this.pDrag[i] = drag;
  }

  /**
   * İzli mermi KAPALI: kullanıcı mermilerin havada iz bırakmasını istemedi
   * (namlu alevi, dumanı ve geri tepme kalır). Çağrılar (oyuncu,
   * müttefik, düşman, M2) yerinde kalsın diye işlev boş döner; açmak için
   * `TRACERS` true yapılır.
   */
  tracer(origin, end, color = 0xffd27a) {
    if (!TRACERS) return;
    const t = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % MAX_TRACERS;

    const dist = origin.distanceTo(end);
    t.mesh.position.copy(origin);
    t.mesh.lookAt(end);
    t.mesh.scale.set(1, 1, dist);
    t.mesh.material.color.setHex(color);
    t.mesh.material.opacity = 0.9;
    t.mesh.visible = true;
    t.life = t.maxLife;
  }

  /** Sert yüzey isabeti: kıvılcım + toz. */
  sparks(point, normal, color = 0xffc06a, count = 10) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const dir = normal.clone()
        .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.9))
        .normalize()
        .multiplyScalar(2 + Math.random() * 5);
      this._spawnParticle(
        point.x, point.y, point.z, dir.x, dir.y, dir.z,
        c.r, c.g, c.b, 0.03 + Math.random() * 0.03, 0.18 + Math.random() * 0.22,
      );
    }
    // Toz bulutu
    for (let i = 0; i < Math.ceil(count / 3); i++) {
      const dir = normal.clone()
        .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5))
        .normalize()
        .multiplyScalar(0.6 + Math.random());
      this._spawnParticle(
        point.x, point.y, point.z, dir.x, dir.y, dir.z,
        0.18, 0.17, 0.15, 0.12 + Math.random() * 0.1, 0.5 + Math.random() * 0.4, -0.6, 1.4,
      );
    }
  }

  /** Düşman isabeti: enerji sıçraması. */
  hitBurst(point, color = 0x8fd4ff, count = 12) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5,
      ).normalize().multiplyScalar(1.5 + Math.random() * 4);
      this._spawnParticle(
        point.x, point.y, point.z, dir.x, dir.y, dir.z,
        c.r, c.g, c.b, 0.045 + Math.random() * 0.04, 0.25 + Math.random() * 0.25, -5, 2.2,
      );
    }
  }

  /** Düşman patlaması. */
  explode(point, color = 0xff9a3c, count = 46) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5,
      ).normalize().multiplyScalar(2 + Math.random() * 9);
      const warm = Math.random() < 0.6;
      this._spawnParticle(
        point.x, point.y, point.z, dir.x, dir.y, dir.z,
        warm ? c.r : 0.5, warm ? c.g : 0.55, warm ? c.b : 0.6,
        0.05 + Math.random() * 0.07, 0.4 + Math.random() * 0.5, -7, 1.8,
      );
    }
    for (let i = 0; i < 12; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5)
        .normalize().multiplyScalar(1 + Math.random() * 2);
      this._spawnParticle(
        point.x, point.y + 0.2, point.z, dir.x, dir.y, dir.z,
        0.22, 0.2, 0.18, 0.22 + Math.random() * 0.16, 0.8 + Math.random() * 0.6, -0.4, 1.1,
      );
    }
  }

  /** Namludan çıkan duman. */
  muzzleSmoke(point, dir) {
    for (let i = 0; i < 3; i++) {
      const v = dir.clone().multiplyScalar(1.4 + Math.random())
        .add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5));
      this._spawnParticle(
        point.x, point.y, point.z, v.x, v.y, v.z,
        0.3, 0.28, 0.25, 0.06 + Math.random() * 0.08, 0.3 + Math.random() * 0.3, 0.4, 2.6,
      );
    }
  }

  decal(point, normal) {
    const d = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % MAX_DECALS;
    d.mesh.position.copy(point).addScaledVector(normal, 0.012);
    d.mesh.lookAt(point.clone().add(normal));
    d.mesh.scale.setScalar(0.7 + Math.random() * 0.7);
    d.mesh.rotation.z = Math.random() * Math.PI;
    d.mesh.material.opacity = 0.82;
    d.mesh.visible = true;
    d.life = 14;
  }

  update(dt) {
    // Parçacıklar
    const pos = this.points.geometry.attributes.position;
    const size = this.points.geometry.attributes.size;
    const col = this.points.geometry.attributes.color;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) {
        if (this.pSize[i] !== 0) this.pSize[i] = 0;
        continue;
      }
      const i3 = i * 3;
      this.pLife[i] -= dt;

      const drag = Math.pow(1 / (1 + this.pDrag[i]), dt);
      this.pVel[i3] *= drag;
      this.pVel[i3 + 1] = this.pVel[i3 + 1] * drag + this.pGrav[i] * dt;
      this.pVel[i3 + 2] *= drag;

      this.pPos[i3] += this.pVel[i3] * dt;
      this.pPos[i3 + 1] += this.pVel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.pVel[i3 + 2] * dt;

      // Zeminde sek
      if (this.pPos[i3 + 1] < 0.02) {
        this.pPos[i3 + 1] = 0.02;
        this.pVel[i3 + 1] *= -0.32;
      }

      const k = Math.max(0, this.pLife[i] / this.pMaxLife[i]);
      this.pSize[i] = this.pBaseSize[i] * (0.35 + k * 0.65);
      // Sönerken rengi karart
      const c3 = i * 3;
      col.array[c3] *= Math.pow(0.55, dt);
      col.array[c3 + 1] *= Math.pow(0.55, dt);
      col.array[c3 + 2] *= Math.pow(0.55, dt);
    }
    pos.needsUpdate = true;
    size.needsUpdate = true;
    col.needsUpdate = true;

    // Duman: yavaşlar, yükselir, genişler, saydamlaşır
    for (let i = 0; i < MAX_SMOKE; i++) {
      if (this.sLife[i] <= 0) {
        if (this.sSize[i] !== 0) this.sSize[i] = 0;
        continue;
      }
      const i3 = i * 3;
      this.sLife[i] -= dt;
      const drag = Math.pow(1 / (1 + this.sDrag[i]), dt);
      this.sVel[i3] *= drag;
      this.sVel[i3 + 1] = this.sVel[i3 + 1] * drag + this.sGrav[i] * dt;
      this.sVel[i3 + 2] *= drag;
      this.sPos[i3] += this.sVel[i3] * dt;
      this.sPos[i3 + 1] = Math.max(0.05, this.sPos[i3 + 1] + this.sVel[i3 + 1] * dt);
      this.sPos[i3 + 2] += this.sVel[i3 + 2] * dt;
      const k = Math.max(0, this.sLife[i] / this.sMax[i]);
      this.sSize[i] = this.sBase[i] * (1 + (1 - k) * 1.5);
      this.sCol[i * 4 + 3] = 0.62 * k * Math.min(1, (1 - k) * 8 + 0.3);
    }
    const sg = this.smoke.geometry.attributes;
    sg.position.needsUpdate = true;
    sg.size.needsUpdate = true;
    sg.color.needsUpdate = true;

    // İzli mermiler
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      const k = Math.max(0, t.life / t.maxLife);
      t.mesh.material.opacity = k * 0.9;
      if (t.life <= 0) t.mesh.visible = false;
    }

    // İsabet izleri (yavaş sönüm)
    for (const d of this.decals) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life < 3) d.mesh.material.opacity = Math.max(0, (d.life / 3) * 0.82);
      if (d.life <= 0) d.mesh.visible = false;
    }
  }
}
