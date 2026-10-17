/* Bazuka roketleri (PG-7 tipi).

   Gerçekteki gibi iki evre: fırlatma yükü roketi namludan iter (ilk ~10 m
   motor sönük, yalnızca hafif duman), sonra uçuş motoru ateşlenir — parlak
   alev ve yoğun duman izi. Mermi yol aldığı için isabet anlık değil:
   her karede önceki ve yeni konum arasındaki DOĞRU PARÇASI sahneye karşı
   sınanır (hızlı mermi ince engellerin içinden geçmesin).

   Patlama: alan hasarı (mesafeyle karesel azalır), eşyaları savurur,
   oyuncu yakındaysa onu da yaralar.                                      */

import * as THREE from 'three';

const MAX_LIFE = 6;
const IGNITE_AT = 0.11;        // s: uçuş motoru ateşleme anı (~10 m)

export class Rockets {
  constructor(scene, effects, audio) {
    this.scene = scene;
    this.effects = effects;
    this.audio = audio;
    this.live = [];
    this._ray = new THREE.Raycaster();
    this.onExplode = null;     // ({ center, radius, maxDamage, normal }) => void

    // Motor alevi: roketin kuyruğunda parlayan küçük koni + ışık
    this.flameGeo = new THREE.ConeGeometry(0.035, 0.32, 8, 1, true);
    this.flameGeo.rotateX(-Math.PI / 2);
    this.flameGeo.translate(0, 0, 0.18);
    this.flameMat = new THREE.MeshBasicMaterial({
      color: 0xffc070, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
  }

  /**
   * @param template  silahtaki roket pivotu (geometri paylaşılır)
   * @param origin    namlu ağzı (dünya)
   * @param dir       uçuş yönü (dünya, birim)
   * @param def       silah künyesi (def.rocket: speed, radius, maxDamage, gravity)
   */
  fire(template, origin, dir, def, targets) {
    template.updateWorldMatrix(true, true);
    const g = new THREE.Group();
    const inner = new THREE.Group();
    g.add(inner);

    // Kopya: roket pivotunun yerel düzeni korunur, pivot -Z'ye bakar
    const pivotInv = new THREE.Matrix4().copy(template.matrixWorld).invert();
    const scale = new THREE.Vector3();
    template.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    template.traverse((o) => {
      if (!o.isMesh) return;
      const m = new THREE.Mesh(o.geometry, o.material);
      m.matrixAutoUpdate = false;
      m.matrix.copy(pivotInv).multiply(o.matrixWorld);
      m.castShadow = true;
      inner.add(m);
    });
    inner.scale.copy(scale);

    const flame = new THREE.Mesh(this.flameGeo, this.flameMat);
    flame.visible = false;
    g.add(flame);
    const light = new THREE.PointLight(0xffa04a, 0, 9, 2);
    light.position.z = 0.25;
    g.add(light);

    g.position.copy(origin);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    this.scene.add(g);

    const R = def.rocket;
    this.live.push({
      g, flame, light,
      vel: dir.clone().multiplyScalar(R.speed * 0.55),   // fırlatma yükü: yavaş çıkış
      speed: R.speed,
      R,
      age: 0,
      targets,
      ignited: false,
      smokeAcc: 0,
    });
  }

  /**
   * @param enemyList  canlı düşmanlar: ince vuruş kutularına ek olarak gövde
   *                   boyutunda (0.55 m) çarpma testi — yoksa roket askerin
   *                   yanından geçip çok ötede patlıyor, hasar 0 kalıyordu
   */
  update(dt, solids, enemyTargets, enemyList = []) {
    this._updateFx(dt);
    for (let i = this.live.length - 1; i >= 0; i--) {
      const r = this.live[i];
      r.age += dt;

      // Uçuş motoru: ateşlenince tam hıza çıkar
      if (!r.ignited && r.age > IGNITE_AT) {
        r.ignited = true;
        r.flame.visible = true;
        r.light.intensity = 6;
        this.audio?.rocketMotor?.();
      }
      const dir = r.vel.clone().normalize();
      if (r.ignited) {
        const sp = r.vel.length();
        const want = r.speed;
        r.vel.copy(dir).multiplyScalar(sp + (want - sp) * Math.min(1, dt * 4));
      }
      r.vel.y -= r.R.gravity * dt;

      const from = r.g.position.clone();
      const step = r.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const to = from.clone().add(step);

      // Çarpışma: doğru parçası
      this._ray.set(from, step.clone().normalize());
      this._ray.far = len + 0.05;
      let hit = this._ray.intersectObjects([...enemyTargets, ...solids], false)[0];

      // Gövde çarpması: doğru parçasının asker merkezine en yakın noktası
      const seg = step.clone();
      const segLen2 = seg.lengthSq() || 1;
      for (const e of enemyList) {
        if (!e.alive) continue;
        const c = e.center;
        const t = THREE.MathUtils.clamp(c.clone().sub(from).dot(seg) / segLen2, 0, 1);
        const closest = from.clone().addScaledVector(seg, t);
        // Gövde dikey bir kapsül: yatayda 0.55 m, dikeyde 1 m tolerans
        const dxz = Math.hypot(closest.x - c.x, closest.z - c.z);
        if (dxz < 0.55 && Math.abs(closest.y - c.y) < 1.0) {
          const d = t * len;
          if (!hit || d < hit.distance) hit = { point: closest, distance: d, object: null, face: null };
        }
      }
      const groundHit = to.y < 0.03;

      if (hit || groundHit || r.age > MAX_LIFE) {
        const p = hit ? hit.point.clone() : groundHit ? to.setY(0.05) : to;
        const n = hit?.face
          ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
          : new THREE.Vector3(0, 1, 0);
        this._explode(r, p, n, hit?.object);
        this.live.splice(i, 1);
        continue;
      }

      r.g.position.copy(to);
      r.g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), r.vel.clone().normalize());

      // Duman izi: hızla orantılı sıklıkta
      r.smokeAcc += len;
      const every = r.ignited ? 0.45 : 1.2;
      const tail = r.g.position.clone().addScaledVector(dir, 0.35);
      while (r.smokeAcc > every) {
        r.smokeAcc -= every;
        this.effects.puff(tail, dir.clone().multiplyScalar(-1.2), r.ignited ? 0x6e6a64 : 0x8a857c,
          r.ignited ? 0.32 : 0.18, r.ignited ? 1.6 : 0.8, 0.25, 1.6);
        if (r.ignited) {
          this.effects.puff(tail, dir.clone().multiplyScalar(-4), 0xffb060, 0.08, 0.08, 0, 4);
        }
      }
      r.flame.scale.setScalar(0.85 + Math.random() * 0.35);
    }
  }

