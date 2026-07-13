'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { WebSocket } = require('ws');

const ROOT = path.resolve(__dirname, '..');

function waitForMessage(socket, type, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup(); reject(new Error('timeout waiting for ' + type));
    }, timeoutMs || 4000);
    const onMessage = (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch (error) { return; }
      if (message.t !== type) return;
      cleanup(); resolve(message);
    };
    const onClose = () => { cleanup(); reject(new Error('socket closed waiting for ' + type)); };
    function cleanup() {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('close', onClose);
    }
    socket.on('message', onMessage);
    socket.on('close', onClose);
  });
}

function waitForMessageWhere(socket, type, predicate, timeoutMs, description) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup(); reject(new Error('timeout waiting for ' + (description || ('matching ' + type))));
    }, timeoutMs || 4000);
    const onMessage = (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch (error) { return; }
      if (message.t !== type || !predicate(message)) return;
      cleanup(); resolve(message);
    };
    const onClose = () => { cleanup(); reject(new Error('socket closed waiting for matching ' + type)); };
    function cleanup() {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('close', onClose);
    }
    socket.on('message', onMessage);
    socket.on('close', onClose);
  });
}

let tokenCounter = 0;

async function connectPlayer(port, name, token, appearance) {
  const socket = new WebSocket('ws://127.0.0.1:' + port + '/ws');
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const welcomePromise = waitForMessage(socket, 'welcome');
  const identity = token || ('test-identity-' + String(++tokenCounter).padStart(8, '0'));
  socket.send(JSON.stringify(Object.assign({ t: 'hello', protocol: 3, name, token: identity }, appearance || {})));
  const welcome = await welcomePromise;
  return { socket, welcome, token: identity };
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function waitUntil(predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (predicate()) { resolve(); return; }
      if (Date.now() - started >= (timeoutMs || 4000)) { reject(new Error('condition timeout')); return; }
      setTimeout(poll, 20);
    };
    poll();
  });
}

test('nameplate projection maps visible world points to HUD space', () => {
  const sandbox = {
    window: null,
    Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array,
    Array, Map, Set, Math, Number, Object, String, Boolean, JSON,
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(fsSync.readFileSync(path.join(ROOT, 'js', 'gl.js'), 'utf8'), context, { filename: 'gl.js' });
  vm.runInContext(fsSync.readFileSync(path.join(ROOT, 'js', 'renderer.js'), 'utf8'), context, { filename: 'renderer.js' });
  const matrix = sandbox.GL.mat4;
  const projection = matrix.create();
  matrix.perspective(projection, Math.PI / 2, 16 / 9, 0.08, 480);
  sandbox.Renderer._pv = projection;
  const center = sandbox.Renderer.projectPoint(0, 0, -5);
  assert.ok(center);
  assert.ok(Math.abs(center.x - 0.5) < 1e-6);
  assert.ok(Math.abs(center.y - 0.5) < 1e-6);
  assert.equal(sandbox.Renderer.projectPoint(0, 0, 5), null);
});

async function createGameClient(port, name, clockSkewMs, token) {
  const values = new Map();
  if (token) values.set('webcraft_player_token', token);
  const RealDate = Date;
  const ClientDate = class extends RealDate {
    static now() { return RealDate.now() + (clockSkewMs || 0); }
  };
  const sandbox = {
    console, setTimeout, clearTimeout, performance,
    location: { protocol: 'http:', host: '127.0.0.1:' + port, search: '' },
    WebSocket, URLSearchParams,
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); },
    },
    Uint8Array, Uint16Array, Uint32Array, Int32Array, Float32Array,
    Map, Set, WeakMap, Math, Date: ClientDate, JSON, Number, String, Boolean, Object, Array, RegExp,
    Error, TypeError, RangeError, parseInt, parseFloat, isNaN, Infinity, NaN,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  for (const file of ['util', 'noise', 'blocks', 'world', 'network']) {
    vm.runInContext(fsSync.readFileSync(path.join(ROOT, 'js', file + '.js'), 'utf8'), context, { filename: file + '.js' });
  }
  const welcome = await sandbox.Network.connect({ name });
  const world = new sandbox.World(welcome.seed);
  sandbox.Network.bindWorld(world);
  world.ensureChunk(0, 0);
  const player = {
    x: 0.5, y: 80, z: 0.5, yaw: 0, pitch: 0, vx: 0, vz: 0,
    handAction: 'idle', handActionTime: 0, handActionDuration: 0.3,
    onGround: true, isSneaking: false, isSprinting: false, mode: 'creative',
    held() { return null; },
  };
  sandbox.Network.tick(player, 0.1);
  return { sandbox, world, player };
}

