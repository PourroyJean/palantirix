import {expect,it} from 'vitest';
import {analyze,meters,parseFile} from '../src/core.ts';
import {gradeProfile} from '../src/grade.ts';

const lon=(distance:number)=>(distance / (6371000*Math.PI/180)).toFixed(12);
function fixture(distances:number[],elevations:(number|null)[],times:number[],split=-1){
 const points=distances.map((distance,i)=>
   (i===split?'</trkseg><trkseg>':'')+
   '<trkpt lat="0" lon="'+lon(distance)+'"><time>2026-01-01T00:'+String(Math.floor(times[i]/60)).padStart(2,'0')+':'+String(times[i]%60).padStart(2,'0')+'Z</time>'+
   (elevations[i]===null?'':'<ele>'+elevations[i]+'</ele>')+'</trkpt>').join('');
 return new File(['<gpx><trk><trkseg>'+points+'</trkseg></trk></gpx>'],'grade.gpx');
}
it('classe les quatre pentes et calcule les parts en distance GPS',async()=>{
 const route=await parseFile(fixture([0,100,200,300,400],[30,20,20,27,39],[0,10,20,30,40]));
 const result=analyze(route,'course',136,152,164,172,'direct');
 const profile=result.grade;
 // The centered 100 m window has exactly the slope of each 100 m edge.
 profile.bins_m.forEach(distance=>expect(distance).toBeCloseTo(100,4));
 expect(profile.geometry.map(edge=>edge[4])).toEqual([0,1,2,3]);
 expect(profile.unclassified_m).toBeCloseTo(0,4);
 expect(profile.bins_m.reduce((a,b)=>a+b,0)).toBeCloseTo(result.route.distance_m!,4);
});
it('ne traverse pas un trou temporel, une coupure GPX ou une altitude manquante',async()=>{
 const gap=await parseFile(fixture([0,100,200,300],[0,10,40,60],[0,10,50,60]));
 const g=gradeProfile(gap.points);
 expect(g.geometry.map(edge=>edge[4])).toEqual([3,3]);
 expect(g.bins_m[3]).toBeCloseTo(200,4);
 expect(g.geometry).toHaveLength(2);
 const split=await parseFile(fixture([0,100,200,300],[0,10,40,60],[0,10,20,30],2));
 expect(gradeProfile(split.points).geometry.map(edge=>edge[4])).toEqual([3,3]);
 const missing=await parseFile(fixture([0,100,200,300],[0,10,null,60],[0,10,20,30]));
 const m=gradeProfile(missing.points);
 expect(m.geometry.map(edge=>edge[4])).toEqual([3,-1,-1]);
 expect(m.unclassified_m).toBeCloseTo(200,4);
});
it('un tronçon de 50 m est classable, un tronçon de 40 m reste inconnu',async()=>{
 const short=await parseFile(fixture([0,40],[0,6],[0,10]));
 expect(gradeProfile(short.points).bins_m).toEqual([0,0,0,0]);
 expect(gradeProfile(short.points).geometry[0][4]).toBe(-1);
 const minimum=await parseFile(fixture([0,50],[0,5],[0,10]));
 expect(gradeProfile(minimum.points).bins_m[3]).toBeCloseTo(50,4);
});
it('ne crée aucune pente sans altitude et ignore les coordonnées gelées',async()=>{
 const none=await parseFile(fixture([0,50,100],[null,null,null],[0,10,20]));
 expect(gradeProfile(none.points).unclassified_m).toBeCloseTo(100,4);
 const frozen=await parseFile(fixture([0,50,50,100],[0,0,20,20],[0,10,15,25]));
 const p=gradeProfile(frozen.points);
 expect(p.geometry).toHaveLength(2);
 expect(p.geometry.every(edge=>edge[4]===1)).toBe(true);
  expect(meters([0,0],[0,Number(lon(100))])).toBeCloseTo(100,4);
});
it('respecte les seuils inclusifs de −5, +5 et +10 %',async()=>{
  const mild=await parseFile(fixture([0,100],[0,-5],[0,10]));
  expect(gradeProfile(mild.points).geometry[0][4]).toBe(1);
  const rising=await parseFile(fixture([0,100],[0,5],[0,10]));
  expect(gradeProfile(rising.points).geometry[0][4]).toBe(2);
  const steep=await parseFile(fixture([0,100],[0,10],[0,10]));
  expect(gradeProfile(steep.points).geometry[0][4]).toBe(3);
});
