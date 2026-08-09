const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;
const youtubeCache = new Map();
const bundledDbPath = path.join(__dirname, 'zapobetterworkplace.db');
const dbPath = process.env.DATABASE_PATH || bundledDbPath;
if (dbPath !== bundledDbPath && !fs.existsSync(dbPath) && fs.existsSync(bundledDbPath)) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.copyFileSync(bundledDbPath, dbPath);
}
const db = new DatabaseSync(dbPath);
const sessions = new Map();
const passwordHash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');

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
    received_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );
`);
if (!db.prepare("PRAGMA table_info(product_batches)").all().some(column => column.name === 'received_date')) {
  db.exec('ALTER TABLE product_batches ADD COLUMN received_date TEXT');
}
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
if (!db.prepare("PRAGMA table_info(products)").all().some(column => column.name === 'barcode')) {
  db.exec('ALTER TABLE products ADD COLUMN barcode TEXT');
}

// Kod potwierdzony dla dokładnego wariantu: Sante FIT kakaowe 50 g.
// Uzupełniamy go tylko wtedy, gdy przy produkcie nie zapisano jeszcze kodu.
db.prepare(`UPDATE products SET barcode=?, updated_at=CURRENT_TIMESTAMP
  WHERE name=? AND brand=? AND weight_value=? AND weight_unit=?
    AND COALESCE(barcode, '')=''`).run(
  '5900617036728', 'Ciasteczka zbożowe bez cukru kakaowe 50g, Sante', 'Sante', 50, 'g'
);

// Telefon zapisuje zdjęcia jako dane obrazu. Domyślny limit Expressa (100 KB)
// był zbyt mały, dlatego pozwalamy na bezpieczne zdjęcia do 15 MB.
db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'worker' CHECK(role IN ('admin', 'procurement', 'leader', 'worker')),
  hidden_admin INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
db.exec(`CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'info', title TEXT NOT NULL, message TEXT NOT NULL,
  entity_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(notification_id, user_id)
);`);
// Starsze wdrożenia miały ograniczenie ról wyłącznie do admin/worker.
// SQLite nie pozwala rozszerzyć CHECK bez przebudowy tabeli, dlatego robimy
// jednorazową, zachowującą konta migrację.
const userTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql || '';
if (!userTableSql.includes("'procurement'")) {
  db.exec(`ALTER TABLE users RENAME TO users_legacy;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'worker' CHECK(role IN ('admin', 'procurement', 'leader', 'worker')),
      hidden_admin INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, username, display_name, password_hash, role, active, created_at, updated_at)
      SELECT id, username, display_name, password_hash, role, active, created_at, updated_at FROM users_legacy;
    DROP TABLE users_legacy;`);
}
if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'hidden_admin')) db.exec('ALTER TABLE users ADD COLUMN hidden_admin INTEGER NOT NULL DEFAULT 0');
if (!db.prepare('SELECT id FROM users WHERE username=?').get('adminkrakow')) {
  db.prepare('INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run('adminkrakow', 'Admin', passwordHash('krakowstany'), 'admin');
}
function ensureAccount(username, displayName, password, role, hiddenAdmin = 0) {
  if (!db.prepare('SELECT id FROM users WHERE username=?').get(username)) {
    db.prepare('INSERT INTO users (username, display_name, password_hash, role, hidden_admin) VALUES (?, ?, ?, ?, ?)')
      .run(username, displayName, passwordHash(password), role, hiddenAdmin);
  }
}
ensureAccount('adrian', 'Adrian', 'adrian', 'procurement', 1);
ensureAccount('szymon', 'Szymon', '4321', 'leader');
ensureAccount('uzytkownik', 'Użytkownik', 'uzytkownik', 'worker');
db.exec(`CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier TEXT NOT NULL DEFAULT 'SELGROS',
  invoice_date TEXT,
  gross_amount REAL NOT NULL CHECK(gross_amount >= 0),
  note TEXT DEFAULT '',
  image_data TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
if (!db.prepare('PRAGMA table_info(purchases)').all().some(column => column.name === 'wallet_user_id')) db.exec('ALTER TABLE purchases ADD COLUMN wallet_user_id INTEGER');
db.exec(`CREATE TABLE IF NOT EXISTS wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  balance REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_id INTEGER NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'adjustment',
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  initiated_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  FOREIGN KEY(wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
);`);
db.exec(`
  CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier TEXT NOT NULL,
    received_date TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS delivery_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity REAL NOT NULL CHECK(quantity > 0),
    expiration_date TEXT,
    FOREIGN KEY(delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS demand_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_name TEXT DEFAULT '',
    recognized_text TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS demand_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    demand_run_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity REAL NOT NULL CHECK(quantity > 0),
    FOREIGN KEY(demand_run_id) REFERENCES demand_runs(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );
`);
if (!db.prepare('PRAGMA table_info(demand_runs)').all().some(column => column.name === 'demand_date')) db.exec('ALTER TABLE demand_runs ADD COLUMN demand_date TEXT');
if (!db.prepare('PRAGMA table_info(demand_runs)').all().some(column => column.name === 'reversed_at')) db.exec('ALTER TABLE demand_runs ADD COLUMN reversed_at TEXT');
if (!db.prepare('PRAGMA table_info(demand_items)').all().some(column => column.name === 'corrected_quantity')) db.exec('ALTER TABLE demand_items ADD COLUMN corrected_quantity REAL NOT NULL DEFAULT 0');
// quantity oznacza pełne zapotrzebowanie. Wydana ilość i niedobór są
// zapisywane osobno, aby historia dnia mogła pokazać również brakujący towar.
const demandItemColumns = () => db.prepare('PRAGMA table_info(demand_items)').all().map(column => column.name);
if (!demandItemColumns().includes('issued_quantity')) db.exec('ALTER TABLE demand_items ADD COLUMN issued_quantity REAL NOT NULL DEFAULT 0');
if (!demandItemColumns().includes('shortage_quantity')) db.exec('ALTER TABLE demand_items ADD COLUMN shortage_quantity REAL NOT NULL DEFAULT 0');
if (!demandItemColumns().includes('shortage_resolved_quantity')) db.exec('ALTER TABLE demand_items ADD COLUMN shortage_resolved_quantity REAL NOT NULL DEFAULT 0');
if (!demandItemColumns().includes('shortage_resolution')) db.exec("ALTER TABLE demand_items ADD COLUMN shortage_resolution TEXT NOT NULL DEFAULT ''");
// Wcześniejsze wpisy zawierały wyłącznie faktycznie odjętą liczbę sztuk.
// Jednorazowa migracja zachowuje ich dotychczasowe znaczenie w historii.
if (!db.prepare("SELECT value FROM app_settings WHERE key='demand_items_shortage_migration_v1'").get()) {
  db.prepare('UPDATE demand_items SET issued_quantity=quantity WHERE COALESCE(issued_quantity, 0)=0 AND quantity>0').run();
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('demand_items_shortage_migration_v1', 'true')").run();
}
db.exec(`CREATE TABLE IF NOT EXISTS demand_day_products (
  demand_date TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  opening_quantity REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(demand_date, product_id),
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
)`);
db.exec(`
  CREATE TABLE IF NOT EXISTS shopping_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_text TEXT DEFAULT '',
    list_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS shopping_list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shopping_list_id INTEGER NOT NULL,
    product_id INTEGER,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Inne',
    brand TEXT DEFAULT '',
    weight TEXT DEFAULT '',
    required_quantity REAL NOT NULL,
    available_quantity REAL NOT NULL DEFAULT 0,
    missing_quantity REAL NOT NULL,
    unit TEXT NOT NULL DEFAULT 'szt.',
    FOREIGN KEY(shopping_list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE
  );
`);
if (!db.prepare('PRAGMA table_info(shopping_lists)').all().some(column => column.name === 'list_date')) db.exec('ALTER TABLE shopping_lists ADD COLUMN list_date TEXT');
if (!db.prepare('PRAGMA table_info(shopping_list_items)').all().some(column => column.name === 'purchased_at')) db.exec('ALTER TABLE shopping_list_items ADD COLUMN purchased_at TEXT');
if (!db.prepare('PRAGMA table_info(shopping_list_items)').all().some(column => column.name === 'purchased_date')) db.exec('ALTER TABLE shopping_list_items ADD COLUMN purchased_date TEXT');
if (!db.prepare('PRAGMA table_info(shopping_list_items)').all().some(column => column.name === 'purchased_quantity')) db.exec('ALTER TABLE shopping_list_items ADD COLUMN purchased_quantity REAL NOT NULL DEFAULT 0');
if (!db.prepare('PRAGMA table_info(shopping_list_items)').all().some(column => column.name === 'demand_run_id')) db.exec('ALTER TABLE shopping_list_items ADD COLUMN demand_run_id INTEGER');
if (!db.prepare('PRAGMA table_info(shopping_list_items)').all().some(column => column.name === 'demand_item_id')) db.exec('ALTER TABLE shopping_list_items ADD COLUMN demand_item_id INTEGER');
if (!db.prepare('PRAGMA table_info(shopping_list_items)').all().some(column => column.name === 'source')) db.exec("ALTER TABLE shopping_list_items ADD COLUMN source TEXT NOT NULL DEFAULT 'demand'");
db.prepare('UPDATE shopping_list_items SET purchased_quantity=missing_quantity WHERE purchased_at IS NOT NULL AND COALESCE(purchased_quantity, 0)=0').run();

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

