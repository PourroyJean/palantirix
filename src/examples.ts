import {MAX_BYTES} from './core.ts';

// Public CC BY 4.0 tracks, copied unchanged from HikeAlong. Paths are relative
// to Vite's base URL so local development and GitHub Pages use the same code.
export const EXAMPLE_TRACKS = [
  {side:'first', filename:'stone-mountain-2025-03-23.gpx', label:'Stone Mountain · 23 mars 2025'},
  {side:'second', filename:'stone-mountain-2026-05-16.gpx', label:'Stone Mountain · 16 mai 2026'},
] as const;

export async function fetchExampleFile(filename:string, base:string, get:typeof fetch=fetch):Promise<File> {
  const response = await get(base+'examples/'+filename);
  if (!response.ok) throw new Error('Téléchargement de '+filename+' impossible (HTTP '+response.status+').');
  const length = Number(response.headers.get('content-length'));
  if (length > MAX_BYTES) throw new Error(filename+' dépasse la limite de 50 Mio.');
  const blob = await response.blob();
  if (!blob.size || blob.size > MAX_BYTES) throw new Error(filename+' est vide ou dépasse 50 Mio.');
  return new File([blob],filename,{type:'application/gpx+xml'});
}
