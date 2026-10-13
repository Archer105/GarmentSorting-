/**
 * 数据访问层：衣橱单品、穿搭记录、AI 对话、用户偏好、图片云存储。
 *
 * 约定：owner_id 一律由数据库 DEFAULT auth.uid() 填充，前端不传；
 * RLS 负责按用户隔离，前端不做「这行是不是我的」这类安全判断。
 */
const { cloud } = require('./cloud')
const { currentUserId, currentUserName, getSession } = require('./auth')
const { uid } = require('./util')

function ownerName() {
  return currentUserName()
}

/* ---------------------------------- 单品 ---------------------------------- */

async function listGarments(options) {
  const opts = options || {}
  let query = cloud.database.from('garments').select('*')
  if (opts.category && opts.category !== '全部') {
    query = query.eq('category', opts.category)
  }
  const res = await query.order('created_at', { ascending: false })
  if (res.error) return { ok: false, message: res.error.message || '衣橱加载失败', data: [] }

  let rows = res.data || []
  const keyword = (opts.keyword || '').trim()
  if (keyword) {
    rows = rows.filter((item) => {
      const hay = [item.name, item.color, item.note, (item.tags || []).join(' ')]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.indexOf(keyword.toLowerCase()) >= 0
    })
  }
  return { ok: true, data: rows }
}

async function getGarment(id) {
  const res = await cloud.database.from('garments').select('*').eq('id', id).maybeSingle()
  if (res.error) return { ok: false, message: res.error.message || '加载失败', data: null }
  return { ok: true, data: res.data }
}

async function createGarment(payload) {
  const res = await cloud.database
    .from('garments')
    .insert({
      name: payload.name,
      category: payload.category,
      tags: payload.tags || [],
      color: payload.color || null,
      season: payload.season || null,
      image_path: payload.image_path || null,
      note: payload.note || null,
      owner_name: ownerName(),
    })
    .select()
  if (res.error) return { ok: false, message: res.error.message || '保存失败' }
  const created = res.data && res.data[0]
  if (!created) return { ok: false, message: '保存失败：没有写入权限' }
  return { ok: true, data: created }
}

async function updateGarment(id, payload) {
  const patch = {
    name: payload.name,
    category: payload.category,
    tags: payload.tags || [],
    color: payload.color || null,
    season: payload.season || null,
    note: payload.note || null,
  }
  if (payload.image_path) patch.image_path = payload.image_path

  const res = await cloud.database.from('garments').update(patch).eq('id', id).select()
  if (res.error) return { ok: false, message: res.error.message || '更新失败' }
  const affected = Array.isArray(res.data) ? res.data : []
  if (affected.length === 0) return { ok: false, message: '没有改动：该单品可能不存在或不属于你' }
  return { ok: true, data: affected[0] }
}

async function removeGarment(id, imagePath) {
  const res = await cloud.database.from('garments').delete().eq('id', id).select()
  if (res.error) return { ok: false, message: res.error.message || '删除失败' }
  const removed = Array.isArray(res.data) ? res.data : []
  if (removed.length === 0) return { ok: false, message: '没有删除：该单品可能不存在或不属于你' }
  if (imagePath) {
    try {
      await cloud.storage.remove([imagePath])
    } catch (e) {
      // 图片删除失败不影响单品删除结果
    }
  }
  return { ok: true }
}

/** 衣橱概览：总数 + 各分类数量 */
async function garmentStats() {
  const res = await cloud.database.from('garments').select('category')
  if (res.error) return { ok: false, total: 0, byCategory: {} }
  const rows = res.data || []
  const byCategory = {}
  rows.forEach((row) => {
    const key = row.category || '其他'
    byCategory[key] = (byCategory[key] || 0) + 1
  })
  return { ok: true, total: rows.length, byCategory: byCategory }
}

/* -------------------------------- 图片存储 -------------------------------- */

function extOf(filePath) {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filePath || '')
  return match ? match[1].toLowerCase() : 'jpg'
}

const MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
}

function readFileAsArrayBuffer(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: filePath,
      success(res) {
        resolve(res.data)
      },
      fail(err) {
        reject(new Error(err.errMsg || '读取图片失败'))
      },
    })
  })
}

/** 上传一张衣物图片，返回云存储路径 */
async function uploadGarmentImage(tempFilePath) {
  const session = await getSession()
  if (!session || !session.user) return { ok: false, message: '请先登录' }

  let buffer
  try {
    buffer = await readFileAsArrayBuffer(tempFilePath)
  } catch (e) {
    return { ok: false, message: e.message || '读取图片失败' }
  }

  const ext = extOf(tempFilePath)
  const path = cloud.storage.userPath(session.user.id, `garments/${uid('g')}.${ext}`)
  try {
    const res = await cloud.storage.upload(path, buffer, {
      contentType: MIME[ext] || 'image/jpeg',
      upsert: false,
    })
    if (res.error) return { ok: false, message: res.error.message || '图片上传失败' }
    return { ok: true, path: path }
  } catch (error) {
    return { ok: false, message: (error && error.message) || '图片上传失败' }
  }
}

