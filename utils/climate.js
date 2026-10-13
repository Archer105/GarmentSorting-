/**
 * 本地气候估算（离线，毫秒级返回）。
 *
 * 目的：原先「获取天气」要等一次大模型流式返回（数秒），体验很差。
 * 现在改为：先立刻用内置的气候常识给出典型天气，界面马上可用；
 * 大模型只作为后台「精修」的可选增强（见 utils/weather.js）。
 *
 * 数据形态：把全国按气候划分为若干「气候区」，每个区给出 12 个月的月均温
 * 与主要雨季月份；城市先查精确映射，再按其所属省份落到默认气候区。
 */

const { WEATHER_MAP, TEMP_RANGES } = require('./constants')
const { provinceOf } = require('./citydb')

const ZONES = {
  harbin: { temps: [-19, -14, -5, 5, 13, 20, 23, 21, 14, 4, -8, -17], rain: [6, 7, 8] },
  northeast: { temps: [-13, -8, -1, 8, 16, 21, 24, 22, 16, 7, -2, -10], rain: [6, 7, 8] },
  north: { temps: [-3, -1, 6, 14, 20, 24, 26, 25, 20, 13, 5, -1], rain: [7, 8] },
  northwest: { temps: [-8, -4, 3, 11, 17, 22, 24, 22, 17, 9, 0, -6], rain: [7, 8] },
  xinjiang: { temps: [-14, -10, 0, 11, 18, 23, 25, 23, 17, 7, -3, -11], rain: [5, 6, 7] },
  east: { temps: [4, 5, 9, 15, 20, 24, 28, 28, 24, 19, 13, 7], rain: [6, 7, 8, 9] },
  central: { temps: [3, 5, 10, 17, 22, 26, 29, 28, 23, 17, 11, 5], rain: [6, 7, 8] },
  south: { temps: [14, 15, 19, 23, 27, 28, 29, 29, 27, 23, 19, 15], rain: [5, 6, 7, 8] },
  hainan: { temps: [18, 19, 23, 27, 29, 29, 29, 28, 27, 25, 22, 19], rain: [8, 9, 10] },
  southwest: { temps: [7, 9, 13, 18, 22, 24, 26, 26, 22, 18, 13, 8], rain: [6, 7, 8] },
  yunnan: { temps: [9, 11, 15, 19, 21, 21, 21, 21, 19, 16, 12, 9], rain: [6, 7, 8] },
  tibet: { temps: [-2, 1, 5, 8, 12, 16, 16, 15, 13, 8, 2, -1], rain: [7, 8] },
}

/** 省份 -> 默认气候区 */
const PROVINCE_ZONE = {
  黑龙江: 'harbin',
  吉林: 'northeast',
  辽宁: 'northeast',
  北京: 'north',
  天津: 'north',
  河北: 'north',
  山西: 'north',
  山东: 'north',
  陕西: 'north',
  内蒙古: 'northwest',
  甘肃: 'northwest',
  宁夏: 'northwest',
  青海: 'northwest',
  新疆: 'xinjiang',
  西藏: 'tibet',
  河南: 'central',
  湖北: 'central',
  湖南: 'central',
  江西: 'central',
  上海: 'east',
  江苏: 'east',
  浙江: 'east',
  安徽: 'east',
  福建: 'south',
  广东: 'south',
  广西: 'south',
  海南: 'hainan',
  中国台湾: 'south',
  中国香港: 'south',
  中国澳门: 'south',
  四川: 'southwest',
  重庆: 'southwest',
  贵州: 'southwest',
  云南: 'yunnan',
}

/** 个别城市需要单独纠正 */
const CITY_ZONE = {
  哈尔滨: 'harbin',
  齐齐哈尔: 'harbin',
  大庆: 'harbin',
  长春: 'northeast',
  沈阳: 'northeast',
  大连: 'north',
  呼和浩特: 'northwest',
  西宁: 'tibet',
  兰州: 'northwest',
  乌鲁木齐: 'xinjiang',
  拉萨: 'tibet',
  昆明: 'yunnan',
  丽江: 'yunnan',
  大理: 'yunnan',
  西双版纳: 'hainan',
  三亚: 'hainan',
  海口: 'hainan',
  广州: 'south',
  深圳: 'south',
  厦门: 'south',
  福州: 'south',
  南宁: 'south',
  重庆: 'central',
  武汉: 'central',
  长沙: 'central',
  南昌: 'central',
  郑州: 'central',
  西安: 'north',
  济南: 'north',
  青岛: 'north',
  成都: 'southwest',
  贵阳: 'southwest',
}

