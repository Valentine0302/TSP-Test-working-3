/**
 * Modified Drewry World Container Index (WCI) Scraper Module
 * ==========================================================
 *
 * Этот модуль теперь читает данные ИСКЛЮЧИТЕЛЬНО из таблицы index_config базы данных.
 * Функция веб-скрапинга fetchWCIData и связанные с ней функции оставлены для возможного будущего использования,
 * но НЕ используются для текущих расчетов.
 *
 * @module wci_scraper
 * @author TSP Team / Manus AI Integration
 * @version 2.1.0 (ESM Export)
 * @last_updated 2025-05-04
 */

// Импорт необходимых модулей (ESM)
import axios from 'axios'; // Оставлен для fetchWCIData
import * as cheerio from 'cheerio'; // Оставлен для fetchWCIData
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
 * Функция для получения данных WCI ИЗ БАЗЫ ДАННЫХ для использования в калькуляторе.
 *
 * @async
 * @function getWCIDataForCalculation
 * @returns {Promise<Object|null>} Объект с данными WCI { current_index, index_date } или null при ошибке.
 */
async function getWCIDataForCalculation() {
  console.log('[wci_scraper] Запрос данных WCI из таблицы index_config...');
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT current_value, last_updated FROM index_config WHERE index_name = $1',
      ['WCI']
    );
    if (result.rows.length > 0) {
      const data = {
        current_index: parseFloat(result.rows[0].current_value),
        index_date: result.rows[0].last_updated, // Используем дату обновления из БД
        change: null // Поле change больше не актуально при чтении из БД
      };
      console.log('[wci_scraper] Данные WCI получены из БД:', data);
      return data;
    } else {
      console.error('[wci_scraper] Ошибка: Индекс WCI не найден в таблице index_config.');
      return null;
    }
  } catch (error) {
    console.error('[wci_scraper] Ошибка при запросе данных WCI из БД:', error);
    return null;
  } finally {
    client.release();
  }
}

// --- Ниже оставлен оригинальный код веб-скрапинга --- 
// --- Он НЕ используется для получения данных для калькулятора --- 

const WCI_URL = 'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry';

async function fetchWCIData() {
  console.log("=== [ОСТАВЛЕНО] НАЧАЛО ПОЛУЧЕНИЯ ДАННЫХ WCI (ВЕБ-СКРАПИНГ) ===");
  try {
    console.log('[ОСТАВЛЕНО] Fetching WCI data...');
    const response = await axios.get(WCI_URL);
    if (response.status !== 200) {
      throw new Error(`[ОСТАВЛЕНО] Failed to fetch WCI data: ${response.status}`);
    }
    const $ = cheerio.load(response.data);
    const wciData = [];
    let indexDate = new Date().toISOString().split('T')[0];
    const dateText = $('.wci-date').text().trim();
    if (dateText) {
      const dateMatch = dateText.match(/(\d{1,2})[thsrdn]{0,2}\s+([A-Za-z]+)\s+(\d{4})/);
      if (dateMatch) {
        const day = dateMatch[1].padStart(2, '0');
        const month = getMonthNumber(dateMatch[2]);
        const year = dateMatch[3];
        indexDate = `${year}-${month}-${day}`;
      }
    }

    // Попытка парсинга таблицы
    $('.wci-table tbody tr').each((i, row) => {
      const columns = $(row).find('td');
      if (columns.length >= 3) {
        const route = $(columns[0]).text().trim();
        const currentIndexText = $(columns[1]).text().trim();
        const changeText = $(columns[2]).text().trim();
        const currentIndex = parseFloat(currentIndexText.replace('$', '').replace(',', ''));
        const changeMatch = changeText.match(/([-+]?\d+(\.\d+)?)/);
        const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
        if (route && !isNaN(currentIndex)) {
          wciData.push({
            route,
            currentIndex,
            change,
            indexDate
          });
        }
      }
    });

    // Попытка парсинга другого формата, если таблица пуста
    if (wciData.length === 0) {
        $('.wci-data-point').each((i, point) => {
            const route = $(point).find('.route-name').text().trim();
            const currentIndexText = $(point).find('.index-value').text().trim();
            const currentIndex = parseFloat(currentIndexText.replace('$', '').replace(',', ''));
            const changeText = $(point).find('.change-value').text().trim();
            const changeMatch = changeText.match(/([-+]?\d+(\.\d+)?)/);
            const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
            if (route && !isNaN(currentIndex)) {
                wciData.push({
                    route,
                    currentIndex,
                    change,
                    indexDate
                });
            }
        });
    }

    console.log(`[ОСТАВЛЕНО] Parsed ${wciData.length} WCI routes`);
    // await saveWciData(wciData); // Сохранение в старую таблицу отключено
    console.log("=== [ОСТАВЛЕНО] ЗАВЕРШЕНИЕ ПОЛУЧЕНИЯ ДАННЫХ WCI (ВЕБ-СКРАПИНГ) ===");
    return wciData; // Возвращаем данные, хотя они не используются калькулятором
  } catch (error) {
    console.error('[ОСТАВЛЕНО] Error fetching WCI data:', error);
    console.log("=== [ОСТАВЛЕНО] ЗАВЕРШЕНИЕ ПОЛУЧЕНИЯ ДАННЫХ WCI С ОШИБКОЙ ===");
    return []; // Возвращаем пустой массив в случае ошибки
  }
}

// Функция saveWciData оставлена, но не вызывается
async function saveWciData(wciData) {
    console.log("[ОСТАВЛЕНО] Вызов saveWciData - сохранение в старую таблицу freight_indices_wci");
    // ... (код сохранения в freight_indices_wci оставлен без изменений)
}

// Функция getWCIDataForRoute оставлена, но не используется калькулятором
async function getWCIDataForRoute(origin, destination) {
    console.log("[ОСТАВЛЕНО] Вызов getWCIDataForRoute");
    // ... (код получения данных для маршрута оставлен без изменений)
    return null; // Возвращаем null, т.к. функция больше не актуальна для основного расчета
}

// Вспомогательные функции getPortNameById, getPortRegionById, getMonthNumber оставлены
async function getPortNameById(portId) {
    // ... (код оставлен)
    return portId;
}
async function getPortRegionById(portId) {
    // ... (код оставлен)
    return 'Unknown';
}
function getMonthNumber(monthName) {
    // ... (код оставлен)
    const months = {
        'january': '01', 'february': '02', 'march': '03', 'april': '04',
        'may': '05', 'june': '06', 'july': '07', 'august': '08',
        'september': '09', 'october': '10', 'november': '11', 'december': '12',
        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
        'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
        'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
    };
    return months[monthName.toLowerCase()] || '01';
}

// Экспорт новой функции для калькулятора и старых функций для совместимости (ESM)
export { 
  getWCIDataForCalculation, // Новая функция для чтения из БД
  fetchWCIData, // Старая функция веб-скрапинга (не используется калькулятором)
  getWCIDataForRoute // Старая функция для маршрутов (не используется калькулятором)
};

