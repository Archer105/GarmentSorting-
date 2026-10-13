/** 业务常量：分类、标签、颜色、季节、天气选项 */

const CATEGORIES = [
  { key: '上装', icon: '👕' },
  { key: '下装', icon: '👖' },
  { key: '外套', icon: '🧥' },
  { key: '连衣裙', icon: '👗' },
  { key: '鞋履', icon: '👟' },
  { key: '包袋', icon: '👜' },
  { key: '配饰', icon: '🧢' },
]

const TAG_PRESETS = ['通勤', '休闲', '运动', '约会', '正式', '度假', '居家', '百搭', '显瘦', '保暖', '清凉']

const COLOR_PRESETS = ['黑', '白', '灰', '米', '棕', '红', '粉', '橙', '黄', '绿', '蓝', '紫', '花色']

const SEASONS = ['春', '夏', '秋', '冬']

/** 天气状况 —— key 用于入库，label 用于展示，icon 用于卡片 */
const WEATHER_OPTIONS = [
  { key: 'sunny', label: '晴', icon: '☀️' },
  { key: 'cloudy', label: '多云', icon: '⛅' },
  { key: 'overcast', label: '阴', icon: '☁️' },
  { key: 'rain', label: '雨', icon: '🌧️' },
  { key: 'snow', label: '雪', icon: '❄️' },
  { key: 'wind', label: '大风', icon: '🌬️' },
  { key: 'hot', label: '炎热', icon: '🔥' },
  { key: 'cold', label: '寒冷', icon: '🧊' },
]

const TEMP_RANGES = [
  { key: 'lt0', label: '0℃ 以下', min: -20, max: -1 },
  { key: '0-10', label: '0 ~ 10℃', min: 0, max: 10 },
  { key: '10-18', label: '10 ~ 18℃', min: 10, max: 18 },
  { key: '18-24', label: '18 ~ 24℃', min: 18, max: 24 },
  { key: '24-30', label: '24 ~ 30℃', min: 24, max: 30 },
  { key: 'gt30', label: '30℃ 以上', min: 30, max: 45 },
]

const WEATHER_MAP = {}
WEATHER_OPTIONS.forEach((item) => {
  WEATHER_MAP[item.key] = item
})

const TEMP_MAP = {}
TEMP_RANGES.forEach((item) => {
  TEMP_MAP[item.key] = item
})

/** 天气来源的中文说明 */
const WEATHER_SOURCE_LABEL = {
  realtime: '实时',
  ai: 'AI 估算',
  manual: '手动',
}

module.exports = {
  CATEGORIES,
  TAG_PRESETS,
  COLOR_PRESETS,
  SEASONS,
  WEATHER_OPTIONS,
  TEMP_RANGES,
  WEATHER_MAP,
  TEMP_MAP,
  WEATHER_SOURCE_LABEL,
}
