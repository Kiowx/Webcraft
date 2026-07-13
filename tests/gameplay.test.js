'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const HAS_OPTIONAL_ORIGINAL_ASSETS = fs.existsSync(path.join(
  ROOT, 'assets', 'minecraft-1.12.2', 'extracted', 'assets', 'minecraft', 'textures', 'entity', 'steve.png'
));

function loadGameCore(options) {
  const storage = new Map();
  const createTestCanvas = () => {
    const canvas = { width: 0, height: 0 };
    let pixels = new Uint8ClampedArray(0);
    const ensurePixels = () => {
      const size = canvas.width * canvas.height * 4;
      if (pixels.length !== size) pixels = new Uint8ClampedArray(size);
    };
    const context2d = {
      clearRect(x, y, width, height) {
        ensurePixels();
        for (let py = Math.max(0, y); py < Math.min(canvas.height, y + height); py++) {
          pixels.fill(0, (py * canvas.width + Math.max(0, x)) * 4,
            (py * canvas.width + Math.min(canvas.width, x + width)) * 4);
        }
      },
      createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4), width, height }; },
      putImageData(image, dx, dy) {
        ensurePixels();
        for (let y = 0; y < image.height; y++) {
          const sourceStart = y * image.width * 4;
          const targetStart = ((dy + y) * canvas.width + dx) * 4;
          pixels.set(image.data.subarray(sourceStart, sourceStart + image.width * 4), targetStart);
        }
      },
      getImageData(sx, sy, width, height) {
        ensurePixels();
        const data = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
          const sourceStart = ((sy + y) * canvas.width + sx) * 4;
          data.set(pixels.subarray(sourceStart, sourceStart + width * 4), y * width * 4);
        }
        return { data, width, height };
      },
    };
    canvas.getContext = () => context2d;
    return canvas;
  };
  class TestImage {
    get src() { return this._src || ''; }
    set src(value) {
      this._src = value;
      if (this.onload) this.onload();
    }
  }
  const sandbox = {
    console, setTimeout, clearTimeout, performance,
    Array, ArrayBuffer, Boolean, Date, Error, Float32Array, Float64Array,
    Int8Array, Int16Array, Int32Array, JSON, Map, Math, NaN, Number, Object,
    RangeError, RegExp, Set, String, TypeError, Uint8Array, Uint8ClampedArray,
    Uint16Array, Uint32Array, WeakMap, Infinity, isNaN, parseFloat, parseInt,
    btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
    atob(value) { return Buffer.from(value, 'base64').toString('binary'); },
    Sound: { play() {}, playAt() {}, emit() {} },
    UI: { toast() {}, itemPicked() {}, hit() {} },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    document: { createElement() { return createTestCanvas(); } },
    Image: TestImage,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const files = ['util', 'noise', 'textures', 'resource-pack', 'blocks', 'model-loader', 'gl', 'world', 'physics', 'mesher', 'entities', 'player', 'renderer', 'craft', 'save'];
  if (options && options.ui) files.push('ui');
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file + '.js'), 'utf8'), context, { filename: file + '.js' });
  }
  return sandbox;
}

test('original resource pack switches HUD icons and widgets to the 1.12.2 GUI sheets', async () => {
  const { UI } = loadGameCore({ ui: true });
  await UI.setResourcePack('original_1_12');
  const info = UI.guiInfo();
  assert.equal(info.resourcePack, 'original_1_12');
  assert.equal(info.originalReady, true);
  assert.ok(info.previewBaseYaw > Math.PI && info.previewBaseYaw < Math.PI * 1.5,
    'the inventory player preview should face the viewer instead of showing the back of the head');
  for (const name of ['heart_empty', 'heart_full', 'heart_half', 'food_empty', 'food_full', 'food_half',
    'armor_empty', 'armor_full', 'armor_half', 'air', 'xp_bg', 'xp_fill', 'crosshair', 'hotbar', 'selector']) {
    assert.ok(info.originalSprites.includes(name), 'missing original GUI sprite ' + name);
  }
  if (HAS_OPTIONAL_ORIGINAL_ASSETS) {
    for (const asset of info.originalAssets) assert.equal(fs.existsSync(path.join(ROOT, asset)), true, 'missing GUI asset ' + asset);
  }
  await UI.setResourcePack('default');
  assert.equal(UI.guiInfo().resourcePack, 'default');
  assert.equal(UI.shouldDrawGameplayHud(null), true);
  assert.equal(UI.shouldDrawGameplayHud({ type: 'inventory' }), false,
    'container screens must hide the underlying hotbar and its item-count text');
});

test('new item registry, textures, drops, recipes and smelting form survival loops', () => {
  const { Blocks, Items, Craft, Textures } = loadGameCore();
  Textures.build();
  assert.equal(Textures.atlas.size, 512);
  assert.ok(Textures.packInfo('original_1_12').entries > 300);
  assert.deepEqual(Array.from(Textures.availablePacks(), pack => pack.id), ['default', 'original_1_12']);
  for (const [name, file, dest] of [
    ['__skin_steve', 'steve.png', [0, 448, 64, 64]],
    ['__skin_alex', 'alex.png', [64, 448, 64, 64]],
    ['__skin_miner', 'steve.png', [128, 448, 64, 64]],
    ['__skin_wanderer', 'alex.png', [192, 448, 64, 64]],
  ]) {
    const info = Textures.packTextureInfo('original_1_12', name);
    assert.ok(info.path.endsWith('/' + file), 'wrong original skin source for ' + name);
    assert.deepEqual(Array.from(info.dest), dest, 'wrong reserved atlas page for ' + name);
    if (HAS_OPTIONAL_ORIGINAL_ASSETS) {
      assert.equal(fs.existsSync(path.join(ROOT, info.path)), true, 'missing original player skin ' + file);
    }
  }
  assert.ok(Textures.packTextureInfo('original_1_12', 'oak_door').path.endsWith('/items/door_wood.png'));
  assert.ok(Textures.packTextureInfo('original_1_12', 'iron_door').path.endsWith('/items/door_iron.png'));
  for (const name of [
    'zombie_head_front', 'zombie_body_back', 'zombie_arm_left', 'zombie_leg_right',
    'skeleton_head_front', 'skeleton_body_top', 'skeleton_limb_right',
    'creeper_head_front', 'creeper_body_back', 'creeper_leg_left', 'creeper_charge',
    'spider_head', 'spider_body', 'spider_leg', 'slime', 'slime_core', 'slime_eye', 'slime_mouth',
    'enderman', 'enderman_face', 'blaze', 'blaze_face', 'blaze_rod_mob',
    'villager_face', 'villager_robe', 'villager_farmer', 'villager_librarian',
    'villager_toolsmith', 'villager_butcher', 'villager_cleric', 'iron_golem', 'iron_golem_face',
    'villager_original_farmer_head_front', 'villager_original_farmer_nose_front',
    'villager_original_farmer_robe_back', 'iron_golem_original_head_front',
    'iron_golem_original_body_back', 'iron_golem_original_arm_left_front',
    'iron_golem_original_leg_right_top',
    'cow_horn_front', 'cow_udder_top', 'cow_udder_bottom',
    'sheep_wool_head_front', 'sheep_wool_leg_front',
    'chicken_body_front', 'chicken_head_left', 'chicken_wing_right',
  ]) assert.equal(Textures.packHasTexture('original_1_12', name), true, 'missing original mob texture ' + name);
  const textureNames = new Set(Textures.names());
  for (const block of Object.values(Blocks.all)) {
    for (const name of Object.values(block.tex || {})) if (typeof name === 'string') assert.ok(textureNames.has(name), 'missing block texture ' + name);
    for (const name of block.stateTextures || []) assert.ok(textureNames.has(name), 'missing state texture ' + name);
  }
  for (const item of Object.values(Items.all)) {
    if (item.tex) assert.ok(textureNames.has(item.tex), 'missing item texture ' + item.tex);
  }
  assert.equal(Blocks.ID.IRON_BLOCK, 54);
  assert.equal(Blocks.ID.LADDER, 55);
  assert.equal(Blocks.ID.COBWEB, 56);
  assert.equal(Blocks.ID.SOUL_SAND, 57);
  assert.equal(Blocks.ID.OAK_STAIRS, 58);
  assert.equal(Blocks.ID.OAK_FENCE, 59);
  assert.equal(Blocks.ID.LEVER, 60);
  assert.equal(Blocks.ID.REDSTONE_LAMP, 61);
  assert.equal(Blocks.ID.REDSTONE_LAMP_LIT, 62);
  assert.equal(Blocks.ID.BELL, 91);
  assert.equal(Blocks.ID.COMPOSTER, 92);
  assert.equal(Blocks.ID.LECTERN, 93);
  assert.equal(Blocks.ID.GRINDSTONE, 94);
  assert.equal(Blocks.ID.SMITHING_TABLE, 95);
  assert.equal(Blocks.ID.SMOKER, 96);
  assert.equal(Items.get(Items.IT.EGG).throwable, 'egg');
  assert.equal(Items.get(Items.IT.ENDER_PEARL).throwable, 'ender_pearl');
  assert.equal(Items.IT.REDSTONE, 323);
  assert.equal(Items.IT.HOE_DIAMOND, 364);
  assert.equal(Items.durabilityOf(Items.IT.BOW), 385);
  assert.equal(Items.get(Items.IT.HELMET_DIAMOND).armor.slot, 0);
  assert.equal(Blocks.dropsFor(Blocks.ID.TALLGRASS, 0, () => 0)[0].id, Items.IT.WHEAT_SEEDS);
  assert.equal(Blocks.dropsFor(Blocks.ID.GRAVEL, 0, () => 0)[0].id, Items.IT.FLINT);
  assert.equal(Items.SMELT[Items.IT.CHICKEN_RAW].id, Items.IT.CHICKEN_COOKED);
  assert.equal(Items.SMELT[Items.IT.CLAY_BALL].id, Items.IT.BRICK);

  const P = Blocks.ID.PLANKS;
  const bow = Craft.match([
    null, { id: Items.IT.STICK, n: 1 }, { id: Items.IT.STRING, n: 1 },
    { id: Items.IT.STICK, n: 1 }, null, { id: Items.IT.STRING, n: 1 },
    null, { id: Items.IT.STICK, n: 1 }, { id: Items.IT.STRING, n: 1 },
  ]);
  assert.equal(bow.out.id, Items.IT.BOW);
  const bookshelf = Craft.match([
    { id: P, n: 1 }, { id: P, n: 1 }, { id: P, n: 1 },
    { id: Items.IT.BOOK, n: 1 }, { id: Items.IT.BOOK, n: 1 }, { id: Items.IT.BOOK, n: 1 },
    { id: P, n: 1 }, { id: P, n: 1 }, { id: P, n: 1 },
  ]);
  assert.equal(bookshelf.out.id, Blocks.ID.BOOKSHELF);
  const ladder = Craft.match([
    { id: Items.IT.STICK, n: 1 }, null, { id: Items.IT.STICK, n: 1 },
    { id: Items.IT.STICK, n: 1 }, { id: Items.IT.STICK, n: 1 }, { id: Items.IT.STICK, n: 1 },
    { id: Items.IT.STICK, n: 1 }, null, { id: Items.IT.STICK, n: 1 },
  ]);
  assert.equal(ladder.out.id, Blocks.ID.LADDER);
  const stairs = Craft.match([
    { id: P, n: 1 }, null, null,
    { id: P, n: 1 }, { id: P, n: 1 }, null,
    { id: P, n: 1 }, { id: P, n: 1 }, { id: P, n: 1 },
  ]);
  assert.equal(stairs.out.id, Blocks.ID.OAK_STAIRS);

  const I = Items.IT.IRON_INGOT;
  const helmet = Craft.match([
    { id: I, n: 1 }, { id: I, n: 1 }, { id: I, n: 1 },
    { id: I, n: 1 }, null, { id: I, n: 1 },
    null, null, null,
  ]);
  assert.equal(helmet.out.id, Items.IT.HELMET_IRON, 'the iron helmet shape must not match the bucket recipe');
  const bucket = Craft.match([
    { id: I, n: 1 }, null, { id: I, n: 1 },
    null, { id: I, n: 1 }, null,
    null, null, null,
  ]);
  assert.equal(bucket.out.id, Items.IT.BUCKET, 'the V-shaped bucket recipe must produce a bucket');

  const visibleInventory = Array(36).fill(null);
  visibleInventory[0] = Items.makeStack(P, 3);
  const profileInventory = Items.inventoryWithTransient(visibleInventory, [Items.makeStack(P, 2), Items.makeStack(Items.IT.PICK_IRON, 1)]);
  assert.equal(profileInventory[0].n, 5, 'crafting-grid stacks should remain represented in multiplayer profiles');
  assert.ok(profileInventory.some(stack => stack && stack.id === Items.IT.PICK_IRON && stack.dur === Items.durabilityOf(Items.IT.PICK_IRON)));
  assert.equal(visibleInventory[0].n, 3, 'building a profile snapshot must not mutate the visible inventory');
});

