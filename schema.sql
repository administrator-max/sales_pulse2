-- =================================================================
-- 1. CORE TABLES
-- Schema is idempotent: aman dijalankan ulang.
-- =================================================================

CREATE TABLE IF NOT EXISTS monthly_actuals (
    month_idx INT NOT NULL,
    year      INT NOT NULL DEFAULT 2026,
    actual_margin NUMERIC(15,3),
    plan_margin   NUMERIC(15,3),
    revenue       NUMERIC(15,3),
    notes TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plan_revisions (
    id        SERIAL PRIMARY KEY,
    month_idx INT NOT NULL,
    year      INT NOT NULL DEFAULT 2026,
    name    VARCHAR(255),
    margin  NUMERIC(15,3),
    revenue NUMERIC(15,3),
    notes   TEXT,
    qty JSONB,
    ts  VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Migrasi schema lama
ALTER TABLE monthly_actuals ADD COLUMN IF NOT EXISTS year INT NOT NULL DEFAULT 2026;
ALTER TABLE plan_revisions  ADD COLUMN IF NOT EXISTS year INT NOT NULL DEFAULT 2026;

-- Composite PK (month_idx, year)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'monthly_actuals'::regclass AND contype = 'p'
      AND pg_get_constraintdef(oid) NOT LIKE '%(month_idx, year)%'
  ) THEN
    ALTER TABLE monthly_actuals DROP CONSTRAINT IF EXISTS monthly_actuals_pkey;
    ALTER TABLE monthly_actuals ADD PRIMARY KEY (month_idx, year);
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'monthly_actuals'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE monthly_actuals ADD PRIMARY KEY (month_idx, year);
  END IF;
END $$;

-- Drop tabel lama: monthly_budgets digantikan oleh budget_lines (granular per produk)
DROP TABLE IF EXISTS monthly_budgets CASCADE;


-- =================================================================
-- 2. PRODUCT MASTER & ALIAS
-- products       = canonical product list (untuk ranking & detail filter)
-- product_aliases = "what user types" → "what we store"
--                   contoh: 'GI ATL' → 'Galvanized', 'Pipe' → 'ERW Pipe'
-- =================================================================

CREATE TABLE IF NOT EXISTS products (
    canonical_name  VARCHAR(100) PRIMARY KEY,
    macro_category  VARCHAR(50),     -- bucket display (sheetPile/erwPipe/gl/gi/ppgl/weldedPipe/other)
    display_order   INT DEFAULT 100
);

CREATE TABLE IF NOT EXISTS product_aliases (
    alias           VARCHAR(100) PRIMARY KEY,
    canonical_name  VARCHAR(100) NOT NULL REFERENCES products(canonical_name) ON UPDATE CASCADE
);

-- Seed canonical products (24 dari Product Mapping screenshot)
INSERT INTO products (canonical_name, macro_category, display_order) VALUES
('Angle',           'other',      10),
('As Steel',        'other',      11),
('Bar',             'other',      12),
('Beam',            'other',      13),
('Billet',          'other',      14),
('Channel',         'other',      15),
('Chequered Plate', 'other',      16),
('ERW Pipe',        'erwPipe',    20),
('Galvalume',       'gl',         30),
('Galvanized',      'gi',         31),
('HBI',             'other',      40),
('Hollow',          'other',      41),
('HRC',             'other',      42),
('HRPO',            'other',      43),
('Plate',           'other',      44),
('PPGL',            'ppgl',       50),
('Projects',        'projects',   60),
('Scrap',           'other',      70),
('Seamless Pipe',   'weldedPipe', 80),
('Sheet Pile',      'sheetPile',  90),
('Slab',            'other',     100),
('Wear Plate',      'other',     110),
('Wiremesh',        'other',     120),
('Pipe',            'erwPipe',   200)  -- legacy, beberapa input excel pakai "Pipe" → idealnya jadi alias
ON CONFLICT (canonical_name) DO UPDATE SET
  macro_category = EXCLUDED.macro_category,
  display_order  = EXCLUDED.display_order;

-- Seed mapping aliases (dari Product Mapping.xlsx) + material-code patterns
-- Self-mapping (alias = canonical) supaya semua input langsung match.
-- Material-code aliases (SNI 2013, GI-Z, dst) untuk hasil retag akurat
-- pas project_name tidak mengandung kata canonical (e.g., "Youfa 7" → SNI 2013 pipe).
INSERT INTO product_aliases (alias, canonical_name) VALUES
-- 1) Canonical self-map (Product Mapping.xlsx)
('Angle',                  'Angle'),
('As Steel',               'As Steel'),
('Bar',                    'Bar'),
('Beam',                   'Beam'),
('Billet',                 'Billet'),
('Channel',                'Channel'),
('Chequered Plate',        'Chequered Plate'),
('ERW Pipe',               'ERW Pipe'),
('Galvalume',              'Galvalume'),
('Galvanized',             'Galvanized'),
('GI ATL',                 'Galvanized'),
('GI HWN',                 'Galvanized'),
('GL',                     'Galvalume'),
('HBI',                    'HBI'),
('Hollow',                 'Hollow'),
('HRC',                    'HRC'),
('HRPO',                   'HRPO'),
('Pipe',                   'ERW Pipe'),
('Plate',                  'Plate'),
('PPGL',                   'PPGL'),
('Projects',               'Projects'),
('S Pipe',                 'Seamless Pipe'),
('Scrap',                  'Scrap'),
('Seamless Pipe',          'Seamless Pipe'),
('Sheet Pile',             'Sheet Pile'),
('Slab',                   'Slab'),
('Wear Plate',             'Wear Plate'),
('Wear Plate - Local',     'Wear Plate'),
('Wear Plate - Project',   'Wear Plate'),
('Wiremesh',               'Wiremesh'),

-- 2) Material-code patterns (longest-first → match presisi sebelum fallback)
-- Hanya pattern yang UNIK ke 1 produk supaya tidak ambigu.
('SNI 2013',               'ERW Pipe'),       -- Indonesian welded pipe standard
('SMLS-A53',               'Seamless Pipe'),  -- ATL-SMLS-A53/A106/API-5L
('SMLS',                   'Seamless Pipe'),
('Seamless',               'Seamless Pipe'),
('IWF-JIS',                'Beam'),           -- I Wide Flange beam
('IWF',                    'Beam'),
('WF Beam',                'Beam'),
('GI-Z',                   'Galvanized'),     -- GI-Z40 G550 dll
('RM-AS-SCM',              'As Steel'),       -- RM-AS-SCM440
('FG-AS',                  'As Steel'),
('AS-SCM',                 'As Steel'),
('A5528',                  'Sheet Pile'),     -- JIS spec sheet pile (safety net)
('SCM440',                 'As Steel')
ON CONFLICT (alias) DO UPDATE SET canonical_name = EXCLUDED.canonical_name;


-- =================================================================
-- 3. BUDGET LINES (granular: year × month × segment × product)
-- Ganti `monthly_budgets` lama. Aggregate per bulan dihitung di server
-- via SUM ... GROUP BY year, month_idx.
-- =================================================================

CREATE TABLE IF NOT EXISTS budget_lines (
    id           SERIAL PRIMARY KEY,
    year         INT NOT NULL,
    month_idx    INT NOT NULL,                 -- 0-11
    segment      VARCHAR(50)  NOT NULL,        -- Long, Flat, Coated, Projects, Raw Material, Semi-Finished
    product      VARCHAR(100) NOT NULL,        -- canonical product (FK ke products.canonical_name)
    volume_mt    NUMERIC(15,3) DEFAULT 0,
    revenue_idr  NUMERIC(20,2) DEFAULT 0,      -- raw IDR (bukan MIDR)
    margin_idr   NUMERIC(20,2) DEFAULT 0,      -- raw IDR
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (year, month_idx, segment, product)
);


