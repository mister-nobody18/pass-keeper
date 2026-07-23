import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db, { dbPath } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function migrate() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);
    console.log(`Migration complete. Database ready at ${dbPath}`);
}

migrate();
