/**
 * 天气数据（速度优先版）。
 *
 * 取数策略（从快到慢）：
 *   1. 缓存命中  —— 同一城市 + 同一日期在有效期内直接返回，毫秒级；
 *   2. 本地气候估算（utils/climate.js）—— 同步计算，毫秒级，标记 source='local'；
 *   3. 后台精修 refineWeather() —— 优先调用腾讯位置服务拿实时天气（已备案域名，无需自建中转），
 *      失败或尚未配置 key 时交给大模型按气候常识估算，成功后写入缓存。
 *
 * 天气数据源：默认接入腾讯位置服务（apis.map.qq.com）。
 *   启用：在 utils/config.js 填入 TENCENT_LBS_KEY；并在微信公众平台「开发管理 → 服务器域名
 *   → request 合法域名」加入 https://apis.map.qq.com 。
 *   不填 key 时自动走「本地气候估算 + AI 精修」兜底，不影响其它功能。
 *
 * 注意：微信小程序只能请求「request 合法域名」白名单内的地址。WorkBuddy 托管发布只
 * 会自动登记云服务网关，不会登记第三方天气接口，所以真机拿实时天气必须在公众平台加白名单。
 */
const { estimateWeather } = require('./ai')
const { estimateLocal } = require('./climate')
const { WEATHER_MAP, TEMP_MAP, WEATHER_OPTIONS, TEMP_RANGES } = require('./constants')
const { formatDate } = require('./util')
const { TENCENT_LBS_KEY } = require('./config')
const { adcodeOf } = require('./citydb')

const TENCENT_WEATHER_URL = 'https://apis.map.qq.com/ws/weather/v1/'
const PROVIDER = {
  // 腾讯位置服务天气接口（已备案域名，需在微信公众平台 request 合法域名白名单）
  url: TENCENT_WEATHER_URL,
  timeout: 5000,
}

const CACHE_KEY = 'wb_weather_cache_v2'
const ATTEMPT_KEY = 'wb_weather_attempt_v1'
const MAX_CACHE = 40

/** 各类来源的结果缓存时长 */
const TTL = {
  realtime: 2 * 60 * 60 * 1000,
  ai: 2 * 60 * 60 * 1000,
  manual: 12 * 60 * 60 * 1000,
  local: 30 * 60 * 1000,
}

/** 精修（AI/接口）失败后的冷却时间，避免反复打接口 */
const REFINE_GATE = 30 * 60 * 1000
/**
 * 腾讯 120（每秒上限）在「额度耗尽」时也会返回：单发就 120、重试仍 120，
 * 说明不是瞬时抖动，别再 8 秒一次地硬打，退到 10 分钟。
 */
const RATE_LIMIT_GATE = 10 * 60 * 1000
/** 腾讯免费 key 的 QPS 很低：全局串行 + 最小间隔，避免自己把自己打到 120 */
const MIN_REQUEST_INTERVAL = 1200
const RATE_LIMIT_STATUS = 120
const DAILY_LIMIT_STATUS = 121
/** 当日额度耗尽的封禁记录（跨页面/重启保持，避免一整天反复打空枪） */
const QUOTA_KEY = 'wb_weather_quota_v1'

/** 腾讯业务错误码 -> 可读文案 */
const BIZ_ERROR_TEXT = {
  120: '此 key 每秒请求量已达上限（额度耗尽时也会返回 120）',
  121: '此 key 今日调用量已达上限',
  311: 'key 格式错误或签名校验未通过',
  306: '请求参数有误',
}

/* ------------------------------- 本地缓存 ------------------------------- */

function readMap(key) {
  try {
    const value = wx.getStorageSync(key)
    return value && typeof value === 'object' ? value : {}
  } catch (e) {
    return {}
  }
}

function writeMap(key, map) {
  try {
    wx.setStorageSync(key, map)
  } catch (e) {
    // 存储写失败不影响主流程
  }
}

function cacheKey(city, date) {
  return city + '|' + date
}

function getCached(city, date) {
  const map = readMap(CACHE_KEY)
  const hit = map[cacheKey(city, date)]
  if (!hit || !hit.ts || !hit.data) return null
  const ttl = TTL[hit.source] || TTL.local
  if (Date.now() - hit.ts > ttl) return null
  return hit
}

