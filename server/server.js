'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const readline = require('readline');
const { WebSocket, WebSocketServer } = require('ws');

const PROTOCOL = 3;
const PORT = clampInt(process.env.PORT, 0, 65535, 8080);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PLAYERS = clampInt(process.env.MAX_PLAYERS, 1, 32, 15);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const WORLD_FILE = path.join(DATA_DIR, 'world.json');
const BACKUP_FILE = path.join(DATA_DIR, 'world.backup.json');
const TEMP_WORLD_FILE = path.join(DATA_DIR, 'world.json.tmp');
const MAX_BLOCK_ID = 255;
const SIMULATION_MS = 50;
const SNAPSHOT_MS = 50;
const SNAPSHOT_BACKPRESSURE = 64 * 1024;
const SAVE_DEBOUNCE_MS = Math.max(250, Math.min(10000, Number(process.env.SAVE_DEBOUNCE_MS) || 1000));
const ADMIN_PASSWORD_GENERATED = !process.env.ADMIN_PASSWORD;
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url'));
const WHITELIST_SOURCE = String(process.env.WHITELIST || '').trim();
const WHITELIST = new Set(WHITELIST_SOURCE ? WHITELIST_SOURCE.split(',').map(safeName).map(name => name.toLocaleLowerCase()) : []);
let whitelistEnabled = WHITELIST.size > 0;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

const ROLE_PERMISSIONS = {
  user: [],
  moderator: ['gamemode.self', 'gamemode.others', 'player.ban', 'player.kick', 'player.teleport', 'player.heal', 'item.give', 'item.self'],
  admin: ['*'],
};

function loadGameRegistry() {
  const sandbox = {
    console, Math, Date, JSON, Number, String, Boolean, Object, Array, Map, Set, WeakMap,
    Uint8Array, Uint16Array, Uint32Array, Int32Array, Float32Array,
  };
  sandbox.window = sandbox;
  for (const file of ['util', 'vanilla', 'noise', 'blocks', 'world', 'physics', 'craft']) {
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', file + '.js'), 'utf8'), sandbox, { filename: file + '.js' });
  }
  return {
    Vanilla: sandbox.Vanilla,
    Blocks: sandbox.Blocks, Items: sandbox.Items, World: sandbox.World,
    Physics: sandbox.Physics, Craft: sandbox.Craft,
  };
}

const Registry = loadGameRegistry();
const Vanilla = Registry.Vanilla;
const MAX_AIR_SECONDS = Vanilla.SURVIVAL.maxAirSeconds;
const PASSIVE_MOBS = new Set(['pig', 'cow', 'sheep', 'chicken', 'rabbit', 'horse', 'wolf', 'villager', 'cat', 'squid', 'bat']);
const HOSTILE_MOBS = new Set(['zombie', 'skeleton', 'spider', 'creeper', 'slime', 'enderman', 'blaze', 'ender_dragon']);
const STONE_AGE_BLOCKS = new Set([
  Registry.Blocks.ID.STONE, Registry.Blocks.ID.COBBLE, Registry.Blocks.ID.MOSSY,
  Registry.Blocks.ID.STONE_BRICKS, Registry.Blocks.ID.STONE_SLAB, Registry.Blocks.ID.STONE_DOUBLE_SLAB,
]);
const PLAYER_SKINS = new Set(['steve', 'alex', 'miner', 'wanderer']);
function safeSkin(value) { return PLAYER_SKINS.has(value) ? value : 'steve'; }
function safeModelType(value) { return value === 'slim' ? 'slim' : 'classic'; }
const SERVER_DRIVEN_STATE_FAMILIES = new Set(['redstone_wire', 'redstone_lamp', 'redstone_torch', 'repeater', 'piston', 'piston_head', 'iron_door', 'iron_trapdoor']);
const MOB_STATS = Object.freeze({
  pig: { hp: 10, speed: 1.1, w: 0.9, h: 1.0 },
  cow: { hp: 10, speed: 1.0, w: 0.95, h: 1.35 },
  sheep: { hp: 8, speed: 1.0, w: 0.9, h: 1.3 },
  chicken: { hp: 4, speed: 1.15, w: 0.5, h: 0.8 },
  rabbit: { hp: 3, speed: 1.8, w: 0.42, h: 0.52 },
  horse: { hp: 30, speed: 2.25, w: 1.4, h: 1.6 },
  zombie: { hp: 20, speed: 1.9, w: 0.6, h: 1.95 },
  skeleton: { hp: 20, speed: 1.8, w: 0.6, h: 1.95 },
  spider: { hp: 16, speed: 2.2, w: 1.3, h: 0.65 },
  creeper: { hp: 20, speed: 1.7, w: 0.6, h: 1.8 },
  slime: { hp: 12, speed: 1.35, w: 0.8, h: 0.8 },
  enderman: { hp: 40, speed: 2.5, w: 0.6, h: 2.9, neutral: true },
  wolf: { hp: 8, speed: 1.7, w: 0.65, h: 0.85 },
  villager: { hp: 20, speed: 1.0, w: 0.6, h: 1.95 },
  cat: { hp: 10, speed: 1.45, w: 0.55, h: 0.7 },
  iron_golem: { hp: 100, speed: 1.15, w: 1.35, h: 2.7 },
  squid: { hp: 10, speed: 1.15, w: 0.8, h: 0.8, aquatic: true },
  bat: { hp: 6, speed: 1.8, w: 0.5, h: 0.45, flying: true },
  blaze: { hp: 20, speed: 1.65, w: 0.65, h: 1.8, flying: true },
  ender_dragon: { hp: 200, speed: 4.0, w: 5.0, h: 3.0, flying: true, boss: true },
});
const BREED_FOOD = Object.freeze({
  pig: Registry.Items.IT.CARROT,
  cow: Registry.Items.IT.WHEAT,
  sheep: Registry.Items.IT.WHEAT,
  chicken: Registry.Items.IT.WHEAT_SEEDS,
  rabbit: Registry.Items.IT.CARROT,
  horse: Registry.Items.IT.APPLE,
});
const MOB_GOAL_PRIORITY = Object.freeze({ flee: 0, chase: 1, tempt: 2, home: 3, wander: 4 });
const MOB_NAV_DIRECTIONS = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]]);
const MOB_NAV_HEIGHT_OFFSETS = Object.freeze([
  0,
  0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
  -0.1, -0.2, -0.3, -0.4, -0.5, -0.6, -0.7, -0.8, -0.9, -1,
]);
const MOB_NAV_SEARCHES_PER_TICK = 2;
const MOB_NAV_NODES_PER_TICK = 192;
const MOB_NAV_NODES_PER_SEARCH = 128;
const VILLAGER_TRADES = Object.freeze({
  unemployed: { cost: 1, id: Registry.Items.IT.BREAD, n: 2, uses: 4 },
  farmer: { cost: 1, id: Registry.Items.IT.BREAD, n: 6, uses: 8 },
  librarian: { cost: 2, id: Registry.Items.IT.BOOK, n: 1, uses: 6 },
  toolsmith: { cost: 4, id: Registry.Items.IT.PICK_IRON, n: 1, uses: 3 },
  butcher: { cost: 1, id: Registry.Items.IT.BEEF_COOKED, n: 3, uses: 6 },
  cleric: { cost: 2, id: Registry.Items.IT.GLOWSTONE_DUST, n: 4, uses: 5 },
});
const itemAliases = new Map();

function aliasKey(value) {
  return String(value || '').toLocaleLowerCase().replace(/[\s_\-]+/g, '');
}

function registerItemAlias(value, id) {
  const key = aliasKey(value);
  if (key) itemAliases.set(key, id);
}

for (const [name, id] of Object.entries(Registry.Items.IT)) registerItemAlias(name, id);
for (const [name, id] of Object.entries(Registry.Blocks.ID)) if (Registry.Items.get(id)) registerItemAlias(name, id);
for (const item of Object.values(Registry.Items.all)) {
  if (!item) continue;
  registerItemAlias(item.id, item.id);
  registerItemAlias(item.name, item.id);
  registerItemAlias(item.tex, item.id);
}

function clamp(value, min, max) {
  value = Number(value);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function safeName(value) {
  let name = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  try { name = name.replace(/[^\p{L}\p{N}_\- ]/gu, ''); } catch (error) { name = name.replace(/[^A-Za-z0-9_\- ]/g, ''); }
  name = name.replace(/\s+/g, ' ').trim();
  name = Array.from(name).slice(0, 16).join('');
  return name || 'Steve';
}

function safeText(value, limit) {
  return Array.from(String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, limit || 160).join('');
}

function cleanVillagePoint(value) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) return null;
  const point = { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
  return Math.abs(point.x) <= 1000000 && Math.abs(point.z) <= 1000000 && point.y >= 0 && point.y < 256 ? point : null;
}

function tokenKey(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function passwordMatches(value) {
  const expected = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  const actual = crypto.createHash('sha256').update(String(value || '')).digest();
  return crypto.timingSafeEqual(expected, actual);
}

function editKey(x, y, z) { return x + ',' + y + ',' + z; }
function containerKey(x, y, z) { return x + ',' + y + ',' + z; }

function cleanEdit(value) {
  if (!value) return null;
  const x = Number(value.x), y = Number(value.y), z = Number(value.z), id = Number(value.id);
  if (![x, y, z, id].every(Number.isInteger)) return null;
  if (Math.abs(x) > 1000000 || Math.abs(z) > 1000000 || y < 0 || y >= 256 || id < 0 || id > MAX_BLOCK_ID || !Registry.Blocks.all[id]) return null;
  const state = Number.isInteger(value.state) && value.state >= 0 && value.state <= 15 ? value.state : null;
  return { x, y, z, id, state };
}

function cleanEnchantments(value) {
  if (!value || typeof value !== 'object') return undefined;
  const out = {};
  for (const key of ['protection', 'sharpness', 'efficiency', 'power', 'unbreaking']) {
    const level = clampInt(value[key], 1, 3, 0);
    if (level) out[key] = level;
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanStack(value) {
  if (!value) return null;
  const id = Number(value.id);
  const item = Number.isInteger(id) ? Registry.Items.get(id) : null;
  if (!item) return null;
  const maxStack = Registry.Items.maxStack(id);
  const stack = { id, n: clampInt(value.n, 1, maxStack, 1) };
  const maxDurability = Registry.Items.durabilityOf(id);
  if (maxDurability > 0) stack.dur = clampInt(value.dur, 0, maxDurability, maxDurability);
  const ench = cleanEnchantments(value.ench);
  if (ench) stack.ench = ench;
  const customName = safeText(value.name, 32);
  if (customName) stack.name = customName;
  return stack;
}

function cloneStack(value, count) {
  const stack = cleanStack(value);
  if (!stack) return null;
  if (count !== undefined) stack.n = clampInt(count, 1, Registry.Items.maxStack(stack.id), 1);
  return stack;
}

function cleanSlots(value, length) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length }, (_, index) => cleanStack(source[index]));
}

function cleanEquipment(value) {
  const slots = cleanSlots(value, 4);
  for (let index = 0; index < slots.length; index++) {
    const item = slots[index] ? Registry.Items.get(slots[index].id) : null;
    if (!item || !item.armor || item.armor.slot !== index) slots[index] = null;
    else slots[index].n = 1;
  }
  return slots;
}

function cleanOffhand(value) {
  return cleanStack(value);
}

function stackIdentity(stack) {
  if (!stack) return '';
  const ench = stack.ench ? Object.keys(stack.ench).sort().map(key => key + ':' + stack.ench[key]).join(',') : '';
  return [stack.id, stack.dur === undefined ? '' : stack.dur, ench, stack.name || ''].join('|');
}

function inventoryTotals(profile, extraSlots) {
  const totals = new Map();
  const groups = [profile.inv || [], profile.equipment || [], [profile.offhand || null],
    [profile.cursor || null]].concat(extraSlots || []);
  for (const slots of groups) for (const stack of slots || []) {
    if (!stack) continue;
    const key = stackIdentity(stack);
    totals.set(key, (totals.get(key) || 0) + stack.n);
  }
  return totals;
}

function sameInventoryTotals(beforeProfile, afterProfile, beforeExtra, afterExtra) {
  const before = inventoryTotals(beforeProfile, beforeExtra);
  const after = inventoryTotals(afterProfile, afterExtra);
  if (before.size !== after.size) return false;
  for (const [key, count] of before) if (after.get(key) !== count) return false;
  return true;
}

function cleanClientInventory(raw, fallback) {
  const hasOffhand = !!raw && Object.prototype.hasOwnProperty.call(raw, 'offhand');
  return {
    inv: cleanSlots(raw && raw.inv, 36),
    equipment: cleanEquipment(raw && raw.equipment),
    offhand: cleanOffhand(hasOffhand ? raw.offhand : fallback.offhand),
    cursor: cleanStack(raw && raw.cursor),
    hotbar: clampInt(raw && raw.hotbar, 0, 8, fallback.hotbar),
  };
}

function defaultProfile(key, name, spawnPoint) {
  const spawn = spawnPoint && [spawnPoint.x, spawnPoint.y, spawnPoint.z].every(Number.isFinite)
    ? { x: Number(spawnPoint.x), y: Number(spawnPoint.y), z: Number(spawnPoint.z) }
    : { x: 0.5, y: 80, z: 0.5 };
  const inv = Array(36).fill(null);
  inv[0] = { id: Registry.Blocks.ID.CRAFTING, n: 1 };
  inv[1] = { id: Registry.Items.IT.APPLE, n: 3 };
  inv[2] = { id: Registry.Blocks.ID.TORCH, n: 8 };
  return {
    key, name: safeName(name), role: 'user', mode: 'survival',
    x: spawn.x, y: spawn.y, z: spawn.z, yaw: 0, pitch: 0,
    hp: 20, hunger: 20, saturation: 5, air: MAX_AIR_SECONDS, dead: false,
    hotbar: 0, inv, equipment: Array(4).fill(null), offhand: null,
    inventoryRevision: 0,
    cursor: null,
    xpLevel: 0, xpProgress: 0, statusEffects: [],
    stats: { blocksMined: 0, blocksPlaced: 0, mobsKilled: 0, distanceWalked: 0, itemsCrafted: 0 },
    advancements: {},
    spawn: { x: spawn.x, y: spawn.y, z: spawn.z }, lastSeen: Date.now(),
  };
}

function cleanProfile(value, key, fallbackName) {
  const source = value && typeof value === 'object' ? value : {};
  const role = ROLE_PERMISSIONS[source.role] ? source.role : 'user';
  const profile = defaultProfile(key, source.name || fallbackName);
  profile.role = role;
  profile.mode = source.mode === 'creative' && role !== 'user' ? 'creative' : 'survival';
  profile.x = Number.isFinite(+source.x) ? clamp(source.x, -1000000, 1000000) : profile.x;
  profile.y = Number.isFinite(+source.y) ? clamp(source.y, -64, 320) : profile.y;
  profile.z = Number.isFinite(+source.z) ? clamp(source.z, -1000000, 1000000) : profile.z;
  profile.yaw = Number.isFinite(+source.yaw) ? Math.atan2(Math.sin(+source.yaw), Math.cos(+source.yaw)) : 0;
  profile.pitch = clamp(source.pitch, -Math.PI / 2, Math.PI / 2);
  profile.hp = clampInt(source.hp, 0, 20, 20);
  profile.hunger = clampInt(source.hunger, 0, 20, 20);
  profile.saturation = Number.isFinite(+source.saturation) ? clamp(source.saturation, 0, profile.hunger) : profile.saturation;
  profile.air = Number.isFinite(+source.air) ? clamp(source.air, 0, MAX_AIR_SECONDS) : profile.air;
  profile.dead = !!source.dead || profile.hp <= 0;
  profile.hotbar = clampInt(source.hotbar, 0, 8, 0);
  profile.inventoryRevision = clampInt(source.inventoryRevision, 0, 2147483647, 0);
  profile.inv = cleanSlots(source.inv, 36);
  profile.equipment = cleanEquipment(source.equipment);
  profile.offhand = cleanOffhand(source.offhand);
  profile.cursor = cleanStack(source.cursor);
  profile.xpLevel = clampInt(source.xpLevel, 0, 10000, 0);
  profile.xpProgress = clamp(source.xpProgress, 0, 1);
  profile.statusEffects = Array.isArray(source.statusEffects) ? source.statusEffects.slice(0, 16).map(effect => ({
    type: safeText(effect && effect.type, 24),
    time: clamp(effect && effect.time, 0, 3600),
    level: clampInt(effect && effect.level, 0, 10, 0),
  })).filter(effect => effect.type && effect.time > 0) : [];
  const statSource = source.stats && typeof source.stats === 'object' ? source.stats : {};
  for (const name of Object.keys(profile.stats)) profile.stats[name] = clamp(Number(statSource[name]) || 0, 0, 1000000000);
  const advancementSource = source.advancements && typeof source.advancements === 'object' ? source.advancements : {};
  for (const id of ['mine_block', 'craft_item', 'kill_mob']) {
    if (advancementSource[id]) profile.advancements[id] = clamp(Number(advancementSource[id]) || Date.now(), 1, Date.now());
  }
  if (source.spawn && [source.spawn.x, source.spawn.y, source.spawn.z].every(Number.isFinite)) {
    profile.spawn = {
      x: clamp(source.spawn.x, -1000000, 1000000),
      y: clamp(source.spawn.y, -64, 320),
      z: clamp(source.spawn.z, -1000000, 1000000),
    };
  }
  profile.lastSeen = Number.isFinite(+source.lastSeen) ? +source.lastSeen : Date.now();
  if (typeof source.whitelistName === 'string' && source.whitelistName.trim()) {
    profile.whitelistName = safeName(source.whitelistName).toLocaleLowerCase();
  }
  return profile;
}

function cleanContainer(value) {
  if (!value) return null;
  const x = Number(value.x), y = Number(value.y), z = Number(value.z);
  const type = value.type === 'furnace' ? 'furnace' : value.type === 'chest' ? 'chest' : null;
  if (!type || ![x, y, z].every(Number.isInteger) || y < 0 || y >= 256) return null;
  const size = type === 'chest' ? 27 : 3;
  return {
    key: containerKey(x, y, z), x, y, z, type,
    slots: cleanSlots(value.slots, size),
    burn: type === 'furnace' ? clamp(value.burn, 0, 1000) : 0,
    burnMax: type === 'furnace' ? clamp(value.burnMax, 0, 1000) : 0,
    cook: type === 'furnace' ? clamp(value.cook, 0, 10) : 0,
    xpStored: type === 'furnace' ? clamp(value.xpStored, 0, 1000000) : 0,
    revision: clampInt(value.revision, 0, 1000000000, 0),
  };
}

