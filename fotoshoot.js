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
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let selectedDate = null;
let selectedTime = null;

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
        const [h, m] = time.split(':').map(Number);
        const endMinutes = h * 60 + m + FOTOSHOOT_DURATION;
        const endH = Math.floor(endMinutes / 60);
        const endM = endMinutes % 60;
        const endStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

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

    // Boeking opslaan
    const booking = {
        id: genId(),
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
    const [h, m] = selectedTime.split(':').map(Number);
    const endMinutes = h * 60 + m + FOTOSHOOT_DURATION;
    const endStr = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

    document.getElementById('confirm-date').textContent = formatDateNL(selectedDate);
    document.getElementById('confirm-time').textContent = `${selectedTime} – ${endStr}`;

    // Reset form
    document.getElementById('booking-form').reset();

    showStep('step-confirmed');
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
        fotoshootSlots = loadMap(STORAGE_KEYS.fotoshootSlots);
        fotoshootBookings = load(STORAGE_KEYS.fotoshootBookings);
        renderCalendar();
        showStep('step-calendar');
    });
});
