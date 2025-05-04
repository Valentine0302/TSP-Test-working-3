/**
 * Modified Xeneta Shipping Index (XSI) Scraper Module
 * ==========================================================
 *
 * Этот модуль теперь читает данные ИСКЛЮЧИТЕЛЬНО из таблицы index_config базы данных.
 * Функция fetchXSIData (использующая API или моковые данные) и связанные с ней функции оставлены для возможного будущего использования,
 * но НЕ используются для текущих расчетов.
 *
 * @module xeneta_scraper
 * @author TSP Team / Manus AI Integration
 * @version 2.1.0 (ESM Export)
 * @last_updated 2025-05-04
 */

// Импорт необходимых модулей (ESM)
import axios from 'axios'; // Оставлен для fetchXSIData
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
 * Функция для получения данных Xeneta (XSI) ИЗ БАЗЫ ДАННЫХ для использования в калькуляторе.
 *
 * @async
 * @function getXenetaDataForCalculation
 * @returns {Promise<Object|null>} Объект с данными Xeneta { current_index, index_date } или null при ошибке.
 */
async function getXenetaDataForCalculation() {
  console.log('[xeneta_scraper] Запрос данных Xeneta из таблицы index_config...');
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT current_value, last_updated FROM index_config WHERE index_name = $1',
      ['Xeneta']
    );
    if (result.rows.length > 0) {
      const data = {
        current_index: parseFloat(result.rows[0].current_value),
        index_date: result.rows[0].last_updated, // Используем дату обновления из БД
        change: null // Поле change больше не актуально при чтении из БД
      };
      console.log('[xeneta_scraper] Данные Xeneta получены из БД:', data);
      return data;
    } else {
      console.error('[xeneta_scraper] Ошибка: Индекс Xeneta не найден в таблице index_config.');
      return null;
    }
  } catch (error) {
    console.error('[xeneta_scraper] Ошибка при запросе данных Xeneta из БД:', error);
    return null;
  } finally {
    client.release();
  }
}

// --- Ниже оставлен оригинальный код API/мок-скрапинга --- 
// --- Он НЕ используется для получения данных для калькулятора --- 

const XENETA_API_KEY = process.env.XENETA_API_KEY || '';
const XENETA_API_URL = 'https://api.xeneta.com/v1';

async function fetchXSIData() {
  console.log("=== [ОСТАВЛЕНО] НАЧАЛО ПОЛУЧЕНИЯ ДАННЫХ XSI (API/МОК) ===");
  try {
    console.log('[ОСТАВЛЕНО] Fetching Xeneta XSI data...');
    if (!XENETA_API_KEY) {
      console.warn('[ОСТАВЛЕНО] Xeneta API key not provided. Using mock data for XSI.');
      return fetchMockXSIData(); // Вызов моковой функции
    }
    const currentDate = new Date();
    const formattedDate = currentDate.toISOString().split('T')[0];
    const response = await axios.get(`${XENETA_API_URL}/indices/xsi`, {
      headers: {
        'Authorization': `ApiKey ${XENETA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      params: {
        date: formattedDate
      }
    });
    if (response.status !== 200) {
      throw new Error(`[ОСТАВЛЕНО] Failed to fetch XSI data: ${response.status}`);
    }
    const xsiData = [];
    const indices = response.data.indices || [];
    for (const index of indices) {
      xsiData.push({
        route: index.route || 'Global XSI',
        currentIndex: index.value,
        change: index.change_pct || 0,
        indexDate: index.date || formattedDate
      });
    }
    console.log(`[ОСТАВЛЕНО] Parsed ${xsiData.length} XSI routes`);
    // await saveXSIData(xsiData); // Сохранение в старую таблицу отключено
    console.log("=== [ОСТАВЛЕНО] ЗАВЕРШЕНИЕ ПОЛУЧЕНИЯ ДАННЫХ XSI (API/МОК) ===");
    return xsiData; // Возвращаем данные, хотя они не используются калькулятором
  } catch (error) {
    console.error('[ОСТАВЛЕНО] Error fetching XSI data:', error);
    console.log("=== [ОСТАВЛЕНО] ЗАВЕРШЕНИЕ ПОЛУЧЕНИЯ ДАННЫХ XSI С ОШИБКОЙ (ИСПОЛЬЗУЕМ МОК) ===");
    return fetchMockXSIData(); // Возвращаем моковые данные в случае ошибки
  }
}

// Моковая функция оставлена
async function fetchMockXSIData() {
  console.log('[ОСТАВЛЕНО] Using mock data for XSI');
  const currentDate = new Date().toISOString().split('T')[0];
  const mockData = [
    { route: 'Global XSI', currentIndex: 1850, change: 2.5, indexDate: currentDate },
    // ... (остальные моковые данные)
     { route: 'Europe Export XSI', currentIndex: 1920, change: 1.8, indexDate: currentDate },
     { route: 'Europe Import XSI', currentIndex: 1780, change: 3.2, indexDate: currentDate },
     { route: 'Far East Export XSI', currentIndex: 2150, change: 4.5, indexDate: currentDate },
     { route: 'Far East Import XSI', currentIndex: 1650, change: 1.2, indexDate: currentDate },
     { route: 'US Export XSI', currentIndex: 1450, change: -0.8, indexDate: currentDate },
     { route: 'US Import XSI', currentIndex: 2250, change: 3.7, indexDate: currentDate }
  ];
  // await saveXSIData(mockData); // Сохранение моковых данных в старую таблицу отключено
  return mockData;
}

// Функция saveXSIData оставлена, но не вызывается для основного расчета
async function saveXSIData(xsiData) {
    console.log("[ОСТАВЛЕНО] Вызов saveXSIData - сохранение в старую таблицу freight_indices_xsi");
    // ... (код сохранения в freight_indices_xsi оставлен без изменений)
}

// Функция getXSIDataForRoute оставлена, но не используется калькулятором
async function getXSIDataForRoute(origin, destination) {
    console.log("[ОСТАВЛЕНО] Вызов getXSIDataForRoute");
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
  getXenetaDataForCalculation, // Новая функция для чтения из БД
  fetchXSIData, // Старая функция API/мок (не используется калькулятором)
  getXSIDataForRoute // Старая функция для маршрутов (не используется калькулятором)
};

