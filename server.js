// Интеграционный модуль v4.7: Добавлены GET эндпоинты для редактирования индексов и ставок.

import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer'; // Для обработки загрузки файлов
import xlsx from 'xlsx'; // Для чтения Excel

// Импорт модулей анализа и расчета (Без скраперов для текущих значений)
import { initializeAndUpdateSeasonalityData, initializeSeasonalityTables, fetchSeasonalityFactor } from './seasonality_analyzer.js';
import { calculateFreightRate, saveRequestToHistory } from './freight_calculator_enhanced.js';

// Загрузка переменных окружения
dotenv.config();

// Определение __dirname для ES модулей
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Настройка Multer для загрузки файлов в память
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Подключение к базе данных
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    // sslmode: 'require' // Раскомментируйте, если ваша БД требует SSL
  }
});

// Создание экземпляра Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Redirect /admin to /admin.html
app.get('/admin', (req, res) => {
  res.redirect('/admin.html');
});

// --- Инициализация системы --- 
async function initializeSystem() {
  try {
    console.log('Initializing freight calculator system v4.7 (Admin-Managed Data - Edit Endpoints Added).');
    await initializeDatabaseTables(); 
    console.log('System initialization completed');
  } catch (error) {
    console.error('Error initializing system:', error);
    throw error;
  }
}