function pickSignedUrl(data) {
  if (!data) return ''
  if (typeof data === 'string') return data
  return data.signedUrl || data.signedURL || data.url || ''
}

/** 为若干存储路径换取可显示的临时链接（默认 3600s） */
async function signedUrls(paths) {
  const list = (paths || []).filter(Boolean)
  if (!list.length) return {}
  try {
    const res = await cloud.storage.createSignedUrls(list, 3600)
    const map = {}
    if (res.error) return map
    const arr = Array.isArray(res.data) ? res.data : []
    arr.forEach((entry, index) => {
      const url = pickSignedUrl(entry)
      if (url) map[list[index]] = url
    })
    // 个别实现可能返回 { path: url } 结构
    if (Object.keys(map).length === 0 && res.data && !Array.isArray(res.data)) {
      list.forEach((p) => {
        const url = pickSignedUrl(res.data[p])
        if (url) map[p] = url
      })
    }
    return map
  } catch (e) {
    return {}
  }
}

/* -------------------------------- 穿搭记录 -------------------------------- */

async function listOutfitRecords(limit) {
  const res = await cloud.database
    .from('outfit_records')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit || 20)
  if (res.error) return { ok: false, message: res.error.message, data: [] }
  return { ok: true, data: res.data || [] }
}

async function createOutfitRecord(payload) {
  const res = await cloud.database
    .from('outfit_records')
    .insert({
      title: payload.title,
      weather: payload.weather || null,
      temperature: payload.temperature || null,
      forecast_date: payload.forecast_date || null,
      item_ids: payload.item_ids || [],
      advice: payload.advice || null,
      source: payload.source || 'auto',
      owner_name: ownerName(),
    })
    .select()
  if (res.error) return { ok: false, message: res.error.message }
  return { ok: true, data: res.data && res.data[0] }
}

async function removeOutfitRecord(id) {
  const res = await cloud.database.from('outfit_records').delete().eq('id', id).select()
  if (res.error) return { ok: false, message: res.error.message }
  const removed = Array.isArray(res.data) ? res.data : []
  return { ok: removed.length > 0, message: removed.length ? '' : '没有删除：记录不存在或不属于你' }
}

/* ------------------------------- AI 对话记录 ------------------------------- */

async function listChatMessages(conversationId, limit) {
  const res = await cloud.database
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit || 100)
  if (res.error) return { ok: false, message: res.error.message, data: [] }
  return { ok: true, data: res.data || [] }
}

async function appendChatMessage(conversationId, role, content) {
  const res = await cloud.database
    .from('chat_messages')
    .insert({
      conversation_id: conversationId,
      role: role,
      content: content,
      owner_name: ownerName(),
    })
    .select()
  if (res.error) return { ok: false, message: res.error.message }
  return { ok: true, data: res.data && res.data[0] }
}

async function clearChatMessages(conversationId) {
  const res = await cloud.database
    .from('chat_messages')
    .delete()
    .eq('conversation_id', conversationId)
    .select()
  if (res.error) return { ok: false, message: res.error.message }
  return { ok: true, removed: (res.data || []).length }
}

/* -------------------------------- 用户偏好 -------------------------------- */

async function getSettings() {
  const res = await cloud.database.from('user_settings').select('*').maybeSingle()
  if (res.error) return { ok: false, data: null, message: res.error.message }
  return { ok: true, data: res.data }
}

/** 只写入本次真正修改的字段，避免「只改城市」把昵称清空 */
function settingsFields(patch) {
  const fields = {}
  if (patch && patch.nickname !== undefined) fields.nickname = patch.nickname || null
  if (patch && patch.city !== undefined) fields.city = patch.city || null
  return fields
}

async function saveSettings(patch) {
  const session = await getSession()
  if (!session || !session.user) return { ok: false, message: '请先登录' }

  const fields = settingsFields(patch)
  if (!Object.keys(fields).length) return { ok: true, data: null }

  const existing = await cloud.database.from('user_settings').select('owner_id').maybeSingle()
  if (existing.error) return { ok: false, message: existing.error.message }

  if (existing.data) {
    const res = await cloud.database
      .from('user_settings')
      .update(Object.assign({}, fields, { updated_at: new Date().toISOString() }))
      .eq('owner_id', session.user.id)
      .select()
    if (res.error) return { ok: false, message: res.error.message }
    const rows = Array.isArray(res.data) ? res.data : []
    if (!rows.length) return { ok: false, message: '保存失败：没有写入权限' }
    return { ok: true, data: rows[0] }
  }

  const res = await cloud.database
    .from('user_settings')
    .insert(Object.assign({ owner_name: ownerName() }, fields))
    .select()
  if (res.error) return { ok: false, message: res.error.message }
  return { ok: true, data: res.data && res.data[0] }
}

module.exports = {
  listGarments,
  getGarment,
  createGarment,
  updateGarment,
  removeGarment,
  garmentStats,
  uploadGarmentImage,
  signedUrls,
  listOutfitRecords,
  createOutfitRecord,
  removeOutfitRecord,
  listChatMessages,
  appendChatMessage,
  clearChatMessages,
  getSettings,
  saveSettings,
  currentUserId,
}
