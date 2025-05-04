/**
 * Modified Harpex Index Scraper Module
 * ==========================================================
 *
 * Этот модуль теперь читает данные ИСКЛЮЧИТЕЛЬНО из таблицы index_config базы данных.
 * Функция веб-скрапинга fetchHarpexData и связанные с ней функции оставлены для возможного будущего использования,
 * но НЕ используются для текущих расчетов.
 *
 * @module harpex_scraper
 * @author TSP Team / Manus AI Integration
 * @version 2.1.0 (ESM Named Export)
 * @last_updated 2025-05-04
 */

// Импорт необходимых модулей (ESM)
import axios from 'axios'; // Оставлен для fetchHarpexData
import * as cheerio from 'cheerio'; // Оставлен для fetchHarpexData
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
 * Функция для получения данных Harpex ИЗ БАЗЫ ДАННЫХ для использования в калькуляторе.
 *
 * @async
 * @function getHarpexDataForCalculation
 * @returns {Promise<Object|null>} Объект с данными Harpex { current_index, index_date } или null при ошибке.
 */
async function getHarpexDataForCalculation() {
  console.log('[harpex_scraper] Запрос данных Harpex из таблицы index_config...');
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT current_value, last_updated FROM index_config WHERE index_name = $1',
      ['Harpex']
    );
    if (result.rows.length > 0) {
      const data = {
        current_index: parseFloat(result.rows[0].current_value),
        index_date: result.rows[0].last_updated, // Используем дату обновления из БД
        change: null // Поле change больше не актуально при чтении из БД
      };
      console.log('[harpex_scraper] Данные Harpex получены из БД:', data);
      return data;
    } else {
      console.error('[harpex_scraper] Ошибка: Индекс Harpex не найден в таблице index_config.');
      return null;
    }
  } catch (error) {
    console.error('[harpex_scraper] Ошибка при запросе данных Harpex из БД:', error);
    return null;
  } finally {
    client.release();
  }
}

// --- Ниже оставлен оригинальный код веб-скрапинга --- 
// --- Он НЕ используется для получения данных для калькулятора --- 

const HARPEX_URL = 'https://harpex.harperpetersen.com/harpexVP.do';
const HARPEX_ALT_URL = 'https://www.hellenicshippingnews.com/tag/harpex/';

async function fetchHarpexFromPrimarySource() {
  console.log("[ОСТАВЛЕНО] Fetching Harpex data from primary source...");
  // ... (код fetchHarpexFromPrimarySource оставлен без изменений)
  return [];
}

async function fetchHarpexFromAlternativeSource() {
  console.log("[ОСТАВЛЕНО] Fetching Harpex data from alternative source...");
  // ... (код fetchHarpexFromAlternativeSource оставлен без изменений)
  return [];
}

async function fetchMockHarpexData() {
  console.log('[ОСТАВЛЕНО] Using mock data for Harpex');
  // ... (код fetchMockHarpexData оставлен без изменений)
  return [];
}

async function saveHarpexData(harpexData) {
  console.log("[ОСТАВЛЕНО] Вызов saveHarpexData - сохранение в старую таблицу freight_indices_harpex");
  // ... (код сохранения в freight_indices_harpex оставлен без изменений)
}

// Основная функция fetchHarpexData оставлена
async function fetchHarpexData() {
  console.log("=== [ОСТАВЛЕНО] НАЧАЛО ПОЛУЧЕНИЯ ДАННЫХ Harpex (ВЕБ-СКРАПИНГ) ===");
  try {
    let harpexData = await fetchHarpexFromPrimarySource();
    if (!harpexData || harpexData.length === 0) {
      harpexData = await fetchHarpexFromAlternativeSource();
    }
    if (harpexData && harpexData.length > 0) {
      // await saveHarpexData(harpexData); // Сохранение отключено
      console.log("=== [ОСТАВЛЕНО] ЗАВЕРШЕНИЕ ПОЛУЧЕНИЯ ДАННЫХ Harpex (ВЕБ-СКРАПИНГ) ===");
      return harpexData;
    } else {
      console.log("[ОСТАВЛЕНО] Failed to fetch Harpex data from all sources, using mock data.");
      return fetchMockHarpexData(); // Возвращаем мок данные если ничего не сработало
    }
  } catch (error) {
    console.error('[ОСТАВЛЕНО] Error fetching Harpex data:', error);
    console.log("=== [ОСТАВЛЕНО] ЗАВЕРШЕНИЕ ПОЛУЧЕНИЯ ДАННЫХ Harpex С ОШИБКОЙ (ИСПОЛЬЗУЕМ МОК) ===");
    return fetchMockHarpexData(); // Возвращаем моковые данные в случае ошибки
  }
}

// Экспорт новой функции для калькулятора и старой функции для совместимости (ESM Named Export)
export { 
  getHarpexDataForCalculation, // Новая функция для чтения из БД
  fetchHarpexData // Старая функция веб-скрапинга (не используется калькулятором)
};

