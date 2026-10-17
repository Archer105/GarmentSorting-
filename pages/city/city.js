const app = getApp()
const api = require('../../utils/api')
const util = require('../../utils/util')
const citydb = require('../../utils/citydb')

Page({
  data: {
    mode: 'search',
    city: '北京',
    keyword: '',
    suggest: [],
    canUseInput: false,
    provinces: citydb.listProvinces(),
    activeProvince: '',
    provinceCities: [],
    saving: false,
  },

  onLoad() {
    this.setData({ suggest: citydb.searchCities('', 30) })
    app.loadSettings().then((settings) => {
      const city = (settings && settings.city) || app.city() || '北京'
      const province = citydb.provinceOf(city) || '北京'
      this.setData({
        city: city,
        activeProvince: province,
        provinceCities: citydb.citiesOfProvince(province),
      })
    })
  },

  /* ------------------------------- 切换方式 ------------------------------- */

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (!mode || mode === this.data.mode) return
    this.setData({ mode: mode })
  },

  /* ------------------------------- 输入搜索 ------------------------------- */

  onInput(e) {
    const keyword = e.detail.value
    const suggest = citydb.searchCities(keyword, 40)
    const name = String(keyword || '').trim()
    const exact = suggest.some((item) => item.city === name)
    this.setData({
      keyword: keyword,
      suggest: suggest,
      canUseInput: !!name && !exact,
    })
  },

  clearKeyword() {
    this.setData({ keyword: '', suggest: citydb.searchCities('', 30), canUseInput: false })
  },

  useInput() {
    this.save(this.data.keyword)
  },

  /* ------------------------------- 省份选择 ------------------------------- */

  pickProvince(e) {
    const name = e.currentTarget.dataset.name
    if (!name) return
    this.setData({ activeProvince: name, provinceCities: citydb.citiesOfProvince(name) })
  },

  /* ------------------------------- 保存 ------------------------------- */

  pickCity(e) {
    this.save(e.currentTarget.dataset.city)
  },

  save(city) {
    if (this.data.saving) return
    const name = String(city || '').trim()
    if (!name) {
      util.toast('请选择或输入城市')
      return
    }
    if (name === this.data.city) {
      wx.navigateBack()
      return
    }

    const current = app.globalData.settings || {}
    this.setData({ saving: true })
    util.loading('保存中')

    const done = (message) => {
      util.hideLoading()
      this.setData({ saving: false })
      app.setSettings({ city: name })
      // 立刻按新城市预热天气（毫秒级，后续页面直接可用），再后台精修
      app.warmUpWeather(true)
      util.toast(message || '已切换到 ' + name)
      setTimeout(() => wx.navigateBack(), 450)
    }

    // 云端写失败：本机先生效，不让「选个城市」被网络问题卡死
    const fallbackLocal = (reason) => {
      const detail = util.errText(reason, '')
      if (detail) console.warn('[city] 云端保存失败：' + detail)
      util.hideLoading()
      this.setData({ saving: false })
      app.setSettings({ city: name })
      app.warmUpWeather(true)
      util.toast('已在本机切换到 ' + name + '（云端未同步）')
      setTimeout(() => wx.navigateBack(), 900)
    }

    api
      .saveSettings({ nickname: current.nickname, city: name })
      .then((res) => {
        if (!res.ok) {
          fallbackLocal(res.message)
          return
        }
        done()
      })
      .catch((error) => fallbackLocal(error))
  },
})
