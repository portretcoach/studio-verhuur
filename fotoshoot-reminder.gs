/**
 * FOTOSHOOT BOEKINGSSYSTEEM — Google Apps Script API
 *
 * Centrale backend voor het fotoshoot boekingssysteem.
 * Google Sheets dient als database, dit script als API.
 *
 * ENDPOINTS:
 * GET  ?action=getData              → alle slots + boekingen ophalen
 * POST action=register              → boeking aanmaken/updaten
 * POST action=addSlot               → beschikbare dag toevoegen (admin)
 * POST action=removeSlot            → beschikbare dag verwijderen (admin)
 * POST action=cancelBooking         → boeking annuleren
 *
 * SHEETS:
 * - "Boekingen"       → alle fotoshoot boekingen
 * - "Beschikbaarheid" → beschikbare data + tijdvensters
 *
 * JOUW GEGEVENS:
 */
const SHEET_ID = '1khHoZRvQpgFQTeN0UveKWSs6lfTjqoObB9ooigWhU2s';
const BOOKINGS_SHEET = 'Boekingen';
const SLOTS_SHEET = 'Beschikbaarheid';
const SENDER_NAME = 'Studio Iris van \'t Riet';
const DEFAULT_PIN = '1234';

// ============================================
// WEB APP ENDPOINTS
// ============================================

/**
 * GET endpoint — data ophalen
 */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'status';

    if (action === 'getData') {
      return jsonResponse(getAllData());
    }

    return jsonResponse({ status: 'ok' });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

/**
 * POST endpoint — acties uitvoeren
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    switch (data.action) {
      case 'register':
        registerBooking(data);
        return jsonResponse({ success: true });

      case 'addSlot':
        if (!validatePin(data.pin)) {
          return jsonResponse({ success: false, error: 'Ongeldige PIN' });
        }
        addSlot(data.date, data.startTime, data.endTime);
        return jsonResponse({ success: true });

      case 'removeSlot':
        if (!validatePin(data.pin)) {
          return jsonResponse({ success: false, error: 'Ongeldige PIN' });
        }
        removeSlot(data.date);
        return jsonResponse({ success: true });

      case 'cancelBooking':
        cancelBookingInSheet(data.code);
        return jsonResponse({ success: true });

      case 'changePin':
        if (!validatePin(data.currentPin)) {
          return jsonResponse({ success: false, error: 'Huidige PIN is onjuist' });
        }
        setPin(data.newPin);
        return jsonResponse({ success: true });

      default:
        return jsonResponse({ success: false, error: 'Onbekende actie' });
    }

  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

/**
 * JSON response helper
 */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// DATA OPHALEN
// ============================================

/**
 * Haal alle slots en boekingen op — gebruikt door GET ?action=getData
 */
function getAllData() {
  var slots = getAllSlots();
  var bookings = getAllBookings();

  return {
    success: true,
    slots: slots,
    bookings: bookings
  };
}

/**
 * Lees alle beschikbare slots uit de Beschikbaarheid sheet
 * Retourneert: { "2026-03-16": { startTime: "12:00", endTime: "18:30" }, ... }
 */
function getAllSlots() {
  var sheet = getOrCreateSlotsSheet();
  var rows = sheet.getDataRange().getValues();
  var slots = {};

  for (var i = 1; i < rows.length; i++) {
    var date = rows[i][0];
    var startTime = rows[i][1];
    var endTime = rows[i][2];

    if (!date) continue;

    // Datum normaliseren (kan Date object zijn vanuit Sheet)
    if (date instanceof Date) {
      date = Utilities.formatDate(date, 'Europe/Amsterdam', 'yyyy-MM-dd');
    }
    // Tijd normaliseren (kan Date object zijn vanuit Sheet)
    if (startTime instanceof Date) {
      startTime = Utilities.formatDate(startTime, 'Europe/Amsterdam', 'HH:mm');
    }
    if (endTime instanceof Date) {
      endTime = Utilities.formatDate(endTime, 'Europe/Amsterdam', 'HH:mm');
    }

    // Zorg dat tijd strings altijd HH:MM formaat zijn
    startTime = normalizeTime(String(startTime));
    endTime = normalizeTime(String(endTime));

    slots[String(date)] = {
      startTime: startTime,
      endTime: endTime
    };
  }

  return slots;
}

