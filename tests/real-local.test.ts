// Optional local-only parity check: no personal fixture is checked into Git.
import {it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {analyze,parseFile} from '../src/core.ts';
import {preview,compareRanges} from '../src/comparison.ts';
const paths=[process.env.PALANTIRIX_LOCAL_GPX_1,process.env.PALANTIRIX_LOCAL_GPX_2];
const golden=process.env.PALANTIRIX_LOCAL_EXPECTED;
const available=paths.every(path=>path&&existsSync(path))&&!!golden&&existsSync(golden);
const check=(actual:unknown,wanted:unknown,path='result'):void=>{
 if(typeof wanted==='number'){expect(actual,path).toBeCloseTo(wanted,5);return}
 if(Array.isArray(wanted)){expect((actual as unknown[]).length,path).toBe(wanted.length);wanted.forEach((v,i)=>check((actual as unknown[])[i],v,path+'.'+i));return}
 if(wanted&&typeof wanted==='object'){for(const [key,val] of Object.entries(wanted))check((actual as Record<string,unknown>)[key],val,path+'.'+key);return}
 expect(actual,path).toEqual(wanted);
};
it.skipIf(!available)('matches local Python reference without publishing personal data',async()=>{
 const [a,b]=await Promise.all(paths.map(async path=>parseFile(new File([readFileSync(path!)],'private.gpx'))));
 const expected=JSON.parse(readFileSync(golden!,'utf8'));
 check(analyze(a,'course',136,152,162,170,'double'),expected.single);
 check(preview(a),expected.previews[0]);check(preview(b),expected.previews[1]);
 check(compareRanges(a,b,0,3100,0,3100),expected.compare);
});