function cleanSign(value) {
  if (!value) return null;
  const x = Number(value.x), y = Number(value.y), z = Number(value.z);
  if (![x, y, z].every(Number.isInteger) || Math.abs(x) > 1000000 || Math.abs(z) > 1000000 || y < 0 || y >= 256) return null;
  const source = Array.isArray(value.lines) ? value.lines : String(value.text || '').replace(/\r/g, '').split('\n');
  const lines = source.slice(0, 4).map(line => Array.from(String(line || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')).slice(0, 15).join(''));
  while (lines.length < 4) lines.push('');
  return { key: containerKey(x, y, z), x, y, z, lines };
}

function loadWorld() {
  let data = null;
  let recovered = false;
  const readWorldData = file => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' && Number.isInteger(parsed.seed) ? parsed : null;
    } catch (error) { return null; }
  };
  data = readWorldData(WORLD_FILE);
  if (!data) {
    data = readWorldData(BACKUP_FILE);
    if (data) {
      recovered = true;
      console.warn('Recovered world from world.backup.json');
    }
  }
  const seed = data && Number.isInteger(data.seed) ? data.seed >>> 0 : crypto.randomBytes(4).readUInt32LE(0);
  const edits = new Map();
  for (const raw of data && Array.isArray(data.edits) ? data.edits : []) {
    const edit = cleanEdit(raw);
    if (edit) edits.set(editKey(edit.x, edit.y, edit.z), edit);
  }
  const profiles = new Map();
  for (const raw of data && Array.isArray(data.profiles) ? data.profiles : []) {
    if (!raw || !/^[a-f0-9]{64}$/i.test(String(raw.key || ''))) continue;
    profiles.set(raw.key, cleanProfile(raw, raw.key, raw.name));
  }
  const containers = new Map();
  for (const raw of data && Array.isArray(data.containers) ? data.containers : []) {
    const container = cleanContainer(raw);
    if (container) containers.set(container.key, container);
  }
  const signs = new Map();
  for (const raw of data && Array.isArray(data.signs) ? data.signs : []) {
    const sign = cleanSign(raw);
    if (sign) signs.set(sign.key, sign);
  }
  const savedTime = data && Number.isFinite(+data.time) ? Math.max(0, +data.time) : 0;
  const savedTimeOfDay = data && Number.isFinite(+data.timeOfDay) ? ((+data.timeOfDay % 1) + 1) % 1 : 0.30;
  return {
    seed, edits, profiles, containers, signs,
    spawnedVillages: new Set(data && Array.isArray(data.spawnedVillages) ? data.spawnedVillages.filter(id => typeof id === 'string') : []),
    bans: {
      keys: new Set(data && data.bans && Array.isArray(data.bans.keys) ? data.bans.keys.map(String) : []),
      names: new Set(data && data.bans && Array.isArray(data.bans.names) ? data.bans.names.map(name => safeName(name).toLocaleLowerCase()) : []),
    },
    whitelist: {
      enabled: data && data.whitelist && typeof data.whitelist.enabled === 'boolean' ? data.whitelist.enabled : null,
      names: data && data.whitelist && Array.isArray(data.whitelist.names)
        ? data.whitelist.names.map(name => safeName(name).toLocaleLowerCase()).filter(Boolean) : [],
    },
    timeBase: savedTime, clockStart: Date.now(), timeOfDayBase: savedTimeOfDay,
    weather: data && data.weather === 'rain' ? 'rain' : 'clear',
    weatherTimer: data && Number.isFinite(+data.weatherTimer) ? clamp(data.weatherTimer, 10, 1200) : 240,
    difficulty: clampInt(data && data.difficulty, 0, 3, 2),
    rngState: data && Number.isInteger(data.rngState) ? data.rngState >>> 0 : undefined,
    savedEntities: data && Array.isArray(data.entities) ? data.entities.slice(0, 256) : [],
    dragonDefeated: !!(data && data.dragonDefeated),
    dirty: recovered, recovered, saveTimer: null,
  };
}

const world = loadWorld();
for (const name of world.whitelist.names) WHITELIST.add(name);
if (world.whitelist.enabled !== null) whitelistEnabled = world.whitelist.enabled;
const simulationWorld = new Registry.World(world.seed);
simulationWorld.setRngState(world.rngState);
simulationWorld.time = world.timeBase;
simulationWorld.timeOfDay = world.timeOfDayBase;
simulationWorld.spawnedVillages = world.spawnedVillages;
for (const sign of world.signs.values()) simulationWorld.setBE(sign.x, sign.y, sign.z, { type: 'sign', lines: sign.lines.slice() });
const players = new Map();
const entities = new Map();

function canonicalPlayerName(value) {
  return String(value || '').trim() ? safeName(value).toLocaleLowerCase() : '';
}

function profileWhitelistClaim(profile) {
  return profile && typeof profile.whitelistName === 'string'
    ? canonicalPlayerName(profile.whitelistName) : '';
}

function findWhitelistOwner(name) {
  let legacyOwner = null;
  for (const profile of world.profiles.values()) {
    const claim = profileWhitelistClaim(profile);
    if (claim === name) return profile;
    if (!claim && !legacyOwner && canonicalPlayerName(profile.name) === name) legacyOwner = profile;
  }
  return legacyOwner;
}

function whitelistAdmission(key, requestedName, profile) {
  const name = canonicalPlayerName(requestedName);
  const listed = WHITELIST.has(name);
  if (listed) {
    const owner = findWhitelistOwner(name);
    if (owner && owner.key !== key) {
      return { ok:false, code:'whitelist_identity', message:'该白名单昵称已绑定到其他玩家身份' };
    }
    const activeClaim = profileWhitelistClaim(profile);
    if (activeClaim && activeClaim !== name && WHITELIST.has(activeClaim)) {
      return { ok:false, code:'whitelist_identity', message:'此玩家身份已绑定到其他白名单昵称' };
    }
  }
  if (whitelistEnabled && (!profile || profile.role !== 'admin') && !listed) {
    return { ok:false, code:'whitelist', message:'你不在服务器白名单中' };
  }
  return { ok:true, claim:listed ? name : '' };
}
let nextEntityId = 1;
let spawnClock = 0;
let worldTickClock = 0;
let pruneClock = 0;
let villageLifeClock = 0;
let villageRaidClock = 0;
let chunkWarmupClock = 0;
let mobNavigationSearchBudget = 0;
let mobNavigationNodeBudget = 0;
const chunkWarmupQueue = [];
const chunkWarmupKeys = new Set();
let simulationApplying = 0;
const simulationPending = new Map();
const simulationIgnored = new Set();

for (const raw of world.savedEntities) {
  if (!raw || !Number.isFinite(+raw.x) || !Number.isFinite(+raw.y) || !Number.isFinite(+raw.z)) continue;
  if (raw.type === 'mob') {
    const mob = spawnMobEntity(raw.kind, +raw.x, +raw.y, +raw.z, raw.babyTime);
    if (mob) {
      if (Number.isFinite(+raw.hp)) mob.hp = clamp(+raw.hp, 1, mob.maxHp);
      mob.villageId = typeof raw.villageId === 'string' ? raw.villageId : null;
      mob.profession = typeof raw.profession === 'string' && VILLAGER_TRADES[raw.profession] ? raw.profession : 'unemployed';
      mob.home = cleanVillagePoint(raw.home); mob.jobSite = cleanVillagePoint(raw.jobSite); mob.meeting = cleanVillagePoint(raw.meeting);
      mob.tradeLevel = clampInt(raw.tradeLevel, 1, 5, 1);
      mob.tradeUses = clampInt(raw.tradeUses, 0, 64, 0);
      mob.restockAt = Number.isFinite(+raw.restockAt) ? Math.max(0, +raw.restockAt) : 0;
      if (mob.villageId) world.spawnedVillages.add(mob.villageId);
    }
  } else if (raw.type === 'item') {
    spawnItemEntity(+raw.x, +raw.y, +raw.z, { id: raw.itemId, n: raw.count, dur: raw.dur, ench: raw.ench, name: raw.name }, raw.vx, raw.vy, raw.vz);
  }
}
world.savedEntities.length = 0;

function scheduleSimulationTick(edit) {
  const ID = Registry.Blocks.ID;
  if (edit.id === ID.WATER || edit.id === ID.LAVA) simulationWorld.schedule(edit.x, edit.y, edit.z, edit.id === ID.WATER ? 0.12 : 0.48, 'fluid');
  else if ([ID.WHEAT_CROP, ID.CARROT_CROP, ID.POTATO_CROP].includes(edit.id)) simulationWorld.schedule(edit.x, edit.y, edit.z, 8, 'crop');
  else if (edit.id === ID.FARMLAND) simulationWorld.schedule(edit.x, edit.y, edit.z, 1, 'farmland');
  else if (edit.id === ID.FIRE) simulationWorld.schedule(edit.x, edit.y, edit.z, 7, 'fire');
  else if (edit.id === ID.SUGAR_CANE) simulationWorld.schedule(edit.x, edit.y, edit.z, 20, 'cane');
  else if (edit.id === ID.SAPLING) simulationWorld.schedule(edit.x, edit.y, edit.z, 25, 'grow');
  else if (edit.id === ID.STONE_BUTTON && edit.state) simulationWorld.schedule(edit.x, edit.y, edit.z, 1, 'button');
  else if (edit.id === ID.STONE_PRESSURE_PLATE && edit.state) simulationWorld.schedule(edit.x, edit.y, edit.z, 0.5, 'pressure_plate');
  else if (Registry.Blocks.get(edit.id).gravity) simulationWorld.schedule(edit.x, edit.y, edit.z, 0.1, 'fall');
}

simulationWorld.onChunkGenerated = chunk => {
  simulationApplying++;
  try {
    for (const edit of world.edits.values()) {
      if ((edit.x >> 4) !== chunk.cx || (edit.z >> 4) !== chunk.cz) continue;
      const index = (edit.x & 15) | ((edit.z & 15) << 4) | (edit.y << 8);
      chunk.blocks[index] = edit.id;
      const key = simulationWorld.beKey(edit.x, edit.y, edit.z);
      if (edit.state === null) simulationWorld.states.delete(key);
      else simulationWorld.states.set(key, edit.state);
      scheduleSimulationTick(edit);
    }
  } finally { simulationApplying--; }
};

function queueSimulationEdit(x, y, z) {
  if (simulationApplying || simulationIgnored.has(editKey(x, y, z))) return;
  const state = simulationWorld.getState(x, y, z);
  simulationPending.set(editKey(x, y, z), {
    x, y, z, id: simulationWorld.getBlock(x, y, z),
    state: Number.isInteger(state) && state >= 0 && state <= 15 ? state : null,
  });
}

simulationWorld.onBlockChanged = queueSimulationEdit;
simulationWorld.onStateChanged = queueSimulationEdit;
simulationWorld.onBlockPopped = (x, y, z, id, state) => {
  for (const drop of Registry.Blocks.dropsFor(id, state, () => simulationWorld.random())) {
    spawnItemEntity(x + 0.5, y + 0.3, z + 0.5, drop, 0, 2, 0);
  }
};

function applyEditToSimulation(edit) {
  simulationWorld.ensureChunk(edit.x >> 4, edit.z >> 4);
  const key = editKey(edit.x, edit.y, edit.z);
  simulationIgnored.add(key);
  try {
    simulationWorld.setBlock(edit.x, edit.y, edit.z, edit.id);
    if (edit.state === null) simulationWorld.removeState(edit.x, edit.y, edit.z);
    else simulationWorld.setState(edit.x, edit.y, edit.z, edit.state);
    scheduleSimulationTick(edit);
  } finally { simulationIgnored.delete(key); }
}

function flushSimulationEdits() {
  if (!simulationPending.size) return;
  const edits = Array.from(simulationPending.values()).slice(0, 256);
  for (const edit of edits) {
    simulationPending.delete(editKey(edit.x, edit.y, edit.z));
    const key = editKey(edit.x, edit.y, edit.z);
    world.edits.set(key, edit);
    if (edit.id !== Registry.Blocks.ID.OAK_SIGN && world.signs.delete(key)) {
      broadcast({ t: 'sign', x: edit.x, y: edit.y, z: edit.z, removed: true });
    }
  }
  scheduleSave();
  broadcast({ t: 'blocks', edits });
}

function worldTime() { return world.timeBase + Math.max(0, (Date.now() - world.clockStart) / 1000); }

function worldClock() {
  const elapsed = Math.max(0, (Date.now() - world.clockStart) / 1000);
  return { time: world.timeBase + elapsed, timeOfDay: (world.timeOfDayBase + elapsed / 1200) % 1 };
}

function setWorldTimeOfDay(value) {
  const clock = worldClock();
  world.timeBase = clock.time;
  world.clockStart = Date.now();
  world.timeOfDayBase = ((value % 1) + 1) % 1;
  simulationWorld.timeOfDay = world.timeOfDayBase;
  scheduleSave();
}

function saveWorldNow() {
  if (world.saveTimer) clearTimeout(world.saveTimer);
  world.saveTimer = null;
  if (!world.dirty && fs.existsSync(WORLD_FILE)) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const hadWorldFile = fs.existsSync(WORLD_FILE);
  const clock = worldClock();
  const payload = JSON.stringify({
    v: 2,
    seed: world.seed,
    time: clock.time,
    timeOfDay: clock.timeOfDay,
    weather: world.weather,
    weatherTimer: world.weatherTimer,
    difficulty: world.difficulty,
    dragonDefeated: !!world.dragonDefeated,
    spawnedVillages: Array.from(world.spawnedVillages),
    rngState: simulationWorld.getRngState(),
    edits: Array.from(world.edits.values()),
    profiles: Array.from(world.profiles.values()),
    containers: Array.from(world.containers.values()),
    signs: Array.from(world.signs.values()),
    entities: Array.from(entities.values()).filter(entity => entity.type === 'mob' || entity.type === 'item').map(publicEntity),
    bans: { keys: Array.from(world.bans.keys), names: Array.from(world.bans.names) },
    whitelist: { enabled: whitelistEnabled, names: Array.from(WHITELIST) },
    updatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(TEMP_WORLD_FILE, payload);
  try {
    const fd = fs.openSync(TEMP_WORLD_FILE, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (hadWorldFile && !world.recovered) fs.copyFileSync(WORLD_FILE, BACKUP_FILE);
    fs.renameSync(TEMP_WORLD_FILE, WORLD_FILE);
    if (!hadWorldFile && !fs.existsSync(BACKUP_FILE)) fs.copyFileSync(WORLD_FILE, BACKUP_FILE);
  } catch (error) {
    try { if (fs.existsSync(TEMP_WORLD_FILE)) fs.unlinkSync(TEMP_WORLD_FILE); } catch (cleanupError) { /* best effort */ }
    throw error;
  }
  world.recovered = false;
  world.dirty = false;
}

function scheduleSave() {
  world.dirty = true;
  if (!world.saveTimer) world.saveTimer = setTimeout(saveWorldNow, SAVE_DEBOUNCE_MS);
}

function permissionsFor(profile) { return ROLE_PERMISSIONS[profile.role] || []; }
function hasPermission(player, permission) {
  const permissions = permissionsFor(player.profile);
  return permissions.includes('*') || permissions.includes(permission);
}

function uniqueName(value, ownId) {
  const base = safeName(value);
  const used = new Set(Array.from(players.values()).filter(player => player.id !== ownId).map(player => player.name.toLocaleLowerCase()));
  if (!used.has(base.toLocaleLowerCase())) return base;
  for (let number = 2; number <= MAX_PLAYERS + 1; number++) {
    const suffix = '#' + number;
    const stem = Array.from(base).slice(0, Math.max(1, 16 - suffix.length)).join('');
    const candidate = stem + suffix;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return 'Steve#' + crypto.randomBytes(2).toString('hex');
}

function heldStack(player) {
  return player.profile.inv[clampInt(player.profile.hotbar, 0, 8, 0)] || null;
}

function shieldStack(player) {
  const offhand = player.profile.offhand;
  const offhandItem = offhand ? Registry.Items.get(offhand.id) : null;
  if (offhandItem && offhandItem.shield) return { hand:'offhand', stack:offhand };
  const held = heldStack(player);
  const heldItem = held ? Registry.Items.get(held.id) : null;
  return heldItem && heldItem.shield ? { hand:'main', stack:held } : null;
}

function mainHandConsumesUse(player) {
  const stack = heldStack(player);
  const item = stack ? Registry.Items.get(stack.id) : null;
  if (!item || item.shield) return false;
  return !!(item.bow || item.food || item.fishing || item.block || item.throwable ||
    item.bucket || item.bottle || item.ignite || item.bonemeal || item.plant ||
    item.minecart || item.enderEye || (item.tool && item.tool.type === 'hoe'));
}

function playerHasShield(player) {
  return !!shieldStack(player);
}

function playerCanRaiseShield(player) {
  return playerHasShield(player) && !mainHandConsumesUse(player);
}

function playerIsBlocking(player) {
  return !!(player && player.blocking && !player.profile.dead && Date.now() >= (player.shieldDisabledUntil || 0) && playerCanRaiseShield(player));
}

function shieldFacesDamage(player, knockback) {
  if (!playerIsBlocking(player)) return false;
  if (!knockback) return true;
  const x = Number(knockback.x) || 0, z = Number(knockback.z) || 0;
  const length = Math.hypot(x, z);
  if (length < 1e-5) return true;
  const forwardX = Math.sin(player.yaw), forwardZ = -Math.cos(player.yaw);
  return forwardX * (-x / length) + forwardZ * (-z / length) >= Math.cos(50 * Math.PI / 180);
}

function armorStats(profile) {
  let points = 0, toughness = 0, protection = 0;
  for (const stack of profile.equipment) {
    const item = stack ? Registry.Items.get(stack.id) : null;
    if (!item || !item.armor) continue;
    points += item.armor.points;
    toughness += item.armor.toughness || 0;
    protection += stack.ench && stack.ench.protection ? stack.ench.protection : 0;
  }
  return { points:Math.min(20, points), toughness, protection:Math.min(20, protection) };
}

function publicPlayer(player) {
  const profile = player.profile;
  const held = heldStack(player);
  return {
    id: player.id, name: player.name,
    x: player.x, y: player.y, z: player.z,
    vx: player.vx || 0, vy: player.vy || 0, vz: player.vz || 0,
    yaw: player.yaw, pitch: player.pitch,
    speed: player.speed, action: player.action, actionPhase: player.actionPhase,
    onGround: player.onGround, sneaking: player.sneaking, sprinting: player.sprinting,
    riding: player.riding === 'minecart' ? 'minecart' : null,
    blocking: playerIsBlocking(player),
    held: held ? held.id : 0, offhand: profile.offhand ? profile.offhand.id : 0,
    mode: profile.mode, hp: profile.hp,
    skin: safeSkin(player.skin), modelType: safeModelType(player.modelType),
    equipment: profile.equipment.map(stack => stack ? { id: stack.id, enchanted: !!stack.ench } : null),
    dead: profile.dead, role: profile.role,
    latency: Math.round(player.latency || player.clientLatency || 0),
  };
}

function profileForClient(profile) {
  return {
    x: profile.x, y: profile.y, z: profile.z, yaw: profile.yaw, pitch: profile.pitch,
    hp: profile.hp, hunger: profile.hunger, saturation: profile.saturation, air: profile.air,
    mode: profile.mode, hotbar: profile.hotbar,
    inventoryRevision: profile.inventoryRevision || 0,
    inv: profile.inv, equipment: profile.equipment, offhand: profile.offhand,
    cursor: profile.cursor, spawn: profile.spawn,
    xpLevel: profile.xpLevel, xpProgress: profile.xpProgress,
    statusEffects: profile.statusEffects, dead: profile.dead,
    stats: profile.stats, advancements: profile.advancements,
  };
}

function sendJSON(socket, value) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function broadcast(value, except) {
  const data = JSON.stringify(value);
  for (const socket of wss.clients) {
    if (socket !== except && socket.readyState === WebSocket.OPEN && socket.player) socket.send(data);
  }
}

function broadcastSnapshot(value) {
  const data = JSON.stringify(value);
  for (const socket of wss.clients) {
    if (socket.readyState !== WebSocket.OPEN || !socket.player) continue;
    if ((socket.bufferedAmount || 0) > SNAPSHOT_BACKPRESSURE) {
      socket.skippedSnapshots = (socket.skippedSnapshots || 0) + 1;
      continue;
    }
    socket.send(data);
  }
}

function sendProfile(player, reason, transaction) {
  const packet = {
    t: 'profile', reason: reason || 'sync', profile: profileForClient(player.profile),
    role: player.profile.role, permissions: permissionsFor(player.profile),
  };
  if (Number.isInteger(transaction) && transaction > 0) packet.transaction = transaction;
  sendJSON(player.socket, packet);
}

function lockInventory(player, duration) {
  player.inventoryLockUntil = Math.max(player.inventoryLockUntil || 0, Date.now() + (duration || 500));
}

function bumpInventory(player) {
  player.profile.inventoryRevision = ((player.profile.inventoryRevision || 0) + 1) & 0x7fffffff;
  return player.profile.inventoryRevision;
}

function finishInventoryDrop(player, socket, dropped) {
  const yaw = player.yaw, pitch = player.pitch;
  const direction = [Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  spawnItemEntity(player.x + direction[0] * 0.8, player.y + 1.3, player.z + direction[2] * 0.8, dropped,
    direction[0] * 5, direction[1] * 5 + 2, direction[2] * 5);
  if (!playerHasShield(player)) player.blocking = false;
  bumpInventory(player);
  sendProfile(player, 'drop');
  scheduleSave();
  broadcast({ t: 'player_action', player: publicPlayer(player) }, socket);
  lockInventory(player);
}

function chatSystem(text, target) {
  const packet = { t: 'chat', kind: 'system', text: safeText(text, 240), at: Date.now() };
  if (target) sendJSON(target.socket || target, packet);
  else broadcast(packet);
}

function chatPlayer(player, text) {
  broadcast({ t: 'chat', kind: 'player', name: player.name, text: safeText(text, 160), at: Date.now() });
}

function findPlayer(query) {
  if (!String(query || '').trim()) return null;
  const wanted = safeName(query).toLocaleLowerCase();
  let partial = null;
  for (const player of players.values()) {
    const name = player.name.toLocaleLowerCase();
    if (name === wanted || player.id === query) return player;
    if (!partial && name.startsWith(wanted)) partial = player;
  }
  return partial;
}

function resolveItem(query) {
  const numeric = Number(query);
  if (Number.isInteger(numeric) && Registry.Items.get(numeric)) return numeric;
  return itemAliases.get(aliasKey(query));
}

function stackCompatible(a, b) {
  return !!(a && b && a.id === b.id && a.dur === b.dur && !a.ench && !b.ench && !a.name && !b.name);
}

function addStack(profile, rawStack) {
  const stack = cleanStack(rawStack);
  if (!stack) return 0;
  let left = stack.n;
  const max = Registry.Items.maxStack(stack.id);
  if (stack.dur === undefined && !stack.ench && !stack.name) {
    for (const target of profile.inv) {
      if (!target || !stackCompatible(stack, target) || target.n >= max) continue;
      const amount = Math.min(left, max - target.n);
      target.n += amount; left -= amount;
      if (left <= 0) return 0;
    }
  }
  for (let index = 0; index < profile.inv.length && left > 0; index++) {
    if (profile.inv[index]) continue;
    profile.inv[index] = cloneStack(stack, Math.min(left, max));
    left -= profile.inv[index].n;
  }
  return left;
}

function removeItem(profile, id, count) {
  let left = count;
  for (let index = 0; index < profile.inv.length && left > 0; index++) {
    const stack = profile.inv[index];
    if (!stack || stack.id !== id) continue;
    const amount = Math.min(stack.n, left);
    stack.n -= amount; left -= amount;
    if (stack.n <= 0) profile.inv[index] = null;
  }
  return left === 0;
}

function itemCount(profile, id) {
  let total = 0;
  for (const stack of profile.inv || []) if (stack && stack.id === id) total += stack.n;
  return total;
}

function damageHeld(player, amount) {
  const index = player.profile.hotbar;
  const stack = player.profile.inv[index];
  if (!stack || stack.dur === undefined) return;
  let damage = 0;
  const attempts = Math.max(1, amount || 1);
  const unbreaking = stack.ench && stack.ench.unbreaking ? stack.ench.unbreaking : 0;
  for (let index = 0; index < attempts; index++) {
    if (!unbreaking || simulationWorld.random() < 1 / (unbreaking + 1)) damage++;
  }
  stack.dur -= damage;
  if (stack.dur <= 0) player.profile.inv[index] = null;
}

function damageShield(player, amount) {
  const shield = shieldStack(player);
  const stack = shield && shield.stack;
  if (!stack || stack.dur === undefined) return;
  let damage = 0;
  const attempts = Math.max(1, amount || 1);
  const unbreaking = stack.ench && stack.ench.unbreaking ? stack.ench.unbreaking : 0;
  for (let index = 0; index < attempts; index++) {
    if (!unbreaking || simulationWorld.random() < 1 / (unbreaking + 1)) damage++;
  }
  stack.dur -= damage;
  if (stack.dur <= 0) {
    if (shield.hand === 'offhand') player.profile.offhand = null;
    else player.profile.inv[player.profile.hotbar] = null;
    player.blocking = false;
  }
}

function consumeHeld(player, amount) {
  const index = player.profile.hotbar;
  const stack = player.profile.inv[index];
  amount = Math.max(1, amount || 1);
  if (!stack || stack.n < amount) return false;
  stack.n -= amount;
  if (stack.n <= 0) player.profile.inv[index] = null;
  return true;
}

function replaceOneHeld(player, replacementId) {
  const index = player.profile.hotbar;
  const stack = player.profile.inv[index];
  if (!stack) return false;
  stack.n--;
  if (stack.n <= 0) player.profile.inv[index] = { id: replacementId, n: 1 };
  else {
    const left = addStack(player.profile, { id: replacementId, n: 1 });
    if (left) spawnItemEntity(player.x, player.y + 1, player.z, { id: replacementId, n: left }, 0, 2, 0);
  }
  return true;
}

function weaponDamage(player) {
  const stack = heldStack(player);
  if (!stack) return 1;
  const item = Registry.Items.get(stack.id);
  let damage = item && item.tool ? item.tool.damage : 1;
  if (stack.ench && stack.ench.sharpness) damage += Vanilla.sharpnessBonus(stack.ench.sharpness);
  return profileCanCreative(player.profile) && player.profile.mode === 'creative' ? 10 : damage;
}

function weaponAttackSpeed(player) {
  const stack = heldStack(player);
  const item = stack ? Registry.Items.get(stack.id) : null;
  return item && item.tool && item.tool.attackSpeed ? item.tool.attackSpeed : 4;
}

function profileCanCreative(profile) {
  const permissions = permissionsFor(profile);
  return permissions.includes('*') || permissions.includes('gamemode.self');
}

function spawnItemEntity(x, y, z, stack, vx, vy, vz) {
  const clean = cleanStack(stack);
  if (!clean || entities.size >= 256) return null;
  const entity = {
    id: 'e' + nextEntityId++, type: 'item', x, y, z,
    vx: Number(vx) || 0, vy: Number(vy) || 0, vz: Number(vz) || 0,
    w: 0.25, h: 0.25, onGround: false,
    stack: clean, age: 0,
  };
  entities.set(entity.id, entity);
  return entity;
}

function spawnXPEntity(x, y, z, value) {
  value = clampInt(value, 1, 100, 1);
  if (entities.size >= 256) return null;
  const entity = {
    id: 'e' + nextEntityId++, type: 'xp', x, y, z,
    vx: (Math.random() - 0.5) * 1.6, vy: 2 + Math.random(), vz: (Math.random() - 0.5) * 1.6,
    value, age: 0,
  };
  entities.set(entity.id, entity);
  return entity;
}

function addXP(profile, points) {
  let value = Math.max(0, Number(points) || 0);
  while (value > 0) {
    const need = 7 + profile.xpLevel * 2;
    const remaining = (1 - profile.xpProgress) * need;
    if (value < remaining) {
      profile.xpProgress = clamp(profile.xpProgress + value / need, 0, 1);
      break;
    }
    value -= remaining;
    profile.xpLevel = Math.min(10000, profile.xpLevel + 1);
    profile.xpProgress = 0;
    if (profile.xpLevel >= 10000) break;
  }
}

function addPlayerStat(player, name, amount) {
  if (!player || !player.profile || !player.profile.stats || !(name in player.profile.stats)) return false;
  const previous = Number(player.profile.stats[name]) || 0;
  const next = clamp(previous + (Number(amount) || 0), 0, 1000000000);
  if (next === previous) return false;
  player.profile.stats[name] = next;
  return true;
}

function unlockPlayerAdvancement(player, id) {
  if (!player || !player.profile || !player.profile.advancements || player.profile.advancements[id]) return false;
  player.profile.advancements[id] = Date.now();
  return true;
}

function spawnMobEntity(kind, x, y, z, babyTime) {
  const stats = MOB_STATS[kind];
  if (!stats || entities.size >= 256) return null;
  babyTime = Math.max(0, Number(babyTime) || 0);
  const scale = babyTime > 0 ? 0.55 : 1;
  const entity = {
    id: 'e' + nextEntityId++, type: 'mob', kind, x, y, z,
    vx: 0, vy: 0, vz: 0, yaw: Math.random() * Math.PI * 2,
    w: stats.w * scale, h: stats.h * scale, onGround: false,
    hp: stats.hp, maxHp: stats.hp, speed: stats.speed,
    age: 0, attackCooldown: 0, fuse: kind === 'creeper' ? -1 : undefined,
    fireTime: 0, fireDamageClock: 0, burning: false,
    aiMode: 'idle', aiTimer: 1 + Math.random() * 3, dirX: 0, dirZ: 0,
    goalType: 'idle', navPath: null, navPathIndex: 0, navGoalKey: '', navRepathAt: 0,
    targetPlayerId: null, targetMemoryUntil: 0, lastSeenX: x, lastSeenY: y, lastSeenZ: z,
    babyTime, loveUntil: 0, breedCooldownUntil: 0,
    provokedUntil: 0, tamedBy: null, small: false,
    villageId: null, profession: 'unemployed', home: null, jobSite: null, meeting: null,
    tradeLevel: 1, tradeUses: 0, restockAt: 0,
  };
  entities.set(entity.id, entity);
  return entity;
}

function configureVillageMobEntity(entity, plan, resident) {
  if (!entity || !plan) return entity;
  entity.villageId = plan.id;
  entity.meeting = cleanVillagePoint(plan.meeting);
  if (resident) {
    entity.home = cleanVillagePoint(resident.home);
    entity.jobSite = cleanVillagePoint(resident.job);
    entity.profession = VILLAGER_TRADES[resident.profession] ? resident.profession : 'unemployed';
    entity.tradeLevel = 1;
    entity.tradeUses = 0;
    entity.restockAt = 0;
  }
  return entity;
}

function villagerTradeOffer(entity) {
  if (!entity || entity.kind !== 'villager') return null;
  const offer = VILLAGER_TRADES[entity.profession] || VILLAGER_TRADES.unemployed;
  return (entity.tradeUses || 0) < offer.uses ? offer : null;
}

function spawnVillagePopulationsServer() {
  if (!simulationWorld.takeVillagePopulations) return;
  let changed = false;
  for (const plan of simulationWorld.takeVillagePopulations()) {
    for (const resident of plan.residents) {
      configureVillageMobEntity(spawnMobEntity('villager', resident.x, resident.y, resident.z), plan, resident);
    }
    if (plan.residents.length >= 4) {
      configureVillageMobEntity(spawnMobEntity('iron_golem', plan.x + 0.5, plan.y + 1, plan.z + 6.5), plan, null);
    }
    configureVillageMobEntity(spawnMobEntity('cat', plan.x - 3.5, plan.y + 1, plan.z + 2.5), plan, null);
    changed = true;
  }
  if (changed) scheduleSave();
}

function spawnArrowEntity(player, direction, charge) {
  const draw = clamp((charge * charge + charge * 2) / 3, 0, 1);
  const velocity = 8 + draw * 22;
  const held = heldStack(player);
  const power = held && held.ench && held.ench.power ? held.ench.power : 0;
  const entity = {
    id: 'e' + nextEntityId++, type: 'arrow', owner: player.id,
    x: player.x + direction[0] * 0.55, y: player.y + 1.5 + direction[1] * 0.55, z: player.z + direction[2] * 0.55,
    vx: direction[0] * velocity, vy: direction[1] * velocity, vz: direction[2] * velocity,
    damage: (2 + draw * 4) * (1 + power * 0.25), age: 0,
  };
  entities.set(entity.id, entity);
  return entity;
}

function spawnEggEntity(player, direction) {
  if (entities.size >= 256) return null;
  const speed = 18;
  const entity = {
    id: 'e' + nextEntityId++, type: 'egg', owner: player.id,
    x: player.x + direction[0] * 0.55,
    y: player.y + 1.5 + direction[1] * 0.55,
    z: player.z + direction[2] * 0.55,
    vx: direction[0] * speed, vy: direction[1] * speed, vz: direction[2] * speed,
    w: 0.18, h: 0.18, age: 0,
  };
  entities.set(entity.id, entity);
  return entity;
}

function spawnEnderPearlEntity(player, direction) {
  if (entities.size >= 256) return null;
  const speed = 18;
  const entity = {
    id: 'e' + nextEntityId++, type: 'ender_pearl', owner: player.id,
    x: player.x + direction[0] * 0.55,
    y: player.y + 1.5 + direction[1] * 0.55,
    z: player.z + direction[2] * 0.55,
    vx: direction[0] * speed, vy: direction[1] * speed, vz: direction[2] * speed,
    w: 0.18, h: 0.18, age: 0,
  };
  entities.set(entity.id, entity);
  return entity;
}

function publicEntity(entity) {
  const out = {
    id: entity.id, type: entity.type, kind: entity.kind,
    x: entity.x, y: entity.y, z: entity.z,
    vx: entity.vx || 0, vy: entity.vy || 0, vz: entity.vz || 0,
    onGround: !!entity.onGround,
    yaw: entity.yaw || 0, age: entity.age || 0, hp: entity.hp,
    fuse: entity.fuse,
    babyTime: entity.babyTime || 0,
    embeddedArrows: Math.max(0, Math.min(4, entity.embeddedArrows | 0)),
    burning: !!entity.burning,
    damage: entity.damage, owner: entity.owner, ownerKind: entity.ownerKind,
    stuck: !!entity.stuck,
    value: entity.value,
    tamed: !!entity.tamedBy,
    small: !!entity.small,
    villageId: entity.villageId || undefined,
    profession: entity.profession || undefined,
    home: entity.home || undefined,
    jobSite: entity.jobSite || undefined,
    meeting: entity.meeting || undefined,
    tradeLevel: entity.tradeLevel || undefined,
    tradeUses: entity.tradeUses || 0,
    restockAt: entity.restockAt || 0,
    sleeping: !!entity.sleeping,
  };
  if (entity.type === 'arrow') out.itemId = Registry.Items.IT.ARROW;
  else if (entity.type === 'egg') out.itemId = Registry.Items.IT.EGG;
  else if (entity.type === 'ender_pearl') out.itemId = Registry.Items.IT.ENDER_PEARL;
  if (entity.stack) {
    out.itemId = entity.stack.id; out.count = entity.stack.n;
    out.dur = entity.stack.dur; out.ench = entity.stack.ench; out.name = entity.stack.name;
  }
  return out;
}

function damageArmor(profile, amount) {
  const loss = Math.max(1, Math.ceil(amount / 4));
  for (let index = 0; index < profile.equipment.length; index++) {
    const stack = profile.equipment[index];
    if (!stack || stack.dur === undefined) continue;
    stack.dur -= loss;
    if (stack.dur <= 0) profile.equipment[index] = null;
  }
}

function killPlayer(player, cause, attackerName) {
  const profile = player.profile;
  if (profile.dead) return;
  if (player.ridingConsumed) addStack(profile, { id: Registry.Items.IT.MINECART, n: 1 });
  player.riding = null; player.ridingConsumed = false;
  profile.dead = true;
  player.blocking = false;
  profile.hp = 0;
  player.healthLockUntil = Date.now() + 1000;
  for (const stack of profile.inv) if (stack) spawnItemEntity(player.x, player.y + 0.8, player.z, stack, (Math.random() - 0.5) * 3, 3, (Math.random() - 0.5) * 3);
  for (const stack of profile.equipment) if (stack) spawnItemEntity(player.x, player.y + 0.8, player.z, stack, (Math.random() - 0.5) * 3, 3, (Math.random() - 0.5) * 3);
  if (profile.offhand) spawnItemEntity(player.x, player.y + 0.8, player.z, profile.offhand, (Math.random() - 0.5) * 3, 3, (Math.random() - 0.5) * 3);
  if (profile.cursor) spawnItemEntity(player.x, player.y + 0.8, player.z, profile.cursor, 0, 3, 0);
  profile.inv = Array(36).fill(null);
  profile.equipment = Array(4).fill(null);
  profile.offhand = null;
  profile.cursor = null;
  bumpInventory(player);
  lockInventory(player, 1000);
  const message = attackerName ? player.name + ' 被 ' + attackerName + ' 击败了' : player.name + ' 死了（' + safeText(cause, 32) + '）';
  chatSystem(message);
  sendProfile(player, 'death');
  scheduleSave();
}

function registerPlayerKnockback(player, knockback, now) {
  if (!knockback) return;
  const vertical = Math.max(0, Number(knockback.y) || 0);
  const horizontal = Math.hypot(Number(knockback.x) || 0, Number(knockback.z) || 0);
  if (vertical <= 0 && horizontal <= 0) return;
  player.airborneSince = now;
  player.lastGroundY = player.y;
  player.knockbackUntil = now + clamp(650 + vertical * 140, 650, 1800);
  player.knockbackPeak = player.y + vertical * vertical / 52 + 0.35;
  player.fallRecoveryUntil = 0;
}

function damagePlayer(player, rawDamage, cause, attackerName, knockback, options) {
  const profile = player.profile;
  if (profile.dead || profile.mode === 'creative' || Date.now() < (player.hurtUntil || 0)) return false;
  options = options || {};
  let shieldDisabled = 0;
  let blocking = shieldFacesDamage(player, knockback) &&
    (cause === 'mob' || cause === 'arrow' || cause === 'player' || cause === 'explode');
  if (blocking && options.disableShield) {
    player.shieldDisabledUntil = Date.now() + 5000;
    player.blocking = false;
    blocking = false;
    shieldDisabled = 5;
    sendJSON(player.socket, { t: 'sound', name: 'combat.block', volume: 0.8, pitch: 0.65 });
  }
  if (blocking) {
    if (rawDamage >= 3) damageShield(player, 1 + Math.floor(rawDamage));
    rawDamage = 0;
  }
  if (blocking && knockback) knockback = { x: (knockback.x || 0) * 0.2, y: (knockback.y || 0) * 0.2, z: (knockback.z || 0) * 0.2 };
  const armorApplies = cause === 'mob' || cause === 'arrow' || cause === 'player' || cause === 'explode' ||
    cause === 'cactus' || cause === 'lava' || cause === 'fire';
  let damage = Math.max(0, rawDamage);
  if (!blocking && armorApplies) {
    const armor = armorStats(profile);
    damage = Vanilla.applyProtection(Vanilla.applyArmor(damage, armor.points, armor.toughness), armor.protection);
  }
  if (damage > 0) damage = Math.max(0.01, Math.round(damage * 100) / 100);
  const now = Date.now();
  profile.hp = Math.max(0, profile.hp - damage);
  player.healthLockUntil = now + 750;
  if (!blocking && armorApplies) damageArmor(profile, rawDamage);
  bumpInventory(player);
  player.hurtUntil = now + 500;
  registerPlayerKnockback(player, knockback, now);
  const combat = { t:'combat', damage, hp:profile.hp, cause, blocked:blocking, knockback:knockback || null };
  if (shieldDisabled) combat.shieldDisabled = shieldDisabled;
  sendJSON(player.socket, combat);
  if (profile.hp <= 0) killPlayer(player, cause, attackerName);
  else sendProfile(player, 'damage');
  return true;
}

function mobDrops(kind) {
  const IT = Registry.Items.IT, ID = Registry.Blocks.ID;
  const table = {
    pig: [[IT.PORK_RAW, 1, 2]], cow: [[IT.BEEF_RAW, 1, 2], [IT.LEATHER, 0, 2]],
    rabbit: [], horse: [[IT.LEATHER, 0, 2]],
    sheep: [[IT.MUTTON_RAW, 1, 1], [ID.WOOL, 1, 1]], chicken: [[IT.CHICKEN_RAW, 1, 1], [IT.FEATHER, 0, 2]],
    zombie: [[IT.FLESH, 0, 2]], skeleton: [[IT.BONE, 0, 2], [IT.ARROW, 0, 2]],
    spider: [[IT.STRING, 0, 2]], creeper: [[IT.GUNPOWDER, 1, 2]],
    slime: [[IT.SLIME_BALL, 0, 2]], enderman: [[IT.ENDER_PEARL, 0, 1]],
    blaze: [[IT.BLAZE_ROD, 0, 1]],
  }[kind] || [];
  return table.map(([id, min, max]) => ({ id, n: min + Math.floor(Math.random() * (max - min + 1)) })).filter(stack => stack.n > 0);
}

function killMob(entity, attacker) {
  entities.delete(entity.id);
  for (const stack of mobDrops(entity.kind)) spawnItemEntity(entity.x, entity.y + 0.3, entity.z, stack, (Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2);
  if (attacker) {
    spawnXPEntity(entity.x, entity.y + Math.max(0.4, entity.h * 0.5), entity.z, HOSTILE_MOBS.has(entity.kind) ? 5 : 1);
    const statsChanged = addPlayerStat(attacker, 'mobsKilled', 1);
    const advancementChanged = HOSTILE_MOBS.has(entity.kind) && unlockPlayerAdvancement(attacker, 'kill_mob');
    if (statsChanged || advancementChanged) sendProfile(attacker, 'stats');
  }
  if (entity.kind === 'slime' && !entity.small) {
    for (let index = 0; index < 2; index++) {
      const child = spawnMobEntity('slime', entity.x + (index ? 0.35 : -0.35), entity.y, entity.z, 9999);
      if (!child) continue;
      child.small = true; child.hp = child.maxHp = 4;
    }
  }
  if (entity.kind === 'ender_dragon') {
    world.dragonDefeated = true;
    const cx = Registry.World.END_OFFSET + 8, cy = 63, cz = 8;
    simulationWorld.ensureChunk(cx >> 4, cz >> 4);
    simulationWorld.beginBatch();
    try {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) simulationWorld.setBlock(cx + dx, cy, cz + dz, Registry.Blocks.ID.END_PORTAL);
      simulationWorld.setBlock(cx, cy + 1, cz, Registry.Blocks.ID.DRAGON_EGG);
    } finally { simulationWorld.endBatch(); }
    for (let index = 0; index < 20; index++) spawnXPEntity(entity.x, entity.y + 1, entity.z, 25);
    scheduleSave();
  }
}

function validReach(player, target, maxDistance) {
  const dx = Number(target.x) + 0.5 - player.x;
  const dy = Number(target.y) + 0.5 - (player.y + 1);
  const dz = Number(target.z) + 0.5 - player.z;
  return dx * dx + dy * dy + dz * dz <= maxDistance * maxDistance;
}

function validEntityReach(player, target, maxDistance) {
  const half = (Number(target.w) || 0.6) / 2;
  const height = Number(target.h) || 1.8;
  const eyeX = player.x, eyeY = player.y + 1.62, eyeZ = player.z;
  const minX = Number(target.x) - half, maxX = Number(target.x) + half;
  const minY = Number(target.y), maxY = Number(target.y) + height;
  const minZ = Number(target.z) - half, maxZ = Number(target.z) + half;
  const dx = eyeX < minX ? minX - eyeX : eyeX > maxX ? eyeX - maxX : 0;
  const dy = eyeY < minY ? minY - eyeY : eyeY > maxY ? eyeY - maxY : 0;
  const dz = eyeZ < minZ ? minZ - eyeZ : eyeZ > maxZ ? eyeZ - maxZ : 0;
  return dx * dx + dy * dy + dz * dz <= maxDistance * maxDistance;
}

function validMeleeTarget(player, target, message) {
  const delay = clamp(Math.max(player.latency || 0, player.clientLatency || 0, Number(message.latency) || 0), 0, 500);
  const reach = 3.15 + Math.min(0.85, delay * 0.0025);
  if (validEntityReach(player, target, reach)) return true;

  const reported = [Number(message.targetX), Number(message.targetY), Number(message.targetZ)];
  if (!reported.every(Number.isFinite)) return false;
  const displacement = Math.hypot(reported[0] - target.x, reported[1] - target.y, reported[2] - target.z);
  const targetSpeed = Math.max(Number(target.speed) || 0, Math.hypot(target.vx || 0, target.vy || 0, target.vz || 0));
  const maxRewind = Math.min(1.5, 0.35 + targetSpeed * (delay / 1000 + 0.15));
  if (displacement > maxRewind) return false;
  return validEntityReach(player, {
    x: reported[0], y: reported[1], z: reported[2], w: target.w, h: target.h,
  }, 3.25);
}

function resetPlayerMovementState(player, target) {
  if (player.ridingConsumed) {
    addStack(player.profile, { id: Registry.Items.IT.MINECART, n: 1 });
    bumpInventory(player);
    lockInventory(player);
  }
  player.ridingConsumed = false;
  const probe = {
    x: Number.isFinite(+target.x) ? +target.x : player.x,
    y: Number.isFinite(+target.y) ? +target.y : player.y,
    z: Number.isFinite(+target.z) ? +target.z : player.z,
    w: 0.6, h: 1.8, vx: 0, vy: 0, vz: 0, onGround: false,
  };
  const settle = () => {
    simulationWorld.ensureChunk(Math.floor(probe.x) >> 4, Math.floor(probe.z) >> 4);
    Registry.Physics.resolvePenetration(simulationWorld, probe, 4);
    let supported = Registry.Physics.supportCount(simulationWorld, probe, probe.x, probe.y, probe.z) > 0;
    for (let drop = 0.25; !supported && drop <= 64; drop += 0.25) {
      const y = probe.y - drop;
      if (!Registry.Physics.canOccupy(simulationWorld, probe, probe.x, y, probe.z)) continue;
      if (Registry.Physics.supportCount(simulationWorld, probe, probe.x, y, probe.z) <= 0) continue;
      probe.y = y;
      supported = true;
    }
    if (!supported) return false;
    const bx = Math.floor(probe.x), by = Math.floor(probe.y), bz = Math.floor(probe.z);
    const feet = simulationWorld.getBlock(bx, by, bz);
    const head = simulationWorld.getBlock(bx, Math.floor(probe.y + 1.62), bz);
    return feet !== Registry.Blocks.ID.WATER && feet !== Registry.Blocks.ID.LAVA &&
      head !== Registry.Blocks.ID.WATER && head !== Registry.Blocks.ID.LAVA;
  };
  let grounded = settle();
  if (!grounded) {
    const fallback = simulationWorld.findSpawn();
    probe.x = fallback.x; probe.y = fallback.y; probe.z = fallback.z;
    probe.vx = probe.vy = probe.vz = 0;
    grounded = settle();
  }
  const now = Date.now();

  player.x = probe.x; player.y = probe.y; player.z = probe.z;
  player.vx = player.vy = player.vz = 0;
  player.speed = 0;
  player.action = 'idle'; player.actionPhase = 0;
  player.onGround = grounded; player.serverGrounded = grounded;
  player.sneaking = false; player.sprinting = false; player.blocking = false;
  player.riding = null;
  player.sleeping = false;
  player.mining = null;
  player.airborneSince = 0;
  player.lastGroundY = player.y;
  player.knockbackUntil = 0;
  player.knockbackPeak = null;
  player.fallRecoveryUntil = 0;
  player.ignoreStateUntil = now + 300;
  player.hasState = false;
  player.hurtUntil = 0;
  player.healthLockUntil = 0;
  player.lastSeen = now;
  player.profile.x = player.x; player.profile.y = player.y; player.profile.z = player.z;
  player.profile.lastSeen = now;
  return player;
}

function validateSurvivalPosition(player, x, y, z, now) {
  const probe = { x, y, z, w: 0.6, h: 1.8, vx: 0, vy: 0, vz: 0, onGround: false };
  const dx = x - player.x, dy = y - player.y, dz = z - player.z;
  const distance = Math.hypot(dx, dy, dz);
  const steps = Math.max(1, Math.ceil(distance / 0.25));
  for (let step = player.hasState ? 1 : steps; step <= steps; step++) {
    const t = step / steps;
    const sx = player.x + dx * t, sy = player.y + dy * t, sz = player.z + dz * t;
    simulationWorld.ensureChunk(Math.floor(sx) >> 4, Math.floor(sz) >> 4);
    if (!Registry.Physics.canOccupy(simulationWorld, probe, sx, sy, sz)) {
      return { valid: false, grounded: false, reason: 'block_collision' };
    }
  }
  probe.x = x; probe.y = y; probe.z = z;
  const inLiquid = Registry.Physics.isInLiquid(simulationWorld, probe, 'water') ||
    Registry.Physics.isInLiquid(simulationWorld, probe, 'lava');
  const grounded = Registry.Physics.supportCount(simulationWorld, probe, x, y, z) > 0;
  if (grounded || inLiquid) {
    player.airborneSince = 0;
    player.lastGroundY = y;
    player.knockbackUntil = 0;
    player.knockbackPeak = null;
    player.fallRecoveryUntil = 0;
    return { valid: true, grounded };
  }
  if (now < (player.fallRecoveryUntil || 0) && y <= player.y + 0.08) {
    return { valid: true, grounded: false };
  }
  if (!player.airborneSince) {
    player.airborneSince = now;
    player.lastGroundY = Number.isFinite(player.lastGroundY) ? player.lastGroundY : player.y;
  }
  const airborne = Math.max(0, (now - player.airborneSince) / 1000);
  let peak = player.lastGroundY + 1.45;
  if (now <= (player.knockbackUntil || 0) && Number.isFinite(player.knockbackPeak)) {
    peak = Math.max(peak, player.knockbackPeak);
  }
  if (y > peak + 0.2) return { valid: false, grounded: false, reason: 'height' };
  if (airborne > 1.25) {
    const fallingTime = airborne - 0.55;
    const maximumY = peak - 4.2 * fallingTime * fallingTime + 0.9;
    if (y > maximumY) return { valid: false, grounded: false, reason: 'airtime' };
  }
  return { valid: true, grounded: false };
}

function handleState(socket, message) {
  const player = socket.player;
  if (!player || player.profile.dead) return;
  const oldHotbar = player.profile.hotbar;
  const values = [message.x, message.y, message.z, message.yaw, message.pitch];
  if (!values.every(Number.isFinite)) return;
  const now = Date.now();
  if (now < (player.ignoreStateUntil || 0)) return;
  const elapsed = Math.max(0.05, (now - player.lastSeen) / 1000);
  let nx = clamp(message.x, -1000000, 1000000);
  let ny = clamp(message.y, -64, 320);
  let nz = clamp(message.z, -1000000, 1000000);
  if (player.sleeping && Math.hypot(nx - player.sleepX, ny - player.sleepY, nz - player.sleepZ) > 0.25) player.sleeping = false;
  if (player.profile.mode !== 'creative') {
    const dx = nx - player.x, dy = ny - player.y, dz = nz - player.z;
    const distance = Math.hypot(dx, dy, dz);
    const maximum = player.hasState ? Math.max(1.1, elapsed * 14 + 0.35) : 32;
    if (distance > maximum) {
      const scale = maximum / distance;
      nx = player.x + dx * scale; ny = player.y + dy * scale; nz = player.z + dz * scale;
      sendJSON(socket, { t: 'position', x: nx, y: ny, z: nz, reason: 'movement_limit' });
    }
    const movement = validateSurvivalPosition(player, nx, ny, nz, now);
    if (!movement.valid) {
      nx = player.x; ny = player.y; nz = player.z;
      sendJSON(socket, { t: 'position', x: nx, y: ny, z: nz, reason: 'movement_collision' });
      if (movement.reason === 'height' || movement.reason === 'airtime') {
        player.airborneSince = now;
        player.lastGroundY = player.y;
        player.knockbackUntil = 0;
        player.knockbackPeak = null;
        player.fallRecoveryUntil = now + 1200;
      }
    }
    player.serverGrounded = movement.valid ? movement.grounded : !!player.serverGrounded;
  }
  const walked = Math.hypot(nx - player.x, nz - player.z);
  if (walked > 0 && walked <= 2 && player.riding !== 'minecart' && (player.serverGrounded || player.onGround)) {
    addPlayerStat(player, 'distanceWalked', walked);
  }
  const velocityElapsed = Math.max(0.025, Math.min(0.25, elapsed));
  player.vx = clamp((nx - player.x) / velocityElapsed, -40, 40);
  player.vy = clamp((ny - player.y) / velocityElapsed, -40, 40);
  player.vz = clamp((nz - player.z) / velocityElapsed, -40, 40);
  player.x = nx; player.y = ny; player.z = nz;
  player.yaw = Math.atan2(Math.sin(message.yaw), Math.cos(message.yaw));
  player.pitch = clamp(message.pitch, -Math.PI / 2, Math.PI / 2);
  player.speed = clamp(message.speed, 0, player.profile.mode === 'creative' ? 30 : 12);
  player.profile.hotbar = clampInt(message.hotbar, 0, 8, player.profile.hotbar);
  player.blocking = !!message.blocking && playerCanRaiseShield(player) && Date.now() >= (player.shieldDisabledUntil || 0);
  player.action = ['idle', 'attack', 'mine', 'use', 'eat', 'bow', 'fish', 'block'].includes(message.action) ? message.action : 'idle';
  if (player.blocking && player.action === 'mine') player.action = 'block';
  if (!player.blocking && player.action === 'block') player.action = 'idle';
  player.actionPhase = clamp(message.actionPhase, 0, 1);
  player.onGround = player.profile.mode === 'creative' ? !!message.onGround : !!player.serverGrounded;
  player.sneaking = !!message.sneaking;
  player.sprinting = !!message.sprinting && !player.blocking;
  player.skin = safeSkin(message.skin || player.skin);
  player.modelType = safeModelType(message.modelType || player.modelType);
  player.clientLatency = clamp(message.latency, 0, 999);
  player.profile.x = nx; player.profile.y = ny; player.profile.z = nz;
  player.profile.yaw = player.yaw; player.profile.pitch = player.pitch;
  player.profile.lastSeen = now;
  player.lastSeen = now;
  player.hasState = true;
  if (oldHotbar !== player.profile.hotbar) broadcast({ t: 'player_action', player: publicPlayer(player) }, socket);
}

function handleProfile(socket, message) {
  const player = socket.player;
  if (!player || !message.profile || typeof message.profile !== 'object') return;
  const raw = message.profile;
  const profile = player.profile;
  const transaction = clampInt(message.transaction, 1, 2147483647, 0);
  const wasAlive = !profile.dead;
  const oldHeldId = heldStack(player) ? heldStack(player).id : 0;
  const oldOffhandId = profile.offhand ? profile.offhand.id : 0;
  const clientInventoryRevision = clampInt(raw.inventoryRevision, 0, 2147483647, -1);
  const revisionMatches = clientInventoryRevision === (profile.inventoryRevision || 0);
  const draft = cleanClientInventory(raw, profile);
  const inventoryAllowed = revisionMatches && (profile.mode === 'creative' || sameInventoryTotals(profile, draft));
  const inventoryConflict = !inventoryAllowed;
  if (inventoryAllowed) {
    profile.hotbar = draft.hotbar;
    profile.inv = draft.inv;
    profile.equipment = draft.equipment;
    profile.offhand = draft.offhand;
    profile.cursor = draft.cursor;
  } else {
    sendProfile(player, 'inventory_conflict', transaction);
  }
  const reportedHunger = clampInt(raw.hunger, 0, 20, profile.hunger);
  const reportedSaturation = clamp(raw.saturation, 0, reportedHunger);
  if (profile.mode !== 'creative') {
    profile.hunger = Math.min(profile.hunger, reportedHunger);
    profile.saturation = Math.min(profile.saturation, reportedSaturation, profile.hunger);
  } else {
    profile.hunger = reportedHunger;
    profile.saturation = reportedSaturation;
  }
  profile.air = clamp(raw.air, 0, MAX_AIR_SECONDS);
  const reportedHp = clampInt(raw.hp, 0, 20, profile.hp);
  if (Date.now() >= (player.healthLockUntil || 0)) profile.hp = Math.min(profile.hp, reportedHp);
  if (wasAlive && profile.hp <= 0) {
    profile.dead = false;
    killPlayer(player, safeText(message.cause, 32) || '环境伤害');
  }
  if (!profileCanCreative(profile)) profile.mode = 'survival';
  const newHeldId = heldStack(player) ? heldStack(player).id : 0;
  const newOffhandId = profile.offhand ? profile.offhand.id : 0;
  if (oldHeldId !== newHeldId || oldOffhandId !== newOffhandId) {
    if (!playerCanRaiseShield(player)) player.blocking = false;
    broadcast({ t: 'player_action', player: publicPlayer(player) }, socket);
  }
  world.dirty = true;
  const now = Date.now();
  if (transaction && !inventoryConflict) {
    player.lastProfileAck = now;
    sendProfile(player, 'profile_commit', transaction);
  } else if (!inventoryConflict && now - (player.lastProfileAck || 0) > 1000) {
    player.lastProfileAck = now;
    sendProfile(player, 'ack');
  }
}

function canHarvestBlock(player, id) {
  const block = Registry.Blocks.get(id);
  if (!block.needsTool) return true;
  const stack = heldStack(player);
  const item = stack ? Registry.Items.get(stack.id) : null;
  return !!(item && item.tool && item.tool.type === block.tool && item.tool.tier >= block.tier);
}

function serverBreakTime(player, id) {
  const block = Registry.Blocks.get(id);
  if (!block || block.hardness < 0) return Infinity;
  if (block.hardness === 0) return 0.05;
  const held = heldStack(player);
  const item = held ? Registry.Items.get(held.id) : null;
  const tool = item && item.tool ? item.tool : null;
  const effective = !!(tool && block.tool && tool.type === block.tool);
  let speed = effective ? tool.speed : 1;
  if (effective && held.ench && held.ench.efficiency) speed += held.ench.efficiency * held.ench.efficiency + 1;
  let seconds = block.hardness * 1.5 / speed;
  if (block.needsTool && (!effective || tool.tier < block.tier)) seconds = block.hardness * 5;
  return seconds;
}

function acceptEdits(edits, player) {
  if (!edits.length) return;
  for (const edit of edits) {
    const key = editKey(edit.x, edit.y, edit.z);
    simulationWorld.ensureChunk(edit.x >> 4, edit.z >> 4);
    const oldId = simulationWorld.getBlock(edit.x, edit.y, edit.z);
    const oldState = simulationWorld.getState(edit.x, edit.y, edit.z);
    const container = world.containers.get(key);
    const keepsContainer = (edit.id === Registry.Blocks.ID.CHEST && container && container.type === 'chest') ||
      ((edit.id === Registry.Blocks.ID.FURNACE || edit.id === Registry.Blocks.ID.FURNACE_LIT) && container && container.type === 'furnace');
    if (container && !keepsContainer) {
      for (const stack of container.slots) if (stack) spawnItemEntity(edit.x + 0.5, edit.y + 0.4, edit.z + 0.5, stack, 0, 2, 0);
      world.containers.delete(key);
    }
    const sign = world.signs.get(key);
    if (sign && edit.id !== Registry.Blocks.ID.OAK_SIGN) {
      world.signs.delete(key);
      simulationWorld.removeBE(edit.x, edit.y, edit.z);
      broadcast({ t: 'sign', x: edit.x, y: edit.y, z: edit.z, removed: true });
    }
    world.edits.set(key, edit);
    applyEditToSimulation(edit);
    if (player && player.profile.mode !== 'creative' && edit.id === 0 && oldId !== 0 && oldId !== edit.id && canHarvestBlock(player, oldId)) {
      for (const drop of Registry.Blocks.dropsFor(oldId, oldState, () => simulationWorld.random())) {
        spawnItemEntity(edit.x + 0.5, edit.y + 0.3, edit.z + 0.5, drop, 0, 2, 0);
      }
    }
  }
  scheduleSave();
  broadcast({ t: 'blocks', edits });
}

function handleBlocks(socket, message) {
  const player = socket.player;
  if (!player || player.profile.dead || playerIsBlocking(player) || !Array.isArray(message.edits)) return;
  const accepted = [];
  const acceptedByKey = new Map();
  const corrections = new Map();
  const completed = [];
  let inventoryChanged = false;
  let minedCount = 0, placedCount = 0, minedStoneAgeBlock = false;
  const rawEdits = message.edits.slice(0, 128).map(cleanEdit).filter(Boolean);
  const survival = player.profile.mode !== 'creative';
  if (survival && (!Number.isInteger(message.inventoryRevision) || message.inventoryRevision !== (player.profile.inventoryRevision || 0))) {
    for (const edit of rawEdits) {
      simulationWorld.ensureChunk(edit.x >> 4, edit.z >> 4);
      const state = simulationWorld.getState(edit.x, edit.y, edit.z);
      corrections.set(editKey(edit.x, edit.y, edit.z), {
        x: edit.x, y: edit.y, z: edit.z, id: simulationWorld.getBlock(edit.x, edit.y, edit.z),
        state: Number.isInteger(state) ? state : null,
      });
    }
    sendProfile(player, 'inventory_conflict');
    if (corrections.size) sendJSON(socket, { t: 'blocks', edits: Array.from(corrections.values()), rejected: true });
    return;
  }
  const blockAt = (x, y, z) => {
    const pending = acceptedByKey.get(editKey(x, y, z));
    return pending ? pending.id : simulationWorld.getBlock(x, y, z);
  };
  const supportValid = edit => {
    if (edit.id === 0) return true;
    const offset = Registry.Blocks.supportOffset ? Registry.Blocks.supportOffset(edit.id, edit.state || 0) : null;
    if (!offset) return true;
    return Registry.Blocks.isSolid(blockAt(edit.x + offset[0], edit.y + offset[1], edit.z + offset[2]));
  };
  const collidesWithPlayer = edit => {
    const def = Registry.Blocks.get(edit.id);
    if (!def.solid) return false;
    const source = def.collisionBoxes;
    const shapes = source
      ? (typeof source === 'function' ? source(simulationWorld, edit.x, edit.y, edit.z, edit.state | 0) : source)
      : [def.collision || { x:0, y:0, z:0, w:1, h:1, d:1 }];
    return shapes.some(shape => player.x + 0.3 > edit.x + shape.x && player.x - 0.3 < edit.x + shape.x + shape.w &&
      player.y + 1.8 > edit.y + shape.y && player.y < edit.y + shape.y + shape.h &&
      player.z + 0.3 > edit.z + shape.z && player.z - 0.3 < edit.z + shape.z + shape.d);
  };
  for (const edit of rawEdits) {
    if (!validReach(player, edit, player.profile.mode === 'creative' ? 6 : 5.1)) continue;
    simulationWorld.ensureChunk(edit.x >> 4, edit.z >> 4);
    const currentId = simulationWorld.getBlock(edit.x, edit.y, edit.z);
    const currentState = simulationWorld.getState(edit.x, edit.y, edit.z);
    const correction = () => corrections.set(editKey(edit.x, edit.y, edit.z), {
      x: edit.x, y: edit.y, z: edit.z, id: currentId,
      state: Number.isInteger(currentState) ? currentState : null,
    });
    if (survival && edit.id === 0) {
      const oldId = currentId;
      if (oldId !== 0) {
        const bucketHeld = heldStack(player);
        const heldItem = bucketHeld ? Registry.Items.get(bucketHeld.id) : null;
        if ((oldId === Registry.Blocks.ID.WATER || oldId === Registry.Blocks.ID.LAVA) && heldItem && heldItem.bucket === 'empty') {
          if (!replaceOneHeld(player, oldId === Registry.Blocks.ID.WATER ? Registry.Items.IT.WATER_BUCKET : Registry.Items.IT.LAVA_BUCKET)) {
            correction(); continue;
          }
          inventoryChanged = true;
          accepted.push(edit); acceptedByKey.set(editKey(edit.x, edit.y, edit.z), edit);
          continue;
        }
        const mining = player.mining;
        const key = editKey(edit.x, edit.y, edit.z);
        const elapsed = mining ? Math.max(0, (Date.now() - mining.startedAt) / 1000) : 0;
        const roundTrip = Math.max(player.latency || 0, player.clientLatency || 0) / 1000;
        const allowance = Math.min(0.35, 0.06 + roundTrip * 0.5);
        const held = heldStack(player);
        const heldId = held ? held.id : 0;
        let reason = '';
        if (!mining || mining.key !== key || mining.id !== oldId) reason = 'missing_start';
        else if (mining.toolId !== heldId) reason = 'tool_changed';
        else if (elapsed + allowance < Math.max(0.03, mining.required * 0.94)) reason = 'too_fast';
        if (reason) {
          correction();
          sendJSON(socket, {
            t: 'mine_state', state: 'rejected', reason,
            x: edit.x, y: edit.y, z: edit.z, id: oldId,
            required: mining ? mining.required : serverBreakTime(player, oldId),
            elapsed, retryAfter: mining ? Math.max(0, mining.required * 0.94 - elapsed - allowance) : 0,
            session: mining ? mining.session : 0,
          });
          continue;
        }
        player.mining = null;
        damageHeld(player, 1);
        inventoryChanged = true;
        completed.push({ x: edit.x, y: edit.y, z: edit.z, id: oldId, required: mining.required, session: mining.session });
      }
    }
    if (survival && edit.id !== 0) {
      const family = Registry.Blocks.get(currentId).stateFamily;
      const held = heldStack(player);
      const item = held ? Registry.Items.get(held.id) : null;
      let authorized = currentId === edit.id && currentState === edit.state;
      let consume = false;
      let replace = 0;
      let damageTool = false;

      if (currentId === edit.id && currentState !== edit.state) {
        const oldState = Number.isInteger(currentState) ? currentState : 0;
        const newState = Number.isInteger(edit.state) ? edit.state : 0;
        if (SERVER_DRIVEN_STATE_FAMILIES.has(family)) authorized = false;
        else if (family === 'crop') {
          authorized = !!(item && item.bonemeal && newState > oldState && newState <= 7);
          consume = authorized;
        } else if (family === 'snow_layer') {
          authorized = !!(held && held.id === currentId && newState === oldState + 1 && newState <= 7);
          consume = authorized;
        } else if (family === 'end_portal_frame') {
          authorized = !!(held && held.id === Registry.Items.IT.EYE_OF_ENDER && !(oldState & 4) && (newState & 4));
          consume = authorized;
        } else {
          authorized = ['door', 'trapdoor', 'fence_gate', 'lever', 'button', 'pressure_plate', 'repeater', 'furnace', 'torch', 'sign'].includes(family);
        }
      } else if (currentId !== edit.id) {
        const lowerDoor = acceptedByKey.get(editKey(edit.x, edit.y - 1, edit.z));
        const pairedDoorTop = !!(lowerDoor &&
          ((edit.id === Registry.Blocks.ID.OAK_DOOR_TOP && lowerDoor.id === Registry.Blocks.ID.OAK_DOOR) ||
           (edit.id === Registry.Blocks.ID.IRON_DOOR_TOP && lowerDoor.id === Registry.Blocks.ID.IRON_DOOR)));
        const slabItem = edit.id === Registry.Blocks.ID.PLANK_DOUBLE_SLAB ? Registry.Blocks.ID.PLANK_SLAB :
          edit.id === Registry.Blocks.ID.STONE_DOUBLE_SLAB ? Registry.Blocks.ID.STONE_SLAB : 0;
        if (pairedDoorTop) authorized = currentId === 0 || Registry.Blocks.get(currentId).replaceable;
        else if (slabItem) { authorized = !!(held && held.id === slabItem); consume = authorized; }
        else if (edit.id === Registry.Blocks.ID.WATER || edit.id === Registry.Blocks.ID.LAVA) {
          const wanted = edit.id === Registry.Blocks.ID.WATER ? 'water' : 'lava';
          authorized = !!(item && item.bucket === wanted);
          replace = authorized ? Registry.Items.IT.BUCKET : 0;
        } else if (edit.id === Registry.Blocks.ID.FIRE) {
          authorized = !!(item && item.ignite); damageTool = authorized;
        } else if (edit.id === Registry.Blocks.ID.FARMLAND) {
          authorized = !!(item && item.tool && item.tool.type === 'hoe' &&
            (currentId === Registry.Blocks.ID.DIRT || currentId === Registry.Blocks.ID.GRASS));
          damageTool = authorized;
        } else {
          const replaceable = currentId === 0 || Registry.Blocks.get(currentId).replaceable;
          authorized = !!(replaceable && item && !item.creativeOnly &&
            ((item.block && held.id === edit.id) || item.place === edit.id || item.plant === edit.id));
          consume = authorized;
        }
      }

      if (!authorized || !supportValid(edit) || collidesWithPlayer(edit)) { correction(); continue; }
      if (consume && !consumeHeld(player, 1)) { correction(); continue; }
      if (replace && !replaceOneHeld(player, replace)) { correction(); continue; }
      if (damageTool) damageHeld(player, 1);
      if (consume || replace || damageTool) inventoryChanged = true;
    }
    if (currentId !== edit.id) {
      const topHalf = currentId === Registry.Blocks.ID.OAK_DOOR_TOP || currentId === Registry.Blocks.ID.IRON_DOOR_TOP ||
        edit.id === Registry.Blocks.ID.OAK_DOOR_TOP || edit.id === Registry.Blocks.ID.IRON_DOOR_TOP;
      const liquid = currentId === Registry.Blocks.ID.WATER || currentId === Registry.Blocks.ID.LAVA;
      if (edit.id === 0 && currentId !== 0 && !topHalf && !liquid) {
        minedCount++;
        if (STONE_AGE_BLOCKS.has(currentId)) minedStoneAgeBlock = true;
      }
      else if (edit.id !== 0 && !topHalf && (currentId === 0 || Registry.Blocks.get(currentId).replaceable)) placedCount++;
    }
    accepted.push(edit);
    acceptedByKey.set(editKey(edit.x, edit.y, edit.z), edit);
  }
  acceptEdits(accepted, player);
  const statsChanged = addPlayerStat(player, 'blocksMined', minedCount) |
    addPlayerStat(player, 'blocksPlaced', placedCount);
  const advancementChanged = minedStoneAgeBlock && unlockPlayerAdvancement(player, 'mine_block');
  if (inventoryChanged) {
    bumpInventory(player);
    lockInventory(player);
    sendProfile(player, 'block_action');
  } else if (statsChanged || advancementChanged) {
    sendProfile(player, 'stats');
  }
  if (corrections.size) sendJSON(socket, { t: 'blocks', edits: Array.from(corrections.values()), rejected: true });
  for (const result of completed) sendJSON(socket, Object.assign({ t: 'mine_state', state: 'completed' }, result));
}

function containerPacket(container, conflict) {
  const packet = {
    t: 'container', key: container.key, x: container.x, y: container.y, z: container.z,
    type: container.type, slots: container.slots, burn: container.burn,
    burnMax: container.burnMax, cook: container.cook, xpStored: container.xpStored, revision: container.revision,
  };
  if (conflict) packet.conflict = true;
  return packet;
}

function handleContainer(socket, message) {
  const player = socket.player;
  const x = Number(message.x), y = Number(message.y), z = Number(message.z);
  if (!player || ![x, y, z].every(Number.isInteger) || !validReach(player, { x, y, z }, 8)) return;
  const type = message.type === 'furnace' ? 'furnace' : message.type === 'chest' ? 'chest' : null;
  if (!type) return;
  simulationWorld.ensureChunk(x >> 4, z >> 4);
  const blockId = simulationWorld.getBlock(x, y, z);
  if ((type === 'chest' && blockId !== Registry.Blocks.ID.CHEST) ||
      (type === 'furnace' && blockId !== Registry.Blocks.ID.FURNACE && blockId !== Registry.Blocks.ID.FURNACE_LIT)) return;
  const key = containerKey(x, y, z);
  let container = world.containers.get(key);
  if (!container) {
    const generated = simulationWorld.getBE(x, y, z);
    const slots = generated && generated.type === type && Array.isArray(generated.slots) ? generated.slots : [];
    container = cleanContainer({ x, y, z, type, slots });
    world.containers.set(key, container);
    scheduleSave();
  }
  if (message.action === 'open') {
    sendJSON(socket, containerPacket(container));
    return;
  }
  if (message.action !== 'update') return;
  const clientRevision = Number(message.revision);
  const inventoryRevision = Number(message.inventoryRevision);
  if (!Number.isInteger(clientRevision) || clientRevision !== container.revision ||
      (player.profile.mode !== 'creative' && (!Number.isInteger(inventoryRevision) || inventoryRevision !== (player.profile.inventoryRevision || 0)))) {
    lockInventory(player, 750);
    sendProfile(player, 'container_conflict');
    sendJSON(socket, containerPacket(container, true));
    return;
  }
  const nextSlots = cleanSlots(message.slots, type === 'chest' ? 27 : 3);
  let draft = null;
  if (message.profile && typeof message.profile === 'object') draft = cleanClientInventory(message.profile, player.profile);
  if (player.profile.mode !== 'creative' && (!draft || !sameInventoryTotals(player.profile, draft, [container.slots], [nextSlots]))) {
    lockInventory(player, 750);
    sendProfile(player, 'container_conflict');
    sendJSON(socket, containerPacket(container, true));
    return;
  }
  const oldOutput = type === 'furnace' && container.slots[2] ? cloneStack(container.slots[2]) : null;
  container.slots = nextSlots;
  if (draft) {
    player.profile.inv = draft.inv;
    player.profile.equipment = draft.equipment;
    player.profile.offhand = draft.offhand;
    player.profile.cursor = draft.cursor;
    player.profile.hotbar = draft.hotbar;
  }
  if (type === 'furnace') {
    const nextOutput = container.slots[2];
    const taken = oldOutput && (!nextOutput || nextOutput.id === oldOutput.id)
      ? Math.max(0, oldOutput.n - (nextOutput ? nextOutput.n : 0)) : 0;
    if (taken > 0 && container.xpStored > 0) {
      const share = Math.min(container.xpStored, container.xpStored * taken / oldOutput.n);
      container.xpStored = Math.max(0, container.xpStored - share);
      const points = Math.floor(share + Math.random());
      if (points > 0) addXP(player.profile, points);
      lockInventory(player, 500);
    }
  }
  container.revision++;
  bumpInventory(player);
  lockInventory(player, 500);
  sendProfile(player, type === 'furnace' ? 'furnace' : 'container');
  scheduleSave();
  broadcast(containerPacket(container));
}

function handleSign(socket, message) {
  const player = socket.player;
  const sign = cleanSign(message);
  if (!player || !sign || player.profile.dead || !validReach(player, sign, 8)) return;
  simulationWorld.ensureChunk(sign.x >> 4, sign.z >> 4);
  if (simulationWorld.getBlock(sign.x, sign.y, sign.z) !== Registry.Blocks.ID.OAK_SIGN) return;
  world.signs.set(sign.key, sign);
  simulationWorld.setBE(sign.x, sign.y, sign.z, { type: 'sign', lines: sign.lines.slice() });
  scheduleSave();
  broadcast({ t: 'sign', x: sign.x, y: sign.y, z: sign.z, lines: sign.lines });
}

function parseCommand(text) {
  const matches = String(text || '').match(/"[^"]*"|\S+/g) || [];
  return matches.map(token => token[0] === '"' && token[token.length - 1] === '"' ? token.slice(1, -1) : token);
}

function requirePermission(player, permission) {
  if (hasPermission(player, permission)) return true;
  chatSystem('你没有权限执行此命令', player);
  return false;
}

function setPlayerMode(target, mode) {
  target.profile.mode = mode;
  if (mode === 'survival') target.profile.flying = false;
  sendProfile(target, 'gamemode');
  scheduleSave();
}

function teleportPlayer(target, x, y, z, reason) {
  x = clamp(x, -1000000, 1000000); y = clamp(y, -64, 320); z = clamp(z, -1000000, 1000000);
  simulationWorld.ensureChunk(Math.floor(x) >> 4, Math.floor(z) >> 4);
  target.x = x; target.y = y; target.z = z;
  target.vx = target.vy = target.vz = 0;
  target.profile.x = x; target.profile.y = y; target.profile.z = z;
  target.mining = null;
  if (target.ridingConsumed) {
    addStack(target.profile, { id:Registry.Items.IT.MINECART, n:1 });
    bumpInventory(target); lockInventory(target);
  }
  target.riding = null; target.ridingConsumed = false;
  target.knockbackUntil = 0; target.knockbackPeak = null;
  sendJSON(target.socket, { t:'position', x, y, z, reason:reason || 'teleport' });
  sendProfile(target, reason || 'teleport');
  scheduleSave();
}

function restorePlayer(target, heal, feed) {
  if (heal) { target.profile.hp = 20; target.profile.dead = false; target.healthLockUntil = Date.now() + 500; }
  if (feed) { target.profile.hunger = 20; target.profile.saturation = 5; }
  sendProfile(target, heal && feed ? 'restore' : heal ? 'heal' : 'feed');
  scheduleSave();
}

function clearPlayerItems(target, itemId, amount) {
  let remaining = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : Infinity;
  let removed = 0;
  const clearArray = (slots) => {
    for (let index = 0; index < slots.length && remaining > 0; index++) {
      const stack = slots[index];
      if (!stack || (Number.isInteger(itemId) && stack.id !== itemId)) continue;
      const take = Math.min(stack.n, remaining);
      stack.n -= take; remaining -= take; removed += take;
      if (stack.n <= 0) slots[index] = null;
    }
  };
  clearArray(target.profile.inv); clearArray(target.profile.equipment);
  if (target.profile.offhand && remaining > 0 && (!Number.isInteger(itemId) || target.profile.offhand.id === itemId)) {
    const take = Math.min(target.profile.offhand.n, remaining);
    target.profile.offhand.n -= take; remaining -= take; removed += take;
    if (target.profile.offhand.n <= 0) target.profile.offhand = null;
  }
  if (target.profile.cursor && remaining > 0 && (!Number.isInteger(itemId) || target.profile.cursor.id === itemId)) {
    const take = Math.min(target.profile.cursor.n, remaining);
    target.profile.cursor.n -= take; removed += take;
    if (target.profile.cursor.n <= 0) target.profile.cursor = null;
  }
  if (removed) { bumpInventory(target); lockInventory(target); sendProfile(target, 'clear'); scheduleSave(); }
  return removed;
}

function kickPlayer(target, reason) {
  const message = safeText(reason, 80) || '已被管理员请出服务器';
  sendJSON(target.socket, { t:'error', code:'kicked', message });
  target.socket.close(1008, 'kicked');
}

function summonMob(kind, x, y, z) {
  kind = String(kind || '').toLocaleLowerCase();
  if (!MOB_STATS[kind]) return null;
  if (![x,y,z].every(Number.isFinite)) return null;
  simulationWorld.ensureChunk(Math.floor(x) >> 4, Math.floor(z) >> 4);
  return spawnMobEntity(kind, clamp(x, -1000000, 1000000), clamp(y, 0, 255), clamp(z, -1000000, 1000000));
}

function statusLine() {
  return `players=${players.size}/${MAX_PLAYERS} entities=${entities.size} edits=${world.edits.size} profiles=${world.profiles.size} time=${worldClock().timeOfDay.toFixed(3)} weather=${world.weather} difficulty=${world.difficulty}`;
}

function executeCommand(player, text) {
  const args = parseCommand(text);
  const command = String(args.shift() || '').replace(/^\//, '').toLocaleLowerCase();
  if (!command) return;
  if (command === 'help') {
    chatSystem('命令：/auth /list /status /seed /gamemode /give /item /tp /spawn /setspawn /heal /feed /kill /clear /kick /ban /pardon /perm /time /weather /difficulty /summon /say /save', player);
    return;
  }
  if (command === 'auth') {
    if (Date.now() < (player.authLockedUntil || 0)) { chatSystem('认证尝试过多，请稍后再试', player); return; }
    if (!passwordMatches(args[0])) {
      player.authFailures = (player.authFailures || 0) + 1;
      if (player.authFailures >= 5) { player.authLockedUntil = Date.now() + 60000; player.authFailures = 0; }
      chatSystem('权限密码错误', player);
      return;
    }
    player.authFailures = 0;
    player.profile.role = 'admin';
    chatSystem('认证成功：你现在拥有管理员权限', player);
    sendProfile(player, 'permission');
    scheduleSave();
    return;
  }
  if (command === 'list') {
    chatSystem('在线玩家（' + players.size + '/' + MAX_PLAYERS + '）：' + Array.from(players.values()).map(item => item.name).join('、'), player);
    return;
  }
  if (command === 'status') { chatSystem('服务器状态：' + statusLine(), player); return; }
  if (command === 'seed') { chatSystem('世界种子：' + world.seed, player); return; }
  if (command === 'tp' || command === 'teleport') {
    if (!requirePermission(player, 'player.teleport')) return;
    let target = player, destination = null;
    if (args.length === 1) destination = findPlayer(args[0]);
    else if (args.length === 2) { target = findPlayer(args[0]); destination = findPlayer(args[1]); }
    else if (args.length === 3) destination = { x:Number(args[0]), y:Number(args[1]), z:Number(args[2]) };
    else if (args.length === 4) { target = findPlayer(args[0]); destination = { x:Number(args[1]), y:Number(args[2]), z:Number(args[3]) }; }
    if (!target || !destination || ![destination.x,destination.y,destination.z].every(Number.isFinite)) {
      chatSystem('用法：/tp [玩家] <目标玩家|x y z>', player); return;
    }
    teleportPlayer(target, destination.x, destination.y, destination.z, 'teleport');
    chatSystem('已传送 ' + target.name, player); return;
  }
  if (command === 'setspawn') {
    const coordinateOnly = args.length >= 3 && args.slice(0,3).every(value => Number.isFinite(Number(value)));
    const target = args[0] && !coordinateOnly ? findPlayer(args[0]) : player;
    if (!target) { chatSystem('找不到目标玩家', player); return; }
    if (target !== player && !requirePermission(player, 'world.manage')) return;
    const offset = args[0] && !coordinateOnly ? 1 : 0;
    const coordinates = args.length >= offset + 3 ? args.slice(offset, offset + 3).map(Number) : [target.x, target.y, target.z];
    if (!coordinates.every(Number.isFinite)) { chatSystem('用法：/setspawn [玩家] [x y z]', player); return; }
    target.profile.spawn = { x:clamp(coordinates[0],-1000000,1000000), y:clamp(coordinates[1],-64,320), z:clamp(coordinates[2],-1000000,1000000) };
    sendProfile(target, 'spawn'); scheduleSave(); chatSystem('已设置 ' + target.name + ' 的重生点', player); return;
  }
  if (command === 'heal' || command === 'feed') {
    if (!requirePermission(player, 'player.heal')) return;
    const target = args[0] ? findPlayer(args[0]) : player;
    if (!target) { chatSystem('找不到目标玩家', player); return; }
    restorePlayer(target, command === 'heal', command === 'feed');
    chatSystem('已' + (command === 'heal' ? '治疗 ' : '恢复饱食度 ') + target.name, player); return;
  }
  if (command === 'kill') {
    const target = args[0] ? findPlayer(args[0]) : player;
    if (!target) { chatSystem('找不到目标玩家', player); return; }
    if (target !== player && !requirePermission(player, 'player.kill')) return;
    killPlayer(target, 'command', player.name); return;
  }
  if (command === 'clear') {
    if (!requirePermission(player, 'player.inventory')) return;
    const target = args[0] ? findPlayer(args.shift()) : player;
    if (!target) { chatSystem('找不到目标玩家', player); return; }
    const hasItemFilter = args.length > 0;
    const itemId = hasItemFilter ? resolveItem(args.shift()) : undefined;
    if (hasItemFilter && !Number.isInteger(itemId)) { chatSystem('未知物品', player); return; }
    const amount = args.length ? clampInt(args.shift(), 1, 2304, 1) : Infinity;
    const removed = clearPlayerItems(target, itemId, amount);
    chatSystem('已清除 ' + target.name + ' 的 ' + removed + ' 个物品', player); return;
  }
  if (command === 'kick') {
    if (!requirePermission(player, 'player.kick')) return;
    const target = findPlayer(args.shift());
    if (!target) { chatSystem('找不到目标玩家', player); return; }
    if (target.profile.role === 'admin' && player.profile.role !== 'admin') { chatSystem('不能请出管理员', player); return; }
    chatSystem(target.name + ' 已被请出服务器'); kickPlayer(target, args.join(' ')); return;
  }
  if (command === 'say') {
    if (!requirePermission(player, 'server.broadcast')) return;
    const text = safeText(args.join(' '), 160);
    if (text) chatSystem('[服务器] ' + text); return;
  }
  if (command === 'summon') {
    if (!requirePermission(player, 'world.summon')) return;
    const kind = args.shift();
    const coordinates = args.length >= 3 ? args.slice(0,3).map(Number) : [player.x, player.y, player.z];
    const entity = summonMob(kind, coordinates[0], coordinates[1], coordinates[2]);
    if (!entity) chatSystem('用法：/summon <生物ID> [x y z]', player);
    else { scheduleSave(); chatSystem('已召唤 ' + entity.kind, player); }
    return;
  }
  if (command === 'save') {
    if (!requirePermission(player, 'world.manage')) return;
    world.dirty = true; saveWorldNow(); chatSystem('世界已保存', player); return;
  }
  if (command === 'gamemode' || command === 'gm') {
    const modeArg = String(args[0] || '').toLocaleLowerCase();
    const mode = modeArg === '1' || modeArg === 'c' || modeArg === 'creative' || modeArg === '创造' ? 'creative' :
      modeArg === '0' || modeArg === 's' || modeArg === 'survival' || modeArg === '生存' ? 'survival' : null;
    if (!mode) { chatSystem('用法：/gamemode <survival|creative> [玩家]', player); return; }
    const target = args[1] ? findPlayer(args[1]) : player;
    if (!target) { chatSystem('找不到目标玩家', player); return; }
    const permission = target === player ? 'gamemode.self' : 'gamemode.others';
    if (!requirePermission(player, permission)) return;
    setPlayerMode(target, mode);
    chatSystem(target.name + ' 的游戏模式已改为' + (mode === 'creative' ? '创造' : '生存'));
    return;
  }
  if (command === 'give' || command === 'item') {
    const self = command === 'item';
    if (!requirePermission(player, self ? 'item.self' : 'item.give')) return;
    const target = self ? player : findPlayer(args.shift());
    if (!target) { chatSystem('找不到目标玩家', player); return; }
    const itemId = resolveItem(args.shift());
    if (!Number.isInteger(itemId)) { chatSystem('未知物品；可使用数字 ID、注册名或中文名', player); return; }
    const count = clampInt(args.shift(), 1, 2304, 1);
    let left = count;
    const max = Registry.Items.maxStack(itemId);
    while (left > 0) {
      const amount = Math.min(left, max);
      const overflow = addStack(target.profile, { id: itemId, n: amount });
      left -= amount - overflow;
      if (overflow) break;
    }
    bumpInventory(target);
    sendProfile(target, 'give');
    lockInventory(target);
    scheduleSave();
    chatSystem('已给予 ' + target.name + '：' + Registry.Items.name(itemId) + ' x' + (count - left), player);
    return;
  }
  if (command === 'ban') {
    if (!requirePermission(player, 'player.ban')) return;
    const target = findPlayer(args.shift());
    if (!target) { chatSystem('找不到目标玩家', player); return; }
    if (target.profile.role === 'admin' && player.profile.role !== 'admin') { chatSystem('不能封禁管理员', player); return; }
    world.bans.keys.add(target.profile.key);
    world.bans.names.add(target.name.toLocaleLowerCase());
    const reason = safeText(args.join(' '), 80) || '已被管理员封禁';
    chatSystem(target.name + ' 已被封禁：' + reason);
    sendJSON(target.socket, { t: 'error', code: 'banned', message: reason });
    target.socket.close(1008, 'banned');
    scheduleSave();
    return;
  }
  if (command === 'pardon') {
    if (!requirePermission(player, 'permission.manage')) return;
    if (!args[0]) { chatSystem('用法：/pardon <玩家>', player); return; }
    const name = safeName(args[0]).toLocaleLowerCase();
    world.bans.names.delete(name);
    for (const profile of world.profiles.values()) if (profile.name.toLocaleLowerCase() === name) world.bans.keys.delete(profile.key);
    scheduleSave();
    chatSystem('已解除 ' + safeName(args[0]) + ' 的封禁', player);
    return;
  }
  if (command === 'perm' || command === 'permission') {
    if (!requirePermission(player, 'permission.manage')) return;
    const target = findPlayer(args[0]);
    const role = String(args[1] || '').toLocaleLowerCase();
    if (!target || !ROLE_PERMISSIONS[role]) { chatSystem('用法：/perm <玩家> <user|moderator|admin>', player); return; }
    target.profile.role = role;
    if (!profileCanCreative(target.profile)) target.profile.mode = 'survival';
    sendProfile(target, 'permission');
    scheduleSave();
    chatSystem(target.name + ' 的权限组已改为 ' + role);
    return;
  }
  if (command === 'time') {
    if (!requirePermission(player, 'world.manage')) return;
    const value = String(args[0] || '').toLocaleLowerCase();
    const time = value === 'day' || value === '白天' ? 0.35 : value === 'night' || value === '夜晚' ? 0.85 : Number(value);
    if (!Number.isFinite(time)) { chatSystem('用法：/time <day|night|0..1>', player); return; }
    setWorldTimeOfDay(time);
    chatSystem('世界时间已更改');
    return;
  }
  if (command === 'weather') {
    if (!requirePermission(player, 'world.manage')) return;
    const weather = args[0] === 'rain' || args[0] === '雨' ? 'rain' : args[0] === 'clear' || args[0] === '晴' ? 'clear' : null;
    if (!weather) { chatSystem('用法：/weather <clear|rain>', player); return; }
    world.weather = weather; world.weatherTimer = 300; scheduleSave();
    chatSystem('天气已改为' + (weather === 'rain' ? '降雨' : '晴朗'));
    return;
  }
  if (command === 'difficulty') {
    if (!requirePermission(player, 'world.manage')) return;
    const names = { peaceful: 0, easy: 1, normal: 2, hard: 3, 和平: 0, 简单: 1, 普通: 2, 困难: 3 };
    const difficulty = names[args[0]] !== undefined ? names[args[0]] : clampInt(args[0], 0, 3, -1);
    if (difficulty < 0) { chatSystem('用法：/difficulty <peaceful|easy|normal|hard>', player); return; }
    world.difficulty = difficulty; scheduleSave();
    chatSystem('难度已更改');
    return;
  }
  if (command === 'spawn') {
    resetPlayerMovementState(player, player.profile.spawn);
    sendJSON(player.socket, { t: 'position', x: player.x, y: player.y, z: player.z, reason: 'spawn' });
    return;
  }
  chatSystem('未知命令，输入 /help 查看命令', player);
}

function handleChat(socket, message) {
  const player = socket.player;
  if (!player) return;
  const now = Date.now();
  if (now - (player.lastChat || 0) < 350) return;
  player.lastChat = now;
  const text = safeText(message.text, 160);
  if (!text) return;
  if (text[0] === '/') executeCommand(player, text);
  else chatPlayer(player, text);
}

function handleAction(socket, message) {
  const player = socket.player;
  const receivedAt = Date.now();
  if (!player) return;
  if (message.action === 'respawn') {
    const profile = player.profile;
    if (!profile.dead) return;
    profile.dead = false; profile.hp = 20; profile.hunger = 20; profile.saturation = 5; profile.air = MAX_AIR_SECONDS;
    profile.statusEffects = [];
    resetPlayerMovementState(player, profile.spawn);
    sendProfile(player, 'respawn');
    sendJSON(socket, { t: 'position', x: player.x, y: player.y, z: player.z, reason: 'respawn' });
    scheduleSave();
    return;
  }
  if (player.profile.dead) return;
  if (message.action === 'mine_start') {
    const x = Number(message.x), y = Number(message.y), z = Number(message.z), id = Number(message.id);
    if (![x, y, z, id].every(Number.isInteger) || !validReach(player, { x, y, z }, 5.1)) return;
    simulationWorld.ensureChunk(x >> 4, z >> 4);
    if (simulationWorld.getBlock(x, y, z) !== id) return;
    if (Number.isInteger(message.hotbar)) player.profile.hotbar = clampInt(message.hotbar, 0, 8, player.profile.hotbar);
    const baseRequired = serverBreakTime(player, id);
    if (!Number.isFinite(baseRequired)) return;
    const held = heldStack(player);
    const heldId = held ? held.id : 0;
    const reported = Number(message.total);
    const toolMatches = !Number.isInteger(message.toolId) || message.toolId === heldId;
    const maxReported = Math.max(0.1, baseRequired * 25.5 + 0.1);
    const required = toolMatches && Number.isFinite(reported) && reported >= 0.03 && reported <= maxReported
      ? Math.max(baseRequired, reported)
      : baseRequired;
    const session = (player.miningSerial || 0) + 1;
    player.miningSerial = session;
    player.mining = {
      key: editKey(x, y, z), id, required, baseRequired, startedAt: receivedAt, session,
      toolId: heldId, clientOnGround: !!message.onGround, clientUnderwater: !!message.underwater,
    };
    sendJSON(socket, { t: 'mine_state', state: 'started', x, y, z, id, required, session });
    return;
  }
  if (message.action === 'held_slot') {
    const hotbar = clampInt(message.hotbar, 0, 8, player.profile.hotbar);
    if (hotbar !== player.profile.hotbar) {
      player.profile.hotbar = hotbar;
      if (!playerCanRaiseShield(player)) player.blocking = false;
      broadcast({ t: 'player_action', player: publicPlayer(player) }, socket);
    }
    return;
  }
  if (message.action === 'block_state') {
    player.profile.hotbar = clampInt(message.hotbar, 0, 8, player.profile.hotbar);
    player.blocking = !!message.active && playerCanRaiseShield(player) && Date.now() >= (player.shieldDisabledUntil || 0);
    player.sprinting = player.blocking ? false : player.sprinting;
    if (player.blocking && (player.action === 'idle' || player.action === 'mine')) player.action = 'block';
    if (!player.blocking && player.action === 'block') player.action = 'idle';
    if (player.action === 'block' || player.action === 'idle') player.actionPhase = player.blocking ? 1 : 0;
    broadcast({ t: 'player_action', player: publicPlayer(player) }, socket);
    return;
  }
  if (message.action === 'mount_minecart') {
    const x = Number(message.x), y = Number(message.y), z = Number(message.z);
    if (player.riding || ![x,y,z].every(Number.isInteger) || !validReach(player, { x, y, z }, 5.1)) return;
    if (!Number.isInteger(message.inventoryRevision) || message.inventoryRevision !== (player.profile.inventoryRevision || 0)) {
      sendProfile(player, 'inventory_conflict'); return;
    }
    simulationWorld.ensureChunk(x >> 4, z >> 4);
    const held = heldStack(player), item = held ? Registry.Items.get(held.id) : null;
    if (simulationWorld.getBlock(x, y, z) !== Registry.Blocks.ID.RAIL || !item || !item.minecart) return;
    if (player.profile.mode !== 'creative' && !consumeHeld(player, 1)) return;
    player.riding = 'minecart'; player.ridingConsumed = player.profile.mode !== 'creative';
    player.x = x + 0.5; player.y = y + 0.01; player.z = z + 0.5;
    player.vx = player.vy = player.vz = 0;
    bumpInventory(player); lockInventory(player); sendProfile(player, 'vehicle'); scheduleSave();
    sendJSON(player.socket, { t:'position', x:player.x, y:player.y, z:player.z, reason:'minecart' });
    broadcast({ t:'player_action', player:publicPlayer(player) }, player.socket);
    return;
  }
  if (message.action === 'dismount_minecart') {
    if (player.riding !== 'minecart') return;
    player.riding = null;
    if (player.ridingConsumed) addStack(player.profile, { id:Registry.Items.IT.MINECART, n:1 });
    player.ridingConsumed = false;
    bumpInventory(player); lockInventory(player); sendProfile(player, 'vehicle'); scheduleSave();
    broadcast({ t:'player_action', player:publicPlayer(player) }, player.socket);
    return;
  }
  if (message.action === 'craft') {
    const transaction = clampInt(message.transaction, 1, 0x7fffffff, 0);
    const rejectCraft = () => sendProfile(player, 'craft_conflict', transaction);
    if (Number.isInteger(message.inventoryRevision) && message.inventoryRevision !== (player.profile.inventoryRevision || 0)) {
      rejectCraft(); return;
    }
    const rawGrid = Array.isArray(message.grid) ? message.grid : [];
    if (rawGrid.length !== 4 && rawGrid.length !== 9) { rejectCraft(); return; }
    const grid = rawGrid.map(cleanStack);
    const match = Registry.Craft.match(grid);
    if (!match) { rejectCraft(); return; }

    const draft = { inv: cleanSlots(player.profile.inv, 36), cursor: cleanStack(player.profile.cursor) };
    const required = new Map();
    for (const stack of grid) if (stack) required.set(stack.id, (required.get(stack.id) || 0) + 1);
    for (const [id, count] of required) if (!removeItem(draft, id, count)) { rejectCraft(); return; }

    const output = cleanStack(match.out);
    if (!output) { rejectCraft(); return; }
    if (message.shift) {
      if (addStack(draft, output) > 0) { rejectCraft(); return; }
    } else if (!draft.cursor) {
      draft.cursor = output;
    } else {
      if (!stackCompatible(draft.cursor, output) || draft.cursor.n + output.n > Registry.Items.maxStack(output.id)) { rejectCraft(); return; }
      draft.cursor.n += output.n;
    }

    player.profile.inv = draft.inv;
    player.profile.cursor = draft.cursor;
    addPlayerStat(player, 'itemsCrafted', output.n);
    if (output.id === Registry.Blocks.ID.CRAFTING) unlockPlayerAdvancement(player, 'craft_item');
    bumpInventory(player);
    lockInventory(player);
    sendProfile(player, 'craft', transaction);
    scheduleSave();
    return;
  }
  if (message.action === 'fill_bottle') {
    if (!Number.isInteger(message.inventoryRevision) || message.inventoryRevision !== (player.profile.inventoryRevision || 0)) {
      sendProfile(player, 'inventory_conflict'); return;
    }
    const x = Number(message.x), y = Number(message.y), z = Number(message.z);
    if (![x, y, z].every(Number.isInteger) || !validReach(player, { x, y, z }, 5.1)) return;
    simulationWorld.ensureChunk(x >> 4, z >> 4);
    const held = heldStack(player);
    if (simulationWorld.getBlock(x, y, z) !== Registry.Blocks.ID.WATER || !held || held.id !== Registry.Items.IT.GLASS_BOTTLE) return;
    if (player.profile.mode !== 'creative') replaceOneHeld(player, Registry.Items.IT.WATER_BOTTLE);
    bumpInventory(player); lockInventory(player); sendProfile(player, 'bottle'); scheduleSave();
    return;
  }
  if (message.action === 'use_station') {
    const station = String(message.station || '');
    const stationResult = (ok, code, text) => {
      const result = {
        t:'station_result', ok:!!ok, station, code, message:text,
        inventoryRevision:player.profile.inventoryRevision || 0,
      };
      if (Number.isInteger(message.transaction)) result.transaction = clampInt(message.transaction, 0, 2147483647, 0);
      sendJSON(socket, result);
    };
    if (!Number.isInteger(message.inventoryRevision) || message.inventoryRevision !== (player.profile.inventoryRevision || 0)) {
      sendProfile(player, 'inventory_conflict');
      stationResult(false, 'inventory_conflict', '背包状态已变化，请重试');
      return;
    }
    const x = Number(message.x), y = Number(message.y), z = Number(message.z);
    const wantedBlock = station === 'enchant' ? Registry.Blocks.ID.ENCHANTING_TABLE :
      station === 'repair' ? Registry.Blocks.ID.ANVIL : station === 'brew' ? Registry.Blocks.ID.BREWING_STAND : 0;
    if (!wantedBlock) { stationResult(false, 'invalid_station', '未知工作站'); return; }
    if (![x, y, z].every(Number.isInteger)) { stationResult(false, 'invalid_position', '工作站坐标无效'); return; }
    if (!validReach(player, { x, y, z }, 5.1)) { stationResult(false, 'out_of_reach', '距离工作站太远'); return; }
    simulationWorld.ensureChunk(x >> 4, z >> 4);
    if (simulationWorld.getBlock(x, y, z) !== wantedBlock) {
      stationResult(false, 'station_missing', '目标位置没有对应工作站'); return;
    }
    const held = heldStack(player);
    const item = held ? Registry.Items.get(held.id) : null;
    let changed = false;
    if (station === 'enchant') {
      if (!held || !item || !item.enchantable || (item.enchantable === 'book' && held.n !== 1)) {
        stationResult(false, 'invalid_item', '手持物品无法附魔'); return;
      }
      const choices = item.armor ? ['protection', 'unbreaking'] : item.bow ? ['power', 'unbreaking'] : item.tool ?
        (item.tool.type === 'sword' ? ['sharpness', 'unbreaking'] : ['efficiency', 'unbreaking']) :
        ['protection', 'sharpness', 'efficiency', 'power', 'unbreaking'];
      const key = choices[Math.floor(simulationWorld.random() * choices.length)];
      const current = held.ench || {};
      const level = current[key] || 0;
      const cost = clampInt(level + 1, 1, 3, 1);
      if (level >= 3) { stationResult(false, 'max_level', '该附魔已达到最高等级'); return; }
      if (player.profile.xpLevel < cost) { stationResult(false, 'insufficient_xp', '经验等级不足'); return; }
      if (itemCount(player.profile, Registry.Items.IT.LAPIS) < cost) { stationResult(false, 'missing_material', '青金石不足'); return; }
      removeItem(player.profile, Registry.Items.IT.LAPIS, cost);
      player.profile.xpLevel -= cost;
      player.profile.xpProgress = 0;
      held.ench = Object.assign({}, current, { [key]: level + 1 });
      changed = true;
    } else if (station === 'repair') {
      const maximum = held ? Registry.Items.durabilityOf(held.id) : 0;
      const material = item && item.armor ? item.armor.repair : item && item.repair;
      if (!held || !maximum || !material) { stationResult(false, 'invalid_item', '手持物品无法修复'); return; }
      if (held.dur >= maximum) { stationResult(false, 'not_damaged', '物品无需修复'); return; }
      if (player.profile.xpLevel < 1) { stationResult(false, 'insufficient_xp', '经验等级不足'); return; }
      if (itemCount(player.profile, material) < 1) { stationResult(false, 'missing_material', '缺少修复材料'); return; }
      removeItem(player.profile, material, 1);
      held.dur = Math.min(maximum, held.dur + Math.ceil(maximum * 0.25));
      player.profile.xpLevel--;
      player.profile.xpProgress = 0;
      changed = true;
    } else if (station === 'brew') {
      let ingredient = 0, result = 0;
      if (held && held.id === Registry.Items.IT.WATER_BOTTLE) {
        ingredient = Registry.Items.IT.NETHER_WART; result = Registry.Items.IT.AWKWARD_POTION;
      } else if (held && held.id === Registry.Items.IT.AWKWARD_POTION) {
        ingredient = Registry.Items.IT.GLOWSTONE_DUST; result = Registry.Items.IT.HEALING_POTION;
      }
      if (!ingredient) { stationResult(false, 'invalid_recipe', '手持物品没有可用的酿造配方'); return; }
      if (itemCount(player.profile, ingredient) < 1) { stationResult(false, 'missing_material', '缺少酿造材料'); return; }
      removeItem(player.profile, ingredient, 1);
      player.profile.inv[player.profile.hotbar] = { id: result, n: 1 };
      changed = true;
    }
    if (changed) {
      bumpInventory(player); lockInventory(player); sendProfile(player, 'station'); scheduleSave();
      stationResult(true, 'ok', station === 'enchant' ? '附魔完成' : station === 'repair' ? '修复完成' : '酿造完成');
    } else {
      stationResult(false, 'operation_failed', '工作站操作未完成');
    }
    return;
  }
  if (message.action === 'death') {
    killPlayer(player, safeText(message.cause, 32) || '环境伤害');
    return;
  }
  if (message.action === 'drop') {
    if (Number.isInteger(message.inventoryRevision) && message.inventoryRevision !== (player.profile.inventoryRevision || 0)) {
      sendProfile(player, 'inventory_conflict');
      return;
    }
    if (Number.isInteger(message.hotbar)) player.profile.hotbar = clampInt(message.hotbar, 0, 8, player.profile.hotbar);
    const index = player.profile.hotbar;
    const stack = player.profile.inv[index];
    if (!stack) return;
    if (Number.isInteger(message.expectedId) && message.expectedId > 0 && stack.id !== message.expectedId) {
      sendProfile(player, 'inventory_conflict');
      return;
    }
    const count = message.all ? stack.n : 1;
    const dropped = cloneStack(stack, count);
    stack.n -= count;
    if (stack.n <= 0) player.profile.inv[index] = null;
    finishInventoryDrop(player, socket, dropped);
    return;
  }
  if (message.action === 'drop_slot') {
    if (Number.isInteger(message.inventoryRevision) && message.inventoryRevision !== (player.profile.inventoryRevision || 0)) {
      sendProfile(player, 'inventory_conflict');
      return;
    }
    const source = String(message.source || '');
    if (source !== 'inv' && source !== 'armor' && source !== 'offhand' && source !== 'cursor') return;
    const index = clampInt(message.index, 0, source === 'armor' ? 3 : source === 'inv' ? 35 : 0, 0);
    const expectedId = clampInt(message.expectedId, 1, 65535, 0);
    let location = null;
    let stack = player.profile.cursor;
    if (stack && (!expectedId || stack.id === expectedId)) {
      location = 'cursor';
    } else if (source === 'inv') {
      stack = player.profile.inv[index];
      location = 'inv';
    } else if (source === 'armor') {
      stack = player.profile.equipment[index];
      location = 'armor';
    } else if (source === 'offhand') {
      stack = player.profile.offhand;
      location = 'offhand';
    } else if (source === 'cursor') {
      stack = player.profile.cursor;
      location = 'cursor';
    }
    if (!stack || (expectedId && stack.id !== expectedId)) {
      sendProfile(player, 'inventory_conflict');
      return;
    }
    const count = clampInt(message.count, 1, 64, 1);
    if (count > stack.n) {
      sendProfile(player, 'inventory_conflict');
      return;
    }
    const dropped = cloneStack(stack, count);
    stack.n -= count;
    if (stack.n <= 0) {
      if (location === 'cursor') player.profile.cursor = null;
      else if (location === 'inv') player.profile.inv[index] = null;
      else if (location === 'armor') player.profile.equipment[index] = null;
      else player.profile.offhand = null;
    }
    finishInventoryDrop(player, socket, dropped);
    return;
  }
  if (message.action === 'portal') {
    const x = Number(message.x), y = Number(message.y), z = Number(message.z);
    if (![x, y, z].every(Number.isInteger) || !validReach(player, { x, y, z }, 3.5)) return;
    simulationWorld.ensureChunk(x >> 4, z >> 4);
    const portalId = simulationWorld.getBlock(x, y, z);
    const ID = Registry.Blocks.ID;
    if (portalId !== ID.NETHER_PORTAL && portalId !== ID.END_PORTAL) return;
    if (Date.now() < (player.portalCooldownUntil || 0)) return;
    const destination = simulationWorld.portalDestination(player.x, player.y, player.z, portalId);
    if (!destination) return;
    player.portalCooldownUntil = Date.now() + 2500;
    player.x = destination.x; player.y = destination.y; player.z = destination.z;
    player.vx = player.vy = player.vz = 0;
    player.profile.x = player.x; player.profile.y = player.y; player.profile.z = player.z;
    sendJSON(socket, { t: 'position', x: player.x, y: player.y, z: player.z, reason: 'portal', dimension: destination.dimension });
    scheduleSave();
    return;
  }
  if (message.action === 'throw_egg') {
    if (Number.isInteger(message.inventoryRevision) && message.inventoryRevision !== (player.profile.inventoryRevision || 0)) {
      sendProfile(player, 'inventory_conflict');
      return;
    }
    const held = heldStack(player);
    if (!held || held.id !== Registry.Items.IT.EGG) return;
    const direction = Array.isArray(message.direction) ? message.direction.map(Number) : [];
    const length = Math.hypot(direction[0], direction[1], direction[2]);
    if (!Number.isFinite(length) || length < 0.5) return;
    if (!spawnEggEntity(player, [direction[0] / length, direction[1] / length, direction[2] / length])) return;
    if (player.profile.mode !== 'creative') {
      held.n--;
      if (held.n <= 0) player.profile.inv[player.profile.hotbar] = null;
    }
    bumpInventory(player); lockInventory(player); sendProfile(player, 'egg'); scheduleSave();
    return;
  }
  if (message.action === 'throw_ender_pearl') {
    if (Number.isInteger(message.inventoryRevision) && message.inventoryRevision !== (player.profile.inventoryRevision || 0)) {
      sendProfile(player, 'inventory_conflict');
      return;
    }
    const held = heldStack(player);
    if (!held || held.id !== Registry.Items.IT.ENDER_PEARL) return;
    const direction = Array.isArray(message.direction) ? message.direction.map(Number) : [];
    const length = Math.hypot(direction[0], direction[1], direction[2]);
    if (!Number.isFinite(length) || length < 0.5) return;
    if (!spawnEnderPearlEntity(player, [direction[0] / length, direction[1] / length, direction[2] / length])) return;
    if (player.profile.mode !== 'creative') {
      held.n--;
      if (held.n <= 0) player.profile.inv[player.profile.hotbar] = null;
    }
    bumpInventory(player); lockInventory(player); sendProfile(player, 'ender_pearl'); scheduleSave();
    return;
  }
  if (message.action === 'fire_arrow') {
    const bow = heldStack(player);
    if (!bow || bow.id !== Registry.Items.IT.BOW) return;
    if (player.profile.mode !== 'creative' && !removeItem(player.profile, Registry.Items.IT.ARROW, 1)) return;
    const direction = Array.isArray(message.direction) ? message.direction.map(Number) : [];
    const length = Math.hypot(direction[0], direction[1], direction[2]);
    if (!Number.isFinite(length) || length < 0.5) return;
    spawnArrowEntity(player, [direction[0] / length, direction[1] / length, direction[2] / length], clamp(message.charge, 0.1, 1));
    if (player.profile.mode !== 'creative') damageHeld(player, 1);
    bumpInventory(player);
    lockInventory(player);
    sendProfile(player, 'bow'); scheduleSave();
    return;
  }
  if (message.action === 'eat') {
    if (Number.isInteger(message.inventoryRevision) && message.inventoryRevision !== (player.profile.inventoryRevision || 0)) {
      sendProfile(player, 'inventory_conflict'); return;
    }
    const held = heldStack(player);
    const item = held ? Registry.Items.get(held.id) : null;
    if (!held || held.id !== Number(message.itemId) || !item || !item.food) return;
    if (player.profile.hunger >= 20 && !item.food.alwaysEat) return;
    player.profile.hunger = Math.min(20, player.profile.hunger + (item.food.hunger || 0));
    const saturation = item.food.saturation === undefined ? (item.food.hunger || 0) * 0.6 : item.food.saturation;
    player.profile.saturation = Math.min(player.profile.hunger, player.profile.saturation + saturation);
    const addEffect = (type, duration, level) => {
      const current = player.profile.statusEffects.find(effect => effect.type === type);
      if (current) { current.time = Math.max(current.time, duration); current.level = Math.max(current.level, level || 0); }
      else player.profile.statusEffects.push({ type, time: duration, level: level || 0 });
    };
    if (item.food.risky && Math.random() < (item.food.riskChance === undefined ? 0.5 : item.food.riskChance)) addEffect('hunger', 30, 0);
    for (const effect of item.food.effects || []) addEffect(effect.type, effect.duration, effect.level || 0);
    if (player.profile.mode !== 'creative') {
      held.n--;
      if (held.n <= 0) player.profile.inv[player.profile.hotbar] = item.returns ? { id: item.returns, n: 1 } : null;
      else if (item.returns) {
        const left = addStack(player.profile, { id: item.returns, n: 1 });
        if (left) spawnItemEntity(player.x, player.y + 1, player.z, { id: item.returns, n: left }, 0, 2, 0);
      }
    }
    bumpInventory(player); lockInventory(player); sendProfile(player, 'eat'); scheduleSave();
    return;
  }
  if (message.action === 'feed') {
    const entity = entities.get(String(message.target || ''));
    const held = heldStack(player);
    const food = entity && entity.type === 'mob' ? BREED_FOOD[entity.kind] : undefined;
    if (!entity || food === undefined || !held || held.id !== food || !validEntityReach(player, entity, 3.25)) return;
    const now = Date.now();
    if (!(entity.babyTime > 0) && now < (entity.breedCooldownUntil || 0)) return;
    if (player.profile.mode !== 'creative') {
      held.n--;
      if (held.n <= 0) player.profile.inv[player.profile.hotbar] = null;
    }
    if (entity.babyTime > 0) {
      entity.babyTime = Math.max(0, entity.babyTime - 30);
      if (entity.babyTime === 0) {
        const stats = MOB_STATS[entity.kind];
        if (stats) { entity.w = stats.w; entity.h = stats.h; }
      }
    } else {
      entity.loveUntil = now + 30000;
      const mate = Array.from(entities.values()).find(other => other !== entity && other.type === 'mob' &&
        other.kind === entity.kind && !(other.babyTime > 0) && other.loveUntil > now &&
        now >= (other.breedCooldownUntil || 0) && Math.hypot(other.x - entity.x, other.y - entity.y, other.z - entity.z) <= 8);
      if (mate) {
        spawnMobEntity(entity.kind, (entity.x + mate.x) / 2, Math.max(entity.y, mate.y), (entity.z + mate.z) / 2, 300);
        entity.loveUntil = 0; mate.loveUntil = 0;
        entity.breedCooldownUntil = now + 300000;
        mate.breedCooldownUntil = now + 300000;
      }
    }
    lockInventory(player);
    bumpInventory(player);
    sendProfile(player, 'feed');
    scheduleSave();
    return;
  }
  if (message.action === 'interact') {
    const entity = entities.get(String(message.target || ''));
    const held = heldStack(player);
    if (!entity || entity.type !== 'mob' || !held || !validEntityReach(player, entity, 3.25)) return;
    if (message.interaction === 'tame' && entity.kind === 'wolf' && held.id === Registry.Items.IT.BONE) {
      entity.tamedBy = player.id;
      if (player.profile.mode !== 'creative') {
        held.n--;
        if (held.n <= 0) player.profile.inv[player.profile.hotbar] = null;
      }
      bumpInventory(player); lockInventory(player); sendProfile(player, 'tame'); scheduleSave();
      return;
    }
    if (message.interaction === 'trade' && entity.kind === 'villager' && held.id === Registry.Items.IT.EMERALD) {
      const offer = villagerTradeOffer(entity);
      if (!offer) { chatSystem('这名村民需要在工作站补货', player); return; }
      if (player.profile.mode !== 'creative' && held.n < offer.cost) { chatSystem('绿宝石不足', player); return; }
      if (player.profile.mode !== 'creative') {
        held.n -= offer.cost;
        if (held.n <= 0) player.profile.inv[player.profile.hotbar] = null;
      }
      const left = addStack(player.profile, { id: offer.id, n: offer.n });
      if (left > 0) spawnItemEntity(player.x, player.y + 1, player.z, { id: offer.id, n: left }, 0, 2, 0);
      entity.tradeUses = (entity.tradeUses || 0) + 1;
      entity.tradeLevel = Math.min(5, (entity.tradeLevel || 1) + ((entity.tradeUses % 3) === 0 ? 1 : 0));
      entity.restockAt = Math.max(entity.restockAt || 0, worldTime() + 120);
      bumpInventory(player); lockInventory(player); sendProfile(player, 'trade'); scheduleSave();
      return;
    }
    return;
  }
  if (message.action === 'sleep') {
    const x = Number(message.x), y = Number(message.y), z = Number(message.z);
    if (![x, y, z].every(Number.isInteger) || !validReach(player, { x, y, z }, 5)) return;
    simulationWorld.ensureChunk(x >> 4, z >> 4);
    if (simulationWorld.getBlock(x, y, z) !== Registry.Blocks.ID.BED) return;
    const clock = worldClock();
    player.profile.spawn = { x: x + 0.5, y: y + 1, z: z + 0.5 };
    if (!(clock.timeOfDay > 0.72 || clock.timeOfDay < 0.22)) {
      sendProfile(player, 'spawn');
      chatSystem('只能在夜间睡觉，重生点已设置', player);
      scheduleSave();
      return;
    }
    const monsterNear = Array.from(entities.values()).some(entity => entity.type === 'mob' && HOSTILE_MOBS.has(entity.kind) &&
      Math.hypot(entity.x - player.x, entity.y - player.y, entity.z - player.z) < 8);
    if (monsterNear) {
      chatSystem('附近有怪物，无法入睡', player);
      return;
    }
    player.sleeping = true;
    player.sleepX = player.x; player.sleepY = player.y; player.sleepZ = player.z;
    sendProfile(player, 'spawn');
    const sleepers = Array.from(players.values()).filter(other => !other.profile.dead && other.profile.mode === 'survival');
    const sleepingCount = sleepers.filter(other => other.sleeping).length;
    if (sleepers.length > 0 && sleepingCount === sleepers.length) {
      setWorldTimeOfDay(0.26);
      world.weather = 'clear'; world.weatherTimer = 240 + Math.random() * 420;
      for (const other of players.values()) other.sleeping = false;
      chatSystem('所有玩家已入睡，天亮了');
    } else {
      chatSystem(player.name + ' 已入睡（' + sleepingCount + '/' + sleepers.length + '）');
    }
    scheduleSave();
    return;
  }
  if (message.action === 'tnt') {
    const x = Number(message.x), y = Number(message.y), z = Number(message.z);
    if (![x, y, z].every(Number.isInteger) || !validReach(player, { x, y, z }, 5.1)) return;
    if (!Number.isInteger(message.inventoryRevision) || message.inventoryRevision !== (player.profile.inventoryRevision || 0)) {
      sendProfile(player, 'inventory_conflict'); return;
    }
    simulationWorld.ensureChunk(x >> 4, z >> 4);
    const held = heldStack(player);
    const item = held ? Registry.Items.get(held.id) : null;
    if (simulationWorld.getBlock(x, y, z) !== Registry.Blocks.ID.TNT || !item || !item.ignite) return;
    acceptEdits([{ x, y, z, id: 0, state: null }], null);
    const entity = { id: 'e' + nextEntityId++, type: 'tnt', x: x + 0.5, y, z: z + 0.5, vx: 0, vy: 0, vz: 0, fuse: 4, age: 0 };
    entities.set(entity.id, entity);
    if (player.profile.mode !== 'creative') damageHeld(player, 1);
    bumpInventory(player); lockInventory(player); sendProfile(player, 'tnt'); scheduleSave();
    return;
  }
  if (message.action !== 'attack') return;
  const now = Date.now();
  const interval = 1000 / Math.max(0.1, weaponAttackSpeed(player));
  const elapsed = player.lastAttack ? now - player.lastAttack : interval;
  if (elapsed < 80) return;
  const attackStrength = clamp(elapsed / interval, 0, 1);
  const damageScale = player.profile.mode === 'creative' ? 1 : Vanilla.attackScale(attackStrength);
  const attackItem = heldStack(player) ? Registry.Items.get(heldStack(player).id) : null;
  const critical = player.profile.mode === 'survival' && attackStrength > 0.9 && !player.onGround &&
    (player.vy || 0) < -0.05 && !player.sprinting;
  const attackDamage = weaponDamage(player) * damageScale * (critical ? 1.5 : 1);
  const disablesShield = !!(attackItem && attackItem.tool && attackItem.tool.type === 'axe' && attackStrength > 0.9);
  player.lastAttack = now;
  const targetPlayer = message.targetType === 'player' ? players.get(String(message.target)) : null;
  if (targetPlayer && targetPlayer !== player && validMeleeTarget(player, targetPlayer, message)) {
    const dx = targetPlayer.x - player.x, dz = targetPlayer.z - player.z, distance = Math.hypot(dx, dz) || 1;
    const knockback = attackStrength > 0.9 ? 7 : 3.5;
    const hit = damagePlayer(targetPlayer, attackDamage, 'player', player.name,
      { x: dx / distance * knockback, y: attackStrength > 0.9 ? 3.5 : 1.6, z: dz / distance * knockback },
      { disableShield: disablesShield });
    if (player.profile.mode !== 'creative') damageHeld(player, 1);
    bumpInventory(player);
    lockInventory(player);
    sendProfile(player, 'attack');
    sendJSON(player.socket, { t: 'attack_result', hit, critical, targetType: 'player', target: targetPlayer.id, hp: targetPlayer.profile.hp });
    return;
  }
  if (targetPlayer) { sendJSON(player.socket, { t: 'attack_result', hit: false, targetType: 'player', target: targetPlayer.id }); return; }
  const entity = message.targetType === 'entity' ? entities.get(String(message.target)) : null;
  if (!entity || entity.type !== 'mob') return;
  if (!validMeleeTarget(player, entity, message)) {
    sendJSON(player.socket, { t: 'attack_result', hit: false, targetType: 'entity', target: entity.id });
    return;
  }
  entity.hp -= attackDamage;
  if (entity.hp > 0 && PASSIVE_MOBS.has(entity.kind)) startMobFlee(entity, player.x, player.z, player.id);
  if (entity.kind === 'enderman') {
    entity.provokedUntil = now + 20000;
    if (Math.random() < 0.45) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const tx = entity.x + (Math.random() - 0.5) * 24, tz = entity.z + (Math.random() - 0.5) * 24;
        const ty = findMobSpawnY('enderman', tx, tz);
        if (ty === null) continue;
        entity.x = tx; entity.y = ty; entity.z = tz; entity.vx = entity.vy = entity.vz = 0;
        break;
      }
    }
  }
  if (player.profile.mode !== 'creative') damageHeld(player, 1);
  bumpInventory(player);
  lockInventory(player);
  let sweep = 0;
  const swordSweep = attackStrength > 0.9 && player.onGround && !player.sprinting && attackItem &&
    attackItem.tool && attackItem.tool.type === 'sword';
  if (swordSweep) {
    const sweepDamage = 1;
    for (const other of Array.from(entities.values())) {
      if (other === entity || other.type !== 'mob') continue;
      if (Math.abs(other.y - entity.y) > 1.2 || Math.hypot(other.x - entity.x, other.z - entity.z) > 1.5) continue;
      other.hp -= sweepDamage;
      sweep++;
      if (other.hp > 0 && PASSIVE_MOBS.has(other.kind)) startMobFlee(other, player.x, player.z, player.id);
      if (other.hp <= 0) killMob(other, player);
    }
  }
  sendJSON(player.socket, { t: 'attack_result', hit: true, critical, sweep, targetType: 'entity', target: entity.id, hp: Math.max(0, entity.hp) });
  if (entity.hp <= 0) killMob(entity, player);
  sendProfile(player, 'attack');
}

function tickFurnaces(dt) {
  for (const container of world.containers.values()) {
    if (container.type !== 'furnace') continue;
    const wasLit = container.burn > 0;
    const input = container.slots[0], fuel = container.slots[1], output = container.slots[2];
    const smelt = input ? Registry.Items.SMELT[input.id] : null;
    const canSmelt = !!smelt && (!output || (output.id === smelt.id && output.n + smelt.n <= Registry.Items.maxStack(output.id)));
    let changed = false, slotsChanged = false;
    if (container.burn > 0) { container.burn = Math.max(0, container.burn - dt); changed = true; }
    if (container.burn <= 0 && canSmelt && fuel && Registry.Items.FUEL[fuel.id]) {
      container.burn = Registry.Items.FUEL[fuel.id]; container.burnMax = container.burn;
      fuel.n--; if (fuel.n <= 0) container.slots[1] = null;
      changed = true; slotsChanged = true;
    }
    if (container.burn > 0 && canSmelt) {
      container.cook += dt;
      if (container.cook >= 10) {
        container.cook = 0; input.n--; if (input.n <= 0) container.slots[0] = null;
        if (output) output.n += smelt.n; else container.slots[2] = { id: smelt.id, n: smelt.n };
        container.xpStored += (Number(smelt.xp) || 0) * smelt.n;
        slotsChanged = true;
      }
      changed = true;
    } else if (container.cook > 0) {
      container.cook = Math.max(0, container.cook - dt * 2); changed = true;
    }
    if (changed) {
      if (slotsChanged) container.revision++;
      if (!container.lastBroadcast || Date.now() - container.lastBroadcast > 500) {
        container.lastBroadcast = Date.now(); broadcast(containerPacket(container));
      }
    }
    const isLit = container.burn > 0;
    if (isLit !== wasLit) {
      const state = simulationWorld.getState(container.x, container.y, container.z);
      acceptEdits([{
        x: container.x, y: container.y, z: container.z,
        id: isLit ? Registry.Blocks.ID.FURNACE_LIT : Registry.Blocks.ID.FURNACE,
        state: Number.isInteger(state) ? state : null,
      }], null);
    }
  }
}

function nearestLivingPlayer(entity, maxDistance) {
  let result = null, best = maxDistance * maxDistance;
  for (const player of players.values()) {
    if (player.profile.dead || player.profile.mode === 'creative') continue;
    const dx = player.x - entity.x, dy = player.y - entity.y, dz = player.z - entity.z;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < best) { best = distance; result = player; }
  }
  return result;
}

function mobCanSeePlayer(entity, player, maxDistance) {
  const ox = entity.x, oy = entity.y + entity.h * 0.82, oz = entity.z;
  const tx = player.x, ty = player.y + 1.62, tz = player.z;
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-6 || distance > maxDistance) return false;
  const hit = simulationWorld.raycast(ox, oy, oz, dx / distance, dy / distance, dz / distance, distance);
  return !hit || hit.dist >= distance - 0.45;
}

function nearestTemptingPlayer(entity, maxDistance) {
  const food = BREED_FOOD[entity.kind];
  if (food === undefined) return null;
  let result = null, best = maxDistance * maxDistance;
  for (const player of players.values()) {
    if (player.profile.dead) continue;
    const stack = heldStack(player);
    if (!stack || stack.id !== food) continue;
    const dx = player.x - entity.x, dy = player.y - entity.y, dz = player.z - entity.z;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < best) { best = distance; result = player; }
  }
  return result;
}

function nearestHostileMob(entity, maxDistance) {
  let result = null, best = maxDistance * maxDistance;
  for (const other of entities.values()) {
    if (other === entity || other.type !== 'mob' || !HOSTILE_MOBS.has(other.kind) || other.kind === 'ender_dragon') continue;
    const dx = other.x - entity.x, dy = other.y - entity.y, dz = other.z - entity.z;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < best) { best = distance; result = other; }
  }
  return result;
}

function villagerSchedule(entity) {
  const time = worldClock().timeOfDay;
  if (time < 0.20 || time > 0.78) return entity.home ? { point: entity.home, role: 'home' } : null;
  if (time >= 0.25 && time < 0.56 && entity.jobSite) return { point: entity.jobSite, role: 'job' };
  if (time >= 0.56 && time < 0.72 && entity.meeting) return { point: entity.meeting, role: 'meeting' };
  return entity.home ? { point: entity.home, role: 'home' } : (entity.meeting ? { point: entity.meeting, role: 'meeting' } : null);
}

function explodeSimulation(x, y, z, power) {
  const radius = Math.ceil(power);
  simulationWorld.beginBatch();
  try {
    for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) for (let dz = -radius; dz <= radius; dz++) {
      const distance = Math.hypot(dx, dy, dz);
      if (distance > power || Math.random() > (1 - distance / power) * 1.35) continue;
      const bx = Math.floor(x) + dx, by = Math.floor(y) + dy, bz = Math.floor(z) + dz;
      if (by < 1 || by >= 256) continue;
      simulationWorld.ensureChunk(bx >> 4, bz >> 4);
      const id = simulationWorld.getBlock(bx, by, bz);
      if (id === 0 || id === Registry.Blocks.ID.BEDROCK || id === Registry.Blocks.ID.WATER || Registry.Blocks.get(id).hardness < 0) continue;
      const state = simulationWorld.getState(bx, by, bz);
      simulationWorld.setBlock(bx, by, bz, 0);
      if (Math.random() < 0.3) {
        for (const drop of Registry.Blocks.dropsFor(id, state, Math.random)) spawnItemEntity(bx + 0.5, by + 0.3, bz + 0.5, drop, 0, 2, 0);
      }
    }
  } finally { simulationWorld.endBatch(); }
}

