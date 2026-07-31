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

// Telefon zapisuje zdjęcia jako dane obrazu. Domyślny limit Expressa (100 KB)
// był zbyt mały, dlatego pozwalamy na bezpieczne zdjęcia do 15 MB.
db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

function syncBundledInventory() {
  if (dbPath === bundledDbPath || !fs.existsSync(bundledDbPath)) return 0;
  const seeded = db.prepare("SELECT value FROM app_settings WHERE key='initial_inventory_seeded'").get();
  if (seeded) return 0;
  // Existing Railway volume already has user data. Mark it as initialized,
  // but never re-add products that were deliberately removed by the user.
  if (db.prepare('SELECT COUNT(*) AS count FROM products').get().count > 0) {
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('initial_inventory_seeded', 'true')").run();
    return 0;
  }
  const source = new DatabaseSync(bundledDbPath, { readOnly: true });
  const products = source.prepare('SELECT name, category, brand, unit, quantity, min_quantity, weight_grams, weight_value, weight_unit, expiration_date, received_date, image_data, notes FROM products').all();
  const exists = db.prepare("SELECT id FROM products WHERE name=? AND category=? AND COALESCE(brand,'')=COALESCE(?, '') AND COALESCE(weight_value,-1)=COALESCE(?,-1) AND COALESCE(weight_unit,'')=COALESCE(?, '') LIMIT 1");
  const add = db.prepare(`INSERT INTO products (name, category, brand, unit, quantity, min_quantity, weight_grams, weight_value, weight_unit, expiration_date, received_date, image_data, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`);
  let added = 0;
  db.exec('BEGIN');
  try {
    for (const item of products) {
      if (exists.get(item.name, item.category, item.brand || '', item.weight_value, item.weight_unit || '')) continue;
      const result = add.run(item.name, item.category, item.brand || '', item.unit || 'szt.', item.quantity, item.min_quantity || 0, item.weight_grams, item.weight_value, item.weight_unit, item.expiration_date, item.received_date, item.image_data, item.notes || '');
      if (item.quantity > 0) db.prepare("INSERT INTO movements (product_id, type, quantity, note) VALUES (?, 'add', ?, 'Import bazy początkowej')").run(result.lastInsertRowid, item.quantity);
      added += 1;
    }
    db.exec('COMMIT');
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('initial_inventory_seeded', 'true')").run();
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  source.close();
  return added;
}
const bundledItemsAdded = syncBundledInventory();
if (bundledItemsAdded) console.log(`Dodano ${bundledItemsAdded} brakujących produktów do bazy.`);

app.use(express.json({ limit: '15mb' }));
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
function storedBrand(category, brand) {
  return brand === 'Pozostałe' || (category === 'Bakalie' && brand === 'HEBAR') ? '' : brand;
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

db.exec(`CREATE TABLE IF NOT EXISTS category_images (
  category TEXT PRIMARY KEY,
  image_data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
db.exec(`CREATE TABLE IF NOT EXISTS inventory_paths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL CHECK(level IN ('category','brand','weight')),
  category TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  weight_value REAL,
  weight_unit TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(level, category, brand, weight_value, weight_unit)
)`);
function moveTileImage(from, to) {
  if (from === to) return;
  const image = db.prepare('SELECT image_data FROM category_images WHERE category=?').get(from);
  if (!image) return;
  // Destination can already have its own photo. Replace it deliberately,
  // rather than letting the UNIQUE key stop the whole rename operation.
  db.prepare('DELETE FROM category_images WHERE category=?').run(to);
  db.prepare('UPDATE category_images SET category=?, updated_at=CURRENT_TIMESTAMP WHERE category=?').run(to, from);
}
app.get('/api/category-images', (req, res) => res.json(db.prepare('SELECT category, image_data FROM category_images').all()));
app.get('/api/paths', (req, res) => res.json(db.prepare('SELECT level, category, brand, weight_value, weight_unit FROM inventory_paths ORDER BY id').all()));
app.post('/api/paths', (req, res) => {
  const { level, category = '', brand = '', value = '' } = req.body;
  const name = String(value).trim();
  if (!name || !['category','brand','weight'].includes(level)) return res.status(400).json({ error: 'Podaj nazwę nowej gałęzi.' });
  let row;
  if (level === 'category') row = { level, category:name, brand:'', weight_value:null, weight_unit:null };
  else if (level === 'brand') row = { level, category, brand:name, weight_value:null, weight_unit:null };
  else {
    const match = name.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)$/i);
    if (!match) return res.status(400).json({ error: 'Podaj gramaturę np. 400 ml.' });
    row = { level, category, brand, weight_value:Number(match[1].replace(',', '.')), weight_unit:match[2].toLowerCase() };
  }
  db.prepare('INSERT OR IGNORE INTO inventory_paths (level, category, brand, weight_value, weight_unit) VALUES (?, ?, ?, ?, ?)').run(row.level, row.category, row.brand, row.weight_value, row.weight_unit);
  res.status(201).json(row);
});
app.delete('/api/paths', (req, res) => {
  const { level, category = '', brand = '', weight_value = null, weight_unit = '', password = '' } = req.body;
  if (password !== '123') return res.status(403).json({ error: 'Nieprawidłowe hasło.' });
  const sourceBrand = storedBrand(category, brand);
  let where = '', params = [], imageFilter = '', imageParams = [];
  if (level === 'category') { where = 'category=?'; params = [category]; imageFilter = 'category=? OR category LIKE ? OR category LIKE ?'; imageParams = [`category:${category}`, `brand:${category}:%`, `weight:${category}:%`]; }
  else if (level === 'brand') { where = "category=? AND (COALESCE(brand,'')=COALESCE(?, '') OR (?='' AND brand='Pozostałe'))"; params = [category, sourceBrand, sourceBrand]; imageFilter = 'category=? OR category LIKE ?'; imageParams = [`brand:${category}:${brand}`, `weight:${category}:${brand}:%`]; }
  else if (level === 'weight') { where = "category=? AND (COALESCE(brand,'')=COALESCE(?, '') OR (?='' AND brand='Pozostałe')) AND COALESCE(weight_value,-1)=COALESCE(?,-1) AND COALESCE(weight_unit,'')=COALESCE(?, '')"; params = [category, sourceBrand, sourceBrand, weight_value, weight_unit]; imageFilter = 'category=?'; imageParams = [`weight:${category}:${brand}:${weight_value} ${weight_unit}`]; }
  else return res.status(400).json({ error: 'Nieznany poziom ścieżki.' });
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM movements WHERE product_id IN (SELECT id FROM products WHERE ${where})`).run(...params);
    db.prepare(`DELETE FROM product_batches WHERE product_id IN (SELECT id FROM products WHERE ${where})`).run(...params);
    const result = db.prepare(`DELETE FROM products WHERE ${where}`).run(...params);
    if (level === 'category') db.prepare('DELETE FROM inventory_paths WHERE category=?').run(category);
    else if (level === 'brand') db.prepare('DELETE FROM inventory_paths WHERE category=? AND brand=?').run(category, brand);
    else db.prepare('DELETE FROM inventory_paths WHERE level=? AND category=? AND brand=? AND weight_value=? AND weight_unit=?').run('weight', category, brand, weight_value, weight_unit);
    db.prepare(`DELETE FROM category_images WHERE ${imageFilter}`).run(...imageParams);
    db.exec('COMMIT'); res.json({ deleted: result.changes });
  } catch (error) { db.exec('ROLLBACK'); throw error; }
});
app.post('/api/category-images', (req, res) => {
  const { category, image_data } = req.body;
  if (!category || !String(image_data || '').startsWith('data:image/')) return res.status(400).json({ error: 'Wybierz prawidłowe zdjęcie.' });
  db.prepare(`INSERT INTO category_images (category, image_data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(category) DO UPDATE SET image_data=excluded.image_data, updated_at=CURRENT_TIMESTAMP`).run(category, image_data);
  res.status(201).json({ category });
});

