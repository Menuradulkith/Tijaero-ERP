import os
import glob
import re

html_dir = 'backend/app/reporting/templates'

css_old = r'''.company .logo\{width:44px;height:44px;background:#111;border:2px solid #22c55e;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;color:#22c55e;font-weight:900;font-size:14px;letter-spacing:-1px;vertical-align:middle;margin-right:8px;line-height:1\}
        .company .name\{display:inline-block;vertical-align:middle\}
        .company .name h1\{font-size:17px;color:#1a4480;line-height:1\.2\}
        .company .name h1 small\{font-size:11px;font-weight:400;color:#6c757d;border-bottom:2px solid #22c55e;padding-bottom:1px\}
        .company .addr\{font-size:9px;color:#6c757d;margin-top:2px;line-height:1\.3\}'''

css_new = r'''.company .logo{width:160px;height:50px;display:block;margin-bottom:4px}
        .company .addr{font-size:9px;color:#6c757d;margin-top:2px;line-height:1.3}'''

html_old = r'''<span class="logo">IS</span>
            <div class="name"><h1>{{ company.name \| default\('UNITY SYSTEMS'\) }}<br><small>{{ company.tagline \| default\('Solutions'\) }}</small></h1></div>'''

html_new = r'''<svg viewBox="0 0 320 100" class="logo" xmlns="http://www.w3.org/2000/svg">
              <path d="M 30,20 V 65 C 30,90 60,90 60,65 V 45 C 60,25 90,25 90,45 C 90,57 70,57 70,70 C 70,90 90,90 100,80" fill="none" stroke="#12a83f" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" />
              <text x="115" y="48" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="44" fill="#222222" letter-spacing="4">UNITY</text>
              <line x1="115" y1="58" x2="295" y2="58" stroke="#12a83f" stroke-width="4" />
              <text x="115" y="86" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="28" fill="#555555" letter-spacing="7">SYSTEMS</text>
            </svg>'''

for filepath in glob.glob(os.path.join(html_dir, '*.html')):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # regex replace css
    content = re.sub(css_old, css_new, content)
    # regex replace html
    content = re.sub(html_old, html_new, content)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

print('Updated all templates')
