"""Validation and presentation helpers for official ITR budget records."""
from decimal import Decimal
from datetime import date
import re
from urllib.parse import urlparse

from inventory import SAFE_ID, clean_text, decimal_value
from vendors import canonical_vendor

LAB_SECTION = 'lab-items'
PROJECTS_CAPITAL_SECTION = 'projects-capital'
EVENTS_SECTION = 'events'
CONFERENCES_SECTION = 'conferences'
EVENT_ROW_LIMIT = 15
EVENT_BUDGET_LIMIT = Decimal('3000')
CONFERENCE_LIMIT = 10
MILEAGE_REIMBURSEMENT_RATE = Decimal('0.76')
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


def validate_conference_entries(values):
    if not isinstance(values, list) or len(values) > CONFERENCE_LIMIT:
        raise ValueError(f'Conferences & Competitions can contain at most {CONFERENCE_LIMIT} entries.')
    entries = []
    for position, value in enumerate(values, 1):
        if not isinstance(value, dict):
            raise ValueError('Invalid conference or competition entry.')
        entry_id = value.get('id', '')
        if entry_id and (not isinstance(entry_id, str) or not SAFE_ID.fullmatch(entry_id)):
            raise ValueError('Invalid conference or competition ID.')
        def text(key, label, limit=4000):
            result = clean_text(value.get(key, ''), label, limit)
            if not result:
                raise ValueError(f'{label} is required.')
            return result
        conference_date = text('date', 'Date of conference', 10)
        try:
            date.fromisoformat(conference_date)
        except ValueError:
            raise ValueError('Date of conference must use YYYY-MM-DD.')
        def nonnegative(key, label):
            amount = decimal_value(value.get(key), label)
            if amount is None or Decimal(amount) < 0:
                raise ValueError(f'{label} must be zero or greater.')
            return Decimal(amount)
        people = nonnegative('peopleCount', 'Number of people')
        executives = nonnegative('executiveCount', 'Number of executive-board attendees')
        if people != people.to_integral_value() or people < 1:
            raise ValueError('Number of people must be a whole number of at least one.')
        if executives != executives.to_integral_value() or executives < 1 or executives > people:
            raise ValueError('Executive-board attendees must be at least one and cannot exceed attendees.')
        registration, transportation, lodging = (nonnegative(key, label) for key, label in (
            ('registrationCost', 'Registration cost'), ('transportationCost', 'Transportation cost'), ('lodgingCost', 'Lodging cost')))
        registration_document = optional_url(value.get('registrationDocument', ''))
        transportation_document = optional_url(value.get('transportationDocument', ''))
        if registration and not registration_document:
            raise ValueError('Registration supporting document is required when registration has a cost.')
        if transportation and not transportation_document:
            raise ValueError('Transportation supporting document is required when transportation has a cost.')
        travel_method = clean_text(value.get('travelMethod', ''), 'Travel method', 120)
        distance = decimal_value(value.get('travelDistance'), 'Travel distance')
        if bool(travel_method) != (distance is not None):
            raise ValueError('Enter both a travel method and distance for transportation guidance.')
        if distance is not None and Decimal(distance) < 0:
            raise ValueError('Travel distance must be zero or greater.')
        total = registration + transportation + lodging
        entries.append(dict(id=entry_id, position=position,
                            description=text('description', 'Description of conference', 500),
                            selectionProcess=text('selectionProcess', 'Selection process'), date=conference_date,
                            commitment=text('commitment', 'Commitment made'), conferenceType=text('conferenceType', 'Type of conference', 500),
                            peopleCount=format(people, 'f'), executiveCount=format(executives, 'f'),
                            presentation=text('presentation', 'Presentation details'),
                            registrationCost=format(registration, 'f'), registrationDocument=registration_document,
                            transportationCost=format(transportation, 'f'), transportationDocument=transportation_document,
                            lodgingCost=format(lodging, 'f'), travelMethod=travel_method,
                            travelDistance=format(Decimal(distance), 'f') if distance is not None else '',
                            mileageEstimate=format(Decimal(distance) * MILEAGE_REIMBURSEMENT_RATE, 'f') if distance is not None else '',
                            totalCost=format(total, 'f')))
    return entries


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
