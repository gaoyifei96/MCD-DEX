/**
 * 采集器：把麦当劳 MCP 的三份数据拼成一份图鉴底表
 *
 *   1. query-meals        门店菜单（分类 / 标签 / 价格 / 图片）
 *   2. list-nutrition-foods 餐品营养（热量 / 蛋白 / 脂肪 / 碳水 / 钠 / 钙）
 *   3. order-list         历史订单（已品尝标记）
 *
 * 输出 data/catalog.json，字段已脱敏，不含任何 Token、手机号、门牌地址。
 * 用法：MCD_MCP_TOKEN=xxx node src/collector.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, McdMcpClient } from './mcp-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data/catalog.json');

const log = (...a) => console.log('[collect]', ...a);

/** 麦当劳 MCP 统一信封是 { success, code, message, data }，这里把真正的 data 取出来 */
function pick(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    if ('success' in payload && 'data' in payload) return payload.data;
  }
  return payload;
}

/** 从图片路径里抠出上架日期，用于判定新品：.../menu/20260309/product/MS_x.png */
function extractLaunchDate(image) {
  if (!image) return null;
  const m = image.match(/\/menu\/(\d{8})\//);
  if (!m) return null;
  const raw = m[1];
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/** 周边 / 非食用品判定：这些是天然的高稀有度图鉴，且不涉及饮食引导 */
const MERCH_PATTERNS = [/周边/, /棒球帽/, /毛绒/, /玩具/, /水杯/, /帆布袋/, /徽章/];
function isMerch(name) {
  return MERCH_PATTERNS.some((p) => p.test(name));
}

/** 解析 list-nutrition-foods 返回的定宽文本表 */
function parseNutrition(raw) {
  const out = new Map();
  if (typeof raw !== 'string') return out;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('[') || trimmed.startsWith('{')) continue;
    const cols = trimmed.split(',');
    if (cols.length < 9) continue;

    const [name, , , kcal, protein, fat, carb, sodium, calcium] = cols;
    const cleanName = name.trim();
    if (!cleanName || cleanName === 'productName') continue;
    if (out.has(cleanName)) continue; // 接口里有重复项，保留首次出现

    const num = (v) => {
      const n = Number(String(v).trim());
      return Number.isFinite(n) ? n : null;
    };
    out.set(cleanName, {
      kcal: num(kcal),
      protein: num(protein),
      fat: num(fat),
      carb: num(carb),
      sodium: num(sodium),
      calcium: num(calcium),
    });
  }
  return out;
}

function classify({ name, tags, discountType, launchDate, now }) {
  if (isMerch(name)) return { tier: 'merch', reason: '周边 / 非食用品' };

  const joined = tags.join(' ');
  if (tags.includes('周末专享') || tags.includes('周末专享 ')) {
    return { tier: 'limited', reason: '周末限定' };
  }
  if (joined.includes('麦金卡') || String(discountType || '').includes('麦金卡')) {
    return { tier: 'limited', reason: '麦金卡专属' };
  }
  if (tags.includes('上新')) return { tier: 'limited', reason: '季节上新' };

  // 30 天内上架的，按新品处理
  if (launchDate) {
    const days = (now - new Date(launchDate).getTime()) / 86400000;
    if (days >= 0 && days <= 30) return { tier: 'limited', reason: '近期新品' };
  }
  return { tier: 'regular', reason: '常驻供应' };
}