test('original 1.12.2 model sizes are the global entity baseline', () => {
  const { Entities, Textures } = loadGameCore();
  Entities.clear();
  const pig = Entities.spawnMob('pig', 0, 1, 0);
  const originalStats = Entities.modelStats('pig');
  assert.equal(originalStats.profile, 'original');
  assert.equal(originalStats.parts, 7);
  assert.deepEqual(Array.from(originalStats.sizes[0]), [10, 16, 8]);
  assert.deepEqual(Array.from(originalStats.centers[0]), [0, 10, 0]);
  assert.deepEqual(Array.from(originalStats.headPivot), [0, 12, -6]);
  assert.equal(pig.model.parts.length, 7);

  const cowStats = Entities.modelStats('cow');
  assert.deepEqual(Array.from(cowStats.centers[1]), [0, 20, -11]);
  assert.deepEqual(Array.from(cowStats.centers[4]), [0, 11.5, 7]);
  assert.equal(cowStats.textures[4].top, 'cow_udder_top');
  assert.equal(cowStats.textures[4].bottom, 'cow_udder_bottom');
  assert.notEqual(cowStats.textures[4].top, cowStats.textures[4].bottom);

  const sheepStats = Entities.modelStats('sheep');
  const sheepFaceZ = sheepStats.centers[2][2] - sheepStats.sizes[2][2] / 2;
  const woolFaceZ = sheepStats.centers[3][2] - sheepStats.sizes[3][2] / 2;
  assert.ok(sheepFaceZ < woolFaceZ - 1, 'the skin face must project beyond the wool head layer');
  assert.deepEqual(Array.from(sheepStats.sizes[3]), [7.2, 7.2, 7.2]);
  assert.equal(sheepStats.textures[3].front, 'sheep_wool_head_front');

  const udderTop = Textures.packTextureInfo('original_1_12', 'cow_udder_top');
  const udderBottom = Textures.packTextureInfo('original_1_12', 'cow_udder_bottom');
  assert.deepEqual(Array.from(udderTop.source), [53, 0, 4, 1]);
  assert.deepEqual(Array.from(udderBottom.source), [57, 0, 4, 1]);
  assert.equal(Entities.modelStats('chicken').parts, 8);
  assert.deepEqual(Array.from(Entities.modelStats('chicken').headPivot), [0, 9, -4]);
  assert.deepEqual(Array.from(Entities.modelStats('wolf').sizes[2]), [3, 3, 4]);
  assert.deepEqual(Array.from(Entities.modelStats('player').sizes[1]), [8.5, 12.5, 4.5]);
  assert.deepEqual(Array.from(Entities.modelStats('spider').sizes[0]), [8, 8, 8]);
  assert.deepEqual(Array.from(Entities.modelStats('spider').sizes[3]), [16, 2, 2]);
  assert.deepEqual(Array.from(Entities.modelStats('slime').sizes[0]), [9, 9, 9]);
  assert.deepEqual(Array.from(Entities.modelStats('enderman').sizes[0]), [8, 12, 4]);
  assert.deepEqual(Array.from(Entities.modelStats('enderman').sizes[2]), [2, 30, 2]);
  assert.deepEqual(Array.from(Entities.modelStats('iron_golem').sizes[0]), [18, 12, 11]);
  assert.deepEqual(Array.from(Entities.modelStats('iron_golem').sizes[4]), [4, 30, 6]);
  assert.deepEqual(Array.from(Entities.modelStats('iron_golem').sizes[6]), [2, 4, 2]);
  assert.deepEqual(Array.from(Entities.modelStats('iron_golem').sizes[7]), [10, 6, 7]);
  assert.equal(Entities.modelStats('iron_golem').textures[1].front, 'iron_golem_original_head_front');
  assert.deepEqual(Array.from(Entities.modelStats('villager').sizes[0]), [8, 12, 6]);
  assert.deepEqual(Array.from(Entities.modelStats('villager').sizes[1]), [8, 10, 8]);
  assert.deepEqual(Array.from(Entities.modelStats('villager').centers[2]), [0, 25, -5]);
  assert.deepEqual(Array.from(Entities.modelStats('villager').headPivot), [0, 24, 0]);
  assert.equal(Entities.modelStats('villager').textures[1].front, 'villager_original_unemployed_head_front');

  const villagerHead = Textures.packTextureInfo('original_1_12', 'villager_original_farmer_head_front');
  const villagerNose = Textures.packTextureInfo('original_1_12', 'villager_original_farmer_nose_front');
  const golemArm = Textures.packTextureInfo('original_1_12', 'iron_golem_original_arm_left_front');
  assert.ok(villagerHead.path.endsWith('/entity/villager/farmer.png'));
  assert.deepEqual(Array.from(villagerHead.source), [8, 8, 8, 10]);
  assert.deepEqual(Array.from(villagerNose.source), [26, 2, 2, 4]);
  assert.deepEqual(Array.from(golemArm.source), [66, 64, 4, 30]);

  const farmer = Entities.spawnMob('villager', 2, 1, 0);
  farmer.profession = 'farmer';
  assert.equal(Entities.setModelProfile('default'), true);
  assert.equal(pig.model.parts.length, 10);
  assert.equal(Entities.setModelProfile('original'), true);
  assert.equal(pig.model.parts.length, 7);
  assert.equal(farmer.model.parts[1].tex.front, 'villager_original_farmer_head_front');
  assert.equal(farmer.model.parts[6].tex.back, 'villager_original_farmer_robe_back');
  Entities.clear();
});

test('sword, pickaxe and block use vanilla-like held poses and attack axes', () => {
  const { Blocks, Items, Renderer, GL, Textures } = loadGameCore();
  Textures.build();
  const sword = Items.get(Items.IT.SWORD_DIAMOND).display;
  const pickaxe = Items.get(Items.IT.PICK_DIAMOND).display;
  const block = Items.get(Blocks.ID.STONE).display;

  assert.ok(Math.abs(sword.firstPerson.rot[2] - 25 * Math.PI / 180) < 1e-6);
  assert.ok(Math.abs(sword.firstPerson.rot[1] + Math.PI / 4) < 1e-6,
    'right-hand sword should adapt vanilla -90 degrees into the runtime hand basis');
  assert.ok(sword.firstPerson.scale >= 0.67 && sword.firstPerson.scale <= 0.69);
  assert.equal(sword.firstPerson.attach, 'hand');
  assert.ok(sword.firstPerson.grip[0] < -0.25 && sword.firstPerson.grip[1] < -0.25,
    'the hand should cover the brown sword handle instead of the crossguard');
  assert.ok(sword.thirdPerson.grip[1] < -0.3);

  // Verify the visible blade axis after the same transforms used by drawHand.
  const idleAttachment = Renderer.handAttachmentStats(Items.IT.SWORD_DIAMOND, 'idle', 0);
  const swordMatrix = GL.mat4.create();
  GL.mat4.translate(swordMatrix, swordMatrix, ...idleAttachment.anchor);
  GL.mat4.rotX(swordMatrix, swordMatrix, sword.firstPerson.rot[0]);
  GL.mat4.rotY(swordMatrix, swordMatrix, sword.firstPerson.rot[1]);
  GL.mat4.rotZ(swordMatrix, swordMatrix, sword.firstPerson.rot[2]);
  GL.mat4.translate(swordMatrix, swordMatrix,
    -sword.firstPerson.grip[0] * sword.firstPerson.scale,
    -sword.firstPerson.grip[1] * sword.firstPerson.scale,
    -sword.firstPerson.grip[2] * sword.firstPerson.scale);
  GL.mat4.scale(swordMatrix, swordMatrix,
    sword.firstPerson.scale, sword.firstPerson.scale, sword.firstPerson.scale);
  const projectX = ([x, y, z]) => {
    const viewX = swordMatrix[0] * x + swordMatrix[4] * y + swordMatrix[8] * z + swordMatrix[12];
    const viewZ = swordMatrix[2] * x + swordMatrix[6] * y + swordMatrix[10] * z + swordMatrix[14];
    return viewX / -viewZ;
  };
  const gripX = projectX(sword.firstPerson.grip);
  const tipX = projectX([13 / 32, 15 / 32, 1 / 32]);
  assert.ok(Math.abs(tipX - gripX) > 0.03,
    'the original 25 degree item transform should keep the blade from becoming unnaturally vertical');

  assert.ok(pickaxe.firstPerson.rot[2] > 0.85 && pickaxe.firstPerson.rot[2] < 1.0);
  assert.equal(pickaxe.firstPerson.scale, sword.firstPerson.scale);
  assert.ok(pickaxe.firstPerson.grip[0] < -0.25 && pickaxe.firstPerson.grip[1] < -0.3,
    'the hand should cover the lower wooden tool handle');
  assert.ok(pickaxe.firstPerson.pos[2] <= -0.88);
  assert.equal(pickaxe.firstPerson.attach, 'hand');
  assert.ok(Items.get(Items.IT.FISHING_ROD).display.firstPerson.rot[1] > 0,
    'the handheld-rod parent uses the opposite Y rotation');
  assert.ok(block.firstPerson.rot[1] > 0.7 && Math.abs(block.firstPerson.rot[2]) < 0.01);
  assert.ok(block.thirdPerson.rotation[0] > 1.2 && block.thirdPerson.rotation[1] > 0.7);

  for (const id of [Blocks.ID.SAPLING, Blocks.ID.FLOWER_RED, Blocks.ID.FLOWER_YELLOW,
    Blocks.ID.LADDER, Blocks.ID.OAK_DOOR, Blocks.ID.IRON_DOOR, Blocks.ID.OAK_SIGN]) {
    assert.equal(Items.get(id).handModel, 'sprite', Items.get(id).name + ' should use a flat item model');
    assert.ok(Renderer.handModelStats(id).depth < 0.1, Items.get(id).name + ' should not become a cube');
  }
  for (const id of [Blocks.ID.SAPLING, Blocks.ID.OAK_DOOR, Items.IT.APPLE,
    Items.IT.ENDER_PEARL, Items.IT.FLINT_STEEL]) {
    assert.deepEqual(Array.from(Items.get(id).display.firstPerson.rot), [0, 0, 0],
      Items.get(id).name + ' should face forward instead of pointing left or right');
  }
  const trapdoorBoxes = Blocks.itemModelBoxes(Blocks.ID.OAK_TRAPDOOR);
  assert.equal(trapdoorBoxes.length, 1);
  assert.equal(trapdoorBoxes[0].h, 3 / 16);
  assert.equal(Renderer.handModelStats(Blocks.ID.OAK_TRAPDOOR).height, 3 / 16,
    'trapdoor hand geometry should preserve its thin model');
  assert.ok(Blocks.itemModelBoxes(Blocks.ID.OAK_FENCE).length > 1,
    'fence hand geometry should include its posts and rails');
  assert.equal(Renderer.handModelStats(Blocks.ID.STONE).depth, 1,
    'full blocks should keep the cube item model');

  const attack = Renderer.handAnimationPose('attack', 0.5, 0, 'sword');
  assert.ok(attack.x > -0.15, 'the grip should stay near the hand instead of striking first');
  assert.ok(attack.rz > 0.8, 'the blade should sweep inward in this renderer coordinate system');
  assert.ok(Math.abs(attack.rx) < 0.3, 'X rotation should only add wrist follow-through');
  const strikeAngle = sword.firstPerson.rot[2] + attack.rz;
  assert.ok(-Math.sin(strikeAngle) < -0.85, 'the blade tip should lead toward screen center');
  for (const [id, action] of [
    [Items.IT.SWORD_DIAMOND, 'idle'], [Items.IT.SWORD_DIAMOND, 'attack'],
    [Items.IT.PICK_DIAMOND, 'mine'], [Items.IT.AXE_DIAMOND, 'mine'],
    [Items.IT.SHOVEL_DIAMOND, 'mine'], [Items.IT.HOE_DIAMOND, 'mine'],
    [Items.IT.SHEARS, 'idle'], [Items.IT.BOW, 'idle'], [Items.IT.FISHING_ROD, 'idle'],
  ]) {
    const attachment = Renderer.handAttachmentStats(id, action, action === 'idle' ? 0 : 0.5);
    assert.equal(attachment.attached, true);
    assert.ok(attachment.gap < 1e-6, 'held item grip must remain attached to the hand anchor');
  }
});

test('generated player skins keep two separated eyes on the front face', () => {
  const { Textures } = loadGameCore();
  const atlas = Textures.build();
  const uv = Textures.uv('skin.steve.head.front');
  const left = Math.floor(uv[0] * atlas.size);
  const top = Math.floor(uv[1] * atlas.size);
  const image = atlas.canvas.getContext('2d').getImageData(left, top, 8, 8).data;
  const pixel = (x, y) => Array.from(image.slice((y * 8 + x) * 4, (y * 8 + x + 1) * 4));

  assert.deepEqual(pixel(1, 4), pixel(6, 4), 'both eye whites should be present');
  assert.deepEqual(pixel(2, 4), pixel(5, 4), 'both pupils should be present');
  assert.notDeepEqual(pixel(2, 4), pixel(3, 4), 'skin pixels must separate the two pupils');
  assert.notDeepEqual(pixel(4, 4), pixel(5, 4), 'the second pupil must not merge into a single central eye');
});

test('stairs, fences and lever-powered lamps share collision and visual state', () => {
  const { World, Blocks, Physics, Mesher, Textures } = loadGameCore();
  Textures.build();
  const world = new World(183);
  world.ensureChunk(0, 0);
  const y = 200;

  world.setBlock(7, y, 8, Blocks.ID.OAK_STAIRS);
  world.setState(7, y, 8, 0);
  const stairShapes = Physics.blockShapes(world, 7, y, 8);
  assert.equal(stairShapes.length, 2);
  assert.equal(stairShapes[0].h, 0.5);

  world.setBlock(10, y, 8, Blocks.ID.OAK_FENCE);
  const isolatedFence = Physics.blockShapes(world, 10, y, 8);
  world.setBlock(11, y, 8, Blocks.ID.OAK_FENCE);
  const connectedFence = Physics.blockShapes(world, 10, y, 8);
  assert.ok(connectedFence.length > isolatedFence.length, 'neighboring fences should add a connecting arm');

  world.setBlock(4, y - 1, 8, Blocks.ID.STONE);
  world.setBlock(4, y, 8, Blocks.ID.LEVER);
  world.setBlock(5, y, 8, Blocks.ID.REDSTONE_LAMP);
  world.setState(4, y, 8, 1);
  assert.equal(world.getBlock(5, y, 8), Blocks.ID.REDSTONE_LAMP_LIT);
  assert.equal(world.getBlkLight(5, y, 8), 15);
  world.setState(4, y, 8, 0);
  assert.equal(world.getBlock(5, y, 8), Blocks.ID.REDSTONE_LAMP);

  const mesh = Mesher.mesh(world, world.chunkOf(8, 8), y >> 4);
  assert.ok(mesh.opaque.count + mesh.alpha.count > 0);
});

