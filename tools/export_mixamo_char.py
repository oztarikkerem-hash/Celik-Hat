"""Mixamo iskeletli bir karakter .blend dosyasını oyunun GLB'sine çevirir.

`export_soldier_hq.py`den farkı: deri ağırlıkları TAHMİN EDİLMEZ. Model zaten
riglenmiş geldiği için ağırlıklar doğrudan vertex gruplarından okunur. Eski
modelde ağırlıkları mesafeden hesaplamak zorundaydık; bel büzülmesi ve omuzdan
fırlayan üçgenler oradan geliyordu.

Yapılanlar:
  • Yalnızca KARAKTER parçaları alınır: armature modifier'ı olanlar (deri
    bağlı) ve bir kemiğe parented olanlar (çanta/şarjör gibi katı parçalar,
    %100 o kemiğe bağlanır). Karakterin elindeki silah modeli dışarıda kalır.
  • `mixamorig:` öneki kemik adlarından silinir — oyun kodu Mixamo'nun sade
    adlarını (Hips, Spine, LeftArm…) bekliyor.
  • Armature'ın nesne ölçeği pişirilir, model metre cinsinden çıkar.
  • Dokular GLB'nin yanına kopyalanır (yeniden kodlanmaz: renk bozulmasın).

Kullanım:
  blender --background <karakter>.blend --python tools/export_mixamo_char.py -- \\
      <cikis.glb> [haric_malzemeler_virgullu] [doku_boyutu]
"""
import bpy
import bmesh
import json
import os
import struct
import sys
import shutil
import re
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not argv:
    raise SystemExit("Çıkış yolu gerekli")

OUT = argv[0]
EXCLUDE_MATS = {m.strip().lower() for m in (argv[1].split(",") if len(argv) > 1 and argv[1] else [])}
TEX_SIZE = int(argv[2]) if len(argv) > 2 else 2048
# Sketchfab paketlerinde dokular ayrı bir klasörde durur ve .blend içindeki
# malzemelere BAĞLI DEĞİLDİR. Verilirse o klasör taranıp malzeme adına göre
# eşleştirilir (Body.001 → Body_Base_color.png).
SRC_TEX_DIR = argv[3] if len(argv) > 3 else ""
TEX_DIR = os.path.join(os.path.dirname(OUT), "tex")
os.makedirs(TEX_DIR, exist_ok=True)

# Blender Z-yukarı → glTF Y-yukarı
CONV = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
CONV_INV = CONV.inverted()


# ── Sahneyi hazırla ─────────────────────────────────────────────────────
def unhide(lc):
    lc.exclude = False
    lc.hide_viewport = False
    for c in lc.children:
        unhide(c)


unhide(bpy.context.view_layer.layer_collection)
for ob in bpy.data.objects:
    if not ob.users_collection:
        bpy.context.scene.collection.objects.link(ob)
    ob.hide_viewport = False
    try:
        ob.hide_set(False)
    except RuntimeError:
        pass

for ob in list(bpy.data.objects):
    if ob.type in {"CAMERA", "LIGHT"}:
        bpy.data.objects.remove(ob, do_unlink=True)

armature = next(o for o in bpy.data.objects if o.type == "ARMATURE")

# Karakterin kapladığı hacim: serbest parçaların ona ait olup olmadığını
# anlamak için (kemik uçlarının dünya koordinatlarından)
_bw = [armature.matrix_world @ b.head_local for b in armature.data.bones] + \
      [armature.matrix_world @ b.tail_local for b in armature.data.bones]
arm_merkez = sum(_bw, Vector()) / max(1, len(_bw))
arm_yaricap = max((p - arm_merkez).length for p in _bw) * 1.25


