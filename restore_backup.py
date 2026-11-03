#!/usr/bin/env python3
"""Validate a full lab backup and recover into a NEW directory, never over live data."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from reports import validate_reports
from projects import validate_projects
from treasury import validate_treasury
from location_labels import validate_labels
from inventory import SAFE_ID, validate_item, validate_stock
from lab_server import validate_lab, validate_shelf, write_json


def validate_inventory(doc):
    if (not isinstance(doc, dict) or doc.get('schemaVersion') != 1 or type(doc.get('revision')) is not int or
            doc['revision'] < 0 or not isinstance(doc.get('items'), dict) or not isinstance(doc.get('stocks'), dict)):
        raise ValueError('Invalid inventory schema or revision.')
    for item_id, item in doc['items'].items():
        if not SAFE_ID.fullmatch(item_id):
            raise ValueError('Invalid item ID.')
        validate_item(item)
    for stock_id, stock in doc['stocks'].items():
        if not SAFE_ID.fullmatch(stock_id) or type(stock.get('archived')) is not bool:
            raise ValueError('Invalid stock ID or archived flag.')
        # Missing locations remain legitimate records; restore never infers geometry.
        validate_stock(stock, doc['items'], {}, previous=stock)
    if not isinstance(doc.get('deletedItems', {}), dict):
        raise ValueError('Invalid deleted-item markers.')
    for iid, marker in doc.get('deletedItems', {}).items():
        if not SAFE_ID.fullmatch(iid) or iid in doc['items'] or not isinstance(marker, dict) or not isinstance(marker.get('name'), str):
            raise ValueError('Invalid deleted-item marker.')
    if not isinstance(doc.get('operations', {}), dict):
        raise ValueError('Invalid inventory operation history.')
    for op, result in doc.get('operations', {}).items():
        if not SAFE_ID.fullmatch(op) or not isinstance(result, dict) or type(result.get('revision')) is not int or not 0 <= result['revision'] <= doc['revision']:
            raise ValueError('Invalid inventory operation history.')


def validate_backup(backup):
    if not isinstance(backup, dict) or backup.get('format') != 'itr-full-backup' or backup.get('schemaVersion') != 1:
        raise ValueError('Expected a full lab backup from LAB INVENTORY, not a layout export or audit snapshot.')
    files = backup.get('data')
    if not isinstance(files, dict) or 'lab.json' not in files or 'inventory.json' not in files:
        raise ValueError('Backup needs saved layout and inventory.')
    for name, doc in files.items():
        if name == 'lab.json':
            validate_lab(doc)
        elif name == 'inventory.json' or re.fullmatch(r'history/inventory/\d{1,12}\.json', name):
            validate_inventory(doc)
        elif name == 'location-labels.json':
            validate_labels(doc)
        elif name == 'reports.json':
            validate_reports(doc)
        elif name == 'projects.json' or re.fullmatch(r'history/projects/\d{1,12}\.json', name):
            validate_projects(doc)
        elif name == 'treasury.json' or re.fullmatch(r'history/treasury/\d{1,12}\.json', name):
            validate_treasury(doc)
        elif name == 'bin-contents-migration.json':
            if not isinstance(doc, dict) or doc.get('schemaVersion') != 1 or doc.get('completed') is not True or not isinstance(doc.get('sources'), list):
                raise ValueError('Invalid bin contents migration record.')
        elif re.fullmatch(r'shelves/[A-Za-z0-9_-]{1,64}\.json', name):
            validate_shelf(doc, Path(name).stem)
        elif re.fullmatch(r'history/lab/\d{1,12}\.json', name):
            validate_lab(doc['layout'])
            for sid, shelf in doc.get('shelves', {}).items():
                if not SAFE_ID.fullmatch(sid):
                    raise ValueError('Invalid historical shelf ID.')
                validate_shelf(shelf, sid)
        else:
            raise ValueError('Unsupported backup path: ' + name)
    defaults = backup.get('defaults')
    if not isinstance(defaults, dict) or set(defaults) != {'lab.json'}:
        raise ValueError('Backup needs the original layout defaults.')
    validate_lab(defaults['lab.json'])
    for item in files['lab.json']['items']:
        if item['kind'] == 'shelf' and 'shelves/'+item['id']+'.json' not in files:
            raise ValueError('Backup is missing the saved shelf file: '+item['id'])


def restore_backup(backup, destination):
    destination = Path(destination).absolute()
    if destination.exists() or destination.is_symlink():
        raise ValueError('Recovery destination must be a NEW directory. Existing data is never overwritten.')
    validate_backup(backup)  # All validation completes before any files are written.
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.itr-recovery-', dir=destination.parent))
    try:
        for name, doc in backup['data'].items():
            write_json(staging/'data'/name, doc)
        for name, doc in backup['defaults'].items():
            write_json(staging/'defaults'/name, doc)
        os.rename(staging, destination)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    try:
        destination = restore_backup(json.loads(args.backup.read_text()), args.destination)
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(1, 'Recovery refused: '+str(error)+'\n')
    print(f'Recovered into {destination}. Review with:\npython3 lab_server.py --data-dir "{destination}/data" --defaults-dir "{destination}/defaults" --port 8001')


if __name__ == '__main__':
    main()
