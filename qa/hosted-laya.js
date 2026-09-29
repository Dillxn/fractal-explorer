/* Dependency-free client for the public Laya Gradio endpoint.
   No model weights, account tokens, paid endpoint, retries, or scripted fallback. */
const LayaHosted = (() => {
 const ORIGIN='https://convaiinnovations-laya-demo.hf.space';
 const CALL=ORIGIN+'/gradio_api/call';
 class ApiError extends Error {constructor(message,code='API_ERROR'){super(message);this.name='LayaApiError';this.code=code;}}
 function failure(text,status){
  const message=String(text??'').slice(0,600);
  if(status===429||/quota|rate.?limit|exceeded.*limit|too many requests/i.test(message))return new ApiError('Free Laya service quota/rate limit reached. Experiment paused; no paid fallback. '+message,'FREE_LIMIT');
  return new ApiError('Hosted Laya '+(status?'HTTP '+status+': ':'error: ')+message);
 }
 function parseFrame(frame){
  let event='message',data=[];
  for(const line of frame.split(/\r?\n/)){if(line.startsWith('event:'))event=line.slice(6).trim();if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));}
  return {event,data:data.join('\n')};
 }
 async function completion(response,{signal,onStage=()=>{}}={}){
  if(!response.ok)throw failure(await response.text(),response.status);
  if(!response.body)throw new ApiError('No streaming response from hosted Laya.');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',received=0;
  try{
   for(;;){
    signal?.throwIfAborted();const {value,done}=await reader.read();
    if(value){received+=value.byteLength;if(received>2*1024*1024)throw new ApiError('Hosted response exceeds the safety size bound.');buffer+=decoder.decode(value,{stream:true});}
    if(done)buffer+=decoder.decode();
    const frames=buffer.split(/\r?\n\r?\n/);buffer=frames.pop();if(done&&buffer){frames.push(buffer);buffer='';}
    for(const frame of frames){const m=parseFrame(frame);if(!m.data)continue;
     if(m.event==='error')throw failure(m.data);
     if(m.event==='complete'){try{return JSON.parse(m.data);}catch{throw new ApiError('Invalid JSON in the hosted completion.');}}
     if(m.event==='heartbeat'||m.event==='generating')onStage('Waiting for the hosted service / queue…');
    }
    if(done)throw new ApiError('Hosted response ended without a completed prediction. No action applied.');
   }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
 function decode(data,questions){
  if(!Array.isArray(data)||data.length<2)throw new ApiError('Hosted response has an unexpected output shape.');
  let raw=data[1];if(raw&&typeof raw==='object'&&raw.__type__==='update')raw=raw.value;
  if(typeof raw==='string'){try{raw=JSON.parse(raw);}catch{throw failure(raw);}}
  if(!raw||typeof raw!=='object'||raw.error)throw failure(raw?.error??'Missing raw model response.');
  if(!raw.answers||!raw.model)throw new ApiError('Hosted service did not return a model identity and answers.');
  const expected=Object.keys(questions);
  for(const id of expected){
   const q=questions[id],a=raw.answers[id];
   if(q.type!=='choice'||!a||a.type!=='choice')throw new ApiError('Expected a typed choice for '+id);
   const keys=Object.keys(q.criteria),prob=a.probabilities;
   if(!keys.includes(a.choice)||!prob||Object.keys(prob).length!==keys.length||!keys.every(k=>Object.hasOwn(prob,k)))throw new ApiError('Hosted answer does not match this mutation menu.');
   const values=keys.map(k=>prob[k]);
   if(values.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)||Math.abs(values.reduce((a,b)=>a+b,0)-1)>.002)throw new ApiError('Hosted probabilities are invalid. No action applied.');
   if(prob[a.choice]+.0002<Math.max(...values))throw new ApiError('Hosted choice disagrees with its reported probabilities.');
  }
  return raw;
 }
 async function predict(state,questions,{signal,onStage=()=>{},timeoutMs=90000,fetchImpl=globalThis.fetch}={}){
  if(typeof state!=='string'||!state.length||state.length>20000)throw new ApiError('Invalid experiment state.');
  if(!questions||typeof questions!=='object'||!Object.keys(questions).length)throw new ApiError('Missing mutation questions.');
  signal?.throwIfAborted();const ctl=new AbortController();const abort=()=>ctl.abort(signal.reason??new DOMException('Paused','AbortError'));
  signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>ctl.abort(new ApiError('Hosted Laya timed out. Experiment paused with parameters preserved.','TIMEOUT')),timeoutMs);
  const start=performance.now();let eventId=null;
  try{
   onStage('Submitting the current measured state…');
   const payload={state_text:state,questions_text:JSON.stringify(questions)};
   const submit=await fetchImpl(CALL+'/v2/run_playground',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:ctl.signal});
   if(!submit.ok)throw failure(await submit.text(),submit.status);
   const ticket=await submit.json();eventId=ticket.event_id;
   if(typeof eventId!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(eventId))throw new ApiError('Hosted Laya returned an invalid request ticket.');
   ctl.signal.throwIfAborted();onStage('Laya is evaluating / waiting for its shared server…');
   const response=await fetchImpl(CALL+'/run_playground/'+encodeURIComponent(eventId),{credentials:'omit',referrerPolicy:'no-referrer',signal:ctl.signal});
   const data=await completion(response,{signal:ctl.signal,onStage});ctl.signal.throwIfAborted();
   const raw=decode(data,questions);
   return {...raw,hosted:{endpoint:ORIGIN,api:'/run_playground',eventId,roundTripMs:performance.now()-start,serverReportedMs:Number.isFinite(raw.latency_ms)?raw.latency_ms:null,serverHardware:'not reported / not assumed',credentials:'omit',modelDownloadBytes:0}};
  }catch(e){
   if(ctl.signal.aborted)throw ctl.signal.reason;
   if(e instanceof ApiError)throw e;
   throw new ApiError('Could not reach the free Laya API. Check the connection or browser restrictions; the experiment is preserved. '+String(e.message??e),'NETWORK');
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 return {ORIGIN,predict,decode,completion,parseFrame,ApiError};
})();
if(typeof module!=='undefined')module.exports=LayaHosted;
