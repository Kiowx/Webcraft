'use strict';

const { test, expect } = require('@playwright/test');

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error && error.stack || error)));
  return errors;
}

async function clickCanvasControl(page, id) {
  const control = await page.evaluate(controlId => {
    if (!window.UI || !UI.screenControls) return null;
    const match = UI.screenControls(innerWidth, innerHeight).find(item => item.id === controlId);
    return match ? { x: match.x, y: match.y, w: match.w, h: match.h, disabled: !!match.disabled } : null;
  }, id);
  expect(control, 'missing canvas control: ' + id).toBeTruthy();
  expect(control.disabled, 'disabled canvas control: ' + id).toBeFalsy();
  await page.mouse.click(control.x + control.w / 2, control.y + control.h / 2);
}

async function makeServerPeaceful(page) {
  await page.evaluate(() => Network.command('/auth playwright-local-test'));
  await expect.poll(() => page.evaluate(() => Network.status().role)).toBe('admin');
  await page.waitForTimeout(400);
  await page.evaluate(() => Network.command('/difficulty peaceful'));
  await expect.poll(() => page.evaluate(() => game.difficulty)).toBe(0);
}

test('browser self-test completes without runtime errors', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.goto('/?selftest=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.title === 'SELFTEST PASS' || document.title === 'SELFTEST FAIL', null, { timeout: 120000 });
  expect(await page.title()).toBe('SELFTEST PASS');
  await expect(page.locator('#selftest-log')).toBeVisible();
  await expect(page.locator('#selftest-log')).toContainText('ALL PASS');
  await expect(page.locator('#selftest-log')).not.toContainText('FAIL');
  await page.waitForFunction(() => window.VanillaModels &&
    Items.get(Items.IT.SWORD_DIAMOND).modelResource === 'item/diamond_sword');
  const modelResources = await page.evaluate(() => ({
    count: VanillaModels.installed().size,
    dragonEgg: Blocks.get(Blocks.ID.DRAGON_EGG).modelResource,
    brewingStand: Blocks.get(Blocks.ID.BREWING_STAND).modelResource,
    sword: Items.get(Items.IT.SWORD_DIAMOND).modelResource,
    swordParent: Items.get(Items.IT.SWORD_DIAMOND).modelParent,
    swordTexture: Items.get(Items.IT.SWORD_DIAMOND).modelTexture,
    swordTransform: Items.get(Items.IT.SWORD_DIAMOND).display.firstPerson.vanillaTransform,
  }));
  expect(modelResources.count).toBeGreaterThanOrEqual(15);
  expect(modelResources.dragonEgg).toBe('dragon_egg');
  expect(modelResources.brewingStand).toBe('brewing_stand');
  expect(modelResources.sword).toBe('item/diamond_sword');
  expect(modelResources.swordParent).toBe('item/handheld');
  expect(modelResources.swordTexture).toBe('items/diamond_sword');
  expect(modelResources.swordTransform).toEqual({
    rotation: [0, -90, 25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68],
  });
  expect(pageErrors).toEqual([]);
});

test('main menu renders and joins the local multiplayer server', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.UI && window.Network && UI.currentScreen() === 'title');

  const visibleHudPixels = await page.evaluate(() => {
    const canvas = document.getElementById('hud');
    const context = canvas.getContext('2d');
    let visible = 0;
    for (let y = 8; y < canvas.height; y += 24) {
      for (let x = 8; x < canvas.width; x += 24) {
        if (context.getImageData(x, y, 1, 1).data[3] > 0) visible++;
      }
    }
    return visible;
  });
  expect(visibleHudPixels).toBeGreaterThan(20);

  await clickCanvasControl(page, 'multiplayer');
  await expect(page.locator('#nickname-input')).toBeVisible();
  await page.locator('#nickname-input').fill('BrowserTest');
  await clickCanvasControl(page, 'join_server');
  await expect.poll(() => page.evaluate(() => Network.isConnected()), { timeout: 30000 }).toBe(true);
  const status = await page.evaluate(() => Network.status());
  expect(status.name).toBe('BrowserTest');
  expect(status.players).toBeGreaterThanOrEqual(1);
  const zeroPosition = await page.evaluate(() => {
    game.player.x = 12; game.player.y = 34; game.player.z = 56;
    Network.onPosition({ x: 0, y: 0, z: 0, reason: 'test' });
    return { x: game.player.x, y: game.player.y, z: game.player.z };
  });
  expect(zeroPosition).toEqual({ x: 0, y: 0, z: 0 });
  expect(pageErrors).toEqual([]);
});

