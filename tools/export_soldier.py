"""Asker modelini web için optimize edip GLB olarak dışa aktarır.

Kaynak model oyun için fazla ağır: 318 bin üçgen, 114 ayrı parça ve 47 MB
doku. Sahada aynı anda on kadar asker olacağı için şunları yapıyoruz:

  1. Kamera/ışık/empty temizlenir.
  2. Tüm parçalar TEK mesh'e birleştirilir (çizim çağrısı patlamasın).
  3. 23 malzeme, 5 sade PBR malzemeye indirgenir (doku yok — üniforma,
     ten, teçhizat, gözlük camı, göz). Oyun mesafesinde fark edilmez,
     dosya 60 MB'tan birkaç yüz KB'a iner.
  4. Decimate ile üçgen sayısı hedefe düşürülür (iskelet ağırlıkları korunur).
  5. İskelet (Soldier_Rig) ve deri bağlama korunarak GLB yazılır — animasyonlar
     oyunda kemiklerden üretiliyor.

Kullanım:
  blender --background Asker.blend --python export_soldier.py -- cikis.glb [hedef_ucgen]
"""
import bpy
import sys

argv = sys.argv
argv = argv[argv.index("--") + 1:] if "--" in argv else []
out_path = argv[0]
target_tris = int(argv[1]) if len(argv) > 1 else 24000

# Malzeme adından sade role eşleme
ROLE_COLORS = {
    "uniform": (0.21, 0.24, 0.16, 1.0),   # kamuflaj yeşili
    "gear":    (0.09, 0.10, 0.10, 1.0),   # teçhizat / siyah polimer
    "skin":    (0.62, 0.45, 0.35, 1.0),
    "lens":    (0.05, 0.06, 0.07, 1.0),
    "eye":     (0.90, 0.90, 0.88, 1.0),
}
ROLE_SPEC = {           # (roughness, metallic)
    "uniform": (0.92, 0.0),
    "gear":    (0.55, 0.35),
    "skin":    (0.75, 0.0),
    "lens":    (0.18, 0.6),
    "eye":     (0.3, 0.0),
}


def role_of(name):
    n = name.lower()
    if "eye" in n and "lens" not in n:
        return "eye"
    if "lens" in n:
        return "lens"
    if "skin" in n:
        return "skin"
    if any(k in n for k in ("camo", "uniform", "nylon_olive", "olive")):
        return "uniform"
    return "gear"


def make_role_materials():
    mats = {}
    for role, color in ROLE_COLORS.items():
        m = bpy.data.materials.new(f"SOLDIER_{role.upper()}")
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        rough, metal = ROLE_SPEC[role]
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        mats[role] = m
    return mats


# ── 0. Her şeyi görünür ve seçilebilir yap ──────────────────────────────
# Kaynak dosyada parçalar kapalı/dışlanmış koleksiyonlarda olabiliyor;
# o hâlde bpy.ops ile seçilemezler.
def unhide(layer_collection):
    layer_collection.exclude = False
    layer_collection.hide_viewport = False
    for child in layer_collection.children:
        unhide(child)


unhide(bpy.context.view_layer.layer_collection)

scene_col = bpy.context.scene.collection
for ob in bpy.data.objects:
    if not ob.users_collection:
        scene_col.objects.link(ob)
    ob.hide_viewport = False
    ob.hide_render = False
    try:
        ob.hide_set(False)
    except RuntimeError:
        pass          # görünür katmanda değilse sorun değil

# ── 1. Temizlik ─────────────────────────────────────────────────────────
for ob in list(bpy.data.objects):
    if ob.type in {"CAMERA", "LIGHT", "EMPTY"}:
        bpy.data.objects.remove(ob, do_unlink=True)

armature = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if not meshes:
    print("HATA: mesh yok")
    sys.exit(1)
print(f"BASLANGIC\tmesh={len(meshes)}\tmalzeme={len(bpy.data.materials)}")

# ── 2. Tek mesh'e birleştir ─────────────────────────────────────────────
bpy.ops.object.select_all(action="DESELECT")
for ob in meshes:
    ob.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = "Soldier"
body.data.name = "SoldierMesh"

# Birleşim, ilk parçanın modifier yığınını devralıyor (Subsurf/Solidify gibi).
# Bunlar artık tüm gövdeye uygulanacağı için hem yanlış hem de dışa aktarıcının
# deri bağlamayı atlamasına yol açıyor: hepsini kaldırıyoruz.
for mod in list(body.modifiers):
    body.modifiers.remove(mod)

