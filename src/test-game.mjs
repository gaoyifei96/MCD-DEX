/**
 * 游戏逻辑自检：确认三件事
 *   1. 进化链能从真实菜单里构建出完整 10 级，且不含套餐和调味品
 *   2. 1024 在「有策略」的情况下可达（随机策略到不了是正常的，但真人必须能到）
 *   3. 难度合适：不能太容易秒通关，也不能难到让人放弃
 * 用法：node src/test-game.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(resolve(__dirname, '../data/catalog.json'), 'utf-8'));

globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = v; },
};
globalThis.window = {
  __MCD_CATALOG__: catalog,
  McdexStore: { collect() { return true; } },
};

new Function(readFileSync(resolve(__dirname, '../web/game.js'), 'utf-8'))();
const G = globalThis.window.McdexGame;

if (!G.init()) {
  console.error('[fail] 进化链构建失败');
  process.exit(1);
}

console.log('进化链 (%d 级)', G.chain.length);
G.chain.forEach((it, i) => {
  console.log(`  2^${String(i + 1).padStart(2)} = ${String(Math.pow(2, i + 1)).padStart(4)} 分  ¥${String(it.price).padStart(5)}  ${it.name}`);
});
const dirty = G.chain.filter((i) => i.isCombo || /件套|套餐|酱$/.test(i.name));
console.log(dirty.length ? `[warn] 进化链里仍有 ${dirty.length} 项不合规: ${dirty.map((i) => i.name)}` : '[ok] 进化链干净，无套餐/调味品混入');

const DIRS = ['left', 'right', 'up', 'down'];
const clone = (g) => g.map((r) => r.slice());

/** 启发式评估：空格越多越好、大数越靠角越好、行列越单调越好 */
const SIZE = G.grid.length;

function evalGrid(g) {
  let empty = 0, max = 0, maxAtCorner = 0, smooth = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = g[r][c];
      if (!v) { empty++; continue; }
      smooth += v;
      if (v > max) { max = v; maxAtCorner = (r === 0 || r === SIZE - 1) && (c === 0 || c === SIZE - 1) ? 1 : 0; }
    }
  }
  // 单调性：向左上角方向递减给奖励
  let mono = 0;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE - 1; c++) if (g[r][c] >= g[r][c + 1]) mono += g[r][c];
  for (let c = 0; c < SIZE; c++) for (let r = 0; r < SIZE - 1; r++) if (g[r][c] >= g[r + 1][c]) mono += g[r][c];
  return empty * 12 + maxAtCorner * 220 + mono * 1.4 + smooth * 0.6;
}

function bestDir(grid) {
  let pick = null, top = -Infinity;
  for (const dir of DIRS) {
    const g = clone(grid);
    const res = G._move(g, dir);
    if (!res.moved) continue;
    const s = evalGrid(g) + res.gained * 2;
    if (s > top) { top = s; pick = dir; }
  }
  return pick;
}

function play(useAi) {
  G.reset();
  let steps = 0;
  while (steps < 8000) {
    const dir = useAi ? bestDir(G.grid) : DIRS[Math.floor(Math.random() * 4)];
    if (!dir) break;
    const res = G.step(dir);
    if (res) steps++;
    if (G.won || G.over) break;
  }
  const top = Math.pow(2, G._maxTile(G.grid));
  return { top, steps, won: G.won };
}

function run(label, useAi, n) {
  const dist = {};
  let wins = 0, totalSteps = 0;
  for (let i = 0; i < n; i++) {
    const r = play(useAi);
    dist[r.top] = (dist[r.top] || 0) + 1;
    totalSteps += r.steps;
    if (r.won) wins++;
    G.won = false; G.over = false;
  }
  console.log(`\n=== ${label} · ${n} 局 ===`);
  Object.keys(dist).map(Number).sort((a, b) => a - b).forEach((v) => {
    const pctN = Math.round((dist[v] / n) * 100);
    console.log(`  ${String(v).padStart(5)}  ${String(dist[v]).padStart(3)} 局 (${String(pctN).padStart(3)}%)  ${'■'.repeat(Math.round(pctN / 2.5))}`);
  });
  console.log(`  通关(1024): ${wins}/${n}   平均步数: ${Math.round(totalSteps / n)}`);
  return { wins, n };
}

const N = 120;
const rnd = run('随机策略（基线）', false, N);
const ai = run('启发式策略（模拟真人）', true, N);

console.log('\n--- 结论 ---');
if (ai.wins === 0) {
  console.log('[fail] 启发式策略也无法通关，1024 太难，玩家会流失。');
  process.exit(1);
}
const rate = ai.wins / ai.n;
if (rate > 0.85) {
  console.log(`[warn] 有策略时通关率 ${Math.round(rate * 100)}%，偏简单，缺少挑战感。`);
} else if (rate < 0.15) {
  console.log(`[warn] 有策略时通关率仅 ${Math.round(rate * 100)}%，偏难。`);
} else {
  console.log(`[ok] 有策略通关率 ${Math.round(rate * 100)}%，随机则几乎不可能 —— 难度曲线合理。`);
}
