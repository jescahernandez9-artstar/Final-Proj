# AnneTea BrewTrack POS

**Sales & Inventory Management System** for AnneTea  
**Live URL:** https://annetea.com  
Sitio Trangka, Pinagsibaan, Rosario, Batangas

IT 312 – System Integration and Architecture  
De Chavez · Hernandez · Marasigan · BSIT SM 3102

---

## Latest improvements (Nov 2026)

- **Identity verification (IT 312 final project)** – new accounts now require Valid ID + Face Recognition (see section below)
- **Face recognition sign-in** – after verification the user chooses password only, or password or face
- **Delete a verified ID** – the owner can delete it directly in Accounts; the identity's owner can delete it with face recognition + password
- **Forgot password** – a 6-digit code is emailed to the account's registered email (needs `server.py` + SMTP, see below)
- **GCash payment** – QR-style modal, unique reference number, confirm flow, receipt shows GCash ref
- **Secure login** – SHA-256 password check, max 5 failed attempts → 2-minute lockout, session token (8h)
- **Light & Dark mode** – toggle button (bottom-right), preference saved
- **UI/UX** – toast notifications, password show/hide, smoother buttons, themed panels
- **Database** – `payment_ref` column on sales for GCash tracking



## UI/UX refresh (v2)

- New warm matcha / cream / brown-sugar design system (light + dark), higher contrast, consistent spacing
- Icon-based top bar with theme toggle on every screen; Stock button shows a low-stock count badge
- Product cards with category icons, size-price chips and "BEST" badges
- Order ticket: +/– quantity steppers, remove line, **Undo** for removed lines and cleared orders, live item count
- Cash payment: quick bill buttons (₱20–₱1000); Cash / GCash disabled when the order is empty
- Calmer alert banners that push content down (no flashing); toasts moved to the bottom with icons
- Dashboard KPI icons, best-seller bars, theme-aware chart with ₱ axis, Cash/GCash pills in tables
- Tablet portrait / phone layout: category chips on top, order ticket as a bottom sheet
- Esc / tap-outside closes dialogs (payment dialogs excluded), visible keyboard focus, reduced-motion support

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
├── menu-seed.js        # Menu, recipes and ingredients from RECIPES LIST.xlsx (starting data)
├── styles.css
├── app.js              # All client logic
├── idv.js              # Identity verification flow (UI, camera, OCR, face match, gating)
├── idv-parser.js       # ID text parsing + completeness checks (pure functions)
├── face-auth.js        # Face sign-in, "My ID" settings, delete verified ID (owner / self)
├── stock-menu.js       # Saved menu + recipes, ingredient rules, restock/adjust, photo capture, notifications
├── stock-menu.css      # Styles for the above
├── .env.example        # Email (SMTP) settings for password-reset codes
├── idv.css             # Identity verification styles
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


## Multi-device (shared transactions)

Opening `index.html` as a file only stores data **on that device**.

To share sales between laptop and tablet:

1. On the main PC install Python, then:
   ```bash
   pip install flask flask-cors
   python server.py
   ```
2. Find the PC’s LAN IP (e.g. 192.168.1.10)
3. On every device open: `http://192.168.1.10:5000`
4. Login — all devices now share sales, stock, and history


## Password policy
8–15 characters with uppercase, lowercase, number, and special symbol.
Default demo password: **Annetea@1**


---

## Integrated Identity Verification (Valid ID + Face Recognition)

**Where:** *Manage → Accounts → “+ Add Account (verify ID)”*. A new Staff / Co-owner / Owner account can
**only** be created after the full verification succeeds. The old “add account” form no longer creates accounts.

### Workflow (enforced in this order)

`ID Upload → ID Scanning → Face Registration → Face Matching → Personal Information → Final Verification`

