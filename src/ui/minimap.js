/* Sağ üst köşedeki taktik harita.

   Oyuncu her zaman merkezde ve yukarı bakar; dünya onun etrafında döner.
   Yakındaki siperler soluk dikdörtgen, düşmanlar kırmızı nokta, menzil
   dışında kalan düşmanlar kenarda ok olarak gösterilir.                   */

const RANGE = 55;          // haritanın kapsadığı yarıçap (m)

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(devicePixelRatio, 2);
    this.resize();
    this._last = 0;
  }

  resize() {
    const size = this.canvas.clientWidth || 164;
    this.size = size;
    this.canvas.width = size * this.dpr;
    this.canvas.height = size * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** @param now saniye — çizim 20 Hz'e kısılır, oyun döngüsünü yormasın. */
  draw(now, { player, enemies, world, grenades }) {
    if (now - this._last < 0.05) return;
    this._last = now;

    const g = this.ctx;
    const S = this.size;
    const R = S / 2;
    const scale = R / RANGE;

    g.clearRect(0, 0, S, S);

    // Zemin
    g.fillStyle = 'rgba(11, 15, 13, 0.72)';
    g.beginPath();
    g.arc(R, R, R - 1, 0, Math.PI * 2);
    g.fill();

    // Oyuncunun bakış yönü yukarı olacak şekilde dünyayı döndür
    const rot = player.yaw;                       // yaw: 0 → -Z yönü
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const toMap = (x, z) => {
      const dx = x - player.pos.x;
      const dz = z - player.pos.z;
      // Dünya → ekran: oyuncunun ileri yönü (-sin, -cos) yukarı gelmeli
      const mx = dx * cos - dz * sin;
      const my = dx * sin + dz * cos;
      return [R + mx * scale, R + my * scale];
    };

    g.save();
    g.beginPath();
    g.arc(R, R, R - 1, 0, Math.PI * 2);
    g.clip();

    // ── Siperler ───────────────────────────────────────────────────────
    g.fillStyle = 'rgba(127, 143, 114, 0.26)';
    let drawn = 0;
    for (const box of world.colliders) {
      if (drawn > 140) break;
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      if (Math.hypot(cx - player.pos.x, cz - player.pos.z) > RANGE + 10) continue;

      const w = (box.max.x - box.min.x) * scale;
      const h = (box.max.z - box.min.z) * scale;
      const [mx, my] = toMap(cx, cz);
      g.save();
      g.translate(mx, my);
      g.rotate(rot);
      g.fillRect(-w / 2, -h / 2, Math.max(w, 1.5), Math.max(h, 1.5));
      g.restore();
      drawn++;
    }

    // ── Dünya sınırı ───────────────────────────────────────────────────
    g.strokeStyle = 'rgba(232, 163, 61, 0.35)';
    g.lineWidth = 1.5;
    const h2 = world.half;
    g.beginPath();
    const corners = [[-h2, -h2], [h2, -h2], [h2, h2], [-h2, h2]].map(([x, z]) => toMap(x, z));
    g.moveTo(...corners[0]);
    for (let i = 1; i < corners.length; i++) g.lineTo(...corners[i]);
    g.closePath();
    g.stroke();

    // ── El bombaları ───────────────────────────────────────────────────
    g.fillStyle = '#6fae7a';
    for (const gr of grenades ?? []) {
      const [mx, my] = toMap(gr.mesh.position.x, gr.mesh.position.z);
      g.beginPath();
      g.arc(mx, my, 2.5, 0, Math.PI * 2);
      g.fill();
    }

    // ── Düşmanlar ──────────────────────────────────────────────────────
    for (const e of enemies) {
      if (!e.alive) continue;
      const dist = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      let [mx, my] = toMap(e.pos.x, e.pos.z);

      if (dist > RANGE) {
        // Menzil dışındakiler kenara sıkıştırılır: nereden geldikleri belli olsun
        const dx = mx - R, dy = my - R;
        const k = (R - 7) / Math.hypot(dx, dy);
        mx = R + dx * k;
        my = R + dy * k;
        g.fillStyle = 'rgba(200, 67, 42, 0.55)';
        g.beginPath();
        g.arc(mx, my, 2.5, 0, Math.PI * 2);
        g.fill();
        continue;
      }

      // Ağır sınıf daha büyük nokta
      const r = e.type === 'brute' ? 4.2 : 3.2;
      g.fillStyle = '#c8432a';
      g.beginPath();
      g.arc(mx, my, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255, 180, 160, 0.8)';
      g.lineWidth = 1;
      g.stroke();
    }

    g.restore();

    // ── Görüş konisi ───────────────────────────────────────────────────
    g.fillStyle = 'rgba(232, 163, 61, 0.1)';
    g.beginPath();
    g.moveTo(R, R);
    g.arc(R, R, R - 2, -Math.PI / 2 - 0.68, -Math.PI / 2 + 0.68);
    g.closePath();
    g.fill();

    // ── Oyuncu ─────────────────────────────────────────────────────────
    g.fillStyle = '#e8a33d';
    g.beginPath();
    g.moveTo(R, R - 6);
    g.lineTo(R - 4.5, R + 5);
    g.lineTo(R + 4.5, R + 5);
    g.closePath();
    g.fill();

    // ── Çerçeve ve kuzey işareti ───────────────────────────────────────
    g.strokeStyle = 'rgba(127, 143, 114, 0.55)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(R, R, R - 1, 0, Math.PI * 2);
    g.stroke();

    const [nx, ny] = [R + Math.sin(rot) * (R - 9), R - Math.cos(rot) * (R - 9)];
    g.fillStyle = 'rgba(221, 225, 215, 0.75)';
    g.font = '9px "Share Tech Mono", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('K', nx, ny);
  }
}
