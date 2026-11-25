# Put AnneTea BrewTrack online (phones, tablets and laptops at the same time)

When you finish, the shop has **one link** (like `https://annetea-brewtrack.onrender.com`).
Every device opens that link and they all share the same sales, stock, recipes and accounts.

You need 4 free accounts. Sign up to each one **with your GitHub account** to make it faster:

| Service | What it does | Needed? |
|---|---|---|
| **GitHub** | holds the app files | yes |
| **Neon** | free database: keeps the data safe | yes |
| **Render** | runs the app and gives you the link | yes |
| **Brevo** | sends the "forgot password" codes by email | only if you want forgot-password emails |

> Why not Gmail for the codes? Free hosting (Render) blocks Gmail's email port, so the online app sends email through Brevo instead. Your Gmail address can still be the sender.

---

## Step 1: Put the files on GitHub

1. Unzip **anne-tea-brewtrack-online.zip** on your computer. You get a folder called `anne-tea-brewtrack`.
2. Go to **github.com** and sign in.
3. Click the **+** at the top right, then **New repository**.
   - Repository name: `annetea-brewtrack`
   - Choose **Private** (recommended: the code contains the starting demo passwords).
   - Do **not** tick "Add a README".
   - Click **Create repository**.
4. On the next page, click the link **"uploading an existing file"**.
5. Open the `anne-tea-brewtrack` folder, select **everything inside it** (Ctrl+A), and drag it into the GitHub page.
   Drag the files that are inside the folder, not the folder itself. `server.py`, `index.html` and `render.yaml` must be at the top level.
6. Wait until every file is listed, then click **Commit changes**.

## Step 2: Make the free database (Neon)

1. Go to **neon.com** and click **Sign up**, then **Continue with GitHub**.
2. Create a project. Name: `annetea`. Region: **AWS Asia Pacific (Singapore)**. Click **Create**.
3. Click **Connect** (or "Connection string") and **copy** the text that starts with `postgresql://`.
   Keep it in Notepad for Step 4. This is a password, so don't share it.

## Step 3 (optional): Forgot-password emails (Brevo)

1. Go to **brevo.com** and make a free account.
2. Open **Senders, Domains & Dedicated IPs → Senders → Add a sender**. Use the Gmail address the codes should come from. Open the email Brevo sends you and confirm it.
3. Open **SMTP & API → API Keys → Generate a new API key**. Copy the key (it starts with `xkeysib-`) into Notepad.

## Step 4: Go live (Render)

1. Go to **render.com** and click **Get Started**, then sign up with **GitHub**.
2. Click **New +** → **Blueprint**.
3. Connect your GitHub, pick the **annetea-brewtrack** repository, and click **Connect**.
   Render reads the `render.yaml` file and asks for 4 values:
   - **SHOP_KEY**: make up a secret phrase, e.g. `AnneTea-Shop-2026!`. Every device types it once.
   - **DATABASE_URL**: paste the Neon `postgresql://...` text from Step 2.
   - **BREVO_API_KEY**: paste the Brevo key from Step 3 (leave it empty if you skipped Step 3).
   - **MAIL_FROM**: `AnneTea BrewTrack <the.sender.you.verified@gmail.com>` (leave it empty if you skipped Step 3).
4. Click **Apply**. Wait 2 to 5 minutes until the service says **Live**.
5. Click the service name. The link is at the top, e.g. **https://annetea-brewtrack.onrender.com**. That is the shop's link.

*If Render does not show "Blueprint" or asks for a card:* use **New + → Web Service** instead. Pick the repository, then set:
Language **Python 3**, Region **Singapore**, Instance type **Free**,
Build Command `pip install -r requirements.txt`,
Start Command `gunicorn server:app --workers 1 --threads 8 --timeout 60 --bind 0.0.0.0:$PORT`.
Then open **Environment** and add the same 4 values from Step 4.3.

## Step 5: Open it on every device

1. On each phone, tablet and laptop, open the link in Chrome or Safari.
2. The first time, it asks for the **shop key**. Type the SHOP_KEY from Step 4. Each device remembers it.
3. Log in as usual.
4. Phones and tablets: open the browser menu and tap **Add to Home screen**. It then opens like an app.

The camera (GCash proof, restock photos, face login) works online because the link is `https://`.

## Step 6: Do this right after it is live

- **Change all passwords.** The starting passwords (e.g. `Annetea@1`) are written in the code. Log in as owner, open **Manage → Accounts**: use **Change my password** for the owner and **Edit** on each other account to set a new password.
- Add an **email to each account** so forgot-password codes have somewhere to go.

---

## Good to know

- **First open of the day is slow.** The free Render server sleeps after 15 minutes with no use. The next visit wakes it in about a minute. After that it is fast. Your data is safe while it sleeps, because it is stored in Neon.
- **Changing the app later:** upload the changed files to the same GitHub repository (Add file → Upload files → Commit). Render updates the live app by itself in a few minutes.
- **Changing the shop key or email settings:** Render → your service → **Environment** → edit → **Save changes**.
- **Shop PC instead of online:** `python server.py` still works on the shop's Wi-Fi exactly like before (see README).
