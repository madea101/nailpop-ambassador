import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const db = new Database(path.join(__dirname, "data", "ambassador.db"));

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  social_handle TEXT,
  platform TEXT,
  followers INTEGER,
  sku TEXT NOT NULL,
  address1 TEXT,
  address2 TEXT,
  city TEXT,
  province TEXT,
  zip TEXT,
  country TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0, -- required for Shopify Flow's "Send Marketing Email" action to fire
  status TEXT NOT NULL DEFAULT 'pending_contract', -- pending_contract, contract_sent, contract_signed, order_placed, cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  pandadoc_document_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft, sent, viewed, completed, declined
  signed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  shopify_order_id TEXT,
  shopify_order_name TEXT,
  sku TEXT NOT NULL,
  tracking_number TEXT,
  tracking_company TEXT,
  shipped_at TEXT,
  delivered_at TEXT,
  followup_count INTEGER NOT NULL DEFAULT 0,
  last_followup_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
