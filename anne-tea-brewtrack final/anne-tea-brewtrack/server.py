"""
AnneTea BrewTrack - Shared backend for multi-device use
Run on the main PC:  python server.py
Then on laptop/tablet open:  http://THIS-PC-IP:5000
All devices share the same sales, inventory, and history.
"""
from flask import Flask, request, jsonify, send_from_directory
import json, os
from datetime import datetime
from pathlib import Path

try:
    from flask_cors import CORS
except ImportError:
    CORS = None

ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / 'shared_data.json'
app = Flask(__name__, static_folder=str(ROOT), static_url_path='')
if CORS:
    CORS(app)

DEFAULT = {
    "sales": [],
    "inventory": None,
    "stock_logs": [],
    "accounts": None,
    "ingredient_expiry": {},
    "product_expiry": {},
    "custom_products": []
}

def load_data():
    if DATA_FILE.exists():
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        for k, v in DEFAULT.items():
            data.setdefault(k, v)
        return data
    return dict(DEFAULT)

def save_data(data):
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

@app.route('/')
def index():
    return send_from_directory(ROOT, 'index.html')

@app.route('/api/health')
def health():
    return jsonify({"ok": True, "shared": True})

@app.route('/api/state', methods=['GET'])
def get_state():
    """Full shared state for clients"""
    return jsonify(load_data())

@app.route('/api/state', methods=['POST'])
def post_state():
    """Merge client keys into shared store"""
    body = request.json or {}
    db = load_data()
    for key in ('sales', 'inventory', 'stock_logs', 'accounts',
                'ingredient_expiry', 'product_expiry', 'custom_products'):
        if key in body and body[key] is not None:
            db[key] = body[key]
    save_data(db)
    return jsonify({"ok": True})

@app.route('/api/sales', methods=['GET'])
def get_sales():
    return jsonify(load_data().get('sales', []))

@app.route('/api/sales', methods=['POST'])
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

@app.route('/api/inventory', methods=['GET', 'POST'])
def inventory_api():
    db = load_data()
    if request.method == 'POST':
        body = request.json or {}
        if isinstance(body.get('inventory'), dict):
            db['inventory'] = body['inventory']
        if isinstance(body.get('ingredient_expiry'), dict):
            db['ingredient_expiry'] = body['ingredient_expiry']
        if isinstance(body.get('stock_logs'), list):
            db['stock_logs'] = body['stock_logs']
        save_data(db)
        return jsonify({"ok": True})
    return jsonify({
        "inventory": db.get('inventory'),
        "ingredient_expiry": db.get('ingredient_expiry', {}),
        "stock_logs": db.get('stock_logs', [])
    })

@app.after_request
def no_cache(resp):
    if request.path.startswith('/api/'):
        resp.headers['Cache-Control'] = 'no-store'
    return resp

if __name__ == '__main__':
    print('=' * 50)
    print('AnneTea BrewTrack SHARED server')
    print('On this PC open:  http://127.0.0.1:5000')
    print('On other devices: http://<this-pc-lan-ip>:5000')
    print('All devices will share the same transactions.')
    print('=' * 50)
    app.run(host='0.0.0.0', port=5000, debug=False)