def karakter_parcasi(o):
    """Mesh karakterin bir parçası mı? (silah/sahne eşyası değil)"""
    if o.type != "MESH" or o.hide_render:
        return False
    if any((s.material and s.material.name.lower() in EXCLUDE_MATS) for s in o.material_slots):
        return False
    if any(m.type == "ARMATURE" for m in o.modifiers):
        return True
    if o.parent is armature and o.parent_type == "BONE" and o.parent_bone:
        return True
    # Hiçbir yere bağlanmamış küçük teçhizat (fişeklik, arma): karakterin
    # gövdesinin içindeyse en yakın kemiğe sabitlenir. FSB modelinde
    # çantalar sahnede serbest duruyor, bağlanmazsa asker yürürken
    # oldukları yerde kalıyorlar.
    if o.parent is None and not o.vertex_groups and not o.modifiers:
        merkez = sum((o.matrix_world @ Vector(c) for c in o.bound_box), Vector()) / 8
        return (merkez - arm_merkez).length < arm_yaricap
    return False


meshes = [o for o in bpy.data.objects if karakter_parcasi(o)]
atlanan = [o.name for o in bpy.data.objects
           if o.type == "MESH" and o not in meshes]
print(f"BASLANGIC\tkarakter_mesh={len(meshes)}\tatlanan={len(atlanan)}")
print(f"ATLANAN\t{atlanan[:25]}")
if not meshes:
    raise SystemExit("Karakter mesh'i bulunamadı")

# Kemiğe parented katı parçaların hangi kemiğe ait olduğunu birleştirmeden
# önce saklıyoruz; birleşince bu bilgi kayboluyor.
def en_yakin_kemik(o):
    """Serbest parçayı en yakın kemiğe bağlar (parça merkezine göre)."""
    merkez = sum((o.matrix_world @ Vector(c) for c in o.bound_box), Vector()) / 8
    # Fişeklik/arma kola değil gövdeye aittir: A-pozunda kollar göğsün
    # yanında durduğu için en yakın kemik yanlışlıkla ön kol çıkıyor.
    YASAK = ("ForeArm", "Hand", "Shoulder", "Neck", "Head", "Toe")
    en_iyi, en_kisa = None, 1e18
    for b in armature.data.bones:
        if any(k in b.name for k in YASAK):
            continue
        h = armature.matrix_world @ b.head_local
        t = armature.matrix_world @ b.tail_local
        ab = t - h
        u = max(0.0, min(1.0, (merkez - h).dot(ab) / (ab.length_squared or 1e-9)))
        d = (merkez - (h + ab * u)).length
        if d < en_kisa:
            en_kisa, en_iyi = d, b.name
    return en_iyi


kemik_sahibi = {}            # mesh adı → kemik adı
for o in meshes:
    if o.parent is armature and o.parent_type == "BONE" and o.parent_bone:
        kemik_sahibi[o.name] = o.parent_bone
    elif not o.vertex_groups and not any(m.type == "ARMATURE" for m in o.modifiers):
        k = en_yakin_kemik(o)
        if k:
            kemik_sahibi[o.name] = k
            print(f"SABITLENDI\t{o.name} → {k}")

# ── Modifier'ları birleştirmeden önce uygula ────────────────────────────
uygulanan = 0
for o in meshes:
    bpy.context.view_layer.objects.active = o
    for mod in list(o.modifiers):
        if mod.type in {"ARMATURE", "SUBSURF", "MULTIRES"}:
            o.modifiers.remove(mod)
            continue
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
            uygulanan += 1
        except RuntimeError:
            o.modifiers.remove(mod)
print(f"MODIFIER\tuygulanan={uygulanan}")

# Kemiğe parented parçaların köşelerini dünya uzayına sabitle: birleşme
# sırasında parent bilgisi düşüyor, yoksa parça yanlış yere oturuyor.
for o in meshes:
    if o.name in kemik_sahibi:
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        o.parent = None

# Katı parçaların kemik bağlantısını GERÇEK vertex grubu olarak yaz.
# Köşe aralığı tutmak kırılgandı: Blender'ın join'i köşe sırasını bizim
# liste sıramızla aynı tutmuyor, çanta bağlantısı bota düşüyordu.
for o in meshes:
    kemik = kemik_sahibi.get(o.name)
    if not kemik:
        continue
    vg = o.vertex_groups.get(kemik) or o.vertex_groups.new(name=kemik)
    vg.add([v.index for v in o.data.vertices], 1.0, "REPLACE")