function spawnHostileArrow(entity, target) {
  const dx = target.x - entity.x, dy = target.y + 1 - (entity.y + 1.4), dz = target.z - entity.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  const speed = 16;
  const arrow = {
    id: 'e' + nextEntityId++, type: 'arrow', owner: entity.id, ownerKind: entity.kind,
    x: entity.x + dx / length * 0.8, y: entity.y + 1.4, z: entity.z + dz / length * 0.8,
    vx: dx / length * speed, vy: dy / length * speed + 0.8, vz: dz / length * speed,
    damage: 3, age: 0,
  };
  entities.set(arrow.id, arrow);
}

function rayAabb(ox, oy, oz, dx, dy, dz, entity, maxDistance) {
  const half = (Number(entity.w) || 0.6) / 2;
  const height = Number(entity.h) || 1.8;
  const min = [entity.x - half, entity.y, entity.z - half];
  const max = [entity.x + half, entity.y + height, entity.z + half];
  const origin = [ox, oy, oz];
  const direction = [dx, dy, dz];
  let near = 0;
  let far = maxDistance;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < 1e-8) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return null;
      continue;
    }
    let entry = (min[axis] - origin[axis]) / direction[axis];
    let exit = (max[axis] - origin[axis]) / direction[axis];
    if (entry > exit) { const swap = entry; entry = exit; exit = swap; }
    near = Math.max(near, entry);
    far = Math.min(far, exit);
    if (near > far) return null;
  }
  return near <= maxDistance ? near : null;
}