// --- Инициализация таблиц БД (Логика миграции из v4.1, v4.6) --- 
async function initializeDatabaseTables() {
  console.log("Initializing database tables...");
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // Таблица портов
    await client.query(`
      CREATE TABLE IF NOT EXISTS ports (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(10) UNIQUE, -- Сделаем UNIQUE NULLABLE, если код может отсутствовать
        region VARCHAR(50),
        latitude NUMERIC,
        longitude NUMERIC,
        country VARCHAR(100)
      );
    `);
    await client.query(`ALTER TABLE ports ADD COLUMN IF NOT EXISTS country VARCHAR(100);`);
    // Убедимся, что code может быть null, если это допустимо бизнес-логикой
    // Если код ОБЯЗАТЕЛЕН, то UNIQUE NOT NULL - правильно.
    // Если код может быть null, но если есть, то уникальный:
    // await client.query(`ALTER TABLE ports DROP CONSTRAINT IF EXISTS ports_code_key;`); // Сначала удалить старое ограничение
    // await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ports_code_unique_not_null ON ports (code) WHERE code IS NOT NULL;`);

    // Таблица типов контейнеров
    await client.query(`
      CREATE TABLE IF NOT EXISTS container_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL, -- Увеличим длину на всякий случай
        description TEXT -- Добавим поле описания, если нужно
      );
    `);
    await client.query(`ALTER TABLE container_types ADD COLUMN IF NOT EXISTS description TEXT;`);
    await client.query(`ALTER TABLE container_types ALTER COLUMN name TYPE VARCHAR(50);`); // Увеличим длину существующего поля


    // Таблица базовых ставок
    await client.query(`
      CREATE TABLE IF NOT EXISTS base_rates (
        id SERIAL PRIMARY KEY, 
        origin_region VARCHAR(50) NOT NULL,
        destination_region VARCHAR(50) NOT NULL,
        container_type VARCHAR(50) NOT NULL, -- Увеличим длину
        rate NUMERIC NOT NULL,
        UNIQUE(origin_region, destination_region, container_type),
        FOREIGN KEY (container_type) REFERENCES container_types(name) ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);
    await client.query(`ALTER TABLE base_rates ALTER COLUMN container_type TYPE VARCHAR(50);`);

    // Таблица конфигурации индексов
    await client.query(`
      CREATE TABLE IF NOT EXISTS index_config (
        index_name VARCHAR(50) PRIMARY KEY,
        baseline_value NUMERIC NOT NULL,
        weight_percentage NUMERIC NOT NULL CHECK (weight_percentage >= 0 AND weight_percentage <= 100),
        current_value NUMERIC,
        last_updated TIMESTAMP
      );
    `);

    // Таблица настроек модели
    await client.query(`
      CREATE TABLE IF NOT EXISTS model_settings (
        setting_key VARCHAR(50) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        description TEXT
      );
    `);
    await client.query(`ALTER TABLE model_settings ADD COLUMN IF NOT EXISTS description TEXT;`);
    await client.query(`INSERT INTO model_settings (setting_key, setting_value, description) VALUES 
      ('sensitivityCoeff', '0.5', 'Coefficient of sensitivity to index changes (0-1)')
      ON CONFLICT (setting_key) DO NOTHING;`);

    // Таблица истории расчетов
    await client.query(`
      CREATE TABLE IF NOT EXISTS calculation_history (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        origin_port_code VARCHAR(10), 
        destination_port_code VARCHAR(10),
        container_type VARCHAR(50) NOT NULL, -- Увеличим длину
        weight NUMERIC,
        calculated_rate NUMERIC, -- Сделаем NULLABLE на всякий случай, если расчет мог не удаться
        user_email VARCHAR(255),
        origin_port_id INT, 
        destination_port_id INT, 
        index_values_used JSONB 
      );
    `);
    await client.query(`ALTER TABLE calculation_history ADD COLUMN IF NOT EXISTS origin_port_id INT;`);
    await client.query(`ALTER TABLE calculation_history ADD COLUMN IF NOT EXISTS destination_port_id INT;`);
    await client.query(`ALTER TABLE calculation_history ADD COLUMN IF NOT EXISTS weight NUMERIC;`);
    await client.query(`ALTER TABLE calculation_history ADD COLUMN IF NOT EXISTS index_values_used JSONB;`);
    await client.query(`ALTER TABLE calculation_history DROP COLUMN IF EXISTS origin_port;`);
    await client.query(`ALTER TABLE calculation_history DROP COLUMN IF EXISTS destination_port;`);
    await client.query(`ALTER TABLE calculation_history ADD COLUMN IF NOT EXISTS origin_port_code VARCHAR(10);`);
    await client.query(`ALTER TABLE calculation_history ADD COLUMN IF NOT EXISTS destination_port_code VARCHAR(10);`);
    await client.query(`ALTER TABLE calculation_history ADD COLUMN IF NOT EXISTS calculated_rate NUMERIC;`); // Добавлено в v4.6 через миграцию
    await client.query(`ALTER TABLE calculation_history ALTER COLUMN container_type TYPE VARCHAR(50);`);

    // Таблицы для анализа сезонности
    await initializeSeasonalityTables(client); 

    await client.query("COMMIT");
    console.log("Database tables initialized/verified successfully.");

  } catch (error) {
    console.error("Error during database transaction, attempting rollback...");
    if (client) { 
      try { await client.query("ROLLBACK"); console.log("Transaction rolled back."); } catch (rollbackError) { console.error("Rollback failed:", rollbackError); }
    }
    console.error("Error initializing database tables:", error);
    throw error;
  } finally {
    if (client) { client.release(); console.log("Database client released."); }
  }
}

// --- Вспомогательные функции --- 

function validateEmail(email) {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}

// Функция для загрузки конфигурации из БД (ВКЛЮЧАЯ current_value для индексов)
async function loadCalculationConfigFromDB() {
    let client;
    try {
        client = await pool.connect();
        // 1. Загрузка базовых ставок
        const baseRatesResult = await client.query('SELECT origin_region, destination_region, container_type, rate FROM base_rates');
        const baseRatesConfig = {};
        baseRatesResult.rows.forEach(row => {
            if (!baseRatesConfig[row.origin_region]) baseRatesConfig[row.origin_region] = {};
            if (!baseRatesConfig[row.origin_region][row.destination_region]) baseRatesConfig[row.origin_region][row.destination_region] = {};
            baseRatesConfig[row.origin_region][row.destination_region][row.container_type] = parseFloat(row.rate);
        });

        // 2. Загрузка ПОЛНОЙ конфигурации индексов (включая current_value)
        const indexConfigResult = await client.query('SELECT index_name, baseline_value, weight_percentage, current_value FROM index_config');
        const indexConfig = {};
        indexConfigResult.rows.forEach(row => {
            indexConfig[row.index_name] = {
                baseline_value: parseFloat(row.baseline_value),
                weight_percentage: parseFloat(row.weight_percentage),
                current_value: row.current_value !== null ? parseFloat(row.current_value) : null // Берем текущее значение из БД
            };
        });

        // 3. Загрузка параметров модели
        const modelParamsResult = await client.query('SELECT setting_key, setting_value FROM model_settings');
        const modelParams = {};
        modelParamsResult.rows.forEach(row => {
            const numValue = parseFloat(row.setting_value);
            modelParams[row.setting_key] = isNaN(numValue) ? row.setting_value : numValue;
        });
        const sensitivityCoeff = modelParams.sensitivityCoeff ?? 0.5;

        return { baseRatesConfig, indexConfig, sensitivityCoeff };

    } catch (error) {
        console.error("Error loading calculation config from DB:", error);
        throw new Error("Failed to load calculation configuration from database.");
    } finally {
        if (client) { client.release(); }
    }
}

// --- ОСНОВНЫЕ API МАРШРУТЫ --- 

// Получение портов для выпадающих списков
app.get('/api/ports', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    // Возвращаем name и code, так как фронтенд их использует
    const result = await client.query('SELECT id, name, code, region FROM ports ORDER BY name'); 
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching ports:', error);
    res.status(500).json({ error: 'Failed to fetch ports' });
  } finally {
    if (client) { client.release(); }
  }
});

// Получение типов контейнеров для выпадающих списков
app.get('/api/container-types', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    // Возвращаем name и description
    const result = await client.query('SELECT id, name, description FROM container_types ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching container types:', error);
    res.status(500).json({ error: 'Failed to fetch container types' });
  } finally {
    if (client) { client.release(); }
  }
});

// Маршрут для расчета фрахтовой ставки (РЕФАКТОРИНГ: использует данные из БД)
app.post('/api/calculate', async (req, res) => {
  console.log("POST /api/calculate: Received request.", req.body);
  try {
    const { originPort, destinationPort, containerType, weight, email } = req.body;
    
    if (!originPort || !destinationPort || !containerType) {
      return res.status(400).json({ error: 'Missing required parameters: originPort, destinationPort, containerType' });
    }
    if (email && !validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // 1. Загрузка всей конфигурации (ставки, индексы с current_value) из БД
    console.log("POST /api/calculate: Loading calculation config from DB...");
    const { baseRatesConfig, indexConfig, sensitivityCoeff } = await loadCalculationConfigFromDB();

    // 2. Получение данных о портах (для регионов и ID)
    let client;
    let originRegion, destinationRegion, originPortId, destinationPortId;
    try {
        client = await pool.connect();
        const originResult = await client.query('SELECT id, region FROM ports WHERE code = $1', [originPort]);
        const destinationResult = await client.query('SELECT id, region FROM ports WHERE code = $1', [destinationPort]);
        if (originResult.rows.length === 0 || destinationResult.rows.length === 0) {
            // Возвращаем 404, если порт не найден, чтобы фронтенд мог это обработать
            console.warn(`POST /api/calculate: Origin or destination port not found. Origin: ${originPort}, Dest: ${destinationPort}`);
            return res.status(404).json({ error: 'Origin or destination port not found in database.' });
        }
        originPortId = originResult.rows[0].id;
        originRegion = originResult.rows[0].region;
        destinationPortId = destinationResult.rows[0].id;
        destinationRegion = destinationResult.rows[0].region;
    } finally {
        if (client) client.release();
    }

    if (!originRegion || !destinationRegion) {
         // Эта ошибка не должна возникать, если порты найдены выше
         console.error('POST /api/calculate: Could not determine region even though ports were found.');
         throw new Error('Could not determine region for origin or destination port.');
    }

    // 3. Получение фактора сезонности
    console.log("POST /api/calculate: Fetching seasonality factor...");
    const seasonalityFactor = await fetchSeasonalityFactor(originRegion, destinationRegion, new Date());
    console.log(`POST /api/calculate: Seasonality factor: ${seasonalityFactor}`);

    // 4. Вызов функции расчета
    console.log("POST /api/calculate: Calling calculateFreightRate...");
    const calculationResult = calculateFreightRate(
        originRegion,
        destinationRegion,
        containerType,
        baseRatesConfig,      // Базовые ставки из БД
        indexConfig,          // Индексы (baseline, weight, current_value) из БД
        seasonalityFactor,
        sensitivityCoeff      // Параметр модели из БД
    );

    // Проверка на ошибки расчета (например, отсутствие базовой ставки)
    if (calculationResult.error) {
        console.error("POST /api/calculate: Calculation error:", calculationResult.error);
        // Возвращаем 400 или 404 в зависимости от типа ошибки
        const statusCode = calculationResult.error.includes("base rate not found") ? 404 : 400;
        return res.status(statusCode).json({ error: calculationResult.error });
    }

    console.log("POST /api/calculate: Calculation successful.", calculationResult);

    // 5. Сохранение запроса в историю (с ID портов и кодами)
    console.log("POST /api/calculate: Saving request to history...");
    await saveRequestToHistory(
        originPort, // Код
        destinationPort, // Код
        containerType,
        weight, // Передаем вес
        calculationResult.finalRate, // Сохраняем итоговую ставку
        email,
        calculationResult.indexValuesUsed, // Сохраняем значения индексов
        originPortId, // ID
        destinationPortId // ID
    );
    console.log("POST /api/calculate: Request saved to history.");

    // 6. Отправка результата клиенту
    res.json({
      rateRange: {
        min: calculationResult.minRate,
        avg: calculationResult.finalRate,
        max: calculationResult.maxRate,
      },
      reliability: calculationResult.reliability,
      sources: calculationResult.sourcesCount,
    });

  } catch (error) {
    console.error('Error during calculation:', error);
    // Отправляем 500 только для непредвиденных серверных ошибок
    if (!res.headersSent) { // Проверяем, не был ли уже отправлен ответ (например, 404 для порта)
        res.status(500).json({ error: 'Internal server error during calculation' });
    }
  }
});

// --- АДМИН API (v4.7) --- 

// -- Порты (CRUD) --
app.get('/api/admin/ports', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    // Убедимся, что выбираем все нужные поля
    const result = await client.query('SELECT id, name, code, region, latitude, longitude, country FROM ports ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Admin: Error fetching ports:', error);
    res.status(500).json({ error: 'Failed to fetch ports' });
  } finally {
    if (client) client.release();
  }
});
app.get('/api/admin/ports/:id', async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT id, name, code, region, latitude, longitude, country FROM ports WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Port not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Admin: Error fetching port details:', error);
        res.status(500).json({ error: 'Failed to fetch port details' });
    } finally {
        if (client) client.release();
    }
});
app.post('/api/admin/ports', async (req, res) => {
    const { name, code, region, latitude, longitude, country } = req.body;
    // Код может быть null, если разрешено схемой
    if (!name) return res.status(400).json({ error: 'Missing required field: name' });
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(
            'INSERT INTO ports (name, code, region, latitude, longitude, country) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [name, code || null, region || null, latitude || null, longitude || null, country || null] // Явно передаем null, если значение пустое
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Admin: Error adding port:', error);
        if (error.code === '23505') { // unique_violation (вероятно, на code)
             return res.status(409).json({ error: 'Port with this code already exists.' });
        }
        res.status(500).json({ error: 'Failed to add port', detail: error.message });
    } finally {
        if (client) client.release();
    }
});
app.put('/api/admin/ports/:id', async (req, res) => {
    const { id } = req.params;
    const { name, code, region, latitude, longitude, country } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing required field: name' });
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(
            'UPDATE ports SET name = $1, code = $2, region = $3, latitude = $4, longitude = $5, country = $6 WHERE id = $7 RETURNING *',
            [name, code || null, region || null, latitude || null, longitude || null, country || null, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Port not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Admin: Error updating port:', error);
         if (error.code === '23505') { // unique_violation
             return res.status(409).json({ error: 'Another port with this code already exists.' });
        }
        res.status(500).json({ error: 'Failed to update port', detail: error.message });
    } finally {
        if (client) client.release();
    }
});
app.delete('/api/admin/ports/:id', async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        // Добавить проверку на использование порта в истории?
        const result = await client.query('DELETE FROM ports WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Port not found' });
        res.status(204).send(); // Успешное удаление без контента
    } catch (error) {
        console.error('Admin: Error deleting port:', error);
        // Обработка ошибки внешнего ключа, если порт используется
        if (error.code === '23503') { 
             return res.status(400).json({ error: 'Cannot delete port: it is referenced in calculation history or elsewhere.' });
        }
        res.status(500).json({ error: 'Failed to delete port', detail: error.message });
    } finally {
        if (client) client.release();
    }
});

// -- Типы контейнеров (CRUD) --
app.get('/api/admin/container-types', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        // Возвращаем name и description
        const result = await client.query('SELECT id, name, description FROM container_types ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Admin: Error fetching container types:', error);
        res.status(500).json({ error: 'Failed to fetch container types' });
    } finally {
        if (client) client.release();
    }
});
// GET для редактирования (если понадобится)
app.get('/api/admin/container-types/:id', async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT id, name, description FROM container_types WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Container type not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Admin: Error fetching container type details:', error);
        res.status(500).json({ error: 'Failed to fetch container type details' });
    } finally {
        if (client) client.release();
    }
});
app.post('/api/admin/container-types', async (req, res) => {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing required field: name' });
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('INSERT INTO container_types (name, description) VALUES ($1, $2) RETURNING *', [name, description || null]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Admin: Error adding container type:', error);
        if (error.code === '23505') { // unique_violation
             return res.status(409).json({ error: 'Container type with this name already exists.' });
        }
        res.status(500).json({ error: 'Failed to add container type', detail: error.message });
    } finally {
        if (client) client.release();
    }
});
// PUT для редактирования (если понадобится)
app.put('/api/admin/container-types/:id', async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing required field: name' });
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(
            'UPDATE container_types SET name = $1, description = $2 WHERE id = $3 RETURNING *',
            [name, description || null, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Container type not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Admin: Error updating container type:', error);
         if (error.code === '23505') { // unique_violation
             return res.status(409).json({ error: 'Another container type with this name already exists.' });
        }
        res.status(500).json({ error: 'Failed to update container type', detail: error.message });
    } finally {
        if (client) client.release();
    }
});
app.delete('/api/admin/container-types/:id', async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        // Получаем имя перед удалением для проверки связей
        const nameResult = await client.query('SELECT name FROM container_types WHERE id = $1', [id]);
        if (nameResult.rows.length === 0) return res.status(404).json({ error: 'Container type not found' });
        const containerName = nameResult.rows[0].name;

        // Проверка, используется ли тип контейнера в базовых ставках
        const checkUsage = await client.query('SELECT 1 FROM base_rates WHERE container_type = $1 LIMIT 1', [containerName]);
        if (checkUsage.rows.length > 0) {
            return res.status(400).json({ error: 'Cannot delete container type: it is used in base rates.' });
        }
        // Проверка использования в истории расчетов
        const checkHistoryUsage = await client.query('SELECT 1 FROM calculation_history WHERE container_type = $1 LIMIT 1', [containerName]);
         if (checkHistoryUsage.rows.length > 0) {
            return res.status(400).json({ error: 'Cannot delete container type: it is used in calculation history.' });
        }

        const result = await client.query('DELETE FROM container_types WHERE id = $1 RETURNING id', [id]);
        // if (result.rows.length === 0) return res.status(404).json({ error: 'Container type not found' }); // Уже проверено выше
        res.status(204).send();
    } catch (error) {
        console.error('Admin: Error deleting container type:', error);
        // Добавим обработку ошибки внешнего ключа на всякий случай
        if (error.code === '23503') { 
             return res.status(400).json({ error: 'Cannot delete container type: it is still referenced elsewhere.' });
        }
        res.status(500).json({ error: 'Failed to delete container type', detail: error.message });
    } finally {
        if (client) client.release();
    }
});

// -- История расчетов --
app.get('/api/admin/calculation-history', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    // Используем коды портов из таблицы history
    const result = await client.query(`
        SELECT 
            h.id, 
            h.timestamp, 
            h.origin_port_code, 
            h.destination_port_code, 
            h.container_type, 
            h.weight, 
            h.calculated_rate, 
            h.user_email, 
            h.index_values_used 
        FROM calculation_history h
        ORDER BY h.timestamp DESC
        LIMIT 100 -- Ограничение для производительности
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Admin: Error fetching calculation history:', error);
    res.status(500).json({ error: 'Failed to fetch calculation history', detail: error.message });
  } finally {
    if (client) client.release();
  }
});

