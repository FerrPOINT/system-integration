import { mkdir, writeFile } from 'node:fs/promises';
import { SCENARIOS } from './catalog.mjs';

export async function writeShowcase(result) {
  const results = new URL('../tests/results/', import.meta.url);
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
    `# Демонстрационные примеры\n\n1200 заданий, по 600 у каждого инициатора. Вход: initiator.one, initiator.two или operator; пароль — из приватного .env. Для разбора и сверок нужен operator.\n\nНазвания и статусы отражают последнюю проверку; ваши изменения при повторной загрузке сохраняются. Кратковременные состояния очереди наблюдаются в живых сценариях.\n\n| Сценарий | Задание | Разбор |\n| --- | --- | --- |\n${links.join('\n')}\n\n${result.generalIssues
      .slice(0, 2)
      .map((issue) => `[Общая проблема ленты: ${issue.status}](${issue.url})`)
      .join(' · ')}\n`,
  );
}