/** 关键词兜底（未收录城市） */
function guessZone(name) {
  if (/海|三亚|陵水|万宁|琼海|东方市/.test(name)) return 'hainan'
  if (/昆明|大理|丽江|曲靖|玉溪|楚雄|保山/.test(name)) return 'yunnan'
  if (/拉萨|日喀则|那曲|阿里|山南|林芝|昌都/.test(name)) return 'tibet'
  if (/乌鲁木齐|喀什|伊犁|阿克苏|和田|哈密|吐鲁番|克拉玛依/.test(name)) return 'xinjiang'
  if (/广州|深圳|珠海|汕头|佛山|东莞|中山|南宁|桂林|柳州|北海|厦门|泉州|漳州|莆田|龙岩/.test(name)) return 'south'
  if (/上海|南京|苏州|无锡|杭州|宁波|温州|绍兴|金华|合肥|芜湖|常州|南通|徐州/.test(name)) return 'east'
  if (/武汉|长沙|南昌|郑州|洛阳|宜昌|岳阳|株洲|湘潭|衡阳|常德/.test(name)) return 'central'
  if (/成都|重庆|贵阳|遵义|绵阳|德阳|宜宾|泸州|乐山|南充/.test(name)) return 'southwest'
  if (/哈尔滨|长春|沈阳|吉林市|大庆/.test(name)) return 'northeast'
  return 'north'
}

function zoneOf(city) {
  const name = String(city || '').trim().replace(/(市|地区|自治州)$/, '')
  if (CITY_ZONE[name]) return CITY_ZONE[name]
  const province = provinceOf(name)
  if (province && PROVINCE_ZONE[province]) return PROVINCE_ZONE[province]
  return guessZone(name)
}

/** FNV-1a：保证「同城同日」结果稳定，不会每次刷新都跳变 */
function hash(text) {
  let h = 2166136261
  const str = String(text)
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function labelOf(key) {
  const found = WEATHER_MAP[key]
  return found ? found.label : '多云'
}

function tempKeyOf(value) {
  const range = TEMP_RANGES.find((item) => value >= item.min && value <= item.max)
  if (range) return range.key
  return value > 30 ? 'gt30' : 'lt0'
}

function parseMonth(dateStr) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(dateStr || ''))
  if (match) return Number(match[2])
  return new Date().getMonth() + 1
}

/**
 * 立刻给出气候估算结果（同步、无网络）。
 * @param {string} city
 * @param {string} dateStr YYYY-MM-DD
 */
function estimateLocal(city, dateStr) {
  const name = String(city || '北京').trim() || '北京'
  const zone = zoneOf(name)
  const conf = ZONES[zone] || ZONES.north
  const month = parseMonth(dateStr)
  const avg = conf.temps[month - 1]
  const rainy = conf.rain.indexOf(month) >= 0
  const r = hash(name + '|' + dateStr + '|' + zone) % 100

  let weather
  if (avg <= 0) {
    weather = rainy && r < 45 ? 'snow' : r < 25 ? 'sunny' : r < 52 ? 'overcast' : 'cloudy'
  } else if (avg < 12) {
    weather = rainy && r < 40 ? 'rain' : r < 35 ? 'sunny' : r < 62 ? 'cloudy' : 'overcast'
  } else if (avg < 24) {
    weather = rainy && r < 45 ? 'rain' : r < 45 ? 'cloudy' : r < 72 ? 'sunny' : 'overcast'
  } else {
    weather = rainy && r < 50 ? 'rain' : r < 50 ? 'sunny' : r < 74 ? 'cloudy' : 'overcast'
  }
  if (avg >= 30 && (weather === 'sunny' || weather === 'cloudy')) weather = 'hot'
  if (avg <= -5 && weather === 'cloudy' && r < 55) weather = 'cold'

  const low = Math.round(avg - 4)
  const high = Math.round(avg + 5)
  return {
    weather: weather,
    label: labelOf(weather),
    temp_key: tempKeyOf(avg),
    temperature: low + '~' + high + '℃',
    desc: name + month + '月气候常识估算，日均约 ' + avg + '℃',
    zone: zone,
  }
}

module.exports = {
  estimateLocal,
  zoneOf,
  ZONES,
}
