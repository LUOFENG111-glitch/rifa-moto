// ── Auth & State ────────────────────────────────────────────────────────────────
let token = localStorage.getItem('admin_token') || '';
let allBuyers = [];
let allTickets = {};
let settings = {};
const socket = io();

// ── DOM helpers ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);

// ── On load ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    if (token) {
        showDashboard();
    }
    setupLogin();
    setupNav();
    setupButtons();
    setupUpload();
    setupSearch();
});

// ══════════════════════════════ LOGIN ══════════════════════════════════════════

function setupLogin() {
    $('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = $('login-user').value.trim();
        const password = $('login-pass').value.trim();
        const btnLogin = $('btn-login');
        btnLogin.textContent = 'Verificando...';
        btnLogin.disabled = true;

        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (res.ok) {
                token = data.token;
                localStorage.setItem('admin_token', token);
                $('login-error').classList.add('hidden');
                showDashboard();
            } else {
                $('login-error').classList.remove('hidden');
            }
        } catch {
            $('login-error').textContent = 'Error de conexión';
            $('login-error').classList.remove('hidden');
        }
        btnLogin.textContent = 'Ingresar';
        btnLogin.disabled = false;
    });
}

function showDashboard() {
    $('login-screen').classList.add('hidden');
    $('dashboard').classList.remove('hidden');
    loadAll();
}

$('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('admin_token');
    token = '';
    $('dashboard').classList.add('hidden');
    $('login-screen').classList.remove('hidden');
});

// ══════════════════════════════ NAV TABS ═══════════════════════════════════════

function setupNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            $(tabId).classList.add('active');
            if (tabId === 'tab-buyers') loadBuyers();
            if (tabId === 'tab-tickets') loadAdminGrid();
            if (tabId === 'tab-stats') loadStats();
        });
    });
}

// ══════════════════════════════ LOAD ALL ═══════════════════════════════════════

async function loadAll() {
    await Promise.all([loadStats(), loadSettings(), loadAdminGrid(), loadBuyers()]);
}

// ── Stats ───────────────────────────────────────────────────────────────────────
async function loadStats() {
    try {
        const res = await authFetch('/api/admin/stats');
        const s = await res.json();
        $('s-total').textContent = s.total;
        $('s-sold').textContent = s.sold;
        $('s-available').textContent = s.available;
        $('s-revenue').textContent = '$' + s.revenue.toLocaleString('es-MX');
        const pct = s.total > 0 ? Math.round((s.sold / s.total) * 100) : 0;
        $('s-pct').textContent = pct + '%';
        $('s-progress').style.width = pct + '%';
    } catch (e) {
        console.error('Stats error', e);
    }
}

// ── Settings ─────────────────────────────────────────────────────────────────────
async function loadSettings() {
    const res = await fetch('/api/settings');
    settings = await res.json();
    if (settings.price) $('set-price').value = settings.price;
    if (settings.raffle_name) $('set-name').value = settings.raffle_name;
    if (settings.moto_image) {
        const img = $('current-moto-thumb');
        img.src = settings.moto_image;
        img.onerror = () => { img.style.opacity = '0.3'; };
    }
}

// ─────────────────────────────────────────────────────────────────────────────────
// ADMIN TICKET GRID
// ─────────────────────────────────────────────────────────────────────────────────
async function loadAdminGrid() {
    const res = await fetch('/api/tickets');
    const ticketList = await res.json();
    allTickets = {};
    ticketList.forEach(t => allTickets[t.number] = t);
    renderAdminGrid(ticketList);
}

function renderAdminGrid(ticketList) {
    const grid = $('admin-ticket-grid');
    grid.innerHTML = '';
    const filter = $('ticket-search')?.value?.toLowerCase() || '';
    ticketList.forEach(t => {
        if (filter && !String(t.number).padStart(3, '0').includes(filter)) return;
        const el = document.createElement('div');
        el.id = `at-${t.number}`;
        el.className = `admin-ticket${t.status === 'sold' ? ' sold' : ''}`;
        el.textContent = String(t.number).padStart(3, '0');
        el.title = t.status === 'sold' ? 'Vendido — clic para liberar' : 'Disponible — clic para marcar vendido';
        el.addEventListener('click', () => adminToggleTicket(t.number));
        grid.appendChild(el);
    });
}

