"""Durable public project requests.  Project requests never alter lab stock."""
import copy
from datetime import datetime, timezone
import hashlib
import json
import secrets
import time
from decimal import Decimal

from inventory import SAFE_ID, clean_text, decimal_value

STAGES = {'idea', 'planned', 'procurement-ready'}
CONFIDENCE = {'rough', 'moderate', 'researched'}
PROJECT_STATUS = {'submitted', 'needs-details', 'under-review', 'approved', 'in-progress', 'complete', 'declined', 'archived'}


def empty_projects():
    return dict(schemaVersion=1, revision=0, projects={}, operations={})


def empty_project_comments():
    return dict(schemaVersion=1, revision=0, comments={})


def validate_project_comments(doc):
    if (not isinstance(doc, dict) or doc.get('schemaVersion') != 1 or
            type(doc.get('revision')) is not int or doc['revision'] < 0 or
            not isinstance(doc.get('comments'), dict)):
        raise ValueError('Invalid project comments document.')
    for project_id, comments in doc['comments'].items():
        if not SAFE_ID.fullmatch(project_id) or not isinstance(comments, list) or len(comments) > 5000:
            raise ValueError('Invalid project discussion.')
        for comment in comments:
            if (not isinstance(comment, dict) or not SAFE_ID.fullmatch(str(comment.get('id', ''))) or
                    comment.get('authorRole') not in {'member', 'treasurer'} or
                    comment.get('source', 'message') not in {'message', 'review'} or
                    not isinstance(comment.get('authorName'), str) or not comment['authorName'].strip() or len(comment['authorName']) > 500 or
                    not isinstance(comment.get('text'), str) or not comment['text'].strip() or len(comment['text']) > 4000 or
                    not isinstance(comment.get('createdAt'), str) or len(comment['createdAt']) > 100):
                raise ValueError('Invalid project comment.')


def _currency(value):
    value = clean_text(value, 'currency', 3).upper()
    if len(value) != 3 or not value.isalpha():
        raise ValueError('Use a three-letter currency code.')
    return value


def _positive(value, field):
    result = decimal_value(value, field, optional=False)
    if Decimal(result) <= 0:
        raise ValueError(f'{field} must be greater than zero.')
    return result


def validate_line_item(value, stage):
    if not isinstance(value, dict):
        raise ValueError('Invalid project item.')
    item = {
        'name': clean_text(value.get('name', ''), 'Item name', 500),
        'specification': clean_text(value.get('specification', ''), 'Item specification', 2000),
        'unit': clean_text(value.get('unit', 'each'), 'Item unit', 100),
        'vendor': clean_text(value.get('vendor', ''), 'Vendor', 500),
        'productLink': clean_text(value.get('productLink', ''), 'Product link', 2000),
        'priority': clean_text(value.get('priority', 'needed'), 'Priority', 30),
        'inventoryItemId': value.get('inventoryItemId') or None,
    }
    if not item['name'] or not item['unit']:
        raise ValueError('Every project item needs a name and unit.')
    if item['priority'] not in {'needed', 'nice-to-have', 'critical'}:
        raise ValueError('Choose a valid item priority.')
    if item['productLink'] and not item['productLink'].startswith(('https://', 'http://')):
        raise ValueError('Product links must use http:// or https://.')
    if item['inventoryItemId'] is not None and not SAFE_ID.fullmatch(str(item['inventoryItemId'])):
        raise ValueError('Invalid inventory suggestion.')
    item['quantity'] = _positive(value.get('quantity'), 'Item quantity')
    item['unitPrice'] = _positive(value.get('unitPrice'), 'Item unit price')
    return item


