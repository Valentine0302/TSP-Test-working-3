import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Определение __dirname для ES модулей
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataFilePath = path.join(__dirname, '..', 'extracted_data.json'); // Путь к JSON файлу

let initialData = {
    ports: [],
    container_types: [],
    indices: []
};

try {
    if (fs.existsSync(dataFilePath)) {
        const jsonData = fs.readFileSync(dataFilePath, 'utf-8');
        const parsedData = JSON.parse(jsonData);
        initialData = {
            ports: parsedData.ports || [],
            container_types: parsedData.container_types || [],
            indices: parsedData.indices || []
        };
        console.log(`Successfully loaded initial data from ${dataFilePath}`);
    } else {
        console.error(`Error: Initial data file not found at ${dataFilePath}. Using empty defaults.`);
    }
} catch (error) {
    console.error(`Error reading or parsing initial data file ${dataFilePath}:`, error);
    console.error("Using empty defaults for initial data.");
}

export default initialData;

