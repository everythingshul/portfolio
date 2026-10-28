-- Customers (CRM), invoices, quotes and payments. Cloudflare D1, binding BILL.
-- Safe to run more than once. Money is stored as integer cents.

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  org TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  addr1 TEXT NOT NULL DEFAULT '',
  addr2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',      -- lead | active | past
  source TEXT NOT NULL DEFAULT '',            -- chat, contact form, wix import, manual...
  tags TEXT NOT NULL DEFAULT '',              -- comma separated
  notes TEXT NOT NULL DEFAULT '',
  tax_exempt INTEGER NOT NULL DEFAULT 0,
  terms_days INTEGER,                         -- payment terms for this customer (null = default)
  stripe_customer TEXT NOT NULL DEFAULT '',
  ext_id TEXT NOT NULL DEFAULT '',            -- id in the system it was imported from
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cust_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_cust_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_cust_status ON customers(status);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  unit_cents INTEGER NOT NULL DEFAULT 0,
  taxable INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'invoice',       -- invoice | quote
  number TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',       -- draft | sent | paid | void | accepted | declined
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL DEFAULT '',          -- for quotes: valid until
  currency TEXT NOT NULL DEFAULT 'usd',
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL DEFAULT 'amt',  -- amt (cents) | pct
  discount_value REAL NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,           -- percent
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',             -- heading above the items, e.g. "Mass Text"
  notes TEXT NOT NULL DEFAULT '',             -- shown to the customer
  terms TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL,                        -- secret in the public link
  sent_at INTEGER,
  viewed_at INTEGER,
  paid_at INTEGER,
  last_reminder_at INTEGER,
  reminders INTEGER NOT NULL DEFAULT 0,
  auto_remind INTEGER NOT NULL DEFAULT 1,
  online_pay INTEGER NOT NULL DEFAULT 1,      -- 0 = the customer can not pay this one online
  recurring_id TEXT NOT NULL DEFAULT '',
  converted_from TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_token ON invoices(token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_number ON invoices(kind, number);
CREATE INDEX IF NOT EXISTS idx_inv_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_inv_status ON invoices(kind, status, due_date);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id TEXT NOT NULL,
  pos INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_cents INTEGER NOT NULL DEFAULT 0,
  taxable INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lines_inv ON invoice_lines(invoice_id, pos);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,              -- negative = refund
  method TEXT NOT NULL DEFAULT 'other',       -- stripe | stripe_refund | check | cash | ach | zelle | other | imported
  ref TEXT NOT NULL DEFAULT '',
  stripe_ref TEXT,                            -- makes webhook retries harmless
  received_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_stripe ON payments(stripe_ref);
CREATE INDEX IF NOT EXISTS idx_pay_inv ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pay_cust ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_pay_time ON payments(received_at);

CREATE TABLE IF NOT EXISTS recurring (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL DEFAULT 'monthly',  -- weekly | monthly | quarterly | yearly
  next_date TEXT NOT NULL,
  end_date TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  auto_send INTEGER NOT NULL DEFAULT 1,
  lines TEXT NOT NULL DEFAULT '[]',           -- JSON [{description, qty, unit_cents, taxable}]
  discount_type TEXT NOT NULL DEFAULT 'amt',
  discount_value REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  terms_days INTEGER NOT NULL DEFAULT 30,
  last_run TEXT NOT NULL DEFAULT '',
  runs INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL DEFAULT '',
  invoice_id TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,                         -- note | email | invoice | payment | quote | lead | chat | system
  text TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_cust ON activity(customer_id, ts);
CREATE INDEX IF NOT EXISTS idx_act_inv ON activity(invoice_id, ts);
CREATE INDEX IF NOT EXISTS idx_act_ts ON activity(ts);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  due TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  done_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_cust ON tasks(customer_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(done, due);

CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
