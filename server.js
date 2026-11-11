import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
export function createApp(dbPath = path.join(root, 'data/lunch.sqlite')) {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users (token TEXT PRIMARY KEY, id TEXT UNIQUE, name TEXT, avatar TEXT);
    CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, location TEXT);
    CREATE TABLE IF NOT EXISTS places (room TEXT, id TEXT, data TEXT, PRIMARY KEY(room,id));
    CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, room TEXT, user TEXT, place TEXT, date TEXT, data TEXT, UNIQUE(room,user,place,date));
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT, user TEXT, text TEXT, time TEXT);
    CREATE TABLE IF NOT EXISTS picks (room TEXT PRIMARY KEY, data TEXT);
  `);
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!userColumns.includes('avatar')) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
  db.exec("UPDATE users SET avatar = lower(hex(randomblob(4))) WHERE avatar IS NULL OR avatar = ''");
  const clients = new Map();
  const notify = room => { for (const res of clients.get(room) || []) res.write('data: update\n\n'); };
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
  const str = (value, max = 200) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : fail('输入内容为空或过长');
  const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fail('数字超出允许范围');
  const money = value => { const amount = number(value, 0, 1000000); if (!Number.isInteger(amount)) fail('韩币金额必须为整数'); return amount; };
  const avatarSeed = value => typeof value === 'string' && /^[a-z0-9]{6,24}$/.test(value) ? value : fail('头像参数无效');
  const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  async function body(req) {
    let chunks = [], size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 3_000_000) fail('照片过大，请选择较小的图片', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { fail('请求格式错误'); }
  }
  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'same-origin');
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/config') return json(res, { kakaoKey: process.env.KAKAO_JS_KEY || '' });
      if (!url.pathname.startsWith('/api/')) {
        const files = { '/': 'index.html', '/food_code.html': 'index.html', '/app.js': 'app.js', '/avatar.js': 'avatar.js', '/filters.js': 'filters.js', '/space.js': 'space.js', '/style.css': 'style.css' };
        const file = files[url.pathname]; if (!file) return json(res, { error: '页面不存在' }, 404);
        res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
        return res.end(readFileSync(path.join(root, 'public', file)));
      }
      const room = url.searchParams.get('room');
      if (!room || !/^[a-zA-Z0-9_-]{8,80}$/.test(room)) fail('无效的团队链接');
      let token = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('lunch_session='))?.slice(14);
      let user = token && db.prepare('SELECT id,name,avatar FROM users WHERE token=?').get(token);
      if (!user) {
        token = randomBytes(32).toString('hex');
        user = { id: randomUUID(), name: `饭友 ${randomBytes(2).toString('hex').toUpperCase()}`, avatar: randomBytes(4).toString('hex') };
        db.prepare('INSERT INTO users(token,id,name,avatar) VALUES (?,?,?,?)').run(token, user.id, user.name, user.avatar);
        res.setHeader('Set-Cookie', `lunch_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
      }
      db.prepare('INSERT OR IGNORE INTO rooms VALUES (?,NULL)').run(room);
      if (req.method === 'GET' && url.pathname === '/api/search') {
        if (!process.env.KAKAO_REST_KEY) fail('请在服务器 .env 配置 KAKAO_REST_KEY', 503);
        const kind = url.searchParams.get('kind');
        const endpoints = { address: 'address', keyword: 'keyword', nearby: 'category' };
        if (!endpoints[kind]) fail('搜索类型无效');
        const params = new URLSearchParams();
        if (kind === 'nearby') {
          params.set('category_group_code', 'FD6');
          params.set('x', number(Number(url.searchParams.get('lng')), -180, 180));
          params.set('y', number(Number(url.searchParams.get('lat')), -90, 90));
          params.set('radius', number(Number(url.searchParams.get('radius')), 100, 2000));
          params.set('sort', 'distance'); params.set('size', '15');
          const page = number(Number(url.searchParams.get('page') || 1), 1, 3);
          if (!Number.isInteger(page)) fail('页码无效');
          params.set('page', page);
        } else {
          params.set('query', str(url.searchParams.get('query')));
          if (kind === 'keyword' && url.searchParams.has('lat') && url.searchParams.has('lng')) {
            params.set('x', number(Number(url.searchParams.get('lng')), -180, 180));
            params.set('y', number(Number(url.searchParams.get('lat')), -90, 90));
            params.set('radius', number(Number(url.searchParams.get('radius')), 100, 2000));
            params.set('sort', 'distance'); params.set('category_group_code', 'FD6');
          }
        }
        const upstream = await fetch(`https://dapi.kakao.com/v2/local/search/${endpoints[kind]}.json?${params}`, {
          headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_KEY}` }, signal: AbortSignal.timeout(10000)
        });
        if (!upstream.ok) fail(upstream.status === 401 || upstream.status === 403 ? 'Kakao 授权失败，请检查 REST Key 和 Local API 权限' : 'Kakao 搜索暂时不可用，请稍后重试', 502);
        return json(res, await upstream.json());
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('data: connected\n\n');
        if (!clients.has(room)) clients.set(room, new Set());
        clients.get(room).add(res);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
        req.on('close', () => { clearInterval(heartbeat); clients.get(room)?.delete(res); });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const places = db.prepare('SELECT data FROM places WHERE room=?').all(room).map(p => JSON.parse(p.data));
        const reviews = db.prepare('SELECT r.data,u.name,u.avatar FROM reviews r JOIN users u ON r.user=u.id WHERE r.room=? ORDER BY r.date DESC,r.rowid DESC').all(room).map(r => ({ ...JSON.parse(r.data), name: r.name, avatar: r.avatar }));
        const messages = db.prepare('SELECT m.id,m.user,m.text,m.time,u.name,u.avatar FROM messages m JOIN users u ON m.user=u.id WHERE room=? ORDER BY m.id DESC LIMIT 100').all(room).reverse();
        const location = db.prepare('SELECT location FROM rooms WHERE id=?').get(room).location;
        const pick = db.prepare('SELECT data FROM picks WHERE room=?').get(room);
        return json(res, { user, places, reviews, messages, location: location ? JSON.parse(location) : null, pick: pick ? JSON.parse(pick.data) : null });
      }
      if (req.method !== 'POST') fail('接口不存在', 404);
      // Cookie-based writes must originate from this site.
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) fail('请求来源不匹配', 403);
      const b = await body(req);
      if (!b || typeof b !== 'object' || Array.isArray(b)) fail('请求内容必须是对象');
      switch (url.pathname) {
        case '/api/profile': {
          const name = b.name === undefined ? user.name : str(b.name, 30);
          const avatar = b.avatar === undefined ? user.avatar : avatarSeed(b.avatar);
          db.prepare('UPDATE users SET name=?,avatar=? WHERE id=?').run(name, avatar, user.id); break;
        }
        case '/api/location': {
          const location = { lat: number(b.lat, -90, 90), lng: number(b.lng, -180, 180), label: str(b.label) };
          db.prepare('UPDATE rooms SET location=? WHERE id=?').run(JSON.stringify(location), room); break;
        }
        case '/api/place': {
          const p = { id: str(b.id, 100), name: str(b.name, 100), category: str(b.category || '其他', 150), address: str(b.address), lat: number(b.lat, -90, 90), lng: number(b.lng, -180, 180), price: b.price === null ? null : money(b.price), diet: b.diet };
          if (!['unknown', 'meat', 'veg', 'mixed'].includes(p.diet)) fail('请选择有效饮食类型');
          const existing = db.prepare('SELECT data FROM places WHERE room=? AND id=?').get(room, p.id);
          // Kakao search refreshes cannot overwrite colleagues’ confirmed metadata.
          if (b.discovery && existing) break;
          db.prepare('INSERT OR REPLACE INTO places VALUES (?,?,?)').run(room, p.id, JSON.stringify(p)); break;
        }
        case '/api/pick': {
          const p = db.prepare('SELECT data FROM places WHERE room=? AND id=?').get(room, str(b.id,100));
          if (!p) fail('餐厅不存在');
          db.prepare('INSERT OR REPLACE INTO picks VALUES (?,?)').run(room, JSON.stringify({ ...JSON.parse(p.data), time: new Date().toISOString(), by: user.name })); break;
        }
        case '/api/review': {
          const place = str(b.place,100);
          if (!db.prepare('SELECT 1 FROM places WHERE room=? AND id=?').get(room,place)) fail('请先选择餐厅');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !Number.isFinite(Date.parse(b.date)) || new Date(b.date).toISOString().slice(0,10) !== b.date || b.date > new Date(Date.now()+9*3600000).toISOString().slice(0,10)) fail('请选择有效的用餐日期，不能晚于今天');
          const rating = number(b.rating,1,5); if (!Number.isInteger(rating)) fail('评分必须是整数');
          const photo = b.photo || '';
          if (photo && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(photo) || photo.length > 2_800_000)) fail('请上传 JPG、PNG 或 WebP 图片（不超过 2MB）');
          const review = { id: randomUUID(), user: user.id, place, date: b.date, rating, price: money(b.price), note: typeof b.note === 'string' && b.note.length <= 500 ? b.note.trim() : fail('评价最多500字'), photo };
          db.prepare('INSERT INTO reviews VALUES (?,?,?,?,?,?) ON CONFLICT(room,user,place,date) DO UPDATE SET data=excluded.data').run(review.id,room,user.id,place,b.date,JSON.stringify(review)); break;
        }
        case '/api/message': db.prepare('INSERT INTO messages(room,user,text,time) VALUES (?,?,?,?)').run(room,user.id,str(b.text,500),new Date().toISOString()); break;
        default: fail('接口不存在',404);
      }
      json(res,{ok:true}); notify(room);
    } catch (e) { if (!res.headersSent) json(res,{error:e.status ? e.message : '服务暂时不可用'},e.status || 500); else res.end(); }
  });
  server.on('close', () => { for (const group of clients.values()) for (const res of group) res.end(); db.close(); });
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port,process.env.HOST || '0.0.0.0',() => console.log(`一起吃饭 → http://localhost:${port}`));
}
