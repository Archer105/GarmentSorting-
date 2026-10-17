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

/** 云服务请求的常见底层错误 -> 可照做的中文提示 */
function friendlyMessage(message) {
  const msg = String(message || '')
  if (!msg) return ''
  // 微信端在本地就拦掉了请求：域名没进 request 合法域名
  if (msg.indexOf('url not in domain list') >= 0) {
    const host = (/:([a-z0-9.-]+\.[a-z]{2,})/i.exec(msg) || [])[1]
    if (host && host !== 'mp-api.app.workbuddy.host') {
      return '域名未加入 request 合法域名：' + host
    }
    return (
      '云服务网关域名未生效：mp-api.app.workbuddy.host 由 WorkBuddy 统一管理，无需手工添加。' +
      '请在应用预览面板点右上角「分享」完成一次发布；本地调试可在开发者工具「详情 → 本地设置」勾选「不校验合法域名」'
    )
  }
  if (msg.indexOf('timeout') >= 0) return '网络超时，请检查网络后重试'
  if (msg.indexOf('ERR_NETWORK') >= 0 || msg.indexOf('网络') >= 0 && msg.indexOf('失败') >= 0) {
    return '网络异常，请检查网络后重试'
  }
  return ''
}

/** 把错误对象转成用户可读的一句话 */
function errText(error, fallback) {
  if (!error) return fallback || '操作失败，请重试'
  if (typeof error === 'string') {
    return friendlyMessage(error) || error
  }
  const raw = typeof error.message === 'string' ? error.message : ''
  const friendly = friendlyMessage(raw)
  if (friendly) return friendly
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