async function adminToggleTicket(num) {
    const ticket = allTickets[num];
    if (!ticket) return;
    const newStatus = ticket.status === 'sold' ? 'available' : 'sold';
    const msg = newStatus === 'sold'
        ? `¿Marcar boleto #${String(num).padStart(3, '0')} como VENDIDO?`
        : `¿Liberar boleto #${String(num).padStart(3, '0')} (marcarlo como disponible)?`;

    confirm(msg, async () => {
        try {
            const res = await authFetch(`/api/admin/tickets/${num}`, {
                method: 'PUT',
                body: JSON.stringify({ status: newStatus })
            });
            if (res.ok) {
                allTickets[num].status = newStatus;
                const el = document.getElementById(`at-${num}`);
                if (el) el.className = `admin-ticket${newStatus === 'sold' ? ' sold' : ''}`;
                loadStats();
                showToast(`Boleto #${String(num).padStart(3, '0')} → ${newStatus === 'sold' ? 'VENDIDO' : 'DISPONIBLE'}`, 'success');
            }
        } catch {
            showToast('Error al actualizar boleto', 'error');
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────────
// BUYERS TABLE
// ─────────────────────────────────────────────────────────────────────────────────
async function loadBuyers() {
    try {
        const res = await authFetch('/api/admin/buyers');
        allBuyers = await res.json();
        renderBuyers(allBuyers);
    } catch {
        showToast('Error al cargar compradores', 'error');
    }
}

function renderBuyers(buyers) {
    const tbody = $('buyers-tbody');
    const emptyMsg = $('buyers-empty');
    tbody.innerHTML = '';

    if (!buyers.length) {
        emptyMsg.classList.remove('hidden');
        return;
    }
    emptyMsg.classList.add('hidden');

    buyers.forEach((b, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><span class="ticket-badge">#${String(b.ticket_number).padStart(3, '0')}</span></td>
      <td>${escHtml(b.name)}</td>
      <td>${escHtml(b.phone)}</td>
      <td>${b.created_at}</td>
      <td>
        <button class="btn-sm btn-outline" onclick="confirmFreeTicket(${b.ticket_number})">Liberar</button>
      </td>`;
        tbody.appendChild(tr);
    });
}

window.confirmFreeTicket = (num) => {
    confirm(`¿Liberar boleto #${String(num).padStart(3, '0')} y eliminar el comprador?`, async () => {
        const res = await authFetch(`/api/admin/tickets/${num}`, {
            method: 'PUT',
            body: JSON.stringify({ status: 'available' })
        });
        if (res.ok) {
            showToast('Boleto liberado', 'success');
            loadBuyers();
            loadStats();
        }
    });
};

// ─────────────────────────────────────────────────────────────────────────────────
// BUTTONS
// ─────────────────────────────────────────────────────────────────────────────────
function setupButtons() {
    // Export Excel
    $('btn-export').addEventListener('click', async () => {
        const res = await authFetch('/api/admin/export');
        if (res.ok) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'compradores_rifa.xlsx';
            a.click();
            URL.revokeObjectURL(url);
            showToast('Excel descargado ✔', 'success');
        }
    });

    // Reset raffle
    $('btn-reset').addEventListener('click', () => {
        confirm('⚠️ ¿Reiniciar la rifa? Todos los boletos quedarán disponibles y se eliminarán los compradores. ¡Acción irreversible!', async () => {
            const res = await authFetch('/api/admin/reset', { method: 'POST' });
            if (res.ok) {
                showToast('Rifa reiniciada 🔄', 'success');
                loadAll();
            }
        });
    });

    // Save price
    $('btn-save-price').addEventListener('click', async () => {
        const price = $('set-price').value;
        if (!price || isNaN(price)) { showToast('Precio inválido', 'error'); return; }
        const res = await authFetch('/api/admin/settings', {
            method: 'PUT',
            body: JSON.stringify({ price: parseFloat(price) })
        });
        if (res.ok) showToast('Precio actualizado ✔', 'success');
    });

    // Save raffle name
    $('btn-save-name').addEventListener('click', async () => {
        const name = $('set-name').value.trim();
        if (!name) { showToast('Nombre inválido', 'error'); return; }
        const res = await authFetch('/api/admin/settings', {
            method: 'PUT',
            body: JSON.stringify({ raffle_name: name })
        });
        if (res.ok) showToast('Nombre actualizado ✔', 'success');
    });

    $('btn-manual-sold').addEventListener('click', async () => {
        const num = parseInt($('manual-num').value);
        const name = $('manual-name').value.trim() || 'Admin';
        const phone = $('manual-phone').value.trim() || 'N/A';
        if (!num || num < 1 || num > 400) { showToast('Número inválido (1-400)', 'error'); return; }
        const res = await authFetch(`/api/admin/tickets/${num}`, {
            method: 'PUT',
            body: JSON.stringify({ status: 'sold', name, phone, payment_method: 'Acordado' })
        });
        if (res.ok) {
            showToast(`Boleto #${String(num).padStart(3, '0')} marcado como VENDIDO`, 'success');
            loadAll();
        } else {
            const d = await res.json();
            showToast(d.error || 'Error', 'error');
        }
    });

    // Manual available
    $('btn-manual-available').addEventListener('click', async () => {
        const num = parseInt($('manual-num').value);
        if (!num || num < 1 || num > 400) { showToast('Número inválido', 'error'); return; }
        const res = await authFetch(`/api/admin/tickets/${num}`, {
            method: 'PUT',
            body: JSON.stringify({ status: 'available' })
        });
        if (res.ok) {
            showToast(`Boleto #${String(num).padStart(3, '0')} disponible`, 'success');
            loadAll();
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────────
// FILE UPLOAD
// ─────────────────────────────────────────────────────────────────────────────────
function setupUpload() {
    const fileInput = $('moto-upload');
    const btnUpload = $('btn-upload-img');
    const uploadLabel = $('upload-label');

    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) {
            const name = fileInput.files[0].name;
            uploadLabel.innerHTML = `<span>✔</span><span>${name}</span><span class="upload-hint">Listo para subir</span>`;
            btnUpload.disabled = false;
        }
    });

    btnUpload.addEventListener('click', async () => {
        if (!fileInput.files[0]) return;
        const formData = new FormData();
        formData.append('image', fileInput.files[0]);
        btnUpload.textContent = 'Subiendo...';
        btnUpload.disabled = true;
        try {
            const res = await fetch('/api/admin/upload', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();
            if (res.ok) {
                $('current-moto-thumb').src = data.path + '?t=' + Date.now();
                showToast('Imagen actualizada ✔', 'success');
                uploadLabel.innerHTML = `<span>📷</span><span>Arrastra o clic para subir imagen</span><span class="upload-hint">JPG, PNG, WEBP — máx. 10MB</span>`;
                fileInput.value = '';
            } else {
                showToast(data.error || 'Error al subir', 'error');
            }
        } catch {
            showToast('Error de conexión', 'error');
        }
        btnUpload.textContent = 'Subir Imagen';
        btnUpload.disabled = false;
    });
}

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────────────────────────────────────
function setupSearch() {
    $('ticket-search')?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        const filtered = Object.values(allTickets).filter(t => String(t.number).padStart(3, '0').includes(q));
        renderAdminGrid(filtered);
    });

    $('buyer-search')?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        const filtered = allBuyers.filter(b =>
            b.name.toLowerCase().includes(q) ||
            b.phone.toLowerCase().includes(q) ||
            String(b.ticket_number).includes(q)
        );
        renderBuyers(filtered);
    });
}

// ─────────────────────────────────────────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────────────────────────────────────────
socket.on('ticket_updated', (data) => {
    if (allTickets[data.number]) {
        allTickets[data.number].status = data.status;
        const el = document.getElementById(`at-${data.number}`);
        if (el) el.className = `admin-ticket${data.status === 'sold' ? ' sold' : ''}`;
    }
    loadStats();
});

socket.on('raffle_reset', () => {
    loadAll();
    showToast('Rifa reiniciada', 'success');
});

// ─────────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────────
function authFetch(url, opts = {}) {
    return fetch(url, {
        ...opts,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(opts.headers || {})
        }
    });
}

function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let toastTimer;
function showToast(msg, type = 'success') {
    const t = $('admin-toast');
    t.textContent = msg;
    t.className = `toast ${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ─── Custom Confirm Dialog ────────────────────────────────────────────────────
let confirmCallback = null;

function confirm(msg, cb) {
    $('confirm-msg').textContent = msg;
    $('confirm-backdrop').classList.remove('hidden');
    confirmCallback = cb;
}

$('confirm-yes').addEventListener('click', () => {
    $('confirm-backdrop').classList.add('hidden');
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
});

$('confirm-no').addEventListener('click', () => {
    $('confirm-backdrop').classList.add('hidden');
    confirmCallback = null;
});
