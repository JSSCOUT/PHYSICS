/**
 * ElectroMag Calculator — calculators.js
 * Pure vanilla JavaScript for all physics calculators.
 */

/* ============================================================
   UTILITY HELPERS
   ============================================================ */

/**
 * Show a result in the given result-box element.
 * @param {string} boxId   - id of the result-box div
 * @param {string} value   - formatted result string (e.g. "20.00 V")
 * @param {string} explanation - brief explanation sentence
 * @param {boolean} isError - if true, style as error
 */
function showResult(boxId, value, explanation, isError = false) {
  const box = document.getElementById(boxId);
  if (!box) return;

  box.className = 'result-box show' + (isError ? ' error' : '');

  const valueEl = box.querySelector('.result-value');
  const explEl  = box.querySelector('.result-explanation');

  if (valueEl) valueEl.textContent = value;
  if (explEl)  explEl.textContent  = explanation;
}

/**
 * Parse a float from an input field; returns NaN if blank or invalid.
 */
function getFloat(id) {
  const el = document.getElementById(id);
  if (!el) return NaN;
  const val = parseFloat(el.value.trim());
  return val;
}

/**
 * Format a number to a reasonable number of significant figures.
 * Uses exponential notation for very large or very small values.
 */
function fmt(num) {
  if (!isFinite(num)) return 'undefined';
  const abs = Math.abs(num);
  if (abs === 0) return '0';
  if (abs >= 1e6 || (abs < 1e-3 && abs > 0)) {
    return num.toExponential(4);
  }
  return parseFloat(num.toPrecision(6)).toString();
}

/* ============================================================
   HAMBURGER MENU
   ============================================================ */
document.addEventListener('DOMContentLoaded', function () {
  const hamburger = document.querySelector('.hamburger');
  const navLinks  = document.querySelector('.nav-links');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', function () {
      const isOpen = hamburger.classList.toggle('open');
      navLinks.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Close menu when a link is clicked
    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
      });
    });
  }
});

/* ============================================================
   OHM'S LAW  (V = I × R)
   ============================================================ */

/**
 * Show/hide input fields based on what the user wants to solve for.
 * Called on change of the #ohm-solve-for select.
 */
function updateOhmInputs() {
  const solveFor = document.getElementById('ohm-solve-for').value;

  const groupV = document.getElementById('ohm-group-v');
  const groupI = document.getElementById('ohm-group-i');
  const groupR = document.getElementById('ohm-group-r');

  // Reset all
  [groupV, groupI, groupR].forEach(function (g) {
    if (g) { g.style.display = 'block'; }
  });

  // Hide the one we're solving for
  if (solveFor === 'voltage'     && groupV) groupV.style.display = 'none';
  if (solveFor === 'current'     && groupI) groupI.style.display = 'none';
  if (solveFor === 'resistance'  && groupR) groupR.style.display = 'none';

  // Clear previous result
  const box = document.getElementById('ohm-result');
  if (box) box.className = 'result-box';
}

/**
 * Calculate Ohm's Law result.
 */
function calculateOhm() {
  const solveFor = document.getElementById('ohm-solve-for').value;

  if (solveFor === 'voltage') {
    const I = getFloat('ohm-current');
    const R = getFloat('ohm-resistance');
    if (isNaN(I) || isNaN(R)) {
      showResult('ohm-result', 'Invalid input', 'Please enter valid numbers for Current and Resistance.', true);
      return;
    }
    if (I < 0 || R < 0) {
      showResult('ohm-result', 'Invalid input', 'Current and Resistance must be non-negative values.', true);
      return;
    }
    const V = I * R;
    showResult(
      'ohm-result',
      fmt(V) + ' V',
      'Using V = I × R = ' + fmt(I) + ' A × ' + fmt(R) + ' Ω = ' + fmt(V) + ' V'
    );

  } else if (solveFor === 'current') {
    const V = getFloat('ohm-voltage');
    const R = getFloat('ohm-resistance');
    if (isNaN(V) || isNaN(R)) {
      showResult('ohm-result', 'Invalid input', 'Please enter valid numbers for Voltage and Resistance.', true);
      return;
    }
    if (R === 0) {
      showResult('ohm-result', 'Division by zero', 'Resistance cannot be zero when solving for Current.', true);
      return;
    }
    if (R < 0) {
      showResult('ohm-result', 'Invalid input', 'Resistance must be a positive value.', true);
      return;
    }
    const I = V / R;
    showResult(
      'ohm-result',
      fmt(I) + ' A',
      'Using I = V / R = ' + fmt(V) + ' V ÷ ' + fmt(R) + ' Ω = ' + fmt(I) + ' A'
    );

  } else if (solveFor === 'resistance') {
    const V = getFloat('ohm-voltage');
    const I = getFloat('ohm-current');
    if (isNaN(V) || isNaN(I)) {
      showResult('ohm-result', 'Invalid input', 'Please enter valid numbers for Voltage and Current.', true);
      return;
    }
    if (I === 0) {
      showResult('ohm-result', 'Division by zero', 'Current cannot be zero when solving for Resistance.', true);
      return;
    }
    if (I < 0) {
      showResult('ohm-result', 'Invalid input', 'Current must be a positive value.', true);
      return;
    }
    const R = V / I;
    showResult(
      'ohm-result',
      fmt(R) + ' Ω',
      'Using R = V / I = ' + fmt(V) + ' V ÷ ' + fmt(I) + ' A = ' + fmt(R) + ' Ω'
    );
  }
}

