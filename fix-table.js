import pg from 'pg';
const { Pool } = pg;

async function fixTable() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const client = await pool.connect();
    console.log('Подключились к базе данных!');

    // Меняем типы колонок на INTEGER
    await client.query(`
      ALTER TABLE calculation_config
      ALTER COLUMN destination_port TYPE INTEGER USING destination_port::integer,
      ALTER COLUMN container_type TYPE INTEGER USING container_type::integer
    `);

    console.log('Типы колонок исправлены!');
    await client.release();
  } catch (error) {
    console.error('Ошибка:', error);
  } finally {
    await pool.end();
  }
}

fixTable();
