/**
 * ============================================================================
 * AAEE CONFERENCES SCHEDULING & COORDINATION SYSTEM
 * Google Apps Script Backend (Code.gs) — Specification v2.2
 * ============================================================================
 * Features:
 *  1. Auto-provisioning & formatting for 'setup', 'teachers', 'translators',
 *     'spanish', and 'portuguese'
 *  2. Seeds 30 classroom teachers/teams in 'setup' A1:A30 and injects
 *     =TRANSPOSE(FILTER(setup!A:A, setup!A:A<>"")) into 'teachers' B1
 *  3. Tri-annual automated conference data reset on Nov 1, Feb 1, and Jul 1
 *     with timezone-aware date gating & PropertiesService idempotency lock
 *  4. Concurrency-safe Web App API (doGet / doPost) using LockService
 *  5. Canonical string serialization, upward column compaction, and blank-cell
 *     purging for canceled conferences
 *  6. Translator roster management ('translators' tab: Col A name, Col B
 *     spanish/portuguese, Col C+ left-most unpopulated cell appointment claims)
 *     plus synchronization with 'spanish' and 'portuguese' tabs
 * ============================================================================
 */

const CONFIG = {
  SHEETS: {
    SETUP: 'setup',
    TEACHERS: 'teachers',
    TRANSLATORS: 'translators',
    SPANISH: 'spanish',
    PORTUGUESE: 'portuguese'
  },
  MAX_SLOTS_PER_TEACHER: 24,
  TARGET_CONFERENCES_PER_TEACHER: 22,
  LOCK_TIMEOUT_MS: 15000,
  PROP_LAST_CLEAR_DATE: 'LAST_SEASONAL_CLEAR_DATE',
  PROP_LAST_CLEAR_TIMESTAMP: 'LAST_SEASONAL_CLEAR_TIMESTAMP',
  // 1-indexed calendar months for automated reset: Feb (02), Jul (07), Nov (11)
  SEASONAL_RESET_MONTHS: ['02', '07', '11'],
  SEASONAL_RESET_DAY: '01',
  DEFAULT_TEACHERS: [
    'Aiken',
    'Arnold',
    'Beamon',
    'Casser',
    'Diebolt',
    'Dorlini',
    'Drew',
    'Eckerson',
    'Feuerberg',
    'Fisher',
    'Garrity',
    'Hickey',
    'Keating/Suffish',
    'Khan',
    'Kozieradzki',
    'Lawrence',
    'Lenha',
    'Mahar',
    'Nash',
    'Nunes',
    'Nunn',
    'Palmer',
    'Reme',
    'Sanzaro',
    'Seamour',
    'Serbegis',
    'Strauss/Barone',
    'Tatum',
    'Vallee',
    'Vincelette'
  ],
  VALID_DAYS: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  DAY_ORDER: { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5 },
  VALID_MODALITIES: ['in-person', 'remote'],
  VALID_TRANSLATORS: ['spanish translator', 'portuguese translator', 'language line', 'no translator'],
  VALID_TRANSLATOR_LANGUAGES: ['spanish', 'portuguese'],
  TRANSLATOR_HEADERS: [
    'Conference Name',
    'Day',
    'Time',
    'Classroom Teacher',
    'Modality',
    'Translator / Notes'
  ],
  COLORS: {
    NAVY_HEADER: '#173156',
    SUBHEADER_BG: '#EFF6FF',
    ALT_ROW_BG: '#F8FAFC',
    WHITE: '#FFFFFF',
    MUTED_TEXT: '#64748B',
    BORDER: '#CBD5E1'
  }
};

/**
 * Adds a custom administrative menu to the Google Sheet UI.
 */
function onOpen(e) {
  try {
    SpreadsheetApp.getUi()
      .createMenu('AAEE Conferences')
      .addItem('Initialize & Format Workbook', 'initializeSpreadsheet')
      .addItem('Sync Translator Tabs Now', 'manualSyncTranslatorTabs')
      .addSeparator()
      .addItem('Install / Verify Seasonal Reset Trigger', 'installSeasonalClearTrigger')
      .addItem('Clear All Conference Data Now...', 'manualClearConferenceData')
      .addToUi();
  } catch (err) {
    // Ignore when executed outside spreadsheet UI context (e.g., Web App request)
  }
}

/**
 * ============================================================================
 * 1. SPREADSHEET INITIALIZATION & FORMATTING
 * ============================================================================
 */

/**
 * Creates and formats 'setup', 'teachers', 'translators', 'spanish', and
 * 'portuguese' tabs, populates the 30 teacher strings in 'setup' A1:A30,
 * injects the TRANSPOSE formula in 'teachers' B1, and registers the seasonal
 * reset trigger.
 */
