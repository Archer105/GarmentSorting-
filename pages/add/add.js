const auth = require('../../utils/auth')
const api = require('../../utils/api')
const util = require('../../utils/util')
const C = require('../../utils/constants')

function buildState(list, selected) {
  const state = {}
  list.forEach((key) => {
    state[key] = !!selected && selected.indexOf(key) >= 0
  })
  return state
}

Page({
  data: {
    id: null,
    editing: false,
    categories: C.CATEGORIES,
    colors: C.COLOR_PRESETS,
    seasons: C.SEASONS,
    tagChips: C.TAG_PRESETS.slice(),
    category: C.CATEGORIES[0].key,
    color: '',
    seasonState: {},
    tagState: {},
    tagInput: '',
    name: '',
    note: '',
    imageSrc: '',
    imageTemp: '',
    imagePath: '',
    saving: false,
    uploading: false,
  },

  onLoad(options) {
    const id = options && options.id ? Number(options.id) : null
    if (id) {
      this.setData({ id: id, editing: true })
      wx.setNavigationBarTitle({ title: '编辑单品' })
    }
    auth.requireLogin().then((session) => {
      if (!session) return
      if (id) this.loadGarment(id)
    })
  },

  loadGarment(id) {
    api.getGarment(id).then((res) => {
      if (!res.ok || !res.data) {
        util.toast('单品不存在或无权访问')
        wx.navigateBack()
        return
      }
      const item = res.data
      const seasonState = buildState(C.SEASONS, item.season ? item.season.split('/') : [])
      const tags = item.tags || []
      const tagChips = C.TAG_PRESETS.slice()
      tags.forEach((tag) => {
        if (tagChips.indexOf(tag) < 0) tagChips.push(tag)
      })
      const tagState = buildState(tagChips, tags)

      this.setData({
        name: item.name || '',
        category: item.category || C.CATEGORIES[0].key,
        color: item.color || '',
        note: item.note || '',
        imagePath: item.image_path || '',
        seasonState: seasonState,
        tagChips: tagChips,
        tagState: tagState,
      })

      if (item.image_path) {
        api.signedUrls([item.image_path]).then((map) => {
          if (map[item.image_path]) this.setData({ imageSrc: map[item.image_path] })
        })
      }
    })
  },

  /* ------------------------------- 图片 ------------------------------- */

  onPickImage() {
    const onOk = (res) => {
      const file = (res.tempFiles && res.tempFiles[0]) || {}
      const path = file.tempFilePath || (res.tempFilePaths && res.tempFilePaths[0])
      if (path) this.setData({ imageSrc: path, imageTemp: path })
    }
    const onFail = () => {}

    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        sizeType: ['compressed'],
        success: onOk,
        fail: onFail,
      })
      return
    }
    wx.chooseImage({
      count: 1,
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: onOk,
      fail: onFail,
    })
  },

  /* ------------------------------- 表单 ------------------------------- */

  onName(e) {
    this.setData({ name: e.detail.value })
  },
  onNote(e) {
    this.setData({ note: e.detail.value })
  },
  onPickCategory(e) {
    this.setData({ category: e.currentTarget.dataset.key })
  },
  onPickColor(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ color: this.data.color === key ? '' : key })
  },
  onPickSeason(e) {
    const key = e.currentTarget.dataset.key
    const state = Object.assign({}, this.data.seasonState)
    state[key] = !state[key]
    this.setData({ seasonState: state })
  },
  onPickTag(e) {
    const key = e.currentTarget.dataset.key
    const state = Object.assign({}, this.data.tagState)
    state[key] = !state[key]
    this.setData({ tagState: state })
  },
  onTagInput(e) {
    this.setData({ tagInput: e.detail.value })
  },
  addTag() {
    const tag = (this.data.tagInput || '').trim()
    if (!tag) return
    const chips = this.data.tagChips.slice()
    const state = Object.assign({}, this.data.tagState)
    if (chips.indexOf(tag) < 0) chips.push(tag)
    state[tag] = true
    this.setData({ tagChips: chips, tagState: state, tagInput: '' })
  },

  /* ------------------------------- 保存 ------------------------------- */

  selectedOf(state, keys) {
    return keys.filter((key) => state[key])
  },

  onSave() {
    if (this.data.saving) return
    const name = (this.data.name || '').trim()
    if (!name) {
      util.toast('请填写单品名称')
      return
    }

    const seasons = this.selectedOf(this.data.seasonState, C.SEASONS)
    const tags = Object.keys(this.data.tagState).filter((key) => this.data.tagState[key])

    const payload = {
      name: name,
      category: this.data.category,
      color: this.data.color,
      season: seasons.join('/'),
      tags: tags,
      note: (this.data.note || '').trim(),
    }

    this.setData({ saving: true })

    const ensureImage = () => {
      if (!this.data.imageTemp) return Promise.resolve(this.data.imagePath)
      this.setData({ uploading: true })
      return api.uploadGarmentImage(this.data.imageTemp).then((res) => {
        this.setData({ uploading: false })
        if (!res.ok) throw new Error(res.message || '图片上传失败')
        return res.path
      })
    }

    ensureImage()
      .then((path) => {
        if (path) payload.image_path = path
        return this.data.editing ? api.updateGarment(this.data.id, payload) : api.createGarment(payload)
      })
      .then((res) => {
        this.setData({ saving: false, uploading: false })
        if (!res.ok) {
          util.toast(res.message || '保存失败')
          return
        }
        util.toast(this.data.editing ? '已保存' : '已加入衣橱')
        setTimeout(() => wx.navigateBack(), 700)
      })
      .catch((error) => {
        this.setData({ saving: false, uploading: false })
        util.toast((error && error.message) || '保存失败')
      })
  },

  onDelete() {
    util.confirm('删除这件单品？', '删除后无法恢复，也不会再出现在穿搭建议里。').then((ok) => {
      if (!ok) return
      util.loading('删除中')
      api.removeGarment(this.data.id, this.data.imagePath).then((res) => {
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