async function main() {
  const client = await createClient();
  const call = async (name, args, label) => {
    try {
      const data = McdMcpClient.unwrap(await client.callTool(name, args));
      log(`${label} ✓`);
      return data;
    } catch (err) {
      log(`${label} ✗ ${err.message}`);
      return null;
    }
  };

  // --- 1. 定位门店 ---
  const addresses = pick(await call('delivery-query-addresses', {}, '配送地址'));
  let store = null;
  const addrList = Array.isArray(addresses?.addresses) ? addresses.addresses : [];
  if (addrList.length) {
    const stores = pick(
      await call('delivery-query-stores', { beType: 2, addressId: addrList[0].addressId }, '可配送门店')
    );
    store = Array.isArray(stores) ? stores[0] : null;
  }
  const ctx = {
    storeCode: store?.storeCode || 'DEMO',
    beCode: store?.beCode || 'DEMO',
    storeName: store?.storeName || '示例门店（未接入 MCP）',
  };
  log(`门店: ${ctx.storeName}`);

  // --- 2. 取菜单 ---
  const menu = pick(
    await call(
      'query-meals',
      { storeCode: ctx.storeCode, beCode: ctx.beCode, beType: 2, orderType: 2 },
      '门店菜单'
    )
  );

  // --- 3. 取营养表 ---
  const nutritionRaw = pick(await call('list-nutrition-foods', {}, '营养数据'));
  const nutrition = parseNutrition(nutritionRaw);

  // --- 4. 取历史订单（可能为空） ---
  const orders = pick(await call('order-list', {}, '历史订单'));
  const orderList = Array.isArray(orders?.list) ? orders.list : [];

  const tasted = new Map(); // productCode -> { firstAt, times }
  let orderCount = 0;
  for (const order of orderList) {
    orderCount += 1;
    const at = order.createTime || null;
    for (const p of order.orderProductList || []) {
      const prev = tasted.get(p.productCode);
      if (prev) {
        prev.times += p.quantity || 1;
      } else {
        tasted.set(p.productCode, { firstAt: at, times: p.quantity || 1 });
      }
    }
  }
  log(`历史订单 ${orderCount} 单，覆盖 ${tasted.size} 个餐品`);

  // --- 5. 合并 ---
  const now = new Date();
  const categories = menu?.categories || [];
  const mealMap = menu?.meals || {};

  // 同一个餐品会同时挂在「人气热卖」和它本品类下，且各分类给的 tags 并不完整。
  // 必须先按 code 聚合、把 tags 取并集，之后才能做定级和套餐判定 ——
  // 否则像「XX四件套」这种套餐会因为最后一次出现时丢了"四件套"标签，被误当成单品。
  const merged = new Map();
  for (const cat of categories) {
    for (const entry of cat.meals || []) {
      const detail = mealMap[entry.code];
      if (!detail) continue;
      const catName = cat.name.replace(/\s+/g, '');
      const prev = merged.get(entry.code);
      if (prev) {
        prev.tags = [...new Set([...prev.tags, ...(entry.tags || [])])];
        if (!prev.categories.includes(catName)) prev.categories.push(catName);
      } else {
        merged.set(entry.code, {
          detail,
          code: entry.code,
          tags: [...(entry.tags || [])],
          categories: [catName],
        });
      }
    }
  }

  const items = [...merged.values()].map((m) => {
    const detail = m.detail;
    const tags = m.tags;
    const launchDate = extractLaunchDate(detail.image);
    const eat = tasted.get(m.code) || null;
    const nameKey = detail.name.replace(/\s+/g, '');

    const isCombo =
      tags.some((t) => /件套|套餐|拼|桶|盒|餐$/.test(t)) || /餐$|双全盒|件套/.test(detail.name);

    const { tier, reason } = classify({
      name: detail.name,
      tags,
      discountType: detail.discountType,
      launchDate,
      now,
    });

    return {
      code: m.code,
      name: detail.name,
      category: m.categories[0],
      categories: m.categories,
      tier,
      tierReason: reason,
      tags,
      isCombo,
      price: Number(detail.currentPrice) || null,
      originalPrice: Number(detail.originalPrice) || null,
      onSale: Boolean(detail.discountType),
      discountType: detail.discountType || null,
      launchDate,
      nutrition: nutrition.get(nameKey) || nutrition.get(detail.name) || null,
      state: {
        collected: Boolean(eat),
        tasted: Boolean(eat),
        source: eat ? 'order' : null,
        firstTastedAt: eat?.firstAt || null,
        times: eat?.times || 0,
      },
    };
  });

  const finalItems = items.sort((a, b) => a.name.localeCompare(b.name, 'zh'));

  const catalog = {
    meta: {
      generatedAt: new Date().toISOString(),
      storeName: ctx.storeName,
      itemCount: finalItems.length,
      tastedCount: finalItems.filter((i) => i.state.tasted).length,
      hasRealOrders: orderCount > 0,
      note: '由 src/collector.mjs 通过麦当劳 MCP 生成，已脱敏，不含凭证与个人联系方式',
    },
    tierLegend: {
      regular: '常驻供应 · 游戏可合成',
      limited: '限定上架 · 仅真实消费可获得',
      merch: '品牌周边 · 超高稀有度',
    },
    items: finalItems,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(catalog, null, 2), 'utf-8');

  // 同时导出一个 JS 版本：用 <script> 标签加载即可，绕过 file:// 下 fetch 的 CORS 限制，
  // 让别人 clone 下来双击 index.html 就能玩，不需要起服务器
  const jsOut = resolve(ROOT, 'data/catalog.js');
  await writeFile(
    jsOut,
    `/* 由 src/collector.mjs 自动生成，请勿手改 */\nwindow.__MCD_CATALOG__ = ${JSON.stringify(catalog)};\n`,
    'utf-8'
  );

  const byTier = finalItems.reduce((acc, i) => ((acc[i.tier] = (acc[i.tier] || 0) + 1), acc), {});
  log('---');
  log(`输出: data/catalog.json`);
  log(`图鉴总数 ${finalItems.length}｜常驻 ${byTier.regular || 0}｜限定 ${byTier.limited || 0}｜周边 ${byTier.merch || 0}`);
  log(`已匹配营养数据 ${finalItems.filter((i) => i.nutrition).length} 项`);
  if (!orderCount) log('提示：该账号暂无历史订单，图鉴已品尝标记为空，可先体验游戏解锁路径');
}

main().catch((err) => {
  console.error('[collect] 失败:', err.message);
  process.exit(1);
});
