# Task: build a tiny HUD display page

You build the **frontend only**: `hud_min.html` + `hud_min.js` (two files, no libraries, no CDN, no build step).
A backend already exists; your page polls it and draws the latest LLM answer.

Work in this order. **Do not skip steps. Do not write DONE until step 4 is fully satisfied.**

1. Build the page (HTML skeleton and CSS are given below — use them as-is, then write the JS)
2. Adjust the CSS only if a test shows a problem
3. Test it yourself (§5)
4. Report (§6)

---

## 1. Backend contract

`GET /state` every 300 ms (`fetch('/state', {cache:'no-store'})`). Same origin. JSON:

```json
{ "qid": 1, "question": "text", "mode": "QA", "status": "DONE",
  "providers": { "model-a": { "answer": "text with {g}tags{/g}" } }, "selected": "model-a" }
```

- Empty state: `qid` 0, empty strings, `providers` `{}`.
- Answer to show: `providers[selected].answer`; if missing, the first provider that has an answer; else empty.
- If the answer starts with `{` and `JSON.parse` gives an object with a string `answer`, show that string instead.
- **mode** (pill): `QA`, `CODE`, `CHAT`. Show as-is; empty → hide the pill.
- **status** (pill): `THINKING`, `DONE`, `ERROR`. Colour by value (§3). Empty or unknown → hide the pill.
- **provider** (pill): the `selected` key as-is.

## 2. HTML skeleton (use exactly these ids/classes)

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HUD</title>
<style>/* paste the CSS from §3 here */</style>
</head>
<body>
  <main class="card">
    <div class="meta">
      <span class="pill mode" id="mode" hidden></span>
      <span class="pill prov" id="prov" hidden></span>
      <span class="pill status" id="status" hidden></span>
    </div>
    <div class="question" id="question"></div>
    <div class="answer" id="answer"></div>
  </main>
  <script src="hud_min.js"></script>
</body>
</html>
```

## 3. CSS (paste as-is)

```css
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { background: #071225; color: #e7eefb; padding: 18px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.card { max-width: 1100px; margin: 0 auto; background: #0b1a30; border: 1px solid #16294a;
  border-radius: 16px; padding: 12px 16px; box-shadow: 0 2px 18px rgba(0,0,0,.35); }
.meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
.pill { background: #12233f; border: 1px solid #1e3860; border-radius: 999px;
  padding: 1px 8px; font-size: 11px; font-weight: 700; letter-spacing: .3px; }
