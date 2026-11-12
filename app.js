/**
 * ============================================================================
 * AAEE CONFERENCES SCHEDULING & COORDINATION SYSTEM
 * Frontend Controller (app.js) — Specification v2.1
 * ============================================================================
 */

// PASTE YOUR DEPLOYED GOOGLE APPS SCRIPT WEB APP URL BELOW:
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz4gNYvyxCXV5AQvkoQ1nNwY2AVyJgcEEL3OgJYXcL060biqEuu0WThkQZ_GC0EqAjXNA/exec';

const CONSTANTS = {
  MAX_SLOTS: 24,
  TARGET_PER_TEACHER: 22,
  DAYS: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  DAY_LABELS: {
    MON: 'Monday',
    TUE: 'Tuesday',
    WED: 'Wednesday',
    THU: 'Thursday',
    FRI: 'Friday'
  },
  DAY_ORDER: { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5 }
};

const state = {
  teachers: [],
  schedules: {},
  spanish: [],
  portuguese: [],
  meta: {
    maxSlotsPerTeacher: CONSTANTS.MAX_SLOTS,
    targetConferencesPerTeacher: CONSTANTS.TARGET_PER_TEACHER
  },
  activeScreen: 'screen-home',
  selectedTeacher: null,
  selectedOtherStaffTeacher: null
};

// ============================================================================
// INITIALIZATION & EVENT WIRING
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  bindNavigationEvents();
  bindTeacherFormEvents();
  bindTranslatorFormEvents();
  bindPrintButtons();
  loadAllData();
});

function bindNavigationEvents() {
  document.getElementById('back-to-home-btn').addEventListener('click', () => {
    clearStatusBanner();
    navigateTo('screen-home');
  });

  document.getElementById('refresh-data-btn').addEventListener('click', () => {
    loadAllData(true);
  });

  document.getElementById('nav-translators-btn').addEventListener('click', () => {
    clearStatusBanner();
    renderTranslatorsScreen();
    navigateTo('screen-translators');
  });

  document.getElementById('nav-other-staff-btn').addEventListener('click', () => {
    clearStatusBanner();
    renderOtherStaffScreen();
    navigateTo('screen-other-staff');
  });

  document.getElementById('nav-main-office-btn').addEventListener('click', () => {
    clearStatusBanner();
    renderMainOfficeScreen();
    navigateTo('screen-main-office');
  });
}

function navigateTo(screenId) {
  state.activeScreen = screenId;

  document.querySelectorAll('.screen').forEach((sec) => {
    sec.classList.toggle('active', sec.id === screenId);
  });

  const backBtn = document.getElementById('back-to-home-btn');
  if (screenId === 'screen-home') {
    backBtn.classList.add('hidden');
  } else {
    backBtn.classList.remove('hidden');
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================================================
// GOOGLE APPS SCRIPT API COMMUNICATION
// ============================================================================

function isConfigured() {
  return (
    APPS_SCRIPT_URL &&
    APPS_SCRIPT_URL !== 'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE' &&
    APPS_SCRIPT_URL.startsWith('https://')
  );
}

async function loadAllData(showSyncedBanner = false) {
  if (!isConfigured()) {
    showStatusBanner(
      'Configuration Needed: Open app.js and set APPS_SCRIPT_URL to your deployed Google Apps Script Web App URL.',
      'info'
    );
    return;
  }

  setLoading(true, 'Loading conference schedules...');
  try {
    const url = `${APPS_SCRIPT_URL}?action=getAllData&_t=${Date.now()}`;
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.error || 'Failed to retrieve schedule data.');
    }

    applyServerData(result.data);

    if (showSyncedBanner) {
      showStatusBanner('Schedule data synchronized with Google Sheets.', 'success');
    }
  } catch (err) {
    showStatusBanner(`Unable to load data: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

async function postToAppsScript(payload) {
  if (!isConfigured()) {
    throw new Error('APPS_SCRIPT_URL is not configured in app.js.');
  }

  // Using text/plain;charset=utf-8 avoids browser CORS preflight OPTIONS requests
  // while allowing Google Apps Script doPost(e) to parse e.postData.contents as JSON.
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Server returned HTTP ${response.status}`);
  }

  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.error || 'Save request failed.');
  }

  if (result.data) {
    applyServerData(result.data);
  }

  return result;
}