function findMobSpawnY(kind, x, z, requireNaturalGround) {
  const stats = MOB_STATS[kind];
  if (!stats) return null;
  const bx = Math.floor(x), bz = Math.floor(z);
  simulationWorld.ensureChunk(bx >> 4, bz >> 4);
  const probe = { x, y: 0, z, w: stats.w, h: stats.h };
  const ID = Registry.Blocks.ID;
  const dimension = simulationWorld.dimensionAt ? simulationWorld.dimensionAt(bx, bz) : 'overworld';
  for (let y = dimension === 'nether' ? 108 : 254; y >= 1; y--) {
    const id = simulationWorld.getBlock(bx, y, bz);
    const def = Registry.Blocks.get(id);
    if (!def.solid || def.liquid) continue;
    if (requireNaturalGround !== false && PASSIVE_MOBS.has(kind) && kind !== 'bat' && kind !== 'squid' && id !== ID.GRASS && id !== ID.GRASS_SNOW) continue;
    const shape = def.collision || { y: 0, h: 1 };
    const feetY = y + shape.y + shape.h;
    if (Registry.Physics.canOccupy(simulationWorld, probe, x, feetY, z)) return feetY;
  }
  return null;
}

function clearMobNavigation(entity, immediate) {
  entity.navPath = null;
  entity.navPathIndex = 0;
  entity.navValidateAt = 0;
  entity.navBlockedTime = 0;
  if (immediate) entity.navRepathAt = 0;
}

