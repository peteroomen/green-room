import {mkdir,copyFile,writeFile} from 'node:fs/promises';
await mkdir('public/engine',{recursive:true});
for(const ext of ['js','wasm']) await copyFile(`node_modules/stockfish/bin/stockfish-19-lite-single.${ext}`,`public/engine/stockfish.${ext}`);
// The engine infers its wasm filename from the worker URL.
await copyFile('node_modules/stockfish/bin/stockfish-19-lite-single.wasm','public/engine/stockfish-19-lite-single.wasm');
await writeFile('public/engine/version.json',JSON.stringify({version:'19.0.0',variant:'lite-single'}));
