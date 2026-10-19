/* HUD: DOM katmanının tek yazma noktası. Oyun döngüsü sadece buradaki
   metotları çağırır, elementlere doğrudan dokunmaz.                       */

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'),
      wave: $('wave-num'),
      waveBlock: $('wave-block'),
      waveLabel: $('wave-label'),
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
      licensesScreen: $('licensesScreen'),
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
      binoc: $('binoc'),
      binocRange: $('binoc-range'),
      binocBearing: $('binoc-bearing'),
      interactHint: $('interact-hint'),
      raidBanner: $('raid-banner'),
      raidBannerEyebrow: $('raid-banner-eyebrow'),
      raidBannerTitle: $('raid-banner-title'),
      raidLoadout: $('raidLoadout'),
      mapPick: $('mapPick'),
      raidFinale: $('raidFinale'),
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
    for (const key of ['loader', 'home', 'missionsScreen', 'shopScreen', 'licensesScreen', 'chapterScreen', 'tankPickScreen', 'mapPick', 'raidLoadout', 'raidFinale', 'victory', 'pause', 'gameover']) {
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
    document.getElementById('shop-tab-health')?.classList.toggle('active', bolum === 'health');
    document.getElementById('shop-note').textContent = bolum === 'vest'
      ? 'Koruma arttıkça koşu yavaşlar. Uzman yelekler kendi tehdidine karşı çok güçlü, diğerine karşı zayıftır.'
      : bolum === 'helm'
        ? 'Kask yalnızca KAFA isabetlerini azaltır; gövde hasarına etkisi yoktur.'
        : bolum === 'health'
          ? 'Canın biterse AĞIR YARALI olursun; ayağa kalkınca canın 25\'te kalır. '
            + 'Önce sargı bezini, sonra ilk yardım kitini kullan (oyunda H tuşu): canın yeniden dolar.'
          : 'Silahlar bir kez alınır ve kalıcıdır. Tank bölümünde kazandığın puanın bir kısmı da buraya kredi olarak yazılır.';

    const grid = document.getElementById('shop-grid');
    grid.innerHTML = '';
    for (const u of urunler) {
      const sahip = durum.sahipMi(u.id);
      const takili = durum.takili === u.id;
      const kart = document.createElement('article');
      kart.className = `shop-card${takili ? ' equipped' : ''}${sahip ? ' owned' : ''}`;

      const satirlar = bolum === 'health' ? [
        ['Elde', `${durum.adet?.(u.id) ?? 0} adet`, true],
        ['Sıra', u.adim, false],
        ['Kullanma süresi', u.sure, false],
      ] : bolum === 'weapons' ? u.satirlar ?? [
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
      if (u.tuket) {                        // tüketilen: her alış bir adet
        btn.dataset.eylem = 'al';
        btn.className = 'shop-btn';
        btn.disabled = durum.kredi < u.fiyat;
        btn.textContent = btn.disabled ? 'Kredi yetersiz' : 'Bir tane al';
      }
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

  /**
   * Haftalık ödül takvimi. gunler: [{ gun, odul, durum }], alinabilir:
   * bugünün ödülü duruyor mu, kazanilan: az önce alınan puan (teşekkür yazısı).
   */
  buildWeekly(gunler, alinabilir, kazanilan = 0) {
    const fmt = (n) => n.toLocaleString('tr-TR');
    const etiket = { done: 'ALINDI', today: 'BUGÜN', next: 'YARIN', locked: '' };
    const ol = $('weekly-days');
    ol.innerHTML = '';
    for (const g of gunler) {
      const li = document.createElement('li');
      li.className = `${g.durum}${g.gun === 7 ? ' last' : ''}`;
      li.innerHTML = `<span class="wd-day">${g.gun}. GÜN</span>`
        + `<span class="wd-amt">${g.durum === 'done' ? '✓' : fmt(g.odul)}</span>`
        + `<span class="wd-state">${etiket[g.durum]}</span>`;
      li.setAttribute('aria-label', `${g.gun}. gün, ${fmt(g.odul)} puan${etiket[g.durum] ? `, ${etiket[g.durum].toLowerCase()}` : ''}`);
      ol.append(li);
    }
    const bugunku = gunler.find((g) => g.durum === 'today');
    const alinanSayisi = gunler.filter((g) => g.durum === 'done').length;
    $('weekly-streak').textContent = `Gün ${Math.min(7, alinanSayisi + (bugunku ? 1 : 0)) || 1} / 7`;
    const btn = $('weekly-claim');
    btn.disabled = !alinabilir;
    btn.textContent = alinabilir && bugunku
      ? `Bugünün ödülünü al · +${fmt(bugunku.odul)} puan`
      : kazanilan ? `+${fmt(kazanilan)} puan kredine eklendi — yarın yine gel`
        : 'Bugünün ödülü alındı — yarın yine gel';
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
      li.className = `mission-card${done ? ' done' : ''}${m.id === selectedId ? ' selected' : ''}${m.special ? ' special' : ''}`;
      li.dataset.id = m.id;
      li.innerHTML = `
        <div class="card-head">
          <strong>${m.name}${m.special ? '<span class="tag">ÖZEL</span>' : ''}${done ? '<span class="tag again">TEKRAR OYNA</span>' : ''}</strong>
          <span class="card-count">${value}/${m.target}</span>
        </div>
        <p>${m.desc}</p>
        <div class="card-bar"><span style="width:${Math.round((value / m.target) * 100)}%"></span></div>`;
      li.addEventListener('click', () => onPick(m));
      this.el.missionCards.append(li);
    }
  }

  /* ── Üst bilgi ─────────────────────────────────────────────────────── */

  /**
   * Baskın görünümü: başlıkta "BASKIN", altında can barı gibi dolu başlayıp
   * her ölen düşmanla azalan dalga barı. waves = toplam dalga (0 = normal).
   */
  setRaidMode(waves, label = 'BASKIN') {
    this._raidWaves = waves;
    this._raidLabel = label;
    this.el.waveBlock.classList.toggle('raid', waves > 0);
    if (!waves) this.el.waveLabel.textContent = 'DALGA';
  }

  setWave(n, remaining, total) {
    if (this._raidWaves) {
      this.el.wave.textContent = this._raidLabel ?? 'BASKIN';
      this.el.waveLabel.textContent = `DALGA ${n} / ${this._raidWaves}`;
      this.el.enemiesLeft.textContent = remaining > 0 ? `${remaining} / ${total} düşman` : 'DALGA BİTTİ';
      const left = total > 0 ? remaining / total : 0;
      this.el.waveBar.style.width = `${(left * 100).toFixed(1)}%`;
      return;
    }
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

  /** Başarım bildirimi (sırayla, her biri ~4.5 sn). */
  achievement(def) {
    (this._achvQueue ??= []).push(def);
    if (!this._achvBusy) this._nextAchievement();
  }

  _nextAchievement() {
    const el = $('achv');
    const def = this._achvQueue.shift();
    if (!def) { this._achvBusy = false; return; }
    this._achvBusy = true;
    $('achv-name').textContent = def.ad;
    const r = $('achv-reward');
    r.textContent = def.odul > 0 ? `ÖDÜL  +${def.odul} PUAN` : 'ÖDÜL YOK';
    r.classList.toggle('none', !(def.odul > 0));
    el.hidden = false;
    el.classList.remove('in');
    void el.offsetWidth;                 // animasyonu baştan başlat
    el.classList.add('in');
    clearTimeout(this._achvT);
    this._achvT = setTimeout(() => {
      el.classList.remove('in');
      this._achvT = setTimeout(() => { el.hidden = true; this._nextAchievement(); }, 350);
    }, 4500);
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

  setHealth(hp, max, cap = max) {
    const pct = Math.max(0, hp / max);
    this.el.healthFill.style.width = `${pct * 100}%`;
    this.el.healthFill.className = pct < 0.25 ? 'crit' : pct < 0.55 ? 'warn' : '';
    this.el.healthNum.textContent = Math.ceil(hp);
    // Ağır yaralıyken sınırın ötesi taranmış görünür
    const bar = this.el.healthFill.parentElement;
    bar.style.setProperty('--cap', `${(cap / max) * 100}%`);
    bar.classList.toggle('capped', cap < max);
  }

  /** Ağır yaralı ekranı. progress: çemberin dolumu (0–1). */
  setDowned(on, progress = 0, hitsLeft = 0) {
    const el = $('downed');
    if (el.hidden === on) el.hidden = !on;
    document.body.classList.toggle('is-downed', on);
    if (!on) return;
    const C = 2 * Math.PI * 52;
    const ring = $('downed-ring');
    ring.style.strokeDasharray = `${C}`;
    ring.style.strokeDashoffset = `${C * (1 - progress)}`;
    const text = hitsLeft <= 1
      ? 'Tek isabet ölümcül — W A S D ile sürünüp siper al, çember dolunca kalkarsın'
      : `Hasar alma — çember dolunca ayağa kalkarsın (${hitsLeft} isabet ölümcül)`;
    if (this._downedText !== text) { this._downedText = text; $('downed-sub').textContent = text; }
  }

  /** Can sınırı ve tedavi durumu (null = yaralı değil). */
  setWound(w) {
    const el = $('wound-tag');
    const text = !w ? ''
      : w.tedavi ? `${w.tedavi.ad} kullanılıyor… %${Math.min(100, Math.round(w.tedavi.t * 100))}`
        : `AĞIR YARALI · can en fazla ${w.cap} · H: ${w.adim} (${w.adet} adet)`;
    if (text === this._woundText) return;
    this._woundText = text;
    el.hidden = !w;
    el.textContent = text;
    el.classList.toggle('none', Boolean(w) && !w.tedavi && w.adet === 0);
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
    this.el.fireMode.textContent = def.melee ? 'YAKIN' : def.auto ? 'OTO' : 'TEK';
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

  /** Büyütmesiz silah dürbünü görüntüsü. */
  setOptic(on) {
    const el = $('optic');
    if (el.hidden === !on) return;
    el.hidden = !on;
  }

  /* ── Dürbün, etkileşim ipucu, Baskın ───────────────────────────────── */

  setBinocular(on) {
    if (this.el.binoc.hidden === !on) return;
    this.el.binoc.hidden = !on;
  }

  /** range: metre (null = hedef yok), bearing: derece (0 = kuzey) */
  setBinocReadout(range, bearing) {
    this.el.binocRange.textContent = range == null ? '— m' : `${Math.round(range)} m`;
    this.el.binocBearing.textContent = `${String(Math.round(bearing) % 360).padStart(3, '0')}°`;
  }

  /** Ekranın ortasında tuş ipucu; [tuş, metin] ya da null. */
  setHint(hint) {
    const el = this.el.interactHint;
    const key = hint ? hint.join('|') : '';
    if (key === this._hintKey) return;
    this._hintKey = key;
    el.hidden = !hint;
    if (!hint) return;
    el.innerHTML = '';
    const kbd = document.createElement('kbd');
    kbd.textContent = hint[0];
    el.append(kbd, hint[1]);
  }

  /** Dalga duyurusu: üstte kısa süre kalan büyük başlık. */
  banner(eyebrow, title, ms = 2800) {
    const el = this.el.raidBanner;
    this.el.raidBannerEyebrow.textContent = eyebrow;
    this.el.raidBannerTitle.textContent = title;
    el.hidden = false;
    el.style.animation = 'none';
    void el.offsetWidth;                  // animasyonu baştan oynat
    el.style.animation = '';
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  hideBanner() {
    clearTimeout(this._bannerTimer);
    this.el.raidBanner.hidden = true;
  }

  /**
   * Alan kartları. maps: maps.js listesi, onPick(id): seçilince.
   * Önizleme şeridi alanın gök → ufuk → zemin renklerinden çizilir.
   */
  buildMapPick(maps, selectedId, missionName, onPick) {
    $('mappick-mission').textContent = missionName ? `ALAN SEÇİMİ · ${missionName}` : 'ALAN SEÇİMİ · SERBEST HAT';
    const grid = $('map-grid');
    grid.innerHTML = '';
    for (const m of maps) {
      const [gok, ufuk, zemin, koyu] = m.onizleme;
      const card = document.createElement('article');
      card.className = `shop-card map-card${m.id === selectedId ? ' equipped' : ''}`;
      card.innerHTML = `
        <div class="map-preview" style="background:
          linear-gradient(180deg, ${gok} 0%, ${ufuk} 52%, ${zemin} 53%, ${koyu} 100%)"></div>
        <header><h3>${m.ad}</h3>${m.id === selectedId ? '<span class="shop-price">SON SEÇİLEN</span>' : ''}</header>
        <p>${m.aciklama}</p>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shop-btn';
      btn.textContent = 'Bu alanda başla';
      btn.addEventListener('click', () => onPick(m.id));
      card.append(btn);
      grid.append(card);
    }
  }

  /**
   * Baskın donanım kartları. defs: silah künyeleri, selected: Set(id),
   * onToggle(id): seçim değişince.
   */
  buildRaidLoadout(defs, selected, onToggle, max = 2, baskin = true) {
    const grid = $('raid-loadout-grid');
    grid.innerHTML = '';
    const full = selected.size >= max;
    $('loadout-eyebrow').textContent = baskin ? 'BASKIN · DONANIM' : 'GÖREV · DONANIM';
    $('loadout-title').textContent = baskin ? 'İki silah seç' : 'Dört silah seç';
    $('loadout-note-baskin').hidden = !baskin;
    $('loadout-note-genel').hidden = baskin;
    for (const d of defs) {
      const on = selected.has(d.id);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `shop-card loadout-card${on ? ' equipped' : ''}`;
      card.disabled = full && !on;
      card.setAttribute('aria-pressed', String(on));
      const rows = d.rocket
        ? [['Roket', `${d.mag} + ${d.reserve}`], ['Patlama hasarı', d.rocket.maxDamage]]
        : [['Cephane', `${d.mag} + ${d.reserve}`], ['Hasar', d.damage], ['Atış hızı', `${d.rpm} /dk`]];
      card.innerHTML = `
        <header><h3>${d.name}</h3><span class="pick">${on ? 'SEÇİLDİ' : `YUVA ${d.slot}`}</span></header>
        <dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
      card.addEventListener('click', () => onToggle(d.id));
      grid.append(card);
    }
    $('raid-start-btn').disabled = selected.size !== max;
    $('raid-pick-count').textContent = `${selected.size} / ${max}`;
  }

  /**
   * Görev sonu: siyah ekranda "KAHRAMAN ASKER", ardından dalgalanan Türk
   * bayrağı ve "İkinci bölüm yakında". stats: { kills, score, accuracy }
   */
  raidFinale({ kills, score, accuracy }) {
    const title = $('finale-title');
    const flag = $('finale-flag');
    $('finale-kills').textContent = kills;
    $('finale-score').textContent = score.toLocaleString('tr-TR');
    $('finale-acc').textContent = `${Math.round(accuracy * 100)}%`;
    title.hidden = false;
    flag.hidden = true;
    title.style.animation = 'none';
    void title.offsetWidth;
    title.style.animation = '';
    this.screen('raidFinale');

    clearTimeout(this._finaleTimer);
    this._finaleTimer = setTimeout(() => {
      title.hidden = true;
      flag.hidden = false;
      this._waveFlag($('flag-canvas'));
    }, 3600);
  }

  /** Bayrak: önce düz çizilir, sonra dilim dilim dalga ve gölgeyle basılır. */
  _waveFlag(canvas) {
    const g = canvas.getContext('2d');
    const CW = canvas.width, CH = canvas.height;
    const FW = 780, FH = 520;                 // 3:2 (TS 4991 oranı)
    const flat = document.createElement('canvas');
    flat.width = FW;
    flat.height = FH;
    const f = flat.getContext('2d');
    f.fillStyle = '#e30a17';
    f.fillRect(0, 0, FW, FH);
    // Resmî ölçülerle ay-yıldız (G = bayrak eni = 60000 birim)
    f.save();
    f.scale(FW / 90000, FH / 60000);
    f.translate(0, 30000);
    f.fillStyle = '#ffffff';
    f.fill(new Path2D(
      'm41750 0 13568-4408-8386 11541V-7133l8386 11541z'
      + 'm925 8021a15000 15000 0 1 1 0-16042 12000 12000 0 1 0 0 16042z',
    ));
    f.restore();

    const ox = 96, oy = 18;                   // gönderin sağı
    const t0 = performance.now();
    const frame = () => {
      if (this.el.raidFinale.hidden) return;   // ekran kapanınca dur
      const t = (performance.now() - t0) / 1000;
      g.clearRect(0, 0, CW, CH);

      // Gönder
      const pole = g.createLinearGradient(ox - 16, 0, ox, 0);
      pole.addColorStop(0, '#6e6a62');
      pole.addColorStop(0.5, '#e6e2d8');
      pole.addColorStop(1, '#5b5850');
      g.fillStyle = pole;
      g.fillRect(ox - 14, 6, 10, CH - 6);
      g.fillStyle = '#d9b45a';
      g.beginPath();
      g.arc(ox - 9, 8, 8, 0, Math.PI * 2);
      g.fill();

      // Dalga: gönderden uzaklaştıkça genlik artar
      const step = 3;
      for (let x = 0; x < FW; x += step) {
        const k = x / FW;
        const phase = x * 0.016 - t * 3.2;
        const dy = Math.sin(phase) * 16 * k + Math.sin(phase * 0.47 + 1.3) * 6 * k;
        const shade = Math.cos(phase) * 0.22 * (0.25 + k);
        g.drawImage(flat, x, 0, step + 0.6, FH, ox + x, oy + dy, step + 0.6, FH);
        g.fillStyle = shade > 0 ? `rgba(255,255,255,${shade * 0.55})` : `rgba(0,0,0,${-shade})`;
        g.fillRect(ox + x, oy + dy, step + 0.6, FH);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
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