function startMobFlee(entity, threatX, threatZ, threatId) {
  let dx = entity.x - threatX, dz = entity.z - threatZ;
  const length = Math.hypot(dx, dz);
  if (length < 0.1) {
    const angle = Math.random() * Math.PI * 2;
    dx = Math.cos(angle); dz = Math.sin(angle);
  } else {
    dx /= length; dz /= length;
  }
  const side = (Math.random() - 0.5) * 3;
  entity.aiMode = 'flee';
  entity.aiTimer = 2.4 + Math.random() * 0.8;
  entity.fleeThreatId = threatId || '';
  entity.fleeTargetX = entity.x + dx * 8 - dz * side;
  entity.fleeTargetY = entity.y;
  entity.fleeTargetZ = entity.z + dz * 8 + dx * side;
  clearMobNavigation(entity, true);
}

function updateMobFleeGoal(entity, dt) {
  if (entity.aiMode !== 'flee') return null;
  entity.aiTimer -= dt;
  if (entity.aiTimer <= 0 || !Number.isFinite(entity.fleeTargetX + entity.fleeTargetZ)) {
    entity.aiMode = 'idle';
    entity.aiTimer = 0.8 + Math.random() * 1.8;
    entity.fleeThreatId = '';
    return null;
  }
  return {
    type: 'flee', key: 'flee:' + entity.fleeThreatId,
    x: entity.fleeTargetX, y: entity.fleeTargetY, z: entity.fleeTargetZ,
    speed: entity.speed * 1.45, stopDistance: 0.7, maxRange: 12,
  };
}

