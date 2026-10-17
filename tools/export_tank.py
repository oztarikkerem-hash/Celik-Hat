"""Tank .blend dosyasını oyunun beklediği GLB'ye çevirir.

Oyun tanktan şunu bekliyor: gövde kök düğüm, TARET gövdenin çocuğu ve
kendi ekseninde dönebiliyor, NAMLU taretin çocuğu ve yükselip alçalabiliyor.
Bu yüzden parçalar tek mesh'e kaynatılmaz; üç düğüme ayrılır ve her düğümün
geometrisi kendi DÖNME MERKEZİNE göre yeniden konumlanır.

  Hull   (kök)      — gövde + paletler + tekerlekler
   └ Turret         — taret kutusu, sepet, antenler  (Y ekseninde döner)
      └ Gun         — top namlusu                     (X ekseninde yükselir)
         └ Muzzle   — namlu ucu (boş düğüm; alev/mermi buradan çıkar)

Modeller +X yönüne bakıyor, oyun -Z'yi ileri sayıyor: her şey -90° yaw ile
çevrilir.

Kullanım:
  blender --background <tank>.blend --python tools/export_tank.py -- \\
      <cikis.glb> [maks_ucgen] [doku_boyutu]
"""
import bpy
import bmesh
import json
import os
import struct
import subprocess
import sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not argv:
    raise SystemExit("Çıkış yolu gerekli")
OUT = argv[0]
MAX_TRIS = int(argv[1]) if len(argv) > 1 else 120000
TEX_SIZE = int(argv[2]) if len(argv) > 2 else 2048
TEX_DIR = os.path.join(os.path.dirname(OUT), "tex")
os.makedirs(TEX_DIR, exist_ok=True)

# Blender Z-yukarı → glTF Y-yukarı, ardından +X ileri → -Z ileri
CONV = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
# +X ileri → -Z ileri. İşaret ÖNEMLİ: -90° tankı geriye çeviriyordu.
YAW = Matrix.Rotation(1.5707963267948966, 4, "Y")
M_ALL = YAW @ CONV


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


