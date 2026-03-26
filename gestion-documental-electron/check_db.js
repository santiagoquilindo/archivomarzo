const { db } = require('./backend/src/db/db');
const fs = require('fs');
const path = require('path');

db.all('SELECT id, name, absolute_path, is_active FROM root_folders', (err, rows) => {
  if (err) {
    console.error('Error querying root_folders:', err);
  } else {
    console.log('Root folders in DB:');
    rows.forEach(row => {
      const normalizedPath = path.resolve(row.absolute_path);
      console.log(`ID: ${row.id}, Name: ${row.name}, Raw Path: ${row.absolute_path}, Normalized: ${normalizedPath}, Active: ${row.is_active}`);
      try {
        fs.accessSync(normalizedPath);
        console.log(`  Path exists: YES`);
        const items = fs.readdirSync(normalizedPath);
        console.log(`  Items in dir: ${items.length} (${items.slice(0, 5).join(', ')}${items.length > 5 ? '...' : ''})`);
      } catch (error) {
        console.log(`  Path exists: NO, error: ${error.message}`);
      }
    });
  }
  db.close();
});