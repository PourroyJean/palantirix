import {SaxesParser} from 'saxes';
export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_GAP = 30;
export type Sensor = 'hr'|'power'|'cadence';
export interface Point {time:number; segment:number; hr:number|null; power:number|null; cadence:number|null; cadenceSource:string|null; lat:number|null; lon:number|null; ele:number|null}
export interface Route {points:Point[]; distances:number[]; kind:'gpx'|'tcx'; invalid:number}
export class AnalysisError extends Error {}
const finite=(n:number)=>Number.isFinite(n)?n:null;
const number=(s:string|null|undefined, zero=true):number|null=>{if(s==null || !s.trim())return null; const n=Number(s.trim()); return Number.isFinite(n)&&n>=0&&(zero||n>0)?n:null};
const time=(s:string|null|undefined):number|null=>{if(!s?.trim())return null; const input=s.trim(); const normalized=/Z$|[+-]\d\d:\d\d$/.test(input)?input:input+'Z'; const match=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(Z|[+-]\d\d:\d\d)$/.exec(normalized);if(!match)return null;
  const [,year,month,day,hour,minute,second,zone]=match;const yyyy=Number(year),mm=Number(month),dd=Number(day),hh=Number(hour),mi=Number(minute),ss=Number(second);
  const leap=yyyy%4===0&&(yyyy%100!==0||yyyy%400===0);const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(yyyy<1||mm<1||mm>12||dd<1||dd>days[mm-1]||hh>23||mi>59||ss>59)return null;
  if(zone!=='Z'&&(Number(zone.slice(1,3))>23||Number(zone.slice(4))>59))return null;
  const v=Date.parse(normalized);return Number.isFinite(v)?v:null};
