/**
 * 纯逻辑单测（零依赖，纯 Node）。
 * 用法： node tests/units.js
 *
 * 覆盖本次改动引入的三个新模块 + 改造后的天气取数逻辑：
 *   utils/citydb.js   省 - 市数据、模糊搜索、城市反查省份
 *   utils/climate.js  本地气候估算（离线、确定性）
 *   utils/tags.js     自定义标签持久化与选项组装
 *   utils/weather.js  缓存优先 + 本地兜底 + 后台精修
 *
 * 说明：小程序代码依赖 wx 全局对象，这里用内存版 stub 代替；
 * 大模型调用（utils/ai）会被注入为假模块，避免联网。
 */
const path = require('path')
const Module = require('module')

/* ------------------------------ wx stub ------------------------------ */

const storage = {}
global.wx = {
  getStorageSync(key) {
    return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : ''
  },
  setStorageSync(key, value) {
    storage[key] = value
  },
  removeStorageSync(key) {
    delete storage[key]
  },
  request() {},
}

/* --------------------- 把 utils/ai 换成假模块 --------------------- */

let aiNextResult = { ok: false, message: 'stub: 不联网' }
const aiPath = require.resolve('../utils/ai')
require.cache[aiPath] = new Module(aiPath, null)
require.cache[aiPath].filename = aiPath
require.cache[aiPath].loaded = true
require.cache[aiPath].exports = {
  estimateWeather() {
    return Promise.resolve(aiNextResult)
  },
  getModel() {
    return Promise.resolve(null)
  },
}

const citydb = require('../utils/citydb')
const climate = require('../utils/climate')
const tagSvc = require('../utils/tags')
const weatherSvc = require('../utils/weather')
const { TEMP_MAP } = require('../utils/constants')
const { formatDate } = require('../utils/util')

/* ------------------------------ 断言 ------------------------------ */

let passed = 0
const failures = []

function check(name, condition, extra) {
  if (condition) {
    passed += 1
    return
  }
  failures.push(name + (extra === undefined ? '' : ' —— ' + JSON.stringify(extra)))
}