.pill[hidden] { display: none; }
.pill.mode { color: #ffd166; }
.pill.prov { color: #8bd3a8; }
.pill.status.THINKING { color: #ffd166; }
.pill.status.DONE { color: #8bd3a8; }
.pill.status.ERROR { color: #ff7b72; }
.question { font-size: 18px; line-height: 1.3; font-weight: 600; color: #f4f8ff; white-space: pre-line; }
.question .opt { color: #cbd5e1; font-weight: 500; }
.question .ok { color: #4ade80; font-weight: 700; }
.answer { font-size: 24px; line-height: 1.5; }
.answer .empty { color: #5f77a0; font-size: 20px; }
.answer .topic { color: #6cb6ff; font-size: 26px; font-weight: 800; margin: 2px 0 12px; }
.answer .bullet { display: flex; gap: 10px; margin: 8px 0; }
.answer .bullet .dot { color: #ffd166; flex: 0 0 auto; }
.answer .concl, .answer .tradeoff { color: #9db4d6; font-size: 22px; margin-top: 8px; }
.answer .line { margin: 8px 0; }
.answer pre.code { margin: 10px 0; padding: 12px 14px; background: #0a1526; border: 1px solid #16294a;
  border-radius: 10px; color: #d6e4ff; font-size: .86em; line-height: 1.5;
  white-space: pre-wrap; overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.c-g, .c-r, .c-y, .c-b, .c-q, .c-k { font-weight: 700; }
.c-g { color: #8bd3a8; } .c-r { color: #ff7b72; } .c-y { color: #ffd166; }
.c-b { color: #6cb6ff; } .c-q { color: #38bdf8; } .c-k { color: #fb7185; font-weight: 800; }
.offline { color: #ff8a8a; }
```

## 4. JavaScript to write (`hud_min.js`)

Plain JS in one IIFE. Required behaviour:

1. `tick()`: fetch `/state`, call `draw(data)`; on any error add class `offline` to `#status` and set its text to
   `offline` (unhide it); the next good poll removes the class. Start with `tick(); setInterval(tick, 300);`.
2. `draw(data)`: build a signature string of `qid, question, selected, answer, mode, status`; **return early if it equals the
   previous one** (never touch the DOM when nothing changed). Otherwise set the three pills (`hidden` when empty; for
   status also set `className = 'pill status ' + value`), `#question.innerHTML`, `#answer.innerHTML`.
3. `esc(s)`: escape `& < > " '`. **Every** piece of backend text goes through `esc` before it reaches `innerHTML`.
4. `fixTags(s)`: `{{g}}` `{/g}}` `{{/g}` → `{g}` `{/g}` (same for `r`).
5. `inline(text)`: replace `{g}x{/g}` `{r}` `{y}` `{b}` `{q}` `{k}` with `<span class="c-g">…</span>` (class `c-` + letter).
   Regex: `/\{(y|g|b|r|q|k)\}([\s\S]*?)\{\/\1\}/gi`. Text outside tags is escaped. Unclosed tags stay as literal text.
6. `renderAnswer(text)`: split on newlines, skip empty lines, then per line:
   - starts with ` ``` ` → collect lines until the closing ` ``` ` into `<pre class="code">` (escaped, no highlighting)
   - whole line (after an optional `• `) is `{g}…{/g}` → skip it (keyword summary line)
   - starts with `Q:` → `<div class="topic">` (text after `Q:`)
   - starts with `•` → `<div class="bullet"><span class="dot">•</span><span>…</span></div>`
   - starts with `→` → `<div class="concl">`; starts with `⚖` → `<div class="tradeoff">`
   - else `<div class="line">`
   If the text is empty return `<div class="empty">waiting for answer…</div>`.
7. `renderQuestion(q)`: escape. If it contains `✔` **and** a newline, split lines: a line starting with `✔` →
   `<div class="ok">`; a line matching `/^\s*\(?[a-eA-E][\).:]/` → `<div class="opt">`; others `<div>`.
8. No localStorage, no cookies, no other network calls.

## 5. Test it yourself (mandatory)

Make a test folder with `hud_min.html`, `hud_min.js` and a file named exactly `state` (no extension) that holds the
JSON. Serve it with `python3 -m http.server 8000` and open `http://localhost:8000/hud_min.html`. The page reads the
`state` file as if it were `/state`. Edit the file between cases (the page updates within a second).
Use a headless browser (Playwright/Chromium) to take a screenshot of each case and **look at them**.

| # | `state` content (essentials) | Must see |
|---|---|---|
| 1 | all empty strings, `providers: {}` | empty card, text `waiting for answer…`, no pills |
| 2 | mode `QA`, status `DONE`, provider `model-a`, answer `• 결론: {g}citation{/g} 사용\n• {r}Trade-off: recall{/r}\n• {y}evals{/y}` | 3 pills (yellow/green/green), green + red + yellow words, yellow dots |
| 3 | status `THINKING`, answer empty | pill THINKING in yellow, `waiting for answer…` |
| 4 | answer = a JSON string `{"answer":"• ok {g}x{/g}"}` | shows `ok x` (green x), no braces |
| 5 | answer with a fenced code block (3 backticks, `console.log(1)`) | dark monospace box, fences not shown |
| 6 | question `Q?\n(a) one\n✔ (b) two` | `(a)` grey, `✔ (b)` green bold |
| 7 | answer `<script>alert(1)</script> {{g}}w{{/g}} {r}open` | script text shown as text, `w` green, `{r}open` literal |
| 8 | stop the server | pill `offline` in red; screen content unchanged |
| 9 | any case, run in the console: attach a `MutationObserver` to `document.body`, wait 2 s | zero mutations while the state is unchanged |

Also check at a 390 px wide viewport (phone): nothing overflows horizontally, long Korean lines wrap.

## 6. Report

Only when **every** row of §5 passes, reply with:

- the two files;
- a table: test # → PASS/FAIL, with the screenshot file name for each;
- the size in bytes of both files (together ≤ 12 KB).

If anything fails: fix it, rerun all tests. If you cannot make a test pass, say **FAILED** with the test number and what you see.
Never write DONE without the table and screenshots.
