import { mkdir, writeFile } from 'node:fs/promises';
import { RECENT_TASK_COUNT, SCENARIOS, TASK_COUNT } from './catalog.mjs';

export function showcaseDirectory(target) {
  if (target !== 'load' && target !== 'demo') throw new Error('Unsupported showcase target');
  return new URL(`../tests/results/showcase/${target}/`, import.meta.url);
}

export async function writeShowcase(result) {
  const results = showcaseDirectory(result.target);
  await mkdir(results, { recursive: true });
  await writeFile(new URL('showcase.json', results), JSON.stringify(result, null, 2));
  const escape = (value) =>
    String(value)
      .replaceAll(/([\\|\[\]])/g, '\\$1')
      .replaceAll(/[\r\n]/g, ' ');
  const links = SCENARIOS.map((scenario) => {
    const item = result.examples.find((item) => item.scenario === scenario);
    return `| ${scenario} | [${escape(item.title)}](${item.url}) | ${item.issueUrl ? `[Открыть разбор](${item.issueUrl})` : '—'} |`;
  });
  await writeFile(
    new URL('showcase.md', results),
    `# Демонстрационные примеры\n\n${TASK_COUNT} заданий, по ${TASK_COUNT / 2} у каждого инициатора. В начале реестра ${RECENT_TASK_COUNT} завершённых заданий с совпадающей сверкой. Вход: initiator.one, initiator.two или operator; пароль — из приватного .env. Для разбора и сверок нужен operator.\n\nНазвания и статусы отражают последнюю проверку; ваши изменения при повторной загрузке сохраняются. Кратковременные состояния очереди наблюдаются в живых сценариях.\n\n| Сценарий | Задание | Разбор |\n| --- | --- | --- |\n${links.join('\n')}\n\n${result.generalIssues
      .slice(0, 2)
      .map((issue) => `[Общая проблема ленты: ${issue.status}](${issue.url})`)
      .join(' · ')}\n`,
  );
}
