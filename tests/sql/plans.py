"""Inspect every JDBC call on isolated test DBs; all fixtures are rolled back."""
from pathlib import Path
import datetime, hashlib, itertools, json, re, subprocess, textwrap

ROOT=Path(__file__).resolve().parents[2]
if Path.cwd().resolve()!=ROOT:raise RuntimeError('Run from the repository root')
OUT=ROOT/'tests/results/sql-plans'
CONTAINER='system-integration-postgres-1'
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
def first_arg(s,start):
 pos=start; depth=0; tokens=[]; chars=[]
 while pos<len(s):
  if s.startswith('"""',pos):
   end=s.index('"""',pos+3)
   raw=textwrap.dedent(s[pos+3:end]).strip()
   tokens.append(raw); chars.append('SQL_LITERAL');pos=end+3;continue
  if s[pos]=='"':
   end=pos+1
   while end<len(s):
    if s[end]=='\\':end+=2;continue
    if s[end]=='"':break
    end+=1
   tokens.append(json.loads(s[pos:end+1]));chars.append('SQL_LITERAL');pos=end+1;continue
  ch=s[pos]
  if ch==',' and depth==0:break
  if ch=='(':depth+=1
  if ch==')':
   if depth==0:break
   depth-=1
  chars.append(ch);pos+=1
 return s[start:pos],tokens
inventory={}
for base in ['backend/src/main/java','backend/emulator/src/main/java']:
 for p in sorted(Path(base).rglob('*.java')):
  s=p.read_text()
  for index,m in enumerate(re.finditer(r'\bjdbc\.(\w+)\(',s),1):
   if m.group(1) not in {'queryForObject','query','update'}:
    raise RuntimeError('Add SQL coverage for '+str(p)+': '+m.group(1))
   expression,strings=first_arg(s,m.end()); key=f'{p.stem}:{index}'
   inventory[key]={'id':key,'file':str(p),'line':s.count('\n',0,m.start())+1,'expression':expression,
                   'sourceSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'strings':strings,
                   'database':'si_emulator_test' if '/emulator/' in str(p) else 'si_test'}
assert inventory, 'No JDBC calls found'
cases=[]
def add(key,sql,values=(),variant='default'):
 cases.append({'callSite':key,'variant':variant,'database':inventory[key]['database'],'sql':bind(sql,values),'template':sql,'parameters':list(values)})
def static(key,params=(),variant='default'):
 strings=inventory[key]['strings']
 assert len(strings)==1,(key,strings)
 add(key,strings[0],params,variant)

