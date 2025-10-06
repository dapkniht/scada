
// --- SCADA SYSTEM STATE & CONFIGURATION ---
const CONFIG = {
  MAX_SPEED_HZ: 50,
  MAX_CURRENT: 12.0,
  MAX_DEBIT_PER_PUMP: 50, // L/s per pump at 100% speed (2900 RPM, 50 Hz)
  MAX_DEBIT_SYSTEM: 150, // L/s total system (3 pumps x 50 L/s)
  ALARM_THRESHOLD_DEBIT: 140, // L/s (adjusted for new system capacity)
  MIN_SPEED_REMOTE: 70, // Minimum speed 70% for REMOTE mode (cooling fan requirement)
  AUTO_PRIORITY: [1,2,3], // default pump order
};

let STATE = {
  user: null, // 'ADMIN', 'SPV', 'TAMU'
  currentMode: 'REMOTE',
  systemSetpoint: 100, // L/s Target Debit (within new system capacity)
  pumps: [
    { id: 1, isRunning: false, speedPct: 0, currentA: 0.0, fault: false, totalizerHours: 0.0 },
    { id: 2, isRunning: false, speedPct: 0, currentA: 0.0, fault: false, totalizerHours: 0.0 },
    { id: 3, isRunning: false, speedPct: 0, currentA: 0.0, fault: false, totalizerHours: 0.0 },
  ],
  flowmeter: { debit: 0, totalizer: 12345.67 },
  alarms: [],
  alarmHistory: [], // {timeISO, time, priority, description, event}
  flowHistory: [],  // {timeISO, time, debit, totalizer}
  pumpHistory: [],  // {timeISO, time, pumpId, status, speedPct, currentA}
};

// --- UTILITIES & MOCK API ---
// Alarm History Utilities
function pushAlarmHistory(entry) {
  // entry: {timeISO, time, priority, description, event}
  STATE.alarmHistory.unshift(entry);
  // Keep reasonable cap
  if (STATE.alarmHistory.length > 2000) {
      STATE.alarmHistory.length = 2000;
  }
}

function recordEvent(priority, description, event) {
  const now = new Date();
  pushAlarmHistory({
      timeISO: now.toISOString(),
      time: now.toLocaleString(),
      priority,
      description,
      event
  });
  // If currently on log page, refresh
  if (!document.getElementById('page-log_alarm').classList.contains('hidden')) {
      renderAlarmLog();
  }
}

// Simple Custom Alert Modal
function showAlertModal(title, message) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-message').textContent = message;
  document.getElementById('custom-alert-modal').classList.remove('hidden');
  document.getElementById('custom-alert-modal').classList.add('flex');
}
function hideAlertModal() {
  document.getElementById('custom-alert-modal').classList.add('hidden');
  document.getElementById('custom-alert-modal').classList.remove('flex');
}

// Role-Based Access Control (RBAC) Checker
function hasPermission(minRole) {
  if (!STATE.user) return false;
  const roles = { 'TAMU': 1, 'ADMIN': 2, 'SPV': 3 };

  // Cek jika role user saat ini memiliki level akses yang sama atau lebih tinggi dari yang diminta
  return roles[STATE.user] >= roles[minRole];
}

// --- AUTHENTICATION MOCK ---

function login() {
  const username = document.getElementById('username').value.toLowerCase();
  const password = document.getElementById('password').value;

  if (password !== '123') {
      showAlertModal('Gagal Login', 'Password salah.');
    return;
  }

  if (username === 'admin') {
      STATE.user = 'ADMIN';
  } else if (username === 'spv') {
      STATE.user = 'SPV';
  } else if (username === 'tamu') {
      STATE.user = 'TAMU';
  } else {
      showAlertModal('Gagal Login', 'Username tidak dikenal.');
    return;
  }

  localStorage.setItem('scada_user', STATE.user);
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  initializeApp();
  showPage('dashboard');
}

function logout() {
  localStorage.removeItem('scada_user');
  STATE.user = null;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-page').classList.remove('hidden');
  // Stop the data simulation loop
  clearInterval(window.dataInterval);
}

function checkAuth() {
  const storedUser = localStorage.getItem('scada_user');
  if (storedUser) {
    STATE.user = storedUser;
      document.getElementById('login-page').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
    initializeApp();
      showPage('dashboard');
  } else {
      document.getElementById('login-page').classList.remove('hidden');
      document.getElementById('app').classList.add('hidden');
  }
}

// --- NAVIGATION LOGIC ---

function showPage(pageId) {
  // Pengecekan Akses untuk halaman Master Settings
  if (pageId === 'master_settings' && !hasPermission('SPV')) {
    showAlertModal('Akses Ditolak', 'Halaman Master Settings hanya dapat diakses oleh SPV.');
    // Jika user tidak berhak, kembalikan ke dashboard
    pageId = 'dashboard'; 
  }

  document.querySelectorAll('.page-content').forEach(p => p.classList.add('hidden'));
  document.getElementById(`page-${pageId}`).classList.remove('hidden');

  // Update active class in sidebar (desktop)
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('bg-blue-700'));
  const activeNav = document.getElementById(`nav-${pageId}`);
  if (activeNav) {
      activeNav.classList.add('bg-blue-700');
  }

  // Update mobile menu selection
  document.getElementById('mobile-menu').value = pageId;

  // Refresh log pages on navigation
  if (pageId === 'log_alarm') {
      renderAlarmLog();
      setTimeout(() => createAlarmCharts(), 100); // Delay to ensure DOM is ready
  } else if (pageId === 'log_flow') {
      renderFlowLog();
      setTimeout(() => createFlowCharts(), 100); // Delay to ensure DOM is ready
  } else if (pageId === 'log_pompa') {
      renderPumpLog();
      setTimeout(() => createPumpCharts(), 100); // Delay to ensure DOM is ready
  }
}

// --- COMMANDING & CONTROLLING MOCK (ADMIN & SPV) ---

