// HUD frontend checker. Usage: node check.js [dir] [--part2]   (dir holds hud_min.html + hud_min.js; default ".")
// Serves the page, feeds it test states, prints a PASS/FAIL table, writes screenshots to ./shots, exits 1 on any FAIL.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const args = process.argv.slice(2), part2 = args.includes('--part2');
const dir = path.resolve(args.find(a => !a.startsWith('--')) || '.');
if (!fs.existsSync(path.join(dir, 'hud_min.html')) || !fs.existsSync(path.join(dir, 'hud_min.js'))) {
  console.log('No hud_min.html / hud_min.js in ' + dir + ' - nothing to check (infra-only change).');
  process.exit(0);
}
const shots = path.resolve('shots'); fs.mkdirSync(shots, { recursive: true });

let state = {}, up = true;
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  if (u === '/state') {
    if (!up) { r.statusCode = 500; return r.end('x'); }
    r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify(state));
  }
  const f = path.join(dir, u === '/' ? 'hud_min.html' : path.basename(u));
  try { r.end(fs.readFileSync(f)); } catch (e) { r.statusCode = 404; r.end(); }
});

const P = (a, o = {}) => ({ qid: 1, question: '', mode: 'QA', status: 'DONE', selected: 'model-a', providers: { 'model-a': { answer: a } }, ...o });
const EMPTY = { qid: 0, question: '', mode: '', status: '', selected: '', providers: {} };
const rows = [];

