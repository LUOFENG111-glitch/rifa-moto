require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const XLSX = require('xlsx');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'rifa2024';

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// ─── File Upload (multer) ──────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
  filename: (req, file, cb) => cb(null, 'moto' + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Database ──────────────────────────────────────────────────────────────────
const db = new sqlite3.Database(path.join(__dirname, 'database.db'));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    number INTEGER PRIMARY KEY,
    status TEXT DEFAULT 'available',
    buyer_id INTEGER,
    reserved_at TEXT,
    sold_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS buyers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    ticket_number INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // Seed 400 tickets if empty
  db.get('SELECT COUNT(*) as count FROM tickets', (err, row) => {
    if (!err && row.count === 0) {
      const stmt = db.prepare('INSERT OR IGNORE INTO tickets (number, status) VALUES (?, ?)');
      for (let i = 1; i <= 400; i++) stmt.run(i, 'available');
      stmt.finalize();
    }
  });

  // Default settings
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('price', '50')`);
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('moto_image', '/uploads/moto.jpg')`);
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('raffle_name', 'Gran Rifa Suzuki GSX-R')`);
});

// ─── Auth Middleware ───────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

// ─── Public Routes ─────────────────────────────────────────────────────────────

// GET all tickets
app.get('/api/tickets', (req, res) => {
  db.all('SELECT * FROM tickets ORDER BY number', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// GET settings
app.get('/api/settings', (req, res) => {
  db.all('SELECT key, value FROM settings', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  });
});

// POST - Purchase a ticket (atomic, concurrency-safe)
app.post('/api/tickets/:num/purchase', (req, res) => {
  const num = parseInt(req.params.num);
  const { name, phone } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'Faltan datos del comprador' });
  }
  if (num < 1 || num > 400) {
    return res.status(400).json({ error: 'Número inválido' });
  }

  db.serialize(() => {
    db.run('BEGIN EXCLUSIVE TRANSACTION', (err) => {
      if (err) return res.status(500).json({ error: 'Error de transacción' });

      db.get('SELECT * FROM tickets WHERE number = ?', [num], (err, ticket) => {
        if (err || !ticket) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Boleto no encontrado' });
        }
        if (ticket.status !== 'available') {
          db.run('ROLLBACK');
          return res.status(409).json({ error: 'Este boleto ya fue vendido' });
        }

        db.run(
          'INSERT INTO buyers (name, phone, payment_method, ticket_number) VALUES (?, ?, ?, ?)',
          [name, phone, 'WhatsApp', num],
          function (err) {
            if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
            const buyerId = this.lastID;

            db.run(
              `UPDATE tickets SET status='sold', buyer_id=?, sold_at=datetime('now','localtime') WHERE number=?`,
              [buyerId, num],
              (err) => {
                if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
                db.run('COMMIT', () => {
                  const updatedTicket = { number: num, status: 'sold', buyer_id: buyerId };
                  io.emit('ticket_updated', updatedTicket);
                  res.json({ success: true, ticket: updatedTicket, buyer: { name, phone } });
                });
              }
            );
          }
        );
      });
    });
  });
});

// ─── Admin Routes ──────────────────────────────────────────────────────────────

// POST - Admin login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ success: true, token });
  }
  res.status(401).json({ error: 'Credenciales incorrectas' });
});

// GET - All buyers list
app.get('/api/admin/buyers', authMiddleware, (req, res) => {
  db.all(
    `SELECT b.*, t.status FROM buyers b 
     LEFT JOIN tickets t ON t.number = b.ticket_number 
     ORDER BY b.created_at DESC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// GET - Statistics
app.get('/api/admin/stats', authMiddleware, (req, res) => {
  db.get(`SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN status='sold' THEN 1 ELSE 0 END) as sold,
    SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) as available
    FROM tickets`, (err, stats) => {
    if (err) return res.status(500).json({ error: err.message });
    db.get('SELECT value FROM settings WHERE key="price"', (err2, priceRow) => {
      const price = parseFloat(priceRow?.value || 0);
      res.json({
        total: stats.total,
        sold: stats.sold,
        available: stats.available,
        revenue: stats.sold * price
      });
    });
  });
});