test('resource-pack settings switch and persist the bundled 1.12.2 textures', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.UI && UI.currentScreen() === 'title');
  const textureHash = name => page.evaluate(textureName => {
    let rect;
    if (textureName.startsWith('skin.')) {
      const uv = Textures.uv(textureName);
      const size = Textures.atlas.size;
      rect = [
        Math.round(uv[0] * size), Math.round(uv[1] * size),
        Math.round((uv[2] - uv[0]) * size), Math.round((uv[3] - uv[1]) * size),
      ];
    } else rect = Textures.rect(textureName);
    const data = Textures.atlas.canvas.getContext('2d').getImageData(rect[0], rect[1], rect[2], rect[3]).data;
    let hash = 2166136261;
    for (const value of data) hash = Math.imul(hash ^ value, 16777619) >>> 0;
    return hash;
  }, name);
  const defaultHashes = {
    stone: await textureHash('stone'),
    pig: await textureHash('pig_head_front'),
    steve: await textureHash('skin.steve.head.front'),
  };
  const defaultPigModel = await page.evaluate(() => Entities.modelStats('pig'));
  expect(defaultPigModel.profile).toBe('default');
  expect(defaultPigModel.sizes[0]).toEqual([10, 8, 16]);
  expect(await page.evaluate(() => Entities.modelStats('player').sizes[1])).toEqual([9, 13, 5]);

  await clickCanvasControl(page, 'options');
  await clickCanvasControl(page, 'resource');
  await clickCanvasControl(page, 'resource_pack');
  await page.waitForFunction(() => game.resourcePack === 'original_1_12' &&
    !game.resourcePackLoading && Textures.currentPack() === 'original_1_12');
  const { status, info } = await page.evaluate(() => ({
    status: Textures.packStatus('original_1_12'),
    info: Textures.packInfo('original_1_12'),
  }));
  expect(info.entries).toBeGreaterThan(300);
  expect(status.loaded).toBe(info.entries);
  expect(status.failed).toBe(0);
  expect(await textureHash('stone')).not.toBe(defaultHashes.stone);
  expect(await textureHash('pig_head_front')).not.toBe(defaultHashes.pig);
  expect(await textureHash('skin.steve.head.front')).not.toBe(defaultHashes.steve);
  const originalPigModel = await page.evaluate(() => Entities.modelStats('pig'));
  expect(originalPigModel.profile).toBe('original');
  expect(originalPigModel.parts).not.toBe(defaultPigModel.parts);
  expect(originalPigModel.sizes[0]).toEqual([10, 16, 8]);
  expect(await page.evaluate(() => Entities.modelStats('player').sizes[1])).toEqual([8.5, 12.5, 4.5]);
  expect(await page.evaluate(() => localStorage.getItem('webcraft_resource_pack'))).toBe('original_1_12');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.UI && game.resourcePack === 'original_1_12' &&
    !game.resourcePackLoading && Textures.currentPack() === 'original_1_12');
  expect(await textureHash('stone')).not.toBe(defaultHashes.stone);
  expect(await textureHash('pig_head_front')).not.toBe(defaultHashes.pig);
  expect(await textureHash('skin.steve.head.front')).not.toBe(defaultHashes.steve);
  expect(await page.evaluate(() => Entities.modelProfile())).toBe('original');
  expect(pageErrors).toEqual([]);
});