// -- Конфигурация индексов (CRUD + Upload) --
app.get('/api/admin/index-config', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT index_name, baseline_value, weight_percentage, current_value, last_updated FROM index_config ORDER BY index_name');
        res.json(result.rows);
    } catch (error) {
        console.error('Admin: Error fetching index config:', error);
        res.status(500).json({ error: 'Failed to fetch index config' });
    } finally {
        if (client) client.release();
    }
});

// *** НОВЫЙ ЭНДПОИНТ v4.7: Получение данных одного индекса для редактирования ***
app.get('/api/admin/index-config/:index_name', async (req, res) => {
    const { index_name } = req.params;
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT index_name, baseline_value, weight_percentage, current_value, last_updated FROM index_config WHERE index_name = $1', [index_name]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Index config not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Admin: Error fetching index config details:', error);
        res.status(500).json({ error: 'Failed to fetch index config details' });
    } finally {
        if (client) client.release();
    }
});

app.post('/api/admin/index-config', async (req, res) => {
    const { index_name, baseline_value, weight_percentage, current_value } = req.body;
    // Проверяем, что все обязательные поля есть и current_value может быть 0
    if (!index_name || baseline_value == null || weight_percentage == null || current_value == null) {
        return res.status(400).json({ error: 'Missing required fields for index config' });
    }
     if (weight_percentage < 0 || weight_percentage > 100) {
        return res.status(400).json({ error: 'Weight percentage must be between 0 and 100' });
    }
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(
            'INSERT INTO index_config (index_name, baseline_value, weight_percentage, current_value, last_updated) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
            [index_name, baseline_value, weight_percentage, current_value]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Admin: Error adding index config:', error);
        if (error.code === '23505') { // unique_violation
             return res.status(409).json({ error: 'Index with this name already exists.' });
        }
        res.status(500).json({ error: 'Failed to add index config', detail: error.message });
    } finally {
        if (client) client.release();
    }
});

