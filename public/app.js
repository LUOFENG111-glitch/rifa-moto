// ── State ──────────────────────────────────────────────────────────────────────
const socket = io();
let tickets = {};
let selectedTicket = null;
let settings = {};

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
    try {
        const [ticketsRes, settingsRes] = await Promise.all([
            fetch('/api/tickets').then(r => r.json()),
            fetch('/api/settings').then(r => r.json())
        ]);
        settings = settingsRes;
        applySettings(settings);
        buildGrid(ticketsRes);
        updateStats(ticketsRes);
    } catch (e) {
        showToast('Error al cargar los boletos', 'error');
    }
}

// ── Apply Settings ─────────────────────────────────────────────────────────────
function applySettings(s) {
    if (s.price) {
        document.getElementById('ticket-price').textContent = '$' + s.price;
    }
    if (s.raffle_name) {
        document.getElementById('raffle-name').textContent = s.raffle_name;
        document.title = s.raffle_name;
    }
    if (s.moto_image) {
        const img = document.getElementById('moto-img');
        img.src = s.moto_image;
        img.onerror = () => { img.style.display = 'none'; };
    }
}

// ── Build Grid ─────────────────────────────────────────────────────────────────
function buildGrid(ticketList) {
    const grid = document.getElementById('ticket-grid');
    grid.innerHTML = '';
    ticketList.forEach(t => {
        tickets[t.number] = t;
        grid.appendChild(createTicketBtn(t));
    });
}

function createTicketBtn(t) {
    const btn = document.createElement('button');
    btn.id = `ticket-${t.number}`;
    btn.className = `ticket-btn${t.status === 'sold' ? ' sold' : ''}`;
    btn.setAttribute('aria-label', `Boleto ${t.number} - ${t.status === 'sold' ? 'Vendido' : 'Disponible'}`);
    btn.innerHTML = `<span class="ticket-num">${String(t.number).padStart(3, '0')}</span>`;
    if (t.status !== 'sold') {
        btn.addEventListener('click', () => openModal(t.number));
    }
    return btn;
}

// ── Update a single ticket in the DOM ─────────────────────────────────────────
function updateTicketDOM(num, status) {
    const btn = document.getElementById(`ticket-${num}`);
    if (!btn) return;
    if (status === 'sold') {
        btn.classList.add('sold', 'just-sold');
        btn.setAttribute('aria-label', `Boleto ${num} - Vendido`);
        btn.replaceWith(btn.cloneNode(true)); // remove event listeners
        // re-apply just-sold class
        const refreshed = document.getElementById(`ticket-${num}`);
        if (refreshed) {
            refreshed.classList.add('sold');
            setTimeout(() => refreshed.classList.remove('just-sold'), 600);
        }
    } else {
        btn.className = 'ticket-btn';
        btn.setAttribute('aria-label', `Boleto ${num} - Disponible`);
        const clone = btn.cloneNode(true);
        clone.addEventListener('click', () => openModal(num));
        btn.replaceWith(clone);
    }
}

// ── Stats ──────────────────────────────────────────────────────────────────────
function updateStats(ticketList) {
    const arr = Array.isArray(ticketList) ? ticketList : Object.values(tickets);
    const sold = arr.filter(t => t.status === 'sold').length;
    const total = arr.length;
    const available = total - sold;
    const pct = total > 0 ? Math.round((sold / total) * 100) : 0;

    document.getElementById('stat-sold').textContent = sold;
    document.getElementById('stat-available').textContent = available;
    document.getElementById('stat-total').textContent = total;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-label').textContent = pct + '% vendido';
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function openModal(num) {
    selectedTicket = num;
    document.getElementById('modal-ticket-num').textContent = `#${String(num).padStart(3, '0')}`;
    document.getElementById('purchase-form').reset();
    resetBtn();
    const backdrop = document.getElementById('modal-backdrop');
    backdrop.classList.add('active');
    setTimeout(() => document.getElementById('buyer-name').focus(), 320);
}

function closeModal() {
    document.getElementById('modal-backdrop').classList.remove('active');
    selectedTicket = null;
    resetBtn();
}

function resetBtn() {
    document.getElementById('btn-text').classList.remove('hidden');
    document.getElementById('btn-spinner').classList.add('hidden');
    document.getElementById('btn-confirm').disabled = false;
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-backdrop').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-backdrop')) closeModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});

// ── Purchase Form Submit ────────────────────────────────────────────────────────
document.getElementById('purchase-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedTicket) return;

    const name = document.getElementById('buyer-name').value.trim();
    const phone = document.getElementById('buyer-phone').value.trim();

    if (!name || !phone) {
        showToast('Por favor completa todos los campos', 'error');
        return;
    }

    // Show loading
    document.getElementById('btn-text').classList.add('hidden');
    document.getElementById('btn-spinner').classList.remove('hidden');
    document.getElementById('btn-confirm').disabled = true;

    try {
        const res = await fetch(`/api/tickets/${selectedTicket}/purchase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone })
        });
        const data = await res.json();

        if (res.ok) {
            tickets[selectedTicket] = { ...tickets[selectedTicket], status: 'sold' };
            updateTicketDOM(selectedTicket, 'sold');
            updateStats(Object.values(tickets));
            closeModal();
            showToast(`🎉 ¡Boleto #${String(selectedTicket).padStart(3, '0')} apartado! ¡Buena suerte, ${name}!`, 'success');

            // Generate WhatsApp link
            const whatsappNumber = '526674017749'; // Code 52 for Mexico + the user's number
            const raffleName = settings.raffle_name || 'Rifa';
            const message = `Hola! Acabo de apartar el boleto #${String(selectedTicket).padStart(3, '0')} para la ${raffleName}.\n\nMi nombre es: ${name}\nMi teléfono es: ${phone}\n\nMe gustaría acordar el pago.`;
            const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

            // Redirect to WhatsApp
            setTimeout(() => {
                window.open(whatsappUrl, '_blank');
            }, 1000);
        } else {
            showToast(data.error || 'Error al comprar el boleto', 'error');
            resetBtn();
        }
    } catch {
        showToast('Error de conexión. Intenta de nuevo.', 'error');
        resetBtn();
    }
});

// ── Socket.io Real-time Updates ────────────────────────────────────────────────
socket.on('ticket_updated', (data) => {
    if (tickets[data.number]) {
        tickets[data.number].status = data.status;
        updateTicketDOM(data.number, data.status);
        updateStats(Object.values(tickets));
    }
});

socket.on('settings_updated', (data) => {
    settings = { ...settings, ...data };
    applySettings(data);
});

socket.on('raffle_reset', () => {
    Object.values(tickets).forEach(t => {
        tickets[t.number].status = 'available';
        const btn = document.getElementById(`ticket-${t.number}`);
        if (btn) {
            btn.className = 'ticket-btn';
            const clone = btn.cloneNode(true);
            clone.addEventListener('click', () => openModal(t.number));
            btn.replaceWith(clone);
        }
    });
    updateStats(Object.values(tickets));
    showToast('🔄 La rifa ha sido reiniciada', 'error');
});

socket.on('connect', () => console.log('✅ Conectado al servidor'));
socket.on('disconnect', () => showToast('⚠ Conexión perdida...', 'error'));

// ── Toast ──────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast ${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

// ── Start ──────────────────────────────────────────────────────────────────────
init();
