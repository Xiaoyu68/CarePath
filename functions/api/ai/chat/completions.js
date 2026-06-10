// EdgeOne Pages 边缘函数：AI 请求转发代理
// 作用：让站点访客无需自带 API Key 即可使用 AI 解析，真实 Key 只存在
// EdgeOne 的环境变量里（控制台：项目 → 设置 → 环境变量）：
//   OPENROUTER_API_KEY  必填，OpenRouter 的 Key（或改 UPSTREAM 用其他 OpenAI 兼容服务商）
//   AI_MODEL            选填，文本模型，默认 deepseek/deepseek-chat
//   AI_VISION_MODEL     选填，识图模型（报告拍照转录用），默认 qwen/qwen3-vl-32b-instruct
// 注意：模型在服务端强制固定，访客无法改用昂贵模型刷爆账单；
// 建议同时在服务商后台给这个 Key 设置消费上限。

const UPSTREAM = "https://openrouter.ai/api/v1/chat/completions";
const MAX_TEXT_BYTES = 60000;
const MAX_VISION_BYTES = 3500000; // 拍照转录的 base64 图片较大

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type"
};

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: { message: "仅支持 POST" } }, 405);
  }
  if (!env.OPENROUTER_API_KEY) {
    return jsonResponse({ error: { message: "站点未配置 OPENROUTER_API_KEY 环境变量" } }, 503);
  }

  const raw = await request.text();
  if (raw.length > MAX_VISION_BYTES) {
    return jsonResponse({ error: { message: "请求体过大" } }, 413);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: { message: "请求体不是合法 JSON" } }, 400);
  }

  const isVision = body.vision === true;
  delete body.vision;
  if (!isVision && raw.length > MAX_TEXT_BYTES) {
    return jsonResponse({ error: { message: "请求体过大" } }, 413);
  }

  body.model = isVision
    ? (env.AI_VISION_MODEL || "qwen/qwen3-vl-32b-instruct")
    : (env.AI_MODEL || "deepseek/deepseek-chat");
  body.stream = false;

  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}
