(function () {
  if (window.name === 'scream-presenter') return;

  var NS  = 'http://www.w3.org/2000/svg';
  var svg = document.getElementById('anno-svg');
  if (!svg) return;

  var els       = {};
  var selected  = null;
  var mode      = null;   // 'drawing' | 'dragging' | null
  var colorMode = false;
  var fillMode  = false;  // F toggles filled shapes
  var kind      = 'arrow'; // 'arrow'|'rect'|'ellipse'|'highlight'|'text'|'interact'
  var colorName = 'red';

  var colors = {
    red:    function (a) { return 'rgba(220,20,20,'  + a + ')'; },
    orange: function (a) { return 'rgba(240,120,10,' + a + ')'; },
    yellow: function (a) { return 'rgba(220,200,10,' + a + ')'; },
    blue:   function (a) { return 'rgba(40,100,220,' + a + ')'; },
    green:  function (a) { return 'rgba(20,180,20,'  + a + ')'; },
    white:  function (a) { return 'rgba(250,250,250,'+ a + ')'; },
  };

  /* Blend stroke color 30% into bg #1a1a1a (26,26,26) → opaque fill */
  var colorRGB = {
    red:    [220,20,20],
    orange: [240,120,10],
    yellow: [220,200,10],
    blue:   [40,100,220],
    green:  [20,180,20],
    white:  [250,250,250],
  };
  function blendFill(name) {
    var bg = 26, a = 0.30, c = colorRGB[name] || [128,128,128];
    var r = Math.round(bg + a * (c[0] - bg));
    var g = Math.round(bg + a * (c[1] - bg));
    var b = Math.round(bg + a * (c[2] - bg));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function shapeFill() { return fillMode ? blendFill(colorName) : 'none'; }

  /* ── Arrowhead markers ── */
  var defs = document.createElementNS(NS, 'defs');
  Object.keys(colors).forEach(function (name) {
    var marker = document.createElementNS(NS, 'marker');
    marker.setAttribute('id', 'ah-' + name);
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('refX', '0');
    marker.setAttribute('refY', '2');
    marker.setAttribute('orient', 'auto');
    var poly = document.createElementNS(NS, 'polygon');
    poly.setAttribute('points', '0 0,5 2,0 4');
    poly.setAttribute('fill', colors[name](1));
    marker.appendChild(poly);
    defs.appendChild(marker);
  });
  svg.insertBefore(defs, svg.firstChild);

  function uid()        { return Date.now() + '-' + Math.random().toString(36).slice(2); }
  function shadow(el)   { el.setAttribute('filter', 'drop-shadow(1px 1px 3px rgba(255,255,255,0.6))'); }
  function unshadow(el) { el.removeAttribute('filter'); }

  /* ── Arrow ── */
  function Arrow(x, y) {
    this.id = 'a-' + uid(); this.x1 = x; this.y1 = y;
    this.el = document.createElementNS(NS, 'line');
    this.el.setAttribute('x1', x); this.el.setAttribute('y1', y);
    this.el.setAttribute('x2', x); this.el.setAttribute('y2', y);
    this.el.setAttribute('stroke', colors[colorName](1));
    this.el.setAttribute('stroke-width', '4');
    this.el.setAttribute('stroke-linecap', 'round');
    this.el.setAttribute('marker-end', 'url(#ah-' + colorName + ')');
    this.el.setAttribute('id', this.id); this.el.setAttribute('_kind', 'arrow');
    svg.appendChild(this.el); els[this.id] = this;
  }
  Arrow.prototype.updateShape = function (ev) {
    var el = this.el;
    requestAnimationFrame(function () {
      el.setAttribute('x2', ev.clientX); el.setAttribute('y2', ev.clientY);
    });
  };
  Arrow.prototype.length = function () {
    var dx = parseFloat(this.el.getAttribute('x2')) - this.x1;
    var dy = parseFloat(this.el.getAttribute('y2')) - this.y1;
    return Math.sqrt(dx * dx + dy * dy);
  };
  Arrow.prototype.select   = function () { shadow(this.el); };
  Arrow.prototype.deselect = function () { unshadow(this.el); if (this.length() < 8) this.delete(); };
  Arrow.prototype.dragInit = function (cx, cy) {
    this._ox = cx - parseFloat(this.el.getAttribute('x1'));
    this._oy = cy - parseFloat(this.el.getAttribute('y1'));
    this._ex = cx - parseFloat(this.el.getAttribute('x2'));
    this._ey = cy - parseFloat(this.el.getAttribute('y2'));
  };
  Arrow.prototype.drag = function (ev) {
    var el = this.el, ox = this._ox, oy = this._oy, ex = this._ex, ey = this._ey;
    requestAnimationFrame(function () {
      el.setAttribute('x1', ev.clientX - ox); el.setAttribute('y1', ev.clientY - oy);
      el.setAttribute('x2', ev.clientX - ex); el.setAttribute('y2', ev.clientY - ey);
    });
  };
  Arrow.prototype.delete = function () {
    delete els[this.id]; try { svg.removeChild(this.el); } catch (e) {}
  };

  /* ── Rect / Highlight ── */
  function Rect(x, y, rKind) {
    this.id = 'r-' + uid(); this.kind = rKind;
    this.startX = x; this.startY = y; this.x = x; this.y = y;
    this.el = document.createElementNS(NS, 'rect');
    this.el.setAttribute('x', x); this.el.setAttribute('y', y);
    this.el.setAttribute('width', 0); this.el.setAttribute('height', 0);
    if (rKind === 'rect') {
      this.el.setAttribute('stroke', colors[colorName](1));
      this.el.setAttribute('stroke-width', '4');
      this.el.setAttribute('fill', shapeFill());
      this.el.setAttribute('rx', '4');
    } else {
      this.el.setAttribute('stroke-width', '0');
      this.el.setAttribute('fill', colors[colorName](0.25));
      this.el.setAttribute('rx', '2');
    }
    this.el.setAttribute('id', this.id); this.el.setAttribute('_kind', rKind);
    svg.appendChild(this.el); els[this.id] = this;
  }
  Rect.prototype.updateShape = function (ev) {
    var w = ev.clientX - this.startX, h = ev.clientY - this.startY;
    var x = w < 0 ? ev.clientX : this.startX;
    var y = h < 0 ? ev.clientY : this.startY;
    this.x = x; this.y = y;
    var el = this.el;
    requestAnimationFrame(function () {
      el.setAttribute('x', x); el.setAttribute('y', y);
      el.setAttribute('width', Math.abs(w)); el.setAttribute('height', Math.abs(h));
    });
  };
  Rect.prototype.dragInit = function (cx, cy) { this._ox = cx - this.x; this._oy = cy - this.y; };
  Rect.prototype.drag = function (ev) {
    var nx = ev.clientX - this._ox, ny = ev.clientY - this._oy;
    this.x = nx; this.y = ny;
    var el = this.el;
    requestAnimationFrame(function () { el.setAttribute('x', nx); el.setAttribute('y', ny); });
  };
  Rect.prototype.select   = function () { shadow(this.el); };
  Rect.prototype.deselect = function () { unshadow(this.el); };
  Rect.prototype.delete   = function () {
    delete els[this.id]; try { svg.removeChild(this.el); } catch (e) {}
  };

  /* ── Ellipse ── */
  function Ellipse(cx, cy) {
    this.id = 'e-' + uid();
    this.startX = cx; this.startY = cy; this.cx = cx; this.cy = cy;
    this.el = document.createElementNS(NS, 'ellipse');
    this.el.setAttribute('cx', cx); this.el.setAttribute('cy', cy);
    this.el.setAttribute('rx', 0); this.el.setAttribute('ry', 0);
    this.el.setAttribute('stroke', colors[colorName](1));
    this.el.setAttribute('stroke-width', '4');
    this.el.setAttribute('fill', shapeFill());
    this.el.setAttribute('id', this.id); this.el.setAttribute('_kind', 'ellipse');
    svg.appendChild(this.el); els[this.id] = this;
  }
  Ellipse.prototype.updateShape = function (ev) {
    var w = ev.clientX - this.startX, h = ev.clientY - this.startY;
    this.cx = this.startX + w / 2; this.cy = this.startY + h / 2;
    var el = this.el, cx = this.cx, cy = this.cy;
    requestAnimationFrame(function () {
      el.setAttribute('cx', cx); el.setAttribute('cy', cy);
      el.setAttribute('rx', Math.abs(w / 2)); el.setAttribute('ry', Math.abs(h / 2));
    });
  };
  Ellipse.prototype.dragInit = function (cx, cy) { this._ox = cx - this.cx; this._oy = cy - this.cy; };
  Ellipse.prototype.drag = function (ev) {
    var ncx = ev.clientX - this._ox, ncy = ev.clientY - this._oy;
    this.cx = ncx; this.cy = ncy;
    var el = this.el;
    requestAnimationFrame(function () { el.setAttribute('cx', ncx); el.setAttribute('cy', ncy); });
  };
  Ellipse.prototype.select   = function () { shadow(this.el); };
  Ellipse.prototype.deselect = function () { unshadow(this.el); };
  Ellipse.prototype.delete   = function () {
    delete els[this.id]; try { svg.removeChild(this.el); } catch (e) {}
  };

  /* ── Text ── */
  function Text(x, y) {
    this.id = 't-' + uid();
    this.x = x; this.y = y;
    this.committed = false;
    this.el = null; // set after commit

    this.fo = document.createElementNS(NS, 'foreignObject');
    this.fo.setAttribute('x', x);
    this.fo.setAttribute('y', y - 52);
    this.fo.setAttribute('width', '900');
    this.fo.setAttribute('height', '80');
    this.fo.setAttribute('id', this.id);
    this.fo.setAttribute('_kind', 'text');

    var div = document.createElement('div');
    div.contentEditable = 'true';
    div.style.cssText = [
      'font-family: OstrichSans, sans-serif',
      'font-size: 52px',
      'font-weight: 900',
      'text-transform: uppercase',
      'letter-spacing: 0.05em',
      'color: ' + colors[colorName](1),
      'background: transparent',
      'border: none',
      'outline: none',
      'min-width: 4px',
      'white-space: nowrap',
      'caret-color: ' + colors[colorName](1),
    ].join('; ');

    this.fo.appendChild(div);
    svg.appendChild(this.fo);
    els[this.id] = this;

    var self = this;
    setTimeout(function () { div.focus(); }, 10);

    div.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' || (ev.key === 'Enter' && !ev.shiftKey)) {
        ev.preventDefault(); ev.stopPropagation();
        self.commit();
      }
    });

    div.addEventListener('blur', function () {
      self.commit();
    });
  }

  Text.prototype.commit = function () {
    if (this.committed) return;
    if (!this.fo || !this.fo.parentNode) { this.committed = true; return; }
    this.committed = true;

    var div     = this.fo.firstChild;
    var content = div ? div.textContent.trim() : '';

    if (!content) {
      svg.removeChild(this.fo);
      delete els[this.id];
      this.fo = null;
      if (selected === this) { selected = null; mode = null; }
      return;
    }

    // Replace foreignObject with SVG <text> for clean hit-testing and dragging
    var tx = parseFloat(this.fo.getAttribute('x'));
    var ty = parseFloat(this.fo.getAttribute('y')) + 52;
    var textEl = document.createElementNS(NS, 'text');
    textEl.setAttribute('x', tx);
    textEl.setAttribute('y', ty);
    textEl.setAttribute('font-family', 'OstrichSans, sans-serif');
    textEl.setAttribute('font-size', '52');
    textEl.setAttribute('font-weight', '900');
    textEl.setAttribute('letter-spacing', '2.6');
    textEl.setAttribute('fill', colors[colorName](1));
    textEl.setAttribute('id', this.id);
    textEl.setAttribute('_kind', 'text');
    textEl.textContent = content.toUpperCase();

    svg.replaceChild(textEl, this.fo);
    this.fo = null;
    this.el = textEl;
    this.x  = tx;
    this.y  = ty;
  };

  Text.prototype.updateShape = function () {};

  Text.prototype.dragInit = function (cx, cy) {
    var el = this.fo || this.el;
    this._ox = cx - parseFloat(el.getAttribute('x'));
    this._oy = cy - parseFloat(el.getAttribute('y'));
  };
  Text.prototype.drag = function (ev) {
    var nx = ev.clientX - this._ox, ny = ev.clientY - this._oy;
    var el = this.fo || this.el;
    requestAnimationFrame(function () { el.setAttribute('x', nx); el.setAttribute('y', ny); });
  };
  Text.prototype.select   = function () { shadow(this.fo || this.el); };
  Text.prototype.deselect = function () { unshadow(this.fo || this.el); };
  Text.prototype.delete   = function () {
    delete els[this.id];
    var el = this.fo || this.el;
    if (el) try { svg.removeChild(el); } catch (e) {}
    this.fo = null; this.el = null;
  };

  /* ── Helpers ── */

  function activeTextObj() {
    return (selected && selected.committed === false && selected.fo) ? selected : null;
  }

  function clearAll() {
    Object.values(els).forEach(function (e) { e.delete(); });
    els = {}; selected = null; mode = null;
  }

  function deselect() {
    if (selected) { selected.deselect(); selected = null; }
    mode = null;
  }

  function updateIndicator() {
    var el = document.getElementById('draw-indicator');
    if (!el) return;
    var inDraw = document.body.classList.contains('draw-mode');
    if (!inDraw) { el.textContent = ''; return; }
    if (colorMode) {
      el.textContent = 'color: r o y b g w';
      el.style.color = '#d4d4d4';
    } else {
      var fill = fillMode ? ' · fill' : '';
      el.textContent = kind + fill + ' · ' + colorName + ' · A R E H T I · F fill · C color · X clear · Esc exit';
      el.style.color = colors[colorName](1);
    }
  }

  /* Walk up from ev.target to find a tracked element */
  function trackedFromTarget(target) {
    var el = target;
    while (el && el !== svg) {
      var id = el.getAttribute && el.getAttribute('id');
      if (id && els[id]) return els[id];
      el = el.parentNode;
    }
    return null;
  }

  /* ── SVG mouse events ── */

  svg.addEventListener('mousedown', function (ev) {
    if (ev.button !== 0) return;

    var at = activeTextObj();

    // Click inside the editing foreignObject → let native cursor/focus work
    if (at && at.fo.contains(ev.target)) return;

    // Click anywhere else while text is open → commit via blur then proceed
    if (at) {
      var div = at.fo.firstChild;
      if (div) div.blur(); // synchronous: fires blur → commit
    }

    var tracked = trackedFromTarget(ev.target);

    if (tracked) {
      if (tracked.committed === false) return; // still editing; let event settle
      ev.preventDefault(); ev.stopPropagation();
      deselect();
      selected = tracked;
      selected.select();
      selected.dragInit(ev.clientX, ev.clientY);
      mode = 'dragging';
      return;
    }

    if (kind === 'interact') {
      ev.preventDefault(); ev.stopPropagation();
      deselect();
      return;
    }

    ev.preventDefault(); ev.stopPropagation();
    deselect();
    mode = 'drawing';
    if      (kind === 'arrow')     selected = new Arrow(ev.clientX, ev.clientY);
    else if (kind === 'rect')      selected = new Rect(ev.clientX, ev.clientY, 'rect');
    else if (kind === 'highlight') selected = new Rect(ev.clientX, ev.clientY, 'highlight');
    else if (kind === 'ellipse')   selected = new Ellipse(ev.clientX, ev.clientY);
    else if (kind === 'text') {
      selected = new Text(ev.clientX, ev.clientY);
      mode = null; // text manages its own lifecycle via blur/keydown
    }
  });

  svg.addEventListener('mousemove', function (ev) {
    if (mode === 'drawing'  && selected) selected.updateShape(ev);
    if (mode === 'dragging' && selected) selected.drag(ev);
  });

  svg.addEventListener('mouseup', function (ev) {
    ev.stopPropagation();
    if (mode === 'drawing') { deselect(); }
    else if (mode === 'dragging') { mode = null; }
  });

  /* ── Keyboard ── */

  document.addEventListener('keydown', function (ev) {
    // While editing text let ALL keys reach the contenteditable div unblocked.
    // The div's own keydown handler deals with Escape/Enter.
    if (activeTextObj()) return;

    var inDraw = document.body.classList.contains('draw-mode');

    if (inDraw && colorMode) {
      var pick = { r:'red', o:'orange', y:'yellow', b:'blue', g:'green', w:'white' }[ev.key];
      if (pick) colorName = pick;
      colorMode = false;
      updateIndicator();
      ev.preventDefault(); ev.stopPropagation(); return;
    }

    if (ev.key === 'b' || ev.key === 'B') {
      document.body.classList.toggle('blackout-on');
      ev.preventDefault(); ev.stopPropagation(); return;
    }
    if (ev.key === 'd' || ev.key === 'D') {
      document.body.classList.toggle('draw-mode');
      if (!document.body.classList.contains('draw-mode')) { deselect(); colorMode = false; }
      updateIndicator(); ev.preventDefault(); ev.stopPropagation(); return;
    }

    if (!inDraw) return;
    ev.stopPropagation();

    switch (ev.key) {
      case 'Escape':
        if (colorMode) { colorMode = false; updateIndicator(); break; }
        if (selected) deselect();
        else { document.body.classList.remove('draw-mode'); updateIndicator(); }
        break;
      case 'a': case 'A': kind = 'arrow';     updateIndicator(); break;
      case 'r': case 'R': kind = 'rect';      updateIndicator(); break;
      case 'e': case 'E': kind = 'ellipse';   updateIndicator(); break;
      case 'h': case 'H': kind = 'highlight'; updateIndicator(); break;
      case 't': case 'T': kind = 'text';      updateIndicator(); break;
      case 'i': case 'I': kind = 'interact';  updateIndicator(); break;
      case 'f': case 'F': fillMode = !fillMode; updateIndicator(); break;
      case 'c': case 'C': colorMode = true;   updateIndicator(); break;
      case 'x': case 'X': clearAll();         updateIndicator(); break;
      case 'Backspace': case 'Delete':
        if (selected) { selected.delete(); selected = null; mode = null; }
        break;
    }
    ev.preventDefault();
  }, true);

  document.addEventListener('scream:slidechange', clearAll);

})();
