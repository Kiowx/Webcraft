#!/usr/bin/env python3
"""Build WebCraft overlay atlases from an extracted Minecraft Java 1.12.2 client."""
from __future__ import annotations
import json
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'assets/minecraft-1.12.2/extracted/assets/minecraft/textures'
OUT = ROOT / 'assets/minecraft-1.12.2/generated'
SLOTS = ROOT / 'assets/minecraft-1.12.2/texture-slots.json'
OUT.mkdir(parents=True, exist_ok=True)
NEAREST = Image.Resampling.NEAREST

names = json.loads(SLOTS.read_text(encoding='utf-8'))
normal_names = [name for name in names if not name.startswith('skin.')]
slots = {name: i for i, name in enumerate(normal_names)}
atlas = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
mapping: dict[str, str] = {}

def src(rel: str) -> Path:
    return SRC / rel

def frame(rel: str, index: int = 0) -> Image.Image:
    image = Image.open(src(rel)).convert('RGBA')
    if image.height > image.width and image.width == 16:
        image = image.crop((0, index * 16, 16, index * 16 + 16))
    return image

def fit(image: Image.Image) -> Image.Image:
    return image.resize((16, 16), NEAREST)

def tint(image: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    image = image.convert('RGBA')
    gray = image.convert('L')
    color = Image.new('RGB', image.size, rgb)
    colored = ImageChops.multiply(color, Image.merge('RGB', (gray, gray, gray)))
    colored.putalpha(image.getchannel('A'))
    return colored

def paste(name: str, image: Image.Image, source: str) -> None:
    if name not in slots:
        return
    i = slots[name]
    atlas.alpha_composite(fit(image), ((i % 32) * 16, (i // 32) * 16))
    mapping[name] = source

block_dir = SRC / 'blocks'
item_dir = SRC / 'items'
block_alias = {
    'anvil_side':'anvil_base','anvil_top':'anvil_top_damaged_0','bricks':'brick',
    'cobweb':'web','farmland_top':'farmland_dry','fire':'fire_layer_0','flower_red':'flower_rose',
    'flower_yellow':'flower_dandelion','furnace_front':'furnace_front_off','furnace_front_lit':'furnace_front_on',
    'grass_side_snow':'grass_side_snowed','lava':'lava_still','leaves':'leaves_oak','leaves_spruce':'leaves_spruce',
    'log_side':'log_oak','log_top':'log_oak_top','mossy_cobblestone':'cobblestone_mossy',
    'nether_bricks':'nether_brick','nether_portal':'portal','oak_trapdoor':'trapdoor',
    'piston_top':'piston_top_normal','planks':'planks_oak','redstone_lamp':'redstone_lamp_off',
    'redstone_lamp_lit':'redstone_lamp_on','redstone_wire':'redstone_dust_dot','redstone_wire_lit':'redstone_dust_dot',
    'repeater':'repeater_off','repeater_lit':'repeater_on','sandstone_side':'sandstone_normal','sapling':'sapling_oak',
    'spruce_log_side':'log_spruce','stone_bricks':'stonebrick','sugar_cane':'reeds','torch':'torch_on',
    'water':'water_still','wool_white':'wool_colored_white','end_portal_frame':'endframe_top',
    'end_portal':'portal','oak_door':'door_wood_lower','oak_door_upper':'door_wood_upper','iron_door':'door_iron_lower','iron_door_upper':'door_iron_upper',
}
for stage, original in enumerate((0, 2, 4, 7)):
    block_alias[f'wheat_{stage}'] = f'wheat_stage_{original}'
    block_alias[f'carrot_{stage}'] = f'carrots_stage_{stage}'
    block_alias[f'potato_{stage}'] = f'potatoes_stage_{stage}'
for i, original in enumerate((0,1,3,4,5,6,8,9)):
    block_alias[f'crack_{i}'] = f'destroy_stage_{original}'

# Ordinary block/item tiles.
for name in normal_names:
    base = block_alias.get(name, name)
    path = block_dir / f'{base}.png'
    if path.exists():
        image = frame(f'blocks/{base}.png')
        if name == 'grass_top': image = tint(image, (145,189,89))
        elif name == 'leaves': image = tint(image, (119,171,47))
        elif name == 'leaves_spruce': image = tint(image, (97,153,97))
        elif name == 'tallgrass': image = tint(image, (145,189,89))
        elif name == 'redstone_wire': image = tint(image, (96, 18, 12))
        elif name == 'redstone_wire_lit': image = tint(image, (255, 48, 25))
        paste(name, image, f'blocks/{base}.png')

# Grass side is base dirt plus tinted alpha overlay.
base_side = frame('blocks/grass_side.png')
overlay_side = tint(frame('blocks/grass_side_overlay.png'), (145,189,89))
paste('grass_side', Image.alpha_composite(base_side, overlay_side), 'blocks/grass_side.png + grass_side_overlay.png')

item_alias = {
    'baked_potato':'potato_baked','bone_meal':'dye_powder_white','book':'book_normal','bow':'bow_standby',
    'bucket':'bucket_empty','eye_of_ender':'ender_eye','fish_raw':'fish_cod_raw','fish_cooked':'fish_cod_cooked',
    'fishing_rod':'fishing_rod_uncast','flint_steel':'flint_and_steel','glass_bottle':'potion_bottle_empty',
    'golden_apple':'apple_golden','lapis_lazuli':'dye_powder_blue','lava_bucket':'bucket_lava',
    'redstone':'redstone_dust','slime_ball':'slimeball','water_bucket':'bucket_water','wheat_seeds':'seeds_wheat',
}
for name in normal_names:
    target = item_alias.get(name, name)
    if name.startswith(('pickaxe_','axe_','shovel_','sword_','hoe_')):
        tool, tier = name.split('_',1); target = f'{tier}_{tool}'
    if name.startswith('armor_'):
        _, piece, material = name.split('_',2); target = f'{material}_{piece}'
    path = item_dir / f'{target}.png'
    if path.exists(): paste(name, Image.open(path).convert('RGBA'), f'items/{target}.png')

# Potion bottle composites.
def potion(name: str, color: tuple[int,int,int]):
    bottle = Image.open(item_dir/'potion_bottle_drinkable.png').convert('RGBA')
    liquid = tint(Image.open(item_dir/'potion_overlay.png').convert('RGBA'), color)
    paste(name, Image.alpha_composite(liquid, bottle), f'items/potion_overlay.png + {color}')
potion('water_bottle',(55,108,190)); potion('awkward_potion',(120,38,155)); potion('healing_potion',(220,35,70))

# Environment.
if src('environment/sun.png').exists(): paste('sun', Image.open(src('environment/sun.png')).convert('RGBA'), 'environment/sun.png')
if src('environment/moon_phases.png').exists(): paste('moon', Image.open(src('environment/moon_phases.png')).convert('RGBA').crop((0,0,16,16)), 'environment/moon_phases.png#0')
if src('misc/shadow.png').exists(): paste('entity_shadow', Image.open(src('misc/shadow.png')).convert('RGBA'), 'misc/shadow.png')
if src('entity/arrow.png').exists(): paste('arrow_entity', Image.open(src('entity/arrow.png')).convert('RGBA'), 'entity/arrow.png')

# Minecraft ModelBox-style unfolded face extraction.
def box_faces(rel: str, u: int, v: int, w: int, h: int, d: int) -> dict[str,Image.Image]:
    sheet = Image.open(src(rel)).convert('RGBA')
    regions = {
        'left': (u, v+d, u+d, v+d+h),
        'front': (u+d, v+d, u+d+w, v+d+h),
        'right': (u+d+w, v+d, u+d+w+d, v+d+h),
        'back': (u+d+w+d, v+d, u+d+w+d+w, v+d+h),
        'top': (u+d, v, u+d+w, v+d),
        'bottom': (u+d+w, v, u+d+w+w, v+d),
    }
    return {face: sheet.crop(region) for face,region in regions.items()}

def paste_faces(prefix: str, rel: str, spec: tuple[int,int,int,int,int]):
    faces=box_faces(rel,*spec)
    for face,img in faces.items(): paste(f'{prefix}_{face}',img,f'{rel}:{spec}:{face}')

# Accurate main box faces for mobs that already expose directional tile names.
for prefix,rel,spec in [
 ('zombie_head','entity/zombie/zombie.png',(0,0,8,8,8)),('zombie_body','entity/zombie/zombie.png',(16,16,8,12,4)),
 ('zombie_arm','entity/zombie/zombie.png',(40,16,4,12,4)),('zombie_leg','entity/zombie/zombie.png',(0,16,4,12,4)),
 ('skeleton_head','entity/skeleton/skeleton.png',(0,0,8,8,8)),('skeleton_body','entity/skeleton/skeleton.png',(16,16,8,12,4)),
 ('skeleton_limb','entity/skeleton/skeleton.png',(40,16,2,12,2)),
 ('pig_head','entity/pig/pig.png',(0,0,8,8,8)),('pig_body','entity/pig/pig.png',(28,8,10,16,8)),('pig_leg','entity/pig/pig.png',(0,16,4,6,4)),('pig_snout','entity/pig/pig.png',(16,16,6,3,1)),
 ('cow_head','entity/cow/cow.png',(0,0,8,8,6)),('cow_body','entity/cow/cow.png',(18,4,12,18,10)),('cow_leg','entity/cow/cow.png',(0,16,4,12,4)),
 ('sheep_head','entity/sheep/sheep.png',(0,0,6,6,8)),('sheep_body','entity/sheep/sheep.png',(28,8,8,16,6)),('sheep_leg','entity/sheep/sheep.png',(0,16,4,12,4)),
 ('sheep_wool','entity/sheep/sheep_fur.png',(28,8,8,16,6)),
 ('creeper_head','entity/creeper/creeper.png',(0,0,8,8,8)),('creeper_body','entity/creeper/creeper.png',(16,16,8,12,4)),('creeper_leg','entity/creeper/creeper.png',(0,16,4,6,4)),
 ('wolf_head','entity/wolf/wolf.png',(0,0,6,6,4)),('wolf_body','entity/wolf/wolf.png',(18,14,6,9,6)),('wolf_leg','entity/wolf/wolf.png',(0,18,2,8,2)),('wolf_tail','entity/wolf/wolf.png',(9,18,2,8,2)),
 ('cat_head','entity/cat/ocelot.png',(0,0,6,6,5)),('cat_body','entity/cat/ocelot.png',(20,0,4,16,6)),('cat_leg','entity/cat/ocelot.png',(8,13,2,6,2)),('cat_tail','entity/cat/ocelot.png',(0,15,1,8,1)),
]:
    if src(rel).exists(): paste_faces(prefix,rel,spec)

# Non-directional representative entity tiles.
def region_tile(name, rel, box):
    if src(rel).exists(): paste(name, Image.open(src(rel)).convert('RGBA').crop(box), f'{rel}:{box}')
region_tile('chicken_body','entity/chicken.png',(0,9,16,25)); region_tile('chicken_head','entity/chicken.png',(0,0,16,16)); region_tile('chicken_head_side','entity/chicken.png',(16,0,32,16)); region_tile('chicken_head_back','entity/chicken.png',(32,0,48,16)); region_tile('chicken_head_top','entity/chicken.png',(0,0,16,16)); region_tile('chicken_head_bottom','entity/chicken.png',(16,0,32,16)); region_tile('chicken_beak','entity/chicken.png',(14,0,30,16)); region_tile('chicken_leg','entity/chicken.png',(26,0,42,16))
for name,rel,box in [
 ('spider_body','entity/spider/spider.png',(0,12,16,28)),('spider_head','entity/spider/spider.png',(0,0,16,16)),('spider_leg','entity/spider/spider.png',(18,0,34,16)),
 ('slime','entity/slime/slime.png',(0,0,16,16)),('slime_core','entity/slime/slime.png',(16,16,32,32)),('slime_eye','entity/slime/slime.png',(6,6,10,10)),('slime_mouth','entity/slime/slime.png',(6,12,12,15)),
 ('enderman','entity/enderman/enderman.png',(16,16,32,32)),('enderman_face','entity/enderman/enderman.png',(8,8,16,16)),
 ('villager_skin','entity/villager/villager.png',(0,0,16,16)),('villager_face','entity/villager/villager.png',(8,8,16,16)),('villager_robe','entity/villager/villager.png',(16,16,32,32)),
 ('iron_golem','entity/iron_golem.png',(16,16,32,32)),('iron_golem_face','entity/iron_golem.png',(8,8,16,16)),('squid','entity/squid.png',(0,0,16,16)),
 ('bat','entity/bat.png',(0,0,16,16)),('bat_face','entity/bat.png',(6,6,14,14)),('bat_wing','entity/bat.png',(16,0,32,16)),
 ('blaze','entity/blaze.png',(0,0,16,16)),('blaze_face','entity/blaze.png',(8,8,16,16)),('blaze_rod_mob','entity/blaze.png',(0,16,16,32)),
 ('dragon_body','entity/enderdragon/dragon.png',(0,0,16,16)),('dragon_face','entity/enderdragon/dragon.png',(8,8,24,24)),('dragon_wing','entity/enderdragon/dragon.png',(64,0,96,16)),
]: region_tile(name,rel,box)
for profession,source_name in [('farmer','farmer'),('librarian','librarian'),('toolsmith','smith'),('butcher','butcher'),('cleric','priest')]:
    region_tile('villager_'+profession,f'entity/villager/{source_name}.png',(16,16,32,32))

# Chest block approximation from the original entity sheet lid.
if src('entity/chest/normal.png').exists():
    faces=box_faces('entity/chest/normal.png',0,0,14,5,14)
    paste('chest_top',faces['top'],'entity/chest/normal.png lid top')
    paste('chest_side',faces['left'],'entity/chest/normal.png lid side')
    paste('chest_front',faces['front'],'entity/chest/normal.png lid front')
# Sign and bed approximations.
region_tile('oak_sign','entity/sign.png',(0,0,32,16))
if src('entity/bed/red.png').exists():
    bed=Image.open(src('entity/bed/red.png')).convert('RGBA')
    paste('bed_top',bed.crop((6,6,22,22)),'entity/bed/red.png top')
    paste('bed_side',bed.crop((22,6,38,22)),'entity/bed/red.png side')

# Armor material face samples from original model layers.
for material in ('leather','gold','iron','diamond'):
    rel=f'models/armor/{material}_layer_1.png'
    if not src(rel).exists(): continue
    faces=box_faces(rel,0,0,8,8,8)
    for face,img in faces.items(): paste(f'remote_armor_{material}_{face}',img,f'{rel}:helmet:{face}')
    paste(f'remote_armor_{material}',faces['front'],f'{rel}:helmet:front')
if src('misc/enchanted_item_glint.png').exists(): paste('remote_armor_glint',frame('misc/enchanted_item_glint.png'),'misc/enchanted_item_glint.png')
if src('entity/creeper/creeper_armor.png').exists(): paste('creeper_charge',Image.open(src('entity/creeper/creeper_armor.png')).convert('RGBA').crop((0,0,16,16)),'entity/creeper/creeper_armor.png')

# Biome variants, keeping UV slots stable.
biome_colors={
 'plains':((145,189,89),(119,171,47)),'swamp':((106,112,57),(106,112,57)),
 'desert':((191,183,85),(174,164,42)),'snow':((128,180,151),(96,161,123)),
 'mountain':((138,182,137),(104,164,100)),'river':((142,185,113),(112,169,74)),
 'ocean':((142,185,113),(112,169,74)),'beach':((145,189,89),(119,171,47)),
}
for biome,(grass_color,foliage_color) in biome_colors.items():
    paste(f'grass_top__{biome}',tint(frame('blocks/grass_top.png'),grass_color),f'grass tint {biome}')
    paste(f'grass_side__{biome}',Image.alpha_composite(base_side,tint(frame('blocks/grass_side_overlay.png'),grass_color)),f'grass side tint {biome}')
    paste(f'leaves__{biome}',tint(frame('blocks/leaves_oak.png'),foliage_color),f'foliage tint {biome}')
    paste(f'tallgrass__{biome}',tint(frame('blocks/tallgrass.png'),grass_color),f'tallgrass tint {biome}')

# Original Steve/Alex skins occupy the existing reserved skin pages.
for profile,index in [('steve',0),('alex',1)]:
    path=src(f'entity/{profile}.png')
    if path.exists(): atlas.alpha_composite(Image.open(path).convert('RGBA'),(index*64,448))

atlas.save(OUT/'vanilla-atlas-overlay.png', optimize=True)
(OUT/'texture-map.json').write_text(json.dumps(mapping,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')

# Tinted/normalized animation sheets and metadata.
animations=[]
for tile,source_name,tint_color in [
 ('water','water_still',(55,100,210)),('lava','lava_still',None),('fire','fire_layer_0',None),('nether_portal','portal',None)
]:
    sheet=Image.open(block_dir/f'{source_name}.png').convert('RGBA')
    if tint_color: sheet=tint(sheet,tint_color)
    out_file=OUT/f'anim_{tile}.png'; sheet.save(out_file,optimize=True)
    meta_path=block_dir/f'{source_name}.png.mcmeta'
    meta=json.loads(meta_path.read_text())['animation'] if meta_path.exists() else {}
    frames=meta.get('frames')
    normalized=[]
    if frames:
        for entry in frames: normalized.append(entry if isinstance(entry,int) else entry.get('index',0))
    animations.append({'tile':tile,'file':f'assets/minecraft-1.12.2/generated/{out_file.name}','frameCount':sheet.height//16,'frameTime':meta.get('frametime',1),'frames':normalized})
(OUT/'animations.json').write_text(json.dumps({'animations':animations},indent=2)+'\n',encoding='utf-8')

# GUI sprite overlay matching js/ui.js packing order.
gui=Image.new('RGBA',(256,256),(0,0,0,0)); pen_x=pen_y=row_h=0; positions={}
def add_slot(name,w,h):
    global pen_x,pen_y,row_h
    if pen_x+w>256: pen_x=0; pen_y+=row_h+1; row_h=0
    positions[name]=(pen_x,pen_y,w,h); pen_x+=w+1; row_h=max(row_h,h)
for spec in [('button',200,20),('button_hover',200,20),('slot',18,18),('selector',24,24),('hotbar',182,22),('heart_empty',9,9),('heart_full',9,9),('heart_half',9,9),('food_empty',9,9),('food_full',9,9),('food_half',9,9),('air',9,9),('armor_empty',9,9),('armor_full',9,9),('armor_half',9,9),('xp_bg',182,5),('xp_fill',182,5),('crosshair',15,15),('flame',14,14),('arrow',24,17)]: add_slot(*spec)
widgets=Image.open(src('gui/widgets.png')).convert('RGBA'); icons=Image.open(src('gui/icons.png')).convert('RGBA'); furnace=Image.open(src('gui/container/furnace.png')).convert('RGBA')
def gui_paste(name,image):
    x,y,w,h=positions[name]; gui.alpha_composite(image.resize((w,h),NEAREST),(x,y))
gui_paste('button',widgets.crop((0,66,200,86))); gui_paste('button_hover',widgets.crop((0,86,200,106)))
gui_paste('hotbar',widgets.crop((0,0,182,22))); gui_paste('selector',widgets.crop((0,22,24,46)))
for name,box in {
 'crosshair':(0,0,15,15),'heart_empty':(16,0,25,9),'heart_full':(52,0,61,9),'heart_half':(61,0,70,9),
 'armor_empty':(16,9,25,18),'armor_half':(25,9,34,18),'armor_full':(34,9,43,18),
 'air':(16,18,25,27),'food_empty':(43,27,52,36),'food_full':(52,27,61,36),'food_half':(61,27,70,36),
 'xp_bg':(0,64,182,69),'xp_fill':(0,69,182,74),
}.items(): gui_paste(name,icons.crop(box))
gui_paste('flame',furnace.crop((176,0,190,14))); gui_paste('arrow',furnace.crop((176,14,200,31)))
gui.save(OUT/'vanilla-gui-overlay.png',optimize=True)

# Container atlas: preserve current dimensions while using original panels.
containers=Image.new('RGBA',(176,168*5),(0,0,0,0))
for i,name in enumerate(('inventory','crafting_table','furnace')):
    image=Image.open(src(f'gui/container/{name}.png')).convert('RGBA').crop((0,0,176,166))
    containers.alpha_composite(image,(0,i*168))
generic=Image.open(src('gui/container/generic_54.png')).convert('RGBA')
chest=Image.new('RGBA',(176,168),(0,0,0,0)); chest.alpha_composite(generic.crop((0,0,176,71)),(0,0)); chest.alpha_composite(generic.crop((0,126,176,222)),(0,71)); containers.alpha_composite(chest,(0,3*168))
creative_path=src('gui/container/creative_inventory/tab_items.png')
if creative_path.exists():
    creative=Image.open(creative_path).convert('RGBA').crop((0,0,195,136))
    creative.save(OUT/'vanilla-creative.png',optimize=True)
containers.save(OUT/'vanilla-container-atlas.png',optimize=True)

# Menu panorama strip, dirt background and title artwork.
panos=[]
for i in range(6):
    path=src(f'gui/title/background/panorama_{i}.png')
    if path.exists(): panos.append(Image.open(path).convert('RGBA'))
if panos:
    strip=Image.new('RGBA',(256*len(panos),256));
    for i,img in enumerate(panos): strip.alpha_composite(img,(i*256,0))
    strip.save(OUT/'vanilla-panorama-strip.png',optimize=True)
if src('gui/options_background.png').exists(): Image.open(src('gui/options_background.png')).convert('RGBA').save(OUT/'vanilla-menu-dirt.png',optimize=True)
logo_path=src('gui/title/minecraft.png')
if logo_path.exists():
    source_logo=Image.open(logo_path).convert('RGBA')
    logo=Image.new('RGBA',(310,44),(0,0,0,0))
    logo.alpha_composite(source_logo.crop((0,0,155,44)),(0,0))
    logo.alpha_composite(source_logo.crop((0,45,155,89)),(155,0))
    logo.save(OUT/'vanilla-logo.png',optimize=True)
print(f'generated atlas: {len(mapping)} mapped tiles / {len(normal_names)} slots')
