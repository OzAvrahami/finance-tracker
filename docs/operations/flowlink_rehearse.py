"""Build reviewed reference snapshots and test comparisons in portless disposable PG.
Never reads .env/DB URLs or connects to production. Docker is the only database transport.
Usage: python3 docs/operations/flowlink_rehearse.py --output /private/tmp/fli90-reference
"""
import argparse
import copy
import json
import os
from pathlib import Path
import subprocess
import time
from flowlink_compare import read, compare

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True)
parser.add_argument('--postgres-major', type=int, choices=(16, 17), default=16)
args = parser.parse_args()
out = Path(args.output).resolve()
if out == root or root in out.parents:
    raise SystemExit('Evidence must be outside the repository.')
out.mkdir(mode=0o700, parents=True, exist_ok=False)
os.umask(0o077)
container = f'finance-fli90-rollout-{os.getpid()}'
started = False
checks = 0

def run(cmd, text=None):
    result = subprocess.run(['docker', *cmd], input=text, text=True, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout

def sql(db, text):
    return run(['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1'], text)

def snapshot(stage):
    path = out / f'{stage}.jsonl'
    path.write_text(sql('rehearsal', (root/'docs/operations/sql/flowlink_snapshot.sql').read_text()))
    return read(path)

def check(condition, description):
    global checks
    if not condition: raise AssertionError(description)
    checks += 1

try:
    run(['run', '-d', '--rm', '--name', container, '--label', 'finance.disposable=fli90-rollout', '-e', 'POSTGRES_PASSWORD=local_test_only', f'postgres:{args.postgres_major}-alpine'])
    started = True
    info = json.loads(run(['inspect', container]))[0]
    check(not info['HostConfig']['PortBindings'], 'portless container')
    for _ in range(100):
        ready = subprocess.run(['docker', 'exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True).returncode == 0
        if ready: break
        time.sleep(.2)
    if not ready: raise RuntimeError('Disposable DB not ready')
    sql('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE DATABASE rehearsal;')
    full = (root/'server/full_schema.sql').read_text()
    sql('rehearsal', full.split('-- Migration 037:')[0])
    sql('rehearsal', "INSERT INTO categories(name) VALUES('Rollout rehearsal'); INSERT INTO payment_sources(id,name,slug,method) VALUES(1,'Fixture','fixture','credit_card'); INSERT INTO transactions(transaction_date,movement_type,total_amount,description) VALUES('2026-09-26','expense',4.00,'Disposable fixture');")
    baseline = snapshot('036')
    check(not compare(baseline, baseline), '036 self-check')
    sql('rehearsal', (root/'server/migrations/037_flowlink_device_enrollment.sql').read_text())
    after37 = snapshot('037')
    check(not compare(after37, after37, baseline), '037 preserves full baseline')
    check(len([k for k in after37 if k[0]=='data' and k[1].startswith('flowlink_')])==3, '037 three relations')
    sql('rehearsal', (root/'server/migrations/038_flowlink_card_bindings.sql').read_text())
    after38 = snapshot('038')
    check(not compare(after38, after38, baseline), '038 preserves full baseline')
    check(len([k for k in after38 if k[0]=='data' and k[1].startswith('flowlink_')])==5, '038 five total relations')
    sql('postgres', 'CREATE DATABASE consolidated;')
    sql('consolidated', full)
    final = out/'consolidated.jsonl'
    final.write_text(sql('consolidated', (root/'docs/operations/sql/flowlink_snapshot.sql').read_text()))
    check(not compare(after38, read(final)), 'ordered 037/038 catalog matches consolidated schema')
    sql('rehearsal', """INSERT INTO flowlink_devices(id,label,created_by) VALUES('11111111-1111-4111-8111-111111111111','Fixture','22222222-2222-4222-8222-222222222222');
    SELECT public.create_flowlink_binding('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
      '{"device_id":"11111111-1111-4111-8111-111111111111","label":"Fixture card","payment_source_id":"1"}');""")
    enrolled = snapshot('enrolled')
    check(not compare(after38, enrolled, baseline, enrolled=True), 'enrollment changes no financial/domain data')
    check(bool(compare(after38, enrolled, baseline)), 'pre-enrollment mode rejects existing identity')
    # Reject actual permission/RLS drift, not only fabricated comparator inputs.
    sql('rehearsal','GRANT SELECT ON public.flowlink_card_bindings TO authenticated;')
    check(any('relation:flowlink_card_bindings' in e for e in compare(after38,snapshot('bad-grant'),baseline,True)), 'reject browser grant')
    sql('rehearsal','REVOKE SELECT ON public.flowlink_card_bindings FROM authenticated; ALTER TABLE public.flowlink_card_bindings DISABLE ROW LEVEL SECURITY;')
    check(any('relation:flowlink_card_bindings' in e for e in compare(after38,snapshot('bad-rls'),baseline,True)), 'reject disabled RLS')
    sql('rehearsal','ALTER TABLE public.flowlink_card_bindings ENABLE ROW LEVEL SECURITY; GRANT EXECUTE ON FUNCTION public.ingest_flowlink_observation(bytea,jsonb) TO PUBLIC;')
    check(any('function:ingest_flowlink_observation' in e for e in compare(after38,snapshot('bad-rpc'),baseline,True)), 'reject public money RPC')
    sql('rehearsal',"REVOKE EXECUTE ON FUNCTION public.ingest_flowlink_observation(bytea,jsonb) FROM PUBLIC; UPDATE public.categories SET name='Changed';")
    check('Financial/domain baseline changed: data:categories' in compare(after38,snapshot('bad-domain'),baseline,True), 'reject supporting domain mutation')
    sql('rehearsal',"UPDATE public.transactions SET total_amount=5.00;")
    check('Financial/domain baseline changed: data:transactions' in compare(after38,snapshot('bad-financial'),baseline,True), 'reject transaction mutation')
    corrupt = copy.deepcopy(after38)
    corrupt[('data','flowlink_devices')]['count']=1
    check(bool(compare(after38,corrupt,baseline)), 'reject prior enrollment')
    print(f'{checks} rollout rehearsal checks passed; 0 failed. Reference snapshots: {out}')
finally:
    if started: run(['rm','-f',container])
