"""Import public WordPress catalogue and information pages. No admin credentials needed.
Run explicitly to refresh the snapshot; builds never depend on WordPress availability.
"""
import concurrent.futures
import datetime
import html
from html.parser import HTMLParser
import json
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
ORIGIN = 'https://mdkelectronics.com'
EXCLUDED_IDS = {832}  # Weapon merchandise is outside this electronics storefront.
ALLOWED_TAGS = {'p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'h2', 'h3', 'h4', 'blockquote'}
class CleanHTML(HTMLParser):
    def __init__(self):
        super().__init__(); self.output = []; self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style', 'iframe', 'form'}: self.skip += 1
        elif not self.skip and tag in ALLOWED_TAGS: self.output.append('<'+tag+'>')
    def handle_endtag(self, tag):
        if tag in {'script', 'style', 'iframe', 'form'}: self.skip = max(0, self.skip-1)
        elif not self.skip and tag in ALLOWED_TAGS and tag != 'br': self.output.append('</'+tag+'>')
    def handle_data(self, data):
        if not self.skip: self.output.append(html.escape(data))
def clean(value):
    parser = CleanHTML(); parser.feed(value); return ''.join(parser.output)
def get(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()
def paged(path):
    all_items = []; page = 1
    while True:
        batch = json.loads(get(f'{ORIGIN}{path}per_page=100&page={page}'))
        all_items.extend(batch)
        if len(batch) < 100: break
        page += 1
    return all_items

def main():
    products = paged('/wp-json/wc/store/v1/products?')
    pages = paged('/wp-json/wp/v2/pages?_fields=id,slug,title,content,link&')
    assets = []; output = []
    for p in products:
        if p['id'] in EXCLUDED_IDS: continue
        images = []
        for i, image in enumerate(p['images']):
            name = f"{p['id']}-{i}.jpg"
            images.append('/images/'+name)
            assets.append((name, image['src']))
        unit = 10 ** p['prices']['currency_minor_unit']
        output.append({
            'id': p['id'], 'name': html.unescape(p['name']).strip(), 'slug': p['slug'],
            'sourceUrl': p['permalink'], 'price': int(p['prices']['price']) / unit,
            'regularPrice': int(p['prices']['regular_price']) / unit,
            'currency': p['prices']['currency_code'], 'inStock': p['is_in_stock'],
            'purchasable': p['is_purchasable'], 'images': images,
            'sourceImages': [x['src'] for x in p['images']],
            'categories': [x['name'] for x in p['categories']],
            'description': clean(p['description']), 'shortDescription': clean(p['short_description']),
            'sku': p['sku'], 'reviewCount': p['review_count'], 'rating': p['average_rating']
        })
    assets.append(('logo.png', ORIGIN+'/wp-content/uploads/2026/03/IMG_4317-2.png'))
    destination = ROOT / 'public/images'; destination.mkdir(parents=True, exist_ok=True)
    def download(asset):
        name, url = asset
        (destination / name).write_bytes(get(url))
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(download, assets))
    keep = {'sample-page', 'shipping-policy', 'return-refund-policy', 'privacy-policy-2', 'terms-conditions'}
    information = [{ 'slug': p['slug'], 'title': html.unescape(p['title']['rendered']),
                     'content': clean(p['content']['rendered']), 'sourceUrl': p['link'] }
                    for p in pages if p['slug'] in keep]
    # The About page has a stale phone number; use the current footer/returns contact.
    for page in information:
        page['content'] = page['content'].replace('0314 5851501', '0314 5851509')
    (ROOT/'src/catalog.json').write_text(json.dumps(output, ensure_ascii=False, indent=2)+'\n')
    (ROOT/'src/pages.json').write_text(json.dumps(information, ensure_ascii=False, indent=2)+'\n')
    manifest = {'source': ORIGIN, 'importedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'productCount': len(output), 'imageCount': len(assets), 'pageCount': len(information),
                'excludedProductIds': sorted(EXCLUDED_IDS), 'sourceProductCount': len(products)}
    (ROOT/'docs/import-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(f"Imported {len(output)} electronics products, {len(assets)} assets and {len(information)} information pages.")
if __name__ == '__main__': main()
