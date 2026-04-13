import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

// 路径配置
const PROJECT_ROOT = '..';
const RUST_EXE = path.join(PROJECT_ROOT, 'target', 'release', 'pbn-cli.exe');
const NPM_CLI = path.join(PROJECT_ROOT, 'packages', 'sdk', 'bin', 'fast-pbn.js');
const OUTPUT_DIR = './output';

// 测试图片
const files = [
    'art002e000192~small.jpg',
    'art002e000192~medium.jpg',
    'art002e000192~large.jpg'
];

async function runBench() {
    console.log('开始测试本项目 (Fast Paint By Numbers)...');

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR);
    }

    console.log('| 图片尺寸 | Rust EXE (原生) | Wasm CLI (NPM) |');
    console.log('| :--- | :--- | :--- |');

    for (const f of files) {
        const filePath = path.join('.', f); // 图片就在当前 benchmarks 目录下

        // 1. Rust EXE 测试
        const startRust = performance.now();
        try {
            execSync(`"${RUST_EXE}" -i "${filePath}" -o "${OUTPUT_DIR}" -k 16 --remove-facets-smaller-than 20 --border-smoothing-passes 2 --quiet`, { stdio: 'ignore' });
        } catch (e) {
            console.error(`Rust EXE 处理 ${f} 失败`);
        }
        const endRust = performance.now();
        const rustTime = ((endRust - startRust) / 1000).toFixed(3);

        // 2. Wasm CLI 测试
        const startWasm = performance.now();
        try {
            execSync(`node "${NPM_CLI}" -i "${filePath}" -o "${OUTPUT_DIR}" -k 16 --remove-facets-smaller-than 20 --border-smoothing-passes 2 --quiet`, { stdio: 'ignore' });
        } catch (e) {
            console.error(`Wasm CLI 处理 ${f} 失败`);
        }
        const endWasm = performance.now();
        const wasmTime = ((endWasm - startWasm) / 1000).toFixed(3);

        console.log(`| ${f} | ${rustTime}s | ${wasmTime}s |`);
    }

    console.log('\n测试完成！');
}

runBench().catch(console.error);
