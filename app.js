/**
 * ============================================================================
 * AAEE CONFERENCES SCHEDULING & COORDINATION SYSTEM
 * Frontend Controller (app.js) — Specification v2.5
 * ============================================================================
 */

// PASTE YOUR DEPLOYED GOOGLE APPS SCRIPT WEB APP URL BELOW:
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz4gNYvyxCXV5AQvkoQ1nNwY2AVyJgcEEL3OgJYXcL060biqEuu0WThkQZ_GC0EqAjXNA/exec';

const CONSTANTS = {
  MAX_SLOTS: 24,
  TARGET_PER_TEACHER: 22,
  APPOINTMENT_DURATION_MINUTES: 20,
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
  translators: [], // Array of { rowIndex, name, language: 'spanish'|'portuguese', appointments: [] }
  meta: {
    maxSlotsPerTeacher: CONSTANTS.MAX_SLOTS,
    targetConferencesPerTeacher: CONSTANTS.TARGET_PER_TEACHER
  },
  activeScreen: 'screen-home',
  selectedTeacher: null,
  teacherFormInitialSnapshot: '',
  selectedTranslatorKey: null, // `${rowIndex}::${name}`
  selectedOtherStaffTeacher: null
};

// ============================================================================
// INITIALIZATION & EVENT WIRING
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  bindNavigationEvents();
  bindTeacherFormEvents();
  bindTeacherOrganizedViewEvents();
  bindTranslatorWorkflowEvents();
  bindConfirmModalEvents();
  bindPrintButtons();
  loadAllData();
});

