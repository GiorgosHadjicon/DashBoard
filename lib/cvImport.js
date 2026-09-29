import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoFormatCv } from '../public/logic.js';

const execFileP = promisify(execFile);

const inline = (t) => t.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**').replace(/<[^>]+>/g, '').replace(/[ \t]+/g, ' ').trim();

// Word's real structure (heading styles, bullet/numbered lists, bold runs) survives through
// convertToHtml in a way extractRawText's flattened plain text can't — read that instead and turn
// it into the CV tab's own syntax, so a Word CV needs little to no manual re-marking-up afterward.
// Not a full HTML parser — sequential regex passes, innermost tags first, good enough for mammoth's
// own predictable output (this is never attacker-supplied HTML, mammoth generated all of it).
function docxHtmlToCv(html) {
  let s = html;
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `\n- ${inline(t)}`);
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n# ${inline(t)}\n`);
  s = s.replace(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/gi, (_, t) => `\n## ${inline(t)}\n`);
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n${inline(t)}`);
  s = s.replace(/<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => `\n${inline(t)}`);
  s = s.replace(/<[^>]+>/g, ''); // drop leftover wrapper tags: table, tr, ul, ol, tbody…
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

// Pulls text out of an uploaded PDF or Word CV, auto-formatted into the CV tab's "#"/"##"/"-" syntax
// (see autoFormatCv in public/logic.js) so importing one doesn't mean re-typing the whole thing.
export async function extractText(buffer, filename) {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'pdf') {
    const parser = new PDFParse({ data: buffer });
    try { return autoFormatCv((await parser.getText()).text); } finally { await parser.destroy(); }
  }
  if (ext === 'docx') return autoFormatCv(docxHtmlToCv((await mammoth.convertToHtml({ buffer })).value));
  throw new Error(`Unsupported file type: .${ext} (expected .txt, .md, .pdf or .docx)`);
}

// textutil's HTML has two quirks that make it visibly smaller/boxier than the real Word doc, even
// though the fonts/colours it pulled out are correct:
// 1. it writes every measurement (font size, margins, ...) as a CSS px equal to the Word point value,
//    but 1pt is really 1.33px on screen — so text renders ~25% smaller than Word shows it. Scale
//    every px value in the stylesheet back up to fix that.
// 2. it draws a solid grey border around every table cell regardless of what the .docx says — a CV's
//    tables are almost always invisible layout (e.g. a job title + date row), never a visible grid,
//    so default them off.
function fixTextutilHtml(html) {
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/i,
    (_, open, css, close) => open + css.replace(/([\d.]+)px/g, (_, n) => `${(+n * 4 / 3).toFixed(1)}px`) + close);
  return html.replace(/border-style:\s*solid;\s*border-width:[^;]+;\s*border-color:[^;}]+;?/gi, 'border: none;');
}

// A real rendering of the .docx, using macOS's own docx reader (the same one TextEdit opens a Word
// file with) — keeps actual fonts/colours/spacing that mammoth's semantic-only conversion above
// throws away. Only for "does this look like my Word doc" display; the plain #/##/- text above is
// still what's stored and edited. macOS-only and best-effort: returns null rather than failing the
// whole import if textutil is missing or the file trips it up.
export async function docxToStyledHtml(buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'cv-'));
  try {
    const src = join(dir, 'in.docx'), out = join(dir, 'in.html');
    await writeFile(src, buffer);
    await execFileP('textutil', ['-convert', 'html', '-output', out, src]);
    return fixTextutilHtml(await readFile(out, 'utf8'));
  } catch { return null; } finally { await rm(dir, { recursive: true, force: true }); }
}