/**
 * Lees alle boekingen uit de Boekingen sheet
 * Retourneert array met relevante velden voor de frontend
 */
function getAllBookings() {
  var sheet = getOrCreateBookingsSheet();
  var rows = sheet.getDataRange().getValues();
  var bookings = [];

  for (var i = 1; i < rows.length; i++) {
    var code = rows[i][0];
    if (!code) continue;

    var date = rows[i][3];
    if (date instanceof Date) {
      date = Utilities.formatDate(date, 'Europe/Amsterdam', 'yyyy-MM-dd');
    }

    bookings.push({
      code: String(code),
      name: String(rows[i][1]),
      email: String(rows[i][2]),
      date: String(date),
      time: normalizeTime(String(rows[i][4])),
      phone: String(rows[i][7] || ''),
      remark: String(rows[i][8] || ''),
      consult: String(rows[i][9] || '')
    });
  }

  return bookings;
}

/**
 * Normaliseer tijd naar HH:MM formaat
 */
function normalizeTime(time) {
  if (!time) return '';
  // Verwijder seconden als aanwezig (12:00:00 → 12:00)
  var parts = time.split(':');
  if (parts.length >= 2) {
    return parts[0].padStart(2, '0') + ':' + parts[1].padStart(2, '0');
  }
  return time;
}

// ============================================
// BESCHIKBAARHEID (SLOTS) BEHEER
// ============================================

/**
 * Voeg een beschikbare dag toe
 */
function addSlot(date, startTime, endTime) {
  var sheet = getOrCreateSlotsSheet();

  // Check of datum al bestaat → update
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var existingDate = rows[i][0];
    if (existingDate instanceof Date) {
      existingDate = Utilities.formatDate(existingDate, 'Europe/Amsterdam', 'yyyy-MM-dd');
    }
    if (String(existingDate) === String(date)) {
      // Update bestaande rij
      sheet.getRange(i + 1, 2).setValue(startTime);
      sheet.getRange(i + 1, 3).setValue(endTime);
      return;
    }
  }

  // Nieuwe rij toevoegen
  sheet.appendRow([date, startTime, endTime]);
}

/**
 * Verwijder een beschikbare dag
 */
function removeSlot(date) {
  var sheet = getOrCreateSlotsSheet();
  var rows = sheet.getDataRange().getValues();

  for (var i = 1; i < rows.length; i++) {
    var existingDate = rows[i][0];
    if (existingDate instanceof Date) {
      existingDate = Utilities.formatDate(existingDate, 'Europe/Amsterdam', 'yyyy-MM-dd');
    }
    if (String(existingDate) === String(date)) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

// ============================================
// BOEKINGEN BEHEER
// ============================================

/**
 * Sla boeking op in Google Sheet + stuur admin notificatie + maak agenda event
 */
function registerBooking(data) {
  var sheet = getOrCreateBookingsSheet();

  // Check of boeking al bestaat (zelfde code) → update (verzetting)
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.code) {
      // Update bestaande rij (11 kolommen)
      sheet.getRange(i + 1, 1, 1, 11).setValues([[
        data.code,
        data.name,
        data.email,
        data.date,
        data.time,
        data.endTime || '',
        data.persons || '',
        data.phone || '',
        data.remark || '',
        data.consult || '',
        'nee'
      ]]);
      sendAdminNotification(data, true);
      createCalendarEvent(data);
      return;
    }
  }

  // Nieuwe rij toevoegen (11 kolommen)
  sheet.appendRow([
    data.code,
    data.name,
    data.email,
    data.date,
    data.time,
    data.endTime || '',
    data.persons || '',
    data.phone || '',
    data.remark || '',
    data.consult || '',
    'nee'
  ]);

  sendAdminNotification(data, false);
  createCalendarEvent(data);
}

/**
 * Annuleer een boeking (verwijder rij uit sheet)
 */
function cancelBookingInSheet(code) {
  var sheet = getOrCreateBookingsSheet();
  var rows = sheet.getDataRange().getValues();

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(code)) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

// ============================================
// SHEETS AANMAKEN/OPHALEN
// ============================================

/**
 * Boekingen sheet ophalen of aanmaken
 */
function getOrCreateBookingsSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(BOOKINGS_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(BOOKINGS_SHEET);
    sheet.appendRow([
      'Code', 'Naam', 'E-mail', 'Datum', 'Starttijd',
      'Eindtijd', 'Personen', 'Telefoon', 'Opmerking', 'Consult beschikbaarheid', 'Herinnering verstuurd'
    ]);
    sheet.getRange(1, 1, 1, 11).setFontWeight('bold');
  }

  return sheet;
}

/**
 * Beschikbaarheid sheet ophalen of aanmaken
 */
function getOrCreateSlotsSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SLOTS_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(SLOTS_SHEET);
    sheet.appendRow(['Datum', 'Starttijd', 'Eindtijd']);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  }

  return sheet;
}

// ============================================
// PIN VALIDATIE
// ============================================

/**
 * Valideer admin PIN tegen opgeslagen waarde
 */
function validatePin(pin) {
  var stored = getPin();
  return String(pin) === String(stored);
}

/**
 * Haal huidige PIN op uit Script Properties
 */
function getPin() {
  var props = PropertiesService.getScriptProperties();
  var pin = props.getProperty('admin_pin');
  if (!pin) {
    // Stel default PIN in bij eerste gebruik
    props.setProperty('admin_pin', DEFAULT_PIN);
    return DEFAULT_PIN;
  }
  return pin;
}

/**
 * Sla nieuwe PIN op in Script Properties
 */
function setPin(newPin) {
  PropertiesService.getScriptProperties().setProperty('admin_pin', String(newPin));
}

// ============================================
// HERINNERINGEN
// ============================================

/**
 * Verstuur herinneringsmails voor boekingen over 48 uur
 * (wordt dagelijks aangeroepen via trigger)
 */
function sendReminders() {
  var sheet = getOrCreateBookingsSheet();
  var rows = sheet.getDataRange().getValues();

  var now = new Date();
  var in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  var targetDate = Utilities.formatDate(in48h, 'Europe/Amsterdam', 'yyyy-MM-dd');
  var today = Utilities.formatDate(now, 'Europe/Amsterdam', 'yyyy-MM-dd');

  for (var i = 1; i < rows.length; i++) {
    var code = rows[i][0];
    var name = rows[i][1];
    var email = rows[i][2];
    var date = rows[i][3];
    var startTime = rows[i][4];
    var reminderSent = rows[i][9];

    if (date instanceof Date) {
      date = Utilities.formatDate(date, 'Europe/Amsterdam', 'yyyy-MM-dd');
    }

    if (reminderSent === 'ja') continue;
    if (date < today) continue;

    if (String(date) === targetDate) {
      sendReminderEmail(name, email, date, startTime, code);
      sheet.getRange(i + 1, 10).setValue('ja');
    }
  }
}

/**
 * Verstuur een herinneringsmail naar de klant
 */
function sendReminderEmail(name, email, date, startTime, code) {
  var dateNL = formatDateNL(date);
  var subject = 'Herinnering: je fotoshoot op ' + dateNL;

  var htmlBody = '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 500px; margin: 0 auto;">'
    + '<div style="background: #34535b; color: white; padding: 2rem; text-align: center; border-radius: 10px 10px 0 0;">'
    + '<h1 style="font-family: \'Palatino Linotype\', Georgia, serif; font-weight: 400; margin: 0;">Herinnering</h1>'
    + '<p style="color: #dbb458; margin: 0.25rem 0 0;">Fotoshoot bij Studio Iris van \'t Riet</p>'
    + '</div>'
    + '<div style="background: white; padding: 2rem; border: 1px solid #e0d8cf; border-top: none; border-radius: 0 0 10px 10px;">'
    + '<p>Beste ' + name + ',</p>'
    + '<p>Dit is een herinnering dat je <strong>overmorgen</strong> een fotoshoot hebt:</p>'
    + '<div style="background: #f5f0ea; padding: 1rem; border-radius: 8px; margin: 1rem 0;">'
    + '<p style="margin: 0.3rem 0;"><strong>Datum:</strong> ' + dateNL + '</p>'
    + '<p style="margin: 0.3rem 0;"><strong>Tijd:</strong> ' + startTime + '</p>'
    + '<p style="margin: 0.3rem 0;"><strong>Code:</strong> ' + code + '</p>'
    + '</div>'
    + '<p><strong>Locatie:</strong><br>Weg en Bos 22c, Bergschenhoek</p>'
    + '<p style="color: #6b6b6b; font-size: 0.9rem;">Moet je verzetten of annuleren? Gebruik je boekingscode <strong>' + code + '</strong> op de boekingspagina.</p>'
    + '<p>Tot dan!</p>'
    + '<p>Studio Iris van \'t Riet</p>'
    + '</div>'
    + '</div>';

  GmailApp.sendEmail(email, subject,
    'Herinnering: je fotoshoot op ' + dateNL + ' om ' + startTime + '. Locatie: Weg en Bos 22c, Bergschenhoek. Code: ' + code,
    {
      name: SENDER_NAME,
      htmlBody: htmlBody
    }
  );
}