# UV katmanlarının adı her parçada aynı olmalı. Farklı adlar (UVMap /
# map1 / UVChannel_1) join sırasında AYRI katmanlara düşüyor; birleşen
# mesh'in aktif katmanında diğer parçaların UV'si sıfır kalıyor ve model
# tek bir dokunun köşe pikselini örnekleyerek düz beyaz görünüyor.
# (Katmanları SİLMİYORUZ: silme sırasında koleksiyon yeniden
# konumlanıyor ve elimizdeki referans geçersizleşiyor.)
for o in meshes:
    uvs = o.data.uv_layers
    if not len(uvs):
        uvs.new(name="UVMap")
        continue
    idx = uvs.active_index if uvs.active_index >= 0 else 0
    for i, u in enumerate(uvs):
        if i != idx and u.name == "UVMap":
            u.name = "UVMap_alt"
    uvs[idx].name = "UVMap"
    uvs.active_index = idx

bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = "Character"
for mod in list(body.modifiers):
    body.modifiers.remove(mod)

bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode="EDIT")
bm = bmesh.from_edit_mesh(body.data)
bmesh.ops.triangulate(bm, faces=bm.faces)
bmesh.update_edit_mesh(body.data)
bpy.ops.object.mode_set(mode="OBJECT")

mesh = body.data
mesh.calc_loop_triangles()
try:
    mesh.calc_normals_split()
except AttributeError:
    pass                      # Blender 4.1+ otomatik
# Katman silindikten sonra "aktif" bayrağı düşebiliyor; ilkini seç.
if len(mesh.uv_layers) and mesh.uv_layers.active is None:
    mesh.uv_layers.active_index = 0
uv_layer = mesh.uv_layers.active or (mesh.uv_layers[0] if len(mesh.uv_layers) else None)
print(f"MESH\tkose={len(mesh.vertices)}\tucgen={len(mesh.loop_triangles)}\tuv={bool(uv_layer)}")


# ── Dokular ─────────────────────────────────────────────────────────────
def save_image(img, suffix):
    """Dokuyu GLB'nin yanına yazar; mümkünse orijinali olduğu gibi kopyalar."""
    if img is None:
        return None
    taban = "".join(c if c.isalnum() or c in "-_" else "_" for c in img.name)
    src = bpy.path.abspath(img.filepath_from_user()) if (img.filepath_raw or img.filepath) else ""
    uzanti = os.path.splitext(src)[1].lower() if src else ".png"
    if uzanti not in (".png", ".jpg", ".jpeg"):
        uzanti = ".png"
    name = f"{taban}_{suffix}{uzanti}"
    path = os.path.join(TEX_DIR, name)

    if src and os.path.exists(src):
        if not os.path.exists(path):
            shutil.copyfile(src, path)
            print(f"DOKU_KOPYA\t{name}")
        return f"tex/{name}"

    name = f"{taban}_{suffix}.png"          # pakete gömülü: yeniden yaz
    path = os.path.join(TEX_DIR, name)
    if not os.path.exists(path):
        copy = img.copy()
        if max(copy.size) > TEX_SIZE:
            k = TEX_SIZE / max(copy.size)
            copy.scale(max(1, int(copy.size[0] * k)), max(1, int(copy.size[1] * k)))
        copy.file_format = "PNG"
        copy.filepath_raw = path
        try:
            copy.save()
        except RuntimeError as exc:
            print("DOKU_HATA", name, exc)
            return None
        bpy.data.images.remove(copy)
    return f"tex/{name}"