test('model elements and item display transforms are data driven across render contexts', () => {
  const { World, Blocks, Items } = loadGameCore();
  const world = new World(1840);
  world.ensureChunk(0, 0);
  const off = Blocks.modelElements(Blocks.ID.LEVER, world, 4, 200, 8, 0);
  const on = Blocks.modelElements(Blocks.ID.LEVER, world, 4, 200, 8, 1);
  assert.equal(Blocks.get(Blocks.ID.LEVER).shape, 'model');
  assert.equal(off.length, 2);
  assert.equal(off[1].rotation.axis, 'z');
  assert.equal(off[1].rotation.angle, 45);
  assert.equal(on[1].rotation.angle, -45);

  for (const id of [Blocks.ID.STONE, Blocks.ID.TORCH, Items.IT.PICK_IRON, Items.IT.SWORD_IRON, Items.IT.APPLE, Items.IT.BOW]) {
    const item = Items.get(id);
    assert.ok(item.display.firstPerson && item.display.thirdPerson && item.display.ground && item.display.inventory,
      'missing display transform for item ' + id);
    assert.equal(item.handPose, item.display.firstPerson, 'legacy hand pose should share the first-person transform');
  }
  assert.equal(Items.get(Blocks.ID.STONE).display.thirdPerson.model, 'block');
  assert.equal(Items.get(Items.IT.SWORD_IRON).display.thirdPerson.model, 'sprite');
  const blockDisplay = Items.get(Blocks.ID.STONE).display;
  const itemDisplay = Items.get(Items.IT.APPLE).display;
  const toolDisplay = Items.get(Items.IT.PICK_IRON).display;
  assert.equal(blockDisplay.firstPerson.scale, 0.40);
  assert.equal(blockDisplay.thirdPerson.scale, 0.375 / 2);
  assert.equal(blockDisplay.ground.scale, 0.25 / 0.28);
  assert.equal(blockDisplay.inventory.scale, 0.625);
  assert.equal(itemDisplay.firstPerson.scale, 0.68);
  assert.equal(itemDisplay.thirdPerson.scale, 0.55 / 2);
  assert.equal(itemDisplay.ground.scale, 0.50 / 0.44);
  assert.equal(toolDisplay.firstPerson.scale, 0.68);
  assert.equal(toolDisplay.thirdPerson.scale, 0.85 / 2);
});

test('vanilla model JSON maps inherited textures, face UVs and whole-model rotations into runtime elements', () => {
  const { VanillaModels, Blocks } = loadGameCore();
  const itemDisplay = VanillaModels.compileItemDisplayData({
    display: { firstperson_righthand: {
      rotation: [0, -90, 25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68],
    } },
  }, { attach:'hand', grip:[-0.28, -0.28, 0] });
  assert.deepEqual(Array.from(itemDisplay.vanillaTransform.rotation), [0, -90, 25]);
  assert.deepEqual(Array.from(itemDisplay.vanillaTransform.translation), [1.13, 3.2, 1.13]);
  assert.deepEqual(Array.from(itemDisplay.vanillaTransform.scale), [0.68, 0.68, 0.68]);
  assert.ok(Math.abs(itemDisplay.rot[1] + Math.PI / 4) < 1e-6);
  assert.ok(Math.abs(itemDisplay.rot[2] - 25 * Math.PI / 180) < 1e-6);
  assert.equal(itemDisplay.scale, 0.68);
  assert.equal(itemDisplay.model, 'generated');
  const elements = VanillaModels.compileModelData({
    textures: { all: 'blocks/dragon_egg' },
    elements: [{
      from: [2, 1, 3], to: [14, 15, 13],
      faces: {
        north: { texture: '#all', uv: [2, 1, 14, 15], rotation: 90 },
        east: { texture: '#all', uv: [3, 1, 13, 15] },
      },
    }],
  }, { y: 90 }, 'stone');
  assert.equal(elements.length, 1);
  assert.equal(elements[0].faces.front.texture, 'dragon_egg');
  assert.equal(elements[0].faces.front.rotation, 90);
  assert.equal(elements[0].faces.right.texture, 'dragon_egg');
  assert.equal(elements[0].modelRotation.y, 90);
  assert.equal(Blocks.installModel(Blocks.ID.DRAGON_EGG, elements, 'dragon_egg'), true);
  assert.equal(Blocks.get(Blocks.ID.DRAGON_EGG).modelResource, 'dragon_egg');
});

test('door models use separate halves and mirrored hinge variants', () => {
  const { Blocks, Textures, VanillaModels } = loadGameCore();
  assert.equal(Blocks.get(Blocks.ID.OAK_DOOR).tex.all, 'oak_door_lower');
  assert.equal(Blocks.get(Blocks.ID.OAK_DOOR_TOP).tex.all, 'oak_door_upper');
  assert.equal(Blocks.get(Blocks.ID.IRON_DOOR).tex.all, 'iron_door_lower');
  assert.equal(Blocks.get(Blocks.ID.IRON_DOOR_TOP).tex.all, 'iron_door_upper');
  for (const [name, file] of [
    ['oak_door_lower', 'door_wood_lower.png'], ['oak_door_upper', 'door_wood_upper.png'],
    ['iron_door_lower', 'door_iron_lower.png'], ['iron_door_upper', 'door_iron_upper.png'],
  ]) {
    assert.ok(Textures.packTextureInfo('original_1_12', name).path.endsWith('/' + file));
  }

  const states = VanillaModels.doorStates('wooden_door_bottom');
  assert.equal(states.length, 16);
  assert.deepEqual({ name:states[0].name, y:states[0].y }, { name:'wooden_door_bottom', y:90 });
  assert.deepEqual({ name:states[4].name, y:states[4].y }, { name:'wooden_door_bottom_rh', y:180 });
  assert.deepEqual({ name:states[8].name, y:states[8].y }, { name:'wooden_door_bottom_rh', y:90 });
  assert.deepEqual({ name:states[12].name, y:states[12].y }, { name:'wooden_door_bottom', y:0 });
});

test('doors keep paired state, hinge collision and two-block cleanup consistent', () => {
  const { World, Player, Blocks, Items, Physics } = loadGameCore();
  const world = new World(1842);
  world.ensureChunk(0, 0);
  const y = 200;
  for (let x = 6; x <= 11; x++) world.setBlock(x, y - 1, 8, Blocks.ID.STONE);

  const player = new Player(world);
  player.mode = 'creative';
  player.x = 2.5; player.y = y; player.z = 2.5;
  player.inv[0] = Items.makeStack(Blocks.ID.OAK_DOOR, 1);
  player.hotbar = 0;
  player.yaw = 0;
  player.look = () => ({ x:8, y:y - 1, z:8, id:Blocks.ID.STONE, face:[0, 1, 0], dist:2 });
  player.placeBlock();
  player.useCooldown = 0;
  player.look = () => ({ x:9, y:y - 1, z:8, id:Blocks.ID.STONE, face:[0, 1, 0], dist:2 });
  player.placeBlock();

  const firstState = world.getState(8, y, 8);
  const secondState = world.getState(9, y, 8);
  assert.equal(firstState & 3, secondState & 3);
  assert.notEqual(!!(firstState & 8), !!(secondState & 8), 'double doors should hinge on opposite outer edges');
  assert.equal(world.getState(8, y + 1, 8), firstState);
  assert.equal(world.getState(9, y + 1, 8), secondState);

  world.setDoorState(8, y, 8, (firstState & 3) | 4);
  const leftOpen = Physics.blockShapes(world, 8, y, 8)[0];
  world.setDoorState(8, y + 1, 8, (firstState & 3) | 8 | 4);
  const rightOpen = Physics.blockShapes(world, 8, y, 8)[0];
  assert.notEqual(leftOpen.x, rightOpen.x, 'opposite hinges must open against opposite sides of the block');
  assert.equal(world.getState(8, y, 8), world.getState(8, y + 1, 8));

  const popped = [];
  world.onBlockPopped = (x, py, z, id) => popped.push({ x, y:py, z, id });
  world.setBlock(8, y + 1, 8, Blocks.ID.STONE);
  assert.equal(world.getBlock(8, y, 8), Blocks.ID.AIR);
  assert.equal(world.getBlock(8, y + 1, 8), Blocks.ID.STONE);
  assert.ok(popped.some(entry => entry.id === Blocks.ID.OAK_DOOR));

  world.setBlock(10, y, 8, Blocks.ID.OAK_DOOR);
  world.setBlock(10, y + 1, 8, Blocks.ID.OAK_DOOR_TOP);
  world.setDoorState(10, y, 8, 8);
  world.setBlock(10, y - 1, 8, Blocks.ID.AIR);
  assert.equal(world.getBlock(10, y, 8), Blocks.ID.AIR);
  assert.equal(world.getBlock(10, y + 1, 8), Blocks.ID.AIR);
});

test('model boxes can crop and texture individual faces without repeating one full tile', () => {
  const { World, Blocks, Mesher, Textures } = loadGameCore();
  Textures.build();
  const world = new World(1841);
  const chunk = world.ensureChunk(0, 0);
  const y = 200;
  const block = Blocks.get(Blocks.ID.DRAGON_EGG);
  block.modelElements = null;
  block.modelBoxes = [{
    x:0, y:0, z:0, w:1, h:1, d:1,
    faces: {
      top: { tile:'grass_top', uv:[0, 0, 8, 8] },
      front: { tile:'stone', uv:[0, 0, 16, 16] },
    },
  }];
  world.setBlock(8, y, 8, Blocks.ID.DRAGON_EGG);
  const mesh = Mesher.mesh(world, chunk, y >> 4).opaque;
  assert.equal(mesh.count, 12, 'only the two declared model faces should be emitted');
  const topUV = Array.from(mesh.verts.slice(3, 5));
  const frontUV = Array.from(mesh.verts.slice(4 * 7 + 3, 4 * 7 + 5));
  assert.notDeepEqual(topUV, frontUV, 'each model face should retain its own texture and crop');
});

test('state blocks, signal strength and dimension progression share deterministic rules', () => {
  const { World, Blocks, Items, Physics, Entities, Craft } = loadGameCore();
  const world = new World(8128);
  world.ensureChunk(0, 0);
  const y = 200;
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) world.setBlock(x, y - 1, z, Blocks.ID.STONE);

  world.setBlock(2, y, 2, Blocks.ID.OAK_DOOR);
  world.setBlock(2, y + 1, 2, Blocks.ID.OAK_DOOR_TOP);
  world.setState(2, y, 2, 0); world.setState(2, y + 1, 2, 0);
  const closedDoor = Physics.blockShapes(world, 2, y, 2)[0];
  world.setState(2, y, 2, 4); world.setState(2, y + 1, 2, 4);
  const openDoor = Physics.blockShapes(world, 2, y, 2)[0];
  assert.notDeepEqual([closedDoor.w, closedDoor.d], [openDoor.w, openDoor.d]);
  world.setBlock(3, y, 2, Blocks.ID.OAK_FENCE_GATE); world.setState(3, y, 2, 4);
  assert.equal(Physics.blockShapes(world, 3, y, 2).length, 0, 'open fence gates must stop colliding');
  world.setBlock(4, y, 2, Blocks.ID.SNOW_LAYER); world.setState(4, y, 2, 5);
  assert.equal(Physics.blockShapes(world, 4, y, 2)[0].h, 0.75);
  world.setBlock(8, y, 2, Blocks.ID.IRON_DOOR); world.setBlock(8, y + 1, 2, Blocks.ID.IRON_DOOR_TOP);
  world.setDoorState(8, y, 2, 8);
  world.setBlock(7, y, 2, Blocks.ID.LEVER); world.setState(7, y, 2, 1);
  assert.ok(world.getState(8, y, 2) & 4, 'iron doors should open from redstone power');
  assert.ok(world.getState(8, y, 2) & 8, 'redstone opening should preserve the right hinge');
  assert.equal(world.getState(8, y + 1, 2), world.getState(8, y, 2));
  world.setState(7, y, 2, 0);
  assert.equal(world.getState(8, y, 2) & 4, 0);
  assert.ok(world.getState(8, y, 2) & 8, 'redstone closing should preserve the right hinge');

  world.setBlock(1, y, 8, Blocks.ID.LEVER);
  for (let x = 2; x <= 5; x++) { world.setBlock(x, y, 8, Blocks.ID.REDSTONE_WIRE); world.setState(x, y, 8, 0); }
  world.setBlock(6, y, 8, Blocks.ID.REDSTONE_LAMP);
  world.setState(1, y, 8, 1);
  assert.equal(world.getState(2, y, 8), 15);
  assert.equal(world.getState(5, y, 8), 12, 'redstone dust should lose one signal level per block');
  assert.equal(world.getBlock(6, y, 8), Blocks.ID.REDSTONE_LAMP_LIT);
  world.setState(1, y, 8, 0);
  assert.equal(world.getState(5, y, 8), 0);
  assert.equal(world.getBlock(6, y, 8), Blocks.ID.REDSTONE_LAMP);

  assert.equal(world.dayLen, 1200);
  assert.equal(world.dimensionAt(World.NETHER_OFFSET, 0), 'nether');
  assert.equal(world.dimensionAt(World.END_OFFSET, 0), 'end');
  const nether = world.ensureChunk(World.NETHER_OFFSET >> 4, 0);
  assert.ok(nether.blocks.some(id => id === Blocks.ID.NETHERRACK));
  const end = world.ensureChunk(World.END_OFFSET >> 4, 0);
  assert.ok(end.blocks.some(id => id === Blocks.ID.END_STONE));

  const frameX = 10, frameY = y, frameZ = 12;
  for (let ix = -1; ix <= 2; ix++) for (let iy = -1; iy <= 3; iy++) {
    const frame = ix === -1 || ix === 2 || iy === -1 || iy === 3;
    world.setBlock(frameX + ix, frameY + iy, frameZ, frame ? Blocks.ID.OBSIDIAN : Blocks.ID.AIR);
  }
  world.setBlock(frameX, frameY, frameZ, Blocks.ID.FIRE);
  assert.equal(world.tryCreateNetherPortal(frameX, frameY, frameZ), true);
  assert.equal(world.getBlock(frameX + 1, frameY + 2, frameZ), Blocks.ID.NETHER_PORTAL);

  for (const kind of ['slime', 'enderman', 'wolf', 'villager', 'cat', 'iron_golem', 'squid', 'bat', 'blaze']) {
    assert.ok(Entities.spawnMob(kind, 8.5, y, 8.5), 'missing mob model: ' + kind);
  }
  const dragon = Entities.spawnMob('ender_dragon', World.END_OFFSET + 8.5, 88, 8.5);
  assert.equal(dragon.maxHp, 200);
  Entities.hurtMob(world, dragon, 250, dragon.x - 1, dragon.z, 0);
  assert.equal(world.dragonDefeated, true);
  assert.equal(world.getBlock(World.END_OFFSET + 8, 64, 8), Blocks.ID.DRAGON_EGG);
  assert.equal(Items.get(Items.IT.REDSTONE).place, Blocks.ID.REDSTONE_WIRE);
  const eye = Craft.match([{ id: Items.IT.ENDER_PEARL, n: 1 }, { id: Items.IT.BLAZE_POWDER, n: 1 }, null, null]);
  assert.equal(eye.out.id, Items.IT.EYE_OF_ENDER);
});

