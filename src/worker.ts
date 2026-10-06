/// <reference lib="webworker" />
import {analyze,parseFile,gpsRoute,type Route} from './core.ts';
import {preview,compareRanges} from './comparison.ts';
const routes=new Map<string,Route>();
const importVersions=new Map<string,number>();
self.onmessage=async(event:MessageEvent)=>{const {id,kind,args}=event.data;try{let result:unknown;
 if(kind==='clear'){const {side}=args;importVersions.set(side,id);routes.delete(side);result=null}
 else if(kind==='load'){const {side,file}=args;importVersions.set(side,id);routes.delete(side);const parsed=await parseFile(file,ratio=>self.postMessage({id,progress:ratio}));const route=gpsRoute(parsed);result=preview(route);if(importVersions.get(side)===id)routes.set(side,route)}
 else if(kind==='analyze'){result=analyze(await parseFile(args.file,ratio=>self.postMessage({id,progress:ratio})),args.sport,args.z2,args.z3,args.z4,args.z5,args.mode)}
 else if(kind==='compare'){const a=routes.get('first'),b=routes.get('second');if(!a||!b)throw new Error('Deux activités GPX horodatées sont nécessaires.');result=compareRanges(a,b,args.firstStart,args.firstEnd,args.secondStart,args.secondEnd,args.cadenceFirst,args.cadenceSecond)}
 else throw new Error('Opération inconnue.');self.postMessage({id,result})
 }catch(error){self.postMessage({id,error:error instanceof RangeError?'Mémoire insuffisante pour traiter ce fichier dans le navigateur.':error instanceof Error?error.message:'Analyse impossible.'})}};