# Geometriyi temizle: birleşmiş 104 parçada çakışan köşeler, bozuk normaller
# ve özel split-normal verisi var; dışa aktarıcı bunlara takılıyor.
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=0.0004)
bpy.ops.mesh.delete_loose()
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode="OBJECT")
try:
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
except RuntimeError:
    pass
body.data.validate(verbose=False)
print(f"TEMIZLIK\tkose={len(body.data.vertices)}")

# ── 3. Malzemeleri 5 role indir ─────────────────────────────────────────
# Slotları tek tek değiştirmek yetmiyor: 23 slot kalırsa glTF 23 ayrı
# parça (draw call) yazar. Her yüzeyin slot indeksini yeniden eşleyip
# fazla slotları siliyoruz.
roles = make_role_materials()
role_names = list(roles.keys())
old_role = [role_of(sl.material.name) if sl.material else "gear" for sl in body.material_slots]

body.data.materials.clear()
for name in role_names:
    body.data.materials.append(roles[name])

for poly in body.data.polygons:
    src = old_role[poly.material_index] if poly.material_index < len(old_role) else "gear"
    poly.material_index = role_names.index(src)

# ── 3b. Dokusuz model: UV ve renk katmanları gereksiz yer kaplıyor ──────
for layer in list(body.data.uv_layers):
    body.data.uv_layers.remove(layer)
for layer in list(body.data.color_attributes):
    body.data.color_attributes.remove(layer)

# ── 4. Üçgen sayısını düşür ─────────────────────────────────────────────
tris = sum(max(len(p.vertices) - 2, 0) for p in body.data.polygons)
if tris > target_tris:
    mod = body.modifiers.new("WebDecimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = target_tris / tris
    mod.use_collapse_triangulate = True
    # Dışa aktarıcı deri bağlı mesh'lerde modifier uygulamayı atlayabiliyor;
    # burada kendimiz uyguluyoruz (armature modifier'a dokunulmaz).
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=mod.name)
    son = sum(max(len(p.vertices) - 2, 0) for p in body.data.polygons)
    print(f"DECIMATE\t{tris} -> {son}")

# ── 4c. Kemik bölgelerine ayır ──────────────────────────────────────────
# glTF dışa aktarıcısı bu modelde deri bağlamayı (skin) ısrarla atlıyor.
# Çözüm: otomatik ağırlıklardan yararlanıp gövdeyi 15 parçaya bölüyoruz ve
# her parçayı kendi kemiğine bağlıyoruz. Oyun tarafında kemiği döndürmek
# parçayı da döndürür — animasyon aynı, dışa aktarım sorunsuz.
SEGMENTS = [
    ("Head",          ["Head", "Neck"]),
    ("Spine2",        ["Spine2", "LeftShoulder", "RightShoulder"]),
    ("Spine1",        ["Spine1", "Spine"]),
    ("Hips",          ["Hips"]),
    ("LeftArm",       ["LeftArm"]),
    ("LeftForeArm",   ["LeftForeArm"]),
    ("LeftHand",      ["LeftHand"] + [f"LeftHand{f}{i}" for f in ("Thumb", "Index", "Middle", "Ring", "Pinky") for i in (1, 2, 3)]),
    ("RightArm",      ["RightArm"]),
    ("RightForeArm",  ["RightForeArm"]),
    ("RightHand",     ["RightHand"] + [f"RightHand{f}{i}" for f in ("Thumb", "Index", "Middle", "Ring", "Pinky") for i in (1, 2, 3)]),
    ("LeftUpLeg",     ["LeftUpLeg"]),
    ("LeftLeg",       ["LeftLeg"]),
    ("LeftFoot",      ["LeftFoot", "LeftToeBase"]),
    ("RightUpLeg",    ["RightUpLeg"]),
    ("RightLeg",      ["RightLeg"]),
    ("RightFoot",     ["RightFoot", "RightToeBase"]),
]

import bmesh

# Her köşeyi EN YAKIN KEMİĞE ata. Otomatik ağırlıklandırma bu modelde boş
# gruplar üretiyor (Bone Heat çözüm bulamıyor), bu yüzden ağırlığa hiç
# güvenmiyoruz: köşe ile kemik ekseni (baş→kuyruk) arasındaki mesafe yeter.
seg_of_bone = {}
for seg_name, bones_in_seg in SEGMENTS:
    for bn in bones_in_seg:
        seg_of_bone[bn] = seg_name

