import OpenAI from "openai";
import fs from "fs";
import path from "path";

// ── 初始化 ──────────────────────────────────────────

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
});

function findDir(...segments: string[]): string {
  const candidates = [
    path.join(process.cwd(), ...segments),
    path.join(process.cwd(), "ShopAgent AI", ...segments),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

function loadJSON<T>(...pathSegments: string[]): T | null {
  const candidates = [
    path.join(process.cwd(), ...pathSegments),
    path.join(process.cwd(), "ShopAgent AI", ...pathSegments),
  ];
  for (const fp of candidates) {
    if (fs.existsSync(fp)) {
      try {
        const raw = fs.readFileSync(fp, "utf-8");
        const cleaned = raw.replace(/,\s*([}\]])/g, "$1");
        return JSON.parse(cleaned) as T;
      } catch (err) {
        console.error(`[loadJSON] 解析失败: ${fp}`, (err as Error).message);
      }
    }
  }
  console.error(`[loadJSON] 找不到文件: ${pathSegments.join("/")}`);
  return null;
}

const PRODUCTS_DIR = findDir("products");

// ── 店铺规则加载（唯一真实来源） ────────────────────

interface StoreRules {
  store_identity: { role: string; brand_name: string; brand_type: string };
  business_rules: {
    discount_policy: string;
    gift_policy: string;
    shipping_time: string;
    rush_order: string;
    customization: string;
    return_policy: string;
    repair_policy: string;
  };
  assistant_rules: {
    cannot_invent_products: boolean;
    cannot_invent_discounts: boolean;
    cannot_invent_store_items: boolean;
    cannot_claim_designer_identity: boolean;
    must_answer_naturally: boolean;
    prefer_short_reply: boolean;
  };
}

let storeRules: StoreRules | null = null;

function loadStoreRules(): StoreRules {
  if (storeRules) return storeRules;
  const rules = loadJSON<StoreRules>("knowledge", "store_rules.json");
  if (rules) {
    storeRules = rules;
    console.log("[loadStoreRules] 加载成功");
  } else {
    // fallback（不应该走到这里）
    storeRules = {
      store_identity: { role: "客服", brand_name: "小拾光", brand_type: "原创手工饰品店" },
      business_rules: {
        discount_policy: "页面价格已是当前最优惠价格",
        gift_policy: "店铺没有赠品",
        shipping_time: "下单后5天内发货",
        rush_order: "手工制作需按排单顺序，暂时不支持加急",
        customization: "支持长度定制",
        return_policy: "支持7天无理由退换",
        repair_policy: "正常佩戴断裂可寄回免费维修",
      },
      assistant_rules: {
        cannot_invent_products: true,
        cannot_invent_discounts: true,
        cannot_invent_store_items: true,
        cannot_claim_designer_identity: true,
        must_answer_naturally: true,
        prefer_short_reply: true,
      },
    };
    console.warn("[loadStoreRules] 使用 fallback 规则");
  }
  return storeRules;
}

function buildStoreKnowledge(): string {
  const r = loadStoreRules();
  return `【店铺经营规则 —— store_rules.json 是唯一真实来源】

身份：
- 你是${r.store_identity.brand_name}的店员（客服），不是设计师，不是创始人
- 不能说"我设计的""我们亲手做的"，可以说"这是我们店原创设计的"
- 店铺类型：${r.store_identity.brand_type}

经营规则（必须严格遵守）：
- 优惠：${r.business_rules.discount_policy}
- 赠品：${r.business_rules.gift_policy}
- 发货：${r.business_rules.shipping_time}
- 加急：${r.business_rules.rush_order}
- 定制：${r.business_rules.customization}
- 退换：${r.business_rules.return_policy}
- 售后维修：${r.business_rules.repair_policy}

商品范围（极其重要）：
- 本店只卖：手链、项链（原创手工饰品）
- 本店不卖：丝巾、包包、衣服、戒指、耳环、鞋子、帽子
- 绝对不能编造不存在的商品类别
- 不能说"店里也有""可以一起买""可以搭配店里的XXX"——除非XXX是真实商品

行为规则：
- 不能编造商品：${r.assistant_rules.cannot_invent_products ? "是" : "否"}
- 不能编造优惠：${r.assistant_rules.cannot_invent_discounts ? "是" : "否"}
- 不能编造店铺物品：${r.assistant_rules.cannot_invent_store_items ? "是" : "否"}
- 不能说自己是设计师：${r.assistant_rules.cannot_claim_designer_identity ? "是" : "否"}
- 必须自然回答：${r.assistant_rules.must_answer_naturally ? "是" : "否"}
- 优先短回复：${r.assistant_rules.prefer_short_reply ? "是" : "否"}`;
}

