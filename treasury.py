"""Treasurer-only planning records, deliberately separate from project requests."""
import copy
from datetime import datetime, timezone
import secrets

from inventory import SAFE_ID, clean_text, decimal_value

# `planned` and `approved` are retained only so existing saved records remain
# readable during the vocabulary transition. New budget decisions use the
# explicit `approved-for-budget` value; external OSL funding is stored
# separately on the Treasury record.
REVIEW_STATUS = {'needs-review', 'needs-details', 'approved-for-budget', 'declined', 'planned', 'approved'}
DECISION_STATUS = {'needs-details', 'approved-for-budget', 'declined'}
FUNDING_STATUS = {'not-requested', 'pending', 'osl-funded', 'declined'}


def review_message(status, value):
    if not isinstance(value, str):
        raise ValueError('Invalid member-visible decision message.')
    value = value.strip()
    if len(value) > 4000:
        raise ValueError('Decision messages must be 4,000 characters or fewer.')
    if status in DECISION_STATUS and not value:
        raise ValueError('Add a member-visible decision message for Approved for budget, Declined, or Needs details.')
    return value


def empty_treasury():
    return dict(schemaVersion=1, revision=0, records={}, operations={})


def _amount(value):
    return decimal_value(value, 'Approved amount') if value not in (None, '') else None


def validate_treasury(doc):
    if not isinstance(doc, dict) or doc.get('schemaVersion') != 1 or type(doc.get('revision')) is not int or doc['revision'] < 0:
        raise ValueError('Invalid treasury document.')
    if not isinstance(doc.get('records'), dict) or not isinstance(doc.get('operations'), dict):
        raise ValueError('Invalid treasury document.')
    for project_id, record in doc['records'].items():
        if not SAFE_ID.fullmatch(project_id) or not isinstance(record, dict) or record.get('status') not in REVIEW_STATUS:
            raise ValueError('Invalid treasury record.')
        for key, limit in [('planningPeriod', 100), ('fundingSource', 500), ('notes', 4000)]:
            clean_text(record.get(key, ''), key, limit)
        if record.get('fundingStatus', 'not-requested') not in FUNDING_STATUS:
            raise ValueError('Invalid funding status.')
        amount = _amount(record.get('approvedAmount'))
        currency = clean_text(record.get('currency', ''), 'currency', 3).upper()
        if amount is not None and (len(currency) != 3 or not currency.isalpha()):
            raise ValueError('An approved amount needs a three-letter currency.')
        if not isinstance(record.get('history', []), list) or len(record['history']) > 200:
            raise ValueError('Invalid treasury history.')
    for operation, receipt in doc['operations'].items():
        if not SAFE_ID.fullmatch(operation) or not isinstance(receipt, dict) or receipt.get('projectId') not in doc['records']:
            raise ValueError('Invalid treasury operation history.')


def update_record(body, current, projects, actor):
    if not isinstance(body, dict):
        raise ValueError('Invalid treasury update.')
    project_id = body.get('projectId')
    if not isinstance(project_id, str) or project_id not in projects:
        raise ValueError('Project not found.')
    operation = body.get('operationId')
    if not isinstance(operation, str) or not SAFE_ID.fullmatch(operation):
        raise ValueError('A unique operation ID is required.')
    if operation in current['operations']:
        return current, current['operations'][operation]
    if type(body.get('revision')) is not int or body['revision'] != current['revision']:
        raise ValueError('Treasury changed in another session. Refresh and review the latest record.')
    record = body.get('record')
    if not isinstance(record, dict):
        raise ValueError('Invalid treasury record.')
    status = record.get('status')
    if status not in REVIEW_STATUS:
        raise ValueError('Choose a valid treasury status.')
    funding_status = record.get('fundingStatus', 'not-requested')
    if funding_status not in FUNDING_STATUS:
        raise ValueError('Choose a valid funding status.')
    approved = _amount(record.get('approvedAmount'))
    currency = clean_text(record.get('currency', projects[project_id]['estimate']['currency']), 'currency', 3).upper()
    if approved is not None and (len(currency) != 3 or not currency.isalpha()):
        raise ValueError('An approved amount needs a three-letter currency.')
    doc = copy.deepcopy(current)
    prior = doc['records'].get(project_id, {})
    stamp = datetime.now(timezone.utc).isoformat()
    saved = dict(
        status=status,
        planningPeriod=clean_text(record.get('planningPeriod', ''), 'Planning period', 100),
        fundingSource=clean_text(record.get('fundingSource', ''), 'Funding source', 500) or 'IIT',
        approvedAmount=approved,
        currency=currency,
        notes=clean_text(record.get('notes', ''), 'Treasury notes', 4000),
        fundingStatus=funding_status,
        history=prior.get('history', []) + [dict(at=stamp, actor=actor, status=status, approvedAmount=approved, currency=currency)],
        updatedAt=stamp,
    )
    doc['records'][project_id] = saved
    doc['revision'] += 1
    result = dict(saved=True, projectId=project_id, revision=doc['revision'])
    doc['operations'][operation] = result
    return doc, result
