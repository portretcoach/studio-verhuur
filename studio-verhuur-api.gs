/**
 * STUDIO VERHUUR DATABASE API — Google Apps Script
 *
 * Dit script dient als backend voor het Studio Verhuur Dashboard.
 * Data wordt opgeslagen in Google Sheets tabbladen.
 *
 * ENDPOINTS:
 *   GET  ?action=getData           → alle data ophalen
 *   POST ?action=saveCollection    → één collectie opslaan
 *
 * SETUP:
 * 1. Deploy als Web App (Uitvoeren als: Ik, Toegang: Iedereen)
 * 2. Vul de Web App URL in bij DASHBOARD_API_URL in app.js
 */

const SHEET_ID = '1cxhaNttUQ9LrL-Lj3Bwf-jHILh_vaXF9qBbQbL5TE9w';

// Tabbladen en hun kolomstructuur
const COLLECTIONS = {
  Users:           ['id', 'username', 'password', 'role', 'naam', 'bedrijf', 'adres', 'kvk'],
  Availability:    ['date', 'status', 'note', 'bookedBy'],
  Bookings:        ['id', 'userId', 'date', 'cardId', 'createdAt'],
  Strippenkaarten: ['id', 'userId', 'userName', 'totalStrips', 'usedStrips', 'startDate', 'expiryDate', 'active'],
  VasteHuur:       ['id', 'userId', 'userName', 'dayOfWeek', 'startDate', 'endDate', 'monthlyPrice']
};

// ============================================
// SETUP: tabbladen + headers aanmaken
// ============================================
function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  for (const [name, headers] of Object.entries(COLLECTIONS)) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
    // Headers zetten als rij 1 leeg is
    if (sheet.getLastRow() === 0 || sheet.getRange(1, 1).getValue() === '') {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
  }

  // Seed admin user als Users leeg is (alleen header)
  const usersSheet = ss.getSheetByName('Users');
  if (usersSheet.getLastRow() <= 1) {
    const adminRow = ['admin_001', 'admin', 'admin123', 'admin', 'Beheerder', '', '', ''];
    usersSheet.appendRow(adminRow);
  }

  // Verwijder standaard "Blad1" als die bestaat en leeg is
  const blad1 = ss.getSheetByName('Blad1');
  if (blad1 && blad1.getLastRow() === 0) {
    ss.deleteSheet(blad1);
  }

  return 'Setup voltooid: ' + Object.keys(COLLECTIONS).join(', ');
}

// ============================================
// HELPERS: Sheet ↔ JSON conversie
// ============================================
function sheetToArray(sheetName) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const obj = {};
    headers.forEach((h, j) => {
      let val = data[i][j];
      // Boolean en number conversie
      if (val === 'TRUE' || val === true) val = true;
      else if (val === 'FALSE' || val === false) val = false;
      else if (typeof val === 'number') val = val;
      else if (val === '') val = '';
      obj[h] = val;
    });
    rows.push(obj);
  }
  return rows;
}

function sheetToMap(sheetName, keyField) {
  const arr = sheetToArray(sheetName);
  const map = {};
  arr.forEach(item => {
    const key = item[keyField];
    delete item[keyField];
    map[key] = item;
  });
  return map;
}

function arrayToSheet(sheetName, dataArray) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  const headers = COLLECTIONS[sheetName];
  if (!headers) return;

  // Wis alles behalve headers
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  }

  // Headers (her)schrijven
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Data schrijven
  if (dataArray.length > 0) {
    const rows = dataArray.map(item =>
      headers.map(h => {
        const val = item[h];
        if (val === undefined || val === null) return '';
        return val;
      })
    );
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

function mapToSheet(sheetName, dataMap, keyField) {
  const arr = Object.entries(dataMap).map(([key, val]) => {
    return { [keyField]: key, ...val };
  });
  arrayToSheet(sheetName, arr);
}

// ============================================
// API ENDPOINTS
// ============================================
function doGet(e) {
  const action = e.parameter.action || 'getData';

  if (action === 'getData') {
    const data = {
      success: true,
      users: sheetToArray('Users'),
      availability: sheetToMap('Availability', 'date'),
      bookings: sheetToArray('Bookings'),
      strippenkaarten: sheetToArray('Strippenkaarten'),
      vasteHuur: sheetToArray('VasteHuur')
    };
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || e.parameter.action;

    if (action === 'saveCollection') {
      const collection = body.collection; // bijv. "Users", "Availability"
      const data = body.data;

      if (!COLLECTIONS[collection]) {
        return ContentService.createTextOutput(JSON.stringify({
          success: false, error: 'Unknown collection: ' + collection
        })).setMimeType(ContentService.MimeType.JSON);
      }

      // Availability is een map (date → {status, note, bookedBy})
      if (collection === 'Availability') {
        mapToSheet(collection, data, 'date');
      } else {
        arrayToSheet(collection, data);
      }

      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'createCalendarEvent') {
      createCalendarEvent(body);
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'deleteCalendarEvent') {
      deleteCalendarEvent(body);
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false, error: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================
// GOOGLE CALENDAR: Studio boekingen
// ============================================

function createCalendarEvent(data) {
  try {
    var calendar = CalendarApp.getCalendarById('info@irisvantriet.nl');
    if (!calendar) {
      calendar = CalendarApp.getDefaultCalendar();
    }

    var startDateTime = new Date(data.date + 'T09:00:00');
    var endDateTime = new Date(data.date + 'T17:00:00');

    var title = 'Studio boeking: ' + (data.userName || 'Huurder');

    calendar.createEvent(title, startDateTime, endDateTime, {
      description: 'Studio boeking via dashboard\n\n'
        + 'Huurder: ' + (data.userName || '-') + '\n'
        + 'Boeking ID: ' + (data.bookingId || '-'),
      location: 'Weg en Bos 22c, Bergschenhoek'
    });

    Logger.log('Studio agenda-event aangemaakt: ' + title + ' op ' + data.date);
  } catch (err) {
    Logger.log('FOUT bij aanmaken studio agenda-event: ' + err.message);
  }
}

function deleteCalendarEvent(data) {
  try {
    var calendar = CalendarApp.getCalendarById('info@irisvantriet.nl');
    if (!calendar) {
      calendar = CalendarApp.getDefaultCalendar();
    }

    var searchDate = new Date(data.date + 'T00:00:00');
    var nextDay = new Date(data.date + 'T23:59:59');
    var events = calendar.getEvents(searchDate, nextDay);

    for (var i = 0; i < events.length; i++) {
      if (events[i].getTitle().indexOf('Studio boeking:') === 0) {
        events[i].deleteEvent();
        Logger.log('Studio agenda-event verwijderd op ' + data.date);
        break;
      }
    }
  } catch (err) {
    Logger.log('FOUT bij verwijderen studio agenda-event: ' + err.message);
  }
}