function putCache(city, date, source, data) {
  const map = readMap(CACHE_KEY)
  map[cacheKey(city, date)] = { ts: Date.now(), source: source, data: data }
  const keys = Object.keys(map)
  if (keys.length > MAX_CACHE) {
    keys
      .sort((a, b) => (map[a].ts || 0) - (map[b].ts || 0))
      .slice(0, keys.length - MAX_CACHE)
      .forEach((k) => {
        delete map[k]
      })
  }
  writeMap(CACHE_KEY, map)
}

/**
 * 精修尝试记录：{ ts, error, status }。
 * 必须持久化失败原因 —— 否则界面只在「真的发出请求的那一次」能看到报错，
 * 后续刷新一旦被冷却拦住就再也拿不到原因。
 */
function readAttempt(city, date) {
  const map = readMap(ATTEMPT_KEY)
  const raw = map[cacheKey(city, date)]
  if (!raw) return null
  // 兼容 v1 旧格式（只存时间戳）
  if (typeof raw === 'number') return { ts: raw, error: '', status: 0 }
  return raw
}

/** 限流只冷却几秒，其它失败按 30 分钟冷却 */
function gateMsOf(status) {
  if (status === RATE_LIMIT_STATUS || status === DAILY_LIMIT_STATUS) return RATE_LIMIT_GATE
  return REFINE_GATE
}

/** 限流只冷却几分钟，其它失败按 30 分钟冷却；用户主动刷新（force）可跳过冷却 */
function isRefineGated(city, date, force) {
  // 当日额度已用尽：force 也不放行，等次日自动解封
  if (quotaBlockedUntil()) return true
  const entry = readAttempt(city, date)
  if (!entry || !entry.ts) return false
  // 当日额度用完：再刷也没用，force 也不放行
  if (entry.status === DAILY_LIMIT_STATUS) return Date.now() - entry.ts < REFINE_GATE
  if (force) return false
  return Date.now() - entry.ts < gateMsOf(entry.status)
}

function markAttempt(city, date, info) {
  const map = readMap(ATTEMPT_KEY)
  map[cacheKey(city, date)] = {
    ts: Date.now(),
    error: (info && info.error) || '',
    status: (info && info.status) || 0,
  }
  writeMap(ATTEMPT_KEY, map)
}

function clearAttempt(city, date) {
  const map = readMap(ATTEMPT_KEY)
  delete map[cacheKey(city, date)]
  writeMap(ATTEMPT_KEY, map)
}

/** 上次精修的失败原因（持久化），冷却期间也能继续展示 */
function lastErrorMessage(city, date) {
  // 当日额度已用尽：无论上次记的是什么，都统一给「额度用完」的解释
  if (quotaBlockedUntil()) return quotaMessage()
  const entry = readAttempt(city, date)
  return (entry && entry.error) || ''
}

/* ---------------------------- 当日额度封禁 ---------------------------- */

function readQuota() {
  try {
    const value = wx.getStorageSync(QUOTA_KEY)
    return value && typeof value === 'object' ? value : null
  } catch (e) {
    return null
  }
}

/** 腾讯当日额度是否已用尽；返回封禁截止时间戳，未封禁返回 0 */
function quotaBlockedUntil() {
  const quota = readQuota()
  if (!quota || !quota.until) return 0
  return quota.until > Date.now() ? quota.until : 0
}

/** 次日 00:05 自动解封（腾讯额度按自然日重置，留 5 分钟余量） */
function nextDayTimestamp() {
  const next = new Date(Date.now() + 86400000)
  next.setHours(0, 5, 0, 0)
  return next.getTime()
}

function markQuotaExhausted(reason) {
  const until = nextDayTimestamp()
  try {
    wx.setStorageSync(QUOTA_KEY, {
      ts: Date.now(),
      until: until,
      day: formatDate(new Date()),
      reason: reason || '',
    })
  } catch (e) {
    // 存储失败不影响主流程
  }
  return until
}

function clearQuota() {
  try {
    wx.removeStorageSync(QUOTA_KEY)
  } catch (e) {
    // 忽略
  }
}

