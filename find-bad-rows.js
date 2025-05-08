import pg from 'pg';
const { Pool } = pg;

async function findBadRows() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const client = await pool.connect();
    console.log('Поиск некорректных данных...');

    // Проверяем таблицу base_rates
    const badRows = await client.query(`
      SELECT * FROM base_rates 
      WHERE container_type_id ~ '\\D' -- Ищем строки с НЕ цифрами
    `);

    console.log('Найдены проблемные строки:', badRows.rows);
    await client.release();
  } catch (error) {
    console.error('Ошибка:', error);
  } finally {
    await pool.end();
  }
}

findBadRows();
