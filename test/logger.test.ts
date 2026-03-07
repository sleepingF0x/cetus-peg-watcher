import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { createLogger, createModuleLogger } from '../src/logger.js';

class CaptureStream extends Writable {
  public readonly chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
    callback();
  }
}

test('createModuleLogger writes structured JSON logs with standard fields', () => {
  const destination = new CaptureStream();
  const baseLogger = createLogger({
    service: 'test-service',
    level: 'info',
    destination,
  });
  const logger = createModuleLogger('Watcher', baseLogger);

  logger.info(
    {
      event: 'monitor_tick',
      pair: 'SUI/USDC',
      price: 1.2345,
      threshold: 1.2,
    },
    'monitor snapshot',
  );

  assert.equal(destination.chunks.length, 1);
  const payload = JSON.parse(destination.chunks[0]);
  assert.equal(payload.level, 30);
  assert.equal(payload.levelName, 'info');
  assert.equal(payload.service, 'test-service');
  assert.equal(payload.module, 'Watcher');
  assert.equal(payload.event, 'monitor_tick');
  assert.equal(payload.pair, 'SUI/USDC');
  assert.equal(payload.price, 1.2345);
  assert.equal(payload.threshold, 1.2);
  assert.equal(payload.msg, 'monitor snapshot');
  assert.ok(typeof payload.time === 'string');
});

test('error logs include serialized error details', () => {
  const destination = new CaptureStream();
  const baseLogger = createLogger({
    service: 'test-service',
    level: 'info',
    destination,
  });
  const logger = createModuleLogger('Cetus', baseLogger);
  const error = new Error('request timeout');

  logger.error(
    {
      event: 'price_fetch_failed',
      pair: 'SUI/USDC',
      err: error,
    },
    'failed to fetch price',
  );

  assert.equal(destination.chunks.length, 1);
  const payload = JSON.parse(destination.chunks[0]);
  assert.equal(payload.level, 50);
  assert.equal(payload.levelName, 'error');
  assert.equal(payload.event, 'price_fetch_failed');
  assert.equal(payload.msg, 'failed to fetch price');
  assert.equal(payload.err.type, 'Error');
  assert.equal(payload.err.message, 'request timeout');
  assert.ok(typeof payload.err.stack === 'string');
});
