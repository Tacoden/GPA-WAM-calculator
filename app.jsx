// Main app for GPA Calculator
const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ── Australian 7.0 GPA scale ─────────────────────────────────────────────
const GRADE_BANDS_AU = [
  { code: 'HD',  label: 'High Distinction', min: 85, max: 100, gpa: 7 },
  { code: 'D',   label: 'Distinction',      min: 75, max: 84,  gpa: 6 },
  { code: 'C',   label: 'Credit',           min: 65, max: 74,  gpa: 5 },
  { code: 'P',   label: 'Pass',             min: 50, max: 64,  gpa: 4 },
  { code: 'F',   label: 'Fail',             min: 0,  max: 49,  gpa: 1 },
];
const GRADE_BANDS_US = [
  { code: 'A',  label: 'A',  min: 93, max: 100, gpa: 4.0 },
  { code: 'A-', label: 'A-', min: 90, max: 92,  gpa: 3.7 },
  { code: 'B+', label: 'B+', min: 87, max: 89,  gpa: 3.3 },
  { code: 'B',  label: 'B',  min: 83, max: 86,  gpa: 3.0 },
  { code: 'B-', label: 'B-', min: 80, max: 82,  gpa: 2.7 },
  { code: 'C+', label: 'C+', min: 77, max: 79,  gpa: 2.3 },
  { code: 'C',  label: 'C',  min: 73, max: 76,  gpa: 2.0 },
  { code: 'C-', label: 'C-', min: 70, max: 72,  gpa: 1.7 },
  { code: 'D',  label: 'D',  min: 60, max: 69,  gpa: 1.0 },
  { code: 'F',  label: 'F',  min: 0,  max: 59,  gpa: 0.0 },
];
const GRADE_BANDS_UK = [
  { code: '1st',  label: 'First',         min: 70, max: 100, gpa: 7 },
  { code: '2:1',  label: 'Upper Second',  min: 60, max: 69,  gpa: 6 },
  { code: '2:2',  label: 'Lower Second',  min: 50, max: 59,  gpa: 5 },
  { code: '3rd',  label: 'Third',         min: 40, max: 49,  gpa: 4 },
  { code: 'F',    label: 'Fail',          min: 0,  max: 39,  gpa: 0 },
];
const SYSTEMS = {
  AU: { name: 'Australian', max: 7,   bands: GRADE_BANDS_AU },
  US: { name: 'US 4.0',     max: 4,   bands: GRADE_BANDS_US },
  UK: { name: 'UK class.',  max: 7,   bands: GRADE_BANDS_UK },
};
function markToBand(mark, sys) {
  return SYSTEMS[sys].bands.find(b => mark >= b.min && mark <= b.max) || SYSTEMS[sys].bands.at(-1);
}

// ── Calc helpers ─────────────────────────────────────────────────────────
function calcWam(units) {
  if (!units.length) return 0;
  const tw = units.reduce((s, u) => s + u.credits, 0);
  const wm = units.reduce((s, u) => s + u.mark * u.credits, 0);
  return wm / tw;
}
function calcGpa(units, sys) {
  if (!units.length) return 0;
  const tw = units.reduce((s, u) => s + u.credits, 0);
  const wg = units.reduce((s, u) => s + markToBand(u.mark, sys).gpa * u.credits, 0);
  return wg / tw;
}
function neededAvg(currentWam, doneCredits, targetWam, remainingCredits) {
  if (remainingCredits <= 0) return null;
  return (targetWam * (doneCredits + remainingCredits) - currentWam * doneCredits) / remainingCredits;
}
function neededGpa(currentGpa, doneCredits, targetGpa, remainingCredits) {
  if (remainingCredits <= 0) return null;
  return (targetGpa * (doneCredits + remainingCredits) - currentGpa * doneCredits) / remainingCredits;
}

const fmt2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
const fmt1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

// ── Transcript parser ────────────────────────────────────────────────────
// Extracts text from PDF using PDF.js, then walks line-by-line tracking the
// current program. Only courses inside non-foundation/non-diploma programs are kept.
const FOUNDATION_PATTERNS = [
  /open\s+foundation/i,
  /foundation\s+studies/i,
  /enabling\s+program/i,
  /preparation\s+program/i,
  /\bdiploma\b/i,
  /\bcertificate\b/i,
  /bridging/i,
  /pathway/i,
];
function isFoundationProgram(name) {
  return FOUNDATION_PATTERNS.some(p => p.test(name));
}

// Uses PDF.js (loaded globally) to extract text from the PDF, reconstructing
// rows by grouping text items with similar Y coordinates (±3pt tolerance).
async function extractPdfText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const pageLines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter(i => i.str && i.str.trim());
    const rows = [];
    for (const item of items) {
      const y = Math.round(item.transform[5]);
      const x = Math.round(item.transform[4]);
      let row = rows.find(r => Math.abs(r.y - y) <= 3);
      if (!row) { row = { y, cells: [] }; rows.push(row); }
      row.cells.push({ x, str: item.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const row of rows) {
      row.cells.sort((a, b) => a.x - b.x);
      pageLines.push(row.cells.map(c => c.str).join(' '));
    }
  }
  return pageLines.join('\n');
}

