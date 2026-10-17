"""Askeri TAM KALİTEDE, dokularıyla birlikte ve deri bağlamalı GLB olarak yazar.

Önceki sürüm boyutu küçültmek için modeli 19 bin üçgene indirip dokuları
atıyordu; sonuç kullanıcının beğenmediği sade bir görünümdü. Bu sürüm kaliteyi
önceler:

  • Üçgen sayısı korunur (gerekirse üst sınır verilebilir)
  • Orijinal 23 malzeme ve PBR dokuları (temel renk / normal / pürüzlülük)
    korunur, dokular GLB'nin yanına yazılır ve göreli yolla bağlanır
  • UV'ler yazıldığı için köşeler UV kırılmalarına göre çoğaltılır
  • Deri bağlama ağırlıkları en yakın kemiklerden hesaplanır (model rig'li
    olmadığı için) — yürüme/çömelme/koşma animasyonu çalışmaya devam eder

Kullanım:
  blender --background Asker.blend --python export_soldier_hq.py -- cikis.glb [maks_ucgen] [doku_boyutu]
"""
import bpy
import bmesh
import json
import os
import struct
import sys
from mathutils import Matrix

argv = sys.argv
argv = argv[argv.index("--") + 1:] if "--" in argv else []
OUT = argv[0]
MAX_TRIS = int(argv[1]) if len(argv) > 1 else 0          # 0 = sınırsız
TEX_SIZE = int(argv[2]) if len(argv) > 2 else 2048

TEX_DIR = os.path.join(os.path.dirname(OUT), "tex")
os.makedirs(TEX_DIR, exist_ok=True)

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
    if ob.type in {"CAMERA", "LIGHT", "EMPTY"}:
        bpy.data.objects.remove(ob, do_unlink=True)

armature = next(o for o in bpy.data.objects if o.type == "ARMATURE")
# Sanatçının render dışı bıraktığı yardımcı nesneler (ör. WeightProxy: tam
# bir çıplak gövde kopyası) dışarıda kalır — yoksa kıyafetin içinden taşıyor.
meshes = [o for o in bpy.data.objects if o.type == "MESH" and not o.hide_render]
atlanan = [o.name for o in bpy.data.objects if o.type == "MESH" and o.hide_render]
if atlanan:
    print(f"ATLANAN\t{atlanan}")
print(f"BASLANGIC\tmesh={len(meshes)}\tmalzeme={len(bpy.data.materials)}")

# Birleştirmeden ÖNCE her parçanın modifier'larını uygula. Özellikle MASK
# önemli: gövde mesh'inde kıyafet altında kalan çıplak bölgeleri gizliyor.
# Birleştirme yalnızca aktif nesnenin yığınını devraldığı için bunlar
# kayboluyor ve asker "kıyafetsiz" görünüyordu.
# SUBSURF/MULTIRES uygulanmaz: üçgen sayısını katlar, görsel katkısı az.
uygulanan = 0
for o in meshes:
    bpy.context.view_layer.objects.active = o
    for mod in list(o.modifiers):
        if mod.type in {"SUBSURF", "MULTIRES", "ARMATURE"}:
            o.modifiers.remove(mod)
            continue
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
            uygulanan += 1
        except RuntimeError:
            o.modifiers.remove(mod)
print(f"MODIFIER\tuygulanan={uygulanan}")

bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = "Soldier"

for mod in list(body.modifiers):
    body.modifiers.remove(mod)

# İsteğe bağlı üst sınır (kalite öncelikli: varsayılan kapalı)
tris_now = sum(max(len(p.vertices) - 2, 0) for p in body.data.polygons)
if MAX_TRIS and tris_now > MAX_TRIS:
    mod = body.modifiers.new("Dec", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = MAX_TRIS / tris_now
    bpy.ops.object.modifier_apply(modifier=mod.name)

bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode="EDIT")
bm = bmesh.from_edit_mesh(body.data)
bmesh.ops.triangulate(bm, faces=bm.faces)
bmesh.update_edit_mesh(body.data)
bpy.ops.object.mode_set(mode="OBJECT")

# ── Giysi altında kalan teni sil ───────────────────────────────────────
# Modelde üç ayrı çıplak gövde var ve MASK modifier'ı hiçbir köşeyi
# kaldırmıyor. Üniformanın altındaki ten, deri bağlama sırasında kumaştan
# birkaç milimetre dışarı taşıp "kıyafetsiz lekeler" oluşturuyordu.
# Burada: her ten yüzünün köşeleri giysi yüzeyine 1.2 cm'den yakınsa ya da
# giysinin İÇİNDE kalıyorsa o yüz silinir. Yüz, boyun ve eller kumaştan
# uzak olduğu için korunur.
from mathutils.bvhtree import BVHTree