-- =================================================================
-- 4. PROJECT SHEET (PS) — actuals per project
-- =================================================================

CREATE TABLE IF NOT EXISTS ps_headers (
    ps_number VARCHAR(100) PRIMARY KEY,
    dashboard_month_idx INT,
    dashboard_year      INT NOT NULL DEFAULT 2026,
    project_code   VARCHAR(50),
    project_name   VARCHAR(255),
    subsidiary     VARCHAR(255),
    customer_name  VARCHAR(255),
    supplier_name  VARCHAR(255),
    po_date        DATE,
    currency       VARCHAR(10),
    fx_rate            NUMERIC(20,6) DEFAULT 1,
    net_margin_native  NUMERIC(20,2),
    sales_revenue  NUMERIC(20,2),
    purchase_cost  NUMERIC(20,2),
    margin             NUMERIC(20,2),
    margin_percentage  NUMERIC(8,4),
    -- product/segment ditarik dari material/project name saat upload
    product   VARCHAR(100),       -- canonical, untuk akurat ranking & filter
    segment   VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Migrasi schema lama
ALTER TABLE ps_headers ADD COLUMN IF NOT EXISTS dashboard_year     INT NOT NULL DEFAULT 2026;
ALTER TABLE ps_headers ADD COLUMN IF NOT EXISTS fx_rate            NUMERIC(20,6) DEFAULT 1;
ALTER TABLE ps_headers ADD COLUMN IF NOT EXISTS net_margin_native  NUMERIC(20,2);
ALTER TABLE ps_headers ADD COLUMN IF NOT EXISTS product            VARCHAR(100);
ALTER TABLE ps_headers ADD COLUMN IF NOT EXISTS segment            VARCHAR(50);

CREATE TABLE IF NOT EXISTS ps_items (
    id SERIAL PRIMARY KEY,
    ps_number VARCHAR(100) REFERENCES ps_headers(ps_number) ON DELETE CASCADE,
    item_no INT,
    material VARCHAR(255),
    size     VARCHAR(255),
    length   VARCHAR(100),
    qty_val  NUMERIC(15,2),
    qty_unit VARCHAR(50),
    total_weight_kg   NUMERIC(15,2),
    purchase_price_kg NUMERIC(20,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- =================================================================
-- 5. INDEXES
-- =================================================================
CREATE INDEX IF NOT EXISTS idx_actuals_year_month        ON monthly_actuals  (year, month_idx);
CREATE INDEX IF NOT EXISTS idx_plan_revisions_year       ON plan_revisions   (year, month_idx);
CREATE INDEX IF NOT EXISTS idx_plan_revisions_month      ON plan_revisions   (month_idx);
CREATE INDEX IF NOT EXISTS idx_budget_lines_year_month   ON budget_lines     (year, month_idx);
CREATE INDEX IF NOT EXISTS idx_budget_lines_product      ON budget_lines     (product);
CREATE INDEX IF NOT EXISTS idx_budget_lines_segment      ON budget_lines     (segment);
CREATE INDEX IF NOT EXISTS idx_ps_headers_year           ON ps_headers       (dashboard_year, dashboard_month_idx);
CREATE INDEX IF NOT EXISTS idx_ps_headers_month          ON ps_headers       (dashboard_month_idx);
CREATE INDEX IF NOT EXISTS idx_ps_headers_product        ON ps_headers       (product);
CREATE INDEX IF NOT EXISTS idx_ps_items_ps_number        ON ps_items         (ps_number);


-- =================================================================
-- 6. SEED FROM PRODUCTION EXPORT
-- Catatan: monthly_budgets seed lama dihapus.
-- Budget data akan di-import via UI (Import Budget Excel).
-- =================================================================

-- monthly_actuals (12 rows)
-- =================================================================
-- 7. AUTO-RETAG ps_headers (one-shot migration, idempotent)
-- Match canonical product dari project_name + material/size di ps_items.
-- Longest-alias-first untuk hindari false positive (e.g. 'Pipe' tidak override 'ERW Pipe').
-- Hanya update baris yang product-nya masih NULL.
-- Dijalankan SETELAH seed ps_headers + ps_items (di bawah).
-- =================================================================

-- (block ini di-run di akhir file — lihat bagian paling bawah)

-- monthly_actuals (12 rows) — back to seed
INSERT INTO monthly_actuals (month_idx, year, actual_margin, plan_margin, revenue, notes) VALUES (0, 2026, '5987.020', NULL, '56488.733', '') ON CONFLICT (month_idx, year) DO UPDATE SET actual_margin=EXCLUDED.actual_margin, plan_margin=EXCLUDED.plan_margin, revenue=EXCLUDED.revenue, notes=EXCLUDED.notes;
INSERT INTO monthly_actuals (month_idx, year, actual_margin, plan_margin, revenue, notes) VALUES (1, 2026, '3300.817', NULL, '23327.698', '') ON CONFLICT (month_idx, year) DO UPDATE SET actual_margin=EXCLUDED.actual_margin, plan_margin=EXCLUDED.plan_margin, revenue=EXCLUDED.revenue, notes=EXCLUDED.notes;
INSERT INTO monthly_actuals (month_idx, year, actual_margin, plan_margin, revenue, notes) VALUES (2, 2026, '2162.660', NULL, '38320.385', 'Seamless Pipe: wating for PS | Kewei 67: Preparing PS') ON CONFLICT (month_idx, year) DO UPDATE SET actual_margin=EXCLUDED.actual_margin, plan_margin=EXCLUDED.plan_margin, revenue=EXCLUDED.revenue, notes=EXCLUDED.notes;
INSERT INTO monthly_actuals (month_idx, year, actual_margin, plan_margin, revenue, notes) VALUES (3, 2026, '259.441', NULL, '5946.954', '') ON CONFLICT (month_idx, year) DO UPDATE SET actual_margin=EXCLUDED.actual_margin, plan_margin=EXCLUDED.plan_margin, revenue=EXCLUDED.revenue, notes=EXCLUDED.notes;
INSERT INTO monthly_actuals (month_idx, year, actual_margin, plan_margin, revenue, notes) VALUES (4, 2026, NULL, NULL, NULL, '') ON CONFLICT (month_idx, year) DO UPDATE SET actual_margin=EXCLUDED.actual_margin, plan_margin=EXCLUDED.plan_margin, revenue=EXCLUDED.revenue, notes=EXCLUDED.notes;
INSERT INTO monthly_actuals (month_idx, year, actual_margin, plan_margin, revenue, notes) VALUES (5, 2026, NULL, NULL, NULL, '') ON CONFLICT (month_idx, year) DO UPDATE SET actual_margin=EXCLUDED.actual_margin, plan_margin=EXCLUDED.plan_margin, revenue=EXCLUDED.revenue, notes=EXCLUDED.notes;
INSERT INTO monthly_actuals (month_idx, year, actual_margin, plan_margin, revenue, notes) VALUES (6, 2026, NULL, NULL, NULL, '') ON CONFLICT (month_idx, year) DO UPDATE SET actual_margin=EXCLUDED.actual_margin, plan_margin=EXCLUDED.plan_margin, revenue=EXCLUDED.revenue, notes=EXCLUDED.notes;
INSERT INTO monthly_actuals (month_idx, year, actual_margin, plan_margin, revenue, notes) VALUES (7, 2026, NULL, NULL, NULL, '') ON CONFLICT (month_idx, year) DO UPDATE SET actual_margin=EXCLUDED.actual_margin, plan_margin=EXCLUDED.plan_margin, revenue=EXCLUDED.revenue, notes=EXCLUDED.notes;
INSERT INTO monthly_actuals (month_idx, year, actual_margin, plan_margin, revenue, notes) VALUES (8, 2026, NULL, NULL, NULL, '') ON CONFLICT (month_idx, year) DO UPDATE SET actual_margin=EXCLUDED.actual_margin, plan_margin=EXCLUDED.plan_margin, revenue=EXCLUDED.revenue, notes=EXCLUDED.notes;
INSERT INTO monthly_actuals (month_idx, year, actual_margin, plan_margin, revenue, notes) VALUES (9, 2026, NULL, NULL, NULL, '') ON CONFLICT (month_idx, year) DO UPDATE SET actual_margin=EXCLUDED.actual_margin, plan_margin=EXCLUDED.plan_margin, revenue=EXCLUDED.revenue, notes=EXCLUDED.notes;
INSERT INTO monthly_actuals (month_idx, year, actual_margin, plan_margin, revenue, notes) VALUES (10, 2026, NULL, NULL, NULL, '') ON CONFLICT (month_idx, year) DO UPDATE SET actual_margin=EXCLUDED.actual_margin, plan_margin=EXCLUDED.plan_margin, revenue=EXCLUDED.revenue, notes=EXCLUDED.notes;
INSERT INTO monthly_actuals (month_idx, year, actual_margin, plan_margin, revenue, notes) VALUES (11, 2026, NULL, NULL, NULL, '') ON CONFLICT (month_idx, year) DO UPDATE SET actual_margin=EXCLUDED.actual_margin, plan_margin=EXCLUDED.plan_margin, revenue=EXCLUDED.revenue, notes=EXCLUDED.notes;
-- plan_revisions (0 rows)
-- (kosong)

-- ps_headers (22 rows)
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('ATL-000003 · GKL-000001', 0, 2026, NULL, 'Youfa 7', NULL, 'PT. Wingman Steel Indonesia', NULL, NULL, NULL, '1.0000', NULL, '2535101000.00', NULL, '207133000.00', '8.1700', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('ATL-000004 · EMS-000001', 0, 2026, NULL, 'Mlion 09A', NULL, 'PT. Mlion Intl Indonesia', NULL, NULL, NULL, '1.0000', NULL, '22388688000.00', NULL, '2436115000.00', '10.8800', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('ATL-000005 · SGD-000001', 0, 2026, NULL, 'Mlion 09B', NULL, 'PT. Mlion Intl Indonesia', NULL, NULL, NULL, '1.0000', NULL, '21105504000.00', NULL, '2296507000.00', '10.8800', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('ATL-000006 · AMP-000001 · GIS-000001', 0, 2026, NULL, 'SSSC 12A', NULL, 'PT. Kapuk Molek', NULL, NULL, NULL, '1.0000', NULL, '6972960000.00', NULL, '702054000.00', '10.0700', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('ATL-000007 · BHG-000001 · GIS-000002', 0, 2026, NULL, 'SSSC 12B', NULL, 'PT. Kapuk Molek', NULL, NULL, NULL, '1.0000', NULL, '3486480000.00', NULL, '345211000.00', '9.9000', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('ATL-000009 · GKL-000002', 1, 2026, NULL, 'Youfa 8', NULL, 'PT. Welon Engineering', NULL, NULL, NULL, '1.0000', NULL, '716353000.00', NULL, '51389000.00', '7.1700', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('ATL-000010_R1 · GKL-000003_R1', 1, 2026, NULL, 'Youfa 9 R1', NULL, 'PT. Sapta Sumber Lancar', NULL, NULL, NULL, '1.0000', NULL, '4070805000.00', NULL, '320846000.00', '7.8800', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('PSD26-BTS-000001 + PSD26-SGD-000003', 1, 2026, NULL, 'Mlion 10B', NULL, 'PT. Mlion Intl Indonesia', NULL, NULL, NULL, '1.0000', NULL, '12457943000.00', NULL, '1967837000.00', '15.8000', 'Consolidated Net Margin: BTS Net (1,656.388M) + SGD Net (311.449M). Purchase=BTS←Hanwa, Sales=SGD→Mlion, eliminasi interco BTS↔SGD') ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('PSD26-SGD-000002', 1, 2026, NULL, 'Mlion 10A', NULL, 'PT. Mlion Intl Indonesia', NULL, NULL, NULL, '1.0000', NULL, '6082597000.00', NULL, '960745000.00', '15.7900', 'Net Margin after Port Charges, Trucking, KSO, Insurance, Finance (Total Cost: 359.853M)') ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('PSF26-ATL-000012', 2, 2026, '4319', 'Arsen SP#46 - Del. April 2026 - Hanwa Indonesia', 'GROUP : Amber Tradelink', 'Bintang Tunggal Sukses', 'TOP (HK) COMMODITIES INTERNATIONAL LIMITED', NULL, 'IDR', '17000.0000', '15300.00', '3519000000.00', '191700.00', '260100000.00', '7.3900', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('PSF26-ATL-000016', 2, 2026, '4334', 'Arsen SSP#48A - Del. May 2026 - Sapta Sumber Lancar', 'GROUP : Amber Tradelink', 'PT. Bintang Tunggal Sukses', 'TOP (HK) COMMODITIES INTERNATIONAL LIMITED', NULL, 'IDR', '17000.0000', '5125.00', '2605080000.00', '148115.00', '87125000.00', '3.3400', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('PSF26-ATL-000017', 2, 2026, '4333', 'Arsen SSP#48B - Del. May 2026 - KEM', 'GROUP : Amber Tradelink', 'PT. Bintang Tunggal Sukses', 'TOP (HK) COMMODITIES INTERNATIONAL LIMITED', NULL, 'IDR', '17000.0000', '7375.00', '3829930000.00', '217915.00', '125375000.00', '3.2700', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('PSF26-BTS-000002', 2, 2026, '4314', 'Arsen AS#46 - Del. June 2026 - LMI', 'GROUP : GP : PT. BINTANG TUNGGAL SUKSES', 'PT. Lautan Metal Indonesia', 'Arsen International (HK) Limited', NULL, NULL, '1.0000', NULL, '2701875000.00', '2454651000.00', '105364723.00', '3.9000', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('PSF26-BTS-000003', 2, 2026, '4316', 'Arsen SP#46 - Del. April 2026 - Hanwa Indonesia', 'GROUP : GP : PT. BINTANG TUNGGAL SUKSES', 'PT. Hanwa Indonesia', 'Amber Tradelink Pte Ltd', NULL, 'IDR', '1.0000', '136769701.00', '3912500000.00', '3555225000.00', '136769701.00', '3.5000', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('PSF26-BTS-000006', 2, 2026, '4322', 'Arsen SSP#48A - Del. May 2026 - Sapta', 'GROUP : GP : PT. BINTANG TUNGGAL SUKSES', 'PT. Sapta Sumber Lancar', 'Amber Tradelink Pte Ltd', NULL, 'IDR', '1.0000', '182535708.00', '2972000000.00', '2644922400.00', '182535708.00', '6.1400', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('PSF26-BTS-000007', 2, 2026, '4323', 'Arsen SSP#48B - Del. April 2026 - KEM', 'GROUP : GP : PT. BINTANG TUNGGAL SUKSES', 'PT. Karyawaja Ekamulia', 'Amber Tradelink Pte Ltd', NULL, 'IDR', '1.0000', '252330787.00', '4366375000.00', '3888505400.00', '252330787.00', '5.7800', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('PSF26-GKL-000005', 2, 2026, '4341', 'Kewei 67C - Del. May 2026 - BJP', 'GROUP : GP : PT. GANTARI KARA LOKA', 'PT. Bukit Jaya Perkasa', 'Amber Tradelink Pte Ltd', NULL, 'IDR', '1.0000', '31789293.00', '1266644000.00', '1157844400.00', '31789293.00', '2.5100', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('PSF26-JKT-000001', 2, 2026, '4342', 'Kewei 67D - Del. May 2026 - BJP', 'GROUP : GP : PT. JAYA KITA TERDEPAN', 'PT. Bukit Jaya Perkasa', 'Amber Tradelink Pte Ltd', NULL, 'IDR', '1.0000', '25835605.00', '1020404800.00', '931822080.00', '25835605.00', '2.5300', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('PSF26-LSJ-000001', 2, 2026, '4313', 'Arsen 55 - Del. May 2026 - BJM', 'GROUP : GP : PT. LANGIT SAMUDRA JAYA', 'PT. Berkat Jaya Mandiri', 'Hanwa Singapore (PTE) LTD', NULL, NULL, '1.0000', NULL, '7065317000.00', '5846435000.00', '826331311.00', '11.7000', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('PSF26-NCT-000001', 2, 2026, '4339', 'Kewei 67B - Del. May 2026 - BJP', 'GROUP : GP : PT. NIAGA CAHAYA TUNGGAL', 'PT. Bukit Jaya Perkasa', 'Amber Tradelink Pte Ltd', NULL, 'IDR', '1.0000', '47853705.00', '1899966000.00', '1739366550.00', '47853705.00', '2.5200', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('PSF26-SPA-000004', 3, 2026, '4343', 'Hanwa 02 - Del. April 2026 - Artha Mas Graha Phase 1', 'GROUP : GP : PT. SELARAS PRIMA ANGKASA', 'PT. Artha Mas Graha Andalan', 'PT. Hanwa Indonesia', NULL, 'IDR', '1.0000', '259440852.00', '5946953978.00', '5664719750.00', '259440852.00', '4.3600', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;
INSERT INTO ps_headers (ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, notes) VALUES ('PSF26-SPP-000001', 2, 2026, '4336', 'Kewei 67A - Del. May 2026 - BJP', 'GROUP : GP : PT. SURYA PURNAMA PELITA', 'PT. Bukit Jaya Perkasa', 'Amber Tradelink Pte Ltd', NULL, 'IDR', '1.0000', '81249505.00', '3161293000.00', '2893744350.00', '81249505.00', '2.5700', NULL) ON CONFLICT (ps_number) DO UPDATE SET dashboard_month_idx=EXCLUDED.dashboard_month_idx, dashboard_year=EXCLUDED.dashboard_year, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, subsidiary=EXCLUDED.subsidiary, customer_name=EXCLUDED.customer_name, supplier_name=EXCLUDED.supplier_name, po_date=EXCLUDED.po_date, currency=EXCLUDED.currency, fx_rate=EXCLUDED.fx_rate, net_margin_native=EXCLUDED.net_margin_native, sales_revenue=EXCLUDED.sales_revenue, purchase_cost=EXCLUDED.purchase_cost, margin=EXCLUDED.margin, margin_percentage=EXCLUDED.margin_percentage, notes=EXCLUDED.notes;

-- ps_items (162 rows)
-- Bersihkan items lama dulu untuk PS yang sudah ada di export, lalu insert ulang.
DELETE FROM ps_items WHERE ps_number IN ('ATL-000006 · AMP-000001 · GIS-000001', 'ATL-000007 · BHG-000001 · GIS-000002', 'ATL-000003 · GKL-000001', 'ATL-000004 · EMS-000001', 'ATL-000005 · SGD-000001', 'ATL-000009 · GKL-000002', 'ATL-000010_R1 · GKL-000003_R1', 'PSD26-SGD-000002', 'PSD26-BTS-000001 + PSD26-SGD-000003', 'PSF26-LSJ-000001', 'PSF26-BTS-000002', 'PSF26-ATL-000012', 'PSF26-BTS-000003', 'PSF26-JKT-000001', 'PSF26-GKL-000005', 'PSF26-NCT-000001', 'PSF26-SPP-000001', 'PSF26-ATL-000017', 'PSF26-ATL-000016', 'PSF26-BTS-000007', 'PSF26-BTS-000006', 'PSF26-SPA-000004');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000006 · AMP-000001 · GIS-000001', NULL, 'PPGL AZ100 G300 BMT 0.30×1219×COIL', NULL, NULL, '1.00', 'coil', '400000.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000007 · BHG-000001 · GIS-000002', NULL, 'PPGL AZ100 G300 BMT 0.30×1200×COIL', NULL, NULL, '1.00', 'coil', '160000.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000007 · BHG-000001 · GIS-000002', NULL, 'PPGL AZ100 G300 BMT 0.30×1219×COIL', NULL, NULL, '1.00', 'coil', '40000.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '3" SNI 2013 (89×3.75×6000)', NULL, NULL, '157.00', 'pcs', '7575.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '2" SNI 2013 (60.3×3.5×6000)', NULL, NULL, '77.00', 'pcs', '2310.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '4" SNI 2013 (114.3×3.75×6000)', NULL, NULL, '97.00', 'pcs', '6069.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '5" SNI 2013 (139.7×3.75×6000)', NULL, NULL, '30.00', 'pcs', '2309.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '6" SNI 2013 (165.1×4.25×6000)', NULL, NULL, '157.00', 'pcs', '16199.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '1½" SNI 2013 (48.3×3.25×6000)', NULL, NULL, '100.00', 'pcs', '2210.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '½" SNI 2013 (26.9×2.75×6000)', NULL, NULL, '25.00', 'pcs', '251.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '1" SNI 2013 (33.7×3×6000)', NULL, NULL, '40.00', 'pcs', '556.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '1" SNI 2013 (33.7×2.75×6000)', NULL, NULL, '1714.00', 'pcs', '22025.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '1¼" SNI 2013 (42.4×2.75×6000)', NULL, NULL, '2442.00', 'pcs', '40195.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '2" SNI 2013 (60.3×2.75×6000)', NULL, NULL, '957.00', 'pcs', '22863.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '1" SNI 2013 (33.7×3.2×6000)', NULL, NULL, '91.00', 'pcs', '1340.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '1¼" SNI 2013 (42.4×3.5×6000)', NULL, NULL, '61.00', 'pcs', '1254.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '2" SNI 2013 (60.3×3.75×6000)', NULL, NULL, '37.00', 'pcs', '1184.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '2½" SNI 2013 (76×3×6000)', NULL, NULL, '241.00', 'pcs', '7965.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '3" SNI 2013 (88.9×3.25×6000)', NULL, NULL, '49.00', 'pcs', '2058.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '4" SNI 2013 (114.3×3.25×6000)', NULL, NULL, '53.00', 'pcs', '2887.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '6" SNI 2013 (165×3.75×6000)', NULL, NULL, '251.00', 'pcs', '22906.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000003 · GKL-000001', NULL, '8" SNI 2013 (219×4.5×6000)', NULL, NULL, '101.00', 'pcs', '14714.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000004 · EMS-000001', NULL, 'Sheet Pile HR JIS A5528 SY390 ZU607 (600×226×19mm)', NULL, NULL, '1169.00', 'pcs', '1599192.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000005 · SGD-000001', NULL, 'Sheet Pile HR JIS A5528 SY390 ZU607 (600×226×19mm)', NULL, NULL, '1102.00', 'pcs', '1507536.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000009 · GKL-000002', NULL, '6" SNI 2013 (165.1×4.5×6000)', NULL, NULL, '60.00', 'pcs', '6545.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000009 · GKL-000002', NULL, '4" SNI 2013 (114.3×4×6000)', NULL, NULL, '252.00', 'pcs', '16781.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000009 · GKL-000002', NULL, '3" SNI 2013 (88.9×4×6000)', NULL, NULL, '49.00', 'pcs', '2512.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000009 · GKL-000002', NULL, '2½" SNI 2013 (76×3.75×6000)', NULL, NULL, '37.00', 'pcs', '1513.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000009 · GKL-000002', NULL, '2" SNI 2013 (60.3×3.5×6000)', NULL, NULL, '15.00', 'pcs', '450.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000010_R1 · GKL-000003_R1', NULL, '2" SNI 2013 (60.3×2.9×6000)', NULL, NULL, '406.00', 'pcs', '9999.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000010_R1 · GKL-000003_R1', NULL, '3" SNI 2013 (88.9×3.2×6000)', NULL, NULL, '25.00', 'pcs', '1015.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000010_R1 · GKL-000003_R1', NULL, '¾" SNI 2013 (26.7×2.3×6000)', NULL, NULL, '2651.00', 'pcs', '22003.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000010_R1 · GKL-000003_R1', NULL, '½" SNI 2013 (21.3×2×6000)', NULL, NULL, '3503.00', 'pcs', '20002.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000010_R1 · GKL-000003_R1', NULL, '1" SNI 2013 (33.4×3.2×6000)', NULL, NULL, '4196.00', 'pcs', '60003.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000010_R1 · GKL-000003_R1', NULL, '1¼" SNI 2013 (42.4×3.5×6000)', NULL, NULL, '1700.00', 'pcs', '38642.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000010_R1 · GKL-000003_R1', NULL, '1½" SNI 2013 (48.3×4×6000)', NULL, NULL, '1500.00', 'pcs', '32892.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000010_R1 · GKL-000003_R1', NULL, '2½" SNI 2013 (76×3.75×6000)', NULL, NULL, '1200.00', 'pcs', '42400.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000010_R1 · GKL-000003_R1', NULL, '3" SNI 2013 (88.9×3×6000)', NULL, NULL, '1067.00', 'pcs', '23747.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('ATL-000010_R1 · GKL-000003_R1', NULL, '+ other SKUs', NULL, NULL, '746.00', 'pcs', '23244.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSD26-SGD-000002', NULL, 'Sheet Pile HR JIS A5528 SY295 Type U-00014 (600×226×19mm, L12000)', NULL, NULL, '535.00', 'pcs', '488562.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSD26-BTS-000001 + PSD26-SGD-000003', NULL, 'Sheet Pile HR JIS A5528 SY295 Type U-00002 (400×100×10.5)', NULL, NULL, '1000.00', 'pcs', '576000.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSD26-BTS-000001 + PSD26-SGD-000003', NULL, 'Sheet Pile HR JIS A5528 SY295 Type U-00014 (400×170×15.5, L12000)', NULL, NULL, '465.00', 'pcs', '424638.00', NULL);
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-LSJ-000001', 1, 'GI-Z40 G550-00048', 'FLAT ROLLED PRODUCTS OF ALLOY STEEL COATED WITH ZINC AND OTHERS, SGCH. SPEC (BMT) : 0.22 X 914', '', '1.00', 'PCS', '400000.00', '0.68');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-LSJ-000001', 2, 'GI-Z40 G550-00049', 'FLAT ROLLED PRODUCTS OF ALLOY STEEL COATED WITH ZINC AND OTHERS, SGCH. SPEC (BMT) : 0.25 X 914', '', '1.00', 'PCS', '100000.00', '0.67');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 1, 'RM-AS-SCM440-00001', 'HOT ROLLED ALLOY STEEL ROUND BAR (AS STEEL), 16MM X 6000MM', '', '1.00', 'PCS', '15000.00', '0.74');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 2, 'RM-AS-SCM440-00002', 'HOT ROLLED ALLOY STEEL ROUND BAR (AS STEEL), 19MM X 6000MM', '', '1.00', 'PCS', '15000.00', '0.74');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 3, 'RM-AS-SCM440-00003', 'HOT ROLLED ALLOY STEEL ROUND BAR (AS STEEL), 25MM X 6000MM', '', '1.00', 'PCS', '15000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 4, 'RM-AS-SCM440-00004', 'HOT ROLLED ALLOY STEEL ROUND BAR (AS STEEL), 28MM X 6000MM', '', '1.00', 'PCS', '15000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 5, 'RM-AS-SCM440-00005', 'HOT ROLLED ALLOY STEEL ROUND BAR (AS STEEL), 30MM X 6000MM', '', '1.00', 'PCS', '15000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 6, 'RM-AS-SCM440-00006', 'HOT ROLLED ALLOY STEEL ROUND BAR (AS STEEL), 32MM X 6000MM', '', '1.00', 'PCS', '15000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 7, 'RM-AS-SCM440-00007', 'HOT ROLLED ALLOY STEEL ROUND BAR (AS STEEL), 38MM X 6000MM', '', '1.00', 'PCS', '15000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 8, 'RM-AS-SCM440-00008', 'HOT ROLLED ALLOY STEEL ROUND BAR (AS STEEL), 65MM X 6000MM', '', '1.00', 'PCS', '15000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 9, 'RM-AS-SCM440-00009', 'HOT ROLLED ALLOY STEEL ROUND BAR (AS STEEL), 75MM X 6000MM', '', '1.00', 'PCS', '15000.00', '0.73');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 10, 'RM-AS-SCM440-00010', 'HOT ROLLED ALLOY STEEL ROUND BAR (AS STEEL), 100MM X 6000MM', '', '1.00', 'PCS', '15000.00', '0.73');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 11, 'RM-AS-SCM440-00011', 'HOT ROLLED ALLOY STEEL ROUND BAR (AS STEEL), 125MM X 6000MM', '', '1.00', 'PCS', '15000.00', '0.73');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 12, 'RM-AS-SCM440-00012', 'HOT ROLLED ALLOY STEEL ROUND BAR (AS STEEL), 270MM X 6000MM', '', '1.00', 'PCS', '15000.00', '0.77');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 13, 'RM-AS-SCM440-00013', 'HOT ROLLED ALLOY STEEL ROUND BAR (AS STEEL), 280MM X 6000MM', '', '1.00', 'PCS', '15000.00', '0.77');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 14, 'FG-AS-SCM440-00001', 'CUTTING AS STEEL 16MM', '', '1.00', 'PCS', '0.00', '0.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 15, 'FG-AS-SCM440-00002', 'CUTTING AS STEEL 19MM', '', '1.00', 'PCS', '0.00', '0.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 16, 'FG-AS-SCM440-00003', 'CUTTING AS STEEL 25MM', '', '1.00', 'PCS', '0.00', '0.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 17, 'FG-AS-SCM440-00004', 'CUTTING AS STEEL 28MM', '', '1.00', 'PCS', '0.00', '0.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 18, 'FG-AS-SCM440-00005', 'CUTTING AS STEEL 30MM', '', '1.00', 'PCS', '0.00', '0.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 19, 'FG-AS-SCM440-00006', 'CUTTING AS STEEL 32MM', '', '1.00', 'PCS', '0.00', '0.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 20, 'FG-AS-SCM440-00007', 'CUTTING AS STEEL 38MM', '', '1.00', 'PCS', '0.00', '0.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 21, 'FG-AS-SCM440-00008', 'CUTTING AS STEEL 65MM', '', '1.00', 'PCS', '0.00', '0.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 22, 'FG-AS-SCM440-00009', 'CUTTING AS STEEL 75MM', '', '1.00', 'PCS', '0.00', '0.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 23, 'FG-AS-SCM440-00010', 'CUTTING AS STEEL 100MM', '', '1.00', 'PCS', '0.00', '0.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 24, 'FG-AS-SCM440-00011', 'CUTTING AS STEEL 125MM', '', '1.00', 'PCS', '0.00', '0.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 25, 'FG-AS-SCM440-00012', 'CUTTING AS STEEL 270MM', '', '1.00', 'PCS', '0.00', '0.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000002', 26, 'FG-AS-SCM440-00013', 'CUTTING AS STEEL 280MM', '', '1.00', 'PCS', '0.00', '0.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000012', 1, 'ATL-SMLS-A53/A106/API-5L-B-00018', 'SEAMLESSPIPE A53/A106/API5L-B 26.7 X 2.87 X 6000 MM', '', '1.00', 'PCS', '25000.00', '0.76');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000012', 2, 'ATL-SMLS-A53/A106/API-5L-B-00019', 'SEAMLESSPIPE A53/A106/API5L-B 33.4 X 3.38 X 6000 MM', '', '1.00', 'PCS', '25000.00', '0.67');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000012', 3, 'ATL-SMLS-A53/A106/API-5L-B-00021', 'SEAMLESSPIPE A53/A106/API5L-B 48.3 X 3.68 X 6000 MM', '', '1.00', 'PCS', '25000.00', '0.64');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000012', 4, 'ATL-SMLS-A53/A106/API-5L-B-00022', 'SEAMLESSPIPE A53/A106/API5L-B 60.3 X 3.91 X 6000 MM', '', '1.00', 'PCS', '25000.00', '0.63');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000012', 5, 'ATL-SMLS-A53/A106/API-5L-B-00026', 'SEAMLESSPIPE A53/A106/API5L-B 141.3. X 6.55 X 6000 MM', '', '1.00', 'PCS', '50000.00', '0.62');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000012', 6, 'ATL-SMLS-A53/A106/API-5L-B-00001', 'SEAMLESSPIPE A53/A106/API5L-B 168.3 X 7.11 X 6000 MM', '', '1.00', 'PCS', '75000.00', '0.62');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000012', 7, 'ATL-SMLS-A53/A106/API-5L-B-00002', 'SEAMLESSPIPE A53/A106/API5L-B 219.1 X 8.18 X 6000 MM', '', '1.00', 'PCS', '50000.00', '0.63');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000012', 8, 'ATL-SMLS-A53/A106/API-5L-B-00029', 'SEAMLESSPIPE A53/A106/API5L-B 273.1. X 9.27 X 6000 MM', '', '1.00', 'PCS', '25000.00', '0.63');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000003', 1, 'SMLS-A53/A106/API-5L-B-00018', 'SEAMLESSPIPE A53/A106/API5L-B 26.7 X 2.87 X 6000 MM', '', '1.00', 'PCS', '25000.00', '0.81');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000003', 2, 'SMLS-A53/A106/API-5L-B-00019', 'SEAMLESSPIPE A53/A106/API5L-B 33.4 X 3.38 X 6000 MM', '', '1.00', 'PCS', '25000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000003', 3, 'SMLS-A53/A106/API-5L-B-00021', 'SEAMLESSPIPE A53/A106/API5L-B 48.3 X 3.68 X 6000 MM', '', '1.00', 'PCS', '25000.00', '0.69');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000003', 4, 'SMLS-A53/A106/API-5L-B-00022', 'SEAMLESSPIPE A53/A106/API5L-B 60.3 X 3.91 X 6000 MM', '', '1.00', 'PCS', '25000.00', '0.68');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000003', 5, 'SMLS-A53/A106/API-5L-B-00026', 'SEAMLESSPIPE A53/A106/API5L-B 141.3 X 6.55 X 6000 MM', '', '1.00', 'PCS', '50000.00', '0.67');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000003', 6, 'SMLS-A53/A106/API-5L-B-00001', 'SEAMLESSPIPE A53/A106/API5L-B 168.3 X 7.11 X 6000 MM', '', '1.00', 'PCS', '75000.00', '0.67');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000003', 7, 'SMLS-A53/A106/API-5L-B-00002', 'SEAMLESSPIPE A53/A106/API5L-B 219.1 X 8.18 X 6000 MM', '', '1.00', 'PCS', '50000.00', '0.68');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000003', 8, 'SMLS-A53/A106/API-5L-B-00029', 'SEAMLESSPIPE A53/A106/API5L-B 273.1 X 9.27 X 6000 MM', '', '1.00', 'PCS', '25000.00', '0.68');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-JKT-000001', 1, 'GI-Z40 G550-00011', 'FLAT ROLLED PRODUCTS OF ALLOY STEEL COATED WITH ZINC AND OTHERS, SGCH. SPEC (BMT) : 0.40 X 1219', '', '1.00', 'PCS', '80000.00', '0.67');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-GKL-000005', 1, 'GI-Z40 G550-00014', 'FLAT ROLLED PRODUCTS OF ALLOY STEEL COATED WITH ZINC AND OTHERS, SGCH. SPEC (BMT) : 0.55 X 1219', '', '1.00', 'PCS', '100000.00', '0.67');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-NCT-000001', 1, 'GI-Z40 G550-00015', 'FLAT ROLLED PRODUCTS OF ALLOY STEEL COATED WITH ZINC AND OTHERS, SGCH. SPEC (BMT) : 0.60 X 1219', '', '1.00', 'PCS', '150000.00', '0.67');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-SPP-000001', 1, 'GI-Z40 G550-00015', 'FLAT ROLLED PRODUCTS OF ALLOY STEEL COATED WITH ZINC AND OTHERS, SGCH. SPEC (BMT) : 0.60 X 1219', '', '1.00', 'PCS', '150000.00', '0.67');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-SPP-000001', 2, 'GI-Z40 G550-00017', 'FLAT ROLLED PRODUCTS OF ALLOY STEEL COATED WITH ZINC AND OTHERS, SGCH. SPEC (BMT) : 0.70 X 1219', '', '1.00', 'PCS', '100000.00', '0.67');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 1, 'ATL-SMLS-A53/A106/API-5L-B-00126', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1(21.3 MM X 2.77 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '5000.00', '0.96');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 2, 'ATL-SMLS-A53/A106/API-5L-B-00127', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (26.7 MM X 2.87 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '10000.00', '0.90');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 3, 'ATL-SMLS-A53/A106/API-5L-B-00047', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (33.4 MM X 3.38 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '15000.00', '0.76');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 4, 'ATL-SMLS-A53/A106/API-5L-B-00067', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (42.2 MM X 3.56 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '10000.00', '0.74');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 5, 'ATL-SMLS-A53/A106/API-5L-B-00052', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (48.3 MM X 3.68 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '15000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 6, 'ATL-SMLS-A53/A106/API-5L-B-00048', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (60.3 MM X 3.91 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '15000.00', '0.71');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 7, 'ATL-SMLS-A53/A106/API-5L-B-00093', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (73.0 MM X 5.16 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '20000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 8, 'ATL-SMLS-A53/A106/API-5L-B-00128', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (88.9 MM X 5.49 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '20000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 9, 'ATL-SMLS-A53/A106/API-5L-B-00062', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (114.3 MM X 6.02 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '30000.00', '0.70');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 10, 'ATL-SMLS-A53/A106/API-5L-B-00160', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (141.3 MM X 6.55 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '10000.00', '0.69');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 11, 'ATL-SMLS-A53/A106/API-5L-B-00094', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (21.3 MM X 3.73 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '5000.00', '1.02');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 12, 'ATL-SMLS-A53/A106/API-5L-B-00095', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (26.7 MM X 3.91 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '10000.00', '0.97');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 13, 'ATL-SMLS-A53/A106/API-5L-B-00097', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (42.2 MM X 4.85 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '20000.00', '0.74');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 14, 'ATL-SMLS-A53/A106/API-5L-B-00053', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (48.3 MM X 5.08 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '20000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 15, 'ATL-SMLS-A53/A106/API-5L-B-00099', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (60.3 MM X 5.54 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '25000.00', '0.71');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 16, 'ATL-SMLS-A53/A106/API-5L-B-00100', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (73.0 MM X 7.01 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '15000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 17, 'ATL-SMLS-A53/A106/API-5L-B-00102', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (114.3 MM X 8.56 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '25000.00', '0.70');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000017', 18, 'ATL-SMLS-A53/A106/API-5L-B-00064', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (168.3 MM X 10.97 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '25000.00', '0.69');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000016', 1, 'ATL-SMLS-A53/A106/API-5L-B-00126', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (21.3 MM X 2.77 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '5000.00', '0.96');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000016', 2, 'ATL-SMLS-A53/A106/API-5L-B-00047', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (33.4 MM X 3.38 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '15000.00', '0.76');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000016', 3, 'ATL-SMLS-A53/A106/API-5L-B-00090', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (42.2 MM X 3.56 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '10000.00', '0.74');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000016', 4, 'ATL-SMLS-A53/A106/API-5L-B-00052', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (48.3 MM X 3.68 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '10000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000016', 5, 'ATL-SMLS-A53/A106/API-5L-B-00128', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (88.9 MM X 5.49 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '10000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000016', 6, 'ATL-SMLS-A53/A106/API-5L-B-00160', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (141.3 MM X 6.55 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '10000.00', '0.69');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000016', 7, 'ATL-SMLS-A53/A106/API-5L-B-00161', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (168.3 MM X 7.11 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '25000.00', '0.69');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000016', 8, 'ATL-SMLS-A53/A106/API-5L-B-00096', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (33.4 MM X 4.55 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '10000.00', '0.76');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000016', 9, 'ATL-SMLS-A53/A106/API-5L-B-00097', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (42.2 MM X 4.85 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '10000.00', '0.74');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000016', 10, 'ATL-SMLS-A53/A106/API-5L-B-00053', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (48.3 MM X 5.08 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '5000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000016', 11, 'ATL-SMLS-A53/A106/API-5L-B-00099', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (60.3 MM X 5.54 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '25000.00', '0.71');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000016', 12, 'ATL-SMLS-A53/A106/API-5L-B-00100', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (73.0 MM X 7.01 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '25000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000016', 13, 'ATL-SMLS-A53/A106/API-5L-B-00101', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (88.9 MM X 7.62 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '10000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000016', 14, 'ATL-SMLS-A53/A106/API-5L-B-00102', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (114.3 MM X 8.56 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '25000.00', '0.70');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-ATL-000016', 15, 'ATL-SMLS-A53/A106/API-5L-B-00064', 'GALVANIZED SEAMLESS STEEL PIPE SPEC A53/A106/API 5L-B PSL 1 (168.3 MM X 10.97 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '10000.00', '0.69');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 1, 'SMLS-A53/A106/API-5L-B-00126', 'GALVANIZED SEAMLESSPIPE A53/A106/API 5L-B (21.3 MM X 2.77 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '5000.00', '0.98');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 2, 'SMLS-A53/A106/API-5L-B-00127', 'GALVANIZED SEAMLESSPIPE A53/A106/API 5L-B (26.7 MM X 2.87 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '10000.00', '0.92');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 3, 'SMLS-A53/A106/API-5L-B-00047', 'GALVANIZED SEAMLESSPIPE A53/A106/API 5L-B (33.4 MM X 3.38 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '15000.00', '0.79');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 4, 'SMLS-A53/A106/API-5L-B-00090', 'SEAMLESSPIPE GALVANIZED A53/A106/API 5L-B (42.2 MM X 3.56 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '10000.00', '0.76');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 5, 'SMLS-A53/A106/API-5L-B-00091', 'GALVANIZED SEAMLESSPIPE A53/A106/API 5L-B (48.3 MM X 3.68 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '15000.00', '0.75');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 6, 'SMLS-A53/A106/API-5L-B-00048', 'SEAMLESSPIPE GALVANIZED A53/A106/API 5L-B (60.3 MM X 3.91 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '15000.00', '0.74');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 7, 'SMLS-A53/A106/API-5L-B-00093', 'GALVANIZED SEAMLESSPIPE A53/A106/API 5L-B (73.0 MM X 5.16 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '20000.00', '0.74');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 8, 'SMLS-A53/A106/API-5L-B-00128', 'GALVANIZED SEAMLESSPIPE A53/A106/API 5L-B (88.9 MM X 5.49 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '20000.00', '0.74');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 9, 'SMLS-A53/A106/API-5L-B-00062', 'SEAMLESSPIPE GALVANIZED A53/A106/API 5L-B (114.3 MM X 6.02 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '30000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 10, 'SMLS-A53/A106/API-5L-B-00168', 'GALVANIZED SEAMLESSPIPE A53/A106/API 5L-B (141.3 MM X 6.55 MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '10000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 11, 'SMLS-A53/A106/API-5L-B-00094', 'GALVANIZED SEAMLESSPIPE A53/A106/API 5L-B (21.3 MM X 3.73 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '5000.00', '1.05');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 12, 'SMLS-A53/A106/API-5L-B-00095', 'GALVANIZED SEAMLESSPIPE A53/A106/API 5L-B (26.7 MM X 3.91 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '10000.00', '0.99');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 13, 'SMLS-A53/A106/API-5L-B-00097', 'GALVANIZED SEAMLESSPIPE A53/A106/API 5L-B (42.2 MM X 4.85 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '20000.00', '0.76');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 14, 'SMLS-A53/A106/API-5L-B-00053', 'SEAMLESSPIPE GALVANIZED A53/A106/API 5L-B (48.3 MM X 5.08 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '20000.00', '0.75');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 15, 'SMLS-A53/A106/API-5L-B-00099', 'GALVANIZED SEAMLESSPIPE A53/A106/API 5L-B (60.3 MM X 5.54 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '25000.00', '0.74');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 16, 'SMLS-A53/A106/API-5L-B-00100', 'GALVANIZED SEAMLESSPIPE A53/A106/API5L-B (73.0 MM X 7.01 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '15000.00', '0.74');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 17, 'SMLS-A53/A106/API-5L-B-00102', 'GALVANIZED SEAMLESSPIPE A53/A106/API 5L-B (114.3 MM X 8.56 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '25000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000007', 18, 'SMLS-A53/A106/API-5L-B-00064', 'SEAMLESSPIPE GALVANIZED A53/A106/API 5L-B (168.3 MM X 10.97 MM X 6000 MM) SCH 80', '', '1.00', 'PCS', '25000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000006', 1, 'SMLS-A53/A106/API-5L-B-00126', 'GALVANIZED SEAMLESSPIPE A53/A106/API5L-B (21.3MM X 2.77MM X 6000 MM) SCH40', '', '1.00', 'PCS', '5000.00', '0.98');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000006', 2, 'SMLS-A53/A106/API-5L-B-00047', 'GALVANIZED SEAMLESSPIPE A53/A106/API5L-B (33.4MM X 3.38MM X 6000 MM) SCH 40', '', '1.00', 'PCS', '15000.00', '0.79');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000006', 3, 'SMLS-A53/A106/API-5L-B-00067', 'SEAMLESSPIPE GALVANIZED A53/A106/API5L-B (42.2MM X 3.56MM X 6000 MM) SCH40', '', '1.00', 'PCS', '10000.00', '0.76');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000006', 4, 'SMLS-A53/A106/API-5L-B-00052', 'SEAMLESSPIPE GALVANIZED A53/A106/API5L-B (48.3MM X 3.68MM X 6000 MM) SCH40', '', '1.00', 'PCS', '10000.00', '0.75');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000006', 5, 'SMLS-A53/A106/API-5L-B-00128', 'GALVANIZED SEAMLESSPIPE A53/A106/API5L-B (88.9MM X 5.49MM X 6000 MM) SCH40', '', '1.00', 'PCS', '10000.00', '0.74');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000006', 6, 'SMLS-A53/A106/API-5L-B-00168', 'GALVANIZED SEAMLESSPIPE A53/A106/API5L-B (141.3MM X 6.55MM X 6000 MM) SCH40', '', '1.00', 'PCS', '10000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000006', 7, 'SMLS-A53/A106/API-5L-B-00169', 'GALVANIZED SEAMLESSPIPE A53/A106/API5L-B (168.3MM X 7.11MM X 6000 MM) SCH40', '', '1.00', 'PCS', '25000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000006', 8, 'SMLS-A53/A106/API-5L-B-00096', 'GALVANIZED SEAMLESSPIPE A53/A106/API5L-B (33.4MM X 4.55MM X 6000 MM) SCH80', '', '1.00', 'PCS', '10000.00', '0.79');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000006', 9, 'SMLS-A53/A106/API-5L-B-00097', 'GALVANIZED SEAMLESSPIPE A53/A106/API5L-B (42.2MM X 4.85MM X 6000 MM) SCH80', '', '1.00', 'PCS', '10000.00', '0.76');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000006', 10, 'SMLS-A53/A106/API-5L-B-00053', 'SEAMLESSPIPE GALVANIZED A53/A106/API5L-B (48.3MM X 5.08MM X 6000 MM) SCH80', '', '1.00', 'PCS', '5000.00', '0.75');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000006', 11, 'SMLS-A53/A106/API-5L-B-00099', 'GALVANIZED SEAMLESSPIPE A53/A106/API5L-B (60.3MM X 5.54MM X 6000 MM) SCH80', '', '1.00', 'PCS', '25000.00', '0.74');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000006', 12, 'SMLS-A53/A106/API-5L-B-00100', 'GALVANIZED SEAMLESSPIPE A53/A106/API5L-B (73.0MM X 7.01MM X 6000 MM) SCH80', '', '1.00', 'PCS', '25000.00', '0.74');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000006', 13, 'SMLS-A53/A106/API-5L-B-00101', 'GALVANIZED SEAMLESSPIPE A53/A106/API5L-B (88.9MM X 7.62MM X 6000 MM) SCH80', '', '1.00', 'PCS', '10000.00', '0.74');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000006', 14, 'SMLS-A53/A106/API-5L-B-00102', 'GALVANIZED SEAMLESSPIPE A53/A106/API5L-B (114.3MM X 8.56MM X 6000 MM) SCH80', '', '1.00', 'PCS', '25000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-BTS-000006', 15, 'SMLS-A53/A106/API-5L-B-00064', 'SEAMLESSPIPE GALVANIZED A53/A106/API5L-B (168.3MM X 10.97MM X 6000 MM) SCH80', '', '1.00', 'PCS', '10000.00', '0.72');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-SPA-000004', 1, 'IWF-JIS G3101 SS400-00032', 'WF BEAM JIS G3101 SS400 400x200x8x13x 12000 MM', '', '100.00', 'PCS', '78500.00', '13325.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-SPA-000004', 2, 'IWF-JIS G3101 SS400-00028', 'WF BEAM JIS G3101 SS400 350x175x7x11x 12000  MM', '', '96.00', 'PCS', '56928.00', '12425.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-SPA-000004', 3, 'IWF-JIS G3101 SS400-00023', 'WF BEAM JIS G3101 SS400 300x150x6.5x9x 12000 MM', '', '106.00', 'PCS', '46640.00', '12425.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-SPA-000004', 4, 'IWF-JIS G3101 SS400-00019', 'WF BEAM JIS G3101 SS400 250x125x6x9x 12000 MM', '', '612.00', 'PCS', '212976.00', '11475.00');
INSERT INTO ps_items (ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg) VALUES ('PSF26-SPA-000004', 5, 'IWF-JIS G3101 SS400-00009', 'WF BEAM JIS G3101 SS400 200x100x5.5x8x 12000  MM', '', '318.00', 'PCS', '79818.00', '11125.00');


-- =================================================================
-- 8. AUTO-RETAG ps_headers (one-shot, idempotent — hanya update yang NULL)
-- =================================================================
WITH match AS (
  SELECT
    h.ps_number,
    (
      SELECT pa.canonical_name
        FROM product_aliases pa
       WHERE LOWER(
               COALESCE(h.project_name,'') || ' ' ||
               COALESCE((SELECT string_agg(material || ' ' || COALESCE(size,''), ' ')
                           FROM ps_items WHERE ps_number = h.ps_number), '')
             ) LIKE '%' || LOWER(pa.alias) || '%'
       ORDER BY length(pa.alias) DESC
       LIMIT 1
    ) AS detected_product
    FROM ps_headers h
   WHERE h.product IS NULL
)
UPDATE ps_headers
   SET product = match.detected_product,
       segment = CASE match.detected_product
         WHEN 'Sheet Pile'      THEN 'Long'
         WHEN 'ERW Pipe'        THEN 'Long'
         WHEN 'Seamless Pipe'   THEN 'Long'
         WHEN 'Angle'           THEN 'Long'
         WHEN 'Bar'             THEN 'Long'
         WHEN 'Beam'            THEN 'Long'
         WHEN 'Channel'         THEN 'Long'
         WHEN 'As Steel'        THEN 'Long'
         WHEN 'Hollow'          THEN 'Long'
         WHEN 'HRC'             THEN 'Flat'
         WHEN 'HRPO'            THEN 'Flat'
         WHEN 'Plate'           THEN 'Flat'
         WHEN 'Chequered Plate' THEN 'Flat'
         WHEN 'Wear Plate'      THEN 'Flat'
         WHEN 'Galvalume'       THEN 'Coated'
         WHEN 'Galvanized'      THEN 'Coated'
         WHEN 'PPGL'            THEN 'Coated'
         WHEN 'Wiremesh'        THEN 'Coated'
         WHEN 'Slab'            THEN 'Semi-Finished'
         WHEN 'Billet'          THEN 'Semi-Finished'
         WHEN 'HBI'             THEN 'Raw Material'
         WHEN 'Scrap'           THEN 'Raw Material'
         WHEN 'Projects'        THEN 'Projects'
         ELSE NULL
       END
  FROM match
 WHERE ps_headers.ps_number = match.ps_number
   AND match.detected_product IS NOT NULL;
