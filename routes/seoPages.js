'use strict';
const fs=require('fs/promises');
const path=require('path');
const BASE='https://www.nexkartbd.com';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain=s=>String(s||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const json=s=>JSON.stringify(s).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
function imageUrl(value){if(!value)return '';let s=String(value).trim().replace(/^(\/?uploads\/)+/,'');if(s.includes('cloudinary.com')&&!/^https?:\/\//i.test(s))s='https://'+s;if(!/^https?:\/\//i.test(s))s='/uploads/'+s;try{const u=new URL(s,BASE);return u.protocol==='https:'?u.href:'';}catch{return '';}}
function element(html,id,value){return html.replace(new RegExp('(<([a-z0-9]+)\\b[^>]*\\bid="'+id+'"[^>]*>)[\\s\\S]*?(<\\/\\2>)','i'),(_,open,tag,close)=>open+escape(value)+close);}
function attr(html,id,name,value){return html.replace(new RegExp('<[a-z]+\\b[^>]*\\bid="'+id+'"[^>]*>','i'),tag=>{const rx=new RegExp('\\s'+name+'="[^"]*"','i');return rx.test(tag)?tag.replace(rx,()=> ' '+name+'="'+escape(value)+'"'):tag.replace(/>$/,()=> ' '+name+'="'+escape(value)+'">');});}
function productHtml(template,p){
 const title=plain(p.title)||'Product',description=plain(p.description).slice(0,160)||title+' — price and details at NexKartBD.';
 const canonical=BASE+(p.slug?'/user/product/'+encodeURIComponent(p.slug):'/user/product-details?id='+encodeURIComponent(p.product_id||p.id));
 const amount=Number(p.sale_price)>0?Number(p.sale_price):(p.regular_price!=null&&p.regular_price!==''?Number(p.regular_price):NaN),image=imageUrl(p.primary_image),stock=Number(p.stock_quantity)>0;
 let html=template.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i,()=>'<title id="seo-title">'+escape(title+' - NexKartBD')+'</title>');
 for(const id of ['seo-description','og-description','tw-description'])html=attr(html,id,'content',description);
 for(const id of ['og-title','tw-title'])html=attr(html,id,'content',title+' - NexKartBD');
 html=attr(html,'seo-canonical','href',canonical);html=attr(html,'og-url','content',canonical);
 for(const id of ['og-image','tw-image'])html=attr(html,id,'content',image);
 const schema={'@context':'https://schema.org','@type':'Product',name:title,description,sku:String(p.sku||p.product_id||p.id),url:canonical};
 if(image)schema.image=[image];if(p.brand_name&&p.brand_name!=='N/A')schema.brand={'@type':'Brand',name:plain(p.brand_name)};
 if(Number.isFinite(amount)&&amount>=0)schema.offers={'@type':'Offer',url:canonical,priceCurrency:'BDT',price:amount,availability:'https://schema.org/'+(stock?'InStock':'OutOfStock'),itemCondition:'https://schema.org/NewCondition'};
 // Do not invent review counts or ratings; emit only when real values are present.
 if(Number(p.avg_rating)>0&&Number(p.avg_rating)<=5&&Number(p.review_count)>0)schema.aggregateRating={'@type':'AggregateRating',ratingValue:Number(p.avg_rating),reviewCount:Number(p.review_count)};
 html=html.replace(/<script\b[^>]*id="product-json-ld"[^>]*>[\s\S]*?<\/script>/i,()=>'<script id="product-json-ld" type="application/ld+json">'+json(schema)+'</script>');
 html=element(html,'product-title',title);html=element(html,'product-description',plain(p.description));html=element(html,'product-category',p.category||'General');html=element(html,'product-sku',p.sku||p.product_id||p.id);html=element(html,'product-sale-price',Number.isFinite(amount)?'৳ '+amount:'');html=element(html,'stock-status-badge',stock?'In Stock':'Out of stock');
 html=attr(html,'main-product-image','src',image);html=attr(html,'main-product-image','alt',title);html=attr(html,'main-product-image','loading','eager');
 return html;
}
function categoryInfo(query){
 const cat=String(query.cat||'').slice(0,100),type=String(query.type||'').slice(0,100),promo=String(query.promo||'').slice(0,100),search=String(query.search||'').slice(0,150);
 const key=cat?'cat':type?'type':promo?'promo':'',value=cat||type||promo;
 const label=search?'Search results for '+search:value&&value!=='all'?value.replace(/_/g,' ')+' Products':'All Products';
 return {title:label+' | NexKartBD Online Shopping',description:'Browse '+label+' at NexKartBD. View product prices, availability and delivery details.',label,canonical:BASE+'/user/category.html'+(key?'?'+key+'='+encodeURIComponent(value):''),noindex:Boolean(search)};
}
function categoryHtml(template,query){const c=categoryInfo(query);let html=element(template,'seoTitle',c.title);for(const id of ['seoDescription','ogDescription'])html=attr(html,id,'content',c.description);html=attr(html,'ogTitle','content',c.title);html=attr(html,'seoCanonical','href',c.canonical);html=attr(html,'ogUrl','content',c.canonical);html=attr(html,'seoRobots','content',c.noindex?'noindex, follow':'index, follow');html=element(html,'categoryNameHeading',c.label);html=html.replace(/<script\b[^>]*id="categorySchema"[^>]*>[\s\S]*?<\/script>/i,()=>'<script id="categorySchema" type="application/ld+json">'+json({'@context':'https://schema.org','@type':'CollectionPage',name:c.title,url:c.canonical,description:c.description})+'</script>');return html;}
function createSeoMiddleware({db,root=process.cwd()}){
 return async(req,res,next)=>{
 if(!['GET','HEAD'].includes(req.method))return next();
 const url=new URL(req.originalUrl||req.url,BASE),pathname=url.pathname,query=Object.fromEntries(url.searchParams);
 const privateName=pathname.replace(/^\/(?:user|users)\//,'').replace(/\.html$/,'').toLowerCase();
 if(pathname.startsWith('/admin/')||pathname.startsWith('/api/')||pathname.startsWith('/user/api/')||['cslogin','cssignup','checkout','cart-html','cart-checkout-content','my-order','my_coin','my-coin','my-coupons','profile','settings','message-center','customer-inbox','return-refund-requests','reset-password','thank-you','love-list','wishlist','erify-otp'].includes(privateName)||/^checkout\//.test(privateName))res.set('X-Robots-Tag','noindex, follow');
 const slugMatch=pathname.match(/^\/user\/product\/([^/]+)\/?$/),legacy=['/user/product-details','/user/product-details.html','/users/product-details.html'].includes(pathname);
 try{
 if(slugMatch||legacy){
  let reference;try{reference=slugMatch?decodeURIComponent(slugMatch[1]):String(query.id||'');}catch{return res.status(404).type('html').send('<!doctype html><title>Product not found | NexKartBD</title><meta name="robots" content="noindex"><h1>Product not found</h1><a href="/">Continue shopping</a>');}
  if(!reference||reference.length>250){res.set('X-Robots-Tag','noindex');return res.status(404).send('Product not found');}
  const [rows]=await db.query("SELECT p.*, (SELECT image_path FROM product_images WHERE product_id=p.id ORDER BY id LIMIT 1) AS primary_image FROM products p WHERE "+(slugMatch?'p.slug=?':'(p.product_id=? OR CAST(p.id AS CHAR)=?)')+' LIMIT 1',slugMatch?[reference]:[reference,reference]);
  if(!rows.length){res.set('X-Robots-Tag','noindex');return res.status(404).type('html').send('<!doctype html><html><head><title>Product not found | NexKartBD</title><meta name="robots" content="noindex"></head><body><h1>Product not found</h1><a href="/">Continue shopping</a></body></html>');}
  const p=rows[0];if(legacy&&p.slug){const suffix=new URLSearchParams();for(const k of ['qty','variant'])if(query[k])suffix.set(k,query[k]);return res.redirect(301,'/user/product/'+encodeURIComponent(p.slug)+(suffix.size?'?'+suffix:'') );}
  if(slugMatch&&pathname!=='/user/product/'+encodeURIComponent(p.slug))return res.redirect(301,'/user/product/'+encodeURIComponent(p.slug)+url.search);
  const template=await fs.readFile(path.join(root,'public','users','product-details.html'),'utf8');res.set('Cache-Control','no-store');return res.type('html').send(productHtml(template,p));
 }
 if(['/user/return-policy','/user/return-policy.html','/users/return-policy.html'].includes(pathname)){
  if(pathname!=='/user/return-policy')return res.redirect(301,'/user/return-policy');
  let html=await fs.readFile(path.join(root,'public','users','return-policy.html'),'utf8');
  html=html.replace('</head>','<link rel="canonical" href="'+BASE+'/user/return-policy"><meta name="description" content="Read the NexKartBD return and refund policy, eligibility requirements and process."></head>');
  return res.type('html').send(html);
 }
 if(['/user/userAbout','/user/userAbout.html','/users/userAbout.html'].includes(pathname)){
  if(pathname!=='/user/userAbout')return res.redirect(301,'/user/userAbout');
  let html=await fs.readFile(path.join(root,'public','users','userAbout.html'),'utf8');
  html=html.replace(/<link[^>]*rel="canonical"[^>]*>/i,'<link rel="canonical" href="'+BASE+'/user/userAbout">');
  return res.type('html').send(html);
 }
 if(['/user/category','/user/category.html','/users/category.html'].includes(pathname)){
  if(query.category&&!query.type&&!query.cat){url.searchParams.set('type',query.category);url.searchParams.delete('category');return res.redirect(301,'/user/category.html'+url.search);}
  if(pathname!=='/user/category.html')return res.redirect(301,'/user/category.html'+url.search);
  const template=await fs.readFile(path.join(root,'public','users','category.html'),'utf8');if(query.search)res.set('X-Robots-Tag','noindex, follow');return res.type('html').send(categoryHtml(template,query));
 }
 return next();
 }catch(error){console.error('SEO page:',error.code||error.message);res.set('X-Robots-Tag','noindex');return res.status(503).send('Page temporarily unavailable. Please try again later.');}
 };
}
module.exports={createSeoMiddleware,productHtml,categoryHtml,categoryInfo,imageUrl};
