"""Askeri GERÇEK deri bağlamalı (skinned) tek parça GLB olarak yazar.

Neden elle yazıyoruz: Blender'ın glTF dışa aktarıcısı bu modelde skin bloğunu
ısrarla atlıyor ("Soldier has no skin"). Parçalara bölüp kemiğe asmak ise
eklem yerlerinde boşluk/kopuk parça gösteriyor. Burada mesh'i Blender'da
hazırlayıp ağırlıkları kendimiz hesaplıyor ve GLB dosyasını doğrudan
üretiyoruz: tek mesh, yumuşak eklem geçişi, kopuk parça yok.

Kullanım:
  blender --background Asker.blend --python export_soldier_skinned.py -- cikis.glb [hedef_ucgen]
"""
import bpy
import bmesh
import json
import struct
import sys
from mathutils import Matrix, Vector

argv = sys.argv
argv = argv[argv.index("--") + 1:] if "--" in argv else []
OUT = argv[0]
TARGET_TRIS = int(argv[1]) if len(argv) > 1 else 18000

# Blender (Z yukarı) → glTF (Y yukarı) eksen dönüşümü
CONV = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
CONV_INV = CONV.inverted()

# Renkler DOĞRUSAL (linear) uzayda; ekranda sRGB'ye çevrildiği için
# gündüz ışığında doğru koyulukta görünsün diye düşük tutuluyorlar.
ROLES = {                      # ad kalıbı → (renk, pürüzlülük, metaliklik)
    "eye":     ((0.72, 0.70, 0.66), 0.35, 0.0),
    "lens":    ((0.012, 0.016, 0.02), 0.14, 0.7),
    "skin":    ((0.26, 0.145, 0.10), 0.80, 0.0),
    "uniform": ((0.052, 0.068, 0.038), 0.95, 0.0),
    "gear":    ((0.018, 0.020, 0.020), 0.55, 0.35),
}
ROLE_ORDER = ["uniform", "gear", "skin", "lens", "eye"]


def role_of(name):
    n = (name or "").lower()
    if "lens" in n:
        return "lens"
    if "eye" in n:
        return "eye"
    if "skin" in n:
        return "skin"
    if any(k in n for k in ("camo", "uniform", "nylon_olive", "olive")):
        return "uniform"
    return "gear"


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
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print(f"BASLANGIC\tmesh={len(meshes)}")

# Rol bilgisini kaybetmemek için her mesh'in malzeme rolünü not et
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = "Soldier"

for mod in list(body.modifiers):
    body.modifiers.remove(mod)

# Malzeme yuvalarını 5 role indir (yüz indeksleri korunur)
old_roles = [role_of(sl.material.name if sl.material else "") for sl in body.material_slots]
face_role = [old_roles[p.material_index] if p.material_index < len(old_roles) else "gear"
             for p in body.data.polygons]

# Temizlik + üçgenleştirme + sadeleştirme
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=0.0005)
bpy.ops.mesh.delete_loose()
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode="OBJECT")

# Rolü yüzeye kalıcı öznitelik olarak yaz (decimate sonrası da taşınsın)
attr = body.data.attributes.new(name="role", type="INT", domain="FACE")
for i, p in enumerate(body.data.polygons):
    attr.data[i].value = ROLE_ORDER.index(face_role[i]) if i < len(face_role) else 1

tris = sum(max(len(p.vertices) - 2, 0) for p in body.data.polygons)
if tris > TARGET_TRIS:
    mod = body.modifiers.new("Dec", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = TARGET_TRIS / tris
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)

bpy.ops.object.mode_set(mode="EDIT")
bm = bmesh.from_edit_mesh(body.data)
bmesh.ops.triangulate(bm, faces=bm.faces)
bmesh.update_edit_mesh(body.data)
bpy.ops.object.mode_set(mode="OBJECT")

mesh = body.data
mesh.calc_loop_triangles()
print(f"MESH\tkose={len(mesh.vertices)}\tucgen={len(mesh.loop_triangles)}")

# ── Kemikler ────────────────────────────────────────────────────────────
bones = list(armature.data.bones)
bone_index = {b.name: i for i, b in enumerate(bones)}

arm_to_world = armature.matrix_world
mesh_to_arm = arm_to_world.inverted() @ body.matrix_world

# ── Ağırlıklar: en yakın 4 kemiğe mesafeyle ters orantılı ───────────────
segs = [(b.head_local.copy(), b.tail_local.copy()) for b in bones]


def bone_distance(co, head, tail):
    ab = tail - head
    denom = ab.length_squared or 1e-9
    u = max(0.0, min(1.0, (co - head).dot(ab) / denom))
    return (co - (head + ab * u)).length


joints, weights = [], []
for v in mesh.vertices:
    co = mesh_to_arm @ v.co
    d = [(bone_distance(co, h, t), i) for i, (h, t) in enumerate(segs)]
    d.sort()
    top = d[:4]
    # Ters kare ağırlık: eklemlerde yumuşak geçiş, uzak kemiklerde sıfıra yakın
    ws = [1.0 / max(dist, 0.004) ** 3 for dist, _ in top]
    total = sum(ws) or 1.0
    ws = [w / total for w in ws]
    joints.append([i for _, i in top] + [0] * (4 - len(top)))
    weights.append(ws + [0.0] * (4 - len(ws)))

