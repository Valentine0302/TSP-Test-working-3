// Интеграционный модуль v4.23: Исправление синтаксиса и обновление версии.

import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer'; // Для обработки загрузки файлов
import xlsx from 'xlsx'; // Для чтения Excel
import fs from 'fs'; // Импортируем модуль fs для чтения файла
// import initialData from './initial_data.js'; // Больше не нужно

// Импорт модулей анализа и расчета
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
     console.log('Initializing freight calculator system v4.23 (Syntax Fix & Version Update).');
    await initializeDatabaseTables();
    await loadInitialDataFromJson(); // <--- Заменено на загрузку из JSON
    console.log('System initialization completed');
  } catch (error) {
    console.error('Error initializing system:', error);
    throw error;
  }
}

// --- Загрузка начальных данных из JSON (v4.23 Syntax Fix & Version Update) ---
async function loadInitialDataFromJson() {
    console.log("Attempting to load initial data from extracted_data.json...");
    let client;
    let initialData;

    // Чтение и парсинг JSON файла
    try {
        const jsonFilePath = path.join(__dirname, 'extracted_data.json');
        const jsonData = fs.readFileSync(jsonFilePath, 'utf8');
        initialData = JSON.parse(jsonData);
        console.log("Successfully loaded and parsed extracted_data.json");
    } catch (err) {
        console.error("Fatal Error: Could not read or parse extracted_data.json. Cannot load initial data.", err);
        throw new Error("Failed to load initial data from JSON file."); // Прерываем инициализацию, если файл не найден/невалиден
    }

    if (!initialData || !initialData.ports || !initialData.container_types || !initialData.indices) {
        console.error("Fatal Error: extracted_data.json is missing required keys (ports, container_types, indices).");
        throw new Error("Invalid initial data structure in JSON file.");
    }

    try {
        client = await pool.connect();

        // 1. Загрузка портов
        console.log("Loading ports from JSON...");
        let portCount = 0;
        for (const port of initialData.ports) {
            try {
                // Modified Query (originally v4.12 logic): Exclude 'id' column completely
                await client.query(
                    `INSERT INTO ports (name, code, region, country, latitude, longitude)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (name) DO NOTHING;`,
                    [port.name, port.code || null, port.region || null, port.country || null, port.latitude || null, port.longitude || null]
                );
                portCount++;
            } catch (err) {
                // Keep detailed logging
                console.warn(`Error inserting port row: ${JSON.stringify(port)}, Error: ${err.message}`);
            }
        }
        console.log(`Finished loading ports. ${portCount} rows processed.`);

        // 2. Загрузка типов контейнеров
        console.log("Loading container types from JSON...");
        let ctCount = 0;
        for (const ct of initialData.container_types) {
            try {
                await client.query(
                    `INSERT INTO container_types (name, description)
                     VALUES ($1, $2)
                     ON CONFLICT (name) DO NOTHING;`, 
                    [ct.name, ct.description || null]
                );
                ctCount++;
            } catch (err) {
                console.warn(`Error inserting container type row: ${JSON.stringify(ct)}, Error: ${err.message}`);
            }
        }
        console.log(`Finished loading container types. ${ctCount} rows processed.`);

        // 3. Загрузка конфигурации индексов
        console.log("Loading index config from JSON...");
        let icCount = 0;
        for (const index of initialData.indices) {
            try {
                const baseline = parseFloat(index.baseline_value);
                const weight = parseFloat(index.weight_percentage); // Вес уже в %, не нужно *100
                const current = parseFloat(index.current_value);
                if (index.index_name && !isNaN(baseline) && !isNaN(weight) && !isNaN(current) && weight >= 0 && weight <= 100) {
                    await client.query(
                        `INSERT INTO index_config (index_name, baseline_value, weight_percentage, current_value, last_updated)
                         VALUES ($1, $2, $3, $4, NOW())
                         ON CONFLICT (index_name) DO NOTHING;`, 
                        [index.index_name, baseline, weight, current]
                    );
                    icCount++;
                } else {
                     console.warn(`Skipping invalid index config row: ${JSON.stringify(index)}`);
                }
            } catch (err) {
                console.warn(`Error inserting index config row: ${JSON.stringify(index)}, Error: ${err.message}`);
            }
        }
        console.log(`Finished loading index config. ${icCount} rows processed.`);
        
        // 4. Загрузка базовых ставок (ОСТАВЛЕНО ПУСТЫМ - загрузка через админку)
        console.log("Skipping initial base rate loading. Base rates should be managed via admin panel.");

        console.log("Initial data loading process completed.");

    } catch (error) {
        console.error("Error loading initial data into database:", error);
        // Не прерываем запуск сервера, но логируем ошибку
    } finally {
        if (client) { client.release(); console.log("Database client released after initial data load."); }
    }
}

