import {MAX_GAP,meters,type Point} from './core.ts';

// bins: descending < -5 %, rolling [-5 %, 5 %), climbing [5 %, 10 %), steep >= 10 %.
export type GradeBin = 0|1|2|3;
export type GradeEdge = [number,number,number,number,GradeBin|-1];
export interface GradeProfile {
  bins_m:[number,number,number,number];
  unclassified_m:number;
  geometry:GradeEdge[];
  window_m:100;
}

function validPosition(p:Point):boolean{
  return p.lat!==null&&p.lon!==null&&p.lat>=-90&&p.lat<=90&&p.lon>=-180&&p.lon<=180;
}

function altitudeAt(distances:number[],altitudes:number[],target:number):number{
  let lo=0,hi=distances.length-1;
  while(lo<hi){const mid=(lo+hi)>>>1;if(distances[mid]<target)lo=mid+1;else hi=mid}
  if(lo===0)return altitudes[0];
  const share=(target-distances[lo-1])/(distances[lo]-distances[lo-1]);
  return altitudes[lo-1]+share*(altitudes[lo]-altitudes[lo-1]);
}

export function gradeProfile(points:Point[]):GradeProfile{
  const geometry:GradeEdge[]=[];
  const bins_m:[number,number,number,number]=[0,0,0,0];
  // Runs are uninterrupted, moving, altitude-covered GPS intervals.
  let distances=[0],altitudes:number[]=[],runEdges:number[]=[];
  const flush=()=>{
    const length=distances.at(-1)!;
    if(length>=50-1e-5){
      for(let j=0;j<runEdges.length;j++){
        const middle=(distances[j]+distances[j+1])/2;
        const low=Math.max(0,middle-50),high=Math.min(length,middle+50);
        if(high-low<50-1e-6)continue;
        const grade=100*(altitudeAt(distances,altitudes,high)-altitudeAt(distances,altitudes,low))/(high-low);
        // Coordinates rounded by exports can shift a nominal 10 % slope by
        // a few millionths; keep boundary values stable at display precision.
        const bin:GradeBin=grade< -5-1e-4?0:grade<5-1e-4?1:grade<10-1e-4?2:3;
        geometry[runEdges[j]][4]=bin;
        bins_m[bin]+=distances[j+1]-distances[j];
      }
    }
    distances=[0];altitudes=[];runEdges=[];
  };
  let unclassified=0;
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],duration=(b.time-a.time)/1000;
    if(a.segment!==b.segment||duration<=0||duration>MAX_GAP||!validPosition(a)||!validPosition(b)){
      flush();continue;
    }
    const distance=meters([a.lat!,a.lon!],[b.lat!,b.lon!]);
    if(distance<=0){flush();continue}
    const edge:GradeEdge=[a.lat!,a.lon!,b.lat!,b.lon!,-1];
    const index=geometry.push(edge)-1;
    unclassified+=distance;
    if(a.ele===null||b.ele===null){flush();continue}
    if(!runEdges.length)altitudes=[a.ele];
    runEdges.push(index);distances.push(distances.at(-1)!+distance);altitudes.push(b.ele);
  }
  flush();
  const classified=bins_m.reduce((a,b)=>a+b,0);
  return {bins_m,unclassified_m:Math.max(0,unclassified-classified),geometry,window_m:100};
}
