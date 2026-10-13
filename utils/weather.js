/**
 * 天气数据。
 *
 * 说明（重要）：
 * 微信小程序只能请求「request 合法域名」白名单内的地址。WorkBuddy 托管发布时会自动登记
 * 云服务网关域名，但不会登记第三方天气接口。因此：
 *
 *  - 若你希望真机拿到真实天气：把下面 PROVIDER.url 换成你自己的天气接口，
 *    并在微信公众平台「开发管理 → 服务器域名」把它加入 request 合法域名；
 *  - 未配置时，代码会自动降级为「用云端 AI 按气候常识估算」，并把来源标注为「AI 估算」；
 *  - 用户随时可以手动选择天气，手动值优先级最高。
 */
const { estimateWeather } = require('./ai')
const { WEATHER_MAP, TEMP_MAP, WEATHER_OPTIONS, TEMP_RANGES } = require('./constants')
const { formatDate } = require('./util')

const PROVIDER = {
  // 留空即关闭第三方接口；示例：'https://api.vvhan.com/api/weather'
  url: '',
  timeout: 3000,
}

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

/**
 * 获取天气。
 * @param {Object} opts
 * @param {string} opts.city 城市
 * @param {string} opts.date YYYY-MM-DD
 * @param {Object} opts.manual 手动指定的天气（优先级最高）
 * @returns {Promise<{ok:boolean, source:string, data:Object, message?:string}>}
 */
async function getWeather(opts) {
  const options = opts || {}
  const city = options.city || '北京'
  const date = options.date || formatDate(new Date())

  if (options.manual) {
    return buildResult('manual', city, date, options.manual)
  }

  const remote = await requestProvider(city)
  if (remote) {
    const key = normalizeWeatherKey(remote.weatherText)
    return buildResult('realtime', city, date, {
      weather: key,
      label: remote.weatherText || labelOf(key),
      temp_key: normalizeTempKey(remote.temperature),
      temperature: remote.temperature ? String(remote.temperature) : '',
      desc: '来自天气接口',
    })
  }

  const estimated = await estimateWeather(city, date)
  if (estimated.ok) {
    return buildResult('ai', city, date, estimated.data)
  }
  return { ok: false, source: 'none', message: estimated.message || '无法获取天气，请手动设置', data: null }
}

function buildResult(source, city, date, raw) {
  const key = normalizeWeatherKey(raw.weather || raw.label)
  const tempKey = raw.temp_key || normalizeTempKey(raw.temperature)
  return {
    ok: true,
    source: source,
    data: {
      city: city,
      date: date,
      weather: key,
      label: raw.label || labelOf(key),
      icon: iconOf(key),
      temp_key: tempKey,
      temperature: raw.temperature || tempLabelOf(tempKey),
      desc: raw.desc || '',
    },
  }
}

module.exports = {
  getWeather,
  normalizeWeatherKey,
  normalizeTempKey,
  labelOf,
  iconOf,
  tempLabelOf,
  PROVIDER,
}
