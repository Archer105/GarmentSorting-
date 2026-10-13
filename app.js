const auth = require('./utils/auth')
const api = require('./utils/api')

App({
  globalData: {
    /** 用户偏好：{ nickname, city } */
    settings: null,
    /** 最近一次使用的天气对象 */
    weather: null,
    /** 系统信息，用于自定义导航栏高度 */
    systemInfo: null,
  },

  onLaunch() {
    try {
      this.globalData.systemInfo = wx.getWindowInfo
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync()
    } catch (e) {
      this.globalData.systemInfo = null
    }
    // 预热会话（不阻塞启动）。是否跳登录页由各页面统一判断。
    auth.getSession().catch(() => null)
  },

  /** 读取用户偏好（本地缓存 -> 云端） */
  loadSettings(force) {
    if (this.globalData.settings && !force) {
      return Promise.resolve(this.globalData.settings)
    }
    return api.getSettings().then((res) => {
      this.globalData.settings = res.data || {}
      return this.globalData.settings
    })
  },

  setSettings(patch) {
    this.globalData.settings = Object.assign({}, this.globalData.settings || {}, patch || {})
    return this.globalData.settings
  },

  city() {
    const settings = this.globalData.settings || {}
    return settings.city || '北京'
  },

  /** 状态栏高度（px），供自定义导航栏页面使用 */
  statusBarHeight() {
    const info = this.globalData.systemInfo
    return (info && info.statusBarHeight) || 20
  },
})
