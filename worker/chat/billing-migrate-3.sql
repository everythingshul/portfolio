-- The business ledger (all money in and out) and Gmail-style labels. Safe to run more than once.
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,                         -- YYYY-MM-DD in the business time zone
  direction TEXT NOT NULL,                    -- in | out
  amount_cents INTEGER NOT NULL,
  vendor TEXT NOT NULL DEFAULT '',            -- who was paid, or who paid you
  invoice_ref TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  paid_with TEXT NOT NULL DEFAULT '',
  account TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  maaser_cents INTEGER NOT NULL DEFAULT 0,    -- ten percent of money in
  maaser_given INTEGER NOT NULL DEFAULT 0,
  maaser_given_at INTEGER,
  maaser_of INTEGER,                          -- set on the charity expense made when maaser is marked given
  src TEXT,                                   -- 'payment' for rows that mirror the payments table
  src_id TEXT,
  invoice_id TEXT,
  customer_id TEXT,
  file_name TEXT,
  file_type TEXT,
  has_file INTEGER NOT NULL DEFAULT 0,        -- the file itself is kept in KV under ledger:file:<id>
  created_by TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_src ON ledger(src, src_id) WHERE src IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger(date);
CREATE INDEX IF NOT EXISTS idx_ledger_maaser_of ON ledger(maaser_of);

CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#e7e7e7',
  parent_id INTEGER,
  sort INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS label_links (
  label_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  PRIMARY KEY (label_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_label_links_entity ON label_links(entity_type, entity_id);
