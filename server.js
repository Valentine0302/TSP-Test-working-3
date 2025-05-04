// Интеграционный модуль v3: Расчет вызывает скраперы для Current Value.

import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Импорт МОДИФИЦИРОВАННЫХ модулей скраперов (читают из БД через API)
// Теперь они ВЫЗЫВАЮТСЯ для получения Current Value в /api/calculate
// Используем именованные импорты (ESM)
import { getSCFIDataForCalculation } from './scfi_scraper.js';
import { getFBXDataForCalculation } from './fbx_scraper.js';
import { getWCIDataForCalculation } from './wci_scraper.js';
import { getXenetaDataForCalculation } from './xeneta_scraper.js';
import { getCCFIDataForCalculation } from './ccfi_scraper.js';
import { getCfiDataForCalculation } from './cfi_scraper.js';
import { getHarpexDataForCalculation } from './harpex_scraper.js';
import { getNewConTexDataForCalculation } from './contex_scraper.js';
import { getBdiDataForCalculation } from './bdi_scraper.js';

// Импорт модулей анализа и расчета (Используем именованные импорты)
import { initializeAndUpdateSeasonalityData, initializeSeasonalityTables, fetchSeasonalityFactor } from './seasonality_analyzer.js'; // Обновлено, добавлено initializeSeasonalityTables
import { calculateFreightRate, saveRequestToHistory } from './freight_calculator_enhanced.js'; // Обновлено

// Загрузка переменных окружения
dotenv.config();

// Определение __dirname для ES модулей
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Redirect /admin to /admin.html for convenience
app.get('/admin', (req, res) => {
  res.redirect('/admin.html');
});

// --- Инициализация системы --- 
async function initializeSystem() {
  try {
    console.log('Initializing freight calculator system v3...');
    await initializeDatabaseTables(); 
    // await initializeAndUpdateSeasonalityData(false); // Вызов перенесен внутрь initializeDatabaseTables
    console.log('System initialization completed');
  } catch (error) {
    console.error('Error initializing system:', error);
    throw error; // Пробрасываем ошибку, чтобы catch ниже сработал
  }
}

// --- Инициализация таблиц БД с детальным логированием --- 
async function initializeDatabaseTables() {
  console.log("Initializing database tables...");
  let client;
  try {
    console.log("Attempting to connect to database...");
    client = await pool.connect();
    console.log("Database client connected.");

    console.log("Starting database transaction...");
    await client.query("BEGIN");
    console.log("Transaction started.");

    // Таблица портов
    console.log("Creating/verifying ports table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS ports (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(10) UNIQUE NOT NULL,
        region VARCHAR(50),
        latitude NUMERIC,
        longitude NUMERIC,
        country VARCHAR(100)
      );
    `);
    console.log("Ports table checked/created.");
    console.log("Checking/adding country column to ports...");
    await client.query(`ALTER TABLE ports ADD COLUMN IF NOT EXISTS country VARCHAR(100);`);
    console.log("Country column checked/added.");

    // Таблица типов контейнеров
    console.log("Creating/verifying container_types table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS container_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(10) UNIQUE NOT NULL
      );
    `);
    console.log("Container_types table checked/created.");

    // Таблица базовых ставок
    console.log("Creating/verifying base_rates table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS base_rates (
        id SERIAL PRIMARY KEY,
        origin_region VARCHAR(50) NOT NULL,
        destination_region VARCHAR(50) NOT NULL,
        container_type VARCHAR(10) NOT NULL,
        rate NUMERIC NOT NULL,
        UNIQUE(origin_region, destination_region, container_type)
      );
    `);
    console.log("Base_rates table checked/created.");

    // Таблица конфигурации индексов
    console.log("Creating/verifying index_config table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS index_config (
        index_name VARCHAR(50) PRIMARY KEY,
        baseline_value NUMERIC NOT NULL,
        weight_percentage NUMERIC NOT NULL CHECK (weight_percentage >= 0 AND weight_percentage <= 100),
        current_value NUMERIC,
        last_updated TIMESTAMP
      );
    `);
    console.log("Index_config table checked/created.");

    // Таблица настроек модели
    console.log("Creating/verifying model_settings table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS model_settings (
        setting_key VARCHAR(50) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        description TEXT
      );
    `);
    console.log("Model_settings table checked/created.");
    console.log("Checking/adding description column to model_settings...");
    await client.query(`ALTER TABLE model_settings ADD COLUMN IF NOT EXISTS description TEXT;`);
    console.log("Description column checked/added.");
    console.log("Inserting default sensitivityCoeff...");
    await client.query(`INSERT INTO model_settings (setting_key, setting_value, description) VALUES 
      ('sensitivityCoeff', '0.5', 'Coefficient of sensitivity to index changes (0-1)')
      ON CONFLICT (setting_key) DO NOTHING;`);
    console.log("Default sensitivityCoeff inserted/ignored.");

    // Таблица истории расчетов
    console.log("Creating/verifying calculation_history table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS calculation_history (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        origin_port VARCHAR(10) NOT NULL,
        destination_port VARCHAR(10) NOT NULL,
        container_type VARCHAR(10) NOT NULL,
        weight NUMERIC,
        calculated_rate NUMERIC NOT NULL,
        user_email VARCHAR(255),
        index_sources JSONB,
        origin_port_id INT,
        destination_port_id INT
      );
    `);
    console.log("Calculation_history table checked/created.");
    console.log("Checking/adding port_id columns to calculation_history...");
    await client.query(`ALTER TABLE calculation_history ADD COLUMN IF NOT EXISTS origin_port_id INT;`);
    await client.query(`ALTER TABLE calculation_history ADD COLUMN IF NOT EXISTS destination_port_id INT;`);
    console.log("Port_id columns checked/added.");

    // Таблицы для анализа сезонности (вызов функции из seasonality_analyzer.js)
    console.log("Calling initializeSeasonalityTables (imported function)...");
    await initializeSeasonalityTables(); // Используем импортированную функцию
    console.log("initializeSeasonalityTables finished.");

    console.log("Committing transaction...");
    await client.query("COMMIT");
    console.log("Transaction committed.");
    console.log("Database tables initialized/verified successfully.");

  } catch (error) {
    console.error("Error during database transaction, attempting rollback...");
    if (client) { // Убедимся, что client существует перед rollback
      try {
        await client.query("ROLLBACK");
        console.log("Transaction rolled back.");
      } catch (rollbackError) {
        console.error("Error rolling back transaction:", rollbackError);
      }
    }
    console.error("Error initializing database tables:", error);
    throw error; // Пробрасываем ошибку дальше
  } finally {
    if (client) {
      console.log("Releasing database client...");
      client.release();
      console.log("Database client released.");
    }
  }
}


