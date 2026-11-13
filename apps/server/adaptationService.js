const TTL = 7 * 24 * 60 * 60 * 1000;
const disclaimer = 'Media matches are automatically discovered by title and author. Titles can overlap and not every book has an official adaptation.';
const norm = s => String(s || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
function similarity(a,b) {
 a=norm(a); b=norm(b); if(!a||!b)return 0; if(a===b)return 1;
 const x=new Set(a.split(' ')), y=new Set(b.split(' ')); let overlap=0; for(const t of x)if(y.has(t))overlap++;
 const dice=2*overlap/(x.size+y.size);
 return b.length>=4 && (` ${a} `).includes(` ${b} `) ? Math.max(dice,0.6) : dice;
}
function classify(item, title, author, bookYear, allowAdaptation=true) {
 const score=similarity(item.title,title); if(score<0.6)return null;
 const metadata=norm([item.overview,item.credits].filter(Boolean).join(' '));
 const authorName=norm(author); const authorConfirmed=authorName && authorName!=='unknown author' && metadata.includes(authorName);
 const adaptationPhrase=/\b(based on the novel|based on the book|adapted from)\b/.test(metadata);
 const year=Number(item.year), published=Number(bookYear);
 if(allowAdaptation && norm(item.title)===norm(title) && (authorConfirmed||adaptationPhrase) && year && published && year>=published) return {...item,matchStatus:'verified_adaptation',matchReason:authorConfirmed?'Metadata mentions the author and release follows publication':'Metadata describes an adaptation and release follows publication'};
 return {...item,matchStatus:'possible_match',matchReason:year&&published&&year<published?'Release predates this book; the title may refer to another work':'Title overlap; the relationship to this book is not confirmed'};
}
async function json(url, headers={}) {const r=await fetch(url,{headers,signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Provider unavailable');return r.json()}
module.exports = function createAdaptationService(db) {
 db.exec('CREATE TABLE IF NOT EXISTS adaptation_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)');
 return async function adaptations(bookId,title,author,year) {
  const cacheKey=JSON.stringify([bookId,title,author,year,!!process.env.TMDB_API_KEY,!!process.env.YOUTUBE_API_KEY]);
  const cached=db.prepare('SELECT payload,updated_at FROM adaptation_cache WHERE cache_key=?').get(cacheKey);
  if(cached && Date.now()-cached.updated_at<TTL)return JSON.parse(cached.payload);
  const fallbackSearchLinks={youtube:'https://www.youtube.com/results?search_query='+encodeURIComponent(`${title} ${author} book summary audiobook trailer`),podcasts:'https://open.spotify.com/search/'+encodeURIComponent(`${title} ${author}`),moviesAndSeries:'https://www.justwatch.com/us/search?q='+encodeURIComponent(title)};
  async function tmdb(type){if(!process.env.TMDB_API_KEY)throw Error('API key not configured');const u=new URL('https://api.themoviedb.org/3/search/'+type);u.searchParams.set('api_key',process.env.TMDB_API_KEY);u.searchParams.set('query',title);const r=await json(u);return (r.results||[]).map(x=>({title:x.title||x.name,year:(x.release_date||x.first_air_date||'').slice(0,4),posterUrl:x.poster_path?'https://image.tmdb.org/t/p/w185'+x.poster_path:'',overview:x.overview||'',externalUrl:`https://www.themoviedb.org/${type}/${x.id}`}))}
  async function podcasts(){async function lookup(q){const u=new URL('https://itunes.apple.com/search');u.searchParams.set('media','podcast');u.searchParams.set('entity','podcastEpisode');u.searchParams.set('term',q);u.searchParams.set('limit','30');return json(u)}let r=await lookup(`${title} ${author}`);if(!r.results?.length)r=await lookup(title);return (r.results||[]).map(x=>({title:x.trackName||x.collectionName,year:(x.releaseDate||'').slice(0,4),posterUrl:x.artworkUrl100||'',overview:x.description||x.shortDescription||'',credits:x.artistName||'',externalUrl:x.trackViewUrl||x.collectionViewUrl}))}
  async function youtube(){if(!process.env.YOUTUBE_API_KEY)throw Error('API key not configured');const u=new URL('https://www.googleapis.com/youtube/v3/search');for(const [k,v] of Object.entries({part:'snippet',type:'video',maxResults:'20',q:`${title} ${author} book summary OR audiobook OR trailer`,key:process.env.YOUTUBE_API_KEY}))u.searchParams.set(k,v);const r=await json(u);return (r.items||[]).map(x=>({title:x.snippet.title,year:(x.snippet.publishedAt||'').slice(0,4),posterUrl:x.snippet.thumbnails?.medium?.url||'',overview:x.snippet.description||'',credits:x.snippet.channelTitle||'',externalUrl:'https://www.youtube.com/watch?v='+encodeURIComponent(x.id.videoId)}))}
  const calls=await Promise.allSettled([tmdb('movie'),tmdb('tv'),podcasts(),youtube()]);
  const keys=['movies','series','podcasts','youtube'];const media={},providerStatus={};
  keys.forEach((key,i)=>{providerStatus[key]=calls[i].status==='fulfilled'?'available':'unavailable';media[key]=calls[i].status==='fulfilled'?calls[i].value.map(x=>classify(x,title,author,year,i<2)).filter(Boolean).filter(x=>/^https:\/\//.test(x.externalUrl||'')).slice(0,6):[]});
  const result={bookId,disclaimer,media,providerStatus,fallbackSearchLinks};
  if(calls.every((x,i)=>x.status==='fulfilled'||((i===0||i===1)&&!process.env.TMDB_API_KEY)||(i===3&&!process.env.YOUTUBE_API_KEY)))db.prepare('INSERT OR REPLACE INTO adaptation_cache VALUES (?,?,?)').run(cacheKey,JSON.stringify(result),Date.now());
  return result;
 }
};
module.exports.classify=classify;
