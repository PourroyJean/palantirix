import {readFile} from 'node:fs/promises';
import {expect,it} from 'vitest';
import {parseFile,MAX_BYTES} from '../src/core.ts';
import {preview,compareRanges} from '../src/comparison.ts';
import {EXAMPLE_TRACKS,fetchExampleFile} from '../src/examples.ts';

it('les deux GPX Saint-Mens fournissent une démonstration horodatée de la comparaison',async()=>{
 const routes=[];
 for(const track of EXAMPLE_TRACKS){
  const content=await readFile(new URL('../public/examples/'+track.filename,import.meta.url));
  const route=await parseFile(new File([content],track.filename));
  const info=preview(route);
  expect(info.distance_m).toBeGreaterThan(15000);
  expect(route.points.length).toBeGreaterThan(5000);
  expect(route.points.at(-1)!.time).toBeGreaterThan(route.points[0].time);
  expect(route.points.some(point=>point.hr!==null)).toBe(true);
  if(track.side==='first'){
   expect(route.points.some(point=>point.power!==null&&point.cadence!==null)).toBe(true);
  }else{
   expect(route.points.every(point=>point.power===null&&point.cadence===null)).toBe(true);
  }
  routes.push(route);
 }
 const comparison=compareRanges(routes[0],routes[1],0,preview(routes[0]).distance_m,0,preview(routes[1]).distance_m);
 expect(comparison.reference.duration_s).toBeGreaterThan(0);
 expect(comparison.challenger.duration_s).toBeGreaterThan(0);
 expect(comparison.reference.metrics.hr.average).not.toBeNull();
 expect(comparison.challenger.metrics.hr.average).not.toBeNull();
 expect(comparison.reference.metrics.power.average).not.toBeNull();
 expect(comparison.challenger.metrics.power.average).toBeNull();
});

it('les exemples se chargent depuis la base Vite avec les limites habituelles',async()=>{
 const filename=EXAMPLE_TRACKS[0].filename;
 const get=async (url:string)=>{
  expect(url).toBe('/palantirix/examples/'+filename);
  return new Response('<gpx/>',{headers:{'content-type':'application/gpx+xml'}});
 };
 const file=await fetchExampleFile(filename,'/palantirix/',get as typeof fetch);
 expect(file.name).toBe(filename);
 expect(file.size).toBeGreaterThan(0);
 await expect(fetchExampleFile(filename,'/palantirix/',(async()=>new Response('',{status:404})) as typeof fetch)).rejects.toThrow(/HTTP 404/);
 await expect(fetchExampleFile(filename,'/palantirix/',(async()=>new Response('a',{headers:{'content-length':String(MAX_BYTES+1)}})) as typeof fetch)).rejects.toThrow(/50 Mio/);
});