test('blocking, stuck arrows and experience orbs follow survival combat rules', () => {
  const { World, Player, Blocks, Items, Entities } = loadGameCore();
  const world = new World(184);
  world.ensureChunk(0, 0);
  const y = 200;
  const player = new Player(world);
  player.inv.fill(null);
  player.inv[0] = Items.makeStack(Items.IT.SWORD_IRON, 1);
  player.updateUseActions(0.1, { use: true });
  assert.equal(player.isBlocking, true);
  const swordDurability = player.held().dur;
  player.damage(8, 'mob');
  assert.equal(player.hp, 16, 'sword blocking should halve mob damage');
  assert.equal(player.held().dur, swordDurability, 'blocking must not consume sword durability');
  assert.ok(player.blockHitTime > 0 && Entities.particles.length > 0, 'a successful block should produce feedback');
  player.hurtTime = 0;
  player.hp = 20;
  player.damage(8, 'explode');
  assert.equal(player.hp, 16, 'legacy sword blocking should also reduce explosion damage');

  const mover = new Player(world);
  mover.inv.fill(null);
  mover.inv[0] = Items.makeStack(Items.IT.SWORD_IRON, 1);
  mover.x = 10.5; mover.y = y; mover.z = 10.5; mover.onGround = true;
  for (let x = 9; x <= 11; x++) for (let z = 9; z <= 11; z++) world.setBlock(x, y - 1, z, Blocks.ID.STONE);
  mover.mining = { x: 1, y: 1, z: 1, progress: 0, total: 1 };
  mover.beginHandAction('mine', 0.3);
  mover.setBlocking(true, false);
  assert.equal(mover.mining, null, 'starting a block should cancel mining');
  mover.update(0.05, { fwd: true, sprint: true });
  assert.equal(mover.isSprinting, false);
  assert.ok(Math.hypot(mover.vx, mover.vz) < 1.1, 'blocking movement should use the legacy item-use slowdown');
  assert.ok(mover.blockBlend > 0 && mover.blockBlend < 1);
  mover.setBlocking(false, false);
  mover.updateHandAnimation(0.11);
  assert.equal(mover.blockBlend, 0, 'lowering the sword should finish its reverse blend');

  Entities.clear();
  world.setBlock(6, y, 8, Blocks.ID.STONE);
  world.setBlock(6, y + 1, 8, Blocks.ID.STONE);
  const arrow = Entities.spawnArrow(4.5, y + 0.8, 8.5, 20, 0, 0, 4);
  player.x = 1; player.y = y; player.z = 1;
  Entities.update(world, player, 0.1, 1);
  assert.equal(arrow.stuck, true);
  assert.equal(arrow.dead, false);

  let collected = 0;
  Entities.onXP = value => { collected += value; };
  Entities.spawnXP(player.x, player.y + 0.8, player.z, 5);
  Entities.update(world, player, 0.05, 1);
  assert.equal(collected, 5);
  Entities.onXP = null;
});

test('respawning clears airborne movement and active hand states at the exact spawn point', () => {
  const { World, Player, Blocks, Items } = loadGameCore();
  const world = new World(185);
  world.ensureChunk(0, 0);
  const y = world.genHeight(8, 8) + 1;
  for (let x = 7; x <= 9; x++) for (let z = 7; z <= 9; z++) {
    world.setBlock(x, y - 1, z, Blocks.ID.STONE);
    world.setBlock(x, y, z, Blocks.ID.AIR);
    world.setBlock(x, y + 1, z, Blocks.ID.AIR);
  }
  const player = new Player(world);
  player.spawn = { x:8.5, y, z:8.5 };
  player.x = 12; player.y = y + 7; player.z = 12;
  player.vx = 3; player.vy = 8; player.vz = -2;
  player.dead = true; player.hp = 0; player.onGround = false; player.flying = true;
  player.fallStart = y + 10; player.isSprinting = true; player.isSneaking = true;
  player.inv[0] = Items.makeStack(Items.IT.SWORD_IRON, 1);
  player.mining = { x:1, y:2, z:3, progress:0.5, total:1 };
  player.isBlocking = true; player.blockBlend = 1; player.beginHandAction('block', 1);
  player.statusEffects = [{ type:'regeneration', time:10, level:1 }];

  player.respawn();

  assert.deepEqual([player.x, player.y, player.z], [8.5, y, 8.5]);
  assert.deepEqual([player.vx, player.vy, player.vz], [0, 0, 0]);
  assert.equal(player.onGround, true);
  assert.equal(player.flying, false);
  assert.equal(player.fallStart, null);
  assert.equal(player.mining, null);
  assert.equal(player.isSprinting, false);
  assert.equal(player.isSneaking, false);
  assert.equal(player.isBlocking, false);
  assert.equal(player.handAction, 'idle');
  assert.equal(player.statusEffects.length, 0);
  player.update(0.05, {});
  assert.equal(player.onGround, true);
  assert.equal(player.y, y);
});

test('remote players visibly raise their held sword while blocking', () => {
  const { World, Entities, Items, Textures } = loadGameCore();
  Textures.build();
  const world = new World(186);
  world.ensureChunk(0, 0);
  const y = world.genHeight(8, 8) + 1;
  const remote = {
    id: 'guard-player', type: 'remote', kind: 'player', x: 8.5, y, z: 8.5,
    yaw: 0, headYaw: 0, headPitch: 0, age: 1, animPhase: 0, animSpeed: 0,
    attackAnim: 0, onGround: true, dead: false, held: Items.IT.SWORD_IRON,
    action: 'idle', blocking: false, blockBlend: 0,
  };
  Entities.clear();
  Entities.setRemoteProvider(() => [remote]);
  const idle = Array.from(Entities.buildGeometry(world, 8.5, y + 1.6, 12).normal.verts);
  remote.action = 'block'; remote.blocking = true; remote.blockBlend = 1;
  const guardingGeometry = Entities.buildGeometry(world, 8.5, y + 1.6, 12).normal;
  const guarding = Array.from(guardingGeometry.verts);
  Entities.setRemoteProvider(null);
  assert.ok(guardingGeometry.count > 444, 'the held sword should include front, back and pixel-thickness edge faces');
  let armMotion = 0;
  const armStart = 10 * 24 * 7;
  for (let i = armStart; i < armStart + 24 * 7; i += 7) {
    armMotion = Math.max(armMotion, Math.abs(guarding[i + 1] - idle[i + 1]), Math.abs(guarding[i + 2] - idle[i + 2]));
  }
  assert.ok(armMotion > 0.2, 'the sword arm should visibly move into a guard pose');
  const swordUv = Textures.uv(Items.get(Items.IT.SWORD_IRON).tex);
  const backStart = (12 * 24 + 4) * 7;
  const expectedBackUv = [
    [swordUv[0], swordUv[1]], [swordUv[2], swordUv[1]],
    [swordUv[2], swordUv[3]], [swordUv[0], swordUv[3]],
  ];
  for (let vertex = 0; vertex < 4; vertex++) {
    assert.ok(Math.abs(guarding[backStart + vertex * 7 + 3] - expectedBackUv[vertex][0]) < 1e-6);
    assert.ok(Math.abs(guarding[backStart + vertex * 7 + 4] - expectedBackUv[vertex][1]) < 1e-6,
      'the visible back face must preserve vertical item orientation');
  }
  assert.ok(guarding.every(Number.isFinite));
});

test('remote held blocks keep per-face textures and sprite items retain visible depth', () => {
  const { World, Entities, Blocks, Items, Textures } = loadGameCore();
  Textures.build();
  const world = new World(1861);
  world.ensureChunk(0, 0);
  const y = world.genHeight(8, 8) + 1;
  const remote = {
    id:'model-player', type:'remote', kind:'player', x:8.5, y, z:8.5,
    yaw:0, headYaw:0, headPitch:0, age:1, animPhase:0, animSpeed:0,
    attackAnim:0, onGround:true, dead:false, held:Blocks.ID.GRASS,
    action:'idle', blocking:false, blockBlend:0,
  };
  Entities.clear();
  Entities.setRemoteProvider(() => [remote]);
  const blockGeometry = Entities.buildGeometry(world, 8.5, y + 1.6, 12).normal;
  const heldStart = 12 * 24 * 7;
  const rightUV = Array.from(blockGeometry.verts.slice(heldStart + 3, heldStart + 5));
  const topUV = Array.from(blockGeometry.verts.slice(heldStart + 2 * 4 * 7 + 3, heldStart + 2 * 4 * 7 + 5));
  assert.notDeepEqual(rightUV, topUV, 'grass side and top must not share the same held-block UV');

  remote.held = Items.IT.SWORD_IRON;
  const heldItem = Entities.buildGeometry(world, 8.5, y + 1.6, 12).normal;
  assert.ok(heldItem.count > 444);
  Entities.setRemoteProvider(null);

  Entities.clear();
  Entities.setNetworkEntityProvider(() => [{
    id:'drop-depth', type:'item', itemId:Items.IT.STICK, count:1,
    x:8.5, y, z:8.5, age:0, dead:false,
  }]);
  const dropped = Entities.buildGeometry(world, 8.5, y + 1.6, 12).normal;
  Entities.setNetworkEntityProvider(null);
  const zValues = [];
  for (let i = 2; i < dropped.verts.length; i += 7) zValues.push(dropped.verts[i]);
  assert.ok(Math.max(...zValues) - Math.min(...zValues) > 0.005, 'a dropped sprite must have edge-on thickness');
  assert.ok(dropped.count > 12, 'a dropped sprite should include side faces');
});

test('remote player uses standard skin UV faces and second-layer geometry', () => {
  const { World, Entities, Textures } = loadGameCore();
  Textures.build();
  const textureNames = new Set(Textures.names());
  for (const name of [
    'remote_player_face', 'remote_player_head_back', 'remote_player_head_left',
    'remote_player_head_right', 'remote_player_head_top', 'remote_player_head_bottom',
    'remote_player_hair_front', 'remote_player_hair_back', 'remote_player_hair_left',
    'remote_player_hair_right', 'remote_player_hair_top', 'remote_player_hair_bottom',
  ]) assert.ok(textureNames.has(name), 'missing player texture ' + name);

  const world = new World(187);
  world.ensureChunk(0, 0);
  const y = world.genHeight(8, 8) + 1;
  const remote = {
    id: 'hair-player', type: 'remote', kind: 'player', x: 8.5, y, z: 8.5,
    yaw: 0, headYaw: 0, headPitch: 0, age: 1, animPhase: 0, animSpeed: 0,
    attackAnim: 0, onGround: true, dead: false, held: 0, blocking: false, blockBlend: 0,
  };
  Entities.clear();
  Entities.setRemoteProvider(() => [remote]);
  const geometry = Entities.buildGeometry(world, 8.5, y + 1.6, 12).normal;
  Entities.setRemoteProvider(null);
  assert.equal(geometry.count, 432, 'base skin and outer skin layers should produce twelve boxes');

  const faceTiles = [];
  const headStart = 2 * 24;
  for (let face = 0; face < 6; face++) {
    const offset = (headStart + face * 4) * 7;
    faceTiles.push(geometry.verts[offset + 3] + ',' + geometry.verts[offset + 4]);
  }
  assert.equal(new Set(faceTiles).size, 6, 'the scalp must not reuse a side-face texture');
});

test('player appearance sync geometry includes slim arms, armor and pose states', () => {
  const { World, Entities, Items, Textures } = loadGameCore();
  Textures.build();
  assert.deepEqual(Array.from(Textures.skinProfiles(), profile => profile.id), ['steve', 'alex', 'miner', 'wanderer']);
  const world = new World(188);
  world.ensureChunk(0, 0);
  const y = world.genHeight(8, 8) + 1;
  const remote = {
    id:'appearance-player', type:'remote', kind:'player', x:8.5, y, z:8.5,
    yaw:0, headYaw:0.45, headPitch:-0.2, age:1, animPhase:0.7, animSpeed:2,
    attackAnim:0, onGround:true, dead:false, held:0, blocking:false, blockBlend:0,
    skin:'alex', modelType:'slim', sneaking:false, sprinting:false, action:'idle', actionPhase:0,
    equipment:[
      { id:Items.IT.HELMET_IRON, enchanted:true }, { id:Items.IT.CHEST_IRON },
      { id:Items.IT.LEGS_IRON }, { id:Items.IT.BOOTS_IRON },
    ],
  };
  Entities.clear();
  Entities.setRemoteProvider(() => [remote]);
  const standingGeometry = Entities.buildGeometry(world, 8.5, y + 1.6, 12);
  const standing = standingGeometry.normal;
  assert.equal(standing.count, 756, 'twelve skin boxes plus nine armor boxes should render');
  assert.equal(standingGeometry.glint.count, 36, 'enchanted helmet should use a separate blended glint box');
  const standingVerts = Array.from(standing.verts);
  remote.sneaking = true;
  const sneaking = Entities.buildGeometry(world, 8.5, y + 1.6, 12).normal;
  const sneakingVerts = Array.from(sneaking.verts);
  remote.sneaking = false; remote.sprinting = true;
  const sprinting = Entities.buildGeometry(world, 8.5, y + 1.6, 12).normal;
  const sprintingVerts = Array.from(sprinting.verts);
  Entities.setRemoteProvider(null);
  assert.notDeepEqual(sneakingVerts.slice(0, 42), standingVerts.slice(0, 42));
  assert.notDeepEqual(sprintingVerts.slice(0, 42), standingVerts.slice(0, 42));
  assert.ok(standingVerts.every(Number.isFinite));
});