function mobWanderGoal(entity, dt) {
  if (entity.aiMode === 'wander') {
    entity.aiTimer -= dt;
    const distance = Math.hypot((entity.wanderTargetX || entity.x) - entity.x,
      (entity.wanderTargetZ || entity.z) - entity.z);
    if (entity.aiTimer > 0 && distance > 0.7) {
      return {
        type: 'wander', key: 'wander',
        x: entity.wanderTargetX, y: entity.y, z: entity.wanderTargetZ,
        speed: entity.speed * 0.62, stopDistance: 0.65, maxRange: 10,
      };
    }
    entity.aiMode = 'idle';
    entity.aiTimer = 1.5 + Math.random() * 4;
    clearMobNavigation(entity, true);
    return null;
  }
  entity.aiTimer -= dt;
  if (entity.aiTimer > 0) return null;
  const angle = Math.random() * Math.PI * 2;
  const distance = 4 + Math.random() * 4;
  entity.aiMode = 'wander';
  entity.aiTimer = 4 + Math.random() * 3;
  entity.wanderTargetX = entity.x + Math.cos(angle) * distance;
  entity.wanderTargetZ = entity.z + Math.sin(angle) * distance;
  return {
    type: 'wander', key: 'wander',
    x: entity.wanderTargetX, y: entity.y, z: entity.wanderTargetZ,
    speed: entity.speed * 0.62, stopDistance: 0.65, maxRange: 10,
  };
}

function selectMobGoal(candidates) {
  let selected = null;
  for (const candidate of candidates) {
    if (!candidate || !Number.isFinite(candidate.x + candidate.y + candidate.z)) continue;
    if (!selected || MOB_GOAL_PRIORITY[candidate.type] < MOB_GOAL_PRIORITY[selected.type]) selected = candidate;
  }
  return selected;
}

function mobNavigationNodeKey(x, y, z) {
  return x + ',' + Math.round(y * 10) + ',' + z;
}

function mobNavigationNodeAt(entity, x, z, fromY) {
  simulationWorld.ensureChunk(x >> 4, z >> 4);
  const px = x + 0.5, pz = z + 0.5;
  const baseY = Math.round(fromY * 10) / 10;
  for (const offset of MOB_NAV_HEIGHT_OFFSETS) {
    const y = Math.round((baseY + offset) * 10) / 10;
    if (y < 1 || y + entity.h >= 255) continue;
    if (!Registry.Physics.canOccupy(simulationWorld, entity, px, y, pz)) continue;
    if (Registry.Physics.supportCount(simulationWorld, entity, px, y, pz) < 2) continue;
    return { x, y, z };
  }
  return null;
}

function mobNavigationNodeValid(entity, node) {
  if (!node) return false;
  simulationWorld.ensureChunk(node.x >> 4, node.z >> 4);
  return Registry.Physics.canOccupy(simulationWorld, entity, node.x + 0.5, node.y, node.z + 0.5) &&
    Registry.Physics.supportCount(simulationWorld, entity, node.x + 0.5, node.y, node.z + 0.5) >= 2;
}

function mobNavigationHeapPush(heap, node) {
  heap.push(node);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (heap[parent].f < node.f || (heap[parent].f === node.f && heap[parent].order <= node.order)) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = node;
}

function mobNavigationHeapPop(heap) {
  if (!heap.length) return null;
  const root = heap[0];
  const tail = heap.pop();
  if (!heap.length) return root;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    let child = left;
    if (right < heap.length && (heap[right].f < heap[left].f ||
        (heap[right].f === heap[left].f && heap[right].order < heap[left].order))) child = right;
    if (heap[child].f > tail.f || (heap[child].f === tail.f && heap[child].order >= tail.order)) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = tail;
  return root;
}

function findMobNavigationPath(entity, goal) {
  if (mobNavigationSearchBudget <= 0 || mobNavigationNodeBudget <= 0) return null;
  mobNavigationSearchBudget--;
  const startX = Math.floor(entity.x), startZ = Math.floor(entity.z);
  const start = mobNavigationNodeAt(entity, startX, startZ, entity.y);
  if (!start) return null;

  let targetX = Math.floor(goal.x), targetZ = Math.floor(goal.z);
  const maxRange = Math.max(4, Math.min(28, goal.maxRange || 24));
  const targetDistance = Math.hypot(targetX - startX, targetZ - startZ);
  if (targetDistance > maxRange - 1) {
    targetX = Math.floor(startX + (targetX - startX) / targetDistance * (maxRange - 1));
    targetZ = Math.floor(startZ + (targetZ - startZ) / targetDistance * (maxRange - 1));
  }
  const goalRadius = Math.max(0, Math.floor(goal.stopDistance || 0));
  const heuristic = node => Math.max(0, Math.abs(node.x - targetX) + Math.abs(node.z - targetZ) - goalRadius) +
    Math.abs(node.y - goal.y) * 0.25;
  const open = [];
  const best = new Map();
  const closed = new Set();
  let order = 0;
  start.g = 0; start.f = heuristic(start); start.parent = null; start.order = order++;
  best.set(mobNavigationNodeKey(start.x, start.y, start.z), 0);
  mobNavigationHeapPush(open, start);
  let expanded = 0;

  while (open.length && expanded < MOB_NAV_NODES_PER_SEARCH && mobNavigationNodeBudget > 0) {
    const current = mobNavigationHeapPop(open);
    const currentKey = mobNavigationNodeKey(current.x, current.y, current.z);
    if (closed.has(currentKey) || current.g !== best.get(currentKey)) continue;
    closed.add(currentKey);
    expanded++;
    mobNavigationNodeBudget--;
    if (Math.abs(current.x - targetX) + Math.abs(current.z - targetZ) <= goalRadius &&
        Math.abs(current.y - goal.y) <= 2.1) {
      const path = [];
      for (let node = current; node && node.parent; node = node.parent) path.push({ x: node.x, y: node.y, z: node.z });
      path.reverse();
      return path;
    }
    for (const direction of MOB_NAV_DIRECTIONS) {
      const nx = current.x + direction[0], nz = current.z + direction[1];
      if (Math.abs(nx - startX) > maxRange || Math.abs(nz - startZ) > maxRange) continue;
      const next = mobNavigationNodeAt(entity, nx, nz, current.y);
      if (!next) continue;
      const key = mobNavigationNodeKey(next.x, next.y, next.z);
      if (closed.has(key)) continue;
      const cost = current.g + 1 + Math.abs(next.y - current.y) * 0.45;
      if (best.has(key) && best.get(key) <= cost) continue;
      best.set(key, cost);
      next.g = cost;
      next.f = cost + heuristic(next);
      next.parent = current;
      next.order = order++;
      mobNavigationHeapPush(open, next);
    }
  }
  return null;
}

function mobNavigationIntent(entity, goal) {
  if (!goal) return [0, 0];
  const now = Date.now();
  const goalKey = goal.type + ':' + (goal.key || 'point');
  if (entity.navGoalKey !== goalKey) {
    entity.navGoalKey = goalKey;
    entity.goalType = goal.type;
    clearMobNavigation(entity, true);
  }

  const targetMoved = !Number.isFinite(entity.navTargetX + entity.navTargetZ) ||
    Math.hypot(goal.x - entity.navTargetX, goal.z - entity.navTargetZ) > 1.5;
  let path = entity.navPath;
  let index = entity.navPathIndex || 0;
  while (path && index < path.length) {
    const node = path[index];
    if (Math.hypot(node.x + 0.5 - entity.x, node.z + 0.5 - entity.z) > 0.38 || Math.abs(node.y - entity.y) > 1.15) break;
    index++;
  }
  entity.navPathIndex = index;

  const nextNode = path && index < path.length ? path[index] : null;
  if (nextNode && now >= (entity.navValidateAt || 0)) {
    entity.navValidateAt = now + 200;
    if (!mobNavigationNodeValid(entity, nextNode)) {
      clearMobNavigation(entity, true);
      path = null;
      index = 0;
    }
  }

  const needsPath = !path || index >= path.length || targetMoved || now >= (entity.navExpiresAt || 0);
  if (needsPath && now >= (entity.navRepathAt || 0) && mobNavigationSearchBudget > 0) {
    const replacement = findMobNavigationPath(entity, goal);
    entity.navRepathAt = now + (replacement ? (goal.type === 'chase' ? 700 : 1200) : 220);
    if (replacement) {
      entity.navPath = path = replacement;
      entity.navPathIndex = index = 0;
      entity.navTargetX = goal.x; entity.navTargetY = goal.y; entity.navTargetZ = goal.z;
      entity.navExpiresAt = now + (goal.type === 'chase' || goal.type === 'flee' ? 1500 : 2800);
    }
  }

  const distance = Math.hypot(goal.x - entity.x, goal.z - entity.z);
  if (distance <= (goal.stopDistance || 0.5)) return [0, 0];
  path = entity.navPath;
  index = entity.navPathIndex || 0;
  const waypoint = path && index < path.length ? path[index] : null;
  let dx = waypoint ? waypoint.x + 0.5 - entity.x : goal.x - entity.x;
  let dz = waypoint ? waypoint.z + 0.5 - entity.z : goal.z - entity.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return [0, 0];
  dx /= length; dz /= length;

  if (!waypoint) {
    const lookAhead = entity.w * 0.5 + 0.55;
    const safe = mobNavigationNodeAt(entity, Math.floor(entity.x + dx * lookAhead),
      Math.floor(entity.z + dz * lookAhead), entity.y);
    if (!safe) return [0, 0];
  }
  return [dx, dz];
}

function turnMob(entity, x, z, dt) {
  if (Math.abs(x) + Math.abs(z) < 1e-6) return;
  const target = Math.atan2(x, -z);
  const delta = Math.atan2(Math.sin(target - entity.yaw), Math.cos(target - entity.yaw));
  entity.yaw += delta * Math.min(1, dt * (HOSTILE_MOBS.has(entity.kind) ? 6 : 3.5));
}

function mobStepHeight(entity, moveX, moveZ) {
  const length = Math.hypot(moveX, moveZ);
  if (!entity.onGround || length < 1e-6) return 0;
  const nx = moveX / length, nz = moveZ / length;
  const speed = Math.hypot(entity.vx || 0, entity.vz || 0);
  const lookAhead = entity.w * 0.5 + clamp(0.16 + speed * 0.04, 0.16, 0.32);
  const aheadX = entity.x + nx * lookAhead;
  const aheadZ = entity.z + nz * lookAhead;
  if (Registry.Physics.canOccupy(simulationWorld, entity, aheadX, entity.y, aheadZ)) return 0;
  return Registry.Physics.findStepHeight(simulationWorld, entity, aheadX, aheadZ, 1.05);
}

