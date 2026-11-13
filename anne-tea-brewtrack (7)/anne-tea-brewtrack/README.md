# AnneTea BrewTrack POS

**Sales & Inventory Management System** for AnneTea  
**Live URL:** https://annetea.com  
Sitio Trangka, Pinagsibaan, Rosario, Batangas

IT 312 – System Integration and Architecture  
De Chavez · Hernandez · Marasigan · BSIT SM 3102

---

## Latest improvements (Nov 2026)

- **GCash payment** – QR-style modal, unique reference number, confirm flow, receipt shows GCash ref
- **Secure login** – SHA-256 password check, max 5 failed attempts → 2-minute lockout, session token (8h)
- **Light & Dark mode** – toggle button (bottom-right), preference saved
- **UI/UX** – toast notifications, password show/hide, smoother buttons, themed panels
- **Database** – `payment_ref` column on sales for GCash tracking



## Features

### POS (McDonald’s-style cashier)
- Category sidebar + large product buttons
- Size selection (M / L / XL / REG)
- Live order ticket, Cash & GCash
- Void last item, printable thermal receipt
- Recipe-based automatic inventory deduction

### Owner Dashboard
- Today’s revenue, transactions, average ticket, low-stock count
- 7-day sales chart
- Best sellers ranking
- Recent transactions

### Management (Owner / Co-owner)
- **Products** – view catalog, add / edit products & prices
- **Restock** – add or remove stock with reason (restock / adjustment / waste)
- **Stock History** – full adjustment log with user & notes
- **Recipes** – view ingredient rules that drive auto-deduction

### Security
- SHA-256 password check (demo) + 8-hour session token
- Role-based screens (Staff = POS only)
- PHP backend uses bcrypt + signed tokens

### Database
- Complete MySQL schema (`schema.sql`)
- PHP API ready on https://annetea.com (`php/` folder)

---

## Quick start (no server)

1. Open folder `anne-tea-brewtrack`
2. Double-click `index.html` (Chrome / Edge recommended)

**Demo logins**

| User     | Password | Access              |
|----------|----------|---------------------|
| owner    | 1234     | Everything          |
| coowner  | 1234     | Dashboard + Manage  |
| staff    | 1234     | POS only            |

---

## PHP + MySQL setup

See `php/README-PHP.md` for full instructions.

```bash
mysql -u root -p < schema.sql
# then point Apache to the php/ folder or the whole project
```

---

## File overview

```
anne-tea-brewtrack/
├── index.html          # Login · POS · Dashboard · Management
├── styles.css
├── app.js              # All client logic
├── logo.png
├── schema.sql          # Full MySQL schema
├── server.py           # Optional Flask starter
├── php/
│   ├── config.php
│   ├── api/
│   │   ├── login.php
│   │   ├── sales.php
│   │   ├── inventory.php
│   │   ├── products.php
│   │   └── stock_logs.php
│   └── README-PHP.md
└── README.md
```

---

## Next possible upgrades

- Real-time multi-terminal sync via WebSockets
- Expiry-date alerts with calendar view
- Export sales to CSV / Excel
- Customer display (second screen)
