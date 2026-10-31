(function() {
  const { fetch } = window;

  const esc = (s) => s.replace(/[&<>"'\/]/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      case '/': return '&#47;';
      default: return c;
    }
  });

  const fixTags = (s) => s.replace(/\{\{([a-z])\}\}|\{\/([a-z])\}/g, (match, p1, p2) => {
    if (p1) return `{${p1}}`;
    if (p2) return `{/${p2}}`;
    return match;
  });

  const inline = (text) => {
    const regex = /\{(y|g|b|r|q|k)\}([\s\S]*?)\{\/\1\}/gi;
    return text.replace(regex, (match, tag, content) => {
      return `<span class="c-${tag}">${esc(content)}</span>`;
    });
  };

  const renderAnswer = (text) => {
    if (!text) return `<div class="empty">waiting for answer…</div>`;
    
    const lines = text.split('\n').filter(line => line.trim() !== '');
    const result = [];
    
    let inCodeBlock = false;
    let codeLines = [];
    
    for (const line of lines) {
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          result.push('<pre class="code">' + esc(codeLines.join('\n')) + '</pre>');
          inCodeBlock = false;
          codeLines = [];
        } else {
          inCodeBlock = true;
          codeLines = [];
        }
        continue;
      }
      
      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }
      
      if (line.startsWith('{g}')) {
        continue;
      }
      
      if (line.startsWith('Q:')) {
        result.push(`<div class="topic">${esc(line.substring(2))}</div>`);
        continue;
      }
      
      if (line.startsWith('•')) {
        result.push(`<div class="bullet"><span class="dot">•</span><span>${esc(line.substring(1))}</span></div>`);
        continue;
      }
      
      if (line.startsWith('→')) {
        result.push(`<div class="concl">${esc(line.substring(1))}</div>`);
        continue;
      }
      
      if (line.startsWith('⚖')) {
        result.push(`<div class="tradeoff">${esc(line.substring(1))}</div>`);
        continue;
      }
      
      result.push(`<div class="line">${esc(line)}</div>`);
    }
    
    if (inCodeBlock) {
      result.push(`<pre class="code">${esc(codeLines.join('\n'))}</pre>`);
    }
    
    return result.join('');
  };

  const renderQuestion = (q) => {
    if (!q) return esc(q);
    
    const lines = q.split('\n');
    const result = [];
    
    for (const line of lines) {
      if (line.startsWith('✔')) {
        result.push(`<div class="ok">${esc(line)}</div>`);
      } else if (line.match(/^\s*\(?[a-eA-E][\).:]/)) {
        result.push(`<div class="opt">${esc(line)}</div>`);
      } else {
        result.push(`<div>${esc(line)}</div>`);
      }
    }
    
    return result.join('');
  };

  let lastSignature = '';
  
  function tick() {
    fetch('/state', { cache: 'no-store' })
      .then(response => {
        if (!response.ok) {
          document.getElementById('status').classList.add('offline');
          document.getElementById('status').textContent = 'offline';
          document.getElementById('status').hidden = false;
          return;
        }
        
        return response.json();
      })
      .then(data => {
        var p = data.providers || {}, sel = data.selected, answer = '';
        if (p[sel] && p[sel].answer) answer = p[sel].answer;
        else for (var k in p) if (p[k] && p[k].answer) { answer = p[k].answer; break; }
        
        const signature = `${data.qid},${data.question},${data.selected},${answer},${data.mode},${data.status}`;
        
        if (signature === lastSignature) return;
        
        lastSignature = signature;
        
        const statusPill = document.getElementById('status');
        const modePill = document.getElementById('mode');
        const provPill = document.getElementById('prov');
        
        statusPill.hidden = !data.status;
        modePill.hidden = !data.mode;
        provPill.hidden = !data.selected;
        
        if (data.status) {
          statusPill.className = `pill status ${data.status}`;
          statusPill.textContent = data.status;
        } else {
          statusPill.textContent = '';
        }
        
        if (data.mode) {
          modePill.textContent = data.mode;
        } else {
          modePill.textContent = '';
        }
        
        if (data.selected) {
          provPill.textContent = data.selected;
        } else {
          provPill.textContent = '';
        }
        
        let answerText = answer;
        
        if (answerText && answerText.startsWith('{') && answerText.endsWith('}')) {
          try {
            const parsed = JSON.parse(answerText);
            if (parsed.answer) {
              answerText = parsed.answer;
            }
          } catch (e) {
            // Ignore parsing error
          }
        }
        
        answerText = fixTags(answerText);
        answerText = inline(answerText);
        
        document.getElementById('question').innerHTML = renderQuestion(data.question);
        document.getElementById('answer').innerHTML = renderAnswer(answerText);
      })
      .catch(() => {
        document.getElementById('status').classList.add('offline');
        document.getElementById('status').textContent = 'offline';
        document.getElementById('status').hidden = false;
      });
  }
  
  tick();
  setInterval(tick, 300);
})();