result=json.dumps({'operationId':O,'request':{'reference':'REQ-100001','quantity':25},'version':2,'status':'SUCCEEDED','completedAt':'2026-01-02T00:00:00Z'})
params={
'CommandReceipts:1':['actor:command:key'],'CommandReceipts:2':[U,'CREATE_TASK',K],'CommandReceipts:3':[U,'NEW_COMMAND',K,'probe',201,'{}'],
'DemoUsers:1':[uid(900004),'sql.probe','not-a-login-secret','INITIATOR'],'SecurityConfiguration:1':['sql.owner.one'],
'TaskRepository:6':[NT,U,NO,'probe','REQ-110001',25],'TaskRepository:7':[uid(105001)],'TaskRepository:8':[ 'changed',2,T],
'TaskRepository:9':[uid(600001),T,O,'USER',U,'RENAMED','probe','{}'],'TaskRepository:10':[T],'TaskRepository:11':[T,0],
'TaskRepository:12':[],'TaskRepository:13':[O],'TaskRepository:14':[C,2,O],'TaskRepository:15':[C,O,2,'PUT'],
'TaskRepository:16':['ACK',uid(500002)],'TaskRepository:17':[uid(100002),uid(500002)],
'TaskRepository:18':['2026-01-01T00:00:00Z',5,O],'TaskRepository:19':['GET',5,O],'TaskRepository:20':[O],
'TaskRepository:21':[O],'TaskRepository:22':['RETRY_WAIT',O,'RETRY_WAIT'],'TaskRepository:23':[result,'SUCCEEDED',O],
'TaskRepository:25':[100],
'ExchangeIssues:1':[uid(210001),T,O,O,'new-fingerprint','PROTOCOL_ERROR','probe','{}'],
'ExchangeIssues:2':[O,'seed'],'ExchangeIssues:3':[T],'ExchangeIssues:4':[I],'ExchangeIssues:5':[T],'ExchangeIssues:6':[T],
'ExchangeIssues:7':['probe','{}',I],'ExchangeIssues:8':[T],
'ExchangeIssues:9':[uid(600002),T,O,'{"resultVersion":2}',result,'observation'],
'ExchangeIssues:11':[],'ExchangeIssues:12':['OPEN'],'ExchangeIssues:14':[uid(900003),I],
'ExchangeIssues:15':[T],'ExchangeIssues:16':[uid(310001),T,1,'2026-01-01T00:00:00Z',uid(900003),'{}'],
'ExchangeIssues:17':[R,T],'ExchangeIssues:18':[R,T],'ExchangeIssues:20':[I],'ExchangeIssues:21':[I],
'ExchangeIssues:22':['{"decision":"STOP","reason":"probe"}',I],
'OperationRepository:1':[O],'OperationRepository:2':[],'OperationRepository:3':[0,100],
'OperationRepository:4':[O],'OperationRepository:5':[O,1,1,result,False],
'OperationRepository:6':[O],'OperationRepository:7':[O],'OperationRepository:8':['REQ-100001'],
'OperationRepository:9':[NO,'REQ-110001',25],'OperationRepository:10':[uid(100003),'REQ-100002'],
'OperationRepository:11':[result,'2026-01-02T00:00:00Z',O],'OperationRepository:12':[],
'OperationRepository:13':[],'OperationRepository:14':[20001,O,1,0],'OperationRepository:15':[20001],
'OperationRepository:16':['fault:REQ-100001'],'OperationRepository:17':['REQ-100002','DELAY_RESULT'],
'OperationRepository:18':[O],'OperationRepository:19':['REQ-100001']}
for key,values in params.items():static(key,values)
for operator,locked,exists in itertools.product([False,True],repeat=3):
 add('TaskRepository:1','SELECT * FROM tasks WHERE id = ?'+('' if operator else ' AND owner_id = ?')+(' FOR UPDATE' if locked else ''),
     ([T if exists else uid(999999)] if operator else [T if exists else uid(999999),U]),f'operator={operator},lock={locked},exists={exists}')
for locked in [False,True]:
 add('TaskRepository:2','SELECT * FROM tasks WHERE operation_id = ?'+(' FOR UPDATE' if locked else ''),[O],f'lock={locked}')
 add('TaskRepository:24','SELECT last_cursor FROM incoming_position WHERE id = 1'+(' FOR UPDATE' if locked else ''),[],f'lock={locked}')
for n in [1,20,100]:
 add('TaskRepository:3','SELECT * FROM tasks WHERE id IN ('+','.join('?'*n)+')',[uid(i+1) for i in range(n)],f'ids={n}')
 add('ExchangeIssues:19','SELECT snapshot::text,exchange_version FROM reconciliations WHERE id IN ('+','.join('?'*n)+')',[uid(i+300001) for i in range(n)],f'ids={n}')
for operator,status,lower,upper in itertools.product([False,True],[None,'PENDING','RUNNING','SUCCEEDED','REJECTED'],[False,True],[False,True]):
 conditions=' WHERE true'; values=[]
 if not operator: conditions+=' AND owner_id = ?';values.append(U)
 if status:conditions+=' AND business_status = ?';values.append(status)
 if lower:conditions+=' AND created_at >= ?';values.append('2025-12-01T00:00:00Z')
 if upper:conditions+=' AND created_at < ?';values.append('2027-01-01T00:00:00Z')
 variant=f'operator={operator},status={status},from={lower},to={upper}'
 for offset in [0,9000,20000]:
  add('TaskRepository:4','SELECT * FROM tasks'+conditions+' ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ?',values+[offset],variant+f',offset={offset}')
 add('TaskRepository:5','SELECT count(*) FROM tasks'+conditions,values,variant)