app.put('/api/admin/index-config/:index_name', async (req, res) => {
    const { index_name } = req.params;
    // Запрещаем менять index_name через PUT, он ключ
    const { baseline_value, weight_percentage, current_value } = req.body;
    if (baseline_value == null || weight_percentage == null || current_value == null) {
        return res.status(400).json({ error: 'Missing required fields for index config update' });
    }
     if (weight_percentage < 0 || weight_percentage > 100) {
        return res.status(400).json({ error: 'Weight percentage must be between 0 and 100' });
    }
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(
            'UPDATE index_config SET baseline_value = $1, weight_percentage = $2, current_value = $3, last_updated = NOW() WHERE index_name = $4 RETURNING *',
            [baseline_value, weight_percentage, current_value, index_name]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Index config not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Admin: Error updating index config:', error);
        res.status(500).json({ error: 'Failed to update index config', detail: error.message });
    } finally {
        if (client) client.release();
    }
});

app.delete('/api/admin/index-config/:index_name', async (req, res) => {
    const { index_name } = req.params;
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('DELETE FROM index_config WHERE index_name = $1 RETURNING index_name', [index_name]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Index config not found' });
        res.status(204).send();
    } catch (error) {
        console.error('Admin: Error deleting index config:', error);
        res.status(500).json({ error: 'Failed to delete index config', detail: error.message });
    } finally {
        if (client) client.release();
    }
});

