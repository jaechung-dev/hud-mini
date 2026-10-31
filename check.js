// HUD frontend checker. Usage: node check.js [dir]   (dir holds hud_min.html + hud_min.js; default ".")
// Serves the page, feeds it test states, prints a PASS/FAIL table, writes screenshots to ./shots, exits 1 on any FAIL.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const dir = path.resolve(process.argv[2] || '.');
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

  console.log('| case | result | detail |\n|---|---|---|');
  for (const r of rows) console.log('| ' + r.join(' | ') + ' |');
  const fails = rows.filter(r => r[1] === 'FAIL').length;
  console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASSED'));
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
