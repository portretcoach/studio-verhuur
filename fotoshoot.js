// ============================================
// FOTOSHOOT BOEKINGSPAGINA — Publiek
// ============================================
const STORAGE_KEYS = {
    fotoshootSlots: 'sv_fotoshoot_slots',
    fotoshootBookings: 'sv_fotoshoot_bookings',
};

const FOTOSHOOT_DURATION = 120; // minuten
const FOTOSHOOT_BUFFER = 30;

const MONTHS_NL = [
    'januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december'
];

const DAYS_NL = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

// ============================================
// EmailJS configuratie — vul je eigen gegevens in
// ============================================
const EMAILJS_PUBLIC_KEY = 'RtX6RSZRrTCmSOoDw';       // EmailJS Public Key
const EMAILJS_SERVICE_ID = 'service_4nkxqgj';       // EmailJS Service ID
const EMAILJS_TEMPLATE_CONFIRM = 'template_dk1f8ji'; // Template ID bevestiging
const EMAILJS_TEMPLATE_RESCHEDULE = 'template_3cjid5i';   // Template ID verzet-bevestiging

// Google Apps Script URL voor herinneringen
const REMINDER_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyaqHCzaUpebOEZovD8DMpWoOYSmtmEIQdPF8VmWQMvYAwAxvw1ZGkLJcfKqvDNY-gGoQ/exec';

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

function genBookingCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // geen I/O/0/1 (verwarring voorkomen)
    let code = 'FS-';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Check of code al bestaat
    const existing = load(STORAGE_KEYS.fotoshootBookings);
    if (existing.some(b => b.code === code)) return genBookingCode();
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

function formatEndTime(time) {
    const [h, m] = time.split(':').map(Number);
    const endMinutes = h * 60 + m + FOTOSHOOT_DURATION;
    const endH = Math.floor(endMinutes / 60);
    const endM = endMinutes % 60;
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
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
let rescheduleBooking = null; // als we een boeking aan het verzetten zijn

// ============================================
// CALENDAR
// ============================================
function getAvailableTimes(dateStr) {
    const slot = fotoshootSlots[dateStr];
    if (!slot) return [];
    const bookedTimes = fotoshootBookings
        .filter(b => b.date === dateStr)
        .map(b => b.time);
    return slot.times.filter(t => !bookedTimes.includes(t));
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

    // Vorige maand padding
    for (let i = startWeekday - 1; i >= 0; i--) {
        const el = document.createElement('div');
        el.className = 'cal-day outside';
        el.textContent = daysInPrevMonth - i;
        grid.appendChild(el);
    }

    // Dagen van de maand
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

    // Volgende maand padding
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
        const endStr = formatEndTime(time);
        const el = document.createElement('div');
        el.className = 'time-slot';
        el.innerHTML = `
            <div class="time-range">${time} – ${endStr}</div>
            <div class="time-duration">2 uur fotoshoot</div>
        `;
        el.addEventListener('click', () => showForm(dateStr, time, endStr));
        container.appendChild(el);
    });

    showStep('step-time');
}

// ============================================
// FORM & BOOKING
// ============================================
function showForm(dateStr, time, endStr) {
    selectedDate = dateStr;
    selectedTime = time;

    document.getElementById('booking-summary-date').textContent = formatDateNL(dateStr);
    document.getElementById('booking-summary-time').textContent = `${time} – ${endStr}`;

    // Als we aan het verzetten zijn, vul de naam/email/etc alvast in
    if (rescheduleBooking) {
        document.getElementById('f-name').value = rescheduleBooking.name;
        document.getElementById('f-email').value = rescheduleBooking.email;
        document.getElementById('f-phone').value = rescheduleBooking.phone;
        document.getElementById('f-persons').value = rescheduleBooking.persons;
        document.getElementById('f-remark').value = rescheduleBooking.remark || '';

        // Toon verzet-banner
        document.getElementById('reschedule-banner').classList.remove('hidden');
    } else {
        document.getElementById('reschedule-banner').classList.add('hidden');
    }

    showStep('step-form');
}

