import {expect,it} from 'vitest';
import {analyze,parseFile,AnalysisError,MAX_BYTES} from '../src/core.ts';
import {preview,compareRanges} from '../src/comparison.ts';
const file=(s:string)=>new File([s],'synthetic.gpx');
const points=(ds:number[],ts:number[],hrs:(number|null)[]=ds.map(()=>150),cads:(number|null)[]=ds.map(()=>80),powers:(number|null)[]=ds.map(()=>100),segBreak=-1)=>{
 const parts=ds.map((d,i)=>'<trkpt lat="0" lon="'+(d/6371000*180/Math.PI).toFixed(12)+'"><time>2026-01-01T00:'+String(Math.floor(ts[i]/60)).padStart(2,'0')+':'+String(ts[i]%60).padStart(2,'0')+'Z</time><extensions>'+ (hrs[i]===null?'':'<x:hr>'+hrs[i]+'</x:hr>')+(cads[i]===null?'':'<x:cad>'+cads[i]+'</x:cad>')+(powers[i]===null?'':'<x:Watts>'+powers[i]+'</x:Watts>')+'</extensions></trkpt>');
 return '<gpx xmlns:x="urn:garmin"><trk><trkseg>'+parts.map((p,i)=>i===segBreak?'</trkseg><trkseg>'+p:p).join('')+'</trkseg></trk></gpx>';
};
it('zones, missing sensors, exact 30 s and > 30 s',async()=>{const r=await parseFile(file(points([0,50,100,150],[0,30,61,62],[163,null,172,171],[0,null,80,0],[0,null,100,0])));const a=analyze(r,'course',136,152,164,172,'double');expect(a.zones.unknown_s).toBe(31);expect(a.zones.z3_s).toBe(30);expect(a.zones.z5_s).toBe(1);expect(a.metrics.power.average).toBeCloseTo(100/31);expect(a.metrics.cadence.average).toBe(160)});
it('no bridge across a GPX segment break',async()=>{const r=await parseFile(file(points([0,50,100],[0,5,10],undefined,undefined,undefined,1)));const a=analyze(r,'velo',136,152,162,170,'direct');expect(a.metrics.hr.covered_s).toBe(5);expect(a.zones.unknown_s).toBe(5)});
it('rejects malformed, DTD, TCX multiple activities and huge files',async()=>{for(const xml of ['<gpx>','<!DOCTYPE gpx><gpx/>','<TrainingCenterDatabase><Activities><Activity/><Activity/></Activities></TrainingCenterDatabase>'])await expect(parseFile(file(xml))).rejects.toBeInstanceOf(AnalysisError);await expect(parseFile(new File([new Uint8Array(MAX_BYTES+1)],'large.gpx'))).rejects.toThrow(/50 Mio/)});
it('TCX reads watts and run cadence',async()=>{const tcx='<TrainingCenterDatabase><Activities><Activity><Lap><Track><Trackpoint><Time>2026-01-01T00:00:00Z</Time><HeartRateBpm><Value>170</Value></HeartRateBpm><Cadence>85</Cadence><Extensions><TPX><Watts>250</Watts></TPX></Extensions></Trackpoint><Trackpoint><Time>2026-01-01T00:00:10Z</Time><Extensions><TPX><RunCadence>86</RunCadence></TPX></Extensions></Trackpoint></Track></Lap></Activity></Activities></TrainingCenterDatabase>';const r=await parseFile(file(tcx));const a=analyze(r,'course',136,152,162,170,'double');expect(a.metrics.power.average).toBe(250);expect(a.cadence_sources).toEqual(['Cadence','RunCadence'])});
it('independent interpolated bounds, changing selection, no artificial connection',async()=>{const a=await parseFile(file(points([0,50,100,150,200],[0,5,10,15,20])));const b=await parseFile(file(points([0,50,100,150,200],[0,6,12,18,24],[140,150,null,160,170])));expect(preview(a).distance_m).toBeCloseTo(200);const x=compareRanges(a,b,30,180,40,190);expect(x.reference.duration_s).toBeCloseTo(15);expect(x.challenger.duration_s).toBeCloseTo(18);expect(x.reference.hr_series.maximum_point?.bpm).toBe(150);expect(compareRanges(a,b,70,180,40,190).reference.duration_s).toBeCloseTo(11);expect(x.challenger.hr_series.segments.length).toBeGreaterThan(1);expect(()=>compareRanges(a,b,210,220,40,190)).toThrow(/Bornes invalides/)});
it('stop, long gap and track break split local pace',async()=>{const r=await parseFile(file(points([0,50,100,150,150,200,250,300,350],[0,5,10,15,20,25,30,35,40],undefined,undefined,[100,100,100,100,0,100,100,100,100])));const p=compareRanges(r,r,0,350,0,350).reference.pace_series;expect(p.segments.length).toBe(2);expect(p.gps_freeze_s).toBe(0)});
it('recognizes alternate namespace prefixes and chunked XML text',async()=>{
 const xml='<gpx xmlns:h="urn:heartrate" xmlns:p="urn:power"><trk><trkseg><trkpt lat="0" lon="0"><time>2026-01-01T00:00:00Z</time><extensions><h:TrackPointExtension><h:hr>164</h:hr><h:cad>0</h:cad></h:TrackPointExtension><p:Watts>0</p:Watts></extensions></trkpt><trkpt lat="0" lon="0.001"><time>2026-01-01T00:00:10Z</time><extensions><p:power>300</p:power></extensions></trkpt></trkseg></trk></gpx>';
 const r=await parseFile(file(xml));expect(r.points[0].hr).toBe(164);expect(r.points[0].power).toBe(0);expect(r.points[0].cadence).toBe(0);
 const summary=analyze(r,'velo',136,152,164,172,'direct');expect(summary.zones.z4_s).toBe(10);expect(summary.metrics.power.average).toBe(0);expect(summary.metrics.power.maximum).toBe(300);expect(summary.metrics.cadence.average).toBe(0);
});
it('rejects invalid date, missing coordinates, empty activity, incoherent thresholds',async()=>{
 const bad=points([0,50],[0,5]).replace('2026-01-01T00:00:00Z','not-a-date');const partial=await parseFile(file(bad));expect(partial.invalid).toBe(1);
 const noGPS=await parseFile(file(points([0,50],[0,5]).replace(/<trkpt lat="0" lon="[^"]+">/,'<trkpt>')));expect(()=>preview(noGPS)).toThrow(/GPS/);
 await expect(parseFile(file('<gpx><trk/></gpx>'))).rejects.toThrow(/Aucun point/);
 const r=await parseFile(file(points([0,50],[0,5])));expect(()=>analyze(r,'course',152,136,164,172,'double')).toThrow(/Seuils/);
});
it('keeps the last timestamp and maximum at a fully selected stationary finish',async()=>{
 const r=await parseFile(file(points([0,50,100,100,100],[0,10,20,25,30],[100,120,140,160,180])));
 const whole=compareRanges(r,r,0,preview(r).distance_m,0,preview(r).distance_m).reference;
 expect(whole.duration_s).toBe(30);expect(whole.metrics.hr.average).toBeCloseTo((1000+1200+700+800)/30);expect(whole.hr_series.maximum_point?.bpm).toBe(180);
 const stoppedThenMoved=await parseFile(file(points([0,50,100,100,150],[0,10,20,25,30])));
 const short=compareRanges(stoppedThenMoved,stoppedThenMoved,0,100,0,100).reference;expect(short.duration_s).toBeCloseTo(20);expect(short.metrics.hr.covered_s).toBeCloseTo(20);
});
it('preserves 100 m pace windows, selection edges, GPS freeze and distinct means',async()=>{
 const r=await parseFile(file(points([0,50,100,150],[0,10,30,40])));const profile=compareRanges(r,r,0,150,0,150).reference.pace_series;
 expect(profile.average_s_per_km).toBeCloseTo(40/.15);for(const sample of profile.segments[0])expect(sample[1]).toBeCloseTo(300);
 const short=compareRanges(r,r,0,75,0,75).reference.pace_series;expect(short.segments).toHaveLength(1);expect(short.segments[0][0][0]).toBe(0);
 const frozen=await parseFile(file(points([0,50,100,100,100,150,200],[0,5,10,11,12,17,22],undefined,undefined,undefined)));
 const kept=compareRanges(frozen,frozen,0,200,0,200).reference.pace_series;expect(kept.gps_freeze_s).toBe(2);expect(kept.segments).toHaveLength(1);
});
it('does not connect gaps and reports isolated peak HR and absent HR',async()=>{
 const r=await parseFile(file(points([0,50,100,150],[0,10,50,60],[100,180,130,140])));
 const missing=await parseFile(file(points([0,50,100,150],[0,10,20,30],[null,null,null,null])));
 const c=compareRanges(r,missing,0,150,0,150);expect(c.hr_common_min_bpm).toBe(100);
 expect(c.reference.hr_series.maximum_point).toMatchObject({bpm:180});expect(c.reference.hr_series.isolated.some(x=>x[1]===180)).toBe(true);
 expect(c.challenger.hr_series.segments).toEqual([]);expect(c.challenger.hr_series.minimum_bpm).toBeNull();
});
it('excludes gaps and GPX track breaks from local pace',async()=>{
 const gap=await parseFile(file(points([0,50,100],[0,31,41])));expect(compareRanges(gap,gap,0,100,0,100).reference.pace_series.segments).toEqual([]);
 const split=await parseFile(file(points([0,50,100,150,200,250],[0,5,10,15,20,25],undefined,undefined,undefined,3)));
 const length=preview(split).distance_m;const series=compareRanges(split,split,0,length,0,length).reference.pace_series;
 expect(series.segments).toHaveLength(2);
});
it('rejects calendar-overflow timestamps instead of normalizing them',async()=>{
 const xml=points([0,50],[0,5]).replace('2026-01-01T00:00:00Z','2026-02-30T00:00:00Z');
 const parsed=await parseFile(file(xml));expect(parsed.invalid).toBe(1);
 await expect(parseFile(file(xml.replace('2026-01-01T00:00:05Z','2026-13-01T00:00:05Z')))).rejects.toThrow(/Aucun point/);
});
