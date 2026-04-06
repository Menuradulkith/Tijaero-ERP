import os
import re

def check_backend_perms():
    modules_dir = "backend/app/modules"
    missing = []
    
    for root, _, files in os.walk(modules_dir):
        for file in files:
            if file.endswith(".py"):
                path = os.path.join(root, file)
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Check for APIRouter initialization with dependencies
                if "APIRouter(" in content and "require_permission" in content and "dependencies=" in content:
                    continue # Protected at router level
                
                # Find all @router. methods
                endpoints = re.finditer(r'@router\.(get|post|put|delete|patch)\((.*?)\ndef ', content, re.DOTALL)
                for match in endpoints:
                    endpoint_def = match.group(0)
                    if "require_permission" not in endpoint_def and "require_superuser" not in endpoint_def:
                        # Check if require_permission is in the function signature
                        func_sig_match = re.search(r'def [^\(]+\((.*?)\):', content[match.start():], re.DOTALL)
                        if func_sig_match:
                            func_sig = func_sig_match.group(1)
                            if "require_permission" not in func_sig and "require_superuser" not in func_sig:
                                missing.append((path, match.group(0).split('\n')[0]))

    print(f"Missing backend perms: {len(missing)}")
    for m in missing:
        print(f"  {m[0]}: {m[1]}")

check_backend_perms()
