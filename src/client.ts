export class BrowserEngine {
 private worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
 private id=0;
 private pending=new Map<number,{resolve:(result:any)=>void;reject:(error:Error)=>void;progress?:(ratio:number)=>void}>();
 constructor(){this.worker.onmessage=({data})=>{const item=this.pending.get(data.id);if(!item)return;if(data.progress!==undefined){item.progress?.(data.progress);return}this.pending.delete(data.id);if(data.error)item.reject(new Error(data.error));else item.resolve(data.result)};this.worker.onerror=()=>{for(const request of this.pending.values())request.reject(new Error('Le traitement local a échoué.'));this.pending.clear()};this.worker.onmessageerror=()=>{for(const request of this.pending.values())request.reject(new Error('Mémoire insuffisante pour traiter ce fichier dans le navigateur.'));this.pending.clear()}}
 request<T=any>(kind:'load'|'analyze'|'compare'|'clear',args:Record<string,unknown>,progress?:(ratio:number)=>void):Promise<T>{const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject,progress});this.worker.postMessage({id,kind,args})})}
}
export const engine=new BrowserEngine();