// --- Вспомогательные функции --- 

function validateEmail(email) {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}

// Функция для загрузки конфигурации из БД (БЕЗ current_value для индексов)
async function loadStaticCalculationConfig() {
    let client;
    try {
        console.log("Loading static config: connecting to DB...");
        client = await pool.connect();
        console.log("Loading static config: connected.");
        // 1. Загрузка базовых ставок
        console.log("Loading static config: fetching base rates...");
        const baseRatesResult = await client.query('SELECT origin_region, destination_region, container_type, rate FROM base_rates');
        console.log(`Loading static config: fetched ${baseRatesResult.rowCount} base rates.`);
        const baseRatesConfig = {};
        baseRatesResult.rows.forEach(row => {
            if (!baseRatesConfig[row.origin_region]) {
                baseRatesConfig[row.origin_region] = {};
            }
            if (!baseRatesConfig[row.origin_region][row.destination_region]) {
                baseRatesConfig[row.origin_region][row.destination_region] = {};
            }
            baseRatesConfig[row.origin_region][row.destination_region][row.container_type] = parseFloat(row.rate);
        });

        // 2. Загрузка ТОЛЬКО baseline и weight для индексов
        console.log("Loading static config: fetching index config (static part)...");
        const indexConfigResult = await client.query('SELECT index_name, baseline_value, weight_percentage FROM index_config');
        console.log(`Loading static config: fetched ${indexConfigResult.rowCount} index configs.`);
        const indexStaticConfig = {};
        indexConfigResult.rows.forEach(row => {
            indexStaticConfig[row.index_name] = {
                baseline_value: parseFloat(row.baseline_value),
                weight_percentage: parseFloat(row.weight_percentage)
            };
        });

        // 3. Загрузка параметров модели
        console.log("Loading static config: fetching model settings...");
        const modelParamsResult = await client.query('SELECT setting_key, setting_value FROM model_settings');
        console.log(`Loading static config: fetched ${modelParamsResult.rowCount} model settings.`);
        const modelParams = {};
        modelParamsResult.rows.forEach(row => {
            const numValue = parseFloat(row.setting_value);
            modelParams[row.setting_key] = isNaN(numValue) ? row.setting_value : numValue;
        });
        const sensitivityCoeff = modelParams.sensitivityCoeff ?? 0.5;
        console.log("Loading static config: finished.");
        return { baseRatesConfig, indexStaticConfig, sensitivityCoeff };

    } catch (error) {
        console.error("Error loading static calculation config from DB:", error);
        throw new Error("Failed to load static calculation configuration from database.");
    } finally {
        if (client) {
            console.log("Loading static config: releasing DB client.");
            client.release();
        }
    }
}