function quotaMessage() {
  return '腾讯天气今日调用额度已用完，已改用气候估算（明天 0 点后自动恢复实时）。' +
    '可在 lbs.qq.com 控制台「配额管理」查看额度，完成个人认证可提升到 6000 次/日'
}

/* ------------------------------- 归一化 ------------------------------- */

/** 把枚举 key 归一化成内部 key */
function normalizeWeatherKey(raw) {
  const text = String(raw || '').trim()
  if (!text) return 'cloudy'
  const lower = text.toLowerCase()
  if (WEATHER_MAP[lower]) return lower
  // 中文匹配
  const byLabel = WEATHER_OPTIONS.find((item) => text.indexOf(item.label) >= 0)
  if (byLabel) return byLabel.key
  if (/雨/.test(text)) return 'rain'
  if (/雪/.test(text)) return 'snow'
  if (/晴/.test(text)) return 'sunny'
  if (/阴/.test(text)) return 'overcast'
  if (/云/.test(text)) return 'cloudy'
  return 'cloudy'
}

/** 把温度数值归一化成温度区间 key */
function normalizeTempKey(tempText, tempNumber) {
  let value = typeof tempNumber === 'number' ? tempNumber : null
  if (value === null) {
    const match = /-?\d+(\.\d+)?/.exec(String(tempText || ''))
    if (match) value = parseFloat(match[0])
  }
  if (value === null || isNaN(value)) return ''
  const range = TEMP_RANGES.find((item) => value >= item.min && value <= item.max)
  return range ? range.key : value > 30 ? 'gt30' : 'lt0'
}

function labelOf(key) {
  const found = WEATHER_MAP[key]
  return found ? found.label : '多云'
}

function iconOf(key) {
  const found = WEATHER_MAP[key]
  return found ? found.icon : '⛅'
}

function tempLabelOf(key) {
  const found = TEMP_MAP[key]
  return found ? found.label : ''
}

/** 统一组装天气对象 */
function buildData(source, city, date, raw) {
  const input = raw || {}
  const key = normalizeWeatherKey(input.weather || input.label)
  const tempKey = input.temp_key || normalizeTempKey(input.temperature)
  return {
    city: city,
    date: date,
    weather: key,
    label: input.label || labelOf(key),
    icon: iconOf(key),
    temp_key: tempKey,
    temperature: input.temperature || tempLabelOf(tempKey),
    desc: input.desc || '',
  }
}

/* --------------------------- 腾讯位置服务 --------------------------- */

/**
 * 把 result.forecast 摊平成「按天」的日期数组。
 *
 * 腾讯真实返回是「城市对象数组」（与文档示例不同，实测 2026-10-18）：
 *   result.forecast = [{
 *     province, city, district, adcode, update_time,
 *     infos: [{ date:'2026-10-19', week, day:{weather,temperature,...}, night:{...} }, ...]
 *   }]
 * 即：日期列表在里层 infos，外层每个元素代表一个城市。
 * 同时兼容扁平形态（forecast 元素自身带 date），以防接口再调整。
 *
 * @returns {Array<{date:string, day?:object, night?:object}>}
 */
function flattenForecast(result) {
  const list = result && Array.isArray(result.forecast) ? result.forecast : []
  const days = []
  list.forEach((item) => {
    if (!item || typeof item !== 'object') return
    if (Array.isArray(item.infos)) {
      item.infos.forEach((d) => {
        if (d && d.date) days.push(d)
      })
    } else if (item.date) {
      days.push(item)
    }
  })
  return days
}

/**
 * 解析腾讯天气响应（注意真实接口结构，与文档示例有差异）：
 *   today  -> result.realtime 是「数组」，取 [0].infos.{weather, temperature}
 *   future -> result.forecast[0].infos[] 里按 date 匹配，取 day.{weather, temperature}
 *             （day.temperature 实测为数字，如 23）
 * 任一层缺失都返回 null，交由上层回退。
 * @returns {{weatherText:string, temperature:(number|string)}|null}
 */
