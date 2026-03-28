/**
 * simulate — visualise trigger conditions from live on-chain data + config
 *
 * Usage:
 *   npm run simulate                   # collect 5 samples (~15s), then display
 *   npm run simulate -- --assume-peg   # instant: use current price as avg proxy
 *   npm run simulate -- --watch        # continuous: refresh every 3 s, build real avg
 */

import fs from 'fs';
import { loadConfig } from './config/loader.js';
import { PriceOracle } from './pricing/oracle.js';
import { formatPair } from './formatters.js';
import { createAveragePauseRule } from './watcher-rules.js';
import type { ResolvedConfig, ResolvedWatchItem, ResolvedTradeConfig } from './config/resolved.js';

// ── constants ─────────────────────────────────────────────────────────────────

const CONFIG_PATH = fs.existsSync('./config.toml') ? './config.toml' : './config.json';
const SAMPLE_INTERVAL_MS = 3000;
const QUICK_SAMPLE_COUNT = 5;
const BAR_WIDTH = 62;

// ── ANSI ─────────────────────────────────────────────────────────────────────

const R  = '\x1b[0m';
const B  = '\x1b[1m';       // bold
const DM = '\x1b[2m';       // dim
const RD = '\x1b[31m';      // red
const GR = '\x1b[32m';      // green
const YL = '\x1b[33m';      // yellow
const BL = '\x1b[34m';      // blue
const CY = '\x1b[36m';      // cyan

// ── helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function pctDiff(base: number, price: number): string {
  const d = ((price - base) / base) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(3)}%`;
}

// ── simulation ────────────────────────────────────────────────────────────────

interface ItemSim {
  item: ResolvedWatchItem;
  currentPrice: number;
  avgPrice: number;
  triggerThreshold: number;
  fastTrackThreshold: number;
  resumePrice: number;
  tradeSide: 'buy' | 'sell';
  /** positive = price still needs to move this % to hit trigger; negative = already past it */
  distanceToTrigger: number;
  distanceToFastTrack: number;
  isTriggered: boolean;
  isFastTrack: boolean;
}

function buildSim(
  item: ResolvedWatchItem,
  currentPrice: number,
  avgPrice: number,
  tradeConfig: ResolvedTradeConfig,
): ItemSim {
  const pctTarget = (item.avgTargetPercent ?? 100) / 100;
  const triggerThreshold = avgPrice * pctTarget;

  const ftExtra = tradeConfig.fastTrackExtraPercent / 100;
  const fastTrackThreshold = item.condition === 'below'
    ? avgPrice * (pctTarget - ftExtra)
    : avgPrice * (pctTarget + ftExtra);

  const { resumePrice } = createAveragePauseRule(item, avgPrice);

  const tradeSide: 'buy' | 'sell' = item.condition === 'below' ? 'buy' : 'sell';

  const isTriggered = item.condition === 'below'
    ? currentPrice <= triggerThreshold
    : currentPrice >= triggerThreshold;

  const isFastTrack = tradeConfig.fastTrackEnabled && (
    item.condition === 'below'
      ? currentPrice <= fastTrackThreshold
      : currentPrice >= fastTrackThreshold
  );

  const distanceToTrigger = item.condition === 'below'
    ? ((currentPrice - triggerThreshold) / avgPrice) * 100
    : ((triggerThreshold - currentPrice) / avgPrice) * 100;

  const distanceToFastTrack = item.condition === 'below'
    ? ((currentPrice - fastTrackThreshold) / avgPrice) * 100
    : ((fastTrackThreshold - currentPrice) / avgPrice) * 100;

  return {
    item,
    currentPrice,
    avgPrice,
    triggerThreshold,
    fastTrackThreshold,
    resumePrice,
    tradeSide,
    distanceToTrigger,
    distanceToFastTrack,
    isTriggered,
    isFastTrack,
  };
}

// ── price bar ─────────────────────────────────────────────────────────────────

interface BarMarker {
  price: number;
  char: string;
  color: string;
  label: string;
}

function buildBar(currentPrice: number, markers: BarMarker[], width: number): string[] {
  const allPrices = [currentPrice, ...markers.map(m => m.price)];
  const span = Math.max(...allPrices) - Math.min(...allPrices);
  const pad = (span > 0 ? span : Math.abs(currentPrice) * 0.001) * 0.12;
  const lo = Math.min(...allPrices) - pad;
  const hi = Math.max(...allPrices) + pad;
  const toPos = (p: number) =>
    Math.min(width - 1, Math.max(0, Math.round(((p - lo) / (hi - lo)) * (width - 1))));

  // Char / color arrays (visual width = width)
  const chars: string[] = Array(width).fill('─');
  const colors: string[] = Array(width).fill(DM);

  for (const m of markers) {
    const pos = toPos(m.price);
    chars[pos] = m.char;
    colors[pos] = m.color;
  }

  // Current price overwrites any marker at same position
  const curPos = toPos(currentPrice);
  chars[curPos] = '●';
  colors[curPos] = B + CY;

  const barLine = chars.map((ch, i) => `${colors[i]}${ch}${R}`).join('');

  // Label row: place each marker label centred above its position
  const topRow: string[] = Array(width).fill(' ');
  // Sort by position to handle collisions from left to right
  const sorted = [...markers].sort((a, b) => toPos(a.price) - toPos(b.price));
  for (const m of sorted) {
    const pos = toPos(m.price);
    const lbl = m.label;
    const start = Math.max(0, Math.min(width - lbl.length, pos - Math.floor(lbl.length / 2)));
    let free = true;
    for (let i = start; i < start + lbl.length; i++) {
      if (topRow[i] !== ' ') { free = false; break; }
    }
    if (free) {
      for (let i = 0; i < lbl.length; i++) topRow[start + i] = lbl[i];
    }
  }

  // Current price label row
  const curLbl = `$${currentPrice.toFixed(5)}`;
  const curStart = Math.max(0, Math.min(width - curLbl.length, curPos - Math.floor(curLbl.length / 2)));
  const botRow: string[] = Array(width).fill(' ');
  for (let i = 0; i < curLbl.length; i++) botRow[curStart + i] = curLbl[i];

  return [
    DM + topRow.join('') + R,
    barLine,
    B + CY + botRow.join('') + R,
  ];
}

// ── renderer ──────────────────────────────────────────────────────────────────

function render(
  pair: string,
  currentPrice: number,
  avgPrice: number | null,
  sampleCount: number,
  maxSamples: number,
  sims: ItemSim[],
  trade: ResolvedTradeConfig,
): void {
  const W = 72;
  const ts = new Date().toLocaleString('zh-CN', { hour12: false });

  process.stdout.write('\x1b[2J\x1b[H');   // clear screen

  console.log(B + '═'.repeat(W) + R);
  console.log(`  ${B}${CY}${pair}${R}  │  Cetus Aggregator  │  ${DM}${ts}${R}`);
  console.log('─'.repeat(W));

  // ── avg / current price ───────────────────────────────────────
  const warmFrac  = Math.min(1, sampleCount / maxSamples);
  const filledLen = Math.round(warmFrac * 20);
  const warmBar   = `[${'█'.repeat(filledLen)}${'░'.repeat(20 - filledLen)}] ${Math.round(warmFrac * 100)}%`;

  if (avgPrice === null) {
    console.log(`  参考均价:   ${YL}暖机中...${R}  ${DM}${warmBar}${R}`);
  } else {
    const windowSec = Math.round(sampleCount * SAMPLE_INTERVAL_MS / 1000);
    console.log(`  参考均价:   ${B}$${avgPrice.toFixed(6)}${R}  ${DM}(${sampleCount} 样本 / ${windowSec}s)  ${warmBar}${R}`);
  }

  const anyFt = sims.some(s => s.isFastTrack);
  const anyTrig = sims.some(s => s.isTriggered);
  const priceColor = anyFt ? B + RD : anyTrig ? B + YL : B + GR;
  const vsAvg = avgPrice !== null ? `  ${DM}(${pctDiff(avgPrice, currentPrice)} vs avg)${R}` : '';
  console.log(`  当前价格:   ${priceColor}$${currentPrice.toFixed(6)}${R}${vsAvg}`);
  console.log();

  // ── price bar ─────────────────────────────────────────────────
  if (avgPrice !== null && sims.length > 0) {
    const markers: BarMarker[] = [
      { price: avgPrice, char: '┼', color: B + BL, label: 'AVG' },
    ];
    for (const s of sims) {
      if (s.tradeSide === 'buy') {
        markers.push({ price: s.triggerThreshold,   char: '◁', color: B + GR, label: 'BUY'    });
        if (trade.fastTrackEnabled)
          markers.push({ price: s.fastTrackThreshold, char: '«', color: B + GR, label: 'FT-BUY' });
      } else {
        markers.push({ price: s.triggerThreshold,   char: '▷', color: B + RD, label: 'SELL'    });
        if (trade.fastTrackEnabled)
          markers.push({ price: s.fastTrackThreshold, char: '»', color: B + RD, label: 'FT-SELL' });
      }
    }

    const [top, bar, bot] = buildBar(currentPrice, markers, BAR_WIDTH);
    const pad = '  ';
    console.log(pad + top);
    console.log(pad + bar);
    console.log(pad + bot);
    console.log(
      `  ${DM}图例: ${CY}●${R}${DM}当前  ${BL}┼${R}${DM}均价  `
      + `${GR}◁${R}${DM}买入  ${GR}«${R}${DM}极速买  `
      + `${RD}▷${R}${DM}卖出  ${RD}»${R}${DM}极速卖${R}`,
    );
    console.log();
  }

  // ── rules table ───────────────────────────────────────────────
  console.log('─'.repeat(W));
  console.log(`  ${B}规则明细${R}`);
  console.log('─'.repeat(W));

  for (const s of sims) {
    const sideStr = s.tradeSide === 'buy' ? `${GR}${B}买入${R}` : `${RD}${B}卖出${R}`;

    let statusStr: string;
    if (s.isFastTrack) {
      statusStr = `${RD}${B}⚡ 极速触发（免确认，立即下单）${R}`;
    } else if (s.isTriggered) {
      const eta = s.item.tradeConfirmations * s.item.pollInterval;
      statusStr = `${YL}${B}⚠ 已触发，等待 ${s.item.tradeConfirmations} 次确认（~${eta}s）${R}`;
    } else {
      statusStr = `${GR}✓ 安全${R}`;
    }

    console.log(`  ${B}[${s.item.id}]${R}  ${sideStr}  ${statusStr}`);

    // trigger line
    let trigDistStr: string;
    if (s.isTriggered && !s.isFastTrack) {
      trigDistStr = `${YL}已超出 ${(-s.distanceToTrigger).toFixed(3)}%${R}`;
    } else if (s.isFastTrack) {
      trigDistStr = `${RD}已超出 ${(-s.distanceToTrigger).toFixed(3)}%${R}`;
    } else {
      trigDistStr = `${DM}还差 ${s.distanceToTrigger.toFixed(3)}%${R}`;
    }
    const trigPct = `${s.item.avgTargetPercent}%`;
    console.log(`    触发阈值:  $${s.triggerThreshold.toFixed(6)}  ${DM}(均价 × ${trigPct})${R}  ${trigDistStr}`);

    // fast-track line
    if (trade.fastTrackEnabled) {
      const ftPctVal = (s.item.avgTargetPercent ?? 100) + (s.tradeSide === 'buy' ? -1 : 1) * trade.fastTrackExtraPercent;
      let ftDistStr: string;
      if (s.isFastTrack) {
        ftDistStr = `${RD}已超出 ${(-s.distanceToFastTrack).toFixed(3)}%${R}`;
      } else {
        ftDistStr = `${DM}还差 ${s.distanceToFastTrack.toFixed(3)}%${R}`;
      }
      console.log(`    极速阈值:  $${s.fastTrackThreshold.toFixed(6)}  ${DM}(均价 × ${ftPctVal.toFixed(1)}%)${R}  ${ftDistStr}`);
    }

    // resume line
    console.log(`    ${DM}触发后暂停，恢复价: $${s.resumePrice.toFixed(6)}${R}`);
    console.log();
  }

  // ── trade config ──────────────────────────────────────────────
  console.log('─'.repeat(W));
  console.log(`  ${B}交易配置${R}`);
  const conf = sims[0]?.item;
  console.log(
    `  常规: ${B}${trade.maxTradePercent}%${R} 余额`
    + `  │  滑点: ${trade.slippagePercent}%`
    + `  │  需 ${conf?.tradeConfirmations ?? '?'} 次确认`
    + ` (×${conf?.pollInterval ?? '?'}s ≈ ~${(conf?.tradeConfirmations ?? 0) * (conf?.pollInterval ?? 0)}s)`,
  );
  if (trade.fastTrackEnabled) {
    console.log(
      `  极速: ${B}${trade.fastTrackTradePercent}%${R} 余额`
      + `  │  额外偏移: ±${trade.fastTrackExtraPercent}%`
      + `  │  最大滑点: ${trade.fastTrackMaxSlippagePercent}%`,
    );
  }
  console.log(B + '═'.repeat(W) + R);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const watchMode  = args.includes('--watch');
  const assumePeg  = args.includes('--assume-peg');

  let config: ResolvedConfig;
  try {
    config = loadConfig(CONFIG_PATH);
  } catch (err) {
    console.error(`${RD}配置加载失败: ${(err as Error).message}${R}`);
    process.exit(1);
  }

  const oracle = new PriceOracle(config.trade.rpcUrl);

  // Group items by token pair (same grouping as the watcher engine)
  interface PairGroup {
    baseToken: string;
    quoteToken: string;
    amount: number;
    items: ResolvedWatchItem[];
    history: number[];
  }
  const groups = new Map<string, PairGroup>();
  for (const item of config.items) {
    const key = `${item.baseToken}::${item.quoteToken}`;
    if (!groups.has(key)) {
      groups.set(key, { baseToken: item.baseToken, quoteToken: item.quoteToken, amount: item.priceQueryMinBaseAmount, items: [], history: [] });
    }
    groups.get(key)!.items.push(item);
  }

  // How many samples make up the full avg window?
  const firstItem = config.items[0];
  const avgWindowMs = (firstItem?.avgWindowMinutes ?? 15) * 60 * 1000;
  const maxSamples  = Math.round(avgWindowMs / SAMPLE_INTERVAL_MS);

  async function fetchAll(): Promise<void> {
    await Promise.all(
      Array.from(groups.values()).map(async (g) => {
        const price = await oracle.getPrice(g.baseToken, g.quoteToken, g.amount, {
          amountMode: 'human',
          forceRefresh: true,
        });
        if (price === null) return;
        g.history.push(price);
        while (g.history.length > maxSamples) g.history.shift();
      }),
    );
  }

  function renderAll(): void {
    for (const g of groups.values()) {
      if (g.history.length === 0) return;
      const currentPrice = g.history[g.history.length - 1];
      const avgPrice = assumePeg
        ? currentPrice
        : g.history.length >= 2
          ? g.history.reduce((a, b) => a + b, 0) / g.history.length
          : null;

      const sims = avgPrice !== null
        ? g.items.map(item => buildSim(item, currentPrice, avgPrice, config.trade))
        : [];

      render(
        formatPair(g.baseToken, g.quoteToken),
        currentPrice,
        avgPrice,
        assumePeg ? maxSamples : g.history.length,
        maxSamples,
        sims,
        config.trade,
      );
    }
  }

  if (watchMode) {
    process.stdout.write('\x1b[2J\x1b[H');
    console.log(`${DM}--watch 模式：每 ${SAMPLE_INTERVAL_MS / 1000}s 刷新，均价将在 ${(avgWindowMs / 60000).toFixed(0)} 分钟内收敛...${R}\n`);
    while (true) {
      await fetchAll();
      renderAll();
      await sleep(SAMPLE_INTERVAL_MS);
    }

  } else if (assumePeg) {
    await fetchAll();
    renderAll();
    console.log(`${DM}（--assume-peg：以当前价代替均价。运行 --watch 可积累真实均价）${R}\n`);

  } else {
    // Default: collect QUICK_SAMPLE_COUNT samples for a rough average
    process.stdout.write(`\n  正在采集 ${QUICK_SAMPLE_COUNT} 个样本`);
    for (let i = 0; i < QUICK_SAMPLE_COUNT; i++) {
      if (i > 0) await sleep(SAMPLE_INTERVAL_MS);
      await fetchAll();
      process.stdout.write('.');
    }
    console.log(' 完成\n');
    renderAll();
    console.log(`${DM}提示: --watch 持续监控  |  --assume-peg 即时显示${R}\n`);
  }
}

main().catch(err => {
  console.error(`${RD}运行出错: ${(err as Error).message}${R}`);
  process.exit(1);
});
