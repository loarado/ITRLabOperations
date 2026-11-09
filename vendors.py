"""Approved IIT supplier catalog used by project and budget entry workflows."""
import csv
from functools import lru_cache
from pathlib import Path


CATALOG_PATH = Path(__file__).resolve().parent / 'data' / 'approved-vendors.csv'
VENDOR_ALIASES = {
    'amazon': 'amazon business inc',
    'mcmaster': 'mcmaster carr supply company',
    'digikey': 'digi key electronics',
}
ADDED_VENDORS = ('goBILDA', 'Base10Assets', 'ServoCity')


def vendor_key(value):
    """Cheap, punctuation-tolerant lookup key with an optional LLC suffix."""
    words = ''.join(character if character.isalnum() else ' ' for character in value.casefold()).split()
    if words and words[-1] == 'llc':
        words.pop()
    return ' '.join(words)


@lru_cache(maxsize=1)
def approved_vendors():
    """Load canonical supplier names once per application process."""
    try:
        with CATALOG_PATH.open(encoding='utf-8-sig', newline='') as source:
            reader = csv.DictReader(source)
            if not reader.fieldnames or 'Supplier Name' not in reader.fieldnames:
                raise ValueError('Approved vendor catalog needs a Supplier Name column.')
            names = []
            seen = set()
            for row in reader:
                name = (row.get('Supplier Name') or '').strip()
                key = vendor_key(name)
                if name and key not in seen:
                    names.append(name)
                    seen.add(key)
    except OSError as error:
        raise RuntimeError('Approved vendor catalog is unavailable.') from error
    if not names:
        raise RuntimeError('Approved vendor catalog has no supplier names.')
    for name in ADDED_VENDORS:
        if vendor_key(name) not in seen:
            names.append(name)
    return tuple(names)


def canonical_vendor(value, field='Vendor'):
    """Return a catalog spelling; allow blank drafts but reject unknown suppliers."""
    if not isinstance(value, str) or len(value) > 500:
        raise ValueError(f'Invalid {field} (maximum 500 characters).')
    entered = value.strip()
    if not entered:
        return ''
    lookup = {vendor_key(name): name for name in approved_vendors()}
    key = VENDOR_ALIASES.get(vendor_key(entered), vendor_key(entered))
    result = lookup.get(key)
    if not result:
        raise ValueError('Choose an approved vendor from the supplier list.')
    return result


def vendor_matches(query, limit=12):
    """Return compact prefix/substring matches for the authenticated picker."""
    query = vendor_key(query)
    if len(query) < 2:
        return []
    starts, contains = [], []
    for name in approved_vendors():
        target = vendor_key(name)
        aliases = [alias for alias, canonical in VENDOR_ALIASES.items() if canonical == target]
        if (target.startswith(query) or any(alias.startswith(query) for alias in aliases)) and len(starts) < limit:
            starts.append(name)
        elif (query in target or any(query in alias for alias in aliases)) and len(contains) < limit:
            contains.append(name)
    return (starts + contains)[:limit]