// ── FAQ 数据加载 ────────────────────────────────────

interface FAQEntry { question: string; answer: string; }

let faqData: FAQEntry[] = [];

function loadFAQData(): FAQEntry[] {
  if (faqData.length > 0) return faqData;
  const data = loadJSON<FAQEntry[]>("knowledge", "store_faq.json");
  if (data) {
    faqData = data;
    console.log(`[loadFAQData] 加载了 ${faqData.length} 条 FAQ`);
  }
  return faqData;
}

// ── 关键词提取（中文） ──────────────────────────────

function extractKeywords(text: string): Set<string> {
  const kw = new Set<string>();
  const c = text.replace(/[，。？?！!、\s\/\\·\-,.，。]/g, "");
  for (let i = 0; i < c.length - 1; i++) kw.add(c.substring(i, i + 2));
  for (let i = 0; i < c.length - 2; i++) kw.add(c.substring(i, i + 3));
  return kw;
}

// ── FAQ 匹配 ────────────────────────────────────────

function matchFAQ(message: string): FAQEntry | null {
  const faqs = loadFAQData();
  if (faqs.length === 0) return null;

  const msgKW = extractKeywords(message);
  let bestScore = 0, bestHits = 0;
  let bestMatch: FAQEntry | null = null;

  for (const faq of faqs) {
    const faqKW = extractKeywords(faq.question);
    let int = 0;
    for (const kw of msgKW) { if (faqKW.has(kw)) int++; }
    const union = msgKW.size + faqKW.size - int;
    const jac = union > 0 ? int / union : 0;

    const terms = extractCoreTerms(faq.question);
    let hits = 0;
    for (const t of terms) { if (message.includes(t)) hits++; }

    const score = jac + hits * 0.25;
    if (score > bestScore) { bestScore = score; bestHits = hits; bestMatch = faq; }
  }

  const threshold = bestHits > 0 ? 0.25 : 0.35;
  if (bestMatch && bestScore >= threshold) {
    console.log(`[matchFAQ] ✓ score=${bestScore.toFixed(3)} hits=${bestHits} → "${bestMatch.question}"`);
    return bestMatch;
  }
  console.log(`[matchFAQ] ✗ best=${bestScore.toFixed(3)} hits=${bestHits}`);
  return null;
}

function extractCoreTerms(question: string): string[] {
  const map: Record<string, string[]> = {
    "会褪色/掉色吗？": ["褪色", "掉色"],
    "天然石/贝壳有瑕疵正常吗？": ["天然石", "贝壳", "瑕疵"],
    "可以戴着洗澡/游泳吗？": ["洗澡", "游泳"],
    "可以定制长度吗？": ["定制", "长度"],
    "手围/颈围怎么选？不合适能改吗？": ["手围", "颈围", "尺寸", "不合适"],
    "收到的饰品和图片有色差正常吗？": ["色差"],
    "怎么保养能让饰品戴得更久？": ["保养"],
    "饰品可以碰水吗？": ["碰水", "沾水", "防水"],
    "可以作为礼物送人吗？有包装吗？": ["礼物", "送人", "包装", "送礼"],
    "买多件可以帮忙搭配叠戴吗？": ["叠戴", "搭配"],
    "什么时候发货？": ["发货"],
    "包邮吗？运费怎么算？": ["包邮", "运费"],
    "可以退换吗？": ["退换", "退货", "换货"],
    "饰品断了/坏了可以售后吗？": ["断了", "坏了", "售后", "维修"],
    "饰品会过敏吗？": ["过敏"],
  };
  if (map[question]) return map[question];
  const c = question.replace(/[？?\/·]/g, "");
  const terms: string[] = [];
  for (let i = 0; i < c.length - 1; i++) {
    const ch = c.substring(i, i + 2);
    if (!/^[的吗能可不有会怎]./.test(ch) && !/^.[的吗能可不有会怎]/.test(ch)) terms.push(ch);
  }
  return terms;
}

