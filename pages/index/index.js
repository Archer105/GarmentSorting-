const app = getApp()
const auth = require('../../utils/auth')
const api = require('../../utils/api')
const ai = require('../../utils/ai')
const weatherSvc = require('../../utils/weather')
const util = require('../../utils/util')
const C = require('../../utils/constants')

const CITY_SUGGEST = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '西安', '南京', '重庆']
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
    cityVisible: false,
    cityInput: '',
    citySuggest: CITY_SUGGEST,
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
      this.refresh()
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
    const next = this.data.dateOptions.find((item) => item.key === key)
    const matches = this.data.weather && this.data.weather.date === (next ? next.date : '')
    this.setData({
      dateKey: key,
      weather: matches ? this.data.weather : null,
      weatherDesc: matches ? this.data.weatherDesc : '',
    })
  },

  onAutoWeather() {
    if (this.data.weatherLoading) return
    this.setData({ weatherLoading: true })
    weatherSvc
      .getWeather({ city: this.data.city, date: this.currentDate() })
      .then((res) => {
        this.setData({ weatherLoading: false })
        if (!res.ok) {
          util.toast(res.message || '获取天气失败，请手动设置')
          return
        }
        this.applyWeather(res.source, res.data)
      })
      .catch(() => {
        this.setData({ weatherLoading: false })
        util.toast('获取天气失败，请手动设置')
      })
  },

  applyWeather(source, data) {
    const weather = Object.assign({}, data, {
      source: source,
      sourceLabel: C.WEATHER_SOURCE_LABEL[source] || '',
    })
    const desc = data.desc ? data.desc : ''
    this.setData({ weather: weather, weatherDesc: desc })
    app.globalData.weather = weather
  },

  openManual() {
    this.setData({
      manualVisible: true,
      manualWeather: this.data.weather ? this.data.weather.weather : this.data.manualWeather,
      manualTemp: this.data.weather && this.data.weather.temp_key ? this.data.weather.temp_key : this.data.manualTemp,
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

  openCity() {
    this.setData({ cityVisible: true, cityInput: this.data.city })
  },

  closeCity() {
    this.setData({ cityVisible: false })
  },

  onCityInput(e) {
    this.setData({ cityInput: e.detail.value })
  },

  pickCity(e) {
    this.setData({ cityInput: e.currentTarget.dataset.city })
  },

  confirmCity() {
    const city = (this.data.cityInput || '').trim()
    if (!city) {
      util.toast('请输入城市名称')
      return
    }
    const current = app.globalData.settings || {}
    app.setSettings({ city: city })
    this.setData({ city: city, cityVisible: false, weather: null, weatherDesc: '' })
    api.saveSettings({ nickname: current.nickname, city: city }).then((res) => {
      if (!res.ok) util.toast(res.message || '城市保存失败')
    })
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
