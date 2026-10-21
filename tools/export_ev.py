"""Blender'deki savaş görmüş ev (home .blend, 'Ev' koleksiyonu) → GLB.

Kullanım:
  Blender --background "~/Desktop/home .blend" --python tools/export_ev.py -- assets/structures/ev.glb

İs lekeleri (Ev_SootHeavy / Ev_SootLight / Ev_WallSoot) yordamsal (gürültü
dokusu): glTF'e beyaz geçiyordu. Bu malzemeleri kullanan parçalara UV açılır,
renk Cycles ile dokuya PİŞİRİLİR ve taban rengine bağlanır. Ev ortalanır,
tabanı z = 0'a iner. Kapı Blender'de +Y'de → glTF'te −Z (oyunda ön yüz).
"""
import sys
import bpy
import mathutils

out = sys.argv[sys.argv.index('--') + 1]
SOOT = {'Ev_SootHeavy', 'Ev_SootLight', 'Ev_WallSoot'}
coll = bpy.data.collections['Ev']
objs = [o for o in coll.all_objects if o.type == 'MESH']

for o in bpy.context.view_layer.objects:
    o.select_set(False)

def uv_unwrap(o):
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    while len(o.data.uv_layers):
        o.data.uv_layers.remove(o.data.uv_layers[0])
    o.data.uv_layers.new(name='UVMap')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.03)
    bpy.ops.object.mode_set(mode='OBJECT')
    o.select_set(False)

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 8
sc.cycles.device = 'CPU'
sc.render.bake.use_pass_direct = False
sc.render.bake.use_pass_indirect = False
sc.render.bake.margin = 6

for o in objs:
    mats = {m.name for m in o.data.materials if m}
    if not (mats & SOOT):
        continue
    uv_unwrap(o)
    size = 1024 if o.name == 'Ev_Walls' else 512
    img = bpy.data.images.new(f'{o.name}_bake', size, size)
    img.colorspace_settings.name = 'sRGB'
    # Malzemeler parçaya özel kopyalanır (paylaşılan malzemede tek görüntü düğümü olurdu)
    for slot in o.material_slots:
        if not slot.material:
            continue
        m = slot.material.copy()
        slot.material = m
        node = m.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = img
        m.node_tree.nodes.active = node
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True)
    o.select_set(False)
    # Pişen doku taban rengine bağlanır (yordamsal ağaç devreden çıkar)
    for slot in o.material_slots:
        m = slot.material
        if not m:
            continue
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        tex = next(n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image == img)
        for l in list(bsdf.inputs['Base Color'].links):
            nt.links.remove(l)
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    img.pack()
    print('BAKED', o.name, size)

# Ortala, tabanı sıfıra indir
mn = mathutils.Vector((1e9, 1e9, 1e9)); mx = -mn
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
off = mathutils.Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
for o in objs:
    if o.parent is None:
        o.location -= off
    o.select_set(True)
print('SIZE', [round(v, 2) for v in (mx - mn)])

bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', use_selection=True, export_apply=True,
    export_image_format='JPEG', export_yup=True, export_texcoords=True, export_normals=True,
)
print('EXPORT_OK', out)