const ms=(a:Point,b:Point)=>(b.time-a.time)/1000;
const iso=(t:number)=>new Date(t).toISOString().replace('.000Z','+00:00').replace('Z','+00:00');
export async function parseFile(file:File,progress?:(ratio:number)=>void):Promise<Route>{
  if(!file.size || file.size>MAX_BYTES)throw new AnalysisError('Le fichier est vide ou dépasse la limite de 50 Mio.');
  const points:Point[]=[];const stack:string[]=[];let segment=0,activities=0,invalid=0,kind:'gpx'|'tcx'|null=null;
  // Only the current point retains leaf values. Keeping descendant data on
  // enclosing tracks would make a long GPX grow far beyond its file size.
  const frames:{text:string}[]=[];
  let pointDepth=-1, attrs:Record<string,string>={}, data:Record<string,string>={};
  const parser=new SaxesParser({xmlns:true});
  parser.on('doctype',()=>{throw new AnalysisError('Les fichiers XML contenant une DTD ou des entités sont refusés.')});
  parser.on('error',()=>{throw new AnalysisError("XML invalide : vérifiez que l'export est complet.")});
  parser.on('opentag',tag=>{const label=tag.local;stack.push(label);frames.push({text:''});
    if(!kind){kind=label==='gpx'?'gpx':label==='TrainingCenterDatabase'?'tcx':null;if(!kind)throw new AnalysisError('Format non reconnu : un fichier GPX ou TCX est attendu.')}
    if(kind==='tcx'&&label==='Activity'&&stack.includes('Activities')){activities++;if(activities>1)throw new AnalysisError('Ce TCX contient plusieurs activités : exportez-en une seule.');}
    if((kind==='gpx'&&label==='trkseg')||(kind==='tcx'&&label==='Track'))segment++;
    if(pointDepth<0&&((kind==='gpx'&&label==='trkpt'&&stack.includes('trk'))||(kind==='tcx'&&label==='Trackpoint'&&stack.includes('Activity')))){
      pointDepth=stack.length;data={};attrs=Object.fromEntries(Object.values(tag.attributes).map(a=>[a.local,a.value]));
    }
  });
  const addText=(t:string)=>{if(pointDepth>=0&&frames.length>pointDepth){const leaf=frames[frames.length-1];
    if(leaf.text.length+t.length>4096)throw new AnalysisError('Champ XML anormalement long dans un point de trace.');leaf.text+=t}};parser.on('text',addText);parser.on('cdata',addText);
  parser.on('closetag',()=>{const frame=frames.pop()!;const label=stack.pop()!;
    if(pointDepth>=0&&stack.length>=pointDepth){const value=frame.text.trim();
      if(value){
        if(kind==='gpx'){
          if((stack.length===pointDepth&&['time','ele'].includes(label))||['hr','cad','RunCadence','power','Watts'].includes(label))data[label]??=value;
        }else{
          if((stack.length===pointDepth&&['Time','Cadence','AltitudeMeters'].includes(label))||(label==='Value'&&stack.at(-1)==='HeartRateBpm')||['hr','RunCadence','power','Watts','LatitudeDegrees','LongitudeDegrees'].includes(label))data[label]??=value;
        }
      }
    }
    if(pointDepth>=0&&stack.length===pointDepth-1){pointDepth=-1;
      const d=data,stamp=time(d[kind==='gpx'?'time':'Time']);if(stamp===null){invalid++;return}
      const cadCandidates=kind==='gpx'?[['cad',d.cad],['RunCadence',d.RunCadence]]:[['Cadence',d.Cadence],['RunCadence',d.RunCadence]];
      let cadence:null|number=null,cadenceSource:null|string=null;for(const [key,raw] of cadCandidates){const n=number(raw);if(n!==null){cadence=n;cadenceSource=key;break}}
      points.push({time:stamp,segment,hr:number(d.hr??d.Value,false),power:number(d.power??d.Watts),cadence,cadenceSource,
        lat:coordinateNumber(kind==='gpx'?attrs.lat:d.LatitudeDegrees),lon:coordinateNumber(kind==='gpx'?attrs.lon:d.LongitudeDegrees),
        ele:d[kind==='gpx'?'ele':'AltitudeMeters']==null?null:finite(Number(d[kind==='gpx'?'ele':'AltitudeMeters']))});
    }
  });
  const reader=file.stream().getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let total=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_BYTES)throw new AnalysisError('Le fichier dépasse la limite de 50 Mio.');parser.write(decoder.decode(value,{stream:true}));progress?.(total/file.size)}parser.write(decoder.decode());parser.close()}
  catch(e){if(e instanceof AnalysisError)throw e;if(e instanceof RangeError)throw new AnalysisError('Mémoire insuffisante pour traiter ce fichier dans le navigateur.');throw new AnalysisError('XML invalide : vérifiez que l’export est complet.')}finally{reader.releaseLock()}
  if(kind==='tcx'&&activities!==1)throw new AnalysisError(activities>1?'Ce TCX contient plusieurs activités : exportez-en une seule.':'Ce TCX ne contient aucune activité exploitable.');
  if(!points.length)throw new AnalysisError("Aucun point de trace avec un timestamp valide n'a été trouvé.");points.sort((a,b)=>a.time-b.time);
  return {points,kind:kind!,invalid,distances:[]};
}
const coordinateNumber=(raw:string|undefined)=>raw?.trim()?finite(Number(raw)):null;
export function meters(a:[number,number],b:[number,number]):number{const rad=Math.PI/180,la1=a[0]*rad,la2=b[0]*rad, dlat=(b[0]-a[0])*rad,dlon=(b[1]-a[1])*rad;const h=Math.sin(dlat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dlon/2)**2;return 12742000*Math.asin(Math.min(1,Math.sqrt(h)))}
export function gpsRoute(route:Route):Route{if(route.kind!=='gpx')throw new AnalysisError('La comparaison accepte uniquement deux fichiers GPX.');const p=route.points;
  if(route.distances.length===p.length)return route;
  if(p.length<2||p.some(x=>x.lat===null||x.lon===null||x.lat < -90||x.lat>90||x.lon < -180||x.lon>180))throw new AnalysisError('Chaque GPX doit contenir au moins deux points GPS horodatés.');
  const d=[0];for(let i=1;i<p.length;i++)d.push(d[i-1]+(p[i].segment===p[i-1].segment?meters([p[i-1].lat!,p[i-1].lon!],[p[i].lat!,p[i].lon!]):0));return {...route,distances:d}
}
export function analyze(route:Route,sport:'velo'|'course',z2:number,z3:number,z4:number,z5:number,mode:'double'|'direct'){
  if(sport!=='velo'&&sport!=='course')throw new AnalysisError('Choisissez « vélo » ou « course ».');if(mode!=='double'&&mode!=='direct')throw new AnalysisError('Convention de cadence inconnue.');
  if(![z2,z3,z4,z5].every(Number.isInteger)||!(0<z2&&z2<z3&&z3<z4&&z4<z5&&z5<=300))throw new AnalysisError('Seuils incohérents : 0 < début Z2 < début Z3 < début Z4 < début Z5 ≤ 300 bpm.');
  const p=route.points,start=p[0].time,end=p[p.length-1].time,duration=(end-start)/1000,factor=sport==='course'&&mode==='double'?2:1;
  const totals={hr:0,power:0,cadence:0},coverage={...totals},zones={z1_s:0,z2_s:0,z3_s:0,z4_s:0,z5_s:0,unknown_s:0};let running=0,runningCoverage=0,zeroCadence=0;
  for(let i=0;i<p.length-1;i++){const a=p[i],b=p[i+1],delta=ms(a,b);if(a.segment!==b.segment||delta<=0||delta>MAX_GAP)continue;
    for(const k of ['hr','power','cadence'] as Sensor[]){const v=a[k];if(v===null)continue;if(k==='cadence'&&sport==='course'&&v===0){zeroCadence+=delta;continue}const val=k==='cadence'?v*factor:v;totals[k]+=val*delta;coverage[k]+=delta;if(k==='cadence'&&sport==='course'&&val>=130){running+=val*delta;runningCoverage+=delta}}
    if(a.hr!==null){const key=a.hr>=z5?'z5_s':a.hr>=z4?'z4_s':a.hr>=z3?'z3_s':a.hr>=z2?'z2_s':'z1_s';zones[key]+=delta}
  }zones.unknown_s=Math.max(0,duration-coverage.hr);
  const metrics=Object.fromEntries((['hr','power','cadence'] as Sensor[]).map(k=>{let count=0,maximum:number|null=null;for(const x of p){const v=x[k];if(v===null||(k==='cadence'&&sport==='course'&&v===0))continue;const val=k==='cadence'?v*factor:v;maximum=maximum===null?val:Math.max(maximum,val);count++}return [k,{average:coverage[k]?totals[k]/coverage[k]:null,maximum,covered_s:coverage[k],samples:count}]})) as Record<Sensor,{average:number|null;maximum:number|null;covered_s:number;samples:number}>;
  const sources=[...new Set(p.filter(x=>x.cadence!==null).map(x=>x.cadenceSource!))].sort(),warnings:string[]=[];
  if(route.invalid)warnings.push(route.invalid+' point(s) sans timestamp valide ignoré(s).');if(duration===0)warnings.push('Un seul instant horodaté : moyennes et temps de zone non calculables.');
  for(const [key,label] of [['hr','FC'],['power','puissance'],['cadence','cadence']] as [Sensor,string][])if(!metrics[key].samples)warnings.push('Aucune mesure de '+label+' disponible.');else if(!coverage[key]&&duration)warnings.push('Aucun intervalle exploitable pour la moyenne de '+label+'.');
  if(zones.unknown_s)warnings.push('Le temps sans couverture FC inclut les mesures absentes et les interruptions de plus de 30 s.');
  if(sport==='course'&&sources.length){warnings.push('Cadence course : '+(factor===2?'conversion supposée ×2 des cycles/min en pas/min':'valeurs supposées déjà en pas/min')+'; convention non inscrite dans ce GPX/TCX. Les zéros sont exclus des moyennes, mais peuvent représenter une pause ou un défaut de mesure.');if(runningCoverage)warnings.push('« Foulée ≥ 130 pas/min » est un repère de cadence, pas une détection certaine de la course ou de la marche.')}
  return {format:route.kind.toUpperCase(),sport,points:p.length,start:iso(start),end:iso(end),duration_s:duration,metrics,zones,thresholds:{z2_min:z2,z3_min:z3,z4_min:z4,z5_min:z5},cadence_unit:sport==='velo'?'tr/min':'pas/min (estimés)',cadence_mode:sport==='course'?mode:null,running_cadence:{average:runningCoverage?running/runningCoverage:null,covered_s:runningCoverage,threshold_spm:130},zero_cadence_s:zeroCadence,cadence_sources:sources,max_interval_s:MAX_GAP,warnings,chart:p.map(x=>({t:(x.time-start)/1000,segment:x.segment,hr:x.hr,power:x.power,cadence:x.cadence!==null&&(sport!=='course'||x.cadence>0)?x.cadence*factor:null}))};
}
