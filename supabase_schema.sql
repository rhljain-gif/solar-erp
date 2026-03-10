-- ============================================================
-- SOLAR INVERTER ERP — SUPABASE DATABASE SCHEMA
-- Run this entire file in: Supabase → SQL Editor → New Query
-- ============================================================

-- 1. CUSTOMERS
CREATE TABLE customers (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  gstin       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. PURCHASE ORDERS
CREATE TABLE purchase_orders (
  id            TEXT PRIMARY KEY,          -- e.g. PO-001
  customer_id   BIGINT REFERENCES customers(id),
  delivery_type TEXT NOT NULL CHECK (delivery_type IN ('DDP','EXW')),
  qty           INTEGER NOT NULL,
  unit_price    NUMERIC(12,2) NOT NULL,
  advance       NUMERIC(12,2) NOT NULL DEFAULT 0,
  po_date       DATE NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('Advance Pending','In Transit','Fulfilled')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CREDIT NOTES & FOC
CREATE TABLE credit_notes (
  id            TEXT PRIMARY KEY,          -- e.g. CN-001
  po_id         TEXT REFERENCES purchase_orders(id),
  customer_id   BIGINT REFERENCES customers(id),
  type          TEXT NOT NULL CHECK (type IN ('CNNote','FOC')),
  amount        NUMERIC(12,2) DEFAULT 0,   -- for CNNote
  foc_units     INTEGER DEFAULT 0,         -- for FOC
  cn_date       DATE NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Only authenticated users can read/write data
-- ============================================================

ALTER TABLE customers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_notes    ENABLE ROW LEVEL SECURITY;

-- Allow any authenticated user full access (both owner + accountant)
CREATE POLICY "Authenticated users: full access on customers"
  ON customers FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users: full access on purchase_orders"
  ON purchase_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users: full access on credit_notes"
  ON credit_notes FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- AUTO-INCREMENT PO and CN IDs (helper function)
-- ============================================================

CREATE OR REPLACE FUNCTION next_po_id()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  next_num INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM 4) AS INT)), 0) + 1
    INTO next_num FROM purchase_orders;
  RETURN 'PO-' || LPAD(next_num::TEXT, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION next_cn_id()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  next_num INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM 4) AS INT)), 0) + 1
    INTO next_num FROM credit_notes;
  RETURN 'CN-' || LPAD(next_num::TEXT, 3, '0');
END;
$$;
