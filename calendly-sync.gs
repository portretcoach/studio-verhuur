// ============================================
// Calendly Sync — Google Apps Script
// ============================================
// Dit script haalt beschikbare fotoshoot-datums op uit Calendly
// en levert ze als JSON aan het Studio Verhuur Dashboard.
//
// SETUP:
// 1. Ga naar https://script.google.com en maak een nieuw project
// 2. Plak deze code in Code.gs
// 3. Ga naar Projectinstellingen (tandwiel) > Scripteigenschappen
//    Voeg toe: CALENDLY_TOKEN = jouw Personal Access Token van Calendly
//    (Te vinden op: https://calendly.com/integrations/api_webhooks)
// 4. Klik op "Implementeren" > "Nieuwe implementatie"
//    Type: Web-app
//    Uitvoeren als: Ik
//    Toegang: Iedereen
// 5. Kopieer de URL en plak die in app.js bij CALENDLY_SYNC_URL
// ============================================

function doGet(e) {
  try {
    const token = PropertiesService.getScriptProperties().getProperty('CALENDLY_TOKEN');
    if (!token) {
      return jsonResponse({
        success: false,
        error: 'Geen Calendly API token geconfigureerd. Voeg CALENDLY_TOKEN toe aan scripteigenschappen.'
      });
    }

    // Stap 1: Haal huidige Calendly-gebruiker op
    const userResponse = calendlyFetch('/users/me', token);
    const userUri = userResponse.resource.uri;

    // Stap 2: Haal alle actieve event types op
    const eventTypesResponse = calendlyFetch(
      '/event_types?user=' + encodeURIComponent(userUri) + '&active=true&count=100',
      token
    );
    const eventTypes = eventTypesResponse.collection;

    if (!eventTypes || eventTypes.length === 0) {
      return jsonResponse({
        success: false,
        error: 'Geen actieve event types gevonden in Calendly.'
      });
    }

    // Verzamel beschikbare datums van ALLE event types
    const allDates = new Set();
    const now = new Date();
    const startTime = now.toISOString();

    // Kijk 3 maanden vooruit
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + 3);
    const endTime = endDate.toISOString();

    const eventTypeNames = [];

    eventTypes.forEach(function(eventType) {
      eventTypeNames.push(eventType.name);

      try {
        const availResponse = calendlyFetch(
          '/event_type_available_times' +
          '?event_type=' + encodeURIComponent(eventType.uri) +
          '&start_time=' + encodeURIComponent(startTime) +
          '&end_time=' + encodeURIComponent(endTime),
          token
        );

        if (availResponse.collection) {
          availResponse.collection.forEach(function(slot) {
            // Haal alleen de datum (YYYY-MM-DD) uit de ISO timestamp
            var date = slot.start_time.split('T')[0];
            allDates.add(date);
          });
        }
      } catch (err) {
        // Als een event type niet lukt, ga door met de volgende
        Logger.log('Fout bij event type ' + eventType.name + ': ' + err.message);
      }
    });

    // Sorteer datums
    var dates = [];
    allDates.forEach(function(d) { dates.push(d); });
    dates.sort();

    return jsonResponse({
      success: true,
      dates: dates,
      eventTypes: eventTypeNames,
      lastSync: new Date().toISOString(),
      count: dates.length
    });

  } catch (err) {
    return jsonResponse({
      success: false,
      error: err.message
    });
  }
}

// ============================================
// Calendly API helper
// ============================================
function calendlyFetch(endpoint, token) {
  var baseUrl = 'https://api.calendly.com';
  var url = endpoint.indexOf('http') === 0 ? endpoint : baseUrl + endpoint;

  var response = UrlFetchApp.fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('Calendly API fout (HTTP ' + code + '): ' + response.getContentText().substring(0, 200));
  }

  return JSON.parse(response.getContentText());
}

// ============================================
// JSON response helper (met CORS headers)
// ============================================
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// Test functie (handmatig uitvoeren in editor)
// ============================================
function testCalendlySync() {
  var result = doGet();
  var text = result.getContent();
  Logger.log(text);
}