function daylightFactorAt(timeOfDay) {
  const value = Math.sin(timeOfDay * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.55;
  return clamp(value, 0.03, 1);
}

function tickUndeadDaylight(entity, dt, clock) {
  if (entity.kind !== 'zombie' && entity.kind !== 'skeleton') return false;
  const bx = Math.floor(entity.x), by = Math.floor(entity.y + entity.h + 0.05), bz = Math.floor(entity.z);
  const exposed = simulationWorld.getSky(bx, by, bz) >= 14;
  const dimension = simulationWorld.dimensionAt ? simulationWorld.dimensionAt(bx, bz) : 'overworld';
  const inWater = Registry.Physics.isInLiquid(simulationWorld, entity, 'water');
  const rainWet = world.weather === 'rain' && exposed;
  const ignitedBySun = dimension === 'overworld' && exposed && daylightFactorAt(clock.timeOfDay) > 0.55;
  if (inWater || rainWet) entity.fireTime = 0;
  else if (ignitedBySun) entity.fireTime = Math.max(entity.fireTime || 0, 8);
  else entity.fireTime = Math.max(0, (entity.fireTime || 0) - dt);
  entity.burning = entity.fireTime > 0;
  if (!entity.burning) {
    entity.fireDamageClock = 0;
    return false;
  }
  entity.fireDamageClock = (entity.fireDamageClock || 0) + dt;
  if (entity.fireDamageClock < 1) return false;
  entity.fireDamageClock %= 1;
  entity.hp -= 2;
  if (entity.hp > 0) return false;
  killMob(entity, null);
  return true;
}

function moveMobWithPhysics(entity, moveX, moveZ, speed, dt) {
  const length = Math.hypot(moveX, moveZ);
  if (length > 1e-6 && speed > 0) {
    moveX /= length; moveZ /= length;
    turnMob(entity, moveX, moveZ, dt);
    const blend = Math.min(1, dt * 10);
    entity.vx += (moveX * speed - entity.vx) * blend;
    entity.vz += (moveZ * speed - entity.vz) * blend;
  } else {
    const drag = Math.max(0, 1 - dt * 9);
    entity.vx *= drag;
    entity.vz *= drag;
    if (Math.abs(entity.vx) < 0.01) entity.vx = 0;
    if (Math.abs(entity.vz) < 0.01) entity.vz = 0;
  }

  const nextX = entity.x + entity.vx * dt;
  const nextZ = entity.z + entity.vz * dt;
  simulationWorld.ensureChunk(Math.floor(nextX) >> 4, Math.floor(nextZ) >> 4);

  const wasOnGround = entity.onGround;
  let stepping = false;
  if (length > 1e-6 && wasOnGround && (entity.jumpCooldown || 0) <= 0) {
    const stepHeight = mobStepHeight(entity, moveX, moveZ);
    if (stepHeight > 0 || entity.kind === 'slime') {
      entity.vy = entity.kind === 'slime' ? 7.2 : 7.8;
      entity.onGround = false;
      entity.jumpCooldown = entity.kind === 'slime' ? 0.55 : 0.28;
      stepping = true;
    }
  }

  if (Registry.Physics.isInLiquid(simulationWorld, entity)) {
    entity.vy += 9 * dt;
    entity.vy *= Math.max(0, 1 - dt * 1.5);
  } else {
    entity.vy -= 24 * dt;
  }
  entity.vy = clamp(entity.vy, -24, 10);

  const oldX = entity.x, oldZ = entity.z;
  const expected = Math.hypot(entity.vx, entity.vz) * dt;
  Registry.Physics.move(simulationWorld, entity, dt);
  const moved = Math.hypot(entity.x - oldX, entity.z - oldZ);
  if (!stepping && length > 1e-6 && wasOnGround && expected > 0.02 && moved < expected * 0.15) {
    entity.navBlockedTime = (entity.navBlockedTime || 0) + dt;
    if (entity.navBlockedTime >= 0.35) {
      clearMobNavigation(entity, true);
      entity.navRepathAt = Date.now() + 80;
    }
  } else if (moved > 0.01 || length < 1e-6) {
    entity.navBlockedTime = 0;
  }
}

function tickMobEntity(entity, dt, clock) {
  const stats = MOB_STATS[entity.kind];
  if (!stats) { entities.delete(entity.id); return; }
  entity.attackCooldown = Math.max(0, entity.attackCooldown - dt);
  entity.jumpCooldown = Math.max(0, (entity.jumpCooldown || 0) - dt);
  if (entity.babyTime > 0) {
    entity.babyTime = Math.max(0, entity.babyTime - dt);
    if (entity.babyTime === 0) {
      const stats = MOB_STATS[entity.kind];
      if (stats) { entity.w = stats.w; entity.h = stats.h; }
    }
  }
  simulationWorld.ensureChunk(Math.floor(entity.x) >> 4, Math.floor(entity.z) >> 4);
  if (tickUndeadDaylight(entity, dt, clock)) return;
  const hostileActive = HOSTILE_MOBS.has(entity.kind) && (!stats.neutral || Date.now() < (entity.provokedUntil || 0));
  if (stats.aquatic) {
    entity.aiTimer -= dt;
    if (entity.aiTimer <= 0) {
      const angle = Math.random() * Math.PI * 2;
      entity.dirX = Math.cos(angle); entity.dirZ = Math.sin(angle); entity.dirY = (Math.random() - 0.5) * 0.8;
      entity.aiTimer = 1.5 + Math.random() * 3;
    }
    const inWater = Registry.Physics.isInLiquid(simulationWorld, entity, 'water');
    const blend = Math.min(1, dt * 3);
    entity.vx += ((entity.dirX || 0) * stats.speed - entity.vx) * blend;
    entity.vz += ((entity.dirZ || 0) * stats.speed - entity.vz) * blend;
    entity.vy += ((inWater ? entity.dirY || 0 : -1.5) - entity.vy) * blend;
    turnMob(entity, entity.vx, entity.vz, dt);
    Registry.Physics.move(simulationWorld, entity, dt);
    if (entity.y < -16 || !Number.isFinite(entity.x + entity.y + entity.z)) entities.delete(entity.id);
    return;
  }
  if (stats.flying) {
    const target = hostileActive ? nearestLivingPlayer(entity, 24) : null;
    entity.aiTimer -= dt;
    let dx = entity.dirX || 0, dz = entity.dirZ || 0, dy = entity.dirY || 0;
    if (target) {
      const distance = Math.max(0.1, Math.hypot(target.x - entity.x, target.y + 1 - entity.y, target.z - entity.z));
      dx = (target.x - entity.x) / distance; dy = (target.y + 1 - entity.y) / distance; dz = (target.z - entity.z) / distance;
      if (distance < 1.7 && entity.attackCooldown <= 0) {
        entity.attackCooldown = 1.1;
        const damage = (entity.kind === 'ender_dragon' ? 10 : 5) * [0, 0.75, 1, 1.5][world.difficulty];
        damagePlayer(target, damage, 'mob', entity.kind,
          { x: dx * 5, y: 2.5, z: dz * 5 });
      }
    } else if (entity.aiTimer <= 0) {
      const angle = Math.random() * Math.PI * 2;
      entity.dirX = dx = Math.cos(angle); entity.dirZ = dz = Math.sin(angle); entity.dirY = dy = (Math.random() - 0.5) * 0.7;
      entity.aiTimer = 1 + Math.random() * 3;
    }
    const blend = Math.min(1, dt * 4);
    entity.vx += (dx * stats.speed - entity.vx) * blend;
    entity.vy += (dy * stats.speed - entity.vy) * blend;
    entity.vz += (dz * stats.speed - entity.vz) * blend;
    turnMob(entity, entity.vx, entity.vz, dt);
    Registry.Physics.move(simulationWorld, entity, dt);
    if (entity.y < 1 || !Number.isFinite(entity.x + entity.y + entity.z)) entities.delete(entity.id);
    return;
  }
  if (!Registry.Physics.canOccupy(simulationWorld, entity, entity.x, entity.y, entity.z)) {
    const correctedY = findMobSpawnY(entity.kind, entity.x, entity.z, false);
    if (correctedY === null) { entities.delete(entity.id); return; }
    entity.y = correctedY;
    entity.vy = 0;
  }

  let fleeGoal = updateMobFleeGoal(entity, dt);
  if (entity.villageId) {
    const villageGoals = [];
    if (fleeGoal) villageGoals.push(fleeGoal);
    let handled = false;
    if (entity.kind === 'iron_golem') {
      const threat = nearestHostileMob(entity, 22);
      if (threat) {
        const dx = threat.x - entity.x, dz = threat.z - entity.z, distance = Math.hypot(dx, dz) || 1;
        villageGoals.push({
          type: 'chase', key: 'golem:' + threat.id, target: threat,
          x: threat.x, y: threat.y, z: threat.z,
          speed: entity.speed * 1.12, stopDistance: 1.8, maxRange: 24,
        });
        handled = true;
        if (distance < 2.2 && Math.abs(threat.y - entity.y) < 3 && entity.attackCooldown <= 0) {
          entity.attackCooldown = 1.2;
          threat.hp -= 8 + Math.floor(Math.random() * 5);
          threat.vx += dx / distance * 5; threat.vy += 4.5; threat.vz += dz / distance * 5;
          if (threat.hp <= 0) killMob(threat, null);
        }
      } else if (entity.meeting) {
        const dx = entity.meeting.x - entity.x, dz = entity.meeting.z - entity.z, distance = Math.hypot(dx, dz) || 1;
        if (distance > 18) {
          villageGoals.push({
            type: 'home', key: 'meeting',
            x: entity.meeting.x + 0.5, y: entity.meeting.y, z: entity.meeting.z + 0.5,
            speed: entity.speed * 0.85, stopDistance: 12, maxRange: 26,
          });
          handled = true;
        }
      }
    } else if (entity.kind === 'villager') {
      const threat = nearestHostileMob(entity, 10);
      if (threat) {
        if (entity.aiMode !== 'flee' || entity.fleeThreatId !== threat.id || entity.aiTimer < 0.3) {
          startMobFlee(entity, threat.x, threat.z, threat.id);
        }
        fleeGoal = updateMobFleeGoal(entity, 0);
        if (fleeGoal) {
          fleeGoal.speed = entity.speed * 1.35;
          villageGoals.push(fleeGoal);
        }
        entity.sleeping = false; handled = true;
      } else {
        const schedule = villagerSchedule(entity);
        if (schedule) {
          const dx = schedule.point.x + 0.5 - entity.x, dz = schedule.point.z + 0.5 - entity.z;
          const distance = Math.hypot(dx, dz) || 1;
          entity.sleeping = schedule.role === 'home' && (worldClock().timeOfDay < 0.20 || worldClock().timeOfDay > 0.78) && distance < 1.5;
          if (schedule.role === 'job' && distance < 2 && worldTime() >= (entity.restockAt || 0)) {
            if (entity.tradeUses > 0) scheduleSave();
            entity.tradeUses = 0;
            entity.restockAt = worldTime() + 120;
          }
          if (!entity.sleeping && distance > 0.8) {
            villageGoals.push({
              type: 'home', key: schedule.role,
              x: schedule.point.x + 0.5, y: schedule.point.y, z: schedule.point.z + 0.5,
              speed: entity.speed * 0.82, stopDistance: 0.75, maxRange: 26,
            });
          }
          handled = true;
        }
      }
    } else if (entity.kind === 'cat' && entity.meeting) {
      const dx = entity.meeting.x - entity.x, dz = entity.meeting.z - entity.z, distance = Math.hypot(dx, dz) || 1;
      if (distance > 16) {
        villageGoals.push({
          type: 'home', key: 'meeting',
          x: entity.meeting.x + 0.5, y: entity.meeting.y, z: entity.meeting.z + 0.5,
          speed: entity.speed, stopDistance: 10, maxRange: 24,
        });
        handled = true;
      }
    }
    if (handled) {
      const goal = selectMobGoal(villageGoals);
      if (goal && goal.type !== 'wander' && entity.aiMode === 'wander') {
        entity.aiMode = 'idle'; entity.aiTimer = 1 + Math.random() * 2;
      }
      const intent = goal ? mobNavigationIntent(entity, goal) : [0, 0];
      moveMobWithPhysics(entity, intent[0], intent[1], goal ? goal.speed : 0, dt);
      if (entity.y < -16 || !Number.isFinite(entity.x + entity.y + entity.z)) entities.delete(entity.id);
      return;
    }
  }

  let moveX = 0, moveZ = 0, moveSpeed = 0;
  let target = hostileActive ? nearestLivingPlayer(entity, 24) : null;
  let targetVisible = !!(target && mobCanSeePlayer(entity, target, 24));
  if (targetVisible) {
    entity.targetPlayerId = target.id;
    entity.targetMemoryUntil = Date.now() + 4500;
    entity.lastSeenX = target.x; entity.lastSeenY = target.y; entity.lastSeenZ = target.z;
  } else if (hostileActive && target && Math.hypot(target.x - entity.x, target.z - entity.z) <= 16) {
    entity.targetPlayerId = target.id;
    entity.targetMemoryUntil = Date.now() + 1800;
    entity.lastSeenX = target.x; entity.lastSeenY = target.y; entity.lastSeenZ = target.z;
  } else if (hostileActive && Date.now() < (entity.targetMemoryUntil || 0)) {
    target = {
      x: entity.lastSeenX, y: entity.lastSeenY, z: entity.lastSeenZ,
      profile: { dead: false, mode: 'survival' }, remembered: true,
    };
  } else if (hostileActive) {
    target = null;
    entity.targetPlayerId = null;
  }
  if (!target && entity.kind === 'wolf' && entity.tamedBy) target = players.get(entity.tamedBy) || null;
  const temptingTarget = nearestTemptingPlayer(entity, 10);
  const goals = [];
  if (fleeGoal) goals.push(fleeGoal);
  if (target) {
    goals.push({
      type: 'chase', key: target.id || entity.targetPlayerId || 'memory', target,
      x: target.x, y: target.y, z: target.z,
      speed: entity.speed * (entity.kind === 'wolf' && entity.tamedBy ? 1.15 : 1),
      stopDistance: entity.kind === 'wolf' && entity.tamedBy ? 3 : 1.2, maxRange: 26,
    });
  }
  if (temptingTarget) {
    goals.push({
      type: 'tempt', key: temptingTarget.id, target: temptingTarget,
      x: temptingTarget.x, y: temptingTarget.y, z: temptingTarget.z,
      speed: entity.speed * 1.05, stopDistance: 2, maxRange: 12,
    });
  }
  let selectedGoal = selectMobGoal(goals);
  if (!selectedGoal) selectedGoal = mobWanderGoal(entity, dt);
  else if (selectedGoal.type !== 'wander' && entity.aiMode === 'wander') {
    entity.aiMode = 'idle'; entity.aiTimer = 1 + Math.random() * 2;
  }

  let movementGoal = null;
  if (selectedGoal && selectedGoal.type === 'chase') {
    target = selectedGoal.target;
    const dx = target.x - entity.x, dz = target.z - entity.z;
    const distance = Math.hypot(dx, dz) || 1;
    turnMob(entity, dx / distance, dz / distance, dt);
    if (entity.kind === 'wolf' && entity.tamedBy) {
      if (distance > 3) movementGoal = selectedGoal;
    } else if (entity.kind === 'creeper' && targetVisible && distance < 3 && Math.abs(target.y - entity.y) < 3) {
      entity.fuse = entity.fuse < 0 ? 1.5 : entity.fuse - dt;
      if (entity.fuse <= 0) {
        entities.delete(entity.id);
        explodeSimulation(entity.x, entity.y, entity.z, 3.2);
        flushSimulationEdits();
        broadcast({ t: 'explosion', x: entity.x, y: entity.y, z: entity.z, power: 3.2 });
        for (const victim of players.values()) {
          const blastDistance = Math.hypot(victim.x - entity.x, victim.y + 1 - entity.y, victim.z - entity.z);
          if (blastDistance < 6.4) {
            const dx = victim.x - entity.x, dz = victim.z - entity.z, horizontal = Math.hypot(dx, dz) || 1;
            damagePlayer(victim, Math.max(1, Math.round(14 * (1 - blastDistance / 6.4))), 'explode', '苦力怕',
              { x: dx / horizontal * 9, y: 6, z: dz / horizontal * 9 });
          }
        }
        return;
      }
    } else if (entity.kind === 'skeleton' && targetVisible && distance < 16 && entity.attackCooldown <= 0) {
      entity.attackCooldown = 2;
      spawnHostileArrow(entity, target);
    } else if (distance > 1.25) {
      if (entity.kind === 'creeper') entity.fuse = -1;
      movementGoal = selectedGoal;
    } else if (targetVisible && entity.attackCooldown <= 0 && Math.abs(target.y - entity.y) < 2) {
      entity.attackCooldown = entity.kind === 'spider' ? 0.8 : 1.0;
      const damage = { zombie: 3, skeleton: 3, spider: 2, creeper: 6, slime: 2, enderman: 7, blaze: 5 }[entity.kind] || 2;
      damagePlayer(target, damage * [0, 0.75, 1, 1.5][world.difficulty], 'mob', entity.kind,
        { x: dx / distance * 7, y: 3.5, z: dz / distance * 7 });
    }
  } else if (selectedGoal && selectedGoal.type === 'tempt') {
    if (Math.hypot(selectedGoal.x - entity.x, selectedGoal.z - entity.z) > 2.1) movementGoal = selectedGoal;
  } else if (selectedGoal) {
    if (entity.kind === 'creeper') entity.fuse = -1;
    movementGoal = selectedGoal;
  }

  const intent = movementGoal ? mobNavigationIntent(entity, movementGoal) : [0, 0];
  moveX = intent[0]; moveZ = intent[1]; moveSpeed = movementGoal ? movementGoal.speed : 0;
  moveMobWithPhysics(entity, moveX, moveZ, moveSpeed, dt);
  if (entity.y < -16 || !Number.isFinite(entity.x + entity.y + entity.z)) entities.delete(entity.id);
}

function updateVillageLifeServer(dt) {
  spawnVillagePopulationsServer();
  villageLifeClock += dt;
  villageRaidClock += dt;
  if (villageLifeClock >= 45) {
    villageLifeClock %= 45;
    const villageIds = new Set(Array.from(entities.values())
      .filter(entity => entity.type === 'mob' && entity.kind === 'villager' && entity.villageId)
      .map(entity => entity.villageId));
    for (const villageId of villageIds) {
      const plan = simulationWorld.villageById ? simulationWorld.villageById(villageId) : null;
      if (!plan) continue;
      const villagers = Array.from(entities.values()).filter(entity => entity.type === 'mob' && entity.kind === 'villager' && entity.villageId === villageId);
      if (villagers.length >= plan.beds.length || Math.random() >= 0.35) continue;
      const resident = plan.residents[villagers.length % Math.max(1, plan.residents.length)] || null;
      const baby = spawnMobEntity('villager', resident ? resident.x : plan.x + 0.5, resident ? resident.y : plan.y + 1, resident ? resident.z : plan.z + 0.5, 300);
      configureVillageMobEntity(baby, plan, resident);
      scheduleSave();
    }
  }
  if (villageRaidClock >= 75) {
    villageRaidClock %= 75;
    const time = worldClock().timeOfDay;
    if (world.difficulty > 0 && (time > 0.72 || time < 0.20) && Math.random() < 0.30 && simulationWorld.nearestVillage) {
      const source = Array.from(players.values()).find(player => simulationWorld.nearestVillage(player.x, player.z, 72));
      const plan = source ? simulationWorld.nearestVillage(source.x, source.z, 72) : null;
      if (plan) {
        const count = 2 + Math.floor(Math.random() * 3);
        for (let index = 0; index < count; index++) {
          const angle = index / count * Math.PI * 2 + Math.random() * 0.35;
          const x = plan.x + Math.cos(angle) * 22, z = plan.z + Math.sin(angle) * 22;
          const y = findMobSpawnY('zombie', x, z);
          const zombie = y === null ? null : spawnMobEntity('zombie', x, y, z);
          if (zombie) zombie.villageRaid = plan.id;
        }
        chatSystem('村庄附近出现了僵尸围攻');
      }
    }
  }
}

function breakThrownEgg(entity) {
  entities.delete(entity.id);
  if (Math.random() >= 0.125) return;
  const count = Math.random() < 0.03125 ? 4 : 1;
  const speed = Math.hypot(entity.vx, entity.vy, entity.vz) || 1;
  const spawnX = entity.x - entity.vx / speed * 0.3;
  const spawnY = entity.y - entity.vy / speed * 0.15;
  const spawnZ = entity.z - entity.vz / speed * 0.3;
  for (let index = 0; index < count; index++) {
    spawnMobEntity('chicken', spawnX + (Math.random() - 0.5) * 0.35, spawnY, spawnZ + (Math.random() - 0.5) * 0.35, 300);
  }
  scheduleSave();
}

function landEnderPearl(entity) {
  entities.delete(entity.id);
  const owner = players.get(entity.owner);
  if (!owner || owner.profile.dead) return;
  const speed = Math.hypot(entity.vx, entity.vy, entity.vz) || 1;
  const baseX = entity.x - entity.vx / speed * 0.3;
  const baseY = entity.y - entity.vy / speed * 0.1;
  const baseZ = entity.z - entity.vz / speed * 0.3;
  const probe = { w: 0.6, h: 1.8 };
  let destination = null;
  const tryPosition = (x, y, z) => {
    simulationWorld.ensureChunk(Math.floor(x) >> 4, Math.floor(z) >> 4);
    if (!destination && Registry.Physics.canOccupy(simulationWorld, probe, x, y, z)) destination = { x, y, z };
  };
  for (let back = 0; back <= 3 && !destination; back += 0.2) {
    for (let lift = -0.5; lift <= 3 && !destination; lift += 0.25) {
      tryPosition(baseX - entity.vx / speed * back, baseY + lift, baseZ - entity.vz / speed * back);
    }
  }
  for (let lift = 0; lift <= 3 && !destination; lift += 0.25) tryPosition(baseX, baseY + lift, baseZ);
  for (let radius = 0.25; radius <= 1.25 && !destination; radius += 0.25) {
    for (let direction = 0; direction < 8 && !destination; direction++) {
      const angle = direction * Math.PI / 4;
      for (let lift = 0; lift <= 1.5 && !destination; lift += 0.5) {
        tryPosition(baseX + Math.cos(angle) * radius, baseY + lift, baseZ + Math.sin(angle) * radius);
      }
    }
  }
  if (!destination) tryPosition(owner.x, owner.y, owner.z);
  if (!destination) {
    const fallback = { x: owner.x, y: owner.y, z: owner.z, w: 0.6, h: 1.8, vx: 0, vy: 0, vz: 0 };
    if (Registry.Physics.resolvePenetration(simulationWorld, fallback, 4)) destination = { x: fallback.x, y: fallback.y, z: fallback.z };
  }
  if (!destination) destination = { x: owner.x, y: owner.y, z: owner.z };
  owner.x = destination.x; owner.y = destination.y; owner.z = destination.z;
  owner.vx = owner.vy = owner.vz = 0;
  owner.profile.x = owner.x; owner.profile.y = owner.y; owner.profile.z = owner.z;
  sendJSON(owner.socket, { t: 'position', x: owner.x, y: owner.y, z: owner.z, reason: 'ender_pearl' });
  broadcast({ t: 'sound', name: 'ender_pearl.land', x: owner.x, y: owner.y + 0.8, z: owner.z, volume: 0.72 });
  damagePlayer(owner, 5, 'ender_pearl');
  scheduleSave();
}

function tickEntities(dt) {
  mobNavigationSearchBudget = MOB_NAV_SEARCHES_PER_TICK;
  mobNavigationNodeBudget = MOB_NAV_NODES_PER_TICK;
  updateVillageLifeServer(dt);
  spawnClock += dt;
  const clock = worldClock();
  const endPlayer = Array.from(players.values()).find(player => simulationWorld.dimensionAt && simulationWorld.dimensionAt(player.x, player.z) === 'end');
  if (endPlayer && !world.dragonDefeated && !Array.from(entities.values()).some(entity => entity.type === 'mob' && entity.kind === 'ender_dragon')) {
    spawnMobEntity('ender_dragon', Registry.World.END_OFFSET + 8.5, 88, 8.5);
  }
  if (spawnClock >= 4 && players.size && entities.size < Math.min(48, players.size * 12)) {
    spawnClock = 0;
    const source = Array.from(players.values())[Math.floor(Math.random() * players.size)];
    const dimension = simulationWorld.dimensionAt ? simulationWorld.dimensionAt(source.x, source.z) : 'overworld';
    const night = clock.timeOfDay > 0.72 || clock.timeOfDay < 0.22;
    const hostile = world.difficulty > 0 && (night || dimension !== 'overworld');
    const kinds = hostile ? (dimension === 'nether' ? ['blaze', 'blaze', 'skeleton'] : dimension === 'end' ? ['enderman'] :
      ['zombie', 'skeleton', 'spider', 'creeper', 'slime', 'bat']) :
      ['pig', 'cow', 'sheep', 'chicken', 'rabbit', 'horse', 'wolf'];
    const angle = Math.random() * Math.PI * 2, distance = 10 + Math.random() * 12;
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const x = source.x + Math.cos(angle) * distance, z = source.z + Math.sin(angle) * distance;
    const y = findMobSpawnY(kind, x, z);
    if (y !== null) spawnMobEntity(kind, x, y, z);
  }

  for (const entity of Array.from(entities.values())) {
    entity.age += dt;
    if (entity.type === 'xp') {
      let target = null, targetDistance = 8;
      for (const player of players.values()) {
        if (player.profile.dead) continue;
        const distance = Math.hypot(player.x - entity.x, player.y + 0.8 - entity.y, player.z - entity.z);
        if (distance < targetDistance) { target = player; targetDistance = distance; }
      }
      if (target && targetDistance < 0.85 && entity.age > 0.15) {
        addXP(target.profile, entity.value);
        entities.delete(entity.id);
        sendProfile(target, 'xp_pickup'); scheduleSave();
        continue;
      }
      if (target) {
        const dx = target.x - entity.x, dy = target.y + 0.8 - entity.y, dz = target.z - entity.z;
        const distance = Math.max(0.1, Math.hypot(dx, dy, dz));
        const pull = (1 - distance / 8) * 18;
        entity.vx += dx / distance * pull * dt;
        entity.vy += dy / distance * pull * dt;
        entity.vz += dz / distance * pull * dt;
      } else entity.vy -= 12 * dt;
      entity.x += entity.vx * dt; entity.y += entity.vy * dt; entity.z += entity.vz * dt;
      entity.vx *= Math.pow(0.25, dt); entity.vy *= Math.pow(0.25, dt); entity.vz *= Math.pow(0.25, dt);
      if (entity.age > 300 || entity.y < -16) entities.delete(entity.id);
    } else if (entity.type === 'item') {
      entity.vy -= 12 * dt;
      const nextX = entity.x + entity.vx * dt, nextZ = entity.z + entity.vz * dt;
      simulationWorld.ensureChunk(Math.floor(nextX) >> 4, Math.floor(nextZ) >> 4);
      Registry.Physics.move(simulationWorld, entity, dt);
      const itemDrag = Math.pow(entity.onGround ? 0.58 : 0.98, dt * 20);
      entity.vx *= itemDrag;
      entity.vz *= itemDrag;
      if (entity.onGround) {
        if (Math.abs(entity.vx) < 0.02) entity.vx = 0;
        if (Math.abs(entity.vz) < 0.02) entity.vz = 0;
      }
      if (entity.age > 0.5) {
        for (const player of players.values()) {
          if (player.profile.dead || Math.hypot(player.x - entity.x, player.y + 0.8 - entity.y, player.z - entity.z) > 1.25) continue;
          const left = addStack(player.profile, entity.stack);
          if (left <= 0) entities.delete(entity.id);
          else entity.stack.n = left;
          bumpInventory(player);
          lockInventory(player);
          sendProfile(player, 'pickup'); scheduleSave();
          break;
        }
      }
      if (entity.age > 300) entities.delete(entity.id);
    } else if (entity.type === 'egg' || entity.type === 'ender_pearl') {
      entity.vy -= 9.8 * dt;
      const speed = Math.hypot(entity.vx, entity.vy, entity.vz);
      const travel = speed * dt;
      const direction = speed > 1e-6 ? [entity.vx / speed, entity.vy / speed, entity.vz / speed] : [0, 0, 0];
      simulationWorld.ensureChunk(Math.floor(entity.x + entity.vx * dt) >> 4, Math.floor(entity.z + entity.vz * dt) >> 4);
      const blockHit = travel > 0 ? simulationWorld.raycast(entity.x, entity.y, entity.z, direction[0], direction[1], direction[2], travel) : null;
      let targetDistance = null;
      for (const player of players.values()) {
        if (player.id === entity.owner || player.profile.dead) continue;
        const distance = rayAabb(entity.x, entity.y, entity.z, direction[0], direction[1], direction[2], player, travel);
        if (distance !== null && (targetDistance === null || distance < targetDistance)) targetDistance = distance;
      }
      for (const mob of entities.values()) {
        if (mob.type !== 'mob' || mob.id === entity.owner) continue;
        const distance = rayAabb(entity.x, entity.y, entity.z, direction[0], direction[1], direction[2], mob, travel);
        if (distance !== null && (targetDistance === null || distance < targetDistance)) targetDistance = distance;
      }
      const impactDistance = targetDistance !== null && (!blockHit || targetDistance < blockHit.dist) ? targetDistance : (blockHit ? blockHit.dist : null);
      if (impactDistance !== null) {
        entity.x += direction[0] * Math.max(0, impactDistance - 0.01);
        entity.y += direction[1] * Math.max(0, impactDistance - 0.01);
        entity.z += direction[2] * Math.max(0, impactDistance - 0.01);
        if (entity.type === 'egg') breakThrownEgg(entity);
        else landEnderPearl(entity);
        continue;
      }
      entity.x += entity.vx * dt; entity.y += entity.vy * dt; entity.z += entity.vz * dt;
      if (entity.age > 30 || entity.y < -16) entities.delete(entity.id);
    } else if (entity.type === 'arrow') {
      if (entity.stuck) {
        if (entity.age - (entity.stuckAt || 0) > 0.5) {
          for (const player of players.values()) {
            if (player.profile.dead || Math.hypot(player.x - entity.x, player.y + 0.8 - entity.y, player.z - entity.z) > 1.5) continue;
            if (addStack(player.profile, { id: Registry.Items.IT.ARROW, n: 1 }) <= 0) {
              entities.delete(entity.id); lockInventory(player); sendProfile(player, 'pickup'); scheduleSave();
            }
            break;
          }
        }
        if (entity.age - (entity.stuckAt || 0) > 60) entities.delete(entity.id);
        continue;
      }
      entity.vy -= 3.2 * dt;
      const speed = Math.hypot(entity.vx, entity.vy, entity.vz);
      const travel = speed * dt;
      const direction = speed > 1e-6 ? [entity.vx / speed, entity.vy / speed, entity.vz / speed] : [0, 0, 0];
      simulationWorld.ensureChunk(Math.floor(entity.x + entity.vx * dt) >> 4, Math.floor(entity.z + entity.vz * dt) >> 4);
      const blockHit = travel > 0 ? simulationWorld.raycast(entity.x, entity.y, entity.z, direction[0], direction[1], direction[2], travel) : null;
      let targetHit = null;
      for (const player of players.values()) {
        if (player.id === entity.owner || player.profile.dead) continue;
        const distance = rayAabb(entity.x, entity.y, entity.z, direction[0], direction[1], direction[2], player, travel);
        if (distance !== null && (!targetHit || distance < targetHit.distance)) targetHit = { type: 'player', target: player, distance };
      }
      for (const mob of entities.values()) {
        if (mob.type !== 'mob' || mob.id === entity.owner) continue;
        const distance = rayAabb(entity.x, entity.y, entity.z, direction[0], direction[1], direction[2], mob, travel);
        if (distance !== null && (!targetHit || distance < targetHit.distance)) targetHit = { type: 'mob', target: mob, distance };
      }
      if (targetHit && (!blockHit || targetHit.distance < blockHit.dist)) {
        entity.x += direction[0] * targetHit.distance; entity.y += direction[1] * targetHit.distance; entity.z += direction[2] * targetHit.distance;
        if (targetHit.type === 'player') {
          const ownerPlayer = players.get(entity.owner);
          damagePlayer(targetHit.target, entity.damage, 'arrow', ownerPlayer ? ownerPlayer.name : (entity.ownerKind || '骷髅'),
            { x: direction[0] * 5, y: Math.max(1.2, direction[1] * 3 + 1.8), z: direction[2] * 5 });
        } else {
          targetHit.target.hp -= entity.damage;
          const ownerPlayer = players.get(entity.owner);
          if (targetHit.target.hp > 0 && ownerPlayer && PASSIVE_MOBS.has(targetHit.target.kind)) {
            startMobFlee(targetHit.target, ownerPlayer.x, ownerPlayer.z, ownerPlayer.id);
          }
          if (targetHit.target.hp > 0) targetHit.target.embeddedArrows = Math.min(4, (targetHit.target.embeddedArrows || 0) + 1);
          if (targetHit.target.hp <= 0) killMob(targetHit.target, ownerPlayer);
        }
        entities.delete(entity.id);
        continue;
      }
      if (blockHit) {
        entity.x += direction[0] * Math.max(0, blockHit.dist - 0.02);
        entity.y += direction[1] * Math.max(0, blockHit.dist - 0.02);
        entity.z += direction[2] * Math.max(0, blockHit.dist - 0.02);
        entity.vx = entity.vy = entity.vz = 0;
        entity.stuck = true; entity.stuckAt = entity.age;
        continue;
      }
      entity.x += entity.vx * dt; entity.y += entity.vy * dt; entity.z += entity.vz * dt;
      if (entity.age > 30 || entity.y < -16) entities.delete(entity.id);
    } else if (entity.type === 'tnt') {
      entity.fuse -= dt;
      if (entity.fuse <= 0) {
        entities.delete(entity.id);
        explodeSimulation(entity.x, entity.y, entity.z, 3.6);
        flushSimulationEdits();
        broadcast({ t: 'explosion', x: entity.x, y: entity.y, z: entity.z, power: 3.6 });
        for (const player of players.values()) {
          const distance = Math.hypot(player.x - entity.x, player.y + 1 - entity.y, player.z - entity.z);
          if (distance < 7.2) {
            const dx = player.x - entity.x, dz = player.z - entity.z, horizontal = Math.hypot(dx, dz) || 1;
            damagePlayer(player, Math.max(1, Math.round(16 * (1 - distance / 7.2))), 'explode', null,
              { x: dx / horizontal * 9, y: 6, z: dz / horizontal * 9 });
          }
        }
      }
    } else if (entity.type === 'mob') {
      tickMobEntity(entity, dt, clock);
      let nearAnyone = false;
      for (const player of players.values()) if (Math.hypot(player.x - entity.x, player.z - entity.z) < 96) { nearAnyone = true; break; }
      const persistent = !!entity.villageId || !!entity.tamedBy || entity.kind === 'ender_dragon';
      if (!persistent && ((players.size > 0 && !nearAnyone) || entity.age > 1200)) entities.delete(entity.id);
    }
  }
}

function tickWorld(dt) {
  world.weatherTimer -= dt;
  if (world.weatherTimer <= 0) {
    world.weather = world.weather === 'clear' && Math.random() < 0.4 ? 'rain' : 'clear';
    world.weatherTimer = world.weather === 'rain' ? 120 + Math.random() * 180 : 240 + Math.random() * 420;
    scheduleSave();
  }
  tickFurnaces(dt);
  simulationWorld.weather = world.weather;
  if (simulationWorld.pressPressurePlate) {
    for (const player of players.values()) {
      const x = Math.floor(player.x), y = Math.floor(player.y - 0.05), z = Math.floor(player.z);
      if (simulationWorld.getBlock(x, y, z) === Registry.Blocks.ID.STONE_PRESSURE_PLATE) simulationWorld.pressPressurePlate(x, y, z, 0.4);
    }
    for (const entity of entities.values()) {
      if (entity.type !== 'mob') continue;
      const x = Math.floor(entity.x), y = Math.floor(entity.y - 0.05), z = Math.floor(entity.z);
      if (simulationWorld.getBlock(x, y, z) === Registry.Blocks.ID.STONE_PRESSURE_PLATE) simulationWorld.pressPressurePlate(x, y, z, 0.4);
    }
  }
  simulationWorld.update(dt);
  flushSimulationEdits();
  simulationWorld.meshDirty.clear();
  simulationWorld.urgentMeshKeys.clear();
  worldTickClock += dt;
  if (worldTickClock >= 1) {
    worldTickClock %= 1;
    for (const player of players.values()) {
      const cx = Math.floor(player.x) >> 4, cz = Math.floor(player.z) >> 4;
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = cx + dx, z = cz + dz;
        const chunk = simulationWorld.chunkAt(x, z);
        if (chunk && chunk.generated) continue;
        const key = x + ',' + z;
        if (chunkWarmupKeys.has(key)) continue;
        chunkWarmupKeys.add(key);
        chunkWarmupQueue.push({ x, z, key });
      }
    }
  }
  chunkWarmupClock += dt;
  while (chunkWarmupClock >= 0.2 && chunkWarmupQueue.length) {
    chunkWarmupClock %= 0.2;
    const next = chunkWarmupQueue.shift();
    chunkWarmupKeys.delete(next.key);
    const chunk = simulationWorld.chunkAt(next.x, next.z);
    if (chunk && chunk.generated) continue;
    simulationWorld.ensureChunk(next.x, next.z);
    break;
  }
  pruneClock += dt;
  if (pruneClock >= 30) {
    pruneClock = 0;
    for (const chunk of Array.from(simulationWorld.chunks.values())) {
      let keep = false;
      for (const player of players.values()) {
        const dx = chunk.cx - (Math.floor(player.x) >> 4), dz = chunk.cz - (Math.floor(player.z) >> 4);
        if (dx * dx + dz * dz <= 25) { keep = true; break; }
      }
      if (!keep) {
        simulationWorld.forgetChunkMeshes(chunk);
        simulationWorld.removeChunk(chunk);
      }
    }
  }
  tickEntities(dt);
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, 'http://localhost');
  if (requestUrl.pathname === '/health') {
    const clock = worldClock();
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, protocol: PROTOCOL, players: players.size, seed: world.seed, edits: world.edits.size, time: clock.time, weather: world.weather }));
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(requestUrl.pathname); } catch (error) { pathname = '/'; }
  if (pathname === '/') pathname = '/index.html';
  if (!(pathname === '/index.html' || pathname.startsWith('/js/') || pathname.startsWith('/docs/') || pathname.startsWith('/assets/'))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return;
  }
  const file = path.resolve(ROOT, '.' + pathname);
  const staticRoot = pathname.startsWith('/js/') ? 'js' : pathname.startsWith('/docs/') ? 'docs' : 'assets';
  if (file !== path.join(ROOT, 'index.html') && !file.startsWith(path.join(ROOT, staticRoot) + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
    });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024, perMessageDeflate: false });

