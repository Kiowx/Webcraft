'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class AudioParam {
  constructor(value) { this.value = value || 0; }
  setTargetAtTime(value) { this.value = value; }
}

class AudioNode {
  constructor() { this.connections = []; }
  connect(target) { this.connections.push(target); return target; }
  disconnect() { this.connections.length = 0; }
}

class GainNode extends AudioNode {
  constructor() { super(); this.gain = new AudioParam(1); }
}

class BufferSourceNode extends AudioNode {
  constructor(context) {
    super();
    this.context = context;
    this.playbackRate = new AudioParam(1);
    this.loop = false;
    this.onended = null;
  }
  start() { this.started = true; this.context.started.push(this); }
  stop() { this.stopped = true; if (this.onended) this.onended(); }
}

class FakeAudioBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(channel) { return this.channels[channel]; }
}

class ConvolverNode extends AudioNode {
  constructor(context) { super(); this.context = context; this._buffer = null; }
  set buffer(value) {
    if (value && value.sampleRate !== this.context.sampleRate) throw new Error('convolver sample-rate mismatch');
    this._buffer = value;
  }
  get buffer() { return this._buffer; }
}

class FakeAudioContext {
  constructor() {
    FakeAudioContext.instance = this;
    this.currentTime = 1;
    this.sampleRate = 48000;
    this.state = 'running';
    this.resumeCalls = 0;
    this.decodeCalls = 0;
    this.destination = new AudioNode();
    this.started = [];
    this.panners = [];
    this.listener = {
      positionX: new AudioParam(), positionY: new AudioParam(), positionZ: new AudioParam(),
      forwardX: new AudioParam(), forwardY: new AudioParam(), forwardZ: new AudioParam(),
      upX: new AudioParam(), upY: new AudioParam(), upZ: new AudioParam(),
    };
  }
  createDynamicsCompressor() {
    const node = new AudioNode();
    for (const name of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[name] = new AudioParam();
    return node;
  }
  createGain() { return new GainNode(); }
  createBiquadFilter() {
    const node = new AudioNode();
    node.frequency = new AudioParam(); node.Q = new AudioParam();
    return node;
  }
  createConvolver() { return new ConvolverNode(this); }
  createBuffer(channels, length, sampleRate) { return new FakeAudioBuffer(channels, length, sampleRate); }
  createBufferSource() { return new BufferSourceNode(this); }
  createPanner() {
    const node = new AudioNode();
    node.positionX = new AudioParam(); node.positionY = new AudioParam(); node.positionZ = new AudioParam();
    this.panners.push(node);
    return node;
  }
  decodeAudioData() { this.decodeCalls++; return Promise.resolve(new FakeAudioBuffer(1, 32, this.sampleRate)); }
  resume() { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); }
}

function loadSound(fetchImpl) {
  const window = { AudioContext: FakeAudioContext };
  const sandbox = {
    window, console, setTimeout() {}, clearTimeout() {}, fetch: fetchImpl || fetch,
    Array, ArrayBuffer, Date, Float32Array, JSON, Map, Math, Number, Object,
    Promise, RegExp, Set, String, URL,
  };
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'audio.js'), 'utf8');
  vm.runInContext(source, sandbox, { filename: 'audio.js' });
  return { Sound: window.Sound, context: () => FakeAudioContext.instance };
}

test('menu sound events are fixed, dry, preloaded, and slider-throttled', () => {
  const { Sound, context } = loadSound();
  Sound.unlock();

  const slot = Sound.describe('ui.slot');
  assert.deepEqual(
    { category: slot.category, variants: slot.variants, pitchMin: slot.pitchMin, pitchMax: slot.pitchMax, route: slot.route },
    { category: 'ui', variants: 1, pitchMin: 1, pitchMax: 1, route: 'dry' },
  );

  const chest = Sound.describe('container.chest.open');
  assert.deepEqual(
    { category: chest.category, variants: chest.variants, pitchMin: chest.pitchMin, pitchMax: chest.pitchMax, route: chest.route },
    { category: 'blocks', variants: 1, pitchMin: 1, pitchMax: 1, route: 'world' },
  );

  const button = Sound.describe('ui.button.click');
  assert.deepEqual(
    { category: button.category, variants: button.variants, pitchMin: button.pitchMin, pitchMax: button.pitchMax, route: button.route },
    { category: 'ui', variants: 1, pitchMin: 1, pitchMax: 1, route: 'dry' },
  );
  assert.ok(Sound.status().builtinSamples >= 6, 'unlock should pre-generate menu samples');

  const audio = context();
  const first = Sound.emit('ui.button.click', { x: 10, y: 20, z: 30, pitch: 2 });
  assert.ok(first && first.source.started);
  assert.equal(first.source.playbackRate.value, 1, 'button click must use fixed pitch');
  assert.equal(audio.panners.length, 0, 'UI sounds must ignore world coordinates and remain centered');

  audio.currentTime = 2;
  assert.ok(Sound.emit('ui.slider.tick'));
  audio.currentTime = 2.04;
  assert.equal(Sound.emit('ui.slider.tick'), false, 'slider ticks should be throttled');
  audio.currentTime = 2.08;
  assert.ok(Sound.emit('ui.slider.tick'));

  audio.currentTime = 3;
  Sound.emit('block.stone.hit', { x: 3, y: 2, z: 1 });
  assert.equal(audio.panners.length, 1, 'world sounds should still use HRTF positioning');

  audio.state = 'suspended';
  assert.ok(Sound.emit('ui.slot'), 'a suspended context should still queue the requested sound');
  assert.equal(audio.resumeCalls, 1, 'emitting after suspension should resume WebAudio');
  assert.equal(audio.state, 'running');
});

