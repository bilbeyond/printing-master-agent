const fs = require('fs');
const path = require('path');
global.window = global;
const base = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(base, 'data/knowledge.js'), 'utf8'));
const engine = require(path.join(base, 'js/engine.js'));

const index = engine.buildIndex(global.KB_FILES);
console.log('chunks:', index.chunks.length);

const queries = [
  '铜版纸和哑粉纸怎么选？',
  '文件出血要留多少',
  '印出来比屏幕暗怎么办',
  '只印100份怎么最省钱',
  '套印不准是什么原因',
  '覆膜起泡怎么处理',
  '烫金和印金色有什么区别',
  '骑马钉最多多少页',
  '专色什么时候必须用',
  '车间温湿度控制在多少',
  '名片用什么纸好',
  '小字为什么印出来发虚',
  '画册封面怎么显得高级',
  '今天天气怎么样',
  '你会做什么'
];

queries.forEach((q) => {
  const hits = engine.search(q, index, 3);
  const a = engine.answer(q, index);
  console.log('\n=== ' + q);
  console.log('  hits: ' + hits.map((h) => h.chunk.fileName.replace(/\.md$/, '') + '/' + h.chunk.section + '(' + h.score.toFixed(2) + ')').join(' | '));
  console.log('  kind: ' + a.kind + ' | lead: ' + a.lead.slice(0, 40));
  a.points.forEach((p) => console.log('   · ' + p.text.slice(0, 70)));
  if (a.tips.length) console.log('   tip: ' + a.tips[0].slice(0, 60));
  console.log('  sources: ' + a.sources.map((s) => s.section).join(','));
  console.log('  related: ' + (a.related || []).join(' | '));
});
