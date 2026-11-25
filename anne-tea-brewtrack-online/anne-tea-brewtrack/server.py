"""
AnneTea BrewTrack - Shared backend for multi-device use
Run on the main PC:  python server.py
Then on laptop/tablet open:  http://THIS-PC-IP:5000
All devices share the same sales, inventory, and history.

Online (Render, see DEPLOY.md): started by  gunicorn server:app  with these environment variables:
  SHOP_KEY       password every device types once before it can read or save shop data
  DATABASE_URL   free Postgres (e.g. Neon) so data is kept when the free server sleeps or restarts
  BREVO_API_KEY + MAIL_FROM   password-reset emails over HTTPS (free hosts block Gmail SMTP)
"""
from flask import Flask, request, jsonify, send_from_directory, abort
import hashlib, hmac, json, os, re, secrets, smtplib, ssl, threading, time, urllib.request, urllib.error
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path

try:
    from flask_cors import CORS
except ImportError:
    CORS = None

ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / 'shared_data.json'

def load_env_file(path):
    """Read NAME=value lines from .env next to server.py (no extra packages needed).
    Values already set in the real environment win."""
    if not path.exists():
        return False
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        name, value = line.split('=', 1)
        name, value = name.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        if name and name not in os.environ:
            os.environ[name] = value
    return True

ENV_LOADED = load_env_file(ROOT / '.env')
app = Flask(__name__, static_folder=None)
if CORS:
    CORS(app)

DEFAULT = {
    "sales": [],
    "inventory": None,
    "stock_logs": [],
    "accounts": None,
    "catalog": None,
    "ingredient_expiry": {},
    "ingredient_min": {},
    "ingredient_unit": {},
    "product_expiry": {},
    "custom_products": [],
    "verifications": []
}

DATA_LOCK = threading.RLock()   # one writer at a time: devices save sales/stock at the same moment

def locked(fn):
    from functools import wraps
    @wraps(fn)
    def inner(*a, **k):
        with DATA_LOCK:
            return fn(*a, **k)
    return inner

# ---------------------------------------------------------------------------
# STORAGE: Postgres when DATABASE_URL is set (online), otherwise shared_data.json (shop PC)
# ---------------------------------------------------------------------------
DATABASE_URL = os.environ.get('DATABASE_URL', '').strip()
_pg = None

def _db():
    global _pg
    import psycopg2
    if _pg is None or _pg.closed:
        _pg = psycopg2.connect(DATABASE_URL, connect_timeout=15)
        _pg.autocommit = True
        with _pg.cursor() as c:
            c.execute('CREATE TABLE IF NOT EXISTS brewtrack_state (id INT PRIMARY KEY, data TEXT NOT NULL, updated TIMESTAMPTZ DEFAULT now())')
    return _pg

def _db_run(fn):
    """Run fn(cursor); reconnect once if the database dropped the idle connection (free databases sleep)."""
    with DATA_LOCK:
        for attempt in (1, 2):
            try:
                with _db().cursor() as c:
                    return fn(c)
            except Exception:
                global _pg
                try: _pg.close()
                except Exception: pass
                _pg = None
                if attempt == 2:
                    raise

def load_data():
    if DATABASE_URL:
        def get(c):
            c.execute('SELECT data FROM brewtrack_state WHERE id = 1'); return c.fetchone()
        row = _db_run(get)
        data = json.loads(row[0]) if row else {}
        for k, v in DEFAULT.items():
            data.setdefault(k, json.loads(json.dumps(v)))
        return data
    if DATA_FILE.exists():
        with DATA_LOCK, open(DATA_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        for k, v in DEFAULT.items():
            data.setdefault(k, v)
        return data
    return dict(DEFAULT)

def save_data(data):
    if DATABASE_URL:
        txt = json.dumps(data, ensure_ascii=False)
        _db_run(lambda c: c.execute('INSERT INTO brewtrack_state (id, data, updated) VALUES (1, %s, now()) '
                                    'ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated = now()', (txt,)))
        return
    # write to a temp file, then swap it in, so a reader never sees a half-written file
    tmp = DATA_FILE.with_suffix('.tmp')
    with DATA_LOCK:
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, DATA_FILE)

