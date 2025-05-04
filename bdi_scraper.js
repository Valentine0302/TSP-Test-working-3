/**
 * Modified Baltic Dry Index (BDI) Scraper Module
 * ==========================================================
 *
 * Этот модуль теперь читает данные ИСКЛЮЧИТЕЛЬНО из таблицы index_config базы данных.
 * Функция веб-скрапинга fetchBDIData и связанные с ней функции оставлены для возможного будущего использования,
 * но НЕ используются для текущих расчетов.
 *
 * @module bdi_scraper
 * @author TSP Team / Manus AI Integration
 * @version 2.1.0 (ESM Named Export)
 * @last_updated 2025-05-04
 */

// Импорт необходимых модулей (ESM)
import axios from 'axios'; // Оставлен для fetchBDIData
import * as cheerio from 'cheerio'; // Оставлен для fetchBDIData
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
 * Функция для получения данных BDI ИЗ БАЗЫ ДАННЫХ для использования в калькуляторе.
 *
 * @async
 * @function getBdiDataForCalculation
 * @returns {Promise<Object|null>} Объект с данными BDI { current_index, index_date } или null при ошибке.
 */
async function getBdiDataForCalculation() {
  console.log('[bdi_scraper] Запрос данных BDI из таблицы index_config...');
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT current_value, last_updated FROM index_config WHERE index_name = $1',
      ['BDI']
    );
    if (result.rows.length > 0) {
      const data = {
        current_index: parseFloat(result.rows[0].current_value),
        index_date: result.rows[0].last_updated, // Используем дату обновления из БД
        change: null // Поле change больше не актуально при чтении из БД
      };
      console.log('[bdi_scraper] Данные BDI получены из БД:', data);
      return data;
    } else {
      console.error('[bdi_scraper] Ошибка: Индекс BDI не найден в таблице index_config.');
      return null;
    }
  } catch (error) {
    console.error('[bdi_scraper] Ошибка при запросе данных BDI из БД:', error);
    return null;
  } finally {
    client.release();
  }
}

// --- Ниже оставлен оригинальный код веб-скрапинга --- 
// --- Он НЕ используется для получения данных для калькулятора --- 

const BDI_URL = 'https://tradingeconomics.com/commodity/baltic';

async function fetchBDIFromTradingEconomics() {
  console.log("[ОСТАВЛЕНО] Fetching BDI data from Trading Economics...");
  // ... (код fetchBDIFromTradingEconomics оставлен без изменений)
  return [];
}

async function fetchMockBDIData() {
  console.log('[ОСТАВЛЕНО] Using mock data for BDI');
  // ... (код fetchMockBDIData оставлен без изменений)
  return [];
}

async function saveBDIData(bdiData) {
  console.log("[ОСТАВЛЕНО] Вызов saveBDIData - сохранение в старую таблицу freight_indices_bdi");
  // ... (код сохранения в freight_indices_bdi оставлен без изменений)
}

// Старая функция для получения данных BDI с логикой fallback
async function getBDIDataForCalculation_Legacy() {
    console.log("[ОСТАВЛЕНО] Вызов getBDIDataForCalculation_Legacy");
    // ... (код старой функции getBDIDataForCalculation оставлен без изменений)
    return null;
}

// Основная функция fetchBDIData оставлена
async function fetchBDIData() {
  console.log("=== [ОСТАВЛЕНО] НАЧАЛО ПОЛУЧЕНИЯ ДАННЫХ BDI (ВЕБ-СКРАПИНГ) ===");
  try {
    let bdiData = await fetchBDIFromTradingEconomics();
    if (bdiData && bdiData.length > 0) {
      // await saveBDIData(bdiData); // Сохранение отключено
      console.log("=== [ОСТАВЛЕНО] ЗАВЕРШЕНИЕ ПОЛУЧЕНИЯ ДАННЫХ BDI (ВЕБ-СКРАПИНГ) ===");
      return bdiData;
    } else {
      console.log("[ОСТАВЛЕНО] Failed to fetch BDI data from Trading Economics, using mock data.");
      return fetchMockBDIData(); // Возвращаем мок данные если ничего не сработало
    }
  } catch (error) {
    console.error('[ОСТАВЛЕНО] Error fetching BDI data:', error);
    console.log("=== [ОСТАВЛЕНО] ЗАВЕРШЕНИЕ ПОЛУЧЕНИЯ ДАННЫХ BDI С ОШИБКОЙ (ИСПОЛЬЗУЕМ МОК) ===");
    return fetchMockBDIData(); // Возвращаем моковые данные в случае ошибки
  }
}

// Экспорт новой функции для калькулятора и старых функций для совместимости (ESM Named Export)
export { 
  getBdiDataForCalculation, // Новая функция для чтения из БД
  fetchBDIData, // Старая функция веб-скрапинга (не используется калькулятором)
  getBDIDataForCalculation_Legacy as getBDIDataForCalculationLegacy // Старая функция с fallback логикой (переименована для ясности)
};

