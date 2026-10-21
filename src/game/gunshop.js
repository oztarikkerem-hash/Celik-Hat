/* Şehirdeki silah dükkânı (Tümgeneral): oyun kredisiyle silah ve mermi.

   Dükkânın önünde E: oyun durur (state 'gunshop'), fare serbest kalır,
   panel açılır. Alınan silah yalnızca bu görevde kullanılır. Yanında en
   çok 4 silah taşınır (bıçak sayılmaz): doluysa önce birini bırak.
   Krediler mağazayla aynı kayıttan (localStorage) düşülür.               */

import { byId } from './weapons.js';

export const CARRY_MAX = 4;

/** Satıştaki silahlar: fiyat (kredi) ve mermi paketi fiyatı. */
export const GUN_PRICES = [
  { id: 'deagle', price: 300, ammo: 60 },
  { id: 'ak47', price: 900, ammo: 120 },
  { id: 'mar556', price: 1000, ammo: 120 },
  { id: 'm4', price: 1000, ammo: 120 },
  { id: 'm4a1', price: 1300, ammo: 140 },
  { id: 'mg43', price: 1700, ammo: 220 },
  { id: 'm98b', price: 1800, ammo: 160 },
  { id: 'barrett_m82', price: 2300, ammo: 200 },
  { id: 'bazuka', price: 2600, ammo: 300 },
  { id: 'minigun', price: 3200, ammo: 320 },
];

export class GunShop {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.el = document.getElementById('gun-shop');
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const { act, id } = b.dataset;
      if (act === 'close') this.close();
      else if (act === 'buy') this._buy(id);
      else if (act === 'ammo') this._ammo(id);
      else if (act === 'drop') this._drop(id);
    });
    addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'Escape' || e.code === 'KeyE') { e.preventDefault(); this.close(); }
    });
  }

  get carried() {
    const w = this.game.weaponry;
    return [...(w.allowed ?? [])].filter((id) => id !== 'bicak' && byId[id]);
  }

  show(shopName = 'SİLAH DÜKKÂNI') {
    const g = this.game;
    this.open = true;
    this.name = shopName;
    g.state = 'gunshop';                   // kilit bırakılınca duraklatma açılmasın
    g.input.releaseLock();
    this.el.hidden = false;
    this._msg = '';
    this._draw();
  }

  close() {
    const g = this.game;
    if (!this.open) return;
    this.open = false;
    this.el.hidden = true;
    g.state = 'playing';
    g.input.requestLock();
    g.clock.getDelta();
    const w = g.weaponry;
    g.hud.buildWeaponStrip(w.slots.filter((x) => w.usable(x.def.id)), w.current.def.id);
  }

  _slot(id) { return this.game.weaponry.slots.find((s) => s.def.id === id); }

  _buy(id) {
    const g = this.game, item = GUN_PRICES.find((p) => p.id === id);
    if (!item) return;
    if (this.carried.length >= CARRY_MAX) { this._msg = 'Yanında 4 silah var — önce birini bırak.'; this._draw(); return; }
    if (!g.shop.harca(item.price)) { this._msg = 'Kredin yetmiyor.'; this._draw(); return; }
    const w = g.weaponry;
    w.allowed.add(id);
    const s = this._slot(id);
    if (s) { s.ammo = s.def.mag; s.reserve = s.def.mag * 3; }
    w.equipSlot(s?.def.slot ?? 1);
    g.audio.swap();
    this._msg = `${byId[id].name} alındı.`;
    this._draw();
  }

  _ammo(id) {
    const g = this.game, item = GUN_PRICES.find((p) => p.id === id);
    const s = this._slot(id);
    if (!item || !s) return;
    const cap = s.def.mag * 6;
    if (s.reserve >= cap) { this._msg = 'Cephanen dolu.'; this._draw(); return; }
    if (!g.shop.harca(item.ammo)) { this._msg = 'Kredin yetmiyor.'; this._draw(); return; }
    s.reserve = Math.min(cap, s.reserve + s.def.mag * 3);
    s.ammo = s.def.mag;
    g.audio.ammoRefill?.();
    this._msg = `${byId[id].name}: mermi alındı.`;
    this._draw();
  }

  _drop(id) {
    const w = this.game.weaponry;
    if (this.carried.length <= 1) { this._msg = 'Son silahını bırakamazsın.'; this._draw(); return; }
    w.allowed.delete(id);
    if (w.current.def.id === id) {
      const next = w.slots.find((s) => w.usable(s.def.id) && s.def.id !== 'bicak');
      if (next) w.equipSlot(next.def.slot);
    }
    this._msg = `${byId[id].name} bırakıldı.`;
    this._draw();
  }

  _draw() {
    const g = this.game;
    const credit = g.shop.kredi;
    const carried = this.carried;
    const f = (n) => n.toLocaleString('tr-TR');
    const row = (id, right) => {
      const d = byId[id];
      return `<li><div><b>${d.name}</b><small>hasar ${d.damage} · şarjör ${d.mag}</small></div>${right}</li>`;
    };
    let html = `<header><span>${this.name}</span><span class="gs-credit">KREDİ <b>${f(credit)}</b></span></header>`;
    html += `<h3>Yanındakiler <small>${carried.length} / ${CARRY_MAX}</small></h3><ul>`;
    for (const id of carried) {
      const item = GUN_PRICES.find((p) => p.id === id);
      const s = this._slot(id);
      html += row(id, `<span class="gs-ammo">${s?.ammo ?? 0} / ${s?.reserve ?? 0}</span>
        ${item ? `<button type="button" data-act="ammo" data-id="${id}" ${credit < item.ammo ? 'disabled' : ''}>Mermi · ${f(item.ammo)}</button>` : ''}
        <button type="button" class="gs-drop" data-act="drop" data-id="${id}">Bırak</button>`);
    }
    html += '</ul><h3>Satılık</h3><ul>';
    const full = carried.length >= CARRY_MAX;
    for (const item of GUN_PRICES) {
      if (carried.includes(item.id)) continue;
      html += row(item.id, `<button type="button" data-act="buy" data-id="${item.id}" ${full || credit < item.price ? 'disabled' : ''}>Satın al · ${f(item.price)}</button>`);
    }
    html += '</ul>';
    html += `<footer><span>${this._msg || (full ? 'Yanında 4 silah var: yenisini almak için birini bırak.' : 'Alınan silah bu görevde kullanılır.')}</span>
      <button type="button" data-act="close">Kapat <kbd>E</kbd></button></footer>`;
    this.el.innerHTML = html;
  }
}