function applyServerData(data) {
  state.teachers = Array.isArray(data.teachers) ? data.teachers : [];
  state.schedules = data.schedules || {};
  state.spanish = Array.isArray(data.spanish) ? data.spanish : [];
  state.portuguese = Array.isArray(data.portuguese) ? data.portuguese : [];
  if (data.meta) {
    state.meta = { ...state.meta, ...data.meta };
  }

  renderHomeScreen();

  // Re-render current sub-screen if active
  if (state.activeScreen === 'screen-teacher' && state.selectedTeacher) {
    openTeacherScreen(state.selectedTeacher);
  } else if (state.activeScreen === 'screen-translators') {
    renderTranslatorsScreen();
  } else if (state.activeScreen === 'screen-other-staff') {
    renderOtherStaffScreen();
  } else if (state.activeScreen === 'screen-main-office') {
    renderMainOfficeScreen();
  }
}

// ============================================================================
// SCREEN 1: START SCREEN (HOME)
// ============================================================================

function renderHomeScreen() {
  const grid = document.getElementById('home-teacher-grid');
  grid.innerHTML = '';

  if (state.teachers.length === 0) {
    grid.innerHTML = '<p class="section-subtitle">No classroom teachers found. Run <strong>Initialize &amp; Format Workbook</strong> in Google Sheets.</p>';
    return;
  }

  state.teachers.forEach((teacherName) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'teacher-btn';
    btn.textContent = teacherName;
    btn.addEventListener('click', () => {
      clearStatusBanner();
      openTeacherScreen(teacherName);
      navigateTo('screen-teacher');
    });
    grid.appendChild(btn);
  });
}

// ============================================================================
// SCREEN 2: CLASSROOM TEACHER SCHEDULE ENTRY (24 ROWS)
// ============================================================================

function openTeacherScreen(teacherName) {
  state.selectedTeacher = teacherName;
  document.getElementById('teacher-screen-title').textContent = teacherName;

  const existingEntries = Array.isArray(state.schedules[teacherName])
    ? state.schedules[teacherName]
    : [];

  const container = document.getElementById('teacher-rows-container');
  container.innerHTML = '';

  for (let i = 0; i < CONSTANTS.MAX_SLOTS; i++) {
    const entry = existingEntries[i] || null;
    const rowEl = buildConferenceRowElement(entry);
    container.appendChild(rowEl);
  }
}

