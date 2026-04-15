单词助手（Chrome 扩展，Manifest V3）

功能
- 划词展示翻译卡片，显示翻译、音标、收藏按钮
- 收藏后加入单词本（storage.local 存储）
- 访问网页时自动对单词本中的单词进行高亮
- 支持基于记忆曲线（简化的艾宾浩斯间隔）安排复习
- 弹窗查看、搜索并添加单词；复习按钮更新复习进度
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

