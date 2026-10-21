/* Kaydet ve çık: görev başına bir kayıt (localStorage).

   Esc → duraklatma → "Kaydet ve çık": oyunun o anki durumu görevin
   kimliğiyle saklanır ('serbest' = serbest hat). Görev listesinden aynı
   göreve basınca kaldığın yerden devam edilir; görev bitince kayıt silinir.
   Ölünce kayıt KALIR (son kaydettiğin yerden yeniden başlarsın).

   Kaydedilenler (game._snapshot): puan, öldürme, can, konum, silahlar ve
   mermileri, el bombası, dalga, görev ilerlemesi + görev türüne özel durum
   (Füze Rampası yol/çatışma, Suikast aşaması, Tümgeneral'in 4500 askerlik
   ordusu). Düşmanlar ve mermiler tek tek saklanmaz: dalga baştan başlar.  */

const KEY = 'celikhat.kayitlar';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; }
}

function writeAll(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;                 // gizli sekme ya da kota dolu
  }
}

export const SaveGame = {
  key(missionId) { return missionId ?? 'serbest'; },
  get(missionId) { return readAll()[this.key(missionId)] ?? null; },
  has(missionId) { return Boolean(this.get(missionId)); },
  put(missionId, data) {
    const all = readAll();
    all[this.key(missionId)] = { ...data, at: Date.now() };
    return writeAll(all);
  },
  drop(missionId) {
    const all = readAll();
    delete all[this.key(missionId)];
    writeAll(all);
  },
};

/* ── Tipli diziler ↔ base64 (ordu kaydı) ─────────────────────────────── */

export function packArray(arr, n) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, n * arr.BYTES_PER_ELEMENT);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unpackInto(arr, b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, Math.min(s.length, arr.byteLength));
  for (let i = 0; i < bytes.length; i++) bytes[i] = s.charCodeAt(i);
}
