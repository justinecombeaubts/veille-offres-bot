import { applyJobPosting } from './src/sources.js';
const ids = ['85186653','78437773','79044890','79532787','84839827','85123321','84793741','84831625','84116971','85496957','75292761'];
for (const id of ids) {
  const url = `https://www.hellowork.com/fr-fr/emplois/${id}.html`;
  const html = await (await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' } })).text();
  const o = { link: url, title: '', company: null, location: null, skills: [], description: '' };
  const ok = applyJobPosting(o, html);
  console.log('FULL ' + JSON.stringify({ id, ok, t: o.title, c: o.company, desc: o.description.slice(0, 2600) }));
  await new Promise((r) => setTimeout(r, 800));
}
