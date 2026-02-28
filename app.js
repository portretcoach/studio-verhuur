// ============================================
// 1. CONSTANTS & STORAGE
// ============================================
const STORAGE_KEYS = {
    users: 'sv_users',
    availability: 'sv_availability',
    bookings: 'sv_bookings',
    strippenkaarten: 'sv_strippenkaarten',
    vasteHuur: 'sv_vaste_huur',
    session: 'sv_session',
    fotoshootSlots: 'sv_fotoshoot_slots',
    fotoshootBookings: 'sv_fotoshoot_bookings',
};

// Google Calendar Sync URL (Apps Script Web App)
const CALENDAR_SYNC_URL = 'https://script.google.com/macros/s/AKfycbzZFjfuhYaeazpYi9ALgdFsFmedwTPpAg53oPnW-s3h_yqWSX5XTRMreIoqZrG0JzYUSw/exec';

// Fotoshoot instellingen
const FOTOSHOOT_DURATION = 120; // minuten
const FOTOSHOOT_BUFFER = 30;   // minuten buffer na elke sessie

const DAYS_NL = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
const DAYS_SHORT = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
const MONTHS_NL = [
    'januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december'
];

function load(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
}

function loadMap(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; }
    catch { return {}; }
}

function loadObj(key) {
    try { return JSON.parse(localStorage.getItem(key)) || null; }
    catch { return null; }
}

