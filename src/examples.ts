import {MAX_BYTES} from './core.ts';

// User-selected demonstration tracks. Paths are relative to Vite's base URL
// so local development and GitHub Pages use the same code.
export const EXAMPLE_TRACKS = [
  {side:'first', filename:'Saint_Mens_Player1.gpx', label:'Saint-Mens · Player 1'},
  {side:'second', filename:'Saint_Mens_Player2.gpx', label:'Saint-Mens · Player 2'},
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