// Parse a UoN-style transcript text. Returns { degree, units }.
function parseTranscript(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let currentTerm = '';
  let currentProgram = '';
  let degree = '';
  const units = [];
  // course line example:
  // "EPHUMA 172 Reading, Writing and Critical Thinking 10 75 D 10"
  // "ACFI 1003 Introduction to Finance 10 65 C 10"
  // sometimes "Enrolled" replaces mark/grade — skip those
  // Format: <PREFIX letters> <NUMBER> <name...> <unitValue> <mark> <gradeCode> <unitsEarned>
  const courseRe = /^([A-Z]{2,5})\s+(\d{3,4})\s+(.+?)\s+(\d{1,3})\s+(\d{1,3})\s+([A-Z]{1,3})\s+(\d{1,3})$/;
  const enrolledRe = /^([A-Z]{2,5})\s+(\d{3,4})\s+(.+?)\s+(\d{1,3})\s+Enrolled$/i;
  const termRe = /^(Semester|Trimester|Term)\s+(\d|I+)\s*[-–]\s*(\d{4})/i;
  const programRe = /^Program:\s*(.+)$/i;

  for (const line of lines) {
    const tm = line.match(termRe);
    if (tm) { currentTerm = `${tm[3]} ${tm[1].slice(0,1).toUpperCase()}${tm[2]}`; continue; }
    const pm = line.match(programRe);
    if (pm) {
      currentProgram = pm[1].trim();
      // remember the first non-foundation program as "the degree"
      if (!isFoundationProgram(currentProgram) && !degree) degree = currentProgram;
      continue;
    }
    if (enrolledRe.test(line)) continue;
    const cm = line.match(courseRe);
    if (cm) {
      const [, prefix, num, name, , mark, gradeCode, earned] = cm;
      // Skip courses sitting under a foundation/diploma program.
      if (isFoundationProgram(currentProgram)) continue;
      const m = parseInt(mark, 10);
      const cr = parseInt(earned, 10);
      if (isNaN(m) || isNaN(cr)) continue;
      // Skip ungraded codes
      if (/^(UP|NA|I|S)$/i.test(gradeCode)) continue;
      units.push({
        sem: currentTerm,
        program: currentProgram,
        code: `${prefix}${num}`,
        title: name.trim(),
        credits: cr,
        mark: m,
        grade: gradeCode,
      });
    }
  }
  // If nothing got tagged as the degree but we have units, fall back to the
  // most common program among the kept units.
  if (!degree && units.length) {
    const counts = {};
    for (const u of units) counts[u.program] = (counts[u.program] || 0) + 1;
    degree = Object.entries(counts).sort((a,b) => b[1] - a[1])[0][0];
  }
  return { degree, units };
}

// ── Tweak defaults ───────────────────────────────────────────────────────
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "system": "AU",
  "tone": "online",
  "fakeWam": 0
}/*EDITMODE-END*/;