app.patch('/api/paths/rename', (req, res) => {
  const { level, category = '', brand = '', weight_value = null, weight_unit = '', value = '' } = req.body;
  const next = String(value).trim();
  const sourceBrand = storedBrand(category, brand);
  if (!next) return res.status(400).json({ error: 'Podaj nową nazwę.' });
  let result;
  if (level === 'category') {
    result = db.prepare('UPDATE products SET category=?, updated_at=CURRENT_TIMESTAMP WHERE category=?').run(next, category);
    db.prepare('UPDATE inventory_paths SET category=? WHERE category=?').run(next, category);
    moveTileImage(`category:${category}`, `category:${next}`);
  } else if (level === 'brand') {
    result = db.prepare("UPDATE products SET brand=?, updated_at=CURRENT_TIMESTAMP WHERE category=? AND (COALESCE(brand,'')=COALESCE(?, '') OR (?='' AND brand='Pozostałe'))").run(next, category, sourceBrand, sourceBrand);
    db.prepare("UPDATE inventory_paths SET brand=? WHERE category=? AND brand=?").run(next, category, brand);
    moveTileImage(`brand:${category}:${brand}`, `brand:${category}:${next}`);
  } else if (level === 'weight') {
    const match = next.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)$/i);
    if (!match) return res.status(400).json({ error: 'Wpisz gramaturę np. 200 ml lub 1 kg.' });
    const nextValue = Number(match[1].replace(',', '.')), nextUnit = match[2].toLowerCase();
    result = db.prepare("UPDATE products SET weight_value=?, weight_unit=?, updated_at=CURRENT_TIMESTAMP WHERE category=? AND (COALESCE(brand,'')=COALESCE(?, '') OR (?='' AND brand='Pozostałe')) AND COALESCE(weight_value,-1)=COALESCE(?,-1) AND COALESCE(weight_unit,'')=COALESCE(?, '')").run(nextValue, nextUnit, category, sourceBrand, sourceBrand, weight_value, weight_unit);
    db.prepare('UPDATE inventory_paths SET weight_value=?, weight_unit=? WHERE level=? AND category=? AND brand=? AND weight_value=? AND weight_unit=?').run(nextValue, nextUnit, 'weight', category, brand, weight_value, weight_unit);
    moveTileImage(`weight:${category}:${brand}:${weight_value} ${weight_unit}`, `weight:${category}:${brand}:${nextValue} ${nextUnit}`);
  } else return res.status(400).json({ error: 'Nieznany poziom ścieżki.' });
  res.json({ changed: result.changes });
});

