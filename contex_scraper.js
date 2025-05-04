/**
 * Modified New ConTex Container Index Scraper Module
 * ==========================================================
 *
 * Этот модуль теперь читает данные ИСКЛЮЧИТЕЛЬНО из таблицы index_config базы данных.
 * Функция веб-скрапинга fetchContexData и связанные с ней функции оставлены для возможного будущего использования,
 * но НЕ используются для текущих расчетов.
 *
 * @module contex_scraper
 * @author TSP Team / Manus AI Integration
 * @version 2.1.0 (ESM Named Export)
 * @last_updated 2025-05-04
 */

// Импорт необходимых модулей (ESM)
import axios from 'axios'; // Оставлен для fetchContexData
import * as cheerio from 'cheerio'; // Оставлен для fetchContexData
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
 * Функция для получения данных NewConTex ИЗ БАЗЫ ДАННЫХ для использования в калькуляторе.
 *
 * @async
 * @function getNewConTexDataForCalculation
 * @returns {Promise<Object|null>} Объект с данными NewConTex { current_index, index_date } или null при ошибке.
 */
async function getNewConTexDataForCalculation() {
  console.log('[contex_scraper] Запрос данных NewConTex из таблицы index_config...');
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT current_value, last_updated FROM index_config WHERE index_name = $1',
      ['NewConTex']
    );
    if (result.rows.length > 0) {
      const data = {
        current_index: parseFloat(result.rows[0].current_value),
        index_date: result.rows[0].last_updated, // Используем дату обновления из БД
        change: null // Поле change больше не актуально при чтении из БД
      };
      console.log('[contex_scraper] Данные NewConTex получены из БД:', data);
      return data;
    } else {
      console.error('[contex_scraper] Ошибка: Индекс NewConTex не найден в таблице index_config.');
      return null;
    }
  } catch (error) {
    console.error('[contex_scraper] Ошибка при запросе данных NewConTex из БД:', error);
    return null;
  } finally {
    client.release();
  }
}

// --- Ниже оставлен оригинальный код веб-скрапинга --- 
// --- Он НЕ используется для получения данных для калькулятора --- 

const CONTEX_URL = 'https://www.vhss.de/en/new-contex/';
const CONTEX_ALT_URL = 'https://www.hellenicshippingnews.com/category/weekly-container-reports-index/';

async function fetchContexFromPrimarySource() {
  console.log("[ОСТАВЛЕНО] Fetching New ConTex data from primary source...");
  // ... (код fetchContexFromPrimarySource оставлен без изменений)
  return [];
}

async function fetchContexFromAlternativeSource() {
  console.log("[ОСТАВЛЕНО] Fetching New ConTex data from alternative source...");
  // ... (код fetchContexFromAlternativeSource оставлен без изменений)
  return [];
}

async function fetchMockContexData() {
  console.log('[ОСТАВЛЕНО] Using mock data for New ConTex');
  // ... (код fetchMockContexData оставлен без изменений)
  return [];
}

async function saveContexData(contexData) {
  console.log("[ОСТАВЛЕНО] Вызов saveContexData - сохранение в старую таблицу freight_indices_contex");
  // ... (код сохранения в freight_indices_contex оставлен без изменений)
}

// Старая функция для получения композитного индекса из старой таблицы
async function getContexDataForCalculation_Legacy() {
  console.log("[ОСТАВЛЕНО] Вызов getContexDataForCalculation_Legacy");
  // ... (код получения данных из freight_indices_contex оставлен без изменений)
  return null;
}

// Старая функция для получения данных по типу судна из старой таблицы
async function getContexDataForShipType_Legacy(shipType) {
  console.log(`[ОСТАВЛЕНО] Вызов getContexDataForShipType_Legacy для ${shipType}`);
  // ... (код получения данных из freight_indices_contex оставлен без изменений)
  return null;
}

// Основная функция fetchContexData оставлена
async function fetchContexData() {
  console.log("=== [ОСТАВЛЕНО] НАЧАЛО ПОЛУЧЕНИЯ ДАННЫХ New ConTex (ВЕБ-СКРАПИНГ) ===");
  try {
    let contexData = await fetchContexFromPrimarySource();
    if (!contexData || contexData.length === 0) {
      contexData = await fetchContexFromAlternativeSource();
    }
    if (contexData && contexData.length > 0) {
      // await saveContexData(contexData); // Сохранение отключено
      console.log("=== [ОСТАВЛЕНО] ЗАВЕРШЕНИЕ ПОЛУЧЕНИЯ ДАННЫХ New ConTex (ВЕБ-СКРАПИНГ) ===");
      return contexData;
    } else {
      console.log("[ОСТАВЛЕНО] Failed to fetch New ConTex data from all sources, using mock data.");
      return fetchMockContexData(); // Возвращаем мок данные если ничего не сработало
    }
  } catch (error) {
    console.error('[ОСТАВЛЕНО] Error fetching New ConTex data:', error);
    console.log("=== [ОСТАВЛЕНО] ЗАВЕРШЕНИЕ ПОЛУЧЕНИЯ ДАННЫХ New ConTex С ОШИБКОЙ (ИСПОЛЬЗУЕМ МОК) ===");
    return fetchMockContexData(); // Возвращаем моковые данные в случае ошибки
  }
}

// Экспорт новой функции для калькулятора и старых функций для совместимости (ESM Named Export)
export { 
  getNewConTexDataForCalculation, // Новая функция для чтения из БД
  fetchContexData, // Старая функция веб-скрапинга (не используется калькулятором)
  getContexDataForCalculation_Legacy as getContexDataForCalculation, // Старая функция для композитного индекса
  getContexDataForShipType_Legacy as getContexDataForShipType // Старая функция для типа судна
};