test('signature mob silhouettes use original part counts and baby head proportions', () => {
  const { World, Entities, Textures } = loadGameCore();
  Textures.build();
  const world = new World(189);
  world.ensureChunk(0, 0);
  const y = world.genHeight(8, 8) + 1;
  const countFor = kind => {
    Entities.clear();
    const mob = Entities.spawnMob(kind, 8.5, y, 8.5);
    mob.onGround = true;
    return Entities.buildGeometry(world, 8.5, y + 1, 12).normal.count;
  };
  assert.equal(countFor('spider'), 396, 'spider should have a head, neck, abdomen and eight legs');
  assert.equal(countFor('squid'), 324, 'squid should have a body and eight tentacles');
  assert.equal(countFor('blaze'), 468, 'blaze should have a head and twelve rods');
  assert.equal(countFor('slime'), 180, 'slime should include its translucent shell, core and face');

  Entities.clear();
  const adult = Entities.spawnMob('cow', 8.5, y, 8.5);
  adult.onGround = true;
  const adultGeometry = Entities.buildGeometry(world, 8.5, y + 1, 12).normal;
  const adultHeadTop = Math.max(...Array.from(adultGeometry.verts).filter((_, index) => index % 7 === 1));
  adult.babyTime = 300; adult.w *= 0.55; adult.h *= 0.55;
  const babyGeometry = Entities.buildGeometry(world, 8.5, y + 1, 12).normal;
  const babyHeadTop = Math.max(...Array.from(babyGeometry.verts).filter((_, index) => index % 7 === 1));
  assert.ok(babyHeadTop - y > (adultHeadTop - y) * 0.55, 'baby head should be proportionally larger than a uniform scale');
});

test('mob detail and animation remain continuous across former LOD boundaries', () => {
  const { World, Entities, Textures } = loadGameCore();
  Textures.build();
  const world = new World(1891);
  world.ensureChunk(0, 0);
  const y = world.genHeight(8, 8) + 1;
  Entities.clear();
  const chicken = Entities.spawnMob('chicken', 8.5, y, 8.5);
  chicken.onGround = true;
  const near = Entities.buildGeometry(world, 8.5, y + 1, 12).normal;
  const far = Entities.buildGeometry(world, 63.5, y + 1, 8.5).normal;
  assert.equal(far.count, near.count, 'beak, wings and other silhouette parts must not disappear at distance');

  Entities.clear();
  const zombie = Entities.spawnMob('zombie', 8.5, y, 8.5);
  zombie.onGround = true; zombie.animSpeed = 2; zombie.animPhase = 0.5;
  const legStart = 2 * 24 * 7;
  const first = Array.from(Entities.buildGeometry(world, 63.5, y + 1, 8.5).normal.verts.slice(legStart, legStart + 24 * 7));
  zombie.animPhase += 0.01;
  const second = Array.from(Entities.buildGeometry(world, 63.5, y + 1, 8.5).normal.verts.slice(legStart, legStart + 24 * 7));
  assert.notDeepEqual(first, second, 'far animation must use the current pose instead of a 3 FPS quantized pose');
});

test('first-person arms use the original 12-pixel Steve and Alex proportions', () => {
  const { Renderer } = loadGameCore();
  const classic = Renderer.playerArmModelStats('classic');
  const slim = Renderer.playerArmModelStats('slim');
  const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, message);
  assert.equal(classic.baseWidth, 1);
  assert.equal(slim.baseWidth, 0.75);
  assert.equal(classic.lengthAxis, 'y', 'skin arm length must follow the vertical UV axis');
  assert.equal(classic.lengthPixels, 12);
  assert.equal(classic.wristOffsetPixels, 6);
  close(classic.gripReach, -6 / 16, 'the original arm length must not move the held item grip');
  assert.ok(slim.width < classic.width, 'the Alex arm and sleeve should both be narrower in first person');
  for (const [actual, expected] of Array.from(classic.baseDimensions).map((value, i) => [value, [4 / 16, 12 / 16, 4 / 16][i]])) {
    close(actual, expected, 'classic arm should use the original 4x12x4 size');
  }
  for (const [actual, expected] of Array.from(slim.baseDimensions).map((value, i) => [value, [3 / 16, 12 / 16, 4 / 16][i]])) {
    close(actual, expected, 'slim arm should use the original 3x12x4 size');
  }
  for (const [actual, expected] of Array.from(classic.sleeveDimensions).map((value, i) => [value, [4.5 / 16, 12.5 / 16, 4.5 / 16][i]])) {
    close(actual, expected, 'classic sleeve should expand by half a skin pixel');
  }
  for (const [actual, expected] of Array.from(slim.sleeveDimensions).map((value, i) => [value, [3.5 / 16, 12.5 / 16, 4.5 / 16][i]])) {
    close(actual, expected, 'slim sleeve should expand by half a skin pixel');
  }
});

test('directional mob skins, joint animation, soft shadows and embedded arrows render independently', () => {
  const { World, Entities, Textures } = loadGameCore();
  Textures.build();
  const names = new Set(Textures.names());
  for (const prefix of ['skeleton_head', 'skeleton_body', 'skeleton_limb', 'wolf_head', 'cat_head', 'remote_armor_iron']) {
    for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
      assert.ok(names.has(prefix + '_' + face), 'missing directional texture ' + prefix + '_' + face);
    }
  }

  const world = new World(1890);
  world.ensureChunk(0, 0);
  const y = world.genHeight(8, 8) + 1;
  Entities.clear();
  const chicken = Entities.spawnMob('chicken', 8.5, y, 8.5);
  chicken.onGround = true; chicken.age = 0;
  const wingStart = 6 * 24 * 7;
  const firstWing = Array.from(Entities.buildGeometry(world, 8.5, y + 1, 12).normal.verts.slice(wingStart, wingStart + 24 * 7));
  chicken.age = 0.16;
  const movedWing = Array.from(Entities.buildGeometry(world, 8.5, y + 1, 12).normal.verts.slice(wingStart, wingStart + 24 * 7));
  assert.notDeepEqual(firstWing, movedWing, 'chicken wings should flap around their shoulder joints');

  Entities.clear();
  const zombie = Entities.spawnMob('zombie', 8.5, y, 8.5);
  zombie.onGround = true;
  const base = Entities.buildGeometry(world, 8.5, y + 1, 12);
  const baseCount = base.normal.count;
  const shadowUv = Textures.uv('entity_shadow');
  assert.ok(Math.abs(base.shadow.verts[3] - shadowUv[0]) < 1e-6, 'entity shadows should use the alpha-faded shadow tile');
  zombie.embeddedArrows = 2;
  const hit = Entities.buildGeometry(world, 8.5, y + 1, 12).normal;
  assert.equal(hit.count, baseCount + 24, 'each embedded arrow should add one two-sided quad');
  assert.ok(Array.from(hit.verts).every(Number.isFinite));
});

test('dungeons and planned villages generate deterministic structures, POIs and residents', () => {
  const { World, U, Items, Blocks, Entities, Player, SaveSys } = loadGameCore();
  const seed = 185;
  const first = new World(seed);
  let dungeonKey = null;
  for (let cx = -30; cx <= 30 && !dungeonKey; cx++) for (let cz = -30; cz <= 30; cz++) {
    const random = U.rng(U.hash32(seed + ':dungeon:' + cx + ':' + cz));
    if (random() > 0.055) continue;
    first.ensureChunk(cx, cz);
    dungeonKey = Array.from(first.be.keys()).find(key => {
      const parts = key.split(',').map(Number);
      const be = first.be.get(key);
      return (parts[0] >> 4) === cx && (parts[2] >> 4) === cz && parts[1] < 50 && be.slots.some(stack => stack && stack.id === Items.IT.REDSTONE);
    }) || null;
    if (dungeonKey) break;
  }
  assert.ok(dungeonKey, 'at least one deterministic dungeon should be discoverable');
  const dungeonParts = dungeonKey.split(',').map(Number);
  const second = new World(seed);
  second.ensureChunk(dungeonParts[0] >> 4, dungeonParts[2] >> 4);
  assert.deepEqual(second.getBE(...dungeonParts).slots, first.getBE(...dungeonParts).slots);

  let plan = null;
  for (let rx = -10; rx <= 10 && !plan; rx++) for (let rz = -10; rz <= 10; rz++) {
    const candidate = first.villagePlanForRegion(rx, rz);
    const types = candidate ? new Set(candidate.buildings.map(building => building.type)) : null;
    if (candidate && candidate.buildings.length >= 5 && candidate.beds.length >= 5 && candidate.jobs.length >= 3 &&
        types.has('farm') && types.has('library') && types.has('smithy')) {
      plan = candidate;
      break;
    }
  }
  assert.ok(plan, 'a complete biome-valid village plan should be discoverable');
  assert.ok(plan.roads.length >= plan.buildings.length + 2);
  assert.equal(plan.meeting.block, Blocks.ID.BELL);
  assert.ok(plan.residents.every(resident => resident.home && resident.profession));

  const chunkKeys = new Set([`${plan.x >> 4},${plan.z >> 4}`]);
  for (const building of plan.buildings) {
    for (const x of [building.x - 6, building.x, building.x + 6]) {
      for (const z of [building.z - 6, building.z, building.z + 6]) chunkKeys.add(`${x >> 4},${z >> 4}`);
    }
  }
  for (const key of chunkKeys) {
    const [cx, cz] = key.split(',').map(Number);
    first.ensureChunk(cx, cz);
  }
  assert.equal(first.getBlock(plan.meeting.x, plan.meeting.y, plan.meeting.z), Blocks.ID.BELL);
  for (const job of plan.jobs) assert.equal(first.getBlock(job.x, job.y, job.z), job.block);
  const villageChest = Array.from(first.be.entries()).find(([, be]) => be.type === 'chest' && be.slots.some(stack => stack && stack.id === Items.IT.BREAD));
  assert.ok(villageChest, 'village houses should include deterministic loot');

  const plannedPopulation = first.takeVillagePopulations();
  assert.ok(plannedPopulation.some(candidate => candidate.id === plan.id));
  assert.equal(first.takeVillagePopulations().length, 0);
  assert.ok(first.spawnedVillages.has(plan.id));

  const orderedChunks = Array.from(chunkKeys);
  const reordered = new World(seed);
  for (const key of orderedChunks.reverse()) {
    const [cx, cz] = key.split(',').map(Number);
    reordered.ensureChunk(cx, cz);
  }
  for (const key of chunkKeys) {
    assert.equal(Buffer.from(first.chunks.get(key).blocks).equals(Buffer.from(reordered.chunks.get(key).blocks)), true,
      'village chunk changed with generation order: ' + key);
  }
  const lazyPlan = new World(seed).villageById(plan.id);
  assert.equal(lazyPlan && lazyPlan.x, plan.x);

  const resident = plan.residents.find(entry => entry.profession !== 'unemployed');
  const villager = Entities.spawnMob('villager', resident.x, resident.y, resident.z);
  Entities.configureVillageMob(villager, plan, resident);
  const offer = Entities.tradeOffer(villager);
  assert.ok(offer && offer.cost > 0 && offer.n > 0);
  Entities.recordVillagerTrade(villager, first);
  assert.equal(villager.tradeUses, 1);

  const savePlayer = new Player(first);
  savePlayer.x = plan.x + 300; savePlayer.z = plan.z + 300;
  Entities.update(first, savePlayer, 1.1, 1);
  assert.equal(villager.dead, false, 'registered village residents must survive ordinary distance cleanup');
  assert.equal(SaveSys.save({ world: first, player: savePlayer }).ok, true);
  const savedVillage = SaveSys.load();
  assert.ok(savedVillage.spawnedVillages.includes(plan.id));
  const restored = new World(seed);
  SaveSys.applyToWorld(savedVillage, restored);
  assert.ok(restored.spawnedVillages.has(plan.id));
  SaveSys.clear();
});

test('classic movement blocks expose their original movement and support rules', () => {
  const { World, Player, Blocks, Physics } = loadGameCore();
  const world = new World(81);
  world.ensureChunk(0, 0);
  const y = 200;
  world.setBlock(7, y, 8, Blocks.ID.STONE);
  world.setBlock(8, y, 8, Blocks.ID.LADDER);
  world.setState(8, y, 8, 0);
  const climber = new Player(world);
  climber.x = 8.5; climber.y = y; climber.z = 8.5; climber.vx = climber.vy = climber.vz = 0;
  assert.equal(Physics.touchesBlock(world, climber, Blocks.ID.LADDER), true);
  climber.update(0.1, { jump: true });
  assert.ok(climber.vy > 0, 'jumping against a ladder should climb');

  world.setBlock(9, y, 8, Blocks.ID.COBWEB);
  const trapped = new Player(world);
  trapped.x = 9.5; trapped.y = y; trapped.z = 8.5; trapped.vx = trapped.vy = trapped.vz = 0;
  trapped.update(0.1, { fwd: true });
  assert.ok(Math.hypot(trapped.vx, trapped.vz) < 1, 'cobweb should heavily slow horizontal motion');
  assert.equal(Blocks.get(Blocks.ID.SOUL_SAND).collision.h, 14 / 16);
  assert.equal(Blocks.get(Blocks.ID.SOUL_SAND).speedFactor, 0.4);

  world.setBlock(7, y, 8, Blocks.ID.AIR);
  assert.equal(world.getBlock(8, y, 8), Blocks.ID.AIR, 'ladder should pop when its support is removed');
});

