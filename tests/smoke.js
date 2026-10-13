/**
 * 小程序工程静态自检（零依赖，纯 Node）。
 * 用法： node tests/smoke.js
 *
 * 覆盖：app.json 结构、页面文件齐备性、tabBar 图标存在性、lazyCodeLoading、
 * JSON 严格性、WXML 表达式禁用语法、本地资源路径、require 路径可解析。
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const problems = []
const notes = []

function fail(msg) {
  problems.push(msg)
}
function ok(msg) {
  notes.push(msg)
}
function read(p) {
  return fs.readFileSync(p, 'utf8')
}
function exists(p) {
  try {
    fs.accessSync(p)
    return true
  } catch (e) {
    return false
  }
}

/* ---------- 1. project.config.json ---------- */
const projectConfigPath = path.join(ROOT, 'project.config.json')
let projectConfig = null
try {
  projectConfig = JSON.parse(read(projectConfigPath))
} catch (e) {
  fail('project.config.json 不是合法 JSON：' + e.message)
}

if (projectConfig) {
  if (projectConfig.compileType !== 'miniprogram') fail('project.config.json compileType 必须是 miniprogram')
  const root = projectConfig.miniprogramRoot || './'
  const sourceRoot = path.resolve(ROOT, root)
  if (!exists(path.join(sourceRoot, 'app.json'))) {
    fail('miniprogramRoot 指向的目录里没有 app.json -> ' + sourceRoot)
  }
  if (!projectConfig.appid) fail('project.config.json 缺少 appid')
  ok('project.config.json OK（miniprogramRoot=' + root + '）')
}

/* ---------- 2. app.json ---------- */
const appJsonPath = path.join(ROOT, 'app.json')
let appJson = null
try {
  appJson = JSON.parse(read(appJsonPath))
} catch (e) {
  fail('app.json 不是合法 JSON：' + e.message)
}

const pages = (appJson && appJson.pages) || []
if (!pages.length) fail('app.json: pages 为空')

if (appJson && appJson.lazyCodeLoading !== 'requiredComponents') {
  fail('app.json: lazyCodeLoading 必须为 "requiredComponents"，当前为 ' + JSON.stringify(appJson.lazyCodeLoading))
} else {
  ok('app.json: lazyCodeLoading = requiredComponents')
}

/* ---------- 3. 页面文件 ---------- */
pages.forEach((page) => {
  const base = path.join(ROOT, page)
  if (!exists(base + '.js')) fail('缺少页面脚本: ' + page + '.js')
  if (!exists(base + '.wxml')) fail('缺少页面模板: ' + page + '.wxml')
  const jsonPath = base + '.json'
  if (exists(jsonPath)) {
    try {
      JSON.parse(read(jsonPath))
    } catch (e) {
      fail(page + '.json 不是合法 JSON：' + e.message)
    }
  }
})
ok('页面文件检查完成，共 ' + pages.length + ' 个页面')

/* ---------- 4. tabBar ---------- */
if (appJson && appJson.tabBar) {
  const list = appJson.tabBar.list || []
  if (list.length < 2 || list.length > 5) fail('tabBar.list 数量必须在 2~5 之间，当前 ' + list.length)
  list.forEach((item) => {
    if (pages.indexOf(item.pagePath) < 0) fail('tabBar 页面未在 pages 中注册: ' + item.pagePath)
    ;[item.iconPath, item.selectedIconPath].forEach((icon) => {
      if (!icon) return
      if (!exists(path.join(ROOT, icon))) fail('tabBar 图标不存在: ' + icon)
    })
  })
  ok('tabBar 检查完成，共 ' + list.length + ' 项')
}

/* ---------- 5. sitemap ---------- */
try {
  JSON.parse(read(path.join(ROOT, 'sitemap.json')))
  ok('sitemap.json OK')
} catch (e) {
  fail('sitemap.json 不是合法 JSON：' + e.message)
}