function initializeSpreadsheet() {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureWorkbookProvisioned_(ss, true);
    installSeasonalClearTrigger_(false);
    syncTranslatorTabs_(ss);
    try {
      SpreadsheetApp.getUi().alert(
        'AAEE Conferences Workbook Initialized',
        'All 5 tabs (setup, teachers, translators, spanish, portuguese) have been provisioned and formatted, ' +
        'the 30-teacher roster is active, and the tri-annual reset trigger (Nov 1, Feb 1, Jul 1) is installed.',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    } catch (uiErr) {
      // No UI context when invoked headlessly
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Ensures all tabs exist and are formatted. When forceFormat is false, performs
 * a fast structural check so Web App requests remain snappy.
 */
function ensureWorkbookProvisioned_(ss, forceFormat) {
  const tabNames = [
    CONFIG.SHEETS.SETUP,
    CONFIG.SHEETS.TEACHERS,
    CONFIG.SHEETS.TRANSLATORS,
    CONFIG.SHEETS.SPANISH,
    CONFIG.SHEETS.PORTUGUESE
  ];

  const existedMap = {};
  tabNames.forEach(function (name) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      existedMap[name] = false;
    } else {
      existedMap[name] = true;
    }
  });

  const needsSetup = forceFormat ||
                     !existedMap[CONFIG.SHEETS.SETUP] ||
                     !existedMap[CONFIG.SHEETS.TEACHERS] ||
                     !existedMap[CONFIG.SHEETS.TRANSLATORS] ||
                     !existedMap[CONFIG.SHEETS.SPANISH] ||
                     !existedMap[CONFIG.SHEETS.PORTUGUESE];

  if (!needsSetup) {
    return;
  }

  // Order sheets cleanly: setup, teachers, translators, spanish, portuguese
  tabNames.forEach(function (name, idx) {
    const sheet = ss.getSheetByName(name);
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(idx + 1);
  });

  // 1. Configure 'setup' tab
  const setupSheet = ss.getSheetByName(CONFIG.SHEETS.SETUP);
  const existingSetupVals = setupSheet.getRange(1, 1, Math.max(setupSheet.getLastRow(), 1), 1).getValues();
  const hasAnyTeacher = existingSetupVals.some(function (r) {
    return String(r[0] || '').trim() !== '';
  });

  if (!hasAnyTeacher) {
    const teacherRows = CONFIG.DEFAULT_TEACHERS.map(function (t) { return [t]; });
    setupSheet.getRange(1, 1, teacherRows.length, 1).setValues(teacherRows);
  }

  const setupRowCount = Math.max(setupSheet.getLastRow(), CONFIG.DEFAULT_TEACHERS.length);
  const setupRosterRange = setupSheet.getRange(1, 1, setupRowCount, 1);
  setupRosterRange
    .setFontFamily('Calibri')
    .setFontSize(11)
    .setFontWeight('bold')
    .setFontColor('#1E293B')
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, true, true, CONFIG.COLORS.BORDER, SpreadsheetApp.BorderStyle.SOLID);

  setupSheet.setColumnWidth(1, 220);
  setupSheet.setColumnWidth(2, 40);

  // Audit & Reset Info Box in Column C of 'setup'
  const props = PropertiesService.getScriptProperties();
  const lastClearTs = props.getProperty(CONFIG.PROP_LAST_CLEAR_TIMESTAMP) || 'Not yet triggered';

  setupSheet.getRange('C1').setValue('Last Automated Data Clear')
    .setBackground(CONFIG.COLORS.NAVY_HEADER)
    .setFontColor(CONFIG.COLORS.WHITE)
    .setFontWeight('bold')
    .setFontSize(10)
    .setVerticalAlignment('middle');

  setupSheet.getRange('C2').setValue(lastClearTs)
    .setBackground(CONFIG.COLORS.SUBHEADER_BG)
    .setFontColor('#1E293B')
    .setFontSize(10)
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, CONFIG.COLORS.BORDER, SpreadsheetApp.BorderStyle.SOLID);

  setupSheet.getRange('C4').setValue('Automated Reset Schedule')
    .setBackground(CONFIG.COLORS.NAVY_HEADER)
    .setFontColor(CONFIG.COLORS.WHITE)
    .setFontWeight('bold')
    .setFontSize(10)
    .setVerticalAlignment('middle');

  setupSheet.getRange('C5').setValue('November 1, February 1, July 1 (Annual)')
    .setBackground(CONFIG.COLORS.SUBHEADER_BG)
    .setFontColor('#1E293B')
    .setFontSize(10)
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, CONFIG.COLORS.BORDER, SpreadsheetApp.BorderStyle.SOLID);

  setupSheet.setColumnWidth(3, 270);

  // 2. Configure 'teachers' tab
  const teachersSheet = ss.getSheetByName(CONFIG.SHEETS.TEACHERS);
  teachersSheet.getRange('A1').setValue('Slot');

  const slotLabels = [];
  for (let s = 1; s <= CONFIG.MAX_SLOTS_PER_TEACHER; s++) {
    slotLabels.push(['Slot ' + s]);
  }
  teachersSheet.getRange(2, 1, CONFIG.MAX_SLOTS_PER_TEACHER, 1)
    .setValues(slotLabels)
    .setFontColor(CONFIG.COLORS.MUTED_TEXT)
    .setFontSize(9)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBackground(CONFIG.COLORS.ALT_ROW_BG);

  const b1Cell = teachersSheet.getRange('B1');
  if (b1Cell.getFormula() !== '=TRANSPOSE(FILTER(setup!A:A, setup!A:A<>""))') {
    const currentLastCol = Math.max(teachersSheet.getLastColumn(), 2);
    if (currentLastCol >= 2) {
      teachersSheet.getRange(1, 2, 1, currentLastCol - 1).clearContent();
    }
    b1Cell.setFormula('=TRANSPOSE(FILTER(setup!A:A, setup!A:A<>""))');
  }

  SpreadsheetApp.flush();

  const activeTeacherCount = getTeacherHeaders_(teachersSheet).length;
  const totalCols = Math.max(activeTeacherCount + 1, 2);

  const teacherHeaderRange = teachersSheet.getRange(1, 1, 1, totalCols);
  teacherHeaderRange
    .setBackground(CONFIG.COLORS.NAVY_HEADER)
    .setFontColor(CONFIG.COLORS.WHITE)
    .setFontFamily('Calibri')
    .setFontSize(11)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  teachersSheet.setRowHeight(1, 34);
  teachersSheet.setFrozenRows(1);
  teachersSheet.setFrozenColumns(1);
  teachersSheet.setColumnWidth(1, 75);

  if (activeTeacherCount > 0) {
    teachersSheet.setColumnWidths(2, activeTeacherCount, 285);
    const dataGridRange = teachersSheet.getRange(2, 2, CONFIG.MAX_SLOTS_PER_TEACHER, activeTeacherCount);
    dataGridRange
      .setFontFamily('Calibri')
      .setFontSize(10)
      .setWrap(true)
      .setVerticalAlignment('middle')
      .setNumberFormat('@')
      .setBorder(true, true, true, true, true, true, CONFIG.COLORS.BORDER, SpreadsheetApp.BorderStyle.SOLID);

    for (let r = 2; r <= CONFIG.MAX_SLOTS_PER_TEACHER + 1; r++) {
      teachersSheet.setRowHeight(r, 28);
    }
  }

  // 3. Configure 'translators' tab (Col A = Name, Col B = Language, Col C+ = Claimed Appointments)
  const translatorsSheet = ss.getSheetByName(CONFIG.SHEETS.TRANSLATORS);
  translatorsSheet.setColumnWidth(1, 200);
  translatorsSheet.setColumnWidth(2, 130);
  const trMaxRows = Math.max(translatorsSheet.getLastRow(), 20);
  const trMaxCols = Math.max(translatorsSheet.getLastColumn(), 15);
  translatorsSheet.getRange(1, 1, trMaxRows, trMaxCols)
    .setNumberFormat('@')
    .setFontFamily('Calibri')
    .setFontSize(10)
    .setVerticalAlignment('middle');
  for (let c = 3; c <= trMaxCols; c++) {
    translatorsSheet.setColumnWidth(c, 270);
  }

  // 4. Configure 'spanish' and 'portuguese' tabs
  formatTranslatorTab_(ss.getSheetByName(CONFIG.SHEETS.SPANISH));
  formatTranslatorTab_(ss.getSheetByName(CONFIG.SHEETS.PORTUGUESE));
}

