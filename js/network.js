/* network.js - authoritative single-server survival protocol, chat and administration. */
'use strict';
(function () {
  const PROTOCOL = 3;
  const STATE_INTERVAL = 1 / 20;
  const PROFILE_INTERVAL = 1.25;
  const REMOTE_STEP = 1 / 30;
  const PING_INTERVAL = 2;
  const MAX_EXTRAPOLATION = 0.1;
  const PLAYER_NAME_KEY = 'webcraft_player_name';
  const PLAYER_TOKEN_KEY = 'webcraft_player_token';
  const remotes = new Map();
  const networkEntities = new Map();
  const remoteListCache = [];
  const networkEntityListCache = [];
  const editsByChunk = new Map();
  const pendingBlocks = new Map();
  const signs = new Map();
  let socket = null;
  let connectionState = 'offline';
  let selfId = null;
  let assignedName = '';
  let boundWorld = null;
  let applyingRemote = 0;
  let stateClock = 0;
  let profileClock = 0;
  let remoteClock = 0;
  let pingClock = 0;
  let pingNonce = 0;
  let profileTransactionNonce = 0;
  let craftTransactionNonce = 0;
  let inventoryRevision = 0;
  let pendingPing = null;
  let version = 1;
  let lastError = '';
  let latency = 0;
  let intentionalClose = false;
  let allowReconnect = true;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let lastConnectOptions = null;
  let welcomeData = null;
  let movementSyncPaused = false;
  let role = 'user';
  let permissions = [];
  const PLAYER_SKINS = new Set(['steve', 'alex', 'miner', 'wanderer']);
  function safeSkin(value) { return PLAYER_SKINS.has(value) ? value : 'steve'; }
  function safeModelType(value) { return value === 'slim' ? 'slim' : 'classic'; }
  function refreshList(cache, source) {
    cache.length = 0;
    for (const value of source.values()) cache.push(value);
  }

  function defaultUrl() {
    try {
      const override = new URLSearchParams(location.search).get('server');
      if (override && /^wss?:\/\//i.test(override)) return override;
      if (location.host) return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    } catch (error) { /* local fallback */ }
    return 'ws://localhost:8080/ws';
  }

  function generatedPlayerName() { return 'Steve' + (1000 + Math.floor(Math.random() * 9000)); }

  function sanitizePlayerName(value, fallback) {
    let name = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    try { name = name.replace(/[^\p{L}\p{N}_\- ]/gu, ''); } catch (error) { name = name.replace(/[^A-Za-z0-9_\- ]/g, ''); }
    name = name.replace(/\s+/g, ' ').trim();
    name = Array.from(name).slice(0, 16).join('');
    return name || fallback || 'Steve';
  }

  function playerName() {
    try {
      let value = localStorage.getItem(PLAYER_NAME_KEY) || generatedPlayerName();
      value = sanitizePlayerName(value, 'Steve');
      localStorage.setItem(PLAYER_NAME_KEY, value);
      return value;
    } catch (error) { return generatedPlayerName(); }
  }

  function setPlayerName(value) {
    const name = sanitizePlayerName(value, 'Steve');
    try { localStorage.setItem(PLAYER_NAME_KEY, name); } catch (error) { /* unavailable */ }
    if (connectionState === 'offline') assignedName = '';
    return name;
  }

  function randomToken() {
    const bytes = new Uint8Array(24);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    let out = '';
    for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
    return out;
  }

  function playerToken() {
    try {
      let token = localStorage.getItem(PLAYER_TOKEN_KEY);
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(token || '')) {
        token = randomToken();
        localStorage.setItem(PLAYER_TOKEN_KEY, token);
      }
      return token;
    } catch (error) { return randomToken(); }
  }

  function notifyStatus(message) {
    if (typeof Network.onStatus === 'function') Network.onStatus(Network.status(), message || '');
  }

  function send(value) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(value));
    return true;
  }

  function chunkKey(x, z) { return Math.floor(x / 16) + ',' + Math.floor(z / 16); }
  function blockKey(x, y, z) { return x + ',' + y + ',' + z; }

  function cleanSign(raw) {
    if (!raw) return null;
    const x = Number(raw.x), y = Number(raw.y), z = Number(raw.z);
    if (![x, y, z].every(Number.isInteger) || Math.abs(x) > 1000000 || Math.abs(z) > 1000000 || y < 0 || y >= World.CH_H) return null;
    if (raw.removed) return { x, y, z, removed: true };
    const source = Array.isArray(raw.lines) ? raw.lines : String(raw.text || '').replace(/\r/g, '').split('\n');
    const lines = source.slice(0, 4).map(line => Array.from(String(line || '').replace(/[\u0000-\u001f\u007f]/g, '')).slice(0, 15).join(''));
    while (lines.length < 4) lines.push('');
    return { x, y, z, lines };
  }

  function applySign(raw) {
    const sign = cleanSign(raw);
    if (!sign) return null;
    const key = blockKey(sign.x, sign.y, sign.z);
    if (sign.removed) signs.delete(key);
    else signs.set(key, sign);
    if (!boundWorld) return sign;
    if (sign.removed) {
      const existing = boundWorld.getBE(sign.x, sign.y, sign.z);
      if (existing && existing.type === 'sign') boundWorld.removeBE(sign.x, sign.y, sign.z);
      return sign;
    }
    let be = boundWorld.getBE(sign.x, sign.y, sign.z);
    if (!be || be.type !== 'sign') be = { type: 'sign', lines: sign.lines.slice() };
    else be.lines = sign.lines.slice();
    boundWorld.setBE(sign.x, sign.y, sign.z, be);
    return sign;
  }

  function cleanEdit(raw) {
    if (!raw) return null;
    const x = Number(raw.x), y = Number(raw.y), z = Number(raw.z), id = Number(raw.id);
    if (![x, y, z, id].every(Number.isInteger)) return null;
    if (Math.abs(x) > 1000000 || Math.abs(z) > 1000000 || y < 0 || y >= World.CH_H || id < 0 || id > 255 || !Blocks.all[id]) return null;
    const state = Number.isInteger(raw.state) && raw.state >= 0 && raw.state <= 15 ? raw.state : null;
    return { x, y, z, id, state };
  }

  function rememberEdit(raw) {
    const edit = cleanEdit(raw);
    if (!edit) return null;
    const key = chunkKey(edit.x, edit.z);
    let group = editsByChunk.get(key);
    if (!group) { group = new Map(); editsByChunk.set(key, group); }
    group.set(blockKey(edit.x, edit.y, edit.z), edit);
    return edit;
  }

  function applyState(edit) {
    if (!boundWorld) return;
    if (edit.state === null) boundWorld.removeState(edit.x, edit.y, edit.z);
    else boundWorld.setState(edit.x, edit.y, edit.z, edit.state);
  }

  function applyLoadedEdit(edit) {
    if (!boundWorld) return;
    const ch = boundWorld.chunkOf(edit.x, edit.z);
    if (!ch || !ch.generated) return;
    applyingRemote++;
    try {
      boundWorld.setBlock(edit.x, edit.y, edit.z, edit.id);
      applyState(edit);
      const existing = boundWorld.getBE(edit.x, edit.y, edit.z);
      if (edit.id === Blocks.ID.AIR || (existing && existing.type === 'sign' && edit.id !== Blocks.ID.OAK_SIGN)) {
        boundWorld.removeBE(edit.x, edit.y, edit.z);
        signs.delete(blockKey(edit.x, edit.y, edit.z));
      }
    } finally { applyingRemote--; }
  }

  function applyChunkEdits(ch) {
    if (!boundWorld || !ch) return;
    const group = editsByChunk.get(ch.key);
    if (!group) return;
    if (ch.generated) {
      for (const edit of group.values()) applyLoadedEdit(edit);
      return;
    }
    applyingRemote++;
    try {
      for (const edit of group.values()) {
        const i = (edit.x & 15) | ((edit.z & 15) << 4) | (edit.y << 8);
        ch.blocks[i] = edit.id;
        if (edit.state === null) boundWorld.states.delete(boundWorld.beKey(edit.x, edit.y, edit.z));
        else boundWorld.states.set(boundWorld.beKey(edit.x, edit.y, edit.z), edit.state);
      }
    } finally { applyingRemote--; }
  }

  function queueLocalBlock(x, y, z) {
    if (applyingRemote || connectionState !== 'connected' || !boundWorld) return;
    const id = boundWorld.getBlock(x, y, z);
    const rawState = boundWorld.getState(x, y, z);
    const state = Number.isInteger(rawState) && rawState >= 0 && rawState <= 15 ? rawState : null;
    const edit = { x: x | 0, y: y | 0, z: z | 0, id: id | 0, state };
    rememberEdit(edit);
    pendingBlocks.set(blockKey(edit.x, edit.y, edit.z), edit);
  }

  function flushPendingBlocks() {
    if (connectionState !== 'connected' || !pendingBlocks.size) return false;
    const batch = [];
    for (const [key, edit] of pendingBlocks) {
      batch.push({ key, edit });
      if (batch.length >= 128) break;
    }
    if (!send({ t: 'blocks', edits: batch.map(entry => entry.edit), inventoryRevision })) return false;
    profileClock = 0;
    for (const entry of batch) {
      if (pendingBlocks.get(entry.key) === entry.edit) pendingBlocks.delete(entry.key);
    }
    return true;
  }

  function networkNow() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  function setPositionTarget(subject, x, y, z) {
    const now = networkNow();
    const distance = Math.hypot(x - subject.x, y - subject.y, z - subject.z);
    if (!subject.lastSnapshotAt || distance > 8) {
      subject.x = subject.targetX = subject.fromX = x;
      subject.y = subject.targetY = subject.fromY = y;
      subject.z = subject.targetZ = subject.fromZ = z;
      subject.interpProgress = 1;
      subject.interpDuration = 0.05;
    } else {
      subject.fromX = subject.x; subject.fromY = subject.y; subject.fromZ = subject.z;
      subject.targetX = x; subject.targetY = y; subject.targetZ = z;
      subject.interpProgress = 0;
      subject.interpDuration = U.clamp((now - subject.lastSnapshotAt) / 1000, 0.035, 0.15);
    }
    subject.lastSnapshotAt = now;
  }

  function interpolatePosition(subject, step) {
    const oldX = subject.x, oldZ = subject.z;
    if (subject.interpProgress < 1) {
      subject.interpProgress = Math.min(1, subject.interpProgress + step / Math.max(0.001, subject.interpDuration));
      const t = subject.interpProgress;
      subject.x = U.lerp(subject.fromX, subject.targetX, t);
      subject.y = U.lerp(subject.fromY, subject.targetY, t);
      subject.z = U.lerp(subject.fromZ, subject.targetZ, t);
    } else {
      const stale = U.clamp((networkNow() - subject.lastSnapshotAt) / 1000, 0, MAX_EXTRAPOLATION);
      subject.x = subject.targetX + (subject.netVx || 0) * stale;
      subject.y = subject.targetY + (subject.netVy || 0) * stale;
      subject.z = subject.targetZ + (subject.netVz || 0) * stale;
    }
    return Math.hypot(subject.x - oldX, subject.z - oldZ) / Math.max(step, 0.001);
  }

  function setMobPositionTarget(subject, x, y, z) {
    const now = networkNow();
    if (!subject.lastSnapshotAt || Math.hypot(x - subject.x, y - subject.y, z - subject.z) > 8) {
      subject.x = x; subject.y = y; subject.z = z;
    }
    subject.targetX = x; subject.targetY = y; subject.targetZ = z;
    subject.lastSnapshotAt = now;
  }

  function interpolateMobPosition(subject, step) {
    const prediction = Math.min(0.05, Math.max(0, (networkNow() - subject.lastSnapshotAt) / 1000));
    const goalX = subject.targetX + (subject.netVx || 0) * prediction;
    const goalY = subject.targetY + (subject.netVy || 0) * prediction;
    const goalZ = subject.targetZ + (subject.netVz || 0) * prediction;
    const blend = 1 - Math.exp(-step * 14);
    if (Math.abs(goalX - subject.x) >= 0.015) subject.x = U.lerp(subject.x, goalX, blend);
    if (Math.abs(goalY - subject.y) >= 0.02) subject.y = U.lerp(subject.y, goalY, blend);
    if (Math.abs(goalZ - subject.z) >= 0.015) subject.z = U.lerp(subject.z, goalZ, blend);
    const targetSpeed = Math.hypot(subject.netVx || 0, subject.netVz || 0);
    subject.animSpeed = U.lerp(subject.animSpeed || 0, targetSpeed, blend);
    if (targetSpeed < 0.02 && subject.animSpeed < 0.02) subject.animSpeed = 0;
  }

  function makeRemote(data) {
    const x = Number(data.x) || 0, y = Number(data.y) || 80, z = Number(data.z) || 0;
    return {
      id: data.id, name: String(data.name || 'Steve').slice(0, 16),
      type: 'remote', kind: 'player', w: 0.6, h: 1.8,
      x, y, z, targetX: x, targetY: y, targetZ: z,
      fromX: x, fromY: y, fromZ: z, interpProgress: 1, interpDuration: 0.05, lastSnapshotAt: 0,
      netVx: 0, netVy: 0, netVz: 0,
      yaw: Number(data.yaw) || 0, targetYaw: Number(data.yaw) || 0, lookYaw: Number(data.yaw) || 0,
      pitch: Number(data.pitch) || 0, targetPitch: Number(data.pitch) || 0,
      age: 0, animPhase: 0, animSpeed: 0, targetSpeed: 0,
      action: 'idle', actionPhase: 0, attackAnim: 0,
      blocking: false, blockBlend: 0,
      onGround: !!data.onGround, sneaking: false, sprinting: false, held: Number(data.held) || 0,
      offhand: Number(data.offhand) || 0, riding: null,
      skin: safeSkin(data.skin), modelType: safeModelType(data.modelType),
      equipment: Array.isArray(data.equipment) ? data.equipment.slice(0, 4) : Array(4).fill(null),
      audioStepDist: 0,
      headYaw: 0, headPitch: 0, hp: 20, mode: 'survival', role: 'user', dead: false,
    };
  }

  function updateRemote(data) {
    if (!data || !data.id || data.id === selfId) return;
    let remote = remotes.get(data.id);
    if (!remote) { remote = makeRemote(data); remotes.set(data.id, remote); }
    if ([data.x, data.y, data.z, data.yaw, data.pitch].every(Number.isFinite)) {
      setPositionTarget(remote, data.x, data.y, data.z);
      remote.targetYaw = data.yaw; remote.targetPitch = data.pitch;
    }
    remote.netVx = Number(data.vx) || 0; remote.netVy = Number(data.vy) || 0; remote.netVz = Number(data.vz) || 0;
    remote.name = String(data.name || remote.name).slice(0, 16);
    remote.targetSpeed = U.clamp(Number(data.speed) || 0, 0, 30);
    const startedAttack = data.action === 'attack' && (remote.action !== 'attack' || Number(data.actionPhase) < remote.actionPhase);
    const changedHeld = Number.isInteger(data.held) && data.held !== remote.held;
    const changedOffhand = Number.isInteger(data.offhand) && data.offhand !== remote.offhand;
    const jumped = remote.onGround && data.onGround === false && (Number(data.vy) || 0) > 1;
    if (startedAttack) remote.attackAnim = 0.42;
    remote.action = typeof data.action === 'string' ? data.action : 'idle';
    remote.actionPhase = U.clamp(Number(data.actionPhase) || 0, 0, 1);
    remote.blocking = !!data.blocking;
    remote.onGround = !!data.onGround;
    remote.sneaking = !!data.sneaking;
    remote.sprinting = !!data.sprinting;
    remote.riding = data.riding === 'minecart' ? 'minecart' : null;
    remote.held = Number.isInteger(data.held) ? data.held : 0;
    remote.offhand = Number.isInteger(data.offhand) ? data.offhand : 0;
    remote.skin = safeSkin(data.skin || remote.skin);
    remote.modelType = safeModelType(data.modelType || remote.modelType);
    remote.equipment = Array.isArray(data.equipment) ? data.equipment.slice(0, 4) : remote.equipment;
    remote.hp = U.clamp(Number(data.hp) || 0, 0, 20);
    remote.mode = data.mode === 'creative' ? 'creative' : 'survival';
    remote.role = typeof data.role === 'string' ? data.role : 'user';
    remote.latency = U.clamp(Number(data.latency) || 0, 0, 999);
    remote.dead = !!data.dead;
    if (typeof Sound !== 'undefined' && Sound.emit) {
      if (startedAttack) Sound.emit('combat.swing', { x: remote.x, y: remote.y + 1.3, z: remote.z, volume: 0.34 });
      if (changedHeld || changedOffhand) Sound.emit('item.equip', { x: remote.x, y: remote.y + 1.1, z: remote.z, volume: 0.3 });
      if (jumped) Sound.emit('player.jump', { x: remote.x, y: remote.y, z: remote.z, volume: 0.3 });
    }
  }

  function applyPlayers(players) {
    if (!Array.isArray(players)) return;
    const seen = new Set();
    for (const data of players) {
      if (!data || data.id === selfId) continue;
      seen.add(data.id); updateRemote(data);
    }
    for (const id of remotes.keys()) if (!seen.has(id)) remotes.delete(id);
    refreshList(remoteListCache, remotes);
    version++;
  }

  const ENTITY_SIZE = {
    pig: [0.9, 1], cow: [0.95, 1.35], sheep: [0.9, 1.3], chicken: [0.5, 0.8],
    zombie: [0.6, 1.95], skeleton: [0.6, 1.95], spider: [1.3, 0.65], creeper: [0.6, 1.8],
    slime: [0.8, 0.8], enderman: [0.6, 2.9], wolf: [0.65, 0.85], villager: [0.6, 1.95],
    cat: [0.55, 0.7], iron_golem: [1.35, 2.7],
    squid: [0.8, 0.8], bat: [0.5, 0.45], blaze: [0.65, 1.8],
    ender_dragon: [5.0, 3.0],
  };

  function makeNetworkEntity(data) {
    const size = ENTITY_SIZE[data.kind] || [0.25, 0.25];
    const babyTime = Math.max(0, Number(data.babyTime) || 0);
    const modelScale = babyTime > 0 ? 0.55 : 1;
    const x = Number(data.x) || 0, y = Number(data.y) || 0, z = Number(data.z) || 0;
    return {
      id: data.id, type: data.type, kind: data.kind,
      x, y, z, targetX: x, targetY: y, targetZ: z,
      fromX: x, fromY: y, fromZ: z, interpProgress: 1, interpDuration: 0.05, lastSnapshotAt: 0,
      netVx: Number(data.vx) || 0, netVy: Number(data.vy) || 0, netVz: Number(data.vz) || 0,
      vx: Number(data.vx) || 0, vy: Number(data.vy) || 0, vz: Number(data.vz) || 0,
      yaw: Number(data.yaw) || 0, targetYaw: Number(data.yaw) || 0,
      age: Number(data.age) || 0, hp: Number(data.hp) || 0,
      itemId: data.itemId, count: data.count || 1, dur: data.dur, ench: data.ench, customName: data.name,
      value: Math.max(1, Number(data.value) || 1), stuck: !!data.stuck,
      fuse: data.fuse, fuseProgress: 0, flash: 0, hurtAnim: 0,
      w: size[0] * modelScale, h: size[1] * modelScale, babyTime,
      embeddedArrows: U.clamp(Number(data.embeddedArrows) || 0, 0, 4),
      burning: !!data.burning,
      animPhase: 0, animSpeed: 0, onGround: data.onGround !== false, dead: false,
      audioStepDist: 0, soundCd: 4 + Math.random() * 8,
      ai: { mode: 'network' }, headYaw: 0, headPitch: 0,
      villageId: data.villageId || null, profession: data.profession || 'unemployed',
      tamed: !!data.tamed, small: !!data.small, sleeping: !!data.sleeping,
      home: data.home || null, jobSite: data.jobSite || null, meeting: data.meeting || null,
      tradeLevel: Number(data.tradeLevel) || 1, tradeUses: Number(data.tradeUses) || 0,
    };
  }

  function applyEntities(items) {
    if (!Array.isArray(items)) return;
    const seen = new Set();
    for (const data of items) {
      if (!data || !data.id || !['mob', 'item', 'arrow', 'egg', 'ender_pearl', 'tnt', 'xp'].includes(data.type)) continue;
      seen.add(data.id);
      let entity = networkEntities.get(data.id);
      if (!entity) { entity = makeNetworkEntity(data); networkEntities.set(data.id, entity); }
      entity.onGround = !!data.onGround;
      const x = Number(data.x) || 0, y = Number(data.y) || 0, z = Number(data.z) || 0;
      if (entity.type === 'mob') setMobPositionTarget(entity, x, y, z);
      else setPositionTarget(entity, x, y, z);
      entity.vx = Number(data.vx) || 0; entity.vy = Number(data.vy) || 0; entity.vz = Number(data.vz) || 0;
      entity.netVx = entity.vx; entity.netVy = entity.vy; entity.netVz = entity.vz;
      const yaw = Number(data.yaw);
      if (Number.isFinite(yaw)) entity.targetYaw = yaw;
      entity.hp = Number(data.hp) || 0; entity.fuse = data.fuse;
      entity.stuck = !!data.stuck;
      entity.value = Math.max(1, Number(data.value) || entity.value || 1);
      entity.babyTime = Math.max(0, Number(data.babyTime) || 0);
      entity.embeddedArrows = U.clamp(Number(data.embeddedArrows) || 0, 0, 4);
      entity.burning = !!data.burning;
      entity.itemId = data.itemId; entity.count = data.count || 1;
      entity.dur = data.dur; entity.ench = data.ench; entity.customName = data.name;
      entity.villageId = data.villageId || null;
      entity.profession = data.profession || entity.profession || 'unemployed';
      entity.tamed = !!data.tamed; entity.small = !!data.small; entity.sleeping = !!data.sleeping;
      entity.home = data.home || null; entity.jobSite = data.jobSite || null; entity.meeting = data.meeting || null;
      entity.tradeLevel = Number(data.tradeLevel) || entity.tradeLevel || 1;
      entity.tradeUses = Math.max(0, Number(data.tradeUses) || 0);
      if (entity.type === 'tnt' && Number.isFinite(entity.fuse)) entity.fuseProgress = U.clamp(1 - entity.fuse / 4, 0, 1);
      else if (entity.type === 'mob' && entity.kind === 'creeper' && Number.isFinite(entity.fuse) && entity.fuse >= 0) {
        entity.fuseProgress = U.clamp(1 - entity.fuse / 1.5, 0, 1);
      } else if (entity.kind === 'creeper') entity.fuseProgress = 0;
    }
    for (const id of networkEntities.keys()) if (!seen.has(id)) networkEntities.delete(id);
    refreshList(networkEntityListCache, networkEntities);
    version++;
  }

  function syncClock(message) {
    if (!boundWorld) return;
    if (Number.isFinite(message.time)) boundWorld.time = message.time;
    if (Number.isFinite(message.timeOfDay)) boundWorld.timeOfDay = U.mod(message.timeOfDay, 1);
    if (message.weather === 'rain' || message.weather === 'clear') boundWorld.weather = message.weather;
    if (Number.isInteger(message.difficulty) && typeof Network.onWorldState === 'function') {
      Network.onWorldState({ difficulty: message.difficulty, weather: message.weather });
    }
  }

  function applyContainer(message) {
    if (!boundWorld || !Number.isInteger(message.x) || !Number.isInteger(message.y) || !Number.isInteger(message.z)) return;
    let be = boundWorld.getBE(message.x, message.y, message.z);
    if (!be || be.type !== message.type) {
      be = { type: message.type, slots: [], burn: 0, burnMax: 0, cook: 0, xpStored: 0 };
      boundWorld.setBE(message.x, message.y, message.z, be);
    }
    const incomingRevision = Number.isInteger(message.revision) ? message.revision : 0;
    const localRevision = Number.isInteger(be._networkRevision) ? be._networkRevision : 0;
    const authoritativeSlots = !!message.conflict || incomingRevision >= localRevision;
    if (authoritativeSlots) {
      be.slots.length = 0;
      for (const stack of message.slots || []) be.slots.push(stack || null);
      be._networkRevision = incomingRevision;
    }
    be.burn = Number(message.burn) || 0; be.burnMax = Number(message.burnMax) || 0; be.cook = Number(message.cook) || 0;
    be.xpStored = Math.max(0, Number(message.xpStored) || 0);
    if (typeof Network.onContainer === 'function') Network.onContainer(be, message);
  }

  function handleMessage(message) {
    if (!message || typeof message.t !== 'string') return;
    if (message.t === 'snapshot') {
      applyPlayers(message.players); applyEntities(message.entities); syncClock(message);
    } else if (message.t === 'pong') {
      if (pendingPing && Number(message.id) === pendingPing.id) {
        const sample = U.clamp(networkNow() - pendingPing.at, 0, 999);
        latency = Math.round(latency > 0 ? latency * 0.72 + sample * 0.28 : sample);
        pendingPing = null;
      }
    } else if (message.t === 'join') {
      updateRemote(message.player); refreshList(remoteListCache, remotes); version++;
    } else if (message.t === 'player_action') {
      updateRemote(message.player); refreshList(remoteListCache, remotes); version++;
    } else if (message.t === 'leave') {
      remotes.delete(message.id); refreshList(remoteListCache, remotes); version++;
    } else if (message.t === 'blocks' && Array.isArray(message.edits)) {
      for (const raw of message.edits) { const edit = rememberEdit(raw); if (edit) applyLoadedEdit(edit); }
    } else if (message.t === 'profile' && message.profile) {
      if (Number.isInteger(message.profile.inventoryRevision)) inventoryRevision = message.profile.inventoryRevision;
      role = typeof message.role === 'string' ? message.role : role;
      permissions = Array.isArray(message.permissions) ? message.permissions.slice() : permissions;
      if (typeof Network.onProfile === 'function') Network.onProfile(message.profile, message.reason || 'sync', message);
    } else if (message.t === 'position') {
      if (message.reason === 'respawn') movementSyncPaused = false;
      if (typeof Network.onPosition === 'function') Network.onPosition(message);
    } else if (message.t === 'combat') {
      if (typeof Network.onCombat === 'function') Network.onCombat(message);
    } else if (message.t === 'attack_result') {
      const target = networkEntities.get(String(message.target));
      if (target && message.hit) {
        target.hp = Number.isFinite(message.hp) ? message.hp : target.hp;
        target.flash = 0.18; target.hurtAnim = 0.3;
      }
      if (typeof Network.onAttackResult === 'function') Network.onAttackResult(message);
    } else if (message.t === 'station_result') {
      if (typeof Network.onStationResult === 'function') Network.onStationResult(message);
    } else if (message.t === 'chat') {
      if (typeof Network.onChat === 'function') Network.onChat(message);
    } else if (message.t === 'container') {
      applyContainer(message);
    } else if (message.t === 'sign') {
      applySign(message);
    } else if (message.t === 'explosion') {
      if (typeof Network.onExplosion === 'function') Network.onExplosion(message);
    } else if (message.t === 'sound') {
      if (typeof Network.onSound === 'function') Network.onSound(message);
    } else if (message.t === 'mine_state') {
      if (typeof Network.onMining === 'function') Network.onMining(message);
    }
  }

  function clearReconnectTimer() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect() {
    if (!allowReconnect || intentionalClose || reconnectTimer || !lastConnectOptions || reconnectAttempts >= 5) return;
    connectionState = 'reconnecting';
    const delay = Math.min(8000, 750 * Math.pow(2, reconnectAttempts++));
    notifyStatus('连接中断，' + (delay / 1000).toFixed(1) + ' 秒后重连');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect(Object.assign({}, lastConnectOptions, { reconnect: true })).then(data => {
        reconnectAttempts = 0;
        if (typeof Network.onReconnect === 'function') Network.onReconnect(data);
      }).catch(() => scheduleReconnect());
    }, delay);
  }

  function connect(options) {
    options = options || {};
    const reconnect = !!options.reconnect;
    const requestedName = setPlayerName(options.name === undefined ? playerName() : options.name);
    if (!reconnect) {
      Network.disconnect(true);
      editsByChunk.clear(); pendingBlocks.clear(); remotes.clear(); networkEntities.clear();
      remoteListCache.length = 0; networkEntityListCache.length = 0;
      signs.clear();
      welcomeData = null; selfId = null; assignedName = ''; role = 'user'; permissions = [];
      inventoryRevision = 0;
      reconnectAttempts = 0; latency = 0;
    }
    stateClock = profileClock = remoteClock = pingClock = 0;
    movementSyncPaused = false;
    pendingPing = null;
    clearReconnectTimer();
    lastConnectOptions = {
      name: requestedName, url: options.url || defaultUrl(),
      skin: safeSkin(options.skin), modelType: safeModelType(options.modelType),
    };
    lastError = ''; connectionState = reconnect ? 'reconnecting' : 'connecting';
    intentionalClose = false; allowReconnect = true;
    notifyStatus(reconnect ? '正在重新连接服务器' : '正在连接服务器');
    return new Promise((resolve, reject) => {
      if (typeof WebSocket === 'undefined') { connectionState = 'offline'; reject(new Error('当前环境不支持 WebSocket')); return; }
      const ws = new WebSocket(lastConnectOptions.url);
      socket = ws;
      let settled = false;
      const timeout = setTimeout(() => {
        if (socket === ws) ws.close();
        if (!settled) { settled = true; connectionState = 'offline'; reject(new Error('连接服务器超时')); }
      }, 8000);
      ws.addEventListener('open', () => {
        if (socket === ws) send({
          t: 'hello', protocol: PROTOCOL, name: requestedName, token: playerToken(),
          skin: lastConnectOptions.skin, modelType: lastConnectOptions.modelType,
          capabilities: ['mining_v1', 'inventory_revision_v1', 'survival_actions_v1'],
        });
      });
      ws.addEventListener('message', event => {
        if (socket !== ws) return;
        let message;
        try { message = JSON.parse(event.data); } catch (error) { return; }
        if (message.t === 'welcome') {
          if (message.protocol !== PROTOCOL || !Number.isInteger(message.seed)) { allowReconnect = false; ws.close(1002, 'protocol mismatch'); return; }
          clearTimeout(timeout); connectionState = 'connected'; selfId = message.id;
          assignedName = String(message.name || playerName()); welcomeData = message;
          if (message.profile && Number.isInteger(message.profile.inventoryRevision)) inventoryRevision = message.profile.inventoryRevision;
          role = typeof message.role === 'string' ? message.role : 'user';
          permissions = Array.isArray(message.permissions) ? message.permissions.slice() : [];
          for (const edit of message.edits || []) rememberEdit(edit);
          for (const old of signs.values()) {
            if (!boundWorld) break;
            const be = boundWorld.getBE(old.x, old.y, old.z);
            if (be && be.type === 'sign') boundWorld.removeBE(old.x, old.y, old.z);
          }
          signs.clear();
          for (const sign of message.signs || []) applySign(sign);
          applyPlayers(message.players || []); applyEntities(message.entities || []); syncClock(message);
          if (!settled) { settled = true; resolve(message); }
          notifyStatus(reconnect ? '已重新连接服务器' : '已连接服务器');
          return;
        }
        if (message.t === 'error') {
          lastError = String(message.message || '服务器拒绝连接');
          if (['banned', 'whitelist', 'protocol', 'identity'].includes(message.code)) allowReconnect = false;
          if (!settled) { clearTimeout(timeout); settled = true; reject(new Error(lastError)); }
          if (typeof Network.onChat === 'function') Network.onChat({ kind: 'system', text: lastError, at: Date.now() });
          return;
        }
        handleMessage(message);
      });
      ws.addEventListener('error', () => { if (socket === ws) lastError = '无法连接联机服务器'; });
      ws.addEventListener('close', () => {
        if (socket !== ws) return;
        clearTimeout(timeout); socket = null; connectionState = 'offline';
        pendingPing = null;
        remotes.clear(); networkEntities.clear(); remoteListCache.length = 0; networkEntityListCache.length = 0; version++;
        if (!settled) { settled = true; reject(new Error(lastError || '服务器连接已关闭')); }
        if (!intentionalClose) scheduleReconnect();
      });
    });
  }

  function bindWorld(world) {
    if (boundWorld) {
      boundWorld.onChunkGenerated = null; boundWorld.onBlockChanged = null; boundWorld.onStateChanged = null;
    }
    boundWorld = world || null;
    if (!boundWorld) return;
    boundWorld.onChunkGenerated = applyChunkEdits;
    boundWorld.onBlockChanged = queueLocalBlock;
    boundWorld.onStateChanged = queueLocalBlock;
    for (const ch of boundWorld.chunks.values()) applyChunkEdits(ch);
    for (const sign of signs.values()) applySign(sign);
    if (welcomeData) syncClock(welcomeData);
  }

  function profilePayload(player) {
    const safeInventory = typeof UI !== 'undefined' && UI.profileInventory ? UI.profileInventory() : null;
    return {
      hp: player.hp, hunger: player.hunger, saturation: player.saturation, air: player.air,
      hotbar: player.hotbar, inv: safeInventory || player.inv, equipment: player.equipment,
      offhand: player.offhand,
      cursor: player.cursor,
      xpLevel: player.xpLevel, xpProgress: player.xpProgress,
      statusEffects: player.statusEffects, spawn: player.spawn,
      inventoryRevision,
    };
  }

  function tick(player, dt) {
    if (connectionState !== 'connected' || !player) return;
    pingClock += dt;
    if (pingClock >= PING_INTERVAL) {
      pingClock %= PING_INTERVAL;
      const now = networkNow();
      if (!pendingPing || now - pendingPing.at > 5000) {
        const id = ++pingNonce & 0x7fffffff;
        pendingPing = { id, at: now };
        send({ t: 'ping', id });
      }
    }
    if (!player.dead && !movementSyncPaused) {
      stateClock += dt;
      if (stateClock >= STATE_INTERVAL) {
        stateClock %= STATE_INTERVAL;
        const duration = Math.max(0.001, player.handActionDuration || 0.3);
        send({
          t: 'state', x: player.x, y: player.y, z: player.z,
          yaw: player.yaw, pitch: player.pitch, speed: Math.hypot(player.vx || 0, player.vz || 0),
          action: player.handAction || 'idle', actionPhase: U.clamp((player.handActionTime || 0) / duration, 0, 1),
          blocking: !!player.isBlocking,
          riding: player.riding === 'minecart' ? 'minecart' : null,
          onGround: !!player.onGround, sneaking: !!player.isSneaking, sprinting: !!player.isSprinting,
          skin: safeSkin(player.skin), modelType: safeModelType(player.modelType),
          hotbar: player.hotbar, latency,
        });
        flushPendingBlocks();
      }
      profileClock += dt;
      if (profileClock >= PROFILE_INTERVAL) {
        profileClock %= PROFILE_INTERVAL;
        send({ t: 'profile', profile: profilePayload(player), cause: '' });
      }
    } else {
      stateClock = 0;
      profileClock = 0;
    }

    remoteClock += dt;
    if (remoteClock < REMOTE_STEP) return;
    const step = Math.min(0.1, remoteClock);
    remoteClock %= REMOTE_STEP;
    const blend = 1 - Math.exp(-step * 18);
    let renderChanged = false;
    for (const remote of remotes.values()) {
      renderChanged = true;
      const movementSpeed = interpolatePosition(remote, step);
      remote.lookYaw = remote.targetYaw;
      const moving = Math.hypot(remote.netVx || 0, remote.netVz || 0) > 0.28;
      let desiredBodyYaw = moving ? Math.atan2(remote.netVx, -remote.netVz) : remote.lookYaw;
      const lookFromBody = Math.atan2(Math.sin(remote.lookYaw - remote.yaw), Math.cos(remote.lookYaw - remote.yaw));
      if (!moving && Math.abs(lookFromBody) < 1.18) desiredBodyYaw = remote.yaw;
      const yawDelta = Math.atan2(Math.sin(desiredBodyYaw - remote.yaw), Math.cos(desiredBodyYaw - remote.yaw));
      remote.yaw += yawDelta * (1 - Math.exp(-step * (moving ? 12 : 7)));
      remote.headYaw = U.clamp(Math.atan2(Math.sin(remote.lookYaw - remote.yaw), Math.cos(remote.lookYaw - remote.yaw)), -1.35, 1.35);
      remote.pitch = U.lerp(remote.pitch, remote.targetPitch, blend); remote.headPitch = -remote.pitch;
      remote.animSpeed = U.lerp(remote.animSpeed, Math.max(movementSpeed, remote.targetSpeed * 0.65), blend); remote.animPhase += remote.animSpeed * step * 2.6;
      const blockTarget = remote.blocking ? 1 : 0;
      remote.blockBlend = U.lerp(remote.blockBlend || 0, blockTarget, 1 - Math.exp(-step * 16));
      if (Math.abs(remote.blockBlend - blockTarget) < 0.002) remote.blockBlend = blockTarget;
      remote.attackAnim = Math.max(0, remote.attackAnim - step); remote.age += step;
      if (remote.onGround && movementSpeed > 0.45 && boundWorld && typeof Sound !== 'undefined' && Sound.emit) {
        remote.audioStepDist = (remote.audioStepDist || 0) + movementSpeed * step;
        const stride = remote.sprinting ? 1.75 : remote.sneaking ? 2.7 : 2.1;
        if (remote.audioStepDist >= stride) {
          remote.audioStepDist %= stride;
          const under = boundWorld.getBlock(Math.floor(remote.x), Math.floor(remote.y - 0.3), Math.floor(remote.z));
          if (under) Sound.emit(Blocks.soundEvent ? Blocks.soundEvent(under, 'step') : 'block.stone.step', {
            x: remote.x, y: remote.y, z: remote.z, volume: remote.sneaking ? 0.18 : remote.sprinting ? 0.48 : 0.35,
          });
        }
      }
    }
    for (const entity of networkEntities.values()) {
      renderChanged = true;
      if (entity.type === 'mob') interpolateMobPosition(entity, step);
      else entity.animSpeed = interpolatePosition(entity, step);
      const yawDelta = Math.atan2(Math.sin(entity.targetYaw - entity.yaw), Math.cos(entity.targetYaw - entity.yaw));
      entity.yaw += yawDelta * blend;
      entity.animPhase += entity.animSpeed * step * 2.6; entity.age += step;
      entity.flash = Math.max(0, (entity.flash || 0) - step);
      entity.hurtAnim = Math.max(0, (entity.hurtAnim || 0) - step);
      if (entity.type === 'mob' && typeof Sound !== 'undefined' && Sound.emit) {
        entity.soundCd = (entity.soundCd || 0) - step;
        if (entity.soundCd <= 0) {
          Sound.emit('entity.' + (entity.kind || 'generic') + '.ambient', { x: entity.x, y: entity.y + entity.h * 0.55, z: entity.z, volume: 0.68 });
          entity.soundCd = 7 + Math.random() * 15;
        }
        const speed = Math.hypot(entity.netVx || 0, entity.netVz || 0);
        if (speed > 0.35 && !['squid', 'bat', 'blaze', 'ender_dragon'].includes(entity.kind)) {
          entity.audioStepDist = (entity.audioStepDist || 0) + speed * step;
          const stride = Math.max(0.45, Math.min(2.2, entity.w * (entity.kind === 'chicken' ? 1.4 : 1.9)));
          if (entity.audioStepDist >= stride) {
            entity.audioStepDist %= stride;
            Sound.emit('entity.' + (entity.kind || 'generic') + '.step', {
              x: entity.x, y: entity.y + Math.min(0.5, entity.h * 0.3), z: entity.z,
              volume: U.clamp(0.24 + entity.w * 0.22, 0.25, 0.72),
            });
          }
        }
      }
    }
    if (renderChanged) version++;
  }

  function rayAabb(ox, oy, oz, dx, dy, dz, entity, maxDistance) {
    const half = (entity.w || 0.6) / 2;
    const min = [entity.x - half, entity.y, entity.z - half];
    const max = [entity.x + half, entity.y + (entity.h || 1.8), entity.z + half];
    const origin = [ox, oy, oz], direction = [dx, dy, dz];
    let near = 0, far = maxDistance;
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(direction[axis]) < 1e-8) {
        if (origin[axis] < min[axis] || origin[axis] > max[axis]) return null;
      } else {
        let a = (min[axis] - origin[axis]) / direction[axis];
        let b = (max[axis] - origin[axis]) / direction[axis];
        if (a > b) { const swap = a; a = b; b = swap; }
        near = Math.max(near, a); far = Math.min(far, b);
        if (near > far) return null;
      }
    }
    return near <= maxDistance ? near : null;
  }

  function attackTarget(player) {
    if (connectionState !== 'connected' || !player || player.dead) return false;
    const direction = player.lookDir();
    const ox = Number.isFinite(player.viewX) ? player.viewX : player.x;
    const baseY = Number.isFinite(player.viewY) ? player.viewY : player.y;
    const oz = Number.isFinite(player.viewZ) ? player.viewZ : player.z;
    const oy = baseY + player.eye;
    let best = null;
    for (const remote of remotes.values()) {
      if (remote.dead) continue;
      const distance = rayAabb(ox, oy, oz, direction[0], direction[1], direction[2], remote, 3);
      if (distance !== null && (!best || distance < best.distance)) best = { targetType: 'player', id: remote.id, distance, entity: remote };
    }
    for (const entity of networkEntities.values()) {
      if (entity.type !== 'mob') continue;
      const distance = rayAabb(ox, oy, oz, direction[0], direction[1], direction[2], entity, 3);
      if (distance !== null && (!best || distance < best.distance)) best = { targetType: 'entity', id: entity.id, distance, entity };
    }
    if (!best) return false;
    const block = boundWorld && boundWorld.raycast(ox, oy, oz, direction[0], direction[1], direction[2], 3);
    if (block && block.dist <= best.distance) return false;
    const strength = player.consumeAttackCharge ? player.consumeAttackCharge() : 1;
    player.beginHandAction('attack', 0.30, false);
    send({
      t: 'action', action: 'attack', targetType: best.targetType, target: best.id,
      targetX: best.entity.x, targetY: best.entity.y, targetZ: best.entity.z, latency, strength,
    });
    return true;
  }

  const Network = {
    protocol: PROTOCOL,
    onStatus: null, onProfile: null, onPosition: null, onCombat: null, onAttackResult: null, onStationResult: null,
    onChat: null, onContainer: null, onExplosion: null, onSound: null, onMining: null, onReconnect: null, onWorldState: null,
    connect, bindWorld, tick, attackTarget,
    getPlayerName: playerName, setPlayerName,
    sendChat(text) { return send({ t: 'chat', text: String(text || '').slice(0, 160) }); },
    command(text) { return this.sendChat(text && text[0] === '/' ? text : '/' + String(text || '')); },
    dropHeld(all, hotbar, stack) {
      return send({
        t: 'action', action: 'drop', all: !!all, inventoryRevision,
        hotbar: U.clamp(hotbar | 0, 0, 8), expectedId: stack && Number.isInteger(stack.id) ? stack.id : 0,
      });
    },
    dropInventorySlot(source, index, count, stack) {
      if (source !== 'inv' && source !== 'armor' && source !== 'offhand' && source !== 'cursor') return false;
      return send({
        t: 'action', action: 'drop_slot', source, inventoryRevision,
        index: Number.isInteger(index) ? index : 0,
        count: Math.max(1, Number(count) | 0),
        expectedId: stack && Number.isInteger(stack.id) ? stack.id : 0,
      });
    },
    fireArrow(direction, charge) { return send({ t: 'action', action: 'fire_arrow', direction, charge }); },
    throwEgg(direction) { return send({ t: 'action', action: 'throw_egg', direction, inventoryRevision }); },
    throwEnderPearl(direction) { return send({ t: 'action', action: 'throw_ender_pearl', direction, inventoryRevision }); },
    fillBottle(x, y, z) { return send({ t: 'action', action: 'fill_bottle', x, y, z, inventoryRevision }); },
    useStation(station, x, y, z) { return send({ t: 'action', action: 'use_station', station, x, y, z, inventoryRevision }); },
    startMining(x, y, z, id, total, state) {
      state = state || {};
      // Preserve WebSocket ordering: finish the previous block before a held
      // mouse button starts mining the block exposed behind it.
      flushPendingBlocks();
      return send({
        t: 'action', action: 'mine_start', x, y, z, id, total,
        hotbar: Number.isInteger(state.hotbar) ? U.clamp(state.hotbar, 0, 8) : undefined,
        toolId: Number.isInteger(state.toolId) ? state.toolId : 0,
        onGround: !!state.onGround, underwater: !!state.underwater,
        inventoryRevision,
      });
    },
    setBlocking(active, hotbar) {
      return send({ t: 'action', action: 'block_state', active: !!active, hotbar: U.clamp(hotbar | 0, 0, 8) });
    },
    setHeldSlot(hotbar) { return send({ t: 'action', action: 'held_slot', hotbar: U.clamp(hotbar | 0, 0, 8) }); },
    mountMinecart(x, y, z) { return send({ t:'action', action:'mount_minecart', x, y, z, inventoryRevision }); },
    dismountMinecart() { return send({ t:'action', action:'dismount_minecart', inventoryRevision }); },
    craft(grid, shift) {
      if (!Array.isArray(grid)) return 0;
      const cleanGrid = grid.map(stack => stack ? { id: stack.id, n: stack.n } : null);
      const transaction = ++craftTransactionNonce & 0x7fffffff;
      return send({
        t: 'action', action: 'craft', grid: cleanGrid, shift: !!shift,
        inventoryRevision, transaction,
      }) ? transaction : 0;
    },
    feedEntity(target) { return send({ t: 'action', action: 'feed', target: String(target || '') }); },
    interactEntity(target, interaction) { return send({ t: 'action', action: 'interact', target: String(target || ''), interaction: String(interaction || '') }); },
    eatHeld(itemId) { return send({ t: 'action', action: 'eat', itemId: Number(itemId) || 0, inventoryRevision }); },
    sleepAt(x, y, z) { return send({ t: 'action', action: 'sleep', x, y, z }); },
    usePortal(portalId, x, y, z) { return send({ t: 'action', action: 'portal', portalId, x, y, z }); },
    spawnTNT(x, y, z) { return send({ t: 'action', action: 'tnt', x, y, z, inventoryRevision }); },
    reportDeath(cause) { return send({ t: 'action', action: 'death', cause: String(cause || '死亡').slice(0, 32) }); },
    respawn() {
      const sent = send({ t: 'action', action: 'respawn' });
      if (sent) {
        movementSyncPaused = true;
        stateClock = profileClock = 0;
      }
      return sent;
    },
    syncProfile(player) { return send({ t: 'profile', profile: profilePayload(player) }); },
    commitProfile(player) {
      const transaction = ++profileTransactionNonce;
      return send({ t: 'profile', profile: profilePayload(player), transaction }) ? transaction : 0;
    },
    openContainer(be) {
      if (!be) return false;
      return send({ t: 'container', action: 'open', type: be.type, x: be.x, y: be.y, z: be.z });
    },
    updateContainer(be, player) {
      if (!be || !player) return false;
      const revision = Number.isInteger(be._networkRevision) ? be._networkRevision : 0;
      const sent = send({
        t: 'container', action: 'update', type: be.type, x: be.x, y: be.y, z: be.z,
        slots: be.slots, revision, inventoryRevision,
        profile: profilePayload(player),
      });
      if (sent) {
        be._networkRevision = revision + 1;
        inventoryRevision = (inventoryRevision + 1) & 0x7fffffff;
      }
      return sent;
    },
    updateSign(be) {
      if (!be || !Number.isInteger(be.x) || !Number.isInteger(be.y) || !Number.isInteger(be.z)) return false;
      const sign = cleanSign({ x: be.x, y: be.y, z: be.z, lines: be.lines });
      if (!sign) return false;
      flushPendingBlocks();
      return send({ t: 'sign', x: sign.x, y: sign.y, z: sign.z, lines: sign.lines });
    },
    disconnect(silent) {
      intentionalClose = true; allowReconnect = false; clearReconnectTimer();
      movementSyncPaused = false;
      if (boundWorld) {
        boundWorld.onChunkGenerated = null; boundWorld.onBlockChanged = null; boundWorld.onStateChanged = null;
      }
      boundWorld = null;
      if (socket) { const ws = socket; socket = null; try { ws.close(1000, 'client disconnect'); } catch (error) { /* closed */ } }
      connectionState = 'offline'; selfId = null; remotes.clear(); networkEntities.clear();
      remoteListCache.length = 0; networkEntityListCache.length = 0; pendingBlocks.clear(); signs.clear(); version++;
      if (!silent) notifyStatus('已断开服务器');
    },
    isConnected() { return connectionState === 'connected'; },
    isActive() { return connectionState === 'connecting' || connectionState === 'connected' || connectionState === 'reconnecting'; },
    remotePlayers() { return remoteListCache; },
    remoteEntities() { return networkEntityListCache; },
    renderVersion() { return version; },
    hasPermission(permission) { return permissions.includes('*') || permissions.includes(permission); },
    status() {
      return {
        state: connectionState, id: selfId, name: assignedName || playerName(),
        players: connectionState === 'connected' ? remotes.size + 1 : 0,
        latency, error: lastError, url: defaultUrl(), role, permissions: permissions.slice(), reconnectAttempts,
      };
    },
  };

  window.Network = Network;
})();