test('torches stand on floors, lean from walls and pop with their support', () => {
  const { World, Player, Blocks, Items, Mesher, Textures } = loadGameCore();
  Textures.build();
  const world = new World(211);
  world.ensureChunk(0, 0);
  const y = 200;
  const player = new Player(world);
  player.mode = 'creative';
  player.inv[0] = Items.makeStack(Blocks.ID.TORCH, 1);
  player.hotbar = 0;

  world.setBlock(7, y, 8, Blocks.ID.STONE);
  player.look = () => ({ x: 7, y, z: 8, id: Blocks.ID.STONE, face: [1, 0, 0], dist: 2 });
  player.placeBlock();
  assert.equal(world.getBlock(8, y, 8), Blocks.ID.TORCH);
  assert.equal(world.getState(8, y, 8), 1, 'east wall placement should lean away from its west support');
  const wallPose = Blocks.torchPose(1);
  assert.ok(Math.abs(wallPose.bottom[1] - 3 / 16) < 1e-6);
  assert.ok(wallPose.top[1] < 0.8, 'wall torch should remain below the top of its block');
  assert.ok(wallPose.top[0] > wallPose.bottom[0], 'wall torch should lean away from its support');
  const wallBox = Blocks.get(Blocks.ID.TORCH).modelBoxes(world, 8, y, 8, 1)[0];
  assert.ok(wallBox.x > 0 && wallBox.x < 0.05);
  assert.ok(wallBox.h > 0.6);
  const mesh = Mesher.mesh(world, world.chunkOf(8, 8), y >> 4);
  assert.ok(mesh.opaque.count >= 96, 'tilted torch should emit double-sided walls plus its caps');
  world.setBlock(7, y, 8, Blocks.ID.AIR);
  assert.equal(world.getBlock(8, y, 8), Blocks.ID.AIR, 'wall torch should pop when the wall is removed');

  player.useCooldown = 0;
  world.setBlock(10, y - 1, 8, Blocks.ID.STONE);
  player.look = () => ({ x: 10, y: y - 1, z: 8, id: Blocks.ID.STONE, face: [0, 1, 0], dist: 2 });
  player.placeBlock();
  assert.equal(world.getState(10, y, 8), 0, 'top-face placement should remain upright');
  world.setBlock(10, y - 1, 8, Blocks.ID.AIR);
  assert.equal(world.getBlock(10, y, 8), Blocks.ID.AIR, 'standing torch should pop when its floor is removed');
});

test('torch light crossing a chunk edge invalidates the neighboring mesh', () => {
  const { World, Blocks } = loadGameCore();
  const world = new World(212);
  const center = world.ensureChunk(0, 0);
  const neighbor = world.ensureChunk(1, 0);
  const y = 200;
  world.setBlock(14, y - 1, 8, Blocks.ID.STONE);
  for (const chunk of [center, neighbor]) {
    for (let section = 0; section < World.SEC_N; section++) world.clearSectionDirty(chunk, section);
  }

  world.setBlock(14, y, 8, Blocks.ID.TORCH);
  assert.ok(world.getBlkLight(16, y, 8) > 0, 'torch light should propagate into the adjacent chunk');
  assert.equal(neighbor.dirtySections.has(y >> 4), true, 'the adjacent chunk mesh must refresh for new edge light');

  world.clearSectionDirty(center, y >> 4);
  world.clearSectionDirty(neighbor, y >> 4);
  world.setBlock(14, y, 8, Blocks.ID.AIR);
  assert.equal(world.getBlkLight(16, y, 8), 0, 'removing the torch should clear adjacent light');
  assert.equal(neighbor.dirtySections.has(y >> 4), true, 'the adjacent chunk mesh must refresh when edge light is removed');
});

test('block placement metadata owns facing and support rules', () => {
  const { Blocks } = loadGameCore();
  const wallTorch = Blocks.placementFor(Blocks.ID.TORCH, { face: [1, 0, 0], yaw: 0, replaceHit: false });
  assert.deepEqual(Array.from(Blocks.supportOffset(Blocks.ID.TORCH, wallTorch.state)), [-1, 0, 0]);
  assert.equal(wallTorch.state, 1);
  assert.equal(Blocks.placementFor(Blocks.ID.TORCH, { face: [0, -1, 0], replaceHit: false }).valid, false);

  const standingSign = Blocks.placementFor(Blocks.ID.OAK_SIGN, { face: [0, 1, 0], yaw: Math.PI / 2 });
  assert.equal(standingSign.valid, true);
  assert.deepEqual(Array.from(Blocks.supportOffset(Blocks.ID.OAK_SIGN, standingSign.state)), [0, -1, 0]);

  const ladder = Blocks.placementFor(Blocks.ID.LADDER, { face: [0, 0, -1], yaw: 0, replaceHit: false });
  assert.equal(ladder.valid, true);
  assert.deepEqual(Array.from(Blocks.supportOffset(Blocks.ID.LADDER, ladder.state)), [0, 0, 1]);
});

test('underground lakes generate deterministically below the surface', () => {
  const { World, Blocks, U } = loadGameCore();
  const seed = 314159;
  let found = null;
  for (let cx = -12; cx <= 12 && !found; cx++) for (let cz = -12; cz <= 12; cz++) {
    if (U.posRand(seed ^ 0x1A4E, cx, 0, cz) > 0.16) continue;
    const world = new World(seed);
    const chunk = world.ensureChunk(cx, cz);
    let liquid = 0;
    for (let y = 10; y <= 52; y++) for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      const id = world.getBlock(cx * 16 + x, y, cz * 16 + z);
      if (id === Blocks.ID.WATER || id === Blocks.ID.LAVA) liquid++;
    }
    if (liquid > 8) found = { cx, cz, chunk };
  }
  assert.ok(found, 'a deterministic underground lake should be discoverable');
  const copy = new World(seed).ensureChunk(found.cx, found.cz);
  assert.equal(Buffer.from(found.chunk.blocks).equals(Buffer.from(copy.blocks)), true);
});

test('tree density stays biome-specific without adjacent trunks', () => {
  const { World } = loadGameCore();
  const world = new World(3358957923);
  const stats = new Map();
  const roots = new Set();
  for (let x = -96; x < 96; x++) for (let z = -96; z < 96; z++) {
    const biome = world.biomeAt(x, z);
    const entry = stats.get(biome) || { columns:0, trees:0 };
    entry.columns++;
    if (world.treeAt(x, z)) {
      entry.trees++;
      roots.add(x + ',' + z);
    }
    stats.set(biome, entry);
  }
  const perChunk = biome => {
    const entry = stats.get(biome);
    return entry.trees / entry.columns * 256;
  };
  assert.ok(perChunk('forest') >= 7 && perChunk('forest') <= 11);
  assert.ok(perChunk('snow') >= 3.5 && perChunk('snow') <= 9);
  assert.ok(perChunk('swamp') >= 0.5 && perChunk('swamp') <= 3.5);
  assert.ok(perChunk('plains') > 0 && perChunk('plains') < 0.7);
  assert.ok(perChunk('forest') > perChunk('swamp') * 2);
  for (const key of roots) {
    const [x, z] = key.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      assert.equal(roots.has((x + dx) + ',' + (z + dz)), false, 'tree trunks must not occupy neighboring columns');
    }
  }
});

test('hostiles remember the last visible player position without tracking through walls', () => {
  const { World, Player, Blocks, Entities } = loadGameCore();
  const world = new World(411);
  world.ensureChunk(0, 0);
  const y = 200;
  for (let x = 3; x <= 10; x++) world.setBlock(x, y - 1, 8, Blocks.ID.STONE);
  const player = new Player(world);
  player.x = 9.5; player.y = y; player.z = 8.5; player.mode = 'survival'; player.dead = false;
  Entities.clear(); Entities.setMobSpawning(false);
  const zombie = Entities.spawnMob('zombie', 5.5, y, 8.5);
  zombie.onGround = true; zombie.ai.senseTimer = 0;
  Entities.update(world, player, 0.05, 0);
  assert.equal(zombie.ai.canSee, true);
  const rememberedX = zombie.ai.lastSeenX;

  for (let wallY = y; wallY <= y + 2; wallY++) world.setBlock(7, wallY, 8, Blocks.ID.STONE);
  player.x = 10.5;
  zombie.ai.senseTimer = 0;
  Entities.update(world, player, 0.05, 0);
  assert.equal(zombie.ai.canSee, false);
  assert.equal(zombie.ai.mode, 'chase');
  assert.ok(zombie.ai.memory > 4);
  assert.equal(zombie.ai.lastSeenX, rememberedX, 'occluded movement must not update the remembered target');
  Entities.setMobSpawning(true);
});

test('ground mobs automatically jump one-block steps but not two-block walls', () => {
  const { World, Player, Blocks, Entities } = loadGameCore();
  const world = new World(412);
  world.ensureChunk(0, 0);
  const y = 200;
  for (let x = 6; x <= 11; x++) for (let z = 6; z <= 10; z++) {
    world.setBlock(x, y - 1, z, Blocks.ID.STONE);
    for (let clearY = y; clearY <= y + 3; clearY++) world.setBlock(x, clearY, z, Blocks.ID.AIR);
  }
  const player = new Player(world);
  player.x = 30.5; player.y = y; player.z = 30.5; player.mode = 'creative';

  const spawnWalker = () => {
    const pig = Entities.spawnMob('pig', 8.45, y, 8.5);
    pig.onGround = true;
    pig.ai.mode = 'wander';
    pig.ai.timer = 10;
    pig.ai.dirX = 1;
    pig.ai.dirZ = 0;
    return pig;
  };

  Entities.clear();
  Entities.setMobSpawning(false);
  try {
    world.setBlock(9, y, 8, Blocks.ID.STONE);
    const stepWalker = spawnWalker();
    Entities.update(world, player, 0.05, 0);
    assert.ok(stepWalker.vy > 0 && stepWalker.y > y,
      'a grounded mob should start jumping when its leading edge reaches a one-block step');
    assert.equal(stepWalker.onGround, false);

    Entities.clear();
    world.setBlock(9, y + 1, 8, Blocks.ID.STONE);
    const wallWalker = spawnWalker();
    Entities.update(world, player, 0.05, 0);
    assert.ok(wallWalker.vy <= 0.01 && Math.abs(wallWalker.y - y) < 0.01,
      'a mob should not jump at a wall that has no valid one-block landing height');
  } finally {
    Entities.clear();
    Entities.setMobSpawning(true);
  }
});

test('sunlit undead burn to death while covered undead remain unharmed', () => {
  const { World, Player, Blocks, Entities } = loadGameCore();
  const world = new World(413);
  world.ensureChunk(0, 0);
  world.weather = 'clear';
  const y = 200;
  for (let x = 6; x <= 12; x++) for (let z = 7; z <= 9; z++) {
    world.setBlock(x, y - 1, z, Blocks.ID.STONE);
    for (let clearY = y; clearY <= y + 3; clearY++) world.setBlock(x, clearY, z, Blocks.ID.AIR);
  }
  world.setBlock(11, y + 2, 8, Blocks.ID.STONE);
  const player = new Player(world);
  player.x = 30.5; player.y = y; player.z = 30.5; player.mode = 'creative';
  Entities.clear();
  Entities.setMobSpawning(false);
  try {
    const exposed = Entities.spawnMob('zombie', 8.5, y, 8.5);
    const covered = Entities.spawnMob('zombie', 11.5, y, 8.5);
    for (const zombie of [exposed, covered]) {
      zombie.onGround = true;
      zombie.ai.mode = 'idle';
      zombie.ai.timer = 1000;
    }
    for (let tick = 0; tick < 4; tick++) Entities.update(world, player, 0.25, 1);
    assert.equal(exposed.burning, true);
    assert.ok(Entities.particles.some(particle => particle.tile === 'fire'),
      'daylight ignition should produce visible flame particles');
    for (let tick = 0; tick < 40; tick++) Entities.update(world, player, 0.25, 1);
    assert.equal(exposed.dead, true, 'an undead mob in direct daylight should keep taking fire damage until death');
    assert.equal(covered.dead, false, 'a solid roof should prevent daylight ignition');
    assert.equal(covered.hp, 20);
    assert.equal(covered.burning, false);
  } finally {
    Entities.clear();
    Entities.setMobSpawning(true);
  }
});

test('weapon recharge, furnace experience and torch particles follow gameplay ticks', () => {
  const { World, Player, Blocks, Items, Craft, Entities } = loadGameCore();
  const world = new World(512);
  world.ensureChunk(0, 0);
  const player = new Player(world);
  player.inv.fill(null);
  player.inv[0] = Items.makeStack(Items.IT.SWORD_IRON, 1);
  assert.ok(Items.get(Items.IT.SWORD_IRON).tool.attackSpeed > Items.get(Items.IT.AXE_IRON).tool.attackSpeed);
  assert.equal(player.consumeAttackCharge(), 1);
  player.update(player.attackInterval() / 2, {});
  assert.ok(Math.abs(player.attackStrength() - 0.5) < 0.02);

  const be = { type: 'furnace', slots: [Items.makeStack(Blocks.ID.IRON_ORE, 1), Items.makeStack(Items.IT.COAL, 1), null], burn: 0, burnMax: 0, cook: 0, xpStored: 0 };
  for (let tick = 0; tick < 110; tick++) Craft.furnaceTick(world, 8, 200, 8, be, 0.1);
  assert.equal(be.slots[2].id, Items.IT.IRON_INGOT);
  assert.ok(Math.abs(be.xpStored - 0.7) < 1e-6);

  Entities.clear(); Entities.setMobSpawning(false);
  player.x = 8.5; player.y = 200; player.z = 8.5;
  world.setBlock(0, 199, 0, Blocks.ID.STONE);
  world.setBlock(0, 200, 0, Blocks.ID.TORCH);
  world.setState(0, 200, 0, 0);
  for (let tick = 0; tick < 4; tick++) Entities.update(world, player, 0.05, 1);
  assert.ok(Entities.particles.some(particle => particle.tile === 'fire'), 'nearby torches should emit flame particles');
  Entities.setMobSpawning(true);
});