// PUT - Admin toggle ticket status
app.put('/api/admin/tickets/:num', authMiddleware, (req, res) => {
  const num = parseInt(req.params.num);
  const { status, name, phone, payment_method } = req.body;

  if (!['available', 'sold'].includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  db.serialize(() => {
    db.run('BEGIN EXCLUSIVE TRANSACTION', () => {
      if (status === 'sold') {
        const buyerName = name || 'Admin';
        const buyerPhone = phone || 'N/A';
        const buyerPayment = payment_method || 'Manual';

        db.run(
          'DELETE FROM buyers WHERE ticket_number = ?', [num], () => {
            db.run(
              'INSERT INTO buyers (name, phone, payment_method, ticket_number) VALUES (?, ?, ?, ?)',
              [buyerName, buyerPhone, buyerPayment, num],
              function () {
                db.run(
                  `UPDATE tickets SET status='sold', buyer_id=?, sold_at=datetime('now','localtime') WHERE number=?`,
                  [this.lastID, num],
                  () => {
                    db.run('COMMIT', () => {
                      io.emit('ticket_updated', { number: num, status: 'sold' });
                      res.json({ success: true });
                    });
                  }
                );
              }
            );
          }
        );
      } else {
        db.run('DELETE FROM buyers WHERE ticket_number = ?', [num], () => {
          db.run(
            `UPDATE tickets SET status='available', buyer_id=NULL, sold_at=NULL WHERE number=?`,
            [num],
            () => {
              db.run('COMMIT', () => {
                io.emit('ticket_updated', { number: num, status: 'available' });
                res.json({ success: true });
              });
            }
          );
        });
      }
    });
  });
});

// PUT - Update settings (price, raffle name)
app.put('/api/admin/settings', authMiddleware, (req, res) => {
  const { price, raffle_name } = req.body;
  const updates = [];
  if (price !== undefined) updates.push(['price', String(price)]);
  if (raffle_name !== undefined) updates.push(['raffle_name', raffle_name]);

  const stmt = db.prepare('UPDATE settings SET value=? WHERE key=?');
  updates.forEach(([key, val]) => stmt.run(val, key));
  stmt.finalize(() => {
    io.emit('settings_updated', { price, raffle_name });
    res.json({ success: true });
  });
});

// POST - Upload moto image
app.post('/api/admin/upload', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió imagen' });
  const imagePath = '/uploads/' + req.file.filename;
  db.run('UPDATE settings SET value=? WHERE key="moto_image"', [imagePath], () => {
    io.emit('settings_updated', { moto_image: imagePath });
    res.json({ success: true, path: imagePath });
  });
});

// POST - Reset raffle
app.post('/api/admin/reset', authMiddleware, (req, res) => {
  db.serialize(() => {
    db.run('DELETE FROM buyers');
    db.run('UPDATE tickets SET status="available", buyer_id=NULL, sold_at=NULL, reserved_at=NULL', () => {
      io.emit('raffle_reset');
      res.json({ success: true });
    });
  });
});

// GET - Export Excel
app.get('/api/admin/export', authMiddleware, (req, res) => {
  db.all(
    `SELECT b.ticket_number as "N° Boleto", b.name as "Nombre", b.phone as "Teléfono",
     b.created_at as "Fecha"
     FROM buyers b ORDER BY b.ticket_number`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Compradores');

      // Column widths
      ws['!cols'] = [{ wch: 12 }, { wch: 25 }, { wch: 18 }, { wch: 22 }];

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', 'attachment; filename=compradores_rifa.xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buf);
    }
  );
});

// ─── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('🔌 Cliente conectado:', socket.id);
  socket.on('disconnect', () => console.log('❌ Cliente desconectado:', socket.id));
});

// ─── Start Server ──────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🏍️  Rifa Moto server running on http://localhost:${PORT}`);
  console.log(`📋 Admin panel: http://localhost:${PORT}/admin.html`);
  console.log(`👤 Admin: ${ADMIN_USER} / ${ADMIN_PASS}\n`);
});
