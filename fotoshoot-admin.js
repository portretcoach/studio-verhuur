// ============================================
// FOTOSHOOT ADMIN — PIN-beveiligd beheer
// ============================================
const STORAGE_KEYS = {
    fotoshootSlots: 'sv_fotoshoot_slots',
    fotoshootBookings: 'sv_fotoshoot_bookings',
    fotoshootPin: 'sv_fotoshoot_pin',
};

const DEFAULT_PIN = '1234';
const BOOKING_BLOCK_MINUTES = 150; // 2,5 uur blokkering na elke boeking

const MONTHS_NL = [
    'januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december'
];
const DAYS_NL = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

// ============================================
// HELPERS
// ============================================
function load(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
}

function loadMap(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; }
    catch { return {}; }
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

// ============================================
// STATE
// ============================================
let fotoshootSlots = {};
let fotoshootBookings = [];

// ============================================
// PIN LOGIN
// ============================================
function getPin() {
    return localStorage.getItem(STORAGE_KEYS.fotoshootPin) || DEFAULT_PIN;
}

function handlePinLogin(e) {
    e.preventDefault();
    const input = document.getElementById('pin-input').value;

    if (input === getPin()) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('admin-dashboard').classList.remove('hidden');
        document.getElementById('pin-error').classList.add('hidden');
        loadData();
        renderAll();
    } else {
        document.getElementById('pin-error').classList.remove('hidden');
        document.getElementById('pin-input').value = '';
        document.getElementById('pin-input').focus();
    }
}

function handleChangePin() {
    const newPin = document.getElementById('new-pin').value.trim();
    if (!newPin || newPin.length < 4) {
        showToast('PIN moet minimaal 4 tekens zijn', 'error');
        return;
    }
    localStorage.setItem(STORAGE_KEYS.fotoshootPin, newPin);
    document.getElementById('new-pin').value = '';
    showToast('PIN gewijzigd', 'success');
}

function handleLogout() {
    document.getElementById('admin-dashboard').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('pin-input').value = '';
}

// ============================================
// DATA
// ============================================
function loadData() {
    fotoshootSlots = loadMap(STORAGE_KEYS.fotoshootSlots);
    fotoshootBookings = load(STORAGE_KEYS.fotoshootBookings);
}