wss.on('connection', socket => {
  if (wss.clients.size > MAX_PLAYERS) {
    sendJSON(socket, { t: 'error', code: 'full', message: '服务器人数已满' }); socket.close(1013, 'server full'); return;
  }
  socket.isAlive = true;
  socket.rateStarted = Date.now(); socket.rateCount = 0;
  socket.on('pong', data => {
    socket.isAlive = true;
    if (socket.player && data && data.length >= 8) socket.player.latency = Math.min(999, Math.max(0, Date.now() - Number(data.toString())));
  });
  const helloTimer = setTimeout(() => socket.close(1008, 'hello timeout'), 5000);

  socket.on('message', raw => {
    const now = Date.now();
    if (now - socket.rateStarted >= 1000) { socket.rateStarted = now; socket.rateCount = 0; }
    if (++socket.rateCount > 240) { socket.close(1008, 'message rate exceeded'); return; }
    let message;
    try { message = JSON.parse(raw.toString()); } catch (error) { return; }
    if (!socket.player) {
      if (message.t !== 'hello' || message.protocol !== PROTOCOL) {
        sendJSON(socket, { t: 'error', code: 'protocol', message: '联机协议不兼容' }); socket.close(1002, 'protocol mismatch'); return;
      }
      const token = String(message.token || '');
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
        sendJSON(socket, { t: 'error', code: 'identity', message: '玩家身份令牌无效' }); socket.close(1008, 'invalid identity'); return;
      }
      clearTimeout(helloTimer);
      const key = tokenKey(token);
      const requestedName = safeName(message.name);
      if (world.bans.keys.has(key) || world.bans.names.has(requestedName.toLocaleLowerCase())) {
        sendJSON(socket, { t: 'error', code: 'banned', message: '你已被此服务器封禁' }); socket.close(1008, 'banned'); return;
      }
      let profile = world.profiles.get(key);
      const admission = whitelistAdmission(key, requestedName, profile);
      if (!admission.ok) {
        sendJSON(socket, { t: 'error', code: admission.code, message: admission.message });
        socket.close(1008, admission.code); return;
      }
      let createdProfile = false;
      if (!profile) {
        profile = defaultProfile(key, requestedName);
        world.profiles.set(key, profile);
        createdProfile = true;
      }
      if (admission.claim) profile.whitelistName = admission.claim;
      scheduleSave();
      for (const old of players.values()) if (old.profile.key === key) old.socket.close(4001, 'reconnected');
      const id = crypto.randomUUID().slice(0, 8);
      profile.name = uniqueName(requestedName, id);
      if (!profileCanCreative(profile)) profile.mode = 'survival';
      const player = {
        id, socket, profile, name: profile.name,
        x: profile.x, y: profile.y, z: profile.z, yaw: profile.yaw, pitch: profile.pitch,
        vx: 0, vy: 0, vz: 0,
        speed: 0, action: 'idle', actionPhase: 0, onGround: false, sneaking: false, sprinting: false, blocking: false,
        skin: safeSkin(message.skin), modelType: safeModelType(message.modelType),
        lastSeen: Date.now(), latency: 0, clientLatency: 0,
      };
      if (createdProfile) {
        resetPlayerMovementState(player, profile.spawn);
        profile.spawn = { x: player.x, y: player.y, z: player.z };
      }
      socket.player = player; players.set(id, player);
      const clock = worldClock();
      sendJSON(socket, {
        t: 'welcome', protocol: PROTOCOL, id, name: player.name,
        seed: world.seed, time: clock.time, timeOfDay: clock.timeOfDay,
        weather: world.weather, difficulty: world.difficulty,
        profile: profileForClient(profile), role: profile.role, permissions: permissionsFor(profile),
        edits: Array.from(world.edits.values()), players: Array.from(players.values(), publicPlayer),
        entities: Array.from(entities.values(), publicEntity), signs: Array.from(world.signs.values()),
      });
      broadcast({ t: 'join', player: publicPlayer(player) }, socket);
      chatSystem(player.name + ' 加入了游戏');
      return;
    }
    if (message.t === 'ping') {
      sendJSON(socket, { t: 'pong', id: clampInt(message.id, 0, 2147483647, 0) });
    } else if (message.t === 'state') handleState(socket, message);
    else if (message.t === 'profile') handleProfile(socket, message);
    else if (message.t === 'blocks') handleBlocks(socket, message);
    else if (message.t === 'container') handleContainer(socket, message);
    else if (message.t === 'sign') handleSign(socket, message);
    else if (message.t === 'chat') handleChat(socket, message);
    else if (message.t === 'action') handleAction(socket, message);
  });

  socket.on('close', () => {
    clearTimeout(helloTimer);
    const player = socket.player;
    if (!player) return;
    if (player.ridingConsumed) addStack(player.profile, { id: Registry.Items.IT.MINECART, n: 1 });
    player.riding = null; player.ridingConsumed = false;
    player.profile.x = player.x; player.profile.y = player.y; player.profile.z = player.z;
    player.profile.yaw = player.yaw; player.profile.pitch = player.pitch; player.profile.lastSeen = Date.now();
    players.delete(player.id); scheduleSave();
    broadcast({ t: 'leave', id: player.id });
    chatSystem(player.name + ' 离开了游戏');
  });
});

const simulationTimer = setInterval(() => tickWorld(SIMULATION_MS / 1000), SIMULATION_MS);
const snapshotTimer = setInterval(() => {
  if (!players.size) return;
  const clock = worldClock();
  broadcastSnapshot({
    t: 'snapshot', at: Date.now(), time: clock.time, timeOfDay: clock.timeOfDay,
    weather: world.weather, difficulty: world.difficulty,
    players: Array.from(players.values(), publicPlayer), entities: Array.from(entities.values(), publicEntity),
  });
}, SNAPSHOT_MS);

const heartbeatTimer = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) { socket.terminate(); continue; }
    socket.isAlive = false;
    socket.ping(String(Date.now()));
  }
}, 5000);

const autosaveTimer = setInterval(() => {
  world.dirty = true;
  saveWorldNow();
}, 30000);

function executeConsoleCommand(line) {
  const args = parseCommand(line);
  const command = String(args.shift() || '').replace(/^\//, '').toLocaleLowerCase();
  const targetOrLog = (name) => {
    const target = findPlayer(name);
    if (!target) console.log('Player not found: ' + (canonicalPlayerName(name) ? safeName(name) : '(missing target)'));
    return target;
  };
  if (!command) return true;
  if (command === 'help' || command === '?') {
    console.log('Console commands: help, list, status, seed, save, stop, say, grant, deop, perm, gamemode, give, clear, kick, ban, pardon, tp, setspawn, heal, feed, kill, summon, time, weather, difficulty, whitelist');
    return true;
  }
  if (command === 'list') {
    console.log(Array.from(players.values()).map(player => player.name + '[' + player.profile.role + ']').join(', ') || 'No players online');
    return true;
  }
  if (command === 'status') { console.log(statusLine()); return true; }
  if (command === 'seed') { console.log('World seed: ' + world.seed); return true; }
  if (command === 'save' || command === 'save-all') { world.dirty = true; saveWorldNow(); console.log('World saved'); return true; }
  if (command === 'say') { const text = safeText(args.join(' '), 160); if (text) chatSystem('[Server] ' + text); return true; }
  if (command === 'grant' || command === 'op') {
    if (!passwordMatches(args[1])) { console.log('Usage: grant <player> <admin-password>'); return false; }
    const target = targetOrLog(args[0]);
    if (!target) return false;
    target.profile.role = 'admin'; sendProfile(target, 'permission'); scheduleSave(); console.log('Granted admin to ' + target.name); return true;
  }
  if (command === 'deop') {
    const target = targetOrLog(args[0]); if (!target) return false;
    target.profile.role = 'user'; target.profile.mode = 'survival'; sendProfile(target, 'permission'); scheduleSave();
    console.log('Removed admin from ' + target.name); return true;
  }
  if (command === 'perm') {
    const target = targetOrLog(args[0]), role = String(args[1] || '').toLocaleLowerCase();
    if (!target || !ROLE_PERMISSIONS[role]) { console.log('Usage: perm <player> <user|moderator|admin>'); return false; }
    target.profile.role = role; if (!profileCanCreative(target.profile)) target.profile.mode = 'survival';
    sendProfile(target, 'permission'); scheduleSave(); console.log(target.name + ' role=' + role); return true;
  }
  if (command === 'gamemode' || command === 'gm') {
    const target = targetOrLog(args[0]);
    const value = String(args[1] || '').toLocaleLowerCase();
    const mode = ['1','c','creative'].includes(value) ? 'creative' : ['0','s','survival'].includes(value) ? 'survival' : null;
    if (!target || !mode) { console.log('Usage: gamemode <player> <survival|creative>'); return false; }
    setPlayerMode(target, mode); console.log(target.name + ' gamemode=' + mode); return true;
  }
  if (command === 'give') {
    const target = targetOrLog(args.shift()), itemId = resolveItem(args.shift());
    if (!target || !Number.isInteger(itemId)) { console.log('Usage: give <player> <item> [count]'); return false; }
    let left = clampInt(args.shift(), 1, 2304, 1), given = 0;
    while (left > 0) {
      const amount = Math.min(left, Registry.Items.maxStack(itemId));
      const overflow = addStack(target.profile, { id:itemId, n:amount });
      given += amount - overflow; left -= amount - overflow; if (overflow) break;
    }
    bumpInventory(target); lockInventory(target); sendProfile(target, 'give'); scheduleSave();
    console.log('Gave ' + target.name + ' ' + Registry.Items.name(itemId) + ' x' + given); return true;
  }
  if (command === 'clear') {
    const target = targetOrLog(args.shift()); if (!target) return false;
    const hasItem = args.length > 0, itemId = hasItem ? resolveItem(args.shift()) : undefined;
    if (hasItem && !Number.isInteger(itemId)) { console.log('Unknown item'); return false; }
    const amount = args.length ? clampInt(args.shift(), 1, 2304, 1) : Infinity;
    console.log('Removed ' + clearPlayerItems(target, itemId, amount) + ' items from ' + target.name); return true;
  }
  if (command === 'kick') {
    const target = targetOrLog(args.shift()); if (!target) return false;
    kickPlayer(target, args.join(' ')); console.log('Kicked ' + target.name); return true;
  }
  if (command === 'ban') {
    if (!args[0]) { console.log('Usage: ban <player> [reason]'); return false; }
    const name = safeName(args.shift()), target = findPlayer(name);
    if (target) { world.bans.keys.add(target.profile.key); world.bans.names.add(target.name.toLocaleLowerCase()); kickPlayer(target, args.join(' ') || 'Banned'); }
    else {
      world.bans.names.add(name.toLocaleLowerCase());
      for (const profile of world.profiles.values()) if (profile.name.toLocaleLowerCase() === name.toLocaleLowerCase()) world.bans.keys.add(profile.key);
    }
    scheduleSave(); console.log('Banned ' + name); return true;
  }
  if (command === 'pardon') {
    if (!args[0]) { console.log('Usage: pardon <player>'); return false; }
    const name = safeName(args[0]).toLocaleLowerCase(); world.bans.names.delete(name);
    for (const profile of world.profiles.values()) if (profile.name.toLocaleLowerCase() === name) world.bans.keys.delete(profile.key);
    scheduleSave(); console.log('Pardoned ' + name); return true;
  }
  if (command === 'tp' || command === 'teleport') {
    const target = targetOrLog(args.shift()); if (!target) return false;
    const destinationPlayer = args.length === 1 ? findPlayer(args[0]) : null;
    const destination = destinationPlayer || (args.length >= 3 ? { x:Number(args[0]), y:Number(args[1]), z:Number(args[2]) } : null);
    if (!destination || ![destination.x,destination.y,destination.z].every(Number.isFinite)) { console.log('Usage: tp <player> <target|x y z>'); return false; }
    teleportPlayer(target, destination.x, destination.y, destination.z, 'teleport'); console.log('Teleported ' + target.name); return true;
  }
  if (command === 'setspawn') {
    const target = targetOrLog(args.shift()); if (!target) return false;
    const pos = args.length >= 3 ? args.slice(0,3).map(Number) : [target.x,target.y,target.z];
    if (!pos.every(Number.isFinite)) { console.log('Usage: setspawn <player> [x y z]'); return false; }
    target.profile.spawn = {
      x:clamp(pos[0],-1000000,1000000), y:clamp(pos[1],-64,320), z:clamp(pos[2],-1000000,1000000),
    };
    sendProfile(target, 'spawn'); scheduleSave();
    console.log('Set spawn for ' + target.name); return true;
  }
  if (command === 'heal' || command === 'feed') {
    const target = targetOrLog(args[0]); if (!target) return false;
    restorePlayer(target, command === 'heal', command === 'feed'); console.log(command + ': ' + target.name); return true;
  }
  if (command === 'kill') {
    const target = targetOrLog(args[0]); if (!target) return false;
    killPlayer(target, 'console', 'Server'); console.log('Killed ' + target.name); return true;
  }
  if (command === 'summon') {
    const kind = args.shift(), source = Array.from(players.values())[0];
    const pos = args.length >= 3 ? args.slice(0,3).map(Number) : source ? [source.x,source.y,source.z] : null;
    const entity = pos && summonMob(kind, pos[0], pos[1], pos[2]);
    if (!entity) { console.log('Usage: summon <mob> <x> <y> <z>'); return false; }
    console.log('Summoned ' + entity.kind + ' id=' + entity.id); return true;
  }
  if (command === 'time') {
    const value = String(args[0] || '').toLocaleLowerCase(), time = value === 'day' ? 0.35 : value === 'night' ? 0.85 : Number(value);
    if (!Number.isFinite(time)) { console.log('Usage: time <day|night|0..1>'); return false; }
    setWorldTimeOfDay(time); console.log('Time changed'); return true;
  }
  if (command === 'weather') {
    const weather = args[0] === 'rain' ? 'rain' : args[0] === 'clear' ? 'clear' : null;
    if (!weather) { console.log('Usage: weather <clear|rain>'); return false; }
    world.weather = weather; world.weatherTimer = 300; scheduleSave(); console.log('Weather=' + weather); return true;
  }
  if (command === 'difficulty') {
    const names = { peaceful:0, easy:1, normal:2, hard:3 }, difficulty = names[args[0]];
    if (difficulty === undefined) { console.log('Usage: difficulty <peaceful|easy|normal|hard>'); return false; }
    world.difficulty = difficulty; scheduleSave(); console.log('Difficulty=' + args[0]); return true;
  }
  if (command === 'whitelist') {
    const action = String(args.shift() || 'list').toLocaleLowerCase();
    if (action === 'on') whitelistEnabled = true;
    else if (action === 'off') whitelistEnabled = false;
    else if (action === 'add' && args[0]) WHITELIST.add(safeName(args[0]).toLocaleLowerCase());
    else if (action === 'remove' && args[0]) WHITELIST.delete(safeName(args[0]).toLocaleLowerCase());
    else if (action !== 'list') { console.log('Usage: whitelist <on|off|list|add|remove> [player]'); return false; }
    world.whitelist.enabled = whitelistEnabled;
    world.whitelist.names = Array.from(WHITELIST);
    scheduleSave();
    console.log('Whitelist ' + (whitelistEnabled ? 'on' : 'off') + ': ' + (Array.from(WHITELIST).join(', ') || '(empty)')); return true;
  }
  if (command === 'stop') { console.log('Stopping server...'); shutdown(); return true; }
  console.log('Unknown command. Type help.');
  return false;
}

let consoleInterface = null;
if (process.stdin.isTTY) {
  consoleInterface = readline.createInterface({ input: process.stdin, output: process.stdout });
  consoleInterface.on('line', executeConsoleCommand);
}

function shutdown() {
  clearInterval(simulationTimer); clearInterval(snapshotTimer); clearInterval(heartbeatTimer); clearInterval(autosaveTimer);
  world.dirty = true; saveWorldNow();
  if (consoleInterface) consoleInterface.close();
  for (const socket of wss.clients) socket.close(1001, 'server shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', error => { console.error(error); world.dirty = true; saveWorldNow(); process.exit(1); });

server.listen(PORT, HOST, () => {
  if (!fs.existsSync(WORLD_FILE) || world.recovered) { world.dirty = true; saveWorldNow(); }
  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : PORT;
  console.log(`WebCraft server: http://localhost:${actualPort}`);
  console.log(`World seed: ${world.seed} | edits: ${world.edits.size} | profiles: ${world.profiles.size} | max players: ${MAX_PLAYERS}`);
  console.log(ADMIN_PASSWORD_GENERATED ? `Admin password (generated for this server): ${ADMIN_PASSWORD}` : 'Admin password loaded from ADMIN_PASSWORD');
  console.log('In game: /auth <password>  |  Server console: grant <player> <password>');
});

module.exports = { server, wss, world, players, entities, PROTOCOL, executeConsoleCommand };
