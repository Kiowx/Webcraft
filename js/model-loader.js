/* model-loader.js - Minecraft 1.12 block model adapter */
'use strict';
(function () {
  const BASE = 'assets/minecraft-1.12.2/extracted/assets/minecraft/models/';
  const FACE_NAMES = {
    east: 'right', west: 'left', up: 'top', down: 'bottom',
    south: 'back', north: 'front',
  };
  const TEXTURE_ALIASES = {
    cobblestone: 'cobblestone',
    door_wood_lower: 'oak_door_lower', door_wood_upper: 'oak_door_upper',
    door_iron_lower: 'iron_door_lower', door_iron_upper: 'iron_door_upper',
    trapdoor: 'oak_trapdoor', iron_trapdoor: 'iron_trapdoor',
    brewing_stand_base: 'brewing_stand', brewing_stand: 'brewing_stand',
    repeater_off: 'repeater', repeater_on: 'repeater_lit',
  };
  const dataCache = new Map();
  const installed = new Map();
  let preloadPromise = null;

  function modelName(value, fallbackKind) {
    let name = String(value || '').replace(/^minecraft:/, '');
    if (name && name.indexOf('/') < 0) name = (fallbackKind || 'block') + '/' + name;
    return name;
  }

  async function fetchModel(name, fallbackKind) {
    name = modelName(name, fallbackKind);
    if (!name || name.indexOf('builtin/') === 0) return null;
    if (dataCache.has(name)) return dataCache.get(name);
    const pending = (async () => {
      const response = await fetch(BASE + name + '.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('model ' + name + ': HTTP ' + response.status);
      const raw = await response.json();
      let parent = null;
      if (raw.parent && String(raw.parent).indexOf('builtin/') < 0) {
        const kind = name.split('/')[0] || fallbackKind || 'block';
        try { parent = await fetchModel(raw.parent, kind); } catch (error) { parent = null; }
      }
      return {
        name,
        parent: raw.parent || null,
        textures: Object.assign({}, parent && parent.textures, raw.textures || {}),
        elements: raw.elements !== undefined ? raw.elements : (parent && parent.elements) || [],
        display: Object.assign({}, parent && parent.display, raw.display || {}),
        ambientocclusion: raw.ambientocclusion !== undefined
          ? raw.ambientocclusion : !(parent && parent.ambientocclusion === false),
      };
    })();
    dataCache.set(name, pending);
    try { return await pending; } catch (error) { dataCache.delete(name); throw error; }
  }

  function resolveTexture(reference, textures) {
    let value = reference;
    const seen = new Set();
    while (typeof value === 'string' && value[0] === '#' && !seen.has(value)) {
      seen.add(value);
      value = textures[value.slice(1)];
    }
    return value;
  }

  function textureTile(reference, textures, fallback) {
    const resolved = resolveTexture(reference, textures || {});
    const base = typeof resolved === 'string'
      ? resolved.replace(/^minecraft:/, '').split('/').pop()
      : '';
    const alias = TEXTURE_ALIASES[base] || base;
    const names = typeof Textures !== 'undefined' && Textures.names ? new Set(Textures.names()) : null;
    if (alias && (!names || names.has(alias))) return alias;
    if (fallback && (!names || names.has(fallback))) return fallback;
    return '__fallback';
  }

  function compileModelData(data, transform, fallbackTile) {
    if (!data || !Array.isArray(data.elements)) return [];
    transform = transform || {};
    return data.elements.map((source) => {
      const faces = {};
      for (const vanillaName of Object.keys(source.faces || {})) {
        const runtimeName = FACE_NAMES[vanillaName] || vanillaName;
        const spec = source.faces[vanillaName];
        if (spec === false) { faces[runtimeName] = false; continue; }
        faces[runtimeName] = {
          texture: textureTile(spec && spec.texture, data.textures, fallbackTile),
          uv: spec && Array.isArray(spec.uv) ? spec.uv.slice(0, 4) : null,
          rotation: spec && Number.isFinite(Number(spec.rotation)) ? Number(spec.rotation) : 0,
          tintindex: spec && spec.tintindex,
        };
      }
      const element = {
        from: (source.from || [0, 0, 0]).slice(0, 3),
        to: (source.to || [16, 16, 16]).slice(0, 3),
        faces,
        shade: source.shade !== false,
      };
      if (source.rotation) {
        element.rotation = {
          origin: (source.rotation.origin || [8, 8, 8]).slice(0, 3),
          axis: source.rotation.axis || 'y',
          angle: Number(source.rotation.angle) || 0,
          rescale: !!source.rotation.rescale,
        };
      }
      const rx = Number(transform.x) || 0, ry = Number(transform.y) || 0, rz = Number(transform.z) || 0;
      if (rx || ry || rz) element.modelRotation = { x: rx, y: ry, z: rz };
      return element;
    });
  }

  async function compile(name, transform, fallbackTile) {
    return compileModelData(await fetchModel(name, 'block'), transform, fallbackTile);
  }

  function copyDisplayVector(value, fallback) {
    const source = Array.isArray(value) ? value : fallback;
    return source.slice(0, 3).map(number => Number(number) || 0);
  }

  function compileItemDisplayData(data, fallback) {
    fallback = fallback || {};
    const source = data && data.display && data.display.firstperson_righthand;
    if (!source) return Object.assign({}, fallback);
    const rotation = copyDisplayVector(source.rotation, [0, 0, 0]);
    const translation = copyDisplayVector(source.translation, [0, 0, 0]);
    const scale = copyDisplayVector(source.scale, [1, 1, 1]);
    const radians = Math.PI / 180;
    return Object.assign({}, fallback, {
      // The runtime sprite faces the camera directly; vanilla's item renderer
      // contributes a 45 degree right-hand basis before this JSON transform.
      rot: [rotation[0] * radians, (rotation[1] + 45) * radians, rotation[2] * radians],
      scale: scale[0],
      model: 'generated',
      vanillaTransform: { rotation, translation, scale },
    });
  }

  async function installItemModel(id, name) {
    if (typeof Items === 'undefined') return false;
    const item = Items.get(id);
    if (!item) return false;
    const data = await fetchModel(name, 'item');
    if (!data) return false;
    const firstPerson = compileItemDisplayData(data, item.display && item.display.firstPerson);
    item.display = Object.assign({}, item.display, { firstPerson });
    item.handPose = firstPerson;
    item.modelResource = data.name;
    item.modelParent = data.parent;
    item.modelTexture = resolveTexture(data.textures.layer0, data.textures);
    installed.set('item:' + id, data.name);
    return true;
  }

  async function installStates(id, states, resource, fallbackTile) {
    const unique = new Map();
    for (const state of states) {
      const key = state.name + ':' + (state.x || 0) + ':' + (state.y || 0) + ':' + (state.z || 0);
      if (!unique.has(key)) unique.set(key, compile(state.name, state, fallbackTile));
      state.promise = unique.get(key);
    }
    const resolved = await Promise.all(states.map(state => state.promise));
    const source = states.length === 1
      ? resolved[0]
      : (world, x, y, z, state) => resolved[Math.max(0, Math.min(resolved.length - 1, state | 0))];
    if (!Blocks.installModel(id, source, resource)) return false;
    installed.set(id, resource);
    return true;
  }

  function directionalStates(name, count, openName) {
    const states = [];
    for (let state = 0; state < count; state++) {
      const open = !!(state & 4);
      states.push({ name: open && openName ? openName : name, y: (state & 3) * 90 + (open && !openName ? 90 : 0) });
    }
    return states;
  }

  function doorStates(name) {
    const states = [];
    for (let state = 0; state < 16; state++) {
      const open = !!(state & 4);
      const rightHinge = !!(state & 8);
      const panelFacing = typeof Blocks.doorPanelFacing === 'function'
        ? Blocks.doorPanelFacing(state)
        : ((state & 3) + (open ? (rightHinge ? 3 : 1) : 0)) & 3;
      states.push({
        name: rightHinge !== open ? name + '_rh' : name,
        y: ((panelFacing + 1) & 3) * 90,
      });
    }
    return states;
  }

  async function installAll() {
    if (typeof fetch !== 'function' || typeof Blocks === 'undefined') return { loaded: 0, failed: 0 };
    const ID = Blocks.ID;
    const jobs = [
      () => installStates(ID.LEVER, [{ name:'lever_off' }, { name:'lever' }], 'lever', 'lever'),
      () => installStates(ID.STONE_PRESSURE_PLATE,
        [{ name:'stone_pressure_plate_up' }, { name:'stone_pressure_plate_down' }], 'stone_pressure_plate', 'stone'),
      () => installStates(ID.OAK_TRAPDOOR, directionalStates('wooden_trapdoor_bottom', 8, 'wooden_trapdoor_open'), 'trapdoor', 'oak_trapdoor'),
      () => installStates(ID.IRON_TRAPDOOR, directionalStates('iron_trapdoor_bottom', 8, 'iron_trapdoor_open'), 'iron_trapdoor', 'iron_trapdoor'),
      () => installStates(ID.OAK_DOOR, doorStates('wooden_door_bottom'), 'wooden_door_bottom', 'oak_door_lower'),
      () => installStates(ID.OAK_DOOR_TOP, doorStates('wooden_door_top'), 'wooden_door_top', 'oak_door_upper'),
      () => installStates(ID.IRON_DOOR, doorStates('iron_door_bottom'), 'iron_door_bottom', 'iron_door_lower'),
      () => installStates(ID.IRON_DOOR_TOP, doorStates('iron_door_top'), 'iron_door_top', 'iron_door_upper'),
      () => installStates(ID.REDSTONE_TORCH, [{ name:'lit_redstone_torch' }], 'lit_redstone_torch', 'redstone_torch_on'),
      () => installStates(ID.REDSTONE_TORCH_OFF, [{ name:'unlit_redstone_torch' }], 'unlit_redstone_torch', 'redstone_torch_off'),
      () => installStates(ID.REPEATER, directionalStates('repeater_1tick', 4), 'unpowered_repeater', 'repeater'),
      () => installStates(ID.REPEATER_LIT, directionalStates('repeater_on_1tick', 4), 'powered_repeater', 'repeater_lit'),
      () => installStates(ID.BREWING_STAND, [{ name:'brewing_stand' }], 'brewing_stand', 'brewing_stand'),
      () => installStates(ID.DRAGON_EGG, [{ name:'dragon_egg' }], 'dragon_egg', 'dragon_egg'),
    ];
    if (typeof Items !== 'undefined') {
      const swordModels = ['wooden_sword', 'stone_sword', 'iron_sword', 'golden_sword', 'diamond_sword'];
      for (let index = 0; index < swordModels.length; index++) {
        jobs.push(() => installItemModel(Items.IT.SWORD_WOOD + index, swordModels[index]));
      }
    }
    const results = await Promise.allSettled(jobs.map(job => job()));
    const loaded = results.filter(result => result.status === 'fulfilled' && result.value).length;
    const failed = results.length - loaded;
    if (failed && typeof console !== 'undefined') console.warn('[VanillaModels] loaded ' + loaded + ', fallback ' + failed);
    return { loaded, failed };
  }

  window.VanillaModels = {
    preload() {
      if (!preloadPromise) preloadPromise = installAll();
      return preloadPromise;
    },
    compileModelData,
    compileItemDisplayData,
    textureTile,
    doorStates,
    installed() { return new Map(installed); },
  };
})();
