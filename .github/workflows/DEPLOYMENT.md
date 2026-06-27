# GitHub Pages 部署指南

## 🚀 自动部署设置

此项目已配置GitHub Actions自动部署脚本，每次push到main分支时会自动构建和部署到GitHub Pages。

## 📋 部署步骤

### 1️⃣ 配置GitHub Pages

1. 打开仓库：https://github.com/CarsonHHS2023/speed-reading-trainer
2. 点击顶部菜单 **Settings**
3. 左侧菜单找到 **Pages**（在 "Code and automation" 部分）
4. 在 "Build and deployment" 中配置：
   - **Source**: 选择 `Deploy from a branch`
   - **Branch**: 选择 `main` 和 `/ (root)`
   - 点击 **Save**

### 2️⃣ 启用Actions权限

1. 进入仓库 **Settings**
2. 左侧找到 **Actions** → **General**
3. 在 "Workflow permissions" 中选择：
   - ✅ `Read and write permissions`
   - ✅ `Allow GitHub Actions to create and approve pull requests`
4. 点击 **Save**

### 3️⃣ 验证部署

1. 进入仓库 **Actions** 标签页
2. 应该能看到 "Deploy to GitHub Pages" 工作流
3. 第一次部署完成后（5-10分钟），访问：
4. https://CarsonHHS2023.github.io/speed-reading-trainer

## 🔄 自动部署工作流程

## 💻 本地开发流程

```bash
# 1. 克隆仓库
git clone https://github.com/CarsonHHS2023/speed-reading-trainer.git
cd speed-reading-trainer

# 2. 创建新分支（推荐）
git checkout -b feature/your-feature-name

# 3. 编辑文件（用您喜欢的编辑器打开）
# 例如修改 app.js, style.css, index.html

# 4. 本地测试
# 用浏览器打开 index.html 测试功能

# 5. 提交更改
git add .
git commit -m "优化阅读速度计算"

# 6. 推送到GitHub
git push origin feature/your-feature-name

# 7. 创建Pull Request 或 直接推送到main
git push origin main
📊 部署状态检查
查看部署日志
打开仓库 Actions 标签页
点击最新的 "Deploy to GitHub Pages" 工作流
查看详细的构建和部署日志
常见状态
✅ 绿色勾勾：部署成功
⏳ 黄色圆圈：正在部署中
❌ 红色叉号：部署失败（点击查看错误信息）
🐛 故障排除
问题1：权限不足
解决方案：

Code
Settings → Actions → General
→ Workflow permissions
→ 选择 "Read and write permissions"
问题2：Pages不显示
解决方案：

确保仓库是public（私有仓库需付费）
检查Settings → Pages中的Source配置
等待5-10分钟让GitHub完成部署
在Actions页面查看部署日志
问题3：404 Not Found
解决方案：

确保index.html已上传到仓库
检查URL是否正确（注意大小写）
清除浏览器缓存 (Ctrl+Shift+Delete)
尝试使用隐私模式打开
问题4：文件无法加载
解决方案：

检查网络连接（PDF.js使用CDN）
打开浏览器开发者工具(F12)查看错误
确认所有文件名大小写正确
📱 访问地址
Code
https://CarsonHHS2023.github.io/speed-reading-trainer
💡 开发建议
小步快跑：每次修改后立即测试和推送
清晰提交信息：帮助追踪改动历史
使用分支：重要改动前创建feature分支测试
备份代码：定期本地备份重要版本
标记版本：为稳定版本创建git tag
bash
# 创建版本标签
git tag -a v1.0.0 -m "首个发布版本"
git push origin v1.0.0
🔐 安全建议
HTTPS自动启用：GitHub Pages自动提供HTTPS
定期更新：检查PDF.js等依赖库的最新版本
代码审查：重要改动前进行审查
备份重要文件：使用本地Git仓库备份
📚 相关资源
GitHub Pages官方文档
GitHub Actions官方文档
Git基础教程
祝您部署顺利！ 🚀

Code

4. **点击 Commit changes** 保存

### 步骤3️⃣：配置GitHub Pages

1. **打开Settings**
   - 进入 → Settings → Pages

2. **配置Source**
   - Source: `Deploy from a branch`
   - Branch: `main` 和 `/ (root)`
   - 点击 Save

3. **启用Actions权限**
   - Settings → Actions → General
   - 选择 `Read and write permissions`
   - 点击 Save

### 步骤4️⃣：验证部署

1. **查看Actions**
   - 点击 Actions 标签
   - 应该看到 "Deploy to GitHub Pages" 工作流
   - 等待5-10分钟完成部署

2. **访问在线地址**
https://CarsonHHS2023.github.io/speed-reading-trainer

Code

## ✅ 部署完成后

| 功能 | 说明 |
|------|------|
| **自动更新** | 每次push到main分支，10分钟内自动部署 |
| **在线访问** | 通过上述URL随时访问最新版本 |
| **分支开发** | 可在feature分支上开发，测试后merge到main |
| **版本管理** | 使用git tag标记重要版本 |

## 🎯 下次修改流程

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 创建并切换分支
git checkout -b fix/speed-calculation

# 3. 修改文件
# （用编辑器打开index.html, app.js等）

# 4. 本地测试（浏览器打开index.html）

# 5. 提交并推送
git add .
git commit -m "修复中文速度计算算法"
git push origin fix/speed-calculation

# 6. 选择：
# 选项A - 创建Pull Request审查
# 选项B - 直接merge到main（立即部署）
git checkout main
git merge fix/speed-calculation
git push origin main
🆘 遇到问题？
检查清单：

✅ 仓库是否为public
✅ .github/workflows/deploy.yml文件是否创建
✅ GitHub Pages设置是否正确
✅ Actions权限是否启用
✅ Actions日志是否显示成功
如有问题，查看Actions页面的详细日志寻找错误信息！

现在您已准备好持续开发和自动部署了！ 🚀