test('server mob ticks keep animals grounded and process hostile arrows safely', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcraft-passive-mob-'));
  const edits = [];
  for (let x = 7; x <= 9; x++) for (let z = -1; z <= 1; z++) {
    edits.push({ x, y: 79, z, id: 2, state: null });
    edits.push({ x, y: 80, z, id: 0, state: null });
    edits.push({ x, y: 81, z, id: 0, state: null });
    edits.push({ x, y: 82, z, id: 0, state: null });
  }
  for (let x = 3; x <= 5; x++) for (let z = -1; z <= 1; z++) {
    edits.push({ x, y: 94, z, id: 1, state: null });
    edits.push({ x, y: 95, z, id: 0, state: null });
    edits.push({ x, y: 96, z, id: 0, state: null });
    edits.push({ x, y: 97, z, id: 0, state: null });
  }
  await fs.writeFile(path.join(dataDir, 'world.json'), JSON.stringify({
    seed: 123456789,
    edits,
    entities: [
      { type: 'mob', kind: 'pig', x: 8.5, y: 80, z: 0.5, hp: 10 },
      { type: 'mob', kind: 'skeleton', x: 4.5, y: 95, z: 0.5, hp: 20 },
      {
        type: 'mob', kind: 'villager', x: 12.5, y: 80, z: 0.5, hp: 20,
        villageId: 'village:0:0', profession: 'farmer',
        home: { x: 12, y: 80, z: 0 }, jobSite: { x: 13, y: 80, z: 0 }, meeting: { x: 11, y: 80, z: 0 },
      },
    ],
  }));

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, ADMIN_PASSWORD: 'test-secret' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('server start timeout\n' + output)), 5000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error('server exited with ' + code + '\n' + output)); });
  });

  const player = await connectPlayer(port, 'Observer');
  player.socket.send(JSON.stringify({
    t: 'state', x: 0.5, y: 95, z: 0.5, yaw: 0, pitch: 0,
    speed: 0, action: 'idle', actionPhase: 0, mode: 'survival', hotbar: 0,
  }));
  await delay(650);
  const snapshot = await waitForMessage(player.socket, 'snapshot');
  const pig = snapshot.entities.find(entity => entity.type === 'mob' && entity.kind === 'pig');
  assert.ok(pig, 'saved passive mob should be present');
  assert.ok(snapshot.entities.some(entity => entity.type === 'mob' && entity.kind === 'skeleton'));
  const villager = snapshot.entities.find(entity => entity.type === 'mob' && entity.kind === 'villager');
  assert.equal(villager && villager.profession, 'farmer');
  assert.equal(villager && villager.villageId, 'village:0:0');
  assert.equal(child.exitCode, null, 'hostile arrow simulation must not terminate the server');
  assert.ok(Math.abs(pig.y - 80) < 0.06, 'passive mob must remain on the terrain instead of matching player height');
  assert.ok(Math.abs(pig.x - 8.5) < 0.12, 'passive mob must not continuously move toward the player');

  const pongPromise = waitForMessage(player.socket, 'pong');
  player.socket.send(JSON.stringify({ t: 'ping', id: 77 }));
  assert.equal((await pongPromise).id, 77);

  const attacker = await connectPlayer(port, 'Fighter');
  attacker.socket.send(JSON.stringify({
    t: 'state', x: pig.x - 3.1, y: pig.y, z: pig.z, yaw: Math.PI / 2, pitch: 0,
    speed: 0, action: 'idle', actionPhase: 0, onGround: true, hotbar: 0, latency: 300,
  }));
  const attackResultPromise = waitForMessage(attacker.socket, 'attack_result');
  attacker.socket.send(JSON.stringify({
    t: 'action', action: 'attack', targetType: 'entity', target: pig.id,
    targetX: pig.x, targetY: pig.y, targetZ: pig.z, latency: 300,
  }));
  const attackResult = await attackResultPromise;
  assert.equal(attackResult.hit, true);
  assert.ok(attackResult.hp < 10);

  const renderClient = await createGameClient(port, 'Renderer');
  const renderedPig = renderClient.sandbox.Network.remoteEntities().find(entity => entity.id === pig.id);
  assert.ok(renderedPig);
  const stableX = renderedPig.x;
  renderedPig.fromX = stableX;
  renderedPig.targetX = stableX + 0.01;
  renderedPig.interpProgress = 0;
  renderedPig.interpDuration = 0.05;
  renderedPig.netVx = renderedPig.netVy = renderedPig.netVz = 0;
  renderedPig.animSpeed = 0;
  renderClient.sandbox.Network.tick(renderClient.player, 0.04);
  assert.ok(Math.abs(renderedPig.x - stableX) < 0.001, 'idle mob should ignore sub-pixel snapshot correction');
  assert.equal(renderedPig.animSpeed, 0, 'idle snapshot correction must not trigger walking animation');
  renderClient.sandbox.Network.disconnect(true);
  attacker.socket.close();
  player.socket.close();
});

test('server ground mobs automatically jump one-block obstacles while chasing players', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcraft-mob-jump-'));
  const edits = [];
  for (let x = -1; x <= 9; x++) for (let z = -2; z <= 2; z++) {
    edits.push({ x, y: 79, z, id: 1, state: null });
    for (let clearY = 80; clearY <= 83; clearY++) edits.push({ x, y: clearY, z, id: 0, state: null });
  }
  for (let z = -1; z <= 1; z++) edits.push({ x: 4, y: 80, z, id: 1, state: null });
  await fs.writeFile(path.join(dataDir, 'world.json'), JSON.stringify({
    seed: 123456790,
    timeOfDay: 0.82,
    edits,
    entities: [{ type: 'mob', kind: 'zombie', x: 7.5, y: 80, z: 0.5, hp: 20 }],
  }));

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, ADMIN_PASSWORD: 'test-secret' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let player = null;
  t.after(async () => {
    if (player && player.socket.readyState < WebSocket.CLOSING) player.socket.close();
    if (child.exitCode === null) child.kill('SIGTERM');
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('server start timeout\n' + output)), 5000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('server exited with ' + code + '\n' + output)); });
  });

  player = await connectPlayer(port, 'StepTarget');
  const jumping = await waitForMessageWhere(player.socket, 'snapshot', message => {
    const zombie = message.entities.find(entity => entity.type === 'mob' && entity.kind === 'zombie');
    return !!(zombie && zombie.x < 5.55 && (zombie.y > 80.08 || zombie.vy > 0.5));
  }, 5000, 'mob jump snapshot');
  const zombie = jumping.entities.find(entity => entity.type === 'mob' && entity.kind === 'zombie');
  assert.ok(zombie.y > 80.08 || zombie.vy > 0.5,
    'the authoritative server simulation should lift a mob over a one-block obstacle');
  assert.equal(child.exitCode, null);
});

test('server sunlight ignites exposed undead and removes them after lethal fire damage', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcraft-undead-sunlight-'));
  const edits = [];
  for (let x = 0; x <= 10; x++) for (let z = -1; z <= 1; z++) {
    edits.push({ x, y: 79, z, id: 1, state: null });
    for (let clearY = 80; clearY <= 83; clearY++) edits.push({ x, y: clearY, z, id: 0, state: null });
  }
  await fs.writeFile(path.join(dataDir, 'world.json'), JSON.stringify({
    seed: 123456791,
    timeOfDay: 0.5,
    weather: 'clear',
    edits,
    entities: [{ type: 'mob', kind: 'zombie', x: 8.5, y: 80, z: 0.5, hp: 2 }],
  }));

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, ADMIN_PASSWORD: 'test-secret' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let client = null;
  t.after(async () => {
    if (client) client.sandbox.Network.disconnect(true);
    if (child.exitCode === null) child.kill('SIGTERM');
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('server start timeout\n' + output)), 5000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('server exited with ' + code + '\n' + output)); });
  });

  client = await createGameClient(port, 'SunObserver');
  await waitUntil(() => client.sandbox.Network.remoteEntities().some(entity =>
    entity.type === 'mob' && entity.kind === 'zombie' && entity.burning), 2500);
  const burningZombie = client.sandbox.Network.remoteEntities().find(entity => entity.kind === 'zombie');
  assert.equal(burningZombie.burning, true, 'network snapshots should expose the authoritative burning state');
  await waitUntil(() => !client.sandbox.Network.remoteEntities().some(entity => entity.kind === 'zombie'), 3500);
  assert.equal(child.exitCode, null);
});

