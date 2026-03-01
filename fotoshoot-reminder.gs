/**
 * FOTOSHOOT HERINNERING + ADMIN NOTIFICATIE — Google Apps Script
 *
 * Dit script ontvangt boekingsdata van de fotoshoot-website,
 * slaat deze op in een Google Sheet, stuurt 48 uur voor
 * de fotoshoot een herinneringsmail, stuurt een admin-notificatie
 * bij nieuwe boekingen, en maakt een Google Calendar event aan.
 *
 * SETUP:
 * 1. Maak een nieuw Google Apps Script project aan (script.google.com)
 * 2. Plak deze code in Code.gs
 * 3. Maak een Google Sheet aan en kopieer het Sheet ID (uit de URL)
 * 4. Vul het SHEET_ID hieronder in
 * 5. Deploy als Web App (Execute as: Me, Access: Anyone)
 * 6. Kopieer de Web App URL en plak in fotoshoot.js (REMINDER_SCRIPT_URL)
 * 7. Voeg een dagelijkse trigger toe:
 *    - Bewerk → Triggers → Trigger toevoegen
 *    - Functie: sendReminders
 *    - Type: Tijdgestuurd → Dagelijks → 08:00-09:00
 *
 * JOUW GEGEVENS:
 */
const SHEET_ID = '1khHoZRvQpgFQTeN0UveKWSs6lfTjqoObB9ooigWhU2s';
const SHEET_NAME = 'Boekingen';
const SENDER_NAME = 'Iris van \'t Riet Fotografie';

/**
 * Web App endpoint — ontvangt boekingsdata via POST
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.action === 'register') {
      registerBooking(data);
      return ContentService
        .createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: 'Onbekende actie' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * CORS preflight
 */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Sla boeking op in Google Sheet + stuur admin notificatie + maak agenda event
 */
function registerBooking(data) {
  const sheet = getOrCreateSheet();

  // Check of boeking al bestaat (zelfde code) → update
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.code) {
      // Update bestaande rij (10 kolommen)
      sheet.getRange(i + 1, 1, 1, 10).setValues([[
        data.code,
        data.name,
        data.email,
        data.date,
        data.time,
        data.endTime || '',
        data.persons || '',
        data.phone || '',
        data.remark || '',
        'nee'
      ]]);
      // Ook bij verzetting: admin notificatie + agenda event
      sendAdminNotification(data, true);
      createCalendarEvent(data);
      return;
    }
  }

  // Nieuwe rij toevoegen (10 kolommen)
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
    'nee'
  ]);

  // Admin notificatie + agenda event
  sendAdminNotification(data, false);
  createCalendarEvent(data);
}

/**
 * Sheet ophalen of aanmaken met headers (10 kolommen)
 */
function getOrCreateSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'Code', 'Naam', 'E-mail', 'Datum', 'Starttijd',
      'Eindtijd', 'Personen', 'Telefoon', 'Opmerking', 'Herinnering verstuurd'
    ]);
    sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
  }

  return sheet;
}

/**
 * Eenmalige migratie: voeg Telefoon en Opmerking kolommen toe
 * aan bestaande sheet (draai handmatig vanuit editor)
 */
function migrateSheetColumns() {
  const sheet = getOrCreateSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // Check of migratie nodig is (oud formaat: 8 kolommen met 'Herinnering verstuurd' op kolom 8)
  if (headers.length === 8 && headers[7] === 'Herinnering verstuurd') {
    // Voeg twee kolommen in vóór 'Herinnering verstuurd'
    sheet.insertColumnsBefore(8, 2);
    sheet.getRange(1, 8).setValue('Telefoon').setFontWeight('bold');
    sheet.getRange(1, 9).setValue('Opmerking').setFontWeight('bold');
    Logger.log('Kolommen Telefoon en Opmerking toegevoegd');
  } else {
    Logger.log('Migratie niet nodig — kolommen bestaan al of sheet is nieuw');
  }
}

/**
 * Verstuur herinneringsmails voor boekingen over 48 uur
 * (wordt dagelijks aangeroepen via trigger)
 */
