#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_password SI_DB_PASSWORD
\getenv emulator_password SI_EMULATOR_DB_PASSWORD
\getenv test_password SI_TEST_DB_PASSWORD
\getenv emulator_test_password SI_EMULATOR_TEST_DB_PASSWORD
CREATE ROLE si_app LOGIN PASSWORD :'app_password';
CREATE ROLE si_emulator LOGIN PASSWORD :'emulator_password';
CREATE ROLE si_test LOGIN PASSWORD :'test_password';
CREATE ROLE si_emulator_test LOGIN PASSWORD :'emulator_test_password';
CREATE DATABASE si_app OWNER si_app;
CREATE DATABASE si_emulator OWNER si_emulator;
CREATE DATABASE si_test OWNER si_test;
CREATE DATABASE si_emulator_test OWNER si_emulator_test;
REVOKE CONNECT ON DATABASE si_app, si_emulator, si_test, si_emulator_test FROM PUBLIC;
SQL
