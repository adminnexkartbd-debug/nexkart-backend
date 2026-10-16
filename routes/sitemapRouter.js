'use strict';
const express=require('express');
const db=require('../db');
const router=express.Router();
const BASE='https://www.nexkartbd.com';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
router.get('/sitemap.xml',async(req,res)=>{
 try{
  const [products]=await db.query('SELECT id,product_id,slug,updated_at FROM products ORDER BY id');
  const [categories]=await db.query("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != ''");
  const [promos]=await db.query("SELECT DISTINCT promo_badge FROM products WHERE promo_badge IS NOT NULL AND promo_badge != '' AND promo_badge != 'none'");
  const entries=new Map();
  function add(route,date){const entry={loc:BASE+route};if(date){const d=new Date(date);if(Number.isFinite(d.getTime()))entry.lastmod=d.toISOString();}entries.set(entry.loc,entry);}
  ['/','/user/userAbout','/user/return-policy'].forEach(x=>add(x));
  categories.forEach(x=>add('/user/category.html?type='+encodeURIComponent(x.category)));
  promos.forEach(x=>add('/user/category.html?promo='+encodeURIComponent(x.promo_badge)));
  products.forEach(p=>add(p.slug?'/user/product/'+encodeURIComponent(p.slug):'/user/product-details?id='+encodeURIComponent(p.product_id||p.id),p.updated_at));
  const urls=[...entries.values()];
  // Standard sitemap limits: shard large catalogues rather than truncate them.
  const size=10000,chunks=Math.ceil(urls.length/size);
  const requested=req.query.page===undefined?null:Number(req.query.page);
  if(chunks>1&&requested===null){const index='<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+Array.from({length:chunks},(_,i)=>'<sitemap><loc>'+esc(BASE+'/sitemap.xml?page='+(i+1))+'</loc></sitemap>').join('')+'</sitemapindex>';return res.type('application/xml').send(index);}
  if(requested!==null&&(!Number.isInteger(requested)||requested<1||requested>chunks))return res.status(404).send('Sitemap page not found');
  const selected=requested===null?urls:urls.slice((requested-1)*size,requested*size);
  const xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+selected.map(x=>'<url><loc>'+esc(x.loc)+'</loc>'+(x.lastmod?'<lastmod>'+x.lastmod+'</lastmod>':'')+'</url>').join('\n')+'\n</urlset>';
  res.set('Cache-Control','public, max-age=300');return res.type('application/xml').send(xml);
 }catch(error){console.error('Sitemap generation:',error.code||error.message);return res.status(503).send('Sitemap temporarily unavailable');}
});
module.exports=router;
