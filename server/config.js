module.exports = {
  app: {
    port: process.env.PORT || 3000
  },
  database: {
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'poker'
  },
  redis: {
    host: process.env.REDISHOST || 'localhost',
    port: process.env.REDISPORT || 6379,
    password: process.env.REDISPASSWORD || ''
  }
};