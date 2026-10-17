/* Müttefik askerlerin başının üstündeki isim etiketleri.

   3B sprite yerine DOM katmanı: yazı her mesafede net kalır, GPU'ya ek yük
   bindirmez. Her karede askerin kafa hizası ekrana yansıtılır; kamera arkasına
   düşen ya da menzil dışına çıkan etiket gizlenir.                          */

const NAMES = ['ÇAVUŞ DEMİR', 'ONBAŞI YILMAZ', 'ER KAYA', 'ER AYDIN', 'ER ŞAHİN'];
const MAX_DIST = 60;

export class NameTags {
  constructor(container = document.body) {
    this.layer = document.createElement('div');
    this.layer.className = 'nametags';
    container.append(this.layer);
    this.tags = new Map();        // ally → { el, bar, name }
  }

  /** Müttefik listesi değiştiğinde etiketleri yeniden kurar. */
  rebuild(allies) {
    this.layer.innerHTML = '';
    this.tags.clear();

    allies.forEach((ally, i) => {
      const el = document.createElement('div');
      el.className = 'nametag';

      const name = document.createElement('span');
      name.className = 'nametag-name';
      name.textContent = NAMES[i % NAMES.length];

      const bar = document.createElement('span');
      bar.className = 'nametag-bar';
      const fill = document.createElement('i');
      bar.append(fill);

      el.append(name, bar);
      this.layer.append(el);
      this.tags.set(ally, { el, fill, name });
    });
  }

  /** @param project (worldPos) => {x, y, visible} ekran koordinatı */
  update(allies, camera, project) {
    for (const ally of allies) {
      const tag = this.tags.get(ally);
      if (!tag) continue;

      const head = ally.pos.clone();
      head.y += ally.downed ? 1.0 : 2.05;      // çömelmişken etiket de iner

      const p = project(head);
      const dist = camera.position.distanceTo(head);

      if (!p.visible || dist > MAX_DIST) {
        tag.el.style.display = 'none';
        continue;
      }

      tag.el.style.display = '';
      tag.el.style.transform = `translate(-50%, -100%) translate(${p.x}px, ${p.y}px)`;
      // Uzaktaki etiket küçülür ve soluklaşır
      const k = Math.max(0.6, 1 - dist / MAX_DIST);
      tag.el.style.opacity = String(Math.max(0.35, k));
      tag.el.style.fontSize = `${Math.round(9 + k * 4)}px`;

      const hp = Math.max(0, ally.hp) / 120;
      tag.fill.style.width = `${hp * 100}%`;
      tag.el.classList.toggle('downed', ally.downed);
      if (ally.downed) {
        const kalan = Math.max(0, Math.ceil(ally.reviveAt - performance.now() / 1000));
        tag.name.dataset.state = `YARALI ${kalan}s`;
      } else {
        delete tag.name.dataset.state;
      }
    }
  }

  setVisible(on) {
    this.layer.hidden = !on;
  }
}
