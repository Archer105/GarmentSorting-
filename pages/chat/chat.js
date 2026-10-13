const app = getApp()
const auth = require('../../utils/auth')
const api = require('../../utils/api')
const ai = require('../../utils/ai')
const weatherSvc = require('../../utils/weather')
const util = require('../../utils/util')

const QUICK_PROMPTS = [
  '今天上班穿什么？',
  '今天有点冷，帮我加一件外套',
  '周末想约会，穿得温柔一点',
  '我的衣橱里还缺哪些基础款？',
]

const MAX_CONTEXT_GARMENTS = 120
const MAX_HISTORY = 12

Page({
  data: {
    messages: [],
    draft: '',
    sending: false,
    scrollTo: '',
    garmentCount: 0,
    weatherLabel: '',
    quickPrompts: QUICK_PROMPTS,
  },

  onLoad() {
    this.messages = []
    this.garments = []
    this.weather = null
    this.ready = null
  },

  onShow() {
    auth.requireLogin().then((session) => {
      if (!session) return
      if (this.ready) return
      this.ready = this.init(session)
    })
  },

  onUnload() {
    if (this.flushTimer) clearTimeout(this.flushTimer)
  },

  /* ------------------------------- 初始化 ------------------------------- */

  async init(session) {
    this.conversationId = this.resolveConversationId(session)
    await this.loadGarments()
    await this.ensureWeather()
    await this.loadHistory()
  },

  resolveConversationId(session) {
    const uid = (session && session.user && session.user.id) || 'guest'
    const storageKey = 'chat_conversation_id_' + uid
    let id = wx.getStorageSync(storageKey)
    if (!id) {
      id = util.uid('conv')
      wx.setStorageSync(storageKey, id)
    }
    return id
  },

  loadGarments() {
    return api.listGarments().then((res) => {
      this.garments = res.ok ? res.data : []
      this.setData({ garmentCount: this.garments.length })
    })
  },

  ensureWeather() {
    const cached = app.globalData.weather
    if (cached) {
      this.weather = cached
      this.setData({ weatherLabel: cached.label || '' })
      return Promise.resolve()
    }
    return app.loadSettings().then((settings) => {
      const city = (settings && settings.city) || '北京'
      return weatherSvc.getWeather({ city: city, date: util.formatDate(new Date()) }).then((res) => {
        if (res.ok) {
          this.weather = res.data
          app.globalData.weather = res.data
          this.setData({ weatherLabel: res.data.label || '' })
        }
      })
    })
  },

  loadHistory() {
    return api.listChatMessages(this.conversationId, 100).then((res) => {
      if (!res.ok || !res.data.length) return
      this.messages = res.data.map((row) => ({
        key: util.uid('m'),
        role: row.role === 'user' ? 'user' : 'assistant',
        content: row.content || '',
      }))
      this.syncMessages()
    })
  },

  /* ------------------------------- 渲染 ------------------------------- */

  syncMessages() {
    this.setData({
      messages: this.messages.map((m) => ({ key: m.key, role: m.role, content: m.content })),
      scrollTo: this.messages.length ? this.messages[this.messages.length - 1].key : '',
    })
  },

  appendMessage(role, content) {
    const key = util.uid('m')
    this.messages.push({ key: key, role: role, content: content })
    this.syncMessages()
    return key
  },

  contentOf(key) {
    const found = this.messages.find((m) => m.key === key)
    return found ? found.content : ''
  },

  /* ------------------------------- 发送 ------------------------------- */

  onDraft(e) {
    this.setData({ draft: e.detail.value })
  },

  onQuick(e) {
    this.ask(e.currentTarget.dataset.q)
  },

  onSend() {
    if (this.data.sending) return
    const text = (this.data.draft || '').trim()
    if (!text) return
    this.setData({ draft: '' })
    this.ask(text)
  },

  /* 供其它页面调用：预填并直接提问 */
  prefill(question) {
    const run = () => this.ask(question)
    if (this.ready) this.ready.then(run)
    else run()
  },

  ask(text) {
    if (!text) return
    if (this.data.sending) {
      this.setData({ draft: text })
      util.toast('上一条还在回复中')
      return
    }

    this.appendMessage('user', text)
    api.appendChatMessage(this.conversationId, 'user', text).catch(() => null)

    const key = this.appendMessage('assistant', '')
    this.setData({ sending: true })

    const history = this.buildHistory()
    const context = this.buildContext()

    ai.chatStream(history, context, (delta) => this.pushDelta(key, delta)).then((res) => {
      this.flushNow(key)
      this.setData({ sending: false })

      const finalText = this.contentOf(key)
      if (!res.ok && !finalText) {
        this.setContent(key, res.message || '抱歉，我这边暂时没法回答，请稍后再试。')
        return
      }
      if (finalText) {
        api.appendChatMessage(this.conversationId, 'assistant', finalText).catch(() => null)
      }
      if (res.partial) util.toast('回答被中断了，可以再问一次')
    })
  },

  pushDelta(key, delta) {
    const found = this.messages.find((m) => m.key === key)
    if (!found) return
    found.content += delta
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.syncMessages()
    }, 120)
  },

  flushNow(key) {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.syncMessages()
  },

  setContent(key, content) {
    const found = this.messages.find((m) => m.key === key)
    if (!found) return
    found.content = content
    this.syncMessages()
  },

  buildHistory() {
    const list = this.messages
      .filter((m) => m.content && (m.role === 'user' || m.role === 'assistant'))
      .slice(-MAX_HISTORY)
    return list.map((m) => ({ role: m.role, content: m.content }))
  },

  buildContext() {
    const garments = this.garments.slice(0, MAX_CONTEXT_GARMENTS)
    const extra = this.garments.length > MAX_CONTEXT_GARMENTS ? '\n（清单较长，仅展示前 ' + MAX_CONTEXT_GARMENTS + ' 件）' : ''
    return [
      '【当前天气】',
      ai.weatherToText(
        this.weather || { city: app.city(), date: util.formatDate(new Date()) }
      ),
      '',
      '【衣橱清单】',
      ai.garmentsToText(garments) + extra,
      '',
      '【用户资料】',
      '昵称：' + ((app.globalData.settings || {}).nickname || '未设置'),
    ].join('\n')
  },

  /* ------------------------------- 清空 ------------------------------- */

  onClear() {
    util.confirm('清空对话？', '会删除当前账号在本机的对话记录，衣橱数据不受影响。').then((ok) => {
      if (!ok) return
      api.clearChatMessages(this.conversationId).then(() => {
        this.messages = []
        this.syncMessages()
        util.toast('已清空')
      })
    })
  },
})
