/**
 * 天气数据（速度优先版）。
 *
 * 取数策略（从快到慢）：
 *   1. 缓存命中  —— 同一城市 + 同一日期在有效期内直接返回，毫秒级；
 *   2. 本地气候估算（utils/climate.js）—— 同步计算，毫秒级，标记 source='local'；
 *   3. 后台精修 refineWeather() —— 若配置了第三方天气接口就用实时数据，
 *      否则交给大模型按气候常识估算（较慢，但不再阻塞界面），成功后写入缓存。
 *
 * 手动设置的天气优先级最高，且直接落缓存。
 *
 * 注意：微信小程序只能请求「request 合法域名」白名单内的地址。WorkBuddy 托管发布只
 * 会自动登记云服务网关，不会登记第三方天气接口，所以想在真机拿实时天气需要：
 *   把 PROVIDER.url 换成你自己的天气接口，并在微信公众平台「开发管理 → 服务器域名」
 *   加入白名单。未配置时自动走本地估算 + AI 精修。
 */
const { estimateWeather } = require('./ai')
const { estimateLocal } = require('./climate')
const { WEATHER_MAP, TEMP_MAP, WEATHER_OPTIONS, TEMP_RANGES } = require('./constants')
const { formatDate } = require('./util')

const PROVIDER = {
  // 留空即关闭第三方接口；示例：'https://api.vvhan.com/api/weather'
  url: '',
  timeout: 3000,
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

function isRefineGated(city, date) {
  const map = readMap(ATTEMPT_KEY)
  const ts = map[cacheKey(city, date)]
  return !!ts && Date.now() - ts < REFINE_GATE
}

function markAttempt(city, date) {
  const map = readMap(ATTEMPT_KEY)
  map[cacheKey(city, date)] = Date.now()
  writeMap(ATTEMPT_KEY, map)
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

/** 从第三方接口响应里尽量抽取天气与温度 */
function parseProviderPayload(payload) {
  if (!payload || typeof payload !== 'object') return null
  const source = payload.data && typeof payload.data === 'object' ? payload.data : payload
  const weatherText =
    source.weather || source.wea || source.type || source.weatherType || source.tianqi || ''
  const temperature = source.temperature || source.temp || source.tem || source.wendu || ''
  if (!weatherText && !temperature) return null
  return { weatherText: weatherText, temperature: temperature }
}

function requestProvider(city) {
  return new Promise((resolve) => {
    if (!PROVIDER.url) {
      resolve(null)
      return
    }
    wx.request({
      url: PROVIDER.url,
      method: 'GET',
      data: { city: city },
      timeout: PROVIDER.timeout,
      success(res) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          resolve(null)
          return
        }
        resolve(parseProviderPayload(res.data))
      },
      fail() {
        resolve(null)
      },
    })
  })
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
      return { ok: true, source: hit.source, data: hit.data, cached: true, refinable: false }
    }
  }

  const localData = buildData('local', city, date, estimateLocal(city, date))
  putCache(city, date, 'local', localData)
  return {
    ok: true,
    source: 'local',
    data: localData,
    cached: false,
    refinable: !isRefineGated(city, date),
  }
}

/**
 * 后台精修：第三方接口优先，其次大模型气候估算。较慢，不阻塞界面。
 * 成功后会写入缓存，下次打开即为毫秒级。
 * @returns {Promise<{ok:boolean, source?:string, data?:Object, skip?:boolean, message?:string}>}
 */
async function refineWeather(opts) {
  const options = opts || {}
  const city = options.city || '北京'
  const date = options.date || formatDate(new Date())

  if (!options.force && isRefineGated(city, date)) {
    return { ok: false, skip: true, message: '刚刚更新过' }
  }
  markAttempt(city, date)

  const remote = await requestProvider(city)
  if (remote) {
    const data = buildData('realtime', city, date, {
      weather: remote.weatherText,
      label: remote.weatherText || labelOf(normalizeWeatherKey(remote.weatherText)),
      temp_key: normalizeTempKey(remote.temperature),
      temperature: remote.temperature ? String(remote.temperature) : '',
      desc: '来自天气接口',
    })
    putCache(city, date, 'realtime', data)
    return { ok: true, source: 'realtime', data: data }
  }

  const estimated = await estimateWeather(city, date)
  if (estimated.ok) {
    const data = buildData('ai', city, date, estimated.data)
    putCache(city, date, 'ai', data)
    return { ok: true, source: 'ai', data: data }
  }
  return { ok: false, message: estimated.message || '天气精修失败' }
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
  PROVIDER,
}