test('inventory closes cleanly and crafting screens keep multiplayer physics active', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.UI && window.Network && UI.currentScreen() === 'title');
  await clickCanvasControl(page, 'multiplayer');
  await page.locator('#nickname-input').fill('InventoryTest');
  await clickCanvasControl(page, 'join_server');
  await expect.poll(() => page.evaluate(() => Network.isConnected()), { timeout: 30000 }).toBe(true);
  await makeServerPeaceful(page);

  await page.mouse.click(640, 360);
  await page.waitForFunction(() => document.pointerLockElement === document.getElementById('hud'));
  await page.keyboard.press('KeyE');
  await expect.poll(() => page.evaluate(() => UI.winType())).toBe('inventory');
  expect(await page.evaluate(() => game.paused)).toBe(false);

  const gestureDefaults = await page.evaluate(() => {
    const hud = document.getElementById('hud');
    const dispatch = event => hud.dispatchEvent(event);
    return {
      pointerdown: dispatch(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 91, button: 2, buttons: 2 })),
      mousedown: dispatch(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2, buttons: 2 })),
      contextmenu: dispatch(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })),
      auxclick: dispatch(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 })),
      dragstart: dispatch(new Event('dragstart', { bubbles: true, cancelable: true })),
      horizontalWheel: dispatch(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 120 })),
      editableContextMenu: document.getElementById('chat-input').dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
      ),
    };
  });
  expect(gestureDefaults).toEqual({
    pointerdown: false,
    mousedown: false,
    contextmenu: false,
    auxclick: false,
    dragstart: false,
    horizontalWheel: false,
    editableContextMenu: true,
  });

  await page.keyboard.press('KeyE');
  await expect.poll(() => page.evaluate(() => UI.winType())).toBe(null);
  expect(await page.evaluate(() => ({ paused: game.paused, screen: UI.currentScreen() }))).toEqual({
    paused: false,
    screen: null,
  });

  const openedInAir = await page.evaluate(() => {
    const player = game.player;
    const originalLook = player.look;
    player.flying = false;
    player.onGround = false;
    player.vy = 8.4;
    player.useCooldown = 0;
    player.look = () => ({ id: Blocks.ID.CRAFTING, x: Math.floor(player.x), y: Math.floor(player.y), z: Math.floor(player.z) });
    const used = player.useBlock();
    player.look = originalLook;
    return { used, y: player.y, vy: player.vy, win: UI.winType(), paused: game.paused };
  });
  expect(openedInAir.used).toBe(true);
  expect(openedInAir.win).toBe('crafting');
  expect(openedInAir.paused).toBe(false);
  await page.waitForTimeout(350);
  const airborneUpdate = await page.evaluate(() => ({ y: game.player.y, vy: game.player.vy, win: UI.winType() }));
  expect(airborneUpdate.win).toBe('crafting');
  expect(airborneUpdate.vy).toBeLessThan(openedInAir.vy - 1);
  expect(Number.isFinite(airborneUpdate.y)).toBe(true);

  await page.keyboard.press('KeyE');
  await expect.poll(() => page.evaluate(() => UI.winType())).toBe(null);
  expect(await page.evaluate(() => game.paused)).toBe(false);
  expect(pageErrors).toEqual([]);
});

test('sign editor accepts four Chinese lines and commits them to the world', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.UI && UI.currentScreen() === 'title');
  await clickCanvasControl(page, 'singleplayer');
  await clickCanvasControl(page, 'new_creative');
  await page.waitForFunction(() => window.game && game.state === 'playing' && game.world && game.player);

  const position = await page.evaluate(() => {
    const x = Math.floor(game.player.x) + 1;
    const y = Math.floor(game.player.y);
    const z = Math.floor(game.player.z);
    game.world.ensureChunk(x >> 4, z >> 4);
    game.world.setBlock(x, y - 1, z, Blocks.ID.STONE);
    game.world.setBlock(x, y, z, Blocks.ID.OAK_SIGN);
    game.world.setState(x, y, z, 2);
    game.world.setBE(x, y, z, { type: 'sign', lines: ['', '', '', ''] });
    UI.openSignEditor(x, y, z);
    return { x, y, z };
  });
  await expect(page.locator('#sign-editor')).toBeVisible();
  await expect(page.locator('#sign-input')).toBeFocused();
  await page.locator('#sign-input').fill('村庄入口\n欢迎回来\n12345678901234567890\n第四行\n第五行');
  await page.locator('#sign-done').click();
  await expect(page.locator('#sign-editor')).toBeHidden();
  await expect.poll(() => page.evaluate(() => UI.winType())).toBe(null);
  const lines = await page.evaluate(({ x, y, z }) => game.world.getBE(x, y, z).lines, position);
  expect(lines).toEqual(['村庄入口', '欢迎回来', '123456789012345', '第四行']);
  expect(pageErrors).toEqual([]);
});

