const form = document.querySelector('#form');
const fileInput = document.querySelector('#file');
const drop = document.querySelector('.drop');
const result = document.querySelector('#result');
const status = document.querySelector('#status');
const number = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 1});
const percent = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 2});

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
  const cards = document.querySelector('#cards'); clear(cards);
  cards.append(
    card('Durée totale', seconds(data.duration_s), 'Premier → dernier point'),
    card('FC moyenne', metric(data.metrics.hr.average, 'bpm'), 'Max. ' + metric(data.metrics.hr.maximum, 'bpm')),
    card('Puissance moyenne', metric(data.metrics.power.average, 'W'), 'Max. ' + metric(data.metrics.power.maximum, 'W')),
    card(data.sport === 'course' ? 'Cadence mesurée' : 'Cadence moyenne',
      metric(data.metrics.cadence.average, data.sport === 'course' ? '' : data.cadence_unit),
      data.sport === 'course'
        ? 'pas/min estimés ' + (data.cadence_mode === 'double' ? '×2' : '×1') + ' · zéros exclus · ' + seconds(data.metrics.cadence.covered_s) + ' couverts'
        : data.cadence_unit)
  );
  if (data.sport === 'course') {
    cards.append(card('Cadence de foulée', metric(data.running_cadence.average, ''),
      'pas/min estimés · ≥ 130 · ' + seconds(data.running_cadence.covered_s) + ' couverts'));
  }
  drawZones(data); drawCoverage(data);
  const charts = document.querySelector('#charts'); clear(charts);
  drawChart(charts, data, 'hr', 'Fréquence cardiaque', 'bpm', '#698e56');
  drawChart(charts, data, 'power', 'Puissance', 'W', '#d59658');
  drawChart(charts, data, 'cadence', 'Cadence', data.cadence_unit, '#6585a2');
  const warnings = document.querySelector('#warnings'); clear(warnings);
  for (const warning of data.warnings) warnings.append(el('p', '', 'ⓘ ' + warning));
  result.hidden = false;
  result.scrollIntoView({behavior: 'smooth', block: 'start'});
}

fileInput.addEventListener('change', () => {
  document.querySelector('#filename').textContent = fileInput.files[0]?.name || 'Choisir un fichier d’activité';
});
function updateSportFields() {
  document.querySelector('#cadence-setting').hidden = document.querySelector('#sport').value !== 'course';
}
document.querySelector('#sport').addEventListener('change', updateSportFields);
updateSportFields();
drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', event => {
  event.preventDefault(); drop.classList.remove('drag');
  if (event.dataTransfer.files.length) { fileInput.files = event.dataTransfer.files; fileInput.dispatchEvent(new Event('change')); }
});
form.addEventListener('submit', async event => {
  event.preventDefault(); status.textContent = ''; status.classList.remove('error'); result.hidden = true;
  const file = fileInput.files[0];
  const thresholds = [2, 3, 4, 5].map(i => Number(document.querySelector('#z' + i).value));
  const [z2, z3, z4, z5] = thresholds;
  if (!file) { status.textContent = 'Choisissez un fichier GPX ou TCX.'; status.classList.add('error'); return; }
  if (file.size > 50 * 1024 * 1024) { status.textContent = 'Ce fichier dépasse 50 Mio.'; status.classList.add('error'); return; }
  if (!thresholds.every(Number.isInteger) || z2 <= 0 || z2 >= z3 || z3 >= z4 || z4 >= z5 || z5 > 300) {
    status.textContent = 'Renseignez des seuils cohérents : 0 < Z2 < Z3 < Z4 < Z5 ≤ 300 bpm.'; status.classList.add('error'); return;
  }
  const button = document.querySelector('#submit'); button.disabled = true; status.textContent = 'Analyse en cours…';
  try {
    const response = await fetch('/api/analyze', {method: 'POST', body: new FormData(form)});
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Import impossible.');
    status.textContent = ''; display(payload, file.name);
  } catch (error) {
    status.textContent = error.message || 'Le serveur local ne répond pas.'; status.classList.add('error');
  } finally { button.disabled = false; }
});