/**
 * Formats a translator tab ('spanish' or 'portuguese') with standard headers and widths.
 */
function formatTranslatorTab_(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, CONFIG.TRANSLATOR_HEADERS.length);
  headerRange
    .setValues([CONFIG.TRANSLATOR_HEADERS])
    .setBackground(CONFIG.COLORS.NAVY_HEADER)
    .setFontColor(CONFIG.COLORS.WHITE)
    .setFontFamily('Calibri')
    .setFontSize(11)
    .setFontWeight('bold')
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle');

  sheet.setRowHeight(1, 34);
  sheet.setFrozenRows(1);

  const widths = [210, 75, 115, 180, 120, 270];
  widths.forEach(function (w, idx) {
    sheet.setColumnWidth(idx + 1, w);
  });
}

/**
 * ============================================================================
 * 2. TRI-ANNUAL AUTOMATED CONFERENCE DATA RESET (NOV 1, FEB 1, JUL 1)
 * ============================================================================
 */

function installSeasonalClearTrigger() {
  installSeasonalClearTrigger_(true);
}

function installSeasonalClearTrigger_(showAlert) {
  const existingTriggers = ScriptApp.getProjectTriggers();
  let alreadyExists = false;

  existingTriggers.forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'scheduledSeasonalClear') {
      alreadyExists = true;
    }
  });

  if (!alreadyExists) {
    ScriptApp.newTrigger('scheduledSeasonalClear')
      .timeBased()
      .onMonthDay(1)
      .atHour(1)
      .create();
  }

  if (showAlert) {
    try {
      SpreadsheetApp.getUi().alert(
        'Seasonal Reset Trigger Active',
        'Conference data will automatically clear once on November 1st, February 1st, and July 1st each year.',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    } catch (e) {}
  }
}

function scheduledSeasonalClear() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const now = new Date();
  const monthStr = Utilities.formatDate(now, tz, 'MM'); // '02', '07', '11'
  const dayStr = Utilities.formatDate(now, tz, 'dd');   // '01'
  const isoDate = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  if (dayStr !== CONFIG.SEASONAL_RESET_DAY || CONFIG.SEASONAL_RESET_MONTHS.indexOf(monthStr) === -1) {
    return;
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const props = PropertiesService.getScriptProperties();
    const lastClearDate = props.getProperty(CONFIG.PROP_LAST_CLEAR_DATE);
    if (lastClearDate === isoDate) {
      return;
    }

    const readableTs = Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm:ss z');
    clearAllConferenceData_(ss, 'Automated (' + readableTs + ')');

    props.setProperty(CONFIG.PROP_LAST_CLEAR_DATE, isoDate);
    props.setProperty(CONFIG.PROP_LAST_CLEAR_TIMESTAMP, readableTs);
  } finally {
    lock.releaseLock();
  }
}

function manualClearConferenceData() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Confirm Conference Data Clear',
    'This will erase all scheduled conferences from the teachers, spanish, and portuguese tabs ' +
    'and clear claimed appointments from the translators tab while keeping your teacher and translator rosters intact. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return;
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tz = ss.getSpreadsheetTimeZone();
    const readableTs = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss z');
    clearAllConferenceData_(ss, 'Manual Clear (' + readableTs + ')');
    PropertiesService.getScriptProperties().setProperty(CONFIG.PROP_LAST_CLEAR_TIMESTAMP, readableTs);
    ui.alert('All conference data has been cleared.');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Clears all conference cells on 'teachers' (Row 2+ across Columns B+), all
 * rows below Row 1 on 'spanish' and 'portuguese', and all claimed appointments
 * in Columns C+ on 'translators' (preserving translator names & languages in A:B).
 */
function clearAllConferenceData_(ss, auditLabel) {
  const teachersSheet = ss.getSheetByName(CONFIG.SHEETS.TEACHERS);
  if (teachersSheet) {
    const maxCols = Math.max(teachersSheet.getLastColumn(), 2);
    const maxRows = Math.max(teachersSheet.getLastRow(), CONFIG.MAX_SLOTS_PER_TEACHER + 1);
    if (maxCols >= 2 && maxRows >= 2) {
      teachersSheet.getRange(2, 2, maxRows - 1, maxCols - 1).clearContent();
    }
  }

  const translatorsSheet = ss.getSheetByName(CONFIG.SHEETS.TRANSLATORS);
  if (translatorsSheet) {
    const trLastRow = translatorsSheet.getLastRow();
    const trLastCol = translatorsSheet.getLastColumn();
    if (trLastRow >= 1 && trLastCol >= 3) {
      translatorsSheet.getRange(1, 3, trLastRow, trLastCol - 2).clearContent();
    }
  }

  [CONFIG.SHEETS.SPANISH, CONFIG.SHEETS.PORTUGUESE].forEach(function (tabName) {
    const sheet = ss.getSheetByName(tabName);
    if (sheet) {
      const lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        sheet.getRange(2, 1, lastRow - 1, CONFIG.TRANSLATOR_HEADERS.length).clearContent();
      }
    }
  });

  const setupSheet = ss.getSheetByName(CONFIG.SHEETS.SETUP);
  if (setupSheet) {
    setupSheet.getRange('C2').setValue(auditLabel);
  }

  SpreadsheetApp.flush();
}

function manualSyncTranslatorTabs() {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    syncTranslatorTabs_(ss);
    SpreadsheetApp.getUi().alert('Translator tabs synchronized successfully.');
  } finally {
    lock.releaseLock();
  }
}

/**
 * ============================================================================
 * 3. WEB APP HTTP ENDPOINTS (doGet & doPost)
 * ============================================================================
 */

