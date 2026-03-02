// ============================================
// FOTOSHOOT BOEKINGSPAGINA — Publiek
// ============================================
const BOOKING_BLOCK_MINUTES = 150; // 2,5 uur blokkering na elke boeking
const TIME_STEP_MINUTES = 30;     // tijdstappen van 30 minuten
const MAX_BOOKINGS_PER_DAY = 2;   // maximaal aantal boekingen per dag

const MONTHS_NL = [
    'januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december'
];

const DAYS_NL = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

// ============================================
// EmailJS configuratie
// ============================================
const EMAILJS_PUBLIC_KEY = 'RtX6RSZRrTCmSOoDw';
const EMAILJS_SERVICE_ID = 'service_4nkxqgj';
const EMAILJS_TEMPLATE_CONFIRM = 'template_dk1f8ji';
const EMAILJS_TEMPLATE_RESCHEDULE = 'template_3cjid5i';

// Google Apps Script API URL (centrale backend)
const API_URL = 'https://script.google.com/macros/s/AKfycbyaqHCzaUpebOEZovD8DMpWoOYSmtmEIQdPF8VmWQMvYAwAxvw1ZGkLJcfKqvDNY-gGoQ/exec';

// ============================================
// HELPERS
// ============================================
function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function genBookingCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'FS-';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (fotoshootBookings.some(b => b.code === code)) return genBookingCode();
    return code;
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

function timeToMinutes(time) {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}