// Jednorazowe uporządkowanie nazw przekazane przez ZapoBetterWorkPlace.
// Działa także na istniejącym wolumenie Railway, bez zmiany ilości i dat.
function applyProductNameCorrections() {
  const setting = 'product_name_corrections_2026_08_01';
  if (db.prepare('SELECT value FROM app_settings WHERE key=?').get(setting)) return 0;
  const corrections = [
    ['Bakalie MIX 400g Hebar', 'Bakalie MIX 400g, Hebar'], ['Bakalie MIX 65g Hebar', 'Bakalie MIX 65g, Hebar'],
    ['Baton Kokos i czekolada 35g', 'Baton Kokos i czekolada 35g, Dobra Kaloria'], ['Baton owocowy Chrupiący Orzech', 'Baton owocowy Chrupiący Orzech 35g, Dobra Kaloria'],
    ['Baton owocowy Jabłko & Cynamon', 'Baton owocowy Jabłko & Cynamon 35g, Dobra Kaloria'], ['Baton owocowy Nerkowiec& Kokos', 'Baton owocowy Nerkowiec & Kokos 35g, Dobra Kaloria'],
    ['Baton owocowy Orzeszki & Czekolada', 'Baton owocowy Orzeszki & Czekolada 35g, Dobra Kaloria'], ['Baton proteinowy z IG z MCT Karmel 45g', 'Baton proteinowy IG z MCT Karmel 45g, Dobra Kaloria'],
    ['Ciasteczka zbożowe bez cukru Jagoda 300g', 'Ciasteczka zbożowe bez cukru jagoda 300g, Sante'], ['Ciasteczka zbożowe bez cukru Jagoda 50g', 'Ciasteczka zbożowe bez cukru jagoda 50g, Sante'],
    ['Ciasteczka zbożowe bez cukru Kakao 300g', 'Ciasteczka zbożowe bez cukru kakaowe 300g, Sante'], ['Ciasteczka zbożowe bez cukru Kakao 50g', 'Ciasteczka zbożowe bez cukru kakaowe 50g, Sante'],
    ['Ciasteczka zbożowe bez cukru Morela 300g', 'Ciasteczka zbożowe bez cukru morelowe 300g, Sante'], ['Ciasteczka zbożowe bez cukru Morela 50g', 'Ciasteczka zbożowe bez cukru morelowe 50g, Sante'],
    ['Crunchy klasyczne 350g Sante', 'Crunchy klasyczne 350g, Sante'], ['Daktyle suszone 65g Hebar', 'Daktyle suszone 65g, Hebar'],
    ['Dżem Truskawkowy 280g Łowicz', 'Dżem truskawkowy 280g, Łowicz'], ['Jogurt Naturalny', 'Jogurt naturalny 150g, Mlekovita'],
    ['Kawa Exclusive', 'Kawa Exclusive - arabica 100% 1kg ziarno, Mała Palarnia'], ['Kawa Original', 'Kawa Original - arabica / robusta 80/20 1kg ziarno, Mała Palarnia'],
    ['Kawa Special', 'Kawa Special - arabica / robusta 50/50 1kg ziarno, Mała Palarnia'], ['Migdały 65g Hebar', 'Migdały 65g, Hebar'],
    ['Wielokwiatowy', 'Miód wielokwiatowy 400g, Miody Polskie'], ['Dobre Krafty', 'Miód wielokwiatowy (jasny) 350g, Dobre Krafty'],
    ['Mleko 1,5% Bez Laktozy', 'Mleko bez laktozy UHT 1,5% karton 1L, Mlekovita'], ['Mleko 1,5%', 'Mleko UHT 1,5% karton 1L'], ['Mleko 3,2%', 'Mleko UHT 3,2% karton 1L'],
    ['Morela suszona 65g Hebar', 'Morele suszone 65g, Hebar'], ['Orzechy laskowe 65g Hebar', 'Orzechy laskowe 65g, Hebar'],
    ['Orzechy nerkowca 65g Hebar', 'Orzechy nerkowca 65g, Hebar'], ['Pistacje', 'Orzechy pistacjowe 300g, Hebar'],
    ['Orzechy ziemne niesolone 65g Hebar', 'Orzechy ziemne niesolone 65g, Hebar'], ['Śliwka suszona 65g Hebar', 'Śliwka suszona 65g, Hebar'],
    ['Baobab – Rembowskich', 'Smoothie BAOBAB (żółte) 250ml, Rembowscy'], ['Jagoda/Kokos – Rembowskich', 'Smoothie JAGODA 250ml, Rembowscy'],
    ['Moringa – Rembowskich', 'Smoothie MORINGA (zielone) 250ml, Rembowscy'], ['Rokitnik – Rembowskich', 'Smoothie ROKITNIK (czerwone) 250ml, Rembowscy'],
    ['Jabłko – Dolina Czerska', 'Sok jabłko 200ml, Dolina Czerska', 200, 'ml'], ['Jabłko – Sady Wincenta', 'Sok jabłko 330ml, Sady Wincenta', 330, 'ml'],
    ['Gruszka – Sady Wincenta', 'Sok jabłko-gruszka 330ml, Sady Wincenta', 330, 'ml'], ['Gruszkowy – Sady Wincenta', 'Sok jabłko-gruszka 5L, Sady Wincenta', 5, 'l'],
    ['Marchew – Sady Wincenta', 'Sok jabłko-marchew 330ml, Sady Wincenta', 330, 'ml'], ['Jabłko + Pomarańcza – Sady Wincenta', 'Sok jabłko-pomarańcza 330ml, Sady Wincenta', 330, 'ml'],
    ['Pomarańcza – Sady Wincenta', 'Sok pomarańczowy 330ml, Sady Wincenta', 330, 'ml'], ['Pomidorowy – Sady Wincenta', 'Sok pomidorowy 330ml, Sady Wincenta', 330, 'ml'],
    ['Żurawina suszona 65g Hebar', 'Żurawina suszona 65g, Hebar']
  ];
  const rename = db.prepare('UPDATE products SET name=?, updated_at=CURRENT_TIMESTAMP WHERE name=?');
  const renameWeighted = db.prepare('UPDATE products SET name=?, updated_at=CURRENT_TIMESTAMP WHERE name=? AND weight_value=? AND weight_unit=?'); let changed = 0;
  db.exec('BEGIN');
  try {
    for (const [oldName, newName, weightValue, weightUnit] of corrections) changed += weightValue == null ? rename.run(newName, oldName).changes : renameWeighted.run(newName, oldName, weightValue, weightUnit).changes;
    db.prepare("INSERT INTO app_settings (key, value) VALUES (?, 'true')").run(setting);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return changed;
}
const correctedProductNames = applyProductNameCorrections();
if (correctedProductNames) console.log(`Zmieniono nazwy produktów: ${correctedProductNames}.`);

function ensureFruitProducts() {
  const setting = 'default_fruit_products_2026_08_01';
  if (db.prepare('SELECT value FROM app_settings WHERE key=?').get(setting)) return 0;
  const names = ['Banan', 'Jabłko', 'Śliwka', 'Morela', 'Brzoskwinia', 'Nektarynka'];
  const exists = db.prepare("SELECT id FROM products WHERE category='Owoce i Warzywa' AND name=? LIMIT 1");
  const add = db.prepare("INSERT INTO products (name, category, brand, unit, quantity, min_quantity, weight_value, weight_unit, notes, updated_at) VALUES (?, 'Owoce i Warzywa', '', 'kg', 0, 0, NULL, NULL, '', CURRENT_TIMESTAMP)");
  let added = 0;
  db.exec('BEGIN');
  try {
    names.forEach(name => { if (!exists.get(name)) { add.run(name); added += 1; } });
    db.prepare("INSERT INTO app_settings (key, value) VALUES (?, 'true')").run(setting);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return added;
}
const defaultFruitProducts = ensureFruitProducts();
if (defaultFruitProducts) console.log(`Dodano domyślne owoce: ${defaultFruitProducts}.`);
const historicalBatches = seedMissingProductBatches();
if (historicalBatches) console.log(`Utworzono historyczne partie produktów: ${historicalBatches}.`);

// Pusta, zdublowana kategoria była tylko pozostałością po starszej nazwie.
// Nie dotykamy produktów — usuwamy ją wyłącznie wtedy, gdy rzeczywiście jest pusta.
function removeEmptyLegacyCookieCategory() {
  const setting = 'removed_empty_legacy_cookie_category';
  if (db.prepare('SELECT value FROM app_settings WHERE key=?').get(setting)) return false;
  const category = 'Ciastka i batony';
  if (db.prepare('SELECT COUNT(*) AS count FROM products WHERE category=?').get(category).count === 0) {
    db.prepare('DELETE FROM inventory_paths WHERE category=?').run(category);
    db.prepare("DELETE FROM category_images WHERE category=? OR category LIKE ? OR category LIKE ?")
      .run(`category:${category}`, `brand:${category}:%`, `weight:${category}:%`);
  }
  db.prepare("INSERT INTO app_settings (key, value) VALUES (?, 'true')").run(setting);
  return true;
}
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function authenticated(req) {
  const user = sessions.get(req.get('x-session-token'));
  if (user) req.user = user;
  return Boolean(user);
}
function isFullAdmin(user) { return user?.role === 'admin' || Boolean(user?.hidden_admin); }
function roleLabel(user) { return isFullAdmin(user) && user.role === 'procurement' ? 'Zaopatrzenie (ograniczony dostęp)' : ({ admin: 'Admin', procurement: 'Zaopatrzenie', leader: 'Lider', worker: 'Pracownik' })[user?.role] || 'Pracownik'; }
function capabilities(user) {
  const full = isFullAdmin(user); const supply = full || user?.role === 'procurement' || user?.role === 'leader';
  return { users: full, finance: full, selgros: supply, purchases: supply, delivery: supply, deliveryHistory: supply, inventoryEdit: supply, shopping: supply, demand: Boolean(user), inventoryView: Boolean(user), game: user?.username === 'adrian' };
}
function syncSystemNotifications() {
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const add = db.prepare('INSERT OR IGNORE INTO notifications (type, title, message, entity_key) VALUES (?, ?, ?, ?)');
  for (const item of db.prepare("SELECT id,name,expiration_date FROM products WHERE expiration_date IS NOT NULL AND expiration_date<>'' AND expiration_date<=?").all(end)) {
    const expired = item.expiration_date < today;
    add.run(expired ? 'warning' : 'expiry', expired ? 'Produkt po terminie' : 'Zbliża się termin ważności', `${item.name} — termin: ${item.expiration_date}`, `expiry:${item.id}:${item.expiration_date}`);
  }
  for (const item of db.prepare('SELECT id,name,quantity,unit FROM products WHERE min_quantity>0 AND quantity<=min_quantity').all()) add.run('stock', 'Niski stan magazynowy', `${item.name} — pozostało: ${item.quantity} ${item.unit}`, `stock:${item.id}:${item.quantity}`);
}
function addNotification(type, title, message, entityKey) {
  db.prepare('INSERT OR IGNORE INTO notifications (type, title, message, entity_key) VALUES (?, ?, ?, ?)')
    .run(type, title, message, entityKey);
}
function moneyLabel(value) {
  return Number(value || 0).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
}
function allow(capability) { return (req, res, next) => capabilities(req.user)[capability] ? next() : res.status(403).json({ error: 'To konto nie ma dostępu do tej funkcji.' }); }
function adminOnly(req, res, next) {
  return isFullAdmin(req.user)
    ? next()
    : res.status(403).json({ error: 'Tylko administrator może zarządzać użytkownikami.' });
}
function publicUser(user) {
  return { id: user.id, username: user.username, display_name: user.display_name, role: user.role, hidden_admin: Boolean(user.hidden_admin), role_label: roleLabel(user), capabilities: capabilities(user), active: Boolean(user.active), created_at: user.created_at };
}
app.post('/api/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || user.password_hash !== passwordHash(req.body?.password) || !user.active) return res.status(401).json({ error: 'Nieprawidłowy login lub hasło.' });
  const token = crypto.randomBytes(24).toString('hex');
  const sessionUser = publicUser(user);
  sessions.set(token, sessionUser);
  res.json({ token, user: sessionUser });
});
app.use('/api', (req, res, next) => authenticated(req) ? next() : res.status(401).json({ error: 'Zaloguj się, aby zobaczyć magazyn.' }));

app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && (capabilities(req.user).inventoryEdit || req.path === '/demand/apply' || req.path.startsWith('/notifications'))) return next();
  if (req.user?.role !== 'admin' && req.method !== 'GET') return res.status(403).json({ error: 'To konto ma dostęp wyłącznie do podglądu. Poproś administratora o wykonanie tej zmiany.' });
  next();
});
app.get('/api/session', (req, res) => res.json({ user: req.user, capabilities: capabilities(req.user) }));
app.get('/api/notifications', (req, res) => {
  syncSystemNotifications();
  const notifications = db.prepare(`SELECT n.id,n.type,n.title,n.message,n.entity_key,n.created_at,CASE WHEN r.notification_id IS NULL THEN 0 ELSE 1 END AS is_read FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=? ORDER BY n.id DESC LIMIT 40`).all(req.user.id);
  res.json({ unread_count: notifications.filter(item => !item.is_read).length, notifications });
});
app.post('/api/notifications/:id/read', (req, res) => { db.prepare('INSERT OR IGNORE INTO notification_reads (notification_id,user_id) VALUES (?,?)').run(Number(req.params.id), req.user.id); res.status(204).end(); });
app.post('/api/notifications/read-all', (req, res) => { db.prepare('INSERT OR IGNORE INTO notification_reads (notification_id,user_id) SELECT id,? FROM notifications').run(req.user.id); res.status(204).end(); });
app.get('/api/youtube/search', async (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 100);
  if (!query) return res.status(400).json({ error: 'Wpisz, czego szukasz na YouTube.' });
  const key = String(process.env.YOUTUBE_API_KEY || '').trim();
  if (!key) return res.status(503).json({ error: 'YouTube nie jest jeszcze skonfigurowany. Dodaj zmienną YOUTUBE_API_KEY w Railway.' });

  const cached = youtubeCache.get(query.toLowerCase());
  if (cached && Date.now() - cached.savedAt < 10 * 60 * 1000) return res.json(cached.results);
  try {
    const params = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '8', q: query, key });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || 'Nie udało się pobrać wyników z YouTube.');
    const results = (body.items || []).map(item => ({
      id: item.id?.videoId,
      title: item.snippet?.title || 'Film z YouTube',
      channel: item.snippet?.channelTitle || '',
      thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || ''
    })).filter(item => item.id);
    youtubeCache.set(query.toLowerCase(), { savedAt: Date.now(), results });
    res.json(results);
  } catch (error) {
    res.status(502).json({ error: error.message || 'YouTube chwilowo nie odpowiada.' });
  }
});
app.get('/api/youtube/related', async (req, res) => {
  const videoId = String(req.query.id || '').trim().slice(0, 80);
  const key = String(process.env.YOUTUBE_API_KEY || '').trim();
  if (!videoId) return res.status(400).json({ error: 'Brak identyfikatora aktualnego filmu.' });
  if (!key) return res.status(503).json({ error: 'YouTube nie jest jeszcze skonfigurowany. Dodaj zmienną YOUTUBE_API_KEY w Railway.' });
  const cacheKey = `related:${videoId}`;
  const cached = youtubeCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < 10 * 60 * 1000) return res.json(cached.results);
  try {
    const params = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '12', relatedToVideoId: videoId, key });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || 'Nie udało się pobrać podobnych filmów z YouTube.');
    const results = (body.items || []).map(item => ({
      id: item.id?.videoId,
      title: item.snippet?.title || 'Film z YouTube',
      channel: item.snippet?.channelTitle || '',
      thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || ''
    })).filter(item => item.id && item.id !== videoId);
    youtubeCache.set(cacheKey, { savedAt: Date.now(), results });
    res.json(results);
  } catch (error) {
    res.status(502).json({ error: error.message || 'YouTube chwilowo nie odpowiada.' });
  }
});
app.get('/api/users', adminOnly, (req, res) => {
  res.json(db.prepare('SELECT id, username, display_name, role, active, created_at FROM users ORDER BY role DESC, display_name COLLATE NOCASE, username COLLATE NOCASE').all().map(publicUser));
});
app.post('/api/users', adminOnly, (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const displayName = String(req.body?.display_name || '').trim().slice(0, 80) || username;
  const password = String(req.body?.password || '');
  const role = ['admin', 'procurement', 'leader', 'worker'].includes(req.body?.role) ? req.body.role : 'worker';
  if (!/^[a-z0-9._-]{3,40}$/i.test(username)) return res.status(400).json({ error: 'Login musi mieć od 3 do 40 znaków (litery, cyfry, kropka, myślnik lub podkreślenie).' });
  if (password.length < 4) return res.status(400).json({ error: 'Hasło musi mieć co najmniej 4 znaki.' });
  try {
    const result = db.prepare('INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)').run(username, displayName, passwordHash(password), role);
    res.status(201).json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid)));
  } catch (error) {
    res.status(409).json({ error: 'Taki login już istnieje.' });
  }
});
app.put('/api/users/:id', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'Nie znaleziono użytkownika.' });
  const username = String(req.body?.username || existing.username).trim().toLowerCase();
  const displayName = String(req.body?.display_name || '').trim().slice(0, 80) || username;
  const role = ['admin', 'procurement', 'leader', 'worker'].includes(req.body?.role) ? req.body.role : 'worker';
  const active = req.body?.active === false ? 0 : 1;
  const password = String(req.body?.password || '');
  if (!/^[a-z0-9._-]{3,40}$/i.test(username)) return res.status(400).json({ error: 'Nieprawidłowy login.' });
  if (password && password.length < 4) return res.status(400).json({ error: 'Hasło musi mieć co najmniej 4 znaki.' });
  const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1").get().count;
  if (existing.role === 'admin' && existing.active && (role !== 'admin' || !active) && adminCount <= 1) return res.status(400).json({ error: 'Musi pozostać co najmniej jeden aktywny administrator.' });
  try {
    db.prepare('UPDATE users SET username=?, display_name=?, password_hash=?, role=?, active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(username, displayName, password ? passwordHash(password) : existing.password_hash, role, active, id);
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    for (const [sessionToken, session] of sessions) if (session.id === id) sessions.set(sessionToken, publicUser(updated));
    res.json(publicUser(updated));
  } catch (error) {
    res.status(409).json({ error: 'Taki login już istnieje.' });
  }
});
app.delete('/api/users/:id', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!user) return res.status(404).json({ error: 'Nie znaleziono użytkownika.' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'Nie możesz usunąć własnego konta.' });
  const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1").get().count;
  if (user.role === 'admin' && user.active && adminCount <= 1) return res.status(400).json({ error: 'Musi pozostać co najmniej jeden aktywny administrator.' });
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  for (const [sessionToken, session] of sessions) if (session.id === id) sessions.delete(sessionToken);
  res.status(204).end();
});

