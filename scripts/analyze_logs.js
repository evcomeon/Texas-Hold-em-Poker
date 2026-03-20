#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const logFile = process.argv[2] || 'railway_logs.json';

if (!fs.existsSync(logFile)) {
  console.log('Usage: node analyze_logs.js <log_file.json>');
  console.log('');
  console.log('Log file formats supported:');
  console.log('  - Railway JSON logs (one JSON object per line)');
  console.log('  - Plain text logs');
  process.exit(1);
}

const content = fs.readFileSync(logFile, 'utf-8');
const lines = content.split('\n').filter(l => l.trim());

const stats = {
  totalLines: lines.length,
  performanceLogs: [],
  slowOperations: [],
  errors: [],
  dbQueries: [],
};

lines.forEach((line, idx) => {
  try {
    let log;
    if (line.startsWith('{')) {
      log = JSON.parse(line);
    } else {
      log = { message: line, timestamp: new Date().toISOString() };
    }

    const msg = log.message || log.attributes?.event || '';
    const elapsedMs = log.attributes?.elapsedMs || log.elapsedMs;

    if (elapsedMs !== undefined) {
      stats.performanceLogs.push({
        event: msg || log.attributes?.event,
        elapsedMs,
        timestamp: log.timestamp,
        raw: log,
      });

      if (elapsedMs > 100) {
        stats.slowOperations.push({
          event: msg || log.attributes?.event,
          elapsedMs,
          timestamp: log.timestamp,
        });
      }
    }

    if (msg.includes('db_') || msg.includes('db.') || log.attributes?.event?.includes('db')) {
      stats.dbQueries.push({
        event: msg || log.attributes?.event,
        elapsedMs,
        timestamp: log.timestamp,
      });
    }

    if (log.severity === 'error' || log.level === 'error' || msg.includes('error')) {
      stats.errors.push({
        message: msg,
        timestamp: log.timestamp,
        raw: log,
      });
    }
  } catch (e) {
  }
});

console.log('\n' + '='.repeat(60));
console.log('📊 LOG ANALYSIS REPORT');
console.log('='.repeat(60));
console.log(`\n📁 Total log lines: ${stats.totalLines}`);
console.log(`⏱️  Performance logs: ${stats.performanceLogs.length}`);
console.log(`🐌 Slow operations (>100ms): ${stats.slowOperations.length}`);
console.log(`🗄️  DB queries: ${stats.dbQueries.length}`);
console.log(`❌ Errors: ${stats.errors.length}`);

if (stats.slowOperations.length > 0) {
  console.log('\n' + '='.repeat(60));
  console.log('🐌 SLOW OPERATIONS (>100ms)');
  console.log('='.repeat(60));
  stats.slowOperations
    .sort((a, b) => b.elapsedMs - a.elapsedMs)
    .slice(0, 20)
    .forEach(op => {
      console.log(`  ${op.elapsedMs}ms - ${op.event}`);
    });
}

if (stats.dbQueries.length > 0) {
  console.log('\n' + '='.repeat(60));
  console.log('🗄️  DATABASE QUERIES');
  console.log('='.repeat(60));
  const dbStats = {};
  stats.dbQueries.forEach(q => {
    const key = q.event || 'unknown';
    if (!dbStats[key]) {
      dbStats[key] = { count: 0, totalMs: 0, maxMs: 0 };
    }
    dbStats[key].count++;
    if (q.elapsedMs) {
      dbStats[key].totalMs += q.elapsedMs;
      dbStats[key].maxMs = Math.max(dbStats[key].maxMs, q.elapsedMs);
    }
  });
  Object.entries(dbStats)
    .sort((a, b) => b[1].totalMs - a[1].totalMs)
    .forEach(([event, s]) => {
      const avgMs = s.count > 0 ? Math.round(s.totalMs / s.count) : 0;
      console.log(`  ${event}: ${s.count} calls, avg ${avgMs}ms, max ${s.maxMs}ms`);
    });
}

if (stats.errors.length > 0) {
  console.log('\n' + '='.repeat(60));
  console.log('❌ ERRORS (last 10)');
  console.log('='.repeat(60));
  stats.errors.slice(-10).forEach(err => {
    console.log(`  ${err.message?.substring(0, 100)}...`);
  });
}

console.log('\n' + '='.repeat(60));
console.log('📈 PERFORMANCE SUMMARY');
console.log('='.repeat(60));
const perfByEvent = {};
stats.performanceLogs.forEach(p => {
  const key = p.event || 'unknown';
  if (!perfByEvent[key]) {
    perfByEvent[key] = { count: 0, totalMs: 0, maxMs: 0, minMs: Infinity };
  }
  perfByEvent[key].count++;
  perfByEvent[key].totalMs += p.elapsedMs;
  perfByEvent[key].maxMs = Math.max(perfByEvent[key].maxMs, p.elapsedMs);
  perfByEvent[key].minMs = Math.min(perfByEvent[key].minMs, p.elapsedMs);
});

Object.entries(perfByEvent)
  .sort((a, b) => b[1].totalMs - a[1].totalMs)
  .forEach(([event, s]) => {
    const avgMs = Math.round(s.totalMs / s.count);
    console.log(`  ${event}: ${s.count} calls, avg ${avgMs}ms, min ${s.minMs}ms, max ${s.maxMs}ms`);
  });

console.log('\n');
