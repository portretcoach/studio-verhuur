/**
 * FOTOSHOOT HERINNERING — Google Apps Script
 *
 * Dit script ontvangt boekingsdata van de fotoshoot-website,
 * slaat deze op in een Google Sheet, en stuurt 48 uur voor
 * de fotoshoot een herinneringsmail.
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
const SHEET_ID = 'JOUW_GOOGLE_SHEET_ID';
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
 * Sla boeking op in Google Sheet
 */
function registerBooking(data) {
  const sheet = getOrCreateSheet();

  // Check of boeking al bestaat (zelfde code) → update
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.code) {
      // Update bestaande rij
      sheet.getRange(i + 1, 1, 1, 8).setValues([[
        data.code,
        data.name,
        data.email,
        data.date,
        data.time,
        data.endTime,
        data.persons,
        'nee' // herinnering verstuurd
      ]]);
      return;
    }
  }

  // Nieuwe rij toevoegen
  sheet.appendRow([
    data.code,
    data.name,
    data.email,
    data.date,
    data.time,
    data.endTime,
    data.persons,
    'nee' // herinnering verstuurd
  ]);
}

/**
 * Sheet ophalen of aanmaken met headers
 */
function getOrCreateSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'Code', 'Naam', 'E-mail', 'Datum', 'Starttijd',
      'Eindtijd', 'Personen', 'Herinnering verstuurd'
    ]);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }

  return sheet;
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
    const [code, name, email, date, startTime, endTime, persons, reminderSent] = rows[i];

    // Skip als herinnering al verstuurd
    if (reminderSent === 'ja') continue;

    // Skip als datum al voorbij is
    if (date < today) continue;

    // Stuur herinnering als de boeking over ~48 uur is
    // (we checken of de boekingsdatum gelijk is aan vandaag + 2 dagen)
    if (date === targetDate) {
      sendReminderEmail(name, email, date, startTime, endTime, persons, code);

      // Markeer als verstuurd
      sheet.getRange(i + 1, 8).setValue('ja');
    }
  }
}

/**
 * Verstuur een herinneringsmail
 */
function sendReminderEmail(name, email, date, startTime, endTime, persons, code) {
  const dateObj = new Date(date + 'T12:00:00');
  const days = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const months = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const dateNL = `${days[dateObj.getDay()]} ${dateObj.getDate()} ${months[dateObj.getMonth()]} ${dateObj.getFullYear()}`;

  const subject = `Herinnering: je fotoshoot op ${dateNL}`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto;">
      <div style="background: #34535b; color: white; padding: 2rem; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="font-family: 'Palatino Linotype', Georgia, serif; font-weight: 400; margin: 0;">Herinnering</h1>
        <p style="color: #dbb458; margin: 0.25rem 0 0;">Fotoshoot bij Iris van 't Riet</p>
      </div>
      <div style="background: white; padding: 2rem; border: 1px solid #e0d8cf; border-top: none; border-radius: 0 0 10px 10px;">
        <p>Beste ${name},</p>
        <p>Dit is een herinnering dat je <strong>overmorgen</strong> een fotoshoot hebt:</p>
        <div style="background: #f5f0ea; padding: 1rem; border-radius: 8px; margin: 1rem 0;">
          <p style="margin: 0.3rem 0;"><strong>Datum:</strong> ${dateNL}</p>
          <p style="margin: 0.3rem 0;"><strong>Tijd:</strong> ${startTime} – ${endTime}</p>
          <p style="margin: 0.3rem 0;"><strong>Personen:</strong> ${persons}</p>
          <p style="margin: 0.3rem 0;"><strong>Code:</strong> ${code}</p>
        </div>
        <p><strong>Locatie:</strong><br>Weg en Bos 22c, Bergschenhoek</p>
        <p style="color: #6b6b6b; font-size: 0.9rem;">Moet je verzetten of annuleren? Gebruik je boekingscode <strong>${code}</strong> op de boekingspagina.</p>
        <p>Tot dan!</p>
        <p>Iris van 't Riet</p>
      </div>
    </div>
  `;

  GmailApp.sendEmail(email, subject,
    `Herinnering: je fotoshoot op ${dateNL} van ${startTime} tot ${endTime}. Locatie: Weg en Bos 22c, Bergschenhoek. Code: ${code}`,
    {
      name: SENDER_NAME,
      htmlBody: htmlBody
    }
  );
}

/**
 * TEST: handmatig herinneringen controleren
 */
function testReminders() {
  sendReminders();
  Logger.log('Herinnering check uitgevoerd');
}
