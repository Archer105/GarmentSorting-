const auth = require('./utils/auth')
const api = require('./utils/api')
const util = require('./utils/util')
const C = require('./utils/constants')

const SETTINGS_STORE_KEY = 'wb_settings_cache_v1'

/** 崩溃弹窗最多弹 3 次，避免错误风暴刷屏 */
let fatalShown = 0

App({
  globalData: {
    /** 用户偏好：{ nickname, city } */
    settings: null,
    /** 最近一次使用的天气对象 */
    weather: null,
    /** 系统信息，用于自定义导航栏高度 */
    systemInfo: null,
    /** 本次启动是否已经预热过天气 */
    warmedWeather: false,
  },

  onLaunch() {
    try {
      this.globalData.systemInfo = wx.getWindowInfo
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync()
    } catch (e) {
      this.globalData.systemInfo = null
    }

    // 先吃本地缓存的偏好，保证天气预热不必等云同步
    this.globalData.settings = this.readLocalSettings()

    // 预热会话（不阻塞启动）。是否跳登录页由各页面统一判断。
    auth
      .getSession()
      .catch(() => null)
      .then(() => this.warmUpWeather())
  },

  /* ------------------------------ 崩溃兜底 ------------------------------ */

  /**
   * 真机上 JS 崩溃时默认什么都不显示，表现为「白屏」。
   * 这里把错误弹出来，至少让人知道原因，而不是只能看到一片白。
   */
  onError(error) {
    this.reportFatal('小程序运行报错', error && (error.message || error))
  },

  onUnhandledRejection(res) {
    const reason = res && res.reason
    this.reportFatal(
      '小程序异步报错',
      (reason && (reason.message || reason.errMsg)) || reason || '未知错误'
    )
  },

  reportFatal(title, detail) {
    const text = String(detail || '未知错误').slice(0, 300)
    console.error('[fatal] ' + title + '：' + text)
    if (fatalShown >= 3) return
    fatalShown += 1
    try {
      wx.showModal({ title: title, content: text, showCancel: false, confirmText: '知道了' })
    } catch (e) {
      // 弹窗失败就算了，至少 console 里有
    }
  },

  /* ------------------------------ 用户偏好 ------------------------------ */

  readLocalSettings() {
    try {
      const value = wx.getStorageSync(SETTINGS_STORE_KEY)
      return value && typeof value === 'object' ? value : null
    } catch (e) {
      return null
    }
  },

  cacheSettings(settings) {
    try {
      wx.setStorageSync(SETTINGS_STORE_KEY, settings || {})
    } catch (e) {
      // 忽略存储异常
    }
  },

  /** 读取用户偏好（本地缓存 -> 云端） */
  loadSettings(force) {
    if (this.globalData.settings && !force) {
      return Promise.resolve(this.globalData.settings)
    }
    return api
      .getSettings()
      .then((res) => {
        const remote = (res && res.data) || null
        if (remote) {
          this.globalData.settings = remote
          this.cacheSettings(remote)
          return remote
        }
        const local = this.globalData.settings || this.readLocalSettings() || {}
        this.globalData.settings = local
        return local
      })
      .catch(() => {
        const local = this.globalData.settings || this.readLocalSettings() || {}
        this.globalData.settings = local
        return local
      })
  },

  setSettings(patch) {
    const before = this.globalData.settings || {}
    const next = Object.assign({}, before, patch || {})
    this.globalData.settings = next
    this.cacheSettings(next)
    // 换城市了：旧的天气不能再用来给穿搭建议
    if (patch && patch.city && patch.city !== before.city) {
      this.globalData.weather = null
    }
    return next
  },

  city() {
    const settings = this.globalData.settings || this.readLocalSettings() || {}
    return settings.city || '北京'
  },

  /* ------------------------------- 天气预热 ------------------------------- */

  /**
   * 启动即按「常驻城市」拉一次天气。
   * 命中缓存或本地气候估算时是毫秒级返回，因此这里同步即可用；
   * 更精确的实时/AI 数据由页面在后台精修后覆盖。
   */
  warmUpWeather(force) {
    const weatherSvc = require('./utils/weather')
    const city = this.city()
    const date = util.formatDate(new Date())
    return weatherSvc
      .getWeather({ city: city, date: date, force: !!force })
      .then((res) => {
        if (!res || !res.ok) return null
        this.globalData.weather = decorateWeather(res.source, res.data)
        this.globalData.warmedWeather = true
        return this.globalData.weather
      })
      .catch(() => null)
  },

  /** 状态栏高度（px），供自定义导航栏页面使用 */
  statusBarHeight() {
    const info = this.globalData.systemInfo
    return (info && info.statusBarHeight) || 20
  },
})

/** 给天气对象补上来源标签，供各页面直接展示 */
function decorateWeather(source, data) {
  return Object.assign({}, data || {}, {
    source: source,
    sourceLabel: C.WEATHER_SOURCE_LABEL[source] || '',
  })
}