# ── glTF veri tamponları ────────────────────────────────────────────────
positions, normals = [], []
for v in mesh.vertices:
    co = CONV @ (mesh_to_arm @ v.co)
    no = (CONV.to_3x3() @ (mesh_to_arm.to_3x3() @ v.normal)).normalized()
    positions.append((co.x, co.y, co.z))
    normals.append((no.x, no.y, no.z))

role_attr = mesh.attributes.get("role")
tri_by_role = {r: [] for r in ROLE_ORDER}
for tri in mesh.loop_triangles:
    idx = role_attr.data[tri.polygon_index].value if role_attr else 1
    role = ROLE_ORDER[idx] if 0 <= idx < len(ROLE_ORDER) else "gear"
    tri_by_role[role].append(tuple(tri.vertices))

bin_parts, views, accessors = [], [], []
offset = 0


def add_view(data_bytes, target=None):
    global offset
    pad = (-len(data_bytes)) % 4
    bin_parts.append(data_bytes + b"\x00" * pad)
    view = {"buffer": 0, "byteOffset": offset, "byteLength": len(data_bytes)}
    if target:
        view["target"] = target
    views.append(view)
    offset += len(data_bytes) + pad
    return len(views) - 1


def add_accessor(view, comp_type, count, type_, minmax=None):
    acc = {"bufferView": view, "componentType": comp_type, "count": count, "type": type_}
    if minmax:
        acc["min"], acc["max"] = minmax
    accessors.append(acc)
    return len(accessors) - 1


pos_bytes = b"".join(struct.pack("<3f", *p) for p in positions)
mins = [min(p[i] for p in positions) for i in range(3)]
maxs = [max(p[i] for p in positions) for i in range(3)]
acc_pos = add_accessor(add_view(pos_bytes, 34962), 5126, len(positions), "VEC3", (mins, maxs))

nrm_bytes = b"".join(struct.pack("<3f", *n) for n in normals)
acc_nrm = add_accessor(add_view(nrm_bytes, 34962), 5126, len(normals), "VEC3")

jnt_bytes = b"".join(struct.pack("<4H", *j) for j in joints)
acc_jnt = add_accessor(add_view(jnt_bytes, 34962), 5123, len(joints), "VEC4")

wgt_bytes = b"".join(struct.pack("<4f", *w) for w in weights)
acc_wgt = add_accessor(add_view(wgt_bytes, 34962), 5126, len(weights), "VEC4")

primitives, materials = [], []
for role in ROLE_ORDER:
    tris_r = tri_by_role[role]
    if not tris_r:
        continue
    idx_bytes = b"".join(struct.pack("<3I", *t) for t in tris_r)
    acc_idx = add_accessor(add_view(idx_bytes, 34963), 5125, len(tris_r) * 3, "SCALAR")
    color, rough, metal = ROLES[role]
    materials.append({
        "name": f"SOLDIER_{role}",
        "pbrMetallicRoughness": {
            "baseColorFactor": [*color, 1.0],
            "roughnessFactor": rough,
            "metallicFactor": metal,
        },
    })
    primitives.append({
        "attributes": {
            "POSITION": acc_pos, "NORMAL": acc_nrm,
            "JOINTS_0": acc_jnt, "WEIGHTS_0": acc_wgt,
        },
        "indices": acc_idx,
        "material": len(materials) - 1,
    })

# Ters bağlama matrisleri
ibm_bytes = b""
for b in bones:
    world = CONV @ b.matrix_local @ CONV_INV
    inv = world.inverted()
    ibm_bytes += struct.pack("<16f", *[inv[r][c] for c in range(4) for r in range(4)])
acc_ibm = add_accessor(add_view(ibm_bytes), 5126, len(bones), "MAT4")

# ── Düğümler ────────────────────────────────────────────────────────────
nodes = []
for b in bones:
    local = b.matrix_local if b.parent is None else b.parent.matrix_local.inverted() @ b.matrix_local
    m = CONV @ local @ CONV_INV
    t, r, s = m.decompose()
    nodes.append({
        "name": b.name,
        "translation": [t.x, t.y, t.z],
        "rotation": [r.x, r.y, r.z, r.w],
        "scale": [s.x, s.y, s.z],
        "children": [],
    })
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
    "asset": {"version": "2.0", "generator": "celik-hat soldier exporter"},
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

bin_blob = b"".join(bin_parts)
json_blob = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
json_blob += b" " * ((-len(json_blob)) % 4)

glb = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(json_blob) + 8 + len(bin_blob))
glb += struct.pack("<II", len(json_blob), 0x4E4F534A) + json_blob
glb += struct.pack("<II", len(bin_blob), 0x004E4942) + bin_blob

with open(OUT, "wb") as f:
    f.write(glb)

print(f"EXPORT_OK\t{OUT}\tucgen={sum(len(t) for t in tri_by_role.values())}"
      f"\tkemik={len(bones)}\tparca={len(primitives)}\tboyut={len(glb) // 1024}KB")