function parseTencent(payload, date) {
  if (!payload || payload.status !== 0 || !payload.result) return null
  const today = formatDate(new Date())
  if (date === today) {
    const rtList = payload.result.realtime
    // realtime 真实为数组：[{ infos: { weather, temperature } }]
    const rt = Array.isArray(rtList) ? rtList[0] : rtList
    if (!rt || !rt.infos) return null
    return { weatherText: rt.infos.weather, temperature: rt.infos.temperature }
  }
  const days = flattenForecast(payload.result)
  const found = days.filter((d) => d.date === date)[0]
  if (!found) return null
  // 兼容两种形态：forecast[].day.{weather,temperature} 或 forecast[].{weather,temperature}
  const day = found.day || found
  if (!day || !day.weather) return null
  return { weatherText: day.weather, temperature: day.temperature }
}

/**
 * 最近一次腾讯实时源失败的原因（用于界面/调试暴露真机失败细节）。
 * 例：'请求失败：request:fail url not in domain list'
 */
let lastRefineError = ''

function getLastRefineError() {
  return lastRefineError
}

/** 把腾讯业务错误（status!==0）翻译成可读文案 */
function bizErrorOf(payload) {
  if (!payload || typeof payload !== 'object') return ''
  if (typeof payload.status === 'number' && payload.status !== 0) {
    const hint = BIZ_ERROR_TEXT[payload.status]
    const detail = hint || payload.message
    return '接口返回 status ' + payload.status + (detail ? '（' + detail + '）' : '')
  }
  return ''
}

/* ------------------- 请求队列：串行 + 限速 + 同参数去重 ------------------- */

let queueTail = Promise.resolve()
let lastRequestAt = 0
const inflight = {}

/**
 * 把一次腾讯请求排进全局队列：同一时刻只有一个在飞，
 * 相邻两次至少间隔 MIN_REQUEST_INTERVAL。
 * 腾讯免费 key 的 QPS 很低，并发（启动预热 + 首页 onShow + 切城市）会直接打成 status 120。
 */
function scheduleRequest(task) {
  const run = queueTail.then(async () => {
    const wait = MIN_REQUEST_INTERVAL - (Date.now() - lastRequestAt)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    lastRequestAt = Date.now()
    return task()
  })
  queueTail = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/**
 * 单次请求，不重试。显式拼接 query（不依赖 wx.request 对 data 的序列化）。
 * @returns {Promise<{ok:boolean, parsed:Object|null, error:string, status:number}>}
 */
function requestOnce(city, date) {
  return new Promise((resolve) => {
    const reject = (error, status) =>
      resolve({ ok: false, parsed: null, error: error, status: status || 0 })

    if (!TENCENT_LBS_KEY) return reject('未配置 TENCENT_LBS_KEY', 0)
    if (typeof wx === 'undefined' || typeof wx.request !== 'function') {
      return reject('当前环境没有 wx.request（非真实小程序）', 0)
    }
    const adcode = adcodeOf(city)
    if (!adcode) return reject('无法解析城市「' + city + '」的 adcode', 0)

    const isToday = date === formatDate(new Date())
    const maskedKey = TENCENT_LBS_KEY.slice(0, 6) + '***' + TENCENT_LBS_KEY.slice(-4)
    const url =
      PROVIDER.url +
      '?key=' + encodeURIComponent(TENCENT_LBS_KEY) +
      '&adcode=' + encodeURIComponent(adcode) +
      '&type=' + (isToday ? 'now' : 'future') +
      (isToday ? '' : '&get_md=1') +
      '&output=json'
    // 开发者工具控制台可据此确认请求是否真的发出去（key 已打码）
    console.info(
      '[weather] 请求腾讯天气 key=' + maskedKey + ' adcode=' + adcode + ' type=' + (isToday ? 'now' : 'future')
    )
    wx.request({
      url: url,
      method: 'GET',
      timeout: PROVIDER.timeout,
      success(res) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.warn('[weather] 腾讯返回 HTTP ' + res.statusCode, res.data)
          const bizStatus = res.data && typeof res.data.status === 'number' ? res.data.status : 0
          reject(bizErrorOf(res.data) || 'HTTP ' + res.statusCode, bizStatus)
          return
        }
        const parsed = parseTencent(res.data, date)
        if (!parsed) {
          const bizStatus = res.data && typeof res.data.status === 'number' ? res.data.status : 0
          let error = bizErrorOf(res.data)
          if (!error && !isToday) {
            // 未来天气：区分「日期超出预报范围」与「结构解析失败」，避免误导
            const days = flattenForecast(res.data && res.data.result)
            if (days.length) {
              error =
                '腾讯预报不含该日期（' + date + '），可查范围 ' +
                days[0].date + ' ~ ' + days[days.length - 1].date
            }
          }
          if (!error) {
            error =
              '返回体缺少天气字段（type=' + (isToday ? 'now' : 'future') + '，adcode=' + adcode + '）'
          }
          console.warn('[weather] 腾讯返回无法解析：' + error, res.data)
          reject(error, bizStatus)
          return
        }
        console.info('[weather] 腾讯实时源成功：' + parsed.weatherText + ' ' + parsed.temperature + '℃')
        resolve({ ok: true, parsed: parsed, error: '', status: 0 })
      },
      fail(err) {
        const msg = (err && err.errMsg) || '未知网络错误'
        let appid = ''
        try {
          appid = wx.getAccountInfoSync().miniProgram.appId || ''
        } catch (e) {
          appid = ''
        }
        // url not in domain list = request 合法域名没生效，给出可直接照做的指引
        if (msg.indexOf('url not in domain list') >= 0) {
          reject(
            '域名未加入 request 合法域名（当前运行 appid=' + (appid || '未知') + '）。' +
              '请到 微信公众平台→开发管理→开发设置→服务器域名→request 合法域名，' +
              '添加 https://apis.map.qq.com 并保存，然后重新编译/重新扫码。',
            0
          )
        } else {
          reject('请求失败：' + msg + (appid ? '（当前 appid=' + appid + '）' : ''), 0)
        }
        console.warn('[weather] 腾讯请求失败：' + msg)
      },
    })
  })
}

