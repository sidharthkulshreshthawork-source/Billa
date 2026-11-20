"""CG-W001 static review-gate tests: real rendered HTML, no mocked UI."""
from pathlib import Path
import pytest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / 'index.html'

@pytest.fixture(scope='module')
def browser():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox', '--disable-dev-shm-usage'])
        yield browser
        browser.close()


def open_page(browser, width=1440, height=900):
    tab = browser.new_page(viewport={'width':width,'height':height}, device_scale_factor=1)
    tab.set_content(PAGE.read_text(), wait_until='load')
    return tab


def test_real_hero_explains_invoice_and_payment_without_a_demo_claim(browser):
    tab = open_page(browser)
    assert tab.get_by_role('heading', level=1).count() == 1
    assert 'invoice' in tab.get_by_role('heading', level=1).inner_text().lower()
    assert 'paid' in tab.get_by_role('heading', level=1).inner_text().lower()
    assert tab.get_by_text('Illustrative invoice', exact=True).count() == 1
    assert tab.get_by_text('Payment recorded', exact=True).count() == 1
    assert 'independent design study' in tab.locator('.review-strip').inner_text().lower()
    tab.close()


def test_ctas_go_to_real_official_destinations_not_fake_buttons(browser):
    tab = open_page(browser)
    anchors = tab.locator('a').evaluate_all('(els) => els.map(x => ({text:x.innerText.trim(),href:x.href}))')
    assert any('github.com/IamRamgarhia/Free-GST-Billing-Software/releases' in a['href'] for a in anchors)
    assert any('dicecodes.com/free-gst-software-documentation/first-invoice.html' in a['href'] for a in anchors)
    assert all(a['href'].startswith('https://') for a in anchors)
    assert tab.locator('button').count() == 0, 'Static review must not promise an interaction'
    tab.close()


def test_invoice_sample_math_and_provenance_are_unambiguous(browser):
    tab = open_page(browser)
    assert tab.locator('[data-financial="subtotal"]').inner_text().strip() == '₹2,400'
    assert tab.locator('[data-financial="cgst"]').inner_text().strip() == '₹216'
    assert tab.locator('[data-financial="sgst"]').inner_text().strip() == '₹216'
    assert tab.locator('[data-financial="grand-total"]').inner_text().strip() == '₹2,832'
    assert tab.get_by_text('Fictional details for design review', exact=True).count() == 1
    tab.close()


@pytest.mark.parametrize('width,height', [(1440,900),(768,1024),(390,844),(320,720)])
def test_real_browser_render_has_no_horizontal_overflow(browser,width,height):
    tab=open_page(browser,width,height)
    dimensions=tab.evaluate('({body:document.body.scrollWidth,root:document.documentElement.scrollWidth,viewport:window.innerWidth})')
    assert dimensions['body'] <= dimensions['viewport']+1, dimensions
    assert dimensions['root'] <= dimensions['viewport']+1, dimensions
    assert tab.locator('.invoice-paper').is_visible()
    tab.close()


def test_no_external_runtime_dependencies_or_images():
    html = PAGE.read_text()
    assert '<script' not in html.lower()
    assert '<img' not in html.lower()
    assert 'http-equiv="refresh"' not in html.lower()

@pytest.mark.parametrize('width,height',[(1440,900),(390,844),(320,720)])
def test_payment_receipt_does_not_hide_invoice_total(browser,width,height):
    tab=open_page(browser,width,height)
    a=tab.locator('[data-financial="grand-total"]').bounding_box()
    b=tab.locator('.receipt-card').bounding_box()
    intersects = not (a['x']+a['width'] <= b['x'] or b['x']+b['width'] <= a['x'] or a['y']+a['height'] <= b['y'] or b['y']+b['height'] <= a['y'])
    assert not intersects, f'Grand total occluded by receipt at {width}px: {a} and {b}'
    tab.close()

@pytest.mark.parametrize('width,height',[(1440,900),(768,1024),(390,844),(320,720)])
def test_receipt_and_disclosure_are_visible_without_clipping(browser,width,height):
    tab=open_page(browser,width,height)
    scene=tab.locator('.scene').bounding_box()
    receipt=tab.locator('.receipt-card').bounding_box()
    disclosure=tab.locator('.scene-bottom').bounding_box()
    assert receipt['y'] >= scene['y'] + 4
    assert receipt['y']+receipt['height'] <= scene['y']+scene['height'] - 4, f'Receipt cut off at {width}px'
    horizontally = not (receipt['x']+receipt['width'] <= disclosure['x'] or disclosure['x']+disclosure['width'] <= receipt['x'])
    vertically = not (receipt['y']+receipt['height'] <= disclosure['y'] or disclosure['y']+disclosure['height'] <= receipt['y'])
    assert not (horizontally and vertically), f'Disclosure covered at {width}px'
    tab.close()