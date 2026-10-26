#!/usr/bin/env python3
"""
COREX Game Server
Termux me chalane ke liye:
  python server.py

Phir browser me kholo:
  http://localhost:5000
"""

from flask import Flask, send_from_directory
import os

# COREX folder ka path — server.py ko COREX folder ke andar rakho
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=BASE_DIR)

@app.route('/')
def index():
    return send_from_directory(BASE_DIR, 'index.html')

@app.after_request
def add_no_cache(resp):
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory(BASE_DIR, filename)

if __name__ == '__main__':
    print("=" * 40)
    print("  COREX Server chal raha hai!")
    print("  Browser me kholo:")
    print("  http://localhost:8080")
    print("=" * 40)
    app.run(host='0.0.0.0', port=8080, debug=False)