def disk_dokulari(mat_adi):
    """Doku klasöründe malzemeye en çok uyan dosyaları rollere ayırır.

    Önek eşleşmesi yetmiyor: malzeme 'boots' iken dosya
    'army_boot_boot_lp_Normal.jpeg' olabiliyor. Malzeme adı jetonlara
    ayrılıp (çoğul 's' atılarak) dosya adında aranıyor, en çok jeton
    tutturan dosya o rolü alıyor."""
    if not SRC_TEX_DIR or not os.path.isdir(SRC_TEX_DIR):
        return {}
    jetonlar = [t[:-1] if len(t) > 3 and t.endswith("s") else t
                for t in re.split(r"[^a-z0-9]+", (mat_adi or "").lower())
                if len(t) > 2 and not t.isdigit()]
    if not jetonlar:
        return {}

    def rol(ad):
        n = ad.lower()
        if any(k in n for k in ("basecolor", "base_color", "albedo", "diffuse", "_color")):
            return "base"
        if "normal" in n or n.endswith("_n"):
            return "normal"
        if "rough" in n:
            return "rough"
        if "metallic" in n or "_ao" in n or "emissive" in n or "sss" in n:
            return None
        return "base"                       # rolsüz dosya: temel renk say

    en_iyi = {}
    for f in sorted(os.listdir(SRC_TEX_DIR)):
        taban = os.path.splitext(f)[0].lower()
        puan = sum(1 for t in jetonlar if t in taban)
        if not puan:
            continue
        r = rol(taban)
        if not r:
            continue
        onceki = en_iyi.get(r)
        if not onceki or puan > onceki[0] or (puan == onceki[0] and len(f) < len(onceki[1])):
            en_iyi[r] = (puan, f)
    return {r: os.path.join(SRC_TEX_DIR, f) for r, (_, f) in en_iyi.items()}


# Saydamlık gerektiren dokular PNG kalır; gerisi JPEG'e iner.
SAYDAM = ("eyelash", "lash", "hair", "alpha", "opacity", "leaf")


def kopyala(src):
    """Dokuyu GLB'nin yanına yazar: TEX_SIZE'a indirir, JPEG'e çevirir.

    4K PNG'ler tek karakter için 80 MB'ı buluyor ve tarayıcıda açılışı
    dakikalara çıkarıyor. Küçültme/çevirme Blender yerine macOS'un `sips`
    aracıyla yapılır: Blender'dan yeniden kodlamak renk yönetimi yüzünden
    dokuları uçuk gösteriyor."""
    if not src:
        return None
    taban, uzanti = os.path.splitext(os.path.basename(src))
    saydam = any(k in taban.lower() for k in SAYDAM)
    name = taban + (".png" if saydam else ".jpg")
    hedef = os.path.join(TEX_DIR, name)
    if os.path.exists(hedef):
        return f"tex/{name}"

    import subprocess
    cmd = ["sips", "-Z", str(TEX_SIZE)]
    if not saydam:
        cmd += ["-s", "format", "jpeg", "-s", "formatOptions", "92"]
    cmd += [src, "--out", hedef]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        kb = os.path.getsize(hedef) // 1024
        print(f"DOKU\t{name}\t{kb}KB")
    except Exception as exc:
        print(f"DOKU_SIPS_HATA\t{name}\t{exc}")
        shutil.copyfile(src, os.path.join(TEX_DIR, os.path.basename(src)))
        return f"tex/{os.path.basename(src)}"
    return f"tex/{name}"


def material_info(mat):
    info = {"color": (0.8, 0.8, 0.8, 1.0), "rough": 0.85, "metal": 0.0,
            "base_tex": None, "normal_tex": None, "rough_tex": None}
    if not mat or not mat.use_nodes:
        return info
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)

    # Önce diskteki doku klasörü (Sketchfab paketleri böyle gelir)
    diskte = disk_dokulari(mat.name)
    if diskte:
        info["base_tex"] = kopyala(diskte.get("base"))
        info["normal_tex"] = kopyala(diskte.get("normal"))
        info["rough_tex"] = kopyala(diskte.get("rough"))
        if info["base_tex"]:
            info["color"] = (1.0, 1.0, 1.0, 1.0)
        info["rough"] = 1.0 if info["rough_tex"] else 0.85
        return info

    found = {}
    for node in mat.node_tree.nodes:
        if node.type != "TEX_IMAGE" or not node.image:
            continue
        n = (node.image.name + " " + (node.image.filepath or "")).lower()
        if any(k in n for k in ("basecolor", "base_color", "albedo", "diffuse", "_color")):
            found.setdefault("base", node.image)
        elif "normal" in n:
            found.setdefault("normal", node.image)
        elif "rough" in n:
            found.setdefault("rough", node.image)
    if found:
        info["base_tex"] = save_image(found.get("base"), "base")
        info["normal_tex"] = save_image(found.get("normal"), "nrm")
        info["rough_tex"] = save_image(found.get("rough"), "rough")
        if info["base_tex"]:
            info["color"] = (1.0, 1.0, 1.0, 1.0)
        info["rough"] = 1.0 if info["rough_tex"] else 0.85
        return info

    if bsdf:
        c = bsdf.inputs["Base Color"]
        if not c.is_linked:
            info["color"] = tuple(c.default_value)
        r = bsdf.inputs["Roughness"]
        if not r.is_linked:
            info["rough"] = float(r.default_value)
        m = bsdf.inputs["Metallic"]
        if not m.is_linked:
            info["metal"] = float(m.default_value)
    return info


