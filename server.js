import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logsDir = path.join(__dirname, 'logs');
fs.mkdirSync(logsDir, { recursive: true });
const dbLog = (event, data) => {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const pairs = Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' | ');
  fs.appendFileSync(path.join(logsDir, 'database.log'), `${ts} | ${event} | ${pairs}\n`);
};
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'components.db');
const db = new DatabaseSync(DB_PATH);
// node:sqlite has no transaction helper.
const tx = (fn) => {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
};

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
  );
  CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
  );
  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY,
    main TEXT NOT NULL,
    secondary TEXT NOT NULL,
    UNIQUE(main, secondary)
  );
  CREATE TABLE IF NOT EXISTS components (
    inventory_key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    package TEXT,
    in_stock INTEGER DEFAULT 0,
    location TEXT,
    manufacturer_nr TEXT
  );
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY,
    inventory_key TEXT NOT NULL,
    report_type TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(inventory_key) REFERENCES components(inventory_key)
  );
  CREATE TABLE IF NOT EXISTS suggested_components (
    inventory_key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    package TEXT,
    in_stock INTEGER DEFAULT 0,
    location TEXT,
    manufacturer_nr TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS real_number_reports (
    id INTEGER PRIMARY KEY,
    inventory_key TEXT NOT NULL,
    reported_number INTEGER NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(inventory_key) REFERENCES components(inventory_key)
  )
`);

// Express 5 forwards anything a handler throws to the error middleware at the bottom.
const app = express();
app.use(express.json());

// Admin gate. Hashing both sides gives timingSafeEqual the equal lengths it requires.
// ponytail: one shared password, sent cleartext over LAN HTTP. Fine for a lab box;
// move to accounts + TLS if this ever leaves the local network.
const ADMIN_PW = process.env.ADMIN_PASSWORD;
if (!ADMIN_PW) throw new Error('ADMIN_PASSWORD is not set. Copy .env.example to .env and set one.');
const pwHash = (s) => crypto.createHash('sha256').update(String(s)).digest();
const requireAdmin = (req, res, next) =>
  crypto.timingSafeEqual(pwHash(req.get('x-admin-password')), pwHash(ADMIN_PW))
    ? next()
    : res.status(401).json({ error: 'Unauthorized' });

app.get('/api/admin/check', requireAdmin, (req, res) => res.json({ ok: true }));

app.get('/api/categories', (req, res) => res.json(db.prepare(`SELECT * FROM categories ORDER BY name`).all()));

app.post('/api/categories', (req, res) => {
  db.prepare(`INSERT OR IGNORE INTO categories (name) VALUES (?)`).run(req.body.name);
  res.json({ success: true });
});

app.get('/api/packages', (req, res) => res.json(db.prepare(`SELECT * FROM packages ORDER BY name`).all()));

app.post('/api/packages', (req, res) => {
  db.prepare(`INSERT OR IGNORE INTO packages (name) VALUES (?)`).run(req.body.name);
  res.json({ success: true });
});

app.get('/api/locations', (req, res) => res.json(db.prepare(`SELECT * FROM locations ORDER BY main, secondary`).all()));

// A main name holding the ' - ' separator would make the display string ambiguous to split.
app.post('/api/locations', (req, res) => {
  const main = String(req.body.main || '').trim();
  const secondary = String(req.body.secondary || '').trim();
  if (!main || !secondary) return res.status(400).json({ error: 'main and secondary required' });
  if (main.includes(' - ')) return res.status(400).json({ error: "main cannot contain ' - '" });
  db.prepare(`INSERT OR IGNORE INTO locations (main, secondary) VALUES (?, ?)`).run(main, secondary);
  res.json({ success: true });
});

app.get('/api/components', (req, res) => {
  const search = `%${req.query.search || ''}%`;
  const category = req.query.category || '';
  res.json(db.prepare(
    `SELECT * FROM components WHERE (name LIKE ?1 OR inventory_key LIKE ?1) AND (?2 = '' OR category = ?2)`
  ).all(search, category));
});

app.post('/api/components', requireAdmin, (req, res) => {
  const { inventory_key, name, category, package: pkg, in_stock, location, manufacturer_nr } = req.body;
  db.prepare(`INSERT INTO components VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(inventory_key, name, category, pkg, in_stock, location, manufacturer_nr);
  res.json({ success: true });
});

// Edit an existing part. inventory_key is the identity the reports hang off by FK,
// so it is read from the URL and never written.
app.put('/api/components/:key', requireAdmin, (req, res) => {
  const { name, category, package: pkg, in_stock, location, manufacturer_nr } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'name and category required' });
  const r = db.prepare(`UPDATE components SET name=?, category=?, package=?, in_stock=?, location=?, manufacturer_nr=? WHERE inventory_key=?`)
    .run(name, category, pkg ?? null, Number(in_stock) || 0, location ?? null, manufacturer_nr ?? null, req.params.key);
  if (!r.changes) return res.status(404).json({ error: 'No such component' });
  dbLog('COMPONENT_EDITED', { key: req.params.key, name, category, package: pkg, in_stock, location, manufacturer_nr });
  res.json({ success: true });
});