function buildConferenceRowElement(entry) {
  const isInitiallyPopulated = Boolean(entry);
  const dayVal = entry ? entry.day : 'WED';
  const hourVal = entry ? String(entry.hour) : '';
  const minVal = entry ? String(entry.minute).padStart(2, '0') : '';
  const ampmVal = entry ? entry.ampm : 'PM';
  const nameVal = entry ? entry.name : '';
  const modalityVal = entry ? entry.modality : 'in-person';
  const translatorVal = entry ? entry.translator : 'no translator';

  const row = document.createElement('div');
  row.className = 'conference-row';

  // Build Day options
  const dayOptionsHtml = CONSTANTS.DAYS.map((d) => {
    const selected = d === dayVal ? 'selected' : '';
    return `<option value="${d}" ${selected}>${d}</option>`;
  }).join('');

  row.innerHTML = `
    <!-- Cancel Conference Action Button (Visible on populated rows) -->
    <div class="action-cell">
      <button
        type="button"
        class="btn-cancel-conference ${isInitiallyPopulated ? '' : 'hidden'}"
        aria-label="Cancel conference and reset row"
      >cancel conference</button>
    </div>

    <!-- 1. Day of Week Dropdown (Defaults to WED) -->
    <div class="day-select-wrap">
      <select class="day-select" aria-label="Day of Week">
        ${dayOptionsHtml}
      </select>
      <svg class="day-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </div>

    <!-- 2, 3, 4. Hour : Minute Inputs -->
    <div class="time-group">
      <div class="time-inputs-inline">
        <input
          type="text"
          inputmode="numeric"
          maxlength="2"
          class="time-input hour-input"
          placeholder="HH"
          value="${escapeHtml(hourVal)}"
          aria-label="Hour (1 to 12)"
        />
        <span class="time-colon">:</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="2"
          class="time-input minute-input"
          placeholder="MM"
          value="${escapeHtml(minVal)}"
          aria-label="Minute (00 to 59)"
        />
      </div>
      <span class="field-error-hint time-error-hint hidden"></span>
    </div>

    <!-- 5. AM / PM Toggle Switch (Defaults to PM) -->
    <div class="ampm-switch" role="group" aria-label="AM or PM">
      <button type="button" class="ampm-btn ${ampmVal === 'AM' ? 'active' : ''}" data-ampm="AM">AM</button>
      <button type="button" class="ampm-btn ${ampmVal === 'PM' ? 'active' : ''}" data-ampm="PM">PM</button>
    </div>

    <!-- 6. Name Input Field (Strips '*' characters) -->
    <div class="name-cell">
      <input
        type="text"
        class="name-input"
        placeholder="Student / Parent Name"
        value="${escapeHtml(nameVal)}"
        aria-label="Conference Name"
      />
      <span class="field-error-hint name-error-hint hidden"></span>
    </div>

    <!-- 7. Modality Graphic Toggle (in-person on left, remote on right; defaults to in-person) -->
    <div class="modality-cell">
      <div class="modality-switch" role="group" aria-label="Meeting Modality">
        <button type="button" class="modality-option ${modalityVal === 'in-person' ? 'active' : ''}" data-modality="in-person">in-person</button>
        <button type="button" class="modality-option ${modalityVal === 'remote' ? 'active' : ''}" data-modality="remote">remote</button>
      </div>
    </div>

    <!-- 8. Mutually Exclusive Translator Checkboxes -->
    <div class="translator-cell">
      <div class="translator-checkbox-group">
        <label class="checkbox-label">
          <input
            type="checkbox"
            class="chk-spanish"
            ${translatorVal === 'spanish translator' ? 'checked' : ''}
          />
          <span>Spanish Translator</span>
        </label>
        <label class="checkbox-label">
          <input
            type="checkbox"
            class="chk-portuguese"
            ${translatorVal === 'portuguese translator' ? 'checked' : ''}
          />
          <span>Portuguese Translator</span>
        </label>
      </div>
    </div>
  `;

  attachRowEventListeners(row);
  return row;
}

function isRowPopulated(row) {
  const dayVal = row.querySelector('.day-select').value;
  const hourVal = row.querySelector('.hour-input').value.trim();
  const minVal = row.querySelector('.minute-input').value.trim();
  const nameVal = row.querySelector('.name-input').value.trim();
  const activeAmpm = row.querySelector('.ampm-btn.active')?.dataset.ampm || 'PM';
  const activeModality = row.querySelector('.modality-option.active')?.dataset.modality || 'in-person';
  const chkSpanish = row.querySelector('.chk-spanish').checked;
  const chkPortuguese = row.querySelector('.chk-portuguese').checked;

  return (
    hourVal !== '' ||
    minVal !== '' ||
    nameVal !== '' ||
    dayVal !== 'WED' ||
    activeAmpm !== 'PM' ||
    activeModality !== 'in-person' ||
    chkSpanish ||
    chkPortuguese
  );
}

function syncCancelButtonVisibility(row) {
  const cancelBtn = row.querySelector('.btn-cancel-conference');
  if (!cancelBtn) return;
  cancelBtn.classList.toggle('hidden', !isRowPopulated(row));
}

function resetConferenceRowToEmpty(row) {
  const daySelect = row.querySelector('.day-select');
  const hourInput = row.querySelector('.hour-input');
  const minuteInput = row.querySelector('.minute-input');
  const nameInput = row.querySelector('.name-input');
  const ampmBtns = row.querySelectorAll('.ampm-btn');
  const modalityBtns = row.querySelectorAll('.modality-option');
  const chkSpanish = row.querySelector('.chk-spanish');
  const chkPortuguese = row.querySelector('.chk-portuguese');

  daySelect.value = 'WED';
  hourInput.value = '';
  minuteInput.value = '';
  nameInput.value = '';

  ampmBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.ampm === 'PM');
  });

  modalityBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.modality === 'in-person');
  });

  chkSpanish.checked = false;
  chkPortuguese.checked = false;

  // Clear all validation error states
  hourInput.classList.remove('input-invalid');
  minuteInput.classList.remove('input-invalid');
  const timeErr = row.querySelector('.time-error-hint');
  timeErr.textContent = '';
  timeErr.classList.add('hidden');

  clearRowValidationState(row);
  syncCancelButtonVisibility(row);
}

