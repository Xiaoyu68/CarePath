// 私密统计面板：/api/stats?key=<STATS_KEY>
// 需要：① KV 命名空间绑定为 CAREPATH_KV；② 环境变量 STATS_KEY（查看口令）

const EVENTS = [
  ["visit", "打开网站(次)"], ["analyze_ai", "AI 解析"], ["analyze_local", "本地解析"],
  ["scan", "拍照识别"], ["trial_search", "试验检索"], ["trial_screen", "入排初筛"],
  ["trial_explain", "试验解读"], ["ngs", "标志物解读"], ["term", "查术语"],
  ["bilingual", "双语摘要"], ["tasks_ai", "AI 任务"], ["letter_print", "打印导出"],
  ["case_save", "保存"], ["case_export", "导出JSON"]
];
const DAYS = 14;

export async function onRequest({ request, env }) {
  if (!env.STATS_KEY) {
    return new Response("未配置：请在 EdgeOne 环境变量里设置 STATS_KEY（查看口令）。", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== env.STATS_KEY) {
    return new Response("口令错误", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (!env.CAREPATH_KV) {
    return new Response("未绑定 KV：请在控制台创建 KV 命名空间并以变量名 CAREPATH_KV 绑定到本项目，数据才会开始累计。", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const days = [];
  for (let i = 0; i < DAYS; i++) {
    days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  }

  const rows = [];
  for (const day of days) {
    const uv = parseInt(await env.CAREPATH_KV.get(`uv:${day}`), 10) || 0;
    const counts = [];
    for (const [key] of EVENTS) {
      counts.push(parseInt(await env.CAREPATH_KV.get(`evt:${day}:${key}`), 10) || 0);
    }
    if (uv || counts.some(c => c)) rows.push({ day, uv, counts });
  }

  const head = EVENTS.map(([, label]) => `<th>${label}</th>`).join("");
  const body = rows.map(r =>
    `<tr><td>${r.day}</td><td><b>${r.uv}</b></td>${r.counts.map(c => `<td>${c || ""}</td>`).join("")}</tr>`
  ).join("") || `<tr><td colspan="${EVENTS.length + 2}">最近 ${DAYS} 天暂无数据（KV 绑定后才开始累计）</td></tr>`;

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>愈径使用统计</title>
<style>body{font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif;padding:24px;color:#18212f}table{border-collapse:collapse;font-size:13px}th,td{border:1px solid #d9e0ea;padding:6px 10px;text-align:center}th{background:#f5f7fa;white-space:nowrap}td:first-child{white-space:nowrap}h1{font-size:18px}p{color:#647084;font-size:13px}</style></head>
<body><h1>愈径 CarePath · 最近 ${DAYS} 天使用统计</h1>
<p>独立访客按匿名随机编号去重；所有数据不含病历内容和身份信息。</p>
<table><tr><th>日期</th><th>独立访客</th>${head}</tr>${body}</table></body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
