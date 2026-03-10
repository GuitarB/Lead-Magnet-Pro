CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(stripe_customer_id) REFERENCES customers(stripe_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer_plan
  ON subscriptions (stripe_customer_id, plan, updated_at DESC);

CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_customer_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  generation_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(stripe_customer_id, period_key),
  FOREIGN KEY(stripe_customer_id) REFERENCES customers(stripe_customer_id)
);

CREATE TABLE IF NOT EXISTS generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL,
  brand_url TEXT,
  audience TEXT,
  goal TEXT,
  magnet_type TEXT,
  generated_html TEXT NOT NULL,
  pdf_key TEXT,
  pdf_created_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(stripe_customer_id) REFERENCES customers(stripe_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_generations_customer_created
  ON generations (stripe_customer_id, created_at DESC);