test('resource packs can override semantic menu events', async () => {
  const { Sound } = loadSound();
  Sound.unlock();
  const result = await Sound.loadResourcePack({
    name: 'test-ui',
    events: { 'ui.button.click': ['button.ogg'] },
  }, {
    'button.ogg': new ArrayBuffer(8),
  });
  assert.equal(result.name, 'test-ui');
  assert.equal(result.events, 1);
  assert.equal(Sound.status().resourceEvents, 1);
});


test('music pack entries stay lazy and decode only the selected original track', async () => {
  const fetched = [];
  const fetchImpl = async url => {
    fetched.push(String(url));
    if (String(url).includes('manifest.json')) return { ok: false, status: 404 };
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) };
  };
  const { Sound, context } = loadSound(fetchImpl);
  Sound.unlock();
  await Promise.resolve();
  const result = await Sound.loadResourcePack({
    name: 'lazy-original-music',
    events: {
      'music.menu': ['menu1.ogg', 'menu2.ogg'],
      'music.overworld': ['calm1.ogg'],
    },
  });
  assert.equal(result.lazyEvents, 2);
  assert.equal(Sound.status().lazyResourceEvents, 2);
  assert.equal(context().decodeCalls, 0, 'loading a manifest must not eagerly decode long music');

  Sound.tick(20, { screen: 'menu', dimension: 'overworld', gameMode: 'survival' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context().decodeCalls, 1);
  assert.equal(fetched.filter(url => /menu[12]\.ogg$/.test(url)).length, 1);
  assert.equal(context().started.length, 1);
  assert.equal(Sound.status().musicLoading, false);
});


test('lazy original sound effects decode on first semantic emit and keep spatial routing', async () => {
  const fetched = [];
  const fetchImpl = async url => {
    fetched.push(String(url));
    if (String(url).includes('manifest.json')) return { ok: false, status: 404 };
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) };
  };
  const { Sound, context } = loadSound(fetchImpl);
  Sound.unlock();
  await Promise.resolve();
  const result = await Sound.loadResourcePack({
    name: 'lazy-original-sfx',
    events: {
      'block.stone.break': [{ file: 'dig/stone1.ogg', lazy: true }],
    },
  });
  assert.equal(result.lazyEvents, 1);
  assert.equal(context().decodeCalls, 0);
  const pending = Sound.emit('block.stone.break', { x: 1, y: 2, z: 3 });
  assert.equal(pending.pending, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context().decodeCalls, 1);
  assert.equal(context().started.length, 1);
  assert.equal(context().panners.length, 1);
  assert.equal(fetched.filter(url => url.endsWith('dig/stone1.ogg')).length, 1);
});

test('gameplay sound preparation decodes silently and reuses the ready variant', async () => {
  const fetched = [];
  const fetchImpl = async url => {
    fetched.push(String(url));
    if (String(url).includes('manifest.json')) return { ok: false, status: 404 };
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) };
  };
  const { Sound, context } = loadSound(fetchImpl);
  Sound.unlock();
  await Promise.resolve();
  await Sound.loadResourcePack({
    name: 'prepared-entity-sfx',
    events: {
      'entity.pig.ambient': [
        { file: 'mob/pig1.ogg', lazy: true },
        { file: 'mob/pig2.ogg', lazy: true },
      ],
    },
  });

  assert.equal(await Sound.prepare(['entity.pig.ambient']), 1);
  assert.equal(context().decodeCalls, 1);
  assert.equal(context().started.length, 0, 'preparation must not play the sound');
  const played = Sound.emit('entity.pig.ambient', { x: 2, y: 3, z: 4 });
  assert.ok(played && played.source.started);
  assert.equal(context().decodeCalls, 1, 'the prepared variant should avoid an approach-time decode');
  assert.equal(context().panners.length, 1);
  assert.equal(fetched.filter(url => url.endsWith('mob/pig1.ogg')).length, 1);
  assert.equal(fetched.filter(url => url.endsWith('mob/pig2.ogg')).length, 0);
});

test('cave ambience requires sustained exposure and uses a long cooldown', () => {
  const { Sound, context } = loadSound();
  Sound.unlock();
  Sound.setMusic(false);
  const audio = context();
  const before = audio.started.length;
  const cave = {
    screen: 'game', dimension: 'overworld', gameMode: 'survival',
    caveStrength: 1, underwater: false, outdoors: false, rainStrength: 0,
  };

  Sound.tick(44, cave);
  assert.equal(audio.started.length, before, 'the initial cave ambience must not fire early');
  Sound.tick(1.1, cave);
  assert.equal(audio.started.length, before + 1, 'sustained cave exposure should eventually play one ambience');
  const status = Sound.status();
  assert.ok(status.caveTimer >= 120 && status.caveTimer <= 360, 'the next ambience needs a two-to-six minute cooldown');
  assert.equal(status.caveExposure, 0);

  Sound.tick(119, cave);
  assert.equal(audio.started.length, before + 1, 'the cooldown must prevent frequent cave ambience');
});