function bindNavigationEvents() {
  document.getElementById('back-to-home-btn').addEventListener('click', async () => {
    clearStatusBanner();
    if (hasUnsavedTeacherChanges()) {
      const canLeave = await promptTeacherUnsavedChanges();
      if (!canLeave) return;
    }
    navigateTo('screen-home');
  });

  document.getElementById('refresh-data-btn').addEventListener('click', async () => {
    if (hasUnsavedTeacherChanges()) {
      const canLeave = await promptTeacherUnsavedChanges();
      if (!canLeave) return;
    }
    loadAllData(true);
  });

  window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedTeacherChanges()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  window.addEventListener('popstate', async () => {
    if (hasUnsavedTeacherChanges()) {
      history.pushState({ screen: state.activeScreen }, '');
      const canLeave = await promptTeacherUnsavedChanges();
      if (canLeave) {
        navigateTo('screen-home', { skipHistory: true });
      }
      return;
    }
    if (state.activeScreen !== 'screen-home') {
      navigateTo('screen-home', { skipHistory: true });
    }
  });

  document.getElementById('nav-translators-btn').addEventListener('click', () => {
    clearStatusBanner();
    renderTranslatorsHomeScreen();
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

function navigateTo(screenId, options = {}) {
  const prevScreen = state.activeScreen;
  state.activeScreen = screenId;

  if (!options.skipHistory && screenId !== 'screen-home' && prevScreen === 'screen-home') {
    history.pushState({ screen: screenId }, '');
  }

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
// CONFIRMATION MODAL DIALOG
// ============================================================================

let activeModalResolver = null;

function bindConfirmModalEvents() {
  const modal = document.getElementById('confirm-modal');
  const cancelBtn = document.getElementById('confirm-modal-cancel-btn');
  const altBtn = document.getElementById('confirm-modal-alt-btn');
  const acceptBtn = document.getElementById('confirm-modal-accept-btn');

  const closeWith = (result) => {
    modal.classList.add('hidden');
    if (activeModalResolver) {
      const resolve = activeModalResolver;
      activeModalResolver = null;
      resolve(result);
    }
  };

  cancelBtn.addEventListener('click', () => closeWith(false));
  altBtn.addEventListener('click', () => closeWith('alt'));
  acceptBtn.addEventListener('click', () => closeWith(true));

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeWith(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeWith(false);
    }
  });
}

function showConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  altLabel = '',
  variant = 'primary'
}) {
  const modal = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('confirm-modal-title');
  const msgEl = document.getElementById('confirm-modal-message');
  const cancelBtn = document.getElementById('confirm-modal-cancel-btn');
  const altBtn = document.getElementById('confirm-modal-alt-btn');
  const acceptBtn = document.getElementById('confirm-modal-accept-btn');

  titleEl.textContent = title;
  msgEl.textContent = message;
  cancelBtn.textContent = cancelLabel;
  acceptBtn.textContent = confirmLabel;
  acceptBtn.className = variant === 'danger' ? 'btn-modal-danger' : 'btn-modal-confirm';

  if (altLabel) {
    altBtn.textContent = altLabel;
    altBtn.classList.remove('hidden');
  } else {
    altBtn.classList.add('hidden');
  }

  modal.classList.remove('hidden');
  acceptBtn.focus();

  return new Promise((resolve) => {
    activeModalResolver = resolve;
  });
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

function normalizeTranslatorsFromServer(rawTranslators) {
  if (!Array.isArray(rawTranslators)) return [];

  return rawTranslators
    .map((entry, idx) => {
      if (Array.isArray(entry)) {
        const name = String(entry[0] || '').trim();
        const language = String(entry[1] || '').trim().toLowerCase();
        if (!name || (language !== 'spanish' && language !== 'portuguese')) return null;

        const appointments = [];
        for (let c = 2; c < entry.length; c++) {
          const cellVal = String(entry[c] || '').trim();
          if (cellVal) {
            appointments.push(parseAppointmentCsvString(cellVal, c + 1));
          }
        }
        return {
          rowIndex: idx + 1,
          name,
          language,
          appointments
        };
      }

      const name = String(entry.name || '').trim();
      const language = String(entry.language || '').trim().toLowerCase();
      if (!name || (language !== 'spanish' && language !== 'portuguese')) return null;

      const rawAppts = Array.isArray(entry.appointments) ? entry.appointments : [];
      const appointments = rawAppts
        .map((appt, aIdx) => {
          if (typeof appt === 'string') {
            return appt.trim() ? parseAppointmentCsvString(appt.trim(), aIdx + 3) : null;
          }
          if (appt && typeof appt === 'object') {
            if (appt.raw) {
              return parseAppointmentCsvString(String(appt.raw), appt.colIndex || aIdx + 3);
            }
            return {
              raw: formatAppointmentCsvString(appt),
              colIndex: appt.colIndex || aIdx + 3,
              name: String(appt.name || '').trim(),
              teacher: String(appt.teacher || '').trim(),
              modality: normalizeModality(appt.modality),
              day: String(appt.day || '').trim().toUpperCase(),
              time: String(appt.time || '').trim()
            };
          }
          return null;
        })
        .filter(Boolean);

      return {
        rowIndex: entry.rowIndex || idx + 1,
        name,
        language,
        appointments
      };
    })
    .filter(Boolean);
}

function applyServerData(data) {
  state.teachers = Array.isArray(data.teachers) ? data.teachers : [];
  state.schedules = data.schedules || {};
  state.spanish = Array.isArray(data.spanish) ? data.spanish : [];
  state.portuguese = Array.isArray(data.portuguese) ? data.portuguese : [];
  state.translators = normalizeTranslatorsFromServer(data.translators);

  if (data.meta) {
    state.meta = { ...state.meta, ...data.meta };
  }

  renderHomeScreen();

  if (state.activeScreen === 'screen-teacher' && state.selectedTeacher) {
    openTeacherScreen(state.selectedTeacher);
  } else if (state.activeScreen === 'screen-teacher-schedule-view' && state.selectedTeacher) {
    renderTeacherOrganizedScheduleScreen();
  } else if (state.activeScreen === 'screen-translators') {
    renderTranslatorsHomeScreen();
  } else if (state.activeScreen === 'screen-translator-detail') {
    renderTranslatorDetailScreen();
  } else if (state.activeScreen === 'screen-translator-schedule-view') {
    renderTranslatorOrganizedScheduleScreen();
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
// SCREEN 2A & 2B: CLASSROOM TEACHER SCHEDULE ENTRY & ORGANIZED SCHEDULE VIEW
// ============================================================================

function serializeTeacherFormState() {
  const rows = Array.from(document.querySelectorAll('#teacher-rows-container .conference-row'));
  return JSON.stringify(
    rows.map((row) => ({
      day: row.querySelector('.day-select').value,
      hour: row.querySelector('.hour-input').value.trim(),
      minute: row.querySelector('.minute-input').value.trim(),
      ampm: row.querySelector('.ampm-btn.active')?.dataset.ampm || 'PM',
      name: row.querySelector('.name-input').value.trim(),
      modality: row.querySelector('.modality-option.active')?.dataset.modality || 'in-person',
      spanish: row.querySelector('.chk-spanish').checked,
      portuguese: row.querySelector('.chk-portuguese').checked,
      languageLine: row.querySelector('.chk-language-line').checked
    }))
  );
}

function hasUnsavedTeacherChanges() {
  if (
    (state.activeScreen !== 'screen-teacher' &&
      state.activeScreen !== 'screen-teacher-schedule-view') ||
    !state.selectedTeacher
  ) {
    return false;
  }
  return serializeTeacherFormState() !== state.teacherFormInitialSnapshot;
}

async function promptTeacherUnsavedChanges() {
  const teacherLabel = state.selectedTeacher || 'this teacher';
  const choice = await showConfirmDialog({
    title: 'Submit Schedule Changes?',
    message: `You have unsaved changes to ${teacherLabel}'s conference schedule. Would you like to submit your changes before going back?`,
    confirmLabel: 'Submit Changes',
    altLabel: 'Leave Without Submitting',
    cancelLabel: 'Cancel',
    variant: 'primary'
  });

  if (choice === true) {
    return await submitTeacherSchedule();
  }
  if (choice === 'alt') {
    state.teacherFormInitialSnapshot = serializeTeacherFormState();
    return true;
  }
  return false;
}

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

  refreshAllTeacherRowsTranslatorAvailability();
  state.teacherFormInitialSnapshot = serializeTeacherFormState();
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
        placeholder="Name"
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

    <!-- 8. Mutually Exclusive Translator Checkboxes / Claimed Badge / Availability Text / Language Line -->
    <div class="translator-cell">
      <div class="translator-claimed-banner hidden" aria-live="polite"></div>
      <div class="translator-checkbox-group">
        <label class="checkbox-label spanish-option-label">
          <input
            type="checkbox"
            class="chk-spanish"
            ${translatorVal === 'spanish translator' ? 'checked' : ''}
          />
          <span>Spanish Translator</span>
        </label>
        <span class="translator-unavailable-text spanish-unavailable-msg hidden">no 'in-person' spanish translator available at this time slot</span>

        <label class="checkbox-label portuguese-option-label">
          <input
            type="checkbox"
            class="chk-portuguese"
            ${translatorVal === 'portuguese translator' ? 'checked' : ''}
          />
          <span>Portuguese Translator</span>
        </label>
        <span class="translator-unavailable-text portuguese-unavailable-msg hidden">no 'in-person' portuguese translator available at this time slot</span>

        <label class="checkbox-label language-line-option-label ${translatorVal === 'language line' ? '' : 'hidden'}">
          <input
            type="checkbox"
            class="chk-language-line"
            ${translatorVal === 'language line' ? 'checked' : ''}
          />
          <span>Language Line</span>
        </label>
      </div>
    </div>
  `;

  attachRowEventListeners(row);
  return row;
}

function getRowTimeSlotInfo(row) {
  const day = row.querySelector('.day-select').value;
  const hStr = row.querySelector('.hour-input').value.trim();
  const mStr = row.querySelector('.minute-input').value.trim();
  const ampm = row.querySelector('.ampm-btn.active')?.dataset.ampm || 'PM';

  if (hStr === '' || mStr === '') {
    return { isValid: false, day, formattedTime: '', startMinutes: null };
  }

  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || h < 1 || h > 12 || isNaN(m) || m < 0 || m > 59) {
    return { isValid: false, day, formattedTime: '', startMinutes: null };
  }

  const formattedTime = `${h}:${String(m).padStart(2, '0')} ${ampm}`;
  return {
    isValid: true,
    day,
    formattedTime,
    startMinutes: parseTimeStringToMinutes(formattedTime)
  };
}

function findClaimingTranslatorForRow(row) {
  if (!state.selectedTeacher) return null;

  const slot = getRowTimeSlotInfo(row);
  if (!slot.isValid) return null;

  const confName = row.querySelector('.name-input').value.trim();
  if (!confName) return null;

  return findClaimingTranslatorForConference({
    day: slot.day,
    time: slot.formattedTime,
    teacher: state.selectedTeacher,
    name: confName
  });
}

function findClaimingTranslatorForConference(conf) {
  const targetKey = buildConferenceMatchKey(conf);
  for (let i = 0; i < state.translators.length; i++) {
    const translator = state.translators[i];
    for (let j = 0; j < translator.appointments.length; j++) {
      if (buildConferenceMatchKey(translator.appointments[j]) === targetKey) {
        return translator;
      }
    }
  }
  return null;
}

function doTimeslotsOverlap(dayA, startMinA, dayB, startMinB) {
  if (!dayA || !dayB || dayA !== dayB) return false;
  if (startMinA === null || startMinB === null || startMinA >= 9000 || startMinB >= 9000) {
    return false;
  }
  return Math.abs(startMinA - startMinB) < CONSTANTS.APPOINTMENT_DURATION_MINUTES;
}

function isTranslatorAvailableForRow(targetRow, language) {
  const translatorsForLang = state.translators.filter((t) => t.language === language);
  const totalTranslators = translatorsForLang.length;

  if (totalTranslators === 0) {
    return false;
  }

  const slot = getRowTimeSlotInfo(targetRow);
  if (!slot.isValid) {
    return true;
  }

  let freeTranslatorsCount = 0;
  translatorsForLang.forEach((translator) => {
    const hasOverlappingClaim = translator.appointments.some((appt) => {
      const apptStart = parseTimeStringToMinutes(appt.time);
      return doTimeslotsOverlap(slot.day, slot.startMinutes, appt.day, apptStart);
    });
    if (!hasOverlappingClaim) {
      freeTranslatorsCount++;
    }
  });

  if (freeTranslatorsCount <= 0) {
    return false;
  }

  const claimedKeys = getClaimedConferenceKeySet();
  const targetLangLabel = language === 'spanish' ? 'spanish translator' : 'portuguese translator';
  let overlappingUnclaimedDemand = 0;

  state.teachers.forEach((teacherName) => {
    if (teacherName === state.selectedTeacher) return;
    const list = state.schedules[teacherName] || [];
    list.forEach((conf) => {
      if (conf.translator !== targetLangLabel) return;
      const confKey = buildConferenceMatchKey({ ...conf, teacher: teacherName });
      if (claimedKeys.has(confKey)) return;

      const confStart = parseTimeStringToMinutes(conf.time);
      if (doTimeslotsOverlap(slot.day, slot.startMinutes, conf.day, confStart)) {
        overlappingUnclaimedDemand++;
      }
    });
  });

  const allRows = Array.from(document.querySelectorAll('#teacher-rows-container .conference-row'));
  allRows.forEach((otherRow) => {
    if (otherRow === targetRow) return;
    const chk = otherRow.querySelector(language === 'spanish' ? '.chk-spanish' : '.chk-portuguese');
    if (!chk || !chk.checked) return;

    const otherSlot = getRowTimeSlotInfo(otherRow);
    if (!otherSlot.isValid) return;

    const otherName = otherRow.querySelector('.name-input').value.trim();
    const otherKey = buildConferenceMatchKey({
      day: otherSlot.day,
      time: otherSlot.formattedTime,
      teacher: state.selectedTeacher,
      name: otherName
    });
    if (claimedKeys.has(otherKey)) return;

    if (doTimeslotsOverlap(slot.day, slot.startMinutes, otherSlot.day, otherSlot.startMinutes)) {
      overlappingUnclaimedDemand++;
    }
  });

  return freeTranslatorsCount - overlappingUnclaimedDemand > 0;
}

function updateRowTranslatorAvailability(row) {
  const claimedBanner = row.querySelector('.translator-claimed-banner');
  const checkboxGroup = row.querySelector('.translator-checkbox-group');

  const spanishLabel = row.querySelector('.spanish-option-label');
  const chkSpanish = row.querySelector('.chk-spanish');
  const spanishMsg = row.querySelector('.spanish-unavailable-msg');

  const portugueseLabel = row.querySelector('.portuguese-option-label');
  const chkPortuguese = row.querySelector('.chk-portuguese');
  const portugueseMsg = row.querySelector('.portuguese-unavailable-msg');

  const languageLineLabel = row.querySelector('.language-line-option-label');
  const chkLanguageLine = row.querySelector('.chk-language-line');

  const claimingTranslator = findClaimingTranslatorForRow(row);
  if (claimingTranslator) {
    chkSpanish.checked = claimingTranslator.language === 'spanish';
    chkPortuguese.checked = claimingTranslator.language === 'portuguese';
    chkLanguageLine.checked = false;

    checkboxGroup.classList.add('hidden');
    claimedBanner.innerHTML = `
      <span class="claimed-translator-label">${escapeHtml(capitalize(claimingTranslator.language))} Translator:</span>
      <strong class="claimed-translator-name">${escapeHtml(claimingTranslator.name)}</strong>
      <span class="claimed-status-pill">Claimed</span>
    `;
    claimedBanner.classList.remove('hidden');
    syncCancelButtonVisibility(row);
    return;
  }

  claimedBanner.classList.add('hidden');
  claimedBanner.innerHTML = '';
  checkboxGroup.classList.remove('hidden');

  const spanishAvailable = isTranslatorAvailableForRow(row, 'spanish');
  const portugueseAvailable = isTranslatorAvailableForRow(row, 'portuguese');

  if (spanishAvailable) {
    spanishLabel.classList.remove('hidden');
    spanishMsg.classList.add('hidden');
  } else {
    chkSpanish.checked = false;
    spanishLabel.classList.add('hidden');
    spanishMsg.classList.remove('hidden');
  }

  if (portugueseAvailable) {
    portugueseLabel.classList.remove('hidden');
    portugueseMsg.classList.add('hidden');
  } else {
    chkPortuguese.checked = false;
    portugueseLabel.classList.add('hidden');
    portugueseMsg.classList.remove('hidden');
  }

  // Show 'Language Line' checkbox if either Spanish or Portuguese translator is unavailable
  // (or if this row was already saved with Language Line selected)
  if (!spanishAvailable || !portugueseAvailable || chkLanguageLine.checked) {
    languageLineLabel.classList.remove('hidden');
  } else {
    chkLanguageLine.checked = false;
    languageLineLabel.classList.add('hidden');
  }

  syncCancelButtonVisibility(row);
}

function refreshAllTeacherRowsTranslatorAvailability() {
  const rows = document.querySelectorAll('#teacher-rows-container .conference-row');
  rows.forEach((row) => updateRowTranslatorAvailability(row));
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
  const chkLanguageLine = row.querySelector('.chk-language-line').checked;

  return (
    hourVal !== '' ||
    minVal !== '' ||
    nameVal !== '' ||
    dayVal !== 'WED' ||
    activeAmpm !== 'PM' ||
    activeModality !== 'in-person' ||
    chkSpanish ||
    chkPortuguese ||
    chkLanguageLine
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
  const chkLanguageLine = row.querySelector('.chk-language-line');

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
  chkLanguageLine.checked = false;

  hourInput.classList.remove('input-invalid');
  minuteInput.classList.remove('input-invalid');
  const timeErr = row.querySelector('.time-error-hint');
  timeErr.textContent = '';
  timeErr.classList.add('hidden');

  clearRowValidationState(row);
  refreshAllTeacherRowsTranslatorAvailability();
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
  const chkLanguageLine = row.querySelector('.chk-language-line');

  cancelBtn.addEventListener('click', () => {
    resetConferenceRowToEmpty(row);
  });

  daySelect.addEventListener('change', () => {
    refreshAllTeacherRowsTranslatorAvailability();
  });

  hourInput.addEventListener('input', () => {
    hourInput.value = hourInput.value.replace(/\D/g, '');
    validateRowTime(row, false);
    refreshAllTeacherRowsTranslatorAvailability();
  });
  hourInput.addEventListener('blur', () => {
    validateRowTime(row, true);
    refreshAllTeacherRowsTranslatorAvailability();
  });

  minuteInput.addEventListener('input', () => {
    minuteInput.value = minuteInput.value.replace(/\D/g, '');
    validateRowTime(row, false);
    refreshAllTeacherRowsTranslatorAvailability();
  });
  minuteInput.addEventListener('blur', () => {
    const raw = minuteInput.value.trim();
    if (/^\d$/.test(raw)) {
      minuteInput.value = '0' + raw;
    }
    validateRowTime(row, true);
    refreshAllTeacherRowsTranslatorAvailability();
  });

  ampmBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      ampmBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      refreshAllTeacherRowsTranslatorAvailability();
    });
  });

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
    updateRowTranslatorAvailability(row);
  });
  nameInput.addEventListener('blur', () => {
    nameInput.value = nameInput.value.replace(/\*/g, '').trim();
    updateRowTranslatorAvailability(row);
  });

  modalityBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      modalityBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      syncCancelButtonVisibility(row);
    });
  });

  // Mutually exclusive checkboxes: Spanish Translator, Portuguese Translator, Language Line
  chkSpanish.addEventListener('change', () => {
    if (chkSpanish.checked) {
      chkPortuguese.checked = false;
      chkLanguageLine.checked = false;
    }
    refreshAllTeacherRowsTranslatorAvailability();
  });
  chkPortuguese.addEventListener('change', () => {
    if (chkPortuguese.checked) {
      chkSpanish.checked = false;
      chkLanguageLine.checked = false;
    }
    refreshAllTeacherRowsTranslatorAvailability();
  });
  chkLanguageLine.addEventListener('change', () => {
    if (chkLanguageLine.checked) {
      chkSpanish.checked = false;
      chkPortuguese.checked = false;
    }
    refreshAllTeacherRowsTranslatorAvailability();
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
    await submitTeacherSchedule();
  });
}

async function submitTeacherSchedule() {
  clearStatusBanner();

  if (!state.selectedTeacher) return false;

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
      return;
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
    const isLanguageLine = row.querySelector('.chk-language-line').checked;

    let translator = 'no translator';
    if (isSpanish) translator = 'spanish translator';
    else if (isPortuguese) translator = 'portuguese translator';
    else if (isLanguageLine) translator = 'language line';

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
    if (state.activeScreen !== 'screen-teacher') {
      navigateTo('screen-teacher');
    }
    showStatusBanner(
      'Please complete all highlighted rows (valid Hour 1–12, Minutes 00–59, and Name) or click "cancel conference" to remove a row.',
      'error'
    );
    if (firstInvalidRow) {
      firstInvalidRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return false;
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
    state.teacherFormInitialSnapshot = serializeTeacherFormState();
    showStatusBanner(result.message || 'Schedule saved successfully.', 'success');
    return true;
  } catch (err) {
    showStatusBanner(`Error saving schedule: ${err.message}`, 'error');
    return false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
    setLoading(false);
  }
}

// ============================================================================
// SCREEN 2B: TEACHER ORGANIZED SCHEDULE & PRINT VIEW
// ============================================================================

function bindTeacherOrganizedViewEvents() {
  document.getElementById('open-teacher-schedule-view-btn').addEventListener('click', () => {
    clearStatusBanner();
    if (!state.selectedTeacher) return;
    renderTeacherOrganizedScheduleScreen();
    navigateTo('screen-teacher-schedule-view');
  });

  document.getElementById('back-to-teacher-edit-btn').addEventListener('click', () => {
    clearStatusBanner();
    navigateTo('screen-teacher');
  });

  document.getElementById('print-teacher-schedule-btn').addEventListener('click', () => {
    printTeacherOrganizedSchedule();
  });
}

/**
 * Extracts valid conference entries currently displayed on the teacher's form
 * (so both saved and just-entered conferences are reflected accurately).
 */
function getCurrentTeacherConferencesForOrganizedView() {
  const teacherName = state.selectedTeacher;
  if (!teacherName) return [];

  const rowEls = Array.from(document.querySelectorAll('#teacher-rows-container .conference-row'));
  const entries = [];

  rowEls.forEach((row) => {
    const slot = getRowTimeSlotInfo(row);
    const nameStr = row.querySelector('.name-input').value.replace(/\*/g, '').trim();
    if (!slot.isValid || !nameStr) return;

    const modality = row.querySelector('.modality-option.active')?.dataset.modality || 'in-person';
    const isSpanish = row.querySelector('.chk-spanish').checked;
    const isPortuguese = row.querySelector('.chk-portuguese').checked;
    const isLanguageLine = row.querySelector('.chk-language-line').checked;

    let translator = 'no translator';
    if (isSpanish) translator = 'spanish translator';
    else if (isPortuguese) translator = 'portuguese translator';
    else if (isLanguageLine) translator = 'language line';

    entries.push({
      day: slot.day,
      time: slot.formattedTime,
      timeRange: formatTimeRange20Min(slot.formattedTime),
      name: nameStr,
      teacher: teacherName,
      modality,
      translator
    });
  });

  return sortConferencesChronologically(entries);
}

function getTeacherTranslatorStatusDisplay(conf) {
  if (conf.translator === 'spanish translator' || conf.translator === 'portuguese translator') {
    const langLabel = conf.translator === 'spanish translator' ? 'Spanish Translator' : 'Portuguese Translator';
    const claimer = findClaimingTranslatorForConference(conf);
    return claimer ? `${langLabel} (${claimer.name})` : `${langLabel} (Unclaimed)`;
  }
  if (conf.translator === 'language line') {
    return 'Language Line';
  }
  return 'None';
}

function renderTeacherOrganizedScheduleScreen() {
  const teacherName = state.selectedTeacher;
  if (!teacherName) return;

  const sorted = getCurrentTeacherConferencesForOrganizedView();
  const inPersonCount = sorted.filter((c) => c.modality === 'in-person').length;
  const remoteCount = sorted.length - inPersonCount;

  document.getElementById('teacher-organized-title').textContent = `${teacherName} — Conference Schedule`;
  document.getElementById('teacher-organized-meta-bar').innerHTML = `
    <span><strong>Total Conferences:</strong> ${sorted.length}</span>
    <span><strong>In-Person:</strong> ${inPersonCount}</span>
    <span><strong>Remote:</strong> ${remoteCount}</span>
    <span><strong>Slot Duration:</strong> 20 minutes</span>
  `;

  const container = document.getElementById('teacher-organized-content');
  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty-state-box">No conferences scheduled yet for this teacher.</div>';
    return;
  }

  container.innerHTML = buildDayGroupedScheduleHtml(sorted, 'teacher');
}

function printTeacherOrganizedSchedule() {
  const teacherName = state.selectedTeacher;
  if (!teacherName) return;

  const sorted = getCurrentTeacherConferencesForOrganizedView();
  const nowStr = new Date().toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const bodyHtml = sorted.length > 0
    ? buildDayGroupedPrintHtml(sorted, 'teacher')
    : `<div class="print-empty-msg">No conferences scheduled for ${escapeHtml(teacherName)}.</div>`;

  const printArea = document.getElementById('print-area');
  printArea.innerHTML = `
    <div class="print-banner">
      <h1 class="print-banner-title">AAEE Conferences &mdash; ${escapeHtml(teacherName)}</h1>
    </div>
    <div class="print-meta-bar">
      <span><strong>Total Scheduled Conferences:</strong> ${sorted.length} (20-min slots)</span>
      <span><strong>Printed:</strong> ${escapeHtml(nowStr)}</span>
    </div>
    ${bodyHtml}
  `;

  window.print();
}

// ============================================================================
// SCREEN 3A, 3B, 3C, 3D: TRANSLATORS WORKFLOW & ORGANIZED SCHEDULE VIEW
// ============================================================================

function getTranslatorKey(translator) {
  return `${translator.rowIndex}::${translator.name}`;
}

function getSelectedTranslator() {
  if (!state.selectedTranslatorKey) return null;
  return state.translators.find((t) => getTranslatorKey(t) === state.selectedTranslatorKey) || null;
}

function formatAppointmentCsvString(conf) {
  const clean = (val) => String(val || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return [
    clean(conf.name),
    clean(conf.teacher),
    clean(normalizeModality(conf.modality)),
    clean(String(conf.day || '').toUpperCase()),
    clean(conf.time)
  ].join(', ');
}

function parseAppointmentCsvString(rawStr, colIndex = 3) {
  const parts = String(rawStr || '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length >= 5) {
    const time = parts[parts.length - 1];
    const day = parts[parts.length - 2].toUpperCase();
    const modality = normalizeModality(parts[parts.length - 3]);
    const teacher = parts[parts.length - 4];
    const name = parts.slice(0, parts.length - 4).join(', ');
    return { raw: rawStr, colIndex, name, teacher, modality, day, time };
  }

  if (parts.length === 4) {
    return {
      raw: rawStr,
      colIndex,
      name: parts[0],
      teacher: parts[1],
      modality: normalizeModality(parts[2]),
      day: '',
      time: parts[3]
    };
  }

  return {
    raw: rawStr,
    colIndex,
    name: rawStr,
    teacher: '',
    modality: 'in-person',
    day: '',
    time: ''
  };
}

function normalizeModality(val) {
  return String(val || '').trim().toLowerCase() === 'remote' ? 'remote' : 'in-person';
}

function buildConferenceMatchKey(item) {
  const norm = (s) =>
    String(s || '')
      .replace(/,/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  return `${norm(item.day)}|${norm(item.time)}|${norm(item.teacher)}|${norm(item.name)}`;
}

function getClaimedConferenceKeySet() {
  const set = new Set();
  state.translators.forEach((translator) => {
    translator.appointments.forEach((appt) => {
      set.add(buildConferenceMatchKey(appt));
    });
  });
  return set;
}

function bindTranslatorWorkflowEvents() {
  document.getElementById('open-add-translator-btn').addEventListener('click', () => {
    clearStatusBanner();
    document.getElementById('add-translator-form').reset();
    navigateTo('screen-add-translator');
    document.getElementById('new-translator-name').focus();
  });

  document.getElementById('back-to-translators-from-add-btn').addEventListener('click', () => {
    clearStatusBanner();
    renderTranslatorsHomeScreen();
    navigateTo('screen-translators');
  });

  document.getElementById('cancel-add-translator-btn').addEventListener('click', () => {
    clearStatusBanner();
    renderTranslatorsHomeScreen();
    navigateTo('screen-translators');
  });

  document.getElementById('back-to-translators-from-detail-btn').addEventListener('click', () => {
    clearStatusBanner();
    state.selectedTranslatorKey = null;
    renderTranslatorsHomeScreen();
    navigateTo('screen-translators');
  });

  // Translator Organized Schedule View & Print Buttons
  document.getElementById('open-translator-schedule-view-btn').addEventListener('click', () => {
    clearStatusBanner();
    renderTranslatorOrganizedScheduleScreen();
    navigateTo('screen-translator-schedule-view');
  });

  document.getElementById('back-to-translator-detail-btn').addEventListener('click', () => {
    clearStatusBanner();
    renderTranslatorDetailScreen();
    navigateTo('screen-translator-detail');
  });

  document.getElementById('print-translator-schedule-btn').addEventListener('click', () => {
    printTranslatorOrganizedSchedule();
  });

  document.getElementById('add-translator-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearStatusBanner();

    const nameInput = document.getElementById('new-translator-name');
    const name = nameInput.value.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    const langRadio = document.querySelector('input[name="translator-language"]:checked');
    const language = langRadio ? langRadio.value.toLowerCase() : '';

    if (!name) {
      showStatusBanner('Please enter a name for the translator.', 'error');
      nameInput.focus();
      return;
    }

    if (language !== 'spanish' && language !== 'portuguese') {
      showStatusBanner('Please select either Spanish or Portuguese.', 'error');
      return;
    }

    const submitBtn = document.getElementById('save-new-translator-btn');
    submitBtn.disabled = true;
    setLoading(true, `Adding ${name} to translators...`);

    try {
      const result = await postToAppsScript({
        action: 'addTranslator',
        name,
        language
      });

      if (!result.data) {
        state.translators.push({
          rowIndex: state.translators.length + 1,
          name,
          language,
          appointments: []
        });
      }

      renderTranslatorsHomeScreen();
      navigateTo('screen-translators');
      showStatusBanner(result.message || `${name} (${capitalize(language)}) added.`, 'success');
    } catch (err) {
      showStatusBanner(`Error adding translator: ${err.message}`, 'error');
    } finally {
      submitBtn.disabled = false;
      setLoading(false);
    }
  });
}

function renderTranslatorsHomeScreen() {
  // Update summary KPIs: Unclaimed Spanish, Unclaimed Portuguese, and Language Line
  const claimedKeys = getClaimedConferenceKeySet();
  const unclaimedSpanishCount = state.spanish.filter(
    (conf) => !claimedKeys.has(buildConferenceMatchKey(conf))
  ).length;
  const unclaimedPortugueseCount = state.portuguese.filter(
    (conf) => !claimedKeys.has(buildConferenceMatchKey(conf))
  ).length;

  const languageLineConferences = getAllFlattenedConferences().filter(
    (conf) => conf.translator === 'language line'
  );
  const languageLineConfCount = languageLineConferences.length;
  const languageLineTeacherCount = new Set(languageLineConferences.map((c) => c.teacher)).size;

  document.getElementById('kpi-unclaimed-spanish').textContent = String(unclaimedSpanishCount);
  document.getElementById('kpi-unclaimed-portuguese').textContent = String(unclaimedPortugueseCount);
  document.getElementById('kpi-language-line-count').textContent = String(languageLineConfCount);
  document.getElementById('kpi-language-line-subtext').textContent =
    `${languageLineConfCount} ${languageLineConfCount === 1 ? 'conference' : 'conferences'} across ${languageLineTeacherCount} ${languageLineTeacherCount === 1 ? 'teacher' : 'teachers'}`;

  const grid = document.getElementById('translators-grid');
  grid.innerHTML = '';

  if (state.translators.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-box">
        No translators found in the <strong>translators</strong> tab yet. Click <strong>Add translator</strong> above to add one.
      </div>
    `;
    return;
  }

  state.translators.forEach((translator) => {
    const unit = document.createElement('div');
    unit.className = 'translator-unit-card';

    const langLabel = capitalize(translator.language);
    const langClass = translator.language === 'portuguese' ? 'lang-portuguese' : 'lang-spanish';
    const apptCount = translator.appointments.length;

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'translator-select-btn';
    selectBtn.innerHTML = `
      <span class="translator-btn-name">${escapeHtml(translator.name)}</span>
      <span class="translator-btn-meta">
        <span class="translator-lang-pill ${langClass}">${escapeHtml(langLabel)}</span>
        <span class="translator-appt-count">${apptCount} ${apptCount === 1 ? 'appointment' : 'appointments'}</span>
      </span>
    `;
    selectBtn.addEventListener('click', () => {
      clearStatusBanner();
      state.selectedTranslatorKey = getTranslatorKey(translator);
      renderTranslatorDetailScreen();
      navigateTo('screen-translator-detail');
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-delete-translator';
    deleteBtn.textContent = 'delete translator';
    deleteBtn.addEventListener('click', () => {
      handleDeleteTranslator(translator);
    });

    unit.appendChild(selectBtn);
    unit.appendChild(deleteBtn);
    grid.appendChild(unit);
  });
}

async function handleDeleteTranslator(translator) {
  clearStatusBanner();

  const confirmed = await showConfirmDialog({
    title: `Delete ${translator.name}?`,
    message: `Deleting ${translator.name} will remove them and all their scheduled appointments from the system. Do you want to continue?`,
    confirmLabel: 'Delete Translator',
    variant: 'danger'
  });

  if (!confirmed) return;

  setLoading(true, `Deleting ${translator.name}...`);
  try {
    const result = await postToAppsScript({
      action: 'deleteTranslator',
      rowIndex: translator.rowIndex,
      name: translator.name,
      language: translator.language
    });

    if (!result.data) {
      state.translators = state.translators.filter(
        (t) => getTranslatorKey(t) !== getTranslatorKey(translator)
      );
      renderTranslatorsHomeScreen();
    }

    showStatusBanner(
      result.message || `${translator.name} and their scheduled appointments have been removed.`,
      'success'
    );
  } catch (err) {
    showStatusBanner(`Error deleting translator: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

function renderTranslatorDetailScreen() {
  const translator = getSelectedTranslator();
  if (!translator) {
    renderTranslatorsHomeScreen();
    navigateTo('screen-translators');
    return;
  }

  const langLabel = capitalize(translator.language);
  document.getElementById('translator-detail-lang-badge').textContent = `${langLabel} Translator`;
  document.getElementById('translator-detail-title').textContent = translator.name;
  document.getElementById('unclaimed-conferences-heading').textContent =
    `Unclaimed Conferences Needing a ${langLabel} Translator`;
  document.getElementById('claimed-appointments-heading').textContent =
    `${translator.name}'s Claimed Appointments`;

  const allForLanguage = translator.language === 'portuguese' ? state.portuguese : state.spanish;
  const claimedKeys = getClaimedConferenceKeySet();

  const unclaimed = sortConferencesChronologically(
    allForLanguage.filter((conf) => !claimedKeys.has(buildConferenceMatchKey(conf)))
  );

  document.getElementById('unclaimed-count-badge').textContent = String(unclaimed.length);
  document.getElementById('claimed-count-badge').textContent = String(translator.appointments.length);

  renderUnclaimedConferenceButtons(translator, unclaimed);
  renderClaimedAppointmentsList(translator);
}

function renderUnclaimedConferenceButtons(translator, unclaimedConferences) {
  const container = document.getElementById('unclaimed-conferences-list');
  container.innerHTML = '';

  if (unclaimedConferences.length === 0) {
    container.innerHTML = `<div class="empty-state-box">All ${capitalize(translator.language)} translation requests have been claimed!</div>`;
    return;
  }

  unclaimedConferences.forEach((conf) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'unclaimed-conf-btn';

    const modalityLabel = normalizeModality(conf.modality) === 'remote' ? 'Remote' : 'In-Person';
    const modalityClass = normalizeModality(conf.modality) === 'remote' ? 'remote' : 'in-person';

    const confStart = parseTimeStringToMinutes(conf.time);
    const hasConflict = translator.appointments.some((appt) =>
      doTimeslotsOverlap(conf.day, confStart, appt.day, parseTimeStringToMinutes(appt.time))
    );

    btn.innerHTML = `
      <div class="translator-card-top">
        <span class="translator-conf-name">${escapeHtml(conf.name)}</span>
        <span class="modality-badge ${modalityClass}">${modalityLabel}</span>
      </div>
      <div class="translator-meta-row">
        <span class="translator-meta-item"><strong>Teacher:</strong> ${escapeHtml(conf.teacher)}</span>
        <span class="translator-meta-item"><strong>Time Slot:</strong> ${escapeHtml(conf.day)} &mdash; ${escapeHtml(conf.time)}</span>
      </div>
      ${hasConflict ? '<div class="conflict-warning-tag">Overlaps with one of your existing 20-minute appointments</div>' : ''}
    `;

    btn.addEventListener('click', () => {
      handleClaimConferenceClick(translator, conf, hasConflict);
    });

    container.appendChild(btn);
  });
}

async function handleClaimConferenceClick(translator, conf, hasConflict) {
  clearStatusBanner();

  const modalityLabel = normalizeModality(conf.modality) === 'remote' ? 'remote' : 'in-person';
  const conflictNote = hasConflict
    ? ' Note: This overlaps within 20 minutes of one of your existing appointments.'
    : '';

  const confirmed = await showConfirmDialog({
    title: 'Claim Conference?',
    message: `Do you want to claim "${conf.name}" with ${conf.teacher} (${modalityLabel}) on ${conf.day} at ${conf.time} as one of ${translator.name}'s appointments?${conflictNote}`,
    confirmLabel: 'Claim Appointment',
    variant: 'primary'
  });

  if (!confirmed) return;

  const appointmentString = formatAppointmentCsvString(conf);

  setLoading(true, `Claiming "${conf.name}" for ${translator.name}...`);
  try {
    const result = await postToAppsScript({
      action: 'claimConference',
      rowIndex: translator.rowIndex,
      translatorName: translator.name,
      language: translator.language,
      appointmentString,
      conference: {
        day: conf.day,
        time: conf.time,
        name: conf.name,
        teacher: conf.teacher,
        modality: normalizeModality(conf.modality),
        compositeKey: conf.compositeKey || ''
      }
    });

    if (!result.data) {
      translator.appointments.push(parseAppointmentCsvString(appointmentString));
      renderTranslatorDetailScreen();
    }

    showStatusBanner(
      result.message || `Claimed "${conf.name}" (${conf.day} ${conf.time}) for ${translator.name}.`,
      'success'
    );
  } catch (err) {
    showStatusBanner(`Error claiming conference: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

function renderClaimedAppointmentsList(translator) {
  const container = document.getElementById('claimed-appointments-list');
  container.innerHTML = '';

  if (translator.appointments.length === 0) {
    container.innerHTML = '<div class="empty-state-box">No appointments claimed yet.</div>';
    return;
  }

  const sorted = sortConferencesChronologically(translator.appointments);

  sorted.forEach((appt) => {
    const card = document.createElement('div');
    card.className = 'translator-entry-card claimed-appt-card';

    const modalityLabel = normalizeModality(appt.modality) === 'remote' ? 'Remote' : 'In-Person';
    const modalityClass = normalizeModality(appt.modality) === 'remote' ? 'remote' : 'in-person';

    card.innerHTML = `
      <div class="translator-card-top">
        <h4 class="translator-conf-name">${escapeHtml(appt.name)}</h4>
        <div class="claimed-card-badges">
          <span class="modality-badge ${modalityClass}">${modalityLabel}</span>
          <button type="button" class="btn-unclaim-appt">Unclaim</button>
        </div>
      </div>
      <div class="translator-meta-row">
        ${appt.teacher ? `<span class="translator-meta-item"><strong>Teacher:</strong> ${escapeHtml(appt.teacher)}</span>` : ''}
        <span class="translator-meta-item"><strong>Time Slot:</strong> ${escapeHtml(appt.day ? `${appt.day} — ${appt.time}` : appt.time)}</span>
      </div>
    `;

    card.querySelector('.btn-unclaim-appt').addEventListener('click', () => {
      handleUnclaimAppointmentClick(translator, appt);
    });

    container.appendChild(card);
  });
}

async function handleUnclaimAppointmentClick(translator, appt) {
  clearStatusBanner();

  const timeDesc = appt.day ? `${appt.day} at ${appt.time}` : appt.time;
  const teacherDesc = appt.teacher ? ` with ${appt.teacher}` : '';

  const confirmed = await showConfirmDialog({
    title: 'Unclaim Conference?',
    message: `Are you sure you want to unclaim "${appt.name}"${teacherDesc} (${timeDesc})? It will return to the unclaimed list so another translator can claim it.`,
    confirmLabel: 'Unclaim Conference',
    variant: 'danger'
  });

  if (!confirmed) return;

  const matchKey = buildConferenceMatchKey(appt);

  setLoading(true, `Unclaiming "${appt.name}"...`);
  try {
    const result = await postToAppsScript({
      action: 'unclaimConference',
      rowIndex: translator.rowIndex,
      translatorName: translator.name,
      language: translator.language,
      appointmentRaw: appt.raw || formatAppointmentCsvString(appt),
      matchKey
    });

    if (!result.data) {
      const idx = translator.appointments.findIndex(
        (a) => buildConferenceMatchKey(a) === matchKey || a.raw === appt.raw
      );
      if (idx !== -1) {
        translator.appointments.splice(idx, 1);
      }
      renderTranslatorDetailScreen();
    }

    showStatusBanner(
      result.message || `Unclaimed "${appt.name}". It is now available to be claimed again.`,
      'success'
    );
  } catch (err) {
    showStatusBanner(`Error unclaiming conference: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

function renderTranslatorOrganizedScheduleScreen() {
  const translator = getSelectedTranslator();
  if (!translator) {
    renderTranslatorsHomeScreen();
    navigateTo('screen-translators');
    return;
  }

  const langLabel = capitalize(translator.language);
  const sorted = sortConferencesChronologically(
    translator.appointments.map((appt) => ({
      ...appt,
      timeRange: formatTimeRange20Min(appt.time)
    }))
  );

  const inPersonCount = sorted.filter((a) => normalizeModality(a.modality) === 'in-person').length;
  const remoteCount = sorted.length - inPersonCount;

  document.getElementById('translator-organized-lang-badge').textContent = `${langLabel} Translator Schedule`;
  document.getElementById('translator-organized-title').textContent = `${translator.name} — Translation Schedule`;
  document.getElementById('translator-organized-meta-bar').innerHTML = `
    <span><strong>Language:</strong> ${escapeHtml(langLabel)}</span>
    <span><strong>Total Appointments:</strong> ${sorted.length}</span>
    <span><strong>In-Person:</strong> ${inPersonCount}</span>
    <span><strong>Remote:</strong> ${remoteCount}</span>
  `;

  const container = document.getElementById('translator-organized-content');
  if (sorted.length === 0) {
    container.innerHTML = `<div class="empty-state-box">No translation appointments claimed yet for ${escapeHtml(translator.name)}.</div>`;
    return;
  }

  container.innerHTML = buildDayGroupedScheduleHtml(sorted, 'translator');
}

function printTranslatorOrganizedSchedule() {
  const translator = getSelectedTranslator();
  if (!translator) return;

  const langLabel = capitalize(translator.language);
  const sorted = sortConferencesChronologically(
    translator.appointments.map((appt) => ({
      ...appt,
      timeRange: formatTimeRange20Min(appt.time)
    }))
  );

  const nowStr = new Date().toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const bodyHtml = sorted.length > 0
    ? buildDayGroupedPrintHtml(sorted, 'translator')
    : `<div class="print-empty-msg">No translation appointments claimed for ${escapeHtml(translator.name)}.</div>`;

  const printArea = document.getElementById('print-area');
  printArea.innerHTML = `
    <div class="print-banner">
      <h1 class="print-banner-title">AAEE Conferences &mdash; ${escapeHtml(translator.name)} (${escapeHtml(langLabel)} Translator)</h1>
    </div>
    <div class="print-meta-bar">
      <span><strong>Total Translation Appointments:</strong> ${sorted.length} (20-min slots)</span>
      <span><strong>Printed:</strong> ${escapeHtml(nowStr)}</span>
    </div>
    ${bodyHtml}
  `;

  window.print();
}

// ============================================================================
// SHARED ORGANIZED SCHEDULE RENDERERS (ON-SCREEN & 8.5" x 11" PRINT)
// ============================================================================

function groupConferencesByDay(sortedList) {
  const groups = [];
  const map = new Map();

  sortedList.forEach((item) => {
    const dayKey = item.day || 'UNSCHEDULED';
    if (!map.has(dayKey)) {
      const group = {
        dayCode: dayKey,
        dayLabel: CONSTANTS.DAY_LABELS[dayKey] || dayKey,
        items: []
      };
      map.set(dayKey, group);
      groups.push(group);
    }
    map.get(dayKey).items.push(item);
  });

  return groups;
}

function buildDayGroupedScheduleHtml(sortedList, mode) {
  const dayGroups = groupConferencesByDay(sortedList);

  return dayGroups.map((group) => {
    const rowsHtml = group.items.map((item) => {
      const modalityLabel = normalizeModality(item.modality) === 'remote' ? 'Remote' : 'In-Person';
      const modalityClass = normalizeModality(item.modality) === 'remote' ? 'remote' : 'in-person';
      const fourthCol = mode === 'translator'
        ? escapeHtml(item.teacher || '—')
        : escapeHtml(getTeacherTranslatorStatusDisplay(item));

      return `
        <tr>
          <td class="sched-time-cell"><strong>${escapeHtml(item.timeRange || item.time)}</strong></td>
          <td><strong>${escapeHtml(item.name)}</strong></td>
          <td><span class="modality-badge ${modalityClass}">${modalityLabel}</span></td>
          <td>${fourthCol}</td>
        </tr>
      `;
    }).join('');

    const fourthHeader = mode === 'translator' ? 'Classroom Teacher' : 'Translator / Language Line';

    return `
      <div class="day-schedule-card">
        <div class="day-schedule-card-header">
          <h3>${escapeHtml(group.dayLabel)}</h3>
          <span class="count-pill">${group.items.length} ${group.items.length === 1 ? 'Appointment' : 'Appointments'}</span>
        </div>
        <table class="readonly-table">
          <thead>
            <tr>
              <th style="width: 24%;">Time Slot (20 Min)</th>
              <th style="width: 32%;">Conference Name</th>
              <th style="width: 16%;">Meeting Type</th>
              <th style="width: 28%;">${fourthHeader}</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;
  }).join('');
}

function buildDayGroupedPrintHtml(sortedList, mode) {
  const dayGroups = groupConferencesByDay(sortedList);
  const fourthHeader = mode === 'translator' ? 'Classroom Teacher' : 'Translator / Language Line';

  return dayGroups.map((group) => {
    const rowsHtml = group.items.map((item) => {
      const modalityLabel = normalizeModality(item.modality) === 'remote' ? 'Remote' : 'In-Person';
      const fourthCol = mode === 'translator'
        ? escapeHtml(item.teacher || '—')
        : escapeHtml(getTeacherTranslatorStatusDisplay(item));

      return `
        <tr>
          <td style="width: 24%; font-weight: 700;">${escapeHtml(item.timeRange || item.time)}</td>
          <td style="width: 32%;">${escapeHtml(item.name)}</td>
          <td style="width: 16%;">${modalityLabel}</td>
          <td style="width: 28%;">${fourthCol}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="print-day-block">
        <h2 class="print-day-heading">${escapeHtml(group.dayLabel.toUpperCase())} (${group.items.length})</h2>
        <table class="print-table">
          <thead>
            <tr>
              <th style="width: 24%;">Time Slot</th>
              <th style="width: 32%;">Conference Name</th>
              <th style="width: 16%;">Meeting Type</th>
              <th style="width: 28%;">${fourthHeader}</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;
  }).join('');
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

  const matching = getAllFlattenedConferences().filter(
    (c) => c.day === dayUpper && c.modality === 'in-person'
  );

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
// CHRONOLOGICAL SORTING, TIME FORMATTING & SHARED HELPERS
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

function minutesTo12HourString(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours24 = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const period = hours24 >= 12 ? 'PM' : 'AM';
  let hours12 = hours24 % 12;
  if (hours12 === 0) hours12 = 12;
  return `${hours12}:${String(mins).padStart(2, '0')} ${period}`;
}

function formatTimeRange20Min(startTimeStr) {
  const startMin = parseTimeStringToMinutes(startTimeStr);
  if (startMin >= 9000) return String(startTimeStr || '');
  const endStr = minutesTo12HourString(startMin + CONSTANTS.APPOINTMENT_DURATION_MINUTES);
  return `${minutesTo12HourString(startMin)} – ${endStr}`;
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
  if (val === 'language line') return 'Language Line';
  return 'None';
}

function capitalize(str) {
  const s = String(str || '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
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
```[cite: 1]
