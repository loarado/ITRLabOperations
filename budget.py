"""Validation and presentation helpers for official ITR budget records."""
from decimal import Decimal
import re
from urllib.parse import urlparse

from inventory import SAFE_ID, clean_text, decimal_value
from vendors import canonical_vendor

LAB_SECTION = 'lab-items'
PROJECTS_CAPITAL_SECTION = 'projects-capital'
EVENTS_SECTION = 'events'
EVENT_ROW_LIMIT = 15
EVENT_BUDGET_LIMIT = Decimal('3000')
LAB_CATEGORY = 'lab-consumables'
LAB_CATEGORY_LABEL = 'Lab Consumables'
PROJECT_CATEGORIES = {
    'raw-material': 'Raw Material',
    'mechanism-components': 'Mechanism Components',
    'primitive-electrical-components': 'Primitive Electrical Components',
    'motion-electrical-components': 'Motion Electrical Components',
    'computing-and-sensing-components': 'Computing and Sensing Components',
    LAB_CATEGORY: LAB_CATEGORY_LABEL,
}
TERM_ID = re.compile(r'^[A-Z][A-Z0-9-]{1,63}$')


def validate_term_id(value):
    if not isinstance(value, str) or not TERM_ID.fullmatch(value):
        raise ValueError('Invalid budget term.')
    return value


def optional_url(value):
    value = clean_text(value, 'Link', 2000)
    if not value:
        return ''
    parsed = urlparse(value)
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Links must use a public http:// or https:// URL.')
    return value


def _positive_or_blank(value, field):
    result = decimal_value(value, field)
    if result is not None and Decimal(result) <= 0:
        raise ValueError(f'{field} must be greater than zero.')
    return result


def _whole_positive_or_blank(value, field):
    result = _positive_or_blank(value, field)
    if result is not None and Decimal(result) != Decimal(result).to_integral_value():
        raise ValueError(f'{field} must be a whole number.')
    return format(Decimal(result), 'f') if result is not None else None


def validate_lab_row(value, index=1):
    """Accept an incomplete draft row while retaining 312-readiness warnings."""
    if not isinstance(value, dict):
        raise ValueError('Invalid Lab Items row.')
    row_id = value.get('id', '')
    if row_id and (not isinstance(row_id, str) or not SAFE_ID.fullmatch(row_id)):
        raise ValueError('Invalid budget row ID.')
    category = value.get('category', LAB_CATEGORY)
    if category != LAB_CATEGORY:
        raise ValueError(f'Lab Items must use the {LAB_CATEGORY_LABEL} category.')
    unit_price = decimal_value(value.get('unitPrice'), 'Unit price')
    quantity = _whole_positive_or_blank(value.get('quantity'), 'Quantity')
    currency = clean_text(value.get('currency', 'USD'), 'Currency', 3).upper()
    if not re.fullmatch(r'[A-Z]{3}', currency):
        raise ValueError('Use a three-letter currency code.')
    if unit_price is not None and quantity is None:
        # This is a draft, so retain it and expose the missing quantity through
        # readiness rather than discarding work.
        pass
    total = format(Decimal(unit_price) * Decimal(quantity), 'f') if unit_price is not None and quantity is not None else None
    return {
        'id': row_id,
        'position': index,
        'name': clean_text(value.get('name', ''), 'Line item name', 500),
        'category': LAB_CATEGORY,
        'link': optional_url(value.get('link', '')),
        'unitPrice': unit_price,
        'quantity': quantity,
        'currency': currency,
        'vendor': canonical_vendor(value.get('vendor', '')),
        'notes': clean_text(value.get('notes', ''), 'Description / notes', 4000),
        'totalCost': total,
    }


def validate_lab_rows(values):
    if not isinstance(values, list) or len(values) > 250:
        raise ValueError('Lab Items can contain at most 250 saved rows.')
    rows = [validate_lab_row(value, index + 1) for index, value in enumerate(values)]
    ids = [row['id'] for row in rows if row['id']]
    if len(ids) != len(set(ids)):
        raise ValueError('Budget row IDs must be unique.')
    return rows


def validate_projects_capital_rows(values):
    """Validate the shared accounting table used before project syncing exists."""
    if not isinstance(values, list) or len(values) > 250:
        raise ValueError('Projects & Capital Items can contain at most 250 saved rows.')
    rows = []
    allowed = set(PROJECT_CATEGORIES) - {LAB_CATEGORY}
    for index, value in enumerate(values, 1):
        if not isinstance(value, dict):
            raise ValueError('Invalid Projects & Capital Items row.')
        category = value.get('category', '')
        if category and category not in allowed:
            raise ValueError('Choose a valid Projects & Capital Items category.')
        # Reuse the durable field, numeric, URL, and ID validation, then restore
        # the project-specific category rather than the Lab-only default.
        row = validate_lab_row({**value, 'category': LAB_CATEGORY}, index)
        row['category'] = category or None
        row['projectName'] = clean_text(value.get('projectName', ''), 'Project name', 500)
        rows.append(row)
    ids = [row['id'] for row in rows if row['id']]
    if len(ids) != len(set(ids)):
        raise ValueError('Budget row IDs must be unique.')
    return rows


def default_event_rows():
    return [dict(id='', position=index, name='ITR Workshop', notes='',
                 unitPrice='200', quantity='1', currency='USD', totalCost='200')
            for index in range(1, EVENT_ROW_LIMIT + 1)]


def validate_event_rows(values):
    """Validate the compact Events and Programming worksheet and its hard cap."""
    if not isinstance(values, list) or len(values) > EVENT_ROW_LIMIT:
        raise ValueError(f'Events and Programming can contain at most {EVENT_ROW_LIMIT} saved rows.')
    rows, total = [], Decimal('0')
    for index, value in enumerate(values, 1):
        if not isinstance(value, dict):
            raise ValueError('Invalid Events and Programming row.')
        row_id = value.get('id', '')
        if row_id and (not isinstance(row_id, str) or not SAFE_ID.fullmatch(row_id)):
            raise ValueError('Invalid budget row ID.')
        name = clean_text(value.get('name', ''), 'Event name', 500)
        if not name:
            raise ValueError('Event name is required.')
        amount = decimal_value(value.get('unitPrice'), 'Budget amount')
        if amount is None or Decimal(amount) < 0:
            raise ValueError('Budget amount must be zero or greater.')
        amount_decimal = Decimal(amount)
        total += amount_decimal
        rows.append(dict(id=row_id, position=index, name=name,
                         notes=clean_text(value.get('notes', ''), 'Description', 4000),
                         unitPrice=format(amount_decimal, 'f'), quantity='1', currency='USD',
                         totalCost=format(amount_decimal, 'f')))
    if total > EVENT_BUDGET_LIMIT:
        raise ValueError('Events and Programming cannot request more than USD 3000.00.')
    ids = [row['id'] for row in rows if row['id']]
    if len(ids) != len(set(ids)):
        raise ValueError('Budget row IDs must be unique.')
    return rows


def lab_readiness(rows):
    """Return non-blocking 312-readiness warnings for saved draft rows."""
    warnings = []
    for row in rows:
        missing = []
        if not row['name']:
            missing.append('Line item name')
        if not row['category']:
            missing.append('Category')
        if not row['vendor']:
            missing.append('Vendor')
        if row['unitPrice'] is None:
            missing.append('Unit price')
        if row['quantity'] is None:
            missing.append('Quantity')
        if missing:
            warnings.append({'rowId': row['id'], 'position': row['position'], 'missing': missing})
    return warnings


def budget_readiness(rows):
    return lab_readiness(rows)