# ---------------------------------------------------------------------------
# Only the app's own page files are served. server.py, .env, shared_data.json, schema.sql, php/ ... are never sent.
# ---------------------------------------------------------------------------
STATIC_OK = {'.html', '.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.webp', '.gif', '.woff', '.woff2'}

@app.route('/')
def index():
    return send_from_directory(ROOT, 'index.html')

@app.route('/<path:name>')
def static_files(name):
    p = Path(name)
    if name.startswith('api/') or any(part.startswith('.') for part in p.parts) or len(p.parts) != 1 or p.suffix.lower() not in STATIC_OK:
        abort(404)
    return send_from_directory(ROOT, name)

# ---------------------------------------------------------------------------
# SHOP KEY: when SHOP_KEY is set, every /api/ call must send it (header X-Shop-Key).
# Each device asks for it once and remembers it. Without it the shop data cannot be read or changed.
# ---------------------------------------------------------------------------
SHOP_KEY = os.environ.get('SHOP_KEY', '').strip()

@app.before_request
def require_shop_key():
    if not SHOP_KEY or not request.path.startswith('/api/') or request.path == '/api/health':
        return None
    sent = request.headers.get('X-Shop-Key', '')
    if not hmac.compare_digest(sent.encode('utf-8'), SHOP_KEY.encode('utf-8')):
        return jsonify({"ok": False, "error": "shop_key_required"}), 401
    return None

@app.route('/api/key-check')
def key_check():
    return jsonify({"ok": True})

@app.route('/api/health')
def health():
    return jsonify({"ok": True, "shared": True, "needs_key": bool(SHOP_KEY), "storage": "database" if DATABASE_URL else "file"})

@app.route('/api/state', methods=['GET'])
def get_state():
    """Full shared state for clients"""
    return jsonify(load_data())

@app.route('/api/state', methods=['POST'])
@locked
def post_state():
    """Merge client keys into shared store"""
    body = request.json or {}
    db = load_data()
    for key in ('sales', 'inventory', 'stock_logs', 'accounts',
                'ingredient_expiry', 'ingredient_min', 'ingredient_unit', 'product_expiry', 'custom_products'):
        if key in body and body[key] is not None:
            db[key] = body[key]
    cat = body.get('catalog')       # products + categories + recipes (validated shape only)
    if isinstance(cat, dict) and isinstance(cat.get('categories'), list) and isinstance(cat.get('menu'), dict):
        db['catalog'] = cat
    # identity-verification records are merged by id so devices never erase each other's records
    if isinstance(body.get('verifications'), list):
        by_id = {v.get('id'): v for v in db['verifications']}
        for v in body['verifications']:
            old = by_id.get(v.get('id'))
            if old is None:
                db['verifications'].append(v); by_id[v.get('id')] = v
            elif v.get('status') == 'deleted' and old.get('status') != 'deleted':   # a deletion always wins
                db['verifications'][db['verifications'].index(old)] = v; by_id[v.get('id')] = v
        db['verifications'].sort(key=lambda v: v.get('time', ''), reverse=True)
        db['verifications'] = db['verifications'][:500]
    save_data(db)
    return jsonify({"ok": True})

@app.route('/api/sales', methods=['GET'])
def get_sales():
    return jsonify(load_data().get('sales', []))

@app.route('/api/sales', methods=['POST'])
@locked
def post_sale():
    db = load_data()
    sale = request.json or {}
    if not sale.get('id'):
        sale['id'] = int(datetime.now().timestamp() * 1000)
    if not sale.get('time'):
        sale['time'] = datetime.now().isoformat()
    # avoid duplicates
    ids = {s.get('id') for s in db['sales']}
    if sale['id'] not in ids:
        db['sales'].append(sale)
        save_data(db)
    return jsonify({"ok": True, "sale": sale})

