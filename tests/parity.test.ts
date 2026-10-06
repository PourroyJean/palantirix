import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {analyze,parseFile} from '../src/core';
import {preview,compareRanges} from '../src/comparison';
const read=(name:string)=>new File([readFileSync('tests/fixtures/'+name+'.xml')],name+'.gpx');
const expected=JSON.parse(readFileSync('tests/fixtures/expected.json','utf8'));
function almost(a:unknown,b:unknown,path='root'){
 if(typeof b==='number'){expect(a,path).toBeCloseTo(b,5);return}
 if(Array.isArray(b)){expect(Array.isArray(a),path).toBe(true);expect((a as unknown[]).length,path).toBe(b.length);b.forEach((v,i)=>almost((a as unknown[])[i],v,path+'.'+i));return}
 if(b&&typeof b==='object'){for(const [k,v] of Object.entries(b))almost((a as Record<string,unknown>)[k],v,path+'.'+k);return}
 expect(a,path).toEqual(b);
}
describe('parité Python synthétique',()=>{
 it('analyse GPX et zones',async()=>almost(analyze(await parseFile(read('first')),'course',136,152,164,172,'double'),expected.single));
 it('aperçu et comparaison',async()=>{const a=await parseFile(read('first')),b=await parseFile(read('second'));almost(preview(a),expected.previews[0]);almost(preview(b),expected.previews[1]);almost(compareRanges(a,b,40,230,30,250,'double','direct'),expected.compare)});
});