test('sign models, supports and text survive a save roundtrip', () => {
  const { World, Player, Blocks, SaveSys, Mesher, Textures } = loadGameCore();
  Textures.build();
  const world = new World(690);
  world.ensureChunk(0, 0);
  const y = 200;

  world.setBlock(8, y - 1, 8, Blocks.ID.STONE);
  world.setBlock(8, y, 8, Blocks.ID.OAK_SIGN);
  world.setState(8, y, 8, 2);
  world.setBE(8, y, 8, { type: 'sign', lines: ['村庄入口', '欢迎回来', '', ''] });
  const standing = Blocks.get(Blocks.ID.OAK_SIGN).modelBoxes(world, 8, y, 8, 2);
  assert.equal(standing.length, 2, 'standing sign should contain a board and centered post');
  assert.equal(standing[0].z, 7 / 16);
  assert.equal(standing[1].x, 7 / 16);
  const signMesh = Mesher.mesh(world, world.chunkOf(8, 8), y >> 4).opaque;
  const boardTriangles = [];
  for (let index = 0; index < signMesh.inds.length; index += 3) {
    const points = [];
    for (let corner = 0; corner < 3; corner++) {
      const offset = signMesh.inds[index + corner] * 7;
      points.push([signMesh.verts[offset], signMesh.verts[offset + 1], signMesh.verts[offset + 2]]);
    }
    const cy = (points[0][1] + points[1][1] + points[2][1]) / 3;
    if (cy < y + 7 / 16) continue;
    const ax = points[1][0] - points[0][0], ay = points[1][1] - points[0][1], az = points[1][2] - points[0][2];
    const bx = points[2][0] - points[0][0], by = points[2][1] - points[0][1], bz = points[2][2] - points[0][2];
    boardTriangles.push({
      x: (points[0][0] + points[1][0] + points[2][0]) / 3,
      z: (points[0][2] + points[1][2] + points[2][2]) / 3,
      nx: ay * bz - az * by,
      nz: ax * by - ay * bx,
    });
  }
  assert.ok(boardTriangles.some(face => face.x > 8.99 && face.nx > 0), 'east board edge must face outward');
  assert.ok(boardTriangles.some(face => face.x < 8.01 && face.nx < 0), 'west board edge must face outward');
  assert.ok(boardTriangles.some(face => face.z > 8.55 && face.nz > 0), 'south board face must face outward');
  assert.ok(boardTriangles.some(face => face.z < 8.45 && face.nz < 0), 'north board face must face outward');

  world.setBlock(6, y, 8, Blocks.ID.STONE);
  world.setBlock(7, y, 8, Blocks.ID.OAK_SIGN);
  world.setState(7, y, 8, 5);
  world.setBE(7, y, 8, { type: 'sign', lines: ['墙挂牌', '', '', ''] });
  const wall = Blocks.get(Blocks.ID.OAK_SIGN).modelBoxes(world, 7, y, 8, 5);
  assert.equal(wall.length, 1, 'wall sign should not render a floating center post');
  assert.equal(wall[0].x, 0, 'east-facing wall sign should sit against its west support');
  world.setBlock(6, y, 8, Blocks.ID.AIR);
  assert.equal(world.getBlock(7, y, 8), Blocks.ID.AIR, 'wall sign should pop with its support');
  assert.equal(world.getBE(7, y, 8), null, 'popped wall sign must remove its text entity');

  const player = new Player(world);
  const saveResult = SaveSys.save({ world, player });
  assert.equal(saveResult.ok, true, saveResult.err);
  const data = SaveSys.load();
  const restored = new World(data.seed);
  SaveSys.applyToWorld(data, restored);
  assert.deepEqual(Array.from(restored.getBE(8, y, 8).lines), ['村庄入口', '欢迎回来', '', '']);
  SaveSys.clear();
});

test('players embedded by a terrain update are moved to nearby free space', () => {
  const { World, Player, Blocks, Physics } = loadGameCore();
  const world = new World(691);
  world.ensureChunk(0, 0);
  const player = new Player(world);
  player.x = 8.5; player.y = 200; player.z = 8.5;
  world.setBlock(8, 200, 8, Blocks.ID.STONE);
  world.setBlock(8, 201, 8, Blocks.ID.STONE);
  assert.equal(Physics.canOccupy(world, player, player.x, player.y, player.z), false);
  assert.equal(Physics.resolvePenetration(world, player, 3), true);
  assert.equal(Physics.canOccupy(world, player, player.x, player.y, player.z), true);
  assert.ok(player.y > 201.95, 'vertical escape should be preferred over a surprising sideways teleport');
  assert.equal(player.vx + player.vy + player.vz, 0);
});

test('swamps generate deterministically and passive animals can breed', () => {
  const { World, Entities, Items } = loadGameCore();
  const world = new World(82);
  let swamp = null;
  for (let x = -512; x <= 512 && !swamp; x += 8) for (let z = -512; z <= 512; z += 8) {
    if (world.biomeAt(x, z) === 'swamp') { swamp = [x, z]; break; }
  }
  assert.ok(swamp, 'the expanded biome map should contain swamps');
  assert.equal(world.biomeAt(swamp[0], swamp[1]), 'swamp');

  Entities.clear();
  const first = Entities.spawnMob('cow', 8, 200, 8);
  const second = Entities.spawnMob('cow', 10, 200, 8);
  assert.equal(Entities.feedAnimal(first, Items.IT.WHEAT), true);
  assert.equal(Entities.feedAnimal(second, Items.IT.WHEAT), true);
  const calves = Entities.list.filter(entity => entity.kind === 'cow' && entity.babyTime > 0);
  assert.equal(calves.length, 1);
  assert.ok(calves[0].w < first.w && calves[0].h < first.h);
  assert.ok(first.breedCooldown > 0 && second.breedCooldown > 0);
  calves[0].babyTime = 1;
  Entities.feedAnimal(calves[0], Items.IT.WHEAT);
  assert.equal(calves[0].babyTime, 0);
  assert.equal(calves[0].w, first.w);
  assert.equal(calves[0].h, first.h);
});

test('chicken head keeps its face texture on the front only', () => {
  const { World, Entities, Textures } = loadGameCore();
  Textures.build();
  const world = new World(73);
  world.ensureChunk(0, 0);
  Entities.spawnMob('chicken', 0.5, 80, 0.5);
  const geometry = Entities.buildGeometry(world, 0.5, 80, 0.5);

  const vertexStride = 7;
  const verticesPerBox = 24;
  const headStart = verticesPerBox;
  const faceTiles = [];
  for (let face = 0; face < 6; face++) {
    const offset = (headStart + face * 4) * vertexStride;
    faceTiles.push(geometry.normal.verts[offset + 3] + ',' + geometry.normal.verts[offset + 4]);
  }

  for (let face = 0; face < 5; face++) {
    assert.notEqual(faceTiles[5], faceTiles[face], 'front face texture must not repeat on another head side');
  }
  assert.equal(new Set(faceTiles).size, 6, 'the original chicken head should retain all six directional faces');
});

test('armor, food, enchanting and repair preserve metadata and costs', () => {
  const { World, Player, Items } = loadGameCore();
  const world = new World(91);
  world.random = () => 0;
  const player = new Player(world);
  player.inv.fill(null);
  const armor = [Items.IT.HELMET_DIAMOND, Items.IT.CHEST_DIAMOND, Items.IT.LEGS_DIAMOND, Items.IT.BOOTS_DIAMOND];
  for (let i = 0; i < armor.length; i++) player.equipment[i] = Items.makeStack(armor[i], 1);
  player.updateArmorValue();
  player.damage(10, 'mob');
  assert.equal(player.armor, 20);
  assert.equal(player.hp, 18);

  player.equipment.fill(null);
  player.updateArmorValue();
  player.hp = 20;
  player.hunger = 10;
  player.saturation = 0;
  player.inv[0] = Items.makeStack(Items.IT.BREAD, 1);
  player.updateEating(1.21, { use: true });
  assert.equal(player.hunger, 15);
  assert.equal(player.saturation, 6);

  player.inv.fill(null);
  player.inv[0] = Items.makeStack(Items.IT.SWORD_IRON, 1);
  player.inv[1] = Items.makeStack(Items.IT.LAPIS, 3);
  player.inv[2] = Items.makeStack(Items.IT.IRON_INGOT, 1);
  player.xpLevel = 3;
  assert.equal(player.enchantHeld(), true);
  assert.equal(player.held().ench.sharpness, 1);
  assert.equal(player.countItem(Items.IT.LAPIS), 2);
  player.held().dur = 1;
  assert.equal(player.repairHeld(), true);
  assert.ok(player.held().dur > 1);
  assert.equal(player.xpLevel, 1);

  const saved = player.serialize();
  const copy = new Player(world);
  copy.deserialize(saved);
  assert.equal(copy.held().ench.sharpness, 1);
  assert.ok(copy.held().dur > 1);
});

test('farming ticks hydrate crops and remove unsupported sugar cane', () => {
  const { World, Blocks, Items } = loadGameCore();
  const world = new World(92);
  world.ensureChunk(0, 0);
  world.random = () => 0;
  const y = 200;
  world.setBlock(8, y, 8, Blocks.ID.FARMLAND);
  world.setState(8, y, 8, 0);
  world.setBlock(9, y, 8, Blocks.ID.WATER);
  world.setBlock(8, y + 1, 8, Blocks.ID.WHEAT_CROP);
  world.setState(8, y + 1, 8, 6);
  world.schedule(8, y, 8, 0.01, 'farmland');
  world.schedule(8, y + 1, 8, 0.01, 'crop');
  world.update(0.02);
  assert.equal(world.getState(8, y, 8), 7);
  assert.equal(world.getState(8, y + 1, 8), 7);
  assert.ok(Blocks.dropsFor(Blocks.ID.WHEAT_CROP, 7, () => 0).some(drop => drop.id === Items.IT.WHEAT));

  world.setBlock(12, y, 12, Blocks.ID.DIRT);
  world.setBlock(11, y, 12, Blocks.ID.WATER);
  world.setBlock(12, y + 1, 12, Blocks.ID.SUGAR_CANE);
  world.setBlock(12, y + 2, 12, Blocks.ID.SUGAR_CANE);
  world.setBlock(11, y, 12, Blocks.ID.AIR);
  assert.equal(world.getBlock(12, y + 1, 12), Blocks.ID.AIR);
  assert.equal(world.getBlock(12, y + 2, 12), Blocks.ID.AIR);
});

test('water and lava are non-solid fluids with flow and sloped surfaces', () => {
  const { World, Blocks, Physics, Mesher, Textures } = loadGameCore();
  Textures.build();
  const world = new World(95);
  world.ensureChunk(0, 0);
  const y = 200;
  for (let x = 7; x <= 10; x++) for (let z = 7; z <= 9; z++) world.setBlock(x, y - 1, z, Blocks.ID.STONE);
  world.setBlock(7, y, 8, Blocks.ID.STONE);
  world.setBlock(8, y, 7, Blocks.ID.STONE);
  world.setBlock(8, y, 9, Blocks.ID.STONE);
  world.setBlock(8, y, 8, Blocks.ID.WATER);
  world.setBlock(9, y, 8, Blocks.ID.WATER);
  world.setState(9, y, 8, 4);

  const body = { x: 8.5, y, z: 8.5, w: 0.6, h: 1.8 };
  assert.equal(Blocks.get(Blocks.ID.WATER).solid, false);
  assert.equal(Blocks.get(Blocks.ID.LAVA).solid, false);
  assert.equal(Blocks.get(Blocks.ID.WATER).liquid, true);
  assert.equal(Blocks.get(Blocks.ID.LAVA).liquid, true);
  assert.equal(Physics.canOccupy(world, body, body.x, body.y, body.z), true);
  assert.equal(Physics.isInLiquid(world, body, 'water'), true);
  assert.ok(Physics.liquidFlow(world, body, 'water')[0] > 0.9);

  const mesh = Mesher.mesh(world, world.chunkOf(8, 8), y >> 4);
  const topY = [];
  for (let vertex = 0; vertex < 4; vertex++) topY.push(mesh.alpha.verts[vertex * 7 + 1].toFixed(4));
  assert.ok(new Set(topY).size > 1, 'neighboring fluid levels should produce a sloped top surface');

  const spreading = new World(96);
  spreading.ensureChunk(0, 0);
  for (let x = 3; x <= 13; x++) for (let z = 6; z <= 10; z++) spreading.setBlock(x, y - 1, z, Blocks.ID.STONE);
  spreading.setBlock(6, y, 8, Blocks.ID.WATER);
  spreading.setBlock(11, y, 8, Blocks.ID.LAVA);
  spreading.update(0.6);
  assert.equal(spreading.getBlock(7, y, 8), Blocks.ID.WATER);
  assert.equal(spreading.getState(7, y, 8), 1);
  assert.equal(spreading.getBlock(12, y, 8), Blocks.ID.LAVA);
  assert.equal(spreading.getState(12, y, 8), 2);
});