// --- Инициализация таблиц БД (v4.23 Syntax Fix & Version Update, logic from v4.13/v4.14) --- 
async function initializeDatabaseTables() {
  console.log("Initializing database tables...");
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // Таблица портов (Logic from v4.13: Принудительное удаление и пересоздание)
    console.log("Dropping and recreating 'ports' table...");
    await client.query(`DROP TABLE IF EXISTS ports CASCADE;`); // Удаляем таблицу, если существует
    await client.query(`
      CREATE TABLE ports (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL, 
        code VARCHAR(10), 
        region VARCHAR(50),
        latitude NUMERIC,
        longitude NUMERIC,
        country VARCHAR(100)
      );
    `);
    console.log("'ports' table recreated successfully.");
    // Дополнительные ALTER TABLE для ports больше не нужны, т.к. таблица создается заново

    // Таблица типов контейнеров (Logic from v4.14: Принудительное удаление и пересоздание с UNIQUE(name))
    console.log("Dropping and recreating 'container_types' table...");
    await client.query(`DROP TABLE IF EXISTS container_types CASCADE;`); // Удаляем таблицу, если существует
    await client.query(`
      CREATE TABLE container_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL, 
        description TEXT
      );
    `);
    console.log("'container_types' table recreated successfully.");
    // Дополнительные ALTER TABLE для container_types больше не нужны 

    // Таблица базовых ставок (без изменений)
    await client.query(`
      CREATE TABLE IF NOT EXISTS base_rates (
        id SERIAL PRIMARY KEY, 
        origin_region VARCHAR(50) NOT NULL,
        destination_region VARCHAR(50) NOT NULL,
        container_type VARCHAR(50) NOT NULL, 
        rate NUMERIC NOT NULL,
        UNIQUE(origin_region, destination_region, container_type),
        FOREIGN KEY (container_type) REFERENCES container_types(name) ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);
    await client.query(`ALTER TABLE base_rates ALTER COLUMN container_type TYPE VARCHAR(50);`);

    // Таблица конфигурации индексов (без изменений)
    await client.query(`
      CREATE TABLE IF NOT EXISTS index_config (
        index_name VARCHAR(50) PRIMARY KEY,
        baseline_value NUMERIC NOT NULL,
        weight_percentage NUMERIC NOT NULL CHECK (weight_percentage >= 0 AND weight_percentage <= 100),
        current_value NUMERIC,
        last_updated TIMESTAMP
      );
    `);

    // Таблица настроек модели (без изменений)
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

    // Таблица истории расчетов (v4.20: принудительное пересоздание для гарантии user_email и актуальной схемы)
    console.log("Dropping and recreating 'calculation_history' table to ensure schema consistency...");
    await client.query(`DROP TABLE IF EXISTS calculation_history CASCADE;`);
    await client.query(`
      CREATE TABLE calculation_history (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        origin_port_code VARCHAR(10), 
        destination_port_code VARCHAR(10),
        container_type VARCHAR(50) NOT NULL, 
        weight NUMERIC,
        calculated_rate NUMERIC, 
        user_email VARCHAR(255),
        origin_port_id INT, 
        destination_port_id INT, 
        index_values_used JSONB 
      );
    `);
    console.log("'calculation_history' table recreated successfully with all columns.");
    // Очистка старых столбцов, если они существовали
    await client.query(`ALTER TABLE calculation_history DROP COLUMN IF EXISTS origin_port;`);
    await client.query(`ALTER TABLE calculation_history DROP COLUMN IF EXISTS destination_port;`);
    // Проверка типа столбца (хотя он уже задан в CREATE)
    await client.query(`ALTER TABLE calculation_history ALTER COLUMN container_type TYPE VARCHAR(50);`);

    // Таблицы для анализа сезонности (без изменений)
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
    if (client) { client.release(); console.log("Database client released after table initialization."); }
  }
}

// --- Вспомогательные функции (без изменений) --- 

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

        // 2. Загрузка конфигурации индексов (включая current_value)
        const indexConfigResult = await client.query('SELECT index_name, baseline_value, weight_percentage, current_value FROM index_config');
        const indicesConfig = {};
        indexConfigResult.rows.forEach(row => {
            indicesConfig[row.index_name] = {
                baseline: parseFloat(row.baseline_value),
                weight: parseFloat(row.weight_percentage) / 100, // Конвертируем % в долю (0-1)
                currentValue: parseFloat(row.current_value) // Используем сохраненное current_value
            };
        });

        // 3. Загрузка настроек модели
        const settingsResult = await client.query('SELECT setting_key, setting_value FROM model_settings');
        const modelSettings = {};
        settingsResult.rows.forEach(row => {
            modelSettings[row.setting_key] = parseFloat(row.setting_value); // Предполагаем, что все настройки числовые
        });

        // 4. Загрузка типов контейнеров (для справки, если нужно)
        const containerTypesResult = await client.query('SELECT name, description FROM container_types');
        const containerTypes = containerTypesResult.rows;

        client.release();
        return { baseRatesConfig, indicesConfig, modelSettings, containerTypes };

    } catch (error) {
        if (client) client.release();
        console.error('Error loading calculation config from DB:', error);
        throw error; // Передаем ошибку дальше
    }
}

// --- API Эндпоинты --- 

// Эндпоинт для расчета ставки
app.post('/api/calculate', async (req, res) => {
    const { originPort, destinationPort, containerType, weight, userEmail } = req.body;

    // Валидация входных данных
    if (!originPort || !destinationPort || !containerType) {
        return res.status(400).json({ error: 'Missing required fields: originPort, destinationPort, containerType' });
    }
    if (userEmail && !validateEmail(userEmail)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    let client;
    try {
        client = await pool.connect();

        // 1. Найти порты в БД по коду или имени (предпочтительно по коду, если он есть)
        // Используем COALESCE для поиска по code, а если он null/пустой, то по name
        const originPortData = await client.query('SELECT * FROM ports WHERE COALESCE(code, name) = $1 LIMIT 1', [originPort]);
        const destinationPortData = await client.query('SELECT * FROM ports WHERE COALESCE(code, name) = $1 LIMIT 1', [destinationPort]);

        if (originPortData.rows.length === 0 || destinationPortData.rows.length === 0) {
            return res.status(404).json({ error: 'Origin or destination port not found' });
        }

        const origin = originPortData.rows[0];
        const destination = destinationPortData.rows[0];

        // 2. Загрузить актуальную конфигурацию расчета из БД
        const { baseRatesConfig, indicesConfig, modelSettings } = await loadCalculationConfigFromDB();

        // 3. Получить фактор сезонности
        const seasonalityFactor = await fetchSeasonalityFactor(client, origin.region, destination.region, new Date());

        // 4. Рассчитать ставку
        const calculatedRate = calculateFreightRate(
            origin.region, 
            destination.region, 
            containerType, 
            baseRatesConfig, 
            indicesConfig, 
            modelSettings.sensitivityCoeff || 0.5, // Значение по умолчанию, если не найдено
            seasonalityFactor
        );

        if (calculatedRate === null) {
            return res.status(404).json({ error: 'Rate not available for the specified route and container type.' });
        }

        // 5. Сохранить запрос в историю (если нужно)
        if (userEmail) { // Сохраняем только если email предоставлен
            await saveRequestToHistory(
                client, 
                origin.code || origin.name, // Используем code, если есть, иначе name
                destination.code || destination.name, 
                containerType, 
                weight, // Добавляем вес
                calculatedRate,
                userEmail,
                origin.id, // Добавляем ID портов
                destination.id,
                indicesConfig // Добавляем использованные значения индексов
            );
        }

        // 6. Отправить результат
        res.json({ rate: calculatedRate.toFixed(2) });

    } catch (error) {
        console.error('Error calculating freight rate:', error);
        res.status(500).json({ error: `Failed to calculate rate: ${error.message}` });
    } finally {
        if (client) client.release();
    }
});

// --- API для Админ-панели --- 

// Получить все порты
app.get('/api/admin/ports', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, code, region, country, latitude, longitude FROM ports ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching ports:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Получить все типы контейнеров
app.get('/api/admin/container-types', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, description FROM container_types ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching container types:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Получить конфигурацию индексов
app.get('/api/admin/indices', async (req, res) => {
    try {
        const result = await pool.query('SELECT index_name, baseline_value, weight_percentage, current_value, last_updated FROM index_config ORDER BY index_name');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching index config:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Получить базовые ставки
app.get('/api/admin/base-rates', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, origin_region, destination_region, container_type, rate FROM base_rates ORDER BY origin_region, destination_region, container_type');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching base rates:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Получить историю расчетов
app.get('/api/admin/history', async (req, res) => {
    try {
        // Добавим LEFT JOIN для получения имен портов
        const result = await pool.query(`
            SELECT 
                h.id, h.timestamp, h.origin_port_code, h.destination_port_code, 
                h.container_type, h.weight, h.calculated_rate, h.user_email, 
                h.index_values_used,
                po.name as origin_port_name, 
                pd.name as destination_port_name
            FROM calculation_history h
            LEFT JOIN ports po ON h.origin_port_code = COALESCE(po.code, po.name)
            LEFT JOIN ports pd ON h.destination_port_code = COALESCE(pd.code, pd.name)
            ORDER BY h.timestamp DESC
            LIMIT 100; -- Ограничим вывод для производительности
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching calculation history:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- Загрузка данных через Админ-панель --- 

// Загрузка Excel файла с индексами
app.post('/api/admin/indices/upload', upload.single('indicesFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    let client;
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0]; // Предполагаем, что данные на первом листе
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        client = await pool.connect();
        await client.query('BEGIN');

        let updatedCount = 0;
        let insertedCount = 0;

        for (const row of data) {
            const indexName = row['Index Name'] || row['index_name'];
            const baselineValue = parseFloat(row['Baseline Value'] || row['baseline_value']);
            const weightPercentage = parseFloat(row['Weight (%)'] || row['weight_percentage']) * 100; // Преобразуем 0.xx в xx
            const currentValue = parseFloat(row['Current Value'] || row['current_value']);

            if (indexName && !isNaN(baselineValue) && !isNaN(weightPercentage) && weightPercentage >= 0 && weightPercentage <= 100) {
                // currentValue может быть null/undefined/0, это нормально, если не указан
                const currentValToInsert = !isNaN(currentValue) ? currentValue : null;

                const result = await client.query(`
                    INSERT INTO index_config (index_name, baseline_value, weight_percentage, current_value, last_updated)
                    VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT (index_name)
                    DO UPDATE SET 
                        baseline_value = EXCLUDED.baseline_value,
                        weight_percentage = EXCLUDED.weight_percentage,
                        current_value = COALESCE(EXCLUDED.current_value, index_config.current_value), -- Обновляем current_value только если оно не null в файле
                        last_updated = NOW()
                    RETURNING xmax; -- xmax = 0 для INSERT, > 0 для UPDATE
                `, [indexName, baselineValue, weightPercentage, currentValToInsert]);
                
                if (result.rows.length > 0) {
                    if (result.rows[0].xmax === 0) {
                        insertedCount++;
                    } else {
                        updatedCount++;
                    }
                }
            } else {
                console.warn(`Skipping invalid row during index upload: ${JSON.stringify(row)}`);
            }
        }

        await client.query('COMMIT');
        res.json({ message: `Indices uploaded successfully. Inserted: ${insertedCount}, Updated: ${updatedCount}.` });

    } catch (error) {
        if (client) { try { await client.query('ROLLBACK'); } catch (rbErr) { console.error('Rollback failed:', rbErr); } }
        console.error('Error uploading indices:', error);
        res.status(500).json({ error: `Failed to upload indices: ${error.message}` });
    } finally {
        if (client) client.release();
    }
});

