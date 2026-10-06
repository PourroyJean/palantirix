const compareForm = document.querySelector('#compare-form');
const compareResult = document.querySelector('#compare-result');
const compareStatus = document.querySelector('#compare-status');
const compareNumber = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 1});
const compareKm = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 3});
const sources = {first: null, second: null};
const requestVersions = {first: 0, second: 0};
let selectionVersion = 0;
let chartPayload = null;
const chartModes = {hr: 'mirror', pace: 'mirror'};
let paceUnit = 'pace';
const svgNS = 'http://www.w3.org/2000/svg';

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value != null) element.textContent = value;
  return element;
}
function svgNode(tag, attrs) {
  const element = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}
function timeText(value) {
  const total = Math.round(value), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60);
  const s = total % 60;
  return h ? [h, String(m).padStart(2, '0'), String(s).padStart(2, '0')].join(':')
    : [m, String(s).padStart(2, '0')].join(':');
}
function paceText(value) {
  if (value == null) return '—';
  const seconds = Math.max(0, Math.round(value));
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
function speedFromPace(pace) {
  return pace > 0 && Number.isFinite(pace) ? 3600 / pace : null;
}
function speedText(value) {
  return value == null ? '—' : compareNumber.format(value);
}
function measurement(value, unit = '') {
  return value == null ? '—' : compareNumber.format(value) + (unit ? ' ' + unit : '');
}
function difference(a, b, unit = '') {
  return a == null || b == null ? '—'
    : (b - a >= 0 ? '+' : '−') + measurement(Math.abs(b - a), unit);
}
function setStatus(message, isError = false) {
  compareStatus.textContent = message;
  compareStatus.classList.toggle('error', isError);
}
function invalidate() {
  selectionVersion++;
  chartPayload = null;
  compareResult.hidden = true;
  if (compareStatus.textContent && !compareStatus.classList.contains('error')) setStatus('');
}
document.querySelectorAll('.chart-mode button').forEach(button => button.addEventListener('click', () => {
  const {chart, mode} = button.dataset;
  if (!chart || !mode) return;
  if (chartModes[chart] === mode) return;
  chartModes[chart] = mode;
  document.querySelectorAll('.chart-mode button[data-chart="' + chart + '"]').forEach(option =>
    option.setAttribute('aria-pressed', String(option.dataset.mode === mode)));
  if (chartPayload && !compareResult.hidden) {
    const {reference, challenger} = chartPayload;
    if (chart === 'hr') renderHeartRateChart(reference, challenger, chartPayload.hr_common_min_bpm);
    else renderPaceChart(reference, challenger, chartPayload.pace_common_slowest_s_per_km);
  }
}));
document.querySelectorAll('[data-pace-unit]').forEach(button => button.addEventListener('click', () => {
  const unit = button.dataset.paceUnit;
  if (paceUnit === unit) return;
  paceUnit = unit;
  document.querySelectorAll('[data-pace-unit]').forEach(option =>
    option.setAttribute('aria-pressed', String(option.dataset.paceUnit === unit)));
  if (chartPayload && !compareResult.hidden)
    renderPaceChart(chartPayload.reference, chartPayload.challenger,
      chartPayload.pace_common_slowest_s_per_km);
}));
function bounds(side) {
  return {start: sources[side].start, end: sources[side].end};
}
function refreshControl(side, editing = null) {
  const source = sources[side];
  if (!source) return;
  for (const kind of ['start', 'end']) {
    const slider = document.querySelector('#' + side + '-' + kind + '-range');
    const numberInput = document.querySelector('#' + side + '-' + kind);
    slider.value = kind === 'end' && source[kind] === source.total
      ? source.sliderMax : Math.min(source.sliderMax, source[kind]);
    if (kind !== editing) numberInput.value = (source[kind] / 1000).toFixed(source[kind] === source.total ? 3 : 2);
    slider.setAttribute('aria-valuetext', compareKm.format(source[kind] / 1000) + ' km');
  }
  const band = document.querySelector('#' + side + '-selected-track');
  band.style.left = 100 * source.start / source.total + '%';
  band.style.width = 100 * (source.end - source.start) / source.total + '%';
  document.querySelector('#' + side + '-length').textContent =
    compareKm.format((source.end - source.start) / 1000) + ' km sélectionnés';
}
function setBound(side, kind, candidate, fromSlider = false, editing = null) {
  const source = sources[side];
  if (!source || !Number.isFinite(candidate)) return;
  let value = fromSlider ? candidate : Math.round(candidate / 10) * 10;
  // The final GPS point is not necessarily aligned to the 10 m grid.
  if (kind === 'end' && candidate >= (fromSlider ? source.sliderMax : source.total)) value = source.total;
  if (kind === 'start') source.start = Math.max(0, Math.min(value, source.end - 10));
  else source.end = Math.min(source.total, Math.max(value, source.start + 10));
  refreshControl(side, editing);
  invalidate();
  drawMap();
}
for (const side of ['first', 'second']) {
  for (const kind of ['start', 'end']) {
    document.querySelector('#' + side + '-' + kind + '-range').addEventListener('input', e =>
      setBound(side, kind, Number(e.target.value), true));
    const numberInput = document.querySelector('#' + side + '-' + kind);
    numberInput.addEventListener('input', e => {
      if (e.target.value !== '' && e.target.validity.badInput === false)
        setBound(side, kind, Number(e.target.value) * 1000, false, kind);
    });
    numberInput.addEventListener('change', e => {
      if (e.target.value !== '') setBound(side, kind, Number(e.target.value) * 1000);
      else refreshControl(side);
    });
  }
}

function installPreview(side, preview, name, origin) {
  if (!Number.isFinite(preview.distance_m) || !Array.isArray(preview.geometry))
    throw new Error('Aperçu GPS invalide.');
  const total = preview.distance_m;
  // Reserve the next 10 m tick for the exact GPS endpoint; the last full
  // 10 m tick must remain independently selectable.
  const sliderMax = Math.ceil(total / 10) * 10;
  sources[side] = {preview, name, origin, total, sliderMax, start: 0, end: total};
  for (const kind of ['start', 'end']) {
    const slider = document.querySelector('#' + side + '-' + kind + '-range');
    slider.max = sliderMax;
    slider.step = 10;
    const field = document.querySelector('#' + side + '-' + kind);
    field.max = (total / 1000).toFixed(3);
  }
  document.querySelector('#' + side + '-selector').hidden = false;
  document.querySelector('#' + side + '-source').textContent = name + (origin === 'default' ? ' · préchargé' : ' · importé');
  document.querySelector('#compare-submit').disabled = !sources.first || !sources.second;
  refreshControl(side);
  invalidate();
  drawMap();
}
function reportUnavailable(side, name, error) {
  sources[side] = null;
  document.querySelector('#' + side + '-selector').hidden = true;
  document.querySelector('#' + side + '-source').textContent = name + ' : ' + error;
  document.querySelector('#compare-submit').disabled = true;
  invalidate();
  drawMap();
}
async function loadDefaults() {
  try {
    const response = await fetch('/api/default-traces');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Préchargement indisponible.');
    for (const [side, key] of [['first', 'first'], ['second', 'second']]) {
      if (requestVersions[side] !== 0) continue;
      const item = payload.traces[key];
      if (item?.preview) installPreview(side, item.preview, item.name, 'default');
      else reportUnavailable(side, item?.name || 'Trace par défaut', item?.error || 'Aucun aperçu disponible.');
    }
  } catch (error) {
    for (const side of ['first', 'second']) if (requestVersions[side] === 0)
      reportUnavailable(side, 'Trace par défaut', error.message);
  }
}
loadDefaults();

for (const [side, fieldName] of [['first', 'reference_file'], ['second', 'challenger_file']]) {
  compareForm.elements.namedItem(fieldName).addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    const version = ++requestVersions[side];
    sources[side] = null;
    document.querySelector('#' + side + '-selector').hidden = true;
    document.querySelector('#compare-submit').disabled = true;
    invalidate();
    drawMap();
    if (file.size > 50 * 1024 * 1024) {
      reportUnavailable(side, file.name, 'plus de 50 Mio.');
      return;
    }
    document.querySelector('#' + side + '-source').textContent = file.name + ' · lecture en cours…';
    try {
      const data = new FormData(); data.append('file', file);
      const response = await fetch('/api/preview', {method: 'POST', body: data});
      const preview = await response.json();
      if (!response.ok) throw new Error(preview.error || 'Aperçu impossible.');
      if (version === requestVersions[side]) installPreview(side, preview, file.name, 'upload');
    } catch (error) {
      if (version === requestVersions[side]) reportUnavailable(side, file.name, error.message);
    }
  });
}

