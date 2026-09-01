const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const PORT = process.env.PORT || 3000;
const publicDir = __dirname;
const dbFile = path.join(__dirname, 'data.json');
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify({users:[]}, null, 2));
const loadDB=()=>JSON.parse(fs.readFileSync(dbFile,'utf8'));
const saveDB=db=>fs.writeFileSync(dbFile,JSON.stringify(db,null,2));
const sessions=new Map();
const adminTokens=new Set();
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD || 'change-me-now';
const hashPassword=(password,salt=crypto.randomBytes(16).toString('hex'))=>({salt,hash:crypto.scryptSync(password,salt,64).toString('hex')});
const verifyPassword=(password,salt,hash)=>crypto.timingSafeEqual(Buffer.from(hash,'hex'),crypto.scryptSync(password,salt,64));
const token=()=>crypto.randomBytes(32).toString('hex');
const cookieToken=req=>{const m=(req.headers.cookie||'').match(/novachat_session=([^;]+)/);return m&&m[1]};
const currentUser=req=>{const id=sessions.get(cookieToken(req)); if(!id)return null; const db=loadDB(); return db.users.find(u=>u.id===id)||null};
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e6)req.destroy()});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch(e){reject(e)}})})}
const json=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(JSON.stringify(data))};
const safeUser=u=>({id:u.id,username:u.username,createdAt:u.createdAt,blocked:!!u.blocked});
const adminAuth=req=>{const h=req.headers.authorization||'';return h.startsWith('Bearer ')&&adminTokens.has(h.slice(7))};
function saveReport(r){const db=loadDB();db.reports=db.reports||[];db.reports.push(r);saveDB(db)}
const server=http.createServer(async(req,res)=>{
  const url=req.url.split('?')[0];
  if(req.method==='POST' && ['/api/register','/api/login'].includes(url)){
    try{const b=await body(req);const username=String(b.username||'').trim();const password=String(b.password||'');if(!/^[a-zA-Z0-9_]{3,20}$/.test(username))return json(res,400,{error:'Username must be 3-20 letters, numbers or underscores.'});if(password.length<6)return json(res,400,{error:'Password must be at least 6 characters.'});let db=loadDB();
      if(url==='/api/register'){if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase()))return json(res,409,{error:'Username already exists.'});const hp=hashPassword(password);const u={id:crypto.randomUUID(),username,passwordHash:hp.hash,passwordSalt:hp.salt,createdAt:new Date().toISOString()};db.users.push(u);saveDB(db);const t=token();sessions.set(t,u.id);return json(res,201,{user:safeUser(u)},{'Set-Cookie':`novachat_session=${t}; HttpOnly; SameSite=Lax; Path=/`});}
      const u=db.users.find(x=>x.username.toLowerCase()===username.toLowerCase());if(!u||!verifyPassword(password,u.passwordSalt,u.passwordHash))return json(res,401,{error:'Invalid username or password.'});if(u.blocked)return json(res,403,{error:'This account is blocked.'});const t=token();sessions.set(t,u.id);return json(res,200,{user:safeUser(u)},{'Set-Cookie':`novachat_session=${t}; HttpOnly; SameSite=Lax; Path=/`});
    }catch{return json(res,400,{error:'Invalid request.'})}
  }
  if(req.method==='POST' && url==='/api/logout'){sessions.delete(cookieToken(req));return json(res,200,{ok:true},{'Set-Cookie':'novachat_session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/'});}
  if(req.method==='GET' && url==='/api/me'){const u=currentUser(req);return json(res,u?200:401,u?{user:safeUser(u)}:{error:'Not authenticated'});}
  if(req.method==='GET' && url==='/api/profile'){const u=currentUser(req);return json(res,u?200:401,u?{user:safeUser(u)}:{error:'Not authenticated'});}
  if(req.method==='POST' && url==='/api/admin/login'){try{const b=await body(req);if(String(b.password||'')!==ADMIN_PASSWORD)return json(res,401,{error:'Invalid admin password.'});const t=token();adminTokens.add(t);return json(res,200,{token:t})}catch{return json(res,400,{error:'Invalid request.'})}}
  if(url.startsWith('/api/admin/') && !adminAuth(req))return json(res,401,{error:'Admin authentication required.'});
  if(req.method==='GET' && url==='/api/admin/overview'){const db=loadDB();return json(res,200,{users:(db.users||[]).map(safeUser),reports:(db.reports||[]).slice().reverse()})}
  const rm=url.match(/^\/api\/admin\/reports\/([^/]+)$/);if(req.method==='PATCH'&&rm){const b=await body(req);const db=loadDB();const r=(db.reports||[]).find(x=>x.id===rm[1]);if(!r)return json(res,404,{error:'Report not found'});r.status=b.status==='resolved'?'resolved':'open';saveDB(db);return json(res,200,{ok:true})}
  const bm=url.match(/^\/api\/admin\/users\/([^/]+)\/(block|unblock)$/);if(req.method==='POST'&&bm){const db=loadDB();const u=db.users.find(x=>x.id===bm[1]);if(!u)return json(res,404,{error:'User not found'});u.blocked=bm[2]==='block';saveDB(db);return json(res,200,{ok:true})}
  let file=url==='/'?'/index.html':url; const full=path.join(publicDir,file);if(!full.startsWith(publicDir)||!fs.existsSync(full)||fs.statSync(full).isDirectory()){res.writeHead(404);return res.end('Not found')};const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};res.writeHead(200,{'Content-Type':types[path.extname(full)]||'application/octet-stream','Cache-Control':'no-cache'});fs.createReadStream(full).pipe(res);
});
const wss=new WebSocket.Server({server});const waiting=[];const peers=new Map();const names=new Map();const send=(ws,msg)=>ws.readyState===WebSocket.OPEN&&ws.send(JSON.stringify(msg));function removeWaiting(ws){const i=waiting.indexOf(ws);if(i>=0)waiting.splice(i,1)}function match(a,b){removeWaiting(a);removeWaiting(b);peers.set(a,b);peers.set(b,a);send(a,{type:'matched',role:'caller',partner:names.get(b)||'Guest'});send(b,{type:'matched',role:'callee',partner:names.get(a)||'Guest'})}function tryMatch(){while(waiting.length>1){const a=waiting.shift(),b=waiting.shift();if(a&&b&&a!==b&&a.readyState===WebSocket.OPEN&&b.readyState===WebSocket.OPEN)match(a,b)}}function queue(ws){removeWaiting(ws);if(!peers.has(ws)&&!waiting.includes(ws))waiting.push(ws);tryMatch()}
wss.on('connection',ws=>{ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}if(m.type==='find'){names.set(ws,String(m.username||'Guest').slice(0,20));queue(ws);return}if(m.type==='next'){const p=peers.get(ws);if(p){peers.delete(ws);peers.delete(p);send(p,{type:'hangup',reason:'next'});queue(p)};queue(ws);return}if(m.type==='report'){const reporter=names.get(ws)||'Guest';const p=peers.get(ws);const target=names.get(p)||'Guest';saveReport({id:crypto.randomUUID(),reporterUsername:reporter,targetUsername:target,reason:String(m.reason||'User report').slice(0,200),status:'open',createdAt:new Date().toISOString()});if(p)send(p,{type:'hangup',reason:'report'});return}if(m.type==='block'){const reporter=names.get(ws)||'Guest';const p=peers.get(ws);const target=names.get(p)||'Guest';const db=loadDB();const u=db.users.find(x=>x.username===target);if(u){u.blocked=true;saveDB(db)}if(p)send(p,{type:'hangup',reason:'blocked'});return}if(['offer','answer','ice','hangup','chat'].includes(m.type)){const p=peers.get(ws);if(p)send(p,m);if(m.type==='hangup'){peers.delete(ws);if(p)peers.delete(p)}}});ws.on('close',()=>{removeWaiting(ws);const p=peers.get(ws);peers.delete(ws);names.delete(ws);if(p){peers.delete(p);send(p,{type:'hangup',reason:'disconnect'})}})});
server.listen(PORT,()=>console.log(`NovaChat server running on http://localhost:${PORT}`));