test('camera inside an opaque block is covered instead of exposing underground faces', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.UI && UI.currentScreen() === 'title');
  await clickCanvasControl(page, 'singleplayer');
  await clickCanvasControl(page, 'new_creative');
  await page.waitForFunction(() => window.game && game.state === 'playing' && game.world && game.player);

  await page.evaluate(() => {
    const player = game.player;
    player.update = () => {};
    const x = Math.floor(player.x), y = Math.floor(player.y + player.eye), z = Math.floor(player.z);
    game.world.ensureChunk(x >> 4, z >> 4);
    game.world.setBlock(x, y, z, Blocks.ID.STONE);
  });
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.getElementById('hud');
    return canvas.getContext('2d').getImageData(12, 12, 1, 1).data[3];
  })).toBeGreaterThan(200);
  expect(pageErrors).toEqual([]);
});

test('menu sounds fire only for completed actions', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.UI && window.Sound && UI.currentScreen() === 'title');
  expect(await page.evaluate(() => ({
    master: game.masterVolume,
    music: game.musicVolume,
    fov: game.baseFov,
    viewDistance: game.viewDist,
    difficulty: game.difficulty,
  }))).toEqual({ master: 0.7, music: 1, fov: 70, viewDistance: 6, difficulty: 2 });
  await page.evaluate(() => {
    window.__menuSounds = [];
    const original = Sound.emit.bind(Sound);
    Sound.emit = (name, options) => {
      window.__menuSounds.push(name);
      return original(name, options);
    };
  });

  const options = await page.evaluate(() => {
    const control = UI.screenControls(innerWidth, innerHeight).find(item => item.id === 'options');
    return { x: control.x, y: control.y, w: control.w, h: control.h };
  });
  await page.mouse.move(options.x + options.w / 2, options.y + options.h / 2);
  await page.mouse.down();
  await page.mouse.move(2, 2);
  await page.mouse.up();
  expect(await page.evaluate(() => UI.currentScreen())).toBe('title');
  expect(await page.evaluate(() => window.__menuSounds)).toEqual([]);

  await clickCanvasControl(page, 'options');
  expect(await page.evaluate(() => UI.currentScreen())).toBe('options');
  expect(await page.evaluate(() => window.__menuSounds)).toEqual(['ui.button.click']);
  const soundStatus = await page.evaluate(() => Sound.status());
  expect(soundStatus.unlocked, JSON.stringify(soundStatus)).toBe(true);
  expect(soundStatus.contextState).toBe('running');
  expect(soundStatus.masterVolume).toBe(0.7);
  await expect.poll(() => page.evaluate(() => Sound.status().packName)).toBe('WebCraft + Minecraft Java 1.12.2 original audio');
  await page.evaluate(() => Sound.tick(20, {
    screen: 'menu', gameMode: 'survival', dimension: 'overworld',
    rainStrength: 0, caveStrength: 0, underwater: false, outdoors: true,
  }));
  await expect.poll(() => page.evaluate(() => Sound.status().activeMusicEvent), { timeout: 15000 }).toBe('music.menu');
  await page.evaluate(() => Sound.setMusic(false));

  await clickCanvasControl(page, 'done');
  expect(await page.evaluate(() => UI.currentScreen())).toBe('title');
  expect(await page.evaluate(() => window.__menuSounds)).toEqual(['ui.button.click', 'ui.button.click']);

  await clickCanvasControl(page, 'options');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => UI.currentScreen())).toBe('title');
  expect(await page.evaluate(() => window.__menuSounds.slice(-1))).toEqual(['ui.button.click']);

  await clickCanvasControl(page, 'options');
  await page.evaluate(() => { window.__menuSounds.length = 0; });
  const fov = await page.evaluate(() => {
    const control = UI.screenControls(innerWidth, innerHeight).find(item => item.id === 'fov');
    return { x: control.x, y: control.y, w: control.w, h: control.h };
  });
  await page.mouse.click(fov.x + fov.w - 8, fov.y + fov.h / 2);
  expect(await page.evaluate(() => window.__menuSounds)).toEqual(['ui.slider.tick']);

  await page.evaluate(() => { window.__menuSounds.length = 0; });
  await page.mouse.move(fov.x + 8, fov.y + fov.h / 2);
  await page.mouse.down();
  await page.mouse.move(fov.x + fov.w / 2, fov.y + fov.h / 2, { steps: 5 });
  await page.mouse.move(fov.x + fov.w - 8, fov.y + fov.h / 2, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__menuSounds)).toEqual(['ui.slider.tick']);
  expect(pageErrors).toEqual([]);
});