SKIN_MATS = {"SKIN", "M_SKIN"}
skin_idx = {i for i, m in enumerate(body.data.materials)
            if m and m.name.upper() in SKIN_MATS}
if skin_idx:
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    co = [v.co.copy() for v in bm.verts]
    cloth = [[v.index for v in f.verts] for f in bm.faces
             if f.material_index not in skin_idx]
    bvh = BVHTree.FromPolygons(co, cloth, all_triangles=False)

    kaldir = []
    for f in bm.faces:
        if f.material_index not in skin_idx:
            continue
        gomulu = 0
        for v in f.verts:
            loc, nor, _i, d = bvh.find_nearest(v.co)
            if loc is not None and (d < 0.012 or (v.co - loc).dot(nor) < 0.0):
                gomulu += 1
        if gomulu == len(f.verts):
            kaldir.append(f)
    print(f"TEN_TEMIZLIGI\tsilinen_yuz={len(kaldir)}")
    bmesh.ops.delete(bm, geom=kaldir, context="FACES")
    bm.to_mesh(body.data)
    bm.free()

mesh = body.data
mesh.calc_loop_triangles()
uv_layer = mesh.uv_layers.active
print(f"MESH\tkose={len(mesh.vertices)}\tucgen={len(mesh.loop_triangles)}\tuv={bool(uv_layer)}")


# ── Dokular ─────────────────────────────────────────────────────────────
def save_image(img, suffix):
    """Dokuyu GLB'nin yanına yazar, göreli yolu döndürür.

    Mümkünse diskteki ORİJİNAL dosya olduğu gibi kopyalanır: Blender'dan
    yeniden kodlamak renk yönetimi yüzünden dokuları uçuk gösterebiliyor."""
    if img is None:
        return None
    name = f"{img.name.replace('.', '_')}_{suffix}.png"
    path = os.path.join(TEX_DIR, name)

    src = bpy.path.abspath(img.filepath_from_user()) if img.filepath_raw or img.filepath else ""
    if src and os.path.exists(src) and not os.path.exists(path):
        import shutil
        shutil.copyfile(src, path)
        print(f"DOKU_KOPYA\t{name}")
        return f"tex/{name}"

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


# Prosedürel malzemeler (CAMO_EMR gibi) node ağacıyla üretilmiş; glTF'e
# aktarılamıyor ve açık gri kalıyorlar. Modelde hazır PBR doku setleri var
# (M_Uniform, M_Vest, M_Skin, M_Gear, M_Eyes) — prosedürel olanları bunlara
# eşliyoruz. Eşleşmeyenlere ad bazlı makul düz renk veriyoruz.
TEX_ALIAS = {
    "camo_emr": "M_Uniform",
    "camo_nylon": "M_Uniform",
    "skin": "M_Skin",
    "eye_l": "M_Eyes",
    "eye_r": "M_Eyes",
    "leather_black": None,
}
FALLBACK = [
    (("leather", "rubber", "lace", "polymer_black"), (0.015, 0.015, 0.015)),
    (("metal",), (0.05, 0.05, 0.045)),
    (("webbing", "strap", "nylon", "olive", "knee"), (0.055, 0.062, 0.035)),
    (("camo",), (0.07, 0.085, 0.045)),
    (("skin",), (0.26, 0.145, 0.10)),
    (("eye",), (0.72, 0.70, 0.66)),
    (("lens",), (0.012, 0.016, 0.02)),
]


def fallback_color(name):
    n = (name or "").lower()
    for keys, color in FALLBACK:
        if any(k in n for k in keys):
            return (*color, 1.0)
    return (0.1, 0.1, 0.09, 1.0)


def material_info(mat, alias_source=None):
    """Principled BSDF'ten temel renk / doku bilgilerini çıkarır."""
    info = {"color": (0.8, 0.8, 0.8, 1.0), "rough": 0.8, "metal": 0.0,
            "base_tex": None, "normal_tex": None, "rough_tex": None}
    if not mat or not mat.use_nodes:
        return info

    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        return info

    # Dokuları doğrudan malzemenin node ağacındaki resimlerden al; node
    # zincirini yürümek gruplarda ve karıştırıcılarda kayboluyordu.
    def images_of(material):
        found = {}
        for node in material.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image:
                n = node.image.name.lower()
                if "basecolor" in n or "albedo" in n or "diffuse" in n:
                    found["base"] = node.image
                elif "normal" in n:
                    found["normal"] = node.image
                elif "rough" in n:
                    found["rough"] = node.image
        return found

    imgs = images_of(mat)
    if not imgs and alias_source:
        imgs = images_of(alias_source)

    if imgs:
        info["base_tex"] = save_image(imgs.get("base"), "base")
        info["normal_tex"] = save_image(imgs.get("normal"), "nrm")
        info["rough_tex"] = save_image(imgs.get("rough"), "rough")
        info["color"] = (1.0, 1.0, 1.0, 1.0)
        info["rough"] = 1.0
        info["metal"] = 0.0
        return info

    # Doku yok: bağlı (prosedürel) temel renk yerine ada göre makul renk
    c = bsdf.inputs["Base Color"]
    info["color"] = tuple(c.default_value) if not c.is_linked else fallback_color(mat.name)
    r = bsdf.inputs["Roughness"]
    info["rough"] = float(r.default_value) if not r.is_linked else 0.85
    m = bsdf.inputs["Metallic"]
    info["metal"] = float(m.default_value) if not m.is_linked else 0.0
    return info

    def linked_image(socket):
        if not socket.is_linked:
            return None
        node = socket.links[0].from_node
        seen = 0
        while node and node.type != "TEX_IMAGE" and seen < 6:
            seen += 1
            ins = [i for i in node.inputs if i.is_linked]
            node = ins[0].links[0].from_node if ins else None
        return node.image if node and node.type == "TEX_IMAGE" else None




