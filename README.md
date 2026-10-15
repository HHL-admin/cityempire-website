# 城池帝国官网

游戏官网，包含智能客服功能（基于 DeepSeek AI）

## 功能

- 游戏介绍与特色展示
- 多平台下载入口
- 智能客服（右下角悬浮按钮）

## 部署到 Vercel

### 方法一：通过 GitHub（推荐）

1. **创建 GitHub 仓库**
   - 访问 https://github.com/new
   - 仓库名：`cityempire-website`
   - 设为 Public
   - 点击 "Create repository"

2. **上传代码到 GitHub**
   ```bash
   cd e:\手机游戏\game\website
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/你的用户名/cityempire-website.git
   git push -u origin main
   ```

3. **连接 Vercel**
   - 访问 https://vercel.com/signup
   - 用 GitHub 账号登录
   - 点击 "Add New" → "Project"
   - 选择 `cityempire-website` 仓库
   - 点击 "Deploy"
   - 等待部署完成（约1分钟）

4. **获取网址**
   - 部署成功后会得到网址：`https://cityempire-website.vercel.app`
   - 可以在 Settings → Domains 添加自定义域名

### 方法二：直接拖放文件

1. 访问 https://vercel.com/new
2. 选择 "Browse" 上传整个 `website` 文件夹
3. 点击 "Deploy"

## 更新网站

### GitHub 方式
```bash
# 修改代码后
git add .
git commit -m "更新说明"
git push
# Vercel 会自动重新部署
```

### 直接方式
在 Vercel 控制台重新上传文件

## 本地测试

```bash
# 安装 http-server（只需一次）
npm install -g http-server

# 启动本地服务器
cd e:\手机游戏\game\website
http-server -p 8080

# 浏览器访问 http://localhost:8080
```

## 文件说明

- `index.html` - 主页面
- `style.css` - 样式表
- `app.js` - 智能客服交互逻辑
- `vercel.json` - Vercel 部署配置
- `README.md` - 说明文档

## 注意事项

- AI 接口地址：`http://150.158.119.206:3000/api/chat`
- 如果游戏服务器地址变更，需修改 `app.js` 中的 `API_URL`
- Vercel 免费版每月流量 100GB，足够使用
