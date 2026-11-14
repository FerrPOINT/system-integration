"""Inspect every JDBC call on isolated test DBs; all fixtures are rolled back."""
from pathlib import Path
import datetime, hashlib, itertools, json, re, subprocess, textwrap

ROOT=Path(__file__).resolve().parents[2]
if Path.cwd().resolve()!=ROOT:raise RuntimeError('Run from the repository root')
OUT=ROOT/'tests/results/sql-plans'
CONTAINER='system-integration-load-postgres-1'
def uid(n): return f'00000000-0000-0000-0000-{n:012d}'
T,O,U,I,R,K,C=uid(1),uid(100001),uid(900001),uid(200001),uid(300001),uid(400001),uid(800001)
NT,NO=uid(10001),uid(110001)
def sql_literal(v):
 if v is None:return 'NULL'
 if isinstance(v,bool):return 'true' if v else 'false'
 if isinstance(v,(int,float)):return str(v)
 return "'"+str(v).replace("'","''")+"'"
def bind(sql, values):
 chunks=sql.split('?')
 if len(chunks)-1!=len(values):raise ValueError((sql,values))
 return ''.join(a+sql_literal(b) for a,b in zip(chunks,values))+chunks[-1]
from jdbc_inventory import collect

inventory=collect(['backend/src/main/java','emulator/src/main/java'])
cases=[]
def add(key,sql,values=(),variant='default',fixture='base'):
 cases.append({'callSite':key,'variant':variant,'database':inventory[key]['database'],'sql':bind(sql,values),'template':sql,'parameters':list(values),'fixture':fixture})
def static(key,params=(),variant='default'):
 strings=inventory[key]['strings']
 assert len(strings)==1,(key,strings)
 add(key,strings[0],params,variant)