/** 连续撞到 120 的次数：撞够了就按「额度已耗尽」处理，别再一整天硬打 */
let rateLimitStreak = 0

/**
 * status 120 先退避重试一次；121 或连撞 120 则判定当日额度耗尽。
 * @returns {Promise<{ok:boolean, parsed:Object|null, error:string, status:number}>}
 */
function doRequest(city, date) {
  return requestOnce(city, date)
    .then((res) => {
      if (res.status !== RATE_LIMIT_STATUS) return res
      return new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL)).then(() =>
        requestOnce(city, date)
      )
    })
    .then((res) => {
      if (res.status === DAILY_LIMIT_STATUS) {
        markQuotaExhausted(res.error)
      } else if (res.status === RATE_LIMIT_STATUS) {
        rateLimitStreak += 1
        if (rateLimitStreak >= 3) markQuotaExhausted(res.error)
      } else {
        rateLimitStreak = 0
      }
      return res
    })
}

/**
 * 对外入口：同 city+date 复用同一个在飞请求，再排进限速队列。
 * @returns {Promise<{ok:boolean, parsed:Object|null, error:string, status:number}>}
 */
function requestProvider(city, date) {
  const key = cacheKey(city, date)
  if (inflight[key]) return inflight[key]

  // 当日额度已用尽：不再发请求（发了也只有 120/121，还白占额度）
  if (quotaBlockedUntil()) {
    const blocked = {
      ok: false,
      parsed: null,
      error: quotaMessage(),
      status: DAILY_LIMIT_STATUS,
    }
    lastRefineError = blocked.error
    return Promise.resolve(blocked)
  }

  const promise = scheduleRequest(() => doRequest(city, date)).then(
    (res) => {
      delete inflight[key]
      lastRefineError = res.ok ? '' : res.error
      if (res.ok) {
        rateLimitStreak = 0
        clearQuota()
      }
      return res
    },
    (error) => {
      delete inflight[key]
      return {
        ok: false,
        parsed: null,
        error: '请求异常：' + ((error && error.message) || '未知错误'),
        status: 0,
      }
    }
  )
  inflight[key] = promise
  return promise
}

/* --------------------------------- 取数 --------------------------------- */

/**
 * 取天气（快）。命中缓存或本地估算时立即返回，不等网络。
 * @param {Object} opts { city, date, manual, force }
 * @returns {Promise<{ok:boolean, source:string, data:Object, cached:boolean, refinable:boolean, message?:string}>}
 */
