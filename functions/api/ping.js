// 匿名功能使用计数：只记录"哪个功能被使用了一次"，不含任何病历内容或身份信息。
// 查看方式：EdgeOne 控制台 → 项目 → 边缘函数 → 日志，按 "carepath-event" 检索。
// 每条日志形如 {"carepath-event":"analyze_ai","day":"2026-06-09"}

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

export function onRequest({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const url = new URL(request.url);
  const event = url.searchParams.get("e") || "";
  if (ALLOWED_EVENTS.has(event)) {
    console.log(JSON.stringify({ "carepath-event": event, day: new Date().toISOString().slice(0, 10) }));
  }
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
