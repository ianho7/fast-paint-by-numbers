# Fast Paint By Numbers 🎨

[English](./README.md)· [简体中文](./README-zh-CN-translation.md)

**Fast Paint By Numbers** is a high-performance image vectorization and color reduction engine. It transforms standard photographs into beautiful, numbered paint-by-numbers patterns with clean vector borders and optimized color palettes.

Built with **Rust** for the engine core and compiled to **WebAssembly**, it provides a consistent, high-speed experience across the Web, Node.js, and Native CLI environments.

---

## ✨ Key Features

- **🚀 High Performance**: Rust-powered core engine for lightning-fast processing even on large images.
- **🌈 Smart Quantization**: Optimized K-Means++ clustering for vibrant and accurate color reduction.
- **🧩 Advanced Facet Processing**: BFS-based facet merging and Union-Find Connected Component Labeling (CCL) for clean, meaningful regions.
- **📐 Rich Output Formats**: 
    - **SVG**: Clean vector patterns with optional labels and borders.
    - **PNG/JPG**: High-quality raster previews.
    - **Palette JSON**: Detailed color metadata for physical paint matching.
- **🌍 Multi-Platform**: Integration with Web and Node.js applications via Wasm.

---

## 📦 Installation

### 1. NPM Package (CLI & SDK)
Use the **universal CLI** for high-performance processing, or the SDK for deep integration:

```bash
# Install globally to use the 'fast-pbn' command
npm install -g fast-paint-by-numbers

# Or add as a dependency
npm install fast-paint-by-numbers
```

### 2. Native Rust Executable
Prebuilt native executables can also be downloaded directly from GitHub Releases:

https://github.com/ianho7/fast-paint-by-numbers/releases/

---

## 🚀 Quick Start (CLI)

Transform any image into a paint-by-numbers pattern using the universal CLI:

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

### Native Rust CLI
If you prefer the standalone Rust executable instead of the npm CLI:

```bash
# Build the native executable
cargo build --release -p pbn-cli

# Run the native executable
./target/release/pbn-cli \
  --input photo.jpg \
  --output ./output_dir \
  --kmeans-clusters 24 \
  --remove-facets-smaller-than 20 \
  --border-smoothing-passes 2 \
  --format svg,palette.json,quantized.png,png \
  --verbose
```

On Windows, the executable path is `.\target\release\pbn-cli.exe`.

### Common Options:
- `-i, --input <path>`: Path to the input image (JPG, PNG, WebP).
- `-o, --output <path>`: Output directory or base filename.
- `-c, --config <path>`: JSON configuration file for advanced fine-tuning.
- `-k, --kmeans-clusters <num>`: Number of colors to quantize (default: 16).
- `--remove-facets-smaller-than <px>`: Filter out small noise regions (default: 20).
- `--border-smoothing-passes <num>`: Smoothness of vector paths (default: 2).
- `--format <list>`: Output formats (svg, palette.json, quantized.png, png, jpg). Default: `svg,palette.json,quantized.png,png`.
- `--resize`: Enable input downscaling before processing using the default `1024x1024` limits.
- `--no-resize`: Disable input downscaling before processing.
- `--resize-max-width <num>`: Maximum input width before downscaling (default: 1024).
- `--resize-max-height <num>`: Maximum input height before downscaling (default: 1024).
- `--log-level <level>`: Logging verbosity (info, debug, warn, error).

> [!NOTE]
> Resize is disabled by default. Passing `--resize` or either `--resize-max-width` / `--resize-max-height` enables it. When enabled, it is applied before processing, and the resized dimensions become the actual processing and output dimensions.

---

## 🛠 SDK Usage

### Web (Browser)
For optimal performance and to keep the UI responsive, it is highly recommended to run the engine in a **Web Worker**.

**1. Create your worker file (`worker.ts`):**
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

**2. Call from your Main Thread:**
```typescript
async function processImage(file: File) {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.postMessage({ file });
  worker.onmessage = (e) => console.log('Result:', e.data);
}
```

> [!TIP]
> **Why a separate file?** Web Workers must be initialized from a physical file path. The code above assumes you have a `worker.ts` in your source directory which imports the SDK.

### Node.js (Backend)
In a typical backend scenario (e.g., Express or serverless functions), you can process uploaded images directly using `sharp` to decode pixels.

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

---

## ⚡ Performance

Benchmarks conducted using the following parameters(No resizing):
`--kmeans-clusters 16 --remove-facets-smaller-than 20 --border-smoothing-passes 2`

| Image Size | Resolution | Rust CLI (exe) | NPM CLI (Wasm) | Vanilla JS solution<br />https://github.com/drake7707/paintbynumbersgenerator | Python solution<br />https://github.com/CoderHam/PaintingByNumbersIFY<br />Running on CPU |
| :--- | :--- | :--- | :--- | ---- | ---- |
| **Small** | 640x426 (0.27 MP) | 0.87s | 1.47s | 9.513s | 3.37s |
| **Medium** | 1280x853 (1.09 MP) | 9.36s | 7.73s | 360.122s | 10.37s |
| **Large** | 1920x1280 (2.46 MP) | 20.64s | 18.08s | RangeError Maximum call stack size exceeded | 21.97s |

---

## 🏗 Building from Source

### Building the SDK (Wasm + TS)
Requires [Bun](https://bun.sh/) and the Rust toolchain:

```bash
bun install
bun run build
```

---

## 📦 Packaging & Distribution

### 1. NPM Package (.tgz)
To generate the redistributable NPM package:
```bash
# 1. Build Wasm and TS
bun run build

# 2. Packing
cd packages/sdk
npm pack
```

### 2. Native Executable (.exe)
To generate a high-performance standalone binary:
```bash
# Optimized Release Build
cargo build --release -p pbn-cli

# Found at: ./target/release/pbn-cli (or pbn-cli.exe)
```

---

## 🔬 Development

```bash
# Check Rust core
cargo check

# Run tests
cargo test

# Run local web demo
bun run serve:web
```

---

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for more information.
