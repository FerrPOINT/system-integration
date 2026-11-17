import { createHash } from 'node:crypto';

export const SEED_VERSION = 'showcase-v1';
export const SCENARIOS = [
  'success',
  'rejected',
  'duplicate',
  'late',
  'waiting',
  'running',
  'unavailable',
  'retry',
  'protocol',
  'difference',
  'conflict',
  'applied',
  'stopped',
  'retried',
  'matched',
  'missing',
  'stale',
  'long',
  'assigned',
  'uncertain',
];
export const STANDARD_TASK_COUNT = 1000;
export const EXAMPLE_TASK_COUNT = SCENARIOS.length * 10;
export const RECENT_TASK_COUNT = 40;
export const TASK_COUNT = STANDARD_TASK_COUNT + EXAMPLE_TASK_COUNT + RECENT_TASK_COUNT;

export function id(name) {
  const hex = createHash('sha256').update(`${SEED_VERSION}/${name}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const goods = [
  'кабельной продукции',
  'крепежа М8',
  'защитных перчаток',
  'гофрокоробов',
  'подшипников',
  'сетевых адаптеров',
  'фильтрующих картриджей',
  'маркировочных этикеток',
  'монтажных комплектов',
  'термоленты',
  'запасных ремней',
  'светильников',
  'инструментальных наборов',
  'упаковочной плёнки',
  'клеммных колодок',
  'контейнеров для хранения',
  'сменных насадок',
  'сигнальных жилетов',
  'шлангов высокого давления',
  'промышленных разъёмов',
  'палетных бортов',
  'датчиков температуры',
  'канцелярских наборов',
  'расходников для принтеров',
  'соединительных муфт',
  'защитных очков',
  'хомутов',
  'профильных направляющих',
  'электродвигателей',
  'ремкомплектов',
  'герметика',
];
const sites = [
  'Новосибирск',
  'Томск',
  'Барнаул',
  'Омск',
  'Красноярск',
  'Кемерово',
  'Бийск',
  'Искитим',
  'Бердск',
  'Абакан',
  'Ачинск',
  'Канск',
  'Юрга',
];
const actions = ['Комплектация', 'Резервирование', 'Перемещение', 'Отгрузка', 'Пополнение', 'Выдача'];

export function catalog() {
  return Array.from({ length: TASK_COUNT }, (_, index) => {
    const exampleIndex = index - STANDARD_TASK_COUNT;
    const scenarioExample = exampleIndex >= 0 && exampleIndex < EXAMPLE_TASK_COUNT;
    const recent = exampleIndex >= EXAMPLE_TASK_COUNT;
    const scenario = scenarioExample
      ? SCENARIOS[exampleIndex % SCENARIOS.length]
      : index % 7 === 0 && !recent
        ? 'rejected'
        : 'success';
    const reference = `REQ-${600001 + index}`;
    const quantity = scenario === 'rejected' ? 101 + ((index * 37) % 900) : 1 + ((index * 17) % 100);
    const title = `${actions[index % actions.length]} ${goods[index % goods.length]} — ${sites[index % sites.length]}, заявка ${reference.slice(4)}`;
    const ownerIndex = scenarioExample ? index + Math.floor(exampleIndex / SCENARIOS.length) : index;
    return {
      index,
      scenario,
      scenarioExample,
      recent,
      reference,
      quantity,
      title,
      owner: ownerIndex % 2 ? 'initiator.two' : 'initiator.one',
      taskId: id(`task/${index}`),
      operationId: id(`operation/${index}`),
    };
  });
}

export const generalIssues = Array.from({ length: 30 }, (_, index) => ({
  index,
  issueId: id(`feed/${index}`),
  resolved: index % 2 === 1,
}));