function minutesToTime(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatBlockEndTime(time) {
    return minutesToTime(timeToMinutes(time) + BOOKING_BLOCK_MINUTES);
}

// ============================================
// API COMMUNICATIE
// ============================================

/**
 * Haal alle data op van de server (slots + boekingen)
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
 * POST naar de server (fire-and-forget via no-cors als fallback)
 */
function apiPost(data) {
    return fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify(data)
    })
    .then(r => r.json())
    .catch(err => {
        console.error('API POST fout:', err);
        // Fallback: probeer met no-cors (response niet leesbaar maar request komt wel aan)
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
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let selectedDate = null;
let selectedTime = null;
let rescheduleBooking = null;
let isLoading = false;

// ============================================
// LOADING STATE
// ============================================
function showLoading(show) {
    isLoading = show;
    const loader = document.getElementById('loading-overlay');
    if (loader) {
        loader.classList.toggle('hidden', !show);
    }
}

// ============================================
// CALENDAR
// ============================================
function getAvailableTimes(dateStr) {
    const slot = fotoshootSlots[dateStr];
    if (!slot) return [];
    const dayBookings = fotoshootBookings.filter(b => b.date === dateStr);
    if (dayBookings.length >= MAX_BOOKINGS_PER_DAY) return [];

    const startMin = timeToMinutes(slot.startTime);
    const endMin = timeToMinutes(slot.endTime);
    const bookedMinutes = dayBookings.map(b => timeToMinutes(b.time));

    const available = [];
    for (let m = startMin; m < endMin; m += TIME_STEP_MINUTES) {
        const isBlocked = bookedMinutes.some(bm => m >= bm && m < bm + BOOKING_BLOCK_MINUTES);
        if (!isBlocked) available.push(minutesToTime(m));
    }
    return available;
}

function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const label = document.getElementById('month-label');
    grid.innerHTML = '';

    label.textContent = `${MONTHS_NL[currentMonth]} ${currentYear}`;

    const firstDay = new Date(currentYear, currentMonth, 1);
    const startWeekday = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();
    const today = todayStr();

    for (let i = startWeekday - 1; i >= 0; i--) {
        const el = document.createElement('div');
        el.className = 'cal-day outside';
        el.textContent = daysInPrevMonth - i;
        grid.appendChild(el);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = formatDateStr(currentYear, currentMonth, d);
        const isPast = dateStr < today;
        const isToday = dateStr === today;
        const availTimes = getAvailableTimes(dateStr);
        const hasSlots = availTimes.length > 0;

        const el = document.createElement('div');
        el.className = 'cal-day';
        if (isPast) el.classList.add('past');
        else if (hasSlots) el.classList.add('available');
        else el.classList.add('unavailable');
        if (isToday) el.classList.add('today');

        el.textContent = d;

        if (!isPast && hasSlots) {
            el.addEventListener('click', () => showTimeSlots(dateStr));
        }

        grid.appendChild(el);
    }

    const totalCells = startWeekday + daysInMonth;
    const remainder = totalCells % 7;
    if (remainder > 0) {
        for (let i = 1; i <= 7 - remainder; i++) {
            const el = document.createElement('div');
            el.className = 'cal-day outside';
            el.textContent = i;
            grid.appendChild(el);
        }
    }
}

// ============================================
// TIME SLOTS
// ============================================
function showTimeSlots(dateStr) {
    selectedDate = dateStr;
    document.getElementById('selected-date-label').textContent = formatDateNL(dateStr);

    const container = document.getElementById('time-slots');
    container.innerHTML = '';

    const availTimes = getAvailableTimes(dateStr);

    availTimes.forEach(time => {
        const el = document.createElement('div');
        el.className = 'time-slot time-slot-compact';
        el.innerHTML = `<div class="time-range">${time}</div>`;
        el.addEventListener('click', () => showForm(dateStr, time));
        container.appendChild(el);
    });

    showStep('step-time');
}

// ============================================
// FORM & BOOKING
// ============================================
function showForm(dateStr, time) {
    selectedDate = dateStr;
    selectedTime = time;

    document.getElementById('booking-summary-date').textContent = formatDateNL(dateStr);
    document.getElementById('booking-summary-time').textContent = `om ${time}`;

    if (rescheduleBooking) {
        document.getElementById('f-name').value = rescheduleBooking.name;
        document.getElementById('f-email').value = rescheduleBooking.email;
        document.getElementById('f-phone').value = rescheduleBooking.phone;
        document.getElementById('f-remark').value = rescheduleBooking.remark || '';
        document.getElementById('f-consult').value = rescheduleBooking.consult || '';
        document.getElementById('reschedule-banner').classList.remove('hidden');
    } else {
        document.getElementById('reschedule-banner').classList.add('hidden');
    }

    showStep('step-form');
}

async function handleBooking(e) {
    e.preventDefault();

    const name = document.getElementById('f-name').value.trim();
    const email = document.getElementById('f-email').value.trim();
    const phone = document.getElementById('f-phone').value.trim();
    const remark = document.getElementById('f-remark').value.trim();
    const consult = document.getElementById('f-consult').value.trim();

    if (!name || !email || !phone) {
        showToast('Vul alle verplichte velden in', 'error');
        return;
    }

    // Check of slot nog beschikbaar is
    const availTimes = getAvailableTimes(selectedDate);
    if (!availTimes.includes(selectedTime)) {
        showToast('Dit tijdslot is helaas net geboekt. Kies een ander tijdstip.', 'error');
        showTimeSlots(selectedDate);
        return;
    }

    // Als we verzetten: oude boeking info bewaren
    let oldBookingInfo = null;
    if (rescheduleBooking) {
        oldBookingInfo = {
            date: rescheduleBooking.date,
            time: rescheduleBooking.time
        };
        // Verwijder oude boeking uit lokale state
        fotoshootBookings = fotoshootBookings.filter(b => b.code !== rescheduleBooking.code);
    }

    // Nieuwe boeking
    const bookingCode = rescheduleBooking ? rescheduleBooking.code : genBookingCode();
    const booking = {
        code: bookingCode,
        date: selectedDate,
        time: selectedTime,
        name,
        email,
        phone,
        remark,
        consult,
    };

    // Voeg toe aan lokale state (optimistic update)
    fotoshootBookings.push(booking);

    // Bevestiging tonen
    document.getElementById('confirm-date').textContent = formatDateNL(selectedDate);
    document.getElementById('confirm-time').textContent = `om ${selectedTime}`;
    document.getElementById('confirm-code').textContent = bookingCode;

    if (rescheduleBooking) {
        document.getElementById('confirm-title').textContent = 'Boeking verzet!';
        document.getElementById('confirm-subtitle').textContent = 'Je fotoshoot is succesvol verzet naar:';
    } else {
        document.getElementById('confirm-title').textContent = 'Boeking bevestigd!';
        document.getElementById('confirm-subtitle').textContent = 'Je fotoshoot is geboekt op:';
    }

    // Verstuur naar server (register = opslaan in Sheet + admin mail + agenda)
    apiPost({
        action: 'register',
        code: booking.code,
        name: booking.name,
        email: booking.email,
        date: booking.date,
        time: booking.time,
        endTime: formatBlockEndTime(booking.time),
        phone: booking.phone,
        remark: booking.remark || '',
        consult: booking.consult || '',
    });

    // Bevestigingsmail via EmailJS
    const isReschedule = !!rescheduleBooking;
    sendConfirmationEmail(booking, isReschedule, oldBookingInfo);

    // Reset state
    rescheduleBooking = null;
    document.getElementById('booking-form').reset();
    document.getElementById('reschedule-banner').classList.add('hidden');

    showStep('step-confirmed');
}

// ============================================
// BOEKING OPZOEKEN (verzetten / annuleren)
// ============================================
function lookupBooking() {
    const codeInput = document.getElementById('lookup-code').value.trim().toUpperCase();

    if (!codeInput) {
        showToast('Voer je boekingscode in', 'error');
        return;
    }

    const booking = fotoshootBookings.find(b => b.code === codeInput);

    if (!booking) {
        showToast('Boekingscode niet gevonden', 'error');
        return;
    }

    if (booking.date < todayStr()) {
        showToast('Deze fotoshoot is al geweest', 'error');
        return;
    }

    const container = document.getElementById('lookup-result');
    container.innerHTML = `
        <div class="booking-detail-card">
            <h3>Jouw boeking</h3>
            <div class="booking-detail-row">
                <span class="label">Datum</span>
                <strong>${formatDateNL(booking.date)}</strong>
            </div>
            <div class="booking-detail-row">
                <span class="label">Tijd</span>
                <strong>om ${booking.time}</strong>
            </div>
            <div class="booking-detail-row">
                <span class="label">Naam</span>
                <span>${booking.name}</span>
            </div>
            <div class="booking-detail-row">
                <span class="label">Code</span>
                <span class="booking-code-display">${booking.code}</span>
            </div>
            <div class="booking-actions">
                <button class="btn-primary" id="btn-reschedule">Verzetten</button>
                <button class="btn-cancel" id="btn-cancel-booking">Annuleren</button>
            </div>
        </div>
    `;

    document.getElementById('btn-reschedule').addEventListener('click', () => {
        startReschedule(booking);
    });
    document.getElementById('btn-cancel-booking').addEventListener('click', () => {
        cancelBooking(booking);
    });
}

function startReschedule(booking) {
    rescheduleBooking = booking;
    renderCalendar();
    showStep('step-calendar');
    showToast('Kies een nieuwe datum en tijd voor je fotoshoot');
}

async function cancelBooking(booking) {
    if (!confirm('Weet je zeker dat je de fotoshoot wilt annuleren?')) return;

    // Verwijder uit lokale state
    fotoshootBookings = fotoshootBookings.filter(b => b.code !== booking.code);

    // Verwijder uit server (Google Sheet)
    apiPost({
        action: 'cancelBooking',
        code: booking.code
    });

    // Toon annuleringsbevestiging
    document.getElementById('lookup-result').innerHTML = `
        <div class="booking-detail-card cancelled">
            <div class="confirmation-icon cancel-icon">&#10007;</div>
            <h3>Boeking geannuleerd</h3>
            <p>Je fotoshoot op ${formatDateNL(booking.date)} om ${booking.time} is geannuleerd.</p>
            <button class="btn-primary" id="btn-book-new" style="margin-top:1rem">Nieuwe fotoshoot boeken</button>
        </div>
    `;
    document.getElementById('btn-book-new').addEventListener('click', async () => {
        rescheduleBooking = null;
        showLoading(true);
        await loadDataFromServer();
        showLoading(false);
        renderCalendar();
        showStep('step-calendar');
    });
}

// ============================================
// EMAILJS — Bevestigingsmail
// ============================================
function sendConfirmationEmail(booking, isReschedule, oldBookingInfo) {
    if (EMAILJS_PUBLIC_KEY === 'JOUW_PUBLIC_KEY' || typeof emailjs === 'undefined') {
        console.log('EmailJS niet geconfigureerd, geen mail verstuurd');
        return;
    }

    const pageUrl = window.location.href.split('?')[0];
    const templateId = isReschedule ? EMAILJS_TEMPLATE_RESCHEDULE : EMAILJS_TEMPLATE_CONFIRM;

    const params = {
        to_name: booking.name,
        to_email: booking.email,
        booking_date: formatDateNL(booking.date),
        booking_time: booking.time,
        booking_code: booking.code,
        booking_remark: booking.remark || '-',
        booking_consult: booking.consult || '-',
        page_url: pageUrl,
    };

    if (isReschedule && oldBookingInfo) {
        params.old_date = formatDateNL(oldBookingInfo.date);
        params.old_time = oldBookingInfo.time;
    }

    emailjs.send(EMAILJS_SERVICE_ID, templateId, params)
        .then(() => console.log('Bevestigingsmail verstuurd'))
        .catch(err => console.error('Mail fout:', err));
}

// ============================================
// NAVIGATION
// ============================================
function showStep(stepId) {
    document.querySelectorAll('.step').forEach(s => s.classList.add('hidden'));
    document.getElementById(stepId).classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
document.addEventListener('DOMContentLoaded', async () => {
    // EmailJS initialiseren
    if (EMAILJS_PUBLIC_KEY !== 'JOUW_PUBLIC_KEY' && typeof emailjs !== 'undefined') {
        emailjs.init(EMAILJS_PUBLIC_KEY);
    }

    // Data ophalen van server
    showLoading(true);
    const success = await loadDataFromServer();
    showLoading(false);

    if (!success) {
        showToast('Kon agenda niet laden. Probeer het later opnieuw.', 'error');
    }

    renderCalendar();

    // Maand navigatie
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

    // Terug-knoppen
    document.getElementById('back-to-calendar').addEventListener('click', () => {
        showStep('step-calendar');
    });
    document.getElementById('back-to-time').addEventListener('click', () => {
        showTimeSlots(selectedDate);
    });

    // Formulier submit
    document.getElementById('booking-form').addEventListener('submit', handleBooking);

    // Nog een boeking
    document.getElementById('book-another').addEventListener('click', async () => {
        rescheduleBooking = null;
        showLoading(true);
        await loadDataFromServer();
        showLoading(false);
        renderCalendar();
        showStep('step-calendar');
    });

    // Boeking opzoeken
    document.getElementById('show-lookup').addEventListener('click', () => {
        document.getElementById('lookup-code').value = '';
        document.getElementById('lookup-result').innerHTML = '';
        showStep('step-lookup');
    });
    document.getElementById('lookup-btn').addEventListener('click', lookupBooking);
    document.getElementById('lookup-form').addEventListener('submit', (e) => {
        e.preventDefault();
        lookupBooking();
    });
    document.getElementById('back-to-calendar-from-lookup').addEventListener('click', () => {
        showStep('step-calendar');
    });
});