(async () => {
  await new Promise(ok => srv.listen(0, ok));
  const base = 'http://localhost:' + srv.address().port + '/';
  const b = await chromium.launch();

  async function run(n, st, chk, vp) {
    state = st; up = true;
    const p = await b.newPage({ viewport: vp || { width: 700, height: 500 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    let res;
    try {
      await p.goto(base); await p.waitForTimeout(900);
      const d = await p.evaluate(() => {
        const all = s => [...document.querySelectorAll(s)];
        return {
          pills: all('.pill').filter(e => !e.hidden).map(e => e.id + ':' + e.textContent),
          a: document.getElementById('answer').innerText, q: document.getElementById('question').innerText,
          g: all('.c-g').map(e => e.textContent), r: all('.c-r').map(e => e.textContent), y: all('.c-y').map(e => e.textContent),
          pre: all('pre.code').map(e => e.textContent), ok: all('.ok').map(e => e.textContent), opt: all('.opt').map(e => e.textContent),
          sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        };
      });
      res = chk(d, errs);
      if (errs.length && res[0]) res = [false, 'page error: ' + errs[0]];
    } catch (e) { res = [false, String(e).slice(0, 120)]; }
    rows.push([n, res[0] ? 'PASS' : 'FAIL', String(res[1] || '').replace(/\s+/g, ' ').slice(0, 110)]);
    await p.screenshot({ path: path.join(shots, 'case' + n + '.png') }).catch(() => {});
    await p.close();
  }

  await run(1, EMPTY, d => [d.a.includes('waiting for answer') && d.pills.length === 0, d.pills + ' | ' + d.a]);
  await run(2, P('• 결론: {g}citation{/g} 사용\n• {r}Trade-off: recall{/r}\n• {y}evals{/y}'),
    d => [d.pills.length === 3 && d.g[0] === 'citation' && d.r.length === 1 && d.y[0] === 'evals', JSON.stringify([d.pills, d.g, d.r, d.y])]);
  await run(3, P('', { status: 'THINKING' }), d => [d.pills.some(x => x === 'status:THINKING') && d.a.includes('waiting for answer'), d.pills + ' | ' + d.a]);
  await run(4, P('{"answer":"• ok {g}x{/g}"}'), d => [d.a.includes('ok x') && !d.a.includes('{') && d.g[0] === 'x', d.a]);
  await run(5, P('• a\n```js\nconsole.log(1)\n```'), d => [d.pre.length === 1 && d.pre[0].includes('console.log(1)') && !d.a.includes('```'), JSON.stringify(d.pre)]);
  await run(6, P('x', { question: 'Q?\n(a) one\n✔ (b) two' }), d => [d.opt.length >= 1 && d.ok.length === 1, JSON.stringify([d.opt, d.ok])]);
  await run(7, P('<script>alert(1)</script> {{g}}w{{/g}} {r}open'),
    d => [d.a.includes('<script>alert(1)</script>') && d.g.includes('w') && d.a.includes('{r}open'), d.a]);

  { // 8: server goes away -> offline pill, content kept
    state = P('• hi'); up = true;
    const p = await b.newPage(); let r8;
    try {
      await p.goto(base); await p.waitForTimeout(700);
      const before = await p.evaluate(() => document.getElementById('answer').innerText);
      up = false; await p.waitForTimeout(1000);
      const s = await p.evaluate(() => ({ t: document.getElementById('status').textContent, a: document.getElementById('answer').innerText }));
      r8 = [s.t === 'offline' && s.a === before, JSON.stringify(s)];
    } catch (e) { r8 = [false, String(e).slice(0, 120)]; }
    rows.push([8, r8[0] ? 'PASS' : 'FAIL', r8[1]]); await p.close();
  }
  { // 9: unchanged state -> zero DOM mutations
    state = P('• hi {g}x{/g}'); up = true;
    const p = await b.newPage(); let r9;
    try {
      await p.goto(base); await p.waitForTimeout(700);
      const n = await p.evaluate(() => new Promise(res => {
        let c = 0; new MutationObserver(m => c += m.length).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        setTimeout(() => res(c), 2000);
      }));
      r9 = [n === 0, 'mutations=' + n];
    } catch (e) { r9 = [false, String(e).slice(0, 120)]; }
    rows.push([9, r9[0] ? 'PASS' : 'FAIL', r9[1]]); await p.close();
  }
  await run('390px', P('• 아주 긴 한국어 문장입니다 '.repeat(8) + ' {g}verylongenglishtermwithoutspaces_{/g}'.repeat(3), { question: '긴 질문 '.repeat(20) }),
    d => [d.sw <= d.cw, 'scrollWidth=' + d.sw + ' clientWidth=' + d.cw], { width: 390, height: 700 });


  const rows2 = [];
  async function p2(n, st, vp, setup, fn) {
    state = st; up = true;
    const p = await b.newPage({ viewport: vp });
    let res;
    try {
      if (setup) await setup(p);
      await p.goto(base); await p.waitForTimeout(900);
      res = await fn(p);
    } catch (e) { res = [false, String(e).slice(0, 110)]; }
    rows2.push([n, res[0] ? 'PASS' : 'FAIL', String(res[1] || '')]);
    await p.screenshot({ path: path.join(shots, 'part2-' + n.replace(/\W+/g, '_') + '.png') }).catch(() => {});
    await p.close();
  }
  if (part2) {
    const metrics = p => p.evaluate(() => {
      const cs = (s, k) => getComputedStyle(document.querySelector(s))[k];
      return { fs: cs('.answer', 'fontSize'), pt: cs('.card', 'paddingTop'), pl: cs('.card', 'paddingLeft') };
    });
    // P2-1 responsive: <=600px smaller answer text and tighter card padding; wider screens unchanged
    await p2('P2-1 responsive', P('• hi'), { width: 390, height: 600 }, null, async p => {
      const m = await metrics(p); const n = await b.newPage({ viewport: { width: 700, height: 600 } });
      await n.goto(base); await n.waitForTimeout(700); const w = await metrics(n); await n.close();
      const ok = m.fs === '18px' && m.pt === '8px' && m.pl === '10px' && w.fs === '24px' && w.pt === '12px' && w.pl === '16px';
      return [ok, 'narrow=' + JSON.stringify(m) + ' wide=' + JSON.stringify(w)];
    });
    // P2-2 THINKING pill blinks (keyframes "blink", 1.2s, infinite); other states do not; reduced motion turns it off
    const anim = p => p.evaluate(() => {
      const s = getComputedStyle(document.getElementById('status'));
      const kf = [...document.styleSheets].some(ss => { try { return [...ss.cssRules].some(r => r.type === 7 && r.name === 'blink'); } catch (e) { return false; } });
      return { name: s.animationName, dur: s.animationDuration, iter: s.animationIterationCount, kf };
    });
    await p2('P2-2 blink', P('', { status: 'THINKING' }), { width: 700, height: 400 }, null, async p => {
      const a = await anim(p);
      const done = await b.newPage({ viewport: { width: 700, height: 400 } }); state = P('x', { status: 'DONE' });
      await done.goto(base); await done.waitForTimeout(700); const d = await anim(done); await done.close();
      state = P('', { status: 'THINKING' });
      const rm = await b.newPage({ viewport: { width: 700, height: 400 } }); await rm.emulateMedia({ reducedMotion: 'reduce' });
      await rm.goto(base); await rm.waitForTimeout(700); const r = await anim(rm); await rm.close();
      const ok = a.name === 'blink' && a.dur === '1.2s' && a.iter === 'infinite' && a.kf && d.name === 'none' && r.name === 'none';
      return [ok, 'thinking=' + JSON.stringify(a) + ' done=' + d.name + ' reduced=' + r.name];
    });
    // P2-3 code block: 3px accent line on the left (#6cb6ff), long lines wrap instead of scrolling
    await p2('P2-3 code block', P('```\n' + 'x'.repeat(300) + '\n```'), { width: 390, height: 600 }, null, async p => {
      const m = await p.evaluate(() => {
        const e = document.querySelector('pre.code'), s = getComputedStyle(e);
        return { bw: s.borderLeftWidth, bc: s.borderLeftColor, over: e.scrollWidth - e.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      return [m.bw === '3px' && m.bc === 'rgb(108, 182, 255)' && m.over <= 1 && m.page <= 0, JSON.stringify(m)];
    });
  }

  console.log('| case | result | detail |\n|---|---|---|');
  for (const r of rows) console.log('| ' + r.join(' | ') + ' |');
  if (part2) {
    console.log('\n### Part 2 (CSS)\n\n| case | result | detail |\n|---|---|---|');
    for (const r of rows2) console.log('| ' + r.join(' | ') + ' |');
  }
  const fails = rows.concat(rows2).filter(r => r[1] === 'FAIL').length;
  console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASSED'));
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