function setMode(mode) {
  if (!hasPermission('ADMIN')) {
    showAlertModal('Akses Ditolak', 'Anda tidak memiliki izin untuk mengganti mode operasi.');
    return;
  }

  STATE.currentMode = mode;

  // Update UI Mode Buttons
  document.querySelectorAll('#control-mode-panel button').forEach(btn => {
      btn.classList.remove('bg-blue-600', 'text-white');
      btn.classList.add('bg-white', 'text-gray-600');
  });
  document.getElementById(`mode-${mode.toLowerCase()}`).classList.remove('bg-white', 'text-gray-600');
  document.getElementById(`mode-${mode.toLowerCase()}`).classList.add('bg-blue-600', 'text-white');
  document.getElementById('current-mode-display').textContent = mode;

  // Toggle Manual Control Section visibility
  const manualSection = document.getElementById('manual-control-section');
  const autoControlSection = document.getElementById('auto-control-section');
  const remoteModeInfo = document.getElementById('remote-mode-info');
  
  if (mode === 'MANUAL') {
      // Mode MANUAL: Normal operation, tampilkan kontrol pompa manual
      manualSection.classList.remove('hidden');
      autoControlSection.classList.add('hidden');
      remoteModeInfo.classList.add('hidden');
      
      // Update connection status to show online
      const connectionStatus = document.getElementById('connection-status');
      if (connectionStatus) {
          connectionStatus.innerHTML = `
              <div class="w-2 h-2 rounded-full bg-green-500 mr-2 status-running"></div>
              <span class="text-gray-700">Gateway: ONLINE</span>
          `;
      }
  } else if (mode === 'REMOTE') {
      // Mode REMOTE: SCADA disconnect, panel offline, tidak ada kontrol sistem
      manualSection.classList.add('hidden');
      autoControlSection.classList.add('hidden');
      remoteModeInfo.classList.remove('hidden');
      
      // Update connection status to show offline
      const connectionStatus = document.getElementById('connection-status');
      if (connectionStatus) {
          connectionStatus.innerHTML = `
              <div class="w-2 h-2 rounded-full bg-red-500 mr-2"></div>
              <span class="text-gray-700">Gateway: OFFLINE</span>
          `;
      }
  } else {
      // Mode AUTO: Normal operation
      manualSection.classList.add('hidden');
      autoControlSection.classList.remove('hidden');
      remoteModeInfo.classList.add('hidden');
      
      // Update connection status to show online
      const connectionStatus = document.getElementById('connection-status');
      if (connectionStatus) {
          connectionStatus.innerHTML = `
              <div class="w-2 h-2 rounded-full bg-green-500 mr-2 status-running"></div>
              <span class="text-gray-700">Gateway: ONLINE</span>
          `;
      }
  }

  // Update slider limits based on new mode
  updateSliderLimits();
  
  // Panggil updateUI untuk menyesuaikan disabled state Manual Control
  updateUI();
}

function setSystemSetpoint() {
  if (!hasPermission('ADMIN')) {
    showAlertModal('Akses Ditolak', 'Anda tidak memiliki izin untuk mengubah Setpoint Debit.');
    return;
  }
  const setpoint = parseInt(document.getElementById('target-debit').value);
  if (isNaN(setpoint) || setpoint < 0) {
      showAlertModal('Input Invalid', 'Setpoint Debit harus angka positif.');
    return;
  }
  STATE.systemSetpoint = setpoint;
  showAlertModal('Command Sukses', `Target Debit sistem diatur ke ${setpoint} L/s.`);
}

// --- MANUAL CONTROL (SPV ONLY) ---

function togglePump(pumpId) {
  if (STATE.currentMode !== 'MANUAL') {
      showAlertModal('Gagal Command', 'Pompa hanya dapat dihidupkan/dimatikan di mode MANUAL.');
    return;
  }
  if (!hasPermission('SPV')) {
    showAlertModal('Akses Ditolak', 'Kontrol Pompa Manual hanya dapat dilakukan oleh SPV.');
    return;
  }

  const pump = STATE.pumps[pumpId - 1];
  pump.isRunning = !pump.isRunning;
  
  // Set minimum speed based on mode - 70% for REMOTE mode (cooling fan requirement)
  const minSpeed = STATE.currentMode === 'REMOTE' ? CONFIG.MIN_SPEED_REMOTE : 70;
  pump.speedPct = pump.isRunning ? minSpeed : 0;

  const speedInfo = pump.isRunning ? ` (Speed: ${pump.speedPct}% - Min untuk cooling fan)` : '';
  showAlertModal('Command Sukses', `Pompa ${pumpId} ${pump.isRunning ? 'Dihidupkan' : 'Dimatikan'} secara remote.${speedInfo}`);
  
  // Update slider value to reflect the minimum speed
  if (pump.isRunning) {
      const slider = document.querySelector(`#manual-control-section input[type="range"][onchange*="setManualSpeed(${pumpId},"]`);
      if (slider) slider.value = pump.speedPct;
      document.getElementById(`pump-${pumpId}-manual-speed`).textContent = `${pump.speedPct}%`;
  }
  
  // Recalculate flow immediately in MANUAL mode and update UI
  recalcFlowFromPumps();
  updateUI(); // Immediate UI update
}

function setManualSpeed(pumpId, speed) {
  if (STATE.currentMode !== 'MANUAL') return;
  if (!hasPermission('SPV')) {
    // Jika bukan SPV, reset slider value
    document.querySelector(`#manual-control-section input[type="range"][onchange*="setManualSpeed(${pumpId},"]`).value = STATE.pumps[pumpId - 1].speedPct;
    showAlertModal('Akses Ditolak', 'Pengaturan Speed Manual hanya dapat dilakukan oleh SPV.');
    return;
  }

  const pump = STATE.pumps[pumpId - 1];
  
  // Validate and correct speed value using the validation function
  const correctedSpeed = validateSliderValue(pumpId, speed);
  
  pump.speedPct = correctedSpeed;
  if (pump.speedPct > 0) {
    pump.isRunning = true;
  } else {
    pump.isRunning = false;
  }

  document.getElementById(`pump-${pumpId}-manual-speed`).textContent = `${pump.speedPct}%`;
  // Update toggle button state immediately for responsiveness
  updatePumpToggleButton(pumpId);
  updatePumpSchematic(pump);
  // Recalculate flow immediately in MANUAL mode and update UI
  recalcFlowFromPumps();
  updateUI();
}


// --- SLIDER CONTROL FUNCTIONS ---

function validateSliderValue(pumpId, value) {
  // Check if we're in REMOTE mode and enforce minimum
  const minValue = STATE.currentMode === 'REMOTE' ? CONFIG.MIN_SPEED_REMOTE : 70;
  const numValue = parseInt(value);
  
  if (numValue > 0 && numValue < minValue) {
    // Snap back to minimum value
    const slider = document.querySelector(`#manual-control-section input[type="range"][onchange*="setManualSpeed(${pumpId},"]`);
    if (slider) {
      slider.value = minValue;
      // Update display immediately
      document.getElementById(`pump-${pumpId}-manual-speed`).textContent = `${minValue}%`;
      // Show brief feedback
      showSliderSnapFeedback(pumpId, minValue);
    }
    return minValue;
  }
  return numValue;
}

function showSliderSnapFeedback(pumpId, minValue) {
  // Brief visual feedback when slider snaps back
  const display = document.getElementById(`pump-${pumpId}-manual-speed`);
  const slider = document.querySelector(`#manual-control-section input[type="range"][onchange*="setManualSpeed(${pumpId},"]`);
  
  if (display && slider) {
    // Add visual feedback to both display and slider
    display.classList.add('text-yellow-600', 'font-bold', 'slider-snap-feedback');
    slider.classList.add('slider-snap-feedback');
    
    // Show brief tooltip-like message
    const container = display.parentElement;
    const tooltip = document.createElement('div');
    tooltip.className = 'absolute -top-8 left-0 bg-yellow-500 text-white text-xs px-2 py-1 rounded shadow-lg z-10';
    tooltip.textContent = `Min ${minValue}%`;
    container.style.position = 'relative';
    container.appendChild(tooltip);
    
    setTimeout(() => {
      display.classList.remove('text-yellow-600', 'font-bold', 'slider-snap-feedback');
      slider.classList.remove('slider-snap-feedback');
      if (tooltip.parentElement) {
        tooltip.parentElement.removeChild(tooltip);
      }
    }, 1000);
  }
}

