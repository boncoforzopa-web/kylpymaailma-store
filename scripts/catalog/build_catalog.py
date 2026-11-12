#!/usr/bin/env python3
"""Builds data/products.json, collections, image manifest and product images
from scripts/catalog/products.csv + variants.csv + source-images/<handle>.jpg.

Run from the repo root:  python3 scripts/catalog/build_catalog.py

Finnish titles/descriptions live in the FI dict below (one entry per handle).
Stock and prices come from variants.csv, so re-running after editing that file
is enough to update them.
"""
import csv, json, os, re, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DATA = os.path.join(ROOT, 'data')
IMG_OUT = os.path.join(ROOT, 'public', 'images')
VENDOR = 'Kylpymaailma'
NOW = '2026-11-12T12:00:00Z'
WIDTHS = [160, 320, 480, 640, 800]

# colour name in the CSV -> (Finnish name, fallback swatch hex when variants.csv has no Colour_Hex)
COLOURS = {
    'Mocha': ('Mokka', '#8B6F5E'), 'Sand': ('Hiekka', '#D2C0A5'), 'Dusty Bone': ('Luunvalkoinen', '#E3DACB'),
    'Sage': ('Salvia', '#A3AD95'), 'Espresso': ('Espresso', '#4A372E'), 'Cloud': ('Pilvi', '#D9DBDD'),
    'Storm': ('Myrsky', '#6C7480'), 'Black': ('Musta', '#1B1B1D'), 'Coffee': ('Kahvi', '#6F4E37'),
    'Camel': ('Kameli', '#B98B5E'), 'Dark Coffee': ('Tumma kahvi', '#3F2B22'), 'Navy': ('Tummansininen', '#1F2A44'),
    'Light Gray': ('Vaaleanharmaa', '#C9CBCD'), 'White': ('Valkoinen', '#F6F5F1'), 'Brown': ('Ruskea', '#6B4A3A'),
    'Beige': ('Beige', '#D9C7AE'), 'Gray': ('Harmaa', '#8C8F93'),
}

