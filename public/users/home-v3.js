(function(){
'use strict';
var copy={
 en:{hero_eyebrow:'YOUR EVERYDAY DISCOVERIES',hero_title:'Find your next',hero_favourite:'favourite.',hero_subtitle:'Beauty, gadgets and everyday essentials.',explore_products:'Explore Products',beauty_care:'Beauty & Care',beauty_subtitle:'Skincare, haircare and more',shop_collection:'Shop Collection',smart_tech:'Smart everyday tech',tech_subtitle:'Audio, accessories and gadgets',electronics_short:'Electronics',fragrance:'Fragrance',fashion_short:'Fashion',home_living:'Home & Living',collection_eyebrow:'CHOSEN FOR YOUR EVERYDAY',featured_products:'Explore our collection',filter_all:'All',load_more:'View More Products',shipping_available:'International shipping available',shipping_subtitle:'Discover products from global sources',secure_payments:'Secure payments',secure_subtitle:'Shop with confidence',customer_support:'Customer support',support_subtitle:'We’re here to help you',daily_care:'Your daily care routine.',daily_care_subtitle:'Skincare, haircare and everyday essentials.',shop_beauty:'Shop Beauty & Care',small_gadgets:'Small gadgets. Big convenience.',small_gadgets_subtitle:'Audio, power accessories and more for everyday life.',shop_electronics:'Shop Electronics',love_list:'Wishlist'},
 bn:{hero_eyebrow:'প্রতিদিন নতুন কিছু খুঁজে নিন',hero_title:'আপনার পরের',hero_favourite:'পছন্দ খুঁজুন।',hero_subtitle:'বিউটি, গ্যাজেট ও প্রতিদিনের প্রয়োজনীয় পণ্য।',explore_products:'পণ্য দেখুন',beauty_care:'বিউটি ও কেয়ার',beauty_subtitle:'স্কিনকেয়ার, হেয়ারকেয়ার ও আরও অনেক কিছু',shop_collection:'কালেকশন দেখুন',smart_tech:'প্রতিদিনের স্মার্ট টেক',tech_subtitle:'অডিও, অ্যাকসেসরিজ ও গ্যাজেট',electronics_short:'ইলেকট্রনিক্স',fragrance:'পারফিউম',fashion_short:'ফ্যাশন',home_living:'হোম ও লিভিং',collection_eyebrow:'আপনার প্রতিদিনের জন্য বাছাই করা',featured_products:'আমাদের কালেকশন দেখুন',filter_all:'সব',load_more:'আরও পণ্য দেখুন',shipping_available:'আন্তর্জাতিক শিপিং সুবিধা',shipping_subtitle:'বিশ্বের বিভিন্ন উৎস থেকে পণ্য',secure_payments:'নিরাপদ পেমেন্ট',secure_subtitle:'নিশ্চিন্তে কেনাকাটা করুন',customer_support:'কাস্টমার সাপোর্ট',support_subtitle:'আপনার প্রয়োজনে পাশে আছি',daily_care:'প্রতিদিনের যত্নে আপনার পছন্দ।',daily_care_subtitle:'স্কিনকেয়ার, হেয়ারকেয়ার ও প্রয়োজনীয় পণ্য।',shop_beauty:'বিউটি পণ্য দেখুন',small_gadgets:'ছোট গ্যাজেট। বাড়তি সুবিধা।',small_gadgets_subtitle:'অডিও, পাওয়ার অ্যাকসেসরিজ ও আরও অনেক কিছু।',shop_electronics:'ইলেকট্রনিক্স দেখুন',love_list:'উইশলিস্ট'}
};
// Extend the existing language dictionary without replacing existing strings.
if(typeof translations!=='undefined') Object.keys(copy).forEach(function(lang){Object.assign(translations[lang],copy[lang]);});
window.nkHomeFilter='all';
function initCollectionRotation(){
 var group=document.querySelector('.nk-hero-collections'),tiles=document.querySelector('.nk-category-tiles');if(!group||!tiles)return;
 var categories=[{query:'type=health'},{query:'type=electronics'},{query:'search=perfume'},{query:'type=fashion'},{query:'type=home'}];
 var bindings=[],busy=false,paused=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 Array.from(group.querySelectorAll('.nk-collection-tile')).forEach(function(card,i){bindings.push({card:card,category:i,index:0,hero:true});});
 Array.from(tiles.querySelectorAll('a')).slice(0,5).forEach(function(card,i){bindings.push({card:card,category:i,index:0,hero:false});});
 var pools=[];
 var control=document.createElement('button');control.type='button';control.className='nk-collection-pause';group.appendChild(control);
 function label(){var bn=document.getElementById('langChange').value==='bn';control.textContent=paused?(bn?'চালু করুন':'Play'):(bn?'বিরতি':'Pause');control.setAttribute('aria-label',paused?'Start collection rotation':'Pause collection rotation');control.setAttribute('aria-pressed',String(paused));}
 control.addEventListener('click',function(){paused=!paused;label();});document.getElementById('langChange').addEventListener('change',label);label();
 function imageUrl(product){
  var raw=String(product.primary_image||'').trim().replace(/^(\/?uploads\/)+/,'');if(!raw)return null;
  try{var url=new URL(/^https?:\/\//i.test(raw)?raw:raw.includes('cloudinary.com')?'https://'+raw:'/uploads/'+raw,location.origin);return /^https?:$/.test(url.protocol)?url.href:null;}catch(e){return null;}
 }
 function preload(src){return new Promise(function(resolve){var img=new Image(),done=false;var timer=setTimeout(function(){finish(false);},6000);function finish(ok){if(done)return;done=true;clearTimeout(timer);resolve(ok);}img.onload=function(){finish(true);};img.onerror=function(){finish(false);};img.src=src;});}
 async function show(binding){
  var pool=pools[binding.category];if(!pool||!pool.length)return;
  for(var attempt=0;attempt<Math.min(pool.length,3);attempt++){
   var product=pool[binding.index++%pool.length],src=imageUrl(product);if(!src||!await preload(src))continue;
   var card=binding.card,img=card.querySelector('img');img.src=src;img.alt=product.title||'';
   if(binding.hero){var description=card.querySelector('p');description.removeAttribute('data-i18n');description.textContent=product.title||'';card.classList.add('nk-live-collection');}
   else card.classList.add('nk-live-category');
   // Each card keeps its original category title and destination.
   return;
  }
 }
 async function rotate(){if(busy)return;busy=true;try{await Promise.all(bindings.filter(function(binding){return !binding.card.matches(':hover')&&!binding.card.contains(document.activeElement);}).map(show));}finally{busy=false;}}
 var seed=Date.now().toString(36);
 Promise.all(categories.map(async function(category){
  try{var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},10000),response;
   try{response=await fetch('/user/get-products-by-category?page=1&limit=12&seed='+seed+'&'+category.query,{signal:controller.signal});}finally{clearTimeout(timer);}
   if(!response.ok)return [];var data=await response.json();if(!data.success||!Array.isArray(data.products))return [];
   return data.products.filter(function(product){return imageUrl(product);});
  }catch(e){return [];}
 })).then(function(results){pools=results;if(!pools.some(function(pool){return pool.length;})){control.hidden=true;return;}rotate();});
 setInterval(function(){if(!paused&&!document.hidden)rotate();},10000);
}

function init(){
 initCollectionRotation();
 var lang=document.getElementById('langChange');if(typeof applyLanguage==='function')applyLanguage(lang.value||'en');
 document.querySelectorAll('[data-home-filter]').forEach(function(button){button.addEventListener('click',function(){
  if(window.nkHomeFilter===button.dataset.homeFilter)return;
  window.nkHomeFilter=button.dataset.homeFilter;
  document.querySelectorAll('[data-home-filter]').forEach(function(other){var active=other===button;other.classList.toggle('is-active',active);other.setAttribute('aria-pressed',String(active));});
  currentDashPage=1;loadDashboardProducts(1,false);
 });});
 function disclosure(buttonSelector,panelSelector){var button=document.querySelector(buttonSelector),panel=document.querySelector(panelSelector);if(!button||!panel)return;
  button.addEventListener('click',function(){var open=panel.classList.toggle('is-open');button.setAttribute('aria-expanded',String(open));});
  document.addEventListener('click',function(e){if(!panel.contains(e.target)){panel.classList.remove('is-open');button.setAttribute('aria-expanded','false');}});
  panel.addEventListener('keydown',function(e){if(e.key==='Escape'){panel.classList.remove('is-open');button.setAttribute('aria-expanded','false');button.focus();}});
 }
 disclosure('.all-categories-btn','.all-categories-container');disclosure('.user-greeting','.user-profile-container');
 // Keep the existing chat click handlers, moving its launcher into the header.
 var launcher=document.getElementById('nk-chat-launcher');var actions=document.querySelector('.header-actions');
 if(launcher&&actions){launcher.classList.add('nk-header-chat');launcher.setAttribute('title','Product search help');actions.appendChild(launcher);}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
