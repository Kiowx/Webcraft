/* save.js — localStorage persistence (RLE-compressed chunk deltas) */
'use strict';
(function () {
  const KEY = 'webcraft_v1_slot0';
  const DB_NAME = 'webcraft_v2';
  const DB_VERSION = 1;
  const SLOT = 'slot0';
  let dbPromise = null;
  let cachedExists = false;

  function requestResult(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexeddb-request'));
    });
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('indexeddb-transaction'));
      tx.onabort = () => reject(tx.error || new Error('indexeddb-abort'));
    });
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no-indexeddb'));
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexeddb-open'));
    });
    return dbPromise;
  }

  function validMeta(data) {
    return !!data && (data.v === 1 || data.v === 2 || data.v === 3) && Number.isFinite(+data.seed) && data.player;
  }

  function cleanSignLines(value) {
    const source = Array.isArray(value) ? value : String(value || '').replace(/\r/g, '').split('\n');
    const lines = source.slice(0, 4).map(line => Array.from(String(line || '')).slice(0, 15).join(''));
    while (lines.length < 4) lines.push('');
    return lines;
  }

  function decodedLength(rle) {
    if (!rle || (rle.length & 1)) throw new Error('invalid-rle');
    let n = 0;
    for (let i = 0; i < rle.length; i += 2) n += rle[i];
    return n;
  }

  function decodeChunk(encoded, declaredHeight) {
    const length = decodedLength(encoded);
    const inferredHeight = length / (16 * 16);
    const height = Number.isInteger(inferredHeight) ? inferredHeight : declaredHeight;
    if (!Number.isInteger(height) || height <= 0 || height > World.CH_H) throw new Error('invalid-chunk-height');
    const raw = U.rleDecode(encoded, 16 * 16 * height);
    if (height === World.CH_H) return raw;
    const migrated = new Uint8Array(16 * 16 * World.CH_H);
    migrated.set(raw);
    return migrated;
  }

  function decodeChunkRecord(record, fallbackHeight) {
    const encoded = record.rle instanceof Uint8Array ? record.rle : new Uint8Array(record.rle);
    const length = decodedLength(encoded);
    const raw = U.rleDecode(encoded, length);
    if (record.sum !== undefined && U.checksum32(raw) !== record.sum) throw new Error('chunk-checksum');
    const inferredHeight = length / (16 * 16);
    const height = Number.isInteger(inferredHeight) ? inferredHeight : (record.height || fallbackHeight);
    if (!Number.isInteger(height) || height <= 0 || height > World.CH_H) throw new Error('invalid-chunk-height');
    if (height === World.CH_H) return raw;
    const migrated = new Uint8Array(16 * 16 * World.CH_H);
    migrated.set(raw);
    return migrated;
  }

  function nowMs() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  function yieldMainThread() {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function' &&
        (typeof document === 'undefined' || !document.hidden)) {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  async function encodeChunkAsync(data, budgetMs) {
    let out = new Uint8Array(Math.max(1024, Math.min(data.length * 2, 8192)));
    let i = 0, o = 0;
    let hash = 2166136261 >>> 0;
    let sliceStart = nowMs();
    let nextCheck = 2048;
    while (i < data.length) {
      const value = data[i];
      let run = 1;
      while (run < 255 && i + run < data.length && data[i + run] === value) run++;
      if (o + 2 > out.length) {
        const grown = new Uint8Array(Math.min(data.length * 2, out.length * 2));
        grown.set(out);
        out = grown;
      }
      out[o++] = run;
      out[o++] = value;
      for (let n = 0; n < run; n++) {
        hash ^= value;
        hash = Math.imul(hash, 16777619);
      }
      i += run;
      if (i >= nextCheck) {
        nextCheck = i + 2048;
        if (nowMs() - sliceStart >= budgetMs && i < data.length) {
          await yieldMainThread();
          sliceStart = nowMs();
        }
      }
    }
    return { rle: out.slice(0, o), sum: hash >>> 0 };
  }

  function buildMeta(game) {
    const world = game.world;
    return {
      v: 3,
      seed: world.seed,
      worldHeight: World.CH_H,
      seaLevel: World.SEA,
      time: world.time,
      timeOfDay: world.timeOfDay,
      weather: world.weather,
      weatherTimer: world.weatherTimer,
      rainStrength: world.rainStrength,
      dragonDefeated: !!world.dragonDefeated,
      spawnedVillages: Array.from(world.spawnedVillages || []),
      worldRng: world.getRngState ? world.getRngState() : undefined,
      entityRng: Entities.getRngState ? Entities.getRngState() : undefined,
      player: game.player.serialize(),
      entities: Entities.serialize(),
      be: Array.from(world.be, ([k, v]) => ({
        k, type: v.type, slots: v.slots, burn: v.burn, burnMax: v.burnMax, cook: v.cook,
        lines: v.type === 'sign' ? cleanSignLines(v.lines || v.text || '') : undefined,
      })),
      states: Array.from(world.states || [], ([k, v]) => ({ k, v })),
      ticks: world.ticks.toArray ? world.ticks.toArray() : world.ticks,
      savedAt: Date.now(),
    };
  }

  const SaveSys = {
    async init() {
      try {
        const db = await openDB();
        const tx = db.transaction('meta', 'readonly');
        cachedExists = validMeta(await requestResult(tx.objectStore('meta').get(SLOT)));
      } catch (e) {
        cachedExists = false;
      }
      if (!cachedExists) cachedExists = this.existsLegacy();
      return cachedExists;
    },

    async saveAsync(game) {
      try {
        const db = await openDB();
        const world = game.world;
        const keys = new Set(world.dirtyChunkKeys || []);
        for (const [key, ch] of world.chunks) if (ch.modified) keys.add(key);
        for (const key in world.savedChunks) {
          if (!world.persistedChunkKeys || !world.persistedChunkKeys.has(key)) keys.add(key);
        }

        const prepared = [];
        for (const key of keys) {
          const loaded = world.chunks.get(key);
          const raw = loaded ? loaded.blocks : world.savedChunks[key];
          if (!raw) continue;
          const snapshot = new Uint8Array(raw);
          const encoded = await encodeChunkAsync(snapshot, 4);
          prepared.push({
            key,
            raw: snapshot,
            rle: encoded.rle,
            sum: encoded.sum,
            version: loaded ? loaded.editVersion : (world.savedChunkVersions[key] || 0),
          });
          await yieldMainThread();
        }

        const meta = buildMeta(game);
        const readTx = db.transaction('meta', 'readonly');
        const previous = await requestResult(readTx.objectStore('meta').get(SLOT));
        const tx = db.transaction(['meta', 'chunks'], 'readwrite');
        const metaStore = tx.objectStore('meta');
        const chunkStore = tx.objectStore('chunks');
        if (validMeta(previous)) metaStore.put(previous, SLOT + '_backup');
        metaStore.put(meta, SLOT);
        let bytes = JSON.stringify(meta).length;
        for (const record of prepared) {
          chunkStore.put({ rle: record.rle, sum: record.sum, height: World.CH_H }, SLOT + '|' + record.key);
          bytes += record.rle.byteLength;
        }
        await transactionDone(tx);
        for (const record of prepared) {
          const key = record.key, savedVersion = record.version;
          world.persistedChunkKeys.add(key);
          const ch = world.chunks.get(key);
          if (ch && ch.editVersion === savedVersion) {
            world.savedChunks[key] = record.raw;
            world.savedChunkVersions[key] = ch.editVersion;
            ch.modified = false;
            world.dirtyChunkKeys.delete(key);
          } else if (!ch && (world.savedChunkVersions[key] || 0) === savedVersion) {
            world.dirtyChunkKeys.delete(key);
          }
        }
        cachedExists = true;
        return { ok: true, bytes };
      } catch (e) {
        if (typeof indexedDB === 'undefined') return this.save(game);
        return { ok: false, err: String(e && e.message ? e.message : e) };
      }
    },

    async loadAsync() {
      try {
        const db = await openDB();
        let metaTx = db.transaction('meta', 'readonly');
        let data = await requestResult(metaTx.objectStore('meta').get(SLOT));
        if (!validMeta(data)) {
          metaTx = db.transaction('meta', 'readonly');
          data = await requestResult(metaTx.objectStore('meta').get(SLOT + '_backup'));
        }
        if (!validMeta(data)) return this.load();

        const tx = db.transaction('chunks', 'readonly');
        const chunkStore = tx.objectStore('chunks');
        const keysReq = chunkStore.getAllKeys();
        const valuesReq = chunkStore.getAll();
        const [keys, values] = await Promise.all([requestResult(keysReq), requestResult(valuesReq)]);
        data.chunkRecords = {};
        data.persistedChunkKeys = [];
        for (let i = 0; i < keys.length; i++) {
          const dbKey = String(keys[i]);
          if (!dbKey.startsWith(SLOT + '|')) continue;
          const key = dbKey.slice(SLOT.length + 1);
          const record = values[i];
          try {
            const encoded = record.rle instanceof Uint8Array ? record.rle : new Uint8Array(record.rle);
            if (!encoded.length || (encoded.length & 1)) continue;
            data.chunkRecords[key] = { rle: encoded, sum: record.sum, height: record.height };
            data.persistedChunkKeys.push(key);
          } catch (e) { /* skip only the corrupt chunk */ }
        }
        cachedExists = true;
        return data;
      } catch (e) {
        return this.load();
      }
    },

    async clearAsync() {
      cachedExists = false;
      try {
        const db = await openDB();
        const tx = db.transaction(['meta', 'chunks'], 'readwrite');
        tx.objectStore('meta').clear();
        tx.objectStore('chunks').clear();
        await transactionDone(tx);
      } catch (e) { /* localStorage fallback below */ }
      this.clear();
    },

    available() {
      try {
        localStorage.setItem('__t', '1');
        localStorage.removeItem('__t');
        return true;
      } catch (e) { return false; }
    },

    save(game) {
      if (!this.available()) return { ok: false, err: 'no-localstorage' };
      try {
        const world = game.world;
        const chunks = {};
        // keep previously saved chunks that aren't currently loaded
        for (const k in world.savedChunks) {
          chunks[k] = U.b64encode(U.rleEncode(world.savedChunks[k]));
        }
        for (const [k, ch] of world.chunks) {
          if (ch.modified) {
            chunks[k] = U.b64encode(U.rleEncode(ch.blocks));
          }
        }
        const be = [];
        for (const [k, v] of world.be) {
          be.push({
            k, type: v.type, slots: v.slots, burn: v.burn, burnMax: v.burnMax, cook: v.cook,
            lines: v.type === 'sign' ? cleanSignLines(v.lines || v.text || '') : undefined,
          });
        }
        const data = {
          v: 1,
          seed: world.seed,
          worldHeight: World.CH_H,
          seaLevel: World.SEA,
          time: world.time,
          timeOfDay: world.timeOfDay,
          weather: world.weather,
          weatherTimer: world.weatherTimer,
          rainStrength: world.rainStrength,
          dragonDefeated: !!world.dragonDefeated,
          spawnedVillages: Array.from(world.spawnedVillages || []),
          worldRng: world.getRngState ? world.getRngState() : undefined,
          entityRng: Entities.getRngState ? Entities.getRngState() : undefined,
          player: game.player.serialize(),
          entities: Entities.serialize(),
          be,
          states: Array.from(world.states || [], ([k, v]) => ({ k, v })),
          ticks: world.ticks.toArray ? world.ticks.toArray() : world.ticks,
          chunks,
        };
        const json = JSON.stringify(data);
        localStorage.setItem(KEY, json);
        cachedExists = true;
        return { ok: true, bytes: json.length };
      } catch (e) {
        return { ok: false, err: String(e) };
      }
    },

    load() {
      if (!this.available()) return null;
      try {
        const json = localStorage.getItem(KEY);
        if (!json) return null;
        const data = JSON.parse(json);
        if (data.v !== 1) return null;
        return data;
      } catch (e) {
        return null;
      }
    },

    applyToWorld(data, world) {
      if (data.chunkBytes) {
        for (const k in data.chunkBytes) world.savedChunks[k] = data.chunkBytes[k];
      } else if (data.chunkRecords) {
        world.savedChunkRecords = data.chunkRecords;
        world.loadSavedChunk = (key) => {
          const record = world.savedChunkRecords[key];
          if (!record) return null;
          delete world.savedChunkRecords[key];
          try {
            const raw = decodeChunkRecord(record, data.worldHeight || World.LEGACY_CH_H);
            world.savedChunks[key] = raw;
            return raw;
          } catch (e) {
            world.persistedChunkKeys.delete(key);
            world.dirtyChunkKeys.add(key);
            return null;
          }
        };
      } else if (data.chunks) {
        for (const k in data.chunks) {
          try {
            world.savedChunks[k] = decodeChunk(U.b64decode(data.chunks[k]), data.worldHeight || World.LEGACY_CH_H);
          } catch (e) { /* skip corrupt chunk */ }
        }
      }
      if (data.persistedChunkKeys && world.persistedChunkKeys) {
        for (const key of data.persistedChunkKeys) world.persistedChunkKeys.add(key);
      }
      if (data.be) {
        for (const b of data.be) {
          const be = b.type === 'sign'
            ? { type: 'sign', lines: cleanSignLines(b.lines || b.text || '') }
            : { type: b.type, slots: b.slots || [] };
          if (b.type === 'furnace') {
            be.burn = b.burn || 0; be.burnMax = b.burnMax || 0; be.cook = b.cook || 0;
          }
          const pos = String(b.k || '').split(',').map(Number);
          if (pos.length === 3 && pos.every(Number.isFinite)) world.setBE(pos[0], pos[1], pos[2], be);
        }
      }
      if (Array.isArray(data.states) && world.states) {
        for (const s of data.states) if (s && typeof s.k === 'string') world.states.set(s.k, s.v);
      }
      if (data.time !== undefined) world.time = data.time;
      if (data.timeOfDay !== undefined) world.timeOfDay = data.timeOfDay;
      if (data.weather === 'clear' || data.weather === 'rain') world.weather = data.weather;
      if (Number.isFinite(+data.weatherTimer)) world.weatherTimer = +data.weatherTimer;
      if (Number.isFinite(+data.rainStrength)) world.rainStrength = U.clamp(+data.rainStrength, 0, 1);
      world.dragonDefeated = !!data.dragonDefeated;
      if (world.spawnedVillages && Array.isArray(data.spawnedVillages)) {
        world.spawnedVillages.clear();
        for (const id of data.spawnedVillages) if (typeof id === 'string') world.spawnedVillages.add(id);
      }
      if (data.worldRng !== undefined && world.setRngState) world.setRngState(data.worldRng);
      if (Array.isArray(data.ticks)) {
        if (world.loadTicks) world.loadTicks(data.ticks);
        else world.ticks = data.ticks
          .filter(t => t && typeof t.type === 'string')
          .map(t => ({ at: +t.at || world.time, x: t.x | 0, y: t.y | 0, z: t.z | 0, type: t.type }));
      }
    },

    clear() {
      cachedExists = false;
      try { localStorage.removeItem(KEY); } catch (e) { }
    },

    exists() {
      return cachedExists || this.existsLegacy();
    },

    existsLegacy() {
      try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
    },
  };

  window.SaveSys = SaveSys;
})();
