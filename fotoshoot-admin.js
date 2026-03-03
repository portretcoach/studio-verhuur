// ============================================
// FOTOSHOOT ADMIN — Beheer zonder PIN
// ============================================
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
 * Haal alle data op van de server (GET)
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
 * Verwerk server response (slots + bookings bijwerken)
 * Server stuurt na elke POST de actuele data terug
 */
function applyServerData(data) {
    if (data && data.success) {
        fotoshootSlots = data.slots || {};
        fotoshootBookings = data.bookings || [];
        return true;
    }
    return false;
}

/**
 * POST naar de server — retourneert server response met actuele data
 * Geen no-cors fallback meer: als het faalt, tonen we een duidelijke fout
 */
async function apiPost(payload) {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        console.log('API response:', result);
        return result;
    } catch (err) {
        console.error('API POST fout:', err);
        return { success: false, error: 'Kon server niet bereiken: ' + err.message };
    }
}

// ============================================
// STATE
// ============================================
let fotoshootSlots = {};
let fotoshootBookings = [];

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
// STARTUP — direct laden, geen login
// ============================================
async function startup() {
    showLoading(true);
    const success = await loadDataFromServer();
    showLoading(false);

    document.getElementById('admin-dashboard').classList.remove('hidden');

    if (success) {
        renderAll();
    } else {
        showToast('Server niet bereikbaar — probeer de pagina te herladen', 'error');
    }
}

// ============================================
// ADMIN ACTIONS
// ============================================
let editingDate = null;

function startEditSlot(dateStr) {
    const slot = fotoshootSlots[dateStr];
    if (!slot) return;

    editingDate = dateStr;
    document.getElementById('fs-date').value = dateStr;
    document.getElementById('fs-start').value = slot.startTime;
    document.getElementById('fs-end').value = slot.endTime;
    document.getElementById('fs-add-day').textContent = 'Wijziging opslaan';
    document.getElementById('fs-date').disabled = true;
    document.getElementById('fs-cancel-edit').classList.remove('hidden');

    document.getElementById('fs-date').closest('.admin-add-form').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
    editingDate = null;
    document.getElementById('fs-date').value = '';
    document.getElementById('fs-start').value = '10:00';
    document.getElementById('fs-end').value = '17:00';
    document.getElementById('fs-add-day').textContent = '+ Dag toevoegen';
    document.getElementById('fs-date').disabled = false;
    document.getElementById('fs-cancel-edit').classList.add('hidden');
}

async function addFotoshootDay() {
    const dateStr = editingDate || document.getElementById('fs-date').value;
    const startTime = document.getElementById('fs-start').value;
    const endTime = document.getElementById('fs-end').value;
    const isEdit = !!editingDate;

    if (!dateStr) { showToast('Kies een datum', 'error'); return; }
    if (!startTime || !endTime) { showToast('Vul start- en eindtijd in', 'error'); return; }
    if (!isEdit && dateStr < todayStr()) { showToast('Datum moet in de toekomst liggen', 'error'); return; }
    if (startTime >= endTime) { showToast('Eindtijd moet na starttijd liggen', 'error'); return; }

    cancelEdit();
    showLoading(true);

    const result = await apiPost({
        action: 'addSlot',
        date: dateStr,
        startTime: startTime,
        endTime: endTime
    });

    showLoading(false);

    if (applyServerData(result)) {
        renderAll();
        if (fotoshootSlots[dateStr]) {
            showToast(isEdit
                ? `Tijden gewijzigd naar ${startTime}–${endTime}`
                : `Beschikbaar ${startTime}–${endTime} voor ${formatDateNL(dateStr)}`,
                'success');
        } else {
            showToast('Opslaan lijkt niet gelukt — probeer opnieuw', 'error');
        }
    } else {
        showToast(`Opslaan mislukt: ${result.error || 'onbekende fout'}`, 'error');
    }
}

async function removeFotoshootDay(dateStr) {
    if (!confirm(`Fotoshoot-dag ${formatDateNL(dateStr)} verwijderen?`)) return;

    showLoading(true);

    const result = await apiPost({
        action: 'removeSlot',
        date: dateStr
    });

    showLoading(false);

    if (applyServerData(result)) {
        renderAll();
        if (!fotoshootSlots[dateStr]) {
            showToast('Fotoshoot-dag verwijderd', 'success');
        } else {
            showToast('Verwijderen lijkt niet gelukt — probeer opnieuw', 'error');
        }
    } else {
        showToast(`Verwijderen mislukt: ${result.error || 'onbekende fout'}`, 'error');
    }
}

async function cancelFotoshootBooking(bookingCode) {
    if (!confirm('Fotoshoot-boeking annuleren?')) return;

    showLoading(true);

    const result = await apiPost({
        action: 'cancelBooking',
        code: bookingCode
    });

    showLoading(false);

    if (applyServerData(result)) {
        renderAll();
        showToast('Boeking geannuleerd, tijdslot weer beschikbaar', 'success');
    } else {
        showToast(`Annuleren mislukt: ${result.error || 'onbekende fout'}`, 'error');
    }
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
                <div class="admin-day-actions">
                    ${!isPast ? `<button class="btn-small" data-edit="${dateStr}">Bewerken</button>` : ''}
                    ${!isPast ? `<button class="btn-danger btn-small" data-remove="${dateStr}">Verwijderen</button>` : '<span class="past-label">Verlopen</span>'}
                </div>
            </div>
            <p class="admin-availability">Beschikbaar ${slot.startTime} – ${slot.endTime}</p>
            <div class="admin-time-chips">${bookingChips}</div>
        `;
        container.appendChild(el);
    });

    container.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => startEditSlot(btn.dataset.edit));
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
                ${b.consult ? `<br><small>📞 Consult: ${b.consult}</small>` : ''}
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
    document.getElementById('fs-add-day').addEventListener('click', addFotoshootDay);
    document.getElementById('fs-cancel-edit').addEventListener('click', cancelEdit);

    document.getElementById('copy-link').addEventListener('click', () => {
        const url = new URL('fotoshoot.html', window.location.href).href;
        navigator.clipboard.writeText(url).then(() => {
            showToast('Link gekopieerd!', 'success');
        });
    });

    // Direct starten — geen login nodig
    startup();
});