| # | Requirement | How it is implemented |
|---|---|---|
| 1 | Valid ID upload, supported types shown | Step 1 lists Philippine National ID, Driver’s License, Passport, UMID; JPG/PNG/WEBP only; image-quality check (size, brightness, blur) |
| 2 | OCR + completeness check + notification | Tesseract.js reads the ID; `idv-parser.js` extracts Full Name, DOB, Address, ID Number, Expiration; required fields differ per ID type; “scanned successfully” or “needs to be submitted again” with reasons; expired IDs rejected |
| 3 | Face registration with on-screen guidance | Camera opens only after a successful scan. Guided, auto-captured steps: look straight, left, right, move closer, move farther. Live checks for *entire face visible*, *proper lighting*, one person only |
| 4 | Face ↔ ID photo matching | face-api.js 128-d descriptors; ID portrait vs. frontal captures (best distance ≤ 0.55 and median ≤ 0.60). Match / no-match notification; unclear captures can be repeated (3 attempts) |
| 5 | Personal information interface | Locked unless ID scan **and** face match passed. Name, DOB, **age (auto-calculated)**, address, ID number (and expiry) are auto-filled and editable for review; edits are logged |
| 6 | Final result + saved record | Success / failure screen; record saved (also for failed attempts) and listed under *Identity verification records* |

**Handled failures:** unreadable/blurry/dark image, wrong ID type, missing fields, expired ID, no portrait found on the ID,
camera denied/not found, unmatched face, duplicate use of the same ID. Retry options for both ID upload (3 tries) and face capture (3 tries).

### Setup notes
- Works by opening `index.html` in **Chrome/Edge** (or via `server.py`). The OCR/face libraries and models load from the jsDelivr CDN, so the **first run needs internet**.
- The camera needs a secure origin: `https://`, `http://localhost`, or `file://`. On another device over `http://192.168.x.x:5000` the browser will block the camera — use https or run it on the same PC.
- First scan is slower (downloads ~10 MB of OCR/face model data); later scans are faster.
- Use **sample / synthetic IDs and consenting people only** for testing and demos.

### Data privacy
- Consent checkbox is required before upload (it now also covers the saved face template).
- The ID photo and camera frames are processed **in memory on the device and never saved or uploaded**.
- Saved with the account: a **face template** (numeric descriptors from the live captures, not photos). It is used for face sign-in and to confirm the person before they delete their own ID.
- Saved in the verification record: result, ID type, **masked** ID number, SHA-256 hash (to stop one ID being used twice), name/DOB/address, scores and timestamps (see `identity_verifications` in `schema.sql`).
- **Deleting a verified ID** erases the ID details, the ID-number hash and the face template, turns face sign-in off, and keeps only an audit stub (who deleted it, when, and how). The account itself stays and can still sign in with its password.

### Limitations (also shown in the app on the result screen)
- Successful OCR and a face match **do not prove an ID is authentic**. Holograms, security features and the issuing agency’s database are not checked, so a forged or edited ID could pass.
- No liveness detection. Multi-pose capture makes simple photo spoofing harder but does not stop a determined attempt (e.g. a replayed video).
- OCR accuracy depends on photo quality, glare and card layout; face matching is affected by lighting, glasses, and how old the ID photo is. Always review the auto-filled data.
- Everything runs client-side, so it can be tampered with by someone with technical access. A production system should repeat the checks on a server and use a trusted verification source.


---

## Face sign-in, deleting a verified ID, and password-reset email

### 1. Choosing face recognition (after verification)
At the end of **Identity verification** the user must pick how they sign in: **Password only**, or **Password or face recognition**. They can change it any time under **My ID** (top bar; password required to confirm).
On the login screen: type the username, then tap **Sign in with face recognition**. The camera checks that face against **that account only** (1:1), needs 3 matching frames, then asks for a random head turn (left or right) as a basic anti-photo check. 5 failed face attempts lock face sign-in for that username for 2 minutes (the password still works).

### 2. Deleting a verified ID
| Who | Where | What is needed |
|---|---|---|
| **Owner** | Manage > Accounts > **Delete ID** | Direct delete (confirmation only) |
| **The identity's owner (any role)** | Top bar > **My ID** > *Delete my verified ID* | **Password + live face check**, then a final confirm |

Co-owners and staff cannot delete someone else's ID. After deletion the account shows "ID deleted"; the user (or the owner, via **Verify ID**) can verify again.
If an account was verified before this update it has no saved face template, so only the owner can delete that ID.