MADE_CN = 'Valmistettu Kiinassa'
FI = {
    'hijab-premium-jersey': {
        'title': 'Premium-jerseyhijab', 'type': 'Hijab', 'collections': ['hijabit'],
        'seo': 'Premium-jerseyhijab, 180 × 75 cm, 7 väriä',
        'desc': 'Pehmeä ja kevyesti joustava jerseyhijab, jonka paino saa kankaan laskeutumaan kauniisti. Koko on 180 × 75 cm, joten kangasta riittää jokaiseen sidontatyyliin – tiukasti kasvojen ympärille tai väljästi hartioille. Rauhallinen perushijab, joka sopii yhtä hyvin töihin kuin illanviettoon. Saatavana seitsemässä hillityssä sävyssä.',
        'features': ['94 % polyesteriä, 6 % elastaania', 'Paino noin 150 g', 'Koko 180 × 75 cm (yksi koko)', 'Pehmeä ja kevyesti joustava', '7 väriä'],
        'material': '94 % polyesteri, 6 % elastaani', 'care': 'Konepesu 40 °C, kuivaus ilmassa', 'origin': 'Suunniteltu Alankomaissa, kudottu Turkissa',
    },
    'khimar-one-layer': {
        'title': 'Yksikerroksinen khimar', 'type': 'Khimar', 'collections': ['khimarit', 'ramadan'],
        'seo': 'Yksikerroksinen khimar, silittämätön, 7 väriä',
        'desc': 'Yksikerroksinen khimar rypytetystä polyesteristä peittää rinnan ja on takaa pidempi: 115 cm edestä ja 135 cm takaa. Rypytys on kudottu kankaaseen, joten khimaria ei tarvitse silittää ja se pysyy siistinä. Sopii rukoukseen, ramadaniin ja jokapäiväiseen käyttöön.',
        'features': ['Rypytetty polyesteri, ei tarvitse silittää', 'Yksi kerros', 'Yksi koko: edestä 115 cm, takaa 135 cm', 'Paino noin 390 g'],
        'material': 'Rypytetty polyesteri', 'care': 'Pesu 30 °C, kuivaus ripustettuna', 'origin': MADE_CN,
    },
    'open-abaya-linen': {
        'title': 'Avoin pellava-abaya', 'type': 'Abaya', 'collections': ['abayat', 'ramadan'],
        'seo': 'Avoin pellava-abaya, pituudet 138–153 cm',
        'desc': 'Avoin pellava-abaya on ilmava kerros, jota käytetään alusmekon tai omien vaatteiden päällä. Pellava hengittää ja tuntuu kevyeltä, joten se sopii lämpimiin päiviin ja ramadaniin. Pituus valitaan senttimetreinä (138–153 cm), jolloin abaya on juuri oman pituutesi mukainen. Yhdistä samansävyiseen khimariin, niin asu on valmis.',
        'features': ['Pellava', 'Avoin etuosa', 'Pituudet 138, 143, 148 ja 153 cm (M–2XL)', 'Kokotaulukko oman pituuden mukaan', 'Paino noin 510 g'],
        'material': 'Pellava', 'care': 'Pesu 30 °C, kuivaus ripustettuna', 'origin': MADE_CN,
    },
    'khimar-two-layer': {
        'title': 'Kaksikerroksinen khimar', 'type': 'Khimar', 'collections': ['khimarit', 'ramadan'],
        'seo': 'Kaksikerroksinen khimar, silittämätön, 5 väriä',
        'desc': 'Kaksikerroksisessa khimarissa toinen kangaskerros antaa lisää peittävyyttä. Etuosa on 100 cm ja takaosa 130 cm pitkä, joten rinta ja selkä peittyvät reilusti. Rypytetty polyesteri pysyy kevyenä eikä kaipaa silitysrautaa – käytännöllinen valinta rukoukseen ja matkalle.',
        'features': ['Rypytetty polyesteri, ei tarvitse silittää', 'Kaksi kerrosta lisää peittävyyttä', 'Yksi koko: edestä 100 cm, takaa 130 cm', 'Paino noin 390 g'],
        'material': 'Rypytetty polyesteri', 'care': 'Pesu 30 °C, kuivaus ripustettuna', 'origin': MADE_CN,
    },
    'closed-dress-linen': {
        'title': 'Pitkähihainen pellavamekko', 'type': 'Mekko', 'collections': ['mekot', 'ramadan'],
        'seo': 'Pitkähihainen pellavamekko, pituudet 138–153 cm',
        'desc': 'Pitkähihainen pellavamekko, jossa on suora ja rauhallinen linja. Mekko on yksikerroksinen ja edestä umpinainen, joten sitä voi käyttää sellaisenaan ilman erillistä päällyskerrosta. Pituuksia on neljä, 138–153 cm, ja niistä valitaan omaan pituuteen sopiva. Kevyt, hengittävä ja helppo yhdistää khimariin.',
        'features': ['Pellava', 'Umpinainen etuosa, pitkät hihat', 'Pituudet 138, 143, 148 ja 153 cm (M–2XL)', 'Paino noin 420 g'],
        'material': 'Pellava', 'care': 'Pesu 30 °C, kuivaus ripustettuna', 'origin': MADE_CN,
    },
    'abaya-hooded-nida': {
        'title': 'Nida-abaya kiinteällä hijabilla', 'type': 'Abaya', 'collections': ['abayat', 'ramadan'],
        'seo': 'Nida-abaya kiinteällä hijabilla, 6 väriä',
        'desc': 'Tässä nida-abayassa hijab on ommeltu kiinni, joten mitään ei tarvitse asetella erikseen: pue päälle ja olet valmis. Nida on mattapintaista kreppikangasta, joka laskeutuu pehmeästi ja pitää muotonsa, joten abaya näyttää aina siistiltä. Kaksi pituutta, 140 ja 148 cm, ja kuusi väriä.',
        'features': ['Nida (mattapintainen kreppi)', 'Hijab ommeltu kiinni abayaan', 'Pituudet 140 ja 148 cm', 'Paino noin 560 g'],
        'material': 'Nida', 'care': 'Pesu 30 °C, kuivaus ripustettuna', 'origin': MADE_CN,
    },
    'abaya-wrinkle-polyester': {
        'title': 'Avoin abaya rypytetystä polyesteristä', 'type': 'Abaya', 'collections': ['abayat', 'ramadan'],
        'seo': 'Avoin abaya rypytetystä polyesteristä, 6 väriä',
        'desc': 'Avoin abaya rypytetystä polyesteristä: kankaaseen kudottu rypytys peittää taitokset ja rypyt, ja abaya pysyy kevyenä. Hyvä valinta matkalle ja pitkiin päiviin. Avoimen etuosan ansiosta se on helppo yhdistää omiin vaatteisiin. Neljä pituutta ja kuusi väriä.',
        'features': ['Rypytetty polyesteri, ei rypisty käytössä', 'Avoin etuosa', 'Pituudet 138, 143, 148 ja 153 cm (M–2XL)', 'Paino noin 530 g'],
        'material': 'Rypytetty polyesteri', 'care': 'Pesu 30 °C, kuivaus ripustettuna', 'origin': MADE_CN,
    },
    'abaya-nida': {
        'title': 'Avoin nida-abaya', 'type': 'Abaya', 'collections': ['abayat', 'ramadan'],
        'seo': 'Avoin nida-abaya, pituudet 138–153 cm',
        'desc': 'Avoin abaya nidasta, mattapintaisesta krepistä, joka laskeutuu painavasti ja säilyttää suoran, selkeän linjan. Ajaton malli arkeen ja juhlaan. Etuosa on avoin, joten abaya puetaan oman asun päälle. Neljä pituutta ja neljä väriä.',
        'features': ['Nida (mattapintainen kreppi)', 'Avoin etuosa', 'Pituudet 138, 143, 148 ja 153 cm (M–2XL)', 'Paino noin 500 g'],
        'material': 'Nida', 'care': 'Pesu 30 °C, kuivaus ripustettuna', 'origin': MADE_CN,
    },
}

