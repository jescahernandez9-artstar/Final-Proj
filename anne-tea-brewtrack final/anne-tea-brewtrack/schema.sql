-- ============================================================
-- AnneTea BrewTrack - MySQL Database Schema
-- IT 312 System Integration and Architecture
-- Compatible with MySQL 8.0+ / MariaDB
-- ============================================================

CREATE DATABASE IF NOT EXISTS annetea_brewtrack
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE annetea_brewtrack;

-- Users & Roles (secure authentication)
CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,          -- bcrypt / argon2
  full_name     VARCHAR(100) NOT NULL,
  role          ENUM('owner','co_owner','staff') NOT NULL DEFAULT 'staff',
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  last_login    DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Sample users (password for all demo accounts = 1234)
-- Generate real hashes in production with password_hash()
INSERT INTO users (username, password_hash, full_name, role) VALUES
('owner',  '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Christine De Chavez', 'owner'),
('coowner','$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Jessica Hernandez',   'co_owner'),
('staff',  '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Niur Rayne Marasigan','staff');

-- Product Categories
CREATE TABLE categories (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(60)  NOT NULL UNIQUE,
  slug        VARCHAR(60)  NOT NULL UNIQUE,
  sort_order  SMALLINT     NOT NULL DEFAULT 0,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB;

INSERT INTO categories (name, slug, sort_order) VALUES
('Classic', 'classic', 1),
('Creamcheese Series', 'creamcheese', 2),
('Creampuff Series', 'creampuff', 3),
('Cheesecake Series', 'cheesecake', 4),
('House Specialties', 'house', 5),
('Salty Cream Series', 'salty', 6),
('Fruitea', 'fruitea', 7),
('Summer Drinks', 'summer', 8),
('Frappe', 'frappe', 9),
('Cold Brew Series', 'coldbrew', 10),
('Latte Series', 'latte', 11),
('Dirty Milk Series', 'dirty', 12),
('Snacks', 'snacks', 13),
('Rice Meals', 'rice', 14),
('Add-ons / Sinkers', 'sinkers', 15);

-- Products
CREATE TABLE products (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_id   INT UNSIGNED NOT NULL,
  name          VARCHAR(120) NOT NULL,
  description   VARCHAR(255) NULL,
  is_bestseller TINYINT(1)   NOT NULL DEFAULT 0,
  is_favorite   TINYINT(1)   NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB;

-- Product Prices (M / L / XL / REG)
CREATE TABLE product_prices (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id  INT UNSIGNED NOT NULL,
  size_code   ENUM('M','L','XL','REG') NOT NULL,
  price       DECIMAL(8,2) NOT NULL,
  UNIQUE KEY uk_product_size (product_id, size_code),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Ingredients / Inventory Items
CREATE TABLE ingredients (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(80)  NOT NULL UNIQUE,
  unit            VARCHAR(20)  NOT NULL DEFAULT 'pcs',  -- pcs, ml, g, packs
  current_stock   DECIMAL(10,2) NOT NULL DEFAULT 0,
  min_stock       DECIMAL(10,2) NOT NULL DEFAULT 10,
  expiry_date     DATE         NULL,
  last_updated    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Recipes (product → ingredients used)
CREATE TABLE recipes (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id      INT UNSIGNED NOT NULL,
  ingredient_id   INT UNSIGNED NOT NULL,
  quantity_used   DECIMAL(8,3) NOT NULL,   -- per unit sold
  UNIQUE KEY uk_recipe (product_id, ingredient_id),
  FOREIGN KEY (product_id)    REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
) ENGINE=InnoDB;

-- Sales Transactions
CREATE TABLE sales (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_no  VARCHAR(30)  NOT NULL UNIQUE,
  user_id         INT UNSIGNED NOT NULL,
  payment_method  ENUM('Cash','GCash','Other') NOT NULL,
  payment_ref     VARCHAR(40)  NULL,          -- GCash reference number
  subtotal        DECIMAL(10,2) NOT NULL,
  discount        DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_amount    DECIMAL(10,2) NOT NULL,
  status          ENUM('completed','voided','cancelled') NOT NULL DEFAULT 'completed',
  notes           VARCHAR(255) NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- Sale Line Items
CREATE TABLE sale_items (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sale_id         BIGINT UNSIGNED NOT NULL,
  product_id      INT UNSIGNED NOT NULL,
  product_name    VARCHAR(120) NOT NULL,   -- snapshot
  size_code       VARCHAR(10)  NOT NULL,
  unit_price      DECIMAL(8,2) NOT NULL,
  quantity        SMALLINT     NOT NULL,
  line_total      DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (sale_id)    REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

-- Inventory Adjustments / Stock Logs
CREATE TABLE stock_logs (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ingredient_id   INT UNSIGNED NOT NULL,
  change_qty      DECIMAL(10,2) NOT NULL,  -- negative = deduction
  reason          ENUM('sale','restock','adjustment','waste','expiry') NOT NULL,
  reference_id    BIGINT UNSIGNED NULL,    -- sale_id if from sale
  user_id         INT UNSIGNED NOT NULL,
  notes           VARCHAR(255) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id),
  FOREIGN KEY (user_id)       REFERENCES users(id)
) ENGINE=InnoDB;

-- Indexes for performance
CREATE INDEX idx_sales_created   ON sales(created_at);
CREATE INDEX idx_sales_user      ON sales(user_id);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_stock_logs_ing  ON stock_logs(ingredient_id);

-- View: Low stock items
CREATE OR REPLACE VIEW v_low_stock AS
SELECT id, name, unit, current_stock, min_stock, expiry_date
FROM ingredients
WHERE current_stock <= min_stock
ORDER BY current_stock ASC;

-- View: Daily sales summary
CREATE OR REPLACE VIEW v_daily_sales AS
SELECT 
  DATE(created_at) AS sale_date,
  COUNT(*)         AS transactions,
  SUM(total_amount) AS revenue
FROM sales
WHERE status = 'completed'
GROUP BY DATE(created_at)
ORDER BY sale_date DESC;