// ── App ──────────────────────────────────────────────────────────────────
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [units, setUnits] = useState([]);
  const [degree, setDegree] = useState('');
  const [hasTranscript, setHasTranscript] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseErr, setParseErr] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const sys = SYSTEMS[t.system];
  const wam = useMemo(() => calcWam(units), [units]);
  const gpa = useMemo(() => calcGpa(units, t.system), [units, t.system]);
  const totalCredits = useMemo(() => units.reduce((s, u) => s + u.credits, 0), [units]);
  const displayWam = wam + (t.fakeWam || 0);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setParsing(true);
    setParseErr('');
    try {
      let parsed;
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const text = await extractPdfText(file);
        parsed = parseTranscript(text);
      } else {
        // try as text
        const text = await file.text();
        parsed = parseTranscript(text);
      }
      if (!parsed.units.length) {
        setParseErr('Could not find any graded courses outside of foundation/diploma programs. Make sure this is a degree transcript.');
        setParsing(false);
        return;
      }
      // small artificial delay so the parsing animation doesn't flash
      await new Promise(r => setTimeout(r, 800));
      setUnits(parsed.units);
      setDegree(parsed.degree);
      setHasTranscript(true);
    } catch (e) {
      console.error(e);
      setParseErr('Could not parse this file. Try a different transcript PDF.');
    }
    setParsing(false);
  }, []);

  const reset = () => {
    setUnits([]); setDegree(''); setHasTranscript(false); setParseErr('');
  };

  return (
    <div className="page">
      <Header tone={t.tone} />
      {!hasTranscript ? (
        <DropZone onFile={handleFile} parsing={parsing} dragOver={dragOver}
          setDragOver={setDragOver} tone={t.tone} err={parseErr} />
      ) : (
        <Results
          units={units} degree={degree}
          wam={displayWam} gpa={gpa} totalCredits={totalCredits}
          sys={t.system} sysObj={sys} tone={t.tone} onReset={reset}
        />
      )}
      <Footer />
      <TweaksPanel title="Tweaks">
        <TweakSection label="Grading system" />
        <TweakRadio label="System" value={t.system}
          options={[{value:'AU',label:'AU'},{value:'US',label:'US'},{value:'UK',label:'UK'}]}
          onChange={(v) => setTweak('system', v)} />
        <TweakSection label="Copy tone" />
        <TweakRadio label="Tone" value={t.tone}
          options={[
            {value:'online',label:'Online'},
            {value:'dry',label:'Dry'},
            {value:'nice',label:'Nice'},
          ]}
          onChange={(v) => setTweak('tone', v)} />
        <TweakSection label="Cope" />
        <TweakSlider label="Manifestation™" value={t.fakeWam || 0} min={-10} max={10} step={0.5} unit="pts"
          onChange={(v) => setTweak('fakeWam', v)} />
      </TweaksPanel>
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────
function Header({ tone }) {
  const sub = {
    online: 'a no-nonsense calculator for the chronically online',
    dry:    'computes weighted academic performance from transcript data',
    nice:   'a kind, encouraging way to look at your hard work',
  }[tone];
  return (
    <header className="hdr">
      <div className="hdr-title">
        <h1>The Grade Point Average.</h1>
        <p className="hdr-sub">{sub}</p>
      </div>
    </header>
  );
}

// ── Drop zone ────────────────────────────────────────────────────────────
function DropZone({ onFile, parsing, dragOver, setDragOver, tone, err }) {
  const inputRef = useRef(null);
  const copy = {
    online: { kicker: 'STEP ONE → THE RECKONING', heading: 'Drop the PDF.\nFace the truth.', hint: 'transcript.pdf — parsed in your browser. nothing leaves your machine. probably for the best.' },
    dry:    { kicker: 'STEP ONE / UPLOAD', heading: 'Upload your transcript.', hint: 'PDF parsed locally. Foundation and diploma programs are excluded automatically.' },
    nice:   { kicker: 'STEP ONE — LET\'S BEGIN', heading: 'Drop your transcript here\nwhen you\'re ready.', hint: 'Drop the PDF — we\'ll handle the rest. Your data stays on your device.' },
  }[tone];
  const onPick = (f) => { if (f) onFile(f); };
  return (
    <section className="drop-sec">
      <div className="step-lbl">{copy.kicker}</div>
      <div
        className={'drop' + (dragOver ? ' drop-on' : '') + (parsing ? ' drop-parsing' : '')}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onPick(e.dataTransfer.files?.[0]); }}
        onClick={() => !parsing && inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept=".pdf,application/pdf,.txt"
          hidden onChange={(e) => onPick(e.target.files?.[0])} />
        {parsing ? (
          <div className="drop-inner">
            <div className="drop-status">PARSING···</div>
            <div className="drop-bar"><div className="drop-bar-fill"/></div>
            <div className="drop-status-sub">running OCR on your dreams · cross-referencing with regret</div>
          </div>
        ) : (
          <div className="drop-inner">
            <h2 className="drop-h">{copy.heading.split('\n').map((l,i)=><span key={i}>{l}<br/></span>)}</h2>
            <div className="drop-hint">{copy.hint}</div>
            <div className="drop-cta">
              <span className="drop-arrow">↓</span>
              <span>DRAG PDF · OR CLICK TO BROWSE</span>
              <span className="drop-arrow">↓</span>
            </div>
          </div>
        )}
      </div>
      {err && <div className="drop-err">⚠ {err}</div>}
      <div className="drop-foot">
        <span>ACCEPTS · .pdf · UoN-style transcripts</span>
        <span className="dot">●</span>
        <span>FOUNDATION + DIPLOMA UNITS AUTO-EXCLUDED</span>
        <span className="dot">●</span>
        <span>0KB UPLOADED · 100% LOCAL</span>
      </div>
    </section>
  );
}

// ── Results ──────────────────────────────────────────────────────────────
function Results({ units, degree, wam, gpa, totalCredits, sys, sysObj, tone, onReset }) {
  const band = markToBand(wam, sys);
  return (
    <>
      <DegreeBanner degree={degree} units={units.length} />
      <section className="numbers">
        <div className="num-grid">
          <BigStat label={`WEIGHTED AVERAGE MARK · ${sys}`} value={fmt2(wam)} unit="/100" sub={band.label.toUpperCase()} />
          <BigStat label={`GRADE POINT AVERAGE · ${sys}`}   value={fmt2(gpa)} unit={`/${sysObj.max.toFixed(1)}`} sub={`${units.length} UNITS · ${totalCredits} CR.`} accent />
        </div>
        <Verdict gpa={gpa} max={sysObj.max} tone={tone} />
      </section>
      <DegreeRoast degree={degree} wam={wam} gpa={gpa} max={sysObj.max} units={units} tone={tone} />
      <Trend units={units} sys={sys} />
      <Calculators units={units} wam={wam} gpa={gpa} sys={sys} sysObj={sysObj} tone={tone} />
      <UnitTable units={units} sys={sys} />
      <div className="reset-row">
        <button className="reset-btn" onClick={onReset}>↺ START OVER · DROP A NEW TRANSCRIPT</button>
      </div>
    </>
  );
}

