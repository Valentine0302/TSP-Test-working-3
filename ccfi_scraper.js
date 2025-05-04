/**
 * Modified China Containerized Freight Index (CCFI) Scraper Module
 * ==========================================================
 *
 * Этот модуль теперь читает данные ИСКЛЮЧИТЕЛЬНО из таблицы index_config базы данных.
 * Функция веб-скрапинга fetchCCFIData и связанные с ней функции оставлены для возможного будущего использования,
 * но НЕ используются для текущих расчетов.
 *
 * @module ccfi_scraper
 * @author TSP Team / Manus AI Integration
 * @version 2.1.0 (ESM Export)
 * @last_updated 2025-05-04
 */

// Импорт необходимых модулей (ESM)
import axios from 'axios'; // Оставлен для fetchCCFIData
import * as cheerio from 'cheerio'; // Оставлен для fetchCCFIData
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
 * Функция для получения данных CCFI ИЗ БАЗЫ ДАННЫХ для использования в калькуляторе.
 *
 * @async
 * @function getCCFIDataForCalculation
 * @returns {Promise<Object|null>} Объект с данными CCFI { current_index, index_date } или null при ошибке.
 */
async function getCCFIDataForCalculation() {
  console.log('[ccfi_scraper] Запрос данных CCFI из таблицы index_config...');
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT current_value, last_updated FROM index_config WHERE index_name = $1',
      ['CCFI']
    );
    if (result.rows.length > 0) {
      const data = {
        current_index: parseFloat(result.rows[0].current_value),
        index_date: result.rows[0].last_updated, // Используем дату обновления из БД
        change: null // Поле change больше не актуально при чтении из БД
      };
      console.log('[ccfi_scraper] Данные CCFI получены из БД:', data);
      return data;
    } else {
      console.error('[ccfi_scraper] Ошибка: Индекс CCFI не найден в таблице index_config.');
      return null;
    }
  } catch (error) {
    console.error('[ccfi_scraper] Ошибка при запросе данных CCFI из БД:', error);
    return null;
  } finally {
    client.release();
  }
}

// --- Ниже оставлен оригинальный код веб-скрапинга --- 
// --- Он НЕ используется для получения данных для калькулятора --- 

const CCFI_URL = "https://en.sse.net.cn/indices/ccfinew.jsp";
const CCFI_ALT_URLS = [
  "https://en.macromicro.me/series/20786/ccfi-composite-index",
  "https://www.freightwaves.com/news/tag/ccfi",
  "https://www.container-news.com/ccfi/",
  "https://www.hellenicshippingnews.com/china-containerized-freight-index/",
];
const HTTP_CONFIG = {
  TIMEOUT: 15000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000,
  HEADERS: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  },
};

// Функция normalizeIndexData оставлена, т.к. может использоваться старым кодом
function normalizeIndexData(data) {
  // ... (код normalizeIndexData оставлен без изменений)
  if (!data) {
    console.error("[ОСТАВЛЕНО] Received null or undefined data in normalizeIndexData");
    return null;
  }
  console.log("[ОСТАВЛЕНО] Normalizing index data:", JSON.stringify(data));
  const normalizedData = { current_index: null, change: null, index_date: null };
  // ... (логика определения полей)
  if ("current_index" in data) normalizedData.current_index = parseFloat(data.current_index);
  else if ("currentIndex" in data) normalizedData.current_index = parseFloat(data.currentIndex);
  // ... (и т.д.)
  if (isNaN(normalizedData.current_index)) normalizedData.current_index = 1122.4;
  if (isNaN(normalizedData.change)) normalizedData.change = 1.0;
  if (!normalizedData.index_date) normalizedData.index_date = formatDate(new Date());
  console.log("[ОСТАВЛЕНО] Normalized data:", JSON.stringify(normalizedData));
  return normalizedData;
}

// Функция formatDate оставлена
function formatDate(date) {
  // ... (код formatDate оставлен без изменений)
   if (!date) return new Date().toISOString().split("T")[0];
   if (typeof date === "string") {
     if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
     const parsedDate = new Date(date);
     if (!isNaN(parsedDate.getTime())) return parsedDate.toISOString().split("T")[0];
   }
   if (date instanceof Date) return date.toISOString().split("T")[0];
   return new Date().toISOString().split("T")[0];
}

// Функция fetchCCFIFromPrimarySource оставлена
async function fetchCCFIFromPrimarySource() {
  console.log("[ОСТАВЛЕНО] Fetching CCFI data from primary source...");
  // ... (код fetchCCFIFromPrimarySource оставлен без изменений)
  return []; // Возвращаем пустой массив
}

// Функция fetchCCFIFromAlternativeSource оставлена
async function fetchCCFIFromAlternativeSource(url) {
  console.log(`[ОСТАВЛЕНО] Fetching CCFI data from alternative source: ${url}`);
  // ... (код fetchCCFIFromAlternativeSource оставлен без изменений)
  return []; // Возвращаем пустой массив
}

// Функция saveCCFIData оставлена
async function saveCCFIData(ccfiData) {
  console.log("[ОСТАВЛЕНО] Вызов saveCCFIData - сохранение в старую таблицу freight_indices_ccfi");
  // ... (код сохранения в freight_indices_ccfi оставлен без изменений)
}

// Функция getCCFIDataForCalculation (старая, для маршрутов) переименована и оставлена
async function getCCFIDataForRoute_Legacy(origin, destination) {
  console.log("[ОСТАВЛЕНО] Вызов getCCFIDataForRoute_Legacy");
  // ... (код получения данных для маршрута оставлен без изменений)
  return null; // Возвращаем null
}

// Основная функция fetchCCFIData оставлена
async function fetchCCFIData() {
  console.log("=== [ОСТАВЛЕНО] НАЧАЛО ПОЛУЧЕНИЯ ДАННЫХ CCFI (ВЕБ-СКРАПИНГ) ===");
  try {
    let data = await fetchCCFIFromPrimarySource();
    if (!data || data.length === 0) {
      console.log("[ОСТАВЛЕНО] Primary source failed, trying alternatives...");
      for (const url of CCFI_ALT_URLS) {
        try {
          data = await fetchCCFIFromAlternativeSource(url);
          if (data && data.length > 0) break;
        } catch (altError) {
          console.error(`[ОСТАВЛЕНО] Error fetching from ${url}:`, altError.message);
        }
      }
    }
    if (data && data.length > 0) {
      // await saveCCFIData(data); // Сохранение отключено
      console.log("=== [ОСТАВЛЕНО] ЗАВЕРШЕНИЕ ПОЛУЧЕНИЯ ДАННЫХ CCFI (ВЕБ-СКРАПИНГ) ===");
      return data;
    } else {
      throw new Error("[ОСТАВЛЕНО] Failed to fetch CCFI data from all sources.");
    }
  } catch (error) {
    console.error("[ОСТАВЛЕНО] Error in fetchCCFIData:", error);
    console.log("=== [ОСТАВЛЕНО] ЗАВЕРШЕНИЕ ПОЛУЧЕНИЯ ДАННЫХ CCFI С ОШИБКОЙ ===");
    return []; // Возвращаем пустой массив в случае ошибки
  }
}

// Экспорт новой функции для калькулятора и старых функций для совместимости (ESM)
export { 
  getCCFIDataForCalculation, // Новая функция для чтения из БД
  fetchCCFIData, // Старая функция веб-скрапинга (не используется калькулятором)
  getCCFIDataForRoute_Legacy as getCCFIDataForRoute // Старая функция для маршрутов (не используется калькулятором)
};