slots = [material_info(sl.material) for sl in body.material_slots]
print(f"MALZEME\t{len(slots)}\t{[sl.material.name if sl.material else '-' for sl in body.material_slots]}")

# ── Kemikler ────────────────────────────────────────────────────────────
SIL = "mixamorig:"
bones = list(armature.data.bones)
bone_index = {b.name: i for i, b in enumerate(bones)}
ad = lambda b: b.name.replace(SIL, "")

# Her şey DÜNYA uzayında hesaplanır. Armatür uzayını kullanmak kırılgandı:
# FBX'ten gelen bazı rig'lerde armatür nesnesi hem 0.01 ölçekli hem de
# döndürülmüş oluyor, model yan yatıp küçülüyordu.
A = armature.matrix_world
bone_world = {b.name: CONV @ (A @ b.matrix_local) @ CONV_INV for b in bones}
print(f"KEMIK\ttoplam={len(bones)}\tarmature_olcek={tuple(round(v, 4) for v in A.to_scale())}")

# ── Ağırlıklar: vertex gruplarından (tahmin YOK) ────────────────────────
grup_kemik = {}              # vertex grup indeksi → kemik indeksi
for gi, g in enumerate(body.vertex_groups):
    bi = bone_index.get(g.name)
    if bi is None:
        bi = bone_index.get(SIL + g.name)
    if bi is not None:
        grup_kemik[gi] = bi

eslenmeyen = [g.name for gi, g in enumerate(body.vertex_groups) if gi not in grup_kemik]
print(f"GRUP\ttoplam={len(body.vertex_groups)}\teslesen={len(grup_kemik)}\teslenmeyen={eslenmeyen[:20]}")

# Modelde gruba hiç atanmamış köşeler olabiliyor (FSB üniformasının bazı
# küçük parçalarında var). Onları en yakın kemiğe bağlıyoruz; kalçaya
# düşerlerse asker yürürken parçalar havada asılı kalıyor.
_segs = [(armature.matrix_world @ b.head_local,
          armature.matrix_world @ b.tail_local) for b in bones]
_m2w = body.matrix_world


def en_yakin_kemik_kose(co):
    dunya = _m2w @ co
    en_iyi, en_kisa = 0, 1e18
    for i, (h, t) in enumerate(_segs):
        ab = t - h
        u = max(0.0, min(1.0, (dunya - h).dot(ab) / (ab.length_squared or 1e-9)))
        d = (dunya - (h + ab * u)).length
        if d < en_kisa:
            en_kisa, en_iyi = d, i
    return en_iyi


vert_skin = []
bossuz = 0
for vi, v in enumerate(mesh.vertices):
    etki = []
    for g in v.groups:
        bi = grup_kemik.get(g.group)
        if bi is not None and g.weight > 0.0005:
            etki.append((g.weight, bi))
    etki.sort(reverse=True)
    etki = etki[:4]
    tot = sum(w for w, _ in etki)
    if tot <= 0:
        bossuz += 1
        vert_skin.append(([en_yakin_kemik_kose(v.co), 0, 0, 0], [1.0, 0.0, 0.0, 0.0]))
        continue
    idx = [b for _, b in etki] + [0] * (4 - len(etki))
    wts = [w / tot for w, _ in etki] + [0.0] * (4 - len(etki))
    vert_skin.append((idx, wts))
