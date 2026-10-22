(function(){
'use strict';
var DURATION=30000,cleanup=null;
function el(tag,className,text){var node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function shopLink(value){
 if(!value||typeof value!=='string'||/[\s\\\x00-\x1f]/.test(value)||value.indexOf('//')===0)return '';
 if(value.charAt(0)!=='/'&&!/^https:\/\//i.test(value))return '';
 try{var url=new URL(value,'https://www.nexkartbd.com');if(url.protocol!=='https:'||!['www.nexkartbd.com','nexkartbd.com'].includes(url.hostname)||url.username||url.password||url.port)return '';return url.pathname+url.search+url.hash;}catch(e){return '';}
}
function imageUrl(value,offer){
 if(typeof value!=='string'||!value.trim())return '';
 var raw=value.trim().replace(/^(\/?uploads\/)+/,'');
 if(raw.indexOf('cloudinary.com')>=0&&!/^https?:\/\//i.test(raw))raw='https://'+raw;
 if(!/^https?:\/\//i.test(raw))raw='/uploads/'+raw;
 try{var u=new URL(raw,location.origin);if(offer)return u.protocol==='https:'&&u.hostname==='res.cloudinary.com'?u.href:'';if(u.origin===location.origin||u.protocol==='https:')return u.href;}catch(e){}return '';
}
async function fetchData(url){var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},10000);try{var r=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}finally{clearTimeout(timer);}}
function offerSlide(banner){
 var src=imageUrl(banner.image_url,true);if(!src)return null;
 var slide=el('div','slide nx-offer-slide');slide.dataset.kind='offer';slide.dataset.bannerId=String(banner.id);
 var href=shopLink(banner.target_url),wrap=el(href?'a':'div','nx-offer-image-wrap');if(href)wrap.href=href;
 var img=el('img','nx-offer-image');img.src=src;img.alt=String(banner.alt_text||banner.title||'NexkartBD offer');img.decoding='async';
 // A full image is shown without cropping or a text overlay over its artwork.
 img.addEventListener('error',function(){slide.dataset.failed='1';if(cleanup)cleanup();slide.remove();window.initSlider();},{once:true});
 wrap.appendChild(img);slide.appendChild(wrap);return slide;
}
function productSlide(product,coupons){
 var slide=el('div','slide');slide.dataset.kind='product';
 var src=imageUrl(product.primary_image,false)||'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1200&q=80';slide.style.backgroundImage='url('+JSON.stringify(src)+')';
 var content=el('div','slide-content');content.appendChild(el('h2','',String(product.title||'Featured product')));content.appendChild(el('p','','Special Price: ৳ '+String(product.sale_price??'')));
 var button=el('a','slide-btn','Shop Now'),slug=product.slug?encodeURIComponent(String(product.slug)):'';button.href=slug?'/user/product/'+slug:'/user/category.html?type=all';
 button.addEventListener('click',function(e){if(slug&&typeof window.checkLoginAndRedirect==='function'){e.preventDefault();window.checkLoginAndRedirect(slug);}});content.appendChild(button);slide.appendChild(content);
 var coupon=coupons.find(function(c){return String(c.product_id)===String(product.id)||String(c.product_id)===String(product.product_id);});
 if(coupon){var badge=el('button','banner-star-badge');badge.type='button';badge.title='Click to copy coupon';badge.appendChild(el('span','offer-title','Get Special Offer'));badge.appendChild(el('span','coupon-code',String(coupon.coupon_name)));badge.appendChild(el('span','discount-text','৳ '+String(coupon.discount_amount)+' OFF'));badge.addEventListener('click',function(){if(typeof window.copyCouponCode==='function')window.copyCouponCode(String(coupon.coupon_name));});slide.appendChild(badge);}
 return slide;
}
window.loadBannerProducts=async function(){
 var container=document.getElementById('dynamicBannerSlider');if(!container)return;
 // Failure of offers or coupons never prevents the existing product banners loading.
 var results=await Promise.allSettled([fetchData('/user/banner-products'),fetchData('/user/get-coupons'),fetchData('/user/offer-banners')]);
 var productData=results[0].status==='fulfilled'?results[0].value:{},couponData=results[1].status==='fulfilled'?results[1].value:{},offerData=results[2].status==='fulfilled'?results[2].value:{};
 var products=productData.success&&Array.isArray(productData.products)?productData.products:[],coupons=couponData.success&&Array.isArray(couponData.coupons)?couponData.coupons:[],offers=offerData.success&&Array.isArray(offerData.banners)?offerData.banners:[];
 var offerSlides=offers.map(offerSlide).filter(Boolean),slides=[];
 var intro=container.querySelector('[data-home-intro]');if(intro)slides.push(intro);
 // Alternate offer and product slides; offers retain the administrator's display order.
 for(var i=0;i<Math.max(offerSlides.length,products.length);i++){if(offerSlides[i])slides.push(offerSlides[i]);if(products[i])slides.push(productSlide(products[i],coupons));}
 if(slides.length){if(cleanup)cleanup();container.replaceChildren.apply(container,slides);}else{container.querySelectorAll('.slide-content p').forEach(function(x){if(x.textContent==='Loading exclusive products...')x.textContent='Explore our latest collections.';});}
 window.initSlider();
};
window.initSlider=function(){
 var container=document.getElementById('dynamicBannerSlider');if(!container)return;
 if(cleanup)cleanup();
 var slides=Array.from(container.querySelectorAll('.slide')).filter(function(x){return x.dataset.failed!=='1';}),current=0,timer=null,hovered=false,focused=false,userPaused=false,startX=null,startY=null;
 if(!slides.length)return;
 container.setAttribute('role','region');container.setAttribute('aria-label','Featured products and offers');container.setAttribute('aria-roledescription','carousel');
 var controls=el('div','nx-slider-controls'),prev=el('button','nx-slider-arrow nx-slider-prev','‹'),next=el('button','nx-slider-arrow nx-slider-next','›'),pause=el('button','nx-slider-pause','Pause'),dots=el('div','nx-slider-dots'),status=el('span','nx-slider-sr');
 [prev,next,pause].forEach(function(x){x.type='button';});prev.setAttribute('aria-label','Previous banner');next.setAttribute('aria-label','Next banner');pause.setAttribute('aria-label','Pause automatic banner rotation');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');controls.append(prev,next,pause,dots,status);container.appendChild(controls);
 var dotButtons=slides.map(function(_,i){var dot=el('button','nx-slider-dot');dot.type='button';dot.setAttribute('aria-label','Show banner '+(i+1));dot.addEventListener('click',function(){move(i,true);});dots.appendChild(dot);return dot;});
 function stop(){if(timer)clearTimeout(timer);timer=null;window.bannerInterval=null;}
 function schedule(){stop();if(slides.length>1&&!hovered&&!focused&&!userPaused&&!document.hidden){timer=setTimeout(function(){move(current+1,false);},DURATION);window.bannerInterval=timer;}}
 function move(index,manual){current=(index+slides.length)%slides.length;slides.forEach(function(x,i){var active=i===current;x.classList.toggle('active',active);x.setAttribute('aria-hidden',String(!active));x.inert=!active;dotButtons[i].setAttribute('aria-current',active?'true':'false');});if(manual)status.textContent='Banner '+(current+1)+' of '+slides.length;schedule();}
 prev.addEventListener('click',function(){move(current-1,true);});next.addEventListener('click',function(){move(current+1,true);});
 pause.addEventListener('click',function(){userPaused=!userPaused;pause.textContent=userPaused?'Play':'Pause';pause.setAttribute('aria-label',userPaused?'Resume automatic banner rotation':'Pause automatic banner rotation');schedule();});
 function enter(){hovered=true;stop();}function leave(){hovered=false;schedule();}function focusIn(){focused=true;stop();}function focusOut(e){if(!container.contains(e.relatedTarget)){focused=false;schedule();}}function visibility(){schedule();}
 function touchStart(e){if(e.touches.length!==1)return;startX=e.touches[0].clientX;startY=e.touches[0].clientY;}
 function touchEnd(e){if(startX===null||!e.changedTouches.length)return;var dx=e.changedTouches[0].clientX-startX,dy=e.changedTouches[0].clientY-startY;startX=null;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.5)move(current+(dx<0?1:-1),true);}
 function key(e){if(e.target!==container)return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();move(current+(e.key==='ArrowLeft'?-1:1),true);}}
 container.tabIndex=0;container.addEventListener('mouseenter',enter);container.addEventListener('mouseleave',leave);container.addEventListener('focusin',focusIn);container.addEventListener('focusout',focusOut);container.addEventListener('touchstart',touchStart,{passive:true});container.addEventListener('touchend',touchEnd,{passive:true});container.addEventListener('keydown',key);document.addEventListener('visibilitychange',visibility);
 controls.hidden=slides.length<2;
 cleanup=function(){stop();controls.remove();container.removeEventListener('mouseenter',enter);container.removeEventListener('mouseleave',leave);container.removeEventListener('focusin',focusIn);container.removeEventListener('focusout',focusOut);container.removeEventListener('touchstart',touchStart);container.removeEventListener('touchend',touchEnd);container.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',visibility);cleanup=null;};
 move(0,false);
};
})();