// ============================================
// ADMIN NOTIFICATIE
// ============================================

function sendAdminNotification(data, isReschedule) {
  var adminEmail;
  try {
    adminEmail = Session.getEffectiveUser().getEmail();
  } catch (err) {
    Logger.log('Kon admin e-mail niet ophalen: ' + err.message);
    return;
  }

  if (!adminEmail) return;

  var dateNL = formatDateNL(data.date);
  var typeLabel = isReschedule ? 'Verzette boeking' : 'Nieuwe boeking';
  var subject = typeLabel + ': ' + data.name + ' (' + data.code + ')';

  var htmlBody = '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 500px; margin: 0 auto;">'
    + '<div style="background: #34535b; color: white; padding: 2rem; text-align: center; border-radius: 10px 10px 0 0;">'
    + '<h1 style="font-family: \'Palatino Linotype\', Georgia, serif; font-weight: 400; margin: 0;">' + typeLabel + '</h1>'
    + '<p style="color: #dbb458; margin: 0.25rem 0 0;">Fotoshoot aanvraag ontvangen</p>'
    + '</div>'
    + '<div style="background: white; padding: 2rem; border: 1px solid #e0d8cf; border-top: none; border-radius: 0 0 10px 10px;">'
    + '<p>Er is een ' + (isReschedule ? 'verzette' : 'nieuwe') + ' fotoshoot geboekt:</p>'
    + '<div style="background: #f5f0ea; padding: 1rem; border-radius: 8px; margin: 1rem 0;">'
    + '<p style="margin: 0.3rem 0;"><strong>Naam:</strong> ' + data.name + '</p>'
    + '<p style="margin: 0.3rem 0;"><strong>Datum:</strong> ' + dateNL + '</p>'
    + '<p style="margin: 0.3rem 0;"><strong>Tijd:</strong> ' + data.time + '</p>'
    + '<p style="margin: 0.3rem 0;"><strong>Telefoon:</strong> ' + (data.phone || '-') + '</p>'
    + '<p style="margin: 0.3rem 0;"><strong>E-mail:</strong> ' + data.email + '</p>'
    + '<p style="margin: 0.3rem 0;"><strong>Code:</strong> ' + data.code + '</p>'
    + '<p style="margin: 0.3rem 0;"><strong>Opmerking:</strong> ' + (data.remark || '-') + '</p>'
    + '<p style="margin: 0.3rem 0;"><strong>Consult beschikbaarheid:</strong> ' + (data.consult || '-') + '</p>'
    + '</div>'
    + '</div>'
    + '</div>';

  var plainText = typeLabel + '\n\n'
    + 'Naam: ' + data.name + '\n'
    + 'Datum: ' + dateNL + '\n'
    + 'Tijd: ' + data.time + '\n'
    + 'Telefoon: ' + (data.phone || '-') + '\n'
    + 'E-mail: ' + data.email + '\n'
    + 'Code: ' + data.code + '\n'
    + 'Opmerking: ' + (data.remark || '-') + '\n'
    + 'Consult beschikbaarheid: ' + (data.consult || '-');

  GmailApp.sendEmail(adminEmail, subject, plainText, {
    name: SENDER_NAME,
    htmlBody: htmlBody
  });
}

// ============================================
// GOOGLE CALENDAR EVENT
// ============================================