function attachRowEventListeners(row) {
  const cancelBtn = row.querySelector('.btn-cancel-conference');
  const daySelect = row.querySelector('.day-select');
  const hourInput = row.querySelector('.hour-input');
  const minuteInput = row.querySelector('.minute-input');
  const nameInput = row.querySelector('.name-input');
  const ampmBtns = row.querySelectorAll('.ampm-btn');
  const modalityBtns = row.querySelectorAll('.modality-option');
  const chkSpanish = row.querySelector('.chk-spanish');
  const chkPortuguese = row.querySelector('.chk-portuguese');

  // Cancel conference button resets the row to empty immediately
  cancelBtn.addEventListener('click', () => {
    resetConferenceRowToEmpty(row);
  });

  daySelect.addEventListener('change', () => {
    syncCancelButtonVisibility(row);
  });

  // Hour input: digits only, validate 1–12 on blur/input
  hourInput.addEventListener('input', () => {
    hourInput.value = hourInput.value.replace(/\D/g, '');
    validateRowTime(row, false);
    syncCancelButtonVisibility(row);
  });
  hourInput.addEventListener('blur', () => {
    validateRowTime(row, true);
    syncCancelButtonVisibility(row);
  });

  // Minute input: digits only, auto-pad single digits on blur (e.g. '5' -> '05'), validate 00–59
  minuteInput.addEventListener('input', () => {
    minuteInput.value = minuteInput.value.replace(/\D/g, '');
    validateRowTime(row, false);
    syncCancelButtonVisibility(row);
  });
  minuteInput.addEventListener('blur', () => {
    const raw = minuteInput.value.trim();
    if (/^\d$/.test(raw)) {
      minuteInput.value = '0' + raw;
    }
    validateRowTime(row, true);
    syncCancelButtonVisibility(row);
  });

  // AM / PM toggle
  ampmBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      ampmBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      syncCancelButtonVisibility(row);
    });
  });

  // Name input: strip '*' characters in real time and on blur
  const stripAsterisks = () => {
    if (nameInput.value.includes('*')) {
      const cursor = nameInput.selectionStart;
      nameInput.value = nameInput.value.replace(/\*/g, '');
      if (typeof cursor === 'number') {
        nameInput.setSelectionRange(Math.max(0, cursor - 1), Math.max(0, cursor - 1));
      }
    }
  };
  nameInput.addEventListener('input', () => {
    stripAsterisks();
    clearRowValidationState(row);
    syncCancelButtonVisibility(row);
  });
  nameInput.addEventListener('blur', () => {
    nameInput.value = nameInput.value.replace(/\*/g, '').trim();
    syncCancelButtonVisibility(row);
  });

  // Graphic Modality switch
  modalityBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      modalityBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      syncCancelButtonVisibility(row);
    });
  });

  // Mutually exclusive translator checkboxes
  chkSpanish.addEventListener('change', () => {
    if (chkSpanish.checked) {
      chkPortuguese.checked = false;
    }
    syncCancelButtonVisibility(row);
  });
  chkPortuguese.addEventListener('change', () => {
    if (chkPortuguese.checked) {
      chkSpanish.checked = false;
    }
    syncCancelButtonVisibility(row);
  });
}

