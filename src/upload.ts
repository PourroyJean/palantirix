export const MAX_ACTIVITY_BYTES = 50 * 1024 * 1024;

export function activityFileError(file: {name:string;size:number}|null|undefined):string|null {
  if (!file) return 'Choisissez un fichier GPX ou TCX.';
  if (!/\.(gpx|tcx|xml)$/i.test(file.name)) return 'Choisissez un fichier GPX ou TCX.';
  if (!file.size || file.size > MAX_ACTIVITY_BYTES) return 'Le fichier est vide ou dépasse 50 Mio.';
  return null;
}
