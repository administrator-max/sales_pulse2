-- =================================================================
-- 1. DASHBOARD AGGREGATES & PIPELINE (Mapped to HTML State)
-- =================================================================

-- Maps directly to the `ACTUAL` object in HTML
CREATE TABLE IF NOT EXISTS monthly_actuals (
    month_idx INT PRIMARY KEY, 
    actual_margin NUMERIC(15,3), 
    plan_margin NUMERIC(15,3),   
    revenue NUMERIC(15,3),       
    notes TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Maps directly to the `BUDGET` object in HTML
CREATE TABLE IF NOT EXISTS monthly_budgets (
    month_idx INT PRIMARY KEY,
    margin NUMERIC(15,3),
    revenue NUMERIC(15,3),
    qty JSONB, -- Stores {"sheetPile": 1000, "weldedPipe": 100, ...}
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Maps directly to the `PLAN_REVISIONS` array in HTML
CREATE TABLE IF NOT EXISTS plan_revisions (
    id SERIAL PRIMARY KEY,
    month_idx INT NOT NULL,
    name VARCHAR(255),
    margin NUMERIC(15,3),
    revenue NUMERIC(15,3),
    notes TEXT,
    qty JSONB, 
    ts VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =================================================================
-- 2. PROJECT SHEET (PS) DATA (Mapped to PS_CHAINS & QTY_DATA)
-- =================================================================

CREATE TABLE IF NOT EXISTS ps_headers (
    ps_number VARCHAR(100) PRIMARY KEY, 
    dashboard_month_idx INT,            
    project_code VARCHAR(50),           
    project_name VARCHAR(255),          
    subsidiary VARCHAR(255),            
    customer_name VARCHAR(255),         
    supplier_name VARCHAR(255),         
    po_date DATE,
    currency VARCHAR(10),               
    sales_revenue NUMERIC(20,2),        
    purchase_cost NUMERIC(20,2),
    margin NUMERIC(20,2),               
    margin_percentage NUMERIC(8,4),     
    notes TEXT,                         
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ps_items (
    id SERIAL PRIMARY KEY,
    ps_number VARCHAR(100) REFERENCES ps_headers(ps_number) ON DELETE CASCADE,
    item_no INT,
    material VARCHAR(255),
    size VARCHAR(255),
    length VARCHAR(100),
    qty_val NUMERIC(15,2),
    qty_unit VARCHAR(50), 
    total_weight_kg NUMERIC(15,2),
    purchase_price_kg NUMERIC(20,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plan_revisions_month ON plan_revisions(month_idx);
CREATE INDEX IF NOT EXISTS idx_ps_headers_month ON ps_headers(dashboard_month_idx);
CREATE INDEX IF NOT EXISTS idx_ps_items_ps_number ON ps_items(ps_number);


-- =================================================================
-- 3. SEED DEFAULT DATA (Original Hardcoded Values)
-- =================================================================

INSERT INTO monthly_actuals (month_idx) VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11) ON CONFLICT DO NOTHING;

-- Seed default budgets so the dashboard isn't empty on first load
INSERT INTO monthly_budgets (month_idx, margin, revenue, qty) VALUES
(0, 6497, 69872, '{"sheetPile":1000, "weldedPipe":100, "erwPipe":100, "gl":1000, "gi":1500, "ppgl":0}'),
(1, 6547, 67796, '{"sheetPile":500, "weldedPipe":100, "erwPipe":100, "gl":1000, "gi":1500, "ppgl":0}'),
(2, 6497, 69872, '{"sheetPile":1000, "weldedPipe":100, "erwPipe":100, "gl":1000, "gi":1500, "ppgl":0}'),
(3, 7577, 81729, '{"sheetPile":1000, "weldedPipe":100, "erwPipe":100, "gl":1000, "gi":2000, "ppgl":400}'),
(4, 7747, 84423, '{"sheetPile":1000, "weldedPipe":100, "erwPipe":100, "gl":1500, "gi":2000, "ppgl":0}'),
(5, 7347, 82346, '{"sheetPile":1000, "weldedPipe":100, "erwPipe":100, "gl":1500, "gi":2000, "ppgl":0}'),
(6, 9789, 112348, '{"sheetPile":1500, "weldedPipe":500, "erwPipe":500, "gl":1500, "gi":3000, "ppgl":0}'),
(7, 10039, 118493, '{"sheetPile":1500, "weldedPipe":500, "erwPipe":500, "gl":2000, "gi":3000, "ppgl":0}'),
(8, 11289, 149052, '{"sheetPile":1500, "weldedPipe":500, "erwPipe":500, "gl":4000, "gi":3500, "ppgl":0}'),
(9, 12569, 165751, '{"sheetPile":2000, "weldedPipe":500, "erwPipe":500, "gl":4000, "gi":4000, "ppgl":400}'),
(10, 9790, 140902, '{"sheetPile":1000, "weldedPipe":100, "erwPipe":500, "gl":4000, "gi":4000, "ppgl":0}'),
(11, 9990, 141940, '{"sheetPile":1000, "weldedPipe":100, "erwPipe":500, "gl":4000, "gi":4000, "ppgl":0}')
ON CONFLICT (month_idx) DO NOTHING;

-- =================================================================
-- 1. SEED MONTHLY ACTUALS (Jan and Feb Totals)
-- =================================================================
UPDATE monthly_actuals 
SET actual_margin = 5987.020, revenue = 56488.733 
WHERE month_idx = 0; -- January

UPDATE monthly_actuals 
SET actual_margin = 3300.817, revenue = 23327.698 
WHERE month_idx = 1; -- February


-- =================================================================
-- 2. SEED PROJECT HEADERS (From PS_CHAINS)
-- Note: Storing in raw IDR (MIDR * 1,000,000) so the backend parser handles it correctly
-- =================================================================
INSERT INTO ps_headers 
(ps_number, dashboard_month_idx, project_name, customer_name, sales_revenue, margin, margin_percentage, notes) 
VALUES
-- JANUARY PROJECTS
('ATL-000006 · AMP-000001 · GIS-000001', 0, 'SSSC 12A', 'PT. Kapuk Molek', 6972960000, 702054000, 10.07, NULL),
('ATL-000007 · BHG-000001 · GIS-000002', 0, 'SSSC 12B', 'PT. Kapuk Molek', 3486480000, 345211000, 9.90, NULL),
('ATL-000003 · GKL-000001', 0, 'Youfa 7', 'PT. Wingman Steel Indonesia', 2535101000, 207133000, 8.17, NULL),
('ATL-000004 · EMS-000001', 0, 'Mlion 09A', 'PT. Mlion Intl Indonesia', 22388688000, 2436115000, 10.88, NULL),
('ATL-000005 · SGD-000001', 0, 'Mlion 09B', 'PT. Mlion Intl Indonesia', 21105504000, 2296507000, 10.88, NULL),

-- FEBRUARY PROJECTS
('ATL-000009 · GKL-000002', 1, 'Youfa 8', 'PT. Welon Engineering', 716353000, 51389000, 7.17, NULL),
('ATL-000010_R1 · GKL-000003_R1', 1, 'Youfa 9 R1', 'PT. Sapta Sumber Lancar', 4070805000, 320846000, 7.88, NULL),
('PSD26-SGD-000002', 1, 'Mlion 10A', 'PT. Mlion Intl Indonesia', 6082597000, 960745000, 15.79, 'Net Margin after Port Charges, Trucking, KSO, Insurance, Finance (Total Cost: 359.853M)'),
('PSD26-BTS-000001 + PSD26-SGD-000003', 1, 'Mlion 10B', 'PT. Mlion Intl Indonesia', 12457943000, 1967837000, 15.80, 'Consolidated Net Margin: BTS Net (1,656.388M) + SGD Net (311.449M). Purchase=BTS←Hanwa, Sales=SGD→Mlion, eliminasi interco BTS↔SGD')
ON CONFLICT (ps_number) DO NOTHING;


-- =================================================================
-- 3. SEED PROJECT ITEMS (From QTY_DATA)
-- =================================================================
INSERT INTO ps_items 
(ps_number, material, qty_val, qty_unit, total_weight_kg) 
VALUES
-- SSSC 12A & 12B
('ATL-000006 · AMP-000001 · GIS-000001', 'PPGL AZ100 G300 BMT 0.30x1219xCOIL', 1, 'coil', 400000),
('ATL-000007 · BHG-000001 · GIS-000002', 'PPGL AZ100 G300 BMT 0.30x1200xCOIL', 1, 'coil', 160000),
('ATL-000007 · BHG-000001 · GIS-000002', 'PPGL AZ100 G300 BMT 0.30x1219xCOIL', 1, 'coil', 40000),

-- Youfa 7 (Jan)
('ATL-000003 · GKL-000001', '3" SNI 2013 (89x3.75x6000)', 157, 'pcs', 7575),
('ATL-000003 · GKL-000001', '2" SNI 2013 (60.3x3.5x6000)', 77, 'pcs', 2310),
('ATL-000003 · GKL-000001', '4" SNI 2013 (114.3x3.75x6000)', 97, 'pcs', 6069),
('ATL-000003 · GKL-000001', '5" SNI 2013 (139.7x3.75x6000)', 30, 'pcs', 2309),
('ATL-000003 · GKL-000001', '6" SNI 2013 (165.1x4.25x6000)', 157, 'pcs', 16199),
('ATL-000003 · GKL-000001', '1½" SNI 2013 (48.3x3.25x6000)', 100, 'pcs', 2210),
('ATL-000003 · GKL-000001', '½" SNI 2013 (26.9x2.75x6000)', 25, 'pcs', 251),
('ATL-000003 · GKL-000001', '1" SNI 2013 (33.7x3x6000)', 40, 'pcs', 556),
('ATL-000003 · GKL-000001', '1" SNI 2013 (33.7x2.75x6000)', 1714, 'pcs', 22025),
('ATL-000003 · GKL-000001', '1¼" SNI 2013 (42.4x2.75x6000)', 2442, 'pcs', 40195),
('ATL-000003 · GKL-000001', '2" SNI 2013 (60.3x2.75x6000)', 957, 'pcs', 22863),
('ATL-000003 · GKL-000001', '1" SNI 2013 (33.7x3.2x6000)', 91, 'pcs', 1340),
('ATL-000003 · GKL-000001', '1¼" SNI 2013 (42.4x3.5x6000)', 61, 'pcs', 1254),
('ATL-000003 · GKL-000001', '2" SNI 2013 (60.3x3.75x6000)', 37, 'pcs', 1184),
('ATL-000003 · GKL-000001', '2½" SNI 2013 (76x3x6000)', 241, 'pcs', 7965),
('ATL-000003 · GKL-000001', '3" SNI 2013 (88.9x3.25x6000)', 49, 'pcs', 2058),
('ATL-000003 · GKL-000001', '4" SNI 2013 (114.3x3.25x6000)', 53, 'pcs', 2887),
('ATL-000003 · GKL-000001', '6" SNI 2013 (165x3.75x6000)', 251, 'pcs', 22906),
('ATL-000003 · GKL-000001', '8" SNI 2013 (219x4.5x6000)', 101, 'pcs', 14714),

-- Mlion 09A & 09B
('ATL-000004 · EMS-000001', 'Sheet Pile HR JIS A5528 SY390 ZU607 (600x226x19mm)', 1169, 'pcs', 1599192),
('ATL-000005 · SGD-000001', 'Sheet Pile HR JIS A5528 SY390 ZU607 (600x226x19mm)', 1102, 'pcs', 1507536),

-- Youfa 8 (Feb)
('ATL-000009 · GKL-000002', '6" SNI 2013 (165.1x4.5x6000)', 60, 'pcs', 6545),
('ATL-000009 · GKL-000002', '4" SNI 2013 (114.3x4x6000)', 252, 'pcs', 16781),
('ATL-000009 · GKL-000002', '3" SNI 2013 (88.9x4x6000)', 49, 'pcs', 2512),
('ATL-000009 · GKL-000002', '2½" SNI 2013 (76x3.75x6000)', 37, 'pcs', 1513),
('ATL-000009 · GKL-000002', '2" SNI 2013 (60.3x3.5x6000)', 15, 'pcs', 450),

-- Youfa 9 R1 (Feb)
('ATL-000010_R1 · GKL-000003_R1', '2" SNI 2013 (60.3x2.9x6000)', 406, 'pcs', 9999),
('ATL-000010_R1 · GKL-000003_R1', '3" SNI 2013 (88.9x3.2x6000)', 25, 'pcs', 1015),
('ATL-000010_R1 · GKL-000003_R1', '¾" SNI 2013 (26.7x2.3x6000)', 2651, 'pcs', 22003),
('ATL-000010_R1 · GKL-000003_R1', '½" SNI 2013 (21.3x2x6000)', 3503, 'pcs', 20002),
('ATL-000010_R1 · GKL-000003_R1', '1" SNI 2013 (33.4x3.2x6000)', 4196, 'pcs', 60003),
('ATL-000010_R1 · GKL-000003_R1', '1¼" SNI 2013 (42.4x3.5x6000)', 1700, 'pcs', 38642),
('ATL-000010_R1 · GKL-000003_R1', '1½" SNI 2013 (48.3x4x6000)', 1500, 'pcs', 32892),
('ATL-000010_R1 · GKL-000003_R1', '2½" SNI 2013 (76x3.75x6000)', 1200, 'pcs', 42400),
('ATL-000010_R1 · GKL-000003_R1', '3" SNI 2013 (88.9x3x6000)', 1067, 'pcs', 23747),
('ATL-000010_R1 · GKL-000003_R1', '+ other SKUs', 746, 'pcs', 23244),

-- Mlion 10A & 10B (Feb)
('PSD26-SGD-000002', 'Sheet Pile HR JIS A5528 SY295 Type U-00014 (600x226x19mm, L12000)', 535, 'pcs', 488562),
('PSD26-BTS-000001 + PSD26-SGD-000003', 'Sheet Pile HR JIS A5528 SY295 Type U-00002 (400x100x10.5)', 1000, 'pcs', 576000),
('PSD26-BTS-000001 + PSD26-SGD-000003', 'Sheet Pile HR JIS A5528 SY295 Type U-00014 (400x170x15.5, L12000)', 465, 'pcs', 424638);