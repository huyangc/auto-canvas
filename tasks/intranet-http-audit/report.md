# 内网 HTTP 编辑器兼容性排查

基线为远端 main 的 `2542db6`。普通 HTTP 下，画布启动、自动布局和撤销成功。SPICE 导入和 RNL 网表生成均在计算 SHA-256 时失败。

## 修复前的浏览器实测

在同一台机器上用无头 Chrome 加载同一份生产构建。临时静态服务器仅监听回环地址。Chrome 将 intranet.test 解析到该地址，但仍将这个普通 HTTP 域名判定为非安全上下文。对照组通过 127.0.0.1 访问，浏览器将其判定为安全上下文。测试未使用强制信任 HTTP 来源的浏览器参数。

| 操作                                 | 内网 HTTP 域名                                | 127.0.0.1 对照                                     |
| ------------------------------------ | --------------------------------------------- | -------------------------------------------------- |
| 打开示例并显示画布                   | 加载前没有原生 randomUUID，加载后生成 UUID v4 | 原生方法可用，画布显示                             |
| 两级运放示例执行 Auto Layout，再撤销 | 布局应用为修订 81，撤销为修订 82              | 相同                                               |
| 从文件导入含 MOS 和电阻的 circuit.sp | Cannot decode circuit.sp，读取 digest 失败    | 成功导入 1 个 Document、5 个结构实例，进入自动布局 |
| 查看普通 SPICE 网表                  | 输出含 .subckt                                | 同左                                               |
| 切换到 SPICE + RNL                   | Canvas 包校验读取 digest 失败                 | RNL 生成了含 .subckt 的输出                        |

另行构建 Notebook 版本，使用合成身份响应，通过同一个普通 HTTP 域名访问 /canvas/，画布成功显示。未连接真实 Notebook 或 Agent 后端。上述实验验证了浏览器能力和本地产品路径，未覆盖用户内网部署的代理、账号或存储策略。UUID 及模型 ID 的 5 项单元测试通过。

## 修复前的代码排查

- Web 与 Notebook 共用 main.tsx，均先加载 web-uuid。该兼容逻辑只作用于当前页面。自动布局 Worker 的生产入口产物中没有 randomUUID 调用，本次经过真实 Worker 的布局操作成功。
- 两种编辑模式的普通网表导入入口最终复用 importSpiceFiles。packages/spice/src/source.ts 使用 crypto.subtle.digest 计算源文件哈希。没有 digest 会使有效输入在源文件解码阶段被拒绝。
- apps/editor/src/features/netlist-export/rnl-runtime.ts 在启动 RNL Worker 前通过 decodeCanvasPackage 校验内置扩展包。RNL 导入、带 RNL 的网表生成和导出共用此运行时。另有外部 RNL Viewer 指向公网 HTTPS 地址，完全隔离的内网还需考虑该地址的可达性。
- 元件库的 componentLibraryCapture 使用 componentContentDigest 记录共享元件来源。浏览器 Agent 的文件暂存校验、制品下载及部分元件操作也直接计算 SHA-256。这些是源码确认的依赖，未进行真实账号或 Agent 的端到端测试。
- 在本次 HTTP 页面，navigator.clipboard、navigator.locks 和 navigator.serviceWorker 均不存在。复制选区在同页可使用内部缓冲区，程序化系统剪贴板写入受限，复制 PNG/SVG 有显式拒绝逻辑。Service Worker 注册会跳过。Web Locks 缺失会影响其他已关闭窗口的工作区发现，当前窗口的存储路径另走 IndexedDB 和 sessionStorage。

## 修复与验证

- 在 model 包中共享已有的 SHA-256 算法，同时支持 UTF-8 文本和原始字节。异步调用优先使用浏览器原生摘要，普通 HTTP 下使用相同算法的软件实现。原有同步调用仍可从 derived 导入。
- 网表源文件、RNL 包、共享元件和浏览器 Agent 文件使用共享实现。锁定包的哈希值、来源摘要前缀和制品校验规则沿用原有约定。
- 将 SPICE 导入后自动布局、RNL 生成加入 Playwright。两个用例在修复前均失败，修复后通过。测试使用 Chrome 的普通 HTTP 来源，并显式检查页面缺少 crypto.subtle。
- 原生和 HTTP 摘要路径均与 Node SHA-256 进行对照，覆盖 Unicode、二进制子数组和填充边界。类型检查和编辑器生产构建通过。
- 额外的 HTTP 浏览器用例替换了下载的 RNL 包字节，确认界面报告 SHA-256 不匹配。三个 HTTP 用例和 30 项相关单元测试通过。五个已发布 RNL 包的原始摘要全部核对通过。
- 首轮评审后的验证：独立锁校验和 Vite 配置从源码子入口读取摘要模块。普通 Web 与 Notebook 均构建成功，三个 HTTP 用例在开发服务器和生产构建下分别全部通过。HTTPS 实机测试不会运行这三个 HTTP 专用场景。
