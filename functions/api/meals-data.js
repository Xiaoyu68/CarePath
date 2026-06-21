// 用户菜单云端存取（需登录，凭 cp_session Cookie 鉴权）
//   GET  /api/meals-data        -> { plan, checks, ts } 或 { plan: null }
//   POST /api/meals-data  body: { plan, checks } -> { ok: true }
// 依赖：KV 命名空间绑定为 CAREPATH_KV
// 存储约定：meals:<username> -> JSON { plan, checks, ts }

const COOKIE_NAME = "cp_session";
const MAX_BODY = 200000; // 单份菜单足够大，防滥用
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}
function getKv(env) {
  if (typeof CAREPATH_KV !== "undefined") return CAREPATH_KV;
  return env && env.CAREPATH_KV ? env.CAREPATH_KV : null;
}
function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const m = raw.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
async function readSession(kv, request) {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;
  const raw = await kv.get(`sess:${token}`);
  if (!raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch { return null; }
  if (!s || !s.u || !s.exp || s.exp < Date.now()) return null;
  return { username: s.u };
}

export async function onRequest({ request, env }) {
  const kv = getKv(env);
  if (!kv) return json({ error: "服务端未绑定存储" }, 503);

  const sess = await readSession(kv, request);
  if (!sess) return json({ error: "未登录" }, 401);
  const key = `meals:${sess.username}`;

  if (request.method === "GET") {
    const raw = await kv.get(key);
    if (!raw) return json({ plan: null });
    try { return json(JSON.parse(raw)); } catch { return json({ plan: null }); }
  }

  if (request.method === "POST") {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: "数据过大" }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "请求体不是合法 JSON" }, 400); }
    const plan = body.plan;
    if (!plan || !Array.isArray(plan.days) || !Array.isArray(plan.shopping)) {
      return json({ error: "菜单格式不完整" }, 400);
    }
    const record = { plan, checks: body.checks && typeof body.checks === "object" ? body.checks : {}, ts: Date.now() };
    await kv.put(key, JSON.stringify(record));
    return json({ ok: true, ts: record.ts });
  }

  return json({ error: "不支持的方法" }, 405);
}
