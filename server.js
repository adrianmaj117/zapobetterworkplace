const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;
const bundledDbPath = path.join(__dirname, 'zapobetterworkplace.db');
const dbPath = process.env.DATABASE_PATH || bundledDbPath;
if (dbPath !== bundledDbPath && !fs.existsSync(dbPath) && fs.existsSync(bundledDbPath)) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.copyFileSync(bundledDbPath, dbPath);
}
const db = new DatabaseSync(dbPath);
const sessions = new Set();

db.exec('PRAGMA journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Inne',
    unit TEXT NOT NULL DEFAULT 'szt.',
    quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    min_quantity REAL NOT NULL DEFAULT 0,
    expiration_date TEXT,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('add', 'remove', 'demand', 'adjustment')),
    quantity REAL NOT NULL,
    note TEXT DEFAULT '',
    movement_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS product_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    quantity REAL NOT NULL CHECK(quantity >= 0),
    expiration_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );
`);
if (!db.prepare("PRAGMA table_info(products)").all().some(column => column.name === 'weight_grams')) {
  db.exec('ALTER TABLE products ADD COLUMN weight_grams REAL');
}
if (!db.prepare("PRAGMA table_info(products)").all().some(column => column.name === 'weight_value')) {
  db.exec('ALTER TABLE products ADD COLUMN weight_value REAL');
  db.exec('ALTER TABLE products ADD COLUMN weight_unit TEXT');
}
for (const [name, type] of [['brand','TEXT'], ['received_date','TEXT'], ['image_data','TEXT']]) {
  if (!db.prepare('PRAGMA table_info(products)').all().some(column => column.name === name)) db.exec(`ALTER TABLE products ADD COLUMN ${name} ${type}`);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function authenticated(req) { return sessions.has(req.get('x-session-token')); }
app.post('/api/login', (req, res) => {
  if (req.body.username !== 'adminkrakow' || req.body.password !== 'krakowstany') return res.status(401).json({ error: 'Nieprawidłowy login lub hasło.' });
  const token = crypto.randomBytes(24).toString('hex'); sessions.add(token); res.json({ token });
});
app.use('/api', (req, res, next) => authenticated(req) ? next() : res.status(401).json({ error: 'Zaloguj się, aby zobaczyć magazyn.' }));

function productById(id) {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
}

function validNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseExpiration(value) {
  if (!value) return null;
  const iso = String(value).match(/^\d{4}-\d{2}-\d{2}$/);
  if (iso) return value;
  const full = String(value).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (full) return `${full[3]}-${full[2]}-${full[1]}`;
  const month = String(value).match(/(\d{2})\.(\d{4})/);
  return month ? `${month[2]}-${month[1]}-01` : null;
}

function categoryFor(name) {
  const text = name.toLowerCase();
  if (text.includes('baton') || text.includes('bar')) return 'Batony i przekąski';
  if (text.includes('ciastecz')) return 'Ciastka i słodycze';
  if (text.includes('anyż') || text.includes('prymat')) return 'Przyprawy';
  return 'Inne';
}

function parseImportLine(line) {
  const clean = line.replace(/[\t*]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const dateMatch = clean.match(/\b(?:\d{2}\.\d{2}\.\d{4}|\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})\b/);
  const expiration_date = parseExpiration(dateMatch?.[0]);
  const withoutDate = dateMatch ? clean.replace(dateMatch[0], '').trim() : clean;
  const matches = [...withoutDate.matchAll(/(\d+(?:[,.]\d+)?)\s*(szt\.?|opak\.?|op\.?|kg|g|ml|l)\b/gi)];
  let quantity = 1, unit = 'szt.', weight_grams = null;
  for (const match of matches) {
    const amount = Number(match[1].replace(',', '.'));
    const label = match[2].toLowerCase().replace('.', '');
    if (label === 'g') weight_grams = amount;
    else if (label === 'kg') weight_grams = amount * 1000;
    else if (['szt', 'opak', 'op'].includes(label)) { quantity = amount; unit = label === 'szt' ? 'szt.' : 'opak.'; }
    else { quantity = amount; unit = label; }
  }
  const name = withoutDate.replace(/\(?\s*\d+(?:[,.]\d+)?\s*(?:szt\.?|opak\.?|op\.?|kg|g|ml|l)\s*\)?/gi, '').replace(/\s{2,}/g, ' ').trim().replace(/[,(\-–]+$/g, '').trim();
  return name ? { name, category: categoryFor(name), unit, quantity, weight_grams, expiration_date, min_quantity: 0, notes: '' } : null;
}

app.get('/api/dashboard', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const threshold = nextMonth.toISOString().slice(0, 10);
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS totalProducts,
      COALESCE(SUM(quantity), 0) AS totalUnits,
      SUM(CASE WHEN quantity <= min_quantity THEN 1 ELSE 0 END) AS lowStock,
      SUM(CASE WHEN expiration_date IS NOT NULL AND expiration_date < ? THEN 1 ELSE 0 END) AS expired,
      SUM(CASE WHEN expiration_date IS NOT NULL AND expiration_date >= ? AND expiration_date <= ? THEN 1 ELSE 0 END) AS expiringSoon
    FROM products
  `).get(today, today, threshold);
  const alerts = db.prepare(`
    SELECT * FROM products
    WHERE quantity <= min_quantity OR (expiration_date IS NOT NULL AND expiration_date <= ?)
    ORDER BY CASE WHEN expiration_date IS NULL THEN 1 ELSE 0 END, expiration_date ASC
    LIMIT 8
  `).all(threshold);
  const nearestExpiry = db.prepare(`SELECT * FROM products WHERE expiration_date IS NOT NULL AND expiration_date >= ? ORDER BY expiration_date ASC LIMIT 1`).get(today);
  res.json({ ...summary, alerts, nearestExpiry, today, threshold });
});

