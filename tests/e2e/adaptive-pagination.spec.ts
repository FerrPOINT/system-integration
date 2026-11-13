import { test, expect, type Page, type Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { login } from './support';
import { loadEnvironment } from '../load/environment.mjs';

test.setTimeout(90_000);

async function create(page: Page, title: string) {
  const { token } = await (await page.request.get('/api/csrf')).json();
  const response = await page.request.post('/api/tasks', {
    headers: { 'X-CSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID() },
    data: { title, request: { reference: 'REQ-870001', quantity: 25 } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).taskId as string;
}

async function settled(page: Page, region: Locator) {
  await expect.poll(async () => {
    if (!new URL(page.url()).searchParams.has('size')) return false;
    return region.getAttribute('aria-busy').then(value => value === 'false');
  }).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(region).toHaveAttribute('aria-busy','false');
}

async function fits(page: Page, region: Locator) {
  await expect.poll(() => region.evaluate(element => {
    const viewport=element.querySelector('.paged-viewport')!;
    const area=viewport.getBoundingClientRect();
    const items=[...element.querySelectorAll('[data-page-item]')];
    const footer=element.querySelector('.pagination-footer')!.getBoundingClientRect();
    return {
      footerVisible: footer.bottom <= innerHeight + 1,
      separated: area.bottom <= footer.top,
      itemsFit: items.every(item => item.getBoundingClientRect().bottom <= area.bottom + 1) || (items.length===1 && items[0].getBoundingClientRect().height>area.height && viewport.scrollHeight>viewport.clientHeight),
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
    };
  })).toEqual({footerVisible:true,separated:true,itemsFit:true,noHorizontalOverflow:true});
}

async function collect(page: Page, region: Locator, links: string) {
  const ids=new Set<string>();
  for (let attempt=0;attempt<100;attempt++) {
    await settled(page,region);
    await fits(page,region);
    for (const href of await region.locator(links).evaluateAll(elements => elements.map(element => element.getAttribute('href')!))) {
      expect(ids.has(href)).toBe(false); ids.add(href);
    }
    const next=region.getByRole('button',{name:'Далее →',exact:true});
    if (!(await next.isEnabled())) return ids;
    const previous=new URL(page.url()).searchParams.get('page') || '0';
    await next.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).not.toBe(previous);
  }
  throw new Error('Pagination did not terminate');
}

test('UI-15: tasks fit the viewport, enumerate every record and keep filters through resize', async ({page}, info) => {
  loadEnvironment();
  await login(page);
  const from=new Date().toISOString();
  const ids=new Set<string>();
  for (let index=0;index<40;index++) ids.add('/tasks/'+await create(page,
    'E2E адаптивная пагинация: проверить отправку заявки и отображение результата обработки '+String(index).padStart(3,'0')));
  await page.goto('/tasks?createdFrom='+encodeURIComponent(from));
  const region=page.locator('section.paged-list');
  await expect(region.locator('[data-page-item]').first()).toBeVisible();
  const links='.task-card h2 a, .task-table tbody a';
  const seen=await collect(page,region,links);
  expect(seen).toEqual(ids);
  const first=new URL(page.url()); first.searchParams.set('page','0');
  await page.goto(first.toString());
  await settled(page,region);
  await region.getByRole('button',{name:'Страница 2',exact:true}).click();
  await settled(page,region);
  const anchor=await region.locator(links).first().getAttribute('href');
  const oldSize=Number(new URL(page.url()).searchParams.get('size'));
  const width=page.viewportSize()!.width;
  await page.setViewportSize({width,height:1600});
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('size'))).toBeGreaterThan(oldSize);
  await settled(page,region);
  await expect(region.locator('a[href="'+anchor+'"]')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('createdFrom')).toBe(from);
  await fits(page,region);
  const larger=Number(new URL(page.url()).searchParams.get('size'));
  await page.setViewportSize({width,height:620});
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('size'))).toBeLessThan(larger);
  await settled(page,region);
  await fits(page,region);
  await page.screenshot({path:info.outputPath('adaptive-tasks.png')});
});

