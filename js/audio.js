/* Sample-first WebAudio event engine with procedural fallback samples. */
'use strict';
(function () {
  let ctx = null;
  let master = null;
  let worldMaster = null;
  let worldFilter = null;
  let limiter = null;
  let convolver = null;
  let reverbInput = null;
  let reverbGain = null;
  let unlocked = false;
  let loopsStarted = false;
  let masterVol = 0.7;
  let musicVol = 1;
  let musicOn = true;
  let musicTimer = 18;
  let caveTimer = 45;
  let caveExposure = 0;
  let packName = '';
  let defaultPackRequested = false;
  let defaultPackLoading = false;
  let defaultPackReady = false;
  let defaultPackPromise = null;
  let lastPlaybackEvent = '';
  let lastPlaybackSource = '';
  let lastError = '';
  let environmentProvider = null;
  let currentEnvironment = {
    rainStrength: 0, caveStrength: 0, underwater: false, outdoors: true,
    dimension: 'overworld', timeOfDay: 0.3, screen: 'game', gameMode: 'survival',
  };

  const listener = { x: 0, y: 0, z: 0, yaw: 0 };
  const buses = Object.create(null);
  const builtinBuffers = new Map();
  const resourceBuffers = new Map();
  const lazyResourceSources = new Map();
  const pendingLazyEvents = new Set();
  const preparedLazyEvents = new Set();
  const activeVoices = new Map();
  const activeCategories = new Map();
  const lastVariant = new Map();
  const ambientLoops = Object.create(null);
  let activeMusic = null;
  let activeMusicEvent = '';
  let selectedMusicName = '';
  let musicLoading = false;
  let musicLoadToken = 0;
  const lastUiEventAt = new Map();
  const UI_PRELOAD_EVENTS = Object.freeze([
    'ui.button.click', 'ui.slider.tick', 'ui.slot',
    'container.open', 'container.close', 'container.chest.open', 'container.chest.close',
  ]);
  const GAMEPLAY_PRELOAD_EVENTS = Object.freeze([
    'block.stone.hit', 'block.stone.break', 'block.grass.hit', 'block.grass.break',
    'block.wood.hit', 'block.wood.break', 'block.sand.hit', 'block.sand.break',
    'entity.pig.ambient', 'entity.pig.step', 'entity.cow.ambient', 'entity.cow.step',
    'entity.sheep.ambient', 'entity.sheep.step', 'entity.chicken.ambient', 'entity.chicken.step',
    'entity.wolf.ambient', 'entity.wolf.step', 'entity.villager.ambient', 'entity.cat.ambient',
    'entity.zombie.ambient', 'entity.skeleton.ambient', 'entity.spider.ambient',
  ]);
  const FIXED_MENU_EVENTS = new Set(['ui.button.click', 'ui.slider.tick', 'ui.slot']);
  const UI_EVENT_COOLDOWNS = Object.freeze({
    'ui.button.click': 0.035,
    'ui.slider.tick': 0.075,
  });

  const CATEGORY_LEVELS = Object.freeze({
    ui: 0.72,
    player: 0.88,
    blocks: 0.82,
    passive: 0.78,
    hostile: 0.88,
    weather: 0.58,
    ambient: 0.52,
    music: 0.38,
  });
  const CATEGORY_LIMITS = Object.freeze({
    ui: 8, player: 12, blocks: 18, passive: 10,
    hostile: 12, weather: 5, ambient: 5, music: 2,
  });

  const MATERIALS = Object.freeze({
    stone: { low: 0.20, high: 0.95, tone: 185, toneMix: 0.16, cutoff: 0.19, grain: 0.018 },
    grass: { low: 0.88, high: 0.08, tone: 92, toneMix: 0.03, cutoff: 0.055, grain: 0.010 },
    foliage: { low: 0.52, high: 0.36, tone: 120, toneMix: 0.02, cutoff: 0.11, grain: 0.030 },
    wood: { low: 0.62, high: 0.24, tone: 176, toneMix: 0.24, cutoff: 0.10, grain: 0.014 },
    sand: { low: 0.25, high: 0.68, tone: 105, toneMix: 0.02, cutoff: 0.055, grain: 0.050 },
    gravel: { low: 0.35, high: 0.72, tone: 130, toneMix: 0.04, cutoff: 0.09, grain: 0.095 },
    glass: { low: 0.04, high: 0.42, tone: 1640, toneMix: 0.55, cutoff: 0.28, grain: 0.026 },
    snow: { low: 0.72, high: 0.18, tone: 150, toneMix: 0.02, cutoff: 0.045, grain: 0.028 },
    wool: { low: 0.92, high: 0.025, tone: 86, toneMix: 0.02, cutoff: 0.032, grain: 0.006 },
    metal: { low: 0.08, high: 0.46, tone: 520, toneMix: 0.62, cutoff: 0.23, grain: 0.022 },
    ladder: { low: 0.48, high: 0.30, tone: 240, toneMix: 0.25, cutoff: 0.12, grain: 0.020 },
    soul_sand: { low: 0.94, high: 0.05, tone: 62, toneMix: 0.16, cutoff: 0.04, grain: 0.030 },
    nether: { low: 0.67, high: 0.38, tone: 118, toneMix: 0.15, cutoff: 0.11, grain: 0.048 },
  });

  const MOB_VOICES = Object.freeze({
    generic: [210, 0.30, 0.22], pig: [360, 0.18, 0.12], cow: [112, 0.40, 0.16],
    sheep: [410, 0.22, 0.12], chicken: [820, 0.16, 0.08], zombie: [105, 0.52, 0.24],
    skeleton: [540, 0.58, 0.34], spider: [260, 0.68, 0.30], creeper: [175, 0.34, 0.28],
    slime: [220, 0.24, 0.10], enderman: [72, 0.70, 0.35], wolf: [310, 0.36, 0.16],
    villager: [190, 0.28, 0.15], cat: [470, 0.18, 0.10], iron_golem: [74, 0.30, 0.22],
    squid: [155, 0.42, 0.18], bat: [1150, 0.22, 0.12], blaze: [145, 0.72, 0.36],
    ender_dragon: [48, 0.80, 0.42],
  });
  const HOSTILE = new Set(['zombie', 'skeleton', 'spider', 'creeper', 'slime', 'enderman', 'blaze', 'ender_dragon']);

  function spec(kind, category, duration, variants, maxVoices, distance, volume, pitchMin, pitchMax) {
    return { kind, category, duration, variants, maxVoices, distance, volume, pitchMin, pitchMax };
  }

  const EVENTS = Object.freeze({
    'ui.button.click': spec('ui_button', 'ui', 0.075, 1, 3, 0, 0.68, 1, 1),
    'ui.slider.tick': spec('ui_slider', 'ui', 0.045, 1, 3, 0, 0.34, 1, 1),
    'ui.click': spec('click', 'ui', 0.055, 4, 5, 0, 0.58, 0.96, 1.05),
    'ui.slot': spec('click_soft', 'ui', 0.045, 1, 8, 0, 0.38, 1, 1),
    'container.open': spec('container_open', 'ui', 0.20, 3, 3, 0, 0.65, 0.96, 1.04),
    'container.close': spec('container_close', 'ui', 0.18, 3, 3, 0, 0.62, 0.96, 1.04),
    'container.chest.open': spec('container_open', 'blocks', 0.20, 1, 3, 24, 0.72, 1, 1),
    'container.chest.close': spec('container_close', 'blocks', 0.18, 1, 3, 24, 0.70, 1, 1),
    'player.jump': spec('jump', 'player', 0.12, 4, 3, 10, 0.30, 0.96, 1.05),
    'player.land': spec('land', 'player', 0.15, 5, 4, 14, 0.46, 0.94, 1.05),
    'player.land_heavy': spec('land_heavy', 'player', 0.32, 4, 3, 18, 0.78, 0.90, 1.02),
    'player.hurt': spec('hurt', 'player', 0.22, 4, 3, 0, 0.82, 0.96, 1.05),
    'player.death': spec('death', 'player', 0.72, 3, 2, 0, 0.92, 0.94, 1.02),
    'player.eat_bite': spec('eat', 'player', 0.09, 5, 4, 0, 0.58, 0.93, 1.08),
    'player.eat_finish': spec('eat_finish', 'player', 0.18, 3, 2, 0, 0.72, 0.94, 1.04),
    'player.swim': spec('swim', 'player', 0.28, 5, 5, 15, 0.48, 0.92, 1.08),
    'water.splash': spec('splash', 'player', 0.48, 5, 4, 24, 0.78, 0.90, 1.08),
    'item.pickup': spec('pickup', 'player', 0.10, 5, 7, 0, 0.62, 0.95, 1.10),
    'experience.pickup': spec('xp', 'player', 0.12, 6, 8, 0, 0.66, 0.95, 1.12),
    'item.break': spec('item_break', 'player', 0.26, 4, 2, 0, 0.80, 0.94, 1.06),
    'item.equip': spec('equip', 'player', 0.11, 4, 3, 0, 0.36, 0.96, 1.05),
    'item.throw': spec('throw', 'player', 0.13, 5, 5, 18, 0.45, 0.94, 1.08),
    'egg.throw': spec('throw', 'player', 0.14, 5, 5, 18, 0.48, 1.04, 1.15),
    'egg.break': spec('egg_break', 'blocks', 0.13, 5, 5, 20, 0.52, 0.94, 1.10),
    'ender_pearl.throw': spec('throw', 'player', 0.16, 5, 5, 22, 0.52, 0.88, 0.98),
    'ender_pearl.land': spec('teleport', 'player', 0.30, 5, 4, 28, 0.68, 0.90, 1.04),
    'bow.draw': spec('bow_draw', 'player', 0.34, 4, 2, 0, 0.42, 0.96, 1.04),
    'bow.release': spec('bow_release', 'player', 0.18, 5, 4, 22, 0.70, 0.94, 1.06),
    'fishing.cast': spec('throw', 'player', 0.17, 4, 3, 20, 0.44, 0.90, 1.02),
    'fishing.catch': spec('splash', 'player', 0.24, 4, 3, 20, 0.58, 1.04, 1.14),
    'combat.swing': spec('swing', 'player', 0.12, 5, 6, 12, 0.34, 0.93, 1.10),
    'combat.block': spec('shield', 'player', 0.13, 4, 4, 20, 0.74, 0.94, 1.05),
    'combat.critical': spec('critical', 'player', 0.17, 5, 4, 22, 0.76, 0.96, 1.08),
    'door.wood.open': spec('door_open', 'blocks', 0.25, 4, 4, 24, 0.72, 0.94, 1.05),
    'door.wood.close': spec('door_close', 'blocks', 0.23, 4, 4, 24, 0.70, 0.94, 1.05),
    'door.iron.open': spec('metal_open', 'blocks', 0.22, 3, 4, 28, 0.78, 0.96, 1.04),
    'door.iron.close': spec('metal_close', 'blocks', 0.22, 3, 4, 28, 0.78, 0.96, 1.04),
    'mechanism.click_on': spec('mechanism_on', 'blocks', 0.10, 3, 5, 22, 0.58, 0.97, 1.04),
    'mechanism.click_off': spec('mechanism_off', 'blocks', 0.10, 3, 5, 22, 0.56, 0.97, 1.04),
    'trade.complete': spec('trade', 'passive', 0.30, 4, 3, 20, 0.62, 0.95, 1.06),
    'fluid.solidify': spec('solidify', 'blocks', 0.42, 4, 3, 25, 0.75, 0.92, 1.04),
    'fire.ambient': spec('fire', 'ambient', 0.72, 6, 3, 18, 0.42, 0.94, 1.08),
    'tnt.fuse': spec('fuse', 'hostile', 1.48, 4, 3, 28, 0.72, 0.97, 1.04),
    'explosion': spec('explosion', 'hostile', 1.35, 5, 4, 64, 1.00, 0.90, 1.03),
    'ambient.cave': spec('cave', 'ambient', 4.0, 5, 1, 0, 0.60, 0.88, 1.04),
  });

  const ALIASES = Object.freeze({
    click: 'ui.click', open: 'container.open', close: 'container.close',
    hurt: 'player.hurt', death: 'player.death', eat: 'player.eat_bite',
    pop: 'item.pickup', block: 'combat.block', critical: 'combat.critical',
    splash: 'water.splash', explode: 'explosion', fuse: 'tnt.fuse', cave: 'ambient.cave',
    mob_hurt: 'entity.generic.hurt', zombie: 'entity.zombie.ambient', pig: 'entity.pig.ambient',
    cow: 'entity.cow.ambient', sheep: 'entity.sheep.ambient',
    dig_grass: 'block.grass.hit', dig_stone: 'block.stone.hit', dig_wood: 'block.wood.hit',
    dig_sand: 'block.sand.hit', dig_snow: 'block.snow.hit', dig_glass: 'block.glass.hit',
    step_grass: 'block.grass.step', step_stone: 'block.stone.step', step_wood: 'block.wood.step',
    step_sand: 'block.sand.step', rain: 'ambient.rain',
  });

  function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
  function hash32(value) {
    const text = String(value);
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seeded(seed) {
    let state = seed >>> 0;
    return function () {
      state += 0x6D2B79F5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function canonical(name) { return ALIASES[name] || String(name || 'ui.click'); }

  function eventSpec(rawName) {
    const name = canonical(rawName);
    if (EVENTS[name]) return Object.assign({ name }, EVENTS[name]);
    let match = /^block\.([a-z_]+)\.(step|hit|break|place|fall)$/.exec(name);
    if (match) {
      const action = match[2];
      const durations = { step: 0.10, hit: 0.12, break: 0.28, place: 0.16, fall: 0.24 };
      const volumes = { step: 0.42, hit: 0.48, break: 0.82, place: 0.62, fall: 0.72 };
      return {
        name, kind: 'material', material: MATERIALS[match[1]] ? match[1] : 'stone', action,
        category: 'blocks', duration: durations[action], variants: 6, maxVoices: action === 'hit' ? 8 : 5,
        distance: action === 'step' ? 18 : 28, volume: volumes[action], pitchMin: 0.92, pitchMax: 1.08,
      };
    }
    match = /^entity\.([a-z_]+)\.(ambient|hurt|death|attack|step|special)$/.exec(name);
    if (match) {
      const mob = MOB_VOICES[match[1]] ? match[1] : 'generic';
      const action = match[2];
      const durations = { ambient: 0.72, hurt: 0.28, death: 0.70, attack: 0.34, step: 0.13, special: 0.58 };
      return {
        name, kind: 'entity', mob, action, category: HOSTILE.has(mob) ? 'hostile' : 'passive',
        duration: mob === 'ender_dragon' ? durations[action] * 1.8 : durations[action],
        variants: 5, maxVoices: action === 'ambient' ? 2 : 4, distance: mob === 'ender_dragon' ? 64 : 30,
        volume: action === 'ambient' ? 0.68 : action === 'death' ? 0.86 : 0.78,
        pitchMin: 0.93, pitchMax: 1.07,
      };
    }
    match = /^music\.(menu|overworld|creative|nether|end)$/.exec(name);
    if (match) return { name, kind: 'music', dimension: match[1], category: 'music', duration: 18, variants: 3, maxVoices: 1, distance: 0, volume: 1, pitchMin: 1, pitchMax: 1 };
    match = /^ambient\.(rain|nether|end)$/.exec(name);
    if (match) return { name, kind: 'ambient_loop', ambience: match[1], category: match[1] === 'rain' ? 'weather' : 'ambient', duration: 4, variants: 2, maxVoices: 1, distance: 0, volume: 1, pitchMin: 1, pitchMax: 1 };
    return { name, kind: 'click_soft', category: 'ui', duration: 0.08, variants: 3, maxVoices: 4, distance: 0, volume: 0.4, pitchMin: 0.96, pitchMax: 1.05 };
  }

  function makeImpulseResponse() {
    const rate = ctx.sampleRate || 44100;
    const length = Math.floor(rate * 1.7);
    const buffer = ctx.createBuffer(2, length, rate);
    const random = seeded(0xC4A93E21);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let low = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        low += ((random() * 2 - 1) - low) * 0.12;
        data[i] = low * Math.pow(1 - t, 2.8) * (channel ? 0.82 : 0.9);
      }
    }
    return buffer;
  }

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC({ latencyHint: 'interactive' }); }
      catch (error) { ctx = new AC(); }
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -5;
      limiter.knee.value = 8;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.18;
      master = ctx.createGain();
      master.gain.value = masterVol;
      master.connect(limiter);
      limiter.connect(ctx.destination);

      worldMaster = ctx.createGain();
      worldFilter = ctx.createBiquadFilter();
      worldFilter.type = 'lowpass';
      worldFilter.frequency.value = 20000;
      worldMaster.connect(worldFilter);
      worldFilter.connect(master);

      try {
        reverbInput = ctx.createGain();
        reverbInput.gain.value = 0.32;
        convolver = ctx.createConvolver();
        convolver.buffer = makeImpulseResponse();
        reverbGain = ctx.createGain();
        reverbGain.gain.value = 0;
        reverbInput.connect(convolver);
        convolver.connect(reverbGain);
        reverbGain.connect(worldMaster);
      } catch (error) {
        reverbInput = null;
        convolver = null;
        reverbGain = null;
      }

      for (const category of Object.keys(CATEGORY_LEVELS)) {
        const gain = ctx.createGain();
        gain.gain.value = category === 'music' ? CATEGORY_LEVELS.music * musicVol : CATEGORY_LEVELS[category];
        if (category === 'ui' || category === 'music') gain.connect(master);
        else {
          gain.connect(worldMaster);
          if (category !== 'weather' && reverbInput) gain.connect(reverbInput);
        }
        buses[category] = gain;
      }
      lastError = '';
    } catch (error) {
      lastError = String(error && error.message || error || 'AudioContext initialization failed');
      ctx = null;
    }
    return ctx;
  }

  function resumeContext(audioContext) {
    if (!audioContext || audioContext.state === 'running' || typeof audioContext.resume !== 'function') return;
    try {
      const resumed = audioContext.resume();
      if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {});
    } catch (error) {
      lastError = String(error && error.message || error || 'AudioContext resume failed');
    }
  }

  function envelope(time, duration, attack, releasePower) {
    const a = Math.min(1, time / Math.max(0.001, attack));
    const r = Math.pow(Math.max(0, 1 - time / duration), releasePower || 1.8);
    return a * r;
  }

  function renderMaterial(data, rate, event, random) {
    const material = MATERIALS[event.material] || MATERIALS.stone;
    const action = event.action;
    const actionScale = { step: 0.58, hit: 0.72, break: 1, place: 0.82, fall: 0.92 }[action] || 0.8;
    const duration = data.length / rate;
    let low = 0, phase = random() * Math.PI * 2, impulse = 0;
    const tone = material.tone * (0.92 + random() * 0.18) * (action === 'place' ? 0.82 : action === 'break' ? 0.94 : 1);
    const grainChance = material.grain * (action === 'break' ? 2.4 : action === 'fall' ? 1.7 : 1);
    for (let i = 0; i < data.length; i++) {
      const t = i / rate;
      const noise = random() * 2 - 1;
      low += (noise - low) * material.cutoff;
      const high = noise - low;
      if (random() < grainChance) impulse = (random() * 2 - 1) * (action === 'break' ? 1 : 0.7);
      impulse *= event.material === 'glass' ? 0.995 : 0.94;
      phase += Math.PI * 2 * tone / rate;
      let body = low * material.low + high * material.high + Math.sin(phase) * material.toneMix + impulse * 0.42;
      if (material === MATERIALS.glass) body += Math.sin(phase * 1.51) * material.toneMix * 0.5;
      const pulse = action === 'break' ? (0.72 + 0.28 * Math.sin(t * 83)) : 1;
      data[i] = body * envelope(t, duration, 0.002, action === 'break' ? 1.25 : 2.1) * actionScale * pulse;
    }
  }

  function renderEntity(data, rate, event, random) {
    const voice = MOB_VOICES[event.mob] || MOB_VOICES.generic;
    const action = event.action;
    const duration = data.length / rate;
    const actionPitch = { ambient: 1, hurt: 1.22, death: 0.78, attack: 1.08, step: 1.45, special: 0.9 }[action] || 1;
    const base = voice[0] * actionPitch * (0.92 + random() * 0.16);
    const rough = voice[1], noiseMix = voice[2];
    let phase = random() * Math.PI * 2, low = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate, progress = t / duration;
      const sweep = action === 'death' ? 1 - progress * 0.68 : action === 'hurt' ? 1 + progress * 0.25 : 1 + Math.sin(t * 12) * 0.035;
      phase += Math.PI * 2 * Math.max(22, base * sweep) / rate;
      const noise = random() * 2 - 1;
      low += (noise - low) * 0.15;
      const square = Math.sin(phase) >= 0 ? 1 : -1;
      let body = Math.sin(phase) * (1 - rough) + square * rough * 0.62 + low * noiseMix;
      if (event.mob === 'skeleton') body = (noise - low) * 0.8 + Math.sin(phase * 2.1) * 0.25;
      if (event.mob === 'spider') body = (noise - low) * 0.72 * (0.5 + 0.5 * Math.sin(t * 55));
      if (event.mob === 'creeper' && action === 'ambient') body *= 0.35;
      if (event.mob === 'slime') body = Math.sin(phase) * 0.35 + low * 0.7;
      data[i] = body * envelope(t, duration, 0.008, action === 'death' ? 1.2 : 2.0) * 0.74;
    }
  }

  function renderEffect(data, rate, event, random) {
    const duration = data.length / rate;
    let low = 0, phase = random() * Math.PI * 2, impulse = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate, progress = t / duration;
      const noise = random() * 2 - 1;
      low += (noise - low) * 0.10;
      const high = noise - low;
      let value = 0;
      switch (event.kind) {
        case 'ui_button':
          phase += Math.PI * 2 * (610 - progress * 235) / rate;
          impulse = i < Math.max(2, rate * 0.004) ? (1 - i / Math.max(2, rate * 0.004)) : 0;
          value = Math.sin(phase) * 0.62 + high * 0.14 + impulse * 0.32;
          break;
        case 'ui_slider':
          phase += Math.PI * 2 * (790 - progress * 170) / rate;
          value = Math.sin(phase) * 0.56 + high * 0.12;
          break;
        case 'ui_back':
          phase += Math.PI * 2 * (465 - progress * 190) / rate;
          value = Math.sin(phase) * 0.58 + low * 0.18 + high * 0.1;
          break;
        case 'click': case 'click_soft':
          phase += Math.PI * 2 * (event.kind === 'click' ? 860 - progress * 310 : 520 - progress * 180) / rate;
          value = Math.sin(phase) * 0.7 + high * 0.18;
          break;
        case 'container_open': case 'container_close':
          phase += Math.PI * 2 * ((event.kind === 'container_open' ? 180 + progress * 160 : 330 - progress * 190)) / rate;
          value = low * 0.48 + Math.sin(phase) * 0.45 + high * 0.12;
          break;
        case 'jump': value = low * 0.55 + high * 0.12; break;
        case 'land': case 'land_heavy': value = low * (event.kind === 'land_heavy' ? 1 : 0.72) + high * 0.16; break;
        case 'hurt': case 'death':
          phase += Math.PI * 2 * (event.kind === 'death' ? 300 - progress * 245 : 310 - progress * 150) / rate;
          value = Math.sin(phase) * 0.62 + (Math.sin(phase) > 0 ? 1 : -1) * 0.18 + low * 0.22;
          break;
        case 'eat': case 'eat_finish':
          value = (i % Math.max(1, Math.floor(rate * 0.028)) < rate * 0.012 ? high * 0.85 + low * 0.45 : 0);
          break;
        case 'pickup': case 'xp':
          phase += Math.PI * 2 * ((event.kind === 'xp' ? 520 : 360) + progress * (event.kind === 'xp' ? 980 : 620)) / rate;
          value = Math.sin(phase) * 0.72 + high * 0.08;
          break;
        case 'item_break':
          if (random() < 0.025) impulse = random() * 2 - 1;
          impulse *= 0.91; value = impulse + high * 0.38;
          break;
        case 'equip': case 'throw': case 'swing': value = high * (0.25 + 0.65 * Math.sin(progress * Math.PI)) + low * 0.2; break;
        case 'teleport':
          phase += Math.PI * 2 * (760 - progress * 520) / rate;
          value = Math.sin(phase) * 0.42 + high * 0.52 * (1 - progress) + low * 0.18;
          break;
        case 'egg_break': value = high * 0.55 + low * 0.28 + Math.sin(t * 1800) * 0.08; break;
        case 'bow_draw': value = high * 0.28 + Math.sin(t * (320 + progress * 250)) * 0.18 * progress; break;
        case 'bow_release': value = high * 0.64 + Math.sin(t * 900) * 0.28; break;
        case 'swim': case 'splash': value = low * 0.78 + high * (0.15 + (1 - progress) * 0.3); break;
        case 'shield': case 'mechanism_on': case 'mechanism_off': case 'metal_open': case 'metal_close':
          phase += Math.PI * 2 * ((event.kind === 'mechanism_off' ? 310 : 470) - progress * 170) / rate;
          value = Math.sin(phase) * 0.58 + high * 0.34;
          break;
        case 'door_open': case 'door_close': value = low * 0.58 + high * 0.22 + Math.sin(t * (event.kind === 'door_open' ? 150 : 110)) * 0.25; break;
        case 'critical': value = high * 0.72 + Math.sin(t * (650 + progress * 850)) * 0.34; break;
        case 'trade': value = low * 0.20 + Math.sin(t * (380 + progress * 620)) * 0.52; break;
        case 'solidify': value = low * 0.72 + high * 0.25 + Math.sin(t * 95) * 0.24; break;
        case 'fire': value = high * 0.62 + (random() < 0.006 ? 0.9 : 0); break;
        case 'fuse': value = high * (0.55 + progress * 0.35); break;
        case 'explosion':
          phase += Math.PI * 2 * (72 - progress * 42) / rate;
          value = low * 1.05 + high * 0.30 * (1 - progress) + Math.sin(phase) * 0.55;
          break;
        case 'cave':
          phase += Math.PI * 2 * (58 - progress * 24) / rate;
          value = Math.sin(phase) * 0.48 + Math.sin(phase * 1.83) * 0.22 + low * 0.18;
          break;
        default: value = low * 0.45 + high * 0.22;
      }
      data[i] = value * envelope(t, duration, event.kind === 'cave' ? 0.55 : 0.002, event.kind === 'cave' ? 1.15 : 1.8);
    }
  }

  function renderAmbient(data, rate, event, random) {
    let low = 0, slow = 0, phase = random() * Math.PI * 2;
    for (let i = 0; i < data.length; i++) {
      const noise = random() * 2 - 1;
      low += (noise - low) * 0.12;
      slow += (noise - slow) * 0.002;
      const high = noise - low;
      let value;
      if (event.ambience === 'rain') value = high * 0.42 + low * 0.13;
      else if (event.ambience === 'nether') {
        phase += Math.PI * 2 * 42 / rate;
        value = slow * 0.52 + Math.sin(phase) * 0.15 + (random() < 0.0008 ? high * 0.8 : 0);
      } else {
        phase += Math.PI * 2 * 78 / rate;
        value = slow * 0.32 + Math.sin(phase) * 0.12 + high * 0.035;
      }
      data[i] = value * 0.75;
    }
    const blend = Math.min(1024, Math.floor(data.length / 5));
    for (let i = 0; i < blend; i++) {
      const mix = i / blend;
      const start = data[i], endIndex = data.length - blend + i, end = data[endIndex];
      const joined = start * mix + end * (1 - mix);
      data[i] = joined; data[endIndex] = joined;
    }
  }

  function renderMusic(data, rate, event, random) {
    const roots = { overworld: 110, nether: 55, end: 82.41 };
    const scales = {
      overworld: [1, 1.125, 1.25, 1.5, 1.667, 2],
      nether: [1, 1.067, 1.2, 1.333, 1.6, 2],
      end: [1, 1.189, 1.414, 1.587, 1.888, 2.378],
    };
    const root = roots[event.dimension] || roots.overworld;
    const scale = scales[event.dimension] || scales.overworld;
    const duration = data.length / rate;
    for (let note = 0; note < 7; note++) {
      const start = 0.6 + note * 2.15 + random() * 0.75;
      const noteDuration = 3.2 + random() * 2.8;
      const frequency = root * scale[Math.floor(random() * scale.length)] * (random() < 0.28 ? 2 : 1);
      const from = Math.floor(start * rate), to = Math.min(data.length, Math.floor((start + noteDuration) * rate));
      let phase = random() * Math.PI * 2;
      for (let i = from; i < to; i++) {
        const local = (i - from) / rate;
        const env = Math.sin(Math.PI * Math.min(1, local / noteDuration)) * Math.min(1, local / 0.8);
        phase += Math.PI * 2 * frequency / rate;
        data[i] += (Math.sin(phase) * 0.13 + Math.sin(phase * 0.5) * 0.055) * env;
      }
    }
    const fade = Math.floor(Math.min(2, duration / 4) * rate);
    for (let i = 0; i < fade; i++) {
      const gain = i / fade;
      data[i] *= gain;
      data[data.length - 1 - i] *= gain;
    }
  }

  function normalize(data, ceiling) {
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    if (peak < 1e-5) return;
    const gain = Math.min(1, (ceiling || 0.88) / peak);
    for (let i = 0; i < data.length; i++) data[i] *= gain;
  }

  function builtinBuffer(name, variant) {
    const event = eventSpec(name);
    const key = event.name + '|' + variant;
    if (builtinBuffers.has(key)) return builtinBuffers.get(key);
    if (!ctx) return null;
    const rate = event.kind === 'music' || event.kind === 'ambient_loop' ? Math.min(32000, ctx.sampleRate) : Math.min(24000, ctx.sampleRate);
    const duration = Math.max(0.035, event.duration * (0.94 + (variant % 5) * 0.025));
    const buffer = ctx.createBuffer(1, Math.max(32, Math.floor(duration * rate)), rate);
    const data = buffer.getChannelData(0);
    const random = seeded(hash32(event.name + ':' + variant));
    if (event.kind === 'material') renderMaterial(data, rate, event, random);
    else if (event.kind === 'entity') renderEntity(data, rate, event, random);
    else if (event.kind === 'ambient_loop') renderAmbient(data, rate, event, random);
    else if (event.kind === 'music') renderMusic(data, rate, event, random);
    else renderEffect(data, rate, event, random);
    normalize(data, event.kind === 'music' ? 0.62 : 0.9);
    builtinBuffers.set(key, buffer);
    return buffer;
  }

  function preload(names) {
    if (!ctx) return 0;
    let loaded = 0;
    for (const rawName of names || []) {
      const event = eventSpec(rawName);
      if (resourceBuffers.has(event.name)) continue;
      for (let variant = 0; variant < event.variants; variant++) {
        if (builtinBuffer(event.name, variant)) loaded++;
      }
    }
    return loaded;
  }

  function chooseVariant(event, seed) {
    const external = resourceBuffers.get(event.name);
    const lazy = lazyResourceSources.get(event.name);
    if (lazy && lazy.length) {
      const ready = [];
      for (let index = 0; index < lazy.length; index++) if (lazy[index].buffer) ready.push(index);
      if (ready.length) {
        let choice = Number.isFinite(seed)
          ? hash32(event.name + ':' + seed) % ready.length
          : Math.floor(Math.random() * ready.length);
        const previous = lastVariant.get(event.name);
        if (ready.length > 1 && ready[choice] === previous) choice = (choice + 1) % ready.length;
        lastVariant.set(event.name, ready[choice]);
        return ready[choice];
      }
    }
    const externalCount = external && external.length ? external.length : lazy && lazy.length ? lazy.length : 0;
    const count = FIXED_MENU_EVENTS.has(event.name) ? 1 : (externalCount || event.variants);
    if (count <= 1) return 0;
    let index = Number.isFinite(seed) ? hash32(event.name + ':' + seed) % count : Math.floor(Math.random() * count);
    const previous = lastVariant.get(event.name);
    if (index === previous) index = (index + 1 + Math.floor(Math.random() * (count - 1))) % count;
    lastVariant.set(event.name, index);
    return index;
  }

  function pruneVoice(eventName, category, record) {
    const list = activeVoices.get(eventName);
    if (list) {
      const index = list.indexOf(record);
      if (index >= 0) list.splice(index, 1);
      if (!list.length) activeVoices.delete(eventName);
    }
    const categoryList = activeCategories.get(category);
    if (categoryList) {
      const index = categoryList.indexOf(record);
      if (index >= 0) categoryList.splice(index, 1);
      if (!categoryList.length) activeCategories.delete(category);
    }
  }

  function reserveVoice(event) {
    const eventList = activeVoices.get(event.name) || [];
    const categoryList = activeCategories.get(event.category) || [];
    const stopOldest = (list) => {
      const old = list[0];
      if (old && old.source) { try { old.source.stop(); } catch (error) { /* already stopped */ } }
    };
    if (eventList.length >= event.maxVoices) stopOldest(eventList);
    if (categoryList.length >= (CATEGORY_LIMITS[event.category] || 8)) stopOldest(categoryList);
    const record = { source: null, at: ctx.currentTime };
    eventList.push(record); categoryList.push(record);
    activeVoices.set(event.name, eventList); activeCategories.set(event.category, categoryList);
    return record;
  }

  function spatialEnvironment(x, y, z) {
    let occlusion = 0;
    if (environmentProvider) {
      try {
        const result = environmentProvider(x, y, z, listener.x, listener.y, listener.z);
        occlusion = typeof result === 'number' ? result : result && Number(result.occlusion);
      } catch (error) { occlusion = 0; }
    }
    return { occlusion: clamp(occlusion, 0, 1) };
  }

  function playEventBuffer(event, options, variant, buffer, spatial, sourceKind) {
    if (!buffer || !ctx) return false;
    lastPlaybackEvent = event.name;
    lastPlaybackSource = sourceKind || 'builtin';
    const record = reserveVoice(event);
    const source = ctx.createBufferSource();
    record.source = source;
    source.buffer = buffer;
    const pitchRandom = event.pitchMin + Math.random() * (event.pitchMax - event.pitchMin);
    source.playbackRate.value = FIXED_MENU_EVENTS.has(event.name)
      ? 1
      : clamp(options.pitch === undefined ? 1 : options.pitch, 0.25, 4) * pitchRandom;
    const gain = ctx.createGain();
    gain.gain.value = clamp(options.volume === undefined ? 1 : options.volume, 0, 4) * event.volume;
    let tail = gain;
    source.connect(gain);

    if (spatial) {
      const environment = spatialEnvironment(options.x, options.y, options.z);
      if (environment.occlusion > 0.01) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 18000 - environment.occlusion * 16700;
        filter.Q.value = 0.4;
        gain.gain.value *= 1 - environment.occlusion * 0.52;
        tail.connect(filter); tail = filter;
      }
      if (ctx.createPanner) {
        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1.6;
        panner.maxDistance = Math.max(4, event.distance || 24);
        panner.rolloffFactor = event.category === 'hostile' ? 0.8 : 1;
        if (panner.positionX) {
          panner.positionX.value = options.x; panner.positionY.value = options.y; panner.positionZ.value = options.z;
        } else panner.setPosition(options.x, options.y, options.z);
        tail.connect(panner); tail = panner;
      }
    }
    tail.connect(buses[event.category] || buses.ui || master);
    source.onended = () => pruneVoice(event.name, event.category, record);
    source.start(ctx.currentTime + 0.003);
    return { name: event.name, variant, category: event.category, source };
  }

  function emit(rawName, options) {
    options = options || {};
    if (!unlocked) return false;
    const audioContext = ensure();
    if (!audioContext) return false;
    resumeContext(audioContext);
    const event = eventSpec(rawName);
    const cooldown = UI_EVENT_COOLDOWNS[event.name] || 0;
    if (cooldown > 0 && !options._deferred) {
      const previous = lastUiEventAt.get(event.name);
      if (previous !== undefined && audioContext.currentTime - previous < cooldown) return false;
      lastUiEventAt.set(event.name, audioContext.currentTime);
    }
    const spatial = event.category !== 'ui' && options.spatial !== false &&
      Number.isFinite(options.x) && Number.isFinite(options.y) && Number.isFinite(options.z);
    if (spatial) {
      const distance = Math.hypot(options.x - listener.x, options.y - listener.y, options.z - listener.z);
      if (distance > event.distance && event.distance > 0) return false;
    }
    const variant = chooseVariant(event, options.seed);
    const external = resourceBuffers.get(event.name);
    const buffer = external && external[variant] ? external[variant] : null;
    if (buffer) return playEventBuffer(event, options, variant, buffer, spatial, 'resource');
    const lazySources = lazyResourceSources.get(event.name);
    const preparedBuffer = lazySources && lazySources[variant] && lazySources[variant].buffer;
    if (preparedBuffer) return playEventBuffer(event, options, variant, preparedBuffer, spatial, 'resource');
    if (lazySources) {
      if (pendingLazyEvents.has(event.name)) return false;
      pendingLazyEvents.add(event.name);
      const deferredOptions = Object.assign({}, options);
      lazyResourceBuffer(event.name, variant).then((decoded) => {
        if (decoded && unlocked) playEventBuffer(event, deferredOptions, variant, decoded, spatial, 'resource');
      }).catch((error) => {
        lastError = String(error && error.message || error || 'Sound asset load failed');
      }).finally(() => pendingLazyEvents.delete(event.name));
      return { name: event.name, variant, category: event.category, pending: true };
    }
    // The generated buffers are a responsive fallback while the bundled pack
    // loads. Once decoding finishes, later events automatically use the pack.
    return playEventBuffer(event, options, variant, builtinBuffer(event.name, variant), spatial, 'builtin');
  }

  function startAmbientLoops() {
    if (loopsStarted || !ctx) return;
    loopsStarted = true;
    for (const name of ['ambient.rain', 'ambient.nether', 'ambient.end']) {
      const event = eventSpec(name);
      const source = ctx.createBufferSource();
      source.buffer = builtinBuffer(name, 0);
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(buses[event.category]);
      source.start();
      ambientLoops[name] = { source, gain };
    }
  }

  function setTarget(param, value, seconds) {
    if (!ctx || !param) return;
    try { param.setTargetAtTime(value, ctx.currentTime, seconds || 0.12); } catch (error) { param.value = value; }
  }

  function updateAmbient() {
    if (!ctx || !loopsStarted) return;
    const rain = currentEnvironment.rainStrength * (currentEnvironment.outdoors ? 0.72 : 0.22);
    setTarget(ambientLoops['ambient.rain'].gain.gain, rain, 0.28);
    setTarget(ambientLoops['ambient.nether'].gain.gain, currentEnvironment.dimension === 'nether' ? 0.42 : 0, 0.6);
    setTarget(ambientLoops['ambient.end'].gain.gain, currentEnvironment.dimension === 'end' ? 0.35 : 0, 0.7);
    setTarget(worldFilter.frequency, currentEnvironment.underwater ? 820 : 19500, currentEnvironment.underwater ? 0.08 : 0.22);
    if (reverbGain) setTarget(reverbGain.gain, clamp(currentEnvironment.caveStrength, 0, 1) * 0.24, 0.35);
  }

  async function lazyResourceBuffer(eventName, variant) {
    const sources = lazyResourceSources.get(eventName);
    const entry = sources && sources[variant];
    if (!entry) return null;
    if (entry.buffer) return entry.buffer;
    if (entry.promise) return entry.promise;
    entry.promise = (async () => {
      let data = entry.data;
      if (data && data.arrayBuffer) data = await data.arrayBuffer();
      if (!data && entry.url) {
        const response = await fetch(entry.url);
        if (!response.ok) throw new Error('Sound asset HTTP ' + response.status);
        data = await response.arrayBuffer();
      }
      if (!data) throw new Error('Missing lazy sound asset');
      entry.buffer = await decodeBuffer(data);
      return entry.buffer;
    })();
    try { return await entry.promise; }
    finally { entry.promise = null; }
  }

  async function prepareLazyEvents(names) {
    if (!unlocked || !ctx) return 0;
    if (defaultPackLoading && defaultPackPromise) await defaultPackPromise;
    let loaded = 0;
    for (const rawName of names || []) {
      const name = eventSpec(rawName).name;
      if (preparedLazyEvents.has(name)) continue;
      const sources = lazyResourceSources.get(name);
      if (!sources || !sources.length) continue;
      preparedLazyEvents.add(name);
      try {
        if (await lazyResourceBuffer(name, 0)) loaded++;
      } catch (error) {
        preparedLazyEvents.delete(name);
      }
    }
    return loaded;
  }

  function scheduleGameplayWarmup() {
    const queue = GAMEPLAY_PRELOAD_EVENTS.slice();
    const schedule = callback => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(callback, { timeout: 1800 });
      else if (typeof setTimeout === 'function') setTimeout(callback, 80);
    };
    const pump = () => {
      if (!unlocked || !queue.length) return;
      prepareLazyEvents([queue.shift()]).finally(() => schedule(pump));
    };
    schedule(pump);
  }

  function selectedMusicEvent() {
    if (currentEnvironment.screen === 'menu') return 'music.menu';
    if (currentEnvironment.dimension === 'nether') return 'music.nether';
    if (currentEnvironment.dimension === 'end') return 'music.end';
    return currentEnvironment.gameMode === 'creative' ? 'music.creative' : 'music.overworld';
  }

  function stopActiveMusic(nextDelay) {
    musicLoadToken++;
    musicLoading = false;
    if (activeMusic) {
      const source = activeMusic;
      activeMusic = null;
      activeMusicEvent = '';
      source.onended = null;
      try { source.stop(); } catch (error) { /* already stopped */ }
    }
    musicTimer = nextDelay === undefined ? 2 : Math.max(0, nextDelay);
  }

  async function playMusic() {
    if (!musicOn || activeMusic || musicLoading || !unlocked || !ctx) return;
    if (defaultPackLoading && defaultPackPromise) await defaultPackPromise;
    if (!musicOn || activeMusic || musicLoading || !unlocked || !ctx) return;
    const event = eventSpec(selectedMusicEvent());
    const variant = chooseVariant(event);
    const token = ++musicLoadToken;
    musicLoading = true;
    let buffer = null;
    let sourceKind = 'resource';
    try {
      const external = resourceBuffers.get(event.name);
      buffer = external && external[variant] ? external[variant] : await lazyResourceBuffer(event.name, variant);
    } catch (error) {
      lastError = String(error && error.message || error || 'Music asset load failed');
    } finally {
      if (token === musicLoadToken) musicLoading = false;
    }
    if (token !== musicLoadToken || !musicOn || activeMusic || !ctx) return;
    if (!buffer) { buffer = builtinBuffer(event.name, variant); sourceKind = 'builtin'; }
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.95;
    source.connect(gain); gain.connect(buses.music);
    activeMusic = source;
    activeMusicEvent = event.name;
    lastPlaybackEvent = event.name;
    lastPlaybackSource = sourceKind;
    source.onended = () => {
      if (activeMusic === source) { activeMusic = null; activeMusicEvent = ''; }
      musicTimer = 140 + Math.random() * 260;
    };
    source.start();
  }

  async function decodeBuffer(arrayBuffer) {
    const audioContext = ensure();
    if (!audioContext) throw new Error('WebAudio unavailable');
    const copy = arrayBuffer.slice ? arrayBuffer.slice(0) : arrayBuffer;
    const decoded = audioContext.decodeAudioData(copy);
    if (decoded && typeof decoded.then === 'function') return decoded;
    return new Promise((resolve, reject) => audioContext.decodeAudioData(copy, resolve, reject));
  }

  async function loadResourcePack(input, files) {
    let manifest = input;
    let baseUrl = '';
    if (typeof input === 'string') {
      const response = await fetch(input, { cache: 'no-cache' });
      if (!response.ok) throw new Error('Sound pack manifest HTTP ' + response.status);
      manifest = await response.json();
      baseUrl = new URL('.', response.url).href;
    }
    if (!manifest || typeof manifest !== 'object') throw new Error('Invalid sound pack manifest');
    const entries = manifest.events || manifest;
    const loaded = new Map();
    const lazyLoaded = new Map();
    const lookupFile = (name) => {
      if (!files) return null;
      if (files instanceof Map) return files.get(name) || null;
      return files[name] || null;
    };
    for (const rawName of Object.keys(entries)) {
      const name = canonical(rawName);
      const variants = Array.isArray(entries[rawName]) ? entries[rawName] : [entries[rawName]];
      const event = eventSpec(name);
      const lazyRequested = event.kind === 'music' || variants.some(raw => raw && typeof raw === 'object' && raw.lazy);
      if (lazyRequested) {
        const sources = [];
        for (const raw of variants.slice(0, 12)) {
          const fileName = typeof raw === 'string' ? raw : raw && raw.file;
          if (!fileName) continue;
          const local = lookupFile(fileName);
          sources.push(local
            ? { data: local, buffer: null, promise: null }
            : { url: baseUrl ? new URL(fileName, baseUrl).href : fileName, buffer: null, promise: null });
        }
        if (sources.length) lazyLoaded.set(name, sources);
        continue;
      }
      const buffers = [];
      for (const raw of variants.slice(0, 12)) {
        const fileName = typeof raw === 'string' ? raw : raw && raw.file;
        if (!fileName) continue;
        let data;
        const local = lookupFile(fileName);
        if (local) data = local.arrayBuffer ? await local.arrayBuffer() : local;
        else {
          const url = baseUrl ? new URL(fileName, baseUrl).href : fileName;
          const response = await fetch(url);
          if (!response.ok) continue;
          data = await response.arrayBuffer();
        }
        try { buffers.push(await decodeBuffer(data)); } catch (error) { /* skip invalid variant */ }
      }
      if (buffers.length) loaded.set(name, buffers);
    }
    if (!loaded.size && !lazyLoaded.size) throw new Error('Sound pack contains no usable events');
    resourceBuffers.clear();
    lazyResourceSources.clear();
    pendingLazyEvents.clear();
    musicLoadToken++;
    musicLoading = false;
    for (const [name, buffers] of loaded) resourceBuffers.set(name, buffers);
    for (const [name, sources] of lazyLoaded) lazyResourceSources.set(name, sources);
    preparedLazyEvents.clear();
    packName = String(manifest.name || 'custom');
    return {
      name: packName, events: loaded.size + lazyLoaded.size,
      variants: Array.from(loaded.values()).concat(Array.from(lazyLoaded.values())).reduce((sum, list) => sum + list.length, 0),
      lazyEvents: lazyLoaded.size,
    };
  }

  function requestDefaultPack() {
    if (defaultPackRequested) return defaultPackPromise;
    defaultPackRequested = true;
    defaultPackLoading = true;
    defaultPackPromise = loadResourcePack('assets/audio/manifest.json?v=112-original-2').then((result) => {
      defaultPackReady = true;
      return result;
    }).catch(() => {
      // Local-file previews and custom hosts may not expose bundled assets. Keep the
      // deterministic generated buffers as a safe fallback without surfacing noise.
      defaultPackReady = false;
      if (!packName) lastError = '';
      return null;
    }).finally(() => { defaultPackLoading = false; });
    return defaultPackPromise;
  }

  const Sound = {
    unlock() {
      try {
        const audioContext = ensure();
        if (!audioContext) return;
        resumeContext(audioContext);
        unlocked = true;
        preload(UI_PRELOAD_EVENTS);
        requestDefaultPack().then(() => scheduleGameplayWarmup());
        if (typeof setTimeout === 'function') setTimeout(() => {
          try { startAmbientLoops(); } catch (error) { /* ambience is optional */ }
        }, 0);
        else startAmbientLoops();
      } catch (error) {
        lastError = String(error && error.message || error || 'Audio unlock failed');
      }
    },
    play(name, volume, pitch) {
      return emit(name, { spatial: false, volume: volume === undefined ? 1 : volume, pitch: pitch === undefined ? 1 : pitch });
    },
    playAt(name, x, y, z, volume, pitch) {
      return emit(name, { x, y, z, spatial: true, volume: volume === undefined ? 1 : volume, pitch: pitch === undefined ? 1 : pitch });
    },
    emit,
    setListener(x, y, z, yaw) {
      listener.x = Number(x) || 0; listener.y = Number(y) || 0; listener.z = Number(z) || 0; listener.yaw = Number(yaw) || 0;
      if (!ctx) return;
      try {
        const audioListener = ctx.listener;
        const fx = Math.sin(listener.yaw), fz = -Math.cos(listener.yaw);
        if (audioListener.positionX) {
          audioListener.positionX.value = listener.x; audioListener.positionY.value = listener.y; audioListener.positionZ.value = listener.z;
          audioListener.forwardX.value = fx; audioListener.forwardY.value = 0; audioListener.forwardZ.value = fz;
          audioListener.upX.value = 0; audioListener.upY.value = 1; audioListener.upZ.value = 0;
        } else {
          audioListener.setPosition(listener.x, listener.y, listener.z);
          audioListener.setOrientation(fx, 0, fz, 0, 1, 0);
        }
      } catch (error) { /* old WebAudio implementation */ }
    },
    setEnvironmentProvider(provider) { environmentProvider = typeof provider === 'function' ? provider : null; },
    setMaster(value) {
      masterVol = clamp(value, 0, 1);
      if (master) setTarget(master.gain, masterVol, 0.05);
    },
    setMusic(on) {
      musicOn = !!on;
      if (!musicOn) stopActiveMusic(1);
      if (buses.music) setTarget(buses.music.gain, musicOn ? CATEGORY_LEVELS.music * musicVol : 0, 0.18);
    },
    setMusicVolume(value) {
      musicVol = clamp(value, 0, 1);
      if (buses.music) setTarget(buses.music.gain, musicOn ? CATEGORY_LEVELS.music * musicVol : 0, 0.18);
    },
    setCategoryVolume(category, value) {
      if (!CATEGORY_LEVELS[category] || !buses[category]) return false;
      const volume = clamp(value, 0, 1.5);
      setTarget(buses[category].gain, category === 'music' ? volume * musicVol : volume, 0.08);
      return true;
    },
    tick(dt, environment, legacyCaveStrength) {
      try {
        if (environment && typeof environment === 'object') {
          currentEnvironment = Object.assign({}, currentEnvironment, environment);
        } else {
          currentEnvironment.rainStrength = clamp(environment, 0, 1);
          currentEnvironment.caveStrength = clamp(legacyCaveStrength, 0, 1);
        }
        if (!unlocked || !ctx) return;
        updateAmbient();
        const nextMusicName = selectedMusicEvent();
        if (selectedMusicName && selectedMusicName !== nextMusicName) stopActiveMusic(2);
        selectedMusicName = nextMusicName;
        const caveEligible = currentEnvironment.screen === 'game' && currentEnvironment.dimension === 'overworld' &&
          !currentEnvironment.underwater && currentEnvironment.caveStrength > 0.62;
        caveExposure = caveEligible ? Math.min(12, caveExposure + dt) : Math.max(0, caveExposure - dt * 2);
        caveTimer = Math.max(0, caveTimer - dt);
        if (caveExposure >= 8 && caveTimer <= 0) {
          caveTimer = 120 + Math.random() * 240;
          caveExposure = 0;
          emit('ambient.cave', { spatial: false, volume: currentEnvironment.caveStrength * 0.72 });
        }
        if (!musicOn) return;
        musicTimer -= dt;
        if (musicTimer <= 0) playMusic();
      } catch (error) { /* keep game loop safe */ }
    },
    loadResourcePack,
    preload(names) { return preload(Array.isArray(names) ? names : UI_PRELOAD_EVENTS); },
    prepare(names) { return prepareLazyEvents(Array.isArray(names) ? names : GAMEPLAY_PRELOAD_EVENTS); },
    clearResourcePack() {
      resourceBuffers.clear(); lazyResourceSources.clear(); pendingLazyEvents.clear(); preparedLazyEvents.clear(); packName = '';
      musicLoadToken++; musicLoading = false;
    },
    describe(name) {
      const event = eventSpec(name);
      return {
        name: event.name, category: event.category, kind: event.kind,
        variants: event.variants, pitchMin: event.pitchMin, pitchMax: event.pitchMax,
        route: event.category === 'ui' ? 'dry' : 'world',
      };
    },
    catalog() {
      return Object.keys(EVENTS).concat([
        'block.<material>.<step|hit|break|place|fall>',
        'entity.<kind>.<ambient|hurt|death|attack|step|special>',
        'music.<menu|overworld|creative|nether|end>', 'ambient.<rain|nether|end>',
      ]);
    },
    status() {
      return {
        available: !!(window.AudioContext || window.webkitAudioContext), unlocked, contextState: ctx ? ctx.state : 'none',
        masterVolume: masterVol, musicVolume: musicVol, musicOn,
        lastError,
        builtinSamples: builtinBuffers.size, resourceEvents: resourceBuffers.size + lazyResourceSources.size, packName,
        lazyResourceEvents: lazyResourceSources.size, musicLoading, activeMusicEvent, selectedMusicName,
        caveTimer, caveExposure,
        defaultPackLoading, defaultPackReady, lastPlaybackEvent, lastPlaybackSource,
        activeVoices: Array.from(activeVoices.values()).reduce((sum, list) => sum + list.length, 0),
        uiRoute: 'dry', uiPreloadEvents: UI_PRELOAD_EVENTS.slice(),
        environment: Object.assign({}, currentEnvironment),
      };
    },
  };

  window.Sound = Sound;
})();