function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureWorkbookProvisioned_(ss, false);

    const action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action) : 'getAllData';
    if (action === 'getAllData') {
      return jsonResponse_({
        ok: true,
        data: getAllDataPayload_(ss)
      });
    }

    return jsonResponse_({
      ok: false,
      error: 'Unknown GET action: ' + action
    });
  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureWorkbookProvisioned_(ss, false);

    let payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e && e.parameter && e.parameter.payload) {
      payload = JSON.parse(e.parameter.payload);
    } else {
      throw new Error('Empty request body.');
    }

    const action = String(payload.action || '').trim();

    if (action === 'saveTeacherSchedule') {
      const result = saveTeacherSchedule_(ss, payload);
      return jsonResponse_({
        ok: true,
        message: result.message,
        data: getAllDataPayload_(ss)
      });
    }

    if (action === 'addTranslator') {
      const result = addTranslator_(ss, payload);
      return jsonResponse_({
        ok: true,
        message: result.message,
        data: getAllDataPayload_(ss)
      });
    }

    if (action === 'deleteTranslator') {
      const result = deleteTranslator_(ss, payload);
      return jsonResponse_({
        ok: true,
        message: result.message,
        data: getAllDataPayload_(ss)
      });
    }

    if (action === 'claimConference') {
      const result = claimConference_(ss, payload);
      return jsonResponse_({
        ok: true,
        message: result.message,
        data: getAllDataPayload_(ss)
      });
    }

    if (action === 'saveTranslatorAssignments') {
      const result = saveTranslatorAssignments_(ss, payload);
      return jsonResponse_({
        ok: true,
        message: result.message,
        data: getAllDataPayload_(ss)
      });
    }

    throw new Error('Unknown POST action: ' + action);
  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (releaseErr) {}
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ============================================================================
 * 4. CORE READ / WRITE / SYNC OPERATIONS
 * ============================================================================
 */

/**
 * Builds the unified state payload consumed by all frontend screens:
 *  - teachers: Row 1 of 'teachers' (excluding A1)
 *  - schedules: Per-teacher conference entries
 *  - spanish / portuguese: Translation request lists
 *  - translators: Rows from 'translators' tab (Col A name, Col B language, Col C+ appointments)
 *  - meta: Configuration & audit timestamps
 */
function getAllDataPayload_(ss) {
  const teachersSheet = ss.getSheetByName(CONFIG.SHEETS.TEACHERS);
  const teacherHeaders = getTeacherHeaders_(teachersSheet);
  const teacherNames = teacherHeaders.map(function (t) { return t.name; });

  const schedules = {};
  teacherNames.forEach(function (name) {
    schedules[name] = [];
  });

  const lastRow = teachersSheet.getLastRow();
  const lastCol = teachersSheet.getLastColumn();

  if (lastRow >= 2 && lastCol >= 2 && teacherHeaders.length > 0) {
    const numRows = lastRow - 1;
    const grid = teachersSheet.getRange(2, 2, numRows, lastCol - 1).getValues();

    teacherHeaders.forEach(function (tObj) {
      const gridColIdx = tObj.colIndex - 2;
      const entries = [];

      for (let r = 0; r < numRows; r++) {
        const rawVal = String(grid[r][gridColIdx] || '').trim();
        if (!rawVal) continue;

        const parsed = parseSerializedConference_(rawVal);
        if (parsed) {
          parsed.slot = entries.length + 1;
          parsed.teacher = tObj.name;
          parsed.compositeKey = buildCompositeKey_(tObj.name, parsed.day, parsed.time, parsed.name);
          entries.push(parsed);
        }
      }

      schedules[tObj.name] = entries;
    });
  }

  const spanishRows = readTranslatorTabRows_(ss.getSheetByName(CONFIG.SHEETS.SPANISH));
  const portugueseRows = readTranslatorTabRows_(ss.getSheetByName(CONFIG.SHEETS.PORTUGUESE));
  const translatorsList = getTranslatorsData_(ss);
  const props = PropertiesService.getScriptProperties();

  return {
    teachers: teacherNames,
    schedules: schedules,
    spanish: spanishRows,
    portuguese: portugueseRows,
    translators: translatorsList,
    meta: {
      maxSlotsPerTeacher: CONFIG.MAX_SLOTS_PER_TEACHER,
      targetConferencesPerTeacher: CONFIG.TARGET_CONFERENCES_PER_TEACHER,
      lastSeasonalClear: props.getProperty(CONFIG.PROP_LAST_CLEAR_TIMESTAMP) || null,
      serverTimestamp: new Date().toISOString()
    }
  };
}

/**
 * Reads the 'translators' tab:
 *  - Column A: Translator Name
 *  - Column B: 'spanish' or 'portuguese'
 *  - Columns C+: Claimed appointments stored as comma-separated strings
 */
function getTranslatorsData_(ss) {
  let sheet = ss.getSheetByName(CONFIG.SHEETS.TRANSLATORS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.TRANSLATORS);
    return [];
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow === 0 || lastCol < 2) return [];

  const values = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const translators = [];

  values.forEach(function (row, idx) {
    const name = String(row[0] || '').trim();
    const language = String(row[1] || '').trim().toLowerCase();
    if (!name || CONFIG.VALID_TRANSLATOR_LANGUAGES.indexOf(language) === -1) {
      return;
    }

    const appointments = [];
    for (let c = 2; c < row.length; c++) {
      const cellVal = String(row[c] || '').trim();
      if (cellVal) {
        appointments.push({
          colIndex: c + 1,
          raw: cellVal
        });
      }
    }

    translators.push({
      rowIndex: idx + 1,
      name: name,
      language: language,
      appointments: appointments
    });
  });

  return translators;
}

/**
 * Adds a new translator row (Column A = Name, Column B = spanish/portuguese)
 * to the 'translators' tab.
 */
function addTranslator_(ss, payload) {
  let sheet = ss.getSheetByName(CONFIG.SHEETS.TRANSLATORS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.TRANSLATORS);
  }

  const name = sanitizeCellText_(String(payload.name || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim());
  const language = String(payload.language || '').trim().toLowerCase();

  if (!name) {
    throw new Error('Translator name is required.');
  }
  if (CONFIG.VALID_TRANSLATOR_LANGUAGES.indexOf(language) === -1) {
    throw new Error('Translator language must be "spanish" or "portuguese".');
  }

  const newRowIndex = sheet.getLastRow() + 1;
  const targetRange = sheet.getRange(newRowIndex, 1, 1, 2);
  targetRange
    .setNumberFormat('@')
    .setValues([[name, language]])
    .setFontFamily('Calibri')
    .setFontSize(10)
    .setVerticalAlignment('middle');

  SpreadsheetApp.flush();

  const displayLang = language.charAt(0).toUpperCase() + language.slice(1);
  return {
    message: name + ' (' + displayLang + ') added to translators.'
  };
}