result=json.dumps({'operationId':O,'request':{'reference':'REQ-100001','quantity':25},'version':2,'status':'SUCCEEDED','completedAt':'2026-01-02T00:00:00Z'})
params={
'JdbcCommandReceiptRepository.lock/3:1':['actor:command:key'],'JdbcCommandReceiptRepository.find/3:1':[U,'CREATE_TASK',K],'JdbcCommandReceiptRepository.insert/6:1':[U,'NEW_COMMAND',K,'probe',201,'{}'],
'DemoUsers.run/1:1':[uid(900004),'sql.probe','not-a-login-secret','INITIATOR'],'JdbcUserDetailsService.loadUserByUsername/1:1':['sql.owner.one'],
'JdbcTaskRepository.insert/2:1':[NT,U,NO,'probe','REQ-110001',25],'JdbcExchangeRepository.enqueue/1:1':[uid(105001)],'JdbcTaskRepository.rename/3:1':[ 'changed',2,T],
'JdbcTaskRepository.history/5:1':[uid(600001),T,O,'USER',U,'RENAMED','probe','{}'],'JdbcTaskRepository.countHistory/1:1':[T],'JdbcTaskRepository.history/3:1':[T,20,0],
'JdbcExchangeRepository.lockDueExchange/0:1':[],'JdbcExchangeRepository.lockQueue/1:1':[O],'JdbcExchangeRepository.startAttempt/4:1':[C,2,O],'JdbcExchangeRepository.startAttempt/4:2':[C,O,2,'PUT'],
'JdbcExchangeRepository.finishAttempt/2:1':['ACK',uid(500002)],'JdbcExchangeRepository.ownsClaim/2:1':[uid(100002),uid(500002)],
'JdbcExchangeRepository.scheduleAfterInterruptedClaim/3:1':['2026-01-01T00:00:00Z',5,O],'JdbcExchangeRepository.scheduleRetry/3:1':['GET',5,O],'JdbcExchangeRepository.pauseQueue/1:1':[O],'JdbcExchangeRepository.resumeDelivery/1:1':[O],
'JdbcExchangeRepository.removeQueue/1:1':[O],'JdbcExchangeRepository.delivery/2:1':['RETRY_WAIT',O,'RETRY_WAIT'],'JdbcExchangeRepository.applyResult/1:1':[result,'SUCCEEDED',O],
'JdbcExchangeRepository.advanceCursor/1:1':[100],
'JdbcReviewRepository.open/6:1':[uid(210001),T,O,O,'new-fingerprint','PROTOCOL_ERROR','probe','{}'],
'JdbcReviewRepository.open/6:2':[O,'seed'],'JdbcReviewRepository.temporary/1:1':[uid(2)],'JdbcReviewRepository.delay/2:1':['probe',uid(200002),'probe'],'JdbcReviewRepository.confirm/1:1':[uid(2)],
'JdbcReviewRepository.protocol/3:1':['probe','{}',uid(200002)],'JdbcReviewRepository.observationIssue/1:1':[T],
'JdbcTaskRepository.observe/4:1':[uid(600002),T,O,'Observed external result','{"resultVersion":2}',result,'observation'],
'JdbcReviewRepository.count/1:1':[],'JdbcReviewRepository.count/1:2':['OPEN'],'JdbcReviewRepository.assign/2:1':[uid(900003),I],
'JdbcReviewRepository.active/1:1':[T],'JdbcReviewRepository.saveReconciliation/2:1':[uid(310001),T,1,'2026-01-01T00:00:00Z',uid(900003),'{}'],
'JdbcReviewRepository.saveReconciliation/2:2':[R,T],'JdbcReviewRepository.reconciliation/2:1':[R,T],'JdbcReviewRepository.resumeDelivery/2:1':['probe',I],
'JdbcReviewRepository.resolve/2:1':['{"decision":"STOP","reason":"probe"}',I],
'JdbcOperationRepository.get/1:1':[O],'JdbcOperationRepository.lockNext/0:1':[],'JdbcOperationRepository.events/2:1':[0,100],
'JdbcOperationRepository.fault/1:1':[O],'JdbcOperationRepository.event/3:1':[O,1,1,result,False],
'JdbcOperationRepository.lockOperation/1:1':[O],'JdbcOperationRepository.exists/1:1':[O],'JdbcOperationRepository.lockFault/1:1':['REQ-100001'],
'JdbcOperationRepository.insert/2:1':[NO,'REQ-110001',25],'JdbcOperationRepository.bindFault/2:1':[uid(100003),'REQ-100002'],
'JdbcOperationRepository.complete/1:1':[result,'2026-01-02T00:00:00Z',O],'JdbcOperationRepository.publish/1:1':[],
'JdbcOperationRepository.publish/1:2':[25],'JdbcOperationRepository.publish/1:3':[20001,uid(105001),1,0],'JdbcOperationRepository.publish/1:4':[20001],
'JdbcOperationRepository.lockFaultConfiguration/1:1':['fault:REQ-100001'],'JdbcOperationRepository.configure/2:1':['REQ-100002','DELAY_RESULT'],
'JdbcOperationRepository.releaseEvents/1:1':[uid(105001)],'JdbcOperationRepository.releaseEvents/1:2':[uid(105001)],'JdbcOperationRepository.clearFault/1:1':['REQ-100001']}
for key,values in params.items():static(key,values)
for batch in [1,10,50]:static('JdbcOperationRepository.publish/1:2',[batch],f'batch={batch}')
static('JdbcExchangeRepository.ownsClaim/2:1',[uid(100006),uid(500006)],'active-lease-owned')
static('JdbcReviewRepository.temporary/1:1',[T],'no-temporary-issue')
static('JdbcReviewRepository.confirm/1:1',[T],'no-temporary-issue')
for operator,locked,exists in itertools.product([False,True],repeat=3):
 add('JdbcTaskRepository.get/3:1','SELECT * FROM tasks WHERE id = ?'+('' if operator else ' AND owner_id = ?')+(' FOR UPDATE' if locked else ''),
     ([T if exists else uid(999999)] if operator else [T if exists else uid(999999),U]),f'operator={operator},lock={locked},exists={exists}')
for locked in [False,True]:
 add('JdbcExchangeRepository.exchange/2:1','SELECT * FROM tasks WHERE operation_id = ?'+(' FOR UPDATE' if locked else ''),[O],f'lock={locked}')
 add('JdbcExchangeRepository.cursor/1:1','SELECT last_cursor FROM incoming_position WHERE id = 1'+(' FOR UPDATE' if locked else ''),[],f'lock={locked}')
