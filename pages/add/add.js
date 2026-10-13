const auth = require('../../utils/auth')
const api = require('../../utils/api')
const util = require('../../utils/util')
const C = require('../../utils/constants')
const tagSvc = require('../../utils/tags')

function buildState(names, selected) {
  const state = {}
  ;(names || []).forEach((name) => {
    state[name] = !!selected && selected.indexOf(name) >= 0
  })
  return state
}

function namesOf(options) {
  return (options || []).map((item) => item.name)
}

Page({
  data: {
    id: null,
    editing: false,
    categories: C.CATEGORIES,
    colors: C.COLOR_PRESETS,
    seasons: C.SEASONS,
    tagChips: [],
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
      // 先把「衣橱里已经用过的标签」拉出来，和预设、自定义一起组成可选项
      this.prepareTags().then(() => {
        if (id) this.loadGarment(id)
      })
    })
  },

  /** 标签选项 = 预设 + 自定义 + 衣橱里已用过的 */
  prepareTags(selected) {
    return api.listGarments().then((res) => {
      const used = tagSvc.collectUsedTags(res.ok ? res.data : [])
      const options = tagSvc.buildTagOptions(C.TAG_PRESETS, used)
      this.allowedTags = namesOf(options)
      this.setData({
        tagChips: options,
        tagState: buildState(namesOf(options), selected || []),
      })
      return options
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
      const options = tagSvc.buildTagOptions(C.TAG_PRESETS, tags.concat(this.allowedTags || []))
      this.allowedTags = namesOf(options)
      const tagState = buildState(this.allowedTags, tags)

      this.setData({
        name: item.name || '',
        category: item.category || C.CATEGORIES[0].key,
        color: item.color || '',
        note: item.note || '',
        imagePath: item.image_path || '',
        seasonState: seasonState,
        tagChips: options,
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

  /* ------------------------------- 标签 ------------------------------- */

  /** 交叉分类：一件单品可以同时挂多个标签，点一下切换选中状态 */
  onPickTag(e) {
    const key = e.currentTarget.dataset.key
    const state = Object.assign({}, this.data.tagState)
    state[key] = !state[key]
    this.setData({ tagState: state })
  },

  onTagInput(e) {
    this.setData({ tagInput: e.detail.value })
  },

  /** 新增自定义标签：立即持久化，下次进页面仍在候选里 */
  addTag() {
    const tag = (this.data.tagInput || '').trim()
    if (!tag) {
      util.toast('请输入标签内容')
      return
    }
    if (tag.length > 8) {
      util.toast('标签最多 8 个字')
      return
    }
    if ((this.allowedTags || []).indexOf(tag) >= 0) {
      const state = Object.assign({}, this.data.tagState)
      state[tag] = true
      this.setData({ tagState: state, tagInput: '' })
      util.toast('标签已存在，已为你选中')
      return
    }

    tagSvc.addCustomTag(tag)
    const options = tagSvc.buildTagOptions(C.TAG_PRESETS, this.usedTagsNow().concat(tag))
    this.allowedTags = namesOf(options)
    const state = Object.assign({}, this.data.tagState)
    state[tag] = true
    this.setData({ tagChips: options, tagState: state, tagInput: '' })
  },

  usedTagsNow() {
    return Object.keys(this.data.tagState).filter((key) => this.data.tagState[key])
  },

  /** 删除自定义标签（内置预设标签不可删） */
  removeTag(e) {
    const tag = e.currentTarget.dataset.key
    if (!tag) return
    util.confirm('删除自定义标签「' + tag + '」？', '只从标签库里移除，已打过该标签的单品不受影响。').then((ok) => {
      if (!ok) return
      tagSvc.removeCustomTag(tag)
      const options = tagSvc.buildTagOptions(C.TAG_PRESETS, this.usedTagsNow())
      this.allowedTags = namesOf(options)
      const state = Object.assign({}, this.data.tagState)
      delete state[tag]
      this.setData({ tagChips: options, tagState: state })
    })
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
