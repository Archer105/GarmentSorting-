/** 通用小工具 */

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

/** Date -> 'YYYY-MM-DD' */
function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Date -> 'M月D日 周X' */
function formatDateHuman(date) {
  const d = date instanceof Date ? date : new Date(date)
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getMonth() + 1}月${d.getDate()}日 周${week}`
}

/** 相对今天的描述 */
function dateLabel(dateStr) {
  const today = formatDate(new Date())
  const tomorrow = formatDate(new Date(Date.now() + 86400000))
  if (dateStr === today) return '今天'
  if (dateStr === tomorrow) return '明天'
  return formatDateHuman(dateStr)
}

/** 生成一个足够随机的 id（用于会话 id / 文件名） */
function uid(prefix) {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix || 'id'}_${Date.now().toString(36)}_${rand}`
}

function toast(title, icon) {
  wx.showToast({ title: title, icon: icon || 'none', duration: 1800 })
}

function loading(title) {
  wx.showLoading({ title: title || '加载中', mask: true })
}

function hideLoading() {
  wx.hideLoading()
}

/** 把错误对象转成用户可读的一句话 */
function errText(error, fallback) {
  if (!error) return fallback || '操作失败，请重试'
  const code = error.code || (error.error && error.error.code)
  if (code === '23505') return '该内容已存在'
  if (code === '42501') return '没有权限执行该操作'
  if (code === '42P01') return '数据表不存在，请联系管理员'
  if (code && String(code).indexOf('auth_') === 0) return '登录状态已失效，请重新登录'
  if (code && String(code).indexOf('quota_') === 0) return 'AI 额度已用完或请求过于频繁'
  if (code && String(code).indexOf('gateway_') === 0) return '模型服务暂时不可用，请稍后重试'
  if (typeof error.message === 'string' && error.message) return error.message
  return fallback || '操作失败，请重试'
}

function confirm(title, content) {
  return new Promise((resolve) => {
    wx.showModal({
      title: title,
      content: content,
      confirmColor: '#6B4EFF',
      success(res) {
        resolve(!!res.confirm)
      },
      fail() {
        resolve(false)
      },
    })
  })
}

module.exports = {
  formatDate,
  formatDateHuman,
  dateLabel,
  uid,
  toast,
  loading,
  hideLoading,
  errText,
  confirm,
}
