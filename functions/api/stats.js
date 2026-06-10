// 私密统计面板：/api/stats?key=<STATS_KEY>
// 需要：① KV 命名空间绑定为 CAREPATH_KV；② 环境变量 STATS_KEY（查看口令）

const EVENTS = [
  ["visit", "打开网站(次)"], ["analyze_ai", "AI 解析"], ["analyze_local", "本地解析"],
  ["scan", "拍照识别"], ["trial_search", "试验检索"], ["trial_screen", "入排初筛"],
  ["trial_explain", "试验解读"], ["ngs", "标志物解读"], ["term", "查术语"],
  ["bilingual", "双语摘要"], ["tasks_ai", "AI 任务"], ["letter_print", "打印导出"],
  ["case_save", "保存"], ["case_export", "导出JSON"]
];
const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;

function plain(text, status) {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function getKv(env) {
  // EdgeOne 的 KV 绑定可能注入为全局变量，也可能挂在 env 上，两种都兼容
  if (typeof CAREPATH_KV !== "undefined") return CAREPATH_KV;
  return env && env.CAREPATH_KV ? env.CAREPATH_KV : null;
}

export async function onRequest({ request, env }) {
  const kv = getKv(env);
  const kvStatus = kv ? "已绑定 ✓" : "未绑定 ✗（控制台创建 KV 命名空间 → 以变量名 CAREPATH_KV 绑定本项目 → 重新部署）";
  if (!env.STATS_KEY) {
    return plain(`未配置 STATS_KEY 环境变量（设置后需重新部署）。\nKV 状态：${kvStatus}`, 503);
  }
  const url = new URL(request.url);
  const given = url.searchParams.get("key") || "";
  if (given !== env.STATS_KEY) {
    return plain(`口令错误。\n诊断：STATS_KEY 已配置（长度 ${env.STATS_KEY.length}，你输入的长度 ${given.length}）；KV 状态：${kvStatus}\n常见原因：① 口令值首尾有空格；② 口令里含 & # ? 空格等符号，会破坏网址（建议改成纯字母数字后重新部署）；③ 改过环境变量后没有重新部署。`, 403);
  }
  if (!kv) {
    return plain(`口令正确，但 KV 状态：${kvStatus}。绑定后数据才会开始累计。`, 503);
  }

  const daysWanted = Math.min(MAX_DAYS, Math.max(1, parseInt(url.searchParams.get("days"), 10) || DEFAULT_DAYS));
  const days = [];
  for (let i = 0; i < daysWanted; i++) {
    days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  }

  const rows = (await Promise.all(days.map(async day => {
    const [uvRaw, ...countRaws] = await Promise.all([
      kv.get(`uv:${day}`),
      ...EVENTS.map(([key]) => kv.get(`evt:${day}:${key}`))
    ]);
    const uv = parseInt(uvRaw, 10) || 0;
    const counts = countRaws.map(raw => parseInt(raw, 10) || 0);
    return (uv || counts.some(c => c)) ? { day, uv, counts } : null;
  }))).filter(Boolean);

  const head = EVENTS.map(([, label]) => `<th>${label}</th>`).join("");
  const body = rows.map(r =>
    `<tr><td>${r.day}</td><td><b>${r.uv}</b></td>${r.counts.map(c => `<td>${c || ""}</td>`).join("")}</tr>`
  ).join("") || `<tr><td colspan="${EVENTS.length + 2}">最近 ${daysWanted} 天暂无数据（KV 绑定后才开始累计）</td></tr>`;

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>愈径使用统计</title>
<style>body{font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif;padding:24px;color:#18212f}table{border-collapse:collapse;font-size:13px}th,td{border:1px solid #d9e0ea;padding:6px 10px;text-align:center}th{background:#f5f7fa;white-space:nowrap}td:first-child{white-space:nowrap}h1{font-size:18px}p{color:#647084;font-size:13px}</style></head>
<body><h1>愈径 CarePath · 最近 ${daysWanted} 天使用统计</h1>
<p>独立访客按匿名随机编号去重；所有数据不含病历内容和身份信息。数据按天永久保存，网址加 &amp;days=30 可调显示范围（最多 90 天）。</p>
<table><tr><th>日期</th><th>独立访客</th>${head}</tr>${body}</table></body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