// Функция для получения Current Value от всех скраперов
async function getCurrentValuesFromScrapers() {
    console.log("Fetching current values from all scrapers...");
    const scraperFunctions = {
        'SCFI': getSCFIDataForCalculation,
        'FBX': getFBXDataForCalculation,
        'WCI': getWCIDataForCalculation,
        'Xeneta': getXenetaDataForCalculation,
        'CCFI': getCCFIDataForCalculation,
        'CFI': getCfiDataForCalculation,
        'Harpex': getHarpexDataForCalculation,
        'NewConTex': getNewConTexDataForCalculation,
        'BDI': getBdiDataForCalculation
    };

    const indexNames = Object.keys(scraperFunctions);
    const promises = indexNames.map(name => {
        console.log(`Calling scraper for ${name}...`);
        return scraperFunctions[name]().catch(err => {
            console.error(`Error calling scraper for ${name}:`, err);
            return { current_index: null }; // Return null on error
        });
    });

    try {
        const results = await Promise.all(promises);
        const currentValues = {};
        let allScrapersSuccessful = true;

        results.forEach((result, index) => {
            const name = indexNames[index];
            if (result && result.current_index !== undefined && result.current_index !== null) {
                currentValues[name] = parseFloat(result.current_index);
                console.log(`Scraper for ${name} succeeded: ${currentValues[name]}`);
            } else {
                console.error(`Failed to get current value for index: ${name}. Scraper returned:`, result);
                currentValues[name] = null;
                allScrapersSuccessful = false;
            }
        });

        console.log("Current values fetched:", currentValues);
        if (!allScrapersSuccessful) {
             console.warn("Warning: One or more scrapers failed to return a valid current value.");
        }
        return currentValues;

    } catch (error) {
        // This catch might be redundant due to individual catches in Promise.all
        console.error("Unexpected error fetching current values from scrapers:", error);
        throw new Error("Failed to fetch current values from one or more scrapers.");
    }
}

// --- ОСНОВНЫЕ API МАРШРУТЫ --- 

