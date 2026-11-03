import {readdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=new URL('../',import.meta.url).pathname;
async function files(dir){const entries=await readdir(dir,{withFileTypes:true});return (await Promise.all(entries.filter(e=>e.name!=='vendor'&&e.name!=='.git').map(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]))).flat();}
const all=await files(root),modules=all.filter(f=>/\.(m?js)$/.test(f));
for(const file of modules){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0){process.stderr.write(r.stderr);process.exit(1);}}
for(const name of ['index.html','demo.html']){const html=await readFile(path.join(root,name),'utf8'),assets=[...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(match=>match[1]);
  for(const match of html.matchAll(/<script\b[^>]*type="importmap"[^>]*>([\s\S]*?)<\/script>/g))assets.push(...Object.values(JSON.parse(match[1]).imports||{}));
  for(const asset of assets)if(!/^(?:https?:|data:)/.test(asset))await readFile(path.join(root,asset.split(/[?#]/)[0]));
}
console.log(`Checked ${modules.length} JavaScript files and HTML asset references.`);