/**
 * Deletes a translator's row from the 'translators' tab, removing them and all
 * of their claimed appointments from the system, and clears any matching
 * assignment note on the 'spanish' / 'portuguese' tabs.
 */
function deleteTranslator_(ss, payload) {
  const sheet = ss.getSheetByName(CONFIG.SHEETS.TRANSLATORS);
  if (!sheet) {
    throw new Error("The 'translators' tab does not exist.");
  }

  const rowIndex = findTranslatorRowIndex_(sheet, payload.rowIndex, payload.name, payload.language);
  if (!rowIndex) {
    throw new Error('Translator "' + (payload.name || '') + '" could not be found.');
  }

  const rowValues = sheet.getRange(rowIndex, 1, 1, Math.max(sheet.getLastColumn(), 2)).getDisplayValues()[0];
  const deletedName = String(rowValues[0] || payload.name || '').trim();
  const deletedLang = String(rowValues[1] || payload.language || '').trim().toLowerCase();

  sheet.deleteRow(rowIndex);

  // Clear Column F notes on 'spanish' or 'portuguese' that belonged to this deleted translator
  const langSheetName = deletedLang === 'portuguese' ? CONFIG.SHEETS.PORTUGUESE : CONFIG.SHEETS.SPANISH;
  const langSheet = ss.getSheetByName(langSheetName);
  if (langSheet && langSheet.getLastRow() >= 2 && deletedName) {
    const numRows = langSheet.getLastRow() - 1;
    const notesRange = langSheet.getRange(2, 6, numRows, 1);
    const notesVals = notesRange.getValues();
    let changed = false;
    for (let i = 0; i < notesVals.length; i++) {
      if (String(notesVals[i][0] || '').trim().toLowerCase() === deletedName.toLowerCase()) {
        notesVals[i][0] = '';
        changed = true;
      }
    }
    if (changed) {
      notesRange.setValues(notesVals);
    }
  }

  SpreadsheetApp.flush();

  return {
    message: deletedName + ' and all their scheduled appointments have been deleted.'
  };
}

/**
 * Claims an unclaimed conference for a translator by writing the comma-separated
 * appointment string into the left-most unpopulated cell (Column C or rightward)
 * of their row on the 'translators' tab.
 */
function claimConference_(ss, payload) {
  const sheet = ss.getSheetByName(CONFIG.SHEETS.TRANSLATORS);
  if (!sheet) {
    throw new Error("The 'translators' tab does not exist.");
  }

  const rowIndex = findTranslatorRowIndex_(
    sheet,
    payload.rowIndex,
    payload.translatorName,
    payload.language
  );
  if (!rowIndex) {
    throw new Error('Translator "' + (payload.translatorName || '') + '" could not be found.');
  }

  const appointmentString = sanitizeCellText_(payload.appointmentString);
  if (!appointmentString) {
    throw new Error('Appointment string is required.');
  }

  const incomingParsed = parseAppointmentCsvString_(appointmentString);
  const incomingMatchKey = buildCompositeKey_(
    incomingParsed.teacher,
    incomingParsed.day,
    incomingParsed.time,
    incomingParsed.name
  );

  // Concurrency guard: ensure no translator has already claimed this exact conference
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow >= 1 && lastCol >= 3) {
    const allGrid = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    for (let r = 0; r < allGrid.length; r++) {
      const existingTranslator = String(allGrid[r][0] || '').trim();
      for (let c = 2; c < allGrid[r].length; c++) {
        const cell = String(allGrid[r][c] || '').trim();
        if (!cell) continue;
        const parsedCell = parseAppointmentCsvString_(cell);
        const existingKey = buildCompositeKey_(
          parsedCell.teacher,
          parsedCell.day,
          parsedCell.time,
          parsedCell.name
        );
        if (incomingMatchKey && existingKey === incomingMatchKey) {
          throw new Error('This conference was already claimed by ' + existingTranslator + '.');
        }
      }
    }
  }

  // Locate the left-most unpopulated cell starting at Column C (1-based index 3)
  const rowWidth = Math.max(sheet.getLastColumn(), 3);
  const rowValues = sheet.getRange(rowIndex, 1, 1, rowWidth).getDisplayValues()[0];
  let targetCol = rowWidth + 1;
  for (let c = 2; c < rowValues.length; c++) {
    if (String(rowValues[c] || '').trim() === '') {
      targetCol = c + 1;
      break;
    }
  }

  const targetCell = sheet.getRange(rowIndex, targetCol);
  targetCell
    .setNumberFormat('@')
    .setValue(appointmentString)
    .setFontFamily('Calibri')
    .setFontSize(10)
    .setVerticalAlignment('middle');

  if (sheet.getColumnWidth(targetCol) < 250) {
    sheet.setColumnWidth(targetCol, 270);
  }

  // Also record the claiming translator's name in Column F of 'spanish' or 'portuguese'
  const lang = String(payload.language || '').trim().toLowerCase();
  const langSheetName = lang === 'portuguese' ? CONFIG.SHEETS.PORTUGUESE : CONFIG.SHEETS.SPANISH;
  const langSheet = ss.getSheetByName(langSheetName);
  if (langSheet && incomingMatchKey) {
    const updatesMap = {};
    updatesMap[incomingMatchKey] = sanitizeCellText_(payload.translatorName);
    applyTranslatorNotesToSheet_(langSheet, updatesMap);
  }

  SpreadsheetApp.flush();

  return {
    message: 'Conference claimed for ' + payload.translatorName + '.'
  };
}

/**
 * Validates, sanitizes, serializes, and saves a single teacher's schedule.
 * Compacts valid rows upward starting at Row 2 and explicitly clears trailing
 * cells to blank so canceled conferences are erased, then syncs translator tabs.
 */
