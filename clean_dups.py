import re
import sys

def clean_file(filepath):
    with open(filepath, 'r') as f:
        text = f.read()
    
    parts = text.split('from fastapi.responses import StreamingResponse\nimport io\nimport csv\n')
    if len(parts) > 2:
        new_text = parts[0] + 'from fastapi.responses import StreamingResponse\nimport io\nimport csv\n' + parts[1]
        with open(filepath, 'w') as f:
            f.write(new_text)
        print(f"Cleaned {filepath}")
    else:
        print(f"No dups found in {filepath}")

clean_file('backend/app/modules/sales/api.py')
clean_file('backend/app/modules/purchasing/api.py')

