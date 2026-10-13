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
    tagOptions: [],
    activeTags: [],
    tagFilterActive: false,
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
        this.buildTagPool(rows)
        this.setData({ loading: false })
        this.applyFilter()
      })
    })
  },

  /** 汇总衣橱里出现过的标签（含自定义标签），按使用频次排序 */
  buildTagPool(rows) {
    const counts = {}
    rows.forEach((row) => {
      const tags = row.tags || []
      tags.forEach((tag) => {
        if (!tag) return
        counts[tag] = (counts[tag] || 0) + 1
      })
    })
    this.tagCounts = counts
    this.tagPool = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || (a < b ? -1 : 1))

    // 单品删掉后，已失效的标签从筛选条件里剔除
    const activeTags = this.data.activeTags.filter((tag) => this.tagPool.indexOf(tag) >= 0)
    this.setData({
      activeTags: activeTags,
      tagOptions: this.buildTagOptions(activeTags),
      tagFilterActive: activeTags.length > 0,
    })
  },

  buildTagOptions(activeTags) {
    const counts = this.tagCounts || {}
    return (this.tagPool || []).map((name) => ({
      name: name,
      count: counts[name] || 0,
      active: (activeTags || []).indexOf(name) >= 0,
    }))
  },

  applyFilter() {
    const all = this.all || []
    const keyword = (this.data.keyword || '').trim().toLowerCase()
    const category = this.data.category
    const activeTags = this.data.activeTags

    const list = all.filter((item) => {
      if (category !== '全部' && item.category !== category) return false

      // 交叉筛选：必须同时命中所有已选标签
      if (activeTags.length) {
        const tags = item.tags || []
        const hitAll = activeTags.every((tag) => tags.indexOf(tag) >= 0)
        if (!hitAll) return false
      }

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

  /* ------------------------------- 标签筛选 ------------------------------- */

  onPickTag(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    const activeTags = this.data.activeTags.slice()
    const index = activeTags.indexOf(key)
    if (index >= 0) activeTags.splice(index, 1)
    else activeTags.push(key)
    this.setData(
      {
        activeTags: activeTags,
        tagOptions: this.buildTagOptions(activeTags),
        tagFilterActive: activeTags.length > 0,
      },
      () => this.applyFilter()
    )
  },

  clearTags() {
    this.setData(
      { activeTags: [], tagOptions: this.buildTagOptions([]), tagFilterActive: false },
      () => this.applyFilter()
    )
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/add/add' })
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  },
})