function DegreeBanner({ degree, units }) {
  return (
    <div className="deg-banner">
      <div className="deg-banner-l">
        <span className="kicker-inline">DEGREE DETECTED →</span>
        <span className="deg-banner-name">{degree || 'Unspecified Program'}</span>
      </div>
      <div className="deg-banner-r">
        <span>{units} UNITS COUNTED</span>
        <span className="dot">●</span>
        <span>FOUNDATION EXCLUDED</span>
      </div>
    </div>
  );
}

function BigStat({ label, value, unit, sub, accent }) {
  return (
    <div className={'big-stat' + (accent ? ' big-stat-acc' : '')}>
      <div className="big-stat-lbl">{label}</div>
      <div className="big-stat-val">
        <span className="big-stat-num">{value}</span>
        <span className="big-stat-unit">{unit}</span>
      </div>
      <div className="big-stat-sub">{sub}</div>
    </div>
  );
}

function Verdict({ gpa, max, tone }) {
  const ratio = gpa / max;
  const lines = {
    online: [
      { lo: 0.92, t: 'this is genuinely concerning behaviour. touch grass. log off. we are calling your mother.' },
      { lo: 0.62, t: 'normal person grades. you eat lunch. you go outside. nothing is wrong with you and that is suspicious.' },
      { lo: 0.45, t: 'pass is pass. nobody asks. the diploma is identical. log off and lie down.' },
      { lo: 0,    t: 'okay so we are not panicking, we are simply recalibrating expectations downward forever.' },
    ],
    dry: [
      { lo: 0.85, t: 'Result is in the upper decile of the distribution. Continue current trajectory.' },
      { lo: 0.65, t: 'Result is consistent with sustained academic engagement.' },
      { lo: 0.45, t: 'Result satisfies progression requirements with margin.' },
      { lo: 0,    t: 'Result indicates intervention may be warranted.' },
    ],
    nice: [
      { lo: 0.85, t: 'Look at you! Genuinely incredible. Take a moment to appreciate this.' },
      { lo: 0.65, t: 'Solid work — you are doing better than you give yourself credit for.' },
      { lo: 0.45, t: 'You\'re passing, you\'re here, you\'re doing it. Keep going.' },
      { lo: 0,    t: 'Hard semester. Tomorrow is a fresh page. We believe in you.' },
    ],
  }[tone];
  const v = lines.find(l => ratio >= l.lo) || lines.at(-1);
  return <p className="verdict">{v.t}</p>;
}

// ── Degree roast ─────────────────────────────────────────────────────────
function classifyDegree(name) {
  const n = (name || '').toLowerCase();
  if (/info\s*tech/.test(n) && /business/.test(n))   return 'it_business';
  if (/comput|software|info\s*tech|infor|cyber/.test(n)) return 'tech';
  if (/business|commerce|account|finance|management|marketing|econ/.test(n)) return 'business';
  if (/engineer/.test(n))                            return 'eng';
  if (/law/.test(n))                                 return 'law';
  if (/medicine|nursing|health|pharm/.test(n))       return 'health';
  if (/psych|social|education|teaching/.test(n))     return 'soft';
  if (/arts|humanit|history|english|philos|media/.test(n)) return 'arts';
  if (/science|biolog|chem|phys/.test(n))            return 'science';
  return 'other';
}

