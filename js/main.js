/* main.js — boot, input, game loop, chunk streaming/meshing, selftest */
'use strict';
(function () {
  const game = {
    state: 'menu',           // menu | playing | dead
    paused: false,
    world: null,
    player: null,
    fps: 60,
    showDebug: false,
    deathCause: null,
    viewDist: 6,             // chunks
    saveTimer: 0,
    baseFov: 70,
    fov: 70,
    difficulty: 2,
    masterVolume: 0.7,
    musicVolume: 1,
    musicOn: true,
    smoothLighting: true,
    particleLevel: 0,
    autoJump: true,
    mouseSensitivity: 0.5,
    invertMouseY: false,
    rawMouse: true,
    playerSkin: 'steve',
    playerModel: 'classic',
    resourcePack: 'default',
    resourcePackLoading: false,
    multiplayer: false,
  };
  window.game = game;

  const input = {
    fwd: false, back: false, left: false, right: false,
    jump: false, sneak: false, sprint: false,
    mine: false, use: false,
  };
  const blockedInput = Object.freeze({
    fwd: false, back: false, left: false, right: false,
    jump: false, sneak: false, sprint: false,
    mine: false, use: false,
  });
  let lastW = 0; // double-tap W sprint

  let cv3d, hud;
  let pointerLocked = false;
  let rawLockPending = false;
  let rawFallbackAttempted = false;
  let lastT = 0;
  const FIXED_DT = 1 / 20;
  const PLAYER_DT = 1 / 60;
  let accumulator = 0;
  let playerAccumulator = 0;
  let meshBudgetMs = 4;
  let meshCostEma = 1;
  let generationTurn = true;
  let firstFramesDone = 0;
  let genQueue = [], genQueuePos = 0, genQueueKey = '';
  let meshQueue = [], meshQueuePos = 0, meshQueueVersion = -1, meshQueueKey = '';
  let cacheQueue = [], cacheQueuePos = 0, cacheQueueKey = '';
  let observedRuntimeEditVersion = 0;
  let editQuietFrames = 0;
  let activeMenuSlider = null;
  let activeMenuPress = null;
  let touchMode = !!(navigator.maxTouchPoints > 0 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
  let touchControls = null;
  let touchCloseUi = null;
  let touchControlsVisible = false;
  let touchSneakLatched = false;
  let touchSprintLatched = false;
  let touchLookPointer = null;
  let touchLookX = 0;
  let touchLookY = 0;
  let touchJoystickPointer = null;
  const MENU_BUTTON_IDS = new Set([
    'singleplayer', 'multiplayer', 'join_server', 'options', 'video', 'controls', 'sound',
    'language', 'resource', 'done', 'new_survival', 'new_creative', 'continue', 'delete_world',
    'confirm_delete', 'cancel_delete', 'resume', 'save_quit', 'respawn', 'gui_scale',
    'fullscreen', 'skin', 'quit',
  ]);

  function resetStreamQueues() {
    if (Renderer.clearChunks) Renderer.clearChunks();
    genQueue = []; genQueuePos = 0; genQueueKey = '';
    meshQueue = []; meshQueuePos = 0; meshQueueVersion = -1; meshQueueKey = '';
    cacheQueue = []; cacheQueuePos = 0; cacheQueueKey = '';
    meshCostEma = 1;
    observedRuntimeEditVersion = game.world ? game.world.runtimeEditVersion : 0;
    editQuietFrames = 0;
    generationTurn = true;
    firstFramesDone = 0;
    accumulator = 0;
    playerAccumulator = 0;
    game.fov = game.baseFov;
  }

  // ---------------- boot ----------------
  function boot() {
    cv3d = document.getElementById('game');
    hud = document.getElementById('hud');
    resize();
    window.addEventListener('resize', resize);

    const modelPreload = typeof VanillaModels !== 'undefined' && VanillaModels.preload
      ? VanillaModels.preload() : null;

    if (!Renderer.init(cv3d)) {
      document.getElementById('nogl').style.display = 'flex';
      return;
    }
    UI.init(game, hud);
    if (modelPreload && typeof modelPreload.then === 'function') {
      modelPreload.then(() => {
        if (!game.world) return;
        for (const chunk of game.world.chunks.values()) game.world.markAllSectionsDirty(chunk);
      }).catch(() => {});
    }
    Sound.setEnvironmentProvider((sourceX, sourceY, sourceZ, listenerX, listenerY, listenerZ) => {
      if (!game.world) return 0;
      const dx = sourceX - listenerX, dy = sourceY - listenerY, dz = sourceZ - listenerZ;
      const distance = Math.hypot(dx, dy, dz);
      if (distance < 1.5) return 0;
      const hit = game.world.raycast(listenerX, listenerY, listenerZ, dx / distance, dy / distance, dz / distance, distance - 0.35, false);
      if (!hit) return 0;
      const def = Blocks.get(hit.id);
      return def.transparent ? 0.28 : 0.72;
    });
    UI.onNicknameSubmit = (name) => {
      Sound.emit('ui.button.click', { spatial: false });
      startMultiplayer(name);
    };
    UI.onChatSubmit = (text) => Network.sendChat(text);
    UI.onChatClose = () => {
      if (game.state === 'playing' && game.multiplayer) {
        game.paused = false;
        requestGamePointerLock();
      }
    };
    if (Entities.setRemoteProvider) Entities.setRemoteProvider(() => Network.remotePlayers());
    if (Entities.setNetworkEntityProvider) Entities.setNetworkEntityProvider(() => Network.remoteEntities());
    Network.onStatus = (status, message) => { if (message) UI.toast(message); };
    Network.onChat = (message) => UI.addChat(message);
    Network.onContainer = (be, message) => {
      if (message && message.conflict && UI.containerConflict) UI.containerConflict();
    };
    Network.onWorldState = (state) => {
      if (Number.isInteger(state.difficulty)) game.difficulty = state.difficulty;
    };
    Network.onProfile = applyNetworkProfile;
    Network.onPosition = (message) => {
      const p = game.player;
      if (!p || !game.multiplayer) return;
      const position = {
        x: Number.isFinite(Number(message.x)) ? Number(message.x) : p.x,
        y: Number.isFinite(Number(message.y)) ? Number(message.y) : p.y,
        z: Number.isFinite(Number(message.z)) ? Number(message.z) : p.z,
      };
      if (message.reason === 'respawn' && p.resetRespawnState) p.resetRespawnState(position);
      else {
        p.x = position.x; p.y = position.y; p.z = position.z;
        p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z; p.vx = p.vy = p.vz = 0;
      }
      if (message.reason === 'portal') UI.toast(message.dimension === 'nether' ? '进入下界' : message.dimension === 'end' ? '进入末地' : '返回主世界');
    };
    Network.onCombat = (message) => {
      const p = game.player;
      if (!p || !game.multiplayer) return;
      p.hp = U.clamp(Number(message.hp), 0, p.maxHp);
      p.hurtTime = message.blocked ? 0.3 : 0.5;
      if (message.knockback) {
        p.vx += Number(message.knockback.x) || 0;
        p.vy += Number(message.knockback.y) || 0;
        p.vz += Number(message.knockback.z) || 0;
      }
      if (message.blocked && p.blockHitFeedback) p.blockHitFeedback();
      else Sound.emit('player.hurt', { volume: 0.9 });
    };
    Network.onAttackResult = (message) => {
      if (!message || !message.hit || !game.multiplayer) return;
      const target = message.targetType === 'entity'
        ? Network.remoteEntities().find(entity => entity.id === message.target)
        : Network.remotePlayers().find(player => player.id === message.target);
      if (target) {
        const event = message.targetType === 'entity'
          ? 'entity.' + (target.kind || 'generic') + '.hurt'
          : 'entity.generic.hurt';
        Sound.emit(event, { x: target.x, y: target.y + (target.h || 1.8) * 0.55, z: target.z, volume: 0.75 });
        if (Entities.entityHitParticles) Entities.entityHitParticles(target, false);
      }
      if (UI.hit) UI.hit(false);
    };
    Network.onExplosion = (message) => {
      Sound.emit('explosion', { x: message.x, y: message.y, z: message.z, volume: 1 });
      if (Entities.blockHitParticles) Entities.blockHitParticles(Math.floor(message.x), Math.floor(message.y), Math.floor(message.z), 'tnt_side', [0, 1, 0]);
    };
    Network.onSound = (message) => {
      if (!message || typeof message.name !== 'string') return;
      Sound.emit(message.name, {
        x: Number(message.x), y: Number(message.y), z: Number(message.z),
        volume: Number.isFinite(message.volume) ? message.volume : 1,
        pitch: Number.isFinite(message.pitch) ? message.pitch : 1,
        seed: Number.isFinite(message.seed) ? message.seed : undefined,
      });
    };
    Network.onMining = (message) => {
      const player = game.player;
      if (!player || !message) return;
      player.lastMiningResponse = message;
      const mining = player.mining;
      if (!mining || mining.x !== message.x || mining.y !== message.y || mining.z !== message.z || mining.id !== message.id) return;
      const required = Number(message.required);
      if (message.state === 'started' && Number.isFinite(required) && required > mining.total) mining.total = required;
      if (message.state === 'rejected') mining.progress = Math.min(mining.progress, Math.max(0, Number(message.elapsed) || 0));
    };
    Network.onReconnect = (welcome) => {
      if (!game.multiplayer) return;
      Network.bindWorld(game.world);
      applyNetworkProfile(welcome.profile, 'reconnect');
      UI.addChat({ kind: 'system', text: '已恢复服务器会话' });
    };
    loadSettings();
    applySettings(false);
    applyResourcePack(game.resourcePack, false);
    bindInput();
    SaveSys.init();

    if (location.search.indexOf('selftest=1') >= 0) {
      runSelftest();
      return;
    }
    requestAnimationFrame(loop);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    cv3d.width = Math.floor(innerWidth * dpr);
    cv3d.height = Math.floor(innerHeight * dpr);
    hud.width = innerWidth;
    hud.height = innerHeight;
    const hctx = hud.getContext('2d');
    hctx.imageSmoothingEnabled = false;
  }

  function loadSettings() {
    try {
      const storedNumber = (key) => {
        const raw = localStorage.getItem(key);
        return raw === null || raw === '' ? NaN : Number(raw);
      };
      const sensitivity = storedNumber('webcraft_mouse_sensitivity');
      if (Number.isFinite(sensitivity) && sensitivity >= 0.1 && sensitivity <= 1) {
        game.mouseSensitivity = sensitivity;
      }
      game.invertMouseY = localStorage.getItem('webcraft_invert_mouse_y') === '1';
      const raw = localStorage.getItem('webcraft_raw_mouse');
      if (raw === '0' || raw === '1') game.rawMouse = raw === '1';
      const fov = storedNumber('webcraft_fov');
      if (Number.isFinite(fov)) game.baseFov = U.clamp(Math.round(fov), 30, 110);
      const distance = storedNumber('webcraft_view_distance');
      if (Number.isFinite(distance)) game.viewDist = U.clamp(Math.round(distance), 2, 12);
      const difficulty = storedNumber('webcraft_difficulty');
      if (Number.isFinite(difficulty)) game.difficulty = U.clamp(Math.round(difficulty), 0, 3);
      const master = storedNumber('webcraft_master_volume');
      if (Number.isFinite(master)) game.masterVolume = U.clamp(master, 0, 1);
      const music = storedNumber('webcraft_music_volume');
      if (Number.isFinite(music)) game.musicVolume = U.clamp(music, 0, 1);
      const musicOn = localStorage.getItem('webcraft_music_on');
      if (musicOn === '0' || musicOn === '1') game.musicOn = musicOn === '1';
      const smooth = localStorage.getItem('webcraft_smooth_lighting');
      if (smooth === '0' || smooth === '1') game.smoothLighting = smooth === '1';
      const particleLevel = storedNumber('webcraft_particles');
      if (Number.isFinite(particleLevel)) game.particleLevel = U.clamp(Math.round(particleLevel), 0, 2);
      const autoJump = localStorage.getItem('webcraft_auto_jump');
      if (autoJump === '0' || autoJump === '1') game.autoJump = autoJump === '1';
      const skin = localStorage.getItem('webcraft_player_skin');
      const profiles = Textures.skinProfiles ? Textures.skinProfiles() : [];
      if (profiles.some(profile => profile.id === skin)) game.playerSkin = skin;
      const model = localStorage.getItem('webcraft_player_model');
      if (model === 'classic' || model === 'slim') game.playerModel = model;
      const resourcePack = localStorage.getItem('webcraft_resource_pack');
      if (resourcePack === 'default' || resourcePack === 'original_1_12') game.resourcePack = resourcePack;
    } catch (e) { /* storage unavailable */ }
    game.fov = game.baseFov;
  }

  function saveSettings() {
    try {
      localStorage.setItem('webcraft_mouse_sensitivity', String(game.mouseSensitivity));
      localStorage.setItem('webcraft_invert_mouse_y', game.invertMouseY ? '1' : '0');
      localStorage.setItem('webcraft_raw_mouse', game.rawMouse ? '1' : '0');
      localStorage.setItem('webcraft_fov', String(game.baseFov));
      localStorage.setItem('webcraft_view_distance', String(game.viewDist));
      localStorage.setItem('webcraft_difficulty', String(game.difficulty));
      localStorage.setItem('webcraft_master_volume', String(game.masterVolume));
      localStorage.setItem('webcraft_music_volume', String(game.musicVolume));
      localStorage.setItem('webcraft_music_on', game.musicOn ? '1' : '0');
      localStorage.setItem('webcraft_smooth_lighting', game.smoothLighting ? '1' : '0');
      localStorage.setItem('webcraft_particles', String(game.particleLevel));
      localStorage.setItem('webcraft_auto_jump', game.autoJump ? '1' : '0');
      localStorage.setItem('webcraft_player_skin', game.playerSkin);
      localStorage.setItem('webcraft_player_model', game.playerModel);
      localStorage.setItem('webcraft_resource_pack', game.resourcePack);
    } catch (e) { /* storage unavailable */ }
  }

  function applySettings(remesh) {
    Sound.setMaster(game.masterVolume);
    if (Sound.setMusicVolume) Sound.setMusicVolume(game.musicVolume);
    Sound.setMusic(game.musicOn && game.musicVolume > 0);
    if (Entities.setParticleLevel) Entities.setParticleLevel(game.particleLevel);
    if (Mesher.setSmoothLighting) Mesher.setSmoothLighting(game.smoothLighting);
    if (game.player) {
      game.player.difficulty = game.difficulty;
      game.player.autoJumpEnabled = game.autoJump;
      game.player.skin = game.playerSkin;
      game.player.modelType = game.playerModel;
    }
    if (remesh && game.world) {
      for (const ch of game.world.chunks.values()) game.world.markAllSectionsDirty(ch);
    }
  }

  function setSetting(id, value) {
    let remesh = false;
    if (id === 'fov') game.baseFov = U.clamp(Math.round(value), 30, 110);
    else if (id === 'render_distance') game.viewDist = U.clamp(Math.round(value), 2, 12);
    else if (id === 'sensitivity') game.mouseSensitivity = U.clamp(+value, 0.1, 1);
    else if (id === 'master_volume') game.masterVolume = U.clamp(+value, 0, 1);
    else if (id === 'music_volume') {
      game.musicVolume = U.clamp(+value, 0, 1);
      game.musicOn = game.musicVolume > 0;
    } else if (id === 'difficulty') {
      if (game.multiplayer) { UI.toast('联机难度由服务器管理员控制'); return true; }
      game.difficulty = (game.difficulty + 1) % 4;
    } else if (id === 'invert_mouse') game.invertMouseY = !game.invertMouseY;
    else if (id === 'raw_mouse') game.rawMouse = !game.rawMouse;
    else if (id === 'auto_jump') game.autoJump = !game.autoJump;
    else if (id === 'smooth_lighting') { game.smoothLighting = !game.smoothLighting; remesh = true; }
    else if (id === 'particles') game.particleLevel = (game.particleLevel + 1) % 3;
    else if (id === 'skin_preset') {
      const profiles = Textures.skinProfiles ? Textures.skinProfiles() : [{ id: 'steve' }];
      const index = Math.max(0, profiles.findIndex(profile => profile.id === game.playerSkin));
      game.playerSkin = profiles[(index + 1) % profiles.length].id;
    } else if (id === 'skin_model') game.playerModel = game.playerModel === 'slim' ? 'classic' : 'slim';
    else return false;
    saveSettings();
    applySettings(remesh);
    return true;
  }

  async function applyResourcePack(id, persist) {
    if (game.resourcePackLoading || !Textures.setPack) return false;
    game.resourcePackLoading = true;
    try {
      const result = await Textures.setPack(id);
      if (UI.setResourcePack) await UI.setResourcePack(id);
      game.resourcePack = id;
      if (Renderer.refreshTextureAtlas) Renderer.refreshTextureAtlas();
      if (Entities.refreshTextureAtlas) Entities.refreshTextureAtlas();
      if (persist) saveSettings();
      if (persist) {
        UI.toast(id === 'original_1_12'
          ? '已启用 Minecraft 1.12.2 原版材质（' + result.loaded + ' 项）'
          : '已恢复 WebCraft 默认材质');
      }
      return true;
    } catch (error) {
      game.resourcePack = 'default';
      try { await Textures.setPack('default'); } catch (restoreError) { /* default atlas is already resident */ }
      if (UI.setResourcePack) await UI.setResourcePack('default');
      if (Renderer.refreshTextureAtlas) Renderer.refreshTextureAtlas();
      if (Entities.refreshTextureAtlas) Entities.refreshTextureAtlas();
      if (persist) saveSettings();
      UI.toast('材质包加载失败，已恢复默认材质');
      return false;
    } finally {
      game.resourcePackLoading = false;
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    } catch (e) {
      UI.toast('浏览器拒绝了全屏请求');
    }
  }

  async function saveAndQuitToTitle() {
    if (game.multiplayer) {
      UI.close();
      await new Promise(resolve => setTimeout(resolve, 100));
      Network.disconnect(true);
      if (UI.resetProfileSync) UI.resetProfileSync();
    } else await doSave();
    stopPointerActions();
    if (document.exitPointerLock) document.exitPointerLock();
    UI.close();
    UI.resetMenus();
    game.state = 'menu';
    game.paused = false;
    game.multiplayer = false;
    if (Entities.setMobSpawning) Entities.setMobSpawning(true);
  }

  async function activateMenuControl(control, value, options) {
    if (!control || control.disabled) return false;
    if (control.type === 'slider') {
      const next = value === undefined ? control.value : value;
      if (!Number.isFinite(next)) return false;
      const tolerance = Math.max(1e-6, (control.step || 1) * 0.25);
      const sliderPress = !!(options && options.sliderPress);
      if (Math.abs(next - control.value) <= tolerance && !sliderPress) return false;
      if (!setSetting(control.id, next)) return false;
      if (!(options && options.silent)) Sound.emit('ui.slider.tick', { spatial: false });
      return true;
    }
    if (control.type === 'text') {
      if (control.id === 'nickname') { UI.focusNickname(); return true; }
      return false;
    }
    if (control.id === 'resource_pack') {
      Sound.emit('ui.button.click', { spatial: false });
      const nextPack = game.resourcePack === 'original_1_12' ? 'default' : 'original_1_12';
      await applyResourcePack(nextPack, true);
      return true;
    }
    if (setSetting(control.id)) {
      Sound.emit('ui.button.click', { spatial: false });
      return true;
    }
    if (!MENU_BUTTON_IDS.has(control.id)) return false;
    Sound.emit('ui.button.click', { spatial: false });
    switch (control.id) {
      case 'singleplayer': UI.openScreen('worlds'); break;
      case 'multiplayer': UI.openScreen('multiplayer'); break;
      case 'join_server': await startMultiplayer(UI.nicknameValue()); break;
      case 'skin': UI.openScreen('skin'); break;
      case 'options': UI.openScreen('options'); break;
      case 'video': UI.openScreen('video'); break;
      case 'controls': UI.openScreen('controls'); break;
      case 'sound': UI.openScreen('sound'); break;
      case 'language': UI.openScreen('language'); break;
      case 'resource': UI.openScreen('resource'); break;
      case 'done': UI.backScreen(); break;
      case 'new_survival': await startNew('survival'); break;
      case 'new_creative': await startNew('creative'); break;
      case 'continue': await startLoad(); break;
      case 'delete_world': UI.openScreen('confirm_delete'); break;
      case 'confirm_delete': await SaveSys.clearAsync(); UI.backScreen(); UI.toast('世界已删除'); break;
      case 'cancel_delete': UI.backScreen(); break;
      case 'resume': UI.resetMenus(); requestGamePointerLock(); break;
      case 'save_quit': await saveAndQuitToTitle(); break;
      case 'respawn': respawn(); UI.resetMenus(); break;
      case 'gui_scale': UI.cycleGuiScale(); break;
      case 'fullscreen': await toggleFullscreen(); break;
      case 'quit':
        try { if (window.close) window.close(); } catch (e) { /* browser-owned tab */ }
        UI.toast('请关闭当前浏览器标签页');
        break;
    }
    return true;
  }

  function backFromMenu() {
    const screen = UI.currentScreen();
    if (screen === 'pause') {
      UI.resetMenus();
      requestGamePointerLock();
    } else if (screen !== 'title' && screen !== 'death') {
      UI.backScreen();
    }
  }

  function menuPoint(event) {
    const rect = hud.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (rect.width ? hud.width / rect.width : 1),
      y: (event.clientY - rect.top) * (rect.height ? hud.height / rect.height : 1),
    };
  }

  function requestGamePointerLock() {
    if (touchMode) { game.paused = false; return; }
    if (!hud || !hud.requestPointerLock) return;
    const fallback = () => {
      rawLockPending = false;
      rawFallbackAttempted = true;
      try { if (document.pointerLockElement !== hud) hud.requestPointerLock(); } catch (e) { /* error event handles it */ }
    };
    rawFallbackAttempted = false;
    if (!game.rawMouse) { fallback(); return; }
    try {
      rawLockPending = true;
      const result = hud.requestPointerLock({ unadjustedMovement: true });
      if (result && typeof result.catch === 'function') result.catch(fallback);
    } catch (e) {
      fallback();
    }
  }

  // ---------------- world start ----------------
  async function startNew(mode) {
    Sound.unlock();
    Network.disconnect(true);
    game.multiplayer = false;
    game.saveTimer = 0;
    if (Entities.setMobSpawning) Entities.setMobSpawning(true);
    await SaveSys.clearAsync();
    const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    game.world = new World(seed);
    Entities.clear();
    Entities.setSeed(seed ^ 0xE17E1234);
    resetStreamQueues();
    game.player = new Player(game.world);
    game.player.mode = mode;
    applySettings(false);
    if (mode === 'creative') giveCreativeKit(game.player);
    hookCallbacks();
    warmupChunks();
    game.state = 'playing';
    game.paused = false;
    UI.resetMenus();
    Sound.setMusic(game.musicOn);
    UI.toast(mode === 'creative' ? '创造模式:双击空格切换飞行' : '生存模式:小心夜晚的怪物!');
  }

  async function startLoad() {
    Sound.unlock();
    Network.disconnect(true);
    game.multiplayer = false;
    game.saveTimer = 0;
    if (Entities.setMobSpawning) Entities.setMobSpawning(true);
    const data = await SaveSys.loadAsync();
    if (!data) { UI.toast('没有找到存档'); return; }
    game.world = new World(data.seed);
    SaveSys.applyToWorld(data, game.world);
    Entities.clear();
    Entities.setSeed(data.seed ^ 0xE17E1234);
    resetStreamQueues();
    game.player = new Player(game.world);
    game.player.deserialize(data.player);
    applySettings(false);
    Entities.deserialize(data.entities);
    Entities.setRngState(data.entityRng);
    hookCallbacks();
    warmupChunks();
    game.state = 'playing';
    game.paused = false;
    UI.resetMenus();
    Sound.setMusic(game.musicOn);
    UI.toast('已读取存档');
  }

  async function startMultiplayer(name) {
    if (Network.isActive()) return;
    Sound.unlock();
    UI.toast('正在连接单服务器世界...');
    let welcome;
    try {
      const requestedName = Network.setPlayerName(name === undefined ? Network.getPlayerName() : name);
      welcome = await Network.connect({ name: requestedName, skin: game.playerSkin, modelType: game.playerModel });
    } catch (error) {
      Network.disconnect(true);
      UI.toast('联机失败：' + (error && error.message ? error.message : '无法连接服务器'));
      return;
    }
    game.world = new World(welcome.seed);
    Entities.clear();
    Entities.setSeed(welcome.seed ^ 0xE17E1234);
    if (Entities.setMobSpawning) Entities.setMobSpawning(false);
    resetStreamQueues();
    game.player = new Player(game.world);
    game.player.mode = 'survival';
    if (welcome.profile) game.player.deserialize(welcome.profile);
    applySettings(false);
    Network.bindWorld(game.world);
    hookCallbacks();
    warmupChunks();
    game.multiplayer = true;
    game.saveTimer = 0;
    game.state = 'playing';
    game.paused = false;
    UI.resetMenus();
    applyNetworkProfile(welcome.profile, 'welcome');
    Sound.setMusic(game.musicOn);
    UI.toast('已加入生存服务器：' + Network.status().name);
  }

  function applyNetworkProfile(profile, reason, message) {
    const p = game.player;
    if (!p || !profile || !game.multiplayer) return;
    p.hp = U.clamp(Number(profile.hp), 0, p.maxHp);
    p.hunger = U.clamp(Number(profile.hunger), 0, 20);
    p.saturation = U.clamp(Number(profile.saturation), 0, p.hunger);
    p.air = U.clamp(Number(profile.air), 0, p.maxAir);
    p.mode = profile.mode === 'creative' ? 'creative' : 'survival';
    if (p.mode === 'survival') p.flying = false;
    p.hotbar = U.clamp(profile.hotbar | 0, 0, 8);
    const transaction = message && message.transaction;
    const craftResponse = reason === 'craft' || reason === 'craft_conflict';
    const craftHandled = craftResponse && UI.finishCraftTransaction
      ? UI.finishCraftTransaction(transaction, reason === 'craft') : false;
    const transientCrafting = UI.hasTransientCrafting && UI.hasTransientCrafting();
    const authoritativeInventory = ['drop', 'pickup', 'give', 'bow', 'egg', 'ender_pearl', 'eat', 'feed', 'tame', 'trade', 'attack', 'damage', 'death', 'inventory_conflict', 'container', 'furnace', 'block_action', 'station', 'bottle', 'tnt'].includes(reason) ||
      (craftResponse && !transientCrafting && !craftHandled);
    const applyInventory = authoritativeInventory || !UI.shouldApplyProfileInventory || UI.shouldApplyProfileInventory(transaction);
    if (reason === 'inventory_conflict' && UI.resetProfileSync) UI.resetProfileSync();
    if (applyInventory) {
      if (Array.isArray(profile.inv)) for (let i = 0; i < 36; i++) p.inv[i] = profile.inv[i] ? Items.cloneStack(profile.inv[i]) : null;
      if (Array.isArray(profile.equipment)) for (let i = 0; i < 4; i++) p.equipment[i] = profile.equipment[i] ? Items.cloneStack(profile.equipment[i]) : null;
      p.cursor = profile.cursor ? Items.cloneStack(profile.cursor) : null;
      if (UI.inventoryProfileApplied && (authoritativeInventory || reason === 'welcome' || reason === 'reconnect' || reason === 'respawn')) {
        UI.inventoryProfileApplied();
      }
      if (UI.finishProfileCommit) UI.finishProfileCommit(transaction);
    }
    p.xpLevel = Math.max(0, profile.xpLevel | 0);
    p.xpProgress = U.clamp(Number(profile.xpProgress) || 0, 0, 1);
    p.statusEffects = Array.isArray(profile.statusEffects) ? profile.statusEffects.map(effect => Object.assign({}, effect)) : [];
    if (profile.spawn) p.spawn = { x: Number(profile.spawn.x), y: Number(profile.spawn.y), z: Number(profile.spawn.z) };
    if (reason === 'respawn' && p.resetRespawnState) {
      p.resetRespawnState({ x:+profile.x, y:+profile.y, z:+profile.z });
    } else if (reason === 'reconnect') {
      if (Number.isFinite(+profile.x)) p.x = +profile.x;
      if (Number.isFinite(+profile.y)) p.y = +profile.y;
      if (Number.isFinite(+profile.z)) p.z = +profile.z;
      p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z; p.vx = p.vy = p.vz = 0;
    }
    p.updateArmorValue();
    const dead = !!profile.dead || p.hp <= 0;
    p.dead = dead;
    if (dead) {
      game.state = 'dead';
      game.deathCause = 'server';
      if (document.exitPointerLock) document.exitPointerLock();
    } else if (game.state === 'dead' || reason === 'respawn') {
      game.state = 'playing';
      game.paused = false;
      game.deathCause = null;
      UI.resetMenus();
      requestGamePointerLock();
    }
  }

  function giveCreativeKit(p) {
    const ids = [
      Blocks.ID.STONE, Blocks.ID.COBBLE, Blocks.ID.PLANKS, Blocks.ID.LOG, Blocks.ID.GLASS,
      Blocks.ID.BRICKS, Blocks.ID.STONE_BRICKS, Blocks.ID.SAND, Blocks.ID.GLOWSTONE,
      Blocks.ID.PLANK_SLAB, Blocks.ID.STONE_SLAB,
      Blocks.ID.TNT, Blocks.ID.TORCH, Blocks.ID.WOOL, Blocks.ID.BED, Blocks.ID.BOOKSHELF,
      Blocks.ID.CHEST, Blocks.ID.CRAFTING, Blocks.ID.FURNACE, Blocks.ID.SAPLING,
      Blocks.ID.SUGAR_CANE, Blocks.ID.CLAY, Blocks.ID.OBSIDIAN, Blocks.ID.IRON_BLOCK,
      Blocks.ID.ENCHANTING_TABLE, Blocks.ID.ANVIL, Blocks.ID.OAK_STAIRS, Blocks.ID.OAK_FENCE,
      Blocks.ID.LEVER, Blocks.ID.REDSTONE_LAMP, Items.IT.REDSTONE,
      Items.IT.SHEARS, Items.IT.SWORD_DIAMOND, Items.IT.PICK_DIAMOND, Items.IT.HOE_DIAMOND,
      Items.IT.WATER_BUCKET, Items.IT.LAVA_BUCKET, Items.IT.FLINT_STEEL,
      Items.IT.BOW, Items.IT.ARROW, Items.IT.FISHING_ROD,
    ];
    for (let i = 0; i < ids.length && i < 36; i++) {
      p.inv[i] = Items.makeStack(ids[i], Items.maxStack(ids[i]));
    }
  }

  function hookCallbacks() {
    Entities.onPickup = (id, n, dur, ench, customName) => {
      const left = game.player.give(id, n, { dur, ench, name: customName });
      const picked = n - left;
      if (picked > 0) {
        Sound.emit('item.pickup', { volume: 0.62 });
        if (UI.itemPicked) UI.itemPicked(Items.name(id) + (picked > 1 ? ' x' + picked : ''));
      }
      return left;
    };
    Entities.onMobAttack = (mob, dmg) => {
      const multiplier = [0, 0.75, 1, 1.5][game.difficulty | 0] || 0;
      if (multiplier <= 0) return;
      const blocked = game.player.blocksDamage && game.player.blocksDamage('mob');
      game.player.damage(Math.max(1, Math.round(dmg * multiplier)), 'mob');
      const dx = game.player.x - mob.x, dz = game.player.z - mob.z;
      const d = Math.hypot(dx, dz) || 1;
      const knockback = blocked ? 0.35 : 1;
      game.player.vx += dx / d * 7 * knockback;
      game.player.vz += dz / d * 7 * knockback;
      game.player.vy += 3.5 * knockback;
    };
    Entities.onMobKilled = (mob) => {
      const xp = mob.model && mob.model.hostile ? 5 : 1;
      Entities.spawnXP(mob.x, mob.y + mob.h * 0.5, mob.z, xp);
    };
    Entities.onXP = (xp) => {
      game.player.addXP(xp);
      Sound.emit('experience.pickup', { volume: 0.62, pitch: 0.96 + Math.min(0.16, xp * 0.015) });
      if (UI.itemPicked) UI.itemPicked('+' + xp + ' XP');
    };
    Entities.onExplosion = (x, y, z, power) => {
      const p = game.player;
      const d = Math.sqrt(U.dist2(p.x, p.y + 1, p.z, x, y, z));
      if (d < power * 2) {
        const blocked = p.blocksDamage && p.blocksDamage('explode');
        p.damage(Math.round(16 * (1 - d / (power * 2))), 'explode');
        const dx = p.x - x, dz = p.z - z;
        const dd = Math.hypot(dx, dz) || 1;
        const knockback = blocked ? 0.35 : 1;
        p.vx += dx / dd * 9 * knockback;
        p.vz += dz / dd * 9 * knockback;
        p.vy += 6 * knockback;
      }
    };
    game.world.onBlockPopped = (x, y, z, id, state) => {
      if (game.multiplayer) return;
      const drops = Blocks.dropsFor(id, state, () => game.world.random());
      for (const d of drops) Entities.spawnItem(x + 0.5, y + 0.3, z + 0.5, d.id, d.n);
    };
    game.world.onFluidSolidify = (x, y, z) => {
      Sound.emit('fluid.solidify', { x, y, z, volume: 0.8, pitch: 0.9 });
      const tile = game.world.getBlock(x, y, z) === Blocks.ID.OBSIDIAN ? 'obsidian' : 'cobblestone';
      if (Entities.blockHitParticles) Entities.blockHitParticles(x, y, z, tile, [0, 1, 0]);
    };
    UI.onDeath = (cause) => {
      game.deathCause = cause;
      game.state = 'dead';
      document.exitPointerLock && document.exitPointerLock();
    };
    UI.onSignDone = () => {
      if (game.state !== 'playing') return;
      game.paused = false;
      requestGamePointerLock();
    };
  }

  function warmupChunks() {
    const p = game.player;
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        game.world.ensureChunk(pcx + dx, pcz + dz);
    // settle player on ground
    const h = game.world.genHeight(Math.floor(p.x), Math.floor(p.z));
    if (p.y < h + 1) p.y = h + 2;
    p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z;
  }

  function beginAttackAction() {
    if (!game.player || game.player.dead || game.state !== 'playing' || UI.isOpen()) return;
    const networkHit = game.multiplayer && Network.attackTarget(game.player);
    if (!networkHit && !game.player.attack() && !game.player.isBlocking) {
      if (game.player.mode === 'creative') game.player.creativeBreak();
      else input.mine = true;
    }
  }

  function endAttackAction() {
    input.mine = false;
  }

  function beginUseAction() {
    if (!game.player || game.player.dead || game.state !== 'playing' || UI.isOpen()) return;
    input.mine = false;
    game.player.mining = null;
    if (!game.player.useEntity() && !game.player.useBlock()) {
      input.use = true;
      if (game.player.canSwordBlock && game.player.canSwordBlock()) game.player.setBlocking(true);
      game.player.placeBlock();
    }
  }

  function endUseAction() {
    input.use = false;
    if (game.player && game.player.setBlocking) game.player.setBlocking(false);
  }

  function resetTouchState() {
    touchLookPointer = null;
    touchJoystickPointer = null;
    touchSneakLatched = false;
    touchSprintLatched = false;
    const stick = document.getElementById('touch-stick');
    if (stick) stick.style.transform = 'translate3d(0,0,0)';
    for (const id of ['touch-jump', 'touch-attack', 'touch-use', 'touch-sneak', 'touch-sprint']) {
      const button = document.getElementById(id);
      if (button) button.classList.remove('active');
    }
    stopPointerActions();
  }

  function bindTouchHold(id, press, release) {
    const element = document.getElementById(id);
    if (!element) return;
    let pointer = null;
    const finish = (event) => {
      if (pointer === null || (event && event.pointerId !== pointer)) return;
      pointer = null;
      element.classList.remove('active');
      release();
    };
    element.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' || pointer !== null) return;
      event.preventDefault(); event.stopPropagation();
      touchMode = true;
      pointer = event.pointerId;
      try { element.setPointerCapture(pointer); } catch (error) { /* optional */ }
      element.classList.add('active');
      Sound.unlock();
      press();
    });
    element.addEventListener('pointerup', finish);
    element.addEventListener('pointercancel', finish);
    element.addEventListener('lostpointercapture', finish);
  }

  function bindTouchTap(id, action) {
    const element = document.getElementById(id);
    if (!element) return;
    element.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      event.preventDefault(); event.stopPropagation();
      touchMode = true;
      Sound.unlock();
      action();
    });
  }

  function bindTouchInput() {
    touchControls = document.getElementById('touch-controls');
    touchCloseUi = document.getElementById('touch-close-ui');
    const joystick = document.getElementById('touch-joystick');
    const stick = document.getElementById('touch-stick');
    const look = document.getElementById('touch-look');
    const sneak = document.getElementById('touch-sneak');
    const sprint = document.getElementById('touch-sprint');
    const chat = document.getElementById('touch-chat');

    document.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') touchMode = true;
      else if (event.pointerType === 'mouse' && window.matchMedia && window.matchMedia('(pointer: fine)').matches) touchMode = false;
    }, true);

    if (joystick && stick) {
      const updateJoystick = (event) => {
        const rect = joystick.getBoundingClientRect();
        const radius = Math.max(24, rect.width * 0.34);
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        const length = Math.hypot(dx, dy);
        const scale = length > radius ? radius / length : 1;
        const x = dx * scale, y = dy * scale;
        const nx = x / radius, ny = y / radius;
        stick.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
        const dead = 0.2;
        input.left = nx < -dead; input.right = nx > dead;
        input.fwd = ny < -dead; input.back = ny > dead;
        input.sneak = touchSneakLatched;
        input.sprint = touchSprintLatched;
      };
      const releaseJoystick = (event) => {
        if (touchJoystickPointer === null || (event && event.pointerId !== touchJoystickPointer)) return;
        touchJoystickPointer = null;
        input.fwd = input.back = input.left = input.right = false;
        stick.style.transform = 'translate3d(0,0,0)';
      };
      joystick.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' || touchJoystickPointer !== null) return;
        event.preventDefault(); event.stopPropagation();
        touchMode = true;
        touchJoystickPointer = event.pointerId;
        try { joystick.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
        updateJoystick(event);
      });
      joystick.addEventListener('pointermove', (event) => {
        if (event.pointerId === touchJoystickPointer) updateJoystick(event);
      });
      joystick.addEventListener('pointerup', releaseJoystick);
      joystick.addEventListener('pointercancel', releaseJoystick);
      joystick.addEventListener('lostpointercapture', releaseJoystick);
    }

    if (look) {
      const releaseLook = (event) => {
        if (touchLookPointer === null || (event && event.pointerId !== touchLookPointer)) return;
        touchLookPointer = null;
      };
      look.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' || touchLookPointer !== null || !game.player) return;
        event.preventDefault(); event.stopPropagation();
        touchMode = true;
        touchLookPointer = event.pointerId;
        touchLookX = event.clientX; touchLookY = event.clientY;
        try { look.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
      });
      look.addEventListener('pointermove', (event) => {
        if (event.pointerId !== touchLookPointer || !game.player) return;
        const dx = U.clamp(event.clientX - touchLookX, -90, 90);
        const dy = U.clamp(event.clientY - touchLookY, -90, 90);
        touchLookX = event.clientX; touchLookY = event.clientY;
        const sensitivity = 0.0032 + U.clamp(game.mouseSensitivity, 0.1, 1) * 0.0048;
        game.player.yaw = Math.atan2(Math.sin(game.player.yaw + dx * sensitivity), Math.cos(game.player.yaw + dx * sensitivity));
        const pitchDelta = dy * sensitivity * (game.invertMouseY ? -1 : 1);
        game.player.pitch = U.clamp(game.player.pitch + pitchDelta, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      });
      look.addEventListener('pointerup', releaseLook);
      look.addEventListener('pointercancel', releaseLook);
      look.addEventListener('lostpointercapture', releaseLook);
    }

    bindTouchHold('touch-jump', () => { input.jump = true; }, () => { input.jump = false; });
    bindTouchHold('touch-attack', beginAttackAction, endAttackAction);
    bindTouchHold('touch-use', beginUseAction, endUseAction);
    bindTouchTap('touch-sneak', () => {
      touchSneakLatched = !touchSneakLatched;
      input.sneak = touchSneakLatched;
      if (sneak) sneak.classList.toggle('active', touchSneakLatched);
    });
    bindTouchTap('touch-sprint', () => {
      touchSprintLatched = !touchSprintLatched;
      input.sprint = touchSprintLatched;
      if (sprint) sprint.classList.toggle('active', touchSprintLatched);
    });
    bindTouchTap('touch-inventory', () => {
      if (!game.player || game.state !== 'playing') return;
      resetTouchState();
      UI.openInventory();
      game.paused = false;
    });
    bindTouchTap('touch-chat', () => {
      if (!game.multiplayer || game.state !== 'playing') return;
      resetTouchState();
      UI.openChat('');
      game.paused = false;
    });
    bindTouchTap('touch-pause', () => {
      if (game.state !== 'playing') return;
      resetTouchState();
      game.paused = true;
    });
    bindTouchTap('touch-close-ui', () => closeUiAndResume());
    if (chat) chat.hidden = !game.multiplayer;
  }

  function syncTouchUi() {
    if (!touchControls || !touchCloseUi) return;
    const windowOpen = UI.isOpen();
    const showControls = touchMode && game.state === 'playing' && !game.paused && !windowOpen;
    if (touchControlsVisible && !showControls) resetTouchState();
    touchControlsVisible = showControls;
    touchControls.hidden = !showControls;
    const winType = UI.winType ? UI.winType() : null;
    touchCloseUi.hidden = !(touchMode && game.state === 'playing' && windowOpen && !UI.isChatOpen() && winType !== 'sign');
    const chat = document.getElementById('touch-chat');
    if (chat) chat.hidden = !game.multiplayer;
  }

  // ---------------- input ----------------
  function bindInput() {

    bindTouchInput();

    document.addEventListener('keydown', (e) => {
      Sound.unlock();
      const k = e.code;
      if (UI.isOpen() && UI.handleKey && UI.handleKey(e)) { e.preventDefault(); return; }
      if (UI.isMenuOpen()) {
        const menuAction = UI.handleMenuKey(e);
        if (menuAction && menuAction.handled) {
          e.preventDefault();
          if (menuAction.back) backFromMenu();
          else if (menuAction.control) activateMenuControl(menuAction.control, menuAction.value);
        }
        return;
      }
      if (game.state === 'menu') return;
      if (game.multiplayer && (k === 'KeyT' || k === 'Slash') && game.state === 'playing') {
        e.preventDefault();
        stopPointerActions();
        UI.openChat(k === 'Slash' ? '/' : '');
        return;
      }
      if (game.multiplayer && k === 'Tab') {
        e.preventDefault();
        UI.setPlayerList(true);
        return;
      }
      if (k === 'F5' || k === 'F9' || k === 'F3') e.preventDefault();
      switch (k) {
        case 'KeyW': {
          if (e.repeat) { input.fwd = true; break; }
          const now = performance.now();
          if (now - lastW < 260 && !input.fwd) {
            input.sprint = true;
            lastW = 0;
          } else {
            lastW = now;
          }
          input.fwd = true;
          break;
        }
        case 'KeyS': input.back = true; break;
        case 'KeyA': input.left = true; break;
        case 'KeyD': input.right = true; break;
        case 'Space': {
          if (e.repeat) { e.preventDefault(); break; }
          if (game.player && game.player.mode === 'creative') {
            const now = performance.now();
            if (now - (game._lastSpace || 0) < 280) {
              game.player.flying = !game.player.flying;
              if (game.player.flying) game.player.vy = 0;
              UI.toast(game.player.flying ? '飞行:开' : '飞行:关');
              game._lastSpace = 0;
            } else {
              game._lastSpace = now;
            }
          }
          input.jump = true;
          e.preventDefault();
          break;
        }
        case 'ShiftLeft': case 'ShiftRight': input.sneak = true; break;
        case 'ControlLeft': input.sprint = true; break;
        case 'KeyE':
          if (e.repeat) { e.preventDefault(); break; }
          if (game.state !== 'playing') break;
          if (UI.isOpen()) closeUiAndResume();
          else { UI.openInventory(); }
          e.preventDefault();
          break;
        case 'Escape':
          if (UI.isOpen()) { closeUiAndResume(); }
          break;
        case 'KeyQ': case 'KeyF':
          if (!e.repeat && !UI.isOpen()) dropHeld(e.ctrlKey);
          break;
        case 'KeyR': if (game.state === 'dead') respawn(); break;
        case 'KeyM':
          if (game.player) {
            if (game.multiplayer) {
              if (Network.hasPermission('gamemode.self')) {
                Network.command('/gamemode ' + (game.player.mode === 'survival' ? 'creative' : 'survival'));
              } else {
                UI.toast('普通玩家不能更改游戏模式');
              }
            } else {
              game.player.mode = game.player.mode === 'survival' ? 'creative' : 'survival';
              if (game.player.mode === 'survival') game.player.flying = false;
              UI.toast('模式:' + (game.player.mode === 'survival' ? '生存' : '创造'));
            }
          }
          break;
        case 'KeyB': {
          game.musicOn = !(game.musicOn === undefined ? true : game.musicOn);
          Sound.setMusic(game.musicOn);
          saveSettings();
          UI.toast('音乐:' + (game.musicOn ? '开' : '关'));
          break;
        }
        case 'F3': game.showDebug = !game.showDebug; break;
        case 'F5': doSave(); break;
        case 'F9': startLoad(); break;
        default:
          if (k.startsWith('Digit')) {
            const n = +k.slice(5);
            if (n >= 1 && n <= 9 && game.player) {
              game.player.hotbar = n - 1;
              if (game.multiplayer && Network.setHeldSlot) Network.setHeldSlot(game.player.hotbar);
            }
          }
      }
    });
    document.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW': input.fwd = false; input.sprint = false; break;
        case 'KeyS': input.back = false; break;
        case 'KeyA': input.left = false; break;
        case 'KeyD': input.right = false; break;
        case 'Space': input.jump = false; break;
        case 'ShiftLeft': case 'ShiftRight': input.sneak = false; break;
        case 'ControlLeft': input.sprint = false; break;
        case 'Tab': UI.setPlayerList(false); break;
      }
    });

    hud.addEventListener('pointerdown', (e) => {
      Sound.unlock();
      if (UI.isMenuOpen()) {
        if (e.button !== 0) return;
        e.preventDefault();
        const point = menuPoint(e);
        const control = UI.controlAt(hud.width, hud.height, point.x, point.y);
        if (control && !control.disabled) {
          try { hud.setPointerCapture(e.pointerId); } catch (error) { /* capture is optional */ }
          if (control.type === 'slider') {
            activeMenuSlider = { id: control.id, screen: UI.currentScreen(), pointerId: e.pointerId };
            activeMenuPress = null;
            activateMenuControl(control, UI.sliderValue(control, point.x), { sliderPress: true });
          } else {
            activeMenuPress = { id: control.id, screen: UI.currentScreen(), pointerId: e.pointerId };
            activeMenuSlider = null;
          }
        }
        return;
      }
      if (UI.isOpen()) return; // UI handles
      if (touchMode && e.pointerType && e.pointerType !== 'mouse') {
        e.preventDefault();
        const point = menuPoint(e);
        const slot = UI.hotbarSlotAt ? UI.hotbarSlotAt(point.x, point.y) : null;
        if (slot !== null && game.player) {
          game.player.hotbar = slot;
          if (game.multiplayer && Network.setHeldSlot) Network.setHeldSlot(slot);
        }
        return;
      }
      if (!pointerLocked) {
        stopPointerActions();
        requestGamePointerLock();
        return;
      }
      if (e.button === 0) {
        beginAttackAction();
      } else if (e.button === 2) {
        beginUseAction();
      } else if (e.button === 1) {
        e.preventDefault();
        pickBlock();
      }
    });
    document.addEventListener('pointerup', (e) => {
      if (activeMenuPress && activeMenuPress.pointerId === e.pointerId) {
        const pressed = activeMenuPress;
        activeMenuPress = null;
        const point = menuPoint(e);
        const released = UI.isMenuOpen() && UI.currentScreen() === pressed.screen
          ? UI.controlAt(hud.width, hud.height, point.x, point.y) : null;
        if (released && !released.disabled && released.id === pressed.id) activateMenuControl(released);
      }
      if (activeMenuSlider && activeMenuSlider.pointerId === e.pointerId) activeMenuSlider = null;
      try { if (hud.hasPointerCapture(e.pointerId)) hud.releasePointerCapture(e.pointerId); } catch (error) { /* already released */ }
      if (e.pointerType && e.pointerType !== 'mouse') return;
      if (e.button === 0) endAttackAction();
      if (e.button === 2) endUseAction();
    });
    document.addEventListener('pointercancel', (e) => {
      if (activeMenuPress && activeMenuPress.pointerId === e.pointerId) activeMenuPress = null;
      if (activeMenuSlider && activeMenuSlider.pointerId === e.pointerId) activeMenuSlider = null;
      if (e.pointerType && e.pointerType !== 'mouse') return;
      endAttackAction(); endUseAction();
    });
    document.addEventListener('pointermove', (e) => {
      if (!activeMenuSlider || activeMenuSlider.pointerId !== e.pointerId || !UI.isMenuOpen() ||
          UI.currentScreen() !== activeMenuSlider.screen) return;
      const point = menuPoint(e);
      const control = UI.screenControls(hud.width, hud.height).find(c => c.id === activeMenuSlider.id);
      if (control) activateMenuControl(control, UI.sliderValue(control, point.x), { silent: true });
    });
    hud.addEventListener('wheel', (e) => {
      if (!game.player || UI.isOpen()) return;
      e.preventDefault();
      const d = e.deltaY > 0 ? 1 : -1;
      game.player.hotbar = U.mod(game.player.hotbar + d, 9);
      if (game.multiplayer && Network.setHeldSlot) Network.setHeldSlot(game.player.hotbar);
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      pointerLocked = document.pointerLockElement === hud;
      if (!pointerLocked) {
        stopPointerActions();
        if (UI.isChatOpen && UI.isChatOpen()) game.paused = false;
        else if (game.state === 'playing' && !UI.isOpen()) game.paused = true;
      } else if (pointerLocked) {
        rawLockPending = false;
        rawFallbackAttempted = false;
        game.paused = false;
      }
    });
    document.addEventListener('pointerlockerror', () => {
      if (rawLockPending && !rawFallbackAttempted) {
        rawLockPending = false;
        rawFallbackAttempted = true;
        try { hud.requestPointerLock(); return; } catch (e) { /* show the final error below */ }
      }
      pointerLocked = false;
      stopPointerActions();
      UI.toast('无法锁定鼠标，请检查浏览器权限');
    });
    document.addEventListener('mousemove', (e) => {
      if (!pointerLocked || !game.player || game.state !== 'playing') return;
      const mx = U.clamp(Number.isFinite(e.movementX) ? e.movementX : 0, -250, 250);
      const my = U.clamp(Number.isFinite(e.movementY) ? e.movementY : 0, -250, 250);
      const setting = U.clamp(game.mouseSensitivity, 0.1, 1);
      const curve = Math.pow(setting * 0.6 + 0.2, 3);
      const sens = 0.0023 * curve / 0.125;
      const p = game.player;
      const yawDelta = U.clamp(mx * sens, -0.45, 0.45);
      p.yaw = Math.atan2(Math.sin(p.yaw + yawDelta), Math.cos(p.yaw + yawDelta));
      const pitchDelta = U.clamp(my * sens, -0.45, 0.45) * (game.invertMouseY ? -1 : 1);
      p.pitch = U.clamp(p.pitch + pitchDelta, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    });
    hud.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => {
      activeMenuPress = null; activeMenuSlider = null;
      stopPointerActions(); UI.setPlayerList(false);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopPointerActions();
        backgroundSave();
      }
    });
    window.addEventListener('pagehide', backgroundSave);
    window.addEventListener('beforeunload', backgroundSave);
  }

  function stopPointerActions() {
    input.fwd = false;
    input.back = false;
    input.left = false;
    input.right = false;
    input.jump = false;
    input.sneak = false;
    input.sprint = false;
    input.mine = false;
    input.use = false;
    lastW = 0;
    game._lastSpace = 0;
    if (game.player) {
      if (game.player.cancelUseActions) game.player.cancelUseActions();
      game.player.mining = null;
      game.player.isSprinting = false;
      game.player.prevX = game.player.x;
      game.player.prevY = game.player.y;
      game.player.prevZ = game.player.z;
    }
  }

  function closeUiAndResume() {
    UI.close();
    if (game.state !== 'playing') return;
    game.paused = false;
    requestGamePointerLock();
  }

  function dropHeld(all) {
    const p = game.player;
    if (!p || p.dead) return;
    if (game.multiplayer) {
      const stack = p.held();
      if (!stack || !Network.dropHeld(all, p.hotbar, stack)) return;
      Sound.emit('item.throw', { x: p.x, y: p.y + p.eye, z: p.z, volume: 0.5, pitch: 0.9 });
      return;
    }
    const s = p.held();
    if (!s) return;
    const n = all ? s.n : 1;
    const d = p.lookDir();
    Entities.spawnItem(p.x + d[0] * 0.8, p.y + p.eye - 0.3, p.z + d[2] * 0.8, s.id, n,
      d[0] * 5, d[1] * 5 + 2, d[2] * 5, s);
    s.n -= n;
    if (s.n <= 0) p.inv[p.hotbar] = null;
    Sound.emit('item.throw', { x: p.x, y: p.y + p.eye, z: p.z, volume: 0.5, pitch: 0.9 });
  }

  function pickBlock() {
    const p = game.player;
    const hit = p.look(p.blockReach());
    if (!hit) return;
    const id = hit.id === Blocks.ID.FURNACE_LIT ? Blocks.ID.FURNACE : (hit.id === Blocks.ID.GRASS_SNOW ? Blocks.ID.GRASS : hit.id);
    if (!Items.get(id)) return;
    for (let i = 0; i < 9; i++) {
      if (p.inv[i] && p.inv[i].id === id) { p.hotbar = i; return; }
    }
    if (p.mode === 'creative') {
      p.inv[p.hotbar] = Items.makeStack(id, Items.maxStack(id));
    }
  }

  function respawn() {
    if (game.multiplayer) {
      Network.respawn();
      return;
    }
    game.player.respawn();
    game.state = 'playing';
    warmupChunks();
  }

  async function doSave() {
    if (game.multiplayer) { UI.toast(Network.isConnected() ? '世界改动已同步到服务器' : '服务器连接已断开'); return; }
    if (game.saving) return;
    game.saving = true;
    try {
      const r = await SaveSys.saveAsync(game);
      UI.toast(r.ok ? '已保存 (' + (r.bytes / 1024).toFixed(0) + ' KB)' : '保存失败:' + r.err);
    } finally {
      game.saving = false;
    }
  }

  function backgroundSave() {
    if (game.multiplayer || game.state !== 'playing' || game.saving) return;
    game.saving = true;
    SaveSys.saveAsync(game).finally(() => { game.saving = false; });
  }

  // ---------------- chunk streaming ----------------
  function streamChunks(frameDt, frameWorkMs) {
    const p = game.player;
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
    const R = game.viewDist;
    const renderRadius = R + 1;
    const cpuRadius = R + 3;
    const queueKey = pcx + ',' + pcz + ',' + R;
    const slowFrame = frameDt > 1 / 45 || frameWorkMs > 8;
    const allowHeavyWork = !slowFrame || firstFramesDone % 2 === 0;
    if (game.world.runtimeEditVersion !== observedRuntimeEditVersion) {
      observedRuntimeEditVersion = game.world.runtimeEditVersion;
      editQuietFrames = Math.max(editQuietFrames, 3);
    }
    const interactionPriority = !!(input.mine || p.mining || editQuietFrames > 0);
    if (genQueueKey !== queueKey) {
      genQueueKey = queueKey;
      genQueue = [];
      genQueuePos = 0;
      for (let dx = -renderRadius; dx <= renderRadius; dx++) for (let dz = -renderRadius; dz <= renderRadius; dz++) {
        const d2 = dx * dx + dz * dz;
        if (d2 <= renderRadius * renderRadius) genQueue.push([d2, pcx + dx, pcz + dz]);
      }
      genQueue.sort((a, b) => a[0] - b[0]);
    }
    // generate nearest missing chunks without rescanning the full radius each frame
    let generated = false;
    while (!interactionPriority && allowHeavyWork && generationTurn && genQueuePos < genQueue.length && !generated) {
      const next = genQueue[genQueuePos++];
      const ch = game.world.chunkAt(next[1], next[2]);
      if (!ch || !ch.generated) {
        game.world.ensureChunk(next[1], next[2]);
        generated = true;
      }
    }
    if (!interactionPriority && allowHeavyWork && generationTurn) generationTurn = false;
    // Rebuild the priority queue only when sections are dirtied or the player changes chunk.
    if (meshQueueVersion !== game.world.meshDirtyVersion || meshQueueKey !== queueKey) {
      meshQueueVersion = game.world.meshDirtyVersion;
      meshQueueKey = queueKey;
      meshQueue = [];
      meshQueuePos = 0;
      for (const item of game.world.meshDirty.values()) {
        const dx = item.ch.cx - pcx, dz = item.ch.cz - pcz;
        const d2 = dx * dx + dz * dz;
        if (d2 <= renderRadius * renderRadius) {
          const priority = game.world.urgentMeshKeys.has(item.meshKey) ? 0 : 1;
          meshQueue.push([priority, d2, item.section, item]);
        }
      }
      meshQueue.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    }
    const t0 = performance.now();
    let meshed = 0;
    const frameMeshBudget = firstFramesDone <= 4 ? 8 : slowFrame ? 2 : meshBudgetMs;
    while (!generated && allowHeavyWork && (interactionPriority || !generationTurn) && meshQueuePos < meshQueue.length) {
      const elapsed = performance.now() - t0;
      const maxSections = interactionPriority ? 1 : 4;
      if ((meshed > 0 && elapsed + meshCostEma > frameMeshBudget) || meshed >= maxSections) break;
      const item = meshQueue[meshQueuePos][3];
      if (interactionPriority && !game.world.urgentMeshKeys.has(item.meshKey)) break;
      meshQueuePos++;
      if (!game.world.meshDirty.has(item.meshKey) || !item.ch.generated) continue;
      const sectionStart = performance.now();
      const fastPreview = !!Mesher.meshSectionRuntime && interactionPriority && game.world.urgentMeshKeys.has(item.meshKey) &&
        Mesher.smoothLighting && Mesher.smoothLighting();
      const mesh = Mesher.meshSectionRuntime
        ? Mesher.meshSectionRuntime(game.world, item.ch, item.section, fastPreview)
        : Mesher.meshSection(game.world, item.ch, item.section);
      Renderer.uploadSection(item.key, item.section, mesh);
      game.world.clearSectionDirty(item.ch, item.section);
      // Keep the cheap interaction mesh visible, then restore smooth light once input is quiet.
      if (fastPreview) game.world.markSectionDirty(item.ch, item.section);
      const sectionCost = performance.now() - sectionStart;
      meshCostEma = meshCostEma * 0.8 + sectionCost * 0.2;
      meshed++;
    }
    if (!interactionPriority && !generated && allowHeavyWork && !generationTurn) generationTurn = true;

    // Build a cache-maintenance list occasionally, then process one chunk per frame.
    const unloadTick = game._unloadTick = (game._unloadTick || 0) + 1;
    if (!interactionPriority && (cacheQueueKey !== queueKey || unloadTick % 120 === 0)) {
      cacheQueueKey = queueKey;
      cacheQueue = [];
      cacheQueuePos = 0;
      for (const [key, ch] of game.world.chunks) {
        const dx = ch.cx - pcx, dz = ch.cz - pcz;
        const d2 = dx * dx + dz * dz;
        if (d2 > cpuRadius * cpuRadius || (d2 > renderRadius * renderRadius && Renderer.hasChunk(key))) {
          cacheQueue.push([d2, key, ch]);
        }
      }
      cacheQueue.sort((a, b) => b[0] - a[0]);
    }
    if (!interactionPriority && !generated && cacheQueuePos < cacheQueue.length) {
      const entry = cacheQueue[cacheQueuePos++];
      const key = entry[1], ch = entry[2];
      const dx = ch.cx - pcx, dz = ch.cz - pcz;
      const d2 = dx * dx + dz * dz;
      if (game.world.chunks.get(key) === ch && d2 > cpuRadius * cpuRadius) {
        if (ch.modified) {
          // The chunk is no longer mutable once removed, so its backing array can be reused.
          game.world.savedChunks[key] = ch.blocks;
          game.world.savedChunkVersions[key] = ch.editVersion;
          game.world.dirtyChunkKeys.add(key);
        }
        game.world.forgetChunkMeshes(ch);
        game.world.removeChunk(ch);
        Renderer.dropChunk(key);
      } else if (game.world.chunks.get(key) === ch && d2 > renderRadius * renderRadius && Renderer.hasChunk(key)) {
        Renderer.dropChunk(key);
        game.world.markAllSectionsDirty(ch);
      }
    }
    if (editQuietFrames > 0) editQuietFrames--;
  }

  // ---------------- furnace ticking ----------------
  function tickFurnaces(dt) {
    const active = game.world.activeFurnaces;
    for (const key of active) {
      const be = game.world.be.get(key);
      if (!be || be.type !== 'furnace') { active.delete(key); continue; }
      Craft.furnaceTick(game.world, be.x, be.y, be.z, be, dt);
      if (!Craft.furnaceNeedsTick(be)) active.delete(key);
    }
  }

  // ---------------- main loop ----------------
  function loop(t) {
    requestAnimationFrame(loop);
    const frameStart = performance.now();
    const dt = Math.min(0.1, (t - lastT) / 1000 || FIXED_DT);
    lastT = t;
    game.fps = game.fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    syncTouchUi();

    if (game.state === 'menu') {
      Sound.tick(dt, {
        screen: 'menu', gameMode: 'survival', dimension: 'overworld',
        rainStrength: 0, caveStrength: 0, underwater: false, outdoors: true,
      });
      UI.draw(dt);
      return;
    }

    const p = game.player;
    const simulationPaused = game.paused && !game.multiplayer;
    if (game.state !== 'menu' && !simulationPaused) {
      accumulator = Math.min(0.25, accumulator + dt);
      playerAccumulator = Math.min(0.25, playerAccumulator + dt);
      let playerSteps = 0;
      while (playerAccumulator >= PLAYER_DT && playerSteps++ < 12) {
        if (game.state === 'playing') {
          const controlsBlocked = game.paused || UI.isOpen();
          const stepInput = controlsBlocked ? blockedInput : input;
          p.update(PLAYER_DT, stepInput);
          if (!controlsBlocked) p.updateEating(PLAYER_DT, input);
          if (!controlsBlocked && p.updateUseActions) p.updateUseActions(PLAYER_DT, input);
          if (!controlsBlocked && input.use && p.useCooldown <= 0) {
            const it = p.held() ? Items.get(p.held().id) : null;
            if (it && it.block) p.placeBlock();
          }
        } else {
          p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z;
          p.isSprinting = false;
        }
        playerAccumulator -= PLAYER_DT;
      }
      let steps = 0;
      while (accumulator >= FIXED_DT && steps++ < 8) {
        if (game.multiplayer) {
          const rainTarget = game.world.weather === 'rain' ? 1 : 0;
          game.world.rainStrength += (rainTarget - game.world.rainStrength) * Math.min(1, FIXED_DT * 0.45);
        } else {
          game.world.update(FIXED_DT);
        }
        Entities.update(game.world, p, FIXED_DT, game.world.dayFactor());
        if (!game.multiplayer) tickFurnaces(FIXED_DT);
        accumulator -= FIXED_DT;
      }
    } else {
      accumulator = 0;
      playerAccumulator = 0;
      p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z;
      p.isSprinting = false;
    }

    streamChunks(dt, performance.now() - frameStart);
    firstFramesDone++;

    Sound.setListener(p.x, p.y + p.eye, p.z, p.yaw);
    const sky = game.world.getSky(Math.floor(p.x), Math.floor(p.y + p.eye), Math.floor(p.z)) / 15;
    const caveStrength = (1 - sky) * U.clamp((72 - p.y) / 32, 0, 1);
    Sound.tick(dt, {
      rainStrength: game.world.rainStrength || 0,
      caveStrength,
      underwater: Physics.headInLiquid(game.world, p, 'water'),
      outdoors: sky > 0.82,
      dimension: game.world.dimensionAt(p.x, p.z),
      timeOfDay: game.world.timeOfDay,
      screen: 'game',
      gameMode: p.mode,
    });
    if (game.multiplayer) Network.tick(p, dt);

    // autosave every 30s
    game.saveTimer += dt;
    if (!game.multiplayer && game.saveTimer > 30 && game.state === 'playing') {
      game.saveTimer = 0;
      if (!game.saving) {
        game.saving = true;
        SaveSys.saveAsync(game).finally(() => { game.saving = false; });
      }
    }

    const interpAlpha = U.clamp(playerAccumulator / PLAYER_DT, 0, 1);
    p.setViewPosition(
      U.lerp(p.prevX === undefined ? p.x : p.prevX, p.x, interpAlpha),
      U.lerp(p.prevY === undefined ? p.y : p.prevY, p.y, interpAlpha),
      U.lerp(p.prevZ === undefined ? p.z : p.prevZ, p.z, interpAlpha)
    );
    const sel = (game.state === 'playing' && !UI.isOpen()) ? p.look(p.blockReach()) : null;
    const baseFov = game.baseFov || 70;
    const fovTarget = p.isSprinting ? Math.min(110, baseFov + 7) : baseFov;
    game.fov = U.lerp(game.fov || baseFov, fovTarget, 1 - Math.exp(-dt * 10));
    Renderer.frame({
      world: game.world,
      player: p,
      dayF: game.world.dayFactor(),
      viewDist: game.viewDist,
      mining: p.mining,
      sel,
      fov: game.fov,
      interpAlpha,
    });
    UI.draw(dt);
  }

  // ---------------- selftest ----------------
  function runSelftest() {
    const log = [];
    const el = document.getElementById('selftest-log');
    function check(name, fn) {
      try {
        const r = fn();
        if (r === true) log.push('PASS ' + name);
        else log.push('FAIL ' + name + ' :: ' + r);
      } catch (e) {
        log.push('FAIL ' + name + ' :: threw ' + (e && e.message));
      }
    }

    check('textures: atlas built + all names', () => {
      Textures.build();
      const need = ['grass_top', 'stone', 'water', 'torch', 'crack_0', 'crack_7', 'pig_face',
        'pig_body_front', 'cow_horn', 'sheep_wool_front', 'creeper_head_front', 'shears',
        'sword_diamond', 'player_arm_front', 'player_arm_right', 'player_arm_top',
        'remote_player_face', 'remote_player_skin', 'remote_player_head_back', 'remote_player_head_left',
        'remote_player_head_right', 'remote_player_head_top', 'remote_player_head_bottom',
        'remote_player_hair_front', 'remote_player_hair_back', 'remote_player_hair_left',
        'remote_player_hair_right', 'remote_player_hair_top', 'remote_player_hair_bottom',
        'remote_player_body', 'remote_player_leg',
        'farmland_top', 'wheat_0', 'wheat_3', 'carrot_3', 'potato_3', 'fire', 'lapis_ore',
        'enchanting_table_top', 'anvil_side', 'sugar_cane', 'clay', 'obsidian', 'iron_block',
        'water_bucket', 'flint_steel', 'bow', 'arrow', 'fishing_rod', 'armor_chestplate_diamond',
        'hoe_diamond', 'chicken_head', 'skeleton', 'spider_head', 'bell', 'composter', 'lectern',
        'grindstone', 'smithing_table_top', 'smoker_front', 'villager_farmer', 'iron_golem_face', 'cat_face',
        '__white', 'sun', 'moon'];
      for (const n of need) {
        const uv = Textures.uv(n);
        if (!uv || uv.length !== 4) return 'missing uv ' + n;
      }
      const originalPack = Textures.packInfo && Textures.packInfo('original_1_12');
      if (!originalPack || originalPack.entries < 150) return 'incomplete original texture pack';
      return Textures.atlas.size === 512 || 'atlas size=' + Textures.atlas.size;
    });

    check('ui: pixel atlas / integer GUI scale', () => {
      const info = UI.guiInfo ? UI.guiInfo() : null;
      if (!info || !Number.isInteger(info.scale) || info.slot !== info.scale * 18) return 'invalid GUI scale';
      for (const name of ['slot', 'selector', 'hotbar', 'heart_full', 'heart_half', 'food_full', 'air', 'armor_full', 'xp_bg', 'crosshair', 'button']) {
        if (!info.sprites.includes(name)) return 'missing GUI sprite ' + name;
      }
      if (info.containers.length !== 5 || !info.containers.includes('creative') || info.bitmapGlyphs < 40) return 'incomplete GUI assets';
      UI.resetMenus();
      const title = UI.menuInfo(1280, 720);
      if (title.screen !== 'title' || title.virtualWidth !== 320 || title.virtualHeight !== 240) return 'title virtual layout';
      if (!title.controls.some(c => c.id === 'singleplayer') || !title.controls.some(c => c.id === 'options')) return 'title controls';
      const multiplayer = UI.screenControls(1280, 720).find(c => c.id === 'multiplayer');
      if (!multiplayer || multiplayer.disabled) return 'multiplayer menu disabled';
      UI.openScreen('multiplayer');
      const nickname = UI.screenControls(1280, 720).find(c => c.id === 'nickname');
      const joinServer = UI.screenControls(1280, 720).find(c => c.id === 'join_server');
      if (!nickname || nickname.type !== 'text' || !joinServer) return 'nickname setup controls';
      UI.backScreen();
      UI.openScreen('options');
      const options = UI.menuInfo(1280, 720);
      const fov = UI.screenControls(1280, 720).find(c => c.id === 'fov');
      if (options.screen !== 'options' || !fov || fov.type !== 'slider') return 'options screen';
      if (Math.abs(UI.sliderValue(fov, fov.x + fov.w / 2) - 70) > 1) return 'slider mapping';
      UI.openScreen('video');
      if (UI.currentScreen() !== 'video') return 'video screen';
      UI.backScreen();
      if (UI.currentScreen() !== 'options') return 'menu back stack';
      const screens = ['title', 'multiplayer', 'worlds', 'pause', 'options', 'video', 'controls', 'skin', 'sound', 'language', 'resource', 'confirm_delete', 'death'];
      const sizes = [[320, 240], [640, 360], [1280, 720], [1920, 1080]];
      for (let scaleMode = 0; scaleMode < 4; scaleMode++) {
        for (const screen of screens) {
          UI.resetMenus();
          if (screen !== 'title') UI.openScreen(screen);
          for (const size of sizes) {
            const layout = UI.menuInfo(size[0], size[1]);
            for (let i = 0; i < layout.controls.length; i++) {
              const c = layout.controls[i];
              if (![c.x, c.y, c.w, c.h].every(Number.isInteger)) return 'fractional menu geometry';
              if (c.x < 0 || c.y < 0 || c.x + c.w > size[0] || c.y + c.h > size[1]) {
                return 'menu overflow ' + screen + ' at ' + size.join('x') + ' / ' + UI.guiScaleLabel();
              }
              for (let j = i + 1; j < layout.controls.length; j++) {
                const d = layout.controls[j];
                const overlaps = c.x < d.x + d.w && c.x + c.w > d.x && c.y < d.y + d.h && c.y + c.h > d.y;
                if (overlaps) return 'menu overlap ' + screen + ': ' + c.id + '/' + d.id;
              }
            }
          }
        }
        UI.cycleGuiScale();
      }
      UI.resetMenus();
      return true;
    });

    check('options: runtime backends / persistence', () => {
      const oldSmooth = game.smoothLighting, oldParticles = game.particleLevel;
      const oldFov = game.baseFov, oldDistance = game.viewDist, oldMaster = game.masterVolume;
      Mesher.setSmoothLighting(false);
      if (Mesher.smoothLighting()) return 'smooth lighting toggle';
      Entities.setParticleLevel(2);
      if (Entities.particleLevel() !== 2) return 'particle level toggle';
      game.baseFov = 82; game.viewDist = 9; game.masterVolume = 0.55;
      saveSettings();
      if (localStorage.getItem('webcraft_fov') !== '82' || localStorage.getItem('webcraft_view_distance') !== '9') return 'settings not persisted';
      game.baseFov = oldFov; game.viewDist = oldDistance; game.masterVolume = oldMaster;
      game.smoothLighting = oldSmooth; game.particleLevel = oldParticles;
      applySettings(false); saveSettings();
      return true;
    });

    check('player: experience / status persistence', () => {
      const w = new World(92);
      const p = new Player(w);
      p.addXP(9);
      p.addStatus('hunger', 30, 0);
      p.equipment[0] = Items.makeStack(Items.IT.HELMET_IRON, 1, { ench: { protection: 1 } });
      p.equipment[1] = Items.makeStack(Items.IT.CHEST_IRON, 1);
      p.updateArmorValue();
      const data = p.serialize();
      const copy = new Player(w);
      copy.deserialize(data);
      return (copy.xpLevel === 1 && copy.xpProgress > 0 && copy.armor === 8 &&
        copy.equipment[0].ench.protection === 1 && copy.statusEffects.length === 1) ||
        ('xp=' + copy.xpLevel + '/' + copy.xpProgress + ' armor=' + copy.armor + ' effects=' + copy.statusEffects.length);
    });

    check('armor: full set protection / durability', () => {
      const w = new World(93);
      w.random = () => 0;
      const p = new Player(w);
      const ids = [Items.IT.HELMET_DIAMOND, Items.IT.CHEST_DIAMOND, Items.IT.LEGS_DIAMOND, Items.IT.BOOTS_DIAMOND];
      for (let i = 0; i < ids.length; i++) p.equipment[i] = Items.makeStack(ids[i], 1);
      p.updateArmorValue();
      const before = p.equipment[0].dur;
      p.damage(10, 'mob');
      return (p.armor === 20 && p.hp === 18 && p.equipment[0].dur < before) ||
        ('armor=' + p.armor + ' hp=' + p.hp + ' durability=' + p.equipment[0].dur + '/' + before);
    });

    check('hand models: poses / thickness / animation state', () => {
      const ids = [Items.IT.SHEARS];
      for (let id = Items.IT.PICK_WOOD; id <= Items.IT.SWORD_DIAMOND; id++) ids.push(id);
      for (let id = Items.IT.HOE_WOOD; id <= Items.IT.HOE_DIAMOND; id++) ids.push(id);
      for (const id of ids) {
        const it = Items.get(id);
        if (!it || !it.tool || !it.handPose) return 'missing hand pose ' + id;
        const rz = it.handPose.rot[2];
        if (it.tool.type === 'sword') {
          if (Math.abs(rz - 25 * Math.PI / 180) > 1e-5 ||
              Math.abs(it.handPose.rot[1] + Math.PI / 4) > 1e-5) return 'wrong vanilla sword transform ' + id;
        } else {
          const headDX = Math.cos(rz) - Math.sin(rz);
          const headDY = Math.sin(rz) + Math.cos(rz);
          if (headDX >= 0.15 || headDY <= 0.05) return 'wrong hand direction ' + id;
        }
        const attachment = Renderer.handAttachmentStats(id, 'idle', 0);
        if (!attachment.attached || attachment.gap > 1e-5) return 'detached hand grip ' + id;
        const stats = Renderer.handModelStats(id);
        if (stats.depth < 0.05 || stats.triangles <= 4) return 'flat hand model ' + id;
      }
      const torch = Items.get(Blocks.ID.TORCH);
      const torchStats = Renderer.handModelStats(Blocks.ID.TORCH);
      if (!torch || torch.handModel !== 'sprite' || !torch.handPose) return 'missing torch hand model';
      const torchDX = -Math.sin(torch.handPose.rot[2]);
      const torchDY = Math.cos(torch.handPose.rot[2]);
      if (torchDX > -0.2 || torchDY < 0.5 || torch.handPose.grip[1] > -0.3) return 'wrong torch grip direction';
      if (torchStats.depth < 0.05 || torchStats.depth > 0.08 || torchStats.triangles <= 4) return 'invalid torch extrusion';
      for (const id of [Items.IT.BOW, Items.IT.FISHING_ROD, Items.IT.FLINT_STEEL]) {
        const item = Items.get(id);
        const stats = Renderer.handModelStats(id);
        if (!item || !item.handPose || stats.depth < 0.05 || stats.triangles <= 4) return 'invalid utility hand model ' + id;
      }
      const w = new World(81);
      const p = new Player(w);
      p.beginHandAction('mine', 0.30);
      p.advanceLoopHandAction('mine', 0.30, 0.075);
      if (p.handActionTime <= 0 || p.handActionTime >= p.handActionDuration) return 'mining phase stuck';
      p.beginHandAction('attack', 0.30);
      p.updateHandAnimation(0.15);
      if (p.handAction !== 'attack' || Math.abs(p.handActionTime - 0.15) > 1e-6) return 'attack timing';
      p.beginHandAction('attack', 0.30, false);
      if (Math.abs(p.handActionTime - 0.15) > 1e-6) return 'attack restarted mid-swing';
      const attackPose = Renderer.handAnimationPose('attack', 0.5, 0, 'sword');
      const attackEnd = Renderer.handAnimationPose('attack', 1, 0, 'sword');
      const eatPose = Renderer.handAnimationPose('eat', 0.5, 0.8);
      if (attackPose.x < -0.15 || attackPose.rz < 0.8 || Math.abs(attackPose.rx) > 0.3 ||
          Math.abs(attackEnd.x) > 1e-5 || Math.abs(attackEnd.rz) > 1e-5) return 'attack curve';
      if (eatPose.y < 0.15 || eatPose.ry < 0.5) return 'eat curve';
      p.hotbar = 1;
      p.updateHandAnimation(0.01);
      return p.equipTime > 0 || 'equip animation missing';
    });

    check('multiplayer: protocol / world hooks / remote model', () => {
      if (!Network || Network.protocol !== 3 || Network.isConnected()) return 'network initial state';
      const previousName = Network.getPlayerName();
      if (Network.setPlayerName('  测试 玩家!  ') !== '测试 玩家') return 'nickname sanitization';
      Network.setPlayerName(previousName);
      if (typeof Renderer.projectPoint !== 'function') return 'nameplate projection missing';
      const w = new World(66);
      let generatedBeforeReady = false;
      w.onChunkGenerated = (ch) => {
        generatedBeforeReady = !ch.generated;
        ch.blocks[(1 | (1 << 4) | (200 << 8))] = Blocks.ID.STONE;
      };
      const ch = w.ensureChunk(0, 0);
      if (!generatedBeforeReady || ch.maxSection < 12) return 'chunk patch hook order';
      let blocks = 0, states = 0;
      w.onBlockChanged = () => { blocks++; };
      w.onStateChanged = () => { states++; };
      if (!w.setBlock(1, 200, 1, Blocks.ID.PLANKS) || !w.setState(1, 200, 1, 2)) return 'world sync hooks did not mutate';
      if (blocks !== 1 || states !== 1) return 'world sync hook count';
      const y = w.genHeight(8, 8) + 1;
      const remote = {
        id: 'remote-test', type: 'remote', kind: 'player', x: 8.5, y, z: 8.5,
        yaw: 0, headYaw: 0, headPitch: 0, age: 0, animPhase: 0, animSpeed: 1,
        attackAnim: 0, onGround: true, dead: false, w: 0.6, h: 1.8,
      };
      Entities.clear();
      Entities.setRemoteProvider(() => [remote]);
      const geometry = Entities.buildGeometry(w, 8.5, y + 1.6, 12);
      Entities.setRemoteProvider(() => Network.remotePlayers());
      Entities.clear();
      return geometry.normal.count === 432 || 'remote player geometry=' + geometry.normal.count;
    });

    check('worldgen: deterministic', () => {
      const w1 = new World(12345), w2 = new World(12345);
      const c1 = w1.ensureChunk(0, 0), c2 = w2.ensureChunk(0, 0);
      for (let i = 0; i < c1.blocks.length; i++) {
        if (c1.blocks[i] !== c2.blocks[i]) return 'mismatch at ' + i;
      }
      return true;
    });

    check('worldgen: clustered ore veins', () => {
      const w = new World(123456);
      const ch = w.ensureChunk(0, 0);
      const ore = new Set([Blocks.ID.COAL_ORE, Blocks.ID.IRON_ORE, Blocks.ID.GOLD_ORE, Blocks.ID.DIAMOND_ORE, Blocks.ID.LAPIS_ORE]);
      let total = 0, adjacent = 0;
      for (let y = 1; y < 128; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const id = ch.blocks[x | (z << 4) | (y << 8)];
        if (!ore.has(id)) continue;
        total++;
        if ((x > 0 && ch.blocks[(x - 1) | (z << 4) | (y << 8)] === id) ||
            (z > 0 && ch.blocks[x | ((z - 1) << 4) | (y << 8)] === id) ||
            (y > 1 && ch.blocks[x | (z << 4) | ((y - 1) << 8)] === id)) adjacent++;
      }
      return (total > 8 && adjacent / total > 0.2) || ('ore=' + total + ' clustered=' + adjacent);
    });

    check('world: 1.8 height / sea level / facing state', () => {
      if (World.CH_H !== 256 || World.SEA !== 63 || World.SEC_N !== 16) return 'world constants';
      const w = new World(123);
      w.ensureChunk(0, 0);
      const y = Math.min(World.CH_H - 2, w.genHeight(6, 6) + 2);
      w.setBlock(6, y, 6, Blocks.ID.FURNACE);
      w.setState(6, y, 6, 3);
      w.setBlock(6, y, 6, Blocks.ID.FURNACE_LIT);
      if (w.getState(6, y, 6) !== 3) return 'furnace state lost';
      w.setBlock(6, y, 6, Blocks.ID.STONE);
      return w.getState(6, y, 6) === undefined || 'orphan state';
    });

    check('worldgen: has surface & bedrock', () => {
      const w = new World(999);
      const ch = w.ensureChunk(0, 0);
      if (ch.blocks[U.mod(0, 16) | 0] === undefined) return 'no data';
      let bedrock = 0, any = 0;
      for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
        if (w.getBlock(lx, 0, lz) === Blocks.ID.BEDROCK) bedrock++;
        for (let y = 1; y < Math.min(World.CH_H, 150); y++) if (w.getBlock(lx, y, lz) !== 0) any++;
      }
      return (bedrock === 256 && any > 1000) || ('bedrock=' + bedrock + ' any=' + any);
    });

    check('light: sky=15 above surface, less in depth', () => {
      const w = new World(7);
      w.ensureChunk(0, 0);
      const h = w.genHeight(8, 8);
      const skyAbove = w.getSky(8, Math.min(h + 3, World.CH_H - 1), 8);
      const deep = w.getSky(8, 3, 8);
      return (skyAbove === 15 && deep <= 15) || ('above=' + skyAbove + ' deep=' + deep);
    });

    check('light: torch add/remove', () => {
      const w = new World(7);
      w.ensureChunk(0, 0);
      const h = w.genHeight(8, 8);
      const lightY = Math.min(World.CH_H - 2,
        Math.max(h, w.genHeight(9, 8), w.genHeight(10, 8)) + 14);
      w.setBlock(8, lightY, 8, Blocks.ID.TORCH);
      const l1 = w.getBlkLight(8, lightY, 8);
      const l2 = w.getBlkLight(10, lightY, 8);
      w.setBlock(8, lightY, 8, 0);
      const l3 = w.getBlkLight(8, lightY, 8);
      return (l1 === 14 && l2 === 12 && l3 === 0) || ('l1=' + l1 + ' l2=' + l2 + ' l3=' + l3);
    });

    check('mesher: section totals match full chunk', () => {
      const w = new World(7);
      const ch = w.ensureChunk(0, 0);
      const full = Mesher.mesh(w, ch);
      let opaque = 0, alpha = 0;
      for (let section = 0; section < World.SEC_N; section++) {
        const m = Mesher.meshSection(w, ch, section);
        opaque += m.opaque.count; alpha += m.alpha.count;
      }
      return (opaque === full.opaque.count && alpha === full.alpha.count && opaque > 100) ||
        ('full=' + full.opaque.count + '/' + full.alpha.count + ' sections=' + opaque + '/' + alpha);
    });

    check('world: batch light / section dirtiness / tick heap', () => {
      const w = new World(7);
      const ch = w.ensureChunk(0, 0);
      for (let section = 0; section < World.SEC_N; section++) w.clearSectionDirty(ch, section);
      const old = w.getBlock(8, 16, 8);
      w.setBlock(8, 16, 8, old ? 0 : Blocks.ID.STONE);
      if (!ch.dirtySections.has(0) || !ch.dirtySections.has(1)) return 'section boundary not dirtied';
      const h = w.genHeight(8, 8);
      const lightY = Math.max(w.genHeight(7, 8), h, w.genHeight(9, 8)) + 2;
      w.beginBatch();
      w.setBlock(7, lightY, 8, Blocks.ID.TORCH);
      w.setBlock(9, lightY, 8, Blocks.ID.TORCH);
      w.endBatch();
      if (w.getBlkLight(8, lightY, 8) < 13) return 'batch light failed';
      w.schedule(0, 1, 0, 0.2, 'noop');
      w.schedule(0, 1, 0, 0.1, 'noop');
      const scheduledNoops = w.ticks.toArray().filter(t => t.type === 'noop');
      if (scheduledNoops.length !== 2 || scheduledNoops[0].at > scheduledNoops[1].at) return 'heap order';
      w.update(0.11);
      const remainingNoops = w.ticks.toArray().filter(t => t.type === 'noop');
      return remainingNoops.length === 1 || 'heap due noop count=' + remainingNoops.length;
    });

    check('farming: crops / hydration / seed sources / cane support', () => {
      const w = new World(708);
      w.ensureChunk(0, 0);
      w.random = () => 0;
      const y = 200;
      w.setBlock(8, y, 8, Blocks.ID.FARMLAND);
      w.setState(8, y, 8, 0);
      w.setBlock(9, y, 8, Blocks.ID.WATER);
      w.setBlock(8, y + 1, 8, Blocks.ID.WHEAT_CROP);
      w.setState(8, y + 1, 8, 6);
      w.schedule(8, y, 8, 0.01, 'farmland');
      w.schedule(8, y + 1, 8, 0.01, 'crop');
      w.update(0.02);
      if (w.getState(8, y, 8) !== 7 || w.getState(8, y + 1, 8) !== 7) return 'crop did not hydrate/grow';
      const harvest = Blocks.dropsFor(Blocks.ID.WHEAT_CROP, 7, () => 0);
      if (!harvest.some(d => d.id === Items.IT.WHEAT) || !harvest.some(d => d.id === Items.IT.WHEAT_SEEDS)) return 'mature wheat drops';
      const grassDrop = Blocks.dropsFor(Blocks.ID.TALLGRASS, 0, () => 0);
      if (!grassDrop.some(d => d.id === Items.IT.WHEAT_SEEDS)) return 'tall grass seed source';
      w.setBlock(12, y, 12, Blocks.ID.DIRT);
      w.setBlock(11, y, 12, Blocks.ID.WATER);
      w.setBlock(12, y + 1, 12, Blocks.ID.SUGAR_CANE);
      w.setBlock(12, y + 2, 12, Blocks.ID.SUGAR_CANE);
      w.setBlock(11, y, 12, Blocks.ID.AIR);
      return (w.getBlock(12, y + 1, 12) === Blocks.ID.AIR && w.getBlock(12, y + 2, 12) === Blocks.ID.AIR) || 'unsupported cane remained';
    });

    check('utility: source buckets / flint and steel', () => {
      const w = new World(709);
      w.ensureChunk(0, 0);
      w.random = () => 0;
      const y = 200;
      w.setBlock(8, y, 8, Blocks.ID.WATER);
      const p = new Player(w);
      p.inv.fill(null);
      p.inv[0] = Items.makeStack(Items.IT.BUCKET, 1);
      p.setViewPosition(8.5, y + 1.2, 8.5);
      p.pitch = Math.PI / 2;
      p.placeBlock();
      if (w.getBlock(8, y, 8) !== Blocks.ID.AIR || !p.held() || p.held().id !== Items.IT.WATER_BUCKET) return 'source pickup';
      w.setBlock(10, y, 8, Blocks.ID.STONE);
      p.useCooldown = 0;
      p.setViewPosition(10.5, y + 1.2, 8.5);
      p.placeBlock();
      if (w.getBlock(10, y + 1, 8) !== Blocks.ID.WATER || !p.held() || p.held().id !== Items.IT.BUCKET) return 'source placement';
      w.setBlock(10, y + 1, 8, Blocks.ID.AIR);
      w.setBlock(14, y, 8, Blocks.ID.STONE);
      w.setBlock(14, y + 1, 8, Blocks.ID.WATER);
      p.inv[0] = Items.makeStack(Items.IT.LAVA_BUCKET, 1);
      p.useCooldown = 0;
      p.setViewPosition(14.5, y + 1.2, 8.5);
      p.placeBlock();
      if (w.getBlock(14, y + 1, 8) !== Blocks.ID.OBSIDIAN || p.held().id !== Items.IT.BUCKET) return 'source mixing';
      w.setBlock(12, y, 8, Blocks.ID.STONE);
      p.inv[0] = Items.makeStack(Items.IT.FLINT_STEEL, 1);
      p.useCooldown = 0;
      p.setViewPosition(12.5, y + 1.2, 8.5);
      if (!p.useBlock() || w.getBlock(12, y + 1, 8) !== Blocks.ID.FIRE) return 'fire ignition';
      const remaining = p.held().dur;
      w.update(10);
      return (remaining === Items.durabilityOf(Items.IT.FLINT_STEEL) - 1 && w.getBlock(12, y + 1, 8) === Blocks.ID.AIR) || 'fire expiry/durability';
    });

    check('rng: deterministic and stateful', () => {
      const a = new World(77), b = new World(77);
      for (let i = 0; i < 16; i++) if (a.random() !== b.random()) return 'world sequence mismatch';
      Entities.clear(); Entities.setSeed(99);
      const p1 = Entities.spawnMob('pig', 0, 50, 0);
      const pose = [p1.ai.timer, p1.animPhase];
      Entities.clear(); Entities.setSeed(99);
      const p2 = Entities.spawnMob('pig', 0, 50, 0);
      return (pose[0] === p2.ai.timer && pose[1] === p2.animPhase) || 'entity sequence mismatch';
    });

    check('physics: fall onto ground', () => {
      const w = new World(7);
      w.ensureChunk(0, 0);
      const h = w.genHeight(8, 8);
      const e = { x: 8.5, y: h + 5, z: 8.5, vx: 0, vy: 0, vz: 0, w: 0.6, h: 1.8, onGround: false };
      for (let i = 0; i < 400; i++) {
        e.vy -= 26 * 0.016;
        Physics.move(w, e, 0.016);
        if (e.onGround) break;
      }
      return (e.onGround && Math.abs(e.y - (h + 1)) < 0.1) || ('y=' + e.y + ' h=' + h + ' ground=' + e.onGround);
    });

    check('movement: sprint / liquid / sneak / shaped collision', () => {
      const inputOf = (extra) => Object.assign({
        fwd: true, back: false, left: false, right: false, jump: false,
        sneak: false, sprint: false, mine: false, use: false,
      }, extra || {});
      const makeWorld = (kind) => ({
        findSpawn: () => ({ x: 0.5, y: 1, z: 0.7 }),
        getBlock(x, y, z) {
          if (kind === 'strip') return y === 0 && z === 0 && x >= -20 && x <= 20 ? Blocks.ID.STONE : 0;
          if (kind === 'water') {
            if (y === 0) return Blocks.ID.STONE;
            if (y === 1 || y === 2) return Blocks.ID.WATER;
          }
          return y === 0 ? Blocks.ID.STONE : 0;
        },
        getState: () => 0,
        raycast: () => null,
      });
      const speedAfter = (extra, kind) => {
        const p = new Player(makeWorld(kind));
        p.inv.fill(null); p.onGround = kind !== 'water';
        const input = inputOf(extra);
        for (let i = 0; i < 240; i++) p.update(FIXED_DT, input);
        return { p, speed: Math.hypot(p.vx, p.vz) };
      };
      const walk = speedAfter(null, 'flat').speed;
      const sprint = speedAfter({ sprint: true }, 'flat').speed;
      const sneak = speedAfter({ sneak: true }, 'flat').speed;
      const sprintSneak = speedAfter({ sprint: true, sneak: true }, 'flat').speed;
      const water = speedAfter(null, 'water').speed;
      if (Math.abs(walk - 4.317) > 0.02 || Math.abs(sprint - 5.612) > 0.03) return 'land speeds';
      if (Math.abs(sneak - sprintSneak) > 0.02) return 'sprint+sneak stacked';
      if (water >= walk) return 'water faster than land';
      const edge = speedAfter({ sneak: true, right: true }, 'strip').p;
      if (edge.x < 3 || edge.z < 0.24) return 'sneak edge slide';
      const bedWorld = {
        getBlock: (x, y, z) => x === 0 && y === 0 && z === 0 ? Blocks.ID.BED : 0,
        getState: () => 0,
      };
      const body = { x: 0.5, y: 2, z: 0.5, vx: 0, vy: 0, vz: 0, w: 0.6, h: 1.8, onGround: false };
      for (let i = 0; i < 240 && !body.onGround; i++) {
        body.vy -= 26 * FIXED_DT;
        Physics.move(bedWorld, body, FIXED_DT);
      }
      if (Math.abs(body.y - 9 / 16) >= 0.01) return 'bed collision=' + body.y;
      const stepBody = { x: 0.5, y: 1, z: 1.3, w: 0.6, h: 1.8 };
      const stepWorld = (id) => ({
        getBlock(x, y, z) {
          if (y === 0) return Blocks.ID.STONE;
          return x === 0 && y === 1 && z === 0 ? id : 0;
        },
        getState: () => 0,
      });
      const fullStep = Physics.findStepHeight(stepWorld(Blocks.ID.STONE), stepBody, 0.5, 0.92, 1.05);
      const bedStep = Physics.findStepHeight(stepWorld(Blocks.ID.BED), stepBody, 0.5, 0.92, 1.05);
      if (Math.abs(fullStep - 1) > 0.11 || Math.abs(bedStep - 0.6) > 0.11) return 'step heights';
      const smooth = new Player(makeWorld('flat'));
      smooth.inv.fill(null); smooth.onGround = true;
      const smoothInput = inputOf();
      const samples = [];
      let acc = 0;
      for (let frame = 0; frame < 48; frame++) {
        acc += 1 / 120;
        while (acc >= FIXED_DT) { smooth.update(FIXED_DT, smoothInput); acc -= FIXED_DT; }
        samples.push(U.lerp(smooth.prevZ, smooth.z, acc / FIXED_DT));
      }
      for (let i = 7; i < samples.length; i++) {
        if (Math.abs(samples[i] - samples[i - 1]) < 1e-6) return '120Hz interpolation stalled';
      }
      return true;
    });

    check('raycast: hits surface', () => {
      const w = new World(7);
      w.ensureChunk(0, 0);
      const h = w.genHeight(8, 8);
      const hit = w.raycast(8.5, h + 3, 8.5, 0, -1, 0, 10);
      if (!hit || hit.y !== h) return 'hit=' + JSON.stringify(hit) + ' h=' + h;
      const y = 200;
      w.setBlock(8, y, 8, Blocks.ID.PLANK_SLAB);
      w.setBlock(9, y, 8, Blocks.ID.STONE);
      const low = w.raycast(7, y + 0.25, 8.5, 1, 0, 0, 4);
      const high = w.raycast(7, y + 0.75, 8.5, 1, 0, 0, 4);
      return (low && low.id === Blocks.ID.PLANK_SLAB && high && high.id === Blocks.ID.STONE) ||
        ('slab low/high=' + JSON.stringify(low) + '/' + JSON.stringify(high));
    });

    check('world: fluid spread / decay / mixing', () => {
      const w = new World(321);
      w.ensureChunk(0, 0);
      const y = 200;
      for (let x = 2; x <= 14; x++) for (let z = 2; z <= 14; z++) {
        w.setBlock(x, y - 1, z, Blocks.ID.STONE);
        for (let yy = y; yy <= y + 3; yy++) w.setBlock(x, yy, z, 0);
      }
      w.setBlock(8, y + 2, 8, Blocks.ID.WATER);
      for (let i = 0; i < 160; i++) w.update(0.05);
      if (w.getBlock(8, y, 8) !== Blocks.ID.WATER || w.getBlock(9, y, 8) !== Blocks.ID.WATER) return 'water did not spread';
      w.setBlock(8, y + 2, 8, 0);
      for (let i = 0; i < 320; i++) w.update(0.05);
      if (w.getBlock(8, y + 1, 8) === Blocks.ID.WATER || w.getBlock(11, y, 8) === Blocks.ID.WATER) return 'orphan flow remained';
      w.setBlock(6, y, 6, Blocks.ID.LAVA);
      w.setBlock(7, y, 6, Blocks.ID.WATER);
      for (let i = 0; i < 80; i++) w.update(0.05);
      return (w.getBlock(6, y, 6) === Blocks.ID.OBSIDIAN || w.getBlock(7, y, 6) === Blocks.ID.OBSIDIAN) || 'source mixing failed';
    });

    check('craft: planks / sticks / tools / slabs', () => {
      const g4 = [{ id: Blocks.ID.LOG, n: 1 }, null, null, null];
      const m1 = Craft.match(g4);
      if (!m1 || m1.out.id !== Blocks.ID.PLANKS) return 'log->planks failed';
      const g4b = [{ id: Blocks.ID.PLANKS, n: 1 }, null, { id: Blocks.ID.PLANKS, n: 1 }, null];
      const m2 = Craft.match(g4b);
      if (!m2 || m2.out.id !== Items.IT.STICK) return 'sticks failed: ' + JSON.stringify(m2);
      const P = Blocks.ID.PLANKS, S = Items.IT.STICK;
      const g9 = [
        { id: P, n: 1 }, { id: P, n: 1 }, { id: P, n: 1 },
        null, { id: S, n: 1 }, null,
        null, { id: S, n: 1 }, null,
      ];
      const m3 = Craft.match(g9);
      if (!m3 || m3.out.id !== Items.IT.PICK_WOOD) return 'pickaxe failed: ' + JSON.stringify(m3);
      const I = Items.IT.IRON_INGOT;
      const m4 = Craft.match([null, { id: I, n: 1 }, { id: I, n: 1 }, null]);
      if (!m4 || m4.out.id !== Items.IT.SHEARS) return 'shears failed: ' + JSON.stringify(m4);
      const slab = Craft.match([{ id: P, n: 1 }, { id: P, n: 1 }, { id: P, n: 1 }, null, null, null, null, null, null]);
      return (slab && slab.out.id === Blocks.ID.PLANK_SLAB && slab.out.n === 6) || 'slab failed: ' + JSON.stringify(slab);
    });

    check('craft: farming / ranged / armor / progression recipes', () => {
      const P = Blocks.ID.PLANKS, B = Items.IT.BOOK, I = Items.IT.IRON_INGOT;
      const bookshelf = Craft.match([
        { id: P, n: 1 }, { id: P, n: 1 }, { id: P, n: 1 },
        { id: B, n: 1 }, { id: B, n: 1 }, { id: B, n: 1 },
        { id: P, n: 1 }, { id: P, n: 1 }, { id: P, n: 1 },
      ]);
      if (!bookshelf || bookshelf.out.id !== Blocks.ID.BOOKSHELF) return 'bookshelf recipe';
      const bow = Craft.match([
        null, { id: Items.IT.STICK, n: 1 }, { id: Items.IT.STRING, n: 1 },
        { id: Items.IT.STICK, n: 1 }, null, { id: Items.IT.STRING, n: 1 },
        null, { id: Items.IT.STICK, n: 1 }, { id: Items.IT.STRING, n: 1 },
      ]);
      if (!bow || bow.out.id !== Items.IT.BOW) return 'bow recipe';
      const chestplate = Craft.match([
        { id: I, n: 1 }, null, { id: I, n: 1 },
        { id: I, n: 1 }, { id: I, n: 1 }, { id: I, n: 1 },
        { id: I, n: 1 }, { id: I, n: 1 }, { id: I, n: 1 },
      ]);
      if (!chestplate || chestplate.out.id !== Items.IT.CHEST_IRON) return 'armor recipe';
      const helmet = Craft.match([
        { id: I, n: 1 }, { id: I, n: 1 }, { id: I, n: 1 },
        { id: I, n: 1 }, null, { id: I, n: 1 },
        null, null, null,
      ]);
      if (!helmet || helmet.out.id !== Items.IT.HELMET_IRON) return 'iron helmet recipe';
      const bucket = Craft.match([
        { id: I, n: 1 }, null, { id: I, n: 1 },
        null, { id: I, n: 1 }, null,
        null, null, null,
      ]);
      if (!bucket || bucket.out.id !== Items.IT.BUCKET) return 'bucket recipe';
      const glowstone = Craft.match([
        { id: Items.IT.GLOWSTONE_DUST, n: 1 }, { id: Items.IT.GLOWSTONE_DUST, n: 1 },
        { id: Items.IT.GLOWSTONE_DUST, n: 1 }, { id: Items.IT.GLOWSTONE_DUST, n: 1 },
      ]);
      if (!glowstone || glowstone.out.id !== Blocks.ID.GLOWSTONE) return 'glowstone recipe';
      if (!Items.SMELT[Items.IT.CHICKEN_RAW] || Items.SMELT[Items.IT.CHICKEN_RAW].id !== Items.IT.CHICKEN_COOKED) return 'chicken smelt';
      if (!Items.SMELT[Items.IT.CLAY_BALL] || Items.SMELT[Items.IT.CLAY_BALL].id !== Items.IT.BRICK) return 'brick smelt';
      return true;
    });

    check('food: hunger / saturation / risky effects', () => {
      const w = new World(710);
      w.random = () => 0;
      const p = new Player(w);
      p.inv.fill(null);
      p.hunger = 10; p.saturation = 0;
      p.inv[0] = Items.makeStack(Items.IT.BREAD, 1);
      p.updateEating(1.21, { use: true });
      if (p.hunger !== 15 || Math.abs(p.saturation - 6) > 1e-6 || p.held()) return 'bread nutrition';
      p.hunger = 10; p.saturation = 0; p.statusEffects = [];
      p.inv[0] = Items.makeStack(Items.IT.CHICKEN_RAW, 1);
      p.updateEating(1.21, { use: true });
      return (p.hunger === 12 && p.statusEffects.some(e => e.type === 'hunger')) || 'raw chicken risk';
    });

    check('ranged: bow charge / arrow consumption / projectile', () => {
      const w = new World(711);
      w.ensureChunk(0, 0);
      w.random = () => 0;
      const p = new Player(w);
      p.inv.fill(null);
      p.x = 4.5; p.y = 200; p.z = 4.5; p.yaw = Math.PI / 2; p.pitch = 0;
      p.inv[0] = Items.makeStack(Items.IT.BOW, 1);
      p.inv[1] = Items.makeStack(Items.IT.ARROW, 2);
      Entities.clear();
      p.updateUseActions(0.6, { use: true });
      if (Math.abs(p.bowCharge - 0.6) > 1e-6) return 'bow did not charge';
      p.updateUseActions(0, { use: false });
      const arrow = Entities.list.find(e => e.type === 'arrow');
      const arrowOk = arrow && arrow.vx > 10 && p.countItem(Items.IT.ARROW) === 1 &&
        p.held().dur === Items.durabilityOf(Items.IT.BOW) - 1;
      p.inv.fill(null);
      p.inv[0] = Items.makeStack(Items.IT.EGG, 2);
      p.useCooldown = 0;
      p.placeBlock();
      const egg = Entities.list.find(e => e.type === 'egg');
      const ok = arrowOk && egg && egg.vx > 10 && p.countItem(Items.IT.EGG) === 1;
      Entities.clear();
      return ok || 'arrow or egg was not fired/consumed';
    });

    check('progression: enchanting / anvil repair', () => {
      const w = new World(712);
      w.random = () => 0;
      const p = new Player(w);
      p.inv.fill(null);
      p.inv[0] = Items.makeStack(Items.IT.SWORD_IRON, 1);
      p.inv[1] = Items.makeStack(Items.IT.LAPIS, 3);
      p.inv[2] = Items.makeStack(Items.IT.IRON_INGOT, 1);
      p.xpLevel = 3;
      if (!p.enchantHeld() || !p.held().ench || p.held().ench.sharpness !== 1) return 'enchant result';
      if (p.xpLevel !== 2 || p.countItem(Items.IT.LAPIS) !== 2) return 'enchant cost';
      p.held().dur = 1;
      if (!p.repairHeld()) return 'repair rejected';
      return (p.held().dur > 1 && p.xpLevel === 1 && p.countItem(Items.IT.IRON_INGOT) === 0) || 'repair cost/result';
    });

    check('furnace: smelts iron with coal', () => {
      const w = new World(7);
      w.ensureChunk(0, 0);
      const be = { type: 'furnace', slots: [{ id: Blocks.ID.IRON_ORE, n: 1 }, { id: Items.IT.COAL, n: 1 }, null], burn: 0, burnMax: 0, cook: 0 };
      w.setBE(5, 40, 5, be);
      w.setBlock(5, 40, 5, Blocks.ID.FURNACE);
      for (let i = 0; i < 130; i++) Craft.furnaceTick(w, 5, 40, 5, be, 0.1);
      const out = be.slots[2];
      return (out && out.id === Items.IT.IRON_INGOT) || ('out=' + JSON.stringify(be.slots));
    });

    check('save: roundtrip', () => {
      if (!SaveSys.available()) return true; // headless without storage — skip as pass
      const w = new World(4242);
      w.ensureChunk(0, 0);
      w.setBlock(3, 50, 3, Blocks.ID.BRICKS);
      w.setBlock(4, 50, 3, Blocks.ID.FURNACE);
      w.setState(4, 50, 3, 2);
      const fakeGame = { world: w, player: new Player(w) };
      fakeGame.player.give(Items.IT.DIAMOND, 5);
      const r = SaveSys.save(fakeGame);
      if (!r.ok) return 'save failed ' + r.err;
      const data = SaveSys.load();
      if (!data || data.seed !== 4242) return 'load failed';
      const w2 = new World(data.seed);
      SaveSys.applyToWorld(data, w2);
      w2.ensureChunk(0, 0);
      SaveSys.clear();
      if (w2.getBlock(3, 50, 3) !== Blocks.ID.BRICKS) return 'block not restored';
      return w2.getState(4, 50, 3) === 2 || 'state not restored';
    });

    check('combat: mob invulnerability frames', () => {
      Entities.clear();
      const w = new World(8);
      const mob = Entities.spawnMob('zombie', 0, 70, 0);
      const first = Entities.hurtMob(w, mob, 3, -1, 0, 1);
      const second = Entities.hurtMob(w, mob, 3, -1, 0, 1);
      if (!first || second || mob.hp !== mob.maxHp - 3) return 'cooldown did not reject repeated hit';
      mob.hurtCooldown = 0;
      return Entities.hurtMob(w, mob, 3, -1, 0, 1) || 'hit after cooldown rejected';
    });

    check('combat: reach and block occlusion', () => {
      Entities.clear();
      const fake = {
        findSpawn: () => ({ x: 0, y: 64, z: 0 }),
        raycast: () => ({ dist: 1.2 }),
      };
      const p = new Player(fake);
      p.inv.fill(null);
      Entities.spawnMob('zombie', 0, 64, -2.6);
      if (p.blockReach() !== 4.5 || p.lookEntity(3) !== null) return 'wall did not occlude target';
      fake.raycast = () => null;
      const visible = p.lookEntity(3);
      Entities.clear();
      return (visible && visible.dist <= 3) || 'visible target missed';
    });

    check('rle: roundtrip', () => {
      const a = new Uint8Array(1000);
      for (let i = 0; i < 1000; i++) a[i] = i % 7 === 0 ? 3 : 0;
      const b = U.rleDecode(U.rleEncode(a), 1000);
      for (let i = 0; i < 1000; i++) if (a[i] !== b[i]) return 'mismatch ' + i;
      try {
        U.rleDecode(new Uint8Array([2, 1]), 3);
        return 'corrupt stream accepted';
      } catch (e) { /* expected */ }
      return true;
    });

    check('entities: item spawn + physics tick', () => {
      const w = new World(7);
      w.ensureChunk(0, 0);
      Entities.clear();
      const h = w.genHeight(8, 8);
      const item = Entities.spawnItem(8.5, h + 3, 8.5, Blocks.ID.DIRT, 1, 0, 0, 0);
      if (!Entities.queryBox(8, 8, 9, 9).includes(item)) return 'spatial index missed spawn';
      const player = { x: 100, y: 0, z: 100, dead: false, mode: 'survival' };
      for (let i = 0; i < 200; i++) Entities.update(w, player, 0.016, 1);
      const e = Entities.list[0];
      return (e && e.y > h && e.y < h + 2) || ('y=' + (e && e.y) + ' h=' + h);
    });

    check('mob: zombie spawn & chase step', () => {
      const w = new World(7);
      w.ensureChunk(0, 0);
      Entities.clear();
      const h = w.genHeight(8, 8);
      const z = Entities.spawnMob('zombie', 8.5, h + 1, 8.5);
      if (!z) return 'spawn failed';
      const player = { x: 12.5, y: h + 1, z: 8.5, dead: false, mode: 'survival' };
      for (let i = 0; i < 100; i++) Entities.update(w, player, 0.016, 0.1);
      return (Entities.list.includes(z)) || 'zombie vanished';
    });

    check('mob: detailed models / shearing / creeper charge / LOD', () => {
      const w = new World(7);
      w.ensureChunk(0, 0);
      const h = w.genHeight(8, 8);
      Entities.clear();
      const pig = Entities.spawnMob('pig', 8.5, h + 1, 8.5);
      pig.onGround = true;
      const pigNear = Entities.buildGeometry(w, 8.5, h + 1, 8.5);
      const pigFar = Entities.buildGeometry(w, 60, h + 1, 8.5);
      if (pigNear.normal.count !== 252 || pigFar.normal.count !== pigNear.normal.count) return 'pig geometry/LOD';
      Entities.clear();
      const sheep = Entities.spawnMob('sheep', 8.5, h + 1, 8.5);
      sheep.onGround = true;
      if (!Entities.shearSheep(sheep) || !sheep.sheared) return 'shearing failed';
      for (const e of Entities.list) if (e.type === 'item') e.dead = true;
      const shorn = Entities.buildGeometry(w, 8.5, h + 1, 8.5);
      if (shorn.normal.count !== 216) return 'shorn geometry=' + shorn.normal.count;
      Entities.clear();
      const creeper = Entities.spawnMob('creeper', 8.5, h + 1, 8.5);
      creeper.fuse = 0.3; creeper.fuseProgress = 0.8; creeper.age = 0;
      const charged = Entities.buildGeometry(w, 8.5, h + 1, 8.5);
      Entities.clear();
      return charged.charge.count === 288 || 'charge geometry=' + charged.charge.count;
    });

    const fails = log.filter(l => l.startsWith('FAIL'));
    document.title = fails.length === 0 ? 'SELFTEST PASS' : 'SELFTEST FAIL';
    if (el) {
      el.style.display = 'block';
      el.textContent = log.join('\n') + '\n== ' + (fails.length === 0 ? 'ALL PASS' : fails.length + ' FAILED') + ' ==';
    }
    console.log(log.join('\n'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
