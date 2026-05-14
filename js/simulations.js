/**
 * ElectroMag — simulations.js
 * Three fully interactive Canvas simulations:
 *   1. Drag-and-drop Circuit Builder with wire drawing & live solver
 *   2. Coulomb Sandbox — drag/add/flip charges, field lines
 *   3. Magnetic Field Visualizer — draggable wire, probe, vector grid
 */
'use strict';

/* ─────────────────────────────────────────────
   SHARED HELPERS
───────────────────────────────────────────── */
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function canvasPos(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width  / rect.width;
  const sy = canvas.height / rect.height;
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
}

function arrowHead(ctx, x1, y1, x2, y2, sz) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - sz * Math.cos(a - Math.PI / 6), y2 - sz * Math.sin(a - Math.PI / 6));
  ctx.lineTo(x2 - sz * Math.cos(a + Math.PI / 6), y2 - sz * Math.sin(a + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}


/* ═══════════════════════════════════════════════════════════
   SIMULATION 1 — DRAG-AND-DROP CIRCUIT BUILDER
   ═══════════════════════════════════════════════════════════
   Components live on a snap grid (GRID=60px).
   Each component has two nodes (left/right or top/bottom).
   Wires connect node-to-node.
   A simple series-circuit solver runs on every frame.
*/
(function () {
  const canvas = document.getElementById('circuitCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const GRID = 60;          // snap grid size px
  const NODE_R = 7;         // node dot radius
  const COMP_W = 80;        // component half-width
  const COMP_H = 28;        // component half-height

  /* ── Component definitions ── */
  const DEFAULTS = {
    battery:   { label: 'Battery',   value: 9,    unit: 'V',  color: '#ffa000', resistance: 0   },
    resistor:  { label: 'Resistor',  value: 10,   unit: 'Ω',  color: '#7986cb', resistance: 10  },
    bulb:      { label: 'Bulb',      value: 5,    unit: 'Ω',  color: '#fff176', resistance: 5   },
    switch:    { label: 'Switch',    value: 0,    unit: '',   color: '#80cbc4', resistance: 0, open: true },
    capacitor: { label: 'Capacitor', value: 100,  unit: 'μF', color: '#ce93d8', resistance: 1e9 },
  };

  /* ── State ── */
  let components = [];   // { id, type, x, y, rotation, value, resistance, open? }
  let wires      = [];   // { id, n1:{compId,idx}, n2:{compId,idx} }
  let selected   = null; // component id
  let toolMode   = 'wire'; // 'wire' | 'select' | 'cut'
  let wireMode   = true;  // kept for compat — true when toolMode==='wire'
  let wireStart  = null;  // {compId, idx}
  let dragging   = null;  // {compId, offX, offY}
  let cutLine    = null;  // {x1,y1,x2,y2} while cutting
  let cutFlash   = [];    // [{x,y,t}] scissors flash particles
  let nextId     = 1;
  let electrons  = [];
  let ePhase     = 0;
  let animFrame  = null;
  let dropType   = null;

  /* ── Node positions for a component (respects rotation) ──
     rotation 0/180 → nodes left & right
     rotation 90/270 → nodes top & bottom
  */
  function nodePos(comp) {
    const r = (comp.rotation || 0) % 360;
    if (r === 90 || r === 270) {
      // Vertical orientation — nodes above and below
      return [
        { x: comp.x, y: comp.y - COMP_W },
        { x: comp.x, y: comp.y + COMP_W },
      ];
    }
    // Horizontal (default)
    return [
      { x: comp.x - COMP_W, y: comp.y },
      { x: comp.x + COMP_W, y: comp.y },
    ];
  }

  /* ── Bounding box for hit-testing (respects rotation) ── */
  function compBounds(comp) {
    const r = (comp.rotation || 0) % 360;
    if (r === 90 || r === 270) {
      return { hw: COMP_H, hh: COMP_W }; // swapped
    }
    return { hw: COMP_W, hh: COMP_H };
  }

  /* ── Snap to grid ── */
  function snap(v) { return Math.round(v / GRID) * GRID; }

  /* ── Add component ── */
  function addComponent(type, cx, cy) {
    const def = DEFAULTS[type];
    const id  = nextId++;
    const comp = {
      id, type,
      x: snap(cx), y: snap(cy),
      rotation: 0,
      value: def.value,
      resistance: def.resistance,
      label: def.label,
      unit: def.unit,
      color: def.color,
    };
    if (type === 'switch') comp.open = true;
    components.push(comp);
    rebuildElectrons();
    hideHint();
    return comp;
  }

  function hideHint() {
    const h = document.getElementById('circuitHint');
    if (h) h.classList.add('hidden');
  }

  /* ── Wire helpers ── */
  function addWire(n1, n2) {
    // Prevent duplicate wires
    const dup = wires.find(w =>
      (w.n1.compId === n1.compId && w.n1.idx === n1.idx && w.n2.compId === n2.compId && w.n2.idx === n2.idx) ||
      (w.n1.compId === n2.compId && w.n1.idx === n2.idx && w.n2.compId === n1.compId && w.n2.idx === n1.idx)
    );
    if (dup) return;
    wires.push({ id: nextId++, n1, n2 });
    rebuildElectrons();
  }

  function getNodeWorldPos(ref) {
    const comp = components.find(c => c.id === ref.compId);
    if (!comp) return null;
    return nodePos(comp)[ref.idx];
  }

  function solveCircuit() {
    if (components.length < 2) return null;

    // Need at least one battery
    const batteries = components.filter(c => c.type === 'battery');
    if (batteries.length === 0) return null;

    // Node key helper
    function nk(compId, idx) { return compId + ':' + idx; }

    // Build wire-only adjacency (node → [node, ...])
    // A wire connects compA:idxA ↔ compB:idxB
    const wireAdj = {};
    components.forEach(c => {
      wireAdj[nk(c.id, 0)] = [];
      wireAdj[nk(c.id, 1)] = [];
    });
    wires.forEach(w => {
      wireAdj[nk(w.n1.compId, w.n1.idx)].push(nk(w.n2.compId, w.n2.idx));
      wireAdj[nk(w.n2.compId, w.n2.idx)].push(nk(w.n1.compId, w.n1.idx));
    });

    function isWired(compId, idx) {
      return wireAdj[nk(compId, idx)].length > 0;
    }

    const allWired = components.every(c => isWired(c.id, 0) && isWired(c.id, 1));
    if (!allWired) return null;

    const bat = batteries[0];
    const startKey  = nk(bat.id, 0);  // battery node 0 = left = (+) terminal
    const targetKey = nk(bat.id, 1);  // battery node 1 = right = (−) terminal

    const queue = [{ nodeKey: startKey, usedComps: new Set([bat.id]) }];
    let isClosed = false;

    while (queue.length > 0 && !isClosed) {
      const { nodeKey, usedComps } = queue.shift();

      // Follow each wire from this node
      for (const neighborKey of (wireAdj[nodeKey] || [])) {
        if (neighborKey === targetKey) {
          // We reached the other battery terminal — circuit is closed!
          isClosed = true;
          break;
        }

        // Parse neighbor: compId:idx
        const [nbCompIdStr, nbIdxStr] = neighborKey.split(':');
        const nbCompId = parseInt(nbCompIdStr);
        const nbIdx    = parseInt(nbIdxStr);

        // Don't re-enter a component we already crossed
        if (usedComps.has(nbCompId)) continue;

        // Cross through this component to its other node
        const crossIdx = nbIdx === 0 ? 1 : 0;
        const crossKey = nk(nbCompId, crossIdx);

        const newUsed = new Set(usedComps);
        newUsed.add(nbCompId);

        queue.push({ nodeKey: crossKey, usedComps: newUsed });
      }
    }

    if (!isClosed) return null;

    // Sum voltages and resistances of ALL components in the circuit
    let totalV = 0, totalR = 0;
    components.forEach(c => {
      if (c.type === 'battery')    { totalV += c.value; }
      else if (c.type === 'switch'){ totalR += c.open ? 1e12 : 0; }
      else                         { totalR += c.resistance; }
    });

    // Open switch = effectively open circuit
    if (totalR >= 1e11) return null;
    if (totalR <= 0)    return null;

    const I = totalV / totalR;
    const P = totalV * I;

    // ── Build directed wire flow map ──
    // Directed DFS from battery (+) terminal (node 0).
    // For each wire we encounter, record whether current flows n1→n2 (true) or n2→n1 (false).
    // This is topology-driven — completely independent of which end the user drew from.
    const wireFlow = {}; // wireId → true (n1→n2) | false (n2→n1)
    const visitedNodes = new Set();
    const stack = [nk(bat.id, 0)];
    visitedNodes.add(nk(bat.id, 0));

    while (stack.length) {
      const curKey = stack.pop();

      wires.forEach(wr => {
        const k1 = nk(wr.n1.compId, wr.n1.idx);
        const k2 = nk(wr.n2.compId, wr.n2.idx);

        if (k1 === curKey && !visitedNodes.has(k2)) {
          // Current arrives at k1 (n1 side) → flows n1→n2
          wireFlow[wr.id] = true;
          visitedNodes.add(k2);
          // Cross through the component at k2 to its other node
          const [cid, ci] = k2.split(':').map(Number);
          const otherKey = nk(cid, ci === 0 ? 1 : 0);
          if (!visitedNodes.has(otherKey)) {
            visitedNodes.add(otherKey);
            stack.push(otherKey);
          }
        } else if (k2 === curKey && !visitedNodes.has(k1)) {
          // Current arrives at k2 (n2 side) → flows n2→n1
          wireFlow[wr.id] = false;
          visitedNodes.add(k1);
          // Cross through the component at k1 to its other node
          const [cid, ci] = k1.split(':').map(Number);
          const otherKey = nk(cid, ci === 0 ? 1 : 0);
          if (!visitedNodes.has(otherKey)) {
            visitedNodes.add(otherKey);
            stack.push(otherKey);
          }
        }
      });
    }

    return { V: totalV, R: totalR, I, P, closed: true, wireFlow };
  }

  /* ── Electron path along wires ── */
  function rebuildElectrons() {
    electrons = [];
    // Place electrons along each wire
    wires.forEach(w => {
      const p1 = getNodeWorldPos(w.n1);
      const p2 = getNodeWorldPos(w.n2);
      if (!p1 || !p2) return;
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const count = Math.max(2, Math.floor(len / 40));
      for (let i = 0; i < count; i++) {
        electrons.push({ wireId: w.id, t: i / count });
      }
    });
  }

  /* ── Delete selected ── */
  window.deleteSelected = function () {
    if (!selected) return;
    components = components.filter(c => c.id !== selected);
    wires = wires.filter(w => w.n1.compId !== selected && w.n2.compId !== selected);
    selected = null;
    wireStart = null;
    rebuildElectrons();
    document.getElementById('deleteBtn').style.display = 'none';
    document.getElementById('componentProps').style.display = 'none';
  };

  /* ── Tool mode ── */
  function setTool(mode) {
    toolMode  = mode;
    wireMode  = (mode === 'wire');
    wireStart = null;
    cutLine   = null;
    ['btn-wire-mode','btn-select-mode','btn-cut-mode','btn-rotate-mode'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });
    const activeBtn = { wire:'btn-wire-mode', select:'btn-select-mode', cut:'btn-cut-mode', rotate:'btn-rotate-mode' }[mode];
    const el = document.getElementById(activeBtn);
    if (el) el.classList.add('active');
    canvas.style.cursor = mode === 'wire' ? 'crosshair' : mode === 'cut' ? 'cell' : 'default';
  }

  window.setWireMode   = (on) => setTool(on ? 'wire' : 'select');
  window.setSelectMode = ()   => setTool('select');
  window.setCutMode    = ()   => setTool('cut');
  window.setRotateMode = ()   => setTool('rotate');

  /* ── Rotate selected component ── */
  function rotateSelected() {
    if (!selected) return;
    const comp = components.find(c => c.id === selected);
    if (!comp) return;
    // Remove all wires attached to this component (they'd be misaligned)
    wires = wires.filter(w => w.n1.compId !== comp.id && w.n2.compId !== comp.id);
    comp.rotation = ((comp.rotation || 0) + 90) % 360;
    rebuildElectrons();
    showProps(comp);
  }
  window.rotateSelected = rotateSelected;

  /* ── Reset ── */
  window.resetCircuit = function () {
    components = []; wires = []; selected = null;
    wireStart = null; electrons = []; ePhase = 0;
    document.getElementById('deleteBtn').style.display = 'none';
    document.getElementById('componentProps').style.display = 'none';
    document.getElementById('circuitHint').classList.remove('hidden');
    updateReadouts(null);
  };

  /* ── Readouts ── */
  function updateReadouts(sol) {
    const dot  = document.getElementById('statusDot');
    const txt  = document.getElementById('statusText');
    if (!sol) {
      document.getElementById('cir-v-val').textContent = '— V';
      document.getElementById('cir-i-val').textContent = '— A';
      document.getElementById('cir-r-val').textContent = '— Ω';
      document.getElementById('cir-p-val').textContent = '— W';
      dot.className = 'status-dot open';
      txt.textContent = components.length === 0 ? 'No components placed' : 'Circuit open — connect all nodes';
      return;
    }
    document.getElementById('cir-v-val').textContent = sol.V.toFixed(1) + ' V';
    document.getElementById('cir-i-val').textContent = sol.I.toFixed(3) + ' A';
    document.getElementById('cir-r-val').textContent = sol.R.toFixed(1) + ' Ω';
    document.getElementById('cir-p-val').textContent = sol.P.toFixed(2) + ' W';
    dot.className = 'status-dot closed';
    txt.textContent = 'Circuit closed ✓ — ' + sol.I.toFixed(3) + ' A flowing';
  }

  /* ── Show component properties ── */
  function showProps(comp) {
    const panel = document.getElementById('componentProps');
    const title = document.getElementById('propsTitle');
    const body  = document.getElementById('propsBody');
    panel.style.display = 'block';
    title.textContent = comp.label + ' #' + comp.id;
    body.innerHTML = '';

    if (comp.type === 'battery') {
      body.innerHTML = `
        <div class="prop-row">
          <label>Voltage:</label>
          <input type="number" min="1" max="48" step="0.5" value="${comp.value}"
            onchange="updateCompValue(${comp.id}, parseFloat(this.value))" />
          <span>V</span>
        </div>`;
    } else if (comp.type === 'resistor' || comp.type === 'bulb') {
      body.innerHTML = `
        <div class="prop-row">
          <label>Resistance:</label>
          <input type="number" min="0.1" max="1000" step="0.5" value="${comp.resistance}"
            onchange="updateCompResistance(${comp.id}, parseFloat(this.value))" />
          <span>Ω</span>
        </div>`;
    } else if (comp.type === 'switch') {
      body.innerHTML = `
        <div class="prop-row">
          <label>State:</label>
          <button onclick="toggleSwitch(${comp.id})" style="padding:0.25rem 0.75rem;border-radius:6px;border:1.5px solid #c5cae9;cursor:pointer;font-family:Inter,sans-serif;font-weight:600;">
            ${comp.open ? '🔴 Open' : '🟢 Closed'}
          </button>
        </div>`;
    } else if (comp.type === 'capacitor') {
      body.innerHTML = `<div class="prop-row"><label>Capacitance:</label><span style="font-weight:700;">${comp.value} μF</span></div>
        <div class="prop-row" style="font-size:0.8rem;color:#888;">Blocks DC in steady state</div>`;
    }
  }

  window.updateCompValue = function (id, v) {
    const c = components.find(x => x.id === id);
    if (c) { c.value = v; }
  };
  window.updateCompResistance = function (id, v) {
    const c = components.find(x => x.id === id);
    if (c) { c.resistance = v; }
  };
  window.toggleSwitch = function (id) {
    const c = components.find(x => x.id === id);
    if (c) { c.open = !c.open; showProps(c); }
  };

  /* ── Hit testing ── */
  function hitComponent(px, py) {
    for (let i = components.length - 1; i >= 0; i--) {
      const c = components[i];
      const b = compBounds(c);
      if (Math.abs(px - c.x) <= b.hw + 4 && Math.abs(py - c.y) <= b.hh + 4) return c;
    }
    return null;
  }

  function hitNode(px, py) {
    for (const c of components) {
      const nodes = nodePos(c);
      for (let i = 0; i < nodes.length; i++) {
        if (Math.hypot(px - nodes[i].x, py - nodes[i].y) <= NODE_R + 8) {
          return { compId: c.id, idx: i };
        }
      }
    }
    return null;
  }

  /* ── Wire cutting geometry ── */
  // Returns true if segment (ax,ay)-(bx,by) intersects (cx,cy)-(dx,dy)
  function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    function cross(ox, oy, px, py, qx, qy) {
      return (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
    }
    const d1 = cross(cx, cy, dx, dy, ax, ay);
    const d2 = cross(cx, cy, dx, dy, bx, by);
    const d3 = cross(ax, ay, bx, by, cx, cy);
    const d4 = cross(ax, ay, bx, by, dx, dy);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    return false;
  }

  function cutWiresAlongLine(x1, y1, x2, y2) {
    const cut = [];
    wires = wires.filter(w => {
      const p1 = getNodeWorldPos(w.n1);
      const p2 = getNodeWorldPos(w.n2);
      if (!p1 || !p2) return true;
      if (segmentsIntersect(p1.x, p1.y, p2.x, p2.y, x1, y1, x2, y2)) {
        // Spawn flash particle at midpoint
        cut.push({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, t: 1.0 });
        return false; // remove wire
      }
      return true;
    });
    cutFlash.push(...cut);
    if (cut.length > 0) rebuildElectrons();
  }

  /* ── Pointer events ── */
  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseup',   onUp);
  canvas.addEventListener('dblclick',  onDblClick);
  document.addEventListener('keydown', e => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) deleteSelected();
    if (e.key === 'r' || e.key === 'R') rotateSelected();
    if (e.key === 'w' || e.key === 'W') setTool('wire');
    if (e.key === 's' || e.key === 'S') setTool('select');
    if (e.key === 'c' || e.key === 'C') setTool('cut');
  });

  function onDown(e) {
    e.preventDefault();
    const p = canvasPos(canvas, e);

    if (toolMode === 'wire') {
      const node = hitNode(p.x, p.y);
      if (node) {
        if (!wireStart) {
          wireStart = node;
        } else {
          if (wireStart.compId !== node.compId || wireStart.idx !== node.idx) {
            addWire(wireStart, node);
          }
          wireStart = null;
        }
      } else {
        wireStart = null;
      }
      return;
    }

    if (toolMode === 'cut') {
      cutLine = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      return;
    }

    if (toolMode === 'rotate') {
      const comp = hitComponent(p.x, p.y);
      if (comp) {
        selected = comp.id;
        wires = wires.filter(w => w.n1.compId !== comp.id && w.n2.compId !== comp.id);
        comp.rotation = ((comp.rotation || 0) + 90) % 360;
        rebuildElectrons();
        showProps(comp);
      }
      return;
    }

    // Select mode
    const comp = hitComponent(p.x, p.y);
    if (comp) {
      selected = comp.id;
      dragging = { compId: comp.id, offX: p.x - comp.x, offY: p.y - comp.y };
      document.getElementById('deleteBtn').style.display = 'block';
      showProps(comp);
    } else {
      selected = null;
      dragging = null;
      document.getElementById('deleteBtn').style.display = 'none';
      document.getElementById('componentProps').style.display = 'none';
    }
  }

  function onMove(e) {
    const p = canvasPos(canvas, e);
    mousePos = p;

    if (toolMode === 'cut' && cutLine) {
      cutLine.x2 = p.x;
      cutLine.y2 = p.y;
      return;
    }

    if (!dragging) return;
    const comp = components.find(c => c.id === dragging.compId);
    if (!comp) return;
    const b = compBounds(comp);
    comp.x = snap(Math.max(b.hw + 5, Math.min(canvas.width  - b.hw - 5, p.x - dragging.offX)));
    comp.y = snap(Math.max(b.hh + 5, Math.min(canvas.height - b.hh - 5, p.y - dragging.offY)));
    rebuildElectrons();
  }

  function onUp(e) {
    if (toolMode === 'cut' && cutLine) {
      cutWiresAlongLine(cutLine.x1, cutLine.y1, cutLine.x2, cutLine.y2);
      cutLine = null;
    }
    dragging = null;
  }

  function onDblClick(e) {
    const p = canvasPos(canvas, e);
    const comp = hitComponent(p.x, p.y);
    if (comp && comp.type === 'switch') { toggleSwitch(comp.id); showProps(comp); }
  }

  /* ── Drag from tray ── */
  document.querySelectorAll('.tray-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      dropType = item.dataset.type;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
    });
  });

  const wrap = document.getElementById('circuitWrap');
  wrap.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  wrap.addEventListener('drop', e => {
    e.preventDefault();
    if (!dropType) return;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width  / rect.width;
    const sy = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * sx;
    const cy = (e.clientY - rect.top)  * sy;
    addComponent(dropType, cx, cy);
    dropType = null;
  });

  /* ── Draw ── */
  function drawGrid() {
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let gx = 0; gx <= canvas.width;  gx += GRID) {
      for (let gy = 0; gy <= canvas.height; gy += GRID) {
        ctx.beginPath();
        ctx.arc(gx, gy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawWires(sol) {
    const current = sol ? sol.I : 0;
    const speed   = Math.min(current * 0.002, 0.008);
    ePhase = (ePhase + speed) % 1;

    wires.forEach(w => {
      const p1 = getNodeWorldPos(w.n1);
      const p2 = getNodeWorldPos(w.n2);
      if (!p1 || !p2) return;

      // Wire line
      ctx.strokeStyle = sol ? '#80deea' : '#546e7a';
      ctx.lineWidth   = 3;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      // Electrons on this wire (drawn as arrows)
      if (sol && current > 0.001) {
        // flowForward: true  → electrons animate from n1 toward n2
        //              false → electrons animate from n2 toward n1
        // Determined entirely by the directed DFS from battery (+) in solveCircuit —
        // completely independent of which node the user clicked first when drawing.
        const flowForward = sol.wireFlow ? (sol.wireFlow[w.id] !== false) : true;
        const fromPt = flowForward ? p1 : p2;
        const toPt   = flowForward ? p2 : p1;
        const dx = toPt.x - fromPt.x;
        const dy = toPt.y - fromPt.y;
        const len = Math.sqrt(dx * dx + dy * dy);

        const wireElectrons = electrons.filter(el => el.wireId === w.id);
        wireElectrons.forEach(el => {
          const t = (el.t + ePhase) % 1;
          const ex = fromPt.x + dx * t;
          const ey = fromPt.y + dy * t;
          if (len > 0) {
            const unitDx = dx / len;
            const unitDy = dy / len;
            const arrowStartX = ex - unitDx * 10;
            const arrowStartY = ey - unitDy * 10;
            ctx.fillStyle = '#80deea';
            arrowHead(ctx, arrowStartX, arrowStartY, ex, ey, 8);
          }
        });
      }
    });

    // Wire-in-progress preview
    if (wireMode && wireStart) {
      const p1 = getNodeWorldPos(wireStart);
      if (p1) {
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        // Draw to last known mouse pos (stored in mousePos)
        ctx.lineTo(mousePos.x, mousePos.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  let mousePos = { x: 0, y: 0 };
  canvas.addEventListener('mousemove', e => { mousePos = canvasPos(canvas, e); });

  function drawComponent(comp, sol) {
    const nodes = nodePos(comp);
    const isSelected = comp.id === selected;
    const current = sol ? sol.I : 0;
    const rot = (comp.rotation || 0) * Math.PI / 180;
    const b = compBounds(comp);

    ctx.save();
    ctx.translate(comp.x, comp.y);

    // Selection highlight (drawn before rotation so it stays axis-aligned)
    if (isSelected) {
      ctx.save();
      ctx.rotate(rot);
      roundRect(ctx, -b.hw - 6, -b.hh - 6, (b.hw + 6) * 2, (b.hh + 6) * 2, 10);
      ctx.strokeStyle = '#ffa000';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Rotate for drawing body + symbol
    ctx.rotate(rot);

    // Component body
    roundRect(ctx, -COMP_W, -COMP_H, COMP_W * 2, COMP_H * 2, 8);
    ctx.fillStyle = '#1a237e';
    ctx.fill();
    ctx.strokeStyle = comp.color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Type-specific drawing
    if (comp.type === 'battery')        drawBatterySymbol(ctx, comp, current);
    else if (comp.type === 'resistor')  drawResistorSymbol(ctx, comp);
    else if (comp.type === 'bulb')      drawBulbSymbol(ctx, comp, current, sol);
    else if (comp.type === 'switch')    drawSwitchSymbol(ctx, comp);
    else if (comp.type === 'capacitor') drawCapacitorSymbol(ctx, comp);

    // Value label
    ctx.fillStyle = '#e0e0e0';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const valStr = comp.type === 'battery'   ? comp.value + ' V'
                 : comp.type === 'switch'     ? (comp.open ? 'Open' : 'Closed')
                 : comp.type === 'capacitor'  ? comp.value + ' μF'
                 : comp.resistance + ' Ω';
    ctx.fillText(valStr, 0, COMP_H - 2);

    // Rotation badge
    if ((comp.rotation || 0) !== 0) {
      ctx.fillStyle = 'rgba(255,160,0,0.85)';
      ctx.font = 'bold 9px Inter,sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText((comp.rotation || 0) + '°', COMP_W - 3, -COMP_H + 2);
    }

    ctx.restore();

    // Nodes (drawn in world space — already computed by nodePos)
    nodes.forEach((n, i) => {
      const isWireStart = wireStart && wireStart.compId === comp.id && wireStart.idx === i;
      ctx.beginPath();
      ctx.arc(n.x, n.y, NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = isWireStart ? '#ffa000' : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = isWireStart ? '#ff6f00' : '#90caf9';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  function drawBatterySymbol(ctx, comp, current) {
    // Long/short lines (flipped: - on left, + on right)
    ctx.strokeStyle = '#ffa000';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-20, -9); ctx.lineTo(-20, 9); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-8, -14); ctx.lineTo(-8, 14); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(8, -14); ctx.lineTo(8, 14); ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(20, -9); ctx.lineTo(20, 9); ctx.stroke();
    // - / +
    ctx.fillStyle = '#42a5f5'; ctx.font = 'bold 11px Inter,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('−', -COMP_W + 10, 0);
    ctx.fillStyle = '#ef5350';
    ctx.fillText('+', COMP_W - 10, 0);
  }

  function drawResistorSymbol(ctx, comp) {
    ctx.strokeStyle = '#ffa000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const rx = -50 + i * (100 / steps);
      const ry = (i % 2 === 0 ? -10 : 10);
      i === 0 ? ctx.moveTo(rx, ry) : ctx.lineTo(rx, ry);
    }
    ctx.stroke();
  }

  function drawBulbSymbol(ctx, comp, current, sol) {
    const brightness = sol ? Math.min(current / 3, 1) : 0;
    if (brightness > 0.05) {
      const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, 40);
      grd.addColorStop(0, `rgba(255,230,80,${brightness * 0.6})`);
      grd.addColorStop(1, 'rgba(255,180,0,0)');
      ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2);
      ctx.fillStyle = grd; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fillStyle = brightness > 0 ? `rgba(255,${Math.round(200*brightness+55)},20,${0.3+brightness*0.7})` : 'rgba(255,255,255,0.1)';
    ctx.fill();
    ctx.strokeStyle = '#fff176'; ctx.lineWidth = 1.5; ctx.stroke();
    // Filament
    ctx.strokeStyle = brightness > 0.2 ? `rgba(255,255,200,${brightness})` : '#546e7a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-6, 6); ctx.lineTo(-3, -3); ctx.lineTo(0, 3); ctx.lineTo(3, -3); ctx.lineTo(6, 6);
    ctx.stroke();
  }

  function drawSwitchSymbol(ctx, comp) {
    ctx.strokeStyle = '#80cbc4'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-COMP_W + 10, 0); ctx.lineTo(-20, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(COMP_W - 10, 0); ctx.stroke();
    // Pivot dot
    ctx.beginPath(); ctx.arc(-20, 0, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#80cbc4'; ctx.fill();
    // Arm
    ctx.beginPath(); ctx.moveTo(-20, 0);
    if (comp.open) { ctx.lineTo(10, -18); }
    else           { ctx.lineTo(20, 0); }
    ctx.strokeStyle = '#80cbc4'; ctx.lineWidth = 2.5; ctx.stroke();
    // End dot
    ctx.beginPath(); ctx.arc(20, 0, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#80cbc4'; ctx.fill();
  }

  function drawCapacitorSymbol(ctx, comp) {
    ctx.strokeStyle = '#ce93d8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-COMP_W + 10, 0); ctx.lineTo(-8, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(COMP_W - 10, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-8, -16); ctx.lineTo(-8, 16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, -16); ctx.lineTo(8, 16); ctx.stroke();
  }

  /* ── Draw cut line overlay ── */
  function drawCutLine() {
    if (!cutLine) return;
    ctx.save();
    ctx.strokeStyle = '#ef5350';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 5]);
    ctx.lineCap = 'round';
    ctx.shadowColor = '#ef5350';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(cutLine.x1, cutLine.y1);
    ctx.lineTo(cutLine.x2, cutLine.y2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    // Scissors icon at end
    ctx.font = '18px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✂', cutLine.x2, cutLine.y2 - 12);
    ctx.restore();
  }

  /* ── Draw cut flash particles ── */
  function drawCutFlash() {
    cutFlash = cutFlash.filter(p => p.t > 0);
    cutFlash.forEach(p => {
      p.t -= 0.04;
      const alpha = p.t;
      const r = (1 - p.t) * 22;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(239,83,80,${alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      // Spark lines
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const len = r * 0.8;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(a) * r * 0.4, p.y + Math.sin(a) * r * 0.4);
        ctx.lineTo(p.x + Math.cos(a) * len, p.y + Math.sin(a) * len);
        ctx.strokeStyle = `rgba(255,200,50,${alpha * 0.8})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
  }

  /* ── Main draw loop ── */
  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d1b3e';
    ctx.fillRect(0, 0, W, H);
    drawGrid();

    const sol = solveCircuit();
    updateReadouts(sol);

    drawWires(sol);
    components.forEach(c => drawComponent(c, sol));
    drawCutLine();
    drawCutFlash();

    animFrame = requestAnimationFrame(draw);
  }

  draw();
})();


/* ═══════════════════════════════════════════════════════════
   SIMULATION 2 — COULOMB'S LAW SANDBOX
   Drag charges, double-click to flip sign, right-click to add,
   optional field-line overlay.
═══════════════════════════════════════════════════════════ */
(function () {
  const canvas = document.getElementById('coulombCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const k = 9.0e9;
  const SCALE = 180;   // px per metre
  const CR = 22;       // charge radius px

  let charges = [
    { id: 1, x: 200, y: 210, q:  2e-6 },
    { id: 2, x: 460, y: 210, q: -3e-6 },
  ];
  let nextId   = 3;
  let dragging = null;
  let showField = true;
  let animFrame = null;

  /* ── Helpers ── */
  function getPos(e) { return canvasPos(canvas, e); }

  function hitCharge(px, py) {
    for (let i = charges.length - 1; i >= 0; i--) {
      if (Math.hypot(px - charges[i].x, py - charges[i].y) <= CR + 6) return charges[i];
    }
    return null;
  }

  /* ── Events ── */
  canvas.addEventListener('mousedown',  onDown);
  canvas.addEventListener('mousemove',  onMove);
  canvas.addEventListener('mouseup',    onUp);
  canvas.addEventListener('mouseleave', onUp);
  canvas.addEventListener('dblclick',   onDbl);
  canvas.addEventListener('contextmenu', onRightClick);
  canvas.addEventListener('touchstart', onDown, { passive: false });
  canvas.addEventListener('touchmove',  onMove, { passive: false });
  canvas.addEventListener('touchend',   onUp);

  function onDown(e) {
    e.preventDefault();
    const p = getPos(e);
    const ch = hitCharge(p.x, p.y);
    if (ch) dragging = { id: ch.id, offX: p.x - ch.x, offY: p.y - ch.y };
  }
  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const p = getPos(e);
    const ch = charges.find(c => c.id === dragging.id);
    if (!ch) return;
    ch.x = Math.max(CR + 2, Math.min(canvas.width  - CR - 2, p.x - dragging.offX));
    ch.y = Math.max(CR + 2, Math.min(canvas.height - CR - 2, p.y - dragging.offY));
  }
  function onUp() { dragging = null; }
  function onDbl(e) {
    const p = getPos(e);
    const ch = hitCharge(p.x, p.y);
    if (ch) ch.q = -ch.q;
  }
  function onRightClick(e) {
    e.preventDefault();
    const p = getPos(e);
    const sign = charges.length % 2 === 0 ? 1 : -1;
    const mag  = parseFloat(document.getElementById('col-q-all').value) * 1e-6;
    charges.push({ id: nextId++, x: p.x, y: p.y, q: sign * mag });
  }

  /* ── Field line drawing (simplified) ── */
  function drawFieldLines() {
    const steps = 120, dt = 2;
    const startAngles = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(a => a * Math.PI / 180);

    charges.forEach(src => {
      if (Math.abs(src.q) < 1e-9) return;
      startAngles.forEach(angle => {
        let px = src.x + (CR + 4) * Math.cos(angle);
        let py = src.y + (CR + 4) * Math.sin(angle);
        const sign = src.q > 0 ? 1 : -1;

        ctx.beginPath();
        ctx.moveTo(px, py);

        for (let s = 0; s < steps; s++) {
          // Net E field at (px, py)
          let ex = 0, ey = 0;
          charges.forEach(ch => {
            const dx = px - ch.x, dy = py - ch.y;
            const r2 = dx * dx + dy * dy;
            if (r2 < 100) return;
            const r  = Math.sqrt(r2);
            const E  = k * Math.abs(ch.q) / r2;
            const dir = ch.q > 0 ? 1 : -1;
            ex += dir * E * dx / r;
            ey += dir * E * dy / r;
          });
          const emag = Math.sqrt(ex * ex + ey * ey);
          if (emag < 1e-6) break;
          px += sign * dt * ex / emag;
          py += sign * dt * ey / emag;

          if (px < 0 || px > canvas.width || py < 0 || py > canvas.height) break;

          // Stop if we hit another charge
          let hit = false;
          charges.forEach(ch => {
            if (Math.hypot(px - ch.x, py - ch.y) < CR + 2) hit = true;
          });
          if (hit) break;

          ctx.lineTo(px, py);
        }

        const alpha = Math.min(0.5, Math.abs(src.q) / 8e-6 * 0.5);
        ctx.strokeStyle = src.q > 0 ? `rgba(239,83,80,${alpha})` : `rgba(66,165,245,${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    });
  }

  function drawCharge(ch) {
    const isPos = ch.q >= 0;
    const color = isPos ? '#ef5350' : '#42a5f5';
    const glow  = isPos ? 'rgba(239,83,80,0.3)' : 'rgba(66,165,245,0.3)';

    const grd = ctx.createRadialGradient(ch.x, ch.y, 0, ch.x, ch.y, CR * 2.5);
    grd.addColorStop(0, glow); grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(ch.x, ch.y, CR * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = grd; ctx.fill();

    ctx.beginPath(); ctx.arc(ch.x, ch.y, CR, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Inter,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(isPos ? '+' : '−', ch.x, ch.y);

    const lbl = (ch.q >= 0 ? '+' : '') + (ch.q * 1e6).toFixed(1) + ' μC';
    ctx.fillStyle = '#e0e0e0'; ctx.font = '10px Inter,sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(lbl, ch.x, ch.y + CR + 4);
  }

  function drawForces() {
    for (let i = 0; i < charges.length; i++) {
      let fx = 0, fy = 0;
      for (let j = 0; j < charges.length; j++) {
        if (i === j) continue;
        const dx = charges[i].x - charges[j].x;
        const dy = charges[i].y - charges[j].y;
        const rPx = Math.hypot(dx, dy);
        if (rPx < 1) continue;
        const rM = rPx / SCALE;
        const F  = k * Math.abs(charges[i].q) * Math.abs(charges[j].q) / (rM * rM);
        const sameSign = (charges[i].q >= 0) === (charges[j].q >= 0);
        const dir = sameSign ? 1 : -1;
        fx += dir * F * dx / rPx;
        fy += dir * F * dy / rPx;
      }
      const fmag = Math.sqrt(fx * fx + fy * fy);
      if (fmag < 1e-6) continue;
      const arrowLen = Math.min(70, 10 + Math.log10(1 + fmag) * 14);
      const ux = fx / fmag, uy = fy / fmag;
      const ax = charges[i].x + ux * (CR + 4);
      const ay = charges[i].y + uy * (CR + 4);
      const bx = ax + ux * arrowLen;
      const by = ay + uy * arrowLen;

      const col = charges[i].q >= 0 ? '#ffa000' : '#69f0ae';
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      arrowHead(ctx, ax, ay, bx, by, 9);
    }
  }

  function drawCoulomb() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d1b3e'; ctx.fillRect(0, 0, W, H);

    // Grid dots
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let gx = 20; gx < W; gx += 40)
      for (let gy = 20; gy < H; gy += 40) {
        ctx.beginPath(); ctx.arc(gx, gy, 1.5, 0, Math.PI * 2); ctx.fill();
      }

    if (showField) drawFieldLines();
    drawForces();
    charges.forEach(drawCharge);

    // Max force readout
    let maxF = 0;
    for (let i = 0; i < charges.length; i++) {
      let fx = 0, fy = 0;
      for (let j = 0; j < charges.length; j++) {
        if (i === j) continue;
        const dx = charges[i].x - charges[j].x, dy = charges[i].y - charges[j].y;
        const rM = Math.hypot(dx, dy) / SCALE;
        if (rM < 0.001) continue;
        const F = k * Math.abs(charges[i].q) * Math.abs(charges[j].q) / (rM * rM);
        fx += F * dx / Math.hypot(dx, dy);
        fy += F * dy / Math.hypot(dx, dy);
      }
      maxF = Math.max(maxF, Math.sqrt(fx * fx + fy * fy));
    }
    document.getElementById('col-n-val').textContent = charges.length;
    document.getElementById('col-f-val').textContent = maxF > 1e4 ? maxF.toExponential(2) + ' N' : maxF.toFixed(2) + ' N';

    animFrame = requestAnimationFrame(drawCoulomb);
  }

  /* ── Public API ── */
  window.updateAllCharges = function () {
    const mag = parseFloat(document.getElementById('col-q-all').value) * 1e-6;
    document.getElementById('col-q-lbl').textContent = (mag * 1e6).toFixed(1) + ' μC';
    charges.forEach(ch => { ch.q = (ch.q >= 0 ? 1 : -1) * mag; });
  };

  window.toggleFieldLines = function () {
    showField = !showField;
    const btn = document.getElementById('btn-show-field');
    btn.classList.toggle('active', showField);
  };

  window.resetCoulomb = function () {
    charges = [
      { id: 1, x: 200, y: 210, q:  2e-6 },
      { id: 2, x: 460, y: 210, q: -3e-6 },
    ];
    nextId = 3;
    document.getElementById('col-q-all').value = 3;
    document.getElementById('col-q-lbl').textContent = '3 μC';
  };

  drawCoulomb();
})();


/* ═══════════════════════════════════════════════════════════
   SIMULATION 3 — MAGNETIC FIELD VISUALIZER
   Draggable wire, click to flip direction, mouse-probe,
   optional vector-grid overlay.
═══════════════════════════════════════════════════════════ */
(function () {
  const canvas = document.getElementById('magfieldCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const MU0 = 4 * Math.PI * 1e-7;
  const PX_PER_M = 200;   // 200 px = 1 m

  let wireX = canvas.width  / 2;
  let wireY = canvas.height / 2;
  let current   = 5;
  let direction = 1;   // +1 out, -1 in
  let showVectors = true;
  let draggingWire = false;
  let probeX = -1, probeY = -1;
  let animPhase = 0;
  let animFrame = null;

  const WIRE_R = 18;
  const RADII  = [28, 52, 80, 112, 150, 192];
  const ARROW_ANGLES = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];

  function B_at(rPx) {
    const rM = rPx / PX_PER_M;
    return (MU0 * current) / (2 * Math.PI * rM);
  }

  /* ── Events ── */
  canvas.addEventListener('mousedown', e => {
    const p = canvasPos(canvas, e);
    if (Math.hypot(p.x - wireX, p.y - wireY) <= WIRE_R + 8) {
      draggingWire = true;
    }
  });
  canvas.addEventListener('mousemove', e => {
    const p = canvasPos(canvas, e);
    probeX = p.x; probeY = p.y;
    if (draggingWire) {
      wireX = Math.max(WIRE_R + 5, Math.min(canvas.width  - WIRE_R - 5, p.x));
      wireY = Math.max(WIRE_R + 5, Math.min(canvas.height - WIRE_R - 5, p.y));
    }
  });
  canvas.addEventListener('mouseup',    () => { draggingWire = false; });
  canvas.addEventListener('mouseleave', () => { draggingWire = false; probeX = -1; probeY = -1; });
  canvas.addEventListener('click', e => {
    const p = canvasPos(canvas, e);
    if (Math.hypot(p.x - wireX, p.y - wireY) <= WIRE_R + 8) {
      direction = -direction;
      document.getElementById('mag-dir-val').textContent = direction === 1 ? '⊙ Out' : '⊗ In';
    }
  });
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const p = canvasPos(canvas, e);
    if (Math.hypot(p.x - wireX, p.y - wireY) <= WIRE_R + 12) draggingWire = true;
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const p = canvasPos(canvas, e);
    probeX = p.x; probeY = p.y;
    if (draggingWire) {
      wireX = Math.max(WIRE_R + 5, Math.min(canvas.width  - WIRE_R - 5, p.x));
      wireY = Math.max(WIRE_R + 5, Math.min(canvas.height - WIRE_R - 5, p.y));
    }
  }, { passive: false });
  canvas.addEventListener('touchend', () => { draggingWire = false; });

  /* ── Vector grid ── */
  function drawVectorGrid() {
    const spacing = 44;
    for (let gx = spacing / 2; gx < canvas.width;  gx += spacing) {
      for (let gy = spacing / 2; gy < canvas.height; gy += spacing) {
        const dx = gx - wireX, dy = gy - wireY;
        const rPx = Math.hypot(dx, dy);
        if (rPx < WIRE_R + 4) continue;

        const B = B_at(rPx);
        const maxB = B_at(WIRE_R + 4);
        const intensity = Math.min(1, B / maxB);

        // Tangent direction (perpendicular to radial, rotated by direction)
        const angle = Math.atan2(dy, dx);
        const tangent = angle + direction * Math.PI / 2;

        const arrowLen = 6 + intensity * 10;
        const ax = gx + Math.cos(tangent) * arrowLen;
        const ay = gy + Math.sin(tangent) * arrowLen;

        const alpha = 0.15 + intensity * 0.55;
        ctx.strokeStyle = `rgba(100,181,246,${alpha})`;
        ctx.fillStyle   = `rgba(100,181,246,${alpha})`;
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(gx - Math.cos(tangent) * arrowLen * 0.5, gy - Math.sin(tangent) * arrowLen * 0.5);
        ctx.lineTo(ax, ay);
        ctx.stroke();
        arrowHead(ctx, gx, gy, ax, ay, 4);
      }
    }
  }

  /* ── Field circles ── */
  function drawFieldCircles() {
    RADII.forEach(r => {
      const B = B_at(r);
      const maxB = B_at(RADII[0]);
      const intensity = Math.min(1, B / maxB);
      const alpha = 0.18 + intensity * 0.6;

      ctx.beginPath();
      ctx.arc(wireX, wireY, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(100,181,246,${alpha})`;
      ctx.lineWidth = 1 + intensity * 1.5;
      ctx.stroke();

      // Animated arrows on circle
      ARROW_ANGLES.forEach(baseAngle => {
        const angle = baseAngle + animPhase * direction;
        const ax = wireX + r * Math.cos(angle);
        const ay = wireY + r * Math.sin(angle);
        const tangent = angle + direction * Math.PI / 2;
        const sz = 7 + intensity * 5;

        ctx.fillStyle = `rgba(100,181,246,${alpha + 0.1})`;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(tangent);
        ctx.beginPath();
        ctx.moveTo(sz, 0);
        ctx.lineTo(-sz * 0.6,  sz * 0.5);
        ctx.lineTo(-sz * 0.6, -sz * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });

      // Distance label on rightmost point
      const lx = wireX + r + 4, ly = wireY;
      if (lx < canvas.width - 10) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '9px Inter,sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText((r / PX_PER_M).toFixed(2) + ' m', lx, ly);
      }
    });
  }

  /* ── Wire ── */
  function drawWire() {
    // Outer ring
    ctx.beginPath(); ctx.arc(wireX, wireY, WIRE_R, 0, Math.PI * 2);
    ctx.fillStyle = '#1a237e'; ctx.fill();
    ctx.strokeStyle = draggingWire ? '#ffa000' : '#5c6bc0';
    ctx.lineWidth = draggingWire ? 3 : 2; ctx.stroke();

    // Inner
    ctx.beginPath(); ctx.arc(wireX, wireY, WIRE_R - 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffa000'; ctx.fill();

    // Symbol
    ctx.fillStyle = '#0d1b3e';
    ctx.font = 'bold 13px Inter,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(direction === 1 ? '⊙' : '⊗', wireX, wireY);

    // Drag hint
    if (!draggingWire) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '9px Inter,sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText('drag / click', wireX, wireY + WIRE_R + 3);
    }
  }

  /* ── Probe ── */
  function drawProbe() {
    if (probeX < 0) return;
    const dx = probeX - wireX, dy = probeY - wireY;
    const rPx = Math.hypot(dx, dy);
    if (rPx < WIRE_R + 2) return;

    const B = B_at(rPx);
    const rM = rPx / PX_PER_M;

    // Dashed line from wire to probe
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(wireX, wireY); ctx.lineTo(probeX, probeY); ctx.stroke();
    ctx.setLineDash([]);

    // Probe dot
    ctx.beginPath(); ctx.arc(probeX, probeY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#69f0ae'; ctx.fill();

    // Probe label
    const bStr = (B * 1e6).toFixed(2) + ' μT';
    const rStr = rM.toFixed(3) + ' m';
    const lx = probeX + 10, ly = probeY - 10;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRect(ctx, lx - 4, ly - 14, 90, 34, 5);
    ctx.fill();
    ctx.fillStyle = '#69f0ae';
    ctx.font = 'bold 11px Inter,sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('B = ' + bStr, lx, ly - 10);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '10px Inter,sans-serif';
    ctx.fillText('r = ' + rStr, lx, ly + 4);

    // Update readouts
    document.getElementById('mag-b-val').textContent = bStr;
    document.getElementById('mag-r-val').textContent = rStr;
  }

  function drawMagField() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d1b3e'; ctx.fillRect(0, 0, W, H);

    // Grid dots
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let gx = 20; gx < W; gx += 40)
      for (let gy = 20; gy < H; gy += 40) {
        ctx.beginPath(); ctx.arc(gx, gy, 1.5, 0, Math.PI * 2); ctx.fill();
      }

    animPhase = (animPhase + 0.007) % (Math.PI * 2);

    if (showVectors) drawVectorGrid();
    drawFieldCircles();
    drawWire();
    drawProbe();

    // Current label
    ctx.fillStyle = '#ffa000';
    ctx.font = 'bold 12px Inter,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('I = ' + current.toFixed(1) + ' A', wireX, wireY + WIRE_R + 18);

    document.getElementById('mag-i-val').textContent = current.toFixed(1) + ' A';
    document.getElementById('mag-dir-val').textContent = direction === 1 ? '⊙ Out' : '⊗ In';

    animFrame = requestAnimationFrame(drawMagField);
  }

  /* ── Public API ── */
  window.updateMagField = function () {
    current = parseFloat(document.getElementById('mag-current').value);
    document.getElementById('mag-i-lbl').textContent = current.toFixed(1) + ' A';
  };

  window.toggleVectors = function () {
    showVectors = !showVectors;
    document.getElementById('btn-show-vectors').classList.toggle('active', showVectors);
  };

  window.resetMagField = function () {
    wireX = canvas.width / 2; wireY = canvas.height / 2;
    current = 5; direction = 1;
    document.getElementById('mag-current').value = 5;
    document.getElementById('mag-i-lbl').textContent = '5 A';
    document.getElementById('mag-dir-val').textContent = '⊙ Out';
  };

  drawMagField();
})();

/* Hamburger menu is handled by calculators.js which loads on every page. */