function saveTeacherSchedule_(ss, payload) {
  const teacherName = String(payload.teacher || '').trim();
  if (!teacherName) {
    throw new Error('Missing teacher name.');
  }

  const teachersSheet = ss.getSheetByName(CONFIG.SHEETS.TEACHERS);
  const teacherHeaders = getTeacherHeaders_(teachersSheet);
  const targetTeacher = teacherHeaders.find(function (t) {
    return t.name.toLowerCase() === teacherName.toLowerCase();
  });

  if (!targetTeacher) {
    throw new Error('Teacher "' + teacherName + '" was not found in Row 1 of the teachers tab.');
  }

  const incomingRows = Array.isArray(payload.rows) ? payload.rows : [];
  if (incomingRows.length > CONFIG.MAX_SLOTS_PER_TEACHER) {
    throw new Error('A maximum of ' + CONFIG.MAX_SLOTS_PER_TEACHER + ' conferences is allowed per teacher.');
  }

  const serializedStrings = [];

  incomingRows.forEach(function (row, idx) {
    const cleanName = String(row.name || '').replace(/\*/g, '').trim();
    if (!cleanName) {
      return;
    }

    const day = String(row.day || 'WED').trim().toUpperCase();
    if (CONFIG.VALID_DAYS.indexOf(day) === -1) {
      throw new Error('Row ' + (idx + 1) + ': Invalid day of week "' + day + '".');
    }

    const hourNum = parseInt(String(row.hour || '').trim(), 10);
    if (isNaN(hourNum) || hourNum < 1 || hourNum > 12) {
      throw new Error('Row ' + (idx + 1) + ': Hour must be between 1 and 12.');
    }

    const minRaw = String(row.minute !== undefined ? row.minute : '').trim();
    const minNum = parseInt(minRaw, 10);
    if (minRaw === '' || isNaN(minNum) || minNum < 0 || minNum > 59) {
      throw new Error('Row ' + (idx + 1) + ': Minutes must be between 00 and 59.');
    }
    const minutePadded = (minNum < 10 ? '0' : '') + String(minNum);

    const ampm = String(row.ampm || 'PM').trim().toUpperCase();
    if (ampm !== 'AM' && ampm !== 'PM') {
      throw new Error('Row ' + (idx + 1) + ': AM/PM must be AM or PM.');
    }

    const modality = String(row.modality || 'in-person').trim().toLowerCase();
    if (CONFIG.VALID_MODALITIES.indexOf(modality) === -1) {
      throw new Error('Row ' + (idx + 1) + ': Modality must be "in-person" or "remote".');
    }

    const translator = String(row.translator || 'no translator').trim().toLowerCase();
    if (CONFIG.VALID_TRANSLATORS.indexOf(translator) === -1) {
      throw new Error('Row ' + (idx + 1) + ': Invalid translator selection "' + translator + '".');
    }

    const serialized = [
      day,
      hourNum + ':' + minutePadded + ' ' + ampm,
      cleanName,
      modality,
      translator
    ].join(' ** ');

    serializedStrings.push(serialized);
  });

  const clearRowCount = Math.max(CONFIG.MAX_SLOTS_PER_TEACHER, teachersSheet.getLastRow() - 1);
  const outputMatrix = [];
  for (let i = 0; i < clearRowCount; i++) {
    outputMatrix.push([i < serializedStrings.length ? serializedStrings[i] : '']);
  }

  const targetRange = teachersSheet.getRange(2, targetTeacher.colIndex, clearRowCount, 1);
  targetRange
    .setNumberFormat('@')
    .setValues(outputMatrix)
    .setWrap(true)
    .setVerticalAlignment('middle');

  SpreadsheetApp.flush();

  syncTranslatorTabs_(ss);

  return {
    message: 'Saved ' + serializedStrings.length + ' conference(s) for ' + targetTeacher.name + '.'
  };
}

/**
 * Rebuilds the 'spanish' and 'portuguese' tabs from the 'teachers' tab,
 * prunes any orphaned appointments from the 'translators' tab if a teacher
 * canceled or modified a conference, and preserves existing Column F notes.
 */
function syncTranslatorTabs_(ss) {
  const teachersSheet = ss.getSheetByName(CONFIG.SHEETS.TEACHERS);
  const spanishSheet = ss.getSheetByName(CONFIG.SHEETS.SPANISH);
  const portugueseSheet = ss.getSheetByName(CONFIG.SHEETS.PORTUGUESE);

  const spanishNotesMap = snapshotTranslatorNotes_(spanishSheet);
  const portugueseNotesMap = snapshotTranslatorNotes_(portugueseSheet);

  // Also map claimed conferences from the 'translators' tab so Column F reflects claims
  const claimedByKey = {};
  const translatorsList = getTranslatorsData_(ss);
  translatorsList.forEach(function (tr) {
    tr.appointments.forEach(function (appt) {
      const parsed = parseAppointmentCsvString_(appt.raw);
      if (parsed.teacher && parsed.day && parsed.time && parsed.name) {
        const key = buildCompositeKey_(parsed.teacher, parsed.day, parsed.time, parsed.name);
        claimedByKey[key] = {
          translatorName: tr.name,
          language: tr.language
        };
      }
    });
  });

  const teacherHeaders = getTeacherHeaders_(teachersSheet);
  const lastRow = teachersSheet.getLastRow();
  const lastCol = teachersSheet.getLastColumn();

  const spanishEntries = [];
  const portugueseEntries = [];
  const validSpanishKeys = {};
  const validPortugueseKeys = {};

  if (lastRow >= 2 && lastCol >= 2 && teacherHeaders.length > 0) {
    const numRows = lastRow - 1;
    const grid = teachersSheet.getRange(2, 2, numRows, lastCol - 1).getValues();

    teacherHeaders.forEach(function (tObj) {
      const gridColIdx = tObj.colIndex - 2;
      for (let r = 0; r < numRows; r++) {
        const rawVal = String(grid[r][gridColIdx] || '').trim();
        if (!rawVal) continue;

        const parsed = parseSerializedConference_(rawVal);
        if (!parsed) continue;

        if (parsed.translator === 'spanish translator' || parsed.translator === 'portuguese translator') {
          const compositeKey = buildCompositeKey_(tObj.name, parsed.day, parsed.time, parsed.name);
          const claimedInfo = claimedByKey[compositeKey];
          const record = {
            compositeKey: compositeKey,
            name: parsed.name,
            day: parsed.day,
            time: parsed.time,
            teacher: tObj.name,
            modality: parsed.modality,
            dayOrdinal: CONFIG.DAY_ORDER[parsed.day] || 99,
            minutesFromMidnight: timeToMinutes_(parsed.hour, parsed.minute, parsed.ampm)
          };

          if (parsed.translator === 'spanish translator') {
            validSpanishKeys[compositeKey] = true;
            record.notes = (claimedInfo && claimedInfo.language === 'spanish')
              ? claimedInfo.translatorName
              : (spanishNotesMap[compositeKey] || '');
            spanishEntries.push(record);
          } else {
            validPortugueseKeys[compositeKey] = true;
            record.notes = (claimedInfo && claimedInfo.language === 'portuguese')
              ? claimedInfo.translatorName
              : (portugueseNotesMap[compositeKey] || '');
            portugueseEntries.push(record);
          }
        }
      }
    });
  }

  // Remove stale claimed appointments from 'translators' if the teacher canceled/changed the conference
  pruneOrphanedTranslatorAppointments_(ss, validSpanishKeys, validPortugueseKeys);

  const comparator = function (a, b) {
    if (a.dayOrdinal !== b.dayOrdinal) return a.dayOrdinal - b.dayOrdinal;
    if (a.minutesFromMidnight !== b.minutesFromMidnight) return a.minutesFromMidnight - b.minutesFromMidnight;
    const teacherCmp = a.teacher.localeCompare(b.teacher, undefined, { sensitivity: 'base' });
    if (teacherCmp !== 0) return teacherCmp;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  };

  spanishEntries.sort(comparator);
  portugueseEntries.sort(comparator);

  writeTranslatorTabRows_(spanishSheet, spanishEntries);
  writeTranslatorTabRows_(portugueseSheet, portugueseEntries);

  SpreadsheetApp.flush();
}

