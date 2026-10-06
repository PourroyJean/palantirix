import {expect,it} from 'vitest';
import {analyze,parseFile,routeTotals} from '../src/core.ts';

function activity(positions:(number|null)[],elevations:(number|null)[],times:number[],breakBefore=-1,tcx=false){
  const point=(i:number)=>tcx
    ? '<Trackpoint><Time>2026-01-01T00:00:'+String(times[i]).padStart(2,'0')+'Z</Time>'+
      (positions[i]===null?'':'<Position><LatitudeDegrees>0</LatitudeDegrees><LongitudeDegrees>'+positions[i]+'</LongitudeDegrees></Position>')+
      (elevations[i]===null?'':'<AltitudeMeters>'+elevations[i]+'</AltitudeMeters>')+'</Trackpoint>'
    : '<trkpt'+(positions[i]===null?'':' lat="0" lon="'+positions[i]+'"')+'><time>2026-01-01T00:00:'+String(times[i]).padStart(2,'0')+'Z</time>'+
      (elevations[i]===null?'':'<ele>'+elevations[i]+'</ele>')+'</trkpt>';
  const chunks=positions.map((_,i)=>(i===breakBefore?(tcx?'</Track><Track>':'</trkseg><trkseg>'):'')+point(i)).join('');
  return new File([tcx?'<TrainingCenterDatabase><Activities><Activity><Lap><Track>'+chunks+'</Track></Lap></Activity></Activities></TrainingCenterDatabase>':'<gpx><trk><trkseg>'+chunks+'</trkseg></trk></gpx>'],'synthetic.xml');
}
it('calcule les trois KPI sur les intervalles GPS et altitude exploitables',async()=>{
 const route=await parseFile(activity([0,.001,.002,.003],[10,15,12,12],[0,10,20,30]));
 const result=analyze(route,'course',136,152,164,172,'direct').route;
 expect(result.distance_m).toBeCloseTo(333.585,2);
 expect(result.ascent_m).toBe(5);expect(result.descent_m).toBe(3);
 expect(result.gps_covered_s).toBe(30);expect(result.elevation_covered_s).toBe(30);
});
it('ne relie ni pause de plus de 30 s ni coupure GPX',async()=>{
 const gap=await parseFile(activity([0,.001,.002],[10,30,35],[0,31,41]));
 expect(routeTotals(gap.points)).toMatchObject({ascent_m:5,descent_m:0,gps_covered_s:10,elevation_covered_s:10});
 expect(routeTotals(gap.points).distance_m).toBeCloseTo(111.195,2);
 const broken=await parseFile(activity([0,.001,.002],[10,30,35],[0,10,20],1));
 expect(routeTotals(broken.points)).toMatchObject({ascent_m:5,descent_m:0,gps_covered_s:10,elevation_covered_s:10});
});
it('une altitude ou position absente rend le total partiel, pas nul',async()=>{
 const route=await parseFile(activity([0,.001,null,.003,.004],[10,15,null,20,18],[0,10,20,30,40]));
 const result=routeTotals(route.points);
 expect(result.distance_m).toBeCloseTo(222.39,2);
 expect(result.ascent_m).toBe(5);expect(result.descent_m).toBe(2);
 expect(result.gps_covered_s).toBe(20);expect(result.elevation_covered_s).toBe(20);
});
it('pas de GPS ou d’altitude : KPI indisponibles ; TCX GPS valide',async()=>{
 const none=await parseFile(activity([null,null],[null,null],[0,10]));
 expect(routeTotals(none.points)).toEqual({distance_m:null,ascent_m:null,descent_m:null,gps_covered_s:0,elevation_covered_s:0});
 const tcx=await parseFile(activity([0,.001],[100,90],[0,10],-1,true));
 expect(routeTotals(tcx.points).distance_m).toBeCloseTo(111.195,2);
 expect(routeTotals(tcx.points).descent_m).toBe(10);
});