function updateSliderLimits() {
  // Set minimum slider values based on current mode
  const minValue = STATE.currentMode === 'REMOTE' ? CONFIG.MIN_SPEED_REMOTE : 0;
  
  // Update all pump sliders
  for (let i = 1; i <= 3; i++) {
    const slider = document.querySelector(`#manual-control-section input[type="range"][onchange*="setManualSpeed(${i},"]`);
    if (slider) {
      slider.min = minValue;
      
      // Add input event listener for real-time validation
      slider.removeEventListener('input', slider.snapBackHandler); // Remove existing listener
      slider.snapBackHandler = function(event) {
        const correctedValue = validateSliderValue(i, event.target.value);
        if (correctedValue !== parseInt(event.target.value)) {
          event.target.value = correctedValue;
        }
      };
      slider.addEventListener('input', slider.snapBackHandler);
      
      // If current value is below new minimum, adjust it
      if (parseInt(slider.value) > 0 && parseInt(slider.value) < minValue) {
        slider.value = minValue;
        // Update the pump state and display
        const pump = STATE.pumps[i - 1];
        if (pump.isRunning) {
          pump.speedPct = minValue;
          document.getElementById(`pump-${i}-manual-speed`).textContent = `${minValue}%`;
        }
      }
    }
  }
}

// --- DATA SIMULATION & RENDERING ---

// Simulasi Algoritma Kontrol (PID/Staging Mock)
function runControlAlgorithm() {
  let requiredFlow = STATE.systemSetpoint;

  // 1. Staging Logic (simplified) - Based on 50 L/s per pump
  const maxPumps = requiredFlow > 100 ? 3 : (requiredFlow > 50 ? 2 : (requiredFlow > 0 ? 1 : 0));

  // 2. Speed Control Logic (Simplified Load Sharing)
  let pumpCount = 0;
  if (requiredFlow > 0 && STATE.currentMode === 'AUTO') {
    pumpCount = Math.min(maxPumps, 3);
    // Calculate ideal speed per active pump
      const idealSpeed = Math.min(100, Math.ceil((requiredFlow / pumpCount) / CONFIG.MAX_DEBIT_PER_PUMP * 100));
      
      // Apply minimum speed for cooling fan requirement in REMOTE system
      const minSpeed = CONFIG.MIN_SPEED_REMOTE; // 70% minimum for cooling fan
      const finalSpeed = Math.max(idealSpeed, minSpeed);

    // Set running state and speed based on priority order
    const order = (STATE.autoPriority && STATE.autoPriority.length === 3)
      ? STATE.autoPriority
      : (JSON.parse(localStorage.getItem('scada_auto_priority') || 'null') || CONFIG.AUTO_PRIORITY);
    // Reset all first
    STATE.pumps.forEach(p => { p.isRunning = false; p.speedPct = 0; });
    // Activate according to priority
    for (let idx = 0; idx < pumpCount; idx++) {
      const pumpId = order[idx];
      const p = STATE.pumps[pumpId - 1];
      if (p) { p.isRunning = true; p.speedPct = finalSpeed; }
    }
  }

  // 3. Flowmeter Calculation
  let totalFlow = 0;
  STATE.pumps.forEach(p => {
    if (p.isRunning) {
      totalFlow += (p.speedPct / 100) * CONFIG.MAX_DEBIT_PER_PUMP;
    }
  });
  STATE.flowmeter.debit = totalFlow;

  // 4. Totalizer Accumulation (Simulasi 1 detik)
  STATE.flowmeter.totalizer += (STATE.flowmeter.debit * (1 / 3600)); // L/s ke m³/jam
}

// Simulasi Data Real-time (Arus, Level)
function simulateData() {
  if (STATE.currentMode === 'AUTO') {
    runControlAlgorithm();
  }

  let totalCurrent = 0;

  STATE.pumps.forEach(p => {
    if (p.isRunning) {
      // Arus berdasarkan speed (5% - 100% dari Max Current)
      let baseCurrent = CONFIG.MAX_CURRENT * (p.speedPct / 100);
      // Tambahkan noise, tetapi jaga agar tidak terlalu sering fault (dibatasi 120% arus normal)
      p.currentA = (baseCurrent * (0.8 + Math.random() * 0.4)).toFixed(1);
      totalCurrent += parseFloat(p.currentA);
    } else {
      p.currentA = 0.0;
      p.fault = false;
    }
  });

  
  // Rekam sampel flow secara periodik
  recordFlowSample();
  // Rekam snapshot pompa secara periodik
  recordPumpSamples();

  checkAlarms();
  updateUI();
}

// Recalculate flow immediately from current pump speeds (used for MANUAL)
function recalcFlowFromPumps() {
  let totalFlow = 0;
  STATE.pumps.forEach(p => {
    if (p.isRunning) {
      totalFlow += (p.speedPct / 100) * CONFIG.MAX_DEBIT_PER_PUMP;
    }
  });
  STATE.flowmeter.debit = totalFlow;
}

// Pengecekan Alarm
function checkAlarms() {
  // Hanya hapus alarm non-faults untuk simulasi
  STATE.alarms = STATE.alarms.filter(a => a.priority === 'CRITICAL' && a.description.includes('Trip/Fault')); 


  // Alarm 2: Debit Hampir Maksimal
  if (STATE.flowmeter.debit >= CONFIG.ALARM_THRESHOLD_DEBIT && !STATE.alarms.some(a => a.description.includes('Debit mendekati batas maksimal'))) {
      const descWarn = `Debit mendekati batas maksimal sistem (${STATE.flowmeter.debit.toFixed(1)} L/s).`;
    STATE.alarms.push({
      time: new Date().toLocaleTimeString(),
          priority: 'WARNING',
          description: descWarn,
          acknowledged: false
      });
      recordEvent('WARNING', descWarn, 'RAISE');
  } else if (STATE.flowmeter.debit < CONFIG.ALARM_THRESHOLD_DEBIT) {
    // Clear warning jika sudah teratasi
      const had = STATE.alarms.some(a => a.description.includes('Debit mendekati batas maksimal'));
      if (had) {
          recordEvent('WARNING', 'Debit mendekati batas maksimal sistem CLEARED', 'CLEAR');
      }
      STATE.alarms = STATE.alarms.filter(a => !a.description.includes('Debit mendekati batas maksimal'));
  }

  // Alarm 3: Pompa Fault
  STATE.pumps.forEach(p => {
      if (p.currentA > CONFIG.MAX_CURRENT * 1.1) { // Current over 110%
      if (!p.fault) {
        p.fault = true;
              const descTrip = `Pompa ${p.id} Trip/Fault (Arus tinggi: ${p.currentA} A)!`;
        STATE.alarms.push({
          time: new Date().toLocaleTimeString(),
                  priority: 'CRITICAL',
                  description: descTrip,
                  acknowledged: false
              });
              recordEvent('CRITICAL', descTrip, 'RAISE');
      }
    } else if (p.fault && p.currentA <= CONFIG.MAX_CURRENT) {
      // Simulasikan auto-reset fault jika arus kembali normal
      // Di sistem nyata, fault harus di-reset secara manual atau oleh sistem
      p.fault = false;
          recordEvent('CRITICAL', `Pompa ${p.id} Trip/Fault CLEARED`, 'CLEAR');
          STATE.alarms = STATE.alarms.filter(a => !a.description.includes(`Pompa ${p.id} Trip/Fault`));
    }
  });
}