function walletFor(userId) { return db.prepare('SELECT * FROM wallets WHERE user_id=?').get(userId); }
function walletData(userId) {
  const wallet = walletFor(userId);
  if (!wallet) return { wallet: null, transactions: [] };
  return { wallet, transactions: db.prepare('SELECT * FROM wallet_transactions WHERE wallet_id=? ORDER BY id DESC').all(wallet.id) };
}
app.get('/api/wallet/me', (req, res) => res.json(walletData(req.user.id)));
app.get('/api/wallet/users', adminOnly, (req, res) => {
  const users = db.prepare('SELECT * FROM users WHERE active=1 ORDER BY display_name COLLATE NOCASE').all();
  res.json(users.map(user => ({ user: publicUser(user), ...walletData(user.id) })));
});
app.post('/api/wallet/users/:userId', adminOnly, (req, res) => {
  const userId = Number(req.params.userId); const user = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(userId);
  if (!user) return res.status(404).json({ error: 'Nie znaleziono użytkownika.' });
  if (walletFor(userId)) return res.status(409).json({ error: 'Ten użytkownik ma już portfel.' });
  const result = db.prepare('INSERT INTO wallets (user_id, balance, active) VALUES (?, 0, 0)').run(userId);
  const transaction = db.prepare("INSERT INTO wallet_transactions (wallet_id, amount, kind, note, status, initiated_by_user_id) VALUES (?, 0, 'create', 'Utworzono portfel', 'pending', ?)").run(result.lastInsertRowid, req.user.id);
  addNotification('wallet', 'Nowy portfel czeka na akceptację', `${req.user.display_name} utworzył(a) portfel dla: ${user.display_name}.`, `wallet:pending:${transaction.lastInsertRowid}`);
  res.status(201).json(walletData(userId));
});
app.post('/api/wallet/users/:userId/transactions', adminOnly, (req, res) => {
  const userId = Number(req.params.userId); const wallet = walletFor(userId); const amount = Number(req.body?.amount);
  if (!wallet) return res.status(404).json({ error: 'Najpierw załóż portfel temu użytkownikowi.' });
  if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: 'Wpisz kwotę większą lub mniejszą od zera.' });
  const transaction = db.prepare("INSERT INTO wallet_transactions (wallet_id, amount, kind, note, status, initiated_by_user_id) VALUES (?, ?, 'adjustment', ?, 'pending', ?)")
    .run(wallet.id, amount, String(req.body?.note || '').trim().slice(0, 300), req.user.id);
  const recipient = db.prepare('SELECT display_name FROM users WHERE id=?').get(userId);
  addNotification('wallet', 'Środki czekają na akceptację', `${req.user.display_name} wysłał(a) ${moneyLabel(amount)} do portfela: ${recipient?.display_name || 'użytkownik'}.`, `wallet:pending:${transaction.lastInsertRowid}`);
  res.status(201).json(walletData(wallet.user_id));
});
app.post('/api/wallet/transactions/:id/decide', (req, res) => {
  const transaction = db.prepare('SELECT t.*, w.user_id FROM wallet_transactions t JOIN wallets w ON w.id=t.wallet_id WHERE t.id=?').get(Number(req.params.id));
  if (!transaction || transaction.user_id !== req.user.id) return res.status(404).json({ error: 'Nie znaleziono tej operacji portfela.' });
  if (transaction.status !== 'pending') return res.status(400).json({ error: 'Ta operacja została już rozpatrzona.' });
  if (passwordHash(req.body?.password) !== db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id).password_hash) return res.status(403).json({ error: 'Nieprawidłowe hasło.' });
  const accepted = req.body?.accept === true;
  db.prepare('UPDATE wallet_transactions SET status=?, decided_at=CURRENT_TIMESTAMP WHERE id=?').run(accepted ? 'accepted' : 'rejected', transaction.id);
  if (accepted) {
    if (transaction.kind === 'create') db.prepare('UPDATE wallets SET active=1, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(transaction.wallet_id);
    else db.prepare('UPDATE wallets SET balance=balance+?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(transaction.amount, transaction.wallet_id);
  }
  addNotification('wallet', accepted ? 'Środki zostały zaakceptowane' : 'Środki zostały odrzucone', `${req.user.display_name} ${accepted ? 'zaakceptował(a)' : 'odrzucił(a)'} operację ${transaction.kind === 'create' ? 'utworzenia portfela' : `na kwotę ${moneyLabel(transaction.amount)}`}.`, `wallet:decision:${transaction.id}:${accepted ? 'accepted' : 'rejected'}`);
  res.json(walletData(req.user.id));
});



function productById(id) {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
}

function validNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function productIdFrom(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Każdy portfel jest osobny. Dawne faktury oraz środki należą do Adriana,
// dzięki czemu nie mieszają się ze środkami Admina ani Lidera.
function ensureAdrianWallet() {
  const adrian = db.prepare("SELECT * FROM users WHERE username='adrian'").get();
  if (!adrian) return;
  const legacy = Number(db.prepare("SELECT value FROM app_settings WHERE key='purchase_budget'").get()?.value || 0);
  const legacySpent = Number(db.prepare('SELECT COALESCE(SUM(gross_amount),0) AS total FROM purchases WHERE wallet_user_id IS NULL').get().total || 0);
  if (!walletFor(adrian.id)) db.prepare('INSERT INTO wallets (user_id, balance, active) VALUES (?, ?, 1)').run(adrian.id, Math.max(0, legacy - legacySpent));
  db.prepare('UPDATE purchases SET wallet_user_id=? WHERE wallet_user_id IS NULL').run(adrian.id);
}
ensureAdrianWallet();
function personalPurchaseSummary(userId) {
  const wallet = walletFor(userId);
  const spent = Number(db.prepare('SELECT COALESCE(SUM(gross_amount),0) AS total FROM purchases WHERE wallet_user_id=?').get(userId).total || 0);
  const remaining = Number(wallet?.balance || 0);
  return { budget: remaining + spent, spent, remaining, wallet_active: Boolean(wallet?.active), wallet_id: wallet?.id || null };
}
function canManagePurchase(user, purchase) { return isFullAdmin(user) || (user.role === 'procurement' && purchase.wallet_user_id === user.id); }
function validInvoicePassword(userId, password) {
  // Zachowujemy znany zespołowi kod faktur, a dodatkowo przyjmujemy hasło
  // aktualnego konta. Dzięki temu starszy sposób pracy dalej działa.
  if (String(password || '') === '123') return true;
  const user = db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId);
  return passwordHash(password) === user?.password_hash;
}
app.get('/api/purchases', allow('purchases'), (req, res) => {
  const full = isFullAdmin(req.user);
  const purchases = db.prepare(`SELECT p.*, u.display_name AS wallet_owner FROM purchases p LEFT JOIN users u ON u.id=p.wallet_user_id
    ${full ? '' : 'WHERE p.wallet_user_id=?'} ORDER BY COALESCE(p.invoice_date, date(p.created_at)) DESC, p.id DESC`).all(...(full ? [] : [req.user.id]));
  res.json({ ...personalPurchaseSummary(req.user.id), purchases: purchases.map(item => ({ ...item, can_manage: canManagePurchase(req.user, item) })) });
});
app.put('/api/purchases/budget', allow('finance'), (req, res) => {
  const amount = Number(req.body?.amount); const own = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (passwordHash(req.body?.password) !== own?.password_hash) return res.status(403).json({ error: 'Nieprawidłowe hasło.' });
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Podaj prawidłową kwotę.' });
  const wallet = walletFor(req.user.id);
  if (wallet) db.prepare('UPDATE wallets SET balance=?, active=1, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(amount, wallet.id);
  else db.prepare('INSERT INTO wallets (user_id, balance, active) VALUES (?, ?, 1)').run(req.user.id, amount);
  res.json(personalPurchaseSummary(req.user.id));
});
app.post('/api/purchases', allow('purchases'), (req, res) => {
  const amount = Number(req.body?.gross_amount); const wallet = walletFor(req.user.id);
  if (!wallet?.active) return res.status(403).json({ error: 'Najpierw zaakceptuj swój portfel.' });
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Podaj prawidłową kwotę brutto.' });
  if (wallet.balance < amount) return res.status(400).json({ error: `Brakuje środków w Twoim portfelu. Dostępne: ${wallet.balance.toFixed(2)} zł.` });
  const image = req.body?.image_data || null;
  if (image && !String(image).startsWith('data:image/')) return res.status(400).json({ error: 'Zdjęcie faktury ma nieprawidłowy format.' });
  const result = db.prepare('INSERT INTO purchases (supplier, invoice_date, gross_amount, note, image_data, wallet_user_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(String(req.body?.supplier || 'SELGROS').trim().slice(0,120) || 'SELGROS', parseExpiration(req.body?.invoice_date), amount, String(req.body?.note || '').trim().slice(0,1000), image, req.user.id);
  db.prepare('UPDATE wallets SET balance=balance-?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(amount, wallet.id);
  res.status(201).json(db.prepare('SELECT * FROM purchases WHERE id=?').get(result.lastInsertRowid));
});
app.put('/api/purchases/:id', allow('purchases'), (req, res) => {
  const existing = db.prepare('SELECT * FROM purchases WHERE id=?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Nie znaleziono tej faktury.' });
  if (!canManagePurchase(req.user, existing)) return res.status(403).json({ error: 'Możesz tylko przeglądać tę fakturę.' });
  if (!validInvoicePassword(req.user.id, req.body?.password)) return res.status(403).json({ error: 'Nieprawidłowe hasło.' });
  const amount = Number(req.body?.gross_amount); const supplier = String(req.body?.supplier || '').trim().slice(0,120); const image = req.body?.image_data || existing.image_data || null;
  if (!supplier || !Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Uzupełnij dostawcę oraz kwotę.' });
  const ownerWallet = walletFor(existing.wallet_user_id); const difference = amount - existing.gross_amount;
  if (difference > 0 && ownerWallet.balance < difference) return res.status(400).json({ error: 'Na portfelu właściciela brakuje środków na tę zmianę.' });
  db.prepare('UPDATE purchases SET supplier=?, invoice_date=?, gross_amount=?, note=?, image_data=? WHERE id=?').run(supplier, parseExpiration(req.body?.invoice_date), amount, String(req.body?.note || '').trim().slice(0,1000), image, existing.id);
  db.prepare('UPDATE wallets SET balance=balance-?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(difference, ownerWallet.id);
  res.json(db.prepare('SELECT * FROM purchases WHERE id=?').get(existing.id));
});
app.delete('/api/purchases/:id', allow('purchases'), (req, res) => {
  const existing = db.prepare('SELECT * FROM purchases WHERE id=?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Nie znaleziono tej faktury.' });
  if (!canManagePurchase(req.user, existing)) return res.status(403).json({ error: 'Możesz tylko przeglądać tę fakturę.' });
  if (!validInvoicePassword(req.user.id, req.body?.password)) return res.status(403).json({ error: 'Nieprawidłowe hasło.' });
  db.prepare('DELETE FROM purchases WHERE id=?').run(existing.id);
  const wallet = walletFor(existing.wallet_user_id); if (wallet) db.prepare('UPDATE wallets SET balance=balance+?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(existing.gross_amount, wallet.id);
  res.status(204).end();
});

function purchaseSummary() {
  const budgetSetting = db.prepare("SELECT value FROM app_settings WHERE key='purchase_budget'").get();
  const budget = Number(budgetSetting?.value || 0);
  const spent = Number(db.prepare('SELECT COALESCE(SUM(gross_amount), 0) AS total FROM purchases').get().total || 0);
  return { budget, spent, remaining: budget - spent };
}

app.get('/api/purchases', allow('purchases'), (req, res) => {
  const purchases = db.prepare('SELECT * FROM purchases ORDER BY COALESCE(invoice_date, date(created_at)) DESC, id DESC').all();
  res.json({ ...purchaseSummary(), purchases });
});

app.put('/api/purchases/budget', (req, res) => {
  if (req.body?.password !== '123') return res.status(403).json({ error: 'Nieprawidłowe hasło do zmiany stanu pieniędzy.' });
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Podaj prawidłową kwotę pieniędzy.' });
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('purchase_budget', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`).run(String(amount));
  res.json(purchaseSummary());
});

app.post('/api/purchases', (req, res) => {
  const amount = Number(req.body?.gross_amount);
  const supplier = String(req.body?.supplier || 'SELGROS').trim().slice(0, 120) || 'SELGROS';
  const image = req.body?.image_data || null;
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Podaj kwotę brutto z faktury.' });
  if (image && !String(image).startsWith('data:image/')) return res.status(400).json({ error: 'Zdjęcie faktury ma nieprawidłowy format.' });
  const result = db.prepare(`INSERT INTO purchases (supplier, invoice_date, gross_amount, note, image_data)
    VALUES (?, ?, ?, ?, ?)`).run(supplier, parseExpiration(req.body?.invoice_date), amount, String(req.body?.note || '').trim().slice(0, 1000), image);
  res.status(201).json(db.prepare('SELECT * FROM purchases WHERE id=?').get(result.lastInsertRowid));
});

app.put('/api/purchases/:id', (req, res) => {
  if (req.body?.password !== '123') return res.status(403).json({ error: 'Wpisz prawidłowe hasło, aby edytować fakturę.' });
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM purchases WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'Nie znaleziono tej faktury.' });
  const amount = Number(req.body?.gross_amount);
  const supplier = String(req.body?.supplier || '').trim().slice(0, 120);
  const image = req.body?.image_data || existing.image_data || null;
  if (!supplier || !Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Uzupełnij dostawcę oraz prawidłową kwotę brutto.' });
  if (image && !String(image).startsWith('data:image/')) return res.status(400).json({ error: 'Zdjęcie faktury ma nieprawidłowy format.' });
  db.prepare(`UPDATE purchases SET supplier=?, invoice_date=?, gross_amount=?, note=?, image_data=? WHERE id=?`)
    .run(supplier, parseExpiration(req.body?.invoice_date), amount, String(req.body?.note || '').trim().slice(0, 1000), image, id);
  res.json(db.prepare('SELECT * FROM purchases WHERE id=?').get(id));
});

app.delete('/api/purchases/:id', (req, res) => {
  if (req.body?.password !== '123') return res.status(403).json({ error: 'Wpisz prawidłowe hasło, aby usunąć fakturę.' });
  const result = db.prepare('DELETE FROM purchases WHERE id=?').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Nie znaleziono tego zakupu.' });
  res.status(204).end();
});

app.get('/api/settings/selgros-card', (req, res) => {
  const record = db.prepare("SELECT value FROM app_settings WHERE key='selgros_card_image'").get();
  res.json({ image_data: record?.value || null });
});

app.put('/api/settings/selgros-card', (req, res) => {
  const image = req.body?.image_data;
  if (!String(image || '').startsWith('data:image/')) return res.status(400).json({ error: 'Wybierz prawidłowy zrzut karty SELGROS.' });
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('selgros_card_image', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`).run(image);
  res.json({ image_data:image });
});

// Jedna, stała pisownia kategorii. Dzięki temu przypadkowo wpisana nazwa
// (np. "Bułki z Katowic") nie tworzy drugi raz tego samego kafelka.
function canonicalCategory(value) {
  const raw = String(value || '').trim();
  const comparable = raw.toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  if (comparable === 'bulki z katowic') return 'Bułki z KATOWIC';
  if (comparable === 'owoce') return 'Owoce i Warzywa';
  if (comparable === 'soki') return 'Soki i Napoje';
  return raw || 'Inne';
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

// Produkt może mieć kilka dostaw z różnymi terminami. Główna data produktu
// zawsze pokazuje najbliższy termin z partii, które jeszcze są na stanie.
function syncProductExpiryFromBatches(productId) {
  const nearest = db.prepare(`SELECT expiration_date FROM product_batches
    WHERE product_id=? AND quantity > 0 AND expiration_date IS NOT NULL
    ORDER BY expiration_date ASC, id ASC LIMIT 1`).get(productId);
  // Brak daty partii nie może skasować terminu, jeśli produkt nadal jest na stanie.
  // Gdy stan spadnie do 0, termin znika razem z produktem ze stanu.
  if (!nearest) {
    const product = db.prepare('SELECT quantity FROM products WHERE id=?').get(productId);
    if (product && Number(product.quantity) <= 0) db.prepare('UPDATE products SET expiration_date=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(productId);
    return;
  }
  db.prepare('UPDATE products SET expiration_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(nearest.expiration_date, productId);
}

// Przy wydaniu najpierw schodzi najstarsza partia. Partie bez daty zostają na końcu.
function consumeProductBatches(productId, requestedQuantity) {
  let remaining = Number(requestedQuantity);
  if (!Number.isFinite(remaining) || remaining <= 0) return;
  const batches = db.prepare(`SELECT id, quantity FROM product_batches
    WHERE product_id=? AND quantity > 0
    ORDER BY expiration_date IS NULL, expiration_date ASC, id ASC`).all(productId);
  const update = db.prepare('UPDATE product_batches SET quantity=? WHERE id=?');
  for (const batch of batches) {
    if (remaining <= 0) break;
    const used = Math.min(remaining, Number(batch.quantity));
    update.run(Math.max(0, Number(batch.quantity) - used), batch.id);
    remaining -= used;
  }
  syncProductExpiryFromBatches(productId);
}

// Dane dodane przed wprowadzeniem partii otrzymują jedną historyczną partię,
// dzięki czemu od razu widać ich obecną ilość i termin.
function seedMissingProductBatches() {
  const products = db.prepare(`SELECT p.id, p.quantity, p.expiration_date, p.received_date
    FROM products p
    WHERE p.quantity > 0 AND NOT EXISTS (
      SELECT 1 FROM product_batches b WHERE b.product_id=p.id
    )`).all();
  const insert = db.prepare(`INSERT INTO product_batches
    (product_id, quantity, expiration_date, received_date) VALUES (?, ?, ?, ?)`);
  products.forEach(product => insert.run(product.id, product.quantity, product.expiration_date || null, product.received_date || null));
  return products.length;
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
    expiration: "CASE WHEN expiration_date IS NULL THEN 1 ELSE 0 END, expiration_date ASC, name COLLATE NOCASE ASC",
    name: 'name COLLATE NOCASE ASC',
    quantity: 'quantity ASC',
    newest: 'created_at DESC'
  }[sort] || 'name COLLATE NOCASE ASC';
  const rows = db.prepare(`
    SELECT id, name, category, unit, quantity, min_quantity, expiration_date, notes, created_at, updated_at,
      weight_grams, weight_value, weight_unit, brand, received_date, barcode,
      CASE WHEN image_data IS NOT NULL AND image_data <> '' THEN 1 ELSE 0 END AS has_image
    FROM products
    WHERE name LIKE @search AND (@category = '' OR category = @category)
    ORDER BY ${orderBy}
  `).all({ search: `%${search.trim()}%`, category });
  res.json(rows);
});
app.get('/api/products/expired', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.json(db.prepare(`SELECT id, name, category, brand, unit, quantity, expiration_date FROM products WHERE quantity>0 AND expiration_date IS NOT NULL AND expiration_date<? ORDER BY expiration_date ASC, name COLLATE NOCASE ASC`).all(today));
});

function deliveryById(id) {
  const delivery = db.prepare('SELECT * FROM deliveries WHERE id=?').get(id);
  if (!delivery) return null;
  delivery.items = db.prepare(`
    SELECT di.id, di.product_id, di.quantity, di.expiration_date,
      p.name, p.category, p.brand, p.unit, p.weight_value, p.weight_unit, p.image_data
    FROM delivery_items di
    LEFT JOIN products p ON p.id=di.product_id
    WHERE di.delivery_id=?
    ORDER BY di.id ASC
  `).all(id);
  return delivery;
}

app.get('/api/deliveries', allow('deliveryHistory'), (req, res) => {
  const rows = db.prepare('SELECT id FROM deliveries ORDER BY received_date DESC, id DESC LIMIT 100').all();
  res.json(rows.map(row => deliveryById(row.id)));
});

function cleanBarcode(value) {
  return String(value || '').trim().replace(/[^0-9A-Za-z-]/g, '').toUpperCase();
}

function deliveryDraft(value) {
  if (!value || typeof value !== 'object') return null;
  const name = String(value.name || '').trim().slice(0, 255);
  if (!name) return null;
  const rawWeight = String(value.weight || value.gramatura || '').trim();
  const parsedWeight = rawWeight.match(/^(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l)$/i);
  let weightValue = Number(value.weight_value);
  let weightUnit = String(value.weight_unit || '').trim().toLowerCase();
  if ((!Number.isFinite(weightValue) || weightValue <= 0 || !['g', 'kg', 'ml', 'l'].includes(weightUnit)) && parsedWeight) {
    weightValue = Number(parsedWeight[1].replace(',', '.'));
    weightUnit = parsedWeight[2].toLowerCase();
  }
  if (!Number.isFinite(weightValue) || weightValue <= 0 || !['g', 'kg', 'ml', 'l'].includes(weightUnit)) {
    weightValue = null;
    weightUnit = null;
  }
  const image = String(value.image_data || '');
  return {
    name,
    category: canonicalCategory(value.category),
    brand: String(value.brand || '').trim().slice(0, 120),
    unit: String(value.unit || 'szt.').trim().slice(0, 30) || 'szt.',
    weight_value: weightValue,
    weight_unit: weightUnit,
    barcode: cleanBarcode(value.barcode),
    image_data: image.startsWith('data:image/') ? image : null
  };
}

function createProductFromDeliveryDraft(draft) {
  if (draft.barcode && db.prepare('SELECT id FROM products WHERE barcode=?').get(draft.barcode)) {
    throw new Error('Ten kod kreskowy jest już przypisany do innego artykułu. Zeskanuj go ponownie, aby wybrać istniejący produkt.');
  }
  const grams = draft.weight_value && draft.weight_unit === 'g' ? draft.weight_value
    : draft.weight_value && draft.weight_unit === 'kg' ? draft.weight_value * 1000 : null;
  const result = db.prepare(`INSERT INTO products
    (name, category, brand, unit, quantity, min_quantity, weight_grams, weight_value, weight_unit, image_data, barcode, updated_at)
    VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
    .run(draft.name, draft.category, storedBrand(draft.category, draft.brand), draft.unit, grams, draft.weight_value, draft.weight_unit, draft.image_data, draft.barcode || null);
  return productById(Number(result.lastInsertRowid));
}

// Dostawa może jednocześnie zamknąć brak z zapotrzebowania. Ta część ilości
// nie trafia drugi raz na stan, bo pełne zapotrzebowanie już widnieje w historii dnia.
function normalizedShoppingText(value) {
  return String(value || '').toLocaleLowerCase('pl-PL').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function isSameLooseShoppingProduct(item, product) {
  if (Number(item.product_id) === Number(product.id)) return true;
  if (item.product_id) return false;
  const sameName = normalizedShoppingText(item.name) === normalizedShoppingText(product.name);
  const sameCategory = canonicalCategory(item.category) === canonicalCategory(product.category);
  const itemBrand = normalizedShoppingText(item.brand);
  const productBrand = normalizedShoppingText(product.brand);
  const sameBrand = !itemBrand || itemBrand === productBrand;
  const productWeight = product.weight_value ? `${product.weight_value} ${product.weight_unit || ''}` : '';
  const sameWeight = !String(item.weight || '').trim() || normalizedShoppingText(item.weight) === normalizedShoppingText(productWeight);
  return sameName && sameCategory && sameBrand && sameWeight;
}

function resolveDeliveredShoppingItems(product, quantity, receivedDate) {
  const productId = product.id;
  let remainingForStock = Number(quantity);
  const linkedItems = db.prepare(`SELECT i.*, di.shortage_quantity, di.shortage_resolved_quantity
    FROM shopping_list_items i
    JOIN demand_items di ON di.id=i.demand_item_id
    WHERE i.product_id=? AND i.demand_item_id IS NOT NULL
      AND COALESCE(i.purchased_quantity, 0) < i.missing_quantity
      AND COALESCE(di.shortage_resolution, '') <> 'dismissed'
    ORDER BY i.id ASC`).all(productId);
  const updateItem = db.prepare(`UPDATE shopping_list_items
    SET purchased_at=CURRENT_TIMESTAMP, purchased_date=?, purchased_quantity=COALESCE(purchased_quantity, 0)+?
    WHERE id=?`);
  const updateDemand = db.prepare(`UPDATE demand_items
    SET shortage_resolved_quantity=?, shortage_resolution=? WHERE id=?`);
  const deleteItem = db.prepare('DELETE FROM shopping_list_items WHERE id=?');
  for (const item of linkedItems) {
    if (remainingForStock <= 0) break;
    const listRemaining = Math.max(0, Number(item.missing_quantity) - Number(item.purchased_quantity || 0));
    const shortageRemaining = Math.max(0, Number(item.shortage_quantity || 0) - Number(item.shortage_resolved_quantity || 0));
    const resolved = Math.min(remainingForStock, listRemaining, shortageRemaining);
    if (resolved <= 0) continue;
    const resolvedTotal = Math.min(Number(item.shortage_quantity || 0), Number(item.shortage_resolved_quantity || 0) + resolved);
    updateItem.run(receivedDate, resolved, item.id);
    updateDemand.run(resolvedTotal, resolvedTotal >= Number(item.shortage_quantity || 0) ? 'purchased' : 'partial', item.demand_item_id);
    if (resolved >= listRemaining) deleteItem.run(item.id);
    remainingForStock -= resolved;
  }

  // Ręczne/tymczasowe wpisy na liście oznaczamy jako załatwione przez dostawę,
  // lecz ich ilość pozostaje na magazynie (nie były wcześniej wpisane do historii dnia).
  const looseItems = db.prepare(`SELECT * FROM shopping_list_items
    WHERE (product_id=? OR product_id IS NULL) AND demand_item_id IS NULL
      AND COALESCE(purchased_quantity, 0) < missing_quantity
    ORDER BY id ASC`).all(productId).filter(item => isSameLooseShoppingProduct(item, product));
  // Najpierw dostawa uzupełnia powiązane zapotrzebowanie z Historii dnia.
  // Tylko realna nadwyżka może zamknąć niezależną, ręczną pozycję zakupową.
  let remainingForLooseItems = Math.max(0, remainingForStock);
  for (const item of looseItems) {
    if (remainingForLooseItems <= 0) break;
    const remaining = Math.max(0, Number(item.missing_quantity) - Number(item.purchased_quantity || 0));
    const amount = Math.min(remainingForLooseItems, remaining);
    if (amount <= 0) continue;
    updateItem.run(receivedDate, amount, item.id);
    if (amount >= remaining) deleteItem.run(item.id);
    remainingForLooseItems -= amount;
  }
  return Math.max(0, remainingForStock);
}

// Zatwierdzenie grupowej dostawy: wszystkie partie i historia powstają
// w jednej transakcji, więc nie ma ryzyka zapisania tylko części produktów.
app.post('/api/deliveries', (req, res) => {
  const supplier = String(req.body?.supplier || '').trim();
  const received = parseExpiration(req.body?.received_date) || new Date().toISOString().slice(0, 10);
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  const items = (Array.isArray(req.body?.items) ? req.body.items : []).map(raw => {
    const productId = productIdFrom(raw.product_id);
    return {
      product_id: productId,
      // Obsługujemy także płaski formularz starszego interfejsu.
      new_product: deliveryDraft(raw.new_product || (productId ? null : raw)),
      quantity: Number(raw.quantity),
      expiration_date: parseExpiration(raw.expiration_date)
    };
  }).filter(item => Number.isFinite(item.quantity) && item.quantity > 0 && (item.product_id || item.new_product));
  if (!supplier) return res.status(400).json({ error: 'Podaj nazwę dostawy lub dostawcy.' });
  if (!items.length) return res.status(400).json({ error: 'Dodaj co najmniej jeden artykuł do dostawy.' });

  db.exec('BEGIN');
  try {
    const createDelivery = db.prepare('INSERT INTO deliveries (supplier, received_date, note) VALUES (?, ?, ?)');
    const delivery = createDelivery.run(supplier, received, note);
    const addItem = db.prepare('INSERT INTO delivery_items (delivery_id, product_id, quantity, expiration_date) VALUES (?, ?, ?, ?)');
    const updateProduct = db.prepare('UPDATE products SET quantity=quantity+?, received_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?');
    const addBatch = db.prepare('INSERT INTO product_batches (product_id, quantity, expiration_date, received_date) VALUES (?, ?, ?, ?)');
    const addMovement = db.prepare("INSERT INTO movements (product_id, type, quantity, note) VALUES (?, 'add', ?, ?)");
    const touched = new Set();
    for (const item of items) {
      const product = item.product_id ? productById(item.product_id) : createProductFromDeliveryDraft(item.new_product);
      if (!product) throw new Error('Jeden z produktów nie istnieje już w magazynie. Odśwież stronę i spróbuj ponownie.');
      const stockQuantity = resolveDeliveredShoppingItems(product, item.quantity, received);
      addItem.run(delivery.lastInsertRowid, product.id, item.quantity, item.expiration_date);
      updateProduct.run(stockQuantity, received, product.id);
      if (stockQuantity > 0) {
        addBatch.run(product.id, stockQuantity, item.expiration_date, received);
        addMovement.run(product.id, stockQuantity, `Dostawa: ${supplier}`);
      }
      touched.add(product.id);
    }
    touched.forEach(id => syncProductExpiryFromBatches(id));
    db.exec('COMMIT');
    res.status(201).json(deliveryById(Number(delivery.lastInsertRowid)));
  } catch (error) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: error.message || 'Nie udało się zapisać dostawy.' });
  }
});

app.get('/api/categories', (req, res) => {
  res.json(db.prepare("SELECT DISTINCT category FROM products WHERE category <> '' ORDER BY category COLLATE NOCASE").all().map(r => r.category));
});

function isExcludedShoppingItem(item) {
  const normalize = value => String(value || '').toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const category = normalize(item.category);
  const text = normalize(`${item.name} ${item.category}`);
  return category === 'inne' || category.includes('owoce') || category.includes('bulki z katowic') || text.includes('office box') || ['bajgiel', 'bagiel', 'bulka', 'ciabatta', 'bagietka', 'kanapk'].some(word => text.includes(word));
}

function openShoppingList(listDate, sourceText = '') {
  const active = db.prepare(`SELECT l.id FROM shopping_lists l
    WHERE EXISTS (
      SELECT 1 FROM shopping_list_items i
      WHERE i.shopping_list_id=l.id AND COALESCE(i.purchased_quantity, 0) < i.missing_quantity
    )
    ORDER BY l.id DESC LIMIT 1`).get();
  if (active) return Number(active.id);
  return Number(db.prepare('INSERT INTO shopping_lists (source_text, list_date) VALUES (?, ?)')
    .run(String(sourceText || '').slice(0, 50000), listDate).lastInsertRowid);
}

function insertShoppingItem(listId, item, { demandRunId = null, demandItemId = null, source = 'demand' } = {}) {
  return db.prepare(`INSERT INTO shopping_list_items
    (shopping_list_id, product_id, name, category, brand, weight, required_quantity, available_quantity, missing_quantity, unit, demand_run_id, demand_item_id, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(listId, item.product_id || null, item.name, canonicalCategory(item.category), item.brand || '', item.weight || '', item.required_quantity, item.available_quantity, item.missing_quantity, item.unit || 'szt.', demandRunId, demandItemId, source);
}

function shoppingListById(id) {
  const list = db.prepare('SELECT * FROM shopping_lists WHERE id=?').get(id);
  if (!list) return null;
  list.items = db.prepare("SELECT * FROM shopping_list_items WHERE shopping_list_id=? ORDER BY category COLLATE NOCASE, name COLLATE NOCASE").all(id).filter(item => !isExcludedShoppingItem(item));
  return list;
}
app.get('/api/shopping-lists/latest', allow('shopping'), (req, res) => {
  const latest = db.prepare(`SELECT l.id FROM shopping_lists l
    ORDER BY CASE WHEN EXISTS (
      SELECT 1 FROM shopping_list_items i
      WHERE i.shopping_list_id=l.id AND COALESCE(i.purchased_quantity, 0) < i.missing_quantity
    ) THEN 0 ELSE 1 END, l.id DESC LIMIT 1`).get();
  res.json(latest ? shoppingListById(latest.id) : null);
});
app.post('/api/shopping-lists', (req, res) => {
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  const items = rawItems.map(item => ({
    product_id: productIdFrom(item.product_id),
    name: String(item.name || '').trim(), category: String(item.category || 'Inne').trim() || 'Inne', brand: String(item.brand || '').trim(),
    weight: String(item.weight || '').trim(), required_quantity: Number(item.required_quantity), available_quantity: Number(item.available_quantity),
    missing_quantity: Number(item.missing_quantity), unit: String(item.unit || 'szt.').trim() || 'szt.'
  })).filter(item => item.name && validNumber(item.required_quantity) && item.required_quantity > 0 && validNumber(item.available_quantity) && item.available_quantity >= 0 && validNumber(item.missing_quantity) && item.missing_quantity > 0);
  db.exec('BEGIN');
  try {
    const listDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.list_date || '')) ? req.body.list_date : new Date().toISOString().slice(0, 10);
    const listId = openShoppingList(listDate, req.body?.source_text);
    const existingPreview = db.prepare(`SELECT id FROM shopping_list_items
      WHERE shopping_list_id=? AND source='preview' AND COALESCE(purchased_quantity, 0) < missing_quantity
        AND ((product_id IS NOT NULL AND product_id=?) OR (product_id IS NULL AND name=? AND category=?))
      ORDER BY id DESC LIMIT 1`);
    const updatePreview = db.prepare(`UPDATE shopping_list_items
      SET name=?, category=?, brand=?, weight=?, required_quantity=?, available_quantity=?, missing_quantity=?, unit=?
      WHERE id=?`);
    items.forEach(item => {
      const previous = existingPreview.get(listId, item.product_id, item.name, canonicalCategory(item.category));
      if (previous) updatePreview.run(item.name, canonicalCategory(item.category), item.brand, item.weight, item.required_quantity, item.available_quantity, item.missing_quantity, item.unit, previous.id);
      else insertShoppingItem(listId, item, { source:'preview' });
    });
    db.exec('COMMIT'); res.status(201).json(shoppingListById(listId));
  } catch (error) { db.exec('ROLLBACK'); throw error; }
});

// Ręczny wpis pozwala dopisać rzecz, której jeszcze nie ma w bieżącym porównaniu.
app.post('/api/shopping-lists/items', (req, res) => {
  const body = req.body || {};
  const quantity = Number(body.missing_quantity ?? body.quantity ?? body.required_quantity);
  const name = String(body.name || '').trim();
  if (!name || !Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Podaj nazwę oraz prawidłową ilość do kupienia.' });
  const listDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.list_date || '')) ? body.list_date : new Date().toISOString().slice(0, 10);
  const productId = productIdFrom(body.product_id);
  const item = {
    product_id: productId,
    name,
    category: canonicalCategory(body.category),
    brand: String(body.brand || '').trim(),
    weight: String(body.weight || '').trim(),
    required_quantity: quantity,
    available_quantity: Number.isFinite(Number(body.available_quantity)) ? Number(body.available_quantity) : 0,
    missing_quantity: quantity,
    unit: String(body.unit || 'szt.').trim() || 'szt.'
  };
  db.exec('BEGIN');
  try {
    const listId = openShoppingList(listDate, 'Ręcznie dodana pozycja');
    const result = insertShoppingItem(listId, item, { source:'manual' });
    db.exec('COMMIT');
    res.status(201).json({ item: db.prepare('SELECT * FROM shopping_list_items WHERE id=?').get(result.lastInsertRowid), list:shoppingListById(listId) });
  } catch (error) { db.exec('ROLLBACK'); throw error; }
});

// Usunięcie pojedynczej, niepotrzebnej pozycji z bieżącej listy zakupów.
app.delete('/api/shopping-lists/items/:id', (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare('SELECT * FROM shopping_list_items WHERE id=?').get(id);
  if (!item) return res.status(404).json({ error: 'Nie znaleziono tej pozycji na liście zakupów.' });
  db.exec('BEGIN');
  try {
    if (item.demand_item_id) {
      db.prepare(`UPDATE demand_items
        SET shortage_resolved_quantity=shortage_quantity, shortage_resolution='dismissed'
        WHERE id=?`).run(item.demand_item_id);
    }
    db.prepare('DELETE FROM shopping_list_items WHERE id=?').run(id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.status(204).end();
});

// Zielona fajka zapisuje zakupioną część do historii dnia. Tylko nadwyżka
// ponad wymagane zapotrzebowanie trafia jako nowa partia do magazynu.
app.post('/api/shopping-lists/items/:id/complete', (req, res) => {
  const item = db.prepare(`SELECT i.*, s.list_date, di.shortage_quantity, di.shortage_resolved_quantity
    FROM shopping_list_items i
    JOIN shopping_lists s ON s.id=i.shopping_list_id
    LEFT JOIN demand_items di ON di.id=i.demand_item_id
    WHERE i.id=?`).get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Nie znaleziono tej pozycji na liście zakupów.' });
  const purchasedNow = Number(req.body?.purchased_quantity);
  if (!Number.isFinite(purchasedNow) || purchasedNow <= 0) return res.status(400).json({ error: 'Podaj prawidłową liczbę zakupionych sztuk.' });
  const purchaseDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.purchased_date || '')) ? req.body.purchased_date : new Date().toISOString().slice(0, 10);
  const alreadyPurchased = Math.min(Number(item.purchased_quantity || 0), Number(item.missing_quantity));
  const requiredRemaining = Math.max(0, Number(item.missing_quantity) - alreadyPurchased);
  // SQLite zwraca NULL dla ręcznych pozycji. Number(null) daje 0, dlatego
  // trzeba dodatkowo wymagać prawdziwego, dodatniego identyfikatora.
  const demandItemId = Number(item.demand_item_id);
  const linkedDemand = Number.isInteger(demandItemId) && demandItemId > 0;
  const historyQuantity = linkedDemand ? Math.min(purchasedNow, requiredRemaining) : 0;
  const surplusQuantity = linkedDemand ? Math.max(0, purchasedNow - historyQuantity) : purchasedNow;
  const received = parseExpiration(req.body?.received_date) || purchaseDate;
  const expiration = parseExpiration(req.body?.expiration_date);
  db.exec('BEGIN');
  try {
    if (purchasedNow > 0) {
      db.prepare('UPDATE shopping_list_items SET purchased_at=CURRENT_TIMESTAMP, purchased_date=?, purchased_quantity=purchased_quantity+? WHERE id=?')
        .run(purchaseDate, linkedDemand ? historyQuantity : purchasedNow, item.id);
    }
    if (linkedDemand && historyQuantity > 0) {
      const resolvedTotal = Math.min(Number(item.shortage_quantity || 0), Number(item.shortage_resolved_quantity || 0) + historyQuantity);
      db.prepare('UPDATE demand_items SET shortage_resolved_quantity=?, shortage_resolution=? WHERE id=?')
        .run(resolvedTotal, resolvedTotal >= Number(item.shortage_quantity || 0) ? 'purchased' : 'partial', item.demand_item_id);
    }
    let product = null;
    if (surplusQuantity > 0) {
      product = item.product_id ? productById(item.product_id) : null;
      if (!product) {
        const weight = String(item.weight || '').match(/^\s*(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)\s*$/i);
        const result = db.prepare(`INSERT INTO products (name, category, brand, unit, quantity, min_quantity, weight_value, weight_unit, expiration_date, received_date, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
          .run(item.name, canonicalCategory(item.category), storedBrand(canonicalCategory(item.category), item.brand || ''), item.unit || 'szt.', surplusQuantity, weight ? Number(weight[1].replace(',', '.')) : null, weight ? weight[2].toLowerCase() : null, expiration, received);
        product = productById(result.lastInsertRowid);
      } else {
        db.prepare('UPDATE products SET quantity=quantity+?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(surplusQuantity, product.id);
      }
      db.prepare('INSERT INTO product_batches (product_id, quantity, expiration_date, received_date) VALUES (?, ?, ?, ?)')
        .run(product.id, surplusQuantity, expiration, received);
      syncProductExpiryFromBatches(product.id);
      db.prepare("INSERT INTO movements (product_id, type, quantity, note) VALUES (?, 'add', ?, 'Nadwyżka z listy zakupów')")
        .run(product.id, surplusQuantity);
    }
    db.exec('COMMIT');
    res.json({ item_id:item.id, purchased_quantity:historyQuantity, surplus_quantity:surplusQuantity, product, purchased_date:purchaseDate });
  } catch (error) { db.exec('ROLLBACK'); throw error; }
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
removeEmptyLegacyCookieCategory();

// Trwałe uporządkowanie kategorii na istniejącym serwerze Railway.
// Produkty są scalane, a nie kasowane: zachowujemy ilości, daty i zdjęcia.
function applyCategoryCorrections() {
  const setting = 'category_labels_2026_08_02';
  if (db.prepare('SELECT value FROM app_settings WHERE key=?').get(setting)) return 0;
  let changed = 0;
  const pathExists = db.prepare(`SELECT id FROM inventory_paths
    WHERE level=? AND category=? AND brand=?
      AND COALESCE(weight_value, -1)=COALESCE(?, -1)
      AND COALESCE(weight_unit, '')=COALESCE(?, '') LIMIT 1`);
  db.exec('BEGIN');
  try {
    for (const row of db.prepare('SELECT DISTINCT category FROM products').all()) {
      const next = canonicalCategory(row.category);
      if (next !== row.category) changed += db.prepare('UPDATE products SET category=?, updated_at=CURRENT_TIMESTAMP WHERE category=?').run(next, row.category).changes;
    }
    for (const row of db.prepare('SELECT id, level, category, brand, weight_value, weight_unit FROM inventory_paths').all()) {
      const next = canonicalCategory(row.category);
      if (next === row.category) continue;
      if (pathExists.get(row.level, next, row.brand, row.weight_value, row.weight_unit)) db.prepare('DELETE FROM inventory_paths WHERE id=?').run(row.id);
      else db.prepare('UPDATE inventory_paths SET category=? WHERE id=?').run(next, row.id);
    }
    for (const row of db.prepare('SELECT category FROM category_images').all()) {
      let next = row.category;
      if (next.startsWith('category:')) next = `category:${canonicalCategory(next.slice(9))}`;
      else if (next.startsWith('brand:') || next.startsWith('weight:')) {
        const [kind, oldCategory, ...rest] = next.split(':');
        next = `${kind}:${canonicalCategory(oldCategory)}:${rest.join(':')}`;
      }
      if (next === row.category) continue;
      if (db.prepare('SELECT 1 FROM category_images WHERE category=?').get(next)) db.prepare('DELETE FROM category_images WHERE category=?').run(row.category);
      else db.prepare('UPDATE category_images SET category=?, updated_at=CURRENT_TIMESTAMP WHERE category=?').run(next, row.category);
    }
    db.prepare("INSERT INTO app_settings (key, value) VALUES (?, 'true')").run(setting);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return changed;
}
const correctedCategories = applyCategoryCorrections();
if (correctedCategories) console.log(`Ujednolicono kategorie produktów: ${correctedCategories}.`);

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
  const name = level === 'category' ? canonicalCategory(value) : String(value).trim();
  const parentCategory = canonicalCategory(category);
  if (!name || !['category','brand','weight'].includes(level)) return res.status(400).json({ error: 'Podaj nazwę nowej gałęzi.' });
  let row;
  if (level === 'category') row = { level, category:name, brand:'', weight_value:null, weight_unit:null };
  else if (level === 'brand') row = { level, category:parentCategory, brand:name, weight_value:null, weight_unit:null };
  else {
    const match = name.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)$/i);
    if (!match) return res.status(400).json({ error: 'Podaj gramaturę np. 400 ml.' });
    row = { level, category:parentCategory, brand, weight_value:Number(match[1].replace(',', '.')), weight_unit:match[2].toLowerCase() };
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
  const next = level === 'category' ? canonicalCategory(value) : String(value).trim();
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
  const destination = level === 'category' ? canonicalCategory(target) : String(target).trim();
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
  const destinationCategory = canonicalCategory(target_category);
  const destinationBrand = target_brand === 'Pozostałe' ? '' : target_brand;
  const match = String(target_weight).match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)$/i);
  if (!destinationCategory || !target_brand || !match) return res.status(400).json({ error: 'Wybierz kategorię, firmę i gramaturę.' });
  const targetValue = Number(match[1].replace(',', '.')), targetUnit = match[2].toLowerCase();
  let result;
  if (level === 'category') result = db.prepare('UPDATE products SET category=?, updated_at=CURRENT_TIMESTAMP WHERE category=?').run(destinationCategory, category);
  else if (level === 'brand') result = db.prepare("UPDATE products SET category=?, brand=?, updated_at=CURRENT_TIMESTAMP WHERE category=? AND (COALESCE(brand,'')=COALESCE(?, '') OR (?='' AND brand='Pozostałe'))").run(destinationCategory, destinationBrand, category, sourceBrand, sourceBrand);
  else if (level === 'weight') result = db.prepare("UPDATE products SET category=?, brand=?, weight_value=?, weight_unit=?, updated_at=CURRENT_TIMESTAMP WHERE category=? AND (COALESCE(brand,'')=COALESCE(?, '') OR (?='' AND brand='Pozostałe')) AND COALESCE(weight_value,-1)=COALESCE(?,-1) AND COALESCE(weight_unit,'')=COALESCE(?, '')").run(destinationCategory, destinationBrand, targetValue, targetUnit, category, sourceBrand, sourceBrand, weight_value, weight_unit);
  else return res.status(400).json({ error: 'Nieznany poziom ścieżki.' });
  res.json({ moved: result.changes });
});

app.post('/api/products', (req, res) => {
  const { name, category = 'Inne', brand = '', unit = 'szt.', quantity = 0, min_quantity = 0, weight_value = null, weight_unit = null, expiration_date = null, received_date = null, image_data = null, notes = '', barcode = '' } = req.body;
  if (!name || !name.trim() || !validNumber(quantity) || quantity < 0 || !validNumber(min_quantity) || min_quantity < 0) {
    return res.status(400).json({ error: 'Podaj nazwę oraz prawidłowe ilości.' });
  }
  const normalizedBarcode = String(barcode || '').trim().replace(/[^0-9A-Za-z-]/g, '').toUpperCase();
  if (normalizedBarcode && db.prepare('SELECT id FROM products WHERE barcode=?').get(normalizedBarcode)) return res.status(409).json({ error: 'Ten kod kreskowy jest już przypisany do innego artykułu.' });
  const result = db.prepare(`INSERT INTO products (name, category, brand, unit, quantity, min_quantity, weight_value, weight_unit, expiration_date, received_date, image_data, notes, barcode, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(name.trim(), canonicalCategory(category), brand.trim(), unit.trim() || 'szt.', quantity, min_quantity, validNumber(weight_value) && weight_value > 0 ? weight_value : null, weight_unit || null, parseExpiration(expiration_date), parseExpiration(received_date), image_data || null, notes.trim(), normalizedBarcode || null);
  if (quantity > 0) {
    db.prepare("INSERT INTO movements (product_id, type, quantity, note) VALUES (?, 'add', ?, 'Stan początkowy')").run(result.lastInsertRowid, quantity);
    db.prepare('INSERT INTO product_batches (product_id, quantity, expiration_date, received_date) VALUES (?, ?, ?, ?)')
      .run(result.lastInsertRowid, quantity, parseExpiration(expiration_date), parseExpiration(received_date));
  }
  res.status(201).json(productById(result.lastInsertRowid));
});

app.put('/api/products/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = productById(id);
  if (!existing) return res.status(404).json({ error: 'Nie znaleziono produktu.' });
  const { name, category, brand = '', unit, quantity = existing.quantity, min_quantity = 0, weight_value = null, weight_unit = null, received_date, expiration_date, notes, barcode = existing.barcode || '' } = req.body;
  if (!name || !name.trim() || !validNumber(min_quantity) || min_quantity < 0) return res.status(400).json({ error: 'Sprawdź wymagane pola.' });
  if (!validNumber(quantity) || quantity < 0) return res.status(400).json({ error: 'Podaj prawidłową ilość.' });
  const normalizedBarcode = String(barcode || '').trim().replace(/[^0-9A-Za-z-]/g, '').toUpperCase();
  if (normalizedBarcode && db.prepare('SELECT id FROM products WHERE barcode=? AND id<>?').get(normalizedBarcode, id)) return res.status(409).json({ error: 'Ten kod kreskowy jest już przypisany do innego artykułu.' });
  // Pusta data z formularza nie może skasować wpisanego wcześniej terminu,
  // dopóki produkt nadal znajduje się na stanie. Termin znika dopiero przy stanie 0.
  const parsedExpiration = parseExpiration(expiration_date) || (Number(quantity) > 0 ? existing.expiration_date : null);
  const parsedReceived = parseExpiration(received_date);
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE products SET name=?, category=?, brand=?, unit=?, quantity=?, min_quantity=?, weight_value=?, weight_unit=?, received_date=?, expiration_date=?, notes=?, barcode=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(name.trim(), canonicalCategory(category), brand.trim(), (unit || 'szt.').trim(), quantity, min_quantity, validNumber(weight_value) && weight_value > 0 ? weight_value : null, weight_unit || null, parsedReceived, parsedExpiration, (notes || '').trim(), normalizedBarcode || null, id);
    if (req.body?.sync_expiry_batch && parsedExpiration) {
      const batches = db.prepare('SELECT COUNT(*) AS count FROM product_batches WHERE product_id=? AND quantity>0').get(id);
      if (!batches.count && quantity > 0) {
        db.prepare('INSERT INTO product_batches (product_id, quantity, expiration_date, received_date) VALUES (?, ?, ?, ?)')
          .run(id, quantity, parsedExpiration, parsedReceived);
      } else {
        db.prepare(`UPDATE product_batches SET expiration_date=COALESCE(expiration_date, ?), received_date=COALESCE(received_date, ?) WHERE product_id=? AND quantity>0`)
          .run(parsedExpiration, parsedReceived, id);
      }
      syncProductExpiryFromBatches(id);
    }
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

app.post('/api/products/:id/remove-expired', (req, res) => {
  const id = Number(req.params.id), product = productById(id), today = new Date().toISOString().slice(0, 10);
  if (!product) return res.status(404).json({ error: 'Nie znaleziono produktu.' });
  const batches = db.prepare('SELECT id,quantity FROM product_batches WHERE product_id=? AND quantity>0 AND expiration_date IS NOT NULL AND expiration_date<?').all(id, today);
  const removed = batches.reduce((total, batch) => total + Number(batch.quantity || 0), 0) || (product.expiration_date && product.expiration_date < today ? Number(product.quantity) : 0);
  if (!removed) return res.status(400).json({ error: 'Ten produkt nie ma już partii po terminie.' });
  db.exec('BEGIN');
  try {
    if (batches.length) db.prepare('UPDATE product_batches SET quantity=0 WHERE product_id=? AND quantity>0 AND expiration_date IS NOT NULL AND expiration_date<?').run(id, today);
    const remaining = Math.max(0, Number(product.quantity) - removed);
    if (remaining <= 0) { db.prepare('DELETE FROM movements WHERE product_id=?').run(id); db.prepare('DELETE FROM product_batches WHERE product_id=?').run(id); db.prepare('DELETE FROM products WHERE id=?').run(id); }
    else { db.prepare('UPDATE products SET quantity=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(remaining, id); syncProductExpiryFromBatches(id); db.prepare("INSERT INTO movements (product_id,type,quantity,note) VALUES (?, 'remove', ?, 'Usunięcie partii po terminie')").run(id, removed); }
    db.prepare('DELETE FROM notifications WHERE entity_key LIKE ?').run(`expiry:${id}:%`);
    db.exec('COMMIT'); res.json({ removed, deleted: remaining <= 0 });
  } catch (error) { db.exec('ROLLBACK'); throw error; }
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
    if (increase) {
      db.prepare('INSERT INTO product_batches (product_id, quantity, expiration_date, received_date) VALUES (?, ?, NULL, ?)')
        .run(id, quantity, new Date().toISOString().slice(0, 10));
    } else {
      consumeProductBatches(id, quantity);
    }
    db.prepare('INSERT INTO movements (product_id, type, quantity, note) VALUES (?, ?, ?, ?)').run(id, type, quantity, note.trim());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  res.json(productById(id));
});

// Zapotrzebowanie jest odjmowane wyłącznie po ręcznym zatwierdzeniu listy.
app.post('/api/demand/apply', (req, res) => {
  const { password = '', source_name = '', recognized_text = '', demand_date = '' } = req.body || {};
  if (password !== '123') return res.status(403).json({ error: 'Nieprawidłowe hasło zatwierdzające.' });
  const demandDate = /^\d{4}-\d{2}-\d{2}$/.test(String(demand_date)) ? demand_date : new Date().toISOString().slice(0, 10);
  const quantities = new Map();
  for (const item of (Array.isArray(req.body?.items) ? req.body.items : [])) {
    const id = Number(item.product_id), quantity = Number(item.quantity);
    if (Number.isInteger(id) && Number.isFinite(quantity) && quantity > 0) quantities.set(id, (quantities.get(id) || 0) + quantity);
  }
  if (!quantities.size) return res.status(400).json({ error: 'Dodaj przynajmniej jeden produkt z ilością większą od zera.' });
  const ids = [...quantities.keys()], marks = ids.map(() => '?').join(',');
  const products = db.prepare(`SELECT * FROM products WHERE id IN (${marks})`).all(...ids);
  if (products.length !== ids.length) return res.status(400).json({ error: 'Jeden z wybranych produktów już nie istnieje.' });
  db.exec('BEGIN');
  try {
    const run = db.prepare('INSERT INTO demand_runs (source_name, recognized_text, demand_date) VALUES (?, ?, ?)').run(String(source_name).slice(0, 255), String(recognized_text).slice(0, 50000), demandDate);
    const update = db.prepare('UPDATE products SET quantity=quantity-?, updated_at=CURRENT_TIMESTAMP WHERE id=?');
    const movement = db.prepare("INSERT INTO movements (product_id, type, quantity, note) VALUES (?, 'demand', ?, ?)");
    const addItem = db.prepare(`INSERT INTO demand_items
      (demand_run_id, product_id, quantity, issued_quantity, shortage_quantity, shortage_resolved_quantity, shortage_resolution)
      VALUES (?, ?, ?, ?, ?, 0, '')`);
    const snapshot = db.prepare('INSERT OR IGNORE INTO demand_day_products (demand_date, product_id, opening_quantity) VALUES (?, ?, ?)');
    const shortages = [];
    for (const product of products) {
      const requested = quantities.get(product.id);
      const issued = Math.min(requested, product.quantity);
      const missing = requested - issued;
      // Każdy wpis jest widoczny w historii, także gdy stan wynosił 0.
      snapshot.run(demandDate, product.id, product.quantity);
      const demandItem = addItem.run(run.lastInsertRowid, product.id, requested, issued, missing);
      if (missing > 0) shortages.push({ demand_item_id:Number(demandItem.lastInsertRowid), product_id:product.id, name:product.name, category:product.category, brand:product.brand || '', weight:product.weight_value ? `${product.weight_value} ${product.weight_unit}` : '', required_quantity:requested, available_quantity:product.quantity, missing_quantity:missing, unit:product.unit });
      if (issued <= 0) continue;
      update.run(issued, product.id);
      consumeProductBatches(product.id, issued);
      movement.run(product.id, issued, `Zapotrzebowanie${source_name ? `: ${String(source_name).slice(0, 120)}` : ''}`);
    }
    // Niedobory z zatwierdzonego zapotrzebowania są od razu gotowe na liście zakupów.
    // Starsze otwarte pozycje pozostają na niej do czasu zakupu albo skasowania.
    const visibleShortages = shortages.filter(item => !isExcludedShoppingItem(item));
    const updateDemandStatus = db.prepare('UPDATE demand_items SET shortage_resolved_quantity=?, shortage_resolution=? WHERE id=?');
    const visibleIds = new Set(visibleShortages.map(item => item.demand_item_id));
    // Owoce i pieczywo z Katowic nie są zakupami do realizacji przez magazyn.
    shortages.filter(item => !visibleIds.has(item.demand_item_id)).forEach(item => updateDemandStatus.run(item.missing_quantity, 'excluded', item.demand_item_id));
    if (visibleShortages.length) {
      const listId = openShoppingList(demandDate, recognized_text);
      const previewItem = db.prepare(`SELECT id FROM shopping_list_items
        WHERE product_id=? AND source='preview' AND demand_item_id IS NULL
          AND COALESCE(purchased_quantity, 0) < missing_quantity
        ORDER BY id DESC LIMIT 1`);
      const connectPreview = db.prepare(`UPDATE shopping_list_items
        SET name=?, category=?, brand=?, weight=?, required_quantity=?, available_quantity=?, missing_quantity=?, unit=?,
          demand_run_id=?, demand_item_id=?, source='demand'
        WHERE id=?`);
      visibleShortages.forEach(item => {
        const preview = previewItem.get(item.product_id);
        if (preview) connectPreview.run(item.name, canonicalCategory(item.category), item.brand, item.weight, item.required_quantity, item.available_quantity, item.missing_quantity, item.unit, run.lastInsertRowid, item.demand_item_id, preview.id);
        else insertShoppingItem(listId, item, { demandRunId:Number(run.lastInsertRowid), demandItemId:item.demand_item_id, source:'demand' });
      });
    }
    db.exec('COMMIT');
    res.json({ applied: products.filter(product => Math.min(quantities.get(product.id), product.quantity) > 0).length, demand_id: Number(run.lastInsertRowid), shortages:visibleShortages });
  } catch (error) { db.exec('ROLLBACK'); throw error; }
});

function validDemandDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }
function getDemandItems(runId) {
  return db.prepare(`SELECT di.id, di.product_id, di.quantity,
    COALESCE(di.issued_quantity, di.quantity) AS issued_quantity,
    COALESCE(di.shortage_quantity, 0) AS shortage_quantity,
    COALESCE(di.shortage_resolved_quantity, 0) AS shortage_resolved_quantity,
    COALESCE(di.shortage_resolution, '') AS shortage_resolution,
    COALESCE(di.corrected_quantity, 0) AS corrected_quantity,
    p.name, p.brand, p.category, p.unit, p.quantity AS current_quantity, p.weight_value, p.weight_unit,
    dp.opening_quantity
    FROM demand_items di
    JOIN products p ON p.id=di.product_id
    LEFT JOIN demand_runs dr ON dr.id=di.demand_run_id
    LEFT JOIN demand_day_products dp ON dp.product_id=di.product_id AND dp.demand_date=dr.demand_date
    WHERE di.demand_run_id=? ORDER BY p.name COLLATE NOCASE`).all(runId);
}
app.get('/api/demand/daily', (req, res) => {
  const demandDate = validDemandDate(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
  const runs = db.prepare("SELECT id, source_name, demand_date, created_at, reversed_at FROM demand_runs WHERE COALESCE(demand_date, date(created_at))=? ORDER BY id DESC").all(demandDate);
  const purchases = db.prepare(`SELECT i.id, i.name, i.category, i.brand, i.weight, i.purchased_quantity, i.unit, i.purchased_date
    FROM shopping_list_items i
    WHERE i.demand_item_id IS NULL
      AND COALESCE(i.purchased_date, date(i.purchased_at))=? AND COALESCE(i.purchased_quantity, 0)>0
    ORDER BY i.category COLLATE NOCASE, i.name COLLATE NOCASE`).all(demandDate);
  const withItems = runs.map(run => ({ ...run, items: getDemandItems(run.id) }));
  const summary = new Map();
  withItems.forEach(run => run.items.forEach(item => {
    const record = summary.get(item.product_id) || { product_id:item.product_id, name:item.name, unit:item.unit, opening_quantity:item.opening_quantity, demanded:0, issued:0, shortage:0, shortage_resolved:0, corrected:0, current_quantity:item.current_quantity };
    record.demanded += item.quantity; record.issued += item.issued_quantity; record.shortage += item.shortage_quantity; record.shortage_resolved += item.shortage_resolved_quantity; record.corrected += item.corrected_quantity; summary.set(item.product_id, record);
  }));
  res.json({ date:demandDate, runs:withItems, purchases, summary:[...summary.values()].sort((a,b) => a.name.localeCompare(b.name, 'pl')) });
});
app.post('/api/demand/runs/:id/correct', (req, res) => {
  const runId = Number(req.params.id);
  if (req.body?.password !== '123') return res.status(403).json({ error: 'Nieprawidłowe hasło zatwierdzające.' });
  const run = db.prepare('SELECT id, demand_date FROM demand_runs WHERE id=?').get(runId);
  if (!run) return res.status(404).json({ error: 'Nie znaleziono tego zapotrzebowania.' });
  const requested = new Map();
  for (const entry of (Array.isArray(req.body?.items) ? req.body.items : [])) {
    const productId = Number(entry.product_id), quantity = Number(entry.quantity);
    if (Number.isInteger(productId) && Number.isFinite(quantity) && quantity > 0) requested.set(productId, (requested.get(productId) || 0) + quantity);
  }
  if (!requested.size) return res.status(400).json({ error: 'Podaj ilość do przywrócenia.' });
  const items = getDemandItems(runId); const byProduct = new Map(items.map(item => [item.product_id, item]));
  for (const [productId, quantity] of requested) {
    const item = byProduct.get(productId);
    if (!item || quantity > item.issued_quantity - item.corrected_quantity) return res.status(400).json({ error: 'Nie można przywrócić większej ilości niż odjęto w tym zapotrzebowaniu.' });
  }
  db.exec('BEGIN');
  try {
    const restore = db.prepare('UPDATE products SET quantity=quantity+?, updated_at=CURRENT_TIMESTAMP WHERE id=?');
    const correction = db.prepare('UPDATE demand_items SET corrected_quantity=corrected_quantity+? WHERE demand_run_id=? AND product_id=?');
    const movement = db.prepare("INSERT INTO movements (product_id, type, quantity, note) VALUES (?, 'add', ?, ?)");
    for (const [productId, quantity] of requested) { restore.run(quantity, productId); correction.run(quantity, runId, productId); movement.run(productId, quantity, `Korekta zapotrzebowania #${runId}`); }
    db.exec('COMMIT'); res.json({ corrected: requested.size });
  } catch (error) { db.exec('ROLLBACK'); throw error; }
});
app.post('/api/demand/runs/:id/reverse', (req, res) => {
  const runId = Number(req.params.id);
  if (req.body?.password !== '123') return res.status(403).json({ error: 'Nieprawidłowe hasło zatwierdzające.' });
  const run = db.prepare('SELECT id FROM demand_runs WHERE id=?').get(runId);
  if (!run) return res.status(404).json({ error: 'Nie znaleziono tego zapotrzebowania.' });
  const items = getDemandItems(runId).map(item => ({ ...item, restore:item.issued_quantity-item.corrected_quantity })).filter(item => item.restore > 0);
  if (!items.length) return res.status(400).json({ error: 'To zapotrzebowanie zostało już w całości cofnięte.' });
  db.exec('BEGIN');
  try {
    const restore = db.prepare('UPDATE products SET quantity=quantity+?, updated_at=CURRENT_TIMESTAMP WHERE id=?');
    const correction = db.prepare('UPDATE demand_items SET corrected_quantity=COALESCE(issued_quantity, quantity) WHERE demand_run_id=? AND product_id=?');
    const movement = db.prepare("INSERT INTO movements (product_id, type, quantity, note) VALUES (?, 'add', ?, ?)");
    items.forEach(item => { restore.run(item.restore, item.product_id); correction.run(runId, item.product_id); movement.run(item.product_id, item.restore, `Cofnięcie zapotrzebowania #${runId}`); });
    db.prepare('UPDATE demand_runs SET reversed_at=CURRENT_TIMESTAMP WHERE id=?').run(runId);
    db.exec('COMMIT'); res.json({ reversed:items.length });
  } catch (error) { db.exec('ROLLBACK'); throw error; }
});

app.get('/api/products/:id/movements', (req, res) => {
  res.json(db.prepare('SELECT * FROM movements WHERE product_id = ? ORDER BY movement_date DESC, id DESC LIMIT 30').all(Number(req.params.id)));
});

app.get('/api/products/:id/image', (req, res) => {
  const product = productById(Number(req.params.id));
  if (!product) return res.status(404).json({ error: 'Nie znaleziono produktu.' });
  res.json({ image_data: product.image_data || null });
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
  const received = parseExpiration(req.body.received_date);
  if (!product || !Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Podaj prawidłową ilość partii.' });
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO product_batches (product_id, quantity, expiration_date, received_date) VALUES (?, ?, ?, ?)').run(product.id, quantity, expiration, received);
    db.prepare('UPDATE products SET quantity=quantity+?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(quantity, product.id);
    syncProductExpiryFromBatches(product.id);
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