// ── 商品 ID 检测 ────────────────────────────────────

function detectProductId(message: string): string | null {
  const m = message.match(/AW\d{3}/i);
  return m ? m[0].toUpperCase() : null;
}

// ── 商品数据读取 ────────────────────────────────────

function loadProduct(productId: string): string | null {
  const fp = path.join(PRODUCTS_DIR, `${productId}.json`);
  try {
    const raw = fs.readFileSync(fp, "utf-8");
    const p = JSON.parse(raw.replace(/,\s*([}\]])/g, "$1"));
    return `【商品：${p.id}】
名称：${p.name} / 类别：${p.category} / 价格：¥${p.price}
材质：${p.materials.join("、")}
颜色：${p.colors.join("、")}
风格：${p.style_tags.join("、")}
场景：${p.suitable_for.join("、")}
人群：${p.target_users.join("、")}
店主描述：${p.brand_voice_description}`;
  } catch (err) {
    console.error("[loadProduct] 失败:", fp, (err as Error).message);
    return null;
  }
}

// ── 情绪识别 ────────────────────────────────────────

type Emotion = "urgent" | "dissatisfied" | "worried" | "hesitant" | "neutral";

function detectEmotion(message: string): { emotion: Emotion; label: string } {
  if (["着急", "快点", "赶紧", "急用", "马上", "尽快", "提前", "来不及",
    "赶时间", "加急", "催", "等不及", "太慢", "太晚", "晚了", "急"].some(k => message.includes(k)))
    return { emotion: "urgent", label: "着急" };
  if (["太贵", "不好看", "不喜欢", "失望", "不值", "不满意", "一般般",
    "质量差", "有点贵", "贵了", "不划算"].some(k => message.includes(k)))
    return { emotion: "dissatisfied", label: "不满意" };
  if (["怕", "担心", "会不会掉", "会不会褪", "会不会过敏", "容易坏",
    "容易断", "靠不靠谱", "没问题吧", "真的吗", "确定吗"].some(k => message.includes(k)))
    return { emotion: "worried", label: "担心" };
  if (["纠结", "不确定", "再看看", "考虑", "选哪个", "犹豫", "会不会显",
    "会不会太", "值得吗", "不知道选", "哪个好", "适合我吗"].some(k => message.includes(k)))
    return { emotion: "hesitant", label: "犹豫" };
  return { emotion: "neutral", label: "普通咨询" };
}

// ── 意图分类 ────────────────────────────────────────

type IntentType = "faq" | "product" | "aesthetic";

function classifyIntent(msg: string, pid: string | null): { type: IntentType; faq: FAQEntry | null; productId: string | null } {
  const faq = matchFAQ(msg);
  if (faq) return { type: "faq", faq, productId: null };
  if (pid) return { type: "product", faq: null, productId: pid };
  if (["材质", "材料", "什么做", "多少钱", "价格", "现货", "库存"].some(k => msg.includes(k)))
    return { type: "product", faq: null, productId: null };
  return { type: "aesthetic", faq: null, productId: null };
}

// ── System Prompts ──────────────────────────────────

const BASE_RULES = `【回复风格 —— 极其重要】
- 大部分回复控制在 20~50 字，最多不超过 3 句话
- 像微信聊天一样短句，不要长篇描述
- 允许口语：嗯嗯、可以的、差不多、会更顺一点、不会特别贴脖子
- 禁止：长篇文艺描述、AI 总结式表达
- 禁止高频使用：高级感、氛围感、松弛感（最多用一个）

【身份边界 —— 极其重要】
- 你是店员客服，不是设计师，不是创始人
- 不能说：我设计的、我们亲手做的
- 正确说法：这是我们店原创设计的

【不确定就说】
- 不知道就说：不太确定哦 / 这个我确认不了
- 绝对不能编造

【关于"项链戴到哪里"的问题】
- 优先回答佩戴位置 + 视觉感觉
- 例如：差不多在锁骨下面一点，不会特别贴脖子，会有一点垂感
- 再补充具体数据（如果有的话）`;

function baseSystem(extraRules: string): string {
  return `${buildStoreKnowledge()}

${BASE_RULES}

${extraRules}`;
}