// Update UI Elements
function updateUI() {
  const isOperator = hasPermission('ADMIN');
  const isAdmin = hasPermission('SPV');
  const isManualMode = STATE.currentMode === 'MANUAL';

  // --- Global Info ---
  document.getElementById('user-info').textContent = `User: ${STATE.user}`;

  // --- Monitoring Cards ---
  document.getElementById('monitor-debit').textContent = `${STATE.flowmeter.debit.toFixed(1)} L/s`;
  document.getElementById('monitor-totalizer').textContent = `${STATE.flowmeter.totalizer.toFixed(2)} m³`;
  document.getElementById('monitor-active-pumps').textContent = `${STATE.pumps.filter(p => p.isRunning).length} / 3`;

  // --- Schematic Visualization ---
  document.getElementById('flow-display-schematic').textContent = `${STATE.flowmeter.debit.toFixed(0)} L/s`;

  // --- Pump Details & Schematic ---
  STATE.pumps.forEach(p => {
    const freq = (p.speedPct / 100) * CONFIG.MAX_SPEED_HZ;
    const rpm = (p.speedPct / 100) * 2900; // Max RPM is 2900 at 100%
      
      // Update separate VFD monitoring elements
      document.getElementById(`p${p.id}-speed-pct`).textContent = `${p.speedPct}%`;
      document.getElementById(`p${p.id}-rpm`).textContent = `${Math.round(rpm)} rpm`;
      document.getElementById(`p${p.id}-frequency`).textContent = `${freq.toFixed(1)} Hz`;
      document.getElementById(`p${p.id}-current`).textContent = `${p.currentA} A`;

    updatePumpSchematic(p);
    updatePumpDetails(p);
    updatePumpToggleButton(p.id);
  });

  // --- Alarms List ---
  renderAlarms();

  // --- RBAC & Control Panel Visibility ---

  // Mode Control buttons (SPV/Admin)
  document.querySelectorAll('#control-mode-panel button').forEach(el => {
      el.disabled = !isOperator;
    });

  // Setpoint Control (SPV/Admin) - only active in AUTO mode
  const setpointInput = document.getElementById('target-debit');
  const setpointBtn = document.getElementById('setpoint-btn');
  if (setpointInput) setpointInput.disabled = !(isOperator && STATE.currentMode === 'AUTO');
  if (setpointBtn) setpointBtn.disabled = !(isOperator && STATE.currentMode === 'AUTO');

  // Manual Control Section (Admin only in Manual Mode)
  const manualControlDisabled = !(isAdmin && isManualMode);
  document.getElementById('manual-control-info').classList.toggle('hidden', isAdmin);
  
  document.querySelectorAll('#manual-control-section button, #manual-control-section input').forEach(el => {
      el.disabled = manualControlDisabled;
      // Tambahkan visual feedback untuk tombol yang di-disable
      if (manualControlDisabled) {
          el.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
          el.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    });

  // Master Settings Link Visibility (SPV only)
  document.getElementById('nav-master_settings').classList.toggle('hidden', !isAdmin);
  document.querySelector('#mobile-menu option[value="master_settings"]').disabled = !isAdmin;
        // Disable priority controls for non-SPV on the page
  ['prio-1','prio-2','prio-3','save-priority'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.disabled = !isAdmin; el.classList.toggle('opacity-50', !isAdmin); el.classList.toggle('cursor-not-allowed', !isAdmin); }
  });
  
  // Update slider limits based on current mode
  updateSliderLimits();
}

function updatePumpToggleButton(pumpId) {
  const pump = STATE.pumps[pumpId - 1];
  const toggleBtn = document.getElementById(`pump-${pumpId}-toggle`);

  if (pump.isRunning) {
      toggleBtn.textContent = 'STOP';
      toggleBtn.classList.remove('bg-green-500', 'hover:bg-green-600', 'bg-gray-300');
      toggleBtn.classList.add('bg-red-500', 'hover:bg-red-600', 'text-white');
  } else {
      toggleBtn.textContent = 'START';
      toggleBtn.classList.remove('bg-red-500', 'hover:bg-red-600', 'text-white');
      toggleBtn.classList.add('bg-green-500', 'hover:bg-green-600', 'text-white');
  }
}

function updatePumpSchematic(p) {
  const pumpElement = document.getElementById(`pump-${p.id}`);
  const pipeElement = document.getElementById(`pipe-${p.id}`);
  const image = pumpElement.querySelector('image');
  const text = pumpElement.querySelector('text');

  // Reset classes
  image.classList.remove('status-running', 'status-trip');
  pipeElement.setAttribute('stroke', '#6c757d');

  if (p.fault) {
      image.classList.add('status-trip');
      image.style.filter = 'hue-rotate(0deg) saturate(2) brightness(0.8)'; // Red tint
      text.textContent = 'TRIP';
  } else if (p.isRunning) {
      image.classList.add('status-running');
      image.style.filter = 'hue-rotate(120deg) saturate(1.5) brightness(1.1)'; // Green tint
      pipeElement.setAttribute('stroke', '#22c55e'); // Green flow
    text.textContent = `${p.speedPct}%`;
  } else {
      image.style.filter = 'grayscale(0.3) brightness(0.9)'; // Slightly dimmed
      text.textContent = 'STOP';
  }
}

function updatePumpDetails(p) {
  const statusSpan = document.getElementById(`p${p.id}-status`);
  statusSpan.classList.remove('text-green-600', 'text-red-600', 'text-gray-500');

  if (p.fault) {
      statusSpan.textContent = 'FAULT';
      statusSpan.classList.add('text-red-600', 'font-extrabold');
  } else if (p.isRunning) {
      statusSpan.textContent = 'RUNNING';
      statusSpan.classList.add('text-green-600', 'font-extrabold');
  } else {
      statusSpan.textContent = 'STOP';
      statusSpan.classList.add('text-gray-500');
  }
}

function renderAlarms() {
  const listContainer = document.getElementById('alarm-list');
  const countSpan = document.getElementById('alarm-count');
  const canAcknowledge = hasPermission('ADMIN');
  
  listContainer.innerHTML = '';

  if (STATE.alarms.length === 0) {
      listContainer.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-gray-500">Tidak ada alarm aktif saat ini.</td></tr>';
      countSpan.textContent = '0 Aktif';
      countSpan.classList.remove('bg-red-200', 'text-red-800', 'bg-orange-200', 'text-orange-800');
      countSpan.classList.add('bg-green-200', 'text-green-800');
    return;
  }

  STATE.alarms.forEach((alarm, index) => {
      const row = document.createElement('tr');
      const priorityClass = alarm.priority === 'CRITICAL' ? 'bg-red-100 text-red-700 font-bold' : 'bg-orange-100 text-orange-700';
      const statusText = alarm.acknowledged ? 'ACK' : 'UNACK';
    const acknowledgeDisabled = alarm.acknowledged || !canAcknowledge;

    row.innerHTML = `
          <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-900">${alarm.time}</td>
          <td class="px-4 py-2 whitespace-nowrap text-sm"><span class="px-2 inline-flex text-xs leading-5 rounded-full ${priorityClass}">${alarm.priority}</span></td>
          <td class="px-4 py-2 text-sm text-gray-500">${alarm.description}</td>
          <td class="px-4 py-2 whitespace-nowrap text-sm font-medium">${statusText}</td>
          <td class="px-4 py-2 whitespace-nowrap text-sm font-medium">
              <button class="text-indigo-600 hover:text-indigo-900 ${acknowledgeDisabled ? 'opacity-50 cursor-not-allowed' : ''}" 
                      onclick="acknowledgeAlarm(${index})" 
                      ${acknowledgeDisabled ? 'disabled' : ''}>Acknowledge</button>
          </td>
      `;
    listContainer.appendChild(row);
  });

  countSpan.textContent = `${STATE.alarms.length} Aktif`;
  countSpan.classList.remove('bg-green-200', 'text-green-800');

  // Set warna alarm count
  if (STATE.alarms.some(a => a.priority === 'CRITICAL')) {
      countSpan.classList.add('bg-red-200', 'text-red-800');
      countSpan.classList.remove('bg-orange-200', 'text-orange-800');
  } else {
       countSpan.classList.add('bg-orange-200', 'text-orange-800');
       countSpan.classList.remove('bg-red-200', 'text-red-800');
  }
}

