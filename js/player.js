/* player.js — first-person controller, survival stats, mining/placing, inventory */
'use strict';
(function () {
  const MOVE = Vanilla.MOVEMENT;
  const SURVIVAL = Vanilla.SURVIVAL;
  const SURVIVAL_BLOCK_REACH = 4.5;
  const CREATIVE_BLOCK_REACH = 5.0;
  const ENTITY_REACH = 3.0;
  const SWING_DURATION = 0.30;

  function makeSlots(n) { const a = []; for (let i = 0; i < n; i++) a.push(null); return a; }

  function blockSound(id, action) {
    if (Blocks.soundEvent) return Blocks.soundEvent(id, action);
    return 'block.' + (Blocks.get(id).sound || 'stone') + '.' + action;
  }

  function doorPlacement(world, x, y, z, id, facing) {
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const forward = dirs[facing & 3];
    const left = [forward[1], -forward[0]];
    const right = [-left[0], -left[1]];
    const sameDoor = (dx, dz) => {
      if (world.getBlock(x + dx, y, z + dz) !== id) return null;
      if (world.doorInfo && !world.doorInfo(x + dx, y, z + dz)) return null;
      const state = world.getState(x + dx, y, z + dz) | 0;
      return (state & 3) === (facing & 3) ? { x:x + dx, z:z + dz, state } : null;
    };
    const leftDoor = sameDoor(left[0], left[1]);
    const rightDoor = sameDoor(right[0], right[1]);
    if (leftDoor && !rightDoor) return { state:(facing & 3) | 8, pair:Object.assign(leftDoor, { rightHinge:false }) };
    if (rightDoor && !leftDoor) return { state:facing & 3, pair:Object.assign(rightDoor, { rightHinge:true }) };

    const solidScore = side => Number(Blocks.isSolid(world.getBlock(x + side[0], y, z + side[1]))) +
      Number(Blocks.isSolid(world.getBlock(x + side[0], y + 1, z + side[1])));
    return { state:(facing & 3) | (solidScore(left) > solidScore(right) ? 8 : 0), pair:null };
  }

  class Player {
    constructor(world) {
      this.world = world;
      this.w = 0.6; this.h = 1.8; this.eye = 1.62;
      const sp = world.findSpawn();
      this.spawn = sp;
      this.x = sp.x; this.y = sp.y; this.z = sp.z;
      this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
      this.viewX = null; this.viewY = null; this.viewZ = null;
      this.vx = 0; this.vy = 0; this.vz = 0;
      this.yaw = 0; this.pitch = 0;
      this.onGround = false;
      this.mode = 'survival';        // survival | creative
      this.difficulty = 2;
      this.flying = false;
      this.dead = false;
      this.hp = 20; this.maxHp = 20;
      this.hunger = 20; this.saturation = 5;
      this.air = SURVIVAL.maxAirSeconds; this.maxAir = SURVIVAL.maxAirSeconds;
      this.armor = 0;
      this.armorToughness = 0;
      this.equipment = makeSlots(4);  // helmet, chestplate, leggings, boots
      this.offhand = null;
      this.xpLevel = 0;
      this.xpProgress = 0;
      this.statusEffects = [];
      this.stats = { blocksMined: 0, blocksPlaced: 0, mobsKilled: 0, distanceWalked: 0, itemsCrafted: 0 };
      this.advancements = {};
      this.riding = null;
      this.fallStart = null;
      this.inv = makeSlots(36);      // 0-8 hotbar
      this.hotbar = 0;
      this.cursor = null;            // item stack on mouse
      this.mining = null;            // {x,y,z, progress, total}
      this.swing = 0;                // legacy remaining-time view of hand animation
      this.handAction = 'idle';      // idle | attack | mine | use | eat | bow | fish | block
      this.isBlocking = false;
      this.shieldDisabledTime = 0;
      this.blockBlend = 0;
      this.blockHitTime = 0;
      this.handActionTime = 0;
      this.handActionDuration = SWING_DURATION;
      this.equipDuration = 0.18;
      this.equipTime = 0;
      this._heldAnimId = -1;
      this._offhandAnimId = -1;
      this.useCooldown = 0;
      this.attackCharge = 1;
      this.hurtTime = 0;
      this.regenTimer = 0;
      this.starveTimer = 0;
      this.drownTimer = 0;
      this.exhaust = 0;
      this.stepDist = 0;
      this.swimSoundDist = 0;
      this.climbSoundDist = 0;
      this.lavaTimer = 0;
      this.fireTicks = 0;
      this.bobPhase = 0;
      this.bobAmp = 0;
      this.autoJumpCooldown = 0;
      this.autoJumpEnabled = true;
      this.bowCharge = 0;
      this.fishingTimer = 0;
      this.isSprinting = false;
      this.isSneaking = false;
      this._wasInWater = false;
      this.portalCooldown = 0;
      this._plateRefresh = 0;
      // starter kit
      this.give(Blocks.ID.CRAFTING, 1);
      this.give(Items.IT.APPLE, 3);
      this.give(Blocks.ID.TORCH, 8);
      const held = this.held();
      this._heldAnimId = held ? held.id : 0;
      this._offhandAnimId = 0;
    }

    // ---------- inventory ----------
    addXP(points) {
      let value = Math.max(0, points || 0);
      while (value > 0) {
        const need = 7 + this.xpLevel * 2;
        const remaining = (1 - this.xpProgress) * need;
        if (value < remaining) { this.xpProgress += value / need; break; }
        value -= remaining;
        this.xpLevel++;
        this.xpProgress = 0;
      }
    }
    addStatus(type, duration, level) {
      const old = this.statusEffects.find(e => e.type === type);
      if (old) { old.time = Math.max(old.time, duration); old.level = Math.max(old.level || 0, level || 0); }
      else this.statusEffects.push({ type, time: duration, level: level || 0 });
    }
    give(id, n, dur, ench) {
      n = n || 1;
      const max = Items.maxStack(id);
      const meta = typeof dur === 'object' && dur !== null ? dur : { dur, ench };
      // stack into existing
      for (let i = 0; i < 36 && n > 0; i++) {
        const s = this.inv[i];
        if (meta.dur === undefined && !meta.ench && !meta.name && s && s.id === id && s.n < max &&
            s.dur === undefined && !s.ench && !s.name) {
          const add = Math.min(n, max - s.n);
          s.n += add; n -= add;
        }
      }
      for (let i = 0; i < 36 && n > 0; i++) {
        if (!this.inv[i]) {
          const add = Math.min(n, max);
          const st = Items.makeStack(id, add, meta);
          this.inv[i] = st; n -= add;
        }
      }
      return n; // leftover
    }
    giveStack(stack) {
      if (!stack) return 0;
      return this.give(stack.id, stack.n, stack);
    }
    countItem(id) {
      let count = 0;
      for (const stack of this.inv) if (stack && stack.id === id) count += stack.n;
      return count;
    }
    consumeItem(id, amount) {
      let left = amount || 1;
      if (this.countItem(id) < left) return false;
      for (let i = 0; i < this.inv.length && left > 0; i++) {
        const stack = this.inv[i];
        if (!stack || stack.id !== id) continue;
        const take = Math.min(left, stack.n);
        stack.n -= take; left -= take;
        if (stack.n <= 0) this.inv[i] = null;
      }
      return true;
    }
    held() { return this.inv[this.hotbar]; }
    consumeHeld(n) {
      const s = this.inv[this.hotbar];
      if (!s) return;
      s.n -= (n || 1);
      if (s.n <= 0) this.inv[this.hotbar] = null;
    }
    damageTool(amount) {
      const s = this.inv[this.hotbar];
      if (!s || s.dur === undefined) return;
      let damage = 0;
      const unbreaking = s.ench && s.ench.unbreaking ? s.ench.unbreaking : 0;
      for (let i = 0; i < (amount || 1); i++) {
        if (unbreaking <= 0 || this.world.random() < 1 / (unbreaking + 1)) damage++;
      }
      s.dur -= damage;
      if (s.dur <= 0) {
        this.inv[this.hotbar] = null;
        Sound.emit('item.break', { volume: 0.8 });
      }
    }

    shieldStack() {
      const offhandItem = this.offhand ? Items.get(this.offhand.id) : null;
      if (offhandItem && offhandItem.shield) return { hand: 'offhand', stack: this.offhand };
      const held = this.held();
      const heldItem = held ? Items.get(held.id) : null;
      return heldItem && heldItem.shield ? { hand: 'main', stack: held } : null;
    }

    mainHandConsumesUse() {
      const stack = this.held();
      const item = stack ? Items.get(stack.id) : null;
      if (!item || item.shield) return false;
      return !!(item.bow || item.food || item.fishing || item.block || item.throwable ||
        item.bucket || item.bottle || item.ignite || item.bonemeal || item.plant ||
        item.minecart || item.enderEye || (item.tool && item.tool.type === 'hoe'));
    }

    damageShield(amount) {
      const shield = this.shieldStack();
      const stack = shield && shield.stack;
      if (!stack || stack.dur === undefined) return;
      let damage = 0;
      const unbreaking = stack.ench && stack.ench.unbreaking ? stack.ench.unbreaking : 0;
      for (let i = 0; i < (amount || 1); i++) {
        if (unbreaking <= 0 || this.world.random() < 1 / (unbreaking + 1)) damage++;
      }
      stack.dur -= damage;
      if (stack.dur <= 0) {
        if (shield.hand === 'offhand') this.offhand = null;
        else this.inv[this.hotbar] = null;
        this.setBlocking(false);
        Sound.emit('item.break', { volume: 0.8 });
      }
    }

    heldTool() {
      const s = this.held();
      if (!s) return null;
      const it = Items.get(s.id);
      return it && it.tool ? it.tool : null;
    }

    updateArmorValue() {
      let points = 0, toughness = 0;
      for (const stack of this.equipment) {
        const item = stack ? Items.get(stack.id) : null;
        if (item && item.armor) {
          points += item.armor.points;
          toughness += item.armor.toughness || 0;
        }
      }
      this.armor = U.clamp(points, 0, 20);
      this.armorToughness = Math.max(0, toughness);
      return this.armor;
    }

    damageArmor(amount) {
      const loss = Math.max(1, Math.ceil((amount || 1) / 4));
      for (let i = 0; i < this.equipment.length; i++) {
        const stack = this.equipment[i];
        if (!stack || stack.dur === undefined) continue;
        const unbreaking = stack.ench && stack.ench.unbreaking ? stack.ench.unbreaking : 0;
        if (unbreaking > 0 && this.world.random() >= 1 / (unbreaking + 1)) continue;
        stack.dur -= loss;
        if (stack.dur <= 0) this.equipment[i] = null;
      }
      this.updateArmorValue();
    }

    beginHandAction(type, duration, restart) {
      if (restart === false && this.handAction === type) return false;
      this.handAction = type;
      this.handActionTime = 0;
      this.handActionDuration = duration || SWING_DURATION;
      this.swing = this.handActionDuration;
      return true;
    }

    advanceLoopHandAction(type, duration, dt) {
      if (this.handAction !== type) this.beginHandAction(type, duration);
      else this.handActionTime = (this.handActionTime + dt) % this.handActionDuration;
      this.swing = this.handActionDuration - this.handActionTime;
    }

    stopHandAction(type) {
      if (this.handAction !== type) return;
      this.handAction = 'idle';
      this.handActionTime = 0;
      this.swing = 0;
    }

    canShieldBlock() {
      return !!(this.shieldStack() && !this.dead && this.shieldDisabledTime <= 0);
    }

    // Kept as a compatibility alias for input and older tests.
    canSwordBlock() { return this.canUseShield(); }

    canUseShield() { return this.canShieldBlock() && !this.mainHandConsumesUse(); }

    setBlocking(active, notify) {
      active = !!active && this.canUseShield();
      if (active === this.isBlocking) return false;
      this.isBlocking = active;
      if (active) {
        const held = this.held();
        const heldId = held ? held.id : 0;
        if (heldId !== this._heldAnimId) {
          this._heldAnimId = heldId;
          this.equipTime = this.equipDuration;
        }
        this.isSprinting = false;
        this.mining = null;
        if (this.handAction === 'mine') this.stopHandAction('mine');
        if (this.handAction === 'idle') this.beginHandAction('block', 1);
      } else if (this.handAction === 'block') {
        this.stopHandAction('block');
      }
      if (notify !== false && typeof Network !== 'undefined' && Network.isConnected && Network.isConnected() && Network.setBlocking) {
        Network.setBlocking(active, this.hotbar);
      }
      return true;
    }

    shieldFacesSource(source) {
      if (!source || !Number.isFinite(source.x) || !Number.isFinite(source.z)) return true;
      const sx = source.x - this.x, sz = source.z - this.z;
      const distance = Math.hypot(sx, sz);
      if (distance < 1e-6) return true;
      const lookX = -Math.sin(this.yaw), lookZ = -Math.cos(this.yaw);
      return lookX * sx / distance + lookZ * sz / distance >= Math.cos(50 * Math.PI / 180);
    }

    blocksDamage(cause, source) {
      return this.isBlocking && this.canShieldBlock() && this.shieldFacesSource(source) &&
        (cause === 'mob' || cause === 'arrow' || cause === 'player' || cause === 'explode');
    }

    blockHitFeedback() {
      this.blockHitTime = 0.18;
      Sound.emit('combat.block', { volume: 0.72, pitch: 0.94 });
      if (typeof Entities !== 'undefined' && Entities.blockGuardParticles) Entities.blockGuardParticles(this);
    }

    updateHandAnimation(dt) {
      const held = this.held();
      const heldId = held ? held.id : 0;
      const offhandId = this.offhand ? this.offhand.id : 0;
      if (heldId !== this._heldAnimId || offhandId !== this._offhandAnimId) {
        if (this._heldAnimId >= 0) Sound.emit('item.equip', { volume: 0.36 });
        this._heldAnimId = heldId;
        this._offhandAnimId = offhandId;
        this.equipTime = this.equipDuration;
        if (this.isBlocking && !this.canUseShield()) this.setBlocking(false);
        if (this.handAction === 'mine' || this.handAction === 'eat' || this.handAction === 'bow' || this.handAction === 'fish') {
          this.stopHandAction(this.handAction);
          this.bowCharge = 0;
          this.fishingTimer = 0;
        }
      }
      this.equipTime = Math.max(0, this.equipTime - dt);
      this.blockHitTime = Math.max(0, this.blockHitTime - dt);
      const blockTarget = this.isBlocking ? 1 : 0;
      const blockRate = blockTarget > this.blockBlend ? 12 : 10;
      if (this.blockBlend < blockTarget) this.blockBlend = Math.min(blockTarget, this.blockBlend + dt * blockRate);
      else if (this.blockBlend > blockTarget) this.blockBlend = Math.max(blockTarget, this.blockBlend - dt * blockRate);
      if (this.handAction !== 'idle' && this.handAction !== 'mine' && this.handAction !== 'eat' &&
          this.handAction !== 'bow' && this.handAction !== 'fish' && this.handAction !== 'block') {
        this.handActionTime += dt;
        if (this.handActionTime >= this.handActionDuration) {
          this.handAction = 'idle';
          this.handActionTime = 0;
        }
      }
      this.swing = this.handAction === 'idle' ? 0 : Math.max(0, this.handActionDuration - this.handActionTime);
    }

    // ---------- movement ----------
    update(dt, input) {
      if (this.dead) { this.isSprinting = false; return; }
      this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
      const world = this.world;
      if (Physics.resolvePenetration && Physics.resolvePenetration(world, this, 3)) {
        this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
      }
      this.useCooldown = Math.max(0, this.useCooldown - dt);
      this.shieldDisabledTime = Math.max(0, this.shieldDisabledTime - dt);
      this.attackCharge = Math.min(1, this.attackCharge + dt / this.attackInterval());
      this.hurtTime = Math.max(0, this.hurtTime - dt);
      for (const effect of this.statusEffects) {
        effect.time -= dt;
        if (effect.type === 'regeneration' && this.hp < this.maxHp) {
          effect.tick = (effect.tick || 0) + dt;
          const interval = 1.25 / Math.max(1, (effect.level || 0) + 1);
          if (effect.tick >= interval) { effect.tick %= interval; this.hp = Math.min(this.maxHp, this.hp + 1); }
        }
      }
      this.statusEffects = this.statusEffects.filter(effect => effect.time > 0);
      this.updateArmorValue();
      this.updateHandAnimation(dt);
      this.autoJumpCooldown = Math.max(0, this.autoJumpCooldown - dt);
      this.isSneaking = !!input.sneak;

      const inWater = Physics.isInLiquid(world, this, 'water');
      const inLava = Physics.isInLiquid(world, this, 'lava');
      const onLadder = Physics.touchesBlock(world, this, Blocks.ID.LADDER);
      const inCobweb = Physics.touchesBlock(world, this, Blocks.ID.COBWEB);
      const headWater = Physics.headInLiquid(world, this, 'water');
      if (inWater && !this._wasInWater) {
        const impact = U.clamp(Math.abs(this.vy) / 9, 0.2, 1);
        Sound.emit('water.splash', { x: this.x, y: this.y, z: this.z, volume: 0.45 + impact * 0.45, pitch: 0.9 + impact * 0.15 });
        if (Entities.splashParticles) Entities.splashParticles(this.x, this.y + 0.18, this.z, impact);
      }
      this._wasInWater = inWater;

      // input direction
      let mx = 0, mz = 0;
      if (input.fwd) mz -= 1;
      if (input.back) mz += 1;
      if (input.left) mx -= 1;
      if (input.right) mx += 1;
      const len = Math.hypot(mx, mz);
      if (len > 0) { mx /= len; mz /= len; }
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      let dx = mx * cy - mz * sy;
      let dz = mx * sy + mz * cy;

      const canSprint = this.mode === 'creative' || this.hunger > 6;
      this.isSprinting = !!(input.sprint && input.fwd && !input.back && !input.sneak && !this.isBlocking && len > 0 && canSprint);
      let speed = MOVE.walkSpeed;
      if (this.isSprinting) speed *= MOVE.sprintMultiplier;
      if (input.sneak) speed *= MOVE.sneakMultiplier;
      if (this.isBlocking) speed *= MOVE.blockingMultiplier;
      if (this.mode === 'creative' && this.flying) speed *= MOVE.flyMultiplier;
      const underId = world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.05), Math.floor(this.z));
      const surfaceFactor = Blocks.get(underId).speedFactor;
      if (this.onGround && Number.isFinite(surfaceFactor)) speed *= surfaceFactor;

      if (this.riding === 'minecart') {
        const railX = Math.floor(this.x), railY = Math.floor(this.y + 0.05), railZ = Math.floor(this.z);
        if (input.sneak || world.getBlock(railX, railY, railZ) !== Blocks.ID.RAIL) {
          this.dismountMinecart();
        } else {
          const axisX = (world.getState(railX, railY, railZ) & 1) === 1;
          const drive = (input.fwd ? 1 : 0) - (input.back ? 1 : 0);
          const facingSign = axisX ? (Math.sin(this.yaw) >= 0 ? 1 : -1) : (-Math.cos(this.yaw) >= 0 ? 1 : -1);
          const target = drive * facingSign * 8;
          const blend = Math.min(1, dt * (drive ? 4.5 : 1.6));
          if (axisX) {
            this.vx = U.lerp(this.vx, target, blend); this.vz = 0;
            this.z = U.lerp(this.z, railZ + 0.5, Math.min(1, dt * 14));
          } else {
            this.vz = U.lerp(this.vz, target, blend); this.vx = 0;
            this.x = U.lerp(this.x, railX + 0.5, Math.min(1, dt * 14));
          }
          this.vy = 0; this.y = railY + 0.01; this.onGround = true;
          Physics.move(world, this, dt);
        }
      } else if (this.mode === 'creative' && this.flying) {
        // fly
        this.vx = Vanilla.approachVelocity(this.vx, dx * speed, MOVE.airDrag, dt);
        this.vz = Vanilla.approachVelocity(this.vz, dz * speed, MOVE.airDrag, dt);
        let vyT = 0;
        if (input.jump) vyT += speed;
        if (input.sneak) vyT -= speed;
        this.vy = Vanilla.approachVelocity(this.vy, vyT, MOVE.airDrag, dt);
        Physics.move(world, this, dt);
        if (this.onGround && input.sneakLandedReset !== false) { /* keep flying */ }
      } else if (onLadder) {
        const climbSpeed = MOVE.ladderClimbVelocity;
        const ladderTargetX = U.clamp(dx * speed * 0.35, -MOVE.ladderHorizontalLimit, MOVE.ladderHorizontalLimit);
        const ladderTargetZ = U.clamp(dz * speed * 0.35, -MOVE.ladderHorizontalLimit, MOVE.ladderHorizontalLimit);
        this.vx = Vanilla.approachVelocity(this.vx, ladderTargetX, MOVE.airDrag, dt);
        this.vz = Vanilla.approachVelocity(this.vz, ladderTargetZ, MOVE.airDrag, dt);
        const climbTarget = input.jump ? climbSpeed : input.sneak ? 0 : Math.max(MOVE.ladderFallLimit, Math.min(0, this.vy));
        this.vy = Vanilla.approachVelocity(this.vy, climbTarget, MOVE.airDrag, dt);
        Physics.move(world, this, dt);
      } else if (inCobweb) {
        this.vx = Vanilla.approachVelocity(this.vx, dx * speed * 0.2, 0.25, dt);
        this.vz = Vanilla.approachVelocity(this.vz, dz * speed * 0.2, 0.25, dt);
        this.vy = Math.max(-0.65, Vanilla.approachVelocity(this.vy, -0.4, 0.05, dt));
        if (input.jump) this.vy = Math.max(this.vy, 0.45);
        Physics.move(world, this, dt);
      } else if (inWater || inLava) {
        let liquidSpeed = inLava ? 1.25 : 2.3;
        if (this.isSprinting) liquidSpeed *= 1.3;
        if (input.sneak) liquidSpeed *= 0.5;
        if (this.isBlocking) liquidSpeed *= 0.2;
        const liquidDrag = inLava ? MOVE.lavaDrag : MOVE.waterDrag;
        this.vx = Vanilla.approachVelocity(this.vx, dx * liquidSpeed, liquidDrag, dt);
        this.vz = Vanilla.approachVelocity(this.vz, dz * liquidSpeed, liquidDrag, dt);
        const flow = Physics.liquidFlow(world, this, inLava ? 'lava' : 'water');
        const flowForce = inLava ? 0.8 : 2.4;
        this.vx += flow[0] * flowForce * dt;
        this.vy += flow[1] * flowForce * dt;
        this.vz += flow[2] * flowForce * dt;
        this.vy = Vanilla.liquidVerticalVelocity(this.vy, dt, inLava);
        if (input.jump) this.vy += MOVE.liquidJumpPerTick * dt * Vanilla.TICK_RATE;
        Physics.move(world, this, dt);
      } else {
        const horizontalDrag = this.onGround ? MOVE.groundDrag : MOVE.airDrag;
        this.vx = Vanilla.approachVelocity(this.vx, dx * speed, horizontalDrag, dt);
        this.vz = Vanilla.approachVelocity(this.vz, dz * speed, horizontalDrag, dt);
        if (input.jump && this.onGround) {
          this.vy = MOVE.jumpVelocity;
          if (this.isSprinting) {
            this.vx += dx * MOVE.sprintJumpBoost;
            this.vz += dz * MOVE.sprintJumpBoost;
          }
          this.exhaust += this.isSprinting ? SURVIVAL.sprintJumpExhaustion : SURVIVAL.jumpExhaustion;
          Sound.emit('player.jump', { volume: this.isSprinting ? 0.38 : 0.3 });
        }
        let wantX = this.vx * dt, wantZ = this.vz * dt;
        if (input.sneak && this.onGround) {
          const clipped = Physics.clipSneakMovement(world, this, wantX, wantZ);
          wantX = clipped[0]; wantZ = clipped[1];
          this.vx = wantX / dt; this.vz = wantZ / dt;
        }
        const moveVx = this.vx, moveVz = this.vz;
        Physics.move(world, this, dt);
        if (!this.onGround && Math.abs(this.vy) < 1e-8 &&
            Physics.supportCount(world, this, this.x, this.y, this.z) > 0) {
          this.onGround = true;
        }
        let autoJumped = false;
        // vanilla-like auto jump: trigger a real jump arc instead of stepping up instantly
        if (len > 0 && this.onGround) {
          // Horizontal collision resolution clears the matching velocity. Using that
          // signal stays reliable when the fixed movement tick or acceleration changes.
          const blockedX = Math.abs(wantX) > 1e-4 && Math.abs(moveVx) > 1e-4 && Math.abs(this.vx) < 1e-6;
          const blockedZ = Math.abs(wantZ) > 1e-4 && Math.abs(moveVz) > 1e-4 && Math.abs(this.vz) < 1e-6;
          if ((blockedX || blockedZ) && this.canAutoJump(input, dx, dz)) {
            this.doAutoJump(dx, dz, speed);
            autoJumped = true;
          }
        }
        // Minecraft moves with the current vertical velocity, then applies gravity
        // and drag for the next tick. Preserve a newly queued auto-jump unchanged,
        // because its vertical movement begins on the following tick.
        if (!autoJumped) this.vy = this.onGround ? 0 : Vanilla.airVerticalVelocity(this.vy, dt);
        if (this.vy < -60) this.vy = -60;
      }

      // fall damage
      if (this.mode === 'survival' && !this.flying) {
        if (!this.onGround && !inWater && !inLava && !onLadder && !inCobweb) {
          if (this.fallStart === null || this.y > this.fallStart) {
            if (this.fallStart === null) this.fallStart = this.y;
            if (this.vy > 0) this.fallStart = Math.max(this.fallStart, this.y);
          }
        } else {
          if (this.fallStart !== null) {
            const fall = this.fallStart - this.y;
            if (fall > 0.55 && !inWater) {
              const landedOn = world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.3), Math.floor(this.z));
              if (landedOn) Sound.emit(blockSound(landedOn, 'fall'), { x: this.x, y: this.y, z: this.z, volume: U.clamp(0.34 + fall * 0.08, 0.34, 0.9) });
              Sound.emit(fall > 3.2 ? 'player.land_heavy' : 'player.land', { volume: U.clamp(0.3 + fall * 0.08, 0.3, 0.85) });
            }
            if (fall > 3.2 && !inWater) {
              this.damage(Math.floor(fall - 3), 'fall');
            }
            this.fallStart = null;
          }
        }
        if (inWater || onLadder || inCobweb) this.fallStart = null;
      } else {
        this.fallStart = null;
      }

      // drowning
      if (headWater && this.mode === 'survival') {
        this.air -= dt;
        if (this.air <= 0) {
          this.air = 0;
          this.drownTimer += dt;
          if (this.drownTimer >= 1) { this.drownTimer %= 1; this.damage(2, 'drown'); }
        }
      } else {
        this.air = this.maxAir;
        this.drownTimer = 0;
      }

      // lava damage
      if (inLava && this.mode === 'survival') {
        this.lavaTimer += dt;
        if (this.lavaTimer >= 0.5) { this.lavaTimer %= 0.5; this.damage(4, 'lava'); }
      }
      const feetId = world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.1), Math.floor(this.z));
      const bodyId = world.getBlock(Math.floor(this.x), Math.floor(this.y + 1.0), Math.floor(this.z));
      this.portalCooldown = Math.max(0, this.portalCooldown - dt);
      const portalId = feetId === Blocks.ID.NETHER_PORTAL || feetId === Blocks.ID.END_PORTAL ? feetId :
        (bodyId === Blocks.ID.NETHER_PORTAL || bodyId === Blocks.ID.END_PORTAL ? bodyId : 0);
      if (portalId && this.portalCooldown <= 0) {
        const px = Math.floor(this.x), py = Math.floor(this.y + (feetId === portalId ? 0.1 : 1)), pz = Math.floor(this.z);
        this.portalCooldown = 3;
        if (typeof Network !== 'undefined' && Network.isConnected && Network.isConnected()) {
          if (Network.usePortal) Network.usePortal(portalId, px, py, pz);
        } else if (world.portalDestination) {
          const destination = world.portalDestination(this.x, this.y, this.z, portalId);
          if (destination) {
            this.x = destination.x; this.y = destination.y; this.z = destination.z;
            this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
            this.vx = this.vy = this.vz = 0;
            UI.toast(destination.dimension === 'nether' ? '进入下界' : destination.dimension === 'end' ? '进入末地' : '返回主世界');
          }
        }
      }
      const plateY = Math.floor(this.y - 0.05);
      const plateX = Math.floor(this.x), plateZ = Math.floor(this.z);
      this._plateRefresh = Math.max(0, this._plateRefresh - dt);
      if (world.getBlock(plateX, plateY, plateZ) === Blocks.ID.STONE_PRESSURE_PLATE) {
        if (this._plateRefresh <= 0) {
          if (world.pressPressurePlate) world.pressPressurePlate(plateX, plateY, plateZ, 0.45);
          this._plateRefresh = 0.2;
        }
      }
      if (feetId === Blocks.ID.FIRE || bodyId === Blocks.ID.FIRE) this.fireTicks = Math.max(this.fireTicks, 4);
      if (inWater) this.fireTicks = 0;
      if (this.fireTicks > 0 && this.mode === 'survival') {
        this.fireTicks = Math.max(0, this.fireTicks - dt);
        this.fireDamageTimer = (this.fireDamageTimer || 0) + dt;
        if (this.fireDamageTimer >= 1) { this.fireDamageTimer %= 1; this.damage(1, 'fire'); }
      } else this.fireDamageTimer = 0;
      // cactus contact
      if (this.mode === 'survival') {
        const bx = Math.floor(this.x), by = Math.floor(this.y), bz = Math.floor(this.z);
        for (const [ox, oy, oz] of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,-1,0]]) {
          if (world.getBlock(bx + ox, by + oy, bz + oz) === Blocks.ID.CACTUS) {
            this.cactusTimer = (this.cactusTimer || 0) + dt;
            if (this.cactusTimer >= 0.5) { this.cactusTimer %= 0.5; this.damage(1, 'cactus'); }
            break;
          }
        }
      }

      // hunger / regen
      if (this.mode === 'survival') {
        const horizontalDistance = Math.hypot(this.vx, this.vz) * dt;
        if (this.isSprinting && horizontalDistance > 0) {
          this.exhaust += horizontalDistance * SURVIVAL.sprintExhaustionPerMeter;
        }
        if (inWater) {
          this.exhaust += Math.hypot(this.vx, this.vy, this.vz) * dt * SURVIVAL.swimExhaustionPerMeter;
        }
        for (const effect of this.statusEffects) {
          if (effect.type === 'hunger') this.exhaust += dt * 0.1 * Math.max(1, (effect.level || 0) + 1);
        }
        while (this.exhaust >= SURVIVAL.exhaustionThreshold) {
          this.exhaust -= SURVIVAL.exhaustionThreshold;
          if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
          else if (this.hunger > 0) this.hunger--;
        }

        if ((this.difficulty | 0) === 0) {
          this.hunger = 20;
          this.saturation = Math.max(this.saturation, 5);
        }
        if (this.hunger >= 20 && this.saturation > 0 && this.hp < this.maxHp) {
          this.regenTimer += dt;
          if (this.regenTimer >= SURVIVAL.fastRegenSeconds) {
            this.regenTimer %= SURVIVAL.fastRegenSeconds;
            const healed = Math.min(this.saturation, 6) / 6;
            this.hp = Math.min(this.maxHp, this.hp + healed);
            this.exhaust += healed * SURVIVAL.slowRegenExhaustion;
          }
        } else if (this.hunger >= 18 && this.hp < this.maxHp) {
          this.regenTimer += dt;
          if (this.regenTimer >= SURVIVAL.slowRegenSeconds) {
            this.regenTimer %= SURVIVAL.slowRegenSeconds;
            this.hp = Math.min(this.maxHp, this.hp + 1);
            this.exhaust += SURVIVAL.slowRegenExhaustion;
          }
        } else {
          this.regenTimer = 0;
        }
        if (this.hunger <= 0 && (this.difficulty | 0) > 0) {
          this.starveTimer += dt;
          const floor = Vanilla.starvationFloor(this.difficulty);
          if (this.starveTimer >= SURVIVAL.starvationSeconds) {
            this.starveTimer %= SURVIVAL.starvationSeconds;
            if (this.hp > floor) this.damage(1, 'starve');
          }
        } else this.starveTimer = 0;
      }

      // step sounds + view bob
      const hSpeed = Math.hypot(this.vx, this.vz);
      if (hSpeed > 0.05 && this.onGround && !this.flying && this.riding !== 'minecart') this.addStat('distanceWalked', hSpeed * dt);
      this.bobAmp = U.lerp(this.bobAmp, this.onGround && hSpeed > 0.5 ? Math.min(1, hSpeed / 5.6) : 0, Math.min(1, 10 * dt));
      if (this.onGround && !inWater && !inLava && !onLadder && hSpeed > 0.5) {
        this.bobPhase = (this.bobPhase + dt * hSpeed * 1.6) % 2;
        this.stepDist += hSpeed * dt;
        const stride = this.isSprinting ? 1.75 : this.isSneaking ? 2.7 : 2.1;
        if (this.stepDist > stride) {
          this.stepDist -= stride;
          const under = world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.3), Math.floor(this.z));
          if (under !== 0) {
            Sound.emit(blockSound(under, 'step'), {
              volume: this.isSneaking ? 0.18 : this.isSprinting ? 0.48 : 0.35,
              pitch: this.isSprinting ? 1.04 : 1,
            });
          }
        }
      }
      if (inWater && Math.hypot(this.vx, this.vy, this.vz) > 0.45) {
        this.swimSoundDist += Math.hypot(this.vx, this.vy, this.vz) * dt;
        if (this.swimSoundDist > 1.8) {
          this.swimSoundDist %= 1.8;
          Sound.emit('player.swim', { x: this.x, y: this.y + 0.7, z: this.z, volume: this.isSprinting ? 0.62 : 0.44 });
        }
      } else this.swimSoundDist = 0;
      if (onLadder && Math.abs(this.vy) > 0.2) {
        this.climbSoundDist += Math.abs(this.vy) * dt;
        if (this.climbSoundDist > 1.1) {
          this.climbSoundDist %= 1.1;
          Sound.emit('block.ladder.step', { x: this.x, y: this.y + 0.7, z: this.z, volume: 0.32 });
        }
      } else this.climbSoundDist = 0;

      if (this.y < -12) this.damage(1000, 'void');
      this.updateMining(dt, input);
    }

    canAutoJump(input, dx, dz) {
      if (!this.autoJumpEnabled || this.autoJumpCooldown > 0 || input.jump || input.sneak) return false;
      const ahead = 0.38;
      const ax = this.x + dx * ahead;
      const az = this.z + dz * ahead;
      const stepHeight = Physics.findStepHeight(this.world, this, ax, az, 1.05);
      if (stepHeight <= 0) return false;
      this._autoJumpStep = stepHeight;
      return true;
    }

    doAutoJump(dx, dz, speed) {
      this.vy = MOVE.jumpVelocity;
      const push = speed * 0.55;
      this.vx = dx * Math.max(Math.abs(this.vx), push);
      this.vz = dz * Math.max(Math.abs(this.vz), push);
      this.onGround = false;
      this.autoJumpCooldown = 0.28;
      this.exhaust += 0.03;
      Sound.emit('player.jump', { volume: 0.3, pitch: 1.03 });
    }

    // ---------- mining ----------
    breakTimeFor(id) {
      const def = Blocks.get(id);
      if (def.hardness < 0) return Infinity;
      if (def.hardness === 0) return 0.05;
      const tool = this.heldTool();
      let speed = 1;
      let effective = false;
      if (tool && def.tool && tool.type === def.tool) {
        speed = tool.speed;
        effective = true;
        const held = this.held();
        const efficiency = held && held.ench && held.ench.efficiency ? held.ench.efficiency : 0;
        if (efficiency > 0) speed += efficiency * efficiency + 1;
      }
      let t = def.hardness * 1.5 / speed;
      if (def.needsTool && (!effective || (tool && tool.tier < def.tier))) t = def.hardness * 5;
      if (Physics.headInLiquid(this.world, this, 'water')) t *= 5;
      if (!this.onGround) t *= 5;
      return t;
    }
    canHarvest(id) {
      const def = Blocks.get(id);
      if (!def.needsTool) return true;
      const tool = this.heldTool();
      return !!(tool && def.tool === tool.type && tool.tier >= def.tier);
    }
    updateMining(dt, input) {
      if (this.mode === 'creative') { this.mining = null; this.stopHandAction('mine'); return; }
      if (!input.mine) { this.mining = null; this.stopHandAction('mine'); return; }
      const hit = this.look(this.blockReach());
      if (!hit) { this.mining = null; this.stopHandAction('mine'); return; }
      const held = this.held();
      const toolId = held ? held.id : 0;
      if (!this.mining || this.mining.x !== hit.x || this.mining.y !== hit.y || this.mining.z !== hit.z ||
          this.mining.id !== hit.id || this.mining.toolId !== toolId) {
        const total = this.breakTimeFor(hit.id);
        if (total === Infinity) { this.mining = null; this.stopHandAction('mine'); return; }
        this.mining = {
          x: hit.x, y: hit.y, z: hit.z, progress: 0, total, id: hit.id,
          face: hit.face.slice(), toolId, sndT: 0,
        };
        if (typeof Network !== 'undefined' && Network.isConnected && Network.isConnected() && Network.startMining) {
          Network.startMining(hit.x, hit.y, hit.z, hit.id, total, {
            hotbar: this.hotbar,
            toolId,
            onGround: this.onGround,
            underwater: Physics.headInLiquid(this.world, this, 'water'),
          });
        }
        this.beginHandAction('mine', SWING_DURATION);
      }
      const m = this.mining;
      m.progress += dt;
      m.sndT -= dt;
      this.advanceLoopHandAction('mine', SWING_DURATION, dt);
      if (m.sndT <= 0) {
        m.sndT = 0.20;
        Sound.emit(blockSound(m.id, 'hit'), { x: m.x, y: m.y, z: m.z, volume: 0.35 });
        const def = Blocks.get(m.id);
        const tile = def.tex.all || def.tex.side || def.tex.top;
        if (tile && Entities.blockHitParticles) Entities.blockHitParticles(m.x, m.y, m.z, tile, m.face);
      }
      if (m.progress >= m.total) {
        this.finishBreak(m.x, m.y, m.z, m.id);
        this.mining = null;
      }
    }
    finishBreak(x, y, z, id) {
      const world = this.world;
      const def = Blocks.get(id);
      const state = world.getState(x, y, z);
      // chest/furnace contents drop
      if (world.getBE(x, y, z)) Entities.dropBE(world, x, y, z);
      world.setBlock(x, y, z, 0);
      this.addStat('blocksMined', 1);
      const tile = def.tex.all || def.tex.side || def.tex.top;
      if (tile) Entities.blockBreakParticles(x, y, z, tile);
      Sound.emit(blockSound(id, 'break'), { x, y, z, volume: 0.9, pitch: 0.9 });
      if (this.mode === 'survival') {
        const canHarvest = this.canHarvest(id);
        if (canHarvest && (id === Blocks.ID.STONE || id === Blocks.ID.COBBLE)) this.unlockAdvancement('mine_block');
        this.damageTool();
        this.exhaust += 0.005;
        const serverDrops = typeof Network !== 'undefined' && Network.isConnected && Network.isConnected();
        if (canHarvest && !serverDrops) {
          const drops = Blocks.dropsFor(id, state, () => this.world.random());
          for (const d of drops) Entities.spawnItem(x + 0.5, y + 0.3, z + 0.5, d.id, d.n);
        }
      }
      // gravity blocks above
      if (Blocks.get(world.getBlock(x, y + 1, z)).gravity) world.schedule(x, y + 1, z, 0.1, 'fall');
    }

    // instant creative break
    creativeBreak() {
      const hit = this.look(CREATIVE_BLOCK_REACH);
      if (!hit) return;
      if (this.world.getBE(hit.x, hit.y, hit.z)) Entities.dropBE(this.world, hit.x, hit.y, hit.z);
      this.world.setBlock(hit.x, hit.y, hit.z, 0);
      this.addStat('blocksMined', 1);
      const def = Blocks.get(hit.id);
      const tile = def.tex.all || def.tex.side || def.tex.top;
      if (tile) Entities.blockBreakParticles(hit.x, hit.y, hit.z, tile);
      Sound.emit(blockSound(hit.id, 'break'), { x: hit.x, y: hit.y, z: hit.z, volume: 0.8 });
      this.beginHandAction('attack', SWING_DURATION, false);
      if (Blocks.get(this.world.getBlock(hit.x, hit.y + 1, hit.z)).gravity) this.world.schedule(hit.x, hit.y + 1, hit.z, 0.1, 'fall');
    }

    // ---------- placing / using ----------
    setViewPosition(x, y, z) {
      this.viewX = x; this.viewY = y; this.viewZ = z;
    }
    resetViewPosition() {
      this.viewX = null; this.viewY = null; this.viewZ = null;
    }
    blockReach() { return this.mode === 'creative' ? CREATIVE_BLOCK_REACH : SURVIVAL_BLOCK_REACH; }
    look(dist, includeLiquids) {
      const d = this.lookDir();
      const x = this.viewX === null ? this.x : this.viewX;
      const y = this.viewY === null ? this.y : this.viewY;
      const z = this.viewZ === null ? this.z : this.viewZ;
      return this.world.raycast(x, y + this.eye, z, d[0], d[1], d[2], dist === undefined ? this.blockReach() : dist, includeLiquids);
    }
    lookDir() {
      const cp = Math.cos(this.pitch);
      return [Math.sin(this.yaw) * cp, -Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
    }

    lookEntity(dist) {
      const d = this.lookDir();
      const x = this.viewX === null ? this.x : this.viewX;
      const y = this.viewY === null ? this.y : this.viewY;
      const z = this.viewZ === null ? this.z : this.viewZ;
      const reach = dist === undefined ? ENTITY_REACH : dist;
      const hit = Entities.raycastEntity(x, y + this.eye, z, d[0], d[1], d[2], reach);
      if (!hit) return null;
      const block = this.world.raycast(x, y + this.eye, z, d[0], d[1], d[2], reach);
      return block && block.dist <= hit.dist ? null : hit;
    }

    useEntity() {
      if (this.useCooldown > 0) return true;
      const held = this.held();
      const hit = this.lookEntity(ENTITY_REACH);
      if (!held || !hit) return false;
      if (hit.entity.kind === 'wolf' && held.id === Items.IT.BONE) {
        const multiplayer = typeof Network !== 'undefined' && Network.isConnected();
        if (multiplayer) Network.interactEntity(hit.entity.id, 'tame');
        else {
          hit.entity.tamed = true;
          if (Entities.showLove) Entities.showLove(hit.entity);
          if (this.mode === 'survival') this.consumeHeld(1);
        }
        this.beginHandAction('use', 0.3); this.useCooldown = 0.35;
        return true;
      }
      if (hit.entity.kind === 'villager' && held.id === Items.IT.EMERALD) {
        const multiplayer = typeof Network !== 'undefined' && Network.isConnected();
        if (multiplayer) Network.interactEntity(hit.entity.id, 'trade');
        else {
          const offer = Entities.tradeOffer ? Entities.tradeOffer(hit.entity) : null;
          if (!offer) UI.toast('这名村民需要补货');
          else if (this.mode === 'creative' || this.consumeItem(Items.IT.EMERALD, offer.cost)) {
            const left = this.give(offer.id, offer.n);
            if (left > 0) Entities.spawnItem(this.x, this.y + 1, this.z, offer.id, left);
            if (Entities.recordVillagerTrade) Entities.recordVillagerTrade(hit.entity, this.world);
            if (Entities.showLove) Entities.showLove(hit.entity);
            const result = Items.get(offer.id);
            UI.toast('交易完成：' + offer.n + ' 个' + (result ? result.name : '物品'));
          } else UI.toast('绿宝石不足，需要 ' + offer.cost + ' 个');
        }
        this.beginHandAction('use', 0.3); this.useCooldown = 0.35;
        return true;
      }
      const food = { pig: Items.IT.CARROT, cow: Items.IT.WHEAT, sheep: Items.IT.WHEAT, chicken: Items.IT.WHEAT_SEEDS }[hit.entity.kind];
      if (food === held.id) {
        const multiplayer = typeof Network !== 'undefined' && Network.isConnected();
        const accepted = multiplayer ? Network.feedEntity(hit.entity.id) : Entities.feedAnimal(hit.entity, held.id);
        if (!accepted) return false;
        if (multiplayer && Entities.showLove) Entities.showLove(hit.entity);
        if (!multiplayer && this.mode === 'survival') this.consumeHeld(1);
        this.beginHandAction('use', 0.32);
        this.useCooldown = 0.35;
        return true;
      }
      if (held.id !== Items.IT.SHEARS || !Entities.shearSheep(hit.entity)) return false;
      if (this.mode === 'survival') this.damageTool();
      this.beginHandAction('use', 0.32);
      this.useCooldown = 0.35;
      return true;
    }

    replaceHeldWith(id) {
      if (this.mode === 'creative') return true;
      const stack = this.held();
      if (!stack) return false;
      stack.n--;
      if (stack.n <= 0) this.inv[this.hotbar] = Items.makeStack(id, 1);
      else {
        const left = this.give(id, 1);
        if (left > 0) Entities.spawnItem(this.x, this.y + 1, this.z, id, left);
      }
      return true;
    }

    enchantHeld(x, y, z) {
      if (typeof Network !== 'undefined' && Network.isConnected()) return Network.useStation('enchant', x, y, z);
      const stack = this.held();
      const item = stack ? Items.get(stack.id) : null;
      if (!item || !item.enchantable) { UI.toast('手持可附魔的工具、武器、盔甲或书'); return false; }
      if (item.enchantable === 'book' && stack.n !== 1) { UI.toast('请只手持一本书再进行附魔'); return false; }
      const current = stack.ench || {};
      const choices = [];
      if (item.armor) choices.push('protection', 'unbreaking');
      else if (item.bow) choices.push('power', 'unbreaking');
      else if (item.tool) {
        if (item.tool.type === 'sword') choices.push('sharpness', 'unbreaking');
        else choices.push('efficiency', 'unbreaking');
      } else choices.push('protection', 'sharpness', 'efficiency', 'power', 'unbreaking');
      const key = choices[Math.floor(this.world.random() * choices.length)];
      const oldLevel = current[key] || 0;
      if (oldLevel >= 3) { UI.toast('这件物品的附魔已达到当前上限'); return false; }
      const cost = U.clamp(oldLevel + 1, 1, 3);
      if (this.xpLevel < cost) { UI.toast('需要 ' + cost + ' 级经验'); return false; }
      if (this.countItem(Items.IT.LAPIS) < cost) { UI.toast('需要 ' + cost + ' 个青金石'); return false; }
      this.consumeItem(Items.IT.LAPIS, cost);
      this.xpLevel -= cost;
      this.xpProgress = 0;
      stack.ench = Object.assign({}, current, { [key]: oldLevel + 1 });
      const names = { protection: '保护', sharpness: '锋利', efficiency: '效率', power: '力量', unbreaking: '耐久' };
      UI.toast('附魔完成：' + names[key] + ' ' + (oldLevel + 1));
      Sound.play('pop', 0.8, 0.7);
      return true;
    }

    repairHeld(x, y, z) {
      if (typeof Network !== 'undefined' && Network.isConnected()) return Network.useStation('repair', x, y, z);
      const stack = this.held();
      const item = stack ? Items.get(stack.id) : null;
      const max = stack ? Items.durabilityOf(stack.id) : 0;
      const material = item && item.armor ? item.armor.repair : (item && item.repair ? item.repair : null);
      if (!stack || !max || stack.dur >= max) { UI.toast('手持一件需要修复的装备'); return false; }
      if (!material || this.countItem(material) < 1) { UI.toast('背包中缺少对应的修复材料'); return false; }
      if (this.xpLevel < 1) { UI.toast('修复需要 1 级经验'); return false; }
      this.consumeItem(material, 1);
      this.xpLevel--;
      this.xpProgress = 0;
      stack.dur = Math.min(max, stack.dur + Math.ceil(max * 0.25));
      UI.toast('铁砧修复完成');
      Sound.play('dig_stone', 0.75, 0.65);
      return true;
    }

    brewHeld(x, y, z) {
      if (typeof Network !== 'undefined' && Network.isConnected()) return Network.useStation('brew', x, y, z);
      const held = this.held();
      if (held && held.id === Items.IT.WATER_BOTTLE && this.countItem(Items.IT.NETHER_WART) > 0) {
        if (this.mode === 'survival') this.consumeItem(Items.IT.NETHER_WART, 1);
        this.inv[this.hotbar] = Items.makeStack(Items.IT.AWKWARD_POTION, 1);
        UI.toast('酿造完成：粗制的药水');
      } else if (held && held.id === Items.IT.AWKWARD_POTION && this.countItem(Items.IT.GLOWSTONE_DUST) > 0) {
        if (this.mode === 'survival') this.consumeItem(Items.IT.GLOWSTONE_DUST, 1);
        this.inv[this.hotbar] = Items.makeStack(Items.IT.HEALING_POTION, 1);
        UI.toast('酿造完成：治疗药水');
      } else {
        UI.toast('水瓶 + 下界疣，之后加入萤石粉');
        return false;
      }
      Sound.play('pop', 0.75, 0.8);
      return true;
    }

    useBlock() {
      // returns true if interaction consumed the click
      if (this.useCooldown > 0) return true;
      const hit = this.look(this.blockReach());
      if (!hit) return false;
      const ID = Blocks.ID;
      const held = this.held();
      const heldItem = held ? Items.get(held.id) : null;
      if (hit.id === ID.RAIL && heldItem && heldItem.minecart) {
        return this.mountMinecart(hit.x, hit.y, hit.z);
      }
      const bypassContainer = this.isSneaking && heldItem &&
        (heldItem.block || heldItem.bucket || heldItem.ignite || heldItem.plant || heldItem.bonemeal);
      // Vanilla workbench/furnace GUIs do not have an opening sound. Chests do,
      // and that sound belongs to the block in the world rather than the UI bus.
      if (!bypassContainer && hit.id === ID.CRAFTING) { UI.openCrafting(); this.useCooldown = 0.2; return true; }
      if (!bypassContainer && (hit.id === ID.FURNACE || hit.id === ID.FURNACE_LIT)) { UI.openFurnace(hit.x, hit.y, hit.z); this.useCooldown = 0.2; return true; }
      if (!bypassContainer && hit.id === ID.CHEST) {
        UI.openChest(hit.x, hit.y, hit.z);
        Sound.emit('container.chest.open', { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5, volume: 1 });
        this.useCooldown = 0.2;
        return true;
      }
      if (!bypassContainer && hit.id === ID.ENCHANTING_TABLE) {
        UI.openStation('enchant', hit.x, hit.y, hit.z); this.useCooldown = 0.2; return true;
      }
      if (!bypassContainer && hit.id === ID.ANVIL) {
        UI.openStation('repair', hit.x, hit.y, hit.z); this.useCooldown = 0.2; return true;
      }
      if (!bypassContainer && hit.id === ID.BREWING_STAND) {
        UI.openStation('brew', hit.x, hit.y, hit.z); this.useCooldown = 0.2; return true;
      }
      if (heldItem && heldItem.tool && heldItem.tool.type === 'hoe' &&
          (hit.id === ID.GRASS || hit.id === ID.DIRT || hit.id === ID.GRASS_SNOW) &&
          this.world.getBlock(hit.x, hit.y + 1, hit.z) === ID.AIR) {
        this.world.setBlock(hit.x, hit.y, hit.z, ID.FARMLAND);
        this.world.setState(hit.x, hit.y, hit.z, 0);
        this.world.schedule(hit.x, hit.y, hit.z, 1, 'farmland');
        if (this.mode === 'survival') this.damageTool();
        this.beginHandAction('use', 0.28); this.useCooldown = 0.25;
        Sound.emit('block.grass.hit', { x: hit.x, y: hit.y, z: hit.z, volume: 0.7, pitch: 0.85 });
        return true;
      }
      if (heldItem && heldItem.bonemeal && Blocks.get(hit.id).stateFamily === 'crop') {
        const stage = U.clamp(this.world.getState(hit.x, hit.y, hit.z) | 0, 0, 7);
        if (stage < 7) {
          this.world.setState(hit.x, hit.y, hit.z, Math.min(7, stage + 2 + Math.floor(this.world.random() * 3)));
          if (this.mode === 'survival') this.consumeHeld(1);
          this.beginHandAction('use', 0.24); this.useCooldown = 0.25;
          if (Entities.blockHitParticles) Entities.blockHitParticles(hit.x, hit.y, hit.z, Blocks.get(hit.id).tex.all, [0, 1, 0]);
          Sound.emit('block.foliage.hit', { x: hit.x, y: hit.y, z: hit.z, volume: 0.65, pitch: 1.2 });
        }
        return true;
      }
      if (heldItem && heldItem.ignite && hit.id === ID.TNT) {
        this.world.setBlock(hit.x, hit.y, hit.z, 0);
        if (typeof Network !== 'undefined' && Network.isConnected()) Network.spawnTNT(hit.x, hit.y, hit.z);
        else Entities.spawnTNT(this.world, hit.x, hit.y, hit.z);
        if (this.mode === 'survival') this.damageTool();
        this.beginHandAction('use', 0.24); this.useCooldown = 0.3;
        return true;
      }
      if (heldItem && heldItem.ignite) {
        const px = hit.x + hit.face[0], py = hit.y + hit.face[1], pz = hit.z + hit.face[2];
        const current = this.world.getBlock(px, py, pz);
        if ((current === ID.AIR || Blocks.get(current).replaceable) && Blocks.isSolid(this.world.getBlock(px, py - 1, pz))) {
          this.world.setBlock(px, py, pz, ID.FIRE);
          const portal = hit.id === ID.OBSIDIAN && this.world.tryCreateNetherPortal && this.world.tryCreateNetherPortal(px, py, pz);
          if (!portal) this.world.schedule(px, py, pz, 4 + this.world.random() * 5, 'fire');
          if (this.mode === 'survival') this.damageTool();
          this.beginHandAction('use', 0.24); this.useCooldown = 0.3;
          Sound.emit('fire.ambient', { x: px, y: py, z: pz, volume: 0.45, pitch: 1.35 });
          return true;
        }
      }
      if (hit.id === ID.END_PORTAL_FRAME && heldItem && heldItem.enderEye) {
        const state = this.world.getState(hit.x, hit.y, hit.z) | 0;
        if (!(state & 4)) {
          this.world.setState(hit.x, hit.y, hit.z, state | 4);
          if (this.mode === 'survival') this.consumeHeld(1);
          if (this.world.activateEndPortal) this.world.activateEndPortal(hit.x, hit.y, hit.z);
          this.beginHandAction('use', 0.24); this.useCooldown = 0.3;
          Sound.emit('item.equip', { x: hit.x, y: hit.y, z: hit.z, volume: 0.8, pitch: 0.65 });
        }
        return true;
      }
      if (hit.id === ID.OAK_DOOR || hit.id === ID.OAK_DOOR_TOP) {
        const lowerY = hit.id === ID.OAK_DOOR_TOP ? hit.y - 1 : hit.y;
        const next = (this.world.getState(hit.x, lowerY, hit.z) | 0) ^ 4;
        if (this.world.setDoorState) this.world.setDoorState(hit.x, lowerY, hit.z, next);
        else {
          this.world.setState(hit.x, lowerY, hit.z, next);
          this.world.setState(hit.x, lowerY + 1, hit.z, next);
        }
        this.beginHandAction('use', 0.2); this.useCooldown = 0.2;
        Sound.emit((next & 4) ? 'door.wood.open' : 'door.wood.close', { x: hit.x, y: lowerY, z: hit.z, volume: 0.75 });
        return true;
      }
      if (hit.id === ID.OAK_TRAPDOOR || hit.id === ID.OAK_FENCE_GATE) {
        const next = (this.world.getState(hit.x, hit.y, hit.z) | 0) ^ 4;
        this.world.setState(hit.x, hit.y, hit.z, next);
        this.beginHandAction('use', 0.2); this.useCooldown = 0.2;
        Sound.emit((next & 4) ? 'door.wood.open' : 'door.wood.close', { x: hit.x, y: hit.y, z: hit.z, volume: 0.7 });
        return true;
      }
      if (hit.id === ID.STONE_BUTTON) {
        this.world.setState(hit.x, hit.y, hit.z, 1);
        this.world.schedule(hit.x, hit.y, hit.z, 1, 'button');
        this.beginHandAction('use', 0.2); this.useCooldown = 0.2;
        Sound.emit('mechanism.click_on', { x: hit.x, y: hit.y, z: hit.z, volume: 0.65, pitch: 1.2 });
        return true;
      }
      if (hit.id === ID.OAK_SIGN) {
        if (UI.openSignEditor) UI.openSignEditor(hit.x, hit.y, hit.z);
        this.useCooldown = 0.2;
        return true;
      }
      if (hit.id === ID.LEVER) {
        const next = (this.world.getState(hit.x, hit.y, hit.z) | 0) === 1 ? 0 : 1;
        this.world.setState(hit.x, hit.y, hit.z, next);
        this.beginHandAction('use', 0.2); this.useCooldown = 0.2;
        Sound.emit(next ? 'mechanism.click_on' : 'mechanism.click_off', { x: hit.x, y: hit.y, z: hit.z, volume: 0.65 });
        return true;
      }
      if (hit.id === ID.BED) {
        if (typeof Network !== 'undefined' && Network.isConnected()) {
          Network.sleepAt(hit.x, hit.y, hit.z);
          this.useCooldown = 0.4;
          return true;
        }
        const t = this.world.timeOfDay;
        if (t > 0.72 || t < 0.22) {
          this.world.timeOfDay = 0.26;
          this.spawn = { x: this.x, y: this.y, z: this.z };
          UI.toast('已设置重生点,睡到天亮');
        } else {
          this.spawn = { x: this.x, y: this.y, z: this.z };
          UI.toast('已设置重生点(只能在夜间入睡)');
        }
        this.useCooldown = 0.4;
        return true;
      }
      return false;
    }

    mountMinecart(x, y, z) {
      if (this.riding === 'minecart') return true;
      if (this.world.getBlock(x, y, z) !== Blocks.ID.RAIL) return false;
      const stack = this.held();
      const item = stack ? Items.get(stack.id) : null;
      if (!item || !item.minecart) return false;
      if (typeof Network !== 'undefined' && Network.isConnected && Network.isConnected()) {
        if (!Network.mountMinecart(x, y, z)) return false;
        this.useCooldown = 0.35;
        return true;
      } else if (this.mode !== 'creative') {
        this.consumeHeld(1);
      }
      this.riding = 'minecart';
      this.x = x + 0.5; this.y = y + 0.01; this.z = z + 0.5;
      this.vx = this.vy = this.vz = 0;
      this.useCooldown = 0.35;
      Sound.emit('item.equip', { x:this.x, y:this.y, z:this.z, volume:0.65, pitch:0.72 });
      return true;
    }

    dismountMinecart() {
      if (this.riding !== 'minecart') return false;
      this.riding = null;
      this.vx *= 0.2; this.vz *= 0.2;
      if (typeof Network !== 'undefined' && Network.isConnected && Network.isConnected()) {
        if (Network.dismountMinecart) Network.dismountMinecart();
      } else if (this.mode !== 'creative') {
        const left = this.give(Items.IT.MINECART, 1);
        if (left) Entities.spawnItem(this.x, this.y + 0.5, this.z, Items.IT.MINECART, left);
      }
      return true;
    }

    placeBlock() {
      if (this.useCooldown > 0) return;
      const s = this.held();
      if (!s) return;
      const it = Items.get(s.id);
      if (!it) return;
      if (it.throwable === 'egg' || it.throwable === 'ender_pearl') {
        const direction = this.lookDir();
        const speed = 18;
        const multiplayer = typeof Network !== 'undefined' && Network.isConnected();
        if (multiplayer) {
          if (it.throwable === 'egg') Network.throwEgg(direction);
          else Network.throwEnderPearl(direction);
        } else {
          const spawn = it.throwable === 'egg' ? Entities.spawnEgg : Entities.spawnEnderPearl;
          if (spawn) spawn(
            this.x + direction[0] * 0.55,
            this.y + this.eye - 0.12 + direction[1] * 0.55,
            this.z + direction[2] * 0.55,
            direction[0] * speed, direction[1] * speed, direction[2] * speed
          );
        }
        if (this.mode === 'survival') this.consumeHeld(1);
        this.beginHandAction('use', 0.28);
        this.useCooldown = 0.25;
        Sound.emit(it.throwable + '.throw', { x: this.x, y: this.y + this.eye, z: this.z, volume: 0.5, pitch: it.throwable === 'egg' ? 1.08 : 0.94 });
        return;
      }
      if (it.bottle === 'empty') {
        const liquidHit = this.look(this.blockReach(), true);
        if (!liquidHit || liquidHit.id !== Blocks.ID.WATER) return;
        const multiplayer = typeof Network !== 'undefined' && Network.isConnected();
        if (multiplayer) Network.fillBottle(liquidHit.x, liquidHit.y, liquidHit.z);
        this.replaceHeldWith(Items.IT.WATER_BOTTLE);
        this.beginHandAction('use', 0.24); this.useCooldown = 0.25;
        Sound.emit('water.splash', { x: liquidHit.x, y: liquidHit.y, z: liquidHit.z, volume: 0.55, pitch: 1.15 });
        return;
      }
      if (it.bucket) {
        if (it.bucket === 'empty') {
          const liquidHit = this.look(this.blockReach(), true);
          if (!liquidHit || (liquidHit.id !== Blocks.ID.WATER && liquidHit.id !== Blocks.ID.LAVA)) return;
          const level = this.world.getState(liquidHit.x, liquidHit.y, liquidHit.z);
          if (Number.isInteger(level) && level > 0) return;
          const filled = liquidHit.id === Blocks.ID.WATER ? Items.IT.WATER_BUCKET : Items.IT.LAVA_BUCKET;
          this.world.setBlock(liquidHit.x, liquidHit.y, liquidHit.z, Blocks.ID.AIR);
          this.replaceHeldWith(filled);
          this.beginHandAction('use', 0.24); this.useCooldown = 0.25;
          Sound.emit('water.splash', { x: liquidHit.x, y: liquidHit.y, z: liquidHit.z, volume: 0.65, pitch: liquidHit.id === Blocks.ID.WATER ? 1 : 0.7 });
          return;
        }
        const hit = this.look(this.blockReach());
        if (!hit) return;
        const replaceHit = Blocks.get(hit.id).replaceable && !Blocks.get(hit.id).liquid;
        const px = replaceHit ? hit.x : hit.x + hit.face[0];
        const py = replaceHit ? hit.y : hit.y + hit.face[1];
        const pz = replaceHit ? hit.z : hit.z + hit.face[2];
        const current = this.world.getBlock(px, py, pz);
        if (current !== Blocks.ID.AIR && !Blocks.get(current).replaceable) return;
        const liquidId = it.bucket === 'water' ? Blocks.ID.WATER : Blocks.ID.LAVA;
        if (!this.world.placeFluidSource(px, py, pz, liquidId)) return;
        this.replaceHeldWith(Items.IT.BUCKET);
        this.beginHandAction('use', 0.24); this.useCooldown = 0.25;
        Sound.emit('water.splash', { x: px, y: py, z: pz, volume: 0.65, pitch: liquidId === Blocks.ID.WATER ? 1 : 0.7 });
        return;
      }
      if (it.plant) {
        const hit = this.look(this.blockReach());
        if (hit && hit.id === Blocks.ID.FARMLAND && hit.face[1] > 0 &&
            this.world.getBlock(hit.x, hit.y + 1, hit.z) === Blocks.ID.AIR) {
          this.world.setBlock(hit.x, hit.y + 1, hit.z, it.plant);
          this.world.setState(hit.x, hit.y + 1, hit.z, 0);
          this.world.schedule(hit.x, hit.y + 1, hit.z, 8 + this.world.random() * 10, 'crop');
          if (this.mode === 'survival') this.consumeHeld(1);
          this.beginHandAction('use', 0.24); this.useCooldown = 0.22;
          Sound.emit(blockSound(it.plant, 'place'), { x: hit.x, y: hit.y + 1, z: hit.z, volume: 0.45, pitch: 1.15 });
          return;
        }
      }
      // food
      if (it.food) { this.eat(it); return; }
      const placeId = it.block ? s.id : it.place;
      if (!Number.isInteger(placeId) || !Blocks.all[placeId]) return;
      const hit = this.look(this.blockReach());
      if (!hit) return;
      if ((placeId === Blocks.ID.PLANK_SLAB && hit.id === Blocks.ID.PLANK_SLAB) ||
          (placeId === Blocks.ID.STONE_SLAB && hit.id === Blocks.ID.STONE_SLAB)) {
        this.world.setBlock(hit.x, hit.y, hit.z, placeId === Blocks.ID.PLANK_SLAB ? Blocks.ID.PLANK_DOUBLE_SLAB : Blocks.ID.STONE_DOUBLE_SLAB);
        if (this.mode === 'survival') this.consumeHeld(1);
        this.beginHandAction('use', 0.24); this.useCooldown = 0.22;
        Sound.emit(blockSound(placeId, 'place'), { x: hit.x, y: hit.y, z: hit.z, volume: 0.6, pitch: 0.85 });
        return;
      }
      if (placeId === Blocks.ID.SNOW_LAYER && hit.id === Blocks.ID.SNOW_LAYER) {
        const layers = U.clamp(this.world.getState(hit.x, hit.y, hit.z) | 0, 0, 7);
        if (layers < 7) {
          this.world.setState(hit.x, hit.y, hit.z, layers + 1);
          if (this.mode === 'survival') this.consumeHeld(1);
          this.beginHandAction('use', 0.24); this.useCooldown = 0.22;
        }
        return;
      }
      const replaceHit = Blocks.get(hit.id).replaceable;
      const px = replaceHit ? hit.x : hit.x + hit.face[0];
      const py = replaceHit ? hit.y : hit.y + hit.face[1];
      const pz = replaceHit ? hit.z : hit.z + hit.face[2];
      const cur = this.world.getBlock(px, py, pz);
      if (!Blocks.get(cur).replaceable && cur !== 0) return;
      const def = Blocks.get(placeId);
      const placement = Blocks.placementFor(placeId, { face: hit.face, yaw: this.yaw, replaceHit });
      if (!placement.valid) return;
      const placingDoor = placeId === Blocks.ID.OAK_DOOR || placeId === Blocks.ID.IRON_DOOR;
      let placedState = placement.hasState ? placement.state : null;
      let doorPlacementInfo = null;
      if (placingDoor) {
        doorPlacementInfo = doorPlacement(this.world, px, py, pz, placeId, placedState === null ? 0 : placedState);
        placedState = doorPlacementInfo.state;
      }
      // no placing inside self
      if (def.solid) {
        const source = def.collisionBoxes;
        const shapes = source
          ? (typeof source === 'function' ? source(this.world, px, py, pz, placedState | 0) : source)
          : [def.collision || { x: 0, y: 0, z: 0, w: 1, h: 1, d: 1 }];
        const occupants = Entities.queryBox(px - 1, pz - 1, px + 2, pz + 2);
        for (const shape of shapes) {
          const box = { x: px + shape.x, y: py + shape.y, z: pz + shape.z, w: shape.w, h: shape.h, d: shape.d };
          if (U.aabbOverlap(U.entityBox(this.x, this.y, this.z, this.w, this.h), box)) return;
          for (const e of occupants) {
            if (e.dead || e.type === 'item') continue;
            if (U.aabbOverlap(U.entityBox(e.x, e.y, e.z, e.w, e.h), box)) return;
          }
        }
      }
      // ground requirement
      if (def.needsGround) {
        const below = this.world.getBlock(px, py - 1, pz);
        if (!Blocks.isSolid(below)) return;
        if ((placeId === Blocks.ID.SAPLING || placeId === Blocks.ID.TALLGRASS ||
             placeId === Blocks.ID.FLOWER_RED || placeId === Blocks.ID.FLOWER_YELLOW) &&
            !(below === Blocks.ID.GRASS || below === Blocks.ID.DIRT || below === Blocks.ID.GRASS_SNOW)) return;
        if (placeId === Blocks.ID.CACTUS && !(below === Blocks.ID.SAND || below === Blocks.ID.CACTUS)) return;
        if (placeId === Blocks.ID.SUGAR_CANE && below !== Blocks.ID.SUGAR_CANE) {
          if (!(below === Blocks.ID.GRASS || below === Blocks.ID.DIRT || below === Blocks.ID.SAND)) return;
          const nearWater = this.world.getBlock(px + 1, py - 1, pz) === Blocks.ID.WATER ||
            this.world.getBlock(px - 1, py - 1, pz) === Blocks.ID.WATER ||
            this.world.getBlock(px, py - 1, pz + 1) === Blocks.ID.WATER ||
            this.world.getBlock(px, py - 1, pz - 1) === Blocks.ID.WATER;
          if (!nearWater) return;
        }
      }
      const placingSign = placeId === Blocks.ID.OAK_SIGN;
      const supportOffset = Blocks.supportOffset(placeId, placement.state);
      if (supportOffset && supportOffset[1] === 0 &&
          !Blocks.isSolid(this.world.getBlock(px + supportOffset[0], py, pz + supportOffset[2]))) return;
      if (supportOffset && supportOffset[1] < 0 && !def.needsGround &&
          !Blocks.isSolid(this.world.getBlock(px, py - 1, pz))) return;
      if (py < 1 || py >= World.CH_H) return;
      if (placingDoor) {
        const upper = this.world.getBlock(px, py + 1, pz);
        if (py + 1 >= World.CH_H || (upper !== Blocks.ID.AIR && !Blocks.get(upper).replaceable)) return;
      }
      this.world.setBlock(px, py, pz, placeId);
      this.addStat('blocksPlaced', 1);
      if (!placingDoor && placement.hasState) {
        this.world.setState(px, py, pz, placement.state);
        placedState = placement.state;
      }
      if (placingDoor) {
        this.world.setBlock(px, py + 1, pz, placeId === Blocks.ID.IRON_DOOR ? Blocks.ID.IRON_DOOR_TOP : Blocks.ID.OAK_DOOR_TOP);
        if (this.world.setDoorState) this.world.setDoorState(px, py, pz, placedState);
        else {
          this.world.setState(px, py, pz, placedState);
          this.world.setState(px, py + 1, pz, placedState);
        }
        const pair = doorPlacementInfo && doorPlacementInfo.pair;
        if (pair && this.world.doorInfo && this.world.doorInfo(pair.x, py, pair.z)) {
          const pairState = ((pair.state | 0) & 4) | (placedState & 3) | (pair.rightHinge ? 8 : 0);
          this.world.setDoorState(pair.x, py, pair.z, pairState);
        }
      }
      if (placeId === Blocks.ID.REDSTONE_WIRE || placeId === Blocks.ID.STONE_BUTTON || placeId === Blocks.ID.STONE_PRESSURE_PLATE) this.world.setState(px, py, pz, 0);
      if (placeId === Blocks.ID.SNOW_LAYER) this.world.setState(px, py, pz, 0);
      if (placeId === Blocks.ID.CHEST) this.world.setBE(px, py, pz, { type: 'chest', slots: makeSlots(27) });
      if (placeId === Blocks.ID.FURNACE) this.world.setBE(px, py, pz, { type: 'furnace', slots: makeSlots(3), burn: 0, burnMax: 0, cook: 0, xpStored: 0 });
      if (placeId === Blocks.ID.OAK_SIGN) {
        const firstLine = s.name ? Array.from(String(s.name)).slice(0, 15).join('') : '';
        this.world.setBE(px, py, pz, { type: 'sign', lines: [firstLine, '', '', ''] });
      }
      if (placeId === Blocks.ID.SAPLING) this.world.schedule(px, py, pz, 20 + this.world.random() * 30, 'grow');
      if (placeId === Blocks.ID.SUGAR_CANE) this.world.schedule(px, py, pz, 20 + this.world.random() * 20, 'cane');
      if (def.gravity && !Blocks.isSolid(this.world.getBlock(px, py - 1, pz))) this.world.schedule(px, py, pz, 0.1, 'fall');
      Sound.emit(blockSound(placeId, 'place'), { x: px, y: py, z: pz, volume: 0.65, pitch: 0.82 });
      if (this.mode === 'survival') this.consumeHeld(1);
      this.beginHandAction('use', 0.24);
      this.useCooldown = 0.22;
      if (placeId === Blocks.ID.OAK_SIGN && UI.openSignEditor) UI.openSignEditor(px, py, pz);
    }

    eat(it) {
      if (this.hunger >= 20 && !it.food.alwaysEat) return;
      if (this.eatTimer === undefined || this.eatTimer <= 0) this.eatTimer = 1.2;
    }
    updateEating(dt, input) {
      const s = this.held();
      const it = s ? Items.get(s.id) : null;
      if (input.use && it && it.food && (this.hunger < 20 || it.food.alwaysEat) && !this.dead) {
        this.eatTimer = (this.eatTimer === undefined ? 1.2 : this.eatTimer) - dt;
        if ((this.eatTimer * 4 | 0) !== (((this.eatTimer + dt) * 4) | 0)) Sound.emit('player.eat_bite', { volume: 0.6 });
        this.advanceLoopHandAction('eat', 0.4, dt);
        if (this.eatTimer <= 0) {
          const multiplayer = typeof Network !== 'undefined' && Network.isConnected && Network.isConnected();
          if (multiplayer && Network.eatHeld) {
            Network.eatHeld(s.id);
          } else {
            this.hunger = Math.min(20, this.hunger + it.food.hunger);
            const saturation = it.food.saturation === undefined ? it.food.hunger * 0.6 : it.food.saturation;
            this.saturation = Math.min(this.hunger, this.saturation + saturation);
            if (it.food.risky && this.world.random() < (it.food.riskChance === undefined ? 0.5 : it.food.riskChance)) {
              this.addStatus('hunger', 30, 0);
              UI.toast('获得状态：饥饿');
            }
            for (const effect of it.food.effects || []) this.addStatus(effect.type, effect.duration, effect.level || 0);
            if (it.returns) this.replaceHeldWith(it.returns);
            else this.consumeHeld(1);
          }
          Sound.emit('player.eat_finish', { volume: 0.9, pitch: 0.92 });
          this.eatTimer = 1.2;
        }
      } else {
        this.eatTimer = 1.2;
        this.stopHandAction('eat');
      }
    }

    cancelUseActions() {
      this.bowCharge = 0;
      this.fishingTimer = 0;
      this.setBlocking(false);
      if (this.handAction === 'bow' || this.handAction === 'fish') this.stopHandAction(this.handAction);
    }

    updateUseActions(dt, input) {
      const stack = this.held();
      const item = stack ? Items.get(stack.id) : null;
      const shield = this.canUseShield() ? this.shieldStack() : null;
      if (shield) {
        if (input.use && !this.dead) {
          this.setBlocking(true);
          if (this.handAction === 'idle') this.beginHandAction('block', 1);
          if (this.handAction === 'block') this.handActionTime = Math.min(1, this.handActionTime + dt);
          if (this.handAction === 'block') this.swing = 0;
          return;
        }
        this.setBlocking(false);
      } else {
        this.setBlocking(false);
      }
      if (item && item.bow) {
        const hasArrow = this.mode === 'creative' || this.countItem(Items.IT.ARROW) > 0;
        if (input.use && hasArrow && !this.dead) {
          if (this.bowCharge === 0) Sound.emit('bow.draw', { volume: 0.42 });
          this.bowCharge = Math.min(1, this.bowCharge + dt);
          this.handAction = 'bow';
          this.handActionDuration = 1;
          this.handActionTime = this.bowCharge;
          this.swing = 1 - this.bowCharge;
          return;
        }
        if (this.bowCharge > 0) {
          const charge = this.bowCharge;
          this.bowCharge = 0;
          this.stopHandAction('bow');
          if (charge >= 0.1 && hasArrow) {
            const draw = U.clamp((charge * charge + charge * 2) / 3, 0, 1);
            const dir = this.lookDir();
            const powerLevel = stack.ench && stack.ench.power ? stack.ench.power : 0;
            const velocity = 8 + draw * 22;
            const damage = (2 + draw * 4) * (1 + powerLevel * 0.25);
            const multiplayer = typeof Network !== 'undefined' && Network.isConnected();
            if (multiplayer) {
              Network.fireArrow(dir, charge);
              if (this.mode === 'survival') { this.consumeItem(Items.IT.ARROW, 1); this.damageTool(); }
            } else {
              Entities.spawnArrow(
                this.x + dir[0] * 0.55, this.y + this.eye - 0.12 + dir[1] * 0.55, this.z + dir[2] * 0.55,
                dir[0] * velocity, dir[1] * velocity, dir[2] * velocity, damage
              );
              if (this.mode === 'survival') { this.consumeItem(Items.IT.ARROW, 1); this.damageTool(); }
            }
            Sound.emit('bow.release', { x: this.x, y: this.y + this.eye, z: this.z, volume: 0.65, pitch: 0.82 + draw * 0.28 });
            this.useCooldown = 0.18;
          }
        }
        return;
      }
      if (this.bowCharge > 0) this.cancelUseActions();

      if (item && item.fishing) {
        const liquid = this.look(20, true);
        const lookingAtWater = liquid && liquid.id === Blocks.ID.WATER;
        if (input.use && lookingAtWater && !this.dead) {
          if (this.fishingTimer === 0) Sound.emit('fishing.cast', { x: this.x, y: this.y + this.eye, z: this.z, volume: 0.44 });
          this.fishingTimer += dt;
          this.handAction = 'fish';
          this.handActionDuration = 2.5;
          this.handActionTime = Math.min(2.5, this.fishingTimer);
          if (this.fishingTimer >= 2.5) {
            this.fishingTimer = 0;
            this.stopHandAction('fish');
            const left = this.give(Items.IT.FISH_RAW, 1);
            if (left > 0) Entities.spawnItem(this.x, this.y + 1, this.z, Items.IT.FISH_RAW, left);
            if (this.mode === 'survival') this.damageTool();
            UI.itemPicked('钓到了生鱼');
            Sound.emit('fishing.catch', { x: this.x, y: this.y + 1, z: this.z, volume: 0.7 });
            this.useCooldown = 0.45;
          }
          return;
        }
      }
      if (this.fishingTimer > 0) this.cancelUseActions();
    }

    attack() {
      // melee entity attack; returns true if hit entity
      const charge = this.consumeAttackCharge();
      this.beginHandAction('attack', SWING_DURATION, false);
      Sound.emit('combat.swing', { volume: 0.34 });
      const hit = this.lookEntity(ENTITY_REACH);
      if (!hit) return false;
      const tool = this.heldTool();
      let dmg = this.mode === 'creative' ? 10 : (tool ? tool.damage : 1);
      const held = this.held();
      const sharpness = held && held.ench && held.ench.sharpness ? held.ench.sharpness : 0;
      dmg += Vanilla.sharpnessBonus(sharpness);
      if (this.mode !== 'creative') dmg *= Vanilla.attackScale(charge);
      const critical = this.mode === 'survival' && !this.onGround && this.vy < -0.05 &&
        charge > 0.9 && !this.isSprinting && !this.flying &&
        !Physics.headInLiquid(this.world, this, 'water') && !Physics.touchesBlock(this.world, this, Blocks.ID.LADDER);
      if (critical) dmg *= 1.5;
      const sprintHit = this.isSprinting && charge > 0.9;
      const accepted = Entities.hurtMob(this.world, hit.entity, dmg, this.x, this.z, sprintHit ? 1.45 : 1);
      if (!accepted) return false;
      const sweep = tool && tool.type === 'sword' && charge > 0.9 && this.onGround && !sprintHit;
      if (sweep) {
        const nearby = Entities.queryBox(hit.entity.x - 1, hit.entity.z - 1, hit.entity.x + 1, hit.entity.z + 1);
        let swept = 0;
        for (const entity of nearby) {
          if (entity === hit.entity || entity.dead || entity.type !== 'mob' || Math.abs(entity.y - this.y) > 0.25) continue;
          if (Entities.hurtMob(this.world, entity, 1, this.x, this.z, 0.4)) {
            swept++;
            if (Entities.entityHitParticles) Entities.entityHitParticles(entity, false);
          }
        }
        if (swept > 0) Sound.emit('combat.sweep', { volume: 0.72 });
      } else if (charge > 0.9 && !critical) {
        Sound.emit('combat.strong', { volume: 0.62 });
      }
      if (tool && this.mode === 'survival') this.damageTool(tool.type === 'sword' ? 1 : 2);
      if (sprintHit) this.isSprinting = false;
      this.exhaust += SURVIVAL.attackExhaustion;
      if (critical) Sound.emit('combat.critical', { volume: 0.8 });
      if (Entities.entityHitParticles) Entities.entityHitParticles(hit.entity, critical);
      if (UI.hit) UI.hit(critical);
      return true;
    }

    attackInterval() {
      const held = this.held();
      const item = held ? Items.get(held.id) : null;
      const speed = item && item.tool && item.tool.attackSpeed ? item.tool.attackSpeed : 4;
      return 1 / Math.max(0.1, speed);
    }
    attackStrength() { return U.clamp(this.attackCharge, 0, 1); }
    consumeAttackCharge() {
      const strength = this.attackStrength();
      this.attackCharge = 0;
      return strength;
    }

    damage(n, cause, source) {
      if (this.dead || this.mode === 'creative') return;
      if (this.hurtTime > 0 && cause !== 'void' && cause !== 'starve') return;
      const blocked = this.blocksDamage(cause, source);
      const rawDamage = n;
      if (blocked) {
        if (rawDamage >= 3) this.damageShield(1 + Math.floor(rawDamage));
        n = 0;
      }
      if (cause === 'mob' || cause === 'explode' || cause === 'cactus' || cause === 'arrow' || cause === 'lava' || cause === 'fire') {
        let protection = 0;
        for (const stack of this.equipment) if (stack && stack.ench && stack.ench.protection) protection += stack.ench.protection;
        if (!blocked) {
          n = Vanilla.applyArmor(n, this.armor, this.armorToughness);
          n = Vanilla.applyProtection(n, protection);
          if (this.armor > 0) this.damageArmor(rawDamage);
        }
      }
      this.hp -= n;
      this.hurtTime = blocked ? 0.3 : 0.5;
      if (blocked) this.blockHitFeedback();
      else Sound.emit('player.hurt', { volume: 0.9 });
      if (this.hp <= 0) {
        this.hp = 0;
        this.dead = true;
        this.setBlocking(false);
        Sound.emit('player.death', { volume: 1 });
        if (typeof Network !== 'undefined' && Network.isConnected()) {
          Network.reportDeath(cause || '死亡');
          if (UI.onDeath) UI.onDeath(cause);
          return;
        }
        if (UI.dropTransientItems) UI.dropTransientItems(this);
        // drop inventory
        for (let i = 0; i < 36; i++) {
          const s = this.inv[i];
          if (s) {
            Entities.spawnItem(this.x, this.y + 1, this.z, s.id, s.n, undefined, undefined, undefined, s);
          }
          this.inv[i] = null;
        }
        for (let i = 0; i < this.equipment.length; i++) {
          const s = this.equipment[i];
          if (s) Entities.spawnItem(this.x, this.y + 1, this.z, s.id, s.n, undefined, undefined, undefined, s);
          this.equipment[i] = null;
        }
        if (this.offhand) {
          Entities.spawnItem(this.x, this.y + 1, this.z, this.offhand.id, this.offhand.n,
            undefined, undefined, undefined, this.offhand);
          this.offhand = null;
        }
        this.updateArmorValue();
        if (UI.onDeath) UI.onDeath(cause);
      }
    }

    addStat(name, amount) {
      if (!this.stats || typeof this.stats !== 'object') this.stats = {};
      const next = Math.max(0, Number(this.stats[name]) || 0) + (Number(amount) || 0);
      this.stats[name] = next;
      return next;
    }

    unlockAdvancement(id) {
      if (!id) return false;
      if (!this.advancements || typeof this.advancements !== 'object') this.advancements = {};
      if (this.advancements[id]) return false;
      this.advancements[id] = Date.now();
      const names = { mine_block: '石器时代', craft_item: '工作台制作者', kill_mob: '怪物猎人' };
      if (typeof UI !== 'undefined' && UI.advancement) UI.advancement(names[id] || id);
      return true;
    }

    resetRespawnState(position) {
      const target = position || this.spawn;
      if (target && Number.isFinite(+target.x)) this.x = +target.x;
      if (target && Number.isFinite(+target.y)) this.y = +target.y;
      if (target && Number.isFinite(+target.z)) this.z = +target.z;
      this.vx = this.vy = this.vz = 0;
      this.onGround = false;
      this.flying = false;
      if (Physics.resolvePenetration) Physics.resolvePenetration(this.world, this, 4);
      if (Physics.supportCount) this.onGround = Physics.supportCount(this.world, this, this.x, this.y, this.z) > 0;
      this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
      this.resetViewPosition();

      this.dead = false;
      this.fallStart = null;
      this.mining = null;
      this.lastMiningResponse = null;
      this.isSprinting = false;
      this.isSneaking = false;
      this.isBlocking = false;
      this.shieldDisabledTime = 0;
      this.riding = null;
      this.blockBlend = 0;
      this.blockHitTime = 0;
      this.handAction = 'idle';
      this.handActionTime = 0;
      this.swing = 0;
      this.equipTime = 0;
      this.useCooldown = 0;
      this.attackCharge = 1;
      this.hurtTime = 0;
      this.bowCharge = 0;
      this.fishingTimer = 0;
      this.eatTimer = 0;
      this.autoJumpCooldown = 0;
      this.regenTimer = 0;
      this.starveTimer = 0;
      this.drownTimer = 0;
      this.lavaTimer = 0;
      this.fireTicks = 0;
      this.exhaust = 0;
      this.stepDist = 0;
      this.swimSoundDist = 0;
      this.climbSoundDist = 0;
      this.bobPhase = 0;
      this.bobAmp = 0;
      this.portalCooldown = 0;
      this._plateRefresh = 0;
      this._wasInWater = false;
      const held = this.held();
      this._heldAnimId = held ? held.id : 0;
      this._offhandAnimId = this.offhand ? this.offhand.id : 0;
    }

    respawn() {
      this.hp = this.maxHp;
      this.hunger = 20; this.saturation = 5; this.air = this.maxAir;
      this.statusEffects = [];
      this.resetRespawnState(this.spawn);
    }

    serialize() {
      return {
        x: this.x, y: this.y, z: this.z,
        yaw: Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw)),
        pitch: U.clamp(this.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01),
        hp: this.hp, hunger: this.hunger, saturation: this.saturation, mode: this.mode, hotbar: this.hotbar,
        inv: this.inv, equipment: this.equipment, offhand: this.offhand, cursor: this.cursor, spawn: this.spawn, flying: this.flying,
        armor: this.armor, xpLevel: this.xpLevel, xpProgress: this.xpProgress, statusEffects: this.statusEffects,
        stats: this.stats, advancements: this.advancements,
      };
    }
    deserialize(d) {
      if (!d) return;
      this.x = d.x; this.y = d.y; this.z = d.z;
      this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
      this.resetViewPosition();
      this.autoJumpCooldown = 0;
      const yaw = Number.isFinite(+d.yaw) ? +d.yaw : 0;
      const pitch = Number.isFinite(+d.pitch) ? +d.pitch : 0;
      this.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      this.pitch = U.clamp(pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      this.hp = d.hp !== undefined ? d.hp : 20;
      this.hunger = d.hunger !== undefined ? d.hunger : 20;
      this.saturation = d.saturation !== undefined ? d.saturation : Math.min(5, this.hunger);
      this.xpLevel = d.xpLevel || 0;
      this.xpProgress = U.clamp(d.xpProgress || 0, 0, 1);
      this.statusEffects = Array.isArray(d.statusEffects) ? d.statusEffects.filter(e => e && typeof e.type === 'string' && e.time > 0) : [];
      if (d.stats && typeof d.stats === 'object') this.stats = Object.assign(this.stats, d.stats);
      if (d.advancements && typeof d.advancements === 'object') this.advancements = Object.assign({}, d.advancements);
      this.mode = d.mode || 'survival';
      this.hotbar = d.hotbar || 0;
      this.flying = !!d.flying;
      if (d.spawn) this.spawn = d.spawn;
      if (d.inv) for (let i = 0; i < 36; i++) this.inv[i] = d.inv[i] || null;
      this.cursor = d.cursor && Items.get(d.cursor.id) ? d.cursor : null;
      if (Array.isArray(d.equipment)) for (let i = 0; i < 4; i++) {
        const stack = d.equipment[i] || null;
        const item = stack ? Items.get(stack.id) : null;
        this.equipment[i] = item && item.armor && item.armor.slot === i ? stack : null;
      }
      this.offhand = d.offhand && Items.get(d.offhand.id) ? d.offhand : null;
      this.updateArmorValue();
    }
  }

  window.Player = Player;
})();