  /* Görünür patlama: genişleyen ateş topu + kısa güçlü ışık + yerde toz
     halkası. Parçacıklar el bombası ölçeğindeydi; 30–40 m'de seçilmiyordu. */
  _fireball(center) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffb35a, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ball = new THREE.Mesh(this.ballGeo ??= new THREE.SphereGeometry(1, 18, 12), mat);
    ball.position.copy(center);
    const core = new THREE.Mesh(this.ballGeo, new THREE.MeshBasicMaterial({
      color: 0xfff1c8, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    core.position.copy(center);
    const light = new THREE.PointLight(0xffa04a, 90, 40, 2);
    light.position.copy(center).add(new THREE.Vector3(0, 1, 0));
    this.scene.add(ball, core, light);
    (this.fx ??= []).push({ ball, core, light, age: 0 });

    // Yerde yayılan toz halkası
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a), 0.15, Math.sin(a)).multiplyScalar(7 + Math.random() * 4);
      this.effects.puff(new THREE.Vector3(center.x, Math.max(0.2, center.y - 0.3), center.z), v,
        0x7d7466, 0.6 + Math.random() * 0.5, 1.8 + Math.random(), 0.15, 2.2);
    }
    // Yükselen koyu duman sütunu
    for (let k = 0; k < 14; k++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, 3 + Math.random() * 3, (Math.random() - 0.5) * 2);
      this.effects.puff(center.clone().add(new THREE.Vector3(0, 0.5, 0)), v, 0x3b3631,
        0.9 + Math.random() * 0.6, 3 + Math.random() * 2, 0.6, 0.9);
    }
  }

  _updateFx(dt) {
    if (!this.fx) return;
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.age += dt;
      const k = f.age / 0.55;
      f.ball.scale.setScalar(0.6 + 3.4 * (1 - (1 - Math.min(1, k)) ** 3));
      f.ball.material.opacity = Math.max(0, 1 - k);
      f.core.scale.setScalar(0.4 + 1.6 * Math.min(1, k * 2));
      f.core.material.opacity = Math.max(0, 1 - k * 2);
      f.light.intensity = 90 * Math.max(0, 1 - f.age / 0.35);
      if (k >= 1) {
        this.scene.remove(f.ball, f.core, f.light);
        f.ball.material.dispose();
        f.core.material.dispose();
        this.fx.splice(i, 1);
      }
    }
  }

  _explode(r, center, normal, object) {
    this.scene.remove(r.g);
    this._fireball(center);
    this.effects.explode(center, 0xffa23c, 120);
    this.effects.sparks(center, normal, 0xfff0c0, 34);
    for (let k = 0; k < 18; k++) {
      const v = normal.clone().multiplyScalar(2 + Math.random() * 3)
        .add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(4));
      this.effects.puff(center, v, 0x4a4540, 0.5 + Math.random() * 0.4, 2 + Math.random() * 1.5, 0.3, 1.2);
    }
    this.audio?.explosion();
    this.onExplode?.({
      center, radius: r.R.radius, maxDamage: r.R.maxDamage, normal, object,
    });
  }

  reset() {
    for (const r of this.live) this.scene.remove(r.g);
    this.live.length = 0;
    for (const f of this.fx ?? []) this.scene.remove(f.ball, f.core, f.light);
    if (this.fx) this.fx.length = 0;
  }
}
