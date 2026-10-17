"""Blender headless: tek parca (birlesik) FBX silahini oyuna hazirlar.

Sketchfab'den inen modellerin cogu tek mesh halinde gelir; sarjor degistirme
animasyonu icin sarjorun AYRI bir nesne olmasi gerekiyor. Bu betik:

  1. FBX'i ice aktarir, dokulari (Color/Normal/Roughness/Metallic) baglar,
  2. mesh'i gevsek parcalara bakarak ayirir: verilen kutunun icinde kalan ve
     alt siniri `--mag-below` degerinin altina inen parcalar "Magazine" olur
     (sarjor yuvasi ust sinirdan yukarida kaldigi icin govdede kalir),
  3. govdeyi verilen ucgen sayisina indirir, GLB olarak yazar.

Kullanim:
  blender --background --python export_fbx_weapon.py -- \
     girdi.fbx cikis.glb doku_klasoru maks_ucgen \
     xmin xmax mag_below
Dokular onceden 2048'e indirilmis JPEG'ler olmali (bkz. CLAUDE.md, sips).
"""
import bpy
import bmesh
import sys
import os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out_path, tex_dir = argv[0], argv[1], argv[2]
max_tris = int(argv[3])
mag_xmin, mag_xmax, mag_below = float(argv[4]), float(argv[5]), float(argv[6])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
for o in list(bpy.data.objects):
    if o.type != "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
body = meshes[0]
body.name = "Receiver"

# ── 1. Dokular ──────────────────────────────────────────────────────────
def doku(son_ek):
    for f in sorted(os.listdir(tex_dir)):
        if son_ek.lower() in f.lower():
            return bpy.data.images.load(os.path.join(tex_dir, f))
    return None

mat = bpy.data.materials.new("Silah")
mat.use_nodes = True
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")

def bagla(img, girdi, renk=False):
    if not img:
        return None
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    if not renk:
        img.colorspace_settings.name = "Non-Color"
    if girdi == "Normal":
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    else:
        nt.links.new(t.outputs["Color"], bsdf.inputs[girdi])
    return t

bagla(doku("_Color"), "Base Color", renk=True)
bagla(doku("_Normal"), "Normal")
bagla(doku("_Roughness"), "Roughness")
bagla(doku("_Metallic"), "Metallic")
body.data.materials.clear()
body.data.materials.append(mat)

# ── 2. Sarjoru ayir ─────────────────────────────────────────────────────
M = body.matrix_world
bm = bmesh.new()
bm.from_mesh(body.data)
bm.verts.ensure_lookup_table()
seen = set()
secilen = []
for v in bm.verts:
    if v.index in seen:
        continue
    stack, idx = [v], []
    seen.add(v.index)
    while stack:
        a = stack.pop()
        idx.append(a.index)
        for e in a.link_edges:
            b = e.other_vert(a)
            if b.index not in seen:
                seen.add(b.index)
                stack.append(b)
    pts = [M @ bm.verts[i].co for i in idx]
    cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    zmin = min(p.z for p in pts)
    if mag_xmin < cx < mag_xmax and zmin < mag_below:
        secilen.extend(idx)
bm.free()
print("SARJOR_KOSE", len(secilen))

bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="DESELECT")
bpy.ops.object.mode_set(mode="OBJECT")
for i in secilen:
    body.data.vertices[i].select = True
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_linked()
bpy.ops.mesh.separate(type="SELECTED")
bpy.ops.object.mode_set(mode="OBJECT")
mag = next(o for o in bpy.data.objects if o.type == "MESH" and o is not body)
mag.name = "Magazine"

# ── 3. Ucgen butcesi (sarjor dokunulmadan kalir) ─────────────────────────
def tris(o):
    return sum(max(len(p.vertices) - 2, 0) for p in o.data.polygons)

n = tris(body)
if n > max_tris:
    d = body.modifiers.new("WebDecimate", "DECIMATE")
    d.decimate_type = "COLLAPSE"
    d.ratio = max_tris / n
    print("DECIMATE", n, "->", max_tris)

bpy.ops.export_scene.gltf(
    filepath=out_path, export_format="GLB", export_apply=True, export_yup=True,
    export_materials="EXPORT", export_cameras=False, export_lights=False,
    export_image_format="JPEG",
)
print("EXPORT_OK", out_path, "govde", n, "sarjor", tris(mag))