const FAQ_SYSTEM = (faqAnswer: string, emotionLabel: string) => baseSystem(`
顾客情绪：${emotionLabel}

以下是 FAQ 参考信息（只能基于此回答，用自然聊天语气重新表达，不要原文照搬）：
"""
${faqAnswer}
"""

要求：
1. ${emotionLabel !== "普通咨询" ? "先一句话回应顾客情绪，然后" : ""}用聊天语气给出信息
2. 不能照搬原文，要用自己的话自然地说
3. 不添加 FAQ 中没有的信息`);

const PRODUCT_SYSTEM = (productBlock: string) => baseSystem(`
=== 商品数据（唯一来源） ===
${productBlock}
=== 商品数据结束 ===

要求：
1. 先回应情绪（如有），再回答
2. 商品信息只能从上面引用，绝对不能编造
3. 短句，一次 2~3 句`);

const AESTHETIC_SYSTEM = baseSystem(`
顾客在聊审美/搭配/风格相关的问题。

要求：
1. 先回应情绪（如有），再聊
2. 像懂穿搭的朋友给建议，一次 2 句
3. 聊感觉、聊场景，不套模板
4. 不确定就说不太确定`);

// ── SSE 流式工具 ────────────────────────────────────

function createSSEStream() {
  const encoder = new TextEncoder();
  let ctrl: ReadableStreamDefaultController;
  const stream = new ReadableStream({ start(c) { ctrl = c; } });
  return {
    stream,
    send(text: string) { ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`)); },
    done() { ctrl.enqueue(encoder.encode("data: [DONE]\n\n")); ctrl.close(); },
  };
}

async function streamLLM(
  sse: ReturnType<typeof createSSEStream>,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
) {
  const apiMessages = [
    { role: "system" as const, content: systemPrompt },
    ...messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];
  const resp = await client.chat.completions.create({
    model: "deepseek-chat",
    messages: apiMessages,
    stream: true,
    temperature: 0.7,
    max_tokens: maxTokens,
  });
  for await (const chunk of resp) {
    const d = chunk.choices[0]?.delta?.content;
    if (d) sse.send(d);
  }
  sse.done();
}

// ── POST Handler ────────────────────────────────────

export async function POST(request: Request) {
  try {
    const { messages } = await request.json();
    if (!messages || !Array.isArray(messages)) {
      return Response.json({ error: "messages 参数缺失或格式错误" }, { status: 400 });
    }

    // 确保规则已加载
    loadStoreRules();
    loadFAQData();

    const lastUserMsg = [...messages].reverse().find(
      (m: { role: string }) => m.role === "user"
    );
    const userMessage: string = lastUserMsg?.content || "";
    const productIdFromMsg = detectProductId(userMessage);

    const intent = classifyIntent(userMessage, productIdFromMsg);
    const emotion = detectEmotion(userMessage);

    console.log("[POST] emotion:", emotion.label,
      "| intent:", intent.type,
      "| faq:", intent.faq?.question || "-",
      "| productId:", intent.productId || "-");

    const sse = createSSEStream();

    if (intent.type === "faq" && intent.faq) {
      // FAQ 全部走 LLM 自然化，不再机械复读
      console.log("[POST] FAQ → LLM 自然化");
      const prompt = FAQ_SYSTEM(intent.faq.answer, emotion.label);
      streamLLM(sse, prompt, messages, 200);
    } else if (intent.type === "product") {
      let productBlock: string;
      if (intent.productId) {
        const ctx = loadProduct(intent.productId);
        productBlock = ctx
          ? `顾客当前在看的商品：\n${ctx}`
          : `顾客提到了 ${intent.productId}，但系统中没有找到。如实告知。`;
      } else {
        productBlock = "顾客在问商品相关信息，但没有指定商品编号。请顾客提供编号（如 AW001）。不得编造。";
      }
      console.log("[POST] Product → LLM");
      streamLLM(sse, PRODUCT_SYSTEM(productBlock), messages, 250);
    } else {
      console.log("[POST] Aesthetic → LLM");
      streamLLM(sse, AESTHETIC_SYSTEM, messages, 180);
    }

    return new Response(sse.stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return Response.json({ error: "对话请求失败，请稍后重试" }, { status: 500 });
  }
}
