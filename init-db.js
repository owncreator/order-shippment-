require("dotenv").config();
const { pool } = require("./db");

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin','staff')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      order_number VARCHAR(40) NOT NULL UNIQUE,
      tracking_number VARCHAR(64) NOT NULL UNIQUE,
      customer_id BIGINT NOT NULL REFERENCES users(id),
      customer_name VARCHAR(120) NOT NULL,
      customer_email VARCHAR(254) NOT NULL,
      item_summary VARCHAR(240) NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
      currency CHAR(3) NOT NULL DEFAULT 'INR',
      status VARCHAR(32) NOT NULL DEFAULT 'order_placed'
        CHECK (status IN ('order_placed','confirmed','packed','shipped','in_transit','out_for_delivery','delivered','exception','cancelled','returned')),
      carrier VARCHAR(80),
      carrier_tracking_id VARCHAR(120),
      estimated_delivery DATE,
      destination_encrypted TEXT,
      notes_encrypted TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tracking_events (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status VARCHAR(32) NOT NULL,
      title VARCHAR(120) NOT NULL,
      description VARCHAR(500) NOT NULL DEFAULT '',
      location VARCHAR(160),
      source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','courier','system')),
      event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by BIGINT REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_tracking ON orders(tracking_number);
    CREATE INDEX IF NOT EXISTS idx_events_order_time ON tracking_events(order_id, event_time DESC);
  `);
  console.log("Database tables are ready.");
  await pool.end();
}
main().catch(async e => { console.error(e); await pool.end(); process.exit(1); });
