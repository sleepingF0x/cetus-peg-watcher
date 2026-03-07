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