// POST /api/admin/indices/upload - Загрузка индексов из Excel
app.post('/api/admin/indices/upload', upload.single('indicesFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }
    let client;
    try {
        console.log("Admin: Processing uploaded indices Excel file...");
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        if (data.length === 0) {
            return res.status(400).json({ error: 'Excel file is empty or has incorrect format.' });
        }

        client = await pool.connect();
        await client.query('BEGIN');

        let processedCount = 0;
        let skippedCount = 0;

        for (const row of data) {
            const index_name = row.index_name?.toString().trim();
            const baseline_value = parseFloat(row.baseline_value);
            const weight_percentage = parseFloat(row.weight_percentage);
            
            // Обработка current_value, считая пустые/null/undefined/'' как 0.
            let current_value = NaN; 
            const raw_current_value = row.current_value; 

            if (raw_current_value !== undefined && raw_current_value !== null && raw_current_value !== '') {
                current_value = parseFloat(raw_current_value);
                if (isNaN(current_value) && raw_current_value.toString().trim() === '0') {
                     current_value = 0;
                }
            } else {
                 // Пустые, null, undefined считаем как 0
                 current_value = 0;
            }

            // Проверка, что все значения корректны после обработки
            if (!index_name || isNaN(baseline_value) || isNaN(weight_percentage) || isNaN(current_value)) {
                console.warn(`Admin: Skipping index row due to invalid data after processing: ${JSON.stringify(row)} -> Parsed: name=${index_name}, baseline=${baseline_value}, weight=${weight_percentage}, current=${current_value}`);
                skippedCount++;
                continue; 
            }
             if (weight_percentage < 0 || weight_percentage > 100) {
                 console.warn(`Admin: Skipping index row due to invalid weight (${weight_percentage}): ${JSON.stringify(row)}`);
                 skippedCount++;
                 continue;
            }

            // Используем INSERT ... ON CONFLICT (UPSERT)
            const upsertQuery = `
                INSERT INTO index_config (index_name, baseline_value, weight_percentage, current_value, last_updated)
                VALUES ($1, $2, $3, $4, NOW())
                ON CONFLICT (index_name)
                DO UPDATE SET
                    baseline_value = EXCLUDED.baseline_value,
                    weight_percentage = EXCLUDED.weight_percentage,
                    current_value = EXCLUDED.current_value,
                    last_updated = NOW();
            `;
            await client.query(upsertQuery, [index_name, baseline_value, weight_percentage, current_value]);
            processedCount++;
        }
        
        await client.query('COMMIT');
        console.log(`Admin: Indices Excel file processed. ${processedCount} rows processed, ${skippedCount} rows skipped.`);
        res.json({ message: `Файл успешно обработан. Обработано строк: ${processedCount}. Пропущено строк: ${skippedCount}.` });

    } catch (error) {
        console.error('Admin: Error processing indices Excel file:', error);
        if (client) await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to process Excel file', detail: error.message });
    } finally {
        if (client) client.release();
    }
});

