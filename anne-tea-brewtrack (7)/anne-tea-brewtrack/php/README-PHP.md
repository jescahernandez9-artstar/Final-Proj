# AnneTea BrewTrack – PHP + MySQL Backend

**Production URL:** https://annetea.com

## Requirements
- PHP 8.0+
- MySQL 8 / MariaDB
- Apache or Nginx (or any web host that supports PHP)

## Setup on hosting (.com domain)

1. Upload the project files to your hosting (public_html or www folder).

2. Create the database in cPanel / hosting panel, then import:
```bash
mysql -u your_user -p annetea_brewtrack < schema.sql
```
Or use phpMyAdmin → Import → `schema.sql`.

3. Edit `php/config.php`:
- Set `DB_USER` and `DB_PASS` to your hosting database credentials
- `APP_URL` is already set to `https://annetea.com`

4. Open the system:
```
https://annetea.com/
```

## Local testing (optional)

If you test on your PC first (XAMPP / Laragon), you can temporarily use a local path, but for submission and defense use the **.com** URL.

## API base (frontend)

```js
const API_BASE = 'https://annetea.com/php/api';
```

## API Endpoints

| Method | Endpoint              | Auth | Description                |
|--------|-----------------------|------|----------------------------|
| POST   | /php/api/login.php    | No   | Returns token              |
| GET    | /php/api/sales.php    | Yes  | Today's sales              |
| POST   | /php/api/sales.php    | Yes  | Create sale + deduct stock |
| GET    | /php/api/inventory.php| Yes  | Current stock levels       |
| POST   | /php/api/inventory.php| Yes  | Restock / adjust           |
| GET    | /php/api/products.php | Yes  | Categories + products      |
| POST   | /php/api/products.php | Owner| Create / update product    |
| GET    | /php/api/stock_logs.php | Yes | Adjustment history       |

Authenticated requests need:
```
Authorization: Bearer <token>
```

## Default users (password = 1234)

- owner
- coowner  
- staff

> On production, change passwords and regenerate bcrypt hashes with `password_hash('yourpass', PASSWORD_DEFAULT)`.