app.patch('/api/paths/move', (req, res) => {
  const { level, category = '', brand = '', weight_value = null, weight_unit = '', target = '' } = req.body;
  const destination = String(target).trim();
  const sourceBrand = storedBrand(category, brand);
  if (!destination) return res.status(400).json({ error: 'Wybierz miejsce docelowe.' });
  let result;
  if (level === 'category') {
    result = db.prepare('UPDATE products SET category=?, updated_at=CURRENT_TIMESTAMP WHERE category=?').run(destination, category);
  } else if (level === 'brand') {
    const destinationBrand = destination === 'Pozostałe' ? '' : destination;
    result = db.prepare("UPDATE products SET brand=?, updated_at=CURRENT_TIMESTAMP WHERE category=? AND COALESCE(brand,'')=COALESCE(?, '')").run(destinationBrand, category, sourceBrand);
  } else if (level === 'weight') {
    const match = destination.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)$/i);
    if (!match) return res.status(400).json({ error: 'Wybierz prawidłową gramaturę.' });
    result = db.prepare("UPDATE products SET weight_value=?, weight_unit=?, updated_at=CURRENT_TIMESTAMP WHERE category=? AND COALESCE(brand,'')=COALESCE(?, '') AND COALESCE(weight_value,-1)=COALESCE(?,-1) AND COALESCE(weight_unit,'')=COALESCE(?, '')")
      .run(Number(match[1].replace(',', '.')), match[2].toLowerCase(), category, sourceBrand, weight_value, weight_unit);
  } else return res.status(400).json({ error: 'Nieznany poziom ścieżki.' });
  res.json({ moved: result.changes });
});

