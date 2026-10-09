/**
 * 极简 MCP Streamable HTTP 客户端
 *
 * 只做三件事：initialize 握手 -> 发 initialized 通知 -> tools/call。
 * 不依赖任何第三方包，Node 18+ 原生 fetch 即可运行。
 *
 * 安全约定：Token 只从环境变量读取，任何情况下都不会被写入输出文件。
 */

const DEFAULT_ENDPOINT = 'https://mcp.mcd.cn';

export class McdMcpError extends Error {
  constructor(message, { code, traceId } = {}) {
    super(message);
    this.name = 'McdMcpError';
    this.code = code;
    this.traceId = traceId;
  }
}

/** 把 SSE 文本流里的 jsonrpc 报文挑出来 */
function parsePayload(text, contentType) {
  const raw = (text || '').trim();
  if (!raw) return null;

  if (contentType && contentType.includes('text/event-stream')) {
    for (const chunk of raw.split(/\r?\n\r?\n/)) {
      const block = chunk.trim();
      if (!block) continue;
      const dataLines = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);
      if (!dataLines.length) continue;
      const candidate = safeJson(dataLines.join('\n'));
      if (candidate) return candidate;
    }
    return null;
  }

  return safeJson(raw);
}

function safeJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

export class McdMcpClient {
  constructor({ endpoint = DEFAULT_ENDPOINT, token } = {}) {
    if (!token) {
      throw new McdMcpError(
        '缺少 MCP Token。请先设置环境变量 MCD_MCP_TOKEN（参考 .env.example），不要把 Token 写进源码。'
      );
    }
    this.endpoint = endpoint;
    this.token = token;
    this.sessionId = null;
    this.requestId = 0;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    const res = await this.#rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'mcd-dex', version: '1.0.0' },
    });

    // initialize 之后必须补一条 initialized 通知，否则部分服务端会拒绝后续调用
    await this.#notify('notifications/initialized');
    this.initialized = true;
    return res;
  }

  async callTool(name, args = {}) {
    await this.init();
    const payload = await this.#rpc('tools/call', { name, arguments: args });
    if (payload && payload.isError) {
      throw new McdMcpError(`工具 ${name} 返回错误`, {});
    }
    return payload;
  }

  /** 解包 MCP 工具返回值：优先结构化 structuredContent，退回 text 内容 */
  static unwrap(payload) {
    if (!payload) return null;
    if (payload.structuredContent) return payload.structuredContent;
    const text = (payload.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    if (!text) return null;

    // 麦当劳部分工具返回体里嵌着 JSON，这里做一次尽力解析
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const parsed = safeJson(text.slice(start, end + 1));
      if (parsed) return parsed;
    }
    return text;
  }

  async #notify(method) {
    await this.#post({ jsonrpc: '2.0', method });
  }

  async #rpc(method, params) {
    const id = ++this.requestId;
    const res = await this.#post({ jsonrpc: '2.0', id, method, params });
    const body = parsePayload(res.text, res.contentType);
    if (!body) return method === 'initialize' ? { ok: true } : null;

    if (body.error) {
      throw new McdMcpError(body.error.message || `MCP 调用 ${method} 失败`, {
        code: body.error.code,
      });
    }
    return body.result ?? null;
  }

  async #post(body) {
    const headers = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const sessionId = res.headers.get('mcp-session-id');
    if (sessionId) this.sessionId = sessionId;

    const text = await res.text();
    const contentType = res.headers.get('content-type') || '';

    if (!res.ok) {
      if (res.status === 401) {
        throw new McdMcpError('MCP Token 无效或已过期（401），请重新申请 Token', { code: 401 });
      }
      if (res.status === 429) {
        throw new McdMcpError('触发限流（429），麦当劳限制 600 次/分钟，请降低请求频率', {
          code: 429,
        });
      }
      throw new McdMcpError(`HTTP ${res.status}: ${text.slice(0, 200)}`, { code: res.status });
    }

    return { text, contentType };
  }
}

export async function createClient({ endpoint, token } = {}) {
  const client = new McdMcpClient({
    endpoint: endpoint || process.env.MCD_MCP_ENDPOINT || DEFAULT_ENDPOINT,
    token: token || process.env.MCD_MCP_TOKEN,
  });
  await client.init();
  return client;
}