function createCalendarEvent(data) {
  try {
    // Gebruik de studio-agenda (rode agenda)
    var calendar = CalendarApp.getCalendarById('info@irisvantriet.nl') || CalendarApp.getDefaultCalendar();

    var startDateTime = new Date(data.date + 'T' + data.time + ':00');
    var endTime = data.endTime || data.time;
    var endDateTime = new Date(data.date + 'T' + endTime + ':00');

    var title = 'Fotoshoot: ' + data.name + ' (' + data.code + ')';

    var description = 'Fotoshoot boeking\n\n'
      + 'Naam: ' + data.name + '\n'
      + 'E-mail: ' + data.email + '\n'
      + 'Telefoon: ' + (data.phone || '-') + '\n'
      + 'Boekingscode: ' + data.code + '\n'
      + 'Opmerking: ' + (data.remark || '-') + '\n'
      + 'Consult beschikbaarheid: ' + (data.consult || '-');

    calendar.createEvent(title, startDateTime, endDateTime, {
      description: description,
      location: 'Weg en Bos 22c, Bergschenhoek'
    });

    Logger.log('Agenda-event aangemaakt voor ' + data.date + ' ' + data.time);

  } catch (err) {
    Logger.log('Fout bij aanmaken agenda-event: ' + err.message);
  }
}

// ============================================
// HELPERS
// ============================================

function formatDateNL(dateStr) {
  var dateObj = new Date(dateStr + 'T12:00:00');
  var days = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  var months = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  return days[dateObj.getDay()] + ' ' + dateObj.getDate() + ' ' + months[dateObj.getMonth()] + ' ' + dateObj.getFullYear();
}

// ============================================
// MIGRATIE & TEST FUNCTIES
// ============================================

/**
 * Eenmalige migratie: zet slots vanuit een JSON string in de Beschikbaarheid sheet
 * Draai handmatig vanuit de Apps Script editor
 */
function migrateSlots() {
  var slotsData = {
    "2026-03-16": {"startTime":"12:00","endTime":"18:30"},
    "2026-03-29": {"startTime":"11:00","endTime":"17:00"},
    "2026-03-30": {"startTime":"12:00","endTime":"19:00"},
    "2026-04-06": {"startTime":"10:00","endTime":"12:00"},
    "2026-04-08": {"startTime":"11:00","endTime":"17:30"},
    "2026-04-13": {"startTime":"10:00","endTime":"17:30"},
    "2026-04-19": {"startTime":"10:00","endTime":"17:00"},
    "2026-04-20": {"startTime":"10:00","endTime":"17:30"},
    "2026-04-23": {"startTime":"11:00","endTime":"17:30"},
    "2026-04-26": {"startTime":"09:00","endTime":"18:00"},
    "2026-04-27": {"startTime":"10:00","endTime":"17:30"},
    "2026-05-04": {"startTime":"10:00","endTime":"17:30"},
    "2026-05-10": {"startTime":"10:00","endTime":"17:30"},
    "2026-05-11": {"startTime":"10:00","endTime":"17:30"},
    "2026-05-17": {"startTime":"10:00","endTime":"17:30"},
    "2026-05-24": {"startTime":"09:00","endTime":"18:00"}
  };

  var dates = Object.keys(slotsData);
  for (var i = 0; i < dates.length; i++) {
    var d = dates[i];
    addSlot(d, slotsData[d].startTime, slotsData[d].endTime);
  }

  Logger.log(dates.length + ' slots gemigreerd naar Beschikbaarheid sheet');
}

/**
 * Test: haal alle data op
 */
function testGetAllData() {
  var data = getAllData();
  Logger.log('Slots: ' + Object.keys(data.slots).length);
  Logger.log('Bookings: ' + data.bookings.length);
  Logger.log(JSON.stringify(data).substring(0, 500));
}

/**
 * Test: admin notificatie + calendar event
 */
function testAdminNotificationAndCalendar() {
  var testData = {
    code: 'FS-TEST',
    name: 'Test Klant',
    email: 'test@example.com',
    date: '2026-03-15',
    time: '10:00',
    endTime: '12:30',
    phone: '06-12345678',
    remark: 'Dit is een test boeking'
  };

  sendAdminNotification(testData, false);
  createCalendarEvent(testData);
  Logger.log('Test voltooid — check je inbox en agenda');
}

/**
 * Test: handmatig herinneringen controleren
 */
function testReminders() {
  sendReminders();
  Logger.log('Herinnering check uitgevoerd');
}
