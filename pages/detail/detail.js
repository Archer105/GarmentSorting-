const auth = require('../../utils/auth')
const api = require('../../utils/api')
const util = require('../../utils/util')

const PLACEHOLDER = '/images/placeholder-garment.png'

Page({
  data: {
    id: null,
    item: null,
    thumb: PLACEHOLDER,
    createdText: '',
    loading: true,
  },

  onLoad(options) {
    const id = options && options.id ? Number(options.id) : null
    this.setData({ id: id })
    auth.requireLogin().then((session) => {
      if (!session) return
      if (!id) {
        this.setData({ loading: false })
        return
      }
      this.load(id)
    })
  },

  onShow() {
    // 从编辑页返回时刷新
    if (this.data.id && this.data.item) this.load(this.data.id)
  },

  load(id) {
    api.getGarment(id).then((res) => {
      if (!res.ok || !res.data) {
        this.setData({ loading: false, item: null })
        return
      }
      const item = Object.assign({}, res.data, {
        tags: res.data.tags || [],
        note: res.data.note || '',
      })
      const created = item.created_at ? String(item.created_at).slice(0, 10) : ''
      this.setData({
        item: item,
        createdText: created,
        loading: false,
        thumb: PLACEHOLDER,
      })
      if (item.image_path) {
        api.signedUrls([item.image_path]).then((map) => {
          if (map[item.image_path]) this.setData({ thumb: map[item.image_path] })
        })
      }
    })
  },

  onStyleIt() {
    const item = this.data.item
    if (!item) return
    const q = '我想穿这件「' + item.name + '」，帮我围绕它搭一套完整的穿搭'
    wx.switchTab({
      url: '/pages/chat/chat',
      success: () => {
        const pages = getCurrentPages()
        const chat = pages[pages.length - 1]
        if (chat && typeof chat.prefill === 'function') chat.prefill(q)
      },
    })
  },

  onEdit() {
    wx.navigateTo({ url: '/pages/add/add?id=' + this.data.id })
  },

  onDelete() {
    const item = this.data.item
    if (!item) return
    util.confirm('删除这件单品？', '删除后无法恢复，也不会再出现在穿搭建议里。').then((ok) => {
      if (!ok) return
      util.loading('删除中')
      api.removeGarment(item.id, item.image_path).then((res) => {
        util.hideLoading()
        if (!res.ok) {
          util.toast(res.message || '删除失败')
          return
        }
        util.toast('已删除')
        setTimeout(() => wx.navigateBack(), 600)
      })
    })
  },
})
