import os
import re

def check_frontend_routes():
    frontend_dir = "frontend/src/app"
    missing = []
    
    for root, _, files in os.walk(frontend_dir):
        for file in files:
            if file.endswith((".tsx", ".ts")):
                path = os.path.join(root, file)
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Check for Routes that might be unprotected
                # Actually, often top-level routes are protected in app/routes.tsx or similar
                if "Route " in content:
                    print(f"Found routes in {path}")

check_frontend_routes()