const ROASTS = {
  it_business: {
    online: [
      'a double in IT and Business — you\'re building the startup AND will fire yourself from it. impressive vertical integration.',
      'a degree that says "i can write the bug AND book the meeting where we discuss the bug." truly the founder pipeline.',
      'IT + Business: half of you is on Stack Overflow, the other half is on LinkedIn, and zero percent of you is asleep.',
    ],
    dry:    ['Combined Information Technology and Business program. Broad applicability across enterprise functions.'],
    nice:   ['A double degree is a serious commitment — IT and Business covers enormous ground. Be proud of the breadth.'],
  },
  tech: {
    online: [
      'computer science: the last refuge of people who refuse to make eye contact and refuse to be unemployed.',
      'a tech degree. you will spend $40k learning to google things. it will work out.',
      'you chose tech, so naturally your hobbies are also tech, and your therapist is also a chatbot you wrote.',
    ],
    dry:    ['Technology-track program. Skills include software construction, systems design, and analytical reasoning.'],
    nice:   ['Tech is hard. The fact that you\'re here and tracking your grades shows you care — that matters.'],
  },
  business: {
    online: [
      'a business degree. you have many opinions about coffee, networking events, and your own potential.',
      'business school: where group projects go to teach you who to never start a company with.',
      'you will graduate with a LinkedIn full of "thrilled to announce" and a heart full of unread emails.',
    ],
    dry:    ['Business administration program. Curriculum spans management, finance, and economic principles.'],
    nice:   ['Business covers so many real-world skills — finance, leadership, decision-making. All of it transfers.'],
  },
  eng: {
    online: ['engineering. four years. zero hobbies. one (1) functional spreadsheet. you will be fine, probably.'],
    dry:    ['Engineering program. Strong quantitative and design competencies expected.'],
    nice:   ['Engineering is brutal and rewarding in equal measure. You\'re doing something genuinely difficult.'],
  },
  law: {
    online: ['law school: you read 800 pages a week to argue about whether someone\'s fence is 4cm too far left. dignified.'],
    dry:    ['Legal studies program. Develops analytical, research, and advocacy capabilities.'],
    nice:   ['Law demands enormous focus. Treat yourself with patience as you build the discipline it asks for.'],
  },
  health: {
    online: ['a health degree. society needs you. you have not slept since orientation.'],
    dry:    ['Health-sciences program. Practitioner-focused curriculum.'],
    nice:   ['You\'re training to help people. That\'s a meaningful path — please look after yourself too.'],
  },
  soft: {
    online: ['a humanities-adjacent degree. you read books for fun, on purpose, and your parents are nervously supportive.'],
    dry:    ['Social-sciences program. Emphasis on qualitative reasoning and human-context analysis.'],
    nice:   ['The work you\'re doing matters — understanding people is foundational to almost everything.'],
  },
  arts: {
    online: ['arts degree: the noble art of explaining to relatives at christmas that yes, it is a real degree, no, you do not regret it, possibly.'],
    dry:    ['Humanities program. Critical reading and rhetorical fluency core to the curriculum.'],
    nice:   ['Arts degrees teach you to think and to argue clearly. Deeply useful — don\'t let anyone tell you otherwise.'],
  },
  science: {
    online: ['a science degree. you label things. you peer at things. you write "discussion" sections that say "more research is needed."'],
    dry:    ['Natural-sciences program. Empirical methodology and analytical rigour central to study.'],
    nice:   ['Science teaches you to ask precise questions. That\'s a skill nobody can take away from you.'],
  },
  other: {
    online: ['this degree is doing things its own way. respect.'],
    dry:    ['Non-standard or interdisciplinary program detected.'],
    nice:   ['Whatever path this is, you chose it — there\'s value in that.'],
  },
};

function pickRoast(degree, tone, units) {
  const cls = classifyDegree(degree);
  const arr = ROASTS[cls][tone] || ROASTS[cls].online;
  // pick deterministically by unit count so the same transcript always gets the
  // same roast, but it varies between transcripts.
  const i = (units?.length || 0) % arr.length;
  return arr[i];
}

function performanceRoast(wam, tone) {
  if (tone === 'dry')  return null;
  if (tone === 'nice') {
    if (wam >= 80) return 'Your average is in the high distinction band — that\'s outstanding sustained work.';
    if (wam >= 70) return 'Your average is firmly in credit/distinction territory. Real, durable progress.';
    if (wam >= 60) return 'You\'re passing comfortably. Each unit is a step forward — keep going.';
    return 'Tough run. The marks aren\'t the whole story. Keep showing up.';
  }
  // online
  if (wam >= 85) return 'and you\'re doing it WELL? unfair. show off elsewhere.';
  if (wam >= 75) return 'and the marks are solid. you have peaked in a way that is socially acceptable.';
  if (wam >= 65) return 'and the marks are. fine. they exist. nobody will print them on a t-shirt.';
  if (wam >= 50) return 'and the marks suggest you have many other interests, including but not limited to: not studying.';
  return 'and the marks suggest a strategic withdrawal may be in order. or a nap. probably a nap.';
}

function DegreeRoast({ degree, wam, gpa, max, units, tone }) {
  const roast = pickRoast(degree, tone, units);
  const perf = performanceRoast(wam, tone);
  const heading = {
    online: 'a few thoughts<br/>on your life choices.',
    dry:    'Program assessment.',
    nice:   'About your degree.',
  }[tone];
  return (
    <section className="roast">
      <h3 className="sec-h" dangerouslySetInnerHTML={{__html: heading}}/>
      <div className="roast-card">
        <div className="roast-body">
          <div className="roast-deg">RE: {degree}</div>
          <p className="roast-line">{roast}</p>
          {perf && <p className="roast-perf">{perf}</p>}
        </div>
      </div>
    </section>
  );
}

// ── Trend charts ─────────────────────────────────────────────────────────
function Trend({ units, sys }) {
  const sems = useMemo(() => {
    const map = new Map();
    units.forEach(u => {
      if (!map.has(u.sem)) map.set(u.sem, []);
      map.get(u.sem).push(u);
    });
    return Array.from(map.entries()).map(([sem, us]) => ({
      sem, wam: calcWam(us), gpa: calcGpa(us, sys),
    }));
  }, [units, sys]);
  const enriched = useMemo(() => {
    return sems.map((s, i) => {
      const cum = units.filter(u => sems.slice(0, i+1).map(x=>x.sem).includes(u.sem));
      return { ...s, cumWam: calcWam(cum), cumGpa: calcGpa(cum, sys) };
    });
  }, [sems, units, sys]);
  if (!enriched.length) return null;

  return (
    <section className="trend">
      <h3 className="sec-h">Your average over time.</h3>
      <div className="trend-pair">
        <ChartCard
          title="CUMULATIVE WAM"
          data={enriched}
          valueKey="cumWam"
          yMin={50} yMax={100}
          threshold={{ value: 85, label: 'HD', color: 'var(--accent-ink)' }}
          fmt={fmt1}
        />
        <ChartCard
          title="CUMULATIVE GPA"
          data={enriched}
          valueKey="cumGpa"
          yMin={3} yMax={7}
          threshold={{ value: 6.5, label: 'INTERNSHIP WORTHY', color: 'var(--accent-ink)' }}
          fmt={fmt2}
        />
      </div>
    </section>
  );
}