COLLECTIONS = [
    ('hijabit', 'Hijabit', 'Pehmeät hijabit jokaiseen päivään.'),
    ('khimarit', 'Khimarit', 'Yksi- ja kaksikerroksiset khimarit, joita ei tarvitse silittää.'),
    ('abayat', 'Abayat', 'Avoimet abayat ja abayat kiinteällä hijabilla, pituus senttimetreinä.'),
    ('mekot', 'Mekot', 'Pitkät, peittävät mekot.'),
    ('ramadan', 'Ramadan-mallisto', 'Kevyet ja peittävät asut rukoukseen, iftar-iltoihin ja jokaiseen päivään.'),
]

MEASURE_FI = {'bust': 'Rinnanympärys', 'waist': 'Vyötärö', 'length': 'Pituus', 'sleeve': 'Hiha', 'shoulder': 'Olkapäät',
              'shoulder_sleeve': 'Olka + hiha', 'width': 'Leveys', 'back_length': 'Pituus takaa'}


def hex_of(v):
    """Swatch colour: the Colour_Hex column of variants.csv, else the default from COLOURS."""
    return (v.get('Colour_Hex') or '').strip().upper() or COLOURS[v['Colour']][1]


def esc(s):
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def size_guide_html(raw):
    """'138 cm: bust 113 cm, length 138 cm (lichaamslengte 158-163 cm) | 143 cm: …' -> <table>"""
    rows, cols, has_height = [], [], False
    for part in [p.strip() for p in raw.split('|') if p.strip()]:
        label, rest = part.split(':', 1)
        height = None
        m = re.search(r'\(lichaamslengte\s+(\d+)-(\w+)\s*cm\)', rest)
        if m:
            height = f'{m.group(1)}–{m.group(2)} cm' if m.group(2).isdigit() else f'{m.group(1)} cm tai pidempi'
            rest = rest[:m.start()]
            has_height = True
        vals = {}
        for item in [i.strip() for i in rest.split(',') if i.strip()]:
            k, v = item.split(' ', 1)
            vals[k] = v.strip().replace('.', ',')
            if k not in cols:
                cols.append(k)
        label = 'Yksi koko' if label.strip().lower() == 'one size' else label.strip()
        rows.append((label, vals, height))
    head = '<th scope="col">Koko</th>' + ''.join(f'<th scope="col">{MEASURE_FI.get(c, c)}</th>' for c in cols)
    if has_height:
        head += '<th scope="col">Sopii pituudelle</th>'
    body = ''
    for label, vals, height in rows:
        body += f'<tr><th scope="row">{esc(label)}</th>' + ''.join(f'<td>{esc(vals.get(c, "–"))}</td>' for c in cols)
        if has_height:
            body += f'<td>{esc(height or "–")}</td>'
        body += '</tr>'
    return f'<table class="km-sizes"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>'


def trim_bands(im, tol=14):
    """Supplier photos often come padded to 2:3 with solid colour bars above/below; cut those off."""
    px = im.load()
    w, h = im.size
    def uniform(y):
        row = [px[x, y] for x in range(0, w, 4)]
        for c in range(3):
            vals = [p[c] for p in row]
            mean = sum(vals) / len(vals)
            if (sum((v - mean) ** 2 for v in vals) / len(vals)) ** 0.5 >= tol:
                return False
        return True
    top, bot = 0, h
    while top < h - 1 and uniform(top):
        top += 1
    while bot > top + 1 and uniform(bot - 1):
        bot -= 1
    if bot - top < h * 0.3:  # nothing sensible left: keep the original
        return im
    return im.crop((0, top, w, bot))


def build_images(handle):
    src = os.path.join(HERE, 'source-images', f'{handle}.jpg')
    if not os.path.exists(src):
        return None
    im = Image.open(src).convert('RGB')
    im = trim_bands(im)
    w, h = im.size
    widths = sorted(set([x for x in WIDTHS if x < w] + [w]))
    out_dir = os.path.join(IMG_OUT, handle)
    os.makedirs(out_dir, exist_ok=True)
    for x in widths:
        im.resize((x, round(h * x / w)), Image.LANCZOS).save(os.path.join(out_dir, f'01-{x}.webp'), 'WEBP', quality=84, method=6)
    return {'width': w, 'height': h, 'widths': widths, 'base': f'{handle}/01'}