issue_select=re.search(r'ISSUE_SELECT = """(.*?)"""',Path(inventory['ExchangeIssues:10']['file']).read_text(),re.S).group(1)
for locked in [False,True]:
 add('ExchangeIssues:10',issue_select+' WHERE i.id = ?'+(' FOR UPDATE OF i' if locked else ''),[I],f'lock={locked}')
for status,offset in itertools.product([None,'OPEN','RESOLVED'],[0,900,2000]):
 add('ExchangeIssues:13',issue_select+(' WHERE i.status = ?' if status else '')+' ORDER BY i.opened_at DESC,i.id DESC LIMIT 20 OFFSET ?',
     [status,offset] if status else [offset],f'status={status},offset={offset}')

# Selective and empty date windows, minority/missing owners, and a deep hot history.
for owner in [uid(900002),uid(999999)]:
 for status in [None,'PENDING','RUNNING','SUCCEEDED','REJECTED']:
  where=' WHERE owner_id = ?'+(' AND business_status = ?' if status else '')
  values=[owner,status] if status else [owner]
  add('TaskRepository:4','SELECT * FROM tasks'+where+' ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ?',values+[0],f'owner={owner},status={status}')
  add('TaskRepository:5','SELECT count(*) FROM tasks'+where,values,f'owner={owner},status={status}')
for start,end in [('2026-01-01T01:00:00Z','2026-01-01T01:00:20Z'),('2030-01-01T00:00:00Z','2030-01-02T00:00:00Z')]:
 for operator in [False,True]:
  where=' WHERE true'+('' if operator else ' AND owner_id = ?')+' AND created_at >= ? AND created_at < ?'
  values=[] if operator else [U]
  values += [start,end]
  add('TaskRepository:4','SELECT * FROM tasks'+where+' ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ?',values+[0],f'operator={operator},window={start}/{end}')
  add('TaskRepository:5','SELECT count(*) FROM tasks'+where,values,f'operator={operator},window={start}/{end}')
static('TaskRepository:11',[T,1000],'hot-history-deep-page')

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
 for c in cases:
  if c['database']!=db:continue
  marker=json.dumps({'callSite':c['callSite'],'variant':c['variant']},separators=(',',':'))
  commands.extend(['SAVEPOINT probe;',r'\echo CASE:'+marker,'EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) '+c['sql']+';','ROLLBACK TO SAVEPOINT probe;'])
  template=c['template']
  for index in range(template.count('?')):template=template.replace('?', '$'+str(index+1),1)
  for mode in ['force_custom_plan','force_generic_plan']:
   prepared_meta=json.dumps({'callSite':c['callSite'],'variant':c['variant'],'planMode':mode},separators=(',',':'))
   arguments='('+','.join(sql_literal(v) for v in c['parameters'])+')' if c['parameters'] else ''
   commands.extend(['SAVEPOINT probe;',f'SET LOCAL plan_cache_mode={mode};','PREPARE sql_probe AS '+template+';',
    r'\echo CASE:'+prepared_meta,'EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) EXECUTE sql_probe'+arguments+';',
    'DEALLOCATE sql_probe;','ROLLBACK TO SAVEPOINT probe;'])
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

 'fixture':{'tasks':10000,'history':21000,'queue':5000,'issues':1000,'operations':10000,'events':20000,'rolledBack':True},
 'limitations':['Synthetic SQL-plan fixtures, not end-to-end load qualification','Prepared parameter types are inferred by PostgreSQL; JDBC bind types may differ for arithmetic expressions',
                'Single-session EXPLAIN does not establish concurrent lock or CPU causality','No normal application data changed'],
 'callSites':list(inventory.values()),'cases':cases,'plans':plans}
(OUT/'report.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
slow=sorted(plans,key=lambda p:p['explain']['Execution Time'],reverse=True)[:12]
print(json.dumps({'callSites':len(inventory),'cases':len(cases),'plans':len(plans),'fixtureRolledBack':True,
 'slowest':[{'callSite':p['callSite'],'variant':p['variant'],'ms':p['explain']['Execution Time'],'node':p['explain']['Plan']['Node Type']} for p in slow]},ensure_ascii=False,indent=2))
