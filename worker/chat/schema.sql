-- Analytics storage (Cloudflare D1 / SQLite). Safe to run repeatedly.
-- No IP addresses, no names, no cookies. `uid` is a one-way hash that changes every day.

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,           -- random id made by the visitor's browser tab (not stored on the device)
  ts INTEGER NOT NULL,            -- session start (ms since epoch)
  last_ts INTEGER NOT NULL,       -- last activity
  uid TEXT NOT NULL,              -- daily anonymous visitor hash
  landing TEXT, exit_path TEXT,   -- first and last page
  ref_host TEXT, ref_url TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT,
  channel TEXT,                   -- Direct / Search / Social / Email / Referral / Shared link / Campaign
  country TEXT, region TEXT, city TEXT, tz TEXT,
  device TEXT, os TEXT, browser TEXT, lang TEXT, screen TEXT,
  pages INTEGER NOT NULL DEFAULT 0,
  events INTEGER NOT NULL DEFAULT 0,
  interact INTEGER NOT NULL DEFAULT 0,   -- clicks, video, shares, form and chat activity
  active_s REAL NOT NULL DEFAULT 0       -- seconds the page was actually visible
);
CREATE INDEX IF NOT EXISTS idx_sessions_ts ON sessions(ts);
CREATE INDEX IF NOT EXISTS idx_sessions_last ON sessions(last_ts);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sid TEXT NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,             -- pageview pageend scroll project dwell click video share form chat error vital
  name TEXT,
  value REAL,
  path TEXT,
  proj TEXT,                      -- project id when the event is about one project
  extra TEXT                      -- small JSON
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, ts);
CREATE INDEX IF NOT EXISTS idx_events_sid ON events(sid, ts);
CREATE INDEX IF NOT EXISTS idx_events_proj ON events(proj, type);
