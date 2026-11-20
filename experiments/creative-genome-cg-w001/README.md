# CG-W001 — The Living Invoice, Static Hero V1

**Status: creative review only — not approved, not deployed, not an application feature.**

A self-contained static hero and beginning of one next-section transition for the Free GST Billing documentation's independent website transformation study. No external image generation, no animation, no JavaScript, no application changes, no new product claims.

## Visual premise

One event has consequences after it is invoiced. The hero presents a physical invoice as an editorial illustration with a separate recorded-payment slip. The grounded inspiration is the Indian account ledger: the quiet vertical red rule and crisp ruled paper. It inherits the original product documentation's ink blue, ledger red and receipt green, but is not an official brand redesign. The sample numbers reconcile: 2,400 + 216 + 216 = 2,832. All customer and business details are fictional and explicitly labeled.

The supporting product language comes from Free GST Billing documentation v1.10.85: creating tax invoices, recording payments, identifying outstanding amounts and operating offline without signup. The source is MIT licensed, but no proprietary imagery or existing visual assets are redistributed here.

## Source references

- Product: https://dicecodes.com/free-gst-software-documentation/index.html
- How to invoice: https://dicecodes.com/free-gst-software-documentation/invoices.html
- First invoice: https://dicecodes.com/free-gst-software-documentation/first-invoice.html
- Original code and license: https://github.com/IamRamgarhia/Free-GST-Billing-Software

## Review scope

1. One desktop composition at 1440px.
2. One phone composition at 390px.
3. Only the hero plus a small transition strip into the next section.
4. Functional CTAs point to official product pages. All other elements are static.
5. Original product site/source untouched.

## What would fail the creative review

- Looks like an indistinct fintech template instead of the physical invoice/account-book idea.
- Can't identify the product benefit in a three-second glance.
- The illustrative sample is mistaken for the real app UI.
- The invoice and payment story are visually or financially incoherent.
- Mobile copy, product depiction, or links are cropped or too small.

## Review record

- Technical tests: see `tests/test_static_hero.py`; 4 browser viewport sizes.
- Creative approval: **pending**.
- Next step only if approved: design one meaningful, lightweight, accessible transition; do not scale to full website yet.

## Running and inspection

Open `index.html` in a browser for the standalone static composition, or serve this folder using `python3 -m http.server 8000` and browse to `http://localhost:8000/`. Its two calls to action link to the real documentation and download page; the local prototype does not create invoices or store payments.

Run `python3 -m pytest tests/test_static_hero.py -q` to verify real browser layout and content. Run `python3 review/render_screenshots.py` to capture four responsive layouts. During automated QA in this environment, navigation to `file://` URLs was blocked by browser policy; the tests render the exact source with `page.set_content` rather than substituting mock markup.

## Visual acceptance

V1 has passed functional and geometry checks only; **creative review pending**. This is intentionally not declared production-ready or "extraordinary" by the author. The preview makes no claim to be the authentic Free GST Billing interface.