/**
 * Compacts each translator's appointment cells (Columns C+) leftward while
 * removing any appointments whose underlying conference was canceled or no longer
 * requests that language.
 */
function pruneOrphanedTranslatorAppointments_(ss, validSpanishKeys, validPortugueseKeys) {
  const sheet = ss.getSheetByName(CONFIG.SHEETS.TRANSLATORS);
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow === 0 || lastCol < 3) return;

  const grid = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  let anyChanged = false;

  for (let r = 0; r < grid.length; r++) {
    const name = String(grid[r][0] || '').trim();
    const lang = String(grid[r][1] || '').trim().toLowerCase();
    if (!name || CONFIG.VALID_TRANSLATOR_LANGUAGES.indexOf(lang) === -1) continue;

    const validMap = lang === 'portuguese' ? validPortugueseKeys : validSpanishKeys;
    const keptAppointments = [];

    for (let c = 2; c < grid[r].length; c++) {
      const cell = String(grid[r][c] || '').trim();
      if (!cell) continue;

      const parsed = parseAppointmentCsvString_(cell);
      if (parsed.teacher && parsed.day && parsed.time && parsed.name) {
        const key = buildCompositeKey_(parsed.teacher, parsed.day, parsed.time, parsed.name);
        if (validMap[key]) {
          keptAppointments.push(cell);
        } else {
          anyChanged = true;
        }
      } else {
        keptAppointments.push(cell);
      }
    }

    // Check if row needs compaction or pruning
    for (let c = 2; c < grid[r].length; c++) {
      const expected = keptAppointments[c - 2] || '';
      if (String(grid[r][c] || '').trim() !== expected) {
        anyChanged = true;
        grid[r][c] = expected;
      }
    }
  }

  if (anyChanged) {
    const apptColsCount = lastCol - 2;
    const apptMatrix = grid.map(function (row) {
      return row.slice(2, 2 + apptColsCount);
    });
    sheet.getRange(1, 3, lastRow, apptColsCount)
      .setNumberFormat('@')
      .setValues(apptMatrix);
  }
}

function saveTranslatorAssignments_(ss, payload) {
  const updates = payload.updates || {};
  const spanishUpdatesMap = normalizeUpdatesMap_(updates.spanish);
  const portugueseUpdatesMap = normalizeUpdatesMap_(updates.portuguese);

  const spanishUpdated = applyTranslatorNotesToSheet_(
    ss.getSheetByName(CONFIG.SHEETS.SPANISH),
    spanishUpdatesMap
  );
  const portugueseUpdated = applyTranslatorNotesToSheet_(
    ss.getSheetByName(CONFIG.SHEETS.PORTUGUESE),
    portugueseUpdatesMap
  );

  SpreadsheetApp.flush();

  return {
    message: 'Updated translator assignments (' + (spanishUpdated + portugueseUpdated) + ' matched).'
  };
}

/**
 * ============================================================================
 * 5. INTERNAL HELPER FUNCTIONS
 * ============================================================================
 */

function findTranslatorRowIndex_(sheet, expectedRowIndex, name, language) {
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) return null;

  const targetName = String(name || '').trim().toLowerCase();
  const targetLang = String(language || '').trim().toLowerCase();

  const rowIdxNum = parseInt(expectedRowIndex, 10);
  if (!isNaN(rowIdxNum) && rowIdxNum >= 1 && rowIdxNum <= lastRow) {
    const row = sheet.getRange(rowIdxNum, 1, 1, 2).getDisplayValues()[0];
    if (
      String(row[0] || '').trim().toLowerCase() === targetName &&
      (!targetLang || String(row[1] || '').trim().toLowerCase() === targetLang)
    ) {
      return rowIdxNum;
    }
  }

  const allRows = sheet.getRange(1, 1, lastRow, 2).getDisplayValues();
  for (let i = 0; i < allRows.length; i++) {
    if (
      String(allRows[i][0] || '').trim().toLowerCase() === targetName &&
      (!targetLang || String(allRows[i][1] || '').trim().toLowerCase() === targetLang)
    ) {
      return i + 1;
    }
  }

  return null;
}

/**
 * Parses a comma-separated appointment string stored in 'translators' Col C+:
 * Expected format: "Conference Name, Teacher Name, Modality, Day, Time"
 */
function parseAppointmentCsvString_(rawStr) {
  const parts = String(rawStr || '')
    .split(',')
    .map(function (p) { return p.trim(); })
    .filter(function (p) { return p.length > 0; });

  if (parts.length >= 5) {
    const time = parts[parts.length - 1].toUpperCase();
    const day = parts[parts.length - 2].toUpperCase();
    const modality = parts[parts.length - 3].toLowerCase();
    const teacher = parts[parts.length - 4];
    const name = parts.slice(0, parts.length - 4).join(', ');
    return { name: name, teacher: teacher, modality: modality, day: day, time: time };
  }

  return { name: rawStr, teacher: '', modality: '', day: '', time: '' };
}

