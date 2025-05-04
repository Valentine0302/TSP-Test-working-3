/**
 * Container Freight Index (CFI) Scraper Module
 * ==========================================================
 *
 * Этот модуль читает данные ИСКЛЮЧИТЕЛЬНО из таблицы index_config базы данных.
 * Заглушка создана, так как оригинального файла cfi_scraper.js не было.
 *
 * @module cfi_scraper
 * @author Manus AI Integration
 * @version 1.1.0 (ESM Export)
 * @last_updated 2025-05-04
 */

// Импорт необходимых модулей (ESM)
import pg from 'pg'; // Клиент PostgreSQL для работы с базой данных
const { Pool } = pg;
import dotenv from 'dotenv'; // Модуль для загрузки переменных окружения

/**
 * Загрузка переменных окружения из файла .env
 */
dotenv.config();

/**
 * Настройка подключения к базе данных PostgreSQL
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Необходимо для некоторых облачных баз данных
    // sslmode: 'require' // Раскомментируйте, если ваша БД требует SSL
  },
});

/**
 * Функция для получения данных CFI ИЗ БАЗЫ ДАННЫХ для использования в калькуляторе.
 *
 * @async
 * @function getCfiDataForCalculation
 * @returns {Promise<Object|null>} Объект с данными CFI { current_index, index_date } или null при ошибке.
 */
async function getCfiDataForCalculation() {
  console.log('[cfi_scraper] Запрос данных CFI из таблицы index_config...');
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT current_value, last_updated FROM index_config WHERE index_name = $1',
      ['CFI']
    );
    if (result.rows.length > 0) {
      const data = {
        current_index: parseFloat(result.rows[0].current_value),
        index_date: result.rows[0].last_updated, // Используем дату обновления из БД
        change: null // Поле change больше не актуально при чтении из БД
      };
      console.log('[cfi_scraper] Данные CFI получены из БД:', data);
      return data;
    } else {
      console.error('[cfi_scraper] Ошибка: Индекс CFI не найден в таблице index_config.');
      return null;
    }
  } catch (error) {
    console.error('[cfi_scraper] Ошибка при запросе данных CFI из БД:', error);
    return null;
  } finally {
    client.release();
  }
}

// --- Заглушка для возможного будущего кода веб-скрапинга --- 
async function fetchCfiData() {
  console.log("=== [ЗАГЛУШКА] Функция fetchCfiData не реализована ===");
  return []; 
}

// Экспорт новой функции для калькулятора и заглушки старой функции (ESM)
export { 
  getCfiDataForCalculation, // Новая функция для чтения из БД
  fetchCfiData // Заглушка функции веб-скрапинга
};