print(f"AGIRLIK\tvertex_grup={len(grup_kemik)}\tagirliksiz={bossuz}")

# ── Köşe tamponu ────────────────────────────────────────────────────────
positions, normals, uvs, joints, weights = [], [], [], [], []
index_of = {}
prims = {}
M = CONV @ body.matrix_world
M3 = M.to_3x3()

for tri in mesh.loop_triangles:
    prims.setdefault(tri.material_index, [])
    for k in range(3):
        vi = tri.vertices[k]
        li = tri.loops[k]
        uv = tuple(uv_layer.data[li].uv) if uv_layer else (0.0, 0.0)
        no = tuple(mesh.loops[li].normal) if tri.use_smooth else tuple(tri.normal)
        key = (vi, round(uv[0], 5), round(uv[1], 5),
               round(no[0], 3), round(no[1], 3), round(no[2], 3))
        idx = index_of.get(key)
        if idx is None:
            idx = len(positions)
            index_of[key] = idx
            co = M @ mesh.vertices[vi].co
            nn = (M3 @ Vector(no)).normalized()
            positions.append((co.x, co.y, co.z))
            normals.append((nn.x, nn.y, nn.z))
            uvs.append((uv[0], 1.0 - uv[1]))
            j, w = vert_skin[vi]
            joints.append(j)
            weights.append(w)
        prims[tri.material_index].append(idx)

yukseklik = max(p[1] for p in positions) - min(p[1] for p in positions)
print(f"KOSE\t{len(positions)}\tprimitive={len(prims)}\tboy={yukseklik:.3f}m")

# ── glTF tamponları ─────────────────────────────────────────────────────
bin_parts, views, accessors = [], [], []
offset = 0


def add_view(data_bytes, target=None):
    global offset
    pad = (-len(data_bytes)) % 4
    bin_parts.append(data_bytes + b"\x00" * pad)
    v = {"buffer": 0, "byteOffset": offset, "byteLength": len(data_bytes)}
    if target:
        v["target"] = target
    views.append(v)
    offset += len(data_bytes) + pad
    return len(views) - 1


def add_accessor(view, ctype, count, type_, minmax=None):
    acc = {"bufferView": view, "componentType": ctype, "count": count, "type": type_}
    if minmax:
        acc["min"], acc["max"] = minmax
    accessors.append(acc)
    return len(accessors) - 1


mins = [min(p[i] for p in positions) for i in range(3)]
maxs = [max(p[i] for p in positions) for i in range(3)]
acc_pos = add_accessor(add_view(b"".join(struct.pack("<3f", *p) for p in positions), 34962),
                       5126, len(positions), "VEC3", (mins, maxs))
acc_nrm = add_accessor(add_view(b"".join(struct.pack("<3f", *n) for n in normals), 34962),
                       5126, len(normals), "VEC3")
acc_uv = add_accessor(add_view(b"".join(struct.pack("<2f", *t) for t in uvs), 34962),
                      5126, len(uvs), "VEC2")
acc_jnt = add_accessor(add_view(b"".join(struct.pack("<4H", *j) for j in joints), 34962),
                       5123, len(joints), "VEC4")
acc_wgt = add_accessor(add_view(b"".join(struct.pack("<4f", *w) for w in weights), 34962),
                       5126, len(weights), "VEC4")

images, textures, samplers, materials, primitives = [], [], [{"magFilter": 9729, "minFilter": 9987}], [], []
tex_index = {}


def tex_ref(uri):
    if not uri:
        return None
    if uri not in tex_index:
        images.append({"uri": uri})
        textures.append({"source": len(images) - 1, "sampler": 0})
        tex_index[uri] = len(textures) - 1
    return {"index": tex_index[uri]}


