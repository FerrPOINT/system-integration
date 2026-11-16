# Публикация демонстрации

Домен demo.azhukov-dev.ru обслуживается внешним HTTPS-шлюзом и SSH-туннелем.
Команды ниже выполняются из корня проекта на соответствующем сервере.
Это инструкция эксплуатации; локальный Compose не требует настройки шлюза.

На сервере приложений полный стенд запускается с HTTPS-настройками:

```sh
docker compose -f compose.yml -f compose.public.yml --profile app up -d --wait
systemctl status system-integration-tunnel.service
node --test tests/e2e/public.test.mjs
```

`compose.public.yml` включает Secure cookie и автоматическое восстановление
контейнеров после перезапуска Docker. Для локальных HTTP-проверок используйте
основной Compose. UI, восстановление и нагрузка запускаются отдельным
проектом system-integration-load через compose.load.yml; демонстрационный
стенд и его публичный туннель при этих проверках не отключаются.
Команды — в [инструкции нагрузки](../tests/load/README.md).

В `deploy/` сохранены конфигурации Nginx, sshd и systemd. На HTTPS-шлюзе sshd
разрешает отдельной учётке только обратный порт `127.0.0.1:19573`;
ключ и проверенный SSH host key хранятся вне Git. Сервер приложения использует
`/etc/systemd/system/system-integration-tunnel.service` от пользователя
`ferrpoint`. На HTTPS-шлюзе конфигурации установлены в
`/etc/nginx/conf.d/system-integration.conf` и
`/etc/ssh/sshd_config.d/61-system-integration.conf`. После изменения
проверяйте `nginx -t` и `sshd -t` перед reload соответствующей службы.

Сертификат домена обслуживает существующий Certbot. Его deploy hook
`/etc/letsencrypt/renewal-hooks/deploy/demo-certificate` обновляет TLS-файлы,
которые читает общий Xray. TLS-каталог общего gateway сохраняется при обновлении приложения.
Обновление приложения не требует перезапуска общего Xray. Публичный вход ограничивает частоту попыток входа:
10 в минуту на адрес с кратковременным запасом 10 запросов, ответ 429.