document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
  const comparing = button.dataset.tab === 'compare';
  document.querySelector('#single-view').hidden = comparing;
  document.querySelector('#compare-view').hidden = !comparing;
  document.querySelectorAll('[data-tab]').forEach(tab => {
    tab.classList.toggle('active', tab === button);
    tab.setAttribute('aria-selected', String(tab === button));
  });
}));

function clipPart(part, start, end) {
  const output = [];
  for (let i = 0; i < part.length; i++) {
    const point = part[i];
    if (point[0] >= start && point[0] <= end) output.push(point);
    if (i === part.length - 1) continue;
    const next = part[i + 1];
    if (next[0] <= point[0]) continue;
    for (const bound of [start, end]) {
      if (point[0] < bound && bound < next[0]) {
        const f = (bound - point[0]) / (next[0] - point[0]);
        output.push([bound, point[1] + f * (next[1] - point[1]),
          point[2] + f * (next[2] - point[2])]);
      }
    }
  }
  output.sort((a, b) => a[0] - b[0]);
  return output;
}
function coordinateAt(geometry, distance, last = false) {
  let coordinate = null;
  for (const part of geometry) {
    const clipped = clipPart(part, distance, distance);
    if (clipped.length) {
      coordinate = last ? clipped[clipped.length - 1] : clipped[0];
      if (!last) break;
    }
  }
  return coordinate;
}
function drawMap() {
  const host = document.querySelector('#compare-map');
  const legend = document.querySelector('#compare-map-legend');
  host.replaceChildren(); legend.replaceChildren();
  const available = ['first', 'second'].filter(side => sources[side]);
  if (!available.length) {
    host.append(node('p', 'map-placeholder', 'Chargez une activité GPX pour voir son parcours.'));
    return;
  }
  const colors = {first: '#176bc8', second: '#e26b17'};
  const geometry = available.map(side => sources[side].preview.geometry).flat();
  const origin = geometry[0][0];
  const latScale = 6371000 * Math.PI / 180;
  const lonScale = latScale * Math.max(.01, Math.cos(origin[1] * Math.PI / 180));
  const project = point => [(point[2] - origin[2]) * lonScale, (point[1] - origin[1]) * latScale];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const part of geometry) for (const point of part) {
    const [x, y] = project(point);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const width = 1000, height = 490, padding = 54;
  const scale = Math.min((width - padding * 2) / Math.max(maxX - minX, 50),
    (height - padding * 2) / Math.max(maxY - minY, 50));
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  const pixels = point => {
    const [x, y] = project(point);
    return [width / 2 + (x - centerX) * scale, height / 2 - (y - centerY) * scale];
  };
  const svg = svgNode('svg', {viewBox: '0 0 1000 490', role: 'img',
    'aria-label': 'Parcours GPS entiers et segments sélectionnés, bleu plein pour la trace 1 et orange pointillé pour la trace 2'});
  for (let x = 0; x <= width; x += 100) svg.append(svgNode('line', {x1: x, x2: x, y1: 0, y2: height, class: 'map-grid'}));
  for (let y = 0; y <= height; y += 100) svg.append(svgNode('line', {x1: 0, x2: width, y1: y, y2: y, class: 'map-grid'}));
  const polyline = (part, color, strokeWidth, dashed = false, opacity = 1) => {
    if (part.length < 2) return;
    svg.append(svgNode('polyline', {points: part.map(point => pixels(point).map(v => v.toFixed(2)).join(',')).join(' '),
      fill: 'none', stroke: color, 'stroke-width': strokeWidth, 'stroke-linejoin': 'round',
      'stroke-linecap': 'round', 'stroke-dasharray': dashed ? '10 7' : 'none', opacity}));
  };
  for (const side of available) for (const part of sources[side].preview.geometry)
    polyline(part, colors[side], 3, false, .35);
  for (const side of available) {
    const selected = sources[side].preview.geometry.map(part => clipPart(part, sources[side].start, sources[side].end));
    for (const part of selected) {
      polyline(part, '#fff', side === 'first' ? 10 : 8);
      polyline(part, colors[side], side === 'first' ? 6 : 5, side === 'second');
    }
    for (const [kind, label] of [['start', 'D'], ['end', 'F']]) {
      const marker = coordinateAt(sources[side].preview.geometry, sources[side][kind],
        kind === 'end' && sources[side].end === sources[side].total);
      if (!marker) continue;
      const [x, y] = pixels(marker);
      svg.append(svgNode('circle', {cx: x, cy: y, r: 11, fill: '#fff', stroke: colors[side], 'stroke-width': 3}));
      const text = svgNode('text', {x, y: y + 4, 'text-anchor': 'middle', fill: colors[side],
        'font-size': 11, 'font-weight': 800});
      text.textContent = label + (side === 'first' ? '1' : '2'); svg.append(text);
    }
    const key = node('span', 'map-legend-item');
    const swatch = node('i', 'map-legend-swatch');
    swatch.style.backgroundColor = colors[side];
    if (side === 'second') swatch.style.backgroundImage = 'repeating-linear-gradient(90deg, transparent 0 8px, #fff 8px 12px)';
    key.append(swatch, document.createTextNode(sources[side].name)); legend.append(key);
  }
  const north = svgNode('text', {x: width - 44, y: 32, fill: '#405b46', 'font-size': 18, 'font-weight': 800});
  north.textContent = 'N ↑'; svg.append(north);
  const scaleBar = Math.min(100 * scale, width / 3);
  svg.append(svgNode('line', {x1: 25, y1: height - 30, x2: 25 + scaleBar, y2: height - 30,
    stroke: '#344d3b', 'stroke-width': 4}));
  const scaleLabel = svgNode('text', {x: 25, y: height - 37, fill: '#344d3b', 'font-size': 12});
  scaleLabel.textContent = Math.round(scaleBar / scale) + ' m'; svg.append(scaleLabel);
  host.append(svg);
}

