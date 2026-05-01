'use strict';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

// ─── Grade mappings ───────────────────────────────────────────────────────────
const GRADE_POINTS = { HD: 7, D: 6, C: 5, P: 4, UP: 4, F: 0, WF: 0 };
const GRADE_EXCLUDE = new Set(['WD', 'SY', 'US', 'AW', 'NR', 'NA', 'W', 'WN']);
const GRADE_COLOR = { HD: '--hd', D: '--d', C: '--c', P: '--p', F: '--f', WF: '--f' };

// ─── GPA mark midpoints for simulation WAM ────────────────────────────────────
const GRADE_MARK_MID = { 7: 92.5, 6: 79.5, 5: 69.5, 4: 57.0, 0: 30.0 };

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const dropZone    = document.getElementById('drop-zone');
const fileInput   = document.getElementById('file-input');
const uploadError = document.getElementById('upload-error');
const uploadSec   = document.getElementById('upload-section');
const resultsSec  = document.getElementById('results-section');

// ─── Drag & drop ─────────────────────────────────────────────────────────────
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
document.getElementById('reset-btn').addEventListener('click', reset);

// ─── Simulation inputs ────────────────────────────────────────────────────────
['sim-units', 'sim-grade', 'sim-mark', 'target-gpa'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateSimulation);
});

// ─── File handling ────────────────────────────────────────────────────────────
async function handleFile(file) {
  if (file.type !== 'application/pdf') { showError('Please upload a PDF file.'); return; }
  showError('');
  try {
    const buffer = await file.arrayBuffer();
    const courses = await parsePDF(buffer);
    if (!courses.length) { showError('No graded courses found. Make sure this is a University of Newcastle transcript.'); return; }
    render(courses);
  } catch (err) {
    console.error(err);
    showError('Could not read PDF. ' + err.message);
  }
}

// ─── PDF parsing ─────────────────────────────────────────────────────────────
async function parsePDF(buffer) {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const lines = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter(i => i.str.trim());

    // Group by Y coordinate (tolerance 3pt)
    const rows = [];
    for (const item of items) {
      const y = Math.round(item.transform[5]);
      const x = Math.round(item.transform[4]);
      let row = rows.find(r => Math.abs(r.y - y) <= 3);
      if (!row) { row = { y, cells: [] }; rows.push(row); }
      row.cells.push({ x, str: item.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y); // top to bottom
    rows.forEach(r => {
      r.cells.sort((a, b) => a.x - b.x);
      lines.push(r.cells.map(c => c.str).join(' '));
    });
  }

  return extractCourses(lines);
}

// ─── Course extraction ────────────────────────────────────────────────────────
function extractCourses(lines) {
  const courses = [];
  let currentTerm = '';
  let currentProgram = '';
  let skipProgram = false;

  // Patterns
  const termRe    = /Trimester\s+(\d)\s*[-–]\s*(\d{4})/i;
  const programRe = /^Program\s*[:\-]?\s*(.+)/i;
  // Course row: CODE NNNN ... UNITS MARK GRADE [EARNED]
  // e.g. "MECH 3400 Materials Science 10 83 P 10"
  const courseRe  = /^([A-Z]{2,5})\s+(\d{3,5}[A-Z]?)\s+(.+?)\s+(\d{1,3})\s+(\d{1,3})\s+(HD|D|C|P|UP|F|WF|WD|SY|US|AW|W)\b/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const termMatch = termRe.exec(line);
    if (termMatch) {
      currentTerm = `T${termMatch[1]} ${termMatch[2]}`;
      continue;
    }

    const progMatch = programRe.exec(line);
    if (progMatch) {
      currentProgram = progMatch[1].trim();
      skipProgram = /diploma|open\s+foundation|foundation\s+studies|cert/i.test(currentProgram);
      continue;
    }

    if (skipProgram) continue;

    const m = courseRe.exec(line);
    if (m) {
      const grade = m[6];
      if (GRADE_EXCLUDE.has(grade)) continue; // withdrawn etc — skip
      courses.push({
        term:    currentTerm,
        code:    m[1] + ' ' + m[2],
        name:    m[3].replace(/\s{2,}/g, ' ').trim(),
        units:   parseInt(m[4], 10),
        mark:    parseInt(m[5], 10),
        grade,
        program: currentProgram,
      });
    }
  }

  return courses;
}

// ─── Calculations ─────────────────────────────────────────────────────────────
function calculate(courses) {
  let gpaNum = 0, gpaDen = 0, wamNum = 0, wamDen = 0;
  const gradeCounts = {};

  for (const c of courses) {
    const pts = GRADE_POINTS[c.grade];
    if (pts === undefined) continue; // unrecognised grade

    gpaNum += pts * c.units;
    gpaDen += c.units;
    wamNum += c.mark * c.units;
    wamDen += c.units;

    gradeCounts[c.grade] = (gradeCounts[c.grade] || 0) + c.units;
  }

  return {
    gpa: gpaDen ? gpaNum / gpaDen : 0,
    wam: wamDen ? wamNum / wamDen : 0,
    units: gpaDen,
    gradeCounts,
  };
}

// ─── Render ───────────────────────────────────────────────────────────────────
let _courses = [];