// -- Базовые ставки (CRUD + Upload) --
app.get('/api/admin/base-rates', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        // Добавляем id в выборку
        const result = await client.query('SELECT id, origin_region, destination_region, container_type, rate FROM base_rates ORDER BY origin_region, destination_region, container_type');
        res.json(result.rows);
    } catch (error) {
        console.error('Admin: Error fetching base rates:', error);
        res.status(500).json({ error: 'Failed to fetch base rates' });
    } finally {
        if (client) client.release();
    }
});

// *** НОВЫЙ ЭНДПОИНТ v4.7: Получение данных одной базовой ставки для редактирования ***
app.get('/api/admin/base-rates/:id', async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT id, origin_region, destination_region, container_type, rate FROM base_rates WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Base rate not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Admin: Error fetching base rate details:', error);
        res.status(500).json({ error: 'Failed to fetch base rate details' });
    } finally {
        if (client) client.release();
    }
});

app.post('/api/admin/base-rates', async (req, res) => {
    const { origin_region, destination_region, container_type, rate } = req.body;
    if (!origin_region || !destination_region || !container_type || rate == null) {
        return res.status(400).json({ error: 'Missing required fields for base rate' });
    }
    let client;
    try {
        client = await pool.connect();
        // Проверка существования container_type перед вставкой
        const checkType = await client.query('SELECT 1 FROM container_types WHERE name = $1', [container_type]);
        if (checkType.rows.length === 0) {
             return res.status(400).json({ error: `Container type '${container_type}' does not exist. Please add it first.` });
        }

        const result = await client.query(
            'INSERT INTO base_rates (origin_region, destination_region, container_type, rate) VALUES ($1, $2, $3, $4) RETURNING *',
            [origin_region, destination_region, container_type, rate]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Admin: Error adding base rate:', error);
        // Обработка ошибки дубликата ключа
        if (error.code === '23505') { // unique_violation
             return res.status(409).json({ error: 'Base rate for this combination already exists.' });
        }
        // Ошибка внешнего ключа уже обработана выше
        res.status(500).json({ error: 'Failed to add base rate', detail: error.message });
    } finally {
        if (client) client.release();
    }
});

// Используем ID для PUT и DELETE базовых ставок
app.put('/api/admin/base-rates/:id', async (req, res) => {
    const { id } = req.params;
    const { origin_region, destination_region, container_type, rate } = req.body;
    if (!origin_region || !destination_region || !container_type || rate == null) {
        return res.status(400).json({ error: 'Missing required fields for base rate update' });
    }
    let client;
    try {
        client = await pool.connect();
        // Проверка внешнего ключа перед обновлением
        const checkType = await client.query('SELECT 1 FROM container_types WHERE name = $1', [container_type]);
        if (checkType.rows.length === 0) {
             return res.status(400).json({ error: `Container type '${container_type}' does not exist. Please add it first.` });
        }

        const result = await client.query(
            'UPDATE base_rates SET origin_region = $1, destination_region = $2, container_type = $3, rate = $4 WHERE id = $5 RETURNING *',
            [origin_region, destination_region, container_type, rate, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Base rate not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Admin: Error updating base rate:', error);
         // Обработка ошибки дубликата ключа (если вдруг изменили на существующую комбинацию)
        if (error.code === '23505') { 
             return res.status(409).json({ error: 'Base rate for this combination already exists.' });
        }
        res.status(500).json({ error: 'Failed to update base rate', detail: error.message });
    } finally {
        if (client) client.release();
    }
});

app.delete('/api/admin/base-rates/:id', async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('DELETE FROM base_rates WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Base rate not found' });
        res.status(204).send();
    } catch (error) {
        console.error('Admin: Error deleting base rate:', error);
        res.status(500).json({ error: 'Failed to delete base rate', detail: error.message });
    } finally {
        if (client) client.release();
    }
});

