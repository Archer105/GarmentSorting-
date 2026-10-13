/**
 * AI 能力封装：模型选择、天气估算、穿搭生成、多轮对话。
 *
 * 全部走云端 LLM（免密钥）。接口只支持流式，因此统一用 stream:true 收集完整文本。
 * 每个请求的第一条消息必须是应用自有的 system 消息。
 */
const { cloud } = require('./cloud')

const OUTFIT_SYSTEM_PROMPT = [
  '你是一位专业、务实的中文穿搭顾问，服务对象是普通用户。',
  '硬性规则：',
  '1) 只能从用户提供的「衣橱清单」中选择单品，绝对不允许编造清单里没有的单品；',
  '2) item_ids 必须是清单里真实存在的数字 id；',
  '3) 优先选适合当前天气与温度的搭配，兼顾场合与颜色协调；',
  '4) 只输出 JSON，不要输出 Markdown 代码块、不要输出任何解释性文字。',
  'JSON 结构：{"title":"搭配名称","item_ids":[1,2],"reason":"一句话说明为什么这样搭","tips":["穿着提示"]}',
].join('\n')

const WEATHER_SYSTEM_PROMPT = [
  '你是天气常识助手。用户会给出城市与日期，请依据该城市该时段的气候常识给出「典型天气」估算。',
  '你不是实时天气接口，所以要在 desc 里说明这是气候估算。',
  '只输出 JSON，不要输出 Markdown 代码块或多余文字。',
  'JSON 结构：{"weather":"sunny|cloudy|overcast|rain|snow|wind|hot|cold","weather_label":"晴","temp_key":"lt0|0-10|10-18|18-24|24-30|gt30","temperature":"18~24℃","desc":"一句话说明"}',
].join('\n')

const CHAT_SYSTEM_PROMPT = [
  '你是用户的私人穿搭顾问，名字叫「小衣」。',
  '回答要求：用简体中文，口语化、简短有条理（一般不超过 200 字），必要时用短句分点。',
  '你可以参考下面提供的「衣橱清单」与「当前天气」来回答。',
  '只能推荐衣橱清单里真实存在的单品；清单里没有的，要明确告诉用户「你的衣橱里还没有这类单品」，并给出补充建议。',
  '不要编造单品的颜色、材质等信息。',
].join('\n')

let cachedModel = null
let modelsInflight = null

/** 取一个可用模型（禁用状态的不选） */
function getModel() {
  if (cachedModel) return Promise.resolve(cachedModel)
  if (modelsInflight) return modelsInflight
  modelsInflight = cloud.llm.models
    .list()
    .then((models) => {
      modelsInflight = null
      const list = Array.isArray(models) ? models : []
      const found = list.find((item) => item && item.disabled !== true)
      cachedModel = found || null
      return cachedModel
    })
    .catch(() => {
      modelsInflight = null
      return null
    })
  return modelsInflight
}

function resetModelCache() {
  cachedModel = null
}

function extractJson(text) {
  if (!text) return null
  const cleaned = String(text)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch (e) {
    return null
  }
}

/** 收集一次完整回复（内部仍是流式） */
async function collect(messages, temperature) {
  const model = await getModel()
  if (!model) return { ok: false, message: '暂无可用模型，请稍后再试' }

  let content = ''
  try {
    const stream = cloud.llm.chat.completions.create({
      model: model.id,
      messages: messages,
      stream: true,
      temperature: typeof temperature === 'number' ? temperature : 0.7,
    })
    for await (const chunk of stream) {
      const choice = chunk && chunk.choices && chunk.choices[0]
      const delta = choice && choice.delta
      if (delta && delta.content) content += delta.content
    }
  } catch (error) {
    const code = error && error.error ? error.error.code : null
    let message = 'AI 服务暂时不可用，请稍后重试'
    if (code && String(code).indexOf('quota_') === 0) message = 'AI 额度已用完或请求过于频繁'
    else if (code && String(code).indexOf('auth_') === 0) message = 'AI 调用未授权，请确认小程序已正确绑定'
    else if (code && String(code).indexOf('request_') === 0) message = 'AI 请求参数有误'
    return { ok: false, message: message }
  }
  if (!content) return { ok: false, message: 'AI 没有返回内容，请重试' }
  return { ok: true, content: content }
}

