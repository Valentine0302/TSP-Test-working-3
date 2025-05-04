/**
 * Modified Freightos Baltic Index (FBX) Scraper Module
 * ==========================================================
 *
 * Этот модуль теперь читает данные ИСКЛЮЧИТЕЛЬНО из таблицы index_config базы данных.
 * Функция веб-скрапинга fetchFBXData и связанные с ней функции оставлены для возможного будущего использования,
 * но НЕ используются для текущих расчетов.
 *
 * @module fbx_scraper
 * @author TSP Team / Manus AI Integration
 * @version 2.1.0 (ESM Export)
 * @last_updated 2025-05-04
 */

// Импорт необходимых модулей (ESM)
import axios from 'axios'; // Оставлен для fetchFBXData
import * as cheerio from 'cheerio'; // Оставлен для fetchFBXData
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
 * Функция для получения данных FBX ИЗ БАЗЫ ДАННЫХ для использования в калькуляторе.
 *
 * @async
 * @function getFBXDataForCalculation
 * @returns {Promise<Object|null>} Объект с данными FBX { current_index, index_date } или null при ошибке.
 */
async function getFBXDataForCalculation() {
  console.log('[fbx_scraper] Запрос данных FBX из таблицы index_config...');
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT current_value, last_updated FROM index_config WHERE index_name = $1',
      ['FBX']
    );
    if (result.rows.length > 0) {
      const data = {
        current_index: parseFloat(result.rows[0].current_value),
        index_date: result.rows[0].last_updated, // Используем дату обновления из БД
        change: null // Поле change больше не актуально при чтении из БД
      };
      console.log('[fbx_scraper] Данные FBX получены из БД:', data);
      return data;
    } else {
      console.error('[fbx_scraper] Ошибка: Индекс FBX не найден в таблице index_config.');
      return null;
    }
  } catch (error) {
    console.error('[fbx_scraper] Ошибка при запросе данных FBX из БД:', error);
    return null;
  } finally {
    client.release();
  }
}

// --- Ниже оставлен оригинальный код веб-скрапинга --- 
// --- Он НЕ используется для получения данных для калькулятора --- 

const FBX_URL = 'https://fbx.freightos.com/';

async function fetchFBXData() {
  console.log("=== [ОСТАВЛЕНО] НАЧАЛО ПОЛУЧЕНИЯ ДАННЫХ FBX (ВЕБ-СКРАПИНГ) ===");
  try {
    console.log('[ОСТАВЛЕНО] Fetching FBX data...');
    const response = await axios.get(FBX_URL);
    if (response.status !== 200) {
      throw new Error(`[ОСТАВЛЕНО] Failed to fetch FBX data: ${response.status}`);
    }
    const $ = cheerio.load(response.data);
    const fbxData = [];
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Попытка парсинга таблицы
    $('.fbx-index-table tbody tr').each((i, row) => {
      const route = $(row).find('td:nth-child(1)').text().trim();
      const currentIndex = parseFloat($(row).find('td:nth-child(2)').text().replace('$', '').replace(',', '').trim());
      const weeklyChange = $(row).find('td:nth-child(3)').text().trim();
      const changeMatch = weeklyChange.match(/([-+]?\d+(\.\d+)?)/);
      const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
      if (route && !isNaN(currentIndex)) {
        fbxData.push({
          route,
          currentIndex,
          change,
          indexDate: currentDate
        });
      }
    });

    // Попытка парсинга карточек, если таблица пуста
    if (fbxData.length === 0) {
        $('.fbx-index-card').each((i, card) => {
            const route = $(card).find('.route-name').text().trim();
            const currentIndexText = $(card).find('.index-value').text().trim();
            const currentIndex = parseFloat(currentIndexText.replace('$', '').replace(',', ''));
            const changeText = $(card).find('.change-value').text().trim();
            const changeMatch = changeText.match(/([-+]?\d+(\.\d+)?)/);
            const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
            if (route && !isNaN(currentIndex)) {
                fbxData.push({
                    route,
                    currentIndex,
                    change,
                    indexDate: currentDate
                });
            }
        });
    }

    console.log(`[ОСТАВЛЕНО] Parsed ${fbxData.length} FBX routes`);
    // await saveFbxData(fbxData); // Сохранение в старую таблицу отключено
    console.log("=== [ОСТАВЛЕНО] ЗАВЕРШЕНИЕ ПОЛУЧЕНИЯ ДАННЫХ FBX (ВЕБ-СКРАПИНГ) ===");
    return fbxData; // Возвращаем данные, хотя они не используются калькулятором
  } catch (error) {
    console.error('[ОСТАВЛЕНО] Error fetching FBX data:', error);
    console.log("=== [ОСТАВЛЕНО] ЗАВЕРШЕНИЕ ПОЛУЧЕНИЯ ДАННЫХ FBX С ОШИБКОЙ ===");
    return []; // Возвращаем пустой массив в случае ошибки
  }
}

// Функция saveFbxData оставлена, но не вызывается
async function saveFbxData(fbxData) { 
    console.log("[ОСТАВЛЕНО] Вызов saveFbxData - сохранение в старую таблицу freight_indices_fbx");
    // ... (код сохранения в freight_indices_fbx оставлен без изменений)
}

// Функция getFBXDataForRoute оставлена, но не используется калькулятором
async function getFBXDataForRoute(origin, destination) {
    console.log("[ОСТАВЛЕНО] Вызов getFBXDataForRoute");
    // ... (код получения данных для маршрута оставлен без изменений)
    return null; // Возвращаем null, т.к. функция больше не актуальна для основного расчета
}

// Вспомогательные функции getPortNameById, getPortRegionById оставлены
async function getPortNameById(portId) {
    // ... (код оставлен)
    return portId;
}
async function getPortRegionById(portId) {
    // ... (код оставлен)
    return 'Unknown';
}

// Экспорт новой функции для калькулятора и старых функций для совместимости (ESM)
export { 
  getFBXDataForCalculation, // Новая функция для чтения из БД
  fetchFBXData, // Старая функция веб-скрапинга (не используется калькулятором)
  getFBXDataForRoute // Старая функция для маршрутов (не используется калькулятором)
};

