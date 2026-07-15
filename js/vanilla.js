/* vanilla.js - shared Minecraft Java 1.12.2 gameplay constants and formulas */
'use strict';
(function () {
  const TICK_RATE = 20;
  const TICK_SECONDS = 1 / TICK_RATE;

  const MOVEMENT = Object.freeze({
    walkSpeed: 4.317,
    sprintMultiplier: 1.3,
    sneakMultiplier: 0.3,
    blockingMultiplier: 0.2,
    flyMultiplier: 2.6,
    jumpVelocity: 0.42 * TICK_RATE,
    sprintJumpBoost: 0.2 * TICK_RATE,
    groundDrag: 0.6 * 0.91,
    airDrag: 0.91,
    verticalDrag: 0.98,
    gravityPerTick: 0.08,
    waterDrag: 0.8,
    lavaDrag: 0.5,
    liquidGravityPerTick: 0.02,
    liquidJumpPerTick: 0.04 * TICK_RATE,
    ladderHorizontalLimit: 0.15 * TICK_RATE,
    ladderFallLimit: -0.15 * TICK_RATE,
    ladderClimbVelocity: 0.2 * TICK_RATE,
  });

  const SURVIVAL = Object.freeze({
    maxAirSeconds: 15,
    exhaustionThreshold: 4,
    sprintExhaustionPerMeter: 0.1,
    swimExhaustionPerMeter: 0.01,
    jumpExhaustion: 0.05,
    sprintJumpExhaustion: 0.2,
    attackExhaustion: 0.1,
    slowRegenSeconds: 4,
    fastRegenSeconds: 0.5,
    slowRegenExhaustion: 6,
    starvationSeconds: 4,
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function tickFactor(perTick, dt) {
    return Math.pow(perTick, Math.max(0, Number(dt) || 0) * TICK_RATE);
  }

  // Exact fractional form of value = (value + addPerTick) * dragPerTick.
  function affineTick(value, addPerTick, dragPerTick, dt) {
    const factor = tickFactor(dragPerTick, dt);
    if (dragPerTick === 1) return value + addPerTick * Math.max(0, Number(dt) || 0) * TICK_RATE;
    const terminal = addPerTick * dragPerTick / (1 - dragPerTick);
    return terminal + (value - terminal) * factor;
  }

  function approachVelocity(value, target, dragPerTick, dt) {
    const factor = tickFactor(dragPerTick, dt);
    return target + (value - target) * factor;
  }

  function airVerticalVelocity(value, dt) {
    return affineTick(value, -MOVEMENT.gravityPerTick * TICK_RATE, MOVEMENT.verticalDrag, dt);
  }

  function liquidVerticalVelocity(value, dt, lava) {
    return affineTick(value, -MOVEMENT.liquidGravityPerTick * TICK_RATE,
      lava ? MOVEMENT.lavaDrag : MOVEMENT.waterDrag, dt);
  }

  function attackScale(strength) {
    strength = clamp(strength, 0, 1);
    return 0.2 + strength * strength * 0.8;
  }

  function sharpnessBonus(level) {
    level = Math.max(0, Number(level) || 0);
    return level > 0 ? 0.5 * level + 0.5 : 0;
  }

  function armorReduction(damage, armor, toughness) {
    damage = Math.max(0, Number(damage) || 0);
    armor = clamp(armor, 0, 30);
    toughness = Math.max(0, Number(toughness) || 0);
    const divisor = 2 + toughness / 4;
    const effective = Math.min(20, Math.max(armor / 5, armor - damage / divisor));
    return effective / 25;
  }

  function applyArmor(damage, armor, toughness) {
    return Math.max(0, damage * (1 - armorReduction(damage, armor, toughness)));
  }

  function applyProtection(damage, protection) {
    const epf = clamp(protection, 0, 20);
    return Math.max(0, damage * (1 - epf / 25));
  }

  function starvationFloor(difficulty) {
    difficulty = clamp(Math.round(difficulty), 0, 3);
    return difficulty === 1 ? 10 : difficulty === 2 ? 1 : difficulty === 3 ? 0 : 20;
  }

  window.Vanilla = Object.freeze({
    VERSION: '1.12.2',
    TICK_RATE,
    TICK_SECONDS,
    MOVEMENT,
    SURVIVAL,
    tickFactor,
    affineTick,
    approachVelocity,
    airVerticalVelocity,
    liquidVerticalVelocity,
    attackScale,
    sharpnessBonus,
    armorReduction,
    applyArmor,
    applyProtection,
    starvationFloor,
  });
})();
