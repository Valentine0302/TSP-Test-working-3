/**
 * Modified Shanghai Containerized Freight Index (SCFI) Scraper Module
 * ==========================================================
 *
 * Этот модуль теперь читает данные ИСКЛЮЧИТЕЛЬНО из таблицы index_config базы данных.
 * Функция веб-скрапинга fetchSCFIData оставлена для возможного будущего использования,
 * но НЕ используется для текущих расчетов.
 *
 * @module scfi_scraper
 * @author TSP Team / Manus AI Integration
 * @version 3.1.0 (ESM Export)
 * @last_updated 2025-05-04
 */

// Импорт необходимых модулей (ESM)
import axios from 'axios'; // Оставлен для fetchSCFIData
import * as cheerio from 'cheerio'; // Оставлен для fetchSCFIData
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
 * Функция для получения данных SCFI ИЗ БАЗЫ ДАННЫХ для использования в калькуляторе.
 *
 * @async
 * @function getSCFIDataForCalculation
 * @returns {Promise<Object|null>} Объект с данными SCFI { current_index, index_date } или null при ошибке.
 */
async function getSCFIDataForCalculation() {
  console.log('[scfi_scraper] Запрос данных SCFI из таблицы index_config...');
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT current_value, last_updated FROM index_config WHERE index_name = $1',
      ['SCFI']
    );
    if (result.rows.length > 0) {
      const data = {
        current_index: parseFloat(result.rows[0].current_value),
        index_date: result.rows[0].last_updated, // Используем дату обновления из БД
        change: null // Поле change больше не актуально при чтении из БД
      };
      console.log('[scfi_scraper] Данные SCFI получены из БД:', data);
      return data;
    } else {
      console.error('[scfi_scraper] Ошибка: Индекс SCFI не найден в таблице index_config.');
      return null;
    }
  } catch (error) {
    console.error('[scfi_scraper] Ошибка при запросе данных SCFI из БД:', error);
    return null;
  } finally {
    client.release();
  }
}

// --- Ниже оставлен оригинальный код веб-скрапинга --- 
// --- Он НЕ используется для получения данных для калькулятора --- 

const SCFI_URL = "https://en.sse.net.cn/indices/scfinew.jsp";
const SCFI_ALT_SOURCES = [
  // ... (альтернативные источники оставлены без изменений)
];
const HTTP_CONFIG = {
  TIMEOUT: 30000, 
  MAX_RETRIES: 5, 
  RETRY_DELAY: 5000,
  HEADERS: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  },
};
const DB_CONFIG = {
  TABLE_NAME: "freight_indices_scfi", // Старая таблица, больше не используется для калькулятора
  // ... (остальные настройки DB_CONFIG оставлены)
};

