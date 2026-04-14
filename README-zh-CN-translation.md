# 数字绘画速成 🎨

[English](./README.md) · [简体中文](./README-zh-CN-translation.md)

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

### 2\. 原生 Rust 可执行文件

也可以直接从 GitHub Releases 下载已构建好的原生可执行文件使用：

https://github.com/ianho7/fast-paint-by-numbers/releases/

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

### 原生 Rust CLI

如果你更希望使用独立的 Rust 可执行文件，而不是 npm CLI，可以这样使用：

```bash
# 构建原生可执行文件
cargo build --release -p pbn-cli

# 运行原生可执行文件
./target/release/pbn-cli \
  --input photo.jpg \
  --output ./output_dir \
  --kmeans-clusters 24 \
  --remove-facets-smaller-than 20 \
  --border-smoothing-passes 2 \
  --format svg,palette.json,quantized.png,png \
  --verbose
```

在 Windows 上，可执行文件路径为 `.\target\release\pbn-cli.exe`。

### 常用选项：

*   `-i, --input <path>` ：输入图片的路径（JPG、PNG、WebP 格式）。
*   `-o, --output <path>` ：输出目录或基础文件名。
*   `-c, --config <path>` ：用于高级微调的 JSON 配置文件。
*   `-k, --kmeans-clusters <num>` ：需要量化的颜色数量（默认：16）。
*   `--remove-facets-smaller-than <px>` ：过滤掉小的噪声区域（默认值：20）。
*   `--border-smoothing-passes <num>` ：矢量路径的平滑度（默认值：2）。
*   `--format <list>` ：输出格式（svg、palette.json、quantized.png、png、jpg）。默认值：`svg,palette.json,quantized.png,png`。
*   `--resize` ：使用默认的 `1024x1024` 限制，在处理前启用输入图片缩放。
*   `--no-resize` ：在处理前禁用输入图片缩放。
*   `--resize-max-width <num>` ：处理前允许的输入图片最大宽度（默认值：1024）。传入该参数时会自动启用 resize。
*   `--resize-max-height <num>` ：处理前允许的输入图片最大高度（默认值：1024）。传入该参数时会自动启用 resize。
*   `--log-level <level>` ：日志详细程度（信息、调试、警告、错误）。

> [!NOTE]
> 默认情况下不会进行 resize。传入 `--resize`，或传入 `--resize-max-width` / `--resize-max-height` 任一参数时，会自动启用 resize。启用后，缩放会在正式处理前执行，缩放后的尺寸也会成为最终输出结果的实际尺寸。

* * *

## 🛠 SDK 使用方式

### Web（浏览器）

为获得最佳性能并保持用户界面的响应速度，强烈建议在 Web Worker 中运行该引擎。

**1\. 创建你的 worker 文件（ `worker.ts` ）：**

```typescript
import { initializeWasmRuntime, generatePaintByNumbers, prepareRgbaFromImageSource } from 'fast-paint-by-numbers';

// The worker listens for image data, processes it, and sends back the result.
self.onmessage = async (e) => {
  const { file } = e.data;
  await initializeWasmRuntime();
  const input = await prepareRgbaFromImageSource(file);
  const result = await generatePaintByNumbers(input);
  self.postMessage(result);
};
```

**2\. 从主线程调用：**

```typescript
async function processImage(file: File) {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.postMessage({ file });
  worker.onmessage = (e) => console.log('Result:', e.data);
}
```

> \[!TIP\] 为什么要单独创建文件？Web Workers 必须从具体的文件路径进行初始化。上述代码假定你的源代码目录中有一个用于导入 SDK 的 `worker.ts` 文件。

### Node.js（后端）

在典型的后端场景中（例如使用 Express 或无服务器函数），你可以直接利用 `sharp` 来解码像素，从而处理上传的图片。

```typescript
import { initializeWasmRuntime, generatePaintByNumbers, prepareRgbaInput } from 'fast-paint-by-numbers';
import sharp from 'sharp';
import fs from 'node:fs/promises';

async function handleImageUpload(inputPath: string, outputPath: string) {
  // 1. Initialize Wasm runtime (perform once)
  await initializeWasmRuntime();

  // 2. Decode the image to raw RGBA bytes using sharp
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 3. Generate the paint-by-numbers pattern
  const result = await generatePaintByNumbers(
    prepareRgbaInput(info.width, info.height, data),
    { kmeansClusters: 24 }
  );

  // 4. Save the result (SVG or metadata) to disk
  await fs.writeFile(outputPath, result.svg);
  console.log(`Success! Points processed: ${result.facetCount}`);
}
```

* * *

## ⚡ 性能基准测试

测试使用的执行参数（不调整图片大小）：
`--kmeans-clusters 16 --remove-facets-smaller-than 20 --border-smoothing-passes 2`

| 图片尺寸 | 分辨率 | Rust CLI (exe) | NPM CLI (Wasm) | 原生 Javascript 方案<br />https://github.com/drake7707/paintbynumbersgenerator | Python 方案<br />https://github.com/CoderHam/PaintingByNumbersIFY<br />CPU模式运行 |
| :--- | :--- | :--- | :--- | ---- | ---- |
| **小 (Small)** | 640x426 (0.27 MP) | 0.87s | 1.47s | 9.51s | 3.37s |
| **中 (Medium)** | 1280x853 (1.09 MP) | 9.36s | 7.73s | 360.12s | 10.37s |
| **大 (Large)** | 1920x1280 (2.46 MP) | 20.64s | 18.08s | RangeError Maximum call stack size exceeded | 21.97s |

* * *

## 🏗 从源代码开始构建

### 构建 SDK（Wasm + TS）

需要 Bun 和 Rust 工具链：

```bash
bun install
bun run build
```

* * *

## 📦 打包与分发

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

## 🔬 开发

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