app.patch('/api/paths/move-full', (req, res) => {
  const { level, category = '', brand = '', weight_value = null, weight_unit = '', target_category = '', target_brand = '', target_weight = '' } = req.body;
  const sourceBrand = storedBrand(category, brand);
  const destinationBrand = target_brand === 'Pozostałe' ? '' : target_brand;
  const match = String(target_weight).match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)$/i);
  if (!target_category || !target_brand || !match) return res.status(400).json({ error: 'Wybierz kategorię, firmę i gramaturę.' });
  const targetValue = Number(match[1].replace(',', '.')), targetUnit = match[2].toLowerCase();
  let result;
  if (level === 'category') result = db.prepare('UPDATE products SET category=?, updated_at=CURRENT_TIMESTAMP WHERE category=?').run(target_category, category);
  else if (level === 'brand') result = db.prepare("UPDATE products SET category=?, brand=?, updated_at=CURRENT_TIMESTAMP WHERE category=? AND (COALESCE(brand,'')=COALESCE(?, '') OR (?='' AND brand='Pozostałe'))").run(target_category, destinationBrand, category, sourceBrand, sourceBrand);
  else if (level === 'weight') result = db.prepare("UPDATE products SET category=?, brand=?, weight_value=?, weight_unit=?, updated_at=CURRENT_TIMESTAMP WHERE category=? AND (COALESCE(brand,'')=COALESCE(?, '') OR (?='' AND brand='Pozostałe')) AND COALESCE(weight_value,-1)=COALESCE(?,-1) AND COALESCE(weight_unit,'')=COALESCE(?, '')").run(target_category, destinationBrand, targetValue, targetUnit, category, sourceBrand, sourceBrand, weight_value, weight_unit);
  else return res.status(400).json({ error: 'Nieznany poziom ścieżki.' });
  res.json({ moved: result.changes });
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
  const { name, category, brand = '', unit, quantity = existing.quantity, min_quantity = 0, weight_value = null, weight_unit = null, received_date, expiration_date, notes } = req.body;
  if (!name || !name.trim() || !validNumber(min_quantity) || min_quantity < 0) return res.status(400).json({ error: 'Sprawdź wymagane pola.' });
  if (!validNumber(quantity) || quantity < 0) return res.status(400).json({ error: 'Podaj prawidłową ilość.' });
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE products SET name=?, category=?, brand=?, unit=?, quantity=?, min_quantity=?, weight_value=?, weight_unit=?, received_date=?, expiration_date=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(name.trim(), (category || 'Inne').trim(), brand.trim(), (unit || 'szt.').trim(), quantity, min_quantity, validNumber(weight_value) && weight_value > 0 ? weight_value : null, weight_unit || null, parseExpiration(received_date), parseExpiration(expiration_date), (notes || '').trim(), id);
    const difference = quantity - existing.quantity;
    if (difference !== 0) db.prepare("INSERT INTO movements (product_id, type, quantity, note) VALUES (?, 'adjustment', ?, 'Edycja ilości')").run(id, Math.abs(difference));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.json(productById(id));
});

app.delete('/api/products/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!productById(id)) return res.status(404).json({ error: 'Nie znaleziono produktu.' });
  db.prepare('DELETE FROM movements WHERE product_id = ?').run(id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.status(204).end();
});

app.post('/api/products/bulk-delete', (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return res.status(400).json({ error: 'Zaznacz co najmniej jeden artykuł.' });
  const marks = ids.map(() => '?').join(',');
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM movements WHERE product_id IN (${marks})`).run(...ids);
    db.prepare(`DELETE FROM product_batches WHERE product_id IN (${marks})`).run(...ids);
    const result = db.prepare(`DELETE FROM products WHERE id IN (${marks})`).run(...ids);
    db.exec('COMMIT'); res.json({ deleted: result.changes });
  } catch (error) { db.exec('ROLLBACK'); throw error; }
});

app.post('/api/products/bulk-move', (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger))];
  const { category = '', brand = '', weight_value = null, weight_unit = '' } = req.body;
  if (!ids.length || !category || !brand) return res.status(400).json({ error: 'Wybierz kategorię i firmę docelową.' });
  const marks = ids.map(() => '?').join(',');
  const hasWeight = Number.isFinite(Number(weight_value)) && weight_unit;
  const result = hasWeight
    ? db.prepare(`UPDATE products SET category=?, brand=?, weight_value=?, weight_unit=?, updated_at=CURRENT_TIMESTAMP WHERE id IN (${marks})`).run(category, brand === 'Pozostałe' ? '' : brand, Number(weight_value), weight_unit, ...ids)
    : db.prepare(`UPDATE products SET category=?, brand=?, updated_at=CURRENT_TIMESTAMP WHERE id IN (${marks})`).run(category, brand === 'Pozostałe' ? '' : brand, ...ids);
  res.json({ moved: result.changes });
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

app.post('/api/products/:id/image', (req, res) => {
  const product = productById(Number(req.params.id));
  const image = req.body.image_data;
  if (!product || !String(image || '').startsWith('data:image/')) return res.status(400).json({ error: 'Wybierz prawidłowe zdjęcie.' });
  db.prepare('UPDATE products SET image_data=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(image, product.id);
  res.json(productById(product.id));
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
