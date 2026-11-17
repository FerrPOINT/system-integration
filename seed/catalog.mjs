import { createHash } from 'node:crypto';

export const SEED_VERSION = 'showcase-v1';
export const TASK_COUNT = 1200;
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
    const scenario =
      index < 1000 ? (index % 7 === 0 ? 'rejected' : 'success') : SCENARIOS[(index - 1000) % SCENARIOS.length];
    const reference = `REQ-${600001 + index}`;
    const quantity = scenario === 'rejected' ? 101 + ((index * 37) % 900) : 1 + ((index * 17) % 100);
    const title = `${actions[index % actions.length]} ${goods[index % goods.length]} — ${sites[index % sites.length]}, заявка ${reference.slice(4)}`;
    const ownerIndex = index < 1000 ? index : index + Math.floor((index - 1000) / SCENARIOS.length);
    return {
      index,
      scenario,
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