// POST /api/admin/base-rates/upload - Загрузка базовых ставок из Excel
app.post('/api/admin/base-rates/upload', upload.single('baseRatesFile'), async (req, res) => {
     if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }
    let client;
    try {
        console.log("Admin: Processing uploaded base rates Excel file...");
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        if (data.length === 0) {
            return res.status(400).json({ error: 'Excel file is empty or has incorrect format.' });
        }

        client = await pool.connect();
        await client.query('BEGIN');
        let processedCount = 0;
        let skippedCount = 0;
        let errorMessages = [];

        // Получаем список существующих типов контейнеров для быстрой проверки
        const validContainerTypesResult = await client.query('SELECT name FROM container_types');
        const validContainerTypes = new Set(validContainerTypesResult.rows.map(r => r.name));

        for (const row of data) {
            const origin_region = row.origin_region?.toString().trim();
            const destination_region = row.destination_region?.toString().trim();
            const container_type = row.container_type?.toString().trim();
            const rate = parseFloat(row.rate);

            if (!origin_region || !destination_region || !container_type || isNaN(rate)) {
                console.warn(`Admin: Skipping base rate row due to invalid data: ${JSON.stringify(row)}`);
                skippedCount++;
                continue; 
            }

            // Проверка существования типа контейнера перед UPSERT
            if (!validContainerTypes.has(container_type)) {
                const errorMsg = `Skipping row: Container type '${container_type}' does not exist. Add it first. Row: ${JSON.stringify(row)}`;
                console.warn(`Admin: ${errorMsg}`);
                errorMessages.push(errorMsg);
                skippedCount++;
                continue;
            }

            // UPSERT
            const upsertQuery = `
                INSERT INTO base_rates (origin_region, destination_region, container_type, rate)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (origin_region, destination_region, container_type)
                DO UPDATE SET rate = EXCLUDED.rate;
            `;
            // Ошибки внешнего ключа здесь быть не должно, т.к. проверили выше
            await client.query(upsertQuery, [origin_region, destination_region, container_type, rate]);
            processedCount++;
        }
        
        await client.query('COMMIT');
        console.log(`Admin: Base rates Excel file processed. ${processedCount} rows processed, ${skippedCount} rows skipped.`);
        let responseMessage = `Файл успешно обработан. Обработано строк: ${processedCount}. Пропущено строк: ${skippedCount}.`;
        if (errorMessages.length > 0) {
            responseMessage += "\nОшибки: \n" + errorMessages.join("\n");
        }
        res.json({ message: responseMessage });

    } catch (error) {
        console.error('Admin: Error processing base rates Excel file:', error);
        if (client) await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to process Excel file', detail: error.message });
    } finally {
        if (client) client.release();
    }
});