function render(courses) {
  _courses = courses;
  const stats = calculate(courses);

  // Show unique program names (excluding excluded ones)
  const programs = [...new Set(courses.map(c => c.program))];
  document.getElementById('program-name').textContent = programs.join(' · ');

  document.getElementById('gpa-value').textContent  = stats.gpa.toFixed(2);
  document.getElementById('wam-value').textContent  = stats.wam.toFixed(1);
  document.getElementById('units-value').textContent = stats.units;

  renderGradeBar(stats.gradeCounts, stats.units);
  renderTable(courses);
  updateSimulation();

  uploadSec.classList.add('hidden');
  resultsSec.classList.remove('hidden');
}

function renderGradeBar(counts, total) {
  const bar = document.getElementById('grade-bar');
  const legend = document.getElementById('grade-legend');
  const order = ['HD', 'D', 'C', 'P', 'F', 'WF'];
  bar.innerHTML = '';
  legend.innerHTML = '';

  for (const g of order) {
    const units = counts[g] || 0;
    if (!units) continue;
    const pct = (units / total * 100).toFixed(1);
    const col = `var(${GRADE_COLOR[g] || '--muted'})`;
    const span = document.createElement('span');
    span.style.width = pct + '%';
    span.style.background = col;
    span.title = `${g}: ${units} units (${pct}%)`;
    bar.appendChild(span);

    const li = document.createElement('div');
    li.className = 'legend-item';
    li.innerHTML = `<span class="legend-dot" style="background:${col}"></span>${g} ${units}u`;
    legend.appendChild(li);
  }
}

function renderTable(courses) {
  const tbody = document.getElementById('course-tbody');
  tbody.innerHTML = '';
  for (const c of courses) {
    const tr = document.createElement('tr');
    const cls = c.grade === 'HD' ? 'grade-hd'
               : c.grade === 'D'  ? 'grade-d'
               : c.grade === 'C'  ? 'grade-c'
               : c.grade === 'P'  ? 'grade-p'
               : 'grade-f';
    tr.innerHTML = `
      <td>${c.term}</td>
      <td>${c.code}</td>
      <td>${c.name}</td>
      <td>${c.units}</td>
      <td>${c.mark}</td>
      <td class="${cls}">${c.grade}</td>`;
    tbody.appendChild(tr);
  }
}

// ─── Simulation ───────────────────────────────────────────────────────────────
function updateSimulation() {
  if (!_courses.length) return;

  const base  = calculate(_courses);
  const addU  = parseInt(document.getElementById('sim-units').value, 10) || 0;
  const addGP = parseInt(document.getElementById('sim-grade').value, 10);
  const addM  = parseFloat(document.getElementById('sim-mark').value) || 0;

  const projGPA = (base.gpa * base.units + addGP * addU) / (base.units + addU);
  const projWAM = (base.wam * base.units + addM  * addU) / (base.units + addU);

  document.getElementById('proj-gpa').textContent = projGPA.toFixed(2);
  document.getElementById('proj-wam').textContent = projWAM.toFixed(1);

  updateTarget(base);
}

function updateTarget(base) {
  const targetGPA = parseFloat(document.getElementById('target-gpa').value);
  const el = document.getElementById('target-results');
  if (isNaN(targetGPA) || targetGPA <= 0 || targetGPA > 7) { el.textContent = ''; return; }

  if (base.gpa >= targetGPA) {
    el.innerHTML = `<strong>You've already reached a ${targetGPA.toFixed(1)} GPA!</strong>`;
    return;
  }

  const gradeOptions = [
    { label: 'HDs', gp: 7, mark: 92.5 },
    { label: 'Ds',  gp: 6, mark: 79.5 },
    { label: 'Cs',  gp: 5, mark: 69.5 },
    { label: 'Ps',  gp: 4, mark: 57.0 },
  ];

  let html = '';
  for (const opt of gradeOptions) {
    if (opt.gp <= targetGPA) {
      // Getting this grade alone can't push GPA up to target (if target > opt.gp)
      if (opt.gp < targetGPA) continue;
    }
    // units needed: (targetGPA * (base.units + x) - base.gpa * base.units) / x = opt.gp
    // => targetGPA * base.units + targetGPA * x - base.gpa * base.units = opt.gp * x
    // => x(opt.gp - targetGPA) = base.gpa * base.units - targetGPA * base.units
    // => x = base.units * (targetGPA - base.gpa) / (opt.gp - targetGPA)
    const denom = opt.gp - targetGPA;
    if (denom <= 0) continue;
    const unitsNeeded = Math.ceil(base.units * (targetGPA - base.gpa) / denom);
    if (unitsNeeded < 0) continue;
    html += `<div>Need <strong>${unitsNeeded} units</strong> of ${opt.label} to reach GPA ${targetGPA.toFixed(1)}</div>`;
  }

  el.innerHTML = html || '<em>Not achievable with a single grade type — mix of grades required.</em>';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showError(msg) {
  uploadError.textContent = msg;
  uploadError.classList.toggle('hidden', !msg);
}

function reset() {
  _courses = [];
  fileInput.value = '';
  resultsSec.classList.add('hidden');
  uploadSec.classList.remove('hidden');
  showError('');
}