function handleBooking(e) {
    e.preventDefault();

    const name = document.getElementById('f-name').value.trim();
    const email = document.getElementById('f-email').value.trim();
    const phone = document.getElementById('f-phone').value.trim();
    const persons = document.getElementById('f-persons').value;
    const remark = document.getElementById('f-remark').value.trim();

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

    // Als we verzetten: oude boeking verwijderen
    let oldBookingInfo = null;
    if (rescheduleBooking) {
        oldBookingInfo = {
            date: rescheduleBooking.date,
            time: rescheduleBooking.time
        };
        fotoshootBookings = fotoshootBookings.filter(b => b.id !== rescheduleBooking.id);
    }

    // Nieuwe boeking opslaan
    const bookingCode = rescheduleBooking ? rescheduleBooking.code : genBookingCode();
    const booking = {
        id: genId(),
        code: bookingCode,
        date: selectedDate,
        time: selectedTime,
        name,
        email,
        phone,
        persons: parseInt(persons),
        remark,
        createdAt: new Date().toISOString()
    };

    fotoshootBookings.push(booking);
    save(STORAGE_KEYS.fotoshootBookings, fotoshootBookings);

    // Bevestiging tonen
    const endStr = formatEndTime(selectedTime);
    document.getElementById('confirm-date').textContent = formatDateNL(selectedDate);
    document.getElementById('confirm-time').textContent = `${selectedTime} – ${endStr}`;
    document.getElementById('confirm-code').textContent = bookingCode;

    if (rescheduleBooking) {
        document.getElementById('confirm-title').textContent = 'Boeking verzet!';
        document.getElementById('confirm-subtitle').textContent = 'Je fotoshoot is succesvol verzet naar:';
    } else {
        document.getElementById('confirm-title').textContent = 'Boeking bevestigd!';
        document.getElementById('confirm-subtitle').textContent = 'Je fotoshoot is geboekt op:';
    }

    // E-mails versturen
    const isReschedule = !!rescheduleBooking;
    sendConfirmationEmail(booking, isReschedule, oldBookingInfo);
    registerReminder(booking);

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

    // Toon boekingsdetails
    const container = document.getElementById('lookup-result');
    const endStr = formatEndTime(booking.time);
    container.innerHTML = `
        <div class="booking-detail-card">
            <h3>Jouw boeking</h3>
            <div class="booking-detail-row">
                <span class="label">Datum</span>
                <strong>${formatDateNL(booking.date)}</strong>
            </div>
            <div class="booking-detail-row">
                <span class="label">Tijd</span>
                <strong>${booking.time} – ${endStr}</strong>
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
    // Ga naar de kalender om een nieuwe datum te kiezen
    renderCalendar();
    showStep('step-calendar');
    showToast('Kies een nieuwe datum en tijd voor je fotoshoot');
}

function cancelBooking(booking) {
    if (!confirm('Weet je zeker dat je de fotoshoot wilt annuleren?')) return;

    fotoshootBookings = fotoshootBookings.filter(b => b.id !== booking.id);
    save(STORAGE_KEYS.fotoshootBookings, fotoshootBookings);

    // Toon annuleringsbevestiging
    document.getElementById('lookup-result').innerHTML = `
        <div class="booking-detail-card cancelled">
            <div class="confirmation-icon cancel-icon">&#10007;</div>
            <h3>Boeking geannuleerd</h3>
            <p>Je fotoshoot op ${formatDateNL(booking.date)} om ${booking.time} is geannuleerd.</p>
            <button class="btn-primary" id="btn-book-new" style="margin-top:1rem">Nieuwe fotoshoot boeken</button>
        </div>
    `;
    document.getElementById('btn-book-new').addEventListener('click', () => {
        rescheduleBooking = null;
        fotoshootSlots = loadMap(STORAGE_KEYS.fotoshootSlots);
        fotoshootBookings = load(STORAGE_KEYS.fotoshootBookings);
        renderCalendar();
        showStep('step-calendar');
    });
}

// ============================================
// EMAILJS — Bevestigingsmail
// ============================================
function sendConfirmationEmail(booking, isReschedule, oldBookingInfo) {
    // Check of EmailJS geconfigureerd is
    if (EMAILJS_PUBLIC_KEY === 'JOUW_PUBLIC_KEY' || typeof emailjs === 'undefined') {
        console.log('EmailJS niet geconfigureerd, geen mail verstuurd');
        return;
    }

    const endStr = formatEndTime(booking.time);
    const pageUrl = window.location.href.split('?')[0];

    const templateId = isReschedule ? EMAILJS_TEMPLATE_RESCHEDULE : EMAILJS_TEMPLATE_CONFIRM;

    const params = {
        to_name: booking.name,
        to_email: booking.email,
        booking_date: formatDateNL(booking.date),
        booking_time: `${booking.time} – ${endStr}`,
        booking_code: booking.code,
        booking_persons: booking.persons,
        booking_remark: booking.remark || '-',
        page_url: pageUrl,
    };

    // Extra info bij verzetten
    if (isReschedule && oldBookingInfo) {
        params.old_date = formatDateNL(oldBookingInfo.date);
        params.old_time = oldBookingInfo.time;
    }

    emailjs.send(EMAILJS_SERVICE_ID, templateId, params)
        .then(() => console.log('Bevestigingsmail verstuurd'))
        .catch(err => console.error('Mail fout:', err));
}

// ============================================
// GOOGLE APPS SCRIPT — Herinnering registreren
// ============================================
function registerReminder(booking) {
    if (REMINDER_SCRIPT_URL === 'JOUW_APPS_SCRIPT_URL') {
        console.log('Reminder script niet geconfigureerd');
        return;
    }

    const endStr = formatEndTime(booking.time);

    fetch(REMINDER_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'register',
            code: booking.code,
            name: booking.name,
            email: booking.email,
            date: booking.date,
            time: booking.time,
            endTime: endStr,
            persons: booking.persons,
        })
    })
    .then(() => console.log('Herinnering geregistreerd'))
    .catch(err => console.error('Herinnering registratie fout:', err));
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
document.addEventListener('DOMContentLoaded', () => {
    fotoshootSlots = loadMap(STORAGE_KEYS.fotoshootSlots);
    fotoshootBookings = load(STORAGE_KEYS.fotoshootBookings);

    // EmailJS initialiseren
    if (EMAILJS_PUBLIC_KEY !== 'JOUW_PUBLIC_KEY' && typeof emailjs !== 'undefined') {
        emailjs.init(EMAILJS_PUBLIC_KEY);
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
    document.getElementById('book-another').addEventListener('click', () => {
        rescheduleBooking = null;
        fotoshootSlots = loadMap(STORAGE_KEYS.fotoshootSlots);
        fotoshootBookings = load(STORAGE_KEYS.fotoshootBookings);
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