test('buckets, fire, bows, eggs and ender pearls execute their real interaction paths', () => {
  const { World, Player, Blocks, Items, Entities, U } = loadGameCore();
  const world = new World(93);
  world.ensureChunk(0, 0);
  world.random = () => 0;
  const y = 200;
  const player = new Player(world);
  player.inv.fill(null);
  player.pitch = Math.PI / 2;

  world.setBlock(8, y, 8, Blocks.ID.WATER);
  player.inv[0] = Items.makeStack(Items.IT.BUCKET, 1);
  player.setViewPosition(8.5, y + 1.2, 8.5);
  player.placeBlock();
  assert.equal(player.held().id, Items.IT.WATER_BUCKET);
  assert.equal(world.getBlock(8, y, 8), Blocks.ID.AIR);

  world.setBlock(10, y, 8, Blocks.ID.STONE);
  player.useCooldown = 0;
  player.setViewPosition(10.5, y + 1.2, 8.5);
  player.placeBlock();
  assert.equal(world.getBlock(10, y + 1, 8), Blocks.ID.WATER);
  assert.equal(player.held().id, Items.IT.BUCKET);
  world.setBlock(10, y + 1, 8, Blocks.ID.AIR);

  world.setBlock(14, y, 8, Blocks.ID.STONE);
  world.setBlock(14, y + 1, 8, Blocks.ID.WATER);
  player.inv[0] = Items.makeStack(Items.IT.LAVA_BUCKET, 1);
  player.useCooldown = 0;
  player.setViewPosition(14.5, y + 1.2, 8.5);
  player.placeBlock();
  assert.equal(world.getBlock(14, y + 1, 8), Blocks.ID.OBSIDIAN);
  assert.equal(player.held().id, Items.IT.BUCKET);

  world.setBlock(12, y, 8, Blocks.ID.STONE);
  player.inv[0] = Items.makeStack(Items.IT.FLINT_STEEL, 1);
  player.useCooldown = 0;
  player.setViewPosition(12.5, y + 1.2, 8.5);
  assert.equal(player.useBlock(), true);
  assert.equal(world.getBlock(12, y + 1, 8), Blocks.ID.FIRE);
  world.update(10);
  assert.equal(world.getBlock(12, y + 1, 8), Blocks.ID.AIR);

  player.inv.fill(null);
  player.resetViewPosition();
  player.x = 4.5; player.y = y; player.z = 4.5;
  player.yaw = Math.PI / 2; player.pitch = 0;
  player.inv[0] = Items.makeStack(Items.IT.BOW, 1);
  player.inv[1] = Items.makeStack(Items.IT.ARROW, 2);
  Entities.clear();
  player.updateUseActions(0.6, { use: true });
  player.updateUseActions(0, { use: false });
  const arrow = Entities.list.find(entity => entity.type === 'arrow');
  assert.ok(arrow && arrow.vx > 10);
  assert.equal(player.countItem(Items.IT.ARROW), 1);
  assert.equal(player.held().dur, Items.durabilityOf(Items.IT.BOW) - 1);

  Entities.clear();
  Entities.setMobSpawning(false);
  player.inv.fill(null);
  player.inv[0] = Items.makeStack(Items.IT.EGG, 2);
  player.useCooldown = 0;
  world.setBlock(7, y + 1, 4, Blocks.ID.STONE);
  let hatchSeed = 1;
  while (new U.RNG(hatchSeed).next() >= 0.125) hatchSeed++;
  Entities.setSeed(hatchSeed);
  player.placeBlock();
  const egg = Entities.list.find(entity => entity.type === 'egg');
  assert.ok(egg && egg.vx > 10, 'right click should launch an egg projectile');
  assert.equal(player.countItem(Items.IT.EGG), 1);
  for (let step = 0; step < 20 && !egg.dead; step++) Entities.update(world, player, 0.05, 1);
  assert.equal(egg.dead, true, 'egg should break on the wall');
  const chick = Entities.list.find(entity => entity.kind === 'chicken' && entity.babyTime > 0);
  assert.ok(chick && chick.w < chick.model.w, 'successful hatch should create a scaled baby chicken');

  Entities.clear();
  player.inv.fill(null);
  player.inv[0] = Items.makeStack(Items.IT.ENDER_PEARL, 2);
  player.useCooldown = 0;
  player.hurtTime = 0;
  player.hp = 20;
  player.x = 4.5; player.y = y; player.z = 4.5;
  player.placeBlock();
  const pearl = Entities.list.find(entity => entity.type === 'ender_pearl');
  assert.ok(pearl && pearl.vx > 10, 'right click should launch an ender pearl projectile');
  assert.equal(player.countItem(Items.IT.ENDER_PEARL), 1);
  for (let step = 0; step < 20 && !pearl.dead; step++) Entities.update(world, player, 0.05, 1);
  assert.equal(pearl.dead, true, 'ender pearl should land on the wall');
  assert.ok(player.x > 6 && player.x < 7, 'the thrower should teleport to the safe side of the impact');
  assert.equal(player.hp, 15, 'ender pearl landing should deal five points of damage');
  Entities.setMobSpawning(true);
});

test('network entity snapshots render village mobs, items, arrows, eggs and ender pearls without local simulation', () => {
  const { World, Entities, Items, Textures } = loadGameCore();
  Textures.build();
  const world = new World(94);
  world.ensureChunk(0, 0);
  const y = world.genHeight(8, 8) + 1;
  const synced = [
    { id: 'm1', type: 'mob', kind: 'zombie', x: 8.5, y, z: 8.5, yaw: 0, age: 1, animPhase: 0, animSpeed: 1, flash: 0, hurtAnim: 0, ai: { mode: 'network' }, dead: false },
    { id: 'v1', type: 'mob', kind: 'villager', profession: 'farmer', x: 7.5, y, z: 8.5, yaw: 0, age: 1, animPhase: 0, animSpeed: 0, flash: 0, hurtAnim: 0, ai: { mode: 'network' }, dead: false },
    { id: 'g1', type: 'mob', kind: 'iron_golem', x: 6.5, y, z: 8.5, yaw: 0, age: 1, animPhase: 0, animSpeed: 0, flash: 0, hurtAnim: 0, ai: { mode: 'network' }, dead: false },
    { id: 'i1', type: 'item', itemId: Items.IT.DIAMOND, count: 1, x: 9.5, y, z: 8.5, age: 1, dead: false },
    { id: 'a1', type: 'arrow', itemId: Items.IT.ARROW, count: 1, x: 10.5, y: y + 1, z: 8.5, age: 1, dead: false },
    { id: 'e1', type: 'egg', itemId: Items.IT.EGG, count: 1, x: 11.5, y: y + 1, z: 8.5, age: 1, dead: false },
    { id: 'p1', type: 'ender_pearl', itemId: Items.IT.ENDER_PEARL, count: 1, x: 12.5, y: y + 1, z: 8.5, age: 1, dead: false },
  ];
  Entities.clear();
  Entities.setNetworkEntityProvider(() => synced);
  const geometry = Entities.buildGeometry(world, 8.5, y + 1.6, 12);
  Entities.setNetworkEntityProvider(null);
  assert.ok(geometry.normal.count > 220, 'network geometry count=' + geometry.normal.count);
});

test('network animal ears and tails keep a stable animation phase', () => {
  const { World, Entities, Textures } = loadGameCore();
  Textures.build();
  const world = new World(95);
  world.ensureChunk(0, 0);
  const y = world.genHeight(8, 8) + 1;
  const wolf = {
    id: 'mob-12', type: 'mob', kind: 'wolf', x: 8.5, y, z: 8.5,
    yaw: 0, headYaw: 0, headPitch: 0, age: 0.5, animPhase: 0,
    animSpeed: 0, flash: 0, hurtAnim: 0, onGround: true, dead: false,
  };
  Entities.clear();
  Entities.setNetworkEntityProvider(() => [wolf]);
  const first = Array.from(Entities.buildGeometry(world, 8.5, y + 1.6, 12).normal.verts);
  wolf.age += 0.01;
  const second = Array.from(Entities.buildGeometry(world, 8.5, y + 1.6, 12).normal.verts);
  Entities.setNetworkEntityProvider(null);

  assert.ok(first.every(Number.isFinite), 'all animal vertices should remain finite for string entity IDs');
  assert.ok(second.every(Number.isFinite), 'animated animal vertices should remain finite');
  const maxPartMotion = (partIndex) => {
    const start = partIndex * 24 * 7;
    let max = 0;
    for (let i = start; i < start + 24 * 7; i += 7) {
      max = Math.max(max,
        Math.abs(second[i] - first[i]),
        Math.abs(second[i + 1] - first[i + 1]),
        Math.abs(second[i + 2] - first[i + 2]));
    }
    return max;
  };
  assert.ok(maxPartMotion(3) < 0.01, 'ear animation should move continuously between adjacent frames');
  assert.ok(maxPartMotion(9) < 0.01, 'tail animation should move continuously between adjacent frames');
});

test('runtime block edits prioritize only the affected mesh sections', () => {
  const { World, Blocks } = loadGameCore();
  const world = new World(96);
  const center = world.ensureChunk(0, 0);
  const neighbor = world.ensureChunk(1, 0);
  for (const chunk of [center, neighbor]) {
    for (let section = 0; section < World.SEC_N; section++) world.clearSectionDirty(chunk, section);
  }

  const y = world.genHeight(15, 8);
  const section = y >> 4;
  const version = world.runtimeEditVersion;
  const replacement = world.getBlock(15, y, 8) === Blocks.ID.AIR ? Blocks.ID.STONE : Blocks.ID.AIR;
  assert.equal(world.setBlock(15, y, 8, replacement), true);
  assert.equal(world.runtimeEditVersion, version + 1);
  assert.equal(world.urgentMeshKeys.has(center.meshKeys[section]), true);
  assert.equal(world.urgentMeshKeys.has(neighbor.meshKeys[section]), true);

  world.clearSectionDirty(center, section);
  world.clearSectionDirty(neighbor, section);
  assert.equal(world.urgentMeshKeys.has(center.meshKeys[section]), false);
  assert.equal(world.urgentMeshKeys.has(neighbor.meshKeys[section]), false);
});

test('runtime meshing and particles reuse buffers without invalidating entity geometry', () => {
  const { World, Mesher, Entities, Textures, Blocks } = loadGameCore();
  Textures.build();
  const world = new World(194);
  const chunk = world.ensureChunk(0, 0);
  const section = world.genHeight(8, 8) >> 4;

  const first = Mesher.meshSectionRuntime(world, chunk, section);
  const opaqueVertexBuffer = first.opaque.verts.buffer;
  const opaqueIndexBuffer = first.opaque.inds.buffer;
  const second = Mesher.meshSectionRuntime(world, chunk, section);
  assert.equal(second.opaque.verts.buffer, opaqueVertexBuffer, 'runtime vertex staging should be reused');
  assert.equal(second.opaque.inds.buffer, opaqueIndexBuffer, 'runtime index staging should be reused');

  const warm = Entities.prewarmGeometry();
  assert.ok(warm.parts > 100, 'all detailed mob, player and armor parts should be prewarmed');
  assert.ok(warm.normalVertexCapacity >= 65536, 'entity staging should be reserved before approaching mobs');
  assert.equal(Entities.prewarmGeometry(), warm, 'prewarming should be idempotent');

  const entityVersion = Entities.renderVersion();
  const particleVersion = Entities.particleRenderVersion();
  Entities.blockHitParticles(8, world.genHeight(8, 8), 8, Blocks.get(Blocks.ID.STONE).tex.all, [0, 1, 0]);
  assert.equal(Entities.renderVersion(), entityVersion, 'mining particles must not rebuild every entity mesh');
  assert.ok(Entities.particleRenderVersion() > particleVersion);
  assert.ok(Entities.buildParticleGeometry(0, 0).count > 0);
});

test('dropped items settle on the ground and do not orbit a player with a full inventory', () => {
  const { World, Blocks, Entities, Items } = loadGameCore();
  const world = new World(195);
  world.ensureChunk(0, 0);
  const y = world.genHeight(8, 8) + 2;
  for (let x = 5; x <= 11; x++) for (let z = 6; z <= 10; z++) {
    world.setBlock(x, y - 1, z, Blocks.ID.STONE);
    world.setBlock(x, y, z, Blocks.ID.AIR);
    world.setBlock(x, y + 1, z, Blocks.ID.AIR);
  }

  Entities.clear();
  Entities.setMobSpawning(false);
  Entities.onPickup = null;
  const distantPlayer = { x: 30, y, z: 30, dead: false };
  const settling = Entities.spawnItem(7.5, y, 8.5, Items.IT.STICK, 1, 2.5, 0, 0);
  for (let tick = 0; tick < 40; tick++) Entities.update(world, distantPlayer, 0.05, 1);
  assert.equal(settling.onGround, true);
  assert.equal(settling.vx, 0);
  assert.equal(settling.vz, 0);
  assert.ok(settling.x < 8.2, 'ground friction should stop the initial throw close to its landing point');

  const player = { x: 9, y, z: 8.5, dead: false };
  const blocked = Entities.spawnItem(player.x + 0.45, y, player.z, Items.IT.STICK, 4, 0, 0, 0);
  blocked.pickupDelay = 0;
  Entities.onPickup = (id, count) => count;
  for (let tick = 0; tick < 30; tick++) Entities.update(world, player, 0.05, 1);
  const settledPosition = { x: blocked.x, y: blocked.y, z: blocked.z };
  for (let tick = 0; tick < 30; tick++) Entities.update(world, player, 0.05, 1);
  assert.ok(Number.isFinite(blocked.x) && Number.isFinite(blocked.y) && Number.isFinite(blocked.z));
  assert.ok(Math.hypot(blocked.vx, blocked.vz) < 0.02, 'a rejected pickup should remain settled');
  assert.ok(Math.hypot(blocked.x - settledPosition.x, blocked.y - settledPosition.y, blocked.z - settledPosition.z) < 0.02,
    'a full inventory must not make the item orbit the player');

  Entities.onPickup = null;
  Entities.setMobSpawning(true);
  Entities.clear();
});

test('container menus only emit spatial chest lid sounds', () => {
  const core = loadGameCore();
  const { World, Player, Blocks, UI, Sound } = core;
  const world = new World(109);
  const player = new Player(world);
  const opened = [];
  const sounds = [];
  UI.openCrafting = () => opened.push(['crafting']);
  UI.openFurnace = (x, y, z) => opened.push(['furnace', x, y, z]);
  UI.openChest = (x, y, z) => opened.push(['chest', x, y, z]);
  Sound.play = (...args) => sounds.push(['legacy', ...args]);
  Sound.emit = (name, options) => sounds.push([name, options]);

  for (const id of [Blocks.ID.CRAFTING, Blocks.ID.FURNACE, Blocks.ID.CHEST]) {
    player.useCooldown = 0;
    player.look = () => ({ id, x: 10, y: 20, z: 30 });
    assert.equal(player.useBlock(), true);
  }

  assert.deepEqual(opened, [
    ['crafting'],
    ['furnace', 10, 20, 30],
    ['chest', 10, 20, 30],
  ]);
  assert.equal(sounds.length, 1);
  assert.equal(sounds[0][0], 'container.chest.open');
  assert.deepEqual(Array.from(Object.entries(sounds[0][1])), [
    ['x', 10.5], ['y', 20.5], ['z', 30.5], ['volume', 1],
  ]);

  const uiSource = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
  assert.match(uiSource, /win\.type === 'chest'[\s\S]*container\.chest\.close/);
  assert.doesNotMatch(uiSource, /Sound\.play\('close'/);
});