slots = []
for sl in body.material_slots:
    mat = sl.material
    alias_name = TEX_ALIAS.get((mat.name if mat else "").lower(), "") if mat else ""
    alias = bpy.data.materials.get(alias_name) if alias_name else None
    slots.append(material_info(mat, alias))
print(f"MALZEME\t{len(slots)}")

# ── Kemikler ve ağırlıklar ──────────────────────────────────────────────
bones = list(armature.data.bones)
bone_pos = {b.name: i for i, b in enumerate(bones)}
mesh_to_arm = armature.matrix_world.inverted() @ body.matrix_world

# DEFORMASYON KEMİKLERİ: parmak ve ayak-parmağı kemikleri ağırlık ALMAZ.
# A-pozunda eller kalçanın yanında duruyor; parmak kemikleri ceket ve pantolon
# köşelerine en yakın kemik çıkıyor, kol oynayınca kumaş yırtılıyordu.
FINGER = ("Thumb", "Index", "Middle", "Ring", "Pinky", "Toe")


def deform_index(i):
    """Parmak kemiğiyse ağırlığı en yakın üst kemiğe (el/ayak) devret."""
    b = bones[i]
    while b is not None and any(k in b.name for k in FINGER):
        b = b.parent
    return bone_pos.get(b.name, i) if b else i


allowed = [i for i, b in enumerate(bones) if not any(k in b.name for k in FINGER)]
segs = [(bones[i].head_local.copy(), bones[i].tail_local.copy()) for i in allowed]
print(f"KEMIK\ttoplam={len(bones)}\tdeform={len(allowed)}")


# Ağırlık atama iki aşamalı:
#   1) Her köşe en yakın 4 kemiğe 1/mesafe² ile bağlanır (eski 1/mesafe⁴
#      neredeyse tek kemiğe yapıştırıyordu: bel iki omur arasında şeker
#      ambalajı gibi büzülüyor, omuz sınırında üçgenler sivri sivri
#      dışarı fırlıyordu).
#   2) Ağırlıklar komşu köşelerle YUMUŞATILIR (Laplace). Kemik sınırları
#      bu sayede keskin çizgi olmaktan çıkıp birkaç santime yayılıyor —
#      dönen omuz artık göğüs kumaşını yırtmıyor.
INFLUENCES = 4
SMOOTH_PASSES = 3
SMOOTH_MIX = 0.55          # komşulardan gelen pay


def nearest_bones(co):
    best = []
    for k, (h, t) in enumerate(segs):
        ab = t - h
        denom = ab.length_squared or 1e-9
        u = max(0.0, min(1.0, (co - h).dot(ab) / denom))
        d = (co - (h + ab * u)).length
        best.append((d, allowed[k]))
    best.sort()
    top = best[:INFLUENCES]

    d0 = max(top[0][0], 0.01)
    out = {}
    for d, bi in top:
        rel = max(d, 0.01) / d0
        w = 1.0 / (rel * rel)
        if w > 0.02:
            out[bi] = out.get(bi, 0.0) + w
    tot = sum(out.values()) or 1.0
    return {k: v / tot for k, v in out.items()}


print("AGIRLIK\tilk atama...")
raw = [nearest_bones(mesh_to_arm @ v.co) for v in mesh.vertices]

# Komşuluk haritası (kenarlardan)
neigh = [[] for _ in range(len(mesh.vertices))]
for e in mesh.edges:
    a, b = e.vertices
    neigh[a].append(b)
    neigh[b].append(a)

for step in range(SMOOTH_PASSES):
    print(f"AGIRLIK\tyumusatma {step + 1}/{SMOOTH_PASSES}")
    nxt = []
    keep = 1.0 - SMOOTH_MIX
    for i, w in enumerate(raw):
        acc = {k: v * keep for k, v in w.items()}
        ns = neigh[i]
        if ns:
            f = SMOOTH_MIX / len(ns)
            for j in ns:
                for k, v in raw[j].items():
                    acc[k] = acc.get(k, 0.0) + v * f
        nxt.append(acc)
    raw = nxt


