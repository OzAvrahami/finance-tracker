"""Offline comparison only. Does not connect to any database or apply SQL.
Usage: python3 flowlink_compare.py EXPECTED_STAGE.jsonl ACTUAL.jsonl [BASELINE.jsonl] [--enrolled]
References must be generated from the reviewed commit on disposable PostgreSQL.
"""
import json
import sys
from pathlib import Path


def read(path):
    rows = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    result = {}
    for row in rows:
        key = (row['kind'], row.get('object', ''))
        if key in result:
            raise ValueError('Duplicate evidence entry')
        result[key] = row
    if ('environment', '') not in result or ('totals', 'transactions') not in result:
        raise ValueError('Incomplete snapshot')
    return result


def compare(expected, actual, baseline=None, enrolled=False):
    errors = []
    for key in set(expected) | set(actual):
        if key[0] in ('environment', 'catalog') and expected.get(key) != actual.get(key):
            errors.append('Schema/security mismatch: ' + ':'.join(key))
    # New FlowLink relations must be empty BEFORE first enrollment/binding.
    for key, value in actual.items():
        if not enrolled and key[0] == 'data' and key[1].startswith('flowlink_') and value['count'] != 0:
            errors.append('Unexpected pre-enrollment rows: ' + key[1])
    if not enrolled and actual.get(('invariants', 'apy'), {}).get('flowlink_sources') != 0:
        errors.append('Unexpected pre-enrollment FlowLink APY source')
    for field in ('flowlink_observations', 'flowlink_financial_events'):
        if actual.get(('invariants', 'apy'), {}).get(field) != 0:
            errors.append('Unexpected financial FlowLink evidence: ' + field)
    if enrolled and baseline is None:
        errors.append('Enrollment verification requires the original baseline')
    if baseline:
        for key, value in baseline.items():
            if enrolled and (key[0] == 'invariants' or (key[0] == 'data' and (key[1].startswith('flowlink_') or key[1] in ('transaction_ingestion_sources', 'transaction_reconciliation_events')))):
                continue
            if key[0] in ('data', 'totals', 'invariants', 'legacy_apy') and actual.get(key) != value:
                errors.append('Financial/domain baseline changed: ' + ':'.join(key))
            if key[0] == 'catalog' and actual.get(key) != value:
                errors.append('Existing schema/security changed: ' + key[1])
        for key in actual.keys() - baseline.keys():
            if key[0] == 'data' and not key[1].startswith('flowlink_'):
                errors.append('Unexpected domain table: ' + key[1])
    return errors


if __name__ == '__main__':
    enrolled = '--enrolled' in sys.argv
    if enrolled: sys.argv.remove('--enrolled')
    if len(sys.argv) not in (3, 4):
        raise SystemExit(__doc__)
    errors = compare(read(sys.argv[1]), read(sys.argv[2]), read(sys.argv[3]) if len(sys.argv) == 4 else None, enrolled)
    if errors:
        raise SystemExit('\n'.join(errors))
    print('PASS: exact reference catalog/security; zero FlowLink financial observations/events; baseline unchanged (only enrollment/source configuration additions allowed with --enrolled).')