def validate_project(value, inventory=None):
    if not isinstance(value, dict):
        raise ValueError('Invalid project submission.')
    stage = value.get('stage')
    if stage not in STAGES:
        raise ValueError('Choose Idea, Planned, or Procurement-ready.')
    estimate = value.get('estimate')
    if not isinstance(estimate, dict):
        raise ValueError('Enter a project cost estimate.')
    result = {
        'title': clean_text(value.get('title', ''), 'Project name', 500),
        'lead': clean_text(value.get('lead', ''), 'Project lead', 500),
        'contact': clean_text(value.get('contact', ''), 'Contact', 500),
        'team': clean_text(value.get('team', ''), 'Team', 2000),
        'description': clean_text(value.get('description', ''), 'Project description', 10000),
        'documentationUrl': clean_text(value.get('documentationUrl', ''), 'Supporting documentation link', 2000),
        'stage': stage,
        'estimate': {
            'amount': _positive(estimate.get('amount'), 'Estimated project cost'),
            'currency': _currency(estimate.get('currency', 'USD')),
            'confidence': estimate.get('confidence'),
            'basis': clean_text(estimate.get('basis', ''), 'Estimate basis', 2000),
        },
        'lineItems': [],
        'nonItemCost': decimal_value(value.get('nonItemCost'), 'Additional cost') or '0',
    }
    if not result['title'] or not result['lead'] or not result['contact'] or not result['description']:
        raise ValueError('Project name, lead, contact, and description are required.')
    if result['documentationUrl'] and not result['documentationUrl'].startswith(('https://', 'http://')):
        raise ValueError('Supporting documentation links must use http:// or https://.')
    if result['estimate']['confidence'] not in CONFIDENCE or not result['estimate']['basis']:
        raise ValueError('Choose estimate confidence and explain the estimate basis.')
    items = value.get('lineItems', [])
    if not isinstance(items, list) or len(items) > 100:
        raise ValueError('A project can have at most 100 purchase items.')
    result['lineItems'] = [validate_line_item(item, stage) for item in items]
    if stage == 'procurement-ready' and not result['lineItems']:
        raise ValueError('A procurement-ready project needs at least one purchase item.')
    if inventory:
        for item in result['lineItems']:
            if item['inventoryItemId'] and item['inventoryItemId'] not in inventory.get('items', {}):
                raise ValueError('An inventory suggestion is no longer available. Refresh and choose again.')
    return result


def validate_projects(doc):
    if not isinstance(doc, dict) or doc.get('schemaVersion') != 1 or type(doc.get('revision')) is not int or doc['revision'] < 0:
        raise ValueError('Invalid projects document.')
    if not isinstance(doc.get('projects'), dict) or not isinstance(doc.get('operations'), dict):
        raise ValueError('Invalid projects document.')
    for project_id, project in doc['projects'].items():
        if not SAFE_ID.fullmatch(project_id) or not isinstance(project, dict):
            raise ValueError('Invalid project ID.')
        validate_project(project)
        if project.get('status') not in PROJECT_STATUS:
            raise ValueError('Invalid project status.')
        for key in ('submittedAt', 'updatedAt'):
            clean_text(project.get(key, ''), key, 100)
        owner = project.get('owner')
        if owner is not None:
            if not isinstance(owner, dict) or not all(isinstance(owner.get(key), str) and owner[key] for key in ('id', 'name', 'email')):
                raise ValueError('Invalid project owner.')
    for operation, receipt in doc['operations'].items():
        if not SAFE_ID.fullmatch(operation) or not isinstance(receipt, dict) or receipt.get('projectId') not in doc['projects']:
            raise ValueError('Invalid project operation history.')


def prepare_project(body, current, inventory, attempts, client, owner=None):
    if not isinstance(body, dict):
        raise ValueError('Invalid project submission.')
    operation = body.get('operationId')
    if not isinstance(operation, str) or not SAFE_ID.fullmatch(operation):
        raise ValueError('A unique submission ID is required.')
    project = validate_project(body.get('project'), inventory)
    if not isinstance(owner, dict) or not all(isinstance(owner.get(key), str) and owner[key] for key in ('id', 'name', 'email')):
        raise ValueError('Sign in with a member account before submitting a project.')
    fingerprint = hashlib.sha256(json.dumps(project, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    if operation in current['operations']:
        receipt = current['operations'][operation]
        if receipt.get('fingerprint') != fingerprint:
            raise ValueError('Submission ID already used. Start a new submission.')
        return None, dict(submitted=True, projectId=receipt['projectId'])
    now = time.time()
    recent = [value for value in attempts.get(client, []) if value > now - 3600]
    if sum(value > now - 60 for value in recent) >= 5 or len(recent) >= 20:
        raise OverflowError('Too many project submissions. Please try again later.')
    attempts[client] = recent + [now]
    doc = copy.deepcopy(current)
    project_id = 'PR-' + secrets.token_hex(16)
    stamp = datetime.now(timezone.utc).isoformat()
    project.update(id=project_id, owner={key: owner[key] for key in ('id', 'name', 'email')}, status='submitted', submittedAt=stamp, updatedAt=stamp)
    doc['projects'][project_id] = project
    doc['operations'][operation] = dict(projectId=project_id, fingerprint=fingerprint)
    doc['revision'] += 1
    return doc, dict(submitted=True, projectId=project_id)


def delete_project(current, project_id):
    if project_id not in current['projects']:
        raise KeyError('Project not found.')
    doc = copy.deepcopy(current)
    del doc['projects'][project_id]
    doc['operations'] = {key: value for key, value in doc['operations'].items() if value.get('projectId') != project_id}
    doc['revision'] += 1
    return doc
