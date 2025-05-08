import pg from 'pg';
const { Pool } = pg;

async function checkTableExists() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const client = await pool.connect();

    // Проверяем существование таблицы calculation_config
    const res = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_tables WHERE tablename = 'calculation_config'
      ) AS table_exists;
    `);

    if (res.rows[0].table_exists) {
      console.log('Таблица calculation_config существует.');
    } else {
      console.log('Таблица calculation_config НЕ существует.');
    }

    client.release();
  } catch (error) {
    console.error('Ошибка при проверке таблицы:', error);
  } finally {
    await pool.end();
  }
}

checkTableExists();
