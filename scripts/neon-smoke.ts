/*
  Simple Neon connectivity smoke test.
  Usage (PowerShell):
    # Either set DATABASE_URL or POSTGRES_URL in .env or env, then:
    bun scripts/neon-smoke.ts
*/

import 'dotenv/config';
import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

function buildClient(): Client {
  if (databaseUrl) {
    return new Client({ connectionString: databaseUrl });
  }
  const host = process.env.PGHOST;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const database = process.env.PGDATABASE;
  const port = process.env.PGPORT ? Number(process.env.PGPORT) : 5432;
  if (!host || !user || !database) {
    console.error(
      'No DATABASE_URL/POSTGRES_URL and PG* env not sufficient. See: https://neon.com/docs/get-started/connect-neon'
    );
    process.exit(1);
  }
  const sslNeeded = /\.neon\.tech$/i.test(host);
  return new Client({ host, user, password, database, port, ssl: sslNeeded ? { rejectUnauthorized: false } : undefined });
}

async function main() {
  const client = buildClient();
  try {
    await client.connect();
    console.log('Connected to Neon.');

    const now = await client.query('select now() as now');
    console.log('now():', now.rows[0]);

    // 1) Query carriers table using provided schema sample
    try {
      const carriers = await client.query(
        'select id, name, code, mode, country, is_active from carriers limit 10'
      );
      console.log('Sample carriers:', carriers.rows);
    } catch (cerr: any) {
      if (cerr && cerr.code === '42P01') {
        console.warn('Table "carriers" not found. Listing public tables...');
        const tables = await client.query(
          "select table_name from information_schema.tables where table_schema='public' order by table_name limit 50"
        );
        console.log('Public tables:', tables.rows);
      } else {
        console.warn('Could not query carriers:', cerr.message || cerr);
      }
    }

    // 2) Best-effort rates table check
    try {
      const sampleRates = await client.query(
        'select origin, destination, mode, carrier_id, base_rate, rate_per_lb, transit_days from rates limit 5'
      );
      console.log('Sample rates:', sampleRates.rows);
    } catch (rerr: any) {
      if (rerr && (rerr.code === '42P01' || rerr.code === '42703')) {
        console.warn('Rates query failed (missing table/columns). Describing available columns for rates if present...');
        try {
          const cols = await client.query(
            "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='rates' order by ordinal_position"
          );
          if (cols.rows.length) {
            console.log('rates columns:', cols.rows);
          } else {
            console.log('No rates table found.');
          }
        } catch (descErr) {
          console.warn('Could not inspect rates columns:', (descErr as any)?.message || descErr);
        }
      } else {
        console.warn('Rates query error:', rerr.message || rerr);
      }
    }
  } catch (err) {
    console.error('Neon smoke test failed:', err);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main();