seg_names = [name for name, _ in SEGMENTS]
seg_index = {name: i for i, name in enumerate(seg_names)}

# Kemik eksenleri (armature yerel uzayında)
segments_geo = []
for bone in armature.data.bones:
    seg = seg_of_bone.get(bone.name)
    if seg is None:
        continue
    segments_geo.append((seg_index[seg], bone.head_local.copy(), bone.tail_local.copy()))


def nearest_seg(co):
    best_i, best_d = seg_index["Hips"], 1e9
    for idx, h, t in segments_geo:
        ab = t - h
        denom = ab.length_squared or 1e-9
        u = max(0.0, min(1.0, (co - h).dot(ab) / denom))
        d = (co - (h + ab * u)).length_squared
        if d < best_d:
            best_d, best_i = d, idx
    return best_i


mw = armature.matrix_world.inverted() @ body.matrix_world
vert_seg = [nearest_seg(mw @ v.co) for v in body.data.vertices]

# Bölgeyi yüzeye KALICI bir öznitelik olarak yaz: ayırma sırasında
# indeksler kaysa bile etiket yüzeyle birlikte taşınır.
attr = body.data.attributes.new(name="seg", type="INT", domain="FACE")
for i, poly in enumerate(body.data.polygons):
    counts = {}
    for vi in poly.vertices:
        sidx = vert_seg[vi]
        counts[sidx] = counts.get(sidx, 0) + 1
    attr.data[i].value = max(counts, key=counts.get)

# Bölge bölge ayır
parts = []
for name in seg_names:
    idx = seg_index[name]
    before = {o.name for o in bpy.data.objects if o.type == "MESH"}

    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode="EDIT")

    bm = bmesh.from_edit_mesh(body.data)
    layer = bm.faces.layers.int.get("seg")
    bm.faces.ensure_lookup_table()
    secili = 0
    for f in bm.faces:
        hit = layer is not None and f[layer] == idx
        f.select_set(hit)
        secili += 1 if hit else 0
    bmesh.update_edit_mesh(body.data)

    if secili:
        bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")

    after = {o.name for o in bpy.data.objects if o.type == "MESH"}
    for new_name in after - before:
        part = bpy.data.objects[new_name]
        part.name = f"SEG_{name}"
        parts.append((part, name))

print(f"PARCA\t{len(parts)}\t{[n for _, n in parts]}")

# Parçaları kemiklere bağla (dünya konumu korunur)
for part, seg_name in parts:
    for mod in list(part.modifiers):
        part.modifiers.remove(mod)
    mw = part.matrix_world.copy()
    part.parent = armature
    part.parent_type = "BONE"
    part.parent_bone = seg_name
    part.matrix_world = mw

# Artakalan gövde: ya kalçaya bağla ya da sil
if len(body.data.polygons):
    for mod in list(body.modifiers):
        body.modifiers.remove(mod)
    mw = body.matrix_world.copy()
    body.parent = armature
    body.parent_type = "BONE"
    body.parent_bone = "Hips"
    body.matrix_world = mw
    print(f"ARTAKALAN\t{len(body.data.polygons)} yüzey kalçaya bağlandı")
else:
    bpy.data.objects.remove(body, do_unlink=True)

# ── 5. Dışa aktar ───────────────────────────────────────────────────────
kwargs = dict(
    filepath=out_path,
    export_format="GLB",
    export_apply=False,         # decimate'i yukarıda kendimiz uyguladık;
                                # burada açık kalırsa deri bağlama (skin) düşüyor
    export_yup=True,
    export_materials="EXPORT",
    export_skins=True,
    export_cameras=False,
    export_lights=False,
    export_image_format="NONE",  # doku yok
    use_selection=False,
)
try:
    bpy.ops.export_scene.gltf(**kwargs)
except TypeError as exc:
    print("EXPORT TypeError:", exc)
    props = bpy.types.EXPORT_SCENE_OT_gltf.bl_rna.properties.keys()
    kwargs = {k: v for k, v in kwargs.items() if k in props}
    bpy.ops.export_scene.gltf(**kwargs)

print(f"EXPORT_OK\t{out_path}\tkemik={len(armature.data.bones) if armature else 0}")