function acknowledgeAlarm(index) {
  if (!hasPermission('ADMIN')) {
    showAlertModal('Akses Ditolak', 'Anda tidak memiliki izin untuk melakukan Acknowledge Alarm.');
    return;
  }
  STATE.alarms[index].acknowledged = true;
  recordEvent(STATE.alarms[index].priority, STATE.alarms[index].description, 'ACK');
  renderAlarms();
}

// --- LOG PAGE RENDERING ---
const LOG_PAGE_SIZE = 10;
let logCurrentPage = 1;

function getLogFilters() {
  const from = document.getElementById('log-date-from').value;
  const to = document.getElementById('log-date-to').value;
  const priority = document.getElementById('log-priority').value;
  const eventType = document.getElementById('log-event').value;
  const search = document.getElementById('log-search').value.trim().toLowerCase();
  return { from, to, priority, eventType, search };
}

function applyLogFilters(data) {
  const { from, to, priority, eventType, search } = getLogFilters();
  return data.filter(item => {
      const timeOk = (!from || item.timeISO >= new Date(from).toISOString()) && (!to || item.timeISO <= new Date(new Date(to).setHours(23,59,59,999)).toISOString());
      const prioOk = (priority === 'ALL' || item.priority === priority);
      const eventOk = (eventType === 'ALL' || item.event === eventType);
      const searchOk = (!search || item.description.toLowerCase().includes(search));
      return timeOk && prioOk && eventOk && searchOk;
  });
}

function renderAlarmLog() {
  const body = document.getElementById('alarm-log-body');
  if (!body) return;
  const filtered = applyLogFilters(STATE.alarmHistory);
  const totalPages = Math.max(1, Math.ceil(filtered.length / LOG_PAGE_SIZE));
  if (logCurrentPage > totalPages) logCurrentPage = totalPages;
  const start = (logCurrentPage - 1) * LOG_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + LOG_PAGE_SIZE);

  body.innerHTML = '';
  if (pageItems.length === 0) {
      body.innerHTML = '<tr><td colspan="4" class="py-4 text-center text-gray-500">Tidak ada data sesuai filter.</td></ntr>';
  } else {
      pageItems.forEach(item => {
          const priorityClass = item.priority === 'CRITICAL' ? 'bg-red-100 text-red-700 font-bold' : 'bg-orange-100 text-orange-700';
          const tr = document.createElement('tr');
          tr.innerHTML = `
              <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-900">${item.time}</td>
              <td class="px-4 py-2 whitespace-nowrap text-xs"><span class="px-2 inline-flex text-xs leading-5 rounded-full bg-gray-100 text-gray-700">${item.event}</span></td>
              <td class="px-4 py-2 whitespace-nowrap text-sm"><span class="px-2 inline-flex text-xs leading-5 rounded-full ${priorityClass}">${item.priority}</span></td>
              <td class="px-4 py-2 text-sm text-gray-600">${item.description}</td>
          `;
          body.appendChild(tr);
      });
  }

  const info = document.getElementById('log-page-info');
  if (info) info.textContent = `Halaman ${logCurrentPage} dari ${totalPages} (Total ${filtered.length})`;

  const prev = document.getElementById('log-prev');
  const next = document.getElementById('log-next');
  if (prev) prev.disabled = logCurrentPage <= 1;
  if (next) next.disabled = logCurrentPage >= totalPages;
}

function resetLogFilters() {
  document.getElementById('log-date-from').value = '';
  document.getElementById('log-date-to').value = '';
  document.getElementById('log-priority').value = 'ALL';
  document.getElementById('log-event').value = 'ALL';
  document.getElementById('log-search').value = '';
  logCurrentPage = 1;
  renderAlarmLog();
}

function exportAlarmLogCSV() {
  const filtered = applyLogFilters(STATE.alarmHistory);
  const rows = [['Waktu','Event','Prioritas','Deskripsi']].concat(
      filtered.map(i => [i.time, i.event, i.priority, i.description.replace(/\n/g, ' ')])
  );
  const csv = rows.map(r => r.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `alarm_log_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// --- FLOW LOGIC: filters, render, export ---
const FLOW_SAMPLING_INTERVAL_SEC = 5; // sampling setiap 5 detik
let lastFlowSampleTime = 0;

function recordFlowSample(force) {
  const nowMs = Date.now();
  if (!force && (nowMs - lastFlowSampleTime) < FLOW_SAMPLING_INTERVAL_SEC * 1000) return;
  lastFlowSampleTime = nowMs;
  const now = new Date();
  STATE.flowHistory.unshift({
      timeISO: now.toISOString(),
      time: now.toLocaleString(),
      debit: parseFloat(STATE.flowmeter.debit.toFixed(2)),
      totalizer: parseFloat(STATE.flowmeter.totalizer.toFixed(2))
  });
  if (STATE.flowHistory.length > 5000) {
      STATE.flowHistory.length = 5000;
  }
}

const FLOW_LOG_PAGE_SIZE = 10;
let flowCurrentPage = 1;

function getFlowFilters() {
  return {
      from: document.getElementById('flow-date-from')?.value || '',
      to: document.getElementById('flow-date-to')?.value || '',
      debitMin: document.getElementById('flow-debit-min')?.value || '',
      debitMax: document.getElementById('flow-debit-max')?.value || '',
      totalMin: document.getElementById('flow-total-min')?.value || '',
      totalMax: document.getElementById('flow-total-max')?.value || '',
  };
}

function applyFlowFilters(data) {
  const f = getFlowFilters();
  return data.filter(item => {
      const timeOk = (!f.from || item.timeISO >= new Date(f.from).toISOString()) && (!f.to || item.timeISO <= new Date(new Date(f.to).setHours(23,59,59,999)).toISOString());
      const debitOk = ((f.debitMin === '' || item.debit >= parseFloat(f.debitMin)) && (f.debitMax === '' || item.debit <= parseFloat(f.debitMax)));
      const totalOk = ((f.totalMin === '' || item.totalizer >= parseFloat(f.totalMin)) && (f.totalMax === '' || item.totalizer <= parseFloat(f.totalMax)));
      return timeOk && debitOk && totalOk;
  });
}

function renderFlowLog() {
  const body = document.getElementById('flow-log-body');
  if (!body) return;
  const filtered = applyFlowFilters(STATE.flowHistory);
  const totalPages = Math.max(1, Math.ceil(filtered.length / FLOW_LOG_PAGE_SIZE));
  if (flowCurrentPage > totalPages) flowCurrentPage = totalPages;
  const start = (flowCurrentPage - 1) * FLOW_LOG_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + FLOW_LOG_PAGE_SIZE);
  body.innerHTML = '';
  if (pageItems.length === 0) {
      body.innerHTML = '<tr><td colspan="3" class="py-4 text-center text-gray-500">Tidak ada data sesuai filter.</td></tr>';
  } else {
      pageItems.forEach(item => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
              <td class=\"px-4 py-2 whitespace-nowrap text-sm text-gray-900\">${item.time}</td>
              <td class=\"px-4 py-2 whitespace-nowrap text-sm text-gray-700\">${item.debit}</td>
              <td class=\"px-4 py-2 whitespace-nowrap text-sm text-gray-700\">${item.totalizer}</td>
          `;
          body.appendChild(tr);
      });
  }
  const info = document.getElementById('flow-page-info');
  if (info) info.textContent = `Halaman ${flowCurrentPage} dari ${totalPages} (Total ${filtered.length})`;
  const prev = document.getElementById('flow-prev');
  const next = document.getElementById('flow-next');
  if (prev) prev.disabled = flowCurrentPage <= 1;
  if (next) next.disabled = flowCurrentPage >= totalPages;
}