@app.route('/api/verifications', methods=['GET'])
def get_verifications():
    """Identity verification records (masked ID numbers only - no ID photos; face templates live on the account, never in these records)"""
    return jsonify(load_data().get('verifications', []))

@app.route('/api/verifications', methods=['POST'])
@locked
def post_verification():
    db = load_data()
    rec = request.json or {}
    if not rec.get('id') or rec.get('status') not in ('verified', 'failed', 'deleted'):
        return jsonify({"ok": False, "error": "invalid record"}), 400
    # never accept images / raw biometric data, even if a client sends them
    for banned in ('image', 'photo', 'face', 'descriptor', 'descriptors'):
        rec.pop(banned, None)
    if rec['id'] not in {v.get('id') for v in db['verifications']}:
        db['verifications'].insert(0, rec)
        db['verifications'] = db['verifications'][:500]
        save_data(db)
    return jsonify({"ok": True})

# ---------------------------------------------------------------------------
# FORGOT PASSWORD - the 6-digit code is emailed to the address registered on the account.
# Configure SMTP with environment variables (see README):
#   SMTP_HOST (default smtp.gmail.com)  SMTP_PORT (587)  SMTP_USER  SMTP_PASS  SMTP_FROM
#   SMTP_SECURITY = starttls (default) | ssl | none
# The code is never returned to the browser. DEV_PRINT_CODE=1 prints it in THIS console when SMTP is not set up.
# ---------------------------------------------------------------------------
RESETS = {}      # username -> {hash, salt, expires, tries}
RATE = {}        # ('u'|'ip', key) -> [timestamps]
RESET_LOCK = threading.Lock()
CODE_TTL = 600

class EmailNotConfigured(Exception):
    pass

def brevo_ready():
    return bool(os.environ.get('BREVO_API_KEY') and (os.environ.get('MAIL_FROM') or os.environ.get('SMTP_FROM')))

def email_ready():
    return brevo_ready() or smtp_ready()

def _parse_from(text):
    m = re.match(r'\s*(.*?)\s*<([^>]+)>\s*$', text or '')
    return (m.group(1) or 'AnneTea BrewTrack', m.group(2)) if m else ('AnneTea BrewTrack', (text or '').strip())