function getTeacherHeaders_(teachersSheet) {
  const lastCol = teachersSheet.getLastColumn();
  if (lastCol < 2) return [];

  const row1Values = teachersSheet.getRange(1, 2, 1, lastCol - 1).getValues()[0];
  const headers = [];

  row1Values.forEach(function (val, idx) {
    const clean = String(val || '').trim();
    if (clean) {
      headers.push({
        name: clean,
        colIndex: idx + 2
      });
    }
  });

  return headers;
}

function parseSerializedConference_(rawStr) {
  const parts = String(rawStr || '').split(' ** ');
  if (parts.length < 5) return null;

  const day = parts[0].trim().toUpperCase();
  const timeStr = parts[1].trim().toUpperCase();
  const name = parts[2].trim();
  const modality = parts[3].trim().toLowerCase();
  const translator = parts[4].trim().toLowerCase();

  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!timeMatch) return null;

  const hour = parseInt(timeMatch[1], 10);
  const minute = timeMatch[2];
  const ampm = timeMatch[3].toUpperCase();

  return {
    day: day,
    hour: hour,
    minute: minute,
    ampm: ampm,
    time: hour + ':' + minute + ' ' + ampm,
    name: name,
    modality: modality,
    translator: translator,
    raw: rawStr
  };
}

function buildCompositeKey_(teacher, day, time, conferenceName) {
  return [
    String(teacher || '').trim().toLowerCase(),
    String(day || '').trim().toUpperCase(),
    String(time || '').trim().toUpperCase(),
    String(conferenceName || '').trim().toLowerCase()
  ].join('|');
}

function timeToMinutes_(hour, minuteStr, ampm) {
  const h = parseInt(hour, 10);
  const m = parseInt(minuteStr, 10) || 0;
  const period = String(ampm || 'PM').toUpperCase();
  if (period === 'AM') {
    return (h === 12 ? 0 : h * 60) + m;
  }
  return (h === 12 ? 720 : (h + 12) * 60) + m;
}

function snapshotTranslatorNotes_(sheet) {
  const map = {};
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return map;

  const rows = sheet.getRange(2, 1, lastRow - 1, CONFIG.TRANSLATOR_HEADERS.length).getValues();
  rows.forEach(function (r) {
    const name = String(r[0] || '').trim();
    const day = String(r[1] || '').trim();
    const time = String(r[2] || '').trim();
    const teacher = String(r[3] || '').trim();
    const notes = String(r[5] || '').trim();
    if (name && teacher && notes) {
      const key = buildCompositeKey_(teacher, day, time, name);
      map[key] = notes;
    }
  });

  return map;
}

function writeTranslatorTabRows_(sheet, entries) {
  const existingLastRow = sheet.getLastRow();
  if (existingLastRow >= 2) {
    sheet.getRange(2, 1, existingLastRow - 1, CONFIG.TRANSLATOR_HEADERS.length).clearContent();
  }

  if (entries.length === 0) return;

  const matrix = entries.map(function (item) {
    return [
      item.name,
      item.day,
      item.time,
      item.teacher,
      item.modality,
      item.notes || ''
    ];
  });

  const range = sheet.getRange(2, 1, matrix.length, CONFIG.TRANSLATOR_HEADERS.length);
  range
    .setNumberFormat('@')
    .setValues(matrix)
    .setFontFamily('Calibri')
    .setFontSize(10)
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, true, true, CONFIG.COLORS.BORDER, SpreadsheetApp.BorderStyle.SOLID);

  for (let r = 2; r <= matrix.length + 1; r++) {
    sheet.setRowHeight(r, 26);
  }
}

function readTranslatorTabRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, CONFIG.TRANSLATOR_HEADERS.length).getValues();
  const rows = [];

  values.forEach(function (r) {
    const name = String(r[0] || '').trim();
    if (!name) return;

    const day = String(r[1] || '').trim().toUpperCase();
    const time = String(r[2] || '').trim().toUpperCase();
    const teacher = String(r[3] || '').trim();
    const modality = String(r[4] || '').trim().toLowerCase();
    const notes = String(r[5] || '').trim();

    rows.push({
      compositeKey: buildCompositeKey_(teacher, day, time, name),
      name: name,
      day: day,
      time: time,
      teacher: teacher,
      modality: modality,
      notes: notes
    });
  });

  return rows;
}

function normalizeUpdatesMap_(listOrMap) {
  const map = {};
  if (!listOrMap) return map;

  if (Array.isArray(listOrMap)) {
    listOrMap.forEach(function (item) {
      if (item && item.compositeKey) {
        map[String(item.compositeKey)] = sanitizeCellText_(item.notes);
      }
    });
  } else if (typeof listOrMap === 'object') {
    Object.keys(listOrMap).forEach(function (key) {
      map[String(key)] = sanitizeCellText_(listOrMap[key]);
    });
  }

  return map;
}

function applyTranslatorNotesToSheet_(sheet, updatesMap) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const numRows = lastRow - 1;
  const rows = sheet.getRange(2, 1, numRows, CONFIG.TRANSLATOR_HEADERS.length).getValues();
  const colFValues = [];
  let matchCount = 0;

  rows.forEach(function (r) {
    const name = String(r[0] || '').trim();
    const day = String(r[1] || '').trim();
    const time = String(r[2] || '').trim();
    const teacher = String(r[3] || '').trim();
    const currentNote = String(r[5] || '');

    if (!name) {
      colFValues.push(['']);
      return;
    }

    const key = buildCompositeKey_(teacher, day, time, name);
    if (Object.prototype.hasOwnProperty.call(updatesMap, key)) {
      colFValues.push([updatesMap[key]]);
      matchCount++;
    } else {
      colFValues.push([currentNote]);
    }
  });

  sheet.getRange(2, 6, numRows, 1)
    .setNumberFormat('@')
    .setValues(colFValues);

  return matchCount;
}

function sanitizeCellText_(val) {
  const str = String(val !== undefined && val !== null ? val : '').trim();
  if (/^[=+\-@]/.test(str)) {
    return "'" + str;
  }
  return str;
}