/** 把衣橱清单压缩成给模型的文本 */
function garmentsToText(garments) {
  if (!garments || !garments.length) return '（衣橱为空）'
  return garments
    .map((item) => {
      const parts = [`id=${item.id}`, item.name, item.category]
      if (item.color) parts.push(`颜色:${item.color}`)
      if (item.season) parts.push(`季节:${item.season}`)
      if (item.tags && item.tags.length) parts.push(`标签:${item.tags.join('/')}`)
      return '- ' + parts.join(' | ')
    })
    .join('\n')
}

function weatherToText(weather) {
  if (!weather) return '未提供天气信息'
  const bits = []
  if (weather.city) bits.push(`城市：${weather.city}`)
  if (weather.date) bits.push(`日期：${weather.date}`)
  if (weather.label) bits.push(`天气：${weather.label}`)
  if (weather.temperature) bits.push(`温度：${weather.temperature}`)
  if (weather.desc) bits.push(`补充：${weather.desc}`)
  return bits.join('；') || '未提供天气信息'
}

/** 生成穿搭方案（在已上传单品中选择） */
async function generateOutfit(garments, weather) {
  if (!garments || !garments.length) {
    return { ok: false, message: '衣橱还是空的，先上传几件衣服吧' }
  }
  const userPrompt = [
    '【当前天气】',
    weatherToText(weather),
    '',
    '【衣橱清单】',
    garmentsToText(garments),
    '',
    '请从上面清单中挑选单品，给出今天的一套搭配。',
  ].join('\n')

  const result = await collect(
    [
      { role: 'system', content: OUTFIT_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    0.6
  )
  if (!result.ok) return result

  const parsed = extractJson(result.content)
  if (!parsed) return { ok: false, message: 'AI 返回格式异常，请重试' }

  const validIds = {}
  garments.forEach((item) => {
    validIds[String(item.id)] = true
  })
  const ids = (Array.isArray(parsed.item_ids) ? parsed.item_ids : [])
    .map((v) => Number(v))
    .filter((v) => validIds[String(v)])

  if (!ids.length) return { ok: false, message: 'AI 没能选出合适单品，请重试' }

  return {
    ok: true,
    data: {
      title: parsed.title || '今日搭配',
      item_ids: ids,
      reason: parsed.reason || '',
      tips: Array.isArray(parsed.tips) ? parsed.tips.slice(0, 4) : [],
    },
  }
}

/** 用气候常识估算某城市某日期的典型天气 */
async function estimateWeather(city, date) {
  const userPrompt = `城市：${city || '北京'}\n日期：${date}`
  const result = await collect(
    [
      { role: 'system', content: WEATHER_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    0.3
  )
  if (!result.ok) return result

  const parsed = extractJson(result.content)
  if (!parsed) return { ok: false, message: '天气估算失败，请手动设置' }
  return {
    ok: true,
    data: {
      weather: parsed.weather || 'cloudy',
      label: parsed.weather_label || '多云',
      temp_key: parsed.temp_key || '',
      temperature: parsed.temperature || '',
      desc: parsed.desc || '',
    },
  }
}

/** 多轮对话：onDelta 收到增量文本，用于逐字渲染 */
async function chatStream(history, contextText, onDelta) {
  const model = await getModel()
  if (!model) return { ok: false, message: '暂无可用模型，请稍后再试' }

  const messages = [{ role: 'system', content: CHAT_SYSTEM_PROMPT + '\n\n' + (contextText || '') }]
    .concat(history || [])

  let content = ''
  try {
    const stream = cloud.llm.chat.completions.create({
      model: model.id,
      messages: messages,
      stream: true,
      temperature: 0.8,
    })
    for await (const chunk of stream) {
      const choice = chunk && chunk.choices && chunk.choices[0]
      const delta = choice && choice.delta
      if (delta && delta.content) {
        content += delta.content
        if (typeof onDelta === 'function') onDelta(delta.content)
      }
    }
  } catch (error) {
    const code = error && error.error ? error.error.code : null
    let message = 'AI 服务暂时不可用，请稍后重试'
    if (code && String(code).indexOf('quota_') === 0) message = 'AI 额度已用完或请求过于频繁'
    else if (code && String(code).indexOf('auth_') === 0) message = 'AI 调用未授权，请确认小程序已正确绑定'
    if (!content) return { ok: false, message: message }
    return { ok: true, content: content, partial: true, message: message }
  }
  if (!content) return { ok: false, message: 'AI 没有返回内容，请重试' }
  return { ok: true, content: content }
}

module.exports = {
  getModel,
  resetModelCache,
  extractJson,
  garmentsToText,
  weatherToText,
  generateOutfit,
  estimateWeather,
  chatStream,
}