def send_via_brevo(to, subject, body):
    name, addr = _parse_from(os.environ.get('MAIL_FROM') or os.environ.get('SMTP_FROM'))
    payload = json.dumps({"sender": {"name": name, "email": addr}, "to": [{"email": to}],
                          "subject": subject, "textContent": body}).encode('utf-8')
    req = urllib.request.Request(os.environ.get('BREVO_API_URL', 'https://api.brevo.com/v3/smtp/email'), data=payload, method='POST',
                                 headers={'api-key': os.environ['BREVO_API_KEY'].strip(), 'Content-Type': 'application/json', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError('Brevo said %s: %s' % (e.code, e.read()[:300].decode('utf-8', 'replace')))

def smtp_ready():
    sec = os.environ.get('SMTP_SECURITY', 'starttls').lower()
    if sec == 'none':
        return bool(os.environ.get('SMTP_HOST'))
    return bool(os.environ.get('SMTP_USER') and os.environ.get('SMTP_PASS'))

def send_email(to, subject, body):
    if brevo_ready():
        return send_via_brevo(to, subject, body)
    if not smtp_ready():
        raise EmailNotConfigured()
    host = os.environ.get('SMTP_HOST', 'smtp.gmail.com'); port = int(os.environ.get('SMTP_PORT', 587))
    sec = os.environ.get('SMTP_SECURITY', 'starttls').lower()
    user = os.environ.get('SMTP_USER', '').strip()
    pw = os.environ.get('SMTP_PASS', '').replace(' ', '')   # Gmail shows app passwords as 'abcd efgh ijkl mnop'
    msg = EmailMessage()
    msg['Subject'] = subject; msg['To'] = to
    msg['From'] = os.environ.get('SMTP_FROM') or user or 'annetea-brewtrack@localhost'
    msg.set_content(body)
    if sec == 'ssl':
        smtp = smtplib.SMTP_SSL(host, port or 465, context=ssl.create_default_context(), timeout=20)
    else:
        smtp = smtplib.SMTP(host, port, timeout=20)
        if sec == 'starttls':
            smtp.starttls(context=ssl.create_default_context())
    try:
        if user and pw:
            smtp.login(user, pw)
        smtp.send_message(msg)
    finally:
        try: smtp.quit()
        except Exception: pass

def _hash_code(salt, code):
    return hashlib.sha256((salt + code).encode()).hexdigest()

@app.route('/api/forgot/status')
def forgot_status():
    """Lets the login page warn early when email is not set up (says nothing about any account)."""
    return jsonify({"email_ready": email_ready() or os.environ.get('DEV_PRINT_CODE') == '1'})

@app.route('/api/forgot/request', methods=['POST'])
def forgot_request():
    body = request.json or {}
    user = str(body.get('username', '')).strip().lower()
    if not user:
        return jsonify({"ok": False, "error": "Enter your username."}), 400
    dev = os.environ.get('DEV_PRINT_CODE') == '1'
    if not email_ready() and not dev:
        return jsonify({"ok": False, "error": "email_not_configured"}), 503
    now = time.time()
    with RESET_LOCK:
        for key in (('u', user), ('ip', request.remote_addr)):
            RATE[key] = [t for t in RATE.get(key, []) if now - t < 900]
        if len(RATE[('u', user)]) >= 3 or len(RATE[('ip', request.remote_addr)]) >= 10:
            return jsonify({"ok": False, "error": "Too many requests. Please wait a few minutes and try again."}), 429
        RATE[('u', user)].append(now); RATE[('ip', request.remote_addr)].append(now)
    acct = (load_data().get('accounts') or {}).get(user)
    email = str((acct or {}).get('email') or '').strip()
    if acct and email:           # same answer either way, so usernames cannot be probed
        code = '%06d' % secrets.randbelow(1000000)
        salt = secrets.token_hex(8)
        try:
            if email_ready():
                send_email(email, 'AnneTea BrewTrack password reset code',
                    'Your AnneTea BrewTrack password reset code is: %s\n\nIt expires in 10 minutes. '
                    'If you did not ask to reset your password, ignore this email - your password has not changed.' % code)
            else:
                print('[DEV_PRINT_CODE] reset code for %s (%s): %s' % (user, email, code))
        except Exception as e:
            print('[forgot] email failed:', repr(e))
            return jsonify({"ok": False, "error": "The email could not be sent. Check the server's email settings and try again."}), 502
        with RESET_LOCK:
            RESETS[user] = {"hash": _hash_code(salt, code), "salt": salt, "expires": now + CODE_TTL, "tries": 0}
    return jsonify({"ok": True})

@app.route('/api/forgot/confirm', methods=['POST'])
@locked
def forgot_confirm():
    body = request.json or {}
    user = str(body.get('username', '')).strip().lower()
    code = str(body.get('code', '')).strip()
    new_hash = str(body.get('newHash', '')).strip().lower()
    if not re.fullmatch(r'[0-9a-f]{64}', new_hash) or not re.fullmatch(r'\d{6}', code):
        return jsonify({"ok": False, "error": "Invalid request."}), 400
    with RESET_LOCK:
        rec = RESETS.get(user)
        if not rec or time.time() > rec['expires']:
            RESETS.pop(user, None)
            return jsonify({"ok": False, "error": "Code expired or not requested. Request a new code."}), 400
        rec['tries'] += 1
        if rec['tries'] > 5:
            RESETS.pop(user, None)
            return jsonify({"ok": False, "error": "Too many wrong codes. Request a new code."}), 429
        if not hmac.compare_digest(rec['hash'], _hash_code(rec['salt'], code)):
            return jsonify({"ok": False, "error": "Incorrect verification code."}), 400
        RESETS.pop(user, None)
    db = load_data()
    acct = (db.get('accounts') or {}).get(user)
    if not acct:
        return jsonify({"ok": False, "error": "Account not found."}), 404
    acct['pass'] = new_hash
    save_data(db)
    return jsonify({"ok": True})

@app.route('/api/inventory', methods=['GET', 'POST'])
@locked
def inventory_api():
    db = load_data()
    if request.method == 'POST':
        body = request.json or {}
        if isinstance(body.get('inventory'), dict):
            db['inventory'] = body['inventory']
        if isinstance(body.get('ingredient_expiry'), dict):
            db['ingredient_expiry'] = body['ingredient_expiry']
        if isinstance(body.get('ingredient_min'), dict):
            db['ingredient_min'] = body['ingredient_min']
        if isinstance(body.get('ingredient_unit'), dict):
            db['ingredient_unit'] = body['ingredient_unit']
        if isinstance(body.get('stock_logs'), list):
            db['stock_logs'] = body['stock_logs']
        save_data(db)
        return jsonify({"ok": True})
    return jsonify({
        "inventory": db.get('inventory'),
        "ingredient_expiry": db.get('ingredient_expiry', {}),
        "ingredient_min": db.get('ingredient_min', {}),
        "ingredient_unit": db.get('ingredient_unit', {}),
        "stock_logs": db.get('stock_logs', [])
    })

@app.after_request
def no_cache(resp):
    if request.path.startswith('/api/'):
        resp.headers['Cache-Control'] = 'no-store'
    return resp

def email_status_line():
    if brevo_ready():
        return 'Password-reset email: ON (Brevo, sending as %s)' % _parse_from(os.environ.get('MAIL_FROM') or os.environ.get('SMTP_FROM'))[1]
    if smtp_ready():
        return 'Password-reset email: ON (sending as %s via %s)' % (os.environ.get('SMTP_FROM') or os.environ.get('SMTP_USER'), os.environ.get('SMTP_HOST', 'smtp.gmail.com'))
    if os.environ.get('DEV_PRINT_CODE') == '1':
        return 'Password-reset email: OFF - DEV_PRINT_CODE=1, codes are printed in this window'
    return 'Password-reset email: OFF - fill in SMTP_USER and SMTP_PASS in .env (see .env.example)'

if __name__ == '__main__':
    import sys
    if len(sys.argv) == 3 and sys.argv[1] == '--test-email':
        # python server.py --test-email someone@gmail.com   -> checks the SMTP settings without starting the server
        print(email_status_line())
        try:
            send_email(sys.argv[2], 'AnneTea BrewTrack test email', 'Email settings work. Password-reset codes will be sent from this address.')
            print('Test email sent to', sys.argv[2])
        except EmailNotConfigured:
            print('Not sent: email is not configured.')
        except Exception as e:
            print('Not sent:', repr(e))
            print('Gmail tips: use an App password (not your normal password), with 2-Step Verification turned on.')
        sys.exit(0)
    print('=' * 50)
    print('AnneTea BrewTrack SHARED server')
    print('On this PC open:  http://127.0.0.1:5000')
    print('On other devices: http://<this-pc-lan-ip>:5000')
    print('All devices will share the same transactions.')
    print(('Settings loaded from .env' if ENV_LOADED else 'No .env file found (optional)'))
    print(email_status_line())
    print('=' * 50)
    print('Shop key: ' + ('ON' if SHOP_KEY else 'off (anyone on this network can open it)'))
    print('Data saved in: ' + ('the database (DATABASE_URL)' if DATABASE_URL else str(DATA_FILE)))
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)), debug=False)