for mat_i, idx_list in sorted(prims.items()):
    info = slots[mat_i] if mat_i < len(slots) else material_info(None)
    idx_bytes = b"".join(struct.pack("<I", i) for i in idx_list)
    acc_idx = add_accessor(add_view(idx_bytes, 34963), 5125, len(idx_list), "SCALAR")

    pbr = {"baseColorFactor": list(info["color"]),
           "metallicFactor": info["metal"], "roughnessFactor": info["rough"]}
    base = tex_ref(info["base_tex"])
    if base:
        pbr["baseColorTexture"] = base
    rough = tex_ref(info["rough_tex"])
    if rough:
        pbr["metallicRoughnessTexture"] = rough

    mat_def = {"name": f"MAT_{mat_i}", "pbrMetallicRoughness": pbr, "doubleSided": False}
    nrm = tex_ref(info["normal_tex"])
    if nrm:
        mat_def["normalTexture"] = nrm
    materials.append(mat_def)
    primitives.append({
        "attributes": {"POSITION": acc_pos, "NORMAL": acc_nrm, "TEXCOORD_0": acc_uv,
                       "JOINTS_0": acc_jnt, "WEIGHTS_0": acc_wgt},
        "indices": acc_idx,
        "material": len(materials) - 1,
    })

ibm = b""
for b in bones:
    m = bone_world[b.name].inverted()
    ibm += struct.pack("<16f", *[m[r][c] for c in range(4) for r in range(4)])
acc_ibm = add_accessor(add_view(ibm), 5126, len(bones), "MAT4")

nodes = []
for b in bones:
    w = bone_world[b.name]
    local = w if b.parent is None else bone_world[b.parent.name].inverted() @ w
    t, r, s = local.decompose()
    nodes.append({"name": ad(b), "translation": [t.x, t.y, t.z],
                  "rotation": [r.x, r.y, r.z, r.w], "scale": [s.x, s.y, s.z], "children": []})
for i, b in enumerate(bones):
    if b.parent is not None:
        nodes[bone_index[b.parent.name]]["children"].append(i)

roots = [i for i, b in enumerate(bones) if b.parent is None]
mesh_node = len(nodes)
nodes.append({"name": "CharacterMesh", "mesh": 0, "skin": 0})
for n in nodes:
    if not n.get("children"):
        n.pop("children", None)

