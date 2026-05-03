# UON GPA & WAM Calculator

A lightweight, client-side web app for University of Newcastle students to calculate their GPA and WAM from an official transcript PDF, and simulate future scores.

---

## Features

- **Drag-and-drop PDF upload** — drop your UON transcript directly onto the page
- **GPA & WAM calculation** — computed on the Australian 7-point scale
- **Automatic filtering** — Diploma, Open Foundation, and Foundation Studies enrolments are excluded; only your current degree is counted
- **Grade breakdown bar** — visual distribution of HD / D / C / P / F units
- **Cumulative GPA & WAM charts** — line + point charts showing how your scores have trended across each trimester
- **Projection simulator** — enter upcoming units and a target grade to see the effect on your final GPA and WAM
- **Target calculator** — calculates how many units (and courses) you need at each grade level to reach a specific GPA

---

## How It Works

Everything runs in the browser. No data is uploaded to any server.

1. PDF.js extracts text from your transcript client-side
2. The parser reconstructs table rows from raw text positions, then uses regex patterns to identify trimester headers, program names, and course rows
3. Grades are mapped to GPA points and marks are used for WAM
4. All calculations and charts are rendered in-page with vanilla JS and inline SVG

### GPA scale (University of Newcastle)

| Grade | Description     | Points |
|-------|-----------------|--------|
| HD    | High Distinction | 7     |
| D     | Distinction      | 6     |
| C     | Credit           | 5     |
| P     | Pass             | 4     |
| F     | Fail             | 0     |

### Formulas

**GPA** = Σ(grade points × unit value) ÷ Σ(unit values)

**WAM** = Σ(numerical mark × unit value) ÷ Σ(unit values)

Withdrawn (WD), Satisfactory (SY), and Unsatisfactory (US) grades are excluded from both calculations.

---

## Projections

### How projected GPA is calculated

Your current GPA (weighted by completed units) is blended with the selected target grade for the upcoming units:

```
Projected GPA = (current GPA × current units + grade points × upcoming units)
                ÷ (current units + upcoming units)
```

Grade points used: HD = 7, D = 6, C = 5, P = 4

### How projected WAM is calculated

Your current WAM is blended with the target mark percentage for the upcoming units:

```
Projected WAM = (current WAM × current units + target mark% × upcoming units)
                ÷ (current units + upcoming units)
```

The mark % input is independent of the grade selector — set it to reflect your expected numerical score (e.g. you can simulate 72% which lands in Credit band regardless of the grade dropdown).

### Target GPA calculator

Given a target GPA, the app calculates how many additional units of each grade type you would need:

```
Units needed = current units × (target GPA − current GPA) ÷ (grade points − target GPA)
```

Results are shown as both total units and estimated course count (assuming 10 unit courses, the standard at UON).

---

## Tech Stack

| Concern       | Solution                          |
|---------------|-----------------------------------|
| PDF parsing   | [PDF.js](https://mozilla.github.io/pdf.js/) v3.11 via unpkg CDN |
| Charts        | Inline SVG (no library)           |
| Styling       | Vanilla CSS with CSS custom properties |
| Logic         | Vanilla JS (ES2020, no build step) |
| Hosting       | Static — deployable to Cloudflare Pages, GitHub Pages, or any static host |

No frameworks, no npm, no build step. The entire app is three files: `index.html`, `style.css`, `app.js`.

---

## Supported Transcript Format

This tool is built for **University of Newcastle (Australia)** official transcripts exported from the student portal as PDF. It expects:

- Trimester section headers (e.g. `Trimester 1 - 2024`)
- `Program:` lines identifying the degree
- Course rows with columns: course code, course name, unit value, mark %, grade, units earned

Transcripts from other universities will not parse correctly without modifications to the regex patterns in `extractCourses()` in `app.js`.

---

## Known Limitations

- The PDF parser relies on text extraction — scanned or image-based PDFs will not work
- Non-standard transcript layouts (e.g. exchange or cross-institutional enrolments) may not be detected correctly
- The target calculator assumes a uniform 10 unit value per course

---

## Roadmap

- [ ] Fix trimester header detection for all PDF variants
- [ ] WAM target calculator (mirror of the GPA target tool)
- [ ] Per-subject GPA contribution breakdown
- [ ] Support for other Australian universities
- [ ] Export results as PNG or PDF summary

---

## License

MIT
