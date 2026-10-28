import { chromium } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'C:/Users/Erick/.cache/hyperframes/chrome/chrome-headless-shell/win64-152.0.7977.30/chrome-headless-shell-win64/chrome-headless-shell.exe',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
await page.goto('http://localhost:3000/demo');
await page.locator('[data-ready="true"]').waitFor();await page.evaluate(()=>document.fonts.ready);
const exe='C:/Users/Erick/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe';
const ff=spawn(exe,['-y','-f','image2pipe','-framerate','24','-vcodec','mjpeg','-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','assets/app-real.mp4'],{stdio:['pipe','ignore','pipe']});
let errors='';ff.stderr.on('data',d=>errors+=d);let pos={x:720,y:750},target={...pos},lastClick=-99;let log=[];
async function go(name){const el=page.getByRole('button',{name,exact:true}).first();const b=await el.boundingBox();target={x:b.x+b.width*.55,y:b.y+b.height*.5};}
async function click(name,t){await page.getByRole('button',{name,exact:true}).first().click();lastClick=t;log.push({time:t,action:name});}
for(let f=0;f<720;f++){
 const t=f/24;
 if(f===48)await go('Quanto diesel ainda temos?');
 if(f===96)await click('Quanto diesel ainda temos?',t);
 if(f===168)await go('Simular retirada');
 if(f===216)await click('Simular retirada',t);
 if(f===240){const b=await page.getByRole('spinbutton').boundingBox();target={x:b.x+80,y:b.y+22};}
 if(f===264)await page.getByRole('spinbutton').fill('');
 if(f===276)await page.getByRole('spinbutton').fill('1');
 if(f===282)await page.getByRole('spinbutton').fill('15');
 if(f===288)await page.getByRole('spinbutton').fill('150');
 if(f===300)await go('Revisar retirada');
 if(f===336)await click('Revisar retirada',t);
 if(f===384)await go('Confirmar simulação');
 if(f===432)await click('Confirmar simulação',t);
 if(f===480)target={x:1070,y:470};
 if(f===552)target={x:1050,y:690};
 pos.x+=(target.x-pos.x)*.12;pos.y+=(target.y-pos.y)*.12;
 await page.evaluate(({pos,pulse})=>{let cur=document.getElementById('film-cursor');if(!cur){cur=document.createElement('div');cur.id='film-cursor';cur.style.cssText='position:fixed;width:38px;height:48px;pointer-events:none;z-index:2147483647';cur.innerHTML='<svg viewBox="0 0 40 52"><path d="M4 3L4 37L13 29L21 46L28 43L20 27L34 27Z" fill="white" stroke="#183d2d" stroke-width="2.5"/></svg>';};(document.querySelector('dialog[open]')||document.body).appendChild(cur);cur.style.left=pos.x+'px';cur.style.top=pos.y+'px';cur.style.transform='scale('+(pulse>0?.85:1)+')';}, {pos,pulse:t-lastClick<.17?1:0});
 const buf=await page.screenshot({type:'jpeg',quality:91});if(!ff.stdin.write(buf))await once(ff.stdin,'drain');
 if(f%120===0)console.log('Recorded '+t+'s');
}
ff.stdin.end();const [code]=await once(ff,'close');await browser.close();await writeFile('assets/capture-actions.json',JSON.stringify(log,null,2));if(code)throw Error(errors);console.log('Recorded 30 seconds of real app interaction.');

