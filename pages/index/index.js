const app = getApp()
const auth = require('../../utils/auth')
const api = require('../../utils/api')
const ai = require('../../utils/ai')
const weatherSvc = require('../../utils/weather')
const util = require('../../utils/util')
const C = require('../../utils/constants')

const PLACEHOLDER = '/images/placeholder-garment.png'

Page({
  data: {
    greeting: '你好',
    displayName: '衣橱主人',
    avatarText: '衣',
    topPadding: 40,
    dateOptions: [],
    dateKey: 'today',
    city: '北京',
    weather: null,
    weatherDesc: '',
    weatherLoading: false,
    refining: false,
    weatherDiag: '',
    updatedText: '',
    generating: false,
    outfit: null,
    outfitItems: [],
    saved: false,
    total: 0,
    categoryStats: [],
    garmentsView: [],
    manualVisible: false,
    manualWeather: 'sunny',
    manualTemp: '18-24',
    weatherOptions: C.WEATHER_OPTIONS,
    tempRanges: C.TEMP_RANGES,
  },

  onLoad() {
    this.setData({
      greeting: this.greetingOf(new Date()),
      dateOptions: this.buildDateOptions(),
      topPadding: app.statusBarHeight() + 18,
    })
  },

  onShow() {
    auth.requireLogin().then((session) => {
      if (!session) return
      this.applyUser(session)
      // 每次进入首页都按「常驻城市 + 当前选择日期」自动取一次天气：
      // 命中缓存/本地估算时是毫秒级的，不会卡界面。
      this.refresh().then(() => this.autoWeather())
    })
  },

  /* ------------------------------- 基础 ------------------------------- */

  greetingOf(date) {
    const h = date.getHours()
    if (h < 6) return '夜深了'
    if (h < 11) return '早上好'
    if (h < 14) return '中午好'
    if (h < 18) return '下午好'
    return '晚上好'
  },

  buildDateOptions() {
    const now = Date.now()
    return [
      { key: 'today', label: '今天', date: util.formatDate(new Date(now)) },
      { key: 'tomorrow', label: '明天', date: util.formatDate(new Date(now + 86400000)) },
      { key: 'after', label: '后天', date: util.formatDate(new Date(now + 2 * 86400000)) },
    ]
  },

  currentDate() {
    const found = this.data.dateOptions.find((item) => item.key === this.data.dateKey)
    return found ? found.date : util.formatDate(new Date())
  },

  applyUser(session) {
    const user = (session && session.user) || {}
    const settings = app.globalData.settings || {}
    const name = settings.nickname || user.name || '衣橱主人'
    this.setData({
      displayName: name,
      avatarText: name.slice(0, 1) || '衣',
      city: settings.city || '北京',
    })
  },

  refresh() {
    return app.loadSettings().then((settings) => {
      this.setData({ city: (settings && settings.city) || this.data.city })
      return this.refreshGarments()
    })
  },

  refreshGarments() {
    return api.listGarments().then((res) => {
      const rows = res.ok ? res.data : []
      const paths = rows.map((row) => row.image_path).filter(Boolean)
      return api.signedUrls(paths).then((urlMap) => {
        const view = rows.map((row) =>
          Object.assign({}, row, {
            thumb: (row.image_path && urlMap[row.image_path]) || PLACEHOLDER,
          })
        )
        const counts = {}
        view.forEach((item) => {
          const key = item.category || '其他'
          counts[key] = (counts[key] || 0) + 1
        })
        const categoryStats = C.CATEGORIES.filter((c) => counts[c.key]).map((c) => ({
          key: c.key,
          icon: c.icon,
          count: counts[c.key],
        }))
        this.setData({ garmentsView: view, total: view.length, categoryStats: categoryStats })
        return view
      })
    })
  },

  /* ------------------------------- 天气 ------------------------------- */

  onPickDate(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.dateKey) return
    this.setData({ dateKey: key, weather: null, weatherDesc: '', updatedText: '' }, () => {
      this.autoWeather()
    })
  },

  /**
   * 自动取天气：先同步拿到「缓存 或 本地气候估算」并立刻上屏，
   * 再在后台做一次精修（实时接口 / AI），成功就静默替换。
   */
  autoWeather(force) {
    const city = this.data.city || app.city()
    const date = this.currentDate()
    this.setData({ weatherLoading: true, weatherDiag: '' })

    return weatherSvc
      .getWeather({ city: city, date: date, force: !!force })
      .then((res) => {
        this.setData({ weatherLoading: false })
        if (!res.ok) {
          util.toast(res.message || '暂时拿不到天气，可手动设置')
          return
        }
        this.applyWeather(res.source, res.data)
        if (res.refinable) this.refine(city, date)
      })
      .catch(() => {
        this.setData({ weatherLoading: false })
      })
  },

  refine(city, date) {
    this.setData({ refining: true })
    weatherSvc
      .refineWeather({
        city: city,
        date: date,
        // 腾讯实时源一失败就立刻显示原因（不等 AI 兜底）
        onTencentFail: (msg) => {
          this.setData({ weatherDiag: '实时源失败：' + msg })
        },
      })
      .then((res) => {
        this.setData({ refining: false })
        if (!res) return
        // 实时源失败（即使 AI 兜底成功）都把原因显示出来，便于确认为何不是「实时」
        if (res.message) this.setData({ weatherDiag: res.message })
        if (!res.ok) return
        // 期间用户可能换了城市/日期，或手动设置了天气 —— 这些情况下丢弃后台结果
        if (this.data.city !== city || this.currentDate() !== date) return
        if (this.data.weather && this.data.weather.source === 'manual') return
        this.applyWeather(res.source, res.data)
      })
      .catch(() => this.setData({ refining: false }))
  },

  onRefreshWeather() {
    if (this.data.weatherLoading) return
    this.autoWeather(true)
  },

  applyWeather(source, data) {
    const weather = Object.assign({}, data, {
      source: source,
      sourceLabel: C.WEATHER_SOURCE_LABEL[source] || '',
    })
    this.setData({
      weather: weather,
      weatherDesc: data.desc || '',
      // 拿到实时天气就清掉诊断提示；其它来源保留上一条，方便看到失败原因
      weatherDiag: source === 'realtime' ? '' : this.data.weatherDiag,
      updatedText: '更新于 ' + this.clockText(),
    })
    app.globalData.weather = weather
  },

  clockText() {
    const d = new Date()
    const pad = (n) => (n < 10 ? '0' + n : '' + n)
    return pad(d.getHours()) + ':' + pad(d.getMinutes())
  },

  openManual() {
    this.setData({
      manualVisible: true,
      manualWeather: this.data.weather ? this.data.weather.weather : this.data.manualWeather,
      manualTemp:
        this.data.weather && this.data.weather.temp_key ? this.data.weather.temp_key : this.data.manualTemp,
    })
  },

  closeManual() {
    this.setData({ manualVisible: false })
  },

  pickWeather(e) {
    this.setData({ manualWeather: e.currentTarget.dataset.key })
  },

  pickTemp(e) {
    this.setData({ manualTemp: e.currentTarget.dataset.key })
  },

  confirmManual() {
    const wKey = this.data.manualWeather
    const tKey = this.data.manualTemp
    const wOpt = C.WEATHER_MAP[wKey] || C.WEATHER_OPTIONS[0]
    const tOpt = C.TEMP_MAP[tKey]
    this.applyWeather('manual', {
      city: this.data.city,
      date: this.currentDate(),
      weather: wKey,
      label: wOpt.label,
      icon: wOpt.icon,
      temp_key: tKey,
      temperature: tOpt ? tOpt.label : '',
      desc: '',
    })
    this.setData({ manualVisible: false })
  },

  /* ------------------------------- 城市 ------------------------------- */

  goCity() {
    wx.navigateTo({ url: '/pages/city/city' })
  },

  /* ------------------------------ 生成穿搭 ------------------------------ */

  onGenerate() {
    if (this.data.generating) return
    const garments = this.data.garmentsView

    if (!garments.length) {
      util.confirm('衣橱还是空的', '先上传几件衣服，AI 才能从你的衣橱里挑搭配。现在去上传？').then((ok) => {
        if (ok) wx.navigateTo({ url: '/pages/add/add' })
      })
      return
    }
    if (!this.data.weather) {
      util.toast('先获取或设置一下天气')
      this.openManual()
      return
    }

    this.setData({ generating: true, saved: false })
    ai.generateOutfit(garments, {
      city: this.data.city,
      date: this.currentDate(),
      label: this.data.weather.label,
      temperature: this.data.weather.temperature,
      desc: this.data.weather.desc,
    }).then((res) => {
      this.setData({ generating: false })
      if (!res.ok) {
        util.toast(res.message || '生成失败，请重试')
        return
      }
      const byId = {}
      garments.forEach((item) => {
        byId[item.id] = item
      })
      const items = res.data.item_ids.map((id) => byId[id]).filter(Boolean)
      if (!items.length) {
        util.toast('没有匹配到合适的单品，请重试')
        return
      }
      this.setData({ outfit: res.data, outfitItems: items, saved: false })
    })
  },

  onSaveOutfit() {
    if (!this.data.outfit || this.data.saved) return
    const record = this.data.outfit
    api
      .createOutfitRecord({
        title: record.title,
        weather: this.data.weather ? this.data.weather.label : null,
        temperature: this.data.weather ? this.data.weather.temperature : null,
        forecast_date: this.currentDate(),
        item_ids: record.item_ids,
        advice: record.reason + (record.tips && record.tips.length ? '\n' + record.tips.join('\n') : ''),
        source: 'auto',
      })
      .then((res) => {
        if (!res.ok) {
          util.toast(res.message || '收藏失败')
          return
        }
        this.setData({ saved: true })
        util.toast('已收藏到穿搭记录')
      })
  },

  /* ------------------------------- 跳转 ------------------------------- */

  goWardrobe() {
    wx.switchTab({ url: '/pages/wardrobe/wardrobe' })
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  },
})
