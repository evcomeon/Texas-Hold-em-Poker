// ============================================================
// Database Initialization Script
// ============================================================

require('dotenv').config();
const { initializeDatabase, dropAllTables } = require('../db/schema');

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--drop')) {
    await dropAllTables();
  }
  
  await initializeDatabase();
  
  console.log('🎉 Database initialization complete!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Database initialization failed:', err);
  process.exit(1);
});