// Reusable single-line chart (cumulative + threshold dashed line)
function ChartCard({ title, data, valueKey, yMin, yMax, threshold, fmt }) {
  const W = 560, H = 280, P = 48;
  const xStep = (W - P*2) / Math.max(1, data.length - 1);
  const yScale = (v) => H - P - ((v - yMin) / (yMax - yMin)) * (H - P*2);
  const linePath = data.map((e, i) => `${i===0?'M':'L'}${P + i*xStep},${yScale(e[valueKey])}`).join(' ');
  // y-axis ticks: 5 evenly spaced
  const ticks = [];
  const tickStep = (yMax - yMin) / 4;
  for (let i = 0; i <= 4; i++) ticks.push(+(yMin + i * tickStep).toFixed(2));

  return (
    <div className="chart-card">
      <div className="chart-card-h">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="trend-chart" preserveAspectRatio="xMidYMid meet">
        {ticks.map((y) => (
          <g key={y}>
            <line x1={P} x2={W-P} y1={yScale(y)} y2={yScale(y)} stroke="var(--ink)" strokeWidth="0.5" opacity="0.15"/>
            <text x={P-8} y={yScale(y)+4} textAnchor="end" fontFamily="var(--mono)" fontSize="11" fill="var(--ink)" opacity="0.55">{fmt(y)}</text>
          </g>
        ))}
        {/* threshold */}
        <line x1={P} x2={W-P} y1={yScale(threshold.value)} y2={yScale(threshold.value)} stroke={threshold.color} strokeWidth="1.5" strokeDasharray="4 4"/>
        <text x={W-P} y={yScale(threshold.value)-6} textAnchor="end" fontFamily="var(--mono)" fontSize="10" fill={threshold.color} fontWeight="700">{threshold.label}</text>
        {/* line */}
        <path d={linePath} fill="none" stroke="var(--ink)" strokeWidth="2.5"/>
        {/* points */}
        {data.map((e, i) => (
          <g key={i}>
            <circle cx={P + i*xStep} cy={yScale(e[valueKey])} r="5" fill="var(--bg)" stroke="var(--ink)" strokeWidth="2"/>
            <text x={P + i*xStep} y={yScale(e[valueKey]) - 12} textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fontWeight="700" fill="var(--ink)">{fmt(e[valueKey])}</text>
            <text x={P + i*xStep} y={H - P + 18} textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fill="var(--ink)" opacity="0.6">{e.sem}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ── Calculators ──────────────────────────────────────────────────────────
// GPA target → distribution: how many HDs / Distinctions / Credits per
// remaining course you need to hit the target GPA.
function gpaDistribution(currentGpa, doneCredits, targetGpa, remCount, remCreditsEach, sys) {
  if (remCount <= 0) return null;
  const remCredits = remCount * remCreditsEach;
  const totalCredits = doneCredits + remCredits;
  // Total grade-points needed across all remaining courses
  const totalPointsNeeded = targetGpa * totalCredits - currentGpa * doneCredits;
  const avgPointsPerCourse = totalPointsNeeded / remCount; // each course = remCreditsEach credits, so points-per-credit = avgPointsPerCourse / remCreditsEach
  const requiredPerCourseGpa = avgPointsPerCourse / remCreditsEach;

  const bands = SYSTEMS[sys].bands;
  const hdGpa = bands.find(b => b.code === 'HD' || b.code === '1st' || b.code === 'A')?.gpa ?? 7;
  const dGpa  = bands.find(b => b.code === 'D'  || b.code === '2:1' || b.code === 'B')?.gpa ?? 6;
  const cGpa  = bands.find(b => b.code === 'C'  || b.code === '2:2' || b.code === 'C-')?.gpa ?? 5;
  const pGpa  = bands.find(b => b.code === 'P'  || b.code === '3rd' || b.code === 'D')?.gpa ?? 4;

  // Pick the simplest mix: solve hd + d = remCount, hd*hdGpa + d*dGpa = totalPointsNeeded/remCreditsEach
  // i.e. hd*hdGpa + (remCount - hd)*dGpa = totalPointsNeeded / remCreditsEach
  const targetSumPoints = totalPointsNeeded / remCreditsEach; // sum of per-course gpa points
  const tryMix = (highGpa, lowGpa) => {
    if (highGpa === lowGpa) return null;
    const high = (targetSumPoints - lowGpa * remCount) / (highGpa - lowGpa);
    if (high < -0.0001 || high > remCount + 0.0001) return null;
    const highRound = Math.ceil(high - 0.0001); // ceil so we hit/exceed target
    const low = remCount - highRound;
    if (highRound < 0 || highRound > remCount) return null;
    return { high: highRound, low, highGpa, lowGpa };
  };

  // Try HD/D mix first, then D/C, then C/P
  let mix = null, tier = null;
  if (requiredPerCourseGpa > dGpa) { mix = tryMix(hdGpa, dGpa); tier = ['HD', 'D']; }
  else if (requiredPerCourseGpa > cGpa) { mix = tryMix(dGpa, cGpa); tier = ['D', 'C']; }
  else if (requiredPerCourseGpa > pGpa) { mix = tryMix(cGpa, pGpa); tier = ['C', 'P']; }
  else { mix = { high: 0, low: remCount, highGpa: 0, lowGpa: 0 }; tier = ['—', 'P']; }

  return {
    requiredPerCourseGpa,
    targetSumPoints,
    tier,
    mix,
    tooHigh: requiredPerCourseGpa > hdGpa + 0.0001,
    tooLow: requiredPerCourseGpa < 0,
    avgGradeName: requiredPerCourseGpa > hdGpa - 0.0001 ? 'HD'
                 : requiredPerCourseGpa > dGpa - 0.0001 ? 'D'
                 : requiredPerCourseGpa > cGpa - 0.0001 ? 'C'
                 : requiredPerCourseGpa > pGpa - 0.0001 ? 'P' : 'F',
  };
}

function Calculators({ units, wam, gpa, sys, sysObj, tone }) {
  const doneCredits = units.reduce((s, u) => s + u.credits, 0);
  // pick a sensible default credit-per-course based on what we've seen
  const avgCreditsPerCourse = units.length ? Math.round(doneCredits / units.length) : 10;

  const [tWam, setTWam] = useState(85);
  const [tGpa, setTGpa] = useState(sysObj.max === 7 ? 6.5 : 3.7);
  const [remW, setRemW] = useState(80);
  const [remCount, setRemCount] = useState(8);

  useEffect(() => {
    setTGpa(sysObj.max === 7 ? 6.5 : 3.7);
  }, [sys, sysObj.max]);

  const needWam = neededAvg(wam, doneCredits, tWam, remW);
  const wamFeasible = needWam !== null && needWam <= 100;
  const dist = gpaDistribution(gpa, doneCredits, tGpa, remCount, avgCreditsPerCourse, sys);

  return (
    <section className="calc">
      <h3 className="sec-h">What grades do you need?</h3>
      <div className="calc-grid">
        <WamCalcCard
          target={tWam} setTarget={setTWam}
          rem={remW} setRem={setRemW}
          need={needWam}
          feasible={wamFeasible} tone={tone}
          tooHigh={needWam > 100} tooLow={needWam !== null && needWam < 0}
        />
        <GpaCalcCard
          target={tGpa} setTarget={setTGpa}
          remCount={remCount} setRemCount={setRemCount}
          targetMax={sysObj.max}
          dist={dist}
          tone={tone}
        />
      </div>
    </section>
  );
}

function WamCalcCard({ target, setTarget, rem, setRem, need, feasible, tooHigh, tooLow, tone }) {
  const verdict = (() => {
    if (tooLow) return tone === 'online' ? 'literally just have to show up. like at all.' : tone === 'nice' ? "you're already there!" : 'Already achieved.';
    if (tooHigh) return tone === 'online' ? 'mathematically impossible. respectfully, lower your standards.' : tone === 'nice' ? "this one's a stretch — let's pick a kinder target." : 'Target unreachable with remaining credits.';
    if (need === null) return '—';
    return tone === 'online' ? `you need to average a ${fmt1(need)}. good luck.` :
           tone === 'nice'   ? `you can do this — average a ${fmt1(need)}.` :
                                `Required average: ${fmt1(need)}.`;
  })();
  return (
    <div className="calc-card">
      <div className="calc-lbl">TARGET WAM</div>
      <div className="calc-inputs">
        <NumInput label="TARGET" value={target} onChange={setTarget} min={50} max={100} step={0.5} unit="/100"/>
        <NumInput label="REMAINING CR." value={rem} onChange={setRem} min={10} max={240} step={10} unit="cr"/>
      </div>
      <div className="calc-need">
        <div className="calc-need-lbl">AVERAGE MARK NEEDED</div>
        <div className={'calc-need-val' + (tooHigh ? ' calc-need-impossible' : '')}>
          <span className="calc-need-num">{need === null ? '—' : (tooHigh ? '∞' : tooLow ? '0' : fmt1(need))}</span>
          <span className="calc-need-unit">/100</span>
        </div>
      </div>
      <div className={'calc-verdict' + (tooHigh ? ' bad' : '')}>{verdict}</div>
    </div>
  );
}

function GpaCalcCard({ target, setTarget, remCount, setRemCount, targetMax, dist, tone }) {
  const tooHigh = dist?.tooHigh;
  const tooLow = dist?.tooLow;
  const verdict = (() => {
    if (!dist) return '—';
    if (tooLow) return tone === 'online' ? "you're already there. log off." : tone === 'nice' ? 'already there!' : 'Already achieved.';
    if (tooHigh) return tone === 'online' ? 'you would need straight HDs and a personality transplant. not happening.' : tone === 'nice' ? 'this one\'s out of reach with the remaining courses.' : 'Target unreachable with remaining courses.';
    const m = dist.mix;
    if (!m) return '—';
    const [hi, lo] = dist.tier;
    if (hi === '—') return tone === 'online' ? `${m.low} passes will do it. minimum effort. respect.` : tone === 'nice' ? `passes across the rest will get you there.` : `${m.low} passing grades required.`;
    if (m.high === 0) return tone === 'online' ? `${m.low} ${lo}s. easy enough.` : tone === 'nice' ? `${m.low} ${lo}s will get you there.` : `${m.low} ${lo}-grade results required.`;
    if (m.low === 0) return tone === 'online' ? `${m.high} HDs. all of them. every single one.` : tone === 'nice' ? `${m.high} HDs across the remaining courses.` : `${m.high} ${hi}-grade results required.`;
    return tone === 'online' ? `${m.high} ${hi}s and ${m.low} ${lo}s. that's the maths.` :
           tone === 'nice'   ? `${m.high} ${hi}s and ${m.low} ${lo}s should get you there.` :
                                `${m.high} ${hi}-grade and ${m.low} ${lo}-grade results required.`;
  })();
  return (
    <div className="calc-card calc-card-acc">
      <div className="calc-lbl">TARGET GPA</div>
      <div className="calc-inputs">
        <NumInput label="TARGET" value={target} onChange={setTarget} min={0} max={targetMax} step={0.05} unit={`/${targetMax.toFixed(1)}`}/>
        <NumInput label="REMAINING COURSES" value={remCount} onChange={setRemCount} min={1} max={40} step={1} unit="ea"/>
      </div>
      <div className="calc-need">
        <div className="calc-need-lbl">PER-COURSE BREAKDOWN</div>
        {dist && !tooHigh && !tooLow && dist.mix ? (
          <div className="calc-dist">
            <div className="calc-dist-row">
              <div className="calc-dist-num">{dist.mix.high}</div>
              <div className="calc-dist-tag">{dist.tier[0]}</div>
            </div>
            <div className="calc-dist-plus">+</div>
            <div className="calc-dist-row">
              <div className="calc-dist-num">{dist.mix.low}</div>
              <div className="calc-dist-tag">{dist.tier[1]}</div>
            </div>
          </div>
        ) : (
          <div className={'calc-need-val' + (tooHigh ? ' calc-need-impossible' : '')}>
            <span className="calc-need-num">{tooHigh ? '∞' : tooLow ? '0' : '—'}</span>
          </div>
        )}
      </div>
      <div className={'calc-verdict' + (tooHigh ? ' bad' : '')}>{verdict}</div>
    </div>
  );
}

function NumInput({ label, value, onChange, min, max, step, unit }) {
  return (
    <div className="numinp">
      <div className="numinp-lbl">{label}</div>
      <div className="numinp-row">
        <button onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}>−</button>
        <input type="number" value={value} min={min} max={max} step={step}
          onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value))))}/>
        <button onClick={() => onChange(Math.min(max, +(value + step).toFixed(2)))}>+</button>
        <span className="numinp-unit">{unit}</span>
      </div>
    </div>
  );
}

