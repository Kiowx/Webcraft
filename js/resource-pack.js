/* resource-pack.js - bundled Minecraft 1.12.2 texture-pack manifest */
'use strict';
(function () {
  if (typeof Textures === 'undefined' || !Textures.registerPack) return;
  const ROOT = 'assets/minecraft-1.12.2/extracted/assets/minecraft/textures/';
  const entries = {};
  const add = (directory, names) => {
    for (const name of names) entries[name] = ROOT + directory + '/' + name + '.png';
  };
  const alias = (runtimeName, directory, file, tint) => {
    const path = ROOT + directory + '/' + file + '.png';
    entries[runtimeName] = tint ? { path, tint } : path;
  };
  const entityPath = file => ROOT + 'entity/' + file;
  const entityCrop = (runtimeName, file, source, tint) => {
    entries[runtimeName] = tint ? { path:entityPath(file), source, tint } : { path:entityPath(file), source };
  };
  const entityRegion = (runtimeName, file, source, dest) => {
    entries[runtimeName] = { path:entityPath(file), source, dest };
  };
  const entityCube = (prefix, file, u, v, width, height, depth) => {
    entityCrop(prefix + '_top', file, [u + depth, v, width, depth]);
    entityCrop(prefix + '_bottom', file, [u + depth + width, v, width, depth]);
    entityCrop(prefix + '_right', file, [u, v + depth, depth, height]);
    entityCrop(prefix + '_front', file, [u + depth, v + depth, width, height]);
    entityCrop(prefix + '_left', file, [u + depth + width, v + depth, depth, height]);
    entityCrop(prefix + '_back', file, [u + depth * 2 + width, v + depth, width, height]);
  };
  const PACKED_FACE_CELLS = Object.freeze({
    right:[0,0,5,8], left:[5,0,5,8], top:[10,0,6,8],
    bottom:[0,8,5,8], back:[5,8,5,8], front:[10,8,6,8],
  });
  const packedEntityCrop = (runtimeName, file, source, page, cell) => {
    const spec = { path:entityPath(file), source, packed:{ page, cell:cell.slice() } };
    Object.defineProperty(spec, 'dest', {
      enumerable:true,
      get() {
        const rect = Textures.rect(page);
        return [rect[0] + cell[0], rect[1] + cell[1], cell[2], cell[3]];
      },
    });
    entries[runtimeName] = spec;
  };
  const packedEntityCube = (prefix, page, file, u, v, width, height, depth) => {
    packedEntityCrop(prefix + '_top', file, [u + depth, v, width, depth], page, PACKED_FACE_CELLS.top);
    packedEntityCrop(prefix + '_bottom', file, [u + depth + width, v, width, depth], page, PACKED_FACE_CELLS.bottom);
    packedEntityCrop(prefix + '_right', file, [u, v + depth, depth, height], page, PACKED_FACE_CELLS.right);
    packedEntityCrop(prefix + '_front', file, [u + depth, v + depth, width, height], page, PACKED_FACE_CELLS.front);
    packedEntityCrop(prefix + '_left', file, [u + depth + width, v + depth, depth, height], page, PACKED_FACE_CELLS.left);
    packedEntityCrop(prefix + '_back', file, [u + depth * 2 + width, v + depth, width, height], page, PACKED_FACE_CELLS.back);
  };

  add('blocks', [
    'stone', 'dirt', 'cobblestone', 'bedrock', 'sand', 'sandstone_top', 'gravel',
    'glass', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'glowstone', 'snow',
    'cactus_side', 'cactus_top', 'crafting_table_top', 'crafting_table_side',
    'crafting_table_front', 'furnace_top', 'furnace_side', 'bookshelf', 'tnt_side',
    'tnt_top', 'tnt_bottom', 'lapis_ore', 'enchanting_table_top',
    'enchanting_table_side', 'clay', 'obsidian', 'iron_block', 'ladder', 'soul_sand',
    'lever', 'iron_trapdoor', 'redstone_torch_on', 'redstone_torch_off', 'piston_side',
    'netherrack', 'end_stone', 'brewing_stand', 'dragon_egg',
  ]);
  add('items', [
    'stick', 'coal', 'charcoal', 'iron_ingot', 'gold_ingot', 'diamond', 'ender_pearl',
    'blaze_powder', 'emerald', 'nether_wart', 'blaze_rod', 'apple', 'porkchop_raw',
    'porkchop_cooked', 'beef_raw', 'beef_cooked', 'mutton_raw', 'mutton_cooked',
    'rotten_flesh', 'gunpowder', 'shears', 'flint', 'leather', 'string', 'feather',
    'bone', 'egg', 'wheat', 'bread', 'carrot', 'potato', 'chicken_raw',
    'chicken_cooked', 'paper', 'clay_ball', 'brick', 'glowstone_dust', 'arrow',
  ]);
  entityCrop('xp_orb', 'experience_orb.png', [16, 0, 16, 16], [155, 255, 48]);

  alias('grass_top', 'blocks', 'grass_top', [145, 201, 96]);
  alias('leaves', 'blocks', 'leaves_oak', [95, 164, 69]);
  alias('leaves_spruce', 'blocks', 'leaves_spruce', [78, 126, 93]);
  alias('tallgrass', 'blocks', 'tallgrass', [126, 190, 80]);
  alias('water', 'blocks', 'water_still', [76, 118, 196]);
  alias('lava', 'blocks', 'lava_still');
  alias('planks', 'blocks', 'planks_oak');
  alias('sapling', 'blocks', 'sapling_oak');
  alias('log_side', 'blocks', 'log_oak');
  alias('log_top', 'blocks', 'log_oak_top');
  alias('spruce_log_side', 'blocks', 'log_spruce');
  alias('birch_log_side', 'blocks', 'log_birch');
  alias('birch_log_top', 'blocks', 'log_birch_top');
  alias('birch_leaves', 'blocks', 'leaves_birch', [95, 164, 69]);
  alias('rail', 'blocks', 'rail_normal');
  alias('flower_red', 'blocks', 'flower_rose');
  alias('flower_yellow', 'blocks', 'flower_dandelion');
  alias('torch', 'blocks', 'torch_on');
  alias('furnace_front', 'blocks', 'furnace_front_off');
  alias('furnace_front_lit', 'blocks', 'furnace_front_on');
  alias('mossy_cobblestone', 'blocks', 'cobblestone_mossy');
  alias('bricks', 'blocks', 'brick');
  alias('stone_bricks', 'blocks', 'stonebrick');
  alias('grass_side_snow', 'blocks', 'grass_side_snowed');
  alias('sandstone_side', 'blocks', 'sandstone_normal');
  alias('wool_white', 'blocks', 'wool_colored_white');
  alias('farmland_top', 'blocks', 'farmland_dry');
  alias('wheat_0', 'blocks', 'wheat_stage_0');
  alias('wheat_1', 'blocks', 'wheat_stage_2');
  alias('wheat_2', 'blocks', 'wheat_stage_5');
  alias('wheat_3', 'blocks', 'wheat_stage_7');
  alias('carrot_0', 'blocks', 'carrots_stage_0');
  alias('carrot_1', 'blocks', 'carrots_stage_1');
  alias('carrot_2', 'blocks', 'carrots_stage_2');
  alias('carrot_3', 'blocks', 'carrots_stage_3');
  alias('potato_0', 'blocks', 'potatoes_stage_0');
  alias('potato_1', 'blocks', 'potatoes_stage_1');
  alias('potato_2', 'blocks', 'potatoes_stage_2');
  alias('potato_3', 'blocks', 'potatoes_stage_3');
  alias('fire', 'blocks', 'fire_layer_0');
  alias('anvil_top', 'blocks', 'anvil_top_damaged_0');
  alias('anvil_side', 'blocks', 'anvil_base');
  alias('sugar_cane', 'blocks', 'reeds');
  alias('cobweb', 'blocks', 'web');
  alias('redstone_lamp', 'blocks', 'redstone_lamp_off');
  alias('redstone_lamp_lit', 'blocks', 'redstone_lamp_on');
  alias('oak_door_lower', 'blocks', 'door_wood_lower');
  alias('oak_door_upper', 'blocks', 'door_wood_upper');
  alias('oak_door', 'items', 'door_wood');
  alias('iron_door_lower', 'blocks', 'door_iron_lower');
  alias('iron_door_upper', 'blocks', 'door_iron_upper');
  alias('iron_door', 'items', 'door_iron');
  alias('oak_trapdoor', 'blocks', 'trapdoor');
  alias('oak_sign', 'blocks', 'planks_oak');
  alias('redstone_wire', 'blocks', 'redstone_dust_line0');
  alias('redstone_wire_lit', 'blocks', 'redstone_dust_line0');
  alias('repeater', 'blocks', 'repeater_off');
  alias('repeater_lit', 'blocks', 'repeater_on');
  alias('piston_top', 'blocks', 'piston_top_normal');
  alias('nether_bricks', 'blocks', 'nether_brick');
  alias('nether_portal', 'blocks', 'portal');
  alias('end_portal_frame', 'blocks', 'endframe_top');

  alias('slime_ball', 'items', 'slimeball');
  alias('eye_of_ender', 'items', 'ender_eye');
  alias('glass_bottle', 'items', 'potion_bottle_empty');
  alias('bone_meal', 'items', 'dye_powder_white');
  alias('wheat_seeds', 'items', 'seeds_wheat');
  alias('baked_potato', 'items', 'potato_baked');
  alias('fish_raw', 'items', 'fish_cod_raw');
  alias('fish_cooked', 'items', 'fish_cod_cooked');
  alias('golden_apple', 'items', 'apple_golden');
  alias('book', 'items', 'book_normal');
  alias('bucket', 'items', 'bucket_empty');
  alias('water_bucket', 'items', 'bucket_water');
  alias('lava_bucket', 'items', 'bucket_lava');
  alias('flint_steel', 'items', 'flint_and_steel');
  alias('bow', 'items', 'bow_standby');
  alias('fishing_rod', 'items', 'fishing_rod_uncast');
  // Shields are builtin entity models in 1.12.2, so there is no items/shield.png.
  // Crop the front plate from ModelShield's (0, 0) 12x22x1 cuboid UV layout.
  entityCrop('shield', 'shield_base_nopattern.png', [1, 1, 12, 22]);
  alias('minecart', 'items', 'minecart_normal');
  alias('redstone', 'items', 'redstone_dust');
  alias('lapis_lazuli', 'items', 'dye_powder_blue');

  for (const material of ['wood', 'stone', 'iron', 'gold', 'diamond']) {
    for (const tool of ['pickaxe', 'axe', 'shovel', 'sword', 'hoe']) {
      alias(tool + '_' + material, 'items', material + '_' + tool);
    }
  }
  for (const material of ['leather', 'gold', 'iron', 'diamond']) {
    for (const piece of ['helmet', 'chestplate', 'leggings', 'boots']) {
      alias('armor_' + piece + '_' + material, 'items', material + '_' + piece);
    }
  }

  // Player skins occupy reserved 64x64 pages at the bottom of the runtime atlas.
  entityRegion('__skin_steve', 'steve.png', [0, 0, 64, 64], [0, 448, 64, 64]);
  entityRegion('__skin_alex', 'alex.png', [0, 0, 64, 64], [64, 448, 64, 64]);
  entityRegion('__skin_miner', 'steve.png', [0, 0, 64, 64], [128, 448, 64, 64]);
  entityRegion('__skin_wanderer', 'alex.png', [0, 0, 64, 64], [192, 448, 64, 64]);

  // Vanilla entity sheets are unfolded cuboids; crop each face into WebCraft's
  // per-part texture slots so existing model geometry can use the original art.
  entityCube('pig_head', 'pig/pig.png', 0, 0, 8, 8, 8);
  entityCube('pig_body', 'pig/pig.png', 28, 8, 10, 16, 8);
  entityCube('pig_leg', 'pig/pig.png', 0, 16, 4, 6, 4);
  entityCube('pig_snout', 'pig/pig.png', 16, 16, 4, 3, 1);
  entityCrop('pig_ear', 'pig/pig.png', [8, 8, 8, 8]);
  entityCrop('pig_tail', 'pig/pig.png', [38, 16, 4, 8]);

  entityCube('cow_head', 'cow/cow.png', 0, 0, 8, 8, 6);
  entityCube('cow_body', 'cow/cow.png', 18, 4, 12, 18, 10);
  entityCube('cow_leg', 'cow/cow.png', 0, 16, 4, 12, 4);
  entityCube('cow_snout', 'cow/cow.png', 6, 6, 8, 4, 2);
  entityCrop('cow_ear', 'cow/cow.png', [6, 6, 8, 4]);
  entityCube('cow_horn', 'cow/cow.png', 22, 0, 1, 3, 1);
  entityCube('cow_udder', 'cow/cow.png', 52, 0, 4, 6, 1);
  entityCrop('cow_tail', 'cow/cow.png', [40, 16, 4, 8]);

  entityCube('sheep_head', 'sheep/sheep.png', 0, 0, 6, 6, 8);
  entityCube('sheep_body', 'sheep/sheep.png', 28, 8, 8, 16, 6);
  entityCube('sheep_leg', 'sheep/sheep.png', 0, 16, 4, 6, 4);
  entityCube('sheep_wool', 'sheep/sheep_fur.png', 28, 8, 8, 16, 6);
  entityCube('sheep_wool_head', 'sheep/sheep_fur.png', 0, 0, 6, 6, 6);
  entityCube('sheep_wool_leg', 'sheep/sheep_fur.png', 0, 16, 4, 6, 4);
  entityCrop('sheep_wool_cap', 'sheep/sheep_fur.png', [8, 8, 8, 6]);
  entityCrop('sheep_ear', 'sheep/sheep.png', [8, 8, 8, 6]);
  entityCrop('sheep_tail', 'sheep/sheep_fur.png', [36, 16, 4, 8]);

  entityCrop('chicken_body', 'chicken.png', [6, 15, 6, 8]);
  entityCrop('chicken_head', 'chicken.png', [3, 3, 4, 6]);
  entityCrop('chicken_head_back', 'chicken.png', [10, 3, 4, 6]);
  entityCrop('chicken_head_side', 'chicken.png', [0, 3, 3, 6]);
  entityCrop('chicken_head_top', 'chicken.png', [3, 0, 4, 3]);
  entityCrop('chicken_head_bottom', 'chicken.png', [7, 0, 4, 3]);
  entityCrop('chicken_beak', 'chicken.png', [16, 2, 4, 2]);
  entityCrop('chicken_wattle', 'chicken.png', [16, 6, 2, 2]);
  entityCrop('chicken_leg', 'chicken.png', [29, 3, 3, 5]);
  entityCube('chicken_body', 'chicken.png', 0, 9, 6, 8, 6);
  entityCube('chicken_head', 'chicken.png', 0, 0, 4, 6, 3);
  entityCube('chicken_beak', 'chicken.png', 14, 0, 4, 2, 2);
  entityCube('chicken_wattle', 'chicken.png', 14, 4, 2, 2, 2);
  entityCube('chicken_leg', 'chicken.png', 26, 0, 3, 5, 3);
  entityCube('chicken_wing', 'chicken.png', 24, 13, 1, 4, 6);

  entityCube('wolf_head', 'wolf/wolf.png', 0, 0, 6, 6, 4);
  entityCube('wolf_body', 'wolf/wolf.png', 18, 14, 6, 9, 6);
  entityCube('wolf_leg', 'wolf/wolf.png', 0, 18, 2, 8, 2);
  entityCube('wolf_tail', 'wolf/wolf.png', 9, 18, 2, 8, 2);
  entityCube('wolf_muzzle', 'wolf/wolf.png', 0, 10, 3, 3, 4);
  entityCube('wolf_ear', 'wolf/wolf.png', 16, 14, 2, 2, 1);
  entityCrop('wolf_face', 'wolf/wolf.png', [4, 4, 6, 6]);
  entityCrop('wolf_collar', 'wolf/wolf_collar.png', [24, 16, 16, 8]);

  entityCube('cat_head', 'cat/ocelot.png', 0, 0, 5, 4, 5);
  entityCube('cat_body', 'cat/ocelot.png', 20, 0, 4, 16, 6);
  entityCube('cat_leg', 'cat/ocelot.png', 0, 15, 2, 6, 2);
  entityCube('cat_tail', 'cat/ocelot.png', 0, 15, 1, 8, 1);
  entityCube('cat_muzzle', 'cat/ocelot.png', 0, 0, 3, 2, 2);
  entityCube('cat_ear', 'cat/ocelot.png', 0, 0, 1, 1, 2);
  entityCrop('cat_face', 'cat/ocelot.png', [5, 5, 5, 4]);
  entityCrop('rabbit', 'rabbit/brown.png', [8, 8, 8, 8]);
  entityCrop('rabbit_face', 'rabbit/brown.png', [32, 5, 6, 5]);
  entityCrop('rabbit_tail', 'rabbit/brown.png', [52, 6, 4, 4]);
  entityCrop('horse', 'horse/horse_brown.png', [20, 20, 12, 12]);
  entityCrop('horse_face', 'horse/horse_brown.png', [0, 21, 7, 7]);
  entityCrop('horse_tail', 'horse/horse_brown.png', [44, 0, 4, 12]);
  entityCrop('horse_mane', 'horse/horse_brown.png', [44, 16, 4, 12]);
  entityCube('horse_original_body', 'horse/horse_brown.png', 0, 34, 10, 10, 24);
  entityCube('horse_original_leg', 'horse/horse_brown.png', 78, 29, 4, 9, 5);
  entityCube('horse_original_shin', 'horse/horse_brown.png', 78, 43, 3, 5, 3);
  entityCube('horse_original_hoof', 'horse/horse_brown.png', 78, 51, 4, 3, 4);
  entityCube('horse_original_head', 'horse/horse_brown.png', 0, 0, 5, 5, 7);
  entityCube('horse_original_upper_mouth', 'horse/horse_brown.png', 24, 18, 4, 3, 6);
  entityCube('horse_original_lower_mouth', 'horse/horse_brown.png', 24, 27, 4, 2, 5);
  entityCube('horse_original_ear', 'horse/horse_brown.png', 0, 0, 2, 3, 1);
  entityCube('horse_original_neck', 'horse/horse_brown.png', 0, 12, 4, 14, 8);
  entityCube('horse_original_mane', 'horse/horse_brown.png', 58, 0, 2, 16, 4);
  entityCube('horse_original_tail', 'horse/horse_brown.png', 38, 7, 3, 4, 7);

  entityCrop('squid', 'squid.png', [12, 12, 12, 16]);
  entityCrop('bat', 'bat.png', [6, 6, 6, 6]);
  entityCrop('bat_face', 'bat.png', [6, 6, 6, 6]);
  entityCrop('bat_wing', 'bat.png', [24, 0, 16, 16]);

  // Hostile and village mobs use separate runtime slots as well. Keep the
  // classic biped and creeper UVs directional so faces do not repeat around
  // the model, then sample the matching original region for single-slot parts.
  entityCube('zombie_head', 'zombie/zombie.png', 0, 0, 8, 8, 8);
  entityCube('zombie_body', 'zombie/zombie.png', 16, 16, 8, 12, 4);
  entityCube('zombie_arm', 'zombie/zombie.png', 40, 16, 4, 12, 4);
  entityCube('zombie_leg', 'zombie/zombie.png', 0, 16, 4, 12, 4);

  entityCube('skeleton_head', 'skeleton/skeleton.png', 0, 0, 8, 8, 8);
  entityCube('skeleton_body', 'skeleton/skeleton.png', 16, 16, 8, 12, 4);
  entityCube('skeleton_limb', 'skeleton/skeleton.png', 40, 16, 2, 12, 2);

  entityCube('creeper_head', 'creeper/creeper.png', 0, 0, 8, 8, 8);
  entityCube('creeper_body', 'creeper/creeper.png', 16, 16, 8, 12, 4);
  entityCube('creeper_leg', 'creeper/creeper.png', 0, 16, 4, 6, 4);
  entityCrop('creeper_charge', 'creeper/creeper_armor.png', [8, 8, 8, 8]);

  entityCrop('spider_head', 'spider/spider.png', [40, 12, 8, 8]);
  entityCrop('spider_body', 'spider/spider.png', [12, 24, 10, 8]);
  entityCrop('spider_leg', 'spider/spider.png', [20, 2, 16, 2]);
  packedEntityCube('spider_original_head', 'spider_head', 'spider/spider.png', 32, 4, 8, 8, 8);
  packedEntityCube('spider_original_neck', 'spider_body', 'spider/spider.png', 0, 0, 6, 6, 6);
  packedEntityCube('spider_original_body', 'spider_leg', 'spider/spider.png', 0, 12, 10, 8, 12);
  packedEntityCube('spider_original_leg', 'creeper_charge', 'spider/spider.png', 18, 0, 16, 2, 2);
  packedEntityCube('spider_original_eyes', 'skeleton', 'spider_eyes.png', 32, 4, 8, 8, 8);

  entityCrop('slime', 'slime/slime.png', [8, 8, 8, 8]);
  entityCrop('slime_core', 'slime/slime.png', [6, 22, 6, 6]);
  entityCrop('slime_eye', 'slime/slime.png', [34, 2, 2, 2]);
  entityCrop('slime_mouth', 'slime/slime.png', [33, 9, 1, 1]);
  packedEntityCube('slime_original_outer', 'slime', 'slime/slime.png', 0, 0, 8, 8, 8);
  packedEntityCube('slime_original_inner', 'slime_core', 'slime/slime.png', 0, 16, 6, 6, 6);
  packedEntityCube('slime_original_right_eye', 'slime_eye', 'slime/slime.png', 32, 0, 2, 2, 2);
  packedEntityCube('slime_original_left_eye', 'slime_mouth', 'slime/slime.png', 32, 4, 2, 2, 2);
  packedEntityCube('slime_original_mouth', 'pig_ear', 'slime/slime.png', 32, 8, 1, 1, 1);

  entityCrop('enderman_face', 'enderman/enderman.png', [8, 8, 8, 8]);
  entityCrop('enderman', 'enderman/enderman.png', [20, 20, 8, 12]);
  packedEntityCube('enderman_original_head', 'enderman', 'enderman/enderman.png', 0, 0, 8, 8, 8);
  packedEntityCube('enderman_original_headwear', 'enderman_face', 'enderman/enderman.png', 0, 16, 8, 8, 8);
  packedEntityCube('enderman_original_body', 'pig_tail', 'enderman/enderman.png', 32, 16, 8, 12, 4);
  packedEntityCube('enderman_original_limb', 'cow_ear', 'enderman/enderman.png', 56, 0, 2, 30, 2);
  packedEntityCube('enderman_original_eyes', 'cow_horn', 'enderman/enderman_eyes.png', 0, 0, 8, 8, 8);

  entityCrop('blaze_face', 'blaze.png', [8, 8, 8, 8]);
  entityCrop('blaze', 'blaze.png', [8, 8, 8, 8]);
  entityCrop('blaze_rod_mob', 'blaze.png', [2, 18, 2, 8]);
  packedEntityCube('blaze_original_head', 'blaze', 'blaze.png', 0, 0, 8, 8, 8);
  packedEntityCube('blaze_original_rod', 'blaze_rod_mob', 'blaze.png', 0, 16, 2, 8, 2);

  packedEntityCube('dragon_original_body', 'dragon_body', 'enderdragon/dragon.png', 0, 0, 24, 24, 64);
  packedEntityCube('dragon_original_body_scale', 'dragon_face', 'enderdragon/dragon.png', 220, 53, 2, 6, 12);
  packedEntityCube('dragon_original_spine', 'dragon_wing', 'enderdragon/dragon.png', 192, 104, 10, 10, 10);
  packedEntityCube('dragon_original_spine_scale', 'blaze_face', 'enderdragon/dragon.png', 48, 0, 2, 4, 6);
  packedEntityCube('dragon_original_upper_head', 'cow_udder', 'enderdragon/dragon.png', 112, 30, 16, 16, 16);
  packedEntityCube('dragon_original_upper_lip', 'cow_tail', 'enderdragon/dragon.png', 176, 44, 12, 5, 16);
  packedEntityCube('dragon_original_jaw', 'sheep_wool_cap', 'enderdragon/dragon.png', 176, 65, 12, 4, 16);
  packedEntityCube('dragon_original_head_scale', 'sheep_ear', 'enderdragon/dragon.png', 0, 0, 2, 4, 6);
  packedEntityCube('dragon_original_nostril', 'sheep_tail', 'enderdragon/dragon.png', 112, 0, 2, 2, 4);
  packedEntityCube('dragon_original_eyes', 'chicken_beak', 'enderdragon/dragon_eyes.png', 112, 30, 16, 16, 16);
  packedEntityCube('dragon_original_wing_bone', 'chicken_wattle', 'enderdragon/dragon.png', 112, 88, 56, 8, 8);
  packedEntityCrop('dragon_original_wing_skin', 'enderdragon/dragon.png', [0, 88, 56, 56], 'chicken_leg', PACKED_FACE_CELLS.front);
  packedEntityCube('dragon_original_wing_tip_bone', 'wolf', 'enderdragon/dragon.png', 112, 136, 56, 4, 4);
  packedEntityCrop('dragon_original_wing_tip_skin', 'enderdragon/dragon.png', [0, 144, 56, 56], 'wolf_face', PACKED_FACE_CELLS.front);
  packedEntityCube('dragon_original_front_leg', 'cat_face', 'enderdragon/dragon.png', 112, 104, 8, 24, 8);
  packedEntityCube('dragon_original_front_leg_tip', 'horse', 'enderdragon/dragon.png', 226, 138, 6, 24, 6);
  packedEntityCube('dragon_original_front_foot', 'horse_face', 'enderdragon/dragon.png', 144, 104, 8, 4, 16);
  packedEntityCube('dragon_original_rear_leg', 'horse_tail', 'enderdragon/dragon.png', 0, 0, 16, 32, 16);
  packedEntityCube('dragon_original_rear_leg_tip', 'horse_mane', 'enderdragon/dragon.png', 196, 0, 12, 32, 12);
  packedEntityCube('dragon_original_rear_foot', 'zombie_face', 'enderdragon/dragon.png', 112, 0, 18, 6, 24);

  entityCrop('villager_face', 'villager/villager.png', [8, 8, 8, 10]);
  entityCrop('villager_skin', 'villager/villager.png', [8, 8, 8, 10]);
  entityCrop('villager_robe', 'villager/villager.png', [22, 26, 8, 12]);
  entityCrop('villager_farmer', 'villager/farmer.png', [22, 26, 8, 12]);
  entityCrop('villager_librarian', 'villager/librarian.png', [22, 26, 8, 12]);
  entityCrop('villager_toolsmith', 'villager/smith.png', [22, 26, 8, 12]);
  entityCrop('villager_butcher', 'villager/butcher.png', [22, 26, 8, 12]);
  entityCrop('villager_cleric', 'villager/priest.png', [22, 26, 8, 12]);

  entityCrop('iron_golem_face', 'iron_golem.png', [8, 8, 8, 10]);
  entityCrop('iron_golem', 'iron_golem.png', [11, 51, 18, 12]);

  const villagerSheets = {
    unemployed: 'villager/villager.png',
    farmer: 'villager/farmer.png',
    librarian: 'villager/librarian.png',
    toolsmith: 'villager/smith.png',
    butcher: 'villager/butcher.png',
    cleric: 'villager/priest.png',
  };
  for (const [profession, file] of Object.entries(villagerSheets)) {
    const prefix = 'villager_original_' + profession;
    entityCube(prefix + '_head', file, 0, 0, 8, 10, 8);
    entityCube(prefix + '_nose', file, 24, 0, 2, 4, 2);
    entityCube(prefix + '_body', file, 16, 20, 8, 12, 6);
    entityCube(prefix + '_robe', file, 0, 38, 8, 18, 6);
    entityCube(prefix + '_arms', file, 44, 22, 8, 4, 4);
    entityCube(prefix + '_leg', file, 0, 22, 4, 12, 4);
  }

  entityCube('iron_golem_original_head', 'iron_golem.png', 0, 0, 8, 10, 8);
  entityCube('iron_golem_original_nose', 'iron_golem.png', 24, 0, 2, 4, 2);
  entityCube('iron_golem_original_body', 'iron_golem.png', 0, 40, 18, 12, 11);
  entityCube('iron_golem_original_waist', 'iron_golem.png', 0, 70, 9, 5, 6);
  entityCube('iron_golem_original_leg_left', 'iron_golem.png', 37, 0, 6, 16, 5);
  entityCube('iron_golem_original_leg_right', 'iron_golem.png', 60, 0, 6, 16, 5);
  entityCube('iron_golem_original_arm_right', 'iron_golem.png', 60, 21, 4, 30, 6);
  entityCube('iron_golem_original_arm_left', 'iron_golem.png', 60, 58, 4, 30, 6);

  Textures.registerPack('original_1_12', {
    name: 'Minecraft 1.12.2 原版材质',
    entries,
  });
})();
