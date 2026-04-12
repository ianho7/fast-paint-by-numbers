import { Command } from "commander";
import path from "node:path";
import fs from "fs-extra";
import chalk from "chalk";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { 
  initializeWasmRuntime, 
  generatePaintByNumbers, 
  prepareRgbaInput,
  createConsoleLogger
} from "./index.js";
import type { GenerateOptions } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const program = new Command();

  program
    .name("fast-pbn")
    .description("High-performance Paint-By-Numbers generator (Node.js/Wasm version)")
    .version("0.1.0")
    .requiredOption("-i, --input <path>", "Input image path")
    .requiredOption("-o, --output <path>", "Output directory or base path")
    .option("-c, --config <path>", "JSON configuration file path")
    .option("-k, --kmeans-clusters <number>", "Number of colors to quantize (default: 16)", "16")
    .option("--remove-facets-smaller-than <number>", "Minimum facet size in pixels (default: 20)", "20")
    .option("--border-smoothing-passes <number>", "Number of smoothing passes (default: 2)", "2")
    .option("--format <string>", "Output formats (comma separated: svg, palette.json, quantized.png)", "svg,palette.json,quantized.png")
    .option("--log-level <level>", "Logging level (info, debug, warn, error)", "info")
    .option("--quiet", "Suppress non-error output")
    .option("--verbose", "Enable debug logging")
    .parse(process.argv);

  const options = program.opts();
  const logLevel = options.verbose ? "debug" : (options.quiet ? "error" : options.logLevel);
  const logger = createConsoleLogger(logLevel);

  try {
    // 1. Initialize Wasm
    const wasmPath = path.resolve(__dirname, "../generated/pbn_core_bg.wasm");
    await initializeWasmRuntime({ source: pathToFileURL(wasmPath) }, logger);

    // 2. Load Config if any
    let config: Partial<GenerateOptions> = {};
    if (options.config) {
      if (await fs.pathExists(options.config)) {
        config = await fs.readJson(options.config);
        logger.info(`Loaded config from ${options.config}`);
      } else {
        logger.warn(`Config file not found: ${options.config}, using defaults`);
      }
    }

    // 3. Read Image
    logger.info(`Reading input image: ${options.input}`);
    const image = sharp(options.input);
    const { data: rgba, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    logger.info(`Image decoded: ${info.width}x${info.height}`);

    // 4. Generate
    const input = prepareRgbaInput(info.width, info.height, rgba);
    const result = await generatePaintByNumbers(input, {
      ...config,
      kmeansClusters: parseInt(options.kmeansClusters),
      removeFacetsSmallerThan: parseInt(options.removeFacetsSmallerThan),
      borderSmoothingPasses: parseInt(options.borderSmoothingPasses),
      logLevel
    });

    // 5. Save Outputs
    const outBase = options.output;
    await fs.ensureDir(path.isAbsolute(outBase) ? path.dirname(outBase) : path.dirname(path.resolve(process.cwd(), outBase)));
    
    // Determine stem and dir
    let outDir = outBase;
    let outStem = "result";
    
    if (!(await fs.pathExists(outBase)) || (await fs.stat(outBase)).isDirectory()) {
       await fs.ensureDir(outBase);
    } else {
       outDir = path.dirname(outBase);
       outStem = path.basename(outBase, path.extname(outBase));
    }

    const formats = options.format.split(",").map((f: string) => f.trim().toLowerCase());

    for (const format of formats) {
      if (format === "svg") {
        const outPath = path.join(outDir, `${outStem}.svg`);
        await fs.writeFile(outPath, result.svg);
        logger.info(`${chalk.green("✔")} Saved SVG: ${outPath}`);
      } else if (format === "palette.json") {
        const outPath = path.join(outDir, `${outStem}.palette.json`);
        await fs.writeJson(outPath, result.palette, { spaces: 2 });
        logger.info(`${chalk.green("✔")} Saved Palette: ${outPath}`);
      } else if (format === "quantized.png" || format === "png" || format === "jpg" || format === "jpeg") {
        // For quantized.png, we might want to use the output from Wasm if it had it, 
        // but currently our Wasm only returns SVG and metadata.
        // So we render the SVG using sharp.
        const outPath = path.join(outDir, `${outStem}.${format === "quantized.png" ? "quantized.png" : format}`);
        
        // Render SVG to Buffer
        const rendered = await sharp(Buffer.from(result.svg))
          .png() // default to png if quantized.png
          .toBuffer();
        
        await fs.writeFile(outPath, rendered);
        logger.info(`${chalk.green("✔")} Saved raster: ${outPath}`);
      }
    }

    logger.info(chalk.bold.blue("\n✨ Process completed successfully!"));

  } catch (err: any) {
    logger.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