def main():
    prods = list(csv.DictReader(open(os.path.join(HERE, 'products.csv'), encoding='utf-8-sig')))
    variants = list(csv.DictReader(open(os.path.join(HERE, 'variants.csv'), encoding='utf-8-sig')))
    by_handle = {}
    for v in variants:
        by_handle.setdefault(v['Handle'], []).append(v)

    out, manifest, order = [], {}, {h: [] for h, _, _ in COLLECTIONS}
    order['all'] = []
    for row in sorted(prods, key=lambda r: int(r['Priority_Order'])):
        handle = row['Handle']
        fi = FI.get(handle)
        if not fi:
            sys.exit(f'No Finnish text for {handle} – add it to FI in build_catalog.py')
        n = int(row['Priority_Order'])
        pid = 9200000000000 + n
        vs = by_handle.get(handle, [])
        has_length = any(v['Length'].strip().lower() != 'one size' for v in vs)
        colours, lengths, vout = [], [], []
        for i, v in enumerate(vs):
            c_fi = COLOURS[v['Colour']][0]
            if c_fi not in colours:
                colours.append(c_fi)
            opts = {'Väri': c_fi}
            if has_length:
                if v['Length'] not in lengths:
                    lengths.append(v['Length'])
                opts['Pituus'] = v['Length']
            vout.append({
                'id': str(4200000000000 + n * 1000 + i + 1), 'title': ' / '.join(opts.values()), 'sku': v['SKU'],
                'price': f"{float(v['Price_EUR']):.2f}", 'compare_at_price': None, 'taxable': True,
                'inventory_quantity': int(v['Stock']), 'inventory_tracked': True, 'inventory_policy': 'DENY',
                'requires_shipping': True, 'weight': int(row['Weight_g'] or 0), 'weight_unit': 'GRAMS', 'options': opts,
                'colour_hex': hex_of(v),
            })
        options = [{'name': 'Väri', 'values': colours}]
        if has_length:
            options.append({'name': 'Pituus', 'values': lengths})

        desc = f"<p>{esc(fi['desc'])}</p><ul>" + ''.join(f'<li>{esc(f)}</li>' for f in fi['features']) + '</ul>'
        img = build_images(handle)
        images = []
        if img:
            manifest[f'{handle}/01.jpg'] = img
            images.append({'position': 1, 'src': '', 'local': f'images/{handle}/01.jpg', 'alt': fi['title'], 'width': img['width'], 'height': img['height']})
        swatches = ';'.join(f"{COLOURS[c][0]}|{h}" for c, h in dict.fromkeys((v['Colour'], hex_of(v)) for v in vs))
        out.append({
            'id': str(pid), 'handle': handle, 'title': fi['title'], 'status': 'active', 'vendor': VENDOR, 'product_type': fi['type'],
            'category': 'Apparel & Accessories > Clothing', 'tags': [fi['type']] + colours, 'description_html': desc,
            'seo_title': fi['seo'], 'seo_description': fi['desc'][:300], 'url': f'/products/{handle}', 'template_suffix': None,
            'created_at': NOW, 'updated_at': NOW, 'published_at': NOW, 'total_inventory': sum(int(v['Stock']) for v in vs),
            'options': options, 'collections': fi['collections'], 'release_date': None,
            'metafields': {
                'custom.material': fi['material'], 'custom.care': fi['care'], 'custom.origin': fi['origin'],
                'custom.size_guide': size_guide_html(row['Size_Guide']), 'custom.swatches': swatches,
                'global.title_tag': fi['seo'],
            },
            'images': images, 'variants': vout,
        })
        for c in fi['collections']:
            order[c].append(handle)
        order['all'].append(handle)

    cols = [{'id': f'gid://shopify/Collection/{9300000000000 + i}', 'legacyResourceId': str(9300000000000 + i), 'handle': h, 'title': t,
             'descriptionHtml': f'<p>{d}</p>', 'sortOrder': 'MANUAL', 'templateSuffix': None, 'updatedAt': NOW,
             'seo': {'title': None, 'description': None}, 'image': None, 'productsCount': {'count': len(order[h])}}
            for i, (h, t, d) in enumerate(COLLECTIONS, 1)]

    def dump(name, obj):
        with open(os.path.join(DATA, name), 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)
            f.write('\n')
    dump('products.json', out)
    dump('collections.json', cols)
    dump('collection-order.json', order)
    dump('collection-bestselling.json', {})
    dump('image-manifest.json', manifest)
    dump('hires.json', [])
    dump('topseller.json', [])
    dump('redirects.json', [])
    print(f'{len(out)} products, {sum(len(p["variants"]) for p in out)} variants, {len(manifest)} images')


if __name__ == '__main__':
    main()