for n in [1,20,100]:
 add('JdbcExchangeRepository.exchangeByTask/1:1','SELECT * FROM tasks WHERE id IN ('+','.join('?'*n)+')',[uid(i+1) for i in range(n)],f'ids={n}')
 add('JdbcReviewRepository.reconciliations/1:1','SELECT snapshot::text,exchange_version FROM reconciliations WHERE id IN ('+','.join('?'*n)+')',[uid(i+300001) for i in range(n)],f'ids={n}')
for n in [1,20,100]:
 add('JdbcExchangeRepository.lockExchanges/1:1','SELECT * FROM tasks WHERE operation_id IN ('+','.join('?'*n)+') ORDER BY id FOR UPDATE',
     [uid(i+100001) for i in range(n)],f'ids={n}')
for operator,status,lower,upper in itertools.product([False,True],[None,'PENDING','RUNNING','SUCCEEDED','REJECTED'],[False,True],[False,True]):
 conditions=' WHERE true'; values=[]
 if not operator: conditions+=' AND owner_id = ?';values.append(U)
 if status:conditions+=' AND business_status = ?';values.append(status)
 if lower:conditions+=' AND created_at >= ?';values.append('2025-12-01T00:00:00Z')
 if upper:conditions+=' AND created_at < ?';values.append('2027-01-01T00:00:00Z')
 variant=f'operator={operator},status={status},from={lower},to={upper}'
 for offset in [0,9000,20000]:
  add('JdbcTaskRepository.list/6:1','SELECT * FROM tasks'+conditions+' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',values+[20,offset],variant+f',offset={offset}')
 add('JdbcTaskRepository.countTasks/4:1','SELECT count(*) FROM tasks'+conditions,values,variant)
issue_select=re.search(r'ISSUE_SELECT = """(.*?)"""',Path(inventory['JdbcReviewRepository.get/2:1']['file']).read_text(),re.S).group(1)
for locked in [False,True]:
 add('JdbcReviewRepository.get/2:1',issue_select+' WHERE i.id = ?'+(' FOR UPDATE OF i' if locked else ''),[I],f'lock={locked}')
for status,offset in itertools.product([None,'OPEN','RESOLVED'],[0,900,2000]):
 add('JdbcReviewRepository.list/3:1',issue_select+(' WHERE i.status = ?' if status else '')+' ORDER BY i.opened_at DESC,i.id DESC LIMIT ? OFFSET ?',
     [status,20,offset] if status else [20,offset],f'status={status},offset={offset}')

# Selective and empty date windows, minority/missing owners, and a deep hot history.
for owner in [uid(900002),uid(999999)]:
 for status in [None,'PENDING','RUNNING','SUCCEEDED','REJECTED']:
  where=' WHERE owner_id = ?'+(' AND business_status = ?' if status else '')
  values=[owner,status] if status else [owner]
  add('JdbcTaskRepository.list/6:1','SELECT * FROM tasks'+where+' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',values+[20,0],f'owner={owner},status={status}')
  add('JdbcTaskRepository.countTasks/4:1','SELECT count(*) FROM tasks'+where,values,f'owner={owner},status={status}')
for start,end in [('2026-01-01T01:00:00Z','2026-01-01T01:00:20Z'),('2030-01-01T00:00:00Z','2030-01-02T00:00:00Z')]:
 for operator in [False,True]:
  where=' WHERE true'+('' if operator else ' AND owner_id = ?')+' AND created_at >= ? AND created_at < ?'
  values=[] if operator else [U]
  values += [start,end]
  add('JdbcTaskRepository.list/6:1','SELECT * FROM tasks'+where+' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',values+[20,0],f'operator={operator},window={start}/{end}')
  add('JdbcTaskRepository.countTasks/4:1','SELECT count(*) FROM tasks'+where,values,f'operator={operator},window={start}/{end}')
static('JdbcTaskRepository.history/3:1',[T,20,1000],'hot-history-deep-page')

# Temporal correlation: same physical fixture for bound and literal-status probes.
for operator,status,binding in itertools.product([False,True],['SUCCEEDED','PENDING'],['parameter','literal']):
 where=' WHERE true'+('' if operator else ' AND owner_id = ?')
 values=[] if operator else [U]
 if binding=='parameter':
  where+=' AND business_status = ?';values.append(status)
 else:where+=" AND business_status = '"+status+"'"
 add('JdbcTaskRepository.list/6:1','SELECT * FROM tasks'+where+' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
     values+[20,0],f'operator={operator},status={status},binding={binding},backlog-head','recent-backlog')
 add('JdbcTaskRepository.countTasks/4:1','SELECT count(*) FROM tasks'+where,values,
     f'operator={operator},status={status},binding={binding},backlog-count','recent-backlog')

