// 匿名功能使用计数：只记录"哪个功能被使用了一次"+ 一个随机访客编号（与身份无关）。
// 不含任何病历内容、IP、姓名等个人信息。
//
// 两种查看方式：
// 1. 函数日志：EdgeOne 控制台 → 项目 → 边缘函数 → 日志，搜 "carepath-event"
// 2. 统计面板（推荐）：在控制台创建 KV 命名空间并绑定到项目（变量名 CAREPATH_KV），
//    再加环境变量 STATS_KEY=你的查看口令，然后访问 /api/stats?key=口令

const ALLOWED_EVENTS = new Set([
  "visit", "analyze_local", "analyze_ai", "scan", "trial_search",
  "trial_screen", "trial_explain", "ngs", "term", "bilingual",
  "tasks_ai", "letter_print", "case_save", "case_export"
]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type"
};

async function kvIncrement(kv, key) {
  const current = parseInt(await kv.get(key), 10) || 0;
  await kv.put(key, String(current + 1));
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const url = new URL(request.url);
  const event = url.searchParams.get("e") || "";
  const vid = url.searchParams.get("v") || "";
  const day = new Date().toISOString().slice(0, 10);

  if (ALLOWED_EVENTS.has(event)) {
    console.log(JSON.stringify({ "carepath-event": event, day, v: vid.slice(0, 40) }));

    const kv = env.CAREPATH_KV;
    if (kv && /^[a-z0-9-]{8,40}$/i.test(vid)) {
      try {
        await kvIncrement(kv, `evt:${day}:${event}`);
        if (event === "visit") {
          const seenKey = `vid:${day}:${vid}`;
          if (!(await kv.get(seenKey))) {
            await kv.put(seenKey, "1");
            await kvIncrement(kv, `uv:${day}`);
          }
        }
      } catch (e) {
        console.log("kv-error: " + e.message);
      }
    }
  }
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
