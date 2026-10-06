import {engine} from './src/client.ts';
import {activityFileError} from './src/upload.ts';
import {showSoloMap,closeMap} from './map.js';
const form = document.querySelector('#form');
const fileInput = document.querySelector('#file');
const drop = document.querySelector('.drop');
const browse = document.querySelector('#browse');
const submit = document.querySelector('#submit');
const result = document.querySelector('#result');
const status = document.querySelector('#status');
const number = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 1});
const distanceNumber = new Intl.NumberFormat('fr-FR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const metersNumber = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 0});
const percent = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 2});
let formVersion = 0;
const gradeMapError = document.querySelector('#grade-map-error');
const gradeTileError = () => { gradeMapError.hidden = false; };
function updateGradeNote(unknown) {
  document.querySelector('#grade-note').textContent =
    'Pente estimée sur 100 m de parcours continu (au moins 50 m exploitables). ' +
    (unknown > .5 ? metersNumber.format(unknown) + ' m sans pente classable (altitude absente, arrêt ou tronçon trop court). ' : '') +
    'Les variations d’altitude et la précision GPS influencent les pourcentages. ' +
    'Fond OpenStreetMap : la zone affichée est transmise au fournisseur de tuiles.';
}

function seconds(value) {
  if (value == null) return '—';
  const s = Math.round(value);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), rest = s % 60;
  return h ? [h, String(m).padStart(2, '0'), String(rest).padStart(2, '0')].join(':')
    : [m, String(rest).padStart(2, '0')].join(':');
}
function metric(value, unit) { return value == null ? '—' : number.format(value) + (unit ? ' ' + unit : ''); }
function clear(node) { node.replaceChildren(); }
function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = value;
  return node;
}
function card(title, value, caption) {
  const node = el('div', 'card');
  node.append(el('span', '', title), el('strong', '', value), el('small', '', caption));
  return node;
}
function routeKpi(title, value, unit, caption, icon, tone) {
  const item = el('div', 'route-kpi route-kpi-' + tone);
  const text = el('div', 'route-kpi-copy');
  const figure = el('strong', 'route-kpi-value', value);
  if (unit) figure.append(document.createTextNode('\u00a0'), el('span', 'route-kpi-unit', unit));
  text.append(el('span', 'route-kpi-title', title), figure, el('small', 'route-kpi-caption', caption));
  const badge = el('div', 'route-kpi-icon');
  badge.setAttribute('aria-hidden', 'true');
  const svg = svgEl('svg', {viewBox: '0 0 48 48', fill: 'none', 'stroke-width': 3,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round'});
  const paths = {
    distance: 'M8 22 40 8 26 40 21 27 8 22Z',
    ascent: 'M7 34 19 22 27 29 40 16 M29 16h11v11',
    descent: 'M7 14 19 26 27 19 40 32 M29 32h11V21',
  };
  svg.append(svgEl('path', {d: paths[icon]}));
  badge.append(svg);
  item.append(text, badge);
  return item;
}

function drawZones(data) {
  const {z2_min: z2, z3_min: z3, z4_min: z4, z5_min: z5} = data.thresholds;
  const config = [
    ['z1_s', 'Z1', '< ' + z2 + ' bpm', '#b5d1bd'],
    ['z2_s', 'Z2', z2 + '–' + (z3 - 1) + ' bpm', '#a9c98a'],
    ['z3_s', 'Z3', z3 + '–' + (z4 - 1) + ' bpm', '#e5c976'],
    ['z4_s', 'Z4', z4 + '–' + (z5 - 1) + ' bpm', '#e9a36b'],
    ['z5_s', 'Z5', '≥ ' + z5 + ' bpm', '#d46652'],
    ['unknown_s', 'Sans couverture FC', 'Intervalle non mesuré', '#dfe5e1'],
  ];
  const bar = document.querySelector('#zonebar'), legend = document.querySelector('#zonelegend');
  clear(bar); clear(legend);
  bar.setAttribute('aria-label', config.map(([key, label, range]) => label + ' (' + range + ') : ' + seconds(data.zones[key])).join(', '));
  for (const [key, label, range, color] of config) {
    const slice = el('span');
    slice.style.backgroundColor = color;
    slice.style.width = data.duration_s ? (100 * data.zones[key] / data.duration_s) + '%' : '0%';
    bar.append(slice);
    const item = el('div', 'legend-item');
    const swatch = el('i', 'swatch'); swatch.style.backgroundColor = color;
    item.append(swatch, document.createTextNode(label + ' · ' + range), el('strong', '', seconds(data.zones[key])));
    legend.append(item);
  }
}

function drawCoverage(data) {
  const container = document.querySelector('#coverage'); clear(container);
  for (const [key, title] of [['hr', 'Fréquence cardiaque'], ['power', 'Puissance'], ['cadence', 'Cadence']]) {
    const covered = data.metrics[key].covered_s;
    const ratio = data.duration_s ? Math.min(100, 100 * covered / data.duration_s) : 0;
    const row = el('div', 'coverage-row'), line = el('div', 'line');
    line.append(el('span', '', title), el('strong', '', seconds(covered) + ' / ' + percent.format(ratio) + ' %'));
    const track = el('div', 'track'), fill = el('div', 'fill');
    fill.style.width = ratio + '%'; track.append(fill);
    row.append(line, track); container.append(row);
  }
}

const gradeColors = ['#24b964', '#4b91dc', '#ee911d', '#d92d50'];
const gradeLabels = ['Descente · < −5 %', 'Modéré · −5 à +5 %', 'Montée · +5 à +10 %', 'Forte montée · ≥ +10 %'];
function drawGrade(data) {
  const cards = document.querySelector('#grade-kpis');
  gradeMapError.hidden = true;
  closeMap('grade-osm');
  const hasGeometry = data.grade.geometry.length > 0;
  document.querySelector('.grade-map-wrap').hidden = !hasGeometry;
  document.querySelector('#grade-osm').hidden = !hasGeometry;
  document.querySelector('#grade-map-placeholder').hidden = hasGeometry;
  clear(cards);
  const {geometry, bins_m: bins, unclassified_m: unknown} = data.grade;
  const distance = data.route.distance_m || 0;
  for (let i = 0; i < bins.length; i++) {
    const tile = el('div', 'grade-kpi'); tile.style.setProperty('--grade-color', gradeColors[i]);
    const arrow = el('span', 'grade-arrow', ['↘', '→', '↗', '↑'][i]); arrow.setAttribute('aria-hidden', 'true');
    const value = !distance ? '—' : bins[i] >= 1000 ? distanceNumber.format(bins[i] / 1000) + ' km' : metersNumber.format(bins[i]) + ' m';
    tile.append(arrow, el('span', 'grade-name', gradeLabels[i]), el('strong', '', value),
      el('small', '', distance ? percent.format(100 * bins[i] / distance) + ' % du parcours GPS' : 'GPS indisponible'));
    cards.append(tile);
  }
  updateGradeNote(unknown);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}
function drawChart(parent, data, key, title, unit, color) {
  const block = el('div', 'chart-block'), head = el('div', 'chart-header');
  head.append(el('span', '', title), el('small', '', unit)); block.append(head);
  const valid = data.chart.filter(p => Number.isFinite(p[key]));
  if (!valid.length) { block.append(el('p', 'chart-empty', 'Aucune mesure disponible.')); parent.append(block); return; }
  const width = 980, height = 175, left = 45, right = 20, top = 15, bottom = 27;
  let ymin = 0, ymax = 1;
  for (const point of valid) { ymin = Math.min(ymin, point[key]); ymax = Math.max(ymax, point[key]); }
  const scaleX = t => left + (width - left - right) * t / Math.max(1, data.duration_s);
  const scaleY = v => height - bottom - (height - bottom - top) * (v - ymin) / Math.max(1, ymax - ymin);
  const svg = svgEl('svg', {viewBox: '0 0 ' + width + ' ' + height, class: 'chart-svg', role: 'img', 'aria-label': 'Évolution de ' + title.toLowerCase() + ' sur la durée de l’activité'});
  for (let n = 0; n < 3; n++) {
    const y = top + n * (height - top - bottom) / 2;
    svg.append(svgEl('line', {x1: left, y1: y, x2: width - right, y2: y, stroke: '#e8eee6'}));
    const text = svgEl('text', {x: left - 9, y: y + 4, 'text-anchor': 'end', fill: '#96a197', 'font-size': 11});
    text.textContent = number.format(ymax - n * (ymax - ymin) / 2); svg.append(text);
  }
  const labelStart = svgEl('text', {x: left, y: height - 5, fill: '#96a197', 'font-size': 11});
  labelStart.textContent = '0:00'; svg.append(labelStart);
  const labelEnd = svgEl('text', {x: width - right, y: height - 5, 'text-anchor': 'end', fill: '#96a197', 'font-size': 11});
  labelEnd.textContent = seconds(data.duration_s); svg.append(labelEnd);
  let path = '', previous = null;
  for (const point of data.chart) {
    const value = point[key];
    if (!Number.isFinite(value)) { previous = null; continue; }
    const gap = !previous || point.segment !== previous.segment || point.t - previous.t > data.max_interval_s || point.t <= previous.t;
    path += (gap ? 'M' : 'L') + scaleX(point.t).toFixed(2) + ',' + scaleY(value).toFixed(2);
    previous = point;
  }
  svg.append(svgEl('path', {d: path, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'}));
  block.append(svg); parent.append(block);
}

function display(data, filename) {
  document.querySelector('#activity-title').textContent = filename;
  document.querySelector('#metadata').textContent = data.format + ' · ' + number.format(data.points) + ' points · ' + (data.sport === 'course' ? 'Course' : 'Vélo');
  const route = data.route;
  const routeCards = document.querySelector('#route-kpis'); clear(routeCards);
  routeCards.append(
    routeKpi('Distance totale', route.distance_m === null ? '—' : distanceNumber.format(route.distance_m / 1000), route.distance_m === null ? '' : 'km',
      route.distance_m === null ? 'Coordonnées GPS indisponibles' : 'Distance GPS · ' + seconds(route.gps_covered_s) + ' couverts', 'distance', 'distance'),
    routeKpi('Dénivelé positif total', route.ascent_m === null ? '—' : metersNumber.format(route.ascent_m), route.ascent_m === null ? '' : 'm',
      route.ascent_m === null ? 'Altitude indisponible' : 'D+ brut · ' + seconds(route.elevation_covered_s) + ' couverts', 'ascent', 'ascent'),
    routeKpi('Dénivelé négatif total', route.descent_m === null ? '—' : metersNumber.format(route.descent_m), route.descent_m === null ? '' : 'm',
      route.descent_m === null ? 'Altitude indisponible' : 'D− brut · ' + seconds(route.elevation_covered_s) + ' couverts', 'descent', 'descent')
  );
  drawGrade(data);
  const cards = document.querySelector('#cards'); clear(cards);
  cards.append(
    card('Durée totale', seconds(data.duration_s), 'Premier → dernier point'),
    card('FC moyenne', metric(data.metrics.hr.average, 'bpm'), 'Max. ' + metric(data.metrics.hr.maximum, 'bpm')),
    card('Puissance moyenne', metric(data.metrics.power.average, 'W'), 'Max. ' + metric(data.metrics.power.maximum, 'W')),
    card('Cadence moyenne',
      metric(data.metrics.cadence.average, data.sport === 'course' ? 'pas/min' : data.cadence_unit),
      data.sport === 'course'
        ? 'pas/min estimés ' + (data.cadence_mode === 'double' ? '×2' : '×1') + ' ·'
        : data.cadence_unit)
  );
  drawZones(data); drawCoverage(data);
  const charts = document.querySelector('#charts'); clear(charts);
  drawChart(charts, data, 'hr', 'Fréquence cardiaque', 'bpm', '#698e56');
  drawChart(charts, data, 'power', 'Puissance', 'W', '#d59658');
  drawChart(charts, data, 'cadence', 'Cadence', data.cadence_unit, '#6585a2');
  const warnings = document.querySelector('#warnings'); clear(warnings);
  for (const warning of data.warnings) warnings.append(el('p', '', 'ⓘ ' + warning));
  if (route.gps_covered_s < data.duration_s && route.distance_m !== null)
    warnings.append(el('p', '', 'ⓘ Distance partielle : interruptions ou coordonnées GPS absentes.'));
  if (route.elevation_covered_s < data.duration_s && route.ascent_m !== null)
    warnings.append(el('p', '', 'ⓘ Dénivelé partiel : interruptions ou altitude absente.'));
  result.hidden = false;
  if (data.grade.geometry.length) requestAnimationFrame(() => {
    if (!result.hidden && !document.querySelector('#single-view').hidden) showSoloMap(data.grade, gradeTileError);
  });
  result.scrollIntoView({behavior: 'smooth', block: 'start'});
}

function updateSelectedFile() {
  formVersion++;
  const file = fileInput.files[0];
  drop.classList.toggle('has-file', Boolean(file));
  document.querySelector('#filename').textContent = file?.name || 'Déposez votre fichier GPX ou TCX';
  const size = file && (file.size < 1024 * 1024
    ? new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 0}).format(file.size / 1024) + ' Kio'
    : new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 1}).format(file.size / 1024 / 1024) + ' Mio');
  document.querySelector('#drop-hint').textContent = file
    ? 'Prêt pour l’analyse · ' + size + ' · cliquez pour remplacer'
    : 'Glissez-le ici ou cliquez pour le sélectionner.';
  const error = activityFileError(file);
  submit.disabled = Boolean(error);
  status.textContent = '';
  status.classList.remove('error');
  if (file && error) { status.textContent = error; status.classList.add('error'); }
  result.hidden = true;
}
fileInput.addEventListener('change', updateSelectedFile);
browse.addEventListener('click', () => fileInput.click());
for (const control of form.querySelectorAll('select, input[type="number"]'))
  control.addEventListener('input', () => { formVersion++; result.hidden = true; });
function updateSportFields() {
  document.querySelector('#cadence-setting').hidden = document.querySelector('#sport').value !== 'course';
}
document.querySelector('#sport').addEventListener('change', updateSportFields);
updateSportFields();
drop.addEventListener('dragenter', event => { event.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; drop.classList.add('drag'); });
drop.addEventListener('dragleave', event => { if (!drop.contains(event.relatedTarget)) drop.classList.remove('drag'); });
drop.addEventListener('drop', event => {
  event.preventDefault(); drop.classList.remove('drag');
  if (event.dataTransfer?.files.length) {
    const list = new DataTransfer(); list.items.add(event.dataTransfer.files[0]);
    fileInput.files = list.files;
    updateSelectedFile();
  }
});
// Dropping outside the target must not navigate away from the activity.
document.addEventListener('dragover', event => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
});
document.addEventListener('drop', event => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
});
form.addEventListener('submit', async event => {
  event.preventDefault(); status.textContent = ''; status.classList.remove('error'); result.hidden = true;
  const file = fileInput.files[0];
  const thresholds = [2, 3, 4, 5].map(i => Number(document.querySelector('#z' + i).value));
  const [z2, z3, z4, z5] = thresholds;
  const fileError = activityFileError(file);
  if (fileError) { status.textContent = fileError; status.classList.add('error'); return; }
  if (!thresholds.every(Number.isInteger) || z2 <= 0 || z2 >= z3 || z3 >= z4 || z4 >= z5 || z5 > 300) {
    status.textContent = 'Renseignez des seuils cohérents : 0 < Z2 < Z3 < Z4 < Z5 ≤ 300 bpm.'; status.classList.add('error'); return;
  }
  const button = submit; button.disabled = true; status.textContent = 'Analyse en cours…';
  const version = ++formVersion;
  try {
    const payload = await engine.request('analyze', {file, sport: form.elements.namedItem('sport').value, mode: form.elements.namedItem('cadence_mode').value, z2, z3, z4, z5}, ratio => { if (version === formVersion) status.textContent = 'Analyse locale… ' + Math.round(ratio * 100) + ' %'; });
    if (version !== formVersion) return;
    status.textContent = ''; display(payload, file.name);
  } catch (error) {
    if (version === formVersion) { status.textContent = error.message || 'Le traitement local a échoué.'; status.classList.add('error'); }
  } finally { button.disabled = Boolean(activityFileError(fileInput.files[0])); }
});