/* ============================================================
   ELECTRIC POWER  (P = V × I)
   ============================================================ */

/**
 * Show/hide input fields based on what the user wants to solve for.
 */
function updatePowerInputs() {
  const solveFor = document.getElementById('power-solve-for').value;

  const groupP = document.getElementById('power-group-p');
  const groupV = document.getElementById('power-group-v');
  const groupI = document.getElementById('power-group-i');

  [groupP, groupV, groupI].forEach(function (g) {
    if (g) { g.style.display = 'block'; }
  });

  if (solveFor === 'power'   && groupP) groupP.style.display = 'none';
  if (solveFor === 'voltage' && groupV) groupV.style.display = 'none';
  if (solveFor === 'current' && groupI) groupI.style.display = 'none';

  const box = document.getElementById('power-result');
  if (box) box.className = 'result-box';
}

/**
 * Calculate Electric Power result.
 */
function calculatePower() {
  const solveFor = document.getElementById('power-solve-for').value;

  if (solveFor === 'power') {
    const V = getFloat('power-voltage');
    const I = getFloat('power-current');
    if (isNaN(V) || isNaN(I)) {
      showResult('power-result', 'Invalid input', 'Please enter valid numbers for Voltage and Current.', true);
      return;
    }
    const P = V * I;
    showResult(
      'power-result',
      fmt(P) + ' W',
      'Using P = V × I = ' + fmt(V) + ' V × ' + fmt(I) + ' A = ' + fmt(P) + ' W'
    );

  } else if (solveFor === 'voltage') {
    const P = getFloat('power-power');
    const I = getFloat('power-current');
    if (isNaN(P) || isNaN(I)) {
      showResult('power-result', 'Invalid input', 'Please enter valid numbers for Power and Current.', true);
      return;
    }
    if (I === 0) {
      showResult('power-result', 'Division by zero', 'Current cannot be zero when solving for Voltage.', true);
      return;
    }
    const V = P / I;
    showResult(
      'power-result',
      fmt(V) + ' V',
      'Using V = P / I = ' + fmt(P) + ' W ÷ ' + fmt(I) + ' A = ' + fmt(V) + ' V'
    );

  } else if (solveFor === 'current') {
    const P = getFloat('power-power');
    const V = getFloat('power-voltage');
    if (isNaN(P) || isNaN(V)) {
      showResult('power-result', 'Invalid input', 'Please enter valid numbers for Power and Voltage.', true);
      return;
    }
    if (V === 0) {
      showResult('power-result', 'Division by zero', 'Voltage cannot be zero when solving for Current.', true);
      return;
    }
    const I = P / V;
    showResult(
      'power-result',
      fmt(I) + ' A',
      'Using I = P / V = ' + fmt(P) + ' W ÷ ' + fmt(V) + ' V = ' + fmt(I) + ' A'
    );
  }
}

/* ============================================================
   COULOMB'S LAW  (F = k × q1 × q2 / r²)
   k = 9.0 × 10⁹ N·m²/C²
   ============================================================ */

