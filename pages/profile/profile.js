const app = getApp()
const auth = require('../../utils/auth')
const api = require('../../utils/api')
const util = require('../../utils/util')

Page({
  data: {
    displayName: '衣橱主人',
    avatarText: '衣',
    city: '北京',
    topPadding: 40,
    total: 0,
    categoryCount: 0,
    outfits: [],
    outfitsLoading: true,
    editVisible: false,
    nicknameInput: '',
    saving: false,
  },

  onShow() {
    this.setData({ topPadding: app.statusBarHeight() + 18 })
    auth.requireLogin().then((session) => {
      if (!session) return
      this.session = session
      this.refresh()
    })
  },

  refresh() {
    return app.loadSettings(true).then((settings) => {
      this.applyUser(settings)
      this.loadStats()
      this.loadOutfits()
    })
  },

  applyUser(settings) {
    const user = (this.session && this.session.user) || {}
    const name = (settings && settings.nickname) || user.name || '衣橱主人'
    this.setData({
      displayName: name,
      avatarText: name.slice(0, 1) || '衣',
      city: (settings && settings.city) || '北京',
      nicknameInput: name,
    })
  },

  loadStats() {
    return api.listGarments().then((res) => {
      const rows = res.ok ? res.data : []
      const cats = {}
      rows.forEach((row) => {
        cats[row.category || '其他'] = true
      })
      this.setData({ total: rows.length, categoryCount: Object.keys(cats).length })
    })
  },

  loadOutfits() {
    this.setData({ outfitsLoading: true })
    return api.listOutfitRecords(30).then((res) => {
      const rows = res.ok ? res.data : []
      const outfits = rows.map((row) => {
        const meta = [row.weather, row.temperature, row.forecast_date]
          .filter(Boolean)
          .join(' · ')
        return Object.assign({}, row, { metaText: meta })
      })
      this.setData({ outfits: outfits, outfitsLoading: false })
    })
  },

  /* ------------------------------- 编辑资料 ------------------------------- */

  openEdit() {
    this.setData({
      editVisible: true,
      nicknameInput: this.data.displayName,
    })
  },

  closeEdit() {
    this.setData({ editVisible: false })
  },

  onNickname(e) {
    this.setData({ nicknameInput: e.detail.value })
  },

  /** 常驻城市改为独立的「城市选择页」：支持输入候选 + 省份列表选择 */
  goCity() {
    wx.navigateTo({ url: '/pages/city/city' })
  },

  saveEdit() {
    if (this.data.saving) return
    const nickname = (this.data.nicknameInput || '').trim()
    if (!nickname) {
      util.toast('请填写昵称')
      return
    }
    this.setData({ saving: true })
    api.saveSettings({ nickname: nickname }).then((res) => {
      this.setData({ saving: false })
      if (!res.ok) {
        util.toast(res.message || '保存失败')
        return
      }
      app.setSettings({ nickname: nickname })
      this.setData({ editVisible: false })
      this.applyUser({ nickname: nickname, city: this.data.city })
      util.toast('已保存')
    })
  },

  /* ------------------------------- 记录 ------------------------------- */

  onDeleteOutfit(e) {
    const id = Number(e.currentTarget.dataset.id)
    util.confirm('删除这条穿搭记录？', '仅删除记录，不影响衣橱单品。').then((ok) => {
      if (!ok) return
      api.removeOutfitRecord(id).then((res) => {
        if (!res.ok) {
          util.toast(res.message || '删除失败')
          return
        }
        this.loadOutfits()
      })
    })
  },

  /* ------------------------------- 跳转 ------------------------------- */

  goWardrobe() {
    wx.switchTab({ url: '/pages/wardrobe/wardrobe' })
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  showAbout() {
    wx.showModal({
      title: '关于衣橱穿搭',
      content:
        '拍照收纳衣物 · 按天气给穿搭建议 · 和 AI 聊着搭。数据保存在你的账号下，账号之间相互独立。',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#6B4EFF',
    })
  },

  onLogout() {
    util.confirm('退出登录？', '退出后需要重新登录才能查看衣橱。').then((ok) => {
      if (!ok) return
      auth.signOut()
    })
  },
})
