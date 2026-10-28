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
    return env.post(path, body);
  }

  function send(env, body, manual) {
    if (!manual && !auto) return;
    const key = JSON.stringify(body);
    if (key === lastKey) return;
    lastKey = key;
    post(env, "/apply", body).catch(function () { lastKey = ""; });
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

  function placeColor(loc) {
    if (!loc) return "";
    if (/^#[0-9a-f]{6}$/i.test(loc.lampColor || "")) return loc.lampColor;
    if (tones[loc.id]) return tones[loc.id];
    if (!placeImage) return BACK;
    return "";
  }

  function paintSwatch(loc, color) {
    if (!loc || !color) return;
    document.querySelectorAll('[data-lamp="' + loc.id + '"]').forEach(function (node) {
      if (loc.lampColor) return;
      node.style.setProperty("--swatch", color);
    });
  }

  function sample(env, url, loc) {
    if (!url || !loc) return;
    const image = new Image();
    image.onload = function () {
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
        tones[loc.id] = hex;
        paintSwatch(loc, hex);
        if (placeLoc && placeLoc.id === loc.id) apply(env);
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
      input.addEventListener("change", function () {
        const ids = [];
        box.querySelectorAll("input").forEach(function (node, index) { if (node.checked) ids.push(lights[index].id); });
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
    const state = env.state || {};
    if (state.auto != null) auto = state.auto !== false;
    const box = document.createElement("div");
    box.className = "plugin-box";
    const lamps = document.createElement("p");
    lamps.className = "plugin-label";
    lamps.textContent = "Лампы";
    const mode = document.createElement("div");
    mode.className = "plugin-acts";
    const autoBtn = document.createElement("button");
    autoBtn.type = "button";
    autoBtn.textContent = "Авто";
    if (auto) autoBtn.className = "is-on";
    const colorWrap = document.createElement("label");
    colorWrap.className = "plugin-color";
    colorWrap.append(document.createTextNode("Свой цвет"));
    const color = document.createElement("input");
    color.type = "color";
    color.value = forcedHex || "#e6c36a";
    color.setAttribute("aria-label", "Свой цвет");
    colorWrap.append(color);
    autoBtn.addEventListener("click", function () {
      auto = true;
      autoBtn.className = "is-on";
      lastKey = "";
      post(env, "/auto", { on: true }).then(function () { apply(env); }).catch(function (error) { env.note(error.message); });
    });
    color.addEventListener("input", function () {
      auto = false;
      autoBtn.className = "";
      forcedHex = color.value;
      const hsv = hexHsv(color.value);
      post(env, "/auto", { on: false }).catch(function () {});
      if (hsv) queue(env, hsv, true);
    });
    mode.append(autoBtn, colorWrap);
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
    box.append(lamps, deviceList(env), mode, keyLine, keySlot);
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
      const swatch = document.querySelector('[data-lamp="' + dropper.loc.id + '"]');
      if (swatch) swatch.style.setProperty("--swatch", pixel.hex);
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

  function install(host) {
    host.add({
      id: "adaptive-light",
      mapFlag: true,
      settings: settings,
      place: function (loc, image, env) {
        placeLoc = loc || null;
        placeImage = image || "";
        if (loc && image && !loc.lampColor && !tones[loc.id]) sample(env, image, loc);
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
        color.value = (/^#[0-9a-f]{6}$/i.test(loc.lampColor || "") && loc.lampColor) || tones[loc.id] || BACK;
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
          anchor.style.setProperty("--swatch", color.value);
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
      dockHtml: function () {
        return '<details class="dock-fold" data-fold="light" open><summary>Подсветка</summary>' +
          '<div class="dock-form light-form"><label>Цвет<input data-light="force" type="color" value="' + (forcedHex || "#e6c36a") + '" aria-label="Свой цвет"></label>' +
          '<button type="button" data-light="auto"' + (auto ? ' class="is-on"' : "") + ">Авто</button></div></details>";
      },
      bindDock: function (root, env) {
        const force = root.querySelector("[data-light=force]");
        const button = root.querySelector("[data-light=auto]");
        if (force) force.addEventListener("input", function () {
          auto = false;
          forcedHex = force.value;
          if (button) button.classList.remove("is-on");
          const hsv = hexHsv(force.value);
          post(env, "/auto", { on: false }).catch(function () {});
          if (hsv) queue(env, hsv, true);
        });
        if (button) button.addEventListener("click", function () {
          auto = true;
          button.classList.add("is-on");
          lastKey = "";
          post(env, "/auto", { on: true }).then(function () { apply(env); }).catch(function () {});
        });
      }
    });
  }

  if (window.ShirmoHost) install(window.ShirmoHost);
  else window.addEventListener("shirmo-host", function () { install(window.ShirmoHost); }, { once: true });
})();
