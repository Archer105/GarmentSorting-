/**
 * 标签能力：自定义标签的本地持久化 + 标签选项组装。
 *
 * 标签共有三个来源，合并去重后作为可选项：
 *   1) 内置预设（utils/constants.js 的 TAG_PRESETS）
 *   2) 用户自定义（本地持久化，可删除）
 *   3) 衣橱里已经用过的标签（从单品数据里汇总，避免重复创建）
 *
 * 「交叉分类」= 一件单品可挂多个标签；衣橱页支持多标签交叉筛选。
 */

const STORE_KEY = 'wb_custom_tags_v1'

function read() {
  try {
    const value = wx.getStorageSync(STORE_KEY)
    return Array.isArray(value) ? value.filter((t) => typeof t === 'string' && t) : []
  } catch (e) {
    return []
  }
}

function write(list) {
  try {
    wx.setStorageSync(STORE_KEY, list)
  } catch (e) {
    // 存储失败不阻塞主流程
  }
}

/** 全部自定义标签 */
function listCustomTags() {
  return read()
}

function isCustomTag(tag) {
  return read().indexOf(tag) >= 0
}

/** 新增自定义标签（幂等） */
function addCustomTag(tag) {
  const name = String(tag || '').trim()
  if (!name) return { ok: false, message: '标签不能为空', list: read() }
  const list = read()
  if (list.indexOf(name) >= 0) return { ok: true, list: list }
  list.push(name)
  write(list)
  return { ok: true, list: list }
}

/** 删除自定义标签 */
function removeCustomTag(tag) {
  const list = read().filter((t) => t !== tag)
  write(list)
  return list
}

/**
 * 组装标签选项。
 * @param {string[]} presets 内置预设
 * @param {string[]} used 衣橱里已经用过的标签
 * @returns {Array<{name:string, custom:boolean}>}
 */
function buildTagOptions(presets, used) {
  const custom = read()
  const base = presets || []
  const names = []
  const push = (t) => {
    if (t && names.indexOf(t) < 0) names.push(t)
  }
  base.forEach(push)
  custom.forEach(push)
  ;(used || []).forEach(push)
  return names.map((name) => ({
    name: name,
    custom: custom.indexOf(name) >= 0 && base.indexOf(name) < 0,
  }))
}

/** 从衣橱数据里汇总用过的标签 */
function collectUsedTags(rows) {
  const out = []
  ;(rows || []).forEach((row) => {
    const tags = row && row.tags
    if (!tags || !tags.length) return
    tags.forEach((t) => {
      if (t && out.indexOf(t) < 0) out.push(t)
    })
  })
  return out
}

module.exports = {
  listCustomTags,
  isCustomTag,
  addCustomTag,
  removeCustomTag,
  buildTagOptions,
  collectUsedTags,
}
