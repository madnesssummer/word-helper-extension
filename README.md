单词助手（Chrome 扩展，Manifest V3）

功能
- 划词展示翻译卡片，显示翻译、音标、发音和收藏按钮
- 收藏后加入单词本；词条仅保存单词、含义和词性，旧词条会自动迁移
- 访问网页时自动对单词本中的单词进行高亮
- 支持基于记忆曲线（简化的艾宾浩斯间隔）安排复习
- 弹窗查看、搜索并添加单词；复习按钮更新复习进度
- 全文翻译按当前页面单独开启，页面跳转后需要重新点击开启
- 按月查看学习热力图，并使用千问生成包含查询、收藏和复习数据的周总结
- 选项页切换高亮开关、目标语言

安装调试
1. 打开 Chrome 扩展（chrome://extensions）
2. 打开“开发者模式”
3. “加载已解压的扩展程序”，选择 word-helper-extension 目录

目录
- manifest.json：扩展清单
- background.js：后台服务脚本，存储与复习计划
- content-script.js：注入页面，处理划词与高亮
- card.css：卡片样式
- popup.html/.css/.js：扩展弹窗
- options.html：设置页
- tests/：Jest 单元测试

配置（阿里云百炼千问）
- 在阿里云百炼的华北2（北京）地域创建 API Key，在扩展设置页填写并保存。默认模型为 `qwen3.8-flash`，无需搭建代理。
- 划词、划句、全文翻译和周总结由后台直接调用百炼。API Key 保存在当前浏览器的 `chrome.storage.local`（`settings.qwen.apiKey`），不写入项目文件。
- 从 DeepSeek 版本升级时，旧 Key 不会沿用；首次保存新版设置时会清除旧的 DeepSeek 配置，保留原目标语言、单词本和复习记录。

配置（腾讯云机器翻译 TMT）
- 在项目根目录创建 `config.local.json`（已提供示例文件，可直接修改）：
  ```json
  {
    "tencentCloud": {
      "secretId": "YOUR_SECRET_ID",
      "secretKey": "YOUR_SECRET_KEY",
      "region": "ap-guangzhou"
    }
  }
  ```
- 扩展后台 `background.js` 会优先读取 `config.local.json`，若不存在会尝试 `config.json`，否则回退到占位翻译。
- 注意：请勿将包含真实密钥的文件提交到公共仓库，可通过 `.gitignore` 忽略。

测试
- 需要 Node 18+
- 安装依赖：npm i
- 运行测试：npm test

