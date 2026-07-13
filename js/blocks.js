/* blocks.js — block & item registry, recipes, smelting, fuel, loot, food */
'use strict';
(function () {
  const B = {};           // id -> block def
  const ITEMS = {};       // id -> item def (includes blocks; blocks are placeable items)

  // ---- Block ids (see SPEC) ----
  const ID = {
    AIR: 0, STONE: 1, GRASS: 2, DIRT: 3, COBBLE: 4, PLANKS: 5, SAPLING: 6,
    BEDROCK: 7, WATER: 8, LAVA: 9, SAND: 10, GRAVEL: 11, GOLD_ORE: 12,
    IRON_ORE: 13, COAL_ORE: 14, LOG: 15, LEAVES: 16, GLASS: 17, TALLGRASS: 18,
    FLOWER_RED: 19, FLOWER_YELLOW: 20, TORCH: 21, CRAFTING: 22, FURNACE: 23,
    FURNACE_LIT: 24, CHEST: 25, TNT: 26, BOOKSHELF: 27, MOSSY: 28, BRICKS: 29,
    STONE_BRICKS: 30, SNOW: 31, GRASS_SNOW: 32, SANDSTONE: 33, SPRUCE_LOG: 34,
    LEAVES_SPRUCE: 35, CACTUS: 36, GLOWSTONE: 37, WOOL: 38, BED: 39,
    DIAMOND_ORE: 40, PLANK_SLAB: 41, STONE_SLAB: 42, FARMLAND: 43,
    WHEAT_CROP: 44, CARROT_CROP: 45, POTATO_CROP: 46, FIRE: 47,
    LAPIS_ORE: 48, ENCHANTING_TABLE: 49, ANVIL: 50, SUGAR_CANE: 51,
    CLAY: 52, OBSIDIAN: 53, IRON_BLOCK: 54, LADDER: 55, COBWEB: 56,
    SOUL_SAND: 57, OAK_STAIRS: 58, OAK_FENCE: 59, LEVER: 60,
    REDSTONE_LAMP: 61, REDSTONE_LAMP_LIT: 62,
    OAK_DOOR: 63, OAK_DOOR_TOP: 64, OAK_TRAPDOOR: 65, OAK_FENCE_GATE: 66,
    STONE_BUTTON: 67, STONE_PRESSURE_PLATE: 68, OAK_SIGN: 69, SNOW_LAYER: 70,
    PLANK_DOUBLE_SLAB: 71, STONE_DOUBLE_SLAB: 72, REDSTONE_WIRE: 73,
    REDSTONE_TORCH: 74, REDSTONE_TORCH_OFF: 75, REPEATER: 76, REPEATER_LIT: 77,
    PISTON: 78, PISTON_HEAD: 79, NETHERRACK: 80, NETHER_BRICKS: 81,
    NETHER_PORTAL: 82, END_STONE: 83, END_PORTAL_FRAME: 84, END_PORTAL: 85,
    BREWING_STAND: 86, IRON_DOOR: 87, IRON_DOOR_TOP: 88, IRON_TRAPDOOR: 89,
    DRAGON_EGG: 90, BELL: 91, COMPOSTER: 92, LECTERN: 93,
    GRINDSTONE: 94, SMITHING_TABLE: 95, SMOKER: 96,
  };
  const IT = {
    STICK: 256, COAL: 257, CHARCOAL: 258, IRON_INGOT: 259, GOLD_INGOT: 260,
    DIAMOND: 261, APPLE: 262, PORK_RAW: 263, PORK_COOKED: 264, BEEF_RAW: 265,
    BEEF_COOKED: 266, MUTTON_RAW: 267, MUTTON_COOKED: 268, FLESH: 269,
    GUNPOWDER: 270, SHEARS: 271, FLINT: 272, LEATHER: 273, STRING: 274,
    FEATHER: 275, BONE: 276, BONE_MEAL: 277, EGG: 278, WHEAT_SEEDS: 279,
    // tools 280..299
    PICK_WOOD: 280, PICK_STONE: 281, PICK_IRON: 282, PICK_GOLD: 283, PICK_DIAMOND: 284,
    AXE_WOOD: 285, AXE_STONE: 286, AXE_IRON: 287, AXE_GOLD: 288, AXE_DIAMOND: 289,
    SHOVEL_WOOD: 290, SHOVEL_STONE: 291, SHOVEL_IRON: 292, SHOVEL_GOLD: 293, SHOVEL_DIAMOND: 294,
    SWORD_WOOD: 295, SWORD_STONE: 296, SWORD_IRON: 297, SWORD_GOLD: 298, SWORD_DIAMOND: 299,
    WHEAT: 300, BREAD: 301, CARROT: 302, POTATO: 303, BAKED_POTATO: 304,
    CHICKEN_RAW: 305, CHICKEN_COOKED: 306, FISH_RAW: 307, FISH_COOKED: 308,
    GOLDEN_APPLE: 309, PAPER: 310, BOOK: 311, CLAY_BALL: 312, BRICK: 313,
    GLOWSTONE_DUST: 314, LAPIS: 315, BUCKET: 316, WATER_BUCKET: 317,
    LAVA_BUCKET: 318, FLINT_STEEL: 319, BOW: 320, ARROW: 321,
    FISHING_ROD: 322, REDSTONE: 323, ENDER_PEARL: 324, BLAZE_ROD: 325,
    BLAZE_POWDER: 326, EYE_OF_ENDER: 327, EMERALD: 328, SLIME_BALL: 329,
    NETHER_WART: 330, GLASS_BOTTLE: 331,
    WATER_BOTTLE: 332, AWKWARD_POTION: 333, HEALING_POTION: 334,
    HELMET_LEATHER: 340, CHEST_LEATHER: 341, LEGS_LEATHER: 342, BOOTS_LEATHER: 343,
    HELMET_GOLD: 344, CHEST_GOLD: 345, LEGS_GOLD: 346, BOOTS_GOLD: 347,
    HELMET_IRON: 348, CHEST_IRON: 349, LEGS_IRON: 350, BOOTS_IRON: 351,
    HELMET_DIAMOND: 352, CHEST_DIAMOND: 353, LEGS_DIAMOND: 354, BOOTS_DIAMOND: 355,
    HOE_WOOD: 360, HOE_STONE: 361, HOE_IRON: 362, HOE_GOLD: 363, HOE_DIAMOND: 364,
  };

  // Vanilla 1.12.2 handheld models use a 0.68 first-person scale and a 25 degree
  // display turn. Runtime Y includes the right-hand renderer's 45 degree basis.
  const VANILLA_HANDHELD_ROT = Object.freeze([-0.08, -0.30, 0.92]);
  const VANILLA_SWORD_ROT = Object.freeze([0, -Math.PI / 4, 25 * Math.PI / 180]);
  const VANILLA_BLOCK_GROUND_SCALE = 0.25 / 0.28;
  const VANILLA_ITEM_GROUND_SCALE = 0.50 / 0.44;
  const DISPLAY_PRESETS = Object.freeze({
    block: {
      firstPerson: { pos: [0.56, -0.57, -0.94], rot: [0.06, 0.78, 0], scale: 0.40, grip: [0, 0, 0] },
      thirdPerson: { offset: [0, 0.18, -0.02], rotation: [1.31, 0.79, 0], scale: 0.375 / 2, grip: [0, 0, 0], model: 'block' },
      ground: { scale: VANILLA_BLOCK_GROUND_SCALE }, inventory: { scale: 0.625, rotation: [0, 0, 0] },
    },
    item: {
      firstPerson: { pos: [0.50, -0.50, -0.82], rot: [0, 0, 0], scale: 0.68, grip: [0, -0.22, 0] },
      thirdPerson: { offset: [0, 0.19, -0.025], rotation: [0, 0, 0.02], scale: 0.55 / 2, model: 'sprite' },
      ground: { scale: VANILLA_ITEM_GROUND_SCALE }, inventory: { scale: 1, rotation: [0, 0, 0] },
    },
    tool: {
      firstPerson: { attach: 'hand', pos: [0.55, -0.54, -0.90], rot: VANILLA_HANDHELD_ROT, scale: 0.68, grip: [-0.28, -0.34, 0] },
      thirdPerson: { offset: [0, 0.21, 0.01], rotation: [0.04, 0.12, -0.68], scale: 0.85 / 2, grip: [-0.04, -0.32, 0], model: 'sprite' },
      ground: { scale: VANILLA_ITEM_GROUND_SCALE }, inventory: { scale: 1, rotation: [0, 0, 0] },
    },
    sword: {
      firstPerson: { attach: 'hand', pos: [0.56, -0.54, -0.88], rot: VANILLA_SWORD_ROT, scale: 0.68, grip: [-0.28, -0.28, 0] },
      thirdPerson: { offset: [0, 0.21, 0.01], rotation: [0.04, 0.10, -0.68], scale: 0.85 / 2, grip: [-0.02, -0.34, 0], model: 'sprite' },
      ground: { scale: VANILLA_ITEM_GROUND_SCALE }, inventory: { scale: 1, rotation: [0, 0, 0] },
    },
    bow: {
      firstPerson: { attach: 'hand', pos: [0.52, -0.48, -0.78], rot: VANILLA_HANDHELD_ROT, scale: 0.68, grip: [-0.28, -0.09, 0] },
      thirdPerson: { offset: [0, 0.19, -0.025], rotation: [0, 0, 0.08], scale: 0.55 / 2, model: 'sprite' },
      ground: { scale: VANILLA_ITEM_GROUND_SCALE }, inventory: { scale: 1, rotation: [0, 0, 0] },
    },
    food: {
      firstPerson: { pos: [0.50, -0.50, -0.82], rot: [0, 0, 0], scale: 0.68, grip: [0, -0.22, 0] },
      thirdPerson: { offset: [0, 0.19, -0.025], rotation: [0, 0, -0.18], scale: 0.55 / 2, model: 'sprite' },
      ground: { scale: VANILLA_ITEM_GROUND_SCALE }, inventory: { scale: 1, rotation: [0, 0, 0] },
    },
    torch: {
      firstPerson: { attach: 'hand', pos: [0.54, -0.52, -0.82], rot: [-0.08, 0.20, 0.52], scale: 0.68, grip: [0, -0.38, 0] },
      thirdPerson: { offset: [0, 0.19, -0.025], rotation: [0, 0, -0.10], scale: 0.55 / 2, model: 'sprite' },
      ground: { scale: VANILLA_ITEM_GROUND_SCALE }, inventory: { scale: 1, rotation: [0, 0, 0] },
    },
  });

  // def(id, name, opts)
  function def(id, name, o) {
    o = o || {};
    const tex = o.tex || {};
    B[id] = {
      id, name,
      shape: o.shape || 'cube',              // cube|cross|torch|cactus|liquid|bed|slab|ladder
      solid: o.solid !== false && o.shape !== 'cross' && o.shape !== 'torch' && o.shape !== 'liquid',
      opaque: o.opaque !== undefined ? o.opaque : (o.shape || 'cube') === 'cube' && !o.transparent,
      opacity: o.opacity !== undefined ? o.opacity : ((o.shape || 'cube') === 'cube' && !o.transparent ? 15 : 0),
      transparent: !!o.transparent,          // uses alpha / cutout rendering
      cutout: !!o.cutout,
      liquid: o.shape === 'liquid',
      tex,                                   // {all} or {top,bottom,side,front}
      hardness: o.hardness !== undefined ? o.hardness : 1,   // -1 unbreakable
      tool: o.tool || null,                  // pickaxe|axe|shovel
      tier: o.tier || 0,                     // min tier for drops
      needsTool: !!o.needsTool,              // no drop without correct tool of tier
      drops: o.drops,                        // undefined => itself; [] => nothing; [{id,n,chance}]
      light: o.light || 0,
      sound: o.sound || 'stone',
      soundSet: o.soundSet || o.sound || 'stone',
      replaceable: !!o.replaceable,
      needsGround: !!o.needsGround,          // must sit on solid/dirt-family
      needsWall: !!o.needsWall,
      placement: o.placement || (o.needsWall ? 'wall' : (o.orientable ? 'horizontal' : 'none')),
      support: o.support || (o.needsGround ? 'ground' : (o.needsWall ? 'wall' : 'none')),
      gravity: !!o.gravity,                  // sand/gravel fall
      flammable: !!o.flammable,
      speedFactor: o.speedFactor === undefined ? 1 : o.speedFactor,
      collision: o.collision || null,        // local AABB {x,y,z,w,h,d}; null => full cube
      collisionBoxes: o.collisionBoxes || null,
      modelBoxes: o.modelBoxes || null,
      itemModelBoxes: o.itemModelBoxes || null,
      modelElements: o.modelElements || null,
      orientable: !!o.orientable,
      stateFamily: o.stateFamily || null,
      stateTextures: o.stateTextures || null,
      dropFn: o.dropFn || null,
      poi: o.poi || null,
    };
    if (!o.noItem) {
      const spriteItem = o.handModel === 'sprite' || B[id].shape === 'cross' ||
        B[id].shape === 'torch' || B[id].shape === 'ladder';
      const display = o.display || (id === ID.TORCH ? DISPLAY_PRESETS.torch :
        (spriteItem ? DISPLAY_PRESETS.item : DISPLAY_PRESETS.block));
      ITEMS[id] = {
        id, name, stack: 64, block: true, tex: tex.icon || null,
        handModel: spriteItem ? 'sprite' : (o.handModel || null),
        handPose: o.handPose || display.firstPerson,
        display,
      };
    }
  }

  const T = (all) => ({ all });
  const TORCH_HAND_POSE = DISPLAY_PRESETS.torch.firstPerson;
  const STAIR_BOXES = [
    [{ x: 0, y: 0, z: 0, w: 1, h: 0.5, d: 1 }, { x: 0, y: 0.5, z: 0, w: 1, h: 0.5, d: 0.5 }],
    [{ x: 0, y: 0, z: 0, w: 1, h: 0.5, d: 1 }, { x: 0.5, y: 0.5, z: 0, w: 0.5, h: 0.5, d: 1 }],
    [{ x: 0, y: 0, z: 0, w: 1, h: 0.5, d: 1 }, { x: 0, y: 0.5, z: 0.5, w: 1, h: 0.5, d: 0.5 }],
    [{ x: 0, y: 0, z: 0, w: 1, h: 0.5, d: 1 }, { x: 0, y: 0.5, z: 0, w: 0.5, h: 0.5, d: 1 }],
  ];
  const stairBoxes = (world, x, y, z, state) => STAIR_BOXES[state & 3];
  const fenceBoxes = (world, x, y, z) => {
    const boxes = [{ x: 6 / 16, y: 0, z: 6 / 16, w: 4 / 16, h: 1.5, d: 4 / 16 }];
    const connects = (nx, nz) => {
      const id = world.getBlock(nx, y, nz);
      return id === ID.OAK_FENCE || (B[id] || B[0]).solid;
    };
    if (connects(x - 1, z)) boxes.push({ x: 0, y: 6 / 16, z: 7 / 16, w: 0.5, h: 12 / 16, d: 2 / 16 });
    if (connects(x + 1, z)) boxes.push({ x: 0.5, y: 6 / 16, z: 7 / 16, w: 0.5, h: 12 / 16, d: 2 / 16 });
    if (connects(x, z - 1)) boxes.push({ x: 7 / 16, y: 6 / 16, z: 0, w: 2 / 16, h: 12 / 16, d: 0.5 });
    if (connects(x, z + 1)) boxes.push({ x: 7 / 16, y: 6 / 16, z: 0.5, w: 2 / 16, h: 12 / 16, d: 0.5 });
    return boxes;
  };
  const thinFacingBox = (facing, thickness, height) => {
    const t = thickness === undefined ? 3 / 16 : thickness;
    const h = height === undefined ? 1 : height;
    switch (facing & 3) {
      case 0: return { x: 0, y: 0, z: 0, w: 1, h, d: t };
      case 1: return { x: 1 - t, y: 0, z: 0, w: t, h, d: 1 };
      case 2: return { x: 0, y: 0, z: 1 - t, w: 1, h, d: t };
      default: return { x: 0, y: 0, z: 0, w: t, h, d: 1 };
    }
  };
  const doorPanelFacing = state => {
    const facing = state & 3;
    if (!(state & 4)) return facing;
    return (facing + ((state & 8) ? 3 : 1)) & 3;
  };
  const doorBoxes = (world, x, y, z, state) => [thinFacingBox(doorPanelFacing(state), 3 / 16, 1)];
  const trapdoorBoxes = (world, x, y, z, state) => {
    if (state & 4) return [thinFacingBox(state & 3, 3 / 16, 1)];
    return [{ x: 0, y: 0, z: 0, w: 1, h: 3 / 16, d: 1 }];
  };
  const gateBoxes = (world, x, y, z, state) => {
    if (state & 4) return [];
    return (state & 1)
      ? [{ x: 7 / 16, y: 0, z: 0, w: 2 / 16, h: 1.5, d: 1 }]
      : [{ x: 0, y: 0, z: 7 / 16, w: 1, h: 1.5, d: 2 / 16 }];
  };
  const gateModelBoxes = (world, x, y, z, state) => {
    const alongX = !(state & 1);
    const posts = alongX
      ? [{ x: 0, y: 0, z: 6 / 16, w: 2 / 16, h: 1.5, d: 4 / 16 }, { x: 14 / 16, y: 0, z: 6 / 16, w: 2 / 16, h: 1.5, d: 4 / 16 }]
      : [{ x: 6 / 16, y: 0, z: 0, w: 4 / 16, h: 1.5, d: 2 / 16 }, { x: 6 / 16, y: 0, z: 14 / 16, w: 4 / 16, h: 1.5, d: 2 / 16 }];
    if (!(state & 4)) return posts.concat(alongX
      ? [{ x: 2 / 16, y: 6 / 16, z: 7 / 16, w: 12 / 16, h: 8 / 16, d: 2 / 16 }]
      : [{ x: 7 / 16, y: 6 / 16, z: 2 / 16, w: 2 / 16, h: 8 / 16, d: 12 / 16 }]);
    return posts.concat(alongX
      ? [{ x: 1 / 16, y: 6 / 16, z: 2 / 16, w: 2 / 16, h: 8 / 16, d: 5 / 16 }, { x: 13 / 16, y: 6 / 16, z: 9 / 16, w: 2 / 16, h: 8 / 16, d: 5 / 16 }]
      : [{ x: 2 / 16, y: 6 / 16, z: 1 / 16, w: 5 / 16, h: 8 / 16, d: 2 / 16 }, { x: 9 / 16, y: 6 / 16, z: 13 / 16, w: 5 / 16, h: 8 / 16, d: 2 / 16 }]);
  };
  const signBoxes = (world, x, y, z, state) => {
    const facing = state & 3;
    const wallMounted = !!(state & 4);
    if (wallMounted) {
      const board = thinFacingBox((facing + 2) & 3, 2 / 16, 9 / 16);
      board.y = 4 / 16;
      board.tile = 'oak_sign';
      return [board];
    }
    const board = (facing & 1)
      ? { x: 7 / 16, y: 7 / 16, z: 0, w: 2 / 16, h: 9 / 16, d: 1, tile: 'oak_sign' }
      : { x: 0, y: 7 / 16, z: 7 / 16, w: 1, h: 9 / 16, d: 2 / 16, tile: 'oak_sign' };
    return [
      board,
      { x: 7 / 16, y: 0, z: 7 / 16, w: 2 / 16, h: 8 / 16, d: 2 / 16, tile: 'planks' },
    ];
  };
  const torchPose = (state) => {
    const directions = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
    const normalizedState = U.clamp(state | 0, 0, 4);
    const direction = directions[normalizedState];
    if (normalizedState === 0) return { wall: false, direction, bottom: [0.5, 0, 0.5], top: [0.5, 10 / 16, 0.5], half: 1 / 16 };
    const length = 10 / 16;
    const horizontal = Math.sin(Math.PI / 8) * length;
    const vertical = Math.cos(Math.PI / 8) * length;
    const bottom = [0.5 - direction[0] * 0.4, 3 / 16, 0.5 - direction[1] * 0.4];
    return {
      wall: true, direction, bottom,
      top: [bottom[0] + direction[0] * horizontal, bottom[1] + vertical, bottom[2] + direction[1] * horizontal],
      half: 1 / 16,
    };
  };
  const torchBoxes = (world, x, y, z, state) => {
    const pose = torchPose(state);
    const half = pose.half;
    const x0 = Math.max(0, Math.min(pose.bottom[0], pose.top[0]) - half);
    const y0 = Math.max(0, Math.min(pose.bottom[1], pose.top[1]) - half);
    const z0 = Math.max(0, Math.min(pose.bottom[2], pose.top[2]) - half);
    const x1 = Math.min(1, Math.max(pose.bottom[0], pose.top[0]) + half);
    const y1 = Math.min(1, Math.max(pose.bottom[1], pose.top[1]) + half);
    const z1 = Math.min(1, Math.max(pose.bottom[2], pose.top[2]) + half);
    return [{ x: x0, y: y0, z: z0, w: x1 - x0, h: y1 - y0, d: z1 - z0 }];
  };
  const snowLayerBoxes = (world, x, y, z, state) => [
    { x: 0, y: 0, z: 0, w: 1, h: (U.clamp(state | 0, 0, 7) + 1) / 8, d: 1 },
  ];
  const repeaterBoxes = [
    { x: 0, y: 0, z: 0, w: 1, h: 2 / 16, d: 1 },
    { x: 4 / 16, y: 2 / 16, z: 5 / 16, w: 2 / 16, h: 5 / 16, d: 2 / 16 },
    { x: 10 / 16, y: 2 / 16, z: 9 / 16, w: 2 / 16, h: 5 / 16, d: 2 / 16 },
  ];
  const leverElements = (world, x, y, z, state) => [
    { from: [4, 0, 5], to: [12, 3, 11], texture: 'stone' },
    {
      from: [7, 3, 7], to: [9, 13, 9], texture: 'lever',
      rotation: { axis: 'z', angle: state ? -45 : 45, origin: [8, 3, 8] },
    },
  ];

  def(ID.STONE, '石头', { tex: T('stone'), hardness: 1.5, tool: 'pickaxe', needsTool: true, drops: [{ id: ID.COBBLE, n: 1 }] });
  def(ID.GRASS, '草方块', { tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, hardness: 0.6, tool: 'shovel', sound: 'grass', drops: [{ id: ID.DIRT, n: 1 }] });
  def(ID.DIRT, '泥土', { tex: T('dirt'), hardness: 0.5, tool: 'shovel', sound: 'grass' });
  def(ID.COBBLE, '圆石', { tex: T('cobblestone'), hardness: 2, tool: 'pickaxe', needsTool: true });
  def(ID.PLANKS, '木板', { tex: T('planks'), hardness: 2, tool: 'axe', sound: 'wood', flammable: true });
  def(ID.SAPLING, '树苗', {
    shape: 'cross', tex: T('sapling'), hardness: 0, cutout: true, transparent: true,
    sound: 'grass', needsGround: true, replaceable: false, handModel: 'sprite', display: DISPLAY_PRESETS.item,
  });
  def(ID.BEDROCK, '基岩', { tex: T('bedrock'), hardness: -1 });
  def(ID.WATER, '水', { shape: 'liquid', tex: T('water'), hardness: -1, transparent: true, opacity: 2, sound: 'stone', replaceable: true, noItem: false });
  def(ID.LAVA, '岩浆', { shape: 'liquid', tex: T('lava'), hardness: -1, light: 15, opacity: 15, sound: 'stone', replaceable: true });
  def(ID.SAND, '沙子', { tex: T('sand'), hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true });
  def(ID.GRAVEL, '沙砾', {
    tex: T('gravel'), hardness: 0.6, tool: 'shovel', sound: 'sand', gravity: true,
    dropFn: (state, random) => random() < 0.1 ? [{ id: IT.FLINT, n: 1 }] : [{ id: ID.GRAVEL, n: 1 }],
  });
  def(ID.GOLD_ORE, '金矿石', { tex: T('gold_ore'), hardness: 3, tool: 'pickaxe', tier: 2, needsTool: true });
  def(ID.IRON_ORE, '铁矿石', { tex: T('iron_ore'), hardness: 3, tool: 'pickaxe', tier: 1, needsTool: true });
  def(ID.COAL_ORE, '煤矿石', { tex: T('coal_ore'), hardness: 3, tool: 'pickaxe', needsTool: true, drops: [{ id: IT.COAL, n: 1 }] });
  def(ID.LOG, '橡木原木', { tex: { top: 'log_top', bottom: 'log_top', side: 'log_side' }, hardness: 2, tool: 'axe', sound: 'wood', flammable: true });
  def(ID.LEAVES, '橡树树叶', { tex: T('leaves'), hardness: 0.2, cutout: true, transparent: true, opacity: 1, sound: 'grass', flammable: true, drops: [{ id: ID.SAPLING, n: 1, chance: 0.06 }, { id: IT.APPLE, n: 1, chance: 0.04 }] });
  def(ID.GLASS, '玻璃', { tex: T('glass'), hardness: 0.3, transparent: true, cutout: true, sound: 'glass', drops: [] });
  def(ID.TALLGRASS, '草', {
    shape: 'cross', tex: T('tallgrass'), hardness: 0, cutout: true, transparent: true,
    sound: 'grass', needsGround: true, replaceable: true,
    drops: [{ id: IT.WHEAT_SEEDS, n: 1, chance: 0.125 }],
  });
  def(ID.FLOWER_RED, '玫瑰', { shape: 'cross', tex: T('flower_red'), hardness: 0, cutout: true, transparent: true, sound: 'grass', needsGround: true });
  def(ID.FLOWER_YELLOW, '蒲公英', { shape: 'cross', tex: T('flower_yellow'), hardness: 0, cutout: true, transparent: true, sound: 'grass', needsGround: true });
  def(ID.TORCH, '火把', {
    shape: 'torch', tex: T('torch'), hardness: 0, cutout: true, transparent: true,
    light: 14, sound: 'wood', orientable: true, stateFamily: 'torch',
    placement: 'floor_or_wall', support: 'torch',
    modelBoxes: torchBoxes, handModel: 'sprite', handPose: TORCH_HAND_POSE,
  });
  def(ID.CRAFTING, '工作台', { tex: { top: 'crafting_table_top', bottom: 'planks', side: 'crafting_table_side', front: 'crafting_table_front' }, hardness: 2.5, tool: 'axe', sound: 'wood', flammable: true, orientable: true });
  def(ID.FURNACE, '熔炉', { tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }, hardness: 3.5, tool: 'pickaxe', needsTool: true, orientable: true, stateFamily: 'furnace' });
  def(ID.FURNACE_LIT, '燃烧的熔炉', { tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front_lit' }, hardness: 3.5, tool: 'pickaxe', needsTool: true, light: 13, drops: [{ id: ID.FURNACE, n: 1 }], noItem: true, orientable: true, stateFamily: 'furnace' });
  def(ID.CHEST, '箱子', { tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' }, hardness: 2.5, tool: 'axe', sound: 'wood', flammable: true, orientable: true });
  def(ID.TNT, 'TNT', { tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, hardness: 0, sound: 'grass' });
  def(ID.BOOKSHELF, '书架', { tex: { top: 'planks', bottom: 'planks', side: 'bookshelf' }, hardness: 1.5, tool: 'axe', sound: 'wood', flammable: true });
  def(ID.MOSSY, '苔石', { tex: T('mossy_cobblestone'), hardness: 2, tool: 'pickaxe', needsTool: true });
  def(ID.BRICKS, '砖块', { tex: T('bricks'), hardness: 2, tool: 'pickaxe', needsTool: true });
  def(ID.STONE_BRICKS, '石砖', { tex: T('stone_bricks'), hardness: 1.5, tool: 'pickaxe', needsTool: true });
  def(ID.SNOW, '雪块', { tex: T('snow'), hardness: 0.2, tool: 'shovel', sound: 'snow' });
  def(ID.GRASS_SNOW, '积雪草方块', { tex: { top: 'snow', bottom: 'dirt', side: 'grass_side_snow' }, hardness: 0.6, tool: 'shovel', sound: 'grass', drops: [{ id: ID.DIRT, n: 1 }], noItem: true });
  def(ID.SANDSTONE, '砂岩', { tex: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone_side' }, hardness: 0.8, tool: 'pickaxe', needsTool: true });
  def(ID.SPRUCE_LOG, '云杉原木', { tex: { top: 'log_top', bottom: 'log_top', side: 'spruce_log_side' }, hardness: 2, tool: 'axe', sound: 'wood', flammable: true });
  def(ID.LEAVES_SPRUCE, '云杉树叶', { tex: T('leaves_spruce'), hardness: 0.2, cutout: true, transparent: true, opacity: 1, sound: 'grass', flammable: true, drops: [{ id: ID.SAPLING, n: 1, chance: 0.06 }] });
  def(ID.CACTUS, '仙人掌', { shape: 'cactus', tex: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' }, hardness: 0.4, sound: 'wood', transparent: true, needsGround: true, collision: { x: 1 / 16, y: 0, z: 1 / 16, w: 14 / 16, h: 1, d: 14 / 16 } });
  def(ID.GLOWSTONE, '萤石', { tex: T('glowstone'), hardness: 0.3, light: 15, sound: 'glass', drops: [{ id: IT.GLOWSTONE_DUST, n: 4 }] });
  def(ID.WOOL, '羊毛', { tex: T('wool_white'), hardness: 0.8, sound: 'grass', flammable: true });
  def(ID.BED, '床', { shape: 'bed', tex: { top: 'bed_top', bottom: 'planks', side: 'bed_side' }, hardness: 0.2, sound: 'wood', transparent: true, opacity: 0, collision: { x: 0, y: 0, z: 0, w: 1, h: 9 / 16, d: 1 }, orientable: true });
  def(ID.DIAMOND_ORE, '钻石矿石', { tex: T('diamond_ore'), hardness: 3, tool: 'pickaxe', tier: 2, needsTool: true, drops: [{ id: IT.DIAMOND, n: 1 }] });
  def(ID.PLANK_SLAB, '橡木半砖', { shape: 'slab', tex: T('planks'), hardness: 2, tool: 'axe', sound: 'wood', flammable: true, collision: { x: 0, y: 0, z: 0, w: 1, h: 0.5, d: 1 } });
  def(ID.STONE_SLAB, '石半砖', { shape: 'slab', tex: T('stone'), hardness: 2, tool: 'pickaxe', needsTool: true, collision: { x: 0, y: 0, z: 0, w: 1, h: 0.5, d: 1 } });
  def(ID.FARMLAND, '耕地', {
    shape: 'slab', tex: { top: 'farmland_top', bottom: 'dirt', side: 'dirt' },
    hardness: 0.6, tool: 'shovel', sound: 'grass', drops: [{ id: ID.DIRT, n: 1 }],
    collision: { x: 0, y: 0, z: 0, w: 1, h: 15 / 16, d: 1 }, stateFamily: 'farmland', noItem: true,
  });
  def(ID.WHEAT_CROP, '小麦作物', {
    shape: 'cross', tex: T('wheat_0'), stateTextures: ['wheat_0', 'wheat_0', 'wheat_1', 'wheat_1', 'wheat_2', 'wheat_2', 'wheat_3', 'wheat_3'],
    hardness: 0, cutout: true, transparent: true, sound: 'grass', needsGround: true, noItem: true, stateFamily: 'crop',
    dropFn: (state, random) => state >= 7
      ? [{ id: IT.WHEAT, n: 1 }, { id: IT.WHEAT_SEEDS, n: 1 + Math.floor(random() * 3) }]
      : [{ id: IT.WHEAT_SEEDS, n: 1 }],
  });
  def(ID.CARROT_CROP, '胡萝卜作物', {
    shape: 'cross', tex: T('carrot_0'), stateTextures: ['carrot_0', 'carrot_0', 'carrot_1', 'carrot_1', 'carrot_2', 'carrot_2', 'carrot_3', 'carrot_3'],
    hardness: 0, cutout: true, transparent: true, sound: 'grass', needsGround: true, noItem: true, stateFamily: 'crop',
    dropFn: (state, random) => [{ id: IT.CARROT, n: state >= 7 ? 2 + Math.floor(random() * 3) : 1 }],
  });
  def(ID.POTATO_CROP, '马铃薯作物', {
    shape: 'cross', tex: T('potato_0'), stateTextures: ['potato_0', 'potato_0', 'potato_1', 'potato_1', 'potato_2', 'potato_2', 'potato_3', 'potato_3'],
    hardness: 0, cutout: true, transparent: true, sound: 'grass', needsGround: true, noItem: true, stateFamily: 'crop',
    dropFn: (state, random) => [{ id: IT.POTATO, n: state >= 7 ? 2 + Math.floor(random() * 3) : 1 }],
  });
  def(ID.FIRE, '火', {
    shape: 'cross', tex: T('fire'), hardness: 0, cutout: true, transparent: true, light: 15,
    sound: 'grass', needsGround: true, replaceable: true, drops: [], noItem: true, stateFamily: 'fire',
  });
  def(ID.LAPIS_ORE, '青金石矿石', {
    tex: T('lapis_ore'), hardness: 3, tool: 'pickaxe', tier: 1, needsTool: true,
    drops: [{ id: IT.LAPIS, n: 6 }],
  });
  def(ID.ENCHANTING_TABLE, '附魔台', {
    tex: { top: 'enchanting_table_top', bottom: 'obsidian', side: 'enchanting_table_side' },
    hardness: 5, tool: 'pickaxe', tier: 3, needsTool: true, light: 7,
  });
  def(ID.ANVIL, '铁砧', {
    tex: { top: 'anvil_top', bottom: 'iron_block', side: 'anvil_side', front: 'anvil_side' },
    hardness: 5, tool: 'pickaxe', tier: 1, needsTool: true, orientable: true,
  });
  def(ID.SUGAR_CANE, '甘蔗', {
    shape: 'cross', tex: T('sugar_cane'), hardness: 0, cutout: true, transparent: true,
    sound: 'grass', needsGround: true,
  });
  def(ID.CLAY, '黏土块', {
    tex: T('clay'), hardness: 0.6, tool: 'shovel', sound: 'sand', drops: [{ id: IT.CLAY_BALL, n: 4 }],
  });
  def(ID.OBSIDIAN, '黑曜石', { tex: T('obsidian'), hardness: 50, tool: 'pickaxe', tier: 3, needsTool: true });
  def(ID.IRON_BLOCK, '铁块', { tex: T('iron_block'), hardness: 5, tool: 'pickaxe', tier: 1, needsTool: true });
  def(ID.LADDER, '梯子', {
    shape: 'ladder', tex: T('ladder'), hardness: 0.4, tool: 'axe', sound: 'wood',
    solid: false, transparent: true, cutout: true, orientable: true, needsWall: true, flammable: true, handModel: 'sprite',
  });
  def(ID.COBWEB, '蜘蛛网', {
    shape: 'cross', tex: T('cobweb'), hardness: 4, sound: 'grass', transparent: true,
    cutout: true, drops: [{ id: IT.STRING, n: 1 }], handModel: 'sprite',
  });
  def(ID.SOUL_SAND, '灵魂沙', {
    shape: 'slab', tex: T('soul_sand'), hardness: 0.5, tool: 'shovel', sound: 'sand',
    collision: { x: 0, y: 0, z: 0, w: 1, h: 14 / 16, d: 1 }, speedFactor: 0.4,
  });
  def(ID.OAK_STAIRS, '橡木楼梯', {
    shape: 'stairs', tex: T('planks'), hardness: 2, tool: 'axe', sound: 'wood',
    flammable: true, orientable: true, collisionBoxes: stairBoxes,
  });
  def(ID.OAK_FENCE, '橡木栅栏', {
    shape: 'fence', tex: T('planks'), hardness: 2, tool: 'axe', sound: 'wood',
    flammable: true, collisionBoxes: fenceBoxes,
  });
  def(ID.LEVER, '拉杆', {
    shape: 'model', tex: T('lever'), hardness: 0.5, sound: 'wood', solid: false,
    transparent: true, cutout: true, needsGround: true, stateFamily: 'lever', handModel: 'sprite',
    modelElements: leverElements,
  });
  def(ID.REDSTONE_LAMP, '红石灯', { tex: T('redstone_lamp'), hardness: 0.3, sound: 'glass', stateFamily: 'redstone_lamp' });
  def(ID.REDSTONE_LAMP_LIT, '点亮的红石灯', {
    tex: T('redstone_lamp_lit'), hardness: 0.3, sound: 'glass', light: 15,
    stateFamily: 'redstone_lamp', drops: [{ id: ID.REDSTONE_LAMP, n: 1 }], noItem: true,
  });
  def(ID.OAK_DOOR, '橡木门', {
    shape: 'model', tex: { all: 'oak_door_lower', icon: 'oak_door' }, hardness: 3, tool: 'axe', sound: 'wood', flammable: true,
    transparent: true, cutout: true,
    orientable: true, needsGround: true, stateFamily: 'door', collisionBoxes: doorBoxes, modelBoxes: doorBoxes,
    handModel: 'sprite',
  });
  def(ID.OAK_DOOR_TOP, '橡木门上半部', {
    shape: 'model', tex: T('oak_door_upper'), hardness: 3, tool: 'axe', sound: 'wood', flammable: true,
    transparent: true, cutout: true,
    orientable: true, stateFamily: 'door', collisionBoxes: doorBoxes, modelBoxes: doorBoxes,
    drops: [], noItem: true,
  });
  def(ID.OAK_TRAPDOOR, '橡木活板门', {
    shape: 'model', tex: T('oak_trapdoor'), hardness: 3, tool: 'axe', sound: 'wood', flammable: true,
    orientable: true, stateFamily: 'trapdoor', collisionBoxes: trapdoorBoxes, modelBoxes: trapdoorBoxes,
  });
  def(ID.OAK_FENCE_GATE, '橡木栅栏门', {
    shape: 'model', tex: T('planks'), hardness: 2, tool: 'axe', sound: 'wood', flammable: true,
    orientable: true, stateFamily: 'fence_gate', collisionBoxes: gateBoxes, modelBoxes: gateModelBoxes,
  });
  def(ID.STONE_BUTTON, '石质按钮', {
    shape: 'model', tex: T('stone'), hardness: 0.5, sound: 'stone', solid: false,
    needsGround: true, stateFamily: 'button', modelBoxes: (world, x, y, z, state) => [
      { x: 5 / 16, y: 0, z: 6 / 16, w: 6 / 16, h: state ? 1 / 16 : 2 / 16, d: 4 / 16 },
    ],
  });
  def(ID.STONE_PRESSURE_PLATE, '石质压力板', {
    shape: 'model', tex: T('stone'), hardness: 0.5, sound: 'stone', solid: false,
    needsGround: true, stateFamily: 'pressure_plate', modelBoxes: (world, x, y, z, state) => [
      { x: 1 / 16, y: 0, z: 1 / 16, w: 14 / 16, h: state ? 1 / 32 : 1 / 16, d: 14 / 16 },
    ],
  });
  def(ID.OAK_SIGN, '橡木告示牌', {
    shape: 'model', tex: T('oak_sign'), hardness: 1, tool: 'axe', sound: 'wood', solid: false,
    orientable: true, flammable: true, stateFamily: 'sign', placement: 'sign', support: 'sign', modelBoxes: signBoxes,
    handModel: 'sprite',
  });
  def(ID.SNOW_LAYER, '雪层', {
    shape: 'model', tex: T('snow'), hardness: 0.1, tool: 'shovel', sound: 'snow', transparent: true,
    needsGround: true, stateFamily: 'snow_layer', collisionBoxes: snowLayerBoxes, modelBoxes: snowLayerBoxes,
  });
  def(ID.PLANK_DOUBLE_SLAB, '橡木双层半砖', {
    tex: T('planks'), hardness: 2, tool: 'axe', sound: 'wood', flammable: true,
    drops: [{ id: ID.PLANK_SLAB, n: 2 }], noItem: true,
  });
  def(ID.STONE_DOUBLE_SLAB, '石质双层半砖', {
    tex: T('stone'), hardness: 2, tool: 'pickaxe', needsTool: true,
    drops: [{ id: ID.STONE_SLAB, n: 2 }], noItem: true,
  });
  def(ID.REDSTONE_WIRE, '红石线', {
    shape: 'model', tex: T('redstone_wire'), hardness: 0, sound: 'stone', solid: false,
    needsGround: true, stateFamily: 'redstone_wire', drops: [{ id: IT.REDSTONE, n: 1 }], noItem: true,
    modelBoxes: [{ x: 0, y: 0, z: 0, w: 1, h: 1 / 32, d: 1 }],
  });
  def(ID.REDSTONE_TORCH, '红石火把', {
    shape: 'model', tex: T('redstone_torch_on'), hardness: 0, sound: 'wood', solid: false,
    needsGround: true, light: 7, stateFamily: 'redstone_torch', handModel: 'sprite',
    modelBoxes: [{ x: 7 / 16, y: 0, z: 7 / 16, w: 2 / 16, h: 10 / 16, d: 2 / 16 }],
  });
  def(ID.REDSTONE_TORCH_OFF, '熄灭的红石火把', {
    shape: 'model', tex: T('redstone_torch_off'), hardness: 0, sound: 'wood', solid: false,
    needsGround: true, stateFamily: 'redstone_torch', drops: [{ id: ID.REDSTONE_TORCH, n: 1 }], noItem: true,
    modelBoxes: [{ x: 7 / 16, y: 0, z: 7 / 16, w: 2 / 16, h: 10 / 16, d: 2 / 16 }],
  });
  def(ID.REPEATER, '红石中继器', {
    shape: 'model', tex: T('repeater'), hardness: 0, sound: 'stone', solid: false,
    needsGround: true, orientable: true, stateFamily: 'repeater', modelBoxes: repeaterBoxes,
  });
  def(ID.REPEATER_LIT, '点亮的红石中继器', {
    shape: 'model', tex: T('repeater_lit'), hardness: 0, sound: 'stone', solid: false, light: 7,
    needsGround: true, orientable: true, stateFamily: 'repeater', modelBoxes: repeaterBoxes,
    drops: [{ id: ID.REPEATER, n: 1 }], noItem: true,
  });
  def(ID.PISTON, '活塞', {
    tex: { top: 'piston_top', bottom: 'piston_side', side: 'piston_side', front: 'piston_top' },
    hardness: 1.5, tool: 'pickaxe', orientable: true, stateFamily: 'piston',
  });
  def(ID.PISTON_HEAD, '活塞头', {
    shape: 'model', tex: T('piston_top'), hardness: -1, solid: true, stateFamily: 'piston_head',
    collisionBoxes: (world, x, y, z, state) => [thinFacingBox((state & 3) + 2, 4 / 16, 1)],
    modelBoxes: (world, x, y, z, state) => [thinFacingBox((state & 3) + 2, 4 / 16, 1)],
    drops: [], noItem: true,
  });
  def(ID.NETHERRACK, '下界岩', { tex: T('netherrack'), hardness: 0.4, tool: 'pickaxe' });
  def(ID.NETHER_BRICKS, '下界砖块', { tex: T('nether_bricks'), hardness: 2, tool: 'pickaxe', needsTool: true });
  def(ID.NETHER_PORTAL, '下界传送门', {
    shape: 'nether_portal', tex: T('nether_portal'), hardness: -1, solid: false, transparent: true,
    cutout: true, light: 11, drops: [], noItem: true, stateFamily: 'portal',
  });
  def(ID.END_STONE, '末地石', { tex: T('end_stone'), hardness: 3, tool: 'pickaxe', needsTool: true });
  def(ID.END_PORTAL_FRAME, '末地传送门框架', {
    shape: 'slab', tex: T('end_portal_frame'), hardness: -1,
    collision: { x: 0, y: 0, z: 0, w: 1, h: 13 / 16, d: 1 }, stateFamily: 'end_portal_frame',
  });
  def(ID.END_PORTAL, '末地传送门', {
    shape: 'portal', tex: T('end_portal'), hardness: -1, light: 15, solid: false, transparent: true,
    opacity: 0, stateFamily: 'end_portal', drops: [], noItem: true,
  });
  def(ID.BREWING_STAND, '釀造台', {
    shape: 'model', tex: T('brewing_stand'), hardness: 0.5, tool: 'pickaxe', transparent: true,
    poi: 'cleric',
    collisionBoxes: [{ x: 1 / 16, y: 0, z: 1 / 16, w: 14 / 16, h: 2 / 16, d: 14 / 16 }],
    modelBoxes: [{ x: 1 / 16, y: 0, z: 1 / 16, w: 14 / 16, h: 2 / 16, d: 14 / 16 }, { x: 7 / 16, y: 2 / 16, z: 7 / 16, w: 2 / 16, h: 12 / 16, d: 2 / 16 }],
  });
  def(ID.IRON_DOOR, '铁门', {
    shape: 'model', tex: { all: 'iron_door_lower', icon: 'iron_door' }, hardness: 5, tool: 'pickaxe', needsTool: true,
    transparent: true, cutout: true,
    orientable: true, needsGround: true, stateFamily: 'iron_door', collisionBoxes: doorBoxes, modelBoxes: doorBoxes,
    handModel: 'sprite',
  });
  def(ID.IRON_DOOR_TOP, '铁门上半部', {
    shape: 'model', tex: T('iron_door_upper'), hardness: 5, tool: 'pickaxe', needsTool: true,
    transparent: true, cutout: true,
    orientable: true, stateFamily: 'iron_door', collisionBoxes: doorBoxes, modelBoxes: doorBoxes,
    drops: [], noItem: true,
  });
  def(ID.IRON_TRAPDOOR, '铁活板门', {
    shape: 'model', tex: T('iron_trapdoor'), hardness: 5, tool: 'pickaxe', needsTool: true,
    orientable: true, stateFamily: 'iron_trapdoor', collisionBoxes: trapdoorBoxes, modelBoxes: trapdoorBoxes,
  });
  def(ID.DRAGON_EGG, '龙蛋', {
    shape: 'model', tex: T('dragon_egg'), hardness: 3, transparent: true,
    collisionBoxes: [{ x: 3 / 16, y: 0, z: 3 / 16, w: 10 / 16, h: 15 / 16, d: 10 / 16 }],
    modelBoxes: [{ x: 3 / 16, y: 0, z: 3 / 16, w: 10 / 16, h: 15 / 16, d: 10 / 16 }],
  });
  def(ID.BELL, '钟', {
    shape: 'model', tex: T('bell'), hardness: 5, tool: 'pickaxe', needsTool: true,
    solid: false, transparent: true, needsGround: true, poi: 'meeting',
    collisionBoxes: [{ x: 4 / 16, y: 0, z: 4 / 16, w: 8 / 16, h: 12 / 16, d: 8 / 16 }],
    modelBoxes: [
      { x: 5 / 16, y: 1 / 16, z: 5 / 16, w: 6 / 16, h: 9 / 16, d: 6 / 16 },
      { x: 4 / 16, y: 9 / 16, z: 4 / 16, w: 8 / 16, h: 3 / 16, d: 8 / 16 },
    ],
  });
  def(ID.COMPOSTER, '堆肥桶', {
    shape: 'model', tex: T('composter'), hardness: 0.6, tool: 'axe', flammable: true,
    poi: 'farmer', collisionBoxes: [{ x: 0, y: 0, z: 0, w: 1, h: 15 / 16, d: 1 }],
    modelBoxes: [
      { x: 0, y: 0, z: 0, w: 1, h: 3 / 16, d: 1 },
      { x: 0, y: 3 / 16, z: 0, w: 2 / 16, h: 12 / 16, d: 1 },
      { x: 14 / 16, y: 3 / 16, z: 0, w: 2 / 16, h: 12 / 16, d: 1 },
      { x: 2 / 16, y: 3 / 16, z: 0, w: 12 / 16, h: 12 / 16, d: 2 / 16 },
      { x: 2 / 16, y: 3 / 16, z: 14 / 16, w: 12 / 16, h: 12 / 16, d: 2 / 16 },
    ],
  });
  def(ID.LECTERN, '讲台', {
    shape: 'model', tex: T('lectern'), hardness: 2.5, tool: 'axe', flammable: true,
    orientable: true, poi: 'librarian',
    collisionBoxes: [{ x: 2 / 16, y: 0, z: 2 / 16, w: 12 / 16, h: 14 / 16, d: 12 / 16 }],
    modelBoxes: [
      { x: 2 / 16, y: 0, z: 2 / 16, w: 12 / 16, h: 2 / 16, d: 12 / 16 },
      { x: 6 / 16, y: 2 / 16, z: 6 / 16, w: 4 / 16, h: 9 / 16, d: 4 / 16 },
      { x: 1 / 16, y: 11 / 16, z: 2 / 16, w: 14 / 16, h: 3 / 16, d: 12 / 16 },
    ],
  });
  def(ID.GRINDSTONE, '砂轮', {
    shape: 'model', tex: T('grindstone'), hardness: 2, tool: 'pickaxe', needsTool: true,
    orientable: true, poi: 'weaponsmith',
    collisionBoxes: [{ x: 2 / 16, y: 0, z: 2 / 16, w: 12 / 16, h: 14 / 16, d: 12 / 16 }],
    modelBoxes: [
      { x: 2 / 16, y: 0, z: 3 / 16, w: 3 / 16, h: 12 / 16, d: 10 / 16 },
      { x: 11 / 16, y: 0, z: 3 / 16, w: 3 / 16, h: 12 / 16, d: 10 / 16 },
      { x: 4 / 16, y: 5 / 16, z: 2 / 16, w: 8 / 16, h: 8 / 16, d: 12 / 16 },
    ],
  });
  def(ID.SMITHING_TABLE, '锻造台', {
    tex: { top: 'smithing_table_top', bottom: 'planks', side: 'smithing_table_side' },
    hardness: 2.5, tool: 'axe', flammable: true, poi: 'toolsmith',
  });
  def(ID.SMOKER, '烟熏炉', {
    tex: { top: 'smoker_top', bottom: 'stone', side: 'smoker_side', front: 'smoker_front' },
    hardness: 3.5, tool: 'pickaxe', needsTool: true, orientable: true, poi: 'butcher',
  });
  // air
  B[ID.AIR] = { id: 0, name: '空气', shape: 'none', solid: false, opaque: false, opacity: 0, transparent: true, cutout: false, liquid: false, tex: {}, hardness: -1, tool: null, tier: 0, needsTool: false, drops: [], light: 0, sound: 'grass', soundSet: 'grass', replaceable: true, needsGround: false, gravity: false, flammable: false };
  delete ITEMS[ID.AIR];
  delete ITEMS[ID.WATER];
  delete ITEMS[ID.LAVA];
  ITEMS[ID.WATER] = { id: ID.WATER, name: '水', stack: 64, block: true, creativeOnly: true, hidden: true,
    display: DISPLAY_PRESETS.block, handPose: DISPLAY_PRESETS.block.firstPerson };
  ITEMS[ID.LAVA] = { id: ID.LAVA, name: '岩浆', stack: 64, block: true, creativeOnly: true, hidden: true,
    display: DISPLAY_PRESETS.block, handPose: DISPLAY_PRESETS.block.firstPerson };
  ITEMS[ID.BEDROCK].creativeOnly = true;

  // ---- Items ----
  function item(id, name, o) {
    o = o || {};
    const kind = o.displayKind || (o.tool ? (o.tool.type === 'sword' ? 'sword' : 'tool')
      : o.bow ? 'bow' : o.food ? 'food' : 'item');
    const preset = DISPLAY_PRESETS[kind] || DISPLAY_PRESETS.item;
    const display = o.display || (o.handPose ? Object.assign({}, preset, { firstPerson: o.handPose }) : preset);
    ITEMS[id] = Object.assign({
      id, name, stack: o.stack || 64, block: false,
      display, handPose: o.handPose || display.firstPerson,
    }, o);
  }
  const HAND_POSES = {
    item: DISPLAY_PRESETS.item.firstPerson,
    pickaxe: DISPLAY_PRESETS.tool.firstPerson,
    axe: DISPLAY_PRESETS.tool.firstPerson,
    shovel: DISPLAY_PRESETS.tool.firstPerson,
    sword: DISPLAY_PRESETS.sword.firstPerson,
    hoe: DISPLAY_PRESETS.tool.firstPerson,
    shears: { attach:'hand', pos: [0.51, -0.50, -0.80], rot: VANILLA_HANDHELD_ROT, scale: 0.68, grip: [-0.28, -0.23, 0] },
    bow: DISPLAY_PRESETS.bow.firstPerson,
    rod: { attach:'hand', pos: [0.50, -0.49, -0.84], rot: [-0.08, 0.30, 0.92], scale: 0.68, grip: [-0.28, -0.34, 0] },
  };
  item(IT.STICK, '木棍', { tex: 'stick' });
  item(IT.COAL, '煤炭', { tex: 'coal' });
  item(IT.CHARCOAL, '木炭', { tex: 'charcoal' });
  item(IT.IRON_INGOT, '铁锭', { tex: 'iron_ingot' });
  item(IT.GOLD_INGOT, '金锭', { tex: 'gold_ingot' });
  item(IT.DIAMOND, '钻石', { tex: 'diamond' });
  item(IT.APPLE, '苹果', { tex: 'apple', food: { hunger: 4, saturation: 2.4 } });
  item(IT.PORK_RAW, '生猪排', { tex: 'porkchop_raw', food: { hunger: 3, saturation: 1.8 } });
  item(IT.PORK_COOKED, '熟猪排', { tex: 'porkchop_cooked', food: { hunger: 8, saturation: 12.8 } });
  item(IT.BEEF_RAW, '生牛肉', { tex: 'beef_raw', food: { hunger: 3, saturation: 1.8 } });
  item(IT.BEEF_COOKED, '牛排', { tex: 'beef_cooked', food: { hunger: 8, saturation: 12.8 } });
  item(IT.MUTTON_RAW, '生羊肉', { tex: 'mutton_raw', food: { hunger: 2, saturation: 1.2 } });
  item(IT.MUTTON_COOKED, '熟羊肉', { tex: 'mutton_cooked', food: { hunger: 6, saturation: 9.6 } });
  item(IT.FLESH, '腐肉', { tex: 'rotten_flesh', food: { hunger: 4, saturation: 0.8, risky: true, riskChance: 0.8 } });
  item(IT.GUNPOWDER, '火药', { tex: 'gunpowder' });
  item(IT.SHEARS, '剪刀', {
    stack: 1, tex: 'shears', handPose: HAND_POSES.shears,
    tool: { type: 'shears', tier: 0, speed: 1, durability: 238, damage: 1 },
    durability: 238, enchantable: 'tool',
  });
  item(IT.FLINT, '燧石', { tex: 'flint' });
  item(IT.LEATHER, '皮革', { tex: 'leather' });
  item(IT.STRING, '线', { tex: 'string' });
  item(IT.FEATHER, '羽毛', { tex: 'feather' });
  item(IT.BONE, '骨头', { tex: 'bone' });
  item(IT.BONE_MEAL, '骨粉', { tex: 'bone_meal', bonemeal: true });
  item(IT.EGG, '鸡蛋', { tex: 'egg', stack: 16, throwable: 'egg' });
  item(IT.WHEAT_SEEDS, '小麦种子', { tex: 'wheat_seeds', plant: ID.WHEAT_CROP });
  item(IT.WHEAT, '小麦', { tex: 'wheat' });
  item(IT.BREAD, '面包', { tex: 'bread', food: { hunger: 5, saturation: 6 } });
  item(IT.CARROT, '胡萝卜', { tex: 'carrot', plant: ID.CARROT_CROP, food: { hunger: 3, saturation: 4.8 } });
  item(IT.POTATO, '马铃薯', { tex: 'potato', plant: ID.POTATO_CROP, food: { hunger: 1, saturation: 0.6 } });
  item(IT.BAKED_POTATO, '烤马铃薯', { tex: 'baked_potato', food: { hunger: 5, saturation: 6 } });
  item(IT.CHICKEN_RAW, '生鸡肉', { tex: 'chicken_raw', food: { hunger: 2, saturation: 1.2, risky: true, riskChance: 0.3 } });
  item(IT.CHICKEN_COOKED, '熟鸡肉', { tex: 'chicken_cooked', food: { hunger: 6, saturation: 7.2 } });
  item(IT.FISH_RAW, '生鱼', { tex: 'fish_raw', food: { hunger: 2, saturation: 0.4 } });
  item(IT.FISH_COOKED, '熟鱼', { tex: 'fish_cooked', food: { hunger: 5, saturation: 6 } });
  item(IT.GOLDEN_APPLE, '金苹果', {
    tex: 'golden_apple', food: { hunger: 4, saturation: 9.6, alwaysEat: true, effects: [{ type: 'regeneration', duration: 5, level: 1 }] },
  });
  item(IT.PAPER, '纸', { tex: 'paper' });
  item(IT.BOOK, '书', { tex: 'book', enchantable: 'book' });
  item(IT.CLAY_BALL, '黏土球', { tex: 'clay_ball' });
  item(IT.BRICK, '红砖', { tex: 'brick' });
  item(IT.GLOWSTONE_DUST, '萤石粉', { tex: 'glowstone_dust' });
  item(IT.LAPIS, '青金石', { tex: 'lapis_lazuli' });
  item(IT.BUCKET, '桶', { tex: 'bucket', stack: 16, bucket: 'empty' });
  item(IT.WATER_BUCKET, '水桶', { tex: 'water_bucket', stack: 1, bucket: 'water' });
  item(IT.LAVA_BUCKET, '岩浆桶', { tex: 'lava_bucket', stack: 1, bucket: 'lava' });
  item(IT.FLINT_STEEL, '打火石', {
    tex: 'flint_steel', stack: 1, durability: 65, ignite: true, handPose: HAND_POSES.item, enchantable: 'tool',
  });
  item(IT.BOW, '弓', { tex: 'bow', stack: 1, durability: 385, bow: true, handPose: HAND_POSES.bow, enchantable: 'bow' });
  item(IT.ARROW, '箭', { tex: 'arrow' });
  item(IT.FISHING_ROD, '钓鱼竿', {
    tex: 'fishing_rod', stack: 1, durability: 65, fishing: true, handPose: HAND_POSES.rod, enchantable: 'tool',
  });
  item(IT.REDSTONE, '红石粉', { tex: 'redstone', place: ID.REDSTONE_WIRE });
  item(IT.ENDER_PEARL, '末影珍珠', { tex: 'ender_pearl', stack: 16, throwable: 'ender_pearl' });
  item(IT.BLAZE_ROD, '烈焰棒', { tex: 'blaze_rod' });
  item(IT.BLAZE_POWDER, '烈焰粉', { tex: 'blaze_powder' });
  item(IT.EYE_OF_ENDER, '末影之眼', { tex: 'eye_of_ender', stack: 16, enderEye: true });
  item(IT.EMERALD, '绿宝石', { tex: 'emerald' });
  item(IT.SLIME_BALL, '黏液球', { tex: 'slime_ball' });
  item(IT.NETHER_WART, '下界疣', { tex: 'nether_wart' });
  item(IT.GLASS_BOTTLE, '玻璃瓶', { tex: 'glass_bottle', stack: 64, bottle: 'empty' });
  item(IT.WATER_BOTTLE, '水瓶', { tex: 'water_bottle', stack: 1, bottle: 'water' });
  item(IT.AWKWARD_POTION, '粗制的药水', { tex: 'awkward_potion', stack: 1, bottle: 'awkward' });
  item(IT.HEALING_POTION, '治疗药水', {
    tex: 'healing_potion', stack: 1, returns: IT.GLASS_BOTTLE,
    food: { hunger: 0, saturation: 0, alwaysEat: true, effects: [{ type: 'regeneration', duration: 8, level: 1 }] },
  });

  // tools: tier index wood0 stone1 iron2 gold3 diamond4; mining power wood0 stone1 iron2 gold1 diamond3
  const TIER_NAMES = ['木', '石', '铁', '金', '钻石'];
  const TIER_KEYS = ['wood', 'stone', 'iron', 'gold', 'diamond'];
  const TIER_SPEED = [2, 4, 6, 12, 8];
  const TIER_POWER = [0, 1, 2, 1, 3];
  const TIER_DUR = [60, 132, 251, 33, 1562];
  const TIER_REPAIR = [ID.PLANKS, ID.COBBLE, IT.IRON_INGOT, IT.GOLD_INGOT, IT.DIAMOND];
  const TOOL_TYPES = [
    { key: 'pickaxe', name: '镐', base: IT.PICK_WOOD, dmg: 2, attackSpeed: 1.2 },
    { key: 'axe', name: '斧', base: IT.AXE_WOOD, dmg: 3, attackSpeed: 0.9 },
    { key: 'shovel', name: '锹', base: IT.SHOVEL_WOOD, dmg: 1, attackSpeed: 1.0 },
    { key: 'sword', name: '剑', base: IT.SWORD_WOOD, dmg: 4, attackSpeed: 1.6 },
    { key: 'hoe', name: '锄', base: IT.HOE_WOOD, dmg: 1, attackSpeed: 1.0 },
  ];
  for (const tt of TOOL_TYPES) {
    for (let t = 0; t < 5; t++) {
      const id = tt.base + t;
      const swordDmg = [4, 5, 6, 4, 7][t];
      item(id, TIER_NAMES[t] + tt.name, {
        stack: 1,
        tex: tt.key + '_' + TIER_KEYS[t],
        handPose: HAND_POSES[tt.key],
        durability: TIER_DUR[t],
        enchantable: 'tool',
        repair: TIER_REPAIR[t],
        tool: {
          type: tt.key,
          tier: TIER_POWER[t],
          speed: TIER_SPEED[t],
          attackSpeed: tt.attackSpeed,
          durability: TIER_DUR[t],
          damage: tt.key === 'sword' ? swordDmg : tt.dmg,
        },
      });
    }
  }

  const ARMOR_PARTS = [
    { key: 'helmet', name: '头盔', slot: 0 },
    { key: 'chestplate', name: '胸甲', slot: 1 },
    { key: 'leggings', name: '护腿', slot: 2 },
    { key: 'boots', name: '靴子', slot: 3 },
  ];
  const ARMOR_MATERIALS = [
    { key: 'leather', name: '皮革', base: IT.HELMET_LEATHER, points: [1, 3, 2, 1], dur: [55, 80, 75, 65], repair: IT.LEATHER },
    { key: 'gold', name: '金', base: IT.HELMET_GOLD, points: [2, 5, 3, 1], dur: [77, 112, 105, 91], repair: IT.GOLD_INGOT },
    { key: 'iron', name: '铁', base: IT.HELMET_IRON, points: [2, 6, 5, 2], dur: [165, 240, 225, 195], repair: IT.IRON_INGOT },
    { key: 'diamond', name: '钻石', base: IT.HELMET_DIAMOND, points: [3, 8, 6, 3], dur: [363, 528, 495, 429], repair: IT.DIAMOND },
  ];
  for (const material of ARMOR_MATERIALS) for (let part = 0; part < ARMOR_PARTS.length; part++) {
    const piece = ARMOR_PARTS[part];
    item(material.base + part, material.name + piece.name, {
      stack: 1,
      tex: 'armor_' + piece.key + '_' + material.key,
      durability: material.dur[part],
      enchantable: 'armor',
      armor: {
        slot: piece.slot, points: material.points[part], material: material.key,
        durability: material.dur[part], repair: material.repair,
      },
    });
  }

  // ---- Recipes ----
  // shaped: pattern rows (strings), key: {letter: itemId}; result {id,n}
  // shapeless: list of itemIds
  const RECIPES = [
    { shapeless: [ID.LOG], out: { id: ID.PLANKS, n: 4 } },
    { shapeless: [ID.SPRUCE_LOG], out: { id: ID.PLANKS, n: 4 } },
    { pattern: ['P', 'P'], key: { P: ID.PLANKS }, out: { id: IT.STICK, n: 4 } },
    { pattern: ['PP', 'PP'], key: { P: ID.PLANKS }, out: { id: ID.CRAFTING, n: 1 } },
    { pattern: ['CCC', 'C C', 'CCC'], key: { C: ID.COBBLE }, out: { id: ID.FURNACE, n: 1 } },
    { pattern: ['PPP', 'P P', 'PPP'], key: { P: ID.PLANKS }, out: { id: ID.CHEST, n: 1 } },
    { pattern: ['C', 'S'], key: { C: IT.COAL, S: IT.STICK }, out: { id: ID.TORCH, n: 4 } },
    { pattern: ['C', 'S'], key: { C: IT.CHARCOAL, S: IT.STICK }, out: { id: ID.TORCH, n: 4 } },
    { pattern: [' I', 'I '], key: { I: IT.IRON_INGOT }, out: { id: IT.SHEARS, n: 1 }, mirror: true },
    { pattern: ['SS', 'SS'], key: { S: ID.STONE }, out: { id: ID.STONE_BRICKS, n: 4 } },
    { pattern: ['BB', 'BB'], key: { B: IT.BRICK }, out: { id: ID.BRICKS, n: 1 } },
    { pattern: ['GSG', 'SGS', 'GSG'], key: { G: IT.GUNPOWDER, S: ID.SAND }, out: { id: ID.TNT, n: 1 } },
    { pattern: ['WWW', 'PPP'], key: { W: ID.WOOL, P: ID.PLANKS }, out: { id: ID.BED, n: 1 } },
    { pattern: ['PPP'], key: { P: ID.PLANKS }, out: { id: ID.PLANK_SLAB, n: 6 } },
    { pattern: ['P  ', 'PP ', 'PPP'], key: { P: ID.PLANKS }, out: { id: ID.OAK_STAIRS, n: 4 }, mirror: true },
    { pattern: ['PSP', 'PSP'], key: { P: ID.PLANKS, S: IT.STICK }, out: { id: ID.OAK_FENCE, n: 3 } },
    { pattern: ['S', 'C'], key: { S: IT.STICK, C: ID.COBBLE }, out: { id: ID.LEVER, n: 1 } },
    { pattern: ['GGG', 'GRG', 'GGG'], key: { G: ID.GLOWSTONE, R: IT.REDSTONE }, out: { id: ID.REDSTONE_LAMP, n: 1 } },
    { pattern: ['PP', 'PP', 'PP'], key: { P: ID.PLANKS }, out: { id: ID.OAK_DOOR, n: 3 } },
    { pattern: ['PPP', 'PPP'], key: { P: ID.PLANKS }, out: { id: ID.OAK_TRAPDOOR, n: 2 } },
    { pattern: ['II', 'II', 'II'], key: { I: IT.IRON_INGOT }, out: { id: ID.IRON_DOOR, n: 3 } },
    { pattern: ['II', 'II'], key: { I: IT.IRON_INGOT }, out: { id: ID.IRON_TRAPDOOR, n: 1 } },
    { pattern: ['SPS', 'SPS'], key: { S: IT.STICK, P: ID.PLANKS }, out: { id: ID.OAK_FENCE_GATE, n: 1 } },
    { shapeless: [ID.STONE], out: { id: ID.STONE_BUTTON, n: 1 } },
    { pattern: ['SS'], key: { S: ID.STONE }, out: { id: ID.STONE_PRESSURE_PLATE, n: 1 } },
    { pattern: ['PPP', 'PPP', ' S '], key: { P: ID.PLANKS, S: IT.STICK }, out: { id: ID.OAK_SIGN, n: 3 } },
    { pattern: ['R', 'S'], key: { R: IT.REDSTONE, S: IT.STICK }, out: { id: ID.REDSTONE_TORCH, n: 1 } },
    { pattern: ['TRT', 'SSS'], key: { T: ID.REDSTONE_TORCH, R: IT.REDSTONE, S: ID.STONE }, out: { id: ID.REPEATER, n: 1 } },
    { pattern: ['PPP', 'CIC', 'CRC'], key: { P: ID.PLANKS, C: ID.COBBLE, I: IT.IRON_INGOT, R: IT.REDSTONE }, out: { id: ID.PISTON, n: 1 } },
    { pattern: ['SSS'], key: { S: ID.STONE }, out: { id: ID.STONE_SLAB, n: 6 } },
    { pattern: ['PPP', 'BBB', 'PPP'], key: { P: ID.PLANKS, B: IT.BOOK }, out: { id: ID.BOOKSHELF, n: 1 } },
    { pattern: ['S S', 'SSS', 'S S'], key: { S: IT.STICK }, out: { id: ID.LADDER, n: 3 } },
    { pattern: ['GG', 'GG'], key: { G: IT.GLOWSTONE_DUST }, out: { id: ID.GLOWSTONE, n: 1 } },
    { pattern: ['WWW'], key: { W: IT.WHEAT }, out: { id: IT.BREAD, n: 1 } },
    { pattern: ['SSS'], key: { S: ID.SUGAR_CANE }, out: { id: IT.PAPER, n: 3 } },
    { shapeless: [IT.PAPER, IT.PAPER, IT.PAPER, IT.LEATHER], out: { id: IT.BOOK, n: 1 } },
    { shapeless: [IT.BONE], out: { id: IT.BONE_MEAL, n: 3 } },
    { pattern: ['I I', ' I '], key: { I: IT.IRON_INGOT }, out: { id: IT.BUCKET, n: 1 } },
    { pattern: [' F', 'I '], key: { F: IT.FLINT, I: IT.IRON_INGOT }, out: { id: IT.FLINT_STEEL, n: 1 }, mirror: true },
    { pattern: [' ST', 'S T', ' ST'], key: { S: IT.STICK, T: IT.STRING }, out: { id: IT.BOW, n: 1 }, mirror: true },
    { pattern: ['F', 'S', 'E'], key: { F: IT.FLINT, S: IT.STICK, E: IT.FEATHER }, out: { id: IT.ARROW, n: 4 } },
    { pattern: ['  S', ' ST', 'S T'], key: { S: IT.STICK, T: IT.STRING }, out: { id: IT.FISHING_ROD, n: 1 }, mirror: true },
    { pattern: ['GGG', 'GAG', 'GGG'], key: { G: IT.GOLD_INGOT, A: IT.APPLE }, out: { id: IT.GOLDEN_APPLE, n: 1 } },
    { pattern: ['III', 'III', 'III'], key: { I: IT.IRON_INGOT }, out: { id: ID.IRON_BLOCK, n: 1 } },
    { shapeless: [ID.IRON_BLOCK], out: { id: IT.IRON_INGOT, n: 9 } },
    { pattern: [' B ', 'DOD', 'OOO'], key: { B: IT.BOOK, D: IT.DIAMOND, O: ID.OBSIDIAN }, out: { id: ID.ENCHANTING_TABLE, n: 1 } },
    { pattern: ['BBB', ' I ', 'III'], key: { B: ID.IRON_BLOCK, I: IT.IRON_INGOT }, out: { id: ID.ANVIL, n: 1 } },
    { shapeless: [IT.BLAZE_ROD], out: { id: IT.BLAZE_POWDER, n: 2 } },
    { shapeless: [IT.ENDER_PEARL, IT.BLAZE_POWDER], out: { id: IT.EYE_OF_ENDER, n: 1 } },
    { pattern: ['B', 'CCC'], key: { B: IT.BLAZE_ROD, C: ID.COBBLE }, out: { id: ID.BREWING_STAND, n: 1 } },
    { pattern: ['G G', ' G '], key: { G: ID.GLASS }, out: { id: IT.GLASS_BOTTLE, n: 3 } },
    { pattern: ['S S', 'S S', 'SSS'], key: { S: ID.PLANK_SLAB }, out: { id: ID.COMPOSTER, n: 1 } },
    { pattern: ['SSS', ' B ', ' S '], key: { S: ID.PLANK_SLAB, B: ID.BOOKSHELF }, out: { id: ID.LECTERN, n: 1 } },
    { pattern: ['XIX', ' P '], key: { X: IT.STICK, I: ID.STONE_SLAB, P: ID.PLANKS }, out: { id: ID.GRINDSTONE, n: 1 } },
    { pattern: ['II', 'PP', 'PP'], key: { I: IT.IRON_INGOT, P: ID.PLANKS }, out: { id: ID.SMITHING_TABLE, n: 1 } },
    { pattern: [' L ', 'LFL', ' L '], key: { L: ID.LOG, F: ID.FURNACE }, out: { id: ID.SMOKER, n: 1 } },
  ];
  // tools (M = material)
  const TOOL_MATS = TIER_REPAIR;
  for (let t = 0; t < 5; t++) {
    const M = TOOL_MATS[t], S = IT.STICK;
    RECIPES.push({ pattern: ['MMM', ' S ', ' S '], key: { M, S }, out: { id: IT.PICK_WOOD + t, n: 1 } });
    RECIPES.push({ pattern: ['MM', 'MS', ' S'], key: { M, S }, out: { id: IT.AXE_WOOD + t, n: 1 }, mirror: true });
    RECIPES.push({ pattern: ['M', 'S', 'S'], key: { M, S }, out: { id: IT.SHOVEL_WOOD + t, n: 1 } });
    RECIPES.push({ pattern: ['M', 'M', 'S'], key: { M, S }, out: { id: IT.SWORD_WOOD + t, n: 1 } });
    RECIPES.push({ pattern: ['MM', ' S', ' S'], key: { M, S }, out: { id: IT.HOE_WOOD + t, n: 1 }, mirror: true });
  }
  const ARMOR_RECIPE_PATTERNS = [
    ['MMM', 'M M'],
    ['M M', 'MMM', 'MMM'],
    ['MMM', 'M M', 'M M'],
    ['M M', 'M M'],
  ];
  for (const material of ARMOR_MATERIALS) for (let part = 0; part < 4; part++) {
    RECIPES.push({
      pattern: ARMOR_RECIPE_PATTERNS[part],
      key: { M: material.repair },
      out: { id: material.base + part, n: 1 },
    });
  }

  // ---- Smelting ----
  const SMELT = {};
  SMELT[ID.IRON_ORE] = { id: IT.IRON_INGOT, n: 1, xp: 0.7 };
  SMELT[ID.GOLD_ORE] = { id: IT.GOLD_INGOT, n: 1, xp: 1.0 };
  SMELT[ID.SAND] = { id: ID.GLASS, n: 1, xp: 0.1 };
  SMELT[ID.COBBLE] = { id: ID.STONE, n: 1, xp: 0.1 };
  SMELT[ID.LOG] = { id: IT.CHARCOAL, n: 1, xp: 0.15 };
  SMELT[ID.SPRUCE_LOG] = { id: IT.CHARCOAL, n: 1, xp: 0.15 };
  SMELT[IT.PORK_RAW] = { id: IT.PORK_COOKED, n: 1, xp: 0.35 };
  SMELT[IT.BEEF_RAW] = { id: IT.BEEF_COOKED, n: 1, xp: 0.35 };
  SMELT[IT.MUTTON_RAW] = { id: IT.MUTTON_COOKED, n: 1, xp: 0.35 };
  SMELT[IT.CHICKEN_RAW] = { id: IT.CHICKEN_COOKED, n: 1, xp: 0.35 };
  SMELT[IT.FISH_RAW] = { id: IT.FISH_COOKED, n: 1, xp: 0.35 };
  SMELT[IT.POTATO] = { id: IT.BAKED_POTATO, n: 1, xp: 0.35 };
  SMELT[IT.CLAY_BALL] = { id: IT.BRICK, n: 1, xp: 0.3 };
  SMELT[ID.NETHERRACK] = { id: ID.NETHER_BRICKS, n: 1, xp: 0.1 };

  // fuel: burn seconds (one smelt = 10s)
  const FUEL = {};
  FUEL[IT.COAL] = 80; FUEL[IT.CHARCOAL] = 80;
  FUEL[ID.LOG] = 15; FUEL[ID.SPRUCE_LOG] = 15; FUEL[ID.PLANKS] = 15;
  FUEL[ID.PLANK_SLAB] = 7.5;
  FUEL[IT.STICK] = 5; FUEL[ID.SAPLING] = 5;
  FUEL[ID.CRAFTING] = 15; FUEL[ID.CHEST] = 15; FUEL[ID.BOOKSHELF] = 15;
  FUEL[ID.LADDER] = 15;
  FUEL[ID.OAK_DOOR] = 10; FUEL[ID.OAK_TRAPDOOR] = 15; FUEL[ID.OAK_FENCE_GATE] = 15; FUEL[ID.OAK_SIGN] = 10;
  FUEL[ID.COMPOSTER] = 15; FUEL[ID.LECTERN] = 15; FUEL[ID.SMITHING_TABLE] = 15;
  FUEL[IT.PICK_WOOD] = 10; FUEL[IT.AXE_WOOD] = 10; FUEL[IT.SHOVEL_WOOD] = 10; FUEL[IT.SWORD_WOOD] = 10;
  FUEL[IT.HOE_WOOD] = 10;

  const SOUND_GROUPS = {
    foliage: [ID.SAPLING, ID.LEAVES, ID.TALLGRASS, ID.FLOWER_RED, ID.FLOWER_YELLOW, ID.LEAVES_SPRUCE,
      ID.WHEAT_CROP, ID.CARROT_CROP, ID.POTATO_CROP, ID.SUGAR_CANE, ID.FIRE],
    gravel: [ID.GRAVEL, ID.CLAY],
    snow: [ID.SNOW, ID.GRASS_SNOW, ID.SNOW_LAYER],
    wool: [ID.WOOL, ID.BED, ID.COBWEB],
    metal: [ID.ANVIL, ID.IRON_BLOCK, ID.IRON_DOOR, ID.IRON_DOOR_TOP, ID.IRON_TRAPDOOR, ID.BELL,
      ID.GRINDSTONE, ID.SMITHING_TABLE, ID.BREWING_STAND],
    ladder: [ID.LADDER],
    soul_sand: [ID.SOUL_SAND],
    nether: [ID.NETHERRACK, ID.NETHER_BRICKS],
  };
  for (const group of Object.keys(SOUND_GROUPS)) {
    for (const id of SOUND_GROUPS[group]) if (B[id]) B[id].soundSet = group;
  }

  // ---- Public API ----
  window.Blocks = {
    ID,
    get: (id) => B[id] || B[0],
    installModel(id, source, resource) {
      const block = B[id];
      if (!block || (!Array.isArray(source) && typeof source !== 'function')) return false;
      block.shape = 'model';
      block.modelElements = source;
      block.modelResource = resource || null;
      return true;
    },
    isSolid: (id) => (B[id] || B[0]).solid,
    isOpaque: (id) => (B[id] || B[0]).opaque,
    opacity: (id) => (B[id] || B[0]).opacity,
    lightOf: (id) => (B[id] || B[0]).light,
    torchPose,
    doorPanelFacing,
    modelElements(id, world, x, y, z, state) {
      const source = (B[id] || B[0]).modelElements;
      return typeof source === 'function' ? source(world, x, y, z, state | 0) : (source || []);
    },
    itemModelBoxes(id) {
      const block = B[id] || B[0];
      let source = block.itemModelBoxes || block.modelBoxes;
      if (!source && block.shape !== 'cube') source = block.collisionBoxes || (block.collision ? [block.collision] : null);
      if (!source) return [];
      const previewWorld = { getBlock: () => id };
      const boxes = typeof source === 'function' ? source(previewWorld, 0, 0, 0, 0) : source;
      return (boxes || []).filter(box => box && box.w > 0 && box.h > 0 && box.d > 0).map(box => ({
        x: Number(box.x) || 0, y: Number(box.y) || 0, z: Number(box.z) || 0,
        w: Number(box.w) || 0, h: Number(box.h) || 0, d: Number(box.d) || 0,
        tile: box.tile || null,
      }));
    },
    soundEvent(id, action) {
      const block = B[id] || B[0];
      const valid = action === 'step' || action === 'hit' || action === 'break' || action === 'place' || action === 'fall';
      return 'block.' + (block.soundSet || block.sound || 'stone') + '.' + (valid ? action : 'hit');
    },
    placementFor(id, context) {
      const block = B[id] || B[0];
      const face = context && context.face ? context.face : [0, 1, 0];
      const yaw = Number(context && context.yaw) || 0;
      const replaceHit = !!(context && context.replaceHit);
      const horizontal = ((Math.round(yaw / (Math.PI / 2)) + 2) % 4 + 4) % 4;
      if (block.placement === 'floor_or_wall') {
        if (replaceHit || face[1] < 0) return { valid: false, state: 0, hasState: true };
        const state = face[1] > 0 ? 0 : face[0] > 0 ? 1 : face[0] < 0 ? 2 : face[2] > 0 ? 3 : 4;
        return { valid: face[1] > 0 || face[0] !== 0 || face[2] !== 0, state, hasState: true };
      }
      if (block.placement === 'sign') {
        if (replaceHit || face[1] < 0) return { valid: false, state: 0, hasState: true };
        if (face[1] > 0) return { valid: true, state: horizontal, hasState: true };
        const state = (face[0] > 0 ? 1 : face[0] < 0 ? 3 : face[2] > 0 ? 2 : 0) | 4;
        return { valid: face[0] !== 0 || face[2] !== 0, state, hasState: true };
      }
      if (block.placement === 'wall') {
        if (replaceHit || face[1] !== 0) return { valid: false, state: 0, hasState: true };
        const state = face[0] > 0 ? 0 : face[0] < 0 ? 1 : face[2] > 0 ? 2 : 3;
        return { valid: face[0] !== 0 || face[2] !== 0, state, hasState: true };
      }
      if (block.placement === 'horizontal') return { valid: true, state: horizontal, hasState: true };
      return { valid: true, state: 0, hasState: false };
    },
    supportOffset(id, state) {
      const block = B[id] || B[0];
      state |= 0;
      if (block.support === 'ground') return [0, -1, 0];
      if (block.support === 'wall') return [[-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]][state & 3];
      if (block.support === 'torch') return state === 0 ? [0, -1, 0] :
        ([null, [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]][state] || null);
      if (block.support === 'sign') {
        if (!(state & 4)) return [0, -1, 0];
        return [[0, 0, 1], [-1, 0, 0], [0, 0, -1], [1, 0, 0]][state & 3];
      }
      return null;
    },
    dropsFor(id, state, random) {
      const defn = B[id] || B[0];
      const rng = typeof random === 'function' ? random : Math.random;
      const source = defn.dropFn ? defn.dropFn(state, rng) :
        (defn.drops === undefined ? [{ id, n: 1 }] : defn.drops);
      const out = [];
      for (const drop of source || []) {
        if (drop.chance !== undefined && rng() > drop.chance) continue;
        const count = Array.isArray(drop.n)
          ? drop.n[0] + Math.floor(rng() * (drop.n[1] - drop.n[0] + 1))
          : (drop.n || 1);
        if (count > 0) out.push({ id: drop.id, n: count });
      }
      return out;
    },
    all: B,
  };
  window.Items = {
    IT, ID,
    DISPLAY_PRESETS,
    get: (id) => ITEMS[id],
    all: ITEMS,
    RECIPES, SMELT, FUEL,
    isBlock: (id) => id < 256 && !!B[id],
    name: (id) => (ITEMS[id] ? ITEMS[id].name : '?'),
    maxStack: (id) => (ITEMS[id] ? ITEMS[id].stack : 64),
    durabilityOf(id) {
      const it = ITEMS[id];
      return it ? (it.durability || (it.tool && it.tool.durability) || (it.armor && it.armor.durability) || 0) : 0;
    },
    makeStack(id, n, meta) {
      const stack = { id, n: n === undefined ? 1 : n };
      const durability = this.durabilityOf(id);
      if (durability > 0) stack.dur = meta && meta.dur !== undefined ? meta.dur : durability;
      if (meta && meta.ench) stack.ench = Object.assign({}, meta.ench);
      if (meta && meta.name) stack.name = String(meta.name).slice(0, 32);
      return stack;
    },
    cloneStack(stack, n) {
      if (!stack) return null;
      return this.makeStack(stack.id, n === undefined ? stack.n : n, stack);
    },
    inventoryWithTransient(inv, transient) {
      const out = Array.from({ length: 36 }, (_, i) => inv && inv[i] ? this.cloneStack(inv[i]) : null);
      for (const source of transient || []) {
        if (!source) continue;
        let left = source.n;
        const max = this.maxStack(source.id);
        if (source.dur === undefined && !source.ench && !source.name) {
          for (const target of out) {
            if (!target || target.id !== source.id || target.dur !== undefined || target.ench || target.name || target.n >= max) continue;
            const amount = Math.min(left, max - target.n);
            target.n += amount; left -= amount;
            if (left <= 0) break;
          }
        }
        for (let i = 0; i < out.length && left > 0; i++) {
          if (out[i]) continue;
          const amount = Math.min(left, max);
          out[i] = this.cloneStack(source, amount);
          left -= amount;
        }
      }
      return out;
    },
    texOf: (id) => {
      const it = ITEMS[id];
      if (!it) return null;
      if (!it.block) return it.tex;
      return null; // blocks render as 3D icons from block tex
    },
  };
})();