function save(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function formatDateStr(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function todayStr() {
    const d = new Date();
    return formatDateStr(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDateNL(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const dayName = DAYS_NL[(d.getDay() + 6) % 7];
    return `${dayName} ${d.getDate()} ${MONTHS_NL[d.getMonth()]} ${d.getFullYear()}`;
}

function addMonths(dateStr, months) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setMonth(d.getMonth() + months);
    return formatDateStr(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysUntil(dateStr) {
    const today = new Date(todayStr() + 'T12:00:00');
    const target = new Date(dateStr + 'T12:00:00');
    return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

// ============================================
// 1b. GOOGLE CALENDAR SYNC
// ============================================
async function syncGoogleCalendar() {
    try {
        const response = await fetch(CALENDAR_SYNC_URL);
        const data = await response.json();

        if (!data.success || !data.events) {
            console.warn('Calendar sync: geen data ontvangen', data);
            return;
        }

        // Haal huidige availability op
        let avail = loadMap(STORAGE_KEYS.availability);
        let changed = false;

        // Verwijder oude "Studio agenda" entries die niet meer in de calendar staan
        const calendarDates = new Set(data.events.map(e => e.date));
        for (const dateStr in avail) {
            if (avail[dateStr].note && avail[dateStr].note.startsWith('Studio agenda') && !calendarDates.has(dateStr)) {
                // Event is verwijderd uit Google Calendar → verwijder uit dashboard
                delete avail[dateStr];
                changed = true;
            }
        }

        // Voeg nieuwe calendar events toe als niet-beschikbaar
        data.events.forEach(event => {
            const existing = avail[event.date];
            // Sla over als er al een boeking op die dag staat (bookedBy = huurder)
            if (existing && existing.bookedBy) return;
            // Sla over als admin handmatig een andere status heeft gezet (zonder "Studio agenda" note)
            if (existing && existing.note && !existing.note.startsWith('Studio agenda')) return;

            // Markeer als niet-beschikbaar met Studio agenda label
            if (!existing || existing.note?.startsWith('Studio agenda') || existing.status === 'beschikbaar' || !existing.status) {
                avail[event.date] = {
                    status: 'niet-beschikbaar',
                    note: 'Studio agenda: ' + event.title
                };
                changed = true;
            }
        });

        if (changed) {
            save(STORAGE_KEYS.availability, avail);
            availability = avail;
            renderCalendar();
        }

        console.log('Calendar sync voltooid:', data.events.length, 'events,', 'laatst gesynchroniseerd:', data.lastSync);
        showToast('Agenda gesynchroniseerd ✓');

    } catch (err) {
        console.error('Calendar sync fout:', err);
    }
}

// ============================================
// 1c. VASTE BEZETTING (donderdagen t/m 1 mei, vrijdagen t/m 1 april)
// ============================================
function applyVasteBezetting() {
    let avail = loadMap(STORAGE_KEYS.availability);
    let changed = false;

    // Hulpfunctie: genereer alle datums van een bepaalde weekdag binnen een bereik
    function getDaysOfWeek(dayOfWeek, startDate, endDateExclusive) {
        const dates = [];
        const current = new Date(startDate + 'T12:00:00');
        const end = new Date(endDateExclusive + 'T12:00:00');
        // Ga naar de eerste dag van de gewenste weekdag
        while (current.getDay() !== dayOfWeek) {
            current.setDate(current.getDate() + 1);
        }
        while (current < end) {
            dates.push(formatDateStr(current.getFullYear(), current.getMonth(), current.getDate()));
            current.setDate(current.getDate() + 7);
        }
        return dates;
    }

    // Donderdagen (weekdag 4) t/m 1 mei 2026 (= tot 2026-05-01)
    const donderdagen = getDaysOfWeek(4, '2026-02-27', '2026-05-01');
    // Vrijdagen (weekdag 5) t/m 1 april 2026 (= tot 2026-04-01)
    const vrijdagen = getDaysOfWeek(5, '2026-02-27', '2026-04-01');

    [...donderdagen, ...vrijdagen].forEach(dateStr => {
        const existing = avail[dateStr];
        // Sla over als er al een huurder-boeking is
        if (existing && existing.bookedBy) return;
        // Sla over als het al bezet is (niet overschrijven)
        if (existing && existing.status === 'niet-beschikbaar') return;

        avail[dateStr] = {
            status: 'niet-beschikbaar',
            note: 'Vaste bezetting'
        };
        changed = true;
    });

    if (changed) {
        save(STORAGE_KEYS.availability, avail);
        availability = avail;
    }
}

// ============================================
// 1d. FOTOSHOOT BESCHIKBAARHEID (fotoshoot data → oranje)
// ============================================
let fotoshootSlots = {};
let fotoshootBookings = [];

function applyFotoshootBeschikbaarheid() {
    fotoshootSlots = loadMap(STORAGE_KEYS.fotoshootSlots);
    fotoshootBookings = load(STORAGE_KEYS.fotoshootBookings);

    let avail = loadMap(STORAGE_KEYS.availability);
    let changed = false;

    // Verwijder oude fotoshoot entries die niet meer in slots staan
    for (const dateStr in avail) {
        if (avail[dateStr].note && avail[dateStr].note.startsWith('Fotoshoot') && !fotoshootSlots[dateStr]) {
            delete avail[dateStr];
            changed = true;
        }
    }

    // Voeg fotoshoot-dagen toe als oranje (check) in de kalender
    for (const dateStr in fotoshootSlots) {
        const existing = avail[dateStr];
        if (existing && existing.bookedBy) continue;
        if (existing && existing.status === 'niet-beschikbaar') continue;
        if (existing && existing.note && !existing.note.startsWith('Fotoshoot')) continue;

        const slot = fotoshootSlots[dateStr];
        const availTimes = getAvailableFotoshootTimes(dateStr, slot);

        if (availTimes.length > 0) {
            avail[dateStr] = {
                status: 'check',
                note: 'Fotoshoot beschikbaar'
            };
            changed = true;
        }
    }

    if (changed) {
        save(STORAGE_KEYS.availability, avail);
        availability = avail;
    }
}

// Bereken beschikbare tijdslots voor een dag
function generateTimeSlots(startTime, endTime) {
    const slots = [];
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const slotSize = FOTOSHOOT_DURATION + FOTOSHOOT_BUFFER; // 150 minuten

    for (let m = startMinutes; m + FOTOSHOOT_DURATION <= endMinutes; m += slotSize) {
        const h = Math.floor(m / 60);
        const min = m % 60;
        slots.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
    }
    return slots;
}

// Welke tijdslots zijn nog beschikbaar (niet geboekt)?
function getAvailableFotoshootTimes(dateStr, slot) {
    if (!slot) return [];
    const bookedTimes = fotoshootBookings
        .filter(b => b.date === dateStr)
        .map(b => b.time);
    return slot.times.filter(t => !bookedTimes.includes(t));
}

// ============================================
// 1e. FOTOSHOOTS ADMIN BEHEER
// ============================================
function addFotoshootDay() {
    const dateInput = document.getElementById('fs-date');
    const startInput = document.getElementById('fs-start');
    const endInput = document.getElementById('fs-end');

    const dateStr = dateInput.value;
    const startTime = startInput.value;
    const endTime = endInput.value;

    if (!dateStr) { showToast('Kies een datum', 'error'); return; }
    if (!startTime || !endTime) { showToast('Vul start- en eindtijd in', 'error'); return; }
    if (dateStr < todayStr()) { showToast('Datum moet in de toekomst liggen', 'error'); return; }

    const times = generateTimeSlots(startTime, endTime);
    if (times.length === 0) {
        showToast('Geen tijdslots mogelijk in dit tijdvenster', 'error');
        return;
    }

    fotoshootSlots[dateStr] = { times, startTime, endTime };
    save(STORAGE_KEYS.fotoshootSlots, fotoshootSlots);

    // Update kalender beschikbaarheid
    applyFotoshootBeschikbaarheid();
    renderCalendar();
    renderFotoshootAdmin();

    dateInput.value = '';
    showToast(`${times.length} tijdslot(s) toegevoegd voor ${formatDateNL(dateStr)}`, 'success');
}

function removeFotoshootDay(dateStr) {
    delete fotoshootSlots[dateStr];
    save(STORAGE_KEYS.fotoshootSlots, fotoshootSlots);

    // Verwijder fotoshoot-status uit kalender
    if (availability[dateStr] && availability[dateStr].note?.startsWith('Fotoshoot')) {
        delete availability[dateStr];
        save(STORAGE_KEYS.availability, availability);
    }

    renderCalendar();
    renderFotoshootAdmin();
    showToast('Fotoshoot-dag verwijderd');
}

function cancelFotoshootBooking(bookingId) {
    fotoshootBookings = fotoshootBookings.filter(b => b.id !== bookingId);
    save(STORAGE_KEYS.fotoshootBookings, fotoshootBookings);
    applyFotoshootBeschikbaarheid();
    renderCalendar();
    renderFotoshootAdmin();
    showToast('Boeking geannuleerd, tijdslot weer beschikbaar');
}

function renderFotoshootAdmin() {
    // Render beschikbare dagen
    const slotsContainer = document.getElementById('fs-slots-container');
    if (!slotsContainer) return;
    slotsContainer.innerHTML = '';

    const sortedDates = Object.keys(fotoshootSlots).sort();
    if (sortedDates.length === 0) {
        slotsContainer.innerHTML = '<div class="empty-state"><p>Geen fotoshoot-dagen ingesteld</p><span>Voeg een dag toe met het formulier hierboven</span></div>';
    } else {
        sortedDates.forEach(dateStr => {
            const slot = fotoshootSlots[dateStr];
            const bookedTimes = fotoshootBookings.filter(b => b.date === dateStr).map(b => b.time);

            const el = document.createElement('div');
            el.className = 'fs-day-card';
            el.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <h4>${formatDateNL(dateStr)}</h4>
                    <button class="btn-danger btn-small" data-remove-fs="${dateStr}">Verwijderen</button>
                </div>
                <div class="fs-times">
                    ${slot.times.map(t => {
                        const endH = Math.floor((parseInt(t.split(':')[0]) * 60 + parseInt(t.split(':')[1]) + FOTOSHOOT_DURATION) / 60);
                        const endM = (parseInt(t.split(':')[0]) * 60 + parseInt(t.split(':')[1]) + FOTOSHOOT_DURATION) % 60;
                        const endStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
                        const isBooked = bookedTimes.includes(t);
                        return `<span class="fs-time-chip ${isBooked ? 'booked' : ''}">${t} – ${endStr}${isBooked ? ' (geboekt)' : ''}</span>`;
                    }).join('')}
                </div>
            `;
            slotsContainer.appendChild(el);
        });

        slotsContainer.querySelectorAll('[data-remove-fs]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (confirm('Fotoshoot-dag verwijderen? Bestaande boekingen blijven bewaard.')) {
                    removeFotoshootDay(btn.dataset.removeFs);
                }
            });
        });
    }

    // Render boekingen
    const bookingsContainer = document.getElementById('fs-bookings-container');
    if (!bookingsContainer) return;

    const sortedBookings = [...fotoshootBookings].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

    if (sortedBookings.length === 0) {
        bookingsContainer.innerHTML = '<div class="empty-state"><p>Nog geen fotoshoot-boekingen</p></div>';
    } else {
        bookingsContainer.innerHTML = sortedBookings.map(b => `
            <div class="fs-booking-item">
                <div class="fs-booking-header">
                    <strong>${formatDateNL(b.date)} om ${b.time}</strong>
                    ${b.date >= todayStr() ? `<button class="btn-danger btn-small" data-cancel-fs="${b.id}">Annuleren</button>` : ''}
                </div>
                <div class="fs-booking-details">
                    <strong>${b.name}</strong> &middot; ${b.persons} persoon/personen<br>
                    ${b.email} &middot; ${b.phone}<br>
                    ${b.remark ? `<em>${b.remark}</em>` : ''}
                </div>
            </div>
        `).join('');

        bookingsContainer.querySelectorAll('[data-cancel-fs]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (confirm('Fotoshoot-boeking annuleren?')) {
                    cancelFotoshootBooking(btn.dataset.cancelFs);
                }
            });
        });
    }
}

// ============================================
// 2. STATE
// ============================================
let currentSession = null;
let users = [];
let availability = {};
let bookings = [];
let strippenkaarten = [];
let vasteHuur = [];
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let selectedAvailDate = null;
let selectedBookDate = null;

// ============================================
// 3. AUTH
// ============================================
function seedDefaultAdmin() {
    let u = load(STORAGE_KEYS.users);
    if (u.length === 0) {
        u = [{
            id: 'admin_001',
            username: 'admin',
            password: 'admin123',
            role: 'admin',
            naam: 'Beheerder'
        }];
        save(STORAGE_KEYS.users, u);
    }
    return u;
}

function initAuth() {
    users = seedDefaultAdmin();
    availability = loadMap(STORAGE_KEYS.availability);
    bookings = load(STORAGE_KEYS.bookings);
    strippenkaarten = load(STORAGE_KEYS.strippenkaarten);
    vasteHuur = load(STORAGE_KEYS.vasteHuur);

    checkExpiredCards();

    const session = loadObj(STORAGE_KEYS.session);
    if (session) {
        currentSession = session;
        startApp();
    } else {
        showLogin();
    }
}

function showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
}

function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    const user = users.find(u => u.username.toLowerCase() === username && u.password === password);

    if (user) {
        currentSession = { userId: user.id, role: user.role, naam: user.naam };
        save(STORAGE_KEYS.session, currentSession);
        document.getElementById('login-error').classList.add('hidden');
        startApp();
    } else {
        document.getElementById('login-error').classList.remove('hidden');
    }
}

function handleLogout() {
    localStorage.removeItem(STORAGE_KEYS.session);
    currentSession = null;
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
}

// ============================================
// 4. APP INITIALIZATION
// ============================================
function startApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');

    // Update header
    document.getElementById('user-display').textContent = currentSession.naam;

    // Filter nav + sections by role
    const role = currentSession.role;
    document.querySelectorAll('.nav-btn[data-role]').forEach(btn => {
        if (btn.dataset.role === role) {
            btn.classList.remove('hidden');
        } else {
            btn.classList.add('hidden');
        }
    });

    document.querySelectorAll('.section[data-role]').forEach(sec => {
        if (sec.dataset.role !== role) {
            sec.classList.add('hidden');
        }
    });

    // Show/hide role-specific wrappers
    document.querySelectorAll('.admin-only').forEach(el => {
        el.classList.toggle('hidden', role !== 'admin');
    });
    document.querySelectorAll('.huurder-only').forEach(el => {
        el.classList.toggle('hidden', role !== 'huurder');
    });

    // Reset to agenda tab
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const agendaBtn = document.querySelector('.nav-btn[data-section="agenda"]');
    if (agendaBtn) agendaBtn.classList.add('active');
    document.querySelectorAll('.section').forEach(s => {
        if (s.id !== 'agenda' && !s.classList.contains('hidden')) {
            s.classList.add('hidden');
        }
    });
    document.getElementById('agenda').classList.remove('hidden');

    // Render everything
    renderCalendar();
    if (role === 'admin') {
        renderStrippenkaarten();
        renderFotoshootAdmin();
        renderHuurders();
    } else {
        renderMijnStrippenkaart();
        renderContract();
    }

    // Vaste bezetting toepassen (donderdagen/vrijdagen)
    applyVasteBezetting();
    // Fotoshoot beschikbaarheid toepassen (oranje)
    applyFotoshootBeschikbaarheid();
    // Automatisch synchroniseren met Google Calendar
    syncGoogleCalendar();
}

// ============================================
// 5. NAVIGATION
// ============================================
function setupNavigation() {
    document.getElementById('main-nav').addEventListener('click', (e) => {
        const btn = e.target.closest('.nav-btn');
        if (!btn || btn.classList.contains('hidden')) return;

        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const target = btn.dataset.section;
        document.querySelectorAll('.section').forEach(s => {
            if (s.id === target) {
                s.classList.remove('hidden');
            } else {
                s.classList.add('hidden');
            }
        });
    });
}

// ============================================
// 6. CALENDAR
// ============================================
function getStatus(dateStr) {
    const entry = availability[dateStr];
    if (!entry) return 'beschikbaar';
    return entry.status || 'beschikbaar';
}

function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const label = document.getElementById('month-label');
    grid.innerHTML = '';

    label.textContent = `${MONTHS_NL[currentMonth]} ${currentYear}`;

    // First day of month (0=Sun, convert to Mon=0)
    const firstDay = new Date(currentYear, currentMonth, 1);
    const startWeekday = (firstDay.getDay() + 6) % 7; // Mon=0

    // Days in month
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    // Days in previous month
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

    const today = todayStr();

    // Padding from previous month
    for (let i = startWeekday - 1; i >= 0; i--) {
        const day = daysInPrevMonth - i;
        const el = document.createElement('div');
        el.className = 'cal-day cal-day-outside';
        el.innerHTML = `<span class="cal-day-number">${day}</span>`;
        grid.appendChild(el);
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = formatDateStr(currentYear, currentMonth, d);
        const status = getStatus(dateStr);
        const isPast = dateStr < today;
        const isToday = dateStr === today;

        const el = document.createElement('div');
        el.className = `cal-day status-${status}`;
        if (isPast) el.classList.add('cal-day-past');
        if (isToday) el.classList.add('cal-day-today');
        el.dataset.date = dateStr;

        // Check if booked and show name
        const booking = bookings.find(b => b.date === dateStr);
        let bookedHtml = '';
        if (booking && currentSession.role === 'admin') {
            bookedHtml = `<span class="cal-day-booked">${booking.userName}</span>`;
        } else if (booking && booking.userId === currentSession.userId) {
            bookedHtml = `<span class="cal-day-booked">Mijn boeking</span>`;
        }

        const statusLabels = {
            'beschikbaar': 'Beschikbaar',
            'check': 'Check',
            'niet-beschikbaar': 'Bezet'
        };

        el.innerHTML = `
            <span class="cal-day-number">${d}</span>
            <span class="cal-day-label">${statusLabels[status]}</span>
            ${bookedHtml}
        `;

        if (!isPast) {
            el.addEventListener('click', () => handleDayClick(dateStr));
        }

        grid.appendChild(el);
    }

    // Trailing padding
    const totalCells = startWeekday + daysInMonth;
    const remainder = totalCells % 7;
    if (remainder > 0) {
        for (let i = 1; i <= 7 - remainder; i++) {
            const el = document.createElement('div');
            el.className = 'cal-day cal-day-outside';
            el.innerHTML = `<span class="cal-day-number">${i}</span>`;
            grid.appendChild(el);
        }
    }

    // Render bookings list
    renderBookingsList();
}

function handleDayClick(dateStr) {
    if (currentSession.role === 'admin') {
        openAvailabilityModal(dateStr);
    } else {
        handleHuurderDayClick(dateStr);
    }
}

// ============================================
// 7. ADMIN: AVAILABILITY MANAGEMENT
// ============================================
function openAvailabilityModal(dateStr) {
    selectedAvailDate = dateStr;
    const modal = document.getElementById('availability-modal');
    document.getElementById('avail-date-display').textContent = formatDateNL(dateStr);

    const currentStatus = getStatus(dateStr);
    const entry = availability[dateStr];

    // Set selected button
    modal.querySelectorAll('.avail-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.status === currentStatus);
    });

    document.getElementById('avail-note').value = (entry && entry.note) || '';
    modal.classList.remove('hidden');
}

function saveAvailability() {
    const modal = document.getElementById('availability-modal');
    const selectedBtn = modal.querySelector('.avail-btn.selected');
    if (!selectedBtn) return;

    const status = selectedBtn.dataset.status;
    const note = document.getElementById('avail-note').value.trim();

    if (status === 'beschikbaar' && !note) {
        // Remove entry to save space (default = green)
        delete availability[selectedAvailDate];
    } else {
        availability[selectedAvailDate] = { status, note };
    }

    save(STORAGE_KEYS.availability, availability);
    modal.classList.add('hidden');
    renderCalendar();
    showToast('Beschikbaarheid bijgewerkt');
}

// ============================================
// 8. HUURDER: BOOKING FLOW
// ============================================
function handleHuurderDayClick(dateStr) {
    const status = getStatus(dateStr);

    if (status === 'niet-beschikbaar') {
        showToast('Deze dag is niet beschikbaar', 'error');
        return;
    }

    if (status === 'check') {
        showToast('Neem contact op met de beheerder om beschikbaarheid te checken', 'error');
        return;
    }

    // Status = beschikbaar → try to book
    openBookingConfirm(dateStr);
}

function getValidStrippenkaart(userId) {
    const today = todayStr();
    return strippenkaarten
        .filter(sk =>
            sk.userId === userId &&
            sk.active &&
            sk.usedStrips < sk.totalStrips &&
            sk.expiryDate >= today
        )
        .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))[0] || null;
}

function openBookingConfirm(dateStr) {
    selectedBookDate = dateStr;
    const modal = document.getElementById('booking-confirm-modal');
    const infoDiv = document.getElementById('booking-strip-info');
    const confirmBtn = document.getElementById('booking-confirm');

    document.getElementById('booking-date-display').textContent = formatDateNL(dateStr);

    const card = getValidStrippenkaart(currentSession.userId);

    if (!card) {
        infoDiv.innerHTML = `<p class="no-card">Je hebt geen geldige strippenkaart.<br>Neem contact op met de beheerder.</p>`;
        confirmBtn.classList.add('hidden');
    } else {
        const remaining = card.totalStrips - card.usedStrips;
        const dLeft = daysUntil(card.expiryDate);
        let warningHtml = '';
        if (remaining === 1) {
            warningHtml = '<p class="warning-text">Dit is je laatste strip!</p>';
        }
        if (dLeft <= 7 && dLeft > 0) {
            warningHtml += `<p class="warning-text">Je strippenkaart verloopt over ${dLeft} dag${dLeft === 1 ? '' : 'en'}!</p>`;
        }

        infoDiv.innerHTML = `
            <p>Strippenkaart: <span class="strip-count">${remaining} van ${card.totalStrips}</span> strippen over</p>
            <p class="expiry">Geldig tot ${formatDateNL(card.expiryDate)}</p>
            ${warningHtml}
        `;
        confirmBtn.classList.remove('hidden');
    }

    modal.classList.remove('hidden');
}

function confirmBooking() {
    const card = getValidStrippenkaart(currentSession.userId);
    if (!card || !selectedBookDate) return;

    // Deduct strip
    card.usedStrips += 1;
    if (card.usedStrips >= card.totalStrips) {
        card.active = false;
    }
    save(STORAGE_KEYS.strippenkaarten, strippenkaarten);

    // Create booking
    const booking = {
        id: genId(),
        userId: currentSession.userId,
        userName: currentSession.naam,
        date: selectedBookDate,
        strippenkaartId: card.id,
        createdAt: new Date().toISOString()
    };
    bookings.push(booking);
    save(STORAGE_KEYS.bookings, bookings);

    // Update availability to red
    availability[selectedBookDate] = {
        status: 'niet-beschikbaar',
        note: `Geboekt door ${currentSession.naam}`,
        bookedBy: currentSession.userId
    };
    save(STORAGE_KEYS.availability, availability);

    document.getElementById('booking-confirm-modal').classList.add('hidden');
    renderCalendar();
    renderMijnStrippenkaart();
    showToast('Boeking bevestigd! 1 strip afgeschreven.', 'success');
}

function cancelBooking(bookingId) {
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    const daysBeforeBooking = daysUntil(booking.date);
    const isKosteloos = daysBeforeBooking >= 7;

    // Alleen strip herstellen als annulering >= 1 week van tevoren
    if (isKosteloos) {
        const card = strippenkaarten.find(sk => sk.id === booking.strippenkaartId);
        if (card) {
            card.usedStrips = Math.max(0, card.usedStrips - 1);
            if (card.expiryDate >= todayStr() && card.usedStrips < card.totalStrips) {
                card.active = true;
            }
            save(STORAGE_KEYS.strippenkaarten, strippenkaarten);
        }
    }

    // Dag altijd weer beschikbaar maken
    if (availability[booking.date] && availability[booking.date].bookedBy) {
        delete availability[booking.date];
        save(STORAGE_KEYS.availability, availability);
    }

    // Remove booking
    bookings = bookings.filter(b => b.id !== bookingId);
    save(STORAGE_KEYS.bookings, bookings);

    renderCalendar();
    if (currentSession.role === 'huurder') {
        renderMijnStrippenkaart();
    }

    if (isKosteloos) {
        showToast('Boeking geannuleerd, strip hersteld');
    } else {
        showToast('Boeking geannuleerd. De strip is verloren (minder dan 1 week van tevoren).', 'error');
    }
}

function renderBookingsList() {
    // Admin: all bookings this month
    const adminList = document.getElementById('bookings-list');
    if (adminList && currentSession.role === 'admin') {
        const monthBookings = bookings
            .filter(b => {
                const d = new Date(b.date + 'T12:00:00');
                return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
            })
            .sort((a, b) => a.date.localeCompare(b.date));

        if (monthBookings.length === 0) {
            adminList.innerHTML = '<p class="empty-state"><span>Geen boekingen deze maand</span></p>';
        } else {
            adminList.innerHTML = monthBookings.map(b => `
                <div class="booking-item">
                    <div>
                        <span class="booking-item-date">${formatDateNL(b.date)}</span>
                        <span class="booking-item-name"> &mdash; ${b.userName}</span>
                    </div>
                    ${b.date >= todayStr() ? `<button class="btn-danger" data-cancel="${b.id}">Annuleren</button>` : ''}
                </div>
            `).join('');

            adminList.querySelectorAll('[data-cancel]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const booking = bookings.find(b => b.id === btn.dataset.cancel);
                    const dagen = booking ? daysUntil(booking.date) : 0;
                    const msg = dagen >= 7
                        ? 'Boeking annuleren? De strip wordt hersteld (meer dan 1 week van tevoren).'
                        : 'Boeking annuleren? Let op: de strip gaat verloren (minder dan 1 week van tevoren).';
                    if (confirm(msg)) {
                        cancelBooking(btn.dataset.cancel);
                    }
                });
            });
        }
    }

    // Huurder: my bookings
    const myList = document.getElementById('my-bookings-list');
    if (myList && currentSession.role === 'huurder') {
        const myBookings = bookings
            .filter(b => b.userId === currentSession.userId)
            .sort((a, b) => a.date.localeCompare(b.date));

        if (myBookings.length === 0) {
            myList.innerHTML = '<p class="empty-state"><span>Je hebt nog geen boekingen</span></p>';
        } else {
            myList.innerHTML = myBookings.map(b => `
                <div class="booking-item">
                    <span class="booking-item-date">${formatDateNL(b.date)}</span>
                    ${b.date >= todayStr() ? `<button class="btn-danger" data-cancel="${b.id}">Annuleren</button>` : ''}
                </div>
            `).join('');

            myList.querySelectorAll('[data-cancel]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const booking = bookings.find(b => b.id === btn.dataset.cancel);
                    const dagen = booking ? daysUntil(booking.date) : 0;
                    const msg = dagen >= 7
                        ? 'Boeking annuleren? Je strip wordt hersteld (meer dan 1 week van tevoren).'
                        : 'Boeking annuleren? Let op: je strip gaat verloren omdat het minder dan 1 week van tevoren is.';
                    if (confirm(msg)) {
                        cancelBooking(btn.dataset.cancel);
                    }
                });
            });
        }
    }
}

// ============================================
// 9. STRIPPENKAART
// ============================================
function checkExpiredCards() {
    const today = todayStr();
    let changed = false;
    strippenkaarten.forEach(sk => {
        if (sk.active && sk.expiryDate < today) {
            sk.active = false;
            changed = true;
        }
    });
    if (changed) save(STORAGE_KEYS.strippenkaarten, strippenkaarten);
}

// Admin view
function renderStrippenkaarten() {
    const container = document.getElementById('cards-container');
    if (!container) return;
    container.innerHTML = '';

    if (strippenkaarten.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>Nog geen strippenkaarten</p><span>Maak een strippenkaart aan voor een huurder</span></div>`;
        return;
    }

    // Sort: active first, then by expiry
    const sorted = [...strippenkaarten].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.expiryDate.localeCompare(b.expiryDate);
    });

    sorted.forEach(card => {
        const remaining = card.totalStrips - card.usedStrips;
        let statusClass, statusText;
        if (!card.active && card.expiryDate < todayStr()) {
            statusClass = 'expired';
            statusText = 'Verlopen';
        } else if (!card.active && card.usedStrips >= card.totalStrips) {
            statusClass = 'used-up';
            statusText = 'Opgebruikt';
        } else if (card.active) {
            statusClass = 'active';
            statusText = 'Actief';
        } else {
            statusClass = 'expired';
            statusText = 'Inactief';
        }

        const el = document.createElement('div');
        el.className = 'strip-card';
        el.innerHTML = `
            <div class="strip-card-header">
                <h4>${card.userName}</h4>
                <span class="status-badge ${statusClass}">${statusText}</span>
            </div>
            <div class="strip-card-meta">
                Gestart: ${formatDateNL(card.startDate)}<br>
                Verloopt: ${formatDateNL(card.expiryDate)}
            </div>
            <div class="strips-visual">
                ${Array.from({ length: card.totalStrips }, (_, i) =>
                    `<div class="strip ${i < card.usedStrips ? 'used' : ''}"></div>`
                ).join('')}
            </div>
            <div class="strip-card-footer">
                <span>${card.usedStrips} / ${card.totalStrips} gebruikt</span>
                <button class="btn-danger" data-delete-card="${card.id}">Verwijderen</button>
            </div>
        `;
        container.appendChild(el);
    });

    container.querySelectorAll('[data-delete-card]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm('Strippenkaart verwijderen?')) {
                strippenkaarten = strippenkaarten.filter(c => c.id !== btn.dataset.deleteCard);
                save(STORAGE_KEYS.strippenkaarten, strippenkaarten);
                renderStrippenkaarten();
                showToast('Strippenkaart verwijderd');
            }
        });
    });
}

// Huurder view
function renderMijnStrippenkaart() {
    const container = document.getElementById('my-cards-container');
    if (!container) return;
    container.innerHTML = '';

    const myCards = strippenkaarten.filter(sk => sk.userId === currentSession.userId);
    const activeCard = myCards.find(sk => sk.active && sk.expiryDate >= todayStr() && sk.usedStrips < sk.totalStrips);

    if (activeCard) {
        const remaining = activeCard.totalStrips - activeCard.usedStrips;
        const dLeft = daysUntil(activeCard.expiryDate);

        container.innerHTML = `
            <div class="my-card-hero">
                <h3>Actieve Strippenkaart</h3>
                <div class="big-count">${remaining}</div>
                <div class="big-label">strippen over van ${activeCard.totalStrips}</div>
                <div class="strips-visual">
                    ${Array.from({ length: activeCard.totalStrips }, (_, i) =>
                        `<div class="strip ${i < activeCard.usedStrips ? 'used' : ''}"></div>`
                    ).join('')}
                </div>
                <div class="expiry-info">
                    Geldig tot ${formatDateNL(activeCard.expiryDate)}
                    ${dLeft <= 14 ? ` &middot; <strong>nog ${dLeft} dag${dLeft === 1 ? '' : 'en'}</strong>` : ''}
                </div>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="empty-state">
                <p>Geen actieve strippenkaart</p>
                <span>Neem contact op met de beheerder voor een nieuwe strippenkaart</span>
            </div>
        `;
    }

    // Show past/expired cards
    const pastCards = myCards.filter(sk => sk !== activeCard);
    if (pastCards.length > 0) {
        const historyHtml = pastCards.map(card => {
            let statusText = 'Verlopen';
            if (card.usedStrips >= card.totalStrips) statusText = 'Opgebruikt';
            return `
                <div class="booking-item">
                    <div>
                        <span class="booking-item-date">${card.usedStrips}/${card.totalStrips} gebruikt</span>
                        <span class="booking-item-name"> &mdash; ${statusText} &mdash; ${formatDateNL(card.startDate)}</span>
                    </div>
                </div>
            `;
        }).join('');
        container.innerHTML += `<h3 style="margin-top:2rem">Geschiedenis</h3>${historyHtml}`;
    }
}

function openCardModal() {
    const modal = document.getElementById('card-modal');
    const select = document.getElementById('card-huurder');
    select.innerHTML = '';

    const huurders = users.filter(u => u.role === 'huurder');
    if (huurders.length === 0) {
        select.innerHTML = '<option value="">Geen huurders beschikbaar</option>';
    } else {
        huurders.forEach(h => {
            select.innerHTML += `<option value="${h.id}">${h.naam}</option>`;
        });
    }

    document.getElementById('card-start').value = todayStr();
    modal.classList.remove('hidden');
}

function createStrippenkaart(e) {
    e.preventDefault();
    const userId = document.getElementById('card-huurder').value;
    if (!userId) return;

    const user = users.find(u => u.id === userId);
    const startDate = document.getElementById('card-start').value;

    const card = {
        id: genId(),
        userId,
        userName: user.naam,
        totalStrips: 5,
        usedStrips: 0,
        startDate,
        expiryDate: addMonths(startDate, 3),
        active: true
    };

    strippenkaarten.push(card);
    save(STORAGE_KEYS.strippenkaarten, strippenkaarten);
    document.getElementById('card-modal').classList.add('hidden');
    renderStrippenkaarten();
    showToast(`Strippenkaart aangemaakt voor ${user.naam}`, 'success');
}

// ============================================
// 11. HUURDERS MANAGEMENT (admin)
// ============================================
function renderHuurders() {
    const container = document.getElementById('huurders-container');
    if (!container) return;
    container.innerHTML = '';

    const huurders = users.filter(u => u.role === 'huurder');

    if (huurders.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>Nog geen huurders</p><span>Maak een huurder account aan</span></div>`;
        return;
    }

    huurders.forEach(h => {
        const activeCard = strippenkaarten.find(sk =>
            sk.userId === h.id && sk.active && sk.expiryDate >= todayStr() && sk.usedStrips < sk.totalStrips
        );
        const bookingCount = bookings.filter(b => b.userId === h.id).length;

        const el = document.createElement('div');
        el.className = 'huurder-card';
        el.innerHTML = `
            <div class="huurder-card-header">
                <h4>${h.naam}</h4>
                <button class="btn-danger" data-delete-huurder="${h.id}">Verwijderen</button>
            </div>
            <div class="detail"><strong>Gebruikersnaam:</strong> ${h.username}</div>
            <div class="detail"><strong>Wachtwoord:</strong> ${h.password}</div>
            ${h.bedrijf ? `<div class="detail"><strong>Bedrijf:</strong> ${h.bedrijf}</div>` : ''}
            ${h.adres ? `<div class="detail"><strong>Adres:</strong> ${h.adres}</div>` : ''}
            ${h.kvk ? `<div class="detail"><strong>KVK:</strong> ${h.kvk}</div>` : ''}
            <div class="detail"><strong>Strippenkaart:</strong> ${activeCard ? `${activeCard.totalStrips - activeCard.usedStrips} strippen over` : 'Geen actieve kaart'}</div>
            <div class="detail"><strong>Boekingen:</strong> ${bookingCount}</div>
        `;
        container.appendChild(el);
    });

    container.querySelectorAll('[data-delete-huurder]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm('Huurder verwijderen? Dit verwijdert ook hun boekingen en strippenkaarten.')) {
                const id = btn.dataset.deleteHuurder;
                users = users.filter(u => u.id !== id);
                save(STORAGE_KEYS.users, users);

                // Clean up bookings
                const userBookings = bookings.filter(b => b.userId === id);
                userBookings.forEach(b => {
                    if (availability[b.date] && availability[b.date].bookedBy === id) {
                        delete availability[b.date];
                    }
                });
                bookings = bookings.filter(b => b.userId !== id);
                save(STORAGE_KEYS.bookings, bookings);
                save(STORAGE_KEYS.availability, availability);

                strippenkaarten = strippenkaarten.filter(sk => sk.userId !== id);
                save(STORAGE_KEYS.strippenkaarten, strippenkaarten);

                renderHuurders();
                renderStrippenkaarten();
                renderCalendar();
                showToast('Huurder verwijderd');
            }
        });
    });
}

function createHuurder(e) {
    e.preventDefault();
    const naam = document.getElementById('huurder-naam').value.trim();
    const bedrijf = document.getElementById('huurder-bedrijf').value.trim();
    const adres = document.getElementById('huurder-adres').value.trim();
    const kvk = document.getElementById('huurder-kvk').value.trim();
    const username = document.getElementById('huurder-username').value.trim().toLowerCase();
    const password = document.getElementById('huurder-password').value;

    // Check unique username
    if (users.find(u => u.username.toLowerCase() === username)) {
        showToast('Gebruikersnaam bestaat al', 'error');
        return;
    }

    const user = {
        id: genId(),
        username,
        password,
        role: 'huurder',
        naam,
        bedrijf,
        adres,
        kvk
    };
    users.push(user);
    save(STORAGE_KEYS.users, users);
    document.getElementById('huurder-modal').classList.add('hidden');
    document.getElementById('huurder-form').reset();
    renderHuurders();
    showToast(`Huurder ${naam} aangemaakt`, 'success');
}

// ============================================
// 12. UI UTILITIES
// ============================================
let toastTimeout = null;

function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast';
    if (type) toast.classList.add(`toast-${type}`);
    toast.classList.remove('hidden');

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

// ============================================
// 12b. CONTRACT
// ============================================
function renderContract() {
    const huurderNaam = document.getElementById('contract-huurder-naam');
    if (!huurderNaam) return;

    // Zoek de volledige gebruikersgegevens op
    const huurder = users.find(u => u.id === currentSession?.userId);

    // Vul huurder naam in het contract
    if (currentSession) {
        huurderNaam.textContent = currentSession.naam || '_______________';
    }

    // Vul bedrijfsgegevens in het contract
    const bedrijfTekst = document.getElementById('contract-huurder-bedrijf-tekst');
    const adresTekst = document.getElementById('contract-huurder-adres-tekst');
    const kvkTekst = document.getElementById('contract-huurder-kvk-tekst');

    if (bedrijfTekst) {
        bedrijfTekst.textContent = huurder?.bedrijf ? `, handelend onder de naam ${huurder.bedrijf}` : '';
    }
    if (adresTekst) {
        adresTekst.textContent = huurder?.adres ? `, gevestigd aan de ${huurder.adres}` : '';
    }
    if (kvkTekst) {
        kvkTekst.textContent = huurder?.kvk ? `, ingeschreven bij de Kamer van Koophandel onder nummer ${huurder.kvk}` : '';
    }

    // Check of contract al ondertekend is
    const signatures = loadMap('sv_signatures');
    const mySignature = signatures[currentSession?.userId];

    if (mySignature) {
        // Toon ondertekend banner
        document.getElementById('contract-signed-banner').classList.remove('hidden');
        document.getElementById('contract-signed-date').textContent = formatDateNL(mySignature.date);

        // Verberg formulier, toon resultaat
        document.getElementById('contract-sign-form').classList.add('hidden');
        const result = document.getElementById('contract-signed-result');
        result.classList.remove('hidden');
        document.getElementById('signed-name-display').textContent = mySignature.name;
        document.getElementById('signed-date-display').textContent = formatDateNL(mySignature.date);
        document.getElementById('signed-place-display').textContent = mySignature.place;
    } else {
        document.getElementById('contract-signed-banner').classList.add('hidden');
        document.getElementById('contract-sign-form').classList.remove('hidden');
        document.getElementById('contract-signed-result').classList.add('hidden');
        // Stel datum in op vandaag
        document.getElementById('sign-date').value = todayStr();
    }
}

function signContract() {
    const name = document.getElementById('sign-name').value.trim();
    const date = document.getElementById('sign-date').value;
    const place = document.getElementById('sign-place').value.trim();
    const agree = document.getElementById('sign-agree').checked;

    if (!name) { showToast('Vul je naam in', 'error'); return; }
    if (!date) { showToast('Vul de datum in', 'error'); return; }
    if (!place) { showToast('Vul de plaats in', 'error'); return; }
    if (!agree) { showToast('Je moet akkoord gaan met de voorwaarden', 'error'); return; }

    const signatures = loadMap('sv_signatures');
    signatures[currentSession.userId] = {
        name: name,
        date: date,
        place: place,
        signedAt: new Date().toISOString(),
        userId: currentSession.userId
    };
    save('sv_signatures', signatures);

    renderContract();
    showToast('Contract ondertekend!', 'success');
}

// ============================================
// 13. EVENT LISTENERS
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    // Auth
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // Navigation
    setupNavigation();

    // Calendar nav
    document.getElementById('prev-month').addEventListener('click', () => {
        currentMonth--;
        if (currentMonth < 0) { currentMonth = 11; currentYear--; }
        renderCalendar();
    });
    document.getElementById('next-month').addEventListener('click', () => {
        currentMonth++;
        if (currentMonth > 11) { currentMonth = 0; currentYear++; }
        renderCalendar();
    });

    // Availability modal
    document.getElementById('availability-modal').querySelectorAll('.avail-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('availability-modal').querySelectorAll('.avail-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });
    document.getElementById('avail-save').addEventListener('click', saveAvailability);

    // Booking confirm
    document.getElementById('booking-confirm').addEventListener('click', confirmBooking);
    document.getElementById('booking-cancel-btn').addEventListener('click', () => {
        closeModal('booking-confirm-modal');
    });

    // Strippenkaart modal
    document.getElementById('add-card').addEventListener('click', openCardModal);
    document.getElementById('card-form').addEventListener('submit', createStrippenkaart);

    // Huurders
    document.getElementById('add-huurder').addEventListener('click', () => {
        document.getElementById('huurder-modal').classList.remove('hidden');
    });
    document.getElementById('huurder-form').addEventListener('submit', createHuurder);

    // Close modals on X or backdrop
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal').classList.add('hidden');
        });
    });
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });
    });

    // Contract ondertekenen
    const signBtn = document.getElementById('sign-contract-btn');
    if (signBtn) {
        signBtn.addEventListener('click', signContract);
    }

    // Fotoshoots admin
    const fsAddBtn = document.getElementById('fs-add-day');
    if (fsAddBtn) {
        fsAddBtn.addEventListener('click', addFotoshootDay);
    }
    const copyLinkBtn = document.getElementById('copy-fotoshoot-link');
    if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', () => {
            const link = document.getElementById('fotoshoot-public-link');
            const url = new URL('fotoshoot.html', window.location.href).href;
            navigator.clipboard.writeText(url).then(() => {
                showToast('Link gekopieerd!', 'success');
            });
        });
    }

    // Init
    initAuth();
});