test('UI-15: empty results retain navigation at the bottom including a short mobile viewport', async ({page}) => {
  loadEnvironment();
  await login(page);
  await page.goto('/tasks?createdFrom=2100-01-01T00%3A00%3A00Z');
  const region=page.locator('section.paged-list');
  await expect(page.getByText('Ничего не найдено',{exact:true})).toBeVisible();
  for (const viewport of [page.viewportSize()!,{width:390,height:480}]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => region.locator('.pagination-footer').evaluate(element => {
      const rect=element.getBoundingClientRect(); return innerHeight-rect.bottom;
    })).toBeLessThanOrEqual(25);
    await expect(region.getByRole('button',{name:'← Назад',exact:true})).toBeDisabled();
    await expect(region.getByRole('button',{name:'Далее →',exact:true})).toBeDisabled();
    await fits(page,region);
  }
});

test('UI-15: issue grid uses the same server window without losing entries', async ({page}, info) => {
  const postgres=loadEnvironment().find(item => item.service==='postgres')!;
  const ids=Array.from({length:8},() => crypto.randomUUID());
  const sql=(input: string) => execFileSync('docker',['exec','-i',postgres.containerId,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','si_admin','-d','si_test'],{input,encoding:'utf8'});
  sql(ids.map((id,index) => "INSERT INTO exchange_issues(id,scope,fingerprint,kind,summary,evidence) VALUES ('"+id+"','pagination:"+id+"','"+id+"','PROTOCOL_ERROR','E2E проверка отображения длинной диагностики обмена и решения оператора, запись "+index+"','{\"reason\":\"Изолированная UI-проверка\"}'::jsonb);").join('\n'));
  try {
    await login(page,'operator');
    await page.goto('/issues?status=OPEN');
    const region=page.locator('section.paged-list');
    await expect(region.locator('[data-page-item]').first()).toBeVisible();
    const seen=await collect(page,region,'.issue-cards h2 a');
    for (const id of ids) expect(seen.has('/issues/'+id)).toBe(true);
    await page.screenshot({path:info.outputPath('adaptive-issues.png')});
  } finally { sql("DELETE FROM exchange_issues WHERE id IN ("+ids.map(id => "'"+id+"'").join(',')+");"); }
});

test('UI-15: history fits its panel and exposes every saved event', async ({page}, info) => {
  loadEnvironment();
  await login(page);
  const id=await create(page,'E2E история с адаптивной пагинацией');
  const { token }=await (await page.request.get('/api/csrf')).json();
  let revision=(await (await page.request.get('/api/tasks/'+id)).json()).titleRevision;
  for (let index=0;index<26;index++) {
    const response=await page.request.patch('/api/tasks/'+id,{
      headers:{'X-CSRF-TOKEN':token,'Idempotency-Key':crypto.randomUUID()},
      data:{title:'E2E история с адаптивной пагинацией, уточнение '+index,expectedTitleRevision:revision},
    });
    expect(response.status()).toBe(200); revision=(await response.json()).titleRevision;
  }
  await expect.poll(async () => (await (await page.request.get('/api/tasks/'+id)).json()).businessStatus).toBe('SUCCEEDED');
  const expected=(await (await page.request.get('/api/tasks/'+id+'/history?size=100')).json()).items.map((event:{eventId:string}) => event.eventId);
  await page.goto('/tasks/'+id);
  const region=page.locator('.history-panel .paged-list');
  await expect(region.locator('[data-page-item]').first()).toBeVisible();
  await page.locator('.history-panel').scrollIntoViewIfNeeded();
  const seen=new Set<string>();
  for (let attempt=0;attempt<100;attempt++) {
    await settled(page,region);
    await region.scrollIntoViewIfNeeded();
    await fits(page,region);
    for (const id of await region.locator('[data-page-item]').evaluateAll(elements => elements.map(element => element.getAttribute('data-event-id')!))) {
      expect(seen.has(id)).toBe(false); seen.add(id);
    }
    const next=region.getByRole('button',{name:'Далее →',exact:true});
    if (!(await next.isEnabled())) break;
    await next.click();
  }
  expect(seen).toEqual(new Set(expected));
  await expect(region).toContainText('Задание принято и поставлено в очередь');
  await page.screenshot({path:info.outputPath('adaptive-history.png')});
});