/* ---------- 6. WXML 表达式禁用语法 ---------- */
const FORBIDDEN = [
  { re: /\?\./, msg: '可选链 ?.' },
  { re: /\?\?/, msg: '空值合并 ??' },
  { re: /=>/, msg: '箭头函数' },
  { re: /\.indexOf\s*\(/, msg: '方法调用 indexOf(' },
  { re: /\.map\s*\(/, msg: '方法调用 map(' },
  { re: /\.filter\s*\(/, msg: '方法调用 filter(' },
  { re: /\.find\s*\(/, msg: '方法调用 find(' },
]

function walk(dir, ext, out) {
  fs.readdirSync(dir).forEach((name) => {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) {
      if (name === 'node_modules' || name === 'miniprogram_npm' || name === '.git') return
      walk(full, ext, out)
    } else if (name.endsWith(ext)) {
      out.push(full)
    }
  })
  return out
}

const wxmlFiles = walk(ROOT, '.wxml', [])
const wxmlBodies = {}
wxmlFiles.forEach((file) => {
  const text = read(file)
  wxmlBodies[file] = text
  const expressions = text.match(/\{\{[\s\S]*?\}\}/g) || []
  expressions.forEach((expr) => {
    FORBIDDEN.forEach((rule) => {
      if (rule.re.test(expr)) {
        fail(path.relative(ROOT, file) + ' 的 WXML 表达式使用了' + rule.msg + '：' + expr.trim())
      }
    })
  })
})
ok('WXML 表达式检查完成，共 ' + wxmlFiles.length + ' 个模板')

/* ---------- 7. 本地资源路径 ---------- */
const STATIC_RE = /['"](\/images\/[A-Za-z0-9_\-./]+)['"]/g
const jsFiles = walk(ROOT, '.js', []).filter((f) => f.indexOf('tests') < 0)
const referenced = new Set()

function collect(text) {
  let m
  STATIC_RE.lastIndex = 0
  while ((m = STATIC_RE.exec(text)) !== null) referenced.add(m[1])
}
wxmlFiles.forEach((f) => collect(wxmlBodies[f]))
jsFiles.forEach((f) => collect(read(f)))
referenced.forEach((ref) => {
  if (!exists(path.join(ROOT, ref))) fail('引用的本地资源不存在: ' + ref)
})
ok('本地资源引用检查完成，共 ' + referenced.size + ' 个路径')

/* ---------- 8. require 路径可解析 ---------- */
const REQ_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g
let reqCount = 0
jsFiles.forEach((file) => {
  const text = read(file)
  let m
  REQ_RE.lastIndex = 0
  while ((m = REQ_RE.exec(text)) !== null) {
    const spec = m[1]
    if (spec.charAt(0) !== '.') continue // 包名（构建 npm 后由 miniprogram_npm 提供）
    reqCount += 1
    const target = path.resolve(path.dirname(file), spec)
    if (!exists(target) && !exists(target + '.js')) {
      fail(path.relative(ROOT, file) + ' 的 require 无法解析: ' + spec)
    }
  }
})

/* ---------- 9. usingComponents 指向 ---------- */
const usingRe = /"usingComponents"\s*:\s*\{([\s\S]*?)\}/g
walk(ROOT, '.json', []).forEach((file) => {
  if (file.indexOf('node_modules') >= 0) return
  const text = read(file)
  let m
  usingRe.lastIndex = 0
  while ((m = usingRe.exec(text)) !== null) {
    const body = m[1]
    const pairs = body.match(/"([^"]+)"\s*:\s*"([^"]+)"/g) || []
    pairs.forEach((pair) => {
      const value = pair.split(':')[1].replace(/["\s]/g, '')
      if (!value || value.charAt(0) !== '/') return
      const base = path.join(ROOT, value)
      if (!exists(base + '.js') || !exists(base + '.wxml')) {
        fail(path.relative(ROOT, file) + ' 的 usingComponents 指向不存在的组件: ' + value)
      }
    })
  }
})

/* ---------- 输出 ---------- */
notes.forEach((n) => console.log('  · ' + n))
console.log('  · require 相对路径 ' + reqCount + ' 处全部可解析')
console.log('')
if (problems.length) {
  console.log('发现问题 ' + problems.length + ' 个：')
  problems.forEach((p) => console.log('  ✗ ' + p))
  process.exit(1)
}
console.log('✅ 静态自检全部通过')