def dunya_kutu(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


# ── Parçaları ayıkla ve grupla ──────────────────────────────────────────
adaylar = []
for o in bpy.data.objects:
    if o.type != "MESH" or o.hide_render or not len(o.data.polygons):
        continue
    mn, mx = dunya_kutu(o)
    # Sahne zemini / arka plan düzlemi: tanktan büyük her şey atılır
    if (mx - mn).length > 25:
        print(f"ATLANDI\t{o.name}\t(sahne elemanı)")
        continue
    adaylar.append(o)

taret_objs, namlu_objs = [], []
for o in adaylar:
    n = o.name.lower()
    if any(k in n for k in ("gun", "barrel", "cannon", "mantlet")):
        namlu_objs.append(o)
    elif "turret" in n:
        taret_objs.append(o)

if not taret_objs:
    raise SystemExit("Taret bulunamadı")
t_mn = Vector((min(dunya_kutu(o)[0][i] for o in taret_objs) for i in range(3)))
t_mx = Vector((max(dunya_kutu(o)[1][i] for o in taret_objs) for i in range(3)))
TARET_TABAN = t_mn.z

gruplar = {"hull": [], "turret": list(taret_objs), "gun": list(namlu_objs)}
for o in adaylar:
    if o in taret_objs or o in namlu_objs:
        continue
    n = o.name.lower()
    if any(k in n for k in ("track", "wheel", "sprocket", "idler", "roller",
                            "hull", "body", "fender", "deck", "glacis", "skirt")):
        gruplar["hull"].append(o)
        continue
    # Adından anlaşılmayan parçalar: taret tabanının üstündeyse tarete ait
    mn, mx = dunya_kutu(o)
    merkez_z = (mn.z + mx.z) / 2
    gruplar["turret" if merkez_z > TARET_TABAN + 0.05 else "hull"].append(o)

for ad, objs in gruplar.items():
    tri = sum(sum(max(len(p.vertices) - 2, 0) for p in o.data.polygons) for o in objs)
    print(f"GRUP\t{ad}\tadet={len(objs)}\tucgen={tri}")

# ── Dönme merkezleri ────────────────────────────────────────────────────
TARET_PIVOT = Vector(((t_mn.x + t_mx.x) / 2, (t_mn.y + t_mx.y) / 2, TARET_TABAN))
if gruplar["gun"]:
    g_mn = Vector((min(dunya_kutu(o)[0][i] for o in gruplar["gun"]) for i in range(3)))
    g_mx = Vector((max(dunya_kutu(o)[1][i] for o in gruplar["gun"]) for i in range(3)))
    # Namlu +X'e uzanıyor: mafsal arka uçta, yükseklik namlunun ortası
    NAMLU_PIVOT = Vector((g_mn.x, (g_mn.y + g_mx.y) / 2, (g_mn.z + g_mx.z) / 2))
    NAMLU_UCU = Vector((g_mx.x, NAMLU_PIVOT.y, NAMLU_PIVOT.z))
else:
    NAMLU_PIVOT = TARET_PIVOT.copy()
    NAMLU_UCU = TARET_PIVOT + Vector((4, 0, 0))
print(f"PIVOT\ttaret=({TARET_PIVOT.x:.2f},{TARET_PIVOT.y:.2f},{TARET_PIVOT.z:.2f})"
      f"\tnamlu=({NAMLU_PIVOT.x:.2f},{NAMLU_PIVOT.y:.2f},{NAMLU_PIVOT.z:.2f})")

PIVOT = {"hull": Vector((0, 0, 0)), "turret": TARET_PIVOT, "gun": NAMLU_PIVOT}

# ── Her grubu tek mesh'e kaynat ve inceltt ──────────────────────────────
BUTCE = {"hull": 0.42, "turret": 0.34, "gun": 0.10}     # toplam bütçeden pay
birlesik = {}
for ad, objs in gruplar.items():
    if not objs:
        continue
    bpy.ops.object.select_all(action="DESELECT")
    kopyalar = []
    for o in objs:
        k = o.copy()
        k.data = o.data.copy()
        bpy.context.scene.collection.objects.link(k)
        kopyalar.append(k)
    for k in kopyalar:
        k.select_set(True)
    bpy.context.view_layer.objects.active = kopyalar[0]
    if len(kopyalar) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = f"TANK_{ad}"

    # Modifier'ları uygula (SUBSURF hariç: üçgeni katlıyor)
    for mod in list(obj.modifiers):
        if mod.type in {"SUBSURF", "MULTIRES"}:
            obj.modifiers.remove(mod)
            continue
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except RuntimeError:
            obj.modifiers.remove(mod)

    # Dünya dönüşümünü pişir, sonra pivot'a göre kaydır
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    obj.data.transform(Matrix.Translation(-PIVOT[ad]))

    def ucgen_say():
        return sum(max(len(p.vertices) - 2, 0) for p in obj.data.polygons)

    hedef = int(MAX_TRIS * BUTCE.get(ad, 0.2))
    tri = ucgen_say()
    if tri > hedef:
        mod = obj.modifiers.new("Dec", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = hedef / tri
        bpy.ops.object.modifier_apply(modifier=mod.name)
        # Çok parçalı/manifold olmayan taretlerde tek geçiş hedefe
        # varmıyor (Tank taretinde 82k → 70k kalıyordu). Önce düzlemsel
        # ayrıştırma, sonra ikinci bir çökertme uygulanır.
        kalan = ucgen_say()
        if kalan > hedef * 1.25:
            m2 = obj.modifiers.new("Dis", "DECIMATE")
            m2.decimate_type = "DISSOLVE"
            m2.angle_limit = 0.0873          # 5°
            bpy.ops.object.modifier_apply(modifier=m2.name)
            obj.data.calc_loop_triangles()
            kalan = ucgen_say()
            if kalan > hedef:
                m3 = obj.modifiers.new("Dec2", "DECIMATE")
                m3.decimate_type = "COLLAPSE"
                m3.ratio = hedef / kalan
                bpy.ops.object.modifier_apply(modifier=m3.name)
        print(f"INCELT\t{ad}\t{tri} → {ucgen_say()} (hedef {hedef})")

    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.update_edit_mesh(obj.data)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.data.calc_loop_triangles()
    birlesik[ad] = obj

# ── Dokular ─────────────────────────────────────────────────────────────
SAYDAM = ("alpha", "opacity", "decal")


def kopyala(src):
    if not src or not os.path.exists(src):
        return None
    taban, _ = os.path.splitext(os.path.basename(src))
    saydam = any(k in taban.lower() for k in SAYDAM)
    name = taban + (".png" if saydam else ".jpg")
    hedef = os.path.join(TEX_DIR, name)
    if os.path.exists(hedef):
        return f"tex/{name}"
    cmd = ["sips", "-Z", str(TEX_SIZE)]
    if not saydam:
        cmd += ["-s", "format", "jpeg", "-s", "formatOptions", "90"]
    cmd += [src, "--out", hedef]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        print(f"DOKU\t{name}\t{os.path.getsize(hedef)//1024}KB")
    except Exception as exc:
        print(f"DOKU_HATA\t{name}\t{exc}")
        return None
    return f"tex/{name}"


def goruntu_yolu(img):
    if not img:
        return None
    yol = bpy.path.abspath(img.filepath_from_user()) if (img.filepath_raw or img.filepath) else ""
    if yol and os.path.exists(yol):
        return yol
    # Pakete gömülü: diske yaz
    gecici = os.path.join(TEX_DIR, f"_tmp_{img.name}.png")
    try:
        img.file_format = "PNG"
        img.filepath_raw = gecici
        img.save()
        return gecici
    except Exception:
        return None


# Dokusuz malzemeler için ada göre askerî palet. Blender'daki bu
# malzemelerin rengi düğüm ağacında olduğundan okunamıyor; sabit tek gri
# vermek tankı renksiz gösteriyordu.
PALET = [
    (("rubber", "track", "tire", "pad"), (0.022, 0.022, 0.024), 0.95, 0.0),
    (("glass", "lens", "optic", "periscope", "sight"), (0.02, 0.035, 0.05), 0.15, 0.4),
    (("steel", "metal", "barrel", "gun", "mg", "chain"), (0.085, 0.088, 0.085), 0.45, 0.85),
    (("light", "lamp"), (0.55, 0.52, 0.42), 0.3, 0.2),
    (("net", "tarp", "canvas", "basket", "bag"), (0.13, 0.13, 0.095), 0.95, 0.0),
    (("hull", "turret", "body", "armor", "plate", "fender", "deck",
      "skirt", "box", "hatch"), (0.105, 0.118, 0.078), 0.82, 0.25),
]


def palet_rengi(ad):
    n = (ad or "").lower()
    for anahtarlar, renk, puruz, metal in PALET:
        if any(k in n for k in anahtarlar):
            return (*renk, 1.0), puruz, metal
    return (0.105, 0.118, 0.078, 1.0), 0.82, 0.25     # varsayılan: zeytin yeşili


def material_info(mat):
    info = {"color": (0.35, 0.37, 0.32, 1.0), "rough": 0.8, "metal": 0.1,
            "base_tex": None, "normal_tex": None, "rough_tex": None}
    if not mat:
        return info
    # Dokusuz malzemeler için sanatçının görünüm rengi kullanılır; sabit
    # bir gri vermek tankı renksiz/beyaz gösteriyordu.
    renk, puruz, metal = palet_rengi(mat.name)
    info["color"], info["rough"], info["metal"] = renk, puruz, metal
    try:
        dc = tuple(mat.diffuse_color)
        if dc[:3] != (0.8, 0.8, 0.8):
            info["color"] = dc
    except Exception:
        pass
    if not mat.use_nodes:
        return info
    bulunan = {}
    for node in mat.node_tree.nodes:
        if node.type != "TEX_IMAGE" or not node.image:
            continue
        n = (node.image.name + " " + (node.image.filepath or "")).lower()
        if any(k in n for k in ("basecolor", "base_color", "albedo", "diffuse")):
            bulunan.setdefault("base", node.image)
        elif "normal" in n:
            bulunan.setdefault("normal", node.image)
        elif "rough" in n:
            bulunan.setdefault("rough", node.image)
    if bulunan:
        info["base_tex"] = kopyala(goruntu_yolu(bulunan.get("base")))
        info["normal_tex"] = kopyala(goruntu_yolu(bulunan.get("normal")))
        info["rough_tex"] = kopyala(goruntu_yolu(bulunan.get("rough")))
        if info["base_tex"]:
            info["color"] = (1.0, 1.0, 1.0, 1.0)
        info["rough"] = 1.0 if info["rough_tex"] else 0.8
        return info
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
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


# ── glTF kurulumu ───────────────────────────────────────────────────────
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


images, textures, samplers, materials, meshes = [], [], [{"magFilter": 9729, "minFilter": 9987}], [], []
tex_index = {}


def tex_ref(uri):
    if not uri:
        return None
    if uri not in tex_index:
        images.append({"uri": uri})
        textures.append({"source": len(images) - 1, "sampler": 0})
        tex_index[uri] = len(textures) - 1
    return {"index": tex_index[uri]}


M3 = M_ALL.to_3x3()
mesh_index = {}
for ad, obj in birlesik.items():
    me = obj.data
    uv = me.uv_layers.active
    try:
        me.calc_normals_split()
    except AttributeError:
        pass
    slots = [material_info(sl.material) for sl in obj.material_slots] or [material_info(None)]

    positions, normals, uvs = [], [], []
    index_of, prims = {}, {}
    for tri in me.loop_triangles:
        prims.setdefault(tri.material_index, [])
        for k in range(3):
            vi, li = tri.vertices[k], tri.loops[k]
            t = tuple(uv.data[li].uv) if uv else (0.0, 0.0)
            no = tuple(me.loops[li].normal) if tri.use_smooth else tuple(tri.normal)
            key = (vi, round(t[0], 5), round(t[1], 5),
                   round(no[0], 3), round(no[1], 3), round(no[2], 3))
            idx = index_of.get(key)
            if idx is None:
                idx = len(positions)
                index_of[key] = idx
                co = M_ALL @ me.vertices[vi].co
                nn = (M3 @ Vector(no)).normalized()
                positions.append((co.x, co.y, co.z))
                normals.append((nn.x, nn.y, nn.z))
                uvs.append((t[0], 1.0 - t[1]))
            prims[tri.material_index].append(idx)

    acc_pos = add_accessor(add_view(b"".join(struct.pack("<3f", *p) for p in positions), 34962),
                           5126, len(positions), "VEC3",
                           ([min(p[i] for p in positions) for i in range(3)],
                            [max(p[i] for p in positions) for i in range(3)]))
    acc_nrm = add_accessor(add_view(b"".join(struct.pack("<3f", *n) for n in normals), 34962),
                           5126, len(normals), "VEC3")
    acc_uv = add_accessor(add_view(b"".join(struct.pack("<2f", *t) for t in uvs), 34962),
                          5126, len(uvs), "VEC2")

    prim_list = []
    for mat_i, idx_list in sorted(prims.items()):
        info = slots[mat_i] if mat_i < len(slots) else slots[0]
        acc_idx = add_accessor(add_view(b"".join(struct.pack("<I", i) for i in idx_list), 34963),
                               5125, len(idx_list), "SCALAR")
        pbr = {"baseColorFactor": list(info["color"]),
               "metallicFactor": info["metal"], "roughnessFactor": info["rough"]}
        b = tex_ref(info["base_tex"])
        if b:
            pbr["baseColorTexture"] = b
        r = tex_ref(info["rough_tex"])
        if r:
            pbr["metallicRoughnessTexture"] = r
        mdef = {"name": f"{ad}_{mat_i}", "pbrMetallicRoughness": pbr, "doubleSided": False}
        nrm = tex_ref(info["normal_tex"])
        if nrm:
            mdef["normalTexture"] = nrm
        materials.append(mdef)
        prim_list.append({"attributes": {"POSITION": acc_pos, "NORMAL": acc_nrm, "TEXCOORD_0": acc_uv},
                          "indices": acc_idx, "material": len(materials) - 1})
    meshes.append({"name": ad, "primitives": prim_list})
    mesh_index[ad] = len(meshes) - 1
    print(f"MESH\t{ad}\tkose={len(positions)}\tucgen={sum(len(v) for v in prims.values())//3}")


def yerel(p, pivot):
    """Dünya noktasını düğümün yerel uzayına çevirir."""
    v = M_ALL @ (p - pivot)
    return [v.x, v.y, v.z]


nodes = []
# Namlu ucu (boş düğüm)
nodes.append({"name": "Muzzle", "translation": yerel(NAMLU_UCU, NAMLU_PIVOT)})
muzzle_i = 0
gun_i = None
if "gun" in mesh_index:
    nodes.append({"name": "Gun", "mesh": mesh_index["gun"],
                  "translation": yerel(NAMLU_PIVOT, TARET_PIVOT), "children": [muzzle_i]})
    gun_i = len(nodes) - 1
turret_children = [gun_i] if gun_i is not None else []
nodes.append({"name": "Turret", "mesh": mesh_index["turret"],
              "translation": yerel(TARET_PIVOT, Vector((0, 0, 0))),
              "children": turret_children})
turret_i = len(nodes) - 1
nodes.append({"name": "Hull", "mesh": mesh_index["hull"], "children": [turret_i]})
hull_i = len(nodes) - 1
for n in nodes:
    if not n.get("children"):
        n.pop("children", None)

gltf = {
    "asset": {"version": "2.0", "generator": "celik-hat tank exporter"},
    "scene": 0,
    "scenes": [{"nodes": [hull_i]}],
    "nodes": nodes,
    "meshes": meshes,
    "materials": materials,
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

for f in os.listdir(TEX_DIR):
    if f.startswith("_tmp_"):
        os.remove(os.path.join(TEX_DIR, f))

print(f"EXPORT_OK\t{OUT}\tmesh={len(meshes)}\tmalzeme={len(materials)}"
      f"\tdoku={len(images)}\tboyut={len(glb)//1024}KB")