### 3. Forgot password: code sent to the registered email
Login screen > **Forgot password?** > enter the username > the server emails a 6-digit code (valid 10 minutes, 5 tries, 3 requests per 15 minutes) to the **email registered on that account** > enter the code and a new password.
The code is **never shown on screen**, and the reply is the same whether or not the username exists.
This needs `server.py` running (open the site through `http://localhost:5000`, not by double-clicking `index.html`) and email settings:

```bash
# Gmail: turn on 2-Step Verification, then create an App password
#   https://myaccount.google.com/apppasswords
set SMTP_USER=your.annetea.sender@gmail.com        # Windows (use `export` on Mac/Linux)
set SMTP_PASS=xxxxxxxxxxxxxxxx                      # the 16-character app password
python server.py
```
Other optional settings are in `.env.example` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_FROM`). Without them the page says the server cannot send email yet. For classroom testing only, `set DEV_PRINT_CODE=1` prints the code in the server window instead of emailing it.
Make sure each account has a registered Gmail (Manage > Accounts > Edit, or the Gmail field when verifying).

### Other fixes in this version
- Account changes (add, edit, delete, password, face-login choice) are now pushed to the shared server, so the 15-second sync no longer undoes them.
- The **Sign In** button no longer stays stuck on "Signing in..." after you log out.

### Honest limitations of the face features
- Face matching runs in the browser, so someone with technical access could tamper with it. A production system should compare faces on the server.
- The head-turn check is basic and is not a full liveness test; a determined attacker with a video could try to fool it. Face sign-in therefore never replaces the password: it is an optional extra, and you can switch it off.
- Face templates are biometric data: keep `shared_data.json` and the browser data private, and get consent from every user.
- The PHP folder was not changed; the front end talks to `server.py`.


---

## Menu, recipes and stock (latest update)

### What was static before, and what is saved now
| Item | Before | Now |
|---|---|---|
| Menu products | Hard-coded list. New products vanished from the POS after a refresh; deleted built-in products came back | **Saved catalog** (browser + shared server). Add / edit / delete survive refresh and sync between devices |
| Categories | Hard-coded | Add, rename, delete (only when empty) |
| Recipes | 5 fixed rules guessed from product names (fries even used Pearl) | **One recipe per product**, edited in the product form or Recipes tab |
| Ordering | Allowed even with zero stock | **Blocked** when any recipe ingredient is short (see below) |
| Ingredients / inventory | Saved | Saved (now with search, rename, no duplicates) |
| Accounts | Saved | Saved (create goes through ID verification) |

### CRUD coverage
Products, categories, recipes, inventory ingredients and accounts all support Create / Read / Update / Delete, with **Undo** after deleting a product, category or ingredient, after a stock change, and after voiding the last order line. Completed sales are create/read only on purpose (they are accounting records).

### Out-of-stock rule
A product shows **Out of stock · <ingredient>** and cannot be added when any ingredient in its recipe is below the amount one serving needs. The order is also checked when you add a second cup, raise a quantity, press Cash/GCash, and again when the sale is saved. Products with no recipe are never blocked.

### Restock / manual adjustment
Reason: **Delivery** (adds stock, expiration date required) · **Manual adjustment** (choose Add or Remove; a note is required; adding stock needs an expiration date) · **Waste** (removes stock; no expiration date). The form shows "Pearl: 10 → 15" before you save, will not let stock go below zero, and has a **Clear** button.

### No duplicate ingredients
Typing "pearl", "Pearls" or " PEARL " resolves to the ingredient already saved as "Pearl" and the add/remove is applied to that one. Unknown names are refused (add them first in Stock), and adding an item whose name already exists is blocked. Renaming an ingredient updates every recipe that uses it. The ingredient fields are type-to-search lists.

### GCash proof photo
Choose a **file** or **open the camera** (also used for restock proof photos).

### Notifications
Messages no longer disappear on a timer. Routine messages clear on your next click; errors and Undo messages stay until you tap ×; "Dismiss all" appears when several are showing. Turn the timer back on in **My ID → Notifications**.


---

## Update: undo, sale voids, per-item low-stock levels (Nov 24, 2026)

### Undo everywhere
- New **Undo** button in the POS and Management top bars (also **Ctrl+Z** when you are not typing in a field). It undoes the last action even after its message was closed; the last 20 actions are kept until logout.
- Undo now covers: completed sale (**Undo sale** puts the items back on the ticket and the ingredients back in stock), product add / edit / delete, category add / rename / delete / sugar setting, inventory item add / edit / rename / remove, restock and adjustments, removed GCash photo, account delete, and order lines.
- Undoing a restock now reverses only that change, so sales made in between are not lost.

### Void a sale (Owner / Co-owner)
History → **Void** on any sale: its ingredients go back into stock (logged as *Sale voided*), it is left out of Dashboard / Today totals and shown struck through. **Restore** re-applies it if there is enough stock. Each sale now records the exact ingredients it used.

### Expiration date rules
| Reason | Expiration date |
|---|---|
| Delivery | Required (cannot be in the past) |
| Manual adjustment (add **or** remove) | Required; filled in with the saved date so you only confirm it |
| Waste / spoilage | Not asked |

### Searchable ingredients
Restock, recipe rows and the inventory list use a type-to-search picker that shows each ingredient's stock (works on phones and tablets, unlike the old browser list). Typing a new item name that already exists ("pearl", "PEARLS") shows "Pearl is already in the inventory" with a button to adjust Pearl instead.

### Things that were hard-coded and are now saved settings
- **Low-stock level per ingredient** (Stock → Edit → *Low-stock alert at*; default 12). Banner, badge, Dashboard and the Stock list use it.
- **Which categories ask for a sugar level** (🍬 on each category chip; new categories have a checkbox).
- The unused fixed recipe table was removed; recipes come only from each product.
- Still fixed in code on purpose: store name/address/TIN base on receipts and the demo accounts' first-run defaults.

### GCash proof photo
**Choose file** or **Open camera**. When the live camera is not allowed (for example a tablet opening `http://192.168.x.x:5000`), Open camera now opens the tablet's own camera app instead of failing. Photos are shrunk to a small JPEG, and if browser storage fills up the oldest proof photos are dropped instead of losing the sale.

