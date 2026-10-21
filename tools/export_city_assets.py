"""Şehir varlıkları (~/Desktop/Sehir_Assetleri_FBX/*.fbx) → assets/city/*.glb

Kullanım:
  Blender --background --python tools/export_city_assets.py -- ~/Desktop/Sehir_Assetleri_FBX assets/city

Modeller dokusuz, 20–40 renkli malzemeli. Şehirde yüzlerce kopya olunca her
malzeme ayrı çizim çağrısı demek; bu yüzden:
  • her yüzün malzeme rengi KÖŞE RENGİNE (COLOR_0) yazılır,
  • malzemeler dört sınıfta toplanır: Govde (boya/beton/ahşap…), Metal
    (çelik, alüminyum, krom, bronz, altın), Cam (cam_*), Isik (ışıklar —
    ışıyan). Model başına en çok 4 çizim çağrısı.
  • 60 bin üçgeni aşan model (Gokdelen_Tas) sadeleştirilir.
  • Draco ile sıkıştırılır (oyunda vendor/addons/libs/draco/gltf çözücüsü).
"""
import bpy, bmesh, os, sys

src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
os.makedirs(dst, exist_ok=True)

def cls(name):
    n = name.lower()
    if n.startswith('isik'): return 'Isik'
    if n.startswith('cam'): return 'Cam'
    if any(k in n for k in ('celik', 'aluminyum', 'krom', 'bronz', 'altin', 'gunes_paneli')): return 'Metal'
    return 'Govde'

def base_color(m):
    if m and m.use_nodes:
        b = next((x for x in m.node_tree.nodes if x.type == 'BSDF_PRINCIPLED'), None)
        if b:
            c = b.inputs['Base Color'].default_value
            e = b.inputs.get('Emission Color')
            if cls(m.name) == 'Isik' and e is not None and not e.is_linked and max(e.default_value[:3]) > 0.05:
                c = e.default_value
            return tuple(c[:3])
    return tuple(m.diffuse_color[:3]) if m else (0.8, 0.8, 0.8)

def class_material(kind):
    m = bpy.data.materials.get('CH_' + kind) or bpy.data.materials.new('CH_' + kind)
    m.use_nodes = True
    nt = m.node_tree
    b = next(x for x in nt.nodes if x.type == 'BSDF_PRINCIPLED')
    attr = nt.nodes.get('VC') or nt.nodes.new('ShaderNodeVertexColor')
    attr.name = 'VC'
    attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = {'Govde': 0.8, 'Metal': 0.35, 'Cam': 0.08, 'Isik': 0.5}[kind]
    b.inputs['Metallic'].default_value = {'Govde': 0.0, 'Metal': 0.75, 'Cam': 0.35, 'Isik': 0.0}[kind]
    if kind == 'Isik':
        nt.links.new(attr.outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = 2.0
    return m

for f in sorted(os.listdir(src)):
    if not f.lower().endswith('.fbx'):
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(src, f))
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in bpy.context.scene.objects:
        o.select_set(o.type == 'MESH')
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    me = o.data
    mats = list(me.materials)
    colors = [base_color(m) for m in mats]
    kinds = [cls(m.name) if m else 'Govde' for m in mats]

    # Yüz rengi → köşe rengi (köşe başına, yüz rengi)
    if 'Col' in me.color_attributes:
        me.color_attributes.remove(me.color_attributes['Col'])
    ca = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for poly in me.polygons:
        c = colors[poly.material_index] if poly.material_index < len(colors) else (0.8, 0.8, 0.8)
        for li in poly.loop_indices:
            ca.data[li].color = (c[0], c[1], c[2], 1.0)
    me.color_attributes.active_color = ca

    # Malzemeleri sınıflara indir
    order = ['Govde', 'Metal', 'Cam', 'Isik']
    used = [k for k in order if k in kinds]
    remap = [used.index(k) for k in kinds]
    for poly in me.polygons:
        poly.material_index = remap[poly.material_index] if poly.material_index < len(remap) else 0
    me.materials.clear()
    for k in used:
        me.materials.append(class_material(k))

    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    if tris > 60000:
        mod = o.modifiers.new('Sadelestir', 'DECIMATE')
        mod.ratio = 40000 / tris
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    tris2 = sum(len(p.vertices) - 2 for p in o.data.polygons)

    out = os.path.join(dst, os.path.splitext(f)[0].lower() + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=True, export_apply=True,
        export_vertex_color='ACTIVE', export_normals=True, export_materials='EXPORT',
        # Draco: köşe renkli düz gölgeli modeller sıkıştırmasız 21 MB tutuyordu
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14, export_draco_normal_quantization=8,
        export_draco_color_quantization=8, export_draco_texcoord_quantization=10,
    )
    print('OK', f, tris, '->', tris2, used, os.path.getsize(out))