app.get('/api/products', (req, res) => {
  const { search = '', category = '', sort = 'expiration' } = req.query;
  const orderBy = {
    expiration: "CASE WHEN expiration_date IS NULL THEN 1 ELSE 0 END, expiration_date ASC",
    name: 'name COLLATE NOCASE ASC',
    quantity: 'quantity ASC',
    newest: 'created_at DESC'
  }[sort] || 'name COLLATE NOCASE ASC';
  const rows = db.prepare(`
    SELECT * FROM products
    WHERE name LIKE @search AND (@category = '' OR category = @category)
    ORDER BY ${orderBy}
  `).all({ search: `%${search.trim()}%`, category });
  res.json(rows);
});

app.get('/api/categories', (req, res) => {
  res.json(db.prepare("SELECT DISTINCT category FROM products WHERE category <> '' ORDER BY category COLLATE NOCASE").all().map(r => r.category));
});

app.post('/api/products', (req, res) => {
  const { name, category = 'Inne', brand = '', unit = 'szt.', quantity = 0, min_quantity = 0, weight_value = null, weight_unit = null, expiration_date = null, received_date = null, image_data = null, notes = '' } = req.body;
  if (!name || !name.trim() || !validNumber(quantity) || quantity < 0 || !validNumber(min_quantity) || min_quantity < 0) {
    return res.status(400).json({ error: 'Podaj nazwę oraz prawidłowe ilości.' });
  }
  const result = db.prepare(`INSERT INTO products (name, category, brand, unit, quantity, min_quantity, weight_value, weight_unit, expiration_date, received_date, image_data, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(name.trim(), category.trim() || 'Inne', brand.trim(), unit.trim() || 'szt.', quantity, min_quantity, validNumber(weight_value) && weight_value > 0 ? weight_value : null, weight_unit || null, parseExpiration(expiration_date), parseExpiration(received_date), image_data || null, notes.trim());
  if (quantity > 0) db.prepare("INSERT INTO movements (product_id, type, quantity, note) VALUES (?, 'add', ?, 'Stan początkowy')").run(result.lastInsertRowid, quantity);
  res.status(201).json(productById(result.lastInsertRowid));
});

app.put('/api/products/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = productById(id);
  if (!existing) return res.status(404).json({ error: 'Nie znaleziono produktu.' });
  const { name, category, unit, min_quantity = 0, weight_value = null, weight_unit = null, expiration_date, notes } = req.body;
  if (!name || !name.trim() || !validNumber(min_quantity) || min_quantity < 0) return res.status(400).json({ error: 'Sprawdź wymagane pola.' });
  db.prepare(`UPDATE products SET name=?, category=?, unit=?, min_quantity=?, weight_value=?, weight_unit=?, expiration_date=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(name.trim(), (category || 'Inne').trim(), (unit || 'szt.').trim(), min_quantity, validNumber(weight_value) && weight_value > 0 ? weight_value : null, weight_unit || null, parseExpiration(expiration_date), (notes || '').trim(), id);
  res.json(productById(id));
});

app.delete('/api/products/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!productById(id)) return res.status(404).json({ error: 'Nie znaleziono produktu.' });
  db.prepare('DELETE FROM movements WHERE product_id = ?').run(id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.status(204).end();
});

app.post('/api/products/:id/movement', (req, res) => {
  const id = Number(req.params.id);
  const product = productById(id);
  const { type, quantity, note = '' } = req.body;
  if (!product) return res.status(404).json({ error: 'Nie znaleziono produktu.' });
  if (!['add', 'remove', 'demand', 'adjustment'].includes(type) || !validNumber(quantity) || quantity <= 0) return res.status(400).json({ error: 'Podaj prawidłową zmianę stanu.' });
  const increase = type === 'add';
  const newQuantity = increase ? product.quantity + quantity : product.quantity - quantity;
  if (newQuantity < 0) return res.status(400).json({ error: `Brakuje produktu. Dostępny stan: ${product.quantity} ${product.unit}.` });
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE products SET quantity=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(newQuantity, id);
    db.prepare('INSERT INTO movements (product_id, type, quantity, note) VALUES (?, ?, ?, ?)').run(id, type, quantity, note.trim());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  res.json(productById(id));
});

app.get('/api/products/:id/movements', (req, res) => {
  res.json(db.prepare('SELECT * FROM movements WHERE product_id = ? ORDER BY movement_date DESC, id DESC LIMIT 30').all(Number(req.params.id)));
});

app.get('/api/products/:id/batches', (req, res) => {
  res.json(db.prepare('SELECT * FROM product_batches WHERE product_id=? ORDER BY expiration_date IS NULL, expiration_date ASC').all(Number(req.params.id)));
});

app.post('/api/products/:id/batches', (req, res) => {
  const product = productById(Number(req.params.id));
  const quantity = Number(req.body.quantity);
  const expiration = parseExpiration(req.body.expiration_date);
  if (!product || !Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Podaj prawidłową ilość partii.' });
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO product_batches (product_id, quantity, expiration_date) VALUES (?, ?, ?)').run(product.id, quantity, expiration);
    db.prepare('UPDATE products SET quantity=quantity+?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(quantity, product.id);
    db.prepare("INSERT INTO movements (product_id, type, quantity, note) VALUES (?, 'add', ?, 'Nowa partia')").run(product.id, quantity);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.status(201).json(productById(product.id));
});

app.post('/api/import/preview', (req, res) => {
  const items = String(req.body.text || '').split(/\r?\n/).map(parseImportLine).filter(Boolean);
  res.json(items);
});

app.post('/api/import', (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'Brak poprawnych artykułów do dodania.' });
  const add = db.prepare(`INSERT INTO products (name, category, unit, quantity, min_quantity, weight_grams, expiration_date, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`);
  const movement = db.prepare("INSERT INTO movements (product_id, type, quantity, note) VALUES (?, 'add', ?, 'Import listy')");
  db.exec('BEGIN');
  try {
    for (const item of items) {
      if (!item.name || !validNumber(item.quantity) || item.quantity < 0) continue;
      const result = add.run(item.name.trim(), item.category || categoryFor(item.name), item.unit || 'szt.', item.quantity, validNumber(item.min_quantity) ? item.min_quantity : 0, validNumber(item.weight_grams) ? item.weight_grams : null, parseExpiration(item.expiration_date), item.notes || '');
      if (item.quantity > 0) movement.run(result.lastInsertRowid, item.quantity);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.status(201).json({ added: items.length });
});

app.listen(PORT, () => console.log(`ZapoBetterWorkPlace działa: http://localhost:${PORT}`));