// -- Настройки модели (CRUD) --
app.get('/api/admin/model-settings', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT setting_key, setting_value, description FROM model_settings');
    res.json(result.rows);
  } catch (error) {
    console.error('Admin: Error fetching model settings:', error);
    res.status(500).json({ error: 'Failed to fetch model settings' });
  } finally {
    if (client) client.release();
  }
});

app.put('/api/admin/model-settings/:setting_key', async (req, res) => {
    const { setting_key } = req.params;
    const { setting_value } = req.body;
    if (setting_value === undefined || setting_value === null) { // Проверяем и на null
        return res.status(400).json({ error: 'Missing required field: setting_value' });
    }
    // Дополнительная валидация для sensitivityCoeff
    if (setting_key === 'sensitivityCoeff') {
        const parsedValue = parseFloat(setting_value);
        if (isNaN(parsedValue) || parsedValue < 0 || parsedValue > 1) {
            return res.status(400).json({ error: 'Invalid sensitivityCoeff value. Must be between 0 and 1.' });
        }
    }
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(
            'UPDATE model_settings SET setting_value = $1 WHERE setting_key = $2 RETURNING *',
            [setting_value.toString(), setting_key] // Приводим к строке на всякий случай
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Model setting not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Admin: Error updating model setting:', error);
        res.status(500).json({ error: 'Failed to update model setting', detail: error.message });
    } finally {
        if (client) client.release();
    }
});

// --- Запуск сервера --- 

console.log("Starting system initialization...");
initializeSystem().then(() => {
  console.log("System initialization successful. Starting server...");
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}).catch(error => {
    console.error("Failed to initialize system. Server not started.", error);
    process.exit(1); // Выход, если инициализация не удалась
});