function resetFlowFilters() {
  const el = id => document.getElementById(id);
  if (el('flow-date-from')) el('flow-date-from').value = '';
  if (el('flow-date-to')) el('flow-date-to').value = '';
  if (el('flow-debit-min')) el('flow-debit-min').value = '';
  if (el('flow-debit-max')) el('flow-debit-max').value = '';
  if (el('flow-total-min')) el('flow-total-min').value = '';
  if (el('flow-total-max')) el('flow-total-max').value = '';
  flowCurrentPage = 1;
  renderFlowLog();
}

function exportFlowLogCSV() {
  const filtered = applyFlowFilters(STATE.flowHistory);
  const rows = [['Waktu','Debit (L/s)','Totalizer (m³)']].concat(
      filtered.map(i => [i.time, i.debit, i.totalizer])
  );
  const csv = rows.map(r => r.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `flow_log_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// --- PUMP HISTORY ---
const PUMP_SAMPLING_INTERVAL_SEC = 5;
let lastPumpSampleTime = 0;

function recordPumpSamples(force) {
  const nowMs = Date.now();
  if (!force && (nowMs - lastPumpSampleTime) < PUMP_SAMPLING_INTERVAL_SEC * 1000) return;
  lastPumpSampleTime = nowMs;
  const now = new Date();
  STATE.pumps.forEach(p => {
      const status = p.fault ? 'FAULT' : (p.isRunning ? 'RUNNING' : 'STOP');
      // Hitung totalizer jam berdasarkan status RUNNING
      const runningHours = p.isRunning ? (PUMP_SAMPLING_INTERVAL_SEC / 3600) : 0; // Konversi detik ke jam
      // Update totalizer jam kumulatif
      p.totalizerHours += runningHours;
      
      STATE.pumpHistory.unshift({
          timeISO: now.toISOString(),
          time: now.toLocaleString(),
          pumpId: p.id,
          status,
          speedPct: p.speedPct,
          currentA: parseFloat(p.currentA),
          totalizerHours: p.totalizerHours
      });
  });
  if (STATE.pumpHistory.length > 5000) {
      STATE.pumpHistory.length = 5000;
  }
  if (!document.getElementById('page-log_pompa').classList.contains('hidden')) {
      renderPumpLog();
  }
}

const PUMP_LOG_PAGE_SIZE = 10;
let pumpCurrentPage = 1;

function getPumpFilters() {
  return {
      from: document.getElementById('pump-date-from')?.value || '',
      to: document.getElementById('pump-date-to')?.value || '',
      pumpId: document.getElementById('pump-id')?.value || 'ALL',
      status: document.getElementById('pump-status')?.value || 'ALL',
      speedMin: document.getElementById('pump-speed-min')?.value || '',
      speedMax: document.getElementById('pump-speed-max')?.value || '',
      currentMin: document.getElementById('pump-current-min')?.value || '',
      currentMax: document.getElementById('pump-current-max')?.value || '',
      totalizerMin: document.getElementById('pump-totalizer-min')?.value || '',
      search: document.getElementById('pump-search')?.value.trim().toLowerCase() || '',
  };
}

function applyPumpFilters(data) {
  const f = getPumpFilters();
  return data.filter(item => {
      const timeOk = (!f.from || item.timeISO >= new Date(f.from).toISOString()) && (!f.to || item.timeISO <= new Date(new Date(f.to).setHours(23,59,59,999)).toISOString());
      const idOk = (f.pumpId === 'ALL' || String(item.pumpId) === f.pumpId);
      const statusOk = (f.status === 'ALL' || item.status === f.status);
      const speedOk = ((f.speedMin === '' || item.speedPct >= parseFloat(f.speedMin)) && (f.speedMax === '' || item.speedPct <= parseFloat(f.speedMax)));
      const currentOk = ((f.currentMin === '' || item.currentA >= parseFloat(f.currentMin)) && (f.currentMax === '' || item.currentA <= parseFloat(f.currentMax)));
      const totalizerOk = (f.totalizerMin === '' || item.totalizerHours >= parseFloat(f.totalizerMin));
      const searchOk = (!f.search || (`Pompa ${item.pumpId} ${item.status}`).toLowerCase().includes(f.search));
      return timeOk && idOk && statusOk && speedOk && currentOk && totalizerOk && searchOk;
  });
}

function renderPumpLog() {
  const body = document.getElementById('pump-log-body');
  if (!body) return;
  const filtered = applyPumpFilters(STATE.pumpHistory);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PUMP_LOG_PAGE_SIZE));
  if (pumpCurrentPage > totalPages) pumpCurrentPage = totalPages;
  const start = (pumpCurrentPage - 1) * PUMP_LOG_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PUMP_LOG_PAGE_SIZE);
  body.innerHTML = '';
  if (pageItems.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="py-4 text-center text-gray-500">Tidak ada data sesuai filter.</td></tr>';
  } else {
      pageItems.forEach(item => {
          const statusBadge = item.status === 'FAULT' ? 'bg-red-100 text-red-700' : (item.status === 'RUNNING' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700');
          const tr = document.createElement('tr');
          tr.innerHTML = `
              <td class=\"px-4 py-2 whitespace-nowrap text-sm text-gray-900\">${item.time}</td>
              <td class=\"px-4 py-2 whitespace-nowrap text-sm text-gray-700\">Pompa ${item.pumpId}</td>
              <td class=\"px-4 py-2 whitespace-nowrap text-xs\"><span class=\"px-2 inline-flex text-xs leading-5 rounded-full ${statusBadge}\">${item.status}</span></td>
              <td class=\"px-4 py-2 whitespace-nowrap text-sm text-gray-700\">${item.speedPct}</td>
              <td class=\"px-4 py-2 whitespace-nowrap text-sm text-gray-700\">${item.currentA.toFixed(1)}</td>
              <td class=\"px-4 py-2 whitespace-nowrap text-sm text-gray-700\">${item.totalizerHours.toFixed(2)}</td>
          `;
          body.appendChild(tr);
      });
  }
  const info = document.getElementById('pump-page-info');
  if (info) info.textContent = `Halaman ${pumpCurrentPage} dari ${totalPages} (Total ${filtered.length})`;
  const prev = document.getElementById('pump-prev');
  const next = document.getElementById('pump-next');
  if (prev) prev.disabled = pumpCurrentPage <= 1;
  if (next) next.disabled = pumpCurrentPage >= totalPages;
}

function resetPumpFilters() {
  const el = id => document.getElementById(id);
  if (el('pump-date-from')) el('pump-date-from').value = '';
  if (el('pump-date-to')) el('pump-date-to').value = '';
  if (el('pump-id')) el('pump-id').value = 'ALL';
  if (el('pump-status')) el('pump-status').value = 'ALL';
  if (el('pump-speed-min')) el('pump-speed-min').value = '';
  if (el('pump-speed-max')) el('pump-speed-max').value = '';
  if (el('pump-current-min')) el('pump-current-min').value = '';
  if (el('pump-current-max')) el('pump-current-max').value = '';
  if (el('pump-totalizer-min')) el('pump-totalizer-min').value = '';
  if (el('pump-search')) el('pump-search').value = '';
  pumpCurrentPage = 1;
  renderPumpLog();
}

function exportPumpLogCSV() {
  const filtered = applyPumpFilters(STATE.pumpHistory);
  const rows = [['Waktu','Pompa','Status','Speed (%)','Arus (A)','Totalizer Jam']].concat(
      filtered.map(i => [i.time, i.pumpId, i.status, i.speedPct, i.currentA.toFixed(1), i.totalizerHours.toFixed(2)])
  );
  const csv = rows.map(r => r.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pump_log_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}


// --- CHART MANAGEMENT ---

let charts = {
  pumpSpeed: null,
  pumpCurrent: null,
  flowDebit: null,
  flowTotalizer: null,
  alarmPriority: null,
  alarmTimeline: null
};

function createPumpCharts() {
  const filtered = applyPumpFilters(STATE.pumpHistory);
  const last24Hours = filtered.slice(0, 24); // Last 24 data points
  
  // Prepare data for pump speed chart
  const speedData = {
    labels: last24Hours.map(item => new Date(item.timeISO).toLocaleTimeString()),
    datasets: [
      {
        label: 'Pompa 1',
        data: last24Hours.filter(item => item.pumpId === 1).map(item => item.speedPct),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.1
      },
      {
        label: 'Pompa 2',
        data: last24Hours.filter(item => item.pumpId === 2).map(item => item.speedPct),
        borderColor: 'rgb(16, 185, 129)',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        tension: 0.1
      },
      {
        label: 'Pompa 3',
        data: last24Hours.filter(item => item.pumpId === 3).map(item => item.speedPct),
        borderColor: 'rgb(245, 158, 11)',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        tension: 0.1
      }
    ]
  };
  
  // Prepare data for pump current chart
  const currentData = {
    labels: last24Hours.map(item => new Date(item.timeISO).toLocaleTimeString()),
    datasets: [
      {
        label: 'Pompa 1',
        data: last24Hours.filter(item => item.pumpId === 1).map(item => item.currentA),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.1
      },
      {
        label: 'Pompa 2',
        data: last24Hours.filter(item => item.pumpId === 2).map(item => item.currentA),
        borderColor: 'rgb(16, 185, 129)',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        tension: 0.1
      },
      {
        label: 'Pompa 3',
        data: last24Hours.filter(item => item.pumpId === 3).map(item => item.currentA),
        borderColor: 'rgb(245, 158, 11)',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        tension: 0.1
      }
    ]
  };
  
  // Destroy existing charts
  if (charts.pumpSpeed) charts.pumpSpeed.destroy();
  if (charts.pumpCurrent) charts.pumpCurrent.destroy();
  
  // Create speed chart
  const speedCtx = document.getElementById('pumpSpeedChart');
  if (speedCtx) {
    charts.pumpSpeed = new Chart(speedCtx, {
      type: 'line',
      data: speedData,
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            title: {
              display: true,
              text: 'Speed (%)'
            }
          }
        },
        plugins: {
          legend: {
            position: 'top'
          }
        }
      }
    });
  }
  
  // Create current chart
  const currentCtx = document.getElementById('pumpCurrentChart');
  if (currentCtx) {
    charts.pumpCurrent = new Chart(currentCtx, {
      type: 'line',
      data: currentData,
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Arus (A)'
            }
          }
        },
        plugins: {
          legend: {
            position: 'top'
          }
        }
      }
    });
  }
}

function createFlowCharts() {
  const filtered = applyFlowFilters(STATE.flowHistory);
  const last24Hours = filtered.slice(0, 24); // Last 24 data points
  
  // Prepare data for debit chart
  const debitData = {
    labels: last24Hours.map(item => new Date(item.timeISO).toLocaleTimeString()),
    datasets: [{
      label: 'Debit Air',
      data: last24Hours.map(item => item.debit),
      borderColor: 'rgb(59, 130, 246)',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      tension: 0.1,
      fill: true
    }]
  };
  
  // Prepare data for totalizer chart
  const totalizerData = {
    labels: last24Hours.map(item => new Date(item.timeISO).toLocaleTimeString()),
    datasets: [{
      label: 'Totalizer',
      data: last24Hours.map(item => item.totalizer),
      borderColor: 'rgb(16, 185, 129)',
      backgroundColor: 'rgba(16, 185, 129, 0.1)',
      tension: 0.1,
      fill: true
    }]
  };
  
  // Destroy existing charts
  if (charts.flowDebit) charts.flowDebit.destroy();
  if (charts.flowTotalizer) charts.flowTotalizer.destroy();
  
  // Create debit chart
  const debitCtx = document.getElementById('flowDebitChart');
  if (debitCtx) {
    charts.flowDebit = new Chart(debitCtx, {
      type: 'line',
      data: debitData,
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Debit (L/s)'
            }
          }
        },
        plugins: {
          legend: {
            position: 'top'
          }
        }
      }
    });
  }
  
  // Create totalizer chart
  const totalizerCtx = document.getElementById('flowTotalizerChart');
  if (totalizerCtx) {
    charts.flowTotalizer = new Chart(totalizerCtx, {
      type: 'line',
      data: totalizerData,
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: false,
            title: {
              display: true,
              text: 'Totalizer (m³)'
            }
          }
        },
        plugins: {
          legend: {
            position: 'top'
          }
        }
      }
    });
  }
}

function createAlarmCharts() {
  const filtered = applyLogFilters(STATE.alarmHistory);
  
  // Count alarms by priority
  const priorityCount = filtered.reduce((acc, item) => {
    acc[item.priority] = (acc[item.priority] || 0) + 1;
    return acc;
  }, {});
  
  // Count events by type
  const eventCount = filtered.reduce((acc, item) => {
    acc[item.event] = (acc[item.event] || 0) + 1;
    return acc;
  }, {});
  
  // Prepare priority chart data
  const priorityData = {
    labels: Object.keys(priorityCount),
    datasets: [{
      data: Object.values(priorityCount),
      backgroundColor: [
        'rgba(239, 68, 68, 0.8)',   // CRITICAL - Red
        'rgba(245, 158, 11, 0.8)',  // WARNING - Orange
        'rgba(59, 130, 246, 0.8)'   // INFO - Blue
      ],
      borderColor: [
        'rgb(239, 68, 68)',
        'rgb(245, 158, 11)',
        'rgb(59, 130, 246)'
      ],
      borderWidth: 1
    }]
  };
  
  // Prepare timeline chart data
  const timelineData = {
    labels: Object.keys(eventCount),
    datasets: [{
      label: 'Jumlah Events',
      data: Object.values(eventCount),
      backgroundColor: 'rgba(16, 185, 129, 0.8)',
      borderColor: 'rgb(16, 185, 129)',
      borderWidth: 1
    }]
  };
  
  // Destroy existing charts
  if (charts.alarmPriority) charts.alarmPriority.destroy();
  if (charts.alarmTimeline) charts.alarmTimeline.destroy();
  
  // Create priority chart
  const priorityCtx = document.getElementById('alarmPriorityChart');
  if (priorityCtx) {
    charts.alarmPriority = new Chart(priorityCtx, {
      type: 'doughnut',
      data: priorityData,
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'bottom'
          }
        }
      }
    });
  }
  
  // Create timeline chart
  const timelineCtx = document.getElementById('alarmTimelineChart');
  if (timelineCtx) {
    charts.alarmTimeline = new Chart(timelineCtx, {
      type: 'bar',
      data: timelineData,
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Jumlah Events'
            }
          }
        },
        plugins: {
          legend: {
            position: 'top'
          }
        }
      }
    });
  }
}

// --- INITIALIZATION ---

function initializeApp() {
  // Render initial UI state (modes, etc.)
  setMode(STATE.currentMode);

  // Start Lucide Icon rendering
  lucide.createIcons();

  // Visualization slider controls
  const slidePID = document.getElementById('slide-pid');
  const slideImg = document.getElementById('slide-illustration');
  const indicator = document.getElementById('viz-indicator');
  const vizTitle = document.getElementById('viz-title');
  let vizIndex = 0; // 0: P&ID, 1: Illustration
  function updateViz() {
      if (!slidePID || !slideImg || !indicator || !vizTitle) return;
      if (vizIndex === 0) {
          slidePID.classList.remove('hidden');
          slideImg.classList.add('hidden');
          indicator.textContent = '1 / 2';
          vizTitle.textContent = 'Water Intake Visualization ';
      } else {
          slidePID.classList.add('hidden');
          slideImg.classList.remove('hidden');
          indicator.textContent = '2 / 2';
          vizTitle.textContent = '3D Water Intake Visualization / CCTV View (Jika ada)';
      }
  }
  const prevBtn = document.getElementById('viz-prev');
  const nextBtn = document.getElementById('viz-next');
  if (prevBtn) prevBtn.onclick = () => { vizIndex = (vizIndex + 1) % 2; updateViz(); };
  if (nextBtn) nextBtn.onclick = () => { vizIndex = (vizIndex + 1) % 2; updateViz(); };
  updateViz();

  // Hook up Alarm Log page controls
  const logApply = document.getElementById('log-apply');
  const logResetBtn = document.getElementById('log-reset');
  const logExportBtn = document.getElementById('log-export');
  const logPrev = document.getElementById('log-prev');
  const logNext = document.getElementById('log-next');
  if (logApply) logApply.onclick = () => { logCurrentPage = 1; renderAlarmLog(); createAlarmCharts(); };
  if (logResetBtn) logResetBtn.onclick = () => { resetLogFilters(); createAlarmCharts(); };
  if (logExportBtn) logExportBtn.onclick = () => exportAlarmLogCSV();
  if (logPrev) logPrev.onclick = () => { if (logCurrentPage > 1) { logCurrentPage--; renderAlarmLog(); } };
  if (logNext) logNext.onclick = () => { logCurrentPage++; renderAlarmLog(); };

  // Hook up Flow Log page controls
  const flowApply = document.getElementById('flow-apply');
  const flowResetBtn = document.getElementById('flow-reset');
  const flowExportBtn = document.getElementById('flow-export');
  const flowPrev = document.getElementById('flow-prev');
  const flowNext = document.getElementById('flow-next');
  if (flowApply) flowApply.onclick = () => { flowCurrentPage = 1; renderFlowLog(); createFlowCharts(); };
  if (flowResetBtn) flowResetBtn.onclick = () => { resetFlowFilters(); createFlowCharts(); };
  if (flowExportBtn) flowExportBtn.onclick = () => exportFlowLogCSV();
  if (flowPrev) flowPrev.onclick = () => { if (flowCurrentPage > 1) { flowCurrentPage--; renderFlowLog(); } };
  if (flowNext) flowNext.onclick = () => { flowCurrentPage++; renderFlowLog(); };

  // Hook up Pump Log page controls
  const pumpApply = document.getElementById('pump-apply');
  const pumpResetBtn = document.getElementById('pump-reset');
  const pumpExportBtn = document.getElementById('pump-export');
  const pumpPrev = document.getElementById('pump-prev');
  const pumpNext = document.getElementById('pump-next');
  if (pumpApply) pumpApply.onclick = () => { pumpCurrentPage = 1; renderPumpLog(); createPumpCharts(); };
  if (pumpResetBtn) pumpResetBtn.onclick = () => { resetPumpFilters(); createPumpCharts(); };
  if (pumpExportBtn) pumpExportBtn.onclick = () => exportPumpLogCSV();
  if (pumpPrev) pumpPrev.onclick = () => { if (pumpCurrentPage > 1) { pumpCurrentPage--; renderPumpLog(); } };
  if (pumpNext) pumpNext.onclick = () => { pumpCurrentPage++; renderPumpLog(); };

  // SPV-only: bind priority UI
  const savePriorityBtn = document.getElementById('save-priority');
  if (savePriorityBtn) {
      savePriorityBtn.onclick = () => {
          if (!hasPermission('SPV')) { showAlertModal('Akses Ditolak', 'Hanya SPV yang dapat menyimpan prioritas.'); return; }
          const p1 = parseInt(document.getElementById('prio-1').value);
          const p2 = parseInt(document.getElementById('prio-2').value);
          const p3 = parseInt(document.getElementById('prio-3').value);
          const set = new Set([p1,p2,p3]);
          if (set.size !== 3) { showAlertModal('Input Invalid', 'Prioritas tidak boleh duplikat.'); return; }
          const order = [p1,p2,p3];
          STATE.autoPriority = order;
          localStorage.setItem('scada_auto_priority', JSON.stringify(order));
          document.getElementById('priority-hint').textContent = `Disimpan: ${order.join(' → ')}`;
      };
  }

  // Load saved priority into UI
  const savedOrder = JSON.parse(localStorage.getItem('scada_auto_priority') || 'null') || CONFIG.AUTO_PRIORITY;
  STATE.autoPriority = savedOrder;
  const pr1 = document.getElementById('prio-1');
  const pr2 = document.getElementById('prio-2');
  const pr3 = document.getElementById('prio-3');
  if (pr1 && pr2 && pr3) { pr1.value = savedOrder[0]; pr2.value = savedOrder[1]; pr3.value = savedOrder[2]; }

  // Initialize slider limits
  updateSliderLimits();
  
  // Start the data simulation loop
  simulateData(); // Run once immediately
  window.dataInterval = setInterval(simulateData, 1000); // Run every second
}

// Check auth on load
window.onload = checkAuth;