# Representative UI page sizes, including both accepted boundaries.
for size in [1,7,100]:
 add('JdbcTaskRepository.list/6:1','SELECT * FROM tasks WHERE true ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',[size,0],f'size={size}')
 add('JdbcReviewRepository.list/3:1',issue_select+' ORDER BY i.opened_at DESC,i.id DESC LIMIT ? OFFSET ?',[size,0],f'size={size}')
 static('JdbcTaskRepository.history/3:1',[T,size,0],f'size={size}')

covered={c['callSite'] for c in cases}
assert set(inventory)==covered, {'uncovered':sorted(set(inventory)-covered),'stale':sorted(covered-set(inventory))}
app_fixture="""
INSERT INTO users VALUES ('00000000-0000-0000-0000-000000900001','sql.owner.one','not-a-login-secret','INITIATOR'),
('00000000-0000-0000-0000-000000900002','sql.owner.two','not-a-login-secret','INITIATOR'),
('00000000-0000-0000-0000-000000900003','sql.operator','not-a-login-secret','OPERATOR');
INSERT INTO tasks(id,owner_id,operation_id,title,request_reference,request_quantity,delivery_status,business_status,created_at)
SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
('00000000-0000-0000-0000-'||CASE WHEN i%10=0 THEN '000000900002' ELSE '000000900001' END)::uuid,
('00000000-0000-0000-0000-'||lpad((100000+i)::text,12,'0'))::uuid,
'SQL baseline '||i,'REQ-'||(100000+i),25,
CASE WHEN i%4=0 THEN 'ACKNOWLEDGED' WHEN i%4=1 THEN 'QUEUED' WHEN i%4=2 THEN 'UNKNOWN' ELSE 'NEEDS_REVIEW' END,
CASE WHEN i%4=0 THEN 'SUCCEEDED' WHEN i%4=1 THEN 'PENDING' WHEN i%4=2 THEN 'RUNNING' ELSE 'REJECTED' END,
'2026-01-01'::timestamptz+i*interval '1 second' FROM generate_series(1,10000) i;
INSERT INTO delivery_queue(operation_id,due_at,claim_id,claimed_until)
SELECT operation_id,clock_timestamp()-id::text::uuid::text::text::int*interval '1 second',NULL,NULL FROM tasks WHERE false;
INSERT INTO delivery_queue(operation_id,due_at,claim_id,claimed_until)
SELECT operation_id,clock_timestamp()+CASE WHEN i%5=0 THEN interval '1 hour' ELSE interval '-1 hour' END,
CASE WHEN i%3=0 THEN ('00000000-0000-0000-0000-'||lpad((500000+i)::text,12,'0'))::uuid END,
CASE WHEN i%3=0 THEN clock_timestamp()+CASE WHEN i%2=0 THEN interval '1 hour' ELSE interval '-1 hour' END END
FROM tasks CROSS JOIN LATERAL (SELECT right(id::text,12)::int i) n WHERE i<=5000;
INSERT INTO delivery_attempts(id,operation_id,number,step)
SELECT ('00000000-0000-0000-0000-'||lpad((500000+i)::text,12,'0'))::uuid,operation_id,1,'PUT'
FROM tasks CROSS JOIN LATERAL (SELECT right(id::text,12)::int i) n WHERE i<=5000;
INSERT INTO task_history(id,task_id,operation_id,actor,event_type,summary)
SELECT md5('history:'||n)::uuid,t.id,t.operation_id,'SYSTEM','RESULT_APPLIED','SQL baseline'
FROM generate_series(1,20000) n JOIN tasks t ON t.id=('00000000-0000-0000-0000-'||lpad(((n%10000)+1)::text,12,'0'))::uuid;
INSERT INTO task_history(id,task_id,operation_id,actor,event_type,summary)
SELECT md5('hot-history:'||n)::uuid,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000100001','SYSTEM','RESULT_IGNORED','SQL hot history'
FROM generate_series(1,1000)n;
INSERT INTO exchange_issues(id,task_id,operation_id,scope,fingerprint,kind,status,summary,evidence)
SELECT ('00000000-0000-0000-0000-'||lpad((200000+i)::text,12,'0'))::uuid,id,operation_id,operation_id::text,'seed',
CASE WHEN i%2=0 THEN 'DELIVERY_UNCERTAIN' ELSE 'PROTOCOL_ERROR' END,
CASE WHEN i%4=0 THEN 'RESOLVED' ELSE 'OPEN' END,'SQL issue','{}'
FROM tasks CROSS JOIN LATERAL (SELECT right(id::text,12)::int i) n WHERE i<=1000;
INSERT INTO reconciliations(id,task_id,exchange_version,checked_at,checked_by,snapshot)
SELECT ('00000000-0000-0000-0000-'||lpad((300000+i)::text,12,'0'))::uuid,id,1,clock_timestamp(),
'00000000-0000-0000-0000-000000900003','{}'
FROM tasks CROSS JOIN LATERAL (SELECT right(id::text,12)::int i) n WHERE i<=1000;
INSERT INTO command_receipts(actor_id,command_type,idempotency_key,fingerprint,http_status,response_body)
SELECT '00000000-0000-0000-0000-000000900001','CREATE_TASK',
('00000000-0000-0000-0000-'||lpad((400000+i)::text,12,'0'))::uuid,'seed',201,'{}'
FROM generate_series(1,10000)i;
ANALYZE users; ANALYZE tasks; ANALYZE delivery_queue; ANALYZE delivery_attempts; ANALYZE task_history; ANALYZE exchange_issues; ANALYZE reconciliations; ANALYZE command_receipts;
"""
# The fixtures are SQL-plan data, not a cross-database functional/release dataset.
app_fixture=app_fixture.replace("""INSERT INTO delivery_queue(operation_id,due_at,claim_id,claimed_until)
SELECT operation_id,clock_timestamp()-id::text::uuid::text::text::int*interval '1 second',NULL,NULL FROM tasks WHERE false;
""",'')
emu_fixture="""
INSERT INTO operations(id,reference,quantity,accepted_at)
SELECT ('00000000-0000-0000-0000-'||lpad((100000+i)::text,12,'0'))::uuid,'REQ-'||(100000+i),25,
'2026-01-01'::timestamptz+i*interval '1 second' FROM generate_series(1,10000)i;
INSERT INTO faults(reference,mode,bound_operation_id) VALUES ('REQ-100001','DELAY_RESULT','00000000-0000-0000-0000-000000100001');
INSERT INTO result_events(operation_id,version,copy_number,cursor,payload,publish_after)
SELECT id,v,0,CASE WHEN i<=5000 THEN 2*i+v-2 END,'{}',
CASE WHEN i%10=0 THEN NULL ELSE clock_timestamp() END
FROM operations CROSS JOIN LATERAL (SELECT right(id::text,12)::int-100000 i)n CROSS JOIN generate_series(1,2)v;
UPDATE feed_position SET last_cursor=10000 WHERE id=1;
ANALYZE operations; ANALYZE faults; ANALYZE result_events;
"""
hot_backlog_fixture="""
UPDATE tasks SET business_status=CASE WHEN right(id::text,12)::int<=5000 THEN 'SUCCEEDED' ELSE 'PENDING' END,
owner_id=CASE WHEN right(id::text,12)::int%2=0 THEN '00000000-0000-0000-0000-000000900001'::uuid ELSE '00000000-0000-0000-0000-000000900002'::uuid END;
INSERT INTO tasks(id,owner_id,operation_id,title,request_reference,request_quantity,delivery_status,business_status,created_at)
SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
CASE WHEN i%2=0 THEN '00000000-0000-0000-0000-000000900001'::uuid ELSE '00000000-0000-0000-0000-000000900002'::uuid END,
('00000000-0000-0000-0000-'||lpad((100000+i)::text,12,'0'))::uuid,'Recent backlog '||i,'REQ-'||(100000+i),25,'QUEUED','PENDING',
'2026-01-02'::timestamptz+i*interval '1 second' FROM generate_series(30001,40000)i;
ANALYZE tasks;
"""
scenario_sql={
 'base':'',
 'recent-backlog':hot_backlog_fixture
}
def psql(db,sql):
 return subprocess.check_output(['docker','exec','-i',CONTAINER,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','si_admin','-d',db],
                                 input=sql,text=True,stderr=subprocess.PIPE)
# Dedicated DBs must be unused. Ordinary databases are never selected as a mutation target.
active=psql('postgres',"SELECT count(*) FROM pg_stat_activity WHERE datname IN ('si_test','si_emulator_test');").strip()
if active!='0':raise RuntimeError('Test databases have active sessions; refusing fixture run')
for db,table in [('si_test','tasks'),('si_emulator_test','operations')]:
 if psql(db,f'SELECT count(*) FROM {table};').strip()!='0':raise RuntimeError('Test databases must be empty; no implicit reset')
OUT.mkdir(parents=True,exist_ok=True)
plans=[]
for db,fixture in [('si_test',app_fixture),('si_emulator_test',emu_fixture)]:
 commands=['BEGIN;',fixture]
 for scenario,setup in scenario_sql.items():
  if not any(c['database']==db and c['fixture']==scenario for c in cases):continue
  commands.extend(['SAVEPOINT fixture_scenario;',setup])
  for c in cases:
    if c['database']!=db or c['fixture']!=scenario:continue
    marker=json.dumps({'callSite':c['callSite'],'variant':c['variant'],'fixture':scenario},separators=(',',':'))
    commands.extend(['SAVEPOINT probe;',r'\echo CASE:'+marker,'EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) '+c['sql']+';','ROLLBACK TO SAVEPOINT probe;'])
    template=c['template']
    for index in range(template.count('?')):template=template.replace('?', '$'+str(index+1),1)
    for mode in ['force_custom_plan','force_generic_plan']:
     prepared_meta=json.dumps({'callSite':c['callSite'],'variant':c['variant'],'planMode':mode,'fixture':scenario},separators=(',',':'))
     arguments='('+','.join(sql_literal(v) for v in c['parameters'])+')' if c['parameters'] else ''
     commands.extend(['SAVEPOINT probe;',f'SET LOCAL plan_cache_mode={mode};','PREPARE sql_probe AS '+template+';',
      r'\echo CASE:'+prepared_meta,'EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) EXECUTE sql_probe'+arguments+';',
      'DEALLOCATE sql_probe;','ROLLBACK TO SAVEPOINT probe;'])
  commands.append('ROLLBACK TO SAVEPOINT fixture_scenario;')
 commands.append('ROLLBACK;')
 try:raw=psql(db,'\n'.join(commands))
 except subprocess.CalledProcessError as error:
  (OUT/f'{db}-error.txt').write_text(error.stderr)
  raise RuntimeError(error.stderr) from error
 (OUT/f'{db}-raw.txt').write_text(raw)
 for chunk in raw.split('CASE:')[1:]:
  meta,body=chunk.split('\n',1);meta=json.loads(meta)
  plan,_=json.JSONDecoder().raw_decode(body.lstrip())
  plans.append({**meta,'database':db,'explain':plan[0]})
 assert psql(db,'SELECT count(*) FROM '+('tasks' if db=='si_test' else 'operations')+';').strip()=='0'
summary={'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),

 'fixture':{'tasks':10000,'temporalBacklog':{'oldSucceeded':5000,'recentPending':15000,'comparison':'bound versus enum-literal status on the same fixture; existing V6 index'},'history':21000,'queue':5000,'issues':1000,'operations':10000,'events':20000,'rolledBack':True},
 'limitations':['Synthetic SQL-plan fixtures, not end-to-end load qualification','Prepared parameter types are inferred by PostgreSQL; JDBC bind types may differ for arithmetic expressions',
                'Single-session EXPLAIN does not establish concurrent lock or CPU causality','No normal application data changed'],
 'callSites':list(inventory.values()),'cases':cases,'plans':plans}
(OUT/'report.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
slow=sorted(plans,key=lambda p:p['explain']['Execution Time'],reverse=True)[:12]
print(json.dumps({'callSites':len(inventory),'cases':len(cases),'plans':len(plans),'fixtureRolledBack':True,
 'slowest':[{'callSite':p['callSite'],'variant':p['variant'],'fixture':p['fixture'],'ms':p['explain']['Execution Time'],'node':p['explain']['Plan']['Node Type']} for p in slow]},ensure_ascii=False,indent=2))
