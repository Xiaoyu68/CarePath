// 账号系统：注册 / 登录 / 登出 / 查询当前会话
// POST /api/account  body: { action: "register" | "login" | "logout" | "me", username, password }
// 依赖：KV 命名空间绑定为 CAREPATH_KV
//
// 存储约定：
//   user:<username>  -> JSON { salt, hash, created }   （密码用 PBKDF2 加盐哈希，绝不存明文）
//   sess:<token>     -> JSON { u: username, exp: 毫秒时间戳 }
// 会话用随机 token，通过 httpOnly Cookie(cp_session) 下发；服务端校验 token 与过期时间。

const SESSION_DAYS = 30;
const COOKIE_NAME = "cp_session";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function json(obj, status = 200, extraHeaders) {
  return new Response(JSON.stringify(obj), { status, headers: { ...JSON_HEADERS, ...(extraHeaders || {}) } });
}

function getKv(env) {
  if (typeof CAREPATH_KV !== "undefined") return CAREPATH_KV;
  return env && env.CAREPATH_KV ? env.CAREPATH_KV : null;
}

// ---- 工具：hex / 随机 / 哈希 ----
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function randomHex(n) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(n)));
}
async function derivePassword(password, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return bytesToHex(new Uint8Array(bits));
}
// 等长比较，降低时序泄露
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const m = raw.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
function sessionCookie(token, maxAgeSec) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  return parts.join("; ");
}

async function readSession(kv, request) {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;
  const raw = await kv.get(`sess:${token}`);
  if (!raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch { return null; }
  if (!s || !s.u || !s.exp || s.exp < Date.now()) return null;
  return { token, username: s.u };
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ error: "仅支持 POST" }, 405);
  const kv = getKv(env);
  if (!kv) return json({ error: "服务端未绑定存储（KV 命名空间 CAREPATH_KV 未绑定）" }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: "请求体不是合法 JSON" }, 400); }
  const action = body.action;

  // 查询当前会话
  if (action === "me") {
    const sess = await readSession(kv, request);
    return json({ user: sess ? sess.username : null });
  }

  // 登出
  if (action === "logout") {
    const sess = await readSession(kv, request);
    if (sess) { try { await kv.put(`sess:${sess.token}`, JSON.stringify({ u: sess.username, exp: 0 })); } catch {} }
    return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
  }

  // 注册 / 登录共用的输入校验
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!USERNAME_RE.test(username)) {
    return json({ error: "用户名需为 3-20 位字母、数字或下划线" }, 400);
  }
  if (password.length < 6 || password.length > 100) {
    return json({ error: "密码长度需为 6-100 位" }, 400);
  }

  const userKey = `user:${username}`;

  if (action === "register") {
    const existing = await kv.get(userKey);
    if (existing) return json({ error: "用户名已被注册，换一个或直接登录" }, 409);
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derivePassword(password, saltBytes);
    await kv.put(userKey, JSON.stringify({ salt: bytesToHex(saltBytes), hash, created: Date.now() }));
    const cookie = await startSession(kv, username);
    return json({ ok: true, user: username }, 200, { "Set-Cookie": cookie });
  }

  if (action === "login") {
    const raw = await kv.get(userKey);
    if (!raw) return json({ error: "用户名或密码不对" }, 401);
    let rec;
    try { rec = JSON.parse(raw); } catch { return json({ error: "账号数据异常，请联系站长" }, 500); }
    const hash = await derivePassword(password, hexToBytes(rec.salt));
    if (!safeEqual(hash, rec.hash)) return json({ error: "用户名或密码不对" }, 401);
    const cookie = await startSession(kv, username);
    return json({ ok: true, user: username }, 200, { "Set-Cookie": cookie });
  }

  return json({ error: "未知操作" }, 400);
}

async function startSession(kv, username) {
  const token = randomHex(32);
  const maxAgeSec = SESSION_DAYS * 86400;
  await kv.put(`sess:${token}`, JSON.stringify({ u: username, exp: Date.now() + maxAgeSec * 1000 }));
  return sessionCookie(token, maxAgeSec);
}
