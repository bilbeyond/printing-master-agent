# -*- coding: utf-8 -*-
"""生成临时交互测试页 _uitest.html（跑完截图后删除）。"""
import io, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = io.open(os.path.join(BASE, 'index.html'), encoding='utf-8').read()

CLEAR = ('<script>try{localStorage.clear()}catch(e){}</script>\n'
         '<style>*{animation:none !important;transition:none !important}</style>\n')

DRIVER = """<script>
(function () {
  var p = new URLSearchParams(location.search);
  var step = p.get('step') || 'chat';
  var q = p.get('q') || '250g 哑粉纸折页爆色怎么处理？';
  function fire(text) {
    var i = document.querySelector('#input');
    i.value = text;
    document.querySelector('#sendBtn').click();
  }
  setTimeout(function () {
    if (step === 'chat' || step === 'related' || step === 'nomatch' || step === 'catalog') {
      fire(step === 'nomatch' ? '明天股市会不会涨' : (step === 'catalog' ? '知识库里都有什么内容？' : q));
      setTimeout(function () {
        if (step === 'related') { var c = document.querySelector('.rel-chip'); if (c) c.click(); }
      }, 2400);
    } else if (step === 'preview') {
      var rows = document.querySelectorAll('.kb-file');
      var target = rows[4] || rows[0];
      target.querySelector('[data-act="preview"]').click();
    } else if (step === 'tools') {
      document.querySelector('.pager-btn[data-page="tools"]').click();
    } else if (step === 'history') {
      fire('文件出血要留多少？');
      setTimeout(function () { fire('专色什么时候必须用？'); }, 2400);
    } else if (step === 'long') {
      fire('常见印刷故障有哪些？');
    }
  }, 400);
})();
</script>
"""

out = src.replace('<script src="data/knowledge.js"></script>', CLEAR + '<script src="data/knowledge.js"></script>')
out = out.replace('</body>', DRIVER + '</body>')
io.open(os.path.join(BASE, '_uitest.html'), 'w', encoding='utf-8').write(out)
print('wrote _uitest.html')
