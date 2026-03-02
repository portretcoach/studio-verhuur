// ============================================
// FOTOSHOOT ADMIN — PIN-beveiligd beheer
// ============================================
const DEFAULT_PIN = '1234';
const BOOKING_BLOCK_MINUTES = 150;

const MONTHS_NL = [
    'januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december'
];
const DAYS_NL = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

// Google Apps Script API URL (centrale backend)
const API_URL = 'https://script.google.com/macros/s/AKfycbyaqHCzaUpebOEZovD8DMpWoOYSmtmEIQdPF8VmWQMvYAwAxvw1ZGkLJcfKqvDNY-gGoQ/exec';

// ============================================
// HELPERS
// ============================================
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
// API COMMUNICATIE
// ============================================

/**
 * Haal alle data op van de server
 */
async function loadDataFromServer() {
    try {
        const response = await fetch(API_URL + '?action=getData');
        const data = await response.json();

        if (data.success) {
            fotoshootSlots = data.slots || {};
            fotoshootBookings = data.bookings || [];
            return true;
        } else {
            console.error('Server fout:', data.error);
            return false;
        }
    } catch (err) {
        console.error('Kan data niet ophalen:', err);
        return false;
    }
}

/**
 * POST naar de server
 */
function apiPost(data) {
    return fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify(data)
    })
    .then(r => r.json())
    .catch(err => {
        console.error('API POST fout:', err);
        return fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify(data)
        }).then(() => ({ success: true, fallback: true }));
    });
}

// ============================================
// STATE
// ============================================
let fotoshootSlots = {};
let fotoshootBookings = [];
let adminPin = ''; // PIN die admin heeft ingevoerd

// ============================================
// LOADING STATE
// ============================================
function showLoading(show) {
    const loader = document.getElementById('loading-overlay');
    if (loader) {
        loader.classList.toggle('hidden', !show);
    }
}

// ============================================
// PIN LOGIN
// ============================================
async function handlePinLogin(e) {
    e.preventDefault();
    const input = document.getElementById('pin-input').value;

    // Bewaar PIN voor admin API calls
    adminPin = input;

    // Toon loading terwijl we data ophalen
    document.getElementById('pin-error').classList.add('hidden');
    showLoading(true);

    const success = await loadDataFromServer();
    showLoading(false);

    if (success) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('admin-dashboard').classList.remove('hidden');
        renderAll();
    } else {
        // Als server niet bereikbaar is, probeer local PIN check
        const localPin = localStorage.getItem('sv_fotoshoot_pin') || DEFAULT_PIN;
        if (input === localPin) {
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('admin-dashboard').classList.remove('hidden');
            showToast('Server niet bereikbaar — data kan verouderd zijn', 'error');
            renderAll();
        } else {
            document.getElementById('pin-error').classList.remove('hidden');
            document.getElementById('pin-input').value = '';
            document.getElementById('pin-input').focus();
        }
    }
}

async function handleChangePin() {
    const newPin = document.getElementById('new-pin').value.trim();
    if (!newPin || newPin.length < 4) {
        showToast('PIN moet minimaal 4 tekens zijn', 'error');
        return;
    }

    // Update op server
    const result = await apiPost({
        action: 'changePin',
        currentPin: adminPin,
        newPin: newPin
    });

    // Update lokaal
    localStorage.setItem('sv_fotoshoot_pin', newPin);
    adminPin = newPin;

    document.getElementById('new-pin').value = '';
    showToast('PIN gewijzigd', 'success');
}

function handleLogout() {
    document.getElementById('admin-dashboard').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('pin-input').value = '';
    adminPin = '';
}

// ============================================
// ADMIN ACTIONS
// ============================================
async function addFotoshootDay() {
    const dateStr = document.getElementById('fs-date').value;
    const startTime = document.getElementById('fs-start').value;
    const endTime = document.getElementById('fs-end').value;

    if (!dateStr) { showToast('Kies een datum', 'error'); return; }
    if (!startTime || !endTime) { showToast('Vul start- en eindtijd in', 'error'); return; }
    if (dateStr < todayStr()) { showToast('Datum moet in de toekomst liggen', 'error'); return; }
    if (startTime >= endTime) { showToast('Eindtijd moet na starttijd liggen', 'error'); return; }

    // Optimistic update
    fotoshootSlots[dateStr] = { startTime, endTime };
    renderAll();

    // Opslaan op server
    showLoading(true);
    await apiPost({
        action: 'addSlot',
        pin: adminPin,
        date: dateStr,
        startTime: startTime,
        endTime: endTime
    });

    // Herlaad data van server om in sync te blijven
    await loadDataFromServer();
    showLoading(false);
    renderAll();

    document.getElementById('fs-date').value = '';
    showToast(`Beschikbaar ${startTime}–${endTime} voor ${formatDateNL(dateStr)}`, 'success');
}

async function removeFotoshootDay(dateStr) {
    if (!confirm(`Fotoshoot-dag ${formatDateNL(dateStr)} verwijderen?`)) return;

    // Optimistic update
    delete fotoshootSlots[dateStr];
    renderAll();

    // Verwijderen op server
    showLoading(true);
    await apiPost({
        action: 'removeSlot',
        pin: adminPin,
        date: dateStr
    });

    await loadDataFromServer();
    showLoading(false);
    renderAll();
    showToast('Fotoshoot-dag verwijderd');
}

async function cancelFotoshootBooking(bookingCode) {
    if (!confirm('Fotoshoot-boeking annuleren?')) return;

    // Optimistic update
    fotoshootBookings = fotoshootBookings.filter(b => b.code !== bookingCode);
    renderAll();

    // Verwijderen op server
    showLoading(true);
    await apiPost({
        action: 'cancelBooking',
        code: bookingCode
    });

    await loadDataFromServer();
    showLoading(false);
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
                    ${b.date >= todayStr() ? `<button class="btn-danger btn-small" data-cancel="${b.code}">Annuleren</button>` : ''}
                </div>
            </div>
            <div class="admin-booking-details">
                <strong>${b.name}</strong><br>
                ${b.email} &middot; ${b.phone || '-'}
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
