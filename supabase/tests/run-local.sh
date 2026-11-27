#!/usr/bin/env bash
# Applies the migrations to a fresh Postgres database and runs the permission
# tests. Expects a running Postgres with PostGIS, reachable via the usual PG* environment
# variables (PGHOST, PGPORT, PGUSER, PGPASSWORD). Used by CI.
set -euo pipefail

cd "$(dirname "$0")/.."
DB="${TEST_DB:-glovebox_test}"

psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/auth_stub.sql
for migration in migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$migration"
done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/permissions_test.sql