// Загрузка Excel файла с базовыми ставками
app.post('/api/admin/base-rates/upload', upload.single('baseRatesFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    let client;
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        client = await pool.connect();
        await client.query('BEGIN');

        // Получаем актуальный список типов контейнеров для проверки FK
        const validContainerTypesResult = await client.query('SELECT name FROM container_types');
        const validContainerTypes = new Set(validContainerTypesResult.rows.map(r => r.name));

        let updatedCount = 0;
        let insertedCount = 0;

        for (const row of data) {
            const originRegion = row['Origin Region'] || row['origin_region'];
            const destinationRegion = row['Destination Region'] || row['destination_region'];
            const containerType = row['Container Type'] || row['container_type'];
            const rate = parseFloat(row['Rate'] || row['rate']);

            if (originRegion && destinationRegion && containerType && !isNaN(rate)) {
                // Проверяем FK перед вставкой/обновлением
                if (validContainerTypes.has(containerType)) {
                    const result = await client.query(`
                        INSERT INTO base_rates (origin_region, destination_region, container_type, rate)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT (origin_region, destination_region, container_type)
                        DO UPDATE SET rate = EXCLUDED.rate
                        RETURNING xmax; -- xmax = 0 для INSERT, > 0 для UPDATE
                    `, [originRegion, destinationRegion, containerType, rate]);

                    if (result.rows.length > 0) {
                        if (result.rows[0].xmax === 0) {
                            insertedCount++;
                        } else {
                            updatedCount++;
                        }
                    }
                } else {
                    console.warn(`Skipping base rate row due to non-existent container type '${containerType}': ${JSON.stringify(row)}`);
                }
            } else {
                console.warn(`Skipping invalid row during base rate upload: ${JSON.stringify(row)}`);
            }
        }

        await client.query('COMMIT');
        res.json({ message: `Base rates uploaded successfully. Inserted: ${insertedCount}, Updated: ${updatedCount}.` });

    } catch (error) {
        if (client) { try { await client.query('ROLLBACK'); } catch (rbErr) { console.error('Rollback failed:', rbErr); } }
        console.error('Error uploading base rates:', error);
        res.status(500).json({ error: `Failed to upload base rates: ${error.message}` });
    } finally {
        if (client) client.release();
    }
});