// ============================================
// HELPERS — tijd
// ============================================
function formatBlockEnd(time) {
    const [h, m] = time.split(':').map(Number);
    const endMinutes = h * 60 + m + BOOKING_BLOCK_MINUTES;
    const endH = Math.floor(endMinutes / 60);
    const endM = endMinutes % 60;
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

// ============================================
// ADMIN ACTIONS
// ============================================
function addFotoshootDay() {
    const dateStr = document.getElementById('fs-date').value;
    const startTime = document.getElementById('fs-start').value;
    const endTime = document.getElementById('fs-end').value;

    if (!dateStr) { showToast('Kies een datum', 'error'); return; }
    if (!startTime || !endTime) { showToast('Vul start- en eindtijd in', 'error'); return; }
    if (dateStr < todayStr()) { showToast('Datum moet in de toekomst liggen', 'error'); return; }
    if (startTime >= endTime) { showToast('Eindtijd moet na starttijd liggen', 'error'); return; }

    fotoshootSlots[dateStr] = { startTime, endTime };
    save(STORAGE_KEYS.fotoshootSlots, fotoshootSlots);

    document.getElementById('fs-date').value = '';
    renderAll();
    showToast(`Beschikbaar ${startTime}–${endTime} voor ${formatDateNL(dateStr)}`, 'success');
}

function removeFotoshootDay(dateStr) {
    if (!confirm(`Fotoshoot-dag ${formatDateNL(dateStr)} verwijderen?`)) return;
    delete fotoshootSlots[dateStr];
    save(STORAGE_KEYS.fotoshootSlots, fotoshootSlots);
    renderAll();
    showToast('Fotoshoot-dag verwijderd');
}

function cancelFotoshootBooking(bookingId) {
    if (!confirm('Fotoshoot-boeking annuleren?')) return;
    fotoshootBookings = fotoshootBookings.filter(b => b.id !== bookingId);
    save(STORAGE_KEYS.fotoshootBookings, fotoshootBookings);
    renderAll();
    showToast('Boeking geannuleerd, tijdslot weer beschikbaar');
}

// ============================================
// RENDER
// ============================================
function renderAll() {
    renderSlots();
    renderBookings();
}

function renderSlots() {
    const container = document.getElementById('fs-slots-container');
    container.innerHTML = '';

    const sortedDates = Object.keys(fotoshootSlots).sort();

    if (sortedDates.length === 0) {
        container.innerHTML = '<p class="admin-empty">Geen fotoshoot-dagen ingesteld. Voeg een dag toe hierboven.</p>';
        return;
    }

    sortedDates.forEach(dateStr => {
        const slot = fotoshootSlots[dateStr];
        const dayBookings = fotoshootBookings.filter(b => b.date === dateStr);
        const isPast = dateStr < todayStr();

        const el = document.createElement('div');
        el.className = 'admin-day-card';
        if (isPast) el.classList.add('past');

        const bookingChips = dayBookings.length > 0
            ? dayBookings.map(b => `<span class="admin-chip booked">${b.time} — ${b.name}</span>`).join('')
            : '<span class="admin-chip">Geen boekingen</span>';

        el.innerHTML = `
            <div class="admin-day-header">
                <h4>${formatDateNL(dateStr)}</h4>
                ${!isPast ? `<button class="btn-danger btn-small" data-remove="${dateStr}">Verwijderen</button>` : '<span class="past-label">Verlopen</span>'}
            </div>
            <p class="admin-availability">Beschikbaar ${slot.startTime} – ${slot.endTime}</p>
            <div class="admin-time-chips">${bookingChips}</div>
        `;
        container.appendChild(el);
    });

    container.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => removeFotoshootDay(btn.dataset.remove));
    });
}

function renderBookings() {
    const container = document.getElementById('fs-bookings-container');

    const sorted = [...fotoshootBookings].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

    if (sorted.length === 0) {
        container.innerHTML = '<p class="admin-empty">Nog geen fotoshoot-boekingen.</p>';
        return;
    }

    container.innerHTML = sorted.map(b => `
        <div class="admin-booking">
            <div class="admin-booking-header">
                <strong>${formatDateNL(b.date)} om ${b.time}</strong>
                <div class="admin-booking-actions">
                    ${b.code ? `<span class="admin-booking-code">${b.code}</span>` : ''}
                    ${b.date >= todayStr() ? `<button class="btn-danger btn-small" data-cancel="${b.id}">Annuleren</button>` : ''}
                </div>
            </div>
            <div class="admin-booking-details">
                <strong>${b.name}</strong><br>
                ${b.email} &middot; ${b.phone}
                ${b.remark ? `<br><em>${b.remark}</em>` : ''}
            </div>
        </div>
    `).join('');

    container.querySelectorAll('[data-cancel]').forEach(btn => {
        btn.addEventListener('click', () => cancelFotoshootBooking(btn.dataset.cancel));
    });
}

// ============================================
// TOAST
// ============================================
let toastTimeout = null;
function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast';
    if (type) toast.classList.add(`toast-${type}`);
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('pin-form').addEventListener('submit', handlePinLogin);
    document.getElementById('fs-add-day').addEventListener('click', addFotoshootDay);
    document.getElementById('change-pin').addEventListener('click', handleChangePin);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    document.getElementById('copy-link').addEventListener('click', () => {
        const url = new URL('fotoshoot.html', window.location.href).href;
        navigator.clipboard.writeText(url).then(() => {
            showToast('Link gekopieerd!', 'success');
        });
    });
});
