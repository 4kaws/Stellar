'use strict';
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
try {
  const summary = JSON.parse(fs.readFileSync(path.join(root, 'reports', 'pilot-summary.json'), 'utf8'));
  if (summary.status !== 'passed' || summary.baseline.status !== 'accepted-for-pilot') throw new Error('The latest pilot run did not pass');
  const rules = require(path.resolve(root, path.dirname(summary.baseline.reportFile), 'package'));
  console.log('Discounted price:', rules.discount('101', '5000'));
  console.log('Available stock:', rules.inventory_available('25', '7'));
  console.log('Insufficient balance:', rules.transfer_remaining('100', '101'));
} catch (error) {
  console.error(`${error.message}\nRun npm run pilot first.`);
  process.exitCode = 1;
}