function eq(name, actual, expected) {
  check(name + '（期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual) + '）', actual === expected, actual)
}

/* --------------------------- citydb --------------------------- */

eq('省份反查：杭州', citydb.provinceOf('杭州'), '浙江')
eq('省份反查：哈尔滨', citydb.provinceOf('哈尔滨'), '黑龙江')
eq('省份反查：香港', citydb.provinceOf('香港'), '中国香港')
eq('省份反查：未收录城市返回空', citydb.provinceOf('某个不存在的小镇'), '')

const hot = citydb.searchCities('', 30)
check('空关键词返回热门城市', hot.length === citydb.HOT_CITIES.length, hot.length)
check('热门城市带省份信息', !!hot[0].city && !!hot[0].province, hot[0])

const byPrefix = citydb.searchCities('杭')
eq('前缀搜索「杭」首位是杭州', byPrefix[0].city, '杭州')

const bySub = citydb.searchCities('州')
check('包含搜索「州」有结果', bySub.length > 0, bySub.length)

const byProvince = citydb.searchCities('浙江')
check(
  '按省份名搜索能带出该省城市',
  byProvince.some((item) => item.province === '浙江'),
  byProvince.slice(0, 3)
)

eq('城市列表：广东第一个是广州', citydb.citiesOfProvince('广东')[0], '广州')
check('省份数量 >= 30', citydb.listProvinces().length >= 30, citydb.listProvinces().length)

/* --------------------------- climate --------------------------- */

const hrb = climate.estimateLocal('哈尔滨', '2026-01-15')
check(
  '哈尔滨 1 月是冷天（雪/阴/多云/晴/寒冷）',
  ['snow', 'cold', 'overcast', 'cloudy', 'sunny'].indexOf(hrb.weather) >= 0,
  hrb
)
check('哈尔滨温度是负数区间', /^-?\d+~-?\d+℃$/.test(hrb.temperature), hrb.temperature)
check('哈尔滨温度区间 key 合法', !!TEMP_MAP[hrb.temp_key], hrb.temp_key)

const sameA = climate.estimateLocal('杭州', '2026-07-20')
const sameB = climate.estimateLocal('杭州', '2026-07-20')
check('同城同日结果稳定', JSON.stringify(sameA) === JSON.stringify(sameB), sameA)

const sanya = climate.estimateLocal('三亚', '2026-07-20')
const sanyaTemp = Number(/(-?\d+)/.exec(sanya.temperature)[1])
check('三亚 7 月温度高于哈尔滨 1 月', sanyaTemp > 20, sanya.temperature)

const unknown = climate.estimateLocal('某某新区', '2026-04-10')
check('未收录城市也能给结果', !!unknown.weather && !!unknown.temperature, unknown)

eq('气候区推断：三亚 → hainan', climate.zoneOf('三亚'), 'hainan')
eq('气候区推断：拉萨 → tibet', climate.zoneOf('拉萨'), 'tibet')

/* --------------------------- tags --------------------------- */

eq('初始没有自定义标签', tagSvc.listCustomTags().length, 0)

const added = tagSvc.addCustomTag('露营')
check('新增自定义标签成功', added.ok === true, added)
eq('自定义标签已落盘', tagSvc.listCustomTags().length, 1)

tagSvc.addCustomTag('露营')
eq('重复新增不会产生副本', tagSvc.listCustomTags().length, 1)

const options = tagSvc.buildTagOptions(['通勤', '休闲'], ['通勤', '上镜'])
const names = options.map((o) => o.name)
check('选项含预设', names.indexOf('通勤') >= 0, names)
check('选项含自定义', names.indexOf('露营') >= 0, names)
check('选项含衣橱已用标签', names.indexOf('上镜') >= 0, names)
check('选项去重', names.length === new Set(names).size, names)
eq('预设标签不标记为自定义', options.find((o) => o.name === '通勤').custom, false)
eq('自定义标签被标记', options.find((o) => o.name === '露营').custom, true)

const used = tagSvc.collectUsedTags([{ tags: ['通勤', '上镜'] }, { tags: ['上镜', '露营'] }, {}])
check('汇总已用标签且去重', used.length === 3 && used[0] === '通勤', used)

tagSvc.removeCustomTag('露营')
eq('删除自定义标签', tagSvc.listCustomTags().length, 0)
check('删除后选项里不再有它', tagSvc.buildTagOptions(['通勤'], []).some((o) => o.name === '露营') === false)

/* --------------------------- weather --------------------------- */

/* 腾讯位置服务天气响应解析（接入腾讯天气后新增） */
const todayStr = formatDate(new Date())
const tNow = weatherSvc.parseTencent(
  { status: 0, result: { realtime: { infos: { weather: '晴', temperature: 20 } } } },
  todayStr
)
eq('腾讯 now 解析天气文案', tNow.weatherText, '晴')
eq('腾讯 now 解析温度(number)', tNow.temperature, 20)

const tFuture = weatherSvc.parseTencent(
  {
    status: 0,
    result: {
      forecast: [{ date: '2026-10-16', day: { weather: '小雨', temperature: 18 } }],
    },
  },
  '2026-10-16'
)
eq('腾讯 future 按日期匹配天气', tFuture.weatherText, '小雨')
eq('腾讯 future 解析温度', tFuture.temperature, 18)

eq('腾讯错误状态码返回 null', weatherSvc.parseTencent({ status: 401, message: 'key 无效' }, todayStr), null)
eq('腾讯缺 result 返回 null', weatherSvc.parseTencent({ status: 0 }, todayStr), null)


async function runWeather() {
  const first = await weatherSvc.getWeather({ city: '杭州', date: '2026-10-13' })
  check('首次取天气是本地估算（毫秒级返回）', first.ok && first.source === 'local', first)
  eq('首次未命中缓存', first.cached, false)
  eq('首次可后台精修', first.refinable, true)
  check('本地结果带温度', !!first.data.temperature, first.data)

  const second = await weatherSvc.getWeather({ city: '杭州', date: '2026-10-13' })
  eq('第二次命中缓存', second.cached, true)
  eq('缓存命中后无需再精修', second.refinable, false)

  const forced = await weatherSvc.getWeather({ city: '杭州', date: '2026-10-13', force: true })
  eq('force 跳过缓存', forced.cached, false)

  const gated = await weatherSvc.refineWeather({ city: '杭州', date: '2026-10-13' })
  check('精修失败时正常返回失败（不抛异常）', gated.ok === false, gated)

  // 假模块返回成功，精修应该写回缓存
  aiNextResult = {
    ok: true,
    data: { weather: 'rain', label: '小雨', temp_key: '18-24', temperature: '18~24℃', desc: 'AI 测试值' },
  }
  const refined = await weatherSvc.refineWeather({ city: '上海', date: '2026-10-13' })
  check('精修成功返回 ai 结果', refined.ok && refined.source === 'ai', refined)
  eq('精修结果落缓存', weatherSvc.getWeather({ city: '上海', date: '2026-10-13' }) instanceof Object, true)

  const afterRefine = await weatherSvc.getWeather({ city: '上海', date: '2026-10-13' })
  eq('再次读取直接命中精修缓存', afterRefine.source, 'ai')
  eq('精修缓存不再重复精修', afterRefine.refinable, false)

  const manual = await weatherSvc.getWeather({
    city: '杭州',
    date: '2026-10-13',
    manual: { weather: 'snow', label: '雪', temp_key: 'lt0', temperature: '-5~0℃' },
  })
  eq('手动设置优先级最高', manual.source, 'manual')
  eq('手动结果已写缓存', (await weatherSvc.getWeather({ city: '杭州', date: '2026-10-13' })).source, 'manual')

  weatherSvc.clearCache()
  const afterClear = await weatherSvc.getWeather({ city: '杭州', date: '2026-10-13' })
  eq('清缓存后回到本地估算', afterClear.source, 'local')
}

runWeather()
  .catch((e) => {
    failures.push('天气流程抛出异常：' + (e && e.message))
  })
  .then(() => {
    console.log('通过 ' + passed + ' 项断言')
    if (failures.length) {
      console.log('失败 ' + failures.length + ' 项：')
      failures.forEach((f) => console.log('  ✗ ' + f))
      process.exit(1)
    }
    console.log('✅ 单测全部通过')
  })