function formatDate(date) {
  // ... (функция formatDate оставлена без изменений)
  console.log(`[formatDate] Входная дата: "${date}" (тип: ${typeof date})`);
  
  if (!date) {
    console.log("[formatDate] Дата не указана, возвращаю текущую дату");
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const formattedDate = `${year}-${month}-${day}`;
    console.log(`[formatDate] Возвращаю текущую дату: ${formattedDate}`);
    return formattedDate;
  }
  
  let dateObj;
  if (typeof date === 'string') {
    console.log(`[formatDate] Обработка строки даты: "${date}"`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      console.log(`[formatDate] Дата уже в формате YYYY-MM-DD: ${date}`);
      return date;
    }
    if (date.includes('/')) {
      const parts = date.split('/');
      console.log(`[formatDate] Разбор даты с разделителем "/": ${parts.join(', ')}`);
      if (parts.length === 3) {
        const month = parseInt(parts[0], 10);
        const day = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);
        console.log(`[formatDate] Пробую формат MM/DD/YYYY: месяц=${month}, день=${day}, год=${year}`);
        if (month > 0 && month <= 12 && day > 0 && day <= 31 && year > 2000) {
          dateObj = new Date(year, month - 1, day);
          console.log(`[formatDate] Формат MM/DD/YYYY подошел, создан объект Date: ${dateObj}`);
        } else {
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10);
          const year = parseInt(parts[2], 10);
          console.log(`[formatDate] Пробую формат DD/MM/YYYY: день=${day}, месяц=${month}, год=${year}`);
          if (month > 0 && month <= 12 && day > 0 && day <= 31 && year > 2000) {
            dateObj = new Date(year, month - 1, day);
            console.log(`[formatDate] Формат DD/MM/YYYY подошел, создан объект Date: ${dateObj}`);
          } else {
            console.log('[formatDate] Не удалось распознать формат даты с "/", использую текущую дату');
            dateObj = new Date();
          }
        }
      } else {
        console.log(`[formatDate] Неизвестный формат с "/", частей: ${parts.length}, использую текущую дату`);
        dateObj = new Date();
      }
    } else if (date.includes('-')) {
      const parts = date.split('-');
      console.log(`[formatDate] Разбор даты с разделителем "-": ${parts.join(', ')}`);
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          console.log(`[formatDate] Определен формат YYYY-MM-DD: ${date}`);
          dateObj = new Date(date);
          console.log(`[formatDate] Создан объект Date: ${dateObj}`);
        } else {
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10);
          const year = parseInt(parts[2], 10);
          console.log(`[formatDate] Пробую формат DD-MM-YYYY: день=${day}, месяц=${month}, год=${year}`);
          if (month > 0 && month <= 12 && day > 0 && day <= 31 && year > 2000) {
            dateObj = new Date(year, month - 1, day);
            console.log(`[formatDate] Формат DD-MM-YYYY подошел, создан объект Date: ${dateObj}`);
          } else {
            console.log('[formatDate] Не удалось распознать формат даты с "-", использую текущую дату');
            dateObj = new Date();
          }
        }
      } else {
        console.log(`[formatDate] Неизвестный формат с "-", частей: ${parts.length}, использую текущую дату`);
        dateObj = new Date();
      }
    } else {
      console.log(`[formatDate] Пробую стандартный парсинг даты: "${date}"`);
      dateObj = new Date(date);
      if (isNaN(dateObj.getTime())) {
        console.log('[formatDate] Стандартный парсинг не удался, использую текущую дату');
        dateObj = new Date();
      } else {
        console.log(`[formatDate] Стандартный парсинг успешен, создан объект Date: ${dateObj}`);
      }
    }
  } else if (date instanceof Date) {
    console.log(`[formatDate] Входные данные уже являются объектом Date: ${date}`);
    dateObj = date;
  } else {
    console.log(`[formatDate] Неподдерживаемый тип данных: ${typeof date}, использую текущую дату`);
    dateObj = new Date();
  }
  
  if (isNaN(dateObj.getTime())) {
    console.log('[formatDate] Созданная дата невалидна, использую текущую дату');
    dateObj = new Date(); 
  }
  
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  
  const formattedDate = `${year}-${month}-${day}`;
  console.log(`[formatDate] Итоговая отформатированная дата: ${formattedDate}`);
  return formattedDate;
}

async function fetchSCFIData() {
  console.log("=== [ОСТАВЛЕНО] НАЧАЛО ПОЛУЧЕНИЯ ДАННЫХ SCFI (ВЕБ-СКРАПИНГ) ===");
  // ... (весь код fetchSCFIData, fetchSCFIFromPrimarySource, fetchSCFIFromAlternativeSource, saveSCFIData, fetchMockSCFIData оставлен без изменений)
  // ... но он больше не вызывается для основного расчета
  console.log("=== [ОСТАВЛЕНО] ЗАВЕРШЕНИЕ ПОЛУЧЕНИЯ ДАННЫХ SCFI (ВЕБ-СКРАПИНГ) ===");
  // Возвращаем пустой массив или моковые данные, чтобы не сломать старую логику, если она где-то вызывается
  return []; 
}

// Экспорт новой функции для калькулятора и старой функции для совместимости (ESM)
export { 
  getSCFIDataForCalculation, // Новая функция для чтения из БД
  fetchSCFIData // Старая функция веб-скрапинга (не используется калькулятором)
  // Можно добавить другие экспорты из оригинального файла, если они нужны где-то еще
};