// ── Unit table ───────────────────────────────────────────────────────────
function UnitTable({ units, sys }) {
  return (
    <section className="table-sec">
      <h3 className="sec-h">The receipts.</h3>
      <table className="utbl">
        <thead>
          <tr>
            <th>SEM</th>
            <th>CODE</th>
            <th>UNIT</th>
            <th>CR</th>
            <th>MARK</th>
            <th>GRADE</th>
          </tr>
        </thead>
        <tbody>
          {units.map((u, i) => {
            const b = markToBand(u.mark, sys);
            return (
              <tr key={i}>
                <td className="td-mono">{u.sem}</td>
                <td className="td-mono">{u.code}</td>
                <td className="td-title">{u.title}</td>
                <td className="td-mono">{u.credits}</td>
                <td className="td-mono td-mark">{u.mark}</td>
                <td className="td-mono"><span className={'tag tag-' + b.code.replace(/[^A-Za-z]/g,'')}>{b.code}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="ft">
      <div className="ft-cols">
        <div>
          <span className="ft-h">DISCLAIMER</span>
          <p>Calculation runs in your browser. Foundation, diploma, and bridging programs are excluded automatically.</p>
        </div>
        <div>
          <span className="ft-h">METHODOLOGY</span>
          <p>WAM = Σ(mark × credits) / Σ(credits). GPA = Σ(grade-points × credits) / Σ(credits).</p>
        </div>
      </div>
    </footer>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