app.get('/api/ports', async (req, res) => {
  let client;
  try {
    console.log("GET /api/ports: Connecting to DB...");
    client = await pool.connect();
    console.log("GET /api/ports: Fetching ports...");
    const result = await client.query('SELECT id, name, code, region FROM ports ORDER BY name');
    console.log(`GET /api/ports: Fetched ${result.rowCount} ports.`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching ports:', error);
    res.status(500).json({ error: 'Failed to fetch ports' });
  } finally {
    if (client) {
        console.log("GET /api/ports: Releasing DB client.");
        client.release();
    }
  }
});

app.get('/api/container-types', async (req, res) => {
  let client;
  try {
    console.log("GET /api/container-types: Connecting to DB...");
    client = await pool.connect();
    console.log("GET /api/container-types: Fetching types...");
    const result = await client.query('SELECT id, name FROM container_types ORDER BY name');
    console.log(`GET /api/container-types: Fetched ${result.rowCount} types.`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching container types:', error);
    res.status(500).json({ error: 'Failed to fetch container types' });
  } finally {
    if (client) {
        console.log("GET /api/container-types: Releasing DB client.");
        client.release();
    }
  }
});

// Маршрут для расчета фрахтовой ставки (РЕФАКТОРИНГ: использует скраперы)
app.post('/api/calculate', async (req, res) => {
  console.log("POST /api/calculate: Received request.", req.body);
  try {
    const { originPort, destinationPort, containerType, weight, email } = req.body;
    
    if (!originPort || !destinationPort || !containerType) {
      console.log("POST /api/calculate: Bad request - missing params.");
      return res.status(400).json({ error: 'Missing required parameters: originPort, destinationPort, containerType' });
    }
    if (email && !validateEmail(email)) {
      console.log("POST /api/calculate: Bad request - invalid email.");
      return res.status(400).json({ error: 'Invalid email format' });
    }

    console.log("POST /api/calculate: Loading static config...");
    const { baseRatesConfig, indexStaticConfig, sensitivityCoeff } = await loadStaticCalculationConfig();

    console.log("POST /api/calculate: Getting current values from scrapers...");
    const currentValues = await getCurrentValuesFromScrapers();

    console.log("POST /api/calculate: Assembling full index config...");
    const indexConfig = {};
    let missingCurrentValue = false;
    for (const indexName in indexStaticConfig) {
        if (currentValues[indexName] === null || currentValues[indexName] === undefined) {
            console.error(`FATAL: Missing current value for required index ${indexName}. Calculation cannot proceed.`);
            missingCurrentValue = true;
            break; // Выход из цикла, если не хватает значения
        }
        indexConfig[indexName] = {
            ...indexStaticConfig[indexName],
            current_value: currentValues[indexName]
        };
    }

    if (missingCurrentValue) {
        console.log("POST /api/calculate: Error - missing current index value.");
        return res.status(500).json({ error: 'Failed to retrieve current value for one or more required indices. Calculation aborted.' });
    }
    
    console.log("POST /api/calculate: Calculating freight rate...");
    const result = await calculateFreightRate(
      originPort,
      destinationPort,
      containerType,
      baseRatesConfig, 
      indexConfig,
      sensitivityCoeff,
      weight,          
      false
    );
    console.log("POST /api/calculate: Calculation finished.", result);
    
    if (email && result.finalRate !== -1) {
      console.log("POST /api/calculate: Saving request to history...");
      try {
        await saveRequestToHistory(
            originPort, 
            destinationPort, 
            containerType, 
            weight, 
            result.finalRate, 
            email, 
            result.calculationDetails?.indexSources
        );
        console.log("POST /api/calculate: Request saved to history.");
      } catch (historyError) {
          console.error("Error saving calculation request to history:", historyError);
          // Не прерываем ответ пользователю, но логируем ошибку
      }
    }
    
    if (result.error) {
        console.log("POST /api/calculate: Calculation resulted in error.", result.error);
        res.status(500).json({ error: result.error });
    } else {
        console.log("POST /api/calculate: Sending successful response.");
        res.json(result);
    }

  } catch (error) {
    console.error('Error calculating freight rate:', error);
    res.status(500).json({ error: error.message || 'Failed to calculate freight rate due to an internal error.' });
  }
});

// Отладочный маршрут для пошагового расчета (РЕФАКТОРИНГ: использует скраперы)
app.post('/api/debug/calculate', async (req, res) => {
  console.log("POST /api/debug/calculate: Received request.", req.body);
  try {
    const { originPort, destinationPort, containerType, weight } = req.body;
    
    if (!originPort || !destinationPort || !containerType) {
      console.log("POST /api/debug/calculate: Bad request - missing params.");
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    console.log(`Debug calculation request: ${originPort} -> ${destinationPort}, ${containerType}, weight: ${weight || 'default'}`);

    console.log("POST /api/debug/calculate: Loading static config...");
    const { baseRatesConfig, indexStaticConfig, sensitivityCoeff } = await loadStaticCalculationConfig();

    console.log("POST /api/debug/calculate: Getting current values from scrapers...");
    const currentValues = await getCurrentValuesFromScrapers();

    console.log("POST /api/debug/calculate: Assembling full index config...");
    const indexConfig = {};
    let missingCurrentValue = false;
    for (const indexName in indexStaticConfig) {
        if (currentValues[indexName] === null || currentValues[indexName] === undefined) {
            console.error(`FATAL (Debug): Missing current value for required index ${indexName}. Calculation cannot proceed.`);
            missingCurrentValue = true;
            break; 
        }
        indexConfig[indexName] = {
            ...indexStaticConfig[indexName],
            current_value: currentValues[indexName]
        };
    }

    if (missingCurrentValue) {
        console.log("POST /api/debug/calculate: Error - missing current index value.");
        return res.status(500).json({ error: 'DEBUG: Failed to retrieve current value for one or more required indices. Calculation aborted.' });
    }
    
    console.log("POST /api/debug/calculate: Calculating freight rate (debug mode)...");
    const result = await calculateFreightRate(
      originPort,
      destinationPort,
      containerType,
      baseRatesConfig,
      indexConfig,
      sensitivityCoeff,
      weight, 
      true // включаем режим отладки
    );
    
    console.log(`Debug calculation completed with ${result.debugLog?.length || 0} log entries`);
    
    if (result.error) {
        console.log("POST /api/debug/calculate: Calculation resulted in error.", result.error);
        res.status(500).json({ error: result.error, debugLog: result.debugLog });
    } else {
        console.log("POST /api/debug/calculate: Sending successful response.");
        res.json(result);
    }

  } catch (error) {
    console.error('Error in debug calculation:', error);
    res.status(500).json({ 
      error: 'Failed to calculate freight rate in debug mode',
      details: error.message,
      stack: error.stack
    });
  }
});

// --- API ДЛЯ АДМИН-ПАНЕЛИ --- 

// GET /api/admin/ports - Получение списка портов для админки
app.get('/api/admin/ports', async (req, res) => {
  let client;
  try {
    console.log("GET /api/admin/ports: Connecting...");
    client = await pool.connect();
    console.log("GET /api/admin/ports: Fetching...");
    const result = await client.query('SELECT id, name, code, region, latitude, longitude, country FROM ports ORDER BY name'); // Added country
    console.log(`GET /api/admin/ports: Fetched ${result.rowCount} ports.`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin ports:', error);
    res.status(500).json({ error: 'Failed to fetch ports for admin' });
  } finally {
    if (client) {
        console.log("GET /api/admin/ports: Releasing client.");
        client.release();
    }
  }
});

// GET /api/admin/ports/:id - Получение деталей одного порта
app.get('/api/admin/ports/:id', async (req, res) => {
    const { id } = req.params;
    let client;
    console.log(`GET /api/admin/ports/${id}: Received request.`);
    try {
        console.log(`GET /api/admin/ports/${id}: Connecting...`);
        client = await pool.connect();
        console.log(`GET /api/admin/ports/${id}: Fetching...`);
        const result = await client.query('SELECT id, name, code, region, latitude, longitude, country FROM ports WHERE id = $1', [id]); // Added country
        if (result.rows.length === 0) {
            console.log(`GET /api/admin/ports/${id}: Port not found.`);
            return res.status(404).json({ error: 'Port not found' });
        }
        console.log(`GET /api/admin/ports/${id}: Found port.`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(`Error fetching port ${id}:`, error);
        res.status(500).json({ error: 'Failed to fetch port details' });
    } finally {
        if (client) {
            console.log(`GET /api/admin/ports/${id}: Releasing client.`);
            client.release();
        }
    }
});

// POST /api/admin/ports - Добавление нового порта
app.post('/api/admin/ports', async (req, res) => {
    const { name, code, region, latitude, longitude, country } = req.body;
    console.log("POST /api/admin/ports: Received request.", req.body);
    if (!name || !code || !region || !country) {
        console.log("POST /api/admin/ports: Bad request - missing fields.");
        return res.status(400).json({ error: 'Missing required fields: name, code, region, country' });
    }
    let client;
    try {
        console.log("POST /api/admin/ports: Connecting...");
        client = await pool.connect();
        console.log("POST /api/admin/ports: Inserting...");
        const result = await client.query(
            'INSERT INTO ports (name, code, region, latitude, longitude, country) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [name, code, region, latitude, longitude, country]
        );
        console.log("POST /api/admin/ports: Inserted successfully.", result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error adding port:', error);
        res.status(500).json({ error: 'Failed to add port' });
    } finally {
        if (client) {
            console.log("POST /api/admin/ports: Releasing client.");
            client.release();
        }
    }
});

// PUT /api/admin/ports/:id - Обновление существующего порта
app.put('/api/admin/ports/:id', async (req, res) => {
    const { id } = req.params;
    const { name, code, region, latitude, longitude, country } = req.body;
    console.log(`PUT /api/admin/ports/${id}: Received request.`, req.body);
    if (!name || !code || !region || !country) {
        console.log(`PUT /api/admin/ports/${id}: Bad request - missing fields.`);
        return res.status(400).json({ error: 'Missing required fields: name, code, region, country' });
    }
    let client;
    try {
        console.log(`PUT /api/admin/ports/${id}: Connecting...`);
        client = await pool.connect();
        console.log(`PUT /api/admin/ports/${id}: Updating...`);
        const result = await client.query(
            'UPDATE ports SET name = $1, code = $2, region = $3, latitude = $4, longitude = $5, country = $6 WHERE id = $7 RETURNING *',
            [name, code, region, latitude, longitude, country, id]
        );
        if (result.rows.length === 0) {
            console.log(`PUT /api/admin/ports/${id}: Port not found.`);
            return res.status(404).json({ error: 'Port not found' });
        }
        console.log(`PUT /api/admin/ports/${id}: Updated successfully.`, result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(`Error updating port ${id}:`, error);
        res.status(500).json({ error: 'Failed to update port' });
    } finally {
        if (client) {
            console.log(`PUT /api/admin/ports/${id}: Releasing client.`);
            client.release();
        }
    }
});

// DELETE /api/admin/ports/:id - Удаление порта
app.delete('/api/admin/ports/:id', async (req, res) => {
    const { id } = req.params;
    let client;
    console.log(`DELETE /api/admin/ports/${id}: Received request.`);
    try {
        console.log(`DELETE /api/admin/ports/${id}: Connecting...`);
        client = await pool.connect();
        console.log(`DELETE /api/admin/ports/${id}: Deleting...`);
        const result = await client.query('DELETE FROM ports WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            console.log(`DELETE /api/admin/ports/${id}: Port not found.`);
            return res.status(404).json({ error: 'Port not found' });
        }
        console.log(`DELETE /api/admin/ports/${id}: Deleted successfully.`);
        res.status(204).send(); // No content
    } catch (error) {
        console.error(`Error deleting port ${id}:`, error);
        res.status(500).json({ error: 'Failed to delete port' });
    } finally {
        if (client) {
            console.log(`DELETE /api/admin/ports/${id}: Releasing client.`);
            client.release();
        }
    }
});

// GET /api/admin/container-types - Получение списка типов контейнеров
app.get('/api/admin/container-types', async (req, res) => {
  let client;
  try {
    console.log("GET /api/admin/container-types: Connecting...");
    client = await pool.connect();
    console.log("GET /api/admin/container-types: Fetching...");
    const result = await client.query('SELECT id, name FROM container_types ORDER BY name');
    console.log(`GET /api/admin/container-types: Fetched ${result.rowCount} types.`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin container types:', error);
    res.status(500).json({ error: 'Failed to fetch container types for admin' });
  } finally {
    if (client) {
        console.log("GET /api/admin/container-types: Releasing client.");
        client.release();
    }
  }
});

// POST /api/admin/container-types - Добавление нового типа контейнера
app.post('/api/admin/container-types', async (req, res) => {
    const { name } = req.body;
    console.log("POST /api/admin/container-types: Received request.", req.body);
    if (!name) {
        console.log("POST /api/admin/container-types: Bad request - missing name.");
        return res.status(400).json({ error: 'Missing required field: name' });
    }
    let client;
    try {
        console.log("POST /api/admin/container-types: Connecting...");
        client = await pool.connect();
        console.log("POST /api/admin/container-types: Inserting...");
        const result = await client.query('INSERT INTO container_types (name) VALUES ($1) RETURNING *', [name]);
        console.log("POST /api/admin/container-types: Inserted successfully.", result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error adding container type:', error);
        res.status(500).json({ error: 'Failed to add container type' });
    } finally {
        if (client) {
            console.log("POST /api/admin/container-types: Releasing client.");
            client.release();
        }
    }
});

// PUT /api/admin/container-types/:id - Обновление типа контейнера
app.put('/api/admin/container-types/:id', async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    console.log(`PUT /api/admin/container-types/${id}: Received request.`, req.body);
    if (!name) {
        console.log(`PUT /api/admin/container-types/${id}: Bad request - missing name.`);
        return res.status(400).json({ error: 'Missing required field: name' });
    }
    let client;
    try {
        console.log(`PUT /api/admin/container-types/${id}: Connecting...`);
        client = await pool.connect();
        console.log(`PUT /api/admin/container-types/${id}: Updating...`);
        const result = await client.query('UPDATE container_types SET name = $1 WHERE id = $2 RETURNING *', [name, id]);
        if (result.rows.length === 0) {
            console.log(`PUT /api/admin/container-types/${id}: Type not found.`);
            return res.status(404).json({ error: 'Container type not found' });
        }
        console.log(`PUT /api/admin/container-types/${id}: Updated successfully.`, result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(`Error updating container type ${id}:`, error);
        res.status(500).json({ error: 'Failed to update container type' });
    } finally {
        if (client) {
            console.log(`PUT /api/admin/container-types/${id}: Releasing client.`);
            client.release();
        }
    }
});

// DELETE /api/admin/container-types/:id - Удаление типа контейнера
app.delete('/api/admin/container-types/:id', async (req, res) => {
    const { id } = req.params;
    let client;
    console.log(`DELETE /api/admin/container-types/${id}: Received request.`);
    try {
        console.log(`DELETE /api/admin/container-types/${id}: Connecting...`);
        client = await pool.connect();
        console.log(`DELETE /api/admin/container-types/${id}: Deleting...`);
        const result = await client.query('DELETE FROM container_types WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            console.log(`DELETE /api/admin/container-types/${id}: Type not found.`);
            return res.status(404).json({ error: 'Container type not found' });
        }
        console.log(`DELETE /api/admin/container-types/${id}: Deleted successfully.`);
        res.status(204).send();
    } catch (error) {
        console.error(`Error deleting container type ${id}:`, error);
        res.status(500).json({ error: 'Failed to delete container type' });
    } finally {
        if (client) {
            console.log(`DELETE /api/admin/container-types/${id}: Releasing client.`);
            client.release();
        }
    }
});

// GET /api/admin/base-rates - Получение базовых ставок
app.get('/api/admin/base-rates', async (req, res) => {
  let client;
  try {
    console.log("GET /api/admin/base-rates: Connecting...");
    client = await pool.connect();
    console.log("GET /api/admin/base-rates: Fetching...");
    const result = await client.query('SELECT id, origin_region, destination_region, container_type, rate FROM base_rates ORDER BY origin_region, destination_region, container_type');
    console.log(`GET /api/admin/base-rates: Fetched ${result.rowCount} rates.`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin base rates:', error);
    res.status(500).json({ error: 'Failed to fetch base rates for admin' });
  } finally {
    if (client) {
        console.log("GET /api/admin/base-rates: Releasing client.");
        client.release();
    }
  }
});

// POST /api/admin/base-rates - Добавление/обновление базовой ставки
app.post('/api/admin/base-rates', async (req, res) => {
    const { origin_region, destination_region, container_type, rate } = req.body;
    console.log("POST /api/admin/base-rates: Received request.", req.body);
    if (!origin_region || !destination_region || !container_type || rate === undefined) {
        console.log("POST /api/admin/base-rates: Bad request - missing fields.");
        return res.status(400).json({ error: 'Missing required fields: origin_region, destination_region, container_type, rate' });
    }
    const parsedRate = parseFloat(rate);
    if (isNaN(parsedRate) || parsedRate < 0) {
        console.log("POST /api/admin/base-rates: Bad request - invalid rate.");
        return res.status(400).json({ error: 'Invalid rate value. Must be a non-negative number.' });
    }
    let client;
    try {
        console.log("POST /api/admin/base-rates: Connecting...");
        client = await pool.connect();
        console.log("POST /api/admin/base-rates: Upserting...");
        const result = await client.query(`
            INSERT INTO base_rates (origin_region, destination_region, container_type, rate)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (origin_region, destination_region, container_type)
            DO UPDATE SET rate = $4
            RETURNING *;
        `, [origin_region, destination_region, container_type, parsedRate]);
        console.log("POST /api/admin/base-rates: Upserted successfully.", result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error upserting base rate:', error);
        res.status(500).json({ error: 'Failed to add or update base rate' });
    } finally {
        if (client) {
            console.log("POST /api/admin/base-rates: Releasing client.");
            client.release();
        }
    }
});

// DELETE /api/admin/base-rates/:id - Удаление базовой ставки
app.delete('/api/admin/base-rates/:id', async (req, res) => {
    const { id } = req.params;
    let client;
    console.log(`DELETE /api/admin/base-rates/${id}: Received request.`);
    try {
        console.log(`DELETE /api/admin/base-rates/${id}: Connecting...`);
        client = await pool.connect();
        console.log(`DELETE /api/admin/base-rates/${id}: Deleting...`);
        const result = await client.query('DELETE FROM base_rates WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            console.log(`DELETE /api/admin/base-rates/${id}: Rate not found.`);
            return res.status(404).json({ error: 'Base rate not found' });
        }
        console.log(`DELETE /api/admin/base-rates/${id}: Deleted successfully.`);
        res.status(204).send();
    } catch (error) {
        console.error(`Error deleting base rate ${id}:`, error);
        res.status(500).json({ error: 'Failed to delete base rate' });
    } finally {
        if (client) {
            console.log(`DELETE /api/admin/base-rates/${id}: Releasing client.`);
            client.release();
        }
    }
});

// GET /api/admin/index-config - Получение конфигурации индексов
app.get('/api/admin/index-config', async (req, res) => {
  let client;
  try {
    console.log("GET /api/admin/index-config: Connecting...");
    client = await pool.connect();
    console.log("GET /api/admin/index-config: Fetching...");
    // Запрашиваем ВСЕ поля, включая current_value и last_updated
    const result = await client.query('SELECT index_name, baseline_value, weight_percentage, current_value, last_updated FROM index_config ORDER BY index_name');
    console.log(`GET /api/admin/index-config: Fetched ${result.rowCount} configs.`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin index config:', error);
    res.status(500).json({ error: 'Failed to fetch index config for admin' });
  } finally {
    if (client) {
        console.log("GET /api/admin/index-config: Releasing client.");
        client.release();
    }
  }
});

// PUT /api/admin/index-config/:index_name - Обновление конфигурации индекса (включая current_value)
app.put('/api/admin/index-config/:index_name', async (req, res) => {
    const { index_name } = req.params;
    const { baseline_value, weight_percentage, current_value } = req.body;
    console.log(`PUT /api/admin/index-config/${index_name}: Received request.`, req.body);

    // Валидация входных данных
    if (baseline_value === undefined || weight_percentage === undefined || current_value === undefined) {
        console.log(`PUT /api/admin/index-config/${index_name}: Bad request - missing fields.`);
        return res.status(400).json({ error: 'Missing required fields: baseline_value, weight_percentage, current_value' });
    }
    const parsedBaseline = parseFloat(baseline_value);
    const parsedWeight = parseFloat(weight_percentage);
    const parsedCurrent = parseFloat(current_value);
    if (isNaN(parsedBaseline) || parsedBaseline <= 0) {
        console.log(`PUT /api/admin/index-config/${index_name}: Bad request - invalid baseline.`);
        return res.status(400).json({ error: 'Invalid baseline_value. Must be a positive number.' });
    }
    if (isNaN(parsedWeight) || parsedWeight < 0 || parsedWeight > 100) {
        console.log(`PUT /api/admin/index-config/${index_name}: Bad request - invalid weight.`);
        return res.status(400).json({ error: 'Invalid weight_percentage. Must be between 0 and 100.' });
    }
    if (isNaN(parsedCurrent)) {
        console.log(`PUT /api/admin/index-config/${index_name}: Bad request - invalid current value.`);
        return res.status(400).json({ error: 'Invalid current_value. Must be a number.' });
    }

    let client;
    try {
        console.log(`PUT /api/admin/index-config/${index_name}: Connecting...`);
        client = await pool.connect();
        console.log(`PUT /api/admin/index-config/${index_name}: Updating...`);
        const result = await client.query(`
            UPDATE index_config 
            SET baseline_value = $1, weight_percentage = $2, current_value = $3, last_updated = CURRENT_TIMESTAMP 
            WHERE index_name = $4 
            RETURNING *;
        `, [parsedBaseline, parsedWeight, parsedCurrent, index_name]);
        
        if (result.rows.length === 0) {
            console.log(`PUT /api/admin/index-config/${index_name}: Index not found.`);
            return res.status(404).json({ error: 'Index configuration not found' });
        }
        console.log(`PUT /api/admin/index-config/${index_name}: Updated successfully.`, result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(`Error updating index config ${index_name}:`, error);
        res.status(500).json({ error: 'Failed to update index configuration' });
    } finally {
        if (client) {
            console.log(`PUT /api/admin/index-config/${index_name}: Releasing client.`);
            client.release();
        }
    }
});

// GET /api/admin/model-settings - Получение настроек модели
app.get('/api/admin/model-settings', async (req, res) => {
  let client;
  try {
    console.log("GET /api/admin/model-settings: Connecting...");
    client = await pool.connect();
    console.log("GET /api/admin/model-settings: Fetching...");
    const result = await client.query('SELECT setting_key, setting_value, description FROM model_settings');
    console.log(`GET /api/admin/model-settings: Fetched ${result.rowCount} settings.`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin model settings:', error);
    res.status(500).json({ error: 'Failed to fetch model settings for admin' });
  } finally {
    if (client) {
        console.log("GET /api/admin/model-settings: Releasing client.");
        client.release();
    }
  }
});

// PUT /api/admin/model-settings/:setting_key - Обновление настройки модели
app.put('/api/admin/model-settings/:setting_key', async (req, res) => {
    const { setting_key } = req.params;
    const { setting_value } = req.body;
    console.log(`PUT /api/admin/model-settings/${setting_key}: Received request.`, req.body);
    if (setting_value === undefined) {
        console.log(`PUT /api/admin/model-settings/${setting_key}: Bad request - missing value.`);
        return res.status(400).json({ error: 'Missing required field: setting_value' });
    }
    
    // Дополнительная валидация для sensitivityCoeff
    if (setting_key === 'sensitivityCoeff') {
        const parsedValue = parseFloat(setting_value);
        if (isNaN(parsedValue) || parsedValue < 0 || parsedValue > 1) {
            console.log(`PUT /api/admin/model-settings/${setting_key}: Bad request - invalid sensitivityCoeff.`);
            return res.status(400).json({ error: 'Invalid sensitivityCoeff value. Must be between 0 and 1.' });
        }
    }

    let client;
    try {
        console.log(`PUT /api/admin/model-settings/${setting_key}: Connecting...`);
        client = await pool.connect();
        console.log(`PUT /api/admin/model-settings/${setting_key}: Updating...`);
        const result = await client.query(
            'UPDATE model_settings SET setting_value = $1 WHERE setting_key = $2 RETURNING *',
            [setting_value, setting_key]
        );
        if (result.rows.length === 0) {
            console.log(`PUT /api/admin/model-settings/${setting_key}: Setting not found.`);
            return res.status(404).json({ error: 'Model setting not found' });
        }
        console.log(`PUT /api/admin/model-settings/${setting_key}: Updated successfully.`, result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(`Error updating model setting ${setting_key}:`, error);
        res.status(500).json({ error: 'Failed to update model setting' });
    } finally {
        if (client) {
            console.log(`PUT /api/admin/model-settings/${setting_key}: Releasing client.`);
            client.release();
        }
    }
});

// GET /api/admin/seasonality - Получение данных сезонности
app.get('/api/admin/seasonality', async (req, res) => {
  let client;
  try {
    console.log("GET /api/admin/seasonality: Connecting...");
    client = await pool.connect();
    console.log("GET /api/admin/seasonality: Fetching factors...");
    const factorsResult = await client.query('SELECT * FROM seasonality_factors ORDER BY origin_region, destination_region, month');
    console.log(`GET /api/admin/seasonality: Fetched ${factorsResult.rowCount} factors.`);
    console.log("GET /api/admin/seasonality: Fetching confidence...");
    const confidenceResult = await client.query('SELECT * FROM seasonality_confidence ORDER BY origin_region, destination_region');
    console.log(`GET /api/admin/seasonality: Fetched ${confidenceResult.rowCount} confidence scores.`);
    res.json({ factors: factorsResult.rows, confidence: confidenceResult.rows });
  } catch (error) {
    console.error('Error fetching admin seasonality data:', error);
    res.status(500).json({ error: 'Failed to fetch seasonality data for admin' });
  } finally {
    if (client) {
        console.log("GET /api/admin/seasonality: Releasing client.");
        client.release();
    }
  }
});

// POST /api/admin/seasonality/recalculate - Пересчет данных сезонности
app.post('/api/admin/seasonality/recalculate', async (req, res) => {
    console.log("POST /api/admin/seasonality/recalculate: Received request.");
    try {
        console.log("POST /api/admin/seasonality/recalculate: Calling recalculation function...");
        // Вызываем функцию пересчета из модуля seasonality_analyzer
        // Передаем true, чтобы форсировать обновление
        await initializeAndUpdateSeasonalityData(true); 
        console.log("POST /api/admin/seasonality/recalculate: Recalculation finished.");
        res.status(200).json({ message: 'Seasonality data recalculation triggered successfully.' });
    } catch (error) {
        console.error('Error triggering seasonality recalculation:', error);
        res.status(500).json({ error: 'Failed to trigger seasonality recalculation', details: error.message });
    }
});

// GET /api/admin/calculation-history - Получение истории расчетов
app.get('/api/admin/calculation-history', async (req, res) => {
  let client;
  try {
    console.log("GET /api/admin/calculation-history: Connecting...");
    client = await pool.connect();
    console.log("GET /api/admin/calculation-history: Fetching...");
    const result = await client.query('SELECT * FROM calculation_history ORDER BY timestamp DESC LIMIT 100'); // Limit for performance
    console.log(`GET /api/admin/calculation-history: Fetched ${result.rowCount} records.`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin calculation history:', error);
    res.status(500).json({ error: 'Failed to fetch calculation history for admin' });
  } finally {
    if (client) {
        console.log("GET /api/admin/calculation-history: Releasing client.");
        client.release();
    }
  }
});

// --- ЗАПУСК СЕРВЕРА --- 

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