function validateRowTime(row, showMessageOnEmptyPair) {
  const hourInput = row.querySelector('.hour-input');
  const minuteInput = row.querySelector('.minute-input');
  const timeError = row.querySelector('.time-error-hint');

  const hStr = hourInput.value.trim();
  const mStr = minuteInput.value.trim();

  hourInput.classList.remove('input-invalid');
  minuteInput.classList.remove('input-invalid');
  timeError.classList.add('hidden');
  timeError.textContent = '';

  let errorMsg = '';

  if (hStr !== '') {
    const h = parseInt(hStr, 10);
    if (isNaN(h) || h < 1 || h > 12) {
      hourInput.classList.add('input-invalid');
      errorMsg = 'Enter a valid hour: 1–12';
    }
  }

  if (mStr !== '') {
    const m = parseInt(mStr, 10);
    if (isNaN(m) || m < 0 || m > 59) {
      minuteInput.classList.add('input-invalid');
      errorMsg = errorMsg
        ? 'Hour: 1–12 & Minutes: 00–59'
        : 'Enter valid minutes: 00–59';
    }
  }

  if (!errorMsg && showMessageOnEmptyPair && ((hStr !== '' && mStr === '') || (hStr === '' && mStr !== ''))) {
    if (hStr === '') hourInput.classList.add('input-invalid');
    if (mStr === '') minuteInput.classList.add('input-invalid');
    errorMsg = 'Enter both hour and minutes';
  }

  if (errorMsg) {
    timeError.textContent = errorMsg;
    timeError.classList.remove('hidden');
    return false;
  }

  return true;
}

function clearRowValidationState(row) {
  row.classList.remove('row-has-error');
  row.querySelector('.name-input').classList.remove('input-invalid');
  const nameErr = row.querySelector('.name-error-hint');
  nameErr.textContent = '';
  nameErr.classList.add('hidden');
}

function bindTeacherFormEvents() {
  const form = document.getElementById('teacher-schedule-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearStatusBanner();

    if (!state.selectedTeacher) return;

    const rowEls = Array.from(document.querySelectorAll('#teacher-rows-container .conference-row'));
    const validPayloadRows = [];
    let hasValidationErrors = false;
    let firstInvalidRow = null;

    rowEls.forEach((row) => {
      clearRowValidationState(row);

      const day = row.querySelector('.day-select').value;
      const hourInput = row.querySelector('.hour-input');
      const minuteInput = row.querySelector('.minute-input');
      const nameInput = row.querySelector('.name-input');
      const nameError = row.querySelector('.name-error-hint');

      // Normalize minute padding and strip '*' prior to validation
      if (/^\d$/.test(minuteInput.value.trim())) {
        minuteInput.value = '0' + minuteInput.value.trim();
      }
      nameInput.value = nameInput.value.replace(/\*/g, '').trim();

      const hStr = hourInput.value.trim();
      const mStr = minuteInput.value.trim();
      const nameStr = nameInput.value;

      const isCompletelyBlank = hStr === '' && mStr === '' && nameStr === '';
      if (isCompletelyBlank) {
        resetConferenceRowToEmpty(row);
        return; // Empty / canceled row — omitted so column compacts upward
      }

      const timeOk = validateRowTime(row, true);
      let rowOk = timeOk;

      if (hStr === '' || mStr === '') {
        rowOk = false;
        if (hStr === '') hourInput.classList.add('input-invalid');
        if (mStr === '') minuteInput.classList.add('input-invalid');
        const timeErr = row.querySelector('.time-error-hint');
        if (!timeErr.textContent) {
          timeErr.textContent = 'Enter hour (1–12) & minutes (00–59)';
          timeErr.classList.remove('hidden');
        }
      }

      if (nameStr === '') {
        rowOk = false;
        nameInput.classList.add('input-invalid');
        nameError.textContent = 'Enter a name or click "cancel conference" to remove this row';
        nameError.classList.remove('hidden');
      }

      if (!rowOk) {
        hasValidationErrors = true;
        row.classList.add('row-has-error');
        if (!firstInvalidRow) firstInvalidRow = row;
        return;
      }

      const activeAmpm = row.querySelector('.ampm-btn.active')?.dataset.ampm || 'PM';
      const activeModality = row.querySelector('.modality-option.active')?.dataset.modality || 'in-person';
      const isSpanish = row.querySelector('.chk-spanish').checked;
      const isPortuguese = row.querySelector('.chk-portuguese').checked;

      let translator = 'no translator';
      if (isSpanish) translator = 'spanish translator';
      else if (isPortuguese) translator = 'portuguese translator';

      validPayloadRows.push({
        day,
        hour: parseInt(hStr, 10),
        minute: mStr,
        ampm: activeAmpm,
        name: nameStr,
        modality: activeModality,
        translator
      });
    });

    if (hasValidationErrors) {
      showStatusBanner(
        'Please complete all highlighted rows (valid Hour 1–12, Minutes 00–59, and Name) or click "cancel conference" to remove a row.',
        'error'
      );
      if (firstInvalidRow) {
        firstInvalidRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    const submitBtn = document.getElementById('teacher-submit-btn');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';
    setLoading(true, `Saving ${state.selectedTeacher}'s conference schedule...`);

    try {
      const result = await postToAppsScript({
        action: 'saveTeacherSchedule',
        teacher: state.selectedTeacher,
        rows: validPayloadRows
      });
      showStatusBanner(result.message || 'Schedule saved successfully.', 'success');
    } catch (err) {
      showStatusBanner(`Error saving schedule: ${err.message}`, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
      setLoading(false);
    }
  });
}

// ============================================================================
// SCREEN 3: TRANSLATORS SCREEN
// ============================================================================

function renderTranslatorsScreen() {
  const spanishSorted = sortConferencesChronologically(state.spanish);
  const portugueseSorted = sortConferencesChronologically(state.portuguese);

  document.getElementById('spanish-count-badge').textContent = String(spanishSorted.length);
  document.getElementById('portuguese-count-badge').textContent = String(portugueseSorted.length);

  renderTranslatorPaneList('spanish-requests-list', spanishSorted, 'spanish');
  renderTranslatorPaneList('portuguese-requests-list', portugueseSorted, 'portuguese');
}

function renderTranslatorPaneList(containerId, items, languageKey) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state-box">No ${languageKey} translation requests scheduled.</div>`;
    return;
  }

  items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'translator-entry-card';

    const modalityLabel = item.modality === 'remote' ? 'Remote' : 'In-Person';
    const modalityClass = item.modality === 'remote' ? 'remote' : 'in-person';

    card.innerHTML = `
      <div class="translator-card-top">
        <h4 class="translator-conf-name">${escapeHtml(item.name)}</h4>
        <span class="modality-badge ${modalityClass}">${modalityLabel}</span>
      </div>
      <div class="translator-meta-row">
        <span class="translator-meta-item"><strong>When:</strong> ${escapeHtml(item.day)} &mdash; ${escapeHtml(item.time)}</span>
        <span class="translator-meta-item"><strong>Teacher:</strong> ${escapeHtml(item.teacher)}</span>
      </div>
      <div class="translator-note-row">
        <input
          type="text"
          class="translator-note-input"
          data-lang="${languageKey}"
          data-composite-key="${escapeHtml(item.compositeKey)}"
          placeholder="Assigned translator / notes..."
          value="${escapeHtml(item.notes || '')}"
          aria-label="Translator assignment for ${escapeHtml(item.name)}"
        />
      </div>
    `;

    container.appendChild(card);
  });
}

