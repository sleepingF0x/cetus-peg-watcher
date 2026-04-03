import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig } from '../src/config.js';

function writeTempConfig(config: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cetus-config-'));
  const filePath = path.join(dir, 'config.json');
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  return filePath;
}

test('loadConfig throws when item id is missing', () => {
  const filePath = writeTempConfig({
    telegram: { enabled: false },
    items: [
      {
        baseToken: '0x2::sui::SUI',
        condition: 'below',
        targetPrice: 1.2,
      },
    ],
  });

  assert.throws(() => loadConfig(filePath), /item\[0\]\.id is required/);
});

test('loadConfig throws when item ids are duplicated', () => {
  const filePath = writeTempConfig({
    telegram: { enabled: false },
    items: [
      {
        id: 'usdy-below',
        baseToken: '0x2::sui::SUI',
        condition: 'below',
        targetPrice: 1.2,
      },
      {
        id: 'usdy-below',
        baseToken: '0x2::sui::SUI',
        condition: 'above',
        targetPrice: 1.4,
      },
    ],
  });

  assert.throws(() => loadConfig(filePath), /item ids must be unique: usdy-below/);
});

test('loadConfig preserves valid explicit item ids', () => {
  const filePath = writeTempConfig({
    telegram: { enabled: false },
    items: [
      {
        id: 'sui-below',
        baseToken: '0x2::sui::SUI',
        condition: 'below',
        targetPrice: 1.2,
      },
    ],
  });

  const config = loadConfig(filePath);
  assert.equal(config.items[0].id, 'sui-below');
});

test('loadConfig applies fast-track and status polling defaults', () => {
  const filePath = writeTempConfig({
    telegram: { enabled: false },
    trade: {
      enabled: false,
    },
    items: [
      {
        id: 'sui-below',
        baseToken: '0x2::sui::SUI',
        condition: 'below',
        targetPrice: 1.2,
      },
    ],
  });

  const config = loadConfig(filePath);

  assert.equal(config.trade?.fastTrackEnabled, true);
  assert.equal(config.trade?.fastTrackExtraPercent, 1.5);
  assert.equal(config.trade?.fastTrackTradePercent, 75);
  assert.equal(config.trade?.fastTrackSlippageMultiplier, 0.35);
  assert.equal(config.trade?.fastTrackMaxSlippagePercent, 2);
  assert.equal(config.trade?.statusPollDelayMs, 1500);
  assert.equal(config.trade?.statusPollIntervalMs, 1500);
  assert.equal(config.trade?.statusPollTimeoutMs, 15000);
  assert.equal(config.items[0].priceQueryMinBaseAmount, 1);
});

test('loadConfig preserves explicit price query size', () => {
  const filePath = writeTempConfig({
    telegram: { enabled: false },
    items: [
      {
        id: 'sui-below',
        baseToken: '0x2::sui::SUI',
        condition: 'below',
        targetPrice: 1.2,
        priceQueryMinBaseAmount: 1000,
      },
    ],
  });

  const config = loadConfig(filePath);

  assert.equal(config.items[0].priceQueryMinBaseAmount, 1000);
});

test('loadConfig throws when fast-track percent is out of range', () => {
  const filePath = writeTempConfig({
    telegram: { enabled: false },
    trade: {
      enabled: false,
      fastTrackTradePercent: 120,
    },
    items: [
      {
        id: 'sui-below',
        baseToken: '0x2::sui::SUI',
        condition: 'below',
        targetPrice: 1.2,
      },
    ],
  });

  assert.throws(() => loadConfig(filePath), /trade\.fastTrackTradePercent must be a number between 0 and 100/);
});

test('loadConfig throws when status polling timeout is not positive', () => {
  const filePath = writeTempConfig({
    telegram: { enabled: false },
    trade: {
      enabled: false,
      statusPollTimeoutMs: 0,
    },
    items: [
      {
        id: 'sui-below',
        baseToken: '0x2::sui::SUI',
        condition: 'below',
        targetPrice: 1.2,
      },
    ],
  });

  assert.throws(() => loadConfig(filePath), /trade\.statusPollTimeoutMs must be a positive integer/);
});

test('loadConfig throws when item price query size is not positive', () => {
  const filePath = writeTempConfig({
    telegram: { enabled: false },
    items: [
      {
        id: 'sui-below',
        baseToken: '0x2::sui::SUI',
        condition: 'below',
        targetPrice: 1.2,
        priceQueryMinBaseAmount: 0,
      },
    ],
  });

  assert.throws(() => loadConfig(filePath), /item\[0\]\.priceQueryMinBaseAmount must be a positive number/);
});

test('loadConfig throws when maxSpreadPercent is out of range', () => {
  const filePath = writeTempConfig({
    telegram: { enabled: false },
    items: [
      {
        id: 'sui-below',
        baseToken: '0x2::sui::SUI',
        condition: 'below',
        targetPrice: 1.2,
        maxSpreadPercent: 0,
      },
    ],
  });

  assert.throws(() => loadConfig(filePath), /item\[0\]\.maxSpreadPercent must be a number between 0 and 100/);
});

test('loadConfig resolves maxSpreadPercent when provided', () => {
  const filePath = writeTempConfig({
    telegram: { enabled: false },
    items: [
      {
        id: 'sui-below',
        baseToken: '0x2::sui::SUI',
        condition: 'below',
        targetPrice: 1.2,
        maxSpreadPercent: 3,
      },
    ],
  });

  const config = loadConfig(filePath);
  assert.equal(config.items[0].maxSpreadPercent, 3);
});

test('loadConfig defaults maxSpreadPercent to null when omitted', () => {
  const filePath = writeTempConfig({
    telegram: { enabled: false },
    items: [
      {
        id: 'sui-below',
        baseToken: '0x2::sui::SUI',
        condition: 'below',
        targetPrice: 1.2,
      },
    ],
  });

  const config = loadConfig(filePath);
  assert.equal(config.items[0].maxSpreadPercent, null);
});
