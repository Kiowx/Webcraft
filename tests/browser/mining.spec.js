'use strict';

const { test, expect } = require('@playwright/test');

async function clickCanvasControl(page, id) {
  const control = await page.evaluate(controlId => {
    const match = UI.screenControls(innerWidth, innerHeight).find(item => item.id === controlId);
    return match ? { x: match.x, y: match.y, w: match.w, h: match.h } : null;
  }, id);
  expect(control).toBeTruthy();
  await page.mouse.click(control.x + control.w / 2, control.y + control.h / 2);
}

test('continuous multiplayer mining confirms the first block before starting the next', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.UI && window.Network && UI.currentScreen() === 'title');
  await clickCanvasControl(page, 'multiplayer');
  await page.locator('#nickname-input').fill('MiningBrowser');
  await clickCanvasControl(page, 'join_server');
  await expect.poll(() => page.evaluate(() => Network.isConnected()), { timeout: 30000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => !!(game.player && game.player.onGround && Math.abs(game.player.vy || 0) < 0.05)),
    { timeout: 15000 }).toBe(true);
  await page.waitForTimeout(250);
  await expect.poll(() => page.evaluate(() => !!(game.player && game.player.onGround)), { timeout: 5000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const player = game.player;
    if (!player || !game.world) return false;
    const originalYaw = player.yaw;
    const originalPitch = player.pitch;
    let found = false;
    for (let pitchStep = -4; pitchStep <= 12 && !found; pitchStep++) {
      for (let yawStep = 0; yawStep < 32; yawStep++) {
        player.pitch = pitchStep * 0.1;
        player.yaw = yawStep * Math.PI / 16;
        if (player.look(player.blockReach())) { found = true; break; }
      }
    }
    player.yaw = originalYaw;
    player.pitch = originalPitch;
    return found;
  }), { timeout: 15000 }).toBe(true);

  await page.evaluate(() => {
    window.__miningTrace = [];
    window.__miningPerf = { generations: [], meshes: [], frameGaps: [], holdStart: null, holdEnd: null };
    const originalEnsureChunk = game.world.ensureChunk;
    game.world.ensureChunk = function (...args) {
      window.__miningPerf.generations.push({ at: performance.now(), cx: args[0], cz: args[1] });
      return originalEnsureChunk.apply(this, args);
    };
    const meshMethod = Mesher.meshSectionRuntime ? 'meshSectionRuntime' : 'meshSection';
    const originalMeshSection = Mesher[meshMethod];
    Mesher[meshMethod] = function (...args) {
      const start = performance.now();
      const ch = args[1], section = args[2];
      const key = ch.meshKeys[section];
      const urgent = game.world.urgentMeshKeys.has(key);
      const result = originalMeshSection.apply(Mesher, args);
      window.__miningPerf.meshes.push({
        at: start, ms: performance.now() - start, key, urgent, fastLighting: args[3] === true,
      });
      return result;
    };
    let previousFrame = performance.now();
    const sampleFrame = now => {
      if (window.__miningPerf.holdStart !== null && window.__miningPerf.holdEnd === null) {
        window.__miningPerf.frameGaps.push(now - previousFrame);
      }
      previousFrame = now;
      if (window.__miningPerf.holdEnd === null) requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);
    const previousMining = Network.onMining;
    Network.onMining = message => {
      window.__miningTrace.push({ type: 'server', at: performance.now(), message: JSON.parse(JSON.stringify(message)) });
      if (previousMining) previousMining(message);
    };
    const originalStart = Network.startMining;
    Network.startMining = function (...args) {
      window.__miningTrace.push({ type: 'start', at: performance.now(), args: JSON.parse(JSON.stringify(args)) });
      return originalStart.apply(Network, args);
    };
    const player = game.player;
    const originalUpdateMining = player.updateMining;
    let miningFrames = 0;
    player.updateMining = function (dt, input) {
      miningFrames++;
      if (miningFrames <= 3 || (input.mine && miningFrames % 15 === 0)) {
        const hit = this.look(this.blockReach());
        window.__miningTrace.push({
          type: 'frame', at: performance.now(), mine: input.mine, paused: game.paused,
          hit: hit ? { x: hit.x, y: hit.y, z: hit.z, id: hit.id } : null,
        });
      }
      return originalUpdateMining.call(this, dt, input);
    };
    const previousBlockChanged = game.world.onBlockChanged;
    game.world.onBlockChanged = (x, y, z) => {
      window.__miningTrace.push({
        type: 'block', at: performance.now(), x, y, z, id: game.world.getBlock(x, y, z),
      });
      return previousBlockChanged(x, y, z);
    };
    document.addEventListener('pointerdown', event => {
      const locked = document.pointerLockElement && document.pointerLockElement.id;
      window.__miningTrace.push({
        type: 'pointerdown', at: performance.now(), button: event.button,
        target: event.target && event.target.id,
        locked,
      });
      if (event.button === 0 && locked === 'hud') window.__miningPerf.holdStart = performance.now();
    }, true);
    document.addEventListener('pointerup', event => {
      window.__miningTrace.push({ type: 'pointerup', at: performance.now(), button: event.button });
      if (event.button === 0 && window.__miningPerf.holdStart !== null) window.__miningPerf.holdEnd = performance.now();
    }, true);

    let best = null;
    for (let pitchStep = -4; pitchStep <= 12; pitchStep++) {
      for (let yawStep = 0; yawStep < 32; yawStep++) {
        player.pitch = pitchStep * 0.1;
        player.yaw = yawStep * Math.PI / 16;
        const hit = player.look(player.blockReach());
        if (!hit) continue;
        const total = player.breakTimeFor(hit.id);
        if (!Number.isFinite(total)) continue;
        if (!best || total < best.total) {
          best = { x: hit.x, y: hit.y, z: hit.z, id: hit.id, yaw: player.yaw, pitch: player.pitch, total };
        }
      }
    }
    if (!best) throw new Error('No mineable block in reach');
    player.yaw = best.yaw;
    player.pitch = best.pitch;
    window.__miningTarget = best;
    const anchor = { x: player.x, y: player.y, z: player.z };
    const originalPlayerUpdate = player.update;
    player.update = function (dt, input) {
      const holding = window.__miningPerf.holdStart !== null && window.__miningPerf.holdEnd === null;
      if (holding) {
        this.x = anchor.x; this.y = anchor.y; this.z = anchor.z;
        this.vx = this.vy = this.vz = 0;
        this.yaw = best.yaw; this.pitch = best.pitch; this.onGround = true;
      }
      const result = originalPlayerUpdate.call(this, dt, input);
      if (holding) {
        this.x = anchor.x; this.y = anchor.y; this.z = anchor.z;
        this.vx = this.vy = this.vz = 0;
        this.yaw = best.yaw; this.pitch = best.pitch; this.onGround = true;
      }
      return result;
    };
  });
  await page.waitForTimeout(250);

  await page.mouse.click(640, 360);
  await page.waitForFunction(() => document.pointerLockElement === document.getElementById('hud'));
  await page.evaluate(() => {
    game.player.yaw = window.__miningTarget.yaw;
    game.player.pitch = window.__miningTarget.pitch;
  });
  await page.mouse.down({ button: 'left' });
  await page.waitForFunction(() => window.__miningTrace.some(entry => entry.type === 'start'));
  const firstStart = await page.evaluate(() => {
    const args = window.__miningTrace.find(entry => entry.type === 'start').args;
    return { x: args[0], y: args[1], z: args[2], id: args[3], total: args[4] };
  });
  await page.waitForTimeout(Math.ceil(firstStart.total * 1000) + 1200);
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(450);

  const result = await page.evaluate(target => ({
    id: game.world.getBlock(target.x, target.y, target.z),
    trace: window.__miningTrace,
    response: game.player.lastMiningResponse || null,
    perf: window.__miningPerf,
  }), firstStart);
  const duringHold = entry => entry.at >= result.perf.holdStart && entry.at <= result.perf.holdEnd;
  const generatedDuringHold = result.perf.generations.filter(duringHold);
  const meshedDuringHold = result.perf.meshes.filter(duringHold);
  expect(Number.isFinite(result.perf.holdStart) && Number.isFinite(result.perf.holdEnd)).toBe(true);
  expect(result.id, JSON.stringify(result, null, 2)).toBe(0);
  expect(result.trace.some(entry => entry.type === 'server' && entry.message.state === 'completed' &&
    entry.message.x === firstStart.x && entry.message.y === firstStart.y && entry.message.z === firstStart.z),
  JSON.stringify(result, null, 2)).toBe(true);
  expect(result.trace.some(entry => entry.type === 'server' && entry.message.state === 'rejected' &&
    entry.message.reason === 'missing_start'), JSON.stringify(result, null, 2)).toBe(false);
  expect(generatedDuringHold, JSON.stringify(result.perf, null, 2)).toEqual([]);
  expect(meshedDuringHold.length, JSON.stringify(result.perf, null, 2)).toBeGreaterThan(0);
  expect(meshedDuringHold.every(entry => entry.urgent), JSON.stringify(result.perf, null, 2)).toBe(true);
  expect(meshedDuringHold.every(entry => entry.fastLighting), JSON.stringify(result.perf, null, 2)).toBe(true);
  expect(result.perf.meshes.some(entry => entry.at > result.perf.holdEnd && !entry.fastLighting),
    JSON.stringify(result.perf, null, 2)).toBe(true);
  expect(Math.max(...result.perf.frameGaps), JSON.stringify(result.perf, null, 2)).toBeLessThan(120);
});
