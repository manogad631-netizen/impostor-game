const http=require('http'),fs=require('fs'),path=require('path');
const {WebSocketServer}=require('ws');
const WORDS=JSON.parse(fs.readFileSync(path.join(__dirname,'words.json'),'utf8')); // להוספת מילים: עריכת words.json
const CATS=[...new Set(WORDS.map(w=>w[0]))];
const HTML=fs.readFileSync(path.join(__dirname,'public','index.html'));
const server=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});r.end(HTML)});
const wss=new WebSocketServer({server});
const rooms=new Map();
const rnd=n=>Math.floor(Math.random()*n);
const send=(ws,o)=>{if(ws&&ws.readyState===1)ws.send(JSON.stringify(o))};
function state(room,p){
  const s={type:'state',code:room.code,phase:room.phase,isHost:p.id===room.hostId,settings:room.settings,cats:CATS,
    players:[...room.players.values()].map(x=>({name:x.name,ready:x.ready,on:x.on,host:x.id===room.hostId}))};
  if(room.phase==='round')s.word=p.word;
  if(room.phase==='reveal')s.reveal=room.reveal;
  return s;
}
function broadcast(room){room.touched=Date.now();for(const p of room.players.values())send(p.ws,state(room,p))}
function newCode(){let c;do{c=String(1000+rnd(9000))}while(rooms.has(c));return c}
function startRound(room){
  const {difficulty,category,impostors}=room.settings;
  let pool=WORDS.map((w,i)=>[w,i]).filter(([w])=>(category==='הכל'||w[0]===category)&&(difficulty==='הכל'||w[1]===difficulty));
  let fresh=pool.filter(([,i])=>!room.used.has(i));
  if(!fresh.length){pool.forEach(([,i])=>room.used.delete(i));fresh=pool}
  if(!fresh.length)return false;
  const [w,i]=fresh[rnd(fresh.length)];room.used.add(i);
  const [a,b]=Math.random()<.5?[w[2],w[3]]:[w[3],w[2]];
  const ps=[...room.players.values()].filter(p=>p.on);
  const k=Math.min(impostors,Math.max(1,Math.floor((ps.length-1)/2)));
  const imp=new Set();while(imp.size<k)imp.add(ps[rnd(ps.length)].id);
  for(const p of room.players.values()){p.ready=false;p.isImp=imp.has(p.id);p.word=p.isImp?b:a}
  room.reveal=null;room.phase='round';room.truth={a,b};
  return true;
}
wss.on('connection',ws=>{
  let room=null,me=null;
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw)}catch{return}
    const name=String(m.name||'').trim().slice(0,12);
    if(m.type==='create'||m.type==='join'){
      if(!name||!m.pid)return send(ws,{type:'err',msg:'צריך כינוי'});
      let r;
      if(m.type==='create'){r={code:newCode(),hostId:m.pid,players:new Map(),phase:'lobby',settings:{difficulty:'הכל',category:'הכל',impostors:1},used:new Set(),touched:Date.now()};rooms.set(r.code,r)}
      else{r=rooms.get(String(m.code||'').trim());if(!r)return send(ws,{type:'err',msg:'החדר לא נמצא או שנסגר',fatal:1})}
      let p=r.players.get(m.pid);
      if(!p){
        if(r.phase!=='lobby')return send(ws,{type:'err',msg:'הסיבוב כבר התחיל. אפשר להצטרף בסיבוב הבא',fatal:1});
        if([...r.players.values()].some(x=>x.name===name))return send(ws,{type:'err',msg:'הכינוי תפוס בחדר',fatal:1});
        if(r.players.size>=20)return send(ws,{type:'err',msg:'החדר מלא',fatal:1});
        p={id:m.pid,name,ready:false,on:true,word:null,isImp:false};r.players.set(m.pid,p);
      }
      p.ws=ws;p.on=true;room=r;me=p;
      return broadcast(r);
    }
    if(!room||!me)return;
    const host=me.id===room.hostId;
    if(m.type==='settings'&&host&&room.phase==='lobby'){
      const s=room.settings;
      if(m.difficulty)s.difficulty=['הכל','easy','medium','hard'].includes(m.difficulty)?m.difficulty:'הכל';
      if(m.category)s.category=CATS.includes(m.category)?m.category:'הכל';
      if(m.impostors)s.impostors=Math.max(1,Math.min(3,+m.impostors|0));
    }else if(m.type==='start'&&host&&room.phase==='lobby'){ // מניעת התחלה כפולה: רק מהלובי
      if([...room.players.values()].filter(p=>p.on).length<3)return send(ws,{type:'err',msg:'צריך לפחות 3 שחקנים'});
      if(!startRound(room))return send(ws,{type:'err',msg:'אין מילים לבחירה הזו'});
    }else if(m.type==='ready'&&room.phase==='round')me.ready=true;
    else if(m.type==='reveal'&&host&&room.phase==='round'){
      room.phase='reveal';
      room.reveal={a:room.truth.a,b:room.truth.b,impostors:[...room.players.values()].filter(p=>p.isImp).map(p=>p.name)};
    }else if(m.type==='again'&&host&&room.phase==='reveal'){room.phase='lobby';room.reveal=null;for(const p of room.players.values())p.word=null}
    broadcast(room);
  });
  ws.on('close',()=>{if(me&&me.ws===ws){me.on=false;broadcast(room)}});
});
setInterval(()=>{for(const [c,r] of rooms)if(Date.now()-r.touched>2*3600e3)rooms.delete(c)},600e3); // ניקוי חדרים ישנים
server.listen(process.env.PORT||3000,()=>console.log('http://localhost:'+(process.env.PORT||3000)));