function calculateCoulomb() {
  const k  = 9.0e9;
  const q1 = getFloat('coulomb-q1');
  const q2 = getFloat('coulomb-q2');
  const r  = getFloat('coulomb-r');

  if (isNaN(q1) || isNaN(q2) || isNaN(r)) {
    showResult('coulomb-result', 'Invalid input', 'Please enter valid numbers for q1, q2, and r.', true);
    return;
  }
  if (r === 0) {
    showResult('coulomb-result', 'Division by zero', 'Distance r cannot be zero.', true);
    return;
  }
  if (r < 0) {
    showResult('coulomb-result', 'Invalid input', 'Distance r must be a positive value.', true);
    return;
  }

  const F = k * q1 * q2 / (r * r);
  const sign = F >= 0 ? 'attractive' : 'repulsive';
  showResult(
    'coulomb-result',
    fmt(F) + ' N',
    'F = k·q₁·q₂/r² = (9.0×10⁹ × ' + fmt(q1) + ' × ' + fmt(q2) + ') / ' + fmt(r) + '² = ' + fmt(F) + ' N. The force is ' + sign + '.'
  );
}

/* ============================================================
   ELECTRIC FIELD  (E = k × Q / r²)
   ============================================================ */

function calculateElectricField() {
  const k = 9.0e9;
  const Q = getFloat('efield-Q');
  const r = getFloat('efield-r');

  if (isNaN(Q) || isNaN(r)) {
    showResult('efield-result', 'Invalid input', 'Please enter valid numbers for Q and r.', true);
    return;
  }
  if (r === 0) {
    showResult('efield-result', 'Division by zero', 'Distance r cannot be zero.', true);
    return;
  }
  if (r < 0) {
    showResult('efield-result', 'Invalid input', 'Distance r must be a positive value.', true);
    return;
  }

  const E = k * Q / (r * r);
  showResult(
    'efield-result',
    fmt(E) + ' N/C',
    'E = k·Q/r² = (9.0×10⁹ × ' + fmt(Q) + ') / ' + fmt(r) + '² = ' + fmt(E) + ' N/C'
  );
}

/* ============================================================
   MAGNETIC FORCE ON A WIRE  (F = B × I × L × sin θ)
   ============================================================ */

function calculateMagneticForceWire() {
  const B     = getFloat('wire-B');
  const I     = getFloat('wire-I');
  const L     = getFloat('wire-L');
  const theta = getFloat('wire-theta');

  if (isNaN(B) || isNaN(I) || isNaN(L) || isNaN(theta)) {
    showResult('wire-result', 'Invalid input', 'Please enter valid numbers for B, I, L, and θ.', true);
    return;
  }
  if (B < 0 || L < 0) {
    showResult('wire-result', 'Invalid input', 'Magnetic field B and length L must be non-negative.', true);
    return;
  }

  const thetaRad = theta * (Math.PI / 180);
  const F = B * I * L * Math.sin(thetaRad);

  showResult(
    'wire-result',
    fmt(F) + ' N',
    'F = B·I·L·sin(θ) = ' + fmt(B) + ' T × ' + fmt(I) + ' A × ' + fmt(L) + ' m × sin(' + fmt(theta) + '°) = ' + fmt(F) + ' N'
  );
}

/* ============================================================
   MAGNETIC FORCE ON A CHARGE  (F = q × v × B × sin θ)
   ============================================================ */

function calculateMagneticForceCharge() {
  const q     = getFloat('charge-q');
  const v     = getFloat('charge-v');
  const B     = getFloat('charge-B');
  const theta = getFloat('charge-theta');

  if (isNaN(q) || isNaN(v) || isNaN(B) || isNaN(theta)) {
    showResult('charge-result', 'Invalid input', 'Please enter valid numbers for q, v, B, and θ.', true);
    return;
  }
  if (v < 0 || B < 0) {
    showResult('charge-result', 'Invalid input', 'Velocity v and magnetic field B must be non-negative.', true);
    return;
  }

  const thetaRad = theta * (Math.PI / 180);
  const F = q * v * B * Math.sin(thetaRad);

  showResult(
    'charge-result',
    fmt(F) + ' N',
    'F = q·v·B·sin(θ) = ' + fmt(q) + ' C × ' + fmt(v) + ' m/s × ' + fmt(B) + ' T × sin(' + fmt(theta) + '°) = ' + fmt(F) + ' N'
  );
}

/* ============================================================
   INIT — run updateOhmInputs and updatePowerInputs on load
   so the correct fields are shown from the start.
   ============================================================ */
document.addEventListener('DOMContentLoaded', function () {
  if (document.getElementById('ohm-solve-for'))   updateOhmInputs();
  if (document.getElementById('power-solve-for'))  updatePowerInputs();
});