// --- CRUD операции для Админ-панели (Добавлено/Обновлено в v4.7/v4.9) --- 

// Добавить/Обновить Индекс
app.post('/api/admin/indices', async (req, res) => {
    const { index_name, baseline_value, weight_percentage, current_value } = req.body;
    if (!index_name || baseline_value === undefined || weight_percentage === undefined) {
        return res.status(400).json({ error: 'Missing required fields: index_name, baseline_value, weight_percentage' });
    }
    const baseline = parseFloat(baseline_value);
    const weight = parseFloat(weight_percentage);
    const current = current_value !== undefined && current_value !== null ? parseFloat(current_value) : null;

    if (isNaN(baseline) || isNaN(weight) || weight < 0 || weight > 100 || (current !== null && isNaN(current))) {
        return res.status(400).json({ error: 'Invalid numeric values for baseline, weight (0-100), or current value.' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO index_config (index_name, baseline_value, weight_percentage, current_value, last_updated)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (index_name)
            DO UPDATE SET 
                baseline_value = EXCLUDED.baseline_value,
                weight_percentage = EXCLUDED.weight_percentage,
                current_value = EXCLUDED.current_value,
                last_updated = NOW()
            RETURNING *;
        `, [index_name, baseline, weight, current]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error adding/updating index:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Удалить Индекс
app.delete('/api/admin/indices/:index_name', async (req, res) => {
    const { index_name } = req.params;
    try {
        const result = await pool.query('DELETE FROM index_config WHERE index_name = $1 RETURNING *;', [index_name]);
        if (result.rowCount > 0) {
            res.json({ message: 'Index deleted successfully' });
        } else {
            res.status(404).json({ error: 'Index not found' });
        }
    } catch (err) {
        console.error('Error deleting index:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Добавить/Обновить Базовую ставку
app.post('/api/admin/base-rates', async (req, res) => {
    const { origin_region, destination_region, container_type, rate } = req.body;
    if (!origin_region || !destination_region || !container_type || rate === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const parsedRate = parseFloat(rate);
    if (isNaN(parsedRate)) {
        return res.status(400).json({ error: 'Invalid rate value' });
    }

    try {
        // Проверяем, существует ли такой тип контейнера
        const ctCheck = await pool.query('SELECT 1 FROM container_types WHERE name = $1', [container_type]);
        if (ctCheck.rowCount === 0) {
            return res.status(400).json({ error: `Container type '${container_type}' does not exist.` });
        }

        const result = await pool.query(`
            INSERT INTO base_rates (origin_region, destination_region, container_type, rate)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (origin_region, destination_region, container_type)
            DO UPDATE SET rate = EXCLUDED.rate
            RETURNING *;
        `, [origin_region, destination_region, container_type, parsedRate]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error adding/updating base rate:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Удалить Базовую ставку
app.delete('/api/admin/base-rates/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM base_rates WHERE id = $1 RETURNING *;', [id]);
        if (result.rowCount > 0) {
            res.json({ message: 'Base rate deleted successfully' });
        } else {
            res.status(404).json({ error: 'Base rate not found' });
        }
    } catch (err) {
        console.error('Error deleting base rate:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Добавить/Обновить Порт (Добавлено в v4.9)
app.post('/api/admin/ports', async (req, res) => {
    const { name, code, region, country, latitude, longitude } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Missing required field: name' });
    }
    const lat = latitude !== undefined && latitude !== null && latitude !== '' ? parseFloat(latitude) : null;
    const lon = longitude !== undefined && longitude !== null && longitude !== '' ? parseFloat(longitude) : null;

    if ((latitude !== undefined && latitude !== null && latitude !== '' && isNaN(lat)) || 
        (longitude !== undefined && longitude !== null && longitude !== '' && isNaN(lon))) {
        return res.status(400).json({ error: 'Invalid numeric values for latitude or longitude.' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO ports (name, code, region, country, latitude, longitude)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (name) 
            DO UPDATE SET 
                code = EXCLUDED.code,
                region = EXCLUDED.region,
                country = EXCLUDED.country,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude
            RETURNING *;
        `, [name, code || null, region || null, country || null, lat, lon]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error adding/updating port:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Удалить Порт (Добавлено в v4.9)
app.delete('/api/admin/ports/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Сначала проверим, не используется ли порт в базовых ставках или истории (если нужно)
        // Для простоты пока просто удаляем
        const result = await pool.query('DELETE FROM ports WHERE id = $1 RETURNING *;', [id]);
        if (result.rowCount > 0) {
            res.json({ message: 'Port deleted successfully' });
        } else {
            res.status(404).json({ error: 'Port not found' });
        }
    } catch (err) {
        console.error('Error deleting port:', err);
        // Проверка на FK constraint violation (если порт используется)
        if (err.code === '23503') { // Код ошибки PostgreSQL для FK violation
             return res.status(409).json({ error: 'Cannot delete port: It is referenced by other records (e.g., in base rates or calculation history).' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Добавить/Обновить Тип Контейнера (Добавлено в v4.9)
app.post('/api/admin/container-types', async (req, res) => {
    const { name, description } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Missing required field: name' });
    }
    try {
        const result = await pool.query(`
            INSERT INTO container_types (name, description)
            VALUES ($1, $2)
            ON CONFLICT (name) 
            DO UPDATE SET description = EXCLUDED.description
            RETURNING *;
        `, [name, description || null]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error adding/updating container type:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Удалить Тип Контейнера (Добавлено в v4.9)
app.delete('/api/admin/container-types/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM container_types WHERE id = $1 RETURNING *;', [id]);
        if (result.rowCount > 0) {
            res.json({ message: 'Container type deleted successfully' });
        } else {
            res.status(404).json({ error: 'Container type not found' });
        }
    } catch (err) {
        console.error('Error deleting container type:', err);
        if (err.code === '23503') { 
             return res.status(409).json({ error: 'Cannot delete container type: It is referenced by other records (e.g., in base rates).' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Глобальный обработчик ошибок (должен быть последним middleware)
app.use((err, req, res, next) => {
  console.error("[GLOBAL ERROR HANDLER]:", err.stack || err);
  // Если ошибка уже отправила ответ, ничего не делаем
  if (res.headersSent) {
    return next(err);
  }
  // Отправляем JSON ответ об ошибке
  res.status(err.status || 500).json({
    error: err.message || "An unexpected error occurred.",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }) // Включаем стек только в разработке
  });
});

// Запуск сервера
initializeSystem().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Admin panel should be available at http://localhost:${PORT}/admin.html (or your Render URL)`);
  });
}).catch(error => {
  console.error("Failed to initialize system. Server not started.", error);
  process.exit(1); // Завершаем процесс, если инициализация не удалась
});
