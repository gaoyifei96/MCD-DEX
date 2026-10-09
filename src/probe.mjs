/**
 * 探活脚本：验证 MCP 客户端能否跑通握手与工具调用
 * 用法：MCD_MCP_TOKEN=xxx node src/probe.mjs
 */
import { createClient, McdMcpClient } from './mcp-client.mjs';

const client = await createClient();
console.log('[ok] 握手成功，sessionId =', client.sessionId ? '已建立' : '无');

async function probe(name, args, label) {
  const started = Date.now();
  try {
    const raw = await client.callTool(name, args);
    const data = McdMcpClient.unwrap(raw);
    const size = typeof data === 'string' ? data.length : JSON.stringify(data ?? null).length;
    console.log(`[ok] ${label.padEnd(18)} ${String(size).padStart(7)} 字节  ${Date.now() - started}ms`);
    return data;
  } catch (err) {
    console.log(`[!!] ${label.padEnd(18)} ${err.message}`);
    return null;
  }
}

const now = await probe('now-time-info', {}, 'now-time-info');
const nutrition = await probe('list-nutrition-foods', {}, '营养表');
const addresses = await probe('delivery-query-addresses', {}, '配送地址');

console.log('\n--- 抽样 ---');
if (now) console.log('服务端时间:', JSON.stringify(now).slice(0, 160));
if (addresses?.addresses?.length) {
  console.log('地址数量:', addresses.addresses.length);
  console.log('首个地址ID:', addresses.addresses[0].addressId);
}
if (nutrition && typeof nutrition === 'string') {
  const head = nutrition.split('\n').slice(0, 3).join(' | ');
  console.log('营养表头部:', head.slice(0, 200));
}