# ── Animasyon klipleri ─────────────────────────────────────────────────
# Mixamo'dan inen FBX'ler .blend'e aksiyon olarak geliyor. Her aksiyonu
# kare kare pişirip glTF animasyonuna çeviriyoruz: oyunda AnimationMixer
# doğrudan oynatabilsin. (Blender 5'te action.fcurves kaldırıldı; aksiyon
# listesi doğrudan bpy.data.actions üzerinden alınıyor.)
animations = []
fps = bpy.context.scene.render.fps or 30
for act in bpy.data.actions:
    try:
        # Blender 5'in slotlu aksiyon sisteminde hazır animation_data'ya
        # yeni aksiyon atamak slotu yeniden bağlamıyor: armatür önceki
        # aksiyonun pozunda kalıyor, bütün klipler aynı pozu pişiriyordu.
        # Her klip için veriyi SIFIRDAN kurunca slot otomatik bağlanıyor.
        if armature.animation_data:
            armature.animation_data_clear()
        ad = armature.animation_data_create()
        ad.action = act
        # Blender 5: aksiyonu atamak yetmiyor, SLOTU da bağlanmalı. Yoksa
        # aksiyon hiç uygulanmıyor ve bütün klipler aynı duruşu pişiriyor.
        if getattr(act, "slots", None):
            ad.action_slot = act.slots[0]
    except Exception as exc:
        print(f"AKSIYON_HATASI\t{act.name}\t{exc}")
        continue
    bas, bit = (int(act.frame_range[0]), int(act.frame_range[1]))
    if bit <= bas:
        continue                      # tek kare: duruş, animasyon değil

    zaman, kanal_t, kanal_r = [], {b.name: [] for b in bones}, {b.name: [] for b in bones}
    for f in range(bas, bit + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        # DİKKAT: arka planda orijinal datablock'un pose.bones[].matrix'i
        # kareyle güncellenmiyor — bütün klipler tek pozu pişiriyordu.
        # Poz her karede DEĞERLENDİRİLMİŞ (depsgraph) nesneden okunur.
        dg = bpy.context.evaluated_depsgraph_get()
        arm_eval = armature.evaluated_get(dg)
        dunya = {}
        for b in bones:
            pb = arm_eval.pose.bones.get(b.name)
            m = arm_eval.matrix_world @ (pb.matrix if pb else b.matrix_local)
            dunya[b.name] = CONV @ m @ CONV_INV
        for b in bones:
            w = dunya[b.name]
            yerel = w if b.parent is None else dunya[b.parent.name].inverted() @ w
            t, r, _s = yerel.decompose()
            kanal_t[b.name].append((t.x, t.y, t.z))
            kanal_r[b.name].append((r.x, r.y, r.z, r.w))
        zaman.append((f - bas) / fps)

    # Kök kemiğin YATAY kayması temizlenir: karakteri oyun kodu hareket
    # ettiriyor, klip de ilerlerse asker kayarak uzaklaşıyor. Dikey
    # salınım (adım zıplaması, çömelme) korunur.
    for b in bones:
        if b.parent is not None:
            continue
        iz = kanal_t[b.name]
        if not iz:
            continue
        x0, z0 = iz[0][0], iz[0][2]
        kanal_t[b.name] = [(x0, t[1], z0) for t in iz]

    acc_time = add_accessor(add_view(b"".join(struct.pack("<f", t) for t in zaman)),
                            5126, len(zaman), "SCALAR", ([min(zaman)], [max(zaman)]))
    samplers, channels = [], []
    for i, b in enumerate(bones):
        acc_r = add_accessor(add_view(b"".join(struct.pack("<4f", *q) for q in kanal_r[b.name])),
                             5126, len(zaman), "VEC4")
        samplers.append({"input": acc_time, "output": acc_r, "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": i, "path": "rotation"}})
        if b.parent is None:        # kök kemik yer değiştirir
            acc_tr = add_accessor(add_view(b"".join(struct.pack("<3f", *v) for v in kanal_t[b.name])),
                                  5126, len(zaman), "VEC3")
            samplers.append({"input": acc_time, "output": acc_tr, "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1, "target": {"node": i, "path": "translation"}})
    animations.append({"name": act.name, "samplers": samplers, "channels": channels})
    kalca = next((n for n, b in enumerate(bones) if b.name.endswith("Hips")), 0)
    ilk = kanal_t[bones[kalca].name][0]
    print(f"ANIMASYON\t{act.name}\tkare={bas}-{bit}\tsure={zaman[-1]:.2f}s"
          f"\tilk_kalca=({ilk[0]:.2f},{ilk[1]:.2f},{ilk[2]:.2f})")

bpy.context.scene.frame_set(bas if animations else 1)

gltf = {
    "asset": {"version": "2.0", "generator": "celik-hat mixamo char exporter"},
    "scene": 0,
    "scenes": [{"nodes": roots + [mesh_node]}],
    "nodes": nodes,
    "meshes": [{"name": "Character", "primitives": primitives}],
    "materials": materials,
    "skins": [{"inverseBindMatrices": acc_ibm, "joints": list(range(len(bones))),
               "skeleton": roots[0]}],
    "accessors": accessors,
    "bufferViews": views,
    "buffers": [{"byteLength": offset}],
}
if animations:
    gltf["animations"] = animations
if images:
    gltf["images"] = images
    gltf["textures"] = textures
    gltf["samplers"] = samplers

bin_blob = b"".join(bin_parts)
json_blob = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
json_blob += b" " * ((-len(json_blob)) % 4)

glb = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(json_blob) + 8 + len(bin_blob))
glb += struct.pack("<II", len(json_blob), 0x4E4F534A) + json_blob
glb += struct.pack("<II", len(bin_blob), 0x004E4942) + bin_blob
with open(OUT, "wb") as f:
    f.write(glb)

print(f"EXPORT_OK\t{OUT}\tucgen={sum(len(v) for v in prims.values()) // 3}"
      f"\tkose={len(positions)}\tmalzeme={len(materials)}\tdoku={len(images)}"
      f"\tboy={yukseklik:.2f}m\tanimasyon={len(animations)}\tboyut={len(glb) // 1024}KB")
