# 数字绘画速成 🎨

Fast Paint By Numbers 是一款高性能的图像矢量化和颜色简化工具。它能将普通照片转化为精美的填色图，具有清晰的矢量边框和优化的颜色方案。

该引擎的核心部分使用 Rust 编写，并编译为 WebAssembly 格式。因此，无论是在 Web 环境、Node.js 环境还是原生 CLI 环境中，都能提供一致且高速的体验。

* * *

## ✨ 主要功能

*   🚀 高性能：基于 Rust 的核心引擎，即使处理大型图像也能实现极快的运算速度。
*   🌈 智能量化：经过优化的 K-Means++聚类算法，实现生动且精确的颜色还原。
*   🧩 高级面处理技术：基于 BFS 的面合并算法以及并查集连通分量标记技术，可生成清晰、有意义的区域。
*   📐 丰富的输出格式：
    *   SVG：简洁的矢量图案，可 optionally 添加标签和边框。
    *   PNG/JPG：高质量的光栅预览图。
    *   调色板 JSON：用于实物颜料匹配的详细颜色元数据。
*   🌍 多平台支持：通过 Wasm 与 Web 和 Node.js 应用程序实现集成。

* * *

## 📦 安装指南

### 1\. NPM 包（CLI 与 SDK）

可使用通用 CLI 进行高性能处理，或使用 SDK 实现深度集成：

```bash
# Install globally to use the 'fast-pbn' command
npm install -g fast-paint-by-numbers

# Or add as a dependency
npm install fast-paint-by-numbers
```

* * *

## 🚀 快速入门（CLI）

使用通用命令行界面，可将任何图片转换为填数字绘画图案：

```bash
# Full featured generation
fast-pbn \
  --input photo.jpg \
  --output ./output_dir \
  --kmeans-clusters 24 \
  --remove-facets-smaller-than 20 \
  --border-smoothing-passes 2 \
  --format svg,palette.json,quantized.png \
  --log-level info \
  --verbose
```

### 常用选项：

*   `-i, --input <path>` ：输入图片的路径（JPG、PNG、WebP 格式）。
*   `-o, --output <path>` ：输出目录或基础文件名。
*   `-c, --config <path>` ：用于高级微调的 JSON 配置文件。
*   `-k, --kmeans-clusters <num>` ：需要量化的颜色数量（默认：16）。
*   `--remove-facets-smaller-than <px>` ：过滤掉小的噪声区域（默认值：20）。
*   `--border-smoothing-passes <num>` ：矢量路径的平滑度（默认值：2）。
*   `--format <list>` ：输出格式（svg、palette.json、quantized.png、png、jpg）。
*   `--log-level <level>` ：日志详细程度（info, debug, warn, error）。

* * *

## 🛠 SDK 使用方式

### Web（浏览器）

```typescript
import { initializeWasmRuntime, generatePaintByNumbers, prepareRgbaFromImageSource } from 'fast-paint-by-numbers';

async function processImage(file: File) {
  // Use a Web Worker for heavy processing (recommended)
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.postMessage({ type: 'generate', file });
  worker.onmessage = (e) => console.log('Result:', e.data);
}
```

> \[!TIP\] 避免阻塞：对于 Web 应用，强烈建议在 Web Worker 中运行该生成器。有关可用于生产环境的实现方式，请参阅 packages/web-demo/src/worker.ts。

### Node.js

```typescript
import { initializeWasmRuntime, generatePaintByNumbers, prepareRgbaInput } from 'fast-paint-by-numbers';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';

if (isMainThread) {
  const worker = new Worker(import.meta.url, { workerData: { path: 'image.jpg' } });
  worker.on('message', (res) => console.log('Done:', res.facetCount));
} else {
  // Inside Worker Thread
  const { path } = workerData;
  await initializeWasmRuntime();
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = await generatePaintByNumbers(prepareRgbaInput(info.width, info.height, data));
  parentPort?.postMessage(result);
}
```

* * *

## 🏗 从源代码开始构建

### 构建 SDK（Wasm + TS）

需要 Bun 和 Rust 工具链：

```bash
bun install
bun run build
```

* * *

## 📦 包装与配送

### 1\. NPM 包(.tgz)

要生成可重新分发的 NPM 包：

```bash
# 1. Build Wasm and TS
bun run build

# 2. Packing
cd packages/sdk
npm pack
```

### 2\. 原生可执行文件 (.exe)

要生成高性能的独立二进制文件：

```bash
# Optimized Release Build
cargo build --release -p pbn-cli

# Found at: ./target/release/pbn-cli (or pbn-cli.exe)
```

* * *

## 🔬 开发中

```bash
# Check Rust core
cargo check

# Run tests
cargo test

# Run local web demo
bun run serve:web
```

* * *

## 📜 许可证

根据 MIT 许可证发布。更多信息请参见 `LICENSE` 。

* * *

*有关详细的迁移历史和技术状态，请参阅 docs/MIGRATION-LOG.md。*