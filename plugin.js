(function () {
  const FX = {
    sand: { h: 32, s: 72, v: 78 },
    magic: { h: 42, s: 48, v: 92 },
    smoke: { h: 220, s: 10, v: 42 },
    blizzard: { h: 204, s: 38, v: 88 },
    fire: { h: 14, s: 92, v: 100 },
    flood: { h: 208, s: 78, v: 72 }
  };
  const FOE = "#e23b2f";
  const BACK = "#16130f";
  let auto = true;
  let forcedHex = "#e6c36a";
  let effect = "";
  let actor = null;
  let placeLoc = null;
  let placeImage = "";
  let lastKey = "";
  let wait = 0;
  const tones = {};

  let envRef = null;
  let yandexFrameAt = 0;

  function lampHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return {
      h: Math.round(h) % 360,
      s: Math.min(100, Math.max(1, Math.round((max ? d / max : 0) * 100))),
      v: Math.min(100, Math.max(1, Math.round(max * 100)))
    };
  }

  function hexHsv(hex) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!match) return null;
    const n = parseInt(match[1], 16);
    return lampHsv((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }

  function post(env, path, body) {
    if (env) envRef = env;
    return env.post(path, body);
  }

  function send(env, body, manual) {
    if (!manual && !auto) return;
    const key = JSON.stringify(body);
    if (key === lastKey) return;
    lastKey = key;
    post(env, "/apply", body).catch(function () { lastKey = ""; });
    share(body);
  }

  function share(body) {
    if (!body || body.h == null || body.s == null || body.v == null) return;
    try {
      if (!window.ShirmoPlugins || !window.ShirmoPlugins.paintOthers) return;
      window.ShirmoPlugins.paintOthers("adaptive-light", hsvHex(body.h, body.s, body.v), body.v);
    } catch (err) {}
  }

  function queue(env, body, manual) {
    clearTimeout(wait);
    if (manual) {
      send(env, Object.assign({ manual: true }, body), true);
      return;
    }
    wait = setTimeout(function () { send(env, body, false); }, 350);
  }

  function turnColor(env, row) {
    if (!row) return "";
    if (row.side !== "player") return FOE;
    if (/^#[0-9a-f]{6}$/i.test(row.color || "")) return row.color;
    const battle = env.campaign && env.campaign().battle;
    return (battle && battle.player) || "#7dcea0";
  }

  const pendingTone = {};
  const toneSeq = {};

  function lockedColor(loc, url) {
    if (!loc || !url || loc.lampSrc !== url) return "";
    return /^#[0-9a-f]{6}$/i.test(loc.lampColor || "") ? loc.lampColor : "";
  }

  function toneHex(loc, url) {
    const row = loc && tones[loc.id];
    if (!row || row.url !== url) return "";
    return row.hex || "";
  }

  function placeColor(loc) {
    if (!loc) return "";
    const locked = lockedColor(loc, placeImage);
    if (locked) return locked;
    const tone = toneHex(loc, placeImage);
    if (tone) return tone;
    if (!placeImage) return BACK;
    return "";
  }

  function paintSwatch(loc, color) {
    if (!loc || !color) return;
    document.querySelectorAll('[data-lamp="' + loc.id + '"]').forEach(function (node) {
      node.style.setProperty("--swatch", color);
      node.style.backgroundColor = color;
    });
  }

  function showPlace(loc, image) {
    if (!loc) return;
    if (loc.lampSrc && image && loc.lampSrc !== image) {
      loc.lampColor = "";
      loc.lampSrc = "";
    }
    const locked = lockedColor(loc, image);
    if (locked) {
      paintSwatch(loc, locked);
      return;
    }
    const tone = toneHex(loc, image);
    if (tone) paintSwatch(loc, tone);
    else if (!image) paintSwatch(loc, BACK);
  }

  function sample(env, url, loc) {
    if (!url || !loc) return;
    const have = toneHex(loc, url);
    if (have) {
      paintSwatch(loc, have);
      return;
    }
    if (pendingTone[loc.id] === url) return;
    pendingTone[loc.id] = url;
    const seq = (toneSeq[loc.id] || 0) + 1;
    toneSeq[loc.id] = seq;
    const image = new Image();
    image.onload = function () {
      if (toneSeq[loc.id] !== seq) return;
      if (pendingTone[loc.id] === url) delete pendingTone[loc.id];
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 96;
        canvas.height = 54;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, 96, 54);
        const data = ctx.getImageData(0, 0, 96, 54).data;
        const bins = {};
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          const key = (data[i] >> 4) + "," + (data[i + 1] >> 4) + "," + (data[i + 2] >> 4);
          const bin = bins[key] || (bins[key] = { n: 0, r: 0, g: 0, b: 0 });
          bin.n += 1;
          bin.r += data[i];
          bin.g += data[i + 1];
          bin.b += data[i + 2];
        }
        let best = null;
        Object.keys(bins).forEach(function (key) { if (!best || bins[key].n > best.n) best = bins[key]; });
        if (!best) return;
        const hex = "#" + [best.r, best.g, best.b].map(function (n) {
          return Math.round(n / best.n).toString(16).padStart(2, "0");
        }).join("");
        tones[loc.id] = { url: url, hex: hex };
        if (!lockedColor(loc, url)) paintSwatch(loc, hex);
        if (placeLoc && placeLoc.id === loc.id && placeImage === url && env) apply(env);
      } catch (err) { /* картинка с чужого домена не красится */ }
    };
    image.src = url;
  }

  function fightOn(env) {
    try { return !!(env && env.fightOn && env.fightOn()); }
    catch (err) { return false; }
  }

  function apply(env) {
    try {
      if (!auto) return;
      if (effect && FX[effect]) {
        queue(env, Object.assign({ effect: effect }, FX[effect]), false);
        return;
      }
      if (fightOn(env) && actor) {
        const hsv = hexHsv(turnColor(env, actor));
        if (hsv) queue(env, hsv, false);
        return;
      }
      if (placeLoc && placeLoc.lamp === true) {
        const hsv = hexHsv(placeColor(placeLoc));
        if (hsv) queue(env, hsv, false);
      }
    } catch (err) { /* смена цвета не должна ронять ширму */ }
  }

  function field(label, type) {
    const wrap = document.createElement("label");
    wrap.className = "plugin-field";
    wrap.append(document.createTextNode(label));
    const input = document.createElement("input");
    input.type = type;
    input.autocomplete = "off";
    wrap.append(input);
    return { wrap: wrap, input: input };
  }

  function deviceList(env) {
    const state = env.state || {};
    const lights = state.lights || [];
    if (!lights.length) {
      const empty = document.createElement("p");
      empty.className = "note";
      empty.textContent = state.hasKey ? (state.lightError || "Цветных ламп нет.") : "Ключ ещё не сохранён.";
      return empty;
    }
    const picked = {};
    (state.devices || []).forEach(function (id) { picked[id] = true; });
    const box = document.createElement("div");
    box.className = "plugin-devices";
    lights.forEach(function (lamp) {
      const label = document.createElement("label");
      label.className = "check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!picked[lamp.id];
      input.setAttribute("data-device", lamp.id);
      input.addEventListener("change", function () {
        const ids = [];
        box.querySelectorAll("input[data-device]").forEach(function (node) {
          if (node.checked) ids.push(node.getAttribute("data-device"));
        });
        if (env.state) env.state.devices = ids.slice();
        post(env, "/devices", { ids: ids }).catch(function (error) { env.note(error.message); });
      });
      label.append(input, document.createTextNode(lamp.name || "Лампа"));
      box.append(label);
    });
    return box;
  }

  function keyForm(slot, env) {
    slot.innerHTML = "";
    const box = document.createElement("form");
    box.className = "plugin-form";
    const pass = field("Пароль комнаты", "password");
    const token = field("Ключ Яндекса", "password");
    const acts = document.createElement("div");
    acts.className = "plugin-acts";
    const go = document.createElement("button");
    go.type = "submit";
    go.textContent = "Сохранить ключ";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Отмена";
    cancel.addEventListener("click", function () { slot.innerHTML = ""; });
    acts.append(go, cancel);
    box.append(pass.wrap, token.wrap, acts);
    box.addEventListener("submit", function (event) {
      event.preventDefault();
      const password = pass.input.value;
      const key = token.input.value.trim();
      pass.input.value = "";
      token.input.value = "";
      post(env, "/key", { id: "adaptive-light", password: password, token: key }).then(function () {
        env.redraw();
      }).catch(function (error) { env.note(error.message); });
    });
    slot.append(box);
  }

  function settings(env) {
    envRef = env || envRef;
    const state = env.state || {};
    if (state.auto != null && !playing) auto = state.auto !== false;
    const box = document.createElement("div");
    box.className = "plugin-box";
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = "Окно подсветки";
    openBtn.addEventListener("click", function () { openStudio(env); });
    const keyLine = document.createElement("div");
    keyLine.className = "plugin-acts";
    const keyState = document.createElement("span");
    keyState.className = "plugin-state" + (state.hasKey ? " is-on" : "");
    keyState.textContent = state.hasKey ? "Ключ сохранён" : "Ключ не задан";
    const keyBtn = document.createElement("button");
    keyBtn.type = "button";
    keyBtn.textContent = state.hasKey ? "Сменить ключ" : "Задать ключ";
    const keySlot = document.createElement("div");
    keySlot.className = "plugin-slot";
    keyBtn.addEventListener("click", function () { keyForm(keySlot, env); });
    keyLine.append(keyState, keyBtn);
    box.append(openBtn, keyLine, keySlot);
    return box;
  }

  let loupe = null;
  let dropper = null;

  function closeLoupe() {
    if (loupe) loupe.remove();
    loupe = null;
    dropper = null;
    document.removeEventListener("pointermove", onLoupeMove, true);
    document.removeEventListener("pointerdown", onLoupePick, true);
    document.removeEventListener("keydown", onLoupeKey, true);
  }

  function onLoupeKey(event) {
    if (event.key === "Escape") closeLoupe();
  }

  function contain(box, nw, nh) {
    const scale = Math.min(box.width / nw, box.height / nh);
    const w = nw * scale;
    const h = nh * scale;
    return { x: box.left + (box.width - w) / 2, y: box.top + (box.height - h) / 2, w: w, h: h, scale: scale };
  }

  function onLoupeMove(event) {
    if (!dropper || !loupe) return;
    const photo = document.querySelector(".map-photo");
    if (!photo) return;
    const box = photo.getBoundingClientRect();
    const fit = contain(box, dropper.image.naturalWidth, dropper.image.naturalHeight);
    const inside = event.clientX >= fit.x && event.clientY >= fit.y && event.clientX <= fit.x + fit.w && event.clientY <= fit.y + fit.h;
    loupe.hidden = !inside;
    if (!inside) return;
    const px = (event.clientX - fit.x) / fit.scale;
    const py = (event.clientY - fit.y) / fit.scale;
    const ctx = loupe.querySelector("canvas").getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#07090e";
    ctx.fillRect(0, 0, 130, 130);
    ctx.drawImage(dropper.image, px - 6, py - 6, 13, 13, 0, 0, 130, 130);
    ctx.strokeStyle = "#e6c36a";
    ctx.strokeRect(60, 60, 10, 10);
    const pixel = dropper.read(px, py);
    loupe.querySelector("b").textContent = pixel ? (pixel.h + " " + pixel.s + " " + pixel.v) : "";
    loupe.style.left = Math.min(window.innerWidth - 150, event.clientX + 16) + "px";
    loupe.style.top = Math.min(window.innerHeight - 170, event.clientY + 16) + "px";
  }

  function onLoupePick(event) {
    if (!dropper) return;
    const card = document.getElementById("lamp-card");
    if (card && card.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    const photo = document.querySelector(".map-photo");
    if (!photo || !dropper.loc) { closeLoupe(); return; }
    const box = photo.getBoundingClientRect();
    const fit = contain(box, dropper.image.naturalWidth, dropper.image.naturalHeight);
    const pixel = dropper.read((event.clientX - fit.x) / fit.scale, (event.clientY - fit.y) / fit.scale);
    if (pixel) {
      dropper.loc.lampColor = pixel.hex;
      dropper.loc.lampSrc = placeImage || "";
      const swatch = document.querySelector('[data-lamp="' + dropper.loc.id + '"]');
      if (swatch) {
        swatch.style.setProperty("--swatch", pixel.hex);
        swatch.style.backgroundColor = pixel.hex;
      }
      const input = card && card.querySelector("[data-lamp-color]");
      if (input) input.value = pixel.hex;
      if (dropper.loc.lamp === true) apply(dropper.env);
      try { if (dropper.env.save) dropper.env.save(); } catch (err) {}
    }
    closeLoupe();
  }

  function eyedrop(env, loc, imageUrl) {
    closeLoupe();
    if (!imageUrl) return;
    const image = new Image();
    image.onload = function () {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      try { ctx.drawImage(image, 0, 0); }
      catch (err) { return; }
      loupe = document.createElement("div");
      loupe.className = "lamp-loupe";
      loupe.hidden = true;
      const view = document.createElement("canvas");
      view.width = 130;
      view.height = 130;
      const label = document.createElement("b");
      loupe.append(view, label);
      document.body.append(loupe);
      dropper = {
        loc: loc,
        env: env,
        image: image,
        read: function (x, y) {
          try {
            const pixel = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
            const hex = "#" + [pixel[0], pixel[1], pixel[2]].map(function (n) { return n.toString(16).padStart(2, "0"); }).join("");
            const hsv = lampHsv(pixel[0], pixel[1], pixel[2]);
            return { hex: hex, h: hsv.h, s: hsv.s, v: hsv.v };
          } catch (err) { return null; }
        }
      };
      document.addEventListener("pointermove", onLoupeMove, true);
      document.addEventListener("pointerdown", onLoupePick, true);
      document.addEventListener("keydown", onLoupeKey, true);
    };
    image.src = imageUrl;
  }

  let animTimer = 0;
  let playing = "";
  const MODES = [
    { id: "candle", name: "Свеча", h: 32, s: 78, v: 74, anim: true, drift: 10, speed: 850 },
    { id: "fire", name: "Огонь", h: 12, s: 94, v: 100, anim: true, drift: 18, speed: 700 },
    { id: "tavern", name: "Таверна", h: 28, s: 68, v: 58, anim: true, drift: 5, speed: 1400 },
    { id: "forest", name: "Лес", h: 118, s: 46, v: 40 },
    { id: "sea", name: "Море", h: 196, s: 64, v: 56 },
    { id: "night", name: "Ночь", h: 232, s: 38, v: 26 },
    { id: "lava", name: "Лава", h: 16, s: 90, v: 76, anim: true, drift: 14, speed: 560 },
    { id: "snow", name: "Снег", h: 206, s: 24, v: 90 }
  ];

  function hsvHex(h, s, v) {
    s /= 100;
    v /= 100;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return "#" + [r, g, b].map(function (n) { return Math.round((n + m) * 255).toString(16).padStart(2, "0"); }).join("");
  }

  function lightBag(env) {
    const campaign = env.campaign();
    if (!campaign.plugins || typeof campaign.plugins !== "object" || Array.isArray(campaign.plugins)) campaign.plugins = {};
    if (!campaign.plugins.light || typeof campaign.plugins.light !== "object") campaign.plugins.light = { auto: true, devices: [] };
    const light = campaign.plugins.light;
    if (!Array.isArray(light.scenarios)) light.scenarios = [];
    if (!Array.isArray(light.pins)) light.pins = [];
    return light;
  }

  function stopAnim() {
    clearInterval(animTimer);
    animTimer = 0;
  }

  function resumeAuto(env) {
    stopAnim();
    playing = "";
    auto = true;
    lastKey = "";
    post(env, "/auto", { on: true }).then(function () { apply(env); }).catch(function () {});
    repaintDock();
  }

  function holdManual(env) {
    if (!auto) return;
    auto = false;
    post(env, "/auto", { on: false }).catch(function () {});
  }

  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function startAnim(env, mode) {
    stopAnim();
    let tick = 0;
    function frame() {
      tick += 1;
      const drift = mode.drift || 8;
      const wave = Math.sin(tick * 1.4);
      const v = Math.max(12, Math.min(100, Math.round(mode.v + wave * drift)));
      const h = (mode.h + Math.round(Math.sin(tick * 0.6) * drift * 0.35) + 360) % 360;
      queue(env, { h: h, s: mode.s, v: v }, true);
    }
    frame();
    animTimer = setInterval(frame, mode.speed || 700);
  }

  function playSpec(env, spec) {
    stopAnim();
    holdManual(env);
    playing = spec.play;
    if (spec.anim) startAnim(env, spec);
    else queue(env, { h: spec.h, s: spec.s, v: spec.v }, true);
    forcedHex = hsvHex(spec.h, spec.s, spec.v);
    repaintDock();
    markStudio();
  }

  function modeById(id) {
    return MODES.find(function (mode) { return mode.id === id; }) || null;
  }

  function playKey(env, key) {
    if (key.indexOf("mode:") === 0) {
      const mode = modeById(key.slice(5));
      if (!mode) return;
      playSpec(env, { play: key, anim: mode.anim, h: mode.h, s: mode.s, v: mode.v, drift: mode.drift, speed: mode.speed });
      return;
    }
    const row = lightBag(env).scenarios.find(function (item) { return item.id === key; });
    if (!row) return;
    const mode = row.mode ? modeById(row.mode) : null;
    playSpec(env, {
      play: key,
      anim: !!(mode && mode.anim) || row.anim === true,
      h: mode ? mode.h : row.h,
      s: mode ? mode.s : row.s,
      v: mode ? mode.v : row.v,
      drift: mode ? mode.drift : row.drift,
      speed: mode ? mode.speed : row.speed
    });
  }

  function pinLabel(env, key) {
    if (key.indexOf("mode:") === 0) {
      const mode = modeById(key.slice(5));
      return mode ? mode.name : key.slice(5);
    }
    const row = lightBag(env).scenarios.find(function (item) { return item.id === key; });
    return row ? row.name : "Сценарий";
  }

  function pinColor(env, key) {
    if (key.indexOf("mode:") === 0) {
      const mode = modeById(key.slice(5));
      return mode ? hsvHex(mode.h, mode.s, mode.v) : "#e6c36a";
    }
    const row = lightBag(env).scenarios.find(function (item) { return item.id === key; });
    if (!row) return "#e6c36a";
    const mode = row.mode ? modeById(row.mode) : null;
    return hsvHex(mode ? mode.h : row.h, mode ? mode.s : row.s, mode ? mode.v : row.v);
  }

  function togglePin(env, key) {
    const light = lightBag(env);
    const at = light.pins.indexOf(key);
    if (at >= 0) light.pins.splice(at, 1);
    else light.pins.push(key);
    env.save();
    repaintDock();
    const root = document.getElementById("light-studio");
    if (root && !root.hidden && studioEnv) fillStudio(root, studioEnv);
    else markStudio();
  }

  function repaintDock() {
    try { if (window.ShirmoDock && window.ShirmoDock.paint) window.ShirmoDock.paint(); } catch (err) {}
  }

  function markStudio() {
    const root = document.getElementById("light-studio");
    if (!root) return;
    root.querySelectorAll("[data-play]").forEach(function (node) {
      node.classList.toggle("is-on", node.getAttribute("data-play") === playing);
    });
    const autoBtn = root.querySelector("[data-studio=auto]");
    if (autoBtn) autoBtn.classList.toggle("is-on", auto && !playing);
  }

  let studioEnv = null;

  function openStudio(env) {
    studioEnv = env;
    let root = document.getElementById("light-studio");
    if (root) {
      root.hidden = false;
      fillStudio(root, env);
      return;
    }
    root = document.createElement("div");
    root.id = "light-studio";
    root.className = "light-studio";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Подсветка");
    root.innerHTML = '<header class="light-bar"><b>Подсветка</b><button type="button" data-studio="close" aria-label="Закрыть">×</button></header><div class="light-body"></div>';
    document.body.appendChild(root);
    const bar = root.querySelector(".light-bar");
    let drag = null;
    bar.addEventListener("pointerdown", function (event) {
      if (event.target.closest("button")) return;
      const rect = root.getBoundingClientRect();
      drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      bar.setPointerCapture(event.pointerId);
    });
    bar.addEventListener("pointermove", function (event) {
      if (!drag) return;
      root.style.left = Math.max(8, event.clientX - drag.x) + "px";
      root.style.top = Math.max(8, event.clientY - drag.y) + "px";
      root.style.right = "auto";
    });
    bar.addEventListener("pointerup", function () { drag = null; });
    root.querySelector("[data-studio=close]").addEventListener("click", function () { root.hidden = true; });
    fillStudio(root, env);
  }

  function fillStudio(root, env) {
    const body = root.querySelector(".light-body");
    const state = env.state || {};
    const light = lightBag(env);
    const picked = {};
    (state.devices || []).forEach(function (id) { picked[id] = true; });
    body.innerHTML = "";
    const lampsTitle = document.createElement("h3");
    lampsTitle.textContent = "Лампы";
    body.append(lampsTitle);
    const lights = state.lights || [];
    if (!lights.length) {
      const empty = document.createElement("p");
      empty.className = "note";
      empty.textContent = state.hasKey ? (state.lightError || "Цветных ламп нет.") : "Ключ ещё не сохранён.";
      body.append(empty);
    }
    lights.forEach(function (lamp) {
      const line = document.createElement("div");
      line.className = "light-device";
      const label = document.createElement("label");
      label.className = "check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!picked[lamp.id];
      input.setAttribute("data-device", lamp.id);
      input.addEventListener("change", function () {
        const ids = [];
        body.querySelectorAll(".light-device input[data-device]").forEach(function (node) {
          if (node.checked) ids.push(node.getAttribute("data-device"));
        });
        if (env.state) env.state.devices = ids.slice();
        post(env, "/devices", { ids: ids }).catch(function (error) { env.note(error.message); });
      });
      label.append(input, document.createTextNode(lamp.name || "Лампа"));
      const power = document.createElement("button");
      power.type = "button";
      power.textContent = lamp.on ? "Выкл" : "Вкл";
      power.addEventListener("click", function () {
        const next = power.textContent === "Вкл";
        post(env, "/power", { ids: [lamp.id], on: next }).then(function () {
          power.textContent = next ? "Выкл" : "Вкл";
          lamp.on = next;
        }).catch(function (error) { env.note(error.message); });
      });
      line.append(label, power);
      body.append(line);
    });
    const modesTitle = document.createElement("h3");
    modesTitle.textContent = "Режимы";
    const grid = document.createElement("div");
    grid.className = "light-modes";
    MODES.forEach(function (mode) {
      const card = document.createElement("div");
      card.className = "light-mode";
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-play", "mode:" + mode.id);
      if (playing === "mode:" + mode.id) button.className = "is-on";
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      const grad = ctx.createLinearGradient(0, 0, 0, 64);
      grad.addColorStop(0, "#120e0c");
      grad.addColorStop(1, hsvHex(mode.h, mode.s, mode.v));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 160, 64);
      const caption = document.createElement("span");
      caption.textContent = mode.name + (mode.anim ? " · анимация" : "");
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "light-pin";
      const pinned = light.pins.indexOf("mode:" + mode.id) >= 0;
      pin.textContent = pinned ? "●" : "○";
      pin.title = pinned ? "Открепить" : "Закрепить в столе";
      pin.setAttribute("aria-label", (pinned ? "Открепить " : "Закрепить ") + mode.name);
      pin.addEventListener("click", function () { togglePin(env, "mode:" + mode.id); });
      button.append(canvas, caption);
      button.addEventListener("click", function () { playKey(env, "mode:" + mode.id); });
      card.append(button, pin);
      grid.append(card);
    });
    const colorTitle = document.createElement("h3");
    colorTitle.textContent = "Свой цвет";
    const sliders = document.createElement("div");
    sliders.className = "light-sliders";
    const preview = document.createElement("b");
    preview.className = "light-preview";
    function slider(name, min, max, value) {
      const label = document.createElement("label");
      label.append(document.createTextNode(name));
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(min);
      input.max = String(max);
      input.value = String(value);
      label.append(input);
      return { label: label, input: input };
    }
    const hue = slider("Оттенок", 0, 360, 32);
    const sat = slider("Насыщенность", 1, 100, 70);
    const val = slider("Яркость", 1, 100, 70);
    function pushSliders() {
      const spec = { h: Number(hue.input.value), s: Number(sat.input.value), v: Number(val.input.value) };
      preview.style.background = hsvHex(spec.h, spec.s, spec.v);
      stopAnim();
      playing = "";
      holdManual(env);
      queue(env, spec, true);
      markStudio();
    }
    [hue, sat, val].forEach(function (row) { row.input.addEventListener("input", pushSliders); });
    preview.style.background = hsvHex(32, 70, 70);
    sliders.append(preview, hue.label, sat.label, val.label);
    const scenesTitle = document.createElement("h3");
    scenesTitle.textContent = "Сценарии ширмы";
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "Это свои сценарии комнаты, не сценарии Яндекса.";
    const form = document.createElement("div");
    form.className = "light-save";
    const name = document.createElement("input");
    name.type = "text";
    name.placeholder = "Название";
    name.setAttribute("aria-label", "Название сценария");
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Сохранить и закрепить";
    save.addEventListener("click", function () {
      const title = name.value.trim();
      if (!title) return;
      const mode = playing.indexOf("mode:") === 0 ? modeById(playing.slice(5)) : null;
      const row = {
        id: "sc-" + Date.now().toString(36),
        name: title.slice(0, 40),
        mode: mode ? mode.id : "",
        h: mode ? mode.h : Number(hue.input.value),
        s: mode ? mode.s : Number(sat.input.value),
        v: mode ? mode.v : Number(val.input.value),
        anim: !!(mode && mode.anim)
      };
      const bag = lightBag(env);
      bag.scenarios.push(row);
      if (bag.pins.indexOf(row.id) < 0) bag.pins.push(row.id);
      name.value = "";
      env.save();
      fillStudio(root, env);
      repaintDock();
    });
    form.append(name, save);
    const list = document.createElement("div");
    list.className = "light-scenes";
    light.scenarios.forEach(function (row) {
      const line = document.createElement("div");
      line.className = "dock-line";
      const play = document.createElement("button");
      play.type = "button";
      play.setAttribute("data-play", row.id);
      play.textContent = row.name;
      if (playing === row.id) play.className = "is-on";
      play.addEventListener("click", function () { playKey(env, row.id); });
      const pin = document.createElement("button");
      pin.type = "button";
      pin.textContent = light.pins.indexOf(row.id) >= 0 ? "Открепить" : "Закрепить";
      pin.addEventListener("click", function () { togglePin(env, row.id); fillStudio(root, env); });
      const drop = document.createElement("button");
      drop.type = "button";
      drop.textContent = "×";
      drop.title = "Удалить сценарий";
      drop.addEventListener("click", function () {
        const bag = lightBag(env);
        bag.scenarios = bag.scenarios.filter(function (item) { return item.id !== row.id; });
        bag.pins = bag.pins.filter(function (item) { return item !== row.id; });
        env.save();
        fillStudio(root, env);
        repaintDock();
      });
      line.append(play, pin, drop);
      list.append(line);
    });
    const autoBtn = document.createElement("button");
    autoBtn.type = "button";
    autoBtn.setAttribute("data-studio", "auto");
    autoBtn.textContent = "Авто: локация, бой и таймер";
    if (auto && !playing) autoBtn.className = "is-on";
    autoBtn.addEventListener("click", function () { resumeAuto(env); markStudio(); });
    body.append(modesTitle, grid, colorTitle, sliders, scenesTitle, note, form, list, autoBtn);
  }

  function install(host) {
    host.add({
      id: "adaptive-light",
      mapFlag: true,
      settings: settings,
      place: function (loc, image, env) {
        placeLoc = loc || null;
        placeImage = image || "";
        showPlace(loc, image);
        if (loc && image && !lockedColor(loc, image) && !toneHex(loc, image)) sample(env, image, loc);
        apply(env);
      },
      turn: function (row, env) {
        actor = row || null;
        apply(env);
      },
      effect: function (kind, env) {
        effect = FX[kind] ? kind : "";
        apply(env);
      },
      lamp: function (loc, anchor, env) {
        const old = document.getElementById("lamp-card");
        if (old) old.remove();
        if (!loc) return;
        const card = document.createElement("div");
        card.id = "lamp-card";
        card.className = "lamp-card";
        const on = document.createElement("label");
        on.className = "check";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = loc.lamp === true;
        on.append(box, document.createTextNode(" Включить подсветку"));
        const color = document.createElement("input");
        color.type = "color";
        color.setAttribute("data-lamp-color", "");
        color.value = lockedColor(loc, placeImage) || toneHex(loc, placeImage) || BACK;
        const pick = document.createElement("button");
        pick.type = "button";
        pick.textContent = "Пипетка";
        card.append(on, color, pick);
        document.body.append(card);
        const rect = anchor.getBoundingClientRect();
        card.style.left = Math.min(window.innerWidth - 220, rect.right + 8) + "px";
        card.style.top = Math.max(8, rect.top) + "px";
        box.addEventListener("change", function () {
          loc.lamp = box.checked;
          anchor.classList.toggle("is-on", box.checked);
          try { if (env.save) env.save(); } catch (err) {}
          apply(env);
        });
        color.addEventListener("input", function () {
          loc.lampColor = color.value;
          loc.lampSrc = placeImage || "";
          anchor.style.setProperty("--swatch", color.value);
          anchor.style.backgroundColor = color.value;
          try { if (env.save) env.save(); } catch (err) {}
          if (loc.lamp === true) apply(env);
        });
        pick.addEventListener("click", function () { eyedrop(env, loc, placeImage); });
        setTimeout(function () {
          function away(event) {
            if (card.contains(event.target) || anchor.contains(event.target)) return;
            card.remove();
            document.removeEventListener("pointerdown", away, true);
          }
          document.addEventListener("pointerdown", away, true);
        }, 0);
      },
      dockHtml: function (env) {
        if (env) envRef = env;
        const pins = (env && lightBag(env).pins) || [];
        const rows = pins.map(function (key) {
          const on = playing === key ? " is-on" : "";
          const safe = esc(key);
          return '<div class="dock-line"><button type="button" data-light-play="' + safe + '" class="' + on.trim() + '"><i style="background:' + pinColor(env, key) + '"></i>' + esc(pinLabel(env, key)) + "</button>" +
            '<button type="button" data-light-unpin="' + safe + '" title="Открепить" aria-label="Открепить">×</button></div>';
        }).join("") || '<p class="note">Нет закреплённых режимов.</p>';
        return '<details class="dock-fold" data-fold="light" open><summary>Подсветка</summary>' +
          rows +
          '<div class="plugin-acts"><button type="button" data-light="auto"' + (auto && !playing ? ' class="is-on"' : "") + ">Авто</button>" +
          '<button type="button" data-light="studio">Настроить</button></div></details>';
      },
      bindDock: function (root, env) {
        if (env) envRef = env;
        const autoBtn = root.querySelector("[data-light=auto]");
        if (autoBtn) autoBtn.addEventListener("click", function () { resumeAuto(env); });
        const studio = root.querySelector("[data-light=studio]");
        if (studio) studio.addEventListener("click", function () { openStudio(env); });
        root.querySelectorAll("[data-light-play]").forEach(function (button) {
          button.addEventListener("click", function () { playKey(env, button.getAttribute("data-light-play")); });
        });
        root.querySelectorAll("[data-light-unpin]").forEach(function (button) {
          button.addEventListener("click", function () { togglePin(env, button.getAttribute("data-light-unpin")); });
        });
      },
      rgb: {
        label: "Яндекс",
        ready: function () {
          const state = envRef && envRef.state;
          return !!(state && state.hasKey && (state.devices || []).length);
        },
        hold: function () {
          if (!envRef) return;
          stopAnim();
          playing = "";
          holdManual(envRef);
        },
        auto: function (on) {
          if (!envRef) return;
          if (on) resumeAuto(envRef);
          else {
            stopAnim();
            playing = "";
            holdManual(envRef);
          }
        },
        frame: function (rgb, brightness, force) {
          if (!envRef || !rgb) return;
          const now = Date.now();
          if (!force && now - yandexFrameAt < 400) return;
          yandexFrameAt = now;
          const hsv = lampHsv(rgb[0], rgb[1], rgb[2]);
          hsv.v = Math.max(1, Math.min(100, Math.round(brightness)));
          lastKey = "";
          send(envRef, Object.assign({ manual: true }, hsv), true);
        }
      }
    });
  }

  if (window.ShirmoHost) install(window.ShirmoHost);
  else window.addEventListener("shirmo-host", function () { install(window.ShirmoHost); }, { once: true });
})();
