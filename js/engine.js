/**
 * 印匠 · 知识库检索问答引擎
 * 纯本地检索：中文 bigram/trigram + 同义词扩展 + IDF 加权 + 标题加权，
 * 命中后抽取最相关句子/条目生成结构化回答（含引用出处与延伸话题）。
 * 同时兼容浏览器（window.KBEngine）与 Node（module.exports），便于离线校准。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KBEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ---------------- 同义词 / 口语扩展 ---------------- */
  const SYNONYMS = {
    '多少钱': '价格 报价 成本 费用',
    '价格': '报价 成本 单价 费用',
    '报价': '价格 成本 费用 开机费',
    '贵': '价格 成本 报价',
    '便宜': '成本 报价 省钱 拼版',
    '省钱': '成本 拼版 报价',
    '掉色': '掉墨 附着力 脱落',
    '脱色': '掉墨 附着力',
    '出血': 'bleed 出血位 裁切',
    '分辨率': 'dpi 清晰度 图片',
    '清晰度': 'dpi 分辨率 糊',
    '糊': '分辨率 网点 糊版 发虚',
    '转曲': '字体 曲线 路径 缺字体',
    '字体': '转曲 缺字体 文字',
    '克重': 'gsm g 纸张重量 厚度',
    '厚度': '克重 厚度 毫米 mm',
    '开数': '开 拼版 用纸 尺寸',
    '色差': 'ΔE deltaE 偏色 对色',
    '偏色': '色差 对色 追色',
    '偏暗': '色差 暗 颜色 屏幕',
    '专色': 'pantone 潘通 金 银 特色',
    '金色': '烫金 金墨 专色',
    '烫金': '烫印 电化铝 金色',
    '覆膜': '过膜 亮膜 哑膜 触感膜',
    '上光': '过油 上光油 水性',
    '装订': '胶装 骑马钉 锁线 精装',
    '套印': '套准 重影 不准 跑位',
    '墨杠': '杠子 齿轮杠 墨路',
    '过底': '背印 蹭脏 反印',
    '干燥': '不干 发粘 干退',
    '小批量': '少量 几十份 数码印刷 起印',
    '起印': '起印量 最少 小批量',
    '交期': '工期 多久 出货 时间',
    '工期': '交期 多久 出货',
    '画册': '封面 内页 装订 特种纸',
    '名片': '白卡 名片纸 特种纸',
    '包装盒': '盒子 卡纸 模切 瓦楞',
    '手提袋': '袋子 牛皮纸 白卡 绳',
    '不干胶': '贴纸 标签 sticker',
    '贴纸': '不干胶 标签 防水',
    '电子文件': '源文件 pdf 格式 交付',
    '文件': '源文件 格式 交付 出血',
    '对色': '色卡 光源 色差 打样',
    '打样': '数码样 传统打样 看色',
    '温湿度': '温湿度 环境 湿度 温度',
    '参数': '参数 设置 压力 速度 温度'
  };

  const STOP = new Set([
    '什么', '怎么', '如何', '请问', '一下', '可以', '这个', '那个', '我们', '你们', '是不', '不是',
    '有没有', '应该', '需要', '就是', '如果', '以及', '还有', '哪些', '为什么', '多少', '不会', '会不会',
    '能不', '能不能', '可不可以', '可以吗', '怎样', '怎么办', '怎样办', '这么', '那么', '这些', '那些',
    '今天', '明天', '昨天', '现在', '然后', '其实', '但是', '因为', '所以', '的话', '一个', '东西',
    '事情', '问题', '知道', '觉得', '想要', '希望', '谢谢', '麻烦', '帮我', '我的', '你的', '他有',
    '吗', '呢', '吧', '啊', '呀', '哦', '嗯', '了', '的', '是', '在', '有', '和', '与', '就', '都', '也',
    '是什么', '什么是', '怎么回事', '怎样做', '什么样的', '咋'
  ]);
  const MIN_SCORE = 3.2;
  /** 短问句（如「压痕」「出血留多少」）本身命中词少，阈值要放宽 */
  function minScoreFor(query) {
    const n = tokenize(query).size;
    if (n <= 2) return 1.35;
    if (n <= 4) return 2.2;
    return MIN_SCORE;
  }

  /* ---------------- 文本工具 ---------------- */
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s\u3000]+/g, '').replace(/[，。、；：？！“”"'（）()《》【】\[\]…·,.;:?!/\\|-]/g, '');

  function tokenize(text) {
    const toks = new Map(); // token -> weight
    const raw = String(text || '');
    const push = (t, w) => {
      if (!t || STOP.has(t)) return;
      toks.set(t, Math.max(toks.get(t) || 0, w));
    };
    (raw.toLowerCase().match(/[a-z][a-z0-9.+#-]*|\d+(?:\.\d+)?/g) || []).forEach((w) => {
      if (w.length >= 2 || /^\d/.test(w)) push(w, w.length >= 3 ? 2.2 : 1.5);
    });
    const runs = raw.match(/[\u4e00-\u9fa5]+/g) || [];
    runs.forEach((run) => {
      if (run.length === 1) push(run, 1);
      for (let i = 0; i < run.length - 1; i++) push(run.slice(i, i + 2), 1.6);
      for (let i = 0; i < run.length - 2; i++) push(run.slice(i, i + 3), 2.6);
      if (run.length >= 4 && run.length <= 12) push(run, 4.2);
    });
    const n = norm(raw);
    Object.keys(SYNONYMS).forEach((k) => {
      if (n.indexOf(k) > -1) {
        SYNONYMS[k].split(/\s+/).forEach((w) => {
          const sub = tokenizeBasic(w);
          sub.forEach((t) => { if (!toks.has(t)) toks.set(t, 1.2); });
        });
      }
    });
    return toks;
  }

  function tokenizeBasic(text) {
    const out = [];
    const raw = String(text || '');
    (raw.toLowerCase().match(/[a-z][a-z0-9.+#-]*|\d+(?:\.\d+)?/g) || []).forEach((w) => out.push(w));
    const runs = raw.match(/[\u4e00-\u9fa5]+/g) || [];
    runs.forEach((run) => {
      if (run.length <= 3) out.push(run);
      for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
    });
    return out;
  }

  const sentences = (text) =>
    String(text || '')
      .split(/(?<=[。！？；!?;])|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3);

  /* ---------------- 建立索引 ---------------- */
  function buildIndex(files) {
    const chunks = [];
    (files || []).forEach((file) => {
      if (file.enabled === false) return;
      const lines = String(file.content || '').split(/\r?\n/);
      let section = file.name.replace(/\.[^.]+$/, '');
      let buf = [];
      const flush = () => {
        const body = buf.join('\n').trim();
        if (body) {
          chunks.push({
            fileId: file.id,
            fileName: file.name,
            category: file.category || '知识库',
            section,
            text: body,
            userUploaded: !!file.userUploaded
          });
        }
        buf = [];
      };
      lines.forEach((line) => {
        const h = line.match(/^\s*#{1,6}\s+(.*)$/);
        if (h) { flush(); section = h[1].trim(); return; }
        buf.push(line);
      });
      flush();
    });

    const N = chunks.length || 1;
    const df = new Map();
    chunks.forEach((c) => {
      c.tf = tokenize(c.text);
      c.titleTf = tokenize(c.section + ' ' + c.fileName + ' ' + (c.category || ''));
      // 要点行开头（术语词条）单独提权，便于「烫金」「压痕」这类词点查询命中
      const heads = [];
      String(c.text).split(/\n+/).forEach((line) => {
        const m = line.match(/^\s*[-*·•]\s+(.+)$/);
        if (!m) return;
        const clean = m[1].split('：')[0].split('(')[0].split('（')[0].trim();
        if (clean && clean.length <= 14) heads.push(clean);
      });
      c.headTf = heads.length ? tokenize(heads.join(' ')) : new Map();
      c.len = Math.max(20, c.text.length);
      const seen = new Set();
      c.tf.forEach((_w, t) => { seen.add(t); });
      c.titleTf.forEach((_w, t) => seen.add(t));
      c.headTf.forEach((_w, t) => seen.add(t));
      seen.forEach((t) => df.set(t, (df.get(t) || 0) + 1));
    });
    const idf = (t) => Math.log(1 + N / (1 + (df.get(t) || 0))) + 0.35;

    return { files: files || [], chunks, idf, N };
  }

  /* ---------------- 检索打分 ---------------- */
  function search(query, index, limit) {
    const idf = index.idf;
    _idfRef = idf;
    const q = tokenize(query);
    const qn = norm(query);
    // 术语词条（要点行开头）提权只对小词查询生效：问「烫金」要直接命中词条，
    // 问长句子则靠正文语义，避免某个词条把整段问题带偏。
    const headBoost = q.size <= 4 ? 1.9 : 1;
    const scored = index.chunks.map((c) => {
      let score = 0;
      let hit = 0;
      q.forEach((qw, t) => {
        const inBody = c.tf.get(t) || 0;
        const inTitle = c.titleTf.get(t) || 0;
        const inHead = c.headTf ? (c.headTf.get(t) || 0) : 0;
        if (inBody) { score += qw * inBody * idf(t); hit++; }
        if (inTitle) { score += qw * inTitle * idf(t) * 2.1; hit++; }
        if (inHead) { score += qw * inHead * idf(t) * headBoost; hit++; }
      });
      // 长度归一，避免长条目天然占优
      score = score / Math.log(2 + c.len / 60);
      // 长词整体命中加成
      if (qn.length >= 4) {
        const body = norm(c.text);
        if (body.indexOf(qn) > -1) score += 6;
      }
      // 少量命中惩罚，避免只有一个"纸"字就上榜
      const coverage = q.size ? hit / (q.size * 2) : 0;
      score *= 0.55 + Math.min(1, coverage) * 0.75;
      return { chunk: c, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score > 0.35).slice(0, limit || 6);
  }

  /* ---------------- 句子抽取 ---------------- */
  function scanPoints(chunk, query) {
    const q = tokenize(query);
    const items = [];
    String(chunk.text).split(/\n+/).forEach((line) => {
      const bullet = /^\s*[-*·•]\s+/.test(line);
      const clean = line.replace(/^\s*[-*·•]\s+/, '').replace(/^\s*\d+[.、)]\s*/, '').trim();
      if (!clean || clean.length < 4) return;
      let s = 0;
      const n = norm(clean);
      q.forEach((w, t) => { if (n.indexOf(t) > -1) s += w * idfToken(t); });
      // 要点式短句加权，长段落降权
      s += clean.length <= 46 ? 1.4 : 0.1;
      items.push({ text: clean, bullet: bullet || clean.length <= 46, score: s, chunk });
    });
    return items;
  }

  /** 从多个命中块里统一择优抽取要点：主命中块加权，保证要点本身最贴题 */
  function collectPoints(hits, query, max) {
    const pool = [];
    hits.forEach((h, i) => {
      scanPoints(h.chunk, query).forEach((it) => {
        it.score = it.score * (i === 0 ? 1.35 : 1);
        pool.push(it);
      });
    });
    pool.sort((a, b) => b.score - a.score);
    const out = [];
    const seen = new Set();
    pool.forEach((it) => {
      if (out.length >= (max || 4)) return;
      const key = norm(it.text).slice(0, 24);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(it);
    });
    return out;
  }

  /** 用「贡献分最高的块」作为回答的落点；检索优势明显时直接以检索第一名为准 */
  function pickAnchor(picked, hits) {
    const primary = hits[0].chunk;
    if (!picked.length) return primary;
    const decisive = !hits[1] || hits[0].score >= hits[1].score * 1.6;
    if (decisive) return primary;

    const agg = new Map();
    picked.forEach((p) => agg.set(p.chunk, (agg.get(p.chunk) || 0) + p.score));
    let anchor = primary, best = agg.get(primary) || 0;
    agg.forEach((sum, chunk) => {
      if (chunk !== primary && sum > best * 1.25) { best = sum; anchor = chunk; }
    });
    return anchor;
  }

  let _idfRef = null;
  const idfToken = (t) => (_idfRef ? _idfRef(t) : 1);

  const TIP_RULES = /(注意|提醒|建议|千万|务必|不要|避免|容易|宁可|优先|踩坑|风险)/;

  function pickTip(chunks, used, query) {
    const q = tokenize(query || '');
    const cands = [];
    chunks.forEach((c) => {
      String(c.text).split(/\n+/).forEach((line) => {
        const clean = line.replace(/^\s*[-*·•]\s+/, '').trim();
        if (clean.length < 8 || clean.length > 60) return;
        if (!TIP_RULES.test(clean)) return;
        if (used.indexOf(clean) > -1) return;
        const n = norm(clean);
        let s = 0;
        q.forEach((w, t) => { if (n.indexOf(t) > -1) s += w; });
        cands.push({ text: clean, score: s });
      });
    });
    if (!cands.length) return null;
    cands.sort((a, b) => b.score - a.score);
    return cands[0];
  }

  const OPENERS = [
    (t) => '关于「' + t + '」，先把结论放前面：',
    (t) => '这个我熟，按「' + t + '」给你捋一捋：',
    (t) => '上机几十年，' + t + '这块的经验大概是这样：',
    (t) => '「' + t + '」我按知识库里的记录答你：',
    (t) => '「' + t + '」的关键点，我给你拎出来：'
  ];

  const GREET = /^(你好|您好|hi|hello|在吗|嗨|早上好|下午好|晚上好|嗨喽)/i;
  const INTRO = /(你是谁|介绍一下你自己|介绍一下自己|自我介绍|你叫什么|你会做什么|你能做什么|你会什么|能干什么|什么智能体|你是什么)/;
  const CATALOG = /(知识库|资料库|文档库).{0,4}(都|里面|里有|中有|有什么|有哪些|包含|目录|内容)|(都|里面)?(有)(什么|哪些)(资料|内容|文件|知识)/;

  function catalog(index) {
    const files = (index.files || []).filter((f) => f.enabled !== false);
    const points = files.map((f) => {
      const secs = index.chunks.filter((c) => c.fileId === f.id).map((c) => c.section);
      return {
        text: '《' + f.name + '》· ' + (f.category || '知识库') + ' · ' + secs.length + ' 个小节：' + secs.join(' / '),
        bullet: true
      };
    });
    const totalChunks = index.chunks.length;
    return {
      kind: 'catalog',
      lead: '知识库里现在装着 ' + files.length + ' 份资料、共 ' + totalChunks + ' 个知识小节，都是可以直接查的：',
      points: points,
      tips: ['问具体的比问笼统的管用，比如「烫金前要不要先覆膜」，我会直接定位到对应文件和小节，把出处标给你。'],
      sources: files.map((f) => ({ fileId: f.id, fileName: f.name, section: f.category || '知识库', category: f.category || '知识库' })),
      related: ['常见印刷故障都有哪些？', '印前文件有什么规范？', '印后工艺怎么搭配？', '小批量印刷怎么报价？']
    };
  }

  function intro(index) {
    const cats = [];
    ((index && index.files) || []).forEach((f) => {
      if (f.enabled !== false && cats.indexOf(f.category) < 0) cats.push(f.category);
    });
    return {
      kind: 'intro',
      lead: '我是印匠，一位在印刷车间里泡了几十年的老师傅。印前文件、纸张材料、色彩管理、上机故障、印后工艺、成本报价——你能想到的印刷问题，基本都能跟我唠。',
      points: [
        { text: '我的回答全部来自右边「知识库」里的资料，每一条都会标出出处，你可以自己核对。', bullet: true },
        { text: '现在库里有这些板块：' + (cats.join('、') || '工艺选型、纸张材料、色彩管理、印前规范、故障排查、印后工艺、成本报价、参数速查') + '。', bullet: true },
        { text: '你也可以把自己的资料（.md / .txt / .csv / .json）拖到右边窗口，我学完就按你的标准答。', bullet: true }
      ],
      tips: ['问得越具体，答得越准。比如「250g 哑粉纸折页爆色怎么办」比「印刷有问题」好得多。'],
      sources: [],
      related: ['铜版纸和哑粉纸怎么选？', '文件出血要留多少？', '印出来比屏幕暗怎么办？', '只印 100 份怎么最省钱？']
    };
  }

  function answer(query, index) {
    _idfRef = index.idf;
    const raw = String(query || '').trim();
    if (!raw) return intro(index);
    if (GREET.test(raw) && raw.length <= 8) {
      const a = intro(index);
      a.lead = '哎，来了。' + a.lead;
      return a;
    }
    if (INTRO.test(raw)) return intro(index);
    if (CATALOG.test(raw)) return catalog(index);

    const hits = search(raw, index, 6);
    if (!hits.length || hits[0].score < minScoreFor(raw)) {
      const cats = [];
      (index.files || []).forEach((f) => { if (f.enabled !== false && cats.indexOf(f.category) < 0) cats.push(f.category); });
      return {
        kind: 'nomatch',
        lead: '这个问题我知识库里没找到对得上的内容，我不敢瞎编——印刷上的事，讲错了是要赔钱的。',
        points: [
          { text: '现在库里覆盖的板块：' + cats.join('、') + '。', bullet: true },
          { text: '换个说法再问一次通常就命中了，比如把「这个怎么弄」说成「覆膜起泡怎么处理」。', bullet: true },
          { text: '要是你手上有内部工艺标准、供应商规范，传到右边知识库窗口，我照着你的资料答。', bullet: true }
        ],
        tips: ['实在急着要答案，可以直接问我「知识库里都有什么」，我列个目录给你。'],
        sources: [],
        related: ['知识库里都有什么内容？', '常见印刷故障有哪些？', '印后工艺怎么选？']
      };
    }

    const top = hits.slice(0, 3).map((h) => h.chunk);
    const picked = collectPoints(hits.slice(0, 3), raw, 4);
    const anchor = pickAnchor(picked, hits);
    const points = picked.map((p) => ({ text: p.text, bullet: p.bullet !== false }));
    const usedTexts = picked.map((p) => p.text);

    const tip = pickTip(top, usedTexts, raw);
    const opener = OPENERS[(raw.length + anchor.section.length) % OPENERS.length];
    const srcMap = new Map();
    const srcOrder = picked.length ? [anchor].concat(top) : top;
    srcOrder.forEach((c) => {
      if (srcMap.size >= 3) return;
      const key = c.fileId + '|' + c.section;
      if (!srcMap.has(key)) srcMap.set(key, { fileId: c.fileId, fileName: c.fileName, section: c.section, category: c.category });
    });

    const related = [];
    hits.slice(0, 6).forEach((h) => {
      const s = h.chunk.section;
      if (s !== anchor.section && related.indexOf(s) < 0 && related.length < 3) related.push(s);
    });

    return {
      kind: 'answer',
      lead: opener(anchor.section),
      points: points,
      tips: tip ? [tip.text] : [],
      sources: [...srcMap.values()],
      related
    };
  }

  return { buildIndex, search, answer, tokenize, intro, norm };
});
