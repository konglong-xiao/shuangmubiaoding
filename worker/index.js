const sessionName = "__Host-camera_lab";
const sessionAge = 12 * 60 * 60;
const attemptWindow = 5 * 60;
const maxAttempts = 10;
const encoder = new TextEncoder();
const commonHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function reply(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { ...commonHeaders, ...headers } });
}

function loginPage(message = "", status = 200, headers = {}) {
  return reply(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>登录 · 相机标定交互实验室</title>
  <style>
    *{box-sizing:border-box}
    body{min-height:100dvh;display:grid;place-items:center;margin:0;padding:20px;background:#0c161c;color:#edf5f3;font:16px/1.55 system-ui,sans-serif}
    main{width:min(100%,420px);background:#14232a;border:1px solid #2b4148;border-radius:14px;padding:clamp(20px,6vw,32px)}
    small{color:#83f3c4;letter-spacing:.1em}
    h1{font-size:clamp(21px,6vw,27px);margin:8px 0}
    p{margin:0 0 20px;color:#a9bfc2}
    label{display:block;margin-bottom:6px}
    input,button{display:block;width:100%;min-height:48px;border:1px solid #46635f;border-radius:8px;padding:8px 12px;font:inherit}
    input{background:#101e25;color:#edf5f3;color-scheme:dark}
    button{margin-top:14px;background:#83f3c4;color:#10231d;font-weight:700;cursor:pointer}
    input:focus-visible,button:focus-visible{outline:2px solid #83f3c4;outline-offset:3px}
    .message{margin-top:14px;color:#ffbaad}
  </style>
</head>
<body>
  <main>
    <small>CALIBRATION LAB</small>
    <h1>相机标定交互实验室</h1>
    <p>输入站点密码以继续。</p>
    <form method="post" action="/login">
      <label for="password">站点密码</label>
      <input id="password" name="password" type="password" inputmode="numeric" autocomplete="current-password" maxlength="64" required>
      <button type="submit">进入实验室</button>
      ${message ? `<div class="message" role="alert">${message}</div>` : ""}
    </form>
  </main>
</body>
</html>`, status, { "Content-Type": "text/html; charset=utf-8", ...headers });
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const asHex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
const fromHex = hex => Uint8Array.from(hex.match(/../g), byte => Number.parseInt(byte, 16));
const sign = (key, text) => crypto.subtle.sign("HMAC", key, encoder.encode(text));
const verify = (key, signature, text) => crypto.subtle.verify("HMAC", key, signature, encoder.encode(text));

function sessionKey(env) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`${env.LAB_SESSION_KEY}:${env.LAB_ACCESS_PASSWORD}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function cookie(value, age) {
  return `${sessionName}=${value}; Max-Age=${age}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

async function isAuthorized(request, env) {
  const session = request.headers.get("Cookie")?.match(/(?:^|;\s*)__Host-camera_lab=([^;]+)/)?.[1];
  const fields = session?.match(/^(\d{10})\.([a-f\d]{32})\.([a-f\d]{64})$/);
  if (!fields || Number(fields[1]) <= nowSeconds()) return false;
  const [, expiry, nonce, signature] = fields;
  return verify(await sessionKey(env), fromHex(signature), `session:${expiry}.${nonce}`);
}

async function reserveAttempt(request, db, key) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const clientKey = asHex(await sign(key, `client:${ip}`));
  const cutoff = nowSeconds() - attemptWindow;
  const timestamp = nowSeconds();
  // Reserve the attempt atomically across Worker instances.
  const result = await db.prepare(`
    INSERT INTO site_login_attempts (client_key, window_start, attempts)
    VALUES (?1, ?2, 1)
    ON CONFLICT (client_key) DO UPDATE SET
      window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END,
      attempts = CASE WHEN window_start <= ?3 THEN 1 ELSE attempts + 1 END
    WHERE window_start <= ?3 OR attempts < ?4
    RETURNING attempts
  `).bind(clientKey, timestamp, cutoff, maxAttempts).first();
  return { allowed: !!result, clientKey, cutoff };
}

async function readPassword(request) {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 1024) {
      await reader.cancel();
      return null;
    }
    body += decoder.decode(value, { stream: true });
  }
  const value = new URLSearchParams(body + decoder.decode()).get("password");
  return value && value.length <= 64 ? value : null;
}

async function login(request, env, ctx) {
  const password = await readPassword(request);
  if (!password) return loginPage("请输入站点密码。", 400);
  const key = await sessionKey(env);
  const { allowed, clientKey, cutoff } = await reserveAttempt(request, env.DB, key);
  if (!allowed) {
    return loginPage("尝试次数过多，请等几分钟后重试。", 429, { "Retry-After": String(attemptWindow) });
  }
  ctx.waitUntil(env.DB.prepare("DELETE FROM site_login_attempts WHERE window_start <= ?").bind(cutoff).run().catch(() => {}));
  if (!await verify(key, await sign(key, `password:${env.LAB_ACCESS_PASSWORD}`), `password:${password}`)) {
    return loginPage("站点密码不正确，请再试一次。", 401);
  }
  await env.DB.prepare("DELETE FROM site_login_attempts WHERE client_key = ?").bind(clientKey).run();
  const expiry = nowSeconds() + sessionAge;
  const nonce = asHex(crypto.getRandomValues(new Uint8Array(16)));
  const session = `${expiry}.${nonce}`;
  const signature = asHex(await sign(key, `session:${session}`));
  return reply(null, 303, { Location: "/", "Set-Cookie": cookie(`${session}.${signature}`, sessionAge) });
}

export default {
  async fetch(request, env, ctx) {
    if (!env.LAB_ACCESS_PASSWORD || !env.LAB_SESSION_KEY || !env.DB) {
      return reply("登录暂不可用，请稍后重试。", 503, { "Content-Type": "text/plain; charset=utf-8" });
    }
    const url = new URL(request.url);
    if (request.method === "POST" && ["/login", "/logout"].includes(url.pathname)) {
      if (request.headers.get("Origin") !== url.origin) return reply(null, 403);
      if (url.pathname === "/logout") return reply(null, 303, { Location: "/", "Set-Cookie": cookie("", 0) });
      return login(request, env, ctx);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return reply(null, 405, { Allow: "GET, HEAD" });
    const path = url.pathname === "/index.html" ? "/" : url.pathname;
    const asset = assets.get(path);
    if (!asset) return reply("Not found", 404, { "Content-Type": "text/plain; charset=utf-8" });
    if (!await isAuthorized(request, env)) {
      if (path !== "/") return reply(null, 401);
      return request.method === "HEAD" ? reply(null, 200, { "Content-Type": "text/html; charset=utf-8" }) : loginPage();
    }
    return reply(request.method === "HEAD" ? null : asset.body, 200, { "Content-Type": asset.type });
  },
};
