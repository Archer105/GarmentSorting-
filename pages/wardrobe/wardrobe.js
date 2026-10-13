const auth = require('../../utils/auth')
const api = require('../../utils/api')
const util = require('../../utils/util')
const C = require('../../utils/constants')

const PLACEHOLDER = '/images/placeholder-garment.png'

function buildTabs() {
  const tabs = [{ key: '全部', icon: '' }]
  C.CATEGORIES.forEach((c) => tabs.push({ key: c.key, icon: c.icon }))
  return tabs
}

function metaOf(item) {
  const parts = []
  if (item.color) parts.push(item.color)
  if (item.season) parts.push(item.season + '季')
  if (item.tags && item.tags.length) parts.push(item.tags.slice(0, 2).join('/'))
  return parts.join(' · ')
}

Page({
  data: {
    keyword: '',
    category: '全部',
    categoryTabs: buildTabs(),
    list: [],
    loading: true,
  },

  onShow() {
    auth.requireLogin().then((session) => {
      if (!session) return
      this.load()
    })
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh())
  },

  load() {
    this.setData({ loading: true })
    return api.listGarments().then((res) => {
      const rows = res.ok ? res.data : []
      const paths = rows.map((row) => row.image_path).filter(Boolean)
      return api.signedUrls(paths).then((urlMap) => {
        this.all = rows.map((row) =>
          Object.assign({}, row, {
            thumb: (row.image_path && urlMap[row.image_path]) || PLACEHOLDER,
            meta: metaOf(row),
          })
        )
        this.setData({ loading: false })
        this.applyFilter()
      })
    })
  },

  applyFilter() {
    const all = this.all || []
    const keyword = (this.data.keyword || '').trim().toLowerCase()
    const category = this.data.category
    const list = all.filter((item) => {
      if (category !== '全部' && item.category !== category) return false
      if (!keyword) return true
      const hay = [item.name, item.color, item.note, item.category, (item.tags || []).join(' ')]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.indexOf(keyword) >= 0
    })
    this.setData({ list: list })
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value }, () => this.applyFilter())
  },

  clearSearch() {
    this.setData({ keyword: '' }, () => this.applyFilter())
  },

  onPickCategory(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ category: key }, () => this.applyFilter())
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/add/add' })
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  },
})
