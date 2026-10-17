/* HUD: DOM katmanının tek yazma noktası. Oyun döngüsü sadece buradaki
   metotları çağırır, elementlere doğrudan dokunmaz.                       */

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'),
      wave: $('wave-num'),
      enemiesLeft: $('enemies-left'),
      waveBar: $('wave-bar-fill'),
      score: $('score'),
      combo: $('combo'),
      killfeed: $('killfeed'),
      healthFill: $('health-fill'),
      healthNum: $('health-num'),
      staminaFill: $('stamina-fill'),
      staminaTag: $('stamina-tag'),
      sectorReadout: $('sector-readout'),
      strip: $('weapon-strip'),
      ammoMag: $('ammo-mag'),
      ammoReserve: $('ammo-reserve'),
      weaponName: $('weapon-name'),
      fireMode: $('fire-mode'),
      reloadRow: $('reload-row'),
      reloadFill: $('reload-fill'),
      crosshair: $('crosshair'),
      hitmarker: $('hitmarker'),
      scope: $('scope'),
      grenadeCount: $('grenade-count'),
      missionTracker: $('mission-tracker'),
      missionName: $('mission-name'),
      missionFill: $('mission-fill'),
      missionCount: $('mission-count'),
      missionList: $('mission-list'),
      missionProgress: $('mission-progress'),
      damage: $('damage-flash'),
      loader: $('loader'),
      loadFill: $('load-fill'),
      loadStatus: $('load-status'),
      home: $('home'),
      missionsScreen: $('missions-screen'),
      shopScreen: $('shopScreen'),
      tankHud: $('tank-hud'),
      tankHp: $('tank-hp'), tankHpNum: $('tank-hp-num'),
      tankFuel: $('tank-fuel'), tankFuelNum: $('tank-fuel-num'),
      tankMode: $('tank-mode'), tankReload: $('tank-reload'), tankMg: $('tank-mg'),
      tankMissionName: $('tank-mission-name'),
      tankObjKill: $('tank-obj-kill'), tankObjFuel: $('tank-obj-fuel'),
      tankHint: $('tank-hint'),
      chapterScreen: $('chapterScreen'),
      tankPickScreen: $('tankPickScreen'),
      victory: $('victory'),
      pause: $('pause'),
      gameover: $('gameover'),
      homeBest: $('home-best'),
      homeMissions: $('home-missions'),
      homeWeapons: $('home-weapons'),
      homeArsenal: $('home-arsenal'),
      homeControls: $('home-controls'),
      missionCards: $('mission-cards'),
    };
    this._lastScore = 0;
    this._feedTimers = [];
  }

  /* ── Ekranlar ──────────────────────────────────────────────────────── */

  loading(progress, label) {
    this.el.loadFill.style.width = `${Math.round(progress * 100)}%`;
    if (label) this.el.loadStatus.textContent = label;
  }

  screen(name) {
    for (const key of ['loader', 'home', 'missionsScreen', 'shopScreen', 'chapterScreen', 'tankPickScreen', 'victory', 'pause', 'gameover']) {
      this.el[key].hidden = key !== name;
    }
    this.el.hud.hidden = name !== null;
    if (name !== null) this.el.tankHud.hidden = true;
  }

  /* ── Mağaza ────────────────────────────────────────────────────────── */

  /**
   * @param bolum   'vest' | 'helm'
   * @param urunler katalog dizisi
   * @param durum   { kredi, sahipMi(id), takili }
   */
  buildShop(bolum, urunler, durum) {
    const yuzde = (v) => `${Math.round(v * 100)}%`;
    document.getElementById('shop-credit').textContent =
      durum.kredi.toLocaleString('tr-TR');
    document.getElementById('shop-tab-vest').classList.toggle('active', bolum === 'vest');
    document.getElementById('shop-tab-helm').classList.toggle('active', bolum === 'helm');
    document.getElementById('shop-tab-weapons')?.classList.toggle('active', bolum === 'weapons');
    document.getElementById('shop-note').textContent = bolum === 'vest'
      ? 'Koruma arttıkça koşu yavaşlar. Uzman yelekler kendi tehdidine karşı çok güçlü, diğerine karşı zayıftır.'
      : bolum === 'helm'
        ? 'Kask yalnızca KAFA isabetlerini azaltır; gövde hasarına etkisi yoktur.'
        : 'Silahlar bir kez alınır ve kalıcıdır. Tank bölümünde kazandığın puanın bir kısmı da buraya kredi olarak yazılır.';

    const grid = document.getElementById('shop-grid');
    grid.innerHTML = '';
    for (const u of urunler) {
      const sahip = durum.sahipMi(u.id);
      const takili = durum.takili === u.id;
      const kart = document.createElement('article');
      kart.className = `shop-card${takili ? ' equipped' : ''}${sahip ? ' owned' : ''}`;

      const satirlar = bolum === 'weapons' ? [
        ['Kullanım', u.kullanim, true],
        ['Atış hızı', u.atis, false],
        ['Mürettebat', u.murettebat, false],
      ] : bolum === 'vest' ? [
        ['Seri atışa karşı', yuzde(u.seri), u.uzman === 'seri'],
        ['Keskin nişancıya karşı', yuzde(u.keskin), u.uzman === 'keskin'],
        ['Hız', u.hiz === 1 ? 'etkilenmez' : `−${Math.round((1 - u.hiz) * 100)}%`, false],
        ['Ağırlık', u.agirlik, false],
      ] : [
        ['Kafa hasarı', u.kafa ? `−${yuzde(u.kafa)}` : 'yok', false],
        ['Hız', u.hiz === 1 ? 'etkilenmez' : `−${Math.round((1 - u.hiz) * 100)}%`, false],
        ...(u.ilkIsabetiKarsila ? [['Özel', 'Ölümcül kafa isabetini 1 kez karşılar', true]] : []),
      ];

      kart.innerHTML = `
        <header>
          <h3>${u.ad}</h3>
          <span class="shop-price">${u.fiyat ? u.fiyat.toLocaleString('tr-TR') : 'ÜCRETSİZ'}</span>
        </header>
        <p>${u.aciklama}</p>
        <dl>${satirlar.map(([k, v, vurgu]) =>
          `<div${vurgu ? ' class="hi"' : ''}><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      `;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = takili ? 'shop-btn on' : 'shop-btn';
      btn.dataset.id = u.id;
      btn.dataset.eylem = sahip ? 'kus' : 'al';
      btn.textContent = takili ? 'Kuşanıldı' : sahip ? 'Kuşan' : 'Satın al';
      btn.disabled = takili || (!sahip && durum.kredi < u.fiyat);
      if (bolum === 'weapons' && sahip) { btn.textContent = 'Sahipsin'; btn.disabled = true; }
      if (!sahip && durum.kredi < u.fiyat) btn.textContent = 'Kredi yetersiz';
      kart.append(btn);
      grid.append(kart);
    }
  }

  /* ── Tank arayüzü ──────────────────────────────────────────────────── */

  setTankMission(ad, imha, ikmal) {
    this.el.tankHud.hidden = false;
    this.el.hud.hidden = true;            // piyade arayüzü tank modunda kapalı
    this.el.tankMissionName.textContent = ad;
    this.el.tankObjKill.textContent = imha;
    this.el.tankObjFuel.textContent = ikmal;
  }

  setTankDurum({ can, maxCan, yakit, maxYakit, mod, dolum, mgSarjor,
                 ikmalYakin, yakitBitti }) {
    const hpYuzde = Math.max(0, can / maxCan) * 100;
    this.el.tankHp.style.width = `${hpYuzde}%`;
    this.el.tankHpNum.textContent = Math.round(can);
    this.el.tankHp.classList.toggle('low', hpYuzde < 30);

    const yakitYuzde = Math.max(0, yakit / maxYakit) * 100;
    this.el.tankFuel.style.width = `${yakitYuzde}%`;
    this.el.tankFuelNum.textContent = Math.round(yakit);
    this.el.tankFuel.classList.toggle('low', yakitYuzde < 25);

    this.el.tankMode.textContent = mod === 'mg' ? 'MAKİNELİ TÜFEK' : 'ANA TOP';
    this.el.tankReload.style.width = `${Math.round((mod === 'mg' ? 1 : dolum) * 100)}%`;
    this.el.tankMg.textContent = mod === 'mg' ? `${mgSarjor} mermi` : '';

    let ipucu = '';
    if (ikmalYakin) ipucu = 'E — YAKIT İKMALİ';
    else if (yakitBitti) ipucu = 'YAKIT BİTTİ — İKMAL NOKTASINA ULAŞ';
    this.el.tankHint.textContent = ipucu;
    this.el.tankHint.hidden = !ipucu;
  }

  tankHudKapat() {
    this.el.tankHud.hidden = true;
  }

  /* ── Bölümler ──────────────────────────────────────────────────────── */

  buildChapters(bolum, durum) {
    document.getElementById('chapter-title').textContent = `${bolum.id}. Bölüm — ${bolum.ad}`;
    document.getElementById('chapter-num').textContent = `${bolum.id} / 1`;
    document.getElementById('chapter-note').textContent = bolum.ozet;
    const grid = document.getElementById('chapter-grid');
    grid.innerHTML = '';
    bolum.gorevler.forEach((g, i) => {
      const bitti = durum.tamamlanan.includes(g.id);
      const kart = document.createElement('article');
      kart.className = `shop-card${bitti ? ' equipped' : ''}${g.kilitli ? ' owned' : ''}`;
      const hedefler = (g.hedefler ?? []).map((h) =>
        `<div><dt>${h.metin}</dt><dd>${h.sayi}</dd></div>`).join('');
      kart.innerHTML = `
        <header>
          <h3>${i + 1}. ${g.ad}</h3>
          <span class="shop-price">${bitti ? 'TAMAM' : g.kilitli ? 'KİLİTLİ' : 'HAZIR'}</span>
        </header>
        <p>${g.ozet}</p>
        <dl>${hedefler}</dl>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shop-btn';
      btn.dataset.gorev = g.id;
      btn.textContent = g.kilitli ? 'Kilitli' : bitti ? 'Tekrar oyna' : 'Göreve başla';
      btn.disabled = Boolean(g.kilitli);
      kart.append(btn);
      grid.append(kart);
    });
  }

  buildTankPick(gorev, tipler) {
    document.getElementById('tankpick-mission').textContent = gorev.ad;
    const grid = document.getElementById('tankpick-grid');
    grid.innerHTML = '';
    for (const t of tipler) {
      const kart = document.createElement('article');
      kart.className = 'shop-card';
      kart.innerHTML = `
        <header><h3>${t.ad}</h3><span class="shop-price">${t.hasar} HASAR</span></header>
        <p>${t.ozet}</p>
        <dl>
          <div><dt>Zırh</dt><dd>${Math.round((1 - t.zirh) * 100)}% emilim</dd></div>
          <div><dt>Dolum</dt><dd>${t.atisAraligi.toFixed(1)} sn</dd></div>
          <div><dt>Hız</dt><dd>${t.hiz.toFixed(1)} m/sn</dd></div>
          <div><dt>Yakıt tüketimi</dt><dd>${t.yakitTuketim.toFixed(2)} / sn</dd></div>
          <div><dt>Makineli</dt><dd>${t.mgSarjor} mermi</dd></div>
        </dl>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shop-btn';
      btn.dataset.tank = t.id;
      btn.textContent = `${t.ad} ile başla`;
      kart.append(btn);
      grid.append(kart);
    }
  }

  /* ── Ana sayfa ─────────────────────────────────────────────────────── */

  buildHome({ best, missionsDone, missionsTotal, weapons }) {
    this.el.homeBest.textContent = best.toLocaleString('tr-TR');
    this.el.homeMissions.textContent = `${missionsDone} / ${missionsTotal}`;
    this.el.homeWeapons.textContent = weapons.length;

    this.el.homeArsenal.innerHTML = '';
    for (const def of weapons) {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${def.name}</strong><span>${def.kind} · ${def.damage} hasar</span>`;
      this.el.homeArsenal.append(li);
    }
  }

  toggleControls() {
    this.el.homeControls.hidden = !this.el.homeControls.hidden;
  }

  /** Görev seçim kartları. onPick(mission) seçimde çağrılır. */
  buildMissionCards(missions, book, selectedId, onPick) {
    this.el.missionCards.innerHTML = '';
    for (const m of missions) {
      const { done, value } = book.get(m);
      const li = document.createElement('li');
      li.className = `mission-card${done ? ' done' : ''}${m.id === selectedId ? ' selected' : ''}`;
      li.dataset.id = m.id;
      li.innerHTML = `
        <div class="card-head">
          <strong>${m.name}</strong>
          <span class="card-count">${value}/${m.target}</span>
        </div>
        <p>${m.desc}</p>
        <div class="card-bar"><span style="width:${Math.round((value / m.target) * 100)}%"></span></div>`;
      li.addEventListener('click', () => onPick(m));
      this.el.missionCards.append(li);
    }
  }

  /* ── Üst bilgi ─────────────────────────────────────────────────────── */

  setWave(n, remaining, total) {
    this.el.wave.textContent = n;
    this.el.enemiesLeft.textContent = remaining > 0 ? `${remaining} düşman` : 'hat temiz';
    const done = total > 0 ? 1 - remaining / total : 1;
    this.el.waveBar.style.width = `${Math.round(done * 100)}%`;
  }

  setScore(score) {
    if (score === this._lastScore) return;
    this._lastScore = score;
    this.el.score.textContent = score.toLocaleString('tr-TR');
  }

  setCombo(count, mult) {
    this.el.combo.textContent = count > 1 ? `×${mult.toFixed(1)} seri · ${count}` : '';
  }

  feed(text, crit = false) {
    const li = document.createElement('li');
    li.textContent = text;
    if (crit) li.className = 'crit';
    this.el.killfeed.prepend(li);
    while (this.el.killfeed.children.length > 5) {
      this.el.killfeed.lastElementChild.remove();
    }
    setTimeout(() => li.remove(), 3600);
  }

  /* ── Alt bilgi ─────────────────────────────────────────────────────── */

  setHealth(hp, max) {
    const pct = Math.max(0, hp / max);
    this.el.healthFill.style.width = `${pct * 100}%`;
    this.el.healthFill.className = pct < 0.25 ? 'crit' : pct < 0.55 ? 'warn' : '';
    this.el.healthNum.textContent = Math.ceil(hp);
  }

  setStamina(v, exhausted = false) {
    this.el.staminaFill.style.width = `${Math.max(0, v) * 100}%`;
    this.el.staminaFill.className = exhausted ? 'spent' : v < 0.3 ? 'low' : '';
    this.el.staminaTag.hidden = !exhausted;
  }

  /** Akış göstergesi: kaç sektör yüklü. */
  setSectors(active, total) {
    this.el.sectorReadout.textContent = `SEKTÖR ${active} / ${total}`;
  }

  buildWeaponStrip(slots, activeId) {
    this.el.strip.innerHTML = '';
    for (const s of slots) {
      const li = document.createElement('li');
      li.dataset.id = s.def.id;
      li.innerHTML = `<span class="slot">${s.def.slot}</span><span>${s.def.name}</span>`;
      if (s.def.id === activeId) li.classList.add('active');
      this.el.strip.append(li);
    }
  }

  setActiveWeapon(def) {
    for (const li of this.el.strip.children) {
      li.classList.toggle('active', li.dataset.id === def.id);
    }
    this.el.weaponName.textContent = def.name;
    this.el.fireMode.textContent = def.auto ? 'OTO' : 'TEK';
  }

  setAmmo(mag, magSize, reserve) {
    this.el.ammoMag.textContent = mag;
    this.el.ammoReserve.textContent = reserve;
    this.el.ammoMag.className = `ammo-mag${mag === 0 ? ' empty' : mag <= magSize * 0.25 ? ' low' : ''}`;
  }

  setGrenades(n) {
    this.el.grenadeCount.textContent = n;
    this.el.grenadeCount.parentElement.classList.toggle('empty', n === 0);
  }

  /* ── Görevler ──────────────────────────────────────────────────────── */

  setMission(mission, book) {
    if (!mission) {
      this.el.missionTracker.classList.add('done');
      this.el.missionName.textContent = 'Tüm görevler tamam';
      this.el.missionFill.style.width = '100%';
      this.el.missionCount.textContent = '✓';
      return;
    }
    const { value } = book.get(mission);
    this.el.missionTracker.classList.remove('done');
    this.el.missionName.textContent = mission.name;
    this.el.missionFill.style.width = `${Math.round((value / mission.target) * 100)}%`;
    this.el.missionCount.textContent = `${value}/${mission.target}`;
  }

  buildMissionList(missions, book) {
    this.el.missionList.innerHTML = '';
    for (const m of missions) {
      const { done, value } = book.get(m);
      const li = document.createElement('li');
      li.className = done ? 'done' : '';
      li.innerHTML = `
        <span class="mark">${done ? '✓' : ''}</span>
        <span class="body">
          <strong>${m.name}</strong>
          <span class="desc">${m.desc}</span>
        </span>
        <span class="count">${value}/${m.target}</span>`;
      this.el.missionList.append(li);
    }
    this.el.missionProgress.textContent = `${book.completedCount} / ${missions.length}`;
  }

  setReload(progress) {
    if (progress === null) {
      this.el.reloadRow.hidden = true;
      return;
    }
    this.el.reloadRow.hidden = false;
    this.el.reloadFill.style.width = `${Math.round(progress * 100)}%`;
  }

  /* ── Nişangah ve geri bildirim ─────────────────────────────────────── */

  setCrosshair(spread01, hidden) {
    this.el.crosshair.style.setProperty('--spread', spread01.toFixed(3));
    this.el.crosshair.classList.toggle('hidden', Boolean(hidden));
  }

  hitmarker(kill = false) {
    const el = this.el.hitmarker;
    el.classList.remove('show');
    el.classList.toggle('kill', kill);
    // Animasyonu yeniden tetikle
    void el.offsetWidth;
    el.classList.add('show');
  }

  damageFlash() {
    const el = this.el.damage;
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }

  setScope(on) {
    this.el.scope.classList.toggle('on', on);
  }

  /* ── Panel istatistikleri ──────────────────────────────────────────── */

  pauseStats({ wave, score, kills }) {
    $('pause-wave').textContent = wave;
    $('pause-score').textContent = score.toLocaleString('tr-TR');
    $('pause-kills').textContent = kills;
  }

  victoryStats({ mission, wave, score, kills, accuracy, hasNext }) {
    $('victory-title').textContent = mission ? mission.name : 'Görev tamam';
    $('victory-desc').textContent = mission
      ? `${mission.desc} — tamamlandı.`
      : 'Hat tutuldu.';
    $('vic-wave').textContent = wave;
    $('vic-score').textContent = score.toLocaleString('tr-TR');
    $('vic-kills').textContent = kills;
    $('vic-acc').textContent = `${Math.round(accuracy * 100)}%`;
    $('vic-next-btn').hidden = !hasNext;
  }

  gameOverStats({ wave, score, kills, accuracy, best, missions }) {
    $('go-wave').textContent = wave;
    $('go-score').textContent = score.toLocaleString('tr-TR');
    $('go-kills').textContent = kills;
    $('go-acc').textContent = `${Math.round(accuracy * 100)}%`;
    $('go-missions').textContent = missions ?? 0;
    $('go-best').textContent = best > score
      ? `En iyi skorun: ${best.toLocaleString('tr-TR')}`
      : 'Yeni rekor!';
  }
}