function bindTranslatorFormEvents() {
  const form = document.getElementById('translators-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearStatusBanner();

    const spanishUpdates = [];
    const portugueseUpdates = [];

    document.querySelectorAll('.translator-note-input').forEach((input) => {
      const lang = input.dataset.lang;
      const compositeKey = input.dataset.compositeKey;
      const notes = input.value.trim();

      if (lang === 'spanish') {
        spanishUpdates.push({ compositeKey, notes });
      } else if (lang === 'portuguese') {
        portugueseUpdates.push({ compositeKey, notes });
      }
    });

    const submitBtn = document.getElementById('translators-submit-btn');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';
    setLoading(true, 'Saving translator assignments...');

    try {
      const result = await postToAppsScript({
        action: 'saveTranslatorAssignments',
        updates: {
          spanish: spanishUpdates,
          portuguese: portugueseUpdates
        }
      });
      showStatusBanner(result.message || 'Translator assignments saved.', 'success');
    } catch (err) {
      showStatusBanner(`Error saving translator assignments: ${err.message}`, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
      setLoading(false);
    }
  });
}

// ============================================================================
// SCREEN 4: OTHER STAFF SCREEN (READ-ONLY)
// ============================================================================

function renderOtherStaffScreen() {
  const grid = document.getElementById('other-staff-teacher-grid');
  grid.innerHTML = '';

  state.teachers.forEach((teacherName) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'teacher-btn';
    if (state.selectedOtherStaffTeacher === teacherName) {
      btn.classList.add('active-teacher');
    }
    btn.textContent = teacherName;
    btn.addEventListener('click', () => {
      state.selectedOtherStaffTeacher = teacherName;
      renderOtherStaffScreen();
      renderOtherStaffTeacherDetail(teacherName);
    });
    grid.appendChild(btn);
  });

  if (state.selectedOtherStaffTeacher && state.teachers.includes(state.selectedOtherStaffTeacher)) {
    renderOtherStaffTeacherDetail(state.selectedOtherStaffTeacher);
  } else {
    document.getElementById('other-staff-schedule-panel').classList.add('hidden');
  }
}