function tableRow(body, title, a, b, delta = '—') {
  const row = node('tr');
  for (const value of [title, a, b, delta]) row.append(node('td', '', value));
  body.append(row);
}
function placePeakLabel(preferredX, preferredY, boxWidth, boxHeight, previous, left, right, top, bottom) {
  const intersects = (x, y, box) => x < box.x + box.width + 7 &&
    x + boxWidth + 7 > box.x && y < box.y + box.height + 7 &&
    y + boxHeight + 7 > box.y;
  const inBounds = (x, y) => x >= left && x + boxWidth <= right &&
    y >= top && y + boxHeight <= bottom;
  const positions = [[preferredX, preferredY]];
  for (const box of previous) {
    positions.push([box.x + box.width + 8, preferredY], [box.x - boxWidth - 8, preferredY],
      [preferredX, box.y + box.height + 8], [preferredX, box.y - boxHeight - 8]);
  }
  const candidate = positions.filter(([x, y]) => inBounds(x, y) &&
    previous.every(box => !intersects(x, y, box)))
    .sort((a, b) => Math.hypot(a[0] - preferredX, a[1] - preferredY) -
      Math.hypot(b[0] - preferredX, b[1] - preferredY))[0];
  const [x, y] = candidate || [preferredX, preferredY];
  const placed = {x, y, width: boxWidth, height: boxHeight};
  previous.push(placed);
  return placed;
}
function renderHeartRateChart(first, second, minimum) {
  const host = document.querySelector('#compare-hr-chart');
  host.replaceChildren();
  const overlay = chartModes.hr === 'overlay';
  document.querySelector('#hr-chart-method').textContent = overlay
    ? 'Superposition sur une seule échelle de FC réelle en bpm : bleu et orange au même niveau pour une même FC. Les moyennes et maxima restent indiqués ; les lacunes ne sont pas reliées.'
    : 'L’axe vertical indique la FC réelle en bpm des deux côtés du minimum commun : bleu au-dessus, orange en miroir en dessous. Chaque trait fin pointillé indique la FC moyenne ; le point rouge fléché situe la FC maximale de chaque trace. Les interruptions restent visibles.';
  const series = [first.hr_series, second.hr_series];
  const present = series.map(data => data?.minimum_bpm != null);
  if (!present.some(Boolean)) {
    host.append(node('p', 'chart-empty', 'Aucune fréquence cardiaque exploitable dans les portions sélectionnées.'));
    return;
  }
  const colors = ['#176bc8', '#e26b17'];
  const maxima = series.map(data => {
    let maximum = null;
    for (const run of data.segments) for (const [, hr] of run)
      maximum = maximum === null ? hr : Math.max(maximum, hr);
    for (const [, hr] of data.isolated)
      maximum = maximum === null ? hr : Math.max(maximum, hr);
    return maximum;
  });
  const maximum = Math.max(minimum, ...maxima.filter(value => value !== null));
  const amplitude = Math.max(10, Math.ceil((maximum - minimum) / 10) * 10);
  const info = node('div', 'hr-chart-info');
  info.append(node('strong', '', 'Minimum commun : ' + measurement(minimum, 'bpm')));
  for (let i = 0; i < 2; i++) {
    const item = node('span', 'hr-chart-key');
    item.style.color = colors[i];
    item.textContent = (i === 0 ? '● Trace 1 · ' : '● Trace 2 · ') +
      (present[i] ? 'FC réelle : ' + measurement(series[i].minimum_bpm, 'bpm') +
        ' – ' + measurement(maxima[i], 'bpm')
        : 'FC absente');
    info.append(item);
  }
  host.append(info);
  const width = 1000, height = 440, left = 105, right = 28, top = 30, bottom = 57;
  const middle = (height - bottom + top) / 2;
  const half = middle - top;
  const plotBottom = height - bottom;
  const low = Math.max(0, Math.floor((minimum - 5) / 10) * 10);
  const high = Math.ceil((maximum + 5) / 10) * 10;
  const xMin = Math.min(first.start_m, second.start_m);
  const xMax = Math.max(first.end_m, second.end_m);
  const x = distance => left + (distance - xMin) / (xMax - xMin) * (width - left - right);
  const y = (hr, index) => overlay
    ? plotBottom - (hr - low) / (high - low) * (plotBottom - top)
    : middle + (index === 0 ? -1 : 1) * (hr - minimum) / amplitude * half;
  const meanHeights = [first, second].map((result, index) =>
    result.metrics.hr.average == null ? null : y(result.metrics.hr.average, index));
  const svg = svgNode('svg', {viewBox: '0 0 1000 440', role: 'img',
    'aria-label': overlay ? 'Fréquence cardiaque réelle en bpm, deux traces superposées sur un axe commun, kilomètres GPX absolus'
      : 'Fréquence cardiaque réelle en bpm, miroir autour de ' +
        measurement(minimum, 'bpm') + ' : trace 1 bleue au-dessus, trace 2 orange en dessous ; axe horizontal en kilomètres GPX absolus'});
  const label = (value, px, py, attrs = {}) => {
    const text = svgNode('text', {x: px, y: py, ...attrs});
    text.textContent = value;
    svg.append(text);
  };
  for (let step = 0; step <= 4; step++) {
    const position = x(xMin + (xMax - xMin) * step / 4);
    svg.append(svgNode('line', {x1: position, x2: position, y1: top, y2: height - bottom,
      class: 'hr-chart-grid'}));
    label(compareKm.format((xMin + (xMax - xMin) * step / 4) / 1000), position,
      height - bottom + 22, {'text-anchor': 'middle', class: 'hr-chart-tick'});
  }
  for (let step = -2; step <= 2; step++) {
    const position = overlay ? top + (step + 2) / 4 * (plotBottom - top) : middle - step / 2 * half;
    svg.append(svgNode('line', {x1: left, x2: width - right, y1: position, y2: position,
      class: !overlay && step === 0 ? 'hr-chart-zero' : 'hr-chart-grid'}));
    // Give the average its own ordinate rather than overlapping a nearby tick.
    if ((!overlay && step === 0) || meanHeights.every(height => height == null || Math.abs(height - position) > 15))
      label(measurement(overlay ? high - (step + 2) / 4 * (high - low)
        : minimum + Math.abs(step / 2 * amplitude), 'bpm'),
        left - 13, position + 5, {'text-anchor': 'end',
          class: 'hr-chart-tick hr-chart-bpm' + (overlay ? '' : step > 0 ? ' hr-chart-bpm-first' :
            step < 0 ? ' hr-chart-bpm-second' : '')});
  }
  label('Distance depuis le départ du GPX (km)', (left + width - right) / 2, height - 7,
    {'text-anchor': 'middle', class: 'hr-chart-axis-title'});
  label('FC réelle (bpm)' + (overlay ? '' : ' · miroir'), 17, middle,
    {transform: 'rotate(-90 17 ' + middle + ')', 'text-anchor': 'middle', class: 'hr-chart-axis-title'});
  for (let index = 0; index < 2; index++) {
    const average = [first, second][index].metrics.hr.average;
    if (average == null) continue;
    const position = meanHeights[index];
    svg.append(svgNode('line', {x1: x([first, second][index].start_m),
      x2: x([first, second][index].end_m), y1: position, y2: position,
      stroke: colors[index], class: 'hr-chart-average', 'data-trace': index + 1}));
  }
  for (let index = 0; index < 2; index++) {
    if (!present[index]) continue;
    for (const run of series[index].segments) {
      if (!run.length) continue;
      const coordinates = run.map(([distance, hr]) => x(distance).toFixed(2) + ',' + y(hr, index).toFixed(2));
      svg.append(svgNode('polyline', {points: coordinates.join(' '), fill: 'none', stroke: colors[index],
        'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        class: 'hr-chart-series', 'data-trace': index + 1}));
    }
    for (const [distance, hr] of series[index].isolated) {
      const dot = svgNode('circle', {cx: x(distance), cy: y(hr, index), r: 3.5,
        fill: colors[index], class: 'hr-chart-isolated', 'data-trace': index + 1});
      const title = svgNode('title', {});
      title.textContent = 'Trace ' + (index + 1) + ' : ' + measurement(hr, 'bpm') +
        ' au km ' + compareKm.format(distance / 1000);
      dot.append(title); svg.append(dot);
    }
  }
  const placedPeakBoxes = [];
  for (let index = 0; index < 2; index++) {
    const peak = series[index].maximum_point;
    if (!peak) continue;
    const px = x(peak.distance_m), py = y(peak.bpm, index);
    const boxWidth = 91, boxHeight = 22;
    const preferredBoxX = overlay
      ? (index === 0 ? px - boxWidth - 15 : px + 15)
      : px - boxWidth / 2;
    const preferredX = Math.max(left, Math.min(preferredBoxX, width - right - boxWidth));
    const outward = index === 0 ? -1 : 1;
    const direction = (outward < 0 && py - top < 39) ||
      (outward > 0 && plotBottom - py < 39) ? -outward : outward;
    const preferredY = direction < 0 ? py - 37 : py + 15;
    const {x: boxX, y: boxY} = placePeakLabel(preferredX, preferredY, boxWidth, boxHeight,
      placedPeakBoxes, left, width - right, top, plotBottom);
    const leaderX = Math.max(boxX + 10, Math.min(px, boxX + boxWidth - 10));
    const leaderY = boxY + boxHeight <= py ? boxY + boxHeight : boxY;
    svg.append(svgNode('line', {x1: leaderX, y1: leaderY, x2: px, y2: py,
      class: 'hr-chart-peak-arrow', 'data-trace': index + 1}));
    const arrowAngle = Math.atan2(py - leaderY, px - leaderX);
    const wing = 5;
    svg.append(svgNode('polygon', {
      points: [[px, py],
        [px - 8 * Math.cos(arrowAngle) + wing * Math.sin(arrowAngle),
          py - 8 * Math.sin(arrowAngle) - wing * Math.cos(arrowAngle)],
        [px - 8 * Math.cos(arrowAngle) - wing * Math.sin(arrowAngle),
          py - 8 * Math.sin(arrowAngle) + wing * Math.cos(arrowAngle)]]
        .map(point => point.map(value => value.toFixed(2)).join(',')).join(' '),
      class: 'hr-chart-peak-arrowhead', 'data-trace': index + 1}));
    svg.append(svgNode('rect', {x: boxX, y: boxY, width: boxWidth, height: boxHeight,
      rx: 5, class: 'hr-chart-peak-box', 'data-trace': index + 1}));
    label('Max ' + measurement(peak.bpm, 'bpm'), boxX + boxWidth / 2, boxY + 15,
      {'text-anchor': 'middle', class: 'hr-chart-peak-label', 'data-trace': index + 1});
    svg.append(svgNode('circle', {cx: px, cy: py, r: 5, class: 'hr-chart-peak-dot',
      'data-trace': index + 1}));
  }
  for (let index = 0; index < 2; index++) {
    const average = [first, second][index].metrics.hr.average;
    if (average == null) continue;
    const position = meanHeights[index];
    const text = 'Moy. ' + measurement(average, 'bpm');
    svg.append(svgNode('rect', {x: overlay && index === 1 ? width - right - 94 : 27,
      y: position - 12, width: left - 34, height: 19,
      rx: 4, fill: '#f7f8fb', class: 'hr-chart-average-backdrop'}));
    label(text, overlay && index === 1 ? width - right - 11 : left - 11, position + 2,
      {'text-anchor': 'end',
      fill: colors[index], class: 'hr-chart-average-label', 'data-trace': index + 1});
  }
  host.append(svg);
  for (let i = 0; i < 2; i++) if (!present[i]) host.append(node('p', 'chart-empty',
    'Trace ' + (i + 1) + ' : aucune mesure FC exploitable sur ce segment.'));
}
function renderPaceChart(first, second, slowest) {
  const host = document.querySelector('#compare-pace-chart');
  host.replaceChildren();
  const overlay = chartModes.pace === 'overlay';
  const speedMode = paceUnit === 'speed';
  const unit = speedMode ? 'km/h' : 'min/km';
  const value = pace => speedMode ? speedFromPace(pace) : pace;
  const format = pace => speedMode ? speedText(speedFromPace(pace)) : paceText(pace);
  const formatValue = speedMode ? speedText : paceText;
  document.querySelector('#pace-chart-eyebrow').textContent = speedMode ? 'VITESSE LOCALE' : 'ALLURE LOCALE';
  document.querySelector('#pace-chart-title').textContent =
    (speedMode ? 'Vitesse' : 'Allure') + ' des portions sélectionnées';
  document.querySelector('#pace-chart-subtitle').textContent = 'Fenêtre mobile de 100 m · ' + unit;
  document.querySelector('#pace-chart-method').textContent = speedMode
    ? (overlay
      ? 'Vitesse locale en km/h sur une échelle commune : plus haut = plus rapide.'
      : 'Vitesse locale en km/h en miroir autour de la vitesse la plus basse : plus loin de l’axe central = plus rapide.') +
      ' Vitesse = 3 600 ÷ allure en secondes par km. La moyenne en mouvement est distance ÷ temps en mouvement, et peut différer du tableau (chrono écoulé). Le point rouge indique la vitesse locale maximale. Les fenêtres de 100 m ne traversent ni arrêt ni interruption ; les lacunes restent visibles.'
    : overlay
      ? 'Superposition sur une seule échelle d’allure réelle en min/km : les petites valeurs (plus rapides) sont en bas, les grandes (plus lentes) en haut. Le trait pointillé indique la moyenne en mouvement, distincte de l’allure au chrono écoulé du tableau. Les interruptions restent visibles.'
      : 'Axe horizontal : kilomètres depuis le départ de chaque GPX. Axe vertical : allure réelle en min/km, miroir autour de l’allure locale la plus rapide des deux traces. La plus petite valeur est sur l’axe central ; les allures plus lentes s’en écartent vers le haut en bleu et vers le bas en orange. La moyenne en mouvement (trait pointillé) exclut les pauses et peut différer de l’allure du tableau calculée sur le chrono écoulé. Le point rouge indique la meilleure allure locale valide. Près d’une pause, la fenêtre complète de 100 m se décale dans le tronçon valide sans traverser l’arrêt ; les reprises de moins de 100 m restent absentes.';
  const tracks = [first, second];
  const series = tracks.map(track => track.pace_series);
  const present = series.map(data => data?.fastest_point != null);
  if (!present.some(Boolean)) {
    host.append(node('p', 'chart-empty', 'Aucune fenêtre d’au moins 50 m en mouvement exploitable sur les deux portions.'));
    return;
  }
  const colors = ['#176bc8', '#e26b17'];
  const fastest = Math.min(...series.filter(data => data.fastest_point != null)
    .map(data => data.fastest_point.pace_s_per_km));
  const means = series.filter(data => data.average_s_per_km > 0)
    .map(data => data.average_s_per_km);
  const center = speedMode ? value(slowest) : fastest;
  const highest = speedMode ? Math.max(value(fastest), ...means.map(value)) : slowest;
  const amplitude = speedMode
    ? Math.max(0.5, Math.ceil((highest - center) * 2) / 2)
    : Math.max(30, Math.ceil(Math.max(slowest - fastest,
      ...means.map(pace => Math.abs(slowest - pace))) / 30) * 30);
  const info = node('div', 'hr-chart-info');
  info.append(node('strong', '', (speedMode ? 'Vitesse la plus basse : ' :
    overlay ? 'Allure la plus lente : ' : 'Allure la plus rapide : ') +
    format(speedMode || overlay ? slowest : fastest) + ' ' + unit));
  for (let i = 0; i < 2; i++) {
    const item = node('span', 'hr-chart-key'); item.style.color = colors[i];
    item.textContent = '● Trace ' + (i + 1) + ' · ' + (present[i]
      ? 'moyenne en mouvement : ' + format(series[i].average_s_per_km) + ' ' + unit
      : 'aucune allure locale exploitable');
    info.append(item);
  }
  host.append(info);
  const width = 1000, height = 440, left = 115, right = 28, top = 30, bottom = 57;
  const middle = (height - bottom + top) / 2, half = middle - top;
  const plotBottom = height - bottom;
  const low = speedMode
    ? Math.max(0, Math.floor((center - 0.25) * 2) / 2)
    : Math.max(0, Math.floor((Math.min(fastest, ...means) - 15) / 30) * 30);
  const high = speedMode
    ? Math.ceil((highest + 0.25) * 2) / 2
    : Math.ceil((Math.max(slowest, ...means) + 15) / 30) * 30;
  const xMin = Math.min(first.start_m, second.start_m);
  const xMax = Math.max(first.end_m, second.end_m);
  const x = distance => left + (distance - xMin) / (xMax - xMin) * (width - left - right);
  const y = (pace, index) => overlay
    ? (speedMode ? plotBottom - (value(pace) - low) / (high - low) * (plotBottom - top)
      : plotBottom - (pace - low) / (high - low) * (plotBottom - top))
    : middle + (index === 0 ? -1 : 1) *
      (speedMode ? value(pace) - center : pace - center) / amplitude * half;
  const svg = svgNode('svg', {viewBox: '0 0 1000 440', role: 'img',
    'aria-label': overlay ? (speedMode ? 'Vitesses locales en km/h' : 'Allures locales en min/km') +
      (speedMode ? ' superposées sur une échelle commune, plus haut signifie plus rapide'
        : ' superposées sur une échelle commune, petite valeur en bas et grande valeur en haut')
      : (speedMode ? 'Vitesse locale réelle en km/h, miroir autour de ' + format(slowest) :
        'Allure locale réelle en min/km, miroir autour du minimum ' + format(fastest)) +
        ' : trace 1 bleue au-dessus et trace 2 orange en dessous, fenêtres mobiles de 100 m'});
  const label = (value, px, py, attrs = {}) => {
    const element = svgNode('text', {x: px, y: py, ...attrs});
    element.textContent = value; svg.append(element);
  };
  for (let step = 0; step <= 4; step++) {
    const position = x(xMin + (xMax - xMin) * step / 4);
    svg.append(svgNode('line', {x1: position, x2: position, y1: top, y2: height - bottom,
      class: 'hr-chart-grid'}));
    label(compareKm.format((xMin + (xMax - xMin) * step / 4) / 1000), position,
      height - bottom + 22, {'text-anchor': 'middle', class: 'hr-chart-tick'});
  }
  const meanHeights = tracks.map((track, index) => present[index]
    ? y(series[index].average_s_per_km, index) : null);
  for (let step = -2; step <= 2; step++) {
    const position = overlay ? top + (step + 2) / 4 * (plotBottom - top) : middle - step / 2 * half;
    svg.append(svgNode('line', {x1: left, x2: width - right, y1: position, y2: position,
      class: !overlay && step === 0 ? 'hr-chart-zero' : 'hr-chart-grid'}));
    if ((!overlay && step === 0) || meanHeights.every(height => height == null || Math.abs(height - position) > 16))
      label(formatValue(overlay ? high - (step + 2) / 4 * (high - low)
        : speedMode ? center + Math.abs(step / 2 * amplitude)
          : center + Math.abs(step / 2 * amplitude)), left - 12, position + 5,
      {'text-anchor': 'end', class: 'hr-chart-tick hr-chart-bpm' + (overlay ? '' : step > 0
        ? ' hr-chart-bpm-first' : step < 0 ? ' hr-chart-bpm-second' : '')});
  }
  label('Distance depuis le départ du GPX (km)', (left + width - right) / 2,
    height - 7, {'text-anchor': 'middle', class: 'hr-chart-axis-title'});
  label((speedMode ? 'Vitesse réelle (km/h)' : 'Allure réelle (min/km)') +
    (overlay ? '' : ' · miroir'), 17, middle,
    {transform: 'rotate(-90 17 ' + middle + ')', 'text-anchor': 'middle', class: 'hr-chart-axis-title'});
  const placedPeakBoxes = [];
  for (let index = 0; index < 2; index++) {
    if (!present[index]) continue;
    const average = series[index].average_s_per_km;
    svg.append(svgNode('line', {x1: x(tracks[index].start_m), x2: x(tracks[index].end_m),
      y1: meanHeights[index], y2: meanHeights[index], stroke: colors[index],
      class: 'hr-chart-average', 'data-trace': index + 1}));
    for (const run of series[index].segments) {
      svg.append(svgNode('polyline', {points: run.map(([distance, pace]) =>
        x(distance).toFixed(2) + ',' + y(pace, index).toFixed(2)).join(' '),
        fill: 'none', stroke: colors[index], 'stroke-width': 3.5,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        class: 'pace-chart-series', 'data-trace': index + 1}));
    }
    const peak = series[index].fastest_point;
    const px = x(peak.distance_m), py = y(peak.pace_s_per_km, index);
    const boxWidth = 104, boxHeight = 22;
    const preferredBoxX = overlay
      ? (index === 0 ? px - boxWidth - 15 : px + 15)
      : px - boxWidth / 2;
    const preferredX = Math.max(left, Math.min(preferredBoxX, width - right - boxWidth));
    const outward = index === 0 ? -1 : 1;
    const direction = (outward < 0 && py - top < 39) ||
      (outward > 0 && plotBottom - py < 39) ? -outward : outward;
    const preferredY = direction < 0 ? py - 37 : py + 15;
    const {x: boxX, y: boxY} = placePeakLabel(preferredX, preferredY, boxWidth, boxHeight,
      placedPeakBoxes, left, width - right, top, plotBottom);
    const leaderX = Math.max(boxX + 10, Math.min(px, boxX + boxWidth - 10));
    const leaderY = boxY + boxHeight <= py ? boxY + boxHeight : boxY;
    svg.append(svgNode('line', {x1: leaderX, y1: leaderY, x2: px, y2: py,
      class: 'hr-chart-peak-arrow', 'data-trace': index + 1}));
    const angle = Math.atan2(py - leaderY, px - leaderX);
    svg.append(svgNode('polygon', {points: [[px, py],
      [px - 8 * Math.cos(angle) + 5 * Math.sin(angle), py - 8 * Math.sin(angle) - 5 * Math.cos(angle)],
      [px - 8 * Math.cos(angle) - 5 * Math.sin(angle), py - 8 * Math.sin(angle) + 5 * Math.cos(angle)]]
      .map(point => point.map(value => value.toFixed(2)).join(',')).join(' '),
    class: 'hr-chart-peak-arrowhead', 'data-trace': index + 1}));
    svg.append(svgNode('rect', {x: boxX, y: boxY, width: boxWidth, height: boxHeight,
      rx: 5, class: 'hr-chart-peak-box', 'data-trace': index + 1}));
    label((speedMode ? 'Max ' : 'Min ') + format(peak.pace_s_per_km),
      boxX + boxWidth / 2, boxY + 15,
      {'text-anchor': 'middle', class: 'hr-chart-peak-label', 'data-trace': index + 1});
    svg.append(svgNode('circle', {cx: px, cy: py, r: 5, class: 'hr-chart-peak-dot',
      'data-trace': index + 1}));
    svg.append(svgNode('rect', {x: overlay && index === 1 ? width - right - 96 : 26,
      y: meanHeights[index] - 12, width: left - 33,
      height: 19, rx: 4, fill: '#f7f8fb', class: 'hr-chart-average-backdrop'}));
    label('Moy. ' + format(average), overlay && index === 1 ? width - right - 11 : left - 11,
      meanHeights[index] + 2,
      {'text-anchor': 'end', fill: colors[index], class: 'hr-chart-average-label',
        'data-trace': index + 1});
  }
  host.append(svg);
  for (let i = 0; i < 2; i++) if (!present[i]) host.append(node('p', 'chart-empty',
    'Trace ' + (i + 1) + ' : aucune fenêtre de 50 m en mouvement exploitable.'));
  const freezes = series.map(data => data.gps_freeze_s || 0);
  if (freezes.some(Boolean)) host.append(node('p', 'footnote',
    'Gel GPS court intégré à la fenêtre d’allure si cadence et puissance restent positives ' +
    '(trace 1 : ' + timeText(freezes[0]) + ' ; trace 2 : ' + timeText(freezes[1]) +
    '). Le temps est conservé ; les longs gels et les arrêts sans effort restent séparés.'));
}
function showResults(payload) {
  const a = payload.reference, b = payload.challenger;
  document.querySelector('#compare-subtitle').textContent = 'Segments choisis librement · chrono écoulé';
  const heading = document.querySelector('#compare-verdict'); heading.replaceChildren();
  heading.append(node('span', 'step', 'COMPARAISON AVEC RÉSERVE'),
    node('h3', '', 'Écart de chrono : ' + (payload.delta_s >= 0 ? '+' : '−') + timeText(Math.abs(payload.delta_s))),
    node('p', '', compareKm.format(a.distance_km) + ' km en ' + timeText(a.duration_s) +
      ' contre ' + compareKm.format(b.distance_km) + ' km en ' + timeText(b.duration_s) +
      '. Les portions peuvent différer en longueur et en parcours : pas de verdict de vitesse.'));
  document.querySelector('#reference-title').textContent = sources.first.name;
  document.querySelector('#challenger-title').textContent = sources.second.name;
  const body = document.querySelector('#compare-table tbody'); body.replaceChildren();
  tableRow(body, 'Bornes GPS', compareKm.format(a.start_m / 1000) + '–' + compareKm.format(a.end_m / 1000) + ' km',
    compareKm.format(b.start_m / 1000) + '–' + compareKm.format(b.end_m / 1000) + ' km');
  tableRow(body, 'Chrono écoulé', timeText(a.duration_s), timeText(b.duration_s),
    (payload.delta_s >= 0 ? '+' : '−') + timeText(Math.abs(payload.delta_s)));
  tableRow(body, 'Distance parcourue', measurement(a.distance_km, 'km'), measurement(b.distance_km, 'km'),
    difference(a.distance_km * 1000, b.distance_km * 1000, 'm'));
  tableRow(body, 'Allure', timeText(a.pace_s_per_km) + '/km', timeText(b.pace_s_per_km) + '/km',
    (b.pace_s_per_km - a.pace_s_per_km >= 0 ? '+' : '−') +
    timeText(Math.abs(b.pace_s_per_km - a.pace_s_per_km)) + '/km');
  for (const [metric, label, unit, type] of [['hr', 'FC moyenne', 'bpm', 'average'],
    ['hr', 'FC maximale', 'bpm', 'maximum'], ['cadence', 'Cadence positive moyenne (estimée)', 'pas/min', 'average'],
    ['power', 'Puissance moyenne', 'W', 'average']]) {
    const v1 = a.metrics[metric][type], v2 = b.metrics[metric][type];
    tableRow(body, label, measurement(v1, unit), measurement(v2, unit), difference(v1, v2, unit));
  }
  for (const [key, label] of [['elevation_gain_m', 'D+ brut'], ['elevation_loss_m', 'D− brut']])
    tableRow(body, label, measurement(a[key], 'm'), measurement(b[key], 'm'), difference(a[key], b[key], 'm'));
  for (const [key, label] of [['hr', 'Couverture FC'], ['power', 'Couverture puissance'],
    ['cadence', 'Couverture cadence positive']])
    tableRow(body, label, timeText(a.metrics[key].covered_s), timeText(b.metrics[key].covered_s));
  const notes = document.querySelector('#compare-warnings'); notes.replaceChildren();
  for (const warning of payload.warnings) notes.append(node('p', '', 'ⓘ ' + warning));
  notes.append(node('p', '', 'ⓘ Départs séparés de ' + measurement(payload.start_separation_m, 'm') +
    ' ; arrivées séparées de ' + measurement(payload.finish_separation_m, 'm') +
    ' ; écart de longueur ' + measurement(Math.abs(payload.distance_delta_m), 'm') + '.'));
  if (a.metrics.power.average == null || b.metrics.power.average == null)
    notes.append(node('p', '', 'ⓘ Puissance absente d’une trace : aucun écart de puissance calculé.'));
  if (a.elevation_gain_m == null || b.elevation_gain_m == null)
    notes.append(node('p', '', 'ⓘ Altitude absente d’une trace : D+/D− non disponibles pour cette sélection.'));
  renderHeartRateChart(a, b, payload.hr_common_min_bpm);
  renderPaceChart(a, b, payload.pace_common_slowest_s_per_km);
  chartPayload = payload;
  compareResult.hidden = false;
  compareResult.scrollIntoView({behavior: 'smooth', block: 'start'});
}

compareForm.addEventListener('submit', async event => {
  event.preventDefault();
  invalidate();
  if (!sources.first || !sources.second) {
    setStatus('Deux activités GPX horodatées sont nécessaires.', true); return;
  }
  const button = document.querySelector('#compare-submit');
  button.disabled = true; setStatus('Calcul des segments en cours…');
  const version = selectionVersion;
  const params = new FormData();
  for (const [side, key] of [['first', 'reference_file'], ['second', 'challenger_file']]) {
    const source = sources[side];
    if (source.origin === 'upload') params.append(key, compareForm.elements.namedItem(key).files[0]);
    else params.append(key + '_default', side);
  }
  for (const side of ['first', 'second']) {
    params.append(side + '_start_m', String(sources[side].start));
    params.append(side + '_end_m', String(sources[side].end));
  }
  params.append('cadence_first', compareForm.elements.namedItem('cadence_first').value);
  params.append('cadence_second', compareForm.elements.namedItem('cadence_second').value);
  try {
    const response = await fetch('/api/compare', {method: 'POST', body: params});
    const payload = await response.json();
    if (selectionVersion !== version) return;
    if (!response.ok) throw new Error(payload.error || 'Calcul impossible.');
    setStatus(''); showResults(payload);
  } catch (error) {
    if (selectionVersion === version) setStatus(error.message || 'Le serveur local ne répond pas.', true);
  }
  finally { button.disabled = !sources.first || !sources.second; }
});
for (const name of ['cadence_first', 'cadence_second'])
  compareForm.elements.namedItem(name).addEventListener('change', invalidate);
