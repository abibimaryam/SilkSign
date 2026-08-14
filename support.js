/*
 * support.js — Ishora landing (.dc.html) uchun minimal DC runtime.
 *
 * Bu fayl `<script type="text/x-dc" data-dc-script>` ichidagi
 * `class Component extends DCLogic` ni baholaydi, `renderVals()` qaytargan
 * kontekst bilan `<x-dc>` shablonini render qiladi va quyidagilarni qo'llab-quvvatlaydi:
 *   {{ ifoda }}          — matn va atribut interpolyatsiyasi
 *   sc-for list as       — ro'yxat bo'yicha takrorlash
 *   sc-if value          — shartli render
 *   onClick/onInput/...  — hodisa bog'lash
 *   style-hover / style-focus — hover/focus uslublari
 * setState() chaqirilганda butun daraxt qayta render bo'ladi (fokus saqlanadi).
 */
(function () {
  "use strict";

  function init() {
    var live = document.querySelector("x-dc");
    var script = document.querySelector('script[type="text/x-dc"][data-dc-script]');
    if (!live || !script) return;

    // --- props (data-props ichidagi default qiymatlar) ---
    var props = {};
    try {
      var raw = JSON.parse(script.getAttribute("data-props") || "{}");
      for (var k in raw) props[k] = raw[k] && raw[k].default;
    } catch (e) {}

    // --- DCLogic bazaviy klassi ---
    var pending = false;
    function scheduleRender() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; render(); });
    }
    var DCLogic = function () { this.props = props; };
    DCLogic.prototype.setState = function (updater) {
      var patch = typeof updater === "function" ? updater(this.state) : updater;
      for (var p in patch) this.state[p] = patch[p];
      scheduleRender();
    };

    // --- Component klassini baholaymiz ---
    var Component;
    try {
      Component = new Function("DCLogic", script.textContent + "\n;return Component;")(DCLogic);
    } catch (e) {
      console.error("DC Component baholashda xato:", e);
      return;
    }
    var inst = new Component();
    inst.props = props;

    // --- helmet (link/style) ni <head> ga ko'chiramiz ---
    var helmet = live.querySelector("helmet");
    if (helmet) {
      Array.prototype.slice.call(helmet.childNodes).forEach(function (n) {
        document.head.appendChild(n);
      });
    }

    // --- toza shablonni saqlaymiz ---
    var template = live.cloneNode(true);
    var th = template.querySelector("helmet");
    if (th) th.remove();
    var templateNodes = Array.prototype.slice.call(template.childNodes);

    // ---------- ifoda yechish ----------
    function resolve(path, scope) {
      if (path == null) return undefined;
      path = path.trim();
      if (path === "true") return true;
      if (path === "false") return false;
      var parts = path.split(".");
      var base, found = false;
      for (var i = 0; i < scope.length; i++) {
        if (scope[i] != null && parts[0] in scope[i]) { base = scope[i][parts[0]]; found = true; break; }
      }
      if (!found) return undefined;
      for (var j = 1; j < parts.length; j++) {
        if (base == null) return undefined;
        base = base[parts[j]];
      }
      return base;
    }

    var EXPR = /\{\{([^}]+)\}\}/g;
    var WHOLE = /^\s*\{\{([^}]+)\}\}\s*$/;

    function interpText(str, scope) {
      return str.replace(EXPR, function (_, e) {
        var v = resolve(e, scope);
        return v == null ? "" : String(v);
      });
    }

    function eventName(attr) {
      return attr.slice(2).toLowerCase(); // onClick -> click
    }

    function processAttrs(node, scope) {
      var attrs = Array.prototype.slice.call(node.attributes);
      var hover = null, focus = null;
      attrs.forEach(function (a) {
        var name = a.name, val = a.value;
        // HTML atribut nomlarini kichik harfga o'tkazadi: onClick -> onclick
        if (name.slice(0, 2).toLowerCase() === "on" && val.indexOf("{{") !== -1) {
          var fn = resolve(val.replace(/[{}]/g, ""), scope);
          node.removeAttribute(name);
          if (typeof fn === "function") node.addEventListener(eventName(name), fn);
        } else if (name === "style-hover") {
          hover = interpText(val, scope); node.removeAttribute(name);
        } else if (name === "style-focus") {
          focus = interpText(val, scope); node.removeAttribute(name);
        } else if (val.indexOf("{{") !== -1) {
          var m = val.match(WHOLE);
          if (m) {
            var v = resolve(m[1], scope);
            if (typeof v === "function") { node.removeAttribute(name); return; }
            node.setAttribute(name, v == null ? "" : String(v));
          } else {
            node.setAttribute(name, interpText(val, scope));
          }
        }
      });
      // hover/focus uchun bazaviy uslubni interpolyatsiyadan keyin olamiz
      if (hover != null) {
        var baseH = node.getAttribute("style") || "";
        node.addEventListener("mouseenter", function () { node.style.cssText = baseH + ";" + hover; });
        node.addEventListener("mouseleave", function () { node.style.cssText = baseH; });
      }
      if (focus != null) {
        var baseF = node.getAttribute("style") || "";
        node.addEventListener("focus", function () { node.style.cssText = baseF + ";" + focus; });
        node.addEventListener("blur", function () { node.style.cssText = baseF; });
      }
    }

    // ---------- daraxtni kengaytirish ----------
    function expand(node, scope) {
      if (node.nodeType === 3) { // text
        if (node.nodeValue.indexOf("{{") !== -1) node.nodeValue = interpText(node.nodeValue, scope);
        return [node];
      }
      if (node.nodeType !== 1) return [node];
      var tag = node.tagName.toLowerCase();

      if (tag === "sc-for") {
        var listExpr = (node.getAttribute("list") || "").replace(/[{}]/g, "");
        var arr = resolve(listExpr, scope) || [];
        var asName = node.getAttribute("as") || "item";
        var kids = Array.prototype.slice.call(node.childNodes);
        var out = [];
        arr.forEach(function (item) {
          var child = {}; child[asName] = item;
          var inner = [child].concat(scope);
          kids.forEach(function (kt) {
            expand(kt.cloneNode(true), inner).forEach(function (x) { out.push(x); });
          });
        });
        return out;
      }

      if (tag === "sc-if") {
        var v = resolve((node.getAttribute("value") || "").replace(/[{}]/g, ""), scope);
        if (!v) return [];
        var out2 = [];
        Array.prototype.slice.call(node.childNodes).forEach(function (kt) {
          expand(kt, scope).forEach(function (x) { out2.push(x); });
        });
        return out2;
      }

      processAttrs(node, scope);
      var newKids = [];
      Array.prototype.slice.call(node.childNodes).forEach(function (kt) {
        expand(kt, scope).forEach(function (x) { newKids.push(x); });
      });
      node.replaceChildren.apply(node, newKids);
      return [node];
    }

    // ---------- render ----------
    function render() {
      var vals = inst.renderVals ? inst.renderVals() : {};
      var scope = [vals];

      var ae = document.activeElement;
      var aid = ae && ae.id;
      var ss = null, se = null;
      if (ae && "selectionStart" in ae) { try { ss = ae.selectionStart; se = ae.selectionEnd; } catch (e) {} }

      var frag = document.createDocumentFragment();
      templateNodes.forEach(function (n) {
        expand(n.cloneNode(true), scope).forEach(function (x) { frag.appendChild(x); });
      });
      live.replaceChildren(frag);

      if (aid) {
        var el = document.getElementById(aid);
        if (el) { el.focus(); if (ss != null && el.setSelectionRange) { try { el.setSelectionRange(ss, se); } catch (e) {} } }
      }
    }

    render();
    if (typeof inst.componentDidMount === "function") {
      try { inst.componentDidMount(); } catch (e) {}
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
