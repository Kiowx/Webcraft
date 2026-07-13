/* ui.js — HUD (hotbar/hearts/hunger), inventory & crafting & furnace & chest windows,
   pause / death / main menus, toasts. Canvas 2D overlay + DOM. */
'use strict';
(function () {
  const UI = {};
  let hud, hctx;            // HUD canvas
  let nicknameInput = null;
  let chatInput = null;
  let signEditor = null;
  let signInput = null;
  let signDone = null;
  let chatOpen = false;
  let playerListVisible = false;
  const chatMessages = [];
  let game = null;          // set by main
  let win = null;           // current window: null | {type:'inventory'|'crafting'|'furnace'|'chest', ...}
  let toastMsg = null, toastT = 0;
  let hitT = 0, criticalHit = false;
  let GUI = 2;
  let S = 36;               // 18px vanilla slot scaled by GUI
  let hoverSlot = null;
  let mouseX = 0, mouseY = 0;
  let guiAtlas = null;
  const guiSprites = {};
  let containerAtlas = null;
  const containerRects = {};
  let menuPanorama = null;
  let menuDirt = null;
  let guiResourcePack = 'default';
  let originalGuiImages = null;
  let originalGuiLoad = null;
  const ORIGINAL_GUI_FILES = Object.freeze({
    icons: 'assets/minecraft-1.12.2/extracted/assets/minecraft/textures/gui/icons.png',
    widgets: 'assets/minecraft-1.12.2/extracted/assets/minecraft/textures/gui/widgets.png',
  });
  const ORIGINAL_GUI_SPRITES = Object.freeze({
    crosshair: { asset:'icons', x:0, y:0, w:15, h:15 },
    heart_empty: { asset:'icons', x:16, y:0, w:9, h:9 },
    heart_full: { asset:'icons', x:52, y:0, w:9, h:9 },
    heart_half: { asset:'icons', x:61, y:0, w:9, h:9 },
    armor_empty: { asset:'icons', x:16, y:9, w:9, h:9 },
    armor_half: { asset:'icons', x:25, y:9, w:9, h:9 },
    armor_full: { asset:'icons', x:34, y:9, w:9, h:9 },
    air: { asset:'icons', x:16, y:18, w:9, h:9 },
    food_empty: { asset:'icons', x:16, y:27, w:9, h:9 },
    food_full: { asset:'icons', x:52, y:27, w:9, h:9 },
    food_half: { asset:'icons', x:61, y:27, w:9, h:9 },
    xp_bg: { asset:'icons', x:0, y:64, w:182, h:5 },
    xp_fill: { asset:'icons', x:0, y:69, w:182, h:5 },
    hotbar: { asset:'widgets', x:0, y:0, w:182, h:22 },
    selector: { asset:'widgets', x:0, y:22, w:24, h:24 },
    button: { asset:'widgets', x:0, y:66, w:200, h:20 },
    button_hover: { asset:'widgets', x:0, y:86, w:200, h:20 },
  });
  let dragState = null;
  let cursorOrigin = null;
  let lastClick = { at: 0, id: 0 };
  let heldNameId = 0, heldNameT = 0;
  let slotPulseKey = '', slotPulseT = 0;
  let pickupMsg = '', pickupT = 0;
  let profileCommitTransaction = 0;
  let craftTransaction = null;
  let guiScaleMode = 'auto';
  let menuStack = [];
  let menuFocus = 0;
  const itemIconCache = new Map();
  const unicodeTextCache = new Map();
  const signTextCache = new Map();
  let signCacheWorld = null;
  let signCacheVersion = -1;
  let signEntities = [];
  const UI_FONT = '"Microsoft YaHei", "Microsoft YaHei UI", "Noto Sans CJK SC", "PingFang SC", "SimSun", sans-serif';
  const UNICODE_RASTER_SCALE = 2;
  const PLAYER_PREVIEW_BASE_YAW = Math.PI + 0.35;
  let slotLayoutCacheKey = '';
  let slotLayoutCache = [];
  const BITMAP_FONT = {
    '0':['01110','10001','10011','10101','11001','10001','01110'], '1':['00100','01100','00100','00100','00100','00100','01110'],
    '2':['01110','10001','00001','00010','00100','01000','11111'], '3':['11110','00001','00001','01110','00001','00001','11110'],
    '4':['00010','00110','01010','10010','11111','00010','00010'], '5':['11111','10000','10000','11110','00001','00001','11110'],
    '6':['01110','10000','10000','11110','10001','10001','01110'], '7':['11111','00001','00010','00100','01000','01000','01000'],
    '8':['01110','10001','10001','01110','10001','10001','01110'], '9':['01110','10001','10001','01111','00001','00001','01110'],
    'A':['01110','10001','10001','11111','10001','10001','10001'], 'B':['11110','10001','10001','11110','10001','10001','11110'],
    'C':['01111','10000','10000','10000','10000','10000','01111'], 'D':['11110','10001','10001','10001','10001','10001','11110'],
    'E':['11111','10000','10000','11110','10000','10000','11111'], 'F':['11111','10000','10000','11110','10000','10000','10000'],
    'G':['01111','10000','10000','10111','10001','10001','01111'], 'H':['10001','10001','10001','11111','10001','10001','10001'],
    'I':['11111','00100','00100','00100','00100','00100','11111'], 'J':['00111','00010','00010','00010','10010','10010','01100'],
    'K':['10001','10010','10100','11000','10100','10010','10001'], 'L':['10000','10000','10000','10000','10000','10000','11111'],
    'M':['10001','11011','10101','10101','10001','10001','10001'], 'N':['10001','11001','10101','10011','10001','10001','10001'],
    'O':['01110','10001','10001','10001','10001','10001','01110'], 'P':['11110','10001','10001','11110','10000','10000','10000'],
    'Q':['01110','10001','10001','10001','10101','10010','01101'], 'R':['11110','10001','10001','11110','10100','10010','10001'],
    'S':['01111','10000','10000','01110','00001','00001','11110'], 'T':['11111','00100','00100','00100','00100','00100','00100'],
    'U':['10001','10001','10001','10001','10001','10001','01110'], 'V':['10001','10001','10001','10001','10001','01010','00100'],
    'W':['10001','10001','10001','10101','10101','10101','01010'], 'X':['10001','10001','01010','00100','01010','10001','10001'],
    'Y':['10001','10001','01010','00100','00100','00100','00100'], 'Z':['11111','00001','00010','00100','01000','10000','11111'],
    '.':['00000','00000','00000','00000','00000','00110','00110'], ':':['00000','00110','00110','00000','00110','00110','00000'],
    '-':['00000','00000','00000','11111','00000','00000','00000'], '/':['00001','00010','00010','00100','01000','01000','10000'],
    '+':['00000','00100','00100','11111','00100','00100','00000'], ' ':['00000','00000','00000','00000','00000','00000','00000'],
  };

  UI.init = function (g, hudCanvas) {
    game = g;
    hud = hudCanvas;
    hctx = hud.getContext('2d');
    nicknameInput = document.getElementById('nickname-input');
    chatInput = document.getElementById('chat-input');
    signEditor = document.getElementById('sign-editor');
    signInput = document.getElementById('sign-input');
    signDone = document.getElementById('sign-done');
    hctx.imageSmoothingEnabled = false;
    try {
      const savedScale = localStorage.getItem('webcraft_gui_scale');
      if (savedScale === 'auto' || savedScale === '1' || savedScale === '2' || savedScale === '3') guiScaleMode = savedScale;
    } catch (e) { /* storage unavailable */ }
    buildGuiAtlas();

    hud.addEventListener('mousemove', (e) => {
      setMouseFromEvent(e);
      if (win && dragState) dragOverCurrentSlot();
      else if (UI.isMenuOpen()) UI.controlAt(hud.width, hud.height, mouseX, mouseY);
    });
    hud.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') return;
      setMouseFromEvent(e);
      if (win && dragState) dragOverCurrentSlot();
    });
    hud.addEventListener('mousedown', (e) => {
      setMouseFromEvent(e);
      if (!win) return;
      e.preventDefault();
      onWindowClick(e.button, e.shiftKey);
    });
    hud.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || !win) return;
      setMouseFromEvent(e);
      e.preventDefault();
      onWindowClick(0, false);
    });
    document.addEventListener('mouseup', finishDrag);
    document.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') finishDrag(e);
    });
    hud.addEventListener('contextmenu', (e) => e.preventDefault());
    hud.addEventListener('wheel', (e) => {
      if (!win || win.type !== 'creative') return;
      e.preventDefault();
      const pages = Math.max(1, Math.ceil(win.catalog.length / 45));
      win.page = U.mod(win.page + (e.deltaY > 0 ? 1 : -1), pages);
      slotLayoutCacheKey = '';
      Sound.play('click', 0.25, 1.2);
    }, { passive: false });

    if (nicknameInput) {
      const stop = (e) => e.stopPropagation();
      nicknameInput.addEventListener('mousedown', stop);
      nicknameInput.addEventListener('mouseup', stop);
      nicknameInput.addEventListener('pointerdown', stop);
      nicknameInput.addEventListener('click', stop);
      nicknameInput.addEventListener('keyup', stop);
      nicknameInput.addEventListener('keypress', stop);
      nicknameInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.isComposing || e.keyCode === 229) return;
        if (e.code === 'Enter') {
          e.preventDefault();
          const name = UI.nicknameValue();
          if (typeof UI.onNicknameSubmit === 'function') UI.onNicknameSubmit(name);
        } else if (e.code === 'Escape') {
          e.preventDefault();
          UI.backScreen();
        }
      });
      nicknameInput.addEventListener('blur', () => UI.nicknameValue());
    }
    if (chatInput) {
      const stop = (e) => e.stopPropagation();
      for (const type of ['mousedown', 'mouseup', 'pointerdown', 'click', 'keyup', 'keypress']) chatInput.addEventListener(type, stop);
      chatInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.isComposing || e.keyCode === 229) return;
        if (e.code === 'Enter') {
          e.preventDefault();
          const text = chatInput.value.trim();
          if (text && typeof UI.onChatSubmit === 'function') UI.onChatSubmit(text);
          UI.closeChat();
        } else if (e.code === 'Escape') {
          e.preventDefault();
          UI.closeChat();
        }
      });
    }
    if (signEditor && signInput && signDone) {
      let composing = false;
      const stop = (e) => e.stopPropagation();
      for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click']) signEditor.addEventListener(type, stop);
      signInput.addEventListener('compositionstart', () => { composing = true; });
      signInput.addEventListener('compositionend', () => { composing = false; cleanSignInput(); });
      signInput.addEventListener('input', () => { if (!composing) cleanSignInput(); });
      signInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.isComposing || e.keyCode === 229) return;
        if (e.code === 'Escape') {
          e.preventDefault();
          finishSignEditor();
        } else if (e.code === 'Enter' && String(signInput.value || '').split('\n').length >= 4) {
          e.preventDefault();
        } else if (e.code === 'Tab') {
          e.preventDefault();
        }
      });
      signDone.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.code === 'Escape') { e.preventDefault(); finishSignEditor(); }
      });
      signDone.addEventListener('click', () => {
        Sound.emit('ui.button.click', { spatial: false });
        finishSignEditor();
      });
    }
  };

  UI.isOpen = () => !!win || chatOpen;
  UI.isChatOpen = () => chatOpen;
  UI.winType = () => (win ? win.type : null);
  UI.shouldDrawGameplayHud = containerWindow => !containerWindow;

  function rootScreen() {
    if (game.state === 'menu') return 'title';
    if (game.state === 'dead') return 'death';
    if (game.paused && !win) return 'pause';
    return null;
  }

  UI.currentScreen = function () {
    if (win) return null;
    return menuStack.length ? menuStack[menuStack.length - 1] : rootScreen();
  };

  UI.isMenuOpen = () => !!UI.currentScreen();

  UI.openScreen = function (name) {
    const root = rootScreen();
    if (!root || !name) return false;
    if (!menuStack.length) menuStack.push(root);
    if (menuStack[menuStack.length - 1] !== name) menuStack.push(name);
    menuFocus = 0;
    centerMouse();
    if (name === 'multiplayer' && nicknameInput) {
      nicknameInput.value = typeof Network !== 'undefined' ? Network.getPlayerName() : 'Steve';
      syncNicknameInput(name, hud.width, hud.height);
      setTimeout(() => {
        if (UI.currentScreen() === 'multiplayer') {
          nicknameInput.focus();
          nicknameInput.select();
        }
      }, 0);
    } else {
      hideNicknameInput();
    }
    return true;
  };

  UI.backScreen = function () {
    if (menuStack.length > 1) {
      menuStack.pop();
      menuFocus = 0;
      hideNicknameInput();
      return UI.currentScreen();
    }
    menuStack.length = 0;
    menuFocus = 0;
    hideNicknameInput();
    return rootScreen();
  };

  UI.resetMenus = function () {
    menuStack.length = 0;
    menuFocus = 0;
    chatOpen = false;
    playerListVisible = false;
    if (chatInput) { chatInput.style.display = 'none'; chatInput.blur(); chatInput.value = ''; }
    hideNicknameInput();
  };

  function hideNicknameInput() {
    if (!nicknameInput) return;
    nicknameInput.style.display = 'none';
    if (document.activeElement === nicknameInput) nicknameInput.blur();
  }

  UI.nicknameValue = function () {
    const raw = nicknameInput ? nicknameInput.value : (typeof Network !== 'undefined' ? Network.getPlayerName() : 'Steve');
    const name = typeof Network !== 'undefined' ? Network.setPlayerName(raw) : String(raw || 'Steve').trim().slice(0, 16);
    if (nicknameInput && nicknameInput.value !== name) nicknameInput.value = name;
    return name;
  };

  UI.focusNickname = function () {
    if (!nicknameInput || UI.currentScreen() !== 'multiplayer') return false;
    nicknameInput.focus();
    nicknameInput.select();
    return true;
  };

  function setMouseFromEvent(e) {
    const r = hud.getBoundingClientRect();
    const sx = r.width ? hud.width / r.width : 1;
    const sy = r.height ? hud.height / r.height : 1;
    mouseX = Math.max(0, Math.min(hud.width, (e.clientX - r.left) * sx));
    mouseY = Math.max(0, Math.min(hud.height, (e.clientY - r.top) * sy));
  }

  function centerMouse() {
    mouseX = hud.width / 2;
    mouseY = hud.height / 2;
  }

  function updateGuiScale(w, h) {
    const maxScale = U.clamp(Math.floor(Math.min(w / 320, h / 240)), 1, 3);
    const autoScale = U.clamp(Math.floor(Math.min(w / 640, h / 360)), 1, maxScale);
    const requestedScale = guiScaleMode === 'auto' ? autoScale : (+guiScaleMode || 1);
    GUI = Math.min(requestedScale, maxScale);
    S = 18 * GUI;
  }

  function loadGuiImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to load GUI texture: ' + src));
      image.src = src;
    });
  }

  function ensureOriginalGuiImages() {
    if (originalGuiImages) return Promise.resolve(originalGuiImages);
    if (!originalGuiLoad) {
      originalGuiLoad = Promise.all([
        loadGuiImage(ORIGINAL_GUI_FILES.icons),
        loadGuiImage(ORIGINAL_GUI_FILES.widgets),
      ]).then(([icons, widgets]) => {
        originalGuiImages = { icons, widgets };
        return originalGuiImages;
      }).catch((error) => {
        originalGuiLoad = null;
        throw error;
      });
    }
    return originalGuiLoad;
  }

  UI.setResourcePack = async function (id) {
    guiResourcePack = id === 'original_1_12' ? 'original_1_12' : 'default';
    if (guiResourcePack === 'original_1_12') await ensureOriginalGuiImages();
    itemIconCache.clear();
    return true;
  };

  function buildGuiAtlas() {
    if (guiAtlas) return;
    guiAtlas = document.createElement('canvas');
    guiAtlas.width = 256; guiAtlas.height = 256;
    const c = guiAtlas.getContext('2d');
    c.imageSmoothingEnabled = false;
    let penX = 0, penY = 0, rowH = 0;
    const add = (name, w, h, paint) => {
      if (penX + w > guiAtlas.width) { penX = 0; penY += rowH + 1; rowH = 0; }
      if (penY + h > guiAtlas.height) throw new Error('GUI atlas overflow');
      guiSprites[name] = { x: penX, y: penY, w, h };
      c.save(); c.translate(penX, penY); paint(c, w, h); c.restore();
      penX += w + 1; rowH = Math.max(rowH, h);
    };
    const bevel = (c2, w, h, fill, hi, lo) => {
      c2.fillStyle = '#111'; c2.fillRect(0, 0, w, h);
      c2.fillStyle = fill; c2.fillRect(1, 1, w - 2, h - 2);
      c2.fillStyle = hi; c2.fillRect(1, 1, w - 2, 1); c2.fillRect(1, 1, 1, h - 2);
      c2.fillStyle = lo; c2.fillRect(1, h - 2, w - 2, 1); c2.fillRect(w - 2, 1, 1, h - 2);
    };
    add('button', 200, 20, (c2, w, h) => bevel(c2, w, h, '#6d6d6d', '#a9a9a9', '#383838'));
    add('button_hover', 200, 20, (c2, w, h) => bevel(c2, w, h, '#7d8195', '#b8bdd5', '#343746'));
    add('slot', 18, 18, (c2) => {
      c2.fillStyle = '#8b8b8b'; c2.fillRect(0, 0, 18, 18);
      c2.fillStyle = '#373737'; c2.fillRect(0, 0, 18, 2); c2.fillRect(0, 0, 2, 18);
      c2.fillStyle = '#fff'; c2.fillRect(2, 16, 16, 2); c2.fillRect(16, 2, 2, 16);
    });
    add('selector', 24, 24, (c2) => {
      c2.fillStyle = '#fff';
      c2.fillRect(0, 0, 24, 2); c2.fillRect(0, 22, 24, 2); c2.fillRect(0, 0, 2, 24); c2.fillRect(22, 0, 2, 24);
      c2.fillStyle = '#777';
      c2.fillRect(2, 2, 20, 1); c2.fillRect(2, 21, 20, 1); c2.fillRect(2, 2, 1, 20); c2.fillRect(21, 2, 1, 20);
    });
    add('hotbar', 182, 22, (c2) => {
      c2.fillStyle = 'rgba(0,0,0,0.72)'; c2.fillRect(0, 0, 182, 22);
      c2.fillStyle = '#8b8b8b'; c2.fillRect(1, 1, 180, 20);
      for (let i = 0; i < 9; i++) {
        const x = 1 + i * 20;
        c2.fillStyle = '#373737'; c2.fillRect(x, 1, 2, 20); c2.fillRect(x, 1, 20, 2);
        c2.fillStyle = '#fff'; c2.fillRect(x + 2, 19, 18, 2); c2.fillRect(x + 18, 3, 2, 16);
        c2.fillStyle = '#8b8b8b'; c2.fillRect(x + 2, 3, 16, 16);
      }
      c2.fillStyle = '#373737'; c2.fillRect(180, 1, 1, 20);
    });
    const paintHeart = (c2, mode) => {
      const rows = ['0110110', '1111111', '1111111', '1111111', '0111110', '0011100', '0001000'];
      for (let y = 0; y < rows.length; y++) for (let x = 0; x < 7; x++) if (rows[y][x] === '1') {
        const edge = y === 0 || x === 0 || x === 6 || !rows[y - 1] || rows[y - 1][x] === '0' ||
          !rows[y + 1] || rows[y + 1][x] === '0';
        let color = edge ? '#3a1111' : '#6b2525';
        if (mode === 'full' || (mode === 'half' && x < 4)) color = edge ? '#8f1010' : (x < 2 && y < 3 ? '#ff7777' : '#df2525');
        c2.fillStyle = color; c2.fillRect(x + 1, y + 1, 1, 1);
      }
    };
    add('heart_empty', 9, 9, (c2) => paintHeart(c2, 'empty'));
    add('heart_full', 9, 9, (c2) => paintHeart(c2, 'full'));
    add('heart_half', 9, 9, (c2) => paintHeart(c2, 'half'));
    const paintFood = (c2, mode) => {
      const rows = ['000111000', '001111100', '011111100', '111111000', '111110000', '011100000', '001100110', '000111110', '000011000'];
      for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (rows[y][x] === '1') {
        const edge = y === 0 || x === 0 || x === 8 || !rows[y - 1] || rows[y - 1][x] === '0' ||
          !rows[y + 1] || rows[y + 1][x] === '0';
        let color = edge ? '#2c1b12' : '#58351e';
        if (mode === 'full' || (mode === 'half' && x < 5)) color = edge ? '#5b321b' : (x < 4 ? '#d9a14b' : '#a9602c');
        c2.fillStyle = color; c2.fillRect(x, y, 1, 1);
      }
    };
    add('food_empty', 9, 9, (c2) => paintFood(c2, 'empty'));
    add('food_full', 9, 9, (c2) => paintFood(c2, 'full'));
    add('food_half', 9, 9, (c2) => paintFood(c2, 'half'));
    add('air', 9, 9, (c2) => {
      c2.fillStyle = '#315c91'; c2.fillRect(2, 1, 5, 1); c2.fillRect(1, 2, 1, 5); c2.fillRect(7, 2, 1, 5); c2.fillRect(2, 7, 5, 1);
      c2.fillStyle = '#b9e7ff'; c2.fillRect(3, 2, 3, 1); c2.fillRect(2, 3, 1, 3); c2.fillRect(3, 3, 2, 2);
    });
    const paintArmor = (c2, mode) => {
      const rows = ['0111110','1111111','1100011','1100011','1110111','0111110','0011100'];
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (rows[y][x] === '1') {
        let col = '#303030';
        if (mode === 'full' || (mode === 'half' && x < 4)) col = (x + y) % 3 === 0 ? '#f2f2f2' : '#a9a9a9';
        c2.fillStyle = col; c2.fillRect(x + 1, y + 1, 1, 1);
      }
    };
    add('armor_empty', 9, 9, (c2) => paintArmor(c2, 'empty'));
    add('armor_full', 9, 9, (c2) => paintArmor(c2, 'full'));
    add('armor_half', 9, 9, (c2) => paintArmor(c2, 'half'));
    add('xp_bg', 182, 5, (c2) => {
      c2.fillStyle = '#101010'; c2.fillRect(0, 0, 182, 5);
      c2.fillStyle = '#303030'; c2.fillRect(1, 1, 180, 3);
      c2.fillStyle = '#080808'; c2.fillRect(2, 2, 178, 1);
    });
    add('xp_fill', 182, 5, (c2) => {
      c2.fillStyle = '#0c2b05'; c2.fillRect(0, 0, 182, 5);
      c2.fillStyle = '#57d31f'; c2.fillRect(1, 1, 180, 3);
      c2.fillStyle = '#b4ff78'; c2.fillRect(2, 1, 178, 1);
    });
    add('crosshair', 15, 15, (c2) => {
      c2.fillStyle = 'rgba(0,0,0,0.85)';
      c2.fillRect(6, 0, 3, 6); c2.fillRect(6, 9, 3, 6); c2.fillRect(0, 6, 6, 3); c2.fillRect(9, 6, 6, 3);
      c2.fillStyle = '#fff';
      c2.fillRect(7, 1, 1, 5); c2.fillRect(7, 9, 1, 5); c2.fillRect(1, 7, 5, 1); c2.fillRect(9, 7, 5, 1);
    });
    add('flame', 14, 14, (c2) => {
      c2.fillStyle = '#f30'; c2.fillRect(3, 5, 8, 8); c2.fillRect(5, 2, 5, 5); c2.fillRect(7, 0, 2, 4);
      c2.fillStyle = '#ffb000'; c2.fillRect(5, 7, 5, 6); c2.fillRect(7, 4, 2, 5);
      c2.fillStyle = '#fff27a'; c2.fillRect(7, 9, 2, 4);
    });
    add('arrow', 24, 17, (c2) => {
      c2.fillStyle = '#8b8b8b'; c2.fillRect(0, 6, 17, 5); c2.fillRect(16, 3, 3, 11); c2.fillRect(19, 5, 3, 7); c2.fillRect(22, 7, 2, 3);
    });
    buildContainerAtlas();
    buildMenuPanorama();
  }

  function buildContainerAtlas() {
    containerAtlas = document.createElement('canvas');
    containerAtlas.width = 176; containerAtlas.height = 168 * 5;
    const c = containerAtlas.getContext('2d');
    const kinds = ['inventory', 'crafting', 'furnace', 'chest', 'creative'];
    const panel = (oy, kind) => {
      c.fillStyle = '#c6c6c6'; c.fillRect(0, oy, 176, 168);
      c.fillStyle = '#f5f5f5'; c.fillRect(0, oy, 176, 2); c.fillRect(0, oy, 2, 168);
      c.fillStyle = '#555'; c.fillRect(0, oy + 166, 176, 2); c.fillRect(174, oy, 2, 168);
      c.fillStyle = 'rgba(255,255,255,0.12)';
      for (let y = 6; y < 164; y += 16) for (let x = 6; x < 172; x += 16) c.fillRect(x, oy + y, 1, 1);
      if (kind === 'inventory') {
        c.fillStyle = '#272727'; c.fillRect(30, oy + 18, 44, 54);
        c.fillStyle = '#555'; c.fillRect(30, oy + 18, 44, 1); c.fillRect(30, oy + 18, 1, 54);
      } else if (kind === 'crafting') {
        c.fillStyle = '#aaa'; c.fillRect(27, oy + 14, 58, 58);
        c.fillStyle = '#dedede'; c.fillRect(28, oy + 15, 56, 1); c.fillRect(28, oy + 15, 1, 56);
      } else if (kind === 'furnace') {
        c.fillStyle = '#aaa'; c.fillRect(52, oy + 13, 24, 62);
        c.fillStyle = '#dedede'; c.fillRect(53, oy + 14, 22, 1);
      } else if (kind === 'chest') {
        c.fillStyle = '#777'; c.fillRect(7, oy + 75, 162, 1);
        c.fillStyle = '#eee'; c.fillRect(7, oy + 76, 162, 1);
      } else if (kind === 'creative') {
        c.fillStyle = '#777'; c.fillRect(7, oy + 130, 162, 1);
        c.fillStyle = '#eee'; c.fillRect(7, oy + 131, 162, 1);
      }
    };
    kinds.forEach((kind, i) => {
      const y = i * 168;
      containerRects[kind] = { x: 0, y, w: 176, h: kind === 'chest' ? 168 : 166 };
      panel(y, kind);
    });
  }

  function buildMenuPanorama() {
    menuPanorama = document.createElement('canvas');
    menuPanorama.width = 1024; menuPanorama.height = 256;
    const c = menuPanorama.getContext('2d');
    c.fillStyle = '#78a7e8'; c.fillRect(0, 0, 1024, 90);
    c.fillStyle = '#9bc2ef'; c.fillRect(0, 90, 1024, 65);
    c.fillStyle = '#d8e7f6'; c.fillRect(0, 155, 1024, 35);
    const atlas = Textures.atlas.canvas;
    const tile = (name, x, y, size) => {
      const r = Textures.rect(name);
      c.drawImage(atlas, r[0], r[1], 16, 16, x, y, size || 16, size || 16);
    };
    for (let x = 0; x < 1024; x += 16) {
      const surface = 155 + Math.round(Math.sin(x * 0.018) * 14 + Math.sin(x * 0.051) * 7);
      tile('grass_top', x, surface, 16);
      for (let y = surface + 16; y < 256; y += 16) tile(y > 224 ? 'stone' : 'dirt', x, y, 16);
      if ((x === 96 || x === 368 || x === 720 || x === 944)) {
        for (let y = surface - 48; y < surface; y += 16) tile('log_side', x, y, 16);
        for (let dx = -24; dx <= 24; dx += 16) for (let dy = -80; dy <= -40; dy += 16) tile('leaves', x + dx, surface + dy, 16);
      }
    }
    menuDirt = document.createElement('canvas');
    menuDirt.width = 32; menuDirt.height = 32;
    const dc = menuDirt.getContext('2d');
    dc.imageSmoothingEnabled = false;
    const dirt = Textures.rect('dirt');
    dc.drawImage(Textures.atlas.canvas, dirt[0], dirt[1], 16, 16, 0, 0, 32, 32);
    dc.fillStyle = 'rgba(32,24,20,0.48)';
    dc.fillRect(0, 0, 32, 32);
  }

  function drawContainerBackground(type, p) {
    const r = containerRects[type] || containerRects.inventory;
    hctx.imageSmoothingEnabled = false;
    hctx.drawImage(containerAtlas, r.x, r.y, r.w, r.h, p.x, p.y, p.w, p.h);
  }

  function drawMenuPanorama(w, h) {
    if (!menuPanorama) return;
    const scale = Math.max(w / menuPanorama.width, h / menuPanorama.height);
    const dw = menuPanorama.width * scale, dh = menuPanorama.height * scale;
    const offset = -U.mod(performance.now() * 0.012, dw);
    for (let x = offset - dw; x < w; x += dw) hctx.drawImage(menuPanorama, x, (h - dh) / 2, dw, dh);
    hctx.fillStyle = 'rgba(0,0,0,0.36)'; hctx.fillRect(0, 0, w, h);
  }

  function drawDirtBackground(w, h) {
    const pattern = menuDirt && hctx.createPattern ? hctx.createPattern(menuDirt, 'repeat') : null;
    hctx.fillStyle = pattern || '#302820';
    hctx.fillRect(0, 0, w, h);
    hctx.fillStyle = 'rgba(0,0,0,0.18)';
    hctx.fillRect(0, 0, w, h);
  }

  function drawGui(name, x, y, w, h, alpha) {
    const original = guiResourcePack === 'original_1_12' && originalGuiImages
      ? ORIGINAL_GUI_SPRITES[name] : null;
    const r = original || guiSprites[name];
    if (!r) return;
    const source = original ? originalGuiImages[original.asset] : guiAtlas;
    hctx.save();
    hctx.globalAlpha = alpha === undefined ? 1 : alpha;
    hctx.imageSmoothingEnabled = false;
    hctx.drawImage(source, r.x, r.y, r.w, r.h, Math.round(x), Math.round(y),
      Math.round(w === undefined ? r.w * GUI : w), Math.round(h === undefined ? r.h * GUI : h));
    hctx.restore();
  }

  function drawPixelText(text, x, y, size, align, color, alpha, bold) {
    text = String(text);
    if (/^[\x20-\x7e]*$/.test(text) && drawBitmapText(text, x, y, size, align, color, alpha)) return;
    const pixelSize = Math.max(12, Math.round(size));
    const glyph = cachedUnicodeText(text, pixelSize, color || '#fff', !!bold);
    const shadowGlyph = cachedUnicodeText(text, pixelSize, '#000', !!bold);
    if (glyph && shadowGlyph) {
      const width = glyph.width;
      let drawX = x;
      if (align === 'center') drawX -= width / 2;
      else if (align === 'right') drawX -= width;
      const drawY = y - glyph.baseline;
      const shadow = Math.max(1, GUI);
      hctx.save();
      hctx.imageSmoothingEnabled = true;
      hctx.imageSmoothingQuality = 'high';
      hctx.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.75;
      hctx.drawImage(shadowGlyph.canvas, Math.round(drawX + shadow), Math.round(drawY + shadow),
        shadowGlyph.width, shadowGlyph.height);
      hctx.globalAlpha = alpha === undefined ? 1 : alpha;
      hctx.drawImage(glyph.canvas, Math.round(drawX), Math.round(drawY), glyph.width, glyph.height);
      hctx.restore();
      return;
    }
    hctx.save();
    hctx.globalAlpha = alpha === undefined ? 1 : alpha;
    hctx.font = unicodeFont(Math.max(12, Math.round(size)), !!bold);
    hctx.textAlign = align || 'left';
    hctx.textBaseline = 'alphabetic';
    hctx.fillStyle = 'rgba(0,0,0,0.75)';
    const shadow = Math.max(1, Math.floor(GUI / 2));
    hctx.fillText(text, Math.round(x + shadow), Math.round(y + shadow));
    hctx.fillStyle = color || '#fff';
    hctx.fillText(text, Math.round(x), Math.round(y));
    hctx.restore();
  }

  function cachedUnicodeText(text, size, color, bold) {
    const key = text + '|' + size + '|' + color + '|' + (bold ? 1 : 0);
    let entry = unicodeTextCache.get(key);
    if (entry) return entry;
    try {
      const canvas = document.createElement('canvas');
      let c = canvas.getContext('2d');
      const rasterSize = size * UNICODE_RASTER_SCALE;
      c.font = unicodeFont(rasterSize, bold);
      const metrics = c.measureText(text);
      const padding = Math.max(6, Math.ceil(rasterSize * 0.25));
      const left = Math.max(0, Math.ceil(metrics.actualBoundingBoxLeft || 0));
      const right = Math.max(Math.ceil(metrics.width), Math.ceil(metrics.actualBoundingBoxRight || metrics.width));
      const ascent = Math.max(
        Math.ceil(metrics.actualBoundingBoxAscent || 0),
        Math.ceil(metrics.fontBoundingBoxAscent || 0),
        Math.ceil(rasterSize * 1.08)
      );
      const descent = Math.max(
        Math.ceil(metrics.actualBoundingBoxDescent || 0),
        Math.ceil(metrics.fontBoundingBoxDescent || 0),
        Math.ceil(rasterSize * 0.32)
      );
      const width = Math.max(1, left + right + padding * 2);
      const height = Math.max(10, ascent + descent + padding * 2);
      const baseline = padding + ascent;
      canvas.width = width; canvas.height = height;
      c = canvas.getContext('2d');
      c.font = unicodeFont(rasterSize, bold);
      c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = color;
      c.fillText(text, padding + left, baseline);
      entry = {
        canvas,
        width: Math.ceil(width / UNICODE_RASTER_SCALE),
        height: Math.ceil(height / UNICODE_RASTER_SCALE),
        baseline: Math.ceil(baseline / UNICODE_RASTER_SCALE),
      };
      if (unicodeTextCache.size >= 256) unicodeTextCache.delete(unicodeTextCache.keys().next().value);
      unicodeTextCache.set(key, entry);
      return entry;
    } catch (e) {
      return null;
    }
  }

  function unicodeFont(size, bold) {
    return (bold ? '600 ' : '') + size + 'px ' + UI_FONT;
  }

  function drawBitmapText(text, x, y, size, align, color, alpha) {
    const chars = text;
    for (let i = 0; i < chars.length; i++) if (!BITMAP_FONT[chars[i]]) return false;
    const px = Math.max(1, Math.round(size / 7));
    const advance = 6 * px;
    const width = Math.max(0, chars.length * advance - px);
    let startX = x;
    if (align === 'center') startX -= width / 2;
    else if (align === 'right') startX -= width;
    const top = y - 7 * px;
    const shadow = Math.max(1, Math.floor(px / 2));
    hctx.save(); hctx.globalAlpha = alpha === undefined ? 1 : alpha;
    for (let pass = 0; pass < 2; pass++) {
      hctx.fillStyle = pass === 0 ? 'rgba(0,0,0,0.75)' : (color || '#fff');
      const off = pass === 0 ? shadow : 0;
      for (let ci = 0; ci < chars.length; ci++) {
        const rows = BITMAP_FONT[chars[ci]];
        for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
          if (rows[gy][gx] === '1') hctx.fillRect(Math.round(startX + ci * advance + gx * px + off), Math.round(top + gy * px + off), px, px);
        }
      }
    }
    hctx.restore();
    return true;
  }

  UI.cycleGuiScale = function () {
    const modes = ['auto', '1', '2', '3'];
    guiScaleMode = modes[(modes.indexOf(guiScaleMode) + 1) % modes.length];
    try { localStorage.setItem('webcraft_gui_scale', guiScaleMode); } catch (e) { /* storage unavailable */ }
    updateGuiScale(hud.width, hud.height);
    return guiScaleMode;
  };

  UI.guiScaleLabel = () => guiScaleMode === 'auto' ? '自动' : guiScaleMode + 'x';

  function menuFrame(w, h) {
    return {
      x: Math.round((w - 320 * GUI) / 2),
      y: Math.round((h - 240 * GUI) / 2),
      w: 320 * GUI,
      h: 240 * GUI,
    };
  }

  function menuControl(frame, id, label, x, y, w, opts) {
    opts = opts || {};
    return {
      id, label,
      x: frame.x + x * GUI,
      y: frame.y + y * GUI,
      w: (w || 200) * GUI,
      h: 20 * GUI,
      type: opts.type || 'button',
      value: opts.value,
      min: opts.min,
      max: opts.max,
      step: opts.step,
      disabled: !!opts.disabled,
    };
  }

  function controlsForScreen(screen, w, h) {
    const f = menuFrame(w, h);
    const full = (id, label, y, opts) => menuControl(f, id, label, 60, y, 200, opts);
    const left = (id, label, y, opts) => menuControl(f, id, label, 10, y, 148, opts);
    const right = (id, label, y, opts) => menuControl(f, id, label, 162, y, 148, opts);
    const difficulty = ['和平', '简单', '普通', '困难'][game.difficulty | 0] || '普通';
    const particles = ['全部', '减少', '最少'][game.particleLevel | 0] || '全部';
    const fov = Math.round(game.baseFov || 70);
    if (screen === 'title') return [
      full('singleplayer', '单人游戏', 92),
      full('multiplayer', '多人游戏', 116),
      full('realms', 'Minecraft Realms', 140, { disabled: true }),
      menuControl(f, 'options', '选项...', 60, 176, 98),
      menuControl(f, 'quit', '退出游戏', 162, 176, 98),
    ];
    if (screen === 'multiplayer') return [
      full('nickname', '玩家昵称', 80, { type: 'text' }),
      full('join_server', '加入服务器', 112),
      full('done', '取消', 194),
    ];
    if (screen === 'worlds') return [
      full('continue', SaveSys.exists() ? '继续游戏' : '没有可用存档', 62, { disabled: !SaveSys.exists() }),
      full('new_survival', '创建新的生存世界', 90),
      full('new_creative', '创建新的创造世界', 114),
      full('delete_world', '删除世界', 142, { disabled: !SaveSys.exists() }),
      full('done', '取消', 194),
    ];
    if (screen === 'pause') return [
      full('resume', '返回游戏', 48),
      menuControl(f, 'achievements', '成就', 60, 74, 98, { disabled: true }),
      menuControl(f, 'statistics', '统计信息', 162, 74, 98, { disabled: true }),
      full('open_lan', '对局域网开放', 100, { disabled: true }),
      full('options', '选项...', 126),
      full('save_quit', game.multiplayer ? '断开连接并返回标题画面' : '保存并退回到标题画面', 164),
    ];
    if (screen === 'options') return [
      left('fov', '视野：' + (fov === 70 ? '普通' : fov), 44, { type: 'slider', value: fov, min: 30, max: 110, step: 1 }),
      right('difficulty', '难度：' + difficulty, 44),
      left('skin', '皮肤自定义...', 70),
      right('sound', '音乐和声音...', 70),
      left('video', '视频设置...', 96),
      right('controls', '控制...', 96),
      left('language', '语言...', 122),
      right('resource', '资源包...', 122),
      full('done', '完成', 194),
    ];
    if (screen === 'video') return [
      left('render_distance', '渲染距离：' + (game.viewDist | 0) + ' 区块', 44,
        { type: 'slider', value: game.viewDist | 0, min: 2, max: 12, step: 1 }),
      right('gui_scale', '界面尺寸：' + UI.guiScaleLabel(), 44),
      left('smooth_lighting', '平滑光照：' + (game.smoothLighting ? '开' : '关'), 70),
      right('particles', '颗粒效果：' + particles, 70),
      left('fullscreen', '全屏：' + (document.fullscreenElement ? '开' : '关'), 96),
      right('clouds', '云：关', 96, { disabled: true }),
      full('done', '完成', 194),
    ];
    if (screen === 'controls') return [
      full('sensitivity', '鼠标灵敏度：' + Math.round(game.mouseSensitivity * 100) + '%', 48,
        { type: 'slider', value: game.mouseSensitivity, min: 0.1, max: 1, step: 0.01 }),
      full('invert_mouse', '反转鼠标：' + (game.invertMouseY ? '开' : '关'), 76),
      full('raw_mouse', '原始鼠标输入：' + (game.rawMouse ? '开' : '关'), 102),
      full('auto_jump', '自动跳跃：' + (game.autoJump ? '开' : '关'), 128),
      full('done', '完成', 194),
    ];
    if (screen === 'skin') {
      const profiles = Textures.skinProfiles ? Textures.skinProfiles() : [{ id: 'steve', name: 'Steve' }];
      const profile = profiles.find(entry => entry.id === game.playerSkin) || profiles[0];
      return [
        full('skin_preset', '皮肤：' + profile.name, 66),
        full('skin_model', '手臂：' + (game.playerModel === 'slim' ? '纤细（Alex）' : '经典（Steve）'), 94),
        full('done', '完成', 194),
      ];
    }
    if (screen === 'sound') return [
      full('master_volume', '主音量：' + Math.round(game.masterVolume * 100) + '%', 54,
        { type: 'slider', value: game.masterVolume, min: 0, max: 1, step: 0.01 }),
      full('music_volume', '音乐：' + (game.musicOn ? Math.round(game.musicVolume * 100) + '%' : '关'), 82,
        { type: 'slider', value: game.musicOn ? game.musicVolume : 0, min: 0, max: 1, step: 0.01 }),
      full('done', '完成', 194),
    ];
    if (screen === 'language') return [
      full('language_zh', '简体中文（中国）', 70, { disabled: true }),
      full('done', '完成', 194),
    ];
    if (screen === 'resource') return [
      full('resource_pack', game.resourcePackLoading ? '材质包：正在加载...'
        : '材质包：' + (game.resourcePack === 'original_1_12' ? 'Minecraft 1.12.2 原版' : 'WebCraft 默认'),
      70, { disabled: !!game.resourcePackLoading }),
      full('resource_audio', '音效：Minecraft 1.12.2 原版', 98, { disabled: true }),
      full('done', '完成', 194),
    ];
    if (screen === 'confirm_delete') return [
      menuControl(f, 'confirm_delete', '删除', 60, 132, 98),
      menuControl(f, 'cancel_delete', '取消', 162, 132, 98),
    ];
    if (screen === 'death') return [full('respawn', '重生', 146)];
    return [];
  }

  UI.screenControls = function (w, h) {
    updateGuiScale(w, h);
    return controlsForScreen(UI.currentScreen(), w, h);
  };

  function syncNicknameInput(screen, w, h) {
    if (!nicknameInput) return;
    if (screen !== 'multiplayer') {
      hideNicknameInput();
      return;
    }
    const control = controlsForScreen(screen, w, h).find(c => c.id === 'nickname');
    if (!control) { hideNicknameInput(); return; }
    nicknameInput.style.display = 'block';
    nicknameInput.style.left = control.x + 'px';
    nicknameInput.style.top = control.y + 'px';
    nicknameInput.style.width = control.w + 'px';
    nicknameInput.style.height = control.h + 'px';
    nicknameInput.style.fontSize = Math.max(12, 7 * GUI) + 'px';
    nicknameInput.style.borderWidth = Math.max(2, GUI) + 'px';
  }

  UI.controlAt = function (w, h, x, y) {
    const controls = UI.screenControls(w, h);
    for (let i = 0; i < controls.length; i++) {
      const c = controls[i];
      if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) {
        menuFocus = i;
        return c;
      }
    }
    return null;
  };

  UI.sliderValue = function (control, x) {
    if (!control || control.type !== 'slider') return undefined;
    const t = U.clamp((x - control.x - 4 * GUI) / Math.max(1, control.w - 8 * GUI), 0, 1);
    const raw = control.min + (control.max - control.min) * t;
    const step = control.step || 1;
    return U.clamp(Math.round(raw / step) * step, control.min, control.max);
  };

  UI.handleMenuKey = function (e) {
    if (!UI.isMenuOpen()) return null;
    const controls = UI.screenControls(hud.width, hud.height);
    if (!controls.length) return null;
    const selectable = (i) => !controls[i].disabled;
    const move = (dir) => {
      for (let n = 0; n < controls.length; n++) {
        menuFocus = U.mod(menuFocus + dir, controls.length);
        if (selectable(menuFocus)) break;
      }
    };
    if (e.code === 'Tab' || e.code === 'ArrowDown') { move(1); return { handled: true }; }
    if (e.code === 'ArrowUp') { move(-1); return { handled: true }; }
    const current = controls[U.clamp(menuFocus, 0, controls.length - 1)];
    if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && current.type === 'slider') {
      const delta = (current.step || 1) * (e.code === 'ArrowLeft' ? -1 : 1);
      return { handled: true, control: current, value: U.clamp(current.value + delta, current.min, current.max) };
    }
    if (e.code === 'Enter' || e.code === 'Space') return e.repeat
      ? { handled: true }
      : { handled: true, control: current };
    if (e.code === 'Escape') return e.repeat ? { handled: true } : { handled: true, back: true };
    return null;
  };

  // ---------------- window management ----------------
  function grid(n) { const a = []; for (let i = 0; i < n; i++) a.push(null); return a; }

  function sanitizeSignLine(value) {
    return Array.from(String(value === undefined || value === null ? '' : value)
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')).slice(0, 15).join('');
  }

  function normalizeSignLines(value) {
    const source = Array.isArray(value) ? value : String(value || '').replace(/\r/g, '').split('\n');
    const lines = source.slice(0, 4).map(sanitizeSignLine);
    while (lines.length < 4) lines.push('');
    return lines;
  }

  function editableSignText(lines) {
    const copy = normalizeSignLines(lines);
    while (copy.length && !copy[copy.length - 1]) copy.pop();
    return copy.join('\n');
  }

  function cleanSignInput() {
    if (!signInput) return;
    const raw = String(signInput.value || '').replace(/\r/g, '');
    const clean = raw.split('\n').slice(0, 4).map(sanitizeSignLine).join('\n');
    if (clean === raw) return;
    const caret = Math.min(clean.length, signInput.selectionStart || clean.length);
    signInput.value = clean;
    signInput.setSelectionRange(caret, caret);
  }

  function hideSignEditor() {
    if (!signEditor) return;
    signEditor.style.display = 'none';
    if (document.activeElement === signInput || document.activeElement === signDone) document.activeElement.blur();
  }

  function commitSignEditor() {
    if (!win || win.type !== 'sign') return false;
    const lines = normalizeSignLines(signInput ? signInput.value : win.be.lines);
    win.be.type = 'sign';
    win.be.lines = lines;
    delete win.be.text;
    if (game.world.getBlock(win.x, win.y, win.z) === Blocks.ID.OAK_SIGN) {
      game.world.setBE(win.x, win.y, win.z, win.be);
      if (typeof Network !== 'undefined' && Network.isConnected() && Network.updateSign) Network.updateSign(win.be);
    }
    return true;
  }

  function finishSignEditor() {
    if (!win || win.type !== 'sign') return;
    UI.close();
    if (typeof UI.onSignDone === 'function') UI.onSignDone();
  }

  UI.openSignEditor = function (x, y, z) {
    if (!signEditor || !signInput || !game || !game.world || game.world.getBlock(x, y, z) !== Blocks.ID.OAK_SIGN) return false;
    if (win && win.type !== 'sign') UI.close();
    let be = game.world.getBE(x, y, z);
    if (!be || be.type !== 'sign') {
      be = { type: 'sign', lines: ['', '', '', ''] };
      game.world.setBE(x, y, z, be);
    }
    be.lines = normalizeSignLines(be.lines || be.text || '');
    delete be.text;
    win = { type: 'sign', be, x, y, z };
    signInput.value = editableSignText(be.lines);
    signEditor.style.display = 'flex';
    centerMouse();
    if (document.exitPointerLock) document.exitPointerLock();
    setTimeout(() => {
      if (!win || win.type !== 'sign') return;
      signInput.focus();
      const caret = be.lines[0].length;
      signInput.setSelectionRange(caret, caret);
    }, 0);
    return true;
  };

  UI.openChat = function (prefix) {
    if (!chatInput || !game || !game.multiplayer) return false;
    chatOpen = true;
    chatInput.style.display = 'block';
    chatInput.value = prefix || '';
    if (document.exitPointerLock) document.exitPointerLock();
    setTimeout(() => {
      chatInput.focus();
      chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
    }, 0);
    return true;
  };

  UI.closeChat = function () {
    if (!chatOpen) return;
    chatOpen = false;
    if (chatInput) {
      chatInput.style.display = 'none';
      chatInput.blur();
      chatInput.value = '';
    }
    if (typeof UI.onChatClose === 'function') UI.onChatClose();
  };

  UI.addChat = function (message) {
    if (!message) return;
    const kind = message.kind === 'player' ? 'player' : 'system';
    const text = kind === 'player'
      ? '<' + String(message.name || 'Steve').slice(0, 16) + '> ' + String(message.text || '')
      : String(message.text || '');
    if (!text) return;
    chatMessages.push({ text: Array.from(text).slice(0, 240).join(''), kind, at: performance.now() });
    if (chatMessages.length > 100) chatMessages.splice(0, chatMessages.length - 100);
  };

  UI.setPlayerList = function (visible) { playerListVisible = !!visible; };

  UI.containerConflict = function () {
    dragState = null;
    cursorOrigin = null;
    UI.toast('容器已被其他玩家修改，操作已回滚');
  };

  UI.openInventory = function () {
    if (game.player.mode === 'creative') {
      const catalog = Object.values(Items.all).filter(item => item && item.id !== Blocks.ID.AIR && !item.hidden).sort((a, b) => a.id - b.id);
      win = { type: 'creative', page: 0, catalog };
    } else {
      win = { type: 'inventory', craft: grid(4), result: null };
    }
    centerMouse();
    document.exitPointerLock && document.exitPointerLock();
  };
  UI.openCrafting = function () {
    win = { type: 'crafting', craft: grid(9), result: null };
    centerMouse();
    document.exitPointerLock && document.exitPointerLock();
  };
  UI.openFurnace = function (x, y, z) {
    let be = game.world.getBE(x, y, z);
    if (!be) { be = { type: 'furnace', slots: grid(3), burn: 0, burnMax: 0, cook: 0, xpStored: 0 }; game.world.setBE(x, y, z, be); }
    win = { type: 'furnace', be, x, y, z };
    if (typeof Network !== 'undefined' && Network.isConnected()) Network.openContainer(be);
    centerMouse();
    document.exitPointerLock && document.exitPointerLock();
  };
  UI.openChest = function (x, y, z) {
    let be = game.world.getBE(x, y, z);
    if (!be) { be = { type: 'chest', slots: grid(27) }; game.world.setBE(x, y, z, be); }
    win = { type: 'chest', be, x, y, z };
    if (typeof Network !== 'undefined' && Network.isConnected()) Network.openContainer(be);
    centerMouse();
    document.exitPointerLock && document.exitPointerLock();
  };
  UI.close = function () {
    if (chatOpen) { UI.closeChat(); return; }
    if (!win) return;
    if (craftTransaction && win.craft) {
      UI.toast('正在等待服务器确认合成');
      return;
    }
    if (win.type === 'sign') {
      commitSignEditor();
      win = null;
      hideSignEditor();
      return;
    }
    const p = game.player;
    const hadTransientCrafting = !!win.craft;
    // Keep the block position before clearing the window. Only a chest has a
    // physical close sound; inventory, workbench and furnace screens are quiet.
    const closingChest = win.type === 'chest'
      ? { x: win.x + 0.5, y: win.y + 0.5, z: win.z + 0.5 }
      : null;
    // return crafting grid + cursor to inventory
    const giveBack = (arr) => {
      if (!arr) return;
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        if (s) {
          const left = giveStack(p, s);
          if (left > 0) Entities.spawnItem(p.x, p.y + 1, p.z, s.id, left, undefined, undefined, undefined, s);
          arr[i] = null;
        }
      }
    };
    giveBack(win.craft);
    if (p.cursor) {
      const left = giveStack(p, p.cursor);
      if (left > 0) Entities.spawnItem(p.x, p.y + 1, p.z, p.cursor.id, left, undefined, undefined, undefined, p.cursor);
      p.cursor = null;
    }
    win = null;
    dragState = null;
    cursorOrigin = null;
    hoverSlot = null;
    if (closingChest) Sound.emit('container.chest.close', { ...closingChest, volume: 1 });
    if (hadTransientCrafting && typeof Network !== 'undefined' && Network.isConnected()) {
      const transaction = Network.commitProfile(p);
      if (transaction) profileCommitTransaction = transaction;
    }
  };

  UI.profileInventory = function () {
    const p = game && game.player;
    if (!p) return null;
    return Items.inventoryWithTransient(p.inv, win && win.craft ? win.craft : null);
  };

  UI.shouldApplyProfileInventory = function (transaction) {
    if (win && win.craft) return false;
    if (!profileCommitTransaction) return true;
    return Number(transaction) === profileCommitTransaction;
  };

  UI.finishProfileCommit = function (transaction) {
    if (Number(transaction) === profileCommitTransaction) profileCommitTransaction = 0;
  };

  UI.resetProfileSync = function () { profileCommitTransaction = 0; craftTransaction = null; };

  UI.hasTransientCrafting = function () { return !!(win && win.craft); };

  UI.finishCraftTransaction = function (transaction, accepted) {
    if (!craftTransaction || Number(transaction) !== craftTransaction.id) return false;
    const snapshot = craftTransaction;
    craftTransaction = null;
    if (!accepted && win && win.craft && game && game.player) {
      for (let i = 0; i < 36; i++) game.player.inv[i] = snapshot.inv[i] ? Items.cloneStack(snapshot.inv[i]) : null;
      for (let i = 0; i < win.craft.length; i++) win.craft[i] = snapshot.craft[i] ? Items.cloneStack(snapshot.craft[i]) : null;
      game.player.cursor = snapshot.cursor ? Items.cloneStack(snapshot.cursor) : null;
      refreshCraftResult();
      dragState = null; cursorOrigin = null;
      UI.toast('合成状态已变化，本次操作已回滚');
    }
    return true;
  };

  UI.inventoryProfileApplied = function () {
    dragState = null;
    cursorOrigin = null;
  };

  UI.dropTransientItems = function (p) {
    p = p || game.player;
    if (!p) return;
    const drop = (s) => {
      if (!s) return;
      Entities.spawnItem(p.x, p.y + 1, p.z, s.id, s.n, undefined, undefined, undefined, s);
    };
    if (win && win.craft) {
      for (let i = 0; i < win.craft.length; i++) {
        drop(win.craft[i]);
        win.craft[i] = null;
      }
    }
    if (p.cursor) {
      drop(p.cursor);
      p.cursor = null;
    }
    if (win && win.type === 'sign') hideSignEditor();
    win = null;
    dragState = null;
    cursorOrigin = null;
    hoverSlot = null;
  };

  function giveStack(p, s) {
    return p.giveStack(s);
  }

  // ---------------- slot layout ----------------
  // returns array of {x,y,kind,idx} — kind: inv|armor|craft|result|fin|ffuel|fout|chest
  function panelRect(w, h) {
    const ph = (win && win.type === 'chest' ? 168 : 166) * GUI;
    return { x: Math.round(w / 2 - 88 * GUI), y: Math.round(h / 2 - ph / 2), w: 176 * GUI, h: ph };
  }

  function layoutSlots(w, h) {
    if (!win) return [];
    const cacheKey = win.type + ':' + (win.page || 0) + '|' + w + 'x' + h + '@' + GUI;
    if (cacheKey === slotLayoutCacheKey) return slotLayoutCache;
    const slots = [];
    const p = panelRect(w, h);
    const invY = p.y + 84 * GUI;
    if (win.type === 'creative') {
      const offset = (win.page || 0) * 45;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) {
        const idx = offset + r * 9 + c;
        if (idx < win.catalog.length) slots.push({ x: p.x + 8 * GUI + c * S, y: p.y + (18 + r * 18) * GUI, kind: 'creative', idx });
      }
    } else {
      // player inventory 9x3
      for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) {
        slots.push({ x: p.x + 8 * GUI + c * S, y: invY + r * S, kind: 'inv', idx: 9 + r * 9 + c });
      }
    }
    // hotbar
    for (let c = 0; c < 9; c++) {
      slots.push({ x: p.x + 8 * GUI + c * S, y: p.y + 142 * GUI, kind: 'inv', idx: c });
    }
    if (win.type === 'inventory') {
      for (let i = 0; i < 4; i++) {
        slots.push({ x: p.x + 8 * GUI, y: p.y + (8 + i * 18) * GUI, kind: 'armor', idx: i });
      }
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
        slots.push({ x: p.x + (88 + c * 18) * GUI, y: p.y + (26 + r * 18) * GUI, kind: 'craft', idx: r * 2 + c });
      }
      slots.push({ x: p.x + 144 * GUI, y: p.y + 35 * GUI, kind: 'result', idx: 0 });
    } else if (win.type === 'crafting') {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        slots.push({ x: p.x + (30 + c * 18) * GUI, y: p.y + (17 + r * 18) * GUI, kind: 'craft', idx: r * 3 + c });
      }
      slots.push({ x: p.x + 124 * GUI, y: p.y + 35 * GUI, kind: 'result', idx: 0 });
    } else if (win.type === 'furnace') {
      slots.push({ x: p.x + 56 * GUI, y: p.y + 17 * GUI, kind: 'fin', idx: 0 });
      slots.push({ x: p.x + 56 * GUI, y: p.y + 53 * GUI, kind: 'ffuel', idx: 1 });
      slots.push({ x: p.x + 116 * GUI, y: p.y + 35 * GUI, kind: 'fout', idx: 2 });
    } else if (win.type === 'chest') {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) {
        slots.push({ x: p.x + (8 + c * 18) * GUI, y: p.y + (17 + r * 18) * GUI, kind: 'chest', idx: r * 9 + c });
      }
    }
    slotLayoutCacheKey = cacheKey;
    slotLayoutCache = slots;
    return slotLayoutCache;
  }

  function slotAt(x, y) {
    const slots = layoutSlots(hud.width, hud.height);
    for (const sl of slots) if (x >= sl.x && x < sl.x + S && y >= sl.y && y < sl.y + S) return sl;
    return null;
  }

  function outsidePanel(x, y) {
    const panel = panelRect(hud.width, hud.height);
    return x < panel.x || x >= panel.x + panel.w || y < panel.y || y >= panel.y + panel.h;
  }

  function slotStack(sl) {
    const p = game.player;
    if (sl.kind === 'inv') return p.inv[sl.idx];
    if (sl.kind === 'armor') return p.equipment[sl.idx];
    if (sl.kind === 'craft') return win.craft[sl.idx];
    if (sl.kind === 'result') return win.result;
    if (sl.kind === 'fin' || sl.kind === 'ffuel' || sl.kind === 'fout') return win.be.slots[sl.idx];
    if (sl.kind === 'chest') return win.be.slots[sl.idx];
    if (sl.kind === 'creative') {
      const item = win.catalog[sl.idx];
      return item ? Items.makeStack(item.id, Items.maxStack(item.id)) : null;
    }
    return null;
  }
  function setSlotStack(sl, v) {
    const p = game.player;
    if (sl.kind === 'inv') p.inv[sl.idx] = v;
    else if (sl.kind === 'armor') { p.equipment[sl.idx] = v; p.updateArmorValue(); }
    else if (sl.kind === 'craft') win.craft[sl.idx] = v;
    else if (sl.kind === 'fin' || sl.kind === 'ffuel' || sl.kind === 'fout') win.be.slots[sl.idx] = v;
    else if (sl.kind === 'chest') win.be.slots[sl.idx] = v;
    activateOpenFurnace();
  }

  function canPlaceInSlot(sl, stack) {
    if (!sl || !stack) return true;
    if (sl.kind !== 'armor') return true;
    const item = Items.get(stack.id);
    return !!(item && item.armor && item.armor.slot === sl.idx && stack.n === 1);
  }

  function activateOpenFurnace() {
    if (!win || !win.be) return;
    if (win.type === 'furnace') game.world.activateFurnace(win.be);
    if ((win.type === 'furnace' || win.type === 'chest') && typeof Network !== 'undefined' && Network.isConnected()) {
      Network.updateContainer(win.be, game.player);
    }
  }

  function refreshCraftResult() {
    if (!win || !win.craft) return;
    const m = Craft.match(win.craft);
    win.result = m ? { id: m.out.id, n: m.out.n } : null;
  }

  function copyStack(s, n) {
    return Items.cloneStack(s, n === undefined ? s.n : n);
  }

  function beginNetworkCraft(shift) {
    if (typeof Network === 'undefined' || !Network.isConnected()) return true;
    if (craftTransaction || !win || !win.craft) return false;
    const snapshot = {
      inv: game.player.inv.map(stack => stack ? Items.cloneStack(stack) : null),
      craft: win.craft.map(stack => stack ? Items.cloneStack(stack) : null),
      cursor: game.player.cursor ? Items.cloneStack(game.player.cursor) : null,
    };
    const transaction = Network.craft(win.craft, shift);
    if (!transaction) return false;
    snapshot.id = transaction;
    craftTransaction = snapshot;
    return true;
  }

  function sameStack(a, b) {
    return !!(a && b && a.id === b.id && a.dur === b.dur && !a.ench && !b.ench && !a.name && !b.name);
  }

  function playSlotSound(volume) {
    Sound.emit('ui.slot', { spatial: false, volume: volume === undefined ? 0.45 : volume, pitch: 1 });
  }

  function claimFurnaceXP(taken, before) {
    if (!win || win.type !== 'furnace' || taken <= 0 || before <= 0) return;
    if (typeof Network !== 'undefined' && Network.isConnected()) return;
    const stored = Math.max(0, Number(win.be.xpStored) || 0);
    const share = Math.min(stored, stored * taken / before);
    win.be.xpStored = Math.max(0, stored - share);
    const points = Math.floor(share + game.world.random());
    if (points <= 0) return;
    game.player.addXP(points);
    Sound.emit('experience.pickup', { spatial: false, volume: 0.62, pitch: 1.02 });
    if (UI.itemPicked) UI.itemPicked('+' + points + ' XP');
  }

  function transferToArray(source, arr, indices) {
    if (!source) return 0;
    const max = Items.maxStack(source.id);
    if (source.dur === undefined) {
      for (const i of indices) {
        const t = arr[i];
        if (!sameStack(source, t) || t.n >= max) continue;
        const add = Math.min(source.n, max - t.n);
        t.n += add; source.n -= add;
        if (source.n <= 0) return 0;
      }
    }
    for (const i of indices) {
      if (arr[i]) continue;
      const add = Math.min(source.n, max);
      arr[i] = copyStack(source, add);
      source.n -= add;
      if (source.n <= 0) return 0;
    }
    return source.n;
  }

  function capacityInArray(source, arr, indices) {
    const max = Items.maxStack(source.id);
    let capacity = 0;
    for (const i of indices) {
      const t = arr[i];
      if (!t) capacity += max;
      else if (source.dur === undefined && sameStack(source, t)) capacity += Math.max(0, max - t.n);
      if (capacity >= source.n) return capacity;
    }
    return capacity;
  }

  function inventoryOrder(mainFirst) {
    const out = [];
    if (mainFirst) for (let i = 9; i < 36; i++) out.push(i);
    for (let i = 0; i < 9; i++) out.push(i);
    if (!mainFirst) for (let i = 9; i < 36; i++) out.push(i);
    return out;
  }

  function shiftClick(sl) {
    const p = game.player;
    if (sl.kind === 'creative') {
      const source = slotStack(sl);
      if (source) p.giveStack(source);
      Sound.play('pop', 0.55, 1.1);
      return;
    }
    if (sl.kind === 'result') {
      if (!win.result) return;
      const made = copyStack(win.result);
      const order = inventoryOrder(true);
      if (capacityInArray(made, p.inv, order) < made.n) return;
      if (!beginNetworkCraft(true)) return;
      transferToArray(made, p.inv, order);
      Craft.consume(win.craft); refreshCraftResult(); Sound.play('pop', 0.7, 1);
      return;
    }
    const source = slotStack(sl);
    if (!source) return;
    const sourceCountBefore = source.n;
    if (sl.kind === 'inv') {
      const sourceItem = Items.get(source.id);
      if (win.type === 'inventory' && sourceItem && sourceItem.armor && !p.equipment[sourceItem.armor.slot]) {
        p.equipment[sourceItem.armor.slot] = source;
        p.inv[sl.idx] = null;
        p.updateArmorValue();
        playSlotSound(0.5);
        return;
      } else if (win.type === 'chest') {
        transferToArray(source, win.be.slots, Array.from({ length: 27 }, (_, i) => i));
      } else if (win.type === 'furnace' && Items.SMELT[source.id]) {
        transferToArray(source, win.be.slots, [0]);
      } else if (win.type === 'furnace' && Items.FUEL[source.id]) {
        transferToArray(source, win.be.slots, [1]);
      } else {
        transferToArray(source, p.inv, sl.idx < 9 ? Array.from({ length: 27 }, (_, i) => i + 9) : Array.from({ length: 9 }, (_, i) => i));
      }
    } else if (sl.kind === 'armor') {
      transferToArray(source, p.inv, inventoryOrder(true));
      if (source.n <= 0) setSlotStack(sl, null);
      if (source.n !== sourceCountBefore) playSlotSound();
      return;
    } else {
      transferToArray(source, p.inv, inventoryOrder(true));
    }
    if (source.n <= 0) setSlotStack(sl, null);
    if (sl.kind === 'fout') claimFurnaceXP(sourceCountBefore - Math.max(0, source.n), sourceCountBefore);
    if (win.craft) refreshCraftResult();
    activateOpenFurnace();
    if (source.n !== sourceCountBefore) playSlotSound();
  }

  function collectMatching(cursor) {
    if (!cursor || cursor.dur !== undefined) return;
    const arrays = [game.player.inv];
    if (win.craft) arrays.push(win.craft);
    if (win.be && win.be.slots) arrays.push(win.be.slots);
    const max = Items.maxStack(cursor.id);
    for (const arr of arrays) for (let i = 0; i < arr.length && cursor.n < max; i++) {
      const s = arr[i];
      if (!s || s === cursor || s.id !== cursor.id || s.dur !== undefined) continue;
      const take = Math.min(s.n, max - cursor.n);
      cursor.n += take; s.n -= take;
      if (s.n <= 0) arr[i] = null;
    }
    if (win.craft) refreshCraftResult();
    activateOpenFurnace();
  }

  function dragOverCurrentSlot() {
    const p = game.player;
    if (!dragState || !p.cursor || p.cursor.n <= 0) return;
    const sl = slotAt(mouseX, mouseY);
    if (!sl || sl.kind === 'result' || sl.kind === 'fout' || sl.kind === 'creative') return;
    const key = sl.kind + ':' + sl.idx;
    if (dragState.visited.has(key)) return;
    if (!canPlaceInSlot(sl, p.cursor)) return;
    const st = slotStack(sl);
    if (st && (!sameStack(st, p.cursor) || st.n >= Items.maxStack(st.id))) return;
    dragState.visited.add(key);
    dragState.targets.set(key, sl);
    dragState.moved = true;
    if (dragState.button === 0) return;
    dragState.origin = null;
    cursorOrigin = null;
    if (st) st.n++;
    else setSlotStack(sl, copyStack(p.cursor, 1));
    p.cursor.n--;
    pulseSlot(sl);
    if (p.cursor.n <= 0) { p.cursor = null; dragState = null; }
    if (win.craft) refreshCraftResult();
    activateOpenFurnace();
    playSlotSound(0.18);
  }

  function finishDrag(event) {
    if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) setMouseFromEvent(event);
    const state = dragState;
    dragState = null;
    const cursor = game && game.player ? game.player.cursor : null;
    if (state && cursor && cursor.n > 0 && outsidePanel(mouseX, mouseY) &&
        dropCursorOutside(state.button, state.origin || cursorOrigin)) return;
    if (!state || state.button !== 0 || !state.moved || !cursor || cursor.n <= 0) return;
    const targets = Array.from(state.targets.values()).filter(sl =>
      sl.kind !== 'result' && sl.kind !== 'fout' && sl.kind !== 'creative' && canPlaceInSlot(sl, cursor));
    if (!targets.length) return;
    const share = Math.floor(cursor.n / targets.length);
    if (share <= 0) return;
    let moved = false;
    for (const sl of targets) {
      const st = slotStack(sl);
      if (st && !sameStack(st, cursor)) continue;
      const room = st ? Items.maxStack(st.id) - st.n : Items.maxStack(cursor.id);
      const add = Math.min(share, room, cursor.n);
      if (add <= 0) continue;
      if (st) st.n += add;
      else setSlotStack(sl, copyStack(cursor, add));
      cursor.n -= add;
      moved = true;
      pulseSlot(sl);
    }
    if (cursor.n <= 0) game.player.cursor = null;
    cursorOrigin = null;
    if (win && win.craft) refreshCraftResult();
    activateOpenFurnace();
    if (moved) playSlotSound(0.3);
  }

  function pulseSlot(sl) {
    slotPulseKey = sl.kind + ':' + sl.idx;
    slotPulseT = 0.16;
  }

  function dropCursorOutside(button, origin) {
    if (button !== 0 && button !== 2) return false;
    const p = game.player;
    const cursor = p && p.cursor;
    if (!cursor || cursor.n <= 0) return false;
    const count = button === 2 ? 1 : cursor.n;
    const multiplayer = typeof Network !== 'undefined' && Network.isConnected();
    if (multiplayer) {
      if (win && win.craft && win.craft.some(Boolean)) {
        UI.toast('请先清空合成格再拖出丢弃');
        return false;
      }
      let sent = false;
      if (origin && (origin.kind === 'inv' || origin.kind === 'armor')) {
        sent = Network.dropInventorySlot(origin.kind, origin.idx, count, cursor);
      } else {
        Network.syncProfile(p);
        sent = Network.dropInventorySlot('cursor', 0, count, cursor);
      }
      if (!sent) return false;
    } else {
      const restoreOrigin = button === 2 && origin && origin.stack &&
        (origin.kind === 'inv' || origin.kind === 'armor');
      const dropped = restoreOrigin ? copyStack(origin.stack, 1) : copyStack(cursor, count);
      const direction = p.lookDir();
      Entities.spawnItem(p.x + direction[0] * 0.8, p.y + p.eye - 0.3, p.z + direction[2] * 0.8,
        dropped.id, dropped.n, direction[0] * 5, direction[1] * 5 + 2, direction[2] * 5, dropped);
      if (restoreOrigin) {
        const remainder = copyStack(origin.stack, origin.stack.n - 1);
        setSlotStack({ kind: origin.kind, idx: origin.idx }, remainder.n > 0 ? remainder : null);
        p.cursor = null;
      } else {
        cursor.n -= count;
        if (cursor.n <= 0) p.cursor = null;
      }
    }
    cursorOrigin = null;
    Sound.play('pop', 0.5, 0.9);
    return true;
  }

  function onWindowClick(button, shift) {
    const p = game.player;
    const target = slotAt(mouseX, mouseY);
    if (!target) {
      if (p.cursor && outsidePanel(mouseX, mouseY)) dropCursorOutside(button, null);
      return;
    }
    if (craftTransaction && win && win.craft) {
      UI.toast('正在等待服务器确认合成');
      return;
    }
    pulseSlot(target);
    if (shift) { cursorOrigin = null; shiftClick(target); return; }
    if (target.kind === 'creative') {
      const source = slotStack(target);
      if (source) {
        p.cursor = copyStack(source, button === 2 ? 1 : source.n);
        playSlotSound(0.5);
      }
      cursorOrigin = null;
      return;
    }
    const cur = p.cursor;
    const st = slotStack(target);
    const sourceBefore = !cur && st ? copyStack(st) : null;
    const clickId = (st || cur || {}).id || 0;
    const now = performance.now();
    if (button === 0 && p.cursor && clickId === lastClick.id && now - lastClick.at < 280) {
      const countBefore = p.cursor.n;
      collectMatching(p.cursor);
      if (p.cursor.n !== countBefore) playSlotSound(0.5);
      cursorOrigin = null;
      lastClick = { at: 0, id: 0 };
      return;
    }
    lastClick = { at: now, id: clickId };

    if (target.kind === 'result') {
      if (!win.result) return;
      const max = Items.maxStack(win.result.id);
      if (cur && (cur.id !== win.result.id || cur.n + win.result.n > max)) return;
      if (!beginNetworkCraft(false)) return;
      if (cur) cur.n += win.result.n;
      else {
        p.cursor = Items.makeStack(win.result.id, win.result.n);
      }
      cursorOrigin = null;
      Craft.consume(win.craft);
      refreshCraftResult();
      Sound.play('pop', 0.7, 1);
      return;
    }

    if (target.kind === 'fout' && cur) return;
    if (cur && !canPlaceInSlot(target, cur)) return;

    let changed = false;
    if (button === 0) {
      // left: swap / merge
      if (cur && st && cur.id === st.id && cur.dur === undefined && st.dur === undefined) {
        const max = Items.maxStack(st.id);
        const add = Math.min(cur.n, max - st.n);
        st.n += add; cur.n -= add;
        changed = add > 0;
        if (cur.n <= 0) p.cursor = null;
      } else if (cur || st) {
        setSlotStack(target, cur);
        p.cursor = st || null;
        changed = true;
      }
    } else if (button === 2) {
      // right: place one / split half
      if (cur) {
        if (!st) {
          const one = copyStack(cur, 1);
          setSlotStack(target, one);
          cur.n--;
          changed = true;
          if (cur.n <= 0) p.cursor = null;
        } else if (st.id === cur.id && st.n < Items.maxStack(st.id) && st.dur === undefined) {
          st.n++; cur.n--;
          changed = true;
          if (cur.n <= 0) p.cursor = null;
        }
      } else if (st) {
        const half = Math.ceil(st.n / 2);
        p.cursor = copyStack(st, half);
        st.n -= half;
        changed = true;
        if (st.n <= 0) setSlotStack(target, null);
      }
    }
    if (!cur && st && p.cursor && (target.kind === 'inv' || target.kind === 'armor')) {
      cursorOrigin = { kind: target.kind, idx: target.idx, id: p.cursor.id, stack: sourceBefore };
    } else if (cur) {
      cursorOrigin = null;
    }
    if (win.craft) refreshCraftResult();
    if (target.kind === 'fout' && sourceBefore) {
      const remaining = slotStack(target);
      claimFurnaceXP(sourceBefore.n - (remaining ? remaining.n : 0), sourceBefore.n);
    }
    activateOpenFurnace();
    if (changed) playSlotSound(0.5);
    if (p.cursor && (button === 0 || button === 2)) {
      const key = target.kind + ':' + target.idx;
      dragState = {
        button, visited: new Set([key]), targets: new Map([[key, target]]), moved: false,
        origin: cursorOrigin ? Object.assign({}, cursorOrigin) : null,
      };
    }
  }

  UI.handleKey = function (e) {
    if (!win) return false;
    if (win.type === 'sign') {
      if (e.code === 'Escape') finishSignEditor();
      return true;
    }
    if (win.type === 'creative' && (e.code === 'PageUp' || e.code === 'PageDown')) {
      const pages = Math.max(1, Math.ceil(win.catalog.length / 45));
      win.page = U.mod(win.page + (e.code === 'PageDown' ? 1 : -1), pages);
      slotLayoutCacheKey = '';
      Sound.play('click', 0.25, 1.2);
      return true;
    }
    if (!e.code.startsWith('Digit')) return false;
    const n = +e.code.slice(5) - 1;
    if (n < 0 || n > 8) return false;
    const sl = slotAt(mouseX, mouseY);
    if (!sl || sl.kind === 'result' || sl.kind === 'fout') return true;
    if (sl.kind === 'creative') {
      const source = slotStack(sl);
      game.player.inv[n] = source ? copyStack(source) : null;
      Sound.play('pop', 0.5, 1.1);
      return true;
    }
    const hot = game.player.inv[n];
    const st = slotStack(sl);
    if (hot && !canPlaceInSlot(sl, hot)) return true;
    const changed = !!(hot || st) && !(sl.kind === 'inv' && sl.idx === n);
    if (changed) {
      setSlotStack(sl, hot);
      game.player.inv[n] = st || null;
      pulseSlot(sl);
      if (win.craft) refreshCraftResult();
      activateOpenFurnace();
      playSlotSound(0.5);
    }
    return true;
  };

  // ---------------- drawing ----------------
  function quadPath(pts) {
    hctx.beginPath();
    hctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) hctx.lineTo(pts[i][0], pts[i][1]);
    hctx.closePath();
  }

  function drawTexturedQuad(atlas, tile, pts) {
    const r = Textures.rect(tile);
    const p0 = pts[0], p1 = pts[1], p3 = pts[3];
    hctx.save();
    quadPath(pts);
    hctx.clip();
    hctx.setTransform(
      (p1[0] - p0[0]) / 16, (p1[1] - p0[1]) / 16,
      (p3[0] - p0[0]) / 16, (p3[1] - p0[1]) / 16,
      p0[0], p0[1]
    );
    hctx.imageSmoothingEnabled = false;
    hctx.drawImage(atlas, r[0], r[1], 16, 16, 0, 0, 16, 16);
    hctx.restore();
  }

  function shadeQuad(pts, alpha) {
    hctx.save();
    quadPath(pts);
    hctx.fillStyle = 'rgba(0,0,0,' + alpha + ')';
    hctx.fill();
    hctx.restore();
  }

  function drawModelBoxesIcon(atlas, def, boxes, x, y, size) {
    const t = def.tex;
    const maxY = Math.max(1, ...boxes.map(box => box.y + box.h));
    const cx = x + size * 0.5, baseY = y + size * 0.72;
    const halfW = size * 0.32, halfH = size * 0.16, vertical = size * 0.52 / maxY;
    const project = (px, py, pz) => [
      cx + (px - pz) * halfW,
      baseY + (px + pz - 1) * halfH - py * vertical,
    ];
    const faces = [];
    const addFace = (points, tile, shade, depth) => {
      if (tile) faces.push({ points, tile, shade, depth });
    };
    for (const box of boxes) {
      const x0 = box.x, x1 = box.x + box.w;
      const y0 = box.y, y1 = box.y + box.h;
      const z0 = box.z, z1 = box.z + box.d;
      const tile = box.tile;
      const topT = tile || t.all || t.top || t.side || t.front;
      const sideT = tile || t.all || t.side || t.top || t.front;
      const frontT = tile || t.all || t.front || t.side || t.top;
      addFace([project(x0,y1,z1), project(x0,y1,z0), project(x1,y1,z0), project(x1,y1,z1)],
        topT, 0, (x0 + x1 + z0 + z1) * 0.25 + 0.02);
      addFace([project(x0,y1,z1), project(x1,y1,z1), project(x1,y0,z1), project(x0,y0,z1)],
        frontT, 0.18, (x0 + x1) * 0.5 + z1);
      addFace([project(x1,y1,z1), project(x1,y1,z0), project(x1,y0,z0), project(x1,y0,z1)],
        sideT, 0.32, x1 + (z0 + z1) * 0.5);
    }
    faces.sort((a, b) => a.depth - b.depth);
    for (const face of faces) {
      drawTexturedQuad(atlas, face.tile, face.points);
      if (face.shade > 0) shadeQuad(face.points, face.shade);
    }
  }

  function drawBlockIcon(atlas, def, x, y, size) {
    const t = def.tex;
    const topT = t.all || t.top || t.side || t.front;
    const sideT = t.all || t.side || t.top || t.front;
    const frontT = t.all || t.front || t.side || t.top;
    if (!topT) return;

    if (def.shape === 'cross' || def.shape === 'torch' || def.shape === 'liquid') {
      const r = Textures.rect(topT);
      hctx.drawImage(atlas, r[0], r[1], 16, 16, x + size * 0.1, y + size * 0.1, size * 0.8, size * 0.8);
      return;
    }

    const modelBoxes = Blocks.itemModelBoxes ? Blocks.itemModelBoxes(def.id) : [];
    if (modelBoxes.length) {
      drawModelBoxesIcon(atlas, def, modelBoxes, x, y, size);
      return;
    }

    const cx = x + size * 0.5;
    const slab = def.shape === 'slab';
    const topY = y + size * (slab ? 0.30 : 0.11);
    const halfW = size * 0.34;
    const halfH = size * 0.17;
    const sideH = size * (slab ? 0.24 : 0.48);
    const top = [cx, topY];
    const right = [cx + halfW, topY + halfH];
    const mid = [cx, topY + halfH * 2];
    const left = [cx - halfW, topY + halfH];
    const bottom = [cx, mid[1] + sideH];
    const leftBottom = [left[0], left[1] + sideH];
    const rightBottom = [right[0], right[1] + sideH];

    const leftFace = [left, mid, bottom, leftBottom];
    const rightFace = [mid, right, rightBottom, bottom];
    const topFace = [left, top, right, mid];
    drawTexturedQuad(atlas, frontT, leftFace);
    drawTexturedQuad(atlas, sideT, rightFace);
    if (!def.transparent) {
      shadeQuad(leftFace, 0.18);
      shadeQuad(rightFace, 0.32);
    }
    drawTexturedQuad(atlas, topT, topFace);
  }

  function cachedItemIcon(id, size) {
    const pixels = Math.max(1, Math.round(size));
    const key = id + '@' + pixels;
    let canvas = itemIconCache.get(key);
    if (canvas) return canvas;
    canvas = document.createElement('canvas');
    canvas.width = pixels; canvas.height = pixels;
    const iconCtx = canvas.getContext('2d');
    iconCtx.imageSmoothingEnabled = false;
    const previous = hctx;
    hctx = iconCtx;
    try {
      const it = Items.get(id);
      if (it && it.block && it.handModel !== 'sprite') {
        drawBlockIcon(Textures.atlas.canvas, Blocks.get(id), 0, 0, pixels);
      } else if (it) {
        const def = it.block ? Blocks.get(id) : null;
        const tile = it.tex || (def && (def.tex.icon || def.tex.all || def.tex.front || def.tex.side || def.tex.top)) || 'stick';
        const r = Textures.rect(tile);
        iconCtx.drawImage(Textures.atlas.canvas, r[0], r[1], 16, 16,
          pixels * 0.08, pixels * 0.08, pixels * 0.84, pixels * 0.84);
      }
    } finally {
      hctx = previous;
    }
    itemIconCache.set(key, canvas);
    return canvas;
  }

  function drawItemIcon(x, y, size, stack) {
    if (!stack) return;
    const it = Items.get(stack.id);
    if (!it) return;
    hctx.drawImage(cachedItemIcon(stack.id, size), Math.round(x), Math.round(y));
    if (stack.ench) {
      hctx.save();
      hctx.globalAlpha = 0.28;
      hctx.fillStyle = '#b04cff';
      hctx.beginPath(); hctx.rect(x + size * 0.08, y + size * 0.08, size * 0.84, size * 0.84); hctx.clip();
      for (let stripe = -size; stripe < size * 2; stripe += Math.max(3, 3 * GUI)) {
        hctx.fillRect(x + stripe, y, Math.max(1, GUI), size * 1.5);
      }
      hctx.restore();
    }
    // count
    if (stack.n > 1) {
      drawPixelText(String(stack.n), x + size - GUI, y + size - GUI * 1.5,
        Math.max(8, size * 0.34), 'right', '#fff', 1, true);
    }
    // durability bar
    if (stack.dur !== undefined) {
      const maxDurability = Items.durabilityOf(stack.id);
      if (maxDurability > 0) {
        const f = stack.dur / maxDurability;
        if (f < 1) {
          hctx.fillStyle = '#171717';
          hctx.fillRect(x + 2 * GUI, y + size - 3 * GUI, size - 4 * GUI, 2 * GUI);
          hctx.fillStyle = f > 0.5 ? '#4c4' : f > 0.2 ? '#cc4' : '#c44';
          hctx.fillRect(x + 2 * GUI, y + size - 3 * GUI, Math.round((size - 4 * GUI) * f), GUI);
        }
      }
    }
  }

  function drawSlot(x, y, highlight) {
    drawGui('slot', x, y, S, S);
    if (highlight) {
      hctx.fillStyle = 'rgba(255,255,255,0.42)';
      hctx.fillRect(Math.round(x + 2 * GUI), Math.round(y + 2 * GUI), S - 4 * GUI, S - 4 * GUI);
    }
  }

  UI.draw = function (dt) {
    const w = hud.width, h = hud.height;
    updateGuiScale(w, h);
    syncNicknameInput(UI.currentScreen(), w, h);
    hctx.clearRect(0, 0, w, h);
    const p = game.player;
    hitT = Math.max(0, hitT - dt);
    slotPulseT = Math.max(0, slotPulseT - dt);
    pickupT = Math.max(0, pickupT - dt);

    if (game.state === 'menu') { drawMenuScreen(w, h); drawToast(w, h, dt); return; }
    if (game.state === 'dead') { drawDeath(w, h); return; }

    const headId = game.world.getBlock(Math.floor(p.x), Math.floor(p.y + p.eye), Math.floor(p.z));
    if (headId === Blocks.ID.WATER) {
      hctx.fillStyle = 'rgba(18,55,120,0.22)';
      hctx.fillRect(0, 0, w, h);
    } else if (headId === Blocks.ID.LAVA) {
      hctx.fillStyle = 'rgba(235,75,10,0.48)';
      hctx.fillRect(0, 0, w, h);
    } else if (Blocks.isOpaque(headId)) {
      drawInsideBlockOverlay(headId, w, h);
    }

    // damage flash
    if (p.hurtTime > 0.3) {
      hctx.fillStyle = 'rgba(255,0,0,' + ((p.hurtTime - 0.3) * 1.2) + ')';
      hctx.fillRect(0, 0, w, h);
    }

    drawWorldSigns(w, h);
    drawRemoteNames(w, h);
    drawBossBar(w);
    if (UI.shouldDrawGameplayHud(win)) {
      if (!game.paused) drawCrosshair(w, h);
      drawHotbar(w, h, dt);
      if (p.mode === 'survival') {
        drawExperience(w, h);
        drawHearts(w, h);
        drawHunger(w, h);
        drawAir(w, h);
        drawArmor(w, h);
        drawStatusEffects(w, h);
      }
    }
    drawNetworkStatus(w);
    drawChat(w, h);
    if (playerListVisible) drawPlayerList(w, h);
    if (win) drawWindow(w, h);
    if (game.paused && !win) drawMenuScreen(w, h);
    drawToast(w, h, dt);
    if (!win) drawPickup(w, h);
    if (game.showDebug) drawDebug(w, h);
  };

  function drawCrosshair(w, h) {
    const size = 15;
    drawGui('crosshair', w / 2 - size / 2, h / 2 - size / 2, size, size, hitT > 0 ? 1 : 0.92);
    const strength = game.player.attackStrength ? game.player.attackStrength() : 1;
    if (strength < 0.995) {
      const barW = 16 * GUI, barH = Math.max(2, GUI);
      const x = Math.round(w / 2 - barW / 2), y = Math.round(h / 2 + 11 * GUI);
      hctx.fillStyle = 'rgba(0,0,0,0.8)'; hctx.fillRect(x - GUI, y - GUI, barW + GUI * 2, barH + GUI * 2);
      hctx.fillStyle = '#7f7f7f'; hctx.fillRect(x, y, barW, barH);
      hctx.fillStyle = strength > 0.9 ? '#ffffff' : '#d8d8d8'; hctx.fillRect(x, y, Math.round(barW * strength), barH);
    }
  }

  function drawInsideBlockOverlay(id, w, h) {
    const def = Blocks.get(id);
    const tile = def.tex && (def.tex.all || def.tex.side || def.tex.top || def.tex.front);
    if (!tile || !Textures.atlas) {
      hctx.fillStyle = 'rgba(24,20,16,0.88)';
      hctx.fillRect(0, 0, w, h);
      return;
    }
    const uv = Textures.uv(tile);
    const atlas = Textures.atlas;
    const sx = Math.round(uv[0] * atlas.size);
    const sy = Math.round(uv[1] * atlas.size);
    const sw = Math.max(1, Math.round((uv[2] - uv[0]) * atlas.size));
    const sh = Math.max(1, Math.round((uv[3] - uv[1]) * atlas.size));
    const size = Math.max(96, Math.ceil(Math.min(w, h) / 3));
    hctx.save();
    hctx.imageSmoothingEnabled = false;
    hctx.globalAlpha = 0.88;
    for (let y = 0; y < h; y += size) for (let x = 0; x < w; x += size) {
      hctx.drawImage(atlas.canvas, sx, sy, sw, sh, x, y, size, size);
    }
    hctx.globalAlpha = 1;
    hctx.fillStyle = 'rgba(0,0,0,0.18)';
    hctx.fillRect(0, 0, w, h);
    hctx.restore();
  }

  function drawNetworkStatus(w) {
    if (typeof Network === 'undefined' || !Network.isConnected()) return;
    const status = Network.status();
    const roleText = status.role === 'admin' ? '管理员' : status.role === 'moderator' ? '管理' : '生存';
    drawPixelText(status.name + '  |  ' + roleText + '  |  联机 ' + status.players + ' 人  ' + status.latency + 'ms', w / 2, 12 * GUI, 6 * GUI, 'center', '#aaffaa');
  }

  function drawChat(w, h) {
    if (!game.multiplayer || (!chatOpen && !chatMessages.length)) return;
    const now = performance.now();
    const visible = chatMessages.filter(message => chatOpen || now - message.at < 10000).slice(-10);
    const lineHeight = Math.max(16, 8 * GUI);
    const fontSize = Math.max(13, 7 * GUI);
    const baseY = h - 48 * GUI;
    hctx.save();
    hctx.font = unicodeFont(fontSize, false);
    hctx.textBaseline = 'bottom';
    for (let index = 0; index < visible.length; index++) {
      const message = visible[visible.length - 1 - index];
      const age = now - message.at;
      const alpha = chatOpen ? 1 : U.clamp((10000 - age) / 2000, 0, 1);
      if (alpha <= 0) continue;
      const y = baseY - index * lineHeight;
      const width = Math.min(w - 16, Math.ceil(hctx.measureText(message.text).width) + 10);
      hctx.fillStyle = 'rgba(0,0,0,' + (0.48 * alpha) + ')';
      hctx.fillRect(6, y - lineHeight + 2, width, lineHeight);
      hctx.globalAlpha = alpha;
      hctx.fillStyle = message.kind === 'system' ? '#ffff55' : '#ffffff';
      hctx.fillText(message.text, 10, y);
      hctx.globalAlpha = 1;
    }
    hctx.restore();
  }

  function drawPlayerList(w, h) {
    if (!game.multiplayer || typeof Network === 'undefined' || !Network.isConnected()) return;
    const status = Network.status();
    const entries = [{ name: status.name, role: status.role, latency: status.latency }]
      .concat(Network.remotePlayers().map(player => ({ name: player.name, role: player.role, latency: player.latency, hp: player.hp })));
    const columns = entries.length > 10 ? 2 : 1;
    const rows = Math.ceil(entries.length / columns);
    const cellW = Math.min(220, Math.floor((w - 40) / columns));
    const lineH = Math.max(18, 9 * GUI);
    const panelW = cellW * columns + 12;
    const panelH = 28 + rows * lineH;
    const x = Math.round((w - panelW) / 2), y = Math.max(28, 18 * GUI);
    hctx.fillStyle = 'rgba(0,0,0,0.72)';
    hctx.fillRect(x, y, panelW, panelH);
    drawPixelText('WebCraft 服务器', w / 2, y + 8 * GUI, 7 * GUI, 'center', '#fff');
    hctx.save();
    hctx.font = unicodeFont(Math.max(13, 7 * GUI), false);
    hctx.textBaseline = 'middle';
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      const column = Math.floor(index / rows), row = index % rows;
      const tx = x + 8 + column * cellW, ty = y + 27 + row * lineH;
      const badge = entry.role === 'admin' ? '[管理员] ' : entry.role === 'moderator' ? '[管理] ' : '';
      hctx.fillStyle = entry.role === 'admin' ? '#ffdd55' : '#fff';
      hctx.fillText(badge + entry.name, tx, ty);
      hctx.textAlign = 'right';
      hctx.fillStyle = (entry.latency || 0) < 150 ? '#55ff55' : (entry.latency || 0) < 350 ? '#ffff55' : '#ff5555';
      hctx.fillText((entry.latency || 0) + 'ms', tx + cellW - 14, ty);
      hctx.textAlign = 'left';
    }
    hctx.restore();
  }

  function signTextCanvas(lines) {
    const cleanLines = normalizeSignLines(lines);
    const key = cleanLines.join('\n');
    let canvas = signTextCache.get(key);
    if (canvas) return canvas;
    if (signTextCache.size >= 128) signTextCache.clear();
    canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1d1710';
    ctx.font = '24px ' + UI_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let index = 0; index < 4; index++) ctx.fillText(cleanLines[index], 128, 18 + index * 31, 236);
    signTextCache.set(key, canvas);
    return canvas;
  }

  function cachedSigns() {
    const world = game.world;
    const version = Number(world.blockEntityVersion) || 0;
    if (signCacheWorld !== world || signCacheVersion !== version) {
      signCacheWorld = world;
      signCacheVersion = version;
      signEntities = Array.from(world.be.values()).filter(be => be && be.type === 'sign');
    }
    return signEntities;
  }

  function drawWorldSigns(w, h) {
    if (!game.world || !game.player || !Renderer.projectPoint) return;
    const world = game.world;
    const player = game.player;
    const eyeX = player.viewX === null ? player.x : player.viewX;
    const eyeY = (player.viewY === null ? player.y : player.viewY) + player.eye;
    const eyeZ = player.viewZ === null ? player.z : player.viewZ;
    const directions = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
    for (const be of cachedSigns()) {
      if (world.getBlock(be.x, be.y, be.z) !== Blocks.ID.OAK_SIGN) continue;
      const lines = normalizeSignLines(be.lines || be.text || '');
      if (!lines.some(Boolean)) continue;
      const state = world.getState(be.x, be.y, be.z) | 0;
      const front = directions[state & 3];
      const wall = !!(state & 4);
      const cx = be.x + 0.5 - (wall ? front[0] * 0.375 : 0);
      const cy = be.y + (wall ? 8.5 / 16 : 11.5 / 16);
      const cz = be.z + 0.5 - (wall ? front[2] * 0.375 : 0);
      const dx = cx - eyeX, dy = cy - eyeY, dz = cz - eyeZ;
      const distance = Math.hypot(dx, dy, dz);
      if (distance < 0.65 || distance > 32) continue;
      const facingCos = ((eyeX - cx) * front[0] + (eyeZ - cz) * front[2]) / distance;
      if (facingCos <= 0.16) continue;
      const obstruction = world.raycast(eyeX, eyeY, eyeZ, dx / distance, dy / distance, dz / distance, distance + 0.12);
      if (!obstruction || obstruction.x !== be.x || obstruction.y !== be.y || obstruction.z !== be.z) continue;

      const rightX = front[2], rightZ = -front[0];
      const center = Renderer.projectPoint(cx + front[0] * 0.006, cy, cz + front[2] * 0.006);
      const left = Renderer.projectPoint(cx - rightX * 0.43, cy, cz - rightZ * 0.43);
      const right = Renderer.projectPoint(cx + rightX * 0.43, cy, cz + rightZ * 0.43);
      const top = Renderer.projectPoint(cx, cy + 0.23, cz);
      const bottom = Renderer.projectPoint(cx, cy - 0.23, cz);
      if (!center || !left || !right || !top || !bottom) continue;
      const widthX = (right.x - left.x) * w, widthY = (right.y - left.y) * h;
      const heightX = (bottom.x - top.x) * w, heightY = (bottom.y - top.y) * h;
      if (Math.hypot(widthX, widthY) < 4 || Math.hypot(heightX, heightY) < 4 ||
          Math.abs(widthX * heightY - widthY * heightX) < 16) continue;
      const canvas = signTextCanvas(lines);
      const ax = (right.x - left.x) * w / canvas.width;
      const ay = (right.y - left.y) * h / canvas.width;
      const bx = (bottom.x - top.x) * w / canvas.height;
      const by = (bottom.y - top.y) * h / canvas.height;
      const centerX = center.x * w, centerY = center.y * h;
      hctx.save();
      hctx.setTransform(ax, ay, bx, by,
        centerX - ax * canvas.width / 2 - bx * canvas.height / 2,
        centerY - ay * canvas.width / 2 - by * canvas.height / 2);
      hctx.globalAlpha = U.clamp((34 - distance) / 6, 0.35, 1);
      hctx.drawImage(canvas, 0, 0);
      hctx.restore();
    }
  }

  function drawRemoteNames(w, h) {
    if (!game.multiplayer || typeof Network === 'undefined' || !Network.isConnected() || !Renderer.projectPoint) return;
    const player = game.player;
    const remotes = Network.remotePlayers();
    for (const remote of remotes) {
      if (!remote || remote.dead || !remote.name) continue;
      const dx = remote.x - player.x, dy = remote.y - player.y, dz = remote.z - player.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance > 64 || distance < 0.35) continue;
      const point = Renderer.projectPoint(remote.x, remote.y + (remote.sneaking ? 1.95 : 2.18), remote.z);
      if (!point) continue;
      const x = Math.round(point.x * w), y = Math.round(point.y * h);
      const alpha = U.clamp((64 - distance) / 16, 0, 1) * (remote.sneaking ? 0.65 : 1);
      if (alpha <= 0) continue;
      const fontSize = Math.max(12, 6 * GUI);
      hctx.font = unicodeFont(fontSize, false);
      const textWidth = Math.ceil(hctx.measureText(remote.name).width);
      const padX = 3 * GUI, boxH = Math.max(10 * GUI, fontSize + 4 * GUI);
      hctx.fillStyle = 'rgba(0,0,0,' + (0.34 * alpha) + ')';
      hctx.fillRect(Math.round(x - textWidth / 2 - padX), Math.round(y - boxH + 2 * GUI), textWidth + padX * 2, boxH);
      drawPixelText(remote.name, x, y, fontSize, 'center', '#fff', alpha);
    }
  }

  function drawBossBar(w) {
    let dragon = null;
    if (typeof Entities !== 'undefined' && Array.isArray(Entities.list)) {
      dragon = Entities.list.find(entity => entity && !entity.dead && entity.kind === 'ender_dragon' && entity.hp > 0) || null;
    }
    if (!dragon && game.multiplayer && typeof Network !== 'undefined' && Network.isConnected()) {
      dragon = Network.remoteEntities().find(entity => entity && !entity.dead && entity.kind === 'ender_dragon' && entity.hp > 0) || null;
    }
    if (!dragon) return;

    const ratio = U.clamp((Number(dragon.hp) || 0) / 200, 0, 1);
    const barW = Math.max(80, Math.min(182 * GUI, w - 32));
    const barH = Math.max(6, 5 * GUI);
    const x = Math.round((w - barW) / 2);
    const y = Math.round(31 * GUI);
    drawPixelText('末影龙', w / 2, y - 10 * GUI, Math.max(12, 7 * GUI), 'center', '#ffffff');
    hctx.fillStyle = '#000000';
    hctx.fillRect(x - GUI, y - GUI, barW + GUI * 2, barH + GUI * 2);
    hctx.fillStyle = '#3b103f';
    hctx.fillRect(x, y, barW, barH);
    hctx.fillStyle = '#b02ebc';
    hctx.fillRect(x, y, Math.round(barW * ratio), barH);
    if (ratio > 0) {
      hctx.fillStyle = '#e367ec';
      hctx.fillRect(x, y, Math.round(barW * ratio), Math.max(1, GUI));
    }
  }

  function drawHotbar(w, h, dt) {
    const p = game.player;
    const x0 = Math.round(w / 2 - 91 * GUI), y0 = h - 22 * GUI - 4;
    drawGui('hotbar', x0, y0, 182 * GUI, 22 * GUI);
    for (let i = 0; i < 9; i++) {
      const x = x0 + (3 + i * 20) * GUI;
      drawItemIcon(x, y0 + 3 * GUI, 16 * GUI, p.inv[i]);
    }
    drawGui('selector', x0 + (p.hotbar * 20 - 1) * GUI, y0 - GUI, 24 * GUI, 24 * GUI);

    const held = p.inv[p.hotbar];
    const id = held ? held.id : 0;
    if (id !== heldNameId) { heldNameId = id; heldNameT = 2.1; }
    else heldNameT = Math.max(0, heldNameT - dt);
    if (held && heldNameT > 0) {
      const it = Items.get(held.id);
      if (it) {
        const a = Math.min(1, heldNameT * 2);
        drawPixelText(held.name || it.name, w / 2, y0 - 29 * GUI, 8 * GUI, 'center', held.ench ? '#b86cff' : '#fff', a);
      }
    }
  }
  UI.hotbarSlotAt = function (x, y) {
    if (!hud || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const x0 = Math.round(hud.width / 2 - 91 * GUI), y0 = hud.height - 22 * GUI - 4;
    if (x < x0 || x >= x0 + 182 * GUI || y < y0 - 4 * GUI || y >= y0 + 24 * GUI) return null;
    const slot = Math.floor((x - x0 - GUI) / (20 * GUI));
    return slot >= 0 && slot < 9 ? slot : null;
  };
  function drawExperience(w, h) {
    const p = game.player;
    const x0 = Math.round(w / 2 - 91 * GUI), hotY = h - 22 * GUI - 4;
    const y = hotY - 6 * GUI;
    drawGui('xp_bg', x0, y, 182 * GUI, 5 * GUI);
    const progress = U.clamp(p.xpProgress || 0, 0, 1);
    if (progress > 0) {
      hctx.save(); hctx.beginPath(); hctx.rect(x0, y, 182 * GUI * progress, 5 * GUI); hctx.clip();
      drawGui('xp_fill', x0, y, 182 * GUI, 5 * GUI); hctx.restore();
    }
    if ((p.xpLevel || 0) > 0) drawPixelText(String(p.xpLevel), w / 2, y - GUI, 7 * GUI, 'center', '#80ff20', 1, true);
  }
  function drawHearts(w, h) {
    const p = game.player;
    const x0 = Math.round(w / 2 - 91 * GUI), y0 = h - 39 * GUI - 4;
    const lowTick = Math.floor((game.world.time || 0) * 20);
    for (let i = 0; i < 10; i++) {
      const hpHere = p.hp - i * 2;
      const lowJitter = p.hp <= 4 && U.posRand(game.world.seed, i, lowTick, 0x4845) > 0.55 ? -GUI : 0;
      const jitter = (p.hurtTime > 0.3 && (i & 1) ? -GUI : 0) + lowJitter;
      const x = x0 + i * 8 * GUI, y = y0 + jitter;
      drawGui('heart_empty', x, y, 9 * GUI, 9 * GUI);
      if (hpHere >= 2) drawGui('heart_full', x, y, 9 * GUI, 9 * GUI);
      else if (hpHere === 1) drawGui('heart_half', x, y, 9 * GUI, 9 * GUI);
    }
  }
  function drawHunger(w, h) {
    const p = game.player;
    const y0 = h - 39 * GUI - 4;
    const hungerEffect = (p.statusEffects || []).some(e => e.type === 'hunger');
    const pulse = p.hunger <= 6 || hungerEffect ? (0.62 + Math.sin((game.world.time || 0) * 12) * 0.25) : 1;
    for (let i = 0; i < 10; i++) {
      const xx = Math.round(w / 2 + 91 * GUI - (i + 1) * 8 * GUI - GUI);
      const hunHere = p.hunger - i * 2;
      const y = y0 + (p.hunger <= 6 && (i & 1) ? GUI : 0);
      drawGui('food_empty', xx, y, 9 * GUI, 9 * GUI, pulse);
      if (hunHere >= 2) drawGui('food_full', xx, y, 9 * GUI, 9 * GUI, pulse);
      else if (hunHere === 1) drawGui('food_half', xx, y, 9 * GUI, 9 * GUI, pulse);
    }
  }
  function drawAir(w, h) {
    const p = game.player;
    if (p.air >= p.maxAir) return;
    const count = Math.ceil(U.clamp(p.air / p.maxAir, 0, 1) * 10);
    const y0 = h - 49 * GUI - 4;
    for (let i = 0; i < count; i++) {
      const xx = Math.round(w / 2 + 91 * GUI - (i + 1) * 8 * GUI - GUI);
      drawGui('air', xx, y0, 9 * GUI, 9 * GUI);
    }
  }
  function drawArmor(w, h) {
    const p = game.player;
    if (!(p.armor > 0)) return;
    const x0 = Math.round(w / 2 - 91 * GUI), y0 = h - 49 * GUI - 4;
    for (let i = 0; i < 10; i++) {
      const value = p.armor - i * 2;
      const name = value >= 2 ? 'armor_full' : value === 1 ? 'armor_half' : 'armor_empty';
      drawGui(name, x0 + i * 8 * GUI, y0, 9 * GUI, 9 * GUI);
    }
  }

  function drawPlayerPreview3D(p) {
    const boxX = p.x + 30 * GUI, boxY = p.y + 18 * GUI, boxW = 44 * GUI, boxH = 54 * GUI;
    const centerX = boxX + boxW / 2, baseY = boxY + boxH - 3 * GUI;
    const yaw = PLAYER_PREVIEW_BASE_YAW + U.clamp((mouseX - centerX) / Math.max(1, boxW), -0.5, 0.5) * 1.1;
    const scale = 10.5 * GUI;
    const ca = Math.cos(yaw), sa = Math.sin(yaw);
    const facesToDraw = [];
    const skinPalettes = {
      steve: { skin:[201,139,104], hair:[73,45,31], shirt:[48,119,158], pants:[58,58,108], shoe:[40,40,70] },
      alex: { skin:[217,161,123], hair:[184,95,45], shirt:[119,168,63], pants:[93,81,72], shoe:[52,47,43] },
      miner: { skin:[184,120,88], hair:[47,36,30], shirt:[178,138,50], pants:[61,85,104], shoe:[37,43,48] },
      wanderer: { skin:[143,95,70], hair:[36,26,24], shirt:[143,63,63], pants:[53,60,88], shoe:[30,34,50] },
    };
    const previewSkin = Textures.normalizeSkin
      ? Textures.normalizeSkin((game.player && game.player.skin) || game.playerSkin)
      : 'steve';
    const palette = skinPalettes[previewSkin] || skinPalettes.steve;
    const skinAtlas = Textures.atlas && Textures.atlas.canvas;
    const slim = game.playerModel === 'slim';
    const armWidth = slim ? 0.3 : 0.4, armX = 0.4 + armWidth / 2;
    const project = (x, y, z) => {
      const rx = x * ca - z * sa, rz = x * sa + z * ca;
      return { x: centerX + rx * scale, y: baseY - y * scale + rz * scale * 0.2, d: rz };
    };
    const shade = (rgb, f) => 'rgb(' + rgb.map(v => Math.round(U.clamp(v * f, 0, 255))).join(',') + ')';
    const cuboid = (cx, cy, cz, sx, sy, sz, rgb, outline, texturePart) => {
      const v = [];
      for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        v.push(project(cx + (x - 0.5) * sx, cy + (y - 0.5) * sy, cz + (z - 0.5) * sz));
      }
      const faces = [
        { name:'left', i:[0,4,6,2], s:0.72, map:[3,2,0] },
        { name:'right', i:[1,3,7,5], s:0.9, map:[1,2,0] },
        { name:'bottom', i:[0,1,5,4], s:0.62, map:[0,1,3] },
        { name:'top', i:[2,6,7,3], s:1.08, map:[0,1,3] },
        { name:'front', i:[0,2,3,1], s:0.8, map:[1,2,0] },
        { name:'back', i:[4,5,7,6], s:0.96, map:[3,2,0] },
      ];
      for (const face of faces) {
        facesToDraw.push({
          points: face.i.map(i => v[i]),
          depth: face.i.reduce((sum, i) => sum + v[i].d, 0) / 4,
          color: rgb ? shade(rgb, face.s) : null,
          outline: outline !== false,
          shade: face.s,
          texture: texturePart && skinAtlas ? 'skin.' + previewSkin + '.' + texturePart + '.' + face.name : null,
          textureMap: face.map,
        });
      }
    };
    const facePath = face => {
      hctx.beginPath(); hctx.moveTo(face.points[0].x, face.points[0].y);
      for (let i = 1; i < 4; i++) hctx.lineTo(face.points[i].x, face.points[i].y);
      hctx.closePath();
    };
    const drawFaceTexture = face => {
      if (!face.texture || !skinAtlas) return;
      const uv = Textures.uv(face.texture);
      const atlasSize = Textures.atlas.size;
      const sx = uv[0] * atlasSize, sy = uv[1] * atlasSize;
      const sw = Math.max(0.01, (uv[2] - uv[0]) * atlasSize);
      const sh = Math.max(0.01, (uv[3] - uv[1]) * atlasSize);
      const tl = face.points[face.textureMap[0]], tr = face.points[face.textureMap[1]], bl = face.points[face.textureMap[2]];
      hctx.save();
      facePath(face); hctx.clip();
      hctx.imageSmoothingEnabled = false;
      hctx.setTransform((tr.x - tl.x) / sw, (tr.y - tl.y) / sw,
        (bl.x - tl.x) / sh, (bl.y - tl.y) / sh, tl.x, tl.y);
      hctx.drawImage(skinAtlas, sx, sy, sw, sh, 0, 0, sw, sh);
      hctx.restore();
    };
    const flushCuboids = () => {
      facesToDraw.sort((a, b) => a.depth - b.depth);
      for (const face of facesToDraw) {
        facePath(face);
        if (face.color) { hctx.fillStyle = face.color; hctx.fill(); }
        drawFaceTexture(face);
        if (face.texture && face.color && face.shade < 1) {
          facePath(face);
          hctx.fillStyle = 'rgba(0,0,0,' + ((1 - face.shade) * 0.34) + ')';
          hctx.fill();
        }
        if (face.outline) {
          facePath(face);
          hctx.strokeStyle = 'rgba(0,0,0,0.24)';
          hctx.lineWidth = Math.max(1, GUI * 0.5);
          hctx.stroke();
        }
      }
    };
    hctx.save(); hctx.beginPath(); hctx.rect(boxX, boxY, boxW, boxH); hctx.clip();
    cuboid(-0.2, 0.6, 0, 0.4, 1.2, 0.4, palette.pants, true, 'legL');
    cuboid(0.2, 0.6, 0, 0.4, 1.2, 0.4, palette.pants, true, 'legR');
    cuboid(0, 1.8, 0, 0.8, 1.2, 0.4, palette.shirt, true, 'body');
    cuboid(-armX, 1.8, 0, armWidth, 1.2, 0.4, palette.shirt, true, 'armL');
    cuboid(armX, 1.8, 0, armWidth, 1.2, 0.4, palette.shirt, true, 'armR');
    cuboid(0, 2.8, 0, 0.8, 0.8, 0.8, palette.skin, true, 'head');
    cuboid(-0.2, 0.6, 0, 0.43, 1.23, 0.43, null, false, 'pantsL');
    cuboid(0.2, 0.6, 0, 0.43, 1.23, 0.43, null, false, 'pantsR');
    cuboid(0, 1.8, 0, 0.84, 1.24, 0.44, null, false, 'jacket');
    cuboid(-armX, 1.8, 0, armWidth + 0.04, 1.24, 0.44, null, false, 'sleeveL');
    cuboid(armX, 1.8, 0, armWidth + 0.04, 1.24, 0.44, null, false, 'sleeveR');
    cuboid(0, 2.8, 0, 0.86, 0.86, 0.86, null, false, 'hat');
    const armorColors = { leather: [139,87,46], gold: [233,197,49], iron: [203,208,210], diamond: [57,207,193] };
    const equipment = game.player.equipment || [];
    const armorColor = (slot) => {
      const item = equipment[slot] ? Items.get(equipment[slot].id) : null;
      return item && item.armor ? armorColors[item.armor.material] : null;
    };
    const helmet = armorColor(0), chest = armorColor(1), legs = armorColor(2), boots = armorColor(3);
    if (helmet) cuboid(0, 3.16, 0, 0.88, 0.24, 0.88, helmet);
    if (chest) {
      cuboid(0, 1.80, 0, 0.86, 1.26, 0.46, chest);
      cuboid(-armX, 1.80, 0, armWidth + 0.04, 1.26, 0.44, chest);
      cuboid(armX, 1.80, 0, armWidth + 0.04, 1.26, 0.44, chest);
    }
    if (legs) {
      cuboid(-0.2, 0.72, 0, 0.43, 0.96, 0.43, legs);
      cuboid(0.2, 0.72, 0, 0.43, 0.96, 0.43, legs);
    }
    if (boots) {
      cuboid(-0.2, 0.27, 0.02, 0.44, 0.54, 0.48, boots);
      cuboid(0.2, 0.27, 0.02, 0.44, 0.54, 0.48, boots);
    }
    flushCuboids();
    hctx.restore();
  }
  function drawStatusEffects(w, h) {
    const effects = game.player.statusEffects || [];
    let y = 6 * GUI;
    for (const e of effects) {
      const x = w - 30 * GUI;
      drawGui('slot', x, y, 18 * GUI, 18 * GUI, 0.9);
      if (e.type === 'hunger') drawGui('food_full', x + 4 * GUI, y + 4 * GUI, 9 * GUI, 9 * GUI);
      else if (e.type === 'regeneration') drawGui('heart_full', x + 4 * GUI, y + 4 * GUI, 9 * GUI, 9 * GUI);
      const secs = Math.max(0, Math.ceil(e.time));
      drawPixelText(String(secs), x - 2 * GUI, y + 12 * GUI, 5 * GUI, 'right', '#ddd');
      y += 21 * GUI;
    }
  }

  function drawWindow(w, h) {
    if (win.type === 'sign') return;
    hctx.fillStyle = 'rgba(0,0,0,0.48)';
    hctx.fillRect(0, 0, w, h);
    const p = panelRect(w, h);
    drawContainerBackground(win.type, p);
    const titles = { inventory: '物品栏', crafting: '工作台', furnace: '熔炉', chest: '箱子', creative: '创造模式物品栏' };
    if (win.type !== 'inventory') drawPixelText(titles[win.type] || '', p.x + 8 * GUI, p.y + 12 * GUI, 7 * GUI, 'left', '#404040');
    if (win.type !== 'inventory' && win.type !== 'creative') drawPixelText('物品栏', p.x + 8 * GUI, p.y + 80 * GUI, 6 * GUI, 'left', '#404040');
    if (win.type === 'creative') {
      const pages = Math.max(1, Math.ceil(win.catalog.length / 45));
      drawPixelText((win.page + 1) + '/' + pages, p.x + 168 * GUI, p.y + 12 * GUI, 6 * GUI, 'right', '#555');
    }

    if (win.type === 'inventory') {
      drawPlayerPreview3D(p);
      drawPixelText('合成', p.x + 88 * GUI, p.y + 20 * GUI, 6 * GUI, 'left', '#404040');
    }

    const slots = layoutSlots(w, h);
    hoverSlot = null;
    for (const sl of slots) {
      const hov = mouseX >= sl.x && mouseX < sl.x + S && mouseY >= sl.y && mouseY < sl.y + S;
      if (hov) hoverSlot = sl;
      drawSlot(sl.x, sl.y, hov);
      drawItemIcon(sl.x + GUI, sl.y + GUI, 16 * GUI, slotStack(sl));
    }

    if (win.type === 'inventory' || win.type === 'crafting') {
      const ax = win.type === 'inventory' ? p.x + 120 * GUI : p.x + 88 * GUI;
      drawGui('arrow', ax, p.y + 35 * GUI, 24 * GUI, 17 * GUI, 0.8);
    }
    if (win.type === 'furnace') {
      const be = win.be;
      const flameX = p.x + 58 * GUI, flameY = p.y + 36 * GUI;
      drawGui('flame', flameX, flameY, 14 * GUI, 14 * GUI, 0.22);
      const burnF = be.burnMax > 0 ? U.clamp(be.burn / be.burnMax, 0, 1) : 0;
      if (burnF > 0) {
        hctx.save();
        hctx.beginPath(); hctx.rect(flameX, flameY + (1 - burnF) * 14 * GUI, 14 * GUI, burnF * 14 * GUI); hctx.clip();
        drawGui('flame', flameX, flameY, 14 * GUI, 14 * GUI);
        hctx.restore();
      }
      const arrowX = p.x + 79 * GUI, arrowY = p.y + 35 * GUI;
      drawGui('arrow', arrowX, arrowY, 24 * GUI, 17 * GUI, 0.22);
      const cookF = U.clamp(be.cook / 10, 0, 1);
      if (cookF > 0) {
        hctx.save();
        hctx.beginPath(); hctx.rect(arrowX, arrowY, cookF * 24 * GUI, 17 * GUI); hctx.clip();
        drawGui('arrow', arrowX, arrowY, 24 * GUI, 17 * GUI);
        hctx.restore();
      }
    }

    if (game.player.cursor) drawItemIcon(mouseX - 8 * GUI, mouseY - 8 * GUI, 16 * GUI, game.player.cursor);
    if (hoverSlot && !game.player.cursor) {
      const st = slotStack(hoverSlot);
      if (st) {
        const it = Items.get(st.id);
        if (it) {
          const lines = [{ text: st.name || it.name, color: st.ench ? '#b86cff' : '#fff' }];
          const enchantNames = { protection: '保护', sharpness: '锋利', efficiency: '效率', power: '力量', unbreaking: '耐久' };
          for (const key of Object.keys(st.ench || {})) {
            if (enchantNames[key]) lines.push({ text: enchantNames[key] + ' ' + st.ench[key], color: '#aaaaff' });
          }
          const maxDurability = Items.durabilityOf(st.id);
          if (st.dur !== undefined && maxDurability > 0) lines.push({ text: '耐久度 ' + st.dur + ' / ' + maxDurability, color: '#aaa' });
          hctx.font = unicodeFont(Math.max(10, 6 * GUI), false);
          const tw = Math.max(...lines.map(line => Math.ceil(hctx.measureText(line.text).width))) + 8 * GUI;
          const tx = Math.min(w - tw - 2 * GUI, mouseX + 6 * GUI);
          const th = (4 + lines.length * 9) * GUI;
          const ty = Math.max(2 * GUI, mouseY - th - 2 * GUI);
          hctx.fillStyle = 'rgba(16,0,16,0.96)'; hctx.fillRect(tx, ty, tw, th);
          hctx.fillStyle = '#5000a0';
          hctx.fillRect(tx + GUI, ty, tw - 2 * GUI, GUI);
          hctx.fillRect(tx, ty + GUI, GUI, th - 2 * GUI);
          hctx.fillStyle = '#280050';
          hctx.fillRect(tx + GUI, ty + th - GUI, tw - GUI, GUI);
          hctx.fillRect(tx + tw - GUI, ty + GUI, GUI, th - 2 * GUI);
          for (let i = 0; i < lines.length; i++) {
            drawPixelText(lines[i].text, tx + 4 * GUI, ty + (9 + i * 9) * GUI, 6 * GUI, 'left', lines[i].color);
          }
        }
      }
    }
  }

  function drawDeath(w, h) {
    hctx.fillStyle = 'rgba(105,0,0,0.62)';
    hctx.fillRect(0, 0, w, h);
    const frame = menuFrame(w, h);
    drawPixelText('你死了！', w / 2, frame.y + 62 * GUI, 14 * GUI, 'center', '#fff', 1, true);
    drawPixelText(deathCauseText(game.deathCause), w / 2, frame.y + 88 * GUI, 7 * GUI, 'center', '#ddd');
    drawScreenControls('death', w, h);
  }
  function deathCauseText(c) {
    const map = {
      fall: '摔死了', drown: '淹死了', lava: '被岩浆烧死了', starve: '饿死了',
      void: '掉出了世界', mob: '被怪物杀死了', explode: '被炸死了', cactus: '被仙人掌扎死了', food: '食物中毒',
    };
    return map[c] || '死亡';
  }

  function drawMenuScreen(w, h) {
    const screen = UI.currentScreen() || rootScreen();
    const frame = menuFrame(w, h);
    if (screen === 'title') drawMenuPanorama(w, h);
    else if (screen === 'pause') {
      hctx.fillStyle = 'rgba(0,0,0,0.62)';
      hctx.fillRect(0, 0, w, h);
    } else {
      drawDirtBackground(w, h);
    }

    if (screen === 'title') {
      drawPixelText('WEBCRAFT', w / 2, frame.y + 48 * GUI, 20 * GUI, 'center', '#f4f4f4', 1, true);
      drawPixelText('Java 1.8.9 风格', w / 2 + 54 * GUI, frame.y + 65 * GUI, 6 * GUI, 'center', '#ffff55');
      drawPixelText('WebCraft v3', 4 * GUI, h - 5 * GUI, 5 * GUI, 'left', '#aaa');
    } else {
      const titles = {
        worlds: '选择世界', multiplayer: '多人游戏', pause: '游戏菜单', options: '选项', video: '视频设置', skin: '皮肤自定义',
        controls: '控制', sound: '音乐和声音', language: '语言', resource: '资源包',
        confirm_delete: '删除世界？',
      };
      drawPixelText(titles[screen] || '', w / 2, frame.y + 24 * GUI, 10 * GUI, 'center', '#fff', 1, true);
      if (screen === 'confirm_delete') {
        drawPixelText('这个世界将永久丢失！', w / 2, frame.y + 82 * GUI, 7 * GUI, 'center', '#fff');
      }
    }
    drawScreenControls(screen, w, h);
  }

  function drawButton(b, focused) {
    const hov = !b.disabled && (focused || (mouseX >= b.x && mouseX < b.x + b.w && mouseY >= b.y && mouseY < b.y + b.h));
    drawGui(hov ? 'button_hover' : 'button', b.x, b.y, b.w, b.h, b.disabled ? 0.55 : 1);
    drawPixelText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 3 * GUI,
      7 * GUI, 'center', b.disabled ? '#aaa' : (hov ? '#ffffa0' : '#fff'));
  }

  function drawSlider(control, focused) {
    const hov = focused || (mouseX >= control.x && mouseX < control.x + control.w && mouseY >= control.y && mouseY < control.y + control.h);
    drawGui(hov ? 'button_hover' : 'button', control.x, control.y, control.w, control.h);
    const t = U.clamp((control.value - control.min) / Math.max(1e-6, control.max - control.min), 0, 1);
    const knobW = 8 * GUI;
    const knobX = Math.round(control.x + 4 * GUI + t * (control.w - 8 * GUI) - knobW / 2);
    hctx.fillStyle = '#1f1f1f'; hctx.fillRect(knobX, control.y, knobW, control.h);
    hctx.fillStyle = hov ? '#bfc5dc' : '#a0a0a0';
    hctx.fillRect(knobX + GUI, control.y + GUI, knobW - 2 * GUI, control.h - 2 * GUI);
    hctx.fillStyle = '#fff'; hctx.fillRect(knobX + GUI, control.y + GUI, knobW - 2 * GUI, GUI);
    hctx.fillStyle = '#555'; hctx.fillRect(knobX + GUI, control.y + control.h - 2 * GUI, knobW - 2 * GUI, GUI);
    drawPixelText(control.label, control.x + control.w / 2, control.y + control.h / 2 + 3 * GUI,
      7 * GUI, 'center', hov ? '#ffffa0' : '#fff');
  }

  function drawTextField(control, focused) {
    drawPixelText(control.label, control.x + control.w / 2, control.y - 5 * GUI,
      6 * GUI, 'center', '#a0a0a0');
    hctx.fillStyle = '#000';
    hctx.fillRect(control.x - GUI, control.y - GUI, control.w + 2 * GUI, control.h + 2 * GUI);
    hctx.fillStyle = focused ? '#fff' : '#a0a0a0';
    hctx.fillRect(control.x, control.y, control.w, control.h);
    hctx.fillStyle = '#080808';
    hctx.fillRect(control.x + GUI, control.y + GUI, control.w - 2 * GUI, control.h - 2 * GUI);
    if (!nicknameInput) {
      const name = typeof Network !== 'undefined' ? Network.getPlayerName() : 'Steve';
      drawPixelText(name, control.x + control.w / 2, control.y + control.h / 2 + 3 * GUI,
        7 * GUI, 'center', '#fff');
    }
  }

  function drawScreenControls(screen, w, h) {
    const controls = controlsForScreen(screen, w, h);
    if (controls.length && (menuFocus < 0 || menuFocus >= controls.length || controls[menuFocus].disabled)) {
      menuFocus = controls.findIndex(c => !c.disabled);
      if (menuFocus < 0) menuFocus = 0;
    }
    for (let i = 0; i < controls.length; i++) {
      const c = controls[i], focused = i === menuFocus && !c.disabled;
      if (c.type === 'slider') drawSlider(c, focused);
      else if (c.type === 'text') drawTextField(c, focused);
      else drawButton(c, focused);
    }
  }

  UI.menuButtons = function (w, h) {
    updateGuiScale(w, h);
    return controlsForScreen('title', w, h);
  };

  UI.pauseButtons = function (w, h) {
    updateGuiScale(w, h);
    return controlsForScreen('pause', w, h);
  };

  UI.deathButtons = function (w, h) {
    updateGuiScale(w, h);
    return controlsForScreen('death', w, h);
  };

  UI.toast = function (msg) { toastMsg = msg; toastT = 2.6; };
  UI.hit = function (critical) { hitT = 0.16; criticalHit = !!critical; };
  UI.itemPicked = function (msg) { pickupMsg = String(msg || ''); pickupT = 1.2; };
  function drawToast(w, h, dt) {
    if (!toastMsg) return;
    toastT -= dt;
    if (toastT <= 0) { toastMsg = null; return; }
    const a = Math.min(1, toastT);
    hctx.font = unicodeFont(Math.max(10, 7 * GUI), false);
    const tw = hctx.measureText(toastMsg).width + 30;
    hctx.fillStyle = 'rgba(0,0,0,' + 0.65 * a + ')';
    hctx.fillRect(w / 2 - tw / 2, h * 0.22 - 10 * GUI, tw, 12 * GUI);
    drawPixelText(toastMsg, w / 2, h * 0.22 - 2 * GUI, 7 * GUI, 'center', '#fff', a);
  }

  function drawPickup(w, h) {
    if (!pickupMsg || pickupT <= 0 || !game.player) return;
    const hotY = h - 22 * GUI - 4;
    drawPixelText(pickupMsg, w / 2, hotY - 38 * GUI, 6 * GUI, 'center', '#ffffaa', Math.min(1, pickupT * 2));
  }

  function drawDebug(w, h) {
    const p = game.player;
    const bx = Math.floor(p.x), by = Math.floor(p.y + p.eye), bz = Math.floor(p.z);
    const facingIndex = ((Math.round(p.yaw / (Math.PI / 2)) % 4) + 4) % 4;
    const facing = ['北 (-Z)', '东 (+X)', '南 (+Z)', '西 (-X)'][facingIndex];
    const target = p.look(p.blockReach(), true);
    const targetName = target ? Blocks.get(target.id).name + ' ' + target.x + ',' + target.y + ',' + target.z : '无';
    const network = typeof Network !== 'undefined' && Network.isConnected() ? Network.status() : null;
    const lines = [
      'FPS: ' + game.fps.toFixed(0),
      'XYZ: ' + p.x.toFixed(1) + ' / ' + p.y.toFixed(1) + ' / ' + p.z.toFixed(1),
      '区块: ' + (p.x >> 4) + ',' + (p.z >> 4) + '  已加载: ' + game.world.chunks.size,
      '生物群系: ' + game.world.biomeAt(Math.floor(p.x), Math.floor(p.z)),
      '朝向: ' + facing + '  视角: ' + (p.yaw * 180 / Math.PI).toFixed(1) + ' / ' + (p.pitch * 180 / Math.PI).toFixed(1),
      '光照: 天空 ' + game.world.getSky(bx, by, bz) + ' / 方块 ' + game.world.getBlkLight(bx, by, bz),
      '目标方块: ' + targetName,
      '时间: ' + (game.world.timeOfDay * 24).toFixed(1) + 'h  实体: ' + Entities.list.length,
      '模式: ' + p.mode + (p.flying ? ' (飞行)' : ''),
    ];
    if (network) lines.push('联机: ' + network.latency + 'ms  权限: ' + network.role);
    hctx.font = '14px monospace';
    hctx.textAlign = 'left';
    let y = 22;
    for (const l of lines) {
      hctx.fillStyle = 'rgba(0,0,0,0.5)';
      hctx.fillRect(8, y - 14, hctx.measureText(l).width + 10, 19);
      hctx.fillStyle = '#fff';
      hctx.fillText(l, 13, y);
      y += 21;
    }
  }

  UI.onDeath = null; // set by main
  UI.onNicknameSubmit = null;
  UI.onChatSubmit = null;
  UI.onChatClose = null;
  UI.refreshCraftResult = refreshCraftResult;
  UI.guiInfo = () => ({
    scale: GUI, scaleMode: guiScaleMode, slot: S,
    sprites: Object.keys(guiSprites), containers: Object.keys(containerRects), bitmapGlyphs: Object.keys(BITMAP_FONT).length,
    unicodeCache: unicodeTextCache.size,
    previewBaseYaw: PLAYER_PREVIEW_BASE_YAW,
    resourcePack: guiResourcePack,
    originalReady: !!originalGuiImages,
    originalSprites: Object.keys(ORIGINAL_GUI_SPRITES),
    originalAssets: Object.values(ORIGINAL_GUI_FILES),
  });
  UI.menuInfo = function (w, h) {
    const controls = UI.screenControls(w, h);
    return {
      screen: UI.currentScreen(), depth: menuStack.length, virtualWidth: 320, virtualHeight: 240,
      focus: menuFocus, controls: controls.map(c => ({ id: c.id, type: c.type, disabled: c.disabled, x: c.x, y: c.y, w: c.w, h: c.h })),
    };
  };

  window.UI = UI;
})();
