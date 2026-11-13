"""
AnneTea BrewTrack - Simple Flask Backend
Run: python server.py
Then open https://annetea.com
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import json
import os
from datetime import datetime

app = Flask(__name__, static_folder='.')
CORS(app)

DATA_FILE = 'data.json'

def load_data():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'r') as f:
            return json.load(f)
    return {
        "sales": [],
        "inventory": {
            "Pearl": 200, "Milk": 50, "Tea Base": 40, "Sugar": 30,
            "Creamcheese": 25, "Ice Cream": 20, "Mango": 15,
            "Ube Halaya": 12, "Avocado": 10, "Corn": 18,
            "Beef Patty": 30, "Chicken Nuggets": 80,
            "Rice": 40, "Egg": 50, "Spam": 20, "Tocino": 15, "Hotdog": 25
        },
        "users": {
            "owner": {"password": "1234", "role": "owner"},
            "staff": {"password": "1234", "role": "staff"}
        }
    }

def save_data(data):
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('.', path)

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    users = load_data()['users']
    user = data.get('username', '').lower()
    if user in users and users[user]['password'] == data.get('password'):
        return jsonify({"success": True, "role": users[user]['role'], "username": user})
    return jsonify({"success": False, "message": "Invalid credentials"}), 401

@app.route('/api/sales', methods=['GET', 'POST'])
def sales():
    db = load_data()
    if request.method == 'POST':
        sale = request.json
        sale['id'] = int(datetime.now().timestamp() * 1000)
        sale['time'] = datetime.now().isoformat()
        db['sales'].append(sale)
        # Simple inventory deduction example
        for item in sale.get('items', []):
            if 'pearl' in item.get('name', '').lower() or 'milk tea' in item.get('name', '').lower():
                db['inventory']['Pearl'] = max(0, db['inventory'].get('Pearl', 0) - item.get('qty', 1))
        save_data(db)
        return jsonify({"success": True, "sale_id": sale['id']})
    return jsonify(db['sales'])

@app.route('/api/inventory', methods=['GET'])
def inventory():
    db = load_data()
    return jsonify(db['inventory'])

@app.route('/api/reports/today', methods=['GET'])
def reports_today():
    db = load_data()
    today = datetime.now().date().isoformat()
    today_sales = [s for s in db['sales'] if s.get('time', '').startswith(today)]
    total = sum(s.get('total', 0) for s in today_sales)
    return jsonify({
        "count": len(today_sales),
        "total": total,
        "sales": today_sales
    })

if __name__ == '__main__':
    print("AnneTea BrewTrack POS running at https://annetea.com")
    app.run(host='0.0.0.0', port=5000, debug=True)