### Other fixes
- The × on notifications did not close them before; it does now.
- Clear buttons added to the product form and the inventory item form (in Edit, Clear goes back to the saved values).
- Removed a duplicate `restockMsg` element. `server.py` now also stores the per-item low-stock levels.

---

## Update: verified ID, face sign-in and reset-code email (Nov 24, 2026, part 2)

### Sign-in screen: Password or Face recognition
A switch at the top of the login card picks the method (remembered on that device). In **Face recognition** mode the password box is hidden: type the username and tap **Sign in with face recognition** (or press Enter). The camera compares the face with the face saved when that account's ID was verified (1:1, plus a head-turn check). Under the username it says whether face sign-in is on for that account.

### Choosing face sign-in after verification
The last step of identity verification makes the user pick **Password only** or **Password or face recognition**. They can change it later in **My ID** (password needed to confirm).

### Deleting a verified ID
- **Owner:** Manage → Accounts → **Delete ID** (confirmation only).
- **The person on the ID:** My ID → *Delete my verified ID* → password, then a live face check, then a final confirm.
Deleting erases the ID details and face data and turns face sign-in off. The account stays and works with its password.

### Password-reset code by email: what you need to fill in
1. Copy `.env.example` to a new file named **`.env`** in the same folder as `server.py`.
2. Fill in **SMTP_USER** (the Gmail that sends the codes) and **SMTP_PASS** (a Gmail *App password*: turn on 2-Step Verification, then create one at https://myaccount.google.com/apppasswords). The other lines can stay as they are.
3. Start `python server.py`. The window shows `Password-reset email: ON` when the settings are found.
4. Optional check: `python server.py --test-email your.own@gmail.com` sends a test message.
5. Make sure each account has its Gmail filled in (Manage → Accounts → Edit). The code goes only to that registered address and is never shown on screen.

If email is not set up, the Forgot password window now says so before anyone tries. Never share or upload your `.env` file.

### Server fix
`server.py` now saves `shared_data.json` safely when two devices save at the same moment. Before, this could make the server fail to read the file for a moment.


---

## Update: menu and recipes from "RECIPES LIST.xlsx" (Nov 24, 2026, part 3)

- The old built-in menu was replaced by the 99 products in the recipe list (14 drink/food categories plus the Add-ons). **Summer Drinks** was removed; a new **Meiji** category was added. Starting data lives in `menu-seed.js`.
- **Recipes are per size now.** Each ingredient can have a different amount for Medium, Large and 1 Liter (shown as XL). Selling a Large deducts the Large amounts; a size that cannot be made is greyed out in the size picker. In Manage → Products → Edit, each ingredient row has one amount box per size the product is sold in.
- **Units.** Every ingredient has a unit (ml, scoop, pcs, shot, sachet, tsp, portion) shown in Stock, Restock, recipes and the out-of-stock messages. Low-stock levels were set per unit (for example 1000 ml, 20 scoops).
- **Not counted as stock:** Ice, Hot/Cold Water and Water.
- **Existing installs** switch to the new menu automatically the first time they open this version. Stock you already had is kept and renamed where it matches (Pearl → Tapioca Pearls, Creamcheese → Cream Cheese, Whipped Cream → Whipping Cream); the old demo ingredients no recipe uses (Milk, Tea Base, Mango, …) are removed and the removal is written to Stock History. Ingredients you added yourself are kept. New ingredients start with **demo stock** (5000 ml / 200 scoops / 100 pcs / 50 portions): do a manual adjustment to enter the real counts. A shared `server.py` gets the new menu from the first updated device, and its sales are kept.

---

## Update: 1-liter size and order-time choices (Nov 24, 2026, part 4)

- **XL is shown as 1L** everywhere (size picker, ticket, receipts, product list and form). Saved sales keep the code `XL`.
- **Old prices kept**, including the 1L price, for every drink that had one before. Frappe, Cold Brew and Meiji have no 1L (they had none before).
- **Estimated 1L recipes.** The recipe list only gives 1-liter amounts for Dirty Milk and Latte. For the other drinks the 1L amount is **twice the Large amount** (ml rounded to 5, scoops to 0.5), e.g. Plain Milk Tea 1L = 600 ml Black Tea, 6 scoops Creamer, 80 ml Sugar Syrup, 2 scoops Tapioca Pearls. Change any of them in Manage → Products → Edit (the 1L boxes).
- **Choices when ordering.** Rice meals ask *Java Rice or Garlic Rice*, the nuggets ask for a dip (*Ketchup, Cheese Dip, BBQ Dip, Mayo*), and the burger asks for a side (*Fries or Nacho Chips*). The pick shows on the ticket and both receipts and is deducted from stock (1 each); a choice that is out of stock cannot be picked. Edit them in the product form under "Choices when ordering" (one line per choice, e.g. `Rice: Java Rice, Garlic Rice`).
- Opening this version replaces the menu from the previous update again (same automatic switch as before).

## Update (v7, Nov 25)
- **Restock:** the **Add quantity** and **Remove quantity** boxes are back side by side (green / red). The stock changes by Add − Remove. Waste only uses Remove. Expiry rules are the same: required for Delivery and Manual adjustment, not for Waste.
- **UI/UX polish** (`ui-polish.css`, loaded last, look only): restock form as a two-column card, Recipes tab shows ingredients as wrapping chips (no sideways scrolling), Inventory window wide enough to show Status and Adjust/Edit/Remove, Manage pages centred on wide screens with sticky tabs, phone top bar no longer overlaps, clearer keyboard focus, row hover in tables.

## Online version (Nov 25)
See **DEPLOY.md** for the step-by-step guide (GitHub → Neon database → Render).
- `server.py` now also runs online with `gunicorn server:app`: port from `PORT`, data in Postgres when `DATABASE_URL` is set (otherwise `shared_data.json` as before).
- `SHOP_KEY`: when set, each device types the shop key once (`shop-key.js`) before it can read or save shop data.
- Password-reset email online uses Brevo (`BREVO_API_KEY`, `MAIL_FROM`) because free hosts block Gmail SMTP. Gmail SMTP still works on the shop PC.
- The server only serves the page files (html/js/css/images). `.env`, `server.py`, `shared_data.json`, `schema.sql`, `php/` are never downloadable.