async function getWeather(opts) {
  const options = opts || {}
  const city = options.city || '北京'
  const date = options.date || formatDate(new Date())

  if (options.manual) {
    const manualData = buildData('manual', city, date, options.manual)
    putCache(city, date, 'manual', manualData)
    return { ok: true, source: 'manual', data: manualData, cached: false, refinable: false }
  }

  if (!options.force) {
    const hit = getCached(city, date)
    if (hit) {
      // 只有「实时 / AI / 手动」才是终态；本地气候估算仍允许后台精修升级，
      // 否则一旦某次精修失败，冷却期内会一直卡在「气候估算」。
      const refinable = hit.source === 'local' ? !isRefineGated(city, date) : false
      return {
        ok: true,
        source: hit.source,
        data: hit.data,
        cached: true,
        refinable: refinable,
        // 冷却期内不再发请求，但失败原因要能继续展示（否则报错只在第一次刷新时出现）
        refineError: hit.source === 'local' ? lastErrorMessage(city, date) : '',
      }
    }
  }

  const localData = buildData('local', city, date, estimateLocal(city, date))
  putCache(city, date, 'local', localData)
  return {
    ok: true,
    source: 'local',
    data: localData,
    cached: false,
    refinable: !isRefineGated(city, date, options.force),
    refineError: lastErrorMessage(city, date),
  }
}

/**
 * 后台精修：腾讯位置服务（实时天气）优先，其次大模型气候估算。较慢，不阻塞界面。
 * 成功后会写入缓存，下次打开即为毫秒级。
 * @returns {Promise<{ok:boolean, source?:string, data?:Object, skip?:boolean, message?:string}>}
 */
async function refineWeather(opts) {
  const options = opts || {}
  const city = options.city || '北京'
  const date = options.date || formatDate(new Date())

  if (isRefineGated(city, date, options.force)) {
    const lastError = lastErrorMessage(city, date)
    return {
      ok: false,
      skip: true,
      error: lastError,
      message: lastError ? '实时源失败：' + lastError : '刚刚更新过',
    }
  }

  const remote = await requestProvider(city, date)
  if (remote && remote.ok && remote.parsed) {
    const parsed = remote.parsed
    const temp =
      parsed.temperature === '' || parsed.temperature == null
        ? ''
        : Number(parsed.temperature) + '℃'
    const isToday = date === formatDate(new Date())
    const data = buildData('realtime', city, date, {
      weather: parsed.weatherText,
      label: parsed.weatherText || labelOf(normalizeWeatherKey(parsed.weatherText)),
      temp_key: normalizeTempKey(parsed.temperature),
      temperature: temp,
      desc: isToday ? '实时天气' : '天气预报',
    })
    putCache(city, date, 'realtime', data)
    clearAttempt(city, date)
    return { ok: true, source: 'realtime', data: data }
  }

  // 腾讯实时源失败：先把「原因 + 业务状态码」持久化，再立刻回调让界面马上显示
  const tencentErr = (remote && remote.error) || lastRefineError || '未知原因'
  const bizStatus = (remote && remote.status) || 0
  markAttempt(city, date, { error: tencentErr, status: bizStatus })

  if (typeof options.onTencentFail === 'function' && tencentErr) {
    try {
      options.onTencentFail(tencentErr)
    } catch (e) {
      // 回调异常不影响主流程
    }
  }

  const estimated = await estimateWeather(city, date)
  if (estimated.ok) {
    const data = buildData('ai', city, date, estimated.data)
    putCache(city, date, 'ai', data)
    return { ok: true, source: 'ai', data: data, error: tencentErr, message: '实时源失败：' + tencentErr }
  }
  return {
    ok: false,
    error: tencentErr,
    message:
      '实时源失败：' +
      tencentErr +
      (estimated.message ? '；AI 兜底也失败：' + estimated.message : '；AI 兜底也失败'),
  }
}

/** 清空天气缓存（调试/强制刷新用） */
function clearCache() {
  writeMap(CACHE_KEY, {})
  writeMap(ATTEMPT_KEY, {})
}

module.exports = {
  getWeather,
  refineWeather,
  clearCache,
  normalizeWeatherKey,
  normalizeTempKey,
  labelOf,
  iconOf,
  tempLabelOf,
  parseTencent,
  flattenForecast,
  getLastRefineError,
  lastErrorMessage,
  quotaBlockedUntil,
  clearQuota,
  PROVIDER,
}
