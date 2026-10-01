# Power Up Level 1 音频播放器

在本机 Docker 容器中浏览并播放 Cambridge Power Up Level 1 音频。

## 启动

需要安装并启动 Docker Desktop，使用 Linux 容器模式，并确保 `docker compose` 命令可用。在项目根目录运行：

```powershell
docker compose up -d --build
```

浏览器打开 <http://localhost:8080>。

停止服务：

```powershell
docker compose down
```

查看运行日志：

```powershell
docker compose logs -f
```

## 大陆镜像源

默认 Go 构建镜像使用 `docker.1ms.run/library/golang:1.26.8-alpine`。如需切换镜像源或版本，在项目根目录创建 `.env` 文件并设置：

```dotenv
GO_IMAGE=docker.1ms.run/library/golang:1.26.8-alpine
```

Compose 构建时会把 `GO_IMAGE` 传给 Dockerfile。当前应用只使用 Go 标准库，不需要下载 npm 依赖。 `docker.1ms.run` 是第三方 Docker Hub 加速源；若该地址无法访问，可将 `.env` 中的值换成可用的 `golang` 镜像地址。

## 音频目录

容器以只读方式挂载 `./audios`。程序从教材目录名和 `Power Up Level 1 CDn Track n.mp3` 文件名生成目录，并按数字顺序排列。增加或移除音频后，点击页面右上角的刷新按钮即可重新扫描。

## 播放操作

- 点击目录中的教材和 CD 浏览曲目。
- 搜索框可匹配教材、CD、曲目编号或文件名。
- 输入曲目编号可在当前 CD 中定位。
- 底部主按钮会按播放状态切换“开始”或“暂停”；“重播”会从头播放当前曲目。
- “已听”按钮可切换当前曲目的已听状态。状态保存在当前浏览器中；已听曲目会排在未听曲目之后，同一 CD 中仍按曲目号排列，搜索结果保留教材和 CD 顺序。
- 选择其他曲目只会切换音频；需要按“开始”或曲目行末的播放按钮启动。

服务只绑定在本机回环地址 `127.0.0.1:8080`，不会通过局域网端口提供访问。