test('server restores a corrupt primary world from the backup', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcraft-backup-'));
  await fs.writeFile(path.join(dataDir, 'world.json'), '{"seed":');
  await fs.writeFile(path.join(dataDir, 'world.backup.json'), JSON.stringify({
    v: 2, seed: 987654321, edits: [], profiles: [], containers: [], signs: [], entities: [],
  }));
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, ADMIN_PASSWORD: 'test-secret' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('server start timeout\n' + output)), 5000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('server exited with ' + code + '\n' + output)); });
  });
  const player = await connectPlayer(port, 'BackupCheck');
  assert.equal(player.welcome.seed, 987654321);
  player.socket.close();
  await delay(150);
  const healed = JSON.parse(await fs.readFile(path.join(dataDir, 'world.json'), 'utf8'));
  assert.equal(healed.seed, 987654321, 'recovery must replace the corrupt primary file atomically');
});

test('single server synchronizes and persists block edits', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcraft-server-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, ADMIN_PASSWORD: 'test-secret' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('server start timeout\n' + output)), 5000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error('server exited with ' + code + '\n' + output)); });
  });

  const health = await fetch('http://127.0.0.1:' + port + '/health').then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.protocol, 3);

  const first = await connectPlayer(port, '玩家', undefined, { skin: 'alex', modelType: 'slim' });
  const joinPromise = waitForMessage(first.socket, 'join');
  const second = await connectPlayer(port, 'Bob');
  const join = await joinPromise;
  assert.equal(join.player.name, 'Bob');
  assert.equal(first.welcome.seed, second.welcome.seed);
  assert.equal(first.welcome.name, '玩家');
  assert.equal(first.welcome.profile.mode, 'survival');
  assert.equal(first.welcome.role, 'user');
  const duplicate = await connectPlayer(port, '玩家');
  assert.equal(duplicate.welcome.name, '玩家#2');
  duplicate.socket.close();

  const state = { t: 'state', x: 0.5, y: 80, z: 0.5, yaw: 0, pitch: 0, speed: 0, action: 'idle', actionPhase: 0, mode: 'creative', hotbar: 0 };
  const rejectedProfilePromise = waitForMessage(first.socket, 'profile');
  first.socket.send(JSON.stringify({ t: 'profile', profile: Object.assign({}, first.welcome.profile, { mode: 'creative' }) }));
  assert.equal((await rejectedProfilePromise).profile.mode, 'survival');
  const commitPromise = waitForMessage(first.socket, 'profile');
  first.socket.send(JSON.stringify({
    t: 'profile', transaction: 42,
    profile: Object.assign({}, first.welcome.profile, {
      equipment: [{ id: 348, n: 1, ench: { protection: 1 } }, null, null, null],
    }),
  }));
  const committedProfile = await commitPromise;
  assert.equal(committedProfile.reason, 'inventory_conflict');
  assert.equal(committedProfile.transaction, 42);
  assert.equal(committedProfile.profile.equipment[0], null, 'survival clients must not mint equipped items');
  first.socket.send(JSON.stringify(state));
  second.socket.send(JSON.stringify(state));
  const survivalSnapshot = await waitForMessage(second.socket, 'snapshot');
  assert.equal(survivalSnapshot.players.find(player => player.id === first.welcome.id).mode, 'survival');
  const visiblePlayer = survivalSnapshot.players.find(player => player.id === first.welcome.id);
  assert.equal(visiblePlayer.skin, 'alex');
  assert.equal(visiblePlayer.modelType, 'slim');
  assert.equal(visiblePlayer.equipment[0], null);

  await delay(400);
  const deniedPromise = waitForMessage(first.socket, 'chat');
  first.socket.send(JSON.stringify({ t: 'chat', text: '/gamemode creative' }));
  assert.match((await deniedPromise).text, /没有权限/);

  await delay(400);
  const authPromise = waitForMessage(first.socket, 'profile');
  first.socket.send(JSON.stringify({ t: 'chat', text: '/auth test-secret' }));
  const authenticated = await authPromise;
  assert.equal(authenticated.role, 'admin');

  await delay(400);
  const modePromise = waitForMessage(first.socket, 'profile');
  first.socket.send(JSON.stringify({ t: 'chat', text: '/gamemode creative' }));
  assert.equal((await modePromise).profile.mode, 'creative');

  const wallPlaced = waitForMessageWhere(second.socket, 'blocks', message =>
    message.edits.some(edit => edit.x === 1 && edit.y === 80 && edit.z === 0 && edit.id === 1));
  first.socket.send(JSON.stringify({
    t: 'blocks', edits: [
      { x: 1, y: 80, z: 0, id: 1, state: null },
      { x: 1, y: 81, z: 0, id: 1, state: null },
    ],
  }));
  await wallPlaced;
  const collisionCorrection = waitForMessageWhere(second.socket, 'position', message => message.reason === 'movement_collision');
  second.socket.send(JSON.stringify(Object.assign({}, state, { x: 1.5, y: 80, z: 0.5 })));
  assert.ok((await collisionCorrection).x < 1, 'survival movement must not pass through a solid wall');
  const wallRemoved = waitForMessageWhere(second.socket, 'blocks', message =>
    message.edits.some(edit => edit.x === 1 && edit.y === 80 && edit.z === 0 && edit.id === 0));
  first.socket.send(JSON.stringify({
    t: 'blocks', edits: [
      { x: 1, y: 80, z: 0, id: 0, state: null },
      { x: 1, y: 81, z: 0, id: 0, state: null },
    ],
  }));
  await wallRemoved;
  second.socket.send(JSON.stringify(Object.assign({}, state, { y: 81 })));
  await delay(100);
  const flightCorrection = waitForMessageWhere(second.socket, 'position', message => message.reason === 'movement_collision');
  second.socket.send(JSON.stringify(Object.assign({}, state, { y: 82 })));
  assert.ok((await flightCorrection).y < 82, 'survival movement must not climb indefinitely without support');
  second.socket.send(JSON.stringify(state));

  const miner = await createGameClient(port, 'Miner');
  t.after(() => miner.sandbox.Network.disconnect(true));
  miner.player.onGround = false;
  miner.sandbox.Network.tick(miner.player, 0.1);
  await delay(80);
  const miningX = 3, miningY = 80, miningZ = 2;
  const miningBlockPlaced = waitForMessage(second.socket, 'blocks');
  first.socket.send(JSON.stringify({ t: 'blocks', edits: [{ x: miningX, y: miningY, z: miningZ, id: 3, state: null }] }));
  await miningBlockPlaced;
  await delay(80);

  const miningStarted = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('mining start acknowledgement timeout')), 2000);
    miner.sandbox.Network.onMining = message => {
      if (message.state !== 'started') return;
      clearTimeout(timeout); resolve(message);
    };
  });
  miner.sandbox.Network.startMining(miningX, miningY, miningZ, 3, 0.75, {
    hotbar: 0, toolId: 22, onGround: true, underwater: false,
  });
  const miningAck = await miningStarted;
  assert.ok(miningAck.required < 1, 'stale airborne state must not lock the attempt to five times the normal break duration');
  await delay(720);

  const minedOnce = waitForMessage(second.socket, 'blocks');
  const miningCompleted = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('mining completion timeout')), 2000);
    miner.sandbox.Network.onMining = message => {
      if (message.state !== 'completed') return;
      clearTimeout(timeout); resolve(message);
    };
  });
  miner.world.setBlock(miningX, miningY, miningZ, 0);
  miner.sandbox.Network.tick(miner.player, 0.1);
  const minedEdit = (await minedOnce).edits.find(edit => edit.x === miningX && edit.y === miningY && edit.z === miningZ);
  assert.equal(minedEdit && minedEdit.id, 0, 'one completed hold should break the block on the server');
  assert.equal((await miningCompleted).state, 'completed');
  miner.sandbox.Network.disconnect(true);
  await delay(80);

  const fluidBed = [];
  for (let x = 1; x <= 3; x++) for (let z = -1; z <= 1; z++) {
    fluidBed.push({ x, y: 79, z, id: 1, state: null });
    fluidBed.push({ x, y: 80, z, id: 0, state: null });
  }
  const fluidBedPromise = waitForMessage(second.socket, 'blocks');
  first.socket.send(JSON.stringify({ t: 'blocks', edits: fluidBed }));
  await fluidBedPromise;
  const sourcePromise = waitForMessage(second.socket, 'blocks');
  first.socket.send(JSON.stringify({ t: 'blocks', edits: [{ x: 2, y: 80, z: 0, id: 8, state: null }] }));
  await sourcePromise;
  let flowedWater = null;
  for (let attempt = 0; attempt < 8 && !flowedWater; attempt++) {
    const flowMessage = await waitForMessage(second.socket, 'blocks');
    flowedWater = flowMessage.edits.find(edit => edit.id === 8 && edit.state === 1 && (edit.x !== 2 || edit.z !== 0));
  }
  assert.ok(flowedWater, 'server should broadcast flowing water levels');

  await delay(400);
  const givePromise = waitForMessage(second.socket, 'profile');
  first.socket.send(JSON.stringify({ t: 'chat', text: '/give Bob 261 2' }));
  const given = await givePromise;
  assert.equal(given.profile.inv.filter(Boolean).find(stack => stack.id === 261).n, 2);

  const diamondSlot = given.profile.inv.findIndex(stack => stack && stack.id === 261);
  const heldActionPromise = waitForMessage(first.socket, 'player_action');
  second.socket.send(JSON.stringify({ t: 'action', action: 'held_slot', hotbar: diamondSlot }));
  const heldAction = await heldActionPromise;
  assert.equal(heldAction.player.held, 261, 'hotbar changes should immediately expose the held item to other players');

  const dropProfilePromise = waitForMessage(second.socket, 'profile');
  const dropActionPromise = waitForMessage(first.socket, 'player_action');
  second.socket.send(JSON.stringify({
    t: 'action', action: 'drop', all: false, hotbar: diamondSlot, expectedId: 261,
    inventoryRevision: given.profile.inventoryRevision,
  }));
  const droppedProfile = await dropProfilePromise;
  assert.equal(droppedProfile.reason, 'drop');
  assert.equal(droppedProfile.profile.inv[diamondSlot].n, 1);
  assert.equal((await dropActionPromise).player.held, 261);
  let discardedSnapshot;
  for (let attempt = 0; attempt < 5; attempt++) {
    discardedSnapshot = await waitForMessage(first.socket, 'snapshot');
    if (discardedSnapshot.entities.some(entity => entity.type === 'item' && entity.itemId === 261)) break;
  }
  assert.ok(discardedSnapshot.entities.some(entity => entity.type === 'item' && entity.itemId === 261));

  const staleProfilePromise = waitForMessage(second.socket, 'profile');
  second.socket.send(JSON.stringify({ t: 'profile', profile: given.profile }));
  const staleRejected = await staleProfilePromise;
  assert.equal(staleRejected.reason, 'inventory_conflict');
  assert.equal(staleRejected.profile.inv[diamondSlot].n, 1, 'a stale periodic profile must not restore a discarded item');

  const dropAllProfilePromise = waitForMessage(second.socket, 'profile');
  const emptyHandPromise = waitForMessage(first.socket, 'player_action');
  second.socket.send(JSON.stringify({
    t: 'action', action: 'drop', all: true, hotbar: diamondSlot, expectedId: 261,
    inventoryRevision: droppedProfile.profile.inventoryRevision,
  }));
  const droppedAll = await dropAllProfilePromise;
  assert.equal(droppedAll.profile.inv[diamondSlot], null);
  assert.equal((await emptyHandPromise).player.held, 0, 'dropping the stack should immediately clear the remote hand');

  await delay(400);
  const dragGivePromise = waitForMessage(second.socket, 'profile');
  first.socket.send(JSON.stringify({ t: 'chat', text: '/give Bob 260 3' }));
  const dragGiven = await dragGivePromise;
  const goldSlot = dragGiven.profile.inv.findIndex(stack => stack && stack.id === 260);
  const dragDropPromise = waitForMessage(second.socket, 'profile');
  second.socket.send(JSON.stringify({
    t: 'action', action: 'drop_slot', source: 'inv', index: goldSlot, count: 1, expectedId: 260,
    inventoryRevision: dragGiven.profile.inventoryRevision,
  }));
  const dragDropped = await dragDropPromise;
  assert.equal(dragDropped.reason, 'drop');
  assert.equal(dragDropped.profile.inv[goldSlot].n, 2, 'right-dragging outside should discard exactly one item');

  const duplicateDragPromise = waitForMessage(second.socket, 'profile');
  second.socket.send(JSON.stringify({
    t: 'action', action: 'drop_slot', source: 'inv', index: goldSlot, count: 1, expectedId: 260,
    inventoryRevision: dragGiven.profile.inventoryRevision,
  }));
  const duplicateDrag = await duplicateDragPromise;
  assert.equal(duplicateDrag.reason, 'inventory_conflict');
  assert.equal(duplicateDrag.profile.inv[goldSlot].n, 2, 'a repeated stale drag must not discard or duplicate another item');

  const dragDropAllPromise = waitForMessage(second.socket, 'profile');
  second.socket.send(JSON.stringify({
    t: 'action', action: 'drop_slot', source: 'inv', index: goldSlot, count: 2, expectedId: 260,
    inventoryRevision: dragDropped.profile.inventoryRevision,
  }));
  const dragDroppedAll = await dragDropAllPromise;
  assert.equal(dragDroppedAll.profile.inv[goldSlot], null, 'left-dragging outside should discard the complete stack');

  await delay(400);
  const eggGivePromise = waitForMessage(second.socket, 'profile');
  first.socket.send(JSON.stringify({ t: 'chat', text: '/give Bob 278 2' }));
  const eggGiven = await eggGivePromise;
  const eggSlot = eggGiven.profile.inv.findIndex(stack => stack && stack.id === 278);
  assert.ok(eggSlot >= 0 && eggSlot < 9);
  second.socket.send(JSON.stringify({ t: 'action', action: 'held_slot', hotbar: eggSlot }));
  const eggProfilePromise = waitForMessage(second.socket, 'profile');
  second.socket.send(JSON.stringify({
    t: 'action', action: 'throw_egg', direction: [1, 0, 0],
    inventoryRevision: eggGiven.profile.inventoryRevision,
  }));
  const eggThrown = await eggProfilePromise;
  assert.equal(eggThrown.reason, 'egg');
  assert.equal(eggThrown.profile.inv[eggSlot].n, 1);
  let eggSnapshot;
  for (let attempt = 0; attempt < 5; attempt++) {
    eggSnapshot = await waitForMessage(first.socket, 'snapshot');
    if (eggSnapshot.entities.some(entity => entity.type === 'egg' && entity.itemId === 278)) break;
  }
  assert.ok(eggSnapshot.entities.some(entity => entity.type === 'egg' && entity.itemId === 278));

  const hungry = Object.assign({}, eggThrown.profile, { hunger: 15, saturation: 2 });
  const hungerCommitPromise = waitForMessage(second.socket, 'profile');
  second.socket.send(JSON.stringify({ t: 'profile', profile: hungry, transaction: 99 }));
  const hungerCommit = await hungerCommitPromise;
  assert.equal(hungerCommit.profile.hunger, 15);
  const appleSlot = hungerCommit.profile.inv.findIndex(stack => stack && stack.id === 262);
  second.socket.send(JSON.stringify({ t: 'action', action: 'held_slot', hotbar: appleSlot }));
  const eatProfilePromise = waitForMessage(second.socket, 'profile');
  second.socket.send(JSON.stringify({
    t: 'action', action: 'eat', itemId: 262,
    inventoryRevision: hungerCommit.profile.inventoryRevision,
  }));
  const ate = await eatProfilePromise;
  assert.equal(ate.reason, 'eat');
  assert.equal(ate.profile.hunger, 19);
  assert.equal(ate.profile.inv[appleSlot].n, 2, 'server-authoritative eating should consume exactly one item');

  await delay(400);
  const plankPromise = waitForMessage(second.socket, 'profile');
  first.socket.send(JSON.stringify({ t: 'chat', text: '/give Bob 5 12' }));
  const planks = await plankPromise;
  assert.equal(planks.profile.inv.filter(Boolean).find(stack => stack.id === 5).n, 12);
  const craftPromise = waitForMessage(second.socket, 'profile');
  second.socket.send(JSON.stringify({
    t: 'action', action: 'craft', shift: false, transaction: 701,
    inventoryRevision: planks.profile.inventoryRevision,
    grid: [{ id: 5, n: 3 }, { id: 5, n: 3 }, { id: 5, n: 3 }, { id: 5, n: 3 }],
  }));
  const crafted = await craftPromise;
  assert.equal(crafted.reason, 'craft');
  assert.equal(crafted.transaction, 701);
  assert.equal(crafted.profile.cursor.id, 22);
  assert.equal(crafted.profile.inv.find(stack => stack && stack.id === 5).n, 8,
    'one output claim must consume exactly one recipe from stacked crafting slots');

  const secondCraftPromise = waitForMessage(second.socket, 'profile');
  second.socket.send(JSON.stringify({
    t: 'action', action: 'craft', shift: false, transaction: 702,
    inventoryRevision: crafted.profile.inventoryRevision,
    grid: [{ id: 5, n: 2 }, { id: 5, n: 2 }, { id: 5, n: 2 }, { id: 5, n: 2 }],
  }));
  const craftedAgain = await secondCraftPromise;
  assert.equal(craftedAgain.reason, 'craft');
  assert.equal(craftedAgain.transaction, 702);
  assert.equal(craftedAgain.profile.cursor.n, 2);
  assert.equal(craftedAgain.profile.inv.find(stack => stack && stack.id === 5).n, 4);

  const staleCraftPromise = waitForMessage(second.socket, 'profile');
  second.socket.send(JSON.stringify({
    t: 'action', action: 'craft', shift: false, transaction: 703,
    inventoryRevision: crafted.profile.inventoryRevision,
    grid: [{ id: 5, n: 1 }, { id: 5, n: 1 }, { id: 5, n: 1 }, { id: 5, n: 1 }],
  }));
  const staleCraft = await staleCraftPromise;
  assert.equal(staleCraft.reason, 'craft_conflict');
  assert.equal(staleCraft.transaction, 703);
  assert.equal(staleCraft.profile.cursor.n, 2);

  await delay(400);
  const pearlProfilePromise = waitForMessage(second.socket, 'profile');
  first.socket.send(JSON.stringify({ t: 'chat', text: '/give Bob 324 1' }));
  const pearlProfile = await pearlProfilePromise;
  const pearlSlot = pearlProfile.profile.inv.findIndex(stack => stack && stack.id === 324);
  assert.ok(pearlSlot >= 0 && pearlSlot < 9);
  const pearlWallPromise = waitForMessageWhere(second.socket, 'blocks', message =>
    message.edits.some(edit => edit.x === 3 && edit.y === 81 && edit.z === 0 && edit.id === 1));
  first.socket.send(JSON.stringify({ t: 'blocks', edits: [{ x: 3, y: 81, z: 0, id: 1, state: null }] }));
  await pearlWallPromise;
  second.socket.send(JSON.stringify(Object.assign({}, state, { hotbar: pearlSlot })));
  const pearlConsumedPromise = waitForMessageWhere(second.socket, 'profile', message => message.reason === 'ender_pearl');
  const pearlPositionPromise = waitForMessageWhere(second.socket, 'position', message => message.reason === 'ender_pearl', 5000);
  const pearlDamagePromise = waitForMessageWhere(second.socket, 'combat', message => message.cause === 'ender_pearl', 5000);
  second.socket.send(JSON.stringify({
    t: 'action', action: 'throw_ender_pearl', direction: [1, 0, 0],
    inventoryRevision: pearlProfile.profile.inventoryRevision,
  }));
  const pearlConsumed = await pearlConsumedPromise;
  assert.equal(pearlConsumed.profile.inv.some(stack => stack && stack.id === 324), false);
  const pearlPosition = await pearlPositionPromise;
  assert.ok(pearlPosition.x > 2 && pearlPosition.x < 3, 'server should teleport the thrower to the safe side of the wall');
  const pearlDamage = await pearlDamagePromise;
  assert.equal(pearlDamage.damage, 5);

  await delay(400);
  const permissionPromise = waitForMessage(second.socket, 'profile');
  first.socket.send(JSON.stringify({ t: 'chat', text: '/perm Bob moderator' }));
  const moderatorProfile = await permissionPromise;
  assert.equal(moderatorProfile.role, 'moderator');

  const chestPlacementPromise = waitForMessage(second.socket, 'blocks');
  first.socket.send(JSON.stringify({ t: 'blocks', edits: [{ x: 1, y: 80, z: 2, id: 25, state: null }] }));
  await chestPlacementPromise;
  const openContainerPromise = waitForMessage(first.socket, 'container');
  first.socket.send(JSON.stringify({ t: 'container', action: 'open', type: 'chest', x: 1, y: 80, z: 2 }));
  const openedContainer = await openContainerPromise;
  assert.equal(openedContainer.revision, 0);
  const forgedContainerProfilePromise = waitForMessageWhere(second.socket, 'profile', message => message.reason === 'container_conflict');
  const forgedContainerPromise = waitForMessageWhere(second.socket, 'container', message => message.conflict === true);
  const forgedSlots = Array(27).fill(null);
  forgedSlots[0] = { id: 261, n: 1 };
  second.socket.send(JSON.stringify({
    t: 'container', action: 'update', type: 'chest', x: 1, y: 80, z: 2,
    slots: forgedSlots, revision: 0,
    inventoryRevision: moderatorProfile.profile.inventoryRevision,
    profile: moderatorProfile.profile,
  }));
  assert.equal((await forgedContainerProfilePromise).reason, 'container_conflict');
  assert.equal((await forgedContainerPromise).revision, 0,
    'container updates must conserve the combined player and container inventory');
  const sharedContainerPromise = waitForMessage(second.socket, 'container');
  const chestSlots = Array(27).fill(null);
  chestSlots[0] = { id: 261, n: 1 };
  first.socket.send(JSON.stringify({
    t: 'container', action: 'update', type: 'chest', x: 1, y: 80, z: 2,
    slots: chestSlots, revision: openedContainer.revision,
  }));
  const sharedContainer = await sharedContainerPromise;
  assert.equal(sharedContainer.slots[0].id, 261);
  const conflictProfilePromise = waitForMessage(second.socket, 'profile');
  const conflictContainerPromise = waitForMessage(second.socket, 'container');
  second.socket.send(JSON.stringify({
    t: 'container', action: 'update', type: 'chest', x: 1, y: 80, z: 2,
    slots: Array(27).fill(null), revision: 0,
  }));
  assert.equal((await conflictProfilePromise).reason, 'container_conflict');
  assert.equal((await conflictContainerPromise).conflict, true);

  const furnaceX = 2, furnaceY = 80, furnaceZ = 2;
  const furnacePlacementPromise = waitForMessageWhere(second.socket, 'blocks', message =>
    message.edits.some(edit => edit.x === furnaceX && edit.y === furnaceY && edit.z === furnaceZ && edit.id === 23));
  first.socket.send(JSON.stringify({ t: 'blocks', edits: [{ x: furnaceX, y: furnaceY, z: furnaceZ, id: 23, state: null }] }));
  await furnacePlacementPromise;
  const furnaceOpenPromise = waitForMessageWhere(first.socket, 'container', message =>
    message.x === furnaceX && message.y === furnaceY && message.z === furnaceZ);
  first.socket.send(JSON.stringify({ t: 'container', action: 'open', type: 'furnace', x: furnaceX, y: furnaceY, z: furnaceZ }));
  const furnaceOpen = await furnaceOpenPromise;
  assert.equal(furnaceOpen.revision, 0);

  const furnaceStartedPromise = waitForMessageWhere(second.socket, 'container', message =>
    message.x === furnaceX && message.revision >= 2 && message.burn > 0, 5000);
  first.socket.send(JSON.stringify({
    t: 'container', action: 'update', type: 'furnace', x: furnaceX, y: furnaceY, z: furnaceZ,
    slots: [{ id: 13, n: 2 }, { id: 257, n: 1 }, null], revision: furnaceOpen.revision,
    burn: 9999, burnMax: 9999, cook: 9.9,
  }));
  const furnaceStarted = await furnaceStartedPromise;
  assert.equal(furnaceStarted.revision, 2, 'starting fuel may change slots once');
  assert.ok(furnaceStarted.burn < 9999, 'server must own furnace progress values');

  const furnaceProgress = await waitForMessageWhere(second.socket, 'container', message =>
    message.x === furnaceX && message.revision === furnaceStarted.revision && message.burn < furnaceStarted.burn, 5000);
  assert.ok(furnaceProgress.cook > furnaceStarted.cook);

  const furnaceEditPromise = waitForMessageWhere(first.socket, 'container', message =>
    message.x === furnaceX && message.revision === furnaceStarted.revision + 1, 5000);
  first.socket.send(JSON.stringify({
    t: 'container', action: 'update', type: 'furnace', x: furnaceX, y: furnaceY, z: furnaceZ,
    slots: [{ id: 13, n: 1 }, null, null], revision: furnaceProgress.revision,
  }));
  const furnaceEdited = await furnaceEditPromise;
  assert.equal(furnaceEdited.conflict, undefined,
    'burn-time updates must not make a valid slot edit look like another-player interference');
  assert.equal(furnaceEdited.slots[0].n, 1);

  const signBlockPromise = waitForMessage(second.socket, 'blocks');
  first.socket.send(JSON.stringify({ t: 'blocks', edits: [{ x: 2, y: 80, z: 3, id: 69, state: 2 }] }));
  await signBlockPromise;
  const sharedSignPromise = waitForMessage(second.socket, 'sign');
  first.socket.send(JSON.stringify({
    t: 'sign', x: 2, y: 80, z: 3,
    lines: ['服务器告示牌', '中文同步正常', '12345678901234567890', '第四行', '多余行'],
  }));
  const sharedSign = await sharedSignPromise;
  assert.deepEqual(sharedSign.lines, ['服务器告示牌', '中文同步正常', '123456789012345', '第四行']);

  const rejectedPlacementPromise = waitForMessageWhere(second.socket, 'blocks', message =>
    message.rejected && message.edits.some(edit => edit.x === 4 && edit.y === 80 && edit.z === 0));
  second.socket.send(JSON.stringify({ t: 'blocks', edits: [{ x: 4, y: 80, z: 0, id: 3, state: null }] }));
  assert.equal((await rejectedPlacementPromise).rejected, true,
    'survival block edits without an inventory revision must be rejected');

  await delay(400);
  const swordPromise = waitForMessage(second.socket, 'profile');
  first.socket.send(JSON.stringify({ t: 'chat', text: '/give Bob 297 1' }));
  const swordProfile = await swordPromise;
  const swordSlot = swordProfile.profile.inv.findIndex(stack => stack && stack.id === 297);
  assert.ok(swordSlot >= 0 && swordSlot < 9);
  second.socket.send(JSON.stringify(Object.assign({}, state, { hotbar: swordSlot, blocking: false })));
  second.socket.send(JSON.stringify({ t: 'action', action: 'block_state', active: true, hotbar: swordSlot }));
  await delay(80);
  const combatPromise = waitForMessage(second.socket, 'combat');
  const damagedProfilePromise = waitForMessageWhere(second.socket, 'profile', message => message.reason === 'damage');
  first.socket.send(JSON.stringify({ t: 'action', action: 'attack', targetType: 'player', target: second.welcome.id }));
  const combat = await combatPromise;
  assert.equal(combat.blocked, true);
  assert.equal(combat.damage, 5);
  assert.ok(Math.hypot(combat.knockback.x, combat.knockback.z) < 3.3);
  const damagedProfile = await damagedProfilePromise;
  const forgedStatsPromise = waitForMessageWhere(second.socket, 'profile', message => message.transaction === 904);
  second.socket.send(JSON.stringify({
    t: 'profile', transaction: 904,
    profile: Object.assign({}, damagedProfile.profile, {
      hp: 20, xpLevel: 999, xpProgress: 1,
      spawn: { x: 999, y: 200, z: 999 },
    }),
  }));
  const forgedStats = await forgedStatsPromise;
  assert.equal(forgedStats.profile.hp, damagedProfile.profile.hp, 'profile packets must not heal the player');
  assert.equal(forgedStats.profile.xpLevel, damagedProfile.profile.xpLevel, 'profile packets must not grant experience');
  assert.deepEqual(forgedStats.profile.spawn, damagedProfile.profile.spawn, 'profile packets must not replace the server spawn');

  second.socket.send(JSON.stringify({ t: 'action', action: 'block_state', active: false, hotbar: swordSlot }));
  const respawnAreaPromise = waitForMessageWhere(second.socket, 'blocks', message =>
    message.edits.some(edit => edit.x === 0 && edit.y === 77 && edit.z === 0 && edit.id === 1));
  first.socket.send(JSON.stringify({
    t: 'blocks', edits: [
      { x: 0, y: 77, z: 0, id: 1, state: null },
      { x: 0, y: 78, z: 0, id: 0, state: null },
      { x: 0, y: 79, z: 0, id: 0, state: null },
      { x: 0, y: 80, z: 0, id: 0, state: null },
      { x: 0, y: 81, z: 0, id: 0, state: null },
    ],
  }));
  await respawnAreaPromise;
  const respawnPoint = second.welcome.profile.spawn;
  second.socket.send(JSON.stringify(Object.assign({}, state, {
    x:respawnPoint.x, y:respawnPoint.y, z:respawnPoint.z, onGround:false,
  })));
  await delay(1450);

  const unblockedPromise = waitForMessage(second.socket, 'combat');
  const deathProfilePromise = waitForMessageWhere(second.socket, 'profile', message => message.reason === 'death');
  first.socket.send(JSON.stringify({ t: 'action', action: 'attack', targetType: 'player', target: second.welcome.id }));
  const unblocked = await unblockedPromise;
  assert.equal(unblocked.blocked, false);
  assert.equal(unblocked.damage, 10);
  assert.equal((await deathProfilePromise).profile.dead, true);
  const respawnProfilePromise = waitForMessageWhere(second.socket, 'profile', message => message.reason === 'respawn');
  const respawnPositionPromise = waitForMessageWhere(second.socket, 'position', message => message.reason === 'respawn');
  second.socket.send(JSON.stringify({ t:'action', action:'respawn' }));
  const [respawnProfile, respawnPosition] = await Promise.all([respawnProfilePromise, respawnPositionPromise]);
  assert.equal(respawnProfile.profile.dead, false);
  assert.deepEqual([respawnPosition.x, respawnPosition.z], [respawnPoint.x, respawnPoint.z]);
  assert.equal(respawnPosition.y, 78, 'respawn should settle on the nearest supported surface');

  second.socket.send(JSON.stringify(Object.assign({}, state, {
    x:respawnPoint.x + 2, y:respawnPoint.y, z:respawnPoint.z, onGround:false,
  })));
  await delay(350);
  const stableRespawn = await waitForMessageWhere(first.socket, 'snapshot', message => {
    const remote = message.players.find(entry => entry.id === second.welcome.id);
    return remote && Math.abs(remote.x - respawnPosition.x) < 0.03 &&
      Math.abs(remote.y - respawnPosition.y) < 0.03;
  }, 3000, 'stable respawn snapshot');
  assert.ok(stableRespawn, 'a stale pre-respawn state packet must not overwrite the server spawn');

  const movedX = respawnPosition.x + 0.2;
  const movedSnapshotPromise = waitForMessageWhere(first.socket, 'snapshot', message => {
    const remote = message.players.find(entry => entry.id === second.welcome.id);
    return remote && Math.abs(remote.x - movedX) < 0.03 && Math.abs(remote.y - respawnPosition.y) < 0.03;
  }, 3000, 'post-respawn movement snapshot');
  second.socket.send(JSON.stringify(Object.assign({}, state, {
    x:movedX, y:respawnPosition.y, z:respawnPosition.z, onGround:true,
  })));
  await movedSnapshotPromise;

  const airborneY = respawnPosition.y + 1;
  const airborneSnapshotPromise = waitForMessageWhere(first.socket, 'snapshot', message => {
    const remote = message.players.find(entry => entry.id === second.welcome.id);
    return remote && Math.abs(remote.x - movedX) < 0.03 && Math.abs(remote.y - airborneY) < 0.03;
  }, 3000, 'pre-knockback airborne snapshot');
  second.socket.send(JSON.stringify(Object.assign({}, state, {
    x:movedX, y:airborneY, z:respawnPosition.z, onGround:false,
  })));
  await airborneSnapshotPromise;
  await delay(1450);

  const knockbackCombatPromise = waitForMessage(second.socket, 'combat');
  const knockbackProfilePromise = waitForMessageWhere(second.socket, 'profile', message => message.reason === 'damage');
  first.socket.send(JSON.stringify({ t: 'action', action: 'attack', targetType: 'player', target: second.welcome.id }));
  const knockbackCombat = await knockbackCombatPromise;
  assert.ok(knockbackCombat.knockback && knockbackCombat.knockback.y > 0);
  assert.equal((await knockbackProfilePromise).profile.dead, false);

  const knockedX = movedX;
  const knockedY = airborneY + 0.15;
  const knockbackSnapshotPromise = waitForMessageWhere(first.socket, 'snapshot', message => {
    const remote = message.players.find(entry => entry.id === second.welcome.id);
    return remote && Math.abs(remote.x - knockedX) < 0.03 && Math.abs(remote.y - knockedY) < 0.03;
  }, 3000, 'post-hit knockback snapshot');
  second.socket.send(JSON.stringify(Object.assign({}, state, {
    x:knockedX, y:knockedY, z:respawnPosition.z, onGround:false,
  })));
  await knockbackSnapshotPromise;

  first.socket.send(JSON.stringify({
    t: 'action', action: 'spawn_item', x: 5.5, y: 80, z: 0.5,
    stack: { id: 352, n: 1 }, vx: 0, vy: 0, vz: 0,
  }));
  const entitySnapshot = await waitForMessage(second.socket, 'snapshot');
  assert.equal(entitySnapshot.entities.some(entity => entity.type === 'item' && entity.itemId === 352), false,
    'spawn_item packets must not mint arbitrary drops');

  await delay(400);
  const chatPromise = waitForMessage(second.socket, 'chat');
  first.socket.send(JSON.stringify({ t: 'chat', text: '联机聊天测试' }));
  const chat = await chatPromise;
  assert.equal(chat.kind, 'player');
  assert.equal(chat.text, '联机聊天测试');

  const blockPromise = waitForMessageWhere(second.socket, 'blocks', message =>
    message.edits.some(edit => edit.x === 1 && edit.y === 80 && edit.z === 1 && edit.id === 5));
  first.socket.send(JSON.stringify({ t: 'blocks', edits: [{ x: 1, y: 80, z: 1, id: 5, state: null }] }));
  const blockMessage = await blockPromise;
  assert.ok(blockMessage.edits.some(edit => edit.x === 1 && edit.y === 80 && edit.z === 1 && edit.id === 5));

  await delay(400);
  const bannedPromise = waitForMessage(second.socket, 'error');
  first.socket.send(JSON.stringify({ t: 'chat', text: '/ban Bob integration-test' }));
  assert.equal((await bannedPromise).code, 'banned');
  const bannedSocket = new WebSocket('ws://127.0.0.1:' + port + '/ws');
  await new Promise((resolve, reject) => { bannedSocket.once('open', resolve); bannedSocket.once('error', reject); });
  const reconnectDeniedPromise = waitForMessage(bannedSocket, 'error');
  bannedSocket.send(JSON.stringify({ t: 'hello', protocol: 3, name: 'Bob', token: second.token }));
  assert.equal((await reconnectDeniedPromise).code, 'banned');
  bannedSocket.close();
  const firstClosed = new Promise(resolve => first.socket.once('close', resolve));
  first.socket.close();
  await firstClosed;

  const reconnected = await connectPlayer(port, '玩家', first.token);
  assert.equal(reconnected.welcome.role, 'admin');
  assert.equal(reconnected.welcome.profile.mode, 'creative');
  assert.ok(reconnected.welcome.signs.some(sign => sign.x === 2 && sign.y === 80 && sign.z === 3 && sign.lines[0] === '服务器告示牌'));
  reconnected.socket.close();

  const gameA = await createGameClient(port, 'GameA', 60000, first.token);
  const gameB = await createGameClient(port, 'GameB');
  assert.equal(gameA.sandbox.Network.status().role, 'admin');
  assert.equal(gameA.sandbox.Network.getPlayerName(), 'GameA');
  assert.equal(gameB.sandbox.Network.setPlayerName('  玩家 B!  '), '玩家 B');
  gameB.sandbox.Network.setPlayerName('GameB');
  gameA.sandbox.Network.tick(gameA.player, 0.1);
  gameB.sandbox.Network.tick(gameB.player, 0.1);
  assert.equal(gameA.world.setBlock(2, 80, 2, 5), true);
  gameA.sandbox.Network.tick(gameA.player, 0.1);
  await waitUntil(() => gameB.world.getBlock(2, 80, 2) === 5);
  assert.equal(gameA.world.setBlock(3, 80, 2, 54), true);
  gameA.sandbox.Network.tick(gameA.player, 0.1);
  await waitUntil(() => gameB.world.getBlock(3, 80, 2) === 54);
  await waitUntil(() => gameA.sandbox.Network.remotePlayers().length === 1 && gameB.sandbox.Network.remotePlayers().length === 1);
  assert.ok(gameA.sandbox.Network.status().latency < 100, 'latency must use RTT instead of client/server clock difference');
  gameA.sandbox.Network.tick(gameA.player, 2.1);
  await delay(100);
  assert.ok(gameA.sandbox.Network.status().latency < 100, 'application ping should report local RTT');
  assert.equal(gameA.sandbox.Network.remotePlayers()[0].name, 'GameB');
  assert.equal(gameB.sandbox.Network.remotePlayers()[0].name, 'GameA');
  gameA.sandbox.Network.disconnect(true);
  gameB.sandbox.Network.disconnect(true);

  await new Promise((resolve) => setTimeout(resolve, 900));
  const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'world.json'), 'utf8'));
  assert.equal(saved.seed, first.welcome.seed);
  assert.ok(saved.edits.some((edit) => edit.x === 1 && edit.y === 80 && edit.z === 1 && edit.id === 5));
  assert.ok(saved.edits.some((edit) => edit.x === 2 && edit.y === 80 && edit.z === 2 && edit.id === 5));
  assert.ok(saved.edits.some((edit) => edit.x === 3 && edit.y === 80 && edit.z === 2 && edit.id === 54));
  assert.ok(saved.profiles.some((profile) => profile.role === 'admin'));
  assert.ok(saved.bans.names.includes('bob'));
  assert.ok(Array.isArray(saved.spawnedVillages));
  assert.ok(saved.containers.some((container) => container.type === 'chest' && container.slots[0] && container.slots[0].id === 261));
  assert.ok(saved.signs.some((sign) => sign.x === 2 && sign.y === 80 && sign.z === 3 && sign.lines[1] === '中文同步正常'));
  assert.equal(fsSync.existsSync(path.join(dataDir, 'world.backup.json')), true);
});
