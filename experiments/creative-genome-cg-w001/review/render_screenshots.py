"""Capture the *real static HTML* in Chromium; never generate visual mockups."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_text()
OUT=ROOT/'review'
OUT.mkdir(exist_ok=True)
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    for name,width,height in [('desktop',1440,900),('mobile',390,844),('tablet',768,1024),('compact',320,720)]:
        page=b.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
        page.set_content(HTML,wait_until='load')
        page.screenshot(path=str(OUT/f'CG-W001-{name}-V1.png'),full_page=True,animations='disabled')
        sizes=page.evaluate('({w:window.innerWidth,body:document.body.scrollWidth,height:document.body.scrollHeight})')
        print(name,sizes)
        page.close()
    b.close()