function sendReminders() {
  const sheet = getOrCreateSheet();
  const rows = sheet.getDataRange().getValues();

  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  // Datumformat: YYYY-MM-DD
  const targetDate = Utilities.formatDate(in48h, 'Europe/Amsterdam', 'yyyy-MM-dd');
  const today = Utilities.formatDate(now, 'Europe/Amsterdam', 'yyyy-MM-dd');

  for (let i = 1; i < rows.length; i++) {
    const [code, name, email, date, startTime, endTime, persons, phone, remark, reminderSent] = rows[i];

    // Skip als herinnering al verstuurd
    if (reminderSent === 'ja') continue;

    // Skip als datum al voorbij is
    if (date < today) continue;

    // Stuur herinnering als de boeking over ~48 uur is
    if (date === targetDate) {
      sendReminderEmail(name, email, date, startTime, endTime, persons, code);

      // Markeer als verstuurd (kolom 10)
      sheet.getRange(i + 1, 10).setValue('ja');
    }
  }
}

/**
 * Verstuur een herinneringsmail naar de klant
 */
function sendReminderEmail(name, email, date, startTime, endTime, persons, code) {
  const dateNL = formatDateNL(date);

  const subject = 'Herinnering: je fotoshoot op ' + dateNL;

  const htmlBody = '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 500px; margin: 0 auto;">'
    + '<div style="background: #34535b; color: white; padding: 2rem; text-align: center; border-radius: 10px 10px 0 0;">'
    + '<h1 style="font-family: \'Palatino Linotype\', Georgia, serif; font-weight: 400; margin: 0;">Herinnering</h1>'
    + '<p style="color: #dbb458; margin: 0.25rem 0 0;">Fotoshoot bij Iris van \'t Riet</p>'
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
    + '<p>Iris van \'t Riet</p>'
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

/**
 * Stuur een notificatie-mail naar de admin bij een nieuwe boeking
 */
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
    + 'Opmerking: ' + (data.remark || '-');

  GmailApp.sendEmail(adminEmail, subject, plainText, {
    name: SENDER_NAME,
    htmlBody: htmlBody
  });
}

// ============================================
// GOOGLE CALENDAR EVENT
// ============================================

/**
 * Maak een Google Calendar event aan voor de fotoshoot
 */
function createCalendarEvent(data) {
  try {
    var calendar = CalendarApp.getDefaultCalendar();

    // Parse datum en tijd — endTime is de blokkeerperiode (2,5 uur)
    var startDateTime = new Date(data.date + 'T' + data.time + ':00');
    var endTime = data.endTime || data.time; // fallback als endTime ontbreekt
    var endDateTime = new Date(data.date + 'T' + endTime + ':00');

    // Titel: klantnaam + boekingscode
    var title = 'Fotoshoot: ' + data.name + ' (' + data.code + ')';

    // Beschrijving met klantdetails
    var description = 'Fotoshoot boeking\n\n'
      + 'Naam: ' + data.name + '\n'
      + 'E-mail: ' + data.email + '\n'
      + 'Telefoon: ' + (data.phone || '-') + '\n'
      + 'Boekingscode: ' + data.code + '\n'
      + 'Opmerking: ' + (data.remark || '-');

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
// HELPER: datum formatteren in het Nederlands
// ============================================
function formatDateNL(dateStr) {
  var dateObj = new Date(dateStr + 'T12:00:00');
  var days = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  var months = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  return days[dateObj.getDay()] + ' ' + dateObj.getDate() + ' ' + months[dateObj.getMonth()] + ' ' + dateObj.getFullYear();
}

// ============================================
// TEST FUNCTIES
// ============================================

/**
 * Test: admin notificatie + calendar event
 * Draai handmatig vanuit Apps Script editor
 */
function testAdminNotificationAndCalendar() {
  var testData = {
    code: 'FS-TEST',
    name: 'Test Klant',
    email: 'test@example.com',
    date: '2026-03-15',
    time: '10:00',
    endTime: '12:00',
    persons: 2,
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
