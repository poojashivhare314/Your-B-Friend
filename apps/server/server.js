const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const db = new DatabaseSync(path.join(__dirname, 'books.db'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS sessions (device_uuid TEXT PRIMARY KEY, age_group TEXT, region TEXT, locality TEXT, interests TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS interactions (device_uuid TEXT NOT NULL, book_id TEXT NOT NULL, status TEXT NOT NULL, rating INTEGER, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(device_uuid, book_id));
CREATE TABLE IF NOT EXISTS regional_top_books (region TEXT NOT NULL, book_id TEXT NOT NULL, rank INTEGER NOT NULL, PRIMARY KEY(region,book_id));`);
const putBook = db.prepare('INSERT INTO books VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data');
const seed = JSON.parse(fs.readFileSync(path.join(__dirname,'seed.json'),'utf8'));
seed.forEach((b,i)=>{ putBook.run(b.id,JSON.stringify(b)); db.prepare('INSERT OR IGNORE INTO regional_top_books VALUES (?,?,?)').run(b.region,b.id,i); });
const cache = new Map();
const adaptations = require('./adaptationService')(db);
const formatCache = new Map();
async function relatedFormats(title, author) {
 const key = `${title}|${author}`.toLowerCase();
 if (formatCache.has(key) && Date.now()-formatCache.get(key).time < 3600000) return formatCache.get(key).data;
 const categories = [['podcast','podcast'],['movie','movie'],['series','tvShow']];
 const responses = await Promise.allSettled(categories.map(async ([,entity]) => {
  const u = new URL('https://itunes.apple.com/search');
  u.searchParams.set('term', title); u.searchParams.set('entity', entity); u.searchParams.set('limit','15');
  const r = await fetch(u, {signal:AbortSignal.timeout(8000)});
  if (!r.ok) throw Error('Provider unavailable');
  return r.json();
 }));
 const normalized = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const wanted = normalized(title);
 const data = {};
 categories.forEach(([kind], index) => {
  const response=responses[index];
  data[kind]={available:response.status==='fulfilled',items:response.status==='fulfilled' ? (response.value.results||[]).filter(item=>{
   const name=normalized(item.trackName || item.collectionName);
   return wanted.length>=3 && (name===wanted || name.includes(wanted));
  }).slice(0,4).map(item=>({title:item.trackName||item.collectionName,creator:item.artistName||'',url:item.trackViewUrl||item.collectionViewUrl,artwork:item.artworkUrl100||'',year:item.releaseDate?.slice(0,4)||''})).filter(item=>/^https:\/\//.test(item.url||'')) : []};
 });
 if (responses.some(r=>r.status==='fulfilled')) formatCache.set(key,{time:Date.now(),data});
 return data;
}
function book(row){ return row && JSON.parse(row.data); }
function cleanBook(b){ return {id:String(b.id||'').slice(0,200),title:String(b.title||'').slice(0,300),author:String(b.author||'Unknown author').slice(0,200),genres:Array.isArray(b.genres)?b.genres.slice(0,20).map(x=>String(x).slice(0,100)):[],isbn:String(b.isbn||'').slice(0,30),year:String(b.year||'').slice(0,4),cover:String(b.cover||'').slice(0,500),description:String(b.description||'').slice(0,3000),region:['Nepal','India','Global'].includes(b.region)?b.region:undefined}; }
async function search(q){
 const key=q.toLowerCase(); if(cache.has(key)&&Date.now()-cache.get(key).time<3600000)return cache.get(key).data;
 const urls=[`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=20&fields=key,title,author_name,cover_i,isbn,subject,first_publish_year`, `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=20`];
 const results=await Promise.allSettled(urls.map(async u=>{const r=await fetch(u,{signal:AbortSignal.timeout(8000),headers:{'User-Agent':'YourBFriend/1.0'}});if(!r.ok)throw Error('Book provider unavailable');return r.json()}));
 const ol=results[0].status==='fulfilled'?(results[0].value.docs||[]).map(x=>({id:'ol:'+x.key,title:x.title,author:(x.author_name||[]).join(', ')||'Unknown author',genres:(x.subject||[]).slice(0,6),isbn:(x.isbn||[])[0]||'',year:x.first_publish_year||'',cover:x.cover_i?`https://covers.openlibrary.org/b/id/${x.cover_i}-M.jpg`:''})):[];
 const gb=results[1].status==='fulfilled'?(results[1].value.items||[]).map(x=>({id:'gb:'+x.id,title:x.volumeInfo.title,author:(x.volumeInfo.authors||[]).join(', ')||'Unknown author',genres:x.volumeInfo.categories||[],isbn:(x.volumeInfo.industryIdentifiers||[])[0]?.identifier||'',cover:(x.volumeInfo.imageLinks?.thumbnail||'').replace('http:','https:'),description:x.volumeInfo.description||''})):[];
 const seen=new Set(); const data=[...ol,...gb].filter(b=>{const k=(b.title+'|'+b.author).toLowerCase();if(seen.has(k))return false;seen.add(k);return true}).slice(0,30); data.forEach(b=>putBook.run(b.id,JSON.stringify(b)));cache.set(key,{time:Date.now(),data}); return data;
}
function recommendations(id){
 const s=db.prepare('SELECT * FROM sessions WHERE device_uuid=?').get(id); const prefs=s?JSON.parse(s.interests):[];
 const mine=db.prepare('SELECT book_id,status FROM interactions WHERE device_uuid=?').all(id); const excluded=new Set(mine.filter(x=>x.status==='read').map(x=>x.book_id));
 const read=mine.filter(x=>x.status==='read').map(x=>book(db.prepare('SELECT data FROM books WHERE id=?').get(x.book_id))).filter(Boolean);
 const all=db.prepare('SELECT data FROM books').all().map(book).filter(b=>!excluded.has(b.id));
 const tokens=x=>String(x||'').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t=>t.length>2);
 const profile=[...prefs,...read.flatMap(b=>[...(b.genres||[]),b.author])].flatMap(tokens);
 const score=b=>{const words=[...(b.genres||[]),b.author].flatMap(tokens);return profile.reduce((n,t)=>n+(words.includes(t)?1:0),0)/Math.sqrt(Math.max(words.length,1));};
 const ranked=[...all].sort((a,b)=>score(b)-score(a));
 function popular(field,value){if(!value)return [];const rows=db.prepare(`SELECT i.book_id, COUNT(*) AS n FROM interactions i JOIN sessions s ON s.device_uuid=i.device_uuid WHERE s.${field}=? AND i.device_uuid<>? AND i.status IN ('read','reading') GROUP BY i.book_id ORDER BY n DESC`).all(value,id);return rows.map(r=>all.find(b=>b.id===r.book_id)).filter(Boolean)}
 const unique=arr=>[...new Map(arr.filter(Boolean).map(b=>[b.id,b])).values()].slice(0,12);
 const regional=region=>all.filter(b=>b.region===region);
 return {personal:ranked.slice(0,12),age:unique([...popular('age_group',s?.age_group),...regional('Global')]),local:unique([...popular('region',s?.region),...regional(s?.region||'Global')]),nepal:regional('Nepal'),india:regional('India'),global:regional('Global'),personalized:profile.length>0,ageHasActivity:popular('age_group',s?.age_group).length>0,localHasActivity:popular('region',s?.region).length>0};
}
const server=http.createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Content-Type','application/json; charset=utf-8');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}
 const url=new URL(req.url,'http://localhost');
 try{
  let body={};if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100000)throw Error('Request too large')}body=JSON.parse(raw||'{}')}
  let data;
  if(req.method==='GET'&&url.pathname==='/api/health')data={ok:true};
  else if(req.method==='POST'&&url.pathname==='/api/session/init'){
   const id=String(body.device_uuid||randomUUID()).slice(0,100);const region=['Nepal','India','Global'].includes(body.region)?body.region:'Global';const interests=Array.isArray(body.interests)?body.interests.slice(0,20).map(String):[];
   db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?) ON CONFLICT(device_uuid) DO UPDATE SET age_group=excluded.age_group,region=excluded.region,locality=excluded.locality,interests=excluded.interests').run(id,String(body.age_group||'').slice(0,30),region,String(body.locality||'').slice(0,100),JSON.stringify(interests));data={device_uuid:id};
  }else if(req.method==='POST'&&url.pathname==='/api/books/interact'){
   if(!body.device_uuid||!body.book?.id||!body.book?.title||!['read','reading','want_to_read','remove'].includes(body.status))throw Error('Invalid interaction');
   const b=cleanBook(body.book);if(body.status==='remove')db.prepare('DELETE FROM interactions WHERE device_uuid=? AND book_id=?').run(body.device_uuid,b.id);else{putBook.run(b.id,JSON.stringify(b));let rating=Number(body.rating);rating=Number.isInteger(rating)&&rating>=1&&rating<=5?rating:null;db.prepare('INSERT INTO interactions(device_uuid,book_id,status,rating) VALUES (?,?,?,?) ON CONFLICT(device_uuid,book_id) DO UPDATE SET status=excluded.status,rating=excluded.rating,updated_at=CURRENT_TIMESTAMP').run(body.device_uuid,b.id,body.status,rating)}data={ok:true};
  }else if(req.method==='GET'&&url.pathname==='/api/books/search'){const q=(url.searchParams.get('q')||'').trim().slice(0,200);data=q.length<2?[]:await search(q)}
  else if(req.method==='GET'&&url.pathname==='/api/books/formats'){const title=(url.searchParams.get('title')||'').trim().slice(0,200);const author=(url.searchParams.get('author')||'').trim().slice(0,200);if(!title)throw Error('A title is required');data=await relatedFormats(title,author)}
  else if(req.method==='GET'&&/^\/api\/books\/[^/]+\/adaptations$/.test(url.pathname)){const id=decodeURIComponent(url.pathname.split('/')[3]);const title=(url.searchParams.get('title')||'').trim().slice(0,200);const author=(url.searchParams.get('author')||'').trim().slice(0,200);const year=(url.searchParams.get('year')||'').slice(0,4);if(!title)throw Error('A title is required');data=await adaptations(id,title,author,year)}
  else if(req.method==='GET'&&url.pathname!=='/api/books/shelf'&&/^\/api\/books\/[^/]+$/.test(url.pathname)){data=book(db.prepare('SELECT data FROM books WHERE id=?').get(decodeURIComponent(url.pathname.split('/')[3])));if(!data){res.writeHead(404);return res.end(JSON.stringify({error:'Book not found'}))}}
  else if(req.method==='GET'&&url.pathname==='/api/books/shelf'){data=db.prepare('SELECT b.data,i.status,i.rating FROM interactions i JOIN books b ON b.id=i.book_id WHERE i.device_uuid=? ORDER BY i.updated_at DESC').all(url.searchParams.get('device_uuid')||'').map(x=>({...book(x),status:x.status,rating:x.rating}))}
  else if(req.method==='GET'&&url.pathname==='/api/recommendations')data=recommendations(url.searchParams.get('device_uuid')||'');
  else{res.writeHead(404);return res.end(JSON.stringify({error:'Not found'}))}res.end(JSON.stringify(data));
 }catch(e){res.writeHead(400);res.end(JSON.stringify({error:e.message}))}
});
server.listen(Number(process.env.PORT||3001),'0.0.0.0',()=>console.log('Your B Friend API listening on port '+(process.env.PORT||3001)));