function renderOtherStaffTeacherDetail(teacherName) {
  const panel = document.getElementById('other-staff-schedule-panel');
  const heading = document.getElementById('other-staff-selected-teacher');
  const countBadge = document.getElementById('other-staff-conference-count');
  const content = document.getElementById('other-staff-schedule-content');

  const rawList = state.schedules[teacherName] || [];
  const sorted = sortConferencesChronologically(rawList);

  heading.textContent = `${teacherName} — Scheduled Conferences`;
  countBadge.textContent = `${sorted.length} ${sorted.length === 1 ? 'Conference' : 'Conferences'}`;
  panel.classList.remove('hidden');

  if (sorted.length === 0) {
    content.innerHTML = '<div class="empty-state-box">No conferences scheduled yet for this teacher.</div>';
    return;
  }

  const rowsHtml = sorted.map((c) => {
    const modalityLabel = c.modality === 'remote' ? 'Remote' : 'In-Person';
    const modalityClass = c.modality === 'remote' ? 'remote' : 'in-person';
    const translatorDisplay = formatTranslatorLabel(c.translator);

    return `
      <tr>
        <td><strong>${escapeHtml(c.day)}</strong></td>
        <td>${escapeHtml(c.time)}</td>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td><span class="modality-badge ${modalityClass}">${modalityLabel}</span></td>
        <td>${escapeHtml(translatorDisplay)}</td>
      </tr>
    `;
  }).join('');

  content.innerHTML = `
    <table class="readonly-table">
      <thead>
        <tr>
          <th>Day</th>
          <th>Time</th>
          <th>Conference Name</th>
          <th>Modality</th>
          <th>Translator</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;
}

// ============================================================================
// SCREEN 5: MAIN OFFICE & SECURITY DASHBOARD & 8.5" x 11" PRINT SYSTEM
// ============================================================================

function getAllFlattenedConferences() {
  const all = [];
  state.teachers.forEach((teacher) => {
    const list = state.schedules[teacher] || [];
    list.forEach((item) => {
      all.push({ ...item, teacher });
    });
  });
  return all;
}

function renderMainOfficeScreen() {
  const all = getAllFlattenedConferences();
  const totalScheduled = all.length;
  const teacherCount = state.teachers.length;
  const targetPerTeacher = state.meta.targetConferencesPerTeacher || CONSTANTS.TARGET_PER_TEACHER;
  const denominator = teacherCount * targetPerTeacher;
  const completionPct = denominator > 0 ? ((totalScheduled / denominator) * 100).toFixed(1) : '0.0';

  const inPersonAll = all.filter((c) => c.modality === 'in-person');
  const remoteCount = totalScheduled - inPersonAll.length;

  const tueInPerson = inPersonAll.filter((c) => c.day === 'TUE').length;
  const wedInPerson = inPersonAll.filter((c) => c.day === 'WED').length;
  const thuInPerson = inPersonAll.filter((c) => c.day === 'THU').length;
  const friInPerson = inPersonAll.filter((c) => c.day === 'FRI').length;

  document.getElementById('kpi-total-scheduled').textContent = String(totalScheduled);
  document.getElementById('kpi-completion-pct').textContent = `${completionPct}%`;

  document.getElementById('kpi-total-inperson').textContent = String(inPersonAll.length);
  document.getElementById('kpi-remote-subtext').textContent =
    `${remoteCount} remote ${remoteCount === 1 ? 'conference' : 'conferences'} scheduled`;

  document.getElementById('kpi-tue-inperson').textContent = String(tueInPerson);
  document.getElementById('kpi-wed-inperson').textContent = String(wedInPerson);
  document.getElementById('kpi-thu-inperson').textContent = String(thuInPerson);
  document.getElementById('kpi-fri-inperson').textContent = String(friInPerson);
}

function bindPrintButtons() {
  document.querySelectorAll('.btn-print-day').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dayCode = btn.dataset.printDay;
      printDayInPersonSchedule(dayCode);
    });
  });
}

function printDayInPersonSchedule(dayCode) {
  const dayUpper = String(dayCode || '').toUpperCase();
  const dayFullName = CONSTANTS.DAY_LABELS[dayUpper] || dayUpper;

  // Filter strictly to selected day AND modality === 'in-person'
  const matching = getAllFlattenedConferences().filter(
    (c) => c.day === dayUpper && c.modality === 'in-person'
  );

  // Sort strictly chronologically (Time -> Classroom Teacher A-Z -> Conference Name A-Z)
  const sorted = sortConferencesChronologically(matching);

  const nowStr = new Date().toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const rowsHtml = sorted.map((c) => `
    <tr>
      <td style="width: 18%; font-weight: 700;">${escapeHtml(c.time)}</td>
      <td style="width: 44%;">${escapeHtml(c.name)}</td>
      <td style="width: 38%;">${escapeHtml(c.teacher)}</td>
    </tr>
  `).join('');

  const bodyContent = sorted.length > 0
    ? `
      <table class="print-table">
        <thead>
          <tr>
            <th style="width: 18%;">Time</th>
            <th style="width: 44%;">Conference Name</th>
            <th style="width: 38%;">Classroom Teacher</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `
    : `<div class="print-empty-msg">No in-person conferences scheduled for ${escapeHtml(dayFullName)}.</div>`;

  const printArea = document.getElementById('print-area');
  printArea.innerHTML = `
    <div class="print-banner">
      <h1 class="print-banner-title">AAEE Conferences &mdash; ${escapeHtml(dayFullName.toUpperCase())} IN-PERSON SCHEDULE</h1>
    </div>
    <div class="print-meta-bar">
      <span><strong>Total In-Person Visitors:</strong> ${sorted.length}</span>
      <span><strong>Printed:</strong> ${escapeHtml(nowStr)}</span>
    </div>
    ${bodyContent}
  `;

  window.print();
}

// ============================================================================
// CHRONOLOGICAL SORTING & SHARED HELPERS
// ============================================================================

function parseTimeStringToMinutes(timeStr) {
  const match = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return 9999;

  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  if (period === 'AM') {
    return (h === 12 ? 0 : h * 60) + m;
  }
  return (h === 12 ? 720 : (h + 12) * 60) + m;
}

function sortConferencesChronologically(list) {
  return [...list].sort((a, b) => {
    const dayA = CONSTANTS.DAY_ORDER[a.day] || 99;
    const dayB = CONSTANTS.DAY_ORDER[b.day] || 99;
    if (dayA !== dayB) return dayA - dayB;

    const minA = parseTimeStringToMinutes(a.time);
    const minB = parseTimeStringToMinutes(b.time);
    if (minA !== minB) return minA - minB;

    const teacherCmp = String(a.teacher || '').localeCompare(String(b.teacher || ''), undefined, {
      sensitivity: 'base'
    });
    if (teacherCmp !== 0) return teacherCmp;

    return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
      sensitivity: 'base'
    });
  });
}

function formatTranslatorLabel(val) {
  if (val === 'spanish translator') return 'Spanish Translator';
  if (val === 'portuguese translator') return 'Portuguese Translator';
  return 'None';
}

function setLoading(isLoading, message = 'Loading...') {
  const overlay = document.getElementById('loading-overlay');
  const msgEl = document.getElementById('loading-message');
  msgEl.textContent = message;
  overlay.classList.toggle('hidden', !isLoading);
}

function showStatusBanner(message, type = 'info') {
  const banner = document.getElementById('status-banner');
  banner.textContent = message;
  banner.className = `status-banner ${type}`;
  banner.classList.remove('hidden');
}

function clearStatusBanner() {
  const banner = document.getElementById('status-banner');
  banner.textContent = '';
  banner.className = 'status-banner hidden';
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
