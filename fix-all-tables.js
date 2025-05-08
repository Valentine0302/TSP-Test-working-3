import pg from 'pg';
const { Pool } = pg;

async function fixAllTables() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const client = await pool.connect();
    console.log('Подключились к базе данных!');

    // calculation_config
    await client.query(`
      ALTER TABLE IF EXISTS calculation_config
      ALTER COLUMN destination_port TYPE INTEGER USING destination_port::integer,
      ALTER COLUMN container_type TYPE INTEGER USING container_type::integer
    `);

    // base_rates
    await client.query(`
      ALTER TABLE IF EXISTS base_rates
      ALTER COLUMN container_type_id TYPE INTEGER USING container_type_id::integer
    `);

    // calculation_history
    await client.query(`
      ALTER TABLE IF EXISTS calculation_history
      ALTER COLUMN container_type_id TYPE INTEGER USING container_type_id::integer
    `);

    console.log('Все нужные колонки исправлены!');
    await client.release();
  } catch (error) {
    console.error('Ошибка:', error);
  } finally {
    await pool.end();
  }
}

fixAllTables();
