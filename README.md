# Fast Paint By Numbers 🎨

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

### Common Options:
- `-i, --input <path>`: Path to the input image (JPG, PNG, WebP).
- `-o, --output <path>`: Output directory or base filename.
- `-c, --config <path>`: JSON configuration file for advanced fine-tuning.
- `-k, --kmeans-clusters <num>`: Number of colors to quantize (default: 16).
- `--remove-facets-smaller-than <px>`: Filter out small noise regions (default: 20).
- `--border-smoothing-passes <num>`: Smoothness of vector paths (default: 2).
- `--format <list>`: Output formats (svg, palette.json, quantized.png, png, jpg).
- `--log-level <level>`: Logging verbosity (info, debug, warn, error).

---

## 🛠 SDK Usage

### Web (Browser)
```typescript
import { initializeWasmRuntime, generatePaintByNumbers, prepareRgbaFromImageSource } from 'fast-paint-by-numbers';

async function processImage(file: File) {
  // Use a Web Worker for heavy processing (recommended)
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.postMessage({ type: 'generate', file });
  worker.onmessage = (e) => console.log('Result:', e.data);
}
```

> [!TIP]
> **Avoid Blocking**: For Web apps, it's highly recommended to run the generator in a **Web Worker**. See [packages/web-demo/src/worker.ts](./packages/web-demo/src/worker.ts) for a production-ready implementation.

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

---

*For detailed migration history and technical status, see [docs/MIGRATION-LOG.md](./docs/MIGRATION-LOG.md).*