def pack(w):
    top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
    top = [(k, v) for k, v in top if v > 0.015]
    if not top:
        top = [(0, 1.0)]
    tot = sum(v for _, v in top) or 1.0
    idx = [k for k, _ in top]
    ws = [v / tot for _, v in top]
    return (idx + [0] * (4 - len(idx)), ws + [0.0] * (4 - len(ws)))


vert_skin = [pack(w) for w in raw]

# ── Köşe tamponu: UV kırılmalarında köşe çoğaltılır ─────────────────────
positions, normals, uvs, joints, weights = [], [], [], [], []
index_of = {}
prims = {}

for tri in mesh.loop_triangles:
    mat_i = tri.material_index
    prims.setdefault(mat_i, [])
    for k in range(3):
        vi = tri.vertices[k]
        li = tri.loops[k]
        uv = tuple(uv_layer.data[li].uv) if uv_layer else (0.0, 0.0)
        no = tuple(mesh.loops[li].normal) if tri.use_smooth else tuple(tri.normal)
        key = (vi, round(uv[0], 5), round(uv[1], 5), round(no[0], 3), round(no[1], 3), round(no[2], 3))

        idx = index_of.get(key)
        if idx is None:
            idx = len(positions)
            index_of[key] = idx
            co = CONV @ (mesh_to_arm @ mesh.vertices[vi].co)
            nn = (CONV.to_3x3() @ (mesh_to_arm.to_3x3() @ __import__("mathutils").Vector(no))).normalized()
            positions.append((co.x, co.y, co.z))
            normals.append((nn.x, nn.y, nn.z))
            uvs.append((uv[0], 1.0 - uv[1]))      # glTF'te V ters
            j, w = vert_skin[vi]
            joints.append(j)
            weights.append(w)
        prims[mat_i].append(idx)

print(f"KOSE\t{len(positions)}\tprimitive={len(prims)}")

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


pos_b = b"".join(struct.pack("<3f", *p) for p in positions)
mins = [min(p[i] for p in positions) for i in range(3)]
maxs = [max(p[i] for p in positions) for i in range(3)]
acc_pos = add_accessor(add_view(pos_b, 34962), 5126, len(positions), "VEC3", (mins, maxs))
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
    info = slots[mat_i] if mat_i < len(slots) else slots[0]
    acc_idx = add_accessor(
        add_view(b"".join(struct.pack("<I", i) for i in idx_list), 34963),
        5125, len(idx_list), "SCALAR")

    pbr = {
        "baseColorFactor": list(info["color"][:3]) + [1.0],
        "roughnessFactor": info["rough"],
        "metallicFactor": info["metal"],
    }
    base = tex_ref(info["base_tex"])
    if base:
        pbr["baseColorTexture"] = base
        pbr["baseColorFactor"] = [1, 1, 1, 1]
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
    ibm += struct.pack("<16f", *[(CONV @ b.matrix_local @ CONV_INV).inverted()[r][c]
                                 for c in range(4) for r in range(4)])
acc_ibm = add_accessor(add_view(ibm), 5126, len(bones), "MAT4")

nodes = []
bone_index = {b.name: i for i, b in enumerate(bones)}
for b in bones:
    local = b.matrix_local if b.parent is None else b.parent.matrix_local.inverted() @ b.matrix_local
    t, r, s = (CONV @ local @ CONV_INV).decompose()
    nodes.append({"name": b.name, "translation": [t.x, t.y, t.z],
                  "rotation": [r.x, r.y, r.z, r.w], "scale": [s.x, s.y, s.z], "children": []})
for i, b in enumerate(bones):
    if b.parent is not None:
        nodes[bone_index[b.parent.name]]["children"].append(i)

roots = [i for i, b in enumerate(bones) if b.parent is None]
mesh_node = len(nodes)
nodes.append({"name": "SoldierMesh", "mesh": 0, "skin": 0})
for n in nodes:
    if not n.get("children"):
        n.pop("children", None)

gltf = {
    "asset": {"version": "2.0", "generator": "celik-hat hq soldier exporter"},
    "scene": 0,
    "scenes": [{"nodes": roots + [mesh_node]}],
    "nodes": nodes,
    "meshes": [{"name": "Soldier", "primitives": primitives}],
    "materials": materials,
    "skins": [{"inverseBindMatrices": acc_ibm, "joints": list(range(len(bones))), "skeleton": roots[0]}],
    "accessors": accessors,
    "bufferViews": views,
    "buffers": [{"byteLength": offset}],
}
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
      f"\tboyut={len(glb) // 1024}KB")