// reports and real_number_reports both hold a FK to components, so the part cannot
// go until its dependents do. The file audit log in logs/ keeps the permanent history.
app.delete('/api/components/:key', requireAdmin, (req, res) => {
  const key = req.params.key;
  const removed = tx(() => {
    db.prepare(`DELETE FROM reports WHERE inventory_key=?`).run(key);
    db.prepare(`DELETE FROM real_number_reports WHERE inventory_key=?`).run(key);
    return db.prepare(`DELETE FROM components WHERE inventory_key=?`).run(key).changes;
  });
  dbLog('COMPONENT_DELETED', { key, existed: removed > 0 });
  res.json({ success: true });
});

app.get('/api/suggested_components', (req, res) =>
  res.json(db.prepare(`SELECT * FROM suggested_components ORDER BY created_at DESC`).all()));

app.post('/api/suggested_components', (req, res) => {
  const { inventory_key, name, category, package: pkg, in_stock, location, manufacturer_nr } = req.body;
  db.prepare(
    `INSERT INTO suggested_components (inventory_key, name, category, package, in_stock, location, manufacturer_nr) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(inventory_key) DO UPDATE SET name=excluded.name, category=excluded.category, package=excluded.package,
     in_stock=excluded.in_stock, location=excluded.location, manufacturer_nr=excluded.manufacturer_nr, created_at=CURRENT_TIMESTAMP`
  ).run(inventory_key, name, category, pkg, in_stock, location, manufacturer_nr);
  res.json({ success: true });
});

app.delete('/api/suggested_components/:key', requireAdmin, (req, res) => {
  db.prepare(`DELETE FROM suggested_components WHERE inventory_key=?`).run(req.params.key);
  dbLog('SUGGESTION_REJECTED', { key: req.params.key });
  res.json({ success: true });
});

app.post('/api/suggested_components/:key/approve', requireAdmin, (req, res) => {
  const key = req.params.key;
  const approved = tx(() => {
    const s = db.prepare(`INSERT INTO components (inventory_key, name, category, package, in_stock, location, manufacturer_nr)
       SELECT inventory_key, name, category, package, in_stock, location, manufacturer_nr FROM suggested_components WHERE inventory_key=?
       ON CONFLICT(inventory_key) DO UPDATE SET name=excluded.name, category=excluded.category, package=excluded.package,
       in_stock=excluded.in_stock, location=excluded.location, manufacturer_nr=excluded.manufacturer_nr
       RETURNING name`).get(key);
    db.prepare(`DELETE FROM suggested_components WHERE inventory_key=?`).run(key);
    return s;
  });
  if (!approved) return res.status(404).json({ error: 'No such suggestion' });
  dbLog('SUGGESTION_APPROVED', { key, name: approved.name });
  res.json({ success: true });
});

// LEFT JOIN is defensive: deleting a part now clears its reports, so a null name
// would mean a row got orphaned some other way. Better to show it than to hide it.
app.get('/api/reports', requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT r.id, r.inventory_key, r.report_type, r.timestamp, c.name
    FROM reports r
    LEFT JOIN components c ON c.inventory_key = r.inventory_key
    ORDER BY r.timestamp DESC, r.id DESC
  `).all());
});

app.post('/api/reports', (req, res) => {
  const { inventory_key, report_type } = req.body;
  db.prepare(`INSERT INTO reports (inventory_key, report_type) VALUES (?, ?)`).run(inventory_key, report_type);
  dbLog('REPORT_ADDED', { key: inventory_key, type: report_type });
  if (report_type === 'Not in stock') {
    const count = db.prepare(`SELECT COUNT(*) as cnt FROM reports WHERE inventory_key = ? AND report_type = 'Not in stock'`).get(inventory_key).cnt;
    if (count >= 2) {
      db.prepare(`UPDATE components SET in_stock = 0 WHERE inventory_key = ?`).run(inventory_key);
      dbLog('AUTO_ZERO', { key: inventory_key, count, in_stock_set_to: 0 });
    }
  }
  res.json({ success: true });
});

app.post('/api/components/:key/use', (req, res) => {
  const { amount, action } = req.body;
  const comp = db.prepare(`SELECT in_stock FROM components WHERE inventory_key = ?`).get(req.params.key);
  const delta = action === 'take' ? -amount : amount;
  const newStock = Math.max(0, comp.in_stock + delta);
  db.prepare(`UPDATE components SET in_stock = ? WHERE inventory_key = ?`).run(newStock, req.params.key);
  db.prepare(`UPDATE real_number_reports SET reported_number = reported_number + ? WHERE inventory_key = ?`).run(delta, req.params.key);
  dbLog('USE_ACTION', { key: req.params.key, action, amount, delta, new_in_stock: newStock });
  res.json({ success: true, in_stock: newStock });
});

app.post('/api/components/:key/report-real', (req, res) => {
  const { reported_number } = req.body;
  const count = db.prepare(`SELECT COUNT(*) as cnt FROM real_number_reports WHERE inventory_key = ? AND reported_number = ?`).get(req.params.key, reported_number).cnt;
  if (count >= 1) {
    db.prepare(`UPDATE components SET in_stock = ? WHERE inventory_key = ?`).run(reported_number, req.params.key);
    db.prepare(`DELETE FROM real_number_reports WHERE inventory_key = ?`).run(req.params.key);
    dbLog('REPORT_REAL_MATCH', { key: req.params.key, reported_number, in_stock_updated: reported_number });
  } else {
    db.prepare(`INSERT INTO real_number_reports (inventory_key, reported_number) VALUES (?, ?)`).run(req.params.key, reported_number);
    dbLog('REPORT_REAL_NEW', { key: req.params.key, reported_number });
  }
  res.json({ success: true });
});

app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