test('mobile touch controls move, look, jump and operate inventory slots', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 });
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.UI && UI.currentScreen() === 'title');
  await clickCanvasControl(page, 'singleplayer');
  await clickCanvasControl(page, 'new_survival');
  await page.dispatchEvent('#hud', 'pointerdown', {
    pointerType: 'touch', pointerId: 10, isPrimary: true, clientX: 4, clientY: 4,
  });
  await page.dispatchEvent('#hud', 'pointerup', {
    pointerType: 'touch', pointerId: 10, isPrimary: true, clientX: 4, clientY: 4,
  });
  await page.waitForFunction(() => game.state === 'playing' && game.player && !document.getElementById('touch-controls').hidden);

  await expect(page.locator('#touch-controls')).toBeVisible();
  for (const id of ['touch-joystick', 'touch-look', 'touch-jump', 'touch-attack', 'touch-use',
    'touch-sneak', 'touch-sprint', 'touch-inventory', 'touch-pause']) {
    await expect(page.locator('#' + id)).toBeVisible();
  }

  const joystick = await page.locator('#touch-joystick').boundingBox();
  const start = await page.evaluate(() => {
    game.player.mode = 'creative';
    game.player.flying = true;
    game.player.vx = game.player.vz = 0;
    return { x: game.player.x, z: game.player.z };
  });
  await page.dispatchEvent('#touch-joystick', 'pointerdown', {
    pointerType: 'touch', pointerId: 11, isPrimary: true,
    clientX: joystick.x + joystick.width / 2, clientY: joystick.y + 18,
  });
  await page.dispatchEvent('#touch-joystick', 'pointermove', {
    pointerType: 'touch', pointerId: 11, isPrimary: true,
    clientX: joystick.x + joystick.width / 2, clientY: joystick.y + 8,
  });
  await page.waitForTimeout(350);
  await page.dispatchEvent('#touch-joystick', 'pointerup', {
    pointerType: 'touch', pointerId: 11, isPrimary: true,
    clientX: joystick.x + joystick.width / 2, clientY: joystick.y + 8,
  });
  const moved = await page.evaluate(() => ({ x: game.player.x, z: game.player.z }));
  expect(Math.hypot(moved.x - start.x, moved.z - start.z)).toBeGreaterThan(0.1);

  const look = await page.locator('#touch-look').boundingBox();
  const yaw = await page.evaluate(() => game.player.yaw);
  await page.dispatchEvent('#touch-look', 'pointerdown', {
    pointerType: 'touch', pointerId: 12, isPrimary: true,
    clientX: look.x + 40, clientY: look.y + 60,
  });
  await page.dispatchEvent('#touch-look', 'pointermove', {
    pointerType: 'touch', pointerId: 12, isPrimary: true,
    clientX: look.x + 130, clientY: look.y + 85,
  });
  await page.dispatchEvent('#touch-look', 'pointerup', {
    pointerType: 'touch', pointerId: 12, isPrimary: true,
    clientX: look.x + 130, clientY: look.y + 85,
  });
  expect(Math.abs(await page.evaluate(() => game.player.yaw) - yaw)).toBeGreaterThan(0.1);

  await page.evaluate(() => {
    const p = game.player;
    const x = Math.floor(p.x), z = Math.floor(p.z);
    const y = Math.min(World.CH_H - 6, Math.max(96, game.world.genHeight(x, z) + 8));
    game.world.setBlock(x, y - 1, z, Blocks.ID.STONE);
    for (let yy = y; yy <= y + 4; yy++) game.world.setBlock(x, yy, z, Blocks.ID.AIR);
    p.x = p.prevX = x + 0.5;
    p.y = p.prevY = y;
    p.z = p.prevZ = z + 0.5;
    p.vx = p.vy = p.vz = 0;
    p.mode = 'survival';
    p.flying = false;
    p.onGround = false;
  });
  await expect.poll(() => page.evaluate(() => game.player.onGround && game.player.vy === 0), { timeout: 10000 }).toBe(true);
  const jumpY = await page.evaluate(() => game.player.y);
  await page.dispatchEvent('#touch-jump', 'pointerdown', { pointerType: 'touch', pointerId: 13, isPrimary: true });
  await page.waitForFunction(y => game.player.y > y && game.player.vy > 0, jumpY);
  await page.dispatchEvent('#touch-jump', 'pointerup', { pointerType: 'touch', pointerId: 13, isPrimary: true });

  await page.evaluate(() => {
    game.player.inv[0] = Items.makeStack(Blocks.ID.STONE, 3);
    game.player.cursor = null;
  });
  await page.dispatchEvent('#touch-inventory', 'pointerdown', { pointerType: 'touch', pointerId: 14, isPrimary: true });
  await expect.poll(() => page.evaluate(() => UI.winType())).toBe('inventory');
  await expect(page.locator('#touch-close-ui')).toBeVisible();
  const inventorySlot = await page.evaluate(() => {
    const info = UI.guiInfo();
    const scale = info.scale;
    const canvas = document.getElementById('hud');
    const panelX = Math.round(canvas.width / 2 - 88 * scale);
    const panelY = Math.round(canvas.height / 2 - 83 * scale);
    return { x: panelX + 16 * scale, y: panelY + 150 * scale };
  });
  await page.dispatchEvent('#hud', 'pointerdown', {
    pointerType: 'touch', pointerId: 15, isPrimary: true,
    clientX: inventorySlot.x, clientY: inventorySlot.y,
  });
  await page.dispatchEvent('#hud', 'pointerup', {
    pointerType: 'touch', pointerId: 15, isPrimary: true,
    clientX: inventorySlot.x, clientY: inventorySlot.y,
  });
  expect(await page.evaluate(() => !!game.player.cursor && game.player.cursor.id === Blocks.ID.STONE)).toBe(true);

  await page.dispatchEvent('#touch-close-ui', 'pointerdown', { pointerType: 'touch', pointerId: 16, isPrimary: true });
  await expect.poll(() => page.evaluate(() => UI.winType())).toBe(null);
  await expect(page.locator('#touch-controls')).toBeVisible();
  const hotbarPoint = await page.evaluate(() => {
    const canvas = document.getElementById('hud');
    for (let y = canvas.height - 80; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) if (UI.hotbarSlotAt(x, y) === 4) return { x, y };
    }
    return null;
  });
  expect(hotbarPoint).toBeTruthy();
  await page.dispatchEvent('#hud', 'pointerdown', {
    pointerType: 'touch', pointerId: 17, isPrimary: true,
    clientX: hotbarPoint.x, clientY: hotbarPoint.y,
  });
  expect(await page.evaluate(() => game.player.hotbar)).toBe(4);
  expect(pageErrors).toEqual([]);
});
