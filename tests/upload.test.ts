import {expect,it} from 'vitest';
import {activityFileError,MAX_ACTIVITY_BYTES} from '../src/upload.ts';

it('accepte un GPX/TCX/XML valide de 50 Mio au plus',()=>{
  for (const name of ['trace.gpx','TRACE.TCX','export.xml']) {
    expect(activityFileError({name,size:1})).toBeNull();
    expect(activityFileError({name,size:MAX_ACTIVITY_BYTES})).toBeNull();
  }
});

it('rejette une absence, un format non pris en charge ou une taille invalide',()=>{
  expect(activityFileError(null)).toMatch(/Choisissez/);
  expect(activityFileError({name:'trace.fit',size:10})).toMatch(/GPX ou TCX/);
  expect(activityFileError({name:'trace.gpx',size:0})).toMatch(/vide/);
  expect(activityFileError({name:'trace.tcx',size:MAX_ACTIVITY_BYTES+1})).toMatch(/50 Mio/);
});
